"use strict";

const { PROVIDERS } = require("./domain/constants");
const { ConfigurationError } = require("./domain/errors");

function json(value, fallback, name) {
  if (!value) return fallback;
  try { return JSON.parse(value); } catch (_) { throw new ConfigurationError(`${name} must contain valid JSON`); }
}

function provider(value, fallback = PROVIDERS.DIDIT) {
  const normalized = String(value || fallback).toUpperCase();
  if (!Object.values(PROVIDERS).includes(normalized)) throw new ConfigurationError(`Unsupported default IDV provider: ${value}`);
  return normalized;
}

function httpsUrl(value, name, fallback) {
  const candidate = value || fallback;
  if (!candidate) return null;
  let parsed;
  try { parsed = new URL(candidate); } catch (_) { throw new ConfigurationError(`${name} must be a valid URL`); }
  if (parsed.protocol !== "https:") throw new ConfigurationError(`${name} must use HTTPS`);
  return parsed.toString().replace(/\/$/, "");
}

function loadConfig(env = process.env) {
  const environment = String(env.IDV_ENVIRONMENT || "sandbox").toLowerCase();
  if (!["sandbox", "production"].includes(environment)) {
    throw new ConfigurationError("IDV_ENVIRONMENT must be sandbox or production");
  }
  return {
    environment,
    defaultProvider: provider(env.IDV_DEFAULT_PROVIDER),
    routingOverrides: json(env.IDV_ROUTING_OVERRIDES_JSON, [], "IDV_ROUTING_OVERRIDES_JSON"),
    costConfig: json(env.IDV_COST_CONFIG_JSON, {}, "IDV_COST_CONFIG_JSON"),
    syntheticOnlyStore: env.IDV_SYNTHETIC_ONLY === "1",
    didit: {
      environment,
      baseUrl: httpsUrl(env.DIDIT_BASE_URL, "DIDIT_BASE_URL", "https://verification.didit.me"),
      apiKey: env.DIDIT_API_KEY,
      workflowId: env.DIDIT_WORKFLOW_ID,
      webhookSecret: env.DIDIT_WEBHOOK_SECRET,
      callbackUrl: httpsUrl(env.DIDIT_CALLBACK_URL, "DIDIT_CALLBACK_URL"),
    },
    veriff: {
      environment,
      baseUrl: httpsUrl(env.VERIFF_BASE_URL, "VERIFF_BASE_URL", "https://stationapi.veriff.com"),
      apiKey: env.VERIFF_API_KEY,
      sharedSecret: env.VERIFF_SHARED_SECRET,
      callbackUrl: httpsUrl(env.VERIFF_CALLBACK_URL, "VERIFF_CALLBACK_URL"),
      workflow: env.VERIFF_WORKFLOW || "ESSENTIAL",
      workflowVersion: env.VERIFF_WORKFLOW_VERSION || null,
      verifyApiResponses: env.VERIFF_VERIFY_API_RESPONSES !== "0",
    },
    harness: {
      host: env.IDV_HARNESS_HOST || "127.0.0.1",
      port: Number(env.IDV_HARNESS_PORT || 3100),
      allowRemote: env.IDV_HARNESS_ALLOW_REMOTE === "1",
      token: env.IDV_HARNESS_TOKEN,
    },
  };
}

module.exports = { loadConfig };
