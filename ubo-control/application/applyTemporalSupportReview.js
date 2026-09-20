"use strict";

const { isDeepStrictEqual } = require("node:util");
const {
  TEMPORAL_SUPPORT_DATE_BASIS,
  TEMPORAL_SUPPORT_REVIEW_DISPOSITION,
  validateTemporalSupportReviewInput,
} = require("../contracts/temporalSupportReview");
const { CLAIM_STATE, CANDIDATE_FACT_TYPE } = require("../contracts/constants");
const { verifyDecisionSnapshotV2 } = require("../domain/decisionSnapshotV2");
const { buildCanonicalOwnershipGraph, TEMPORAL_STATE } = require("../domain/ownershipGraph");
const { recordTemporalSupportReview } = require("../domain/ownershipCase");
const { canonicalizeJson } = require("../policy/canonicalJson");
const { hashArtifact } = require("../internal/phasedArtifact");
const { assertUniqueStrings, cloneData, deepFreeze, fail } = require("../internal/validation");

function snapshotReference(snapshot) {
  return {
    snapshotSchemaVersion: snapshot.snapshotSchemaVersion,
    snapshotId: snapshot.snapshotId,
    decisionContentHash: snapshot.decisionContentHash,
  };
}

function requestHash(review, snapshot) {
  return hashArtifact({ review: cloneData(review), sourceSnapshotReference: snapshotReference(snapshot) });
}

function claimById(caseState, claimId, label) {
  const claim = caseState.candidateClaims.find((candidate) => candidate.claimId === claimId);
  if (!claim) fail(`${label} references unknown claim ${claimId}`);
  if (claim.status !== CLAIM_STATE.OPERATIVE) fail(`${label} claim ${claimId} must be OPERATIVE`);
  return claim;
}

