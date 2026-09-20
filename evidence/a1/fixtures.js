"use strict";

const { sha256, validateEvidenceGraph } = require("./domain");

const ids = Object.freeze({
  subject: "10000000-0000-4000-8000-000000000001",
  contextMay: "20000000-0000-4000-8000-000000000001",
  contextAugust: "20000000-0000-4000-8000-000000000002",
  contextReuse: "20000000-0000-4000-8000-000000000003",
  contextUpload: "20000000-0000-4000-8000-000000000004",
  requirementMay: "30000000-0000-4000-8000-000000000001",
  requirementAugust: "30000000-0000-4000-8000-000000000002",
  requirementReuse: "30000000-0000-4000-8000-000000000003",
  requirementUpload: "30000000-0000-4000-8000-000000000004",
  acquisitionFailed: "40000000-0000-4000-8000-000000000001",
  acquisitionInconclusive: "40000000-0000-4000-8000-000000000002",
  acquisitionMay: "40000000-0000-4000-8000-000000000003",
  acquisitionAugust: "40000000-0000-4000-8000-000000000004",
  acquisitionUpload: "40000000-0000-4000-8000-000000000005",
  assetMayProfile: "50000000-0000-4000-8000-000000000001",
  assetAugustProfile: "50000000-0000-4000-8000-000000000002",
  assetAugustOfficers: "50000000-0000-4000-8000-000000000003",
  assetPublicDocument: "50000000-0000-4000-8000-000000000004",
  assetCustomerDocument: "50000000-0000-4000-8000-000000000005",
  artifactMayJson: "60000000-0000-4000-8000-000000000001",
  artifactAugustJson: "60000000-0000-4000-8000-000000000002",
  artifactAugustScreenshot: "60000000-0000-4000-8000-000000000003",
  artifactPublicDocument: "60000000-0000-4000-8000-000000000004",
  artifactCustomerDocument: "60000000-0000-4000-8000-000000000005",
  runMay: "70000000-0000-4000-8000-000000000001",
  runAugustPrimary: "70000000-0000-4000-8000-000000000002",
  runAugustIndependent: "70000000-0000-4000-8000-000000000003",
});

const needFields = ["business_name", "registration_number", "company_status", "incorporation_date", "registered_address_line1"];

