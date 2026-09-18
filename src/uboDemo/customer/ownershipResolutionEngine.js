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
export const EVIDENCE_STATUS = Object.freeze({ OPEN: "OPEN", RECEIVED: "RECEIVED", VALIDATING: "VALIDATING", SATISFIED: "SATISFIED", REJECTED: "REJECTED", ANALYSIS_UNAVAILABLE: "ANALYSIS_UNAVAILABLE", ANALYST_REVIEW: "ANALYST_REVIEW" });
export const RESOLUTION_STATUS = Object.freeze({
  RESOLVED_CUSTOMER_CONFIRMED: "RESOLVED_CUSTOMER_CONFIRMED",
  RESOLVED_EVIDENCE_VERIFIED: "RESOLVED_EVIDENCE_VERIFIED",
  RESOLVED_INDEPENDENTLY_VERIFIED: "RESOLVED_INDEPENDENTLY_VERIFIED",
  RESOLVED_NOT_MATERIAL_TO_UBO_OUTCOME: "RESOLVED_NOT_MATERIAL_TO_UBO_OUTCOME",
  RESOLVED_EXISTING_INFORMATION_SUFFICIENT: "RESOLVED_EXISTING_INFORMATION_SUFFICIENT",
  REQUIRES_ANALYST_REVIEW: "REQUIRES_ANALYST_REVIEW",
  UNRESOLVED: "UNRESOLVED",
});

export const UBO_DETERMINATION = Object.freeze({ DEFINITE_UBO: "DEFINITE_UBO", DEFINITE_NON_UBO: "DEFINITE_NON_UBO", INDETERMINATE: "INDETERMINATE" });
export const OWNERSHIP_LINK_OUTCOME = Object.freeze({
  OWNERSHIP_THRESHOLD_EXCEEDED: "OWNERSHIP_THRESHOLD_EXCEEDED",
  OWNERSHIP_THRESHOLD_NOT_EXCEEDED: "OWNERSHIP_THRESHOLD_NOT_EXCEEDED",
  OWNERSHIP_RANGE_AMBIGUOUS: "OWNERSHIP_RANGE_AMBIGUOUS",
});

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
    requestedConcepts: ["NOMINEE_RELATIONSHIP", "RELATIONSHIP_PERCENTAGE", "RELATIONSHIP_CURRENTNESS"],
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

function canonicalPartyType(value) {
  const type = normalized(value).replaceAll(" ", "_");
  if (["NATURAL_PERSON", "PERSON", "INDIVIDUAL"].includes(type)) return "NATURAL_PERSON";
  if (["LEGAL_ENTITY", "COMPANY", "LLP", "PARTNERSHIP", "PUBLIC_COMPANY", "GOVERNMENT"].includes(type)) return "LEGAL_ENTITY";
  return type || "UNKNOWN_OR_OTHER";
}

function rowHolderParty(row) { return row?.chartFact?.subject || row?.researchFact?.subject || null; }

