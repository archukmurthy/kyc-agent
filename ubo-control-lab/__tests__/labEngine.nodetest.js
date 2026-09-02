"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { makeEvent } = require("../../ubo-control-ui/UboJourney");
const { calculateEffectivePercentage, CALCULATION_STATUS } = require("../../ubo-control/domain/percentageCalculation");
const { GRAPH_DIMENSION } = require("../../ubo-control/domain/ownershipGraph");
const ASDA_REGRESSION = require("../fixtures/asda-regression.json");
const {
  applyCustomerAction,
  applyReviewerDecisions,
  compareSnapshotEntries,
  fixtureCatalogue,
  startFixture,
  startLive,
  startReplay,
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
  assert.equal(catalogue.fixtures.length, 19);
  assert.deepEqual(catalogue.fixtures.map(({ id }) => id), Array.from({ length: 19 }, (_value, index) => `LAB${String(index + 1).padStart(2, "0")}`));
  assert.doesNotThrow(() => validateCompanyContext({ legalEntityName: "Example Ltd", registrationNumber: "01234567", jurisdiction: "GB", entityProfile: "COMPANY", riskLevel: "LOW" }));
  assert.throws(() => validateCompanyContext({ legalEntityName: "Example Ltd", registrationNumber: "", jurisdiction: "GB", entityProfile: "COMPANY", riskLevel: "LOW" }), /Registration/);
});

test("LAB19 preserves each TDR PSC source assertion as one supported projected relationship", () => {
  const session = startFixture({ fixtureId: "LAB19" });
  const graph = session.snapshots[0].view.graph;
  assert.equal(graph.nodes.length, 4);
  assert.equal(new Set(graph.nodes.map(({ entityId }) => entityId)).size, 4);
  assert.deepEqual(graph.relationships.map(({ relationshipType }) => relationshipType).sort(), [
    "ECONOMIC_OWNERSHIP",
    "FORMAL_CONTROL_RIGHT",
    "SIGNIFICANT_INFLUENCE_OR_CONTROL",
  ]);
  assert.equal(graph.relationships.some(({ relationshipType }) => relationshipType === "VOTING_RIGHTS"), false);
  assert.equal(graph.relationships.some(({ relationshipType }) => relationshipType === "BOARD_APPOINTMENT_RIGHT"), false);
  assert.equal(graph.relationships.some(({ relationshipType }) => relationshipType === "BOARD_REMOVAL_RIGHT"), false);
  const surplus = graph.relationships.find(({ qualifiers }) => qualifiers?.economicInterestConcept === "SURPLUS_ASSET_RIGHTS");
  assert.deepEqual(surplus.measurement, { type: "RANGE", lowerBound: 75, upperBound: 100, lowerInclusive: true, upperInclusive: true });
  const combined = graph.relationships.find(({ relationshipType }) => relationshipType === "FORMAL_CONTROL_RIGHT");
  assert.equal(combined.qualifiers.sourceStatementMode, "COMBINED_ALTERNATIVE");
  assert.equal(combined.qualifiers.requiresInterpretation, true);
  assert.equal(graph.relationships.every(({ support }) => support.claimCount === 1 && support.evidenceReferenceCount === 1), true);
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
  assert.equal(session.sourceState, "FIXTURE");
  assert.equal(session.discovery.sourceState, "FIXTURE");
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
  assert.equal(session.sourceState, "LIVE");
  assert.equal(session.discovery.candidateFactCount, 1);
  assert.equal(JSON.stringify(session).includes("Ignored legacy conclusion"), false);
  assert.equal(session.candidateSources[0].simulated, false);
  assert.equal(session.replayCapture.contractVersion, "ubo-control-lab-discovery-replay-v1");
  assert.deepEqual(session.replayCapture.discoveryResult.candidateFacts, session.candidateSources[0].candidateFacts);
  assert.deepEqual(Object.keys(session.replayCapture.discoveryResult).sort(), ["candidateFacts", "contractVersion", "issues", "operationEvidenceReferences", "outcome", "requestId"]);
});

