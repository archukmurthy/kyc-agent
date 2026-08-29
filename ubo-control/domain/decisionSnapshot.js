"use strict";

const { createHash } = require("node:crypto");
const { CLAIM_STATE } = require("../contracts/constants");
const {
  DecisionSnapshotValidationError,
  StaleDecisionHistoryError,
} = require("../errors");
const {
  CALCULATION_ALGORITHM,
} = require("./percentageCalculation");
const { validateOwnershipCase } = require("./ownershipCase");
const {
  assertArray,
  assertDataOnly,
  assertEnum,
  assertNonEmptyString,
  assertPlainObject,
  cloneData,
  deepFreeze,
} = require("../internal/validation");
const {
  CANONICALIZATION_ALGORITHM,
  canonicalizeJson,
} = require("../policy/canonicalJson");
const { hashPolicyPack, validatePolicyPack } = require("../policy/policyPack");

const DECISION_SNAPSHOT_SCHEMA_VERSION = "ubo-decision-snapshot-v1";
const DECISION_SNAPSHOT_ALGORITHM = "ubo-decision-snapshot-construction-v1";
const DECISION_SNAPSHOT_CANONICALIZATION_ALGORITHM = "ubo-decision-snapshot-canonical-json-v1";
const DECISION_HISTORY_MODEL_VERSION = "ubo-linear-decision-history-v1";
const DECISION_RECONSTRUCTION_ALGORITHM = "ubo-decision-reconstruction-v1";
const HASH_ALGORITHM = "SHA-256";

const DECISION_CHECKPOINT = Object.freeze({
  CASE_OPEN: "CASE_OPEN",
  SESSION_START: "SESSION_START",
  SUBMIT_GATE: "SUBMIT_GATE",
  CASE_EVENT: "CASE_EVENT",
});

const SUPERSESSION_REASON = Object.freeze({
  NEW_CANDIDATE_FACTS: "NEW_CANDIDATE_FACTS",
  NEW_EVIDENCE: "NEW_EVIDENCE",
  CUSTOMER_RESPONSE: "CUSTOMER_RESPONSE",
  CLAIM_ADJUDICATION_CHANGED: "CLAIM_ADJUDICATION_CHANGED",
  IDENTITY_RESOLUTION_CHANGED: "IDENTITY_RESOLUTION_CHANGED",
  INTERNAL_REVIEW_DECISION: "INTERNAL_REVIEW_DECISION",
  POLICY_CHANGED: "POLICY_CHANGED",
  CASE_CONTEXT_CHANGED: "CASE_CONTEXT_CHANGED",
  SUBMIT_GATE: "SUBMIT_GATE",
  SESSION_REEVALUATION: "SESSION_REEVALUATION",
  OTHER_CASE_EVENT: "OTHER_CASE_EVENT",
});

const HASHED_CONTENT_DESCRIPTION = Object.freeze({
  included: [
    "snapshot schema and algorithm identities",
    "case revision and checkpoint/event identity",
    "explicit evaluation time",
    "policy identity, canonical policy hash and effective parameters",
    "reasoning algorithm identities",
    "normalized UBO reasoning inputs and outputs",
    "predecessor identity and supersession reason",
  ],
  excluded: ["recordingMetadata"],
});

const FORBIDDEN_RAW_EVIDENCE_KEYS = new Set([
  "filecontents",
  "modelproviderrawpayload",
  "providerrawpayload",
  "rawregistryresponse",
  "rawupload",
  "screenshot",
  "sourcehtml",
  "uploadedfile",
]);

function snapshotError(message, code = "INVALID_DECISION_SNAPSHOT") {
  throw new DecisionSnapshotValidationError(message, { code });
}

function staleHistory(message) {
  throw new StaleDecisionHistoryError(message, { code: "STALE_DECISION_HISTORY_HEAD" });
}

function validateTimestamp(value, path) {
  assertNonEmptyString(value, path);
  if (Number.isNaN(Date.parse(value))) snapshotError(`${path} must be an ISO-compatible timestamp`);
}

function digest(value) {
  return `sha256:${createHash("sha256").update(canonicalizeJson(value), "utf8").digest("hex")}`;
}

function same(left, right) {
  return canonicalizeJson(left) === canonicalizeJson(right);
}

function sortedData(values) {
  const unique = new Map();
  (values || []).forEach((value) => unique.set(canonicalizeJson(value), cloneData(value)));
  return [...unique.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, value]) => value);
}

