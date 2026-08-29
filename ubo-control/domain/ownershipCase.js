"use strict";

const { isDeepStrictEqual } = require("node:util");
const { validateCapabilityResult } = require("../contracts/capability");
const {
  CAPABILITY_OUTCOME_STATE,
  CANDIDATE_FACT_TYPE,
  CLAIM_STATE,
  IDENTITY_RESOLUTION_STATUS,
} = require("../contracts/constants");
const { validateEvidenceReference } = require("../contracts/evidenceReference");
const { validateIdentityResolutionDecision } = require("../contracts/identityResolutionDecision");
const { validateCandidatePartyReference } = require("../contracts/candidatePartyReference");
const {
  assertAllowedKeys,
  assertArray,
  assertDataOnly,
  assertEnum,
  assertNonEmptyString,
  assertOptionalNonEmptyString,
  assertPlainObject,
  assertUniqueStrings,
  cloneData,
  deepFreeze,
  fail,
} = require("../internal/validation");
const {
  createCanonicalEntityRecord,
  validateCanonicalEntityRecord,
} = require("./canonicalEntity");
const { createCandidateClaim, validateCandidateClaim } = require("./candidateClaim");

const CASE_EVENT_TYPE = Object.freeze({
  CASE_CREATED: "CASE_CREATED",
  CANONICAL_ENTITY_ADDED: "CANONICAL_ENTITY_ADDED",
  CAPABILITY_RESULT_INTAKEN: "CAPABILITY_RESULT_INTAKEN",
  IDENTITY_DECISION_RECORDED: "IDENTITY_DECISION_RECORDED",
  CLAIM_ADJUDICATED: "CLAIM_ADJUDICATED",
});

const GRAPH_ELIGIBILITY_STATUS = Object.freeze({
  GRAPH_ELIGIBLE: "GRAPH_ELIGIBLE",
  NOT_GRAPH_ELIGIBLE: "NOT_GRAPH_ELIGIBLE",
});

const CLAIMABLE_OUTCOMES = new Set([
  CAPABILITY_OUTCOME_STATE.COMPLETE,
  CAPABILITY_OUTCOME_STATE.PARTIAL,
  CAPABILITY_OUTCOME_STATE.INCONCLUSIVE,
]);

const TERMINAL_CLAIM_STATES = new Set([CLAIM_STATE.SUPERSEDED, CLAIM_STATE.REJECTED]);

function validateTimestamp(value, path) {
  assertNonEmptyString(value, path);
  if (Number.isNaN(Date.parse(value))) fail(`${path} must be an ISO-compatible timestamp`);
}

function validateExternalReference(reference, path) {
  assertPlainObject(reference, path);
  assertAllowedKeys(reference, ["system", "referenceType", "referenceId"], path);
  assertNonEmptyString(reference.system, `${path}.system`);
  assertOptionalNonEmptyString(reference.referenceType, `${path}.referenceType`);
  assertNonEmptyString(reference.referenceId, `${path}.referenceId`);
}

function revisionId(caseId, revision) {
  return `${caseId}:revision:${revision}`;
}

function eventId(caseId, revision) {
  return `${caseId}:event:${revision}`;
}

function validateCaseEvent(event, path) {
  assertPlainObject(event, path);
  assertAllowedKeys(event, ["eventId", "eventType", "revision", "occurredAt", "data"], path);
  assertNonEmptyString(event.eventId, `${path}.eventId`);
  assertEnum(event.eventType, CASE_EVENT_TYPE, `${path}.eventType`);
  if (!Number.isSafeInteger(event.revision) || event.revision < 1) {
    fail(`${path}.revision must be a positive safe integer`);
  }
  validateTimestamp(event.occurredAt, `${path}.occurredAt`);
  assertPlainObject(event.data, `${path}.data`);
  assertDataOnly(event.data, `${path}.data`);
}

