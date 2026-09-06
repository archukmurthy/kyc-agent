"use strict";

const {
  APPLICABILITY_RESULT,
  CANDIDATE_FACT_TYPE,
  CLAIM_STATE,
  PERCENTAGE_VALUE_TYPE,
  RELATIONSHIP_TYPE,
  REQUIREMENT_STATE,
} = require("../contracts/constants");
const { CANONICAL_ENTITY_CATEGORY } = require("../domain/canonicalEntity");
const {
  INFORMATION_NEED_TARGET_KIND,
  INFORMATION_NEED_V2,
  INFORMATION_NEED_V2_CONCEPT,
  INFORMATION_NEED_V2_STATE,
  createDependentDiagnosticsV1,
  createInformationNeedSetV2,
} = require("../domain/informationNeedV2");
const { GRAPH_DIMENSION, TEMPORAL_STATE } = require("../domain/ownershipGraph");
const { assertDataOnly, cloneData, deepFreeze, fail } = require("../internal/validation");
const { hashArtifact } = require("../internal/phasedArtifact");

const REQUIREMENT_RESOLUTION_V2 = "ubo-requirement-resolution-v2";
const REQUIREMENT_RESOLUTION_ASSESSMENT_V2 = "ubo-requirement-resolution-assessment-v2";
const REVIEW_REQUIREMENT_COMPAT = "ubo-review-requirement-v1-compat";
const SPECIALIST_ROUTE_COMPAT = "ubo-specialist-route-v1-compat";
const PSC_COMPARISON_V1 = "ubo-psc-comparison-v1-review";

const COMPARISON_CATEGORY = Object.freeze({
  NO_DIFFERENCE: "NO_DIFFERENCE",
  REGISTER_SCOPE_DIFFERENCE: "REGISTER_SCOPE_DIFFERENCE",
  METHOD_DIFFERENCE: "METHOD_DIFFERENCE",
  TIMING_STALENESS: "TIMING_STALENESS",
  POTENTIAL_MATERIAL_DISCREPANCY: "POTENTIAL_MATERIAL_DISCREPANCY",
  REVIEW_REQUIRED: "REVIEW_REQUIRED",
});
const CONTROL_TYPES = new Set([RELATIONSHIP_TYPE.BOARD_APPOINTMENT_RIGHT, RELATIONSHIP_TYPE.BOARD_REMOVAL_RIGHT, RELATIONSHIP_TYPE.FORMAL_CONTROL_RIGHT, RELATIONSHIP_TYPE.SIGNIFICANT_INFLUENCE_OR_CONTROL]);
const TRUST_TYPES = new Set([RELATIONSHIP_TYPE.TRUST_OWNERSHIP, RELATIONSHIP_TYPE.SETTLOR, RELATIONSHIP_TYPE.TRUSTEE, RELATIONSHIP_TYPE.PROTECTOR, RELATIONSHIP_TYPE.BENEFICIARY, RELATIONSHIP_TYPE.CONTROL_OVER_TRUST_OR_INTERMEDIARY]);

