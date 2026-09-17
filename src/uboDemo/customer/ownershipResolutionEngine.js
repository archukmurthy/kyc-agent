import { CONTROL_DISCOVERY_MODE } from "./investigationTopics";
import { extendResolutionWithInvestigation } from "./controlDiscoveryEngine";

export const FACT_REQUIREMENT_TYPE = Object.freeze({
  EXACT_SHARE_PERCENTAGE: "EXACT_SHARE_PERCENTAGE",
  CONFIRM_CURRENT_SHAREHOLDING: "CONFIRM_CURRENT_SHAREHOLDING",
  EXPLAIN_OWNERSHIP_DIFFERENCE: "EXPLAIN_OWNERSHIP_DIFFERENCE",
  OWNERSHIP_CHANGE_OCCURRED: "OWNERSHIP_CHANGE_OCCURRED",
  OWNERSHIP_CHANGE_TYPE: "OWNERSHIP_CHANGE_TYPE",
  OWNERSHIP_CHANGE_EFFECTIVE_DATE: "OWNERSHIP_CHANGE_EFFECTIVE_DATE",
  IDENTIFY_MISSING_SHAREHOLDER: "IDENTIFY_MISSING_SHAREHOLDER",
  CONFIRM_SHAREHOLDER_REMOVED: "CONFIRM_SHAREHOLDER_REMOVED",
  CONFIRM_NOMINEE_ARRANGEMENT: "CONFIRM_NOMINEE_ARRANGEMENT",
  IDENTIFY_UNDERLYING_BENEFICIAL_OWNER: "IDENTIFY_UNDERLYING_BENEFICIAL_OWNER",
});

export const QUESTION_TYPE = Object.freeze({
  BOOLEAN: "BOOLEAN",
  SINGLE_SELECT: "SINGLE_SELECT",
  PERCENTAGE: "PERCENTAGE",
  DATE: "DATE",
  ENTITY_SELECT: "ENTITY_SELECT",
  FREE_TEXT: "FREE_TEXT",
});

export const QUESTION_STATUS = Object.freeze({ OPEN: "OPEN", ANSWERED: "ANSWERED", RESOLVED: "RESOLVED", SUPERSEDED: "SUPERSEDED" });
export const EVIDENCE_STATUS = Object.freeze({ OPEN: "OPEN", RECEIVED: "RECEIVED", VALIDATING: "VALIDATING", SATISFIED: "SATISFIED", REJECTED: "REJECTED", ANALYSIS_UNAVAILABLE: "ANALYSIS_UNAVAILABLE" });
export const RESOLUTION_STATUS = Object.freeze({
  RESOLVED_CUSTOMER_CONFIRMED: "RESOLVED_CUSTOMER_CONFIRMED",
  RESOLVED_EVIDENCE_VERIFIED: "RESOLVED_EVIDENCE_VERIFIED",
  RESOLVED_EXISTING_INFORMATION_SUFFICIENT: "RESOLVED_EXISTING_INFORMATION_SUFFICIENT",
  REQUIRES_ANALYST_REVIEW: "REQUIRES_ANALYST_REVIEW",
  UNRESOLVED: "UNRESOLVED",
});

export const UBO_DETERMINATION = Object.freeze({ DEFINITE_UBO: "DEFINITE_UBO", DEFINITE_NON_UBO: "DEFINITE_NON_UBO", INDETERMINATE: "INDETERMINATE" });

export const OWNERSHIP_DIFFERENCE_REASON = Object.freeze({
  SHARE_TRANSFER: "SHARE_TRANSFER",
  SHARE_ALLOTMENT: "SHARE_ALLOTMENT",
  REGISTRY_OUTDATED: "REGISTRY_OUTDATED",
  DIFFERENT_CIRCUMSTANCES: "DIFFERENT_CIRCUMSTANCES",
  OTHER: "OTHER",
  NOT_SURE: "NOT_SURE",
});

