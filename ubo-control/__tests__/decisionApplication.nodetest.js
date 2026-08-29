"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  DECISION_APPLICATION_CONTRACT_VERSION,
  DECISION_APPLICATION_ERROR_CODE,
  DecisionApplicationError,
  createUboDecisionApplication,
} = require("..");
const { coreScenarios } = require("../test-support/scenarioCorpus");

const POLICY = require("../policies/uk-corporate/1.4-rc/policy.json");
const T0 = "2026-08-29T09:00:00.000Z";
const T1 = "2026-08-29T09:01:00.000Z";
const T2 = "2026-08-29T09:02:00.000Z";

function capabilityResult() {
  const result = structuredClone(coreScenarios.find(({ id }) => id === "S01").steps[0].response);
  result.candidateFacts[0].qualifiers.currentState = "CURRENT";
  return result;
}

function caseInput(caseId = "decision-application-case") {
  return {
    caseId,
    subjectReference: {
      name: "Example Customer Ltd",
      entityType: "COMPANY",
      entityId: "entity-customer",
      externalIdentifiers: [],
      jurisdiction: "GB",
    },
    externalReferences: [{ system: "host-neutral-test", referenceId: caseId }],
    createdAt: T0,
  };
}

function intake(application, changes = {}) {
  return application.intake({
    contractVersion: DECISION_APPLICATION_CONTRACT_VERSION,
    caseInput: caseInput(),
    capabilityResult: capabilityResult(),
    operationId: "discovery-operation-1",
    recordedAt: T1,
    ...changes,
  });
}

function explicitDecisions(intakeResult) {
  const subject = intakeResult.decisionTargets.candidateParties.find(({ endpoint }) => endpoint === "SUBJECT");
  const object = intakeResult.decisionTargets.candidateParties.find(({ endpoint }) => endpoint === "OBJECT");
  const claim = intakeResult.decisionTargets.candidateClaims[0];
  return {
    entityRegistrations: [
      {
        entityId: "entity-customer",
        category: "LEGAL_ENTITY",
        primaryName: "Example Customer Ltd",
        aliases: [],
        externalIdentifiers: [],
        jurisdiction: "GB",
        entityTypeMetadata: {},
        recordedAt: T2,
      },
      {
        entityId: "entity-alice",
        category: "NATURAL_PERSON",
        primaryName: "Alice Direct",
        aliases: [],
        externalIdentifiers: [],
        jurisdiction: "GB",
        entityTypeMetadata: {},
        recordedAt: T2,
      },
    ],
    identityDecisions: [
      {
        decisionId: "identity-alice",
        candidatePartyKey: subject.candidatePartyKey,
        status: "RESOLVED",
        entityId: "entity-alice",
        basisReasonCodes: ["EXPLICIT_REVIEW"],
        evidenceReferences: [],
        decidedAt: T2,
        decisionOrigin: "APPLICATION_TEST",
        decisionActor: "test-operator",
      },
      {
        decisionId: "identity-customer",
        candidatePartyKey: object.candidatePartyKey,
        status: "RESOLVED",
        entityId: "entity-customer",
        basisReasonCodes: ["EXPLICIT_REVIEW"],
        evidenceReferences: [],
        decidedAt: T2,
        decisionOrigin: "APPLICATION_TEST",
        decisionActor: "test-operator",
      },
    ],
    claimAdjudications: [{
      decisionId: "claim-operative",
      claimId: claim.claimId,
      previousState: "CANDIDATE",
      resultingState: "OPERATIVE",
      reasonBasisCode: "EXPLICIT_REVIEW",
      supportingEvidenceReferences: [],
      decisionOrigin: "APPLICATION_TEST",
      decisionActor: "test-operator",
      decidedAt: T2,
      supersededByClaimIds: [],
      adversarialClaimIds: [],
    }],
  };
}

function applyAll(application, intakeResult) {
  return application.applyDecisions({
    contractVersion: DECISION_APPLICATION_CONTRACT_VERSION,
    caseState: JSON.parse(JSON.stringify(intakeResult.caseState)),
    ...explicitDecisions(intakeResult),
  });
}

function evaluate(application, caseState) {
  return application.evaluate({
    contractVersion: DECISION_APPLICATION_CONTRACT_VERSION,
    caseState,
    caseContext: {
      entityType: "private_limited_company",
      subjectEntityId: "entity-customer",
      jurisdiction: "GB",
      riskLevel: "LOW",
    },
    evaluationTime: T2,
    checkpoint: "CASE_OPEN",
    checkpointReference: { referenceId: "decision-application-case:case-open" },
    resolutionInputs: {},
  });
}

