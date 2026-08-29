"use strict";

const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const test = require("node:test");
const {
  APPLICABILITY_RESULT,
  CAPABILITY_CONTRACT_VERSION,
  CAPABILITY_OUTCOME_STATE,
  CANDIDATE_FACT_TYPE,
  CLAIM_STATE,
  IDENTITY_RESOLUTION_STATUS,
  PERCENTAGE_VALUE_TYPE,
  RELATIONSHIP_TYPE,
  REQUIREMENT_STATE,
  RESOLUTION_STRATEGY,
} = require("../contracts/constants");
const { CANONICAL_ENTITY_CATEGORY } = require("../domain/canonicalEntity");
const {
  DECISION_CHECKPOINT,
  HASHED_CONTENT_DESCRIPTION,
  SUPERSESSION_REASON,
  appendDecisionSnapshot,
  createDecisionHistory,
  createDecisionSnapshot,
  reconstructDecisionState,
  verifyDecisionHistory,
  verifyDecisionSnapshot,
} = require("../domain/decisionSnapshot");
const {
  addCanonicalEntity,
  adjudicateClaim,
  createOwnershipCase,
  intakeCapabilityResult,
  recordIdentityResolutionDecision,
} = require("../domain/ownershipCase");
const { buildCanonicalOwnershipGraph, GRAPH_DIMENSION } = require("../domain/ownershipGraph");
const { calculateEffectivePercentage } = require("../domain/percentageCalculation");
const {
  INFORMATION_NEED_CONCEPT,
  reconcileInformationNeeds,
} = require("../domain/resolutionArtifacts");
const {
  FALLBACK_DECISION_ORIGIN,
  FALLBACK_EXHAUSTION_DECISION,
  createFallbackExhaustionDecision,
} = require("../domain/resolutionOrchestrationArtifacts");
const { StaleDecisionHistoryError } = require("../errors");
const { reResolveDecision } = require("../application/reResolveDecision");
const { POLICY_DETERMINATION_ALGORITHM } = require("../policy/policyDetermination");
const { canonicalizeJson } = require("../policy/canonicalJson");
const { loadPolicyPack } = require("../policy/policyPack");
const { REQUIREMENT_RESOLUTION_ALGORITHM } = require("../policy/requirementResolution");
const {
  RESOLUTION_ORCHESTRATION_ALGORITHM,
  orchestrateResolution,
} = require("../policy/resolutionOrchestration");

const NOW = "2026-08-29T18:00:00.000Z";
const policy14Source = require("../policies/uk-corporate/1.4-rc/policy.json");
const loadedPolicyPack = loadPolicyPack(policy14Source);

function policyIdentity(pack, algorithm) {
  return {
    policyPackId: pack.identity.policyPackId,
    policyVersion: pack.identity.version,
    policyHash: pack.identity.hash,
    policySchemaVersion: pack.identity.schemaVersion,
    ...algorithm,
  };
}

function buildCase(caseId = "snapshot-case") {
  let caseState = createOwnershipCase({
    caseId,
    subjectReference: { name: "Customer", entityType: "COMPANY", entityId: "customer", externalIdentifiers: [] },
    externalReferences: [{ system: "g24c-test", referenceId: caseId }],
    createdAt: NOW,
  });
  [
    { entityId: "customer", category: CANONICAL_ENTITY_CATEGORY.LEGAL_ENTITY, primaryName: "Customer", jurisdiction: "GB" },
    { entityId: "person-smo", category: CANONICAL_ENTITY_CATEGORY.NATURAL_PERSON, primaryName: "Senior Person", jurisdiction: "GB" },
  ].forEach((entity) => {
    caseState = addCanonicalEntity(caseState, {
      ...entity,
      aliases: [],
      externalIdentifiers: [],
      entityTypeMetadata: {},
    }, { recordedAt: NOW });
  });
  return caseState;
}

function needDraft({
  concept = INFORMATION_NEED_CONCEPT.PERCENTAGE_OR_RANGE,
  subjectEntityId = "customer",
  requiredBy = ["UBO-R01"],
  strategies = [RESOLUTION_STRATEGY.CUSTOMER_DOCUMENT],
  reasonCode = "TEST_NEED",
} = {}) {
  return {
    subjectEntityId,
    requiredBy,
    concept,
    reasonCodes: [reasonCode],
    claimIds: [],
    calculationReferences: [],
    conflictReferences: [],
    existingEvidenceReferences: [],
    permittedResolutionStrategies: strategies,
  };
}