function validateCapabilityOperation(operation, path) {
  assertPlainObject(operation, path);
  assertAllowedKeys(operation, [
    "operationId",
    "capabilityRequestId",
    "outcome",
    "operationEvidenceReferences",
    "issues",
    "candidateFactReferences",
    "claimIds",
    "recordedAt",
    "recordedInRevision",
  ], path);
  assertNonEmptyString(operation.operationId, `${path}.operationId`);
  assertNonEmptyString(operation.capabilityRequestId, `${path}.capabilityRequestId`);
  assertPlainObject(operation.outcome, `${path}.outcome`);
  assertDataOnly(operation.outcome, `${path}.outcome`);
  assertArray(operation.operationEvidenceReferences, `${path}.operationEvidenceReferences`);
  operation.operationEvidenceReferences.forEach((reference, index) => {
    validateEvidenceReference(reference, `${path}.operationEvidenceReferences[${index}]`);
  });
  assertArray(operation.issues, `${path}.issues`);
  operation.issues.forEach((issue, index) => assertDataOnly(issue, `${path}.issues[${index}]`));
  assertArray(operation.candidateFactReferences, `${path}.candidateFactReferences`);
  operation.candidateFactReferences.forEach((reference, index) => {
    assertPlainObject(reference, `${path}.candidateFactReferences[${index}]`);
    assertOptionalNonEmptyString(reference.candidateFactId, `${path}.candidateFactReferences[${index}].candidateFactId`);
    if (!Number.isSafeInteger(reference.candidateFactIndex) || reference.candidateFactIndex < 0) {
      fail(`${path}.candidateFactReferences[${index}].candidateFactIndex must be non-negative`);
    }
  });
  assertArray(operation.claimIds, `${path}.claimIds`);
  operation.claimIds.forEach((claimId, index) => assertNonEmptyString(claimId, `${path}.claimIds[${index}]`));
  validateTimestamp(operation.recordedAt, `${path}.recordedAt`);
  if (!Number.isSafeInteger(operation.recordedInRevision) || operation.recordedInRevision < 1) {
    fail(`${path}.recordedInRevision must be a positive safe integer`);
  }
}

function validateAdjudicationRecord(record, path) {
  assertPlainObject(record, path);
  assertAllowedKeys(record, [
    "decisionId",
    "claimId",
    "previousState",
    "resultingState",
    "reasonBasisCode",
    "supportingEvidenceReferences",
    "decisionOrigin",
    "decisionActor",
    "decidedAt",
    "supersededByClaimIds",
    "adversarialClaimIds",
    "recordedInRevision",
  ], path);
  assertNonEmptyString(record.decisionId, `${path}.decisionId`);
  assertNonEmptyString(record.claimId, `${path}.claimId`);
  assertEnum(record.previousState, CLAIM_STATE, `${path}.previousState`);
  assertEnum(record.resultingState, CLAIM_STATE, `${path}.resultingState`);
  assertNonEmptyString(record.reasonBasisCode, `${path}.reasonBasisCode`);
  assertArray(record.supportingEvidenceReferences, `${path}.supportingEvidenceReferences`);
  record.supportingEvidenceReferences.forEach((reference, index) => {
    validateEvidenceReference(reference, `${path}.supportingEvidenceReferences[${index}]`);
  });
  assertNonEmptyString(record.decisionOrigin, `${path}.decisionOrigin`);
  assertOptionalNonEmptyString(record.decisionActor, `${path}.decisionActor`);
  validateTimestamp(record.decidedAt, `${path}.decidedAt`);
  ["supersededByClaimIds", "adversarialClaimIds"].forEach((field) => {
    assertArray(record[field], `${path}.${field}`);
    record[field].forEach((claimId, index) => assertNonEmptyString(claimId, `${path}.${field}[${index}]`));
  });
  if (!Number.isSafeInteger(record.recordedInRevision) || record.recordedInRevision < 1) {
    fail(`${path}.recordedInRevision must be a positive safe integer`);
  }
}