export function idvRequiredForSubject(subject = {}) {
  return canonicalPartyType(subject.partyType || subject.entityType) === "NATURAL_PERSON"
    && (subject.isUbo === true || subject.requiresSeniorManagementFallbackIdv === true);
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

export function ownershipLinkOutcome(measurement, threshold = 25) {
  const determination = determineUboFromMeasurement(measurement, threshold);
  if (determination === UBO_DETERMINATION.DEFINITE_UBO) return OWNERSHIP_LINK_OUTCOME.OWNERSHIP_THRESHOLD_EXCEEDED;
  if (determination === UBO_DETERMINATION.DEFINITE_NON_UBO) return OWNERSHIP_LINK_OUTCOME.OWNERSHIP_THRESHOLD_NOT_EXCEEDED;
  return OWNERSHIP_LINK_OUTCOME.OWNERSHIP_RANGE_AMBIGUOUS;
}

function measurementBound(measurement, bound) {
  if (!measurement || measurement.type === "UNKNOWN") return null;
  if (measurement.type === "EXACT") return Number(measurement.value);
  if (measurement.type !== "RANGE") return null;
  const value = bound === "lower" ? measurement.lowerBound : measurement.upperBound;
  return value == null ? (bound === "lower" ? 0 : 100) : Number(value);
}

function qualifies(value, threshold = {}) {
  if (!Number.isFinite(value)) return false;
  const limit = Number(threshold.value ?? 25);
  return threshold.comparator === ">" ? value > limit : value >= limit;
}

function graphEntityName(entityId, graph, labels) {
  const node = (graph?.nodes || []).find((item) => item.entityId === entityId);
  return labels?.[entityId] || node?.primaryName || node?.displayName || node?.name || entityId;
}

function assessmentStateToDetermination(state) {
  if (["SATISFIED", "QUALIFIES", "ROUTE_SATISFIED"].includes(state)) return UBO_DETERMINATION.DEFINITE_UBO;
  if (["NOT_SATISFIED", "DOES_NOT_QUALIFY", "ROUTE_NOT_SATISFIED"].includes(state)) return UBO_DETERMINATION.DEFINITE_NON_UBO;
  return UBO_DETERMINATION.INDETERMINATE;
}

export function personOwnershipAssessmentsFromChartAnalysis(chartAnalysis, threshold = 25) {
  const view = chartAnalysis?.view;
  const graph = view?.graph;
  if (!graph) return [];
  const labels = chartAnalysis.entityLabels || {};
  const nodes = new Map((graph.nodes || []).map((node) => [node.entityId, node]));
  const relationships = new Map((graph.relationships || []).map((edge) => [edge.relationshipId, edge]));
  const qualifications = new Map((view.qualifications || graph.personQualificationAssessments || []).map((item) => [item.personEntityId, item]));
  const bases = (view.qualificationBases || graph.qualificationBasisRecords || []).filter(({ route, dimension }) => route === "EFFECTIVE_INTEREST" && dimension === "ECONOMIC");
  return bases.map((basis) => {
    const node = nodes.get(basis.personEntityId) || {};
    const qualification = qualifications.get(basis.personEntityId);
    const partyType = canonicalPartyType(node.category || node.partyType || node.entityType || node.profile?.partyType || (qualification ? "NATURAL_PERSON" : null));
    if (partyType !== "NATURAL_PERSON") return null;
    const determination = assessmentStateToDetermination(basis.assessmentState || qualification?.routeStatus);
    const policyThreshold = basis.threshold || { comparator: ">=", value: threshold, dimension: "ECONOMIC" };
    const ownershipPaths = (basis.orderedPathReferences || []).map((path) => {
      const edges = (path.relationshipIds || []).map((relationshipId) => relationships.get(relationshipId)).filter(Boolean);
      const route = edges.length
        ? [graphEntityName(edges[0].subjectEntityId || edges[0].sourceEntityId, graph, labels), ...edges.map((edge) => graphEntityName(edge.objectEntityId || edge.targetEntityId, graph, labels))]
        : "Recorded ownership path";
      return {
        pathId: path.pathId,
        relationshipIds: path.relationshipIds || [],
        route: Array.isArray(route) ? route.join(" → ") : route,
        directOwnership: edges[0]?.measurement || null,
        downstreamOwnership: edges.length > 1 ? edges.slice(1).map((edge) => edge.measurement) : [],
        inputMeasurements: edges.map((edge) => edge.measurement),
        effectiveOwnership: path.contribution || null,
      };
    });
    const assessment = {
      assessmentId: `person-ownership-assessment:${basis.personEntityId}`,
      personId: basis.personEntityId,
      personName: graphEntityName(basis.personEntityId, graph, labels),
      partyType,
      basis: "SHARE_OWNERSHIP",
      ownershipPaths,
      aggregateEffectiveOwnership: basis.recordedCalculation?.value || basis.aggregatedTargetRightValue || null,
      threshold: policyThreshold,
      policyId: basis.policyId || basis.method || "ubo-effective-ownership",
      policyVersion: basis.policyVersion || chartAnalysis.calculationSemanticsVersion || "recorded",
      determination,
      idvRequired: false,
    };
    return { ...assessment, idvRequired: idvRequiredForSubject({ partyType, isUbo: determination === UBO_DETERMINATION.DEFINITE_UBO }) };
  }).filter(Boolean);
}

function matchingPersonAssessment(row, personAssessments) {
  const subject = rowHolderParty(row);
  const entityId = subject?.entityId;
  const name = normalized(subject?.name);
  return personAssessments.find((item) => (entityId && item.personId === entityId) || normalized(item.personName) === name) || null;
}

function relationshipIdsForRow(row, chartAnalysis) {
  const graph = chartAnalysis?.view?.graph;
  if (!graph) return [];
  const factIds = new Set([row?.chartFact?.factId, row?.researchFact?.factId].filter(Boolean));
  const subjectName = normalized(rowHolderParty(row)?.name);
  const objectName = normalized(row?.chartFact?.object?.name || row?.researchFact?.object?.name);
  const labels = chartAnalysis.entityLabels || {};
  const exactMatches = (graph.relationships || []).filter((edge) => factIds.has(edge.relationshipId)).map(({ relationshipId }) => relationshipId);
  if (exactMatches.length) return exactMatches;
  return (graph.relationships || []).filter((edge) => {
    const source = graphEntityName(edge.subjectEntityId || edge.sourceEntityId, graph, labels);
    const target = graphEntityName(edge.objectEntityId || edge.targetEntityId, graph, labels);
    return normalized(source) === subjectName && normalized(target) === objectName;
  }).map(({ relationshipId }) => relationshipId);
}

export function ownershipFactMateriality(row, personAssessments = [], chartAnalysis = null, threshold = 25) {
  const holderPartyType = canonicalPartyType(rowHolderParty(row)?.entityType || rowHolderParty(row)?.partyType);
  const relationshipIds = new Set(relationshipIdsForRow(row, chartAnalysis));
  const affected = personAssessments.filter((assessment) => assessment.ownershipPaths.some((path) => path.relationshipIds.some((id) => relationshipIds.has(id))));
  if (!affected.length) return {
    material: true,
    reason: holderPartyType === "LEGAL_ENTITY"
      ? "This legal-entity ownership link may affect traversal to an ultimate natural person and cannot be dismissed at edge level."
      : "No complete aggregate natural-person assessment proves that this ownership fact cannot affect the UBO outcome.",
  };
  for (const assessment of affected) {
    if (assessment.determination === UBO_DETERMINATION.INDETERMINATE) return { material: true, reason: "The affected person's aggregate ownership assessment remains indeterminate." };
    const policyThreshold = assessment.threshold || { comparator: ">=", value: threshold };
    if (assessment.determination === UBO_DETERMINATION.DEFINITE_UBO) {
      const aggregateLower = measurementBound(assessment.aggregateEffectiveOwnership, "lower");
      const affectedUpper = assessment.ownershipPaths
        .filter((path) => path.relationshipIds.some((id) => relationshipIds.has(id)))
        .reduce((sum, path) => sum + (measurementBound(path.effectiveOwnership, "upper") || 0), 0);
      if (!qualifies((aggregateLower ?? 0) - affectedUpper, policyThreshold)) return { material: true, reason: "Removing or changing this ownership path could change the person's aggregate UBO result." };
    } else {
      const aggregateUpper = measurementBound(assessment.aggregateEffectiveOwnership, "upper");
      if (aggregateUpper == null || qualifies(aggregateUpper, policyThreshold)) return { material: true, reason: "The available aggregate range does not prove that this fact is immaterial to the person's UBO result." };
    }
  }
  return {
    material: false,
    reason: affected.every(({ determination }) => determination === UBO_DETERMINATION.DEFINITE_NON_UBO)
      ? "No further ownership verification is required for the UBO determination. Even at the highest value supported by the aggregate calculation, each affected person's ownership remains below the applicable threshold. The source claim is not independently verified."
      : "No further ownership verification is required for the UBO determination. After all ownership paths are aggregated, changing this fact cannot alter any affected person's UBO result. The source claim is not independently verified.",
  };
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

export function deriveFactRequirements(comparisonRows = [], {
  threshold = 25, answers = {}, chartAnalysis = null, personAssessments = personOwnershipAssessmentsFromChartAnalysis(chartAnalysis, threshold),
} = {}) {
  const requirements = [];
  const preResolved = [];
  comparisonRows.forEach((row) => {
    const comparisonItemId = row.key;
    if (row.status === "INDEPENDENTLY_VERIFIED") {
      preResolved.push({
        comparisonItemId,
        resolutionStatus: RESOLUTION_STATUS.RESOLVED_INDEPENDENTLY_VERIFIED,
        reason: "The customer ownership assertion is corroborated by independent information.",
      });
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
        if ([OWNERSHIP_DIFFERENCE_REASON.SHARE_TRANSFER, OWNERSHIP_DIFFERENCE_REASON.SHARE_ALLOTMENT].includes(explanationAnswer.value)) {
          requirements.push(requirement(comparisonItemId, FACT_REQUIREMENT_TYPE.OWNERSHIP_CHANGE_EFFECTIVE_DATE, row, "ESTABLISH_WHEN_CURRENT_OWNERSHIP_BECAME_EFFECTIVE", explanationAnswer.value));
        }
        requirements.push(requirement(comparisonItemId, FACT_REQUIREMENT_TYPE.EXACT_SHARE_PERCENTAGE, row, "ESTABLISH_CURRENT_SHAREHOLDING_AFTER_EXPLANATION", explanationAnswer.value));
      }
      if (explanationAnswer?.value === OWNERSHIP_DIFFERENCE_REASON.OTHER) {
        requirements.push({ ...requirement(comparisonItemId, FACT_REQUIREMENT_TYPE.EXPLAIN_OWNERSHIP_DIFFERENCE, row, "CAPTURE_OTHER_EXPLANATION_FOR_ANALYST_REVIEW", "other-details"), role: "OTHER_DETAILS" });
      }
      return;
    }
    if (row.researchFact && !row.chartFact) {
      const confirmation = requirement(comparisonItemId, FACT_REQUIREMENT_TYPE.CONFIRM_CURRENT_SHAREHOLDING, row, "RESEARCH_ONLY_REQUIRES_CUSTOMER_CONFIRMATION");
      requirements.push(confirmation);
      const confirmationAnswer = answers[id("question", confirmation.id)]?.value;
      if (confirmationAnswer === "NO") {
        requirements.push({ ...requirement(comparisonItemId, FACT_REQUIREMENT_TYPE.CONFIRM_SHAREHOLDER_REMOVED, row, "CUSTOMER_REPORTS_REGISTRY_HOLDER_REMOVED"), status: "RESOLVED", assertedValue: true });
      } else if (confirmationAnswer === "YES" && determineUboFromMeasurement(usableMeasurement(row), threshold) === UBO_DETERMINATION.INDETERMINATE) {
        requirements.push(requirement(comparisonItemId, FACT_REQUIREMENT_TYPE.EXACT_SHARE_PERCENTAGE, row, "REQUIRED_TO_DETERMINE_UBO_STATUS"));
      }
      return;
    }
    const unresolvedRequirement = requirement(
      comparisonItemId,
      FACT_REQUIREMENT_TYPE.EXACT_SHARE_PERCENTAGE,
      row,
      "REQUIRED_TO_DETERMINE_UBO_STATUS",
    );
    const existingAnswer = answers[id("question", unresolvedRequirement.id)];
    if (existingAnswer) {
      requirements.push(unresolvedRequirement);
      return;
    }
    const materiality = ownershipFactMateriality(row, personAssessments, chartAnalysis, threshold);
    if (!materiality.material) {
      preResolved.push({
        comparisonItemId,
        resolutionStatus: RESOLUTION_STATUS.RESOLVED_NOT_MATERIAL_TO_UBO_OUTCOME,
        reason: materiality.reason,
        materiality,
      });
      return;
    }
    requirements.push(unresolvedRequirement);
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
  if (item.type === FACT_REQUIREMENT_TYPE.EXPLAIN_OWNERSHIP_DIFFERENCE && item.role === "OTHER_DETAILS") return {
    ...base,
    type: QUESTION_TYPE.FREE_TEXT,
    prompt: "Please tell us why the ownership information is different.",
    explanation: "We will preserve your explanation for an analyst to review. We will not infer an ownership fact from free text.",
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
      requestedConcepts: [...(rule.requestedConcepts || ["ECONOMIC_OWNERSHIP", "RELATIONSHIP_CURRENTNESS"])],
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

function relationshipAssessment(row, resolution, personAssessments, threshold) {
  const holderParty = rowHolderParty(row) || {};
  const holderPartyType = canonicalPartyType(holderParty.entityType || holderParty.partyType);
  const measurement = resolution.resultingFact?.measurement || usableMeasurement(row);
  const personAssessment = holderPartyType === "NATURAL_PERSON" ? matchingPersonAssessment(row, personAssessments) : null;
  const determination = personAssessment?.determination || UBO_DETERMINATION.INDETERMINATE;
  return {
    ...resolution,
    holderPartyType,
    ownershipLink: {
      outcome: ownershipLinkOutcome(measurement, threshold),
      measurement,
      ownershipLinkEstablished: resolution.ownershipEstablishment !== "NOT_ESTABLISHED",
      qualifyingOwnershipInterest: ownershipLinkOutcome(measurement, threshold) === OWNERSHIP_LINK_OUTCOME.OWNERSHIP_THRESHOLD_EXCEEDED,
      continueOwnershipTraversal: holderPartyType === "LEGAL_ENTITY",
    },
    uboImpact: holderPartyType === "NATURAL_PERSON"
      ? {
        assessmentLevel: "PERSON_AGGREGATE",
        determination,
        personAssessmentId: personAssessment?.assessmentId || null,
        idvRequired: idvRequiredForSubject({ partyType: holderPartyType, isUbo: determination === UBO_DETERMINATION.DEFINITE_UBO }),
      }
      : {
        assessmentLevel: holderPartyType === "LEGAL_ENTITY" ? "NOT_APPLICABLE_LEGAL_ENTITY" : "NOT_ASSESSED_UNKNOWN_PARTY_TYPE",
        determination: null,
        idvRequired: false,
      },
  };
}

function evaluateOwnershipResolutionBase({ comparisonRows = [], answers = {}, evidence = {}, recalculations = {}, chartAnalysis = null, threshold = 25, now = new Date().toISOString() } = {}) {
  const latestChartAnalysis = Object.values(recalculations).map((record) => record?.chartAnalysis).filter(Boolean).at(-1) || chartAnalysis;
  const personOwnershipAssessments = personOwnershipAssessmentsFromChartAnalysis(latestChartAnalysis, threshold);
  const { requirements, preResolved } = deriveFactRequirements(comparisonRows, { threshold, answers, chartAnalysis: latestChartAnalysis, personAssessments: personOwnershipAssessments });
  const questions = requirements.filter(({ status }) => status !== "RESOLVED").map((item) => {
    const question = questionForRequirement(item, now);
    const answer = answers[question.id];
    if (!answer) {
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
  const rowById = new Map(comparisonRows.map((row) => [row.key, row]));
  const resolutions = new Map(preResolved.map((item) => {
    const resolution = {
      ...item,
      id: id("resolution", item.comparisonItemId),
      ownershipEstablishment: item.resolutionStatus === RESOLUTION_STATUS.RESOLVED_INDEPENDENTLY_VERIFIED
        ? "ESTABLISHED_INDEPENDENTLY_VERIFIED" : "ASSERTED_NOT_MATERIAL_TO_UBO_OUTCOME",
    };
    return [item.comparisonItemId, relationshipAssessment(rowById.get(item.comparisonItemId), resolution, personOwnershipAssessments, threshold)];
  }));

  comparisonRows.forEach((row) => {
    if (resolutions.has(row.key)) return;
    const items = requirements.filter((item) => item.comparisonItemId === row.key);
    const explanation = items.find((item) => item.type === FACT_REQUIREMENT_TYPE.EXPLAIN_OWNERSHIP_DIFFERENCE);
    const explanationAnswer = explanation && answerFor(explanation, answers)?.value;
    let resolutionStatus = RESOLUTION_STATUS.UNRESOLVED;
    let reason = row.detail || "Ownership fact remains unresolved.";
    let resultingFact = null;
    if (explanationAnswer && isAnalystAnswer(explanationAnswer)) {
      resolutionStatus = RESOLUTION_STATUS.REQUIRES_ANALYST_REVIEW;
      const otherDetails = items.find((item) => item.role === "OTHER_DETAILS");
      const detailAnswer = otherDetails && answerFor(otherDetails, answers)?.value;
      reason = detailAnswer
        ? "The customer's explanation was captured for analyst review and did not create a deterministic ownership fact."
        : "The customer explanation does not establish a deterministic ownership fact.";
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
        }
        const dateRequired = [OWNERSHIP_DIFFERENCE_REASON.SHARE_TRANSFER, OWNERSHIP_DIFFERENCE_REASON.SHARE_ALLOTMENT].includes(explanationAnswer);
        if (stored?.status === EVIDENCE_STATUS.SATISFIED && percentage && (!dateRequired || dateAnswer)) {
          resolutionStatus = RESOLUTION_STATUS.RESOLVED_EVIDENCE_VERIFIED;
          reason = "The ownership explanation, current percentage, effective date and supporting evidence have been established.";
        }
      }
    } else {
      const percentage = exactAnswerFor(requirements, answers, row.key);
      const confirmation = items.find((item) => item.type === FACT_REQUIREMENT_TYPE.CONFIRM_CURRENT_SHAREHOLDING);
      const confirmationAnswer = confirmation && answerFor(confirmation, answers)?.value;
      if (percentage) {
        resultingFact = customerOwnershipFact(row, percentage.value, answers, null, now);
        resolutionStatus = RESOLUTION_STATUS.RESOLVED_CUSTOMER_CONFIRMED;
        reason = "The customer supplied the missing ownership percentage and the UBO assessment was recalculated.";
      } else if (confirmationAnswer === "YES") {
        const confirmationDetermination = determineUboFromMeasurement(usableMeasurement(row), threshold);
        if (confirmationDetermination === UBO_DETERMINATION.INDETERMINATE) {
          resolutionStatus = RESOLUTION_STATUS.UNRESOLVED;
          reason = "Current shareholding was confirmed; the exact interest is still required.";
        } else {
          resolutionStatus = RESOLUTION_STATUS.RESOLVED_CUSTOMER_CONFIRMED;
          reason = "The customer confirmed the registry-only shareholder is current, and the existing ownership range determines UBO status.";
        }
      } else if (confirmationAnswer === "NO") {
        resolutionStatus = RESOLUTION_STATUS.REQUIRES_ANALYST_REVIEW;
        reason = "The customer says the registry-only shareholder is no longer current.";
      } else if (confirmationAnswer === "NOT_SURE") {
        resolutionStatus = RESOLUTION_STATUS.REQUIRES_ANALYST_REVIEW;
      }
    }
    resolutions.set(row.key, relationshipAssessment(row, {
      id: id("resolution", row.key),
      comparisonItemId: row.key,
      resolutionStatus,
      reason,
      resultingFact,
      ownershipEstablishment: resolutionStatus === RESOLUTION_STATUS.RESOLVED_EVIDENCE_VERIFIED ? "ESTABLISHED_EVIDENCE_VERIFIED"
        : resolutionStatus === RESOLUTION_STATUS.RESOLVED_CUSTOMER_CONFIRMED ? "ESTABLISHED_CUSTOMER_DECLARATION"
          : "NOT_ESTABLISHED",
    }, personOwnershipAssessments, threshold));
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
    chartAnalysis: latestChartAnalysis,
    requirements,
    questions,
    evidenceRequirements,
    resolutions: [...resolutions.values()],
    personOwnershipAssessments,
    openQuestions: questions.filter(({ status }) => status === QUESTION_STATUS.OPEN),
  };
}

export function evaluateOwnershipResolution({
  comparisonRows = [], answers = {}, evidence = {}, recalculations = {}, chartAnalysis = null, threshold = 25,
  topicActivations = [], analystCustomerRequests = [],
  ownershipContext = {},
  controlDiscoveryMode = CONTROL_DISCOVERY_MODE.OWNERSHIP_FIRST_THEN_CONTROL,
  customerEntityId = "CUSTOMER_ENTITY", now = new Date().toISOString(),
} = {}) {
  const base = evaluateOwnershipResolutionBase({ comparisonRows, answers, evidence, recalculations, chartAnalysis, threshold, now });
  return extendResolutionWithInvestigation({ base, comparisonRows, answers, evidence, topicActivations, analystCustomerRequests, ownershipContext, controlDiscoveryMode, customerEntityId, now });
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
  if (!savedResult || !Array.isArray(savedResult.candidateFacts) || resultingFact?.type !== "RELATIONSHIP" || resultingFact.relationship !== "ECONOMIC_OWNERSHIP") return savedResult;
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
  const nodes = chartAnalysis?.view?.graph?.nodes || [];
  const eligiblePersonIds = personIds.filter((entityId) => {
    const node = nodes.find((item) => item.entityId === entityId);
    const isRecordedPerson = (chartAnalysis?.view?.qualifications || []).some((item) => item.personEntityId === entityId);
    return canonicalPartyType(node?.category || node?.partyType || node?.entityType || node?.profile?.partyType || (isRecordedPerson ? "NATURAL_PERSON" : null)) === "NATURAL_PERSON";
  });
  if (!eligiblePersonIds.length) return UBO_DETERMINATION.INDETERMINATE;
  const assessments = chartAnalysis?.view?.qualifications || [];
  const match = assessments.find(({ personEntityId }) => eligiblePersonIds.includes(personEntityId));
  const effectiveBasis = (chartAnalysis?.view?.qualificationBases || []).find(({ personEntityId, route, dimension }) => eligiblePersonIds.includes(personEntityId) && route === "EFFECTIVE_INTEREST" && dimension === "ECONOMIC");
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
  if (evidenceRequirementRecord?.reviewMode === "ANALYST_REVIEW") return { status: EVIDENCE_STATUS.ANALYST_REVIEW, reason: "The document passed through Evidence extraction and is queued for analyst review against the declared control or special-arrangement fact." };
  if (evidenceRequirementRecord?.comparisonItemId === "ownership-comparison:nominee-declaration") {
    const declaration = resolution?.resultingFact?.declaration || {};
    const registeredHolder = normalized(declaration.REGISTERED_HOLDER);
    const underlyingOwner = normalized(declaration.UNDERLYING_OWNER);
    const interest = Number(declaration.NOMINEE_INTEREST);
    const supporting = result.candidateFacts.some((fact) => fact.type === "ENTITY_ATTRIBUTE"
      && fact.value?.relationshipType === "NOMINEE_FOR"
      && normalized(fact.subject?.name) === registeredHolder
      && normalized(fact.value?.object?.name) === underlyingOwner
      && fact.value?.relationshipValue?.kind === "EXACT"
      && Number(fact.value.relationshipValue.exact) === interest);
    return supporting
      ? { status: EVIDENCE_STATUS.SATISFIED, reason: "The existing Evidence pipeline extracted the declared nominee relationship and interest." }
      : { status: EVIDENCE_STATUS.REJECTED, reason: "The Evidence result did not establish the declared nominee holder, underlying owner and interest; analyst review is required." };
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
