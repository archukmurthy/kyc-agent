"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  CAPABILITY_CONTRACT_VERSION, CAPABILITY_OUTCOME_STATE, CANDIDATE_FACT_TYPE, CLAIM_STATE,
  IDENTITY_RESOLUTION_STATUS, PERCENTAGE_VALUE_TYPE, RELATIONSHIP_TYPE,
} = require("../contracts/constants");
const { CANONICAL_ENTITY_CATEGORY } = require("../domain/canonicalEntity");
const { verifyDecisionSnapshotV2 } = require("../domain/decisionSnapshotV2");
const { createDecisionHistoryV2, appendDecisionSnapshotV2, reconstructAny } = require("../domain/decisionHistoryV2");
const { addCanonicalEntity, adjudicateClaim, createOwnershipCase, intakeCapabilityResult, recordIdentityResolutionDecision } = require("../domain/ownershipCase");
const { evaluateUboDecisionV3Review, PHASE_IDS } = require("../application/evaluateUboDecisionV3Review");
const { reResolveDecision } = require("../application/reResolveDecision");
const { createDecisionSnapshotV2 } = require("../domain/decisionSnapshotV2");
const { hashArtifact } = require("../internal/phasedArtifact");
const { planUboResolution } = require("../planning/uboResolutionPlanner");
const { loadPolicyPack } = require("../policy/policyPack");

const NOW = "2026-09-04T09:00:00.000Z";
const POLICY = require("../policies/uk-corporate/1.6-rc/policy.json");
const POLICY_15 = require("../policies/uk-corporate/1.5-rc/policy.json");

function party(id, natural = false) { return { name: id, entityType: natural ? "NATURAL_PERSON" : "COMPANY", entityId: id, externalIdentifiers: [] }; }
function exact(value) { return { type: PERCENTAGE_VALUE_TYPE.EXACT, value }; }
function caseFixture() {
  const edges = [
    { factId: "person-holdco-60", subject: party("person-a", true), object: party("holdco"), relationship: RELATIONSHIP_TYPE.ECONOMIC_OWNERSHIP, measurement: exact(60), qualifiers: { currentState: "CURRENT", economicInterestConcept: "SHARE_OWNERSHIP" } },
    { factId: "person-holdco-vote-60", subject: party("person-a", true), object: party("holdco"), relationship: RELATIONSHIP_TYPE.VOTING_RIGHTS, measurement: exact(60), qualifiers: { currentState: "CURRENT" } },
    { factId: "holdco-target-40", subject: party("holdco"), object: party("target"), relationship: RELATIONSHIP_TYPE.ECONOMIC_OWNERSHIP, measurement: exact(40), qualifiers: { currentState: "CURRENT", economicInterestConcept: "SHARE_OWNERSHIP" } },
  ];
  let state = createOwnershipCase({ caseId: "wave-7-case", subjectReference: party("target"), externalReferences: [], createdAt: NOW });
  [{ id: "person-a", natural: true }, { id: "holdco" }, { id: "target" }].forEach(({ id, natural }) => {
    state = addCanonicalEntity(state, { entityId: id, category: natural ? CANONICAL_ENTITY_CATEGORY.NATURAL_PERSON : CANONICAL_ENTITY_CATEGORY.LEGAL_ENTITY, primaryName: id, aliases: [], externalIdentifiers: [], entityTypeMetadata: natural ? {} : { entityProfile: "COMPANY" }, jurisdiction: "GB" }, { recordedAt: NOW });
  });
  state = intakeCapabilityResult(state, { contractVersion: CAPABILITY_CONTRACT_VERSION, requestId: "wave-7-request", outcome: { state: CAPABILITY_OUTCOME_STATE.COMPLETE }, candidateFacts: edges.map((edge) => ({ type: CANDIDATE_FACT_TYPE.RELATIONSHIP, evidenceReferences: [], ...edge })), operationEvidenceReferences: [], issues: [] }, { operationId: "wave-7-operation", recordedAt: NOW });
  for (const claim of [...state.candidateClaims]) {
    for (const [side, endpoint] of [["subject", claim.subject], ["object", claim.object]]) {
      state = recordIdentityResolutionDecision(state, { decisionId: `${claim.claimId}:${side}`, candidatePartyKey: endpoint.candidatePartyKey, status: IDENTITY_RESOLUTION_STATUS.RESOLVED, entityId: endpoint.party.entityId, basisReasonCodes: ["WAVE_7_FIXTURE"], evidenceReferences: [], decidedAt: NOW, decisionOrigin: "WAVE_7_TEST" });
    }
    state = adjudicateClaim(state, { decisionId: `${claim.claimId}:operative`, claimId: claim.claimId, previousState: CLAIM_STATE.CANDIDATE, resultingState: CLAIM_STATE.OPERATIVE, reasonBasisCode: "WAVE_7_FIXTURE", supportingEvidenceReferences: [], decisionOrigin: "WAVE_7_TEST", decidedAt: NOW, supersededByClaimIds: [], adversarialClaimIds: [] });
  }
  return state;
}
function evaluate(overrides = {}) {
  return evaluateUboDecisionV3Review({
    policyPack: POLICY, runtimeMode: "LAB", caseState: caseFixture(),
    caseContext: { entityType: "private_limited_company", subjectEntityId: "target", jurisdiction: "GB", riskLevel: "MEDIUM" },
    evaluationTime: NOW, checkpoint: "CASE_EVENT", checkpointReference: { referenceId: "wave-7-evaluation" },
    ...overrides,
  });
}

