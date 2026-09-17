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
    markProcessing: async () => {},
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

test("saved path calls markProcessing (claiming the row) before finalizeSubmission", async () => {
  const handler = require("../submit");
  const order = [];
  handler.__setDeps({
    enqueue: async () => ({ id: "sub-1", inserted: true }),
    markProcessing: async (id) => { order.push(["markProcessing", id]); },
    finalizeSubmission: async () => { order.push(["finalizeSubmission"]); return { sessionId: "s1" }; },
    markDone: async () => {},
    markFailed: async () => {},
  });
  const req = { method: "POST", body: { submissionId: "sub-1", tenantId: "nium", company: { name: "Acme" } } };
  const res = fakeRes();
  await handler(req, res);
  assert.strictEqual(res.body.status, "saved");
  assert.deepStrictEqual(order, [["markProcessing", "sub-1"], ["finalizeSubmission"]]);
});

test("a markProcessing throw does not block finalize — still returns saved", async () => {
  const handler = require("../submit");
  let finalizeCalled = false;
  handler.__setDeps({
    enqueue: async () => ({ id: "sub-1", inserted: true }),
    markProcessing: async () => { throw new Error("claim failed"); },
    finalizeSubmission: async () => { finalizeCalled = true; return { sessionId: "s1" }; },
    markDone: async () => {},
    markFailed: async () => {},
  });
  const req = { method: "POST", body: { submissionId: "sub-1", tenantId: "nium", company: { name: "Acme" } } };
  const res = fakeRes();
  await handler(req, res);
  assert.strictEqual(finalizeCalled, true);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.status, "saved");
});

test("returns status:queued when finalize throws (never blocks)", async () => {
  const handler = require("../submit");
  handler.__setDeps({
    enqueue: async () => ({ id: "sub-1", inserted: true }),
    finalizeSubmission: async () => { throw new Error("db down"); },
    markProcessing: async () => {},
    markDone: async () => {},
    markFailed: async () => {},
  });
  const req = { method: "POST", body: { submissionId: "sub-1", tenantId: "nium", company: { name: "Acme" } } };
  const res = fakeRes();
  await handler(req, res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.status, "queued");
});

test("markProcessing succeeds, finalize throws → markFailed called with incrementAttempt:false (already counted by markProcessing)", async () => {
  const handler = require("../submit");
  let markFailedArgs;
  handler.__setDeps({
    enqueue: async () => ({ id: "sub-1", inserted: true }),
    markProcessing: async () => {},
    finalizeSubmission: async () => { throw new Error("db down"); },
    markDone: async () => {},
    markFailed: async (id, msg, opts) => { markFailedArgs = [id, msg, opts]; },
  });
  const req = { method: "POST", body: { submissionId: "sub-1", tenantId: "nium", company: { name: "Acme" } } };
  const res = fakeRes();
  await handler(req, res);
  assert.strictEqual(res.body.status, "queued");
  assert.deepStrictEqual(markFailedArgs, ["sub-1", "db down", { incrementAttempt: false }]);
});

test("markProcessing throws, finalize then throws → markFailed called with incrementAttempt:true (attempt never counted)", async () => {
  const handler = require("../submit");
  let markFailedArgs;
  handler.__setDeps({
    enqueue: async () => ({ id: "sub-1", inserted: true }),
    markProcessing: async () => { throw new Error("claim failed"); },
    finalizeSubmission: async () => { throw new Error("db down"); },
    markDone: async () => {},
    markFailed: async (id, msg, opts) => { markFailedArgs = [id, msg, opts]; },
  });
  const req = { method: "POST", body: { submissionId: "sub-1", tenantId: "nium", company: { name: "Acme" } } };
  const res = fakeRes();
  await handler(req, res);
  assert.strictEqual(res.body.status, "queued");
  assert.deepStrictEqual(markFailedArgs, ["sub-1", "db down", { incrementAttempt: true }]);
});

