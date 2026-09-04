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

function recordedWave7Snapshot(wave8Snapshot) {
  const snapshot = structuredClone(wave8Snapshot);
  const content = snapshot.decisionContent;
  ["requirementStageVersion", "causalInformationNeedSetV2", "informationNeedsV2", "dependentDiagnostics", "plannerCompatibilityAdapter", "specialistRoutes"].forEach((key) => delete content[key]);
  content.pipelineMaturity = "TRANSITIONAL_REVIEW_ONLY";
  content.algorithmManifest.requirementResolution = "ubo-requirement-resolution-v1-compat";
  delete content.algorithmManifest.informationNeed;
  delete content.algorithmManifest.dependentDiagnostic;
  delete content.algorithmManifest.plannerCompatibilityAdapter;
  const phase7 = content.phaseArtifacts[6];
  phase7.algorithmVersion = "ubo-requirement-resolution-v1-compat";
  phase7.marker = "TRANSITIONAL_REVIEW_ONLY";
  phase7.output = { compatibilityStageVersion: "ubo-requirement-resolution-v1-compat", pipelineMaturity: "TRANSITIONAL_REVIEW_ONLY", orchestration: { requirementResolutions: structuredClone(content.requirementResolutions) } };
  phase7.outputHash = hashArtifact(phase7.output);
  phase7.outputArtifactId = `information_needs:${phase7.outputHash.slice(7, 39)}`;
  const phase8 = content.phaseArtifacts[7];
  phase8.marker = "TRANSITIONAL_REVIEW_ONLY";
  phase8.inputArtifacts = [{ artifactId: phase7.outputArtifactId, artifactHash: phase7.outputHash }];
  const plan = structuredClone(content.pinnedResolutionPlan);
  plan.inputStateHash = phase7.outputHash;
  const planSemantic = Object.fromEntries(Object.entries(plan).filter(([key]) => !["planId", "planHash"].includes(key)));
  plan.planHash = hashArtifact(planSemantic);
  plan.planId = `ubo-resolution-plan-v1-compat:${plan.planHash.slice(7, 39)}`;
  content.pinnedResolutionPlan = plan;
  phase8.output = { planId: plan.planId, planHash: plan.planHash, plan };
  phase8.outputHash = hashArtifact(phase8.output);
  phase8.outputArtifactId = `resolution_planning:${phase8.outputHash.slice(7, 39)}`;
  const phase9 = content.phaseArtifacts[8];
  phase9.marker = "TRANSITIONAL_REVIEW_ONLY";
  phase9.inputArtifacts = [...content.phaseArtifacts.slice(0, 8).map(({ outputArtifactId, outputHash }) => ({ artifactId: outputArtifactId, artifactHash: outputHash })), { artifactId: plan.planId, artifactHash: plan.planHash }];
  const { phaseManifest: ignoredManifest, phaseArtifacts, ...seedRest } = content;
  phase9.output = { snapshotConstructionInputHash: hashArtifact({ ...seedRest, phaseArtifacts: phaseArtifacts.slice(0, 8) }), pinnedPlanId: plan.planId, pinnedPlanHash: plan.planHash };
  phase9.outputHash = hashArtifact(phase9.output);
  phase9.outputArtifactId = `decision_snapshot:${phase9.outputHash.slice(7, 39)}`;
  content.phaseManifest = content.phaseArtifacts.map(({ output, ...entry }) => entry);
  snapshot.decisionContentHash = hashArtifact(content);
  snapshot.snapshotId = snapshot.decisionContentHash;
  return snapshot;
}

