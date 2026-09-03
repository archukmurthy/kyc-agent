"use strict";

const {
  APPLICABILITY_MODEL_VERSION,
  CAPABILITY_CONTRACT_VERSION,
  CLAIM_STATE_MODEL_VERSION,
  CONDITION_LANGUAGE_VERSION,
  REQUIREMENT_STATE_MODEL_VERSION,
  RESOLUTION_SEMANTICS_VERSION,
  RISK_LEVEL_MODEL_VERSION,
} = require("../contracts/constants");
const {
  PolicyPackIntegrityError,
  PolicyPackValidationError,
  UBO_POLICY_READINESS_ERROR_CODE,
  UboPolicyReadinessError,
} = require("../errors");
const { cloneData, deepFreeze, isPlainObject } = require("../internal/validation");
const { CANONICALIZATION_ALGORITHM, canonicalizeJson } = require("./canonicalJson");
const { loadPolicyPack } = require("./policyPack");

const UBO_POLICY_READINESS_CONTRACT_VERSION = "ubo-policy-readiness-v1";

const UBO_POLICY_RUNTIME_MODE = Object.freeze({
  LAB: "LAB",
  PRODUCTION: "PRODUCTION",
  HISTORICAL_RECONSTRUCTION: "HISTORICAL_RECONSTRUCTION",
});

const UBO_POLICY_READINESS = Object.freeze({
  READY: "READY",
  REVIEW_ONLY: "REVIEW_ONLY",
  BLOCKED: "BLOCKED",
});

const POLICY_USE = Object.freeze({
  NEW_DETERMINATION: "NEW_DETERMINATION",
  VERIFY_OR_RECONSTRUCT: "VERIFY_OR_RECONSTRUCT",
});

const SUPPORTED_ALGORITHMS = new Set([
  `capabilityContract@${CAPABILITY_CONTRACT_VERSION}`,
  `conditionLanguage@${CONDITION_LANGUAGE_VERSION}`,
  `requirementStateModel@${REQUIREMENT_STATE_MODEL_VERSION}`,
  `claimStateModel@${CLAIM_STATE_MODEL_VERSION}`,
  `applicabilityModel@${APPLICABILITY_MODEL_VERSION}`,
  `resolutionSemantics@${RESOLUTION_SEMANTICS_VERSION}`,
  `riskLevelModel@${RISK_LEVEL_MODEL_VERSION}`,
  `canonicalization@${CANONICALIZATION_ALGORITHM}`,
  "ownershipGraph@ubo-graph-v1",
  "percentageCalculation@ubo-percentage-lookthrough-v1",
  "policyDetermination@ubo-policy-determination-v1",
  "requirementResolution@ubo-requirement-resolution-v1",
  "resolutionOrchestration@ubo-resolution-orchestration-v1",
  "decisionSnapshot@ubo-decision-snapshot-construction-v1",
  "decisionReconstruction@ubo-decision-reconstruction-v1",
  "resolutionPlanner@ubo-low-friction-planner-v1",
  "ownershipGraphProjection@ubo-ownership-graph-projection-v1",
  "journeyProjection@ubo-journey-projection-v1",
]);

function readinessError(code, message, cause) {
  throw new UboPolicyReadinessError(message, { code, cause });
}

function assertInput(input) {
  if (!isPlainObject(input)) readinessError(UBO_POLICY_READINESS_ERROR_CODE.INVALID_INPUT, "Policy readiness input must be a plain object");
  const allowed = new Set(["policyPack", "runtimeMode", "evaluationTime", "pinnedPolicyIdentity", "intendedUse"]);
  const unexpected = Object.keys(input).filter((key) => !allowed.has(key));
  if (unexpected.length > 0) readinessError(
    UBO_POLICY_READINESS_ERROR_CODE.INVALID_INPUT,
    `Policy readiness input contains unsupported field(s): ${unexpected.join(", ")}`,
  );
  if (!Object.values(UBO_POLICY_RUNTIME_MODE).includes(input.runtimeMode)) readinessError(
    UBO_POLICY_READINESS_ERROR_CODE.UNSUPPORTED_RUNTIME_MODE,
    `runtimeMode must be one of: ${Object.values(UBO_POLICY_RUNTIME_MODE).join(", ")}`,
  );
  if (typeof input.evaluationTime !== "string" || input.evaluationTime.trim() === "") readinessError(
    UBO_POLICY_READINESS_ERROR_CODE.EVALUATION_TIME_REQUIRED,
    "evaluationTime is required and must be explicit",
  );
  if (Number.isNaN(Date.parse(input.evaluationTime))) readinessError(
    UBO_POLICY_READINESS_ERROR_CODE.INVALID_EVALUATION_TIME,
    "evaluationTime must be a valid ISO-compatible timestamp",
  );
  if (input.intendedUse !== undefined && !Object.values(POLICY_USE).includes(input.intendedUse)) readinessError(
    UBO_POLICY_READINESS_ERROR_CODE.INVALID_INPUT,
    `intendedUse must be one of: ${Object.values(POLICY_USE).join(", ")}`,
  );
}