test("the public façade is versioned, stateless, opaque, immutable, and exposes exactly three operations", () => {
  const application = createUboDecisionApplication({ policyPack: POLICY });
  assert.deepEqual(Object.keys(application).sort(), ["applyDecisions", "evaluate", "intake"]);
  const result = intake(application);
  assert.equal(result.contractVersion, DECISION_APPLICATION_CONTRACT_VERSION);
  assert.deepEqual(Object.keys(result).sort(), ["caseState", "contractVersion", "decisionTargets"]);
  assert.equal(result.caseState.stateType, "DECISION_APPLICATION_CASE_STATE");
  assert.equal(typeof result.caseState.statePayload, "string");
  assert.equal(Object.prototype.hasOwnProperty.call(result.caseState, "candidateClaims"), false);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.caseState), true);
});

test("case state survives JSON serialization and supports subsequent intake without mutable application memory", () => {
  const firstApplication = createUboDecisionApplication({ policyPack: POLICY });
  const first = intake(firstApplication);
  const roundTripped = JSON.parse(JSON.stringify(first.caseState));
  const secondApplication = createUboDecisionApplication({ policyPack: structuredClone(POLICY) });
  const second = secondApplication.intake({
    contractVersion: DECISION_APPLICATION_CONTRACT_VERSION,
    caseState: roundTripped,
    capabilityResult: { ...capabilityResult(), requestId: "s01-discovery-2", candidateFacts: [] },
    operationId: "discovery-operation-2",
    recordedAt: T2,
  });
  assert.equal(second.caseState.caseReference.revision, first.caseState.caseReference.revision + 1);
  assert.deepEqual(first, intake(createUboDecisionApplication({ policyPack: POLICY })));
  assert.throws(
    () => secondApplication.intake({
      contractVersion: DECISION_APPLICATION_CONTRACT_VERSION,
      caseState: { contractVersion: DECISION_APPLICATION_CONTRACT_VERSION },
      capabilityResult: capabilityResult(),
      operationId: "invalid-state-operation",
      recordedAt: T2,
    }),
    (error) => error instanceof DecisionApplicationError
      && error.code === DECISION_APPLICATION_ERROR_CODE.INVALID_CASE_STATE,
  );
});

test("decision targets use stable claim and candidate-party keys and no name or array-position inference", () => {
  const result = intake(createUboDecisionApplication({ policyPack: POLICY }));
  assert.equal(result.decisionTargets.candidateClaims[0].claimId, "decision-application-case:claim:discovery-operation-1:s01-direct-share");
  assert.deepEqual(result.decisionTargets.candidateParties.map(({ endpoint }) => endpoint), ["OBJECT", "SUBJECT"]);
  assert.equal(result.decisionTargets.candidateParties.every(({ candidatePartyKey }) => candidatePartyKey.includes(":claim:")), true);
});

