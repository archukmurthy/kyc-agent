"use strict";

const { createHash } = require("node:crypto");
const { RESOLUTION_STRATEGY } = require("../contracts/constants");
const { validateEvidenceReference } = require("../contracts/evidenceReference");
const { validateOwnershipCase } = require("./ownershipCase");
const {
  assertAllowedKeys,
  assertArray,
  assertDataOnly,
  assertEnum,
  assertNonEmptyString,
  assertOptionalNonEmptyString,
  assertPlainObject,
  cloneData,
  deepFreeze,
  fail,
} = require("../internal/validation");
const { canonicalizeJson } = require("../policy/canonicalJson");

const OPTION_APPLICABILITY_STATE = Object.freeze({
  APPLICABLE: "APPLICABLE",
  INAPPLICABLE: "INAPPLICABLE",
  UNAVAILABLE: "UNAVAILABLE",
  REQUIRES_POLICY_CONTENT: "REQUIRES_POLICY_CONTENT",
});

const ACTION_INTENT_TYPE = Object.freeze({
  DISCOVER_INFORMATION: "DISCOVER_INFORMATION",
  INTERPRET_EXISTING_ARTIFACT: "INTERPRET_EXISTING_ARTIFACT",
  REQUEST_CUSTOMER_INFORMATION: "REQUEST_CUSTOMER_INFORMATION",
  REQUEST_CUSTOMER_EVIDENCE: "REQUEST_CUSTOMER_EVIDENCE",
  REQUEST_ATTESTATION: "REQUEST_ATTESTATION",
  ANALYST_REVIEW: "ANALYST_REVIEW",
  SPECIALIST_REVIEW: "SPECIALIST_REVIEW",
  OPERATIONAL_RETRY_OR_HOLD: "OPERATIONAL_RETRY_OR_HOLD",
});

const ACTION_INTENT_STATE = Object.freeze({
  OPEN: "OPEN",
  SATISFIED: "SATISFIED",
  SUPERSEDED: "SUPERSEDED",
  CANCELLED: "CANCELLED",
});

const RESOLUTION_ATTEMPT_OUTCOME = Object.freeze({
  SUCCEEDED: "SUCCEEDED",
  PARTIALLY_SUCCEEDED: "PARTIALLY_SUCCEEDED",
  NO_RESOLUTION: "NO_RESOLUTION",
  OPERATIONALLY_BLOCKED: "OPERATIONALLY_BLOCKED",
  REVIEW_PENDING: "REVIEW_PENDING",
});

const REVIEW_REQUIREMENT_TYPE = Object.freeze({ FALLBACK_EXHAUSTION: "FALLBACK_EXHAUSTION" });
const REVIEW_REQUIREMENT_STATE = Object.freeze({
  PENDING: "PENDING",
  RESOLVED: "RESOLVED",
  SUPERSEDED: "SUPERSEDED",
});
const FALLBACK_EXHAUSTION_DECISION = Object.freeze({
  ALL_POSSIBLE_MEANS_EXHAUSTED: "ALL_POSSIBLE_MEANS_EXHAUSTED",
  FURTHER_MEASURES_AVAILABLE: "FURTHER_MEASURES_AVAILABLE",
});
const FALLBACK_DECISION_ORIGIN = Object.freeze({ ANALYST: "ANALYST", COMPLIANCE: "COMPLIANCE" });

function digest(value) {
  return createHash("sha256").update(canonicalizeJson(value)).digest("hex");
}

function uniqueSorted(values) {
  return [...new Set(values || [])].sort();
}

function uniqueData(values) {
  const keyed = new Map();
  (values || []).forEach((value) => keyed.set(canonicalizeJson(value), cloneData(value)));
  return [...keyed.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, value]) => value);
}

function caseReference(caseState) {
  validateOwnershipCase(caseState);
  return { caseId: caseState.caseId, revisionId: caseState.revisionId, revision: caseState.revision };
}

function validatePolicyIdentity(identity, path = "policyIdentity") {
  assertPlainObject(identity, path);
  ["policyPackId", "policyVersion", "policyHash", "policySchemaVersion"].forEach((field) => {
    assertNonEmptyString(identity[field], `${path}.${field}`);
  });
  assertDataOnly(identity, path);
}

