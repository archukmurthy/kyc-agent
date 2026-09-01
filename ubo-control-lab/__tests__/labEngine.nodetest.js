"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { makeEvent } = require("../../ubo-control-ui/UboJourney");
const ASDA_REGRESSION = require("../fixtures/asda-regression.json");
const {
  applyCustomerAction,
  applyReviewerDecisions,
  compareSnapshotEntries,
  fixtureCatalogue,
  startFixture,
  startLive,
  validateCompanyContext,
} = require("../server/labEngine");

function reviewAll(session) {
  return applyReviewerDecisions({
    session,
    identityDecisions: session.decisionTargets.candidateParties
      .map(({ candidatePartyKey }) => ({ candidatePartyKey, action: "REGISTER_NEW" })),
    claimDecisions: session.decisionTargets.candidateClaims
      .map(({ claimId }) => ({ claimId, resultingState: "OPERATIVE" })),
    recordedAt: "2026-09-01T12:00:00.000Z",
  });
}

function ownershipBundle(session) {
  return session.snapshots.at(-1).view.plan.recommendedWave.customerBundles.find(({ recommendedCustomerActions }) =>
    recommendedCustomerActions.some(({ actionTemplate }) => actionTemplate?.actionTemplateId === "DISCLOSE_SHARE_OWNERSHIP"));
}

function customerOwnershipAction(session) {
  const view = session.snapshots.at(-1).view;
  const bundle = ownershipBundle(session);
  const statement = {
    type: "RELATIONSHIP",
    concept: "SHARE_OWNERSHIP",
    direction: "OWNER_TO_TARGET",
    subject: { name: "Alice Owner", entityType: "NATURAL_PERSON", localPartyKey: "alice", registerAsNew: true, externalIdentifiers: [] },
    object: { entityId: bundle.subject.entityId, externalIdentifiers: [] },
    relationship: "ECONOMIC_OWNERSHIP",
    measurement: { type: "EXACT", value: 80 },
    qualifiers: { currentState: "CURRENT", economicInterestConcept: "SHARE_OWNERSHIP" },
  };
  return makeEvent({
    eventType: "CUSTOMER_ACTION_SUBMITTED",
    bundle,
    journey: view.journey,
    plan: view.plan,
    values: { CURRENT_OWNERSHIP_AND_CONTROL: statement },
  });
}

test("Lab shell exposes all deterministic fixtures and validates company context", () => {
  const catalogue = fixtureCatalogue();
  assert.equal(catalogue.fixtures.length, 18);
  assert.deepEqual(catalogue.fixtures.map(({ id }) => id), Array.from({ length: 18 }, (_value, index) => `LAB${String(index + 1).padStart(2, "0")}`));
  assert.doesNotThrow(() => validateCompanyContext({ legalEntityName: "Example Ltd", registrationNumber: "01234567", jurisdiction: "GB", entityProfile: "COMPANY", riskLevel: "LOW" }));
  assert.throws(() => validateCompanyContext({ legalEntityName: "Example Ltd", registrationNumber: "", jurisdiction: "GB", entityProfile: "COMPANY", riskLevel: "LOW" }), /Registration/);
});

test("fixture mode produces real snapshots, public projections, planner data and R01–R14", () => {
  const session = startFixture({ fixtureId: "LAB02" });
  const view = session.snapshots[0].view;
  assert.equal(view.snapshot.snapshotSchemaVersion, "ubo-decision-snapshot-v1");
  assert.equal(view.graph.contractVersion, "ubo-ownership-graph-projection-v1");
  assert.equal(view.journey.contractVersion, "ubo-journey-projection-v1");
  assert.equal(view.plan.contractVersion, "ubo-resolution-plan-v1");
  assert.deepEqual(view.requirements.map(({ requirementId }) => requirementId), Array.from({ length: 14 }, (_value, index) => `UBO-R${String(index + 1).padStart(2, "0")}`));
  assert.equal(view.compliance.policyIdentity.policyVersion, "1.5-RC");
  assert.equal(JSON.stringify(view.plan).includes("{param:"), false);
});

test("Compliance view carries public graph conflicts without recomputing them", () => {
  const view = startFixture({ fixtureId: "LAB10" }).snapshots[0].view;
  assert.equal(view.graph.conflicts.length, 2);
  assert.deepEqual(view.compliance.conflicts, view.graph.conflicts);
});

