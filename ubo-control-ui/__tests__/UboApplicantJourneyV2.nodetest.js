"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  APPLICANT_JOURNEY_UI_VERSION,
  CUSTOMER_ACTION_VERSION,
  UboApplicantJourneyV2,
  actionExecutable,
  assertApplicantJourneyV2,
  buildCustomerActionV2,
} = require("../UboApplicantJourneyV2");
const { startApplicantFixture } = require("../../ubo-control-lab/server/applicantJourneyLab");
const { renderApplicant } = require("./applicantJourneyTestHarness");

const EXPECTED_PUBLIC_EXPORTS = [
  "CONTRACT_VERSION", "CUSTOMER_ACTION_EVENT_VERSION", "DETAIL_LEVEL", "GRAPH_CONTRACT_VERSION",
  "JOURNEY_CONTRACT_VERSION", "OwnershipGraph", "PLAN_CONTRACT_VERSION", "REVIEW_CONTRACT_VERSION",
  "UboApplicantJourneyV2", "UboJourney", "VIEW_MODE", "assertJourneyInputs", "assertProjection",
  "basisLabel", "computeLayout", "entityRelationshipContext", "fieldLabel", "fitScale", "fitWidthScale",
  "formatMeasurement", "makeEvent", "matchingWorkItems", "normalizeReviewProjection",
  "parallelRelationshipOffset", "pathExpression", "relationshipBasis", "relationshipEdgeLabel",
  "relationshipLabel", "relationshipValue", "roleLabel",
];

function state(id) {
  const session = startApplicantFixture({ fixtureId: id });
  return { session, current: session.snapshots.at(-1), journey: session.snapshots.at(-1).journey };
}

test("public identity is stable and only JourneyProjection v2 is accepted", () => {
  assert.equal(APPLICANT_JOURNEY_UI_VERSION, "ubo-applicant-journey-ui-v2");
  assert.equal(typeof UboApplicantJourneyV2, "function");
  assert.throws(() => assertApplicantJourneyV2({ contractVersion: "ubo-journey-projection-v1" }), /projection-v2/);
  assert.equal(assertApplicantJourneyV2(state("AJV2-07").journey).contractVersion, "ubo-journey-projection-v2");
});

test("UI package adds exactly one deliberate public export while v1 remains present", () => {
  const publicUi = require("..");
  assert.deepEqual(Object.keys(publicUi).sort(), EXPECTED_PUBLIC_EXPORTS);
  assert.equal(EXPECTED_PUBLIC_EXPORTS.length, 30);
  assert.equal(typeof publicUi.UboJourney, "function");
  assert.equal(publicUi.UboApplicantJourneyV2, UboApplicantJourneyV2);
});

test("component has no private UBO, Evidence, host, evaluation or onboarding imports", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "UboApplicantJourneyV2.js"), "utf8");
  const imports = source.split("\n").filter((line) => line.includes("require("));
  assert.doesNotMatch(source, /ubo-control[/\\](domain|policy|planning|application|contracts)/);
  assert.doesNotMatch(imports.join("\n"), /evidence-platform|EvidenceConsumer|src[/\\]App|onboarding/i);
  assert.doesNotMatch(source, /createUboDecisionApplication|\.evaluate\s*\(/);
  assert.match(source, /require\("react"\)/);
});

test("actual ASDA system profile shows no customer form or affected-path tasks", () => {
  const { session, journey } = state("AJV2-13");
  const rendered = renderApplicant(journey, { content: session.content });
  try {
    assert.match(rendered.container.textContent, /checking available records|checking available sources/i);
    assert.equal(rendered.container.querySelector("form"), null);
    assert.equal(rendered.container.querySelectorAll(".uaj-task").length, 0);
  } finally { rendered.cleanup(); }
});

