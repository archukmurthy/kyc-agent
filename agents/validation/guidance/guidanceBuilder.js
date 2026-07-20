function buildGuidance(findings = []) {
  return findings
    .filter((finding) => finding.status !== "PASS")
    .map((finding) => ({
      ruleId: finding.ruleId,
      status: finding.status,
      severity: finding.severity,
      message: finding.customerGuidance && finding.customerGuidance.summary,
      remediation: finding.customerGuidance && finding.customerGuidance.remediation,
      actions: finding.customerGuidance ? finding.customerGuidance.actions : [],
    }));
}

function buildCustomerGuidance({
  status,
  fieldLabel,
  problem,
  remediation,
  actionId,
  priority = "HIGH",
} = {}) {
  if (status === "PASS") {
    return {
      summary: `${fieldLabel} is present and valid.`,
      whyItMatters: `${fieldLabel} helps confirm the LOA can be accepted.`,
      remediation: "No action is needed.",
      actions: [],
      examples: [],
    };
  }

  return {
    summary: problem,
    whyItMatters: `${fieldLabel} is needed to validate the Letter of Authorization before submission.`,
    remediation,
    actions: [
      {
        actionId,
        type: "UPDATE_OR_UPLOAD_REPLACEMENT_DOCUMENT",
        label: `Fix ${fieldLabel}`,
        description: remediation,
        priority,
      },
    ],
    examples: [],
  };
}

var guidanceBuilderExported = {
  buildGuidance,
  buildCustomerGuidance,
};

if (typeof module !== "undefined") {
  module.exports = guidanceBuilderExported;
}

if (typeof window !== "undefined") {
  window.ValidationGuidanceBuilder = guidanceBuilderExported;
}