function fixture({
  pack = loadedPolicyPack,
  caseId,
  noQualifyingPersons = false,
  statusOverrides = {},
  applicabilityOverrides = {},
  needDrafts = [],
  policyGap = false,
} = {}) {
  const caseState = buildCase(caseId);
  const graph = buildCanonicalOwnershipGraph(caseState);
  const calculations = [];
  const determinationIdentity = policyIdentity(pack, { determinationAlgorithm: POLICY_DETERMINATION_ALGORITHM });
  const resolutionIdentity = policyIdentity(pack, { requirementResolutionAlgorithm: REQUIREMENT_RESOLUTION_ALGORITHM });
  const allIds = pack.policyPack.requirements.map(({ requirementId }) => requirementId);
  const statuses = Object.fromEntries(allIds.map((id) => [id, REQUIREMENT_STATE.RESOLVED]));
  Object.assign(statuses, {
    "UBO-R02": REQUIREMENT_STATE.N_A,
    "UBO-R03": REQUIREMENT_STATE.N_A,
    "UBO-R09": REQUIREMENT_STATE.UNRESOLVED,
    "UBO-R10": REQUIREMENT_STATE.N_A,
    "UBO-R13": REQUIREMENT_STATE.UNRESOLVED,
    "UBO-R14": REQUIREMENT_STATE.UNRESOLVED,
  }, statusOverrides);
  const needState = reconcileInformationNeeds({ caseState, drafts: needDrafts, priorRecords: [] });
  const caseReference = { caseId: caseState.caseId, revisionId: caseState.revisionId, revision: caseState.revision };
  const policyAssessment = {
    policyIdentity: determinationIdentity,
    policyApplicability: { status: APPLICABILITY_RESULT.APPLIES, entityProfile: "COMPANY" },
    graphVersion: graph.graphVersion,
    caseReference,
    requirementAssessments: allIds.map((requirementId) => ({
      requirementId,
      applicability: applicabilityOverrides[requirementId]
        || (["UBO-R02", "UBO-R03", "UBO-R10"].includes(requirementId)
          ? APPLICABILITY_RESULT.DOES_NOT_APPLY
          : APPLICABILITY_RESULT.APPLIES),
      basisAssessmentIds: [],
    })),
    basisAssessments: [],
    qualifyingPersons: noQualifyingPersons ? [] : [{ entityId: "person-smo", roles: ["beneficial_owner"], bases: [] }],
  };
  const policyGaps = policyGap ? [{
    gapId: `policy-gap:${caseState.caseId}:R01`,
    caseReference,
    requirementId: "UBO-R01",
    informationNeedIds: needState.current.map(({ needId }) => needId),
    reasonCode: "TEST_POLICY_GAP",
    references: {},
  }] : [];
  const requirementResolutions = allIds.map((requirementId) => ({
    requirementId,
    policyIdentity: resolutionIdentity,
    caseReference,
    applicability: policyAssessment.requirementAssessments.find((item) => item.requirementId === requirementId).applicability,
    requirementStatus: statuses[requirementId],
    reasonCode: `${statuses[requirementId]}_FIXTURE`,
    basisAssessmentReferences: [],
    operativeClaimReferences: [],
    graphReference: { graphVersion: graph.graphVersion, relationshipIds: [] },
    calculationReferences: [],
    evidenceReferencesConsidered: [],
    evidenceSufficiency: { status: "INDETERMINATE", reasonCode: "FIXTURE" },
    informationNeedIds: needState.current.filter(({ requiredBy }) => requiredBy.includes(requirementId)).map(({ needId }) => needId),
    policyGapIds: policyGaps.filter(({ requirementId: id }) => id === requirementId).map(({ gapId }) => gapId),
    conflictReferences: statuses[requirementId] === REQUIREMENT_STATE.CONFLICT ? ["conflict:fixture"] : [],
    reviewReferences: statuses[requirementId] === REQUIREMENT_STATE.REVIEW_REQUIRED ? ["review:fixture"] : [],
    operationalBlockerIds: [],
  }));
  const requirementResolution = {
    policyIdentity: resolutionIdentity,
    caseReference,
    graphVersion: graph.graphVersion,
    evaluationDate: NOW,
    requirementResolutions,
    evidenceClassifications: [],
    informationNeeds: needState.current,
    informationNeedHistory: needState.history,
    policyGaps,
    operationalBlockers: [],
  };
  return {
    loadedPolicyPack: pack,
    caseContext: { entityType: "private_limited_company", subjectEntityId: "customer", jurisdiction: "GB", riskLevel: "LOW" },
    caseState,
    graph,
    calculations,
    policyAssessment,
    requirementResolution,
    facts: {},
    answers: {},
    pscComparison: {
      firmFacts: [{ factId: "firm", personEntityId: "person-smo", basis: "ECONOMIC_OWNERSHIP", value: 30 }],
      pscFacts: [{ factId: "psc", personEntityId: "person-smo", basis: "ECONOMIC_OWNERSHIP", value: 30 }],
      pscEvidenceComplete: true,
    },
  };
}

function runOrchestration(environment, overrides = {}) {
  return orchestrateResolution({ ...environment, ...overrides });
}

function attestation() {
  return {
    accepted: true,
    factReference: "fact:closing-attestation",
    evidenceReference: { system: "g24c-test", referenceType: "attestation", referenceId: "closing" },
  };
}

function seniorCandidates() {
  return [{ personEntityId: "person-smo", factReferences: ["fact:senior-management"], evidenceReferences: [] }];
}

function snapshot(environment, orchestrationOverrides = {}, snapshotOverrides = {}) {
  const orchestration = runOrchestration(environment, orchestrationOverrides);
  const resolutionAttempts = orchestrationOverrides.resolutionAttempts || [];
  const fallbackExhaustionDecisions = orchestrationOverrides.fallbackExhaustionDecisions || [];
  return createDecisionSnapshot({
    ...environment,
    orchestration,
    resolutionAttempts,
    fallbackExhaustionDecisions,
    checkpoint: DECISION_CHECKPOINT.CASE_OPEN,
    checkpointReference: { referenceId: `${environment.caseState.caseId}:case-open` },
    evaluationTime: NOW,
    recordingMetadata: { recordedAt: "2026-08-29T18:01:00.000Z" },
    ...snapshotOverrides,
  });
}

