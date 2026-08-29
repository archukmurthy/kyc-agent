"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  CAPABILITY_CONTRACT_VERSION,
  CAPABILITY_OUTCOME_STATE,
  CANDIDATE_FACT_TYPE,
  CLAIM_STATE,
  IDENTITY_RESOLUTION_STATUS,
  PERCENTAGE_VALUE_TYPE,
  RELATIONSHIP_TYPE,
} = require("../contracts/constants");
const { canonicalizeJson } = require("../policy/canonicalJson");
const { CANONICAL_ENTITY_CATEGORY } = require("../domain/canonicalEntity");
const {
  addCanonicalEntity,
  adjudicateClaim,
  createOwnershipCase,
  intakeCapabilityResult,
  recordIdentityResolutionDecision,
} = require("../domain/ownershipCase");
const {
  GRAPH_ALGORITHM,
  GRAPH_DIMENSION,
  GRAPH_ERROR_CODE,
  OwnershipGraphDomainError,
  TEMPORAL_STATE,
  buildCanonicalOwnershipGraph,
} = require("../domain/ownershipGraph");
const {
  CALCULATION_ALGORITHM,
  CALCULATION_STATUS,
  calculateEffectivePercentage,
} = require("../domain/percentageCalculation");
const { coreScenarios } = require("../test-support/scenarioCorpus");

const NOW = "2026-08-29T10:00:00.000Z";

function exact(value) {
  return { type: PERCENTAGE_VALUE_TYPE.EXACT, value };
}

function range(lowerBound, upperBound, lowerInclusive = true, upperInclusive = true) {
  return { type: PERCENTAGE_VALUE_TYPE.RANGE, lowerBound, upperBound, lowerInclusive, upperInclusive };
}

function unknown(reason = "not established") {
  return { type: PERCENTAGE_VALUE_TYPE.UNKNOWN, reason };
}

function edge(id, subject, object, measurement, options = {}) {
  return {
    id,
    subject,
    object,
    relationship: options.relationship || RELATIONSHIP_TYPE.ECONOMIC_OWNERSHIP,
    measurement,
    qualifiers: options.qualifiers === undefined ? { currentState: "CURRENT" } : options.qualifiers,
  };
}

function party(entityId) {
  return { name: entityId, entityType: "COMPANY", entityId, externalIdentifiers: [] };
}

function categoryFor(entityId) {
  return entityId.startsWith("person-")
    ? CANONICAL_ENTITY_CATEGORY.NATURAL_PERSON
    : CANONICAL_ENTITY_CATEGORY.LEGAL_ENTITY;
}

