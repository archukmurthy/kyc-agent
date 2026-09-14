"use strict";

const { createHash } = require("node:crypto");
const { CONTRACT_VERSIONS, createEvidenceConsumer } = require("../../evidence/consumer/v1");
const { createEvidencePlatformExtractionAdapter } = require("../../integrations/ubo-control/evidence-platform-extraction");

const AT = "2026-09-14T09:00:00.000Z";
const REVIEW_AT = "2026-09-14T09:02:00.000Z";
const RESPONSE_AT = "2026-09-14T09:05:00.000Z";
const ARTIFACT_ID = "a1000000-0000-4000-8000-000000000004";
const ASSET_ID = "a1000000-0000-4000-8000-000000000003";
const CONTEXT_ID = "a1000000-0000-4000-8000-000000000001";
const SUBJECT_REFERENCE_ID = "a1000000-0000-4000-8000-000000000002";
const DIGEST = createHash("sha256").update("UAJ-01 source-reviewed ownership fixture; no document bytes").digest("hex");

const SCENARIOS = Object.freeze([
  {
    scenarioId: "UAJ-01-HYBRID-ANSWER",
    label: "Named gap — answer in the journey",
    description: "Research finds Alice's direct 10% and Overseas HoldCo's 30%; the applicant supplies Alice's 60% upstream interest.",
    responseMode: "STRUCTURED_ANSWER",
    company: { name: "Adaptive Customer Limited", registrationNumber: "UAJ00001", jurisdiction: "GB" },
  },
  {
    scenarioId: "UAJ-01-HYBRID-ARTIFACT",
    label: "Named gap — use an existing ownership document",
    description: "The same named gap is answered from an already-authorised, source-reviewed Evidence Artifact reference.",
    responseMode: "EXISTING_ARTIFACT",
    company: { name: "Adaptive Customer Limited", registrationNumber: "UAJ00002", jurisdiction: "GB" },
  },
  {
    scenarioId: "UAJ-01-BOUNDED-RESEARCH",
    label: "Named gap — bounded research",
    description: "Research reveals an accessible HoldCo; the pinned plan permits one bounded follow-up research operation for that entity.",
    responseMode: "BOUNDED_RESEARCH",
    company: { name: "Adaptive Customer Limited", registrationNumber: "UAJ00005", jurisdiction: "GB" },
  },
  {
    scenarioId: "UAJ-01-CONFIRM",
    label: "Supported structure — confirm only",
    description: "Research establishes a supported current structure; the least-burdensome path is confirmation, not a chart request.",
    responseMode: "CONFIRMATION",
    company: { name: "Supported Structure Limited", registrationNumber: "UAJ00003", jurisdiction: "GB" },
  },
  {
    scenarioId: "UAJ-01-CONTRADICTION",
    label: "Contradictory document — scoped review",
    description: "A source-reviewed document disagrees with the researched upstream percentage; both assertions remain separate for review.",
    responseMode: "CONTRADICTORY_ARTIFACT",
    company: { name: "Adaptive Customer Limited", registrationNumber: "UAJ00004", jurisdiction: "GB" },
  },
]);

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function scenarioById(scenarioId) {
  const scenario = SCENARIOS.find((item) => item.scenarioId === scenarioId);
  if (!scenario) throw new TypeError("Unknown UAJ-01 scenario");
  return clone(scenario);
}
function evidence(referenceId, referenceType = "SANITIZED_TEST_ASSERTION") {
  return { system: "ubo-adaptive-journey-source-reviewed-fixture", referenceType, referenceId };
}
function party(entityId, name, entityType = "COMPANY") {
  return { entityId, name, entityType, ...(entityType === "COMPANY" ? { jurisdiction: "GB" } : {}), externalIdentifiers: [] };
}
function relationship(factId, subject, object, relationshipType, value) {
  return {
    factId,
    type: "RELATIONSHIP",
    subject,
    relationship: relationshipType,
    object,
    ...(value === null ? {} : { measurement: { type: "EXACT", value } }),
    qualifiers: {
      currentState: relationshipType === "SIGNIFICANT_INFLUENCE_OR_CONTROL" ? "UNKNOWN" : "CURRENT",
      ...(relationshipType === "ECONOMIC_OWNERSHIP" ? { economicInterestConcept: "SHARE_OWNERSHIP" } : {}),
    },
    evidenceReferences: [evidence(factId)],
  };
}

