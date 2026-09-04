"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const V16 = require("../policies/uk-corporate/1.6-rc/policy.json");
const { PERCENTAGE_VALUE_TYPE, RELATIONSHIP_TYPE } = require("../contracts/constants");
const { CANONICAL_ENTITY_CATEGORY } = require("../domain/canonicalEntity");
const { GRAPH_DIMENSION, TEMPORAL_STATE } = require("../domain/ownershipGraph");
const { calculateEffectivePercentage } = require("../domain/percentageCalculation");
const { QUALIFICATION_ASSESSMENT_STATE } = require("../domain/qualificationBasisV2");
const {
  assessEffectiveInterestQualificationV2,
} = require("../policy/effectiveInterestQualificationV2");
const {
  PSC_ATTRIBUTION_ALGORITHM,
  PSC_ATTRIBUTION_ASSESSMENT_VERSION,
  PSC_ATTRIBUTION_ERROR_CODE,
  PSC_CONDITION,
  assessCompanyPscAttributionV1,
} = require("../policy/companyPscAttributionV1");
const { loadPolicyPack } = require("../policy/policyPack");

const TARGET = "company-customer";
const ALICE = "person-alice";
const POLICY = loadPolicyPack(V16);
const GRAPH_VERSION = `ubo-graph-v1:${"4".repeat(64)}`;
const EVIDENCE = Object.freeze({ system: "canonical-test", referenceType: "REGISTER", referenceId: "evidence-1" });

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function exact(value) {
  return { type: PERCENTAGE_VALUE_TYPE.EXACT, value: String(value) };
}

function range(lowerBound, upperBound, lowerInclusive = true, upperInclusive = true) {
  return {
    type: PERCENTAGE_VALUE_TYPE.RANGE,
    lowerBound: String(lowerBound),
    upperBound: String(upperBound),
    lowerInclusive,
    upperInclusive,
  };
}

function unknown(reason = "not established") {
  return { type: PERCENTAGE_VALUE_TYPE.UNKNOWN, reason };
}

function entity(entityId, profile = "COMPANY") {
  return {
    entityId,
    category: profile === "NATURAL_PERSON"
      ? CANONICAL_ENTITY_CATEGORY.NATURAL_PERSON
      : profile === "TRUST"
        ? CANONICAL_ENTITY_CATEGORY.TRUST_OR_LEGAL_ARRANGEMENT
        : CANONICAL_ENTITY_CATEGORY.LEGAL_ENTITY,
    entityTypeMetadata: profile === "NATURAL_PERSON" ? {} : { sourceEntityType: profile },
  };
}

function relationship(relationshipId, subjectEntityId, objectEntityId, relationshipType, {
  measurement,
  qualifiers = {},
  temporalState = TEMPORAL_STATE.CURRENT,
  supportingClaimIds = [`claim-${relationshipId}`],
} = {}) {
  const dimension = relationshipType === RELATIONSHIP_TYPE.ECONOMIC_OWNERSHIP
    ? GRAPH_DIMENSION.ECONOMIC
    : relationshipType === RELATIONSHIP_TYPE.VOTING_RIGHTS ? GRAPH_DIMENSION.VOTING : null;
  return {
    relationshipId,
    subjectEntityId,
    objectEntityId,
    relationshipType,
    dimension,
    temporalState,
    supportingClaimIds,
    ...(measurement === undefined ? {} : { measurement }),
    ...(Object.keys(qualifiers).length === 0 ? {} : { qualifiers }),
  };
}

function shares(id, from, to, value, options = {}) {
  return relationship(id, from, to, RELATIONSHIP_TYPE.ECONOMIC_OWNERSHIP, {
    ...options,
    measurement: value,
    qualifiers: { economicInterestConcept: "SHARE_OWNERSHIP", ...(options.qualifiers || {}) },
  });
}

function voting(id, from, to, value, options = {}) {
  return relationship(id, from, to, RELATIONSHIP_TYPE.VOTING_RIGHTS, {
    ...options,
    measurement: value,
  });
}

