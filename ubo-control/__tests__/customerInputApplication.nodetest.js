"use strict";

const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const test = require("node:test");
const {
  DECISION_APPLICATION_CONTRACT_VERSION,
  DECISION_APPLICATION_CONTRACT_VERSION_V2,
  DECISION_APPLICATION_ERROR_CODE,
  DecisionApplicationError,
  createUboDecisionApplication,
  planUboResolution,
  projectOwnershipGraph,
  projectUboJourney,
} = require("..");
const { canonicalizeJson } = require("../policy/canonicalJson");
const { coreScenarios } = require("../test-support/scenarioCorpus");

const POLICY = require("../policies/uk-corporate/1.4-rc/policy.json");
const T0 = "2026-09-01T09:00:00.000Z";
const T1 = "2026-09-01T09:01:00.000Z";
const T2 = "2026-09-01T09:02:00.000Z";
const T3 = "2026-09-01T09:03:00.000Z";
const T4 = "2026-09-01T09:04:00.000Z";
const CUSTOMER_ONLY_AVAILABILITY = [
  { strategy: "DISCOVERY", state: "INAPPLICABLE", reasonCode: "SYSTEM_ROUTE_EXHAUSTED" },
  { strategy: "EXISTING_EVIDENCE", state: "INAPPLICABLE", reasonCode: "NO_MATCHING_HELD_EVIDENCE" },
  { strategy: "DETERMINISTIC_CALCULATION", state: "INAPPLICABLE", reasonCode: "INPUT_FACT_MISSING" },
];

function application(version = DECISION_APPLICATION_CONTRACT_VERSION_V2) {
  return createUboDecisionApplication({ policyPack: POLICY, contractVersion: version });
}

function initialForeignCase(caseId = "g53c-foreign-holdco") {
  const app = application();
  const response = structuredClone(coreScenarios.find(({ id }) => id === "S05").steps[0].response);
  response.candidateFacts[0].qualifiers.currentState = "CURRENT";
  const intake = app.intake({
    contractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V2,
    caseInput: {
      caseId,
      subjectReference: { entityId: "entity-customer", name: "Example Customer Ltd", entityType: "COMPANY", jurisdiction: "GB", externalIdentifiers: [] },
      externalReferences: [],
      createdAt: T0,
    },
    capabilityResult: response,
    operationId: `${caseId}:discovery`,
    recordedAt: T1,
  });
  const foreign = intake.decisionTargets.candidateParties.find(({ endpoint }) => endpoint === "SUBJECT");
  const customer = intake.decisionTargets.candidateParties.find(({ endpoint }) => endpoint === "OBJECT");
  const applied = app.applyDecisions({
    contractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V2,
    caseState: intake.caseState,
    entityRegistrations: [
      { entityId: "entity-customer", category: "LEGAL_ENTITY", primaryName: "Example Customer Ltd", aliases: [], externalIdentifiers: [{ namespace: "COMPANY_NUMBER", value: "01234567" }], jurisdiction: "GB", entityTypeMetadata: {}, recordedAt: T2 },
      { entityId: "entity-foreign-holdco", category: "LEGAL_ENTITY", primaryName: "Overseas Holdings SA", aliases: [], externalIdentifiers: [{ namespace: "LU_REGISTRY", value: "B12345" }], jurisdiction: "LU", entityTypeMetadata: {}, recordedAt: T2 },
    ],
    identityDecisions: [
      { decisionId: `${caseId}:identity:foreign`, candidatePartyKey: foreign.candidatePartyKey, status: "RESOLVED", entityId: "entity-foreign-holdco", basisReasonCodes: ["EXPLICIT_REVIEW"], evidenceReferences: [], decidedAt: T2, decisionOrigin: "G53C_TEST" },
      { decisionId: `${caseId}:identity:customer`, candidatePartyKey: customer.candidatePartyKey, status: "RESOLVED", entityId: "entity-customer", basisReasonCodes: ["EXPLICIT_REVIEW"], evidenceReferences: [], decidedAt: T2, decisionOrigin: "G53C_TEST" },
    ],
    claimAdjudications: [{
      decisionId: `${caseId}:claim:foreign`, claimId: intake.decisionTargets.candidateClaims[0].claimId,
      previousState: "CANDIDATE", resultingState: "OPERATIVE", reasonBasisCode: "EXPLICIT_REVIEW",
      supportingEvidenceReferences: [], decisionOrigin: "G53C_TEST", decidedAt: T2,
      supersededByClaimIds: [], adversarialClaimIds: [],
    }],
  });
  const evaluated = app.evaluate({
    contractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V2,
    caseState: applied.caseState,
    caseContext: { entityType: "private_limited_company", subjectEntityId: "entity-customer", jurisdiction: "GB", riskLevel: "LOW" },
    evaluationTime: T2,
    checkpoint: "CASE_OPEN",
    checkpointReference: { referenceId: `${caseId}:snapshot-a` },
    resolutionInputs: { strategyAvailability: CUSTOMER_ONLY_AVAILABILITY },
  });
  const snapshot = evaluated.decisionSnapshot;
  const journey = projectUboJourney({ decisionSnapshot: snapshot });
  const plan = planUboResolution({ decisionSnapshot: snapshot });
  return { app, caseState: applied.caseState, snapshot, journey, plan };
}

