"use strict";

const IDS = Object.freeze({
  context: "10000000-0000-4000-8000-000000000001",
  subject: "10000000-0000-4000-8000-000000000002",
  asset: "10000000-0000-4000-8000-000000000003",
  artifact: "10000000-0000-4000-8000-000000000004",
  operation: "10000000-0000-4000-8000-000000000005",
  run: "10000000-0000-4000-8000-000000000006",
});
const DIGEST = "6b3f5c40e341873a62d906718986833f32ea050c2946cfc55c6cf3c001a81983";
const AT = "2026-09-08T10:00:00.000Z";
const ARTIFACT_LABEL = "Bettercomms ownership chart";

function party(partyType, name) {
  return { partyType, name, jurisdiction: "GB", identifiers: [] };
}

function locator(ordinal, description) {
  return {
    id: `20000000-0000-4000-8000-00000000000${ordinal}`,
    artifactId: IDS.artifact,
    ordinal,
    kind: "image",
    jsonPath: null,
    domReference: null,
    pageStart: null,
    pageEnd: null,
    excerpt: null,
    description,
    region: null,
    metadata: { qualified: true, coordinateSystem: "artifact-level" },
  };
}

function fact(index, concept, subject, relationshipType, object, value) {
  const id = `30000000-0000-4000-8000-00000000000${index}`;
  return {
    id,
    artifactId: IDS.artifact,
    supportingArtifactIds: [IDS.artifact],
    semanticConceptId: concept,
    value: value.kind === "EXACT" ? `${value.exact}%` : value.qualitative,
    requestRelation: "requested_concept_response",
    persistedRequestStatus: "discovered",
    groundingType: "direct",
    supportState: "supported",
    supportLocators: [locator(index, `${subject.name} ${relationshipType} ${object.name}`)],
    createdAt: AT,
    typedRelationship: {
      factId: id,
      schemaVersion: "evidence-relationship-v1",
      relationshipType,
      subject,
      object,
      value,
      temporal: {
        state: "unknown",
        effectiveFrom: null,
        effectiveTo: null,
        sourceEffectiveDate: null,
        precision: {},
      },
      qualifications: relationshipType === "OFFICER_OF"
        ? ["ordinary_officer_title_only"]
        : ["economic_interest_concept:SHARE_OWNERSHIP"],
      mapping: {
        method: "provider_structured",
        id: "fixture-r4-validator",
        version: "1",
        reference: "evidence-r4-fixture-v1",
      },
      createdAt: AT,
    },
  };
}

function artifact() {
  return {
    id: IDS.artifact,
    assetId: IDS.asset,
    collectionId: "bettercomms-authorized-fixture-collection",
    representationType: "original_image",
    mediaType: "image/png",
    sizeBytes: 4096,
    capturedAt: AT,
    assetTitle: ARTIFACT_LABEL,
    evidenceType: "ownership_chart",
    accessClass: "context_restricted",
    tenantId: "tenant-bettercomms",
    contextId: IDS.context,
    subjectReferenceId: IDS.subject,
    subjectDisplayName: "Better Comms VOIP Ltd",
    fingerprintAlgorithm: "sha256",
    fingerprintValue: DIGEST,
    storageKey: "fixture-storage-key-never-exposed",
  };
}

function buildBettercommsServiceResult(evidenceRequest) {
  const mitchell = party("natural_person", "Mitchell Fortescue");
  const lee = party("natural_person", "Lee Taylor");
  const holdco = party("legal_entity", "Better Holdco");
  const comms = party("legal_entity", "Better Comms VOIP Ltd");
  const network = party("legal_entity", "Better Network Services");
  const exact = (value) => ({ kind: "EXACT", measurementType: "percentage", exact: value, unit: "percentage_points" });
  const facts = [
    fact(1, "economic_ownership", mitchell, "ECONOMIC_OWNERSHIP", holdco, exact(75)),
    fact(2, "economic_ownership", lee, "ECONOMIC_OWNERSHIP", holdco, exact(25)),
    fact(3, "economic_ownership", holdco, "ECONOMIC_OWNERSHIP", comms, exact(100)),
    fact(4, "economic_ownership", holdco, "ECONOMIC_OWNERSHIP", network, exact(100)),
    fact(5, "officer_relationship", mitchell, "OFFICER_OF", holdco, { kind: "QUALITATIVE", measurementType: "qualitative", qualitative: "Managing Director", unit: null }),
    fact(6, "officer_relationship", lee, "OFFICER_OF", holdco, { kind: "QUALITATIVE", measurementType: "qualitative", qualitative: "Commercial Director", unit: null }),
  ];
  return {
    replayed: false,
    operation: { id: IDS.operation, key: evidenceRequest.operationKey, status: "completed", outcome: "completed", startedAt: AT, completedAt: AT },
    extractionRun: { id: IDS.run, status: "completed", startedAt: AT, completedAt: AT, provider: "deterministic-contract-fixture", model: "fixture-v1", instructionReference: "evidence-consumer-v1-fixture" },
    evidence: {
      assetId: IDS.asset,
      artifacts: [artifact()],
      integrity: { verified: true, artifacts: [{ artifactId: IDS.artifact, verified: true, calculatedSha256: DIGEST, algorithm: "sha256" }] },
    },
    requestedConceptOutcomes: [{ concept: "economic_ownership", status: "found" }],
    responsiveFacts: facts.slice(0, 4),
    discoveredFacts: facts.slice(4),
    completeness: { input: { state: "complete", limitations: [] }, extraction: { state: "complete", limitations: [] } },
    limitations: [],
    typedRelationshipCount: 6,
    correlation: structuredClone(evidenceRequest.correlation),
    downstreamEvaluation: "not_performed",
    providerCalled: true,
  };
}

module.exports = Object.freeze({ ARTIFACT_LABEL, AT, DIGEST, IDS, artifact, buildBettercommsServiceResult });
