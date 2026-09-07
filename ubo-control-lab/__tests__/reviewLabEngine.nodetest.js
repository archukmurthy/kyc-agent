"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  REVIEW_LAB_SESSION_VERSION,
  catalogue,
  changeReviewProfile,
  normalizedFixtureInput,
  startReviewFixture,
  startReviewReplay,
} = require("../server/reviewLabEngine");
const { createDiscoveryReplayRecord } = require("../server/labEngine");

test("successor catalogue exposes exactly ten actual-engine fixtures and explicit review profiles", () => {
  const result = catalogue();
  assert.equal(result.contractVersion, REVIEW_LAB_SESSION_VERSION);
  assert.deepEqual(result.fixtures.map(({ id }) => id), Array.from({ length: 10 }, (_, index) => `V2-LAB-${String(index + 1).padStart(2, "0")}`));
  assert.deepEqual(result.profiles.map(({ profileId }) => profileId), ["NOT_PROVIDED", "asda-wave-9-further-coverage", "asda-wave-9-predictable-opacity"]);
  assert.equal(result.policy.version, "1.6-RC");
  assert.equal(result.policy.status, "CONTROL_ROOM_REVIEW");
  assert.equal(result.policy.productionAuthorized, false);
  assert.equal(result.profiles[1].requiredSignoffs.includes("A-15"), true);
});

test("every successor fixture runs the review application and pins one real Snapshot v2 and ResolutionPlan v2", () => {
  catalogue().fixtures.forEach(({ id }) => {
    const session = startReviewFixture({ fixtureId: id });
    const view = session.snapshots[0].view;
    assert.equal(session.contractVersion, REVIEW_LAB_SESSION_VERSION, id);
    assert.equal(session.reviewApplicationContractVersion, "ubo-review-application-v1", id);
    assert.equal(session.policyIdentity.policyVersion, "1.6-RC", id);
    assert.equal(session.snapshotVersion, "ubo-decision-snapshot-v2", id);
    assert.equal(session.evaluationTime, view.snapshot.decisionContent.checkpoint.evaluationTime, id);
    assert.equal(view.snapshot.snapshotSchemaVersion, "ubo-decision-snapshot-v2", id);
    assert.equal(view.plan.contractVersion, "ubo-resolution-plan-v2", id);
    assert.equal(view.plan.planHash, view.snapshot.decisionContent.pinnedResolutionPlan.planHash, id);
    assert.equal(view.graph.contractVersion, "ubo-ownership-graph-projection-v2", id);
    assert.equal(view.governance.productionAuthorized, false, id);
    assert.equal(view.policyReadiness.readiness, "REVIEW_ONLY", id);
  });
});