function initialDirectCase(caseId = "g53c-direct-owner") {
  const app = application();
  const response = structuredClone(coreScenarios.find(({ id }) => id === "S01").steps[0].response);
  response.candidateFacts[0].qualifiers.currentState = "CURRENT";
  const intake = app.intake({
    contractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V2,
    caseInput: { caseId, subjectReference: { entityId: "entity-customer", name: "Example Customer Ltd", entityType: "COMPANY", jurisdiction: "GB", externalIdentifiers: [] }, externalReferences: [], createdAt: T0 },
    capabilityResult: response, operationId: `${caseId}:discovery`, recordedAt: T1,
  });
  const alice = intake.decisionTargets.candidateParties.find(({ endpoint }) => endpoint === "SUBJECT");
  const customer = intake.decisionTargets.candidateParties.find(({ endpoint }) => endpoint === "OBJECT");
  const applied = app.applyDecisions({
    contractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V2, caseState: intake.caseState,
    entityRegistrations: [
      { entityId: "entity-customer", category: "LEGAL_ENTITY", primaryName: "Example Customer Ltd", aliases: [], externalIdentifiers: [], jurisdiction: "GB", entityTypeMetadata: {}, recordedAt: T2 },
      { entityId: "entity-alice", category: "NATURAL_PERSON", primaryName: "Alice Direct", aliases: [], externalIdentifiers: [{ namespace: "PASSPORT", value: "ALICE-1" }], jurisdiction: "GB", entityTypeMetadata: {}, recordedAt: T2 },
    ],
    identityDecisions: [
      { decisionId: `${caseId}:identity:alice`, candidatePartyKey: alice.candidatePartyKey, status: "RESOLVED", entityId: "entity-alice", basisReasonCodes: ["EXPLICIT_REVIEW"], evidenceReferences: [], decidedAt: T2, decisionOrigin: "G53C_TEST" },
      { decisionId: `${caseId}:identity:customer`, candidatePartyKey: customer.candidatePartyKey, status: "RESOLVED", entityId: "entity-customer", basisReasonCodes: ["EXPLICIT_REVIEW"], evidenceReferences: [], decidedAt: T2, decisionOrigin: "G53C_TEST" },
    ],
    claimAdjudications: [{ decisionId: `${caseId}:claim:direct`, claimId: intake.decisionTargets.candidateClaims[0].claimId, previousState: "CANDIDATE", resultingState: "OPERATIVE", reasonBasisCode: "EXPLICIT_REVIEW", supportingEvidenceReferences: [], decisionOrigin: "G53C_TEST", decidedAt: T2, supersededByClaimIds: [], adversarialClaimIds: [] }],
  });
  const snapshot = app.evaluate({
    contractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V2, caseState: applied.caseState,
    caseContext: { entityType: "private_limited_company", subjectEntityId: "entity-customer", jurisdiction: "GB", riskLevel: "LOW" },
    evaluationTime: T2, checkpoint: "CASE_OPEN", checkpointReference: { referenceId: `${caseId}:snapshot-a` },
    resolutionInputs: { strategyAvailability: CUSTOMER_ONLY_AVAILABILITY },
  }).decisionSnapshot;
  return { app, caseState: applied.caseState, snapshot, journey: projectUboJourney({ decisionSnapshot: snapshot }), plan: planUboResolution({ decisionSnapshot: snapshot }) };
}

