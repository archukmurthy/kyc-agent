"use strict";

const { cloneData, deepFreeze, fail } = require("../internal/validation");
const { createPhaseArtifact, hashArtifact } = require("../internal/phasedArtifact");
const { canonicalizeJson } = require("../policy/canonicalJson");
const { hashPolicyPack, validatePolicyPack } = require("../policy/policyPack");
const { verifyDecisionSnapshot } = require("./decisionSnapshot");
const { validateInformationNeedV2 } = require("./informationNeedV2");

const DECISION_SNAPSHOT_V2 = "ubo-decision-snapshot-v2";
const DECISION_SNAPSHOT_CONSTRUCTION_V2 = "ubo-decision-snapshot-construction-v2";
const DECISION_RECONSTRUCTION_V2 = "ubo-decision-reconstruction-v2";
const PIPELINE_MATURITY_WAVE_7 = "TRANSITIONAL_REVIEW_ONLY";
const PIPELINE_MATURITY_WAVE_8 = "TRANSITIONAL_PLANNER_ONLY";
const PIPELINE_MATURITY = PIPELINE_MATURITY_WAVE_7;
const HISTORY_REASONS_V2 = Object.freeze(["POLICY_CHANGED", "ALGORITHM_CHANGED", "NEW_FACTS", "REVIEW_DECISION", "CUSTOMER_INPUT"]);
const EXPECTED_PHASES = Object.freeze([
  "BASE_APPLICABILITY", "CANONICAL_GRAPH_AND_DEPTH", "CALCULATIONS_AND_ATTRIBUTIONS", "QUALIFICATION",
  "DERIVED_REQUIREMENT_APPLICABILITY", "EVIDENCE_SUFFICIENCY", "INFORMATION_NEEDS", "RESOLUTION_PLANNING", "DECISION_SNAPSHOT",
]);
const EXPECTED_PHASE_ALGORITHMS_PREFIX = Object.freeze([
  "ubo-policy-readiness-v1",
  "ubo-graph-derived-context-v1",
  "ubo-calculations-and-attributions-v1",
  "ubo-person-qualification-assessment-v2",
  "ubo-derived-requirement-applicability-v1",
  "ubo-evidence-sufficiency-v1-compat",
]);

function same(a, b) { return canonicalizeJson(a) === canonicalizeJson(b); }
function predecessorReference(snapshot) {
  if (!snapshot) return null;
  if (snapshot.snapshotSchemaVersion === DECISION_SNAPSHOT_V2) verifyDecisionSnapshotV2(snapshot);
  else verifyDecisionSnapshot(snapshot);
  return { snapshotSchemaVersion: snapshot.snapshotSchemaVersion, snapshotId: snapshot.snapshotId, decisionContentHash: snapshot.decisionContentHash };
}
function policyIdentity(loaded) {
  validatePolicyPack(loaded.policyPack);
  const hash = hashPolicyPack(loaded.policyPack);
  if (loaded.identity.hash !== hash || loaded.identity.schemaVersion !== "1.3") fail("DecisionSnapshot v2 requires the exact loaded schema-1.3 policy identity");
  return { policyPackId: loaded.identity.policyPackId, policyVersion: loaded.identity.version, policyHash: hash, policySchemaVersion: loaded.identity.schemaVersion };
}
function manifestOf(artifacts) {
  return artifacts.map(({ output, ...entry }) => cloneData(entry));
}

