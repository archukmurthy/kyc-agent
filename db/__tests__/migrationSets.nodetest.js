"use strict";

// UBO-19: a UBO database gets UBO's and Evidence's tables, never KYC's. These
// tests keep the list of what "UBO's" means honest as files are added.

const { test } = require("node:test");
const assert = require("node:assert");
const { readMigrations, statementsOf } = require("../migrationRunner");
const { SETS, filesFor, looksLikeSet } = require("../migrationSets");

const files = readMigrations();

function tablesCreatedBy(contents) {
  return new Set(statementsOf(contents).flatMap((s) => [...s.matchAll(/create table (?:if not exists )?([a-z_][a-z0-9_]*)/gi)].map((m) => m[1].toLowerCase())));
}

function tablesReferencedBy(contents) {
  return new Set(statementsOf(contents).flatMap((s) => [...s.matchAll(/references\s+([a-z_][a-z0-9_]*)\s*\(/gi)].map((m) => m[1].toLowerCase())));
}

test("every file in the UBO set exists", () => {
  for (const name of SETS.ubo) assert.ok(files[name], `${name} is in the UBO set but not in db/migrations`);
});

test("the UBO set is complete: every table it references, it creates", () => {
  const created = new Set(SETS.ubo.flatMap((name) => [...tablesCreatedBy(files[name])]));
  for (const name of SETS.ubo) {
    for (const table of tablesReferencedBy(files[name])) {
      assert.ok(created.has(table), `${name} references ${table}, which no file in the UBO set creates`);
    }
  }
});

test("a new UBO or Evidence migration has to be put in the UBO set, or it never reaches the demo", () => {
  for (const name of Object.keys(files)) {
    if (/^\d+_(ubo|evidence)_/.test(name)) {
      assert.ok(SETS.ubo.includes(name), `${name} looks like UBO or Evidence: add it to db/migrationSets.js (or rename it)`);
    }
  }
});

test("the UBO set creates no KYC table", () => {
  const kyc = /^(dossier|entity_dossier|session|idv_|submission|customer_correction|research_cache|change_event)/;
  for (const name of SETS.ubo) {
    for (const table of tablesCreatedBy(files[name])) assert.ok(!kyc.test(table), `${name} creates ${table}, a KYC table`);
  }
});

test("a set is applied alone, in its own order", () => {
  const chosen = filesFor("ubo", files);
  assert.deepStrictEqual(Object.keys(chosen), [...SETS.ubo].sort());
  assert.deepStrictEqual(filesFor(null, files), files, "no set means every file, as before");
  assert.throws(() => filesFor("nope", files), /Unknown migration set/);
});

test("a database that has only ever had one set is recognised as that set", () => {
  assert.strictEqual(looksLikeSet(["001_tenants.sql", "021_ubo_poc_case_state.sql"]), "ubo");
  assert.strictEqual(looksLikeSet([]), null, "an empty database is nothing yet");
  assert.strictEqual(looksLikeSet(["001_tenants.sql", "005_entity_dossiers.sql"]), null, "a KYC database is not a UBO one");
});
