"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  DECISION_APPLICATION_CONTRACT_VERSION_V3,
  TEMPORAL_SUPPORT_DATE_BASIS,
  TEMPORAL_SUPPORT_DATE_PRECISION,
  TEMPORAL_SUPPORT_REVIEW_DISPOSITION,
  TEMPORAL_SUPPORT_REVIEW_V1,
  createUboDecisionApplication,
} = require("../index.js");
const { CASE_STATE_INTERNALS } = require("../application/createUboDecisionApplication.js");
const { reconstructDecisionStateV2, verifyDecisionSnapshotV2 } = require("../domain/decisionSnapshotV2.js");
const POLICY = require("../policies/uk-corporate/1.6-rc/policy.json");
const {
  applyPreconfiguredFixtureDecisions,
  startPreingestedEvidenceDemo,
  usePreingestedBettercommsArtifact,
} = require("../../ubo-control-lab/server/preingestedEvidenceDemo.js");

const REVIEW_AT = "2026-09-13T22:00:00.000Z";
const EVALUATION_AT = "2026-09-13T22:01:00.000Z";
const AS_OF = "2026-05-05";
let preparedPromise;

function app() {
  return createUboDecisionApplication({ policyPack: POLICY, contractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V3 });
}

function raw(caseState) {
  return CASE_STATE_INTERNALS.decodeCaseState(caseState, DECISION_APPLICATION_CONTRACT_VERSION_V3);
}

async function prepared() {
  if (!preparedPromise) preparedPromise = (async () => {
    let session = startPreingestedEvidenceDemo({ sessionId: "temporal-support-contract" });
    session = await usePreingestedBettercommsArtifact({ session });
    return applyPreconfiguredFixtureDecisions({ session });
  })();
  return structuredClone(await preparedPromise);
}

function graphFrom(snapshot) {
  return snapshot.decisionContent.sourceOwnershipGraph || snapshot.decisionContent.phaseArtifacts[1].output.graph;
}

function reviewFor(caseState, snapshot, overrides = {}) {
  const state = raw(caseState);
  const certification = state.candidateClaims.filter(({ claimType, attribute }) => claimType === "ENTITY_ATTRIBUTE" && attribute?.startsWith("source_certification_"));
  const byAttribute = new Map(certification.map((claim) => [claim.attribute, claim.claimId]));
  const disposition = overrides.disposition || TEMPORAL_SUPPORT_REVIEW_DISPOSITION.ACCEPT_DATED_SUPPORT;
  return {
    contractVersion: TEMPORAL_SUPPORT_REVIEW_V1,
    reviewId: overrides.reviewId || "temporal-review-1",
    operationKey: overrides.operationKey || "temporal-review-operation-1",
    reviewActor: { actorId: "compliance-reviewer-1", capacity: "COMPLIANCE_ANALYST", trustBasis: "UBO_CONTROL_AUTHORISED_REVIEWER" },
    decidedAt: overrides.decidedAt || REVIEW_AT,
    disposition,
    sourceStatementClaimIds: certification.map(({ claimId }) => claimId).sort(),
    sourceDateClaimId: byAttribute.get("source_certification_date"),
    sourceWordingClaimId: byAttribute.get("source_certification_declaration"),
    sourceScopeClaimId: byAttribute.get("source_certification_scope"),
    coveredRelationshipIds: overrides.coveredRelationshipIds || graphFrom(snapshot).relationships.map(({ relationshipId }) => relationshipId).sort(),
    temporalScope: {
      supportedDate: overrides.supportedDate || AS_OF,
      precision: TEMPORAL_SUPPORT_DATE_PRECISION.DAY,
      basis: TEMPORAL_SUPPORT_DATE_BASIS.CERTIFICATION_DATE_INTERPRETED_AS_DATED_SUPPORT,
      explicitSourceEffectiveDateClaimId: null,
    },
    rationale: overrides.rationale || "Accept the certification as dated support only; do not infer continued ownership.",
    limitations: ["SIGNER_AUTHORITY_UNRESOLVED", "NO_LATER_DATE_CONTINUITY"],
    signerAuthorityStatus: "UNRESOLVED",
    ...(overrides.predecessorReviewId ? { predecessorReviewId: overrides.predecessorReviewId, supersessionReason: overrides.supersessionReason || "REVIEW_CORRECTION" } : {}),
  };
}

