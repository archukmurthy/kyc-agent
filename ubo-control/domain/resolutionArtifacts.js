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

const INFORMATION_NEED_STATE = Object.freeze({
  OPEN: "OPEN",
  SATISFIED: "SATISFIED",
  SUPERSEDED: "SUPERSEDED",
});

const INFORMATION_NEED_CONCEPT = Object.freeze({
  CURRENT_OWNERSHIP_AND_CONTROL: "CURRENT_OWNERSHIP_AND_CONTROL",
  ENTITY_PROFILE: "ENTITY_PROFILE",
  ENTITY_EXISTENCE: "ENTITY_EXISTENCE",
  RELATIONSHIP_EVIDENCE: "RELATIONSHIP_EVIDENCE",
  PERCENTAGE_OR_RANGE: "PERCENTAGE_OR_RANGE",
  VOTING_RIGHTS: "VOTING_RIGHTS",
  APPOINTMENT_REMOVAL_RIGHTS: "APPOINTMENT_REMOVAL_RIGHTS",
  OTHER_SIGNIFICANT_CONTROL: "OTHER_SIGNIFICANT_CONTROL",
  IDENTITY_ATTRIBUTE: "IDENTITY_ATTRIBUTE",
  INDEPENDENT_CORROBORATION: "INDEPENDENT_CORROBORATION",
  UNDERLYING_NOMINEE_PRINCIPAL: "UNDERLYING_NOMINEE_PRINCIPAL",
  TRUST_INVOLVEMENT: "TRUST_INVOLVEMENT",
  NOMINEE_OR_BEARER_STATUS: "NOMINEE_OR_BEARER_STATUS",
  SENIOR_MANAGEMENT_CANDIDATE: "SENIOR_MANAGEMENT_CANDIDATE",
});

const POLICY_GAP_STATE = Object.freeze({ OPEN: "OPEN" });
const OPERATIONAL_BLOCKER_STATE = Object.freeze({ OPEN: "OPEN" });

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

function semanticTarget(draft) {
  return {
    ...(draft.subjectEntityId ? { subjectEntityId: draft.subjectEntityId } : {}),
    concept: draft.concept,
    ...(draft.relationshipId ? { relationshipId: draft.relationshipId } : {}),
    ...(draft.attribute ? { attribute: draft.attribute } : {}),
  };
}

function needId(caseId, draft) {
  return `information-need:${digest({ caseId, ...semanticTarget(draft) })}`;
}

function validateNeedDraft(draft, path) {
  assertPlainObject(draft, path);
  assertAllowedKeys(draft, [
    "subjectEntityId",
    "requiredBy",
    "concept",
    "relationshipId",
    "attribute",
    "reasonCodes",
    "claimIds",
    "calculationReferences",
    "conflictReferences",
    "existingEvidenceReferences",
    "permittedResolutionStrategies",
  ], path);
  assertOptionalNonEmptyString(draft.subjectEntityId, `${path}.subjectEntityId`);
  assertArray(draft.requiredBy, `${path}.requiredBy`);
  draft.requiredBy.forEach((value, index) => assertNonEmptyString(value, `${path}.requiredBy[${index}]`));
  if (draft.requiredBy.length === 0) fail(`${path}.requiredBy must not be empty`);
  assertEnum(draft.concept, INFORMATION_NEED_CONCEPT, `${path}.concept`);
  assertOptionalNonEmptyString(draft.relationshipId, `${path}.relationshipId`);
  assertOptionalNonEmptyString(draft.attribute, `${path}.attribute`);
  ["reasonCodes", "claimIds", "conflictReferences", "permittedResolutionStrategies"].forEach((field) => {
    assertArray(draft[field] || [], `${path}.${field}`);
    (draft[field] || []).forEach((value, index) => assertNonEmptyString(value, `${path}.${field}[${index}]`));
  });
  (draft.permittedResolutionStrategies || []).forEach((strategy, index) => {
    assertEnum(strategy, RESOLUTION_STRATEGY, `${path}.permittedResolutionStrategies[${index}]`);
  });
  assertArray(draft.calculationReferences || [], `${path}.calculationReferences`);
  (draft.calculationReferences || []).forEach((reference, index) => assertDataOnly(reference, `${path}.calculationReferences[${index}]`));
  assertArray(draft.existingEvidenceReferences || [], `${path}.existingEvidenceReferences`);
  (draft.existingEvidenceReferences || []).forEach((reference, index) => validateEvidenceReference(reference, `${path}.existingEvidenceReferences[${index}]`));
}

