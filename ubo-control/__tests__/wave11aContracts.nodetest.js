"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const policy = require("../policies/uk-corporate/1.6-rc/policy.json");
const baselinePolicy = require("../policies/uk-corporate/1.5-rc/policy.json");
const {
  CUSTOMER_ACTION_RESULT_V2,
  CUSTOMER_ACTION_TYPE_V2,
  CUSTOMER_ACTION_V2,
  DECISION_APPLICATION_CONTRACT_VERSION,
  DECISION_APPLICATION_CONTRACT_VERSION_V2,
  DECISION_APPLICATION_CONTRACT_VERSION_V3,
  JOURNEY_PROJECTION_V2,
  SUBMISSION_CONTRACT,
  createUboDecisionApplication,
  projectUboJourneyV2,
} = require("..");
const { CASE_STATE_INTERNALS } = require("../application/createUboDecisionApplication");
const { startReviewFixture } = require("../../ubo-control-lab/server/reviewLabEngine");

const NOW = "2026-09-08T10:00:00.000Z";
const LATER = "2026-09-08T11:00:00.000Z";

function toV3State(v2State) {
  const raw = CASE_STATE_INTERNALS.decodeCaseState(v2State, DECISION_APPLICATION_CONTRACT_VERSION_V2);
  return CASE_STATE_INTERNALS.encodeCaseState(raw, DECISION_APPLICATION_CONTRACT_VERSION_V3);
}

function actionFor(view, bundle, actionType, payload, overrides = {}) {
  const permitted = bundle.permittedSemanticActions.find((item) => item.actionType === actionType);
  assert.ok(permitted, `bundle should expose ${actionType}`);
  return {
    contractVersion: CUSTOMER_ACTION_V2,
    caseReference: view.journeyProjection.decision.caseReference,
    sourceDecisionSnapshot: {
      snapshotId: view.snapshot.snapshotId,
      snapshotHash: view.snapshot.decisionContentHash,
    },
    sourceResolutionPlan: { planId: view.plan.planId, planHash: view.plan.planHash },
    bundleId: bundle.bundleId,
    resolutionGroupId: bundle.resolutionGroupId,
    resolutionActionId: permitted.sourceResolutionActionId,
    informationNeedIds: bundle.informationNeedIds,
    requirementIds: bundle.requirementIds,
    canonicalSubject: bundle.canonicalSubject,
    frontierEntityIds: bundle.frontierEntityIds,
    policyIdentity: view.journeyProjection.decision.policyIdentity,
    actionType,
    submissionContract: permitted.submissionContract,
    actorReference: { referenceId: "applicant-1" },
    actorCapacity: "AUTHORISED_APPLICANT",
    submittedAt: NOW,
    informationAsAtDate: NOW,
    delegatedFrom: null,
    payload,
    ...overrides,
  };
}

function appV3(policyPack = policy) {
  return createUboDecisionApplication({
    policyPack,
    contractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V3,
  });
}

function testOnlyPolicy(requirementId, resolutionStrategies) {
  const fixture = structuredClone(policy);
  fixture.requirements.forEach((requirement) => {
    requirement.resolutionStrategies = requirement.requirementId === requirementId
      ? structuredClone(resolutionStrategies)
      : [];
  });
  return fixture;
}

function evaluateCustomerPlan(session, policyFixture, evaluationTime = NOW) {
  const app = appV3(policyFixture);
  const request = {
    contractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V3,
    runtimeMode: "LAB",
    caseState: toV3State(session.caseState),
    caseContext: session.caseContext,
    evaluationTime,
    checkpoint: "CASE_EVENT",
    checkpointReference: { referenceId: `wave11a:test-only-customer-plan:${session.caseId}` },
    resolutionInputs: {},
  };
  return { ...app.evaluate(request), app };
}

