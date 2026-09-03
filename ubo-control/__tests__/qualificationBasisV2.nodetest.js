"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const V16 = require("../policies/uk-corporate/1.6-rc/policy.json");
const { CANONICAL_ENTITY_CATEGORY } = require("../domain/canonicalEntity");
const { GRAPH_DIMENSION } = require("../domain/ownershipGraph");
const { CALCULATION_ALGORITHM, CALCULATION_STATUS } = require("../domain/percentageCalculation");
const {
  QUALIFICATION_ASSESSMENT_STATE,
  QUALIFICATION_BASIS_ERROR_CODE,
  QUALIFICATION_BASIS_VERSION,
  QUALIFICATION_CLASSIFICATION,
  QUALIFICATION_DIRECTNESS,
  QualificationBasisV2Error,
  createQualificationBasisV2,
  validateQualificationBasisV2,
} = require("../domain/qualificationBasisV2");
const {
  EFFECTIVE_INTEREST_QUALIFICATION_VERSION,
  assessEffectiveInterestQualificationV2,
} = require("../policy/effectiveInterestQualificationV2");
const { loadPolicyPack } = require("../policy/policyPack");

const GRAPH_VERSION = `ubo-graph-v1:${"a".repeat(64)}`;
const HOLDER = Object.freeze({ entityId: "person-alice", category: CANONICAL_ENTITY_CATEGORY.NATURAL_PERSON });
const TARGET = "company-customer";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadedPolicy({ statutoryComparator = ">", statutoryValue = 25, firm } = {}) {
  const policy = clone(V16);
  policy.statutoryThresholds.economic.comparator = statutoryComparator;
  policy.statutoryThresholds.economic.value = statutoryValue;
  policy.statutoryThresholds.voting.comparator = statutoryComparator;
  policy.statutoryThresholds.voting.value = statutoryValue;
  if (firm) {
    policy.firmCollectionThreshold.enabled = true;
    policy.firmCollectionThreshold.value = firm.value;
    policy.firmCollectionThreshold.comparator = firm.comparator;
  }
  return loadPolicyPack(policy);
}

function exact(value) {
  return { type: "EXACT", value: String(value) };
}

function range(lowerBound, upperBound, lowerInclusive = true, upperInclusive = true) {
  return {
    type: "RANGE",
    lowerBound: String(lowerBound),
    upperBound: String(upperBound),
    lowerInclusive,
    upperInclusive,
  };
}

function calculation(value, {
  status = CALCULATION_STATUS.COMPLETE,
  dimension = GRAPH_DIMENSION.ECONOMIC,
  paths = [["relationship-direct"]],
  unresolvedPaths = [],
  cycles = [],
  extra = {},
} = {}) {
  const result = {
    calculationAlgorithm: CALCULATION_ALGORITHM,
    graphVersion: GRAPH_VERSION,
    subjectEntityId: HOLDER.entityId,
    targetEntityId: TARGET,
    dimension,
    status,
    knownPaths: paths.map((relationshipIds, index) => ({
      pathId: `path-${index + 1}`,
      relationshipIds,
      contribution: value,
    })),
    unresolvedPaths,
    cycles,
    ...extra,
  };
  if (value !== undefined) result.aggregateKnownValue = value;
  return result;
}

function assess(calculationResult, options = {}) {
  return assessEffectiveInterestQualificationV2({
    policyPack: options.policyPack || loadedPolicy(options.policyOptions),
    calculationResult,
    holderEntity: options.holderEntity || HOLDER,
    targetEntityId: TARGET,
    caseRevision: options.caseRevision || { caseId: "case-1", revision: 7, revisionId: "revision-7" },
    graphVersion: GRAPH_VERSION,
  });
}

function statutory(result) {
  return result.basisRecords.find(({ classification }) => classification === QUALIFICATION_CLASSIFICATION.STATUTORY);
}

