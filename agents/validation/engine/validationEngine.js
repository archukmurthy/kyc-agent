var contracts =
  typeof require === "function"
    ? require("../contracts/validationTypes")
    : window.ValidationContracts;
var rulePackLoader =
  typeof require === "function"
    ? require("../rulepacks/rulePackLoader")
    : window.ValidationRulePackLoader;
var extractionOrchestrator =
  typeof require === "function"
    ? require("../extraction/extractionOrchestrator")
    : window.ValidationExtractionOrchestrator;
var validatorPipeline =
  typeof require === "function"
    ? require("./validatorPipeline")
    : window.ValidationValidatorPipeline;
var guidanceBuilder =
  typeof require === "function"
    ? require("../guidance/guidanceBuilder")
    : window.ValidationGuidanceBuilder;
var resultAggregator =
  typeof require === "function"
    ? require("./resultAggregator")
    : window.ValidationResultAggregator;

class ValidationEngine {
  constructor({ validators = validatorPipeline.createDefaultValidators() } = {}) {
    this.validators = validators;
  }

  async validate(input) {
    const request = contracts.createValidationRequest(input);
    const rulePack = rulePackLoader.loadRulePack({
      market: request.market,
      documentType: request.documentType,
    });
    const ruleContext =
      request.ruleContext ||
      contracts.createRuleContext({
        rulePackId: rulePack.id || `${rulePack.jurisdiction}.${rulePack.documentType}`,
        rulePackVersion: rulePack.version,
        activeRules: rulePack.rules.map((rule) =>
          typeof rule === "string"
            ? {
                ruleId: rule,
                description: rule,
                severity: "INFO",
                parameters: {},
              }
            : rule
        ),
      });
    const context = contracts.createRequirementContext({
      jurisdiction: rulePack.jurisdiction,
      documentType: rulePack.documentType,
      requiredByDrs: request.requirementContext && request.requirementContext.requiredByDrs,
      requirementId: request.requirementContext && request.requirementContext.requirementId,
      entityType: request.requirementContext && request.requirementContext.entityType,
    });
    const extraction = request.extraction || (await extractionOrchestrator.extractDocument(request));
    const evidence = Array.isArray(request.evidence)
      ? request.evidence
      : Array.isArray(extraction.evidence)
        ? extraction.evidence
        : [];
    const findings = await validatorPipeline.runValidatorPipeline({
      validators: this.validators,
      extraction,
      evidence,
      request,
      context,
      ruleContext,
    });
    const guidance = guidanceBuilder.buildGuidance(findings);

    return resultAggregator.aggregateResult({
      request,
      extraction,
      evidence,
      findings,
      guidance,
    });
  }
}

var validationEngineExported = {
  ValidationEngine,
};

if (typeof module !== "undefined") {
  module.exports = validationEngineExported;
}

if (typeof window !== "undefined") {
  window.ValidationEngineModule = validationEngineExported;
}
