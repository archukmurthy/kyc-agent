"use strict";

const { createHash } = require("node:crypto");
const { CANDIDATE_FACT_TYPE } = require("../contracts/constants");
const { validateCandidateFact } = require("../contracts/candidateFact");
const { CANONICAL_ENTITY_CATEGORY } = require("../domain/canonicalEntity");
const { applyCustomerInputRecord } = require("../domain/ownershipCase");
const { verifyDecisionSnapshot } = require("../domain/decisionSnapshot");
const {
  DECISION_APPLICATION_ERROR_CODE,
  DecisionApplicationError,
} = require("../errors");
const {
  assertAllowedKeys,
  assertArray,
  assertDataOnly,
  assertNonEmptyString,
  assertPlainObject,
  cloneData,
  deepFreeze,
} = require("../internal/validation");
const { canonicalizeJson } = require("../policy/canonicalJson");
const { planUboResolution } = require("../planning/uboResolutionPlanner");
const { projectUboJourney } = require("../projection/uboJourneyProjection");

const CUSTOMER_ACTION_CONTRACT_VERSION = "ubo-customer-action-v1";
const CUSTOMER_ACTION_EVENT_TYPE = Object.freeze({
  SUBMITTED: "CUSTOMER_ACTION_SUBMITTED",
  EVIDENCE_REQUESTED: "EVIDENCE_ACTION_REQUESTED",
});
const RELATIONSHIP_CONCEPTS = new Set([
  "CURRENT_OWNERSHIP_AND_CONTROL",
  "VOTING_RIGHTS",
  "APPOINTMENT_CONTROL",
  "SIGNIFICANT_INFLUENCE_OR_CONTROL",
]);
const IDENTITY_ATTRIBUTES = new Set(["date_of_birth", "country_of_nationality", "country_of_residence"]);
const CUSTOMER_ACTION_TYPES = new Set([
  "PROVIDE_MISSING_INFORMATION",
  "CONFIRM_ESTABLISHED_INFORMATION",
  "PROVIDE_TARGETED_EVIDENCE",
]);

function customerError(code, message, cause) {
  return new DecisionApplicationError(message, { code, cause });
}

function digest(value) {
  return createHash("sha256").update(canonicalizeJson(value), "utf8").digest("hex");
}

function stableId(prefix, value) {
  return `${prefix}:${digest(value).slice(0, 24)}`;
}

function uniqueStrings(values, path) {
  assertArray(values, path);
  values.forEach((value, index) => assertNonEmptyString(value, `${path}[${index}]`));
  if (new Set(values).size !== values.length) throw new TypeError(`${path} must not contain duplicates`);
  return [...values].sort();
}

function same(left, right) {
  return canonicalizeJson(left) === canonicalizeJson(right);
}

function matchingWorkItems(bundle, journey) {
  const needIds = new Set(bundle.informationNeedIds);
  return journey.customerWorkItems.filter((item) => item.informationNeedIds.some((id) => needIds.has(id)));
}

function expectedSubject(bundle, items) {
  return {
    entityId: bundle.subject.entityId || null,
    family: bundle.subject.family || null,
    entityProfile: items.map((item) => item.subject.entityProfile).find(Boolean) || null,
  };
}

function validateSource(caseState, sourceDecisionSnapshot, sourceResolutionPlan, customerAction) {
  verifyDecisionSnapshot(sourceDecisionSnapshot);
  const reference = sourceDecisionSnapshot.decisionContent.caseReference;
  if (reference.caseId !== caseState.caseId || reference.revision !== caseState.revision
    || reference.revisionId !== caseState.revisionId) {
    throw customerError(DECISION_APPLICATION_ERROR_CODE.STALE_CUSTOMER_ACTION, "source DecisionSnapshot is stale or belongs to another case");
  }
  const expectedPlan = planUboResolution({ decisionSnapshot: sourceDecisionSnapshot });
  if (!same(expectedPlan, sourceResolutionPlan)) {
    throw customerError(DECISION_APPLICATION_ERROR_CODE.STALE_CUSTOMER_ACTION, "source ResolutionPlan does not match the sealed DecisionSnapshot");
  }
  if (customerAction.snapshotId !== sourceDecisionSnapshot.snapshotId
    || customerAction.snapshotHash !== sourceDecisionSnapshot.decisionContentHash) {
    throw customerError(DECISION_APPLICATION_ERROR_CODE.STALE_CUSTOMER_ACTION, "customer action is not pinned to the source DecisionSnapshot");
  }
  return { plan: expectedPlan, journey: projectUboJourney({ decisionSnapshot: sourceDecisionSnapshot }) };
}

