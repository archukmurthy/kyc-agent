"use strict";

const { PROVIDERS } = require("./domain/constants");
const { ConfigurationError } = require("./domain/errors");

function json(value, fallback, name) {
  if (!value) return fallback;
  try { return JSON.parse(value); } catch (_) { throw new ConfigurationError(`${name} must contain valid JSON`); }
}

function csv(value, fallback = []) { return value ? value.split(",").map((item) => item.trim()).filter(Boolean) : fallback; }

function httpsUrl(value, name, fallback) {
  const candidate = value || fallback;
  if (!candidate) return null;
  let parsed;
  try { parsed = new URL(candidate); } catch (_) { throw new ConfigurationError(`${name} must be a valid URL`); }
  if (parsed.protocol !== "https:") throw new ConfigurationError(`${name} must use HTTPS`);
  return parsed.toString().replace(/\/$/, "");
}

function required(value, name) { if (!value) throw new ConfigurationError(`${name} is required`); return value; }

function loadConfig(env = process.env) {
  const runtimeMode = String(env.IDV_RUNTIME_MODE || env.IDV_ENVIRONMENT || "test").toLowerCase();
  if (!["test", "sandbox", "poc", "production"].includes(runtimeMode)) {
    throw new ConfigurationError("IDV_RUNTIME_MODE must be test, sandbox, poc, or production");
  }
  const enabledProviders = csv(env.IDV_ENABLED_PROVIDERS, Object.values(PROVIDERS)).map((item) => item.toUpperCase());
  const defaultProvider = String(env.IDV_DEFAULT_PROVIDER || PROVIDERS.DIDIT).toUpperCase();
  if (!enabledProviders.includes(defaultProvider)) throw new ConfigurationError("IDV_DEFAULT_PROVIDER must be enabled");
  const production = runtimeMode === "production";
  const controlledPoc = runtimeMode === "poc";
  const debugDiditHttp = env.IDV_DEBUG_DIDIT_HTTP === "1";
  if (production && debugDiditHttp) throw new ConfigurationError("Didit HTTP diagnostics are forbidden in production");
  const syntheticOnlyStore = env.IDV_SYNTHETIC_ONLY === "1";
  const pocHarnessEnabled = env.IDV_POC_HARNESS_ENABLED === "1";
  if (production && syntheticOnlyStore) throw new ConfigurationError("Synthetic identity storage is forbidden in production");
  if (production && pocHarnessEnabled) throw new ConfigurationError("The POC harness is forbidden in production");

  const oidc = {
    issuer: env.IDV_OIDC_ISSUER ? httpsUrl(env.IDV_OIDC_ISSUER, "IDV_OIDC_ISSUER") : null,
    audience: env.IDV_OIDC_AUDIENCE || null,
    tenantClaim: env.IDV_OIDC_TENANT_CLAIM || "tenant_id",
    rolesClaim: env.IDV_OIDC_ROLES_CLAIM || "roles",
    scopesClaim: env.IDV_OIDC_SCOPES_CLAIM || "scope",
    acceptedAlgorithms: csv(env.IDV_OIDC_ACCEPTED_ALGORITHMS, ["RS256"]),
  };
  if (production) {
    required(env.IDV_DATABASE_URL, "IDV_DATABASE_URL");
    required(oidc.issuer, "IDV_OIDC_ISSUER");
    required(oidc.audience, "IDV_OIDC_AUDIENCE");
  }

  const diditEnvironment = String(env.DIDIT_ENVIRONMENT || (["test", "sandbox"].includes(runtimeMode) ? "sandbox" : "live")).toLowerCase();
  if (!["sandbox", "live"].includes(diditEnvironment)) throw new ConfigurationError("DIDIT_ENVIRONMENT must be sandbox or live");
  const didit = {
    environment: diditEnvironment,
    runtimeMode,
    debugHttp: debugDiditHttp,
    baseUrl: httpsUrl(env.DIDIT_BASE_URL, "DIDIT_BASE_URL", "https://verification.didit.me"),
    apiKey: env.DIDIT_API_KEY,
    workflowId: env.DIDIT_WORKFLOW_ID,
    webhookSecret: env.DIDIT_WEBHOOK_SECRET,
    callbackUrl: httpsUrl(env.DIDIT_CALLBACK_URL, "DIDIT_CALLBACK_URL"),
    publicWebhookUrl: httpsUrl(env.DIDIT_PUBLIC_WEBHOOK_URL, "DIDIT_PUBLIC_WEBHOOK_URL"),
  };
  const veriff = {
    environment: runtimeMode,
    baseUrl: httpsUrl(env.VERIFF_BASE_URL, "VERIFF_BASE_URL", "https://stationapi.veriff.com"),
    apiKey: env.VERIFF_API_KEY,
    sharedSecret: env.VERIFF_SHARED_SECRET,
    callbackUrl: httpsUrl(env.VERIFF_CALLBACK_URL, "VERIFF_CALLBACK_URL"),
    publicWebhookUrl: httpsUrl(env.VERIFF_PUBLIC_WEBHOOK_URL, "VERIFF_PUBLIC_WEBHOOK_URL"),
    workflow: env.VERIFF_WORKFLOW || "ESSENTIAL_FULL_AUTO",
    workflowVersion: env.VERIFF_WORKFLOW_VERSION || null,
    verifyApiResponses: env.VERIFF_VERIFY_API_RESPONSES !== "0",
  };
  if (production || controlledPoc) {
    if (enabledProviders.includes(PROVIDERS.DIDIT)) {
      for (const [name, value] of Object.entries({ DIDIT_API_KEY: didit.apiKey, DIDIT_WORKFLOW_ID: didit.workflowId, DIDIT_WEBHOOK_SECRET: didit.webhookSecret, DIDIT_CALLBACK_URL: didit.callbackUrl, DIDIT_PUBLIC_WEBHOOK_URL: didit.publicWebhookUrl })) required(value, name);
    }
    if (enabledProviders.includes(PROVIDERS.VERIFF)) {
      for (const [name, value] of Object.entries({ VERIFF_API_KEY: veriff.apiKey, VERIFF_SHARED_SECRET: veriff.sharedSecret, VERIFF_CALLBACK_URL: veriff.callbackUrl, VERIFF_PUBLIC_WEBHOOK_URL: veriff.publicWebhookUrl })) required(value, name);
    }
  }
  return {
    runtimeMode,
    environment: runtimeMode,
    production,
    enabledProviders,
    defaultProvider,
    databaseUrl: env.IDV_DATABASE_URL || null,
    routingOverrides: json(env.IDV_ROUTING_OVERRIDES_JSON, [], "IDV_ROUTING_OVERRIDES_JSON"),
    costConfig: json(env.IDV_COST_CONFIG_JSON, {}, "IDV_COST_CONFIG_JSON"),
    syntheticOnlyStore,
    oidc,
    didit,
    veriff,
    harness: {
      enabled: pocHarnessEnabled,
      host: env.IDV_HARNESS_HOST || "127.0.0.1",
      port: Number(env.IDV_HARNESS_PORT || 3100),
      allowRemote: env.IDV_HARNESS_ALLOW_REMOTE === "1",
      token: env.IDV_HARNESS_TOKEN,
    },
  };
}

module.exports = { loadConfig };
