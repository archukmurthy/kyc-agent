"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  ENTITY_IDS,
  applyPreconfiguredFixtureDecisions,
  resetRuntimeForTest,
  runtimeMetrics,
  startPreingestedEvidenceDemo,
  usePreingestedBettercommsArtifact,
  validateSession,
} = require("../server/preingestedEvidenceDemo.js");
const { AT, DIGEST, IDS } = require("../fixtures/bettercomms-preingested.js");
const {
  CONTRACT_VERSION: CACHE_CONTRACT,
  STORAGE_KEY,
  createCache,
} = require("../browser/preingestedEvidenceSessionStore.js");
const labApi = require("../../api/ubo-control-lab.js");

function current(session) { return session.snapshots.at(-1); }
function basis(session, personEntityId) {
  const assessment = current(session).snapshot.decisionContent.personQualificationAssessments
    .find((item) => item.personEntityId === personEntityId);
  return {
    assessment,
    basis: assessment.basisRecords.find(({ route, dimension }) => route === "EFFECTIVE_INTEREST" && dimension === "ECONOMIC"),
  };
}
function memoryStorage() {
  const values = new Map();
  return { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, String(value)), removeItem: (key) => values.delete(key), values };
}
function invokeApi(operation, payload) {
  return new Promise((resolve, reject) => {
    let statusCode = 200;
    const response = {
      status(code) { statusCode = code; return this; },
      setHeader() { return this; },
      json(body) { resolve({ statusCode, body }); return this; },
    };
    Promise.resolve(labApi({ method: "POST", body: { operation, payload } }, response)).catch(reject);
  });
}

test("Wave 11B2A uses a real handoff then keeps six source facts candidate-before-conclusion", async () => {
  resetRuntimeForTest();
  let session = startPreingestedEvidenceDemo({ sessionId: "candidate-stage" });
  assert.equal(session.stage, "EVIDENCE_REQUIRED");
  assert.equal(session.snapshots.length, 1);
  assert.equal(current(session).journey.customerWorkBundles.length, 1);
  assert.equal(current(session).journey.customerWorkBundles[0].evidenceHandoff.contractVersion, "ubo-external-evidence-handoff-v1");
  assert.equal(current(session).graph.relationships.length, 0);

  session = await usePreingestedBettercommsArtifact({ session });
  assert.equal(session.stage, "SOURCE_FACTS_EXTRACTED");
  assert.equal(session.externalEvidenceHandoff.contractVersion, "ubo-external-evidence-handoff-v1");
  assert.equal(session.extraction.consumerContractVersion, "evidence-consumer-v1");
  assert.match(session.extraction.adapterContractVersion, /^ubo-evidence-platform-extraction-adapter-v1/);
  assert.equal(session.extraction.capabilityResult.outcome.state, "COMPLETE");
  assert.equal(session.extraction.capabilityResult.candidateFacts.length, 6);
  assert.equal(new Set(session.extraction.capabilityResult.candidateFacts.map(({ factId }) => factId)).size, 6);
  const ownershipFacts = session.extraction.capabilityResult.candidateFacts.filter(({ type }) => type === "RELATIONSHIP");
  const officerFacts = session.extraction.capabilityResult.candidateFacts.filter(({ type }) => type === "ENTITY_ATTRIBUTE");
  assert.ok(ownershipFacts.every(({ qualifiers }) => qualifiers.economicInterestConcept === "SHARE_OWNERSHIP"));
  assert.ok(ownershipFacts.every(({ qualifiers }) => qualifiers.currentState === "CURRENT" && qualifiers.sourceEffectiveDate === AT));
  assert.ok(officerFacts.every(({ value }) => value.temporal.state === "unknown"));
  assert.ok(session.extraction.capabilityResult.candidateFacts.every(({ evidenceReferences }) => evidenceReferences.length === 1 && evidenceReferences[0].locator.locators.length === 1));
  assert.equal(session.decisionTargets.candidateParties.length, 10);
  assert.equal(session.decisionTargets.candidateClaims.length, 6);
  assert.equal(session.snapshots.length, 1);
  assert.equal(current(session).graph.relationships.length, 0);
  assert.equal(current(session).journey.finalCaseComplete, false);
  assert.ok(current(session).snapshot.decisionContent.informationNeedsV2.some(({ status }) => status === "OPEN"));
  assert.equal(session.extraction.sourceCount, 1);
  assert.equal(session.extraction.artifact.artifactId, IDS.artifact);
  assert.equal(session.extraction.artifact.digest, DIGEST);
  assert.equal(session.artifactCorrelation.artifactReference.artifactId, IDS.artifact);
  assert.equal("artifactId" in session.externalEvidenceHandoff, false);
  assert.equal(session.extraction.capabilityResult.issues.filter(({ code }) => code === "RELATIONSHIP_PRESERVED_AS_ENTITY_ATTRIBUTE").length, 2);
  assert.ok(session.extraction.capabilityResult.issues.filter(({ code }) => code === "RELATIONSHIP_PRESERVED_AS_ENTITY_ATTRIBUTE").every(({ factScope }) => factScope === "DISCOVERED"));
});

