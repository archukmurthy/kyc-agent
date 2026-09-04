"use strict";

const { GRAPH_DIMENSION } = require("./ownershipGraph");
const {
  assertAllowedKeys,
  assertArray,
  assertDataOnly,
  assertEnum,
  assertNonEmptyString,
  assertOptionalNonEmptyString,
  assertPlainObject,
  cloneData,
  deepFreeze,
  fail,
} = require("../internal/validation");
const { canonicalizeJson } = require("../policy/canonicalJson");
const { hashArtifact } = require("../internal/phasedArtifact");

const INFORMATION_NEED_V2 = "ubo-information-need-v2";
const INFORMATION_NEED_SET_V2 = "ubo-information-need-set-v2";
const NEED_DEPENDENT_DIAGNOSTIC_V1 = "ubo-need-dependent-diagnostic-v1";

const INFORMATION_NEED_V2_STATE = Object.freeze({ OPEN: "OPEN", SATISFIED: "SATISFIED", SUPERSEDED: "SUPERSEDED" });
const INFORMATION_NEED_TARGET_KIND = Object.freeze({
  CASE: "CASE",
  REGULATED_SUBJECT: "REGULATED_SUBJECT",
  FRONTIER_ENTITY: "FRONTIER_ENTITY",
  RELATIONSHIP: "RELATIONSHIP",
  PERSON_ATTRIBUTE_SET: "PERSON_ATTRIBUTE_SET",
  QUALIFICATION_ROUTE: "QUALIFICATION_ROUTE",
  EVIDENCE_SUFFICIENCY: "EVIDENCE_SUFFICIENCY",
});
const INFORMATION_NEED_V2_CONCEPT = Object.freeze({
  CURRENT_OWNERSHIP_AND_CONTROL: "CURRENT_OWNERSHIP_AND_CONTROL",
  ADDITIONAL_DIRECT_HOLDER: "ADDITIONAL_DIRECT_HOLDER",
  RELATIONSHIP_PERCENTAGE: "RELATIONSHIP_PERCENTAGE",
  RELATIONSHIP_CURRENTNESS: "RELATIONSHIP_CURRENTNESS",
  RELATIONSHIP_EVIDENCE: "RELATIONSHIP_EVIDENCE",
  ENTITY_EXISTENCE: "ENTITY_EXISTENCE",
  IDENTITY_AGGREGATION: "IDENTITY_AGGREGATION",
  QUALIFYING_PERSON_ATTRIBUTES: "QUALIFYING_PERSON_ATTRIBUTES",
  INDEPENDENT_CORROBORATION: "INDEPENDENT_CORROBORATION",
  OTHER_SIGNIFICANT_CONTROL_STATUS: "OTHER_SIGNIFICANT_CONTROL_STATUS",
  VOTING_CONTROL_STATUS: "VOTING_CONTROL_STATUS",
  APPOINTMENT_MAJORITY_SCOPE: "APPOINTMENT_MAJORITY_SCOPE",
  LLP_GOVERNANCE_CONTROL_BASIS: "LLP_GOVERNANCE_CONTROL_BASIS",
  TRUST_STATUS: "TRUST_STATUS",
  UNDERLYING_NOMINEE_PRINCIPAL: "UNDERLYING_NOMINEE_PRINCIPAL",
  NOMINEE_BEARER_STATUS: "NOMINEE_BEARER_STATUS",
  SENIOR_MANAGEMENT_CANDIDATE: "SENIOR_MANAGEMENT_CANDIDATE",
  CASE_COMPLETENESS_ATTESTATION: "CASE_COMPLETENESS_ATTESTATION",
  LAYER_QUALIFIER: "LAYER_QUALIFIER",
  STRUCTURE_CYCLE: "STRUCTURE_CYCLE",
});
const NEED_DIAGNOSTIC_KIND = Object.freeze({
  CALCULATION_PATH_BLOCKED: "CALCULATION_PATH_BLOCKED",
  ATTRIBUTION_CHAIN_BLOCKED: "ATTRIBUTION_CHAIN_BLOCKED",
  LAYER_CLOSURE_BLOCKED: "LAYER_CLOSURE_BLOCKED",
  QUALIFICATION_ROUTE_INDETERMINATE: "QUALIFICATION_ROUTE_INDETERMINATE",
  REQUIREMENT_UNRESOLVED: "REQUIREMENT_UNRESOLVED",
  EVIDENCE_SUFFICIENCY_UNMET: "EVIDENCE_SUFFICIENCY_UNMET",
  EXACTNESS_REQUIRED: "EXACTNESS_REQUIRED",
  CURRENTNESS_REQUIRED: "CURRENTNESS_REQUIRED",
  IDENTITY_REQUIRED: "IDENTITY_REQUIRED",
});
const TEMPORAL_SCOPE = Object.freeze({ CURRENT: "CURRENT" });
const DIMENSION = Object.freeze({ ...GRAPH_DIMENSION, CONTROL: "CONTROL" });

