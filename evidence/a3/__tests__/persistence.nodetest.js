"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { buildA3FixtureBundle } = require("../fixtures");
const { PostgresA3Repository } = require("../repository");

test("A3 migration is additive and truthfully models facts, derivation, and verification", () => {
  const sql = fs.readFileSync(path.join(__dirname, "..", "..", "..", "db", "migrations", "012_evidence_platform_a3.sql"), "utf8");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS evidence_facts/);
  assert.match(sql, /request_status = 'discovered' AND information_need_id IS NULL AND schema_field_id IS NULL/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS evidence_fact_derivations/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS evidence_verification_attempts/);
  assert.match(sql, /target_extraction_run_id <> verification_extraction_run_id/);
  assert.doesNotMatch(sql, /ALTER TABLE\s+(documents|entity_dossiers|journeys|field_provenance)\b/i);
  assert.doesNotMatch(sql, /ALTER TABLE\s+evidence_extracted_values\b/i);
});

test("A3 Fact support migration additively records precise Artifact lineage", () => {
  const sql = fs.readFileSync(path.join(__dirname, "..", "..", "..", "db", "migrations", "013_evidence_fact_artifact_support.sql"), "utf8");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS evidence_fact_artifact_support/); assert.match(sql, /fact_id UUID NOT NULL REFERENCES evidence_facts/); assert.match(sql, /artifact_id UUID NOT NULL REFERENCES evidence_artifacts/); assert.doesNotMatch(sql, /DROP TABLE|ALTER TABLE .* DROP/i);
});

test("Postgres A3 repository extends A1 rows and writes facts before lineage links", async () => {
  const calls = [];
  const db = { async query(text, params) { calls.push({ text, params }); return []; } };
  const bundle = await buildA3FixtureBundle();
  const result = await new PostgresA3Repository(db).persistBundle(bundle);
  assert.equal(result.persisted.facts, bundle.facts.length);
  assert.ok(calls.some((c) => c.text.startsWith("UPDATE evidence_extraction_runs")));
  const firstFact = calls.findIndex((c) => c.text.startsWith("INSERT INTO evidence_facts"));
  const firstDerivation = calls.findIndex((c) => c.text.startsWith("INSERT INTO evidence_fact_derivations"));
  const firstVerification = calls.findIndex((c) => c.text.startsWith("INSERT INTO evidence_verification_attempts"));
  assert.ok(firstFact >= 0 && firstDerivation > firstFact && firstVerification > firstDerivation);
});

test("live append writes only a new run and A3 lineage against existing Artifact keys", async () => {
  const calls = []; const db = { async query() { return { rows: [] }; }, async transaction(work) { return work({ async query(text, params) { calls.push({ text, params }); return { rows: [] }; } }); } };
  const repository = new PostgresA3Repository(db); const when = "2026-08-18T10:00:00.000Z";
  await repository.appendInterpretation({ run: { id: "run-live", assetId: "asset-existing", artifactId: "artifact-existing", extractorType: "ai", extractorName: "generic", extractorVersion: "v1", schemaReference: "evidence-lab:a3-standalone-current", schemaVersionReference: null, tenantConfigVersion: null, status: "completed", startedAt: when, completedAt: when, runMetadata: {}, createdAt: when, executionMode: "ai", provider: "test", modelIdentifier: "model", instructionReference: "instruction", extractionContext: {}, supportAssessment: {}, errorCode: null, errorMessage: null }, runArtifacts: [{ extractionRunId: "run-live", artifactId: "artifact-existing", inputRole: "primary", createdAt: when }], facts: [], derivations: [], verifications: [] });
  assert.equal(calls[0].text.startsWith("INSERT INTO evidence_extraction_runs"), true);
  assert.equal(calls.some((call) => /INSERT INTO evidence_(artifacts|assets|acquisitions|collection_operations)/.test(call.text)), false);
  assert.equal(calls.some((call) => call.text.startsWith("INSERT INTO evidence_extraction_run_artifacts")), true);
});

test("live append identifies the safe persistence stage when PostgreSQL rejects a row", async () => {
  const db = { async query() { return { rows: [] }; }, async transaction(work) { return work({ async query(text) { if (text.startsWith("INSERT INTO evidence_facts")) throw Object.assign(new Error("invalid text representation"), { code: "22P05" }); return { rows: [] }; } }); } };
  const repository = new PostgresA3Repository(db); const when = "2026-08-19T10:00:00.000Z";
  await assert.rejects(() => repository.appendInterpretation({ run: { id: "run", assetId: "asset", artifactId: "artifact", extractorType: "ai", extractorName: "generic", extractorVersion: "v1", schemaReference: "lab", status: "completed", startedAt: when, completedAt: when, runMetadata: {}, createdAt: when, executionMode: "ai", provider: "test", extractionContext: {}, supportAssessment: {} }, facts: [{ id: "fact" }] }), (error) => error.code === "22P05" && error.persistenceStage === "facts");
});
