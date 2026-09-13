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
const { DIGEST, IDS } = require("../fixtures/bettercomms-preingested.js");
const { assessSignedOwnershipAttestation } = require("../fixtures/sourceAttestation.js");
const {
  createFullSourceGraphView,
  createTargetRelevantGraphView,
} = require("../browser/preingestedEvidenceGraphViews.js");
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
  assert.ok(ownershipFacts.every(({ qualifiers }) => qualifiers.currentState === "UNKNOWN" && qualifiers.sourceEffectiveDate === null));
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

test("explicit fixture decisions keep source arithmetic but current qualification indeterminate", async () => {
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
  assert.equal(mitchell.assessment.routeStatus, "INDETERMINATE");
  assert.equal(mitchell.basis.assessmentState, "INDETERMINATE");
  assert.equal(mitchell.basis.recordedCalculation.status, "UNRESOLVED");
  assert.deepEqual(mitchell.basis.orderedPathReferences[0].reasons, ["UNKNOWN_TEMPORAL_STATE"]);
  assert.equal(mitchell.basis.threshold.comparator, ">");
  assert.equal(mitchell.basis.threshold.value, 25);
  assert.equal(mitchell.basis.relationshipReferences.length, 2);
  assert.ok(mitchell.basis.relationshipReferences.every(({ supportingClaimIds, evidenceReferences }) => supportingClaimIds.length === 1 && evidenceReferences.length === 1));
  assert.equal(mitchell.basis.operativeClaimReferences.length, 2);
  assert.equal(mitchell.basis.evidenceReferences.length, 2);
  assert.ok(current(session).graph.relationships.every(({ support }) => support.claimCount === 1 && support.evidenceReferences.length === 1));

  const lee = basis(session, ENTITY_IDS.lee);
  assert.equal(lee.basis.assessmentState, "INDETERMINATE");
  assert.equal(lee.basis.recordedCalculation.status, "UNRESOLVED");
  assert.deepEqual(lee.basis.orderedPathReferences[0].reasons, ["UNKNOWN_TEMPORAL_STATE"]);
  assert.equal(lee.assessment.routeStatus, "INDETERMINATE");
  assert.deepEqual(current(session).graph.relationships.map(({ measurement }) => measurement.value).sort((a, b) => a - b), [25, 75, 100, 100]);
  assert.ok(current(session).snapshot.decisionContent.informationNeedsV2.some(({ concept, status }) => concept === "RELATIONSHIP_CURRENTNESS" && status === "OPEN"));
  const r08 = current(session).snapshot.decisionContent.evidenceSufficiency.find(({ requirementId }) => requirementId === "UBO-R08");
  assert.equal(r08.status, "INSUFFICIENT");
  assert.deepEqual(r08.distinctIndependentSourceIds, []);
  assert.equal(session.sourceAttestation.sourceCountContribution, 0);
  assert.equal(current(session).journey.customerWorkBundles.some(({ evidenceHandoff }) => evidenceHandoff), false);
});

test("explicit signed scoped as-at attestation establishes a separate currentness assertion", () => {
  const factIds = ["fact-owner-holdco", "fact-holdco-target"];
  const ownershipFacts = factIds.map((factId) => ({ factId, relationship: "ECONOMIC_OWNERSHIP", currentState: "UNKNOWN" }));
  const result = assessSignedOwnershipAttestation({
    artifactId: "artifact-chart",
    materialFactIds: factIds,
    attestation: {
      signatureText: "Signed: A. Reviewer",
      signerName: "A. Reviewer",
      signerCapacity: "Director",
      signedDate: "2026-09-07",
      asAtDate: "2026-09-07",
      declarationText: "I confirm that the ownership structure shown is accurate as at 7 September 2026.",
      scope: { coveredFactIds: factIds, description: "All ownership relationships shown on this chart" },
      locator: { artifactId: "artifact-chart", pageStart: 1, region: { label: "signature-block" } },
    },
  });
  assert.equal(result.case, "CASE_A");
  assert.equal(result.relationshipCurrentness, "CURRENT");
  assert.deepEqual(result.currentnessAssertion.signer, { name: "A. Reviewer", capacity: "Director" });
  assert.equal(result.currentnessAssertion.asAtDate, "2026-09-07");
  assert.deepEqual(result.currentnessAssertion.coveredFactIds, [...factIds].sort());
  assert.equal(result.currentnessAssertion.evidenceReference.locator.region.label, "signature-block");
  assert.equal(result.sourceCountContribution, 0);
  assert.ok(result.currentnessAssertion.assertionId.startsWith("source-currentness:"));
  assert.ok(ownershipFacts.every(({ currentState }) => currentState === "UNKNOWN"));
});