function validateStringArray(values, path) {
  assertArray(values, path);
  values.forEach((value, index) => assertNonEmptyString(value, `${path}[${index}]`));
}

function validateEvidenceReferences(references, path) {
  assertArray(references, path);
  references.forEach((reference, index) => validateEvidenceReference(reference, `${path}[${index}]`));
}

function createResolutionOption({
  caseState,
  policyIdentity,
  informationNeedId,
  requirementIds,
  strategy,
  applicabilityState,
  policyBasisReferences = [],
  actionTemplateReference,
  acceptableEvidenceTypes = [],
  constraints = [],
  reasonCode,
}) {
  const caseRef = caseReference(caseState);
  validatePolicyIdentity(policyIdentity);
  assertNonEmptyString(informationNeedId, "resolutionOption.informationNeedId");
  validateStringArray(requirementIds, "resolutionOption.requirementIds");
  assertEnum(strategy, RESOLUTION_STRATEGY, "resolutionOption.strategy");
  assertEnum(applicabilityState, OPTION_APPLICABILITY_STATE, "resolutionOption.applicabilityState");
  validateStringArray(policyBasisReferences, "resolutionOption.policyBasisReferences");
  validateStringArray(acceptableEvidenceTypes, "resolutionOption.acceptableEvidenceTypes");
  validateStringArray(constraints, "resolutionOption.constraints");
  assertNonEmptyString(reasonCode, "resolutionOption.reasonCode");
  if (actionTemplateReference !== undefined) {
    assertPlainObject(actionTemplateReference, "resolutionOption.actionTemplateReference");
    assertNonEmptyString(actionTemplateReference.actionTemplateId, "resolutionOption.actionTemplateReference.actionTemplateId");
    assertNonEmptyString(actionTemplateReference.contentStatus, "resolutionOption.actionTemplateReference.contentStatus");
    assertDataOnly(actionTemplateReference, "resolutionOption.actionTemplateReference");
  }
  const payload = {
    caseReference: caseRef,
    policyIdentity: cloneData(policyIdentity),
    informationNeedId,
    requirementIds: uniqueSorted(requirementIds),
    strategy,
    applicabilityState,
    policyBasisReferences: uniqueSorted(policyBasisReferences),
    acceptableEvidenceTypes: uniqueSorted(acceptableEvidenceTypes),
    constraints: uniqueSorted(constraints),
    reasonCode,
    ...(actionTemplateReference ? { actionTemplateReference: cloneData(actionTemplateReference) } : {}),
  };
  return deepFreeze({ optionId: `resolution-option:${digest(payload)}`, ...payload });
}

function createActionIntent({
  caseState,
  policyIdentity,
  type,
  state = ACTION_INTENT_STATE.OPEN,
  informationNeedIds = [],
  policyGapIds = [],
  requirementIds = [],
  resolutionOptionIds = [],
  strategy,
  semanticTarget = {},
  actionTemplateReference,
  acceptableEvidenceTypes = [],
  constraints = [],
  reasonCode,
}) {
  const caseRef = caseReference(caseState);
  validatePolicyIdentity(policyIdentity);
  assertEnum(type, ACTION_INTENT_TYPE, "actionIntent.type");
  assertEnum(state, ACTION_INTENT_STATE, "actionIntent.state");
  [informationNeedIds, policyGapIds, requirementIds, resolutionOptionIds, acceptableEvidenceTypes, constraints]
    .forEach((values, index) => validateStringArray(values, `actionIntent.list[${index}]`));
  if (strategy !== undefined) assertEnum(strategy, RESOLUTION_STRATEGY, "actionIntent.strategy");
  assertPlainObject(semanticTarget, "actionIntent.semanticTarget");
  assertDataOnly(semanticTarget, "actionIntent.semanticTarget");
  assertNonEmptyString(reasonCode, "actionIntent.reasonCode");
  if (actionTemplateReference !== undefined) {
    assertPlainObject(actionTemplateReference, "actionIntent.actionTemplateReference");
    assertNonEmptyString(actionTemplateReference.actionTemplateId, "actionIntent.actionTemplateReference.actionTemplateId");
    assertDataOnly(actionTemplateReference, "actionIntent.actionTemplateReference");
  }
  const semanticIdentity = {
    caseId: caseState.caseId,
    type,
    semanticTarget: cloneData(semanticTarget),
    ...(strategy ? { strategy } : {}),
    ...(actionTemplateReference ? { actionTemplateId: actionTemplateReference.actionTemplateId } : {}),
    acceptableEvidenceTypes: uniqueSorted(acceptableEvidenceTypes),
  };
  const payload = {
    caseReference: caseRef,
    policyIdentity: cloneData(policyIdentity),
    type,
    state,
    informationNeedIds: uniqueSorted(informationNeedIds),
    policyGapIds: uniqueSorted(policyGapIds),
    requirementIds: uniqueSorted(requirementIds),
    resolutionOptionIds: uniqueSorted(resolutionOptionIds),
    semanticTarget: cloneData(semanticTarget),
    acceptableEvidenceTypes: uniqueSorted(acceptableEvidenceTypes),
    constraints: uniqueSorted(constraints),
    reasonCode,
    ...(strategy ? { strategy } : {}),
    ...(actionTemplateReference ? { actionTemplateReference: cloneData(actionTemplateReference) } : {}),
  };
  return deepFreeze({
    actionIntentId: `action-intent:${digest(semanticIdentity)}`,
    actionIntentRecordId: `action-intent-record:${digest(payload)}`,
    ...payload,
  });
}

