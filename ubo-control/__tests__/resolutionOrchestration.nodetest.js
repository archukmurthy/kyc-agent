"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  APPLICABILITY_RESULT,
  CAPABILITY_OUTCOME_STATE,
  REQUIREMENT_STATE,
  RESOLUTION_STRATEGY,
} = require("../contracts/constants");
const { CANONICAL_ENTITY_CATEGORY } = require("../domain/canonicalEntity");
const { addCanonicalEntity, createOwnershipCase } = require("../domain/ownershipCase");
const { buildCanonicalOwnershipGraph } = require("../domain/ownershipGraph");
const {
  INFORMATION_NEED_CONCEPT,
  reconcileInformationNeeds,
} = require("../domain/resolutionArtifacts");
const {
  ACTION_INTENT_TYPE,
  FALLBACK_DECISION_ORIGIN,
  FALLBACK_EXHAUSTION_DECISION,
  OPTION_APPLICABILITY_STATE,
  RESOLUTION_ATTEMPT_OUTCOME,
  createFallbackExhaustionDecision,
  createResolutionAttempt,
  validateResolutionAttemptHistory,
} = require("../domain/resolutionOrchestrationArtifacts");
const { loadPolicyPack } = require("../policy/policyPack");
const {
  CUSTOMER_PROJECTION_STATE,
  ORCHESTRATION_STATE,
  PSC_DISCREPANCY_STATE,
  UBO_TERMINAL_OUTCOME,
  orchestrateResolution,
} = require("../policy/resolutionOrchestration");

const NOW = "2026-08-29T15:00:00.000Z";
const loadedPolicyPack = loadPolicyPack(require("../policies/uk-corporate/1.4-rc/policy.json"));

function evidence(id) {
  return { system: "g24b-test", referenceType: "document", referenceId: id };
}

function buildCase(caseId = "g24b-case") {
  let caseState = createOwnershipCase({
    caseId,
    subjectReference: { name: "Customer", entityType: "COMPANY", entityId: "customer", externalIdentifiers: [] },
    externalReferences: [{ system: "g24b-test", referenceId: caseId }],
    createdAt: NOW,
  });
  [
    { entityId: "customer", category: CANONICAL_ENTITY_CATEGORY.LEGAL_ENTITY, primaryName: "Customer", jurisdiction: "GB" },
    { entityId: "person-smo", category: CANONICAL_ENTITY_CATEGORY.NATURAL_PERSON, primaryName: "Senior Person", jurisdiction: "GB" },
    { entityId: "foreign-holdco", category: CANONICAL_ENTITY_CATEGORY.LEGAL_ENTITY, primaryName: "Foreign HoldCo", jurisdiction: "US" },
    { entityId: "midco", category: CANONICAL_ENTITY_CATEGORY.LEGAL_ENTITY, primaryName: "MidCo", jurisdiction: "DE" },
  ].forEach((entity) => {
    caseState = addCanonicalEntity(caseState, {
      ...entity,
      aliases: [],
      externalIdentifiers: [],
      entityTypeMetadata: {},
    }, { recordedAt: NOW });
  });
  return caseState;
}

function policyIdentity() {
  return {
    policyPackId: loadedPolicyPack.identity.policyPackId,
    policyVersion: loadedPolicyPack.identity.version,
    policyHash: loadedPolicyPack.identity.hash,
    policySchemaVersion: loadedPolicyPack.identity.schemaVersion,
  };
}

function needDraft({
  concept = INFORMATION_NEED_CONCEPT.PERCENTAGE_OR_RANGE,
  subjectEntityId = "customer",
  requiredBy = ["UBO-R01"],
  strategies = [RESOLUTION_STRATEGY.DISCOVERY, RESOLUTION_STRATEGY.CUSTOMER_DOCUMENT],
  reasonCode = "TEST_NEED",
  existingEvidenceReferences = [],
} = {}) {
  return {
    subjectEntityId,
    requiredBy,
    concept,
    reasonCodes: [reasonCode],
    claimIds: [],
    calculationReferences: [],
    conflictReferences: [],
    existingEvidenceReferences,
    permittedResolutionStrategies: strategies,
  };
}

