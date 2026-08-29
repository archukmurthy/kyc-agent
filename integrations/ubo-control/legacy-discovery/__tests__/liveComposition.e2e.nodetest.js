"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  CAPABILITY_CONTRACT_VERSION,
  DECISION_APPLICATION_CONTRACT_VERSION,
} = require("../../../../ubo-control");
const { createLegacyDiscoveryComposition } = require("..");
const { edge, node, response, source } = require("../test-support/legacyResponseFixtures");

const POLICY = require("../../../../ubo-control/policies/uk-corporate/1.4-rc/policy.json");
const CASE_ID = "g32-e2e-case";
const REQUEST_ID = "g32-e2e-discovery";
const OPERATION_ID = "g32-e2e-operation";
const T0 = "2026-08-29T12:00:00.000Z";
const T1 = "2026-08-29T12:01:00.000Z";
const T2 = "2026-08-29T12:02:00.000Z";

function discoveryRequest() {
  return {
    contractVersion: CAPABILITY_CONTRACT_VERSION,
    requestId: REQUEST_ID,
    caseId: CASE_ID,
    informationNeeds: [{ needId: "ownership", concepts: ["CURRENT_OWNERSHIP_AND_CONTROL"] }],
    subject: {
      entityId: "entity-customer",
      name: "Example Customer Ltd",
      entityType: "COMPANY",
      jurisdiction: "GB",
      externalIdentifiers: [{ namespace: "GB_COMPANIES_HOUSE", value: "01234567" }],
    },
  };
}

function factId(sourceIndex, descriptorIndex = 0) {
  return `${REQUEST_ID}:legacy-source:${sourceIndex}:${descriptorIndex}`;
}

function claimId(sourceIndex, descriptorIndex = 0) {
  return `${CASE_ID}:claim:${OPERATION_ID}:${factId(sourceIndex, descriptorIndex)}`;
}

function partyKey(sourceIndex, endpoint, descriptorIndex = 0) {
  return `${claimId(sourceIndex, descriptorIndex)}:${endpoint.toLowerCase()}`;
}

function compositionFor(body, { status = 200, transportError } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (transportError) throw transportError;
    return { status, async text() { return JSON.stringify(body); } };
  };
  return {
    composition: createLegacyDiscoveryComposition({
      baseUrl: "https://configured-legacy.example",
      policyPack: POLICY,
      fetchImpl,
    }),
    calls,
  };
}

function entity(entityId, category, primaryName) {
  return {
    entityId,
    category,
    primaryName,
    aliases: [],
    externalIdentifiers: [],
    jurisdiction: "GB",
    entityTypeMetadata: {},
    recordedAt: T2,
  };
}

async function runFreshFlow(body, plan, transportOptions = {}) {
  const { composition, calls } = compositionFor(body, transportOptions);
  const capabilityResult = await composition.discoveryService.discover(discoveryRequest());
  const intake = composition.decisionApplication.intake({
    contractVersion: DECISION_APPLICATION_CONTRACT_VERSION,
    caseInput: {
      caseId: CASE_ID,
      subjectReference: discoveryRequest().subject,
      externalReferences: [{ system: "g32-e2e", referenceId: CASE_ID }],
      createdAt: T0,
    },
    capabilityResult,
    operationId: OPERATION_ID,
    recordedAt: T1,
  });

  const identityDecisions = intake.decisionTargets.candidateParties.map((target, index) => {
    const decision = plan.identityDecisions[target.candidatePartyKey];
    assert.ok(decision, `fixture must explicitly decide ${target.candidatePartyKey}`);
    return {
      decisionId: `g32-identity-${index + 1}`,
      candidatePartyKey: target.candidatePartyKey,
      status: decision.status,
      ...(decision.entityId ? { entityId: decision.entityId } : {}),
      basisReasonCodes: ["EXPLICIT_CONTROLLED_HARNESS_DECISION"],
      evidenceReferences: [],
      decidedAt: T2,
      decisionOrigin: "G3_2_CONTROLLED_HARNESS",
      decisionActor: "deterministic-e2e",
    };
  });
  const claimAdjudications = intake.decisionTargets.candidateClaims.map((target, index) => {
    const resultingState = plan.claimDecisions[target.claimId];
    assert.ok(resultingState, `fixture must explicitly decide ${target.claimId}`);
    return {
      decisionId: `g32-claim-${index + 1}`,
      claimId: target.claimId,
      previousState: "CANDIDATE",
      resultingState,
      reasonBasisCode: "EXPLICIT_CONTROLLED_HARNESS_DECISION",
      supportingEvidenceReferences: [],
      decisionOrigin: "G3_2_CONTROLLED_HARNESS",
      decisionActor: "deterministic-e2e",
      decidedAt: T2,
      supersededByClaimIds: [],
      adversarialClaimIds: [],
    };
  });
  const applied = composition.decisionApplication.applyDecisions({
    contractVersion: DECISION_APPLICATION_CONTRACT_VERSION,
    caseState: intake.caseState,
    entityRegistrations: plan.entityRegistrations,
    identityDecisions,
    claimAdjudications,
  });
  const evaluation = composition.decisionApplication.evaluate({
    contractVersion: DECISION_APPLICATION_CONTRACT_VERSION,
    caseState: applied.caseState,
    caseContext: {
      entityType: "private_limited_company",
      subjectEntityId: "entity-customer",
      jurisdiction: "GB",
      riskLevel: "LOW",
    },
    evaluationTime: T2,
    checkpoint: "CASE_OPEN",
    checkpointReference: { referenceId: `${CASE_ID}:controlled-e2e` },
    resolutionInputs: {},
  });
  return { capabilityResult, intake, applied, evaluation, calls };
}