function createResolutionAttempt({
  caseState,
  policyIdentity,
  sequence,
  informationNeedIds,
  resolutionOptionId,
  actionIntentId,
  strategy,
  outcome,
  capabilityReference,
  capabilityOutcomeState,
  resultingFactReferences = [],
  resultingEvidenceReferences = [],
  reasonCode,
}) {
  const caseRef = caseReference(caseState);
  validatePolicyIdentity(policyIdentity);
  if (!Number.isSafeInteger(sequence) || sequence < 1) fail("resolutionAttempt.sequence must be a positive safe integer");
  validateStringArray(informationNeedIds, "resolutionAttempt.informationNeedIds");
  assertOptionalNonEmptyString(resolutionOptionId, "resolutionAttempt.resolutionOptionId");
  assertOptionalNonEmptyString(actionIntentId, "resolutionAttempt.actionIntentId");
  if (!resolutionOptionId && !actionIntentId) fail("resolutionAttempt must reference a ResolutionOption or ActionIntent");
  assertEnum(strategy, RESOLUTION_STRATEGY, "resolutionAttempt.strategy");
  assertEnum(outcome, RESOLUTION_ATTEMPT_OUTCOME, "resolutionAttempt.outcome");
  assertOptionalNonEmptyString(capabilityOutcomeState, "resolutionAttempt.capabilityOutcomeState");
  if (capabilityReference !== undefined) {
    assertPlainObject(capabilityReference, "resolutionAttempt.capabilityReference");
    assertDataOnly(capabilityReference, "resolutionAttempt.capabilityReference");
  }
  validateStringArray(resultingFactReferences, "resolutionAttempt.resultingFactReferences");
  validateEvidenceReferences(resultingEvidenceReferences, "resolutionAttempt.resultingEvidenceReferences");
  assertNonEmptyString(reasonCode, "resolutionAttempt.reasonCode");
  if (["FAILED", "UNAVAILABLE"].includes(capabilityOutcomeState)
    && outcome !== RESOLUTION_ATTEMPT_OUTCOME.OPERATIONALLY_BLOCKED) {
    fail("FAILED/UNAVAILABLE capability outcomes must remain OPERATIONALLY_BLOCKED");
  }
  const payload = {
    attemptModelVersion: "ubo-resolution-attempt-v1",
    sequence,
    caseReference: caseRef,
    policyIdentity: cloneData(policyIdentity),
    informationNeedIds: uniqueSorted(informationNeedIds),
    strategy,
    outcome,
    resultingFactReferences: uniqueSorted(resultingFactReferences),
    resultingEvidenceReferences: uniqueData(resultingEvidenceReferences),
    reasonCode,
    ...(resolutionOptionId ? { resolutionOptionId } : {}),
    ...(actionIntentId ? { actionIntentId } : {}),
    ...(capabilityReference ? { capabilityReference: cloneData(capabilityReference) } : {}),
    ...(capabilityOutcomeState ? { capabilityOutcomeState } : {}),
  };
  return deepFreeze({ attemptId: `resolution-attempt:${digest(payload)}`, ...payload });
}