function rehash(snapshotValue) {
  const changed = structuredClone(snapshotValue);
  const hash = `sha256:${createHash("sha256").update(canonicalizeJson(changed.decisionContent), "utf8").digest("hex")}`;
  changed.snapshotId = hash;
  changed.decisionContentHash = hash;
  return changed;
}

function buildOperativeCase(caseId, percentage = 40) {
  let caseState = createOwnershipCase({
    caseId,
    subjectReference: { name: "Customer", entityType: "COMPANY", entityId: "customer", externalIdentifiers: [] },
    externalReferences: [],
    createdAt: NOW,
  });
  [
    { entityId: "customer", category: CANONICAL_ENTITY_CATEGORY.LEGAL_ENTITY },
    { entityId: "person-alice", category: CANONICAL_ENTITY_CATEGORY.NATURAL_PERSON },
  ].forEach(({ entityId, category }) => {
    caseState = addCanonicalEntity(caseState, {
      entityId, category, primaryName: entityId, aliases: [], externalIdentifiers: [], jurisdiction: "GB", entityTypeMetadata: {},
    }, { recordedAt: NOW });
  });
  const party = (entityId) => ({ name: entityId, entityType: "COMPANY", entityId, externalIdentifiers: [] });
  const evidenceReference = { system: "g24c-test", referenceType: "registry", referenceId: `${caseId}:evidence` };
  caseState = intakeCapabilityResult(caseState, {
    contractVersion: CAPABILITY_CONTRACT_VERSION,
    requestId: `${caseId}:request`,
    outcome: { state: CAPABILITY_OUTCOME_STATE.COMPLETE },
    candidateFacts: [{
      factId: `${caseId}:fact`,
      type: CANDIDATE_FACT_TYPE.RELATIONSHIP,
      subject: party("person-alice"),
      relationship: RELATIONSHIP_TYPE.ECONOMIC_OWNERSHIP,
      object: party("customer"),
      measurement: { type: PERCENTAGE_VALUE_TYPE.EXACT, value: percentage },
      qualifiers: { currentState: "CURRENT" },
      evidenceReferences: [evidenceReference],
    }],
    operationEvidenceReferences: [evidenceReference],
    issues: [],
  }, { operationId: `${caseId}:operation`, recordedAt: NOW });
  const claim = caseState.candidateClaims[0];
  [["subject", claim.subject], ["object", claim.object]].forEach(([name, endpoint]) => {
    caseState = recordIdentityResolutionDecision(caseState, {
      decisionId: `${claim.claimId}:${name}:identity`,
      candidatePartyKey: endpoint.candidatePartyKey,
      status: IDENTITY_RESOLUTION_STATUS.RESOLVED,
      entityId: endpoint.party.entityId,
      basisReasonCodes: ["CUSTOMER_CONFIRMED"],
      evidenceReferences: [],
      decidedAt: NOW,
      decisionOrigin: "CUSTOMER_RESPONSE",
    });
  });
  return adjudicateClaim(caseState, {
    decisionId: `${claim.claimId}:operative`,
    claimId: claim.claimId,
    previousState: CLAIM_STATE.CANDIDATE,
    resultingState: CLAIM_STATE.OPERATIVE,
    reasonBasisCode: "CUSTOMER_CONFIRMED",
    supportingEvidenceReferences: [],
    decisionOrigin: "CUSTOMER_RESPONSE",
    decidedAt: NOW,
    supersededByClaimIds: [],
    adversarialClaimIds: [],
  });
}

test("canonical decision identity is stable across insertion order and excludes recording metadata", () => {
  const environment = fixture();
  environment.caseContext = { riskLevel: "LOW", jurisdiction: "GB", subjectEntityId: "customer", entityType: "private_limited_company" };
  const first = snapshot(environment, { residualCompletenessAttestation: attestation() });
  const second = snapshot(environment, { residualCompletenessAttestation: attestation() }, {
    recordingMetadata: { recordedAt: "2099-01-01T00:00:00.000Z", recorder: "another-host" },
  });
  assert.equal(first.snapshotId, second.snapshotId);
  assert.deepEqual(HASHED_CONTENT_DESCRIPTION.excluded, ["recordingMetadata"]);
  assert.equal(Object.isFrozen(first), true);
});

test("checkpoint/event identity is hashed and tampering fails verification", () => {
  const environment = fixture();
  const first = snapshot(environment);
  const second = snapshot(environment, {}, {
    checkpoint: DECISION_CHECKPOINT.CASE_EVENT,
    checkpointReference: { referenceId: "semantic-event:new-evidence", eventType: "NEW_EVIDENCE" },
  });
  assert.notEqual(first.snapshotId, second.snapshotId);
  const tampered = structuredClone(first);
  tampered.decisionContent.decision.terminal.reasonCode = "TAMPERED";
  assert.throws(() => verifyDecisionSnapshot(tampered), /hash does not match/);
});

