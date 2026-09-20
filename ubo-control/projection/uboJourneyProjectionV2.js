"use strict";

const { createHash } = require("node:crypto");
const {
  UBO_JOURNEY_PROJECTION_ERROR_CODE,
  UboJourneyProjectionError,
} = require("../errors");
const { verifyDecisionSnapshotV2, DECISION_SNAPSHOT_V2 } = require("../domain/decisionSnapshotV2");
const { validateResolutionPlanV2 } = require("../planning/resolutionPlanV2");
const { assertAllowedKeys, assertDataOnly, assertPlainObject, cloneData, deepFreeze } = require("../internal/validation");
const { canonicalizeJson } = require("../policy/canonicalJson");
const { loadPolicyPack } = require("../policy/policyPack");

const JOURNEY_PROJECTION_V2 = "ubo-journey-projection-v2";
const CUSTOMER_WORK_BUNDLE_V2 = "ubo-customer-work-bundle-v2";
const EXTERNAL_EVIDENCE_HANDOFF_V1 = "ubo-external-evidence-handoff-v1";
const CUSTOMER_WORK_DELEGATION_V1 = "ubo-customer-work-delegation-v1";

const CUSTOMER_WORK_STATE_V2 = Object.freeze({
  CUSTOMER_INPUT_REQUIRED: "CUSTOMER_INPUT_REQUIRED",
  CUSTOMER_INPUT_COMPLETE: "CUSTOMER_INPUT_COMPLETE",
  INTERNAL_REVIEW_REQUIRED: "INTERNAL_REVIEW_REQUIRED",
  SPECIALIST_REVIEW_REQUIRED: "SPECIALIST_REVIEW_REQUIRED",
  SYSTEM_RESOLUTION: "SYSTEM_RESOLUTION",
  BLOCKED: "BLOCKED",
  COMPLETE: "COMPLETE",
});

const CUSTOMER_ACTION_TYPE_V2 = Object.freeze({
  CONFIRM_ESTABLISHED_INFORMATION: "CONFIRM_ESTABLISHED_INFORMATION",
  CORRECTION_REQUIRED: "CORRECTION_REQUIRED",
  SUBMIT_STRUCTURED_RELATIONSHIP: "SUBMIT_STRUCTURED_RELATIONSHIP",
  SUBMIT_ENTITY_ATTRIBUTES: "SUBMIT_ENTITY_ATTRIBUTES",
  REQUEST_EXTERNAL_EVIDENCE: "REQUEST_EXTERNAL_EVIDENCE",
  DELEGATE_CUSTOMER_WORK: "DELEGATE_CUSTOMER_WORK",
});

const SUBMISSION_CONTRACT = Object.freeze({
  CONFIRMATION: "ubo-established-information-confirmation-v1",
  CORRECTION: "ubo-established-information-change-v1",
  SHARE_OWNERSHIP: "ubo-structured-share-ownership-submission-v1",
  ENTITY_ATTRIBUTES: "ubo-structured-entity-attributes-submission-v1",
  EXTERNAL_EVIDENCE: "ubo-external-evidence-request-v1",
  DELEGATION: CUSTOMER_WORK_DELEGATION_V1,
});

function projectionError(code, message, cause) {
  return new UboJourneyProjectionError(message, { code, cause });
}

function clone(value) { return cloneData(value); }
function unique(values) { return [...new Set((values || []).filter(Boolean))].sort(); }
function sortById(values, field) { return [...values].map(clone).sort((a, b) => String(a[field]).localeCompare(String(b[field]))); }
function stableId(prefix, value) {
  const hash = createHash("sha256").update(canonicalizeJson(value), "utf8").digest("hex").slice(0, 32);
  return `${prefix}:${hash}`;
}

function graphFrom(content) {
  const graph = content.phaseArtifacts?.find(({ phaseId }) => phaseId === "CANONICAL_GRAPH_AND_DEPTH")?.output?.graph;
  if (!graph) throw new TypeError("DecisionSnapshot v2 does not contain its recorded canonical graph");
  return graph;
}