test("Wave 7 executes the frozen nine phases and pins a plan before DecisionSnapshot v2", () => {
  const result = evaluate();
  const repeated = evaluate();
  assert.deepEqual(result.phaseArtifacts.map(({ phaseId }) => phaseId), PHASE_IDS);
  result.phaseArtifacts.forEach((artifact) => { assert.equal(Object.isFrozen(artifact), true); assert.match(artifact.outputHash, /^sha256:[a-f0-9]{64}$/); });
  assert.equal(result.snapshot.snapshotSchemaVersion, "ubo-decision-snapshot-v2");
  assert.equal(result.snapshot.decisionContent.runtimeMode, "LAB");
  assert.equal(result.snapshot.decisionContent.productionAuthorized, false);
  assert.equal(result.snapshot.decisionContent.pipelineMaturity, "TRANSITIONAL_REVIEW_ONLY");
  assert.equal(result.snapshot.decisionContent.pinnedResolutionPlan.planId, result.resolutionPlan.planId);
  assert.equal(result.phaseArtifacts[7].output.planHash, result.resolutionPlan.planHash);
  assert.deepEqual(result.resolutionPlan, result.snapshot.decisionContent.pinnedResolutionPlan);
  assert.equal(verifyDecisionSnapshotV2(result.snapshot), true);
  const roundTripped = JSON.parse(JSON.stringify(result.snapshot));
  assert.equal(verifyDecisionSnapshotV2(roundTripped), true);
  assert.equal(roundTripped.snapshotId, result.snapshot.snapshotId);
  assert.equal(repeated.snapshot.snapshotId, result.snapshot.snapshotId);
  assert.throws(() => createDecisionSnapshotV2({ phaseArtifacts: result.phaseArtifacts.slice(0, 8), pinnedPlan: null }), /requires one pinned compatibility plan/);
  assert.throws(() => planUboResolution({ decisionSnapshot: result.snapshot }), /not supported|not supported by this planning contract/i);
  assert.throws(() => evaluate({ runtimeMode: "PRODUCTION" }), /explicit LAB mode/);
});

test("successor evaluation does not mutate its sealed case-state input", () => {
  const caseState = caseFixture();
  const before = structuredClone(caseState);
  evaluate({ caseState });
  assert.deepEqual(caseState, before);
});

