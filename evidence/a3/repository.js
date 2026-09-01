"use strict";

const { PostgresEvidenceRepository, buildInsert } = require("../a1/repository");
const { validateA3Bundle } = require("./domain");

const A3_TABLES = Object.freeze([
  ["runArtifacts", "evidence_extraction_run_artifacts", [["extraction_run_id", "extractionRunId"], ["artifact_id", "artifactId"], ["input_role", "inputRole"], ["created_at", "createdAt"]]],
  ["facts", "evidence_facts", [["id", "id"], ["extraction_run_id", "extractionRunId"], ["artifact_id", "artifactId"], ["information_need_id", "informationNeedId"], ["schema_field_id", "schemaFieldId"], ["semantic_concept_id", "semanticConceptId"], ["request_status", "requestStatus"], ["grounding_type", "groundingType"], ["fact_value", "factValue", "jsonb"], ["raw_representation", "rawRepresentation"], ["support_state", "supportState"], ["support_signals", "supportSignals", "jsonb"], ["source_policy_context", "sourcePolicyContext", "jsonb"], ["created_at", "createdAt"]]],
  ["factArtifactSupports", "evidence_fact_artifact_support", [["fact_id", "factId"], ["artifact_id", "artifactId"], ["created_at", "createdAt"]]],
  ["factArtifactLocators", "evidence_fact_artifact_locators", [["id", "id"], ["fact_id", "factId"], ["artifact_id", "artifactId"], ["locator_ordinal", "locatorOrdinal"], ["locator_kind", "locatorKind"], ["json_path", "jsonPath"], ["dom_reference", "domReference"], ["page_start", "pageStart"], ["page_end", "pageEnd"], ["support_excerpt", "supportExcerpt"], ["support_description", "supportDescription"], ["region", "region", "jsonb"], ["locator_metadata", "locatorMetadata", "jsonb"], ["created_at", "createdAt"]]],
  ["derivations", "evidence_fact_derivations", [["derived_fact_id", "derivedFactId"], ["input_fact_id", "inputFactId"], ["transformation_id", "transformationId"], ["transformation_version", "transformationVersion"], ["transformation_reference", "transformationReference"], ["derived_at", "derivedAt"], ["created_at", "createdAt"]]],
  ["verifications", "evidence_verification_attempts", [["id", "id"], ["target_extraction_run_id", "targetExtractionRunId"], ["target_fact_id", "targetFactId"], ["verification_extraction_run_id", "verificationExtractionRunId"], ["outcome", "outcome"], ["performed_at", "performedAt"], ["verification_metadata", "verificationMetadata", "jsonb"], ["created_at", "createdAt"]]],
]);

const RUN_LINEAGE_COLUMNS = ["execution_mode", "provider", "model_identifier", "instruction_reference", "extraction_context", "support_assessment", "error_code", "error_message"];

function rows(result) { return result?.rows || result || []; }

function mapArtifact(row) {
  if (!row) return null;
  return {
    id: row.artifact_id, assetId: row.asset_id, acquisitionId: row.acquisition_id,
    collectionId: row.collection_id, collectionProducer: row.collection_producer,
    representationType: row.representation_type, mediaType: row.media_type,
    storageProvider: row.storage_provider, storageKey: row.storage_key,
    storageReference: row.storage_reference, fixtureContent: row.fixture_content,
    sizeBytes: Number(row.size_bytes), fingerprintAlgorithm: row.fingerprint_algorithm,
    fingerprintValue: row.fingerprint_value, capturedAt: row.captured_at,
    artifactMetadata: row.artifact_metadata || {}, acquisitionMetadata: row.acquisition_metadata || {}, assetTitle: row.asset_title,
    evidenceType: row.evidence_type, accessClass: row.access_class,
    observedAt: row.observed_at, sourceType: row.source_type,
    sourceProvider: row.source_provider, sourceLocator: row.source_locator,
    acquisitionMethod: row.acquisition_method, tenantId: row.acquisition_tenant_id,
    contextId: row.context_id, subjectReferenceId: row.subject_reference_id,
    subjectDisplayName: row.subject_display_name, subjectIdentifier: row.subject_identifier,
    collectionCoordinates: row.collection_coordinates || null,
    authorized: !!row.authorized,
  };
}

class MemoryA3Repository {
  constructor() { this.bundles = []; }
  async persistBundle(bundle) { validateA3Bundle(bundle); this.bundles.push(structuredClone(bundle)); return { persisted: Object.fromEntries(A3_TABLES.map(([name]) => [name, (bundle[name] || []).length])) }; }
  latest() { return this.bundles.length ? structuredClone(this.bundles[this.bundles.length - 1]) : null; }
}

