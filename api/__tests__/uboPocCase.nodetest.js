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


test("a customer cannot create a case, only work on one that exists", async () => {
  // Review: a customer holding a link to a deleted case (a purged trial) could
  // write it back into existence.
  const applied = [];
  const handler = route.createHandler(() => ({
    service: { load: async () => null, apply: async (command) => { applied.push(command); return {}; } },
    close: async () => {},
  }), { applyCors: () => false, enforceRateLimit: async () => true, requireUboCaller: async () => CUSTOMER });
  const res = fakeRes();
  await handler({ method: "POST", headers: {}, body: { caseId: "case-1", operation: "UPSERT_CASE", idempotencyKey: "k", payload: {} } }, res);
  assert.strictEqual(res.statusCode, 404);
  assert.deepStrictEqual(applied, []);
});

// UBO-33: the audit ledger's who, when and which request come from the
// credential and the server - never from the request body.
test("who acted, when it arrived and the correlation id are the server's, not the request's", async () => {
  factoryCalls = [];
  let applied;
  const handler = route.createHandler(() => ({ service: { load: async () => ({}), apply: async (command) => { applied = command; return {}; } }, close: async () => {} }), {
    applyCors: () => false,
    enforceRateLimit: async () => true,
    requireUboCaller: async () => ({ kind: "customer", tenantId: "acme", caseId: "case-1", userId: "user_real" }),
  });
  const res = fakeRes();
  await handler({ method: "POST", headers: { "x-correlation-id": "corr-from-caller-123" }, query: {}, body: { operation: "RESET_ANSWERS", caseId: "case-1", idempotencyKey: "k", actorId: "user_forged", actorType: "ANALYST", receivedAt: "2000-01-01T00:00:00.000Z", correlationId: "forged", payload: {} } }, res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(applied.actorId, "user_real");
  assert.strictEqual(applied.actorType, "CUSTOMER");
  assert.notStrictEqual(applied.receivedAt, "2000-01-01T00:00:00.000Z");
  assert.strictEqual(applied.correlationId, "corr-from-caller-123", "a caller's plain correlation id is carried");
  assert.strictEqual(res.headers["x-correlation-id"], "corr-from-caller-123");
});

test("a correlation id that is not a plain id is replaced", async () => {
  let applied;
  const handler = route.createHandler(() => ({ service: { load: async () => ({}), apply: async (command) => { applied = command; return {}; } }, close: async () => {} }), {
    applyCors: () => false, enforceRateLimit: async () => true, requireUboCaller: async () => ({ kind: "staff", tenantId: "acme", role: "analyst", userId: "user_a" }),
  });
  await handler({ method: "POST", headers: { "x-correlation-id": "<script>" }, query: {}, body: { operation: "UPSERT_CASE", caseId: "case-1", idempotencyKey: "k", payload: {} } }, fakeRes());
  assert.match(applied.correlationId, /^[0-9a-f-]{36}$/);
});

test("the audit ledger is read by staff; to a customer it does not exist", async () => {
  const ledgerService = { load: async () => ({}), ledger: async (caseId) => [{ eventType: "CASE_CREATED", caseId }] };
  const make = (actor) => route.createHandler(() => ({ service: ledgerService, close: async () => {} }), { applyCors: () => false, enforceRateLimit: async () => true, requireUboCaller: async () => actor });
  const staff = fakeRes();
  await make({ kind: "staff", tenantId: "acme", role: "analyst" })({ method: "GET", headers: {}, query: { caseId: "case-1", ledger: "1" } }, staff);
  assert.strictEqual(staff.statusCode, 200);
  assert.deepStrictEqual(staff.body.events, [{ eventType: "CASE_CREATED", caseId: "case-1" }]);
  const customer = fakeRes();
  await make({ kind: "customer", tenantId: "acme", caseId: "case-1" })({ method: "GET", headers: {}, query: { caseId: "case-1", ledger: "1" } }, customer);
  assert.strictEqual(customer.statusCode, 404);
});

// The workspace's saved research (start a new case without a provider call)
// is the analyst's: listed in the caller's own workspace, never to a customer.
test("saved research is listed for staff in their own workspace; to a customer it does not exist", async () => {
  const workspaces = [];
  const listService = { load: async () => ({}), savedResearch: async () => [{ caseId: "case-1", company: { legalName: "Example Limited", registrationNumber: "00000001", countryCode: "GB" } }] };
  const make = (actor) => route.createHandler((tenantId) => { workspaces.push(tenantId); return { service: listService, close: async () => {} }; }, { applyCors: () => false, enforceRateLimit: async () => true, requireUboCaller: async () => actor });
  const staff = fakeRes();
  await make({ kind: "staff", tenantId: "acme", role: "analyst" })({ method: "GET", headers: {}, query: { savedResearch: "1", tenantId: "other" } }, staff);
  assert.strictEqual(staff.statusCode, 200);
  assert.deepStrictEqual(staff.body.research.map(({ caseId }) => caseId), ["case-1"]);
  assert.deepStrictEqual(workspaces, ["acme"]);
  const customer = fakeRes();
  await make({ kind: "customer", tenantId: "acme", caseId: "case-1" })({ method: "GET", headers: {}, query: { savedResearch: "1", caseId: "case-1" } }, customer);
  assert.strictEqual(customer.statusCode, 404);
  assert.strictEqual(customer.body.research, undefined);
});

test("the saved research query is confined to the repository's workspace", async () => {
  const queries = [];
  const db = { query: async (sql, params) => { queries.push({ sql, params }); return { rows: [{ case_id: "case-1", company: { legalName: "Example Limited", registrationNumber: "00000001", countryCode: "GB", secret: "x" }, status: "COMPLETE", updated_at: "2026-10-03T00:00:00Z" }] }; } };
  const listed = await new PostgresPocCaseRepository(db, "acme").savedResearch();
  assert.match(queries[0].sql, /WHERE tenant_id = \$1/);
  assert.strictEqual(queries[0].params[0], "acme");
  assert.deepStrictEqual(listed[0].company, { legalName: "Example Limited", registrationNumber: "00000001", countryCode: "GB" });
});