test("returns 400 when submissionId is missing", async () => {
  const handler = require("../submit");
  handler.__setDeps({ enqueue: async () => ({}), finalizeSubmission: async () => ({}), markDone: async()=>{}, markFailed: async()=>{} });
  const req = { method: "POST", body: { tenantId: "nium", company: { name: "Acme" } } };
  const res = fakeRes();
  await handler(req, res);
  assert.strictEqual(res.statusCode, 400);
});

test("returns status:queued when DATABASE_URL is unset (no DB configured)", async () => {
  const handler = require("../submit");
  const prevUrl = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    handler.__setDeps({ enqueue: async () => ({}), finalizeSubmission: async () => ({}), markDone: async()=>{}, markFailed: async()=>{} });
    const req = { method: "POST", body: { submissionId: "sub-1", tenantId: "nium", company: { name: "Acme" } } };
    const res = fakeRes();
    await handler(req, res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.status, "queued");
  } finally {
    if (prevUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = prevUrl;
  }
});

test("returns 503 capture_failed when enqueue throws (finalize never called)", async () => {
  const handler = require("../submit");
  let finalizeCalled = false;
  handler.__setDeps({
    enqueue: async () => { throw new Error("db down"); },
    finalizeSubmission: async () => { finalizeCalled = true; return {}; },
    markDone: async () => {},
    markFailed: async () => {},
  });
  const req = { method: "POST", body: { submissionId: "sub-1", tenantId: "nium", company: { name: "Acme" } } };
  const res = fakeRes();
  await handler(req, res);
  assert.strictEqual(res.statusCode, 503);
  assert.strictEqual(res.body.status, "capture_failed");
  assert.strictEqual(finalizeCalled, false);
});

const submitHandler = require("../submit");

function linkDeps(actor, captured) {
  const real = require("../../lib/dossierAccess");
  return {
    access: { ...real, resolveDossierActor: async () => actor },
    enqueue: async (row) => { captured.enqueued = row.payload; },
    markProcessing: async () => {},
    finalizeSubmission: async (payload) => { captured.finalized = payload; return { sessionId: "s-1" }; },
    markDone: async () => {},
    markFailed: async () => {},
  };
}

const LINK_BODY = { submissionId: "sub-9", tenantId: "acme", company: { name: "Acme Ltd" }, dossierId: "d-1" };
const subReq = (body) => ({ method: "POST", body, headers: {}, query: {} });

test("a verified customer's submission keeps its dossier link", async () => {
  const captured = {};
  submitHandler.__setDeps(linkDeps({ kind: "customer", tenantId: "acme", dossierId: "d-1", reason: null }, captured));
  const res = fakeRes();
  await submitHandler(subReq({ ...LINK_BODY }), res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(captured.enqueued.dossierId, "d-1");
  assert.strictEqual(captured.finalized.dossierId, "d-1");
});

test("a dossier id without a matching customer credential is dropped", async () => {
  for (const actor of [
    { kind: "none", tenantId: null, dossierId: null, reason: "unauthorized" },
    { kind: "analyst", tenantId: "acme", dossierId: null, reason: null },
    { kind: "customer", tenantId: "acme", dossierId: "d-OTHER", reason: null },
    { kind: "customer", tenantId: "other-tenant", dossierId: "d-1", reason: null },
  ]) {
    const captured = {};
    submitHandler.__setDeps(linkDeps(actor, captured));
    await submitHandler(subReq({ ...LINK_BODY }), fakeRes());
    assert.strictEqual(captured.enqueued.dossierId, null, JSON.stringify(actor));
    assert.strictEqual(captured.finalized.dossierId, null);
  }
});

test("a credential check that throws drops the link but never blocks the submission", async () => {
  const captured = {};
  const deps = linkDeps(null, captured);
  deps.access = { ...deps.access, resolveDossierActor: async () => { throw new Error("revocation store down"); } };
  submitHandler.__setDeps(deps);
  const res = fakeRes();
  await submitHandler(subReq({ ...LINK_BODY }), res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(captured.enqueued.dossierId, null);
});
