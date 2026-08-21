"use strict";

const http = require("http");
const { randomUUID, timingSafeEqual } = require("crypto");
const { createIdvModule } = require("..");

const MAX_BODY_BYTES = 1024 * 1024;
const POC_CONFIRMATION_FIELDS = Object.freeze([
  "first_name", "last_name", "date_of_birth", "nationality", "address", "addresses", "document_number",
]);

function json(res, status, value, extraHeaders = {}) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extraHeaders });
  res.end(JSON.stringify(value));
}

function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char])); }

function html(res, status, value, extraHeaders = {}) {
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    ...extraHeaders,
  });
  res.end(value);
}

async function body(req) {
  const chunks = []; let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) { const error = new Error("Request body is too large"); error.statusCode = 413; throw error; }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseInput(req, raw) {
  return String(req.headers["content-type"] || "").includes("application/json") ? JSON.parse(raw || "{}") : Object.fromEntries(new URLSearchParams(raw));
}

function safeEqualText(left, right) {
  const a = Buffer.from(String(left)); const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}

function harnessAuthorized(req, config) {
  if (!config.harness.allowRemote) return true;
  const match = /^Basic\s+(.+)$/i.exec(String(req.headers.authorization || ""));
  if (!match || !config.harness.token) return false;
  let decoded = "";
  try { decoded = Buffer.from(match[1], "base64").toString("utf8"); } catch (_) { return false; }
  return safeEqualText(decoded, `idv:${config.harness.token}`);
}

