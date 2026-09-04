"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  INFORMATION_NEED_TARGET_KIND,
  INFORMATION_NEED_V2,
  INFORMATION_NEED_V2_STATE,
  createDependentDiagnosticsV1,
  createInformationNeedSetV2,
  validateInformationNeedV2,
} = require("../domain/informationNeedV2");

const CASE = { caseId: "case-w8", revisionId: "revision-w8", revision: 3 };
const POLICY = { policyPackId: "uk-corporate", policyVersion: "1.6-RC", policyHash: "sha256:policy", policySchemaVersion: "1.3" };
function frontier(overrides = {}) {
  return {
    requiredByRequirementIds: ["UBO-R03", "UBO-R01", "UBO-R02"],
    targetKind: INFORMATION_NEED_TARGET_KIND.FRONTIER_ENTITY,
    targetReference: { entityId: "holdco" },
    frontierEntityId: "holdco",
    concept: "CURRENT_OWNERSHIP_AND_CONTROL",
    dimension: "ECONOMIC",
    temporalScope: "CURRENT",
    requiredFact: { type: "CURRENT_UPSTREAM_HOLDER_SET" },
    reasonCode: "ECONOMIC_OWNERSHIP_FRONTIER_REACHED",
    causalReferences: [{ phaseId: "CANONICAL_GRAPH_AND_DEPTH", outputHash: "sha256:graph", outputArtifactId: "graph:1" }],
    affected: { pathIds: ["path-b", "path-a"], calculationIds: ["calc-1"], requirementIds: ["UBO-R01", "UBO-R02", "UBO-R03"] },
    permittedResolutionStrategyReferences: [{ requirementId: "UBO-R01", strategy: "DISCOVERY", eligibleForPlanning: true }],
    policyActionTemplateReferences: [], contentReadinessStatus: "NO_CUSTOMER_CONTENT_REQUIRED", requiredSignoffIds: [],
    ...overrides,
  };
}

test("InformationNeed v2 is deterministic, immutable, ordered and round-trippable", () => {
  const first = createInformationNeedSetV2({ caseState: CASE, policyIdentity: POLICY, drafts: [frontier()] });
  const reordered = frontier({
    requiredByRequirementIds: ["UBO-R02", "UBO-R03", "UBO-R01"],
    affected: { pathIds: ["path-a", "path-b"], calculationIds: ["calc-1"], requirementIds: ["UBO-R03", "UBO-R01", "UBO-R02"] },
  });
  const second = createInformationNeedSetV2({ caseState: CASE, policyIdentity: POLICY, drafts: [reordered, frontier()] });
  assert.equal(first.currentNeeds.length, 1);
  assert.equal(first.currentNeeds[0].contractVersion, INFORMATION_NEED_V2);
  assert.equal(first.currentNeeds[0].needId, second.currentNeeds[0].needId);
  assert.equal(first.currentNeeds[0].causalKey, second.currentNeeds[0].causalKey);
  assert.deepEqual(first.currentNeeds[0].requiredByRequirementIds, ["UBO-R01", "UBO-R02", "UBO-R03"]);
  assert.deepEqual(first.currentNeeds[0].affected.pathIds, ["path-a", "path-b"]);
  assert.ok(Object.isFrozen(first.currentNeeds[0]));
  assert.equal(validateInformationNeedV2(JSON.parse(JSON.stringify(first.currentNeeds[0]))), true);
  assert.equal(first.currentNeeds[0].caseReference.caseId, CASE.caseId);
  assert.equal(first.currentNeeds[0].policyIdentity.policyHash, POLICY.policyHash);
});

test("one cause merges requirement and path effects while diagnostics remain dependent", () => {
  const set = createInformationNeedSetV2({ caseState: CASE, policyIdentity: POLICY, drafts: [
    frontier({ requiredByRequirementIds: ["UBO-R01"], affected: { pathIds: ["p1"], requirementIds: ["UBO-R01"] } }),
    frontier({ requiredByRequirementIds: ["UBO-R02", "UBO-R03"], affected: { pathIds: ["p2", "p3"], requirementIds: ["UBO-R02", "UBO-R03"] } }),
  ] });
  assert.equal(set.currentNeeds.length, 1);
  assert.deepEqual(set.currentNeeds[0].affected.pathIds, ["p1", "p2", "p3"]);
  const diagnostics = createDependentDiagnosticsV1(set.currentNeeds);
  assert.equal(diagnostics.filter(({ kind }) => kind === "CALCULATION_PATH_BLOCKED").length, 3);
  assert.ok(diagnostics.every(({ causalNeedId }) => causalNeedId === set.currentNeeds[0].needId));
});

test("distinct causes on one entity remain distinct and malformed semantics fail", () => {
  const currentness = frontier({ concept: "RELATIONSHIP_CURRENTNESS", targetKind: "RELATIONSHIP", targetReference: { relationshipId: "rel-1", subjectEntityId: "holdco", objectEntityId: "customer" }, relationshipId: "rel-1", requiredFact: { type: "CURRENTNESS_STATE", requiredValue: "CURRENT" } });
  const set = createInformationNeedSetV2({ caseState: CASE, policyIdentity: POLICY, drafts: [frontier(), currentness] });
  assert.equal(set.currentNeeds.length, 2);
  assert.throws(() => createInformationNeedSetV2({ caseState: CASE, policyIdentity: POLICY, drafts: [frontier({ targetKind: "REVIEW_DECISION" })] }), /targetKind/);
  assert.throws(() => createInformationNeedSetV2({ caseState: CASE, policyIdentity: POLICY, drafts: [frontier({ dimension: "MAGIC" })] }), /dimension/);
});

test("lifecycle is only OPEN, SATISFIED and SUPERSEDED with stable persistent identity", () => {
  const open = createInformationNeedSetV2({ caseState: CASE, policyIdentity: POLICY, drafts: [frontier()] });
  const persistent = createInformationNeedSetV2({ caseState: CASE, policyIdentity: POLICY, drafts: [frontier()], priorNeedRecords: open.currentNeeds });
  assert.equal(persistent.currentNeeds[0].needId, open.currentNeeds[0].needId);
  const satisfied = createInformationNeedSetV2({ caseState: CASE, policyIdentity: POLICY, drafts: [], priorNeedRecords: open.currentNeeds });
  assert.equal(satisfied.currentNeeds[0].status, INFORMATION_NEED_V2_STATE.SATISFIED);
  const changed = createInformationNeedSetV2({ caseState: CASE, policyIdentity: { ...POLICY, policyHash: "sha256:changed" }, drafts: [frontier()], priorNeedRecords: open.currentNeeds, supersessionReason: "POLICY_CHANGED" });
  assert.deepEqual(new Set(changed.currentNeeds.map(({ status }) => status)), new Set([INFORMATION_NEED_V2_STATE.OPEN, INFORMATION_NEED_V2_STATE.SUPERSEDED]));
  assert.notEqual(changed.currentNeeds.find(({ status }) => status === "OPEN").needId, open.currentNeeds[0].needId);
});
