const { test } = require("node:test");
const assert = require("node:assert");

const { appendLifecycleEvent, safeAppendLifecycleEvent } = require("../lifecycle");

// Fake Neon tagged-template that captures the interpolated values.
function captureSql() {
  const calls = [];
  const sql = (strings, ...values) => { calls.push(values); return Promise.resolve([]); };
  sql.calls = calls;
  return sql;
}

test("append preserves distinct occurred vs received times", async () => {
  const sql = captureSql();
  await appendLifecycleEvent({
    attemptId: "att-1", type: "PROVIDER_RESULT_RECEIVED",
    occurredAt: "2026-09-01T10:05:00.000Z", receivedAt: "2026-09-02T00:00:00.000Z",
  }, { sql });
  const [attemptId, type, occurredAt, receivedAt] = sql.calls[0];
  assert.strictEqual(attemptId, "att-1");
  assert.strictEqual(type, "PROVIDER_RESULT_RECEIVED");
  assert.strictEqual(occurredAt, "2026-09-01T10:05:00.000Z");
  assert.strictEqual(receivedAt, "2026-09-02T00:00:00.000Z");
  assert.notStrictEqual(occurredAt, receivedAt);
});

test("a missing provider time stays missing (occurredAt null, never fabricated)", async () => {
  const sql = captureSql();
  await appendLifecycleEvent({ attemptId: "att-1", type: "IDV_SESSION_CREATED", receivedAt: "2026-09-02T00:00:00.000Z" }, { sql });
  const [, , occurredAt] = sql.calls[0];
  assert.strictEqual(occurredAt, null);
});

test("append validates attemptId and type", async () => {
  const sql = captureSql();
  await assert.rejects(() => appendLifecycleEvent({ type: "X" }, { sql }), /attemptId is required/);
  await assert.rejects(() => appendLifecycleEvent({ attemptId: "a" }, { sql }), /type is required/);
});

test("safeAppend never throws even when the write fails", async () => {
  const failing = () => { throw new Error("db down"); };
  failing.calls = [];
  await safeAppendLifecycleEvent({ attemptId: "att-1", type: "IDV_COMPLETED" }, { sql: failing });
  // no throw = pass
});
