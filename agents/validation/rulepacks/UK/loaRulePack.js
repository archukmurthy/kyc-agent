const ukLoaRulePack = {
  jurisdiction: "UK",
  documentType: "LOA",
  version: "0.1.0",
  id: "UK.LOA",
  name: "UK Letter of Authorization",
  validityMonths: 12,
  requiredFields: [
    "applicantName",
    "recipientName",
    "issueDate",
    "signaturePresent",
    "printedSignerName",
    "signerTitle",
    "countryOfIssue",
  ],
  rules: [
    {
      ruleId: "LOA.RECIPIENT.MATCHES_EXPECTED",
      description: "LOA recipient must match the expected application recipient.",
      severity: "HIGH",
      parameters: {},
    },
    {
      ruleId: "LOA.REQUIRED_FIELDS.PRESENT",
      description: "UK LOA must include all required fields.",
      severity: "HIGH",
      parameters: {
        requiredFields: [
          "applicantName",
          "recipientName",
          "issueDate",
          "signaturePresent",
          "printedSignerName",
          "signerTitle",
          "countryOfIssue",
        ],
      },
    },
    {
      ruleId: "LOA.DATE.VALID",
      description: "LOA issue date must be present and valid.",
      severity: "HIGH",
      parameters: {},
    },
    {
      ruleId: "LOA.VALIDITY.WITHIN_PERIOD",
      description: "LOA issue date must be within the configured validity period.",
      severity: "HIGH",
      parameters: {
        validityMonths: 12,
      },
    },
    {
      ruleId: "LOA.SIGNATURE.COMPLETE",
      description: "LOA must include a signature, printed signer name, and signer title.",
      severity: "HIGH",
      parameters: {},
    },
  ],
};

if (typeof module !== "undefined") {
  module.exports = ukLoaRulePack;
}

if (typeof window !== "undefined") {
  window.UkLoaRulePack = ukLoaRulePack;
}