test("Decision Application v3 exposes exactly four explicit operations and keeps v1/v2 stable", () => {
  assert.deepEqual(Object.keys(appV3()), ["intake", "applyDecisions", "applyCustomerInput", "evaluate"]);
  assert.deepEqual(Object.keys(createUboDecisionApplication({ policyPack: baselinePolicy, contractVersion: DECISION_APPLICATION_CONTRACT_VERSION })), ["intake", "applyDecisions", "evaluate"]);
  assert.deepEqual(Object.keys(createUboDecisionApplication({ policyPack: baselinePolicy, contractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V2 })), ["intake", "applyDecisions", "applyCustomerInput", "evaluate"]);
  assert.equal(JSON.stringify(Object.keys(appV3())).includes("upload"), false);
});

test("Decision Application v3 is LAB-only and returns Snapshot v2 with the exact pinned Plan v2", () => {
  const session = startReviewFixture({ fixtureId: "V2-LAB-01" });
  const app = appV3();
  assert.throws(() => app.evaluate({
    contractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V3,
    runtimeMode: "PRODUCTION",
    caseState: toV3State(session.caseState),
    caseContext: session.caseContext,
    evaluationTime: NOW,
    checkpoint: "CASE_EVENT",
    checkpointReference: { referenceId: "production-rejected" },
    resolutionInputs: {},
  }), /LAB|review-only/i);
  const result = app.evaluate({
    contractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V3,
    runtimeMode: "LAB",
    caseState: toV3State(session.caseState),
    caseContext: session.caseContext,
    evaluationTime: NOW,
    checkpoint: "CASE_EVENT",
    checkpointReference: { referenceId: "lab-accepted" },
    resolutionInputs: {},
  });
  assert.equal(result.decisionSnapshot.snapshotSchemaVersion, "ubo-decision-snapshot-v2");
  assert.equal(result.resolutionPlan.contractVersion, "ubo-resolution-plan-v2");
  assert.deepEqual(result.resolutionPlan, result.decisionSnapshot.decisionContent.pinnedResolutionPlan);
  assert.equal(result.governance.productionAuthorized, false);
  assert.equal(result.journeyProjection.contractVersion, JOURNEY_PROJECTION_V2);
});

test("JourneyProjection v2 is deterministic, verified-snapshot-only, and preserves customer/final completion distinction", () => {
  const system = startReviewFixture({ fixtureId: "V2-LAB-07" }).snapshots[0].view;
  const customer = startReviewFixture({ fixtureId: "V2-LAB-08" }).snapshots[0].view;
  const specialist = startReviewFixture({ fixtureId: "V2-LAB-10" }).snapshots[0].view;
  const blocked = startReviewFixture({ fixtureId: "V2-LAB-09" }).snapshots[0].view;
  const first = projectUboJourneyV2({ decisionSnapshot: customer.snapshot });
  const second = projectUboJourneyV2({ decisionSnapshot: JSON.parse(JSON.stringify(customer.snapshot)) });
  assert.deepEqual(first, second);
  assert.equal(system.journeyProjection.customerWorkState, "SYSTEM_RESOLUTION");
  assert.equal(system.journeyProjection.customerInputComplete, true);
  assert.equal(system.journeyProjection.finalCaseComplete, false);
  assert.equal(customer.journeyProjection.customerWorkState, "CUSTOMER_INPUT_REQUIRED");
  assert.equal(customer.journeyProjection.customerWorkBundles.length, customer.plan.customerBundles.length);
  assert.deepEqual(
    customer.journeyProjection.customerWorkBundles.flatMap(({ actionIds }) => actionIds).sort(),
    customer.plan.customerBundles.flatMap(({ actionIds }) => actionIds).sort(),
  );
  assert.equal(customer.journeyProjection.customerWorkBundles.every(({ actionIds }) => actionIds.length === 1), true);
  assert.equal(customer.journeyProjection.finishLine.currentCustomerBundles, 2);
  assert.equal(customer.journeyProjection.finishLine.currentCustomerBundles < customer.counts.affectedPaths, true);
  assert.equal(customer.journeyProjection.policyContentBlocks.length > 0, true);
  assert.equal(system.journeyProjection.systemWork.length, system.plan.systemActions.length);
  assert.equal(system.journeyProjection.internalReview.requirements.length, system.snapshot.decisionContent.reviewRequirements.length);
  assert.equal(specialist.journeyProjection.specialistReview.routes.length, 1);
  assert.equal(blocked.journeyProjection.blockers.length, 1);
  assert.throws(() => projectUboJourneyV2({ decisionSnapshot: { ...customer.snapshot, decisionContentHash: "sha256:tampered" } }), /projected consistently|verification/i);
});