test("Live Discovery composition uses the accepted adapter and never trusts legacy conclusions", async () => {
  const calls = [];
  const transport = { invoke: async (request) => {
    calls.push(request);
    return { status: 200, body: {
      run: { id: "live-run" },
      ownershipGraph: {
        rootEntityId: "root",
        nodes: [
          { id: "root", name: "Example Live Ltd", type: "company", jurisdiction: "GB" },
          { id: "alice", name: "Alice Live", type: "individual", jurisdiction: "GB" },
        ],
        edges: [{ from: "alice", to: "root", type: "ownership", ownershipPercentage: 60, metadata: { currentState: "CURRENT", naturesOfControl: ["ownership-of-shares-50-to-75-percent"] }, evidenceIds: ["ev-1"] }],
      },
      evidence: [{ id: "ev-1", source: "Companies House", sourceUrl: "https://find-and-update.company-information.service.gov.uk/" }],
      uboCandidates: [{ name: "Ignored legacy conclusion" }],
    } };
  } };
  const session = await startLive({ companyContext: { legalEntityName: "Example Live Ltd", registrationNumber: "01234567", jurisdiction: "GB", entityProfile: "COMPANY", riskLevel: "LOW" }, transport });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, "/api/ubo-discovery");
  assert.equal(session.discovery.mode, "LIVE_DISCOVERY");
  assert.equal(session.discovery.candidateFactCount, 1);
  assert.equal(JSON.stringify(session).includes("Ignored legacy conclusion"), false);
  assert.equal(session.candidateSources[0].simulated, false);
});

test("sanitized ASDA regression reuses exact registry identities and produces one node per canonical entity", async () => {
  const session = await startLive({
    companyContext: { legalEntityName: "Example Delivery Customer Ltd", registrationNumber: "99000001", jurisdiction: "GB", entityProfile: "COMPANY", riskLevel: "LOW" },
    transport: { invoke: async () => ({ status: 200, body: structuredClone(ASDA_REGRESSION) }) },
  });
  assert.deepEqual({
    legacyNodes: ASDA_REGRESSION.ownershipGraph.nodes.length,
    legacyEdges: ASDA_REGRESSION.ownershipGraph.edges.length,
    candidateFacts: session.discovery.candidateFactCount,
    candidateParties: session.decisionTargets.candidateParties.length,
    candidateClaims: session.decisionTargets.candidateClaims.length,
  }, { legacyNodes: 12, legacyEdges: 11, candidateFacts: 32, candidateParties: 60, candidateClaims: 32 });

  const reviewed = reviewAll(session);
  const view = reviewed.snapshots.at(-1).view;
  const reasoning = view.snapshot.decisionContent.reasoning;
  const identifiers = new Map();
  reasoning.canonicalEntities.forEach((entity) => (entity.externalIdentifiers || []).forEach((identifier) => {
    const key = `${identifier.namespace || identifier.system || identifier.identifierType}:${identifier.value}`.toUpperCase();
    if (!identifiers.has(key)) identifiers.set(key, new Set());
    identifiers.get(key).add(entity.entityId);
  }));
  assert.equal([...identifiers.values()].every((entityIds) => entityIds.size === 1), true);
  assert.equal(reasoning.canonicalEntities.length, 12);
  assert.equal(reasoning.identityResolutionDecisions.length, 64);
  assert.equal(reasoning.operativeClaims.length, 32);
  assert.equal(reasoning.graph.nodes.length, 12);
  assert.equal(reasoning.graph.relationships.length, 32);
  assert.equal(view.graph.nodes.length, 12);
  assert.equal(new Set(view.graph.nodes.map(({ entityId }) => entityId)).size, 12);
  assert.equal(view.graph.summary.investigationEntities, 12);
});

test("corroborating legacy assertions coalesce after exact-ID reuse without doubling ownership", async () => {
  const body = structuredClone(ASDA_REGRESSION);
  body.ownershipGraph.nodes = body.ownershipGraph.nodes.slice(0, 2);
  body.ownershipGraph.edges = [
    { ...body.ownershipGraph.edges[0], metadata: { currentState: "CURRENT", naturesOfControl: ["ownership-of-shares-75-to-100-percent"] }, evidenceIds: ["source-01"] },
    { ...body.ownershipGraph.edges[0], metadata: { currentState: "CURRENT", naturesOfControl: ["ownership-of-shares-75-to-100-percent"] }, evidenceIds: ["source-02"] },
  ];
  const session = await startLive({
    companyContext: { legalEntityName: "Example Delivery Customer Ltd", registrationNumber: "99000001", jurisdiction: "GB", entityProfile: "COMPANY", riskLevel: "LOW" },
    transport: { invoke: async () => ({ status: 200, body }) },
  });
  const graph = reviewAll(session).snapshots.at(-1).view.graph;
  assert.equal(graph.nodes.length, 2);
  assert.equal(graph.relationships.length, 1);
  assert.equal(graph.relationships[0].support.claimCount, 2);
  assert.equal(graph.relationships[0].measurement.lowerBound, 75);
});

