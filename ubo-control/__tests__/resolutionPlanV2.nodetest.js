"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const policy = require("../policies/uk-corporate/1.6-rc/policy.json");
const { loadPolicyPack } = require("../policy/policyPack");
const { hashArtifact } = require("../internal/phasedArtifact");
const {
  CAPABILITY_STATE,
  ENTITLEMENT_STATE,
  OUTPUT_CHARACTERISTIC,
  PROFILE_FRESHNESS_STATE,
  createRegistryCapabilityProfileV1,
  evaluateProfileFreshness,
  matchRegistryCapabilityEntry,
} = require("../planning/registryCapabilityProfileV1");
const {
  ACTION_TYPE,
  ACQUISITION_STRATEGY,
  CONTENT_READINESS,
  PLAN_STATE,
  buildResolutionOptionsV2,
  planUboResolutionV2,
  validateResolutionPlanV2,
} = require("../planning/resolutionPlanV2");

const NOW = "2026-09-06T10:00:00.000Z";
const loaded = loadPolicyPack(policy);
const AFFECTED = Object.freeze({ qualificationRouteIds: [], calculationIds: [], pathIds: [], relationshipIds: [], personIds: [], requirementIds: [], closureAssessmentIds: [], evidenceAssessmentIds: [], attributionAssessmentIds: [] });

function need(id, overrides = {}) {
  const concept = overrides.concept || "CURRENT_OWNERSHIP_AND_CONTROL";
  const entityId = overrides.entityId || id;
  return {
    contractVersion: "ubo-information-need-v2",
    needId: id,
    status: overrides.status || "OPEN",
    targetKind: overrides.targetKind || "FRONTIER_ENTITY",
    targetReference: overrides.targetReference || { entityId },
    frontierEntityId: overrides.frontierEntityId === undefined ? entityId : overrides.frontierEntityId,
    concept,
    dimension: overrides.dimension || "ECONOMIC",
    requiredFact: overrides.requiredFact || { type: "CURRENT_UPSTREAM_HOLDER_SET" },
    requiredByRequirementIds: overrides.requirementIds || ["UBO-R01", "UBO-R03"],
    affected: { ...AFFECTED, ...(overrides.affected || {}) },
    permittedResolutionStrategyReferences: overrides.strategies || [
      { requirementId: "UBO-R01", strategyIndex: 0, strategy: "DISCOVERY", contentStatus: "NOT_REQUIRED", eligibleForPlanning: true, requiredSignoffIds: [] },
      { requirementId: "UBO-R03", strategyIndex: 2, strategy: "CUSTOMER_DOCUMENT", contentStatus: "NOT_REQUIRED", eligibleForPlanning: true, requiredSignoffIds: [] },
    ],
    contentReadinessStatus: overrides.contentReadinessStatus || "POLICY_CONTENT_AVAILABLE",
    requiredSignoffIds: overrides.requiredSignoffIds || [],
  };
}
function entry(overrides = {}) {
  return {
    jurisdiction: "GB",
    entityProfile: "COMPANY",
    informationConcept: "OWNERSHIP_STRUCTURE_EVIDENCE",
    relationshipDimension: "ECONOMIC",
    relationshipBasis: "ANY",
    acquisitionChannel: "REGISTRY_DISCOVERY",
    entitlementContext: "UK_REVIEW",
    capabilityState: CAPABILITY_STATE.SUPPORTED,
    entitlementState: ENTITLEMENT_STATE.ENTITLED,
    outputCharacteristics: [OUTPUT_CHARACTERISTIC.POSITIVE_ASSERTIONS_ONLY],
    sourceDecisionReferences: ["ASDA_REVIEW_PROFILE"],
    ...overrides,
  };
}
function profile(entries = [entry()], overrides = {}) {
  return createRegistryCapabilityProfileV1({
    profileId: "asda-review-profile",
    profileVersion: "1",
    assertedByReference: "CONTROL_ROOM_TEST_PROFILE",
    effectivePeriod: { from: "2026-01-01T00:00:00.000Z", to: "2026-12-31T23:59:59.999Z" },
    lastReviewedDate: "2026-09-01T00:00:00.000Z",
    reviewByDate: "2026-12-31T23:59:59.999Z",
    entitlementContext: { contextId: "UK_REVIEW", state: ENTITLEMENT_STATE.ENTITLED },
    supportedScopes: [{ jurisdiction: "GB", entityProfile: "COMPANY" }],
    capabilityEntries: entries,
    sourceDecisionReferences: ["A-15"],
    ...overrides,
  });
}
function option(actionType, ids, overrides = {}) {
  return {
    resolutionStrategy: overrides.resolutionStrategy || actionType,
    semanticActionType: actionType,
    informationNeedIds: ids,
    requirementIds: overrides.requirementIds || ["UBO-R01", "UBO-R03"],
    acquisitionChannel: overrides.acquisitionChannel || (actionType === ACTION_TYPE.DISCOVER_INFORMATION ? "REGISTRY_DISCOVERY" : "CUSTOMER_EVIDENCE"),
    capabilityQuery: overrides.capabilityQuery || { jurisdiction: "GB", entityProfile: "COMPANY", informationConcept: "OWNERSHIP_STRUCTURE_EVIDENCE", relationshipDimension: "ECONOMIC", relationshipBasis: "ANY", acquisitionChannel: actionType === ACTION_TYPE.DISCOVER_INFORMATION ? "REGISTRY_DISCOVERY" : "CUSTOMER_EVIDENCE", entitlementContext: "UK_REVIEW" },
    evidenceCategories: overrides.evidenceCategories || [],
    contentReadiness: overrides.contentReadiness || (actionType === ACTION_TYPE.DISCOVER_INFORMATION ? CONTENT_READINESS.NOT_REQUIRED : CONTENT_READINESS.READY),
    currentlyAvailable: overrides.currentlyAvailable !== false,
    causalGroupingKey: overrides.causalGroupingKey || ids.join("+"),
    coverageBasis: overrides.coverageBasis || (ids.length > 1 ? "COHERENT_EVIDENCE_PACKAGE" : "SINGLE_CAUSAL_NEED"),
    expectedCandidateFacts: [{ type: "OWNERSHIP_STRUCTURE" }],
    retryPermitted: overrides.retryPermitted !== false,
  };
}
function plannerInput(needs, overrides = {}) {
  const { dependentDiagnostics = [], ...inputOverrides } = overrides;
  const setSemantic = { contractVersion: "ubo-information-need-set-v2", caseReference: { caseId: "case-1", revisionId: "revision-1", revision: 1 }, currentNeeds: needs, history: needs };
  const setHash = hashArtifact(setSemantic);
  const informationNeedSet = { ...setSemantic, needSetId: `ubo-information-need-set-v2:${setHash.slice(7, 39)}`, setHash };
  const assessmentSemantic = { informationNeeds: needs, dependentDiagnostics };
  const assessmentHash = hashArtifact(assessmentSemantic);
  return {
    policyPack: loaded,
    requirementResolution: { ...assessmentSemantic, assessmentId: `ubo-requirement-resolution-assessment-v2:${assessmentHash.slice(7, 39)}`, assessmentHash },
    informationNeedSet,
    operationalBlockers: [], reviewRequirements: [], specialistRoutes: [], resolutionAttempts: [],
    evaluationTime: NOW,
    caseRevision: { caseId: "case-1", revisionId: "revision-1", revision: 1 },
    graphFingerprint: "sha256:" + "a".repeat(64),
    defaultCapabilityScope: { jurisdiction: "GB", entityProfile: "COMPANY", entitlementContext: "UK_REVIEW" },
    ...inputOverrides,
  };
}