function validateResolutionAttemptHistory(attempts, caseState) {
  validateOwnershipCase(caseState);
  assertArray(attempts, "resolutionAttempts");
  const ids = new Set();
  const sequences = new Set();
  attempts.forEach((attempt, index) => {
    assertPlainObject(attempt, `resolutionAttempts[${index}]`);
    assertNonEmptyString(attempt.attemptId, `resolutionAttempts[${index}].attemptId`);
    if (ids.has(attempt.attemptId)) fail("resolution attempt history cannot overwrite or duplicate an attempt");
    ids.add(attempt.attemptId);
    if (!Number.isSafeInteger(attempt.sequence) || attempt.sequence < 1 || sequences.has(attempt.sequence)) {
      fail("resolution attempt history requires unique positive deterministic sequence values");
    }
    sequences.add(attempt.sequence);
    if (attempt.caseReference?.caseId !== caseState.caseId
      || attempt.caseReference.revisionId !== caseState.revisionId
      || attempt.caseReference.revision !== caseState.revision) fail("resolution attempt belongs to a different case revision");
    if (attempt.attemptModelVersion !== "ubo-resolution-attempt-v1") fail("resolution attempt model version is unsupported");
    assertEnum(attempt.strategy, RESOLUTION_STRATEGY, `resolutionAttempts[${index}].strategy`);
    assertEnum(attempt.outcome, RESOLUTION_ATTEMPT_OUTCOME, `resolutionAttempts[${index}].outcome`);
    if (["FAILED", "UNAVAILABLE"].includes(attempt.capabilityOutcomeState)
      && attempt.outcome !== RESOLUTION_ATTEMPT_OUTCOME.OPERATIONALLY_BLOCKED) {
      fail("FAILED/UNAVAILABLE capability outcome was reinterpreted substantively");
    }
    const { attemptId, ...payload } = attempt;
    if (attemptId !== `resolution-attempt:${digest(payload)}`) fail("resolution attempt ID does not match canonical content");
    assertDataOnly(attempt, `resolutionAttempts[${index}]`);
  });
  return true;
}

function createReviewPackage({
  caseState,
  policyIdentity,
  graphVersion,
  qualifyingPersonReferences = [],
  requirementSummaries,
  informationNeedSummaries,
  resolutionAttemptSummaries,
  capabilityOutcomeReferences = [],
  evidenceReferences = [],
  calculationReferences = [],
  conflictAndReviewReferences = [],
  seniorManagementCandidates = [],
  readinessReasons,
}) {
  const caseRef = caseReference(caseState);
  validatePolicyIdentity(policyIdentity);
  assertNonEmptyString(graphVersion, "reviewPackage.graphVersion");
  [qualifyingPersonReferences, capabilityOutcomeReferences, conflictAndReviewReferences, readinessReasons]
    .forEach((values, index) => validateStringArray(values, `reviewPackage.list[${index}]`));
  [requirementSummaries, informationNeedSummaries, resolutionAttemptSummaries, calculationReferences, seniorManagementCandidates]
    .forEach((values, index) => {
      assertArray(values, `reviewPackage.data[${index}]`);
      values.forEach((value, itemIndex) => assertDataOnly(value, `reviewPackage.data[${index}][${itemIndex}]`));
    });
  validateEvidenceReferences(evidenceReferences, "reviewPackage.evidenceReferences");
  const manifest = {
    policyIdentity: cloneData(policyIdentity),
    caseReference: caseRef,
    graphVersion,
    qualifyingPersonReferences: uniqueSorted(qualifyingPersonReferences),
    requirementSummaries: uniqueData(requirementSummaries),
    informationNeedSummaries: uniqueData(informationNeedSummaries),
    resolutionAttemptSummaries: uniqueData(resolutionAttemptSummaries),
    capabilityOutcomeReferences: uniqueSorted(capabilityOutcomeReferences),
    evidenceReferences: uniqueData(evidenceReferences),
    calculationReferences: uniqueData(calculationReferences),
    conflictAndReviewReferences: uniqueSorted(conflictAndReviewReferences),
    seniorManagementCandidates: uniqueData(seniorManagementCandidates),
    readinessReasons: uniqueSorted(readinessReasons),
  };
  const reasoningManifestHash = `sha256:${digest(manifest)}`;
  return deepFreeze({
    reviewPackageId: `fallback-review-package:${digest({ caseReference: caseRef, reasoningManifestHash })}`,
    reasoningManifestHash,
    ...manifest,
  });
}

