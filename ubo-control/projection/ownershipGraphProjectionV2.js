"use strict";

const { verifyDecisionSnapshotV2 } = require("../domain/decisionSnapshotV2");
const { INFORMATION_NEED_V2_STATE } = require("../domain/informationNeedV2");
const { cloneData, deepFreeze, fail } = require("../internal/validation");
const { hashArtifact } = require("../internal/phasedArtifact");

const OWNERSHIP_GRAPH_PROJECTION_V2 = "ubo-ownership-graph-projection-v2";

function unique(values) { return [...new Set((values || []).filter(Boolean))].sort(); }
function qualifiedAssessment(content, entityId) {
  return content.personQualificationAssessments.find(({ personEntityId }) => personEntityId === entityId);
}

function projectOwnershipGraphV2({ decisionSnapshot }) {
  verifyDecisionSnapshotV2(decisionSnapshot);
  const content = decisionSnapshot.decisionContent;
  if (content.requirementStageVersion !== "ubo-requirement-resolution-v2") fail("OwnershipGraphProjection v2 requires a Wave 8 DecisionSnapshot v2");
  const graph = content.phaseArtifacts[1].output.graph;
  const needs = content.informationNeedsV2.filter(({ status }) => status === INFORMATION_NEED_V2_STATE.OPEN);
  const frontierIds = new Set(needs.map(({ frontierEntityId }) => frontierEntityId).filter(Boolean));
  const reviewEntityIds = new Set(content.reviewRequirements.flatMap(({ entityIds = [], personIds = [] }) => [...entityIds, ...personIds]));
  const specialistEntityIds = new Set(content.specialistRoutes.flatMap(({ entityIds = [] }) => entityIds));
  const identityNeedIds = new Set(needs.filter(({ concept }) => ["IDENTITY_AGGREGATION", "QUALIFYING_PERSON_ATTRIBUTES", "ENTITY_EXISTENCE"].includes(concept))
    .flatMap((need) => [need.targetReference.entityId, need.targetReference.personEntityId, need.frontierEntityId]).filter(Boolean));
  const nodes = graph.nodes.map((node) => {
    const assessment = qualifiedAssessment(content, node.entityId);
    const flags = [];
    if (node.entityId === content.targetEntityId) flags.push("SUBJECT");
    if (assessment?.routeStatus === "ROUTE_SATISFIED") flags.push("QUALIFYING_PERSON");
    if (assessment?.firmPolicySatisfiedBasisIds?.length > 0) flags.push("FIRM_POLICY_PERSON");
    if (node.category === "NATURAL_PERSON" && assessment?.routeStatus !== "ROUTE_SATISFIED") flags.push("NOT_CONFIRMED_UBO");
    if (frontierIds.has(node.entityId)) flags.push("FRONTIER_ENTITY");
    if (specialistEntityIds.has(node.entityId) || node.category === "TRUST_OR_LEGAL_ARRANGEMENT") flags.push("SPECIAL_STRUCTURE");
    if (reviewEntityIds.has(node.entityId)) flags.push("REVIEW_REQUIRED");
    if (identityNeedIds.has(node.entityId)) flags.push("IDENTITY_UNRESOLVED");
    return { ...cloneData(node), semanticFlags: unique(flags), qualificationAssessment: assessment ? cloneData(assessment) : null };
  }).sort((a, b) => a.entityId.localeCompare(b.entityId));
  const needByRelationship = new Map();
  needs.forEach((need) => need.affected.relationshipIds.forEach((id) => {
    if (!needByRelationship.has(id)) needByRelationship.set(id, []);
    needByRelationship.get(id).push(need.needId);
  }));
  const reviewedRelationshipIds = new Set(content.reviewRequirements.flatMap(({ relationshipIds = [] }) => relationshipIds));
  const claimSupportById = new Map((content.phaseArtifacts[1].output.claimSupport || []).map((item) => [item.claimId, item]));
  const relationships = graph.relationships.map((relationship) => {
    const evidenceReferences = relationship.supportingClaimIds.flatMap((claimId) => claimSupportById.get(claimId)?.evidenceReferences || []);
    return {
      ...cloneData(relationship),
      support: { claimIds: cloneData(relationship.supportingClaimIds), claimCount: relationship.supportingClaimIds.length, evidenceReferences: cloneData(evidenceReferences) },
      evidenceStatus: reviewedRelationshipIds.has(relationship.relationshipId) ? "REVIEW_REQUIRED" : "UNKNOWN",
      resolutionStatus: relationship.temporalState === "CURRENT" ? "CURRENT" : relationship.temporalState,
      causalInformationNeedIds: unique(needByRelationship.get(relationship.relationshipId)),
    };
  }).sort((a, b) => a.relationshipId.localeCompare(b.relationshipId));
  const knownNodeIds = new Set(nodes.map(({ entityId }) => entityId));
  const knownRelationshipIds = new Set(relationships.map(({ relationshipId }) => relationshipId));
  needs.forEach((need) => {
    const targetIds = [need.targetReference.entityId, need.targetReference.personEntityId, need.frontierEntityId].filter(Boolean);
    if (targetIds.some((id) => !knownNodeIds.has(id))) fail("OwnershipGraphProjection v2 need references an unknown entity");
    if (need.relationshipId && !knownRelationshipIds.has(need.relationshipId)) fail("OwnershipGraphProjection v2 need references an unknown relationship");
  });
  const affectedCalculationIds = unique(needs.flatMap(({ affected }) => affected.calculationIds));
  const affectedPathIds = unique(needs.flatMap(({ affected }) => affected.pathIds));
  const currentWave = content.pinnedResolutionPlan.currentPlanningWave;
  const currentActions = content.pinnedResolutionPlan.recommendedActions;
  const actorCount = (actor) => currentWave.actor === actor ? currentActions.length : 0;
  const semantic = {
    contractVersion: OWNERSHIP_GRAPH_PROJECTION_V2,
    snapshotReference: { snapshotId: decisionSnapshot.snapshotId, snapshotHash: decisionSnapshot.decisionContentHash },
    policyIdentity: cloneData(content.policy.identity),
    algorithmIdentity: cloneData(content.algorithmManifest),
    subjectEntityId: content.targetEntityId,
    nodes,
    relationships,
    calculations: cloneData(content.effectiveInterestCalculations),
    qualificationBasisRecords: cloneData(content.qualificationBasisRecords),
    personQualificationAssessments: cloneData(content.personQualificationAssessments),
    companyAttributionAssessments: cloneData(content.companyAttributionAssessments),
    llpAttributionAssessments: cloneData(content.llpAttributionAssessments),
    layerClosureAssessments: cloneData(content.layerClosureAssessments),
    percentageEvidenceAssessments: cloneData(content.percentageEvidenceAssessments),
    informationNeeds: cloneData(needs),
    affectedDiagnostics: cloneData(content.dependentDiagnostics),
    operationalBlockers: cloneData(content.operationalBlockers),
    reviewRequirements: cloneData(content.reviewRequirements),
    specialistRoutes: cloneData(content.specialistRoutes),
    pinnedCompatibilityPlan: { planId: content.pinnedResolutionPlan.planId, planHash: content.pinnedResolutionPlan.planHash },
    summary: {
      openCausalNeedCount: needs.length,
      affectedCalculationCount: affectedCalculationIds.length,
      affectedPathCount: affectedPathIds.length,
      operationalBlockerCount: content.operationalBlockers.length,
      reviewRequirementCount: content.reviewRequirements.length,
      specialistRouteCount: content.specialistRoutes.length,
      currentSystemActionCount: actorCount("SYSTEM"),
      currentCustomerActionCount: actorCount("CUSTOMER"),
      currentInternalActionCount: actorCount("INTERNAL"),
      currentSpecialistActionCount: actorCount("SPECIALIST"),
    },
    governanceState: "REVIEW_ONLY",
    productionAuthorized: false,
    publicExposure: "REVIEW_ENTRY_ONLY_WAVE_10",
  };
  const projectionHash = hashArtifact(semantic);
  return deepFreeze(cloneData({ ...semantic, projectionId: `${OWNERSHIP_GRAPH_PROJECTION_V2}:${projectionHash.slice(7, 39)}`, projectionHash }));
}

module.exports = { OWNERSHIP_GRAPH_PROJECTION_V2, projectOwnershipGraphV2 };
