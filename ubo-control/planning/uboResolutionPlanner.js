"use strict";

const { createHash } = require("node:crypto");
const {
  UBO_RESOLUTION_PLANNER_ERROR_CODE,
  UboResolutionPlannerError,
} = require("../errors");
const { cloneData, deepFreeze } = require("../internal/validation");
const { canonicalizeJson } = require("../policy/canonicalJson");
const {
  DECISION_SNAPSHOT_SCHEMA_VERSION,
  verifyDecisionSnapshot,
} = require("../domain/decisionSnapshot");
const { projectUboJourney } = require("../projection/uboJourneyProjection");

const UBO_RESOLUTION_PLAN_CONTRACT_VERSION = "ubo-resolution-plan-v1";
const UBO_RESOLUTION_PLANNER_VERSION = "ubo-low-friction-planner-v1";

const PLAN_STATE = Object.freeze({
  SYSTEM_RESOLUTION: "SYSTEM_RESOLUTION",
  CUSTOMER_RESOLUTION: "CUSTOMER_RESOLUTION",
  INTERNAL_REVIEW: "INTERNAL_REVIEW",
  COMPLETE: "COMPLETE",
  BLOCKED: "BLOCKED",
});

const WAVE_ACTOR = Object.freeze({
  SYSTEM: "SYSTEM",
  CUSTOMER: "CUSTOMER",
  INTERNAL_REVIEW: "INTERNAL_REVIEW",
  COMPLETE: "COMPLETE",
  BLOCKED: "BLOCKED",
});

const SYSTEM_STRATEGIES = new Set(["DISCOVERY", "EXISTING_EVIDENCE", "DETERMINISTIC_CALCULATION"]);
const CUSTOMER_STRATEGIES = new Set(["CUSTOMER_DOCUMENT", "CUSTOMER_QUESTION", "CUSTOMER_ATTESTATION"]);
const COMPLETE_TERMINAL_OUTCOMES = new Set(["RESOLVED", "RESOLVED_PROVISIONALLY", "RESOLVED_VIA_SMO_FALLBACK"]);
const SUBSTANTIVE_EXHAUSTION_STATES = new Set(["NO_DATA", "UNSUPPORTED", "INCONCLUSIVE", "PARTIAL"]);
const SUBSTANTIVE_EXHAUSTION_OUTCOMES = new Set(["NO_RESOLUTION", "PARTIALLY_SUCCEEDED", "SUCCEEDED"]);

function plannerError(code, message, cause) {
  return new UboResolutionPlannerError(message, { code, cause });
}

function stableId(prefix, value) {
  const hash = createHash("sha256").update(canonicalizeJson(value), "utf8").digest("hex").slice(0, 24);
  return `${prefix}:${hash}`;
}

function uniqueStrings(values) {
  return [...new Set((values || []).filter((value) => typeof value === "string" && value.length > 0))].sort();
}

function canonicalSort(values) {
  return [...(values || [])].map(cloneData).sort((left, right) => canonicalizeJson(left).localeCompare(canonicalizeJson(right)));
}

function templateReference(option) {
  if (!option.actionTemplateReference) return null;
  return {
    actionTemplateId: option.actionTemplateReference.actionTemplateId,
    contentStatus: option.actionTemplateReference.contentStatus || null,
    sourceReference: option.actionTemplateReference.sourceReference || null,
  };
}

function actionType(strategy) {
  return {
    DISCOVERY: "DISCOVER_INFORMATION",
    EXISTING_EVIDENCE: "INTERPRET_EXISTING_ARTIFACT",
    DETERMINISTIC_CALCULATION: "RECALCULATE_FROM_ESTABLISHED_FACTS",
    CUSTOMER_DOCUMENT: "PROVIDE_TARGETED_EVIDENCE",
    CUSTOMER_QUESTION: "PROVIDE_MISSING_INFORMATION",
    CUSTOMER_ATTESTATION: "CONFIRM_ESTABLISHED_INFORMATION",
    ANALYST_REVIEW: "ANALYST_REVIEW",
  }[strategy] || strategy;
}

