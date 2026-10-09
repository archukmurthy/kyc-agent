const { test, before, after } = require("node:test");
const assert = require("node:assert");
const handler = require("../get-dossier");

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

function fakeSql(row) {
  const calls = [];
  const sql = (strings, ...values) => { calls.push({ text: strings.join("?"), values }); return Promise.resolve(row ? [row] : []); };
  sql.calls = calls;
  return sql;
}

function accessWith(actor) {
  const real = require("../../lib/dossierAccess");
  return { ...real, resolveDossierActor: async () => actor };
}

const ROW = { id: "d-1", tenant_id: "acme", owned_by: "analyst", company_name: "Acme Ltd" };
const ANALYST = { kind: "analyst", tenantId: "acme", dossierId: null, reason: null };
const CUSTOMER = { kind: "customer", tenantId: "acme", dossierId: "d-1", reason: null };
const req = (query = {}) => ({ method: "GET", query, headers: {}, url: "/api/get-dossier" });

test("a DB failure reports a fixed code, never the raw error text", async () => {
  const throwingSql = () => { throw new Error("relation entity_dossiers does not exist - internal schema detail"); };
  handler.__setDeps({ neon: () => throwingSql, access: accessWith(ANALYST) });
  const res = fakeRes();
  await handler(req({ id: "d-1", tenant: "acme" }), res);
  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(res.body, { success: false, error: "load_failed" });
});

test("no credential is a 401 before any database work", async () => {
  const sql = fakeSql(ROW);
  handler.__setDeps({ neon: () => sql, access: accessWith({ kind: "none", tenantId: null, dossierId: null, reason: "unauthorized" }) });
  const res = fakeRes();
  await handler(req({ id: "d-1", tenant: "acme" }), res);
  assert.strictEqual(res.statusCode, 401);
  assert.deepStrictEqual(res.body, { error: "unauthorized" });
  assert.strictEqual(sql.calls.length, 0);
});

test("an expired customer link is a 410", async () => {
  handler.__setDeps({ neon: () => fakeSql(ROW), access: accessWith({ kind: "none", tenantId: null, dossierId: null, reason: "expired" }) });
  const res = fakeRes();
  await handler(req({ dossierToken: "t" }), res);
  assert.strictEqual(res.statusCode, 410);
  assert.deepStrictEqual(res.body, { error: "link_expired" });
});

test("a customer reads its own dossier without supplying an id", async () => {
  const sql = fakeSql(ROW);
  handler.__setDeps({ neon: () => sql, access: accessWith(CUSTOMER) });
  const res = fakeRes();
  await handler(req({ dossierToken: "t" }), res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.success, true);
  assert.strictEqual(res.body.dossier.id, "d-1");
  assert.strictEqual(res.body.dossier.owned_by, "analyst");
  // The query is scoped by the TOKEN's dossier and tenant, not by any request param.
  assert.ok(sql.calls[0].values.includes("d-1"));
  assert.ok(sql.calls[0].values.includes("acme"));
});

test("a customer supplying some other id still only reads the token's dossier", async () => {
  const sql = fakeSql(ROW);
  handler.__setDeps({ neon: () => sql, access: accessWith(CUSTOMER) });
  const res = fakeRes();
  await handler(req({ dossierToken: "t", id: "d-999" }), res);
  assert.strictEqual(res.statusCode, 200);
  assert.ok(!sql.calls[0].values.includes("d-999"));
});

test("an analyst must name the dossier", async () => {
  handler.__setDeps({ neon: () => fakeSql(ROW), access: accessWith(ANALYST) });
  const res = fakeRes();
  await handler(req({ tenant: "acme" }), res);
  assert.strictEqual(res.statusCode, 400);
  assert.deepStrictEqual(res.body, { error: "dossierId_required" });
});

test("an analyst reads a dossier in its tenant, including a customer-owned one", async () => {
  handler.__setDeps({ neon: () => fakeSql({ ...ROW, owned_by: "customer" }), access: accessWith(ANALYST) });
  const res = fakeRes();
  await handler(req({ tenant: "acme", id: "d-1" }), res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.dossier.owned_by, "customer");
});

test("a dossier that does not exist in the actor's tenant is a 404", async () => {
  handler.__setDeps({ neon: () => fakeSql(null), access: accessWith(ANALYST) });
  const res = fakeRes();
  await handler(req({ tenant: "acme", id: "d-1" }), res);
  assert.strictEqual(res.statusCode, 404);
  assert.deepStrictEqual(res.body, { success: false, error: "dossier_not_found" });
});

test("the dossier read includes the customer's re-search count", async () => {
  const sql = fakeSql({ ...ROW, customer_searches: 1 });
  handler.__setDeps({ neon: () => sql, access: accessWith(CUSTOMER) });
  const res = fakeRes();
  await handler(req(), res);
  assert.strictEqual(res.statusCode, 200);
  assert.match(sql.calls[0].text, /customer_searches/);
  assert.strictEqual(res.body.dossier.customer_searches, 1);
});
