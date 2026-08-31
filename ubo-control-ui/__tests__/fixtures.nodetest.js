"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const committed = require("../fixtures/projections.json");
const { buildProjectionFixtures } = require("../fixtures/buildFixtureProjections");

test("committed fixtures exactly equal fresh DecisionSnapshot → projection output", () => {
  assert.deepEqual(buildProjectionFixtures(), committed);
});

test("fixture catalogue is exactly UI01–UI12 and UI12 has before/after projections", () => {
  assert.deepEqual(committed.fixtures.map(({ id }) => id), Array.from({ length: 12 }, (_, index) => `UI${String(index + 1).padStart(2, "0")}`));
  assert.deepEqual(committed.fixtures.find(({ id }) => id === "UI12").states.map(({ id }) => id), ["before", "after"]);
  committed.fixtures.flatMap(({ states }) => states).forEach(({ projection }) => {
    assert.equal(projection.contractVersion, "ubo-ownership-graph-projection-v1");
  });
});

test("fixture catalogue exercises every required semantic branch", () => {
  const projections = committed.fixtures.flatMap(({ states }) => states.map(({ projection }) => projection));
  const relationshipTypes = new Set(projections.flatMap(({ relationships }) => relationships.map(({ relationshipType }) => relationshipType)));
  ["ECONOMIC_OWNERSHIP", "VOTING_RIGHTS", "BOARD_APPOINTMENT_RIGHT", "TRUST_OWNERSHIP", "SETTLOR", "TRUSTEE"]
    .forEach((type) => assert.equal(relationshipTypes.has(type), true, type));
  const measurements = projections.flatMap(({ relationships }) => relationships.map(({ measurement }) => measurement?.type).filter(Boolean));
  ["EXACT", "RANGE", "UNKNOWN"].forEach((type) => assert.equal(measurements.includes(type), true, type));
  assert.equal(projections.some(({ qualifications }) => qualifications.length > 0), true);
  assert.equal(projections.some(({ unresolved }) => unresolved.length > 0), true);
  assert.equal(projections.some(({ conflicts }) => conflicts.length > 0), true);
  assert.equal(projections.some(({ reviews }) => reviews.length > 0), true);
});
