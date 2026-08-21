"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { DiditAdapter } = require("../providers/diditAdapter");
const { ProviderRouter } = require("../services/providerRouter");
const { IdvService } = require("../services/idvService");
const { UnavailableSecureIdentityStore } = require("../contracts/secureIdentityStore");
const {
  InMemorySessionRepository,
  InMemoryResultRepository,
  InMemoryWebhookReceiptStore,
  InMemoryEventStore,
  SyntheticOnlySecureIdentityStore,
} = require("../stores/inMemoryStores");
const { hmacHex, canonicalJson } = require("../security/webhookSignatures");
const { CANONICAL_STATUSES, CUSTOMER_RESPONSE_ACTIONS } = require("../domain/constants");
const { fixture, QueueHttpClient, response } = require("./helpers");

const NOW = new Date("2030-01-01T00:01:00.000Z");
const SECRET = "didit-synthetic-secret";

function signedDidit(payload) {
  return {
    rawBody: JSON.stringify(payload),
    headers: {
      "x-timestamp": String(payload.timestamp),
      "x-signature-v2": hmacHex(SECRET, canonicalJson(payload)),
    },
    receivedAt: NOW,
  };
}

function buildService({ secureIdentityStore = new SyntheticOnlySecureIdentityStore() } = {}) {
  const create = fixture("didit", "create-session.json");
  const adapter = new DiditAdapter({
    config: { apiKey: "didit-key", workflowId: create.workflow_id, webhookSecret: SECRET },
    httpClient: new QueueHttpClient([response(create)]),
    now: () => NOW,
  });
  const stores = {
    sessionRepository: new InMemorySessionRepository(),
    resultRepository: new InMemoryResultRepository(),
    webhookReceiptStore: new InMemoryWebhookReceiptStore(),
    eventStore: new InMemoryEventStore(),
  };
  return {
    stores,
    identity: secureIdentityStore,
    service: new IdvService({
      adapters: { DIDIT: adapter },
      router: new ProviderRouter(),
      ...stores,
      secureIdentityStore,
      now: () => NOW,
    }),
  };
}

async function start(service, syntheticTestData = true) {
  const result = await service.startVerification({
    provider: "DIDIT", tenantId: "synthetic-tenant", customerContextId: "synthetic-customer",
    country: "GB", documentIssuingCountry: "GB", documentType: "PASSPORT", syntheticTestData,
  });
  await service.markHostedFlowOpened(result.session.internal_idv_session_id);
  return result;
}

test("browser return is recorded but is never authoritative verification success", async () => {
  const { service } = buildService();
  const started = await start(service);
  const returned = await service.recordCustomerReturn(started.session.internal_idv_session_id);
  assert.equal(returned.canonical_status, CANONICAL_STATUSES.STARTED);
  assert.ok(returned.customer_returned_at);
  assert.equal(returned.completed_at, null);
});

test("authenticated webhook is idempotent and terminal result is preserved from older events", async () => {
  const { service, stores } = buildService();
  const started = await start(service);
  const approved = fixture("didit", "approved-webhook.json");
  const first = await service.processWebhook("DIDIT", signedDidit(approved));
  const duplicate = await service.processWebhook("DIDIT", signedDidit(approved));
  assert.equal(first.session.canonical_status, CANONICAL_STATUSES.VERIFIED);
  assert.equal(duplicate.duplicate, true);

  const older = {
    ...approved,
    event_id: "66666666-6666-4666-8666-666666666666",
    created_at: approved.created_at - 20,
    status: "In Progress",
  };
  delete older.decision;
  await service.processWebhook("DIDIT", signedDidit(older));
  const stored = await stores.sessionRepository.get(started.session.internal_idv_session_id);
  assert.equal(stored.canonical_status, CANONICAL_STATUSES.VERIFIED);
  const completed = (await stores.eventStore.list()).filter((event) => event.event_type === "IDV_COMPLETED");
  assert.equal(completed.length, 1);
});

test("customer correction is append-only and does not rewrite provider extraction", async () => {
  const { service, identity } = buildService();
  const started = await start(service);
  await service.processWebhook("DIDIT", signedDidit(fixture("didit", "approved-webhook.json")));
  const context = { synthetic: true };
  const before = await identity.getProviderExtractions(started.session.internal_idv_session_id, context);
  const attribute = before.find((item) => item.attribute_concept === "first_name");
  await service.recordAttributesPresented(started.session.internal_idv_session_id, [attribute.attribute_id]);
  await service.recordCustomerResponse({
    internalIdvSessionId: started.session.internal_idv_session_id,
    attributeId: attribute.attribute_id,
    action: CUSTOMER_RESPONSE_ACTIONS.CORRECTED,
    submittedValue: "SYNTHETIC_CORRECTED_001",
  });
  const after = await identity.getProviderExtractions(started.session.internal_idv_session_id, context);
  const responses = await identity.getCustomerResponses(started.session.internal_idv_session_id, context);
  assert.equal(after.find((item) => item.attribute_id === attribute.attribute_id).attribute_value, "SYNTHETIC_GIVEN_001");
  assert.equal(responses[0].previous_value, "SYNTHETIC_GIVEN_001");
  assert.equal(responses[0].submitted_value, "SYNTHETIC_CORRECTED_001");
});

test("non-synthetic identity result is rejected when no production secure store exists", async () => {
  const { service, stores } = buildService({ secureIdentityStore: new UnavailableSecureIdentityStore() });
  const started = await start(service, false);
  await assert.rejects(
    service.processWebhook("DIDIT", signedDidit(fixture("didit", "approved-webhook.json"))),
    (error) => error.code === "IDV_SECURE_STORE_REQUIRED",
  );
  const stored = await stores.sessionRepository.get(started.session.internal_idv_session_id);
  assert.equal(stored.canonical_status, CANONICAL_STATUSES.STARTED);
  assert.equal(await stores.resultRepository.get(started.session.internal_idv_session_id), null);
});

test("scorecard remains sliceable by provider and includes percentile distributions", async () => {
  const { service } = buildService();
  await start(service);
  const scorecard = await service.getMetrics();
  assert.equal(scorecard.DIDIT.counts.created, 1);
  assert.equal(scorecard.DIDIT.customer_business.hosted_flow_launch_rate, 1);
  assert.ok(Object.hasOwn(scorecard.DIDIT.speed_ms.total_customer_verification_time, "p95"));
  assert.equal(scorecard.VERIFF.counts.created, 0);
});
