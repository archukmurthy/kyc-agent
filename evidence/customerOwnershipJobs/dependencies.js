"use strict";

const path = require("node:path");
const { createPostgresDb } = require("../a2/postgresDb.js");
const { FileArtifactStore, VercelBlobArtifactStore } = require("../a2/artifactStore.js");
const { PostgresR1Repository } = require("../r1/repository.js");
const { PostgresA3Repository } = require("../a3/repository.js");
const { PostgresR2Repository } = require("../r2/repository.js");
const { PostgresCustomerExtractionJobRepository } = require("./repository.js");
const { CustomerOwnershipExtractionJobService } = require("./service.js");
const { chartReadingModel } = require("../a3/providers.js");

function createArtifactStore() {
  if (process.env.BLOB_READ_WRITE_TOKEN) return new VercelBlobArtifactStore();
  if (process.env.EVIDENCE_ARTIFACT_DIR) return new FileArtifactStore(path.resolve(process.env.EVIDENCE_ARTIFACT_DIR));
  throw Object.assign(new Error("Evidence Artifact persistence is not configured."), { code: "artifact_persistence_not_configured", statusCode: 503 });
}

function createCustomerOwnershipJobService(overrides = {}) {
  if (!process.env.DATABASE_URL && !overrides.db) {
    throw Object.assign(new Error("Evidence job persistence is not configured."), { code: "database_not_configured", statusCode: 503 });
  }
  const db = overrides.db || createPostgresDb();
  const artifactStore = overrides.artifactStore || createArtifactStore();
  const repository = overrides.repository || new PostgresCustomerExtractionJobRepository(db);
  const ingestionRepository = overrides.ingestionRepository || new PostgresR1Repository(db);
  const artifactRepository = overrides.artifactRepository || new PostgresA3Repository(db);
  const operationRepository = overrides.operationRepository || new PostgresR2Repository(db);
  const service = new CustomerOwnershipExtractionJobService({
    repository, ingestionRepository, artifactStore, artifactRepository, operationRepository,
    provider: overrides.provider,
    tenantId: overrides.tenantId,
    modelVersion: chartReadingModel(),
  });
  return { service, repository, db, artifactStore, close: () => db.close() };
}

module.exports = { createArtifactStore, createCustomerOwnershipJobService };
