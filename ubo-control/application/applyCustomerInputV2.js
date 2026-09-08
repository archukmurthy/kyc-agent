"use strict";

const { CANDIDATE_FACT_TYPE, RELATIONSHIP_TYPE } = require("../contracts/constants");
const { validateCandidateFact } = require("../contracts/candidateFact");
const { validatePercentageValue } = require("../contracts/percentageValue");
const { verifyDecisionSnapshotV2 } = require("../domain/decisionSnapshotV2");
const { applyCustomerInputRecord } = require("../domain/ownershipCase");
const {
  DECISION_APPLICATION_ERROR_CODE,
  DecisionApplicationError,
} = require("../errors");
const { hashArtifact } = require("../internal/phasedArtifact");
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
const { validateResolutionPlanV2 } = require("../planning/resolutionPlanV2");
const {
  CUSTOMER_ACTION_TYPE_V2,
  CUSTOMER_WORK_DELEGATION_V1,
  EXTERNAL_EVIDENCE_HANDOFF_V1,
  SUBMISSION_CONTRACT,
  projectUboJourneyV2,
} = require("../projection/uboJourneyProjectionV2");

const CUSTOMER_ACTION_V2 = "ubo-customer-action-v2";
const CUSTOMER_ACTION_RESULT_V2 = "ubo-customer-action-result-v2";

function customerError(code, message, cause) {
  return new DecisionApplicationError(message, { code, cause });
}

function same(left, right) {
  return canonicalizeJson(left) === canonicalizeJson(right);
}

function unique(values) {
  return [...new Set((values || []).filter(Boolean))].sort();
}

function stableId(prefix, semantic) {
  return `${prefix}:${hashArtifact(semantic).slice(7, 39)}`;
}

function requireTimestamp(value, path) {
  assertNonEmptyString(value, path);
  if (Number.isNaN(Date.parse(value))) throw new TypeError(`${path} must be an ISO-compatible timestamp`);
}

function requireExact(value, expected, code, message) {
  if (!same(value, expected)) throw customerError(code, message);
}

function validateActionShape(action) {
  assertPlainObject(action, "customerActionV2");
  assertAllowedKeys(action, [
    "contractVersion",
    "caseReference",
    "sourceDecisionSnapshot",
    "sourceResolutionPlan",
    "bundleId",
    "resolutionGroupId",
    "resolutionActionId",
    "informationNeedIds",
    "requirementIds",
    "canonicalSubject",
    "frontierEntityIds",
    "policyIdentity",
    "actionType",
    "submissionContract",
    "actorReference",
    "actorCapacity",
    "submittedAt",
    "informationAsAtDate",
    "delegatedFrom",
    "payload",
  ], "customerActionV2");
  if (action.contractVersion !== CUSTOMER_ACTION_V2) throw new TypeError(`customerActionV2.contractVersion must be ${CUSTOMER_ACTION_V2}`);
  if (!Object.values(CUSTOMER_ACTION_TYPE_V2).includes(action.actionType)) throw new TypeError("customerActionV2.actionType is unsupported");
  ["bundleId", "resolutionGroupId", "resolutionActionId", "submissionContract", "actorCapacity"]
    .forEach((field) => assertNonEmptyString(action[field], `customerActionV2.${field}`));
  ["caseReference", "sourceDecisionSnapshot", "sourceResolutionPlan", "canonicalSubject", "policyIdentity", "actorReference", "payload"]
    .forEach((field) => assertPlainObject(action[field], `customerActionV2.${field}`));
  ["informationNeedIds", "requirementIds", "frontierEntityIds"].forEach((field) => {
    assertArray(action[field], `customerActionV2.${field}`);
    action[field].forEach((item, index) => assertNonEmptyString(item, `customerActionV2.${field}[${index}]`));
    if (new Set(action[field]).size !== action[field].length) throw new TypeError(`customerActionV2.${field} must not contain duplicates`);
  });
  if (Object.keys(action.actorReference).length === 0) throw new TypeError("customerActionV2.actorReference must identify the actor");
  if (action.delegatedFrom !== null && action.delegatedFrom !== undefined) assertPlainObject(action.delegatedFrom, "customerActionV2.delegatedFrom");
  requireTimestamp(action.submittedAt, "customerActionV2.submittedAt");
  requireTimestamp(action.informationAsAtDate, "customerActionV2.informationAsAtDate");
  assertDataOnly(action, "customerActionV2");
}