test("successor browser exposes version isolation, filters, deterministic counts and Wave 11 exclusions", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "..", "browser", "lab.js"), "utf8");
  assert.match(source, /BASELINE — 1\.5-RC/);
  assert.match(source, /SUCCESSOR REVIEW — 1\.6-RC/);
  assert.match(source, /const GRAPH_FILTERS = \["OWNERSHIP", "VOTING", "CONTROL", "ALL"\]/);
  assert.match(source, /filteredReviewGraph\(view\.graph, graphFilter/);
  assert.match(source, /PRESENTATION FILTER ONLY/);
  assert.match(source, /APPLICANT JOURNEY v2 NOT YET ENABLED/);
  assert.match(source, /EVIDENCE EXECUTION NOT YET CONNECTED/);
  assert.match(source, /deterministic-list/);
  assert.doesNotMatch(source, /START_REVIEW_ACTION|APPLY_CUSTOMER_INPUT_V2|JourneyProjection v2 enabled/i);
  assert.equal((source.match(/h\(OwnershipGraph, \{ projection: graph/g) || []).length, 1);
});

test("ASDA A and B expose the accepted causal counts and actual planner results", () => {
  const a = startReviewFixture({ fixtureId: "V2-LAB-07" }).snapshots[0].view;
  const b = startReviewFixture({ fixtureId: "V2-LAB-08" }).snapshots[0].view;
  assert.deepEqual([a.counts.openCausalNeeds, a.plan.summary.resolutionGroups, a.plan.summary.recommendedActions, a.plan.state], [10, 10, 7, "SYSTEM_RESOLUTION"]);
  assert.deepEqual([b.counts.openCausalNeeds, b.plan.summary.resolutionGroups, b.plan.summary.recommendedActions, b.plan.state], [10, 6, 3, "CUSTOMER_RESOLUTION"]);
  assert.equal(a.plan.summary.dependentDiagnosticsIgnoredAsActions, 25);
  assert.equal(b.plan.summary.dependentDiagnosticsIgnoredAsActions, 25);
  assert.equal(a.reviewRequirements.length, 2);
  assert.equal(b.reviewRequirements.length, 2);
  assert.equal(a.plan.recommendedActions.some(({ coveredInformationNeedIds }) => coveredInformationNeedIds.some((id) => a.affectedDiagnostics.some(({ diagnosticId }) => diagnosticId === id))), false);
  assert.equal(b.plan.recommendedActions.some(({ coveredInformationNeedIds }) => coveredInformationNeedIds.some((id) => b.affectedDiagnostics.some(({ diagnosticId }) => diagnosticId === id))), false);
});

test("graph projection preserves dimensions, semantic flags, evidence support and truthful causal counts", () => {
  const view = startReviewFixture({ fixtureId: "V2-LAB-07" }).snapshots[0].view;
  assert.equal(new Set(view.graph.nodes.map(({ entityId }) => entityId)).size, view.graph.nodes.length);
  assert.equal(view.graph.nodes.every(({ semanticFlags }) => !semanticFlags.includes("UNRESOLVED")), true);
  assert.equal(view.graph.relationships.some(({ relationshipType }) => relationshipType === "ECONOMIC_OWNERSHIP"), true);
  assert.equal(view.graph.relationships.some(({ relationshipType }) => relationshipType === "VOTING_RIGHTS"), true);
  assert.equal(view.graph.relationships.some(({ relationshipType }) => relationshipType === "BOARD_APPOINTMENT_RIGHT"), true);
  assert.equal(view.graph.relationships.every(({ support }) => Array.isArray(support.claimIds) && Array.isArray(support.evidenceReferences)), true);
  assert.equal(view.graph.summary.openCausalNeedCount, view.informationNeeds.length);
  assert.equal(view.graph.summary.affectedPathCount, view.counts.affectedPaths);
});

test("60/40 qualification keeps the 24 percent effective route separate from 40 percent attribution", () => {
  const view = startReviewFixture({ fixtureId: "V2-LAB-02" }).snapshots[0].view;
  const person = view.qualifications.find(({ personEntityId }) => personEntityId === "v2-person");
  const effective = person.basisRecords.find(({ route }) => route === "EFFECTIVE_INTEREST");
  const attributed = person.basisRecords.find(({ route }) => route === "PSC_CONDITION_ATTRIBUTION");
  assert.equal(effective.recordedCalculation.value.value, "24");
  assert.equal(effective.assessmentState, "NOT_SATISFIED");
  assert.equal(attributed.aggregatedTargetRightValue.value, "40");
  assert.equal(attributed.assessmentState, "SATISFIED");
  assert.equal(person.routeStatus, "ROUTE_SATISFIED");
  assert.equal(person.governance.productionAuthorized, false);
});

test("TDR voting bands remain voting-only and provisional for ASDA", () => {
  const view = startReviewFixture({ fixtureId: "V2-LAB-07" }).snapshots[0].view;
  const people = new Set(["gary-lindsay", "thomas-mitchell", "manjit-dale"]);
  const relationships = view.graph.relationships.filter(({ subjectEntityId }) => people.has(subjectEntityId));
  assert.equal(relationships.length, 3);
  relationships.forEach((relationship) => {
    assert.equal(relationship.relationshipType, "VOTING_RIGHTS");
    assert.deepEqual(relationship.measurement, { type: "RANGE", lowerBound: 25, upperBound: 50, lowerInclusive: false, upperInclusive: true });
  });
  assert.equal(view.qualifications.filter(({ personEntityId }) => people.has(personEntityId)).some(({ routeStatus }) => ["ROUTE_SATISFIED", "NOT_SATISFIED"].includes(routeStatus)), false);
  assert.ok(view.snapshot.decisionContent.requiredSignoffIds.includes("A-06"));
});

test("profile change creates linked immutable history and changes the exact plan", () => {
  const first = startReviewFixture({ fixtureId: "V2-LAB-07" });
  const before = structuredClone(first.snapshots[0]);
  const second = changeReviewProfile({ session: first, profileId: "asda-wave-9-predictable-opacity" });
  assert.equal(second.snapshots.length, 2);
  assert.equal(second.snapshots[1].reason, "PLANNING_CONTEXT_CHANGED");
  assert.equal(second.snapshots[1].predecessorSnapshotId, second.snapshots[0].view.snapshot.snapshotId);
  assert.notEqual(second.snapshots[1].view.plan.planHash, second.snapshots[0].view.plan.planHash);
  assert.notEqual(second.snapshots[1].view.snapshot.snapshotId, second.snapshots[0].view.snapshot.snapshotId);
  assert.deepEqual(second.snapshots[0], before);
});

test("the same normalized replay input starts successor review with zero transport calls", () => {
  const normalized = normalizedFixtureInput({ fixtureId: "V2-LAB-01" });
  const replayRecord = createDiscoveryReplayRecord(normalized);
  const session = startReviewReplay({ replayRecord });
  assert.equal(session.sourceState, "REPLAY");
  assert.equal(session.replay.transportCalls, 0);
  assert.equal(session.snapshots.length, 0);
  assert.ok(session.decisionTargets.candidateClaims.length > 0);
  assert.deepEqual(session.candidateSources[0].candidateFacts, replayRecord.discoveryResult.candidateFacts);
});