test("external Evidence action returns only a data handoff and leaves causal needs open", () => {
  const session = startReviewFixture({ fixtureId: "V2-LAB-08" });
  const view = session.snapshots[0].view;
  const bundle = view.journeyProjection.customerWorkBundles.find((item) => item.permittedSemanticActions.some(({ actionType, executable }) => actionType === CUSTOMER_ACTION_TYPE_V2.REQUEST_EXTERNAL_EVIDENCE && executable));
  assert.ok(bundle);
  const result = appV3().applyCustomerInput({
    contractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V3,
    caseState: toV3State(session.caseState),
    sourceDecisionSnapshot: view.snapshot,
    sourceResolutionPlan: view.plan,
    customerAction: actionFor(view, bundle, CUSTOMER_ACTION_TYPE_V2.REQUEST_EXTERNAL_EVIDENCE, {
      requestCorrelationId: "evidence-request-1",
      evidenceCategories: bundle.evidenceHandoff.semanticEvidenceCategories.length ? bundle.evidenceHandoff.semanticEvidenceCategories : ["OWNERSHIP_STRUCTURE_EVIDENCE"],
      requestedConcepts: bundle.evidenceHandoff.requestedConcepts.length ? bundle.evidenceHandoff.requestedConcepts : ["CURRENT_OWNERSHIP_AND_CONTROL"],
      informationAsAtDate: NOW,
    }),
    operationId: "wave11a-evidence-request-1",
  });
  const outcome = result.customerActionResult;
  assert.equal(outcome.contractVersion, CUSTOMER_ACTION_RESULT_V2);
  assert.equal(outcome.externalEvidenceHandoff.handoffType, "EXTERNAL_EVIDENCE_REQUIRED");
  assert.equal(outcome.externalEvidenceHandoff.executionConnected, false);
  assert.equal(outcome.needSatisfiedByReceipt, false);
  assert.equal(outcome.hiddenEvaluationPerformed, false);
  assert.deepEqual(outcome.actionProvenance, {
    actorReference: { referenceId: "applicant-1" },
    actorCapacity: "AUTHORISED_APPLICANT",
    submittedAt: NOW,
    informationAsAtDate: NOW,
    delegatedFrom: null,
  });
  assert.equal(outcome.remainingOpenWorkReferences.length, bundle.informationNeedIds.length);
  assert.doesNotMatch(JSON.stringify(outcome.externalEvidenceHandoff), /base64|blob|filesystem|artifactId|repository/i);
});

test("delegation is a data-only host handoff and is never treated as completion", () => {
  const session = startReviewFixture({ fixtureId: "V2-LAB-08" });
  const view = session.snapshots[0].view;
  const bundle = view.journeyProjection.customerWorkBundles.find((item) => item.permittedSemanticActions.some(({ actionType, executable }) => actionType === CUSTOMER_ACTION_TYPE_V2.DELEGATE_CUSTOMER_WORK && executable));
  const result = appV3().applyCustomerInput({
    contractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V3,
    caseState: toV3State(session.caseState),
    sourceDecisionSnapshot: view.snapshot,
    sourceResolutionPlan: view.plan,
    customerAction: actionFor(view, bundle, CUSTOMER_ACTION_TYPE_V2.DELEGATE_CUSTOMER_WORK, {
      delegateReference: "delegate-ref-7",
      delegateCapacity: "GROUP_COMPANY_SECRETARY",
      requestedWorkScope: "Provide the requested ownership structure information",
      informationAsAtExpectation: NOW,
      correlationId: "delegation-1",
    }),
    operationId: "wave11a-delegation-1",
  });
  assert.equal(result.customerActionResult.delegationHandoff.authorizationGranted, false);
  assert.equal(result.customerActionResult.delegationHandoff.workCompleted, false);
  assert.equal(result.customerActionResult.requiredNextOperation, "HOST_DELEGATION_EXECUTION");
  assert.doesNotMatch(JSON.stringify(result.customerActionResult.delegationHandoff), /email|credential|accountId/i);
});