function validateOwnershipCase(caseState) {
  assertPlainObject(caseState, "ownershipCase");
  assertNonEmptyString(caseState.caseId, "ownershipCase.caseId");
  validateCandidatePartyReference(caseState.subjectReference, "ownershipCase.subjectReference");
  assertArray(caseState.externalReferences, "ownershipCase.externalReferences");
  caseState.externalReferences.forEach((reference, index) => {
    validateExternalReference(reference, `ownershipCase.externalReferences[${index}]`);
  });
  validateTimestamp(caseState.createdAt, "ownershipCase.createdAt");
  validateTimestamp(caseState.updatedAt, "ownershipCase.updatedAt");
  if (!Number.isSafeInteger(caseState.revision) || caseState.revision < 1) {
    fail("ownershipCase.revision must be a positive safe integer");
  }
  if (caseState.revisionId !== revisionId(caseState.caseId, caseState.revision)) {
    fail("ownershipCase.revisionId must match its deterministic revision");
  }
  assertArray(caseState.canonicalEntities, "ownershipCase.canonicalEntities");
  caseState.canonicalEntities.forEach((entity, index) => validateCanonicalEntityRecord(entity, `ownershipCase.canonicalEntities[${index}]`));
  assertUniqueStrings(caseState.canonicalEntities.map(({ entityId }) => entityId), "ownershipCase canonical entity IDs");
  assertArray(caseState.candidateClaims, "ownershipCase.candidateClaims");
  caseState.candidateClaims.forEach((claim, index) => validateCandidateClaim(claim, `ownershipCase.candidateClaims[${index}]`));
  assertUniqueStrings(caseState.candidateClaims.map(({ claimId }) => claimId), "ownershipCase claim IDs");
  assertArray(caseState.identityDecisions, "ownershipCase.identityDecisions");
  caseState.identityDecisions.forEach((decision, index) => {
    validateIdentityResolutionDecision(decision);
    if (!Number.isSafeInteger(decision.recordedInRevision) || decision.recordedInRevision < 1 || decision.recordedInRevision > caseState.revision) {
      fail(`ownershipCase.identityDecisions[${index}].recordedInRevision must identify an existing revision`);
    }
  });
  assertUniqueStrings(caseState.identityDecisions.map(({ decisionId }) => decisionId), "ownershipCase identity decision IDs");
  assertArray(caseState.claimAdjudications, "ownershipCase.claimAdjudications");
  caseState.claimAdjudications.forEach((record, index) => validateAdjudicationRecord(record, `ownershipCase.claimAdjudications[${index}]`));
  assertUniqueStrings(caseState.claimAdjudications.map(({ decisionId }) => decisionId), "ownershipCase adjudication decision IDs");
  assertArray(caseState.capabilityOperations, "ownershipCase.capabilityOperations");
  caseState.capabilityOperations.forEach((operation, index) => validateCapabilityOperation(operation, `ownershipCase.capabilityOperations[${index}]`));
  assertUniqueStrings(caseState.capabilityOperations.map(({ operationId }) => operationId), "ownershipCase capability operation IDs");
  assertArray(caseState.events, "ownershipCase.events");
  if (caseState.events.length !== caseState.revision) fail("ownershipCase events must cover every revision");
  caseState.events.forEach((event, index) => {
    validateCaseEvent(event, `ownershipCase.events[${index}]`);
    const expectedRevision = index + 1;
    if (event.revision !== expectedRevision || event.eventId !== eventId(caseState.caseId, expectedRevision)) {
      fail(`ownershipCase.events[${index}] must match its deterministic revision identity`);
    }
  });
  assertUniqueStrings(caseState.events.map(({ eventId: id }) => id), "ownershipCase event IDs");
  caseState.candidateClaims.forEach((claim) => {
    let reconstructedState = CLAIM_STATE.CANDIDATE;
    caseState.claimAdjudications
      .filter(({ claimId }) => claimId === claim.claimId)
      .forEach((record) => {
        if (record.previousState !== reconstructedState) fail(`claim ${claim.claimId} adjudication history is not contiguous`);
        reconstructedState = record.resultingState;
      });
    if (claim.status !== reconstructedState) fail(`claim ${claim.claimId} projected state does not match adjudication history`);
  });
  assertDataOnly(caseState, "ownershipCase");
  return true;
}

function createOwnershipCase(input) {
  assertPlainObject(input, "ownershipCaseInput");
  assertAllowedKeys(input, ["caseId", "subjectReference", "externalReferences", "createdAt"], "ownershipCaseInput");
  assertNonEmptyString(input.caseId, "ownershipCaseInput.caseId");
  validateCandidatePartyReference(input.subjectReference, "ownershipCaseInput.subjectReference");
  const externalReferences = cloneData(input.externalReferences || []);
  externalReferences.forEach((reference, index) => validateExternalReference(reference, `ownershipCaseInput.externalReferences[${index}]`));
  validateTimestamp(input.createdAt, "ownershipCaseInput.createdAt");
  const revision = 1;
  const caseState = {
    caseId: input.caseId,
    subjectReference: cloneData(input.subjectReference),
    externalReferences,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    revision,
    revisionId: revisionId(input.caseId, revision),
    canonicalEntities: [],
    candidateClaims: [],
    identityDecisions: [],
    claimAdjudications: [],
    capabilityOperations: [],
    events: [{
      eventId: eventId(input.caseId, revision),
      eventType: CASE_EVENT_TYPE.CASE_CREATED,
      revision,
      occurredAt: input.createdAt,
      data: {},
    }],
  };
  validateOwnershipCase(caseState);
  return deepFreeze(caseState);
}

