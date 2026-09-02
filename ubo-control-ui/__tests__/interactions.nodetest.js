"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { DETAIL_LEVEL } = require("../OwnershipGraph");
const { projection, renderGraph } = require("./testHarness");

function byLabel(container, selector, fragment) {
  return [...container.querySelectorAll(selector)].find((item) => item.getAttribute("aria-label")?.includes(fragment));
}

function asdaChainProjection() {
  const supplied = structuredClone(projection("UI02"));
  supplied.subject.displayName = "ASDA Delivery Limited";
  supplied.nodes.find(({ entityId }) => entityId === "customer").displayName = "ASDA Delivery Limited";
  supplied.nodes.find(({ entityId }) => entityId === "holdco").displayName = "ASDA Group Limited";
  supplied.nodes.find(({ entityId }) => entityId === "alice").displayName = "Bellis Acquisition Company Plc";
  supplied.nodes.find(({ entityId }) => entityId === "alice").category = "LEGAL_ENTITY";
  supplied.nodes.push({ entityId: "stores", displayName: "ASDA Stores Limited", category: "LEGAL_ENTITY", jurisdiction: "GB", externalIdentifiers: [], entityTypeMetadata: { sourceEntityType: "COMPANY" }, qualifyingRoles: [], semantics: [] });
  const upstream = supplied.relationships.find(({ sourceEntityId }) => sourceEntityId === "alice");
  const groupToCustomer = supplied.relationships.find(({ sourceEntityId }) => sourceEntityId === "holdco");
  groupToCustomer.targetEntityId = "stores";
  groupToCustomer.relationshipId = "asda-group-stores-economic";
  supplied.relationships.push({
    ...structuredClone(groupToCustomer),
    relationshipId: "asda-group-stores-voting",
    relationshipType: "VOTING_RIGHTS",
    dimension: "VOTING",
    measurement: { type: "RANGE", lowerBound: 25, upperBound: 50, lowerInclusive: false, upperInclusive: true },
  }, {
    ...structuredClone(upstream),
    relationshipId: "asda-stores-delivery",
    sourceEntityId: "stores",
    targetEntityId: "customer",
    measurement: { type: "EXACT", value: 100 },
  });
  supplied.summary.totalEntities = supplied.nodes.length;
  supplied.summary.totalRelationships = supplied.relationships.length;
  return supplied;
}

test("node selection focuses reasoning and highlights the recorded qualification path", () => {
  const selections = [];
  const rendered = renderGraph(projection("UI02"), { detailLevel: DETAIL_LEVEL.EXPLAIN, onSelectionChange: (value) => selections.push(value) });
  try {
    rendered.click(byLabel(rendered.container, ".ug-node", "Alice Morgan"));
    assert.deepEqual(selections.at(-1), { kind: "entity", id: "alice" });
    assert.match(rendered.container.querySelector(".ug-detail-panel").textContent, /Why this person qualifies/);
    assert.match(rendered.container.querySelector(".ug-detail-panel").textContent, /Effective economic interest: 40%/);
    assert.equal(rendered.container.querySelectorAll(".ug-edge.active").length, 2);
    assert.equal(rendered.dom.window.document.activeElement, rendered.container.querySelector(".ug-detail-panel"));
  } finally { rendered.cleanup(); }
});

test("why-this-percentage uses recorded path values and contribution without UI arithmetic", () => {
  const rendered = renderGraph(projection("UI02"), { detailLevel: DETAIL_LEVEL.EXPLAIN });
  try {
    rendered.click(byLabel(rendered.container, ".ug-node", "Alice Morgan"));
    const path = rendered.container.querySelector(".ug-path-card");
    assert.match(path.textContent, /80% × 50% = 40%/);
    rendered.click(path);
    assert.match(rendered.container.querySelector(".ug-detail-panel").textContent, /80% × 50% = 40%/);
    assert.equal(rendered.container.querySelectorAll(".ug-edge.active").length, 2);
  } finally { rendered.cleanup(); }
});

test("multiple independent paths remain individually selectable and jointly highlighted", () => {
  const rendered = renderGraph(projection("UI03"), { detailLevel: DETAIL_LEVEL.EXPLAIN });
  try {
    rendered.click(byLabel(rendered.container, ".ug-node", "Alice Morgan"));
    assert.equal(rendered.container.querySelectorAll(".ug-path-card").length, 2);
    assert.equal(rendered.container.querySelectorAll(".ug-edge.active").length, 4);
    assert.match(rendered.container.querySelector(".ug-detail-panel").textContent, /30%/);
    assert.match(rendered.container.querySelector(".ug-detail-panel").textContent, /10%/);
  } finally { rendered.cleanup(); }
});

test("relationship selection exposes direct support and evidence detail", () => {
  const rendered = renderGraph(projection("UI01"), { detailLevel: DETAIL_LEVEL.EXPLAIN });
  try {
    rendered.click(rendered.container.querySelector(".ug-edge"));
    const detail = rendered.container.querySelector(".ug-detail-panel").textContent;
    assert.match(detail, /Direct relationship value40%/);
    assert.match(detail, /Supporting claims1/);
    assert.match(detail, /deterministic-ui-fixture/);
  } finally { rendered.cleanup(); }
});