function customCustomerSetup(base, {
  suffix, concept, subjectEntityId, attribute, requirementId = "UBO-R01",
  strategy = "CUSTOMER_QUESTION", actionType = "REQUEST_CUSTOMER_INFORMATION", templateId,
  evidenceTypes = [], additionalOptions = [],
}) {
  const snapshot = structuredClone(base.snapshot);
  const needId = `need:${suffix}`;
  const optionId = `option:${suffix}`;
  const intentId = `intent:${suffix}`;
  const caseReference = structuredClone(snapshot.decisionContent.caseReference);
  const template = templateId ? POLICY.actionTemplates[templateId] : undefined;
  snapshot.decisionContent.decision.informationNeeds = [{
    needId, needRecordId: `${needId}:record`, caseReference, subjectEntityId, requiredBy: [requirementId], concept,
    ...(attribute ? { attribute } : {}), reasonCodes: ["FACT_NOT_ESTABLISHED"], claimIds: [], calculationReferences: [],
    conflictReferences: [], existingEvidenceReferences: [], permittedResolutionStrategies: [strategy, ...additionalOptions.map(({ strategy: item }) => item)], state: "OPEN",
  }];
  snapshot.decisionContent.decision.resolutionOptions = [{
    optionId, informationNeedId: needId, requirementIds: [requirementId], strategy, applicabilityState: "APPLICABLE",
    policyBasisReferences: [], acceptableEvidenceTypes: evidenceTypes, constraints: [], reasonCode: "POLICY_PERMITS_STRATEGY",
    ...(templateId ? { actionTemplateReference: { actionTemplateId: templateId, contentStatus: template.contentStatus, sourceReference: template.sourceReference } } : {}),
  }, ...additionalOptions.map((item, index) => ({
    optionId: `option:${suffix}:alternative:${index}`, informationNeedId: needId, requirementIds: [requirementId], strategy: item.strategy,
    applicabilityState: "APPLICABLE", policyBasisReferences: [], acceptableEvidenceTypes: item.evidenceTypes || [], constraints: [],
    reasonCode: "POLICY_PERMITS_STRATEGY",
    ...(item.templateId ? { actionTemplateReference: { actionTemplateId: item.templateId, contentStatus: POLICY.actionTemplates[item.templateId].contentStatus, sourceReference: POLICY.actionTemplates[item.templateId].sourceReference } } : {}),
  }))];
  snapshot.decisionContent.decision.actionIntents = [{
    actionIntentId: intentId, actionIntentRecordId: `${intentId}:record`, type: actionType, state: "OPEN",
    informationNeedIds: [needId], policyGapIds: [], requirementIds: [requirementId], resolutionOptionIds: [optionId],
    semanticTarget: { subjectEntityId, concept, ...(attribute ? { attribute } : {}) }, acceptableEvidenceTypes: evidenceTypes,
    constraints: [], reasonCode: `${actionType}_REQUIRED`, strategy,
    ...(templateId ? { actionTemplateReference: { actionTemplateId: templateId, contentStatus: template.contentStatus, sourceReference: template.sourceReference } } : {}),
  }];
  snapshot.decisionContent.decision.operationalBlockers = [];
  snapshot.decisionContent.decision.reviewRequirements = [];
  snapshot.decisionContent.decision.customerProjection = { state: "CUSTOMER_INPUT_REQUIRED", customerInputComplete: false };
  snapshot.decisionContent.decision.terminal = { orchestrationState: "IN_PROGRESS", reasonCode: "CUSTOMER_INPUT_REQUIRED" };
  snapshot.decisionContent.reasoning.resolutionAttempts = [];
  const hash = `sha256:${createHash("sha256").update(canonicalizeJson(snapshot.decisionContent), "utf8").digest("hex")}`;
  snapshot.snapshotId = hash;
  snapshot.decisionContentHash = hash;
  return { ...base, snapshot, journey: projectUboJourney({ decisionSnapshot: snapshot }), plan: planUboResolution({ decisionSnapshot: snapshot }) };
}

