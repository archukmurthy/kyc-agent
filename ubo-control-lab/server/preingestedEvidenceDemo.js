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
  TEMPORAL_SUPPORT_DATE_BASIS,
  TEMPORAL_SUPPORT_DATE_PRECISION,
  TEMPORAL_SUPPORT_REVIEW_DISPOSITION,
  TEMPORAL_SUPPORT_REVIEW_V1,
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
  CERTIFICATION_DATE,
  DIGEST,
  DIMENSIONS,
  FACT_IDS,
  HISTORICAL_LEADS,
  IDS,
  REVIEW_RECORDED_AT: AT,
  SIZE_BYTES,
  artifact,
  buildBettercommsServiceResult,
  sourceCertification,
} = require("../fixtures/bettercomms-source-reviewed.js");
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
const runtimeCounters = { providerCalls: 0, reviewedFixtureRuns: 0 };
const MATERIAL_OWNERSHIP_FACT_IDS = Object.freeze([
  FACT_IDS.mitchellOwnership,
  FACT_IDS.leeOwnership,
  FACT_IDS.commsOwnership,
  FACT_IDS.networkOwnership,
]);
const DATED_REVIEW_AT = "2026-09-13T21:40:00.000Z";
const DATED_EVALUATION_AT = "2026-09-13T21:41:00.000Z";

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
    entityTypeMetadata: category === "LEGAL_ENTITY" ? { entityProfile: "COMPANY" } : {},
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
    ...(options.assessmentDate ? { assessmentDate: options.assessmentDate } : {}),
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
      runtimeCounters.reviewedFixtureRuns += 1;
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
  return {
    label: ARTIFACT_LABEL,
    artifactId: IDS.artifact,
    digest: DIGEST,
    digestAlgorithm: "sha256",
    mediaType: "image/png",
    sizeBytes: SIZE_BYTES,
    dimensions: DIMENSIONS,
    capturedAt: null,
    certificationDate: CERTIFICATION_DATE,
    sourceCount: 1,
    provenance: "SOURCE_BACKED_MANUALLY_REVIEWED_FIXTURE",
    historicalEvidenceStoreLinkage: "NOT_REVALIDATED",
  };
}
function sourceAttestationAssessment() {
  const certification = sourceCertification();
  const assessment = assessSignedOwnershipAttestation({
    artifactId: IDS.artifact,
    materialFactIds: MATERIAL_OWNERSHIP_FACT_IDS,
    attestation: {
      signatureText: certification.signatureMark.characterization,
      signatureAuthenticated: certification.signatureMark.authenticated,
      signerName: certification.signerName,
      signerPostnominal: certification.signerPostnominal,
      signerCapacity: certification.signerCapacity,
      professionalReference: certification.professionalReference,
      signedDate: certification.certificationDate,
      asAtDate: null,
      declarationText: certification.declarationText,
      scope: {
        description: certification.declarationScope,
        coveredFactIds: certification.coveredFactIds,
        sourceExplicitOwnershipAsAtDate: null,
      },
      locator: {
        artifactId: IDS.artifact,
        kind: "image",
        region: { x: 15, y: 443, width: 510, height: 152, coordinateSystem: "original_pixels" },
        metadata: {
          qualification: "NEW_MANUAL_REVIEW_ANNOTATION_NOT_HISTORICAL_R3_LOCATOR",
          originalDimensions: DIMENSIONS,
        },
      },
    },
  });
  return clone({
    ...assessment,
    sourceCertification: certification,
    sourceDateSemantics: {
      certificationDate: CERTIFICATION_DATE,
      explicitOwnershipAsAtDate: null,
      historicalCapturedAt: null,
      fixtureReviewRecordedAt: AT,
      requestedAssessmentDate: AT.slice(0, 10),
      freshnessState: "NOT_ESTABLISHED",
    },
    reviewInterpretation: {
      status: "RECORDED_NOT_APPLIED_TO_RELATIONSHIP_CURRENTNESS",
      actor: { type: "LAB_FIXTURE_REVIEWER", referenceId: "control-room-source-review-fixture" },
      decidedAt: AT,
      statement: "The dated certification is being treated as a declaration that the depicted structure was accurate on 5 May 2026.",
      limitation: "The current UBO application contract has no analyst operation that separately applies this reviewed date interpretation to existing UNKNOWN relationship Facts; no CURRENT relationship or historical snapshot was fabricated.",
      sourceFactIds: Object.values(FACT_IDS).filter((id) => id.startsWith("92000000")),
      coveredRelationshipFactIds: MATERIAL_OWNERSHIP_FACT_IDS,
      unresolved: ["SIGNER_IDENTITY_NOT_VERIFIED", "SIGNER_AUTHORITY_NOT_VERIFIED", "NO_EXPLICIT_OWNERSHIP_AS_AT_DATE", "FRESHNESS_NOT_ESTABLISHED"],
    },
    historicalEvidenceLookup: HISTORICAL_LEADS,
    reason: "The source contains a dated chart certification and signature-like mark, but no explicit ownership-effective/as-at date; signer identity and authority are unverified, so relationship currentness remains UNKNOWN.",
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
    sourceIdentity: {
      fixtureId: FIXTURE_ID,
      sourceFixtureId: "PR60-RECOVERED-SOURCE-REVIEW-V1",
      sourceDigest: DIGEST,
      persistedHistoricalIdentity: false,
    },
    fixtureId: FIXTURE_ID,
    fixtureLabel: "BETTERCOMMS — SOURCE-BACKED REVIEWED OWNERSHIP CHART",
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
    labels: [
      "REAL SOURCE IMAGE — MANUALLY REVIEWED FIXTURE",
      "Historical Evidence-store linkage not yet revalidated",
      "No fresh automated interpretation performed in this demonstration",
    ],
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
  return new Map([
    [`${FACT_IDS.mitchellOwnership}:subject`, ENTITY_IDS.mitchell], [`${FACT_IDS.mitchellOwnership}:object`, ENTITY_IDS.holdco],
    [`${FACT_IDS.leeOwnership}:subject`, ENTITY_IDS.lee], [`${FACT_IDS.leeOwnership}:object`, ENTITY_IDS.holdco],
    [`${FACT_IDS.commsOwnership}:subject`, ENTITY_IDS.holdco], [`${FACT_IDS.commsOwnership}:object`, ENTITY_IDS.comms],
    [`${FACT_IDS.networkOwnership}:subject`, ENTITY_IDS.holdco], [`${FACT_IDS.networkOwnership}:object`, ENTITY_IDS.network],
    [`${FACT_IDS.mitchellOfficer}:subject`, ENTITY_IDS.mitchell], [`${FACT_IDS.mitchellOfficer}:object`, ENTITY_IDS.holdco],
    [`${FACT_IDS.leeOfficer}:subject`, ENTITY_IDS.lee], [`${FACT_IDS.leeOfficer}:object`, ENTITY_IDS.holdco],
    ...Object.values(FACT_IDS).filter((id) => id.startsWith("92000000")).map((id) => [`${id}:subject`, ENTITY_IDS.comms]),
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
      { event: "SNAPSHOT_B_CREATED", snapshotId: evaluated.decisionSnapshot.snapshotId, recordedAt: AT },
      { event: "SOURCE_CERTIFICATION_REVIEW_RECORDED", ...clone(verified.sourceAttestation.reviewInterpretation) },
    ],
  });
}

function applyDatedCertificationReview({ session } = {}) {
  const verified = validateSession(session);
  if (verified.stage === "DATED_REVIEW_APPLIED") return verified;
  if (verified.stage !== "SNAPSHOT_B") throw new TypeError("Dated certification review requires Snapshot B");
  const application = app();
  const source = verified.snapshots.at(-1);
  const raw = CASE_STATE_INTERNALS.decodeCaseState(verified.caseState, DECISION_APPLICATION_CONTRACT_VERSION_V3);
  const certificationClaims = raw.candidateClaims
    .filter(({ claimType, attribute, status }) => claimType === "ENTITY_ATTRIBUTE"
      && attribute?.startsWith("source_certification_") && status === "OPERATIVE");
  const byAttribute = new Map(certificationClaims.map((claim) => [claim.attribute, claim]));
  const required = (attribute) => {
    const claim = byAttribute.get(attribute);
    if (!claim) throw new TypeError(`Fixture is missing ${attribute}`);
    return claim.claimId;
  };
  const review = {
    contractVersion: TEMPORAL_SUPPORT_REVIEW_V1,
    reviewId: `${FIXTURE_ID}:temporal-review:1`,
    operationKey: `${FIXTURE_ID}:temporal-review-operation:1`,
    reviewActor: {
      actorId: "fixture-compliance-reviewer",
      capacity: "COMPLIANCE_ANALYST",
      trustBasis: "UBO_CONTROL_AUTHORISED_REVIEWER",
    },
    decidedAt: DATED_REVIEW_AT,
    disposition: TEMPORAL_SUPPORT_REVIEW_DISPOSITION.ACCEPT_DATED_SUPPORT,
    sourceStatementClaimIds: certificationClaims.map(({ claimId }) => claimId).sort(),
    sourceDateClaimId: required("source_certification_date"),
    sourceWordingClaimId: required("source_certification_declaration"),
    sourceScopeClaimId: required("source_certification_scope"),
    coveredRelationshipIds: source.graph.relationships.map(({ relationshipId }) => relationshipId).sort(),
    temporalScope: {
      supportedDate: CERTIFICATION_DATE,
      precision: TEMPORAL_SUPPORT_DATE_PRECISION.DAY,
      basis: TEMPORAL_SUPPORT_DATE_BASIS.CERTIFICATION_DATE_INTERPRETED_AS_DATED_SUPPORT,
      explicitSourceEffectiveDateClaimId: null,
    },
    rationale: "I accept this dated certification as support for the depicted relationships on 5 May 2026. This is my recorded interpretation of the certification, not an explicit ownership-effective date quoted from the source, and not proof that the structure remained unchanged afterward.",
    limitations: [
      "SOURCE_SIGNER_IDENTITY_NOT_AUTHENTICATED",
      "SOURCE_SIGNER_AUTHORITY_NOT_VERIFIED",
      "SIGNATURE_MARK_NOT_AUTHENTICATED",
      "NO_CONTINUITY_AFTER_2026_05_05",
      "REVIEW_ONLY_NOT_PRODUCTION_AUTHORISED",
    ],
    signerAuthorityStatus: "UNRESOLVED",
  };
  const decided = application.applyDecisions({
    contractVersion: DECISION_APPLICATION_CONTRACT_VERSION_V3,
    caseState: verified.caseState,
    entityRegistrations: [],
    identityDecisions: [],
    claimAdjudications: [],
    sourceDecisionSnapshot: source.snapshot,
    temporalSupportReviews: [review],
  });
  const resolutionInputs = {
    ...clone(verified.resolutionInputs),
    evidenceClassifications: [evidenceClassification(decided.caseState)],
  };
  const evaluated = evaluate(application, decided, verified.caseContext, {
    evaluationTime: DATED_EVALUATION_AT,
    assessmentDate: CERTIFICATION_DATE,
    checkpoint: "CASE_EVENT",
    referenceId: `${FIXTURE_ID}:snapshot-c-dated-review`,
    resolutionInputs,
    decisionHistory: verified.decisionHistory,
    expectedHeadSnapshotId: source.snapshot.snapshotId,
    supersessionReason: "REVIEW_DECISION",
  });
  const assessment = evaluated.decisionSnapshot.decisionContent.temporalSupportAssessment;
  return clone({
    ...verified,
    stage: "DATED_REVIEW_APPLIED",
    caseState: evaluated.caseState,
    resolutionInputs,
    decisionHistory: evaluated.decisionHistory,
    snapshots: [...verified.snapshots, entry(3, "SNAPSHOT_C_DATED_CERTIFICATION_REVIEW", evaluated)],
    decisionTargets: evaluated.decisionTargets,
    temporalReview: {
      contractVersion: TEMPORAL_SUPPORT_REVIEW_V1,
      reviewId: review.reviewId,
      disposition: review.disposition,
      actor: review.reviewActor,
      decidedAt: review.decidedAt,
      assessmentDate: CERTIFICATION_DATE,
      sourceSnapshotId: source.snapshot.snapshotId,
      rationale: review.rationale,
      limitations: review.limitations,
      assessment,
    },
    decisionAudit: [
      ...verified.decisionAudit,
      { event: "TEMPORAL_SUPPORT_REVIEW_RECORDED", reviewId: review.reviewId, decidedAt: review.decidedAt, disposition: review.disposition },
      { event: "SNAPSHOT_C_CREATED", snapshotId: evaluated.decisionSnapshot.snapshotId, recordedAt: DATED_EVALUATION_AT, assessmentDate: CERTIFICATION_DATE },
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
  if (["SOURCE_FACTS_EXTRACTED", "SNAPSHOT_B", "DATED_REVIEW_APPLIED"].includes(value.stage)
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
function resetRuntimeForTest() { runtimeOperations.clear(); runtimeCounters.providerCalls = 0; runtimeCounters.reviewedFixtureRuns = 0; }

module.exports = Object.freeze({
  ENTITY_IDS,
  FIXTURE_ID,
  SESSION_VERSION,
  applyPreconfiguredFixtureDecisions,
  applyDatedCertificationReview,
  extractionRequest,
  resetRuntimeForTest,
  runtimeMetrics,
  startPreingestedEvidenceDemo,
  usePreingestedBettercommsArtifact,
  validateSession,
});