function validateSource(caseState, loadedPolicyPack, snapshot, suppliedPlan, action) {
  verifyDecisionSnapshotV2(snapshot);
  validateResolutionPlanV2(suppliedPlan);
  const pinnedPlan = snapshot.decisionContent.pinnedResolutionPlan;
  requireExact(suppliedPlan, pinnedPlan, DECISION_APPLICATION_ERROR_CODE.STALE_CUSTOMER_ACTION,
    "source ResolutionPlan v2 does not match the plan pinned in DecisionSnapshot v2");
  const caseReference = snapshot.decisionContent.caseReference;
  requireExact(action.caseReference, caseReference, DECISION_APPLICATION_ERROR_CODE.STALE_CUSTOMER_ACTION,
    "customer action case reference does not match DecisionSnapshot v2");
  if (caseReference.caseId !== caseState.caseId || caseReference.revision !== caseState.revision
    || caseReference.revisionId !== caseState.revisionId) {
    throw customerError(DECISION_APPLICATION_ERROR_CODE.STALE_CUSTOMER_ACTION,
      "source DecisionSnapshot v2 is stale or belongs to another case revision");
  }
  requireExact(action.sourceDecisionSnapshot, {
    snapshotId: snapshot.snapshotId,
    snapshotHash: snapshot.decisionContentHash,
  }, DECISION_APPLICATION_ERROR_CODE.STALE_CUSTOMER_ACTION,
  "customer action snapshot pins are stale or inconsistent");
  requireExact(action.sourceResolutionPlan, {
    planId: pinnedPlan.planId,
    planHash: pinnedPlan.planHash,
  }, DECISION_APPLICATION_ERROR_CODE.STALE_CUSTOMER_ACTION,
  "customer action plan pins are stale or inconsistent");
  requireExact(action.policyIdentity, snapshot.decisionContent.policy.identity,
    DECISION_APPLICATION_ERROR_CODE.STALE_CUSTOMER_ACTION,
    "customer action policy identity does not match DecisionSnapshot v2");
  const loadedIdentity = {
    policyPackId: loadedPolicyPack.identity.policyPackId,
    policyVersion: loadedPolicyPack.identity.version,
    policyHash: loadedPolicyPack.identity.hash,
    policySchemaVersion: loadedPolicyPack.identity.schemaVersion,
  };
  requireExact(action.policyIdentity, loadedIdentity, DECISION_APPLICATION_ERROR_CODE.STALE_CUSTOMER_ACTION,
    "customer action policy identity does not match the application policy");
  return projectUboJourneyV2({ decisionSnapshot: snapshot });
}

function validatePlannedAction(action, journey) {
  const bundle = journey.customerWorkBundles.find(({ bundleId }) => bundleId === action.bundleId);
  if (!bundle) throw customerError(DECISION_APPLICATION_ERROR_CODE.UNAUTHORIZED_CUSTOMER_ACTION, "customer action references an unknown work bundle");
  const permitted = bundle.permittedSemanticActions.find((item) => item.actionType === action.actionType
    && item.submissionContract === action.submissionContract
    && item.sourceResolutionActionId === action.resolutionActionId);
  if (!permitted) throw customerError(DECISION_APPLICATION_ERROR_CODE.UNAUTHORIZED_CUSTOMER_ACTION, "customer action type or submission contract is not permitted by the work bundle");
  if (!permitted.executable) {
    const detail = permitted.blockedReason === "POLICY_CONTENT_REQUIRED" ? "missing approved policy content" : "sign-off governance";
    throw customerError(DECISION_APPLICATION_ERROR_CODE.UNAUTHORIZED_CUSTOMER_ACTION, `customer action is blocked by ${detail}`);
  }
  requireExact(action.informationNeedIds, bundle.informationNeedIds,
    DECISION_APPLICATION_ERROR_CODE.UNAUTHORIZED_CUSTOMER_ACTION, "customer action InformationNeed pins do not match the bundle");
  requireExact(action.requirementIds, bundle.requirementIds,
    DECISION_APPLICATION_ERROR_CODE.UNAUTHORIZED_CUSTOMER_ACTION, "customer action requirement pins do not match the bundle");
  requireExact(action.canonicalSubject, bundle.canonicalSubject,
    DECISION_APPLICATION_ERROR_CODE.ACTION_TARGET_MISMATCH, "customer action subject does not match the bundle");
  requireExact(action.frontierEntityIds, bundle.frontierEntityIds,
    DECISION_APPLICATION_ERROR_CODE.ACTION_TARGET_MISMATCH, "customer action frontier does not match the bundle");
  if (action.resolutionGroupId !== bundle.resolutionGroupId || !bundle.actionIds.includes(action.resolutionActionId)) {
    throw customerError(DECISION_APPLICATION_ERROR_CODE.UNAUTHORIZED_CUSTOMER_ACTION,
      "customer action group/action pins do not match the work bundle");
  }
  return { bundle, permitted };
}

