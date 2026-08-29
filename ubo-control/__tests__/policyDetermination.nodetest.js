"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  APPLICABILITY_RESULT,
  CAPABILITY_CONTRACT_VERSION,
  CAPABILITY_OUTCOME_STATE,
  CANDIDATE_FACT_TYPE,
  CLAIM_STATE,
  IDENTITY_RESOLUTION_STATUS,
  PERCENTAGE_VALUE_TYPE,
  RELATIONSHIP_TYPE,
} = require("../contracts/constants");
const { CANONICAL_ENTITY_CATEGORY } = require("../domain/canonicalEntity");
const {
  addCanonicalEntity,
  adjudicateClaim,
  createOwnershipCase,
  intakeCapabilityResult,
  recordIdentityResolutionDecision,
} = require("../domain/ownershipCase");
const { GRAPH_DIMENSION, buildCanonicalOwnershipGraph } = require("../domain/ownershipGraph");
const { CALCULATION_STATUS, calculateEffectivePercentage } = require("../domain/percentageCalculation");
const {
  POLICY_TRUTH_VALUE,
  PolicyConfigurationError,
  evaluateConditionExpression,
} = require("../policy/conditionEvaluator");
const { loadPolicyPack } = require("../policy/policyPack");
const {
  BASIS_ASSESSMENT_STATE,
  BASIS_TYPE,
  POLICY_DETERMINATION_ALGORITHM,
  assessCalculationAgainstExclusiveThreshold,
  determinePolicyAssessment,
  evaluatePolicyApplicability,
} = require("../policy/policyDetermination");

const NOW = "2026-08-29T11:00:00.000Z";
const policyArtifact = require("../policies/uk-corporate/1.3-rc/policy.json");
const loadedPolicyPack = loadPolicyPack(policyArtifact);

function exact(value) {
  return { type: PERCENTAGE_VALUE_TYPE.EXACT, value };
}

function range(lowerBound, upperBound, lowerInclusive = true, upperInclusive = true) {
  return { type: PERCENTAGE_VALUE_TYPE.RANGE, lowerBound, upperBound, lowerInclusive, upperInclusive };
}

function unknown(reason = "not established") {
  return { type: PERCENTAGE_VALUE_TYPE.UNKNOWN, reason };
}

function edge(id, subject, object, relationship, measurement, qualifiers = {}) {
  return { id, subject, object, relationship, measurement, qualifiers };
}

function party(entityId, category) {
  const entityType = category === CANONICAL_ENTITY_CATEGORY.NATURAL_PERSON ? "NATURAL_PERSON" : "COMPANY";
  return { name: entityId, entityType, entityId, externalIdentifiers: [] };
}

function categoryFor(entityId, categories) {
  return categories[entityId] || (entityId.startsWith("person-")
    ? CANONICAL_ENTITY_CATEGORY.NATURAL_PERSON
    : CANONICAL_ENTITY_CATEGORY.LEGAL_ENTITY);
}

