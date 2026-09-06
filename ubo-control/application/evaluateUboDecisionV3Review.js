"use strict";

const { APPLICABILITY_RESULT, PERCENTAGE_VALUE_TYPE, RELATIONSHIP_TYPE } = require("../contracts/constants");
const { CANONICAL_ENTITY_CATEGORY } = require("../domain/canonicalEntity");
const { createDecisionSnapshotV2 } = require("../domain/decisionSnapshotV2");
const { calculateEffectivePercentage, CALCULATION_STATUS } = require("../domain/percentageCalculation");
const { buildCanonicalOwnershipGraph, GRAPH_DIMENSION } = require("../domain/ownershipGraph");
const { validateOwnershipCase } = require("../domain/ownershipCase");
const { assertAllowedKeys, assertDataOnly, cloneData, deepFreeze, fail } = require("../internal/validation");
const { createPhaseArtifact, hashArtifact } = require("../internal/phasedArtifact");
const {
  RESOLUTION_PLAN_V2,
  RESOLUTION_PLANNER_V2,
  buildResolutionOptionsV2,
  planUboResolutionV2,
} = require("../planning/resolutionPlanV2");
const { assessCompanyPscAttributionV1 } = require("../policy/companyPscAttributionV1");
const { deriveRequirementApplicabilityV1 } = require("../policy/derivedRequirementApplicabilityV1");
const { assessEffectiveInterestQualificationV2 } = require("../policy/effectiveInterestQualificationV2");
const { assessEvidenceSufficiency, EVIDENCE_SUPPORT_DIRECTION } = require("../policy/evidencePolicy");
const { deriveGraphContextV1 } = require("../policy/graphDerivedContextV1");
const { assessLayerClosureV1, HOLDER_IDENTITY_STATE } = require("../policy/layerClosureV1");
const { assessLlpPscAttributionV1 } = require("../policy/llpPscAttributionV1");
const { assessPercentageEvidenceV1 } = require("../policy/percentageEvidenceAssessmentV1");
const { assessPersonQualificationV2, PERSON_ROUTE_STATUS } = require("../policy/personQualificationAssessmentV2");
const { determinePolicyAssessment, evaluatePolicyApplicability } = require("../policy/policyDetermination");
const { assessUboPolicyPackReadiness, UBO_POLICY_RUNTIME_MODE } = require("../policy/policyReadiness");
const { loadPolicyPack } = require("../policy/policyPack");
const { REQUIREMENT_RESOLUTION_V2, resolveRequirementsV2 } = require("../policy/requirementResolutionV2");

const PHASED_EVALUATION_VERSION = "ubo-phased-evaluation-v1";
const REQUIREMENT_RESOLUTION_COMPAT_VERSION = "ubo-requirement-resolution-v1-compat";
const PHASE_IDS = Object.freeze([
  "BASE_APPLICABILITY", "CANONICAL_GRAPH_AND_DEPTH", "CALCULATIONS_AND_ATTRIBUTIONS", "QUALIFICATION",
  "DERIVED_REQUIREMENT_APPLICABILITY", "EVIDENCE_SUFFICIENCY", "INFORMATION_NEEDS", "RESOLUTION_PLANNING", "DECISION_SNAPSHOT",
]);
const FORBIDDEN_DERIVED_FACTS = new Set(["ownership_layers", "qualifying_persons_count", "graph_depth", "final_qualifying_person_status", "layer_closure", "attribution_result", "resolution_plan"]);

