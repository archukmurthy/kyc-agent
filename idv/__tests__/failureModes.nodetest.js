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