function operativeCase(edges, { caseId = "g23-case", categories = {}, target = "customer", factOrder } = {}) {
  const entityIds = [...new Set(edges.flatMap(({ subject, object }) => [subject, object]))];
  let caseState = createOwnershipCase({
    caseId,
    subjectReference: party(target, categoryFor(target, categories)),
    externalReferences: [{ system: "g23-test", referenceId: caseId }],
    createdAt: NOW,
  });
  entityIds.forEach((entityId) => {
    const category = categoryFor(entityId, categories);
    caseState = addCanonicalEntity(caseState, {
      entityId,
      category,
      primaryName: entityId,
      aliases: [],
      externalIdentifiers: [],
      entityTypeMetadata: {},
    }, { recordedAt: NOW });
  });
  const facts = (factOrder || edges).map((item) => {
    const fact = {
      factId: item.id,
      type: CANDIDATE_FACT_TYPE.RELATIONSHIP,
      subject: party(item.subject, categoryFor(item.subject, categories)),
      relationship: item.relationship,
      object: party(item.object, categoryFor(item.object, categories)),
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
    candidateFacts: facts,
    operationEvidenceReferences: [],
    issues: [],
  }, { operationId: `${caseId}-operation`, recordedAt: NOW });
  caseState.candidateClaims.forEach((claim) => {
    for (const [name, endpoint] of [["subject", claim.subject], ["object", claim.object]]) {
      caseState = recordIdentityResolutionDecision(caseState, {
        decisionId: `${claim.claimId}:${name}:identity`,
        candidatePartyKey: endpoint.candidatePartyKey,
        status: IDENTITY_RESOLUTION_STATUS.RESOLVED,
        entityId: endpoint.party.entityId,
        basisReasonCodes: ["G2_3_FIXTURE"],
        evidenceReferences: [],
        decidedAt: NOW,
        decisionOrigin: "G2_3_TEST",
      });
    }
    caseState = adjudicateClaim(caseState, {
      decisionId: `${claim.claimId}:operative`,
      claimId: claim.claimId,
      previousState: CLAIM_STATE.CANDIDATE,
      resultingState: CLAIM_STATE.OPERATIVE,
      reasonBasisCode: "G2_3_FIXTURE",
      supportingEvidenceReferences: [],
      decisionOrigin: "G2_3_TEST",
      decidedAt: NOW,
      supersededByClaimIds: [],
      adversarialClaimIds: [],
    });
  });
  return caseState;
}

function assessmentFor(edges, {
  entityType = "private_limited_company",
  target = "customer",
  categories = {},
  calculationRequests = [],
  facts = {},
  answers = {},
  caseId = "g23-case",
  factOrder,
} = {}) {
  const caseState = operativeCase(edges, { caseId, categories, target, factOrder });
  const graph = buildCanonicalOwnershipGraph(caseState);
  const calculations = calculationRequests.map(({ subjectEntityId, dimension }) => calculateEffectivePercentage(graph, {
    subjectEntityId,
    targetEntityId: target,
    dimension,
  }));
  const input = {
    loadedPolicyPack,
    caseContext: { entityType, subjectEntityId: target, jurisdiction: "GB" },
    caseState,
    graph,
    calculations,
    facts,
    answers,
  };
  return { input, result: determinePolicyAssessment(input) };
}

function economicEdge(id, subject, object, value, concept = "SHARE_OWNERSHIP") {
  return edge(id, subject, object, RELATIONSHIP_TYPE.ECONOMIC_OWNERSHIP, value, {
    currentState: "CURRENT",
    economicInterestConcept: concept,
  });
}

function votingEdge(id, subject, object, value, qualifiers = {}) {
  return edge(id, subject, object, RELATIONSHIP_TYPE.VOTING_RIGHTS, value, {
    currentState: "CURRENT",
    ...qualifiers,
  });
}

function basis(result, basisType, holderEntityId) {
  return result.basisAssessments.find((item) => item.basisType === basisType && item.holderEntityId === holderEntityId);
}

test("ubo-condition-v1 evaluator protects every three-valued AND truth combination", () => {
  const values = [POLICY_TRUTH_VALUE.TRUE, POLICY_TRUTH_VALUE.FALSE, POLICY_TRUTH_VALUE.UNKNOWN];
  const expected = {
    "TRUE|TRUE": "TRUE", "TRUE|FALSE": "FALSE", "TRUE|UNKNOWN": "UNKNOWN",
    "FALSE|TRUE": "FALSE", "FALSE|FALSE": "FALSE", "FALSE|UNKNOWN": "FALSE",
    "UNKNOWN|TRUE": "UNKNOWN", "UNKNOWN|FALSE": "FALSE", "UNKNOWN|UNKNOWN": "UNKNOWN",
  };
  const contextValue = { TRUE: true, FALSE: false, UNKNOWN: null };
  values.forEach((left) => values.forEach((right) => {
    assert.equal(evaluateConditionExpression("facts.left && facts.right", {
      facts: { left: contextValue[left], right: contextValue[right] },
    }), expected[`${left}|${right}`]);
  }));
});

test("ubo-condition-v1 evaluator protects every three-valued OR truth combination", () => {
  const values = [POLICY_TRUTH_VALUE.TRUE, POLICY_TRUTH_VALUE.FALSE, POLICY_TRUTH_VALUE.UNKNOWN];
  const expected = {
    "TRUE|TRUE": "TRUE", "TRUE|FALSE": "TRUE", "TRUE|UNKNOWN": "TRUE",
    "FALSE|TRUE": "TRUE", "FALSE|FALSE": "FALSE", "FALSE|UNKNOWN": "UNKNOWN",
    "UNKNOWN|TRUE": "TRUE", "UNKNOWN|FALSE": "UNKNOWN", "UNKNOWN|UNKNOWN": "UNKNOWN",
  };
  const contextValue = { TRUE: true, FALSE: false, UNKNOWN: null };
  values.forEach((left) => values.forEach((right) => {
    assert.equal(evaluateConditionExpression("facts.left || facts.right", {
      facts: { left: contextValue[left], right: contextValue[right] },
    }), expected[`${left}|${right}`]);
  }));
});

test("condition evaluator supports approved comparisons and precedence", () => {
  const context = { case: { entity_profile: "COMPANY" }, facts: { layers: 3, active: true }, params: { minimum: 3 } };
  assert.equal(evaluateConditionExpression("always", context), POLICY_TRUTH_VALUE.TRUE);
  assert.equal(evaluateConditionExpression("facts.layers == params.minimum", context), POLICY_TRUTH_VALUE.TRUE);
  assert.equal(evaluateConditionExpression("facts.layers != 2", context), POLICY_TRUTH_VALUE.TRUE);
  assert.equal(evaluateConditionExpression("facts.layers > 2", context), POLICY_TRUTH_VALUE.TRUE);
  assert.equal(evaluateConditionExpression("facts.layers >= 3", context), POLICY_TRUTH_VALUE.TRUE);
  assert.equal(evaluateConditionExpression("facts.layers < 4", context), POLICY_TRUTH_VALUE.TRUE);
  assert.equal(evaluateConditionExpression("facts.layers <= 3", context), POLICY_TRUTH_VALUE.TRUE);
  assert.equal(evaluateConditionExpression("case.entity_profile == 'COMPANY' && facts.active == true", context), POLICY_TRUTH_VALUE.TRUE);
});

test("missing and null values remain UNKNOWN except explicit null comparison", () => {
  assert.equal(evaluateConditionExpression("facts.missing == 0", {}), POLICY_TRUTH_VALUE.UNKNOWN);
  assert.equal(evaluateConditionExpression("facts.value == false", { facts: { value: null } }), POLICY_TRUTH_VALUE.UNKNOWN);
  assert.equal(evaluateConditionExpression("facts.missing == null", {}), POLICY_TRUTH_VALUE.TRUE);
  assert.equal(evaluateConditionExpression("facts.value == null", { facts: { value: null } }), POLICY_TRUTH_VALUE.TRUE);
  assert.equal(evaluateConditionExpression("facts.value != null", { facts: { value: 0 } }), POLICY_TRUTH_VALUE.TRUE);
  assert.equal(evaluateConditionExpression("facts.missing != null", {}), POLICY_TRUTH_VALUE.FALSE);
});

test("invalid conditions become policy configuration errors and no dynamic execution primitive exists", () => {
  assert.throws(
    () => evaluateConditionExpression("facts.value + 1", { facts: { value: 1 } }),
    (error) => error instanceof PolicyConfigurationError && error.code === "POLICY_CONFIGURATION_ERROR",
  );
  const source = fs.readFileSync(path.join(__dirname, "../policy/conditionEvaluator.js"), "utf8");
  assert.doesNotMatch(source, /\beval\s*\(|\bFunction\s*\(|new\s+Function|node:vm/);
});

test("Policy Pack applicability distinguishes COMPANY, LLP, configured route, and unknown context", () => {
  const policy = loadedPolicyPack.policyPack;
  assert.deepEqual(evaluatePolicyApplicability(policy, { entityType: "private_limited_company" }), {
    status: APPLICABILITY_RESULT.APPLIES,
    entityType: "private_limited_company",
    entityProfile: "COMPANY",
    rationaleCode: "ENTITY_TYPE_IN_POLICY_SCOPE",
  });
  assert.equal(evaluatePolicyApplicability(policy, { entityType: "limited_liability_partnership" }).entityProfile, "LLP");
  const routed = evaluatePolicyApplicability(policy, { entityType: "sole_trader" });
  assert.equal(routed.status, APPLICABILITY_RESULT.DOES_NOT_APPLY);
  assert.equal(routed.route, "sole_trader_kyc_policy");
  assert.equal(evaluatePolicyApplicability(policy, {}).status, APPLICABILITY_RESULT.UNKNOWN);
  assert.equal(evaluatePolicyApplicability(policy, { entityType: "unconfigured_entity" }).status, APPLICABILITY_RESULT.UNKNOWN);
});

function calculation(status, value) {
  return {
    status,
    ...(value === undefined ? {} : { aggregateKnownValue: value }),
  };
}

const exclusive25 = { value: 25, unit: "percent_exclusive" };

test("generic exclusive threshold reads exact below, equal, and above values without a hard-coded threshold", () => {
  assert.equal(assessCalculationAgainstExclusiveThreshold(calculation("COMPLETE", { type: "EXACT", value: "24.99" }), exclusive25).state, "NOT_SATISFIED");
  assert.equal(assessCalculationAgainstExclusiveThreshold(calculation("COMPLETE", { type: "EXACT", value: "25" }), exclusive25).state, "NOT_SATISFIED");
  assert.equal(assessCalculationAgainstExclusiveThreshold(calculation("COMPLETE", { type: "EXACT", value: "25.01" }), exclusive25).state, "SATISFIED");
  assert.equal(assessCalculationAgainstExclusiveThreshold(calculation("COMPLETE", { type: "EXACT", value: "10.01" }), { value: 10, unit: "percent_exclusive" }).state, "SATISFIED");
});

test("exclusive threshold range semantics respect every boundary", () => {
  const assess = (value) => assessCalculationAgainstExclusiveThreshold(calculation("COMPLETE", value), exclusive25).state;
  assert.equal(assess({ type: "RANGE", lowerBound: "5", upperBound: "20", lowerInclusive: true, upperInclusive: true }), "NOT_SATISFIED");
  assert.equal(assess({ type: "RANGE", lowerBound: "26", upperBound: "50", lowerInclusive: true, upperInclusive: true }), "SATISFIED");
  assert.equal(assess({ type: "RANGE", lowerBound: "20", upperBound: "30", lowerInclusive: true, upperInclusive: true }), "INDETERMINATE");
  assert.equal(assess({ type: "RANGE", lowerBound: "25", upperBound: "50", lowerInclusive: false, upperInclusive: true }), "SATISFIED");
  assert.equal(assess({ type: "RANGE", lowerBound: "25", upperBound: "50", lowerInclusive: true, upperInclusive: true }), "INDETERMINATE");
});

test("partial, unresolved, and NO_PATH calculations never create false negative conclusions", () => {
  assert.equal(assessCalculationAgainstExclusiveThreshold(calculation("PARTIAL", { type: "EXACT", value: "30" }), exclusive25).state, "SATISFIED");
  assert.equal(assessCalculationAgainstExclusiveThreshold(calculation("PARTIAL", { type: "EXACT", value: "20" }), exclusive25).state, "INDETERMINATE");
  assert.equal(assessCalculationAgainstExclusiveThreshold(calculation("UNRESOLVED"), exclusive25).state, "INDETERMINATE");
  const noPath = assessCalculationAgainstExclusiveThreshold(calculation("NO_PATH"), exclusive25);
  assert.equal(noPath.state, "INDETERMINATE");
  assert.equal(noPath.rationaleCode, "NO_ESTABLISHED_PATH_IS_NOT_ZERO");
});

test("S01-style COMPANY and S02-style LLP economic interests qualify using pack profile semantics", () => {
  const company = assessmentFor([
    economicEdge("s01-direct", "person-alice", "customer", exact(40)),
  ], { calculationRequests: [{ subjectEntityId: "person-alice", dimension: GRAPH_DIMENSION.ECONOMIC }], caseId: "s01-policy" }).result;
  assert.equal(basis(company, BASIS_TYPE.ECONOMIC_INTEREST, "person-alice").state, BASIS_ASSESSMENT_STATE.SATISFIED);
  assert.deepEqual(company.qualifyingPersons[0].roles, ["beneficial_owner"]);

  const llp = assessmentFor([
    economicEdge("s02-surplus", "person-bob", "customer", exact(30), "SURPLUS_ASSET_RIGHTS"),
  ], {
    entityType: "limited_liability_partnership",
    calculationRequests: [{ subjectEntityId: "person-bob", dimension: GRAPH_DIMENSION.ECONOMIC }],
    caseId: "s02-policy",
  }).result;
  const llpBasis = basis(llp, BASIS_TYPE.ECONOMIC_INTEREST, "person-bob");
  assert.equal(llpBasis.state, BASIS_ASSESSMENT_STATE.SATISFIED);
  assert.equal(llpBasis.entityProfile, "LLP");
  assert.equal(llpBasis.policyConcept, "SURPLUS_ASSET_RIGHTS");
});

test("R02 consumes the pinned G2.2 indirect result without recalculating paths", () => {
  const { result } = assessmentFor([
    economicEdge("person-holdco", "person-alice", "holdco", exact(60)),
    economicEdge("holdco-customer", "holdco", "customer", exact(70)),
  ], {
    calculationRequests: [{ subjectEntityId: "person-alice", dimension: GRAPH_DIMENSION.ECONOMIC }],
    facts: { ownership_layers: 2 },
    caseId: "r02-policy",
  });
  const indirect = basis(result, BASIS_TYPE.INDIRECT_CALCULATION, "person-alice");
  assert.equal(indirect.state, BASIS_ASSESSMENT_STATE.SATISFIED);
  assert.equal(indirect.calculationReference.status, CALCULATION_STATUS.COMPLETE);
  assert.equal(basis(result, BASIS_TYPE.ECONOMIC_INTEREST, "person-alice").calculationReference.calculationAlgorithm, "ubo-percentage-lookthrough-v1");
});

test("economic and voting qualification remain independent", () => {
  const { result } = assessmentFor([
    economicEdge("economic", "person-alice", "customer", exact(30)),
    votingEdge("voting", "person-bob", "customer", exact(40)),
  ], {
    calculationRequests: [
      { subjectEntityId: "person-alice", dimension: GRAPH_DIMENSION.ECONOMIC },
      { subjectEntityId: "person-alice", dimension: GRAPH_DIMENSION.VOTING },
      { subjectEntityId: "person-bob", dimension: GRAPH_DIMENSION.ECONOMIC },
      { subjectEntityId: "person-bob", dimension: GRAPH_DIMENSION.VOTING },
    ],
    caseId: "separate-dimensions",
  });
  assert.deepEqual(result.qualifyingPersons.find(({ entityId }) => entityId === "person-alice").roles, ["beneficial_owner"]);
  assert.deepEqual(result.qualifyingPersons.find(({ entityId }) => entityId === "person-bob").roles, ["controller_voting"]);
  assert.equal(basis(result, BASIS_TYPE.VOTING_CONTROL, "person-alice").state, BASIS_ASSESSMENT_STATE.INDETERMINATE);
  assert.equal(basis(result, BASIS_TYPE.ECONOMIC_INTEREST, "person-bob").state, BASIS_ASSESSMENT_STATE.INDETERMINATE);
});

test("one natural person carries multiple qualifying roles and separately auditable bases", () => {
  const { result } = assessmentFor([
    economicEdge("economic", "person-alice", "customer", exact(40)),
    votingEdge("voting", "person-alice", "customer", exact(40)),
    edge("other", "person-alice", "customer", RELATIONSHIP_TYPE.SIGNIFICANT_INFLUENCE_OR_CONTROL, undefined, { currentState: "CURRENT" }),
  ], {
    calculationRequests: [
      { subjectEntityId: "person-alice", dimension: GRAPH_DIMENSION.ECONOMIC },
      { subjectEntityId: "person-alice", dimension: GRAPH_DIMENSION.VOTING },
    ],
    caseId: "multiple-bases",
  });
  assert.equal(result.qualifyingPersons.length, 1);
  assert.deepEqual(result.qualifyingPersons[0].roles, ["beneficial_owner", "controller_other_means", "controller_voting"]);
  assert.equal(result.qualifyingPersons[0].bases.length, 3);
  assert.equal(result.qualifyingPersons[0].policyPackId, "UBO-UK-CORPORATE");
  assert.match(result.qualifyingPersons[0].policyHash, /^sha256:[a-f0-9]{64}$/);
});

test("a qualifying legal-entity holder remains unresolved and is not emitted as a person", () => {
  const { result } = assessmentFor([
    economicEdge("legal-holder", "holdco", "customer", exact(60)),
  ], {
    calculationRequests: [{ subjectEntityId: "holdco", dimension: GRAPH_DIMENSION.ECONOMIC }],
    caseId: "legal-holder",
  });
  const legalBasis = basis(result, BASIS_TYPE.ECONOMIC_INTEREST, "holdco");
  assert.equal(legalBasis.state, BASIS_ASSESSMENT_STATE.SATISFIED);
  assert.equal(legalBasis.holderResolution, "ULTIMATE_NATURAL_PERSON_UNRESOLVED");
  assert.deepEqual(result.qualifyingPersons, []);
});

test("S15 majority COMPANY and LLP appointment semantics qualify without treating generic rights as majority", () => {
  const company = assessmentFor([
    edge("s15-company", "person-alice", "customer", RELATIONSHIP_TYPE.BOARD_APPOINTMENT_RIGHT, undefined, {
      currentState: "CURRENT", entityProfile: "COMPANY", controlConcept: "BOARD_APPOINTMENT_RIGHTS", scope: "MAJORITY",
    }),
    edge("generic-company", "person-bob", "customer", RELATIONSHIP_TYPE.BOARD_APPOINTMENT_RIGHT, undefined, {
      currentState: "CURRENT", entityProfile: "COMPANY", controlConcept: "BOARD_APPOINTMENT_RIGHTS",
    }),
  ], { caseId: "s15-company-policy" }).result;
  assert.equal(basis(company, BASIS_TYPE.APPOINTMENT_CONTROL, "person-alice").state, BASIS_ASSESSMENT_STATE.SATISFIED);
  assert.equal(basis(company, BASIS_TYPE.APPOINTMENT_CONTROL, "person-bob").state, BASIS_ASSESSMENT_STATE.INDETERMINATE);
  assert.deepEqual(company.qualifyingPersons[0].roles, ["controller_appointment"]);

  const llp = assessmentFor([
    edge("s15-llp", "person-carol", "customer", RELATIONSHIP_TYPE.FORMAL_CONTROL_RIGHT, undefined, {
      currentState: "CURRENT", entityProfile: "LLP", controlConcept: "MANAGEMENT_APPOINTMENT_RIGHTS",
      managementBody: "persons_entitled_to_participate_in_management", scope: "MAJORITY",
    }),
  ], { entityType: "limited_liability_partnership", caseId: "s15-llp-policy" }).result;
  assert.equal(basis(llp, BASIS_TYPE.APPOINTMENT_CONTROL, "person-carol").state, BASIS_ASSESSMENT_STATE.SATISFIED);
  assert.equal(llp.qualifyingPersons[0].roles[0], "controller_appointment");
});

test("explicit significant control qualifies while S16-style ambiguity requires review", () => {
  const { result } = assessmentFor([
    edge("p02-established", "person-alice", "customer", RELATIONSHIP_TYPE.SIGNIFICANT_INFLUENCE_OR_CONTROL, undefined, { currentState: "CURRENT" }),
    edge("s16-ambiguous", "person-bob", "customer", RELATIONSHIP_TYPE.SIGNIFICANT_INFLUENCE_OR_CONTROL, undefined, {
      currentState: "CURRENT", ambiguity: "DELIBERATELY_AMBIGUOUS", assertedRight: "veto over strategic decisions",
    }),
  ], { caseId: "r06-policy" });
  assert.equal(basis(result, BASIS_TYPE.OTHER_SIGNIFICANT_CONTROL, "person-alice").state, BASIS_ASSESSMENT_STATE.SATISFIED);
  assert.equal(basis(result, BASIS_TYPE.OTHER_SIGNIFICANT_CONTROL, "person-bob").state, BASIS_ASSESSMENT_STATE.REVIEW_REQUIRED);
  assert.equal(result.qualifyingPersons.some(({ entityId }) => entityId === "person-bob"), false);
});

test("requirement applicability remains separate from basis assessment and later gap planning", () => {
  const { result } = assessmentFor([
    economicEdge("direct", "person-alice", "customer", exact(40)),
  ], {
    calculationRequests: [{ subjectEntityId: "person-alice", dimension: GRAPH_DIMENSION.ECONOMIC }],
    facts: {},
    caseId: "requirement-applicability",
  });
  const r01 = result.requirementAssessments.find(({ requirementId }) => requirementId === "UBO-R01");
  const r02 = result.requirementAssessments.find(({ requirementId }) => requirementId === "UBO-R02");
  assert.equal(r01.applicability, APPLICABILITY_RESULT.APPLIES);
  assert.equal(r02.applicability, APPLICABILITY_RESULT.UNKNOWN);
  assert.equal(Object.keys(result).some((key) => /gap|informationNeed|action|finalOutcome|snapshot/i.test(key)), false);
});

test("policy result pins identities, is immutable, deterministic, and does not mutate inputs", () => {
  const edges = [
    economicEdge("a", "person-alice", "holdco", exact(60)),
    economicEdge("b", "holdco", "customer", exact(70)),
  ];
  const firstSetup = assessmentFor(edges, {
    calculationRequests: [{ subjectEntityId: "person-alice", dimension: GRAPH_DIMENSION.ECONOMIC }],
    facts: { ownership_layers: 2 },
    caseId: "deterministic-policy",
  });
  const before = structuredClone({
    caseContext: firstSetup.input.caseContext,
    caseState: firstSetup.input.caseState,
    graph: firstSetup.input.graph,
    calculations: firstSetup.input.calculations,
    facts: firstSetup.input.facts,
  });
  const second = assessmentFor(edges, {
    calculationRequests: [{ subjectEntityId: "person-alice", dimension: GRAPH_DIMENSION.ECONOMIC }],
    facts: { ownership_layers: 2 },
    caseId: "deterministic-policy",
    factOrder: [...edges].reverse(),
  }).result;
  assert.deepEqual(firstSetup.result, second);
  assert.equal(firstSetup.result.policyIdentity.determinationAlgorithm, POLICY_DETERMINATION_ALGORITHM);
  assert.equal(firstSetup.result.policyIdentity.policyPackId, "UBO-UK-CORPORATE");
  assert.match(firstSetup.result.policyIdentity.policyHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(Object.isFrozen(firstSetup.result), true);
  assert.equal(Object.isFrozen(firstSetup.result.qualifyingPersons), true);
  assert.deepEqual({
    caseContext: firstSetup.input.caseContext,
    caseState: firstSetup.input.caseState,
    graph: firstSetup.input.graph,
    calculations: firstSetup.input.calculations,
    facts: firstSetup.input.facts,
  }, before);
  assert.throws(
    () => determinePolicyAssessment({
      ...firstSetup.input,
      loadedPolicyPack: {
        policyPack: firstSetup.input.loadedPolicyPack.policyPack,
        identity: { ...firstSetup.input.loadedPolicyPack.identity, hash: `sha256:${"0".repeat(64)}` },
      },
    }),
    (error) => error.code === "POLICY_CONFIGURATION_ERROR",
  );
});
