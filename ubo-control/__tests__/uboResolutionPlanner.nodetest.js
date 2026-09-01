"use strict";

const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const test = require("node:test");
const {
  CAPABILITY_CONTRACT_VERSION,
  DECISION_APPLICATION_CONTRACT_VERSION,
  UBO_RESOLUTION_PLAN_CONTRACT_VERSION,
  UBO_RESOLUTION_PLANNER_ERROR_CODE,
  UBO_RESOLUTION_PLANNER_VERSION,
  UboResolutionPlannerError,
  createUboDecisionApplication,
  planUboResolution,
} = require("..");
const { canonicalizeJson } = require("../policy/canonicalJson");
const { coreScenarios } = require("../test-support/scenarioCorpus");

const POLICY = require("../policies/uk-corporate/1.4-rc/policy.json");
const T0 = "2026-08-31T14:00:00.000Z";
const T1 = "2026-08-31T14:01:00.000Z";
const T2 = "2026-08-31T14:02:00.000Z";

function createBaseSnapshot() {
  const application = createUboDecisionApplication({ policyPack: POLICY });
  const capabilityResult = structuredClone(coreScenarios.find(({ id }) => id === "S01").steps[0].response);
  capabilityResult.contractVersion = CAPABILITY_CONTRACT_VERSION;
  capabilityResult.candidateFacts[0].qualifiers.currentState = "CURRENT";
  const intake = application.intake({
    contractVersion: DECISION_APPLICATION_CONTRACT_VERSION,
    caseInput: {
      caseId: "resolution-planner-fixture",
      subjectReference: { name: "Example Customer Ltd", entityType: "COMPANY", entityId: "entity-customer", externalIdentifiers: [], jurisdiction: "GB" },
      externalReferences: [], createdAt: T0,
    },
    capabilityResult, operationId: "planner-discovery", recordedAt: T1,
  });
  const subject = intake.decisionTargets.candidateParties.find(({ endpoint }) => endpoint === "SUBJECT");
  const object = intake.decisionTargets.candidateParties.find(({ endpoint }) => endpoint === "OBJECT");
  const claim = intake.decisionTargets.candidateClaims[0];
  const applied = application.applyDecisions({
    contractVersion: DECISION_APPLICATION_CONTRACT_VERSION,
    caseState: intake.caseState,
    entityRegistrations: [
      { entityId: "entity-customer", category: "LEGAL_ENTITY", primaryName: "Example Customer Ltd", aliases: [], externalIdentifiers: [], jurisdiction: "GB", entityTypeMetadata: { sourceEntityType: "COMPANY" }, recordedAt: T2 },
      { entityId: "entity-alice", category: "NATURAL_PERSON", primaryName: "Alice Owner", aliases: [], externalIdentifiers: [], jurisdiction: "GB", entityTypeMetadata: {}, recordedAt: T2 },
    ],
    identityDecisions: [
      { decisionId: "identity-alice", candidatePartyKey: subject.candidatePartyKey, status: "RESOLVED", entityId: "entity-alice", basisReasonCodes: ["EXPLICIT_REVIEW"], evidenceReferences: [], decidedAt: T2, decisionOrigin: "PLANNER_FIXTURE" },
      { decisionId: "identity-customer", candidatePartyKey: object.candidatePartyKey, status: "RESOLVED", entityId: "entity-customer", basisReasonCodes: ["EXPLICIT_REVIEW"], evidenceReferences: [], decidedAt: T2, decisionOrigin: "PLANNER_FIXTURE" },
    ],
    claimAdjudications: [{
      decisionId: "claim-operative", claimId: claim.claimId, previousState: "CANDIDATE", resultingState: "OPERATIVE",
      reasonBasisCode: "EXPLICIT_REVIEW", supportingEvidenceReferences: [], decisionOrigin: "PLANNER_FIXTURE",
      decidedAt: T2, supersededByClaimIds: [], adversarialClaimIds: [],
    }],
  });
  return application.evaluate({
    contractVersion: DECISION_APPLICATION_CONTRACT_VERSION,
    caseState: applied.caseState,
    caseContext: { entityType: "private_limited_company", subjectEntityId: "entity-customer", jurisdiction: "GB", riskLevel: "LOW" },
    evaluationTime: T2, checkpoint: "CASE_OPEN", checkpointReference: { referenceId: "planner:case-open" }, resolutionInputs: {},
  }).decisionSnapshot;
}