test("RegistryCapabilityProfile v1 is immutable, deterministic, serializable and display metadata is non-semantic", () => {
  const first = profile([entry({ displayMetadata: { providerLabel: "Review source A" } })], { displayMetadata: { label: "A" } });
  const second = profile([entry({ displayMetadata: { providerLabel: "Review source B" } })], { displayMetadata: { label: "B" } });
  assert.equal(first.profileHash, second.profileHash);
  assert.equal(Object.isFrozen(first.capabilityEntries[0]), true);
  assert.deepEqual(createRegistryCapabilityProfileV1(JSON.parse(JSON.stringify(first))), first);
  const changed = profile([entry({ capabilityState: CAPABILITY_STATE.PARTIAL })]);
  assert.notEqual(changed.profileHash, first.profileHash);
});

test("profile matching is exact, deterministic by specificity, freshness-aware and ambiguity rejecting", () => {
  const reviewProfile = profile([
    entry({ jurisdiction: "ANY", entityProfile: "ANY", informationConcept: "ANY", relationshipDimension: "ANY", entitlementContext: "ANY", outputCharacteristics: [OUTPUT_CHARACTERISTIC.UNKNOWN] }),
    entry(),
  ]);
  const match = matchRegistryCapabilityEntry(reviewProfile, { jurisdiction: "GB", entityProfile: "COMPANY", informationConcept: "OWNERSHIP_STRUCTURE_EVIDENCE", relationshipDimension: "ECONOMIC", relationshipBasis: "ANY", acquisitionChannel: "REGISTRY_DISCOVERY", entitlementContext: "UK_REVIEW" }, NOW);
  assert.equal(match.entry.capabilityState, CAPABILITY_STATE.SUPPORTED);
  assert.equal(match.freshnessState, PROFILE_FRESHNESS_STATE.CURRENT);
  assert.equal(evaluateProfileFreshness(profile([entry()], { effectivePeriod: { from: "2027-01-01T00:00:00.000Z", to: "2027-12-31T00:00:00.000Z" }, reviewByDate: "2027-12-31T00:00:00.000Z" }), NOW), PROFILE_FRESHNESS_STATE.NOT_YET_EFFECTIVE);
  assert.equal(evaluateProfileFreshness(profile([entry()], { reviewByDate: "2026-09-05T00:00:00.000Z" }), NOW), PROFILE_FRESHNESS_STATE.STALE);
  assert.equal(matchRegistryCapabilityEntry(reviewProfile, { ...match.query, jurisdiction: "US" }, NOW).matchState, "NO_MATCH");
  const ambiguous = profile([entry({ capabilityState: CAPABILITY_STATE.SUPPORTED }), entry({ capabilityState: CAPABILITY_STATE.PARTIAL })]);
  assert.throws(() => matchRegistryCapabilityEntry(ambiguous, match.query, NOW), /ambiguous/);
});

