"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { DETAIL_LEVEL, computeLayout, formatMeasurement } = require("../OwnershipGraph");
const { fixtures, projection, renderGraph } = require("./testHarness");

function graphProjection(entityIds, relationshipDefinitions) {
  const base = structuredClone(projection("UI02"));
  base.subject = { ...base.subject, entityId: "customer", displayName: "Layout Customer" };
  base.nodes = entityIds.map((entityId) => ({
    entityId,
    displayName: entityId,
    category: entityId.startsWith("owner") ? "NATURAL_PERSON" : "LEGAL_ENTITY",
    externalIdentifiers: [],
    entityTypeMetadata: {},
    qualifyingRoles: [],
    semantics: entityId === "customer" ? ["SUBJECT"] : [],
  }));
  base.relationships = relationshipDefinitions.map((definition, index) => ({
    relationshipId: definition.id || `layout-relationship-${index}`,
    sourceEntityId: definition.source,
    targetEntityId: definition.target,
    relationshipType: definition.type || "ECONOMIC_OWNERSHIP",
    dimension: definition.type === "VOTING_RIGHTS" ? "VOTING" : "ECONOMIC",
    temporalState: "CURRENT",
    measurement: definition.measurement || { type: "EXACT", value: 50 },
    support: { claimCount: 1, claimIds: [`claim-${index}`], evidenceReferenceCount: 0, evidenceReferences: [] },
    indicators: [],
  }));
  base.calculations = [];
  base.qualifications = [];
  base.unresolved = [];
  base.conflicts = [];
  base.reviews = [];
  base.summary = { totalEntities: base.nodes.length, totalRelationships: base.relationships.length };
  return base;
}

test("UI01–UI12 committed projection fixtures render without error", () => {
  fixtures.fixtures.forEach((fixture) => fixture.states.forEach((state) => {
    const rendered = renderGraph(state.projection, { detailLevel: DETAIL_LEVEL.EXPLAIN });
    try {
      assert.equal(rendered.container.querySelectorAll(".ug-node").length, state.projection.nodes.length, `${fixture.id}/${state.id} nodes`);
      assert.equal(rendered.container.querySelectorAll(".ug-edge").length, state.projection.relationships.length, `${fixture.id}/${state.id} relationships`);
      assert.ok(rendered.container.querySelector("svg[role='img']")?.getAttribute("aria-label").includes(state.projection.subject.displayName));
    } finally { rendered.cleanup(); }
  }));
});

test("major node categories use shape/icon/text semantics rather than colour alone", () => {
  const rendered = renderGraph(projection("UI09"));
  try {
    assert.ok(rendered.container.querySelector(".ug-node.person[aria-label*='Natural person']"));
    assert.ok(rendered.container.querySelector(".ug-node.entity[aria-label*='Legal entity']"));
    assert.ok(rendered.container.querySelector(".ug-node.trust[aria-label*='Trust / legal arrangement']"));
    assert.ok(rendered.container.querySelector(".ug-node.trust[aria-label*='Special structure']"));
  } finally { rendered.cleanup(); }
});

test("economic, voting, appointment and trust relationships remain visibly distinct", () => {
  const voting = renderGraph(projection("UI05"));
  try {
    const economic = voting.container.querySelector(".ug-edge.type-economic-ownership path");
    const votingRights = voting.container.querySelector(".ug-edge.type-voting-rights path");
    assert.ok(economic);
    assert.ok(votingRights);
    assert.notEqual(economic.getAttribute("d"), votingRights.getAttribute("d"), "parallel relationship paths must not overlap");
    assert.notEqual(economic.parentElement.querySelector(".ug-edge-label-bg").getAttribute("x"), votingRights.parentElement.querySelector(".ug-edge-label-bg").getAttribute("x"), "parallel relationship labels must not overlap");
    const economicLabel = economic.parentElement.querySelector(".ug-edge-label-bg");
    const votingLabel = votingRights.parentElement.querySelector(".ug-edge-label-bg");
    assert.ok(Number(economicLabel.getAttribute("x")) + Number(economicLabel.getAttribute("width")) <= Number(votingLabel.getAttribute("x")), "parallel relationship labels must not collide");
    assert.match(voting.container.textContent, /Vote · 35%/);
  } finally { voting.cleanup(); }
  const appointment = renderGraph(projection("UI06"));
  try {
    assert.ok(appointment.container.querySelector(".ug-edge.type-board-appointment-right"));
    assert.match(appointment.container.querySelector(".ug-edge").getAttribute("aria-label"), /Board appointment control/);
    assert.doesNotMatch(appointment.container.querySelector(".ug-edge").getAttribute("aria-label"), /%/);
  } finally { appointment.cleanup(); }
  const trust = renderGraph(projection("UI09"));
  try { assert.ok(trust.container.querySelector(".ug-edge.type-trust-ownership")); } finally { trust.cleanup(); }
});