export const EVIDENCE_RULES = Object.freeze({
  SHARE_TRANSFER: Object.freeze({
    purpose: "Establish the current shareholding after the reported share transfer.",
    preferredEvidenceTypes: ["CURRENT_REGISTER_OF_MEMBERS"],
    alternativeEvidenceTypes: ["STOCK_TRANSFER_FORM", "BOARD_RESOLUTION", "UPDATED_SHARE_CERTIFICATE", "COMPLETION_EVIDENCE"],
  }),
  SHARE_ALLOTMENT: Object.freeze({
    purpose: "Establish the current shareholding after the reported share allotment.",
    preferredEvidenceTypes: ["CURRENT_REGISTER_OF_MEMBERS", "SH01_ALLOTMENT_FILING"],
    alternativeEvidenceTypes: ["BOARD_OR_SHAREHOLDER_RESOLUTION", "UPDATED_SHARE_CERTIFICATE", "SUBSCRIPTION_OR_INVESTMENT_AGREEMENT"],
  }),
  REGISTRY_OUTDATED: Object.freeze({
    purpose: "Establish the current shareholding where the registry information is reported as outdated or incorrect.",
    preferredEvidenceTypes: ["CURRENT_REGISTER_OF_MEMBERS"],
    alternativeEvidenceTypes: ["UPDATED_SHARE_CERTIFICATE", "BOARD_RESOLUTION", "OTHER_OWNERSHIP_EVIDENCE"],
  }),
  NOMINEE: Object.freeze({
    purpose: "Establish the declared nominee or bare-trust arrangement and its underlying beneficial owner.",
    preferredEvidenceTypes: ["NOMINEE_AGREEMENT", "DECLARATION_OF_TRUST"],
    alternativeEvidenceTypes: ["BARE_TRUST_DOCUMENT", "CUSTODY_AGREEMENT", "OTHER_SUPPORTING_EVIDENCE"],
  }),
});

const DIFFERENCE_OPTIONS = Object.freeze([
  { value: OWNERSHIP_DIFFERENCE_REASON.SHARE_TRANSFER, label: "Yes — existing shares were transferred" },
  { value: OWNERSHIP_DIFFERENCE_REASON.SHARE_ALLOTMENT, label: "Yes — new shares were issued" },
  { value: OWNERSHIP_DIFFERENCE_REASON.REGISTRY_OUTDATED, label: "No — the registry information is outdated or incorrect" },
  { value: OWNERSHIP_DIFFERENCE_REASON.DIFFERENT_CIRCUMSTANCES, label: "No — both are correct but refer to different circumstances" },
  { value: OWNERSHIP_DIFFERENCE_REASON.OTHER, label: "There is another explanation" },
  { value: OWNERSHIP_DIFFERENCE_REASON.NOT_SURE, label: "I'm not sure" },
]);

function normalized(value) { return String(value || "").trim().toUpperCase().replace(/\s+/g, " "); }
function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function safeId(value) { return String(value || "item").replace(/[^a-z0-9_.:-]+/gi, "-").replace(/-+/g, "-").slice(0, 180); }
function id(prefix, comparisonItemId, suffix = "") { return `${prefix}:${safeId(comparisonItemId)}${suffix ? `:${safeId(suffix)}` : ""}`; }
function partyName(row, side, endpoint) { return row?.[`${side}Fact`]?.[endpoint]?.name || null; }
function holder(row) { return partyName(row, "chart", "subject") || partyName(row, "research", "subject") || "the shareholder"; }
function entity(row) { return partyName(row, "chart", "object") || partyName(row, "research", "object") || "the company"; }
function usableMeasurement(row) {
  const chart = row?.chartFact?.measurement;
  const research = row?.researchFact?.measurement;
  if (chart && chart.type !== "UNKNOWN") return chart;
  if (research && research.type !== "UNKNOWN") return research;
  return chart || research || { type: "UNKNOWN" };
}

export function determineUboFromMeasurement(measurement, threshold = 25) {
  if (!measurement || measurement.type === "UNKNOWN") return UBO_DETERMINATION.INDETERMINATE;
  if (measurement.type === "EXACT") return Number(measurement.value) >= threshold ? UBO_DETERMINATION.DEFINITE_UBO : UBO_DETERMINATION.DEFINITE_NON_UBO;
  if (measurement.type !== "RANGE") return UBO_DETERMINATION.INDETERMINATE;
  const lower = measurement.lowerBound == null ? -Infinity : Number(measurement.lowerBound);
  const upper = measurement.upperBound == null ? Infinity : Number(measurement.upperBound);
  const minimumQualifies = lower > threshold || (lower === threshold && measurement.lowerInclusive !== false);
  const maximumCannotQualify = upper < threshold || (upper === threshold && measurement.upperInclusive === false);
  if (minimumQualifies) return UBO_DETERMINATION.DEFINITE_UBO;
  if (maximumCannotQualify) return UBO_DETERMINATION.DEFINITE_NON_UBO;
  return UBO_DETERMINATION.INDETERMINATE;
}

function requirement(comparisonItemId, type, row, reason, sequence = "base") {
  return {
    id: id("fact-requirement", comparisonItemId, `${type}:${sequence}`),
    comparisonItemId,
    type,
    holder: holder(row),
    entity: entity(row),
    reason,
    status: "OPEN",
  };
}

