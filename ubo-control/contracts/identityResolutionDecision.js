"use strict";

const {
  assertArray,
  assertDataOnly,
  assertEnum,
  assertNonEmptyString,
  assertOptionalNonEmptyString,
  assertPlainObject,
  fail,
} = require("../internal/validation");
const { IDENTITY_RESOLUTION_STATUS } = require("./constants");
const { validateCandidatePartyReference } = require("./candidatePartyReference");
const { validateEvidenceReference } = require("./evidenceReference");

function validateIdentityResolutionDecision(decision) {
  assertPlainObject(decision, "identityResolutionDecision");
  assertNonEmptyString(decision.decisionId, "identityResolutionDecision.decisionId");

  const hasParty = decision.candidateParty !== undefined;
  const hasKey = typeof decision.candidatePartyKey === "string" && decision.candidatePartyKey.trim() !== "";
  if (!hasParty && !hasKey) {
    fail("identityResolutionDecision requires candidateParty or candidatePartyKey");
  }
  if (hasParty) {
    validateCandidatePartyReference(decision.candidateParty, "identityResolutionDecision.candidateParty");
  }
  assertOptionalNonEmptyString(decision.candidatePartyKey, "identityResolutionDecision.candidatePartyKey");

  assertEnum(
    decision.status,
    IDENTITY_RESOLUTION_STATUS,
    "identityResolutionDecision.status",
  );
  assertOptionalNonEmptyString(decision.entityId, "identityResolutionDecision.entityId");
  if (decision.status === IDENTITY_RESOLUTION_STATUS.RESOLVED && !decision.entityId) {
    fail("RESOLVED identity decisions require entityId");
  }

  assertArray(decision.basisReasonCodes, "identityResolutionDecision.basisReasonCodes");
  decision.basisReasonCodes.forEach((reason, index) => {
    assertNonEmptyString(reason, `identityResolutionDecision.basisReasonCodes[${index}]`);
  });

  assertArray(decision.evidenceReferences, "identityResolutionDecision.evidenceReferences");
  decision.evidenceReferences.forEach((reference, index) => {
    validateEvidenceReference(reference, `identityResolutionDecision.evidenceReferences[${index}]`);
  });

  assertNonEmptyString(decision.decidedAt, "identityResolutionDecision.decidedAt");
  if (Number.isNaN(Date.parse(decision.decidedAt))) {
    fail("identityResolutionDecision.decidedAt must be an ISO-compatible timestamp");
  }
  assertNonEmptyString(decision.decisionOrigin, "identityResolutionDecision.decisionOrigin");
  assertOptionalNonEmptyString(decision.decisionActor, "identityResolutionDecision.decisionActor");

  assertDataOnly(decision, "identityResolutionDecision");
  return true;
}

module.exports = { validateIdentityResolutionDecision };
