const { test } = require("node:test");
const assert = require("node:assert");
const { neon } = require("@neondatabase/serverless");

// GUARDED DB integration. Run with IDV_MATCH_DB_TEST=1 and a dev DATABASE_URL.
const RUN = process.env.IDV_MATCH_DB_TEST === "1" && !!process.env.DATABASE_URL;
const { appendOutbox, listByAttempt } = require("../evidenceOutboxStore");

test("outbox append is append-only and idempotent on idempotency_key", { skip: !RUN }, async () => {
  const attemptId = `outbox-int-${Date.now()}`;
  const idempotencyKey = `${attemptId}:report:2026-09-02`;
  const envelope = { schema: "idv-evidence-outbox/1", attempt_id: attemptId, secure_identity_reference: "ref" };
  try {
    const first = await appendOutbox({ attemptId, idempotencyKey, envelope });
    const second = await appendOutbox({ attemptId, idempotencyKey, envelope });
    assert.strictEqual(first.inserted, true);
    assert.strictEqual(second.inserted, false, "duplicate idempotency key must not insert again");
    const rows = await listByAttempt(attemptId);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].status, "pending");
  } finally {
    const sql = neon(process.env.DATABASE_URL);
    await sql`DELETE FROM idv_evidence_outbox WHERE attempt_id = ${attemptId}`;
  }
});