export function deriveFactRequirements(comparisonRows = [], { threshold = 25, answers = {} } = {}) {
  const requirements = [];
  const preResolved = [];
  comparisonRows.forEach((row) => {
    const comparisonItemId = row.key;
    if (row.status === "INDEPENDENTLY_VERIFIED") {
      preResolved.push({ comparisonItemId, resolutionStatus: RESOLUTION_STATUS.RESOLVED_EXISTING_INFORMATION_SUFFICIENT, uboDetermination: determineUboFromMeasurement(usableMeasurement(row), threshold) });
      return;
    }
    if (row.status === "CONFLICT") {
      const explanation = requirement(comparisonItemId, FACT_REQUIREMENT_TYPE.EXPLAIN_OWNERSHIP_DIFFERENCE, row, "REGISTRY_CUSTOMER_DISCREPANCY");
      requirements.push(explanation);
      const explanationAnswer = answers[id("question", explanation.id)];
      if ([OWNERSHIP_DIFFERENCE_REASON.SHARE_TRANSFER, OWNERSHIP_DIFFERENCE_REASON.SHARE_ALLOTMENT, OWNERSHIP_DIFFERENCE_REASON.REGISTRY_OUTDATED].includes(explanationAnswer?.value)) {
        if ([OWNERSHIP_DIFFERENCE_REASON.SHARE_TRANSFER, OWNERSHIP_DIFFERENCE_REASON.SHARE_ALLOTMENT].includes(explanationAnswer.value)) {
          requirements.push({ ...requirement(comparisonItemId, FACT_REQUIREMENT_TYPE.OWNERSHIP_CHANGE_OCCURRED, row, "CUSTOMER_EXPLANATION", explanationAnswer.value), status: "RESOLVED", assertedValue: true });
          requirements.push({ ...requirement(comparisonItemId, FACT_REQUIREMENT_TYPE.OWNERSHIP_CHANGE_TYPE, row, "CUSTOMER_EXPLANATION", explanationAnswer.value), status: "RESOLVED", assertedValue: explanationAnswer.value });
        }
        requirements.push(requirement(comparisonItemId, FACT_REQUIREMENT_TYPE.OWNERSHIP_CHANGE_EFFECTIVE_DATE, row, "ESTABLISH_WHEN_CURRENT_OWNERSHIP_BECAME_EFFECTIVE", explanationAnswer.value));
        requirements.push(requirement(comparisonItemId, FACT_REQUIREMENT_TYPE.EXACT_SHARE_PERCENTAGE, row, "ESTABLISH_CURRENT_SHAREHOLDING_AFTER_EXPLANATION", explanationAnswer.value));
      }
      return;
    }
    const determination = determineUboFromMeasurement(usableMeasurement(row), threshold);
    if (determination !== UBO_DETERMINATION.INDETERMINATE) {
      preResolved.push({ comparisonItemId, resolutionStatus: RESOLUTION_STATUS.RESOLVED_EXISTING_INFORMATION_SUFFICIENT, uboDetermination: determination });
      return;
    }
    requirements.push(requirement(comparisonItemId, row.researchFact && !row.chartFact
      ? FACT_REQUIREMENT_TYPE.CONFIRM_SHAREHOLDER_REMOVED
      : FACT_REQUIREMENT_TYPE.EXACT_SHARE_PERCENTAGE, row,
    row.researchFact && !row.chartFact ? "RESEARCH_ONLY_REQUIRES_CUSTOMER_CONFIRMATION" : "REQUIRED_TO_DETERMINE_UBO_STATUS"));
  });

  const nomineeComparisonItemId = "ownership-comparison:nominee-declaration";
  const nominee = requirement(nomineeComparisonItemId, FACT_REQUIREMENT_TYPE.CONFIRM_NOMINEE_ARRANGEMENT, null, "CUSTOMER_NOMINEE_DECLARATION", "global");
  requirements.push({ ...nominee, holder: null, entity: null });
  const nomineeAnswer = answers[id("question", nominee.id)];
  if (nomineeAnswer?.value === "YES") {
    requirements.push({ ...requirement(nomineeComparisonItemId, FACT_REQUIREMENT_TYPE.IDENTIFY_UNDERLYING_BENEFICIAL_OWNER, null, "NOMINEE_ARRANGEMENT_DECLARED", "registered-holder"), role: "REGISTERED_HOLDER", holder: null, entity: null });
    requirements.push({ ...requirement(nomineeComparisonItemId, FACT_REQUIREMENT_TYPE.IDENTIFY_UNDERLYING_BENEFICIAL_OWNER, null, "NOMINEE_ARRANGEMENT_DECLARED", "underlying-owner"), role: "UNDERLYING_OWNER", holder: null, entity: null });
    requirements.push({ ...requirement(nomineeComparisonItemId, FACT_REQUIREMENT_TYPE.EXACT_SHARE_PERCENTAGE, null, "ESTABLISH_NOMINEE_INTEREST", "nominee-interest"), role: "NOMINEE_INTEREST", holder: null, entity: null });
  }
  return { requirements, preResolved };
}