test("graph-derived applicability and route union ignore caller authority", () => {
  const result = evaluate();
  assert.equal(result.derivedRequirementApplicability.facts.economicOwnershipLayers, 2);
  assert.equal(result.derivedRequirementApplicability.requirements["UBO-R02"].applicable, true);
  assert.equal(result.derivedRequirementApplicability.requirements["UBO-R03"].applicable, true);
  assert.equal(result.derivedRequirementApplicability.requirements["UBO-R07"].applicable, true);
  const person = result.personQualificationAssessments.find(({ personEntityId }) => personEntityId === "person-a");
  const effective = person.basisRecords.find(({ route }) => route === "EFFECTIVE_INTEREST");
  const attributed = person.basisRecords.find(({ route }) => route === "PSC_CONDITION_ATTRIBUTION");
  assert.equal(effective.recordedCalculation.value.value, "24");
  assert.equal(effective.assessmentState, "NOT_SATISFIED");
  assert.equal(attributed.assessmentState, "SATISFIED");
  assert.equal(person.routeStatus, "ROUTE_SATISFIED");
  assert.throws(() => evaluate({ facts: { ownership_layers: 99 } }), /prohibited/);
  assert.throws(() => evaluate({ facts: { qualifying_persons_count: 99 } }), /prohibited/);
});

test("v2 history is linear, stale-head protected and reconstructs without recalculation", () => {
  const result = evaluate();
  const history = createDecisionHistoryV2("wave-7-case");
  const appended = appendDecisionSnapshotV2(history, result.snapshot, { expectedHeadSnapshotId: null });
  assert.equal(appended.snapshots.length, 1);
  assert.equal(reconstructAny(result.snapshot).recordedDecision.pinnedResolutionPlan.planHash, result.resolutionPlan.planHash);
  assert.throws(() => appendDecisionSnapshotV2(appended, result.snapshot, { expectedHeadSnapshotId: null }), /stale/i);
});

test("snapshot v2 detects independently tampered phase, basis, closure, plan, algorithm and policy pins", () => {
  const result = evaluate();
  const mutations = [
    (value) => { value.decisionContent.phaseArtifacts[1].outputHash = "sha256:" + "0".repeat(64); },
    (value) => { value.decisionContent.phaseManifest[1].algorithmVersion = "tampered-manifest-version"; },
    (value) => {
      value.decisionContent.phaseArtifacts[1].algorithmVersion = "tampered-phase-version";
      value.decisionContent.phaseManifest[1].algorithmVersion = "tampered-phase-version";
    },
    (value) => { value.decisionContent.qualificationBasisRecords[0].reasonCode = "TAMPERED"; },
    (value) => { value.decisionContent.companyAttributionAssessments[0].assessmentId = "TAMPERED"; },
    (value) => { value.decisionContent.layerClosureAssessments[0].dimension = "TAMPERED"; },
    (value) => { value.decisionContent.pinnedResolutionPlan.planHash = "sha256:" + "1".repeat(64); },
    (value) => { value.decisionContent.algorithmManifest.graph = "tampered"; },
    (value) => { value.decisionContent.policy.identity.policyHash = "sha256:" + "2".repeat(64); },
    (value) => { value.decisionContent.history.previousSnapshot = { snapshotId: "fake", decisionContentHash: "fake" }; },
  ];
  mutations.forEach((mutate) => {
    const copy = structuredClone(result.snapshot);
    mutate(copy);
    copy.decisionContentHash = hashArtifact(copy.decisionContent);
    copy.snapshotId = copy.decisionContentHash;
    assert.throws(() => verifyDecisionSnapshotV2(copy));
  });
});