test("confirmation records provenance without duplicate graph relationships and correction preserves history", () => {
  const session = startReviewFixture({ fixtureId: "V2-LAB-07" });
  const requirement = policy.requirements.find(({ requirementId }) => requirementId === "UBO-R06");
  const strategy = requirement.resolutionStrategies.find(({ strategy: name }) => name === "CUSTOMER_ATTESTATION");
  const evaluated = evaluateCustomerPlan(session, testOnlyPolicy(requirement.requirementId, [strategy]));
  const view = {
    snapshot: evaluated.decisionSnapshot,
    plan: evaluated.resolutionPlan,
    journeyProjection: evaluated.journeyProjection,
  };
  const bundle = view.journeyProjection.customerWorkBundles.find((item) => item.permittedSemanticActions.some(({ actionType }) => actionType === CUSTOMER_ACTION_TYPE_V2.CONFIRM_ESTABLISHED_INFORMATION));
  assert.ok(bundle, `confirmation attempts ${view.plan.attemptHistory.length} plan ${JSON.stringify(view.plan.recommendedActions.map(({ semanticActionType, actionTemplateReference, coveredInformationNeedIds }) => ({ semanticActionType, actionTemplateReference, coveredInformationNeedIds })))}`);
  const sourceRaw = CASE_STATE_INTERNALS.decodeCaseState(evaluated.caseState, DECISION_APPLICATION_CONTRACT_VERSION_V3);
  const relationshipIds = bundle.knownInformation.relationships.map(({ relationshipId }) => relationshipId);
  assert.ok(relationshipIds.length > 0);
  const confirmationResult = evaluated.app.applyCustomerInput({
    contractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V3,
    caseState: evaluated.caseState,
    sourceDecisionSnapshot: view.snapshot,
    sourceResolutionPlan: view.plan,
    customerAction: actionFor(view, bundle, CUSTOMER_ACTION_TYPE_V2.CONFIRM_ESTABLISHED_INFORMATION, {
      confirmation: "CONFIRMED",
      establishedRelationshipIds: relationshipIds,
      establishedClaimIds: bundle.knownInformation.relationships.flatMap(({ supportingClaimIds }) => supportingClaimIds),
    }),
    operationId: "wave11a-confirmation-1",
  });
  const confirmedRaw = CASE_STATE_INTERNALS.decodeCaseState(confirmationResult.caseState, DECISION_APPLICATION_CONTRACT_VERSION_V3);
  assert.equal(confirmedRaw.candidateClaims.length, sourceRaw.candidateClaims.length);
  assert.equal(confirmationResult.customerActionResult.customerConfirmation.status, "CONFIRMED");
  assert.deepEqual(confirmationResult.customerActionResult.customerConfirmation.actorReference, { referenceId: "applicant-1" });
  assert.equal(confirmationResult.customerActionResult.customerConfirmation.actorCapacity, "AUTHORISED_APPLICANT");
  assert.equal(confirmationResult.customerActionResult.customerConfirmation.informationAsAtDate, NOW);
  assert.equal(confirmationResult.customerActionResult.customerConfirmation.independentEvidenceStillRequired, true);
  assert.equal(confirmationResult.customerActionResult.customerOriginatedCandidateFacts.length, 0);

  const relationship = bundle.knownInformation.relationships[0];
  const correctionResult = evaluated.app.applyCustomerInput({
    contractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V3,
    caseState: evaluated.caseState,
    sourceDecisionSnapshot: view.snapshot,
    sourceResolutionPlan: view.plan,
    customerAction: actionFor(view, bundle, CUSTOMER_ACTION_TYPE_V2.CORRECTION_REQUIRED, {
      confirmation: "CORRECTION_REQUIRED",
      affectedEntityIds: [relationship.subjectEntityId, relationship.objectEntityId],
      affectedRelationshipIds: [relationship.relationshipId],
      changedFact: {
        type: "RELATIONSHIP",
        subject: { entityId: relationship.subjectEntityId, externalIdentifiers: [] },
        object: { entityId: relationship.objectEntityId, externalIdentifiers: [] },
        relationship: "ECONOMIC_OWNERSHIP",
        measurement: { type: "EXACT", value: 45 },
        qualifiers: { currentState: "CURRENT", economicInterestConcept: "SHARE_OWNERSHIP" },
        evidenceReferences: [],
      },
      effectiveDate: NOW,
      sourceClaimIds: relationship.supportingClaimIds,
      requestEvidence: false,
    }),
    operationId: "wave11a-correction-1",
  });
  const correctedRaw = CASE_STATE_INTERNALS.decodeCaseState(correctionResult.caseState, DECISION_APPLICATION_CONTRACT_VERSION_V3);
  assert.equal(correctedRaw.candidateClaims.length, sourceRaw.candidateClaims.length + 1);
  assert.equal(correctedRaw.candidateClaims.at(-1).status, "CANDIDATE");
  relationship.supportingClaimIds.forEach((claimId) => assert.equal(sourceRaw.candidateClaims.find((claim) => claim.claimId === claimId).status, "OPERATIVE"));
  assert.equal(correctionResult.customerActionResult.correctionTargets[0].state, "OPEN");
});

