const assert = require("assert");
const test = require("node:test");
const RecipientValidator = require("../validators/RecipientValidator");

function buildInput({ extractedRecipient, expectedRecipient = "Nium" } = {}) {
  const evidence = extractedRecipient
    ? [
        {
          evidenceId: "ev_recipient_001",
          type: "extracted_field",
          source: "extraction.fields.recipientName",
          field: "recipientName",
          value: extractedRecipient,
          text: extractedRecipient,
          pageNumber: 1,
          confidence: null,
          origin: "ocr",
          capturedAt: "2026-07-09T00:00:00Z",
        },
      ]
    : [];

  return {
    document: {
      id: "doc_001",
      type: "LOA",
      filename: "loa.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1000,
      uploadedAt: "2026-07-09T00:00:00Z",
    },
    extraction: {
      text: extractedRecipient || "",
      fields: extractedRecipient
        ? {
            recipientName: {
              value: extractedRecipient,
              evidenceRefs: ["ev_recipient_001"],
            },
          }
        : {},
      pages: [],
      extractionMetadata: {
        provider: "unit-test",
      },
    },
    evidence,
    requirementContext: {
      jurisdiction: "UK",
      documentType: "LOA",
      requiredByDrs: true,
    },
    applicationContext: {
      recipientName: expectedRecipient,
    },
    researchContext: {},
    ruleContext: {
      rulePackId: "UK.LOA",
      rulePackVersion: "0.1.0",
      activeRules: [
        {
          ruleId: "LOA.RECIPIENT.MATCHES_EXPECTED",
          description: "Recipient must match the expected application recipient.",
          severity: "HIGH",
          parameters: {},
        },
      ],
    },
    execution: {
      executionId: "exec_001",
      validationRunId: "run_001",
      environment: "unit-test",
      executedAt: "2026-07-09T00:00:00Z",
    },
  };
}

test("correct recipient returns PASS", () => {
  const finding = new RecipientValidator().validate(buildInput({ extractedRecipient: "Nium" }));

  assert.strictEqual(finding.status, "PASS");
  assert.strictEqual(finding.ruleId, "LOA.RECIPIENT.MATCHES_EXPECTED");
  assert.deepStrictEqual(finding.evidenceIds, ["ev_recipient_001"]);
  assert.ok(finding.decision.outcomeReason.includes("matches"));
});

test("Remote instead of Nium returns FAIL", () => {
  const finding = new RecipientValidator().validate(buildInput({ extractedRecipient: "Remote" }));

  assert.strictEqual(finding.status, "FAIL");
  assert.ok(finding.customerGuidance.summary.includes("Remote rather than Nium"));
  assert.ok(finding.analystGuidance.reasoning.includes("Extracted recipient: Remote"));
});

test("missing recipient returns REVIEW", () => {
  const finding = new RecipientValidator().validate(buildInput({ extractedRecipient: "" }));

  assert.strictEqual(finding.status, "REVIEW");
  assert.ok(finding.decision.outcomeReason.includes("No recipient could be extracted"));
});

test("ambiguous recipient wording returns REVIEW", () => {
  const finding = new RecipientValidator().validate(buildInput({ extractedRecipient: "Nium / Remote" }));

  assert.strictEqual(finding.status, "REVIEW");
  assert.ok(finding.decision.outcomeReason.includes("ambiguous"));
});
