"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const V16 = require("../policies/uk-corporate/1.6-rc/policy.json");
const { PERCENTAGE_VALUE_TYPE, RELATIONSHIP_TYPE } = require("../contracts/constants");
const { CANONICAL_ENTITY_CATEGORY } = require("../domain/canonicalEntity");
const { GRAPH_DIMENSION, TEMPORAL_STATE } = require("../domain/ownershipGraph");
const {
  COMPANY_PSC_CONDITION,
  LLP_PSC_ATTRIBUTION_ALGORITHM,
  LLP_PSC_ATTRIBUTION_ASSESSMENT_VERSION,
  LLP_PSC_ATTRIBUTION_ERROR_CODE,
  LLP_PSC_ATTRIBUTION_GOVERNANCE_STATE,
  LLP_PSC_ATTRIBUTION_METHOD_STATUS,
  LLP_PSC_CONDITION,
  LLP_PSC_WORKING_ASSUMPTION,
  assessLlpPscAttributionV1,
} = require("../policy/llpPscAttributionV1");
const { loadPolicyPack } = require("../policy/policyPack");

const TARGET = "entity-target";
const ALICE = "person-alice";
const GRAPH_VERSION = `ubo-graph-v1:${"5".repeat(64)}`;
const EVIDENCE = Object.freeze({ system: "canonical-test", referenceType: "REGISTER", referenceId: "evidence-wave-5" });

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function testPolicy() {
  const raw = clone(V16);
  raw.policyPackId = "TEST-UK-CORPORATE-A-06-WA-01";
  raw.version = "test-a-06-wa-01";
  const route = raw.qualificationDoctrine.routes.find(({ id }) => id === "PSC_CONDITION_ATTRIBUTION");
  route.method = LLP_PSC_ATTRIBUTION_ALGORITHM;
  route.methodStatus = LLP_PSC_ATTRIBUTION_METHOD_STATUS;
  route.conditions = [...Object.values(COMPANY_PSC_CONDITION), ...Object.values(LLP_PSC_CONDITION)];
  return loadPolicyPack(raw);
}

const POLICY = testPolicy();

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

