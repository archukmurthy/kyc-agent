const VALIDATION_STATUS = Object.freeze({
  PASS: "PASS",
  REVIEW: "REVIEW",
  FAIL: "FAIL",
});

const SEVERITY = Object.freeze({
  INFO: "INFO",
  LOW: "LOW",
  MEDIUM: "MEDIUM",
  HIGH: "HIGH",
  CRITICAL: "CRITICAL",
});

function createRequirementContext({
  jurisdiction,
  documentType,
  requiredByDrs = null,
  requirementId = null,
  entityType = null,
} = {}) {
  return {
    jurisdiction,
    documentType,
    requiredByDrs,
    requirementId,
    entityType,
  };
}

function createValidationRequest({
  document,
  market,
  documentType = "LOA",
  extraction = null,
  evidence = null,
  requirementContext = null,
  applicationContext = {},
  researchContext = {},
  ruleContext = null,
  validatorMetadata = null,
  metadata = {},
  execution = {},
} = {}) {
  return {
    document,
    market,
    documentType,
    extraction,
    evidence,
    requirementContext,
    applicationContext,
    researchContext,
    ruleContext,
    validatorMetadata,
    metadata,
    execution,
  };
}

function createFinding({
  validatorMetadata,
  executionId,
  status = VALIDATION_STATUS.REVIEW,
  ruleId,
  severity = SEVERITY.INFO,
  message,
  decision,
  evidenceIds = [],
  customerGuidance,
  analystGuidance,
  execution = {},
} = {}) {
  return {
    validatorMetadata,
    executionId,
    ruleId,
    status,
    severity,
    message,
    decision,
    evidenceIds,
    customerGuidance,
    analystGuidance,
    execution,
  };
}

function createValidationResult({
  status = VALIDATION_STATUS.REVIEW,
  documentType = "LOA",
  market,
  evidence = [],
  findings = [],
  guidance = [],
  extracted = null,
  metadata = {},
} = {}) {
  return {
    status,
    documentType,
    market,
    evidence,
    findings,
    guidance,
    extracted,
    metadata,
  };
}

function createRuleContext({ rulePackId, rulePackVersion, activeRules = [] } = {}) {
  return {
    rulePackId,
    rulePackVersion,
    activeRules,
  };
}

var validationContractsExported = {
  VALIDATION_STATUS,
  SEVERITY,
  createRequirementContext,
  createValidationRequest,
  createFinding,
  createValidationResult,
  createRuleContext,
};

if (typeof module !== "undefined") {
  module.exports = validationContractsExported;
}

if (typeof window !== "undefined") {
  window.ValidationContracts = validationContractsExported;
}
