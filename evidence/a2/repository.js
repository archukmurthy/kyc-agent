"use strict";

const { TABLES, buildInsert } = require("../a1/repository");

const COLLECTION_COLUMNS = [
  ["id", "id"], ["producer", "producer"], ["producer_request_key", "producerRequestKey"],
  ["subject_reference_id", "subjectReferenceId"], ["collection_coordinates", "collectionCoordinates", "jsonb"],
  ["mode", "mode"], ["status", "status"], ["started_at", "startedAt"], ["completed_at", "completedAt"],
  ["failure_reason", "failureReason"], ["producer_metadata", "producerMetadata", "jsonb"], ["created_at", "createdAt"],
];

function resultRows(result) { return result?.rows || result || []; }
function coordinateValue(collection) { return collection.collectionCoordinates || collection.collection_coordinates || {}; }

function a2Tables() {
  return TABLES.map(([collection, table, columns]) => collection === "acquisitions"
    ? [collection, table, [...columns, ["collection_operation_id", "collectionOperationId"]]]
    : [collection, table, columns]);
}

class MemoryA2Repository {
  constructor() { this.collections = new Map(); this.graphs = new Map(); }
  async find(producer, key) { return this.collections.get(`${producer}|${key}`) || null; }
  async begin(collection) {
    const key = `${collection.producer}|${collection.producerRequestKey}`;
    if (!this.collections.has(key)) this.collections.set(key, structuredClone({ ...collection, status: "running" }));
    return structuredClone(this.collections.get(key));
  }
  async markPersistenceFailure(collection, error) {
    const key = `${collection.producer}|${collection.producerRequestKey}`;
    this.collections.set(key, structuredClone({ ...collection, status: "running", failureReason: error.message, producerMetadata: { ...(collection.producerMetadata || {}), persistenceFailure: error.message } }));
  }
  async persist(collection, graph) {
    const key = `${collection.producer}|${collection.producerRequestKey}`;
    if (this.graphs.has(key)) return { collection: structuredClone(this.collections.get(key)), graph: structuredClone(this.graphs.get(key)), replayed: true };
    this.collections.set(key, structuredClone(collection));
    this.graphs.set(key, structuredClone(graph));
    return { collection: structuredClone(collection), graph: structuredClone(graph), replayed: false };
  }
  async findLatestReusableCollection({ producer, jurisdiction, companyNumber }) {
    const candidates = [...this.collections.values()].filter((collection) => {
      const coordinates = coordinateValue(collection); const graph = this.graphs.get(`${collection.producer}|${collection.producerRequestKey}`);
      return collection.producer === producer && collection.mode === "live" && ["successful", "partial"].includes(collection.status)
        && coordinates.jurisdiction === jurisdiction && coordinates.companyNumber === companyNumber
        && !!graph?.assets.some((asset) => asset.accessClass === "public" && graph.artifacts.some((artifact) => artifact.assetId === asset.id));
    });
    candidates.sort((a, b) => String(b.completedAt || b.createdAt).localeCompare(String(a.completedAt || a.createdAt)));
    return candidates[0] ? structuredClone(candidates[0]) : null;
  }
  async hydrateReusableCollection(collectionId) {
    const entry = [...this.collections.entries()].find(([, collection]) => collection.id === collectionId); if (!entry) return null;
    const collection = structuredClone(entry[1]); const graph = structuredClone(this.graphs.get(entry[0])); if (!graph) return null;
    const publicAssetIds = new Set(graph.assets.filter((asset) => asset.accessClass === "public").map((asset) => asset.id));
    graph.assets = graph.assets.filter((asset) => publicAssetIds.has(asset.id)); graph.artifacts = graph.artifacts.filter((artifact) => publicAssetIds.has(artifact.assetId));
    const artifactIds = new Set(graph.artifacts.map((artifact) => artifact.id)); graph.extractionRuns = graph.extractionRuns.filter((run) => artifactIds.has(run.artifactId));
    const runIds = new Set(graph.extractionRuns.map((run) => run.id)); graph.extractedValues = graph.extractedValues.filter((value) => runIds.has(value.extractionRunId));
    return { collection, graph };
  }
}

