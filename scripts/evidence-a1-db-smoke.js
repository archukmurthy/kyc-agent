#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { neon } = require("@neondatabase/serverless");
const { buildA1FixtureGraph, ids } = require("../evidence/a1/fixtures");
const { PostgresEvidenceRepository } = require("../evidence/a1/repository");
const { loadEvidenceTestEnv, requireDisposableEvidenceDatabase } = require("./evidence-test-db-guard");

function migrationStatements() {
  const file = path.resolve(process.cwd(), "db", "migrations", "010_evidence_platform_a1.sql");
  return fs.readFileSync(file, "utf8")
    .split("\n")
    .map((line) => {
      const comment = line.indexOf("--");
      return comment === -1 ? line : line.slice(0, comment);
    })
    .join("\n")
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

async function main() {
  loadEvidenceTestEnv();
  const sql = neon(requireDisposableEvidenceDatabase());
  for (const statement of migrationStatements()) await sql.query(`${statement};`);

  for (const tenant of ["nium", "acme"]) {
    await sql.query(
      "INSERT INTO tenants (id, name, slug) VALUES ($1, $1, $1) ON CONFLICT (id) DO NOTHING",
      [tenant],
    );
  }

  const graph = buildA1FixtureGraph();
  await new PostgresEvidenceRepository(sql).persistGraph(graph);

  const acquisitionRows = await sql.query(
    "SELECT outcome, COUNT(*)::int AS count FROM evidence_acquisitions WHERE subject_reference_id = $1 GROUP BY outcome ORDER BY outcome",
    [ids.subject],
  );
  assert.deepEqual(Object.fromEntries(acquisitionRows.map((row) => [row.outcome, row.count])), {
    failed: 1,
    inconclusive: 1,
    successful: 3,
  });

  const lineage = await sql.query(
    `SELECT ev.schema_field_id, ev.extracted_value, er.id AS extraction_run_id,
            ea.id AS artifact_id, es.id AS asset_id, ac.id AS acquisition_id
       FROM evidence_extracted_values ev
       JOIN evidence_extraction_runs er ON er.id = ev.extraction_run_id
       JOIN evidence_artifacts ea ON ea.id = er.artifact_id
       JOIN evidence_assets es ON es.id = ea.asset_id
       JOIN evidence_acquisitions ac ON ac.id = es.acquisition_id
      WHERE ev.extraction_run_id IN ($1, $2)
      ORDER BY er.started_at`,
    [ids.runAugustPrimary, ids.runAugustIndependent],
  );
  assert.deepEqual(lineage.map((row) => row.extracted_value), ["25 King Street", "17 Queen Street"]);
  assert.ok(lineage.every((row) => row.schema_field_id === "registered_address_line1"));
  assert.ok(lineage.every((row) => row.extraction_run_id && row.artifact_id && row.asset_id && row.acquisition_id));

  const identical = await sql.query(
    "SELECT fingerprint_value, COUNT(DISTINCT asset_id)::int AS asset_count FROM evidence_artifacts WHERE id IN ($1, $2) GROUP BY fingerprint_value",
    [ids.artifactPublicDocument, ids.artifactCustomerDocument],
  );
  assert.equal(identical.length, 1);
  assert.equal(identical[0].asset_count, 2);

  console.log("Evidence A1 disposable-DB smoke passed");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