function profile(entity) {
  return String(entity.entityTypeMetadata?.entityProfile || entity.entityTypeMetadata?.sourceEntityType || entity.entityTypeMetadata?.legalEntityProfile || "UNKNOWN").toUpperCase();
}
function phase(sequence, algorithmVersion, previous, output, evaluationTime, signoffs = [], marker = "REVIEW_ONLY") {
  return createPhaseArtifact({
    sequence,
    phaseId: PHASE_IDS[sequence - 1],
    algorithmVersion,
    inputArtifacts: previous ? [{ artifactId: previous.outputArtifactId, artifactHash: previous.outputHash }] : [],
    output,
    evaluationTime,
    requiredSignoffIds: signoffs,
    marker,
  });
}
function claimSupport(caseState) {
  return caseState.candidateClaims.map(({ claimId, evidenceReferences = [] }) => ({ claimId, evidenceReferences: cloneData(evidenceReferences) }));
}
function naturalPeople(caseState) {
  return caseState.canonicalEntities.filter(({ category }) => category === CANONICAL_ENTITY_CATEGORY.NATURAL_PERSON);
}
function targetEntity(caseState, id) { return caseState.canonicalEntities.find(({ entityId }) => entityId === id); }
function contextsForEvidence(loaded, caseContext, facts, answers) {
  return {
    case: { ...cloneData(caseContext), entity_profile: loaded.policyPack.entityProfiles[caseContext.entityType]?.profile }, facts: cloneData(facts), answers: cloneData(answers),
    params: Object.fromEntries(Object.entries(loaded.policyPack.parameters).map(([key, item]) => [key, cloneData(item.value)])),
  };
}
function closureHolding(relationship, target, caseState) {
  const targetProfile = profile(target);
  const interestBasis = relationship.dimension === GRAPH_DIMENSION.VOTING ? "VOTING_RIGHTS"
    : targetProfile === "LLP" ? "LLP_SURPLUS_ASSET_RIGHTS" : "COMPANY_SHARE_OWNERSHIP";
  const claims = relationship.supportingClaimIds.map((id) => caseState.candidateClaims.find(({ claimId }) => claimId === id)).filter(Boolean);
  return {
    relationshipId: relationship.relationshipId,
    holderEntityId: relationship.subjectEntityId,
    targetEntityId: relationship.objectEntityId,
    holderIdentityState: HOLDER_IDENTITY_STATE.IDENTIFIED,
    targetEntityProfile: targetProfile,
    dimension: relationship.dimension,
    interestBasis,
    denominatorRef: relationship.qualifiers?.denominatorRef || `UNESTABLISHED:${relationship.objectEntityId}:${relationship.dimension}`,
    targetRightId: relationship.relationshipId,
    measurement: cloneData(relationship.measurement || { type: PERCENTAGE_VALUE_TYPE.UNKNOWN, reason: "SOURCE_PERCENTAGE_NOT_ESTABLISHED" }),
    temporalState: relationship.temporalState,
    operativeClaimReferences: [...relationship.supportingClaimIds],
    evidenceReferences: claims.flatMap(({ evidenceReferences = [] }) => evidenceReferences),
  };
}
function deriveClosures({ loaded, caseState, graph, evaluationTime }) {
  const entities = new Map(caseState.canonicalEntities.map((entity) => [entity.entityId, entity]));
  const groups = new Map();
  graph.relationships.filter(({ dimension }) => dimension !== null).forEach((relationship) => {
    const target = entities.get(relationship.objectEntityId);
    if (!target || target.category !== CANONICAL_ENTITY_CATEGORY.LEGAL_ENTITY || !["COMPANY", "LLP"].includes(profile(target))) return;
    const key = `${target.entityId}|${relationship.dimension}`;
    if (!groups.has(key)) groups.set(key, { target, dimension: relationship.dimension, relationships: [] });
    groups.get(key).relationships.push(relationship);
  });
  return [...groups.values()].map(({ target, dimension, relationships }) => assessLayerClosureV1({
    policyPack: loaded,
    targetEntity: target,
    dimension,
    directHoldings: relationships.map((relationship) => closureHolding(relationship, target, caseState)),
    denominatorContext: { state: "UNKNOWN", references: [] },
    shareClassContext: { state: "UNKNOWN", references: [] },
    conflictContext: { state: "NONE", references: [] },
    jointArrangementContext: relationships.some(({ qualifiers = {} }) => qualifiers.actingJointly === true || qualifiers.jointArrangement === true)
      ? { state: "POSITIVE_SIGNAL", material: true, references: relationships.map(({ relationshipId }) => relationshipId) }
      : { state: "NO_RELEVANT_SIGNAL", material: false, references: [] },
    evaluationTime,
    caseRevision: { caseId: caseState.caseId, revisionId: caseState.revisionId, revision: caseState.revision },
    graphVersion: graph.graphVersion,
  })).sort((a, b) => a.assessmentId.localeCompare(b.assessmentId));
}
function compatPolicyAssessment({ loaded, caseContext, caseState, graph, calculations, facts, answers, applicability, personAssessments }) {
  const assessment = cloneData(determinePolicyAssessment({ loadedPolicyPack: loaded, caseContext, caseState, graph, calculations, facts, answers }));
  assessment.requirementAssessments.forEach((item) => {
    const derived = applicability.requirements[item.requirementId];
    if (derived) {
      item.applicability = derived.applicable ? APPLICABILITY_RESULT.APPLIES : APPLICABILITY_RESULT.DOES_NOT_APPLY;
      item.reason = { code: derived.reasonCode, compatibilityOverride: true };
    }
  });
  assessment.qualifyingPersons = personAssessments.filter(({ routeStatus }) => routeStatus === PERSON_ROUTE_STATUS.ROUTE_SATISFIED).map((person) => ({
    entityId: person.personEntityId,
    roles: [...new Set(person.basisRecords.filter(({ assessmentState, classification }) => assessmentState === "SATISFIED" && classification === "STATUTORY").map(({ route }) => route))].sort(),
    bases: person.satisfiedBasisIds.map((basisId) => ({ basisId })),
  }));
  return assessment;
}

