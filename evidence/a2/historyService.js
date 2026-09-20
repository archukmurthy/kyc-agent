"use strict";

const { normalizeCompanyNumber } = require("./identity");
const { sha256 } = require("../a1/domain");

function camel(row, snake, key) { return row?.[key] === undefined ? row?.[snake] : row[key]; }
function mapAcquisition(row) { const metadata = camel(row, "producer_metadata", "producerMetadata") || {}; return { id: row.id, sourceArea: metadata.sourceArea, outcome: row.outcome, reason: camel(row, "outcome_reason", "outcomeReason"), source: camel(row, "source_locator", "sourceLocator"), metadata }; }
function mapAsset(row) { return { id: row.id, acquisitionId: camel(row, "acquisition_id", "acquisitionId"), subjectReferenceId: camel(row, "subject_reference_id", "subjectReferenceId"), evidenceType: camel(row, "evidence_type", "evidenceType"), title: row.title, accessClass: camel(row, "access_class", "accessClass"), observedAt: camel(row, "observed_at", "observedAt"), createdAt: camel(row, "created_at", "createdAt") }; }
function mapArtifact(row) { return { id: row.id, assetId: camel(row, "asset_id", "assetId"), representationType: camel(row, "representation_type", "representationType"), mediaType: camel(row, "media_type", "mediaType"), originalName: camel(row, "original_name", "originalName"), sizeBytes: Number(camel(row, "size_bytes", "sizeBytes")), fingerprintAlgorithm: camel(row, "fingerprint_algorithm", "fingerprintAlgorithm"), fingerprintValue: camel(row, "fingerprint_value", "fingerprintValue"), capturedAt: camel(row, "captured_at", "capturedAt"), artifactMetadata: camel(row, "artifact_metadata", "artifactMetadata") || {}, createdAt: camel(row, "created_at", "createdAt") }; }
function mapRun(row) { return { id: row.id, assetId: camel(row, "asset_id", "assetId"), artifactId: camel(row, "artifact_id", "artifactId"), extractorType: camel(row, "extractor_type", "extractorType"), extractorName: camel(row, "extractor_name", "extractorName"), extractorVersion: camel(row, "extractor_version", "extractorVersion"), schemaReference: camel(row, "schema_reference", "schemaReference"), status: row.status, startedAt: camel(row, "started_at", "startedAt"), completedAt: camel(row, "completed_at", "completedAt"), runMetadata: camel(row, "run_metadata", "runMetadata") || {} }; }
function mapValue(row) { return { id: row.id, extractionRunId: camel(row, "extraction_run_id", "extractionRunId"), schemaFieldId: camel(row, "schema_field_id", "schemaFieldId"), extractedValue: camel(row, "extracted_value", "extractedValue"), confidence: row.confidence, rawRepresentation: camel(row, "raw_representation", "rawRepresentation") }; }

class EvidenceCollectionHistoryService {
  constructor(repository, { artifactReader = null, now = () => new Date().toISOString() } = {}) { if (!repository?.findLatestReusableCollection || !repository?.hydrateReusableCollection) throw new Error("A2 history repository capabilities are required"); this.repository = repository; this.artifactReader = artifactReader; this.now = now; }
  async findLatestCompaniesHouse({ jurisdiction, companyNumber }) {
    if (jurisdiction !== "GB") throw new Error("Companies House jurisdiction must be GB"); const normalized = normalizeCompanyNumber(companyNumber);
    const found = await this.repository.findLatestReusableCollection({ producer: "companies_house", jurisdiction: "GB", companyNumber: normalized });
    if (!found) return { found: false, coordinates: { jurisdiction: "GB", companyNumber: normalized }, searchedAt: this.now() };
    const hydrated = await this.repository.hydrateReusableCollection(found.id); if (!hydrated) return { found: false, coordinates: { jurisdiction: "GB", companyNumber: normalized }, searchedAt: this.now() };
    const artifacts = hydrated.graph ? hydrated.graph.artifacts : hydrated.artifacts;
    return { found: true, summary: this.summarize(hydrated), inspection: { artifacts: await this.inspectArtifacts(artifacts) }, freshnessPolicyEvaluated: false, externalSourceCall: false, writesPerformed: false };
  }
  async inspectArtifacts(artifacts) {
    if (!this.artifactReader?.read) return {};
    const entries = await Promise.all(artifacts.map(async (artifact) => {
      try {
        const loaded = await this.artifactReader.read({
          id: artifact.id,
          mediaType: camel(artifact, "media_type", "mediaType"),
          storageProvider: camel(artifact, "storage_provider", "storageProvider"),
          storageKey: camel(artifact, "storage_key", "storageKey"),
          storageReference: camel(artifact, "storage_reference", "storageReference"),
          fixtureContent: camel(artifact, "fixture_content", "fixtureContent"),
        });
        const bytes = Buffer.from(loaded.bytes); const expected = camel(artifact, "fingerprint_value", "fingerprintValue");
        if (camel(artifact, "fingerprint_algorithm", "fingerprintAlgorithm") !== "sha256" || sha256(bytes) !== expected) throw new Error("integrity mismatch");
        const mediaType = String(camel(artifact, "media_type", "mediaType") || loaded.contentType || "application/octet-stream");
        if (mediaType.toLowerCase().startsWith("image/")) return [artifact.id, { kind: "image", content: bytes.toString("base64"), mediaType }];
        if (mediaType.toLowerCase().includes("html")) return [artifact.id, { kind: "html", content: bytes.toString("utf8"), mediaType }];
        if (mediaType.toLowerCase().includes("json")) return [artifact.id, { kind: "json", content: bytes.toString("utf8"), mediaType }];
        return [artifact.id, { kind: "unavailable", message: "This preserved representation is not previewable in Evidence Lab." }];
      } catch (_) { return [artifact.id, { kind: "unavailable", message: "The preserved Artifact could not be safely loaded or verified." }]; }
    }));
    return Object.fromEntries(entries);
  }
  summarize(data) {
    const collection = data.collection; const graph = data.graph;
    const acquisitions = graph ? graph.acquisitions : data.acquisitions; const assets = graph ? graph.assets : data.assets; const artifacts = graph ? graph.artifacts : data.artifacts; const runs = graph ? graph.extractionRuns : data.extractionRuns; const values = graph ? graph.extractedValues : data.extractedValues;
    const metadata = camel(collection, "producer_metadata", "producerMetadata") || {}; const coordinates = camel(collection, "collection_coordinates", "collectionCoordinates");
    const subject = graph ? graph.subjects[0] : collection.subject_reference_id ? { id: collection.subject_reference_id, subjectType: collection.subject_type, identifierScheme: collection.identifier_scheme, jurisdiction: collection.subject_jurisdiction, identifierValue: collection.identifier_value, displayName: collection.display_name, externalSystem: collection.external_system, externalReference: collection.external_reference } : null;
    return { collectionId: collection.id, producer: collection.producer, mode: collection.mode, coordinates, status: collection.status, structuredEvidenceStatus: metadata.structuredEvidenceStatus || null, humanViewableEvidenceStatus: metadata.humanViewableEvidenceStatus || null, startedAt: camel(collection, "started_at", "startedAt"), completedAt: camel(collection, "completed_at", "completedAt"), subject, acquisitions: acquisitions.map(mapAcquisition), assets: assets.map(mapAsset), artifacts: artifacts.map(mapArtifact), extractionRuns: runs.map(mapRun), extractedValues: values.map(mapValue), reopenedExisting: true };
  }
}

module.exports = { EvidenceCollectionHistoryService, mapAcquisition, mapArtifact, mapAsset, mapRun, mapValue };