test("saved normalized Discovery result replays as a fresh UBO case without invoking transport", async () => {
  let liveCalls = 0;
  const live = await startLive({
    companyContext: { legalEntityName: "Replay Example Ltd", registrationNumber: "07654321", jurisdiction: "GB", entityProfile: "COMPANY", riskLevel: "MEDIUM" },
    transport: { invoke: async () => {
      liveCalls += 1;
      return { status: 200, body: {
        run: { id: "captured-live-run", completedAt: "2026-08-31T10:00:00.000Z" },
        ownershipGraph: {
          rootEntityId: "captured-root",
          nodes: [
            { id: "captured-root", name: "Replay Example Ltd", type: "company", jurisdiction: "GB" },
            { id: "captured-owner", name: "Captured Owner", type: "individual", jurisdiction: "GB" },
          ],
          edges: [{ from: "captured-owner", to: "captured-root", type: "ownership", ownershipPercentage: 55, evidenceIds: ["captured-evidence"] }],
        },
        evidence: [{ id: "captured-evidence", source: "Captured Register", sourceUrl: "https://example.test/captured" }],
        ubos: [{ name: "Forbidden legacy UBO conclusion" }],
      } };
    } },
  });
  assert.equal(liveCalls, 1);
  const replayRecord = structuredClone(live.replayCapture);
  let replayTransportCalls = 0;
  const replay = startReplay({
    replayRecord,
    transport: { invoke: () => { replayTransportCalls += 1; throw new Error("Replay must never invoke transport"); } },
  });
  assert.equal(replayTransportCalls, 0);
  assert.equal(replay.sourceState, "REPLAY");
  assert.equal(replay.discovery.mode, "REPLAY_DISCOVERY");
  assert.notEqual(replay.caseId, live.caseId);
  assert.deepEqual(replay.candidateSources[0].candidateFacts, replayRecord.discoveryResult.candidateFacts);
  assert.deepEqual(replay.candidateSources[0].operationEvidenceReferences, replayRecord.discoveryResult.operationEvidenceReferences);
  assert.deepEqual(replay.candidateSources[0].issues, replayRecord.discoveryResult.issues);
  assert.equal(replay.discovery.replay.originalSavedAt, replayRecord.savedAt);
  assert.equal(replay.discovery.replay.originalRequestId, replayRecord.discoveryResult.requestId);
  assert.equal(replay.snapshots.length, 0);
  assert.equal(JSON.stringify(replayRecord).includes("Forbidden legacy UBO conclusion"), false);

  const liveReviewed = reviewAll(live);
  const reviewed = reviewAll(replay);
  assert.equal(reviewed.snapshots.length, 1);
  assert.notEqual(reviewed.snapshots[0].view.snapshot.snapshotId, liveReviewed.snapshots[0].view.snapshot.snapshotId);
  assert.equal(reviewed.snapshots.at(-1).view.snapshot.snapshotSchemaVersion, "ubo-decision-snapshot-v1");
  assert.equal(reviewed.snapshots.at(-1).view.graph.relationships.length, 1);
});

test("replay rejects a mismatched company and corrupted local record safely", async () => {
  const live = await startLive({
    companyContext: { legalEntityName: "Replay Guard Ltd", registrationNumber: "01112222", jurisdiction: "GB", entityProfile: "COMPANY", riskLevel: "LOW" },
    transport: { invoke: async () => ({ status: 200, body: { run: { id: "guard-run" }, ownershipGraph: { rootEntityId: "guard-root", nodes: [{ id: "guard-root", name: "Replay Guard Ltd", type: "company", jurisdiction: "GB" }], edges: [] }, evidence: [] } }) },
  });
  assert.throws(() => startReplay({
    replayRecord: live.replayCapture,
    expectedCompanyContext: { ...live.companyContext, legalEntityName: "Other Company Ltd", registrationNumber: "09998888" },
  }), /different company/);
  const corrupted = structuredClone(live.replayCapture);
  corrupted.discoveryResult.candidateFacts = "not-an-array";
  assert.throws(() => startReplay({ replayRecord: corrupted }), /candidateFacts|CapabilityResult|array/i);
  const tampered = structuredClone(live.replayCapture);
  tampered.companyContext.legalEntityName = "Silently Rebound Company Ltd";
  assert.throws(() => startReplay({ replayRecord: tampered }), /integrity check/);
});

test("failed or unavailable transport outcomes are not presented as reusable Discovery input", async () => {
  const session = await startLive({
    companyContext: { legalEntityName: "Unavailable Replay Ltd", registrationNumber: "02334455", jurisdiction: "GB", entityProfile: "COMPANY", riskLevel: "LOW" },
    transport: { invoke: async () => { const error = new Error("provider unavailable"); error.code = "ETIMEDOUT"; throw error; } },
  });
  assert.equal(session.discovery.outcomeStates[0], "UNAVAILABLE");
  assert.equal(session.replayCapture, null);
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
  }, { legacyNodes: 12, legacyEdges: 11, candidateFacts: 25, candidateParties: 47, candidateClaims: 25 });

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
  assert.equal(reasoning.identityResolutionDecisions.length, 50);
  assert.equal(reasoning.operativeClaims.length, 25);
  assert.equal(reasoning.graph.nodes.length, 12);
  assert.equal(reasoning.graph.relationships.length, 25);
  assert.equal(view.graph.nodes.length, 12);
  assert.equal(new Set(view.graph.nodes.map(({ entityId }) => entityId)).size, 12);
  assert.equal(view.graph.summary.investigationEntities, 12);
});

