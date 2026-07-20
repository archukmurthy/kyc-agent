const sgLoaRulePack = {
  jurisdiction: "SG",
  documentType: "LOA",
  version: "0.2.0",
  id: "SG.LOA",
  name: "Singapore Letter of Authorization",
  validityMonths: 12,
  requiredFields: [
    "applicantName",
    "recipientName",
    "issueDate",
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
      description: "Singapore LOA must include all required fields.",
      severity: "HIGH",
      parameters: {
        requiredFields: [
          "applicantName",
          "recipientName",
          "issueDate",
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
    {
      ruleId: "LOA.AUTHORITY.VALID",
      description: "LOA signer role must be permitted for the Singapore entity type.",
      severity: "HIGH",
      parameters: {
        entityRules: {
          PRIVATE_LIMITED: {
            applicantAllowedRoles: ["DIRECTOR", "UBO"],
            allowedSignerRoles: ["DIRECTOR", "UBO"],
          },
          LISTED_PUBLIC_COMPANY: {
            applicantAllowedRoles: ["DIRECTOR", "CONTROLLING_PERSON"],
            allowedSignerRoles: ["DIRECTOR", "CONTROLLING_PERSON"],
          },
          PARTNERSHIP: {
            applicantAllowedRoles: ["PARTNER"],
            allowedSignerRoles: ["PARTNER"],
          },
          SOLE_PROPRIETOR: {
            applicantAllowedRoles: ["SOLE_OWNER"],
            allowedSignerRoles: ["SOLE_OWNER"],
          },
        },
      },
    },
    {
      ruleId: "LOA.AUTHORITY.VALID",
      description: "LOA signer role must be permitted for the Singapore entity type.",
      severity: "HIGH",
      parameters: {
        allowedSignatoryRoles: {
          PRIVATE_LIMITED: ["Director", "UBO"],
          LISTED_PUBLIC_COMPANY: ["Director", "Controlling Person"],
          PARTNERSHIP: ["Partner"],
          SOLE_PROPRIETOR: ["Sole Owner"],
        },
      },
    },
  ],
};

if (typeof module !== "undefined") {
  module.exports = sgLoaRulePack;
}

if (typeof window !== "undefined") {
  window.SgLoaRulePack = sgLoaRulePack;
}