function eventFor(setup, changes = {}, selectedBundle) {
  const bundle = selectedBundle || setup.plan.recommendedWave.customerBundles[0];
  const needIds = new Set(bundle.informationNeedIds);
  const items = setup.journey.customerWorkItems.filter((item) => item.informationNeedIds.some((id) => needIds.has(id)));
  const actions = bundle.recommendedCustomerActions;
  return {
    contractVersion: "ubo-customer-action-v1",
    eventType: "CUSTOMER_ACTION_SUBMITTED",
    snapshotId: setup.snapshot.snapshotId,
    snapshotHash: setup.snapshot.decisionContentHash,
    bundleId: bundle.bundleId,
    workItemIds: items.map(({ workItemId }) => workItemId).sort(),
    actionIntentIds: [...new Set(items.flatMap(({ actionIntentIds }) => actionIntentIds))].sort(),
    actionIds: actions.map(({ actionId }) => actionId).sort(),
    semanticActionTypes: [...new Set(actions.map(({ actionType }) => actionType))].sort(),
    informationNeedIds: [...bundle.informationNeedIds].sort(),
    requirementIds: [...bundle.requirementIds].sort(),
    subject: {
      entityId: bundle.subject.entityId || null,
      family: bundle.subject.family || null,
      entityProfile: items.map((item) => item.subject.entityProfile).find(Boolean) || null,
    },
    values: {},
    confirmationResult: null,
    selectedCustomerResolutionOptionId: null,
    evidenceAction: null,
    ...changes,
  };
}

function relationship(owner, percentage, localPartyKey = owner.toLowerCase()) {
  return {
    type: "RELATIONSHIP",
    subject: { name: owner, entityType: "NATURAL_PERSON", localPartyKey, registerAsNew: true, externalIdentifiers: [] },
    object: { entityId: "entity-foreign-holdco", externalIdentifiers: [] },
    relationship: "ECONOMIC_OWNERSHIP",
    measurement: { type: "EXACT", value: percentage },
    qualifiers: { currentState: "CURRENT", economicInterestConcept: "SHARE_OWNERSHIP" },
  };
}

function relationshipField(setup) {
  const missing = setup.plan.recommendedWave.customerBundles[0].missingFacts;
  return missing.find((field) => ["CURRENT_OWNERSHIP_AND_CONTROL", "VOTING_RIGHTS", "APPOINTMENT_CONTROL", "SIGNIFICANT_INFLUENCE_OR_CONTROL"].includes(field));
}

function applyInput(setup, customerAction, operationId = "customer-input-1") {
  return setup.app.applyCustomerInput({
    contractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V2,
    caseState: setup.caseState,
    sourceDecisionSnapshot: setup.snapshot,
    sourceResolutionPlan: setup.plan,
    customerAction,
    operationId,
    recordedAt: T3,
    actorReference: { actorType: "CUSTOMER", referenceId: "customer-user-1" },
  });
}

test("v1 stays exact and default while explicit v2 adds applyCustomerInput", () => {
  assert.deepEqual(Object.keys(application(DECISION_APPLICATION_CONTRACT_VERSION)).sort(), ["applyDecisions", "evaluate", "intake"]);
  assert.deepEqual(Object.keys(createUboDecisionApplication({ policyPack: POLICY })).sort(), ["applyDecisions", "evaluate", "intake"]);
  assert.deepEqual(Object.keys(application()).sort(), ["applyCustomerInput", "applyDecisions", "evaluate", "intake"]);
});

test("foreign HoldCo customer statement remains candidate until explicit decisions, then produces Snapshot B", () => {
  const setup = initialForeignCase();
  assert.equal(setup.plan.state, "CUSTOMER_RESOLUTION");
  const snapshotABefore = structuredClone(setup.snapshot);
  const field = relationshipField(setup);
  assert.ok(field);
  const appliedInput = applyInput(setup, eventFor(setup, { values: { [field]: relationship("Alice Owner", 80, "alice") } }));
  assert.deepEqual(setup.snapshot, snapshotABefore);
  assert.equal(appliedInput.customerInputResult.createdCanonicalEntityIds.length, 1);
  assert.equal(appliedInput.decisionTargets.candidateClaims.length, 1);
  assert.equal(appliedInput.decisionTargets.candidateClaims[0].currentState, "CANDIDATE");
  assert.equal(appliedInput.decisionTargets.candidateParties.length, 0);
  const claim = appliedInput.decisionTargets.candidateClaims[0];
  const decided = setup.app.applyDecisions({
    contractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V2,
    caseState: JSON.parse(JSON.stringify(appliedInput.caseState)),
    entityRegistrations: [], identityDecisions: [],
    claimAdjudications: [{
      decisionId: "customer-claim-operative", claimId: claim.claimId, previousState: "CANDIDATE", resultingState: "OPERATIVE",
      reasonBasisCode: "EXPLICIT_COMPLIANCE_REVIEW", supportingEvidenceReferences: [], decisionOrigin: "G53C_TEST",
      decidedAt: T4, supersededByClaimIds: [], adversarialClaimIds: [],
    }],
  });
  const snapshotB = setup.app.evaluate({
    contractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V2, caseState: decided.caseState,
    caseContext: { entityType: "private_limited_company", subjectEntityId: "entity-customer", jurisdiction: "GB", riskLevel: "LOW" },
    evaluationTime: T4, checkpoint: "CASE_OPEN", checkpointReference: { referenceId: "g53c:snapshot-b" }, resolutionInputs: {},
  }).decisionSnapshot;
  const graphB = projectOwnershipGraph({ decisionSnapshot: snapshotB });
  const journeyB = projectUboJourney({ decisionSnapshot: snapshotB });
  const planB = planUboResolution({ decisionSnapshot: snapshotB });
  assert.notEqual(snapshotB.snapshotId, setup.snapshot.snapshotId);
  assert.equal(snapshotB.decisionContent.reasoning.graph.relationships.some(({ objectEntityId }) => objectEntityId === "entity-foreign-holdco"), true);
  assert.equal(snapshotB.decisionContent.reasoning.calculations.some(({ aggregateKnownValue }) => aggregateKnownValue?.value === "64"), true);
  assert.equal(graphB.nodes.some(({ category }) => category === "NATURAL_PERSON"), true);
  assert.notDeepEqual(journeyB, setup.journey);
  assert.notDeepEqual(planB, setup.plan);
});

