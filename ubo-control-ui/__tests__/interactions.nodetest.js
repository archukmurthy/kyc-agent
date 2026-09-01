"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { DETAIL_LEVEL } = require("../OwnershipGraph");
const { projection, renderGraph } = require("./testHarness");

function byLabel(container, selector, fragment) {
  return [...container.querySelectorAll(selector)].find((item) => item.getAttribute("aria-label")?.includes(fragment));
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
    rendered.click(rendered.container.querySelector("button[aria-label='Reset and fit graph to view']"));
    assert.match(rendered.container.querySelector(".ug-toolbar").textContent, /100%/);
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

test("Fit remains subject-centred after selection and recomputes after resize", () => {
  const rendered = renderGraph(projection("UI02"));
  try {
    rendered.resize(720, 430);
    rendered.click(byLabel(rendered.container, ".ug-node", "Alice Morgan"));
    rendered.click(rendered.container.querySelector("button[aria-label='Reset and fit graph to view']"));
    const selected = rendered.container.querySelector(".ug-node.selected");
    assert.ok(selected, "Fit must preserve the selected branch");
    const before = rendered.container.querySelector(".ug-toolbar span").textContent;
    rendered.resize(1000, 650);
    const after = rendered.container.querySelector(".ug-toolbar span").textContent;
    assert.notEqual(after, before);
    assert.ok(Number.parseInt(after, 10) >= Number.parseInt(before, 10));
  } finally { rendered.cleanup(); }
});
