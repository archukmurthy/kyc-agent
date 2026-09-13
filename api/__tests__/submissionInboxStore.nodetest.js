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

test("claimPending's WHERE clause also reclaims stale 'processing' rows", async () => {
  const sql = fakeSql([]);
  await store.claimPending({ limit: 5 }, { sql });
  // status IN ('pending','failed') branch still present...
  assert.match(sql.calls[0].text, /status IN \('pending','failed'\)/);
  // ...OR'd with a reclaim branch for stale 'processing' rows past the stale interval.
  assert.match(sql.calls[0].text, /status = 'processing'/);
  assert.match(sql.calls[0].text, /updated_at < now\(\) - \(/);
  assert.match(sql.calls[0].text, /\|\| ' seconds'\)::interval/);
});

test("markProcessing issues a status='processing' UPDATE on the given id", async () => {
  const sql = fakeSql([]);
  await store.markProcessing("sub-1", { sql });
  assert.match(sql.calls[0].text, /UPDATE submission_inbox SET status = 'processing'/);
  assert.deepStrictEqual(sql.calls[0].values, ["sub-1"]);
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
  const sql = fakeSql([{ attempts: 1 }]);
  await store.markFailed("id1", longError, { sql });
  assert.match(sql.calls[0].text, /status = 'failed'/);
  assert.match(sql.calls[0].text, /attempts = attempts \+ 1/);
  const truncatedError = sql.calls[0].values.find(v => typeof v === "string" && v.length === 2000);
  assert.strictEqual(truncatedError.length, 2000);
});

test("markFailed at the attempts cap logs a DEAD-LETTER console.error", async () => {
  const sql = fakeSql([{ attempts: store.MAX_ATTEMPTS }]);
  const origError = console.error;
  const calls = [];
  console.error = (...args) => calls.push(args.join(" "));
  try {
    await store.markFailed("id1", "boom", { sql });
  } finally {
    console.error = origError;
  }
  assert.strictEqual(calls.length, 1);
  assert.match(calls[0], /DEAD-LETTER/);
  assert.match(calls[0], /id1/);
});

test("markFailed below the attempts cap does NOT log a DEAD-LETTER console.error", async () => {
  const sql = fakeSql([{ attempts: store.MAX_ATTEMPTS - 1 }]);
  const origError = console.error;
  const calls = [];
  console.error = (...args) => calls.push(args.join(" "));
  try {
    await store.markFailed("id1", "boom", { sql });
  } finally {
    console.error = origError;
  }
  assert.strictEqual(calls.length, 0);
});

test("countDeadLettered issues an attempts >= MAX_ATTEMPTS count query", async () => {
  const sql = fakeSql([{ n: 3 }]);
  const r = await store.countDeadLettered({ sql });
  assert.strictEqual(r, 3);
  assert.match(sql.calls[0].text, /status = 'failed'/);
  assert.match(sql.calls[0].text, /attempts >= /);
});
