"use strict";

const { cloneData, deepFreeze, fail } = require("../internal/validation");
const { hashArtifact } = require("../internal/phasedArtifact");

const RESOLUTION_PLAN_COMPAT_CONTRACT_VERSION = "ubo-resolution-plan-v1-compat";
const RESOLUTION_PLAN_COMPAT_PLANNER_VERSION = "ubo-resolution-plan-v1-compat";
const SYSTEM_STRATEGIES = new Set(["DISCOVERY", "EXISTING_EVIDENCE", "DETERMINISTIC_CALCULATION"]);
const CUSTOMER_STRATEGIES = new Set(["CUSTOMER_DOCUMENT", "CUSTOMER_QUESTION", "CUSTOMER_ATTESTATION"]);
const COMPLETE_OUTCOMES = new Set(["RESOLVED", "RESOLVED_PROVISIONALLY", "RESOLVED_VIA_SMO_FALLBACK"]);

function unique(values) { return [...new Set((values || []).filter((value) => typeof value === "string" && value.length > 0))].sort(); }
function sortById(values, field) { return [...values].map(cloneData).sort((a, b) => String(a[field]).localeCompare(String(b[field]))); }

function optionExhausted(option, attempts) {
  return attempts.some((attempt) => attempt.strategy === option.strategy
    && (attempt.resolutionOptionId === option.optionId || (attempt.informationNeedIds || []).includes(option.informationNeedId))
    && !["FAILED", "UNAVAILABLE"].includes(attempt.capabilityOutcomeState)
    && (["NO_DATA", "UNSUPPORTED", "INCONCLUSIVE", "PARTIAL"].includes(attempt.capabilityOutcomeState)
      || ["NO_RESOLUTION", "PARTIALLY_SUCCEEDED", "SUCCEEDED"].includes(attempt.outcome)));
}

function preferredCustomerOption(options) {
  return ["CUSTOMER_ATTESTATION", "CUSTOMER_QUESTION", "CUSTOMER_DOCUMENT"]
    .map((strategy) => options.find((option) => option.strategy === strategy && option.applicabilityState === "APPLICABLE"))
    .find(Boolean);
}

function action(option, need, actor) {
  const actionTypes = { DISCOVERY: "DISCOVER_INFORMATION", EXISTING_EVIDENCE: "INTERPRET_EXISTING_ARTIFACT", DETERMINISTIC_CALCULATION: "RECALCULATE_FROM_ESTABLISHED_FACTS", CUSTOMER_DOCUMENT: "PROVIDE_TARGETED_EVIDENCE", CUSTOMER_QUESTION: "PROVIDE_MISSING_INFORMATION", CUSTOMER_ATTESTATION: "CONFIRM_ESTABLISHED_INFORMATION", ANALYST_REVIEW: "ANALYST_REVIEW" };
  return {
    actionId: `resolution-action:${hashArtifact({ actor, optionId: option.optionId, needId: need.needId }).slice(7, 31)}`,
    actor,
    actionType: actionTypes[option.strategy] || option.strategy,
    strategy: option.strategy,
    resolutionOptionIds: [option.optionId],
    informationNeedIds: [need.needId],
    requirementIds: unique([...(option.requirementIds || []), ...(need.requiredBy || [])]),
    subject: { entityId: need.subjectEntityId || null, relationshipId: need.relationshipId || null, concept: need.concept, attribute: need.attribute || null },
    evidenceTypes: unique(option.acceptableEvidenceTypes),
    actionTemplate: option.actionTemplateReference || null,
    rationaleCodes: actor === "SYSTEM" ? ["NO_CUSTOMER_FRICTION", "SYSTEM_RESOLUTION_AVAILABLE"] : ["CUSTOMER_INPUT_REQUIRED_BY_POLICY"],
    graphLinks: { entityIds: unique([need.subjectEntityId]), relationshipIds: unique([need.relationshipId]), informationNeedIds: [need.needId] },
  };
}