function optionAction(option, need, actor) {
  const identity = {
    actor,
    strategy: option.strategy,
    subjectEntityId: need.subjectEntityId || null,
    relationshipId: need.relationshipId || null,
    concept: need.concept,
    attribute: need.attribute || null,
    acceptableEvidenceTypes: uniqueStrings(option.acceptableEvidenceTypes),
    actionTemplate: templateReference(option),
  };
  const rationaleCodes = actor === WAVE_ACTOR.SYSTEM
    ? uniqueStrings(["NO_CUSTOMER_FRICTION", "SYSTEM_RESOLUTION_AVAILABLE",
      option.strategy === "EXISTING_EVIDENCE" ? "USES_ALREADY_HELD_EVIDENCE" : undefined])
    : uniqueStrings(["CUSTOMER_INPUT_REQUIRED_BY_POLICY",
      ["CUSTOMER_QUESTION", "CUSTOMER_ATTESTATION"].includes(option.strategy) ? "LIGHTWEIGHT_RESPONSE_SUFFICIENT" : undefined,
      option.strategy === "CUSTOMER_DOCUMENT" ? "DOCUMENTARY_EVIDENCE_REQUIRED" : undefined]);
  return {
    actionId: stableId("resolution-action", identity),
    actor,
    actionType: actionType(option.strategy),
    strategy: option.strategy,
    resolutionOptionIds: [option.optionId],
    informationNeedIds: [need.needId],
    requirementIds: uniqueStrings([...(option.requirementIds || []), ...(need.requiredBy || [])]),
    subject: {
      entityId: need.subjectEntityId || null,
      relationshipId: need.relationshipId || null,
      concept: need.concept,
      attribute: need.attribute || null,
    },
    evidenceTypes: uniqueStrings(option.acceptableEvidenceTypes),
    actionTemplate: templateReference(option),
    rationaleCodes,
    graphLinks: {
      entityIds: uniqueStrings([need.subjectEntityId]),
      relationshipIds: uniqueStrings([need.relationshipId]),
      informationNeedIds: [need.needId],
    },
  };
}

function coalesceActions(actions) {
  const grouped = new Map();
  actions.forEach((action) => {
    const identity = {
      actor: action.actor,
      actionType: action.actionType,
      strategy: action.strategy,
      subject: action.subject,
      evidenceTypes: action.evidenceTypes,
      actionTemplate: action.actionTemplate,
    };
    const key = canonicalizeJson(identity);
    if (!grouped.has(key)) grouped.set(key, { ...cloneData(action), actionId: stableId("resolution-action", identity) });
    else {
      const current = grouped.get(key);
      ["resolutionOptionIds", "informationNeedIds", "requirementIds", "rationaleCodes"].forEach((field) => {
        current[field] = uniqueStrings([...current[field], ...action[field]]);
      });
      ["entityIds", "relationshipIds", "informationNeedIds"].forEach((field) => {
        current.graphLinks[field] = uniqueStrings([...current.graphLinks[field], ...action.graphLinks[field]]);
      });
    }
  });
  return [...grouped.values()].sort((left, right) => left.actionId.localeCompare(right.actionId));
}

function attemptsFor(option, attempts) {
  return attempts.filter((attempt) => attempt.strategy === option.strategy
    && (attempt.resolutionOptionId === option.optionId || (attempt.informationNeedIds || []).includes(option.informationNeedId)));
}

function isSubstantivelyExhausted(option, attempts) {
  return attemptsFor(option, attempts).some((attempt) => {
    if (["FAILED", "UNAVAILABLE"].includes(attempt.capabilityOutcomeState)) return false;
    return SUBSTANTIVE_EXHAUSTION_STATES.has(attempt.capabilityOutcomeState)
      || SUBSTANTIVE_EXHAUSTION_OUTCOMES.has(attempt.outcome);
  });
}

function isOperationallyBlocked(option, attempts) {
  return attemptsFor(option, attempts).some(({ capabilityOutcomeState }) => ["FAILED", "UNAVAILABLE"].includes(capabilityOutcomeState));
}

function optionAlternative(option, need, reasonCode) {
  return {
    alternativeId: stableId("resolution-alternative", { optionId: option.optionId, reasonCode }),
    resolutionOptionId: option.optionId,
    strategy: option.strategy,
    applicabilityState: option.applicabilityState,
    informationNeedId: option.informationNeedId,
    requirementIds: uniqueStrings([...(option.requirementIds || []), ...(need?.requiredBy || [])]),
    acceptableEvidenceTypes: uniqueStrings(option.acceptableEvidenceTypes),
    actionTemplate: templateReference(option),
    deferredReasonCode: reasonCode,
  };
}

