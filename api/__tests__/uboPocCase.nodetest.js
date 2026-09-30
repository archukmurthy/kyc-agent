"use strict";

// api/ubo-poc-case.js holds a UBO case: the company, the answers, the
// assessment. It arrived with no gate at all - anyone holding a case id could
// read or rewrite the case, and every case was filed under a hard-coded tenant.
// These tests are written from the caller's side: who gets in, and whose
// workspace they land in.

const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");

const route = require("../ubo-poc-case");
const { PostgresPocCaseRepository } = require("../../ubo-control-lab/server/pocCaseState");

function fakeRes() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; return this; },
    json(value) { this.body = value; return this; },
    end() { return this; },
  };
}

let factoryCalls;
function service() {
  return {
    load: async (caseId) => ({ caseId }),
    apply: async (command) => ({ caseId: command.caseId }),
  };
}
function factory(tenantId) {
  factoryCalls.push(tenantId);
  return { service: service(), close: async () => {} };
}

function handlerWith({ actor = { kind: "staff", tenantId: "acme", role: "analyst" }, limited = false } = {}) {
  const calls = { limiter: [], gate: [] };
  const handler = route.createHandler(factory, {
    applyCors: () => false,
    enforceRateLimit: async (req, res, bucket) => {
      calls.limiter.push(bucket);
      if (limited) { res.status(429).json({ error: "rate_limited" }); return false; }
      return true;
    },
    requireUboCaller: async (req, res, options) => {
      calls.gate.push(options);
      if (!actor) { res.status(401).json({ error: "unauthorized" }); return null; }
      return actor;
    },
  });
  return { handler, calls };
}

let savedDevTenant;
beforeEach(() => {
  factoryCalls = [];
  savedDevTenant = process.env.UBO_DEV_TENANT_ID;
  delete process.env.UBO_DEV_TENANT_ID;
});
afterEach(() => {
  if (savedDevTenant === undefined) delete process.env.UBO_DEV_TENANT_ID;
  else process.env.UBO_DEV_TENANT_ID = savedDevTenant;
});

test("a caller who is not signed in never reaches the case store", async () => {
  const { handler } = handlerWith({ actor: null });
  const res = fakeRes();
  await handler({ method: "GET", query: { caseId: "case-1" }, headers: {} }, res);
  assert.strictEqual(res.statusCode, 401);
  assert.deepStrictEqual(factoryCalls, []);
});

test("the rate limit is checked before anything is read", async () => {
  const { handler, calls } = handlerWith({ limited: true });
  const res = fakeRes();
  await handler({ method: "POST", body: { caseId: "case-1", operation: "UPSERT_CASE" }, headers: {} }, res);
  assert.strictEqual(res.statusCode, 429);
  assert.deepStrictEqual(calls.limiter, ["ubo-poc-case"]);
  assert.deepStrictEqual(factoryCalls, []);
});

test("a case is read and written in the caller's own workspace", async () => {
  const { handler } = handlerWith({ actor: { kind: "staff", tenantId: "acme", role: "analyst" } });
  await handler({ method: "GET", query: { caseId: "case-1" }, headers: {} }, fakeRes());
  await handler({ method: "POST", body: { caseId: "case-1", operation: "UPSERT_CASE" }, headers: {} }, fakeRes());
  assert.deepStrictEqual(factoryCalls, ["acme", "acme"]);
});

test("a workspace named in the request is ignored", async () => {
  const { handler } = handlerWith({ actor: { kind: "staff", tenantId: "acme", role: "analyst" } });
  const req = {
    method: "POST",
    query: { tenant: "victim" },
    headers: { "x-tenant-id": "victim" },
    body: { caseId: "case-1", operation: "UPSERT_CASE", tenantId: "victim" },
  };
  await handler(req, fakeRes());
  assert.deepStrictEqual(factoryCalls, ["acme"]);
});

test("a caller with no workspace is refused, never given a default one", async () => {
  const { handler } = handlerWith({ actor: { kind: "unauthenticated", tenantId: null, role: null } });
  const res = fakeRes();
  await handler({ method: "GET", query: { caseId: "case-1" }, headers: {} }, res);
  assert.strictEqual(res.statusCode, 400);
  assert.strictEqual(res.body.error, "tenant_required");
  assert.deepStrictEqual(factoryCalls, []);
});

test("local development without sign-in uses the explicitly configured dev workspace", async () => {
  process.env.UBO_DEV_TENANT_ID = "local-dev";
  const { handler } = handlerWith({ actor: { kind: "unauthenticated", tenantId: null, role: null } });
  await handler({ method: "GET", query: { caseId: "case-1" }, headers: {} }, fakeRes());
  assert.deepStrictEqual(factoryCalls, ["local-dev"]);
});

test("the dev workspace never applies to a signed-in caller", async () => {
  process.env.UBO_DEV_TENANT_ID = "local-dev";
  const { handler } = handlerWith({ actor: { kind: "staff", tenantId: null, role: "owner" } });
  const res = fakeRes();
  await handler({ method: "GET", query: { caseId: "case-1" }, headers: {} }, res);
  assert.strictEqual(res.statusCode, 400);
  assert.deepStrictEqual(factoryCalls, []);
});

test("an oversized case write is refused before it reaches the database", async () => {
  const { handler } = handlerWith();
  const res = fakeRes();
  const body = { caseId: "case-1", operation: "SAVE_RESEARCH", payload: { blob: "x".repeat(route.MAX_BODY_BYTES) } };
  await handler({ method: "POST", body, headers: {} }, res);
  assert.strictEqual(res.statusCode, 413);
  assert.deepStrictEqual(factoryCalls, []);
});

