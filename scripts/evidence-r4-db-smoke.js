#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { buildA3FixtureBundle } = require("../evidence/a3/fixtures");
const { PostgresA3Repository } = require("../evidence/a3/repository");
const { createPostgresDb } = require("../evidence/a2/postgresDb");
const { validateTypedRelationshipCandidate } = require("../evidence/r4/domain");
const { loadEvidenceTestEnv, requireDisposableEvidenceDatabase } = require("./evidence-test-db-guard");

function statements(file) { return fs.readFileSync(path.resolve("db", "migrations", file), "utf8").split("\n").map((line) => line.split("--")[0]).join("\n").split(";").map((value) => value.trim()).filter(Boolean); }

async function main() {
  loadEvidenceTestEnv();
  const db = createPostgresDb(requireDisposableEvidenceDatabase());
  const files = ["010_evidence_platform_a1.sql", "011_evidence_platform_a2.sql", "012_evidence_platform_a3.sql", "013_evidence_fact_artifact_support.sql", "014_evidence_need_evaluations.sql", "015_evidence_interpretation_operations.sql", "016_evidence_fact_artifact_locators.sql", "017_evidence_typed_relationships.sql"];
  try {
    // Evidence migrations deliberately reference the host platform's tenant table. A newly
    // created blank disposable database needs only this host prerequisite, never Lab data.
    await db.query("CREATE TABLE IF NOT EXISTS tenants(id TEXT PRIMARY KEY,name TEXT NOT NULL,slug TEXT NOT NULL UNIQUE)");
    for (const file of files) for (const statement of statements(file)) await db.query(`${statement};`);
    for (const tenant of ["nium", "acme"]) await db.query("INSERT INTO tenants(id,name,slug) VALUES($1,$1,$1) ON CONFLICT(id) DO NOTHING", [tenant]);
    const bundle = await buildA3FixtureBundle(), repository = new PostgresA3Repository(db); await repository.persistBundle(bundle);
    const artifact = bundle.baseGraph.artifacts[0], before = (await db.query("SELECT fingerprint_value,captured_at FROM evidence_artifacts WHERE id=$1", [artifact.id])).rows[0];
    const now = new Date().toISOString(), runId = randomUUID(), factId = randomUUID(), locatorId = randomUUID();
    const checked = validateTypedRelationshipCandidate({ directionEstablished: true, relationshipType: "ECONOMIC_OWNERSHIP", subject: { partyType: "natural_person", name: "Alice Smoke" }, object: { partyType: "legal_entity", name: "HoldCo Smoke Ltd" }, value: { kind: "RANGE", measurementType: "percentage", lower: 25, lowerInclusive: false, upper: 50, upperInclusive: true }, temporal: { state: "unknown" }, sourceSpecificMetadata: { fixture: "r4-db-smoke" }, qualifications: [] }, { factId, mappingMethod: "provider_structured", mapperId: "r4-db-smoke", mapperVersion: "1", createdAt: now });
    assert.ok(checked.relationship);
    await repository.appendInterpretation({
      run: { id: runId, assetId: artifact.assetId, artifactId: artifact.id, extractorType: "ai", extractorName: "r4-db-smoke", extractorVersion: "r4-v1", schemaReference: "evidence-r4-smoke", schemaVersionReference: null, tenantConfigVersion: null, status: "completed", startedAt: now, completedAt: now, runMetadata: { smoke: true }, createdAt: now, executionMode: "ai", provider: "fixture", modelIdentifier: "fixture-r4", instructionReference: "r4-smoke", extractionContext: { contextSource: "disposable_db_smoke" }, supportAssessment: { state: "supported" }, errorCode: null, errorMessage: null },
      runArtifacts: [{ extractionRunId: runId, artifactId: artifact.id, inputRole: "primary", createdAt: now }],
      facts: [{ id: factId, extractionRunId: runId, artifactId: artifact.id, informationNeedId: null, schemaFieldId: null, semanticConceptId: "economic_ownership_relationship", requestStatus: "discovered", groundingType: "direct", factValue: { subject: "Alice Smoke", relationship: "ECONOMIC_OWNERSHIP", object: "HoldCo Smoke Ltd" }, rawRepresentation: "Alice Smoke owns more than 25% but not more than 50% of HoldCo Smoke Ltd", supportState: "supported", supportSignals: { typedRelationship: { state: "validated" } }, sourcePolicyContext: {}, createdAt: now }],
      factArtifactSupports: [{ factId, artifactId: artifact.id, createdAt: now }],
      factArtifactLocators: [{ id: locatorId, factId, artifactId: artifact.id, locatorOrdinal: 1, locatorKind: "html", jsonPath: null, domReference: "#ownership", pageStart: null, pageEnd: null, supportExcerpt: "Alice Smoke owns more than 25% but not more than 50%", supportDescription: null, region: null, locatorMetadata: { method: "smoke" }, createdAt: now }],
      typedRelationships: [checked.relationship], derivations: [], verifications: [],
    });
    const persisted = (await db.query("SELECT relationship_type,value_kind,measurement_type,range_lower::float8,lower_inclusive,range_upper::float8,upper_inclusive,temporal_state FROM evidence_fact_typed_relationships WHERE fact_id=$1", [factId])).rows[0];
    assert.deepEqual(persisted, { relationship_type: "ECONOMIC_OWNERSHIP", value_kind: "RANGE", measurement_type: "percentage", range_lower: 25, lower_inclusive: false, range_upper: 50, upper_inclusive: true, temporal_state: "unknown" });
    const lineage = (await db.query("SELECT r.fact_id,s.artifact_id,l.id locator_id FROM evidence_fact_typed_relationships r JOIN evidence_fact_artifact_support s ON s.fact_id=r.fact_id JOIN evidence_fact_artifact_locators l ON l.fact_id=s.fact_id AND l.artifact_id=s.artifact_id WHERE r.fact_id=$1", [factId])).rows;
    assert.equal(lineage.length, 1); assert.equal(lineage[0].artifact_id, artifact.id);
    const after = (await db.query("SELECT fingerprint_value,captured_at FROM evidence_artifacts WHERE id=$1", [artifact.id])).rows[0];
    assert.equal(after.fingerprint_value, before.fingerprint_value); assert.equal(new Date(after.captured_at).toISOString(), new Date(before.captured_at).toISOString());
    console.log("Evidence R4 disposable-DB smoke passed through migration 017: typed range, one-Fact extension, Fact/Artifact/locator lineage, and immutable historical Artifact verified; no provider call was made");
  } finally { await db.close(); }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
