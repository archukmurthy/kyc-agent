"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ProviderRouter } = require("../services/providerRouter");
const { assertNoRawEvidence } = require("../domain/canonical");
const { verifyDiditWebhook, verifyVeriffWebhook, hmacHex, canonicalJson } = require("../security/webhookSignatures");

test("routing defaults to Didit but honors the most specific configured override", () => {
  const router = new ProviderRouter({
    overrides: [
      { country: "DE", provider: "VERIFF" },
      { tenantId: "tenant-a", country: "DE", documentType: "PASSPORT", provider: "DIDIT" },
    ],
  });
  assert.equal(router.select({ country: "GB" }), "DIDIT");
  assert.equal(router.select({ country: "DE" }), "VERIFF");
  assert.equal(router.select({ tenantId: "tenant-a", country: "DE", documentType: "PASSPORT" }), "DIDIT");
});

test("raw identity and biometric artifacts cannot cross the persistence guard", () => {
  assert.throws(() => assertNoRawEvidence({ document_image: "base64" }), /forbidden/);
  assert.throws(() => assertNoRawEvidence({ safe: Buffer.from("not-an-image") }), /binary evidence/);
  assert.throws(() => assertNoRawEvidence({ value: "data:image/png;base64,AAAA" }), /Embedded raw evidence/);
  assert.doesNotThrow(() => assertNoRawEvidence({ document_type: "PASSPORT", external_custody: true }));
});

test("Didit rejects stale signed webhook replay", () => {
  const payload = { timestamp: 1000, session_id: "synthetic", status: "Approved", webhook_type: "status.updated" };
  assert.throws(() => verifyDiditWebhook({
    rawBody: JSON.stringify(payload), parsedBody: payload,
    headers: { "x-timestamp": "1000", "x-signature-v2": hmacHex("secret", canonicalJson(payload)) },
    secret: "secret", now: new Date("2030-01-01T00:00:00.000Z"),
  }), /replay window/);
});

test("Didit simple signature authenticates only the envelope", () => {
  const payload = { timestamp: 1893456000, session_id: "synthetic", status: "Approved", webhook_type: "status.updated" };
  const simple = `${payload.timestamp}:${payload.session_id}:${payload.status}:${payload.webhook_type}`;
  const result = verifyDiditWebhook({
    rawBody: JSON.stringify(payload), parsedBody: payload,
    headers: { "x-timestamp": String(payload.timestamp), "x-signature-simple": hmacHex("secret", simple) },
    secret: "secret", now: new Date("2030-01-01T00:00:00.000Z"),
  });
  assert.equal(result.decisionPayloadTrusted, false);
});

test("Veriff requires both client identity and raw-body HMAC", () => {
  const rawBody = JSON.stringify({ status: "success", verification: { id: "synthetic" } });
  assert.doesNotThrow(() => verifyVeriffWebhook({
    rawBody,
    headers: { "x-auth-client": "key", "x-hmac-signature": hmacHex("secret", rawBody) },
    apiKey: "key", sharedSecret: "secret",
  }));
  assert.throws(() => verifyVeriffWebhook({
    rawBody,
    headers: { "x-auth-client": "wrong", "x-hmac-signature": hmacHex("secret", rawBody) },
    apiKey: "key", sharedSecret: "secret",
  }), /client identifier/);
});