test("signature date without attestation scope never establishes currentness", () => {
  const result = assessSignedOwnershipAttestation({
    artifactId: "artifact-chart",
    materialFactIds: ["fact-1"],
    attestation: { signatureText: "Signed", signerName: "A. Reviewer", signerCapacity: "Director", signedDate: "2026-09-07", asAtDate: "2026-09-07", declarationText: null, scope: null, locator: { pageStart: 1 } },
  });
  assert.equal(result.case, "CASE_B");
  assert.equal(result.relationshipCurrentness, "UNKNOWN");
  assert.equal(result.currentnessAssertion, null);
  assert.ok(result.missingFields.includes("declarationText"));
  assert.deepEqual(result.uncoveredFactIds, ["fact-1"]);
});

test("attestation must cover every material path edge", () => {
  const result = assessSignedOwnershipAttestation({
    artifactId: "artifact-chart",
    materialFactIds: ["fact-owner-holdco", "fact-holdco-target"],
    attestation: { signatureText: "Signed", signerName: "A. Reviewer", signerCapacity: "Director", signedDate: "2026-09-07", asAtDate: "2026-09-07", declarationText: "Ownership shown is accurate as at this date.", scope: { coveredFactIds: ["fact-owner-holdco"] }, locator: { pageStart: 1 } },
  });
  assert.equal(result.relationshipCurrentness, "UNKNOWN");
  assert.deepEqual(result.uncoveredFactIds, ["fact-holdco-target"]);
});

test("actual Bettercomms fixture has no attestation text or locator and fails closed as Case B", async () => {
  let session = startPreingestedEvidenceDemo({ sessionId: "attestation-case-b" });
  session = await usePreingestedBettercommsArtifact({ session });
  assert.equal(session.sourceAttestation.case, "CASE_B");
  assert.deepEqual(session.sourceAttestation.metadata, { signatureText: null, signerName: null, signerCapacity: null, signedDate: null, asAtDate: null, declarationText: null, scope: null, locator: null });
  assert.equal(session.sourceAttestation.currentnessAssertion, null);
  assert.equal(session.sourceAttestation.relationshipCurrentness, "UNKNOWN");
  assert.equal(session.extraction.sourceCount, 1);
});

test("target graph uses reverse reachability while full source view retains the sibling", async () => {
  let session = startPreingestedEvidenceDemo({ sessionId: "graph-views" });
  session = applyPreconfiguredFixtureDecisions({ session: await usePreingestedBettercommsArtifact({ session }) });
  const canonical = current(session).graph;
  const canonicalBefore = JSON.stringify(canonical);
  const target = createTargetRelevantGraphView(canonical, session.entityDirectory);
  const full = createFullSourceGraphView(canonical, session.entityDirectory);
  assert.deepEqual(target.nodes.map(({ entityId }) => entityId).sort(), ["better-comms-voip-ltd", "better-holdco", "lee-taylor", "mitchell-fortescue"]);
  assert.equal(target.nodes.some(({ entityId }) => entityId === "better-network-services"), false);
  assert.equal(target.relationships.length, 3);
  assert.ok(target.relationships.some(({ subjectEntityId, objectEntityId }) => subjectEntityId === "mitchell-fortescue" && objectEntityId === "better-holdco"));
  assert.ok(target.relationships.some(({ subjectEntityId, objectEntityId }) => subjectEntityId === "better-holdco" && objectEntityId === "better-comms-voip-ltd"));
  assert.equal(full.nodes.length, 5);
  assert.equal(new Set(full.nodes.map(({ entityId }) => entityId)).size, 5);
  assert.equal(full.relationships.length, 4);
  assert.ok(full.relationships.some(({ subjectEntityId, objectEntityId, presentationLabel }) => subjectEntityId === "better-holdco" && objectEntityId === "better-comms-voip-ltd" && presentationLabel === "Better Holdco owns 100% of Better Comms VOIP Ltd"));
  assert.ok(full.relationships.some(({ subjectEntityId, objectEntityId, presentationLabel }) => subjectEntityId === "better-holdco" && objectEntityId === "better-network-services" && presentationLabel === "Better Holdco owns 100% of Better Network Services"));
  assert.deepEqual(target.snapshotReference, canonical.snapshotReference);
  assert.deepEqual(full.snapshotReference, canonical.snapshotReference);
  assert.deepEqual(target.informationNeeds, canonical.informationNeeds);
  assert.deepEqual(full.informationNeeds, canonical.informationNeeds);
  assert.equal(target.presentationView.sourceProjectionHash, canonical.projectionHash);
  assert.equal(full.presentationView.sourceProjectionHash, canonical.projectionHash);
  assert.equal("projectionHash" in target, false);
  assert.equal(JSON.stringify(canonical), canonicalBefore);
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
  assert.equal(cache.hasSaved(), false);
  await cache.save(session);
  assert.equal(cache.hasSaved(), true);
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
  assert.match(browser, /Current qualification is indeterminate/);
  assert.match(browser, /Show all relationships from source document/);
  assert.match(browser, /preingestedEvidenceCache\?\.hasSaved\(\).*PREINGESTED_EVIDENCE/);
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