function buildOperativeCase(edges, {
  caseId = "g22-case",
  entityOrder,
  factOrder,
} = {}) {
  const entityIds = [...new Set(edges.flatMap(({ subject, object }) => [subject, object]))];
  const orderedEntityIds = entityOrder || entityIds;
  let caseState = createOwnershipCase({
    caseId,
    subjectReference: party(edges[0].object),
    externalReferences: [{ system: "g22-test", referenceId: caseId }],
    createdAt: NOW,
  });
  orderedEntityIds.forEach((entityId) => {
    caseState = addCanonicalEntity(caseState, {
      entityId,
      category: categoryFor(entityId),
      primaryName: entityId,
      aliases: [],
      externalIdentifiers: [],
      entityTypeMetadata: {},
    }, { recordedAt: NOW });
  });
  const orderedEdges = factOrder || edges;
  const candidateFacts = orderedEdges.map((item) => {
    const fact = {
      factId: item.id,
      type: CANDIDATE_FACT_TYPE.RELATIONSHIP,
      subject: party(item.subject),
      relationship: item.relationship,
      object: party(item.object),
      evidenceReferences: [],
    };
    if (item.measurement !== undefined) fact.measurement = item.measurement;
    if (item.qualifiers !== undefined) fact.qualifiers = item.qualifiers;
    return fact;
  });
  caseState = intakeCapabilityResult(caseState, {
    contractVersion: CAPABILITY_CONTRACT_VERSION,
    requestId: `${caseId}-request`,
    outcome: { state: CAPABILITY_OUTCOME_STATE.COMPLETE },
    candidateFacts,
    operationEvidenceReferences: [],
    issues: [],
  }, { operationId: `${caseId}-operation`, recordedAt: NOW });

  caseState.candidateClaims.forEach((claim) => {
    for (const [endpointName, endpoint] of [["subject", claim.subject], ["object", claim.object]]) {
      caseState = recordIdentityResolutionDecision(caseState, {
        decisionId: `${claim.claimId}:${endpointName}:identity`,
        candidatePartyKey: endpoint.candidatePartyKey,
        status: IDENTITY_RESOLUTION_STATUS.RESOLVED,
        entityId: endpoint.party.entityId,
        basisReasonCodes: ["G2_2_FIXTURE"],
        evidenceReferences: [],
        decidedAt: NOW,
        decisionOrigin: "G2_2_TEST",
      });
    }
    caseState = adjudicateClaim(caseState, {
      decisionId: `${claim.claimId}:operative`,
      claimId: claim.claimId,
      previousState: CLAIM_STATE.CANDIDATE,
      resultingState: CLAIM_STATE.OPERATIVE,
      reasonBasisCode: "G2_2_FIXTURE",
      supportingEvidenceReferences: [],
      decisionOrigin: "G2_2_TEST",
      decidedAt: NOW,
      supersededByClaimIds: [],
      adversarialClaimIds: [],
    });
  });
  return caseState;
}

function graphFor(edges, options) {
  return buildCanonicalOwnershipGraph(buildOperativeCase(edges, options));
}

function economic(graph, subjectEntityId, targetEntityId) {
  return calculateEffectivePercentage(graph, {
    subjectEntityId,
    targetEntityId,
    dimension: GRAPH_DIMENSION.ECONOMIC,
  });
}

test("direct exact interest builds an immutable revision-pinned graph and calculates 40%", () => {
  const caseState = buildOperativeCase([edge("direct-40", "person-alice", "customer", exact(40))]);
  const graph = buildCanonicalOwnershipGraph(caseState);
  const result = economic(graph, "person-alice", "customer");
  assert.equal(graph.graphAlgorithm, GRAPH_ALGORITHM);
  assert.match(graph.graphVersion, /^ubo-graph-v1:[a-f0-9]{64}$/);
  assert.deepEqual(graph.sourceCase, {
    caseId: caseState.caseId,
    revision: caseState.revision,
    revisionId: caseState.revisionId,
  });
  assert.equal(graph.relationships[0].subjectEntityId, "person-alice");
  assert.equal(graph.relationships[0].objectEntityId, "customer");
  assert.equal(Object.isFrozen(graph), true);
  assert.equal(Object.isFrozen(graph.relationships), true);
  assert.equal(result.calculationAlgorithm, CALCULATION_ALGORITHM);
  assert.equal(result.status, CALCULATION_STATUS.COMPLETE);
  assert.deepEqual(result.aggregateKnownValue, { type: "EXACT", value: "40" });
  assert.equal(Object.prototype.hasOwnProperty.call(result, "qualifies"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result, "isUbo"), false);
});

test("multi-layer and deeper chains multiply every edge exactly", () => {
  const multiLayer = graphFor([
    edge("alice-holdco", "person-alice", "holdco", exact(60)),
    edge("holdco-customer", "holdco", "customer", exact(70)),
  ]);
  const deeper = graphFor([
    edge("bob-topco", "person-bob", "topco", exact(80)),
    edge("topco-midco", "topco", "midco", exact(50)),
    edge("midco-customer", "midco", "customer", exact(40)),
  ], { caseId: "deeper-case" });
  assert.deepEqual(economic(multiLayer, "person-alice", "customer").aggregateKnownValue, { type: "EXACT", value: "42" });
  assert.deepEqual(economic(deeper, "person-bob", "customer").aggregateKnownValue, { type: "EXACT", value: "16" });
});