function customerChoice(options) {
  const applicable = options.filter(({ applicabilityState }) => applicabilityState === "APPLICABLE");
  const attestation = applicable.find(({ strategy }) => strategy === "CUSTOMER_ATTESTATION");
  if (attestation) return attestation;
  const question = applicable.find(({ strategy }) => strategy === "CUSTOMER_QUESTION");
  if (question) return question;
  return applicable.find(({ strategy }) => strategy === "CUSTOMER_DOCUMENT");
}

function customerBundles(actions, alternatives, journey) {
  const knownByPerson = new Map((journey.qualifyingPersonHandoff || [])
    .map((person) => [person.personEntityId, person.knownIdentityFields || []]));
  const grouped = new Map();
  actions.forEach((action) => {
    const family = action.subject.concept === "IDENTITY_ATTRIBUTE" ? "QUALIFYING_PERSON_IDENTITY"
      : action.subject.concept === "SENIOR_MANAGEMENT_CANDIDATE" ? "SENIOR_MANAGEMENT_PREPARATION"
        : "OWNERSHIP_AND_CONTROL";
    const identity = { subjectEntityId: action.subject.entityId || null, family };
    const key = canonicalizeJson(identity);
    if (!grouped.has(key)) grouped.set(key, { identity, actions: [] });
    grouped.get(key).actions.push(action);
  });
  return [...grouped.values()].map(({ identity, actions: items }) => {
    const needIds = uniqueStrings(items.flatMap(({ informationNeedIds }) => informationNeedIds));
    const requirementIds = uniqueStrings(items.flatMap(({ requirementIds }) => requirementIds));
    const knownFacts = canonicalSort(knownByPerson.get(identity.subjectEntityId) || []);
    const knownNames = new Set(knownFacts.map(({ field }) => field));
    const missingFacts = uniqueStrings(items.map(({ subject }) => subject.attribute || subject.concept))
      .filter((field) => !knownNames.has(field));
    const bundleAlternatives = alternatives.filter(({ informationNeedId }) => needIds.includes(informationNeedId));
    const rationaleCodes = uniqueStrings([
      "CUSTOMER_INPUT_REQUIRED_BY_POLICY",
      needIds.length > 1 ? "COALESCES_MULTIPLE_NEEDS" : undefined,
      items.some(({ actionType: type }) => type === "CONFIRM_ESTABLISHED_INFORMATION") ? "CONFIRMATION_PREFERRED_TO_REENTRY" : undefined,
    ]);
    return {
      bundleId: stableId("customer-resolution-bundle", identity),
      subject: { entityId: identity.subjectEntityId, family: identity.family },
      informationNeedIds: needIds,
      requirementIds,
      recommendedCustomerActions: coalesceActions(items),
      knownFacts,
      missingFacts,
      evidenceRequirements: uniqueStrings(items.flatMap(({ evidenceTypes }) => evidenceTypes)),
      expectedNeedsCovered: needIds,
      policyPermittedAlternatives: canonicalSort(bundleAlternatives),
      rationaleCodes,
      graphLinks: {
        entityIds: uniqueStrings(items.flatMap(({ graphLinks }) => graphLinks.entityIds)),
        relationshipIds: uniqueStrings(items.flatMap(({ graphLinks }) => graphLinks.relationshipIds)),
        informationNeedIds: needIds,
      },
    };
  }).sort((left, right) => left.bundleId.localeCompare(right.bundleId));
}

function operationalActions(journey, decision) {
  const intentsById = new Map((decision.actionIntents || []).map((intent) => [intent.actionIntentId, intent]));
  return (journey.systemWorkItems || []).filter(({ actionType: type }) => type === "OPERATIONAL_RETRY_OR_HOLD")
    .filter((item) => (intentsById.get(item.actionIntentId)?.constraints || []).includes("RETRYABLE"))
    .map((item) => ({
      actionId: stableId("resolution-action", { actionIntentId: item.actionIntentId, actionType: item.actionType }),
      actor: WAVE_ACTOR.SYSTEM,
      actionType: item.actionType,
      strategy: "OPERATIONAL_RETRY_OR_HOLD",
      resolutionOptionIds: [],
      informationNeedIds: cloneData(item.informationNeedIds),
      requirementIds: cloneData(item.requirementIds),
      subject: cloneData(item.subject),
      evidenceTypes: [],
      actionTemplate: null,
      rationaleCodes: uniqueStrings(["NO_CUSTOMER_FRICTION", "OPERATIONAL_RETRY_OR_HOLD"]),
      graphLinks: cloneData(item.graphLinks),
    }));
}