test("all capability and entitlement states remain planning context and secrets are rejected", () => {
  Object.values(CAPABILITY_STATE).forEach((capabilityState) => assert.equal(profile([entry({ capabilityState })]).capabilityEntries[0].capabilityState, capabilityState));
  Object.values(ENTITLEMENT_STATE).forEach((entitlementState) => assert.equal(profile([entry({ entitlementState })], { entitlementContext: { contextId: "UK_REVIEW", state: entitlementState } }).capabilityEntries[0].entitlementState, entitlementState));
  assert.throws(() => profile([entry()], { displayMetadata: { apiKey: "forbidden" } }), /credentials|secrets/);
  const sourceNeed = need("need-a");
  const reviewProfile = profile();
  assert.equal(sourceNeed.status, "OPEN");
  assert.equal(Object.prototype.hasOwnProperty.call(reviewProfile, "facts"), false);
});

test("supported/entitled and partial capability select system-first Discovery-led planning", () => {
  for (const capabilityState of [CAPABILITY_STATE.SUPPORTED, CAPABILITY_STATE.PARTIAL]) {
    const n = need(`need-${capabilityState}`);
    const plan = planUboResolutionV2(plannerInput([n], { registryCapabilityProfile: profile([entry({ capabilityState })]), resolutionOptions: [option(ACTION_TYPE.DISCOVER_INFORMATION, [n.needId]), option(ACTION_TYPE.REQUEST_STRUCTURE_EVIDENCE, [n.needId])] }));
    assert.equal(plan.state, PLAN_STATE.SYSTEM_RESOLUTION);
    assert.equal(plan.strategyAssignments[0].strategy, ACQUISITION_STRATEGY.DISCOVERY_LED);
    assert.equal(plan.recommendedActions[0].semanticActionType, ACTION_TYPE.DISCOVER_INFORMATION);
    assert.equal(plan.recommendedActions.some(({ actor }) => actor === "CUSTOMER"), false);
    assert.ok(plan.requiredSignoffs.includes("A-15"));
    if (capabilityState === CAPABILITY_STATE.PARTIAL) assert.ok(plan.rationaleCodes.includes("CAPABILITY_PREDICTS_PARTIAL_COVERAGE"));
    assert.equal(validateResolutionPlanV2(JSON.parse(JSON.stringify(plan))), true);
  }
});

test("profile-level NOT_ENTITLED prevents a supported entry from being selected", () => {
  const n = need("need-profile-entitlement");
  const reviewProfile = profile([entry()], { entitlementContext: { contextId: "UK_REVIEW", state: ENTITLEMENT_STATE.NOT_ENTITLED } });
  const plan = planUboResolutionV2(plannerInput([n], { registryCapabilityProfile: reviewProfile, resolutionOptions: [option(ACTION_TYPE.DISCOVER_INFORMATION, [n.needId]), option(ACTION_TYPE.REQUEST_STRUCTURE_EVIDENCE, [n.needId])] }));
  assert.equal(plan.state, PLAN_STATE.CUSTOMER_RESOLUTION);
  assert.equal(plan.recommendedActions[0].semanticActionType, ACTION_TYPE.REQUEST_STRUCTURE_EVIDENCE);
  assert.ok(plan.rationaleCodes.includes("ENTITLEMENT_UNAVAILABLE"));
});

test("known range-only coverage pivots an exact-percentage need without treating PARTIAL generally as useless", () => {
  const n = need("need-exact-percentage", { concept: "RELATIONSHIP_PERCENTAGE" });
  const reviewProfile = profile([entry({ informationConcept: "EXACT_ECONOMIC_PERCENTAGE", capabilityState: CAPABILITY_STATE.PARTIAL, outputCharacteristics: [OUTPUT_CHARACTERISTIC.RANGE_ONLY] })]);
  const discovery = option(ACTION_TYPE.DISCOVER_INFORMATION, [n.needId], { capabilityQuery: { jurisdiction: "GB", entityProfile: "COMPANY", informationConcept: "EXACT_ECONOMIC_PERCENTAGE", relationshipDimension: "ECONOMIC", relationshipBasis: "ANY", acquisitionChannel: "REGISTRY_DISCOVERY", entitlementContext: "UK_REVIEW" } });
  const plan = planUboResolutionV2(plannerInput([n], { registryCapabilityProfile: reviewProfile, resolutionOptions: [discovery, option(ACTION_TYPE.REQUEST_STRUCTURE_EVIDENCE, [n.needId])] }));
  assert.equal(plan.state, PLAN_STATE.CUSTOMER_RESOLUTION);
  assert.equal(plan.strategyAssignments[0].strategy, ACQUISITION_STRATEGY.CHART_ASSISTED);
  assert.ok(plan.rationaleCodes.includes("CAPABILITY_INSUFFICIENT_FOR_REQUIRED_PRECISION"));
});