function nextRevision(caseState, eventType, occurredAt, data, apply) {
  validateOwnershipCase(caseState);
  validateTimestamp(occurredAt, "caseEvent.occurredAt");
  assertPlainObject(data, "caseEvent.data");
  assertDataOnly(data, "caseEvent.data");
  const draft = cloneData(caseState);
  const revision = caseState.revision + 1;
  apply(draft, revision);
  draft.updatedAt = occurredAt;
  draft.revision = revision;
  draft.revisionId = revisionId(caseState.caseId, revision);
  draft.events.push({
    eventId: eventId(caseState.caseId, revision),
    eventType,
    revision,
    occurredAt,
    data: cloneData(data),
  });
  validateOwnershipCase(draft);
  return deepFreeze(draft);
}

function addCanonicalEntity(caseState, entityInput, { recordedAt }) {
  validateOwnershipCase(caseState);
  if (caseState.canonicalEntities.some(({ entityId }) => entityId === entityInput.entityId)) {
    fail(`canonical entity ${entityInput.entityId} already exists in case`);
  }
  return nextRevision(
    caseState,
    CASE_EVENT_TYPE.CANONICAL_ENTITY_ADDED,
    recordedAt,
    { entityId: entityInput.entityId },
    (draft, revision) => {
      draft.canonicalEntities.push(createCanonicalEntityRecord(entityInput, {
        createdAt: recordedAt,
        createdInRevision: revision,
      }));
    },
  );
}

function claimIdFor(caseId, operationId, fact, index) {
  const factIdentity = fact.factId || `fact-${index + 1}`;
  return `${caseId}:claim:${operationId}:${factIdentity}`;
}

function intakeCapabilityResult(caseState, capabilityResult, { operationId, recordedAt }) {
  validateOwnershipCase(caseState);
  validateCapabilityResult(capabilityResult);
  assertNonEmptyString(operationId, "capabilityIntake.operationId");
  validateTimestamp(recordedAt, "capabilityIntake.recordedAt");
  if (caseState.capabilityOperations.some((operation) => operation.operationId === operationId)) {
    fail(`capability operation ${operationId} already exists in case`);
  }
  const claimable = CLAIMABLE_OUTCOMES.has(capabilityResult.outcome.state);
  const claimIds = claimable
    ? capabilityResult.candidateFacts.map((fact, index) => claimIdFor(caseState.caseId, operationId, fact, index))
    : [];
  if (new Set(claimIds).size !== claimIds.length) fail("capability intake produced duplicate stable claim identifiers");
  if (claimIds.some((claimId) => caseState.candidateClaims.some((claim) => claim.claimId === claimId))) {
    fail("capability intake claim identifier already exists in case");
  }

  return nextRevision(
    caseState,
    CASE_EVENT_TYPE.CAPABILITY_RESULT_INTAKEN,
    recordedAt,
    { operationId, capabilityRequestId: capabilityResult.requestId, claimIds },
    (draft, revision) => {
      const claims = claimable
        ? capabilityResult.candidateFacts.map((fact, index) => createCandidateClaim(fact, {
          claimId: claimIds[index],
          operationId,
          capabilityRequestId: capabilityResult.requestId,
          candidateFactIndex: index,
          createdAt: recordedAt,
          createdInRevision: revision,
        }))
        : [];
      draft.candidateClaims.push(...claims);
      draft.capabilityOperations.push({
        operationId,
        capabilityRequestId: capabilityResult.requestId,
        outcome: cloneData(capabilityResult.outcome),
        operationEvidenceReferences: cloneData(capabilityResult.operationEvidenceReferences),
        issues: cloneData(capabilityResult.issues),
        candidateFactReferences: capabilityResult.candidateFacts.map((fact, candidateFactIndex) => {
          const reference = { candidateFactIndex };
          if (fact.factId !== undefined) reference.candidateFactId = fact.factId;
          return reference;
        }),
        claimIds: cloneData(claimIds),
        recordedAt,
        recordedInRevision: revision,
      });
    },
  );
}

function endpointForKey(caseState, candidatePartyKey) {
  for (const claim of caseState.candidateClaims) {
    if (claim.subject.candidatePartyKey === candidatePartyKey) return claim.subject;
    if (claim.object && claim.object.candidatePartyKey === candidatePartyKey) return claim.object;
  }
  return undefined;
}

