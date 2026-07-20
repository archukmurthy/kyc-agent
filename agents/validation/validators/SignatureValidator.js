var SignatureBaseValidator =
  typeof require === "function"
    ? require("./BaseValidator")
    : window.ValidationBaseValidator;
var SignatureGuidanceBuilder =
  typeof require === "function"
    ? require("../guidance/guidanceBuilder")
    : window.ValidationGuidanceBuilder;

class SignatureValidator extends SignatureBaseValidator {
  constructor(options = {}) {
    super({
      ruleId: "LOA.SIGNATURE.COMPLETE",
      name: "SignatureValidator",
      severity: "HIGH",
      description: "Checks that signature evidence, printed signer name, and signer title are present.",
      requires: {
        extractedFields: ["signaturePresent", "printedSignerName", "signerTitle"],
        evidenceTypes: ["extracted_field", "page_region"],
        contextFields: [],
      },
      ...options,
    });
  }

  validate(input = {}) {
    const startedAt = new Date().toISOString();
    const checks = [
      {
        fieldName: "signaturePresent",
        label: "Signature",
        ruleId: "LOA.SIGNATURE.PRESENT",
        isPresent: signatureValidatorIsSignaturePresent(signatureValidatorGetValue(input.extraction, "signaturePresent")),
      },
      {
        fieldName: "printedSignerName",
        label: "Printed Signer Name",
        ruleId: "LOA.SIGNATURE.PRINTED_SIGNER_NAME_PRESENT",
        isPresent: signatureValidatorIsTextPresent(signatureValidatorGetValue(input.extraction, "printedSignerName")),
      },
      {
        fieldName: "signerTitle",
        label: "Signer Title",
        ruleId: "LOA.SIGNATURE.SIGNER_TITLE_PRESENT",
        isPresent: signatureValidatorIsTextPresent(signatureValidatorGetValue(input.extraction, "signerTitle")),
      },
    ];

    return checks.map((check) => {
      const status = check.isPresent ? "PASS" : "FAIL";
      const evidenceIds = signatureValidatorGetEvidenceIds(input.extraction, input.evidence, check.fieldName);
      const completedAt = new Date().toISOString();

      return this.createFinding({
        input,
        status,
        severity: this.severity,
        ruleId: check.ruleId,
        message: check.isPresent
          ? `${check.label} is present.`
          : `${check.label} is missing from the Letter of Authorization.`,
        evidenceIds,
        decision: {
          summary: check.isPresent ? `${check.label} is present.` : `${check.label} is missing.`,
          outcomeReason: check.isPresent
            ? `Extraction produced evidence for ${check.label}.`
            : `Extraction did not produce usable evidence for ${check.label}.`,
          ruleDescription: `The LOA must include ${check.label}.`,
          evaluatedInputs: [`extraction.fields.${check.fieldName}`],
          decisionPath: [
            {
              stepId: `${check.fieldName}_presence_check`,
              result: status,
              explanation: check.isPresent
                ? `${check.label} was found in extracted fields.`
                : `${check.label} was not found in extracted fields.`,
              evidenceIds,
            },
          ],
        },
        customerGuidance: SignatureGuidanceBuilder.buildCustomerGuidance({
          status,
          fieldLabel: check.label,
          problem: `${check.label} is missing from your Letter of Authorization.`,
          remediation: `Please upload an LOA that includes ${check.label}.`,
          actionId: `fix_${check.fieldName}`,
        }),
        analystGuidance: {
          summary: check.isPresent ? `${check.label} present.` : `${check.label} missing.`,
          ruleExecuted: check.ruleId,
          evidenceIds,
          reasoning: check.isPresent
            ? `The extracted ${check.label} evidence is present.`
            : `The extracted ${check.label} evidence is missing.`,
          suggestedAction: check.isPresent
            ? "No action required."
            : `Request an LOA with ${check.label}.`,
          reviewPriority: check.isPresent ? "LOW" : "HIGH",
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

function signatureValidatorGetValue(extraction = {}, fieldName) {
  const field = extraction.fields && extraction.fields[fieldName];
  if (field == null) return "";
  if (typeof field === "boolean") return field;
  if (typeof field === "string") return field;
  return field.value;
}

function signatureValidatorIsSignaturePresent(value) {
  return value === true || value === "true" || value === "present";
}

function signatureValidatorIsTextPresent(value) {
  return String(value || "").trim().length > 0;
}

function signatureValidatorGetEvidenceIds(extraction = {}, evidence = [], fieldName) {
  const field = extraction.fields && extraction.fields[fieldName];
  if (field && Array.isArray(field.evidenceRefs)) return field.evidenceRefs.filter(Boolean);

  return evidence
    .filter((item) => item.field === fieldName)
    .map((item) => item.evidenceId)
    .filter(Boolean);
}

if (typeof module !== "undefined") module.exports = SignatureValidator;
if (typeof window !== "undefined") window.SignatureValidator = SignatureValidator;