function graph(relationships, extraEntities = []) {
  const ids = new Set([TARGET]);
  relationships.forEach(({ subjectEntityId, objectEntityId }) => {
    ids.add(subjectEntityId);
    ids.add(objectEntityId);
  });
  const supplied = new Map(extraEntities.map((item) => [item.entityId, item]));
  const entities = [...ids].map((id) => supplied.get(id)
    || entity(id, id.startsWith("person-") ? "NATURAL_PERSON" : "COMPANY"));
  return {
    ownershipGraph: {
      graphAlgorithm: "ubo-graph-v1",
      graphVersion: GRAPH_VERSION,
      sourceCase: { caseId: "case-wave-4", revision: 4, revisionId: "revision-wave-4" },
      nodes: entities.map(({ entityId, category }) => ({ entityId, category })).sort((a, b) => a.entityId.localeCompare(b.entityId)),
      relationships: clone(relationships),
    },
    canonicalEntities: entities,
  };
}

function assess(relationships, extraEntities = [], options = {}) {
  const input = graph(relationships, extraEntities);
  return assessCompanyPscAttributionV1({
    policyPack: options.policyPack || POLICY,
    ...input,
    targetEntityId: options.targetEntityId || TARGET,
    claimSupport: options.claimSupport || [],
    ...(options.caseRevision === undefined ? {} : { caseRevision: options.caseRevision }),
  });
}

function basis(result, personId = ALICE, condition = PSC_CONDITION.SHARES_GT_THRESHOLD) {
  return result.basisRecords.find((item) => item.personEntityId === personId && item.condition === condition);
}

test("direct company share thresholds preserve exact and range endpoint semantics", () => {
  const cases = [
    [exact(30), "SATISFIED"],
    [exact(25), "NOT_SATISFIED"],
    [range(25, 50, false, true), "SATISFIED"],
    [range(25, 50, true, true), "INDETERMINATE"],
  ];
  for (const [value, expected] of cases) {
    const result = assess([shares("share-direct", ALICE, TARGET, value)]);
    const record = basis(result);
    assert.equal(record.assessmentState, expected);
    assert.equal(record.directness, "DIRECT");
    assert.deepEqual(record.targetRightReferences[0].originalValue, value);
    assert.equal(record.threshold.value, 25);
    assert.equal(record.threshold.comparator, ">");
  }
});

test("economic and voting target conditions remain independent", () => {
  const result = assess([
    shares("share-alice", ALICE, TARGET, exact(30)),
    voting("vote-bob", "person-bob", TARGET, exact(30)),
  ]);
  assert.equal(basis(result, ALICE, PSC_CONDITION.SHARES_GT_THRESHOLD).assessmentState, "SATISFIED");
  assert.equal(basis(result, "person-bob", PSC_CONDITION.VOTING_GT_THRESHOLD).assessmentState, "SATISFIED");
  assert.equal(basis(result, ALICE, PSC_CONDITION.VOTING_GT_THRESHOLD), undefined);
  assert.equal(basis(result, "person-bob", PSC_CONDITION.SHARES_GT_THRESHOLD), undefined);

  const indirectVoting = assess([
    voting("alice-topco", ALICE, "company-topco", exact(60)),
    voting("topco-customer", "company-topco", TARGET, exact(40)),
  ]);
  const votingBasis = basis(indirectVoting, ALICE, PSC_CONDITION.VOTING_GT_THRESHOLD);
  assert.equal(votingBasis.assessmentState, "SATISFIED");
  assert.deepEqual(votingBasis.aggregatedTargetRightValue, exact(40));
  assert.equal(basis(indirectVoting, ALICE, PSC_CONDITION.SHARES_GT_THRESHOLD), undefined);
});

