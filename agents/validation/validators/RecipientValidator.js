var RecipientBaseValidator =
  typeof require === "function"
    ? require("./BaseValidator")
    : window.ValidationBaseValidator;

class RecipientValidator extends RecipientBaseValidator {
  constructor(options = {}) {
    super({
      ruleId: "LOA.RECIPIENT.MATCHES_EXPECTED",
      name: "RecipientValidator",
      severity: "HIGH",
      description: "Checks that a Letter of Authorization is addressed to the expected recipient.",
      requires: {
        extractedFields: ["recipientName"],
        evidenceTypes: ["extracted_field", "document_text"],
        contextFields: ["applicationContext.recipientName"],
      },
      ...options,
    });
  }

  validate(input = {}) {
    const startedAt = new Date().toISOString();
    const expectedRecipient = getExpectedRecipient(input);
    const extractedRecipient = getExtractedRecipient(input.extraction);
    const evidenceIds = getRecipientEvidenceIds(input.extraction, input.evidence);
    const result = classifyRecipient(extractedRecipient, expectedRecipient);
    const completedAt = new Date().toISOString();

    return this.createFinding({
      input,
      status: result.status,
      severity: this.severity,
      message: result.message,
      evidenceIds,
      decision: {
        summary: result.summary,
        outcomeReason: result.outcomeReason,
        ruleDescription:
          "A Letter of Authorization must be addressed to the expected recipient supplied by the application context.",
        evaluatedInputs: [
          "extraction.fields.recipientName",
          "extraction.fields.recipient",
          "extraction.fields.addressedTo",
          "applicationContext.recipientName",
        ],
        decisionPath: [
          {
            stepId: "expected_recipient_available",
            result: expectedRecipient ? "PASS" : "REVIEW",
            explanation: expectedRecipient
              ? `Expected recipient was supplied as "${expectedRecipient}".`
              : "Expected recipient was not supplied in the application context.",
            evidenceIds: [],
          },
          {
            stepId: "extracted_recipient_available",
            result: extractedRecipient ? "PASS" : "REVIEW",
            explanation: extractedRecipient
              ? `Extracted recipient was "${extractedRecipient}".`
              : "No recipient field was available from extraction.",
            evidenceIds,
          },
          {
            stepId: "recipient_comparison",
            result: result.status,
            explanation: result.comparisonExplanation,
            evidenceIds,
          },
        ],
      },
      customerGuidance: buildCustomerGuidance(result, extractedRecipient, expectedRecipient),
      analystGuidance: {
        summary: result.analystSummary,
        ruleExecuted: this.ruleId,
        evidenceIds,
        reasoning: `Extracted recipient: ${extractedRecipient || "not found"}. Expected recipient: ${
          expectedRecipient || "not supplied"
        }. ${result.outcomeReason}`,
        suggestedAction: result.analystAction,
        reviewPriority: result.status === "FAIL" ? "HIGH" : "MEDIUM",
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
  }
}

function getExpectedRecipient(input) {
  const context = input.applicationContext || {};
  return cleanDisplayValue(context.recipientName || context.expectedRecipient || context.recipient);
}

function getExtractedRecipient(extraction = {}) {
  const fields = extraction.fields || {};
  const candidates = [fields.recipientName, fields.recipient, fields.addressedTo, fields.to];

  for (const candidate of candidates) {
    const value = getFieldValue(candidate);
    if (value) return cleanDisplayValue(value);
  }

  return "";
}

function getFieldValue(field) {
  if (!field) return "";
  if (typeof field === "string") return field;
  return field.value || field.text || "";
}

function getRecipientEvidenceIds(extraction = {}, evidence = []) {
  const fields = extraction.fields || {};
  const explicitRefs = ["recipientName", "recipient", "addressedTo", "to"]
    .flatMap((fieldName) => {
      const field = fields[fieldName];
      return field && Array.isArray(field.evidenceRefs) ? field.evidenceRefs : [];
    })
    .filter(Boolean);

  if (explicitRefs.length) return unique(explicitRefs);

  return evidence
    .filter((item) => ["recipientName", "recipient", "addressedTo", "to"].includes(item.field))
    .map((item) => item.evidenceId)
    .filter(Boolean);
}

function classifyRecipient(extractedRecipient, expectedRecipient) {
  if (!expectedRecipient) {
    return buildReview("Expected recipient is missing from the application context.");
  }

  if (!extractedRecipient) {
    return buildReview("No recipient could be extracted from the LOA.");
  }

  const normalizedExtracted = normalizeRecipient(extractedRecipient);
  const normalizedExpected = normalizeRecipient(expectedRecipient);

  if (!normalizedExtracted || !normalizedExpected) {
    return buildReview("The recipient value could not be normalized for deterministic comparison.");
  }

  if (hasAmbiguousRecipientWording(normalizedExtracted, normalizedExpected)) {
    return buildReview(
      `The extracted recipient "${extractedRecipient}" contains ambiguous wording and needs manual review.`
    );
  }

  if (recipientMatches(normalizedExtracted, normalizedExpected)) {
    return {
      status: "PASS",
      summary: "The LOA recipient matches the expected recipient.",
      message: `The Letter of Authorization is addressed to ${expectedRecipient}.`,
      outcomeReason: `The extracted recipient "${extractedRecipient}" matches the expected recipient "${expectedRecipient}".`,
      comparisonExplanation: "Deterministic normalized recipient comparison matched.",
      analystSummary: "Recipient validation passed.",
      analystAction: "No action required.",
    };
  }

  if (isClearOtherOrganization(normalizedExtracted, normalizedExpected)) {
    return {
      status: "FAIL",
      summary: "The LOA appears to be addressed to a different organization.",
      message: `The Letter of Authorization appears to be addressed to ${extractedRecipient} rather than ${expectedRecipient}.`,
      outcomeReason: `The extracted recipient "${extractedRecipient}" clearly identifies a different organization than "${expectedRecipient}".`,
      comparisonExplanation: "Deterministic normalized recipient comparison found a clear mismatch.",
      analystSummary: "Recipient validation failed because the document is addressed to another organization.",
      analystAction: `Request a replacement LOA addressed to ${expectedRecipient}.`,
    };
  }

  return buildReview(
    `The extracted recipient "${extractedRecipient}" does not deterministically match "${expectedRecipient}", but it is not a clear alternate organization.`
  );
}

function buildReview(reason) {
  return {
    status: "REVIEW",
    summary: "The LOA recipient could not be confirmed automatically.",
    message: "The Letter of Authorization recipient requires manual review.",
    outcomeReason: reason,
    comparisonExplanation: reason,
    analystSummary: "Recipient validation requires manual review.",
    analystAction: "Review the extracted recipient against the expected recipient.",
  };
}

function buildCustomerGuidance(result, extractedRecipient, expectedRecipient) {
  if (result.status === "PASS") {
    return {
      summary: "The Letter of Authorization is addressed correctly.",
      whyItMatters: "The recipient confirms who is authorized to rely on the LOA.",
      remediation: "No action is needed.",
      actions: [],
      examples: [],
    };
  }

  if (result.status === "FAIL") {
    return {
      summary: `Your Letter of Authorization appears to be addressed to ${extractedRecipient} rather than ${expectedRecipient}.`,
      whyItMatters: "The LOA must authorize the correct recipient to avoid delays or a request for more information.",
      remediation: `Please upload an LOA addressed to ${expectedRecipient}.`,
      actions: [
        {
          actionId: "upload_replacement_loa",
          type: "UPLOAD_REPLACEMENT_DOCUMENT",
          label: "Upload replacement LOA",
          description: `Upload a Letter of Authorization addressed to ${expectedRecipient}.`,
          priority: "HIGH",
        },
      ],
      examples: [`Address the LOA to ${expectedRecipient}.`],
    };
  }

  return {
    summary: "We could not confirm who the Letter of Authorization is addressed to.",
    whyItMatters: "The recipient must be clear so the authorization can be validated.",
    remediation: `Please make sure the LOA is clearly addressed to ${expectedRecipient || "the expected recipient"}.`,
    actions: [
      {
        actionId: "review_or_upload_clearer_loa",
        type: "REVIEW_OR_UPLOAD_REPLACEMENT_DOCUMENT",
        label: "Provide clearer LOA",
        description: "Upload a clearer LOA if the current document does not show the recipient plainly.",
        priority: "MEDIUM",
      },
    ],
    examples: expectedRecipient ? [`Address the LOA to ${expectedRecipient}.`] : [],
  };
}

function cleanDisplayValue(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function normalizeRecipient(value) {
  return cleanDisplayValue(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(pte|ltd|limited|inc|corp|corporation|llc|plc|co|company)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function recipientMatches(normalizedExtracted, normalizedExpected) {
  return (
    normalizedExtracted === normalizedExpected ||
    hasWholePhrase(normalizedExtracted, normalizedExpected)
  );
}

function hasAmbiguousRecipientWording(normalizedExtracted, normalizedExpected) {
  const hasExpected = hasWholePhrase(normalizedExtracted, normalizedExpected);
  const hasSeparator = /\b(and|or|for|via|care of|c o)\b/.test(normalizedExtracted) || /[/\\|]/.test(normalizedExtracted);
  const hasRemote = hasWholePhrase(normalizedExtracted, "remote");

  return (hasExpected && hasRemote) || (hasExpected && hasSeparator && normalizedExtracted !== normalizedExpected);
}

function isClearOtherOrganization(normalizedExtracted, normalizedExpected) {
  if (hasWholePhrase(normalizedExtracted, normalizedExpected)) return false;
  return /^[a-z0-9\s]+$/.test(normalizedExtracted) && normalizedExtracted.length > 1;
}

function hasWholePhrase(value, phrase) {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|\\s)${escaped}(\\s|$)`).test(value);
}

function unique(values) {
  return Array.from(new Set(values));
}

if (typeof module !== "undefined") module.exports = RecipientValidator;
if (typeof window !== "undefined") window.RecipientValidator = RecipientValidator;
