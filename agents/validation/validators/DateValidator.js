var DateBaseValidator =
  typeof require === "function"
    ? require("./BaseValidator")
    : window.ValidationBaseValidator;
var DateGuidanceBuilder =
  typeof require === "function"
    ? require("../guidance/guidanceBuilder")
    : window.ValidationGuidanceBuilder;

class DateValidator extends DateBaseValidator {
  constructor(options = {}) {
    super({
      ruleId: "LOA.DATE.VALID",
      name: "DateValidator",
      severity: "HIGH",
      description: "Checks that the LOA issue date is present and valid.",
      requires: {
        extractedFields: ["issueDate"],
        evidenceTypes: ["extracted_field"],
        contextFields: [],
      },
      ...options,
    });
  }

  validate(input = {}) {
    const startedAt = new Date().toISOString();
    const rawDate = dateValidatorGetIssueDate(input.extraction);
    const evidenceIds = dateValidatorGetEvidenceIds(input.extraction, input.evidence);
    const parsedDate = dateValidatorParseDate(rawDate);
    const status = !rawDate || !parsedDate ? "FAIL" : "PASS";
    const completedAt = new Date().toISOString();
    const reason = !rawDate
      ? "No issue date was extracted from the LOA."
      : !parsedDate
        ? `The extracted issue date "${rawDate}" is not a valid date.`
        : `The extracted issue date "${rawDate}" is valid.`;

    return this.createFinding({
      input,
      status,
      severity: this.severity,
      message: status === "PASS" ? "The LOA date is present and valid." : "The LOA date is missing or invalid.",
      evidenceIds,
      decision: {
        summary: status === "PASS" ? "LOA date is valid." : "LOA date could not be validated.",
        outcomeReason: reason,
        ruleDescription: "The LOA must include a valid issue date.",
        evaluatedInputs: ["extraction.fields.issueDate"],
        decisionPath: [
          {
            stepId: "issue_date_present",
            result: rawDate ? "PASS" : "FAIL",
            explanation: rawDate ? `Issue date was extracted as "${rawDate}".` : "No issue date was extracted.",
            evidenceIds,
          },
          {
            stepId: "issue_date_parseable",
            result: parsedDate ? "PASS" : "FAIL",
            explanation: parsedDate ? "The issue date parsed to a valid calendar date." : "The issue date did not parse to a valid calendar date.",
            evidenceIds,
          },
        ],
      },
      customerGuidance: DateGuidanceBuilder.buildCustomerGuidance({
        status,
        fieldLabel: "Date",
        problem: !rawDate ? "Your Letter of Authorization is missing a date." : "Your Letter of Authorization has an invalid date.",
        remediation: "Please upload an LOA with a clear valid issue date.",
        actionId: "fix_issue_date",
      }),
      analystGuidance: {
        summary: status === "PASS" ? "Issue date valid." : "Issue date missing or invalid.",
        ruleExecuted: this.ruleId,
        evidenceIds,
        reasoning: reason,
        suggestedAction: status === "PASS" ? "No action required." : "Request an LOA with a clear valid issue date.",
        reviewPriority: status === "PASS" ? "LOW" : "HIGH",
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

function dateValidatorGetIssueDate(extraction = {}) {
  const field = extraction.fields && extraction.fields.issueDate;
  if (!field) return "";
  if (typeof field === "string") return field.trim();
  return String(field.value || "").trim();
}

function dateValidatorParseDate(value) {
  const dateValue = String(value || "").trim();
  if (!dateValue) return null;

  const isoMatch = dateValue.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]);
    const day = Number(isoMatch[3]);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (
      parsed.getUTCFullYear() === year &&
      parsed.getUTCMonth() === month - 1 &&
      parsed.getUTCDate() === day
    ) {
      return parsed;
    }
    return null;
  }

  const parsed = new Date(dateValue);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function dateValidatorGetEvidenceIds(extraction = {}, evidence = []) {
  const field = extraction.fields && extraction.fields.issueDate;
  if (field && Array.isArray(field.evidenceRefs)) return field.evidenceRefs.filter(Boolean);

  return evidence
    .filter((item) => item.field === "issueDate")
    .map((item) => item.evidenceId)
    .filter(Boolean);
}

if (typeof module !== "undefined") module.exports = DateValidator;
if (typeof window !== "undefined") window.DateValidator = DateValidator;