test("unsupported or restricted capability pivots one coherent structural group to chart-assisted", () => {
  for (const capability of [entry({ capabilityState: CAPABILITY_STATE.UNSUPPORTED }), entry({ capabilityState: CAPABILITY_STATE.RESTRICTED, entitlementState: ENTITLEMENT_STATE.NOT_ENTITLED })]) {
    const needs = [need("need-r01"), need("need-r03", { concept: "LLP_GOVERNANCE_CONTROL_BASIS", dimension: "CONTROL" })];
    const plan = planUboResolutionV2(plannerInput(needs, { registryCapabilityProfile: profile([capability]), resolutionOptions: [option(ACTION_TYPE.DISCOVER_INFORMATION, needs.map(({ needId }) => needId), { coverageBasis: "COHERENT_EVIDENCE_PACKAGE" }), option(ACTION_TYPE.REQUEST_STRUCTURE_EVIDENCE, needs.map(({ needId }) => needId), { evidenceCategories: ["governance_agreement"], coverageBasis: "COHERENT_EVIDENCE_PACKAGE" })] }));
    assert.equal(plan.state, PLAN_STATE.CUSTOMER_RESOLUTION);
    assert.equal(plan.resolutionGroups.length, 1);
    assert.equal(plan.strategyAssignments[0].strategy, ACQUISITION_STRATEGY.CHART_ASSISTED);
    assert.equal(plan.recommendedActions.length, 1);
    assert.deepEqual(plan.recommendedActions[0].coveredInformationNeedIds, ["need-r01", "need-r03"]);
    assert.equal(plan.recommendedActions[0].receiptDoesNotResolveNeed, true);
  }
});

test("UNKNOWN capability and graph shape alone do not assert opacity", () => {
  const n = need("need-unknown");
  const plan = planUboResolutionV2(plannerInput([n], { graphFingerprint: "deep-cross-border-graph", registryCapabilityProfile: profile([entry({ capabilityState: CAPABILITY_STATE.UNKNOWN, entitlementState: ENTITLEMENT_STATE.UNKNOWN })]), resolutionOptions: [option(ACTION_TYPE.DISCOVER_INFORMATION, [n.needId], { currentlyAvailable: false }), option(ACTION_TYPE.REQUEST_STRUCTURE_EVIDENCE, [n.needId])] }));
  assert.equal(plan.rationaleCodes.includes("CAPABILITY_PREDICTS_OPACITY"), false);
  assert.equal(plan.state, PLAN_STATE.CUSTOMER_RESOLUTION);
});

test("substantive outcomes suppress unchanged Discovery while operational outcomes retry or hold", () => {
  const n = need("need-attempt");
  const base = plannerInput([n], { registryCapabilityProfile: profile(), resolutionOptions: [option(ACTION_TYPE.DISCOVER_INFORMATION, [n.needId]), option(ACTION_TYPE.REQUEST_STRUCTURE_EVIDENCE, [n.needId])] });
  const first = planUboResolutionV2(base);
  for (const outcome of ["NO_DATA", "UNSUPPORTED", "INCONCLUSIVE"]) {
    const plan = planUboResolutionV2({ ...base, resolutionAttempts: [{ informationNeedIds: [n.needId], semanticActionType: ACTION_TYPE.DISCOVER_INFORMATION, capabilityOutcomeState: outcome, final: outcome === "INCONCLUSIVE", materialInputFingerprint: first.materialInputFingerprint }] });
    assert.equal(plan.state, PLAN_STATE.CUSTOMER_RESOLUTION);
    assert.equal(plan.recommendedActions[0].semanticActionType, ACTION_TYPE.REQUEST_STRUCTURE_EVIDENCE);
  }
  const nonFinal = planUboResolutionV2({ ...base, resolutionAttempts: [{ informationNeedIds: [n.needId], semanticActionType: ACTION_TYPE.DISCOVER_INFORMATION, capabilityOutcomeState: "INCONCLUSIVE", final: false, materialInputFingerprint: first.materialInputFingerprint }] });
  assert.equal(nonFinal.state, PLAN_STATE.SYSTEM_RESOLUTION);
  const unavailable = planUboResolutionV2({ ...base, resolutionAttempts: [{ informationNeedIds: [n.needId], semanticActionType: ACTION_TYPE.DISCOVER_INFORMATION, capabilityOutcomeState: "UNAVAILABLE", materialInputFingerprint: first.materialInputFingerprint }] });
  assert.equal(unavailable.state, PLAN_STATE.SYSTEM_RESOLUTION);
  assert.equal(unavailable.recommendedActions[0].semanticActionType, ACTION_TYPE.RETRY_CAPABILITY);
  const failed = planUboResolutionV2({ ...base, resolutionAttempts: [{ informationNeedIds: [n.needId], semanticActionType: ACTION_TYPE.DISCOVER_INFORMATION, capabilityOutcomeState: "FAILED", materialInputFingerprint: first.materialInputFingerprint }] });
  assert.equal(failed.state, PLAN_STATE.BLOCKED);
  assert.equal(failed.customerBundles.length, 0);
  assert.equal(failed.systemActions[0].semanticActionType, ACTION_TYPE.HOLD_FOR_OPERATIONAL_RECOVERY);
});