function basePolicyIdentity(identity, path) {
  assertPlainObject(identity, path);
  const result = {};
  ["policyPackId", "policyVersion", "policyHash", "policySchemaVersion"].forEach((field) => {
    assertNonEmptyString(identity[field], `${path}.${field}`);
    result[field] = identity[field];
  });
  return result;
}

function loadedPolicyIdentity(loadedPolicyPack) {
  assertPlainObject(loadedPolicyPack, "loadedPolicyPack");
  assertPlainObject(loadedPolicyPack.policyPack, "loadedPolicyPack.policyPack");
  assertPlainObject(loadedPolicyPack.identity, "loadedPolicyPack.identity");
  validatePolicyPack(loadedPolicyPack.policyPack);
  const policyHash = hashPolicyPack(loadedPolicyPack.policyPack);
  const identity = {
    policyPackId: loadedPolicyPack.policyPack.policyPackId,
    policyVersion: loadedPolicyPack.policyPack.version,
    policyHash,
    policySchemaVersion: loadedPolicyPack.policyPack.schemaVersion,
  };
  if (loadedPolicyPack.identity.policyPackId !== identity.policyPackId
    || loadedPolicyPack.identity.version !== identity.policyVersion
    || loadedPolicyPack.identity.hash !== identity.policyHash
    || loadedPolicyPack.identity.schemaVersion !== identity.policySchemaVersion) {
    snapshotError("loaded Policy Pack identity does not match canonical policy content", "POLICY_CONFIGURATION_ERROR");
  }
  return identity;
}

function parameterValues(policyPack) {
  return Object.fromEntries(Object.entries(policyPack.parameters)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, parameter]) => [key, cloneData(parameter.value)]));
}

function assertNoRawEvidencePayload(value, path = "decisionContent") {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoRawEvidencePayload(item, `${path}[${index}]`));
    return;
  }
  Object.entries(value).forEach(([key, item]) => {
    if (FORBIDDEN_RAW_EVIDENCE_KEYS.has(key.toLowerCase())) {
      snapshotError(`${path}.${key} would duplicate raw external evidence`);
    }
    assertNoRawEvidencePayload(item, `${path}.${key}`);
  });
}

function evidenceLinks(value, path = "reasoning", links = []) {
  if (value === null || typeof value !== "object") return links;
  if (Array.isArray(value)) {
    value.forEach((item, index) => evidenceLinks(item, `${path}[${index}]`, links));
    return links;
  }
  Object.entries(value).forEach(([key, item]) => {
    const normalized = key.toLowerCase();
    if (normalized === "evidencereference" && item && typeof item === "object") {
      links.push({ reasoningPath: `${path}.${key}`, evidenceReference: cloneData(item) });
    } else if (normalized.includes("evidencereferences") && Array.isArray(item)) {
      item.forEach((reference, index) => links.push({
        reasoningPath: `${path}.${key}[${index}]`,
        evidenceReference: cloneData(reference),
      }));
    }
    evidenceLinks(item, `${path}.${key}`, links);
  });
  return links;
}

function canonicalEntityReasoning(caseState) {
  return caseState.canonicalEntities.map((entity) => ({
    entityId: entity.entityId,
    category: entity.category,
    ...(entity.primaryName === undefined ? {} : { primaryName: entity.primaryName }),
    ...(entity.jurisdiction === undefined ? {} : { jurisdiction: entity.jurisdiction }),
    externalIdentifiers: cloneData(entity.externalIdentifiers),
    entityTypeMetadata: cloneData(entity.entityTypeMetadata),
  })).sort((left, right) => left.entityId.localeCompare(right.entityId));
}

function operativeClaimReasoning(caseState) {
  const retainedStates = new Set([
    CLAIM_STATE.OPERATIVE,
    CLAIM_STATE.PROVISIONAL,
    CLAIM_STATE.DISPUTED,
  ]);
  return caseState.candidateClaims
    .filter(({ status }) => retainedStates.has(status))
    .map(cloneData)
    .sort((left, right) => left.claimId.localeCompare(right.claimId));
}

function validateCaseReference(reference, caseState, path) {
  assertPlainObject(reference, path);
  if (reference.caseId !== caseState.caseId
    || reference.revisionId !== caseState.revisionId
    || (reference.revision !== undefined && reference.revision !== caseState.revision)) {
    snapshotError(`${path} does not identify the supplied OwnershipCase revision`, "MIXED_REASONING_REVISION");
  }
}

