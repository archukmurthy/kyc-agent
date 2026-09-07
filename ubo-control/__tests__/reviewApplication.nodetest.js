"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const reviewApi = require("../review");
const policy = require("../policies/uk-corporate/1.6-rc/policy.json");
const baselinePolicy = require("../policies/uk-corporate/1.5-rc/policy.json");
const { createAsdaFurtherCoverageProfile } = require("../test-support/asdaRegistryCapabilityProfilesV1");

const NOW = "2026-09-06T10:00:00.000Z";
const CONTRACT = reviewApi.UBO_REVIEW_APPLICATION_CONTRACT_VERSION;

function party(entityId, name, entityType) {
  return { entityId, name, entityType, jurisdiction: "GB", externalIdentifiers: [] };
}

function resolvedApplication() {
  const app = reviewApi.createUboReviewApplication({ policyPack: policy });
  const subject = party("review-target", "Review Target Ltd", "COMPANY");
  const person = party("review-person", "Review Person", "NATURAL_PERSON");
  const intake = app.intake({
    contractVersion: CONTRACT,
    caseInput: {
      caseId: "review-application-case",
      subjectReference: subject,
      externalReferences: [],
      createdAt: NOW,
    },
    capabilityResult: {
      contractVersion: "1.0.0",
      requestId: "review-request",
      outcome: { state: "COMPLETE" },
      candidateFacts: [{
        factId: "review-direct-owner",
        type: "RELATIONSHIP",
        subject: person,
        relationship: "ECONOMIC_OWNERSHIP",
        object: subject,
        measurement: { type: "EXACT", value: 40 },
        qualifiers: { currentState: "CURRENT", economicInterestConcept: "SHARE_OWNERSHIP" },
        evidenceReferences: [],
      }],
      operationEvidenceReferences: [],
      issues: [],
    },
    operationId: "review-intake",
    recordedAt: NOW,
  });
  const registrations = [
    {
      entityId: subject.entityId,
      category: "LEGAL_ENTITY",
      primaryName: subject.name,
      aliases: [],
      externalIdentifiers: [],
      jurisdiction: "GB",
      entityTypeMetadata: { entityProfile: "COMPANY" },
      recordedAt: NOW,
    },
    {
      entityId: person.entityId,
      category: "NATURAL_PERSON",
      primaryName: person.name,
      aliases: [],
      externalIdentifiers: [],
      jurisdiction: "GB",
      entityTypeMetadata: {},
      recordedAt: NOW,
    },
  ];
  const decisions = app.applyDecisions({
    contractVersion: CONTRACT,
    caseState: intake.caseState,
    entityRegistrations: registrations,
    identityDecisions: intake.decisionTargets.candidateParties.map((target, index) => ({
      decisionId: `review-identity-${index + 1}`,
      candidatePartyKey: target.candidatePartyKey,
      status: "RESOLVED",
      entityId: target.party.entityId,
      basisReasonCodes: ["EXPLICIT_REVIEW_FIXTURE"],
      evidenceReferences: [],
      decidedAt: NOW,
      decisionOrigin: "REVIEW_TEST",
    })),
    claimAdjudications: intake.decisionTargets.candidateClaims.map((target, index) => ({
      decisionId: `review-claim-${index + 1}`,
      claimId: target.claimId,
      previousState: target.currentState,
      resultingState: "OPERATIVE",
      reasonBasisCode: "EXPLICIT_REVIEW_FIXTURE",
      supportingEvidenceReferences: [],
      decisionOrigin: "REVIEW_TEST",
      decidedAt: NOW,
      supersededByClaimIds: [],
      adversarialClaimIds: [],
    })),
  });
  return { app, intake, decisions };
}

function evaluate(app, decisions, overrides = {}) {
  return app.evaluate({
    contractVersion: CONTRACT,
    runtimeMode: "LAB",
    caseState: decisions.caseState,
    caseContext: {
      entityType: "private_limited_company",
      subjectEntityId: "review-target",
      jurisdiction: "GB",
      riskLevel: "MEDIUM",
    },
    evaluationTime: NOW,
    checkpoint: "CASE_EVENT",
    checkpointReference: { referenceId: "review-evaluation" },
    ...overrides,
  });
}

test("review entry exposes the exact deliberate surface and the stable main entry remains unchanged", () => {
  assert.deepEqual(Object.keys(reviewApi).sort(), [
    "OWNERSHIP_GRAPH_PROJECTION_V2",
    "UK_CORPORATE_REVIEW_POLICY_1_6_RC",
    "UBO_REVIEW_APPLICATION_CONTRACT_VERSION",
    "UBO_REVIEW_ERROR_CODE",
    "UboReviewError",
    "createUboReviewApplication",
    "projectOwnershipGraphV2",
  ].sort());
  assert.equal(reviewApi.UK_CORPORATE_REVIEW_POLICY_1_6_RC.version, "1.6-RC");
  assert.equal(Object.prototype.hasOwnProperty.call(require(".."), "createUboReviewApplication"), false);
});

