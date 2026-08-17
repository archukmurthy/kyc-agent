"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { PostgresA2Repository } = require("../repository");
const { CompaniesHouseEvidenceService } = require("../service");
const { MemoryArtifactStore } = require("../artifactStore");
const { buildCompaniesHouseFixtureClient, fixtureWebsiteCapture } = require("../fixtures");

test("A2 migration adds a producer-neutral coordinate contract without universal company columns", () => {
  const sql = fs.readFileSync(path.join(__dirname, "..", "..", "..", "db", "migrations", "011_evidence_platform_a2.sql"), "utf8");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS evidence_collection_operations/);
  assert.match(sql, /collection_coordinates JSONB NOT NULL/);
  assert.match(sql, /UNIQUE \(producer, producer_request_key\)/);
  assert.doesNotMatch(sql, /\b(company_number|registration_number)\b/i);
  assert.doesNotMatch(sql, /ALTER TABLE\s+(documents|entity_dossiers|journeys|field_provenance)\b/i);
});

test("A2 graph writes occur inside one transaction", async () => {
  const outside = [];
  const inside = [];
  const db = {
    async query(text, params) { outside.push({ text, params }); return { rows: [] }; },
    async transaction(work) { return work({ async query(text, params) { inside.push({ text, params }); return { rows: [] }; } }); },
  };
  const repository = new PostgresA2Repository(db);
  const service = new CompaniesHouseEvidenceService({ repository, artifactStore: new MemoryArtifactStore(), client: buildCompaniesHouseFixtureClient(), websiteCapture: fixtureWebsiteCapture, now: () => "2026-08-16T12:00:00.000Z" });
  await service.collect({ producer: "companies_house", producerRequestKey: "transaction-test", collectionCoordinates: { jurisdiction: "GB", companyNumber: "12345678" }, mode: "fixture" });
  assert.equal(outside.filter((call) => /^INSERT INTO evidence_collection_operations/.test(call.text)).length, 1);
  assert.ok(inside.some((call) => /^INSERT INTO evidence_subject_references/.test(call.text)));
  assert.ok(inside.some((call) => /^INSERT INTO evidence_artifacts/.test(call.text)));
  assert.ok(inside.some((call) => /^INSERT INTO evidence_extracted_values/.test(call.text)));
  assert.match(inside.at(-1).text, /^UPDATE evidence_collection_operations/);
});

test("transaction failure is surfaced and does not complete the collection", async () => {
  const repository = new PostgresA2Repository({
    async query(text) { return /^SELECT/.test(text) ? { rows: [] } : { rows: [] }; },
    async transaction() { throw new Error("transaction rolled back"); },
  });
  const service = new CompaniesHouseEvidenceService({ repository, artifactStore: new MemoryArtifactStore(), client: buildCompaniesHouseFixtureClient(), websiteCapture: fixtureWebsiteCapture, now: () => "2026-08-16T12:00:00.000Z" });
  await assert.rejects(() => service.collect({ producer: "companies_house", producerRequestKey: "rollback-test", collectionCoordinates: { jurisdiction: "GB", companyNumber: "12345678" }, mode: "fixture" }), /transaction rolled back/);
});