function applyReview(session, review = reviewFor(session.caseState, session.snapshots.at(-1).snapshot)) {
  const source = session.snapshots.at(-1).snapshot;
  return app().applyDecisions({
    contractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V3,
    caseState: session.caseState,
    entityRegistrations: [],
    identityDecisions: [],
    claimAdjudications: [],
    sourceDecisionSnapshot: source,
    temporalSupportReviews: [review],
  });
}

function evaluate({ caseState, sourceSnapshot, history, caseContext, resolutionInputs, assessmentDate = AS_OF }) {
  return app().evaluate({
    contractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V3,
    runtimeMode: "LAB",
    caseState,
    caseContext,
    evaluationTime: EVALUATION_AT,
    assessmentDate,
    checkpoint: "CASE_EVENT",
    checkpointReference: { referenceId: `temporal-evaluation:${assessmentDate}` },
    resolutionInputs: { ...(resolutionInputs || {}), evidenceClassifications: [] },
    decisionHistory: history,
    expectedHeadSnapshotId: sourceSnapshot.snapshotId,
    supersessionReason: "REVIEW_DECISION",
  });
}

test("v3 applyDecisions records the complete source-resolved review and preserves UNKNOWN source claims", async () => {
  const session = await prepared();
  assert.deepEqual(Object.keys(app()), ["intake", "applyDecisions", "applyCustomerInput", "evaluate"]);
  assert.equal(Object.keys(require("../index.js")).length, 82);
  const before = raw(session.caseState);
  const applied = applyReview(session);
  assert.equal(applied.temporalSupportReviewResult.contractVersion, "ubo-temporal-support-review-result-v1");
  const after = raw(applied.caseState);
  assert.equal(after.temporalSupportReviews.length, 1);
  const record = after.temporalSupportReviews[0];
  assert.equal(record.contractVersion, TEMPORAL_SUPPORT_REVIEW_V1);
  assert.deepEqual(record.caseReference, { ...session.caseState.caseReference, stateHash: session.caseState.stateHash });
  assert.equal(record.sourceSnapshotReference.snapshotId, session.snapshots.at(-1).snapshot.snapshotId);
  assert.equal(record.policyIdentity.policyHash, session.snapshots.at(-1).snapshot.decisionContent.policy.identity.policyHash);
  assert.deepEqual(record.reviewActor, { actorId: "compliance-reviewer-1", capacity: "COMPLIANCE_ANALYST", trustBasis: "UBO_CONTROL_AUTHORISED_REVIEWER" });
  assert.equal(record.decidedAt, REVIEW_AT);
  assert.equal(record.sourceDate.normalizedDate, AS_OF);
  assert.equal(record.sourceDate.explicitlyStatesRelationshipEffectiveDate, false);
  assert.match(record.sourceWording.text, /true, correct and accurate/);
  assert.equal(record.coveredRelationships.length, 4);
  assert.ok(record.coveredRelationships.every(({ sourceTemporalState, supportingClaimIds, coveredSourceClaimIds }) => sourceTemporalState === "UNKNOWN" && supportingClaimIds.length && coveredSourceClaimIds.length));
  assert.equal(record.signerAuthorityStatus, "UNRESOLVED");
  assert.equal(record.predecessorReviewId, null);
  assert.ok(before.candidateClaims.filter(({ claimType }) => claimType === "RELATIONSHIP").every(({ qualifiers }) => qualifiers.currentState === "UNKNOWN"));
  assert.ok(after.candidateClaims.filter(({ claimType }) => claimType === "RELATIONSHIP").every(({ qualifiers }) => qualifiers.currentState === "UNKNOWN"));
});