test("explicit fixture decisions create Snapshot B and exact 75/25 fresh-engine results", async () => {
  resetRuntimeForTest();
  let session = startPreingestedEvidenceDemo({ sessionId: "qualification" });
  session = await usePreingestedBettercommsArtifact({ session });
  session = applyPreconfiguredFixtureDecisions({ session });
  assert.equal(session.stage, "SNAPSHOT_B");
  assert.equal(session.snapshots.length, 2);
  assert.equal(session.decisionHistory.snapshots.length, 2);
  assert.equal(current(session).snapshot.decisionContent.history.previousSnapshot.snapshotId, session.snapshots[0].snapshot.snapshotId);
  assert.equal(current(session).snapshot.decisionContent.history.supersessionReason, "NEW_FACTS");
  assert.equal(current(session).graph.nodes.length, 5);
  assert.equal(new Set(current(session).graph.nodes.map(({ entityId }) => entityId)).size, 5);
  assert.equal(current(session).graph.relationships.length, 4);
  assert.ok(current(session).graph.relationships.every(({ relationshipType, dimension }) => relationshipType === "ECONOMIC_OWNERSHIP" && dimension === "ECONOMIC"));

  const mitchell = basis(session, ENTITY_IDS.mitchell);
  assert.equal(mitchell.assessment.routeStatus, "ROUTE_SATISFIED");
  assert.equal(mitchell.basis.assessmentState, "SATISFIED");
  assert.deepEqual(mitchell.basis.recordedCalculation.value, { type: "EXACT", value: "75" });
  assert.equal(mitchell.basis.threshold.comparator, ">");
  assert.equal(mitchell.basis.threshold.value, 25);
  assert.equal(mitchell.basis.recordedCalculation.status, "COMPLETE");

  const lee = basis(session, ENTITY_IDS.lee);
  assert.equal(lee.basis.assessmentState, "NOT_SATISFIED");
  assert.deepEqual(lee.basis.recordedCalculation.value, { type: "EXACT", value: "25" });
  assert.equal(lee.basis.reasonCode, "COMPLETE_RECORDED_VALUE_DOES_NOT_SATISFY_THRESHOLD");
  assert.notEqual(lee.assessment.routeStatus, "ROUTE_SATISFIED");
  assert.equal(current(session).journey.customerWorkBundles.some(({ evidenceHandoff }) => evidenceHandoff), false);
});