test("the canonical 60/40 case preserves a 24 percent effective-interest basis and a separate 40 percent attribution basis", () => {
  const relationships = [
    shares("alice-economic-topco", ALICE, "company-topco", exact(60)),
    voting("alice-voting-topco", ALICE, "company-topco", exact(60)),
    shares("topco-share-customer", "company-topco", TARGET, exact(40)),
  ];
  const input = graph(relationships);
  const calculation = calculateEffectivePercentage(input.ownershipGraph, {
    subjectEntityId: ALICE,
    targetEntityId: TARGET,
    dimension: GRAPH_DIMENSION.ECONOMIC,
  });
  const effective = assessEffectiveInterestQualificationV2({
    policyPack: POLICY,
    calculationResult: calculation,
    holderEntity: input.canonicalEntities.find(({ entityId }) => entityId === ALICE),
    targetEntityId: TARGET,
    graphVersion: GRAPH_VERSION,
  });
  const attribution = assessCompanyPscAttributionV1({
    policyPack: POLICY,
    ...input,
    targetEntityId: TARGET,
  });
  const effectiveBasis = effective.basisRecords[0];
  const attributionBasis = basis(attribution);
  assert.deepEqual(effectiveBasis.recordedCalculation.value, exact(24));
  assert.equal(effectiveBasis.assessmentState, "NOT_SATISFIED");
  assert.deepEqual(attributionBasis.aggregatedTargetRightValue, exact(40));
  assert.equal(attributionBasis.assessmentState, "SATISFIED");
  assert.equal(attributionBasis.attributionChains[0].majoritySteps[0].measurement.value, "60");
  assert.equal(JSON.stringify(attributionBasis).includes('"24"'), false);
  assert.deepEqual([effectiveBasis.route, attributionBasis.route], ["EFFECTIVE_INTEREST", "PSC_CONDITION_ATTRIBUTION"]);
});

test("economic ownership alone never establishes a majority step and a 30 percent voting step definitively fails", () => {
  const onlyEconomic = assess([
    shares("alice-economic-topco", ALICE, "company-topco", exact(60)),
    shares("topco-share-customer", "company-topco", TARGET, exact(40)),
  ]);
  assert.equal(basis(onlyEconomic), undefined);

  const relationships = [
    shares("alice-economic-topco", ALICE, "company-topco", exact(30)),
    voting("alice-voting-topco", ALICE, "company-topco", exact(30)),
    shares("topco-share-customer", "company-topco", TARGET, exact(40)),
  ];
  const input = graph(relationships);
  const effective = calculateEffectivePercentage(input.ownershipGraph, {
    subjectEntityId: ALICE,
    targetEntityId: TARGET,
    dimension: GRAPH_DIMENSION.ECONOMIC,
  });
  assert.deepEqual(effective.aggregateKnownValue, exact(12));
  assert.equal(basis(assess(relationships)).assessmentState, "NOT_SATISFIED");
});

test("deep majority chains retain each explicit voting step in canonical order", () => {
  const result = assess([
    voting("step-alice-a", ALICE, "company-a", range(75, 100, false, true)),
    voting("step-a-b", "company-a", "company-b", range(75, 100, false, true)),
    shares("right-b-customer", "company-b", TARGET, exact(40)),
  ]);
  const record = basis(result);
  assert.equal(record.assessmentState, "SATISFIED");
  assert.equal(record.directness, "INDIRECT");
  assert.deepEqual(record.attributionChains[0].relationshipIds, ["step-alice-a", "step-a-b", "right-b-customer"]);
  assert.deepEqual(record.attributionChains[0].majoritySteps.map(({ relationshipId }) => relationshipId), ["step-alice-a", "step-a-b"]);
});

test("strict majority voting range, unknown and currentness semantics are conservative", () => {
  const cases = [
    [exact(50), TEMPORAL_STATE.CURRENT, "NOT_SATISFIED"],
    [exact(50.01), TEMPORAL_STATE.CURRENT, "SATISFIED"],
    [range(50, 100, false, true), TEMPORAL_STATE.CURRENT, "SATISFIED"],
    [range(25, 50, false, true), TEMPORAL_STATE.CURRENT, "NOT_SATISFIED"],
    [range(50, 75, true, true), TEMPORAL_STATE.CURRENT, "INDETERMINATE"],
    [unknown(), TEMPORAL_STATE.CURRENT, "INDETERMINATE"],
    [exact(60), TEMPORAL_STATE.UNKNOWN, "INDETERMINATE"],
    [exact(60), TEMPORAL_STATE.CEASED, "NOT_SATISFIED"],
  ];
  for (const [value, temporalState, expected] of cases) {
    const result = assess([
      voting("step", ALICE, "company-topco", value, { temporalState }),
      shares("right", "company-topco", TARGET, exact(40)),
    ]);
    assert.equal(basis(result).assessmentState, expected);
  }
});