function validatePinnedIdentity(value) {
  if (!isPlainObject(value)) readinessError(
    UBO_POLICY_READINESS_ERROR_CODE.POLICY_IDENTITY_REQUIRED,
    "Historical reconstruction requires a pinned policy identity",
  );
  const fields = ["schemaId", "schemaVersion", "policyPackId", "version", "hash"];
  const unexpected = Object.keys(value).filter((key) => !fields.includes(key));
  const missing = fields.filter((key) => typeof value[key] !== "string" || value[key].trim() === "");
  if (unexpected.length > 0 || missing.length > 0) readinessError(
    UBO_POLICY_READINESS_ERROR_CODE.POLICY_IDENTITY_REQUIRED,
    "Pinned policy identity must contain only schemaId, schemaVersion, policyPackId, version and hash",
  );
  if (!/^sha256:[0-9a-f]{64}$/.test(value.hash)) readinessError(
    UBO_POLICY_READINESS_ERROR_CODE.POLICY_IDENTITY_REQUIRED,
    "Pinned policy identity hash must be a lowercase sha256 pin",
  );
  return value;
}

function effectiveState(effectivePeriod, evaluationTime) {
  const from = effectivePeriod?.from;
  const to = effectivePeriod?.to;
  if (from === null || from === undefined) return "UNDATED";
  const at = Date.parse(evaluationTime);
  if (at < Date.parse(from)) return "NOT_YET_EFFECTIVE";
  if (to !== null && to !== undefined && at >= Date.parse(to)) return "EXPIRED";
  return "EFFECTIVE";
}

function productionMetadata(policyPack) {
  const declared = policyPack.productionReadiness;
  return {
    releaseStatus: declared?.releaseStatus || policyPack.status,
    approvingAuthority: declared
      ? declared.approvingAuthority
      : policyPack.sourceTraceability?.approvedBy ?? null,
    mandatorySignoffIds: declared?.mandatorySignoffIds || [],
    features: declared?.features || [],
    requiredAlgorithms: declared?.requiredAlgorithms || [],
    signoffs: policyPack.signoffs || [],
  };
}

function productionAssessment(policyPack, evaluationTime) {
  const metadata = productionMetadata(policyPack);
  const signoffs = new Map(metadata.signoffs.map((signoff) => [signoff.signoffId, signoff]));
  const enabledFeatures = metadata.features.filter(({ enabled }) => enabled).map(({ featureId }) => featureId).sort();
  const featureSignoffIds = new Set(metadata.features.flatMap(({ requiredSignoffIds }) => requiredSignoffIds));
  const requiredSignoffIds = new Set([
    ...metadata.mandatorySignoffIds,
    ...metadata.features.filter(({ enabled }) => enabled).flatMap(({ requiredSignoffIds }) => requiredSignoffIds),
    ...metadata.signoffs.filter(({ productionBlocking, signoffId }) => productionBlocking && !featureSignoffIds.has(signoffId))
      .map(({ signoffId }) => signoffId),
  ]);
  const unresolvedSignoffs = metadata.signoffs.filter(({ status }) => status !== "APPROVED")
    .map(({ signoffId, status, scope, productionBlocking }) => ({ signoffId, status, scope, productionBlocking }))
    .sort((left, right) => left.signoffId.localeCompare(right.signoffId));
  const blockingSignoffs = [...requiredSignoffIds].filter((signoffId) => signoffs.get(signoffId)?.status !== "APPROVED").sort();
  const unsupportedAlgorithms = metadata.requiredAlgorithms.filter(({ algorithmId, version }) =>
    !SUPPORTED_ALGORITHMS.has(`${algorithmId}@${version}`))
    .map(({ algorithmId, version }) => ({ algorithmId, version }))
    .sort((left, right) => `${left.algorithmId}@${left.version}`.localeCompare(`${right.algorithmId}@${right.version}`));
  const state = effectiveState(policyPack.effectivePeriod, evaluationTime);
  const blockingReasons = [];
  if (policyPack.status !== "PRODUCTION_APPROVED" || metadata.releaseStatus !== "PRODUCTION_APPROVED") {
    blockingReasons.push({ code: "POLICY_NOT_PRODUCTION_APPROVED" });
  }
  if (policyPack.effectivePeriod?.from === null || policyPack.effectivePeriod?.from === undefined) {
    blockingReasons.push({ code: "EFFECTIVE_FROM_MISSING" });
  } else if (state === "NOT_YET_EFFECTIVE") blockingReasons.push({ code: "POLICY_NOT_YET_EFFECTIVE" });
  else if (state === "EXPIRED") blockingReasons.push({ code: "POLICY_EXPIRED" });
  if (!metadata.approvingAuthority) blockingReasons.push({ code: "APPROVING_AUTHORITY_MISSING" });
  if (blockingSignoffs.length > 0) blockingReasons.push({ code: "REQUIRED_SIGNOFF_NOT_APPROVED", signoffIds: blockingSignoffs });
  if (unsupportedAlgorithms.length > 0) blockingReasons.push({ code: "REQUIRED_ALGORITHM_UNSUPPORTED", algorithms: unsupportedAlgorithms });
  return { blockingReasons, unresolvedSignoffs, enabledFeatures, unsupportedAlgorithms, effectiveState: state };
}

