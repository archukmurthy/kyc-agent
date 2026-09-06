"use strict";

const {
  assertAllowedKeys,
  assertArray,
  assertDataOnly,
  assertEnum,
  assertNonEmptyString,
  assertPlainObject,
  cloneData,
  deepFreeze,
  fail,
} = require("../internal/validation");
const { hashArtifact } = require("../internal/phasedArtifact");
const { canonicalizeJson } = require("../policy/canonicalJson");
const {
  CAPABILITY_STATE,
  ENTITLEMENT_STATE,
  MATCH_STATE,
  OUTPUT_CHARACTERISTIC,
  PROFILE_FRESHNESS_STATE,
  evaluateProfileFreshness,
  matchRegistryCapabilityEntry,
  validateRegistryCapabilityProfileV1,
} = require("./registryCapabilityProfileV1");

const RESOLUTION_PLANNER_V2 = "ubo-low-friction-planner-v2";
const RESOLUTION_PLAN_V2 = "ubo-resolution-plan-v2";
const RESOLUTION_GROUP_V1 = "ubo-resolution-group-v1";
const ACQUISITION_STRATEGY_ASSIGNMENT_V1 = "ubo-acquisition-strategy-assignment-v1";
const RESOLUTION_ACTION_V2 = "ubo-resolution-action-v2";
const PLANNING_WAVE_V2 = "ubo-planning-wave-v2";
const PROFILE_SIGNOFF = "A-15";

const PLAN_STATE = Object.freeze({
  SYSTEM_RESOLUTION: "SYSTEM_RESOLUTION",
  CUSTOMER_RESOLUTION: "CUSTOMER_RESOLUTION",
  INTERNAL_REVIEW: "INTERNAL_REVIEW",
  SPECIALIST_REVIEW: "SPECIALIST_REVIEW",
  COMPLETE: "COMPLETE",
  BLOCKED: "BLOCKED",
});
const WAVE_ACTOR = Object.freeze({ SYSTEM: "SYSTEM", CUSTOMER: "CUSTOMER", INTERNAL: "INTERNAL", SPECIALIST: "SPECIALIST", NONE: "NONE" });
const ACQUISITION_STRATEGY = Object.freeze({ DISCOVERY_LED: "DISCOVERY_LED", CHART_ASSISTED: "CHART_ASSISTED", SPECIALIST: "SPECIALIST", NOT_APPLICABLE: "NOT_APPLICABLE" });
const ACTION_TYPE = Object.freeze({
  DISCOVER_INFORMATION: "DISCOVER_INFORMATION",
  EXTRACT_EXISTING_ARTIFACT: "EXTRACT_EXISTING_ARTIFACT",
  USE_EXISTING_EVIDENCE: "USE_EXISTING_EVIDENCE",
  RETRY_CAPABILITY: "RETRY_CAPABILITY",
  HOLD_FOR_OPERATIONAL_RECOVERY: "HOLD_FOR_OPERATIONAL_RECOVERY",
  REQUEST_STRUCTURE_EVIDENCE: "REQUEST_STRUCTURE_EVIDENCE",
  REQUEST_TARGETED_EVIDENCE: "REQUEST_TARGETED_EVIDENCE",
  REQUEST_STRUCTURED_INFORMATION: "REQUEST_STRUCTURED_INFORMATION",
  CONFIRM_ESTABLISHED_INFORMATION: "CONFIRM_ESTABLISHED_INFORMATION",
  INTERNAL_REVIEW: "INTERNAL_REVIEW",
  SPECIALIST_REVIEW: "SPECIALIST_REVIEW",
});
const CONTENT_READINESS = Object.freeze({ READY: "READY", NOT_REQUIRED: "NOT_REQUIRED", REQUIRES_POLICY_CONTENT: "REQUIRES_POLICY_CONTENT" });
const GROUP_TYPE = Object.freeze({ STRUCTURAL_FRONTIER: "STRUCTURAL_FRONTIER", GOVERNANCE_FRONTIER: "GOVERNANCE_FRONTIER", PERSON_ATTRIBUTES: "PERSON_ATTRIBUTES", EVIDENCE_CONDITION: "EVIDENCE_CONDITION", TARGETED_FACT: "TARGETED_FACT" });
const SUBSTANTIVE_OUTCOMES = new Set(["NO_DATA", "UNSUPPORTED"]);
const OPERATIONAL_OUTCOMES = new Set(["UNAVAILABLE", "FAILED"]);
const CUSTOMER_ACTIONS = new Set([ACTION_TYPE.REQUEST_STRUCTURE_EVIDENCE, ACTION_TYPE.REQUEST_TARGETED_EVIDENCE, ACTION_TYPE.REQUEST_STRUCTURED_INFORMATION, ACTION_TYPE.CONFIRM_ESTABLISHED_INFORMATION]);
const SYSTEM_ACTIONS = new Set([ACTION_TYPE.DISCOVER_INFORMATION, ACTION_TYPE.EXTRACT_EXISTING_ARTIFACT, ACTION_TYPE.USE_EXISTING_EVIDENCE, ACTION_TYPE.RETRY_CAPABILITY, ACTION_TYPE.HOLD_FOR_OPERATIONAL_RECOVERY]);
const STRUCTURAL_CONCEPTS = new Set(["CURRENT_OWNERSHIP_AND_CONTROL", "ADDITIONAL_DIRECT_HOLDER", "RELATIONSHIP_PERCENTAGE", "RELATIONSHIP_CURRENTNESS", "LAYER_QUALIFIER", "INDEPENDENT_CORROBORATION", "LLP_GOVERNANCE_CONTROL_BASIS", "VOTING_CONTROL_STATUS", "APPOINTMENT_MAJORITY_SCOPE", "OTHER_SIGNIFICANT_CONTROL_STATUS", "TRUST_STATUS", "UNDERLYING_NOMINEE_PRINCIPAL", "NOMINEE_BEARER_STATUS", "STRUCTURE_CYCLE"]);
const GOVERNANCE_CONCEPTS = new Set(["LLP_GOVERNANCE_CONTROL_BASIS", "VOTING_CONTROL_STATUS", "APPOINTMENT_MAJORITY_SCOPE", "OTHER_SIGNIFICANT_CONTROL_STATUS"]);