function fixture({
  caseId,
  statusOverrides = {},
  applicabilityOverrides = {},
  needDrafts = [],
  operationalBlockers = [],
  riskGraph = false,
  noQualifyingPersons = false,
} = {}) {
  const caseState = buildCase(caseId);
  let graph = buildCanonicalOwnershipGraph(caseState);
  let calculations = [];
  if (riskGraph) {
    graph = {
      ...structuredClone(graph),
      graphVersion: `${graph.graphVersion}:risk`,
      relationships: [
        { relationshipId: "rel-1", subjectEntityId: "person-smo", objectEntityId: "foreign-holdco" },
        { relationshipId: "rel-2", subjectEntityId: "foreign-holdco", objectEntityId: "midco" },
        { relationshipId: "rel-3", subjectEntityId: "midco", objectEntityId: "customer" },
      ],
    };
    calculations = [{
      calculationAlgorithm: "ubo-percentage-lookthrough-v1",
      graphVersion: graph.graphVersion,
      subjectEntityId: "person-smo",
      targetEntityId: "customer",
      dimension: "ECONOMIC",
      status: "COMPLETE",
      knownPaths: [{ pathId: "path-1", relationshipIds: ["rel-1", "rel-2", "rel-3"] }],
      unresolvedPaths: [],
      cycles: [],
    }];
  }
  const identity = policyIdentity();
  const allIds = loadedPolicyPack.policyPack.requirements.map(({ requirementId }) => requirementId);
  const baseStatuses = Object.fromEntries(allIds.map((requirementId) => [requirementId, REQUIREMENT_STATE.RESOLVED]));
  Object.assign(baseStatuses, {
    "UBO-R02": REQUIREMENT_STATE.N_A,
    "UBO-R03": REQUIREMENT_STATE.N_A,
    "UBO-R09": REQUIREMENT_STATE.UNRESOLVED,
    "UBO-R10": REQUIREMENT_STATE.N_A,
    "UBO-R13": REQUIREMENT_STATE.UNRESOLVED,
    "UBO-R14": REQUIREMENT_STATE.UNRESOLVED,
  }, statusOverrides);
  const needState = reconcileInformationNeeds({ caseState, drafts: needDrafts, priorRecords: [] });
  const requirementResolutions = allIds.map((requirementId) => ({
    requirementId,
    policyIdentity: identity,
    caseReference: { caseId: caseState.caseId, revisionId: caseState.revisionId, revision: caseState.revision },
    applicability: applicabilityOverrides[requirementId]
      || (["UBO-R02", "UBO-R03", "UBO-R10"].includes(requirementId) ? APPLICABILITY_RESULT.DOES_NOT_APPLY : APPLICABILITY_RESULT.APPLIES),
    requirementStatus: baseStatuses[requirementId],
    reasonCode: `${baseStatuses[requirementId]}_FIXTURE`,
    basisAssessmentReferences: [],
    operativeClaimReferences: [],
    graphReference: { graphVersion: graph.graphVersion, relationshipIds: [] },
    calculationReferences: [],
    evidenceReferencesConsidered: [],
    evidenceSufficiency: { status: "INDETERMINATE", reasonCode: "FIXTURE" },
    informationNeedIds: needState.current.filter(({ requiredBy }) => requiredBy.includes(requirementId)).map(({ needId }) => needId),
    policyGapIds: [],
    conflictReferences: [],
    reviewReferences: [],
    operationalBlockerIds: operationalBlockers.filter(({ affectedRequirementIds }) => affectedRequirementIds.includes(requirementId)).map(({ blockerId }) => blockerId),
  }));
  const caseReference = { caseId: caseState.caseId, revisionId: caseState.revisionId, revision: caseState.revision };
  const policyAssessment = {
    caseReference,
    graphVersion: graph.graphVersion,
    policyIdentity: identity,
    policyApplicability: { entityProfile: "COMPANY" },
    qualifyingPersons: noQualifyingPersons ? [] : [{ personEntityId: "person-smo", roles: ["beneficial_owner"] }],
  };
  const requirementResolution = {
    policyIdentity: identity,
    caseReference,
    graphVersion: graph.graphVersion,
    requirementResolutions,
    evidenceClassifications: [],
    informationNeeds: needState.current,
    informationNeedHistory: needState.history,
    policyGaps: [],
    operationalBlockers,
  };
  return {
    loadedPolicyPack,
    caseContext: { entityType: "private_limited_company", subjectEntityId: "customer", jurisdiction: "GB", riskLevel: "LOW" },
    caseState,
    graph,
    calculations,
    policyAssessment,
    requirementResolution,
    facts: {},
    answers: {},
    pscComparison: {
      firmFacts: [{ factId: "firm-default", personEntityId: "person-smo", basis: "ECONOMIC_OWNERSHIP", value: 30 }],
      pscFacts: [{ factId: "psc-default", personEntityId: "person-smo", basis: "ECONOMIC_OWNERSHIP", value: 30 }],
      pscEvidenceComplete: true,
    },
  };
}

function run(environment, overrides = {}) {
  return orchestrateResolution({ ...environment, ...overrides });
}