function validateActionShape(customerAction) {
  assertPlainObject(customerAction, "customerAction");
  assertAllowedKeys(customerAction, [
    "contractVersion", "eventType", "snapshotId", "snapshotHash", "bundleId", "workItemIds",
    "actionIntentIds", "actionIds", "semanticActionTypes", "informationNeedIds", "requirementIds",
    "subject", "values", "confirmationResult", "selectedCustomerResolutionOptionId", "evidenceAction",
  ], "customerAction");
  if (customerAction.contractVersion !== CUSTOMER_ACTION_CONTRACT_VERSION) {
    throw new TypeError(`customerAction.contractVersion must be ${CUSTOMER_ACTION_CONTRACT_VERSION}`);
  }
  if (!Object.values(CUSTOMER_ACTION_EVENT_TYPE).includes(customerAction.eventType)) {
    throw new TypeError("customerAction.eventType is unsupported");
  }
  ["snapshotId", "snapshotHash", "bundleId"].forEach((field) => assertNonEmptyString(customerAction[field], `customerAction.${field}`));
  ["workItemIds", "actionIntentIds", "actionIds", "semanticActionTypes", "informationNeedIds", "requirementIds"]
    .forEach((field) => uniqueStrings(customerAction[field], `customerAction.${field}`));
  assertPlainObject(customerAction.subject, "customerAction.subject");
  assertPlainObject(customerAction.values, "customerAction.values");
  assertDataOnly(customerAction, "customerAction");
}

function validatePlannedAction(customerAction, plan, journey) {
  if (plan.state !== "CUSTOMER_RESOLUTION") {
    throw customerError(DECISION_APPLICATION_ERROR_CODE.UNAUTHORIZED_CUSTOMER_ACTION, "source plan does not permit a customer-resolution action");
  }
  const bundle = plan.recommendedWave.customerBundles.find(({ bundleId }) => bundleId === customerAction.bundleId);
  if (!bundle) throw customerError(DECISION_APPLICATION_ERROR_CODE.UNAUTHORIZED_CUSTOMER_ACTION, "customer action references an unknown bundle");
  const items = matchingWorkItems(bundle, journey);
  const actions = bundle.recommendedCustomerActions;
  const expected = {
    workItemIds: items.map(({ workItemId }) => workItemId).sort(),
    actionIntentIds: items.flatMap(({ actionIntentIds }) => actionIntentIds).filter((id, index, all) => all.indexOf(id) === index).sort(),
    actionIds: actions.map(({ actionId }) => actionId).sort(),
    semanticActionTypes: actions.map(({ actionType }) => actionType).filter((id, index, all) => all.indexOf(id) === index).sort(),
    informationNeedIds: [...bundle.informationNeedIds].sort(),
    requirementIds: [...bundle.requirementIds].sort(),
    subject: expectedSubject(bundle, items),
  };
  Object.keys(expected).forEach((field) => {
    if (!same(customerAction[field], expected[field])) {
      throw customerError(DECISION_APPLICATION_ERROR_CODE.UNAUTHORIZED_CUSTOMER_ACTION, `customer action ${field} does not match the source plan`);
    }
  });
  if (actions.some(({ actionType }) => !CUSTOMER_ACTION_TYPES.has(actionType))) {
    throw customerError(DECISION_APPLICATION_ERROR_CODE.UNAUTHORIZED_CUSTOMER_ACTION, "source bundle contains an unsupported semantic action type");
  }
  return { bundle, items, actions };
}