test("accepted dated support changes normal evaluation only for the exact assessment date", async () => {
  const session = await prepared();
  const applied = applyReview(session);
  const sourceSnapshot = session.snapshots.at(-1).snapshot;
  const dated = evaluate({ caseState: applied.caseState, sourceSnapshot, history: session.decisionHistory, caseContext: session.caseContext, resolutionInputs: session.resolutionInputs });
  assert.equal(dated.decisionSnapshot.decisionContent.assessmentDate, AS_OF);
  assert.equal(dated.decisionSnapshot.decisionContent.temporalSupportAssessment.stateCounts.SUPPORTED_FOR_ASSESSMENT_DATE, 4);
  assert.ok(dated.ownershipGraphProjection.relationships.every(({ temporalState }) => temporalState === "CURRENT"));
  const mitchell = dated.decisionSnapshot.decisionContent.personQualificationAssessments.find(({ personEntityId }) => personEntityId === "mitchell-fortescue");
  assert.equal(mitchell.basisRecords.find(({ route, dimension }) => route === "EFFECTIVE_INTEREST" && dimension === "ECONOMIC").assessmentState, "SATISFIED");
  assert.equal(dated.decisionSnapshot.decisionContent.evidenceSufficiency.find(({ requirementId }) => requirementId === "UBO-R08").status, "INSUFFICIENT");
  assert.equal(dated.decisionSnapshot.decisionContent.productionAuthorized, false);

  const later = evaluate({ caseState: applied.caseState, sourceSnapshot, history: session.decisionHistory, caseContext: session.caseContext, resolutionInputs: session.resolutionInputs, assessmentDate: "2026-09-13" });
  assert.equal(later.decisionSnapshot.decisionContent.temporalSupportAssessment.stateCounts.OUTSIDE_ACCEPTED_DATE, 4);
  assert.ok(later.ownershipGraphProjection.relationships.every(({ temporalState }) => temporalState === "UNKNOWN"));
  const laterMitchell = later.decisionSnapshot.decisionContent.personQualificationAssessments.find(({ personEntityId }) => personEntityId === "mitchell-fortescue");
  assert.equal(laterMitchell.routeStatus, "INDETERMINATE");
});

test("an audit note or incomplete edge scope cannot produce a positive dated path", async () => {
  const session = await prepared();
  const sourceSnapshot = session.snapshots.at(-1).snapshot;
  const noteOnly = app().evaluate({
    contractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V3,
    runtimeMode: "LAB",
    caseState: session.caseState,
    caseContext: session.caseContext,
    evaluationTime: EVALUATION_AT,
    assessmentDate: AS_OF,
    checkpoint: "CASE_EVENT",
    checkpointReference: { referenceId: "note-only" },
    resolutionInputs: { ...session.resolutionInputs, evidenceClassifications: [], recordingMetadata: { note: "accept dated certification" } },
    decisionHistory: session.decisionHistory,
    expectedHeadSnapshotId: sourceSnapshot.snapshotId,
    supersessionReason: "REVIEW_DECISION",
  });
  assert.equal(noteOnly.decisionSnapshot.decisionContent.temporalSupportAssessment.stateCounts.UNREVIEWED, 4);
  assert.ok(noteOnly.ownershipGraphProjection.relationships.every(({ temporalState }) => temporalState === "UNKNOWN"));

  const mitchellEdge = graphFrom(sourceSnapshot).relationships.find(({ subjectEntityId }) => subjectEntityId === "mitchell-fortescue");
  const partialReview = reviewFor(session.caseState, sourceSnapshot, { coveredRelationshipIds: [mitchellEdge.relationshipId] });
  const partial = applyReview(session, partialReview);
  const evaluated = evaluate({ caseState: partial.caseState, sourceSnapshot, history: session.decisionHistory, caseContext: session.caseContext, resolutionInputs: session.resolutionInputs });
  const mitchell = evaluated.decisionSnapshot.decisionContent.personQualificationAssessments.find(({ personEntityId }) => personEntityId === "mitchell-fortescue");
  assert.equal(mitchell.routeStatus, "INDETERMINATE");
  assert.equal(evaluated.decisionSnapshot.decisionContent.temporalSupportAssessment.stateCounts.SUPPORTED_FOR_ASSESSMENT_DATE, 1);
});