function surplus(id, from, to, value, options = {}) {
  return relationship(id, from, to, RELATIONSHIP_TYPE.ECONOMIC_OWNERSHIP, {
    ...options,
    measurement: value,
    qualifiers: { economicInterestConcept: "SURPLUS_ASSET_RIGHTS", ...(options.qualifiers || {}) },
  });
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

function llpAppointment(id, from, to, scope = "MAJORITY", options = {}) {
  return relationship(id, from, to, RELATIONSHIP_TYPE.FORMAL_CONTROL_RIGHT, {
    ...options,
    qualifiers: {
      controlConcept: "MANAGEMENT_APPOINTMENT_RIGHTS",
      managementBody: "persons_entitled_to_participate_in_management",
      ...(scope === undefined ? {} : { scope }),
      ...(options.qualifiers || {}),
    },
  });
}

function graph(relationships, targetProfile = "LLP", extraEntities = []) {
  const ids = new Set([TARGET]);
  relationships.forEach(({ subjectEntityId, objectEntityId }) => {
    ids.add(subjectEntityId);
    ids.add(objectEntityId);
  });
  const supplied = new Map([entity(TARGET, targetProfile), ...extraEntities].map((item) => [item.entityId, item]));
  const entities = [...ids].map((id) => supplied.get(id)
    || entity(id, id.startsWith("person-") ? "NATURAL_PERSON" : "COMPANY"));
  return {
    ownershipGraph: {
      graphAlgorithm: "ubo-graph-v1",
      graphVersion: GRAPH_VERSION,
      sourceCase: { caseId: "case-wave-5", revision: 5, revisionId: "revision-wave-5" },
      nodes: entities.map(({ entityId, category }) => ({ entityId, category })).sort((a, b) => a.entityId.localeCompare(b.entityId)),
      relationships: clone(relationships),
    },
    canonicalEntities: entities,
  };
}

function assess(relationships, { targetProfile = "LLP", extraEntities = [], policyPack = POLICY, claimSupport = [] } = {}) {
  return assessLlpPscAttributionV1({
    policyPack,
    ...graph(relationships, targetProfile, extraEntities),
    targetEntityId: TARGET,
    claimSupport,
  });
}

function basis(result, personId = ALICE, condition) {
  return result.basisRecords.find((item) => item.personEntityId === personId
    && (condition === undefined || item.condition === condition));
}

test("direct LLP surplus-asset thresholds preserve exact and open/closed range semantics", () => {
  const cases = [
    [exact(30), "SATISFIED"],
    [exact(25), "NOT_SATISFIED"],
    [range(25, 50, false, true), "SATISFIED"],
    [range(25, 50, true, true), "INDETERMINATE"],
  ];
  for (const [value, expected] of cases) {
    const record = basis(assess([surplus("direct-surplus", ALICE, TARGET, value)]), ALICE, LLP_PSC_CONDITION.SURPLUS_ASSET_RIGHTS_GT_THRESHOLD);
    assert.equal(record.assessmentState, expected);
    assert.equal(record.directness, "DIRECT");
    assert.equal(record.targetRightReferences[0].rightSemantic, "LLP_SURPLUS_ASSET_RIGHTS");
    assert.deepEqual(record.targetRightReferences[0].originalValue, value);
    assert.deepEqual(record.governance.requiredSignoffIds, ["A-06"]);
  }
});

test("direct LLP voting is independent from surplus assets and generic shares are rejected", () => {
  const votingResult = assess([voting("direct-vote", ALICE, TARGET, exact(30))]);
  assert.equal(basis(votingResult, ALICE, LLP_PSC_CONDITION.LLP_VOTING_GT_THRESHOLD).assessmentState, "SATISFIED");
  assert.equal(basis(votingResult, ALICE, LLP_PSC_CONDITION.SURPLUS_ASSET_RIGHTS_GT_THRESHOLD), undefined);

  const surplusResult = assess([surplus("direct-surplus", ALICE, TARGET, exact(30))]);
  assert.equal(basis(surplusResult, ALICE, LLP_PSC_CONDITION.LLP_VOTING_GT_THRESHOLD), undefined);
  assert.throws(
    () => assess([shares("company-share", ALICE, TARGET, exact(30))]),
    (error) => error.code === LLP_PSC_ATTRIBUTION_ERROR_CODE.UNSUPPORTED_TARGET_RIGHT_SEMANTICS,
  );
});

test("direct LLP appointment and SIoC require explicit unambiguous current semantics", () => {
  const appointment = basis(assess([llpAppointment("appoint", ALICE, TARGET)]), ALICE, LLP_PSC_CONDITION.LLP_APPOINT_REMOVE_MAJORITY_OF_MANAGEMENT);
  assert.equal(appointment.assessmentState, "SATISFIED");
  assert.deepEqual(appointment.governance.requiredSignoffIds, ["A-06", "A-12"]);

  const unknownScope = basis(assess([llpAppointment("appoint-unknown", ALICE, TARGET, null)]), ALICE, LLP_PSC_CONDITION.LLP_APPOINT_REMOVE_MAJORITY_OF_MANAGEMENT);
  assert.equal(unknownScope.assessmentState, "INDETERMINATE");

  const explicit = basis(assess([relationship("sioc", ALICE, TARGET, RELATIONSHIP_TYPE.SIGNIFICANT_INFLUENCE_OR_CONTROL)]), ALICE, LLP_PSC_CONDITION.LLP_SIGNIFICANT_INFLUENCE_OR_CONTROL);
  assert.equal(explicit.assessmentState, "SATISFIED");
  const ambiguous = basis(assess([relationship("sioc-review", ALICE, TARGET, RELATIONSHIP_TYPE.SIGNIFICANT_INFLUENCE_OR_CONTROL, {
    qualifiers: { requiresInterpretation: true },
  })]), ALICE, LLP_PSC_CONDITION.LLP_SIGNIFICANT_INFLUENCE_OR_CONTROL);
  assert.equal(ambiguous.assessmentState, "REVIEW_REQUIRED");
});

test("trust-or-firm LLP condition remains explicitly unassessed", () => {
  const result = assess([surplus("right", ALICE, TARGET, exact(30))]);
  assert.deepEqual(result.unassessedConditions, [LLP_PSC_CONDITION.LLP_TRUST_OR_FIRM_CONDITION]);
  assert.equal(result.assessedConditions.includes(LLP_PSC_CONDITION.LLP_TRUST_OR_FIRM_CONDITION), false);
});

test("strict LLP voting-majority boundaries are distinct from the direct greater-than-25 condition", () => {
  const cases = [
    [exact(50), "REVIEW_REQUIRED", "LLP_DIRECT_VOTING_CONDITION_IS_NOT_MAJORITY_CONTROL"],
    [exact(50.01), "SATISFIED", "STRICT_MAJORITY_VOTING_RIGHT_ESTABLISHED"],
    [range(50, 100, false, true), "SATISFIED", "STRICT_MAJORITY_VOTING_RIGHT_ESTABLISHED"],
    [range(50, 100, true, true), "INDETERMINATE", "PERCENTAGE_RANGE_STRADDLES_THRESHOLD"],
    [range(25, 50, false, true), "REVIEW_REQUIRED", "LLP_DIRECT_VOTING_CONDITION_IS_NOT_MAJORITY_CONTROL"],
    [unknown(), "INDETERMINATE", "PERCENTAGE_NOT_ESTABLISHED"],
  ];
  for (const [value, expectedBasis, expectedStep] of cases) {
    const result = assess([
      voting("person-controls-llp", ALICE, "entity-holder-llp", value),
      voting("holder-target-right", "entity-holder-llp", TARGET, exact(40)),
    ], { extraEntities: [entity("entity-holder-llp", "LLP")] });
    const record = basis(result, ALICE, LLP_PSC_CONDITION.LLP_VOTING_GT_THRESHOLD);
    assert.equal(record.assessmentState, expectedBasis);
    assert.equal(record.attributionChains[0].majoritySteps[0].reasonCode, expectedStep);
    assert.equal(record.targetRightReferences[0].attributed, expectedBasis === "SATISFIED");
  }
});

test("surplus assets and generic SIoC never manufacture an LLP majority-control step", () => {
  const surplusOnly = assess([
    surplus("person-surplus-holder", ALICE, "entity-holder-llp", exact(75)),
    voting("holder-target-right", "entity-holder-llp", TARGET, exact(40)),
  ], { extraEntities: [entity("entity-holder-llp", "LLP")] });
  assert.equal(basis(surplusOnly), undefined);

  const sioc = assess([
    relationship("person-sioc-holder", ALICE, "entity-holder-llp", RELATIONSHIP_TYPE.SIGNIFICANT_INFLUENCE_OR_CONTROL),
    voting("holder-target-right", "entity-holder-llp", TARGET, exact(40)),
  ], { extraEntities: [entity("entity-holder-llp", "LLP")] });
  assert.equal(basis(sioc).assessmentState, "INDETERMINATE");
  assert.equal(sioc.unsupportedDiagnostics.some(({ code }) => code === "SIGNIFICANT_CONTROL_IS_NOT_A_MAJORITY_STEP"), true);
});

test("explicit LLP majority-management appointment is traversable and retains A-12", () => {
  const result = assess([
    llpAppointment("person-controls-holder", ALICE, "entity-holder-llp"),
    voting("holder-target-right", "entity-holder-llp", TARGET, exact(40)),
  ], { extraEntities: [entity("entity-holder-llp", "LLP")] });
  const record = basis(result, ALICE, LLP_PSC_CONDITION.LLP_VOTING_GT_THRESHOLD);
  assert.equal(record.assessmentState, "SATISFIED");
  assert.deepEqual(record.governance.requiredSignoffIds, ["A-06", "A-12"]);
});

test("agreement or dominant-control wording remains unsupported without an exact canonical semantic", () => {
  for (const controlConcept of ["CONTROL_OF_MAJORITY_VOTES_BY_AGREEMENT", "DOMINANT_INFLUENCE_OR_CONTROL"]) {
    const result = assess([
      relationship(`unsupported-${controlConcept}`, ALICE, "entity-holder-llp", RELATIONSHIP_TYPE.FORMAL_CONTROL_RIGHT, { qualifiers: { controlConcept } }),
      voting("holder-target-right", "entity-holder-llp", TARGET, exact(40)),
    ], { extraEntities: [entity("entity-holder-llp", "LLP")] });
    assert.equal(basis(result).assessmentState, "INDETERMINATE");
    assert.equal(result.unsupportedDiagnostics.some(({ code }) => code === "UNSUPPORTED_MAJORITY_STEP_SEMANTIC"), true);
  }
});

test("COMPANY target through LLP attributes the full right without percentage multiplication", () => {
  const result = assess([
    voting("alice-controls-llp", ALICE, "entity-llp", exact(60)),
    voting("llp-controls-company", "entity-llp", "entity-company-a", exact(60)),
    shares("company-target-right", "entity-company-a", TARGET, exact(40)),
  ], {
    targetProfile: "COMPANY",
    extraEntities: [entity("entity-llp", "LLP"), entity("entity-company-a", "COMPANY")],
  });
  const record = basis(result, ALICE, COMPANY_PSC_CONDITION.SHARES_GT_THRESHOLD);
  assert.equal(record.assessmentState, "SATISFIED");
  assert.deepEqual(record.aggregatedTargetRightValue, exact(40));
  assert.equal(JSON.stringify(record).includes('"24"'), false);
  assert.deepEqual(record.governance.requiredSignoffIds, ["A-06", "A-09"]);
  assert.deepEqual(record.attributionChains[0].majoritySteps.map(({ controlledEntityProfile }) => controlledEntityProfile), ["LLP", "COMPANY"]);
});

test("LLP target through COMPANY preserves the full LLP surplus-asset right", () => {
  const result = assess([
    voting("alice-controls-company", ALICE, "entity-company-a", exact(60)),
    voting("company-controls-llp", "entity-company-a", "entity-holder-llp", exact(60)),
    surplus("holder-target-right", "entity-holder-llp", TARGET, exact(40)),
  ], { extraEntities: [entity("entity-company-a", "COMPANY"), entity("entity-holder-llp", "LLP")] });
  const record = basis(result, ALICE, LLP_PSC_CONDITION.SURPLUS_ASSET_RIGHTS_GT_THRESHOLD);
  assert.equal(record.assessmentState, "SATISFIED");
  assert.deepEqual(record.aggregatedTargetRightValue, exact(40));
  assert.equal(record.targetRightReferences[0].rightSemantic, "LLP_SURPLUS_ASSET_RIGHTS");
  assert.deepEqual(record.governance.requiredSignoffIds, ["A-06", "A-09"]);
});

test("a broken mixed chain prevents attribution and duplicate valid chains count one target right once", () => {
  const broken = assess([
    voting("alice-controls-llp", ALICE, "entity-llp", exact(60)),
    voting("llp-does-not-control-company", "entity-llp", "entity-company-a", exact(50)),
    shares("company-target-right", "entity-company-a", TARGET, exact(40)),
  ], { targetProfile: "COMPANY", extraEntities: [entity("entity-llp", "LLP"), entity("entity-company-a", "COMPANY")] });
  assert.equal(basis(broken).assessmentState, "NOT_SATISFIED");

  const duplicate = assess([
    voting("alice-controls-a", ALICE, "entity-company-a", exact(60)),
    voting("alice-controls-b", ALICE, "entity-company-b", exact(60)),
    voting("a-controls-holder", "entity-company-a", "entity-holder-llp", exact(60)),
    voting("b-controls-holder", "entity-company-b", "entity-holder-llp", exact(60)),
    surplus("one-target-right", "entity-holder-llp", TARGET, exact(40)),
  ], { extraEntities: [entity("entity-company-a"), entity("entity-company-b"), entity("entity-holder-llp", "LLP")] });
  const duplicateBasis = basis(duplicate, ALICE, LLP_PSC_CONDITION.SURPLUS_ASSET_RIGHTS_GT_THRESHOLD);
  assert.deepEqual(duplicateBasis.aggregatedTargetRightValue, exact(40));
  assert.equal(duplicateBasis.targetRightReferences.length, 1);
  assert.equal(duplicateBasis.attributionChains.length, 2);
});

test("TDR voting bands satisfy a direct LLP condition but do not establish intermediary control or ASDA attribution", () => {
  const people = ["person-gary", "person-thomas", "person-manjit"];
  const tdrVotes = people.map((personId) => voting(`${personId}-tdr-vote`, personId, "entity-tdr-llp", range(25, 50, false, true)));
  const direct = assess(tdrVotes.map((item) => ({ ...item, objectEntityId: TARGET })));
  assert.equal(direct.basisRecords.length, 3);
  direct.basisRecords.forEach((record) => {
    assert.equal(record.condition, LLP_PSC_CONDITION.LLP_VOTING_GT_THRESHOLD);
    assert.equal(record.assessmentState, "SATISFIED");
    assert.deepEqual(record.aggregatedTargetRightValue, range(25, 50, false, true));
  });

  const asda = assess([
    ...tdrVotes,
    voting("tdr-controls-topco", "entity-tdr-llp", "entity-topco", exact(60)),
    shares("topco-asda-right", "entity-topco", TARGET, exact(40)),
  ], {
    targetProfile: "COMPANY",
    extraEntities: [entity("entity-tdr-llp", "LLP"), entity("entity-topco", "COMPANY")],
  });
  assert.equal(asda.basisRecords.length, 3);
  for (const personId of people) {
    const record = basis(asda, personId, COMPANY_PSC_CONDITION.SHARES_GT_THRESHOLD);
    assert.equal(record.assessmentState, "REVIEW_REQUIRED");
    assert.equal(record.reasonCode, "LLP_GOVERNANCE_CONTROL_EVIDENCE_REQUIRED");
    assert.equal(record.targetRightReferences[0].attributed, false);
    assert.equal(record.attributionChains[0].majoritySteps[0].reasonCode, "LLP_DIRECT_VOTING_CONDITION_IS_NOT_MAJORITY_CONTROL");
    assert.equal(Object.prototype.hasOwnProperty.call(record, "recordedCalculation"), false);
  }
  assert.equal(asda.satisfiedBasisIds.length, 0);
  assert.equal(asda.unsupportedDiagnostics.filter(({ code }) => code === "LLP_DIRECT_VOTING_CONDITION_IS_NOT_MAJORITY_CONTROL").length, 3);
  assert.equal(JSON.stringify(asda).includes("ECONOMIC_OWNERSHIP"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(asda, "qualifies"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(asda, "isUbo"), false);
  assert.deepEqual(asda.governance.requiredSignoffIds, ["A-06", "A-09"]);
});

test("joint signals, unsupported profiles, currentness and cycles remain review barriers", () => {
  const joint = assess([
    voting("joint-step", ALICE, "entity-holder-llp", exact(60), { qualifiers: { jointArrangementSignal: true } }),
    voting("holder-target-right", "entity-holder-llp", TARGET, exact(40)),
  ], { extraEntities: [entity("entity-holder-llp", "LLP")] });
  assert.equal(basis(joint).assessmentState, "REVIEW_REQUIRED");
  assert.equal(basis(joint).targetRightReferences[0].attributed, false);
  assert.deepEqual(joint.governance.requiredSignoffIds, ["A-06", "A-13"]);

  const unsupported = assess([surplus("fund-target-right", "entity-fund-lp", TARGET, exact(40))], {
    extraEntities: [entity("entity-fund-lp", "FUND_LIMITED_PARTNERSHIP")],
  });
  assert.equal(unsupported.basisRecords.length, 0);
  assert.deepEqual(unsupported.unsupportedDiagnostics[0].requiredSignoffs, ["A-05", "A-06"]);

  for (const temporalState of [TEMPORAL_STATE.CEASED, TEMPORAL_STATE.UNKNOWN]) {
    const temporal = assess([
      voting("temporal-step", ALICE, "entity-holder-llp", exact(60), { temporalState }),
      voting("holder-target-right", "entity-holder-llp", TARGET, exact(40)),
    ], { extraEntities: [entity("entity-holder-llp", "LLP")] });
    assert.equal(basis(temporal).assessmentState, temporalState === TEMPORAL_STATE.CEASED ? "NOT_SATISFIED" : "INDETERMINATE");
  }

  const cycle = assess([
    voting("alice-a", ALICE, "entity-a", exact(60)),
    voting("a-b", "entity-a", "entity-b", exact(60)),
    voting("b-a", "entity-b", "entity-a", exact(60)),
    voting("a-target-right", "entity-a", TARGET, exact(40)),
  ], { extraEntities: [entity("entity-a", "LLP"), entity("entity-b", "COMPANY")] });
  assert.equal(cycle.unsupportedDiagnostics.some(({ code }) => code === "RELEVANT_MIXED_ATTRIBUTION_CYCLE"), true);
  assert.equal(basis(cycle).assessmentState, "SATISFIED");
});

test("identity, support, governance and immutability are deterministic and never final-person output", () => {
  const relationships = [
    voting("alice-controls-holder", ALICE, "entity-holder-llp", exact(60), { supportingClaimIds: ["claim-vote-b", "claim-vote-a"] }),
    surplus("holder-target-right", "entity-holder-llp", TARGET, exact(40), { supportingClaimIds: ["claim-right-b", "claim-right-a"] }),
  ];
  const claimSupport = ["claim-vote-a", "claim-vote-b", "claim-right-a", "claim-right-b"]
    .map((claimId) => ({ claimId, evidenceReferences: [EVIDENCE] }));
  const input = graph(relationships, "LLP", [entity("entity-holder-llp", "LLP")]);
  const before = clone({ ...input, claimSupport });
  const first = assessLlpPscAttributionV1({ policyPack: POLICY, ...input, targetEntityId: TARGET, claimSupport });
  const reversed = assessLlpPscAttributionV1({
    policyPack: POLICY,
    ownershipGraph: { ...input.ownershipGraph, relationships: [...input.ownershipGraph.relationships].reverse() },
    canonicalEntities: [...input.canonicalEntities].reverse(),
    targetEntityId: TARGET,
    claimSupport: [...claimSupport].reverse(),
  });
  const record = basis(first);
  assert.equal(first.assessmentContractVersion, LLP_PSC_ATTRIBUTION_ASSESSMENT_VERSION);
  assert.equal(first.algorithmVersion, LLP_PSC_ATTRIBUTION_ALGORITHM);
  assert.equal(first.workingAssumptionRef, LLP_PSC_WORKING_ASSUMPTION);
  assert.equal(first.assessmentId, reversed.assessmentId);
  assert.equal(record.basisId, basis(reversed).basisId);
  assert.equal(record.workingAssumptionRef, LLP_PSC_WORKING_ASSUMPTION);
  assert.deepEqual(record.operativeClaimReferences, ["claim-right-a", "claim-right-b", "claim-vote-a", "claim-vote-b"]);
  assert.deepEqual(record.evidenceReferences, [EVIDENCE]);
  assert.equal(first.governance.governanceState, LLP_PSC_ATTRIBUTION_GOVERNANCE_STATE);
  assert.equal(first.governance.productionAuthorized, false);
  assert.equal(record.governance.productionAuthorized, false);
  assert.equal(Object.prototype.hasOwnProperty.call(first, "qualifies"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(first, "isUbo"), false);
  assert.deepEqual(JSON.parse(JSON.stringify(first)), first);
  assert.deepEqual({ ...input, claimSupport }, before);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.basisRecords), true);
});

test("invalid policy identity, method, target, case, support and incompatible target rights fail closed", () => {
  const right = [surplus("right", ALICE, TARGET, exact(40))];
  assert.throws(() => assessLlpPscAttributionV1({ policyPack: V16, ...graph(right), targetEntityId: TARGET }), (error) => error.code === LLP_PSC_ATTRIBUTION_ERROR_CODE.POLICY_IDENTITY_REQUIRED);

  const wrongMethod = clone(V16);
  wrongMethod.qualificationDoctrine.routes.find(({ id }) => id === "PSC_CONDITION_ATTRIBUTION").method = "wrong-method";
  assert.throws(() => assess(right, { policyPack: loadPolicyPack(wrongMethod) }), (error) => error.code === LLP_PSC_ATTRIBUTION_ERROR_CODE.UNSUPPORTED_ROUTE_METHOD);

  const missingCondition = clone(V16);
  const missingConditionRoute = missingCondition.qualificationDoctrine.routes.find(({ id }) => id === "PSC_CONDITION_ATTRIBUTION");
  missingConditionRoute.method = LLP_PSC_ATTRIBUTION_ALGORITHM;
  missingConditionRoute.methodStatus = LLP_PSC_ATTRIBUTION_METHOD_STATUS;
  assert.throws(() => assess(right, { policyPack: loadPolicyPack(missingCondition) }), (error) => error.code === LLP_PSC_ATTRIBUTION_ERROR_CODE.LLP_CONDITIONS_NOT_DECLARED);

  const forged = { ...POLICY, identity: { ...POLICY.identity, hash: `sha256:${"0".repeat(64)}` } };
  assert.throws(() => assess(right, { policyPack: forged }), (error) => error.code === LLP_PSC_ATTRIBUTION_ERROR_CODE.POLICY_IDENTITY_MISMATCH);
  assert.throws(() => assess(right, { targetProfile: "FUND_LIMITED_PARTNERSHIP" }), (error) => error.code === LLP_PSC_ATTRIBUTION_ERROR_CODE.UNSUPPORTED_TARGET_PROFILE);

  const input = graph(right);
  assert.throws(() => assessLlpPscAttributionV1({ policyPack: POLICY, ...input, targetEntityId: TARGET, caseRevision: { caseId: "other", revision: 5 } }), (error) => error.code === LLP_PSC_ATTRIBUTION_ERROR_CODE.INCONSISTENT_GRAPH_REFERENCE);
  assert.throws(() => assess(right, { claimSupport: [{ claimId: "not-operative", evidenceReferences: [EVIDENCE] }] }), (error) => error.code === LLP_PSC_ATTRIBUTION_ERROR_CODE.INVALID_SUPPORT_REFERENCE);
});

test("the LLP operation remains internal and isolated from providers, legacy, runtime and arithmetic", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "policy", "llpPscAttributionV1.js"), "utf8");
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
  assert.doesNotMatch(publicEntry, /llpPscAttributionV1|assessLlpPscAttributionV1|LLP_PSC_ATTRIBUTION_ALGORITHM/);
});