test("officer metadata is operative source metadata but never a graph/control/qualification relationship", async () => {
  resetRuntimeForTest();
  let session = startPreingestedEvidenceDemo({ sessionId: "officer-isolation" });
  session = await usePreingestedBettercommsArtifact({ session });
  const officerFacts = session.extraction.capabilityResult.candidateFacts.filter(({ type }) => type === "ENTITY_ATTRIBUTE");
  assert.deepEqual(officerFacts.map(({ value }) => value.relationshipValue.qualitative).sort(), ["Commercial Director", "Managing Director"]);
  session = applyPreconfiguredFixtureDecisions({ session });
  const officerDecisions = session.decisionAudit.filter(({ reasonBasisCode }) => reasonBasisCode === "SOURCE_BACKED_NON_OWNERSHIP_METADATA");
  assert.equal(officerDecisions.length, 2);
  assert.equal(current(session).graph.relationships.some(({ dimension }) => dimension === "CONTROL" || dimension === "VOTING"), false);
  assert.equal(current(session).snapshot.decisionContent.qualificationBasisRecords.some(({ targetRightReferences }) => targetRightReferences?.some((id) => id.includes("000000000005") || id.includes("000000000006"))), false);
});

test("identity review is keyed by exact fact occurrence and does not merge same-name appearances automatically", async () => {
  resetRuntimeForTest();
  let session = startPreingestedEvidenceDemo({ sessionId: "identity" });
  session = await usePreingestedBettercommsArtifact({ session });
  const mitchellTargets = session.decisionTargets.candidateParties.filter(({ party }) => party.name === "Mitchell Fortescue");
  assert.equal(mitchellTargets.length, 2);
  assert.notEqual(mitchellTargets[0].candidatePartyKey, mitchellTargets[1].candidatePartyKey);
  assert.ok(mitchellTargets.every(({ candidatePartyKey }) => /30000000-0000-4000-8000-00000000000[15]:subject$/.test(candidatePartyKey)));
  session = applyPreconfiguredFixtureDecisions({ session });
  const decisions = session.decisionAudit.filter(({ event, entityId }) => event === "IDENTITY_DECISION" && entityId === ENTITY_IDS.mitchell);
  assert.equal(decisions.length, 2);
  assert.ok(decisions.every(({ basisReasonCodes }) => basisReasonCodes.includes("EXACT_ACCEPTED_FIXTURE_SOURCE_OCCURRENCE")));
});

test("same-session replay creates no extra provider call, candidate fact, or graph relationship", async () => {
  resetRuntimeForTest();
  let session = startPreingestedEvidenceDemo({ sessionId: "idempotency" });
  session = await usePreingestedBettercommsArtifact({ session });
  const repeated = await usePreingestedBettercommsArtifact({ session });
  assert.equal(runtimeMetrics().providerCalls, 1);
  assert.deepEqual(repeated, session);
  assert.equal(new Set(repeated.extraction.capabilityResult.candidateFacts.map(({ factId }) => factId)).size, 6);
  const completed = applyPreconfiguredFixtureDecisions({ session: repeated });
  const repeatedReview = applyPreconfiguredFixtureDecisions({ session: completed });
  assert.deepEqual(repeatedReview, completed);
  assert.equal(new Set(current(completed).graph.relationships.map(({ relationshipId }) => relationshipId)).size, 4);
});

test("typed Evidence failures never become NO_DATA or fabricate a graph/UBO", async () => {
  for (const fault of ["ACCESS_DENIED", "ARTIFACT_UNAVAILABLE", "INTEGRITY_FAILURE", "UNSUPPORTED_MEDIA", "NOT_EVALUATED", "IDEMPOTENCY_CONFLICT", "MALFORMED"]) {
    resetRuntimeForTest();
    const initial = startPreingestedEvidenceDemo({ sessionId: `fault-${fault}` });
    const failed = await usePreingestedBettercommsArtifact({ session: initial, fault });
    assert.equal(failed.stage, "EVIDENCE_FAILED", fault);
    assert.notEqual(failed.extraction.capabilityResult.outcome.state, "NO_DATA", fault);
    assert.equal(failed.snapshots.length, 1, fault);
    assert.equal(current(failed).graph.relationships.length, 0, fault);
  }
  resetRuntimeForTest();
  let partial = startPreingestedEvidenceDemo({ sessionId: "fault-PARTIAL" });
  partial = await usePreingestedBettercommsArtifact({ session: partial, fault: "PARTIAL" });
  assert.equal(partial.stage, "SOURCE_FACTS_EXTRACTED");
  assert.equal(partial.extraction.capabilityResult.outcome.state, "PARTIAL");
  assert.equal(current(partial).graph.relationships.length, 0);
});