test("explicit registrations and decisions produce a fresh deterministic DecisionSnapshot with internal calculation planning", () => {
  const application = createUboDecisionApplication({ policyPack: POLICY });
  const pending = intake(application);
  const before = structuredClone(pending.caseState);
  const applied = applyAll(application, pending);
  assert.deepEqual(pending.caseState, before);
  assert.deepEqual(applied.decisionTargets, { candidateParties: [], candidateClaims: [] });
  const first = evaluate(application, JSON.parse(JSON.stringify(applied.caseState)));
  const second = evaluate(createUboDecisionApplication({ policyPack: POLICY }), applied.caseState);
  assert.deepEqual(first, second);
  assert.deepEqual(Object.keys(first).sort(), ["contractVersion", "decisionSnapshot"]);
  assert.equal(first.decisionSnapshot.decisionContent.decision.qualifyingPersons[0].entityId, "entity-alice");
  assert.equal(first.decisionSnapshot.decisionContent.reasoning.calculations.length, 1);
  assert.equal(Object.prototype.hasOwnProperty.call(first, "graph"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(first, "calculationRequests"), false);
});

test("mandatory unresolved targets stop evaluation but explicit uncertainty remains representable", () => {
  const application = createUboDecisionApplication({ policyPack: POLICY });
  const pending = intake(application);
  assert.throws(
    () => evaluate(application, pending.caseState),
    (error) => error instanceof DecisionApplicationError
      && error.code === DECISION_APPLICATION_ERROR_CODE.UNRESOLVED_MANDATORY_DECISION_TARGET,
  );
  const decisions = explicitDecisions(pending);
  decisions.identityDecisions[0] = {
    decisionId: "identity-alice-unresolved",
    candidatePartyKey: decisions.identityDecisions[0].candidatePartyKey,
    status: "UNRESOLVED",
    basisReasonCodes: ["INSUFFICIENT_IDENTITY_EVIDENCE"],
    evidenceReferences: [],
    decidedAt: T2,
    decisionOrigin: "APPLICATION_TEST",
    decisionActor: "test-operator",
  };
  decisions.entityRegistrations = decisions.entityRegistrations.filter(({ entityId }) => entityId !== "entity-alice");
  const applied = application.applyDecisions({
    contractVersion: DECISION_APPLICATION_CONTRACT_VERSION,
    caseState: pending.caseState,
    ...decisions,
  });
  assert.doesNotThrow(() => evaluate(application, applied.caseState));
});

test("the façade rejects version drift, raw calculation requests, state tampering, and invalid decisions through one typed surface", () => {
  const application = createUboDecisionApplication({ policyPack: POLICY });
  assert.throws(
    () => intake(application, { contractVersion: "future-version" }),
    (error) => error instanceof DecisionApplicationError
      && error.code === DECISION_APPLICATION_ERROR_CODE.UNSUPPORTED_CONTRACT_VERSION,
  );
  const pending = intake(application);
  assert.throws(
    () => application.applyDecisions({
      contractVersion: DECISION_APPLICATION_CONTRACT_VERSION,
      caseState: pending.caseState,
      entityRegistrations: [],
      identityDecisions: [{
        decisionId: "unknown-target",
        candidatePartyKey: "not-a-case-target",
        status: "UNRESOLVED",
        basisReasonCodes: ["EXPLICIT_REVIEW"],
        evidenceReferences: [],
        decidedAt: T2,
        decisionOrigin: "APPLICATION_TEST",
      }],
      claimAdjudications: [],
    }),
    (error) => error instanceof DecisionApplicationError
      && error.code === DECISION_APPLICATION_ERROR_CODE.INVALID_DECISION_TARGET,
  );
  const tampered = structuredClone(pending.caseState);
  tampered.statePayload = `${tampered.statePayload}x`;
  assert.throws(
    () => application.applyDecisions({
      contractVersion: DECISION_APPLICATION_CONTRACT_VERSION,
      caseState: tampered,
      entityRegistrations: [],
      identityDecisions: [],
      claimAdjudications: [],
    }),
    (error) => error instanceof DecisionApplicationError
      && [
        DECISION_APPLICATION_ERROR_CODE.INVALID_CASE_STATE,
        DECISION_APPLICATION_ERROR_CODE.STALE_OR_INCONSISTENT_STATE,
      ].includes(error.code),
  );
  const applied = applyAll(application, pending);
  assert.throws(
    () => application.evaluate({
      contractVersion: DECISION_APPLICATION_CONTRACT_VERSION,
      caseState: applied.caseState,
      caseContext: { entityType: "private_limited_company", subjectEntityId: "entity-customer", jurisdiction: "GB" },
      evaluationTime: T2,
      checkpoint: "CASE_OPEN",
      checkpointReference: { referenceId: "case-open" },
      resolutionInputs: {},
      calculationRequests: [],
    }),
    (error) => error instanceof DecisionApplicationError
      && error.code === DECISION_APPLICATION_ERROR_CODE.EVALUATION_PRECONDITION_FAILED,
  );
});

test("provider and host implementation fields are rejected from the public contract", () => {
  const application = createUboDecisionApplication({ policyPack: POLICY });
  assert.throws(
    () => intake(application, { provider: "legacy-registry", databaseId: "row-1" }),
    (error) => error instanceof DecisionApplicationError
      && error.code === DECISION_APPLICATION_ERROR_CODE.INVALID_CAPABILITY_RESULT,
  );
});

test("provider naming affects only legitimate source references, not graph, calculation, or decision semantics", () => {
  function run(sourceSystem) {
    const application = createUboDecisionApplication({ policyPack: POLICY });
    const result = capabilityResult();
    result.operationEvidenceReferences.forEach((reference) => { reference.system = sourceSystem; });
    result.candidateFacts.forEach((fact) => {
      fact.evidenceReferences.forEach((reference) => { reference.system = sourceSystem; });
    });
    const pending = intake(application, { capabilityResult: result });
    return evaluate(application, applyAll(application, pending).caseState).decisionSnapshot;
  }
  const first = run("provider-a-reference-system");
  const second = run("provider-b-reference-system");
  assert.deepEqual(second.decisionContent.reasoning.graph, first.decisionContent.reasoning.graph);
  assert.deepEqual(second.decisionContent.reasoning.calculations, first.decisionContent.reasoning.calculations);
  assert.deepEqual(second.decisionContent.decision, first.decisionContent.decision);
  assert.notEqual(second.snapshotId, first.snapshotId);
});
