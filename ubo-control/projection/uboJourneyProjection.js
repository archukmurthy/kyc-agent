"use strict";

const { createHash } = require("node:crypto");
const {
  UBO_JOURNEY_PROJECTION_ERROR_CODE,
  UboJourneyProjectionError,
} = require("../errors");
const { cloneData, deepFreeze } = require("../internal/validation");
const { canonicalizeJson } = require("../policy/canonicalJson");
const {
  DECISION_SNAPSHOT_SCHEMA_VERSION,
  verifyDecisionSnapshot,
} = require("../domain/decisionSnapshot");

const UBO_JOURNEY_PROJECTION_CONTRACT_VERSION = "ubo-journey-projection-v1";

const JOURNEY_STATE = Object.freeze({
  CUSTOMER_INPUT_REQUIRED: "CUSTOMER_INPUT_REQUIRED",
  CUSTOMER_INPUT_COMPLETE: "CUSTOMER_INPUT_COMPLETE",
  INTERNAL_REVIEW_REQUIRED: "INTERNAL_REVIEW_REQUIRED",
  SPECIALIST_REVIEW_REQUIRED: "SPECIALIST_REVIEW_REQUIRED",
  CASE_COMPLETE: "CASE_COMPLETE",
});

const CUSTOMER_ACTION_TYPES = new Set([
  "REQUEST_CUSTOMER_INFORMATION",
  "REQUEST_CUSTOMER_EVIDENCE",
  "REQUEST_ATTESTATION",
]);
const SYSTEM_ACTION_TYPES = new Set([
  "DISCOVER_INFORMATION",
  "INTERPRET_EXISTING_ARTIFACT",
  "OPERATIONAL_RETRY_OR_HOLD",
]);
const INTERNAL_ACTION_TYPES = new Set(["ANALYST_REVIEW", "SPECIALIST_REVIEW"]);
const COMPLETE_TERMINAL_OUTCOMES = new Set([
  "RESOLVED",
  "RESOLVED_PROVISIONALLY",
  "RESOLVED_VIA_SMO_FALLBACK",
]);

