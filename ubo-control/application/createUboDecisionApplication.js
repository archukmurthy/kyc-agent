"use strict";

const { createHash } = require("node:crypto");
const {
  CLAIM_STATE,
  IDENTITY_RESOLUTION_STATUS,
} = require("../contracts/constants");
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
const { canonicalizeJson } = require("../policy/canonicalJson");
const { loadPolicyPack } = require("../policy/policyPack");
const { GRAPH_DIMENSION, buildCanonicalOwnershipGraph } = require("../domain/ownershipGraph");
const {
  addCanonicalEntity,
  adjudicateClaim,
  createOwnershipCase,
  intakeCapabilityResult,
  recordIdentityResolutionDecision,
  validateOwnershipCase,
} = require("../domain/ownershipCase");
const { reResolveDecision } = require("./reResolveDecision");
const {
  applyCustomerInput: applyCustomerInputTransition,
  customerResolutionInputs,
} = require("./applyCustomerInput");

const DECISION_APPLICATION_CONTRACT_VERSION = "ubo-decision-application-v1";
const DECISION_APPLICATION_CONTRACT_VERSION_V2 = "ubo-decision-application-v2";
const CASE_STATE_TYPE = "DECISION_APPLICATION_CASE_STATE";
const CASE_STATE_ENCODING = "base64url-canonical-json-v1";
const TERMINAL_CLAIM_STATES = new Set([CLAIM_STATE.REJECTED, CLAIM_STATE.SUPERSEDED]);

function applicationError(code, message, cause) {
  return new DecisionApplicationError(message, { code, cause });
}

function requireContractVersion(value, expectedVersion) {
  if (value !== expectedVersion) {
    throw applicationError(
      DECISION_APPLICATION_ERROR_CODE.UNSUPPORTED_CONTRACT_VERSION,
      `contractVersion must be ${expectedVersion}`,
    );
  }
}

function runWithErrorCode(code, action) {
  try {
    return action();
  } catch (error) {
    if (error instanceof DecisionApplicationError) throw error;
    throw applicationError(code, error.message, error);
  }
}

