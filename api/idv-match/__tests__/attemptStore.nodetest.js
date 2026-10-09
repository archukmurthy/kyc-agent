const { test } = require("node:test");
const assert = require("node:assert");
const { createAttempt, getAttempt, getByDiditSession, updateAttempt } = require("../attemptStore");

// These exercise the input guards, which run before any DB access - so they need
// no database. The DB round-trip is covered once migration 013 is applied.

test("createAttempt rejects without an application id", async () => {
  await assert.rejects(
    createAttempt({ selectedOfficer: { name: "x" } }),
    /applicationId is required/
  );
});

test("createAttempt rejects without an officer snapshot", async () => {
  await assert.rejects(
    createAttempt({ applicationId: "app-1" }),
    /selectedOfficer snapshot is required/
  );
});

test("getAttempt returns null for a falsy id without touching the database", async () => {
  assert.strictEqual(await getAttempt(null), null);
  assert.strictEqual(await getAttempt(""), null);
});

test("getByDiditSession returns null for a falsy session id without touching the database", async () => {
  assert.strictEqual(await getByDiditSession(null), null);
  assert.strictEqual(await getByDiditSession(""), null);
});

test("updateAttempt rejects without an id", async () => {
  await assert.rejects(updateAttempt(null, { status: "approved" }), /id is required/);
});