test("snapshot construction rejects mixed revisions, policy identities, evaluation dates and terminal states", () => {
  const environment = fixture({ caseId: "consistency-check" });
  const orchestration = runOrchestration(environment);
  const create = (changes = {}) => createDecisionSnapshot({
    ...environment,
    orchestration,
    checkpoint: DECISION_CHECKPOINT.CASE_OPEN,
    checkpointReference: { referenceId: "consistency-check:open" },
    evaluationTime: NOW,
    ...changes,
  });
  assert.throws(() => create({ graph: { ...structuredClone(environment.graph), sourceCase: {
    ...environment.graph.sourceCase, revisionId: "stale-revision",
  } } }), /graph is not derived/);
  assert.throws(() => create({ policyAssessment: {
    ...structuredClone(environment.policyAssessment),
    policyIdentity: { ...environment.policyAssessment.policyIdentity, policyHash: "sha256:stale" },
  } }), /does not match the pinned Policy Pack/);
  assert.throws(() => create({ policyAssessment: {
    ...structuredClone(environment.policyAssessment),
    caseReference: { ...environment.policyAssessment.caseReference, revisionId: "stale" },
  } }), /does not identify the supplied OwnershipCase revision/);
  assert.throws(() => create({ policyAssessment: {
    ...structuredClone(environment.policyAssessment),
    graphVersion: "stale-graph",
  } }), /graphVersion does not match/);
  assert.throws(() => create({ calculations: [{
    calculationAlgorithm: "ubo-percentage-lookthrough-v1",
    graphVersion: "stale-graph",
  }] }), /calculation graph version/);
  assert.throws(() => create({ evaluationTime: "2026-08-30T00:00:00.000Z" }), /evaluationTime does not match/);
  assert.throws(() => create({ orchestration: {
    ...structuredClone(orchestration),
    terminal: { orchestrationState: "TERMINAL", reasonCode: "MISSING_OUTCOME" },
  } }), /requires a terminal outcome/);
  assert.throws(() => create({ orchestration: {
    ...structuredClone(orchestration),
    terminal: { orchestrationState: "IN_PROGRESS", terminalOutcome: "RESOLVED", reasonCode: "IMPOSSIBLE" },
  } }), /in-progress orchestration cannot/);
  assert.throws(() => create({ orchestration: {
    ...structuredClone(orchestration),
    resolutionAttempts: [{ attemptId: "stale-attempt" }],
  } }), /attempts do not match/);
  assert.throws(() => create({ supersessionReason: SUPERSESSION_REASON.NEW_EVIDENCE }), /genesis snapshot cannot/);
  assert.throws(() => create({ facts: { providerRawPayload: { secret: "raw" } } }), /duplicate raw external evidence/);
  const invalidPack = structuredClone(loadedPolicyPack);
  invalidPack.identity.hash = "sha256:wrong";
  assert.throws(() => create({ loadedPolicyPack: invalidPack }), /identity does not match canonical policy content/);
  const other = snapshot(fixture({ caseId: "another-case" }));
  assert.throws(() => create({
    previousSnapshot: other,
    supersessionReason: SUPERSESSION_REASON.NEW_EVIDENCE,
  }), /belongs to a different OwnershipCase/);
});

test("offline verification rejects rehashed semantic corruption beyond the content hash", () => {
  const environment = fixture({
    caseId: "semantic-verification",
    statusOverrides: { "UBO-R01": REQUIREMENT_STATE.GAP },
    needDrafts: [needDraft()],
    policyGap: true,
  });
  const valid = snapshot(environment);
  const corruptions = [
    ["schema", (value) => { value.snapshotSchemaVersion = "unsupported"; value.decisionContent.snapshotSchemaVersion = "unsupported"; }, /unsupported DecisionSnapshot schema/],
    ["algorithm", (value) => { value.decisionContent.snapshotAlgorithmVersion = "unsupported"; }, /construction\/hash identity/],
    ["graph algorithm", (value) => { value.decisionContent.algorithms.graphAlgorithm = "wrong"; }, /pinned graph algorithm/],
    ["policy identity", (value) => {
      value.decisionContent.decision.requirementResolutions[0].policyIdentity.policyHash = "sha256:wrong";
    }, /does not match the DecisionSnapshot policy identity/],
    ["unknown need", (value) => {
      value.decisionContent.decision.resolutionOptions.push({
        optionId: "resolution-option:corrupt",
        informationNeedId: "unknown-need",
        requirementIds: ["UBO-R01"],
      });
    }, /unknown InformationNeed/],
  ];
  corruptions.forEach(([, mutate, pattern]) => {
    const changed = structuredClone(valid);
    mutate(changed);
    assert.throws(() => verifyDecisionSnapshot(rehash(changed)), pattern);
  });

  const calculationEnvironment = fixture({ caseId: "semantic-calculation" });
  calculationEnvironment.calculations = [{
    calculationAlgorithm: "ubo-percentage-lookthrough-v1",
    graphVersion: calculationEnvironment.graph.graphVersion,
    subjectEntityId: "person-smo", targetEntityId: "customer", dimension: "ECONOMIC",
    status: "NO_PATH", knownPaths: [], unresolvedPaths: [], cycles: [],
  }];
  const calculationSnapshot = snapshot(calculationEnvironment);
  const wrongCalculationAlgorithm = structuredClone(calculationSnapshot);
  wrongCalculationAlgorithm.decisionContent.algorithms.percentageCalculationAlgorithms = ["wrong"];
  assert.throws(() => verifyDecisionSnapshot(rehash(wrongCalculationAlgorithm)), /pinned calculation algorithms/);
  const wrongGraph = structuredClone(calculationSnapshot);
  wrongGraph.decisionContent.reasoning.calculations[0].graphVersion = "wrong";
  assert.throws(() => verifyDecisionSnapshot(rehash(wrongGraph)), /snapshotted graph/);
});