test("EXACT, RANGE and UNKNOWN displays preserve projection semantics", () => {
  assert.equal(formatMeasurement({ type: "EXACT", value: 40 }, true), "40%");
  assert.equal(formatMeasurement({ type: "RANGE", lowerBound: 25, upperBound: 50, lowerInclusive: false, upperInclusive: true }), "25–50%");
  assert.equal(formatMeasurement({ type: "RANGE", lowerBound: 25, upperBound: 50, lowerInclusive: false, upperInclusive: true }, true), "(25%, 50%]");
  assert.equal(formatMeasurement({ type: "UNKNOWN", reason: "NOT_ESTABLISHED" }, true), "Unknown");
  const ranged = renderGraph(projection("UI04"));
  try { assert.match(ranged.container.textContent, /25–50%/); } finally { ranged.cleanup(); }
  const unknown = renderGraph(projection("UI07"));
  try { assert.match(unknown.container.textContent, /Unknown/); } finally { unknown.cleanup(); }
});

test("qualification, unresolved, conflict, review and NO_DATA-style states are explicit", () => {
  const direct = renderGraph(projection("UI01"));
  try { assert.ok(direct.container.querySelector(".ug-node[aria-label*='Qualifying']")); } finally { direct.cleanup(); }
  const unresolved = renderGraph(projection("UI07"));
  try { assert.ok(unresolved.container.querySelector(".ug-node[aria-label*='Unresolved']")); } finally { unresolved.cleanup(); }
  const conflict = renderGraph(projection("UI08"));
  try { assert.match(conflict.container.textContent, /Conflict · 2 claims/); } finally { conflict.cleanup(); }
  const review = renderGraph(projection("UI09"));
  try { assert.match(review.container.textContent, /Review ·/); } finally { review.cleanup(); }
  const noData = renderGraph(projection("UI11"));
  try {
    assert.match(noData.container.textContent, /Ownership\/control unresolved/);
    assert.equal(noData.container.querySelectorAll(".ug-node").length, 1);
  } finally { noData.cleanup(); }
});

test("explain mode presents snapshot identity while customer mode hides audit-only metadata", () => {
  const explain = renderGraph(projection("UI01"), { detailLevel: DETAIL_LEVEL.EXPLAIN });
  try { assert.ok(explain.container.querySelector(".ug-snapshot")); } finally { explain.cleanup(); }
  const customer = renderGraph(projection("UI01"), { detailLevel: DETAIL_LEVEL.CUSTOMER });
  try { assert.equal(customer.container.querySelector(".ug-snapshot"), null); } finally { customer.cleanup(); }
});

test("accessible summary names the graph and describes its semantic state", () => {
  const rendered = renderGraph(projection("UI02"));
  try {
    assert.equal(rendered.container.querySelector("svg").getAttribute("aria-label"), "Ownership and control graph for Northstar Payments Ltd");
    assert.match(rendered.container.querySelector(".ug-sr-only").textContent, /customer subject/);
    assert.ok(rendered.container.querySelector("[role='toolbar'][aria-label='Graph navigation controls']"));
  } finally { rendered.cleanup(); }
});