function unique(values) { return [...new Set((values || []).filter((value) => typeof value === "string" && value.length > 0))].sort(); }
function sortBy(values, field) { return [...values].sort((a, b) => String(a[field]).localeCompare(String(b[field]))); }
function sortCanonical(values) { return [...(values || [])].sort((a, b) => canonicalizeJson(a).localeCompare(canonicalizeJson(b))); }
function same(a, b) { return canonicalizeJson(a) === canonicalizeJson(b); }
function timestamp(value, path) { assertNonEmptyString(value, path); if (Number.isNaN(Date.parse(value))) fail(`${path} must be an ISO timestamp`); return value; }
function caseReference(value) {
  assertPlainObject(value, "caseRevision");
  assertNonEmptyString(value.caseId, "caseRevision.caseId");
  assertNonEmptyString(value.revisionId, "caseRevision.revisionId");
  if (!Number.isInteger(value.revision) || value.revision < 0) fail("caseRevision.revision must be a non-negative integer");
  return { caseId: value.caseId, revisionId: value.revisionId, revision: value.revision };
}
function policyIdentity(policyPack) {
  const identity = policyPack?.identity || policyPack?.policyIdentity;
  if (!identity) fail("planner requires a loaded policy identity");
  const normalized = {
    policyPackId: identity.policyPackId,
    policyVersion: identity.version || identity.policyVersion,
    policyHash: identity.hash || identity.policyHash,
    policySchemaVersion: identity.schemaVersion || identity.policySchemaVersion,
  };
  Object.entries(normalized).forEach(([key, value]) => assertNonEmptyString(value, `policyIdentity.${key}`));
  return normalized;
}
function conceptForNeed(need) {
  const mapping = {
    CURRENT_OWNERSHIP_AND_CONTROL: "OWNERSHIP_STRUCTURE_EVIDENCE",
    ADDITIONAL_DIRECT_HOLDER: "DIRECT_SHAREHOLDER_IDENTITY",
    RELATIONSHIP_PERCENTAGE: need.dimension === "VOTING" ? "VOTING_RIGHTS" : "EXACT_ECONOMIC_PERCENTAGE",
    RELATIONSHIP_CURRENTNESS: "RELATIONSHIP_CURRENTNESS",
    QUALIFYING_PERSON_ATTRIBUTES: "ENTITY_IDENTITY",
    INDEPENDENT_CORROBORATION: "OWNERSHIP_STRUCTURE_EVIDENCE",
    LLP_GOVERNANCE_CONTROL_BASIS: "SIGNIFICANT_INFLUENCE_CONTROL",
    VOTING_CONTROL_STATUS: "VOTING_RIGHTS",
    APPOINTMENT_MAJORITY_SCOPE: "APPOINTMENT_REMOVAL_RIGHTS",
    OTHER_SIGNIFICANT_CONTROL_STATUS: "SIGNIFICANT_INFLUENCE_CONTROL",
    LAYER_QUALIFIER: "DIRECT_ECONOMIC_OWNERSHIP",
    SENIOR_MANAGEMENT_CANDIDATE: "CURRENT_OFFICERS",
  };
  return mapping[need.concept] || "OWNERSHIP_STRUCTURE_EVIDENCE";
}
function isStructural(need) { return STRUCTURAL_CONCEPTS.has(need.concept); }
function groupType(needs) {
  if (needs.every(({ concept }) => concept === "QUALIFYING_PERSON_ATTRIBUTES")) return GROUP_TYPE.PERSON_ATTRIBUTES;
  if (needs.some(({ concept }) => GOVERNANCE_CONCEPTS.has(concept))) return GROUP_TYPE.GOVERNANCE_FRONTIER;
  if (needs.every(({ targetKind }) => targetKind === "EVIDENCE_SUFFICIENCY")) return GROUP_TYPE.EVIDENCE_CONDITION;
  if (needs.some(isStructural)) return GROUP_TYPE.STRUCTURAL_FRONTIER;
  return GROUP_TYPE.TARGETED_FACT;
}
function defaultGroupingKey(need) {
  if (need.targetKind === "PERSON_ATTRIBUTE_SET") return `PERSON:${need.targetReference.personEntityId}`;
  if (need.targetKind === "RELATIONSHIP") return `RELATIONSHIP:${need.targetReference.relationshipId}`;
  if (need.frontierEntityId) return `FRONTIER:${need.frontierEntityId}`;
  if (need.targetReference.entityId) return `${need.targetKind}:${need.targetReference.entityId}:${need.concept}`;
  return `${need.targetKind}:${need.needId}`;
}
function targetEntities(need) { return unique([need.frontierEntityId, need.targetReference?.entityId, need.targetReference?.personEntityId, need.targetReference?.subjectEntityId, need.targetReference?.objectEntityId, ...(need.affected?.personIds || [])]); }
function targetRelationships(need) { return unique([need.relationshipId, need.targetReference?.relationshipId, ...(need.affected?.relationshipIds || [])]); }

function normalizeCapabilityQuery(query, defaults, need) {
  const value = { ...(defaults || {}), ...(query || {}) };
  return {
    jurisdiction: value.jurisdiction || "ANY",
    entityProfile: value.entityProfile || "ANY",
    informationConcept: value.informationConcept || conceptForNeed(need),
    relationshipDimension: value.relationshipDimension || need.dimension || "ANY",
    relationshipBasis: value.relationshipBasis || need.relationshipBasis || "ANY",
    acquisitionChannel: value.acquisitionChannel || "REGISTRY_DISCOVERY",
    entitlementContext: value.entitlementContext || "ANY",
  };
}
function mappedOption(need, reference, defaults, context) {
  const structural = isStructural(need);
  const mapping = {
    DISCOVERY: [ACTION_TYPE.DISCOVER_INFORMATION, "SYSTEM", "REGISTRY_DISCOVERY"],
    EXISTING_EVIDENCE: [ACTION_TYPE.USE_EXISTING_EVIDENCE, "SYSTEM", "HELD_EVIDENCE"],
    DETERMINISTIC_CALCULATION: [ACTION_TYPE.USE_EXISTING_EVIDENCE, "SYSTEM", "DETERMINISTIC_REEVALUATION"],
    CUSTOMER_DOCUMENT: [structural ? ACTION_TYPE.REQUEST_STRUCTURE_EVIDENCE : ACTION_TYPE.REQUEST_TARGETED_EVIDENCE, "CUSTOMER", "CUSTOMER_EVIDENCE"],
    CUSTOMER_QUESTION: [ACTION_TYPE.REQUEST_STRUCTURED_INFORMATION, "CUSTOMER", "CUSTOMER_INFORMATION"],
    CUSTOMER_ATTESTATION: [ACTION_TYPE.CONFIRM_ESTABLISHED_INFORMATION, "CUSTOMER", "CUSTOMER_ATTESTATION"],
    ANALYST_REVIEW: [ACTION_TYPE.INTERNAL_REVIEW, "INTERNAL", "INTERNAL_REVIEW"],
  };
  const [semanticActionType, actor, acquisitionChannel] = mapping[reference.strategy] || [reference.strategy, "INTERNAL", "INTERNAL_REVIEW"];
  const availableEvidence = new Set(context?.availableEvidenceCategories || []);
  const availableActions = new Set(context?.availableActionTypes || []);
  const currentlyAvailable = reference.strategy === "DISCOVERY"
    || availableActions.has(semanticActionType)
    || (reference.evidence && availableEvidence.has(reference.evidence))
    || (CUSTOMER_ACTIONS.has(semanticActionType) && reference.eligibleForPlanning !== false);
  const contentReadiness = reference.eligibleForPlanning === false ? CONTENT_READINESS.REQUIRES_POLICY_CONTENT
    : reference.contentStatus === "NOT_REQUIRED" || !CUSTOMER_ACTIONS.has(semanticActionType) ? CONTENT_READINESS.NOT_REQUIRED : CONTENT_READINESS.READY;
  return {
    resolutionStrategy: reference.strategy,
    semanticActionType,
    actor,
    informationNeedIds: [need.needId],
    requirementIds: unique([...(need.requiredByRequirementIds || []), reference.requirementId]),
    acquisitionChannel,
    capabilityQuery: normalizeCapabilityQuery({ acquisitionChannel }, defaults, need),
    evidenceCategories: unique([reference.evidence]),
    actionTemplateReference: reference.actionTemplateId || null,
    contentReadiness,
    currentlyAvailable,
    causalGroupingKey: defaultGroupingKey(need),
    coverageBasis: "SINGLE_CAUSAL_NEED",
    targetReference: cloneData(need.targetReference),
    expectedCandidateFacts: [cloneData(need.requiredFact)],
    externalHandoffType: CUSTOMER_ACTIONS.has(semanticActionType) ? "EVIDENCE_OR_INFORMATION_INTAKE" : null,
    retryPermitted: true,
  };
}
function normalizeOption(raw, index, needsById, defaults) {
  const path = `resolutionOptions[${index}]`;
  assertAllowedKeys(raw, ["optionId", "resolutionStrategy", "semanticActionType", "actor", "informationNeedIds", "requirementIds", "acquisitionChannel", "capabilityQuery", "evidenceCategories", "actionTemplateReference", "contentReadiness", "currentlyAvailable", "causalGroupingKey", "coverageBasis", "targetReference", "expectedCandidateFacts", "externalHandoffType", "retryPermitted", "displayMetadata"], path);
  assertArray(raw.informationNeedIds, `${path}.informationNeedIds`);
  const informationNeedIds = unique(raw.informationNeedIds);
  if (informationNeedIds.length === 0) fail(`${path} must cover at least one InformationNeed`);
  informationNeedIds.forEach((id) => { if (!needsById.has(id)) fail(`${path} references unknown InformationNeed ${id}`); });
  assertEnum(raw.semanticActionType, ACTION_TYPE, `${path}.semanticActionType`);
  const actor = raw.actor || (SYSTEM_ACTIONS.has(raw.semanticActionType) ? "SYSTEM" : CUSTOMER_ACTIONS.has(raw.semanticActionType) ? "CUSTOMER" : raw.semanticActionType === ACTION_TYPE.SPECIALIST_REVIEW ? "SPECIALIST" : "INTERNAL");
  assertEnum(actor, WAVE_ACTOR, `${path}.actor`);
  if (raw.structureAcquisitionStrategy !== undefined) fail(`${path} cannot supply a selected acquisition strategy`);
  const primaryNeed = needsById.get(informationNeedIds[0]);
  const option = {
    resolutionStrategy: raw.resolutionStrategy || raw.semanticActionType,
    semanticActionType: raw.semanticActionType,
    actor,
    informationNeedIds,
    requirementIds: unique(raw.requirementIds || informationNeedIds.flatMap((id) => needsById.get(id).requiredByRequirementIds)),
    acquisitionChannel: raw.acquisitionChannel || "NOT_APPLICABLE",
    capabilityQuery: normalizeCapabilityQuery(raw.capabilityQuery, defaults, primaryNeed),
    evidenceCategories: unique(raw.evidenceCategories),
    actionTemplateReference: raw.actionTemplateReference || null,
    contentReadiness: raw.contentReadiness || (CUSTOMER_ACTIONS.has(raw.semanticActionType) ? CONTENT_READINESS.REQUIRES_POLICY_CONTENT : CONTENT_READINESS.NOT_REQUIRED),
    currentlyAvailable: raw.currentlyAvailable === true,
    causalGroupingKey: raw.causalGroupingKey || defaultGroupingKey(primaryNeed),
    coverageBasis: raw.coverageBasis || "SINGLE_CAUSAL_NEED",
    targetReference: cloneData(raw.targetReference || primaryNeed.targetReference),
    expectedCandidateFacts: cloneData(raw.expectedCandidateFacts || informationNeedIds.map((id) => needsById.get(id).requiredFact)),
    externalHandoffType: raw.externalHandoffType || null,
    retryPermitted: raw.retryPermitted !== false,
  };
  assertEnum(option.contentReadiness, CONTENT_READINESS, `${path}.contentReadiness`);
  if (informationNeedIds.length > 1 && option.coverageBasis !== "COHERENT_EVIDENCE_PACKAGE") fail(`${path} may cover several needs only as a coherent evidence package`);
  const semantic = cloneData(option);
  const optionId = `ubo-resolution-option-v2:${hashArtifact(semantic).slice(7, 39)}`;
  if (raw.optionId !== undefined && raw.optionId !== optionId) fail(`${path}.optionId does not match semantic content`);
  return { ...semantic, optionId, ...(raw.displayMetadata === undefined ? {} : { displayMetadata: cloneData(raw.displayMetadata) }) };
}
function buildResolutionOptionsV2({ informationNeeds, defaultCapabilityScope = {}, existingSystemResolutionContext = {}, additionalOptions = [] }) {
  const open = informationNeeds.filter(({ status }) => status === "OPEN");
  const needsById = new Map(open.map((need) => [need.needId, need]));
  const generated = open.flatMap((need) => (need.permittedResolutionStrategyReferences || []).map((reference) => mappedOption(need, reference, defaultCapabilityScope, existingSystemResolutionContext)));
  const normalized = [...generated, ...additionalOptions].map((option, index) => normalizeOption(option, index, needsById, defaultCapabilityScope));
  const byId = new Map(normalized.map((option) => [option.optionId, option]));
  return deepFreeze(cloneData(sortBy([...byId.values()], "optionId")));
}

