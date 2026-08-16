"use strict";

const { validateEvidenceGraph } = require("./domain");

const TABLES = Object.freeze([
  ["subjects", "evidence_subject_references", [
    ["id", "id"], ["subject_type", "subjectType"], ["identifier_scheme", "identifierScheme"],
    ["jurisdiction", "jurisdiction"], ["identifier_value", "identifierValue"], ["display_name", "displayName"],
    ["external_system", "externalSystem"], ["external_reference", "externalReference"], ["created_at", "createdAt"],
  ]],
  ["contexts", "evidence_contexts", [
    ["id", "id"], ["tenant_id", "tenantId"], ["context_type", "contextType"],
    ["external_context_reference", "externalContextReference"], ["subject_reference_id", "subjectReferenceId"], ["created_at", "createdAt"],
  ]],
  ["requirements", "evidence_requirements", [
    ["id", "id"], ["context_id", "contextId"], ["subject_reference_id", "subjectReferenceId"],
    ["requirement_key", "requirementKey"], ["description", "description"], ["status", "status"], ["created_at", "createdAt"],
  ]],
  ["informationNeeds", "evidence_requirement_information_needs", [
    ["id", "id"], ["requirement_id", "requirementId"], ["schema_reference", "schemaReference"],
    ["schema_version_reference", "schemaVersionReference"], ["tenant_config_version", "tenantConfigVersion"],
    ["schema_field_id", "schemaFieldId"], ["created_at", "createdAt"],
  ]],
  ["acquisitions", "evidence_acquisitions", [
    ["id", "id"], ["context_id", "contextId"], ["tenant_id", "tenantId"],
    ["subject_reference_id", "subjectReferenceId"], ["source_type", "sourceType"], ["source_provider", "sourceProvider"],
    ["acquisition_method", "acquisitionMethod"], ["actor_type", "actorType"], ["actor_id", "actorId"],
    ["outcome", "outcome"], ["outcome_reason", "outcomeReason"], ["source_locator", "sourceLocator"],
    ["started_at", "startedAt"], ["completed_at", "completedAt"], ["producer_metadata", "producerMetadata", "jsonb"],
    ["created_at", "createdAt"],
  ]],
  ["assets", "evidence_assets", [
    ["id", "id"], ["acquisition_id", "acquisitionId"], ["subject_reference_id", "subjectReferenceId"],
    ["evidence_type", "evidenceType"], ["title", "title"], ["access_class", "accessClass"],
    ["observed_at", "observedAt"], ["created_at", "createdAt"],
  ]],
  ["accessScopes", "evidence_asset_access_scopes", [
    ["asset_id", "assetId"], ["tenant_id", "tenantId"], ["context_id", "contextId"], ["created_at", "createdAt"],
  ]],
  ["artifacts", "evidence_artifacts", [
    ["id", "id"], ["asset_id", "assetId"], ["representation_type", "representationType"], ["media_type", "mediaType"],
    ["original_name", "originalName"], ["storage_provider", "storageProvider"], ["storage_key", "storageKey"],
    ["storage_reference", "storageReference"], ["fixture_content", "fixtureContent"], ["size_bytes", "sizeBytes"],
    ["fingerprint_algorithm", "fingerprintAlgorithm"], ["fingerprint_value", "fingerprintValue"],
    ["captured_at", "capturedAt"], ["artifact_metadata", "artifactMetadata", "jsonb"], ["created_at", "createdAt"],
  ]],
  ["requirementAssets", "evidence_requirement_assets", [
    ["requirement_id", "requirementId"], ["asset_id", "assetId"], ["associated_context_id", "associatedContextId"],
    ["associated_at", "associatedAt"],
  ]],
  ["extractionRuns", "evidence_extraction_runs", [
    ["id", "id"], ["asset_id", "assetId"], ["artifact_id", "artifactId"], ["extractor_type", "extractorType"],
    ["extractor_name", "extractorName"], ["extractor_version", "extractorVersion"], ["schema_reference", "schemaReference"],
    ["schema_version_reference", "schemaVersionReference"], ["tenant_config_version", "tenantConfigVersion"],
    ["status", "status"], ["started_at", "startedAt"], ["completed_at", "completedAt"],
    ["run_metadata", "runMetadata", "jsonb"], ["created_at", "createdAt"],
  ]],
  ["extractedValues", "evidence_extracted_values", [
    ["id", "id"], ["extraction_run_id", "extractionRunId"], ["schema_field_id", "schemaFieldId"],
    ["extracted_value", "extractedValue", "jsonb"], ["confidence", "confidence"],
    ["raw_representation", "rawRepresentation"], ["created_at", "createdAt"],
  ]],
]);

function buildInsert(table, columns, row) {
  const params = [];
  const placeholders = columns.map(([, key, type], index) => {
    const value = row[key] === undefined ? null : row[key];
    params.push(type === "jsonb" && value !== null ? JSON.stringify(value) : value);
    return `$${index + 1}${type === "jsonb" ? "::jsonb" : ""}`;
  });
  return {
    text: `INSERT INTO ${table} (${columns.map(([column]) => column).join(", ")}) VALUES (${placeholders.join(", ")}) ON CONFLICT DO NOTHING`,
    params,
  };
}

class MemoryEvidenceRepository {
  constructor() {
    this.graphs = [];
  }

  async persistGraph(graph) {
    validateEvidenceGraph(graph);
    this.graphs.push(structuredClone(graph));
    return { persisted: Object.fromEntries(TABLES.map(([collection]) => [collection, graph[collection].length])) };
  }

  latest() {
    return this.graphs.length ? structuredClone(this.graphs[this.graphs.length - 1]) : null;
  }
}

class PostgresEvidenceRepository {
  constructor(db) {
    if (!db || typeof db.query !== "function") throw new Error("PostgresEvidenceRepository requires db.query");
    this.db = db;
  }

  async persistGraph(graph) {
    validateEvidenceGraph(graph);
    const persisted = {};
    for (const [collection, table, columns] of TABLES) {
      persisted[collection] = 0;
      for (const row of graph[collection]) {
        const query = buildInsert(table, columns, row);
        await this.db.query(query.text, query.params);
        persisted[collection] += 1;
      }
    }
    return { persisted };
  }
}

module.exports = { MemoryEvidenceRepository, PostgresEvidenceRepository, TABLES, buildInsert };
