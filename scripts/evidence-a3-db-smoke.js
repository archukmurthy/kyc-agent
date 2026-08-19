#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { buildA3FixtureBundle, ids } = require("../evidence/a3/fixtures");
const { PostgresA3Repository } = require("../evidence/a3/repository");
const { createPostgresDb } = require("../evidence/a2/postgresDb");
const { PostgresA2Repository } = require("../evidence/a2/repository");
const { EvidenceCollectionHistoryService } = require("../evidence/a2/historyService");
const { CompaniesHouseEvidenceService } = require("../evidence/a2/service");
const { MemoryArtifactStore } = require("../evidence/a2/artifactStore");
const { buildCompaniesHouseFixtureClient, fixtureWebsiteCapture } = require("../evidence/a2/fixtures");

const CONFIRMATION = "I_UNDERSTAND_TEST_DATA_WILL_BE_WRITTEN";

function loadTestEnv() {
  const envPath = path.resolve(process.cwd(), ".env.test.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/); if (!match || process.env[match[1]] !== undefined) continue;
    let value = match[2].trim(); if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
}

function normalize(value) { return String(value || "").trim().replace(/[?&](?:sslmode|channel_binding)=[^&]*/g, ""); }
function safeUrl() {
  const testUrl = process.env.TEST_DATABASE_URL; if (!testUrl) throw new Error("TEST_DATABASE_URL is required");
  if (process.env.REAL_DB_SMOKE_CONFIRM !== CONFIRMATION) throw new Error(`Set REAL_DB_SMOKE_CONFIRM=${CONFIRMATION}`);
  if (process.env.DATABASE_URL && normalize(testUrl) === normalize(process.env.DATABASE_URL)) throw new Error("Refusing to run against the configured application database");
  return testUrl;
}

function statements(file) {
  return fs.readFileSync(path.resolve(process.cwd(), "db", "migrations", file), "utf8").split("\n").map((line) => { const i = line.indexOf("--"); return i < 0 ? line : line.slice(0, i); }).join("\n").split(";").map((s) => s.trim()).filter(Boolean);
}

async function main() {
  loadTestEnv(); const db = createPostgresDb(safeUrl()); const rows = (result) => result.rows || result;
  try {
    for (const file of ["010_evidence_platform_a1.sql", "011_evidence_platform_a2.sql", "012_evidence_platform_a3.sql", "013_evidence_fact_artifact_support.sql"]) for (const statement of statements(file)) await db.query(`${statement};`);
    for (const tenant of ["nium", "acme"]) await db.query("INSERT INTO tenants (id, name, slug) VALUES ($1, $1, $1) ON CONFLICT (id) DO NOTHING", [tenant]);
    const bundle = await buildA3FixtureBundle(); const repository = new PostgresA3Repository(db); await repository.persistBundle(bundle);
    const discovered = rows(await db.query("SELECT schema_field_id, information_need_id FROM evidence_facts WHERE request_status='discovered' AND extraction_run_id IN ($1,$2)", [ids.runSemantic, ids.runDerived]));
    assert.ok(discovered.length >= 2); assert.ok(discovered.every((row) => row.schema_field_id === null && row.information_need_id === null));
    const derivation = rows(await db.query("SELECT transformation_id FROM evidence_fact_derivations WHERE derived_fact_id=$1", [ids.factDerivedActivity]));
    assert.equal(derivation[0].transformation_id, "uk-sic-2007-fixture");
    const verification = rows(await db.query("SELECT outcome FROM evidence_verification_attempts WHERE id IN ($1,$2) ORDER BY outcome", [ids.verificationAgreement, ids.verificationDisagreement]));
    assert.deepEqual(verification.map((row) => row.outcome), ["agreement", "disagreement"]);
    const temporal = rows(await db.query("SELECT a.captured_at, r.started_at FROM evidence_facts f JOIN evidence_artifacts a ON a.id=f.artifact_id JOIN evidence_extraction_runs r ON r.id=f.extraction_run_id WHERE f.id=$1", [ids.factDisagreement]));
    assert.ok(new Date(temporal[0].captured_at) < new Date(temporal[0].started_at));
    const existingArtifact = bundle.baseGraph.artifacts[0]; const before = rows(await db.query("SELECT fingerprint_value, captured_at FROM evidence_artifacts WHERE id=$1", [existingArtifact.id]))[0]; const now = new Date().toISOString(); const runId = randomUUID();
    await repository.appendInterpretation({ run: { id: runId, assetId: existingArtifact.assetId, artifactId: existingArtifact.id, extractorType: "ai", extractorName: "a3-db-smoke-append", extractorVersion: "v1", schemaReference: "evidence-lab:a3-standalone-current", schemaVersionReference: null, tenantConfigVersion: null, status: "completed", startedAt: now, completedAt: now, runMetadata: { smoke: true }, createdAt: now, executionMode: "ai", provider: "fixture-smoke", modelIdentifier: "fixture-smoke-v1", instructionReference: "a3-db-smoke-v1", extractionContext: { contextSource: "disposable_db_smoke" }, supportAssessment: { state: "supported" }, errorCode: null, errorMessage: null }, runArtifacts: [{ extractionRunId: runId, artifactId: existingArtifact.id, inputRole: "primary", createdAt: now }], facts: [], derivations: [], verifications: [] });
    const after = rows(await db.query("SELECT fingerprint_value, captured_at FROM evidence_artifacts WHERE id=$1", [existingArtifact.id]))[0]; assert.equal(after.fingerprint_value, before.fingerprint_value); assert.equal(new Date(after.captured_at).toISOString(), new Date(before.captured_at).toISOString());
    const a2Repository = new PostgresA2Repository(db); const requestKey = `a2-history-smoke-${randomUUID()}`;
    const a2Service = new CompaniesHouseEvidenceService({ repository: a2Repository, artifactStore: new MemoryArtifactStore(), client: buildCompaniesHouseFixtureClient({ pscFailure: true }), websiteCapture: fixtureWebsiteCapture });
    const partial = await a2Service.collect({ producer: "companies_house", producerRequestKey: requestKey, collectionCoordinates: { jurisdiction: "GB", companyNumber: "12345678" }, mode: "live", tenantId: "nium" });
    assert.equal(partial.summary.status, "partial");
    const reopened = await new EvidenceCollectionHistoryService(a2Repository).findLatestCompaniesHouse({ jurisdiction: "GB", companyNumber: "12345678" });
    assert.equal(reopened.found, true); assert.equal(reopened.summary.collectionId, partial.summary.collectionId); assert.equal(reopened.summary.status, "partial");
    assert.equal(reopened.externalSourceCall, false); assert.equal(reopened.writesPerformed, false); assert.equal(JSON.stringify(reopened).includes("storageReference"), false);
    console.log("Evidence A3 disposable-DB smoke passed");
  } finally { await db.close(); }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