function validateStagePolicyIdentity(identity, expected, path) {
  if (!same(basePolicyIdentity(identity, path), expected)) {
    snapshotError(`${path} does not match the pinned Policy Pack`, "MIXED_POLICY_IDENTITY");
  }
}

function validateCheckpoint(checkpoint, checkpointReference, evaluationTime) {
  assertEnum(checkpoint, DECISION_CHECKPOINT, "checkpoint");
  assertPlainObject(checkpointReference, "checkpointReference");
  assertNonEmptyString(checkpointReference.referenceId, "checkpointReference.referenceId");
  assertDataOnly(checkpointReference, "checkpointReference");
  validateTimestamp(evaluationTime, "evaluationTime");
}

function validateReasoningConsistency({
  loadedPolicyPack,
  caseState,
  graph,
  calculations,
  policyAssessment,
  requirementResolution,
  orchestration,
  resolutionAttempts,
  fallbackExhaustionDecisions,
}) {
  const identity = loadedPolicyIdentity(loadedPolicyPack);
  validateOwnershipCase(caseState);
  assertPlainObject(graph, "graph");
  assertArray(calculations, "calculations");
  assertPlainObject(policyAssessment, "policyAssessment");
  assertPlainObject(requirementResolution, "requirementResolution");
  assertPlainObject(orchestration, "orchestration");
  assertArray(fallbackExhaustionDecisions, "fallbackExhaustionDecisions");
  if (graph.sourceCase?.caseId !== caseState.caseId
    || graph.sourceCase?.revisionId !== caseState.revisionId
    || graph.sourceCase?.revision !== caseState.revision) {
    snapshotError("graph is not derived from the supplied case revision", "MIXED_REASONING_REVISION");
  }
  assertNonEmptyString(graph.graphAlgorithm, "graph.graphAlgorithm");
  assertNonEmptyString(graph.graphVersion, "graph.graphVersion");
  calculations.forEach((calculation, index) => {
    assertPlainObject(calculation, `calculations[${index}]`);
    assertNonEmptyString(calculation.calculationAlgorithm, `calculations[${index}].calculationAlgorithm`);
    if (calculation.graphVersion !== graph.graphVersion) {
      snapshotError("calculation graph version does not match the pinned graph", "MIXED_REASONING_REVISION");
    }
  });
  [
    [policyAssessment, "policyAssessment"],
    [requirementResolution, "requirementResolution"],
    [orchestration, "orchestration"],
  ].forEach(([artifact, path]) => {
    validateCaseReference(artifact.caseReference, caseState, `${path}.caseReference`);
    if (artifact.graphVersion !== graph.graphVersion) {
      snapshotError(`${path}.graphVersion does not match the pinned graph`, "MIXED_REASONING_REVISION");
    }
    validateStagePolicyIdentity(artifact.policyIdentity, identity, `${path}.policyIdentity`);
  });
  assertNonEmptyString(policyAssessment.policyIdentity.determinationAlgorithm,
    "policyAssessment.policyIdentity.determinationAlgorithm");
  assertNonEmptyString(requirementResolution.policyIdentity.requirementResolutionAlgorithm,
    "requirementResolution.policyIdentity.requirementResolutionAlgorithm");
  assertNonEmptyString(orchestration.policyIdentity.resolutionOrchestrationAlgorithm,
    "orchestration.policyIdentity.resolutionOrchestrationAlgorithm");
  if (!same(orchestration.resolutionAttempts || [], resolutionAttempts || [])) {
    snapshotError("orchestration attempts do not match the supplied append-only attempt history", "MIXED_REASONING_REVISION");
  }
  validateTimestamp(requirementResolution.evaluationDate, "requirementResolution.evaluationDate");
  const terminal = orchestration.terminal;
  assertPlainObject(terminal, "orchestration.terminal");
  if (terminal.orchestrationState === "TERMINAL" && !terminal.terminalOutcome) {
    snapshotError("terminal orchestration state requires a terminal outcome");
  }
  if (terminal.orchestrationState === "IN_PROGRESS" && terminal.terminalOutcome !== undefined) {
    snapshotError("in-progress orchestration cannot carry a terminal outcome");
  }
  const currentDecisionId = orchestration.fallbackDecisionAssessment?.currentDecisionId;
  if (currentDecisionId) {
    const current = fallbackExhaustionDecisions.find(({ decisionId }) => decisionId === currentDecisionId);
    if (!current) snapshotError("current fallback decision is missing from the snapshot inputs");
    validateCaseReference(current.caseReference, caseState, "fallbackExhaustionDecision.caseReference");
    validateStagePolicyIdentity(current.policyIdentity, identity, "fallbackExhaustionDecision.policyIdentity");
    if (current.graphVersion !== graph.graphVersion) snapshotError("fallback decision is pinned to a stale graph");
    if (orchestration.reviewRequirement
      && current.reviewRequirementId !== orchestration.reviewRequirement.reviewRequirementId) {
      snapshotError("fallback decision does not belong to the current ReviewRequirement");
    }
  }
  return identity;
}

