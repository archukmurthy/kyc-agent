var RequiredFieldBaseValidator =
  typeof require === "function"
    ? require("./BaseValidator")
    : window.ValidationBaseValidator;
var RequiredFieldGuidanceBuilder =
  typeof require === "function"
    ? require("../guidance/guidanceBuilder")
    : window.ValidationGuidanceBuilder;

class RequiredFieldValidator extends RequiredFieldBaseValidator {
  constructor(options = {}) {
    super({
      ruleId: "LOA.REQUIRED_FIELDS.PRESENT",
      name: "RequiredFieldValidator",
      severity: "HIGH",
      description: "Checks that required LOA fields are present in extraction.",
      requires: {
        extractedFields: [
          "applicantName",
          "recipientName",
          "issueDate",
          "signaturePresent",
          "printedSignerName",
          "signerTitle",
          "countryOfIssue",
        ],
        evidenceTypes: ["extracted_field"],
        contextFields: ["ruleContext.activeRules"],
      },
      ...options,
    });
  }

  validate(input = {}) {
    const startedAt = new Date().toISOString();
    const requiredFields = requiredFieldGetConfiguredFields(input.ruleContext);

    return requiredFields.map((fieldName) => {
      const field = requiredFieldDefinitions[fieldName];
      const fieldValue = requiredFieldGetValue(input.extraction, fieldName);
      const evidenceIds = requiredFieldGetEvidenceIds(input.extraction, input.evidence, fieldName);
      const isPresent = requiredFieldIsPresent(fieldValue, fieldName);
      const status = isPresent ? "PASS" : "FAIL";
      const completedAt = new Date().toISOString();

      return this.createFinding({
        input,
        status,
        severity: this.severity,
        ruleId: `LOA.REQUIRED_FIELD.${field.ruleSuffix}`,
        message: isPresent
          ? `${field.label} is present.`
          : `${field.label} is missing from the Letter of Authorization.`,
        evidenceIds,
        decision: {
          summary: isPresent ? `${field.label} is present.` : `${field.label} is missing.`,
          outcomeReason: isPresent
            ? `Extraction produced a value for ${field.label}.`
            : `Extraction did not produce a usable value for ${field.label}.`,
          ruleDescription: `The LOA must include ${field.label}.`,
          evaluatedInputs: [`extraction.fields.${fieldName}`, "ruleContext.activeRules"],
          decisionPath: [
            {
              stepId: `${fieldName}_configured_as_required`,
              result: "PASS",
              explanation: `${field.label} is configured as required for this rule pack.`,
              evidenceIds: [],
            },
            {
              stepId: `${fieldName}_presence_check`,
              result: status,
              explanation: isPresent
                ? `${field.label} was found in extracted fields.`
                : `${field.label} was not found in extracted fields.`,
              evidenceIds,
            },
          ],
        },
        customerGuidance: RequiredFieldGuidanceBuilder.buildCustomerGuidance({
          status,
          fieldLabel: field.label,
          problem: `${field.label} is missing from your Letter of Authorization.`,
          remediation: `Please upload an LOA that includes ${field.label}.`,
          actionId: `fix_${fieldName}`,
        }),
        analystGuidance: {
          summary: isPresent ? `${field.label} present.` : `${field.label} missing.`,
          ruleExecuted: `LOA.REQUIRED_FIELD.${field.ruleSuffix}`,
          evidenceIds,
          reasoning: isPresent
            ? `The extracted ${field.label} value is present.`
            : `The extracted ${field.label} value is missing or blank.`,
          suggestedAction: isPresent
            ? "No action required."
            : `Ask the customer to provide an LOA with ${field.label}.`,
          reviewPriority: isPresent ? "LOW" : "HIGH",
          debugNotes: [],
        },
        execution: {
          startedAt,
          completedAt,
          durationMs: new Date(completedAt).getTime() - new Date(startedAt).getTime(),
          validatorVersion: this.version,
          rulePackVersion: input.ruleContext && input.ruleContext.rulePackVersion,
          warnings: [],
        },
      });
    });
  }
}

var requiredFieldDefinitions = {
  applicantName: { label: "Applicant Name", ruleSuffix: "APPLICANT_NAME" },
  recipientName: { label: "Recipient", ruleSuffix: "RECIPIENT" },
  issueDate: { label: "Date", ruleSuffix: "DATE" },
  signaturePresent: { label: "Signature Presence", ruleSuffix: "SIGNATURE_PRESENCE" },
  printedSignerName: { label: "Printed Signer Name", ruleSuffix: "PRINTED_SIGNER_NAME" },
  signerTitle: { label: "Signer Title", ruleSuffix: "SIGNER_TITLE" },
  countryOfIssue: { label: "Country of Issue", ruleSuffix: "COUNTRY_OF_ISSUE" },
};

function requiredFieldGetConfiguredFields(ruleContext = {}) {
  const rule = (ruleContext.activeRules || []).find((activeRule) => activeRule.ruleId === "LOA.REQUIRED_FIELDS.PRESENT");
  const configured = rule && rule.parameters && Array.isArray(rule.parameters.requiredFields)
    ? rule.parameters.requiredFields
    : [];

  return configured.filter((fieldName) => requiredFieldDefinitions[fieldName]);
}

function requiredFieldGetValue(extraction = {}, fieldName) {
  const field = extraction.fields && extraction.fields[fieldName];
  if (field == null) return "";
  if (typeof field === "boolean") return field;
  if (typeof field === "string") return field;
  return field.value;
}

function requiredFieldIsPresent(value, fieldName) {
  if (fieldName === "signaturePresent") return value === true || value === "true" || value === "present";
  return String(value || "").trim().length > 0;
}

function requiredFieldGetEvidenceIds(extraction = {}, evidence = [], fieldName) {
  const field = extraction.fields && extraction.fields[fieldName];
  if (field && Array.isArray(field.evidenceRefs)) return field.evidenceRefs.filter(Boolean);

  return evidence
    .filter((item) => item.field === fieldName)
    .map((item) => item.evidenceId)
    .filter(Boolean);
}

if (typeof module !== "undefined") module.exports = RequiredFieldValidator;
if (typeof window !== "undefined") window.RequiredFieldValidator = RequiredFieldValidator;
