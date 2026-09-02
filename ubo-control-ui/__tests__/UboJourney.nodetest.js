"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { assertJourneyInputs } = require("../UboJourney");
const { journeyState, renderJourney } = require("./journeyTestHarness");

function render(id, props) {
  return renderJourney(journeyState(id), props);
}

test("resolved data-rich case shows the structure and no unnecessary customer form", () => {
  const rendered = render("CUI01");
  try {
    assert.match(rendered.container.textContent, /Alice Morgan/);
    assert.match(rendered.container.textContent, /No additional ownership information is currently required/);
    assert.equal(rendered.container.querySelector("form"), null);
  } finally { rendered.cleanup(); }
});

test("host composition may expose a taller graph and its reusable selection details", () => {
  const rendered = render("CUI03", { graphHeight: 760, showGraphDetails: true, className: "lab-customer-journey" });
  try {
    assert.ok(rendered.container.querySelector(".uj-shell.with-graph-details.lab-customer-journey"));
    assert.ok(rendered.container.querySelector(".uj-graph .ug-detail-panel"));
    assert.match(rendered.container.querySelector(".ug-shell").getAttribute("style"), /--ug-viewport-height:\s*760px/);
    assert.equal(rendered.container.querySelector(".ug-shell").getAttribute("data-view-mode"), "FIT_WIDTH");
  } finally { rendered.cleanup(); }
});

test("confirmation preserves established information and does not request re-entry", () => {
  const rendered = render("CUI02");
  try {
    assert.match(rendered.container.querySelector(".uj-known").textContent, /Alice Morgan — 40% ownership/);
    assert.equal(rendered.container.querySelectorAll(".uj-field input[type='text']").length, 0);
    assert.equal(rendered.container.querySelectorAll("input[type='radio']").length, 2);
  } finally { rendered.cleanup(); }
});

test("confirmation submission emits the explicit result and stable semantic action", () => {
  const events = [];
  const rendered = render("CUI02", { onAction: (value) => events.push(value) });
  try {
    rendered.click(rendered.container.querySelector("input[value='CONFIRMED']"));
    rendered.click(rendered.container.querySelector(".uj-primary"));
    assert.equal(events.length, 1);
    assert.equal(events[0].confirmationResult, "CONFIRMED");
    assert.deepEqual(events[0].semanticActionTypes, ["CONFIRM_ESTABLISHED_INFORMATION"]);
  } finally { rendered.cleanup(); }
});

test("input boundary rejects malformed, mismatched and unsupported public contracts", () => {
  const state = journeyState("CUI01");
  assert.throws(() => assertJourneyInputs(null, state.plan, state.graph), /journey-projection-v1/);
  assert.throws(() => assertJourneyInputs(state.journey, { ...state.plan, contractVersion: "future-plan" }, state.graph), /resolution-plan-v1/);
  assert.throws(() => assertJourneyInputs({ ...state.journey, customerWorkItems: null }, state.plan, state.graph), /complete public customer projection/);
  assert.throws(() => assertJourneyInputs(state.journey, { ...state.plan, recommendedWave: null }, state.graph), /complete public recommended wave/);
  assert.throws(() => assertJourneyInputs(state.journey, { ...state.plan, snapshotHash: "sha256:other" }, state.graph), /same DecisionSnapshot/);
  assert.throws(() => assertJourneyInputs(state.journey, state.plan, { ...state.graph, contractVersion: "future-graph" }), /ownership-graph-projection-v1/);
});

test("known person details are displayed while only missing identity attributes become controls", () => {
  const rendered = render("CUI04");
  try {
    assert.match(rendered.container.querySelector(".uj-known").textContent, /Alice Morgan/);
    assert.deepEqual([...rendered.container.querySelectorAll(".uj-field input")].map(({ name }) => name).sort(), ["country_of_residence", "date_of_birth"]);
    assert.equal(rendered.container.querySelector("input[name='full_legal_name']"), null);
  } finally { rendered.cleanup(); }
});

test("progressive disclosure shows voting and appointment controls only in their planned fixtures", () => {
  const voting = render("CUI05");
  try {
    assert.match(voting.container.textContent, /Voting rights/);
    assert.doesNotMatch(voting.container.textContent, /Director or board appointment rights/);
  } finally { voting.cleanup(); }
  const appointment = render("CUI06");
  try {
    assert.match(appointment.container.textContent, /Director or board appointment rights/);
    assert.doesNotMatch(appointment.container.textContent, /Still neededVoting rights/);
  } finally { appointment.cleanup(); }
});

test("coalesced needs and information plus evidence remain one logical bundle", () => {
  const coalesced = render("CUI07");
  try {
    assert.equal(coalesced.container.querySelectorAll(".uj-bundle").length, 1);
    assert.equal(coalesced.container.querySelectorAll(".uj-field").length, 2);
  } finally { coalesced.cleanup(); }
  const combined = render("CUI08");
  try {
    assert.equal(combined.container.querySelectorAll(".uj-bundle").length, 1);
    assert.ok(combined.container.querySelector("textarea[name='CURRENT_OWNERSHIP_AND_CONTROL']"));
    assert.match(combined.container.querySelector(".uj-evidence").textContent, /Register of members/);
  } finally { combined.cleanup(); }
});