function unique(values) { return [...new Set((values || []).filter(Boolean))].sort(); }
function profile(entity) {
  if (entity.category === CANONICAL_ENTITY_CATEGORY.NATURAL_PERSON) return "NATURAL_PERSON";
  if (entity.category === CANONICAL_ENTITY_CATEGORY.TRUST_OR_LEGAL_ARRANGEMENT) return "TRUST";
  return String(entity.entityTypeMetadata?.entityProfile || entity.entityTypeMetadata?.sourceEntityType || "UNSUPPORTED").toUpperCase();
}
function policyIdentity(loaded) {
  return { policyPackId: loaded.identity.policyPackId, policyVersion: loaded.identity.version, policyHash: loaded.identity.hash, policySchemaVersion: loaded.identity.schemaVersion };
}
function calculationId(calculation) { return calculation.calculationId || `calculation-result:${hashArtifact(calculation).slice(7, 39)}`; }
function allPaths(calculation) { return [...(calculation.knownPaths || []), ...(calculation.unresolvedPaths || [])]; }
function affectedForRelationships(calculations, relationshipIds, extras = {}) {
  const wanted = new Set(relationshipIds);
  const affectedCalculations = [];
  const pathIds = [];
  calculations.forEach((calculation) => {
    const matched = allPaths(calculation).filter((path) => (path.relationshipIds || []).some((id) => wanted.has(id)));
    if (matched.length > 0) affectedCalculations.push(calculationId(calculation));
    matched.forEach(({ pathId }) => pathIds.push(pathId));
  });
  return {
    qualificationRouteIds: unique(extras.qualificationRouteIds),
    calculationIds: unique([...affectedCalculations, ...(extras.calculationIds || [])]),
    pathIds: unique([...pathIds, ...(extras.pathIds || [])]),
    relationshipIds: unique([...(relationshipIds || []), ...(extras.relationshipIds || [])]),
    personIds: unique(extras.personIds),
    requirementIds: unique(extras.requirementIds),
    closureAssessmentIds: unique(extras.closureAssessmentIds),
    evidenceAssessmentIds: unique(extras.evidenceAssessmentIds),
    attributionAssessmentIds: unique(extras.attributionAssessmentIds),
  };
}
function pathExists(graph, from, target, predicate = () => true) {
  const outgoing = new Map();
  graph.relationships.filter((relationship) => relationship.temporalState !== TEMPORAL_STATE.CEASED && predicate(relationship)).forEach((relationship) => {
    if (!outgoing.has(relationship.subjectEntityId)) outgoing.set(relationship.subjectEntityId, []);
    outgoing.get(relationship.subjectEntityId).push(relationship);
  });
  const seen = new Set();
  function visit(id) {
    if (id === target) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return (outgoing.get(id) || []).some(({ objectEntityId }) => visit(objectEntityId));
  }
  return visit(from);
}
function phaseReferences(phaseArtifacts, phaseIds) {
  return (phaseArtifacts || []).filter(({ phaseId }) => phaseIds.includes(phaseId)).map(({ phaseId, outputArtifactId, outputHash }) => ({ phaseId, outputArtifactId, outputHash }));
}
function feature(policyPack, id) { return policyPack.productionReadiness.features.find(({ featureId }) => featureId === id); }
function strategyReferences(policyPack, requirementIds, concept, { systemOnly = false } = {}) {
  const refs = [];
  requirementIds.forEach((requirementId) => {
    const requirement = policyPack.requirements.find((item) => item.requirementId === requirementId);
    (requirement?.resolutionStrategies || []).forEach((entry, index) => {
      if (systemOnly && !["DISCOVERY", "EXISTING_EVIDENCE", "DETERMINISTIC_CALCULATION", "ANALYST_REVIEW"].includes(entry.strategy)) return;
      const template = entry.actionTemplateId ? policyPack.actionTemplates[entry.actionTemplateId] : null;
      let eligibleForPlanning = true;
      let contentStatus = template?.contentStatus || "NOT_REQUIRED";
      const requiredSignoffIds = [];
      if (["VOTING_CONTROL_STATUS", "APPOINTMENT_MAJORITY_SCOPE"].includes(concept) && ["CUSTOMER_QUESTION", "CUSTOMER_ATTESTATION"].includes(entry.strategy)) {
        const gate = feature(policyPack, "NUMERIC_CUSTOMER_CONTROL_QUESTIONS");
        eligibleForPlanning = gate?.enabled === true;
        requiredSignoffIds.push(...(gate?.requiredSignoffIds || []));
        if (!eligibleForPlanning) contentStatus = "BLOCKED_PENDING_SIGNOFF";
      }
      if (["OTHER_SIGNIFICANT_CONTROL_STATUS", "TRUST_STATUS", "NOMINEE_BEARER_STATUS", "CASE_COMPLETENESS_ATTESTATION"].includes(concept)
        && ["CUSTOMER_QUESTION", "CUSTOMER_ATTESTATION"].includes(entry.strategy)) {
        eligibleForPlanning = false;
        contentStatus = "DISABLED_RESIDUAL_CONTENT";
        requiredSignoffIds.push("A-02", "A-17");
      }
      if (template && ["UNRESOLVED_SOURCE_REFERENCE", "DISABLED_REQUIRES_A_02_AND_A_17"].includes(template.contentStatus)) eligibleForPlanning = false;
      refs.push({ requirementId, strategyIndex: index, strategy: entry.strategy, ...(entry.actionTemplateId ? { actionTemplateId: entry.actionTemplateId } : {}), contentStatus, eligibleForPlanning, requiredSignoffIds: unique(requiredSignoffIds) });
    });
  });
  return refs;
}
function contentReadiness(strategies) {
  const customer = strategies.filter(({ strategy }) => strategy.startsWith("CUSTOMER_"));
  if (customer.length === 0) return "NO_CUSTOMER_CONTENT_REQUIRED";
  return customer.some(({ eligibleForPlanning }) => eligibleForPlanning) ? "POLICY_CONTENT_AVAILABLE" : "POLICY_CONTENT_BLOCKED";
}
function draft(context, { requirementIds, targetKind, targetReference, concept, dimension, relationshipBasis, requiredFact, requiredEvidenceCondition, reasonCode, relationshipId, frontierEntityId, affected, signoffs = [], systemOnly = false }) {
  const strategies = strategyReferences(context.policyPack, requirementIds, concept, { systemOnly });
  return {
    requiredByRequirementIds: requirementIds,
    targetKind,
    targetReference,
    ...(frontierEntityId ? { frontierEntityId } : {}),
    ...(relationshipId ? { relationshipId } : {}),
    concept,
    ...(dimension ? { dimension } : {}),
    ...(relationshipBasis ? { relationshipBasis } : {}),
    temporalScope: "CURRENT",
    requiredFact,
    ...(requiredEvidenceCondition ? { requiredEvidenceCondition } : {}),
    reasonCode,
    causalReferences: context.causalReferences,
    affected: { ...affected, requirementIds: unique([...(affected?.requirementIds || []), ...requirementIds]) },
    permittedResolutionStrategyReferences: strategies,
    policyActionTemplateReferences: unique(strategies.map(({ actionTemplateId }) => actionTemplateId)),
    contentReadinessStatus: contentReadiness(strategies),
    requiredSignoffIds: unique([...signoffs, ...strategies.flatMap(({ requiredSignoffIds }) => requiredSignoffIds)]),
  };
}
function relationshipRequirements(relationship) {
  if (relationship.dimension === GRAPH_DIMENSION.ECONOMIC) return ["UBO-R01", "UBO-R02", "UBO-R03"];
  if (relationship.dimension === GRAPH_DIMENSION.VOTING) return ["UBO-R02", "UBO-R03", "UBO-R04"];
  if ([RELATIONSHIP_TYPE.BOARD_APPOINTMENT_RIGHT, RELATIONSHIP_TYPE.BOARD_REMOVAL_RIGHT].includes(relationship.relationshipType)) return ["UBO-R03", "UBO-R05"];
  if (CONTROL_TYPES.has(relationship.relationshipType)) return ["UBO-R03", "UBO-R06"];
  return ["UBO-R03"];
}
function relationshipTarget(relationship) {
  return { relationshipId: relationship.relationshipId, subjectEntityId: relationship.subjectEntityId, objectEntityId: relationship.objectEntityId };
}
function createReview(context, { reasonCode, requirementIds, entityIds = [], relationshipIds = [], personIds = [], basisIds = [], signoffs = [], relatedNeedIds = [] }) {
  const semantic = { contractVersion: REVIEW_REQUIREMENT_COMPAT, caseReference: context.caseReference, policyIdentity: context.policyIdentity, reasonCode, requirementIds: unique(requirementIds), entityIds: unique(entityIds), relationshipIds: unique(relationshipIds), personIds: unique(personIds), basisIds: unique(basisIds), relatedInformationNeedIds: unique(relatedNeedIds), requiredSignoffIds: unique(signoffs), governanceState: "REVIEW_ONLY", productionAuthorized: false };
  return { ...semantic, reviewRequirementId: `${REVIEW_REQUIREMENT_COMPAT}:${hashArtifact(semantic).slice(7, 39)}` };
}
function createSpecialist(context, { reasonCode, requirementIds, entityIds = [], relationshipIds = [], signoffs = [] }) {
  const semantic = { contractVersion: SPECIALIST_ROUTE_COMPAT, caseReference: context.caseReference, policyIdentity: context.policyIdentity, reasonCode, requirementIds: unique(requirementIds), entityIds: unique(entityIds), relationshipIds: unique(relationshipIds), requiredSignoffIds: unique(signoffs), state: "SPECIALIST_REVIEW_REQUIRED", governanceState: "REVIEW_ONLY", productionAuthorized: false };
  return { ...semantic, specialistRouteId: `${SPECIALIST_ROUTE_COMPAT}:${hashArtifact(semantic).slice(7, 39)}` };
}
function pscComparison(context) {
  let category = COMPARISON_CATEGORY.NO_DIFFERENCE;
  if (context.facts.psc_comparison_category && Object.values(COMPARISON_CATEGORY).includes(context.facts.psc_comparison_category)) category = context.facts.psc_comparison_category;
  else if ((context.relevantConflicts || []).length > 0 || context.percentageEvidence.some(({ classification }) => classification === "CONTRADICTED")) category = COMPARISON_CATEGORY.POTENTIAL_MATERIAL_DISCREPANCY;
  else if (context.facts.psc_record_stale === true) category = COMPARISON_CATEGORY.TIMING_STALENESS;
  else if (context.facts.register_scope_difference === true) category = COMPARISON_CATEGORY.REGISTER_SCOPE_DIFFERENCE;
  else if (context.facts.method_difference === true) category = COMPARISON_CATEGORY.METHOD_DIFFERENCE;
  const semantic = { comparisonVersion: PSC_COMPARISON_V1, category, caseReference: context.caseReference, policyIdentity: context.policyIdentity, reviewOnly: true, regulatoryReportSubmitted: false, reportCandidateCreated: false };
  return { ...semantic, comparisonId: `${PSC_COMPARISON_V1}:${hashArtifact(semantic).slice(7, 39)}` };
}
function applicabilityFor(context, requirementId) {
  const derived = context.applicability.requirements[requirementId];
  if (derived) return derived.applicable ? APPLICABILITY_RESULT.APPLIES : APPLICABILITY_RESULT.DOES_NOT_APPLY;
  const assessed = context.policyAssessment?.requirementAssessments?.find((item) => item.requirementId === requirementId)?.applicability;
  return assessed || APPLICABILITY_RESULT.APPLIES;
}
function positiveTrust(context) {
  return context.caseState.canonicalEntities.some(({ category }) => category === CANONICAL_ENTITY_CATEGORY.TRUST_OR_LEGAL_ARRANGEMENT)
    || context.graph.relationships.some(({ relationshipType }) => TRUST_TYPES.has(relationshipType));
}
function knownAttributes(context, personId) {
  const known = new Set();
  const entity = context.entities.get(personId);
  if (entity?.primaryName) known.add("full_legal_name");
  const resolvedPartyKeys = new Set(context.caseState.identityDecisions.filter(({ status, entityId }) => status === "RESOLVED" && entityId === personId).map(({ candidatePartyKey }) => candidatePartyKey));
  const claims = context.caseState.candidateClaims.filter((claim) => claim.claimType === CANDIDATE_FACT_TYPE.ENTITY_ATTRIBUTE && claim.status === CLAIM_STATE.OPERATIVE && resolvedPartyKeys.has(claim.subject?.candidatePartyKey));
  claims.forEach(({ attribute, value }) => { if (value !== null && value !== "") known.add(attribute); });
  if (context.personAssessments.some(({ personEntityId, satisfiedBasisIds }) => personEntityId === personId && satisfiedBasisIds.length > 0)) known.add("ownership_or_control_basis");
  return known;
}
function buildDrafts(context) {
  const drafts = [];
  const reviews = [];
  const specialists = [];
  const relevantEntities = new Set([context.targetEntityId, ...context.graphContext.intermediateLegalEntityIds]);
  const relevantRelationships = context.graph.relationships.filter((relationship) => relevantEntities.has(relationship.objectEntityId)
    || pathExists(context.graph, relationship.objectEntityId, context.targetEntityId));

  relevantRelationships.forEach((relationship) => {
    const requirementIds = relationshipRequirements(relationship);
    const affected = affectedForRelationships(context.calculations, [relationship.relationshipId]);
    if (relationship.dimension && (!relationship.measurement || relationship.measurement.type === PERCENTAGE_VALUE_TYPE.UNKNOWN)) {
      drafts.push(draft(context, { requirementIds, targetKind: INFORMATION_NEED_TARGET_KIND.RELATIONSHIP, targetReference: relationshipTarget(relationship), relationshipId: relationship.relationshipId, concept: INFORMATION_NEED_V2_CONCEPT.RELATIONSHIP_PERCENTAGE, dimension: relationship.dimension, relationshipBasis: relationship.relationshipType, requiredFact: { type: "PERCENTAGE_OR_DECISION_SUFFICIENT_RANGE", allowedValueTypes: ["EXACT", "RANGE"] }, reasonCode: "MATERIAL_RELATIONSHIP_VALUE_UNKNOWN", affected }));
    }
    if (relationship.temporalState === TEMPORAL_STATE.UNKNOWN) {
      drafts.push(draft(context, { requirementIds, targetKind: INFORMATION_NEED_TARGET_KIND.RELATIONSHIP, targetReference: relationshipTarget(relationship), relationshipId: relationship.relationshipId, concept: INFORMATION_NEED_V2_CONCEPT.RELATIONSHIP_CURRENTNESS, dimension: relationship.dimension || "CONTROL", relationshipBasis: relationship.relationshipType, requiredFact: { type: "CURRENTNESS_STATE", requiredValue: "CURRENT" }, reasonCode: "MATERIAL_RELATIONSHIP_CURRENTNESS_UNKNOWN", affected }));
    }
  });

  const legalEntities = context.caseState.canonicalEntities.filter(({ entityId, category }) => entityId !== context.targetEntityId && category === CANONICAL_ENTITY_CATEGORY.LEGAL_ENTITY);
  legalEntities.forEach((entity) => {
    const economicDownstream = pathExists(context.graph, entity.entityId, context.targetEntityId, ({ dimension }) => dimension === GRAPH_DIMENSION.ECONOMIC);
    const incomingEconomic = context.graph.relationships.some(({ objectEntityId, dimension, temporalState }) => objectEntityId === entity.entityId && dimension === GRAPH_DIMENSION.ECONOMIC && temporalState !== TEMPORAL_STATE.CEASED);
    if (economicDownstream && !incomingEconomic) {
      const downstreamIds = relevantRelationships.filter(({ dimension, subjectEntityId }) => dimension === GRAPH_DIMENSION.ECONOMIC && pathExists(context.graph, subjectEntityId, context.targetEntityId, ({ dimension: itemDimension }) => itemDimension === GRAPH_DIMENSION.ECONOMIC)).map(({ relationshipId }) => relationshipId);
      drafts.push(draft(context, { requirementIds: ["UBO-R01", "UBO-R02", "UBO-R03"], targetKind: INFORMATION_NEED_TARGET_KIND.FRONTIER_ENTITY, targetReference: { entityId: entity.entityId }, frontierEntityId: entity.entityId, concept: INFORMATION_NEED_V2_CONCEPT.CURRENT_OWNERSHIP_AND_CONTROL, dimension: GRAPH_DIMENSION.ECONOMIC, requiredFact: { type: "CURRENT_UPSTREAM_HOLDER_SET", entityProfile: profile(entity) }, reasonCode: "ECONOMIC_OWNERSHIP_FRONTIER_REACHED", affected: affectedForRelationships(context.calculations, downstreamIds), systemOnly: false }));
    }
  });

  relevantRelationships.filter(({ relationshipType }) => CONTROL_TYPES.has(relationshipType)).forEach((relationship) => {
    const subject = context.entities.get(relationship.subjectEntityId);
    if (subject?.category !== CANONICAL_ENTITY_CATEGORY.LEGAL_ENTITY) return;
    const incoming = context.graph.relationships.some(({ objectEntityId, temporalState }) => objectEntityId === subject.entityId && temporalState !== TEMPORAL_STATE.CEASED);
    if (incoming) return;
    const requirementId = [RELATIONSHIP_TYPE.BOARD_APPOINTMENT_RIGHT, RELATIONSHIP_TYPE.BOARD_REMOVAL_RIGHT].includes(relationship.relationshipType) ? "UBO-R05" : "UBO-R06";
    drafts.push(draft(context, { requirementIds: ["UBO-R03", requirementId], targetKind: INFORMATION_NEED_TARGET_KIND.FRONTIER_ENTITY, targetReference: { entityId: subject.entityId }, frontierEntityId: subject.entityId, concept: INFORMATION_NEED_V2_CONCEPT.CURRENT_OWNERSHIP_AND_CONTROL, dimension: "CONTROL", relationshipBasis: relationship.relationshipType, requiredFact: { type: "NATURAL_PERSON_CONTROL_ATTRIBUTION" }, reasonCode: "LEGAL_ENTITY_CONTROL_HOLDER_FRONTIER_REACHED", affected: affectedForRelationships(context.calculations, [relationship.relationshipId]) }));
  });

  const llpReviewBases = context.llpAssessments.flatMap(({ basisRecords = [] }) => basisRecords.filter(({ assessmentState }) => assessmentState === "REVIEW_REQUIRED"));
  if (llpReviewBases.length > 0) {
    const llpEntity = context.caseState.canonicalEntities.find((entity) => profile(entity) === "LLP");
    const personIds = unique(llpReviewBases.map(({ personEntityId }) => personEntityId));
    const relationshipIds = unique(context.graph.relationships.filter(({ subjectEntityId, objectEntityId }) => personIds.includes(subjectEntityId) || objectEntityId === llpEntity?.entityId).map(({ relationshipId }) => relationshipId));
    const llpDraft = draft(context, { requirementIds: ["UBO-R01", "UBO-R02", "UBO-R04"], targetKind: INFORMATION_NEED_TARGET_KIND.QUALIFICATION_ROUTE, targetReference: { personEntityId: personIds[0], routeIds: ["PSC_CONDITION_ATTRIBUTION"], groupPersonIds: personIds, frontierEntityId: llpEntity?.entityId }, frontierEntityId: llpEntity?.entityId, concept: INFORMATION_NEED_V2_CONCEPT.LLP_GOVERNANCE_CONTROL_BASIS, dimension: "CONTROL", relationshipBasis: "LLP_PSC_ATTRIBUTION", requiredFact: { type: "LLP_GOVERNANCE_CONTROL_INTERPRETATION", workingAssumptionRef: "A-06-WA-01" }, requiredEvidenceCondition: { type: "GOVERNANCE_EVIDENCE_AND_REVIEW" }, reasonCode: "LLP_GOVERNANCE_CONTROL_REQUIRES_REVIEW", affected: affectedForRelationships(context.calculations, relationshipIds, { personIds, qualificationRouteIds: ["PSC_CONDITION_ATTRIBUTION"], attributionAssessmentIds: context.llpAssessments.map(({ assessmentId }) => assessmentId) }), signoffs: ["A-06"], systemOnly: true });
    drafts.push(llpDraft);
  }

  relevantRelationships.filter(({ relationshipType }) => [RELATIONSHIP_TYPE.BOARD_APPOINTMENT_RIGHT, RELATIONSHIP_TYPE.BOARD_REMOVAL_RIGHT].includes(relationshipType)).forEach((relationship) => {
    const scoped = relationship.qualifiers?.majorityScope === true;
    if (scoped) return;
    const appointmentDraft = draft(context, { requirementIds: ["UBO-R05"], targetKind: INFORMATION_NEED_TARGET_KIND.RELATIONSHIP, targetReference: relationshipTarget(relationship), relationshipId: relationship.relationshipId, concept: INFORMATION_NEED_V2_CONCEPT.APPOINTMENT_MAJORITY_SCOPE, dimension: "CONTROL", relationshipBasis: relationship.relationshipType, requiredFact: { type: "MAJORITY_APPOINTMENT_OR_REMOVAL_SCOPE" }, requiredEvidenceCondition: { type: "GOVERNANCE_DOCUMENT_OR_INTERPRETATION" }, reasonCode: "APPOINTMENT_REMOVAL_MAJORITY_SCOPE_UNESTABLISHED", affected: affectedForRelationships(context.calculations, [relationship.relationshipId]), signoffs: ["A-12"] });
    drafts.push(appointmentDraft);
  });

  const targetEconomicClosure = context.closures.find(({ targetEntity, dimension }) => targetEntity.entityId === context.targetEntityId && dimension === GRAPH_DIMENSION.ECONOMIC);
  if (targetEconomicClosure?.statutoryClosure?.state === "OPEN") {
    drafts.push(draft(context, { requirementIds: ["UBO-R01"], targetKind: INFORMATION_NEED_TARGET_KIND.REGULATED_SUBJECT, targetReference: { entityId: context.targetEntityId }, concept: INFORMATION_NEED_V2_CONCEPT.ADDITIONAL_DIRECT_HOLDER, dimension: GRAPH_DIMENSION.ECONOMIC, requiredFact: { type: "COMPLETE_DIRECT_MATERIAL_HOLDER_SET" }, reasonCode: "STATUTORY_DIRECT_ECONOMIC_LAYER_OPEN", affected: affectedForRelationships(context.calculations, targetEconomicClosure.countedRelationshipIds, { closureAssessmentIds: [targetEconomicClosure.assessmentId] }) }));
  } else if (targetEconomicClosure?.statutoryClosure?.state === "INDETERMINATE" && targetEconomicClosure.statutoryClosure.blockingQualifierIds?.length > 0) {
    drafts.push(draft(context, { requirementIds: ["UBO-R01"], targetKind: INFORMATION_NEED_TARGET_KIND.EVIDENCE_SUFFICIENCY, targetReference: { entityId: context.targetEntityId, relationshipIds: targetEconomicClosure.countedRelationshipIds }, concept: INFORMATION_NEED_V2_CONCEPT.LAYER_QUALIFIER, dimension: GRAPH_DIMENSION.ECONOMIC, requiredFact: { type: "LAYER_CLOSURE_QUALIFIERS", qualifierIds: unique(targetEconomicClosure.statutoryClosure.blockingQualifierIds) }, reasonCode: "DIRECT_LAYER_CLOSURE_QUALIFIER_UNESTABLISHED", affected: affectedForRelationships(context.calculations, targetEconomicClosure.countedRelationshipIds, { closureAssessmentIds: [targetEconomicClosure.assessmentId] }) }));
  }
  context.closures.filter(({ exactnessNeededForDetermination }) => ["REQUIRED_FOR_THRESHOLD_DETERMINATION", "REQUIRED_FOR_LAYER_CLOSURE"].includes(exactnessNeededForDetermination?.state)).forEach((closure) => {
    (closure.countedRelationshipIds || []).forEach((relationshipId) => {
      const relationship = context.graph.relationships.find((item) => item.relationshipId === relationshipId);
      if (!relationship) return;
      drafts.push(draft(context, { requirementIds: closure.dimension === GRAPH_DIMENSION.VOTING ? ["UBO-R02", "UBO-R04"] : ["UBO-R01", "UBO-R02"], targetKind: INFORMATION_NEED_TARGET_KIND.RELATIONSHIP, targetReference: relationshipTarget(relationship), relationshipId, concept: INFORMATION_NEED_V2_CONCEPT.RELATIONSHIP_PERCENTAGE, dimension: closure.dimension, relationshipBasis: relationship.relationshipType, requiredFact: { type: "EXACT_PERCENTAGE_OR_DECISION_SUFFICIENT_RANGE" }, reasonCode: closure.exactnessNeededForDetermination.reasonCode, affected: affectedForRelationships(context.calculations, [relationshipId], { closureAssessmentIds: [closure.assessmentId] }) }));
    });
  });

  const directVoting = context.graph.relationships.filter(({ objectEntityId, dimension, temporalState }) => objectEntityId === context.targetEntityId && dimension === GRAPH_DIMENSION.VOTING && temporalState !== TEMPORAL_STATE.CEASED);
  if (directVoting.length === 0 && context.answers.DISCLOSE_VOTING_CONTROL !== "no") {
    drafts.push(draft(context, { requirementIds: ["UBO-R04"], targetKind: INFORMATION_NEED_TARGET_KIND.REGULATED_SUBJECT, targetReference: { entityId: context.targetEntityId }, concept: INFORMATION_NEED_V2_CONCEPT.VOTING_CONTROL_STATUS, dimension: GRAPH_DIMENSION.VOTING, requiredFact: { type: "SUBJECT_LEVEL_VOTING_CONTROL_STATUS" }, reasonCode: "SUBJECT_VOTING_CONTROL_STATUS_INCOMPLETE", affected: affectedForRelationships(context.calculations, []) , signoffs: ["A-04", "A-17"] }));
  }
  const directOtherControl = context.graph.relationships.some(({ objectEntityId, relationshipType }) => objectEntityId === context.targetEntityId && [RELATIONSHIP_TYPE.FORMAL_CONTROL_RIGHT, RELATIONSHIP_TYPE.SIGNIFICANT_INFLUENCE_OR_CONTROL].includes(relationshipType));
  if (!directOtherControl && context.answers.DISCLOSE_OTHER_SIGNIFICANT_CONTROL !== "no") {
    drafts.push(draft(context, { requirementIds: ["UBO-R06"], targetKind: INFORMATION_NEED_TARGET_KIND.REGULATED_SUBJECT, targetReference: { entityId: context.targetEntityId }, concept: INFORMATION_NEED_V2_CONCEPT.OTHER_SIGNIFICANT_CONTROL_STATUS, dimension: "CONTROL", requiredFact: { type: "SUBJECT_LEVEL_OTHER_SIGNIFICANT_CONTROL_STATUS" }, reasonCode: "OTHER_SIGNIFICANT_CONTROL_NEGATIVE_OR_POSITIVE_STATUS_INCOMPLETE", affected: affectedForRelationships(context.calculations, []), signoffs: ["A-02", "A-17"] }));
  }

  const qualifying = context.personAssessments.filter(({ routeStatus }) => routeStatus === "ROUTE_SATISFIED");
  const configured = context.policyPack.requirements.find(({ requirementId }) => requirementId === "UBO-R07").minimumIdentityAttributes;
  const requested = context.caseContext.requiredIdentityAttributes || configured;
  qualifying.forEach((person) => {
    const normalized = requested.map((value) => value.replace(/_if_available_or_required$/, ""));
    const known = knownAttributes(context, person.personEntityId);
    const missing = unique(normalized.filter((attribute) => !known.has(attribute)));
    if (missing.length === 0) return;
    drafts.push(draft(context, { requirementIds: ["UBO-R07"], targetKind: INFORMATION_NEED_TARGET_KIND.PERSON_ATTRIBUTE_SET, targetReference: { personEntityId: person.personEntityId, attributeCodes: missing }, concept: INFORMATION_NEED_V2_CONCEPT.QUALIFYING_PERSON_ATTRIBUTES, requiredFact: { type: "PERSON_ATTRIBUTE_SET", attributeCodes: missing }, reasonCode: "QUALIFYING_PERSON_ATTRIBUTES_MISSING", affected: affectedForRelationships(context.calculations, [], { personIds: [person.personEntityId], qualificationRouteIds: person.assessedRoutes }), systemOnly: false }));
  });

  const r08Evidence = context.evidenceSufficiency.find(({ requirementId }) => requirementId === "UBO-R08");
  if (!r08Evidence || r08Evidence.status !== "SUFFICIENT") {
    const relationshipIds = unique(relevantRelationships.map(({ relationshipId }) => relationshipId));
    drafts.push(draft(context, { requirementIds: ["UBO-R08"], targetKind: INFORMATION_NEED_TARGET_KIND.EVIDENCE_SUFFICIENCY, targetReference: { entityId: context.targetEntityId, relationshipIds }, concept: INFORMATION_NEED_V2_CONCEPT.INDEPENDENT_CORROBORATION, requiredFact: { type: "DISTINCT_INDEPENDENT_STRUCTURE_SOURCE" }, requiredEvidenceCondition: { type: "POLICY_EVIDENCE_SUFFICIENCY", requirementId: "UBO-R08" }, reasonCode: "INDEPENDENT_STRUCTURE_CORROBORATION_INSUFFICIENT", affected: affectedForRelationships(context.calculations, relationshipIds, { evidenceAssessmentIds: r08Evidence ? [`evidence-sufficiency:${hashArtifact(r08Evidence).slice(7, 39)}`] : [] }) }));
  }

  if (context.facts.fallback_review_candidate === true && context.facts.senior_management_candidates_complete !== true) {
    drafts.push(draft(context, { requirementIds: ["UBO-R10"], targetKind: INFORMATION_NEED_TARGET_KIND.REGULATED_SUBJECT, targetReference: { entityId: context.targetEntityId }, concept: INFORMATION_NEED_V2_CONCEPT.SENIOR_MANAGEMENT_CANDIDATE, requiredFact: { type: "SENIOR_MANAGEMENT_CANDIDATE_SET" }, reasonCode: "FALLBACK_PREPARATION_REQUIRES_SENIOR_MANAGEMENT_CANDIDATES", affected: affectedForRelationships(context.calculations, []) }));
  }
  if (positiveTrust(context)) {
    const trustEntityIds = context.caseState.canonicalEntities.filter(({ category }) => category === CANONICAL_ENTITY_CATEGORY.TRUST_OR_LEGAL_ARRANGEMENT).map(({ entityId }) => entityId);
    specialists.push(createSpecialist(context, { reasonCode: "TRUST_OR_SPECIAL_STRUCTURE_REQUIRES_SPECIALIST", requirementIds: ["UBO-R11"], entityIds: trustEntityIds, relationshipIds: context.graph.relationships.filter(({ relationshipType }) => TRUST_TYPES.has(relationshipType)).map(({ relationshipId }) => relationshipId) }));
  } else if (context.answers.DISCLOSE_TRUST_IN_CHAIN !== "no" && context.facts.trust_in_chain !== false) {
    drafts.push(draft(context, { requirementIds: ["UBO-R11"], targetKind: INFORMATION_NEED_TARGET_KIND.REGULATED_SUBJECT, targetReference: { entityId: context.targetEntityId }, concept: INFORMATION_NEED_V2_CONCEPT.TRUST_STATUS, requiredFact: { type: "SUBJECT_TRUST_INVOLVEMENT_STATUS" }, reasonCode: "TRUST_STATUS_INCOMPLETE", affected: affectedForRelationships(context.calculations, []), signoffs: ["A-02", "A-17"] }));
  }
  if (context.facts.nominee_principal_unresolved === true) {
    const entityId = context.facts.nominee_holder_entity_id || context.targetEntityId;
    drafts.push(draft(context, { requirementIds: ["UBO-R12"], targetKind: INFORMATION_NEED_TARGET_KIND.FRONTIER_ENTITY, targetReference: { entityId }, frontierEntityId: entityId, concept: INFORMATION_NEED_V2_CONCEPT.UNDERLYING_NOMINEE_PRINCIPAL, requiredFact: { type: "UNDERLYING_NATURAL_PERSON_PRINCIPAL" }, reasonCode: "NOMINEE_PRINCIPAL_UNRESOLVED", affected: affectedForRelationships(context.calculations, []) }));
  } else if (context.facts.bearer_shares === true) {
    specialists.push(createSpecialist(context, { reasonCode: "BEARER_SHARE_STRUCTURE_REQUIRES_SPECIALIST", requirementIds: ["UBO-R12"], entityIds: [context.targetEntityId] }));
  } else if (context.answers.DISCLOSE_NOMINEE_OR_BEARER_ARRANGEMENT !== "no" && context.facts.nominee_or_bearer_status !== false) {
    drafts.push(draft(context, { requirementIds: ["UBO-R12"], targetKind: INFORMATION_NEED_TARGET_KIND.REGULATED_SUBJECT, targetReference: { entityId: context.targetEntityId }, concept: INFORMATION_NEED_V2_CONCEPT.NOMINEE_BEARER_STATUS, requiredFact: { type: "SUBJECT_NOMINEE_OR_BEARER_STATUS" }, reasonCode: "NOMINEE_OR_BEARER_STATUS_INCOMPLETE", affected: affectedForRelationships(context.calculations, []), signoffs: ["A-02", "A-17"] }));
  }
  return { drafts, reviews, specialists };
}
function operationalBlockers(context, needs) {
  return (context.operationContexts || []).flatMap((item) => {
    const operation = context.caseState.capabilityOperations.find(({ operationId }) => operationId === item.operationId);
    if (!operation || !["UNAVAILABLE", "FAILED"].includes(operation.outcome.state)) return [];
    const affectedNeedIds = needs.filter((need) => need.requiredByRequirementIds.some((id) => (item.requirementIds || []).includes(id))).map(({ needId }) => needId);
    const semantic = { contractVersion: "ubo-operational-blocker-v1-compat", caseReference: context.caseReference, policyIdentity: context.policyIdentity, operationId: operation.operationId, outcomeState: operation.outcome.state, affectedRequirementIds: unique(item.requirementIds), affectedInformationNeedIds: unique(affectedNeedIds), reasonCode: operation.outcome.code || `CAPABILITY_${operation.outcome.state}`, state: "OPEN" };
    return [{ ...semantic, blockerId: `ubo-operational-blocker-v1-compat:${hashArtifact(semantic).slice(7, 39)}` }];
  });
}
function requirementRecord(context, requirementId, applicability, needs, blockers, reviews, specialists, comparison) {
  let resolutionState;
  let reasonCode;
  if (applicability === APPLICABILITY_RESULT.DOES_NOT_APPLY) { resolutionState = REQUIREMENT_STATE.N_A; reasonCode = "REQUIREMENT_DOES_NOT_APPLY"; }
  else if (needs.length > 0) { resolutionState = REQUIREMENT_STATE.GAP; reasonCode = "CAUSAL_FACT_OR_EVIDENCE_CONDITION_OPEN"; }
  else if (specialists.length > 0 || reviews.length > 0) { resolutionState = REQUIREMENT_STATE.REVIEW_REQUIRED; reasonCode = specialists.length > 0 ? "SPECIALIST_ROUTE_REQUIRED" : "HUMAN_INTERPRETATION_REQUIRED"; }
  else if (blockers.length > 0) { resolutionState = REQUIREMENT_STATE.UNRESOLVED; reasonCode = "ONLY_CURRENT_BLOCKER_IS_OPERATIONAL"; }
  else if (requirementId === "UBO-R09" && [COMPARISON_CATEGORY.POTENTIAL_MATERIAL_DISCREPANCY, COMPARISON_CATEGORY.REVIEW_REQUIRED, COMPARISON_CATEGORY.TIMING_STALENESS].includes(comparison.category)) { resolutionState = REQUIREMENT_STATE.REVIEW_REQUIRED; reasonCode = `PSC_COMPARISON_${comparison.category}`; }
  else if (requirementId === "UBO-R10" && context.facts.fallback_review_candidate !== true) { resolutionState = REQUIREMENT_STATE.UNRESOLVED; reasonCode = "FALLBACK_NOT_ESTABLISHED_OR_REQUIRED"; }
  else { resolutionState = REQUIREMENT_STATE.RESOLVED; reasonCode = requirementId === "UBO-R13" ? "GRAPH_CONTEXT_ASSESSED_WITHOUT_CUSTOMER_NEED" : "NO_MATERIAL_CAUSAL_BLOCKER_REMAINS"; }
  const bases = context.personAssessments.flatMap(({ basisRecords = [] }) => basisRecords).filter((basis) => {
    if (requirementId === "UBO-R01") return basis.recordedCalculation?.dimension === GRAPH_DIMENSION.ECONOMIC || basis.route === "PSC_CONDITION_ATTRIBUTION";
    if (requirementId === "UBO-R04") return basis.recordedCalculation?.dimension === GRAPH_DIMENSION.VOTING || basis.route === "PSC_CONDITION_ATTRIBUTION";
    return false;
  });
  const semantic = {
    contractVersion: REQUIREMENT_RESOLUTION_ASSESSMENT_V2,
    requirementId,
    policyIdentity: context.policyIdentity,
    applicability,
    resolutionState,
    reasonCode,
    qualificationBasisIds: unique(bases.map(({ basisId }) => basisId)),
    calculationIds: unique(needs.flatMap(({ affected }) => affected.calculationIds)),
    attributionAssessmentIds: unique(needs.flatMap(({ affected }) => affected.attributionAssessmentIds)),
    closureAssessmentIds: unique(needs.flatMap(({ affected }) => affected.closureAssessmentIds)),
    evidenceAssessmentIds: unique(needs.flatMap(({ affected }) => affected.evidenceAssessmentIds)),
    causalInformationNeedIds: unique(needs.map(({ needId }) => needId)),
    operationalBlockerIds: unique(blockers.map(({ blockerId }) => blockerId)),
    reviewRequirementIds: unique(reviews.map(({ reviewRequirementId }) => reviewRequirementId)),
    specialistRouteIds: unique(specialists.map(({ specialistRouteId }) => specialistRouteId)),
    affectedEntityIds: unique(needs.flatMap((need) => [need.frontierEntityId, need.targetReference.entityId, need.targetReference.personEntityId, ...(need.affected.personIds || [])])),
    affectedRelationshipIds: unique(needs.flatMap(({ affected }) => affected.relationshipIds)),
    affectedPersonIds: unique(needs.flatMap(({ affected }) => affected.personIds)),
    requiredSignoffIds: unique([...needs.flatMap(({ requiredSignoffIds }) => requiredSignoffIds), ...reviews.flatMap(({ requiredSignoffIds }) => requiredSignoffIds), ...specialists.flatMap(({ requiredSignoffIds }) => requiredSignoffIds)]),
    governanceState: "REVIEW_ONLY",
    productionAuthorized: false,
  };
  return { ...semantic, requirementResolutionId: `${REQUIREMENT_RESOLUTION_ASSESSMENT_V2}:${hashArtifact(semantic).slice(7, 39)}` };
}