test("material changes permit retry, display-only changes do not, and equivalent input is stable", () => {
  const n = need("need-stable");
  const base = plannerInput([n], { registryCapabilityProfile: profile(), resolutionOptions: [option(ACTION_TYPE.DISCOVER_INFORMATION, [n.needId])] });
  const first = planUboResolutionV2(base);
  const same = planUboResolutionV2({ ...base, resolutionOptions: [...base.resolutionOptions].reverse() });
  assert.equal(first.planId, same.planId);
  assert.equal(first.currentPlanningWave.waveId, same.currentPlanningWave.waveId);
  const displayed = planUboResolutionV2({ ...base, resolutionOptions: base.resolutionOptions.map((item) => ({ ...item, displayMetadata: { label: "changed" } })) });
  assert.equal(displayed.materialInputFingerprint, first.materialInputFingerprint);
  const changedProfile = profile([entry({ outputCharacteristics: [OUTPUT_CHARACTERISTIC.RANGE_ONLY] })], { profileVersion: "2" });
  const retried = planUboResolutionV2({ ...base, registryCapabilityProfile: changedProfile, resolutionAttempts: [{ informationNeedIds: [n.needId], semanticActionType: ACTION_TYPE.DISCOVER_INFORMATION, capabilityOutcomeState: "NO_DATA", materialInputFingerprint: first.materialInputFingerprint }] });
  assert.equal(retried.state, PLAN_STATE.SYSTEM_RESOLUTION);
  assert.ok(retried.rationaleCodes.includes("MATERIAL_CHANGE_PERMITS_RETRY"));
});

test("mixed groups retain separate strategy classes and dependent diagnostics never create work", () => {
  const structural = need("need-structural");
  const identity = need("need-identity", { concept: "QUALIFYING_PERSON_ATTRIBUTES", targetKind: "PERSON_ATTRIBUTE_SET", targetReference: { personEntityId: "alice", attributeCodes: ["date_of_birth", "residence"] }, frontierEntityId: null, dimension: undefined, requirementIds: ["UBO-R07"], strategies: [] });
  const plan = planUboResolutionV2(plannerInput([structural, identity], { dependentDiagnostics: [{ diagnosticId: "diagnostic-1" }], registryCapabilityProfile: profile(), resolutionOptions: [option(ACTION_TYPE.DISCOVER_INFORMATION, [structural.needId]), option(ACTION_TYPE.REQUEST_STRUCTURED_INFORMATION, [identity.needId], { requirementIds: ["UBO-R07"], acquisitionChannel: "CUSTOMER_INFORMATION", capabilityQuery: { jurisdiction: "GB", entityProfile: "NATURAL_PERSON", informationConcept: "ENTITY_IDENTITY", relationshipDimension: "ANY", relationshipBasis: "ANY", acquisitionChannel: "CUSTOMER_INFORMATION", entitlementContext: "UK_REVIEW" } })] }));
  assert.equal(plan.resolutionGroups.length, 2);
  assert.deepEqual(new Set(plan.strategyAssignments.map(({ strategy }) => strategy)), new Set([ACQUISITION_STRATEGY.DISCOVERY_LED, ACQUISITION_STRATEGY.NOT_APPLICABLE]));
  assert.equal(plan.summary.dependentDiagnosticsIgnoredAsActions, 1);
  assert.equal(plan.recommendedActions.length, 1);
});