function landingPage(config, adapters) {
  const options = Object.keys(adapters).map((provider) => `<option value="${escapeHtml(provider)}">${escapeHtml(provider)}</option>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Controlled IDV POC</title>
  <style>body{font:16px system-ui;max-width:760px;margin:48px auto;padding:0 20px;color:#18212f}fieldset{border:1px solid #ccd3dc;border-radius:10px;padding:20px;display:grid;gap:12px}label{display:grid;gap:5px}input,select,button{font:inherit;padding:9px}button{cursor:pointer;background:#173f73;color:white;border:0;border-radius:7px}.note{background:#fff6d8;padding:14px;border-radius:8px}code{background:#eef2f6;padding:2px 5px}</style></head>
  <body><h1>Controlled IDV POC</h1><p class="note">Authorized testers only. Raw identity evidence goes directly to the provider. Browser return is never verification success. Do not put names or identity values in test-case IDs.</p>
  <p>Mode: <code>${escapeHtml(config.runtimeMode)}</code> · PII store: <code>${config.syntheticOnlyStore ? "SYNTHETIC_TEST_ONLY" : "ENCRYPTED_MANAGED_KEY"}</code></p>
  <form method="post" action="/poc/start"><fieldset><legend>Start hosted verification</legend>
  <label>Provider<select name="provider">${options}</select></label>
  <label>Test case ID<input name="testCaseId" required value="TEST-UK-PASSPORT-IOS-001" pattern="TEST-[A-Z0-9-]{3,80}" maxlength="85"></label>
  <label>POC cohort ID<input name="pocCohortId" required value="POC-INITIAL-001" pattern="[A-Z0-9-]{3,80}" maxlength="80"></label>
  <label>Issuing country<input name="documentIssuingCountry" required value="GB" pattern="[A-Z]{2,3}" maxlength="3"></label>
  <label>Document type<select name="documentType"><option>PASSPORT</option><option>ID_CARD</option><option>DRIVERS_LICENSE</option></select></label>
  <label>Device platform<select name="devicePlatform"><option>IOS</option><option>ANDROID</option><option>DESKTOP</option></select></label>
  <button type="submit">Create and open hosted flow</button></fieldset></form>
  <p><a href="/poc/scorecard">Measured provider scorecard (JSON)</a></p></body></html>`;
}

function publicError(error) {
  return {
    error: error.code || "IDV_HARNESS_ERROR",
    message: error.code === "IDV_PROVIDER_ERROR" ? "Provider request failed; use provider-side diagnostics" : "IDV request could not be completed",
    retryable: error.retryable === true,
  };
}

function createHarness(options = {}) {
  const module = options.module || createIdvModule(options);
  const { config, service, adapters } = module;
  if (!config.harness.enabled) throw new Error("POC harness requires IDV_POC_HARNESS_ENABLED=1");
  if (config.production) throw new Error("POC harness is forbidden in production");
  if (config.harness.host !== "127.0.0.1" && config.harness.host !== "::1" && !config.harness.allowRemote) throw new Error("Remote harness binding is not authorized");
  if (config.harness.allowRemote && !config.harness.token) throw new Error("IDV_HARNESS_TOKEN is required for remote harness binding");
  const resolvePocSubject = options.resolvePocSubject;
  const pocSecurityContextProvider = options.pocSecurityContextProvider;
  const webhookSecurityContextProvider = options.webhookSecurityContextProvider;
  const pocContext = async (req) => config.syntheticOnlyStore ? null : pocSecurityContextProvider(req);

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    try {
      if (url.pathname === "/health") return json(res, 200, { status: "ok", runtime_mode: config.runtimeMode, poc_harness: true });

      // Provider webhooks are authenticated by adapter HMAC. They deliberately
      // bypass harness Basic auth, which providers cannot supply. Production PII
      // ingestion additionally requires an injected verified OIDC service context.
      if (req.method === "POST" && url.pathname.startsWith("/provider-webhooks/")) {
        const provider = url.pathname.slice("/provider-webhooks/".length).toUpperCase();
        if (!adapters[provider]) return json(res, 404, { error: "NOT_FOUND" });
        const rawBody = await body(req);
        const securityContext = config.syntheticOnlyStore ? null : await webhookSecurityContextProvider({ provider, correlationId: randomUUID() });
        const result = await service.processWebhook(provider, { rawBody, headers: req.headers, receivedAt: new Date(), securityContext });
        return json(res, 200, { received: true, duplicate: result.duplicate === true });
      }

      if (!harnessAuthorized(req, config)) return json(res, 401, { error: "UNAUTHORIZED" }, { "www-authenticate": 'Basic realm="Controlled IDV POC", charset="UTF-8"' });
      if (req.method === "GET" && url.pathname === "/") return html(res, 200, landingPage(config, adapters));
      if (req.method === "POST" && url.pathname === "/poc/start") {
        const input = parseInput(req, await body(req));
        const provider = String(input.provider || "").toUpperCase();
        if (!adapters[provider]) return json(res, 400, { error: "INVALID_PROVIDER" });
        const testCaseId = String(input.testCaseId || "");
        if (!/^TEST-[A-Z0-9-]{3,80}$/.test(testCaseId)) return json(res, 400, { error: "INVALID_TEST_CASE_ID" });
        let tenantId = "idv-synthetic-poc";
        let subjectPersonId = `synthetic:${randomUUID()}`;
        if (!config.syntheticOnlyStore) {
          if (typeof pocSecurityContextProvider !== "function" || typeof resolvePocSubject !== "function") throw new Error("Real POC authentication/subject resolver is unavailable");
          const securityContext = await pocSecurityContextProvider(req);
          const subject = await resolvePocSubject({ securityContext, testCaseId, operation: "POC_START" });
          tenantId = securityContext.tenantId;
          subjectPersonId = subject.subjectId;
        }
        const started = await service.startVerification({
          provider,
          tenantId,
          customerContextId: `poc:${testCaseId}`,
          subjectPersonId,
          testCaseId,
          pocCohortId: String(input.pocCohortId || ""),
          country: String(input.documentIssuingCountry || "").toUpperCase(),
          documentIssuingCountry: String(input.documentIssuingCountry || "").toUpperCase(),
          documentType: input.documentType,
          devicePlatform: input.devicePlatform,
          syntheticTestData: config.syntheticOnlyStore,
        });
        await service.markHostedFlowOpened(started.session.internal_idv_session_id);
        if (String(req.headers.accept || "").includes("application/json")) return json(res, 201, { internal_idv_session_id: started.session.internal_idv_session_id, hosted_verification_url: started.hosted_verification_url });
        res.writeHead(303, { location: started.hosted_verification_url, "cache-control": "no-store", "referrer-policy": "no-referrer" });
        return res.end();
      }
      if (req.method === "GET" && url.pathname === "/provider-return") {
        const provider = String(url.searchParams.get("provider") || (url.searchParams.has("verificationSessionId") ? "DIDIT" : "VERIFF")).toUpperCase();
        const providerSessionId = url.searchParams.get("verificationSessionId") || url.searchParams.get("sessionId") || url.searchParams.get("id");
        if (!providerSessionId) return json(res, 400, { error: "PROVIDER_SESSION_ID_REQUIRED" });
        const session = await service.recordCustomerReturnByProviderSession(provider, providerSessionId);
        return html(res, 200, `<!doctype html><html><body><h1>Return received</h1><p>Test session <code>${escapeHtml(session.internal_idv_session_id)}</code> is awaiting an authenticated provider decision.</p><p>No identity values are displayed on this page.</p></body></html>`);
      }
      if (req.method === "GET" && /^\/poc\/confirm\/[^/]+$/.test(url.pathname)) {
        const sessionId = decodeURIComponent(url.pathname.slice("/poc/confirm/".length));
        const securityContext = await pocContext(req);
        const tenantId = config.syntheticOnlyStore ? "idv-synthetic-poc" : securityContext.tenantId;
        const { session } = await service.getSession(sessionId, tenantId);
        const fields = POC_CONFIRMATION_FIELDS.filter((field) => field !== "document_number" || config.syntheticOnlyStore || securityContext.scopes.includes("idv:pii:restricted"));
        const attributes = await service.recordAttributesPresented(sessionId, undefined, { fields, securityContext, correlationId: randomUUID() });
        const rows = attributes.map((attribute) => `<fieldset><legend>${escapeHtml(attribute.attribute_concept)}</legend>
          <input type="hidden" name="concept_${escapeHtml(attribute.attribute_id)}" value="${escapeHtml(attribute.attribute_concept)}">
          <label>Provider extraction<input value="${escapeHtml(attribute.attribute_value)}" disabled></label>
          <label>Response<select name="action_${escapeHtml(attribute.attribute_id)}"><option value="CONFIRMED">Confirm</option><option value="CORRECTED">Correct</option><option value="REJECTED">Reject</option></select></label>
          <label>Corrected value (only when correcting)<input name="value_${escapeHtml(attribute.attribute_id)}"></label></fieldset>`).join("");
        return html(res, 200, `<!doctype html><html><head><meta charset="utf-8"><title>IDV confirmation</title></head><body><h1>Controlled identity confirmation</h1><p>Authorized POC screen. Values are not logged or copied into metrics.</p><form method="post" action="/poc/confirm/${escapeHtml(sessionId)}">${rows || "<p>No authorized extracted fields are available yet.</p>"}<button type="submit">Record responses</button></form>
          <h2>Non-PII ground truth</h2><form method="post" action="/poc/ground-truth/${escapeHtml(sessionId)}"><input type="hidden" name="testCaseId" value="${escapeHtml(session.dimensions.test_case_id)}"><label>Genuine tester<select name="genuine"><option value="true">Yes</option><option value="false">No</option></select></label><label>Valid technical opportunity<select name="opportunity"><option value="true">Yes</option><option value="false">No</option></select></label><button type="submit">Record label</button></form></body></html>`);
      }
      if (req.method === "POST" && /^\/poc\/confirm\/[^/]+$/.test(url.pathname)) {
        const sessionId = decodeURIComponent(url.pathname.slice("/poc/confirm/".length));
        const securityContext = await pocContext(req);
        const input = parseInput(req, await body(req));
        const actions = Object.entries(input).filter(([key]) => key.startsWith("action_"));
        for (const [key, action] of actions) {
          const attributeId = key.slice("action_".length);
          await service.recordCustomerResponse({
            internalIdvSessionId: sessionId,
            attributeId,
            attributeConcept: input[`concept_${attributeId}`],
            action,
            submittedValue: input[`value_${attributeId}`],
            securityContext,
            correlationId: randomUUID(),
          });
        }
        return html(res, 200, "<!doctype html><html><body><h1>Responses recorded</h1><p>Provider extraction history remains unchanged.</p></body></html>");
      }
      if (req.method === "POST" && /^\/poc\/ground-truth\/[^/]+$/.test(url.pathname)) {
        const sessionId = decodeURIComponent(url.pathname.slice("/poc/ground-truth/".length));
        const securityContext = await pocContext(req);
        const input = parseInput(req, await body(req));
        await service.recordPocGroundTruth({
          internalIdvSessionId: sessionId,
          testCaseId: input.testCaseId,
          genuineUserLabel: input.genuine === "true",
          validTechnicalOpportunity: input.opportunity === "true",
          comparisonFlags: {},
          securityContext,
        });
        return html(res, 200, "<!doctype html><html><body><h1>Ground truth recorded</h1><p>Only non-PII labels were stored.</p></body></html>");
      }
      if (req.method === "GET" && url.pathname === "/poc/scorecard") {
        const tenantId = config.syntheticOnlyStore ? "idv-synthetic-poc" : (await pocContext(req)).tenantId;
        return json(res, 200, await service.getMetrics({ tenantId, pocOnly: true }));
      }
      if (req.method === "GET" && url.pathname.startsWith("/poc/sessions/")) {
        const tenantId = config.syntheticOnlyStore ? "idv-synthetic-poc" : (await pocContext(req)).tenantId;
        const data = await service.getSession(decodeURIComponent(url.pathname.slice("/poc/sessions/".length)), tenantId);
        return json(res, 200, { internal_idv_session_id: data.session.internal_idv_session_id, provider: data.session.provider, canonical_status: data.session.canonical_status, timestamps: { created_at: data.session.created_at, provider_decision_at: data.session.provider_decision_at, provider_result_received_at: data.session.provider_result_received_at, canonical_result_completed_at: data.session.canonical_result_completed_at } });
      }
      return json(res, 404, { error: "NOT_FOUND" });
    } catch (error) {
      const status = error.statusCode || (error.code === "IDV_WEBHOOK_AUTHENTICATION_FAILED" ? 401 : error.code === "IDV_SESSION_NOT_FOUND" ? 404 : ["IDV_SECURE_STORE_REQUIRED", "IDV_MANAGED_KEY_REQUIRED"].includes(error.code) ? 503 : 400);
      return json(res, status, publicError(error));
    }
  });
  return { server, module };
}

if (require.main === module) {
  const harness = createHarness();
  const { host, port } = harness.module.config.harness;
  harness.server.listen(port, host, () => process.stdout.write(`Controlled IDV POC harness listening on http://${host}:${port}\n`));
}

module.exports = { createHarness };
