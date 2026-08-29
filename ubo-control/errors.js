"use strict";

const UBO_CONFIGURATION_ERROR_CODE = Object.freeze({
  MISSING_DISCOVERY_SERVICE: "MISSING_DISCOVERY_SERVICE",
  MISSING_EXTRACTION_SERVICE: "MISSING_EXTRACTION_SERVICE",
  INVALID_DISCOVERY_SERVICE: "INVALID_DISCOVERY_SERVICE",
  INVALID_EXTRACTION_SERVICE: "INVALID_EXTRACTION_SERVICE",
  INVALID_POLICY_PACK: "INVALID_POLICY_PACK",
});

const DECISION_APPLICATION_ERROR_CODE = Object.freeze({
  UNSUPPORTED_CONTRACT_VERSION: "UNSUPPORTED_CONTRACT_VERSION",
  INVALID_CASE_INPUT: "INVALID_CASE_INPUT",
  INVALID_CASE_STATE: "INVALID_CASE_STATE",
  INVALID_CAPABILITY_RESULT: "INVALID_CAPABILITY_RESULT",
  INVALID_DECISION_TARGET: "INVALID_DECISION_TARGET",
  INVALID_EXPLICIT_DECISION: "INVALID_EXPLICIT_DECISION",
  UNRESOLVED_MANDATORY_DECISION_TARGET: "UNRESOLVED_MANDATORY_DECISION_TARGET",
  EVALUATION_PRECONDITION_FAILED: "EVALUATION_PRECONDITION_FAILED",
  POLICY_CONFIGURATION_ERROR: "POLICY_CONFIGURATION_ERROR",
  STALE_OR_INCONSISTENT_STATE: "STALE_OR_INCONSISTENT_STATE",
});

class UboControlError extends Error {
  constructor(message, { code, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = new.target.name;
    this.code = code;
  }
}

class UboConfigurationError extends UboControlError {}

class UboContractError extends UboControlError {}

class DecisionApplicationError extends UboControlError {}

class PolicyPackValidationError extends UboControlError {}

class PolicyPackIntegrityError extends UboControlError {}

class DecisionSnapshotValidationError extends UboControlError {}

class StaleDecisionHistoryError extends UboControlError {}

module.exports = {
  DECISION_APPLICATION_ERROR_CODE,
  UBO_CONFIGURATION_ERROR_CODE,
  DecisionApplicationError,
  UboConfigurationError,
  UboContractError,
  PolicyPackValidationError,
  PolicyPackIntegrityError,
  DecisionSnapshotValidationError,
  StaleDecisionHistoryError,
};
