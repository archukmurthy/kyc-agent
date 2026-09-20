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
const { createEvidencePolicyClassification } = require("../policy/evidencePolicy");
const { loadPolicyPack } = require("../policy/policyPack");
const { startReviewFixture } = require("../../ubo-control-lab/server/reviewLabEngine");

const NOW = "2026-09-08T10:00:00.000Z";
const LATER = "2026-09-08T11:00:00.000Z";

function toV3State(v2State) {
  const raw = CASE_STATE_INTERNALS.decodeCaseState(v2State, DECISION_APPLICATION_CONTRACT_VERSION_V2);
  return CASE_STATE_INTERNALS.encodeCaseState(raw, DECISION_APPLICATION_CONTRACT_VERSION_V3);
}

function confirmationCompatibleSession() {
  const session = startReviewFixture({ fixtureId: "V2-LAB-07" });
  const raw = structuredClone(CASE_STATE_INTERNALS.decodeCaseState(
    session.caseState,
    DECISION_APPLICATION_CONTRACT_VERSION_V2,
  ));
  const establishedControl = raw.candidateClaims.find((claim) => claim.status === "OPERATIVE"
    && claim.relationship === "SIGNIFICANT_INFLUENCE_OR_CONTROL"
    && claim.subject?.party?.entityId === "tdr-gp-a"
    && claim.object?.party?.entityId === "bellis-finco");
  assert.ok(establishedControl, "confirmation test requires the established TDR control relationship");
  establishedControl.qualifiers.currentState = "UNKNOWN";
  return {
    ...session,
    caseState: CASE_STATE_INTERNALS.encodeCaseState(raw, DECISION_APPLICATION_CONTRACT_VERSION_V2),
  };
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

function setSignoffStatus(fixture, signoffId, status) {
  const signoff = fixture.signoffs.find((item) => item.signoffId === signoffId);
  assert.ok(signoff);
  signoff.status = status;
  delete signoff.approver;
  delete signoff.approvedAt;
  delete signoff.effectiveFrom;
  if (status === "APPROVED") {
    signoff.approver = { identity: "WAVE_11A_TEST", capacity: "TEST_AUTHORITY" };
    signoff.approvedAt = "2026-09-01T00:00:00.000Z";
    signoff.effectiveFrom = "2026-09-01T00:00:00.000Z";
  }
}

function numericControlPolicy(signoffStates, { omitA04 = false } = {}) {
  const fixture = structuredClone(policy);
  fixture.requirements.forEach((requirement) => {
    requirement.resolutionStrategies = requirement.requirementId === "UBO-R04"
      ? [structuredClone(requirement.resolutionStrategies.find(({ strategy }) => strategy === "CUSTOMER_QUESTION"))]
      : [];
  });
  const feature = fixture.productionReadiness.features
    .find(({ featureId }) => featureId === "NUMERIC_CUSTOMER_CONTROL_QUESTIONS");
  feature.enabled = true;
  Object.entries(signoffStates).forEach(([signoffId, status]) => setSignoffStatus(fixture, signoffId, status));
  if (omitA04) {
    fixture.signoffs = fixture.signoffs.filter(({ signoffId }) => signoffId !== "A-04");
    feature.requiredSignoffIds = feature.requiredSignoffIds.filter((signoffId) => signoffId !== "A-04");
  }
  return fixture;
}

function r08EvidenceClassification(session, policyFixture) {
  const caseState = CASE_STATE_INTERNALS.decodeCaseState(
    session.caseState,
    DECISION_APPLICATION_CONTRACT_VERSION_V2,
  );
  const sourceClaim = caseState.candidateClaims.find(({ evidenceReferences }) => evidenceReferences.length > 0);
  return createEvidencePolicyClassification({
    loadedPolicyPack: loadPolicyPack(policyFixture),
    caseState,
    input: {
      evidenceReference: sourceClaim.evidenceReferences[0],
      evidenceCatalogueKey: "companies_house_record",
      sourceOrigin: "INDEPENDENT_OF_APPLICANT",
      capturedAt: NOW,
      sourceEffectiveAt: NOW,
      currentState: "CURRENT",
      classificationBasis: { origin: "WAVE_11A_SCHEMA_1_3_TEST_FIXTURE" },
      supports: [{
        requirementId: "UBO-R08",
        direction: "POSITIVE",
        policyFactKey: "ownership_structure",
        resolutionStrategy: "EXISTING_EVIDENCE",
        basisAssessmentIds: [],
        claimIds: [sourceClaim.claimId],
      }],
    },
  });
}

function evaluateCustomerPlan(session, policyFixture, evaluationTime = NOW, resolutionInputs = {}) {
  const app = appV3(policyFixture);
  const request = {
    contractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V3,
    runtimeMode: "LAB",
    caseState: toV3State(session.caseState),
    caseContext: session.caseContext,
    evaluationTime,
    checkpoint: "CASE_EVENT",
    checkpointReference: { referenceId: `wave11a:test-only-customer-plan:${session.caseId}` },
    resolutionInputs,
  };
  return { ...app.evaluate(request), app };
}

function applyConfirmation(evaluated, operationId) {
  const view = {
    snapshot: evaluated.decisionSnapshot,
    plan: evaluated.resolutionPlan,
    journeyProjection: evaluated.journeyProjection,
  };
  const bundle = view.journeyProjection.customerWorkBundles.find((item) =>
    item.permittedSemanticActions.some(({ actionType }) =>
      actionType === CUSTOMER_ACTION_TYPE_V2.CONFIRM_ESTABLISHED_INFORMATION));
  assert.ok(bundle);
  const relationships = bundle.knownInformation.relationships;
  assert.ok(relationships.length > 0);
  return evaluated.app.applyCustomerInput({
    contractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V3,
    caseState: evaluated.caseState,
    sourceDecisionSnapshot: view.snapshot,
    sourceResolutionPlan: view.plan,
    customerAction: actionFor(
      view,
      bundle,
      CUSTOMER_ACTION_TYPE_V2.CONFIRM_ESTABLISHED_INFORMATION,
      {
        confirmation: "CONFIRMED",
        establishedRelationshipIds: relationships.map(({ relationshipId }) => relationshipId),
        establishedClaimIds: relationships.flatMap(({ supportingClaimIds }) => supportingClaimIds),
      },
    ),
    operationId,
  });
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

test("JourneyProjection v2 is deterministic over a verified snapshot and identity-matched policy", () => {
  const system = startReviewFixture({ fixtureId: "V2-LAB-07" }).snapshots[0].view;
  const customer = startReviewFixture({ fixtureId: "V2-LAB-08" }).snapshots[0].view;
  const specialist = startReviewFixture({ fixtureId: "V2-LAB-10" }).snapshots[0].view;
  const blocked = startReviewFixture({ fixtureId: "V2-LAB-09" }).snapshots[0].view;
  const first = projectUboJourneyV2({ decisionSnapshot: customer.snapshot, policyPack: policy });
  const second = projectUboJourneyV2({ decisionSnapshot: JSON.parse(JSON.stringify(customer.snapshot)), policyPack: policy });
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
  assert.throws(() => projectUboJourneyV2({
    decisionSnapshot: { ...customer.snapshot, decisionContentHash: "sha256:tampered" },
    policyPack: policy,
  }), /projected consistently|verification/i);
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
  const session = confirmationCompatibleSession();
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
  assert.equal(confirmationResult.customerActionResult.customerConfirmation.confirmationDoesNotReplaceIndependentEvidence, true);
  assert.equal(confirmationResult.customerActionResult.customerConfirmation.independentEvidenceRequirementState, "OPEN");
  assert.equal("independentEvidenceStillRequired" in confirmationResult.customerActionResult.customerConfirmation, false);
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

test("sign-off dependencies retain audit status and only exact APPROVED clears execution", () => {
  const delegationPayload = {
    delegateReference: "signoff-test-delegate",
    delegateCapacity: "AUTHORISED_REPRESENTATIVE",
    requestedWorkScope: "Provide the planned information",
    informationAsAtExpectation: NOW,
    correlationId: "signoff-test-correlation",
  };
  const noDependencies = startReviewFixture({ fixtureId: "V2-LAB-08" }).snapshots[0].view
    .journeyProjection.customerWorkBundles
    .flatMap(({ permittedSemanticActions }) => permittedSemanticActions)
    .find(({ executable, signoffDependencies }) => executable && signoffDependencies.length === 0);
  assert.ok(noDependencies);
  assert.deepEqual(noDependencies.blockingSignoffs, []);

  const cases = [
    { label: "OPEN", statuses: { "A-04": "OPEN", "A-17": "OPEN" }, executable: false },
    {
      label: "RESEARCH_COMPLETE_SIGNOFF_PENDING",
      statuses: { "A-04": "RESEARCH_COMPLETE_SIGNOFF_PENDING", "A-17": "RESEARCH_COMPLETE_SIGNOFF_PENDING" },
      executable: false,
    },
    { label: "DEFERRED", statuses: { "A-04": "DEFERRED", "A-17": "DEFERRED" }, executable: false },
    { label: "REJECTED", statuses: { "A-04": "REJECTED", "A-17": "REJECTED" }, executable: false },
    { label: "WATCH", statuses: { "A-04": "WATCH", "A-17": "WATCH" }, executable: false },
    { label: "APPROVED", statuses: { "A-04": "APPROVED", "A-17": "APPROVED" }, executable: true },
    { label: "MIXED", statuses: { "A-04": "APPROVED", "A-17": "OPEN" }, executable: false },
  ];
  cases.forEach(({ label, statuses, executable }) => {
    const evaluated = evaluateCustomerPlan(
      startReviewFixture({ fixtureId: "V2-LAB-01" }),
      numericControlPolicy(statuses),
    );
    const bundle = evaluated.journeyProjection.customerWorkBundles
      .find(({ signoffDependencies }) => signoffDependencies.includes("A-04"));
    assert.ok(bundle, label);
    const action = bundle.permittedSemanticActions
      .find(({ actionType }) => actionType === CUSTOMER_ACTION_TYPE_V2.DELEGATE_CUSTOMER_WORK);
    assert.equal(action.executable, executable, label);
    assert.deepEqual(action.signoffDependencies.map(({ signoffId }) => signoffId), ["A-04", "A-17"], label);
    assert.deepEqual(
      action.blockingSignoffs.map(({ signoffId }) => signoffId),
      executable ? [] : label === "MIXED" ? ["A-17"] : ["A-04", "A-17"],
      label,
    );
    assert.deepEqual(bundle.signoffDependencies, ["A-04", "A-17"], label);
    if (executable) {
      const view = {
        snapshot: evaluated.decisionSnapshot,
        plan: evaluated.resolutionPlan,
        journeyProjection: evaluated.journeyProjection,
      };
      const applied = evaluated.app.applyCustomerInput({
        contractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V3,
        caseState: evaluated.caseState,
        sourceDecisionSnapshot: view.snapshot,
        sourceResolutionPlan: view.plan,
        customerAction: actionFor(
          view,
          bundle,
          CUSTOMER_ACTION_TYPE_V2.DELEGATE_CUSTOMER_WORK,
          delegationPayload,
        ),
        operationId: "wave11a-approved-signoff-execution",
      });
      assert.equal(applied.customerActionResult.accepted, true);
    }
  });

  const missing = evaluateCustomerPlan(
    startReviewFixture({ fixtureId: "V2-LAB-01" }),
    numericControlPolicy({ "A-17": "APPROVED" }, { omitA04: true }),
  );
  const missingBundle = missing.journeyProjection.customerWorkBundles
    .find(({ signoffDependencies }) => signoffDependencies.includes("A-04"));
  const missingAction = missingBundle.permittedSemanticActions
    .find(({ actionType }) => actionType === CUSTOMER_ACTION_TYPE_V2.DELEGATE_CUSTOMER_WORK);
  assert.equal(missingAction.executable, false);
  assert.deepEqual(missingAction.blockingSignoffs, [{ signoffId: "A-04", status: "MISSING" }]);
  const missingView = {
    snapshot: missing.decisionSnapshot,
    plan: missing.resolutionPlan,
    journeyProjection: missing.journeyProjection,
  };
  assert.throws(() => missing.app.applyCustomerInput({
    contractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V3,
    caseState: missing.caseState,
    sourceDecisionSnapshot: missingView.snapshot,
    sourceResolutionPlan: missingView.plan,
    customerAction: actionFor(
      missingView,
      missingBundle,
      CUSTOMER_ACTION_TYPE_V2.DELEGATE_CUSTOMER_WORK,
      delegationPayload,
    ),
    operationId: "wave11a-missing-signoff-rejected",
  }), /sign-off|blocked/i);
});

test("confirmation reports the pinned R08 state without changing evidence sufficiency", () => {
  const session = confirmationCompatibleSession();
  const requirement = policy.requirements.find(({ requirementId }) => requirementId === "UBO-R06");
  const strategy = requirement.resolutionStrategies
    .find(({ strategy: name }) => name === "CUSTOMER_ATTESTATION");

  const openPolicy = testOnlyPolicy(requirement.requirementId, [strategy]);
  const open = evaluateCustomerPlan(session, openPolicy);
  const openSnapshot = structuredClone(open.decisionSnapshot);
  const openResult = applyConfirmation(open, "wave11a-confirmation-r08-open");
  assert.equal(openResult.customerActionResult.customerConfirmation.confirmationDoesNotReplaceIndependentEvidence, true);
  assert.equal(openResult.customerActionResult.customerConfirmation.independentEvidenceRequirementState, "OPEN");
  assert.deepEqual(open.decisionSnapshot, openSnapshot);
  assert.equal("decisionSnapshot" in openResult, false);

  const satisfiedPolicy = testOnlyPolicy(requirement.requirementId, [strategy]);
  const satisfiedR08 = satisfiedPolicy.requirements
    .find(({ requirementId }) => requirementId === "UBO-R08");
  satisfiedR08.resolutionStrategies = [structuredClone(
    policy.requirements.find(({ requirementId }) => requirementId === "UBO-R08").resolutionStrategies[0],
  )];
  satisfiedR08.resolutionStrategies[0].resolutionEffect = "POSITIVE_ONLY";
  satisfiedPolicy.evidenceCatalogue.items
    .find(({ key }) => key === "companies_house_record")
    .factRules.ownership_structure = {
      canResolveAlone: true,
      corroborationRequired: false,
      resolutionEffect: "POSITIVE_ONLY",
    };
  const satisfiedEvidence = r08EvidenceClassification(session, satisfiedPolicy);
  const satisfied = evaluateCustomerPlan(
    session,
    satisfiedPolicy,
    NOW,
    { evidenceClassifications: [satisfiedEvidence] },
  );
  assert.equal(
    satisfied.decisionSnapshot.decisionContent.requirementResolutions
      .find(({ requirementId }) => requirementId === "UBO-R08").resolutionState,
    "RESOLVED",
  );
  const satisfiedResult = applyConfirmation(satisfied, "wave11a-confirmation-r08-satisfied");
  assert.equal(satisfiedResult.customerActionResult.customerConfirmation.confirmationDoesNotReplaceIndependentEvidence, true);
  assert.equal(satisfiedResult.customerActionResult.customerConfirmation.independentEvidenceRequirementState, "SATISFIED");

  const notApplicablePolicy = testOnlyPolicy(requirement.requirementId, [strategy]);
  notApplicablePolicy.requirements
    .find(({ requirementId }) => requirementId === "UBO-R08")
    .applicability.condition = "case.entity_profile == 'LLP'";
  const notApplicable = evaluateCustomerPlan(session, notApplicablePolicy);
  assert.equal(
    notApplicable.decisionSnapshot.decisionContent.requirementResolutions
      .find(({ requirementId }) => requirementId === "UBO-R08").resolutionState,
    "N_A",
  );
  const notApplicableResult = applyConfirmation(notApplicable, "wave11a-confirmation-r08-na");
  assert.equal(notApplicableResult.customerActionResult.customerConfirmation.confirmationDoesNotReplaceIndependentEvidence, true);
  assert.equal(notApplicableResult.customerActionResult.customerConfirmation.independentEvidenceRequirementState, "NOT_APPLICABLE");

  const tamperedSnapshot = structuredClone(open.decisionSnapshot);
  tamperedSnapshot.decisionContent.requirementResolutions
    .find(({ requirementId }) => requirementId === "UBO-R08").resolutionState = "RESOLVED";
  assert.throws(() => open.app.applyCustomerInput({
    contractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V3,
    caseState: open.caseState,
    sourceDecisionSnapshot: tamperedSnapshot,
    sourceResolutionPlan: open.resolutionPlan,
    customerAction: actionFor(
      {
        snapshot: open.decisionSnapshot,
        plan: open.resolutionPlan,
        journeyProjection: open.journeyProjection,
      },
      open.journeyProjection.customerWorkBundles.find((item) =>
        item.permittedSemanticActions.some(({ actionType }) =>
          actionType === CUSTOMER_ACTION_TYPE_V2.CONFIRM_ESTABLISHED_INFORMATION)),
      CUSTOMER_ACTION_TYPE_V2.CONFIRM_ESTABLISHED_INFORMATION,
      {
        confirmation: "CONFIRMED",
        establishedRelationshipIds: open.journeyProjection.customerWorkBundles
          .flatMap(({ knownInformation }) => knownInformation.relationships)
          .map(({ relationshipId }) => relationshipId),
        establishedClaimIds: open.journeyProjection.customerWorkBundles
          .flatMap(({ knownInformation }) => knownInformation.relationships)
          .flatMap(({ supportingClaimIds }) => supportingClaimIds),
      },
    ),
    operationId: "wave11a-confirmation-r08-tampered",
  }), /verification|consistently|snapshot/i);
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
