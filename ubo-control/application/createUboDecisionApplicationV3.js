"use strict";

const {
  CASE_STATE_INTERNALS,
  DECISION_APPLICATION_CONTRACT_VERSION_V2,
} = require("./createUboDecisionApplication");
const {
  UBO_REVIEW_APPLICATION_CONTRACT_VERSION,
  createUboReviewApplication,
} = require("./createUboReviewApplication");
const {
  CUSTOMER_ACTION_RESULT_V2,
  CUSTOMER_ACTION_V2,
  applyCustomerInputV2,
} = require("./applyCustomerInputV2");
const {
  DECISION_APPLICATION_ERROR_CODE,
  DecisionApplicationError,
} = require("../errors");
const {
  assertAllowedKeys,
  assertArray,
  assertDataOnly,
  assertPlainObject,
  cloneData,
  deepFreeze,
} = require("../internal/validation");
const { loadPolicyPack } = require("../policy/policyPack");
const { validateResolutionPlanV2 } = require("../planning/resolutionPlanV2");
const { projectUboJourneyV2 } = require("../projection/uboJourneyProjectionV2");
const { applyTemporalSupportReviews } = require("./applyTemporalSupportReview");
const { TEMPORAL_SUPPORT_REVIEW_RESULT_V1 } = require("../contracts/temporalSupportReview");

const DECISION_APPLICATION_CONTRACT_VERSION_V3 = "ubo-decision-application-v3";

function applicationError(code, message, cause) {
  return new DecisionApplicationError(message, { code, cause });
}

function run(code, action) {
  try {
    return action();
  } catch (error) {
    if (error instanceof DecisionApplicationError) throw error;
    throw applicationError(code, error.message, error);
  }
}

function requireContract(request, path) {
  assertPlainObject(request, path);
  if (request.contractVersion !== DECISION_APPLICATION_CONTRACT_VERSION_V3) {
    throw applicationError(
      DECISION_APPLICATION_ERROR_CODE.UNSUPPORTED_CONTRACT_VERSION,
      `contractVersion must be ${DECISION_APPLICATION_CONTRACT_VERSION_V3}`,
    );
  }
}

function toV2State(v3State) {
  const raw = CASE_STATE_INTERNALS.decodeCaseState(v3State, DECISION_APPLICATION_CONTRACT_VERSION_V3);
  return CASE_STATE_INTERNALS.encodeCaseState(raw, DECISION_APPLICATION_CONTRACT_VERSION_V2);
}

function fromV2State(v2State) {
  const raw = CASE_STATE_INTERNALS.decodeCaseState(v2State, DECISION_APPLICATION_CONTRACT_VERSION_V2);
  return {
    raw,
    envelope: CASE_STATE_INTERNALS.encodeCaseState(raw, DECISION_APPLICATION_CONTRACT_VERSION_V3),
  };
}

function applicationState(raw, envelope, extra = {}) {
  return deepFreeze(cloneData({
    contractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V3,
    stateContractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V3,
    caseState: envelope,
    decisionTargets: CASE_STATE_INTERNALS.decisionTargetsFor(raw),
    successorApplicationState: {
      caseReference: cloneData(envelope.caseReference),
      sealed: true,
      candidateDecisionPending: CASE_STATE_INTERNALS.decisionTargetsFor(raw).candidateParties.length > 0
        || CASE_STATE_INTERNALS.decisionTargetsFor(raw).candidateClaims.length > 0,
      hiddenEvaluationPerformed: false,
      productionAuthorized: false,
    },
    ...extra,
  }));
}