function verifyPinnedIdentity(actual, pinned) {
  const comparable = {
    schemaId: actual.schemaId,
    schemaVersion: actual.schemaVersion,
    policyPackId: actual.policyPackId,
    version: actual.version,
    hash: actual.hash,
  };
  if (canonicalizeJson(comparable) !== canonicalizeJson(pinned)) readinessError(
    UBO_POLICY_READINESS_ERROR_CODE.POLICY_IDENTITY_MISMATCH,
    "Policy Pack does not match the exact pinned policy identity",
  );
}

function assessUboPolicyPackReadiness(input) {
  assertInput(input);
  const historical = input.runtimeMode === UBO_POLICY_RUNTIME_MODE.HISTORICAL_RECONSTRUCTION;
  const pinned = input.pinnedPolicyIdentity === undefined
    ? (historical ? validatePinnedIdentity(undefined) : undefined)
    : validatePinnedIdentity(input.pinnedPolicyIdentity);
  let loaded;
  try {
    loaded = loadPolicyPack(input.policyPack, pinned ? { expectedHash: pinned.hash } : undefined);
  } catch (cause) {
    if (cause instanceof PolicyPackIntegrityError) readinessError(
      UBO_POLICY_READINESS_ERROR_CODE.POLICY_IDENTITY_MISMATCH,
      "Policy Pack hash does not match the exact pinned policy identity",
      cause,
    );
    if (cause instanceof PolicyPackValidationError) readinessError(
      UBO_POLICY_READINESS_ERROR_CODE.INVALID_POLICY_PACK,
      "Policy Pack failed schema validation",
      cause,
    );
    throw cause;
  }
  if (pinned) verifyPinnedIdentity(loaded.identity, pinned);

  const production = productionAssessment(loaded.policyPack, input.evaluationTime);
  let readiness;
  let blockingReasons = production.blockingReasons;
  let watermarkRequired;
  let newProductionDeterminationPermitted;

  if (historical) {
    const intendedUse = input.intendedUse || POLICY_USE.VERIFY_OR_RECONSTRUCT;
    readiness = intendedUse === POLICY_USE.NEW_DETERMINATION
      ? UBO_POLICY_READINESS.BLOCKED
      : UBO_POLICY_READINESS.REVIEW_ONLY;
    blockingReasons = [{ code: intendedUse === POLICY_USE.NEW_DETERMINATION
      ? "HISTORICAL_MODE_PROHIBITS_NEW_DETERMINATION"
      : "HISTORICAL_RECONSTRUCTION_ONLY" }];
    watermarkRequired = loaded.policyPack.status !== "PRODUCTION_APPROVED";
    newProductionDeterminationPermitted = false;
  } else if (input.runtimeMode === UBO_POLICY_RUNTIME_MODE.LAB) {
    readiness = production.blockingReasons.length === 0 ? UBO_POLICY_READINESS.READY : UBO_POLICY_READINESS.REVIEW_ONLY;
    watermarkRequired = readiness !== UBO_POLICY_READINESS.READY;
    newProductionDeterminationPermitted = false;
  } else {
    readiness = production.blockingReasons.length === 0 ? UBO_POLICY_READINESS.READY : UBO_POLICY_READINESS.BLOCKED;
    watermarkRequired = readiness !== UBO_POLICY_READINESS.READY;
    newProductionDeterminationPermitted = readiness === UBO_POLICY_READINESS.READY;
  }

  return deepFreeze(cloneData({
    contractVersion: UBO_POLICY_READINESS_CONTRACT_VERSION,
    runtimeMode: input.runtimeMode,
    policyIdentity: loaded.identity,
    readiness,
    blockingReasons,
    unresolvedSignoffs: production.unresolvedSignoffs,
    enabledFeatures: production.enabledFeatures,
    unsupportedAlgorithms: production.unsupportedAlgorithms,
    effectiveState: production.effectiveState,
    watermarkRequired,
    newProductionDeterminationPermitted,
  }));
}

module.exports = {
  UBO_POLICY_READINESS,
  UBO_POLICY_READINESS_CONTRACT_VERSION,
  UBO_POLICY_RUNTIME_MODE,
  assessUboPolicyPackReadiness,
};