function openNeed(environment) {
  return environment.requirementResolution.informationNeeds[0];
}

function seniorCandidates() {
  return [{ personEntityId: "person-smo", factReferences: ["fact:senior-management"], evidenceReferences: [] }];
}

function attestation() {
  return { accepted: true, factReference: "fact:residual-completeness", evidenceReference: evidence("residual-attestation") };
}

test("one InformationNeed exposes every policy-permitted option without ranking or automatic selection", () => {
  const environment = fixture({
    statusOverrides: { "UBO-R03": REQUIREMENT_STATE.GAP },
    applicabilityOverrides: { "UBO-R03": APPLICABILITY_RESULT.APPLIES },
    needDrafts: [needDraft({ requiredBy: ["UBO-R03"], strategies: [
      RESOLUTION_STRATEGY.DISCOVERY,
      RESOLUTION_STRATEGY.EXISTING_EVIDENCE,
      RESOLUTION_STRATEGY.CUSTOMER_DOCUMENT,
    ] })],
  });
  const result = run(environment);
  const need = openNeed(environment);
  assert.deepEqual(result.resolutionOptions.filter(({ informationNeedId }) => informationNeedId === need.needId)
    .map(({ strategy }) => strategy).sort(), ["CUSTOMER_DOCUMENT", "DISCOVERY", "EXISTING_EVIDENCE"]);
  assert.equal(result.actionIntents.some(({ informationNeedIds }) => informationNeedIds.includes(need.needId)), false);
  assert.equal(result.resolutionOptions.some((option) => Object.prototype.hasOwnProperty.call(option, "priority")), false);
});

test("a unique applicable method becomes one fact-led action and shared requirement references are preserved", () => {
  const environment = fixture({
    statusOverrides: { "UBO-R03": REQUIREMENT_STATE.GAP, "UBO-R08": REQUIREMENT_STATE.GAP },
    applicabilityOverrides: { "UBO-R03": APPLICABILITY_RESULT.APPLIES },
    needDrafts: [needDraft({
      requiredBy: ["UBO-R03", "UBO-R08"],
      strategies: [RESOLUTION_STRATEGY.CUSTOMER_DOCUMENT],
      concept: INFORMATION_NEED_CONCEPT.RELATIONSHIP_EVIDENCE,
    })],
  });
  const result = run(environment);
  const intent = result.actionIntents.find(({ type }) => type === ACTION_INTENT_TYPE.REQUEST_CUSTOMER_EVIDENCE);
  assert.deepEqual(intent.requirementIds, ["UBO-R03", "UBO-R08"]);
  assert.equal(intent.informationNeedIds.length, 1);
  assert.ok(intent.acceptableEvidenceTypes.includes("certified_constitutional_documents"));
  assert.ok(intent.acceptableEvidenceTypes.includes("register_of_members"));
});

test("unresolved policy wording is never fabricated into a customer question intent", () => {
  const environment = fixture({
    noQualifyingPersons: true,
    statusOverrides: { "UBO-R01": REQUIREMENT_STATE.GAP },
    needDrafts: [needDraft({ requiredBy: ["UBO-R01"], strategies: [RESOLUTION_STRATEGY.CUSTOMER_QUESTION] })],
  });
  const result = run(environment);
  const option = result.resolutionOptions.find(({ strategy }) => strategy === RESOLUTION_STRATEGY.CUSTOMER_QUESTION);
  assert.equal(option.applicabilityState, OPTION_APPLICABILITY_STATE.REQUIRES_POLICY_CONTENT);
  assert.equal(result.actionIntents.some(({ type }) => type === ACTION_INTENT_TYPE.REQUEST_CUSTOMER_INFORMATION), false);
  assert.equal(JSON.stringify(result).includes("invent"), false);
});

test("operational failures create retry/hold intents and never manufacture customer evidence requests", () => {
  const blocker = {
    blockerId: "blocker-1",
    affectedRequirementIds: ["UBO-R01"],
    affectedInformationNeedIds: [],
    capabilityOperation: { operationId: "discovery-1", outcomeState: "UNAVAILABLE" },
    reasonCode: "DISCOVERY_UNAVAILABLE",
    operationalOnly: true,
    retryable: true,
    status: "OPEN",
  };
  const result = run(fixture({ operationalBlockers: [blocker] }));
  assert.equal(result.actionIntents.some(({ type }) => type === ACTION_INTENT_TYPE.OPERATIONAL_RETRY_OR_HOLD), true);
  assert.equal(result.actionIntents.some(({ type }) => type === ACTION_INTENT_TYPE.REQUEST_CUSTOMER_EVIDENCE), false);
});