test("foreign HoldCo runs through real customer input, explicit adjudication and immutable Snapshot B", () => {
  const snapshotASession = startFixture({ fixtureId: "LAB18" });
  const snapshotA = snapshotASession.snapshots[0].view.snapshot;
  const bundle = ownershipBundle(snapshotASession);
  assert.ok(bundle);
  assert.equal(bundle.subject.entityId === snapshotASession.caseContext.subjectEntityId, false);
  assert.equal(bundle.recommendedCustomerActions[0].actionTemplate.submissionContract.target, "INFORMATION_NEED_SUBJECT");

  const afterCustomer = applyCustomerAction({ session: snapshotASession, customerAction: customerOwnershipAction(snapshotASession) });
  assert.equal(afterCustomer.snapshots.length, 1);
  assert.equal(afterCustomer.decisionTargets.candidateClaims.length, 1);
  assert.equal(afterCustomer.decisionTargets.candidateClaims[0].currentState, "CANDIDATE");

  const snapshotBSession = applyReviewerDecisions({
    session: afterCustomer,
    claimDecisions: afterCustomer.decisionTargets.candidateClaims.map(({ claimId }) => ({ claimId, resultingState: "OPERATIVE" })),
  });
  assert.equal(snapshotBSession.snapshots.length, 2);
  assert.equal(snapshotBSession.decisionHistory.snapshots.length, 2);
  const snapshotB = snapshotBSession.snapshots[1].view.snapshot;
  assert.notEqual(snapshotB.snapshotId, snapshotA.snapshotId);
  assert.equal(snapshotB.decisionContent.history.previousSnapshot.snapshotId, snapshotA.snapshotId);
  assert.equal(snapshotB.decisionContent.history.supersessionReason, "CLAIM_ADJUDICATION_CHANGED");
  assert.equal(snapshotBSession.snapshots[1].view.graph.relationships.some(({ relationshipType }) => relationshipType === "ECONOMIC_OWNERSHIP"), true);
  assert.equal(snapshotBSession.snapshots[1].view.compliance.calculations.some(({ aggregateKnownValue }) => aggregateKnownValue?.value === "64"), true);
  assert.equal(snapshotASession.snapshots.length, 1);
  const comparison = compareSnapshotEntries(snapshotBSession.snapshots[0], snapshotBSession.snapshots[1]);
  assert.equal(comparison.qualifyingPeopleAdded.length > 0 || comparison.needsClosed.length > 0
    || comparison.requirementChanges.length > 0 || comparison.relationshipsAdded.length > 0
    || comparison.calculationChanges.length > 0, true);
});

test("identity and claim consoles apply only explicit Decision Application v2 operations", () => {
  const pending = startFixture({ fixtureId: "LAB17" });
  assert.equal(pending.snapshots.length, 0);
  assert.equal(pending.decisionTargets.candidateParties.length > 0, true);
  assert.equal(pending.decisionTargets.candidateClaims.length > 0, true);
  const resolved = applyReviewerDecisions({
    session: pending,
    identityDecisions: pending.decisionTargets.candidateParties.map(({ candidatePartyKey }) => ({ candidatePartyKey, action: "REGISTER_NEW" })),
    claimDecisions: pending.decisionTargets.candidateClaims.map(({ claimId }) => ({ claimId, resultingState: "OPERATIVE" })),
  });
  assert.equal(resolved.decisionTargets.candidateParties.length, 0);
  assert.equal(resolved.decisionTargets.candidateClaims.length, 0);
  assert.equal(resolved.snapshots.length, 1);
});

test("Customer, Compliance, History and Planner consume the same snapshot while the Lab remains session-only", () => {
  const session = startFixture({ fixtureId: "LAB05" });
  const entry = session.snapshots[0];
  assert.equal(entry.view.journey.decision.snapshotHash, entry.view.snapshot.decisionContentHash);
  assert.equal(entry.view.plan.snapshotHash, entry.view.snapshot.decisionContentHash);
  assert.equal(entry.view.graph.decision.snapshotHash, entry.view.snapshot.decisionContentHash);
  assert.equal(session.sessionOnly, true);
  assert.equal(session.caseState.stateEncoding, "base64url-canonical-json-v1");
  assert.equal(Object.prototype.hasOwnProperty.call(session, "database"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(session, "persistence"), false);
});

test("browser product exposes disabled Evidence, feedback export and no fake extraction or persistence", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "browser", "lab.js"), "utf8");
  const html = fs.readFileSync(path.join(__dirname, "..", "browser", "index.html"), "utf8");
  assert.match(source, /NOT YET AVAILABLE — EVIDENCE PLATFORM INTEGRATION IN PROGRESS/);
  assert.match(source, /navigator\.clipboard\.writeText/);
  assert.match(source, /ubo-control-lab-feedback-v1/);
  assert.match(source, /snapshotHash/);
  assert.doesNotMatch(source + html, /api\/research|type=["']file|localStorage|indexedDB/i);
});

test("Lab production imports stay on public UBO and accepted integration boundaries", () => {
  const server = fs.readFileSync(path.join(__dirname, "..", "server", "labEngine.js"), "utf8");
  assert.match(server, /require\("\.\.\/\.\.\/ubo-control"\)/);
  assert.match(server, /legacy-discovery/);
  assert.doesNotMatch(server, /ubo-control\/(domain|application|projection|planning)\//);
  assert.doesNotMatch(server, /src\/App|entity_dossiers|journey_state|db\/|api\/research/);
});