test("two new same-name people stay distinct and every relationship requires adjudication", () => {
  const setup = initialForeignCase("g53c-same-name");
  const field = relationshipField(setup);
  const result = applyInput(setup, eventFor(setup, { values: { [field]: [relationship("John Smith", 60, "john-a"), relationship("John Smith", 40, "john-b")] } }));
  assert.equal(result.customerInputResult.createdCanonicalEntityIds.length, 2);
  assert.equal(new Set(result.customerInputResult.createdCanonicalEntityIds).size, 2);
  assert.equal(result.decisionTargets.candidateClaims.length, 2);
  assert.equal(result.decisionTargets.candidateClaims.every(({ currentState }) => currentState === "CANDIDATE"), true);
});

test("exact unique external identifiers resolve an existing person without duplicate registration", () => {
  const setup = initialForeignCase("g53c-existing-person");
  const withAlice = setup.app.applyDecisions({
    contractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V2, caseState: setup.caseState,
    entityRegistrations: [{ entityId: "entity-known-alice", category: "NATURAL_PERSON", primaryName: "Alice Known", aliases: [], externalIdentifiers: [{ namespace: "PASSPORT", value: "P123" }], jurisdiction: "GB", entityTypeMetadata: {}, recordedAt: T3 }],
    identityDecisions: [], claimAdjudications: [],
  });
  const refreshed = setup.app.evaluate({
    contractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V2, caseState: withAlice.caseState,
    caseContext: { entityType: "private_limited_company", subjectEntityId: "entity-customer", jurisdiction: "GB", riskLevel: "LOW" },
    evaluationTime: T3, checkpoint: "CASE_OPEN", checkpointReference: { referenceId: "existing-person" }, resolutionInputs: { strategyAvailability: CUSTOMER_ONLY_AVAILABILITY },
  }).decisionSnapshot;
  const next = { ...setup, caseState: withAlice.caseState, snapshot: refreshed, journey: projectUboJourney({ decisionSnapshot: refreshed }), plan: planUboResolution({ decisionSnapshot: refreshed }) };
  const field = relationshipField(next);
  const statement = relationship("Alice Known", 80, "ignored");
  statement.subject = { name: "Alice Known", entityType: "NATURAL_PERSON", externalIdentifiers: [{ namespace: "PASSPORT", value: "P123" }] };
  const result = applyInput(next, eventFor(next, { values: { [field]: statement } }), "existing-id-input");
  assert.deepEqual(result.customerInputResult.createdCanonicalEntityIds, []);
  assert.equal(result.customerInputResult.deterministicIdentityDecisionIds.length >= 1, true);
  assert.equal(result.decisionTargets.candidateParties.length, 0);
});