function partyReference(input, path) {
  assertPlainObject(input, path);
  assertAllowedKeys(input, [
    "localPartyKey", "entityId", "name", "entityType", "jurisdiction", "externalIdentifiers",
  ], path);
  assertNonEmptyString(input.localPartyKey, `${path}.localPartyKey`);
  if (input.entityId === undefined && input.name === undefined && (input.externalIdentifiers || []).length === 0) {
    throw new TypeError(`${path} requires an entityId, name, or external identifier`);
  }
  if (input.entityId !== undefined) assertNonEmptyString(input.entityId, `${path}.entityId`);
  if (input.name !== undefined) assertNonEmptyString(input.name, `${path}.name`);
  if (input.entityType !== undefined) assertNonEmptyString(input.entityType, `${path}.entityType`);
  if (input.jurisdiction !== undefined) assertNonEmptyString(input.jurisdiction, `${path}.jurisdiction`);
  assertArray(input.externalIdentifiers || [], `${path}.externalIdentifiers`);
  return {
    ...(input.entityId === undefined ? {} : { entityId: input.entityId }),
    ...(input.name === undefined ? {} : { name: input.name }),
    ...(input.entityType === undefined ? {} : { entityType: input.entityType }),
    ...(input.jurisdiction === undefined ? {} : { jurisdiction: input.jurisdiction }),
    externalIdentifiers: cloneData(input.externalIdentifiers || []),
  };
}

function validateShareContract(loadedPolicyPack) {
  const contract = loadedPolicyPack.policyPack.actionTemplates?.DISCLOSE_SHARE_OWNERSHIP?.submissionContract;
  const expected = {
    factType: "RELATIONSHIP",
    concept: "SHARE_OWNERSHIP",
    relationshipType: "ECONOMIC_OWNERSHIP",
    direction: "OWNER_TO_TARGET",
    target: "INFORMATION_NEED_SUBJECT",
    allowedMeasurementTypes: ["EXACT", "RANGE", "UNKNOWN"],
    temporalMeaning: "CURRENT",
  };
  if (!same(contract, expected)) throw customerError(DECISION_APPLICATION_ERROR_CODE.POLICY_CONFIGURATION_ERROR,
    "DISCLOSE_SHARE_OWNERSHIP does not provide the approved structured submission contract");
  return contract;
}

function structuredRelationships(action, bundle, loadedPolicyPack, operationId) {
  validateShareContract(loadedPolicyPack);
  assertAllowedKeys(action.payload, ["relationships"], "customerActionV2.payload");
  assertArray(action.payload.relationships, "customerActionV2.payload.relationships");
  if (action.payload.relationships.length === 0) throw new TypeError("structured ownership submission requires at least one relationship");
  const permittedTargets = new Set(bundle.canonicalSubject.entityIds);
  return action.payload.relationships.map((statement, index) => {
    const path = `customerActionV2.payload.relationships[${index}]`;
    assertPlainObject(statement, path);
    assertAllowedKeys(statement, [
      "localPartyKey", "owner", "targetEntityId", "concept", "direction", "relationshipType",
      "measurement", "assertionState", "asAtDate",
    ], path);
    assertNonEmptyString(statement.localPartyKey, `${path}.localPartyKey`);
    if (statement.concept !== "SHARE_OWNERSHIP") throw customerError(DECISION_APPLICATION_ERROR_CODE.ACTION_CONCEPT_MISMATCH, `${path}.concept must be SHARE_OWNERSHIP`);
    if (statement.direction !== "OWNER_TO_TARGET") throw customerError(DECISION_APPLICATION_ERROR_CODE.ACTION_DIRECTION_MISMATCH, `${path}.direction must be OWNER_TO_TARGET`);
    if (statement.relationshipType !== RELATIONSHIP_TYPE.ECONOMIC_OWNERSHIP) throw customerError(DECISION_APPLICATION_ERROR_CODE.ACTION_RELATIONSHIP_TYPE_MISMATCH, `${path}.relationshipType must be ECONOMIC_OWNERSHIP`);
    if (!permittedTargets.has(statement.targetEntityId)) throw customerError(DECISION_APPLICATION_ERROR_CODE.ACTION_TARGET_MISMATCH, `${path}.targetEntityId is not the planned subject`);
    if (statement.assertionState !== "CURRENT") throw new TypeError(`${path}.assertionState must be CURRENT`);
    requireTimestamp(statement.asAtDate, `${path}.asAtDate`);
    if (statement.asAtDate !== action.informationAsAtDate) throw new TypeError(`${path}.asAtDate must match customerActionV2.informationAsAtDate`);
    validatePercentageValue(statement.measurement, `${path}.measurement`);
    const owner = partyReference(statement.owner, `${path}.owner`);
    const target = partyReference({ localPartyKey: `target:${statement.targetEntityId}`, entityId: statement.targetEntityId }, `${path}.target`);
    const fact = {
      factId: stableId("customer-structured-ownership-fact-v2", { operationId, localPartyKey: statement.localPartyKey, index }),
      type: CANDIDATE_FACT_TYPE.RELATIONSHIP,
      subject: owner,
      object: target,
      relationship: RELATIONSHIP_TYPE.ECONOMIC_OWNERSHIP,
      measurement: cloneData(statement.measurement),
      qualifiers: {
        currentState: "CURRENT",
        economicInterestConcept: "SHARE_OWNERSHIP",
        informationAsAtDate: action.informationAsAtDate,
        sourceCustomerActionContract: CUSTOMER_ACTION_V2,
        sourceBundleId: action.bundleId,
        sourceResolutionActionId: action.resolutionActionId,
        localPartyKey: statement.localPartyKey,
      },
      evidenceReferences: [],
    };
    validateCandidateFact(fact, path);
    return fact;
  });
}