test("Wave 8 executes the frozen nine phases and pins one transitional plan before DecisionSnapshot v2", () => {
  const result = evaluate();
  const repeated = evaluate();
  assert.deepEqual(result.phaseArtifacts.map(({ phaseId }) => phaseId), PHASE_IDS);
  result.phaseArtifacts.forEach((artifact) => { assert.equal(Object.isFrozen(artifact), true); assert.match(artifact.outputHash, /^sha256:[a-f0-9]{64}$/); });
  assert.equal(result.snapshot.snapshotSchemaVersion, "ubo-decision-snapshot-v2");
  assert.equal(result.snapshot.decisionContent.runtimeMode, "LAB");
  assert.equal(result.snapshot.decisionContent.productionAuthorized, false);
  assert.equal(result.snapshot.decisionContent.pipelineMaturity, "TRANSITIONAL_PLANNER_ONLY");
  assert.equal(result.phaseArtifacts[6].algorithmVersion, "ubo-requirement-resolution-v2");
  const openNeeds = result.requirementStage.requirementResolution.informationNeeds.filter(({ status }) => status === "OPEN");
  assert.equal(openNeeds.filter(({ concept, targetKind }) => concept === "VOTING_CONTROL_STATUS" && targetKind === "REGULATED_SUBJECT").length, 1);
  assert.equal(openNeeds.filter(({ requiredByRequirementIds, targetKind }) => requiredByRequirementIds.includes("UBO-R04") && targetKind === "FRONTIER_ENTITY").length, 0);
  assert.equal(openNeeds.filter(({ concept }) => concept === "INDEPENDENT_CORROBORATION").length, 1);
  assert.equal(openNeeds.filter(({ concept }) => concept === "QUALIFYING_PERSON_ATTRIBUTES").length, 1);
  assert.equal(openNeeds.filter(({ concept }) => ["OTHER_SIGNIFICANT_CONTROL_STATUS", "TRUST_STATUS", "NOMINEE_BEARER_STATUS"].includes(concept)).length, 3);
  assert.equal(openNeeds.some(({ concept }) => concept === "CASE_COMPLETENESS_ATTESTATION"), false);
  assert.equal(openNeeds.some(({ requiredByRequirementIds }) => requiredByRequirementIds.includes("UBO-R13")), false);
  const blockedControlNeedIds = new Set(openNeeds.filter(({ concept }) => ["VOTING_CONTROL_STATUS", "OTHER_SIGNIFICANT_CONTROL_STATUS", "TRUST_STATUS", "NOMINEE_BEARER_STATUS"].includes(concept)).map(({ needId }) => needId));
  assert.equal(result.plannerCompatibilityAdapter.decisionState.resolutionOptions.some(({ informationNeedId, strategy, applicabilityState }) => blockedControlNeedIds.has(informationNeedId) && strategy.startsWith("CUSTOMER_") && applicabilityState === "APPLICABLE"), false);
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

test("Snapshot v2 dispatcher preserves recorded Wave 7 Phase 7 artifacts", () => {
  const wave7 = recordedWave7Snapshot(evaluate().snapshot);
  assert.equal(verifyDecisionSnapshotV2(wave7), true);
  assert.equal(reconstructAny(wave7).recordedDecision.phaseArtifacts[6].algorithmVersion, "ubo-requirement-resolution-v1-compat");
  assert.equal(reconstructAny(evaluate().snapshot).recordedDecision.phaseArtifacts[6].algorithmVersion, "ubo-requirement-resolution-v2");
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
    (value) => { value.decisionContent.informationNeedsV2[0].reasonCode = "TAMPERED_CAUSE"; },
    (value) => { value.decisionContent.dependentDiagnostics[0].causalNeedId = "ubo-information-need-v2:unknown"; },
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
  assert.equal(JSON.stringify(result.requirementStage.requirementResolution.informationNeeds).includes("EXACTNESS"), false);
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

test("R09 comparison categories remain typed review data and never execute a regulatory report", () => {
  const scope = evaluate({ facts: { register_scope_difference: true } }).requirementStage.requirementResolution.pscComparison;
  const method = evaluate({ facts: { method_difference: true } }).requirementStage.requirementResolution.pscComparison;
  const stale = evaluate({ facts: { psc_record_stale: true } }).requirementStage.requirementResolution.pscComparison;
  const conflict = evaluate({ relevantConflicts: [{ conflictId: "conflict-1", requirementIds: ["UBO-R09"] }] }).requirementStage.requirementResolution;
  assert.equal(scope.category, "REGISTER_SCOPE_DIFFERENCE");
  assert.equal(method.category, "METHOD_DIFFERENCE");
  assert.equal(stale.category, "TIMING_STALENESS");
  assert.equal(conflict.pscComparison.category, "POTENTIAL_MATERIAL_DISCREPANCY");
  assert.ok(conflict.reviewRequirements.some(({ requirementIds }) => requirementIds.includes("UBO-R09")));
  [scope, method, stale, conflict.pscComparison].forEach((comparison) => {
    assert.equal(comparison.regulatoryReportSubmitted, false);
    assert.equal(comparison.reportCandidateCreated, false);
  });
});