test("stale, fabricated and unrequested customer actions fail deterministically", () => {
  const setup = initialForeignCase("g53c-validation");
  const field = relationshipField(setup);
  const valid = eventFor(setup, { values: { [field]: relationship("Alice", 80, "alice") } });
  assert.throws(() => applyInput(setup, { ...valid, bundleId: "fabricated-bundle" }), (error) => error instanceof DecisionApplicationError && error.code === DECISION_APPLICATION_ERROR_CODE.UNAUTHORIZED_CUSTOMER_ACTION);
  assert.throws(() => applyInput(setup, { ...valid, values: { UNREQUESTED_FIELD: "x" } }), (error) => error instanceof DecisionApplicationError && error.code === DECISION_APPLICATION_ERROR_CODE.UNAUTHORIZED_CUSTOMER_ACTION);
  const first = applyInput(setup, valid);
  assert.throws(() => setup.app.applyCustomerInput({
    contractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V2, caseState: first.caseState,
    sourceDecisionSnapshot: setup.snapshot, sourceResolutionPlan: setup.plan, customerAction: valid,
    operationId: "stale-input", recordedAt: T4, actorReference: { actorType: "CUSTOMER", referenceId: "customer-user-1" },
  }), (error) => error instanceof DecisionApplicationError && error.code === DECISION_APPLICATION_ERROR_CODE.STALE_CUSTOMER_ACTION);
});

test("customer-input state is immutable, serializable and deterministic", () => {
  const first = initialForeignCase("g53c-deterministic");
  const second = initialForeignCase("g53c-deterministic");
  const field = relationshipField(first);
  const event = eventFor(first, { values: { [field]: relationship("Alice", 80, "alice") } });
  const before = structuredClone(first.caseState);
  const a = applyInput(first, event);
  const b = applyInput(second, event);
  assert.deepEqual(first.caseState, before);
  assert.deepEqual(a, b);
  assert.deepEqual(JSON.parse(JSON.stringify(a.caseState)), a.caseState);
  assert.equal(Object.isFrozen(a), true);
  assert.equal(Object.isFrozen(a.caseState), true);
});

test("identity attributes attach to the established person and flow through explicit claim adjudication", () => {
  const setup = customCustomerSetup(initialDirectCase(), {
    suffix: "alice-residence", concept: "IDENTITY_ATTRIBUTE", subjectEntityId: "entity-alice",
    attribute: "country_of_residence", requirementId: "UBO-R07", templateId: "CAPTURE_QUALIFYING_PERSON_IDENTITY",
  });
  const bundle = setup.plan.recommendedWave.customerBundles.find(({ subject, missingFacts }) => subject.entityId === "entity-alice" && missingFacts.some((field) => ["date_of_birth", "country_of_nationality", "country_of_residence"].includes(field)));
  assert.ok(bundle);
  const field = bundle.missingFacts.find((name) => ["date_of_birth", "country_of_nationality", "country_of_residence"].includes(name));
  const value = field === "date_of_birth" ? "1980-06-15" : "GB";
  const result = applyInput(setup, eventFor(setup, { values: { [field]: value } }, bundle), "identity-attribute-input");
  assert.deepEqual(result.customerInputResult.createdCanonicalEntityIds, []);
  assert.equal(result.customerInputResult.deterministicIdentityDecisionIds.length, 1);
  assert.equal(result.decisionTargets.candidateParties.length, 0);
  assert.equal(result.decisionTargets.candidateClaims.length, 1);
  const claim = result.decisionTargets.candidateClaims[0];
  const decided = setup.app.applyDecisions({
    contractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V2, caseState: result.caseState, entityRegistrations: [], identityDecisions: [],
    claimAdjudications: [{ decisionId: "identity-attribute-operative", claimId: claim.claimId, previousState: "CANDIDATE", resultingState: "OPERATIVE", reasonBasisCode: "EXPLICIT_CUSTOMER_ATTRIBUTE_REVIEW", supportingEvidenceReferences: [], decisionOrigin: "G53C_TEST", decidedAt: T4, supersededByClaimIds: [], adversarialClaimIds: [] }],
  });
  const snapshotB = setup.app.evaluate({
    contractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V2, caseState: decided.caseState,
    caseContext: { entityType: "private_limited_company", subjectEntityId: "entity-customer", jurisdiction: "GB", riskLevel: "LOW" },
    evaluationTime: T4, checkpoint: "CASE_OPEN", checkpointReference: { referenceId: "identity-attribute-b" }, resolutionInputs: { strategyAvailability: CUSTOMER_ONLY_AVAILABILITY },
  }).decisionSnapshot;
  assert.equal(snapshotB.decisionContent.reasoning.operativeClaims.some((item) => item.attribute === field && item.subject.party.entityId === "entity-alice"), true);
  assert.equal(snapshotB.decisionContent.reasoning.canonicalEntities.filter(({ entityId }) => entityId === "entity-alice").length, 1);
});

