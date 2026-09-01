"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const committed = require("../fixtures/journeys.json");
const { buildJourneyFixtures } = require("../fixtures/buildJourneyFixtures");
const { assertJourneyInputs } = require("../UboJourney");

test("committed journey fixtures exactly equal deterministic public-contract fixture output", () => {
  assert.deepEqual(buildJourneyFixtures(), committed);
});

test("catalogue is exactly CUI01–CUI17 and CUI17 has before/after host states", () => {
  assert.deepEqual(committed.fixtures.map(({ id }) => id), Array.from({ length: 17 }, (_, index) => `CUI${String(index + 1).padStart(2, "0")}`));
  assert.deepEqual(committed.fixtures.find(({ id }) => id === "CUI17").states.map(({ id }) => id), ["before", "after"]);
});

test("every fixture consumes matching public journey and plan contracts and optional public graph", () => {
  committed.fixtures.flatMap(({ states }) => states).forEach(({ journey, plan, graph }) => {
    assert.doesNotThrow(() => assertJourneyInputs(journey, plan, graph));
    assert.equal(journey.decision.snapshotHash, plan.snapshotHash);
  });
});

test("customer fixtures contain stable action, intent, work-item, bundle and canonical graph references", () => {
  committed.fixtures.flatMap(({ states }) => states).filter(({ plan }) => plan.state === "CUSTOMER_RESOLUTION").forEach(({ journey, plan }) => {
    plan.recommendedWave.customerBundles.forEach((bundle) => {
      assert.match(bundle.bundleId, /^customer-resolution-bundle:/);
      assert.ok(bundle.recommendedCustomerActions.every(({ actionId }) => actionId.startsWith("resolution-action:")));
      const matching = journey.customerWorkItems.filter((item) => item.informationNeedIds.some((id) => bundle.informationNeedIds.includes(id)));
      assert.ok(matching.length > 0);
      assert.ok(matching.every((item) => item.workItemId.startsWith("customer-work-item:") && item.actionIntentIds.every((id) => id.startsWith("action-intent:"))));
      assert.ok(bundle.graphLinks.entityIds.every((id) => typeof id === "string"));
    });
  });
});

test("presentation-only fixture catalogue contains no files, bytes, providers or operative facts", () => {
  const publicJourneyInputs = committed.fixtures.flatMap(({ states }) => states.map(({ journey, plan }) => ({ journey, plan })));
  const serialized = JSON.stringify(publicJourneyInputs);
  assert.doesNotMatch(serialized, /base64|rawBytes|fileContent|DiscoveryService|ExtractionService|EvidencePlatform|Companies House/i);
  assert.doesNotMatch(serialized, /decisionContent|policyPack|candidateFacts|operativeClaims/i);
});
