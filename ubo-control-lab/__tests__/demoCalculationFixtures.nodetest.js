"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { startDemoCalculationFixture } = require("../server/reviewLabEngine");

function current(fixtureId) {
  return startDemoCalculationFixture({ fixtureId }).snapshots.at(-1).view;
}

test("Alice fixture uses the accepted engine to multiply each path and aggregate the same canonical person to 28 percent", () => {
  const view = current("DEMO-ALICE-28");
  const calculation = view.graph.calculations.find(({ subjectEntityId, dimension }) => subjectEntityId === "demo-alice" && dimension === "ECONOMIC");
  const basis = view.qualificationBases.find(({ personEntityId, route, dimension }) => personEntityId === "demo-alice" && route === "EFFECTIVE_INTEREST" && dimension === "ECONOMIC");
  const person = view.qualifications.find(({ personEntityId }) => personEntityId === "demo-alice");
  assert.equal(view.graph.nodes.filter(({ entityId }) => entityId === "demo-alice").length, 1);
  assert.equal(calculation.calculationAlgorithm, "ubo-percentage-lookthrough-v1");
  assert.deepEqual(calculation.knownPaths.map(({ contribution }) => contribution.value).sort((a, b) => Number(a) - Number(b)), ["10", "18"]);
  assert.deepEqual(calculation.aggregateKnownValue, { type: "EXACT", value: "28" });
  assert.equal(basis.recordedCalculation.value.value, "28");
  assert.equal(basis.threshold.comparator, ">");
  assert.equal(basis.threshold.value, 25);
  assert.equal(basis.assessmentState, "SATISFIED");
  assert.equal(person.routeStatus, "ROUTE_SATISFIED");
  assert.deepEqual(new Set(calculation.knownPaths.flatMap(({ relationshipIds }) => relationshipIds)).size, 3);
});

test("60/40 fixture keeps 24 percent effective interest separate from 40 percent attributed control", () => {
  const view = current("V2-LAB-02");
  const effective = view.qualificationBases.find(({ route }) => route === "EFFECTIVE_INTEREST");
  const attributed = view.qualificationBases.find(({ route }) => route === "PSC_CONDITION_ATTRIBUTION");
  assert.equal(effective.recordedCalculation.value.value, "24");
  assert.equal(effective.assessmentState, "NOT_SATISFIED");
  assert.equal(attributed.aggregatedTargetRightValue.value, "40");
  assert.equal(attributed.assessmentState, "SATISFIED");
  assert.equal(attributed.attributionChains[0].majoritySteps[0].relationshipType, "VOTING_RIGHTS");
  assert.equal(attributed.attributionChains[0].majoritySteps[0].measurement.value, 60);
});