const BASE = createBaseSnapshot();

function rehash(snapshot) {
  const hash = `sha256:${createHash("sha256").update(canonicalizeJson(snapshot.decisionContent), "utf8").digest("hex")}`;
  snapshot.snapshotId = hash;
  snapshot.decisionContentHash = hash;
  return snapshot;
}

function need(id, concept = "CURRENT_OWNERSHIP_AND_CONTROL", { subjectEntityId = "entity-customer", attribute, requiredBy = ["UBO-R01"], existingEvidenceReferences = [] } = {}) {
  return {
    needId: id, needRecordId: `${id}:record`, caseReference: structuredClone(BASE.decisionContent.caseReference),
    subjectEntityId, requiredBy, concept, ...(attribute ? { attribute } : {}), reasonCodes: ["FACT_NOT_ESTABLISHED"],
    claimIds: [], calculationReferences: [], conflictReferences: [], existingEvidenceReferences,
    permittedResolutionStrategies: [], state: "OPEN",
  };
}

function option(id, informationNeedId, strategy, { requirementIds = ["UBO-R01"], evidenceTypes = [], state = "APPLICABLE", template } = {}) {
  return {
    optionId: id, informationNeedId, requirementIds, strategy, applicabilityState: state,
    policyBasisReferences: [], acceptableEvidenceTypes: evidenceTypes, constraints: [], reasonCode: state === "APPLICABLE" ? "POLICY_PERMITS_STRATEGY" : "NOT_ACTIONABLE",
    ...(template ? { actionTemplateReference: template } : {}),
  };
}

function intent(id, type, { needIds = [], requirementIds = [], optionIds = [], concept = "CURRENT_OWNERSHIP_AND_CONTROL", subjectEntityId = "entity-customer", constraints = [] } = {}) {
  return {
    actionIntentId: id, actionIntentRecordId: `${id}:record`, type, state: "OPEN", informationNeedIds: needIds,
    policyGapIds: [], requirementIds, resolutionOptionIds: optionIds, semanticTarget: { concept, ...(subjectEntityId ? { subjectEntityId } : {}) },
    acceptableEvidenceTypes: [], constraints, reasonCode: `${type}_REQUIRED`,
  };
}

function attempt(id, informationNeedId, strategy, capabilityOutcomeState, outcome = "NO_RESOLUTION") {
  return {
    attemptId: id, attemptModelVersion: "ubo-resolution-attempt-v1", sequence: 1,
    caseReference: structuredClone(BASE.decisionContent.caseReference), informationNeedIds: [informationNeedId],
    strategy, outcome, resultingFactReferences: [], resultingEvidenceReferences: [], reasonCode: capabilityOutcomeState || outcome,
    ...(capabilityOutcomeState ? { capabilityOutcomeState } : {}),
  };
}