function questionForRequirement(item, createdAt) {
  const base = {
    id: id("question", item.id),
    comparisonItemId: item.comparisonItemId,
    factRequirementId: item.id,
    status: QUESTION_STATUS.OPEN,
    createdAt,
  };
  if (item.type === FACT_REQUIREMENT_TYPE.EXPLAIN_OWNERSHIP_DIFFERENCE) return {
    ...base,
    type: QUESTION_TYPE.SINGLE_SELECT,
    prompt: "Has the company's ownership changed?",
    explanation: "The ownership information you provided differs from the information currently available to us. Tell us why before we ask for any evidence.",
    options: DIFFERENCE_OPTIONS,
  };
  if (item.type === FACT_REQUIREMENT_TYPE.EXACT_SHARE_PERCENTAGE) return {
    ...base,
    type: QUESTION_TYPE.PERCENTAGE,
    prompt: item.role === "NOMINEE_INTEREST" ? "What percentage or ownership interest is held under this arrangement?" : `What percentage of ${item.entity} does ${item.holder} currently own?`,
    explanation: item.role === "NOMINEE_INTEREST" ? "Enter the ownership interest held for the underlying owner." : "We need this detail to complete the beneficial-owner assessment.",
  };
  if (item.type === FACT_REQUIREMENT_TYPE.OWNERSHIP_CHANGE_EFFECTIVE_DATE) return { ...base, type: QUESTION_TYPE.DATE, prompt: "When did this ownership change take effect?", explanation: "Use the effective date shown in the company's records." };
  if (item.type === FACT_REQUIREMENT_TYPE.CONFIRM_CURRENT_SHAREHOLDING) return {
    ...base,
    type: QUESTION_TYPE.BOOLEAN,
    prompt: `Does ${item.holder} currently own shares in ${item.entity}?`,
    explanation: "This shareholder appears in registry research but not in the ownership chart.",
    options: [{ value: "YES", label: "Yes" }, { value: "NO", label: "No" }, { value: "NOT_SURE", label: "I'm not sure" }],
  };
  if (item.type === FACT_REQUIREMENT_TYPE.CONFIRM_SHAREHOLDER_REMOVED) return {
    ...base,
    type: QUESTION_TYPE.BOOLEAN,
    prompt: `Has ${item.holder} stopped being a shareholder of ${item.entity}?`,
    explanation: "This shareholder appears in registry research but not in the ownership chart.",
    options: [{ value: "YES", label: "Yes" }, { value: "NO", label: "No" }, { value: "NOT_SURE", label: "I'm not sure" }],
  };
  if (item.type === FACT_REQUIREMENT_TYPE.IDENTIFY_MISSING_SHAREHOLDER) return {
    ...base,
    type: QUESTION_TYPE.ENTITY_SELECT,
    prompt: `Who is the missing shareholder of ${item.entity}?`,
    explanation: "Enter the person or organisation that is absent from the current ownership information.",
  };
  if (item.type === FACT_REQUIREMENT_TYPE.CONFIRM_NOMINEE_ARRANGEMENT) return {
    ...base,
    type: QUESTION_TYPE.SINGLE_SELECT,
    prompt: "Does any person or organisation shown in the ownership structure hold shares or ownership rights on behalf of another person or organisation?",
    explanation: "This includes nominee, bare trustee or similar arrangements.",
    options: [{ value: "NO", label: "No" }, { value: "YES", label: "Yes" }, { value: "NOT_SURE", label: "I'm not sure" }],
  };
  if (item.type === FACT_REQUIREMENT_TYPE.IDENTIFY_UNDERLYING_BENEFICIAL_OWNER) return {
    ...base,
    type: QUESTION_TYPE.ENTITY_SELECT,
    prompt: item.role === "REGISTERED_HOLDER" ? "Who holds the shares or ownership rights on record?" : "For whom are those shares or ownership rights held?",
    explanation: item.role === "REGISTERED_HOLDER" ? "Enter the registered holder." : "Enter the underlying person or organisation.",
  };
  return { ...base, type: QUESTION_TYPE.FREE_TEXT, prompt: "Please provide the missing ownership detail." };
}