test("all plan states are distinct and open work without an executable route is BLOCKED", () => {
  const open = need("need-state", { strategies: [] });
  assert.equal(planUboResolutionV2(plannerInput([], { resolutionOptions: [] })).state, PLAN_STATE.COMPLETE);
  assert.equal(planUboResolutionV2(plannerInput([open], { resolutionOptions: [] })).state, PLAN_STATE.BLOCKED);
  assert.equal(planUboResolutionV2(plannerInput([open], { resolutionOptions: [option(ACTION_TYPE.REQUEST_STRUCTURED_INFORMATION, [open.needId])] })).state, PLAN_STATE.CUSTOMER_RESOLUTION);
  assert.equal(planUboResolutionV2(plannerInput([open], { resolutionOptions: [], reviewRequirements: [{ reviewRequirementId: "review-1", relatedInformationNeedIds: [open.needId], requirementIds: ["UBO-R06"] }] })).state, PLAN_STATE.INTERNAL_REVIEW);
  assert.equal(planUboResolutionV2(plannerInput([open], { resolutionOptions: [], specialistRoutes: [{ specialistRouteId: "specialist-1", relatedInformationNeedIds: [open.needId], requirementIds: ["UBO-R11"], entityIds: ["need-state"] }] })).state, PLAN_STATE.SPECIALIST_REVIEW);
  assert.equal(planUboResolutionV2(plannerInput([open], { resolutionOptions: [option(ACTION_TYPE.DISCOVER_INFORMATION, [open.needId])] })).state, PLAN_STATE.SYSTEM_RESOLUTION);
  const reviewOnly = planUboResolutionV2(plannerInput([open], { resolutionOptions: [], reviewRequirements: [{ reviewRequirementId: "review-2", relatedInformationNeedIds: [open.needId], requirementIds: ["UBO-R06"] }] }));
  assert.notEqual(reviewOnly.state, PLAN_STATE.COMPLETE);
  assert.equal(JSON.stringify(reviewOnly).includes("CUSTOMER_INPUT_COMPLETE"), false);
});

test("predecessor pinning is deterministic and stale/cross-case predecessors fail", () => {
  const n = need("need-predecessor");
  const base = plannerInput([n], { resolutionOptions: [option(ACTION_TYPE.DISCOVER_INFORMATION, [n.needId])] });
  const first = planUboResolutionV2(base);
  const successor = planUboResolutionV2({ ...base, predecessorResolutionPlan: first });
  assert.equal(successor.predecessorPlan.planId, first.planId);
  assert.notEqual(successor.planHash, first.planHash);
  const staleInput = plannerInput([n], { caseRevision: { caseId: "other", revisionId: "revision-1", revision: 1 }, predecessorResolutionPlan: first, resolutionOptions: [option(ACTION_TYPE.DISCOVER_INFORMATION, [n.needId])] });
  assert.throws(() => planUboResolutionV2(staleInput), /stale|another case/);
});

test("Discovery and an already-held artifact may share one system wave, while another system route survives failure", () => {
  const n = need("need-multi-system");
  const discovery = option(ACTION_TYPE.DISCOVER_INFORMATION, [n.needId]);
  const held = option(ACTION_TYPE.EXTRACT_EXISTING_ARTIFACT, [n.needId], { resolutionStrategy: "EXISTING_EVIDENCE", acquisitionChannel: "HELD_ARTIFACT", capabilityQuery: { jurisdiction: "GB", entityProfile: "COMPANY", informationConcept: "OWNERSHIP_STRUCTURE_EVIDENCE", relationshipDimension: "ECONOMIC", relationshipBasis: "ANY", acquisitionChannel: "HELD_ARTIFACT", entitlementContext: "UK_REVIEW" } });
  const base = plannerInput([n], { registryCapabilityProfile: profile(), resolutionOptions: [discovery, held] });
  const first = planUboResolutionV2(base);
  assert.deepEqual(new Set(first.recommendedActions.map(({ semanticActionType }) => semanticActionType)), new Set([ACTION_TYPE.DISCOVER_INFORMATION, ACTION_TYPE.EXTRACT_EXISTING_ARTIFACT]));
  const afterFailure = planUboResolutionV2({ ...base, resolutionAttempts: [{ informationNeedIds: [n.needId], semanticActionType: ACTION_TYPE.DISCOVER_INFORMATION, capabilityOutcomeState: "FAILED", materialInputFingerprint: first.materialInputFingerprint }] });
  assert.equal(afterFailure.state, PLAN_STATE.SYSTEM_RESOLUTION);
  assert.deepEqual(afterFailure.recommendedActions.map(({ semanticActionType }) => semanticActionType), [ACTION_TYPE.EXTRACT_EXISTING_ARTIFACT]);
  assert.equal(afterFailure.customerBundles.length, 0);
});

test("PARTIAL attempts create only residual planning", () => {
  const needs = [need("need-complete-part"), need("need-residual-part")];
  const shared = option(ACTION_TYPE.DISCOVER_INFORMATION, needs.map(({ needId }) => needId), { coverageBasis: "COHERENT_EVIDENCE_PACKAGE" });
  const base = plannerInput(needs, { registryCapabilityProfile: profile(), resolutionOptions: [shared] });
  const first = planUboResolutionV2(base);
  const residual = planUboResolutionV2({ ...base, resolutionAttempts: [{ informationNeedIds: needs.map(({ needId }) => needId), semanticActionType: ACTION_TYPE.DISCOVER_INFORMATION, capabilityOutcomeState: "PARTIAL", residualInformationNeedIds: ["need-residual-part"], materialInputFingerprint: first.materialInputFingerprint }] });
  assert.equal(residual.recommendedActions.length, 1);
  assert.deepEqual(residual.recommendedActions[0].coveredInformationNeedIds, ["need-residual-part"]);
});