test("future-phase references are rejected even when the outer snapshot hash is recomputed", () => {
  const copy = structuredClone(evaluate().snapshot);
  copy.decisionContent.phaseArtifacts[2].inputArtifacts[0] = {
    artifactId: copy.decisionContent.phaseArtifacts[7].outputArtifactId,
    artifactHash: copy.decisionContent.phaseArtifacts[7].outputHash,
  };
  copy.decisionContent.phaseManifest = copy.decisionContent.phaseArtifacts.map(({ output, ...entry }) => entry);
  copy.decisionContentHash = hashArtifact(copy.decisionContent);
  copy.snapshotId = copy.decisionContentHash;
  assert.throws(() => verifyDecisionSnapshotV2(copy), /future, unknown or mismatched/);
});

test("Wave 6 closure/evidence diagnostics are recorded without manufacturing a Wave 8 exactness need", () => {
  const relationshipIdentity = { relationshipId: "evidence-rel", holderEntityId: "person-a", targetEntityId: "target", relationshipBasis: "COMPANY_SHARE_OWNERSHIP", dimension: "ECONOMIC", temporalState: "CURRENT", interestClassRef: "ordinary", denominatorRef: "total" };
  const evidenceReference = (referenceId) => ({ system: "TEST", referenceType: "DOCUMENT", referenceId });
  const result = evaluate({ percentageEvidenceInputs: [{
    relationshipIdentity,
    declaredPercentage: { measurement: { type: "EXACT", value: "30" }, evidenceReference: evidenceReference("declaration"), relationshipIdentity, declarationAuthority: "APPLICANT_AUTHORISED_PERSON" },
    independentBandEvidence: { measurement: { type: "RANGE", lowerBound: "25", upperBound: "50", lowerInclusive: false, upperInclusive: true }, evidenceReference: evidenceReference("band"), sourceOrigin: "INDEPENDENT_OF_APPLICANT", independenceBasis: { sourceId: "registry", artifactId: "filing", basis: "SOURCE_SYSTEM_RECORD" }, relationshipIdentity, currentness: "CURRENT" },
  }] });
  assert.equal(result.percentageEvidenceAssessments[0].operationalSufficiency, "REQUIRES_POLICY_SIGNOFF");
  assert.ok(result.snapshot.decisionContent.requiredSignoffIds.includes("A-03"));
  assert.ok(result.layerClosureAssessments.every(({ statutoryClosure, exactnessNeededForDetermination }) => statutoryClosure && exactnessNeededForDetermination));
  assert.equal(JSON.stringify(result.compatibilityRequirementStage.requirementResolution.informationNeeds).includes("EXACTNESS"), false);
});

test("DecisionHistory v2 permits a valid v1 predecessor and requires a neutral cross-version reason", () => {
  const caseState = caseFixture();
  const previous = reResolveDecision({
    loadedPolicyPack: loadPolicyPack(POLICY_15), caseState,
    caseContext: { entityType: "private_limited_company", subjectEntityId: "target", jurisdiction: "GB", riskLevel: "MEDIUM" },
    calculationRequests: [{ subjectEntityId: "person-a", targetEntityId: "target", dimension: "ECONOMIC" }],
    evaluationTime: NOW, facts: { ownership_layers: 2, qualifying_persons_count: 0 },
    checkpoint: "CASE_EVENT", checkpointReference: { referenceId: "v1-predecessor" },
  }).snapshot;
  const successor = evaluate({ predecessorSnapshot: previous, supersessionReason: "POLICY_CHANGED" }).snapshot;
  const history = createDecisionHistoryV2("wave-7-case", [previous]);
  const appended = appendDecisionSnapshotV2(history, successor, { expectedHeadSnapshotId: previous.snapshotId });
  assert.deepEqual(appended.snapshots.map(({ snapshotSchemaVersion }) => snapshotSchemaVersion), ["ubo-decision-snapshot-v1", "ubo-decision-snapshot-v2"]);
  assert.throws(() => evaluate({ predecessorSnapshot: previous }), /approved explicit supersession reason/);
});