function algorithmIdentities({ graph, calculations, policyAssessment, requirementResolution, orchestration }) {
  const calculationAlgorithms = [...new Set(calculations.map(({ calculationAlgorithm }) => calculationAlgorithm))].sort();
  return {
    graphAlgorithm: graph.graphAlgorithm,
    percentageCalculationAlgorithms: calculationAlgorithms.length > 0
      ? calculationAlgorithms
      : [CALCULATION_ALGORITHM],
    conditionAndPolicyDeterminationAlgorithm: policyAssessment.policyIdentity.determinationAlgorithm,
    requirementResolutionAlgorithm: requirementResolution.policyIdentity.requirementResolutionAlgorithm,
    resolutionOrchestrationAlgorithm: orchestration.policyIdentity.resolutionOrchestrationAlgorithm,
    snapshotConstructionAlgorithm: DECISION_SNAPSHOT_ALGORITHM,
    snapshotCanonicalizationAlgorithm: DECISION_SNAPSHOT_CANONICALIZATION_ALGORITHM,
    canonicalJsonAlgorithm: CANONICALIZATION_ALGORITHM,
  };
}

function measuresTakenManifest(orchestration, reviewDecisions, capabilityOperations) {
  if (!orchestration.fallbackReviewPackage) return undefined;
  const currentDecisionId = orchestration.fallbackDecisionAssessment?.currentDecisionId;
  const currentDecision = reviewDecisions.find(({ decisionId }) => decisionId === currentDecisionId);
  return {
    reasoningManifestHash: orchestration.fallbackReviewPackage.reasoningManifestHash,
    resolutionAttempts: cloneData(orchestration.resolutionAttempts),
    capabilityOperations: cloneData(capabilityOperations),
    evidenceReferences: cloneData(orchestration.fallbackReviewPackage.evidenceReferences),
    calculationReferences: cloneData(orchestration.fallbackReviewPackage.calculationReferences),
    requirementResolutions: cloneData(orchestration.requirementResolutions),
    reviewRequirement: cloneData(orchestration.reviewRequirement),
    ...(currentDecision ? { fallbackExhaustionDecision: cloneData(currentDecision) } : {}),
  };
}