function resolveRequirementsV2(input) {
  assertDataOnly(input, "requirementResolutionV2Input");
  const context = {
    ...input,
    policyPack: input.loadedPolicyPack.policyPack,
    policyIdentity: policyIdentity(input.loadedPolicyPack),
    caseReference: { caseId: input.caseState.caseId, revisionId: input.caseState.revisionId, revision: input.caseState.revision },
    entities: new Map(input.caseState.canonicalEntities.map((entity) => [entity.entityId, entity])),
    facts: input.facts || {}, answers: input.answers || {}, percentageEvidence: input.percentageEvidence || [],
    causalReferences: phaseReferences(input.phaseArtifacts, ["CANONICAL_GRAPH_AND_DEPTH", "CALCULATIONS_AND_ATTRIBUTIONS", "QUALIFICATION", "DERIVED_REQUIREMENT_APPLICABILITY", "EVIDENCE_SUFFICIENCY"]),
  };
  if (context.loadedPolicyPack.identity.schemaVersion !== "1.3") fail("RequirementResolution v2 requires schema 1.3");
  const derived = buildDrafts(context);
  const needSet = createInformationNeedSetV2({ caseState: context.caseState, policyIdentity: context.policyIdentity, drafts: derived.drafts, priorNeedRecords: input.priorInformationNeedRecords || [], supersessionReason: input.supersessionReason || null });
  const openNeeds = needSet.currentNeeds.filter(({ status }) => status === INFORMATION_NEED_V2_STATE.OPEN);
  const diagnostics = createDependentDiagnosticsV1(openNeeds);
  const blockers = operationalBlockers(context, openNeeds);
  const comparison = pscComparison(context);
  const reviews = [...derived.reviews];
  const llpNeed = openNeeds.find(({ concept }) => concept === INFORMATION_NEED_V2_CONCEPT.LLP_GOVERNANCE_CONTROL_BASIS);
  if (llpNeed) reviews.push(createReview(context, { reasonCode: "LLP_GOVERNANCE_REQUIRES_CONTROL_ROOM_REVIEW", requirementIds: llpNeed.requiredByRequirementIds, entityIds: [llpNeed.frontierEntityId], personIds: llpNeed.affected.personIds, basisIds: llpNeed.affected.qualificationRouteIds, signoffs: ["A-06"], relatedNeedIds: [llpNeed.needId] }));
  openNeeds.filter(({ concept }) => concept === INFORMATION_NEED_V2_CONCEPT.APPOINTMENT_MAJORITY_SCOPE).forEach((need) => reviews.push(createReview(context, { reasonCode: "APPOINTMENT_REMOVAL_SCOPE_REQUIRES_INTERPRETATION", requirementIds: ["UBO-R05"], relationshipIds: [need.relationshipId], signoffs: ["A-12"], relatedNeedIds: [need.needId] })));
  if ([COMPARISON_CATEGORY.POTENTIAL_MATERIAL_DISCREPANCY, COMPARISON_CATEGORY.REVIEW_REQUIRED, COMPARISON_CATEGORY.TIMING_STALENESS].includes(comparison.category)) reviews.push(createReview(context, { reasonCode: `PSC_COMPARISON_${comparison.category}`, requirementIds: ["UBO-R09"] }));
  if (context.facts.fallback_review_candidate === true && context.facts.fallback_exhaustion_decided !== true) reviews.push(createReview(context, { reasonCode: "FALLBACK_EXHAUSTION_DECISION_REQUIRED", requirementIds: ["UBO-R10"] }));
  const requirementIds = context.policyPack.requirements.map(({ requirementId }) => requirementId);
  let resolutions = requirementIds.filter((id) => id !== "UBO-R14").map((requirementId) => requirementRecord(context, requirementId, applicabilityFor(context, requirementId), openNeeds.filter((need) => need.requiredByRequirementIds.includes(requirementId)), blockers.filter((blocker) => blocker.affectedRequirementIds.includes(requirementId)), reviews.filter((review) => review.requirementIds.includes(requirementId)), derived.specialists.filter((route) => route.requirementIds.includes(requirementId)), comparison));
  const closingReady = resolutions.every(({ resolutionState }) => [REQUIREMENT_STATE.RESOLVED, REQUIREMENT_STATE.N_A, REQUIREMENT_STATE.REVIEW_REQUIRED].includes(resolutionState));
  let r14Needs = [];
  let r14Draft = null;
  if (closingReady && context.answers.FINAL_STRUCTURE_COMPLETENESS_CONFIRMATION !== "yes") {
    r14Draft = draft(context, { requirementIds: ["UBO-R14"], targetKind: INFORMATION_NEED_TARGET_KIND.CASE, targetReference: { caseId: context.caseReference.caseId }, concept: INFORMATION_NEED_V2_CONCEPT.CASE_COMPLETENESS_ATTESTATION, requiredFact: { type: "FINAL_STRUCTURE_COMPLETENESS_ATTESTATION" }, reasonCode: "VALID_CLOSING_BOUNDARY_REQUIRES_COMPLETENESS_ATTESTATION", affected: affectedForRelationships(context.calculations, []), signoffs: ["A-02", "A-17"] });
    const r14Set = createInformationNeedSetV2({ caseState: context.caseState, policyIdentity: context.policyIdentity, drafts: [r14Draft] });
    r14Needs = r14Set.currentNeeds;
  }
  const r14Applicability = closingReady ? APPLICABILITY_RESULT.APPLIES : APPLICABILITY_RESULT.DOES_NOT_APPLY;
  resolutions.push(requirementRecord(context, "UBO-R14", r14Applicability, r14Needs, [], [], [], comparison));
  resolutions = resolutions.sort((a, b) => a.requirementId.localeCompare(b.requirementId));
  const fullNeedSet = r14Draft ? createInformationNeedSetV2({ caseState: context.caseState, policyIdentity: context.policyIdentity, drafts: [...derived.drafts, r14Draft], priorNeedRecords: input.priorInformationNeedRecords || [], supersessionReason: input.supersessionReason || null }) : needSet;
  const allCurrentNeeds = fullNeedSet.currentNeeds;
  const fullDiagnostics = createDependentDiagnosticsV1(allCurrentNeeds);
  const semantic = {
    requirementResolutionAlgorithm: REQUIREMENT_RESOLUTION_V2,
    assessmentContractVersion: REQUIREMENT_RESOLUTION_ASSESSMENT_V2,
    caseReference: context.caseReference,
    policyIdentity: context.policyIdentity,
    graphVersion: context.graph.graphVersion,
    informationNeedContractVersion: INFORMATION_NEED_V2,
    informationNeedSet: fullNeedSet,
    informationNeeds: allCurrentNeeds,
    dependentDiagnostics: fullDiagnostics,
    requirementResolutions: resolutions,
    operationalBlockers: blockers,
    reviewRequirements: reviews.sort((a, b) => a.reviewRequirementId.localeCompare(b.reviewRequirementId)),
    specialistRoutes: derived.specialists.sort((a, b) => a.specialistRouteId.localeCompare(b.specialistRouteId)),
    pscComparison: comparison,
    riskSignals: [{ signalId: `ubo-risk-signal:${hashArtifact(context.graphContext).slice(7, 39)}`, type: "STRUCTURE_DEPTH_AND_CROSS_BORDER", graphContextId: context.graphContext.contextId, depth: context.graphContext.r13CombinedOwnershipControlDepth, crossBorder: context.graphContext.hasCrossBorderRelationships }],
    governanceState: "REVIEW_ONLY",
    productionAuthorized: false,
    pipelineMaturity: "TRANSITIONAL_PLANNER_ONLY",
  };
  const resultHash = hashArtifact(semantic);
  return deepFreeze(cloneData({ ...semantic, assessmentId: `${REQUIREMENT_RESOLUTION_ASSESSMENT_V2}:${resultHash.slice(7, 39)}`, assessmentHash: resultHash }));
}

module.exports = { COMPARISON_CATEGORY, PSC_COMPARISON_V1, REQUIREMENT_RESOLUTION_ASSESSMENT_V2, REQUIREMENT_RESOLUTION_V2, REVIEW_REQUIREMENT_COMPAT, SPECIALIST_ROUTE_COMPAT, resolveRequirementsV2 };