function informationNeeds(requirementId, prefix, fields = needFields) {
  return fields.map((field, index) => ({
    id: `${prefix}-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    requirementId,
    schemaReference: "FI:uk-licence",
    schemaVersionReference: null,
    tenantConfigVersion: 1,
    schemaFieldId: field,
    createdAt: "2026-05-01T09:00:00.000Z",
  }));
}

function artifact({ id, assetId, representationType, mediaType, content, capturedAt, originalName }) {
  const bytes = Buffer.from(content);
  return {
    id, assetId, representationType, mediaType, originalName: originalName || null,
    storageProvider: "fixture", storageKey: null, storageReference: `fixture://${id}`,
    fixtureContent: bytes, sizeBytes: bytes.length, fingerprintAlgorithm: "sha256",
    fingerprintValue: sha256(bytes), capturedAt, artifactMetadata: {}, createdAt: capturedAt,
  };
}

function buildA1FixtureGraph() {
  const may = "2026-05-01T10:00:00.000Z";
  const august = "2026-08-01T10:00:00.000Z";
  const identicalDocument = "IDENTICAL-DOCUMENT-BYTES";
  const graph = {
    subjects: [{
      id: ids.subject, subjectType: "company", identifierScheme: "company_registration_number",
      jurisdiction: "GB", identifierValue: "12345678", displayName: "ABC Limited",
      externalSystem: "companies_house", externalReference: "12345678", createdAt: may,
    }],
    contexts: [
      { id: ids.contextMay, tenantId: "nium", contextType: "evidence_lab", externalContextReference: "may-review", subjectReferenceId: ids.subject, createdAt: may },
      { id: ids.contextAugust, tenantId: "nium", contextType: "evidence_lab", externalContextReference: "august-review", subjectReferenceId: ids.subject, createdAt: august },
      { id: ids.contextReuse, tenantId: "acme", contextType: "evidence_lab", externalContextReference: "reuse-review", subjectReferenceId: ids.subject, createdAt: august },
      { id: ids.contextUpload, tenantId: "nium", contextType: "customer_upload_fixture", externalContextReference: "upload-review", subjectReferenceId: ids.subject, createdAt: august },
    ],
    requirements: [
      { id: ids.requirementMay, contextId: ids.contextMay, subjectReferenceId: ids.subject, requirementKey: "verify_company_registration", description: "Verify company registration details", status: "open", createdAt: may },
      { id: ids.requirementAugust, contextId: ids.contextAugust, subjectReferenceId: ids.subject, requirementKey: "verify_company_registration", description: "Verify company registration details", status: "open", createdAt: august },
      { id: ids.requirementReuse, contextId: ids.contextReuse, subjectReferenceId: ids.subject, requirementKey: "verify_company_registration", description: "Verify company registration details", status: "open", createdAt: august },
      { id: ids.requirementUpload, contextId: ids.contextUpload, subjectReferenceId: ids.subject, requirementKey: "verify_operating_address", description: "Verify operating address", status: "open", createdAt: august },
    ],
    informationNeeds: [
      ...informationNeeds(ids.requirementMay, "81000000"),
      ...informationNeeds(ids.requirementAugust, "82000000"),
      ...informationNeeds(ids.requirementReuse, "83000000"),
      ...informationNeeds(ids.requirementUpload, "84000000", ["operating_address"]),
    ],
    acquisitions: [
      { id: ids.acquisitionFailed, contextId: ids.contextAugust, tenantId: "nium", subjectReferenceId: ids.subject, sourceType: "public_registry", sourceProvider: "Companies House", acquisitionMethod: "fixture", actorType: "system", actorId: "evidence-lab", outcome: "failed", outcomeReason: "timeout", sourceLocator: "https://find-and-update.company-information.service.gov.uk/company/12345678", startedAt: "2026-08-01T09:00:00.000Z", completedAt: "2026-08-01T09:00:05.000Z", producerMetadata: {}, createdAt: "2026-08-01T09:00:00.000Z" },
      { id: ids.acquisitionInconclusive, contextId: ids.contextAugust, tenantId: "nium", subjectReferenceId: ids.subject, sourceType: "public_registry", sourceProvider: "Companies House", acquisitionMethod: "fixture", actorType: "system", actorId: "evidence-lab", outcome: "inconclusive", outcomeReason: "entity could not be identified confidently", sourceLocator: null, startedAt: "2026-08-01T09:10:00.000Z", completedAt: "2026-08-01T09:10:01.000Z", producerMetadata: {}, createdAt: "2026-08-01T09:10:00.000Z" },
      { id: ids.acquisitionMay, contextId: ids.contextMay, tenantId: "nium", subjectReferenceId: ids.subject, sourceType: "public_registry", sourceProvider: "Companies House", acquisitionMethod: "fixture", actorType: "system", actorId: "evidence-lab", outcome: "successful", outcomeReason: null, sourceLocator: "https://find-and-update.company-information.service.gov.uk/company/12345678", startedAt: may, completedAt: may, producerMetadata: {}, createdAt: may },
      { id: ids.acquisitionAugust, contextId: ids.contextAugust, tenantId: "nium", subjectReferenceId: ids.subject, sourceType: "public_registry", sourceProvider: "Companies House", acquisitionMethod: "fixture", actorType: "system", actorId: "evidence-lab", outcome: "successful", outcomeReason: null, sourceLocator: "https://find-and-update.company-information.service.gov.uk/company/12345678", startedAt: august, completedAt: august, producerMetadata: {}, createdAt: august },
      { id: ids.acquisitionUpload, contextId: ids.contextUpload, tenantId: "nium", subjectReferenceId: ids.subject, sourceType: "customer_document", sourceProvider: "customer", acquisitionMethod: "customer_upload_fixture", actorType: "customer", actorId: "fixture-customer", outcome: "successful", outcomeReason: null, sourceLocator: null, startedAt: august, completedAt: august, producerMetadata: {}, createdAt: august },
    ],
    assets: [
      { id: ids.assetMayProfile, acquisitionId: ids.acquisitionMay, subjectReferenceId: ids.subject, evidenceType: "company_profile", title: "Companies House company profile (May)", accessClass: "public", observedAt: may, createdAt: may },
      { id: ids.assetAugustProfile, acquisitionId: ids.acquisitionAugust, subjectReferenceId: ids.subject, evidenceType: "company_profile", title: "Companies House company profile (August)", accessClass: "public", observedAt: august, createdAt: august },
      { id: ids.assetAugustOfficers, acquisitionId: ids.acquisitionAugust, subjectReferenceId: ids.subject, evidenceType: "officers", title: "Companies House officers", accessClass: "public", observedAt: august, createdAt: august },
      { id: ids.assetPublicDocument, acquisitionId: ids.acquisitionAugust, subjectReferenceId: ids.subject, evidenceType: "incorporation_document", title: "Registry incorporation document", accessClass: "public", observedAt: august, createdAt: august },
      { id: ids.assetCustomerDocument, acquisitionId: ids.acquisitionUpload, subjectReferenceId: ids.subject, evidenceType: "proof_of_address", title: "Customer utility bill", accessClass: "context_restricted", observedAt: august, createdAt: august },
    ],
    accessScopes: [{ assetId: ids.assetCustomerDocument, tenantId: "nium", contextId: ids.contextUpload, createdAt: august }],
    artifacts: [
      artifact({ id: ids.artifactMayJson, assetId: ids.assetMayProfile, representationType: "structured_json", mediaType: "application/json", content: JSON.stringify({ registered_address_line1: "10 High Street" }), capturedAt: may }),
      artifact({ id: ids.artifactAugustJson, assetId: ids.assetAugustProfile, representationType: "structured_json", mediaType: "application/json", content: JSON.stringify({ registered_address_line1: "25 King Street" }), capturedAt: august }),
      artifact({ id: ids.artifactAugustScreenshot, assetId: ids.assetAugustProfile, representationType: "screenshot", mediaType: "image/png", content: "fixture screenshot showing 17 Queen Street", capturedAt: august }),
      artifact({ id: ids.artifactPublicDocument, assetId: ids.assetPublicDocument, representationType: "pdf", mediaType: "application/pdf", content: identicalDocument, capturedAt: august, originalName: "incorporation.pdf" }),
      artifact({ id: ids.artifactCustomerDocument, assetId: ids.assetCustomerDocument, representationType: "pdf", mediaType: "application/pdf", content: identicalDocument, capturedAt: august, originalName: "utility-bill.pdf" }),
    ],
    requirementAssets: [
      { requirementId: ids.requirementMay, assetId: ids.assetMayProfile, associatedContextId: ids.contextMay, associatedAt: may },
      { requirementId: ids.requirementAugust, assetId: ids.assetAugustProfile, associatedContextId: ids.contextAugust, associatedAt: august },
      { requirementId: ids.requirementReuse, assetId: ids.assetAugustProfile, associatedContextId: ids.contextReuse, associatedAt: august },
      { requirementId: ids.requirementUpload, assetId: ids.assetCustomerDocument, associatedContextId: ids.contextUpload, associatedAt: august },
    ],
    extractionRuns: [
      { id: ids.runMay, assetId: ids.assetMayProfile, artifactId: ids.artifactMayJson, extractorType: "deterministic", extractorName: "fixture-json", extractorVersion: "a1", schemaReference: "FI:uk-licence", schemaVersionReference: null, tenantConfigVersion: 1, status: "completed", startedAt: may, completedAt: may, runMetadata: {}, createdAt: may },
      { id: ids.runAugustPrimary, assetId: ids.assetAugustProfile, artifactId: ids.artifactAugustJson, extractorType: "deterministic", extractorName: "fixture-json", extractorVersion: "a1", schemaReference: "FI:uk-licence", schemaVersionReference: null, tenantConfigVersion: 1, status: "completed", startedAt: august, completedAt: august, runMetadata: {}, createdAt: august },
      { id: ids.runAugustIndependent, assetId: ids.assetAugustProfile, artifactId: ids.artifactAugustScreenshot, extractorType: "independent_fixture", extractorName: "fixture-screenshot", extractorVersion: "a1", schemaReference: "FI:uk-licence", schemaVersionReference: null, tenantConfigVersion: 1, status: "completed", startedAt: "2026-08-01T11:00:00.000Z", completedAt: "2026-08-01T11:00:00.000Z", runMetadata: {}, createdAt: "2026-08-01T11:00:00.000Z" },
    ],
    extractedValues: [
      { id: "90000000-0000-4000-8000-000000000001", extractionRunId: ids.runMay, schemaFieldId: "registered_address_line1", extractedValue: "10 High Street", confidence: 1, rawRepresentation: "10 High Street", createdAt: may },
      { id: "90000000-0000-4000-8000-000000000002", extractionRunId: ids.runAugustPrimary, schemaFieldId: "registered_address_line1", extractedValue: "25 King Street", confidence: 1, rawRepresentation: "25 King Street", createdAt: august },
      { id: "90000000-0000-4000-8000-000000000003", extractionRunId: ids.runAugustIndependent, schemaFieldId: "registered_address_line1", extractedValue: "17 Queen Street", confidence: 0.8, rawRepresentation: "17 Queen Street", createdAt: "2026-08-01T11:00:00.000Z" },
    ],
  };
  return validateEvidenceGraph(graph);
}

function summarizeA1Fixture(graph = buildA1FixtureGraph()) {
  const outcomeCounts = Object.fromEntries(["successful", "failed", "inconclusive"].map((outcome) => [outcome, graph.acquisitions.filter((a) => a.outcome === outcome).length]));
  const customerAsset = graph.assets.find((asset) => asset.id === ids.assetCustomerDocument);
  const publicArtifact = graph.artifacts.find((item) => item.id === ids.artifactPublicDocument);
  const privateArtifact = graph.artifacts.find((item) => item.id === ids.artifactCustomerDocument);
  return {
    stage: "A1",
    subject: graph.subjects[0],
    requirementInformationNeeds: graph.informationNeeds.filter((n) => n.requirementId === ids.requirementAugust).map((n) => n.schemaFieldId),
    acquisitionOutcomes: outcomeCounts,
    assetsFromAugustAcquisition: graph.assets.filter((a) => a.acquisitionId === ids.acquisitionAugust).map((a) => a.evidenceType),
    augustProfileArtifactTypes: graph.artifacts.filter((a) => a.assetId === ids.assetAugustProfile).map((a) => a.representationType),
    recollection: ["10 High Street", "25 King Street"],
    independentExtractions: graph.extractedValues.filter((v) => [ids.runAugustPrimary, ids.runAugustIndependent].includes(v.extractionRunId)).map((v) => v.extractedValue),
    publicReuseContextCount: graph.requirementAssets.filter((link) => link.assetId === ids.assetAugustProfile).length,
    privateEvidence: { accessClass: customerAsset.accessClass, scopeCount: graph.accessScopes.filter((s) => s.assetId === customerAsset.id).length },
    identicalFingerprintSeparateProvenance: publicArtifact.fingerprintValue === privateArtifact.fingerprintValue && publicArtifact.assetId !== privateArtifact.assetId,
    schemaVersionReference: graph.extractionRuns[0].schemaVersionReference,
  };
}

module.exports = { buildA1FixtureGraph, ids, summarizeA1Fixture };