function evidenceRequirement(comparisonItemId, factRequirementId, ruleKey, createdAt) {
  const rule = EVIDENCE_RULES[ruleKey];
  return {
    id: id("evidence-requirement", comparisonItemId, ruleKey),
    comparisonItemId,
    factRequirementId,
    purpose: rule.purpose,
    preferredEvidenceTypes: [...rule.preferredEvidenceTypes],
    alternativeEvidenceTypes: [...rule.alternativeEvidenceTypes],
    status: EVIDENCE_STATUS.OPEN,
    createdAt,
    handoff: {
      contractVersion: "ubo-external-evidence-handoff-v1",
      handoffType: "EXTERNAL_EVIDENCE_REQUIRED",
      status: "PENDING_EXTERNAL_ACTION",
      semanticEvidenceCategories: [...rule.preferredEvidenceTypes, ...rule.alternativeEvidenceTypes],
      requestedConcepts: ["ECONOMIC_OWNERSHIP", "RELATIONSHIP_CURRENTNESS"],
      requestDoesNotResolveInformationNeed: true,
      acceptsFileBytes: false,
      createsEvidenceArtifact: false,
      executionConnected: true,
      executionRoute: "/api/ubo-demo-customer-ownership-chart",
    },
  };
}

function answerFor(item, answers) { return answers[id("question", item.id)] || null; }
function isAnalystAnswer(value) { return [OWNERSHIP_DIFFERENCE_REASON.DIFFERENT_CIRCUMSTANCES, OWNERSHIP_DIFFERENCE_REASON.OTHER, OWNERSHIP_DIFFERENCE_REASON.NOT_SURE, "NOT_SURE"].includes(value); }

function exactAnswerFor(requirements, answers, comparisonItemId) {
  const item = requirements.find((candidate) => candidate.comparisonItemId === comparisonItemId && candidate.type === FACT_REQUIREMENT_TYPE.EXACT_SHARE_PERCENTAGE && candidate.role !== "NOMINEE_INTEREST");
  return item ? answerFor(item, answers) : null;
}

function evidenceKeyForExplanation(answer) {
  if (answer === OWNERSHIP_DIFFERENCE_REASON.SHARE_TRANSFER) return "SHARE_TRANSFER";
  if (answer === OWNERSHIP_DIFFERENCE_REASON.SHARE_ALLOTMENT) return "SHARE_ALLOTMENT";
  if (answer === OWNERSHIP_DIFFERENCE_REASON.REGISTRY_OUTDATED) return "REGISTRY_OUTDATED";
  return null;
}

