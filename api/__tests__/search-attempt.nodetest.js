const { test, before, after } = require("node:test");
const assert = require("node:assert");
const handler = require("../search-attempt");

let prevUrl;
before(() => { prevUrl = process.env.DATABASE_URL; process.env.DATABASE_URL = "postgres://test"; });
after(() => { if (prevUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = prevUrl; });

function fakeRes() {
  return { statusCode: null, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}

function fakeSql(row) {
  const log = [];
  const sql = (strings, ...values) => {
    const text = strings.join(" ");
    log.push({ text, values });
    if (/UPDATE entity_dossiers/i.test(text)) return Promise.resolve(row ? [{ search_attempts: (row.search_attempts || 0) + 1 }] : []);
    return Promise.resolve(row ? [row] : []);
  };
  sql.log = log;
  return sql;
}

function accessWith(actor) {
  const real = require("../../lib/dossierAccess");
  return { ...real, resolveDossierActor: async () => actor };
}

const ROW = { id: "d-1", tenant_id: "acme", owned_by: "analyst", search_attempts: 1 };
const ANALYST = { kind: "analyst", tenantId: "acme", dossierId: null, reason: null };
const CUSTOMER = { kind: "customer", tenantId: "acme", dossierId: "d-1", reason: null };

test("a DB failure reports a fixed code, never the raw error text", async () => {
  const throwingSql = () => { throw new Error("connection terminated unexpectedly — internal detail"); };
  handler.__setDeps({ neon: () => throwingSql, access: accessWith(ANALYST) });
  const res = fakeRes();
  await handler({ method: "POST", body: { dossierId: "d-1" }, query: {}, headers: {} }, res);
  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(res.body, { attempts: null, warning: "search_attempt_failed" });
});

test("no credential is a 401 and the counter is untouched", async () => {
  const sql = fakeSql(ROW);
  handler.__setDeps({ neon: () => sql, access: accessWith({ kind: "none", tenantId: null, dossierId: null, reason: "unauthorized" }) });
  const res = fakeRes();
  await handler({ method: "POST", body: { dossierId: "d-1" }, query: {}, headers: {} }, res);
  assert.strictEqual(res.statusCode, 401);
  assert.strictEqual(sql.log.length, 0);
});

test("every statement is scoped by the verified tenant", async () => {
  const sql = fakeSql(ROW);
  handler.__setDeps({ neon: () => sql, access: accessWith(CUSTOMER) });
  const res = fakeRes();
  await handler({ method: "POST", body: {}, query: {}, headers: {} }, res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.attempts, 2);
  for (const stmt of sql.log) {
    assert.match(stmt.text, /tenant_id/, "every statement must filter on tenant_id");
    assert.ok(stmt.values.includes("acme"));
  }
});

test("a customer reads its own counter from the token, ignoring a supplied id", async () => {
  const sql = fakeSql(ROW);
  handler.__setDeps({ neon: () => sql, access: accessWith(CUSTOMER) });
  const res = fakeRes();
  await handler({ method: "GET", query: { dossierId: "d-999" }, headers: {} }, res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.attempts, 1);
  assert.ok(!sql.log[0].values.includes("d-999"));
});

test("an analyst must name the dossier", async () => {
  handler.__setDeps({ neon: () => fakeSql(ROW), access: accessWith(ANALYST) });
  const res = fakeRes();
  await handler({ method: "GET", query: {}, headers: {} }, res);
  assert.strictEqual(res.statusCode, 400);
  assert.deepStrictEqual(res.body, { error: "dossierId_required" });
});

test("an analyst cannot increment a customer-owned dossier's counter", async () => {
  const sql = fakeSql({ ...ROW, owned_by: "customer" });
  handler.__setDeps({ neon: () => sql, access: accessWith(ANALYST) });
  const res = fakeRes();
  await handler({ method: "POST", body: { dossierId: "d-1" }, query: {}, headers: {} }, res);
  assert.strictEqual(res.statusCode, 403);
  assert.deepStrictEqual(res.body, { error: "dossier_locked" });
  assert.ok(!sql.log.some((s) => /UPDATE/i.test(s.text)));
});

test("a dossier in another tenant is a 404", async () => {
  handler.__setDeps({ neon: () => fakeSql(null), access: accessWith(ANALYST) });
  const res = fakeRes();
  await handler({ method: "GET", query: { dossierId: "d-1" }, headers: {} }, res);
  assert.strictEqual(res.statusCode, 404);
});