function createReviewRequirement({ caseState, policyIdentity, graphVersion, reviewPackage, state, reasonCode }) {
  const caseRef = caseReference(caseState);
  validatePolicyIdentity(policyIdentity);
  assertNonEmptyString(graphVersion, "reviewRequirement.graphVersion");
  assertPlainObject(reviewPackage, "reviewRequirement.reviewPackage");
  assertEnum(state, REVIEW_REQUIREMENT_STATE, "reviewRequirement.state");
  assertNonEmptyString(reasonCode, "reviewRequirement.reasonCode");
  const semantic = {
    caseReference: caseRef,
    policyIdentity: cloneData(policyIdentity),
    graphVersion,
    reviewType: REVIEW_REQUIREMENT_TYPE.FALLBACK_EXHAUSTION,
    reasonCode,
    relevantRequirementResolutionIds: uniqueSorted(reviewPackage.requirementSummaries.map(({ requirementResolutionId }) => requirementResolutionId).filter(Boolean)),
    relevantInformationNeedIds: uniqueSorted(reviewPackage.informationNeedSummaries.map(({ needId }) => needId).filter(Boolean)),
    relevantResolutionAttemptIds: uniqueSorted(reviewPackage.resolutionAttemptSummaries.map(({ attemptId }) => attemptId).filter(Boolean)),
    graphAndCalculationReferences: uniqueData([{ graphVersion }, ...reviewPackage.calculationReferences]),
    evidenceReferences: uniqueData(reviewPackage.evidenceReferences),
    reviewPackageReference: {
      reviewPackageId: reviewPackage.reviewPackageId,
      reasoningManifestHash: reviewPackage.reasoningManifestHash,
    },
  };
  const reviewRequirementId = `review-requirement:${digest(semantic)}`;
  const payload = { reviewRequirementId, ...semantic, state };
  return deepFreeze({ reviewRequirementRecordId: `review-requirement-record:${digest(payload)}`, ...payload });
}

function createFallbackExhaustionDecision({
  reviewRequirement,
  decision,
  origin,
  furtherInformationNeedDrafts = [],
  reasonCode,
}) {
  assertPlainObject(reviewRequirement, "reviewRequirement");
  assertNonEmptyString(reviewRequirement.reviewRequirementId, "reviewRequirement.reviewRequirementId");
  assertNonEmptyString(reviewRequirement.reviewRequirementRecordId, "reviewRequirement.reviewRequirementRecordId");
  if (reviewRequirement.reviewType !== REVIEW_REQUIREMENT_TYPE.FALLBACK_EXHAUSTION) fail("decision requires FALLBACK_EXHAUSTION review");
  if (reviewRequirement.state !== REVIEW_REQUIREMENT_STATE.PENDING) fail("decision requires a pending review requirement");
  assertEnum(decision, FALLBACK_EXHAUSTION_DECISION, "fallbackExhaustionDecision.decision");
  assertEnum(origin, FALLBACK_DECISION_ORIGIN, "fallbackExhaustionDecision.origin");
  assertArray(furtherInformationNeedDrafts, "fallbackExhaustionDecision.furtherInformationNeedDrafts");
  furtherInformationNeedDrafts.forEach((draft, index) => assertDataOnly(draft, `fallbackExhaustionDecision.furtherInformationNeedDrafts[${index}]`));
  assertNonEmptyString(reasonCode, "fallbackExhaustionDecision.reasonCode");
  if (decision === FALLBACK_EXHAUSTION_DECISION.FURTHER_MEASURES_AVAILABLE
    && furtherInformationNeedDrafts.length === 0) {
    fail("FURTHER_MEASURES_AVAILABLE requires at least one concrete InformationNeed draft");
  }
  if (decision === FALLBACK_EXHAUSTION_DECISION.ALL_POSSIBLE_MEANS_EXHAUSTED
    && furtherInformationNeedDrafts.length > 0) {
    fail("positive exhaustion decision cannot carry further-measure InformationNeeds");
  }
  const payload = {
    decisionModelVersion: "ubo-fallback-exhaustion-decision-v1",
    reviewRequirementId: reviewRequirement.reviewRequirementId,
    reviewRequirementRecordId: reviewRequirement.reviewRequirementRecordId,
    caseReference: cloneData(reviewRequirement.caseReference),
    policyIdentity: cloneData(reviewRequirement.policyIdentity),
    graphVersion: reviewRequirement.graphVersion,
    reasoningManifestHash: reviewRequirement.reviewPackageReference.reasoningManifestHash,
    decision,
    origin,
    furtherInformationNeedDrafts: cloneData(furtherInformationNeedDrafts),
    reasonCode,
  };
  return deepFreeze({ decisionId: `fallback-exhaustion-decision:${digest(payload)}`, ...payload });
}