function evaluateOwnershipResolutionBase({ comparisonRows = [], answers = {}, evidence = {}, recalculations = {}, threshold = 25, now = new Date().toISOString() } = {}) {
  const { requirements, preResolved } = deriveFactRequirements(comparisonRows, { threshold, answers });
  const questions = requirements.filter(({ status }) => status !== "RESOLVED").map((item) => {
    const question = questionForRequirement(item, now);
    const answer = answers[question.id];
    if (!answer) {
      const recalculated = recalculations[item.comparisonItemId]?.determination;
      if (item.type === FACT_REQUIREMENT_TYPE.EXACT_SHARE_PERCENTAGE && recalculated && recalculated !== UBO_DETERMINATION.INDETERMINATE) return { ...question, status: QUESTION_STATUS.SUPERSEDED };
      return question;
    }
    let status = QUESTION_STATUS.RESOLVED;
    if (item.type === FACT_REQUIREMENT_TYPE.EXPLAIN_OWNERSHIP_DIFFERENCE && !isAnalystAnswer(answer.value)) status = QUESTION_STATUS.ANSWERED;
    if (item.type === FACT_REQUIREMENT_TYPE.OWNERSHIP_CHANGE_EFFECTIVE_DATE) status = QUESTION_STATUS.ANSWERED;
    if (item.type === FACT_REQUIREMENT_TYPE.CONFIRM_NOMINEE_ARRANGEMENT && answer.value === "YES") status = QUESTION_STATUS.ANSWERED;
    if (item.type === FACT_REQUIREMENT_TYPE.IDENTIFY_UNDERLYING_BENEFICIAL_OWNER) status = QUESTION_STATUS.ANSWERED;
    return { ...question, status, answeredAt: answer.answeredAt || now };
  });
  const evidenceRequirements = [];
  const resolutions = new Map(preResolved.map((item) => [item.comparisonItemId, {
    ...item,
    id: id("resolution", item.comparisonItemId),
    ownershipEstablishment: "ESTABLISHED_EXISTING_INFORMATION",
    uboImpact: { determination: item.uboDetermination, idvRequired: item.uboDetermination === UBO_DETERMINATION.DEFINITE_UBO },
  }]));

  comparisonRows.forEach((row) => {
    if (resolutions.has(row.key)) return;
    const items = requirements.filter((item) => item.comparisonItemId === row.key);
    const explanation = items.find((item) => item.type === FACT_REQUIREMENT_TYPE.EXPLAIN_OWNERSHIP_DIFFERENCE);
    const explanationAnswer = explanation && answerFor(explanation, answers)?.value;
    let resolutionStatus = RESOLUTION_STATUS.UNRESOLVED;
    let reason = row.detail || "Ownership fact remains unresolved.";
    let determination = UBO_DETERMINATION.INDETERMINATE;
    let resultingFact = null;
    if (explanationAnswer && isAnalystAnswer(explanationAnswer)) {
      resolutionStatus = RESOLUTION_STATUS.REQUIRES_ANALYST_REVIEW;
      reason = "The customer explanation does not establish a deterministic ownership fact.";
    } else if (explanationAnswer) {
      const ruleKey = evidenceKeyForExplanation(explanationAnswer);
      if (ruleKey) {
        const evidenceRecord = evidenceRequirement(row.key, explanation.id, ruleKey, now);
        const stored = evidence[evidenceRecord.id];
        evidenceRequirements.push(stored ? { ...evidenceRecord, ...stored } : evidenceRecord);
        const percentage = exactAnswerFor(requirements, answers, row.key);
        const dateRequirement = items.find((item) => item.type === FACT_REQUIREMENT_TYPE.OWNERSHIP_CHANGE_EFFECTIVE_DATE);
        const dateAnswer = dateRequirement && answerFor(dateRequirement, answers);
        if (percentage) {
          resultingFact = customerOwnershipFact(row, percentage.value, answers, dateAnswer?.value || null, now);
          determination = recalculations[row.key]?.determination || determineUboFromMeasurement({ type: "EXACT", value: percentage.value }, threshold);
        }
        if (stored?.status === EVIDENCE_STATUS.SATISFIED && percentage && dateAnswer) {
          resolutionStatus = RESOLUTION_STATUS.RESOLVED_EVIDENCE_VERIFIED;
          reason = "The ownership explanation, current percentage, effective date and supporting evidence have been established.";
        }
      }
    } else {
      const percentage = exactAnswerFor(requirements, answers, row.key);
      const confirmation = items.find((item) => [FACT_REQUIREMENT_TYPE.CONFIRM_CURRENT_SHAREHOLDING, FACT_REQUIREMENT_TYPE.CONFIRM_SHAREHOLDER_REMOVED].includes(item.type));
      const confirmationAnswer = confirmation && answerFor(confirmation, answers)?.value;
      if (percentage) {
        resultingFact = customerOwnershipFact(row, percentage.value, answers, null, now);
        determination = recalculations[row.key]?.determination || determineUboFromMeasurement({ type: "EXACT", value: percentage.value }, threshold);
        resolutionStatus = RESOLUTION_STATUS.RESOLVED_CUSTOMER_CONFIRMED;
        reason = "The customer supplied the missing ownership percentage and the UBO assessment was recalculated.";
      } else if (confirmation?.type === FACT_REQUIREMENT_TYPE.CONFIRM_SHAREHOLDER_REMOVED && confirmationAnswer === "YES") {
        resolutionStatus = RESOLUTION_STATUS.REQUIRES_ANALYST_REVIEW;
        reason = "The customer says the registry-only shareholder has been removed; the change must be reviewed.";
      } else if (confirmationAnswer === "YES") {
        resolutionStatus = RESOLUTION_STATUS.UNRESOLVED;
        reason = "Current shareholding was confirmed; the exact interest is still required.";
      } else if (confirmationAnswer === "NO") {
        resolutionStatus = RESOLUTION_STATUS.REQUIRES_ANALYST_REVIEW;
        reason = "The customer says the registry-only shareholder is no longer current.";
      } else if (confirmationAnswer === "NOT_SURE") {
        resolutionStatus = RESOLUTION_STATUS.REQUIRES_ANALYST_REVIEW;
      }
    }
    resolutions.set(row.key, {
      id: id("resolution", row.key),
      comparisonItemId: row.key,
      resolutionStatus,
      reason,
      resultingFact,
      ownershipEstablishment: resolutionStatus === RESOLUTION_STATUS.RESOLVED_EVIDENCE_VERIFIED ? "ESTABLISHED_EVIDENCE_VERIFIED"
        : resolutionStatus === RESOLUTION_STATUS.RESOLVED_CUSTOMER_CONFIRMED ? "ESTABLISHED_CUSTOMER_DECLARATION"
          : resolutionStatus === RESOLUTION_STATUS.RESOLVED_EXISTING_INFORMATION_SUFFICIENT ? "ESTABLISHED_EXISTING_INFORMATION" : "NOT_ESTABLISHED",
      uboImpact: { determination, idvRequired: determination === UBO_DETERMINATION.DEFINITE_UBO },
    });
  });

  const nomineeItem = requirements.find((item) => item.type === FACT_REQUIREMENT_TYPE.CONFIRM_NOMINEE_ARRANGEMENT);
  const nomineeAnswer = answerFor(nomineeItem, answers)?.value;
  const nomineeResolutionId = nomineeItem.comparisonItemId;
  if (nomineeAnswer === "NO") resolutions.set(nomineeResolutionId, {
    id: id("resolution", nomineeResolutionId), comparisonItemId: nomineeResolutionId,
    resolutionStatus: RESOLUTION_STATUS.RESOLVED_CUSTOMER_CONFIRMED,
    reason: "Customer declared that no nominee, bare-trust or similar arrangement applies.",
    resultingFact: { type: "ENTITY_ATTRIBUTE", attribute: "nominee_arrangement", value: false, evidenceReferences: [] },
    ownershipEstablishment: "ESTABLISHED_CUSTOMER_DECLARATION",
    uboImpact: { determination: UBO_DETERMINATION.INDETERMINATE, idvRequired: false },
  });
  if (nomineeAnswer === "NOT_SURE") resolutions.set(nomineeResolutionId, {
    id: id("resolution", nomineeResolutionId), comparisonItemId: nomineeResolutionId,
    resolutionStatus: RESOLUTION_STATUS.REQUIRES_ANALYST_REVIEW,
    reason: "Customer could not confirm whether a nominee arrangement applies.", resultingFact: null,
    ownershipEstablishment: "NOT_ESTABLISHED",
    uboImpact: { determination: UBO_DETERMINATION.INDETERMINATE, idvRequired: false },
  });
  if (nomineeAnswer === "YES") {
    const nomineeEvidence = evidenceRequirement(nomineeResolutionId, nomineeItem.id, "NOMINEE", now);
    const stored = evidence[nomineeEvidence.id];
    evidenceRequirements.push(stored ? { ...nomineeEvidence, ...stored } : nomineeEvidence);
    const nomineeDetails = requirements.filter((item) => item.comparisonItemId === nomineeResolutionId && item.id !== nomineeItem.id);
    const complete = nomineeDetails.every((item) => Boolean(answerFor(item, answers)?.value));
    resolutions.set(nomineeResolutionId, {
      id: id("resolution", nomineeResolutionId), comparisonItemId: nomineeResolutionId,
      resolutionStatus: complete && stored?.status === EVIDENCE_STATUS.SATISFIED ? RESOLUTION_STATUS.RESOLVED_EVIDENCE_VERIFIED : RESOLUTION_STATUS.UNRESOLVED,
      reason: complete ? "Nominee facts were declared; supporting evidence is required." : "Nominee arrangement declared; holder, underlying owner and interest are required.",
      resultingFact: complete ? { type: "NOMINEE_ARRANGEMENT", declaration: Object.fromEntries(nomineeDetails.map((item) => [item.role, answerFor(item, answers).value])) } : null,
      ownershipEstablishment: complete && stored?.status === EVIDENCE_STATUS.SATISFIED ? "ESTABLISHED_EVIDENCE_VERIFIED" : "NOT_ESTABLISHED",
      uboImpact: { determination: UBO_DETERMINATION.INDETERMINATE, idvRequired: false },
    });
  }

  return {
    contractVersion: "ubo-ownership-resolution-state-v1",
    generatedAt: now,
    requirements,
    questions,
    evidenceRequirements,
    resolutions: [...resolutions.values()],
    openQuestions: questions.filter(({ status }) => status === QUESTION_STATUS.OPEN),
  };
}