function scenario({ needs = [], options = [], intents = [], attempts = [], blockers = [], reviews = [], terminalOutcome, qualifyingPersons, fallbackCandidate } = {}) {
  const snapshot = structuredClone(BASE);
  const decision = snapshot.decisionContent.decision;
  decision.informationNeeds = needs;
  decision.resolutionOptions = options;
  decision.actionIntents = intents;
  decision.operationalBlockers = blockers;
  decision.reviewRequirements = reviews;
  decision.reviewDecisions = [];
  decision.customerProjection = { state: intents.some(({ type }) => type.startsWith("REQUEST_")) ? "CUSTOMER_INPUT_REQUIRED" : reviews.length ? "INTERNAL_REVIEW_REQUIRED" : "CUSTOMER_INPUT_COMPLETE", customerInputComplete: !intents.some(({ type }) => type.startsWith("REQUEST_")) };
  decision.terminal = terminalOutcome
    ? { orchestrationState: "TERMINAL", terminalOutcome, reasonCode: `${terminalOutcome}_FIXTURE` }
    : { orchestrationState: "IN_PROGRESS", reasonCode: "PLANNER_FIXTURE_IN_PROGRESS" };
  if (qualifyingPersons) decision.qualifyingPersons = qualifyingPersons;
  if (fallbackCandidate) decision.fallbackReviewCandidate = fallbackCandidate;
  snapshot.decisionContent.reasoning.resolutionAttempts = attempts;
  return rehash(snapshot);
}

function plan(snapshot) {
  return planUboResolution({ contractVersion: UBO_RESOLUTION_PLAN_CONTRACT_VERSION, decisionSnapshot: snapshot });
}

test("contract, planner identity, verification, determinism and immutability are protected", () => {
  const snapshot = scenario({ terminalOutcome: "RESOLVED" });
  const first = plan(snapshot);
  assert.equal(first.contractVersion, "ubo-resolution-plan-v1");
  assert.equal(first.plannerVersion, "ubo-low-friction-planner-v1");
  assert.equal(UBO_RESOLUTION_PLANNER_VERSION, "ubo-low-friction-planner-v1");
  assert.deepEqual(first, plan(structuredClone(snapshot)));
  assert.deepEqual(JSON.parse(JSON.stringify(first)), first);
  assert.equal(Object.isFrozen(first), true);
  assert.throws(() => planUboResolution(null), (error) => error.code === UBO_RESOLUTION_PLANNER_ERROR_CODE.MALFORMED_DECISION_SNAPSHOT);
  assert.throws(() => planUboResolution({}), (error) => error.code === UBO_RESOLUTION_PLANNER_ERROR_CODE.MALFORMED_DECISION_SNAPSHOT);
  assert.throws(() => planUboResolution({ decisionSnapshot: { snapshotSchemaVersion: "future" } }), (error) => error.code === UBO_RESOLUTION_PLANNER_ERROR_CODE.UNSUPPORTED_DECISION_SNAPSHOT_SCHEMA);
  assert.throws(() => planUboResolution({ contractVersion: "future", decisionSnapshot: snapshot }), (error) => error instanceof UboResolutionPlannerError && error.code === UBO_RESOLUTION_PLANNER_ERROR_CODE.UNSUPPORTED_CONTRACT_VERSION);
  assert.throws(() => planUboResolution({ decisionSnapshot: snapshot, provider: "vendor" }), (error) => error.code === UBO_RESOLUTION_PLANNER_ERROR_CODE.MALFORMED_DECISION_SNAPSHOT);
  const tampered = structuredClone(snapshot); tampered.decisionContent.decision.terminal.reasonCode = "TAMPERED";
  assert.throws(() => plan(tampered), (error) => error.code === UBO_RESOLUTION_PLANNER_ERROR_CODE.DECISION_SNAPSHOT_VERIFICATION_FAILED);
});

test("P01 already complete produces no action or fabricated continuation", () => {
  const result = plan(scenario({ terminalOutcome: "RESOLVED" }));
  assert.equal(result.state, "COMPLETE");
  assert.equal(result.recommendedWave.actor, "COMPLETE");
  assert.deepEqual(result.recommendedWave.actions, []);
});

test("P02 zero-friction Discovery precedes customer effort and keeps it deferred", () => {
  const n = need("need:p02");
  const result = plan(scenario({ needs: [n], options: [option("option:discovery", n.needId, "DISCOVERY"), option("option:document", n.needId, "CUSTOMER_DOCUMENT")] }));
  assert.equal(result.state, "SYSTEM_RESOLUTION");
  assert.deepEqual(result.recommendedWave.actions.map(({ strategy }) => strategy), ["DISCOVERY"]);
  assert.equal(result.deferredAlternatives.some(({ strategy, deferredReasonCode }) => strategy === "CUSTOMER_DOCUMENT" && deferredReasonCode === "SYSTEM_WAVE_FIRST"), true);
});