test("deterministic hierarchy anchors the customer below immediate owners, long chains and sibling branches", () => {
  const supplied = graphProjection(
    ["customer", "midco", "holdco-a", "holdco-b", "owner-a", "owner-b"],
    [
      { source: "midco", target: "customer" },
      { source: "holdco-a", target: "midco" },
      { source: "holdco-b", target: "midco" },
      { source: "owner-a", target: "holdco-a" },
      { source: "owner-b", target: "holdco-b" },
    ],
  );
  const first = computeLayout(supplied);
  const second = computeLayout(structuredClone(supplied));
  assert.deepEqual([...first.positions], [...second.positions]);
  assert.equal(first.depths.get("customer"), 0);
  assert.equal(first.depths.get("midco"), 1);
  assert.equal(first.depths.get("holdco-a"), 2);
  assert.equal(first.depths.get("owner-a"), 3);
  assert.ok(first.positions.get("owner-a").y < first.positions.get("holdco-a").y);
  assert.ok(first.positions.get("holdco-a").y < first.positions.get("midco").y);
  assert.ok(first.positions.get("midco").y < first.positions.get("customer").y);
  assert.equal(first.positions.get("holdco-a").y, first.positions.get("holdco-b").y);
  assert.notEqual(first.positions.get("holdco-a").x, first.positions.get("holdco-b").x);
});

test("parallel economic and voting edges reuse nodes while remaining separately traceable", () => {
  const supplied = graphProjection(["customer", "owner-a"], [
    { id: "economic", source: "owner-a", target: "customer", type: "ECONOMIC_OWNERSHIP", measurement: { type: "EXACT", value: 35 } },
    { id: "voting", source: "owner-a", target: "customer", type: "VOTING_RIGHTS", measurement: { type: "EXACT", value: 40 } },
  ]);
  const rendered = renderGraph(supplied);
  try {
    assert.equal(rendered.container.querySelectorAll(".ug-node").length, 2);
    assert.equal(rendered.container.querySelectorAll(".ug-edge").length, 2);
    assert.equal(rendered.container.querySelectorAll(".ug-edge-label")[0].textContent.includes("%"), true);
    assert.notEqual(rendered.container.querySelector(".ug-edge.type-economic-ownership path").getAttribute("d"), rendered.container.querySelector(".ug-edge.type-voting-rights path").getAttribute("d"));
  } finally { rendered.cleanup(); }
});

test("selecting an upstream entity highlights its complete route to the customer", () => {
  const supplied = graphProjection(["customer", "midco", "holdco", "owner-a", "owner-b"], [
    { id: "owner-holdco", source: "owner-a", target: "holdco" },
    { id: "holdco-midco", source: "holdco", target: "midco" },
    { id: "midco-customer", source: "midco", target: "customer" },
    { id: "other-owner-customer", source: "owner-b", target: "customer" },
  ]);
  const rendered = renderGraph(supplied);
  try {
    rendered.click(rendered.container.querySelector(".ug-node[aria-label^='owner-a']"));
    assert.deepEqual([...rendered.container.querySelectorAll(".ug-edge.active")].map((edge) => edge.getAttribute("aria-label")).sort(), [
      "Economic ownership from holdco to midco, 50%",
      "Economic ownership from midco to customer, 50%",
      "Economic ownership from owner-a to holdco, 50%",
    ]);
    assert.equal(rendered.container.querySelector(".ug-edge[aria-label^='Economic ownership from owner-b']").classList.contains("muted"), true);
  } finally { rendered.cleanup(); }
});

test("large graphs retain readable-size nodes in an overflow viewport instead of shrinking the whole map", () => {
  const owners = Array.from({ length: 24 }, (_value, index) => `owner-${String(index + 1).padStart(2, "0")}`);
  const supplied = graphProjection(["customer", ...owners], owners.map((owner) => ({ source: owner, target: "customer" })));
  const layout = computeLayout(supplied);
  assert.ok(layout.width > 6000);
  assert.equal(new Set(layout.positions.values()).size, 25);
  const rendered = renderGraph(supplied);
  try {
    const viewport = rendered.container.querySelector(".ug-canvas-scroll");
    const svg = rendered.container.querySelector(".ug-canvas");
    assert.ok(viewport);
    assert.equal(svg.style.width, `${layout.width}px`);
    assert.equal(svg.getAttribute("viewBox"), `0 0 ${layout.width} ${layout.height}`);
    assert.equal(rendered.container.querySelector(".ug-node-name").getAttribute("font-size"), null);
    assert.equal(rendered.container.querySelector("[aria-label='Reset and fit graph to view']").nextSibling.textContent, "100%");
  } finally { rendered.cleanup(); }
});
