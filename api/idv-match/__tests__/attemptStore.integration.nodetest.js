const { test } = require("node:test");
const assert = require("node:assert");

// Guarded DB integration test. It touches a real database, so it only runs when
// IDV_MATCH_DB_TEST=1 is set explicitly (never in a normal `node --test` run or
// CI). Point DATABASE_URL at a disposable dev branch (e.g. Neon `idv-dev`), not
// production. Run: IDV_MATCH_DB_TEST=1 node --test api/idv-match/__tests__/attemptStore.integration.nodetest.js
const RUN = process.env.IDV_MATCH_DB_TEST === "1";
if (RUN) require("dotenv").config({ path: ".env.local" });

const skip = RUN ? false : "set IDV_MATCH_DB_TEST=1 (with a dev DATABASE_URL) to run";

test("attemptStore create/get round-trips against the database and cleans up", { skip }, async () => {
  const { neon } = require("@neondatabase/serverless");
  const { randomUUID } = require("node:crypto");
  const { createAttempt, getAttempt } = require("../attemptStore");
  const { buildOfficerSnapshot } = require("../officerSnapshot");

  const snapshot = buildOfficerSnapshot(
    { name: "SMITH, John", role: "Director", dob: "1985-05-24", officerId: "itest-officer" },
    { retrievedAt: "2026-09-08T00:00:00.000Z" }
  );
  const appId = "itest-app-" + randomUUID();

  let id;
  try {
    id = await createAttempt({ applicationId: appId, selectedOfficer: snapshot });
    const row = await getAttempt(id);
    assert.ok(row, "attempt row should exist");
    assert.strictEqual(row.application_id, appId);
    assert.strictEqual(row.status, "created");
    assert.strictEqual(row.selected_officer.birthMonthYear, "1985-05"); // month/year only
    assert.strictEqual(row.selected_officer.officerId, "itest-officer");
  } finally {
    // Always remove the test row, even if an assertion above failed.
    if (id) {
      const sql = neon(process.env.DATABASE_URL);
      await sql`DELETE FROM idv_verification_attempts WHERE id = ${id}`;
    }
  }

  assert.strictEqual(await getAttempt(id), null, "test row should be cleaned up");
});