test("ResolutionAttempt history is append-only, preserves NO_DATA, and stores references rather than raw evidence", () => {
  const environment = fixture();
  const identity = policyIdentity();
  const first = createResolutionAttempt({
    caseState: environment.caseState, policyIdentity: identity, sequence: 1, informationNeedIds: ["need-1"],
    resolutionOptionId: "option-discovery", strategy: RESOLUTION_STRATEGY.DISCOVERY,
    outcome: RESOLUTION_ATTEMPT_OUTCOME.NO_RESOLUTION, capabilityOutcomeState: CAPABILITY_OUTCOME_STATE.NO_DATA,
    capabilityReference: { operationId: "discovery-1" }, resultingFactReferences: [], resultingEvidenceReferences: [], reasonCode: "NO_DATA",
  });
  const second = createResolutionAttempt({
    caseState: environment.caseState, policyIdentity: identity, sequence: 2, informationNeedIds: ["need-1"],
    actionIntentId: "document-action", strategy: RESOLUTION_STRATEGY.CUSTOMER_DOCUMENT,
    outcome: RESOLUTION_ATTEMPT_OUTCOME.SUCCEEDED, resultingFactReferences: ["fact:new-owner"],
    resultingEvidenceReferences: [evidence("document-1")], reasonCode: "FACTS_RETURNED_FOR_RERESOLUTION",
  });
  assert.equal(validateResolutionAttemptHistory([first, second], environment.caseState), true);
  const result = run(environment, { resolutionAttempts: [first, second] });
  assert.deepEqual(result.resolutionAttempts.map(({ outcome }) => outcome), ["NO_RESOLUTION", "SUCCEEDED"]);
  assert.equal(result.requirementResolutions.find(({ requirementId }) => requirementId === "UBO-R01").requirementStatus, REQUIREMENT_STATE.RESOLVED);
  assert.equal(JSON.stringify(second).includes("rawEvidence"), false);
  assert.throws(() => validateResolutionAttemptHistory([first, first], environment.caseState));
  assert.throws(() => validateResolutionAttemptHistory([{ ...structuredClone(first), reasonCode: "TAMPERED" }], environment.caseState));
});

test("FAILED and UNAVAILABLE capability attempts remain operationally blocked", () => {
  const environment = fixture();
  assert.throws(() => createResolutionAttempt({
    caseState: environment.caseState, policyIdentity: policyIdentity(), sequence: 1, informationNeedIds: ["need-1"],
    resolutionOptionId: "option-1", strategy: RESOLUTION_STRATEGY.DISCOVERY,
    outcome: RESOLUTION_ATTEMPT_OUTCOME.NO_RESOLUTION, capabilityOutcomeState: CAPABILITY_OUTCOME_STATE.FAILED,
    resultingFactReferences: [], resultingEvidenceReferences: [], reasonCode: "FAILED",
  }));
});

test("customer-resolvable needs and incomplete pre-fallback requirements block asynchronous review readiness", () => {
  const environment = fixture({
    noQualifyingPersons: true,
    statusOverrides: { "UBO-R01": REQUIREMENT_STATE.GAP },
    needDrafts: [needDraft({ strategies: [RESOLUTION_STRATEGY.CUSTOMER_DOCUMENT] })],
  });
  const result = run(environment);
  assert.equal(result.fallbackReviewCandidate.isCandidate, false);
  assert.ok(result.fallbackReviewCandidate.blockingRequirementIds.includes("UBO-R01"));
  assert.equal(result.reviewRequirement, undefined);
});

test("missing senior-management data creates preparatory customer collection without assigning an SMO role", () => {
  const result = run(fixture({ noQualifyingPersons: true }));
  assert.equal(result.fallbackReviewCandidate.isCandidate, true);
  assert.equal(result.preparatoryInformationNeeds[0].concept, INFORMATION_NEED_CONCEPT.SENIOR_MANAGEMENT_CANDIDATE);
  assert.equal(result.actionIntents.some(({ actionTemplateReference }) =>
    actionTemplateReference?.actionTemplateId === "IDENTIFY_SENIOR_MANAGEMENT_CANDIDATES"), true);
  assert.equal(result.fallbackApplication.applied, false);
  assert.deepEqual(result.fallbackApplication.roles, []);
  assert.equal(result.customerProjection.state, CUSTOMER_PROJECTION_STATE.CUSTOMER_INPUT_REQUIRED);
  assert.equal(result.terminal.orchestrationState, ORCHESTRATION_STATE.IN_PROGRESS);
});