test("unknown or non-current target rights cannot establish a current attributed condition", () => {
  const unknownValue = basis(assess([shares("right", ALICE, TARGET, unknown())]));
  assert.equal(unknownValue.assessmentState, "INDETERMINATE");
  const unknownCurrentness = basis(assess([shares("right", ALICE, TARGET, exact(40), {
    temporalState: TEMPORAL_STATE.UNKNOWN,
  })]));
  assert.equal(unknownCurrentness.assessmentState, "INDETERMINATE");
  const ceased = basis(assess([shares("right", ALICE, TARGET, exact(40), {
    temporalState: TEMPORAL_STATE.CEASED,
  })]));
  assert.equal(ceased.assessmentState, "NOT_SATISFIED");
  assert.equal(ceased.targetRightReferences[0].temporalState, "CEASED");
});

test("relevant cycles are diagnosed without creating a positive path while unrelated cycles do not taint a valid route", () => {
  const relevant = assess([
    voting("alice-a-uncertain", ALICE, "company-a", range(50, 75)),
    voting("a-b", "company-a", "company-b", exact(60)),
    voting("b-a", "company-b", "company-a", exact(60)),
    shares("right-b", "company-b", TARGET, exact(40)),
  ]);
  assert.equal(basis(relevant).assessmentState, "INDETERMINATE");
  assert.equal(relevant.unsupportedDiagnostics.some(({ code }) => code === "RELEVANT_ATTRIBUTION_CYCLE"), true);

  const unrelated = assess([
    voting("alice-topco", ALICE, "company-topco", exact(60)),
    shares("right-topco", "company-topco", TARGET, exact(40)),
    voting("x-y", "company-x", "company-y", exact(60)),
    voting("y-x", "company-y", "company-x", exact(60)),
  ]);
  assert.equal(basis(unrelated).assessmentState, "SATISFIED");
  assert.equal(unrelated.unsupportedDiagnostics.some(({ code }) => code === "RELEVANT_ATTRIBUTION_CYCLE"), false);
});

test("one target right reached through two valid chains is counted once while both chains remain", () => {
  const record = basis(assess([
    voting("alice-a", ALICE, "company-a", exact(60)),
    voting("alice-b", ALICE, "company-b", exact(60)),
    voting("a-holder", "company-a", "company-holder", exact(60)),
    voting("b-holder", "company-b", "company-holder", exact(60)),
    shares("one-right", "company-holder", TARGET, exact(40)),
  ]));
  assert.deepEqual(record.aggregatedTargetRightValue, exact(40));
  assert.equal(record.targetRightReferences.length, 1);
  assert.equal(record.attributionChains.length, 2);
});

test("distinct controlled target rights and direct-plus-indirect rights aggregate without multiplication", () => {
  const distinct = basis(assess([
    voting("alice-a", ALICE, "company-a", exact(60)),
    voting("alice-b", ALICE, "company-b", exact(60)),
    shares("right-a", "company-a", TARGET, exact(20)),
    shares("right-b", "company-b", TARGET, exact(10)),
  ]));
  assert.deepEqual(distinct.aggregatedTargetRightValue, exact(30));
  assert.equal(distinct.targetRightReferences.length, 2);

  const mixed = basis(assess([
    shares("right-direct", ALICE, TARGET, exact(10)),
    voting("alice-holdco", ALICE, "company-holdco", exact(60)),
    shares("right-indirect", "company-holdco", TARGET, exact(20)),
  ]));
  assert.deepEqual(mixed.aggregatedTargetRightValue, exact(30));
  assert.equal(mixed.directness, "DIRECT_AND_INDIRECT");
  assert.equal(JSON.stringify(mixed).includes('"12"'), false);
});