test("P03 already-held artifact interpretation is a zero-friction route", () => {
  const n = need("need:p03", "RELATIONSHIP_EVIDENCE", { existingEvidenceReferences: [{ system: "held-store", referenceType: "DOCUMENT", referenceId: "doc-1" }] });
  const result = plan(scenario({ needs: [n], options: [option("option:existing", n.needId, "EXISTING_EVIDENCE")] }));
  assert.equal(result.state, "SYSTEM_RESOLUTION");
  assert.equal(result.recommendedWave.actions[0].rationaleCodes.includes("USES_ALREADY_HELD_EVIDENCE"), true);
});

test("P04 Discovery and held-artifact interpretation share one system wave without precedence", () => {
  const n = need("need:p04");
  const result = plan(scenario({ needs: [n], options: [option("option:d", n.needId, "DISCOVERY"), option("option:e", n.needId, "EXISTING_EVIDENCE")] }));
  assert.equal(result.recommendedWave.actor, "SYSTEM");
  assert.deepEqual(result.recommendedWave.actions.map(({ strategy }) => strategy).sort(), ["DISCOVERY", "EXISTING_EVIDENCE"]);
  assert.equal(Object.prototype.hasOwnProperty.call(result, "frictionScore"), false);
});

test("P05 substantive NO_DATA exhausts Discovery and advances to permitted customer resolution", () => {
  const n = need("need:p05");
  const result = plan(scenario({
    needs: [n], options: [option("option:d", n.needId, "DISCOVERY"), option("option:q", n.needId, "CUSTOMER_QUESTION")],
    attempts: [attempt("attempt:no-data", n.needId, "DISCOVERY", "NO_DATA")],
  }));
  assert.equal(result.state, "CUSTOMER_RESOLUTION");
  assert.equal(result.recommendedWave.actions[0].strategy, "CUSTOMER_QUESTION");
  assert.equal(result.deferredAlternatives.some(({ deferredReasonCode }) => deferredReasonCode === "SUBSTANTIVE_ATTEMPT_ALREADY_EXHAUSTED"), true);
});

test("P06 UNAVAILABLE preserves retry/hold and never automatically unlocks customer burden", () => {
  const n = need("need:p06");
  const blocker = { blockerId: "blocker:p06", capabilityOperation: { operationId: "op:p06", capabilityRequestId: "request:p06", outcomeState: "UNAVAILABLE" }, affectedRequirementIds: ["UBO-R01"], affectedInformationNeedIds: [n.needId], reasonCode: "SOURCE_UNAVAILABLE", operationalOnly: true, retryable: true, status: "OPEN" };
  const retry = intent("intent:retry", "OPERATIONAL_RETRY_OR_HOLD", { needIds: [n.needId], requirementIds: ["UBO-R01"], subjectEntityId: undefined, constraints: ["RETRYABLE"] });
  const result = plan(scenario({
    needs: [n], options: [option("option:d", n.needId, "DISCOVERY"), option("option:doc", n.needId, "CUSTOMER_DOCUMENT")],
    intents: [retry], attempts: [attempt("attempt:unavailable", n.needId, "DISCOVERY", "UNAVAILABLE", "OPERATIONALLY_BLOCKED")], blockers: [blocker],
  }));
  assert.equal(result.state, "SYSTEM_RESOLUTION");
  assert.deepEqual(result.recommendedWave.actions.map(({ actionType }) => actionType), ["OPERATIONAL_RETRY_OR_HOLD"]);
  assert.equal(result.deferredAlternatives.some(({ strategy, deferredReasonCode }) => strategy === "CUSTOMER_DOCUMENT" && deferredReasonCode === "OPERATIONAL_FAILURE_NOT_CUSTOMER_REMEDIATION"), true);
});

