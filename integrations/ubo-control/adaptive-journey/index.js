"use strict";

const { createHash } = require("node:crypto");
const {
  CAPABILITY_CONTRACT_VERSION,
  CAPABILITY_OUTCOME_STATE,
  CUSTOMER_ACTION_TYPE_V2,
  CUSTOMER_ACTION_V2,
  DECISION_APPLICATION_CONTRACT_VERSION_V3,
  validateCapabilityResult,
} = require("../../../ubo-control");

const ADAPTIVE_JOURNEY_COORDINATOR_V1 = "ubo-adaptive-journey-coordinator-v1";
const ADAPTIVE_JOURNEY_SESSION_V1 = "ubo-adaptive-journey-session-v1";
const EXCEPTION_ROUND_V1 = "ubo-adaptive-exception-round-v1";
const SHADOW_AUTO_ELIGIBILITY_V1 = "ubo-shadow-auto-eligibility-v1";

const SOURCE_MODE = Object.freeze({
  LIVE: "LIVE",
  REPLAY: "REPLAY",
  SOURCE_REVIEWED_FIXTURE: "SOURCE_REVIEWED_FIXTURE",
});

const ADAPTIVE_PATH = Object.freeze({
  CONFIRM: "CONFIRM",
  NAMED_GAP: "NAMED_GAP",
  STRUCTURE: "STRUCTURE",
  WAIT_REVIEW: "WAIT_REVIEW",
  COMPLETE: "COMPLETE",
});

const ISSUE_CLASS = Object.freeze({
  MISSING_INFORMATION: "MISSING_INFORMATION",
  VERIFICATION_LIMITATION: "VERIFICATION_LIMITATION",
  CONTRADICTION: "CONTRADICTION",
  EXTRACTION_UNCERTAINTY: "EXTRACTION_UNCERTAINTY",
  OPERATIONAL_FAILURE: "OPERATIONAL_FAILURE",
});

