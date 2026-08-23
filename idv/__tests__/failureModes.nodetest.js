"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ProviderHttpClient } = require("../providers/httpClient");
const { VeriffAdapter } = require("../providers/veriffAdapter");
const { mapProviderStatus } = require("../providers/normalization");
const { CANONICAL_STATUSES } = require("../domain/constants");
const { fixture, QueueHttpClient, response } = require("./helpers");

test("provider HTTP rate-limit and server errors are sanitized and retryable", async () => {
  const client = new ProviderHttpClient({
    fetchImpl: async () => new Response(JSON.stringify({ sensitive: "must-not-leak" }), { status: 429 }),
  });
  await assert.rejects(
    client.request({ provider: "DIDIT", url: "https://provider.example/session" }),
    (error) => error.code === "IDV_PROVIDER_ERROR"
      && error.retryable === true
      && !error.message.includes("must-not-leak"),
  );
});

test("Didit development HTTP diagnostics contain only allowlisted metadata", async () => {
  const diagnostics = [];
  const client = new ProviderHttpClient({
    diagnosticLogger: (entry) => diagnostics.push(entry),
    fetchImpl: async () => new Response(JSON.stringify({
      code: "invalid_workflow",
      detail: "Workflow 11111111-2222-4333-8444-555555555555 rejected https://private.example user@example.com 5551234567",
      sensitive: "must-not-leak",
    }), { status: 400 }),
  });
  await assert.rejects(client.request({
    provider: "DIDIT",
    url: "https://verification.didit.me/v3/session/?api_key=must-not-leak",
    headers: { "x-api-key": "secret-api-key" },
    diagnostic: {
      enabled: true,
      runtimeMode: "poc",
      workflowId: "safe-workflow-id",
      callbackSupplied: true,
      environment: "sandbox",
    },
  }));
  assert.deepEqual(diagnostics, [{
    event: "idv_provider_http_error",
    provider: "DIDIT",
    http_status: 400,
    response_error_code: "invalid_workflow",
    response_error_message: "Workflow [redacted-identifier] rejected [redacted-url] [redacted-email] [redacted-number]",
    request_url: "https://verification.didit.me/v3/session/",
    workflow_id: "safe-workflow-id",
    callback_supplied: true,
    environment: "sandbox",
  }]);
  assert.equal(JSON.stringify(diagnostics).includes("must-not-leak"), false);
});

test("Didit HTTP diagnostics cannot run in production mode", async () => {
  const diagnostics = [];
  const client = new ProviderHttpClient({
    diagnosticLogger: (entry) => diagnostics.push(entry),
    fetchImpl: async () => new Response(JSON.stringify({ detail: "Unauthorized" }), { status: 401 }),
  });
  await assert.rejects(client.request({
    provider: "DIDIT",
    url: "https://verification.didit.me/v3/session/",
    diagnostic: { enabled: true, runtimeMode: "production", environment: "live" },
  }));
  assert.deepEqual(diagnostics, []);
});

test("provider timeout becomes a retryable provider error", async () => {
  const client = new ProviderHttpClient({
    timeoutMs: 2,
    fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      });
    }),
  });
  await assert.rejects(
    client.request({ provider: "VERIFF", url: "https://provider.example/session" }),
    (error) => error.code === "IDV_PROVIDER_ERROR" && error.retryable === true,
  );
});

test("Veriff rejects an unsigned or incorrectly signed API response", async () => {
  const create = fixture("veriff", "create-session.json");
  const adapter = new VeriffAdapter({
    config: { apiKey: "synthetic-key", sharedSecret: "synthetic-secret" },
    httpClient: new QueueHttpClient([response(create, {
      "x-auth-client": "synthetic-key",
      "x-hmac-signature": "00".repeat(32),
    })]),
  });
  await assert.rejects(
    adapter.createVerificationSession({ internalIdvSessionId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" }),
    (error) => error.code === "IDV_WEBHOOK_AUTHENTICATION_FAILED",
  );
});

test("provider retry, review, failure and expiry statuses stay provider-neutral", () => {
  assert.equal(mapProviderStatus("resubmission_requested"), CANONICAL_STATUSES.REQUIRES_RETRY);
  assert.equal(mapProviderStatus("In Review"), CANONICAL_STATUSES.PROCESSING);
  assert.equal(mapProviderStatus("declined"), CANONICAL_STATUSES.FAILED);
  assert.equal(mapProviderStatus("Kyc Expired"), CANONICAL_STATUSES.EXPIRED);
});
