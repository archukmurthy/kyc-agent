"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  ENTITY_IDS,
  applyDatedCertificationReview,
  applyPreconfiguredFixtureDecisions,
  resetRuntimeForTest,
  runtimeMetrics,
  startPreingestedEvidenceDemo,
  usePreingestedBettercommsArtifact,
  validateSession,
} = require("../server/preingestedEvidenceDemo.js");
const syntheticFixture = require("../fixtures/bettercomms-preingested.js");
const {
  CERTIFICATION_DATE,
  DIGEST,
  DIMENSIONS,
  FACT_IDS,
  HISTORICAL_LEADS,
  IDS,
  SIZE_BYTES,
  WINDOWS,
  buildBettercommsServiceResult,
  sourceCertification,
} = require("../fixtures/bettercomms-source-reviewed.js");
const { assessSignedOwnershipAttestation } = require("../fixtures/sourceAttestation.js");
const {
  createFullSourceGraphView,
  createTargetRelevantGraphView,
} = require("../browser/preingestedEvidenceGraphViews.js");
const { computeLayout } = require("../../ubo-control-ui/OwnershipGraph.js");
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

test("recovered source manifest preserves exact bytes identity and bounded original-coordinate review annotations", () => {
  assert.equal(DIGEST, "37ec3f984451c0a0bf1ac0024e9790070d7cb3a90dc25696052e0f1583fa2f6f");
  assert.equal(SIZE_BYTES, 582094);
  assert.deepEqual(DIMENSIONS, { width: 841, height: 595 });
  Object.values(WINDOWS).forEach(({ x, y, width, height }) => {
    assert.ok(x >= 0 && y >= 0 && width > 0 && height > 0);
    assert.ok(x + width <= DIMENSIONS.width);
    assert.ok(y + height <= DIMENSIONS.height);
  });
  const result = buildBettercommsServiceResult({ operationKey: "source-manifest", correlation: { requestId: "source-manifest" } });
  assert.equal(result.evidence.artifacts[0].sizeBytes, SIZE_BYTES);
  assert.equal(result.evidence.integrity.artifacts[0].calculatedSha256, DIGEST);
  assert.equal(result.evidence.artifacts[0].capturedAt, undefined);
  assert.equal(result.providerCalled, false);
  assert.equal(result.responsiveFacts.length + result.discoveredFacts.length, 14);
  assert.ok(result.discoveredFacts.every((fact) => fact.supportingArtifactIds.length === 1 && fact.supportingArtifactIds[0] === IDS.artifact));
});

test("manual source reading preserves certification wording and limitations without inventing authority or an as-at date", () => {
  const certification = sourceCertification();
  assert.equal(certification.signerName, "Alex Palmer");
  assert.equal(certification.signerPostnominal, "ACA");
  assert.equal(certification.signerCapacity, "Management Accountant");
  assert.deepEqual(certification.professionalReference, { label: "ACA No", value: "5246593" });
  assert.equal(certification.certificationDate, "2026-05-05");
  assert.equal(certification.declarationText, "I hereby certify that the company structure chart is true, correct and accurate");
  assert.equal(certification.declarationScope, "Depicted company structure chart");
  assert.equal(certification.signatureMark.present, true);
  assert.equal(certification.signatureMark.authenticated, false);
  assert.equal(certification.signerIdentityVerified, false);
  assert.equal(certification.signerAuthorityVerified, false);
  assert.equal(certification.professionalStatusVerification, "NOT_VERIFIED");
  assert.equal(certification.explicitOwnershipAsAtDate, null);
  assert.doesNotMatch(certification.declarationText, /complete|current today|as at/i);
});

test("source-reviewed provenance never masquerades as the synthetic regression or reported historical Evidence records", () => {
  const syntheticRequest = { operationKey: "synthetic-contract", correlation: { requestId: "synthetic-contract" } };
  const frozenBefore = JSON.stringify(syntheticFixture.buildBettercommsServiceResult(syntheticRequest));
  const reviewed = buildBettercommsServiceResult({ operationKey: "provenance", correlation: { requestId: "provenance" } });
  assert.notEqual(IDS.artifact, syntheticFixture.IDS.artifact);
  assert.notEqual(DIGEST, syntheticFixture.DIGEST);
  assert.notEqual(IDS.artifact, HISTORICAL_LEADS.artifactId);
  assert.notEqual(IDS.operation, HISTORICAL_LEADS.laterOperationId);
  assert.equal(HISTORICAL_LEADS.status, "REPORTED_NOT_REVALIDATED");
  assert.match(HISTORICAL_LEADS.contextIssue, /TESCO PLC.*Bettercomms tenant\/context authority is not established/);
  assert.equal(JSON.stringify(syntheticFixture.buildBettercommsServiceResult(syntheticRequest)), frozenBefore);
  assert.equal(reviewed.extractionRun.provider, "manual-review-fixture");
  assert.equal(reviewed.providerCalled, false);
});

