"use strict";

const { createUboControl } = require("./composition/createUboControl");
const {
  CAPABILITY_CONTRACT_VERSION,
  CAPABILITY_OUTCOME_STATE,
  CANDIDATE_FACT_TYPE,
  IDENTITY_RESOLUTION_STATUS,
  PERCENTAGE_VALUE_TYPE,
  RELATIONSHIP_TYPE,
} = require("./contracts/constants");
const {
  validateCapabilityOutcome,
  validateCapabilityResult,
  validateDiscoveryRequest,
  validateExtractionRequest,
} = require("./contracts/capability");
const { validateCandidateFact } = require("./contracts/candidateFact");
const { validateCandidatePartyReference } = require("./contracts/candidatePartyReference");
const { validateEvidenceReference } = require("./contracts/evidenceReference");
const { validateIdentityResolutionDecision } = require("./contracts/identityResolutionDecision");
const { validatePercentageValue } = require("./contracts/percentageValue");
const {
  UBO_CONFIGURATION_ERROR_CODE,
  UboConfigurationError,
  UboContractError,
  PolicyPackIntegrityError,
  PolicyPackValidationError,
} = require("./errors");
const { canonicalizeJson, CANONICALIZATION_ALGORITHM } = require("./policy/canonicalJson");
const { hashPolicyPack, loadPolicyPack, validatePolicyPack } = require("./policy/policyPack");

module.exports = Object.freeze({
  CANONICALIZATION_ALGORITHM,
  CAPABILITY_CONTRACT_VERSION,
  CAPABILITY_OUTCOME_STATE,
  CANDIDATE_FACT_TYPE,
  IDENTITY_RESOLUTION_STATUS,
  PERCENTAGE_VALUE_TYPE,
  RELATIONSHIP_TYPE,
  UBO_CONFIGURATION_ERROR_CODE,
  PolicyPackIntegrityError,
  PolicyPackValidationError,
  UboConfigurationError,
  UboContractError,
  canonicalizeJson,
  createUboControl,
  hashPolicyPack,
  loadPolicyPack,
  validateCandidateFact,
  validateCandidatePartyReference,
  validateCapabilityOutcome,
  validateCapabilityResult,
  validateDiscoveryRequest,
  validateEvidenceReference,
  validateExtractionRequest,
  validateIdentityResolutionDecision,
  validatePercentageValue,
  validatePolicyPack,
});
