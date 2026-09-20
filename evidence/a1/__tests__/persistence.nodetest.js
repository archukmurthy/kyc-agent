"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { buildA1FixtureGraph } = require("../fixtures");
const { PostgresEvidenceRepository, TABLES } = require("../repository");

test("A1 migration defines every bounded persistence table without altering legacy tables", () => {
  const migration = fs.readFileSync(path.join(__dirname, "..", "..", "..", "db", "migrations", "010_evidence_platform_a1.sql"), "utf8");
  for (const [, table] of TABLES) assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`));
  assert.doesNotMatch(migration, /ALTER TABLE\s+(documents|entity_dossiers|journeys|field_provenance)\b/i);
  assert.match(migration, /fingerprint_value ~ '\^\[0-9a-f\]\{64\}\$'/);
  assert.doesNotMatch(migration, /UNIQUE\s*\([^)]*fingerprint/i);
});

test("PostgreSQL repository writes the validated graph in dependency order", async () => {
  const calls = [];
  const repository = new PostgresEvidenceRepository({
    async query(text, params) { calls.push({ text, params }); return []; },
  });
  const graph = buildA1FixtureGraph();
  const result = await repository.persistGraph(graph);
  assert.equal(calls.length, Object.values(result.persisted).reduce((sum, count) => sum + count, 0));
  assert.match(calls[0].text, /^INSERT INTO evidence_subject_references/);
  assert.match(calls[calls.length - 1].text, /^INSERT INTO evidence_extracted_values/);
  assert.ok(calls.every((call) => call.text.endsWith("ON CONFLICT DO NOTHING")));
});
