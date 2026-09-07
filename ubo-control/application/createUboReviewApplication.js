"use strict";

const {
  DECISION_APPLICATION_CONTRACT_VERSION_V2,
  createUboDecisionApplication,
} = require("./createUboDecisionApplication");
const { evaluateUboDecisionV3Review } = require("./evaluateUboDecisionV3Review");
const {
  appendDecisionSnapshotV2,
  createDecisionHistoryV2,
  verifyDecisionHistoryV2,
} = require("../domain/decisionHistoryV2");
const { cloneData, deepFreeze } = require("../internal/validation");
const { loadPolicyPack } = require("../policy/policyPack");
const { projectOwnershipGraphV2 } = require("../projection/ownershipGraphProjectionV2");

const UBO_REVIEW_APPLICATION_CONTRACT_VERSION = "ubo-review-application-v1";
const UBO_REVIEW_ERROR_CODE = Object.freeze({
  UNSUPPORTED_CONTRACT_VERSION: "UNSUPPORTED_CONTRACT_VERSION",
  INVALID_REVIEW_POLICY: "INVALID_REVIEW_POLICY",
  INVALID_CAPABILITY_RESULT: "INVALID_CAPABILITY_RESULT",
  INVALID_CASE_STATE: "INVALID_CASE_STATE",
  INVALID_EXPLICIT_DECISION: "INVALID_EXPLICIT_DECISION",
  UNRESOLVED_MANDATORY_DECISION_TARGET: "UNRESOLVED_MANDATORY_DECISION_TARGET",
  REVIEW_RUNTIME_MODE_REQUIRED: "REVIEW_RUNTIME_MODE_REQUIRED",
  PRODUCTION_NOT_AUTHORIZED: "PRODUCTION_NOT_AUTHORIZED",
  INVALID_REGISTRY_CAPABILITY_PROFILE: "INVALID_REGISTRY_CAPABILITY_PROFILE",
  STALE_DECISION_HISTORY: "STALE_DECISION_HISTORY",
  EVALUATION_PRECONDITION_FAILED: "EVALUATION_PRECONDITION_FAILED",
});

class UboReviewError extends Error {
  constructor(message, { code, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "UboReviewError";
    this.code = code;
  }
}

function reviewError(code, message, cause) {
  return new UboReviewError(message, { code, cause });
}

function requireReviewContract(request) {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw reviewError(UBO_REVIEW_ERROR_CODE.INVALID_CASE_STATE, "review request must be an object");
  }
  if (request.contractVersion !== UBO_REVIEW_APPLICATION_CONTRACT_VERSION) {
    throw reviewError(
      UBO_REVIEW_ERROR_CODE.UNSUPPORTED_CONTRACT_VERSION,
      `contractVersion must be ${UBO_REVIEW_APPLICATION_CONTRACT_VERSION}`,
    );
  }
}

function mapApplicationResult(result) {
  return deepFreeze(cloneData({
    contractVersion: UBO_REVIEW_APPLICATION_CONTRACT_VERSION,
    stateContractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V2,
    caseState: result.caseState,
    decisionTargets: result.decisionTargets,
  }));
}

function classifyError(error, fallbackCode) {
  if (error instanceof UboReviewError) return error;
  if (error?.code === "UNRESOLVED_MANDATORY_DECISION_TARGET") {
    return reviewError(UBO_REVIEW_ERROR_CODE.UNRESOLVED_MANDATORY_DECISION_TARGET, error.message, error);
  }
  if (error?.code === "STALE_DECISION_HISTORY_HEAD" || /stale DecisionHistory/i.test(error?.message || "")) {
    return reviewError(UBO_REVIEW_ERROR_CODE.STALE_DECISION_HISTORY, error.message, error);
  }
  if (/registryCapabilityProfile|capabilityEntries|entitlementContext/i.test(error?.message || "")) {
    return reviewError(UBO_REVIEW_ERROR_CODE.INVALID_REGISTRY_CAPABILITY_PROFILE, error.message, error);
  }
  return reviewError(fallbackCode, error?.message || "review operation failed", error);
}

function run(code, action) {
  try {
    return action();
  } catch (error) {
    throw classifyError(error, code);
  }
}

function decodeValidatedState(baseApplication, caseState) {
  const validated = baseApplication.applyDecisions({
    contractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V2,
    caseState,
    entityRegistrations: [],
    identityDecisions: [],
    claimAdjudications: [],
  });
  const json = Buffer.from(validated.caseState.statePayload, "base64url").toString("utf8");
  return { caseState: deepFreeze(JSON.parse(json)), envelope: validated };
}

