var contracts =
  typeof require === "function"
    ? require("../contracts/validationTypes")
    : window.ValidationContracts;

function aggregateStatus(findings = []) {
  if (findings.some((finding) => finding.status === contracts.VALIDATION_STATUS.FAIL)) {
    return contracts.VALIDATION_STATUS.FAIL;
  }

  if (findings.some((finding) => finding.status === contracts.VALIDATION_STATUS.REVIEW)) {
    return contracts.VALIDATION_STATUS.REVIEW;
  }

  return contracts.VALIDATION_STATUS.PASS;
}

function aggregateResult({ request, extraction, evidence, findings, guidance }) {
  return contracts.createValidationResult({
    status: aggregateStatus(findings),
    documentType: request.documentType,
    market: request.market,
    evidence,
    findings,
    guidance,
    extracted: extraction,
    metadata: {
      generatedAt: new Date().toISOString(),
      findingCount: findings.length,
    },
  });
}

var resultAggregatorExported = {
  aggregateStatus,
  aggregateResult,
};

if (typeof module !== "undefined") {
  module.exports = resultAggregatorExported;
}

if (typeof window !== "undefined") {
  window.ValidationResultAggregator = resultAggregatorExported;
}
