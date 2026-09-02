const assert = require("assert");
const test = require("node:test");
const DateValidator = require("../validators/DateValidator");
const RequiredFieldValidator = require("../validators/RequiredFieldValidator");
const SignatureValidator = require("../validators/SignatureValidator");
const ValidityValidator = require("../validators/ValidityValidator");

function buildInput(overrides = {}) {
  const fields = {
    applicantName: { value: "Example Ltd", evidenceRefs: ["ev_applicantName"] },
    recipientName: { value: "the Platform", evidenceRefs: ["ev_recipientName"] },
    issueDate: { value: new Date().toISOString().slice(0, 10), evidenceRefs: ["ev_issueDate"] },
    signaturePresent: { value: true, evidenceRefs: ["ev_signaturePresent"] },
    printedSignerName: { value: "Jane Smith", evidenceRefs: ["ev_printedSignerName"] },
    signerTitle: { value: "Director", evidenceRefs: ["ev_signerTitle"] },
    countryOfIssue: { value: "United Kingdom", evidenceRefs: ["ev_countryOfIssue"] },
    ...overrides.fields,
  };

  return {
    extraction: {
      text: "",
      fields,
      pages: [],
      extractionMetadata: { provider: "unit-test" },
    },
    evidence: Object.keys(fields).map((fieldName) => ({
      evidenceId: `ev_${fieldName}`,
      field: fieldName,
      value: fields[fieldName] && fields[fieldName].value,
    })),
    ruleContext: {
      rulePackId: "UK.LOA",
      rulePackVersion: "0.1.0",
      activeRules: [
        {
          ruleId: "LOA.REQUIRED_FIELDS.PRESENT",
          description: "Required fields",
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
          ruleId: "LOA.VALIDITY.WITHIN_PERIOD",
          description: "Validity",
          severity: "HIGH",
          parameters: { validityMonths: 12 },
        },
      ],
    },
    execution: { executionId: "exec_001" },
  };
}

test("RequiredFieldValidator fails each missing required field", () => {
  const input = buildInput({
    fields: {
      applicantName: { value: "", evidenceRefs: [] },
      countryOfIssue: { value: "", evidenceRefs: [] },
    },
  });
  const findings = new RequiredFieldValidator().validate(input);

  assert.strictEqual(findings.find((finding) => finding.ruleId === "LOA.REQUIRED_FIELD.APPLICANT_NAME").status, "FAIL");
  assert.strictEqual(findings.find((finding) => finding.ruleId === "LOA.REQUIRED_FIELD.COUNTRY_OF_ISSUE").status, "FAIL");
});

test("DateValidator passes a valid date and fails an invalid date", () => {
  assert.strictEqual(new DateValidator().validate(buildInput()).status, "PASS");
  assert.strictEqual(
    new DateValidator().validate(buildInput({ fields: { issueDate: { value: "2026-02-31", evidenceRefs: ["ev_issueDate"] } } })).status,
    "FAIL"
  );
});

test("ValidityValidator fails an expired date using rule context months", () => {
  const expired = buildInput({
    fields: { issueDate: { value: "2020-01-01", evidenceRefs: ["ev_issueDate"] } },
  });

  assert.strictEqual(new ValidityValidator().validate(expired).status, "FAIL");
});

test("SignatureValidator fails missing signature components", () => {
  const input = buildInput({
    fields: {
      signaturePresent: { value: false, evidenceRefs: [] },
      printedSignerName: { value: "", evidenceRefs: [] },
      signerTitle: { value: "", evidenceRefs: [] },
    },
  });
  const findings = new SignatureValidator().validate(input);

  assert.strictEqual(findings.find((finding) => finding.ruleId === "LOA.SIGNATURE.PRESENT").status, "FAIL");
  assert.strictEqual(findings.find((finding) => finding.ruleId === "LOA.SIGNATURE.PRINTED_SIGNER_NAME_PRESENT").status, "FAIL");
  assert.strictEqual(findings.find((finding) => finding.ruleId === "LOA.SIGNATURE.SIGNER_TITLE_PRESENT").status, "FAIL");
});