class DisjointSet {
  constructor(ids) { this.parents = new Map(ids.map((id) => [id, id])); }
  find(id) { const parent = this.parents.get(id); if (parent !== id) this.parents.set(id, this.find(parent)); return this.parents.get(id); }
  union(a, b) { const aa = this.find(a); const bb = this.find(b); if (aa !== bb) this.parents.set(aa < bb ? bb : aa, aa < bb ? aa : bb); }
}
function groupNeeds(openNeeds, options) {
  const dsu = new DisjointSet(openNeeds.map(({ needId }) => needId));
  options.filter(({ coverageBasis, informationNeedIds }) => coverageBasis === "COHERENT_EVIDENCE_PACKAGE" && informationNeedIds.length > 1).forEach(({ informationNeedIds }) => informationNeedIds.slice(1).forEach((id) => dsu.union(informationNeedIds[0], id)));
  const buckets = new Map();
  openNeeds.forEach((need) => { const root = dsu.find(need.needId); if (!buckets.has(root)) buckets.set(root, []); buckets.get(root).push(need); });
  return [...buckets.values()].map((needs) => {
    const sorted = sortBy(needs, "needId");
    const covering = options.filter((option) => option.informationNeedIds.some((id) => sorted.some(({ needId }) => needId === id)) && option.informationNeedIds.every((id) => sorted.some(({ needId }) => needId === id)));
    const keys = unique(covering.map(({ causalGroupingKey }) => causalGroupingKey));
    const semantic = { causalGroupingKey: keys.length === 1 ? keys[0] : sorted.map(defaultGroupingKey).join("+"), informationNeedIds: sorted.map(({ needId }) => needId) };
    const groupId = `${RESOLUTION_GROUP_V1}:${hashArtifact(semantic).slice(7, 39)}`;
    return { groupId, needs: sorted, options: sortBy(covering, "optionId"), causalGroupingKey: semantic.causalGroupingKey };
  }).sort((a, b) => a.groupId.localeCompare(b.groupId));
}
function attemptOutcome(attempt) { return attempt.capabilityOutcomeState || attempt.outcomeState || attempt.outcome || null; }
function relevantAttempts(group, option, attempts) {
  return attempts.filter((attempt) => {
    const ids = attempt.informationNeedIds || attempt.coveredInformationNeedIds || [];
    const sameNeed = ids.some((id) => group.needs.some(({ needId }) => needId === id)) || attempt.resolutionGroupId === group.groupId;
    const sameRoute = !attempt.semanticActionType || attempt.semanticActionType === option.semanticActionType || attempt.strategy === option.resolutionStrategy;
    return sameNeed && sameRoute;
  }).sort((a, b) => canonicalizeJson(a).localeCompare(canonicalizeJson(b)));
}
function capabilityCannotMeetRequiredPrecision(entry, query) {
  return query.informationConcept === "EXACT_ECONOMIC_PERCENTAGE"
    && !entry.outputCharacteristics.includes(OUTPUT_CHARACTERISTIC.EXACT);
}
function optionDecision({ group, option, attempts, profile, evaluationTime, materialFingerprint }) {
  const rationaleCodes = [];
  let capabilityMatch = null;
  if (option.semanticActionType === ACTION_TYPE.DISCOVER_INFORMATION && profile) {
    capabilityMatch = matchRegistryCapabilityEntry(profile, option.capabilityQuery, evaluationTime);
    if (capabilityMatch.matchState === MATCH_STATE.MATCHED && capabilityMatch.freshnessState === PROFILE_FRESHNESS_STATE.CURRENT) {
      const entry = capabilityMatch.entry;
      if (capabilityCannotMeetRequiredPrecision(entry, capabilityMatch.query)) {
        rationaleCodes.push("CAPABILITY_INSUFFICIENT_FOR_REQUIRED_PRECISION");
      } else if ([CAPABILITY_STATE.SUPPORTED, CAPABILITY_STATE.PARTIAL].includes(entry.capabilityState)
        && entry.entitlementState === ENTITLEMENT_STATE.ENTITLED
        && profile.entitlementContext.state !== ENTITLEMENT_STATE.NOT_ENTITLED) {
        rationaleCodes.push("SYSTEM_CAPABILITY_AVAILABLE");
        if (entry.capabilityState === CAPABILITY_STATE.PARTIAL) rationaleCodes.push("CAPABILITY_PREDICTS_PARTIAL_COVERAGE");
      } else if (entry.capabilityState === CAPABILITY_STATE.UNSUPPORTED) rationaleCodes.push("CAPABILITY_PREDICTS_OPACITY");
      else if (entry.capabilityState === CAPABILITY_STATE.RESTRICTED
        || entry.entitlementState === ENTITLEMENT_STATE.NOT_ENTITLED
        || profile.entitlementContext.state === ENTITLEMENT_STATE.NOT_ENTITLED) rationaleCodes.push("ENTITLEMENT_UNAVAILABLE");
    } else if (capabilityMatch.freshnessState !== PROFILE_FRESHNESS_STATE.CURRENT) rationaleCodes.push("PROFILE_STALE");
  }
  const relevant = relevantAttempts(group, option, attempts);
  const unchanged = relevant.filter((attempt) => !attempt.materialInputFingerprint || attempt.materialInputFingerprint === materialFingerprint);
  const changed = relevant.filter((attempt) => attempt.materialInputFingerprint && attempt.materialInputFingerprint !== materialFingerprint);
  if (changed.length > 0) rationaleCodes.push("MATERIAL_CHANGE_PERMITS_RETRY");
  const substantive = unchanged.find((attempt) => SUBSTANTIVE_OUTCOMES.has(attemptOutcome(attempt))
    || (attemptOutcome(attempt) === "INCONCLUSIVE" && (attempt.final === true || attempt.finalOutcome === true)));
  const partial = unchanged.find((attempt) => attemptOutcome(attempt) === "PARTIAL");
  const operational = unchanged.find((attempt) => OPERATIONAL_OUTCOMES.has(attemptOutcome(attempt)));
  if (substantive) return { executable: false, exhausted: true, operational: null, capabilityMatch, rationaleCodes: unique([...rationaleCodes, "SUBSTANTIVE_ROUTE_EXHAUSTED"]), attempt: substantive };
  if (partial) {
    const residualInformationNeedIds = unique((partial.residualInformationNeedIds || []).filter((id) => group.needs.some(({ needId }) => needId === id)));
    if (residualInformationNeedIds.length === 0) return { executable: false, exhausted: true, operational: null, capabilityMatch, rationaleCodes: unique([...rationaleCodes, "SUBSTANTIVE_ROUTE_EXHAUSTED"]), attempt: partial };
    return { executable: true, exhausted: false, operational: null, capabilityMatch, rationaleCodes: unique([...rationaleCodes, "CAPABILITY_PREDICTS_PARTIAL_COVERAGE"]), attempt: partial, residualInformationNeedIds };
  }
  if (operational) return { executable: option.retryPermitted && attemptOutcome(operational) === "UNAVAILABLE", exhausted: false, operational: attemptOutcome(operational), capabilityMatch, rationaleCodes: unique([...rationaleCodes, "OPERATIONAL_RETRY_REQUIRED"]), attempt: operational };
  if (option.semanticActionType === ACTION_TYPE.DISCOVER_INFORMATION && profile && capabilityMatch?.matchState === MATCH_STATE.MATCHED && capabilityMatch.freshnessState === PROFILE_FRESHNESS_STATE.CURRENT) {
    const entry = capabilityMatch.entry;
    const insufficientPrecision = capabilityCannotMeetRequiredPrecision(entry, capabilityMatch.query);
    const predictive = [CAPABILITY_STATE.SUPPORTED, CAPABILITY_STATE.PARTIAL].includes(entry.capabilityState)
      && entry.entitlementState === ENTITLEMENT_STATE.ENTITLED
      && profile.entitlementContext.state !== ENTITLEMENT_STATE.NOT_ENTITLED
      && !insufficientPrecision;
    const explicitlyOpaque = [CAPABILITY_STATE.UNSUPPORTED, CAPABILITY_STATE.RESTRICTED].includes(entry.capabilityState)
      || entry.entitlementState === ENTITLEMENT_STATE.NOT_ENTITLED
      || profile.entitlementContext.state === ENTITLEMENT_STATE.NOT_ENTITLED
      || insufficientPrecision;
    return { executable: predictive || (!explicitlyOpaque && option.currentlyAvailable), exhausted: explicitlyOpaque, operational: null, capabilityMatch, rationaleCodes: unique(rationaleCodes), attempt: null };
  }
  return { executable: option.currentlyAvailable, exhausted: false, operational: null, capabilityMatch, rationaleCodes: unique(rationaleCodes), attempt: null };
}
function actionFrom(group, option, strategy, decision, extraRationale = [], registryProfileHash = null) {
  let semanticActionType = option.semanticActionType;
  if (decision.operational === "UNAVAILABLE") semanticActionType = ACTION_TYPE.RETRY_CAPABILITY;
  if (decision.operational === "FAILED") semanticActionType = ACTION_TYPE.HOLD_FOR_OPERATIONAL_RECOVERY;
  const actor = SYSTEM_ACTIONS.has(semanticActionType) ? "SYSTEM" : CUSTOMER_ACTIONS.has(semanticActionType) ? "CUSTOMER" : semanticActionType === ACTION_TYPE.SPECIALIST_REVIEW ? "SPECIALIST" : "INTERNAL";
  const expectedOutcome = semanticActionType === ACTION_TYPE.DISCOVER_INFORMATION ? "CANDIDATE_FACTS_OR_SUBSTANTIVE_CAPABILITY_OUTCOME"
    : CUSTOMER_ACTIONS.has(semanticActionType) ? "CANDIDATE_INFORMATION_OR_STRUCTURE_EVIDENCE"
      : semanticActionType === ACTION_TYPE.INTERNAL_REVIEW || semanticActionType === ACTION_TYPE.SPECIALIST_REVIEW ? "PINNED_REVIEW_DECISION" : "AVAILABLE_FACTS_OR_OPERATIONAL_RECOVERY";
  const reEvaluationTrigger = semanticActionType === ACTION_TYPE.DISCOVER_INFORMATION ? "CAPABILITY_RESULT_INTAKEN_AND_CLAIMS_ADJUDICATED"
    : CUSTOMER_ACTIONS.has(semanticActionType) ? "ARTIFACT_OR_INFORMATION_INTAKEN_AND_CLAIMS_ADJUDICATED"
      : semanticActionType === ACTION_TYPE.INTERNAL_REVIEW || semanticActionType === ACTION_TYPE.SPECIALIST_REVIEW ? "PINNED_REVIEW_DECISION_RECORDED" : "MATERIAL_CASE_INPUT_CHANGED";
  const coveredInformationNeedIds = unique(decision.residualInformationNeedIds || option.informationNeedIds);
  const coveredNeedSet = new Set(coveredInformationNeedIds);
  const semantic = {
    contractVersion: RESOLUTION_ACTION_V2,
    actor,
    semanticActionType,
    resolutionGroupId: group.groupId,
    coveredInformationNeedIds,
    coveredRequirementIds: unique(group.needs.filter(({ needId }) => coveredNeedSet.has(needId)).flatMap(({ requiredByRequirementIds }) => requiredByRequirementIds)),
    targetReferences: cloneData(unique(group.needs.flatMap(targetEntities)).map((entityId) => ({ entityId }))),
    frontierEntityIds: unique(group.needs.map(({ frontierEntityId }) => frontierEntityId)),
    acquisitionStrategy: strategy,
    permittedResolutionOptionReferences: [option.optionId],
    expectedFactsOrEvidence: cloneData(option.expectedCandidateFacts),
    actionTemplateReference: option.actionTemplateReference,
    contentReadiness: option.contentReadiness,
    capabilityReference: decision.capabilityMatch?.entry ? { entryId: decision.capabilityMatch.entry.entryId, profileHash: registryProfileHash } : null,
    attemptEligibility: { eligible: decision.executable, priorAttemptOutcome: decision.attempt ? attemptOutcome(decision.attempt) : null, reasonCodes: decision.rationaleCodes },
    rationaleCodes: unique([...(actor === "SYSTEM" ? ["NO_CUSTOMER_FRICTION"] : []), ...decision.rationaleCodes, ...extraRationale]),
    expectedOutcome,
    reEvaluationTrigger,
    requiredSignoffs: unique(group.needs.flatMap(({ requiredSignoffIds }) => requiredSignoffIds)),
    externalHandoffType: option.externalHandoffType,
    independentVerificationRequired: CUSTOMER_ACTIONS.has(semanticActionType),
    receiptDoesNotResolveNeed: CUSTOMER_ACTIONS.has(semanticActionType),
  };
  const actionId = `${RESOLUTION_ACTION_V2}:${hashArtifact(semantic).slice(7, 39)}`;
  return { ...semantic, actionId };
}
function reviewOption(group, review, specialist = false) {
  return {
    optionId: specialist ? review.specialistRouteId : review.reviewRequirementId,
    semanticActionType: specialist ? ACTION_TYPE.SPECIALIST_REVIEW : ACTION_TYPE.INTERNAL_REVIEW,
    informationNeedIds: group.needs.map(({ needId }) => needId),
    requirementIds: review.requirementIds || [],
    expectedCandidateFacts: [],
    contentReadiness: CONTENT_READINESS.NOT_REQUIRED,
    actionTemplateReference: null,
    externalHandoffType: specialist ? "SPECIALIST_REVIEW_HANDOFF" : "INTERNAL_REVIEW_HANDOFF",
  };
}
function linkedReviews(group, reviews) { const ids = new Set(group.needs.map(({ needId }) => needId)); return sortCanonical(reviews.filter((review) => (review.relatedInformationNeedIds || []).some((id) => ids.has(id)))); }
function linkedSpecialists(group, specialists) {
  const entities = new Set(group.needs.flatMap(targetEntities));
  return sortCanonical(specialists.filter((route) => route.caseWide === true || (route.entityIds || []).some((id) => entities.has(id)) || (route.relatedInformationNeedIds || []).some((id) => group.needs.some(({ needId }) => needId === id))));
}
function distinctRouteDecisions(items) {
  const selected = new Map();
  [...items].sort((a, b) => b.option.informationNeedIds.length - a.option.informationNeedIds.length || a.option.optionId.localeCompare(b.option.optionId)).forEach((item) => {
    const key = `${item.option.semanticActionType}|${item.option.acquisitionChannel}|${item.decision.operational || ""}`;
    if (!selected.has(key)) selected.set(key, item);
  });
  return [...selected.values()].sort((a, b) => a.option.optionId.localeCompare(b.option.optionId));
}
function profilePin(profile, state, usedEntryIds) {
  if (!profile) return { state: "NOT_PROVIDED", profileId: null, profileVersion: null, profileHash: null, entitlementContext: null, usedCapabilityEntryIds: [], governanceState: null, productionAuthorized: false };
  return { state, profileId: profile.profileId, profileVersion: profile.profileVersion, profileHash: profile.profileHash, entitlementContext: cloneData(profile.entitlementContext), usedCapabilityEntryIds: unique(usedEntryIds), governanceState: profile.governanceState, productionAuthorized: false };
}