test("multiple independent paths aggregate and may share a downstream edge", () => {
  const graph = graphFor([
    edge("alice-a", "person-alice", "a", exact(60)),
    edge("a-customer", "a", "customer", exact(30)),
    edge("alice-b", "person-alice", "b", exact(60)),
    edge("b-customer", "b", "customer", exact(20)),
    edge("alice-x", "person-alice", "x", exact(10)),
    edge("alice-y", "person-alice", "y", exact(20)),
    edge("x-mid", "x", "mid", exact(50)),
    edge("y-mid", "y", "mid", exact(50)),
    edge("mid-shared", "mid", "shared-customer", exact(50)),
  ]);
  const separate = economic(graph, "person-alice", "customer");
  assert.equal(separate.knownPaths.length, 2);
  assert.deepEqual(separate.aggregateKnownValue, { type: "EXACT", value: "30" });
  const shared = economic(graph, "person-alice", "shared-customer");
  assert.equal(shared.knownPaths.length, 2);
  assert.deepEqual(shared.aggregateKnownValue, { type: "EXACT", value: "7.5" });
});

test("duplicate corroborating operative claims coalesce without doubling", () => {
  const graph = graphFor([
    edge("registry-40", "person-alice", "customer", exact(40)),
    edge("register-40", "person-alice", "customer", exact(40)),
  ]);
  assert.equal(graph.relationships.length, 1);
  assert.equal(graph.relationships[0].supportingClaimIds.length, 2);
  assert.deepEqual(economic(graph, "person-alice", "customer").aggregateKnownValue, { type: "EXACT", value: "40" });
});

test("explicitly distinguished parallel interests remain separate paths", () => {
  const graph = graphFor([
    edge("class-a", "person-alice", "customer", exact(10), {
      qualifiers: { currentState: "CURRENT", interestId: "CLASS_A" },
    }),
    edge("class-b", "person-alice", "customer", exact(20), {
      qualifiers: { currentState: "CURRENT", interestId: "CLASS_B" },
    }),
  ]);
  const result = economic(graph, "person-alice", "customer");
  assert.equal(graph.relationships.length, 2);
  assert.equal(result.knownPaths.length, 2);
  assert.deepEqual(result.aggregateKnownValue, { type: "EXACT", value: "30" });
});

test("incompatible operative values in one undistinguished slot fail before arithmetic", () => {
  assert.throws(
    () => graphFor([
      edge("source-a", "person-alice", "customer", exact(20)),
      edge("source-b", "person-alice", "customer", exact(35)),
    ]),
    (error) => error instanceof OwnershipGraphDomainError
      && error.code === GRAPH_ERROR_CODE.CONFLICTING_OPERATIVE_CLAIMS
      && error.details.claimIds.length === 2,
  );
});

test("range multiplication preserves bounds, open endpoints, and zero attainability", () => {
  const graph = graphFor([
    edge("range-a", "person-alice", "holdco", range(50, 80, false, true)),
    edge("range-b", "holdco", "customer", range(20, 60, true, false)),
    edge("zero-a", "person-zero", "zero-holdco", range(0, 50, true, false)),
    edge("zero-b", "zero-holdco", "zero-customer", range(20, 40, false, false)),
  ]);
  assert.deepEqual(economic(graph, "person-alice", "customer").aggregateKnownValue, {
    type: "RANGE", lowerBound: "10", upperBound: "48", lowerInclusive: false, upperInclusive: false,
  });
  assert.deepEqual(economic(graph, "person-zero", "zero-customer").aggregateKnownValue, {
    type: "RANGE", lowerBound: "0", upperBound: "20", lowerInclusive: true, upperInclusive: false,
  });
  const zeroProduct = graphFor([
    edge("exact-zero", "person-zero", "zero-mid", exact(0)),
    edge("open-factor", "zero-mid", "zero-target", range(20, 40, false, false)),
  ], { caseId: "zero-product-case" });
  assert.deepEqual(economic(zeroProduct, "person-zero", "zero-target").aggregateKnownValue, {
    type: "EXACT", value: "0",
  });
});