function signoffRegister(policyPack, snapshotPolicyIdentity) {
  const loaded = loadPolicyPack(policyPack);
  const actualIdentity = {
    policyPackId: loaded.identity.policyPackId,
    policyVersion: loaded.identity.version,
    policyHash: loaded.identity.hash,
    policySchemaVersion: loaded.identity.schemaVersion,
  };
  if (canonicalizeJson(actualIdentity) !== canonicalizeJson(snapshotPolicyIdentity)) {
    throw new TypeError("JourneyProjection v2 Policy Pack does not match the DecisionSnapshot v2 policy identity");
  }
  return new Map(loaded.policyPack.signoffs.map((signoff) => [signoff.signoffId, signoff.status]));
}

function signoffAudit(requiredSignoffs, register) {
  const dependencies = unique(requiredSignoffs).map((signoffId) => ({
    signoffId,
    status: register.get(signoffId) || "MISSING",
  }));
  return {
    dependencies,
    blocking: dependencies.filter(({ status }) => status !== "APPROVED"),
  };
}

function actionContracts(action, audit) {
  const blockedByPolicy = action.contentReadiness === "REQUIRES_POLICY_CONTENT";
  const blockedBySignoff = audit.blocking.length > 0;
  const base = { sourceResolutionActionId: action.actionId, sourceSemanticActionType: action.semanticActionType };
  const contracts = [];
  if (action.semanticActionType === "CONFIRM_ESTABLISHED_INFORMATION") {
    contracts.push({ ...base, actionType: CUSTOMER_ACTION_TYPE_V2.CONFIRM_ESTABLISHED_INFORMATION, submissionContract: SUBMISSION_CONTRACT.CONFIRMATION });
    contracts.push({ ...base, actionType: CUSTOMER_ACTION_TYPE_V2.CORRECTION_REQUIRED, submissionContract: SUBMISSION_CONTRACT.CORRECTION });
  }
  if (action.semanticActionType === "REQUEST_STRUCTURED_INFORMATION"
    && action.actionTemplateReference === "DISCLOSE_SHARE_OWNERSHIP") {
    contracts.push({ ...base, actionType: CUSTOMER_ACTION_TYPE_V2.SUBMIT_STRUCTURED_RELATIONSHIP, submissionContract: SUBMISSION_CONTRACT.SHARE_OWNERSHIP });
  }
  if (action.semanticActionType === "REQUEST_STRUCTURED_INFORMATION"
    && action.actionTemplateReference === "CAPTURE_QUALIFYING_PERSON_IDENTITY") {
    contracts.push({ ...base, actionType: CUSTOMER_ACTION_TYPE_V2.SUBMIT_ENTITY_ATTRIBUTES, submissionContract: SUBMISSION_CONTRACT.ENTITY_ATTRIBUTES });
  }
  if (["REQUEST_STRUCTURE_EVIDENCE", "REQUEST_TARGETED_EVIDENCE"].includes(action.semanticActionType)) {
    contracts.push({ ...base, actionType: CUSTOMER_ACTION_TYPE_V2.REQUEST_EXTERNAL_EVIDENCE, submissionContract: SUBMISSION_CONTRACT.EXTERNAL_EVIDENCE });
  }
  contracts.push({ ...base, actionType: CUSTOMER_ACTION_TYPE_V2.DELEGATE_CUSTOMER_WORK, submissionContract: SUBMISSION_CONTRACT.DELEGATION });
  return contracts.map((contract) => ({
    ...contract,
    signoffDependencies: clone(audit.dependencies),
    blockingSignoffs: clone(audit.blocking),
    executable: !blockedByPolicy && !blockedBySignoff,
    blockedReason: blockedByPolicy ? "POLICY_CONTENT_REQUIRED" : blockedBySignoff ? "SIGNOFF_REQUIRED" : null,
  }));
}

function knownInformation(group, graph) {
  const entityIds = unique((group.targetReferences || []).map(({ entityId }) => entityId));
  const relationshipIds = unique(group.branchRelationshipIds);
  const nodes = new Map(graph.nodes.map((node) => [node.entityId, node]));
  const relationships = new Map(graph.relationships.map((relationship) => [relationship.relationshipId, relationship]));
  return {
    entities: entityIds.map((entityId) => nodes.get(entityId)).filter(Boolean).map(clone),
    relationships: relationshipIds.map((relationshipId) => relationships.get(relationshipId)).filter(Boolean).map(clone),
  };
}

