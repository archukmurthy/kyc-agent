"use strict";

const {
  assertAllowedKeys,
  assertArray,
  assertDataOnly,
  assertEnum,
  assertNonEmptyString,
  assertPlainObject,
  fail,
} = require("../internal/validation");
const { CAPABILITY_CONTRACT_VERSION, CAPABILITY_OUTCOME_STATE } = require("./constants");
const { validateCandidateFact } = require("./candidateFact");
const { validateCandidatePartyReference } = require("./candidatePartyReference");
const { validateEvidenceReference } = require("./evidenceReference");

function validateContractVersion(version, path) {
  assertNonEmptyString(version, path);
  if (version !== CAPABILITY_CONTRACT_VERSION) {
    fail(`${path} must equal supported contract version ${CAPABILITY_CONTRACT_VERSION}`, "UNSUPPORTED_CONTRACT_VERSION");
  }
}

function validateInformationNeeds(needs, path) {
  assertArray(needs, path);
  needs.forEach((need, index) => {
    assertPlainObject(need, `${path}[${index}]`);
    assertDataOnly(need, `${path}[${index}]`);
  });
}

function validateCommonRequest(request, path) {
  assertPlainObject(request, path);
  validateContractVersion(request.contractVersion, `${path}.contractVersion`);
  assertNonEmptyString(request.requestId, `${path}.requestId`);
  assertNonEmptyString(request.caseId, `${path}.caseId`);
  validateInformationNeeds(request.informationNeeds, `${path}.informationNeeds`);
  assertDataOnly(request, path);
}

function validateDiscoveryRequest(request) {
  validateCommonRequest(request, "discoveryRequest");
  validateCandidatePartyReference(request.subject, "discoveryRequest.subject");
  return true;
}

function validateExtractionRequest(request) {
  validateCommonRequest(request, "extractionRequest");
  assertArray(request.artifactEvidenceReferences, "extractionRequest.artifactEvidenceReferences");
  if (request.artifactEvidenceReferences.length === 0) {
    fail("extractionRequest.artifactEvidenceReferences must identify at least one external artifact");
  }
  request.artifactEvidenceReferences.forEach((reference, index) => {
    validateEvidenceReference(reference, `extractionRequest.artifactEvidenceReferences[${index}]`);
  });
  return true;
}

function validateCapabilityOutcome(outcome, path = "capabilityResult.outcome") {
  assertPlainObject(outcome, path);
  assertAllowedKeys(outcome, ["state", "code", "message", "retryable"], path);
  assertEnum(outcome.state, CAPABILITY_OUTCOME_STATE, `${path}.state`);

  if (outcome.code !== undefined) assertNonEmptyString(outcome.code, `${path}.code`);
  if (outcome.message !== undefined) assertNonEmptyString(outcome.message, `${path}.message`);
  if (outcome.retryable !== undefined && typeof outcome.retryable !== "boolean") {
    fail(`${path}.retryable must be boolean`);
  }

  assertDataOnly(outcome, path);
  return true;
}

function validateCapabilityResult(result, { expectedRequestId } = {}) {
  assertPlainObject(result, "capabilityResult");
  assertAllowedKeys(
    result,
    [
      "contractVersion",
      "requestId",
      "outcome",
      "candidateFacts",
      "operationEvidenceReferences",
      "issues",
    ],
    "capabilityResult",
  );
  validateContractVersion(result.contractVersion, "capabilityResult.contractVersion");
  assertNonEmptyString(result.requestId, "capabilityResult.requestId");

  if (expectedRequestId !== undefined && result.requestId !== expectedRequestId) {
    fail("capabilityResult.requestId must match the request", "MISMATCHED_REQUEST_ID");
  }

  validateCapabilityOutcome(result.outcome);

  assertArray(result.candidateFacts, "capabilityResult.candidateFacts");
  result.candidateFacts.forEach((fact, index) => {
    validateCandidateFact(fact, `capabilityResult.candidateFacts[${index}]`);
  });

  if (
    result.outcome.state === CAPABILITY_OUTCOME_STATE.NO_DATA &&
    result.candidateFacts.length !== 0
  ) {
    fail("NO_DATA results cannot contain candidate facts");
  }

  assertArray(result.operationEvidenceReferences, "capabilityResult.operationEvidenceReferences");
  result.operationEvidenceReferences.forEach((reference, index) => {
    validateEvidenceReference(reference, `capabilityResult.operationEvidenceReferences[${index}]`);
  });

  assertArray(result.issues, "capabilityResult.issues");
  result.issues.forEach((issue, index) => {
    assertPlainObject(issue, `capabilityResult.issues[${index}]`);
    assertDataOnly(issue, `capabilityResult.issues[${index}]`);
  });

  assertDataOnly(result, "capabilityResult");
  return true;
}

function isDiscoveryService(service) {
  return Boolean(service && typeof service === "object" && typeof service.discover === "function");
}

function isExtractionService(service) {
  return Boolean(service && typeof service === "object" && typeof service.extract === "function");
}

module.exports = {
  isDiscoveryService,
  isExtractionService,
  validateCapabilityOutcome,
  validateCapabilityResult,
  validateDiscoveryRequest,
  validateExtractionRequest,
};