const DEFAULT_LIMITS = Object.freeze({ maxCalls: 4, maxConcurrency: 2, maxElapsedMs: 20_000, maxCostUnits: 4 });

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function stableId(prefix, value) {
  return `${prefix}:${createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 32)}`;
}
function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
}
function assertString(value, label) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${label} must be a non-empty string`);
}
function nowIso(clock) { return clock().toISOString(); }
function currentEntry(session) { return session.snapshots.at(-1) || null; }

function operationEvent(session, eventType, details = {}) {
  session.operationTrace.push({ sequence: session.operationTrace.length + 1, eventType, ...clone(details) });
}

function sourceIssueClass(result) {
  if ([CAPABILITY_OUTCOME_STATE.FAILED, CAPABILITY_OUTCOME_STATE.UNAVAILABLE].includes(result.outcome.state)) {
    return ISSUE_CLASS.OPERATIONAL_FAILURE;
  }
  if ([CAPABILITY_OUTCOME_STATE.PARTIAL, CAPABILITY_OUTCOME_STATE.INCONCLUSIVE].includes(result.outcome.state)) {
    return ISSUE_CLASS.EXTRACTION_UNCERTAINTY;
  }
  return null;
}

function classifyIssues(entry, session) {
  const issues = session.sourceRecords.flatMap((record) => {
    const topLevel = sourceIssueClass(record.capabilityResult);
    return [
      ...(topLevel ? [{ issueClass: topLevel, sourceRecordId: record.sourceRecordId, detail: record.capabilityResult.outcome }] : []),
      ...record.capabilityResult.issues.map((issue) => ({
        issueClass: /contradict|conflict/i.test(`${issue.code || ""} ${issue.message || ""}`)
          ? ISSUE_CLASS.CONTRADICTION
          : /unavailable|timeout|failed|entitlement/i.test(`${issue.code || ""} ${issue.message || ""}`)
            ? ISSUE_CLASS.OPERATIONAL_FAILURE
            : ISSUE_CLASS.EXTRACTION_UNCERTAINTY,
        sourceRecordId: record.sourceRecordId,
        detail: issue,
      })),
    ];
  });
  if (!entry) return issues;
  const content = entry.snapshot.decisionContent;
  issues.push(...content.informationNeedsV2.filter(({ status }) => status === "OPEN").map((need) => ({
    issueClass: ISSUE_CLASS.MISSING_INFORMATION,
    informationNeedId: need.needId,
    requirementIds: clone(need.requiredByRequirementIds || []),
    subject: clone(need.subject || null),
  })));
  issues.push(...(content.reviewRequirements || []).map((review) => ({
    issueClass: /contradict|conflict/i.test(JSON.stringify(review)) ? ISSUE_CLASS.CONTRADICTION : ISSUE_CLASS.VERIFICATION_LIMITATION,
    reviewRequirement: clone(review),
  })));
  return issues;
}

function choosePrimaryBundle(entry, session) {
  const bundles = entry?.journey.customerWorkBundles || [];
  const subjectId = session?.caseContext?.subjectEntityId;
  const executable = bundles.filter((bundle) => bundle.permittedSemanticActions.some(({ executable: allowed }) => allowed));
  return executable.find((bundle) => !bundle.canonicalSubject.entityIds.includes(subjectId)) || executable[0] || null;
}

function confirmationStatement(entry, bundle) {
  if (!bundle) return null;
  return {
    contractVersion: "ubo-confirmed-ownership-statement-view-v1",
    durabilityStatus: "PENDING_DURABLE_CONTRACT",
    professionalCertification: false,
    sourceSnapshot: { snapshotId: entry.snapshot.snapshotId, snapshotHash: entry.snapshot.decisionContentHash },
    materialScope: clone(bundle.knownInformation),
    explanation: "This read-only view records the exact scope offered for confirmation. It is not an Evidence Artifact or professional certification.",
  };
}

function adaptiveView(entry, session) {
  if (!entry) {
    return {
      path: ADAPTIVE_PATH.WAIT_REVIEW,
      headline: "Research completed — explicit review is required",
      currentTask: null,
      issueClasses: classifyIssues(null, session),
      reasonCodes: ["CANDIDATE_FACTS_REQUIRE_EXPLICIT_DECISIONS"],
    };
  }
  const bundle = choosePrimaryBundle(entry, session);
  const actions = bundle?.permittedSemanticActions.filter(({ executable }) => executable) || [];
  const hasConfirm = actions.some(({ actionType }) => actionType === CUSTOMER_ACTION_TYPE_V2.CONFIRM_ESTABLISHED_INFORMATION);
  const hasStructured = actions.some(({ actionType }) => actionType === CUSTOMER_ACTION_TYPE_V2.SUBMIT_STRUCTURED_RELATIONSHIP);
  const hasEvidence = actions.some(({ actionType }) => actionType === CUSTOMER_ACTION_TYPE_V2.REQUEST_EXTERNAL_EVIDENCE);
  let path = ADAPTIVE_PATH.WAIT_REVIEW;
  let headline = "The case is progressing without a customer task";
  const reasons = [];
  if (bundle && hasConfirm) {
    path = ADAPTIVE_PATH.CONFIRM;
    headline = "Confirm the ownership and control information shown";
    reasons.push("SUPPORTED_STRUCTURE_AVAILABLE_FOR_CONFIRMATION");
  } else if (bundle && (hasStructured || hasEvidence) && bundle.canonicalSubject.entityIds.some((id) => id !== session.caseContext.subjectEntityId)) {
    path = ADAPTIVE_PATH.NAMED_GAP;
    headline = "Complete one named ownership gap";
    reasons.push("KNOWN_STRUCTURE_HAS_MATERIAL_FRONTIER");
  } else if (bundle && (hasStructured || hasEvidence)) {
    path = ADAPTIVE_PATH.STRUCTURE;
    headline = "Provide existing ownership structure information";
    reasons.push("INSUFFICIENT_USABLE_STRUCTURE");
  } else if (entry.journey.finalCaseComplete) {
    path = ADAPTIVE_PATH.COMPLETE;
    headline = "Ownership review complete";
    reasons.push("FINAL_CASE_COMPLETE");
  } else {
    reasons.push(entry.plan.currentPlanningWave?.actor === "SYSTEM" ? "BOUNDED_SYSTEM_WORK_PENDING" : "INTERNAL_OR_SPECIALIST_REVIEW_PENDING");
  }
  return {
    path,
    headline,
    reasonCodes: reasons,
    currentTask: bundle ? {
      bundleId: bundle.bundleId,
      canonicalSubject: clone(bundle.canonicalSubject),
      informationNeedIds: clone(bundle.informationNeedIds),
      requirementIds: clone(bundle.requirementIds),
      knownInformation: clone(bundle.knownInformation),
      missingInformation: clone(bundle.missingInformation),
      permittedSemanticActions: clone(actions),
      evidenceHandoff: clone(bundle.evidenceHandoff || null),
    } : null,
    confirmationStatement: hasConfirm ? confirmationStatement(entry, bundle) : null,
    issueClasses: classifyIssues(entry, session),
    customerInputComplete: entry.journey.customerInputComplete,
    finalCaseComplete: entry.journey.finalCaseComplete,
  };
}

function shadowEligibility(session) {
  const unresolvedIdentity = session.pendingDecisionTargets.candidateParties.length > 0;
  const unresolvedClaims = session.pendingDecisionTargets.candidateClaims.length > 0;
  const contradiction = session.sourceRecords.some(({ capabilityResult }) =>
    capabilityResult.issues.some((issue) => /contradict|conflict/i.test(`${issue.code || ""} ${issue.message || ""}`)));
  const prerequisites = [
    { prerequisite: "IDENTITY_EXPLICITLY_RESOLVED", passed: !unresolvedIdentity },
    { prerequisite: "CLAIMS_EXPLICITLY_ADJUDICATED", passed: !unresolvedClaims },
    { prerequisite: "NO_MATERIAL_CONTRADICTION", passed: !contradiction },
    { prerequisite: "A_03_EVIDENCE_SUFFICIENCY_APPROVED", passed: false, reason: "A-03 remains outside this review-only slice" },
    { prerequisite: "VERSIONED_AUTOMATIC_DECISION_RULE_AUTHORISED", passed: false, reason: "UAJ-01 reports eligibility only" },
  ];
  return {
    contractVersion: SHADOW_AUTO_ELIGIBILITY_V1,
    mode: "SHADOW_ONLY",
    eligible: prerequisites.every(({ passed }) => passed),
    adjudicationPerformed: false,
    zeroAnalystTouch: false,
    prerequisites,
  };
}

function actionFor(entry, bundle, permitted, actionType, payload, actor, at) {
  return {
    contractVersion: CUSTOMER_ACTION_V2,
    caseReference: clone(entry.journey.decision.caseReference),
    sourceDecisionSnapshot: { snapshotId: entry.snapshot.snapshotId, snapshotHash: entry.snapshot.decisionContentHash },
    sourceResolutionPlan: { planId: entry.plan.planId, planHash: entry.plan.planHash },
    bundleId: bundle.bundleId,
    resolutionGroupId: bundle.resolutionGroupId,
    resolutionActionId: permitted.sourceResolutionActionId,
    informationNeedIds: clone(bundle.informationNeedIds),
    requirementIds: clone(bundle.requirementIds),
    canonicalSubject: clone(bundle.canonicalSubject),
    frontierEntityIds: clone(bundle.frontierEntityIds),
    policyIdentity: clone(entry.journey.decision.policyIdentity),
    actionType,
    submissionContract: permitted.submissionContract,
    actorReference: clone(actor.actorReference),
    actorCapacity: actor.actorCapacity,
    submittedAt: at,
    informationAsAtDate: actor.informationAsAtDate || at,
    delegatedFrom: actor.delegatedFrom || null,
    payload,
  };
}

function createAdaptiveJourneyCoordinator({ decisionApplication, discoveryService, extractionService = null, clock = () => new Date(), limits = {} } = {}) {
  assertObject(decisionApplication, "decisionApplication");
  for (const operation of ["intake", "applyDecisions", "applyCustomerInput", "evaluate"]) {
    if (typeof decisionApplication[operation] !== "function") throw new TypeError(`decisionApplication.${operation} is required`);
  }
  if (!discoveryService || typeof discoveryService.discover !== "function") throw new TypeError("discoveryService.discover is required");
  const configuredLimits = Object.freeze({ ...DEFAULT_LIMITS, ...limits });

  function validateSession(value) {
    if (!value || value.contractVersion !== ADAPTIVE_JOURNEY_SESSION_V1 || value.productionAuthorized !== false) {
      throw new TypeError("Unsupported adaptive journey session");
    }
    if (!Object.values(SOURCE_MODE).includes(value.sourceMode)) throw new TypeError("Unsupported adaptive journey source mode");
    const copy = clone(value);
    copy.snapshots.forEach((entry, index) => {
      if (entry.snapshot.snapshotId !== entry.snapshot.decisionContentHash) throw new TypeError("Adaptive journey snapshot identity is invalid");
      if (entry.journey.decision.snapshotId !== entry.snapshot.snapshotId || entry.journey.decision.planId !== entry.plan.planId) {
        throw new TypeError("Adaptive journey projection pins do not match its snapshot and plan");
      }
      if (!index && entry.predecessorSnapshotId !== null) {
        throw new TypeError("Adaptive journey genesis predecessor history is invalid");
      }
      if (index && entry.predecessorSnapshotId !== copy.snapshots[index - 1].snapshot.snapshotId) {
        throw new TypeError("Adaptive journey predecessor history is invalid");
      }
    });
    return copy;
  }

  function ensureBudget(session, costUnits = 1) {
    if (session.executionBudget.usedCalls >= session.executionBudget.maxCalls) throw new TypeError("Adaptive journey call budget is exhausted");
    if (session.executionBudget.usedCostUnits + costUnits > session.executionBudget.maxCostUnits) throw new TypeError("Adaptive journey cost budget is exhausted");
    if (Date.parse(nowIso(clock)) - Date.parse(session.executionBudget.startedAt) > session.executionBudget.maxElapsedMs) {
      throw new TypeError("Adaptive journey elapsed-time budget is exhausted");
    }
    session.executionBudget.usedCalls += 1;
    session.executionBudget.usedCostUnits += costUnits;
  }

  function recordSource(session, capability, request, result, operationId) {
    validateCapabilityResult(result, { expectedRequestId: request.requestId });
    session.sourceRecords.push({
      sourceRecordId: stableId("ubo-adaptive-source", { operationId, requestId: request.requestId }),
      capability,
      operationId,
      request: clone(request),
      capabilityResult: clone(result),
      provenance: { sourceMode: session.sourceMode, sourceIdentity: clone(session.sourceIdentity) },
    });
  }

  function updateAfterApplication(session, result) {
    session.caseState = result.caseState;
    session.pendingDecisionTargets = clone(result.decisionTargets);
    session.shadowAutoEligibility = shadowEligibility(session);
    session.adaptiveView = adaptiveView(currentEntry(session), session);
    return session;
  }

  function evaluateCurrent(session, { evaluatedAt, reason }) {
    const previous = currentEntry(session);
    const result = decisionApplication.evaluate({
      contractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V3,
      runtimeMode: "LAB",
      caseState: session.caseState,
      caseContext: session.caseContext,
      evaluationTime: evaluatedAt,
      checkpoint: previous ? "CASE_EVENT" : "CASE_OPEN",
      checkpointReference: { referenceId: stableId("ubo-adaptive-evaluation", { sessionId: session.sessionId, reason, sequence: session.snapshots.length + 1 }) },
      resolutionInputs: clone(session.resolutionInputs),
      ...(previous ? { decisionHistory: clone(session.decisionHistory), expectedHeadSnapshotId: previous.snapshot.snapshotId, supersessionReason: reason } : {}),
    });
    session.caseState = result.caseState;
    session.decisionHistory = clone(result.decisionHistory);
    session.snapshots.push({
      sequence: session.snapshots.length + 1,
      reason,
      predecessorSnapshotId: previous?.snapshot.snapshotId || null,
      snapshot: clone(result.decisionSnapshot),
      plan: clone(result.resolutionPlan),
      journey: clone(result.journeyProjection),
      graph: clone(result.ownershipGraphProjection),
    });
    session.pendingDecisionTargets = { candidateParties: [], candidateClaims: [] };
    session.phase = "JOURNEY_READY";
    session.adaptiveView = adaptiveView(currentEntry(session), session);
    session.shadowAutoEligibility = shadowEligibility(session);
    operationEvent(session, "SNAPSHOT_CREATED", {
      snapshotId: result.decisionSnapshot.snapshotId,
      predecessorSnapshotId: previous?.snapshot.snapshotId || null,
      reason,
      customerPath: session.adaptiveView.path,
    });
    return session;
  }

  async function startCase({ caseInput, caseContext, sourceMode, sourceIdentity, operationId, startedAt } = {}) {
    assertObject(caseInput, "caseInput");
    assertObject(caseContext, "caseContext");
    assertString(operationId, "operationId");
    if (!Object.values(SOURCE_MODE).includes(sourceMode)) throw new TypeError("sourceMode is unsupported");
    const at = startedAt || nowIso(clock);
    const request = {
      contractVersion: CAPABILITY_CONTRACT_VERSION,
      requestId: stableId("ubo-adaptive-discovery-request", { operationId, subject: caseInput.subjectReference }),
      caseId: caseInput.caseId,
      subject: clone(caseInput.subjectReference),
      informationNeeds: [{ informationNeedId: "INITIAL_OWNERSHIP_AND_CONTROL", concepts: ["OWNERSHIP_STRUCTURE", "CONTROL_RIGHTS"] }],
    };
    const session = {
      contractVersion: ADAPTIVE_JOURNEY_SESSION_V1,
      coordinatorContractVersion: ADAPTIVE_JOURNEY_COORDINATOR_V1,
      sessionId: stableId("ubo-adaptive-session", { caseId: caseInput.caseId, sourceIdentity }),
      caseId: caseInput.caseId,
      company: clone(caseInput.subjectReference),
      caseContext: clone(caseContext),
      sourceMode,
      sourceIdentity: clone(sourceIdentity || {}),
      phase: "RESEARCH_RUNNING",
      caseState: null,
      pendingDecisionTargets: { candidateParties: [], candidateClaims: [] },
      decisionHistory: [],
      resolutionInputs: {},
      snapshots: [],
      sourceRecords: [],
      decisionAudit: [],
      customerActivity: [],
      evidenceHandoffs: [],
      delegationHandoffs: [],
      exceptionRounds: [],
      operationTrace: [],
      executionBudget: { ...configuredLimits, usedCalls: 0, usedCostUnits: 0, startedAt: at },
      adaptiveView: null,
      shadowAutoEligibility: null,
      resumeSafety: { browserLocalOnly: true, authMaterialPersisted: false, sourceBytesPersisted: false },
      productionAuthorized: false,
    };
    operationEvent(session, "INITIAL_RESEARCH_AUTHORISED", { operationId, requestId: request.requestId, potentialCostUnits: 1 });
    ensureBudget(session);
    const result = await discoveryService.discover(clone(request));
    recordSource(session, "DISCOVERY", request, result, operationId);
    operationEvent(session, "INITIAL_RESEARCH_COMPLETED", { operationId, outcome: result.outcome.state, candidateFactCount: result.candidateFacts.length });
    const intaken = decisionApplication.intake({ contractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V3, caseInput, capabilityResult: result, operationId, recordedAt: at });
    updateAfterApplication(session, intaken);
    if (session.pendingDecisionTargets.candidateParties.length || session.pendingDecisionTargets.candidateClaims.length) {
      session.phase = "EXPLICIT_REVIEW_REQUIRED";
      operationEvent(session, "EXPLICIT_DECISIONS_REQUIRED", { identityCount: session.pendingDecisionTargets.candidateParties.length, claimCount: session.pendingDecisionTargets.candidateClaims.length });
      return clone(session);
    }
    if (result.candidateFacts.length === 0) {
      session.phase = [CAPABILITY_OUTCOME_STATE.FAILED, CAPABILITY_OUTCOME_STATE.UNAVAILABLE].includes(result.outcome.state)
        ? "OPERATIONAL_RECOVERY_REQUIRED" : "REVIEW_REQUIRED";
      session.shadowAutoEligibility = shadowEligibility(session);
      session.adaptiveView = adaptiveView(null, session);
      session.adaptiveView.headline = session.phase === "OPERATIONAL_RECOVERY_REQUIRED"
        ? "Research could not complete — no ownership conclusion was made"
        : "Research was incomplete — review the recorded limitation";
      session.adaptiveView.reasonCodes = [session.phase];
      return clone(session);
    }
    return clone(evaluateCurrent(session, { evaluatedAt: at, reason: "INITIAL_RESEARCH" }));
  }

  function applyDecisions({ session: supplied, entityRegistrations = [], identityDecisions = [], claimAdjudications = [], executionContext, recordedAt, nextResolutionInputs } = {}) {
    const session = validateSession(supplied);
    assertObject(executionContext, "executionContext");
    if (executionContext.mode !== "EXPLICIT_REVIEW") {
      throw new TypeError("UAJ-01 supports explicit review only; automatic decisions remain a governed future executor");
    }
    const at = recordedAt || nowIso(clock);
    const result = decisionApplication.applyDecisions({ contractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V3, caseState: session.caseState, entityRegistrations, identityDecisions, claimAdjudications });
    updateAfterApplication(session, result);
    if (nextResolutionInputs !== undefined) {
      assertObject(nextResolutionInputs, "nextResolutionInputs");
      session.resolutionInputs = clone(nextResolutionInputs);
      operationEvent(session, "STALE_RESOLUTION_INPUTS_RETIRED_AFTER_DECISION", {});
    }
    session.decisionAudit.push({
      decisionExecutionMode: "EXPLICIT_REVIEW",
      actor: clone(executionContext.actor),
      authorityReference: clone(executionContext.authorityReference || null),
      sourceReferences: clone(executionContext.sourceReferences || []),
      recordedAt: at,
      identityDecisionIds: identityDecisions.map(({ decisionId }) => decisionId),
      claimDecisionIds: claimAdjudications.map(({ decisionId }) => decisionId),
    });
    operationEvent(session, "EXPLICIT_DECISIONS_APPLIED", { recordedAt: at, identityCount: identityDecisions.length, claimCount: claimAdjudications.length });
    if (session.pendingDecisionTargets.candidateParties.length || session.pendingDecisionTargets.candidateClaims.length) {
      session.phase = "EXPLICIT_REVIEW_REQUIRED";
      return clone(session);
    }
    return clone(evaluateCurrent(session, { evaluatedAt: at, reason: session.snapshots.length ? "REVIEW_DECISION" : "INITIAL_REVIEW_DECISION" }));
  }

  function submitCustomerAction({ session: supplied, customerAction, operationId } = {}) {
    const session = validateSession(supplied);
    assertString(operationId, "operationId");
    const prior = session.customerActivity.find((item) => item.operationId === operationId);
    if (prior) return clone(session);
    const entry = currentEntry(session);
    if (!entry) throw new TypeError("A pinned journey is required before customer input");
    const result = decisionApplication.applyCustomerInput({ contractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V3, caseState: session.caseState, sourceDecisionSnapshot: entry.snapshot, sourceResolutionPlan: entry.plan, customerAction, operationId });
    session.customerActivity.push({ operationId, customerInputId: result.customerActionResult.customerInputId, actionType: customerAction.actionType, submittedAt: customerAction.submittedAt, sourceSnapshotId: entry.snapshot.snapshotId, status: "RECORDED" });
    if (customerAction.actionType === CUSTOMER_ACTION_TYPE_V2.CONFIRM_ESTABLISHED_INFORMATION) {
      const bundle = entry.journey.customerWorkBundles.find(({ bundleId }) => bundleId === customerAction.bundleId);
      const permitted = bundle?.permittedSemanticActions.find(({ sourceResolutionActionId }) => sourceResolutionActionId === customerAction.resolutionActionId);
      session.resolutionInputs.resolutionAttempts = [...(session.resolutionInputs.resolutionAttempts || []), {
        informationNeedIds: clone(customerAction.informationNeedIds),
        semanticActionType: permitted?.sourceSemanticActionType || "CONFIRM_ESTABLISHED_INFORMATION",
        capabilityOutcomeState: "NO_DATA",
        final: true,
        reasonCode: "CUSTOMER_CONFIRMATION_RECORDED_NEED_REMAINS_SEPARATELY_EVALUATED",
      }];
    }
    updateAfterApplication(session, result);
    operationEvent(session, "CUSTOMER_INPUT_RECORDED", { operationId, actionType: customerAction.actionType, customerInputId: result.customerActionResult.customerInputId });
    if (result.customerActionResult.delegationHandoff) {
      session.delegationHandoffs.push(clone(result.customerActionResult.delegationHandoff));
      session.phase = "DELEGATION_HANDOFF_PENDING";
      session.customerActivity.at(-1).status = "DELEGATION_HANDOFF_PENDING";
      session.adaptiveView = {
        ...adaptiveView(entry, session),
        path: ADAPTIVE_PATH.WAIT_REVIEW,
        headline: "Waiting for the scoped delegated response",
        currentTask: null,
        reasonCodes: ["HOST_DELEGATION_HANDOFF_PENDING"],
      };
      operationEvent(session, "DELEGATION_HANDOFF_PREPARED", {
        delegationId: result.customerActionResult.delegationHandoff.delegationId,
        authorizationGranted: false,
        workCompleted: false,
      });
      return clone(session);
    }
    if (session.pendingDecisionTargets.candidateParties.length || session.pendingDecisionTargets.candidateClaims.length || result.customerActionResult.correctionTargets?.length) {
      session.phase = "EXPLICIT_REVIEW_REQUIRED";
      session.customerActivity.at(-1).status = "EXPLICIT_REVIEW_REQUIRED";
      return clone(session);
    }
    session.customerActivity.at(-1).status = "APPLIED_AND_EVALUATED";
    return clone(evaluateCurrent(session, { evaluatedAt: customerAction.submittedAt, reason: "CUSTOMER_INPUT" }));
  }

  function refreshResolutionInputs({ session: supplied, resolutionInputs, reason = "HOST_CAPABILITY_CONFIGURATION", evaluatedAt } = {}) {
    const session = validateSession(supplied);
    if (session.pendingDecisionTargets.candidateParties.length || session.pendingDecisionTargets.candidateClaims.length) {
      throw new TypeError("Explicit decisions must be completed before refreshing the pinned plan");
    }
    assertObject(resolutionInputs, "resolutionInputs");
    session.resolutionInputs = clone(resolutionInputs);
    operationEvent(session, "RESOLUTION_INPUTS_UPDATED", { reason });
    return clone(evaluateCurrent(session, { evaluatedAt: evaluatedAt || nowIso(clock), reason: "PLANNING_CONTEXT_CHANGED" }));
  }

  function buildStructuredOwnershipAction({ session: supplied, owner, percentage, submittedAt, actor }) {
    const session = validateSession(supplied);
    const entry = currentEntry(session);
    const task = session.adaptiveView.currentTask;
    const bundle = entry.journey.customerWorkBundles.find(({ bundleId }) => bundleId === task?.bundleId);
    const permitted = bundle?.permittedSemanticActions.find(({ actionType, executable }) => actionType === CUSTOMER_ACTION_TYPE_V2.SUBMIT_STRUCTURED_RELATIONSHIP && executable);
    if (!bundle || !permitted) throw new TypeError("The pinned journey does not permit structured ownership input");
    const at = submittedAt || nowIso(clock);
    const targetEntityId = bundle.canonicalSubject.entityIds[0];
    const localPartyKey = stableId("ubo-adaptive-customer-owner", { owner, targetEntityId });
    return actionFor(entry, bundle, permitted, CUSTOMER_ACTION_TYPE_V2.SUBMIT_STRUCTURED_RELATIONSHIP, {
      relationships: [{
        localPartyKey, owner: { localPartyKey, ...clone(owner) }, targetEntityId,
        concept: "SHARE_OWNERSHIP", direction: "OWNER_TO_TARGET", relationshipType: "ECONOMIC_OWNERSHIP",
        measurement: { type: "EXACT", value: percentage }, assertionState: "CURRENT", asAtDate: at,
      }],
    }, actor, at);
  }

  function buildConfirmationAction({ session: supplied, submittedAt, actor }) {
    const session = validateSession(supplied);
    const entry = currentEntry(session);
    const task = session.adaptiveView.currentTask;
    const bundle = entry.journey.customerWorkBundles.find(({ bundleId }) => bundleId === task?.bundleId);
    const permitted = bundle?.permittedSemanticActions.find(({ actionType, executable }) => actionType === CUSTOMER_ACTION_TYPE_V2.CONFIRM_ESTABLISHED_INFORMATION && executable);
    if (!bundle || !permitted) throw new TypeError("The pinned journey does not permit confirmation");
    const at = submittedAt || nowIso(clock);
    return actionFor(entry, bundle, permitted, CUSTOMER_ACTION_TYPE_V2.CONFIRM_ESTABLISHED_INFORMATION, {
      confirmation: "CONFIRMED",
      establishedRelationshipIds: bundle.knownInformation.relationships.map(({ relationshipId }) => relationshipId),
      establishedClaimIds: bundle.knownInformation.relationships.flatMap(({ supportingClaimIds }) => supportingClaimIds),
    }, actor, at);
  }

  function buildDelegationAction({ session: supplied, delegateReference, delegateCapacity, requestedWorkScope, submittedAt, actor } = {}) {
    const session = validateSession(supplied);
    const entry = currentEntry(session);
    const task = session.adaptiveView.currentTask;
    const bundle = entry.journey.customerWorkBundles.find(({ bundleId }) => bundleId === task?.bundleId);
    const permitted = bundle?.permittedSemanticActions.find(({ actionType, executable }) => actionType === CUSTOMER_ACTION_TYPE_V2.DELEGATE_CUSTOMER_WORK && executable);
    if (!bundle || !permitted) throw new TypeError("The pinned journey does not permit delegation");
    const at = submittedAt || nowIso(clock);
    return actionFor(entry, bundle, permitted, CUSTOMER_ACTION_TYPE_V2.DELEGATE_CUSTOMER_WORK, {
      delegateReference,
      delegateCapacity,
      requestedWorkScope,
      informationAsAtExpectation: at,
      correlationId: stableId("ubo-adaptive-delegation", { sessionId: session.sessionId, bundleId: bundle.bundleId, delegateReference }),
    }, actor, at);
  }

  async function useExistingArtifact({ session: supplied, artifactEvidenceReferences, operationId, actor, submittedAt } = {}) {
    if (!extractionService || typeof extractionService.extract !== "function") throw new TypeError("No ExtractionService is configured");
    const session = validateSession(supplied);
    const entry = currentEntry(session);
    const task = session.adaptiveView.currentTask;
    const bundle = entry.journey.customerWorkBundles.find(({ bundleId }) => bundleId === task?.bundleId);
    const permitted = bundle?.permittedSemanticActions.find(({ actionType, executable }) => actionType === CUSTOMER_ACTION_TYPE_V2.REQUEST_EXTERNAL_EVIDENCE && executable);
    if (!bundle || !permitted || !bundle.evidenceHandoff) throw new TypeError("The pinned journey does not permit an existing Artifact response");
    const at = submittedAt || nowIso(clock);
    const customerAction = actionFor(entry, bundle, permitted, CUSTOMER_ACTION_TYPE_V2.REQUEST_EXTERNAL_EVIDENCE, {
      requestCorrelationId: stableId("ubo-adaptive-evidence-correlation", { sessionId: session.sessionId, operationId }),
      evidenceCategories: clone(bundle.evidenceHandoff.semanticEvidenceCategories),
      requestedConcepts: clone(bundle.evidenceHandoff.requestedConcepts),
      informationAsAtDate: at,
    }, actor, at);
    const accepted = decisionApplication.applyCustomerInput({ contractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V3, caseState: session.caseState, sourceDecisionSnapshot: entry.snapshot, sourceResolutionPlan: entry.plan, customerAction, operationId: `${operationId}:handoff` });
    const handoff = accepted.customerActionResult.externalEvidenceHandoff;
    if (!handoff) throw new TypeError("Decision Application did not produce the expected Evidence handoff");
    const request = {
      contractVersion: CAPABILITY_CONTRACT_VERSION,
      requestId: stableId("ubo-adaptive-extraction-request", { operationId, handoffId: handoff.handoffId }),
      caseId: session.caseId,
      informationNeeds: handoff.informationNeedIds.map((informationNeedId) => ({ informationNeedId, concepts: clone(handoff.requestedConcepts) })),
      artifactEvidenceReferences: clone(artifactEvidenceReferences),
    };
    ensureBudget(session);
    const result = await extractionService.extract(clone(request));
    recordSource(session, "EXISTING_ARTIFACT_EXTRACTION", request, result, operationId);
    session.evidenceHandoffs.push({ handoff: clone(handoff), artifactEvidenceReferences: clone(artifactEvidenceReferences), extractionRequestId: request.requestId, outcome: clone(result.outcome), rawBytesAccepted: false });
    operationEvent(session, "SOURCE_REVIEWED_ARTIFACT_INTERPRETED", { operationId, requestId: request.requestId, outcome: result.outcome.state, candidateFactCount: result.candidateFacts.length });
    const intaken = decisionApplication.intake({ contractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V3, caseState: accepted.caseState, capabilityResult: result, operationId: `${operationId}:intake`, recordedAt: at });
    updateAfterApplication(session, intaken);
    session.customerActivity.push({ operationId, customerInputId: accepted.customerActionResult.customerInputId, actionType: CUSTOMER_ACTION_TYPE_V2.REQUEST_EXTERNAL_EVIDENCE, submittedAt: at, sourceSnapshotId: entry.snapshot.snapshotId, status: result.candidateFacts.length ? "EXPLICIT_REVIEW_REQUIRED" : "RECORDED_WITHOUT_CANDIDATES" });
    if (session.pendingDecisionTargets.candidateParties.length || session.pendingDecisionTargets.candidateClaims.length) {
      session.phase = "EXPLICIT_REVIEW_REQUIRED";
      return clone(session);
    }
    return clone(evaluateCurrent(session, { evaluatedAt: at, reason: "EVIDENCE_RESULT" }));
  }

  async function executePermittedSystemActions({ session: supplied } = {}) {
    const session = validateSession(supplied);
    const entry = currentEntry(session);
    if (!entry) throw new TypeError("A pinned plan is required before system work");
    const actions = entry.plan.systemActions.filter(({ attemptEligibility }) => attemptEligibility?.eligible !== false)
      .sort((left, right) => {
        const priority = (action) => action.frontierEntityIds.some((entityId) => entityId !== session.caseContext.subjectEntityId) ? 0 : 1;
        return priority(left) - priority(right) || left.actionId.localeCompare(right.actionId);
      })
      .slice(0, Math.min(session.executionBudget.maxConcurrency, session.executionBudget.maxCalls - session.executionBudget.usedCalls));
    if (!actions.length) return clone(session);
    const operations = actions.map(async (action) => {
      ensureBudget(session);
      const targetId = action.targetReferences[0]?.entityId || action.frontierEntityIds[0];
      const party = session.sourceRecords.flatMap(({ capabilityResult }) => capabilityResult.candidateFacts)
        .flatMap((fact) => [fact.subject, fact.object].filter(Boolean)).find(({ entityId }) => entityId === targetId);
      if (!party) return { action, result: null, limitation: "TARGET_REFERENCE_NOT_AVAILABLE_TO_HOST" };
      const request = {
        contractVersion: CAPABILITY_CONTRACT_VERSION,
        requestId: stableId("ubo-adaptive-targeted-request", { caseId: session.caseId, actionId: action.actionId, fingerprint: entry.plan.materialInputFingerprint }),
        caseId: session.caseId,
        subject: clone(party),
        informationNeeds: entry.snapshot.decisionContent.informationNeedsV2.filter(({ needId }) => action.coveredInformationNeedIds.includes(needId)).map((need) => ({ informationNeedId: need.needId, requirementIds: clone(need.requiredByRequirementIds || []) })),
      };
      const result = await discoveryService.discover(clone(request));
      return { action, request, result };
    });
    const results = await Promise.all(operations);
    for (const item of results) {
      if (!item.result) {
        session.resolutionInputs.resolutionAttempts = [...(session.resolutionInputs.resolutionAttempts || []), { informationNeedIds: clone(item.action.coveredInformationNeedIds), semanticActionType: item.action.semanticActionType, capabilityOutcomeState: "UNAVAILABLE", final: true, limitation: item.limitation, materialInputFingerprint: entry.plan.materialInputFingerprint }];
        continue;
      }
      recordSource(session, "TARGETED_DISCOVERY", item.request, item.result, item.action.actionId);
      const intaken = decisionApplication.intake({ contractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V3, caseState: session.caseState, capabilityResult: item.result, operationId: item.action.actionId, recordedAt: nowIso(clock) });
      session.caseState = intaken.caseState;
      session.pendingDecisionTargets = clone(intaken.decisionTargets);
      session.resolutionInputs.resolutionAttempts = [...(session.resolutionInputs.resolutionAttempts || []), { informationNeedIds: clone(item.action.coveredInformationNeedIds), semanticActionType: item.action.semanticActionType, capabilityOutcomeState: item.result.outcome.state, final: ![CAPABILITY_OUTCOME_STATE.PARTIAL, CAPABILITY_OUTCOME_STATE.INCONCLUSIVE].includes(item.result.outcome.state), materialInputFingerprint: entry.plan.materialInputFingerprint }];
      operationEvent(session, "BOUNDED_SYSTEM_ACTION_COMPLETED", { actionId: item.action.actionId, outcome: item.result.outcome.state });
    }
    updateAfterApplication(session, { caseState: session.caseState, decisionTargets: session.pendingDecisionTargets });
    if (session.pendingDecisionTargets.candidateParties.length || session.pendingDecisionTargets.candidateClaims.length) {
      session.phase = "EXPLICIT_REVIEW_REQUIRED";
      return clone(session);
    }
    return clone(evaluateCurrent(session, { evaluatedAt: nowIso(clock), reason: "SYSTEM_CAPABILITY_RESULT" }));
  }

  function publishExceptionRound({ session: supplied, bundleIds, publishedAt, escalationReason = null } = {}) {
    const session = validateSession(supplied);
    const entry = currentEntry(session);
    if (!entry) throw new TypeError("A current plan is required to publish an exception round");
    const available = new Set(entry.journey.customerWorkBundles.map(({ bundleId }) => bundleId));
    if (!Array.isArray(bundleIds) || !bundleIds.length || bundleIds.some((id) => !available.has(id))) throw new TypeError("Exception round may contain only current permitted customer bundles");
    const routineRounds = session.exceptionRounds.filter(({ state }) => state !== "CANCELLED");
    const lowOrMedium = ["LOW", "MEDIUM"].includes(session.caseContext.riskLevel);
    if (lowOrMedium && routineRounds.length >= 1 && !escalationReason) throw new TypeError("A second LOW/MEDIUM exception round requires an analyst escalation reason");
    const semantic = {
      contractVersion: EXCEPTION_ROUND_V1, sequence: routineRounds.length + 1, bundleIds: [...new Set(bundleIds)].sort(),
      sourceSnapshotId: entry.snapshot.snapshotId, sourcePlanId: entry.plan.planId, materialInputFingerprint: entry.plan.materialInputFingerprint,
      publishedAt: publishedAt || nowIso(clock), publicationReason: "CURRENT_PERMITTED_MATERIAL_TASKS_CONSOLIDATED", escalationReason, state: "OPEN",
    };
    session.exceptionRounds.push({ roundId: stableId("ubo-adaptive-exception-round", semantic), ...semantic });
    operationEvent(session, "EXCEPTION_ROUND_PUBLISHED", { roundId: session.exceptionRounds.at(-1).roundId, sequence: semantic.sequence });
    return clone(session);
  }

  return Object.freeze({
    contractVersion: ADAPTIVE_JOURNEY_COORDINATOR_V1,
    decisionExecution: Object.freeze({ explicitReview: true, governedAutomaticExecutor: "NOT_ACTIVE_UAJ_01", shadowEligibilityOnly: true }),
    startCase, applyDecisions, submitCustomerAction, refreshResolutionInputs, buildStructuredOwnershipAction, buildConfirmationAction, buildDelegationAction,
    useExistingArtifact, executePermittedSystemActions, publishExceptionRound, validateSession,
  });
}

module.exports = Object.freeze({
  ADAPTIVE_JOURNEY_COORDINATOR_V1,
  ADAPTIVE_JOURNEY_SESSION_V1,
  ADAPTIVE_PATH,
  DEFAULT_LIMITS,
  EXCEPTION_ROUND_V1,
  ISSUE_CLASS,
  SHADOW_AUTO_ELIGIBILITY_V1,
  SOURCE_MODE,
  createAdaptiveJourneyCoordinator,
});