test("a non-retryable operational hold is BLOCKED rather than presented as executable work", () => {
  const n = need("need:hold");
  const blocker = { blockerId: "blocker:hold", capabilityOperation: { operationId: "op:hold", capabilityRequestId: "request:hold", outcomeState: "FAILED" }, affectedRequirementIds: ["UBO-R01"], affectedInformationNeedIds: [n.needId], reasonCode: "SOURCE_FAILED", operationalOnly: true, retryable: false, status: "OPEN" };
  const hold = intent("intent:hold", "OPERATIONAL_RETRY_OR_HOLD", { needIds: [n.needId], requirementIds: ["UBO-R01"], subjectEntityId: undefined, constraints: ["HOLD_UNTIL_CAPABILITY_RECOVERS_OR_ROUTE_BECOMES_IRRELEVANT"] });
  const result = plan(scenario({ needs: [n], options: [option("option:hold", n.needId, "DISCOVERY"), option("option:hold:doc", n.needId, "CUSTOMER_DOCUMENT")], intents: [hold], blockers: [blocker] }));
  assert.equal(result.state, "BLOCKED");
  assert.deepEqual(result.recommendedWave.actions, []);
  assert.equal(result.deferredAlternatives.some(({ deferredReasonCode }) => deferredReasonCode === "OPERATIONAL_FAILURE_NOT_CUSTOMER_REMEDIATION"), true);
});

test("P07 lightweight answer is selected over a documentary alternative", () => {
  const n = need("need:p07");
  const result = plan(scenario({ needs: [n], options: [option("option:q", n.needId, "CUSTOMER_QUESTION"), option("option:doc", n.needId, "CUSTOMER_DOCUMENT", { evidenceTypes: ["governance_document"] })] }));
  assert.equal(result.recommendedWave.actions[0].actionType, "PROVIDE_MISSING_INFORMATION");
  assert.equal(result.deferredAlternatives.some(({ strategy }) => strategy === "CUSTOMER_DOCUMENT"), true);
});

test("P08 documentary-only need produces a targeted evidence action", () => {
  const n = need("need:p08", "RELATIONSHIP_EVIDENCE");
  const result = plan(scenario({ needs: [n], options: [option("option:doc", n.needId, "CUSTOMER_DOCUMENT", { evidenceTypes: ["register_of_members"], template: { actionTemplateId: "TARGETED_GOVERNANCE_EVIDENCE", contentStatus: "SUPPLIED", sourceReference: "TEST" } })] }));
  assert.equal(result.state, "CUSTOMER_RESOLUTION");
  assert.equal(result.recommendedWave.actions[0].actionType, "PROVIDE_TARGETED_EVIDENCE");
  assert.deepEqual(result.recommendedWave.customerBundles[0].evidenceRequirements, ["register_of_members"]);
});

test("non-actionable policy options remain visible but cannot become recommendations", () => {
  const n = need("need:not-actionable");
  const result = plan(scenario({ needs: [n], options: [option("option:not-actionable", n.needId, "CUSTOMER_QUESTION", { state: "REQUIRES_POLICY_CONTENT" })] }));
  assert.equal(result.state, "BLOCKED");
  assert.equal(result.deferredAlternatives[0].deferredReasonCode, "NOT_CURRENTLY_ACTIONABLE");
});

test("P09 known information and documentary requirements are combined into one customer bundle", () => {
  const info = need("need:p09:info", "VOTING_RIGHTS", { requiredBy: ["UBO-R04"] });
  const doc = need("need:p09:doc", "RELATIONSHIP_EVIDENCE", { requiredBy: ["UBO-R05"] });
  const result = plan(scenario({ needs: [info, doc], options: [
    option("option:p09:q", info.needId, "CUSTOMER_QUESTION", { requirementIds: info.requiredBy }),
    option("option:p09:doc", doc.needId, "CUSTOMER_DOCUMENT", { requirementIds: doc.requiredBy, evidenceTypes: ["governance_document"] }),
  ] }));
  assert.equal(result.recommendedWave.customerBundles.length, 1);
  assert.deepEqual(result.recommendedWave.customerBundles[0].recommendedCustomerActions.map(({ strategy }) => strategy).sort(), ["CUSTOMER_DOCUMENT", "CUSTOMER_QUESTION"]);
});