function identifierKey(identifier) {
  const namespace = identifier.namespace || identifier.system || identifier.identifierType;
  return `${namespace}\u0000${identifier.value}`;
}

function canonicalMatches(caseState, party) {
  if (party.entityId !== undefined) {
    const exact = caseState.canonicalEntities.filter(({ entityId }) => entityId === party.entityId);
    if (exact.length !== 1) throw new TypeError(`customer party references unknown canonical entity ${party.entityId}`);
    return exact[0];
  }
  const identifiers = party.externalIdentifiers || [];
  const matches = caseState.canonicalEntities.filter((entity) => {
    const keys = new Set(entity.externalIdentifiers.map(identifierKey));
    return identifiers.some((identifier) => keys.has(identifierKey(identifier)));
  });
  if (matches.length > 1) throw new TypeError("customer party external identifier matches more than one canonical entity");
  return matches[0];
}

function partyResolver(caseState, operationId, actorReference) {
  const newEntities = [];
  const byLocalKey = new Map();
  function resolve(input, path) {
    assertPlainObject(input, path);
    assertAllowedKeys(input, [
      "entityId", "name", "entityType", "jurisdiction", "externalIdentifiers", "localPartyKey", "registerAsNew",
    ], path);
    const externalIdentifiers = cloneData(input.externalIdentifiers || []);
    assertArray(externalIdentifiers, `${path}.externalIdentifiers`);
    const existing = canonicalMatches(caseState, { ...input, externalIdentifiers });
    if (existing) {
      return {
        party: {
          entityId: existing.entityId,
          ...(input.name ? { name: input.name } : {}),
          ...(input.entityType ? { entityType: input.entityType } : {}),
          ...(input.jurisdiction ? { jurisdiction: input.jurisdiction } : {}),
          externalIdentifiers,
        },
        entityId: existing.entityId,
        basisReasonCode: input.entityId ? "EXPLICIT_CANONICAL_ENTITY_REFERENCE" : "EXACT_UNIQUE_EXTERNAL_IDENTIFIER",
      };
    }
    if (input.registerAsNew === true) {
      if (input.entityType !== "NATURAL_PERSON") throw new TypeError(`${path}.registerAsNew supports only NATURAL_PERSON`);
      assertNonEmptyString(input.localPartyKey, `${path}.localPartyKey`);
      assertNonEmptyString(input.name, `${path}.name`);
      if (byLocalKey.has(input.localPartyKey)) return byLocalKey.get(input.localPartyKey);
      const entityId = stableId(`${caseState.caseId}:customer-person`, { operationId, localPartyKey: input.localPartyKey });
      const resolved = {
        party: { entityId, name: input.name, entityType: "NATURAL_PERSON", ...(input.jurisdiction ? { jurisdiction: input.jurisdiction } : {}), externalIdentifiers },
        entityId,
        basisReasonCode: "EXPLICIT_CUSTOMER_NEW_PERSON_REGISTRATION",
      };
      byLocalKey.set(input.localPartyKey, resolved);
      newEntities.push({
        entityId, category: CANONICAL_ENTITY_CATEGORY.NATURAL_PERSON, primaryName: input.name, aliases: [],
        externalIdentifiers, ...(input.jurisdiction ? { jurisdiction: input.jurisdiction } : {}),
        entityTypeMetadata: { registrationOrigin: "CUSTOMER", operationId, actorReference: cloneData(actorReference), localPartyKey: input.localPartyKey },
      });
      return resolved;
    }
    const party = {
      ...(input.name ? { name: input.name } : {}),
      ...(input.entityType ? { entityType: input.entityType } : {}),
      ...(input.jurisdiction ? { jurisdiction: input.jurisdiction } : {}),
      externalIdentifiers,
    };
    if (!party.name && externalIdentifiers.length === 0) throw new TypeError(`${path} requires a canonical reference, new-person registration, name, or identifier`);
    return { party };
  }
  return { resolve, newEntities };
}