function evaluateUboDecisionV3Review(input) {
  assertAllowedKeys(input, ["policyPack", "runtimeMode", "caseState", "caseContext", "evaluationTime", "checkpoint", "checkpointReference", "predecessorSnapshot", "supersessionReason", "facts", "answers", "evidenceClassifications", "percentageEvidenceInputs", "relevantConflicts", "operationContexts", "priorInformationNeedRecords", "resolutionAttempts", "resolutionOptions", "registryCapabilityProfile", "predecessorResolutionPlan", "existingSystemResolutionContext", "resolutionPlan", "recordingMetadata"], "evaluationInput");
  assertDataOnly(input, "evaluationInput");
  if (input.runtimeMode !== UBO_POLICY_RUNTIME_MODE.LAB) fail("successor evaluation is restricted to explicit LAB mode");
  if (!input.evaluationTime || Number.isNaN(Date.parse(input.evaluationTime))) fail("successor evaluation requires deterministic evaluationTime");
  validateOwnershipCase(input.caseState);
  if (!Object.isFrozen(input.caseState)) fail("successor evaluation requires an existing sealed OwnershipCase revision");
  Object.keys(input.facts || {}).forEach((key) => { if (FORBIDDEN_DERIVED_FACTS.has(key)) fail(`caller-derived fact ${key} is prohibited`); });
  if (input.resolutionPlan !== undefined) fail("caller-supplied ResolutionPlan is prohibited");
  const readiness = assessUboPolicyPackReadiness({ policyPack: input.policyPack, runtimeMode: input.runtimeMode, evaluationTime: input.evaluationTime });
  const loaded = loadPolicyPack(input.policyPack);
  if (loaded.identity.schemaVersion !== "1.3" || readiness.readiness !== "REVIEW_ONLY") fail("Wave 7 requires a schema-1.3 review-only Policy Pack");
  const targetId = input.caseContext?.subjectEntityId;
  const target = targetEntity(input.caseState, targetId);
  if (!target) fail("caseContext.subjectEntityId must identify the regulated target");
  const phases = [];
  const baseApplicability = evaluatePolicyApplicability(loaded.policyPack, input.caseContext);
  phases.push(phase(1, "ubo-policy-readiness-v1", null, { targetEntity: cloneData(target), caseContext: cloneData(input.caseContext), basePolicyApplicability: baseApplicability, policyReadiness: readiness }, input.evaluationTime, readiness.unresolvedSignoffs.map(({ signoffId }) => signoffId)));
  const graph = buildCanonicalOwnershipGraph(input.caseState);
  const graphContext = deriveGraphContextV1({ caseState: input.caseState, graph, targetEntityId: targetId });
  phases.push(phase(2, "ubo-graph-derived-context-v1", phases.at(-1), { graph: cloneData(graph), graphDerivedContext: graphContext, claimSupport: claimSupport(input.caseState) }, input.evaluationTime));

  const calculations = [];
  naturalPeople(input.caseState).forEach((person) => Object.values(GRAPH_DIMENSION).forEach((dimension) => {
    const calculation = calculateEffectivePercentage(graph, { subjectEntityId: person.entityId, targetEntityId: targetId, dimension });
    if (calculation.status !== CALCULATION_STATUS.NO_PATH) calculations.push(calculation);
  }));
  calculations.sort((a, b) => `${a.subjectEntityId}|${a.dimension}`.localeCompare(`${b.subjectEntityId}|${b.dimension}`));
  const effectiveAssessments = calculations.map((calculation) => assessEffectiveInterestQualificationV2({ policyPack: loaded, calculationResult: calculation, holderEntity: targetEntity(input.caseState, calculation.subjectEntityId), targetEntityId: targetId, caseRevision: { caseId: input.caseState.caseId, revisionId: input.caseState.revisionId, revision: input.caseState.revision }, graphVersion: graph.graphVersion }));
  const caseRevision = { caseId: input.caseState.caseId, revisionId: input.caseState.revisionId, revision: input.caseState.revision };
  const companyAssessments = profile(target) === "COMPANY" ? [assessCompanyPscAttributionV1({ policyPack: loaded, ownershipGraph: graph, canonicalEntities: input.caseState.canonicalEntities, claimSupport: claimSupport(input.caseState), targetEntityId: targetId, caseRevision })] : [];
  const llpAssessments = (profile(target) === "LLP" || graphContext.hasLlpProfile) ? [assessLlpPscAttributionV1({ policyPack: loaded, ownershipGraph: graph, canonicalEntities: input.caseState.canonicalEntities, claimSupport: claimSupport(input.caseState), targetEntityId: targetId, caseRevision, compositionMode: "SUCCESSOR_REVIEW_ONLY" })] : [];
  const closures = deriveClosures({ loaded, caseState: input.caseState, graph, evaluationTime: input.evaluationTime });
  const percentageEvidence = (input.percentageEvidenceInputs || []).map((item) => assessPercentageEvidenceV1({ policyPack: loaded, ...item, evaluationTime: input.evaluationTime }));
  phases.push(phase(3, "ubo-calculations-and-attributions-v1", phases.at(-1), { calculations, effectiveAssessments, companyAssessments, llpAssessments, layerClosureAssessments: closures, percentageEvidenceAssessments: percentageEvidence }, input.evaluationTime, [...companyAssessments, ...llpAssessments, ...closures, ...percentageEvidence].flatMap((item) => item.governance?.requiredSignoffIds || item.requiredSignoffIds || [])));

  const bases = [...effectiveAssessments, ...companyAssessments, ...llpAssessments].flatMap(({ basisRecords = [] }) => basisRecords);
  const implicated = new Set([...calculations.map(({ subjectEntityId }) => subjectEntityId), ...bases.map(({ personEntityId }) => personEntityId)]);
  const relevantControlObjects = new Set([targetId, ...graphContext.intermediateLegalEntityIds]);
  graph.relationships.filter((relationship) => relevantControlObjects.has(relationship.objectEntityId) && [RELATIONSHIP_TYPE.BOARD_APPOINTMENT_RIGHT, RELATIONSHIP_TYPE.BOARD_REMOVAL_RIGHT, RELATIONSHIP_TYPE.FORMAL_CONTROL_RIGHT, RELATIONSHIP_TYPE.SIGNIFICANT_INFLUENCE_OR_CONTROL].includes(relationship.relationshipType))
    .forEach(({ subjectEntityId }) => { if (targetEntity(input.caseState, subjectEntityId)?.category === CANONICAL_ENTITY_CATEGORY.NATURAL_PERSON) implicated.add(subjectEntityId); });
  const personAssessments = [...implicated].sort().map((personEntityId) => assessPersonQualificationV2({ personEntityId, targetEntityId: targetId, basisRecords: bases, explicitlyMaterialRoutes: ["MANAGEMENT_CONTROL"] }));
  phases.push(phase(4, "ubo-person-qualification-assessment-v2", phases.at(-1), { qualificationBasisRecords: bases, personQualificationAssessments: personAssessments }, input.evaluationTime, personAssessments.flatMap(({ governance }) => governance.requiredSignoffIds)));

  const applicability = deriveRequirementApplicabilityV1({ graphContext, personAssessments, attributionAvailable: companyAssessments.length + llpAssessments.length > 0, closureAvailable: closures.length > 0 });
  phases.push(phase(5, "ubo-derived-requirement-applicability-v1", phases.at(-1), applicability, input.evaluationTime));
  const derivedFacts = { ...(input.facts || {}), ownership_layers: applicability.facts.ownershipLayers, qualifying_persons_count: applicability.facts.statutoryRouteSatisfiedPersonCount };
  const evidenceSufficiency = loaded.policyPack.requirements.map(({ requirementId }) => assessEvidenceSufficiency({ loadedPolicyPack: loaded, caseState: input.caseState, requirementId, classifications: input.evidenceClassifications || [], conditionContext: contextsForEvidence(loaded, input.caseContext, derivedFacts, input.answers || {}), evaluationDate: input.evaluationTime, riskLevel: input.caseContext.riskLevel || "MEDIUM", direction: EVIDENCE_SUPPORT_DIRECTION.POSITIVE })).sort((a, b) => a.requirementId.localeCompare(b.requirementId));
  phases.push(phase(6, "ubo-evidence-sufficiency-v1-compat", phases.at(-1), { evidenceSufficiency, percentageEvidenceDiagnostics: percentageEvidence, closureDiagnostics: closures, a03OperationalSufficiency: percentageEvidence.some(({ operationalSufficiency }) => operationalSufficiency === "REQUIRES_POLICY_SIGNOFF") ? "REQUIRES_POLICY_SIGNOFF" : "NOT_ASSESSED" }, input.evaluationTime, percentageEvidence.flatMap(({ requiredSignoffIds = [] }) => requiredSignoffIds), "TRANSITIONAL_REVIEW_ONLY"));

  const policyAssessment = compatPolicyAssessment({ loaded, caseContext: input.caseContext, caseState: input.caseState, graph, calculations, facts: derivedFacts, answers: input.answers || {}, applicability, personAssessments });
  const requirementResolution = resolveRequirementsV2({
    loadedPolicyPack: loaded,
    caseContext: input.caseContext,
    caseState: input.caseState,
    targetEntityId: targetId,
    graph,
    graphContext,
    calculations,
    llpAssessments,
    closures,
    percentageEvidence,
    personAssessments,
    applicability,
    evidenceSufficiency,
    policyAssessment,
    facts: derivedFacts,
    answers: input.answers || {},
    relevantConflicts: input.relevantConflicts || [],
    operationContexts: input.operationContexts || [],
    priorInformationNeedRecords: input.priorInformationNeedRecords || [],
    supersessionReason: input.supersessionReason || null,
    phaseArtifacts: phases,
  });
  const requirementStage = {
    requirementStageVersion: REQUIREMENT_RESOLUTION_V2,
    pipelineMaturity: "TRANSITIONAL_PLANNER_ONLY",
    policyAssessment,
    requirementResolution,
    derivedApplicabilityApplied: { "UBO-R02": applicability.requirements["UBO-R02"], "UBO-R03": applicability.requirements["UBO-R03"], "UBO-R07": applicability.requirements["UBO-R07"] },
  };
  phases.push(phase(7, REQUIREMENT_RESOLUTION_V2, phases.at(-1), requirementStage, input.evaluationTime, requirementResolution.requirementResolutions.flatMap(({ requiredSignoffIds }) => requiredSignoffIds), "TRANSITIONAL_PLANNER_ONLY"));
  const resolutionOptionsV2 = buildResolutionOptionsV2({
    informationNeeds: requirementResolution.informationNeeds,
    defaultCapabilityScope: {
      jurisdiction: String(input.caseContext.jurisdiction || "ANY").toUpperCase(),
      entityProfile: profile(target),
      entitlementContext: input.registryCapabilityProfile?.entitlementContext?.contextId || "ANY",
    },
    existingSystemResolutionContext: input.existingSystemResolutionContext || {},
    additionalOptions: input.resolutionOptions || [],
  });
  const plan = planUboResolutionV2({
    policyPack: loaded,
    requirementResolution,
    informationNeedSet: requirementResolution.informationNeedSet,
    operationalBlockers: requirementResolution.operationalBlockers,
    reviewRequirements: requirementResolution.reviewRequirements,
    specialistRoutes: requirementResolution.specialistRoutes,
    resolutionOptions: resolutionOptionsV2,
    resolutionAttempts: input.resolutionAttempts || [],
    ...(input.registryCapabilityProfile ? { registryCapabilityProfile: input.registryCapabilityProfile } : {}),
    ...(input.predecessorResolutionPlan ? { predecessorResolutionPlan: input.predecessorResolutionPlan } : {}),
    existingSystemResolutionContext: input.existingSystemResolutionContext || {},
    evaluationTime: input.evaluationTime,
    caseRevision,
    graphFingerprint: hashArtifact(graph),
    defaultCapabilityScope: {
      jurisdiction: String(input.caseContext.jurisdiction || "ANY").toUpperCase(),
      entityProfile: profile(target),
      entitlementContext: input.registryCapabilityProfile?.entitlementContext?.contextId || "ANY",
    },
  });
  phases.push(phase(8, RESOLUTION_PLAN_V2, phases.at(-1), {
    planId: plan.planId,
    planHash: plan.planHash,
    plannerVersion: plan.plannerVersion,
    registryCapabilityProfileRef: plan.registryCapabilityProfileRef,
    usedCapabilityEntryIds: plan.usedCapabilityEntryIds,
    strategyAssignments: plan.strategyAssignments,
    predecessorPlan: plan.predecessorPlan,
    plan,
  }, input.evaluationTime, plan.requiredSignoffs, "SUCCESSOR_PLANNER_COMPLETE_REVIEW_ONLY"));
  const algorithmManifest = {
    graph: "ubo-graph-v1",
    ...(calculations.length ? { percentageLookthrough: "ubo-percentage-lookthrough-v1", effectiveInterestQualification: "ubo-effective-interest-qualification-v2" } : {}),
    ...(companyAssessments.length ? { companyAttribution: "ubo-psc-attribution-v1" } : {}),
    ...(llpAssessments.length ? { llpAttribution: "ubo-llp-psc-attribution-v1", llpWorkingAssumption: "A-06-WA-01" } : {}),
    ...(closures.length ? { layerClosure: "ubo-layer-closure-v1", percentagePrecision: "ubo-percentage-precision-v1" } : {}),
    ...(percentageEvidence.length ? { percentageEvidence: "ubo-percentage-evidence-v1" } : {}),
    personQualification: "ubo-person-qualification-assessment-v2",
    derivedRequirementApplicability: "ubo-derived-requirement-applicability-v1",
    informationNeed: "ubo-information-need-v2",
    dependentDiagnostic: "ubo-need-dependent-diagnostic-v1",
    requirementResolution: REQUIREMENT_RESOLUTION_V2,
    registryCapabilityProfile: input.registryCapabilityProfile?.contractVersion || "NOT_PROVIDED",
    resolutionPlanner: RESOLUTION_PLANNER_V2,
    resolutionPlan: RESOLUTION_PLAN_V2,
    phasedEvaluation: PHASED_EVALUATION_VERSION,
    snapshotConstruction: "ubo-decision-snapshot-construction-v2",
  };
  const signoffs = [...new Set([...(readiness.unresolvedSignoffs || []).map(({ signoffId }) => signoffId), ...phases.flatMap(({ requiredSignoffIds }) => requiredSignoffIds)])].sort();
  const snapshot = createDecisionSnapshotV2({ loadedPolicyPack: loaded, caseState: input.caseState, targetEntityId: targetId, checkpoint: input.checkpoint, checkpointReference: input.checkpointReference, evaluationTime: input.evaluationTime, readiness, algorithmManifest, phaseArtifacts: phases, pinnedPlan: plan, previousSnapshot: input.predecessorSnapshot || null, supersessionReason: input.supersessionReason || null, decisionOutputs: { graphDerivedContext: graphContext, effectiveInterestCalculations: calculations, qualificationBasisRecords: bases, companyAttributionAssessments: companyAssessments, llpAttributionAssessments: llpAssessments, layerClosureAssessments: closures, percentageEvidenceAssessments: percentageEvidence, personQualificationAssessments: personAssessments, derivedRequirementApplicability: applicability, evidenceSufficiency, requirementStageVersion: REQUIREMENT_RESOLUTION_V2, causalInformationNeedSetV2: requirementResolution.informationNeedSet, informationNeedsV2: requirementResolution.informationNeeds, dependentDiagnostics: requirementResolution.dependentDiagnostics, requirementResolutions: requirementResolution.requirementResolutions, resolutionOptionsV2, informationNeedsV1Compatibility: [], informationNeedHistoryV1Compatibility: [], resolutionOptionsV1Compatibility: [], actionIntentsV1Compatibility: [], policyGaps: [], operationalBlockers: requirementResolution.operationalBlockers, reviewRequirements: requirementResolution.reviewRequirements, specialistRoutes: requirementResolution.specialistRoutes, specialistStates: { terminal: { orchestrationState: plan.state === "COMPLETE" ? "TERMINAL" : "IN_PROGRESS" }, reviewRequired: requirementResolution.reviewRequirements.length > 0, specialistRequired: requirementResolution.specialistRoutes.length > 0 }, requiredSignoffIds: signoffs }, recordingMetadata: input.recordingMetadata || {} });
  return deepFreeze(cloneData({ evaluationAlgorithmVersion: PHASED_EVALUATION_VERSION, futureApplicationBoundary: { contractVersion: "ubo-decision-application-v3", exposure: "REVIEW_ENTRY_ONLY_WAVE_10" }, phaseOrder: PHASE_IDS, phaseArtifacts: snapshot.decisionContent.phaseArtifacts, graph, calculations, effectiveAssessments, companyAssessments, llpAssessments, layerClosureAssessments: closures, percentageEvidenceAssessments: percentageEvidence, personQualificationAssessments: personAssessments, derivedRequirementApplicability: applicability, evidenceSufficiency, requirementStage, resolutionOptionsV2, registryCapabilityProfile: input.registryCapabilityProfile || null, resolutionPlan: snapshot.decisionContent.pinnedResolutionPlan, snapshot }));
}

module.exports = { PHASED_EVALUATION_VERSION, PHASE_IDS, REQUIREMENT_RESOLUTION_COMPAT_VERSION, evaluateUboDecisionV3Review };
