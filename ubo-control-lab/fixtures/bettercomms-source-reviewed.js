"use strict";

const IDS = Object.freeze({
  context: "90000000-0000-4000-8000-000000000001",
  subject: "90000000-0000-4000-8000-000000000002",
  asset: "90000000-0000-4000-8000-000000000003",
  artifact: "90000000-0000-4000-8000-000000000004",
  operation: "90000000-0000-4000-8000-000000000005",
  run: "90000000-0000-4000-8000-000000000006",
});

const FACT_IDS = Object.freeze({
  mitchellOwnership: "91000000-0000-4000-8000-000000000001",
  leeOwnership: "91000000-0000-4000-8000-000000000002",
  commsOwnership: "91000000-0000-4000-8000-000000000003",
  networkOwnership: "91000000-0000-4000-8000-000000000004",
  mitchellOfficer: "91000000-0000-4000-8000-000000000005",
  leeOfficer: "91000000-0000-4000-8000-000000000006",
  signerName: "92000000-0000-4000-8000-000000000001",
  signerPostnominal: "92000000-0000-4000-8000-000000000002",
  signerCapacity: "92000000-0000-4000-8000-000000000003",
  professionalReference: "92000000-0000-4000-8000-000000000004",
  certificationDate: "92000000-0000-4000-8000-000000000005",
  declaration: "92000000-0000-4000-8000-000000000006",
  declarationScope: "92000000-0000-4000-8000-000000000007",
  signaturePresence: "92000000-0000-4000-8000-000000000008",
});

const DIGEST = "37ec3f984451c0a0bf1ac0024e9790070d7cb3a90dc25696052e0f1583fa2f6f";
const SIZE_BYTES = 582094;
const DIMENSIONS = Object.freeze({ width: 841, height: 595 });
const REVIEW_RECORDED_AT = "2026-09-13T13:30:00.000Z";
const CERTIFICATION_DATE = "2026-05-05";
const ARTIFACT_LABEL = "Ownership chart-Bettercomms.png — source-backed reviewed fixture";
const DOCUMENT_PARTY = Object.freeze({
  partyType: "legal_entity",
  name: "Better Comms VOIP Ltd",
  description: "Regulated subject whose depicted company structure is certified by the source document",
  jurisdiction: "GB",
  identifiers: [],
});

const HISTORICAL_LEADS = Object.freeze({
  status: "REPORTED_NOT_REVALIDATED",
  contextIssue: "Historical screen places the upload under TESCO PLC — evidence_lab; Bettercomms tenant/context authority is not established.",
  artifactId: "f3b768a9-4f34-4fae-9743-d33220a99f0a",
  laterOperationId: "8c4aa135-9b87-437b-946e-992bb460000d",
  laterRunId: "ad15b4fd-23c0-42b6-8cff-b153f9671409",
  earlierOperationId: "a2d00123-9512-4eea-b63d-9119f941f657",
  earlierRunId: "ab3f23ed-745d-4895-a567-818632430bc9",
});

const WINDOWS = Object.freeze({
  signerName: Object.freeze({ x: 20, y: 443, width: 190, height: 32 }),
  signerCapacity: Object.freeze({ x: 20, y: 472, width: 285, height: 28 }),
  certificationDate: Object.freeze({ x: 20, y: 497, width: 205, height: 28 }),
  professionalReference: Object.freeze({ x: 20, y: 520, width: 215, height: 29 }),
  declaration: Object.freeze({ x: 20, y: 541, width: 505, height: 31 }),
  signaturePresence: Object.freeze({ x: 135, y: 563, width: 180, height: 32 }),
});

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function party(partyType, name) { return { partyType, name, jurisdiction: "GB", identifiers: [] }; }
function locator(id, ordinal, description, excerpt, region) {
  return {
    id,
    artifactId: IDS.artifact,
    ordinal,
    kind: "image",
    jsonPath: null,
    domReference: null,
    pageStart: null,
    pageEnd: null,
    excerpt,
    description,
    region: { ...region, coordinateSystem: "original_pixels" },
    metadata: {
      qualified: true,
      qualification: "NEW_MANUAL_REVIEW_ANNOTATION_NOT_HISTORICAL_R3_LOCATOR",
      limitations: ["Visual transcription only", "Original raster coordinates", "No signer authentication"],
      coordinateSystem: "original_pixels",
      originalDimensions: DIMENSIONS,
      mimeType: "image/png",
    },
  };
}

