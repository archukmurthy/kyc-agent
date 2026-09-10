"use strict";

const path = require("node:path");
const { CompaniesHouseEvidenceService } = require("../../evidence/a2/service");
const { CompaniesHouseClient } = require("../../evidence/a2/companiesHouseClient");
const { captureCompaniesHouseWebsite } = require("../../evidence/a2/websiteCapture");
const { buildCompaniesHouseFixtureClient, fixtureWebsiteCapture } = require("../../evidence/a2/fixtures");
const { MemoryArtifactStore, FileArtifactStore, VercelBlobArtifactStore } = require("../../evidence/a2/artifactStore");
const { MemoryA2Repository, PostgresA2Repository } = require("../../evidence/a2/repository");
const { createPostgresDb } = require("../../evidence/a2/postgresDb");

function liveDependencies() {
  if (!process.env.DATABASE_URL) throw new Error("Live collection requires DATABASE_URL and migration 011");
  const db = createPostgresDb();
  let artifactStore;
  if (process.env.BLOB_READ_WRITE_TOKEN) artifactStore = new VercelBlobArtifactStore();
  else if (process.env.EVIDENCE_ARTIFACT_DIR) artifactStore = new FileArtifactStore(path.resolve(process.env.EVIDENCE_ARTIFACT_DIR));
  else throw new Error("Live collection requires BLOB_READ_WRITE_TOKEN or EVIDENCE_ARTIFACT_DIR");
  return { repository: new PostgresA2Repository(db), artifactStore, client: new CompaniesHouseClient(), websiteCapture: captureCompaniesHouseWebsite, close: () => db.close() };
}

function fixtureDependencies(options = {}) {
  return { repository: new MemoryA2Repository(), artifactStore: new MemoryArtifactStore(), client: buildCompaniesHouseFixtureClient(options), websiteCapture: fixtureWebsiteCapture };
}

function createHandler(dependencyFactory) {
  return async function handler(req, res) {
    if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "Method not allowed" }); }
    let dependencies;
    try {
      const mode = req.body?.mode === "fixture" ? "fixture" : "live";
      dependencies = dependencyFactory ? dependencyFactory(req.body || {}) : (mode === "fixture" ? fixtureDependencies(req.body?.fixtureOptions) : liveDependencies());
      const service = new CompaniesHouseEvidenceService(dependencies);
      const result = await service.collect({
        producer: "companies_house",
        producerRequestKey: req.body?.producerRequestKey,
        collectionCoordinates: req.body?.collectionCoordinates,
        mode,
        tenantId: req.body?.tenantId || "nium",
        contextReference: req.body?.contextReference || null,
      });
      return res.status(200).json({ success: true, replayed: !!result.replayed, summary: result.summary, inspection: result.inspection });
    } catch (error) {
      return res.status(400).json({ error: "Companies House evidence collection failed", message: error.message });
    } finally { if (dependencies?.close) await dependencies.close(); }
  };
}

const handler = createHandler();
handler.createHandler = createHandler;
handler.fixtureDependencies = fixtureDependencies;
handler.liveConfiguration = () => ({ companiesHouseApi: !!process.env.COMPANIES_HOUSE_API_KEY, database: !!process.env.DATABASE_URL, durableArtifactStorage: !!(process.env.BLOB_READ_WRITE_TOKEN || process.env.EVIDENCE_ARTIFACT_DIR), browser: true });

module.exports = handler;