function planUboResolutionV2(input) {
  assertAllowedKeys(input, ["policyPack", "requirementResolution", "informationNeedSet", "operationalBlockers", "reviewRequirements", "specialistRoutes", "resolutionOptions", "resolutionAttempts", "registryCapabilityProfile", "predecessorResolutionPlan", "existingSystemResolutionContext", "evaluationTime", "caseRevision", "graphFingerprint", "defaultCapabilityScope"], "resolutionPlannerV2Input");
  assertDataOnly(input, "resolutionPlannerV2Input");
  const policy = policyIdentity(input.policyPack);
  const revision = caseReference(input.caseRevision);
  timestamp(input.evaluationTime, "evaluationTime");
  assertNonEmptyString(input.graphFingerprint, "graphFingerprint");
  assertPlainObject(input.requirementResolution, "requirementResolution");
  assertPlainObject(input.informationNeedSet, "informationNeedSet");
  ["operationalBlockers", "reviewRequirements", "specialistRoutes", "resolutionAttempts"].forEach((field) => assertArray(input[field] || [], field));
  const allNeeds = input.informationNeedSet.currentNeeds || input.requirementResolution.informationNeeds || [];
  const openNeeds = sortBy(allNeeds.filter(({ status }) => status === "OPEN"), "needId");
  const needsById = new Map(openNeeds.map((need) => [need.needId, need]));
  let options;
  if (input.resolutionOptions) {
    assertArray(input.resolutionOptions, "resolutionOptions");
    options = input.resolutionOptions.map((option, index) => normalizeOption(option, index, needsById, input.defaultCapabilityScope || {}));
  } else options = buildResolutionOptionsV2({ informationNeeds: openNeeds, defaultCapabilityScope: input.defaultCapabilityScope || {}, existingSystemResolutionContext: input.existingSystemResolutionContext || {} });
  options = sortBy(options, "optionId");
  const profile = input.registryCapabilityProfile || null;
  if (profile) validateRegistryCapabilityProfileV1(profile);
  const freshnessState = profile ? evaluateProfileFreshness(profile, input.evaluationTime) : "NOT_PROVIDED";
  const attemptHistory = sortCanonical(input.resolutionAttempts || []);
  if (input.predecessorResolutionPlan) {
    validateResolutionPlanV2(input.predecessorResolutionPlan);
    if (input.predecessorResolutionPlan.caseReference.caseId !== revision.caseId || input.predecessorResolutionPlan.caseReference.revision > revision.revision) fail("predecessor ResolutionPlan is stale or belongs to another case");
    const currentAttemptForms = new Set(attemptHistory.map(canonicalizeJson));
    if ((input.predecessorResolutionPlan.attemptHistory || []).some((attempt) => !currentAttemptForms.has(canonicalizeJson(attempt)))) fail("resolution attempt history cannot regress from the predecessor plan");
  }
  const optionSemantic = options.map(({ displayMetadata, ...item }) => item);
  const materialInputFingerprint = hashArtifact({ policy, caseReference: revision, graphFingerprint: input.graphFingerprint, informationNeedSetHash: input.informationNeedSet.setHash, registryCapabilityProfileHash: profile?.profileHash || null, resolutionOptions: optionSemantic, existingSystemResolutionContext: input.existingSystemResolutionContext || {} });
  const groups = groupNeeds(openNeeds, options);
  const usedEntryIds = [];
  const groupResults = groups.map((group) => {
    const decisions = group.options.map((option) => ({ option, decision: optionDecision({ group, option, attempts: attemptHistory, profile, evaluationTime: input.evaluationTime, materialFingerprint: materialInputFingerprint }) }));
    decisions.forEach(({ decision }) => { if (decision.capabilityMatch?.entry) usedEntryIds.push(decision.capabilityMatch.entry.entryId); });
    const specialists = linkedSpecialists(group, input.specialistRoutes || []);
    const reviews = linkedReviews(group, input.reviewRequirements || []);
    const blockers = sortCanonical((input.operationalBlockers || []).filter((blocker) => (blocker.affectedInformationNeedIds || []).some((id) => group.needs.some(({ needId }) => needId === id))));
    const discovery = decisions.filter(({ option, decision }) => option.semanticActionType === ACTION_TYPE.DISCOVER_INFORMATION && decision.executable);
    const zeroFriction = decisions.filter(({ option, decision }) => SYSTEM_ACTIONS.has(option.semanticActionType) && option.semanticActionType !== ACTION_TYPE.DISCOVER_INFORMATION && decision.executable);
    const chartCandidates = decisions.filter(({ option, decision }) => option.semanticActionType === ACTION_TYPE.REQUEST_STRUCTURE_EVIDENCE && option.contentReadiness !== CONTENT_READINESS.REQUIRES_POLICY_CONTENT && (decision.executable || option.currentlyAvailable));
    const customerCandidates = decisions.filter(({ option, decision }) => CUSTOMER_ACTIONS.has(option.semanticActionType) && option.contentReadiness !== CONTENT_READINESS.REQUIRES_POLICY_CONTENT && (decision.executable || option.currentlyAvailable));
    const internalCandidates = decisions.filter(({ option, decision }) => option.semanticActionType === ACTION_TYPE.INTERNAL_REVIEW && (decision.executable || option.currentlyAvailable));
    const predictsOpacity = decisions.some(({ decision }) => decision.rationaleCodes.some((code) => ["CAPABILITY_PREDICTS_OPACITY", "CAPABILITY_INSUFFICIENT_FOR_REQUIRED_PRECISION", "ENTITLEMENT_UNAVAILABLE", "SUBSTANTIVE_ROUTE_EXHAUSTED"].includes(code)));
    const operationalFailure = decisions.find(({ decision }) => decision.operational && OPERATIONAL_OUTCOMES.has(decision.operational));
    const structural = group.needs.some(isStructural);
    let strategy = structural ? ACQUISITION_STRATEGY.DISCOVERY_LED : ACQUISITION_STRATEGY.NOT_APPLICABLE;
    let selected = [];
    let rationale = [];
    if (specialists.length > 0) {
      strategy = ACQUISITION_STRATEGY.SPECIALIST;
      selected = specialists.map((route) => actionFrom(group, reviewOption(group, route, true), strategy, { executable: true, operational: null, capabilityMatch: null, rationaleCodes: ["SPECIALIST_ROUTE_ACTIVE"], attempt: null }));
      rationale.push("SPECIALIST_ROUTE_ACTIVE");
    } else if (discovery.length + zeroFriction.length > 0) {
      strategy = discovery.length > 0 && structural ? ACQUISITION_STRATEGY.DISCOVERY_LED : structural ? ACQUISITION_STRATEGY.CHART_ASSISTED : ACQUISITION_STRATEGY.NOT_APPLICABLE;
      selected = distinctRouteDecisions([...discovery, ...zeroFriction]).map(({ option, decision }) => actionFrom(group, option, strategy, decision, ["NO_CUSTOMER_FRICTION"], profile?.profileHash || null));
      rationale.push("NO_CUSTOMER_FRICTION");
    } else if (operationalFailure) {
      strategy = structural ? ACQUISITION_STRATEGY.DISCOVERY_LED : ACQUISITION_STRATEGY.NOT_APPLICABLE;
      selected = [actionFrom(group, operationalFailure.option, strategy, operationalFailure.decision, ["OPERATIONAL_RETRY_REQUIRED"], profile?.profileHash || null)];
      rationale.push("OPERATIONAL_RETRY_REQUIRED");
    } else if (structural && predictsOpacity && chartCandidates.length > 0) {
      strategy = ACQUISITION_STRATEGY.CHART_ASSISTED;
      const chosen = [...chartCandidates].sort((a, b) => b.option.informationNeedIds.length - a.option.informationNeedIds.length || a.option.optionId.localeCompare(b.option.optionId))[0];
      selected = [actionFrom(group, chosen.option, strategy, { ...chosen.decision, executable: true }, ["STRUCTURE_EVIDENCE_COVERS_MULTIPLE_NEEDS", ...(group.needs.length > 1 ? ["SHARED_STRUCTURAL_CAUSE"] : [])], profile?.profileHash || null)];
      rationale.push("CAPABILITY_PREDICTS_OPACITY", "STRUCTURE_EVIDENCE_COVERS_MULTIPLE_NEEDS");
    } else if (customerCandidates.length > 0) {
      strategy = structural && customerCandidates[0].option.semanticActionType === ACTION_TYPE.REQUEST_STRUCTURE_EVIDENCE ? ACQUISITION_STRATEGY.CHART_ASSISTED : ACQUISITION_STRATEGY.NOT_APPLICABLE;
      const chosen = [...customerCandidates].sort((a, b) => b.option.informationNeedIds.length - a.option.informationNeedIds.length || a.option.optionId.localeCompare(b.option.optionId))[0];
      selected = [actionFrom(group, chosen.option, strategy, { ...chosen.decision, executable: true }, ["CUSTOMER_INPUT_REQUIRED_BY_POLICY"] )];
      rationale.push("CUSTOMER_INPUT_REQUIRED_BY_POLICY");
    } else if (reviews.length > 0 || internalCandidates.length > 0) {
      strategy = ACQUISITION_STRATEGY.NOT_APPLICABLE;
      selected = reviews.map((review) => actionFrom(group, reviewOption(group, review), strategy, { executable: true, operational: null, capabilityMatch: null, rationaleCodes: ["HUMAN_INTERPRETATION_REQUIRED"], attempt: null }));
      if (selected.length === 0) selected = internalCandidates.slice(0, 1).map(({ option, decision }) => actionFrom(group, option, strategy, { ...decision, executable: true }, ["HUMAN_INTERPRETATION_REQUIRED"]));
      rationale.push("HUMAN_INTERPRETATION_REQUIRED");
    } else {
      strategy = structural && predictsOpacity ? ACQUISITION_STRATEGY.CHART_ASSISTED : ACQUISITION_STRATEGY.NOT_APPLICABLE;
      rationale.push(...decisions.flatMap(({ decision }) => decision.rationaleCodes), ...group.options.filter(({ contentReadiness }) => contentReadiness === CONTENT_READINESS.REQUIRES_POLICY_CONTENT).map(() => "POLICY_CONTENT_MISSING"));
    }
    rationale.push(...decisions.flatMap(({ decision }) => decision.rationaleCodes));
    const priorAssignment = input.predecessorResolutionPlan?.strategyAssignments?.find(({ causalGroupingKey }) => causalGroupingKey === group.causalGroupingKey) || null;
    let changeReason = priorAssignment ? "NO_MATERIAL_STRATEGY_CHANGE" : "INITIAL_ASSIGNMENT";
    if (priorAssignment && priorAssignment.strategy !== strategy) {
      if (input.predecessorResolutionPlan.materialInputFingerprint !== materialInputFingerprint) changeReason = "MATERIAL_INPUT_CHANGE";
      else if (decisions.some(({ decision }) => decision.rationaleCodes.includes("SUBSTANTIVE_ROUTE_EXHAUSTED"))) changeReason = "SUBSTANTIVE_ATTEMPT_OUTCOME";
      else fail("acquisition strategy cannot change without a material input or substantive attempt outcome");
    }
    const assignmentSemantic = { contractVersion: ACQUISITION_STRATEGY_ASSIGNMENT_V1, resolutionGroupId: group.groupId, causalGroupingKey: group.causalGroupingKey, priorStrategy: priorAssignment?.strategy || null, strategy, changeReason, materialInputFingerprint };
    const assignment = { ...assignmentSemantic, assignmentId: `${ACQUISITION_STRATEGY_ASSIGNMENT_V1}:${hashArtifact(assignmentSemantic).slice(7, 39)}` };
    const groupSemantic = {
      contractVersion: RESOLUTION_GROUP_V1,
      groupId: group.groupId,
      causalGroupingKey: group.causalGroupingKey,
      targetReferences: unique(group.needs.flatMap(targetEntities)).map((entityId) => ({ entityId })),
      frontierEntityIds: unique(group.needs.map(({ frontierEntityId }) => frontierEntityId)),
      branchRelationshipIds: unique(group.needs.flatMap(targetRelationships)),
      coveredInformationNeedIds: group.needs.map(({ needId }) => needId),
      coveredRequirementIds: unique(group.needs.flatMap(({ requiredByRequirementIds }) => requiredByRequirementIds)),
      groupType: groupType(group.needs),
      structureAcquisitionStrategy: strategy,
      availableSystemRoutes: group.options.filter(({ semanticActionType }) => SYSTEM_ACTIONS.has(semanticActionType)).map(({ optionId }) => optionId),
      selectedCurrentRoute: selected[0]?.actionId || null,
      deferredAlternativeOptionIds: group.options.filter(({ optionId }) => !selected.some(({ permittedResolutionOptionReferences }) => permittedResolutionOptionReferences.includes(optionId))).map(({ optionId }) => optionId),
      operationalBlockerIds: unique(blockers.map(({ blockerId }) => blockerId)),
      reviewRequirementIds: unique(reviews.map(({ reviewRequirementId }) => reviewRequirementId)),
      specialistRouteIds: unique(specialists.map(({ specialistRouteId }) => specialistRouteId)),
      evidenceArtifactCategories: unique(group.options.flatMap(({ evidenceCategories }) => evidenceCategories)),
      rationaleCodes: unique(rationale),
      expectedResolution: selected[0]?.expectedOutcome || "NO_CURRENTLY_EXECUTABLE_ACTION",
      reEvaluationTrigger: selected[0]?.reEvaluationTrigger || "MATERIAL_CASE_OR_POLICY_INPUT_CHANGED",
      governanceState: "REVIEW_ONLY",
      requiredSignoffs: unique([...(profile ? [PROFILE_SIGNOFF] : []), ...group.needs.flatMap(({ requiredSignoffIds }) => requiredSignoffIds)]),
      productionAuthorized: false,
    };
    return { group: groupSemantic, assignment, actions: selected, decisions };
  });
  const allActions = sortBy(groupResults.flatMap(({ actions }) => actions), "actionId");
  const caseWideSpecialist = (input.specialistRoutes || []).some((route) => route.caseWide === true || ((route.entityIds || []).length === 0 && (route.relationshipIds || []).length === 0));
  let state;
  let actor;
  let waveActions;
  if (openNeeds.length === 0) { state = PLAN_STATE.COMPLETE; actor = WAVE_ACTOR.NONE; waveActions = []; }
  else if (caseWideSpecialist) { state = PLAN_STATE.SPECIALIST_REVIEW; actor = WAVE_ACTOR.SPECIALIST; waveActions = allActions.filter(({ actor: itemActor }) => itemActor === "SPECIALIST"); }
  else if (allActions.some(({ actor: itemActor, semanticActionType }) => itemActor === "SYSTEM" && semanticActionType !== ACTION_TYPE.HOLD_FOR_OPERATIONAL_RECOVERY)) { state = PLAN_STATE.SYSTEM_RESOLUTION; actor = WAVE_ACTOR.SYSTEM; waveActions = allActions.filter(({ actor: itemActor, semanticActionType }) => itemActor === "SYSTEM" && semanticActionType !== ACTION_TYPE.HOLD_FOR_OPERATIONAL_RECOVERY); }
  else if (allActions.some(({ actor: itemActor }) => itemActor === "CUSTOMER")) { state = PLAN_STATE.CUSTOMER_RESOLUTION; actor = WAVE_ACTOR.CUSTOMER; waveActions = allActions.filter(({ actor: itemActor }) => itemActor === "CUSTOMER"); }
  else if (allActions.some(({ actor: itemActor }) => itemActor === "SPECIALIST")) { state = PLAN_STATE.SPECIALIST_REVIEW; actor = WAVE_ACTOR.SPECIALIST; waveActions = allActions.filter(({ actor: itemActor }) => itemActor === "SPECIALIST"); }
  else if (allActions.some(({ actor: itemActor }) => itemActor === "INTERNAL")) { state = PLAN_STATE.INTERNAL_REVIEW; actor = WAVE_ACTOR.INTERNAL; waveActions = allActions.filter(({ actor: itemActor }) => itemActor === "INTERNAL"); }
  else { state = PLAN_STATE.BLOCKED; actor = WAVE_ACTOR.NONE; waveActions = []; }
  const assignments = sortBy(groupResults.map(({ assignment }) => assignment), "assignmentId");
  const normalizedGroups = sortBy(groupResults.map(({ group }) => group), "groupId");
  const pin = profilePin(profile, freshnessState, usedEntryIds);
  const predecessorReference = input.predecessorResolutionPlan ? { planId: input.predecessorResolutionPlan.planId, planHash: input.predecessorResolutionPlan.planHash, waveId: input.predecessorResolutionPlan.currentPlanningWave.waveId } : null;
  const waveSemantic = {
    contractVersion: PLANNING_WAVE_V2,
    actor,
    selectedResolutionActionIds: waveActions.map(({ actionId }) => actionId),
    affectedResolutionGroupIds: unique(waveActions.map(({ resolutionGroupId }) => resolutionGroupId)),
    deferredAlternativeOptionIds: unique(normalizedGroups.flatMap(({ deferredAlternativeOptionIds }) => deferredAlternativeOptionIds)),
    prerequisiteState: state === PLAN_STATE.COMPLETE ? "NO_OPEN_INFORMATION_NEEDS" : "CURRENT_SNAPSHOT_VERIFIED",
    expectedResult: waveActions.map(({ expectedOutcome }) => expectedOutcome),
    reEvaluationTrigger: unique(waveActions.map(({ reEvaluationTrigger }) => reEvaluationTrigger)),
    predecessor: predecessorReference,
    materialInputFingerprint,
  };
  const currentPlanningWave = { ...waveSemantic, waveId: `${PLANNING_WAVE_V2}:${hashArtifact(waveSemantic).slice(7, 39)}` };
  const unresolvedPolicyContentDependencies = sortBy(options.filter(({ contentReadiness }) => contentReadiness === CONTENT_READINESS.REQUIRES_POLICY_CONTENT).map((option) => ({ resolutionOptionId: option.optionId, informationNeedIds: option.informationNeedIds, actionTemplateReference: option.actionTemplateReference, reasonCode: "POLICY_CONTENT_MISSING" })), "resolutionOptionId");
  const semantic = {
    contractVersion: RESOLUTION_PLAN_V2,
    plannerVersion: RESOLUTION_PLANNER_V2,
    caseReference: revision,
    policyIdentity: policy,
    graphFingerprint: input.graphFingerprint,
    requirementResolutionReference: { assessmentId: input.requirementResolution.assessmentId, assessmentHash: input.requirementResolution.assessmentHash },
    informationNeedSetReference: { needSetId: input.informationNeedSet.needSetId, setHash: input.informationNeedSet.setHash },
    registryCapabilityProfileRef: pin,
    usedCapabilityEntryIds: pin.usedCapabilityEntryIds,
    predecessorPlan: predecessorReference,
    materialInputFingerprint,
    state,
    currentPlanningWave,
    resolutionGroups: normalizedGroups,
    strategyAssignments: assignments,
    recommendedActions: waveActions,
    customerBundles: state === PLAN_STATE.CUSTOMER_RESOLUTION ? waveActions.map((action) => ({ bundleId: `ubo-customer-resolution-bundle-v2:${hashArtifact({ actionId: action.actionId }).slice(7, 39)}`, actionIds: [action.actionId], informationNeedIds: action.coveredInformationNeedIds, requirementIds: action.coveredRequirementIds })) : [],
    systemActions: allActions.filter(({ actor: itemActor }) => itemActor === "SYSTEM"),
    customerActions: allActions.filter(({ actor: itemActor }) => itemActor === "CUSTOMER"),
    internalReviewActions: allActions.filter(({ actor: itemActor }) => itemActor === "INTERNAL"),
    specialistActions: allActions.filter(({ actor: itemActor }) => itemActor === "SPECIALIST"),
    operationalHoldsAndBlockers: cloneData(sortCanonical(input.operationalBlockers || [])),
    deferredAlternatives: normalizedGroups.flatMap((group) => group.deferredAlternativeOptionIds.map((optionId) => ({ resolutionGroupId: group.groupId, resolutionOptionId: optionId }))),
    attemptHistory: cloneData(attemptHistory),
    rationaleCodes: unique([...groupResults.flatMap(({ group }) => group.rationaleCodes), ...(!profile ? ["PROFILE_NOT_PROVIDED"] : freshnessState !== PROFILE_FRESHNESS_STATE.CURRENT ? ["PROFILE_STALE"] : [])]),
    expectedResults: unique(waveActions.map(({ expectedOutcome }) => expectedOutcome), "expectedOutcome"),
    reEvaluationTriggers: unique(waveActions.map(({ reEvaluationTrigger }) => reEvaluationTrigger), "reEvaluationTrigger"),
    unresolvedPolicyContentDependencies,
    requiredSignoffs: unique([...(profile ? [PROFILE_SIGNOFF] : []), ...openNeeds.flatMap(({ requiredSignoffIds }) => requiredSignoffIds)]),
    runtimeMode: "LAB",
    governanceState: "REVIEW_ONLY",
    productionAuthorized: false,
    pipelineMaturity: "SUCCESSOR_PLANNER_COMPLETE_REVIEW_ONLY",
    summary: { openInformationNeeds: openNeeds.length, resolutionGroups: normalizedGroups.length, recommendedActions: waveActions.length, systemActions: allActions.filter(({ actor: value }) => value === "SYSTEM").length, customerActions: allActions.filter(({ actor: value }) => value === "CUSTOMER").length, internalReviewActions: allActions.filter(({ actor: value }) => value === "INTERNAL").length, specialistActions: allActions.filter(({ actor: value }) => value === "SPECIALIST").length, dependentDiagnosticsIgnoredAsActions: (input.requirementResolution.dependentDiagnostics || []).length },
  };
  const planHash = hashArtifact(semantic);
  const plan = { ...semantic, planId: `${RESOLUTION_PLAN_V2}:${planHash.slice(7, 39)}`, planHash };
  validateResolutionPlanV2(plan);
  return deepFreeze(cloneData(plan));
}