function directBody(overrides = {}) {
  return response({
    edges: [edge("direct", "legacy-owner-node", "legacy-root-node", {
      ownershipPercentage: 40,
      metadata: { naturesOfControl: ["ownership-of-shares"], currentState: "CURRENT" },
    })],
    ...overrides,
  });
}

function directPlan() {
  return {
    entityRegistrations: [
      entity("entity-customer", "LEGAL_ENTITY", "Example Customer Ltd"),
      entity("entity-alice", "NATURAL_PERSON", "Alice Owner"),
    ],
    identityDecisions: {
      [partyKey(0, "subject")]: { status: "RESOLVED", entityId: "entity-alice" },
      [partyKey(0, "object")]: { status: "RESOLVED", entityId: "entity-customer" },
    },
    claimDecisions: { [claimId(0)]: "OPERATIVE" },
  };
}

test("E2E-D1 direct exact facts produce only a fresh graph, calculation, policy result, and DecisionSnapshot", async () => {
  const result = await runFreshFlow(directBody(), directPlan());
  assert.equal(result.capabilityResult.outcome.state, "PARTIAL");
  assert.equal(result.capabilityResult.candidateFacts[0].qualifiers.economicInterestConcept, "SHARE_OWNERSHIP");
  const content = result.evaluation.decisionSnapshot.decisionContent;
  assert.equal(content.algorithms.graphAlgorithm, "ubo-graph-v1");
  assert.deepEqual(content.algorithms.percentageCalculationAlgorithms, ["ubo-percentage-lookthrough-v1"]);
  assert.match(content.reasoning.graph.graphVersion, /^ubo-graph-v1:[a-f0-9]{64}$/);
  assert.equal(content.reasoning.calculations.find(({ dimension }) => dimension === "ECONOMIC").aggregateKnownValue.value, "40");
  assert.deepEqual(content.decision.qualifyingPersons.map(({ entityId }) => entityId), ["entity-alice"]);
  assert.equal(JSON.stringify(content).includes("legacy-effective-ownership"), false);
  assert.equal(result.calls[0].url, "https://configured-legacy.example/api/ubo-discovery");
});

test("E2E-D2 multilayer source assertions produce fresh 60% × 50% = 30% arithmetic", async () => {
  const body = response({
    nodes: [
      node("legacy-root-node", "Example Customer Ltd", "company", { registrationNumber: "01234567" }),
      node("legacy-holdco", "HoldCo Ltd", "company", { registrationNumber: "09876543" }),
      node("legacy-person", "Bob Owner", "individual"),
    ],
    edges: [
      edge("holdco-customer", "legacy-holdco", "legacy-root-node", { ownershipPercentage: 60, metadata: { naturesOfControl: ["ownership-of-shares"], currentState: "CURRENT" } }),
      edge("person-holdco", "legacy-person", "legacy-holdco", { ownershipPercentage: 50, metadata: { naturesOfControl: ["ownership-of-shares"], currentState: "CURRENT" } }),
    ],
  });
  const plan = {
    entityRegistrations: [
      entity("entity-customer", "LEGAL_ENTITY", "Example Customer Ltd"),
      entity("entity-holdco", "LEGAL_ENTITY", "HoldCo Ltd"),
      entity("entity-bob", "NATURAL_PERSON", "Bob Owner"),
    ],
    identityDecisions: {
      [partyKey(0, "subject")]: { status: "RESOLVED", entityId: "entity-holdco" },
      [partyKey(0, "object")]: { status: "RESOLVED", entityId: "entity-customer" },
      [partyKey(1, "subject")]: { status: "RESOLVED", entityId: "entity-bob" },
      [partyKey(1, "object")]: { status: "RESOLVED", entityId: "entity-holdco" },
    },
    claimDecisions: { [claimId(0)]: "OPERATIVE", [claimId(1)]: "OPERATIVE" },
  };
  const { evaluation } = await runFreshFlow(body, plan);
  const calculation = evaluation.decisionSnapshot.decisionContent.reasoning.calculations
    .find(({ subjectEntityId, dimension }) => subjectEntityId === "entity-bob" && dimension === "ECONOMIC");
  assert.equal(calculation.aggregateKnownValue.value, "30");
  assert.equal(calculation.knownPaths[0].contribution.value, "30");
  assert.deepEqual(evaluation.decisionSnapshot.decisionContent.decision.qualifyingPersons.map(({ entityId }) => entityId), ["entity-bob"]);
});