test("QualificationBasis v2 is deterministic, immutable, data-only and losslessly serializable", () => {
  const input = calculation(exact(40), { paths: [["relationship-direct"], ["relationship-a", "relationship-b"]] });
  const before = clone(input);
  const first = assess(input);
  const second = assess({ ...input, knownPaths: [...input.knownPaths].reverse() });
  const basis = statutory(first);
  assert.equal(first.assessmentSchemaVersion, EFFECTIVE_INTEREST_QUALIFICATION_VERSION);
  assert.equal(basis.basisSchemaVersion, QUALIFICATION_BASIS_VERSION);
  assert.equal(validateQualificationBasisV2(basis), true);
  assert.equal(first.assessmentId, second.assessmentId);
  assert.equal(basis.basisId, statutory(second).basisId);
  assert.deepEqual(JSON.parse(JSON.stringify(first)), first);
  assert.deepEqual(input, before);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.basisRecords), true);
  assert.equal(Object.isFrozen(basis.threshold), true);
});

test("QualificationBasis v2 rejects malformed vocabulary and a forged deterministic ID", () => {
  const basis = clone(statutory(assess(calculation(exact(40)))));
  for (const mutation of [
    { route: "NOT_A_ROUTE" },
    { classification: "NOT_A_CLASSIFICATION" },
    { dimension: "CONTROL", threshold: { ...basis.threshold, dimension: "CONTROL" } },
    { directness: "MAYBE_DIRECT" },
  ]) assert.throws(() => createQualificationBasisV2({ ...basis, ...mutation }), QualificationBasisV2Error);
  basis.threshold.value = 30;
  assert.throws(() => validateQualificationBasisV2(basis), (error) => (
    error.code === QUALIFICATION_BASIS_ERROR_CODE.INVALID_BASIS
  ));
});

test("QualificationBasis v2 can faithfully model later routes without generating placeholder assessments", () => {
  const template = clone(statutory(assess(calculation(exact(40)))));
  delete template.basisId;
  delete template.dimension;
  delete template.threshold;
  delete template.calculationReference;
  delete template.recordedCalculation;
  template.orderedPathReferences = [];
  template.route = "MANAGEMENT_CONTROL";
  template.condition = "CONTROL_OVER_MANAGEMENT";
  template.method = "EVIDENCE_AND_REVIEW_ASSESSMENT";
  template.methodStatus = "REVIEW_DEPENDENT";
  template.methodVersion = "management-control-assessment-v2";
  template.assessmentState = "REVIEW_REQUIRED";
  template.reasonCode = "SPECIALIST_REVIEW_REQUIRED";
  const management = createQualificationBasisV2(template);
  const psc = createQualificationBasisV2({
    ...template,
    route: "PSC_CONDITION_ATTRIBUTION",
    condition: "VOTING_GT_THRESHOLD",
    method: "ubo-psc-attribution-v1",
    methodStatus: "STATUTORY_ATTRIBUTION_SEMANTICS",
    methodVersion: "ubo-psc-attribution-v1",
  });
  assert.equal(validateQualificationBasisV2(management), true);
  assert.equal(validateQualificationBasisV2(psc), true);
  const effectiveOnly = assess(calculation(exact(40)));
  assert.deepEqual(effectiveOnly.basisRecords.map(({ route }) => route), ["EFFECTIVE_INTEREST"]);
});

test("effective-interest qualification validates exact schema-1.3 policy identity and route pins", () => {
  const rawPolicy = clone(V16);
  assert.throws(() => assessEffectiveInterestQualificationV2({
    policyPack: rawPolicy,
    calculationResult: calculation(exact(40)),
    holderEntity: HOLDER,
    targetEntityId: TARGET,
    graphVersion: GRAPH_VERSION,
  }), (error) => error.code === QUALIFICATION_BASIS_ERROR_CODE.POLICY_IDENTITY_REQUIRED);

  const loaded = loadedPolicy();
  const wrongIdentity = { ...loaded, identity: { ...loaded.identity, hash: `sha256:${"0".repeat(64)}` } };
  assert.throws(() => assess(calculation(exact(40)), { policyPack: wrongIdentity }), (error) => (
    error.code === QUALIFICATION_BASIS_ERROR_CODE.POLICY_IDENTITY_MISMATCH
  ));

  const wrongMethodPolicy = clone(V16);
  wrongMethodPolicy.qualificationDoctrine.routes.find(({ id }) => id === "EFFECTIVE_INTEREST").method = "other-method-v1";
  assert.throws(() => assess(calculation(exact(40)), { policyPack: loadPolicyPack(wrongMethodPolicy) }), (error) => (
    error.code === QUALIFICATION_BASIS_ERROR_CODE.UNSUPPORTED_ROUTE_METHOD
  ));

  const wrongStatusPolicy = clone(V16);
  wrongStatusPolicy.qualificationDoctrine.routes.find(({ id }) => id === "EFFECTIVE_INTEREST").methodStatus = "NOT_ADOPTED";
  assert.throws(() => assess(calculation(exact(40)), { policyPack: loadPolicyPack(wrongStatusPolicy) }), (error) => (
    error.code === QUALIFICATION_BASIS_ERROR_CODE.UNSUPPORTED_ROUTE_METHOD_STATUS
  ));

  const absentRoutePolicy = clone(V16);
  absentRoutePolicy.qualificationDoctrine.routes = absentRoutePolicy.qualificationDoctrine.routes
    .filter(({ id }) => id !== "EFFECTIVE_INTEREST");
  assert.throws(() => assess(calculation(exact(40)), { policyPack: loadPolicyPack(absentRoutePolicy) }), (error) => (
    error.code === QUALIFICATION_BASIS_ERROR_CODE.ROUTE_NOT_DECLARED
  ));

  const historical = require("../policies/uk-corporate/1.5-rc/policy.json");
  assert.throws(() => assess(calculation(exact(40)), { policyPack: loadPolicyPack(historical) }), (error) => (
    error.code === QUALIFICATION_BASIS_ERROR_CODE.UNSUPPORTED_POLICY_SCHEMA
  ));
});

