"use strict";

const { createUboControl } = require("./composition/createUboControl");
const {
  DECISION_APPLICATION_CONTRACT_VERSION,
  DECISION_APPLICATION_CONTRACT_VERSION_V2,
  createUboDecisionApplication,
} = require("./application/createUboDecisionApplication");
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
  DECISION_APPLICATION_ERROR_CODE,
  OWNERSHIP_GRAPH_PROJECTION_ERROR_CODE,
  UBO_JOURNEY_PROJECTION_ERROR_CODE,
  UBO_RESOLUTION_PLANNER_ERROR_CODE,
  UBO_CONFIGURATION_ERROR_CODE,
  DecisionApplicationError,
  OwnershipGraphProjectionError,
  UboJourneyProjectionError,
  UboResolutionPlannerError,
  UboConfigurationError,
  UboContractError,
  PolicyPackIntegrityError,
  PolicyPackValidationError,
} = require("./errors");
const {
  OWNERSHIP_GRAPH_PROJECTION_CONTRACT_VERSION,
  projectOwnershipGraph,
} = require("./projection/ownershipGraphProjection");
const {
  UBO_JOURNEY_PROJECTION_CONTRACT_VERSION,
  projectUboJourney,
} = require("./projection/uboJourneyProjection");
const {
  UBO_RESOLUTION_PLAN_CONTRACT_VERSION,
  UBO_RESOLUTION_PLANNER_VERSION,
  planUboResolution,
} = require("./planning/uboResolutionPlanner");
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
  DECISION_APPLICATION_CONTRACT_VERSION,
  DECISION_APPLICATION_CONTRACT_VERSION_V2,
  DECISION_APPLICATION_ERROR_CODE,
  OWNERSHIP_GRAPH_PROJECTION_CONTRACT_VERSION,
  OWNERSHIP_GRAPH_PROJECTION_ERROR_CODE,
  UBO_JOURNEY_PROJECTION_CONTRACT_VERSION,
  UBO_JOURNEY_PROJECTION_ERROR_CODE,
  UBO_RESOLUTION_PLAN_CONTRACT_VERSION,
  UBO_RESOLUTION_PLANNER_ERROR_CODE,
  UBO_RESOLUTION_PLANNER_VERSION,
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
  DecisionApplicationError,
  OwnershipGraphProjectionError,
  UboJourneyProjectionError,
  UboResolutionPlannerError,
  PolicyPackIntegrityError,
  PolicyPackValidationError,
  UboConfigurationError,
  UboContractError,
  canonicalizeJson,
  createUboDecisionApplication,
  createUboControl,
  hashPolicyPack,
  loadPolicyPack,
  projectOwnershipGraph,
  projectUboJourney,
  planUboResolution,
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