function relationshipFact(id, ordinal, concept, subject, relationshipType, object, value, description, region) {
  return {
    id,
    artifactId: IDS.artifact,
    supportingArtifactIds: [IDS.artifact],
    semanticConceptId: concept,
    value: value.kind === "EXACT" ? `${value.exact}%` : value.qualitative,
    requestRelation: concept === "economic_ownership" ? "requested_concept_response" : "supplemental_discovery",
    persistedRequestStatus: "discovered",
    groundingType: "manual_visual_review",
    supportState: "supported",
    supportLocators: [locator(`93000000-0000-4000-8000-00000000000${ordinal}`, ordinal, description, description, region)],
    createdAt: REVIEW_RECORDED_AT,
    typedRelationship: {
      factId: id,
      schemaVersion: "evidence-relationship-v1",
      relationshipType,
      subject,
      object,
      value,
      temporal: { state: "unknown", effectiveFrom: null, effectiveTo: null, sourceEffectiveDate: null, precision: {} },
      qualifications: relationshipType === "OFFICER_OF"
        ? ["ordinary_officer_title_only"]
        : ["economic_interest_concept:SHARE_OWNERSHIP"],
      mapping: {
        method: "manual_source_review_fixture",
        id: "bettercomms-source-review",
        version: "1",
        reference: "pr60-recovered-source-handoff",
      },
      createdAt: REVIEW_RECORDED_AT,
    },
  };
}

function certificationFact(id, ordinal, concept, attribute, text, region, extras = {}) {
  return {
    id,
    artifactId: IDS.artifact,
    supportingArtifactIds: [IDS.artifact],
    semanticConceptId: concept,
    value: {
      statementType: "SOURCE_CERTIFICATION_METADATA",
      subject: DOCUMENT_PARTY,
      attribute,
      text,
      sourceReadingStatus: "MANUALLY_REVIEWED",
      authenticationState: "NOT_VERIFIED",
      ...clone(extras),
    },
    requestRelation: "supplemental_discovery",
    persistedRequestStatus: "fixture_only_not_persisted",
    groundingType: "manual_visual_review",
    supportState: "supported_with_limitations",
    supportLocators: [locator(`94000000-0000-4000-8000-00000000000${ordinal}`, ordinal + 6, `Certification block: ${attribute}`, text, region)],
    createdAt: REVIEW_RECORDED_AT,
  };
}

function artifact() {
  return {
    id: IDS.artifact,
    assetId: IDS.asset,
    collectionId: "pr60-source-reviewed-fixture-collection",
    representationType: "original_image",
    mediaType: "image/png",
    sizeBytes: SIZE_BYTES,
    assetTitle: ARTIFACT_LABEL,
    evidenceType: "ownership_chart",
    accessClass: "controlled_local_review_fixture",
    tenantId: "tenant-bettercomms-review-fixture",
    contextId: IDS.context,
    subjectReferenceId: IDS.subject,
    subjectDisplayName: "Better Comms VOIP Ltd",
    sourceType: "source_backed_manual_review_fixture",
    sourceProvider: "control_room_recovery_handoff",
    fingerprintAlgorithm: "sha256",
    fingerprintValue: DIGEST,
    storageKey: "fixture-reference-only-no-source-bytes",
  };
}

function sourceCertification() {
  return clone({
    signerName: "Alex Palmer",
    signerPostnominal: "ACA",
    signerCapacity: "Management Accountant",
    professionalReference: { label: "ACA No", value: "5246593" },
    certificationDate: CERTIFICATION_DATE,
    declarationText: "I hereby certify that the company structure chart is true, correct and accurate",
    declarationScope: "Depicted company structure chart",
    signatureMark: { present: true, authenticated: false, characterization: "Visible signature-like mark" },
    explicitOwnershipAsAtDate: null,
    signerIdentityVerified: false,
    signerAuthorityVerified: false,
    professionalStatusVerification: "NOT_VERIFIED",
    coveredFactIds: [FACT_IDS.mitchellOwnership, FACT_IDS.leeOwnership, FACT_IDS.commsOwnership, FACT_IDS.networkOwnership],
    reviewWindows: WINDOWS,
  });
}