function fixtureParties(subject) {
  return {
    target: clone(subject),
    alice: party("uaj-alice", "Alice", "NATURAL_PERSON"),
    holdco: party("uaj-overseas-holdco", "Overseas HoldCo"),
  };
}

function initialFacts(scenario, subject) {
  const parties = fixtureParties(subject);
  if (scenario.responseMode === "CONFIRMATION") {
    return [
      relationship("uaj-confirm-alice-target-100", parties.alice, parties.target, "ECONOMIC_OWNERSHIP", 100),
      relationship("uaj-confirm-alice-control", parties.alice, parties.target, "SIGNIFICANT_INFLUENCE_OR_CONTROL", null),
    ];
  }
  const facts = [
    relationship("uaj-research-alice-target-10", parties.alice, parties.target, "ECONOMIC_OWNERSHIP", 10),
    relationship("uaj-research-holdco-target-30", parties.holdco, parties.target, "ECONOMIC_OWNERSHIP", 30),
  ];
  if (scenario.responseMode === "CONTRADICTORY_ARTIFACT") {
    facts.push(relationship("uaj-research-alice-holdco-60", parties.alice, parties.holdco, "ECONOMIC_OWNERSHIP", 60));
  }
  return facts;
}

function createFixtureDiscoveryService(scenario) {
  const requests = [];
  return Object.freeze({
    requests,
    async discover(request) {
      requests.push(clone(request));
      const targetedHoldco = request.subject?.entityId === "uaj-overseas-holdco";
      const parties = fixtureParties(request.subject);
      return {
        contractVersion: "1.0.0",
        requestId: request.requestId,
        outcome: { state: "COMPLETE" },
        candidateFacts: targetedHoldco
          ? [relationship("uaj-research-alice-holdco-60", parties.alice, parties.target, "ECONOMIC_OWNERSHIP", 60)]
          : initialFacts(scenario, request.subject),
        operationEvidenceReferences: [evidence(`${scenario.scenarioId}:initial-research`)],
        issues: [],
      };
    },
  });
}

function rawArtifact() {
  return {
    id: ARTIFACT_ID,
    assetId: ASSET_ID,
    collectionId: "uaj-01-source-reviewed-fixture",
    representationType: "reviewed_structured_fixture",
    mediaType: "application/json",
    sizeBytes: 0,
    capturedAt: AT,
    assetTitle: "UAJ-01 reviewed upstream ownership statement",
    evidenceType: "ownership_chart",
    accessClass: "context_restricted",
    tenantId: "tenant-uaj-review",
    contextId: CONTEXT_ID,
    subjectReferenceId: SUBJECT_REFERENCE_ID,
    subjectDisplayName: "Adaptive Customer Limited",
    fingerprintAlgorithm: "sha256",
    fingerprintValue: DIGEST,
  };
}

function evidenceFact(request, value, contradiction) {
  const factId = contradiction ? "uaj-artifact-alice-holdco-40" : "uaj-artifact-alice-holdco-60";
  return {
    id: factId,
    artifactId: ARTIFACT_ID,
    supportingArtifactIds: [ARTIFACT_ID],
    semanticConceptId: "economic_ownership",
    value: `${value}%`,
    requestRelation: "requested_concept_response",
    persistedRequestStatus: "discovered",
    groundingType: "direct",
    supportState: "supported",
    supportLocators: [{
      id: `${factId}:locator`,
      artifactId: ARTIFACT_ID,
      ordinal: 1,
      kind: "reviewed_fixture_row",
      description: `Alice holds ${value}% of Overseas HoldCo`,
      metadata: { qualified: true, limitations: contradiction ? ["CONTRADICTS_RESEARCHED_PERCENTAGE"] : [] },
    }],
    createdAt: RESPONSE_AT,
    typedRelationship: {
      factId,
      schemaVersion: "evidence-relationship-v1",
      relationshipType: "ECONOMIC_OWNERSHIP",
      subject: { partyType: "natural_person", name: "Alice", jurisdiction: "GB", identifiers: [] },
      object: { partyType: "legal_entity", name: "Overseas HoldCo", jurisdiction: "GB", identifiers: [] },
      value: { kind: "EXACT", measurementType: "percentage", exact: value, unit: "percentage_points" },
      temporal: { state: "current", effectiveFrom: null, effectiveTo: null, sourceEffectiveDate: RESPONSE_AT, precision: {} },
      qualifications: contradiction ? ["contradicts_researched_assertion"] : [],
      mapping: { method: "manual_source_reviewed_fixture", id: "uaj-01-fixture-mapper", version: "1", reference: "UAJ-01" },
      createdAt: RESPONSE_AT,
    },
  };
}