test("every required reasoning-critical material change changes the snapshot hash", () => {
  const baseEnvironment = fixture();
  const base = snapshot(baseEnvironment);

  const changedPolicySource = structuredClone(policy14Source);
  changedPolicySource.parameters.rfi_expiry_days.value += 1;
  const changedPack = loadPolicyPack(changedPolicySource);
  const policyChanged = snapshot(fixture({ pack: changedPack }));
  assert.notEqual(policyChanged.decisionContent.policy.identity.policyHash, base.decisionContent.policy.identity.policyHash);
  assert.notDeepEqual(policyChanged.decisionContent.policy.effectiveParameters, base.decisionContent.policy.effectiveParameters);
  assert.notEqual(policyChanged.snapshotId, base.snapshotId);

  const graphChangedEnvironment = fixture();
  graphChangedEnvironment.graph = { ...structuredClone(graphChangedEnvironment.graph), graphVersion: `${graphChangedEnvironment.graph.graphVersion}:material` };
  graphChangedEnvironment.policyAssessment = { ...structuredClone(graphChangedEnvironment.policyAssessment), graphVersion: graphChangedEnvironment.graph.graphVersion };
  graphChangedEnvironment.requirementResolution = {
    ...structuredClone(graphChangedEnvironment.requirementResolution),
    graphVersion: graphChangedEnvironment.graph.graphVersion,
    requirementResolutions: graphChangedEnvironment.requirementResolution.requirementResolutions.map((record) => ({
      ...record,
      graphReference: { ...record.graphReference, graphVersion: graphChangedEnvironment.graph.graphVersion },
    })),
  };
  const graphChanged = snapshot(graphChangedEnvironment);
  assert.notEqual(graphChanged.snapshotId, base.snapshotId);

  const calculationEnvironment = fixture();
  calculationEnvironment.calculations = [{
    calculationAlgorithm: "ubo-percentage-lookthrough-v1",
    graphVersion: calculationEnvironment.graph.graphVersion,
    subjectEntityId: "person-smo",
    targetEntityId: "customer",
    dimension: "ECONOMIC",
    status: "COMPLETE",
    knownPaths: [], unresolvedPaths: [], cycles: [],
    aggregateKnownValue: { type: "EXACT", value: "30" },
  }];
  const calculationChanged = snapshot(calculationEnvironment);
  assert.notEqual(calculationChanged.snapshotId, base.snapshotId);

  const qualifyingEnvironment = fixture({ noQualifyingPersons: true });
  assert.notEqual(snapshot(qualifyingEnvironment).snapshotId, base.snapshotId);

  const requirementChanged = snapshot(fixture({ statusOverrides: { "UBO-R05": REQUIREMENT_STATE.CONFLICT } }));
  assert.notEqual(requirementChanged.snapshotId, base.snapshotId);

  const needChanged = snapshot(fixture({
    statusOverrides: { "UBO-R01": REQUIREMENT_STATE.GAP },
    needDrafts: [needDraft()],
    policyGap: true,
  }));
  assert.notEqual(needChanged.snapshotId, base.snapshotId);

  const reviewEnvironment = fixture({ noQualifyingPersons: true });
  const pending = runOrchestration(reviewEnvironment, {
    seniorManagementCandidates: seniorCandidates(), seniorManagementCandidatesComplete: true,
  });
  const reviewDecision = createFallbackExhaustionDecision({
    reviewRequirement: pending.reviewRequirement,
    decision: FALLBACK_EXHAUSTION_DECISION.ALL_POSSIBLE_MEANS_EXHAUSTED,
    origin: FALLBACK_DECISION_ORIGIN.ANALYST,
    reasonCode: "ALL_MEASURES_COMPLETE",
  });
  const withDecision = snapshot(reviewEnvironment, {
    seniorManagementCandidates: seniorCandidates(), seniorManagementCandidatesComplete: true,
    fallbackExhaustionDecisions: [reviewDecision],
    smoApplication: { decisionId: reviewDecision.decisionId, personEntityIds: ["person-smo"], reasonCode: "SELECTED" },
    residualCompletenessAttestation: attestation(),
  });
  assert.notEqual(withDecision.snapshotId, snapshot(reviewEnvironment, {
    seniorManagementCandidates: seniorCandidates(), seniorManagementCandidatesComplete: true,
  }).snapshotId);

  const terminalChanged = snapshot(baseEnvironment, { cddUnableToComplete: {
    established: true,
    reasonCode: "CDD_CANNOT_COMPLETE",
    informationNeedIds: ["need:terminal"],
    resolutionAttemptIds: ["attempt:terminal"],
  } });
  assert.notEqual(terminalChanged.snapshotId, base.snapshotId);

  const operativeCase = buildOperativeCase("operative-material");
  const operative = reResolveDecision({
    loadedPolicyPack,
    caseContext: { entityType: "private_limited_company", subjectEntityId: "customer", jurisdiction: "GB", riskLevel: "LOW" },
    caseState: operativeCase,
    calculationRequests: [{ subjectEntityId: "person-alice", targetEntityId: "customer", dimension: GRAPH_DIMENSION.ECONOMIC }],
    evaluationTime: NOW,
    checkpoint: DECISION_CHECKPOINT.CASE_OPEN,
    checkpointReference: { referenceId: "operative-material:open" },
  }).snapshot;
  assert.equal(operative.decisionContent.reasoning.operativeClaims.length, 1);
  assert.notEqual(operative.snapshotId, base.snapshotId);
});

