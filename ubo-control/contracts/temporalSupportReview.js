"use strict";

const { validateEvidenceReference } = require("./evidenceReference");
const {
  assertAllowedKeys,
  assertArray,
  assertDataOnly,
  assertEnum,
  assertNonEmptyString,
  assertOptionalNonEmptyString,
  assertPlainObject,
  assertUniqueStrings,
} = require("../internal/validation");

const TEMPORAL_SUPPORT_REVIEW_V1 = "ubo-temporal-support-review-v1";
const TEMPORAL_SUPPORT_REVIEW_RESULT_V1 = "ubo-temporal-support-review-result-v1";
const TEMPORAL_SUPPORT_ASSESSMENT_V1 = "ubo-temporal-support-assessment-v1";

const TEMPORAL_SUPPORT_REVIEW_DISPOSITION = Object.freeze({
  ACCEPT_DATED_SUPPORT: "ACCEPT_DATED_SUPPORT",
  DECLINE_DATED_SUPPORT: "DECLINE_DATED_SUPPORT",
  REQUEST_FURTHER_INFORMATION: "REQUEST_FURTHER_INFORMATION",
  WITHDRAW_PREVIOUS_REVIEW: "WITHDRAW_PREVIOUS_REVIEW",
});

const TEMPORAL_SUPPORT_DATE_PRECISION = Object.freeze({ DAY: "DAY" });
const TEMPORAL_SUPPORT_DATE_BASIS = Object.freeze({
  CERTIFICATION_DATE_INTERPRETED_AS_DATED_SUPPORT: "CERTIFICATION_DATE_INTERPRETED_AS_DATED_SUPPORT",
  EXPLICIT_SOURCE_EFFECTIVE_DATE: "EXPLICIT_SOURCE_EFFECTIVE_DATE",
});

function timestamp(value, path) {
  assertNonEmptyString(value, path);
  if (Number.isNaN(Date.parse(value))) throw new TypeError(`${path} must be an ISO-compatible timestamp`);
}

function dateOnly(value, path) {
  assertNonEmptyString(value, path);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))) {
    throw new TypeError(`${path} must be an ISO date`);
  }
}

function validateActor(value, path) {
  assertPlainObject(value, path);
  assertAllowedKeys(value, ["actorId", "capacity", "trustBasis"], path);
  assertNonEmptyString(value.actorId, `${path}.actorId`);
  assertNonEmptyString(value.capacity, `${path}.capacity`);
  if (value.trustBasis !== "UBO_CONTROL_AUTHORISED_REVIEWER") {
    throw new TypeError(`${path}.trustBasis must be UBO_CONTROL_AUTHORISED_REVIEWER`);
  }
}

function validateTemporalScope(value, path) {
  assertPlainObject(value, path);
  assertAllowedKeys(value, ["supportedDate", "precision", "basis", "explicitSourceEffectiveDateClaimId"], path);
  dateOnly(value.supportedDate, `${path}.supportedDate`);
  assertEnum(value.precision, TEMPORAL_SUPPORT_DATE_PRECISION, `${path}.precision`);
  assertEnum(value.basis, TEMPORAL_SUPPORT_DATE_BASIS, `${path}.basis`);
  if (value.explicitSourceEffectiveDateClaimId !== null) {
    assertNonEmptyString(value.explicitSourceEffectiveDateClaimId, `${path}.explicitSourceEffectiveDateClaimId`);
  }
  if (value.basis === TEMPORAL_SUPPORT_DATE_BASIS.CERTIFICATION_DATE_INTERPRETED_AS_DATED_SUPPORT
    && value.explicitSourceEffectiveDateClaimId !== null) {
    throw new TypeError(`${path} cannot claim an explicit source effective date for an interpreted certification date`);
  }
}

