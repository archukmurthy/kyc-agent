"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createInformationNeedSetV2 } = require("../domain/informationNeedV2");
const { hashArtifact } = require("../internal/phasedArtifact");
const { adaptInformationNeedsV2ToPlanV1Compat } = require("../planning/informationNeedsV2ToPlanV1Compat");
const { planResolutionV1Compat } = require("../planning/resolutionPlanV1Compat");

const CASE = { caseId: "planner-w8", revisionId: "revision-w8", revision: 1 };
const POLICY = { policyPackId: "uk", policyVersion: "1.6-RC", policyHash: "sha256:p", policySchemaVersion: "1.3" };
function needSet() {
  return createInformationNeedSetV2({ caseState: CASE, policyIdentity: POLICY, drafts: [{
    requiredByRequirementIds: ["UBO-R01", "UBO-R02"], targetKind: "FRONTIER_ENTITY", targetReference: { entityId: "holdco" }, frontierEntityId: "holdco",
    concept: "CURRENT_OWNERSHIP_AND_CONTROL", dimension: "ECONOMIC", temporalScope: "CURRENT", requiredFact: { type: "CURRENT_UPSTREAM_HOLDER_SET" }, reasonCode: "FRONTIER",
    causalReferences: [], affected: { calculationIds: ["calc-1"], pathIds: ["p1", "p2"], requirementIds: ["UBO-R01", "UBO-R02"] },
    permittedResolutionStrategyReferences: [
      { requirementId: "UBO-R01", strategy: "DISCOVERY", eligibleForPlanning: true, contentStatus: "NOT_REQUIRED", requiredSignoffIds: [] },
      { requirementId: "UBO-R01", strategy: "CUSTOMER_QUESTION", eligibleForPlanning: true, contentStatus: "APPROVED", requiredSignoffIds: [] },
    ], policyActionTemplateReferences: [], contentReadinessStatus: "POLICY_CONTENT_AVAILABLE", requiredSignoffIds: [],
  }] });
}
function resolution(overrides = {}) {
  const set = needSet();
  const semantic = {
    requirementResolutionAlgorithm: "ubo-requirement-resolution-v2", informationNeedSet: set, informationNeeds: set.currentNeeds,
    dependentDiagnostics: [{ diagnosticId: "d1", causalNeedId: set.currentNeeds[0].needId }], requirementResolutions: [{ resolutionState: "GAP" }],
    operationalBlockers: [], reviewRequirements: [], specialistRoutes: [], ...overrides,
  };
  const assessmentHash = hashArtifact(semantic);
  return { ...semantic, assessmentId: `ubo-requirement-resolution-assessment-v2:${assessmentHash.slice(7, 39)}`, assessmentHash };
}

test("compatibility adapter creates one planner input and at most one current action per causal need", () => {
  const adapted = adaptInformationNeedsV2ToPlanV1Compat({ requirementResolution: resolution() });
  assert.equal(adapted.decisionState.informationNeeds.length, 1);
  assert.equal(adapted.decisionState.resolutionOptions.filter(({ applicabilityState }) => applicabilityState === "APPLICABLE").length, 1);
  assert.equal(adapted.decisionState.informationNeeds.some(({ needId }) => needId === "p1" || needId === "p2"), false);
  const plan = planResolutionV1Compat({ decisionState: adapted.decisionState, inputStateHash: "sha256:input" });
  assert.equal(plan.summary.openInformationNeeds, 1);
  assert.equal(plan.summary.recommendedActions, 1);
  assert.equal(plan.pipelineMaturity, "TRANSITIONAL_REVIEW_ONLY");
});

test("blocked content, operational failures, reviews and specialist routes stay separate from customer work", () => {
  const base = resolution();
  const needId = base.informationNeeds[0].needId;
  const adapted = adaptInformationNeedsV2ToPlanV1Compat({ requirementResolution: resolution({
    operationalBlockers: [{ blockerId: "b1", affectedInformationNeedIds: [needId] }],
    reviewRequirements: [{ reviewRequirementId: "r1", reasonCode: "INTERPRET", requirementIds: ["UBO-R05"], relatedInformationNeedIds: [], personIds: [], entityIds: [], relationshipIds: [] }],
    specialistRoutes: [{ specialistRouteId: "s1", reasonCode: "SPECIAL", requirementIds: ["UBO-R11"], entityIds: ["holdco"], relationshipIds: [] }],
  }) });
  assert.equal(adapted.decisionState.informationNeeds.length, 1);
  assert.equal(adapted.decisionState.operationalBlockers.length, 1);
  assert.deepEqual(adapted.decisionState.actionIntents.map(({ type }) => type).sort(), ["ANALYST_REVIEW", "SPECIALIST_REVIEW"]);
  const plan = planResolutionV1Compat({ decisionState: adapted.decisionState, inputStateHash: "sha256:input" });
  assert.equal(plan.state, "INTERNAL_REVIEW");
  assert.equal(plan.recommendedWave.actor, "INTERNAL_REVIEW");
});
