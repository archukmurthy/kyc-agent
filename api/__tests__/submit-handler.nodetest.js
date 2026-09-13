const { test, before, after } = require("node:test");
const assert = require("node:assert");

// The handler's DATABASE_URL gate runs before deps are consulted (matches
// production: refuse to even try when no DB is configured). Set a fake value
// for these tests so the mocked enqueue/finalizeSubmission path is exercised
// — mirrors the save/restore pattern in get-dossier.nodetest.js.
let prevUrl;
before(() => { prevUrl = process.env.DATABASE_URL; process.env.DATABASE_URL = "postgres://test"; });
after(() => { if (prevUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = prevUrl; });

function fakeRes() {
  return {
    statusCode: null, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

test("returns status:saved when finalize succeeds", async () => {
  const handler = require("../submit");
  handler.__setDeps({
    enqueue: async () => ({ id: "sub-1", inserted: true }),
    finalizeSubmission: async () => ({ sessionId: "s1", clientId: "c1", journeyId: "j1" }),
    markDone: async () => {},
    markFailed: async () => {},
  });
  const req = { method: "POST", body: { submissionId: "sub-1", tenantId: "nium", company: { name: "Acme" } } };
  const res = fakeRes();
  await handler(req, res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.status, "saved");
  assert.strictEqual(res.body.sessionId, "s1");
});

test("returns status:queued when finalize throws (never blocks)", async () => {
  const handler = require("../submit");
  handler.__setDeps({
    enqueue: async () => ({ id: "sub-1", inserted: true }),
    finalizeSubmission: async () => { throw new Error("db down"); },
    markDone: async () => {},
    markFailed: async () => {},
  });
  const req = { method: "POST", body: { submissionId: "sub-1", tenantId: "nium", company: { name: "Acme" } } };
  const res = fakeRes();
  await handler(req, res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.status, "queued");
});

test("returns 400 when submissionId is missing", async () => {
  const handler = require("../submit");
  handler.__setDeps({ enqueue: async () => ({}), finalizeSubmission: async () => ({}), markDone: async()=>{}, markFailed: async()=>{} });
  const req = { method: "POST", body: { tenantId: "nium", company: { name: "Acme" } } };
  const res = fakeRes();
  await handler(req, res);
  assert.strictEqual(res.statusCode, 400);
});