function serviceResult(evidenceRequest, contradiction) {
  const value = contradiction ? 40 : 60;
  return {
    replayed: false,
    operation: { id: "uaj-evidence-operation-1", key: evidenceRequest.operationKey, status: "completed", outcome: "completed", startedAt: RESPONSE_AT, completedAt: RESPONSE_AT },
    extractionRun: { id: "uaj-evidence-run-1", status: "completed", startedAt: RESPONSE_AT, completedAt: RESPONSE_AT, provider: "manual-source-reviewed-fixture", model: "not_applicable", instructionReference: "UAJ-01-FIXTURE" },
    evidence: { assetId: ASSET_ID, artifacts: [rawArtifact()], integrity: { verified: true, artifacts: [{ artifactId: ARTIFACT_ID, verified: true, calculatedSha256: DIGEST, algorithm: "sha256" }] } },
    requestedConceptOutcomes: [{ concept: "economic_ownership", status: "found" }],
    responsiveFacts: [evidenceFact(evidenceRequest, value, contradiction)],
    discoveredFacts: [],
    completeness: { input: { state: "complete", limitations: [] }, extraction: { state: "complete", limitations: contradiction ? ["CONTRADICTS_RESEARCHED_ASSERTION"] : [] } },
    limitations: contradiction ? [{ code: "CONTRADICTS_RESEARCHED_ASSERTION" }] : [],
    typedRelationshipCount: 1,
    correlation: clone(evidenceRequest.correlation),
    downstreamEvaluation: "not_performed",
    providerCalled: false,
  };
}

function createFixtureExtractionService({ contradiction = false } = {}) {
  const interpretationService = {
    async resolve({ artifactIds }) {
      if (artifactIds.length !== 1 || artifactIds[0] !== ARTIFACT_ID) throw Object.assign(new Error("not found"), { code: "artifact_not_found" });
      return [rawArtifact()];
    },
    async interpret(request) { return serviceResult(request, contradiction); },
    async history() { return { providerCalled: false, operations: [] }; },
  };
  const evidenceConsumer = createEvidenceConsumer({
    interpretationService,
    reconstructionService: { async reconstructEvidence() { throw new Error("not used in UAJ-01"); } },
    packageService: {
      async listAuthorizedPackages() { throw new Error("not used in UAJ-01"); },
      async reopenPackage() { throw new Error("not used in UAJ-01"); },
      async verifyPackageManifest() { throw new Error("not used in UAJ-01"); },
    },
  });
  return createEvidencePlatformExtractionAdapter({
    evidenceConsumer,
    trustedAuthorizationProvider: async () => ({
      contractVersion: CONTRACT_VERSIONS.trustedAuthorization,
      tenantId: "tenant-uaj-review",
      contextId: CONTEXT_ID,
      callerScope: "ubo:uaj-01-review-lab",
      actorType: "service",
      actorId: "trusted-uaj-lab-composition",
      subjectReferenceId: SUBJECT_REFERENCE_ID,
    }),
  });
}

function catalogue() {
  return {
    contractVersion: "ubo-adaptive-journey-fixture-catalogue-v1",
    sourceMode: "SOURCE_REVIEWED_FIXTURE",
    fixtures: SCENARIOS.map(({ scenarioId, label, description, responseMode, company }) => ({ scenarioId, label, description, responseMode, company })),
    sourceReviewedArtifact: { system: "evidence-platform-v1", referenceType: "ARTIFACT", referenceId: ARTIFACT_ID, digest: DIGEST, bytesPresent: false },
  };
}

module.exports = Object.freeze({
  ARTIFACT_ID,
  AT,
  DIGEST,
  RESPONSE_AT,
  REVIEW_AT,
  catalogue,
  createFixtureDiscoveryService,
  createFixtureExtractionService,
  fixtureParties,
  scenarioById,
});