function createDecisionSnapshot({
  loadedPolicyPack,
  caseContext,
  caseState,
  graph,
  calculations,
  policyAssessment,
  requirementResolution,
  orchestration,
  facts = {},
  answers = {},
  resolutionAttempts = [],
  fallbackExhaustionDecisions = [],
  checkpoint,
  checkpointReference,
  evaluationTime,
  previousSnapshot = null,
  supersessionReason,
  recordingMetadata = {},
}) {
  validateCheckpoint(checkpoint, checkpointReference, evaluationTime);
  assertPlainObject(caseContext, "caseContext");
  assertDataOnly(caseContext, "caseContext");
  assertDataOnly(facts, "facts");
  assertDataOnly(answers, "answers");
  assertPlainObject(recordingMetadata, "recordingMetadata");
  assertDataOnly(recordingMetadata, "recordingMetadata");
  const policy = validateReasoningConsistency({
    loadedPolicyPack,
    caseState,
    graph,
    calculations,
    policyAssessment,
    requirementResolution,
    orchestration,
    resolutionAttempts,
    fallbackExhaustionDecisions,
  });
  if (requirementResolution.evaluationDate !== evaluationTime) {
    snapshotError("snapshot evaluationTime does not match the requirement-resolution evaluation date", "MIXED_REASONING_REVISION");
  }
  let predecessor = null;
  if (previousSnapshot === null) {
    if (supersessionReason !== undefined && supersessionReason !== null) {
      snapshotError("genesis snapshot cannot carry a supersession reason");
    }
  } else {
    verifyDecisionSnapshot(previousSnapshot);
    if (previousSnapshot.decisionContent.caseReference.caseId !== caseState.caseId) {
      snapshotError("previous snapshot belongs to a different OwnershipCase");
    }
    assertEnum(supersessionReason, SUPERSESSION_REASON, "supersessionReason");
    predecessor = {
      snapshotId: previousSnapshot.snapshotId,
      decisionContentHash: previousSnapshot.decisionContentHash,
    };
  }

  const reviewDecisions = sortedData(fallbackExhaustionDecisions);
  const allInformationNeeds = sortedData([
    ...(requirementResolution.informationNeeds || []),
    ...(orchestration.preparatoryInformationNeeds || []),
    ...(orchestration.reviewGeneratedInformationNeeds || []),
  ]);
  const reasoningSeed = {
    caseContext: cloneData(caseContext),
    policyInputs: { facts: cloneData(facts), answers: cloneData(answers) },
    canonicalEntities: canonicalEntityReasoning(caseState),
    identityResolutionDecisions: sortedData(caseState.identityDecisions),
    operativeClaims: operativeClaimReasoning(caseState),
    claimAdjudications: sortedData(caseState.claimAdjudications),
    graph: cloneData(graph),
    calculations: sortedData(calculations),
    evidenceClassifications: sortedData(requirementResolution.evidenceClassifications || []),
    resolutionAttempts: sortedData(resolutionAttempts),
    capabilityOperations: sortedData(caseState.capabilityOperations),
    reviewDecisions,
  };
  const links = sortedData(evidenceLinks(reasoningSeed));
  reasoningSeed.evidenceManifest = {
    evidenceReferences: sortedData(links.map(({ evidenceReference }) => evidenceReference)),
    supportLinks: links,
  };

  const decision = {
    policyApplicability: cloneData(policyAssessment.policyApplicability),
    applicableRequirements: cloneData(policyAssessment.requirementAssessments || []),
    basisAssessments: cloneData(policyAssessment.basisAssessments || []),
    qualifyingPersons: cloneData(policyAssessment.qualifyingPersons || []),
    requirementResolutions: cloneData(orchestration.requirementResolutions),
    informationNeeds: allInformationNeeds,
    informationNeedHistory: cloneData(requirementResolution.informationNeedHistory || []),
    policyGaps: cloneData(requirementResolution.policyGaps || []),
    operationalBlockers: cloneData(requirementResolution.operationalBlockers || []),
    resolutionOptions: cloneData(orchestration.resolutionOptions || []),
    actionIntents: cloneData(orchestration.actionIntents || []),
    reviewRequirements: orchestration.reviewRequirement ? [cloneData(orchestration.reviewRequirement)] : [],
    reviewDecisions,
    fallbackReviewCandidate: cloneData(orchestration.fallbackReviewCandidate),
    fallbackDecisionAssessment: cloneData(orchestration.fallbackDecisionAssessment),
    fallbackApplication: cloneData(orchestration.fallbackApplication),
    pscDiscrepancyAssessment: cloneData(orchestration.pscDiscrepancyAssessment),
    riskSignals: cloneData(orchestration.riskSignals || []),
    residualCompleteness: cloneData(orchestration.residualCompleteness),
    customerProjection: cloneData(orchestration.customerProjection),
    terminal: cloneData(orchestration.terminal),
    ...(orchestration.fallbackReviewPackage
      ? { fallbackReviewPackage: cloneData(orchestration.fallbackReviewPackage) }
      : {}),
  };
  const measures = measuresTakenManifest(orchestration, reviewDecisions, reasoningSeed.capabilityOperations);
  if (measures) decision.measuresTakenManifest = measures;

  const decisionContent = {
    snapshotSchemaVersion: DECISION_SNAPSHOT_SCHEMA_VERSION,
    snapshotAlgorithmVersion: DECISION_SNAPSHOT_ALGORITHM,
    canonicalizationAlgorithm: DECISION_SNAPSHOT_CANONICALIZATION_ALGORITHM,
    hashAlgorithm: HASH_ALGORITHM,
    caseReference: {
      caseId: caseState.caseId,
      revisionId: caseState.revisionId,
      revision: caseState.revision,
    },
    checkpoint: {
      type: checkpoint,
      reference: cloneData(checkpointReference),
      evaluationTime,
    },
    history: {
      previousSnapshot: predecessor,
      supersessionReason: predecessor ? supersessionReason : null,
    },
    policy: {
      identity: policy,
      effectiveParameters: parameterValues(loadedPolicyPack.policyPack),
    },
    algorithms: algorithmIdentities({ graph, calculations, policyAssessment, requirementResolution, orchestration }),
    reasoning: reasoningSeed,
    decision,
  };
  assertDataOnly(decisionContent, "decisionContent");
  assertNoRawEvidencePayload(decisionContent);
  const decisionContentHash = digest(decisionContent);
  const snapshot = {
    snapshotSchemaVersion: DECISION_SNAPSHOT_SCHEMA_VERSION,
    snapshotId: decisionContentHash,
    decisionContentHash,
    decisionContent,
    recordingMetadata: cloneData(recordingMetadata),
  };
  verifyDecisionSnapshot(snapshot, { previousSnapshot, loadedPolicyPack });
  return deepFreeze(snapshot);
}

