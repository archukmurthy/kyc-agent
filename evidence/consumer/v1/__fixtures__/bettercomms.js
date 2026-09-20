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

function party(partyType, name) { return { partyType, name, jurisdiction: "GB", identifiers: [] }; }
function locator(ordinal, description) { return { id: `20000000-0000-4000-8000-00000000000${ordinal}`, artifactId: IDS.artifact, ordinal, kind: "image", jsonPath: null, domReference: null, pageStart: null, pageEnd: null, excerpt: null, description, region: null, metadata: { qualified: true, coordinateSystem: "artifact-level" } }; }
function fact(index, concept, subject, relationshipType, object, value) {
  const id = `30000000-0000-4000-8000-00000000000${index}`;
  return {
    id, artifactId: IDS.artifact, supportingArtifactIds: [IDS.artifact], semanticConceptId: concept,
    value: value.kind === "EXACT" ? `${value.exact}%` : value.qualitative,
    requestRelation: "requested_concept_response", persistedRequestStatus: "discovered", groundingType: "direct", supportState: "supported",
    supportLocators: [locator(index, `${subject.name} ${relationshipType} ${object.name}`)], createdAt: AT,
    typedRelationship: {
      factId: id, schemaVersion: "evidence-relationship-v1", relationshipType, subject, object, value,
      temporal: { state: "unknown", effectiveFrom: null, effectiveTo: null, sourceEffectiveDate: null, precision: {} },
      qualifications: [], mapping: { method: "provider_structured", id: "fixture-r4-validator", version: "1", reference: "evidence-r4-fixture-v1" }, createdAt: AT,
    },
  };
}

function buildBettercommsServiceResult() {
  const mitchell = party("natural_person", "Mitchell Fortescue");
  const lee = party("natural_person", "Lee Taylor");
  const holdco = party("legal_entity", "Better Holdco");
  const comms = party("legal_entity", "Better Comms VOIP Ltd");
  const network = party("legal_entity", "Better Network Services");
  const facts = [
    fact(1, "economic_ownership", mitchell, "ECONOMIC_OWNERSHIP", holdco, { kind: "EXACT", measurementType: "percentage", exact: 75, unit: "percentage_points" }),
    fact(2, "economic_ownership", lee, "ECONOMIC_OWNERSHIP", holdco, { kind: "EXACT", measurementType: "percentage", exact: 25, unit: "percentage_points" }),
    fact(3, "economic_ownership", holdco, "ECONOMIC_OWNERSHIP", comms, { kind: "EXACT", measurementType: "percentage", exact: 100, unit: "percentage_points" }),
    fact(4, "economic_ownership", holdco, "ECONOMIC_OWNERSHIP", network, { kind: "EXACT", measurementType: "percentage", exact: 100, unit: "percentage_points" }),
    fact(5, "officer_relationship", mitchell, "OFFICER_OF", holdco, { kind: "QUALITATIVE", measurementType: "qualitative", qualitative: "Managing Director", unit: null }),
    fact(6, "officer_relationship", lee, "OFFICER_OF", holdco, { kind: "QUALITATIVE", measurementType: "qualitative", qualitative: "Commercial Director", unit: null }),
  ];
  return {
    replayed: false,
    operation: { id: IDS.operation, key: "fixture-bettercomms-v1", status: "completed", outcome: "completed", startedAt: AT, completedAt: AT },
    extractionRun: { id: IDS.run, status: "completed", startedAt: AT, completedAt: AT, provider: "deterministic-contract-fixture", model: "fixture-v1", instructionReference: "evidence-consumer-v1-fixture" },
    evidence: { assetId: IDS.asset, artifacts: [{ id: IDS.artifact, assetId: IDS.asset, representationType: "original_image", mediaType: "image/png", sizeBytes: 4096, capturedAt: AT, order: 1, inputRole: "primary" }], integrity: { verified: true, artifacts: [{ artifactId: IDS.artifact, verified: true, calculatedSha256: DIGEST, algorithm: "sha256" }] } },
    requestedConceptOutcomes: [{ concept: "economic_ownership", status: "found" }, { concept: "officer_relationship", status: "found" }],
    responsiveFacts: facts, discoveredFacts: [], completeness: { input: { state: "complete", limitations: [] }, extraction: { state: "complete", limitations: [] } },
    limitations: [], typedRelationshipCount: 6, correlation: { requestId: "fixture-request" }, downstreamEvaluation: "not_performed", providerCalled: true,
  };
}

module.exports = { AT, DIGEST, IDS, buildBettercommsServiceResult };