function validateTemporalSupportReviewInput(value, path = "temporalSupportReview") {
  assertPlainObject(value, path);
  assertAllowedKeys(value, [
    "contractVersion", "reviewId", "operationKey", "reviewActor", "decidedAt", "disposition",
    "sourceStatementClaimIds", "sourceDateClaimId", "sourceWordingClaimId", "sourceScopeClaimId",
    "coveredRelationshipIds", "temporalScope", "rationale", "limitations", "signerAuthorityStatus",
    "predecessorReviewId", "supersessionReason",
  ], path);
  if (value.contractVersion !== TEMPORAL_SUPPORT_REVIEW_V1) throw new TypeError(`${path}.contractVersion is unsupported`);
  ["reviewId", "operationKey", "sourceDateClaimId", "sourceWordingClaimId", "sourceScopeClaimId", "rationale"]
    .forEach((field) => assertNonEmptyString(value[field], `${path}.${field}`));
  validateActor(value.reviewActor, `${path}.reviewActor`);
  timestamp(value.decidedAt, `${path}.decidedAt`);
  assertEnum(value.disposition, TEMPORAL_SUPPORT_REVIEW_DISPOSITION, `${path}.disposition`);
  assertUniqueStrings(value.sourceStatementClaimIds, `${path}.sourceStatementClaimIds`);
  assertUniqueStrings(value.coveredRelationshipIds, `${path}.coveredRelationshipIds`);
  if (value.coveredRelationshipIds.length === 0) throw new TypeError(`${path}.coveredRelationshipIds must not be empty`);
  [value.sourceDateClaimId, value.sourceWordingClaimId, value.sourceScopeClaimId].forEach((claimId) => {
    if (!value.sourceStatementClaimIds.includes(claimId)) throw new TypeError(`${path} source claim references must belong to sourceStatementClaimIds`);
  });
  validateTemporalScope(value.temporalScope, `${path}.temporalScope`);
  assertUniqueStrings(value.limitations, `${path}.limitations`);
  if (value.signerAuthorityStatus !== "UNRESOLVED") throw new TypeError(`${path}.signerAuthorityStatus must remain UNRESOLVED in v1`);
  assertOptionalNonEmptyString(value.predecessorReviewId, `${path}.predecessorReviewId`);
  assertOptionalNonEmptyString(value.supersessionReason, `${path}.supersessionReason`);
  if ((value.predecessorReviewId === undefined) !== (value.supersessionReason === undefined)) {
    throw new TypeError(`${path} predecessorReviewId and supersessionReason must be supplied together`);
  }
  if (value.disposition === TEMPORAL_SUPPORT_REVIEW_DISPOSITION.WITHDRAW_PREVIOUS_REVIEW
    && value.predecessorReviewId === undefined) {
    throw new TypeError(`${path} withdrawal requires predecessorReviewId`);
  }
  assertDataOnly(value, path);
  return true;
}

function validateReference(value, path) {
  assertPlainObject(value, path);
  assertAllowedKeys(value, ["caseId", "revision", "revisionId", "stateHash"], path);
  assertNonEmptyString(value.caseId, `${path}.caseId`);
  if (!Number.isSafeInteger(value.revision) || value.revision < 1) throw new TypeError(`${path}.revision is invalid`);
  assertNonEmptyString(value.revisionId, `${path}.revisionId`);
  assertNonEmptyString(value.stateHash, `${path}.stateHash`);
}

function validateSnapshotReference(value, path) {
  assertPlainObject(value, path);
  assertAllowedKeys(value, ["snapshotSchemaVersion", "snapshotId", "decisionContentHash"], path);
  ["snapshotSchemaVersion", "snapshotId", "decisionContentHash"].forEach((field) => assertNonEmptyString(value[field], `${path}.${field}`));
}

function validatePolicyIdentity(value, path) {
  assertPlainObject(value, path);
  assertAllowedKeys(value, ["policyPackId", "policyVersion", "policyHash", "policySchemaVersion"], path);
  Object.keys(value).forEach((field) => assertNonEmptyString(value[field], `${path}.${field}`));
}

function validateSourceStatement(value, path) {
  assertPlainObject(value, path);
  assertAllowedKeys(value, ["claimId", "attribute", "value", "originatingCandidateFact", "evidenceReferences", "createdAt"], path);
  ["claimId", "attribute", "createdAt"].forEach((field) => assertNonEmptyString(value[field], `${path}.${field}`));
  assertDataOnly(value.value, `${path}.value`);
  assertPlainObject(value.originatingCandidateFact, `${path}.originatingCandidateFact`);
  assertArray(value.evidenceReferences, `${path}.evidenceReferences`);
  value.evidenceReferences.forEach((reference, index) => validateEvidenceReference(reference, `${path}.evidenceReferences[${index}]`));
  timestamp(value.createdAt, `${path}.createdAt`);
}

function validateCoveredRelationship(value, path) {
  assertPlainObject(value, path);
  assertAllowedKeys(value, [
    "relationshipId", "subjectEntityId", "objectEntityId", "relationshipType", "dimension",
    "sourceTemporalState", "supportingClaimIds", "coveredSourceClaimIds", "evidenceReferences",
  ], path);
  ["relationshipId", "subjectEntityId", "objectEntityId", "relationshipType", "sourceTemporalState"]
    .forEach((field) => assertNonEmptyString(value[field], `${path}.${field}`));
  if (value.dimension !== null) assertNonEmptyString(value.dimension, `${path}.dimension`);
  assertUniqueStrings(value.supportingClaimIds, `${path}.supportingClaimIds`);
  assertUniqueStrings(value.coveredSourceClaimIds, `${path}.coveredSourceClaimIds`);
  assertArray(value.evidenceReferences, `${path}.evidenceReferences`);
  value.evidenceReferences.forEach((reference, index) => validateEvidenceReference(reference, `${path}.evidenceReferences[${index}]`));
}