function createDecisionSnapshotV2({ loadedPolicyPack, caseState, targetEntityId, checkpoint, checkpointReference, evaluationTime, readiness, algorithmManifest, phaseArtifacts, pinnedPlan, previousSnapshot = null, supersessionReason = null, decisionOutputs, recordingMetadata = {} }) {
  if (!Array.isArray(phaseArtifacts) || phaseArtifacts.length !== 8) fail("DecisionSnapshot v2 requires the first eight completed phases");
  if (!pinnedPlan?.planId || !pinnedPlan?.planHash || pinnedPlan.contractVersion !== "ubo-resolution-plan-v1-compat") fail("DecisionSnapshot v2 requires one pinned compatibility plan created before snapshot construction");
  const predecessor = predecessorReference(previousSnapshot);
  if (previousSnapshot && previousSnapshot.decisionContent.caseReference.caseId !== caseState.caseId) fail("DecisionSnapshot v2 predecessor belongs to another case");
  if (predecessor && !HISTORY_REASONS_V2.includes(supersessionReason)) fail("v2 successor requires an approved explicit supersession reason");
  if (!predecessor && supersessionReason !== null) fail("v2 genesis cannot carry a supersession reason");
  if (readiness.runtimeMode !== "LAB" || readiness.readiness !== "REVIEW_ONLY") fail("DecisionSnapshot v2 is restricted to review-only LAB evaluation");
  const identity = policyIdentity(loadedPolicyPack);
  const wave8 = decisionOutputs.requirementStageVersion === "ubo-requirement-resolution-v2";
  const pipelineMaturity = wave8 ? PIPELINE_MATURITY_WAVE_8 : PIPELINE_MATURITY_WAVE_7;
  const seed = {
    snapshotSchemaVersion: DECISION_SNAPSHOT_V2,
    snapshotAlgorithmVersion: DECISION_SNAPSHOT_CONSTRUCTION_V2,
    caseReference: { caseId: caseState.caseId, revisionId: caseState.revisionId, revision: caseState.revision },
    history: { previousSnapshot: predecessor, supersessionReason },
    checkpoint: { type: checkpoint, reference: cloneData(checkpointReference), evaluationTime },
    targetEntityId,
    policy: { identity, readiness: cloneData(readiness) },
    runtimeMode: "LAB",
    policyReadiness: readiness.readiness,
    governanceState: "REVIEW_ONLY",
    pipelineMaturity,
    productionAuthorized: false,
    registryCapabilityProfileRef: null,
    registryCapabilityProfileState: "NOT_PROVIDED",
    algorithmManifest: cloneData(algorithmManifest),
    versionDirection: { futureApplicationBoundary: "ubo-decision-application-v3", publicExposure: "DEFERRED_UNTIL_WAVES_8_AND_9" },
    phaseArtifacts: phaseArtifacts.map(cloneData),
    graphDerivedContext: cloneData(decisionOutputs.graphDerivedContext),
    effectiveInterestCalculations: cloneData(decisionOutputs.effectiveInterestCalculations),
    qualificationBasisRecords: cloneData(decisionOutputs.qualificationBasisRecords),
    companyAttributionAssessments: cloneData(decisionOutputs.companyAttributionAssessments),
    llpAttributionAssessments: cloneData(decisionOutputs.llpAttributionAssessments),
    layerClosureAssessments: cloneData(decisionOutputs.layerClosureAssessments),
    percentageEvidenceAssessments: cloneData(decisionOutputs.percentageEvidenceAssessments),
    personQualificationAssessments: cloneData(decisionOutputs.personQualificationAssessments),
    derivedRequirementApplicability: cloneData(decisionOutputs.derivedRequirementApplicability),
    evidenceSufficiency: cloneData(decisionOutputs.evidenceSufficiency),
    ...(wave8 ? {
      requirementStageVersion: decisionOutputs.requirementStageVersion,
      causalInformationNeedSetV2: cloneData(decisionOutputs.causalInformationNeedSetV2),
      informationNeedsV2: cloneData(decisionOutputs.informationNeedsV2),
      dependentDiagnostics: cloneData(decisionOutputs.dependentDiagnostics),
      plannerCompatibilityAdapter: cloneData(decisionOutputs.plannerCompatibilityAdapter),
      specialistRoutes: cloneData(decisionOutputs.specialistRoutes),
    } : {}),
    requirementResolutions: cloneData(decisionOutputs.requirementResolutions),
    informationNeedsV1Compatibility: cloneData(decisionOutputs.informationNeedsV1Compatibility),
    informationNeedHistoryV1Compatibility: cloneData(decisionOutputs.informationNeedHistoryV1Compatibility),
    resolutionOptionsV1Compatibility: cloneData(decisionOutputs.resolutionOptionsV1Compatibility),
    actionIntentsV1Compatibility: cloneData(decisionOutputs.actionIntentsV1Compatibility),
    policyGaps: cloneData(decisionOutputs.policyGaps),
    operationalBlockers: cloneData(decisionOutputs.operationalBlockers),
    reviewRequirements: cloneData(decisionOutputs.reviewRequirements),
    specialistStates: cloneData(decisionOutputs.specialistStates),
    pinnedResolutionPlan: cloneData(pinnedPlan),
    requiredSignoffIds: [...new Set(decisionOutputs.requiredSignoffIds || [])].sort(),
  };
  const phase9 = createPhaseArtifact({
    sequence: 9,
    phaseId: "DECISION_SNAPSHOT",
    algorithmVersion: DECISION_SNAPSHOT_CONSTRUCTION_V2,
    inputArtifacts: [
      ...phaseArtifacts.map(({ outputArtifactId, outputHash }) => ({ artifactId: outputArtifactId, artifactHash: outputHash })),
      { artifactId: pinnedPlan.planId, artifactHash: pinnedPlan.planHash },
    ],
    output: { snapshotConstructionInputHash: hashArtifact(seed), pinnedPlanId: pinnedPlan.planId, pinnedPlanHash: pinnedPlan.planHash },
    evaluationTime,
    requiredSignoffIds: seed.requiredSignoffIds,
    marker: pipelineMaturity,
  });
  const content = { ...seed, phaseArtifacts: [...seed.phaseArtifacts, cloneData(phase9)] };
  content.phaseManifest = manifestOf(content.phaseArtifacts);
  const decisionContentHash = hashArtifact(content);
  const snapshot = {
    snapshotSchemaVersion: DECISION_SNAPSHOT_V2,
    snapshotId: decisionContentHash,
    decisionContentHash,
    decisionContent: content,
    recordingMetadata: cloneData(recordingMetadata),
  };
  verifyDecisionSnapshotV2(snapshot, { previousSnapshot, loadedPolicyPack });
  return deepFreeze(cloneData(snapshot));
}