test("linear history preserves genesis, supersession and immutable predecessors", () => {
  const environment = fixture({ caseId: "linear-history" });
  const first = snapshot(environment);
  let history = appendDecisionSnapshot(createDecisionHistory(environment.caseState.caseId), first);
  const before = structuredClone(first);
  const second = snapshot(environment, {}, {
    checkpoint: DECISION_CHECKPOINT.SESSION_START,
    checkpointReference: { referenceId: "session:2" },
    previousSnapshot: first,
    supersessionReason: SUPERSESSION_REASON.SESSION_REEVALUATION,
  });
  history = appendDecisionSnapshot(history, second, { expectedHeadSnapshotId: first.snapshotId });
  assert.equal(first.decisionContent.history.previousSnapshot, null);
  assert.equal(second.decisionContent.history.previousSnapshot.snapshotId, first.snapshotId);
  assert.deepEqual(first, before);
  assert.equal(history.snapshots.length, 2);
  assert.equal(verifyDecisionHistory(history), true);
});

test("stale heads and silent history forks fail with the typed concurrency error", () => {
  const environment = fixture({ caseId: "stale-history" });
  const first = snapshot(environment);
  const historyA = appendDecisionSnapshot(createDecisionHistory(environment.caseState.caseId), first);
  const second = snapshot(environment, {}, {
    checkpoint: DECISION_CHECKPOINT.CASE_EVENT,
    checkpointReference: { referenceId: "event:second" },
    previousSnapshot: first,
    supersessionReason: SUPERSESSION_REASON.NEW_EVIDENCE,
  });
  const historyB = appendDecisionSnapshot(historyA, second, { expectedHeadSnapshotId: first.snapshotId });
  const fork = snapshot(environment, {}, {
    checkpoint: DECISION_CHECKPOINT.CASE_EVENT,
    checkpointReference: { referenceId: "event:fork" },
    previousSnapshot: first,
    supersessionReason: SUPERSESSION_REASON.CUSTOMER_RESPONSE,
  });
  assert.throws(
    () => appendDecisionSnapshot(historyB, fork, { expectedHeadSnapshotId: first.snapshotId }),
    (error) => error instanceof StaleDecisionHistoryError && error.code === "STALE_DECISION_HISTORY_HEAD",
  );
  assert.throws(
    () => appendDecisionSnapshot(historyB, fork, { expectedHeadSnapshotId: second.snapshotId }),
    /stale decision-history head/,
  );

  const brokenSecond = structuredClone(second);
  brokenSecond.decisionContent.history.previousSnapshot.snapshotId = "sha256:wrong";
  const rehashedSecond = rehash(brokenSecond);
  assert.throws(() => verifyDecisionSnapshot(rehashedSecond, { previousSnapshot: first }), /predecessor linkage/);
  assert.throws(() => verifyDecisionHistory({
    historyModelVersion: historyB.historyModelVersion,
    caseId: historyB.caseId,
    snapshots: [first, rehashedSecond],
  }), /predecessor chain is not linear/);
});

test("policy and algorithm changes create new history without rewriting historical identity", () => {
  const historicalSource = structuredClone(policy14Source);
  historicalSource.version = "1.4-RC-HISTORICAL";
  historicalSource.parameters.ownership_threshold_pct.value = 26;
  const historicalPack = loadPolicyPack(historicalSource);
  const historicalEnvironment = fixture({ caseId: "version-history", pack: historicalPack });
  const first = snapshot(historicalEnvironment);
  let history = appendDecisionSnapshot(createDecisionHistory("version-history"), first);

  const currentEnvironment = fixture({ caseId: "version-history", pack: loadedPolicyPack });
  const policySecond = snapshot(currentEnvironment, {}, {
    checkpoint: DECISION_CHECKPOINT.CASE_EVENT,
    checkpointReference: { referenceId: "event:policy-change" },
    previousSnapshot: first,
    supersessionReason: SUPERSESSION_REASON.POLICY_CHANGED,
  });
  history = appendDecisionSnapshot(history, policySecond, { expectedHeadSnapshotId: first.snapshotId });
  assert.equal(first.decisionContent.policy.identity.policyVersion, "1.4-RC-HISTORICAL");
  assert.equal(policySecond.decisionContent.policy.identity.policyVersion, "1.4-RC");
  assert.equal(reconstructDecisionState(first).policy.identity.policyHash, historicalPack.identity.hash);

  const algorithmEnvironment = fixture({ caseId: "version-history", pack: loadedPolicyPack });
  algorithmEnvironment.graph = { ...structuredClone(algorithmEnvironment.graph), graphAlgorithm: "ubo-graph-v2" };
  algorithmEnvironment.policyAssessment = structuredClone(algorithmEnvironment.policyAssessment);
  algorithmEnvironment.policyAssessment.policyIdentity.determinationAlgorithm = "ubo-policy-determination-v2";
  algorithmEnvironment.requirementResolution = structuredClone(algorithmEnvironment.requirementResolution);
  algorithmEnvironment.requirementResolution.policyIdentity.requirementResolutionAlgorithm = "ubo-requirement-resolution-v2";
  const baseOrchestration = runOrchestration(algorithmEnvironment);
  const nextOrchestration = structuredClone(baseOrchestration);
  nextOrchestration.policyIdentity.resolutionOrchestrationAlgorithm = "ubo-resolution-orchestration-v2";
  const algorithmSecond = createDecisionSnapshot({
    ...algorithmEnvironment,
    orchestration: nextOrchestration,
    checkpoint: DECISION_CHECKPOINT.CASE_EVENT,
    checkpointReference: { referenceId: "event:algorithm-change" },
    evaluationTime: NOW,
    previousSnapshot: policySecond,
    supersessionReason: SUPERSESSION_REASON.OTHER_CASE_EVENT,
  });
  history = appendDecisionSnapshot(history, algorithmSecond, { expectedHeadSnapshotId: policySecond.snapshotId });
  assert.equal(first.decisionContent.algorithms.graphAlgorithm, "ubo-graph-v1");
  assert.equal(algorithmSecond.decisionContent.algorithms.graphAlgorithm, "ubo-graph-v2");
  assert.equal(history.snapshots.length, 3);
});