function validateResolutionPlanV2(plan) {
  assertPlainObject(plan, "resolutionPlanV2");
  if (plan.contractVersion !== RESOLUTION_PLAN_V2 || plan.plannerVersion !== RESOLUTION_PLANNER_V2) fail("ResolutionPlan v2 version is invalid");
  if (plan.runtimeMode !== "LAB" || plan.governanceState !== "REVIEW_ONLY" || plan.productionAuthorized !== false || plan.pipelineMaturity !== "SUCCESSOR_PLANNER_COMPLETE_REVIEW_ONLY") fail("ResolutionPlan v2 governance invariant failed");
  assertEnum(plan.state, PLAN_STATE, "resolutionPlanV2.state");
  assertEnum(plan.currentPlanningWave?.actor, WAVE_ACTOR, "resolutionPlanV2.currentPlanningWave.actor");
  if (plan.currentPlanningWave?.contractVersion !== PLANNING_WAVE_V2) fail("ResolutionPlan v2 planning wave version is invalid");
  const { planId, planHash, ...semantic } = plan;
  const expectedHash = hashArtifact(semantic);
  if (planHash !== expectedHash || planId !== `${RESOLUTION_PLAN_V2}:${expectedHash.slice(7, 39)}`) fail("ResolutionPlan v2 identity/hash mismatch");
  const wave = plan.currentPlanningWave;
  const { waveId, ...waveSemantic } = wave;
  if (waveId !== `${PLANNING_WAVE_V2}:${hashArtifact(waveSemantic).slice(7, 39)}`) fail("ResolutionPlan v2 wave identity is invalid");
  const actionForms = [...plan.recommendedActions, ...plan.systemActions, ...plan.customerActions, ...plan.internalReviewActions, ...plan.specialistActions];
  const actionsById = new Map();
  actionForms.forEach((action) => {
    const { actionId, ...actionSemantic } = action;
    if (action.contractVersion !== RESOLUTION_ACTION_V2 || actionId !== `${RESOLUTION_ACTION_V2}:${hashArtifact(actionSemantic).slice(7, 39)}`) fail("ResolutionPlan v2 action identity is invalid");
    if (actionsById.has(actionId) && !same(actionsById.get(actionId), action)) fail("ResolutionPlan v2 repeats an action ID with different content");
    actionsById.set(actionId, action);
  });
  const actionIds = new Set(plan.recommendedActions.map(({ actionId }) => actionId));
  if (!same([...actionIds].sort(), [...wave.selectedResolutionActionIds].sort())) fail("ResolutionPlan v2 wave does not pin the recommended actions");
  const expectedActor = { SYSTEM_RESOLUTION: "SYSTEM", CUSTOMER_RESOLUTION: "CUSTOMER", INTERNAL_REVIEW: "INTERNAL", SPECIALIST_REVIEW: "SPECIALIST", COMPLETE: "NONE", BLOCKED: "NONE" }[plan.state];
  if (wave.actor !== expectedActor || plan.recommendedActions.some(({ actor }) => actor !== wave.actor)) fail("ResolutionPlan v2 state, wave actor and recommended actions disagree");
  const groupIds = new Set();
  plan.resolutionGroups.forEach((group) => {
    const expectedGroupId = `${RESOLUTION_GROUP_V1}:${hashArtifact({ causalGroupingKey: group.causalGroupingKey, informationNeedIds: group.coveredInformationNeedIds }).slice(7, 39)}`;
    if (group.contractVersion !== RESOLUTION_GROUP_V1 || group.groupId !== expectedGroupId || groupIds.has(group.groupId)) fail("ResolutionPlan v2 resolution group identity is invalid");
    groupIds.add(group.groupId);
    if (group.selectedCurrentRoute !== null && !actionsById.has(group.selectedCurrentRoute)) fail("ResolutionPlan v2 group selects an unknown action");
  });
  if (!same(wave.affectedResolutionGroupIds, unique(plan.recommendedActions.map(({ resolutionGroupId }) => resolutionGroupId)))) fail("ResolutionPlan v2 wave group references do not match its actions");
  plan.strategyAssignments.forEach((assignment) => {
    const { assignmentId, ...assignmentSemantic } = assignment;
    if (assignment.contractVersion !== ACQUISITION_STRATEGY_ASSIGNMENT_V1 || assignmentId !== `${ACQUISITION_STRATEGY_ASSIGNMENT_V1}:${hashArtifact(assignmentSemantic).slice(7, 39)}`) fail("ResolutionPlan v2 strategy assignment identity is invalid");
    const group = plan.resolutionGroups.find(({ groupId }) => groupId === assignment.resolutionGroupId);
    if (!group || group.structureAcquisitionStrategy !== assignment.strategy || group.causalGroupingKey !== assignment.causalGroupingKey) fail("ResolutionPlan v2 strategy assignment does not match its group");
  });
  if (plan.strategyAssignments.length !== plan.resolutionGroups.length) fail("ResolutionPlan v2 requires one strategy assignment per group");
  plan.customerBundles.forEach((bundle) => {
    if (bundle.actionIds.length !== 1 || bundle.bundleId !== `ubo-customer-resolution-bundle-v2:${hashArtifact({ actionId: bundle.actionIds[0] }).slice(7, 39)}`) fail("ResolutionPlan v2 customer bundle identity is invalid");
    const action = actionsById.get(bundle.actionIds[0]);
    if (!action || action.actor !== "CUSTOMER" || !same(bundle.informationNeedIds, action.coveredInformationNeedIds) || !same(bundle.requirementIds, action.coveredRequirementIds)) fail("ResolutionPlan v2 customer bundle does not match its action");
  });
  if (!same(plan.usedCapabilityEntryIds, plan.registryCapabilityProfileRef.usedCapabilityEntryIds)) fail("ResolutionPlan v2 capability entry pins disagree");
  if (plan.registryCapabilityProfileRef?.profileId && !plan.requiredSignoffs.includes(PROFILE_SIGNOFF)) fail("profile-driven ResolutionPlan v2 requires A-15");
  assertDataOnly(plan, "resolutionPlanV2");
  return true;
}

module.exports = {
  ACQUISITION_STRATEGY,
  ACQUISITION_STRATEGY_ASSIGNMENT_V1,
  ACTION_TYPE,
  CONTENT_READINESS,
  GROUP_TYPE,
  PLAN_STATE,
  PLANNING_WAVE_V2,
  RESOLUTION_ACTION_V2,
  RESOLUTION_GROUP_V1,
  RESOLUTION_PLAN_V2,
  RESOLUTION_PLANNER_V2,
  WAVE_ACTOR,
  buildResolutionOptionsV2,
  planUboResolutionV2,
  validateResolutionPlanV2,
};