function buildBettercommsServiceResult(evidenceRequest) {
  const mitchell = party("natural_person", "Mitchell Fortescue");
  const lee = party("natural_person", "Lee Taylor");
  const holdco = party("legal_entity", "Better Holdco");
  const comms = party("legal_entity", "Better Comms VOIP Ltd");
  const network = party("legal_entity", "Better Network Services");
  const exact = (value) => ({ kind: "EXACT", measurementType: "percentage", exact: value, unit: "percentage_points" });
  const relationships = [
    relationshipFact(FACT_IDS.mitchellOwnership, 1, "economic_ownership", mitchell, "ECONOMIC_OWNERSHIP", holdco, exact(75), "Mitchell Fortescue owns 75% of Better Holdco", { x: 185, y: 82, width: 290, height: 132 }),
    relationshipFact(FACT_IDS.leeOwnership, 2, "economic_ownership", lee, "ECONOMIC_OWNERSHIP", holdco, exact(25), "Lee Taylor owns 25% of Better Holdco", { x: 420, y: 82, width: 242, height: 132 }),
    relationshipFact(FACT_IDS.commsOwnership, 3, "economic_ownership", holdco, "ECONOMIC_OWNERSHIP", comms, exact(100), "Better Holdco owns 100% of Better Comms VOIP Ltd", { x: 178, y: 211, width: 338, height: 226 }),
    relationshipFact(FACT_IDS.networkOwnership, 4, "economic_ownership", holdco, "ECONOMIC_OWNERSHIP", network, exact(100), "Better Holdco owns 100% of Better Network Services", { x: 331, y: 211, width: 336, height: 226 }),
    relationshipFact(FACT_IDS.mitchellOfficer, 5, "officer_relationship", mitchell, "OFFICER_OF", holdco, { kind: "QUALITATIVE", measurementType: "qualitative", qualitative: "Managing Director", unit: null }, "Mitchell Fortescue is described as Managing Director", { x: 185, y: 82, width: 186, height: 96 }),
    relationshipFact(FACT_IDS.leeOfficer, 6, "officer_relationship", lee, "OFFICER_OF", holdco, { kind: "QUALITATIVE", measurementType: "qualitative", qualitative: "Commercial Director", unit: null }, "Lee Taylor is described as Commercial Director", { x: 476, y: 82, width: 186, height: 96 }),
  ];
  const certification = [
    certificationFact(FACT_IDS.signerName, 1, "certification_signer_name", "certification_signer_name", "Alex Palmer", WINDOWS.signerName, { statedIdentityOnly: true }),
    certificationFact(FACT_IDS.signerPostnominal, 2, "certification_signer_postnominal", "certification_signer_postnominal", "ACA", WINDOWS.signerName, { professionalStatusVerification: "NOT_VERIFIED" }),
    certificationFact(FACT_IDS.signerCapacity, 3, "certification_signer_capacity", "certification_signer_capacity", "Management Accountant", WINDOWS.signerCapacity, { authorityVerified: false }),
    certificationFact(FACT_IDS.professionalReference, 4, "certification_professional_reference", "certification_professional_reference", "ACA No: 5246593", WINDOWS.professionalReference, { label: "ACA No", referenceValue: "5246593", professionalStatusVerification: "NOT_VERIFIED" }),
    certificationFact(FACT_IDS.certificationDate, 5, "certification_date", "certification_date", "05/05/2026", WINDOWS.certificationDate, { normalizedDate: CERTIFICATION_DATE, explicitOwnershipAsAtDate: null }),
    certificationFact(FACT_IDS.declaration, 6, "certification_declaration", "certification_declaration", "I hereby certify that the company structure chart is true, correct and accurate", WINDOWS.declaration, { addsCompletenessWording: false, explicitCurrentTodayWording: false }),
    certificationFact(FACT_IDS.declarationScope, 7, "certification_scope", "certification_scope", "Depicted company structure chart", WINDOWS.declaration, { coveredFactIds: sourceCertification().coveredFactIds, scopeDerivedByManualReview: true }),
    certificationFact(FACT_IDS.signaturePresence, 8, "certification_signature_presence", "certification_signature_presence", "Visible signature-like mark", WINDOWS.signaturePresence, { signatureAuthenticated: false, cryptographicValidationPerformed: false }),
  ];
  return {
    replayed: false,
    operation: { id: IDS.operation, key: evidenceRequest.operationKey, status: "completed", outcome: "completed", startedAt: REVIEW_RECORDED_AT, completedAt: REVIEW_RECORDED_AT },
    extractionRun: { id: IDS.run, status: "completed", startedAt: REVIEW_RECORDED_AT, completedAt: REVIEW_RECORDED_AT, provider: "manual-review-fixture", model: "none", instructionReference: "pr60-recovered-source-review-v1" },
    evidence: {
      assetId: IDS.asset,
      artifacts: [artifact()],
      integrity: { verified: true, artifacts: [{ artifactId: IDS.artifact, verified: true, calculatedSha256: DIGEST, algorithm: "sha256" }] },
    },
    requestedConceptOutcomes: [{ concept: "economic_ownership", status: "found" }],
    responsiveFacts: relationships.slice(0, 4),
    discoveredFacts: [...relationships.slice(4), ...certification],
    completeness: { input: { state: "complete", limitations: [] }, extraction: { state: "complete", limitations: ["Manually reviewed fixture; no automated interpretation performed"] } },
    limitations: [],
    typedRelationshipCount: 6,
    correlation: clone(evidenceRequest.correlation),
    downstreamEvaluation: "not_performed",
    providerCalled: false,
  };
}

module.exports = Object.freeze({
  ARTIFACT_LABEL,
  CERTIFICATION_DATE,
  DIGEST,
  DIMENSIONS,
  FACT_IDS,
  HISTORICAL_LEADS,
  IDS,
  REVIEW_RECORDED_AT,
  SIZE_BYTES,
  WINDOWS,
  artifact,
  buildBettercommsServiceResult,
  sourceCertification,
});
