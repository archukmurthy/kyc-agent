"use strict";

// The migration runner.
//
// Today database changes are applied by hand, one file at a time, with nothing
// recording what ran where - five are sitting unapplied and there is no way to
// tell which environment has which. These tests describe what replaces that.
//
// No database is touched: the runner takes its SQL executor as an argument, so
// the tests drive a fake one and assert the decisions rather than the SQL.

const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const runner = require("../migrationRunner");

let applied;   // what the fake database has recorded
let executed;  // statements the runner actually ran

function fakeSql() {
  return async (statement) => {
    executed.push(statement);
    if (/create table if not exists schema_migrations/i.test(statement)) return [];
    if (/select filename from schema_migrations/i.test(statement)) {
      return applied.map((filename) => ({ filename }));
    }
    if (/insert into schema_migrations/i.test(statement)) {
      const match = statement.match(/'([^']+)'/);
      if (match) applied.push(match[1]);
      return [];
    }
    return [];
  };
}

// The runner creates its own ledger table, which is not a migration.
const isMigrationStatement = (statement) =>
  statement.startsWith("CREATE TABLE") && !/schema_migrations/i.test(statement);

const FILES = {
  "001_first.sql": "CREATE TABLE a (id int);",
  "002_second.sql": "CREATE TABLE b (id int);",
  "003_third.sql": "CREATE TABLE c (id int);",
};

beforeEach(() => {
  applied = [];
  executed = [];
});

test("a fresh database runs every migration, in order", async () => {
  const result = await runner.run({ sql: fakeSql(), files: FILES });
  assert.deepEqual(result.applied, ["001_first.sql", "002_second.sql", "003_third.sql"]);
  const order = executed.filter(isMigrationStatement);
  assert.deepEqual(order, ["CREATE TABLE a (id int);", "CREATE TABLE b (id int);", "CREATE TABLE c (id int);"]);
});

test("running twice does nothing the second time", async () => {
  await runner.run({ sql: fakeSql(), files: FILES });
  executed = [];
  const second = await runner.run({ sql: fakeSql(), files: FILES });
  assert.deepEqual(second.applied, []);
  assert.equal(executed.filter(isMigrationStatement).length, 0);
});

test("a database that is behind catches up, and only on what it is missing", async () => {
  applied = ["001_first.sql"];
  const result = await runner.run({ sql: fakeSql(), files: FILES });
  assert.deepEqual(result.applied, ["002_second.sql", "003_third.sql"]);
});

test("a migration applied somewhere that no longer exists here is reported, not ignored", async () => {
  // Drift. Someone applied a file by hand, or a branch was reverted. Silence
  // here is how two environments diverge without anybody noticing.
  applied = ["001_first.sql", "999_from_another_branch.sql"];
  const result = await runner.run({ sql: fakeSql(), files: FILES });
  assert.deepEqual(result.drift, ["999_from_another_branch.sql"]);
});

test("a failing migration stops the run rather than carrying on", async () => {
  const sql = async (statement) => {
    executed.push(statement);
    if (statement.includes("TABLE b")) throw new Error("syntax error at or near b");
    if (/select filename/i.test(statement)) return applied.map((filename) => ({ filename }));
    if (/insert into schema_migrations/i.test(statement)) {
      const match = statement.match(/'([^']+)'/);
      if (match) applied.push(match[1]);
    }
    return [];
  };
  await assert.rejects(() => runner.run({ sql, files: FILES }), /002_second\.sql/);
  // The third must not have run: a half-applied database is worse than one
  // that stopped, because the next run cannot tell how far it got.
  assert.equal(executed.some((s) => s.includes("TABLE c")), false);
  assert.deepEqual(applied, ["001_first.sql"], "only the migration that succeeded is recorded");
});

test("a dry run reports what would happen and changes nothing", async () => {
  const result = await runner.run({ sql: fakeSql(), files: FILES, dryRun: true });
  assert.deepEqual(result.pending, ["001_first.sql", "002_second.sql", "003_third.sql"]);
  assert.deepEqual(result.applied, []);
  assert.equal(executed.some(isMigrationStatement), false);
});

test("each file is recorded with a fingerprint, so an edited migration is caught", async () => {
  // Editing a migration that has already run is a classic way for two
  // environments to end up with different schemas from the same file name.
  await runner.run({ sql: fakeSql(), files: FILES });
  const insert = executed.find((s) => /insert into schema_migrations/i.test(s) && s.includes("001_first.sql"));
  assert.match(insert, /[0-9a-f]{64}/, "the checksum of the file contents is stored alongside the name");
});

test("baseline adopts an existing database without running anything", async () => {
  // Every database we have was migrated by hand before this runner existed.
  // Without this, the first real run would re-apply 34 migrations against a
  // live database - somewhere between wasteful and destructive.
  const result = await runner.run({ sql: fakeSql(), files: FILES, baseline: true });
  assert.deepEqual(result.baselined, ["001_first.sql", "002_second.sql", "003_third.sql"]);
  assert.deepEqual(result.applied, []);
  assert.equal(executed.some(isMigrationStatement), false, "nothing may be executed during a baseline");

  // And afterwards the database is considered up to date.
  executed = [];
  const after = await runner.run({ sql: fakeSql(), files: FILES });
  assert.deepEqual(after.applied, []);
});

test("a dollar-quoted function body stays one statement", () => {
  const { statementsOf: split } = require("../migrationRunner");
  const sql = "CREATE TABLE t (a int);\nCREATE OR REPLACE FUNCTION f() RETURNS trigger AS $$\nBEGIN\n  RAISE EXCEPTION 'no; really';\nEND;\n$$ LANGUAGE plpgsql;\n-- a comment; with a semicolon\nCREATE TRIGGER g BEFORE UPDATE ON t FOR EACH ROW EXECUTE FUNCTION f();";
  const statements = split(sql);
  assert.strictEqual(statements.length, 3, JSON.stringify(statements));
  assert.match(statements[1], /^CREATE OR REPLACE FUNCTION f\(\)[\s\S]*END;\n\$\$ LANGUAGE plpgsql$/);
});

test("every script that applies migrations splits them the runner's way", () => {
  // A copy of the old splitter in db/apply.js broke 029's trigger function
  // into fragments and left the audit ledger unprotected (review).
  const fs = require("node:fs");
  const path = require("node:path");
  for (const file of ["apply.js", "apply-idv.js"]) {
    const source = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
    assert.match(source, /require\("\.\/migrationRunner"\)/, `${file} must use the runner's statementsOf`);
    assert.doesNotMatch(source, /\.split\(["'];["']\)/, `${file} splits on ; by itself`);
  }
});
