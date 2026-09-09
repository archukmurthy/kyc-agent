const { test } = require("node:test");
const assert = require("node:assert");
const { neon } = require("@neondatabase/serverless");

// GUARDED DB integration. IDV_MATCH_DB_TEST=1 + dev DATABASE_URL.
const RUN = process.env.IDV_MATCH_DB_TEST === "1" && !!process.env.DATABASE_URL;
const { appendLifecycleEvent, listLifecycle } = require("../lifecycle");

test("out-of-order events reconstruct in causal order; missing time falls back", { skip: !RUN }, async () => {
  const attemptId = `lifecycle-int-${Date.now()}`;
  try {
    // Inserted out of causal order.
    await appendLifecycleEvent({ attemptId, type: "PROVIDER_RESULT_RECEIVED", occurredAt: "2026-09-01T10:05:00Z", receivedAt: "2026-09-01T10:06:00Z" });
    await appendLifecycleEvent({ attemptId, type: "IDV_SESSION_CREATED", occurredAt: "2026-09-01T10:00:00Z", receivedAt: "2026-09-01T10:00:01Z" });
    await appendLifecycleEvent({ attemptId, type: "IDV_COMPLETED", receivedAt: "2026-09-01T10:07:00Z" }); // no occurred_at

    const events = await listLifecycle(attemptId);
    assert.deepStrictEqual(events.map((e) => e.event_type), ["IDV_SESSION_CREATED", "PROVIDER_RESULT_RECEIVED", "IDV_COMPLETED"]);
    // The no-occurred_at event kept its null occurred time (not fabricated).
    assert.strictEqual(events[2].occurred_at, null);
  } finally {
    const sql = neon(process.env.DATABASE_URL);
    await sql`DELETE FROM idv_lifecycle_events WHERE attempt_id = ${attemptId}`;
  }
});