test("actual-contract pending internal and specialist reviews get applicant-safe explanations", () => {
  for (const [fixtureId, expected] of [["AJV2-08", /review team/i], ["AJV2-09", /specialist review/i]]) {
    const { session, journey } = state(fixtureId);
    const rendered = renderApplicant(journey, { content: session.content });
    try {
      assert.equal(rendered.container.querySelector("form"), null);
      assert.match(rendered.container.textContent, expected);
      assert.equal(journey.customerInputComplete, true);
      assert.equal(journey.finalCaseComplete, false);
    } finally { rendered.cleanup(); }
  }
});

test("one card is rendered per actual bundle, never per underlying InformationNeed or path", () => {
  const { session, journey } = state("AJV2-14");
  const rendered = renderApplicant(journey, { content: session.content });
  try {
    assert.equal(rendered.container.querySelectorAll(".uaj-task").length, journey.customerWorkBundles.length);
    assert.equal(rendered.container.querySelectorAll("[data-information-need-id]").length, 0);
    assert.doesNotMatch(rendered.container.textContent, /affected path/i);
  } finally { rendered.cleanup(); }
});

test("content and blocking sign-offs both fail closed at the executable boundary", () => {
  const { journey } = state("AJV2-14");
  const blockedBundle = journey.customerWorkBundles.find(({ blockingSignoffs }) => blockingSignoffs.length);
  const blockedAction = blockedBundle.permittedSemanticActions[0];
  assert.equal(actionExecutable(blockedAction, blockedBundle, { templates: {} }), false);
  const openBundle = journey.customerWorkBundles.find(({ permittedSemanticActions }) => permittedSemanticActions.some(({ executable }) => executable));
  const contentAction = openBundle.permittedSemanticActions.find(({ actionType }) => actionType === "SUBMIT_STRUCTURED_RELATIONSHIP");
  if (contentAction) assert.equal(actionExecutable(contentAction, openBundle, { templates: {} }), false);
});

test("action builder preserves every snapshot, plan, bundle, target, policy and actor pin", () => {
  const { session, journey } = state("AJV2-04");
  const bundle = journey.customerWorkBundles.find(({ permittedSemanticActions }) =>
    permittedSemanticActions.some(({ actionType }) => actionType === "SUBMIT_STRUCTURED_RELATIONSHIP"));
  const action = bundle.permittedSemanticActions.find(({ actionType }) => actionType === "SUBMIT_STRUCTURED_RELATIONSHIP");
  const emitted = buildCustomerActionV2({
    journey,
    bundle,
    action,
    actorContext: session.actorContext,
    content: session.content,
    submittedAt: "2026-09-09T11:00:00.000Z",
    informationAsAtDate: "2026-09-09T10:59:00.000Z",
    payload: { relationships: [] },
  });
  assert.equal(emitted.contractVersion, CUSTOMER_ACTION_VERSION);
  assert.deepEqual(emitted.sourceDecisionSnapshot, { snapshotId: journey.decision.snapshotId, snapshotHash: journey.decision.snapshotHash });
  assert.deepEqual(emitted.sourceResolutionPlan, { planId: journey.decision.planId, planHash: journey.decision.planHash });
  assert.equal(emitted.bundleId, bundle.bundleId);
  assert.equal(emitted.resolutionActionId, action.sourceResolutionActionId);
  assert.deepEqual(emitted.canonicalSubject, bundle.canonicalSubject);
  assert.deepEqual(emitted.frontierEntityIds, bundle.frontierEntityIds);
  assert.deepEqual(emitted.actorReference, session.actorContext.actorReference);
  assert.equal(emitted.actorCapacity, "AUTHORISED_APPLICANT");
});

test("Evidence and delegation flows contain no file control, upload state, email claim or authorization claim", () => {
  const { session, journey } = state("AJV2-14");
  const rendered = renderApplicant(journey, { content: session.content });
  try {
    assert.equal(rendered.container.querySelector("input[type='file']"), null);
    assert.doesNotMatch(rendered.container.textContent, /document received|upload progress|invitation sent|email sent/i);
  } finally { rendered.cleanup(); }
});