test("governance evidence supporting several control needs is one targeted bundle", () => {
  const voting = need("need:governance:voting", "VOTING_RIGHTS", { requiredBy: ["UBO-R04"] });
  const appointment = need("need:governance:appointment", "APPOINTMENT_REMOVAL_RIGHTS", { requiredBy: ["UBO-R05"] });
  const result = plan(scenario({ needs: [voting, appointment], options: [
    option("option:governance:voting", voting.needId, "CUSTOMER_DOCUMENT", { requirementIds: voting.requiredBy, evidenceTypes: ["governance_document"] }),
    option("option:governance:appointment", appointment.needId, "CUSTOMER_DOCUMENT", { requirementIds: appointment.requiredBy, evidenceTypes: ["governance_document"] }),
  ] }));
  assert.equal(result.recommendedWave.customerBundles.length, 1);
  assert.deepEqual(result.recommendedWave.customerBundles[0].informationNeedIds, [appointment.needId, voting.needId]);
  assert.deepEqual(result.recommendedWave.customerBundles[0].evidenceRequirements, ["governance_document"]);
});

test("P10 one shared need across R01/R04 stays one action and one bundle", () => {
  const n = need("need:p10", "CURRENT_OWNERSHIP_AND_CONTROL", { requiredBy: ["UBO-R01", "UBO-R04"] });
  const result = plan(scenario({ needs: [n], options: [option("option:p10", n.needId, "CUSTOMER_DOCUMENT", { requirementIds: n.requiredBy, evidenceTypes: ["governance_document"] })] }));
  assert.equal(result.recommendedWave.actions.length, 1);
  assert.equal(result.recommendedWave.customerBundles.length, 1);
  assert.deepEqual(result.recommendedWave.customerBundles[0].requirementIds, ["UBO-R01", "UBO-R04"]);
});

test("P11 missing attributes for one person coalesce and known fields are not repeated", () => {
  const dob = need("need:p11:dob", "IDENTITY_ATTRIBUTE", { subjectEntityId: "entity-alice", attribute: "date_of_birth_if_available_or_required", requiredBy: ["UBO-R07"] });
  const residence = need("need:p11:residence", "IDENTITY_ATTRIBUTE", { subjectEntityId: "entity-alice", attribute: "country_of_residence_if_available_or_required", requiredBy: ["UBO-R07"] });
  const result = plan(scenario({ needs: [dob, residence], options: [
    option("option:p11:dob", dob.needId, "CUSTOMER_QUESTION", { requirementIds: ["UBO-R07"] }),
    option("option:p11:residence", residence.needId, "CUSTOMER_QUESTION", { requirementIds: ["UBO-R07"] }),
  ] }));
  const bundle = result.recommendedWave.customerBundles[0];
  assert.equal(result.recommendedWave.customerBundles.length, 1);
  assert.deepEqual(bundle.missingFacts, ["country_of_residence_if_available_or_required", "date_of_birth_if_available_or_required"]);
  assert.equal(bundle.knownFacts.some(({ field }) => field === "full_legal_name"), true);
  assert.equal(bundle.missingFacts.includes("full_legal_name"), false);
});

