"use strict";

const UBO_CONFIGURATION_ERROR_CODE = Object.freeze({
  MISSING_DISCOVERY_SERVICE: "MISSING_DISCOVERY_SERVICE",
  MISSING_EXTRACTION_SERVICE: "MISSING_EXTRACTION_SERVICE",
  INVALID_DISCOVERY_SERVICE: "INVALID_DISCOVERY_SERVICE",
  INVALID_EXTRACTION_SERVICE: "INVALID_EXTRACTION_SERVICE",
  INVALID_POLICY_PACK: "INVALID_POLICY_PACK",
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

class PolicyPackValidationError extends UboControlError {}

class PolicyPackIntegrityError extends UboControlError {}

class DecisionSnapshotValidationError extends UboControlError {}

class StaleDecisionHistoryError extends UboControlError {}

module.exports = {
  UBO_CONFIGURATION_ERROR_CODE,
  UboConfigurationError,
  UboContractError,
  PolicyPackValidationError,
  PolicyPackIntegrityError,
  DecisionSnapshotValidationError,
  StaleDecisionHistoryError,
};