function customerBundles(actions, alternatives) {
  const groups = new Map();
  actions.forEach((item) => {
    const family = item.subject.concept === "IDENTITY_ATTRIBUTE" ? "QUALIFYING_PERSON_IDENTITY"
      : item.subject.concept === "SENIOR_MANAGEMENT_CANDIDATE" ? "SENIOR_MANAGEMENT_PREPARATION" : "OWNERSHIP_AND_CONTROL";
    const key = `${item.subject.entityId || ""}|${family}`;
    if (!groups.has(key)) groups.set(key, { entityId: item.subject.entityId || null, family, actions: [] });
    groups.get(key).actions.push(item);
  });
  return [...groups.values()].map((group) => {
    const informationNeedIds = unique(group.actions.flatMap((item) => item.informationNeedIds));
    const semantic = { subjectEntityId: group.entityId, family: group.family };
    return {
      bundleId: `customer-resolution-bundle:${hashArtifact(semantic).slice(7, 31)}`,
      subject: { entityId: group.entityId, family: group.family },
      informationNeedIds,
      requirementIds: unique(group.actions.flatMap((item) => item.requirementIds)),
      recommendedCustomerActions: sortById(group.actions, "actionId"),
      knownFacts: [],
      missingFacts: unique(group.actions.map(({ subject }) => subject.attribute || subject.concept)),
      evidenceRequirements: unique(group.actions.flatMap(({ evidenceTypes }) => evidenceTypes)),
      expectedNeedsCovered: informationNeedIds,
      policyPermittedAlternatives: alternatives.filter(({ informationNeedId }) => informationNeedIds.includes(informationNeedId)),
      rationaleCodes: unique(["CUSTOMER_INPUT_REQUIRED_BY_POLICY", informationNeedIds.length > 1 ? "COALESCES_MULTIPLE_NEEDS" : undefined]),
      graphLinks: {
        entityIds: unique(group.actions.flatMap(({ graphLinks }) => graphLinks.entityIds)),
        relationshipIds: unique(group.actions.flatMap(({ graphLinks }) => graphLinks.relationshipIds)),
        informationNeedIds,
      },
    };
  }).sort((a, b) => a.bundleId.localeCompare(b.bundleId));
}