test("P12 senior-management preparation is customer work without assigning fallback status", () => {
  const n = need("need:p12", "SENIOR_MANAGEMENT_CANDIDATE", { requiredBy: ["UBO-R10"] });
  const review = intent("intent:p12:review", "ANALYST_REVIEW", { requirementIds: ["UBO-R10"] });
  const result = plan(scenario({
    needs: [n], options: [option("option:p12", n.needId, "CUSTOMER_QUESTION", { requirementIds: ["UBO-R10"] })], intents: [review],
    fallbackCandidate: { isCandidate: true, reasonCode: "FALLBACK_REVIEW_CANDIDATE", blockingRequirementIds: [], customerResolvableInformationNeedIds: [n.needId] },
  }));
  assert.equal(result.state, "CUSTOMER_RESOLUTION");
  assert.equal(result.recommendedWave.customerBundles[0].subject.family, "SENIOR_MANAGEMENT_PREPARATION");
  assert.equal(JSON.stringify(result).includes("SENIOR_MANAGING_OFFICIAL_FALLBACK"), false);
});

test("P13 internal review follows completed customer work", () => {
  const reviewIntent = intent("intent:p13", "ANALYST_REVIEW", { requirementIds: ["UBO-R09"] });
  const result = plan(scenario({ intents: [reviewIntent] }));
  assert.equal(result.state, "INTERNAL_REVIEW");
  assert.equal(result.recommendedWave.actor, "INTERNAL_REVIEW");
  assert.equal(result.rationale.codes.includes("CUSTOMER_WORK_COMPLETE"), true);
});

test("an applicable analyst-review option is selectable without private orchestration knowledge", () => {
  const n = need("need:analyst", "OTHER_SIGNIFICANT_CONTROL", { requiredBy: ["UBO-R06"] });
  const result = plan(scenario({ needs: [n], options: [option("option:analyst", n.needId, "ANALYST_REVIEW", { requirementIds: ["UBO-R06"] })] }));
  assert.equal(result.state, "INTERNAL_REVIEW");
  assert.equal(result.recommendedWave.actions[0].strategy, "ANALYST_REVIEW");
});

test("P14 specialist state stops ordinary system and customer routes", () => {
  const n = need("need:p14", "TRUST_INVOLVEMENT", { requiredBy: ["UBO-R11"] });
  const specialist = intent("intent:specialist", "SPECIALIST_REVIEW", { needIds: [n.needId], requirementIds: ["UBO-R11"], concept: n.concept });
  const result = plan(scenario({ needs: [n], options: [option("option:d", n.needId, "DISCOVERY"), option("option:q", n.needId, "CUSTOMER_QUESTION")], intents: [specialist], terminalOutcome: "SPECIALIST_REVIEW_REQUIRED" }));
  assert.equal(result.state, "INTERNAL_REVIEW");
  assert.deepEqual(result.recommendedWave.actions.map(({ actionType }) => actionType), ["SPECIALIST_REVIEW"]);
});

test("P15 a fresh resolved snapshot removes the prior customer bundle without workflow state", () => {
  const n = need("need:p15");
  const before = plan(scenario({ needs: [n], options: [option("option:p15", n.needId, "CUSTOMER_DOCUMENT")] }));
  const after = plan(scenario({ terminalOutcome: "RESOLVED" }));
  assert.equal(before.state, "CUSTOMER_RESOLUTION");
  assert.equal(before.recommendedWave.customerBundles.length, 1);
  assert.equal(after.state, "COMPLETE");
  assert.deepEqual(after.recommendedWave.customerBundles, []);
});

test("P16 resolved voting creates no speculative voting or control bundle", () => {
  const result = plan(scenario({}));
  assert.equal(result.state, "BLOCKED");
  assert.equal(result.recommendedWave.customerBundles.length, 0);
  assert.equal(JSON.stringify(result).includes("VOTING_RIGHTS"), false);
});

test("non-success terminal policy outcomes remain DecisionSnapshot-owned blocked states", () => {
  const n = need("need:terminal");
  const result = plan(scenario({ needs: [n], options: [option("option:terminal", n.needId, "CUSTOMER_QUESTION")], terminalOutcome: "CDD_FAILURE" }));
  assert.equal(result.state, "BLOCKED");
  assert.deepEqual(result.rationale.codes, ["TERMINAL_POLICY_STATE"]);
  assert.equal(result.rationale.terminalOutcome, "CDD_FAILURE");
});

