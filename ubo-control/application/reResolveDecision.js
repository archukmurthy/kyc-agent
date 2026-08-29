"use strict";

const {
  appendDecisionSnapshot,
  createDecisionHistory,
  createDecisionSnapshot,
  verifyDecisionHistory,
} = require("../domain/decisionSnapshot");
const { calculateEffectivePercentage } = require("../domain/percentageCalculation");
const { buildCanonicalOwnershipGraph } = require("../domain/ownershipGraph");
const {
  assertArray,
  assertDataOnly,
  assertPlainObject,
  cloneData,
  deepFreeze,
} = require("../internal/validation");
const { determinePolicyAssessment } = require("../policy/policyDetermination");
const { resolvePolicyRequirements } = require("../policy/requirementResolution");
const { orchestrateResolution } = require("../policy/resolutionOrchestration");

const RE_RESOLUTION_COORDINATOR_ALGORITHM = "ubo-gate-2-re-resolution-coordinator-v1";

function reResolveDecision({
  loadedPolicyPack,
  caseContext,
  caseState,
  calculationRequests = [],
  evidenceClassifications = [],
  evaluationTime,
  facts = {},
  answers = {},
  relevantConflicts = [],
  operationContexts = [],
  priorInformationNeedRecords = [],
  strategyAvailability = [],
  resolutionAttempts = [],
  priorReviewRequirements = [],
  fallbackExhaustionDecisions = [],
  seniorManagementCandidates = [],
  seniorManagementCandidatesComplete = false,
  smoApplication,
  pscComparison,
  residualCompletenessAttestation,
  cddUnableToComplete,
  unresolvableAssessment,
  checkpoint,
  checkpointReference,
  supersessionReason,
  decisionHistory,
  expectedHeadSnapshotId = null,
  recordingMetadata = {},
}) {
  assertPlainObject(caseContext, "caseContext");
  assertArray(calculationRequests, "calculationRequests");
  calculationRequests.forEach((request, index) => {
    assertPlainObject(request, `calculationRequests[${index}]`);
    assertDataOnly(request, `calculationRequests[${index}]`);
  });
  const history = decisionHistory || createDecisionHistory(caseState.caseId);
  verifyDecisionHistory(history);
  const graph = buildCanonicalOwnershipGraph(caseState);
  const calculations = calculationRequests
    .map((request) => calculateEffectivePercentage(graph, request))
    .sort((left, right) => {
      const leftKey = `${left.subjectEntityId}|${left.targetEntityId}|${left.dimension}`;
      const rightKey = `${right.subjectEntityId}|${right.targetEntityId}|${right.dimension}`;
      return leftKey.localeCompare(rightKey);
    });
  const policyAssessment = determinePolicyAssessment({
    loadedPolicyPack,
    caseContext,
    caseState,
    graph,
    calculations,
    facts,
    answers,
  });
  const requirementResolution = resolvePolicyRequirements({
    loadedPolicyPack,
    caseContext,
    caseState,
    graph,
    calculations,
    policyAssessment,
    evidenceClassifications,
    evaluationDate: evaluationTime,
    facts,
    answers,
    relevantConflicts,
    operationContexts,
    priorInformationNeedRecords,
  });
  const orchestration = orchestrateResolution({
    loadedPolicyPack,
    caseContext,
    caseState,
    graph,
    calculations,
    policyAssessment,
    requirementResolution,
    facts,
    answers,
    strategyAvailability,
    resolutionAttempts,
    priorReviewRequirements,
    fallbackExhaustionDecisions,
    seniorManagementCandidates,
    seniorManagementCandidatesComplete,
    smoApplication,
    pscComparison,
    residualCompletenessAttestation,
    cddUnableToComplete,
    unresolvableAssessment,
  });
  const previousSnapshot = history.snapshots.length === 0
    ? null
    : history.snapshots[history.snapshots.length - 1];
  const snapshot = createDecisionSnapshot({
    loadedPolicyPack,
    caseContext,
    caseState,
    graph,
    calculations,
    policyAssessment,
    requirementResolution,
    orchestration,
    facts,
    answers,
    resolutionAttempts,
    fallbackExhaustionDecisions,
    checkpoint,
    checkpointReference,
    evaluationTime,
    previousSnapshot,
    supersessionReason,
    recordingMetadata,
  });
  const nextHistory = appendDecisionSnapshot(history, snapshot, { expectedHeadSnapshotId });
  return deepFreeze({
    coordinatorAlgorithm: RE_RESOLUTION_COORDINATOR_ALGORITHM,
    graph,
    calculations,
    policyAssessment,
    requirementResolution,
    orchestration,
    snapshot,
    decisionHistory: nextHistory,
    checkpoint: cloneData(snapshot.decisionContent.checkpoint),
  });
}

module.exports = {
  RE_RESOLUTION_COORDINATOR_ALGORITHM,
  reResolveDecision,
};