test("range aggregation preserves interval semantics and caps the universal domain at 100%", () => {
  const graph = graphFor([
    edge("a", "person-alice", "customer", range(10, 70, true, false), { qualifiers: { currentState: "CURRENT", interestId: "A" } }),
    edge("b", "person-alice", "customer", range(15, 50, false, true), { qualifiers: { currentState: "CURRENT", interestId: "B" } }),
  ]);
  assert.deepEqual(economic(graph, "person-alice", "customer").aggregateKnownValue, {
    type: "RANGE", lowerBound: "25", upperBound: "100", lowerInclusive: false, upperInclusive: true,
  });
});

test("threshold-straddling ranges remain arithmetic facts with no qualification conclusion", () => {
  const result = economic(graphFor([
    edge("straddle", "person-alice", "customer", range(20, 30, true, true)),
  ]), "person-alice", "customer");
  assert.deepEqual(result.aggregateKnownValue, {
    type: "RANGE", lowerBound: "20", upperBound: "30", lowerInclusive: true, upperInclusive: true,
  });
  assert.equal(Object.keys(result).some((key) => /qualif|threshold|ubo|psc/i.test(key)), false);
});

test("UNKNOWN paths retain known contributions but cannot produce COMPLETE", () => {
  const graph = graphFor([
    edge("known", "person-alice", "customer", exact(12), { qualifiers: { currentState: "CURRENT", interestId: "KNOWN" } }),
    edge("unknown", "person-alice", "customer", unknown(), { qualifiers: { currentState: "CURRENT", interestId: "UNKNOWN" } }),
  ]);
  const result = economic(graph, "person-alice", "customer");
  assert.equal(result.status, CALCULATION_STATUS.PARTIAL);
  assert.deepEqual(result.aggregateKnownValue, { type: "EXACT", value: "12" });
  assert.equal(result.unresolvedPaths.length, 1);
  assert.deepEqual(result.unresolvedPaths[0].reasons, ["UNKNOWN_PERCENTAGE"]);
  const unresolvedOnly = economic(graphFor([
    edge("only-unknown", "person-bob", "unknown-target", unknown()),
  ], { caseId: "unresolved-only-case" }), "person-bob", "unknown-target");
  assert.equal(unresolvedOnly.status, CALCULATION_STATUS.UNRESOLVED);
  assert.equal(Object.prototype.hasOwnProperty.call(unresolvedOnly, "aggregateKnownValue"), false);
});

test("an UNKNOWN edge outside the relevant subject-target subgraph has no effect", () => {
  const graph = graphFor([
    edge("known", "person-alice", "customer", exact(25)),
    edge("unrelated-unknown", "person-bob", "other-company", unknown()),
  ]);
  const result = economic(graph, "person-alice", "customer");
  assert.equal(result.status, CALCULATION_STATUS.COMPLETE);
  assert.deepEqual(result.aggregateKnownValue, { type: "EXACT", value: "25" });
  assert.equal(result.unresolvedPaths.length, 0);
});

test("NO_PATH is distinct from an exact zero path", () => {
  const graph = graphFor([
    edge("zero", "person-alice", "customer", exact(0)),
    edge("other", "person-bob", "other-company", exact(30)),
  ]);
  const zero = economic(graph, "person-alice", "customer");
  const absent = economic(graph, "person-bob", "customer");
  assert.equal(zero.status, CALCULATION_STATUS.COMPLETE);
  assert.deepEqual(zero.aggregateKnownValue, { type: "EXACT", value: "0" });
  assert.equal(absent.status, CALCULATION_STATUS.NO_PATH);
  assert.equal(Object.prototype.hasOwnProperty.call(absent, "aggregateKnownValue"), false);
});