test("conflict and review selection explain deliberate states without deciding them", () => {
  const conflict = renderGraph(projection("UI08"), { detailLevel: DETAIL_LEVEL.EXPLAIN });
  try {
    conflict.click(conflict.container.querySelector(".ug-state-strip .conflict"));
    assert.match(conflict.container.querySelector(".ug-detail-panel").textContent, /Competing facts exist/);
    assert.match(conflict.container.querySelector(".ug-detail-panel").textContent, /has not selected a winner/);
  } finally { conflict.cleanup(); }
  const review = renderGraph(projection("UI09"), { detailLevel: DETAIL_LEVEL.EXPLAIN });
  try {
    review.click(review.container.querySelector(".ug-state-strip .review"));
    assert.match(review.container.querySelector(".ug-detail-panel").textContent, /requires internal review/);
  } finally { review.cleanup(); }
});

test("zoom, fit and keyboard selection controls are operable", () => {
  const selections = [];
  const rendered = renderGraph(projection("UI01"), { onSelectionChange: (value) => selections.push(value) });
  try {
    rendered.click(rendered.container.querySelector("button[aria-label='Zoom in']"));
    assert.match(rendered.container.querySelector(".ug-toolbar").textContent, /110%/);
    rendered.click(rendered.container.querySelector("button[aria-label='Fit graph width']"));
    assert.match(rendered.container.querySelector(".ug-toolbar").textContent, /100%/);
    rendered.resize(720, 430);
    rendered.click(rendered.container.querySelector("button[aria-label='Fit entire graph']"));
    assert.equal(rendered.container.querySelector(".ug-shell").getAttribute("data-view-mode"), "OVERVIEW");
    assert.equal(rendered.container.querySelector("button[aria-label='Fit entire graph']").getAttribute("aria-pressed"), "true");
    rendered.key(byLabel(rendered.container, ".ug-node", "Alice Morgan"), "Enter");
    assert.deepEqual(selections.at(-1), { kind: "entity", id: "alice" });
  } finally { rendered.cleanup(); }
});

test("a new projection cleanly rerenders unresolved-before to resolved-after evidence", () => {
  const before = renderGraph(projection("UI12", "before"));
  try {
    assert.equal(before.container.querySelectorAll(".ug-node").length, 2);
    assert.equal(before.container.querySelector(".ug-node[aria-label*='Alice Morgan']"), null);
  } finally { before.cleanup(); }
  const after = renderGraph(projection("UI12", "after"));
  try {
    assert.equal(after.container.querySelectorAll(".ug-node").length, 3);
    assert.ok(after.container.querySelector(".ug-node[aria-label*='Alice Morgan'][aria-label*='Qualifying']"));
  } finally { after.cleanup(); }
});

test("Unresolved summary opens a deterministic inspectable list and focuses the selected exact branch", () => {
  const supplied = structuredClone(projection("UI07"));
  supplied.unresolved.forEach((item) => { item.resolutionRoutes = [{ actor: "CUSTOMER", strategy: "CUSTOMER_QUESTION", applicabilityState: "APPLICABLE" }]; });
  const rendered = renderGraph(supplied, { detailLevel: DETAIL_LEVEL.EXPLAIN });
  try {
    rendered.click(rendered.container.querySelector("[aria-label^='Inspect'][aria-label$='unresolved items']"));
    const items = [...rendered.container.querySelectorAll(".ug-unresolved-item")];
    assert.equal(items.length, supplied.unresolved.length);
    assert.match(items[0].textContent, /Requirement:/);
    assert.match(items[0].textContent, /State:/);
    assert.match(items[0].textContent, /Resolver:/);
    assert.match(items[0].textContent, /Graph:/);
    rendered.click(items[0]);
    assert.match(rendered.container.querySelector(".ug-detail-panel").textContent, /Can be resolved by/);
    assert.ok(rendered.container.querySelectorAll(".ug-edge.active").length > 0, "a branch-linked unresolved item must focus its exact recorded relationships");
    rendered.click(rendered.container.querySelector(".ug-clear-selection"));
    assert.equal(rendered.container.querySelector(".ug-unresolved-list"), null);
  } finally { rendered.cleanup(); }
});

test("selection clears from node toggle, Escape, empty canvas and the visible clear control", () => {
  const selections = [];
  const rendered = renderGraph(projection("UI01"), { onSelectionChange: (value) => selections.push(value) });
  try {
    const node = byLabel(rendered.container, ".ug-node", "Alice Morgan");
    rendered.click(node);
    assert.ok(rendered.container.querySelector(".ug-clear-selection"));
    rendered.click(node);
    assert.equal(selections.at(-1), null);
    rendered.click(node);
    rendered.key(rendered.dom.window.document, "Escape");
    assert.equal(selections.at(-1), null);
    rendered.click(node);
    rendered.click(rendered.container.querySelector("svg.ug-canvas"));
    assert.equal(selections.at(-1), null);
    rendered.click(node);
    rendered.click(rendered.container.querySelector(".ug-clear-selection"));
    assert.equal(selections.at(-1), null);
  } finally { rendered.cleanup(); }
});

