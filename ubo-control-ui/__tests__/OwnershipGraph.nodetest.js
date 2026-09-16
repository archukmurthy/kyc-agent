"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { DETAIL_LEVEL, computeLayout, fitScale, fitWidthScale, formatMeasurement, normalizeReviewProjection } = require("../OwnershipGraph");
const { startDemoCalculationFixture } = require("../../ubo-control-lab/server/reviewLabEngine");
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
    dimension: definition.type === "VOTING_RIGHTS" ? "VOTING" : definition.type === undefined || definition.type === "ECONOMIC_OWNERSHIP" ? "ECONOMIC" : "CONTROL",
    temporalState: "CURRENT",
    ...(definition.omitMeasurement ? {} : { measurement: definition.measurement || { type: "EXACT", value: 50 } }),
    qualifiers: definition.qualifiers || {},
    support: definition.support || { claimCount: 1, claimIds: [`claim-${index}`], evidenceReferenceCount: 0, evidenceReferences: [] },
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

test("review projection v2 renders semantic flags, causal needs and evidence separately", () => {
  const v2 = {
    contractVersion: "ubo-ownership-graph-projection-v2",
    subjectEntityId: "customer",
    nodes: [
      { entityId: "customer", primaryName: "Review Customer", category: "LEGAL_ENTITY", semanticFlags: ["SUBJECT"] },
      { entityId: "person", primaryName: "Review Person", category: "NATURAL_PERSON", semanticFlags: ["NOT_CONFIRMED_UBO", "REVIEW_REQUIRED"] },
    ],
    relationships: [{ relationshipId: "v2-vote", subjectEntityId: "person", objectEntityId: "customer", relationshipType: "VOTING_RIGHTS", dimension: "VOTING", temporalState: "CURRENT", resolutionStatus: "CURRENT", evidenceStatus: "CORROBORATED", measurement: { type: "RANGE", lowerBound: 25, upperBound: 50, lowerInclusive: false, upperInclusive: true }, support: { claimIds: ["claim-1"], claimCount: 1, evidenceReferences: [{ system: "fixture", referenceId: "evidence-1" }] }, causalInformationNeedIds: ["need-1"] }],
    personQualificationAssessments: [{ personEntityId: "person", routeStatus: "REVIEW_REQUIRED", basisRecords: [] }],
    informationNeeds: [{ needId: "need-1", status: "OPEN", concept: "VOTING_CONTROL", requiredByRequirementIds: ["UBO-R04"], targetReference: { entityId: "person" }, affected: { relationshipIds: ["v2-vote"] } }],
    reviewRequirements: [], calculations: [], qualificationBasisRecords: [], affectedDiagnostics: [], operationalBlockers: [], specialistRoutes: [],
    pinnedCompatibilityPlan: { recommendedActions: [] }, summary: { totalEntities: 2, totalRelationships: 1 }, snapshotReference: { snapshotId: "snapshot-v2" }, policyIdentity: {}, algorithmIdentity: {}, governanceState: "REVIEW_ONLY", productionAuthorized: false, publicExposure: "REVIEW_ENTRY_ONLY_WAVE_10", projectionId: "projection-v2", projectionHash: "sha256:abc",
  };
  const rendered = renderGraph(v2, { detailLevel: DETAIL_LEVEL.EXPLAIN });
  try {
    assert.equal(rendered.container.querySelectorAll(".ug-node").length, 2);
    assert.equal(rendered.container.querySelectorAll(".ug-edge").length, 1);
    assert.match(rendered.container.querySelector("[aria-label*='Not confirmed UBO']")?.getAttribute("aria-label") || "", /Not confirmed UBO/i);
    assert.match(rendered.container.textContent, /1 unresolved/i);
    const edge = rendered.container.querySelector(".ug-edge");
    rendered.click(edge);
    assert.match(rendered.container.textContent, /Corroborated/i);
    assert.match(rendered.container.textContent, /Operative|Current/i);
  } finally { rendered.cleanup(); }
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

test("source-backed registry context renders compact badges and ordered inspector details", () => {
  const context = graphProjection(["customer"], []);
  context.nodes[0].registryContext = {
    legalName: "THE LAW DEBENTURE CORPORATION P.L.C.", registrationNumber: "00030397", legalForm: "Public limited company (PLC)", incorporatedIn: "United Kingdom",
    pscStatus: "EXEMPT", pscExemptionReason: "Voting shares admitted to trading on an EU regulated market", pscExemptionEffectiveFrom: "2021-05-25",
    researchCoverage: { state: "TERMINAL_SOURCE_STATUS", reason: "Companies House records a current PSC-information exemption." },
    badges: [{ semantic: "REGISTRY_PLC", label: "PLC", css: "registry" }, { semantic: "PSC_EXEMPT", label: "PSC exempt", css: "special" }],
    sources: [{ system: "legacy-ubo-discovery", referenceType: "SOURCE_REFERENCE", referenceId: "companies-house:00030397:exemptions" }],
  };
  const rendered = renderGraph(context, { detailLevel: DETAIL_LEVEL.CUSTOMER });
  try {
    const node = rendered.container.querySelector(".ug-node");
    assert.match(node.getAttribute("aria-label"), /PLC.*PSC exempt/i);
    assert.match(node.textContent, /00030397/, "the registry identity remains visible when names are similar or truncated");
    rendered.click(node);
    const text = rendered.container.textContent;
    assert.ok(text.indexOf("Registry / legal form") < text.indexOf("Jurisdiction"));
    assert.ok(text.indexOf("Jurisdiction") < text.indexOf("Special registry status"));
    assert.ok(text.indexOf("Special registry status") < text.indexOf("Research coverage"));
    assert.match(text, /25 May 2021/);
    assert.match(text, /Voting shares admitted to trading on an EU regulated market/);
  } finally { rendered.cleanup(); }
});

test("demo card can focus an exact graph item and demo review copy avoids developer-facing wording", () => {
  const supplied = graphProjection(["customer", "owner-a"], [{ id: "economic", source: "owner-a", target: "customer" }]);
  supplied.reviews = [{ reviewId: "review-llp", reviewType: "LLP_GOVERNANCE_REQUIRES_CONTROL_ROOM_REVIEW", state: "REVIEW_REQUIRED", entityIds: ["owner-a"], requirementIds: ["UBO-R01"], demoPresentation: { title: "LLP governance interpretation", summary: "The LLP agreement needs internal interpretation.", assumption: "A-06-WA-01", signoffs: ["A-06"] } }];
  const rendered = renderGraph(supplied, { externalSelection: { kind: "review", id: "review-llp" } });
  try {
    assert.match(rendered.container.textContent, /LLP governance interpretation/);
    assert.match(rendered.container.textContent, /A-06-WA-01/);
    assert.match(rendered.container.textContent, /Required sign-off: A-06/);
    assert.doesNotMatch(rendered.container.textContent, /Control Room/);
  } finally { rendered.cleanup(); }
});

test("demo composition collapses the idle inspector and uses a fixed, bounded inspection viewport", () => {
  const rendered = renderGraph(projection("UI07"), { collapseIdleInspector: true, fixedViewportHeight: true, boundedViewportNavigation: true, height: 640 });
  try {
    const workspace = rendered.container.querySelector(".ug-workspace");
    const viewport = rendered.container.querySelector(".ug-canvas-scroll");
    assert.ok(workspace.classList.contains("details-collapsed"));
    assert.equal(rendered.container.querySelector(".ug-detail-panel"), null);
    assert.doesNotMatch(rendered.container.textContent, /The subject remains visible while ownership\/control information is incomplete/);
    assert.equal(viewport.style.height, "640px");
    viewport.scrollLeft = 300;
    viewport.scrollTop = 400;
    const canvas = rendered.container.querySelector("svg.ug-canvas");
    React.act(() => {
      canvas.dispatchEvent(new rendered.dom.window.MouseEvent("pointerdown", { bubbles: true, clientX: 100, clientY: 100 }));
      canvas.dispatchEvent(new rendered.dom.window.MouseEvent("pointermove", { bubbles: true, clientX: 100, clientY: 160 }));
    });
    assert.equal(viewport.scrollTop, 340, "dragging down navigates toward the top of the bounded scroll area");
    React.act(() => canvas.dispatchEvent(new rendered.dom.window.MouseEvent("pointermove", { bubbles: true, clientX: 100, clientY: 40 })));
    assert.equal(viewport.scrollTop, 460, "dragging up navigates toward the bottom of the bounded scroll area");
    rendered.click(rendered.container.querySelector(".ug-node"));
    assert.equal(workspace.classList.contains("details-collapsed"), false);
    assert.ok(rendered.container.querySelector(".ug-detail-panel"));
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

test("full-source hierarchy keeps sibling subsidiaries on the same downstream rank", () => {
  const supplied = graphProjection(
    ["better-comms-voip", "better-holdco", "better-network-services", "lee-taylor", "mitchell-fortescue"],
    [
      { source: "lee-taylor", target: "better-holdco", measurement: { type: "EXACT", value: 25 } },
      { source: "mitchell-fortescue", target: "better-holdco", measurement: { type: "EXACT", value: 75 } },
      { source: "better-holdco", target: "better-comms-voip", measurement: { type: "EXACT", value: 100 } },
      { source: "better-holdco", target: "better-network-services", measurement: { type: "EXACT", value: 100 } },
    ],
  );
  supplied.subject = { ...supplied.subject, entityId: "better-comms-voip", displayName: "Better Comms (VOIP) Ltd" };

  const layout = computeLayout(supplied);

  assert.equal(layout.depths.get("better-holdco"), 1);
  assert.equal(layout.depths.get("better-comms-voip"), 0);
  assert.equal(layout.depths.get("better-network-services"), 0);
  assert.equal(layout.positions.get("better-comms-voip").y, layout.positions.get("better-network-services").y);
  assert.ok(layout.positions.get("better-holdco").y < layout.positions.get("better-network-services").y);
  assert.notEqual(layout.positions.get("better-comms-voip").x, layout.positions.get("better-network-services").x);
});

test("full-source hierarchy places deeper downstream subsidiaries below their parent without clipping", () => {
  const supplied = graphProjection(
    ["customer", "holdco", "sibling", "sibling-subsidiary"],
    [
      { source: "holdco", target: "customer" },
      { source: "holdco", target: "sibling" },
      { source: "sibling", target: "sibling-subsidiary" },
    ],
  );

  const layout = computeLayout(supplied);

  assert.equal(layout.depths.get("customer"), 0);
  assert.equal(layout.depths.get("sibling"), 0);
  assert.equal(layout.depths.get("sibling-subsidiary"), -1);
  assert.ok(layout.positions.get("sibling").y < layout.positions.get("sibling-subsidiary").y);
  assert.ok(layout.positions.get("sibling-subsidiary").y + 104 <= layout.height);
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

test("dense genuine rights use separate lanes, semantic labels, front-most selection and complete details", () => {
  const evidence = { system: "legacy-ubo-discovery", referenceType: "PSC_REGISTER", referenceId: "companies-house:01777777:psc:1", locator: { source: "companies-house" } };
  const supplied = graphProjection(["customer", "owner-a"], [
    {
      id: "surplus", source: "owner-a", target: "customer", type: "ECONOMIC_OWNERSHIP",
      measurement: { type: "RANGE", lowerBound: 75, upperBound: 100, lowerInclusive: true, upperInclusive: true },
      qualifiers: { economicInterestConcept: "SURPLUS_ASSET_RIGHTS", sourceNatureOfControl: "part-right-to-share-surplus-assets-75-to-100-percent" },
      support: { claimCount: 1, claimIds: ["claim-surplus"], evidenceReferenceCount: 1, evidenceReferences: [evidence] },
    },
    {
      id: "appoint-or-remove", source: "owner-a", target: "customer", type: "FORMAL_CONTROL_RIGHT", omitMeasurement: true,
      qualifiers: { controlConcept: "APPOINT_OR_REMOVE_PERSONS", sourceStatementMode: "COMBINED_ALTERNATIVE", sourceNatureOfControl: "right-to-appoint-and-remove-directors", requiresInterpretation: true },
      support: { claimCount: 1, claimIds: ["claim-control"], evidenceReferenceCount: 1, evidenceReferences: [evidence] },
    },
    {
      id: "significant-control", source: "owner-a", target: "customer", type: "SIGNIFICANT_INFLUENCE_OR_CONTROL", omitMeasurement: true,
      qualifiers: { sourceNatureOfControl: "significant-influence-or-control" },
      support: { claimCount: 1, claimIds: ["claim-significant"], evidenceReferenceCount: 1, evidenceReferences: [evidence] },
    },
  ]);
  const rendered = renderGraph(supplied, { detailLevel: DETAIL_LEVEL.EXPLAIN });
  try {
    assert.equal(rendered.container.querySelectorAll(".ug-node").length, 2, "parallel rights must not duplicate nodes");
    const edges = [...rendered.container.querySelectorAll(".ug-edge")];
    assert.equal(edges.length, 3);
    assert.equal(new Set(edges.map((edge) => edge.querySelector("path").getAttribute("d"))).size, 3, "each right requires a visible lane");
    assert.equal(new Set(edges.map((edge) => edge.querySelector(".ug-edge-label-bg").getAttribute("x"))).size, 3, "each label requires an independent lane");
    assert.equal(new Set(edges.map((edge) => edge.getAttribute("data-relationship-id"))).size, 3, "each label remains independently addressable");
    assert.match(rendered.container.textContent, /Surplus asset rights ≥75%/);
    assert.match(rendered.container.querySelector("[data-relationship-id='appoint-or-remove'] .ug-edge-label").textContent, /Appoint\/remove directors/);
    rendered.click(rendered.container.querySelector("[data-relationship-id='appoint-or-remove']"));
    const orderedAfterSelection = [...rendered.container.querySelectorAll(".ug-edge")];
    assert.equal(orderedAfterSelection.at(-1).getAttribute("data-relationship-id"), "appoint-or-remove", "selected relationship renders visually last/front-most");
    const details = rendered.container.querySelector(".ug-detail-panel").textContent;
    assert.match(details, /From entityowner-a/);
    assert.match(details, /To entitycustomer/);
    assert.match(details, /Relationship basisRight to appoint or remove directors/);
    assert.match(details, /PercentageNot applicable to this type of right/);
    assert.match(details, /Registry sourceRecorded in Companies House PSC information/);
    assert.match(details, /Source assertionright-to-appoint-and-remove-directors/);
    assert.match(details, /No separate appointment or removal right is inferred/);
    assert.match(details, /legacy-ubo-discoveryPSC_REGISTER · companies-house:01777777:psc:1/);
    assert.doesNotMatch(details, /Value not established|Direct relationship valueUnknown/);
  } finally { rendered.cleanup(); }
});

test("Alice direct and indirect ownership paths render together with the long direct right in a bounded outside lane", () => {
  const view = startDemoCalculationFixture({ fixtureId: "DEMO-ALICE-28" }).snapshots.at(-1).view;
  const supplied = normalizeReviewProjection(view.graph);
  const layout = computeLayout(supplied);
  const byRoute = (from, to) => supplied.relationships.find(({ sourceEntityId, targetEntityId }) => sourceEntityId === from && targetEntityId === to);
  const direct = byRoute("demo-alice", "demo-alice-target");
  const aliceToHoldco = byRoute("demo-alice", "demo-alice-holdco");
  const holdcoToTarget = byRoute("demo-alice-holdco", "demo-alice-target");
  const holdco = layout.positions.get("demo-alice-holdco");
  assert.equal(supplied.nodes.length, 3);
  assert.equal(supplied.relationships.length, 3);

  const rendered = renderGraph(view.graph, { detailLevel: DETAIL_LEVEL.EXPLAIN });
  try {
    const directEdge = rendered.container.querySelector(`[data-relationship-id='${direct.relationshipId}']`);
    const indirectEdges = [
      rendered.container.querySelector(`[data-relationship-id='${aliceToHoldco.relationshipId}']`),
      rendered.container.querySelector(`[data-relationship-id='${holdcoToTarget.relationshipId}']`),
    ];
    assert.equal(rendered.container.querySelectorAll(".ug-node").length, 3);
    assert.equal(rendered.container.querySelectorAll(".ug-edge").length, 3);
    assert.equal(directEdge.getAttribute("data-edge-route"), "BYPASS");
    assert.equal(directEdge.querySelector(".ug-edge-label").textContent, "10%");
    const directLabel = directEdge.querySelector(".ug-edge-label-bg");
    assert.ok(Number(directLabel.getAttribute("x")) > holdco.x + 196, "the direct label must sit outside the intermediate node");
    assert.ok(Number(directLabel.getAttribute("x")) + Number(directLabel.getAttribute("width")) <= layout.width, "the direct label and outside lane must remain inside content bounds");
    assert.match(directEdge.querySelector("path").getAttribute("marker-end"), /^url\(#ug-arrow-/);
    assert.deepEqual(indirectEdges.map((edge) => edge.querySelector(".ug-edge-label").textContent), ["60%", "30%"]);
    assert.equal(new Set([directEdge, ...indirectEdges].map((edge) => edge.querySelector("path").getAttribute("d"))).size, 3);

    rendered.click(directEdge);
    assert.deepEqual([...rendered.container.querySelectorAll(".ug-edge.active")].map((edge) => edge.dataset.relationshipId), [direct.relationshipId]);
    rendered.click(rendered.container.querySelector("[aria-label='Fit entire graph']"));
    assert.ok(rendered.container.querySelector(`[data-relationship-id='${direct.relationshipId}']`));
    rendered.click(rendered.container.querySelector("[aria-label='Fit graph width']"));
    assert.ok(rendered.container.querySelector(`[data-relationship-id='${direct.relationshipId}']`));
  } finally { rendered.cleanup(); }

  const indirectIds = [aliceToHoldco.relationshipId, holdcoToTarget.relationshipId];
  const indirect = renderGraph(view.graph, { externalSelection: { kind: "path", id: "indirect", relationshipIds: indirectIds } });
  try {
    assert.deepEqual([...indirect.container.querySelectorAll(".ug-edge.active")].map((edge) => edge.dataset.relationshipId).sort(), [...indirectIds].sort());
  } finally { indirect.cleanup(); }
  const aggregate = renderGraph(view.graph, { externalSelection: { kind: "path", id: "aggregate", relationshipIds: [direct.relationshipId, ...indirectIds] } });
  try {
    assert.equal(aggregate.container.querySelectorAll(".ug-edge.active").length, 3);
  } finally { aggregate.cleanup(); }
});

test("generic non-percentage control does not invent director semantics", () => {
  const supplied = graphProjection(["customer", "owner-a"], [{
    id: "generic-control", source: "owner-a", target: "customer", type: "FORMAL_CONTROL_RIGHT", omitMeasurement: true,
    qualifiers: { requiresInterpretation: true },
  }]);
  const rendered = renderGraph(supplied, { detailLevel: DETAIL_LEVEL.EXPLAIN });
  try {
    assert.equal(rendered.container.querySelector(".ug-edge-label").textContent, "Formal control right");
    rendered.click(rendered.container.querySelector("[data-relationship-id='generic-control']"));
    const details = rendered.container.querySelector(".ug-detail-panel").textContent;
    assert.match(details, /Formal control right reported — details not available in this result/);
    assert.doesNotMatch(details, /appoint or remove directors/i);
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

test("large graphs default to readable Fit width with overflow instead of microscopic Fit all", () => {
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
    assert.equal(rendered.container.querySelector(".ug-shell").getAttribute("data-view-mode"), "FIT_WIDTH");
    assert.equal(rendered.container.querySelector("[aria-label='Fit graph width']").getAttribute("aria-pressed"), "true");
    assert.equal(rendered.container.querySelector(".ug-toolbar span").textContent, "100%");
    rendered.resize(920, 680);
    assert.ok(Number.parseInt(rendered.container.querySelector(".ug-toolbar span").textContent, 10) >= 65);
  } finally { rendered.cleanup(); }
});

test("Fit width preserves readable sizing while Overview fits ASDA-depth, long-chain and sibling layouts", () => {
  const asdaLike = graphProjection(
    ["customer", "n1", "n2", "n3", "n4", "n5", "branch-a", "branch-b", "branch-c", "person-a", "person-b", "person-c"],
    [
      { source: "n1", target: "customer" }, { source: "n2", target: "n1" }, { source: "n3", target: "n2" },
      { source: "n4", target: "n3" }, { source: "n5", target: "n4" },
      { source: "branch-a", target: "n5" }, { source: "branch-b", target: "n5" }, { source: "branch-c", target: "n5" },
      { source: "person-a", target: "branch-a", type: "VOTING_RIGHTS" },
      { source: "person-b", target: "branch-b", type: "VOTING_RIGHTS" },
      { source: "person-c", target: "branch-c", type: "VOTING_RIGHTS" },
    ],
  );
  const longChain = graphProjection(["customer", "n1", "n2", "n3", "n4", "n5", "n6"], [
    { source: "n1", target: "customer" }, { source: "n2", target: "n1" }, { source: "n3", target: "n2" },
    { source: "n4", target: "n3" }, { source: "n5", target: "n4" }, { source: "n6", target: "n5" },
  ]);
  const siblings = graphProjection(["customer", ...Array.from({ length: 10 }, (_value, index) => `owner-${index}`)],
    Array.from({ length: 10 }, (_value, index) => ({ source: `owner-${index}`, target: "customer" })));
  [asdaLike, longChain, siblings].forEach((value) => {
    const layout = computeLayout(value);
    const widthScale = fitWidthScale(layout, 920);
    const overviewScale = fitScale(layout, 920, 680);
    assert.ok(widthScale >= 0.65 && widthScale <= 1);
    assert.ok(overviewScale >= 0.05 && overviewScale <= 1);
    assert.ok(layout.width * overviewScale <= 920);
    assert.ok(layout.height * overviewScale <= 680);
  });
  assert.ok(fitWidthScale(computeLayout(asdaLike), 920) >= 0.95, "ASDA Fit width must preserve readable node sizing");
  assert.ok(fitScale(computeLayout(asdaLike), 920, 680) < fitWidthScale(computeLayout(asdaLike), 920), "Overview may reduce a long graph to expose its full height");
});

test("natural-person presence never creates a qualifying badge without a qualification", () => {
  const supplied = structuredClone(projection("UI02"));
  supplied.qualifications = [];
  supplied.summary.qualifyingPeople = 0;
  supplied.nodes.forEach((node) => { node.semantics = node.semantics.filter((value) => value !== "QUALIFYING_PERSON"); });
  const rendered = renderGraph(supplied, { detailLevel: DETAIL_LEVEL.EXPLAIN });
  try {
    assert.equal(rendered.container.querySelectorAll(".ug-svg-badge.qualifying").length, 0);
    assert.match(rendered.container.querySelector(".ug-node.person").getAttribute("aria-label"), /Not confirmed UBO/);
    rendered.click(rendered.container.querySelector(".ug-node.person"));
    assert.match(rendered.container.querySelector(".ug-detail-panel").textContent, /no G2\.3 qualification basis/i);
  } finally { rendered.cleanup(); }
});