test("a relevant cycle is recorded while an unrelated cycle does not affect calculation", () => {
  const graph = graphFor([
    edge("alice-a", "person-alice", "a", exact(50)),
    edge("a-alice", "a", "person-alice", exact(10)),
    edge("a-customer", "a", "customer", exact(40)),
    edge("x-y", "x", "y", exact(20)),
    edge("y-x", "y", "x", exact(20)),
    edge("d-other", "person-d", "other-customer", exact(30)),
  ]);
  const relevant = economic(graph, "person-alice", "customer");
  assert.equal(relevant.status, CALCULATION_STATUS.PARTIAL);
  assert.equal(relevant.cycles.length, 1);
  assert.deepEqual(relevant.aggregateKnownValue, { type: "EXACT", value: "20" });
  const unrelated = economic(graph, "person-d", "other-customer");
  assert.equal(unrelated.status, CALCULATION_STATUS.COMPLETE);
  assert.equal(unrelated.cycles.length, 0);
});

test("economic and voting calculations stay separate and mixed chains do not imply a path", () => {
  const graph = graphFor([
    edge("economic", "person-alice", "customer", exact(40)),
    edge("voting", "person-alice", "customer", exact(40), { relationship: RELATIONSHIP_TYPE.VOTING_RIGHTS }),
    edge("mixed-owner", "person-bob", "holdco", exact(60)),
    edge("mixed-vote", "holdco", "customer", exact(60), { relationship: RELATIONSHIP_TYPE.VOTING_RIGHTS }),
    edge("appointment", "person-carol", "customer", undefined, { relationship: RELATIONSHIP_TYPE.BOARD_APPOINTMENT_RIGHT }),
  ]);
  assert.deepEqual(economic(graph, "person-alice", "customer").aggregateKnownValue, { type: "EXACT", value: "40" });
  const voting = calculateEffectivePercentage(graph, {
    subjectEntityId: "person-alice", targetEntityId: "customer", dimension: GRAPH_DIMENSION.VOTING,
  });
  assert.deepEqual(voting.aggregateKnownValue, { type: "EXACT", value: "40" });
  assert.equal(economic(graph, "person-bob", "customer").status, CALCULATION_STATUS.NO_PATH);
  assert.equal(calculateEffectivePercentage(graph, {
    subjectEntityId: "person-bob", targetEntityId: "customer", dimension: GRAPH_DIMENSION.VOTING,
  }).status, CALCULATION_STATUS.NO_PATH);
  assert.equal(graph.relationships.some(({ relationshipType }) => relationshipType === RELATIONSHIP_TYPE.BOARD_APPOINTMENT_RIGHT), true);
});

test("impossible minimum totals above 100% produce a typed graph error", () => {
  assert.throws(
    () => graphFor([
      edge("owner-a", "person-a", "customer", range(60.1, 80), { qualifiers: { currentState: "CURRENT", interestId: "A" } }),
      edge("owner-b", "person-b", "customer", range(60.1, 90), { qualifiers: { currentState: "CURRENT", interestId: "B" } }),
    ]),
    (error) => error instanceof OwnershipGraphDomainError
      && error.code === GRAPH_ERROR_CODE.IMPOSSIBLE_MINIMUM_TOTAL,
  );
});

test("graph and calculation are deterministic across entity, fact, and object-key order", () => {
  const edges = [
    edge("first", "person-alice", "holdco", exact(60), { qualifiers: { currentState: "CURRENT", z: 2, a: 1 } }),
    edge("second", "holdco", "customer", exact(70)),
  ];
  const first = graphFor(edges, { caseId: "order-case" });
  const reorderedEdges = [
    { ...edges[1], qualifiers: { currentState: "CURRENT" } },
    { ...edges[0], qualifiers: { a: 1, z: 2, currentState: "CURRENT" } },
  ];
  const second = graphFor(edges, {
    caseId: "order-case",
    entityOrder: ["customer", "holdco", "person-alice"],
    factOrder: reorderedEdges,
  });
  assert.equal(first.graphVersion, second.graphVersion);
  assert.equal(canonicalizeJson(first.relationships), canonicalizeJson(second.relationships));
  assert.deepEqual(economic(first, "person-alice", "customer"), economic(second, "person-alice", "customer"));
  const changed = graphFor([edges[0], edge("second", "holdco", "customer", exact(71))], { caseId: "order-case" });
  assert.notEqual(first.graphVersion, changed.graphVersion);
});