function internalActions(journey) {
  return (journey.internalReview.actionItems || []).map((item) => ({
    actionId: stableId("resolution-action", { actionIntentId: item.actionIntentId, actionType: item.actionType }),
    actor: WAVE_ACTOR.INTERNAL_REVIEW,
    actionType: item.actionType,
    informationNeedIds: cloneData(item.informationNeedIds),
    requirementIds: cloneData(item.requirementIds),
    subject: cloneData(item.subject),
    rationaleCodes: uniqueStrings(["CUSTOMER_WORK_COMPLETE", "HUMAN_INTERPRETATION_REQUIRED"]),
  })).sort((left, right) => left.actionId.localeCompare(right.actionId));
}

function validateLinks(content, plan) {
  const entityIds = new Set((content.reasoning.canonicalEntities || []).map(({ entityId }) => entityId));
  const relationshipIds = new Set((content.reasoning.graph.relationships || []).map(({ relationshipId }) => relationshipId));
  const needIds = new Set((content.decision.informationNeeds || []).map(({ needId }) => needId));
  const links = [
    ...(plan.recommendedWave.actions || []).map(({ graphLinks }) => graphLinks).filter(Boolean),
    ...(plan.recommendedWave.customerBundles || []).map(({ graphLinks }) => graphLinks),
  ];
  links.forEach((link) => {
    link.entityIds.forEach((id) => { if (!entityIds.has(id)) throw plannerError(UBO_RESOLUTION_PLANNER_ERROR_CODE.INCONSISTENT_DECISION_SNAPSHOT, "ResolutionPlan references an unknown canonical entity"); });
    link.relationshipIds.forEach((id) => { if (!relationshipIds.has(id)) throw plannerError(UBO_RESOLUTION_PLANNER_ERROR_CODE.INCONSISTENT_DECISION_SNAPSHOT, "ResolutionPlan references an unknown canonical relationship"); });
    link.informationNeedIds.forEach((id) => { if (!needIds.has(id)) throw plannerError(UBO_RESOLUTION_PLANNER_ERROR_CODE.INCONSISTENT_DECISION_SNAPSHOT, "ResolutionPlan references an unknown InformationNeed"); });
  });
}