function validateFallbackExhaustionDecision(decision, path = "fallbackExhaustionDecision") {
  assertPlainObject(decision, path);
  assertAllowedKeys(decision, [
    "decisionId",
    "decisionModelVersion",
    "reviewRequirementId",
    "reviewRequirementRecordId",
    "caseReference",
    "policyIdentity",
    "graphVersion",
    "reasoningManifestHash",
    "decision",
    "origin",
    "furtherInformationNeedDrafts",
    "reasonCode",
  ], path);
  ["decisionId", "decisionModelVersion", "reviewRequirementId", "reviewRequirementRecordId", "graphVersion",
    "reasoningManifestHash", "reasonCode"].forEach((field) => assertNonEmptyString(decision[field], `${path}.${field}`));
  if (decision.decisionModelVersion !== "ubo-fallback-exhaustion-decision-v1") fail(`${path}.decisionModelVersion is unsupported`);
  assertEnum(decision.decision, FALLBACK_EXHAUSTION_DECISION, `${path}.decision`);
  assertEnum(decision.origin, FALLBACK_DECISION_ORIGIN, `${path}.origin`);
  assertPlainObject(decision.caseReference, `${path}.caseReference`);
  validatePolicyIdentity(decision.policyIdentity, `${path}.policyIdentity`);
  assertArray(decision.furtherInformationNeedDrafts, `${path}.furtherInformationNeedDrafts`);
  if (decision.decision === FALLBACK_EXHAUSTION_DECISION.FURTHER_MEASURES_AVAILABLE
    && decision.furtherInformationNeedDrafts.length === 0) fail(`${path} requires a concrete further InformationNeed`);
  if (decision.decision === FALLBACK_EXHAUSTION_DECISION.ALL_POSSIBLE_MEANS_EXHAUSTED
    && decision.furtherInformationNeedDrafts.length > 0) fail(`${path} positive decision cannot carry further needs`);
  const { decisionId, ...payload } = decision;
  if (decisionId !== `fallback-exhaustion-decision:${digest(payload)}`) fail(`${path}.decisionId does not match canonical content`);
  assertDataOnly(decision, path);
  return true;
}

module.exports = {
  ACTION_INTENT_STATE,
  ACTION_INTENT_TYPE,
  FALLBACK_DECISION_ORIGIN,
  FALLBACK_EXHAUSTION_DECISION,
  OPTION_APPLICABILITY_STATE,
  RESOLUTION_ATTEMPT_OUTCOME,
  REVIEW_REQUIREMENT_STATE,
  REVIEW_REQUIREMENT_TYPE,
  createActionIntent,
  createFallbackExhaustionDecision,
  createResolutionAttempt,
  createResolutionOption,
  createReviewPackage,
  createReviewRequirement,
  validateFallbackExhaustionDecision,
  validateResolutionAttemptHistory,
};