test("structured share ownership remains candidate until explicit decisions and then produces a new Snapshot v2", () => {
  const session = startReviewFixture({ fixtureId: "V2-LAB-07" });
  const requirement = policy.requirements.find(({ requirementId }) => requirementId === "UBO-R01");
  const strategy = requirement.resolutionStrategies.find(({ actionTemplateId }) => actionTemplateId === "DISCLOSE_SHARE_OWNERSHIP");
  const evaluated = evaluateCustomerPlan(session, testOnlyPolicy(requirement.requirementId, [strategy]));
  const view = {
    snapshot: evaluated.decisionSnapshot,
    plan: evaluated.resolutionPlan,
    journeyProjection: evaluated.journeyProjection,
  };
  const bundle = view.journeyProjection.customerWorkBundles.find((item) => item.canonicalSubject.entityIds.includes("bellis-finco")
    && item.permittedSemanticActions.some(({ actionType }) => actionType === CUSTOMER_ACTION_TYPE_V2.SUBMIT_STRUCTURED_RELATIONSHIP));
  assert.ok(bundle, `structured plan ${JSON.stringify(view.plan.recommendedActions.map(({ semanticActionType, actionTemplateReference, coveredInformationNeedIds }) => ({ semanticActionType, actionTemplateReference, coveredInformationNeedIds })))}`);
  const targetEntityId = bundle.canonicalSubject.entityIds[0];
  const previousSnapshot = structuredClone(view.snapshot);
  const applied = evaluated.app.applyCustomerInput({
    contractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V3,
    caseState: evaluated.caseState,
    sourceDecisionSnapshot: view.snapshot,
    sourceResolutionPlan: view.plan,
    customerAction: actionFor(view, bundle, CUSTOMER_ACTION_TYPE_V2.SUBMIT_STRUCTURED_RELATIONSHIP, {
      relationships: [{
        localPartyKey: "new-owner-1",
        owner: { localPartyKey: "new-owner-1", name: "Taylor Example", entityType: "NATURAL_PERSON", jurisdiction: "GB", externalIdentifiers: [] },
        targetEntityId,
        concept: "SHARE_OWNERSHIP",
        direction: "OWNER_TO_TARGET",
        relationshipType: "ECONOMIC_OWNERSHIP",
        measurement: { type: "RANGE", lowerBound: 25, upperBound: 50, lowerInclusive: false, upperInclusive: true },
        assertionState: "CURRENT",
        asAtDate: NOW,
      }],
    }),
    operationId: "wave11a-structured-owner-1",
  });
  assert.equal(applied.customerActionResult.customerOriginatedCandidateFacts[0].relationship, "ECONOMIC_OWNERSHIP");
  assert.equal(applied.customerActionResult.claimAdjudicationTargets[0].currentState, "CANDIDATE");
  const rawAfterInput = CASE_STATE_INTERNALS.decodeCaseState(applied.caseState, DECISION_APPLICATION_CONTRACT_VERSION_V3);
  assert.equal(rawAfterInput.candidateClaims.at(-1).status, "CANDIDATE");

  const newClaimId = applied.customerActionResult.claimAdjudicationTargets[0].claimId;
  const decided = evaluated.app.applyDecisions({
    contractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V3,
    caseState: applied.caseState,
    entityRegistrations: [{
      entityId: "new-owner-entity",
      category: "NATURAL_PERSON",
      primaryName: "Taylor Example",
      aliases: [],
      externalIdentifiers: [],
      jurisdiction: "GB",
      entityTypeMetadata: { registrationOrigin: "CUSTOMER" },
      recordedAt: LATER,
    }],
    identityDecisions: applied.decisionTargets.candidateParties.map((target, index) => ({
      decisionId: `wave11a-identity-${index + 1}`,
      candidatePartyKey: target.candidatePartyKey,
      status: "RESOLVED",
      entityId: target.party.entityId || "new-owner-entity",
      basisReasonCodes: ["EXPLICIT_CUSTOMER_PARTY_DECISION"],
      evidenceReferences: [],
      decidedAt: LATER,
      decisionOrigin: "WAVE_11A_TEST",
    })),
    claimAdjudications: [{
      decisionId: "wave11a-claim-operative-1",
      claimId: newClaimId,
      previousState: "CANDIDATE",
      resultingState: "OPERATIVE",
      reasonBasisCode: "EXPLICIT_CUSTOMER_CLAIM_DECISION",
      supportingEvidenceReferences: [],
      decisionOrigin: "WAVE_11A_TEST",
      decidedAt: LATER,
      supersededByClaimIds: [],
      adversarialClaimIds: [],
    }],
  });
  const reevaluated = evaluated.app.evaluate({
    contractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V3,
    runtimeMode: "LAB",
    caseState: decided.caseState,
    caseContext: session.caseContext,
    evaluationTime: LATER,
    checkpoint: "CUSTOMER_INPUT",
    checkpointReference: { referenceId: "wave11a-structured-owner-reevaluation" },
    decisionHistory: evaluated.decisionHistory,
    expectedHeadSnapshotId: view.snapshot.snapshotId,
    supersessionReason: "CUSTOMER_INPUT",
    resolutionInputs: {},
  });
  assert.notEqual(reevaluated.decisionSnapshot.snapshotId, view.snapshot.snapshotId);
  assert.deepEqual(view.snapshot, previousSnapshot);
  assert.equal(reevaluated.ownershipGraphProjection.relationships.some(({ supportingClaimIds }) => supportingClaimIds.includes(newClaimId)), true);
});