function validateTemporalSupportReviewRecord(value, path = "temporalSupportReviewRecord") {
  validateTemporalSupportReviewInput({
    contractVersion: value.contractVersion,
    reviewId: value.reviewId,
    operationKey: value.operationKey,
    reviewActor: value.reviewActor,
    decidedAt: value.decidedAt,
    disposition: value.disposition,
    sourceStatementClaimIds: value.sourceStatements?.map(({ claimId }) => claimId),
    sourceDateClaimId: value.sourceDate?.claimId,
    sourceWordingClaimId: value.sourceWording?.claimId,
    sourceScopeClaimId: value.sourceScope?.claimId,
    coveredRelationshipIds: value.coveredRelationships?.map(({ relationshipId }) => relationshipId),
    temporalScope: value.temporalScope,
    rationale: value.rationale,
    limitations: value.limitations,
    signerAuthorityStatus: value.signerAuthorityStatus,
    ...(value.predecessorReviewId === null ? {} : { predecessorReviewId: value.predecessorReviewId }),
    ...(value.supersessionReason === null ? {} : { supersessionReason: value.supersessionReason }),
  }, path);
  assertAllowedKeys(value, [
    "contractVersion", "reviewId", "operationKey", "requestHash", "caseReference", "sourceSnapshotReference",
    "policyIdentity", "reviewActor", "decidedAt", "disposition", "sourceStatements", "sourceDate",
    "sourceWording", "sourceScope", "sourceArtifactReferences", "coveredRelationships", "temporalScope",
    "rationale", "limitations", "signerAuthorityStatus", "predecessorReviewId", "supersessionReason", "recordedInRevision",
  ], path);
  assertNonEmptyString(value.requestHash, `${path}.requestHash`);
  validateReference(value.caseReference, `${path}.caseReference`);
  validateSnapshotReference(value.sourceSnapshotReference, `${path}.sourceSnapshotReference`);
  validatePolicyIdentity(value.policyIdentity, `${path}.policyIdentity`);
  assertArray(value.sourceStatements, `${path}.sourceStatements`);
  value.sourceStatements.forEach((statement, index) => validateSourceStatement(statement, `${path}.sourceStatements[${index}]`));
  assertPlainObject(value.sourceDate, `${path}.sourceDate`);
  assertDataOnly(value.sourceDate, `${path}.sourceDate`);
  assertPlainObject(value.sourceWording, `${path}.sourceWording`);
  assertDataOnly(value.sourceWording, `${path}.sourceWording`);
  assertPlainObject(value.sourceScope, `${path}.sourceScope`);
  assertDataOnly(value.sourceScope, `${path}.sourceScope`);
  assertArray(value.sourceArtifactReferences, `${path}.sourceArtifactReferences`);
  value.sourceArtifactReferences.forEach((reference, index) => validateEvidenceReference(reference, `${path}.sourceArtifactReferences[${index}]`));
  assertArray(value.coveredRelationships, `${path}.coveredRelationships`);
  value.coveredRelationships.forEach((relationship, index) => validateCoveredRelationship(relationship, `${path}.coveredRelationships[${index}]`));
  if (value.predecessorReviewId !== null) assertNonEmptyString(value.predecessorReviewId, `${path}.predecessorReviewId`);
  if (value.supersessionReason !== null) assertNonEmptyString(value.supersessionReason, `${path}.supersessionReason`);
  if (!Number.isSafeInteger(value.recordedInRevision) || value.recordedInRevision < 1) throw new TypeError(`${path}.recordedInRevision is invalid`);
  assertDataOnly(value, path);
  return true;
}

module.exports = {
  TEMPORAL_SUPPORT_ASSESSMENT_V1,
  TEMPORAL_SUPPORT_DATE_BASIS,
  TEMPORAL_SUPPORT_DATE_PRECISION,
  TEMPORAL_SUPPORT_REVIEW_DISPOSITION,
  TEMPORAL_SUPPORT_REVIEW_RESULT_V1,
  TEMPORAL_SUPPORT_REVIEW_V1,
  validateTemporalSupportReviewInput,
  validateTemporalSupportReviewRecord,
};
