var ValidityBaseValidator =
  typeof require === "function"
    ? require("./BaseValidator")
    : window.ValidationBaseValidator;
var ValidityGuidanceBuilder =
  typeof require === "function"
    ? require("../guidance/guidanceBuilder")
    : window.ValidationGuidanceBuilder;

class ValidityValidator extends ValidityBaseValidator {
  constructor(options = {}) {
    super({
      ruleId: "LOA.VALIDITY.WITHIN_PERIOD",
      name: "ValidityValidator",
      severity: "HIGH",
      description: "Checks that the LOA issue date is within the rule-pack validity period.",
      requires: {
        extractedFields: ["issueDate"],
        evidenceTypes: ["extracted_field"],
        contextFields: ["ruleContext.activeRules"],
      },
      ...options,
    });
  }

  validate(input = {}) {
    const startedAt = new Date().toISOString();
    const rawDate = validityValidatorGetIssueDate(input.extraction);
    const parsedDate = validityValidatorParseDate(rawDate);
    const evidenceIds = validityValidatorGetEvidenceIds(input.extraction, input.evidence);
    const validityMonths = validityValidatorGetValidityMonths(input.ruleContext);
    const now = new Date();
    const cutoff = validityValidatorSubtractMonths(now, validityMonths);
    const status = validityValidatorGetStatus({ rawDate, parsedDate, validityMonths, now, cutoff });
    const completedAt = new Date().toISOString();
    const reason = validityValidatorBuildReason({ rawDate, parsedDate, validityMonths, now, cutoff, status });

    return this.createFinding({
      input,
      status,
      severity: this.severity,
      message: status === "PASS" ? "The LOA is within the configured validity period." : "The LOA is outside the configured validity period or cannot be checked.",
      evidenceIds,
      decision: {
        summary: status === "PASS" ? "LOA date is within validity period." : "LOA validity requires action.",
        outcomeReason: reason,
        ruleDescription: "The LOA issue date must be within the rule-pack validity period.",
        evaluatedInputs: ["extraction.fields.issueDate", "ruleContext.activeRules.LOA.VALIDITY.WITHIN_PERIOD.parameters.validityMonths"],
        decisionPath: [
          {
            stepId: "validity_period_loaded",
            result: validityMonths ? "PASS" : "REVIEW",
            explanation: validityMonths
              ? `Validity period loaded from rule context as ${validityMonths} months.`
              : "No validity period was available in rule context.",
            evidenceIds: [],
          },
          {
            stepId: "issue_date_available",
            result: parsedDate ? "PASS" : "FAIL",
            explanation: parsedDate ? `Issue date was parsed as ${parsedDate.toISOString().slice(0, 10)}.` : "Issue date is missing or invalid.",
            evidenceIds,
          },
          {
            stepId: "issue_date_within_validity_period",
            result: status,
            explanation: reason,
            evidenceIds,
          },
        ],
      },
      customerGuidance: ValidityGuidanceBuilder.buildCustomerGuidance({
        status,
        fieldLabel: "Date",
        problem: status === "REVIEW" ? "We could not confirm the LOA validity period." : "Your Letter of Authorization appears to be expired.",
        remediation: "Please upload a current LOA dated within the accepted validity period.",
        actionId: "upload_current_loa",
      }),
      analystGuidance: {
        summary: status === "PASS" ? "LOA date is current." : "LOA date is expired or cannot be checked.",
        ruleExecuted: this.ruleId,
        evidenceIds,
        reasoning: reason,
        suggestedAction: status === "PASS" ? "No action required." : "Request a current LOA.",
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

function validityValidatorGetValidityMonths(ruleContext = {}) {
  const rule = (ruleContext.activeRules || []).find((activeRule) => activeRule.ruleId === "LOA.VALIDITY.WITHIN_PERIOD");
  const value = rule && rule.parameters && Number(rule.parameters.validityMonths);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function validityValidatorGetIssueDate(extraction = {}) {
  const field = extraction.fields && extraction.fields.issueDate;
  if (!field) return "";
  if (typeof field === "string") return field.trim();
  return String(field.value || "").trim();
}

function validityValidatorParseDate(value) {
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

function validityValidatorSubtractMonths(date, months) {
  const result = new Date(date.getTime());
  result.setMonth(result.getMonth() - months);
  return result;
}

function validityValidatorGetStatus({ rawDate, parsedDate, validityMonths, now, cutoff }) {
  if (!validityMonths) return "REVIEW";
  if (!rawDate || !parsedDate) return "FAIL";
  if (parsedDate > now) return "FAIL";
  return parsedDate >= cutoff ? "PASS" : "FAIL";
}

function validityValidatorBuildReason({ rawDate, parsedDate, validityMonths, now, cutoff, status }) {
  if (!validityMonths) return "No validity period was supplied by the active rule context.";
  if (!rawDate) return "No issue date was extracted from the LOA.";
  if (!parsedDate) return `The extracted issue date "${rawDate}" is not a valid date.`;
  if (parsedDate > now) return `The extracted issue date "${rawDate}" is in the future.`;
  if (status === "PASS") {
    return `The extracted issue date "${rawDate}" is within the configured ${validityMonths}-month validity period.`;
  }
  return `The extracted issue date "${rawDate}" is older than the configured ${validityMonths}-month validity period ending at ${cutoff.toISOString().slice(0, 10)}.`;
}

function validityValidatorGetEvidenceIds(extraction = {}, evidence = []) {
  const field = extraction.fields && extraction.fields.issueDate;
  if (field && Array.isArray(field.evidenceRefs)) return field.evidenceRefs.filter(Boolean);

  return evidence
    .filter((item) => item.field === "issueDate")
    .map((item) => item.evidenceId)
    .filter(Boolean);
}

if (typeof module !== "undefined") module.exports = ValidityValidator;
if (typeof window !== "undefined") window.ValidityValidator = ValidityValidator;