test("review application exposes exactly intake, explicit decisions and successor evaluate", () => {
  const { app, intake, decisions } = resolvedApplication();
  assert.deepEqual(Object.keys(app).sort(), ["applyDecisions", "evaluate", "intake"]);
  assert.equal(app.applyCustomerInput, undefined);
  assert.equal(intake.contractVersion, CONTRACT);
  assert.equal(intake.stateContractVersion, "ubo-decision-application-v2");
  assert.equal(decisions.decisionTargets.candidateParties.length, 0);
  assert.equal(decisions.decisionTargets.candidateClaims.length, 0);

  const result = evaluate(app, decisions);
  assert.equal(result.contractVersion, CONTRACT);
  assert.equal(result.decisionSnapshot.snapshotSchemaVersion, "ubo-decision-snapshot-v2");
  assert.equal(result.decisionSnapshot.decisionContent.pipelineMaturity, "SUCCESSOR_PLANNER_COMPLETE_REVIEW_ONLY");
  assert.deepEqual(result.resolutionPlan, result.decisionSnapshot.decisionContent.pinnedResolutionPlan);
  assert.equal(result.ownershipGraphProjection.contractVersion, "ubo-ownership-graph-projection-v2");
  assert.equal(result.policyReadiness.readiness, "REVIEW_ONLY");
  assert.deepEqual(result.governance, {
    runtimeMode: "LAB",
    readiness: "REVIEW_ONLY",
    productionAuthorized: false,
    pipelineMaturity: "SUCCESSOR_PLANNER_COMPLETE_REVIEW_ONLY",
    blockingSignoffCount: result.policyReadiness.unresolvedSignoffs.length,
    watermark: "REVIEW POLICY — NOT APPROVED FOR PRODUCTION",
  });
  assert.equal(result.decisionHistory.snapshots.length, 1);
  assert.equal(Object.isFrozen(result), true);
  assert.deepEqual(evaluate(app, decisions), result);
});

test("review application fails closed for production, invalid policy, unresolved targets and invalid profiles", () => {
  assert.throws(
    () => reviewApi.createUboReviewApplication({ policyPack: baselinePolicy }),
    (error) => error instanceof reviewApi.UboReviewError && error.code === "INVALID_REVIEW_POLICY",
  );
  const { app, intake, decisions } = resolvedApplication();
  assert.throws(
    () => evaluate(app, decisions, { runtimeMode: "PRODUCTION" }),
    (error) => error instanceof reviewApi.UboReviewError && error.code === "PRODUCTION_NOT_AUTHORIZED",
  );
  assert.throws(
    () => app.evaluate({
      contractVersion: CONTRACT,
      runtimeMode: "LAB",
      caseState: intake.caseState,
      caseContext: { entityType: "private_limited_company", subjectEntityId: "review-target", jurisdiction: "GB" },
      evaluationTime: NOW,
      checkpoint: "CASE_EVENT",
      checkpointReference: { referenceId: "unresolved" },
    }),
    (error) => error instanceof reviewApi.UboReviewError && error.code === "UNRESOLVED_MANDATORY_DECISION_TARGET",
  );
  assert.throws(
    () => evaluate(app, decisions, { resolutionInputs: { registryCapabilityProfile: { contractVersion: "broken" } } }),
    (error) => error instanceof reviewApi.UboReviewError && error.code === "INVALID_REGISTRY_CAPABILITY_PROFILE",
  );
});

test("review application records a profile-driven linked snapshot without rewriting the predecessor", () => {
  const { app, decisions } = resolvedApplication();
  const first = evaluate(app, decisions);
  const firstBefore = structuredClone(first.decisionSnapshot);
  const second = evaluate(app, decisions, {
    evaluationTime: "2026-09-06T10:01:00.000Z",
    checkpointReference: { referenceId: "profile-change" },
    decisionHistory: first.decisionHistory,
    expectedHeadSnapshotId: first.decisionSnapshot.snapshotId,
    supersessionReason: "PLANNING_CONTEXT_CHANGED",
    resolutionInputs: { registryCapabilityProfile: createAsdaFurtherCoverageProfile() },
  });
  assert.equal(second.decisionHistory.snapshots.length, 2);
  assert.equal(second.decisionSnapshot.decisionContent.history.supersessionReason, "PLANNING_CONTEXT_CHANGED");
  assert.equal(second.decisionSnapshot.decisionContent.history.previousSnapshot.snapshotId, first.decisionSnapshot.snapshotId);
  assert.notEqual(second.decisionSnapshot.snapshotId, first.decisionSnapshot.snapshotId);
  assert.notEqual(second.resolutionPlan.planHash, first.resolutionPlan.planHash);
  assert.deepEqual(first.decisionSnapshot, firstBefore);
});