export function evaluateOwnershipResolution({
  comparisonRows = [], answers = {}, evidence = {}, recalculations = {}, threshold = 25,
  topicActivations = [], analystCustomerRequests = [],
  controlDiscoveryMode = CONTROL_DISCOVERY_MODE.OWNERSHIP_FIRST_THEN_CONTROL,
  customerEntityId = "CUSTOMER_ENTITY", now = new Date().toISOString(),
} = {}) {
  const base = evaluateOwnershipResolutionBase({ comparisonRows, answers, evidence, recalculations, threshold, now });
  return extendResolutionWithInvestigation({ base, comparisonRows, answers, topicActivations, analystCustomerRequests, controlDiscoveryMode, customerEntityId, now });
}

export function customerOwnershipFact(row, percentage, answers = {}, effectiveDate = null, recordedAt = new Date().toISOString()) {
  const value = Number(percentage);
  if (!Number.isFinite(value) || value < 0 || value > 100) throw new TypeError("Ownership percentage must be from 0 to 100.");
  const source = row.chartFact || row.researchFact;
  const answerQuestionIds = Object.keys(answers).filter((key) => key.includes(safeId(row.key)));
  const declarationReferenceId = answerQuestionIds[0] || id("customer-declaration", row.key);
  return {
    factId: id("customer-resolution-fact", row.key),
    type: "RELATIONSHIP",
    relationship: "ECONOMIC_OWNERSHIP",
    subject: clone(source.subject),
    object: clone(source.object),
    measurement: { type: "EXACT", value },
    qualifiers: {
      ...(source.qualifiers || {}),
      currentState: "CURRENT",
      economicInterestConcept: source.qualifiers?.economicInterestConcept || "SHARE_OWNERSHIP",
      customerResolution: true,
      sourceComparisonItemId: row.key,
      ...(effectiveDate ? { effectiveDate } : {}),
    },
    evidenceReferences: [{
      system: "ubo-questions-resolution",
      referenceType: "CUSTOMER_DECLARATION",
      referenceId: declarationReferenceId,
      locator: { comparisonItemId: row.key, recordedAt },
    }],
    provenance: { source: "CUSTOMER_ANSWER", recordedAt, answerQuestionIds },
  };
}

