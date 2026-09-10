"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { CONFIRMATION, requireDisposableEvidenceDatabase } = require("../../../scripts/evidence-test-db-guard");

test("Evidence smoke tests refuse the development/Lab database even when DATABASE_URL is not preloaded", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "evidence-db-guard-"));
  try {
    fs.writeFileSync(path.join(cwd, ".env.local"), "DATABASE_URL=postgresql://user:secret@example.test/evidence?sslmode=require\n");
    const env = { TEST_DATABASE_URL: "postgresql://user:secret@example.test/evidence", REAL_DB_SMOKE_CONFIRM: CONFIRMATION };
    assert.throws(() => requireDisposableEvidenceDatabase({ cwd, env }), /development\/Lab DATABASE_URL/);
    env.TEST_DATABASE_URL = "postgresql://user:secret@example.test/evidence_disposable";
    assert.equal(requireDisposableEvidenceDatabase({ cwd, env }), env.TEST_DATABASE_URL);
  } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
});

test("every Evidence PostgreSQL smoke path uses the shared disposable-database guard", () => {
  const root = path.resolve(__dirname, "..", "..", "..");
  for (const name of ["evidence-a1-db-smoke.js", "evidence-a3-db-smoke.js", "evidence-a4a-db-smoke.js", "evidence-r1-db-smoke.js", "evidence-r2-db-smoke.js"]) {
    const source = fs.readFileSync(path.join(root, "scripts", name), "utf8");
    assert.match(source, /requireDisposableEvidenceDatabase/);
    assert.match(source, /loadEvidenceTestEnv/);
  }
  const a3 = fs.readFileSync(path.join(root, "scripts", "evidence-a3-db-smoke.js"), "utf8");
  assert.match(a3, /new MemoryArtifactStore\(\)/);
});
