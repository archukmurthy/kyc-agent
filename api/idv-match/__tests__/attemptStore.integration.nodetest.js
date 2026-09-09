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
      const sql = neon((process.env.IDV_DATABASE_URL || process.env.DATABASE_URL));
      await sql`DELETE FROM idv_verification_attempts WHERE id = ${id}`;
    }
  }

  assert.strictEqual(await getAttempt(id), null, "test row should be cleaned up");
});

test("attemptStore session lookup + result update round-trip", { skip }, async () => {
  const { neon } = require("@neondatabase/serverless");
  const { randomUUID } = require("node:crypto");
  const { createAttempt, getAttempt, getByDiditSession, updateAttempt } = require("../attemptStore");

  const appId = "itest-app-" + randomUUID();
  const sessionId = "itest-sess-" + randomUUID();
  let id;
  try {
    id = await createAttempt({
      applicationId: appId,
      selectedOfficer: { name: "X", birthMonthYear: "1985-05", officerId: "o1" },
      diditSessionId: sessionId,
    });

    const bySession = await getByDiditSession(sessionId);
    assert.strictEqual(bySession.id, id, "lookup by didit session id finds the attempt");

    await updateAttempt(id, {
      status: "Approved",
      verificationResult: { status: "Approved", verified: true, extras: { mrz: { birth_date: "850500" } } },
      lastEventAt: "2026-09-08T00:00:00.000Z",
    });

    const row = await getAttempt(id);
    assert.strictEqual(row.status, "Approved");
    assert.strictEqual(row.verification_result.verified, true);
    assert.deepStrictEqual(row.verification_result.extras.mrz, { birth_date: "850500" }); // JSONB round-trips
    assert.ok(row.last_event_at, "last_event_at set");
  } finally {
    if (id) {
      const sql = neon((process.env.IDV_DATABASE_URL || process.env.DATABASE_URL));
      await sql`DELETE FROM idv_verification_attempts WHERE id = ${id}`;
    }
  }
});

test("webhook event dedupe is idempotent against the real table", { skip }, async () => {
  const { neon } = require("@neondatabase/serverless");
  const { randomUUID } = require("node:crypto");
  const { markEventProcessed } = require("../webhookEvents");

  const eventId = "itest-evt-" + randomUUID();
  try {
    assert.strictEqual(await markEventProcessed(eventId, "att-x"), true, "first delivery is new");
    assert.strictEqual(await markEventProcessed(eventId, "att-x"), false, "second delivery is a duplicate");
  } finally {
    const sql = neon((process.env.IDV_DATABASE_URL || process.env.DATABASE_URL));
    await sql`DELETE FROM idv_webhook_events WHERE event_id = ${eventId}`;
  }
});