test("targeted evidence emits an intent without rendering a file input or raw upload", () => {
  const events = [];
  const rendered = render("CUI09", { onAction: (value) => events.push(value) });
  try {
    assert.equal(rendered.container.querySelector("input[type='file']"), null);
    rendered.click(rendered.container.querySelector(".uj-secondary"));
    assert.equal(events.length, 1);
    assert.equal(events[0].eventType, "EVIDENCE_ACTION_REQUESTED");
    assert.deepEqual(events[0].evidenceAction, { intent: "EVIDENCE_ACTION_REQUESTED", evidenceTypes: ["shareholders_agreement"] });
    assert.deepEqual(events[0].values, {});
  } finally { rendered.cleanup(); }
});

test("system, operational blocker, internal review and specialist states expose no customer form", () => {
  const cases = [
    ["CUI10", /We are checking available information/],
    ["CUI11", /There is no additional ownership information for you/],
    ["CUI12", /application will continue through review/],
    ["CUI13", /continue through specialist review/],
  ];
  cases.forEach(([id, message]) => {
    const rendered = render(id);
    try { assert.match(rendered.container.textContent, message); assert.equal(rendered.container.querySelector("form"), null); }
    finally { rendered.cleanup(); }
  });
});

test("senior-management preparation avoids premature fallback terminology", () => {
  const rendered = render("CUI14");
  try {
    assert.match(rendered.container.textContent, /Senior management candidate/);
    assert.doesNotMatch(rendered.container.textContent, /senior managing official fallback/i);
  } finally { rendered.cleanup(); }
});

test("LLP fixture uses member and surplus-asset semantics without company-share wording", () => {
  const rendered = render("CUI15");
  try {
    assert.match(rendered.container.textContent, /Current members and surplus-asset rights/);
    assert.doesNotMatch(rendered.container.textContent, /shareholders|board|directors/i);
  } finally { rendered.cleanup(); }
});

test("unapproved wording is never fabricated into an active question", () => {
  const rendered = render("CUI16");
  try {
    assert.match(rendered.container.textContent, /Customer wording not configured/);
    assert.equal(rendered.container.querySelector("form"), null);
  } finally { rendered.cleanup(); }
});

test("submission validates required fields and emits stable serializable references and values", () => {
  const events = [];
  const state = journeyState("CUI04");
  const beforeJourney = JSON.stringify(state.journey);
  const beforePlan = JSON.stringify(state.plan);
  const rendered = renderJourney(state, { onAction: (value) => events.push(value) });
  try {
    rendered.click(rendered.container.querySelector(".uj-primary"));
    assert.equal(rendered.container.querySelectorAll(".uj-field-error").length, 2);
    rendered.input(rendered.container.querySelector("input[name='date_of_birth']"), "1984-03-12");
    rendered.input(rendered.container.querySelector("input[name='country_of_residence']"), "United Kingdom");
    rendered.click(rendered.container.querySelector(".uj-primary"));
    assert.equal(events.length, 1);
    assert.equal(events[0].contractVersion, "ubo-customer-action-v1");
    assert.equal(events[0].snapshotId, state.plan.snapshotId);
    assert.equal(events[0].snapshotHash, state.plan.snapshotHash);
    assert.equal(events[0].bundleId, "customer-resolution-bundle:cui04");
    assert.equal(events[0].workItemIds.length, 2);
    assert.equal(events[0].actionIntentIds.length, 2);
    assert.deepEqual(events[0].informationNeedIds, state.plan.recommendedWave.customerBundles[0].informationNeedIds);
    assert.deepEqual(events[0].requirementIds, state.plan.recommendedWave.customerBundles[0].requirementIds);
    assert.deepEqual(events[0].values, { country_of_residence: "United Kingdom", date_of_birth: "1984-03-12" });
    assert.doesNotThrow(() => JSON.stringify(events[0]));
    assert.equal(JSON.stringify(state.journey), beforeJourney);
    assert.equal(JSON.stringify(state.plan), beforePlan);
  } finally { rendered.cleanup(); }
});

test("submission does not resolve local plan state; only a replacement projection removes the task", () => {
  const events = [];
  const rendered = renderJourney(journeyState("CUI17", "before"), { onAction: (value) => events.push(value) });
  try {
    rendered.input(rendered.container.querySelector("textarea"), "Alice Morgan owns 100% of the holding company.");
    rendered.click(rendered.container.querySelector(".uj-primary"));
    assert.equal(events.length, 1);
    assert.equal(rendered.container.querySelectorAll(".uj-bundle").length, 1);
    assert.match(rendered.container.textContent, /task remains open until refreshed/);
    rendered.render(journeyState("CUI17", "after"));
    assert.equal(rendered.container.querySelector(".uj-bundle"), null);
    assert.match(rendered.container.textContent, /No additional ownership information is currently required/);
  } finally { rendered.cleanup(); }
});

test("bundle-to-graph and graph-to-bundle linkage uses canonical entity references", () => {
  const rendered = render("CUI03");
  try {
    const linkedNode = rendered.container.querySelector(".ug-node.journey-linked[aria-label*='Cayman Strategic Holdings']");
    assert.ok(linkedNode);
    rendered.click(linkedNode);
    assert.ok(rendered.container.querySelector(".uj-bundle.selected[data-bundle-id='customer-resolution-bundle:cui03']"));
  } finally { rendered.cleanup(); }
});