function validateInternalReferences(content) {
  const decision = content.decision;
  const requirementIds = new Set(decision.requirementResolutions.map(({ requirementId }) => requirementId));
  const needIds = new Set(decision.informationNeeds.map(({ needId }) => needId));
  const optionIds = new Set(decision.resolutionOptions.map(({ optionId }) => optionId));
  const reviewIds = new Set(decision.reviewRequirements.map(({ reviewRequirementId }) => reviewRequirementId));
  decision.resolutionOptions.forEach((option) => {
    if (!needIds.has(option.informationNeedId) && !option.informationNeedId.startsWith("closing-condition:")) {
      snapshotError(`ResolutionOption ${option.optionId} references an unknown InformationNeed`);
    }
    option.requirementIds.forEach((id) => {
      if (!requirementIds.has(id)) snapshotError(`ResolutionOption ${option.optionId} references an unknown requirement`);
    });
  });
  decision.actionIntents.forEach((intent) => {
    intent.informationNeedIds.forEach((id) => {
      if (!needIds.has(id)) snapshotError(`ActionIntent ${intent.actionIntentId} references an unknown InformationNeed`);
    });
    intent.resolutionOptionIds.forEach((id) => {
      if (!optionIds.has(id)) snapshotError(`ActionIntent ${intent.actionIntentId} references an unknown ResolutionOption`);
    });
  });
  decision.reviewDecisions.forEach((reviewDecision) => {
    if (!reviewIds.has(reviewDecision.reviewRequirementId)
      && reviewDecision.decisionId === decision.fallbackDecisionAssessment.currentDecisionId) {
      snapshotError("current review decision does not reference the snapshotted ReviewRequirement");
    }
  });
  content.reasoning.calculations.forEach((calculation) => {
    if (calculation.graphVersion !== content.reasoning.graph.graphVersion) {
      snapshotError("snapshotted calculation does not reference the snapshotted graph");
    }
  });
  if (content.reasoning.graph.graphAlgorithm !== content.algorithms.graphAlgorithm) {
    snapshotError("pinned graph algorithm does not match the snapshotted graph");
  }
  const calculationAlgorithms = [...new Set(content.reasoning.calculations
    .map(({ calculationAlgorithm }) => calculationAlgorithm))].sort();
  const expectedCalculationAlgorithms = calculationAlgorithms.length > 0
    ? calculationAlgorithms
    : [CALCULATION_ALGORITHM];
  if (!same(expectedCalculationAlgorithms, content.algorithms.percentageCalculationAlgorithms)) {
    snapshotError("pinned calculation algorithms do not match the snapshotted calculations");
  }
}

function validateEmbeddedPolicyIdentities(value, expected, path = "decisionContent") {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => validateEmbeddedPolicyIdentities(item, expected, `${path}[${index}]`));
    return;
  }
  Object.entries(value).forEach(([key, item]) => {
    if (key === "policyIdentity") {
      if (!same(basePolicyIdentity(item, `${path}.${key}`), expected)) {
        snapshotError(`${path}.${key} does not match the DecisionSnapshot policy identity`);
      }
    }
    validateEmbeddedPolicyIdentities(item, expected, `${path}.${key}`);
  });
}

