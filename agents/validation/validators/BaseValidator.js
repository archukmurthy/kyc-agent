var contracts =
  typeof require === "function"
    ? require("../contracts/validationTypes")
    : window.ValidationContracts;

class BaseValidator {
  constructor({
    ruleId,
    name,
    severity = contracts.SEVERITY.INFO,
    version = "0.1.0",
    owner = "Validation Agent",
    description = "Skeleton validator",
    requires = {},
  } = {}) {
    this.ruleId = ruleId;
    this.name = name || this.constructor.name;
    this.severity = severity;
    this.version = version;
    this.owner = owner;
    this.description = description;
    this.requires = {
      extractedFields: [],
      evidenceTypes: [],
      contextFields: [],
      ...requires,
    };
  }

  validate(input = {}) {
    return [
      this.createFinding({
        input,
        message: `${this.name} is registered but has no validation logic yet.`,
        decision: {
          summary: `${this.name} has not been implemented.`,
          outcomeReason: "Phase 1 skeleton only. Business logic has not been implemented.",
          ruleDescription: "Placeholder validator registration.",
          evaluatedInputs: [],
          decisionPath: [
            {
              stepId: "validator_not_implemented",
              result: contracts.VALIDATION_STATUS.REVIEW,
              explanation: "The validator is available in the pipeline but contains no rule logic yet.",
              evidenceIds: [],
            },
          ],
        },
        customerGuidance: {
          summary: "No customer action is available for this draft validation rule.",
          whyItMatters: "This rule has not been activated yet.",
          remediation: "No remediation is required for this placeholder rule.",
          actions: [],
          examples: [],
        },
        analystGuidance: {
          summary: "Placeholder validator only.",
          ruleExecuted: this.ruleId,
          evidenceIds: [],
          reasoning: "Phase 1 skeleton only. Business logic has not been implemented.",
          suggestedAction: "No analyst action required for this placeholder rule.",
          reviewPriority: "LOW",
          debugNotes: [],
        },
      }),
    ];
  }

  createFinding(overrides = {}) {
    const now = new Date().toISOString();
    const input = overrides.input || {};
    const execution = input.execution || {};
    const executionId =
      overrides.executionId ||
      execution.executionId ||
      `${this.name}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

    return contracts.createFinding({
      validatorMetadata: this.getMetadata(),
      executionId,
      status: contracts.VALIDATION_STATUS.REVIEW,
      ruleId: this.ruleId,
      severity: this.severity,
      evidenceIds: [],
      execution: {
        startedAt: now,
        completedAt: now,
        durationMs: 0,
        validatorVersion: this.version,
        rulePackVersion: input.ruleContext && input.ruleContext.rulePackVersion,
        warnings: [],
      },
      ...overrides,
      input: undefined,
    });
  }

  getMetadata() {
    return {
      validatorId: this.name,
      version: this.version,
      owner: this.owner,
      description: this.description,
      requires: this.requires,
    };
  }
}

if (typeof module !== "undefined") {
  module.exports = BaseValidator;
}

if (typeof window !== "undefined") {
  window.ValidationBaseValidator = BaseValidator;
}