function entityAttributeFacts(action, bundle, operationId) {
  assertAllowedKeys(action.payload, ["entityId", "attributes"], "customerActionV2.payload");
  if (!bundle.canonicalSubject.entityIds.includes(action.payload.entityId)) throw customerError(
    DECISION_APPLICATION_ERROR_CODE.ACTION_TARGET_MISMATCH, "identity-attribute subject does not match the planned subject");
  assertPlainObject(action.payload.attributes, "customerActionV2.payload.attributes");
  const allowed = new Set(["date_of_birth", "country_of_nationality", "country_of_residence"]);
  const entries = Object.entries(action.payload.attributes);
  if (entries.length === 0) throw new TypeError("identity-attribute submission is empty");
  return entries.map(([attribute, value]) => {
    if (!allowed.has(attribute)) throw customerError(DECISION_APPLICATION_ERROR_CODE.UNAUTHORIZED_CUSTOMER_ACTION, `identity attribute ${attribute} is not supported`);
    if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${attribute} must be a non-empty string`);
    const fact = {
      factId: stableId("customer-identity-attribute-fact-v2", { operationId, attribute }),
      type: CANDIDATE_FACT_TYPE.ENTITY_ATTRIBUTE,
      subject: { entityId: action.payload.entityId, externalIdentifiers: [] },
      attribute,
      value: value.trim(),
      evidenceReferences: [],
    };
    validateCandidateFact(fact);
    return fact;
  });
}

function confirmation(action, bundle) {
  assertAllowedKeys(action.payload, ["confirmation", "establishedRelationshipIds", "establishedClaimIds"], "customerActionV2.payload");
  if (action.payload.confirmation !== "CONFIRMED") throw new TypeError("confirmation payload must state CONFIRMED");
  const relationshipIds = unique(action.payload.establishedRelationshipIds);
  const claimIds = unique(action.payload.establishedClaimIds);
  const knownRelationshipIds = new Set(bundle.knownInformation.relationships.map(({ relationshipId }) => relationshipId));
  const knownClaimIds = new Set(bundle.knownInformation.relationships.flatMap(({ supportingClaimIds = [] }) => supportingClaimIds));
  if (relationshipIds.length === 0 || relationshipIds.some((id) => !knownRelationshipIds.has(id))) throw customerError(
    DECISION_APPLICATION_ERROR_CODE.ACTION_TARGET_MISMATCH, "confirmation references a relationship outside the work bundle");
  if (claimIds.some((id) => !knownClaimIds.has(id))) throw customerError(
    DECISION_APPLICATION_ERROR_CODE.ACTION_TARGET_MISMATCH, "confirmation references a claim outside the work bundle");
  return {
    confirmationId: stableId("customer-confirmation-v2", { bundleId: bundle.bundleId, action }),
    status: "CONFIRMED",
    actorReference: cloneData(action.actorReference),
    actorCapacity: action.actorCapacity,
    submittedAt: action.submittedAt,
    informationAsAtDate: action.informationAsAtDate,
    sourceBundleId: bundle.bundleId,
    sourceResolutionActionId: action.resolutionActionId,
    establishedRelationshipIds: relationshipIds,
    establishedClaimIds: claimIds,
    independentEvidenceStillRequired: true,
  };
}

function correction(action, bundle, sourceSnapshot, operationId) {
  assertAllowedKeys(action.payload, [
    "confirmation", "affectedEntityIds", "affectedRelationshipIds", "changedFact", "effectiveDate",
    "sourceClaimIds", "requestEvidence",
  ], "customerActionV2.payload");
  if (action.payload.confirmation !== "CORRECTION_REQUIRED") throw new TypeError("correction payload must state CORRECTION_REQUIRED");
  requireTimestamp(action.payload.effectiveDate, "customerActionV2.payload.effectiveDate");
  const graph = sourceSnapshot.decisionContent.phaseArtifacts.find(({ phaseId }) => phaseId === "CANONICAL_GRAPH_AND_DEPTH").output.graph;
  const relationshipsById = new Map(graph.relationships.map((relationship) => [relationship.relationshipId, relationship]));
  const bundleRelationshipIds = new Set([
    ...bundle.linkedRelationshipIds,
    ...bundle.knownInformation.relationships.map(({ relationshipId }) => relationshipId),
  ]);
  const affectedRelationshipIds = unique(action.payload.affectedRelationshipIds);
  if (affectedRelationshipIds.length === 0 || affectedRelationshipIds.some((id) => !relationshipsById.has(id) || !bundleRelationshipIds.has(id))) {
    throw customerError(DECISION_APPLICATION_ERROR_CODE.ACTION_TARGET_MISMATCH, "correction must identify an established graph relationship");
  }
  const affectedRelationships = affectedRelationshipIds.map((id) => relationshipsById.get(id));
  const permittedEntityIds = new Set(affectedRelationships.flatMap(({ subjectEntityId, objectEntityId }) => [subjectEntityId, objectEntityId]));
  const affectedEntityIds = unique(action.payload.affectedEntityIds);
  if (affectedEntityIds.length === 0 || affectedEntityIds.some((id) => !permittedEntityIds.has(id))) {
    throw customerError(DECISION_APPLICATION_ERROR_CODE.ACTION_TARGET_MISMATCH, "correction affected entities must belong to the selected relationship");
  }
  const permittedClaimIds = new Set(affectedRelationships.flatMap(({ supportingClaimIds = [] }) => supportingClaimIds));
  const sourceClaimIds = unique(action.payload.sourceClaimIds);
  if (sourceClaimIds.length === 0 || sourceClaimIds.some((id) => !permittedClaimIds.has(id))) {
    throw customerError(DECISION_APPLICATION_ERROR_CODE.ACTION_TARGET_MISMATCH, "correction source claims must support the selected relationship");
  }
  assertPlainObject(action.payload.changedFact, "customerActionV2.payload.changedFact");
  const changedFact = cloneData(action.payload.changedFact);
  changedFact.factId = changedFact.factId || stableId("customer-correction-fact-v2", { operationId, affectedRelationshipIds });
  changedFact.evidenceReferences = changedFact.evidenceReferences || [];
  changedFact.qualifiers = {
    ...(changedFact.qualifiers || {}),
    customerCorrection: true,
    effectiveDate: action.payload.effectiveDate,
    sourceRelationshipIds: affectedRelationshipIds,
    sourceClaimIds,
  };
  validateCandidateFact(changedFact, "customerActionV2.payload.changedFact");
  return {
    candidateFact: changedFact,
    correctionRecord: {
      correctionId: stableId("customer-correction-v2", { operationId, affectedRelationshipIds }),
      status: "CANDIDATE_REVIEW_REQUIRED",
      affectedEntityIds,
      affectedRelationshipIds,
      sourceClaimIds,
      effectiveDate: action.payload.effectiveDate,
      evidenceHandoffRequested: action.payload.requestEvidence === true,
      historicalClaimsPreserved: true,
      actionProvenance: {
        actorReference: cloneData(action.actorReference),
        actorCapacity: action.actorCapacity,
        submittedAt: action.submittedAt,
        informationAsAtDate: action.informationAsAtDate,
      },
    },
  };
}

function evidenceHandoff(action, bundle, operationId) {
  assertAllowedKeys(action.payload, [
    "requestCorrelationId", "evidenceCategories", "requestedConcepts", "informationAsAtDate",
  ], "customerActionV2.payload");
  ["requestCorrelationId", "informationAsAtDate"].forEach((field) => assertNonEmptyString(action.payload[field], `customerActionV2.payload.${field}`));
  requireTimestamp(action.payload.informationAsAtDate, "customerActionV2.payload.informationAsAtDate");
  if (action.payload.informationAsAtDate !== action.informationAsAtDate) {
    throw new TypeError("customerActionV2.payload.informationAsAtDate must match customerActionV2.informationAsAtDate");
  }
  const semanticEvidenceCategories = unique(action.payload.evidenceCategories);
  const requestedConcepts = unique(action.payload.requestedConcepts);
  if (semanticEvidenceCategories.length === 0 || requestedConcepts.length === 0) throw new TypeError("external Evidence handoff requires semantic categories and requested concepts");
  if (action.payload.informationAsAtDate !== action.informationAsAtDate) {
    throw new TypeError("external Evidence handoff as-at date must match customerActionV2.informationAsAtDate");
  }
  const plannedCategories = unique(bundle.evidenceHandoff?.semanticEvidenceCategories);
  const plannedConcepts = unique(bundle.evidenceHandoff?.requestedConcepts);
  if ((plannedCategories.length > 0 && !same(semanticEvidenceCategories, plannedCategories))
    || (plannedConcepts.length > 0 && !same(requestedConcepts, plannedConcepts))) {
    throw customerError(DECISION_APPLICATION_ERROR_CODE.UNAUTHORIZED_CUSTOMER_ACTION,
      "external Evidence handoff categories and concepts must match the pinned work bundle");
  }
  requireExact(semanticEvidenceCategories, unique(bundle.evidenceHandoff?.semanticEvidenceCategories),
    DECISION_APPLICATION_ERROR_CODE.UNAUTHORIZED_CUSTOMER_ACTION, "external Evidence categories do not match the planned handoff");
  requireExact(requestedConcepts, unique(bundle.evidenceHandoff?.requestedConcepts),
    DECISION_APPLICATION_ERROR_CODE.UNAUTHORIZED_CUSTOMER_ACTION, "external Evidence concepts do not match the planned handoff");
  const semantic = {
    contractVersion: EXTERNAL_EVIDENCE_HANDOFF_V1,
    handoffType: "EXTERNAL_EVIDENCE_REQUIRED",
    status: "PENDING_EXTERNAL_ACTION",
    caseReference: cloneData(action.caseReference),
    sourceDecisionSnapshot: cloneData(action.sourceDecisionSnapshot),
    sourceResolutionPlan: cloneData(action.sourceResolutionPlan),
    bundleId: bundle.bundleId,
    resolutionGroupId: bundle.resolutionGroupId,
    resolutionActionId: action.resolutionActionId,
    informationNeedIds: cloneData(bundle.informationNeedIds),
    requirementIds: cloneData(bundle.requirementIds),
    canonicalSubject: cloneData(bundle.canonicalSubject),
    frontierEntityIds: cloneData(bundle.frontierEntityIds),
    semanticEvidenceCategories,
    requestedConcepts,
    expectedCandidateFacts: cloneData(bundle.missingInformation.map(({ requiredFact }) => requiredFact)),
    evaluationReIntakeCorrelation: {
      requestCorrelationId: action.payload.requestCorrelationId,
      sourceOperationId: operationId,
      requiredNextOperation: "HOST_EVIDENCE_INTEGRATION_THEN_DECISION_APPLICATION_V3_INTAKE",
    },
    informationAsAtDate: action.payload.informationAsAtDate,
    requestDoesNotResolveInformationNeed: true,
    acceptsFileBytes: false,
    createsEvidenceArtifact: false,
    executionConnected: false,
  };
  return { ...semantic, handoffId: stableId(EXTERNAL_EVIDENCE_HANDOFF_V1, semantic) };
}

function delegationHandoff(action, bundle) {
  assertAllowedKeys(action.payload, [
    "delegateReference", "delegateCapacity", "requestedWorkScope", "informationAsAtExpectation", "correlationId",
  ], "customerActionV2.payload");
  ["delegateReference", "delegateCapacity", "requestedWorkScope", "informationAsAtExpectation", "correlationId"]
    .forEach((field) => assertNonEmptyString(action.payload[field], `customerActionV2.payload.${field}`));
  requireTimestamp(action.payload.informationAsAtExpectation, "customerActionV2.payload.informationAsAtExpectation");
  const semantic = {
    contractVersion: CUSTOMER_WORK_DELEGATION_V1,
    sourceBundleId: bundle.bundleId,
    sourceResolutionGroupId: bundle.resolutionGroupId,
    sourceResolutionActionId: action.resolutionActionId,
    delegateReference: action.payload.delegateReference,
    delegateCapacity: action.payload.delegateCapacity,
    requestedWorkScope: action.payload.requestedWorkScope,
    informationAsAtExpectation: action.payload.informationAsAtExpectation,
    requestingActor: cloneData(action.actorReference),
    correlationId: action.payload.correlationId,
    executionOwner: "HOST",
    authorizationGranted: false,
    workCompleted: false,
  };
  return { ...semantic, delegationId: stableId(CUSTOMER_WORK_DELEGATION_V1, semantic) };
}

function applyCustomerInputV2({
  caseState,
  loadedPolicyPack,
  sourceDecisionSnapshot,
  sourceResolutionPlan,
  customerAction,
  operationId,
}) {
  try {
    validateActionShape(customerAction);
    assertNonEmptyString(operationId, "applyCustomerInputV2.operationId");
    const journey = validateSource(caseState, loadedPolicyPack, sourceDecisionSnapshot, sourceResolutionPlan, customerAction);
    const { bundle } = validatePlannedAction(customerAction, journey);
    let candidateFacts = [];
    let customerConfirmation = null;
    let correctionRecord = null;
    let externalEvidenceHandoff = null;
    let delegation = null;

    if (customerAction.actionType === CUSTOMER_ACTION_TYPE_V2.CONFIRM_ESTABLISHED_INFORMATION) {
      customerConfirmation = confirmation(customerAction, bundle);
    } else if (customerAction.actionType === CUSTOMER_ACTION_TYPE_V2.CORRECTION_REQUIRED) {
      const correctionResult = correction(customerAction, bundle, sourceDecisionSnapshot, operationId);
      candidateFacts = [correctionResult.candidateFact];
      correctionRecord = correctionResult.correctionRecord;
    } else if (customerAction.actionType === CUSTOMER_ACTION_TYPE_V2.SUBMIT_STRUCTURED_RELATIONSHIP) {
      candidateFacts = structuredRelationships(customerAction, bundle, loadedPolicyPack, operationId);
    } else if (customerAction.actionType === CUSTOMER_ACTION_TYPE_V2.SUBMIT_ENTITY_ATTRIBUTES) {
      candidateFacts = entityAttributeFacts(customerAction, bundle, operationId);
    } else if (customerAction.actionType === CUSTOMER_ACTION_TYPE_V2.REQUEST_EXTERNAL_EVIDENCE) {
      externalEvidenceHandoff = evidenceHandoff(customerAction, bundle, operationId);
    } else if (customerAction.actionType === CUSTOMER_ACTION_TYPE_V2.DELEGATE_CUSTOMER_WORK) {
      delegation = delegationHandoff(customerAction, bundle);
    }

    const customerInputId = stableId("customer-input-v2", {
      caseId: caseState.caseId,
      operationId,
      customerAction,
    });
    const minimalHandoffs = externalEvidenceHandoff ? [{
      handoffId: externalEvidenceHandoff.handoffId,
      handoffType: "EXTERNAL_EVIDENCE_REQUIRED",
      status: "PENDING_EXTERNAL_ACTION",
      customerInputId,
      operationId,
      snapshotId: customerAction.sourceDecisionSnapshot.snapshotId,
      snapshotHash: customerAction.sourceDecisionSnapshot.snapshotHash,
      bundleId: customerAction.bundleId,
      actionIds: [customerAction.resolutionActionId],
      informationNeedIds: cloneData(customerAction.informationNeedIds),
      requirementIds: cloneData(customerAction.requirementIds),
      evidenceTypes: cloneData(externalEvidenceHandoff.semanticEvidenceCategories),
      subject: cloneData(customerAction.canonicalSubject),
    }] : [];
    const record = {
      customerInputId,
      operationId,
      customerActionContractVersion: CUSTOMER_ACTION_V2,
      eventType: `CUSTOMER_ACTION_${customerAction.actionType}`,
      snapshotId: customerAction.sourceDecisionSnapshot.snapshotId,
      snapshotHash: customerAction.sourceDecisionSnapshot.snapshotHash,
      bundleId: customerAction.bundleId,
      workItemIds: [customerAction.bundleId],
      actionIntentIds: [customerAction.submissionContract],
      actionIds: [customerAction.resolutionActionId],
      informationNeedIds: cloneData(customerAction.informationNeedIds),
      requirementIds: cloneData(customerAction.requirementIds),
      subject: cloneData(customerAction.canonicalSubject),
      origin: "CUSTOMER",
      actorReference: cloneData(customerAction.actorReference),
      evaluationInputs: {
        customerActionV2: cloneData(customerAction),
        customerConfirmation,
        correctionRecord,
        externalEvidenceHandoff,
        delegation,
      },
      ...(customerConfirmation ? { confirmationResult: "CONFIRMED" } : {}),
      ...(correctionRecord ? { confirmationResult: "CORRECTION_REQUIRED", correctionRequested: true } : {}),
      claimIds: [],
      externalHandoffIds: [],
    };
    const nextCaseState = applyCustomerInputRecord(
      caseState,
      record,
      candidateFacts,
      [],
      [],
      minimalHandoffs,
      { recordedAt: customerAction.submittedAt },
    );
    const newClaimIds = cloneData(nextCaseState.customerInputRecords.at(-1).claimIds);
    const result = {
      contractVersion: CUSTOMER_ACTION_RESULT_V2,
      accepted: true,
      customerInputId,
      operationId,
      recordedInRevision: nextCaseState.revision,
      sourceDecisionSnapshot: cloneData(customerAction.sourceDecisionSnapshot),
      sourceResolutionPlan: cloneData(customerAction.sourceResolutionPlan),
      sourceWork: {
        bundleId: customerAction.bundleId,
        resolutionGroupId: customerAction.resolutionGroupId,
        resolutionActionId: customerAction.resolutionActionId,
        informationNeedIds: cloneData(customerAction.informationNeedIds),
      },
      actionProvenance: {
        actorReference: cloneData(customerAction.actorReference),
        actorCapacity: customerAction.actorCapacity,
        submittedAt: customerAction.submittedAt,
        informationAsAtDate: customerAction.informationAsAtDate,
        delegatedFrom: cloneData(customerAction.delegatedFrom || null),
      },
      customerConfirmation,
      customerOriginatedCandidateFacts: cloneData(candidateFacts),
      candidateParties: newClaimIds.flatMap((claimId, index) => {
        const fact = candidateFacts[index];
        return [
          { claimId, endpoint: "SUBJECT", candidateParty: cloneData(fact.subject) },
          ...(fact.type === CANDIDATE_FACT_TYPE.RELATIONSHIP
            ? [{ claimId, endpoint: "OBJECT", candidateParty: cloneData(fact.object) }] : []),
        ];
      }),
      identityDecisionTargets: newClaimIds.flatMap((claimId) => [
        { claimId, candidatePartyKey: `${claimId}:subject` },
        ...(nextCaseState.candidateClaims.find((claim) => claim.claimId === claimId)?.object
          ? [{ claimId, candidatePartyKey: `${claimId}:object` }] : []),
      ]),
      claimAdjudicationTargets: newClaimIds.map((claimId) => ({ claimId, currentState: "CANDIDATE" })),
      correctionTargets: correctionRecord ? [{
        correctionId: correctionRecord.correctionId,
        affectedRelationshipIds: correctionRecord.affectedRelationshipIds,
        state: "OPEN",
      }] : [],
      externalEvidenceHandoff,
      delegationHandoff: delegation,
      remainingOpenWorkReferences: cloneData(bundle.informationNeedIds),
      requiredNextOperation: externalEvidenceHandoff
        ? "HOST_EVIDENCE_INTEGRATION"
        : delegation
          ? "HOST_DELEGATION_EXECUTION"
          : newClaimIds.length > 0
            ? "APPLY_DECISIONS"
            : "EVALUATE",
      needSatisfiedByReceipt: false,
      hiddenEvaluationPerformed: false,
    };
    assertDataOnly(result, "customerActionResultV2");
    return deepFreeze({ caseState: nextCaseState, result: cloneData(result) });
  } catch (error) {
    if (error instanceof DecisionApplicationError) throw error;
    throw customerError(DECISION_APPLICATION_ERROR_CODE.INVALID_CUSTOMER_ACTION, error.message, error);
  }
}

module.exports = {
  CUSTOMER_ACTION_RESULT_V2,
  CUSTOMER_ACTION_V2,
  applyCustomerInputV2,
};