function recordIdentityResolutionDecision(caseState, inputDecision) {
  validateOwnershipCase(caseState);
  assertPlainObject(inputDecision, "identityResolutionDecision");
  assertNonEmptyString(inputDecision.candidatePartyKey, "identityResolutionDecision.candidatePartyKey");
  const endpoint = endpointForKey(caseState, inputDecision.candidatePartyKey);
  if (!endpoint) fail(`identity decision candidatePartyKey ${inputDecision.candidatePartyKey} is not present in the case`);
  const decision = cloneData(inputDecision);
  if (decision.candidateParty === undefined) decision.candidateParty = cloneData(endpoint.party);
  if (!isDeepStrictEqual(decision.candidateParty, endpoint.party)) {
    fail("identity decision candidateParty must match the keyed candidate party exactly");
  }
  validateIdentityResolutionDecision(decision);
  if (caseState.identityDecisions.some(({ decisionId }) => decisionId === decision.decisionId)) {
    fail(`identity decision ${decision.decisionId} already exists in case`);
  }
  if (decision.status === IDENTITY_RESOLUTION_STATUS.UNRESOLVED && decision.entityId !== undefined) {
    fail("UNRESOLVED identity decisions cannot carry entityId");
  }
  if (decision.entityId !== undefined && !caseState.canonicalEntities.some(({ entityId }) => entityId === decision.entityId)) {
    fail(`identity decision references unknown canonical entity ${decision.entityId}`);
  }

  return nextRevision(
    caseState,
    CASE_EVENT_TYPE.IDENTITY_DECISION_RECORDED,
    decision.decidedAt,
    {
      decisionId: decision.decisionId,
      candidatePartyKey: decision.candidatePartyKey,
      status: decision.status,
      ...(decision.entityId === undefined ? {} : { entityId: decision.entityId }),
    },
    (draft, revision) => {
      draft.identityDecisions.push({ ...decision, recordedInRevision: revision });
    },
  );
}

function validateClaimReferences(caseState, claimIds, path) {
  assertArray(claimIds, path);
  const seen = new Set();
  claimIds.forEach((claimId, index) => {
    assertNonEmptyString(claimId, `${path}[${index}]`);
    if (seen.has(claimId)) fail(`${path} contains duplicate claim ${claimId}`);
    seen.add(claimId);
    if (!caseState.candidateClaims.some((claim) => claim.claimId === claimId)) {
      fail(`${path} references unknown claim ${claimId}`);
    }
  });
}

function adjudicateClaim(caseState, decision) {
  validateOwnershipCase(caseState);
  assertPlainObject(decision, "claimAdjudication");
  assertAllowedKeys(decision, [
    "decisionId",
    "claimId",
    "previousState",
    "resultingState",
    "reasonBasisCode",
    "supportingEvidenceReferences",
    "decisionOrigin",
    "decisionActor",
    "decidedAt",
    "supersededByClaimIds",
    "adversarialClaimIds",
  ], "claimAdjudication");
  assertNonEmptyString(decision.decisionId, "claimAdjudication.decisionId");
  if (caseState.claimAdjudications.some(({ decisionId }) => decisionId === decision.decisionId)) {
    fail(`claim adjudication ${decision.decisionId} already exists in case`);
  }
  assertNonEmptyString(decision.claimId, "claimAdjudication.claimId");
  const claim = caseState.candidateClaims.find(({ claimId }) => claimId === decision.claimId);
  if (!claim) fail(`claim adjudication references unknown claim ${decision.claimId}`);
  assertEnum(decision.previousState, CLAIM_STATE, "claimAdjudication.previousState");
  assertEnum(decision.resultingState, CLAIM_STATE, "claimAdjudication.resultingState");
  if (decision.previousState !== claim.status) fail("claim adjudication previousState must match current claim state");
  if (decision.resultingState === CLAIM_STATE.CANDIDATE) fail("claim adjudication cannot transition back to CANDIDATE");
  if (decision.resultingState === decision.previousState) fail("claim adjudication must change claim state");
  if (TERMINAL_CLAIM_STATES.has(claim.status)) fail(`claim state ${claim.status} is terminal`);
  assertNonEmptyString(decision.reasonBasisCode, "claimAdjudication.reasonBasisCode");
  assertArray(decision.supportingEvidenceReferences, "claimAdjudication.supportingEvidenceReferences");
  decision.supportingEvidenceReferences.forEach((reference, index) => {
    validateEvidenceReference(reference, `claimAdjudication.supportingEvidenceReferences[${index}]`);
  });
  assertNonEmptyString(decision.decisionOrigin, "claimAdjudication.decisionOrigin");
  assertOptionalNonEmptyString(decision.decisionActor, "claimAdjudication.decisionActor");
  validateTimestamp(decision.decidedAt, "claimAdjudication.decidedAt");
  const supersededByClaimIds = cloneData(decision.supersededByClaimIds || []);
  const adversarialClaimIds = cloneData(decision.adversarialClaimIds || []);
  validateClaimReferences(caseState, supersededByClaimIds, "claimAdjudication.supersededByClaimIds");
  validateClaimReferences(caseState, adversarialClaimIds, "claimAdjudication.adversarialClaimIds");

  return nextRevision(
    caseState,
    CASE_EVENT_TYPE.CLAIM_ADJUDICATED,
    decision.decidedAt,
    { decisionId: decision.decisionId, claimId: decision.claimId, resultingState: decision.resultingState },
    (draft, revision) => {
      const index = draft.candidateClaims.findIndex(({ claimId }) => claimId === decision.claimId);
      draft.candidateClaims[index] = {
        ...draft.candidateClaims[index],
        status: decision.resultingState,
        lastAdjudicationDecisionId: decision.decisionId,
      };
      const record = {
        decisionId: decision.decisionId,
        claimId: decision.claimId,
        previousState: decision.previousState,
        resultingState: decision.resultingState,
        reasonBasisCode: decision.reasonBasisCode,
        supportingEvidenceReferences: cloneData(decision.supportingEvidenceReferences),
        decisionOrigin: decision.decisionOrigin,
        decidedAt: decision.decidedAt,
        supersededByClaimIds,
        adversarialClaimIds,
        recordedInRevision: revision,
      };
      if (decision.decisionActor !== undefined) record.decisionActor = decision.decisionActor;
      draft.claimAdjudications.push(record);
    },
  );
}