test("stale, tampered, wrong-case and unsupported coverage reviews fail closed", async () => {
  const session = await prepared();
  const sourceSnapshot = session.snapshots.at(-1).snapshot;
  const valid = reviewFor(session.caseState, sourceSnapshot);
  const applied = applyReview(session, valid);
  assert.throws(() => app().applyDecisions({
    contractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V3,
    caseState: applied.caseState,
    entityRegistrations: [], identityDecisions: [], claimAdjudications: [],
    sourceDecisionSnapshot: sourceSnapshot,
    temporalSupportReviews: [reviewFor(applied.caseState, sourceSnapshot, { reviewId: "stale-new", operationKey: "stale-new-op" })],
  }), /stale/i);
  const tampered = structuredClone(sourceSnapshot);
  tampered.decisionContent.caseReference.caseId = "foreign-case";
  assert.throws(() => app().applyDecisions({
    contractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V3,
    caseState: session.caseState,
    entityRegistrations: [], identityDecisions: [], claimAdjudications: [],
    sourceDecisionSnapshot: tampered,
    temporalSupportReviews: [valid],
  }), /hash|mismatch|integrity/i);
  const wrongClaim = structuredClone(valid);
  wrongClaim.sourceDateClaimId = "foreign-case:claim";
  wrongClaim.sourceStatementClaimIds = [...wrongClaim.sourceStatementClaimIds.filter((id) => id !== valid.sourceDateClaimId), wrongClaim.sourceDateClaimId].sort();
  assert.throws(() => applyReview(session, wrongClaim), /unknown claim/i);
  const wrongRelationship = structuredClone(valid);
  wrongRelationship.coveredRelationshipIds = ["graph-rel-foreign"];
  assert.throws(() => applyReview(session, wrongRelationship), /unknown pinned relationship/i);
  const future = reviewFor(session.caseState, sourceSnapshot, { supportedDate: "2027-05-05" });
  assert.throws(() => applyReview(session, future), /resolve from the pinned source date/i);
  assert.throws(() => applyReview(session, { ...valid, currentState: "CURRENT" }), /unsupported field/i);
  assert.throws(() => applyReview(session, { ...valid, certificationWording: "caller rewrite" }), /unsupported field/i);
});

test("operation replay is idempotent and conflicting reuse is rejected", async () => {
  const session = await prepared();
  const review = reviewFor(session.caseState, session.snapshots.at(-1).snapshot);
  const first = applyReview(session, review);
  const replayed = app().applyDecisions({
    contractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V3,
    caseState: first.caseState,
    entityRegistrations: [], identityDecisions: [], claimAdjudications: [],
    sourceDecisionSnapshot: session.snapshots.at(-1).snapshot,
    temporalSupportReviews: [review],
  });
  assert.equal(replayed.caseState.stateHash, first.caseState.stateHash);
  assert.equal(replayed.caseState.caseReference.revision, first.caseState.caseReference.revision);
  const conflicting = { ...review, rationale: "Different input under the same operation key" };
  assert.throws(() => app().applyDecisions({
    contractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V3,
    caseState: first.caseState,
    entityRegistrations: [], identityDecisions: [], claimAdjudications: [],
    sourceDecisionSnapshot: session.snapshots.at(-1).snapshot,
    temporalSupportReviews: [conflicting],
  }), /reused with conflicting input/i);
});

