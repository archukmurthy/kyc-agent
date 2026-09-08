const { test } = require("node:test");
const assert = require("node:assert");
const { createScreening, getByCheckId, listByAttempt, updateScreeningResult } = require("../store");

// Guards run before any DB access, so no database is needed here. The full
// round-trip is covered by the guarded integration test once migration 016 is
// applied.

test("createScreening requires an attemptId", async () => {
  await assert.rejects(createScreening({ provider: "complycube" }), /attemptId is required/);
});

test("getByCheckId / listByAttempt short-circuit on falsy input without a DB", async () => {
  assert.strictEqual(await getByCheckId(null), null);
  assert.deepStrictEqual(await listByAttempt(null), []);
});

test("updateScreeningResult requires an id", async () => {
  await assert.rejects(updateScreeningResult(null, { outcome: "clear" }), /id is required/);
});