test("stale profiles cannot drive predictive skipping and profile absence remains truthful", () => {
  const n = need("need-profile-state");
  const stale = profile([entry({ capabilityState: CAPABILITY_STATE.UNSUPPORTED })], { reviewByDate: "2026-09-05T00:00:00.000Z" });
  const stalePlan = planUboResolutionV2(plannerInput([n], { registryCapabilityProfile: stale, resolutionOptions: [option(ACTION_TYPE.DISCOVER_INFORMATION, [n.needId])] }));
  assert.equal(stalePlan.state, PLAN_STATE.SYSTEM_RESOLUTION);
  assert.equal(stalePlan.registryCapabilityProfileRef.state, PROFILE_FRESHNESS_STATE.STALE);
  assert.ok(stalePlan.rationaleCodes.includes("PROFILE_STALE"));
  const absent = planUboResolutionV2(plannerInput([n], { resolutionOptions: [option(ACTION_TYPE.DISCOVER_INFORMATION, [n.needId])] }));
  assert.equal(absent.registryCapabilityProfileRef.state, "NOT_PROVIDED");
  assert.ok(absent.rationaleCodes.includes("PROFILE_NOT_PROVIDED"));
});

test("policy-content-blocked customer semantics remain non-executable and contain no invented wording", () => {
  const n = need("need-content", { concept: "TRUST_STATUS", contentReadinessStatus: "POLICY_CONTENT_BLOCKED", strategies: [] });
  const blocked = option(ACTION_TYPE.REQUEST_STRUCTURED_INFORMATION, [n.needId], { contentReadiness: CONTENT_READINESS.REQUIRES_POLICY_CONTENT });
  const plan = planUboResolutionV2(plannerInput([n], { resolutionOptions: [blocked] }));
  assert.equal(plan.state, PLAN_STATE.BLOCKED);
  assert.equal(plan.recommendedActions.length, 0);
  assert.equal(plan.unresolvedPolicyContentDependencies.length, 1);
  assert.equal(JSON.stringify(plan).includes("questionText"), false);
  assert.equal(JSON.stringify(plan).includes("wording"), false);
});

test("branch specialist work stays separate from independent system work and a case-wide stop suppresses customer work", () => {
  const systemNeed = need("need-system-branch");
  const specialistNeed = need("need-specialist-branch", { entityId: "trust-branch", concept: "TRUST_STATUS" });
  const branch = planUboResolutionV2(plannerInput([systemNeed, specialistNeed], {
    resolutionOptions: [option(ACTION_TYPE.DISCOVER_INFORMATION, [systemNeed.needId]), option(ACTION_TYPE.REQUEST_STRUCTURED_INFORMATION, [specialistNeed.needId])],
    specialistRoutes: [{ specialistRouteId: "specialist-branch", relatedInformationNeedIds: [specialistNeed.needId], requirementIds: ["UBO-R11"], entityIds: ["trust-branch"] }],
  }));
  assert.equal(branch.state, PLAN_STATE.SYSTEM_RESOLUTION);
  assert.equal(branch.specialistActions.length, 1);
  assert.equal(branch.recommendedActions.every(({ actor }) => actor === "SYSTEM"), true);
  const caseWide = planUboResolutionV2(plannerInput([systemNeed, specialistNeed], {
    resolutionOptions: [option(ACTION_TYPE.REQUEST_STRUCTURED_INFORMATION, [systemNeed.needId]), option(ACTION_TYPE.REQUEST_STRUCTURED_INFORMATION, [specialistNeed.needId])],
    specialistRoutes: [{ specialistRouteId: "specialist-case", caseWide: true, relatedInformationNeedIds: [], requirementIds: ["UBO-R11"], entityIds: [] }],
  }));
  assert.equal(caseWide.state, PLAN_STATE.SPECIALIST_REVIEW);
  assert.equal(caseWide.recommendedActions.every(({ actor }) => actor === "SPECIALIST"), true);
  assert.equal(caseWide.customerBundles.length, 0);
});

test("grouping is causal: coherent packages merge, unrelated same-entity causes and branches remain distinct", () => {
  const ownership = need("need-owner", { entityId: "holdco", concept: "CURRENT_OWNERSHIP_AND_CONTROL" });
  const currentness = need("need-current", { entityId: "holdco", concept: "RELATIONSHIP_CURRENTNESS", targetKind: "RELATIONSHIP", targetReference: { relationshipId: "rel-1", subjectEntityId: "owner", objectEntityId: "holdco" }, frontierEntityId: null });
  const other = need("need-other-branch", { entityId: "other-holdco" });
  const separate = planUboResolutionV2(plannerInput([ownership, currentness, other], { resolutionOptions: [] }));
  assert.equal(separate.resolutionGroups.length, 3);
  const packageOption = option(ACTION_TYPE.REQUEST_STRUCTURE_EVIDENCE, [ownership.needId, currentness.needId], { coverageBasis: "COHERENT_EVIDENCE_PACKAGE" });
  const grouped = planUboResolutionV2(plannerInput([ownership, currentness, other], { resolutionOptions: [packageOption] }));
  assert.equal(grouped.resolutionGroups.length, 2);
  const repeated = planUboResolutionV2(plannerInput([other, currentness, ownership], { resolutionOptions: [packageOption] }));
  assert.deepEqual(grouped.resolutionGroups.map(({ groupId }) => groupId), repeated.resolutionGroups.map(({ groupId }) => groupId));
});