class PostgresA2Repository {
  constructor(db) { if (!db || typeof db.transaction !== "function") throw new Error("transaction-capable db is required"); this.db = db; }
  async find(producer, key) {
    const rows = await this.db.query("SELECT * FROM evidence_collection_operations WHERE producer = $1 AND producer_request_key = $2", [producer, key]);
    return rows.rows?.[0] || rows[0] || null;
  }
  async begin(collection) {
    const query = buildInsert("evidence_collection_operations", COLLECTION_COLUMNS, { ...collection, status: "running" });
    await this.db.query(query.text, query.params);
    return this.find(collection.producer, collection.producerRequestKey);
  }
  async markPersistenceFailure(collection, error) {
    await this.db.query(
      "UPDATE evidence_collection_operations SET status='running', failure_reason=$1, producer_metadata=$2::jsonb WHERE producer=$3 AND producer_request_key=$4",
      [error.message, JSON.stringify({ ...(collection.producerMetadata || {}), persistenceFailure: error.message }), collection.producer, collection.producerRequestKey]
    );
  }
  async persist(collection, graph) {
    return this.db.transaction(async (tx) => {
      for (const [name, table, columns] of a2Tables()) {
        for (const row of graph[name]) {
          const query = buildInsert(table, columns, row);
          await tx.query(query.text, query.params);
        }
      }
      await tx.query(
        "UPDATE evidence_collection_operations SET subject_reference_id=$1, status=$2, completed_at=$3, failure_reason=$4, producer_metadata=$5::jsonb WHERE producer=$6 AND producer_request_key=$7",
        [collection.subjectReferenceId, collection.status, collection.completedAt, collection.failureReason, JSON.stringify(collection.producerMetadata || {}), collection.producer, collection.producerRequestKey]
      );
      return { collection, graph, replayed: false };
    });
  }
  async findLatestReusableCollection({ producer, jurisdiction, companyNumber }) {
    const result = await this.db.query(`SELECT co.* FROM evidence_collection_operations co
      WHERE co.producer=$1 AND co.mode='live' AND co.status IN ('successful','partial')
        AND co.collection_coordinates->>'jurisdiction'=$2
        AND UPPER(co.collection_coordinates->>'companyNumber')=$3
        AND EXISTS (SELECT 1 FROM evidence_acquisitions ac
          JOIN evidence_assets a ON a.acquisition_id=ac.id AND a.access_class='public'
          JOIN evidence_artifacts ar ON ar.asset_id=a.id
          WHERE ac.collection_operation_id=co.id)
      ORDER BY co.completed_at DESC NULLS LAST, co.created_at DESC LIMIT 1`, [producer, jurisdiction, companyNumber]);
    return resultRows(result)[0] || null;
  }
  async hydrateReusableCollection(collectionId) {
    const collectionResult = await this.db.query(`SELECT co.*, s.subject_type, s.identifier_scheme, s.jurisdiction AS subject_jurisdiction,
      s.identifier_value, s.display_name, s.external_system, s.external_reference
      FROM evidence_collection_operations co LEFT JOIN evidence_subject_references s ON s.id=co.subject_reference_id
      WHERE co.id=$1 AND co.mode='live' AND co.status IN ('successful','partial')`, [collectionId]);
    const collection = resultRows(collectionResult)[0]; if (!collection) return null;
    const acquisitions = resultRows(await this.db.query("SELECT * FROM evidence_acquisitions WHERE collection_operation_id=$1 ORDER BY created_at", [collectionId]));
    const assets = resultRows(await this.db.query(`SELECT a.* FROM evidence_assets a JOIN evidence_acquisitions ac ON ac.id=a.acquisition_id
      WHERE ac.collection_operation_id=$1 AND a.access_class='public' ORDER BY a.created_at`, [collectionId]));
    const artifacts = resultRows(await this.db.query(`SELECT ar.id, ar.asset_id, ar.representation_type, ar.media_type, ar.original_name,
      ar.storage_provider, ar.storage_key, ar.storage_reference, ar.fixture_content,
      ar.size_bytes, ar.fingerprint_algorithm, ar.fingerprint_value, ar.captured_at, ar.artifact_metadata, ar.created_at
      FROM evidence_artifacts ar JOIN evidence_assets a ON a.id=ar.asset_id JOIN evidence_acquisitions ac ON ac.id=a.acquisition_id
      WHERE ac.collection_operation_id=$1 AND a.access_class='public' ORDER BY ar.captured_at, ar.id`, [collectionId]));
    const extractionRuns = resultRows(await this.db.query(`SELECT er.id, er.asset_id, er.artifact_id, er.extractor_type, er.extractor_name,
      er.extractor_version, er.schema_reference, er.schema_version_reference, er.tenant_config_version, er.status,
      er.started_at, er.completed_at, er.run_metadata, er.created_at
      FROM evidence_extraction_runs er JOIN evidence_artifacts ar ON ar.id=er.artifact_id JOIN evidence_assets a ON a.id=ar.asset_id
      JOIN evidence_acquisitions ac ON ac.id=a.acquisition_id WHERE ac.collection_operation_id=$1 AND a.access_class='public'
      AND er.extractor_type='deterministic' ORDER BY er.created_at`, [collectionId]));
    const extractedValues = resultRows(await this.db.query(`SELECT ev.* FROM evidence_extracted_values ev JOIN evidence_extraction_runs er ON er.id=ev.extraction_run_id
      JOIN evidence_artifacts ar ON ar.id=er.artifact_id JOIN evidence_assets a ON a.id=ar.asset_id JOIN evidence_acquisitions ac ON ac.id=a.acquisition_id
      WHERE ac.collection_operation_id=$1 AND a.access_class='public' AND er.extractor_type='deterministic' ORDER BY ev.created_at`, [collectionId]));
    return { collection, acquisitions, assets, artifacts, extractionRuns, extractedValues };
  }
}

module.exports = { MemoryA2Repository, PostgresA2Repository, COLLECTION_COLUMNS, a2Tables, coordinateValue, resultRows };