function planUboResolution(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw plannerError(UBO_RESOLUTION_PLANNER_ERROR_CODE.MALFORMED_DECISION_SNAPSHOT, "Planner input must be a data object");
  }
  const unknown = Object.keys(input).filter((key) => !["contractVersion", "decisionSnapshot"].includes(key));
  if (unknown.length > 0) throw plannerError(UBO_RESOLUTION_PLANNER_ERROR_CODE.MALFORMED_DECISION_SNAPSHOT, `Unsupported planner input: ${unknown.sort().join(", ")}`);
  const contractVersion = input.contractVersion || UBO_RESOLUTION_PLAN_CONTRACT_VERSION;
  if (contractVersion !== UBO_RESOLUTION_PLAN_CONTRACT_VERSION) {
    throw plannerError(UBO_RESOLUTION_PLANNER_ERROR_CODE.UNSUPPORTED_CONTRACT_VERSION, `contractVersion must be ${UBO_RESOLUTION_PLAN_CONTRACT_VERSION}`);
  }
  if (!input.decisionSnapshot || typeof input.decisionSnapshot !== "object" || Array.isArray(input.decisionSnapshot)) {
    throw plannerError(UBO_RESOLUTION_PLANNER_ERROR_CODE.MALFORMED_DECISION_SNAPSHOT, "A DecisionSnapshot is required");
  }
  if (input.decisionSnapshot.snapshotSchemaVersion !== DECISION_SNAPSHOT_SCHEMA_VERSION) {
    throw plannerError(UBO_RESOLUTION_PLANNER_ERROR_CODE.UNSUPPORTED_DECISION_SNAPSHOT_SCHEMA, "DecisionSnapshot schema is not supported by this planning contract");
  }
  try {
    verifyDecisionSnapshot(input.decisionSnapshot);
  } catch (error) {
    throw plannerError(UBO_RESOLUTION_PLANNER_ERROR_CODE.DECISION_SNAPSHOT_VERIFICATION_FAILED, "DecisionSnapshot verification failed", error);
  }

  try {
    const content = input.decisionSnapshot.decisionContent;
    const decision = content.decision;
    const journey = projectUboJourney({ decisionSnapshot: input.decisionSnapshot });
    const openNeeds = (decision.informationNeeds || []).filter(({ state }) => state === "OPEN");
    const needsById = new Map(openNeeds.map((need) => [need.needId, need]));
    const attempts = content.reasoning.resolutionAttempts || [];
    const options = (decision.resolutionOptions || []).filter(({ informationNeedId }) => needsById.has(informationNeedId));
    const operationallyBlockedNeedIds = new Set((decision.operationalBlockers || []).flatMap(({ affectedInformationNeedIds }) => affectedInformationNeedIds || []));
    const systemActions = [];
    const customerActions = [];
    const deferredAlternatives = [];

    options.forEach((option) => {
      const need = needsById.get(option.informationNeedId);
      if (option.applicabilityState !== "APPLICABLE") {
        deferredAlternatives.push(optionAlternative(option, need, "NOT_CURRENTLY_ACTIONABLE"));
        return;
      }
      if (SYSTEM_STRATEGIES.has(option.strategy)) {
        if (operationallyBlockedNeedIds.has(need.needId) || isOperationallyBlocked(option, attempts)) deferredAlternatives.push(optionAlternative(option, need, "OPERATIONAL_RETRY_OR_HOLD"));
        else if (isSubstantivelyExhausted(option, attempts)) deferredAlternatives.push(optionAlternative(option, need, "SUBSTANTIVE_ATTEMPT_ALREADY_EXHAUSTED"));
        else systemActions.push(optionAction(option, need, WAVE_ACTOR.SYSTEM));
      }
    });

    const needsWithSystem = new Set([
      ...systemActions.flatMap(({ informationNeedIds }) => informationNeedIds),
      ...operationallyBlockedNeedIds,
    ]);
    openNeeds.forEach((need) => {
      const candidates = options.filter((option) => option.informationNeedId === need.needId
        && CUSTOMER_STRATEGIES.has(option.strategy) && option.applicabilityState === "APPLICABLE");
      const selected = customerChoice(candidates);
      candidates.forEach((option) => {
        if (!selected || option.optionId !== selected.optionId || needsWithSystem.has(need.needId)) {
          const reason = operationallyBlockedNeedIds.has(need.needId)
            ? "OPERATIONAL_FAILURE_NOT_CUSTOMER_REMEDIATION"
            : needsWithSystem.has(need.needId) ? "SYSTEM_WAVE_FIRST" : "LOWER_FRICTION_CUSTOMER_ROUTE_SELECTED";
          deferredAlternatives.push(optionAlternative(option, need, reason));
        }
      });
      if (selected && !needsWithSystem.has(need.needId)) customerActions.push(optionAction(selected, need, WAVE_ACTOR.CUSTOMER));
    });

    const retries = operationalActions(journey, decision);
    const recommendedSystem = coalesceActions([...systemActions, ...retries]);
    const allCustomerAlternatives = canonicalSort(deferredAlternatives);
    const bundles = customerBundles(coalesceActions(customerActions), allCustomerAlternatives, journey);
    const optionReviewActions = options.filter(({ strategy, applicabilityState }) => strategy === "ANALYST_REVIEW" && applicabilityState === "APPLICABLE")
      .map((option) => optionAction(option, needsById.get(option.informationNeedId), WAVE_ACTOR.INTERNAL_REVIEW));
    const reviewActions = canonicalSort([...internalActions(journey), ...coalesceActions(optionReviewActions)]);
    const terminalOutcome = decision.terminal.terminalOutcome;
    const specialist = terminalOutcome === "SPECIALIST_REVIEW_REQUIRED" || reviewActions.some(({ actionType: type }) => type === "SPECIALIST_REVIEW");
    let state;
    let actor;
    let actions = [];
    let customerResolutionBundles = [];
    let rationaleCodes;

    if (COMPLETE_TERMINAL_OUTCOMES.has(terminalOutcome)) {
      state = PLAN_STATE.COMPLETE; actor = WAVE_ACTOR.COMPLETE; rationaleCodes = ["ALREADY_RESOLVED"];
    } else if (specialist) {
      state = PLAN_STATE.INTERNAL_REVIEW; actor = WAVE_ACTOR.INTERNAL_REVIEW; actions = reviewActions; rationaleCodes = ["HUMAN_INTERPRETATION_REQUIRED", "SPECIALIST_REVIEW_REQUIRED"];
    } else if (decision.terminal.orchestrationState === "TERMINAL") {
      state = PLAN_STATE.BLOCKED; actor = WAVE_ACTOR.BLOCKED; rationaleCodes = ["TERMINAL_POLICY_STATE"];
    } else if (recommendedSystem.length > 0) {
      state = PLAN_STATE.SYSTEM_RESOLUTION; actor = WAVE_ACTOR.SYSTEM; actions = recommendedSystem; rationaleCodes = ["NO_CUSTOMER_FRICTION", "SYSTEM_RESOLUTION_AVAILABLE", "RERESOLVE_AFTER_SYSTEM_WAVE"];
    } else if (bundles.length > 0) {
      state = PLAN_STATE.CUSTOMER_RESOLUTION; actor = WAVE_ACTOR.CUSTOMER; actions = bundles.flatMap(({ recommendedCustomerActions }) => recommendedCustomerActions); customerResolutionBundles = bundles; rationaleCodes = uniqueStrings(["CUSTOMER_INPUT_REQUIRED_BY_POLICY", bundles.length > 0 ? "MINIMAL_CUSTOMER_RESOLUTION_SET" : undefined]);
    } else if (reviewActions.length > 0 || journey.internalReview.reviewRequirements.some(({ state: reviewState }) => reviewState === "PENDING") || journey.internalReview.fallback.candidate?.isCandidate === true) {
      state = PLAN_STATE.INTERNAL_REVIEW; actor = WAVE_ACTOR.INTERNAL_REVIEW; actions = reviewActions; rationaleCodes = ["CUSTOMER_WORK_COMPLETE", "HUMAN_INTERPRETATION_REQUIRED"];
    } else {
      state = PLAN_STATE.BLOCKED; actor = WAVE_ACTOR.BLOCKED; rationaleCodes = ["NO_CURRENTLY_EXECUTABLE_ACTION"];
    }

    const selectedOptionIds = new Set(actions.flatMap(({ resolutionOptionIds }) => resolutionOptionIds || []));
    options.filter((option) => !selectedOptionIds.has(option.optionId)
      && !deferredAlternatives.some(({ resolutionOptionId }) => resolutionOptionId === option.optionId))
      .forEach((option) => deferredAlternatives.push(optionAlternative(option, needsById.get(option.informationNeedId), "LATER_WAVE_OR_ALTERNATIVE")));
    const plan = {
      contractVersion: UBO_RESOLUTION_PLAN_CONTRACT_VERSION,
      plannerVersion: UBO_RESOLUTION_PLANNER_VERSION,
      snapshotHash: input.decisionSnapshot.decisionContentHash,
      snapshotId: input.decisionSnapshot.snapshotId,
      state,
      recommendedWave: { actor, actions: canonicalSort(actions), customerBundles: canonicalSort(customerResolutionBundles) },
      deferredAlternatives: canonicalSort(deferredAlternatives),
      rationale: { codes: uniqueStrings(rationaleCodes), terminalOutcome: terminalOutcome || null, replanAfterWave: [PLAN_STATE.SYSTEM_RESOLUTION, PLAN_STATE.CUSTOMER_RESOLUTION].includes(state) },
      summary: {
        openInformationNeeds: openNeeds.length,
        recommendedActions: actions.length,
        customerBundles: customerResolutionBundles.length,
        deferredAlternatives: deferredAlternatives.length,
        priorResolutionAttempts: attempts.length,
      },
    };
    validateLinks(content, plan);
    return deepFreeze(plan);
  } catch (error) {
    if (error instanceof UboResolutionPlannerError) throw error;
    throw plannerError(UBO_RESOLUTION_PLANNER_ERROR_CODE.INCONSISTENT_DECISION_SNAPSHOT, "DecisionSnapshot could not be planned consistently", error);
  }
}

module.exports = {
  PLAN_STATE,
  UBO_RESOLUTION_PLAN_CONTRACT_VERSION,
  UBO_RESOLUTION_PLANNER_VERSION,
  planUboResolution,
};
