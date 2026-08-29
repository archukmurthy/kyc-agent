"use strict";

const { createUboControl } = require("./composition/createUboControl");
const {
  APPLICABILITY_MODEL_VERSION,
  APPLICABILITY_RESULT,
  CAPABILITY_CONTRACT_VERSION,
  CAPABILITY_OUTCOME_STATE,
  CANDIDATE_FACT_TYPE,
  CLAIM_STATE,
  CLAIM_STATE_MODEL_VERSION,
  CONDITION_LANGUAGE_VERSION,
  IDENTITY_RESOLUTION_STATUS,
  PERCENTAGE_VALUE_TYPE,
  POLICY_PACK_SCHEMA_ID,
  POLICY_PACK_SCHEMA_VERSION,
  RELATIONSHIP_TYPE,
  REQUIREMENT_STATE,
  REQUIREMENT_STATE_MODEL_VERSION,
  RESOLUTION_EFFECT,
  RESOLUTION_SEMANTICS_VERSION,
  RESOLUTION_STRATEGY,
  RISK_LEVEL,
  RISK_LEVEL_MODEL_VERSION,
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
const { validateConditionExpression } = require("./policy/conditionLanguage");
const { hashPolicyPack, loadPolicyPack, validatePolicyPack } = require("./policy/policyPack");

module.exports = Object.freeze({
  APPLICABILITY_MODEL_VERSION,
  APPLICABILITY_RESULT,
  CANONICALIZATION_ALGORITHM,
  CAPABILITY_CONTRACT_VERSION,
  CAPABILITY_OUTCOME_STATE,
  CANDIDATE_FACT_TYPE,
  CLAIM_STATE,
  CLAIM_STATE_MODEL_VERSION,
  CONDITION_LANGUAGE_VERSION,
  IDENTITY_RESOLUTION_STATUS,
  PERCENTAGE_VALUE_TYPE,
  POLICY_PACK_SCHEMA_ID,
  POLICY_PACK_SCHEMA_VERSION,
  RELATIONSHIP_TYPE,
  REQUIREMENT_STATE,
  REQUIREMENT_STATE_MODEL_VERSION,
  RESOLUTION_EFFECT,
  RESOLUTION_SEMANTICS_VERSION,
  RESOLUTION_STRATEGY,
  RISK_LEVEL,
  RISK_LEVEL_MODEL_VERSION,
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
  validateConditionExpression,
  validateDiscoveryRequest,
  validateEvidenceReference,
  validateExtractionRequest,
  validateIdentityResolutionDecision,
  validatePercentageValue,
  validatePolicyPack,
});
