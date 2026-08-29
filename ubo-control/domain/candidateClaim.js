"use strict";

const { validateCandidateFact } = require("../contracts/candidateFact");
const { validateCandidatePartyReference } = require("../contracts/candidatePartyReference");
const { CLAIM_STATE, CANDIDATE_FACT_TYPE, RELATIONSHIP_TYPE } = require("../contracts/constants");
const { validateEvidenceReference } = require("../contracts/evidenceReference");
const { validatePercentageValue } = require("../contracts/percentageValue");
const {
  assertAllowedKeys,
  assertArray,
  assertDataOnly,
  assertEnum,
  assertNonEmptyString,
  assertOptionalNonEmptyString,
  assertPlainObject,
  cloneData,
  deepFreeze,
  fail,
} = require("../internal/validation");

function validateTimestamp(value, path) {
  assertNonEmptyString(value, path);
  if (Number.isNaN(Date.parse(value))) fail(`${path} must be an ISO-compatible timestamp`);
}

function validateEndpoint(endpoint, path) {
  assertPlainObject(endpoint, path);
  assertAllowedKeys(endpoint, ["candidatePartyKey", "party"], path);
  assertNonEmptyString(endpoint.candidatePartyKey, `${path}.candidatePartyKey`);
  validateCandidatePartyReference(endpoint.party, `${path}.party`);
}

function validateOrigin(origin, path) {
  assertPlainObject(origin, path);
  assertAllowedKeys(origin, ["operationId", "capabilityRequestId", "candidateFactId", "candidateFactIndex"], path);
  assertNonEmptyString(origin.operationId, `${path}.operationId`);
  assertNonEmptyString(origin.capabilityRequestId, `${path}.capabilityRequestId`);
  assertOptionalNonEmptyString(origin.candidateFactId, `${path}.candidateFactId`);
  if (!Number.isSafeInteger(origin.candidateFactIndex) || origin.candidateFactIndex < 0) {
    fail(`${path}.candidateFactIndex must be a non-negative safe integer`);
  }
}

function validateCandidateClaim(claim, path = "candidateClaim") {
  assertPlainObject(claim, path);
  assertAllowedKeys(claim, [
    "claimId",
    "claimType",
    "originatingCandidateFact",
    "subject",
    "object",
    "relationship",
    "measurement",
    "qualifiers",
    "attribute",
    "value",
    "evidenceReferences",
    "status",
    "createdAt",
    "createdInRevision",
    "lastAdjudicationDecisionId",
  ], path);
  assertNonEmptyString(claim.claimId, `${path}.claimId`);
  assertEnum(claim.claimType, CANDIDATE_FACT_TYPE, `${path}.claimType`);
  validateOrigin(claim.originatingCandidateFact, `${path}.originatingCandidateFact`);
  validateEndpoint(claim.subject, `${path}.subject`);
  assertArray(claim.evidenceReferences, `${path}.evidenceReferences`);
  claim.evidenceReferences.forEach((reference, index) => {
    validateEvidenceReference(reference, `${path}.evidenceReferences[${index}]`);
  });
  assertEnum(claim.status, CLAIM_STATE, `${path}.status`);
  validateTimestamp(claim.createdAt, `${path}.createdAt`);
  if (!Number.isSafeInteger(claim.createdInRevision) || claim.createdInRevision < 1) {
    fail(`${path}.createdInRevision must be a positive safe integer`);
  }
  assertOptionalNonEmptyString(claim.lastAdjudicationDecisionId, `${path}.lastAdjudicationDecisionId`);

  if (claim.claimType === CANDIDATE_FACT_TYPE.RELATIONSHIP) {
    validateEndpoint(claim.object, `${path}.object`);
    assertEnum(claim.relationship, RELATIONSHIP_TYPE, `${path}.relationship`);
    if (claim.measurement !== undefined) validatePercentageValue(claim.measurement, `${path}.measurement`);
    if (claim.qualifiers !== undefined) {
      assertPlainObject(claim.qualifiers, `${path}.qualifiers`);
      assertDataOnly(claim.qualifiers, `${path}.qualifiers`);
    }
    if (
      claim.subject.party.entityId &&
      claim.object.party.entityId &&
      claim.subject.party.entityId === claim.object.party.entityId
    ) {
      fail(`${path} cannot assert a relationship from a canonical entity to itself`);
    }
  } else {
    assertNonEmptyString(claim.attribute, `${path}.attribute`);
    if (!Object.prototype.hasOwnProperty.call(claim, "value")) fail(`${path}.value is required`);
    assertDataOnly(claim.value, `${path}.value`);
  }

  assertDataOnly(claim, path);
  return true;
}

function createCandidateClaim(fact, {
  claimId,
  operationId,
  capabilityRequestId,
  candidateFactIndex,
  createdAt,
  createdInRevision,
}) {
  validateCandidateFact(fact);
  const origin = {
    operationId,
    capabilityRequestId,
    candidateFactIndex,
  };
  if (fact.factId !== undefined) origin.candidateFactId = fact.factId;
  const claim = {
    claimId,
    claimType: fact.type,
    originatingCandidateFact: origin,
    subject: {
      candidatePartyKey: `${claimId}:subject`,
      party: cloneData(fact.subject),
    },
    evidenceReferences: cloneData(fact.evidenceReferences),
    status: CLAIM_STATE.CANDIDATE,
    createdAt,
    createdInRevision,
  };

  if (fact.type === CANDIDATE_FACT_TYPE.RELATIONSHIP) {
    claim.object = {
      candidatePartyKey: `${claimId}:object`,
      party: cloneData(fact.object),
    };
    claim.relationship = fact.relationship;
    if (fact.measurement !== undefined) claim.measurement = cloneData(fact.measurement);
    if (fact.qualifiers !== undefined) claim.qualifiers = cloneData(fact.qualifiers);
  } else {
    claim.attribute = fact.attribute;
    claim.value = cloneData(fact.value);
  }

  validateCandidateClaim(claim);
  return deepFreeze(claim);
}

module.exports = {
  createCandidateClaim,
  validateCandidateClaim,
};