test("a negative control answer creates no relationship and is consumed on the next evaluation", () => {
  const setup = initialForeignCase("g53c-negative-attestation");
  const bundle = setup.plan.recommendedWave.customerBundles.find(({ missingFacts }) => missingFacts.some((field) => field.includes("APPOINTMENT") || field.includes("CONTROL")));
  assert.ok(bundle);
  const field = bundle.missingFacts.find((name) => name.includes("APPOINTMENT") || name.includes("CONTROL"));
  const graphBefore = structuredClone(setup.snapshot.decisionContent.reasoning.graph);
  const result = applyInput(setup, eventFor(setup, { values: { [field]: "no" } }, bundle), "negative-control-input");
  assert.deepEqual(result.customerInputResult.createdClaimIds, []);
  assert.deepEqual(result.decisionTargets, { candidateParties: [], candidateClaims: [] });
  const snapshotB = setup.app.evaluate({
    contractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V2, caseState: result.caseState,
    caseContext: { entityType: "private_limited_company", subjectEntityId: "entity-customer", jurisdiction: "GB", riskLevel: "LOW" },
    evaluationTime: T4, checkpoint: "CASE_OPEN", checkpointReference: { referenceId: "negative-attestation-b" }, resolutionInputs: { strategyAvailability: CUSTOMER_ONLY_AVAILABILITY },
  }).decisionSnapshot;
  assert.deepEqual(snapshotB.decisionContent.reasoning.graph.relationships, graphBefore.relationships);
  assert.equal(Object.values(snapshotB.decisionContent.reasoning.policyInputs.answers).includes("no"), true);
});

test("selected alternatives are retained as provenance but never treated as proof", () => {
  const setup = initialForeignCase("g53c-alternative");
  const bundle = setup.plan.recommendedWave.customerBundles[0];
  const optionId = bundle.recommendedCustomerActions[0].resolutionOptionIds[0];
  const result = applyInput(setup, eventFor(setup, { selectedCustomerResolutionOptionId: optionId }, bundle), "alternative-selection");
  assert.deepEqual(result.customerInputResult.createdClaimIds, []);
  assert.deepEqual(result.decisionTargets, { candidateParties: [], candidateClaims: [] });
});

test("evidence actions return only a correlated external handoff and create no facts", () => {
  const setup = initialForeignCase("g53c-evidence-handoff");
  const bundle = setup.plan.recommendedWave.customerBundles.find(({ evidenceRequirements }) => evidenceRequirements.length > 0);
  assert.ok(bundle);
  const event = eventFor(setup, {
    eventType: "EVIDENCE_ACTION_REQUESTED",
    values: {},
    evidenceAction: { intent: "EVIDENCE_ACTION_REQUESTED", evidenceTypes: [...bundle.evidenceRequirements] },
  }, bundle);
  const result = applyInput(setup, event, "evidence-handoff");
  assert.deepEqual(result.customerInputResult.createdClaimIds, []);
  assert.equal(result.customerInputResult.externalHandoffs.length, 1);
  assert.equal(result.customerInputResult.externalHandoffs[0].handoffType, "EXTERNAL_EVIDENCE_REQUIRED");
  const serialized = JSON.stringify(result.customerInputResult.externalHandoffs[0]);
  assert.doesNotMatch(serialized, /base64|blob:|artifactId|rawFile|fileBytes/i);
});

test("confirmation records an answer without duplicating an established relationship", () => {
  const setup = customCustomerSetup(initialDirectCase("g53c-confirmation"), {
    suffix: "confirm-ownership", concept: "CURRENT_OWNERSHIP_AND_CONTROL", subjectEntityId: "entity-customer",
    strategy: "CUSTOMER_ATTESTATION", actionType: "REQUEST_ATTESTATION", templateId: "DISCLOSE_SHARE_OWNERSHIP",
  });
  const graphBefore = structuredClone(setup.snapshot.decisionContent.reasoning.graph);
  const result = applyInput(setup, eventFor(setup, { confirmationResult: "CONFIRMED" }), "confirmation-input");
  assert.deepEqual(result.customerInputResult.createdClaimIds, []);
  assert.deepEqual(result.decisionTargets, { candidateParties: [], candidateClaims: [] });
  const snapshotB = setup.app.evaluate({
    contractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V2, caseState: result.caseState,
    caseContext: { entityType: "private_limited_company", subjectEntityId: "entity-customer", jurisdiction: "GB", riskLevel: "LOW" },
    evaluationTime: T4, checkpoint: "CASE_OPEN", checkpointReference: { referenceId: "confirmation-b" }, resolutionInputs: {},
  }).decisionSnapshot;
  assert.deepEqual(snapshotB.decisionContent.reasoning.graph.relationships, graphBefore.relationships);
  assert.equal(snapshotB.decisionContent.reasoning.policyInputs.answers.DISCLOSE_SHARE_OWNERSHIP, "CONFIRMED");
});