function mergeNeedDrafts(caseId, drafts) {
  const merged = new Map();
  drafts.forEach((draft, index) => {
    validateNeedDraft(draft, `informationNeedDrafts[${index}]`);
    const id = needId(caseId, draft);
    if (!merged.has(id)) {
      merged.set(id, {
        needId: id,
        ...semanticTarget(draft),
        requiredBy: [],
        reasonCodes: [],
        claimIds: [],
        calculationReferences: [],
        conflictReferences: [],
        existingEvidenceReferences: [],
        permittedResolutionStrategies: [],
      });
    }
    const target = merged.get(id);
    target.requiredBy.push(...draft.requiredBy);
    target.reasonCodes.push(...(draft.reasonCodes || []));
    target.claimIds.push(...(draft.claimIds || []));
    target.calculationReferences.push(...(draft.calculationReferences || []));
    target.conflictReferences.push(...(draft.conflictReferences || []));
    target.existingEvidenceReferences.push(...(draft.existingEvidenceReferences || []));
    target.permittedResolutionStrategies.push(...(draft.permittedResolutionStrategies || []));
  });
  return [...merged.values()].map((draft) => ({
    ...draft,
    requiredBy: uniqueSorted(draft.requiredBy),
    reasonCodes: uniqueSorted(draft.reasonCodes),
    claimIds: uniqueSorted(draft.claimIds),
    calculationReferences: uniqueData(draft.calculationReferences),
    conflictReferences: uniqueSorted(draft.conflictReferences),
    existingEvidenceReferences: uniqueData(draft.existingEvidenceReferences),
    permittedResolutionStrategies: uniqueSorted(draft.permittedResolutionStrategies),
  })).sort((left, right) => left.needId.localeCompare(right.needId));
}

function validateInformationNeedRecord(record, path = "informationNeed") {
  assertPlainObject(record, path);
  assertAllowedKeys(record, [
    "needId",
    "needRecordId",
    "caseReference",
    "subjectEntityId",
    "requiredBy",
    "concept",
    "relationshipId",
    "attribute",
    "reasonCodes",
    "claimIds",
    "calculationReferences",
    "conflictReferences",
    "existingEvidenceReferences",
    "permittedResolutionStrategies",
    "state",
    "supersedesNeedRecordId",
  ], path);
  assertNonEmptyString(record.needId, `${path}.needId`);
  assertNonEmptyString(record.needRecordId, `${path}.needRecordId`);
  assertPlainObject(record.caseReference, `${path}.caseReference`);
  assertNonEmptyString(record.caseReference.caseId, `${path}.caseReference.caseId`);
  assertNonEmptyString(record.caseReference.revisionId, `${path}.caseReference.revisionId`);
  if (!Number.isSafeInteger(record.caseReference.revision) || record.caseReference.revision < 1) fail(`${path}.caseReference.revision must be positive`);
  assertOptionalNonEmptyString(record.subjectEntityId, `${path}.subjectEntityId`);
  assertArray(record.requiredBy, `${path}.requiredBy`);
  record.requiredBy.forEach((value, index) => assertNonEmptyString(value, `${path}.requiredBy[${index}]`));
  assertEnum(record.concept, INFORMATION_NEED_CONCEPT, `${path}.concept`);
  assertOptionalNonEmptyString(record.relationshipId, `${path}.relationshipId`);
  assertOptionalNonEmptyString(record.attribute, `${path}.attribute`);
  ["reasonCodes", "claimIds", "conflictReferences", "permittedResolutionStrategies"].forEach((field) => {
    assertArray(record[field], `${path}.${field}`);
  });
  record.permittedResolutionStrategies.forEach((strategy, index) => assertEnum(strategy, RESOLUTION_STRATEGY, `${path}.permittedResolutionStrategies[${index}]`));
  assertArray(record.calculationReferences, `${path}.calculationReferences`);
  assertArray(record.existingEvidenceReferences, `${path}.existingEvidenceReferences`);
  record.existingEvidenceReferences.forEach((reference, index) => validateEvidenceReference(reference, `${path}.existingEvidenceReferences[${index}]`));
  assertEnum(record.state, INFORMATION_NEED_STATE, `${path}.state`);
  assertOptionalNonEmptyString(record.supersedesNeedRecordId, `${path}.supersedesNeedRecordId`);
  assertDataOnly(record, path);
  return true;
}

function makeNeedRecord(caseState, draft, state, supersedesNeedRecordId) {
  const record = {
    ...cloneData(draft),
    caseReference: { caseId: caseState.caseId, revisionId: caseState.revisionId, revision: caseState.revision },
    state,
  };
  if (supersedesNeedRecordId) record.supersedesNeedRecordId = supersedesNeedRecordId;
  record.needRecordId = `information-need-record:${digest(record)}`;
  validateInformationNeedRecord(record);
  return record;
}

