"use strict";

const { INFORMATION_NEED_V2_STATE } = require("../domain/informationNeedV2");
const { assertDataOnly, cloneData, deepFreeze, fail } = require("../internal/validation");
const { hashArtifact } = require("../internal/phasedArtifact");

const INFORMATION_NEEDS_V2_TO_PLAN_V1_COMPAT = "ubo-information-needs-v2-to-plan-v1-compat";

function unique(values) {
  return [...new Set((values || []).filter((value) => typeof value === "string" && value.length > 0))].sort();
}

function plannerNeed(need) {
  const entityId = need.targetReference.personEntityId
    || need.targetReference.entityId
    || need.frontierEntityId
    || need.targetReference.subjectEntityId
    || null;
  return {
    needId: need.needId,
    state: "OPEN",
    requiredBy: unique(need.requiredByRequirementIds),
    subjectEntityId: entityId,
    relationshipId: need.relationshipId || need.targetReference.relationshipId || null,
    concept: need.concept,
    attribute: Array.isArray(need.targetReference.attributeCodes) ? need.targetReference.attributeCodes.join("|") : null,
    causalInformationNeedV2Id: need.needId,
  };
}

function option(need, reference, selected) {
  const semantic = { adapterVersion: INFORMATION_NEEDS_V2_TO_PLAN_V1_COMPAT, needId: need.needId, reference };
  return {
    optionId: `resolution-option:${hashArtifact(semantic).slice(7, 31)}`,
    informationNeedId: need.needId,
    requirementIds: unique(need.requiredByRequirementIds),
    strategy: reference.strategy,
    applicabilityState: selected ? "APPLICABLE" : "NOT_APPLICABLE",
    acceptableEvidenceTypes: [],
    constraints: unique([
      "TRANSITIONAL_V1_PLANNER_COMPATIBILITY",
      reference.contentStatus && reference.contentStatus !== "NOT_REQUIRED" ? reference.contentStatus : null,
      ...(reference.requiredSignoffIds || []).map((id) => `REQUIRES_SIGNOFF:${id}`),
    ]),
    reasonCode: selected ? "CAUSAL_NEED_STRATEGY_POLICY_PERMITTED" : reference.eligibleForPlanning === true ? "POLICY_PERMITTED_TRANSITIONAL_ALTERNATIVE" : "POLICY_CONTENT_NOT_EXECUTABLE",
    ...(reference.actionTemplateId ? { actionTemplateReference: reference.actionTemplateId } : {}),
  };
}

function reviewIntent(record, type) {
  const id = record.reviewRequirementId || record.specialistRouteId;
  return {
    actionIntentId: `action-intent:${hashArtifact({ adapterVersion: INFORMATION_NEEDS_V2_TO_PLAN_V1_COMPAT, id, type }).slice(7, 31)}`,
    type,
    state: "OPEN",
    informationNeedIds: unique(record.relatedInformationNeedIds),
    policyGapIds: [],
    requirementIds: unique(record.requirementIds),
    resolutionOptionIds: [],
    semanticTarget: {
      subjectEntityId: (record.personIds || record.entityIds || [])[0] || null,
      relationshipId: (record.relationshipIds || [])[0] || null,
    },
    acceptableEvidenceTypes: [],
    constraints: ["ASYNCHRONOUS_INTERNAL_REVIEW"],
    reasonCode: record.reasonCode,
  };
}

function adaptInformationNeedsV2ToPlanV1Compat({ requirementResolution, resolutionAttempts = [] }) {
  assertDataOnly({ requirementResolution, resolutionAttempts }, "informationNeedsV2ToPlanV1CompatInput");
  if (requirementResolution?.requirementResolutionAlgorithm !== "ubo-requirement-resolution-v2") fail("planner compatibility adapter requires RequirementResolution v2");
  const openNeeds = requirementResolution.informationNeeds.filter(({ status }) => status === INFORMATION_NEED_V2_STATE.OPEN);
  const informationNeeds = openNeeds.map(plannerNeed).sort((a, b) => a.needId.localeCompare(b.needId));
  const preference = ["DISCOVERY", "EXISTING_EVIDENCE", "DETERMINISTIC_CALCULATION", "CUSTOMER_ATTESTATION", "CUSTOMER_QUESTION", "CUSTOMER_DOCUMENT", "ANALYST_REVIEW"];
  const resolutionOptions = openNeeds.flatMap((need) => {
    const eligible = need.permittedResolutionStrategyReferences.filter(({ eligibleForPlanning }) => eligibleForPlanning === true)
      .sort((a, b) => preference.indexOf(a.strategy) - preference.indexOf(b.strategy));
    const selected = eligible[0];
    return need.permittedResolutionStrategyReferences.map((reference) => option(need, reference, reference === selected));
  })
    .sort((a, b) => a.optionId.localeCompare(b.optionId));
  const actionIntents = [
    ...requirementResolution.reviewRequirements.map((record) => reviewIntent(record, "ANALYST_REVIEW")),
    ...requirementResolution.specialistRoutes.map((record) => reviewIntent(record, "SPECIALIST_REVIEW")),
  ].sort((a, b) => a.actionIntentId.localeCompare(b.actionIntentId));
  const unresolved = requirementResolution.requirementResolutions.some(({ resolutionState }) => !["RESOLVED", "N_A"].includes(resolutionState));
  const decisionState = {
    informationNeeds,
    resolutionOptions,
    actionIntents,
    operationalBlockers: cloneData(requirementResolution.operationalBlockers),
    reviewRequirements: cloneData(requirementResolution.reviewRequirements),
    terminal: unresolved ? { orchestrationState: "IN_PROGRESS" } : { orchestrationState: "TERMINAL", terminalOutcome: "RESOLVED" },
    resolutionAttempts: cloneData(resolutionAttempts),
  };
  const semantic = {
    adapterVersion: INFORMATION_NEEDS_V2_TO_PLAN_V1_COMPAT,
    sourceRequirementResolutionId: requirementResolution.assessmentId,
    sourceRequirementResolutionHash: requirementResolution.assessmentHash,
    openCausalNeedIds: openNeeds.map(({ needId }) => needId).sort(),
    decisionState,
    governanceState: "REVIEW_ONLY",
    productionAuthorized: false,
    pipelineMaturity: "TRANSITIONAL_PLANNER_ONLY",
  };
  const adapterHash = hashArtifact(semantic);
  return deepFreeze(cloneData({ ...semantic, adapterId: `${INFORMATION_NEEDS_V2_TO_PLAN_V1_COMPAT}:${adapterHash.slice(7, 39)}`, adapterHash }));
}

module.exports = { INFORMATION_NEEDS_V2_TO_PLAN_V1_COMPAT, adaptInformationNeedsV2ToPlanV1Compat };