test("only canonical natural persons may hold a final QualificationBasis", () => {
  assert.throws(() => assess(calculation(exact(40)), {
    holderEntity: { entityId: HOLDER.entityId, category: CANONICAL_ENTITY_CATEGORY.LEGAL_ENTITY },
  }), (error) => error.code === QUALIFICATION_BASIS_ERROR_CODE.INELIGIBLE_HOLDER);
});

test("statutory exclusive and inclusive comparators preserve the 25 percent boundary", () => {
  const exclusive = [24.99, 25, 25.01].map((value) => statutory(assess(calculation(exact(value)))).assessmentState);
  const inclusive = [24.99, 25, 25.01].map((value) => statutory(assess(calculation(exact(value)), {
    policyOptions: { statutoryComparator: ">=" },
  })).assessmentState);
  assert.deepEqual(exclusive, ["NOT_SATISFIED", "NOT_SATISFIED", "SATISFIED"]);
  assert.deepEqual(inclusive, ["NOT_SATISFIED", "SATISFIED", "SATISFIED"]);
});

test("exclusive range threshold semantics retain endpoint attainability", () => {
  const values = [
    range(25, 50, false, true),
    range(25, 50, true, true),
    range(10, 25, true, true),
  ];
  assert.deepEqual(values.map((value) => statutory(assess(calculation(value))).assessmentState), [
    "SATISFIED", "INDETERMINATE", "NOT_SATISFIED",
  ]);
});

test("inclusive range threshold semantics retain endpoint attainability", () => {
  const options = { policyOptions: { statutoryComparator: ">=" } };
  const values = [
    range(25, 50, true, true),
    range(25, 50, false, true),
    range(10, 25, true, true),
    range(10, 25, true, false),
  ];
  assert.deepEqual(values.map((value) => statutory(assess(calculation(value), options)).assessmentState), [
    "SATISFIED", "SATISFIED", "INDETERMINATE", "NOT_SATISFIED",
  ]);
});