function createUboReviewApplication({ policyPack } = {}) {
  const loaded = run(UBO_REVIEW_ERROR_CODE.INVALID_REVIEW_POLICY, () => loadPolicyPack(policyPack));
  if (loaded.identity.schemaVersion !== "1.3" || loaded.policyPack.status !== "CONTROL_ROOM_REVIEW") {
    throw reviewError(
      UBO_REVIEW_ERROR_CODE.INVALID_REVIEW_POLICY,
      "review application requires a schema-1.3 CONTROL_ROOM_REVIEW Policy Pack",
    );
  }
  const baseApplication = run(UBO_REVIEW_ERROR_CODE.INVALID_REVIEW_POLICY, () => createUboDecisionApplication({
    policyPack,
    contractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V2,
  }));

  function intake(request) {
    return run(UBO_REVIEW_ERROR_CODE.INVALID_CAPABILITY_RESULT, () => {
      requireReviewContract(request);
      const result = baseApplication.intake({
        contractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V2,
        ...(request.caseInput !== undefined ? { caseInput: request.caseInput } : {}),
        ...(request.caseState !== undefined ? { caseState: request.caseState } : {}),
        capabilityResult: request.capabilityResult,
        operationId: request.operationId,
        recordedAt: request.recordedAt,
      });
      return mapApplicationResult(result);
    });
  }

  function applyDecisions(request) {
    return run(UBO_REVIEW_ERROR_CODE.INVALID_EXPLICIT_DECISION, () => {
      requireReviewContract(request);
      const result = baseApplication.applyDecisions({
        contractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V2,
        caseState: request.caseState,
        entityRegistrations: request.entityRegistrations,
        identityDecisions: request.identityDecisions,
        claimAdjudications: request.claimAdjudications,
      });
      return mapApplicationResult(result);
    });
  }

  function evaluate(request) {
    return run(UBO_REVIEW_ERROR_CODE.EVALUATION_PRECONDITION_FAILED, () => {
      requireReviewContract(request);
      if (request.runtimeMode === "PRODUCTION") {
        throw reviewError(
          UBO_REVIEW_ERROR_CODE.PRODUCTION_NOT_AUTHORIZED,
          "successor review evaluation is not approved for production",
        );
      }
      if (request.runtimeMode !== "LAB") {
        throw reviewError(
          UBO_REVIEW_ERROR_CODE.REVIEW_RUNTIME_MODE_REQUIRED,
          "successor review evaluation requires explicit LAB runtime mode",
        );
      }
      const validated = decodeValidatedState(baseApplication, request.caseState);
      if (validated.envelope.decisionTargets.candidateParties.length
        || validated.envelope.decisionTargets.candidateClaims.length) {
        throw reviewError(
          UBO_REVIEW_ERROR_CODE.UNRESOLVED_MANDATORY_DECISION_TARGET,
          "all candidate-party and candidate-claim decisions must be explicit before review evaluation",
        );
      }
      const history = request.decisionHistory === undefined
        ? createDecisionHistoryV2(validated.caseState.caseId)
        : request.decisionHistory;
      verifyDecisionHistoryV2(history);
      const predecessorSnapshot = history.snapshots.at(-1) || null;
      const resolutionInputs = request.resolutionInputs || {};
      const optional = (key) => resolutionInputs[key] === undefined ? {} : { [key]: resolutionInputs[key] };
      const result = evaluateUboDecisionV3Review({
        policyPack,
        runtimeMode: "LAB",
        caseState: validated.caseState,
        caseContext: request.caseContext,
        evaluationTime: request.evaluationTime,
        checkpoint: request.checkpoint,
        checkpointReference: request.checkpointReference,
        predecessorSnapshot,
        supersessionReason: predecessorSnapshot ? request.supersessionReason : null,
        ...optional("facts"),
        ...optional("answers"),
        ...optional("evidenceClassifications"),
        ...optional("percentageEvidenceInputs"),
        ...optional("relevantConflicts"),
        ...optional("operationContexts"),
        ...optional("priorInformationNeedRecords"),
        ...optional("resolutionAttempts"),
        ...optional("resolutionOptions"),
        ...optional("registryCapabilityProfile"),
        ...(predecessorSnapshot ? { predecessorResolutionPlan: predecessorSnapshot.decisionContent.pinnedResolutionPlan } : {}),
        ...optional("existingSystemResolutionContext"),
        ...optional("recordingMetadata"),
      });
      const decisionHistory = appendDecisionSnapshotV2(history, result.snapshot, {
        expectedHeadSnapshotId: request.expectedHeadSnapshotId === undefined
          ? predecessorSnapshot?.snapshotId || null
          : request.expectedHeadSnapshotId,
      });
      const projection = projectOwnershipGraphV2({ decisionSnapshot: result.snapshot });
      return deepFreeze(cloneData({
        contractVersion: UBO_REVIEW_APPLICATION_CONTRACT_VERSION,
        stateContractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V2,
        caseState: request.caseState,
        decisionSnapshot: result.snapshot,
        decisionHistory,
        ownershipGraphProjection: projection,
        resolutionPlan: result.snapshot.decisionContent.pinnedResolutionPlan,
        policyReadiness: result.snapshot.decisionContent.policy.readiness,
        governance: {
          runtimeMode: "LAB",
          readiness: "REVIEW_ONLY",
          productionAuthorized: false,
          pipelineMaturity: result.snapshot.decisionContent.pipelineMaturity,
          blockingSignoffCount: result.snapshot.decisionContent.policy.readiness.unresolvedSignoffs.length,
          watermark: "REVIEW POLICY — NOT APPROVED FOR PRODUCTION",
        },
      }));
    });
  }

  return deepFreeze({ intake, applyDecisions, evaluate });
}

module.exports = {
  UBO_REVIEW_APPLICATION_CONTRACT_VERSION,
  UBO_REVIEW_ERROR_CODE,
  UboReviewError,
  createUboReviewApplication,
};