test("the case store cannot be built without a workspace", () => {
  assert.throws(() => new PostgresPocCaseRepository({}), /tenant/i);
  assert.throws(() => new PostgresPocCaseRepository({}, ""), /tenant/i);
});

test("the dev workspace is never used on a hosted deployment", async () => {
  // If Clerk's key were ever missing on Vercel, every caller would arrive as
  // "unauthenticated". A copied UBO_DEV_TENANT_ID must not then hand strangers
  // a real workspace - hosted, no sign-in means no workspace.
  const savedVercel = process.env.VERCEL;
  process.env.VERCEL = "1";
  process.env.UBO_DEV_TENANT_ID = "local-dev";
  try {
    const { handler } = handlerWith({ actor: { kind: "unauthenticated", tenantId: null, role: null } });
    const res = fakeRes();
    await handler({ method: "GET", query: { caseId: "case-1" }, headers: {} }, res);
    assert.strictEqual(res.statusCode, 400);
    assert.deepStrictEqual(factoryCalls, []);
  } finally {
    if (savedVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = savedVercel;
  }
});

test("the caller's workspace row exists before a case is written", async () => {
  // Every UBO and Evidence table references tenants(id). A trial workspace
  // (trial-acme-1a2b3c4d) had no row there, so every case save by a trial
  // tester failed on the foreign key. The route makes sure it exists.
  const queries = [];
  const handler = route.createHandler((tenantId) => {
    factoryCalls.push(tenantId);
    return { db: { query: async (text, params) => { queries.push({ text, params }); return { rows: [] }; } }, service: service(), close: async () => {} };
  }, { applyCors: () => false, enforceRateLimit: async () => true, requireUboCaller: async () => ({ kind: "staff", tenantId: "trial-acme-1a2b3c4d", role: "analyst" }) });
  await handler({ method: "POST", body: { caseId: "case-1", operation: "UPSERT_CASE" }, headers: {} }, fakeRes());
  assert.strictEqual(queries.length, 1);
  assert.match(queries[0].text, /INSERT INTO tenants/);
  assert.deepStrictEqual(queries[0].params, ["trial-acme-1a2b3c4d"]);
});

// Customers (a session for ONE case, lib/uboCustomerLink.js).
const CUSTOMER = { kind: "customer", tenantId: "trial-acme-1a2b3c4d", caseId: "case-1", role: "customer" };

function recordingHandler(actor) {
  const applied = [];
  const loaded = [];
  const handler = route.createHandler((tenantId) => {
    factoryCalls.push(tenantId);
    return {
      service: { load: async (caseId) => { loaded.push(caseId); return { caseId }; }, apply: async (command) => { applied.push(command); return { caseId: command.caseId }; } },
      close: async () => {},
    };
  }, { applyCors: () => false, enforceRateLimit: async () => true, requireUboCaller: async () => actor });
  return { handler, applied, loaded };
}

test("a customer reads their own case and no other", async () => {
  const { handler, loaded } = recordingHandler(CUSTOMER);
  const own = fakeRes();
  await handler({ method: "GET", query: { caseId: "case-1" }, headers: {} }, own);
  assert.strictEqual(own.statusCode, 200);
  const other = fakeRes();
  await handler({ method: "GET", query: { caseId: "case-2" }, headers: {} }, other);
  assert.strictEqual(other.statusCode, 404, "the same answer as a case that does not exist");
  assert.deepStrictEqual(loaded, ["case-1"]);
});

test("a customer can answer their own case, recorded as the customer whatever the request claims", async () => {
  const { handler, applied } = recordingHandler(CUSTOMER);
  const res = fakeRes();
  await handler({ method: "POST", headers: {}, body: { caseId: "case-1", operation: "SUBMIT_ANSWER", idempotencyKey: "k", actorType: "ANALYST", payload: {} } }, res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(applied[0].actorType, "CUSTOMER");
});

test("a customer cannot write to another case", async () => {
  const { handler, applied } = recordingHandler(CUSTOMER);
  const res = fakeRes();
  await handler({ method: "POST", headers: {}, body: { caseId: "case-2", operation: "SUBMIT_ANSWER", idempotencyKey: "k", payload: {} } }, res);
  assert.strictEqual(res.statusCode, 404);
  const sneaky = fakeRes();
  await handler({ method: "POST", headers: {}, body: { operation: "UPSERT_CASE", idempotencyKey: "k", payload: { demoCase: { demoCaseId: "case-2" } } } }, sneaky);
  assert.strictEqual(sneaky.statusCode, 404, "the case id inside the payload is checked too");
  assert.deepStrictEqual(applied, []);
});

test("a customer cannot do the analyst's work on their case", async () => {
  const { handler, applied } = recordingHandler(CUSTOMER);
  for (const operation of ["SAVE_RESEARCH", "SAVE_ANALYST_STATE", "SOMETHING_NEW"]) {
    const res = fakeRes();
    await handler({ method: "POST", headers: {}, body: { caseId: "case-1", operation, idempotencyKey: "k", payload: {} } }, res);
    assert.strictEqual(res.statusCode, 403, operation);
  }
  assert.deepStrictEqual(applied, []);
});

test("an analyst's operations are recorded as the analyst's", async () => {
  const { handler, applied } = recordingHandler({ kind: "staff", tenantId: "trial-acme-1a2b3c4d", role: "analyst" });
  await handler({ method: "POST", headers: {}, body: { caseId: "case-1", operation: "SAVE_RESEARCH", idempotencyKey: "k", actorType: "CUSTOMER", payload: {} } }, fakeRes());
  assert.strictEqual(applied[0].actorType, "ANALYST");
});