test("E2E-D3 explicit unresolved identity and provisional claim preserve PARTIAL uncertainty and fabricate no owner", async () => {
  const body = directBody();
  const plan = directPlan();
  plan.entityRegistrations = plan.entityRegistrations.filter(({ entityId }) => entityId !== "entity-alice");
  plan.identityDecisions[partyKey(0, "subject")] = { status: "UNRESOLVED" };
  plan.claimDecisions[claimId(0)] = "PROVISIONAL";
  const { capabilityResult, evaluation } = await runFreshFlow(body, plan);
  const decision = evaluation.decisionSnapshot.decisionContent.decision;
  assert.equal(capabilityResult.outcome.state, "PARTIAL");
  assert.deepEqual(decision.qualifyingPersons, []);
  assert.ok(decision.informationNeeds.length > 0);
  assert.notEqual(decision.terminal.status, "RESOLVED");
});

test("E2E-D4 voting facts remain separate from economic ownership and produce a voting basis only", async () => {
  const body = response({
    edges: [edge("voting", "legacy-owner-node", "legacy-root-node", {
      ownershipPercentage: 60,
      metadata: { naturesOfControl: ["voting-rights"], currentState: "CURRENT" },
    })],
  });
  const { capabilityResult, evaluation } = await runFreshFlow(body, directPlan());
  assert.deepEqual(capabilityResult.candidateFacts.map(({ relationship }) => relationship), ["VOTING_RIGHTS"]);
  const decision = evaluation.decisionSnapshot.decisionContent.decision;
  assert.deepEqual(decision.qualifyingPersons[0].roles, ["controller_voting"]);
  assert.equal(decision.basisAssessments.some(({ basisType, state }) => basisType === "ECONOMIC_INTEREST" && state === "SATISFIED"), false);
  assert.ok(decision.basisAssessments.some(({ basisType, state }) => basisType === "VOTING_CONTROL" && state === "SATISFIED"));
});

test("legacy final-UBO pollution cannot change fresh snapshot semantics", async () => {
  const firstBody = directBody({ ubos: [{ personId: "legacy-owner-node", final: true, effectiveOwnership: 40 }] });
  const secondBody = directBody({ ubos: [{ personId: "different", final: true, effectiveOwnership: 100 }], threshold: 99 });
  const first = await runFreshFlow(firstBody, directPlan());
  const second = await runFreshFlow(secondBody, directPlan());
  assert.deepEqual(second.capabilityResult, first.capabilityResult);
  assert.deepEqual(second.evaluation, first.evaluation);
});

test("unavailable, malformed, NO_DATA, and PARTIAL paths remain valid without false UBO conclusions", async (t) => {
  const cases = [
    ["unavailable", response(), { transportError: Object.assign(new Error("offline"), { code: "ECONNREFUSED" }) }, "UNAVAILABLE"],
    ["malformed", { status: "resolved", ubos: [] }, {}, "FAILED"],
    ["no-data", response({ edges: [], evidence: [] }), {}, "NO_DATA"],
  ];
  for (const [name, body, options, expectedOutcome] of cases) {
    await t.test(name, async () => {
      const plan = {
        entityRegistrations: [entity("entity-customer", "LEGAL_ENTITY", "Example Customer Ltd")],
        identityDecisions: {},
        claimDecisions: {},
      };
      const { capabilityResult, evaluation } = await runFreshFlow(body, plan, options);
      assert.equal(capabilityResult.outcome.state, expectedOutcome);
      assert.deepEqual(evaluation.decisionSnapshot.decisionContent.decision.qualifyingPersons, []);
    });
  }
  const partial = await runFreshFlow(directBody(), directPlan());
  assert.equal(partial.capabilityResult.outcome.state, "PARTIAL");
});