test("browser-local cache restores Snapshot B and rejects tampering or forbidden payloads", async () => {
  resetRuntimeForTest();
  let session = startPreingestedEvidenceDemo({ sessionId: "cache" });
  session = applyPreconfiguredFixtureDecisions({ session: await usePreingestedBettercommsArtifact({ session }) });
  const storage = memoryStorage();
  const cache = createCache(storage);
  await cache.save(session);
  const restored = await cache.restore();
  assert.equal(restored.error, null);
  assert.equal(restored.record.session.stage, "SNAPSHOT_B");
  assert.equal(restored.record.activeSnapshotId, current(session).snapshot.snapshotId);
  assert.equal(restored.record.session.extraction.artifact.digest, DIGEST);
  assert.equal(CACHE_CONTRACT, "ubo-control-lab-preingested-evidence-cache-v1");
  assert.equal(STORAGE_KEY, "ubo-control-lab.preingested-evidence-sessions.v1");
  const tampered = JSON.parse(storage.getItem(STORAGE_KEY));
  tampered.session.extraction.artifact.digest = "0".repeat(64);
  storage.setItem(STORAGE_KEY, JSON.stringify(tampered));
  assert.match((await cache.restore()).error, /corrupted|unsupported|unsafe/i);
  await assert.rejects(() => cache.save({ ...session, evidenceBytes: "AAEC" }), /Unsafe Lab cache field/);
  assert.doesNotThrow(() => validateSession(session));
  assert.throws(() => validateSession({ ...session, artifactCorrelation: { ...session.artifactCorrelation, artifactReference: { ...session.artifactCorrelation.artifactReference, digest: "0".repeat(64) } } }), /integrity/i);
});

test("Wave 11B2A browser and server boundaries expose no upload or deep Evidence import", () => {
  const root = path.resolve(__dirname, "../..");
  const browser = fs.readFileSync(path.join(root, "ubo-control-lab/browser/lab.js"), "utf8");
  const server = fs.readFileSync(path.join(root, "ubo-control-lab/server/preingestedEvidenceDemo.js"), "utf8");
  assert.match(browser, /Use pre-ingested Bettercomms ownership chart/);
  assert.match(browser, /Qualifying person found/);
  assert.doesNotMatch(browser, /type:\s*["']file["']/);
  assert.match(server, /evidence\/consumer\/v1\/index\.js/);
  assert.doesNotMatch(server, /evidence\/(?:repositories|stages|models|storage|producer|collector)/i);
  assert.doesNotMatch(server, /src\/App\.js|onboarding/i);
  const serializedSession = JSON.stringify(startPreingestedEvidenceDemo({ sessionId: "boundary" }));
  assert.doesNotMatch(serializedSession, /documentContents|evidenceBytes|blobUrl|storageKey/i);
});

test("Lab API exposes the bounded start, interpret, review, and restore operations", async () => {
  resetRuntimeForTest();
  let response = await invokeApi("START_PREINGESTED_EVIDENCE_DEMO", { sessionId: "api" });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.stage, "EVIDENCE_REQUIRED");
  response = await invokeApi("USE_PREINGESTED_BETTERCOMMS_ARTIFACT", { session: response.body });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.stage, "SOURCE_FACTS_EXTRACTED");
  response = await invokeApi("APPLY_PREINGESTED_FIXTURE_DECISIONS", { session: response.body });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.stage, "SNAPSHOT_B");
  response = await invokeApi("VALIDATE_PREINGESTED_EVIDENCE_SESSION", { session: response.body });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.snapshots.length, 2);
});