test("structured ownership rejects wrong concept, direction, relationship type, and inner target", () => {
  const session = startReviewFixture({ fixtureId: "V2-LAB-07" });
  const requirement = policy.requirements.find(({ requirementId }) => requirementId === "UBO-R01");
  const strategy = requirement.resolutionStrategies.find(({ actionTemplateId }) => actionTemplateId === "DISCLOSE_SHARE_OWNERSHIP");
  const evaluated = evaluateCustomerPlan(session, testOnlyPolicy(requirement.requirementId, [strategy]));
  const view = {
    snapshot: evaluated.decisionSnapshot,
    plan: evaluated.resolutionPlan,
    journeyProjection: evaluated.journeyProjection,
  };
  const bundle = view.journeyProjection.customerWorkBundles.find((item) => item.canonicalSubject.entityIds.includes("bellis-finco")
    && item.permittedSemanticActions.some(({ actionType }) => actionType === CUSTOMER_ACTION_TYPE_V2.SUBMIT_STRUCTURED_RELATIONSHIP));
  assert.ok(bundle);
  const targetEntityId = bundle.canonicalSubject.entityIds[0];
  const statement = {
    localPartyKey: "negative-owner-1",
    owner: { localPartyKey: "negative-owner-1", name: "Morgan Example", entityType: "NATURAL_PERSON", externalIdentifiers: [] },
    targetEntityId,
    concept: "SHARE_OWNERSHIP",
    direction: "OWNER_TO_TARGET",
    relationshipType: "ECONOMIC_OWNERSHIP",
    measurement: { type: "EXACT", value: 30 },
    assertionState: "CURRENT",
    asAtDate: NOW,
  };
  const apply = (changedStatement) => evaluated.app.applyCustomerInput({
    contractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V3,
    caseState: evaluated.caseState,
    sourceDecisionSnapshot: view.snapshot,
    sourceResolutionPlan: view.plan,
    customerAction: actionFor(view, bundle, CUSTOMER_ACTION_TYPE_V2.SUBMIT_STRUCTURED_RELATIONSHIP, {
      relationships: [{ ...statement, ...changedStatement }],
    }),
    operationId: `wave11a-invalid-structured-${Object.keys(changedStatement)[0]}`,
  });
  assert.throws(() => apply({ concept: "VOTING_CONTROL" }), /SHARE_OWNERSHIP/);
  assert.throws(() => apply({ direction: "TARGET_TO_OWNER" }), /OWNER_TO_TARGET/);
  assert.throws(() => apply({ relationshipType: "VOTING_RIGHTS" }), /ECONOMIC_OWNERSHIP/);
  assert.throws(() => apply({ targetEntityId: "asda-delivery" }), /planned subject/);
});