test("appointment/removal requires explicit majority scope and retains A-12 governance", () => {
  const explicit = assess([relationship("appoint-majority", ALICE, TARGET, RELATIONSHIP_TYPE.BOARD_APPOINTMENT_RIGHT, {
    qualifiers: { scope: "MAJORITY" },
  })]);
  const explicitBasis = basis(explicit, ALICE, PSC_CONDITION.APPOINT_REMOVE_MAJORITY);
  assert.equal(explicitBasis.assessmentState, "SATISFIED");
  assert.deepEqual(explicitBasis.governance.requiredSignoffIds, ["A-09", "A-12"]);
  assert.equal(explicitBasis.governance.productionAuthorized, false);

  const unknownScope = basis(assess([relationship("appoint-unknown", ALICE, TARGET, RELATIONSHIP_TYPE.BOARD_APPOINTMENT_RIGHT)]), ALICE, PSC_CONDITION.APPOINT_REMOVE_MAJORITY);
  assert.equal(unknownScope.assessmentState, "INDETERMINATE");
  const ambiguous = basis(assess([relationship("appoint-ambiguous", ALICE, TARGET, RELATIONSHIP_TYPE.FORMAL_CONTROL_RIGHT, {
    qualifiers: { controlConcept: "APPOINT_OR_REMOVE", scope: "MAJORITY", ambiguity: "COMBINED_ALTERNATIVE_SOURCE" },
  })]), ALICE, PSC_CONDITION.APPOINT_REMOVE_MAJORITY);
  assert.equal(ambiguous.assessmentState, "REVIEW_REQUIRED");
  assert.deepEqual(ambiguous.governance.requiredSignoffIds, ["A-09", "A-12"]);

  const upstream = basis(assess([
    relationship("appoint-step", ALICE, "company-topco", RELATIONSHIP_TYPE.BOARD_REMOVAL_RIGHT, {
      qualifiers: { scope: "MAJORITY" },
    }),
    shares("right", "company-topco", TARGET, exact(40)),
  ]));
  assert.equal(upstream.assessmentState, "SATISFIED");
  assert.deepEqual(upstream.governance.requiredSignoffIds, ["A-09", "A-12"]);
});

test("direct SIoC is condition-specific, interpretive SIoC requires review, and SIoC is never a majority step", () => {
  const direct = basis(assess([relationship("sioc-direct", ALICE, TARGET, RELATIONSHIP_TYPE.SIGNIFICANT_INFLUENCE_OR_CONTROL)]), ALICE, PSC_CONDITION.SIGNIFICANT_INFLUENCE_OR_CONTROL);
  assert.equal(direct.assessmentState, "SATISFIED");
  const interpretive = basis(assess([relationship("sioc-review", ALICE, TARGET, RELATIONSHIP_TYPE.SIGNIFICANT_INFLUENCE_OR_CONTROL, {
    qualifiers: { requiresInterpretation: true },
  })]), ALICE, PSC_CONDITION.SIGNIFICANT_INFLUENCE_OR_CONTROL);
  assert.equal(interpretive.assessmentState, "REVIEW_REQUIRED");

  const chain = assess([
    relationship("sioc-step", ALICE, "company-topco", RELATIONSHIP_TYPE.SIGNIFICANT_INFLUENCE_OR_CONTROL),
    shares("right", "company-topco", TARGET, exact(40)),
  ]);
  assert.equal(basis(chain).assessmentState, "INDETERMINATE");
  assert.equal(chain.unsupportedDiagnostics.some(({ code }) => code === "SIGNIFICANT_CONTROL_IS_NOT_A_MAJORITY_STEP"), true);
});

test("unsupported LLP and trust intermediaries are not traversed and condition 5 remains unassessed", () => {
  const llp = assess([shares("llp-right", "entity-llp", TARGET, exact(40))], [entity("entity-llp", "LLP")]);
  assert.equal(llp.basisRecords.length, 0);
  assert.deepEqual(llp.unsupportedDiagnostics[0].requiredSignoffs, ["A-06", "A-09"]);
  assert.deepEqual(llp.unassessedConditions, [PSC_CONDITION.TRUST_OR_FIRM_CONDITION]);

  const trust = assess([shares("trust-right", "entity-trust", TARGET, exact(40))], [entity("entity-trust", "TRUST")]);
  assert.equal(trust.basisRecords.length, 0);
  assert.equal(trust.unsupportedDiagnostics[0].code, "UNSUPPORTED_TARGET_RIGHT_HOLDER_PROFILE");
});