function normalizeRelationshipStatements(value, context) {
  const statements = Array.isArray(value) ? value : [value];
  return statements.map((statement, index) => {
    const path = `customerAction.values.${context.field}[${index}]`;
    assertPlainObject(statement, path);
    assertAllowedKeys(statement, ["type", "factId", "subject", "object", "relationship", "measurement", "qualifiers"], path);
    if (statement.type !== CANDIDATE_FACT_TYPE.RELATIONSHIP) throw new TypeError(`${path}.type must be RELATIONSHIP`);
    const subject = context.parties.resolve(statement.subject, `${path}.subject`);
    const object = context.parties.resolve(statement.object, `${path}.object`);
    if (!context.allowedObjectEntityIds.has(object.party.entityId)) {
      throw new TypeError(`${path}.object must be the requested canonical subject or one of its established upstream entities`);
    }
    if (!statement.qualifiers || !["CURRENT", "CEASED", "UNKNOWN"].includes(statement.qualifiers.currentState)) {
      throw new TypeError(`${path}.qualifiers.currentState must explicitly state CURRENT, CEASED, or UNKNOWN`);
    }
    const fact = {
      factId: statement.factId || stableId("customer-fact", { operationId: context.operationId, field: context.field, index }),
      type: CANDIDATE_FACT_TYPE.RELATIONSHIP,
      subject: subject.party,
      object: object.party,
      relationship: statement.relationship,
      ...(statement.measurement === undefined ? {} : { measurement: cloneData(statement.measurement) }),
      qualifiers: {
        ...cloneData(statement.qualifiers),
        customerProvenance: cloneData(context.provenance),
      },
      evidenceReferences: [],
    };
    validateCandidateFact(fact, path);
    return { fact, resolvedEndpoints: { subject, object } };
  });
}

function identityDecisionsFor(entries, caseState, operationId, recordedAt, actorReference) {
  const decisions = [];
  entries.forEach(({ fact, resolvedEndpoints }, factIndex) => {
    ["subject", ...(fact.type === CANDIDATE_FACT_TYPE.RELATIONSHIP ? ["object"] : [])].forEach((endpoint) => {
      const resolved = resolvedEndpoints[endpoint];
      if (!resolved?.entityId) return;
      const claimId = `${caseState.caseId}:claim:${operationId}:${fact.factId || `fact-${factIndex + 1}`}`;
      decisions.push({
        decisionId: stableId("customer-identity-decision", { operationId, claimId, endpoint }),
        candidatePartyKey: `${claimId}:${endpoint}`,
        candidateParty: cloneData(fact[endpoint]),
        status: "RESOLVED",
        entityId: resolved.entityId,
        basisReasonCodes: [resolved.basisReasonCode],
        evidenceReferences: [],
        decidedAt: recordedAt,
        decisionOrigin: "CUSTOMER_INPUT_DETERMINISTIC_IDENTITY",
        decisionActor: actorReference.referenceId || actorReference.actorId || "CUSTOMER",
      });
    });
  });
  return decisions;
}

function answerKey(actions, field) {
  return actions.find(({ subject }) => (subject.attribute || subject.concept) === field)?.actionTemplate?.actionTemplateId || field;
}

function upstreamEntityIds(sourceDecisionSnapshot, targetEntityId) {
  const incoming = new Map();
  sourceDecisionSnapshot.decisionContent.reasoning.graph.relationships.forEach(({ subjectEntityId, objectEntityId }) => {
    if (!incoming.has(objectEntityId)) incoming.set(objectEntityId, new Set());
    incoming.get(objectEntityId).add(subjectEntityId);
  });
  const result = new Set([targetEntityId]);
  const pending = [targetEntityId];
  while (pending.length > 0) {
    for (const entityId of incoming.get(pending.shift()) || []) {
      if (result.has(entityId)) continue;
      result.add(entityId);
      pending.push(entityId);
    }
  }
  return result;
}