test("PARTIAL, UNRESOLVED, cycles and NO_PATH remain conservative", () => {
  const partialSatisfied = calculation(range(30, 40), {
    status: CALCULATION_STATUS.PARTIAL,
    unresolvedPaths: [{ pathId: "path-u", relationshipIds: ["relationship-u"], reasons: ["UNKNOWN_PERCENTAGE"] }],
  });
  const partialUnknown = calculation(exact(10), {
    status: CALCULATION_STATUS.PARTIAL,
    unresolvedPaths: [{ pathId: "path-u", relationshipIds: ["relationship-u"], reasons: ["UNKNOWN_PERCENTAGE"] }],
  });
  const unresolved = calculation(undefined, {
    status: CALCULATION_STATUS.UNRESOLVED,
    paths: [],
    unresolvedPaths: [{ pathId: "path-u", relationshipIds: ["relationship-u"], reasons: ["UNKNOWN_PERCENTAGE"] }],
  });
  const cycle = calculation(undefined, {
    status: CALCULATION_STATUS.UNRESOLVED,
    paths: [],
    cycles: [{ cycleId: "cycle-1", relationshipIds: ["relationship-cycle"], repeatedEntityId: HOLDER.entityId }],
  });
  const noPath = calculation(undefined, { status: CALCULATION_STATUS.NO_PATH, paths: [] });
  const unknown = calculation({ type: "UNKNOWN", reason: "not established" });
  assert.equal(statutory(assess(partialSatisfied)).assessmentState, "SATISFIED");
  assert.equal(statutory(assess(partialUnknown)).assessmentState, "INDETERMINATE");
  assert.equal(statutory(assess(unresolved)).assessmentState, "INDETERMINATE");
  assert.equal(statutory(assess(cycle)).assessmentState, "INDETERMINATE");
  assert.equal(statutory(assess(unknown)).assessmentState, "INDETERMINATE");
  assert.deepEqual({
    state: statutory(assess(noPath)).assessmentState,
    reason: statutory(assess(noPath)).reasonCode,
    recordedValue: statutory(assess(noPath)).recordedCalculation.value,
  }, {
    state: "INDETERMINATE",
    reason: "NO_ESTABLISHED_PATH_IS_NOT_ZERO",
    recordedValue: undefined,
  });
});

test("directness is derived only from all recorded contributing paths", () => {
  assert.equal(statutory(assess(calculation(exact(40)))).directness, QUALIFICATION_DIRECTNESS.DIRECT);
  assert.equal(statutory(assess(calculation(exact(40), { paths: [["r1", "r2"]] }))).directness, QUALIFICATION_DIRECTNESS.INDIRECT);
  assert.equal(statutory(assess(calculation(exact(40), { paths: [["r1"], ["r2", "r3"]] }))).directness, QUALIFICATION_DIRECTNESS.DIRECT_AND_INDIRECT);
  assert.equal(statutory(assess(calculation(undefined, { status: CALCULATION_STATUS.NO_PATH, paths: [] }))).directness, QUALIFICATION_DIRECTNESS.NOT_ESTABLISHED);
});

test("economic and voting calculations select distinct policy thresholds without substitution", () => {
  const policy = clone(V16);
  policy.statutoryThresholds.economic.value = 25;
  policy.statutoryThresholds.voting.value = 30;
  const loaded = loadPolicyPack(policy);
  const economic = statutory(assess(calculation(exact(27)), { policyPack: loaded }));
  const voting = statutory(assess(calculation(exact(27), { dimension: GRAPH_DIMENSION.VOTING }), { policyPack: loaded }));
  assert.equal(economic.assessmentState, QUALIFICATION_ASSESSMENT_STATE.SATISFIED);
  assert.equal(voting.assessmentState, QUALIFICATION_ASSESSMENT_STATE.NOT_SATISFIED);
  assert.equal(economic.threshold.policyFieldReference, "statutoryThresholds.economic");
  assert.equal(voting.threshold.policyFieldReference, "statutoryThresholds.voting");
  assert.equal(economic.dimension, "ECONOMIC");
  assert.equal(voting.dimension, "VOTING");
  assert.notEqual(economic.basisId, voting.basisId);
});

test("disabled firm overlay emits only the statutory basis", () => {
  const result = assess(calculation(exact(15)));
  assert.equal(result.basisRecords.length, 1);
  assert.equal(result.statutoryBasisIds.length, 1);
  assert.deepEqual(result.firmPolicyBasisIds, []);
});

test("enabled firm overlay retains simultaneous statutory and firm classifications", () => {
  const result = assess(calculation(exact(15)), { policyOptions: { firm: { value: 10, comparator: ">=" } } });
  const statutoryBasis = statutory(result);
  const firmBasis = result.basisRecords.find(({ classification }) => classification === QUALIFICATION_CLASSIFICATION.FIRM_POLICY);
  assert.equal(result.basisRecords.length, 2);
  assert.equal(result.statutoryBasisIds.length, 1);
  assert.equal(result.firmPolicyBasisIds.length, 1);
  assert.equal(statutoryBasis.assessmentState, "NOT_SATISFIED");
  assert.equal(firmBasis.assessmentState, "SATISFIED");
});