test("known senior-management facts suppress repeat collection and produce an asynchronous review package", () => {
  const result = run(fixture({ noQualifyingPersons: true }), {
    seniorManagementCandidates: seniorCandidates(),
    seniorManagementCandidatesComplete: true,
    residualCompletenessAttestation: attestation(),
  });
  assert.equal(result.preparatoryInformationNeeds.length, 0);
  assert.equal(result.actionIntents.some(({ actionTemplateReference }) =>
    actionTemplateReference?.actionTemplateId === "IDENTIFY_SENIOR_MANAGEMENT_CANDIDATES"), false);
  assert.equal(result.reviewRequirement.state, "PENDING");
  assert.equal(result.customerProjection.state, CUSTOMER_PROJECTION_STATE.INTERNAL_REVIEW_REQUIRED);
  assert.equal(result.customerProjection.customerInputComplete, true);
  assert.equal(result.terminal.orchestrationState, ORCHESTRATION_STATE.IN_PROGRESS);
  assert.equal(result.actionIntents.find(({ semanticTarget }) => semanticTarget.reviewType === "FALLBACK_EXHAUSTION").constraints.includes("ASYNCHRONOUS_INTERNAL_REVIEW"), true);
  assert.equal(result.fallbackReviewPackage.caseReference.revisionId, result.caseReference.revisionId);
  assert.equal(result.fallbackReviewPackage.graphVersion, result.graphVersion);
  assert.match(result.fallbackReviewPackage.reasoningManifestHash, /^sha256:/);
});

test("NO_DATA and caller-supplied eligibility cannot bypass the authoritative fallback decision", () => {
  const environment = fixture({ noQualifyingPersons: true });
  const attempt = createResolutionAttempt({
    caseState: environment.caseState, policyIdentity: policyIdentity(), sequence: 1, informationNeedIds: ["need-1"],
    resolutionOptionId: "option-1", strategy: RESOLUTION_STRATEGY.DISCOVERY,
    outcome: RESOLUTION_ATTEMPT_OUTCOME.NO_RESOLUTION, capabilityOutcomeState: CAPABILITY_OUTCOME_STATE.NO_DATA,
    resultingFactReferences: [], resultingEvidenceReferences: [], reasonCode: "NO_DATA",
  });
  const result = run(environment, {
    resolutionAttempts: [attempt], seniorManagementCandidates: seniorCandidates(), seniorManagementCandidatesComplete: true,
    facts: { fallback_eligible_after_exhausted_measures: true },
  });
  assert.equal(result.fallbackDecisionAssessment.eligible, false);
  assert.equal(result.fallbackDecisionAssessment.callerSuppliedEligibilityIgnored, true);
  assert.equal(result.fallbackApplication.applied, false);
});

test("a relevant operational blocker prevents fallback review and cannot prove exhaustion", () => {
  const blocker = {
    blockerId: "blocker-r01", affectedRequirementIds: ["UBO-R01"], affectedInformationNeedIds: [],
    capabilityOperation: { operationId: "op-1", outcomeState: "FAILED" }, reasonCode: "FAILED", operationalOnly: true, status: "OPEN",
  };
  const result = run(fixture({ noQualifyingPersons: true, operationalBlockers: [blocker], statusOverrides: { "UBO-R01": REQUIREMENT_STATE.UNRESOLVED } }), {
    seniorManagementCandidates: seniorCandidates(), seniorManagementCandidatesComplete: true,
  });
  assert.equal(result.fallbackReviewCandidate.isCandidate, false);
  assert.deepEqual(result.fallbackReviewCandidate.relevantOperationalBlockerIds, ["blocker-r01"]);
  const irrelevant = run(fixture({ noQualifyingPersons: true, operationalBlockers: [blocker] }), {
    seniorManagementCandidates: seniorCandidates(), seniorManagementCandidatesComplete: true,
  });
  assert.equal(irrelevant.fallbackReviewCandidate.relevantOperationalBlockerIds.length, 0);
});