test("ASDA voting-only PSC facts preserve their range and cannot become economic ownership", async () => {
  let session = await startLive({
    companyContext: { legalEntityName: "Example Delivery Customer Ltd", registrationNumber: "99000001", jurisdiction: "GB", entityProfile: "COMPANY", riskLevel: "LOW" },
    transport: { invoke: async () => ({ status: 200, body: structuredClone(ASDA_REGRESSION) }) },
  });
  const sourceNames = ["Alex Example", "Blair Example", "Casey Example"];
  const facts = session.candidateSources[0].candidateFacts.filter(({ subject }) => sourceNames.includes(subject.name));
  assert.equal(facts.length, 3);
  facts.forEach((fact) => {
    assert.equal(fact.relationship, "VOTING_RIGHTS");
    assert.deepEqual(fact.measurement, { type: "RANGE", lowerBound: 25, upperBound: 50, lowerInclusive: false, upperInclusive: true });
    assert.equal(fact.qualifiers.currentState, "CURRENT");
    assert.equal(fact.evidenceReferences.length, 1);
    const target = session.decisionTargets.candidateClaims.find(({ originatingCandidateFact }) => originatingCandidateFact.candidateFactId === fact.factId);
    assert.equal(target.relationship, "VOTING_RIGHTS");
    assert.equal(target.currentState, "CANDIDATE");
  });

  session = reviewAll(session);
  const view = session.snapshots.at(-1).view;
  const content = view.snapshot.decisionContent;
  const people = content.reasoning.canonicalEntities.filter(({ category }) => category === "NATURAL_PERSON");
  assert.equal(people.length, 3);
  people.forEach((person) => {
    const operative = content.reasoning.operativeClaims.find(({ subject }) => subject.party.name === person.primaryName);
    assert.equal(operative.relationship, "VOTING_RIGHTS");
    assert.equal(operative.status, "OPERATIVE");
    assert.deepEqual(operative.measurement, { type: "RANGE", lowerBound: 25, upperBound: 50, lowerInclusive: false, upperInclusive: true });
    const canonical = content.reasoning.graph.relationships.filter(({ subjectEntityId }) => subjectEntityId === person.entityId);
    assert.deepEqual(canonical.map(({ relationshipType, dimension, measurement }) => ({ relationshipType, dimension, measurement })), [{
      relationshipType: "VOTING_RIGHTS",
      dimension: GRAPH_DIMENSION.VOTING,
      measurement: { type: "RANGE", lowerBound: 25, upperBound: 50, lowerInclusive: false, upperInclusive: true },
    }]);
    const projected = view.graph.relationships.filter(({ sourceEntityId }) => sourceEntityId === person.entityId);
    assert.deepEqual(projected.map(({ relationshipType, dimension, measurement }) => ({ relationshipType, dimension, measurement })), [{
      relationshipType: "VOTING_RIGHTS",
      dimension: GRAPH_DIMENSION.VOTING,
      measurement: { type: "RANGE", lowerBound: 25, upperBound: 50, lowerInclusive: false, upperInclusive: true },
    }]);

    const economic = calculateEffectivePercentage(content.reasoning.graph, {
      subjectEntityId: person.entityId,
      targetEntityId: session.caseContext.subjectEntityId,
      dimension: GRAPH_DIMENSION.ECONOMIC,
    });
    assert.equal(economic.calculationAlgorithm, "ubo-percentage-lookthrough-v1");
    assert.equal(economic.status, CALCULATION_STATUS.NO_PATH);
    assert.deepEqual(economic.knownPaths, []);
    assert.equal(Object.hasOwn(economic, "aggregateKnownValue"), false);
    assert.equal(view.graph.qualifications.some(({ entityId }) => entityId === person.entityId), false);
  });
});