function normalizedSourceDate(claim) {
  const candidates = [claim.value?.normalizedDate, claim.value?.date, claim.value?.text, claim.value];
  return candidates.find((value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) || null;
}

function sourceText(claim) {
  if (typeof claim.value?.text === "string") return claim.value.text;
  if (typeof claim.value === "string") return claim.value;
  return null;
}

function evidenceIdentity(reference) {
  return canonicalizeJson({
    system: reference.system || null,
    namespace: reference.namespace || null,
    referenceType: reference.referenceType,
    referenceId: reference.referenceId,
    digest: reference.integrity?.digest || null,
  });
}

function uniqueData(values) {
  const seen = new Set();
  return values.filter((value) => {
    const key = canonicalizeJson(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sourceStatement(claim) {
  return {
    claimId: claim.claimId,
    attribute: claim.attribute,
    value: cloneData(claim.value),
    originatingCandidateFact: cloneData(claim.originatingCandidateFact),
    evidenceReferences: cloneData(claim.evidenceReferences),
    createdAt: claim.createdAt,
  };
}

function assertSnapshotPins({ caseState, caseStateEnvelope, sourceDecisionSnapshot, loadedPolicyPack }) {
  verifyDecisionSnapshotV2(sourceDecisionSnapshot, { loadedPolicyPack });
  const sourceCase = sourceDecisionSnapshot.decisionContent.caseReference;
  if (sourceCase.caseId !== caseState.caseId
    || sourceCase.revision !== caseState.revision
    || sourceCase.revisionId !== caseState.revisionId
    || !isDeepStrictEqual(sourceCase, caseStateEnvelope.caseReference)) {
    fail("temporal support review source snapshot is stale for the sealed case head");
  }
}

function assertSnapshotGraph(sourceDecisionSnapshot, graph) {
  const pinnedGraph = sourceDecisionSnapshot.decisionContent.sourceOwnershipGraph
    || sourceDecisionSnapshot.decisionContent.phaseArtifacts?.[1]?.output?.graph;
  if (!pinnedGraph || pinnedGraph.graphVersion !== graph.graphVersion) {
    fail("temporal support review source graph does not match the sealed case head");
  }
  if (!isDeepStrictEqual(pinnedGraph.relationships, graph.relationships)) {
    fail("temporal support review source relationship set does not match the pinned snapshot");
  }
}

function resolveRecord({ review, sourceCaseState, caseStateEnvelope, sourceDecisionSnapshot, graph, currentCaseState }) {
  const statements = review.sourceStatementClaimIds.map((claimId) => {
    const claim = claimById(sourceCaseState, claimId, "temporal support sourceStatementClaimIds");
    if (claim.claimType !== CANDIDATE_FACT_TYPE.ENTITY_ATTRIBUTE) {
      fail(`temporal support source statement ${claimId} must be ENTITY_ATTRIBUTE`);
    }
    return claim;
  });
  const statementsById = new Map(statements.map((claim) => [claim.claimId, claim]));
  const dateClaim = statementsById.get(review.sourceDateClaimId);
  const wordingClaim = statementsById.get(review.sourceWordingClaimId);
  const scopeClaim = statementsById.get(review.sourceScopeClaimId);
  const date = normalizedSourceDate(dateClaim);
  const wording = sourceText(wordingClaim);
  const scopeText = sourceText(scopeClaim);
  const scopeFactIds = scopeClaim.value?.coveredFactIds;
  if (!date) fail("temporal support source date claim has no normalized date-only value");
  if (!wording) fail("temporal support source wording claim has no source text");
  if (!scopeText || !Array.isArray(scopeFactIds) || scopeFactIds.length === 0) {
    fail("temporal support source scope claim must identify text and covered source facts");
  }
  if (review.temporalScope.supportedDate !== date) {
    fail("temporal support date must resolve from the pinned source date claim");
  }
  if (review.temporalScope.basis === TEMPORAL_SUPPORT_DATE_BASIS.CERTIFICATION_DATE_INTERPRETED_AS_DATED_SUPPORT
    && !/certification_date/i.test(dateClaim.attribute)) {
    fail("interpreted certification support requires a certification-date source claim");
  }
  if (review.temporalScope.basis === TEMPORAL_SUPPORT_DATE_BASIS.EXPLICIT_SOURCE_EFFECTIVE_DATE
    && review.temporalScope.explicitSourceEffectiveDateClaimId !== review.sourceDateClaimId) {
    fail("explicit source effective-date support must identify the pinned source date claim");
  }
  if (Date.parse(`${date}T23:59:59.999Z`) > Date.parse(review.decidedAt)) {
    fail("temporal support review cannot cover a future source date");
  }

  const statementEvidence = uniqueData(statements.flatMap(({ evidenceReferences }) => evidenceReferences));
  if (statementEvidence.length === 0) fail("temporal support review source statements require Evidence references");
  const statementEvidenceKeys = new Set(statementEvidence.map(evidenceIdentity));
  const graphById = new Map(graph.relationships.map((relationship) => [relationship.relationshipId, relationship]));
  const coveredRelationships = review.coveredRelationshipIds.map((relationshipId) => {
    const relationship = graphById.get(relationshipId);
    if (!relationship) fail(`temporal support review references unknown pinned relationship ${relationshipId}`);
    if (review.disposition === TEMPORAL_SUPPORT_REVIEW_DISPOSITION.ACCEPT_DATED_SUPPORT
      && relationship.temporalState !== TEMPORAL_STATE.UNKNOWN) {
      fail(`accepted dated support may only resolve UNKNOWN source temporal state for ${relationshipId}`);
    }
    const supportingClaims = relationship.supportingClaimIds.map((claimId) => claimById(sourceCaseState, claimId, "temporal support relationship"));
    const coveredSourceClaims = supportingClaims.filter((claim) => scopeFactIds.includes(claim.originatingCandidateFact.candidateFactId));
    if (coveredSourceClaims.length === 0) {
      fail(`temporal support source scope does not cover relationship ${relationshipId}`);
    }
    const evidenceReferences = uniqueData(coveredSourceClaims.flatMap(({ evidenceReferences }) => evidenceReferences));
    if (!evidenceReferences.some((reference) => statementEvidenceKeys.has(evidenceIdentity(reference)))) {
      fail(`temporal support relationship ${relationshipId} is not supported by the referenced source Artifact`);
    }
    return {
      relationshipId,
      subjectEntityId: relationship.subjectEntityId,
      objectEntityId: relationship.objectEntityId,
      relationshipType: relationship.relationshipType,
      dimension: relationship.dimension,
      sourceTemporalState: relationship.temporalState,
      supportingClaimIds: cloneData(relationship.supportingClaimIds),
      coveredSourceClaimIds: coveredSourceClaims.map(({ claimId }) => claimId).sort(),
      evidenceReferences,
    };
  });

  let predecessor = null;
  if (review.predecessorReviewId !== undefined) {
    predecessor = (currentCaseState.temporalSupportReviews || []).find(({ reviewId }) => reviewId === review.predecessorReviewId);
    if (!predecessor) fail(`temporal support predecessor ${review.predecessorReviewId} is unknown`);
    if (!isDeepStrictEqual(
      predecessor.coveredRelationships.map(({ relationshipId }) => relationshipId).sort(),
      coveredRelationships.map(({ relationshipId }) => relationshipId).sort(),
    )) fail("temporal support supersession must address the predecessor relationship scope exactly");
  }

  const sourceSnapshotReference = snapshotReference(sourceDecisionSnapshot);
  return deepFreeze({
    contractVersion: review.contractVersion,
    reviewId: review.reviewId,
    operationKey: review.operationKey,
    requestHash: requestHash(review, sourceDecisionSnapshot),
    caseReference: {
      caseId: sourceCaseState.caseId,
      revision: sourceCaseState.revision,
      revisionId: sourceCaseState.revisionId,
      stateHash: caseStateEnvelope.stateHash,
    },
    sourceSnapshotReference,
    policyIdentity: cloneData(sourceDecisionSnapshot.decisionContent.policy.identity),
    reviewActor: cloneData(review.reviewActor),
    decidedAt: review.decidedAt,
    disposition: review.disposition,
    sourceStatements: statements.map(sourceStatement),
    sourceDate: {
      claimId: dateClaim.claimId,
      attribute: dateClaim.attribute,
      sourceText: sourceText(dateClaim),
      normalizedDate: date,
      precision: review.temporalScope.precision,
      explicitlyStatesRelationshipEffectiveDate: review.temporalScope.basis === TEMPORAL_SUPPORT_DATE_BASIS.EXPLICIT_SOURCE_EFFECTIVE_DATE,
    },
    sourceWording: { claimId: wordingClaim.claimId, text: wording },
    sourceScope: { claimId: scopeClaim.claimId, text: scopeText, coveredFactIds: [...scopeFactIds].sort() },
    sourceArtifactReferences: statementEvidence,
    coveredRelationships,
    temporalScope: cloneData(review.temporalScope),
    rationale: review.rationale,
    limitations: cloneData(review.limitations),
    signerAuthorityStatus: "UNRESOLVED",
    predecessorReviewId: review.predecessorReviewId || null,
    supersessionReason: review.supersessionReason || null,
  });
}

function applyTemporalSupportReviews({ caseState, caseStateEnvelope, sourceDecisionSnapshot, reviews, loadedPolicyPack }) {
  reviews.forEach((review, index) => validateTemporalSupportReviewInput(review, `temporalSupportReviews[${index}]`));
  assertUniqueStrings(reviews.map(({ operationKey }) => operationKey), "temporalSupportReviews operation keys");
  assertUniqueStrings(reviews.map(({ reviewId }) => reviewId), "temporalSupportReviews review IDs");
  verifyDecisionSnapshotV2(sourceDecisionSnapshot, { loadedPolicyPack });

  const existing = caseState.temporalSupportReviews || [];
  const existingByOperation = new Map(existing.map((record) => [record.operationKey, record]));
  const matching = reviews.map((review) => {
    const record = existingByOperation.get(review.operationKey);
    if (!record) return false;
    const hash = requestHash(review, sourceDecisionSnapshot);
    if (record.requestHash !== hash || record.reviewId !== review.reviewId
      || !isDeepStrictEqual(record.sourceSnapshotReference, snapshotReference(sourceDecisionSnapshot))) {
      fail(`temporal support operation key ${review.operationKey} was reused with conflicting input`);
    }
    return true;
  });
  if (matching.some(Boolean)) {
    if (!matching.every(Boolean)) fail("idempotent temporal support replay cannot be combined with a new review");
    return caseState;
  }
  reviews.forEach((review) => {
    if (existing.some(({ reviewId }) => reviewId === review.reviewId)) {
      fail(`temporal support review ID ${review.reviewId} was reused with conflicting input`);
    }
  });

  assertSnapshotPins({ caseState, caseStateEnvelope, sourceDecisionSnapshot, loadedPolicyPack });
  const graph = buildCanonicalOwnershipGraph(caseState);
  assertSnapshotGraph(sourceDecisionSnapshot, graph);
  let current = caseState;
  reviews.forEach((review) => {
    const record = resolveRecord({
      review,
      sourceCaseState: caseState,
      caseStateEnvelope,
      sourceDecisionSnapshot,
      graph,
      currentCaseState: current,
    });
    current = recordTemporalSupportReview(current, record);
  });
  return current;
}

module.exports = { applyTemporalSupportReviews };