function verifyDecisionSnapshotV2(snapshot, { previousSnapshot = undefined, loadedPolicyPack = undefined } = {}) {
  if (!snapshot || snapshot.snapshotSchemaVersion !== DECISION_SNAPSHOT_V2 || snapshot.decisionContent?.snapshotSchemaVersion !== DECISION_SNAPSHOT_V2) fail("unsupported DecisionSnapshot v2 schema");
  const content = snapshot.decisionContent;
  if (content.snapshotAlgorithmVersion !== DECISION_SNAPSHOT_CONSTRUCTION_V2) fail("unsupported DecisionSnapshot v2 construction algorithm");
  if (snapshot.snapshotId !== snapshot.decisionContentHash || snapshot.decisionContentHash !== hashArtifact(content)) fail("DecisionSnapshot v2 canonical hash mismatch");
  const phase7Algorithm = content.phaseArtifacts?.[6]?.algorithmVersion;
  const wave8 = phase7Algorithm === "ubo-requirement-resolution-v2";
  const expectedMaturity = wave8 ? PIPELINE_MATURITY_WAVE_8 : PIPELINE_MATURITY_WAVE_7;
  if (!["ubo-requirement-resolution-v1-compat", "ubo-requirement-resolution-v2"].includes(phase7Algorithm)) fail("DecisionSnapshot v2 Phase 7 version is unsupported");
  if (content.runtimeMode !== "LAB" || content.policyReadiness !== "REVIEW_ONLY" || content.governanceState !== "REVIEW_ONLY" || content.productionAuthorized !== false || content.pipelineMaturity !== expectedMaturity) fail("DecisionSnapshot v2 governance invariant failed");
  if (content.registryCapabilityProfileRef !== null || content.registryCapabilityProfileState !== "NOT_PROVIDED") fail("DecisionSnapshot v2 fabricated a RegistryCapabilityProfile");
  if (!Array.isArray(content.phaseArtifacts) || content.phaseArtifacts.length !== EXPECTED_PHASES.length) fail("DecisionSnapshot v2 phase set is incomplete");
  content.phaseArtifacts.forEach((artifact, index) => {
    if (artifact.sequence !== index + 1 || artifact.phaseId !== EXPECTED_PHASES[index]) fail("DecisionSnapshot v2 phase order is invalid");
    const expectedAlgorithm = index < EXPECTED_PHASE_ALGORITHMS_PREFIX.length ? EXPECTED_PHASE_ALGORITHMS_PREFIX[index]
      : index === 6 ? phase7Algorithm
        : index === 7 ? "ubo-resolution-plan-v1-compat" : DECISION_SNAPSHOT_CONSTRUCTION_V2;
    if (artifact.algorithmVersion !== expectedAlgorithm) fail(`phase ${artifact.phaseId} algorithm version is invalid`);
    if (artifact.status !== "COMPLETE" || artifact.evaluationTime !== content.checkpoint.evaluationTime) fail(`phase ${artifact.phaseId} completion metadata is invalid`);
    const expectedOutputHash = hashArtifact(artifact.output);
    if (artifact.outputHash !== expectedOutputHash
      || artifact.outputArtifactId !== `${artifact.phaseId.toLowerCase()}:${expectedOutputHash.slice(7, 39)}`) fail(`phase ${artifact.phaseId} output identity/hash mismatch`);
    const previousById = new Map(content.phaseArtifacts.slice(0, index).map(({ outputArtifactId, outputHash }) => [outputArtifactId, outputHash]));
    artifact.inputArtifacts.forEach(({ artifactId, artifactHash }) => {
      if (artifactId.startsWith("resolution-plan")) return;
      if (index === 0) return;
      if (artifactId === content.pinnedResolutionPlan.planId) {
        if (artifactHash !== content.pinnedResolutionPlan.planHash) fail("phase references a mismatched pinned plan hash");
        return;
      }
      if (!previousById.has(artifactId) || previousById.get(artifactId) !== artifactHash) fail(`phase ${artifact.phaseId} references a future, unknown or mismatched phase artifact`);
    });
    if (index === 0 && artifact.inputArtifacts.length !== 0) fail("BASE_APPLICABILITY must not reference a phase artifact");
    if (index > 0 && index < 8) {
      const previous = content.phaseArtifacts[index - 1];
      if (artifact.inputArtifacts.length !== 1
        || artifact.inputArtifacts[0].artifactId !== previous.outputArtifactId
        || artifact.inputArtifacts[0].artifactHash !== previous.outputHash) fail(`phase ${artifact.phaseId} must consume the immediately preceding phase artifact`);
    }
  });
  const phase9Inputs = content.phaseArtifacts[8].inputArtifacts;
  const expectedPhase9Inputs = [
    ...content.phaseArtifacts.slice(0, 8).map(({ outputArtifactId, outputHash }) => ({ artifactId: outputArtifactId, artifactHash: outputHash })),
    { artifactId: content.pinnedResolutionPlan.planId, artifactHash: content.pinnedResolutionPlan.planHash },
  ];
  if (!same(phase9Inputs, expectedPhase9Inputs)) fail("DECISION_SNAPSHOT must reference every earlier phase and the exact pinned plan");
  if (!same(manifestOf(content.phaseArtifacts), content.phaseManifest)) fail("DecisionSnapshot v2 phase manifest does not match phase artifacts");
  if (content.pinnedResolutionPlan.planHash !== hashArtifact(Object.fromEntries(Object.entries(content.pinnedResolutionPlan).filter(([key]) => !["planId", "planHash"].includes(key))))) fail("DecisionSnapshot v2 pinned plan hash mismatch");
  const phase8 = content.phaseArtifacts[7].output;
  if (phase8.planId !== content.pinnedResolutionPlan.planId || phase8.planHash !== content.pinnedResolutionPlan.planHash) fail("DecisionSnapshot v2 plan is not the exact Phase 8 plan");
  const phase2 = content.phaseArtifacts[1].output;
  const phase3 = content.phaseArtifacts[2].output;
  const phase4 = content.phaseArtifacts[3].output;
  const phase5 = content.phaseArtifacts[4].output;
  const phase6 = content.phaseArtifacts[5].output;
  const phase7 = content.phaseArtifacts[6].output;
  if (!same(phase2.graphDerivedContext, content.graphDerivedContext)
    || !same(phase3.calculations, content.effectiveInterestCalculations)
    || !same(phase3.companyAssessments, content.companyAttributionAssessments)
    || !same(phase3.llpAssessments, content.llpAttributionAssessments)
    || !same(phase3.layerClosureAssessments, content.layerClosureAssessments)
    || !same(phase3.percentageEvidenceAssessments, content.percentageEvidenceAssessments)
    || !same(phase4.qualificationBasisRecords, content.qualificationBasisRecords)
    || !same(phase4.personQualificationAssessments, content.personQualificationAssessments)
    || !same(phase5, content.derivedRequirementApplicability)
    || !same(phase6.evidenceSufficiency, content.evidenceSufficiency)) fail("DecisionSnapshot v2 duplicated decision output does not match its producing phase");
  if (wave8) {
    const resolution = phase7.requirementResolution;
    if (content.requirementStageVersion !== "ubo-requirement-resolution-v2"
      || !same(resolution.informationNeedSet, content.causalInformationNeedSetV2)
      || !same(resolution.informationNeeds, content.informationNeedsV2)
      || !same(resolution.dependentDiagnostics, content.dependentDiagnostics)
      || !same(resolution.requirementResolutions, content.requirementResolutions)
      || !same(resolution.operationalBlockers, content.operationalBlockers)
      || !same(resolution.reviewRequirements, content.reviewRequirements)
      || !same(resolution.specialistRoutes, content.specialistRoutes)
      || !same(content.phaseArtifacts[7].output.adapter, content.plannerCompatibilityAdapter)) fail("DecisionSnapshot v2 Wave 8 outputs do not match their producing phases");
    content.informationNeedsV2.forEach((need, index) => validateInformationNeedV2(need, `decisionContent.informationNeedsV2[${index}]`));
    content.causalInformationNeedSetV2.history.forEach((need, index) => validateInformationNeedV2(need, `decisionContent.causalInformationNeedSetV2.history[${index}]`));
    const needIds = new Set(content.informationNeedsV2.map(({ needId }) => needId));
    if (!same(content.causalInformationNeedSetV2.currentNeeds, content.informationNeedsV2)) fail("DecisionSnapshot v2 causal need set does not match the recorded needs");
    const { needSetId, setHash, ...needSetSemantic } = content.causalInformationNeedSetV2;
    if (setHash !== hashArtifact(needSetSemantic) || needSetId !== `ubo-information-need-set-v2:${setHash.slice(7, 39)}`) fail("DecisionSnapshot v2 causal need set hash is invalid");
    content.dependentDiagnostics.forEach((diagnostic) => {
      if (!needIds.has(diagnostic.causalNeedId)) fail("DecisionSnapshot v2 diagnostic references an unknown causal need");
      const { diagnosticId, ...diagnosticSemantic } = diagnostic;
      if (diagnostic.contractVersion !== "ubo-need-dependent-diagnostic-v1" || diagnosticId !== `ubo-need-dependent-diagnostic-v1:${hashArtifact(diagnosticSemantic).slice(7, 39)}`) fail("DecisionSnapshot v2 diagnostic identity is invalid");
    });
    const { assessmentId, assessmentHash, ...resolutionSemantic } = resolution;
    if (assessmentHash !== hashArtifact(resolutionSemantic) || assessmentId !== `ubo-requirement-resolution-assessment-v2:${assessmentHash.slice(7, 39)}`) fail("DecisionSnapshot v2 RequirementResolution v2 hash is invalid");
    resolution.requirementResolutions.forEach((record) => {
      const { requirementResolutionId, ...recordSemantic } = record;
      if (record.contractVersion !== "ubo-requirement-resolution-assessment-v2" || requirementResolutionId !== `ubo-requirement-resolution-assessment-v2:${hashArtifact(recordSemantic).slice(7, 39)}`) fail("DecisionSnapshot v2 requirement assessment identity is invalid");
    });
    const adapter = content.plannerCompatibilityAdapter;
    const { adapterId, adapterHash, ...adapterSemantic } = adapter;
    if (adapterHash !== hashArtifact(adapterSemantic) || adapterId !== `ubo-information-needs-v2-to-plan-v1-compat:${adapterHash.slice(7, 39)}`) fail("DecisionSnapshot v2 planner adapter hash is invalid");
    const openNeedIds = content.informationNeedsV2.filter(({ status }) => status === "OPEN").map(({ needId }) => needId).sort();
    if (!same(adapter.openCausalNeedIds, openNeedIds)
      || !same(adapter.decisionState.informationNeeds.map(({ needId }) => needId).sort(), openNeedIds)
      || adapter.sourceRequirementResolutionId !== resolution.assessmentId
      || adapter.sourceRequirementResolutionHash !== resolution.assessmentHash) fail("DecisionSnapshot v2 planner adapter does not match the causal need set");
  } else if (!same(phase7.orchestration.requirementResolutions, content.requirementResolutions)) fail("DecisionSnapshot v2 duplicated Wave 7 requirement output does not match its producing phase");
  const readinessIdentity = content.policy.readiness.policyIdentity;
  if (!same(content.policy.identity, {
    policyPackId: readinessIdentity.policyPackId,
    policyVersion: readinessIdentity.version,
    policyHash: readinessIdentity.hash,
    policySchemaVersion: readinessIdentity.schemaVersion,
  })) fail("DecisionSnapshot v2 policy pin does not match readiness output");
  const expectedAlgorithms = {
    graph: "ubo-graph-v1",
    personQualification: "ubo-person-qualification-assessment-v2", derivedRequirementApplicability: "ubo-derived-requirement-applicability-v1",
    requirementResolution: phase7Algorithm, resolutionPlan: "ubo-resolution-plan-v1-compat",
    phasedEvaluation: "ubo-phased-evaluation-v1", snapshotConstruction: DECISION_SNAPSHOT_CONSTRUCTION_V2,
  };
  if (content.effectiveInterestCalculations.length > 0) Object.assign(expectedAlgorithms, { percentageLookthrough: "ubo-percentage-lookthrough-v1", effectiveInterestQualification: "ubo-effective-interest-qualification-v2" });
  if (content.companyAttributionAssessments.length > 0) expectedAlgorithms.companyAttribution = "ubo-psc-attribution-v1";
  if (content.llpAttributionAssessments.length > 0) Object.assign(expectedAlgorithms, { llpAttribution: "ubo-llp-psc-attribution-v1", llpWorkingAssumption: "A-06-WA-01" });
  if (content.layerClosureAssessments.length > 0) Object.assign(expectedAlgorithms, { layerClosure: "ubo-layer-closure-v1", percentagePrecision: "ubo-percentage-precision-v1" });
  if (content.percentageEvidenceAssessments.length > 0) expectedAlgorithms.percentageEvidence = "ubo-percentage-evidence-v1";
  if (wave8) Object.assign(expectedAlgorithms, { informationNeed: "ubo-information-need-v2", dependentDiagnostic: "ubo-need-dependent-diagnostic-v1", plannerCompatibilityAdapter: "ubo-information-needs-v2-to-plan-v1-compat" });
  Object.entries(expectedAlgorithms).forEach(([key, value]) => { if (content.algorithmManifest[key] !== value) fail(`DecisionSnapshot v2 algorithm pin ${key} is invalid`); });
  const { phaseManifest, phaseArtifacts, ...seedRest } = content;
  const seed = { ...seedRest, phaseArtifacts: phaseArtifacts.slice(0, 8) };
  if (content.phaseArtifacts[8].output.snapshotConstructionInputHash !== hashArtifact(seed)) fail("DecisionSnapshot v2 construction input hash mismatch");
  const predecessor = content.history.previousSnapshot;
  if (predecessor && !HISTORY_REASONS_V2.includes(content.history.supersessionReason)) fail("DecisionSnapshot v2 predecessor lacks an approved reason");
  if (previousSnapshot !== undefined) {
    const expected = predecessorReference(previousSnapshot);
    if (!same(expected, predecessor)) fail("DecisionSnapshot v2 predecessor linkage is invalid");
  }
  if (loadedPolicyPack !== undefined && !same(policyIdentity(loadedPolicyPack), content.policy.identity)) fail("DecisionSnapshot v2 policy identity mismatch");
  return true;
}

function reconstructDecisionStateV2(snapshot) {
  verifyDecisionSnapshotV2(snapshot);
  return deepFreeze(cloneData({
    reconstructionAlgorithm: DECISION_RECONSTRUCTION_V2,
    snapshotReference: { snapshotId: snapshot.snapshotId, decisionContentHash: snapshot.decisionContentHash },
    recordedDecision: snapshot.decisionContent,
  }));
}

module.exports = { DECISION_RECONSTRUCTION_V2, DECISION_SNAPSHOT_CONSTRUCTION_V2, DECISION_SNAPSHOT_V2, HISTORY_REASONS_V2, PIPELINE_MATURITY, PIPELINE_MATURITY_WAVE_7, PIPELINE_MATURITY_WAVE_8, createDecisionSnapshotV2, reconstructDecisionStateV2, verifyDecisionSnapshotV2 };