test("a current analyst exhaustion decision permits explicit R10 application and emits the policy HIGH signal", () => {
  const environment = fixture({ noQualifyingPersons: true });
  const first = run(environment, { seniorManagementCandidates: seniorCandidates(), seniorManagementCandidatesComplete: true });
  const decision = createFallbackExhaustionDecision({
    reviewRequirement: first.reviewRequirement,
    decision: FALLBACK_EXHAUSTION_DECISION.ALL_POSSIBLE_MEANS_EXHAUSTED,
    origin: FALLBACK_DECISION_ORIGIN.ANALYST,
    reasonCode: "REVIEWER_CONFIRMED_EXHAUSTION",
  });
  const second = run(environment, {
    seniorManagementCandidates: seniorCandidates(),
    seniorManagementCandidatesComplete: true,
    fallbackExhaustionDecisions: [decision],
    smoApplication: { decisionId: decision.decisionId, personEntityIds: ["person-smo"], reasonCode: "EXPLICIT_REVIEWER_SELECTED_CANDIDATE" },
    residualCompletenessAttestation: attestation(),
  });
  assert.equal(second.fallbackDecisionAssessment.eligible, true);
  assert.equal(second.reviewRequirement.state, "RESOLVED");
  assert.equal(second.fallbackApplication.roles[0].role, "senior_managing_official_fallback");
  assert.equal(second.riskSignals.some(({ requirementId, type, level }) => requirementId === "UBO-R10" && type === "RATING_SET" && level === "HIGH"), true);
  assert.equal(second.terminal.terminalOutcome, UBO_TERMINAL_OUTCOME.RESOLVED_VIA_SMO_FALLBACK);
});

test("fallback decisions reject unauthorized origins and canonical-content tampering", () => {
  const environment = fixture({ noQualifyingPersons: true });
  const first = run(environment, { seniorManagementCandidates: seniorCandidates(), seniorManagementCandidatesComplete: true });
  const decision = createFallbackExhaustionDecision({
    reviewRequirement: first.reviewRequirement,
    decision: FALLBACK_EXHAUSTION_DECISION.ALL_POSSIBLE_MEANS_EXHAUSTED,
    origin: FALLBACK_DECISION_ORIGIN.ANALYST,
    reasonCode: "VALID_REVIEW",
  });
  assert.throws(() => run(environment, {
    seniorManagementCandidates: seniorCandidates(), seniorManagementCandidatesComplete: true,
    fallbackExhaustionDecisions: [{ ...structuredClone(decision), origin: "SYSTEM" }],
  }));
  assert.throws(() => run(environment, {
    seniorManagementCandidates: seniorCandidates(), seniorManagementCandidatesComplete: true,
    fallbackExhaustionDecisions: [{ ...structuredClone(decision), reasonCode: "TAMPERED" }],
  }));
  const competing = createFallbackExhaustionDecision({
    reviewRequirement: first.reviewRequirement,
    decision: FALLBACK_EXHAUSTION_DECISION.ALL_POSSIBLE_MEANS_EXHAUSTED,
    origin: FALLBACK_DECISION_ORIGIN.COMPLIANCE,
    reasonCode: "COMPETING_CURRENT_DECISION",
  });
  assert.throws(() => run(environment, {
    seniorManagementCandidates: seniorCandidates(), seniorManagementCandidatesComplete: true,
    fallbackExhaustionDecisions: [decision, competing],
  }));
});

test("stale review decisions are rejected after material case/graph change", () => {
  const firstEnvironment = fixture({ caseId: "stale-review", noQualifyingPersons: true });
  const first = run(firstEnvironment, { seniorManagementCandidates: seniorCandidates(), seniorManagementCandidatesComplete: true });
  const decision = createFallbackExhaustionDecision({
    reviewRequirement: first.reviewRequirement,
    decision: FALLBACK_EXHAUSTION_DECISION.ALL_POSSIBLE_MEANS_EXHAUSTED,
    origin: FALLBACK_DECISION_ORIGIN.COMPLIANCE,
    reasonCode: "OLD_STATE",
  });
  const changed = fixture({ caseId: "changed-review", riskGraph: true, noQualifyingPersons: true });
  const result = run(changed, {
    seniorManagementCandidates: seniorCandidates(), seniorManagementCandidatesComplete: true,
    fallbackExhaustionDecisions: [decision],
  });
  assert.equal(result.fallbackDecisionAssessment.eligible, false);
  assert.deepEqual(result.fallbackDecisionAssessment.rejectedDecisionIds, [decision.decisionId]);
});