test("source-backed reviewed fixture uses a real handoff then keeps fourteen source facts candidate-before-conclusion", async () => {
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
  assert.equal(session.extraction.capabilityResult.candidateFacts.length, 14);
  assert.equal(new Set(session.extraction.capabilityResult.candidateFacts.map(({ factId }) => factId)).size, 14);
  const ownershipFacts = session.extraction.capabilityResult.candidateFacts.filter(({ type }) => type === "RELATIONSHIP");
  const officerFacts = session.extraction.capabilityResult.candidateFacts.filter(({ attribute }) => attribute === "officer_relationship");
  const certificationFacts = session.extraction.capabilityResult.candidateFacts.filter(({ attribute }) => attribute?.startsWith("source_certification_"));
  assert.equal(ownershipFacts.length, 4);
  assert.equal(officerFacts.length, 2);
  assert.equal(certificationFacts.length, 8);
  assert.ok(ownershipFacts.every(({ qualifiers }) => qualifiers.economicInterestConcept === "SHARE_OWNERSHIP"));
  assert.ok(ownershipFacts.every(({ qualifiers }) => qualifiers.currentState === "UNKNOWN" && qualifiers.sourceEffectiveDate === null));
  assert.ok(officerFacts.every(({ value }) => value.temporal.state === "unknown"));
  assert.ok(session.extraction.capabilityResult.candidateFacts.every(({ evidenceReferences }) => evidenceReferences.length === 1 && evidenceReferences[0].locator.locators.length === 1));
  assert.equal(session.decisionTargets.candidateParties.length, 18);
  assert.equal(session.decisionTargets.candidateClaims.length, 14);
  assert.equal(session.snapshots.length, 1);
  assert.equal(current(session).graph.relationships.length, 0);
  assert.equal(current(session).journey.finalCaseComplete, false);
  assert.ok(current(session).snapshot.decisionContent.informationNeedsV2.some(({ status }) => status === "OPEN"));
  assert.equal(session.extraction.sourceCount, 1);
  assert.equal(session.extraction.artifact.artifactId, IDS.artifact);
  assert.equal(session.extraction.artifact.digest, DIGEST);
  assert.equal(session.extraction.artifact.sizeBytes, SIZE_BYTES);
  assert.equal(session.extraction.artifact.capturedAt, null);
  assert.equal(session.artifactCorrelation.artifactReference.artifactId, IDS.artifact);
  assert.equal(session.extraction.capabilityResult.operationEvidenceReferences[0].integrity.digest, DIGEST);
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
  assert.ok(current(session).graph.relationships.every(({ temporalState }) => temporalState === "UNKNOWN"));
  assert.equal(session.sourceAttestation.sourceDateSemantics.certificationDate, "2026-05-05");
  assert.equal(session.sourceAttestation.sourceDateSemantics.explicitOwnershipAsAtDate, null);
  assert.equal(session.sourceAttestation.sourceDateSemantics.historicalCapturedAt, null);
  assert.notEqual(session.sourceAttestation.sourceDateSemantics.fixtureReviewRecordedAt.slice(0, 10), "2026-05-05");
  assert.equal(session.sourceAttestation.sourceDateSemantics.freshnessState, "NOT_ESTABLISHED");
  assert.ok(session.decisionAudit.some(({ event, status }) => event === "SOURCE_CERTIFICATION_REVIEW_RECORDED" && status === "RECORDED_NOT_APPLIED_TO_RELATIONSHIP_CURRENTNESS"));
  assert.equal(current(session).journey.finalCaseComplete, false);
  assert.equal(current(session).journey.customerWorkBundles.some(({ evidenceHandoff }) => evidenceHandoff), false);
});