function createUboDecisionApplicationV3({ policyPack } = {}) {
  const loaded = run(DECISION_APPLICATION_ERROR_CODE.POLICY_CONFIGURATION_ERROR, () => loadPolicyPack(policyPack));
  if (loaded.identity.schemaVersion !== "1.3" || loaded.policyPack.status !== "CONTROL_ROOM_REVIEW") {
    throw applicationError(
      DECISION_APPLICATION_ERROR_CODE.POLICY_CONFIGURATION_ERROR,
      "Decision Application v3 requires a schema-1.3 CONTROL_ROOM_REVIEW Policy Pack",
    );
  }
  const review = run(DECISION_APPLICATION_ERROR_CODE.POLICY_CONFIGURATION_ERROR,
    () => createUboReviewApplication({ policyPack }));

  function intake(request) {
    return run(DECISION_APPLICATION_ERROR_CODE.INVALID_CAPABILITY_RESULT, () => {
      requireContract(request, "intakeRequestV3");
      assertAllowedKeys(request, [
        "contractVersion", "caseInput", "caseState", "capabilityResult", "operationId", "recordedAt",
      ], "intakeRequestV3");
      const result = review.intake({
        contractVersion: UBO_REVIEW_APPLICATION_CONTRACT_VERSION,
        ...(request.caseInput === undefined ? {} : { caseInput: request.caseInput }),
        ...(request.caseState === undefined ? {} : { caseState: toV2State(request.caseState) }),
        capabilityResult: request.capabilityResult,
        operationId: request.operationId,
        recordedAt: request.recordedAt,
      });
      const converted = fromV2State(result.caseState);
      return applicationState(converted.raw, converted.envelope);
    });
  }

  function applyDecisions(request) {
    return run(DECISION_APPLICATION_ERROR_CODE.INVALID_EXPLICIT_DECISION, () => {
      requireContract(request, "applyDecisionsRequestV3");
      assertAllowedKeys(request, [
        "contractVersion", "caseState", "entityRegistrations", "identityDecisions", "claimAdjudications",
        "sourceDecisionSnapshot", "temporalSupportReviews",
      ], "applyDecisionsRequestV3");
      assertArray(request.entityRegistrations, "applyDecisionsRequestV3.entityRegistrations");
      assertArray(request.identityDecisions, "applyDecisionsRequestV3.identityDecisions");
      assertArray(request.claimAdjudications, "applyDecisionsRequestV3.claimAdjudications");
      const temporalSupportReviews = request.temporalSupportReviews || [];
      assertArray(temporalSupportReviews, "applyDecisionsRequestV3.temporalSupportReviews");
      if (temporalSupportReviews.length > 0
        && (request.entityRegistrations.length > 0 || request.identityDecisions.length > 0 || request.claimAdjudications.length > 0)) {
        throw applicationError(
          DECISION_APPLICATION_ERROR_CODE.INVALID_EXPLICIT_DECISION,
          "temporal support review must be a separate explicit applyDecisions operation",
        );
      }
      if ((temporalSupportReviews.length > 0) !== (request.sourceDecisionSnapshot !== undefined)) {
        throw applicationError(
          DECISION_APPLICATION_ERROR_CODE.INVALID_EXPLICIT_DECISION,
          "sourceDecisionSnapshot is required only with temporalSupportReviews",
        );
      }
      const result = review.applyDecisions({
        contractVersion: UBO_REVIEW_APPLICATION_CONTRACT_VERSION,
        caseState: toV2State(request.caseState),
        entityRegistrations: request.entityRegistrations,
        identityDecisions: request.identityDecisions,
        claimAdjudications: request.claimAdjudications,
      });
      const converted = fromV2State(result.caseState);
      if (temporalSupportReviews.length === 0) return applicationState(converted.raw, converted.envelope);
      const next = applyTemporalSupportReviews({
        caseState: converted.raw,
        caseStateEnvelope: converted.envelope,
        sourceDecisionSnapshot: request.sourceDecisionSnapshot,
        reviews: temporalSupportReviews,
        loadedPolicyPack: loaded,
      });
      const envelope = CASE_STATE_INTERNALS.encodeCaseState(next, DECISION_APPLICATION_CONTRACT_VERSION_V3);
      return applicationState(next, envelope, {
        temporalSupportReviewResult: {
          contractVersion: TEMPORAL_SUPPORT_REVIEW_RESULT_V1,
          appliedReviewIds: temporalSupportReviews.map(({ reviewId }) => reviewId),
          sourceSnapshotReference: {
            snapshotSchemaVersion: request.sourceDecisionSnapshot.snapshotSchemaVersion,
            snapshotId: request.sourceDecisionSnapshot.snapshotId,
            decisionContentHash: request.sourceDecisionSnapshot.decisionContentHash,
          },
          newSealedCaseState: envelope,
        },
      });
    });
  }

  function applyCustomerInput(request) {
    return run(DECISION_APPLICATION_ERROR_CODE.INVALID_CUSTOMER_ACTION, () => {
      requireContract(request, "applyCustomerInputRequestV3");
      assertAllowedKeys(request, [
        "contractVersion", "caseState", "sourceDecisionSnapshot", "sourceResolutionPlan",
        "customerAction", "operationId",
      ], "applyCustomerInputRequestV3");
      if (request.customerAction?.contractVersion !== CUSTOMER_ACTION_V2) {
        throw applicationError(DECISION_APPLICATION_ERROR_CODE.INVALID_CUSTOMER_ACTION,
          `customerAction.contractVersion must be ${CUSTOMER_ACTION_V2}`);
      }
      const current = CASE_STATE_INTERNALS.decodeCaseState(
        request.caseState,
        DECISION_APPLICATION_CONTRACT_VERSION_V3,
      );
      const transition = applyCustomerInputV2({
        caseState: current,
        loadedPolicyPack: loaded,
        sourceDecisionSnapshot: request.sourceDecisionSnapshot,
        sourceResolutionPlan: request.sourceResolutionPlan,
        customerAction: request.customerAction,
        operationId: request.operationId,
      });
      const envelope = CASE_STATE_INTERNALS.encodeCaseState(
        transition.caseState,
        DECISION_APPLICATION_CONTRACT_VERSION_V3,
      );
      const customerActionResult = deepFreeze(cloneData({
        ...transition.result,
        contractVersion: CUSTOMER_ACTION_RESULT_V2,
        newSealedCaseState: envelope,
      }));
      return applicationState(transition.caseState, envelope, { customerActionResult });
    });
  }

  function evaluate(request) {
    return run(DECISION_APPLICATION_ERROR_CODE.EVALUATION_PRECONDITION_FAILED, () => {
      requireContract(request, "evaluateRequestV3");
      assertAllowedKeys(request, [
        "contractVersion", "runtimeMode", "caseState", "caseContext", "evaluationTime", "checkpoint",
        "checkpointReference", "resolutionInputs", "decisionHistory", "expectedHeadSnapshotId",
        "supersessionReason", "assessmentDate",
      ], "evaluateRequestV3");
      if (request.runtimeMode !== "LAB") {
        throw applicationError(
          DECISION_APPLICATION_ERROR_CODE.EVALUATION_PRECONDITION_FAILED,
          "Decision Application v3 is review-only and requires explicit LAB runtime mode",
        );
      }
      assertDataOnly(request.resolutionInputs || {}, "evaluateRequestV3.resolutionInputs");
      const result = review.evaluate({
        contractVersion: UBO_REVIEW_APPLICATION_CONTRACT_VERSION,
        runtimeMode: "LAB",
        caseState: toV2State(request.caseState),
        caseContext: request.caseContext,
        evaluationTime: request.evaluationTime,
        checkpoint: request.checkpoint,
        checkpointReference: request.checkpointReference,
        resolutionInputs: request.resolutionInputs || {},
        ...(request.decisionHistory === undefined ? {} : { decisionHistory: request.decisionHistory }),
        ...(request.expectedHeadSnapshotId === undefined ? {} : { expectedHeadSnapshotId: request.expectedHeadSnapshotId }),
        ...(request.supersessionReason === undefined ? {} : { supersessionReason: request.supersessionReason }),
        ...(request.assessmentDate === undefined ? {} : { assessmentDate: request.assessmentDate }),
      });
      validateResolutionPlanV2(result.resolutionPlan);
      if (result.resolutionPlan.planId !== result.decisionSnapshot.decisionContent.pinnedResolutionPlan.planId
        || result.resolutionPlan.planHash !== result.decisionSnapshot.decisionContent.pinnedResolutionPlan.planHash) {
        throw applicationError(DECISION_APPLICATION_ERROR_CODE.STALE_OR_INCONSISTENT_STATE,
          "evaluate returned a plan other than the exact ResolutionPlan v2 pinned in DecisionSnapshot v2");
      }
      const raw = CASE_STATE_INTERNALS.decodeCaseState(request.caseState, DECISION_APPLICATION_CONTRACT_VERSION_V3);
      const journeyProjection = projectUboJourneyV2({
        decisionSnapshot: result.decisionSnapshot,
        policyPack: loaded.policyPack,
      });
      return applicationState(raw, request.caseState, {
        decisionSnapshot: result.decisionSnapshot,
        decisionHistory: result.decisionHistory,
        resolutionPlan: result.resolutionPlan,
        journeyProjection,
        ownershipGraphProjection: result.ownershipGraphProjection,
        policyReadiness: result.policyReadiness,
        governance: result.governance,
        successorEvaluationState: {
          snapshotSchemaVersion: result.decisionSnapshot.snapshotSchemaVersion,
          resolutionPlanContractVersion: result.resolutionPlan.contractVersion,
          exactPinnedPlanReturned: true,
          hiddenPostSnapshotPlanCreated: false,
          customerInputComplete: journeyProjection.customerInputComplete,
          finalCaseComplete: journeyProjection.finalCaseComplete,
          productionAuthorized: false,
        },
      });
    });
  }

  return deepFreeze({ intake, applyDecisions, applyCustomerInput, evaluate });
}

module.exports = {
  DECISION_APPLICATION_CONTRACT_VERSION_V3,
  createUboDecisionApplicationV3,
};