test("FURTHER_MEASURES_AVAILABLE requires a concrete need and never creates a generic RFI directly", () => {
  const environment = fixture({ noQualifyingPersons: true });
  const first = run(environment, { seniorManagementCandidates: seniorCandidates(), seniorManagementCandidatesComplete: true });
  assert.throws(() => createFallbackExhaustionDecision({
    reviewRequirement: first.reviewRequirement,
    decision: FALLBACK_EXHAUSTION_DECISION.FURTHER_MEASURES_AVAILABLE,
    origin: FALLBACK_DECISION_ORIGIN.ANALYST,
    reasonCode: "GENERIC_MORE_WORK",
  }));
  const decision = createFallbackExhaustionDecision({
    reviewRequirement: first.reviewRequirement,
    decision: FALLBACK_EXHAUSTION_DECISION.FURTHER_MEASURES_AVAILABLE,
    origin: FALLBACK_DECISION_ORIGIN.ANALYST,
    furtherInformationNeedDrafts: [needDraft({ reasonCode: "FURTHER_HOLDCO_EVIDENCE", strategies: [RESOLUTION_STRATEGY.CUSTOMER_DOCUMENT] })],
    reasonCode: "CONCRETE_FURTHER_MEASURE",
  });
  const result = run(environment, {
    seniorManagementCandidates: seniorCandidates(), seniorManagementCandidatesComplete: true,
    fallbackExhaustionDecisions: [decision],
  });
  assert.equal(result.reviewGeneratedInformationNeeds.length, 1);
  assert.equal(result.actionIntents.some(({ informationNeedIds }) => informationNeedIds.includes(result.reviewGeneratedInformationNeeds[0].needId)), false);
  assert.equal(result.customerProjection.state, CUSTOMER_PROJECTION_STATE.CUSTOMER_INPUT_REQUIRED);
});

test("R09 matches explicit facts, treats PSC silence as non-negative, and routes unmatched facts for review", () => {
  const match = { factId: "firm-1", personEntityId: "person-smo", basis: "VOTING_RIGHTS", value: 30 };
  const psc = { ...match, factId: "psc-1" };
  assert.equal(run(fixture(), { pscComparison: { firmFacts: [match], pscFacts: [psc], pscEvidenceComplete: true } }).pscDiscrepancyAssessment.state,
    PSC_DISCREPANCY_STATE.NO_DISCREPANCY);
  assert.equal(run(fixture(), { pscComparison: { firmFacts: [match], pscFacts: [], pscEvidenceComplete: false } }).pscDiscrepancyAssessment.state,
    PSC_DISCREPANCY_STATE.REVIEW_REQUIRED);
  const potential = run(fixture(), { pscComparison: {
    firmFacts: [match],
    pscFacts: [{ factId: "psc-other", personEntityId: "person-smo", basis: "APPOINTMENT_CONTROL" }],
    pscEvidenceComplete: true,
  } });
  assert.equal(potential.pscDiscrepancyAssessment.state, PSC_DISCREPANCY_STATE.POTENTIAL_DISCREPANCY);
  assert.equal(potential.actionIntents.some(({ requirementIds, type }) => requirementIds.includes("UBO-R09") && type === ACTION_INTENT_TYPE.ANALYST_REVIEW), true);
});

test("R09 preserves explicit definition and non-material rationales without fabricating reportability", () => {
  const firm = { factId: "firm-1", personEntityId: "person-smo", basis: "MLR_CONTROL" };
  const psc = { factId: "psc-1", personEntityId: "person-smo", basis: "PSC_CONTROL" };
  const definition = run(fixture(), { pscComparison: {
    firmFacts: [firm], pscFacts: [psc], pscEvidenceComplete: true,
    explicitDifferenceAssessments: [{ factIds: ["firm-1", "psc-1"], classification: "PSC_MLR_DEFINITION_DIFFERENCE", rationale: "Definitions differ" }],
  } });
  assert.equal(definition.pscDiscrepancyAssessment.state, PSC_DISCREPANCY_STATE.NON_REPORTABLE_DEFINITION_DIFFERENCE);
  const nonMaterial = run(fixture(), { pscComparison: {
    firmFacts: [firm], pscFacts: [psc], pscEvidenceComplete: true,
    explicitDifferenceAssessments: [{ factIds: ["firm-1", "psc-1"], classification: "NON_MATERIAL", rationale: "Explicit compliance rationale" }],
  } });
  assert.equal(nonMaterial.pscDiscrepancyAssessment.state, PSC_DISCREPANCY_STATE.NO_DISCREPANCY);
  assert.equal(JSON.stringify(nonMaterial).includes("SUBMIT_REPORT"), false);
});

test("R13 derives configured chain-depth and cross-border signals without mutating host risk", () => {
  const result = run(fixture({ riskGraph: true }));
  const r13 = result.riskSignals.filter(({ requirementId }) => requirementId === "UBO-R13");
  assert.deepEqual(r13.map(({ type, level }) => `${type}:${level}`).sort(), ["RATING_FLOOR:MEDIUM", "RATING_FLOOR:MEDIUM"]);
  assert.equal(result.requirementResolutions.find(({ requirementId }) => requirementId === "UBO-R13").requirementStatus, REQUIREMENT_STATE.RESOLVED);
  assert.equal(Object.prototype.hasOwnProperty.call(result, "authoritativeCustomerRisk"), false);
  assert.equal(run(fixture()).riskSignals.some(({ requirementId }) => requirementId === "UBO-R13"), false);
});