test("reconstruction faithfully returns fully resolved and partial historical decisions", () => {
  const resolved = snapshot(fixture(), { residualCompletenessAttestation: attestation() });
  const resolvedState = reconstructDecisionState(resolved);
  assert.equal(resolvedState.qualifyingPersons[0].entityId, "person-smo");
  assert.equal(resolvedState.terminal.terminalOutcome, "RESOLVED");

  const partial = snapshot(fixture({
    statusOverrides: { "UBO-R01": REQUIREMENT_STATE.GAP },
    needDrafts: [needDraft()],
    policyGap: true,
  }));
  const partialState = reconstructDecisionState(partial);
  assert.equal(partialState.informationNeeds[0].state, "OPEN");
  assert.equal(partialState.policyGaps.length, 1);
  assert.equal(partialState.terminal.orchestrationState, "IN_PROGRESS");
});

test("reconstruction preserves internal review, specialist and conflict states", () => {
  const reviewEnvironment = fixture({ noQualifyingPersons: true });
  const internal = snapshot(reviewEnvironment, {
    seniorManagementCandidates: seniorCandidates(), seniorManagementCandidatesComplete: true,
    residualCompletenessAttestation: attestation(),
  });
  const internalState = reconstructDecisionState(internal);
  assert.equal(internalState.customerProjection.state, "INTERNAL_REVIEW_REQUIRED");
  assert.equal(internalState.reviewRequirements[0].state, "PENDING");

  const specialist = reconstructDecisionState(snapshot(fixture({
    statusOverrides: { "UBO-R11": REQUIREMENT_STATE.REVIEW_REQUIRED },
  })));
  assert.equal(specialist.requirementResolutions.find(({ requirementId }) => requirementId === "UBO-R11").requirementStatus,
    REQUIREMENT_STATE.REVIEW_REQUIRED);
  assert.equal(specialist.terminal.terminalOutcome, "SPECIALIST_REVIEW_REQUIRED");

  const conflict = reconstructDecisionState(snapshot(fixture({
    statusOverrides: { "UBO-R05": REQUIREMENT_STATE.CONFLICT },
  })));
  assert.equal(conflict.requirementResolutions.find(({ requirementId }) => requirementId === "UBO-R05").requirementStatus,
    REQUIREMENT_STATE.CONFLICT);
  assert.equal(conflict.terminal.orchestrationState, "IN_PROGRESS");
});

test("valid SMO fallback reconstructs the complete R10 measures manifest", () => {
  const environment = fixture({ noQualifyingPersons: true });
  const pending = runOrchestration(environment, {
    seniorManagementCandidates: seniorCandidates(), seniorManagementCandidatesComplete: true,
  });
  const decision = createFallbackExhaustionDecision({
    reviewRequirement: pending.reviewRequirement,
    decision: FALLBACK_EXHAUSTION_DECISION.ALL_POSSIBLE_MEANS_EXHAUSTED,
    origin: FALLBACK_DECISION_ORIGIN.COMPLIANCE,
    reasonCode: "EXHAUSTION_CONFIRMED",
  });
  const fallback = snapshot(environment, {
    seniorManagementCandidates: seniorCandidates(), seniorManagementCandidatesComplete: true,
    fallbackExhaustionDecisions: [decision],
    smoApplication: { decisionId: decision.decisionId, personEntityIds: ["person-smo"], reasonCode: "SMO_SELECTED" },
    residualCompletenessAttestation: attestation(),
  });
  const state = reconstructDecisionState(fallback);
  assert.equal(state.terminal.terminalOutcome, "RESOLVED_VIA_SMO_FALLBACK");
  assert.equal(state.fallbackApplication.roles[0].role, "senior_managing_official_fallback");
  assert.equal(state.riskSignals.some(({ requirementId, level }) => requirementId === "UBO-R10" && level === "HIGH"), true);
  assert.equal(state.measuresTakenManifest.fallbackExhaustionDecision.decisionId, decision.decisionId);
  assert.equal(state.measuresTakenManifest.reviewRequirement.reviewRequirementId, pending.reviewRequirement.reviewRequirementId);
  assert.match(state.measuresTakenManifest.reasoningManifestHash, /^sha256:/);
});