test("CustomerAction v2 rejects stale pins, fabricated fields, mismatched targets, and A-02/A-04/A-17 blocked work", () => {
  const session = startReviewFixture({ fixtureId: "V2-LAB-08" });
  const view = session.snapshots[0].view;
  const bundle = view.journeyProjection.customerWorkBundles.find((item) => item.permittedSemanticActions.some(({ executable }) => executable));
  const permitted = bundle.permittedSemanticActions.find(({ executable }) => executable);
  const payload = permitted.actionType === CUSTOMER_ACTION_TYPE_V2.DELEGATE_CUSTOMER_WORK ? {
    delegateReference: "delegate-ref",
    delegateCapacity: "ADVISER",
    requestedWorkScope: "Requested work",
    informationAsAtExpectation: NOW,
    correlationId: "corr",
  } : {
    requestCorrelationId: "corr",
    evidenceCategories: ["OWNERSHIP_STRUCTURE_EVIDENCE"],
    requestedConcepts: ["CURRENT_OWNERSHIP_AND_CONTROL"],
    informationAsAtDate: NOW,
  };
  const valid = actionFor(view, bundle, permitted.actionType, payload);
  const apply = (customerAction) => appV3().applyCustomerInput({
    contractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V3,
    caseState: toV3State(session.caseState),
    sourceDecisionSnapshot: view.snapshot,
    sourceResolutionPlan: view.plan,
    customerAction,
    operationId: "wave11a-negative",
  });
  assert.throws(() => apply({ ...valid, sourceResolutionPlan: { ...valid.sourceResolutionPlan, planHash: "sha256:stale" } }), /stale|plan pins/i);
  assert.throws(() => apply({ ...valid, sourceDecisionSnapshot: { ...valid.sourceDecisionSnapshot, snapshotHash: "sha256:stale" } }), /stale|snapshot pins/i);
  assert.throws(() => apply({ ...valid, fabricatedField: true }), /unsupported field/i);
  assert.throws(() => apply({ ...valid, informationNeedIds: ["fabricated-need"] }), /InformationNeed pins/i);
  assert.throws(() => apply({ ...valid, canonicalSubject: { entityId: "wrong", entityIds: ["wrong"] } }), /subject|target/i);
  const blocked = view.journeyProjection.customerWorkBundles.find((item) => item.permittedSemanticActions.every(({ executable }) => !executable));
  assert.ok(blocked.signoffDependencies.some((id) => ["A-02", "A-04", "A-17"].includes(id)));
  const blockedAction = blocked.permittedSemanticActions[0];
  assert.throws(() => apply(actionFor(view, blocked, blockedAction.actionType, payload)), /blocked|sign-off|policy content/i);
  assert.deepEqual(view.journeyProjection.residualConfirmation.requiredSignoffIds, ["A-02", "A-17"]);
  assert.equal(view.journeyProjection.customerWorkBundles.some(({ signoffDependencies }) => signoffDependencies.includes("A-04") && signoffDependencies.includes("A-17")), true);
});
