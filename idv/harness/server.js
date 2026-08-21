"use strict";

const http = require("http");
const { createIdvModule } = require("..");
const { PROVIDERS } = require("../domain/constants");

const MAX_BODY_BYTES = 1024 * 1024;

function json(res, status, value) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(value));
}

function html(res, status, value) {
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    "x-content-type-options": "nosniff",
  });
  res.end(value);
}

async function body(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) {
      const error = new Error("Request body is too large");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseInput(req, raw) {
  if (String(req.headers["content-type"] || "").includes("application/json")) return JSON.parse(raw || "{}");
  return Object.fromEntries(new URLSearchParams(raw));
}

function landingPage(config) {
  const diditReady = Boolean(config.didit.apiKey && config.didit.workflowId && config.didit.webhookSecret);
  const veriffReady = Boolean(config.veriff.apiKey && config.veriff.sharedSecret);
  return `<!doctype html><html><head><meta charset="utf-8"><title>Standalone IDV Harness</title>
  <style>body{font:16px system-ui;max-width:720px;margin:48px auto;padding:0 20px;color:#18212f}fieldset{border:1px solid #ccd3dc;border-radius:10px;padding:20px;display:grid;gap:12px}label{display:grid;gap:5px}input,select,button{font:inherit;padding:9px}button{cursor:pointer;background:#173f73;color:white;border:0;border-radius:7px}.note{background:#fff6d8;padding:14px;border-radius:8px}code{background:#eef2f6;padding:2px 5px}</style></head>
  <body><h1>Standalone IDV Harness</h1><p class="note">Engineering harness only. Browser return is recorded but never treated as verification success. Provider webhooks/results are authoritative.</p>
  <p>Didit: <strong>${diditReady ? "configured" : "credentials missing"}</strong> · Veriff: <strong>${veriffReady ? "configured" : "credentials missing"}</strong> · environment: <code>${config.environment}</code></p>
  <form method="post" action="/start-idv"><fieldset><legend>Start hosted verification</legend>
  <label>Provider<select name="provider"><option value="DIDIT">Didit Full KYC</option><option value="VERIFF">Veriff Essential</option></select></label>
  <label>Test case ID<input name="testCaseId" required value="synthetic-001" maxlength="80"></label>
  <label>Issuing country<input name="documentIssuingCountry" required value="GB" maxlength="3"></label>
  <label>Document type<select name="documentType"><option>PASSPORT</option><option>ID_CARD</option><option>DRIVERS_LICENSE</option></select></label>
  <input type="hidden" name="syntheticTestData" value="true"><button type="submit">Create and open hosted flow</button>
  </fieldset></form><p><a href="/metrics">Canonical provider scorecard (JSON)</a></p></body></html>`;
}

function authorized(req, config) {
  if (!config.harness.allowRemote) return true;
  return Boolean(config.harness.token) && req.headers.authorization === `Bearer ${config.harness.token}`;
}

function publicError(error) {
  return {
    error: error.code || "IDV_HARNESS_ERROR",
    message: error.code === "IDV_PROVIDER_ERROR" ? "Provider request failed; inspect provider-side diagnostics" : error.message,
    retryable: error.retryable === true,
  };
}

function createHarness(options = {}) {
  const module = options.module || createIdvModule(options);
  const { config, service, adapters } = module;
  if (config.harness.host !== "127.0.0.1" && config.harness.host !== "::1" && !config.harness.allowRemote) {
    throw new Error("Remote harness binding requires IDV_HARNESS_ALLOW_REMOTE=1 and IDV_HARNESS_TOKEN");
  }
  if (config.harness.allowRemote && !config.harness.token) throw new Error("IDV_HARNESS_TOKEN is required for remote harness binding");

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    try {
      if (url.pathname === "/health") {
        return json(res, 200, {
          status: "ok", environment: config.environment,
          providers: Object.fromEntries(Object.entries(adapters).map(([key, adapter]) => [key, adapter.getCapabilities()])),
          pii_store: config.syntheticOnlyStore ? "SYNTHETIC_ONLY" : "PRODUCTION_STORE_NOT_CONFIGURED",
        });
      }
      if (!authorized(req, config)) return json(res, 401, { error: "UNAUTHORIZED" });
      if (req.method === "GET" && url.pathname === "/") return html(res, 200, landingPage(config));
      if (req.method === "POST" && url.pathname === "/start-idv") {
        const input = parseInput(req, await body(req));
        const provider = String(input.provider || "").toUpperCase();
        if (!Object.values(PROVIDERS).includes(provider)) return json(res, 400, { error: "INVALID_PROVIDER" });
        const testCaseId = String(input.testCaseId || "").slice(0, 80);
        const started = await service.startVerification({
          provider,
          tenantId: "idv-poc",
          customerContextId: `poc:${testCaseId}`,
          testCaseId,
          country: String(input.documentIssuingCountry || "").toUpperCase(),
          documentIssuingCountry: String(input.documentIssuingCountry || "").toUpperCase(),
          documentType: input.documentType,
          syntheticTestData: input.syntheticTestData === true || input.syntheticTestData === "true",
        });
        await service.markHostedFlowOpened(started.session.internal_idv_session_id);
        if (String(req.headers.accept || "").includes("application/json")) {
          return json(res, 201, {
            internal_idv_session_id: started.session.internal_idv_session_id,
            hosted_verification_url: started.hosted_verification_url,
          });
        }
        res.writeHead(303, { location: started.hosted_verification_url, "cache-control": "no-store" });
        return res.end();
      }
      if (req.method === "GET" && url.pathname === "/return") {
        const provider = String(url.searchParams.get("provider") || (url.searchParams.has("verificationSessionId") ? "DIDIT" : "VERIFF")).toUpperCase();
        const providerSessionId = url.searchParams.get("verificationSessionId") || url.searchParams.get("sessionId") || url.searchParams.get("id");
        if (!providerSessionId) return json(res, 400, { error: "PROVIDER_SESSION_ID_REQUIRED" });
        const session = await service.recordCustomerReturnByProviderSession(provider, providerSessionId);
        return html(res, 200, `<!doctype html><html><body><h1>Return received</h1><p>Session <code>${session.internal_idv_session_id}</code> is awaiting an authoritative provider decision.</p></body></html>`);
      }
      if (req.method === "POST" && url.pathname.startsWith("/webhooks/")) {
        const provider = url.pathname.endsWith("/didit") ? PROVIDERS.DIDIT
          : url.pathname.endsWith("/veriff") ? PROVIDERS.VERIFF : null;
        if (!provider) return json(res, 404, { error: "NOT_FOUND" });
        const rawBody = await body(req);
        const result = await service.processWebhook(provider, { rawBody, headers: req.headers, receivedAt: new Date() });
        return json(res, 200, { received: true, duplicate: result.duplicate });
      }
      if (req.method === "GET" && url.pathname === "/metrics") return json(res, 200, await service.getMetrics());
      if (req.method === "GET" && url.pathname.startsWith("/sessions/")) {
        return json(res, 200, await service.getSession(decodeURIComponent(url.pathname.slice("/sessions/".length))));
      }
      return json(res, 404, { error: "NOT_FOUND" });
    } catch (error) {
      const status = error.statusCode || (error.code === "IDV_WEBHOOK_AUTHENTICATION_FAILED" ? 401
        : error.code === "IDV_SESSION_NOT_FOUND" ? 404
          : error.code === "IDV_SECURE_STORE_REQUIRED" ? 503 : 400);
      return json(res, status, publicError(error));
    }
  });
  return { server, module };
}

if (require.main === module) {
  const harness = createHarness();
  const { host, port } = harness.module.config.harness;
  harness.server.listen(port, host, () => {
    console.log(`Standalone IDV harness listening on http://${host}:${port}`);
  });
}

module.exports = { createHarness };