function digestText(value) {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function encodeCaseState(ownershipCase, contractVersion) {
  validateOwnershipCase(ownershipCase);
  const canonical = canonicalizeJson(ownershipCase);
  const statePayload = Buffer.from(canonical, "utf8").toString("base64url");
  return deepFreeze({
    contractVersion,
    stateType: CASE_STATE_TYPE,
    stateEncoding: CASE_STATE_ENCODING,
    caseReference: {
      caseId: ownershipCase.caseId,
      revision: ownershipCase.revision,
      revisionId: ownershipCase.revisionId,
    },
    stateHash: digestText(canonical),
    statePayload,
  });
}

function decodeCaseState(caseState, contractVersion) {
  return runWithErrorCode(DECISION_APPLICATION_ERROR_CODE.INVALID_CASE_STATE, () => {
    assertPlainObject(caseState, "caseState");
    assertAllowedKeys(caseState, [
      "contractVersion",
      "stateType",
      "stateEncoding",
      "caseReference",
      "stateHash",
      "statePayload",
    ], "caseState");
    requireContractVersion(caseState.contractVersion, contractVersion);
    if (caseState.stateType !== CASE_STATE_TYPE || caseState.stateEncoding !== CASE_STATE_ENCODING) {
      throw applicationError(
        DECISION_APPLICATION_ERROR_CODE.INVALID_CASE_STATE,
        "caseState type or encoding is unsupported",
      );
    }
    assertPlainObject(caseState.caseReference, "caseState.caseReference");
    assertDataOnly(caseState, "caseState");
    if (typeof caseState.statePayload !== "string" || typeof caseState.stateHash !== "string") {
      throw applicationError(DECISION_APPLICATION_ERROR_CODE.INVALID_CASE_STATE, "caseState payload and hash are required");
    }
    let parsed;
    try {
      const payloadBytes = Buffer.from(caseState.statePayload, "base64url");
      if (payloadBytes.toString("base64url") !== caseState.statePayload) {
        throw applicationError(
          DECISION_APPLICATION_ERROR_CODE.STALE_OR_INCONSISTENT_STATE,
          "caseState payload encoding is not canonical",
        );
      }
      const canonical = payloadBytes.toString("utf8");
      parsed = JSON.parse(canonical);
      if (canonicalizeJson(parsed) !== canonical || digestText(canonical) !== caseState.stateHash) {
        throw applicationError(
          DECISION_APPLICATION_ERROR_CODE.STALE_OR_INCONSISTENT_STATE,
          "caseState integrity verification failed",
        );
      }
    } catch (error) {
      if (error instanceof DecisionApplicationError) throw error;
      throw applicationError(DECISION_APPLICATION_ERROR_CODE.INVALID_CASE_STATE, "caseState payload is malformed", error);
    }
    validateOwnershipCase(parsed);
    const expectedReference = {
      caseId: parsed.caseId,
      revision: parsed.revision,
      revisionId: parsed.revisionId,
    };
    if (canonicalizeJson(caseState.caseReference) !== canonicalizeJson(expectedReference)) {
      throw applicationError(
        DECISION_APPLICATION_ERROR_CODE.STALE_OR_INCONSISTENT_STATE,
        "caseState reference does not match its protected payload",
      );
    }
    return deepFreeze(parsed);
  });
}

function latestIdentityDecision(caseState, candidatePartyKey) {
  return [...caseState.identityDecisions]
    .reverse()
    .find((decision) => decision.candidatePartyKey === candidatePartyKey);
}

function decisionTargetsFor(caseState) {
  const candidateClaims = caseState.candidateClaims
    .filter((claim) => claim.status === CLAIM_STATE.CANDIDATE)
    .map((claim) => {
      const target = {
        targetType: "CANDIDATE_CLAIM",
        claimId: claim.claimId,
        claimType: claim.claimType,
        currentState: claim.status,
        originatingCandidateFact: cloneData(claim.originatingCandidateFact),
      };
      if (claim.relationship !== undefined) target.relationship = claim.relationship;
      return target;
    })
    .sort((left, right) => left.claimId.localeCompare(right.claimId));

  const parties = new Map();
  caseState.candidateClaims
    .filter((claim) => !TERMINAL_CLAIM_STATES.has(claim.status))
    .forEach((claim) => {
      [["SUBJECT", claim.subject], ["OBJECT", claim.object]].forEach(([endpoint, reference]) => {
        if (!reference || latestIdentityDecision(caseState, reference.candidatePartyKey)) return;
        parties.set(reference.candidatePartyKey, {
          targetType: "CANDIDATE_PARTY",
          candidatePartyKey: reference.candidatePartyKey,
          claimId: claim.claimId,
          endpoint,
          party: cloneData(reference.party),
        });
      });
    });
  const candidateParties = [...parties.values()]
    .sort((left, right) => left.candidatePartyKey.localeCompare(right.candidatePartyKey));
  return deepFreeze({ candidateParties, candidateClaims });
}

function applicationResult(caseState, contractVersion, customerInputResult) {
  return deepFreeze({
    contractVersion,
    caseState: encodeCaseState(caseState, contractVersion),
    decisionTargets: decisionTargetsFor(caseState),
    ...(customerInputResult === undefined ? {} : { customerInputResult }),
  });
}

function stripRecordedAt(registration) {
  assertPlainObject(registration, "entityRegistration");
  const { recordedAt, ...entityInput } = registration;
  if (recordedAt === undefined) throw new Error("entityRegistration.recordedAt is required");
  return { recordedAt, entityInput };
}

function planCalculations(loadedPolicyPack, caseState, caseContext) {
  const profile = loadedPolicyPack.policyPack.entityProfiles[caseContext.entityType];
  if (!profile) return [];
  const dimensions = [];
  if (profile.economicInterestConcept) dimensions.push(GRAPH_DIMENSION.ECONOMIC);
  if (profile.votingConcept) dimensions.push(GRAPH_DIMENSION.VOTING);
  const graph = buildCanonicalOwnershipGraph(caseState);
  return dimensions.flatMap((dimension) => {
    const incoming = new Map();
    graph.relationships
      .filter((relationship) => relationship.dimension === dimension && relationship.temporalState !== "CEASED")
      .forEach((relationship) => {
        if (!incoming.has(relationship.objectEntityId)) incoming.set(relationship.objectEntityId, new Set());
        incoming.get(relationship.objectEntityId).add(relationship.subjectEntityId);
      });
    const relevant = new Set();
    const pending = [caseContext.subjectEntityId];
    while (pending.length > 0) {
      const objectEntityId = pending.shift();
      for (const subjectEntityId of incoming.get(objectEntityId) || []) {
        if (relevant.has(subjectEntityId)) continue;
        relevant.add(subjectEntityId);
        pending.push(subjectEntityId);
      }
    }
    relevant.delete(caseContext.subjectEntityId);
    return [...relevant].sort().map((subjectEntityId) => ({
      subjectEntityId,
      targetEntityId: caseContext.subjectEntityId,
      dimension,
    }));
  });
}

function normalizeResolutionInputs(value) {
  const input = value === undefined ? {} : value;
  assertPlainObject(input, "resolutionInputs");
  assertAllowedKeys(input, [
    "evidenceClassifications",
    "facts",
    "answers",
    "relevantConflicts",
    "operationContexts",
    "priorInformationNeedRecords",
    "strategyAvailability",
    "resolutionAttempts",
    "priorReviewRequirements",
    "fallbackExhaustionDecisions",
    "seniorManagementCandidates",
    "seniorManagementCandidatesComplete",
    "smoApplication",
    "pscComparison",
    "residualCompletenessAttestation",
    "cddUnableToComplete",
    "unresolvableAssessment",
    "recordingMetadata",
  ], "resolutionInputs");
  assertDataOnly(input, "resolutionInputs");
  return cloneData(input);
}

function createUboDecisionApplication({ policyPack, contractVersion = DECISION_APPLICATION_CONTRACT_VERSION } = {}) {
  if (![DECISION_APPLICATION_CONTRACT_VERSION, DECISION_APPLICATION_CONTRACT_VERSION_V2].includes(contractVersion)) {
    throw applicationError(
      DECISION_APPLICATION_ERROR_CODE.UNSUPPORTED_CONTRACT_VERSION,
      `contractVersion must be ${DECISION_APPLICATION_CONTRACT_VERSION} or ${DECISION_APPLICATION_CONTRACT_VERSION_V2}`,
    );
  }
  const loadedPolicyPack = runWithErrorCode(
    DECISION_APPLICATION_ERROR_CODE.POLICY_CONFIGURATION_ERROR,
    () => loadPolicyPack(policyPack),
  );

  function intake(request) {
    return runWithErrorCode(DECISION_APPLICATION_ERROR_CODE.INVALID_CAPABILITY_RESULT, () => {
      assertPlainObject(request, "intakeRequest");
      assertAllowedKeys(request, [
        "contractVersion",
        "caseInput",
        "caseState",
        "capabilityResult",
        "operationId",
        "recordedAt",
      ], "intakeRequest");
      requireContractVersion(request.contractVersion, contractVersion);
      const hasInput = request.caseInput !== undefined;
      const hasState = request.caseState !== undefined;
      if (hasInput === hasState) {
        throw applicationError(
          DECISION_APPLICATION_ERROR_CODE.INVALID_CASE_INPUT,
          "intake requires exactly one of caseInput or caseState",
        );
      }
      const current = hasInput
        ? runWithErrorCode(DECISION_APPLICATION_ERROR_CODE.INVALID_CASE_INPUT, () => createOwnershipCase(request.caseInput))
        : decodeCaseState(request.caseState, contractVersion);
      return applicationResult(intakeCapabilityResult(current, request.capabilityResult, {
        operationId: request.operationId,
        recordedAt: request.recordedAt,
      }), contractVersion);
    });
  }

  function applyDecisions(request) {
    return runWithErrorCode(DECISION_APPLICATION_ERROR_CODE.INVALID_EXPLICIT_DECISION, () => {
      assertPlainObject(request, "applyDecisionsRequest");
      assertAllowedKeys(request, [
        "contractVersion",
        "caseState",
        "entityRegistrations",
        "identityDecisions",
        "claimAdjudications",
      ], "applyDecisionsRequest");
      requireContractVersion(request.contractVersion, contractVersion);
      assertArray(request.entityRegistrations, "applyDecisionsRequest.entityRegistrations");
      assertArray(request.identityDecisions, "applyDecisionsRequest.identityDecisions");
      assertArray(request.claimAdjudications, "applyDecisionsRequest.claimAdjudications");
      let current = decodeCaseState(request.caseState, contractVersion);
      request.entityRegistrations.forEach((registration) => {
        const { recordedAt, entityInput } = stripRecordedAt(registration);
        current = addCanonicalEntity(current, entityInput, { recordedAt });
      });
      request.identityDecisions.forEach((decision) => {
        if (decision && typeof decision.candidatePartyKey === "string"
          && !current.candidateClaims.some((claim) => claim.subject.candidatePartyKey === decision.candidatePartyKey
            || claim.object?.candidatePartyKey === decision.candidatePartyKey)) {
          throw applicationError(
            DECISION_APPLICATION_ERROR_CODE.INVALID_DECISION_TARGET,
            `identity decision references unknown candidate party ${decision.candidatePartyKey}`,
          );
        }
        if (decision && typeof decision.entityId === "string"
          && !current.canonicalEntities.some(({ entityId }) => entityId === decision.entityId)) {
          throw applicationError(
            DECISION_APPLICATION_ERROR_CODE.INVALID_DECISION_TARGET,
            `identity decision references unknown registered entity ${decision.entityId}`,
          );
        }
        current = recordIdentityResolutionDecision(current, decision);
      });
      request.claimAdjudications.forEach((decision) => {
        if (decision && typeof decision.claimId === "string"
          && !current.candidateClaims.some(({ claimId }) => claimId === decision.claimId)) {
          throw applicationError(
            DECISION_APPLICATION_ERROR_CODE.INVALID_DECISION_TARGET,
            `claim adjudication references unknown claim ${decision.claimId}`,
          );
        }
        current = adjudicateClaim(current, decision);
      });
      return applicationResult(current, contractVersion);
    });
  }

  function applyCustomerInput(request) {
    return runWithErrorCode(DECISION_APPLICATION_ERROR_CODE.INVALID_CUSTOMER_ACTION, () => {
      if (contractVersion !== DECISION_APPLICATION_CONTRACT_VERSION_V2) {
        throw applicationError(DECISION_APPLICATION_ERROR_CODE.UNSUPPORTED_CONTRACT_VERSION, "applyCustomerInput requires ubo-decision-application-v2");
      }
      assertPlainObject(request, "applyCustomerInputRequest");
      assertAllowedKeys(request, [
        "contractVersion", "caseState", "sourceDecisionSnapshot", "sourceResolutionPlan", "customerAction",
        "operationId", "recordedAt", "actorReference",
      ], "applyCustomerInputRequest");
      requireContractVersion(request.contractVersion, contractVersion);
      const current = decodeCaseState(request.caseState, contractVersion);
      const result = applyCustomerInputTransition({
        caseState: current,
        loadedPolicyPack,
        sourceDecisionSnapshot: request.sourceDecisionSnapshot,
        sourceResolutionPlan: request.sourceResolutionPlan,
        customerAction: request.customerAction,
        operationId: request.operationId,
        recordedAt: request.recordedAt,
        actorReference: request.actorReference,
      });
      return applicationResult(result.caseState, contractVersion, result.outcome);
    });
  }

  function evaluate(request) {
    return runWithErrorCode(DECISION_APPLICATION_ERROR_CODE.EVALUATION_PRECONDITION_FAILED, () => {
      assertPlainObject(request, "evaluateRequest");
      assertAllowedKeys(request, [
        "contractVersion",
        "caseState",
        "caseContext",
        "evaluationTime",
        "checkpoint",
        "checkpointReference",
        "resolutionInputs",
        ...(contractVersion === DECISION_APPLICATION_CONTRACT_VERSION_V2
          ? ["decisionHistory", "expectedHeadSnapshotId", "supersessionReason"] : []),
      ], "evaluateRequest");
      requireContractVersion(request.contractVersion, contractVersion);
      const current = decodeCaseState(request.caseState, contractVersion);
      const unresolved = decisionTargetsFor(current);
      if (unresolved.candidateParties.length > 0 || unresolved.candidateClaims.length > 0) {
        throw applicationError(
          DECISION_APPLICATION_ERROR_CODE.UNRESOLVED_MANDATORY_DECISION_TARGET,
          "all mandatory candidate-party and candidate-claim decisions must be explicit before evaluation",
        );
      }
      assertPlainObject(request.caseContext, "evaluateRequest.caseContext");
      const normalizedInputs = normalizeResolutionInputs(request.resolutionInputs);
      const resolutionInputs = contractVersion === DECISION_APPLICATION_CONTRACT_VERSION_V2
        ? customerResolutionInputs(current, normalizedInputs)
        : normalizedInputs;
      const calculationRequests = planCalculations(loadedPolicyPack, current, request.caseContext);
      let result;
      try {
        result = reResolveDecision({
          loadedPolicyPack,
          caseState: current,
          caseContext: request.caseContext,
          calculationRequests,
          evaluationTime: request.evaluationTime,
          checkpoint: request.checkpoint,
          checkpointReference: request.checkpointReference,
          ...(contractVersion === DECISION_APPLICATION_CONTRACT_VERSION_V2 ? {
            decisionHistory: request.decisionHistory,
            expectedHeadSnapshotId: request.expectedHeadSnapshotId,
            supersessionReason: request.supersessionReason,
          } : {}),
          ...resolutionInputs,
        });
      } catch (error) {
        if (error.code === "POLICY_CONFIGURATION_ERROR") {
          throw applicationError(DECISION_APPLICATION_ERROR_CODE.POLICY_CONFIGURATION_ERROR, error.message, error);
        }
        throw error;
      }
      return deepFreeze({
        contractVersion,
        decisionSnapshot: result.snapshot,
        ...(contractVersion === DECISION_APPLICATION_CONTRACT_VERSION_V2
          ? { decisionHistory: result.decisionHistory } : {}),
      });
    });
  }

  return contractVersion === DECISION_APPLICATION_CONTRACT_VERSION_V2
    ? deepFreeze({ intake, applyDecisions, applyCustomerInput, evaluate })
    : deepFreeze({ intake, applyDecisions, evaluate });
}

module.exports = {
  DECISION_APPLICATION_CONTRACT_VERSION,
  DECISION_APPLICATION_CONTRACT_VERSION_V2,
  createUboDecisionApplication,
};