function missingInformation(bundle, needsById) {
  return bundle.informationNeedIds.map((needId) => needsById.get(needId)).filter(Boolean).map((need) => ({
    informationNeedId: need.needId,
    concept: need.concept,
    dimension: need.dimension || null,
    temporalScope: need.temporalScope,
    requiredFact: clone(need.requiredFact),
    targetReference: clone(need.targetReference),
    reasonCode: need.reasonCode,
    contentReadiness: need.contentReadinessStatus,
  }));
}

function workBundles(content, plan, graph, register) {
  const actions = new Map(plan.customerActions.map((action) => [action.actionId, action]));
  const groups = new Map(plan.resolutionGroups.map((group) => [group.groupId, group]));
  const needs = new Map(content.informationNeedsV2.map((need) => [need.needId, need]));
  return plan.customerBundles.map((sourceBundle) => {
    if (sourceBundle.actionIds.length !== 1) throw new TypeError("Customer work bundle must pin exactly one ResolutionAction v2");
    const action = actions.get(sourceBundle.actionIds[0]);
    const group = action && groups.get(action.resolutionGroupId);
    if (!action || !group) throw new TypeError("Customer work bundle references an unknown action or group");
    const audit = signoffAudit(action.requiredSignoffs, register);
    const semanticActions = actionContracts(action, audit);
    const targetEntityIds = unique((action.targetReferences || []).map(({ entityId }) => entityId));
    const frontierEntityIds = unique(action.frontierEntityIds);
    const identity = {
      sourceResolutionBundleId: sourceBundle.bundleId,
      snapshotId: content.snapshotId,
      planId: plan.planId,
      resolutionGroupId: group.groupId,
      actionIds: sourceBundle.actionIds,
    };
    const bundleId = stableId(CUSTOMER_WORK_BUNDLE_V2, identity);
    const executable = semanticActions.some((item) => item.executable);
    return {
      contractVersion: CUSTOMER_WORK_BUNDLE_V2,
      bundleId,
      sourceResolutionBundleId: sourceBundle.bundleId,
      caseReference: clone(content.caseReference),
      sourceDecisionSnapshot: { snapshotId: content.snapshotId, snapshotHash: content.snapshotHash },
      sourceResolutionPlan: { planId: plan.planId, planHash: plan.planHash },
      resolutionGroupId: group.groupId,
      actionIds: clone(sourceBundle.actionIds),
      informationNeedIds: clone(sourceBundle.informationNeedIds),
      requirementIds: clone(sourceBundle.requirementIds),
      canonicalSubject: { entityId: targetEntityIds.length === 1 ? targetEntityIds[0] : null, entityIds: targetEntityIds },
      frontierEntityIds,
      linkedRelationshipIds: unique(group.branchRelationshipIds),
      knownInformation: knownInformation(group, graph),
      missingInformation: missingInformation(sourceBundle, needs),
      permittedSemanticActions: semanticActions,
      approvedContentReferences: unique([action.actionTemplateReference]),
      contentReadiness: action.contentReadiness,
      state: executable ? "OPEN" : action.contentReadiness === "REQUIRES_POLICY_CONTENT" ? "POLICY_CONTENT_REQUIRED" : "SIGNOFF_REQUIRED",
      expectedResult: action.expectedOutcome,
      reEvaluationTrigger: action.reEvaluationTrigger,
      evidenceHandoff: ["REQUEST_STRUCTURE_EVIDENCE", "REQUEST_TARGETED_EVIDENCE"].includes(action.semanticActionType) ? {
        contractVersion: EXTERNAL_EVIDENCE_HANDOFF_V1,
        readiness: executable ? "EVIDENCE_HANDOFF_READY_EXECUTION_NOT_CONNECTED" : "BLOCKED",
        semanticEvidenceCategories: unique(action.expectedFactsOrEvidence?.map(({ type }) => type)),
        requestedConcepts: unique(action.expectedFactsOrEvidence?.map(({ type }) => type)),
      } : null,
      delegationEligibility: { eligible: executable, executionOwner: "HOST", grantsAuthorization: false },
      signoffDependencies: unique(action.requiredSignoffs),
      signoffDependencyStates: clone(audit.dependencies),
      blockingSignoffs: clone(audit.blocking),
      productionAuthorized: false,
    };
  }).sort((a, b) => a.bundleId.localeCompare(b.bundleId));
}