test("customer fact re-resolution supersedes but never mutates the unresolved snapshot", () => {
  const caseId = "customer-reresolution";
  const initialCase = buildCase(caseId);
  const common = {
    loadedPolicyPack,
    caseContext: { entityType: "private_limited_company", subjectEntityId: "customer", jurisdiction: "GB", riskLevel: "LOW" },
    evaluationTime: NOW,
  };
  const first = reResolveDecision({
    ...common,
    caseState: initialCase,
    checkpoint: DECISION_CHECKPOINT.CASE_OPEN,
    checkpointReference: { referenceId: `${caseId}:open` },
  });
  const before = structuredClone(first.snapshot);
  const changedCase = buildOperativeCase(caseId, 40);
  const second = reResolveDecision({
    ...common,
    caseState: changedCase,
    calculationRequests: [
      { subjectEntityId: "person-alice", targetEntityId: "customer", dimension: GRAPH_DIMENSION.VOTING },
      { subjectEntityId: "person-alice", targetEntityId: "customer", dimension: GRAPH_DIMENSION.ECONOMIC },
    ],
    checkpoint: DECISION_CHECKPOINT.CASE_EVENT,
    checkpointReference: { referenceId: `${caseId}:customer-response`, eventType: "CUSTOMER_RESPONSE" },
    supersessionReason: SUPERSESSION_REASON.CUSTOMER_RESPONSE,
    decisionHistory: first.decisionHistory,
    expectedHeadSnapshotId: first.snapshot.snapshotId,
  });
  assert.notEqual(second.snapshot.snapshotId, first.snapshot.snapshotId);
  assert.equal(second.snapshot.decisionContent.history.previousSnapshot.snapshotId, first.snapshot.snapshotId);
  assert.equal(second.snapshot.decisionContent.reasoning.operativeClaims.length, 1);
  assert.equal(second.calculations[0].status, "COMPLETE");
  assert.deepEqual(first.snapshot, before);
});

test("analyst review decision is a CASE_EVENT and produces a new fallback snapshot", () => {
  const environment = fixture({ caseId: "review-reresolution", noQualifyingPersons: true });
  const pendingOrchestration = runOrchestration(environment, {
    seniorManagementCandidates: seniorCandidates(), seniorManagementCandidatesComplete: true,
    residualCompletenessAttestation: attestation(),
  });
  const first = snapshot(environment, {
    seniorManagementCandidates: seniorCandidates(), seniorManagementCandidatesComplete: true,
    residualCompletenessAttestation: attestation(),
  });
  let history = appendDecisionSnapshot(createDecisionHistory(environment.caseState.caseId), first);
  const decision = createFallbackExhaustionDecision({
    reviewRequirement: pendingOrchestration.reviewRequirement,
    decision: FALLBACK_EXHAUSTION_DECISION.ALL_POSSIBLE_MEANS_EXHAUSTED,
    origin: FALLBACK_DECISION_ORIGIN.ANALYST,
    reasonCode: "ANALYST_CONFIRMED",
  });
  const second = snapshot(environment, {
    seniorManagementCandidates: seniorCandidates(), seniorManagementCandidatesComplete: true,
    fallbackExhaustionDecisions: [decision],
    smoApplication: { decisionId: decision.decisionId, personEntityIds: ["person-smo"], reasonCode: "SELECTED" },
    residualCompletenessAttestation: attestation(),
  }, {
    checkpoint: DECISION_CHECKPOINT.CASE_EVENT,
    checkpointReference: { referenceId: "review-reresolution:analyst-decision", eventType: "INTERNAL_REVIEW_DECISION" },
    previousSnapshot: first,
    supersessionReason: SUPERSESSION_REASON.INTERNAL_REVIEW_DECISION,
  });
  history = appendDecisionSnapshot(history, second, { expectedHeadSnapshotId: first.snapshotId });
  assert.equal(reconstructDecisionState(first).customerProjection.state, "INTERNAL_REVIEW_REQUIRED");
  assert.equal(reconstructDecisionState(second).terminal.terminalOutcome, "RESOLVED_VIA_SMO_FALLBACK");
  assert.equal(history.snapshots.length, 2);
});

test("the pure Gate 2 coordinator is deterministic and has no provider, time or persistence dependency", () => {
  const caseState = buildOperativeCase("e2e-determinism", 30);
  const input = {
    loadedPolicyPack,
    caseContext: { entityType: "private_limited_company", subjectEntityId: "customer", jurisdiction: "GB", riskLevel: "LOW" },
    caseState,
    calculationRequests: [{ subjectEntityId: "person-alice", targetEntityId: "customer", dimension: GRAPH_DIMENSION.ECONOMIC }],
    evaluationTime: NOW,
    checkpoint: DECISION_CHECKPOINT.SUBMIT_GATE,
    checkpointReference: { referenceId: "e2e-determinism:submit" },
  };
  const first = reResolveDecision(input);
  const second = reResolveDecision(structuredClone(input));
  assert.equal(first.snapshot.snapshotId, second.snapshot.snapshotId);
  assert.deepEqual(first.snapshot.decisionContent, second.snapshot.decisionContent);
  assert.equal(first.snapshot.decisionContent.checkpoint.type, DECISION_CHECKPOINT.SUBMIT_GATE);
  assert.equal(first.orchestration.terminal.orchestrationState, "IN_PROGRESS");
  assert.equal(Object.prototype.hasOwnProperty.call(first, "discovery"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(first, "persistence"), false);
});