test("ASDA product snapshot keeps qualification, dimensions, unresolved inspection and planner state consistent", async () => {
  const body = structuredClone(ASDA_REGRESSION);
  body.ownershipGraph.edges.forEach((edge) => { if (edge.metadata) delete edge.metadata.currentState; });
  let session = await startLive({
    companyContext: { legalEntityName: "Example Delivery Customer Ltd", registrationNumber: "99000001", jurisdiction: "GB", entityProfile: "COMPANY", riskLevel: "LOW" },
    transport: { invoke: async () => ({ status: 200, body }) },
  });
  session = reviewAll(session);
  const view = session.snapshots.at(-1).view;
  const people = view.graph.nodes.filter(({ category }) => category === "NATURAL_PERSON");
  assert.equal(people.length, 3);
  assert.equal(view.graph.qualifications.length, 0, "natural-person nodes must not become qualifying people without G2.3 output");
  people.forEach((person) => {
    const relationships = view.graph.relationships.filter(({ sourceEntityId }) => sourceEntityId === person.entityId);
    assert.deepEqual(relationships.map(({ relationshipType }) => relationshipType), ["VOTING_RIGHTS"]);
    assert.deepEqual(relationships[0].measurement, { type: "RANGE", lowerBound: 25, upperBound: 50, lowerInclusive: false, upperInclusive: true });
    assert.equal(view.graph.relationships.some(({ sourceEntityId, relationshipType }) => sourceEntityId === person.entityId && relationshipType === "ECONOMIC_OWNERSHIP"), false);
  });
  assert.equal(view.graph.unresolved.length, 35);
  assert.equal(view.graph.unresolved.every(({ requirementIds }) => requirementIds.length > 0), true);
  const unresolvedByRequirement = Object.fromEntries(["UBO-R01", "UBO-R02", "UBO-R03", "UBO-R04", "UBO-R05", "UBO-R06", "UBO-R07", "UBO-R08", "UBO-R09", "UBO-R10", "UBO-R11", "UBO-R12", "UBO-R13", "UBO-R14"]
    .map((requirementId) => [requirementId, view.graph.unresolved.filter(({ requirementIds }) => requirementIds.includes(requirementId)).length]));
  assert.deepEqual(unresolvedByRequirement, {
    "UBO-R01": 16, "UBO-R02": 0, "UBO-R03": 0, "UBO-R04": 14, "UBO-R05": 1, "UBO-R06": 1, "UBO-R07": 0,
    "UBO-R08": 1, "UBO-R09": 0, "UBO-R10": 0, "UBO-R11": 1, "UBO-R12": 1, "UBO-R13": 0, "UBO-R14": 0,
  });
  assert.equal(view.graph.unresolved.reduce((sum, item) => sum + item.requirementIds.length, 0), 35);
  assert.equal(view.plan.state, "CUSTOMER_RESOLUTION", "completed Discovery must not be recommended again as an untried system wave");
  assert.deepEqual(view.resolutionExplanation, {
    ...view.resolutionExplanation,
    openInformationNeeds: 20,
    currentResolutionOptions: 57,
    currentWave: { state: "CUSTOMER_RESOLUTION", actor: "CUSTOMER", actionCount: 18 },
    systemActionsRemaining: 0,
    customerResolvableNeeds: 18,
    internalReviewNeeds: 0,
    internalReviewActions: 1,
    policyContentBlockedNeeds: 2,
    noCustomerAction: false,
    explanationCode: "CUSTOMER_RESOLUTION_NOW_AVAILABLE",
  });
  assert.equal(view.plan.recommendedWave.customerBundles.length, 9);
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

test("browser product exposes disabled Evidence, feedback export and Lab-only local Discovery replay", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "browser", "lab.js"), "utf8");
  const html = fs.readFileSync(path.join(__dirname, "..", "browser", "index.html"), "utf8");
  const replayStore = fs.readFileSync(path.join(__dirname, "..", "browser", "replayStore.js"), "utf8");
  assert.match(source, /NOT YET AVAILABLE — EVIDENCE PLATFORM INTEGRATION IN PROGRESS/);
  assert.match(source, /navigator\.clipboard\.writeText/);
  assert.match(source, /ubo-control-lab-feedback-v1/);
  assert.match(source, /snapshotHash/);
  assert.match(source, /Replay saved result/);
  assert.match(source, /Run fresh live Discovery/);
  assert.match(source, /Saved locally in this browser — Lab testing only/);
  assert.match(source, /START_REPLAY/);
  const customerPanelSource = source.slice(source.indexOf("function CustomerPanel"), source.indexOf("function Requirements"));
  assert.equal((customerPanelSource.match(/h\(UboJourney/g) || []).length, 1);
  assert.equal((customerPanelSource.match(/h\(OwnershipGraph/g) || []).length, 0, "Customer workspace must not render a duplicate graph below UboJourney");
  assert.match(source + html + replayStore, /localStorage|discovery-replays\.v1/);
  assert.doesNotMatch(source + html + replayStore, /api\/research|type=["']file|indexedDB|entity_dossiers|journey_state/i);
});

test("Lab production imports stay on public UBO and accepted integration boundaries", () => {
  const server = fs.readFileSync(path.join(__dirname, "..", "server", "labEngine.js"), "utf8");
  assert.match(server, /require\("\.\.\/\.\.\/ubo-control"\)/);
  assert.match(server, /legacy-discovery/);
  assert.doesNotMatch(server, /ubo-control\/(domain|application|projection|planning)\//);
  assert.doesNotMatch(server, /src\/App|entity_dossiers|journey_state|db\/|api\/research/);
});