test("R11 trust state emits the configured HIGH signal and specialist terminal route", () => {
  const result = run(fixture({ statusOverrides: { "UBO-R11": REQUIREMENT_STATE.REVIEW_REQUIRED } }));
  assert.equal(result.riskSignals.some(({ requirementId, level }) => requirementId === "UBO-R11" && level === "HIGH"), true);
  assert.equal(result.terminal.terminalOutcome, UBO_TERMINAL_OUTCOME.SPECIALIST_REVIEW_REQUIRED);
});

test("R14 is unavailable before the closing boundary and cannot cure an underlying gap", () => {
  const result = run(fixture({ statusOverrides: { "UBO-R01": REQUIREMENT_STATE.GAP } }), {
    residualCompletenessAttestation: attestation(),
  });
  assert.equal(result.residualCompleteness.state, "NOT_READY_FOR_COMPLETENESS_ATTESTATION");
  assert.equal(result.requirementResolutions.find(({ requirementId }) => requirementId === "UBO-R01").requirementStatus, REQUIREMENT_STATE.GAP);
  assert.equal(result.requirementResolutions.find(({ requirementId }) => requirementId === "UBO-R14").requirementStatus, REQUIREMENT_STATE.UNRESOLVED);
});

test("R14 closing readiness emits one attestation action and positive evidence resolves R14 only", () => {
  const ready = run(fixture());
  assert.equal(ready.residualCompleteness.state, "READY_FOR_COMPLETENESS_ATTESTATION");
  assert.equal(ready.actionIntents.filter(({ requirementIds, type }) => requirementIds.includes("UBO-R14") && type === ACTION_INTENT_TYPE.REQUEST_ATTESTATION).length, 1);
  const complete = run(fixture(), { residualCompletenessAttestation: attestation() });
  assert.equal(complete.residualCompleteness.state, "COMPLETENESS_ATTESTED");
  assert.equal(complete.requirementResolutions.find(({ requirementId }) => requirementId === "UBO-R14").requirementStatus, REQUIREMENT_STATE.RESOLVED);
  assert.equal(complete.requirementResolutions.find(({ requirementId }) => requirementId === "UBO-R01").requirementStatus, REQUIREMENT_STATE.RESOLVED);
});

test("ordinary completion resolves, missing/refused attestation and conflicts remain IN_PROGRESS", () => {
  const resolved = run(fixture(), { residualCompletenessAttestation: attestation() });
  assert.equal(resolved.terminal.terminalOutcome, UBO_TERMINAL_OUTCOME.RESOLVED);
  const missing = run(fixture());
  assert.equal(missing.terminal.orchestrationState, ORCHESTRATION_STATE.IN_PROGRESS);
  const refused = run(fixture(), { residualCompletenessAttestation: { ...attestation(), accepted: false } });
  assert.equal(refused.terminal.orchestrationState, ORCHESTRATION_STATE.IN_PROGRESS);
  const conflict = run(fixture({ statusOverrides: { "UBO-R04": REQUIREMENT_STATE.CONFLICT } }), { residualCompletenessAttestation: attestation() });
  assert.equal(conflict.terminal.orchestrationState, ORCHESTRATION_STATE.IN_PROGRESS);
});

test("CDD failure has precedence and provisional resolution is impossible without express policy permission", () => {
  const result = run(fixture(), {
    residualCompletenessAttestation: attestation(),
    cddUnableToComplete: {
      established: true,
      reasonCode: "REQUIRED_CDD_MEASURES_CANNOT_BE_COMPLETED",
      informationNeedIds: ["need-unobtainable"],
      resolutionAttemptIds: ["attempt-failed"],
    },
  });
  assert.equal(result.terminal.terminalOutcome, UBO_TERMINAL_OUTCOME.CDD_FAILURE);
  assert.notEqual(result.terminal.terminalOutcome, UBO_TERMINAL_OUTCOME.RESOLVED_VIA_SMO_FALLBACK);
  assert.equal(loadedPolicyPack.policyPack.resolutionOrchestrationPolicy.provisionalRequirementIds.length, 0);
});

test("G2.4B output is deterministic, immutable, offline, and contains no G2.4C snapshot", () => {
  const environment = fixture({ riskGraph: true });
  const first = run(environment);
  const second = run(environment);
  assert.deepEqual(first, second);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.resolutionOptions), true);
  assert.equal(Object.prototype.hasOwnProperty.call(first, "decisionSnapshot"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(first, "snapshotHash"), false);
  assert.doesNotMatch(JSON.stringify(first), /providerPayload|onboardingScreen|assignedTo|emailDelivery/);
});