test("correction preserves history and emits an open review target without destructive overwrite", () => {
  const setup = customCustomerSetup(initialDirectCase("g53c-correction"), {
    suffix: "correct-ownership", concept: "CURRENT_OWNERSHIP_AND_CONTROL", subjectEntityId: "entity-customer",
    strategy: "CUSTOMER_ATTESTATION", actionType: "REQUEST_ATTESTATION", templateId: "DISCLOSE_SHARE_OWNERSHIP",
  });
  const snapshotBefore = structuredClone(setup.snapshot);
  const result = applyInput(setup, eventFor(setup, { confirmationResult: "CORRECTION_REQUIRED" }), "correction-input");
  assert.deepEqual(setup.snapshot, snapshotBefore);
  assert.deepEqual(result.customerInputResult.createdClaimIds, []);
  assert.equal(result.customerInputResult.resolutionTargets[0].targetType, "CUSTOMER_CORRECTION_REVIEW");
  assert.equal(result.customerInputResult.resolutionTargets[0].currentState, "OPEN");
  assert.equal(Object.prototype.hasOwnProperty.call(result, "decisionSnapshot"), false);
});

test("senior-management input remains preparatory data and never assigns fallback status", () => {
  const setup = customCustomerSetup(initialDirectCase("g53c-senior-management"), {
    suffix: "senior-candidate", concept: "SENIOR_MANAGEMENT_CANDIDATE", subjectEntityId: "entity-customer",
    requirementId: "UBO-R10", strategy: "CUSTOMER_QUESTION", actionType: "REQUEST_CUSTOMER_INFORMATION",
    templateId: "IDENTIFY_SENIOR_MANAGEMENT_CANDIDATES",
  });
  const result = applyInput(setup, eventFor(setup, {
    values: { SENIOR_MANAGEMENT_CANDIDATE: { personEntityId: "entity-alice", factReferences: ["customer-input:senior-candidate"] } },
  }), "senior-management-input");
  assert.deepEqual(result.customerInputResult.createdClaimIds, []);
  const snapshotB = setup.app.evaluate({
    contractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V2, caseState: result.caseState,
    caseContext: { entityType: "private_limited_company", subjectEntityId: "entity-customer", jurisdiction: "GB", riskLevel: "LOW" },
    evaluationTime: T4, checkpoint: "CASE_OPEN", checkpointReference: { referenceId: "senior-management-b" }, resolutionInputs: {},
  }).decisionSnapshot;
  assert.equal(snapshotB.decisionContent.reasoning.customerInputRecords.at(-1).evaluationInputs.seniorManagementCandidates[0].personEntityId, "entity-alice");
  assert.equal((snapshotB.decisionContent.decision.fallbackApplication?.roles || []).some(({ role }) => role === "senior_managing_official_fallback"), false);
});

test("applyCustomerInput never returns a graph, qualification, requirement result, or DecisionSnapshot", () => {
  const setup = initialForeignCase("g53c-no-direct-mutation");
  const field = relationshipField(setup);
  const result = applyInput(setup, eventFor(setup, { values: { [field]: relationship("Alice", 80, "alice") } }), "no-direct-mutation");
  ["graph", "qualifyingPersons", "requirementResolutions", "decisionSnapshot"].forEach((fieldName) => {
    assert.equal(Object.prototype.hasOwnProperty.call(result, fieldName), false);
    assert.equal(Object.prototype.hasOwnProperty.call(result.customerInputResult, fieldName), false);
  });
  assert.throws(() => setup.app.evaluate({
    contractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V2, caseState: result.caseState,
    caseContext: { entityType: "private_limited_company", subjectEntityId: "entity-customer", jurisdiction: "GB" },
    evaluationTime: T4, checkpoint: "CASE_OPEN", checkpointReference: { referenceId: "must-adjudicate" }, resolutionInputs: {},
  }), (error) => error instanceof DecisionApplicationError && error.code === DECISION_APPLICATION_ERROR_CODE.UNRESOLVED_MANDATORY_DECISION_TARGET);
});