function planResolutionV1Compat({ decisionState, inputStateHash }) {
  if (!decisionState || typeof decisionState !== "object") fail("compatibility planner requires pre-snapshot decision state");
  const needs = (decisionState.informationNeeds || []).filter(({ state }) => state === "OPEN");
  const needsById = new Map(needs.map((need) => [need.needId, need]));
  const options = (decisionState.resolutionOptions || []).filter((option) => needsById.has(option.informationNeedId));
  const attempts = decisionState.resolutionAttempts || [];
  const operationallyBlocked = new Set((decisionState.operationalBlockers || []).flatMap(({ affectedInformationNeedIds = [] }) => affectedInformationNeedIds));
  const system = [];
  const customer = [];
  const deferred = [];
  options.forEach((option) => {
    const need = needsById.get(option.informationNeedId);
    if (option.applicabilityState !== "APPLICABLE") {
      deferred.push({ resolutionOptionId: option.optionId, informationNeedId: need.needId, reasonCode: "NOT_CURRENTLY_ACTIONABLE" });
    } else if (SYSTEM_STRATEGIES.has(option.strategy)) {
      if (operationallyBlocked.has(need.needId)) deferred.push({ resolutionOptionId: option.optionId, informationNeedId: need.needId, reasonCode: "OPERATIONAL_RETRY_OR_HOLD" });
      else if (optionExhausted(option, attempts)) deferred.push({ resolutionOptionId: option.optionId, informationNeedId: need.needId, reasonCode: "SUBSTANTIVE_ATTEMPT_ALREADY_EXHAUSTED" });
      else system.push(action(option, need, "SYSTEM"));
    }
  });
  const systemNeedIds = new Set(system.flatMap(({ informationNeedIds }) => informationNeedIds));
  needs.forEach((need) => {
    if (systemNeedIds.has(need.needId) || operationallyBlocked.has(need.needId)) return;
    const selected = preferredCustomerOption(options.filter((option) => option.informationNeedId === need.needId && CUSTOMER_STRATEGIES.has(option.strategy)));
    if (selected) customer.push(action(selected, need, "CUSTOMER"));
  });
  const reviews = (decisionState.actionIntents || []).filter(({ state, type }) => state === "OPEN" && ["ANALYST_REVIEW", "SPECIALIST_REVIEW"].includes(type))
    .map((intent) => ({ actionId: intent.actionIntentId, actor: "INTERNAL_REVIEW", actionType: intent.type, informationNeedIds: unique(intent.informationNeedIds), requirementIds: unique(intent.requirementIds), subject: cloneData(intent.semanticTarget || {}) }));
  const terminal = decisionState.terminal || {};
  const bundles = customerBundles(customer, deferred);
  let state;
  let actor;
  let actions;
  let rationaleCodes;
  if (COMPLETE_OUTCOMES.has(terminal.terminalOutcome)) {
    state = "COMPLETE"; actor = "COMPLETE"; actions = []; rationaleCodes = ["ALREADY_RESOLVED"];
  } else if (terminal.terminalOutcome === "SPECIALIST_REVIEW_REQUIRED" || reviews.some(({ actionType }) => actionType === "SPECIALIST_REVIEW")) {
    state = "INTERNAL_REVIEW"; actor = "INTERNAL_REVIEW"; actions = reviews; rationaleCodes = ["HUMAN_INTERPRETATION_REQUIRED", "SPECIALIST_REVIEW_REQUIRED"];
  } else if (terminal.orchestrationState === "TERMINAL") {
    state = "BLOCKED"; actor = "BLOCKED"; actions = []; rationaleCodes = ["TERMINAL_POLICY_STATE"];
  } else if (system.length > 0) {
    state = "SYSTEM_RESOLUTION"; actor = "SYSTEM"; actions = system; rationaleCodes = ["NO_CUSTOMER_FRICTION", "SYSTEM_RESOLUTION_AVAILABLE", "RERESOLVE_AFTER_SYSTEM_WAVE"];
  } else if (bundles.length > 0) {
    state = "CUSTOMER_RESOLUTION"; actor = "CUSTOMER"; actions = bundles.flatMap(({ recommendedCustomerActions }) => recommendedCustomerActions); rationaleCodes = ["CUSTOMER_INPUT_REQUIRED_BY_POLICY", "MINIMAL_CUSTOMER_RESOLUTION_SET"];
  } else if (reviews.length > 0 || (decisionState.reviewRequirements || []).some(({ state: reviewState }) => reviewState === "PENDING")) {
    state = "INTERNAL_REVIEW"; actor = "INTERNAL_REVIEW"; actions = reviews; rationaleCodes = ["CUSTOMER_WORK_COMPLETE", "HUMAN_INTERPRETATION_REQUIRED"];
  } else {
    state = "BLOCKED"; actor = "BLOCKED"; actions = []; rationaleCodes = ["NO_CURRENTLY_EXECUTABLE_ACTION"];
  }
  const semantic = {
    contractVersion: RESOLUTION_PLAN_COMPAT_CONTRACT_VERSION,
    plannerVersion: RESOLUTION_PLAN_COMPAT_PLANNER_VERSION,
    inputStateHash,
    state,
    recommendedWave: { actor, actions: sortById(actions, "actionId"), customerBundles: state === "CUSTOMER_RESOLUTION" ? bundles : [] },
    deferredAlternatives: sortById(deferred, "resolutionOptionId"),
    rationale: { codes: unique(rationaleCodes), terminalOutcome: terminal.terminalOutcome || null, replanAfterWave: ["SYSTEM_RESOLUTION", "CUSTOMER_RESOLUTION"].includes(state) },
    summary: { openInformationNeeds: needs.length, recommendedActions: actions.length, customerBundles: state === "CUSTOMER_RESOLUTION" ? bundles.length : 0, deferredAlternatives: deferred.length, priorResolutionAttempts: attempts.length },
    registryCapabilityProfileRef: null,
    registryCapabilityProfileState: "NOT_PROVIDED",
    capabilityProfileSupport: "NOT_SUPPORTED_IN_THIS_STAGE",
    pipelineMaturity: "TRANSITIONAL_REVIEW_ONLY",
  };
  const planHash = hashArtifact(semantic);
  return deepFreeze(cloneData({ ...semantic, planId: `${RESOLUTION_PLAN_COMPAT_CONTRACT_VERSION}:${planHash.slice(7, 39)}`, planHash }));
}

module.exports = {
  RESOLUTION_PLAN_COMPAT_CONTRACT_VERSION,
  RESOLUTION_PLAN_COMPAT_PLANNER_VERSION,
  planResolutionV1Compat,
};