function latestIdentityDecision(caseState, candidatePartyKey) {
  return [...caseState.identityDecisions]
    .reverse()
    .find((decision) => decision.candidatePartyKey === candidatePartyKey);
}

function graphEligibilityForClaim(caseState, claimId) {
  validateOwnershipCase(caseState);
  const claim = caseState.candidateClaims.find((candidate) => candidate.claimId === claimId);
  if (!claim) fail(`unknown claim ${claimId}`);
  if (claim.claimType !== CANDIDATE_FACT_TYPE.RELATIONSHIP) {
    return deepFreeze({ status: GRAPH_ELIGIBILITY_STATUS.NOT_GRAPH_ELIGIBLE, claimId, reason: "CLAIM_NOT_RELATIONSHIP" });
  }
  if (claim.status !== CLAIM_STATE.OPERATIVE) {
    return deepFreeze({ status: GRAPH_ELIGIBILITY_STATUS.NOT_GRAPH_ELIGIBLE, claimId, reason: "CLAIM_NOT_OPERATIVE" });
  }
  const subjectDecision = latestIdentityDecision(caseState, claim.subject.candidatePartyKey);
  const objectDecision = latestIdentityDecision(caseState, claim.object.candidatePartyKey);
  if (!subjectDecision || subjectDecision.status !== IDENTITY_RESOLUTION_STATUS.RESOLVED) {
    return deepFreeze({ status: GRAPH_ELIGIBILITY_STATUS.NOT_GRAPH_ELIGIBLE, claimId, reason: "SUBJECT_UNRESOLVED" });
  }
  if (!objectDecision || objectDecision.status !== IDENTITY_RESOLUTION_STATUS.RESOLVED) {
    return deepFreeze({ status: GRAPH_ELIGIBILITY_STATUS.NOT_GRAPH_ELIGIBLE, claimId, reason: "OBJECT_UNRESOLVED" });
  }
  return deepFreeze({
    status: GRAPH_ELIGIBILITY_STATUS.GRAPH_ELIGIBLE,
    claimId,
    subjectEntityId: subjectDecision.entityId,
    objectEntityId: objectDecision.entityId,
  });
}

module.exports = {
  CASE_EVENT_TYPE,
  GRAPH_ELIGIBILITY_STATUS,
  addCanonicalEntity,
  adjudicateClaim,
  createOwnershipCase,
  graphEligibilityForClaim,
  intakeCapabilityResult,
  recordIdentityResolutionDecision,
  validateOwnershipCase,
};