function verifyDecisionSnapshot(snapshot, { previousSnapshot = undefined, loadedPolicyPack = undefined } = {}) {
  assertPlainObject(snapshot, "decisionSnapshot");
  assertNonEmptyString(snapshot.snapshotId, "decisionSnapshot.snapshotId");
  assertNonEmptyString(snapshot.decisionContentHash, "decisionSnapshot.decisionContentHash");
  assertPlainObject(snapshot.decisionContent, "decisionSnapshot.decisionContent");
  assertPlainObject(snapshot.recordingMetadata, "decisionSnapshot.recordingMetadata");
  assertDataOnly(snapshot, "decisionSnapshot");
  const content = snapshot.decisionContent;
  if (snapshot.snapshotSchemaVersion !== DECISION_SNAPSHOT_SCHEMA_VERSION
    || content.snapshotSchemaVersion !== DECISION_SNAPSHOT_SCHEMA_VERSION) {
    snapshotError("unsupported DecisionSnapshot schema version");
  }
  if (content.snapshotAlgorithmVersion !== DECISION_SNAPSHOT_ALGORITHM
    || content.canonicalizationAlgorithm !== DECISION_SNAPSHOT_CANONICALIZATION_ALGORITHM
    || content.hashAlgorithm !== HASH_ALGORITHM) {
    snapshotError("unsupported DecisionSnapshot construction/hash identity");
  }
  if (snapshot.snapshotId !== snapshot.decisionContentHash
    || snapshot.decisionContentHash !== digest(content)) {
    snapshotError("DecisionSnapshot hash does not match canonical decision content", "DECISION_SNAPSHOT_INTEGRITY_ERROR");
  }
  assertNoRawEvidencePayload(content);
  assertPlainObject(content.policy, "decisionContent.policy");
  const pinnedPolicyIdentity = basePolicyIdentity(content.policy.identity, "decisionContent.policy.identity");
  assertPlainObject(content.algorithms, "decisionContent.algorithms");
  Object.entries(content.algorithms).forEach(([key, value]) => {
    if (Array.isArray(value)) value.forEach((item, index) => assertNonEmptyString(item, `decisionContent.algorithms.${key}[${index}]`));
    else assertNonEmptyString(value, `decisionContent.algorithms.${key}`);
  });
  validateInternalReferences(content);
  validateEmbeddedPolicyIdentities(content, pinnedPolicyIdentity);
  if (loadedPolicyPack !== undefined) {
    const expected = loadedPolicyIdentity(loadedPolicyPack);
    if (!same(expected, content.policy.identity)) snapshotError("DecisionSnapshot Policy Pack identity is not the supplied historical pack");
  }
  if (previousSnapshot !== undefined) {
    const predecessor = content.history.previousSnapshot;
    if (previousSnapshot === null) {
      if (predecessor !== null) snapshotError("genesis snapshot unexpectedly has a predecessor");
    } else {
      verifyDecisionSnapshot(previousSnapshot);
      if (!predecessor
        || predecessor.snapshotId !== previousSnapshot.snapshotId
        || predecessor.decisionContentHash !== previousSnapshot.decisionContentHash) {
        snapshotError("DecisionSnapshot predecessor linkage is invalid");
      }
    }
  }
  return true;
}

function createDecisionHistory(caseId) {
  assertNonEmptyString(caseId, "caseId");
  return deepFreeze({
    historyModelVersion: DECISION_HISTORY_MODEL_VERSION,
    caseId,
    snapshots: [],
  });
}

function verifyDecisionHistory(history) {
  assertPlainObject(history, "decisionHistory");
  if (history.historyModelVersion !== DECISION_HISTORY_MODEL_VERSION) snapshotError("unsupported DecisionHistory model version");
  assertNonEmptyString(history.caseId, "decisionHistory.caseId");
  assertArray(history.snapshots, "decisionHistory.snapshots");
  const seen = new Set();
  history.snapshots.forEach((snapshot, index) => {
    verifyDecisionSnapshot(snapshot);
    if (snapshot.decisionContent.caseReference.caseId !== history.caseId) snapshotError("DecisionHistory contains another case");
    if (seen.has(snapshot.snapshotId)) snapshotError("DecisionHistory contains a duplicate snapshot");
    seen.add(snapshot.snapshotId);
    const expectedPrevious = index === 0 ? null : history.snapshots[index - 1];
    const actual = snapshot.decisionContent.history.previousSnapshot;
    if (expectedPrevious === null) {
      if (actual !== null) snapshotError("DecisionHistory genesis has a predecessor");
    } else if (!actual
      || actual.snapshotId !== expectedPrevious.snapshotId
      || actual.decisionContentHash !== expectedPrevious.decisionContentHash) {
      snapshotError("DecisionHistory predecessor chain is not linear");
    }
  });
  return true;
}