test("joint arrangements are neither inferred nor attributed and an explicit signal retains A-13", () => {
  const ordinary = basis(assess([
    shares("alice-20", ALICE, TARGET, exact(20)),
    shares("bob-20", "person-bob", TARGET, exact(20)),
  ]));
  assert.equal(ordinary.assessmentState, "NOT_SATISFIED");

  const explicit = assess([shares("joint-right", ALICE, TARGET, exact(40), {
    qualifiers: { jointArrangementSignal: true },
  })]);
  const record = basis(explicit);
  assert.equal(record.assessmentState, "REVIEW_REQUIRED");
  assert.equal(record.targetRightReferences[0].attributed, false);
  assert.deepEqual(record.governance.requiredSignoffIds, ["A-09", "A-13"]);
  assert.deepEqual(explicit.governance.requiredSignoffIds, ["A-09", "A-13"]);
});

test("assessment identity, order, serialization, immutability and operative support are deterministic", () => {
  const relationships = [
    voting("alice-topco", ALICE, "company-topco", exact(60), { supportingClaimIds: ["claim-vote-b", "claim-vote-a"] }),
    shares("topco-right", "company-topco", TARGET, exact(40), { supportingClaimIds: ["claim-share-b", "claim-share-a"] }),
  ];
  const claimSupport = [
    { claimId: "claim-vote-a", evidenceReferences: [EVIDENCE] },
    { claimId: "claim-vote-b", evidenceReferences: [EVIDENCE] },
    { claimId: "claim-share-a", evidenceReferences: [EVIDENCE] },
    { claimId: "claim-share-b", evidenceReferences: [EVIDENCE] },
  ];
  const firstInput = graph(relationships);
  const before = clone({ ...firstInput, claimSupport });
  const first = assessCompanyPscAttributionV1({ policyPack: POLICY, ...firstInput, targetEntityId: TARGET, claimSupport });
  const reversed = assessCompanyPscAttributionV1({
    policyPack: POLICY,
    ownershipGraph: { ...firstInput.ownershipGraph, relationships: [...firstInput.ownershipGraph.relationships].reverse() },
    canonicalEntities: [...firstInput.canonicalEntities].reverse(),
    targetEntityId: TARGET,
    claimSupport: [...claimSupport].reverse(),
  });
  const record = basis(first);
  assert.equal(first.assessmentContractVersion, PSC_ATTRIBUTION_ASSESSMENT_VERSION);
  assert.equal(first.algorithmVersion, PSC_ATTRIBUTION_ALGORITHM);
  assert.equal(first.assessmentId, reversed.assessmentId);
  assert.equal(record.basisId, basis(reversed).basisId);
  assert.deepEqual(record.operativeClaimReferences, ["claim-share-a", "claim-share-b", "claim-vote-a", "claim-vote-b"]);
  assert.deepEqual(record.evidenceReferences, [EVIDENCE]);
  assert.deepEqual(record.caseReference, firstInput.ownershipGraph.sourceCase);
  assert.equal(record.graphReference.graphVersion, GRAPH_VERSION);
  assert.equal(record.policyIdentity.canonicalHash, POLICY.identity.hash);
  assert.deepEqual(JSON.parse(JSON.stringify(first)), first);
  assert.deepEqual({ ...firstInput, claimSupport }, before);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.basisRecords), true);
});