export function applyResultingFact(savedResult, resultingFact) {
  if (!savedResult || !Array.isArray(savedResult.candidateFacts) || !resultingFact) return savedResult;
  const sameRelationship = (fact) => fact.type === "RELATIONSHIP" && fact.relationship === resultingFact.relationship
    && normalized(fact.subject?.name) === normalized(resultingFact.subject?.name)
    && normalized(fact.object?.name) === normalized(resultingFact.object?.name);
  const candidateFacts = savedResult.candidateFacts.filter((fact) => !sameRelationship(fact));
  candidateFacts.push(resultingFact);
  return { ...clone(savedResult), candidateFacts };
}

export function determinationFromChartAnalysis(chartAnalysis, resultingFact, threshold = 25) {
  const name = normalized(resultingFact?.subject?.name);
  const labels = chartAnalysis?.entityLabels || {};
  const personIds = Object.entries(labels).filter(([, label]) => normalized(label) === name).map(([entityId]) => entityId);
  const assessments = chartAnalysis?.view?.qualifications || [];
  const match = assessments.find(({ personEntityId }) => personIds.includes(personEntityId));
  const effectiveBasis = (chartAnalysis?.view?.qualificationBases || []).find(({ personEntityId, route, dimension }) => personIds.includes(personEntityId) && route === "EFFECTIVE_INTEREST" && dimension === "ECONOMIC");
  if (effectiveBasis?.assessmentState === "SATISFIED") return UBO_DETERMINATION.DEFINITE_UBO;
  if (effectiveBasis?.assessmentState === "NOT_SATISFIED") return UBO_DETERMINATION.DEFINITE_NON_UBO;
  if (["INDETERMINATE", "REVIEW_REQUIRED"].includes(effectiveBasis?.assessmentState)) return UBO_DETERMINATION.INDETERMINATE;
  if (["SATISFIED", "ROUTE_SATISFIED"].includes(match?.routeStatus)) return UBO_DETERMINATION.DEFINITE_UBO;
  if (["NOT_SATISFIED", "ROUTE_NOT_SATISFIED"].includes(match?.routeStatus)) return UBO_DETERMINATION.DEFINITE_NON_UBO;
  if (["INDETERMINATE", "ROUTE_INDETERMINATE", "REVIEW_REQUIRED", "ROUTE_REVIEW_REQUIRED"].includes(match?.routeStatus)) return UBO_DETERMINATION.INDETERMINATE;
  return determineUboFromMeasurement(resultingFact?.measurement, threshold);
}

export function evidenceResultStatus(result, resolution, evidenceRequirementRecord) {
  if (!result?.artifact?.integrityVerified || !Array.isArray(result?.candidateFacts)) return { status: EVIDENCE_STATUS.REJECTED, reason: "The Evidence pipeline did not return an integrity-checked structured result." };
  if (evidenceRequirementRecord?.comparisonItemId === "ownership-comparison:nominee-declaration") {
    return result.candidateFacts.length ? { status: EVIDENCE_STATUS.SATISFIED, reason: "Evidence was staged and interpreted by the existing pipeline for analyst review." }
      : { status: EVIDENCE_STATUS.REJECTED, reason: "No structured facts were extracted from the supporting evidence." };
  }
  const expected = resolution?.resultingFact;
  const supporting = result.candidateFacts.some((fact) => fact.type === "RELATIONSHIP"
    && fact.relationship === "ECONOMIC_OWNERSHIP"
    && normalized(fact.subject?.name) === normalized(expected?.subject?.name)
    && normalized(fact.object?.name) === normalized(expected?.object?.name)
    && fact.measurement?.type === "EXACT"
    && Number(fact.measurement.value) === Number(expected?.measurement?.value));
  return supporting
    ? { status: EVIDENCE_STATUS.SATISFIED, reason: "The existing Evidence pipeline extracted a matching current ownership assertion." }
    : { status: EVIDENCE_STATUS.REJECTED, reason: "The Evidence result did not establish the declared current ownership assertion; analyst review is required." };
}