test("one substantive NO_DATA outcome pivots one coherent R01/R02/R03 frontier package instead of per-need actions", () => {
  const needs = [
    need("holdco-r01", { entityId: "holdco", requirementIds: ["UBO-R01"] }),
    need("holdco-r02", { entityId: "holdco", concept: "ADDITIONAL_DIRECT_HOLDER", requirementIds: ["UBO-R02"] }),
    need("holdco-r03", { entityId: "holdco", concept: "LAYER_QUALIFIER", requirementIds: ["UBO-R03"] }),
  ];
  const discovery = option(ACTION_TYPE.DISCOVER_INFORMATION, needs.map(({ needId }) => needId), { coverageBasis: "COHERENT_EVIDENCE_PACKAGE" });
  const structure = option(ACTION_TYPE.REQUEST_STRUCTURE_EVIDENCE, needs.map(({ needId }) => needId), { coverageBasis: "COHERENT_EVIDENCE_PACKAGE" });
  const base = plannerInput(needs, { registryCapabilityProfile: profile(), resolutionOptions: [discovery, structure] });
  const first = planUboResolutionV2(base);
  const pivoted = planUboResolutionV2({ ...base, predecessorResolutionPlan: first, resolutionAttempts: [{ informationNeedIds: needs.map(({ needId }) => needId), semanticActionType: ACTION_TYPE.DISCOVER_INFORMATION, capabilityOutcomeState: "NO_DATA", materialInputFingerprint: first.materialInputFingerprint }] });
  assert.equal(pivoted.resolutionGroups.length, 1);
  assert.equal(pivoted.recommendedActions.length, 1);
  assert.deepEqual(pivoted.recommendedActions[0].coveredInformationNeedIds, ["holdco-r01", "holdco-r02", "holdco-r03"]);
  assert.equal(pivoted.strategyAssignments[0].changeReason, "SUBSTANTIVE_ATTEMPT_OUTCOME");
});

test("strategy does not oscillate for an unchanged predecessor and a material pivot records its reason", () => {
  const n = need("need-no-oscillation");
  const discoveryInput = plannerInput([n], { registryCapabilityProfile: profile(), resolutionOptions: [option(ACTION_TYPE.DISCOVER_INFORMATION, [n.needId]), option(ACTION_TYPE.REQUEST_STRUCTURE_EVIDENCE, [n.needId])] });
  const first = planUboResolutionV2(discoveryInput);
  const unchanged = planUboResolutionV2({ ...discoveryInput, predecessorResolutionPlan: first });
  assert.equal(unchanged.strategyAssignments[0].strategy, ACQUISITION_STRATEGY.DISCOVERY_LED);
  assert.equal(unchanged.strategyAssignments[0].changeReason, "NO_MATERIAL_STRATEGY_CHANGE");
  const exhausted = planUboResolutionV2({ ...discoveryInput, predecessorResolutionPlan: first, resolutionAttempts: [{ informationNeedIds: [n.needId], semanticActionType: ACTION_TYPE.DISCOVER_INFORMATION, capabilityOutcomeState: "NO_DATA", materialInputFingerprint: first.materialInputFingerprint }] });
  assert.equal(exhausted.strategyAssignments[0].strategy, ACQUISITION_STRATEGY.CHART_ASSISTED);
  assert.equal(exhausted.strategyAssignments[0].changeReason, "SUBSTANTIVE_ATTEMPT_OUTCOME");
  const stableChart = planUboResolutionV2({ ...discoveryInput, predecessorResolutionPlan: exhausted, resolutionAttempts: exhausted.attemptHistory });
  assert.equal(stableChart.strategyAssignments[0].strategy, ACQUISITION_STRATEGY.CHART_ASSISTED);
  assert.equal(stableChart.strategyAssignments[0].changeReason, "NO_MATERIAL_STRATEGY_CHANGE");
  assert.throws(() => planUboResolutionV2({ ...discoveryInput, predecessorResolutionPlan: exhausted, resolutionAttempts: [] }), /attempt history cannot regress/);
  const pivoted = planUboResolutionV2({ ...discoveryInput, registryCapabilityProfile: profile([entry({ capabilityState: CAPABILITY_STATE.UNSUPPORTED })], { profileVersion: "2" }), predecessorResolutionPlan: first });
  assert.equal(pivoted.strategyAssignments[0].strategy, ACQUISITION_STRATEGY.CHART_ASSISTED);
  assert.equal(pivoted.strategyAssignments[0].changeReason, "MATERIAL_INPUT_CHANGE");
});