function workState(plan, bundles) {
  const executableBundles = bundles.filter((bundle) => bundle.permittedSemanticActions.some(({ executable }) => executable));
  if (plan.state === "SYSTEM_RESOLUTION") return CUSTOMER_WORK_STATE_V2.SYSTEM_RESOLUTION;
  if (plan.state === "SPECIALIST_REVIEW") return CUSTOMER_WORK_STATE_V2.SPECIALIST_REVIEW_REQUIRED;
  if (plan.state === "INTERNAL_REVIEW") return CUSTOMER_WORK_STATE_V2.INTERNAL_REVIEW_REQUIRED;
  if (plan.state === "BLOCKED") return CUSTOMER_WORK_STATE_V2.BLOCKED;
  if (plan.state === "COMPLETE") return CUSTOMER_WORK_STATE_V2.COMPLETE;
  if (plan.state === "CUSTOMER_RESOLUTION" && executableBundles.length > 0) return CUSTOMER_WORK_STATE_V2.CUSTOMER_INPUT_REQUIRED;
  if (plan.state === "CUSTOMER_RESOLUTION") return CUSTOMER_WORK_STATE_V2.BLOCKED;
  return CUSTOMER_WORK_STATE_V2.CUSTOMER_INPUT_COMPLETE;
}

function projectUboJourneyV2(input) {
  try {
    assertPlainObject(input, "journeyProjectionV2Input");
    assertAllowedKeys(input, ["contractVersion", "decisionSnapshot", "policyPack"], "journeyProjectionV2Input");
    if (input.contractVersion !== undefined && input.contractVersion !== JOURNEY_PROJECTION_V2) {
      throw projectionError(UBO_JOURNEY_PROJECTION_ERROR_CODE.UNSUPPORTED_CONTRACT_VERSION, `contractVersion must be ${JOURNEY_PROJECTION_V2}`);
    }
    const snapshot = input.decisionSnapshot;
    if (!snapshot || snapshot.snapshotSchemaVersion !== DECISION_SNAPSHOT_V2) {
      throw projectionError(UBO_JOURNEY_PROJECTION_ERROR_CODE.UNSUPPORTED_DECISION_SNAPSHOT_SCHEMA, "JourneyProjection v2 requires DecisionSnapshot v2");
    }
    verifyDecisionSnapshotV2(snapshot);
    const content = snapshot.decisionContent;
    const register = signoffRegister(input.policyPack, content.policy.identity);
    const plan = content.pinnedResolutionPlan;
    validateResolutionPlanV2(plan);
    const graph = graphFrom(content);
    const contentForBundles = { ...content, snapshotId: snapshot.snapshotId, snapshotHash: snapshot.decisionContentHash };
    const customerWorkBundles = workBundles(contentForBundles, plan, graph, register);
    const state = workState(plan, customerWorkBundles);
    const executableBundles = customerWorkBundles.filter((bundle) => bundle.permittedSemanticActions.some(({ executable }) => executable));
    const economicRelationships = graph.relationships.filter(({ dimension, temporalState }) => dimension === "ECONOMIC" && temporalState === "CURRENT");
    const qualifyingPeople = content.personQualificationAssessments
      .filter(({ routeStatus }) => routeStatus === "ROUTE_SATISFIED")
      .map(({ personEntityId, routeStatus, satisfiedBasisIds, statutoryBasisIds }) => ({
        personEntityId,
        routeStatus,
        satisfiedBasisIds: clone(satisfiedBasisIds),
        statutoryBasisIds: clone(statutoryBasisIds),
      }));
    const policyContentBlocks = (plan.unresolvedPolicyContentDependencies || []).map((dependency) => ({
      resolutionOptionId: dependency.resolutionOptionId,
      informationNeedIds: clone(dependency.informationNeedIds),
      actionTemplateReference: dependency.actionTemplateReference,
      state: "REQUIRES_POLICY_CONTENT",
      reasonCode: dependency.reasonCode,
    }));
    const semantic = {
      contractVersion: JOURNEY_PROJECTION_V2,
      decision: {
        caseReference: clone(content.caseReference),
        policyIdentity: clone(content.policy.identity),
        snapshotId: snapshot.snapshotId,
        snapshotHash: snapshot.decisionContentHash,
        planId: plan.planId,
        planHash: plan.planHash,
        runtimeMode: content.runtimeMode,
        governanceState: content.governanceState,
        productionAuthorized: false,
      },
      customerWorkState: state,
      customerInputComplete: executableBundles.length === 0,
      finalCaseComplete: state === CUSTOMER_WORK_STATE_V2.COMPLETE,
      establishedOwnershipAndControl: {
        subjectEntityId: content.targetEntityId,
        materialEconomicRelationshipCount: economicRelationships.length,
        materialRelationshipReferences: graph.relationships.filter(({ temporalState }) => temporalState === "CURRENT").map(({ relationshipId, subjectEntityId, objectEntityId, relationshipType, dimension }) => ({ relationshipId, subjectEntityId, objectEntityId, relationshipType, dimension })),
      },
      materialOwnershipSpineReferences: economicRelationships.map(({ relationshipId }) => relationshipId).sort(),
      qualifyingPersonSummary: { count: qualifyingPeople.length, people: qualifyingPeople },
      customerWorkBundles,
      systemWork: sortById(plan.systemActions, "actionId"),
      internalReview: { actions: sortById(plan.internalReviewActions, "actionId"), requirements: sortById(content.reviewRequirements, "reviewRequirementId") },
      specialistReview: { actions: sortById(plan.specialistActions, "actionId"), routes: sortById(content.specialistRoutes, "specialistRouteId") },
      blockers: sortById(plan.operationalHoldsAndBlockers, "blockerId"),
      policyContentBlocks,
      residualConfirmation: { state: "RESIDUAL_CONFIRMATION_NOT_CONFIGURED", requiredSignoffIds: ["A-02", "A-17"] },
      evidenceHandoffs: customerWorkBundles.map(({ bundleId, evidenceHandoff }) => evidenceHandoff ? { bundleId, ...clone(evidenceHandoff) } : null).filter(Boolean),
      finishLine: {
        materialRelationshipsEstablished: economicRelationships.length,
        materialRelationshipsRequiringCustomerInput: unique(executableBundles.flatMap(({ linkedRelationshipIds }) => linkedRelationshipIds)).length,
        currentCustomerBundles: executableBundles.length,
        systemActionsRemaining: plan.systemActions.length,
        internalReviewPending: content.reviewRequirements.length + plan.internalReviewActions.length,
        specialistReviewPending: content.specialistRoutes.length + plan.specialistActions.length,
        evidenceHandoffBundles: customerWorkBundles.filter(({ evidenceHandoff }) => evidenceHandoff?.readiness === "EVIDENCE_HANDOFF_READY_EXECUTION_NOT_CONNECTED").length,
        policyContentBlocks: policyContentBlocks.length,
      },
      finalCaseState: {
        customerInputComplete: executableBundles.length === 0,
        internalReviewComplete: content.reviewRequirements.length === 0 && plan.internalReviewActions.length === 0,
        specialistReviewComplete: content.specialistRoutes.length === 0 && plan.specialistActions.length === 0,
        finalDeterminationComplete: state === CUSTOMER_WORK_STATE_V2.COMPLETE,
        onboardingApproved: false,
      },
    };
    const projection = { ...semantic, projectionId: stableId(JOURNEY_PROJECTION_V2, semantic) };
    assertDataOnly(projection, "journeyProjectionV2");
    return deepFreeze(clone(projection));
  } catch (error) {
    if (error instanceof UboJourneyProjectionError) throw error;
    throw projectionError(UBO_JOURNEY_PROJECTION_ERROR_CODE.INCONSISTENT_DECISION_SNAPSHOT, "DecisionSnapshot v2 could not be projected consistently", error);
  }
}

module.exports = {
  CUSTOMER_ACTION_TYPE_V2,
  CUSTOMER_WORK_BUNDLE_V2,
  CUSTOMER_WORK_DELEGATION_V1,
  CUSTOMER_WORK_STATE_V2,
  EXTERNAL_EVIDENCE_HANDOFF_V1,
  JOURNEY_PROJECTION_V2,
  SUBMISSION_CONTRACT,
  projectUboJourneyV2,
};