test("Fit width remains subject-centred after selection and recomputes after resize", () => {
  const rendered = renderGraph(projection("UI02"));
  try {
    rendered.resize(720, 430);
    rendered.click(byLabel(rendered.container, ".ug-node", "Alice Morgan"));
    rendered.click(rendered.container.querySelector("button[aria-label='Fit graph width']"));
    const selected = rendered.container.querySelector(".ug-node.selected");
    assert.ok(selected, "Fit must preserve the selected branch");
    const before = rendered.container.querySelector(".ug-toolbar span").textContent;
    rendered.resize(1000, 650);
    const after = rendered.container.querySelector(".ug-toolbar span").textContent;
    assert.notEqual(after, before);
    assert.ok(Number.parseInt(after, 10) >= Number.parseInt(before, 10));
  } finally { rendered.cleanup(); }
});

test("intermediate entity selection includes all direct relationships and the complete downstream ASDA route", () => {
  const rendered = renderGraph(asdaChainProjection(), { detailLevel: DETAIL_LEVEL.EXPLAIN });
  try {
    rendered.click(byLabel(rendered.container, ".ug-node", "ASDA Group Limited"));
    assert.deepEqual([...rendered.container.querySelectorAll(".ug-edge.active")].map((edge) => edge.getAttribute("data-relationship-id")).sort(), [
      "asda-group-stores-economic",
      "asda-group-stores-voting",
      "asda-stores-delivery",
      "graph-rel-9dcd3c70a216934191ef37b4",
    ]);
    const groupDetails = rendered.container.querySelector(".ug-detail-panel").textContent;
    assert.match(groupDetails, /Showing this entity's relationships and route to ASDA Delivery Limited/);
    assert.match(groupDetails, /Direct incoming relationships/);
    assert.match(groupDetails, /Direct outgoing relationships/);
    assert.match(groupDetails, /Downstream route to customer/);
    assert.match(groupDetails, /ASDA Stores Limited → ASDA Delivery Limited/);

    rendered.click(byLabel(rendered.container, ".ug-node", "ASDA Stores Limited"));
    assert.deepEqual([...rendered.container.querySelectorAll(".ug-edge.active")].map((edge) => edge.getAttribute("data-relationship-id")).sort(), [
      "asda-group-stores-economic",
      "asda-group-stores-voting",
      "asda-stores-delivery",
    ]);
    assert.equal(rendered.container.querySelector("[data-relationship-id='graph-rel-9dcd3c70a216934191ef37b4']").classList.contains("muted"), true);
  } finally { rendered.cleanup(); }
});

test("subject selection explains and highlights the complete subject-centred network", () => {
  const supplied = asdaChainProjection();
  const rendered = renderGraph(supplied, { detailLevel: DETAIL_LEVEL.EXPLAIN });
  try {
    rendered.click(byLabel(rendered.container, ".ug-node", "ASDA Delivery Limited"));
    assert.equal(rendered.container.querySelectorAll(".ug-edge.active").length, supplied.relationships.length);
    assert.match(rendered.container.querySelector(".ug-detail-panel").textContent, /Customer under review — showing relationships that reach this entity/);
    assert.match(rendered.container.querySelector(".ug-detail-panel").textContent, /Subject-centred relationship network/);
  } finally { rendered.cleanup(); }
});

test("edge selection isolates one parallel relationship and exposes its complete direct explanation", () => {
  const rendered = renderGraph(asdaChainProjection(), { detailLevel: DETAIL_LEVEL.EXPLAIN });
  try {
    rendered.click(rendered.container.querySelector("[data-relationship-id='asda-group-stores-voting']"));
    assert.deepEqual([...rendered.container.querySelectorAll(".ug-edge.active")].map((edge) => edge.getAttribute("data-relationship-id")), ["asda-group-stores-voting"]);
    assert.equal(rendered.container.querySelector("[data-relationship-id='asda-group-stores-economic']").classList.contains("muted"), true);
    const ordered = [...rendered.container.querySelectorAll(".ug-edge")];
    assert.equal(ordered.at(-1).getAttribute("data-relationship-id"), "asda-group-stores-voting");
    const details = rendered.container.querySelector(".ug-detail-panel").textContent;
    assert.match(details, /Showing this relationship/);
    assert.match(details, /ASDA Group Limited → ASDA Stores Limited/);
    assert.match(details, /Voting rights/);
    assert.match(details, /\(25%, 50%\]/);
    assert.match(details, /Temporal \/ currentness stateCURRENT/);
  } finally { rendered.cleanup(); }
});
