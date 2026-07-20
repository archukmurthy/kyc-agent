var validators =
  typeof require === "function"
    ? [
        require("../validators/RecipientValidator"),
        require("../validators/SignatureValidator"),
        require("../validators/DateValidator"),
        require("../validators/ValidityValidator"),
        require("../validators/RequiredFieldValidator"),
      ]
    : [
        window.RecipientValidator,
        window.SignatureValidator,
        window.DateValidator,
        window.ValidityValidator,
        window.RequiredFieldValidator,
      ];

function createDefaultValidators() {
  return validators.map((Validator) => new Validator());
}

async function runValidatorPipeline({ validators: activeValidators, extraction, evidence, request, context, ruleContext }) {
  const findings = [];

  for (const validator of activeValidators) {
    const result = await validator.validate({
      document: request.document,
      extraction,
      evidence,
      requirementContext: context,
      applicationContext: request.applicationContext || {},
      researchContext: request.researchContext || {},
      ruleContext,
      validatorMetadata: validator.getMetadata ? validator.getMetadata() : request.validatorMetadata,
      execution: {
        executionId:
          request.execution.executionId ||
          `${validator.name || validator.constructor.name}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        validationRunId: request.execution.validationRunId || request.metadata.validationRunId,
        environment: request.execution.environment || "validation-lab",
        executedAt: request.execution.executedAt || new Date().toISOString(),
      },
    });
    if (Array.isArray(result)) {
      findings.push(...result);
    } else if (result) {
      findings.push(result);
    }
  }

  return findings;
}

var validatorPipelineExported = {
  createDefaultValidators,
  runValidatorPipeline,
};

if (typeof module !== "undefined") {
  module.exports = validatorPipelineExported;
}

if (typeof window !== "undefined") {
  window.ValidationValidatorPipeline = validatorPipelineExported;
}