function applyCustomerInput({ caseState, sourceDecisionSnapshot, sourceResolutionPlan, customerAction, operationId, recordedAt, actorReference }) {
  try {
    validateActionShape(customerAction);
    assertNonEmptyString(operationId, "applyCustomerInput.operationId");
    assertNonEmptyString(recordedAt, "applyCustomerInput.recordedAt");
    if (Number.isNaN(Date.parse(recordedAt))) throw new TypeError("applyCustomerInput.recordedAt must be an ISO-compatible timestamp");
    assertPlainObject(actorReference, "applyCustomerInput.actorReference");
    assertDataOnly(actorReference, "applyCustomerInput.actorReference");
    if (Object.keys(actorReference).length === 0) throw new TypeError("applyCustomerInput.actorReference must identify the customer actor");
    const { plan, journey } = validateSource(caseState, sourceDecisionSnapshot, sourceResolutionPlan, customerAction);
    const { bundle, actions } = validatePlannedAction(customerAction, plan, journey);
    const customerInputId = stableId("customer-input", { caseId: caseState.caseId, operationId, customerAction, recordedAt, actorReference });
    const provenance = {
      origin: "CUSTOMER", customerInputId, operationId, snapshotId: customerAction.snapshotId,
      snapshotHash: customerAction.snapshotHash, bundleId: bundle.bundleId,
      workItemIds: cloneData(customerAction.workItemIds), actionIds: cloneData(customerAction.actionIds),
      informationNeedIds: cloneData(bundle.informationNeedIds), requirementIds: cloneData(bundle.requirementIds),
      recordedAt, actorReference: cloneData(actorReference), caseRevision: caseState.revision + 1,
    };
    const parties = partyResolver(caseState, operationId, actorReference);
    const entries = [];
    const facts = {};
    const answers = {};
    const seniorManagementCandidates = [];
    const allowedFields = new Set(bundle.missingFacts);
    Object.entries(customerAction.values).forEach(([field, value]) => {
      if (!allowedFields.has(field)) throw customerError(DECISION_APPLICATION_ERROR_CODE.UNAUTHORIZED_CUSTOMER_ACTION, `customer action field ${field} was not requested`);
      if (RELATIONSHIP_CONCEPTS.has(field)) {
        entries.push(...normalizeRelationshipStatements(value, {
          field, bundle, parties, operationId, provenance,
          allowedObjectEntityIds: upstreamEntityIds(sourceDecisionSnapshot, bundle.subject.entityId),
        }));
      } else if (IDENTITY_ATTRIBUTES.has(field)) {
        if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${field} must be a non-empty string`);
        const subject = parties.resolve({ entityId: bundle.subject.entityId, externalIdentifiers: [] }, `customerAction.values.${field}.subject`);
        const fact = {
          factId: stableId("customer-fact", { operationId, field }), type: CANDIDATE_FACT_TYPE.ENTITY_ATTRIBUTE,
          subject: subject.party, attribute: field, value: value.trim(), evidenceReferences: [],
        };
        validateCandidateFact(fact);
        entries.push({ fact, resolvedEndpoints: { subject } });
      } else if (field === "SENIOR_MANAGEMENT_CANDIDATE") {
        const candidates = Array.isArray(value) ? value : [value];
        candidates.forEach((candidate, index) => {
          assertPlainObject(candidate, `customerAction.values.${field}[${index}]`);
          assertAllowedKeys(candidate, ["personEntityId", "factReferences"], `customerAction.values.${field}[${index}]`);
          const entity = caseState.canonicalEntities.find(({ entityId }) => entityId === candidate.personEntityId);
          if (!entity || entity.category !== CANONICAL_ENTITY_CATEGORY.NATURAL_PERSON) throw new TypeError("senior-management candidate must reference an existing canonical natural person");
          seniorManagementCandidates.push({ personEntityId: candidate.personEntityId, factReferences: cloneData(candidate.factReferences || []), evidenceReferences: [] });
        });
      } else {
        if (value !== null && typeof value === "object") throw new TypeError(`${field} must be a primitive policy answer`);
        answers[answerKey(actions, field)] = value;
      }
    });
    const confirmationActions = actions.filter(({ actionType }) => actionType === "CONFIRM_ESTABLISHED_INFORMATION");
    if (customerAction.confirmationResult !== null) {
      if (confirmationActions.length === 0 || !["CONFIRMED", "CORRECTION_REQUIRED"].includes(customerAction.confirmationResult)) {
        throw customerError(DECISION_APPLICATION_ERROR_CODE.UNAUTHORIZED_CUSTOMER_ACTION, "confirmation result is not permitted by the source bundle");
      }
      confirmationActions.forEach((action) => { answers[action.actionTemplate?.actionTemplateId || action.subject.concept] = customerAction.confirmationResult; });
    }
    const allowedOptions = new Set([
      ...actions.flatMap(({ resolutionOptionIds }) => resolutionOptionIds || []),
      ...bundle.policyPermittedAlternatives.filter(({ applicabilityState }) => applicabilityState === "APPLICABLE").map(({ resolutionOptionId }) => resolutionOptionId),
    ]);
    if (customerAction.selectedCustomerResolutionOptionId !== null
      && !allowedOptions.has(customerAction.selectedCustomerResolutionOptionId)) {
      throw customerError(DECISION_APPLICATION_ERROR_CODE.UNAUTHORIZED_CUSTOMER_ACTION, "selected customer resolution option is not permitted by the source plan");
    }
    const evidenceRequested = customerAction.eventType === CUSTOMER_ACTION_EVENT_TYPE.EVIDENCE_REQUESTED;
    if (evidenceRequested && (entries.length > 0 || Object.keys(answers).length > 0 || Object.keys(customerAction.values).length > 0)) {
      throw new TypeError("evidence handoff actions cannot carry facts or answers");
    }
    if (!evidenceRequested && entries.length === 0 && Object.keys(answers).length === 0
      && seniorManagementCandidates.length === 0 && customerAction.selectedCustomerResolutionOptionId === null) {
      throw new TypeError("customer submission contains no permitted application input");
    }
    const evidenceTypes = evidenceRequested ? uniqueStrings(customerAction.evidenceAction?.evidenceTypes || [], "customerAction.evidenceAction.evidenceTypes") : [];
    if (evidenceRequested) {
      if (customerAction.evidenceAction?.intent !== "EVIDENCE_ACTION_REQUESTED" || evidenceTypes.length === 0
        || evidenceTypes.some((type) => !bundle.evidenceRequirements.includes(type))) {
        throw customerError(DECISION_APPLICATION_ERROR_CODE.UNAUTHORIZED_CUSTOMER_ACTION, "evidence handoff does not match the source bundle");
      }
    }
    const externalHandoffs = evidenceRequested ? [{
      handoffId: stableId("external-evidence-handoff", { customerInputId, evidenceTypes }),
      handoffType: "EXTERNAL_EVIDENCE_REQUIRED", status: "PENDING_EXTERNAL_ACTION", customerInputId, operationId,
      snapshotId: customerAction.snapshotId, snapshotHash: customerAction.snapshotHash, bundleId: bundle.bundleId,
      actionIds: cloneData(customerAction.actionIds), informationNeedIds: cloneData(bundle.informationNeedIds),
      requirementIds: cloneData(bundle.requirementIds), evidenceTypes, subject: cloneData(customerAction.subject),
    }] : [];
    const candidateFacts = entries.map(({ fact }) => fact);
    const identityDecisions = identityDecisionsFor(entries, caseState, operationId, recordedAt, actorReference);
    const correctionRequests = customerAction.confirmationResult === "CORRECTION_REQUIRED" ? [{
      correctionRequestId: stableId("customer-correction-request", { customerInputId, bundleId: bundle.bundleId }),
      requirementIds: cloneData(bundle.requirementIds),
      claimIds: sourceDecisionSnapshot.decisionContent.decision.informationNeeds
        .filter(({ needId }) => bundle.informationNeedIds.includes(needId))
        .flatMap(({ claimIds = [] }) => claimIds)
        .filter((claimId, index, all) => all.indexOf(claimId) === index)
        .sort(),
      reasonCode: "CUSTOMER_DISPUTES_ESTABLISHED_INFORMATION",
    }] : [];
    const record = {
      customerInputId, operationId, customerActionContractVersion: CUSTOMER_ACTION_CONTRACT_VERSION,
      eventType: customerAction.eventType, snapshotId: customerAction.snapshotId, snapshotHash: customerAction.snapshotHash,
      bundleId: bundle.bundleId, workItemIds: cloneData(customerAction.workItemIds), actionIntentIds: cloneData(customerAction.actionIntentIds),
      actionIds: cloneData(customerAction.actionIds), informationNeedIds: cloneData(bundle.informationNeedIds),
      requirementIds: cloneData(bundle.requirementIds), subject: cloneData(customerAction.subject), origin: "CUSTOMER",
      actorReference: cloneData(actorReference), evaluationInputs: {
        facts, answers, correctionRequests, seniorManagementCandidates,
        seniorManagementCandidatesComplete: seniorManagementCandidates.length > 0,
      },
      ...(customerAction.confirmationResult === null ? {} : { confirmationResult: customerAction.confirmationResult }),
      ...(customerAction.selectedCustomerResolutionOptionId === null ? {} : { selectedCustomerResolutionOptionId: customerAction.selectedCustomerResolutionOptionId }),
      ...(customerAction.confirmationResult === "CORRECTION_REQUIRED" ? { correctionRequested: true } : {}),
      claimIds: [], externalHandoffIds: [],
    };
    const nextCaseState = applyCustomerInputRecord(caseState, record, candidateFacts, parties.newEntities, identityDecisions, externalHandoffs, { recordedAt });
    const resolutionTargets = customerAction.confirmationResult === "CORRECTION_REQUIRED" ? [{
      targetType: "CUSTOMER_CORRECTION_REVIEW", customerInputId, bundleId: bundle.bundleId,
      informationNeedIds: cloneData(bundle.informationNeedIds), requirementIds: cloneData(bundle.requirementIds),
      currentState: "OPEN", reasonCode: "CUSTOMER_DISPUTES_ESTABLISHED_INFORMATION",
    }] : [];
    return deepFreeze({
      caseState: nextCaseState,
      outcome: {
        customerInputId, operationId, recordedInRevision: nextCaseState.revision,
        createdCanonicalEntityIds: parties.newEntities.map(({ entityId }) => entityId).sort(),
        createdClaimIds: nextCaseState.customerInputRecords.at(-1).claimIds,
        deterministicIdentityDecisionIds: identityDecisions.map(({ decisionId }) => decisionId).sort(),
        resolutionTargets,
        externalHandoffs: cloneData(externalHandoffs.map((handoff) => ({ ...handoff, recordedAt, recordedInRevision: nextCaseState.revision }))),
      },
    });
  } catch (error) {
    if (error instanceof DecisionApplicationError) throw error;
    throw customerError(DECISION_APPLICATION_ERROR_CODE.INVALID_CUSTOMER_ACTION, error.message, error);
  }
}

function customerResolutionInputs(caseState, supplied) {
  const result = cloneData(supplied);
  const customerFacts = {};
  const customerAnswers = {};
  let seniorManagementCandidates;
  let seniorManagementCandidatesComplete = false;
  (caseState.customerInputRecords || []).forEach(({ evaluationInputs }) => {
    Object.assign(customerFacts, evaluationInputs.facts || {});
    Object.assign(customerAnswers, evaluationInputs.answers || {});
    if ((evaluationInputs.seniorManagementCandidates || []).length > 0) {
      seniorManagementCandidates = cloneData(evaluationInputs.seniorManagementCandidates);
      seniorManagementCandidatesComplete = evaluationInputs.seniorManagementCandidatesComplete === true;
    }
  });
  result.facts = { ...(result.facts || {}), ...customerFacts };
  result.answers = { ...(result.answers || {}), ...customerAnswers };
  if (seniorManagementCandidates !== undefined) {
    result.seniorManagementCandidates = seniorManagementCandidates;
    result.seniorManagementCandidatesComplete = seniorManagementCandidatesComplete;
  }
  return result;
}

module.exports = {
  CUSTOMER_ACTION_CONTRACT_VERSION,
  applyCustomerInput,
  customerResolutionInputs,
};