test("conflicting and explicitly superseded reviews remain traceable without latest-wins behavior", async () => {
  const session = await prepared();
  const snapshotB = session.snapshots.at(-1).snapshot;
  const acceptedReview = reviewFor(session.caseState, snapshotB);
  const acceptedState = applyReview(session, acceptedReview);
  const acceptedEvaluation = evaluate({ caseState: acceptedState.caseState, sourceSnapshot: snapshotB, history: session.decisionHistory, caseContext: session.caseContext, resolutionInputs: session.resolutionInputs });

  const decline = reviewFor(acceptedState.caseState, acceptedEvaluation.decisionSnapshot, {
    reviewId: "temporal-review-decline",
    operationKey: "temporal-review-operation-decline",
    disposition: TEMPORAL_SUPPORT_REVIEW_DISPOSITION.DECLINE_DATED_SUPPORT,
  });
  const declinedState = app().applyDecisions({
    contractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V3,
    caseState: acceptedState.caseState,
    entityRegistrations: [], identityDecisions: [], claimAdjudications: [],
    sourceDecisionSnapshot: acceptedEvaluation.decisionSnapshot,
    temporalSupportReviews: [decline],
  });
  const conflicted = evaluate({ caseState: declinedState.caseState, sourceSnapshot: acceptedEvaluation.decisionSnapshot, history: acceptedEvaluation.decisionHistory, caseContext: session.caseContext, resolutionInputs: session.resolutionInputs });
  assert.equal(conflicted.decisionSnapshot.decisionContent.temporalSupportAssessment.stateCounts.CONFLICTED, 4);
  assert.ok(conflicted.ownershipGraphProjection.relationships.every(({ temporalState }) => temporalState === "UNKNOWN"));

  const withdrawal = reviewFor(acceptedState.caseState, acceptedEvaluation.decisionSnapshot, {
    reviewId: "temporal-review-withdrawal",
    operationKey: "temporal-review-operation-withdrawal",
    disposition: TEMPORAL_SUPPORT_REVIEW_DISPOSITION.WITHDRAW_PREVIOUS_REVIEW,
    predecessorReviewId: acceptedReview.reviewId,
    supersessionReason: "SOURCE_AUTHORITY_NOT_ESTABLISHED",
  });
  const withdrawnState = app().applyDecisions({
    contractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V3,
    caseState: acceptedState.caseState,
    entityRegistrations: [], identityDecisions: [], claimAdjudications: [],
    sourceDecisionSnapshot: acceptedEvaluation.decisionSnapshot,
    temporalSupportReviews: [withdrawal],
  });
  const withdrawn = evaluate({ caseState: withdrawnState.caseState, sourceSnapshot: acceptedEvaluation.decisionSnapshot, history: acceptedEvaluation.decisionHistory, caseContext: session.caseContext, resolutionInputs: session.resolutionInputs });
  assert.equal(withdrawn.decisionSnapshot.decisionContent.temporalSupportAssessment.stateCounts.WITHDRAWN, 4);
  assert.deepEqual(withdrawn.decisionSnapshot.decisionContent.temporalSupportAssessment.supersededReviewIds, [acceptedReview.reviewId]);
  assert.equal(raw(withdrawnState.caseState).temporalSupportReviews.length, 2);
});

test("historical Snapshot B verifies and reconstructs without invoking the new evaluator", async () => {
  const session = await prepared();
  const snapshotB = session.snapshots.at(-1).snapshot;
  assert.doesNotThrow(() => verifyDecisionSnapshotV2(snapshotB));
  const reconstructed = reconstructDecisionStateV2(snapshotB);
  assert.equal(reconstructed.snapshotReference.snapshotId, snapshotB.snapshotId);
  assert.equal(reconstructed.recordedDecision.temporalSupportAssessment, undefined);
});
