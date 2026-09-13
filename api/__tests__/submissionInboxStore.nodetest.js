// api/__tests__/submissionInboxStore.nodetest.js
const { test } = require("node:test");
const assert = require("node:assert");

// Pure unit test with an injected fake `sql` tag function — no live DB. The store
// accepts an optional deps.sql so tests can capture the query + args.
const store = require("../lib/submissionInboxStore");

function fakeSql(returnRows) {
  const calls = [];
  const tag = (strings, ...values) => {
    calls.push({ text: strings.join("?"), values });
    return Promise.resolve(typeof returnRows === "function" ? returnRows(calls.length) : returnRows);
  };
  tag.calls = calls;
  return tag;
}

test("enqueue inserts idempotently and reports inserted=true on a new row", async () => {
  const sql = fakeSql([{ id: "sub-1" }]);
  const r = await store.enqueue(
    { submissionId: "sub-1", tenantId: "nium", payload: { a: 1 } },
    { sql }
  );
  assert.deepStrictEqual(r, { id: "sub-1", inserted: true });
  assert.match(sql.calls[0].text, /INSERT INTO submission_inbox/);
  assert.match(sql.calls[0].text, /ON CONFLICT .*DO NOTHING/s);
});

test("enqueue on a duplicate submissionId reports inserted=false", async () => {
  const sql = fakeSql([]); // ON CONFLICT DO NOTHING → no RETURNING row
  const r = await store.enqueue(
    { submissionId: "sub-1", tenantId: "nium", payload: { a: 1 } },
    { sql }
  );
  assert.deepStrictEqual(r, { id: "sub-1", inserted: false });
});

test("enqueue rejects a missing submissionId", async () => {
  await assert.rejects(
    () => store.enqueue({ tenantId: "nium", payload: {} }, { sql: fakeSql([]) }),
    /submissionId is required/
  );
});

test("enqueue rejects a missing tenantId", async () => {
  await assert.rejects(
    () => store.enqueue({ submissionId: "sub-1", payload: {} }, { sql: fakeSql([]) }),
    /tenantId is required/
  );
});

test("claimPending claims a batch atomically and returns rows with lock", async () => {
  const sql = fakeSql([{ id: "a", tenant_id: "nium", payload: { x: 1 }, attempts: 0 }]);
  const r = await store.claimPending({ limit: 5 }, { sql });
  assert.deepStrictEqual(r, [{ id: "a", tenant_id: "nium", payload: { x: 1 }, attempts: 0 }]);
  assert.match(sql.calls[0].text, /UPDATE submission_inbox SET status = 'processing'/);
  assert.match(sql.calls[0].text, /FOR UPDATE SKIP LOCKED/);
});

test("markDone sets status to done with session_id, clears error, and timestamps", async () => {
  const sql = fakeSql([]);
  await store.markDone("id1", "sess1", { sql });
  assert.match(sql.calls[0].text, /status = 'done'/);
  assert.match(sql.calls[0].text, /session_id/);
  assert.match(sql.calls[0].text, /last_error = NULL/);
});

test("markFailed increments attempts and truncates error to 2000 chars", async () => {
  const longError = "E".repeat(3000);
  const sql = fakeSql([]);
  await store.markFailed("id1", longError, { sql });
  assert.match(sql.calls[0].text, /status = 'failed'/);
  assert.match(sql.calls[0].text, /attempts = attempts \+ 1/);
  const truncatedError = sql.calls[0].values.find(v => typeof v === "string" && v.length === 2000);
  assert.strictEqual(truncatedError.length, 2000);
});