test("exact decimal arithmetic never emits binary floating-point artifacts", () => {
  const graph = graphFor([
    edge("decimal-a", "person-alice", "customer", exact(0.1), { qualifiers: { currentState: "CURRENT", interestId: "A" } }),
    edge("decimal-b", "person-alice", "customer", exact(0.2), { qualifiers: { currentState: "CURRENT", interestId: "B" } }),
  ]);
  const result = economic(graph, "person-alice", "customer");
  assert.deepEqual(result.aggregateKnownValue, { type: "EXACT", value: "0.3" });
  assert.doesNotMatch(JSON.stringify(result), /0\.30000000000000004/);
});

test("current graphs retain temporal qualifiers, exclude ceased arithmetic, and surface unknown currentness", () => {
  const graph = graphFor([
    edge("current", "person-alice", "customer", exact(10), { qualifiers: { currentState: "CURRENT", interestId: "CURRENT" } }),
    edge("ceased", "person-alice", "customer", exact(20), { qualifiers: { currentState: "CEASED", ceasedAt: NOW, interestId: "CEASED" } }),
    edge("unknown-time", "person-alice", "customer", exact(30), { qualifiers: { interestId: "UNKNOWN" } }),
  ]);
  assert.deepEqual(graph.relationships.map(({ temporalState }) => temporalState).sort(), [
    TEMPORAL_STATE.CEASED, TEMPORAL_STATE.CURRENT, TEMPORAL_STATE.UNKNOWN,
  ]);
  const result = economic(graph, "person-alice", "customer");
  assert.equal(result.status, CALCULATION_STATUS.PARTIAL);
  assert.deepEqual(result.aggregateKnownValue, { type: "EXACT", value: "10" });
  assert.deepEqual(result.unresolvedPaths[0].reasons, ["UNKNOWN_TEMPORAL_STATE"]);
  assert.throws(
    () => graphFor([edge("contradictory", "person-bob", "customer", exact(10), {
      qualifiers: { currentState: "CURRENT", ceasedAt: NOW },
    })]),
    (error) => error.code === GRAPH_ERROR_CODE.CONTRADICTORY_TEMPORAL_STATE,
  );
});

function scenario(id) {
  return coreScenarios.find((item) => item.id === id);
}

function categoryForParty(candidate) {
  const type = String(candidate.entityType || "").toUpperCase();
  if (["INDIVIDUAL", "NATURAL_PERSON", "PERSON"].includes(type)) return CANONICAL_ENTITY_CATEGORY.NATURAL_PERSON;
  if (type.includes("TRUST")) return CANONICAL_ENTITY_CATEGORY.TRUST_OR_LEGAL_ARRANGEMENT;
  return CANONICAL_ENTITY_CATEGORY.LEGAL_ENTITY;
}