function appendDecisionSnapshot(history, snapshot, { expectedHeadSnapshotId = null } = {}) {
  verifyDecisionHistory(history);
  verifyDecisionSnapshot(snapshot);
  const head = history.snapshots.length === 0 ? null : history.snapshots[history.snapshots.length - 1];
  const actualHeadId = head?.snapshotId || null;
  if (expectedHeadSnapshotId !== actualHeadId) {
    staleHistory(`expected decision-history head ${expectedHeadSnapshotId || "GENESIS"} but current head is ${actualHeadId || "GENESIS"}`);
  }
  if (snapshot.decisionContent.caseReference.caseId !== history.caseId) snapshotError("snapshot belongs to a different DecisionHistory case");
  const predecessor = snapshot.decisionContent.history.previousSnapshot;
  if (head === null) {
    if (predecessor !== null) staleHistory("genesis append cannot claim a predecessor");
  } else if (!predecessor || predecessor.snapshotId !== head.snapshotId
    || predecessor.decisionContentHash !== head.decisionContentHash) {
    staleHistory("snapshot was resolved from a stale decision-history head");
  }
  const next = {
    historyModelVersion: DECISION_HISTORY_MODEL_VERSION,
    caseId: history.caseId,
    snapshots: [...history.snapshots, snapshot],
  };
  verifyDecisionHistory(next);
  return deepFreeze(next);
}

function reconstructDecisionState(snapshot) {
  verifyDecisionSnapshot(snapshot);
  const content = snapshot.decisionContent;
  return deepFreeze({
    reconstructionAlgorithm: DECISION_RECONSTRUCTION_ALGORITHM,
    snapshotReference: {
      snapshotId: snapshot.snapshotId,
      decisionContentHash: snapshot.decisionContentHash,
    },
    caseReference: cloneData(content.caseReference),
    checkpoint: cloneData(content.checkpoint),
    policy: cloneData(content.policy),
    algorithms: cloneData(content.algorithms),
    policyApplicability: cloneData(content.decision.policyApplicability),
    applicableRequirements: cloneData(content.decision.applicableRequirements),
    basisAssessments: cloneData(content.decision.basisAssessments),
    qualifyingPersons: cloneData(content.decision.qualifyingPersons),
    requirementResolutions: cloneData(content.decision.requirementResolutions),
    informationNeeds: cloneData(content.decision.informationNeeds),
    policyGaps: cloneData(content.decision.policyGaps),
    operationalBlockers: cloneData(content.decision.operationalBlockers),
    resolutionOptions: cloneData(content.decision.resolutionOptions),
    actionIntents: cloneData(content.decision.actionIntents),
    reviewRequirements: cloneData(content.decision.reviewRequirements),
    reviewDecisions: cloneData(content.decision.reviewDecisions),
    fallbackApplication: cloneData(content.decision.fallbackApplication),
    pscDiscrepancyAssessment: cloneData(content.decision.pscDiscrepancyAssessment),
    riskSignals: cloneData(content.decision.riskSignals),
    customerProjection: cloneData(content.decision.customerProjection),
    terminal: cloneData(content.decision.terminal),
    ...(content.decision.measuresTakenManifest
      ? { measuresTakenManifest: cloneData(content.decision.measuresTakenManifest) }
      : {}),
  });
}

module.exports = {
  DECISION_CHECKPOINT,
  DECISION_HISTORY_MODEL_VERSION,
  DECISION_RECONSTRUCTION_ALGORITHM,
  DECISION_SNAPSHOT_ALGORITHM,
  DECISION_SNAPSHOT_CANONICALIZATION_ALGORITHM,
  DECISION_SNAPSHOT_SCHEMA_VERSION,
  HASHED_CONTENT_DESCRIPTION,
  SUPERSESSION_REASON,
  appendDecisionSnapshot,
  createDecisionHistory,
  createDecisionSnapshot,
  reconstructDecisionState,
  verifyDecisionHistory,
  verifyDecisionSnapshot,
};