test("PARTIAL attempts suppress unchanged semantic repeats while alternatives remain visible", () => {
  const n = need("need:partial", "IDENTITY_ATTRIBUTE", { subjectEntityId: "entity-alice", attribute: "date_of_birth_if_available_or_required", requiredBy: ["UBO-R07"] });
  const result = plan(scenario({
    needs: [n], options: [option("option:partial:d", n.needId, "DISCOVERY", { requirementIds: ["UBO-R07"] }), option("option:partial:q", n.needId, "CUSTOMER_QUESTION", { requirementIds: ["UBO-R07"] })],
    attempts: [attempt("attempt:partial", n.needId, "DISCOVERY", "PARTIAL", "PARTIALLY_SUCCEEDED")],
  }));
  assert.equal(result.state, "CUSTOMER_RESOLUTION");
  assert.equal(result.deferredAlternatives.some(({ strategy, deferredReasonCode }) => strategy === "DISCOVERY" && deferredReasonCode === "SUBSTANTIVE_ATTEMPT_ALREADY_EXHAUSTED"), true);
});

test("UNSUPPORTED and final INCONCLUSIVE attempts do not repeat the unchanged system method", () => {
  ["UNSUPPORTED", "INCONCLUSIVE"].forEach((outcomeState) => {
    const n = need(`need:${outcomeState.toLowerCase()}`);
    const result = plan(scenario({
      needs: [n], options: [option(`option:${outcomeState}:d`, n.needId, "DISCOVERY"), option(`option:${outcomeState}:q`, n.needId, "CUSTOMER_QUESTION")],
      attempts: [attempt(`attempt:${outcomeState}`, n.needId, "DISCOVERY", outcomeState)],
    }));
    assert.equal(result.state, "CUSTOMER_RESOLUTION");
    assert.equal(result.recommendedWave.actions.some(({ strategy }) => strategy === "DISCOVERY"), false);
  });
});

test("confirmation is selected ahead of re-entry and documentary alternatives", () => {
  const n = need("need:confirmation");
  const result = plan(scenario({ needs: [n], options: [
    option("option:confirmation:a", n.needId, "CUSTOMER_ATTESTATION"),
    option("option:confirmation:q", n.needId, "CUSTOMER_QUESTION"),
    option("option:confirmation:d", n.needId, "CUSTOMER_DOCUMENT"),
  ] }));
  assert.equal(result.recommendedWave.actions[0].actionType, "CONFIRM_ESTABLISHED_INFORMATION");
  assert.equal(result.recommendedWave.customerBundles[0].rationaleCodes.includes("CONFIRMATION_PREFERRED_TO_REENTRY"), true);
});

test("ownership chart is recommended only when a recorded option names it", () => {
  const n = need("need:chart", "CURRENT_OWNERSHIP_AND_CONTROL");
  const withoutChart = plan(scenario({ needs: [n], options: [option("option:governance", n.needId, "CUSTOMER_DOCUMENT", { evidenceTypes: ["governance_document"] })] }));
  assert.equal(JSON.stringify(withoutChart).includes("ownership_chart"), false);
  const withChart = plan(scenario({ needs: [n], options: [option("option:chart", n.needId, "CUSTOMER_DOCUMENT", { evidenceTypes: ["ownership_chart"] })] }));
  assert.deepEqual(withChart.recommendedWave.customerBundles[0].evidenceRequirements, ["ownership_chart"]);
});

test("unknown canonical graph links fail through the typed planner surface", () => {
  const n = need("need:unknown-entity", "CURRENT_OWNERSHIP_AND_CONTROL", { subjectEntityId: "unknown-entity" });
  const snapshot = scenario({ needs: [n], options: [option("option:unknown-entity", n.needId, "CUSTOMER_QUESTION")] });
  assert.throws(() => plan(snapshot), (error) => error instanceof UboResolutionPlannerError
    && error.code === UBO_RESOLUTION_PLANNER_ERROR_CODE.INCONSISTENT_DECISION_SNAPSHOT);
});
