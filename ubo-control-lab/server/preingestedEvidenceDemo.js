"use strict";

const { createHash, randomUUID } = require("node:crypto");
const {
  CONSUMER_CONTRACT_VERSION,
  CONTRACT_VERSIONS,
  createEvidenceConsumer,
} = require("../../evidence/consumer/v1/index.js");
const {
  CAPABILITY_CONTRACT_VERSION,
  CAPABILITY_OUTCOME_STATE,
  CUSTOMER_ACTION_TYPE_V2,
  CUSTOMER_ACTION_V2,
  DECISION_APPLICATION_CONTRACT_VERSION_V3,
  createUboDecisionApplication,
} = require("../../ubo-control/index.js");
const { CASE_STATE_INTERNALS } = require("../../ubo-control/application/createUboDecisionApplication.js");
const { verifyDecisionSnapshotV2 } = require("../../ubo-control/domain/decisionSnapshotV2.js");
const { createEvidencePolicyClassification } = require("../../ubo-control/policy/evidencePolicy.js");
const { loadPolicyPack } = require("../../ubo-control/policy/policyPack.js");
const POLICY = require("../../ubo-control/policies/uk-corporate/1.6-rc/policy.json");
const {
  createEvidencePlatformExtractionAdapter,
} = require("../../integrations/ubo-control/evidence-platform-extraction/index.js");
const {
  ARTIFACT_LABEL,
  AT,
  DIGEST,
  IDS,
  artifact,
  buildBettercommsServiceResult,
} = require("../fixtures/bettercomms-preingested.js");
const { assessSignedOwnershipAttestation } = require("../fixtures/sourceAttestation.js");