function projectionError(code, message, cause) {
  return new UboJourneyProjectionError(message, { code, cause });
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

function actionTemplate(intent) {
  if (!intent.actionTemplateReference) return null;
  return {
    actionTemplateId: intent.actionTemplateReference.actionTemplateId,
    contentStatus: intent.actionTemplateReference.contentStatus || null,
    sourceReference: intent.actionTemplateReference.sourceReference || null,
    wordingAvailable: intent.actionTemplateReference.contentStatus === "SUPPLIED",
  };
}

function semanticIdentity(intent) {
  return {
    type: intent.type,
    semanticTarget: cloneData(intent.semanticTarget || {}),
    acceptableEvidenceTypes: uniqueStrings(intent.acceptableEvidenceTypes),
    actionTemplate: actionTemplate(intent),
  };
}

function groupIntents(intents) {
  const groups = new Map();
  intents.forEach((intent) => {
    const identity = semanticIdentity(intent);
    const key = canonicalizeJson(identity);
    if (!groups.has(key)) groups.set(key, { identity, intents: [] });
    groups.get(key).intents.push(intent);
  });
  return [...groups.values()].sort((left, right) => canonicalizeJson(left.identity).localeCompare(canonicalizeJson(right.identity)));
}

function knownIdentityFields(entity, qualification) {
  const fields = [];
  if (entity?.primaryName) fields.push({ field: "full_legal_name", value: entity.primaryName });
  if ((qualification?.roles || []).length > 0) {
    fields.push({ field: "ownership_or_control_basis", value: uniqueStrings(qualification.roles) });
  }
  return canonicalSort(fields);
}

function projectCustomerWork(content) {
  const decision = content.decision;
  const needsById = new Map((decision.informationNeeds || []).map((need) => [need.needId, need]));
  const optionsById = new Map((decision.resolutionOptions || []).map((option) => [option.optionId, option]));
  const entitiesById = new Map((content.reasoning.canonicalEntities || []).map((entity) => [entity.entityId, entity]));
  const qualificationsById = new Map((decision.qualifyingPersons || []).map((person) => [person.entityId, person]));
  const open = (decision.actionIntents || []).filter((intent) => intent.state === "OPEN" && CUSTOMER_ACTION_TYPES.has(intent.type));

  return groupIntents(open).map(({ identity, intents }) => {
    const needIds = uniqueStrings(intents.flatMap(({ informationNeedIds }) => informationNeedIds || []));
    const needs = needIds.map((id) => needsById.get(id)).filter(Boolean);
    const requirementIds = uniqueStrings([
      ...intents.flatMap(({ requirementIds }) => requirementIds || []),
      ...needs.flatMap(({ requiredBy }) => requiredBy || []),
    ]);
    const optionIds = uniqueStrings(intents.flatMap(({ resolutionOptionIds }) => resolutionOptionIds || []));
    const target = identity.semanticTarget;
    const missingFields = uniqueStrings(needs.map((need) => need.attribute || need.concept));
    const qualification = qualificationsById.get(target.subjectEntityId);
    const knownFields = target.concept === "IDENTITY_ATTRIBUTE"
      ? knownIdentityFields(entitiesById.get(target.subjectEntityId), qualification)
      : [];
    const knownNames = new Set(knownFields.map(({ field }) => field));
    const workItemType = identity.type === "REQUEST_ATTESTATION"
      ? "CONFIRM_ESTABLISHED_INFORMATION"
      : "PROVIDE_MISSING_INFORMATION";
    const template = identity.actionTemplate;
    return {
      workItemId: stableId("customer-work-item", identity),
      workItemType,
      actionType: identity.type,
      state: "OPEN",
      subject: {
        entityId: target.subjectEntityId || null,
        relationshipId: target.relationshipId || null,
        concept: target.concept || null,
        attribute: target.attribute || null,
        entityProfile: content.decision.policyApplicability?.entityProfile || null,
      },
      actionIntentIds: uniqueStrings(intents.map(({ actionIntentId }) => actionIntentId)),
      informationNeedIds: needIds,
      requirementIds,
      sought: {
        factConcepts: uniqueStrings(needs.map(({ concept }) => concept)),
        evidenceTypes: identity.acceptableEvidenceTypes,
      },
      fields: {
        known: knownFields,
        missing: missingFields.filter((field) => !knownNames.has(field)),
      },
      resolutionOptions: {
        ordering: "UNRANKED",
        items: optionIds.map((id) => optionsById.get(id)).filter(Boolean).map((option) => ({
          optionId: option.optionId,
          strategy: option.strategy,
          applicabilityState: option.applicabilityState,
          acceptableEvidenceTypes: uniqueStrings(option.acceptableEvidenceTypes),
          constraints: uniqueStrings(option.constraints),
          reasonCode: option.reasonCode,
        })),
      },
      reason: {
        reasonCodes: uniqueStrings([
          ...intents.map(({ reasonCode }) => reasonCode),
          ...needs.flatMap(({ reasonCodes }) => reasonCodes || []),
        ]),
        requirementIds,
        informationNeedIds: needIds,
        actionTemplate: template,
        wordingStatus: !template ? "NOT_APPLICABLE"
          : template.wordingAvailable ? "POLICY_TEMPLATE_AVAILABLE" : "POLICY_WORDING_UNRESOLVED",
      },
      graphLinks: {
        entityIds: uniqueStrings([target.subjectEntityId]),
        relationshipIds: uniqueStrings([target.relationshipId]),
        informationNeedIds: needIds,
      },
    };
  }).sort((left, right) => left.workItemId.localeCompare(right.workItemId));
}

function projectNonCustomerWork(content, actionTypes, prefix) {
  const decision = content.decision;
  return (decision.actionIntents || [])
    .filter((intent) => intent.state === "OPEN" && actionTypes.has(intent.type))
    .map((intent) => ({
      workItemId: stableId(prefix, semanticIdentity(intent)),
      actionType: intent.type,
      state: intent.state,
      actionIntentId: intent.actionIntentId,
      subject: cloneData(intent.semanticTarget || {}),
      informationNeedIds: uniqueStrings(intent.informationNeedIds),
      requirementIds: uniqueStrings(intent.requirementIds),
      reasonCode: intent.reasonCode,
      graphLinks: {
        entityIds: uniqueStrings([intent.semanticTarget?.subjectEntityId]),
        relationshipIds: uniqueStrings([intent.semanticTarget?.relationshipId]),
        informationNeedIds: uniqueStrings(intent.informationNeedIds),
      },
    })).sort((left, right) => left.workItemId.localeCompare(right.workItemId));
}

function projectReviews(content, internalActionItems) {
  const requirementReviews = (content.decision.reviewRequirements || []).map((review) => ({
    reviewId: review.reviewRequirementId,
    reviewType: review.reviewType,
    state: review.state,
    reasonCode: review.reasonCode,
    informationNeedIds: uniqueStrings(review.relevantInformationNeedIds),
    requirementResolutionIds: uniqueStrings(review.relevantRequirementResolutionIds),
  }));
  return {
    actionItems: internalActionItems,
    reviewRequirements: canonicalSort(requirementReviews),
    policyContentGaps: canonicalSort((content.decision.resolutionOptions || [])
      .filter(({ applicabilityState }) => applicabilityState === "REQUIRES_POLICY_CONTENT")
      .map((option) => ({
        optionId: option.optionId,
        informationNeedId: option.informationNeedId,
        requirementIds: uniqueStrings(option.requirementIds),
        actionTemplate: option.actionTemplateReference ? actionTemplate({ actionTemplateReference: option.actionTemplateReference }) : null,
        reasonCode: option.reasonCode,
      }))),
    fallback: {
      candidate: cloneData(content.decision.fallbackReviewCandidate),
      assessment: cloneData(content.decision.fallbackDecisionAssessment),
      application: cloneData(content.decision.fallbackApplication),
    },
  };
}

function qualifyingPersonHandoff(content) {
  const entitiesById = new Map((content.reasoning.canonicalEntities || []).map((entity) => [entity.entityId, entity]));
  const r07Needs = (content.decision.informationNeeds || []).filter((need) => need.state === "OPEN" && need.requiredBy?.includes("UBO-R07"));
  const byEntity = new Map((content.decision.qualifyingPersons || []).map((person) => [person.entityId, person]));
  (content.decision.fallbackApplication?.roles || []).forEach((role) => {
    const existing = byEntity.get(role.personEntityId) || { entityId: role.personEntityId, roles: [], bases: [] };
    existing.roles = uniqueStrings([...(existing.roles || []), role.role]);
    byEntity.set(role.personEntityId, existing);
  });
  return [...byEntity.values()].map((person) => {
    const entity = entitiesById.get(person.entityId);
    const missing = uniqueStrings(r07Needs.filter(({ subjectEntityId }) => subjectEntityId === person.entityId)
      .map(({ attribute, concept }) => attribute || concept));
    return {
      personEntityId: person.entityId,
      roles: uniqueStrings(person.roles),
      bases: canonicalSort(person.bases || []),
      knownIdentityFields: knownIdentityFields(entity, person),
      missingIdentityFields: missing,
      requirementId: "UBO-R07",
    };
  }).sort((left, right) => left.personEntityId.localeCompare(right.personEntityId));
}

function validateCanonicalLinks(content, workItems, handoff) {
  const entityIds = new Set((content.reasoning.canonicalEntities || []).map(({ entityId }) => entityId));
  const relationshipIds = new Set((content.reasoning.graph?.relationships || []).map(({ relationshipId }) => relationshipId));
  const informationNeedIds = new Set((content.decision.informationNeeds || []).map(({ needId }) => needId));
  workItems.forEach((item) => {
    item.graphLinks.entityIds.forEach((id) => {
      if (!entityIds.has(id)) throw projectionError(UBO_JOURNEY_PROJECTION_ERROR_CODE.INCONSISTENT_DECISION_SNAPSHOT, "Journey work references an unknown canonical entity");
    });
    item.graphLinks.relationshipIds.forEach((id) => {
      if (!relationshipIds.has(id)) throw projectionError(UBO_JOURNEY_PROJECTION_ERROR_CODE.INCONSISTENT_DECISION_SNAPSHOT, "Journey work references an unknown canonical relationship");
    });
    item.graphLinks.informationNeedIds.forEach((id) => {
      if (!informationNeedIds.has(id)) throw projectionError(UBO_JOURNEY_PROJECTION_ERROR_CODE.INCONSISTENT_DECISION_SNAPSHOT, "Journey work references an unknown InformationNeed");
    });
  });
  handoff.forEach(({ personEntityId }) => {
    if (!entityIds.has(personEntityId)) throw projectionError(UBO_JOURNEY_PROJECTION_ERROR_CODE.INCONSISTENT_DECISION_SNAPSHOT, "Qualifying-person handoff references an unknown canonical entity");
  });
}

function deriveJourneyState(content, customerWork, internalReview) {
  const terminalOutcome = content.decision.terminal?.terminalOutcome;
  const specialist = terminalOutcome === "SPECIALIST_REVIEW_REQUIRED"
    || internalReview.actionItems.some(({ actionType }) => actionType === "SPECIALIST_REVIEW");
  if (specialist) return JOURNEY_STATE.SPECIALIST_REVIEW_REQUIRED;
  if (COMPLETE_TERMINAL_OUTCOMES.has(terminalOutcome)) return JOURNEY_STATE.CASE_COMPLETE;
  if (customerWork.length > 0) return JOURNEY_STATE.CUSTOMER_INPUT_REQUIRED;
  if (internalReview.actionItems.length > 0
    || internalReview.reviewRequirements.some(({ state }) => state === "PENDING")
    || internalReview.policyContentGaps.length > 0
    || internalReview.fallback.candidate?.isCandidate === true
    || content.decision.customerProjection?.state === "INTERNAL_REVIEW_REQUIRED") {
    return JOURNEY_STATE.INTERNAL_REVIEW_REQUIRED;
  }
  return JOURNEY_STATE.CUSTOMER_INPUT_COMPLETE;
}

function projectUboJourney(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw projectionError(UBO_JOURNEY_PROJECTION_ERROR_CODE.MALFORMED_DECISION_SNAPSHOT, "Projection input must be a data object");
  }
  const unknownInputKeys = Object.keys(input).filter((key) => !["contractVersion", "decisionSnapshot"].includes(key));
  if (unknownInputKeys.length > 0) {
    throw projectionError(UBO_JOURNEY_PROJECTION_ERROR_CODE.MALFORMED_DECISION_SNAPSHOT, `Unsupported projection input: ${unknownInputKeys.sort().join(", ")}`);
  }
  const contractVersion = input.contractVersion || UBO_JOURNEY_PROJECTION_CONTRACT_VERSION;
  if (contractVersion !== UBO_JOURNEY_PROJECTION_CONTRACT_VERSION) {
    throw projectionError(UBO_JOURNEY_PROJECTION_ERROR_CODE.UNSUPPORTED_CONTRACT_VERSION, `contractVersion must be ${UBO_JOURNEY_PROJECTION_CONTRACT_VERSION}`);
  }
  if (!input.decisionSnapshot || typeof input.decisionSnapshot !== "object" || Array.isArray(input.decisionSnapshot)) {
    throw projectionError(UBO_JOURNEY_PROJECTION_ERROR_CODE.MALFORMED_DECISION_SNAPSHOT, "A DecisionSnapshot is required");
  }
  if (input.decisionSnapshot.snapshotSchemaVersion !== DECISION_SNAPSHOT_SCHEMA_VERSION) {
    throw projectionError(UBO_JOURNEY_PROJECTION_ERROR_CODE.UNSUPPORTED_DECISION_SNAPSHOT_SCHEMA, "DecisionSnapshot schema is not supported by this projection contract");
  }
  try {
    verifyDecisionSnapshot(input.decisionSnapshot);
  } catch (error) {
    throw projectionError(UBO_JOURNEY_PROJECTION_ERROR_CODE.DECISION_SNAPSHOT_VERIFICATION_FAILED, "DecisionSnapshot verification failed", error);
  }

  try {
    const content = input.decisionSnapshot.decisionContent;
    const customerWork = projectCustomerWork(content);
    const systemWork = projectNonCustomerWork(content, SYSTEM_ACTION_TYPES, "system-work-item");
    const internalActionItems = projectNonCustomerWork(content, INTERNAL_ACTION_TYPES, "internal-work-item");
    const internalReview = projectReviews(content, internalActionItems);
    const journeyState = deriveJourneyState(content, customerWork, internalReview);
    const visibleCustomerWork = [JOURNEY_STATE.SPECIALIST_REVIEW_REQUIRED, JOURNEY_STATE.CASE_COMPLETE].includes(journeyState)
      ? [] : customerWork;
    const blockers = canonicalSort(content.decision.operationalBlockers || []);
    const handoff = qualifyingPersonHandoff(content);
    validateCanonicalLinks(content, [...visibleCustomerWork, ...systemWork, ...internalActionItems], handoff);
    const projection = {
      contractVersion: UBO_JOURNEY_PROJECTION_CONTRACT_VERSION,
      decision: {
        snapshotId: input.decisionSnapshot.snapshotId,
        snapshotHash: input.decisionSnapshot.decisionContentHash,
        checkpoint: cloneData(content.checkpoint),
        policyIdentity: cloneData(content.policy.identity),
        orchestrationState: content.decision.terminal.orchestrationState,
        terminalOutcome: content.decision.terminal.terminalOutcome || null,
        history: cloneData(content.history),
      },
      journeyState,
      customerInputComplete: visibleCustomerWork.length === 0,
      customerWorkItems: visibleCustomerWork,
      systemWorkItems: systemWork,
      internalReview,
      operationalBlockers: blockers,
      qualifyingPersonHandoff: handoff,
      summary: {
        customerWorkItems: visibleCustomerWork.length,
        systemWorkItems: systemWork.length,
        internalActionItems: internalActionItems.length,
        reviewRequirements: internalReview.reviewRequirements.length,
        policyContentGaps: internalReview.policyContentGaps.length,
        operationalBlockers: blockers.length,
        qualifyingPeople: handoff.length,
        unresolvedIdentityFields: handoff.reduce((count, person) => count + person.missingIdentityFields.length, 0),
      },
    };
    return deepFreeze(projection);
  } catch (error) {
    if (error instanceof UboJourneyProjectionError) throw error;
    throw projectionError(UBO_JOURNEY_PROJECTION_ERROR_CODE.INCONSISTENT_DECISION_SNAPSHOT, "DecisionSnapshot could not be projected consistently", error);
  }
}

module.exports = {
  JOURNEY_STATE,
  UBO_JOURNEY_PROJECTION_CONTRACT_VERSION,
  projectUboJourney,
};
