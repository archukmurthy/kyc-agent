"use strict";

const {
  TEMPORAL_SUPPORT_ASSESSMENT_V1,
  TEMPORAL_SUPPORT_REVIEW_DISPOSITION,
} = require("../contracts/temporalSupportReview");
const { TEMPORAL_STATE } = require("./ownershipGraph");
const { hashArtifact } = require("../internal/phasedArtifact");
const { cloneData, deepFreeze, fail } = require("../internal/validation");

const TEMPORAL_SUPPORT_RELATIONSHIP_STATE = Object.freeze({
  SOURCE_CURRENT: "SOURCE_CURRENT",
  SOURCE_CEASED: "SOURCE_CEASED",
  UNREVIEWED: "UNREVIEWED",
  ASSESSMENT_DATE_REQUIRED: "ASSESSMENT_DATE_REQUIRED",
  SUPPORTED_FOR_ASSESSMENT_DATE: "SUPPORTED_FOR_ASSESSMENT_DATE",
  OUTSIDE_ACCEPTED_DATE: "OUTSIDE_ACCEPTED_DATE",
  DECLINED: "DECLINED",
  FURTHER_INFORMATION_REQUIRED: "FURTHER_INFORMATION_REQUIRED",
  WITHDRAWN: "WITHDRAWN",
  CONFLICTED: "CONFLICTED",
});

function validDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`));
}

function activeReviews(records) {
  const superseded = new Set(records.map(({ predecessorReviewId }) => predecessorReviewId).filter(Boolean));
  return {
    active: records.filter(({ reviewId }) => !superseded.has(reviewId)),
    supersededReviewIds: [...superseded].sort(),
  };
}

function relationshipAssessment(relationship, active, assessmentDate) {
  const reviews = active.filter(({ coveredRelationships }) => coveredRelationships
    .some(({ relationshipId }) => relationshipId === relationship.relationshipId));
  const atDate = reviews.filter(({ temporalScope }) => temporalScope.supportedDate === assessmentDate);
  const accepted = atDate.filter(({ disposition }) => disposition === TEMPORAL_SUPPORT_REVIEW_DISPOSITION.ACCEPT_DATED_SUPPORT);
  const declined = atDate.filter(({ disposition }) => disposition === TEMPORAL_SUPPORT_REVIEW_DISPOSITION.DECLINE_DATED_SUPPORT);
  const requested = atDate.filter(({ disposition }) => disposition === TEMPORAL_SUPPORT_REVIEW_DISPOSITION.REQUEST_FURTHER_INFORMATION);
  const withdrawn = atDate.filter(({ disposition }) => disposition === TEMPORAL_SUPPORT_REVIEW_DISPOSITION.WITHDRAW_PREVIOUS_REVIEW);
  let state;
  let derivedTemporalState = relationship.temporalState;
  if (relationship.temporalState === TEMPORAL_STATE.CURRENT) state = TEMPORAL_SUPPORT_RELATIONSHIP_STATE.SOURCE_CURRENT;
  else if (relationship.temporalState === TEMPORAL_STATE.CEASED) state = TEMPORAL_SUPPORT_RELATIONSHIP_STATE.SOURCE_CEASED;
  else if (!assessmentDate) state = TEMPORAL_SUPPORT_RELATIONSHIP_STATE.ASSESSMENT_DATE_REQUIRED;
  else if (accepted.length > 0 && declined.length + requested.length + withdrawn.length > 0) state = TEMPORAL_SUPPORT_RELATIONSHIP_STATE.CONFLICTED;
  else if (declined.length > 0) state = TEMPORAL_SUPPORT_RELATIONSHIP_STATE.DECLINED;
  else if (requested.length > 0) state = TEMPORAL_SUPPORT_RELATIONSHIP_STATE.FURTHER_INFORMATION_REQUIRED;
  else if (withdrawn.length > 0) state = TEMPORAL_SUPPORT_RELATIONSHIP_STATE.WITHDRAWN;
  else if (accepted.length > 0) {
    state = TEMPORAL_SUPPORT_RELATIONSHIP_STATE.SUPPORTED_FOR_ASSESSMENT_DATE;
    derivedTemporalState = TEMPORAL_STATE.CURRENT;
  } else if (reviews.length > 0) state = TEMPORAL_SUPPORT_RELATIONSHIP_STATE.OUTSIDE_ACCEPTED_DATE;
  else state = TEMPORAL_SUPPORT_RELATIONSHIP_STATE.UNREVIEWED;
  return {
    relationshipId: relationship.relationshipId,
    sourceTemporalState: relationship.temporalState,
    derivedTemporalState,
    state,
    requestedAssessmentDate: assessmentDate || null,
    applicableReviewIds: atDate.map(({ reviewId }) => reviewId).sort(),
    otherDatedReviewIds: reviews.filter(({ temporalScope }) => temporalScope.supportedDate !== assessmentDate).map(({ reviewId }) => reviewId).sort(),
    sourceClaimIds: cloneData(relationship.supportingClaimIds),
    limitations: [...new Set(reviews.flatMap(({ limitations }) => limitations))].sort(),
    signerAuthorityStatus: reviews.length > 0 ? "UNRESOLVED" : "NOT_ASSESSED",
  };
}

function deriveTemporalSupportAssessment({ caseState, sourceGraph, assessmentDate, evaluationTime }) {
  if (assessmentDate !== undefined && !validDate(assessmentDate)) fail("assessmentDate must be an ISO date");
  if (!evaluationTime || Number.isNaN(Date.parse(evaluationTime))) fail("temporal support assessment requires evaluationTime");
  const records = cloneData(caseState.temporalSupportReviews || []);
  const { active, supersededReviewIds } = activeReviews(records);
  const relationshipAssessments = sourceGraph.relationships.map((relationship) => relationshipAssessment(
    relationship,
    active,
    assessmentDate,
  ));
  const stateCounts = Object.fromEntries(Object.values(TEMPORAL_SUPPORT_RELATIONSHIP_STATE)
    .map((state) => [state, relationshipAssessments.filter((item) => item.state === state).length]));
  const applied = stateCounts.SUPPORTED_FOR_ASSESSMENT_DATE;
  const conflicted = stateCounts.CONFLICTED;
  const semantic = {
    contractVersion: TEMPORAL_SUPPORT_ASSESSMENT_V1,
    caseReference: { caseId: caseState.caseId, revision: caseState.revision, revisionId: caseState.revisionId },
    sourceGraphVersion: sourceGraph.graphVersion,
    requestedAssessmentDate: assessmentDate || null,
    evaluatedAt: evaluationTime,
    activeReviewIds: active.map(({ reviewId }) => reviewId).sort(),
    supersededReviewIds,
    relationshipAssessments,
    stateCounts,
    overallState: conflicted > 0 ? "CONFLICTED"
      : applied === 0 ? "NO_APPLICABLE_DATED_SUPPORT"
        : applied === sourceGraph.relationships.filter(({ temporalState }) => temporalState === TEMPORAL_STATE.UNKNOWN).length
          ? "APPLIED_TO_ALL_UNKNOWN_RELATIONSHIPS" : "PARTIALLY_APPLIED",
    sourceFactsMutated: false,
    productionAuthorized: false,
  };
  const assessmentHash = hashArtifact(semantic);
  const assessment = deepFreeze(cloneData({
    ...semantic,
    assessmentId: `${TEMPORAL_SUPPORT_ASSESSMENT_V1}:${assessmentHash.slice(7, 39)}`,
    assessmentHash,
  }));
  const byRelationship = new Map(relationshipAssessments.map((item) => [item.relationshipId, item]));
  const relationships = sourceGraph.relationships.map((relationship) => ({
    ...cloneData(relationship),
    temporalState: byRelationship.get(relationship.relationshipId).derivedTemporalState,
  }));
  const graphSemantic = {
    graphAlgorithm: sourceGraph.graphAlgorithm,
    sourceGraphVersion: sourceGraph.graphVersion,
    temporalSupportAssessmentId: assessment.assessmentId,
    sourceCase: cloneData(sourceGraph.sourceCase),
    nodes: cloneData(sourceGraph.nodes),
    relationships,
  };
  const graphVersion = `${sourceGraph.graphAlgorithm}:${hashArtifact(graphSemantic).slice(7)}`;
  const graph = deepFreeze(cloneData({
    graphAlgorithm: sourceGraph.graphAlgorithm,
    graphVersion,
    sourceCase: cloneData(sourceGraph.sourceCase),
    nodes: cloneData(sourceGraph.nodes),
    relationships,
  }));
  return deepFreeze({ sourceGraph: cloneData(sourceGraph), graph, assessment });
}

module.exports = {
  TEMPORAL_SUPPORT_RELATIONSHIP_STATE,
  deriveTemporalSupportAssessment,
};