function unique(values) { return [...new Set((values || []).filter((value) => typeof value === "string" && value.length > 0))].sort(); }
function uniqueData(values) {
  const map = new Map();
  (values || []).forEach((value) => map.set(canonicalizeJson(value), cloneData(value)));
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, value]) => value);
}
function policyPin(identity) {
  assertPlainObject(identity, "policyIdentity");
  ["policyPackId", "policyVersion", "policyHash", "policySchemaVersion"].forEach((field) => assertNonEmptyString(identity[field], `policyIdentity.${field}`));
  return { policyPackId: identity.policyPackId, policyVersion: identity.policyVersion, policyHash: identity.policyHash, policySchemaVersion: identity.policySchemaVersion };
}
function casePin(caseState) {
  return { caseId: caseState.caseId, revisionId: caseState.revisionId, revision: caseState.revision };
}
function validateTarget(kind, target, path) {
  assertEnum(kind, INFORMATION_NEED_TARGET_KIND, `${path}.targetKind`);
  assertPlainObject(target, `${path}.targetReference`);
  assertDataOnly(target, `${path}.targetReference`);
  const identifier = (field) => assertNonEmptyString(target[field], `${path}.targetReference.${field}`);
  if (kind === INFORMATION_NEED_TARGET_KIND.CASE) identifier("caseId");
  if ([INFORMATION_NEED_TARGET_KIND.REGULATED_SUBJECT, INFORMATION_NEED_TARGET_KIND.FRONTIER_ENTITY].includes(kind)) identifier("entityId");
  if (kind === INFORMATION_NEED_TARGET_KIND.RELATIONSHIP) {
    identifier("relationshipId"); identifier("subjectEntityId"); identifier("objectEntityId");
  }
  if (kind === INFORMATION_NEED_TARGET_KIND.PERSON_ATTRIBUTE_SET) {
    identifier("personEntityId"); assertArray(target.attributeCodes, `${path}.targetReference.attributeCodes`);
    if (target.attributeCodes.length === 0) fail(`${path}.targetReference.attributeCodes must not be empty`);
    target.attributeCodes.forEach((value, index) => assertNonEmptyString(value, `${path}.targetReference.attributeCodes[${index}]`));
  }
  if (kind === INFORMATION_NEED_TARGET_KIND.QUALIFICATION_ROUTE) {
    identifier("personEntityId"); assertArray(target.routeIds, `${path}.targetReference.routeIds`);
    if (target.routeIds.length === 0) fail(`${path}.targetReference.routeIds must not be empty`);
  }
  if (kind === INFORMATION_NEED_TARGET_KIND.EVIDENCE_SUFFICIENCY
    && !target.entityId && !(Array.isArray(target.relationshipIds) && target.relationshipIds.length > 0)) fail(`${path}.targetReference requires an entity or relationships`);
}
function normalizeAffected(affected = {}) {
  assertPlainObject(affected, "informationNeedDraft.affected");
  const fields = ["qualificationRouteIds", "calculationIds", "pathIds", "relationshipIds", "personIds", "requirementIds", "closureAssessmentIds", "evidenceAssessmentIds", "attributionAssessmentIds"];
  assertAllowedKeys(affected, fields, "informationNeedDraft.affected");
  return Object.fromEntries(fields.map((field) => [field, unique(affected[field])]));
}
function normalizeStrategies(strategies = []) {
  assertArray(strategies, "informationNeedDraft.permittedResolutionStrategyReferences");
  return uniqueData(strategies.map((strategy, index) => {
    assertPlainObject(strategy, `informationNeedDraft.permittedResolutionStrategyReferences[${index}]`);
    assertNonEmptyString(strategy.strategy, `informationNeedDraft.permittedResolutionStrategyReferences[${index}].strategy`);
    assertDataOnly(strategy, `informationNeedDraft.permittedResolutionStrategyReferences[${index}]`);
    return strategy;
  }));
}
function normalizeDraft(draft, caseState, identity) {
  assertPlainObject(draft, "informationNeedDraft");
  assertAllowedKeys(draft, ["requiredByRequirementIds", "targetKind", "targetReference", "frontierEntityId", "relationshipId", "concept", "dimension", "relationshipBasis", "temporalScope", "requiredFact", "requiredEvidenceCondition", "reasonCode", "causalReferences", "affected", "permittedResolutionStrategyReferences", "policyActionTemplateReferences", "contentReadinessStatus", "requiredSignoffIds"], "informationNeedDraft");
  assertArray(draft.requiredByRequirementIds, "informationNeedDraft.requiredByRequirementIds");
  if (draft.requiredByRequirementIds.length === 0) fail("informationNeedDraft.requiredByRequirementIds must not be empty");
  validateTarget(draft.targetKind, draft.targetReference, "informationNeedDraft");
  assertEnum(draft.concept, INFORMATION_NEED_V2_CONCEPT, "informationNeedDraft.concept");
  if (draft.dimension !== undefined) assertEnum(draft.dimension, DIMENSION, "informationNeedDraft.dimension");
  assertOptionalNonEmptyString(draft.relationshipBasis, "informationNeedDraft.relationshipBasis");
  assertEnum(draft.temporalScope || TEMPORAL_SCOPE.CURRENT, TEMPORAL_SCOPE, "informationNeedDraft.temporalScope");
  assertPlainObject(draft.requiredFact, "informationNeedDraft.requiredFact");
  assertNonEmptyString(draft.requiredFact.type, "informationNeedDraft.requiredFact.type");
  assertDataOnly(draft.requiredFact, "informationNeedDraft.requiredFact");
  if (draft.requiredEvidenceCondition !== undefined) assertDataOnly(draft.requiredEvidenceCondition, "informationNeedDraft.requiredEvidenceCondition");
  assertNonEmptyString(draft.reasonCode, "informationNeedDraft.reasonCode");
  assertArray(draft.causalReferences || [], "informationNeedDraft.causalReferences");
  (draft.causalReferences || []).forEach((reference, index) => assertDataOnly(reference, `informationNeedDraft.causalReferences[${index}]`));
  assertArray(draft.policyActionTemplateReferences || [], "informationNeedDraft.policyActionTemplateReferences");
  const normalizedTarget = cloneData(draft.targetReference);
  Object.keys(normalizedTarget).forEach((key) => { if (Array.isArray(normalizedTarget[key])) normalizedTarget[key] = unique(normalizedTarget[key]); });
  return {
    requiredByRequirementIds: unique(draft.requiredByRequirementIds),
    targetKind: draft.targetKind,
    targetReference: normalizedTarget,
    ...(draft.frontierEntityId ? { frontierEntityId: draft.frontierEntityId } : {}),
    ...(draft.relationshipId ? { relationshipId: draft.relationshipId } : {}),
    concept: draft.concept,
    ...(draft.dimension ? { dimension: draft.dimension } : {}),
    ...(draft.relationshipBasis ? { relationshipBasis: draft.relationshipBasis } : {}),
    temporalScope: draft.temporalScope || TEMPORAL_SCOPE.CURRENT,
    requiredFact: cloneData(draft.requiredFact),
    ...(draft.requiredEvidenceCondition === undefined ? {} : { requiredEvidenceCondition: cloneData(draft.requiredEvidenceCondition) }),
    reasonCode: draft.reasonCode,
    causalReferences: uniqueData(draft.causalReferences || []),
    affected: normalizeAffected(draft.affected),
    permittedResolutionStrategyReferences: normalizeStrategies(draft.permittedResolutionStrategyReferences),
    policyActionTemplateReferences: unique(draft.policyActionTemplateReferences),
    contentReadinessStatus: draft.contentReadinessStatus || "NOT_APPLICABLE",
    requiredSignoffIds: unique(draft.requiredSignoffIds),
    caseReference: casePin(caseState),
    policyIdentity: policyPin(identity),
  };
}
function causalSemantic(draft) {
  return {
    caseId: draft.caseReference.caseId,
    policy: draft.policyIdentity,
    targetKind: draft.targetKind,
    targetReference: draft.targetReference,
    concept: draft.concept,
    dimension: draft.dimension || null,
    relationshipBasis: draft.relationshipBasis || null,
    temporalScope: draft.temporalScope,
    frontierEntityId: draft.frontierEntityId || null,
    relationshipId: draft.relationshipId || null,
    requiredFact: draft.requiredFact,
    requiredEvidenceCondition: draft.requiredEvidenceCondition || null,
  };
}
function mergeDraft(target, draft) {
  target.requiredByRequirementIds = unique([...target.requiredByRequirementIds, ...draft.requiredByRequirementIds]);
  target.causalReferences = uniqueData([...target.causalReferences, ...draft.causalReferences]);
  Object.keys(target.affected).forEach((field) => { target.affected[field] = unique([...target.affected[field], ...draft.affected[field]]); });
  target.permittedResolutionStrategyReferences = uniqueData([...target.permittedResolutionStrategyReferences, ...draft.permittedResolutionStrategyReferences]);
  target.policyActionTemplateReferences = unique([...target.policyActionTemplateReferences, ...draft.policyActionTemplateReferences]);
  target.requiredSignoffIds = unique([...target.requiredSignoffIds, ...draft.requiredSignoffIds]);
  if (target.contentReadinessStatus !== draft.contentReadinessStatus) target.contentReadinessStatus = "MIXED";
}
function withContentHash(record) {
  const { contentHash: ignored, ...content } = record;
  return { ...content, contentHash: hashArtifact(content) };
}
function validateInformationNeedV2(need, path = "informationNeedV2") {
  assertPlainObject(need, path);
  if (need.contractVersion !== INFORMATION_NEED_V2) fail(`${path}.contractVersion is invalid`);
  assertNonEmptyString(need.needId, `${path}.needId`);
  assertNonEmptyString(need.causalKey, `${path}.causalKey`);
  assertEnum(need.status, INFORMATION_NEED_V2_STATE, `${path}.status`);
  validateTarget(need.targetKind, need.targetReference, path);
  assertEnum(need.concept, INFORMATION_NEED_V2_CONCEPT, `${path}.concept`);
  if (need.dimension !== undefined) assertEnum(need.dimension, DIMENSION, `${path}.dimension`);
  const expectedCausalKey = `ubo-causal-need-v2:${hashArtifact(causalSemantic(need)).slice(7)}`;
  if (need.causalKey !== expectedCausalKey || need.needId !== `${INFORMATION_NEED_V2}:${hashArtifact(expectedCausalKey).slice(7, 39)}`) fail(`${path} causal identity is invalid`);
  const { contentHash, ...content } = need;
  if (contentHash !== hashArtifact(content)) fail(`${path}.contentHash is invalid`);
  assertDataOnly(need, path);
  return true;
}
function terminalTransition(prior, status, replacements = []) {
  const transitioned = cloneData(prior);
  transitioned.status = status;
  transitioned.predecessor = { needId: prior.needId, contentHash: prior.contentHash };
  if (status === INFORMATION_NEED_V2_STATE.SUPERSEDED) transitioned.supersededByNeedIds = unique(replacements);
  return withContentHash(transitioned);
}
function createInformationNeedSetV2({ caseState, policyIdentity, drafts, priorNeedRecords = [], supersessionReason = null }) {
  assertPlainObject(caseState, "caseState");
  assertArray(drafts, "informationNeedDrafts");
  assertArray(priorNeedRecords, "priorNeedRecords");
  priorNeedRecords.forEach((need, index) => validateInformationNeedV2(need, `priorNeedRecords[${index}]`));
  const identity = policyPin(policyIdentity);
  const grouped = new Map();
  drafts.forEach((raw) => {
    const draft = normalizeDraft(raw, caseState, identity);
    const causalKey = `ubo-causal-need-v2:${hashArtifact(causalSemantic(draft)).slice(7)}`;
    if (!grouped.has(causalKey)) grouped.set(causalKey, draft);
    else mergeDraft(grouped.get(causalKey), draft);
  });
  const priorById = new Map(priorNeedRecords.map((need) => [need.needId, need]));
  const open = [...grouped.entries()].map(([causalKey, draft]) => {
    const needId = `${INFORMATION_NEED_V2}:${hashArtifact(causalKey).slice(7, 39)}`;
    const record = {
      contractVersion: INFORMATION_NEED_V2,
      needId,
      causalKey,
      ...draft,
      status: INFORMATION_NEED_V2_STATE.OPEN,
      governanceState: "REVIEW_ONLY",
      productionAuthorized: false,
      ...(priorById.has(needId) ? { predecessor: { needId, contentHash: priorById.get(needId).contentHash } } : {}),
    };
    return withContentHash(record);
  }).sort((a, b) => a.needId.localeCompare(b.needId));
  const openById = new Map(open.map((need) => [need.needId, need]));
  const transitioned = priorNeedRecords.filter((need) => need.status === INFORMATION_NEED_V2_STATE.OPEN && !openById.has(need.needId)).map((prior) => {
    const replacements = open.filter((need) => need.targetKind === prior.targetKind && need.concept === prior.concept
      && canonicalizeJson(need.targetReference) === canonicalizeJson(prior.targetReference)).map(({ needId }) => needId);
    const superseded = supersessionReason !== null || prior.policyIdentity.policyHash !== identity.policyHash || replacements.length > 0;
    return terminalTransition(prior, superseded ? INFORMATION_NEED_V2_STATE.SUPERSEDED : INFORMATION_NEED_V2_STATE.SATISFIED, replacements);
  });
  const currentNeeds = [...open, ...transitioned].sort((a, b) => a.needId.localeCompare(b.needId));
  currentNeeds.forEach((need) => validateInformationNeedV2(need));
  const history = uniqueData([...priorNeedRecords, ...currentNeeds]);
  const semantic = { contractVersion: INFORMATION_NEED_SET_V2, caseReference: casePin(caseState), policyIdentity: identity, currentNeeds, history };
  const setHash = hashArtifact(semantic);
  return deepFreeze(cloneData({ ...semantic, needSetId: `${INFORMATION_NEED_SET_V2}:${setHash.slice(7, 39)}`, setHash }));
}
function diagnostic(kind, need, references, reasonCode) {
  assertEnum(kind, NEED_DIAGNOSTIC_KIND, "diagnostic.kind");
  assertPlainObject(references, "diagnostic.references");
  const semantic = { contractVersion: NEED_DEPENDENT_DIAGNOSTIC_V1, kind, causalNeedId: need.needId, references: cloneData(references), reasonCode };
  return { ...semantic, diagnosticId: `${NEED_DEPENDENT_DIAGNOSTIC_V1}:${hashArtifact(semantic).slice(7, 39)}` };
}
function createDependentDiagnosticsV1(needs) {
  assertArray(needs, "informationNeeds");
  const diagnostics = [];
  needs.filter(({ status }) => status === INFORMATION_NEED_V2_STATE.OPEN).forEach((need) => {
    need.affected.pathIds.forEach((pathId) => diagnostics.push(diagnostic(NEED_DIAGNOSTIC_KIND.CALCULATION_PATH_BLOCKED, need, { pathId, calculationIds: need.affected.calculationIds, relationshipIds: need.affected.relationshipIds }, need.reasonCode)));
    need.affected.qualificationRouteIds.forEach((routeId) => diagnostics.push(diagnostic(NEED_DIAGNOSTIC_KIND.QUALIFICATION_ROUTE_INDETERMINATE, need, { routeId, personIds: need.affected.personIds }, need.reasonCode)));
    need.affected.requirementIds.forEach((requirementId) => diagnostics.push(diagnostic(NEED_DIAGNOSTIC_KIND.REQUIREMENT_UNRESOLVED, need, { requirementId }, need.reasonCode)));
    need.affected.closureAssessmentIds.forEach((closureAssessmentId) => diagnostics.push(diagnostic(NEED_DIAGNOSTIC_KIND.LAYER_CLOSURE_BLOCKED, need, { closureAssessmentId }, need.reasonCode)));
    need.affected.evidenceAssessmentIds.forEach((evidenceAssessmentId) => diagnostics.push(diagnostic(NEED_DIAGNOSTIC_KIND.EVIDENCE_SUFFICIENCY_UNMET, need, { evidenceAssessmentId }, need.reasonCode)));
    if (need.concept === INFORMATION_NEED_V2_CONCEPT.RELATIONSHIP_CURRENTNESS) diagnostics.push(diagnostic(NEED_DIAGNOSTIC_KIND.CURRENTNESS_REQUIRED, need, { relationshipId: need.relationshipId }, need.reasonCode));
    if ([INFORMATION_NEED_V2_CONCEPT.IDENTITY_AGGREGATION, INFORMATION_NEED_V2_CONCEPT.QUALIFYING_PERSON_ATTRIBUTES].includes(need.concept)) diagnostics.push(diagnostic(NEED_DIAGNOSTIC_KIND.IDENTITY_REQUIRED, need, { personIds: need.affected.personIds }, need.reasonCode));
    if (need.requiredFact.type === "EXACT_PERCENTAGE_OR_DECISION_SUFFICIENT_RANGE") diagnostics.push(diagnostic(NEED_DIAGNOSTIC_KIND.EXACTNESS_REQUIRED, need, { relationshipId: need.relationshipId || null }, need.reasonCode));
  });
  const result = uniqueData(diagnostics).sort((a, b) => a.diagnosticId.localeCompare(b.diagnosticId));
  return deepFreeze(cloneData(result));
}

module.exports = {
  INFORMATION_NEED_SET_V2,
  INFORMATION_NEED_TARGET_KIND,
  INFORMATION_NEED_V2,
  INFORMATION_NEED_V2_CONCEPT,
  INFORMATION_NEED_V2_STATE,
  NEED_DEPENDENT_DIAGNOSTIC_V1,
  NEED_DIAGNOSTIC_KIND,
  createDependentDiagnosticsV1,
  createInformationNeedSetV2,
  validateInformationNeedV2,
};