class PostgresA3Repository {
  constructor(db) { if (!db || typeof db.query !== "function") throw new Error("PostgresA3Repository requires db.query"); this.db = db; }
  async persistBundle(bundle) {
    validateA3Bundle(bundle);
    await new PostgresEvidenceRepository(this.db).persistGraph(bundle.baseGraph);
    for (const run of bundle.baseGraph.extractionRuns.filter((item) => item.executionMode)) {
      await this.db.query(`UPDATE evidence_extraction_runs SET execution_mode=$1, provider=$2, model_identifier=$3, instruction_reference=$4, extraction_context=$5::jsonb, support_assessment=$6::jsonb, error_code=$7, error_message=$8 WHERE id=$9`, [run.executionMode, run.provider || null, run.modelIdentifier || null, run.instructionReference || null, JSON.stringify(run.extractionContext || {}), JSON.stringify(run.supportAssessment || {}), run.errorCode || null, run.errorMessage || null, run.id]);
    }
    const persisted = {};
    for (const [name, table, columns] of A3_TABLES) {
      persisted[name] = 0;
      for (const row of bundle[name] || []) { const query = buildInsert(table, columns, row); await this.db.query(query.text, query.params); persisted[name] += 1; }
    }
    return { persisted };
  }
  async findArtifactForInterpretation({ artifactId, tenantId, contextId = null }) {
    const result = await this.db.query(`SELECT ar.id AS artifact_id, ar.asset_id, ar.representation_type, ar.media_type,
      ar.storage_provider, ar.storage_key, ar.storage_reference, ar.fixture_content, ar.size_bytes,
      ar.fingerprint_algorithm, ar.fingerprint_value, ar.captured_at, ar.artifact_metadata,
      a.acquisition_id, a.title AS asset_title, a.evidence_type, a.access_class, a.observed_at,
      ac.collection_operation_id AS collection_id, ac.source_type, ac.source_provider, ac.source_locator, ac.producer_metadata AS acquisition_metadata,
      ac.acquisition_method, ac.tenant_id AS acquisition_tenant_id, ac.context_id,
      a.subject_reference_id, s.display_name AS subject_display_name, s.identifier_value AS subject_identifier,
      co.producer AS collection_producer, co.collection_coordinates,
      (a.access_class = 'public' OR ($3::uuid IS NOT NULL AND ac.tenant_id = $2 AND ac.context_id = $3 AND EXISTS (
        SELECT 1 FROM evidence_asset_access_scopes scope
        WHERE scope.asset_id = a.id AND scope.tenant_id = $2 AND scope.context_id = $3
      ))) AS authorized
      FROM evidence_artifacts ar
      JOIN evidence_assets a ON a.id = ar.asset_id
      JOIN evidence_acquisitions ac ON ac.id = a.acquisition_id
      JOIN evidence_subject_references s ON s.id = a.subject_reference_id
      LEFT JOIN evidence_collection_operations co ON co.id = ac.collection_operation_id
      WHERE ar.id = $1`, [artifactId, tenantId, contextId]);
    return mapArtifact(rows(result)[0]);
  }
  async findDeterministicValues(artifactId) {
    const result = await this.db.query(`SELECT ev.schema_field_id, ev.extracted_value
      FROM evidence_extracted_values ev JOIN evidence_extraction_runs er ON er.id = ev.extraction_run_id
      WHERE er.artifact_id = $1 AND er.extractor_type = 'deterministic'`, [artifactId]);
    return rows(result).map((row) => ({ schemaFieldId: row.schema_field_id, extractedValue: row.extracted_value }));
  }
  async appendInterpretation({ run, runArtifacts = [], facts = [], factArtifactSupports = [], factArtifactLocators = [], derivations = [], verifications = [] }) {
    if (typeof this.db.transaction !== "function") throw new Error("Append interpretation requires transaction-capable db");
    return this.db.transaction(async (tx) => {
      let persistenceStage = "extraction_run";
      try {
      const baseColumns = [
        ["id", "id"], ["asset_id", "assetId"], ["artifact_id", "artifactId"], ["extractor_type", "extractorType"],
        ["extractor_name", "extractorName"], ["extractor_version", "extractorVersion"], ["schema_reference", "schemaReference"],
        ["schema_version_reference", "schemaVersionReference"], ["tenant_config_version", "tenantConfigVersion"], ["status", "status"],
        ["started_at", "startedAt"], ["completed_at", "completedAt"], ["run_metadata", "runMetadata", "jsonb"], ["created_at", "createdAt"],
        ["execution_mode", "executionMode"], ["provider", "provider"], ["model_identifier", "modelIdentifier"],
        ["instruction_reference", "instructionReference"], ["extraction_context", "extractionContext", "jsonb"],
        ["support_assessment", "supportAssessment", "jsonb"], ["error_code", "errorCode"], ["error_message", "errorMessage"],
      ];
      const runQuery = buildInsert("evidence_extraction_runs", baseColumns, run); await tx.query(runQuery.text, runQuery.params);
      const collections = { runArtifacts, facts, factArtifactSupports, factArtifactLocators, derivations, verifications };
      for (const [name, table, columns] of A3_TABLES) for (const row of collections[name]) { persistenceStage = name; const query = buildInsert(table, columns, row); await tx.query(query.text, query.params); }
      return { runId: run.id, persisted: { runArtifacts: runArtifacts.length, facts: facts.length, factArtifactSupports: factArtifactSupports.length, factArtifactLocators: factArtifactLocators.length, derivations: derivations.length, verifications: verifications.length } };
      } catch (error) {
        error.persistenceStage = error.persistenceStage || persistenceStage;
        throw error;
      }
    });
  }
  async listInterpretations(artifactId) {
    const runResult = await this.db.query(`SELECT DISTINCT r.* FROM evidence_extraction_runs r
      LEFT JOIN evidence_extraction_run_artifacts input ON input.extraction_run_id=r.id
      WHERE (r.artifact_id=$1 OR input.artifact_id=$1) AND r.execution_mode IS NOT NULL ORDER BY r.created_at`, [artifactId]);
    const factResult = await this.db.query(`SELECT DISTINCT f.* FROM evidence_facts f
      JOIN evidence_extraction_runs r ON r.id=f.extraction_run_id
      LEFT JOIN evidence_extraction_run_artifacts selected ON selected.extraction_run_id=r.id
      WHERE r.artifact_id=$1 OR selected.artifact_id=$1 ORDER BY f.created_at`, [artifactId]);
    const runArtifactResult = await this.db.query(`SELECT DISTINCT input.* FROM evidence_extraction_run_artifacts input
      JOIN evidence_extraction_runs r ON r.id=input.extraction_run_id
      LEFT JOIN evidence_extraction_run_artifacts selected ON selected.extraction_run_id=r.id
      WHERE r.artifact_id=$1 OR selected.artifact_id=$1 ORDER BY input.created_at, input.input_role, input.artifact_id`, [artifactId]);
    const supportResult = await this.db.query(`SELECT DISTINCT support.* FROM evidence_fact_artifact_support support
      JOIN evidence_facts f ON f.id=support.fact_id JOIN evidence_extraction_runs r ON r.id=f.extraction_run_id
      LEFT JOIN evidence_extraction_run_artifacts selected ON selected.extraction_run_id=r.id
      WHERE r.artifact_id=$1 OR selected.artifact_id=$1 ORDER BY support.created_at, support.artifact_id`, [artifactId]);
    const locatorResult = await this.db.query(`SELECT DISTINCT locator.* FROM evidence_fact_artifact_locators locator
      JOIN evidence_facts f ON f.id=locator.fact_id JOIN evidence_extraction_runs r ON r.id=f.extraction_run_id
      LEFT JOIN evidence_extraction_run_artifacts selected ON selected.extraction_run_id=r.id
      WHERE r.artifact_id=$1 OR selected.artifact_id=$1 ORDER BY locator.created_at, locator.fact_id, locator.artifact_id, locator.locator_ordinal`, [artifactId]);
    const inputArtifactResult = await this.db.query(`SELECT DISTINCT ar.id, ar.asset_id, ar.representation_type, ar.media_type, ar.size_bytes,
      ar.fingerprint_algorithm, ar.fingerprint_value, ar.captured_at, ar.artifact_metadata
      FROM evidence_artifacts ar JOIN evidence_extraction_run_artifacts input ON input.artifact_id=ar.id
      JOIN evidence_extraction_runs r ON r.id=input.extraction_run_id
      LEFT JOIN evidence_extraction_run_artifacts selected ON selected.extraction_run_id=r.id
      WHERE r.artifact_id=$1 OR selected.artifact_id=$1`, [artifactId]);
    return { runs: rows(runResult), facts: rows(factResult), runArtifacts: rows(runArtifactResult), factArtifactSupports: rows(supportResult), factArtifactLocators: rows(locatorResult), inputArtifacts: rows(inputArtifactResult) };
  }
}

module.exports = { A3_TABLES, MemoryA3Repository, PostgresA3Repository, RUN_LINEAGE_COLUMNS, mapArtifact };