test("enabled firm overlay does not overwrite or suppress a satisfied statutory basis", () => {
  const result = assess(calculation(exact(30)), { policyOptions: { firm: { value: 10, comparator: ">=" } } });
  const statutoryBasis = statutory(result);
  const firmBasis = result.basisRecords.find(({ classification }) => classification === QUALIFICATION_CLASSIFICATION.FIRM_POLICY);
  assert.equal(statutoryBasis.assessmentState, "SATISFIED");
  assert.equal(firmBasis.assessmentState, "SATISFIED");
  assert.equal(firmBasis.projectedRole, "firm_policy_qualifying_person");
  assert.notEqual(statutoryBasis.basisId, firmBasis.basisId);
});

test("firm threshold safety accepts broader/equal rules and rejects a narrower population", () => {
  for (const firm of [{ value: 25, comparator: ">" }, { value: 25, comparator: ">=" }, { value: 10, comparator: ">" }, { value: 10, comparator: ">=" }]) {
    assert.doesNotThrow(() => assess(calculation(exact(30)), { policyOptions: { firm } }));
  }
  for (const firm of [{ value: 50, comparator: ">" }, { value: 50, comparator: ">=" }]) {
    assert.throws(() => assess(calculation(exact(30)), { policyOptions: { firm } }), (error) => (
      error.code === QUALIFICATION_BASIS_ERROR_CODE.UNSAFE_FIRM_THRESHOLD
      && error.details.statutoryAssessmentState === "SATISFIED"
    ));
  }
  assert.throws(() => assess(calculation(exact(30)), {
    policyOptions: { statutoryComparator: ">=", firm: { value: 25, comparator: ">" } },
  }), (error) => error.code === QUALIFICATION_BASIS_ERROR_CODE.UNSAFE_FIRM_THRESHOLD);
});

test("route coverage keeps negative effective-interest assessment scoped rather than final", () => {
  const result = assess(calculation(exact(10)));
  assert.deepEqual(result.assessedRoutes, ["EFFECTIVE_INTEREST"]);
  assert.deepEqual(result.unassessedRoutes, ["MANAGEMENT_CONTROL", "PSC_CONDITION_ATTRIBUTION"]);
  assert.equal(result.scope, "ROUTE_SPECIFIC_NOT_FINAL_PERSON_DETERMINATION");
  assert.equal(result.routeCoverageComplete, false);
  assert.equal(statutory(result).assessmentState, "NOT_SATISFIED");
  assert.equal(Object.prototype.hasOwnProperty.call(result, "qualifies"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result, "isUbo"), false);
});

test("calculation reference fidelity preserves paths, support and value without recomputation", () => {
  const evidenceReference = { system: "test-registry", referenceType: "REGISTER", referenceId: "evidence-1" };
  const input = calculation(range(25, 50, false, true), {
    paths: [["relationship-b", "relationship-a"]],
    extra: {
      calculationId: "recorded-calculation-1",
      relationshipReferences: [{
        relationshipId: "relationship-a",
        supportingClaimIds: ["claim-2", "claim-1"],
        evidenceReferences: [evidenceReference],
      }],
    },
  });
  const before = clone(input);
  const basis = statutory(assess(input));
  assert.deepEqual(basis.recordedCalculation.value, range(25, 50, false, true));
  assert.equal(basis.calculationReference.calculationId, "recorded-calculation-1");
  assert.deepEqual(basis.orderedPathReferences[0].relationshipIds, ["relationship-b", "relationship-a"]);
  assert.deepEqual(basis.operativeClaimReferences, ["claim-1", "claim-2"]);
  assert.deepEqual(basis.evidenceReferences, [evidenceReference]);
  assert.deepEqual(input, before);
});

test("inconsistent calculation identity and dimensions fail through stable typed errors", () => {
  assert.throws(() => assess({ ...calculation(exact(40)), targetEntityId: "other-target" }), (error) => (
    error instanceof QualificationBasisV2Error && error.code === QUALIFICATION_BASIS_ERROR_CODE.INCONSISTENT_CALCULATION
  ));
  assert.throws(() => assess({ ...calculation(exact(40)), dimension: "CONTROL" }), (error) => (
    error.code === QUALIFICATION_BASIS_ERROR_CODE.DIMENSION_NOT_DECLARED
  ));
  assert.throws(() => assess({ ...calculation(exact(40)), policyIdentity: { policyPackId: "wrong" } }), (error) => (
    error.code === QUALIFICATION_BASIS_ERROR_CODE.INCONSISTENT_CALCULATION
  ));
});