test("malformed policy, target, case, share semantics, support and overlapping target-right slots fail with stable errors", () => {
  assert.throws(() => assess([shares("right", ALICE, TARGET, exact(40))], [entity(TARGET, "LLP")]), (error) => error.code === PSC_ATTRIBUTION_ERROR_CODE.TARGET_NOT_COMPANY);
  assert.throws(() => assess([shares("right", ALICE, TARGET, exact(40))], [], { caseRevision: { caseId: "other", revision: 4 } }), (error) => error.code === PSC_ATTRIBUTION_ERROR_CODE.INCONSISTENT_GRAPH_REFERENCE);
  assert.throws(() => assess([relationship("wrong-economic", ALICE, TARGET, RELATIONSHIP_TYPE.ECONOMIC_OWNERSHIP, { measurement: exact(40) })]), (error) => error.code === PSC_ATTRIBUTION_ERROR_CODE.UNSUPPORTED_TARGET_RIGHT_SEMANTICS);
  assert.throws(() => assess([shares("right", ALICE, TARGET, exact(40))], [], {
    claimSupport: [{ claimId: "not-operative", evidenceReferences: [EVIDENCE] }],
  }), (error) => error.code === PSC_ATTRIBUTION_ERROR_CODE.INVALID_SUPPORT_REFERENCE);
  assert.throws(() => assess([
    shares("overlap-a", ALICE, TARGET, exact(20)),
    shares("overlap-b", ALICE, TARGET, exact(10)),
  ]), (error) => error.code === PSC_ATTRIBUTION_ERROR_CODE.MALFORMED_RELATIONSHIP);

  const wrongPolicy = clone(V16);
  wrongPolicy.qualificationDoctrine.routes.find(({ id }) => id === "PSC_CONDITION_ATTRIBUTION").method = "wrong-method";
  assert.throws(() => assess([shares("right", ALICE, TARGET, exact(40))], [], { policyPack: loadPolicyPack(wrongPolicy) }), (error) => error.code === PSC_ATTRIBUTION_ERROR_CODE.UNSUPPORTED_ROUTE_METHOD);
  const wrongStatus = clone(V16);
  wrongStatus.qualificationDoctrine.routes.find(({ id }) => id === "PSC_CONDITION_ATTRIBUTION").methodStatus = "UNAPPROVED_METHOD";
  assert.throws(() => assess([shares("right", ALICE, TARGET, exact(40))], [], { policyPack: loadPolicyPack(wrongStatus) }), (error) => error.code === PSC_ATTRIBUTION_ERROR_CODE.UNSUPPORTED_ROUTE_METHOD_STATUS);
  const absentRoute = clone(V16);
  absentRoute.qualificationDoctrine.routes = absentRoute.qualificationDoctrine.routes.filter(({ id }) => id !== "PSC_CONDITION_ATTRIBUTION");
  assert.throws(() => assess([shares("right", ALICE, TARGET, exact(40))], [], { policyPack: loadPolicyPack(absentRoute) }), (error) => error.code === PSC_ATTRIBUTION_ERROR_CODE.ROUTE_NOT_DECLARED);
  assert.throws(() => assess([shares("right", ALICE, TARGET, exact(40))], [], { policyPack: V16 }), (error) => error.code === PSC_ATTRIBUTION_ERROR_CODE.POLICY_IDENTITY_REQUIRED);
  const forged = { ...POLICY, identity: { ...POLICY.identity, hash: `sha256:${"0".repeat(64)}` } };
  assert.throws(() => assess([shares("right", ALICE, TARGET, exact(40))], [], { policyPack: forged }), (error) => error.code === PSC_ATTRIBUTION_ERROR_CODE.POLICY_IDENTITY_MISMATCH);
});

test("only natural persons receive bases and the assessment never emits a final person-level result", () => {
  const result = assess([shares("legal-holder-right", "company-holder", TARGET, exact(40))]);
  assert.equal(result.basisRecords.length, 0);
  assert.equal(Object.prototype.hasOwnProperty.call(result, "qualifies"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result, "isUbo"), false);
  assert.equal(result.scope, "ROUTE_SPECIFIC_NOT_FINAL_PERSON_DETERMINATION");
  assert.deepEqual(result.assessedRoutes, ["PSC_CONDITION_ATTRIBUTION"]);
  assert.equal(result.governance.governanceState, "REVIEW_ONLY");
  assert.equal(result.governance.productionAuthorized, false);
  assert.deepEqual(result.governance.requiredSignoffIds, ["A-09"]);
});

test("the internal algorithm has no provider, legacy, runtime or effective-interest implementation dependency", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "policy", "companyPscAttributionV1.js"), "utf8");
  const publicEntry = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  [
    /companies\s*house/i,
    /legacy[-/]discovery/i,
    /agents\/ubo/i,
    /integrations\/ubo-control/i,
    /https?:\/\//i,
    /\bfetch\s*\(/,
    /calculateEffectivePercentage/,
    /multiplyIntervals/,
  ].forEach((pattern) => assert.doesNotMatch(source, pattern));
  assert.doesNotMatch(publicEntry, /companyPscAttributionV1|assessCompanyPscAttributionV1|PSC_ATTRIBUTION_ALGORITHM/);
});
