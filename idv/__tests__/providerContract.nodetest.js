"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { DiditAdapter } = require("../providers/diditAdapter");
const { VeriffAdapter } = require("../providers/veriffAdapter");
const { hmacHex, canonicalJson } = require("../security/webhookSignatures");
const { CANONICAL_STATUSES } = require("../domain/constants");
const { fixture, QueueHttpClient, response } = require("./helpers");
const { assertProviderContractShape, assertCanonicalProviderResult } = require("../testing/providerContractAssertions");

const NOW = new Date("2030-01-01T00:01:00.000Z");
const DIDIT_SECRET = "didit-synthetic-secret";
const VERIFF_KEY = "veriff-synthetic-api-key";
const VERIFF_SECRET = "veriff-synthetic-shared-secret";

function veriffResponse(data) {
  const raw = JSON.stringify(data);
  return response(data, {
    "x-auth-client": VERIFF_KEY,
    "x-hmac-signature": hmacHex(VERIFF_SECRET, raw),
  });
}

function cases() {
  const diditCreate = fixture("didit", "create-session.json");
  const diditWebhook = fixture("didit", "approved-webhook.json");
  const veriffCreate = fixture("veriff", "create-session.json");
  const veriffWebhook = fixture("veriff", "approved-webhook.json");
  return [
    {
      name: "Didit",
      provider: "DIDIT",
      hostedUrl: diditCreate.url,
      sessionId: diditCreate.session_id,
      adapter: () => new DiditAdapter({
        config: { apiKey: "didit-key", workflowId: diditCreate.workflow_id, webhookSecret: DIDIT_SECRET },
        httpClient: new QueueHttpClient([response(diditCreate)]), now: () => NOW,
      }),
      webhook: () => {
        const rawBody = JSON.stringify(diditWebhook);
        return {
          rawBody,
          headers: {
            "x-timestamp": String(diditWebhook.timestamp),
            "x-signature-v2": hmacHex(DIDIT_SECRET, canonicalJson(diditWebhook)),
          },
          receivedAt: NOW,
        };
      },
    },
    {
      name: "Veriff",
      provider: "VERIFF",
      hostedUrl: veriffCreate.verification.url,
      sessionId: veriffCreate.verification.id,
      adapter: () => new VeriffAdapter({
        config: { apiKey: VERIFF_KEY, sharedSecret: VERIFF_SECRET },
        httpClient: new QueueHttpClient([veriffResponse(veriffCreate)]), now: () => NOW,
      }),
      webhook: () => {
        const rawBody = JSON.stringify(veriffWebhook);
        return {
          rawBody,
          headers: {
            "x-auth-client": VERIFF_KEY,
            "x-hmac-signature": hmacHex(VERIFF_SECRET, rawBody),
          },
          receivedAt: NOW,
        };
      },
    },
  ];
}

for (const contract of cases()) {
  test(`${contract.name} implements the complete provider-neutral contract`, () => {
    const adapter = contract.adapter();
    assertProviderContractShape(adapter);
  });

  test(`${contract.name} creates a canonical hosted session without persisting its token`, async () => {
    const adapter = contract.adapter();
    const session = await adapter.createVerificationSession({
      internalIdvSessionId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      tenantId: "synthetic-tenant",
      callbackUrl: "https://poc.example/return",
    });
    assert.equal(session.provider, contract.provider);
    assert.equal(session.provider_session_id, contract.sessionId);
    assert.equal(adapter.getHostedVerificationUrl(session), contract.hostedUrl);
    assert.equal(session.session_token, undefined);
  });

  test(`${contract.name} authenticates and normalizes the same canonical concepts`, async () => {
    const adapter = contract.adapter();
    const event = await adapter.handleWebhook(contract.webhook());
    assertCanonicalProviderResult(event.result, contract.provider);
    assert.equal(event.provider, contract.provider);
    assert.equal(event.providerSessionId, contract.sessionId);
    assert.equal(event.canonicalStatus, CANONICAL_STATUSES.VERIFIED);
    assert.equal(event.result.provider_decision.canonical_status, CANONICAL_STATUSES.VERIFIED);
    assert.ok(event.result.identity_attributes.some((item) => item.attribute_concept === "first_name"));
    assert.ok(event.result.verification_observations.some((item) => item.observation_type === "FACE_MATCH"));
    assert.equal(event.result.external_evidence_references[0].external_custody, true);
    assert.equal(event.result.external_evidence_references[0].content_locally_available, false);
    assert.equal(JSON.stringify(event.result).includes("synthetic-token-never-persisted"), false);
  });
}

test("Veriff signs session creation over the exact JSON body", async () => {
  const create = fixture("veriff", "create-session.json");
  const http = new QueueHttpClient([veriffResponse(create)]);
  const adapter = new VeriffAdapter({ config: { apiKey: VERIFF_KEY, sharedSecret: VERIFF_SECRET }, httpClient: http, now: () => NOW });
  await adapter.createVerificationSession({ internalIdvSessionId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" });
  assert.equal(http.requests[0].headers["x-hmac-signature"], hmacHex(VERIFF_SECRET, http.requests[0].body));
});