const SESSION_VERSION = "ubo-control-lab-preingested-evidence-session-v1";
const FIXTURE_ID = "AJV2-EVIDENCE-01";
const SUBJECT_ID = "better-comms-voip-ltd";
const ENTITY_IDS = Object.freeze({
  mitchell: "mitchell-fortescue",
  lee: "lee-taylor",
  holdco: "better-holdco",
  comms: SUBJECT_ID,
  network: "better-network-services",
});
const FORBIDDEN_SESSION_KEYS = /(?:password|credential|accessToken|providerSecret|rawProviderPayload|documentContents|evidenceBytes|blobUrl|filePath|storageKey)/i;
const runtimeOperations = new Map();
const runtimeCounters = { providerCalls: 0 };
const MATERIAL_OWNERSHIP_FACT_IDS = Object.freeze([1, 2, 3, 4]
  .map((index) => `30000000-0000-4000-8000-00000000000${index}`));

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function stableId(prefix, value) {
  return `${prefix}:${createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 32)}`;
}
function entity(entityId, primaryName, category = "LEGAL_ENTITY") {
  return {
    entityId,
    category,
    primaryName,
    aliases: [],
    externalIdentifiers: [],
    jurisdiction: "GB",
    entityTypeMetadata: category === "NATURAL_PERSON" ? {} : { entityProfile: "COMPANY" },
    recordedAt: AT,
  };
}
function subjectReference() {
  return { entityId: SUBJECT_ID, name: "Better Comms VOIP Ltd", entityType: "LEGAL_ENTITY", jurisdiction: "GB", externalIdentifiers: [] };
}
function caseContext() {
  return { entityType: "private_limited_company", entityProfile: "COMPANY", subjectEntityId: SUBJECT_ID, jurisdiction: "GB", riskLevel: "MEDIUM" };
}
function emptyCapabilityResult(requestId) {
  return {
    contractVersion: CAPABILITY_CONTRACT_VERSION,
    requestId,
    outcome: { state: CAPABILITY_OUTCOME_STATE.NO_DATA, code: "PRE_INGESTED_EVIDENCE_REQUIRED" },
    candidateFacts: [],
    operationEvidenceReferences: [],
    issues: [],
  };
}
function app() {
  return createUboDecisionApplication({ policyPack: POLICY, contractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V3 });
}
function evaluate(application, state, context, options = {}) {
  return application.evaluate({
    contractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V3,
    runtimeMode: "LAB",
    caseState: state.caseState,
    caseContext: context,
    evaluationTime: options.evaluationTime || AT,
    checkpoint: options.checkpoint || "CASE_EVENT",
    checkpointReference: { referenceId: options.referenceId || `${FIXTURE_ID}:evaluation` },
    resolutionInputs: options.resolutionInputs || {},
    ...(options.decisionHistory ? { decisionHistory: options.decisionHistory } : {}),
    ...(options.expectedHeadSnapshotId ? { expectedHeadSnapshotId: options.expectedHeadSnapshotId } : {}),
    ...(options.supersessionReason ? { supersessionReason: options.supersessionReason } : {}),
  });
}
function entry(sequence, reason, evaluated) {
  return {
    sequence,
    reason,
    snapshot: evaluated.decisionSnapshot,
    plan: evaluated.resolutionPlan,
    journey: evaluated.journeyProjection,
    graph: evaluated.ownershipGraphProjection,
  };
}
function structureEvidenceOption(preliminary) {
  const open = preliminary.decisionSnapshot.decisionContent.informationNeedsV2
    .filter(({ status, requiredByRequirementIds }) => status === "OPEN"
      && requiredByRequirementIds.some((id) => ["UBO-R01", "UBO-R08"].includes(id)));
  if (open.length === 0) throw new TypeError("Bettercomms fixture did not produce a causal ownership/evidence need");
  return {
    resolutionStrategy: "CUSTOMER_DOCUMENT",
    semanticActionType: "REQUEST_STRUCTURE_EVIDENCE",
    informationNeedIds: open.map(({ needId }) => needId).sort(),
    requirementIds: [...new Set(open.flatMap(({ requiredByRequirementIds }) => requiredByRequirementIds))].sort(),
    acquisitionChannel: "CUSTOMER_EVIDENCE",
    capabilityQuery: {
      jurisdiction: "GB",
      entityProfile: "COMPANY",
      informationConcept: "OWNERSHIP_STRUCTURE_EVIDENCE",
      relationshipDimension: "ECONOMIC",
      relationshipBasis: "ANY",
      acquisitionChannel: "CUSTOMER_EVIDENCE",
      entitlementContext: "BETTERCOMMS_REVIEW_LAB",
    },
    evidenceCategories: ["ownership_chart"],
    contentReadiness: "READY",
    currentlyAvailable: true,
    causalGroupingKey: "BETTERCOMMS_PREINGESTED_OWNERSHIP_CHART",
    coverageBasis: "COHERENT_EVIDENCE_PACKAGE",
    targetReference: { entityId: SUBJECT_ID },
    expectedCandidateFacts: [{ type: "ECONOMIC_OWNERSHIP" }],
    externalHandoffType: "EVIDENCE_OR_INFORMATION_INTAKE",
    retryPermitted: false,
  };
}
function advanceToEvidencePlan(application, state, context) {
  const preliminary = evaluate(application, state, context, { checkpoint: "CASE_OPEN", referenceId: `${FIXTURE_ID}:preliminary` });
  const resolutionInputs = { resolutionOptions: [structureEvidenceOption(preliminary)], resolutionAttempts: [] };
  let evaluated = evaluate(application, state, context, { checkpoint: "CASE_OPEN", referenceId: `${FIXTURE_ID}:snapshot-a`, resolutionInputs });
  for (let wave = 0; wave < 5 && evaluated.resolutionPlan.systemActions.length > 0; wave += 1) {
    resolutionInputs.resolutionAttempts.push(...evaluated.resolutionPlan.systemActions.map((action) => ({
      informationNeedIds: action.coveredInformationNeedIds,
      semanticActionType: action.semanticActionType,
      capabilityOutcomeState: "NO_DATA",
      materialInputFingerprint: evaluated.resolutionPlan.materialInputFingerprint,
    })));
    evaluated = evaluate(application, state, context, { checkpoint: "CASE_OPEN", referenceId: `${FIXTURE_ID}:snapshot-a`, resolutionInputs });
  }
  const bundle = evaluated.journeyProjection.customerWorkBundles.find(({ evidenceHandoff }) => evidenceHandoff?.readiness === "EVIDENCE_HANDOFF_READY_EXECUTION_NOT_CONNECTED");
  if (!bundle) throw new TypeError("Bettercomms fixture did not expose an executable ExternalEvidenceHandoff");
  return { evaluated, resolutionInputs, bundle };
}
function evidenceAction(snapshotA, bundle) {
  const permitted = bundle.permittedSemanticActions.find(({ actionType, executable }) => actionType === CUSTOMER_ACTION_TYPE_V2.REQUEST_EXTERNAL_EVIDENCE && executable);
  if (!permitted) throw new TypeError("Bettercomms Evidence handoff is not executable in the Lab plan");
  return {
    contractVersion: CUSTOMER_ACTION_V2,
    caseReference: snapshotA.journey.decision.caseReference,
    sourceDecisionSnapshot: { snapshotId: snapshotA.snapshot.snapshotId, snapshotHash: snapshotA.snapshot.decisionContentHash },
    sourceResolutionPlan: { planId: snapshotA.plan.planId, planHash: snapshotA.plan.planHash },
    bundleId: bundle.bundleId,
    resolutionGroupId: bundle.resolutionGroupId,
    resolutionActionId: permitted.sourceResolutionActionId,
    informationNeedIds: bundle.informationNeedIds,
    requirementIds: bundle.requirementIds,
    canonicalSubject: bundle.canonicalSubject,
    frontierEntityIds: bundle.frontierEntityIds,
    policyIdentity: snapshotA.journey.decision.policyIdentity,
    actionType: CUSTOMER_ACTION_TYPE_V2.REQUEST_EXTERNAL_EVIDENCE,
    submissionContract: permitted.submissionContract,
    actorReference: { referenceId: "bettercomms-demo-presenter" },
    actorCapacity: "AUTHORISED_APPLICANT",
    submittedAt: AT,
    informationAsAtDate: AT,
    delegatedFrom: null,
    payload: {
      requestCorrelationId: `${FIXTURE_ID}:preingested-artifact`,
      evidenceCategories: bundle.evidenceHandoff.semanticEvidenceCategories,
      requestedConcepts: bundle.evidenceHandoff.requestedConcepts,
      informationAsAtDate: AT,
    },
  };
}
function authorization() {
  return {
    contractVersion: CONTRACT_VERSIONS.trustedAuthorization,
    tenantId: "tenant-bettercomms",
    contextId: IDS.context,
    callerScope: "ubo:wave-11b2a-review-lab",
    actorType: "service",
    actorId: "trusted-lab-composition-root",
    subjectReferenceId: IDS.subject,
  };
}
function canonicalEvidenceRequest(value) {
  return JSON.stringify({ artifactIds: value.artifactIds, requestedConcepts: value.requestedConcepts, extractionContext: value.extractionContext, correlation: value.correlation });
}
function createFixtureConsumer(fault = null) {
  const interpretationService = {
    async resolve({ artifactIds }, auth) {
      if (fault === "ACCESS_DENIED") throw Object.assign(new Error("denied"), { code: "artifact_access_denied" });
      if (fault === "ARTIFACT_UNAVAILABLE") throw Object.assign(new Error("unavailable"), { code: "artifact_unavailable" });
      if (auth.tenantId !== "tenant-bettercomms" || auth.contextId !== IDS.context || artifactIds.length !== 1 || artifactIds[0] !== IDS.artifact) {
        throw Object.assign(new Error("denied"), { code: "artifact_access_denied" });
      }
      return [artifact()];
    },
    async interpret(request, auth) {
      await this.resolve({ artifactIds: request.artifactIds }, auth);
      if (fault === "UNSUPPORTED_MEDIA") throw Object.assign(new Error("unsupported"), { code: "unsupported_media" });
      if (fault === "NOT_EVALUATED") throw Object.assign(new Error("not evaluated"), { code: "incomplete_interpretation" });
      if (fault === "INTEGRITY_FAILURE") throw Object.assign(new Error("integrity failed"), { code: "integrity_mismatch" });
      const fingerprint = canonicalEvidenceRequest(request);
      if (fault === "IDEMPOTENCY_CONFLICT" && !runtimeOperations.has(request.operationKey)) {
        runtimeOperations.set(request.operationKey, { fingerprint: "fixture-conflicting-request", result: null });
      }
      const existing = runtimeOperations.get(request.operationKey);
      if (existing && existing.fingerprint !== fingerprint) throw Object.assign(new Error("conflict"), { code: "idempotency_conflict" });
      if (existing) return { ...clone(existing.result), replayed: true, providerCalled: false };
      runtimeCounters.providerCalls += 1;
      let result = buildBettercommsServiceResult(request);
      if (fault === "PARTIAL") result.completeness.extraction = { state: "partial", limitations: ["fixture-partial"] };
      if (fault === "MALFORMED") result.correlation.requestId = "wrong-request";
      runtimeOperations.set(request.operationKey, { fingerprint, result: clone(result) });
      return result;
    },
    async history() { return { providerCalled: false, operations: [] }; },
  };
  return createEvidenceConsumer({
    interpretationService,
    reconstructionService: { async reconstructEvidence() { throw new Error("not used"); } },
    packageService: {
      async listAuthorizedPackages() { throw new Error("not used"); },
      async reopenPackage() { throw new Error("not used"); },
      async verifyPackageManifest() { throw new Error("not used"); },
    },
  });
}
function adapterFor(fault = null) {
  return createEvidencePlatformExtractionAdapter({
    evidenceConsumer: createFixtureConsumer(fault),
    trustedAuthorizationProvider: async () => authorization(),
  });
}
function extractionRequest(session, overrides = {}) {
  const handoff = session.externalEvidenceHandoff;
  return {
    contractVersion: CAPABILITY_CONTRACT_VERSION,
    requestId: session.evidenceOperationKey,
    caseId: session.caseState.caseReference.caseId,
    informationNeeds: handoff.informationNeedIds.map((informationNeedId) => ({
      informationNeedId,
      concepts: ["ECONOMIC_OWNERSHIP"],
      resolutionGroupId: handoff.resolutionGroupId,
      resolutionActionId: handoff.resolutionActionId,
    })),
    artifactEvidenceReferences: [{
      system: "evidence-platform-v1",
      referenceType: "ARTIFACT",
      referenceId: IDS.artifact,
      integrity: { algorithm: "sha256", digest: DIGEST },
    }],
    ...overrides,
  };
}
function publicArtifactRecord() {
  return { label: ARTIFACT_LABEL, artifactId: IDS.artifact, digest: DIGEST, digestAlgorithm: "sha256", mediaType: "image/png", sizeBytes: 4096, capturedAt: AT, sourceCount: 1 };
}
function sourceAttestationAssessment() {
  return assessSignedOwnershipAttestation({
    artifactId: IDS.artifact,
    materialFactIds: MATERIAL_OWNERSHIP_FACT_IDS,
    attestation: {
      signatureText: null,
      signerName: null,
      signerCapacity: null,
      signedDate: null,
      asAtDate: null,
      declarationText: null,
      scope: null,
      locator: null,
    },
  });
}
function startPreingestedEvidenceDemo({ sessionId } = {}) {
  const application = app();
  const requestId = `${FIXTURE_ID}:empty-intake`;
  let state = application.intake({
    contractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V3,
    caseInput: {
      caseId: `ubo-lab:bettercomms:${sessionId || randomUUID()}`,
      subjectReference: subjectReference(),
      externalReferences: [{ system: "ubo-control-lab", referenceId: FIXTURE_ID }],
      createdAt: AT,
    },
    capabilityResult: emptyCapabilityResult(requestId),
    operationId: `${requestId}:operation`,
    recordedAt: AT,
  });
  state = application.applyDecisions({
    contractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V3,
    caseState: state.caseState,
    entityRegistrations: [entity(SUBJECT_ID, "Better Comms VOIP Ltd")],
    identityDecisions: [],
    claimAdjudications: [],
  });
  const context = caseContext();
  const planned = advanceToEvidencePlan(application, state, context);
  const snapshotA = entry(1, "SNAPSHOT_A_OWNERSHIP_EVIDENCE_REQUIRED", planned.evaluated);
  return clone({
    contractVersion: SESSION_VERSION,
    sessionId: sessionId || `bettercomms-preingested:${randomUUID()}`,
    sourceMode: "FIXTURE",
    sourceIdentity: { fixtureId: FIXTURE_ID, sourceFixtureId: "V2-LAB-01" },
    fixtureId: FIXTURE_ID,
    fixtureLabel: "BETTERCOMMS — PRE-INGESTED OWNERSHIP CHART",
    sessionOnly: true,
    productionAuthorized: false,
    stage: "EVIDENCE_REQUIRED",
    caseContext: context,
    caseState: state.caseState,
    resolutionInputs: planned.resolutionInputs,
    decisionHistory: planned.evaluated.decisionHistory,
    snapshots: [snapshotA],
    evidenceBundleId: planned.bundle.bundleId,
    evidenceOperationKey: `${FIXTURE_ID}:${stableId("operation", state.caseState.caseReference)}`,
    externalEvidenceHandoff: null,
    artifactCorrelation: null,
    sourceAttestation: null,
    extraction: null,
    decisionTargets: { candidateParties: [], candidateClaims: [] },
    decisionAudit: [],
    entityDirectory: [entity(SUBJECT_ID, "Better Comms VOIP Ltd")],
    labels: ["PRE-INGESTED DEMO ARTIFACT", "REVIEW LAB — NOT PRODUCTION UPLOAD"],
  });
}
async function usePreingestedBettercommsArtifact({ session, fault = null } = {}) {
  const verified = validateSession(session);
  if (verified.stage !== "EVIDENCE_REQUIRED") return verified;
  const application = app();
  const snapshotA = verified.snapshots[0];
  const bundle = snapshotA.journey.customerWorkBundles.find(({ bundleId }) => bundleId === verified.evidenceBundleId);
  if (!bundle) throw new TypeError("Snapshot A no longer contains the pinned Evidence bundle");
  const action = evidenceAction(snapshotA, bundle);
  const customer = application.applyCustomerInput({
    contractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V3,
    caseState: verified.caseState,
    sourceDecisionSnapshot: snapshotA.snapshot,
    sourceResolutionPlan: snapshotA.plan,
    customerAction: action,
    operationId: `${verified.evidenceOperationKey}:handoff`,
  });
  const handoff = customer.customerActionResult.externalEvidenceHandoff;
  if (!handoff) throw new TypeError("Decision Application v3 did not create ExternalEvidenceHandoff v1");
  const capabilityResult = await adapterFor(fault).extract(extractionRequest({ ...verified, caseState: customer.caseState, externalEvidenceHandoff: handoff }));
  if (!["COMPLETE", "PARTIAL"].includes(capabilityResult.outcome.state)) {
    return clone({ ...verified, stage: "EVIDENCE_FAILED", extraction: { capabilityResult, providerCallCount: runtimeCounters.providerCalls }, externalEvidenceHandoff: handoff });
  }
  const intaken = application.intake({
    contractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V3,
    caseState: customer.caseState,
    capabilityResult,
    operationId: `${verified.evidenceOperationKey}:ubo-intake`,
    recordedAt: AT,
  });
  return clone({
    ...verified,
    stage: "SOURCE_FACTS_EXTRACTED",
    caseState: intaken.caseState,
    externalEvidenceHandoff: handoff,
    artifactCorrelation: {
      contractVersion: "ubo-lab-evidence-handoff-correlation-v1",
      caseReference: clone(action.caseReference),
      snapshotReference: clone(action.sourceDecisionSnapshot),
      planReference: clone(action.sourceResolutionPlan),
      bundleId: action.bundleId,
      resolutionGroupId: action.resolutionGroupId,
      resolutionActionId: action.resolutionActionId,
      informationNeedIds: clone(action.informationNeedIds),
      requestedConcepts: clone(handoff.requestedConcepts),
      informationAsAtDate: action.informationAsAtDate,
      artifactReference: publicArtifactRecord(),
    },
    sourceAttestation: sourceAttestationAssessment(),
    extraction: {
      consumerContractVersion: CONSUMER_CONTRACT_VERSION,
      adapterContractVersion: adapterFor().contractVersion,
      capabilityResult,
      artifact: publicArtifactRecord(),
      interpretation: { operationId: IDS.operation, operationKey: verified.evidenceOperationKey, extractionRunId: IDS.run, outcome: capabilityResult.outcome.state },
      providerCallCount: runtimeCounters.providerCalls,
      sourceCount: 1,
      extractedFactCount: capabilityResult.candidateFacts.length,
    },
    decisionTargets: intaken.decisionTargets,
    decisionAudit: [...verified.decisionAudit, { event: "SOURCE_FACTS_INTAKEN_AS_CANDIDATES", recordedAt: AT, candidateFactIds: capabilityResult.candidateFacts.map(({ factId }) => factId) }],
  });
}
function decisionMap() {
  const fact = (index) => `30000000-0000-4000-8000-00000000000${index}`;
  return new Map([
    [`${fact(1)}:subject`, ENTITY_IDS.mitchell], [`${fact(1)}:object`, ENTITY_IDS.holdco],
    [`${fact(2)}:subject`, ENTITY_IDS.lee], [`${fact(2)}:object`, ENTITY_IDS.holdco],
    [`${fact(3)}:subject`, ENTITY_IDS.holdco], [`${fact(3)}:object`, ENTITY_IDS.comms],
    [`${fact(4)}:subject`, ENTITY_IDS.holdco], [`${fact(4)}:object`, ENTITY_IDS.network],
    [`${fact(5)}:subject`, ENTITY_IDS.mitchell], [`${fact(5)}:object`, ENTITY_IDS.holdco],
    [`${fact(6)}:subject`, ENTITY_IDS.lee], [`${fact(6)}:object`, ENTITY_IDS.holdco],
  ]);
}
function exactFixtureEntityId(candidatePartyKey, identities) {
  const match = [...identities.entries()].find(([sourceOccurrence]) => candidatePartyKey.endsWith(`:${sourceOccurrence}`));
  return match?.[1] || null;
}
function evidenceClassification(caseState) {
  const raw = CASE_STATE_INTERNALS.decodeCaseState(caseState, DECISION_APPLICATION_CONTRACT_VERSION_V3);
  const ownershipClaims = raw.candidateClaims.filter(({ claimType }) => claimType === "RELATIONSHIP");
  return createEvidencePolicyClassification({
    loadedPolicyPack: loadPolicyPack(POLICY),
    caseState: raw,
    input: {
      evidenceReference: ownershipClaims[0].evidenceReferences[0],
      evidenceCatalogueKey: "ownership_chart",
      sourceOrigin: "INDEPENDENT_OF_APPLICANT",
      capturedAt: AT,
      currentState: "UNKNOWN",
      classificationBasis: { origin: "WAVE_11B2A_PREINGESTED_ACCEPTED_FIXTURE" },
      supports: [{
        requirementId: "UBO-R08",
        direction: "POSITIVE",
        policyFactKey: "ownership_structure",
        resolutionStrategy: "EXISTING_EVIDENCE",
        basisAssessmentIds: [],
        claimIds: ownershipClaims.map(({ claimId }) => claimId),
      }],
    },
  });
}
function applyPreconfiguredFixtureDecisions({ session } = {}) {
  const verified = validateSession(session);
  if (verified.stage !== "SOURCE_FACTS_EXTRACTED") return verified;
  const application = app();
  const identities = decisionMap();
  const registrations = [
    entity(ENTITY_IDS.mitchell, "Mitchell Fortescue", "NATURAL_PERSON"),
    entity(ENTITY_IDS.lee, "Lee Taylor", "NATURAL_PERSON"),
    entity(ENTITY_IDS.holdco, "Better Holdco"),
    entity(ENTITY_IDS.network, "Better Network Services"),
  ];
  const identityDecisions = verified.decisionTargets.candidateParties.map((target, index) => {
    const entityId = exactFixtureEntityId(target.candidatePartyKey, identities);
    if (!entityId) throw new TypeError(`No exact fixture identity is configured for ${target.candidatePartyKey}`);
    return {
      decisionId: `${FIXTURE_ID}:identity:${index + 1}`,
      candidatePartyKey: target.candidatePartyKey,
      status: "RESOLVED",
      entityId,
      basisReasonCodes: ["EXACT_ACCEPTED_FIXTURE_SOURCE_OCCURRENCE"],
      evidenceReferences: [],
      decidedAt: AT,
      decisionOrigin: "UBO_CONTROL_LAB_PREINGESTED_FIXTURE",
    };
  });
  const claimAdjudications = verified.decisionTargets.candidateClaims.map((target, index) => ({
    decisionId: `${FIXTURE_ID}:claim:${index + 1}`,
    claimId: target.claimId,
    previousState: target.currentState,
    resultingState: "OPERATIVE",
    reasonBasisCode: target.claimType === "ENTITY_ATTRIBUTE" ? "SOURCE_BACKED_NON_OWNERSHIP_METADATA" : "SOURCE_BACKED_ECONOMIC_OWNERSHIP",
    supportingEvidenceReferences: [],
    decisionOrigin: "UBO_CONTROL_LAB_PREINGESTED_FIXTURE",
    decidedAt: AT,
    supersededByClaimIds: [],
    adversarialClaimIds: [],
  }));
  const decided = application.applyDecisions({
    contractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V3,
    caseState: verified.caseState,
    entityRegistrations: registrations,
    identityDecisions,
    claimAdjudications,
  });
  const resolutionInputs = {
    resolutionAttempts: clone(verified.resolutionInputs.resolutionAttempts || []),
    evidenceClassifications: [evidenceClassification(decided.caseState)],
  };
  const snapshotA = verified.snapshots[0];
  const evaluated = evaluate(application, decided, verified.caseContext, {
    evaluationTime: "2026-09-08T10:01:00.000Z",
    checkpoint: "CASE_EVENT",
    referenceId: `${FIXTURE_ID}:snapshot-b`,
    resolutionInputs,
    decisionHistory: verified.decisionHistory,
    expectedHeadSnapshotId: snapshotA.snapshot.snapshotId,
    supersessionReason: "NEW_FACTS",
  });
  return clone({
    ...verified,
    stage: "SNAPSHOT_B",
    caseState: evaluated.caseState,
    resolutionInputs,
    decisionHistory: evaluated.decisionHistory,
    snapshots: [...verified.snapshots, entry(2, "SNAPSHOT_B_PREINGESTED_EVIDENCE_REVIEWED", evaluated)],
    decisionTargets: evaluated.decisionTargets,
    entityDirectory: [entity(SUBJECT_ID, "Better Comms VOIP Ltd"), ...registrations],
    decisionAudit: [
      ...verified.decisionAudit,
      ...identityDecisions.map((decision) => ({ event: "IDENTITY_DECISION", ...decision })),
      ...claimAdjudications.map((decision) => ({ event: "CLAIM_DECISION", ...decision })),
      { event: "SNAPSHOT_B_CREATED", snapshotId: evaluated.decisionSnapshot.snapshotId, recordedAt: "2026-09-08T10:01:00.000Z" },
    ],
  });
}
function assertSafeSession(value, path = "session") {
  if (Array.isArray(value)) return value.forEach((item, index) => assertSafeSession(item, `${path}[${index}]`));
  if (!value || typeof value !== "object") return;
  Object.entries(value).forEach(([key, item]) => {
    if (FORBIDDEN_SESSION_KEYS.test(key)) throw new TypeError(`Unsafe pre-ingested Lab session field at ${path}.${key}`);
    assertSafeSession(item, `${path}.${key}`);
  });
}
function validateSession(value) {
  if (!value || value.contractVersion !== SESSION_VERSION || value.sourceMode !== "FIXTURE" || value.sessionOnly !== true || value.productionAuthorized !== false) {
    throw new TypeError("Unsupported pre-ingested Evidence Lab session");
  }
  assertSafeSession(value);
  value.snapshots.forEach(({ snapshot }) => verifyDecisionSnapshotV2(snapshot));
  if (["SOURCE_FACTS_EXTRACTED", "SNAPSHOT_B"].includes(value.stage)
    && (value.sourceAttestation?.case !== "CASE_B" || value.sourceAttestation.relationshipCurrentness !== "UNKNOWN")) {
    throw new TypeError("Pre-ingested Artifact attestation assessment is missing or inconsistent");
  }
  if (value.stage === "SNAPSHOT_B" && value.snapshots.at(-1).graph.relationships.some(({ temporalState }) => temporalState !== "UNKNOWN")) {
    throw new TypeError("Pre-ingested Artifact relationship currentness is inconsistent with the source");
  }
  if (value.artifactCorrelation) {
    const reference = value.artifactCorrelation.artifactReference;
    if (reference.artifactId !== IDS.artifact || reference.digest !== DIGEST) throw new TypeError("Pre-ingested Artifact reference integrity check failed");
  }
  return clone(value);
}
function runtimeMetrics() { return clone(runtimeCounters); }
function resetRuntimeForTest() { runtimeOperations.clear(); runtimeCounters.providerCalls = 0; }

module.exports = Object.freeze({
  ENTITY_IDS,
  FIXTURE_ID,
  SESSION_VERSION,
  applyPreconfiguredFixtureDecisions,
  extractionRequest,
  resetRuntimeForTest,
  runtimeMetrics,
  startPreingestedEvidenceDemo,
  usePreingestedBettercommsArtifact,
  validateSession,
});