function reconcileInformationNeeds({ caseState, drafts, priorRecords = [] }) {
  validateOwnershipCase(caseState);
  assertArray(drafts, "informationNeedDrafts");
  assertArray(priorRecords, "priorInformationNeedRecords");
  priorRecords.forEach((record, index) => validateInformationNeedRecord(record, `priorInformationNeedRecords[${index}]`));
  priorRecords.forEach((record, index) => {
    if (record.caseReference.caseId !== caseState.caseId) {
      fail(`priorInformationNeedRecords[${index}] belongs to a different OwnershipCase`);
    }
  });
  const merged = mergeNeedDrafts(caseState.caseId, drafts);
  const latestByNeed = new Map();
  priorRecords.forEach((record) => latestByNeed.set(record.needId, record));
  const appended = [];
  merged.forEach((draft) => {
    const prior = latestByNeed.get(draft.needId);
    const proposed = makeNeedRecord(caseState, draft, INFORMATION_NEED_STATE.OPEN, prior?.needRecordId);
    if (!prior || prior.needRecordId !== proposed.needRecordId) appended.push(proposed);
  });
  latestByNeed.forEach((prior, id) => {
    if (prior.state === INFORMATION_NEED_STATE.OPEN && !merged.some(({ needId: currentId }) => currentId === id)) {
      const { needRecordId: ignored, caseReference: ignoredCase, state: ignoredState, supersedesNeedRecordId: ignoredPrior, ...draft } = prior;
      appended.push(makeNeedRecord(caseState, draft, INFORMATION_NEED_STATE.SATISFIED, prior.needRecordId));
    }
  });
  const sequence = [...priorRecords.map(cloneData), ...appended];
  const history = [...sequence].sort((left, right) => left.needRecordId.localeCompare(right.needRecordId));
  const currentByNeed = new Map();
  sequence.forEach((record) => currentByNeed.set(record.needId, record));
  return deepFreeze({
    current: [...currentByNeed.values()].sort((left, right) => left.needId.localeCompare(right.needId)),
    history,
  });
}

function createPolicyGap({ caseState, requirementId, informationNeedIds, reasonCode, references = {} }) {
  validateOwnershipCase(caseState);
  assertNonEmptyString(requirementId, "policyGap.requirementId");
  assertArray(informationNeedIds, "policyGap.informationNeedIds");
  assertNonEmptyString(reasonCode, "policyGap.reasonCode");
  assertPlainObject(references, "policyGap.references");
  assertDataOnly(references, "policyGap.references");
  const payload = {
    caseReference: { caseId: caseState.caseId, revisionId: caseState.revisionId, revision: caseState.revision },
    requirementId,
    informationNeedIds: uniqueSorted(informationNeedIds),
    reasonCode,
    references: cloneData(references),
    status: POLICY_GAP_STATE.OPEN,
  };
  return deepFreeze({ gapId: `policy-gap:${digest(payload)}`, ...payload });
}

function createOperationalBlockers({ caseState, operationContexts = [] }) {
  validateOwnershipCase(caseState);
  assertArray(operationContexts, "operationContexts");
  const blockers = [];
  operationContexts.forEach((context, index) => {
    assertPlainObject(context, `operationContexts[${index}]`);
    assertAllowedKeys(context, ["operationId", "requirementIds", "informationNeedIds", "operationalOnly"], `operationContexts[${index}]`);
    assertNonEmptyString(context.operationId, `operationContexts[${index}].operationId`);
    assertArray(context.requirementIds || [], `operationContexts[${index}].requirementIds`);
    assertArray(context.informationNeedIds || [], `operationContexts[${index}].informationNeedIds`);
    if (context.operationalOnly !== undefined && typeof context.operationalOnly !== "boolean") fail(`operationContexts[${index}].operationalOnly must be boolean`);
    const operation = caseState.capabilityOperations.find(({ operationId }) => operationId === context.operationId);
    if (!operation) fail(`operationContexts[${index}] references unknown capability operation`);
    if (!["UNAVAILABLE", "FAILED"].includes(operation.outcome.state)) return;
    const payload = {
      caseReference: { caseId: caseState.caseId, revisionId: caseState.revisionId, revision: caseState.revision },
      capabilityOperation: {
        operationId: operation.operationId,
        capabilityRequestId: operation.capabilityRequestId,
        outcomeState: operation.outcome.state,
        ...(operation.outcome.code ? { outcomeCode: operation.outcome.code } : {}),
      },
      affectedRequirementIds: uniqueSorted(context.requirementIds || []),
      affectedInformationNeedIds: uniqueSorted(context.informationNeedIds || []),
      reasonCode: operation.outcome.code || `CAPABILITY_${operation.outcome.state}`,
      operationalOnly: context.operationalOnly === true,
      status: OPERATIONAL_BLOCKER_STATE.OPEN,
    };
    if (typeof operation.outcome.retryable === "boolean") payload.retryable = operation.outcome.retryable;
    blockers.push({ blockerId: `operational-blocker:${digest(payload)}`, ...payload });
  });
  return deepFreeze(blockers.sort((left, right) => left.blockerId.localeCompare(right.blockerId)));
}

module.exports = {
  INFORMATION_NEED_CONCEPT,
  INFORMATION_NEED_STATE,
  OPERATIONAL_BLOCKER_STATE,
  POLICY_GAP_STATE,
  createOperationalBlockers,
  createPolicyGap,
  reconcileInformationNeeds,
  validateInformationNeedRecord,
};