function operativeScenarioCase(scenarioId) {
  const fixture = scenario(scenarioId);
  const relationshipFacts = fixture.steps.flatMap(({ response }) => response.candidateFacts)
    .filter(({ type }) => type === CANDIDATE_FACT_TYPE.RELATIONSHIP);
  const partyKeys = new Map();
  const identityKeys = new Map();
  relationshipFacts.flatMap((fact) => [fact.subject, fact.object]).forEach((candidate) => {
    const key = canonicalizeJson(candidate);
    const identityKey = scenarioId === "S09" && candidate.name === "Alex Morgan"
      ? "S09-EXPLICITLY-RESOLVED-ALEX"
      : key;
    if (!identityKeys.has(identityKey)) identityKeys.set(identityKey, `scenario-entity-${identityKeys.size + 1}`);
    partyKeys.set(key, identityKeys.get(identityKey));
  });
  let caseState = createOwnershipCase({
    caseId: `scenario-${scenarioId.toLowerCase()}-case`,
    subjectReference: fixture.context.customer || relationshipFacts[0].object,
    externalReferences: [{ system: "scenario-corpus", referenceId: scenarioId }],
    createdAt: NOW,
  });
  const createdEntityIds = new Set();
  for (const [key, entityId] of partyKeys.entries()) {
    if (createdEntityIds.has(entityId)) continue;
    createdEntityIds.add(entityId);
    const candidate = JSON.parse(key);
    caseState = addCanonicalEntity(caseState, {
      entityId,
      category: categoryForParty(candidate),
      primaryName: candidate.name,
      aliases: [],
      externalIdentifiers: [],
      entityTypeMetadata: {},
    }, { recordedAt: NOW });
  }
  fixture.steps.forEach((step, index) => {
    caseState = intakeCapabilityResult(caseState, step.response, {
      operationId: `${scenarioId}-operation-${index + 1}`,
      recordedAt: NOW,
    });
  });
  caseState.candidateClaims.filter(({ claimType }) => claimType === CANDIDATE_FACT_TYPE.RELATIONSHIP).forEach((claim) => {
    for (const [label, endpoint] of [["subject", claim.subject], ["object", claim.object]]) {
      caseState = recordIdentityResolutionDecision(caseState, {
        decisionId: `${claim.claimId}:${label}:scenario-identity`,
        candidatePartyKey: endpoint.candidatePartyKey,
        status: IDENTITY_RESOLUTION_STATUS.RESOLVED,
        entityId: partyKeys.get(canonicalizeJson(endpoint.party)),
        basisReasonCodes: ["SCENARIO_FIXTURE"],
        evidenceReferences: [],
        decidedAt: NOW,
        decisionOrigin: "G2_2_SCENARIO_TEST",
      });
    }
    caseState = adjudicateClaim(caseState, {
      decisionId: `${claim.claimId}:scenario-operative`,
      claimId: claim.claimId,
      previousState: CLAIM_STATE.CANDIDATE,
      resultingState: CLAIM_STATE.OPERATIVE,
      reasonBasisCode: "SCENARIO_FIXTURE",
      supportingEvidenceReferences: [],
      decisionOrigin: "G2_2_SCENARIO_TEST",
      decidedAt: NOW,
      supersededByClaimIds: [],
      adversarialClaimIds: [],
    });
  });
  return caseState;
}

test("approved S01/S02/S03/S04/S10/S14/S18/S19 facts materially exercise graph semantics", () => {
  const graphs = Object.fromEntries(["S01", "S02", "S03", "S04", "S10", "S14", "S18", "S19"]
    .map((id) => [id, buildCanonicalOwnershipGraph(operativeScenarioCase(id))]));
  assert.equal(graphs.S01.relationships.length, 1);
  assert.equal(graphs.S02.relationships[0].qualifiers.economicInterestConcept, "SURPLUS_ASSET_RIGHTS");
  assert.equal(graphs.S03.relationships.length, 2);
  assert.equal(graphs.S04.relationships.length >= 4, true);
  assert.equal(graphs.S10.relationships[0].measurement.type, PERCENTAGE_VALUE_TYPE.RANGE);
  assert.deepEqual(new Set(graphs.S14.relationships.map(({ dimension }) => dimension)), new Set([GRAPH_DIMENSION.ECONOMIC, GRAPH_DIMENSION.VOTING]));
  assert.equal(graphs.S18.relationships.length, 2);
  assert.equal(graphs.S19.relationships.length, 1);
  assert.equal(graphs.S19.relationships[0].supportingClaimIds.length, 2);
});

test("approved S09 conflicting operative scenario is rejected deterministically", () => {
  assert.throws(
    () => buildCanonicalOwnershipGraph(operativeScenarioCase("S09")),
    (error) => error.code === GRAPH_ERROR_CODE.CONFLICTING_OPERATIVE_CLAIMS,
  );
});