test("explicit Compliance review records dated support through Decision Application v3 without rewriting source Facts", async () => {
  resetRuntimeForTest();
  let session = startPreingestedEvidenceDemo({ sessionId: "dated-review" });
  session = applyPreconfiguredFixtureDecisions({ session: await usePreingestedBettercommsArtifact({ session }) });
  const snapshotB = current(session).snapshot;
  const sourceState = JSON.parse(Buffer.from(session.caseState.statePayload, "base64url").toString("utf8"));
  const sourceClaims = sourceState.candidateClaims.filter(({ claimType }) => claimType === "RELATIONSHIP");
  assert.ok(sourceClaims.every(({ qualifiers }) => qualifiers.currentState === "UNKNOWN"));

  session = applyDatedCertificationReview({ session });
  assert.equal(session.stage, "DATED_REVIEW_APPLIED");
  assert.equal(session.snapshots.length, 3);
  assert.equal(session.decisionHistory.snapshots.length, 3);
  assert.equal(current(session).snapshot.decisionContent.history.previousSnapshot.snapshotId, snapshotB.snapshotId);
  assert.equal(current(session).snapshot.decisionContent.history.supersessionReason, "REVIEW_DECISION");
  assert.equal(session.temporalReview.assessmentDate, "2026-05-05");
  assert.notEqual(session.temporalReview.decidedAt.slice(0, 10), session.temporalReview.assessmentDate);
  assert.equal(session.temporalReview.assessment.contractVersion, "ubo-temporal-support-assessment-v1");
  assert.equal(session.temporalReview.assessment.stateCounts.SUPPORTED_FOR_ASSESSMENT_DATE, 4);
  assert.ok(current(session).graph.relationships.every(({ temporalState }) => temporalState === "CURRENT"));

  const reviewedState = JSON.parse(Buffer.from(session.caseState.statePayload, "base64url").toString("utf8"));
  assert.equal(reviewedState.temporalSupportReviews.length, 1);
  assert.equal(reviewedState.temporalSupportReviews[0].sourceWording.text, "I hereby certify that the company structure chart is true, correct and accurate");
  assert.equal(reviewedState.temporalSupportReviews[0].sourceDate.explicitlyStatesRelationshipEffectiveDate, false);
  assert.equal(reviewedState.temporalSupportReviews[0].signerAuthorityStatus, "UNRESOLVED");
  assert.ok(reviewedState.candidateClaims.filter(({ claimType }) => claimType === "RELATIONSHIP")
    .every(({ qualifiers }) => qualifiers.currentState === "UNKNOWN"));

  const mitchell = basis(session, ENTITY_IDS.mitchell);
  const lee = basis(session, ENTITY_IDS.lee);
  assert.equal(mitchell.basis.recordedCalculation.status, "COMPLETE");
  assert.equal(mitchell.basis.assessmentState, "SATISFIED");
  assert.equal(lee.basis.recordedCalculation.status, "COMPLETE");
  assert.equal(lee.basis.assessmentState, "NOT_SATISFIED");
  assert.equal(current(session).snapshot.decisionContent.evidenceSufficiency.find(({ requirementId }) => requirementId === "UBO-R08").status, "INSUFFICIENT");
  assert.equal(current(session).journey.finalCaseComplete, false);
  assert.equal(current(session).snapshot.decisionContent.productionAuthorized, false);
  assert.equal(current(session).journey.customerWorkBundles.length, 0);
  assert.equal(current(session).journey.finishLine.systemActionsRemaining > 0, true);
  const target = createTargetRelevantGraphView(current(session).graph, session.entityDirectory);
  const full = createFullSourceGraphView(current(session).graph, session.entityDirectory);
  assert.equal(target.nodes.length, 4);
  assert.equal(target.relationships.length, 3);
  assert.equal(full.nodes.length, 5);
  assert.equal(full.relationships.length, 4);
  const cache = createCache(memoryStorage());
  await cache.save(session);
  const restored = await cache.restore();
  assert.equal(restored.record.session.stage, "DATED_REVIEW_APPLIED");
  assert.equal(restored.record.activeSnapshotId, current(session).snapshot.snapshotId);
  assert.equal(restored.record.session.temporalReview.reviewId, session.temporalReview.reviewId);
  assert.deepEqual(applyDatedCertificationReview({ session }), session);
  assert.doesNotThrow(() => validateSession(session));
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

test("recovered source certification reaches UBO separately and remains fail-closed without an explicit ownership as-at date", async () => {
  let session = startPreingestedEvidenceDemo({ sessionId: "attestation-case-b" });
  session = await usePreingestedBettercommsArtifact({ session });
  assert.equal(session.sourceAttestation.case, "CASE_B");
  assert.equal(session.sourceAttestation.metadata.signatureText, "Visible signature-like mark");
  assert.equal(session.sourceAttestation.metadata.signatureAuthenticated, false);
  assert.equal(session.sourceAttestation.metadata.signerName, "Alex Palmer");
  assert.equal(session.sourceAttestation.metadata.signerPostnominal, "ACA");
  assert.equal(session.sourceAttestation.metadata.signerCapacity, "Management Accountant");
  assert.deepEqual(session.sourceAttestation.metadata.professionalReference, { label: "ACA No", value: "5246593" });
  assert.equal(session.sourceAttestation.metadata.signedDate, CERTIFICATION_DATE);
  assert.equal(session.sourceAttestation.metadata.asAtDate, null);
  assert.equal(session.sourceAttestation.metadata.declarationText, "I hereby certify that the company structure chart is true, correct and accurate");
  assert.equal(session.sourceAttestation.metadata.locator.metadata.qualification, "NEW_MANUAL_REVIEW_ANNOTATION_NOT_HISTORICAL_R3_LOCATOR");
  assert.equal(session.sourceAttestation.currentnessAssertion, null);
  assert.equal(session.sourceAttestation.relationshipCurrentness, "UNKNOWN");
  assert.equal(session.sourceAttestation.reviewInterpretation.status, "RECORDED_NOT_APPLIED_TO_RELATIONSHIP_CURRENTNESS");
  assert.deepEqual(session.sourceAttestation.reviewInterpretation.coveredRelationshipFactIds, [FACT_IDS.mitchellOwnership, FACT_IDS.leeOwnership, FACT_IDS.commsOwnership, FACT_IDS.networkOwnership]);
  assert.ok(session.sourceAttestation.reviewInterpretation.unresolved.includes("SIGNER_AUTHORITY_NOT_VERIFIED"));
  assert.equal(session.sourceAttestation.sourceDateSemantics.freshnessState, "NOT_ESTABLISHED");
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
  assert.equal(full.presentationView.layoutDepthOverrides["better-network-services"], 0);
  const normalizedFull = {
    ...full,
    subject: full.nodes.find(({ entityId }) => entityId === full.subjectEntityId),
    relationships: full.relationships.map((relationship) => ({ ...relationship, sourceEntityId: relationship.subjectEntityId, targetEntityId: relationship.objectEntityId })),
  };
  const layout = computeLayout(normalizedFull);
  assert.equal(layout.depths.get("better-network-services"), layout.depths.get("better-comms-voip-ltd"));
  assert.equal(layout.depths.get("better-holdco"), 1);
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
  const officerFacts = session.extraction.capabilityResult.candidateFacts.filter(({ attribute }) => attribute === "officer_relationship");
  assert.deepEqual(officerFacts.map(({ value }) => value.relationshipValue.qualitative).sort(), ["Commercial Director", "Managing Director"]);
  session = applyPreconfiguredFixtureDecisions({ session });
  const metadataDecisions = session.decisionAudit.filter(({ reasonBasisCode }) => reasonBasisCode === "SOURCE_BACKED_NON_OWNERSHIP_METADATA");
  assert.equal(metadataDecisions.length, 10);
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
  assert.ok(mitchellTargets.every(({ candidatePartyKey }) => /91000000-0000-4000-8000-00000000000[15]:subject$/.test(candidatePartyKey)));
  session = applyPreconfiguredFixtureDecisions({ session });
  const decisions = session.decisionAudit.filter(({ event, entityId }) => event === "IDENTITY_DECISION" && entityId === ENTITY_IDS.mitchell);
  assert.equal(decisions.length, 2);
  assert.ok(decisions.every(({ basisReasonCodes }) => basisReasonCodes.includes("EXACT_ACCEPTED_FIXTURE_SOURCE_OCCURRENCE")));
});

test("same-session replay creates no provider call, duplicate reviewed fact, or graph relationship", async () => {
  resetRuntimeForTest();
  let session = startPreingestedEvidenceDemo({ sessionId: "idempotency" });
  session = await usePreingestedBettercommsArtifact({ session });
  const repeated = await usePreingestedBettercommsArtifact({ session });
  assert.equal(runtimeMetrics().providerCalls, 0);
  assert.equal(runtimeMetrics().reviewedFixtureRuns, 1);
  assert.deepEqual(repeated, session);
  assert.equal(new Set(repeated.extraction.capabilityResult.candidateFacts.map(({ factId }) => factId)).size, 14);
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
  assert.equal(restored.record.session.sourceIdentity.sourceFixtureId, "PR60-RECOVERED-SOURCE-REVIEW-V1");
  assert.equal(restored.record.session.sourceIdentity.persistedHistoricalIdentity, false);
  assert.equal(restored.record.session.sourceAttestation.sourceDateSemantics.freshnessState, "NOT_ESTABLISHED");
  assert.equal(CACHE_CONTRACT, "ubo-control-lab-preingested-evidence-cache-v1");
  assert.equal(STORAGE_KEY, "ubo-control-lab.preingested-evidence-sessions.v1");
  const tampered = JSON.parse(storage.getItem(STORAGE_KEY));
  tampered.session.extraction.artifact.digest = "0".repeat(64);
  storage.setItem(STORAGE_KEY, JSON.stringify(tampered));
  assert.match((await cache.restore()).error, /corrupted|unsupported|unsafe/i);
  await assert.rejects(() => cache.save({ ...session, evidenceBytes: "AAEC" }), /Unsafe Lab cache field/);
  assert.doesNotThrow(() => validateSession(session));
  assert.throws(() => validateSession({ ...session, artifactCorrelation: { ...session.artifactCorrelation, artifactReference: { ...session.artifactCorrelation.artifactReference, digest: "0".repeat(64) } } }), /integrity/i);
  assert.throws(() => validateSession({ ...session, artifactCorrelation: { ...session.artifactCorrelation, artifactReference: { ...session.artifactCorrelation.artifactReference, artifactId: HISTORICAL_LEADS.artifactId, digest: DIGEST } } }), /integrity/i);
});

test("Wave 11B2A browser and server boundaries expose no upload or deep Evidence import", () => {
  const root = path.resolve(__dirname, "../..");
  const browser = fs.readFileSync(path.join(root, "ubo-control-lab/browser/lab.js"), "utf8");
  const server = fs.readFileSync(path.join(root, "ubo-control-lab/server/preingestedEvidenceDemo.js"), "utf8");
  assert.match(browser, /Use source-backed reviewed Bettercomms fixture/);
  assert.match(browser, /REAL SOURCE IMAGE — MANUALLY REVIEWED FIXTURE/);
  assert.match(browser, /Historical Evidence-store linkage not yet revalidated/);
  assert.match(browser, /No fresh automated interpretation performed/);
  assert.match(browser, /Current qualification is indeterminate/);
  assert.match(browser, /Review dated certification/);
  assert.match(browser, /The source Facts remain UNKNOWN\. Date-scoped applicability comes only from the separately recorded reviewer decision/);
  assert.match(browser, /Show all relationships from source document/);
  assert.match(browser, /preingestedEvidenceCache\?\.hasSaved\(\).*PREINGESTED_EVIDENCE/);
  assert.doesNotMatch(browser, /type:\s*["']file["']/);
  assert.match(server, /evidence\/consumer\/v1\/index\.js/);
  assert.doesNotMatch(server, /evidence\/(?:repositories|stages|models|storage|producer|collector)/i);
  assert.doesNotMatch(server, /src\/App\.js|onboarding/i);
  const serializedSession = JSON.stringify(startPreingestedEvidenceDemo({ sessionId: "boundary" }));
  assert.doesNotMatch(serializedSession, /documentContents|evidenceBytes|blobUrl|storageKey/i);
  assert.doesNotMatch(serializedSession, /iVBORw0KGgo/);
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
  response = await invokeApi("APPLY_DATED_CERTIFICATION_REVIEW", { session: response.body });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.stage, "DATED_REVIEW_APPLIED");
  response = await invokeApi("VALIDATE_PREINGESTED_EVIDENCE_SESSION", { session: response.body });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.snapshots.length, 3);
});
