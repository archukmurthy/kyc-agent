const assert = require("assert");
const test = require("node:test");
const { ValidationEngine } = require("../engine/validationEngine");

function validFields() {
  return {
    applicantName: { value: "Example Ltd" },
    recipientName: { value: "Nium" },
    issueDate: { value: new Date().toISOString().slice(0, 10) },
    signaturePresent: { value: true },
    printedSignerName: { value: "Jane Smith" },
    signerTitle: { value: "Director" },
    countryOfIssue: { value: "United Kingdom" },
  };
}

test("validation engine fails an LOA with missing required fields", async () => {
  const engine = new ValidationEngine();
  const result = await engine.validate({
    market: "UK",
    documentType: "LOA",
    document: {
      name: "sample-loa.pdf",
      type: "application/pdf",
      size: 1234,
    },
  });

  assert.strictEqual(result.status, "FAIL");
  assert.strictEqual(result.documentType, "LOA");
  assert.strictEqual(result.market, "UK");
  assert.ok(result.findings.length > 0);
  assert.strictEqual(result.extracted.documentName, "sample-loa.pdf");
});

test("validation engine passes a complete valid LOA", async () => {
  const result = await new ValidationEngine().validate({
    market: "UK",
    documentType: "LOA",
    applicationContext: { recipientName: "Nium" },
    extraction: { fields: validFields(), evidence: [] },
  });

  assert.strictEqual(result.status, "PASS");
  assert.ok(result.findings.length > 0);
  assert.ok(result.findings.every((finding) => finding.status === "PASS"));
});

test("validation engine preserves evidence supplied by extraction", async () => {
  const extractionEvidence = [{ evidenceId: "ev_recipient", field: "recipientName" }];
  const result = await new ValidationEngine().validate({
    market: "UK",
    documentType: "LOA",
    applicationContext: { recipientName: "Nium" },
    extraction: { fields: validFields(), evidence: extractionEvidence },
  });

  assert.deepStrictEqual(result.evidence, extractionEvidence);
});