test("structured ownership UI offers exact, bounded range and unknown without changing pinned semantics", () => {
  const { session, journey } = state("AJV2-04");
  const rendered = renderApplicant(journey, { content: session.content });
  try {
    const button = [...rendered.container.querySelectorAll(".uaj-action")]
      .find((item) => /ownership/i.test(item.textContent) && !item.disabled);
    rendered.click(button);
    const form = rendered.container.querySelector("form[data-action-type='SUBMIT_STRUCTURED_RELATIONSHIP']");
    assert.ok(form);
    const precision = [...form.querySelectorAll("select")].at(-1);
    assert.deepEqual([...precision.options].map(({ value }) => value), ["EXACT", "RANGE", "UNKNOWN"]);
    assert.equal(form.querySelector("input[type='file']"), null);
    assert.doesNotMatch(form.textContent, /must total|calculate.*UBO/i);
  } finally { rendered.cleanup(); }
});

test("correction UI requires one projected relationship and cannot alter type, target or concept", () => {
  const { session, journey } = state("AJV2-03");
  const rendered = renderApplicant(journey, { content: session.content });
  try {
    const button = [...rendered.container.querySelectorAll(".uaj-action")]
      .find((item) => /Something changed/i.test(item.textContent) && !item.disabled);
    rendered.click(button);
    const form = rendered.container.querySelector("form[data-action-type='CORRECTION_REQUIRED']");
    assert.ok(form);
    const relationshipSelect = form.querySelector("select");
    const bundle = journey.customerWorkBundles.find(({ bundleId }) => bundleId === form.closest("[data-bundle-id]").dataset.bundleId);
    assert.equal(relationshipSelect.options.length, bundle.knownInformation.relationships.length + 1);
    assert.equal(form.querySelector("[name='relationshipType'], [name='target'], [name='concept']"), null);
    assert.match(form.textContent, /audit history/i);
  } finally { rendered.cleanup(); }
});

test("a fresh projection invalidates an open draft instead of copying it", () => {
  const first = state("AJV2-04");
  const rendered = renderApplicant(first.journey, { content: first.session.content });
  try {
    const action = [...rendered.container.querySelectorAll(".uaj-action")].find((button) => !button.disabled);
    rendered.click(action);
    assert.ok(rendered.container.querySelector("form"));
    const next = structuredClone(first.journey);
    next.decision.snapshotHash = "sha256:new-snapshot";
    rendered.render(next, { content: first.session.content });
    assert.equal(rendered.container.querySelector("form"), null);
    assert.match(rendered.container.textContent, /review changed|draft was cleared/i);
  } finally { rendered.cleanup(); }
});

test("mobile stylesheet has a 720px responsive breakpoint and accessible semantic controls", () => {
  const css = fs.readFileSync(path.join(__dirname, "..", "ubo-applicant-journey-v2.css"), "utf8");
  assert.match(css, /@media \(max-width: 720px\)/);
  const { session, journey } = state("AJV2-04");
  const rendered = renderApplicant(journey, { content: session.content });
  try {
    assert.ok(rendered.container.querySelector("main"));
    assert.ok(rendered.container.querySelector("h1"));
    assert.ok([...rendered.container.querySelectorAll("button")].every((button) => button.textContent.trim()));
  } finally { rendered.cleanup(); }
});

test("inline validation moves keyboard focus to the first actionable error", async () => {
  const { session, journey } = state("AJV2-04");
  const rendered = renderApplicant(journey, { content: session.content });
  try {
    const button = [...rendered.container.querySelectorAll(".uaj-action")]
      .find((item) => /ownership/i.test(item.textContent) && !item.disabled);
    rendered.click(button);
    const form = rendered.container.querySelector("form[data-action-type='SUBMIT_STRUCTURED_RELATIONSHIP']");
    await rendered.submit(form);
    const alert = form.querySelector("[role='alert']");
    assert.ok(alert);
    assert.equal(rendered.dom.window.document.activeElement, alert);
  } finally { rendered.cleanup(); }
});
