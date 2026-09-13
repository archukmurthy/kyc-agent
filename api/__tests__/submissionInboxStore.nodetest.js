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
