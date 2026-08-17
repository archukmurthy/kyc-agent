"use strict";

const { TABLES, buildInsert } = require("../a1/repository");

const COLLECTION_COLUMNS = [
  ["id", "id"], ["producer", "producer"], ["producer_request_key", "producerRequestKey"],
  ["subject_reference_id", "subjectReferenceId"], ["collection_coordinates", "collectionCoordinates", "jsonb"],
  ["mode", "mode"], ["status", "status"], ["started_at", "startedAt"], ["completed_at", "completedAt"],
  ["failure_reason", "failureReason"], ["producer_metadata", "producerMetadata", "jsonb"], ["created_at", "createdAt"],
];

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
}

module.exports = { MemoryA2Repository, PostgresA2Repository, COLLECTION_COLUMNS, a2Tables };
