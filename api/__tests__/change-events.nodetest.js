const { test, before, after } = require("node:test");
const assert = require("node:assert");
const handler = require("../change-events");

let prevUrl;
before(() => { prevUrl = process.env.DATABASE_URL; process.env.DATABASE_URL = "postgres://test"; });
after(() => { if (prevUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = prevUrl; });

function fakeRes() {
  return { statusCode: null, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}

function fakeSql(dossierRow, updateThrows = false) {
  const log = [];
  const sql = (strings, ...values) => {
    const text = strings.join(" ");
    log.push({ text, values });
    if (/SELECT[\s\S]*FROM entity_dossiers/i.test(text)) {
      // Mirror real Postgres: a `status != 'deleted'` clause in the query text
      // actually excludes a row whose status is 'deleted'. This is what makes
      // the "gate lookup must not filter on status" test meaningful — the test
      // fails against the un-fixed route (which still carries the clause) and
      // passes once it's removed.
      if (dossierRow && dossierRow.status === "deleted" && /status\s*!=\s*'deleted'/i.test(text)) {
        return Promise.resolve([]);
      }
      return Promise.resolve(dossierRow ? [dossierRow] : []);
    }
    if (/UPDATE entity_dossiers/i.test(text)) {
      if (updateThrows) return Promise.reject(new Error("ownership_update_failed"));
      return Promise.resolve([]);
    }
    return Promise.resolve([]);
  };
  sql.log = log;
  return sql;
}

function accessWith(actor) {
  const real = require("../../lib/dossierAccess");
  return { ...real, resolveDossierActor: async () => actor };
}

const ROW = { id: "d-1", tenant_id: "acme", owned_by: "analyst" };
const event = { submissionId: "d-1", fieldId: "company_name" };
const ANALYST = { kind: "analyst", tenantId: "acme", dossierId: null, reason: null };
const CUSTOMER = { kind: "customer", tenantId: "acme", dossierId: "d-1", reason: null };

function deps(sql, actor, onWrite) {
  return {
    neon: () => sql,
    writeEvent: async (_sql, ev) => { if (onWrite) onWrite(ev); return { id: "e-1", field_id: ev.fieldId, workflow: "x" }; },
    access: accessWith(actor),
  };
}

test("a writeEvent failure reports a fixed code, never the raw error text", async () => {
  const sql = fakeSql(null);
  handler.__setDeps({
    neon: () => sql,
    writeEvent: async () => { throw new Error("writeEvent: fieldClass \"manager\" is not in the allowed enum [...]"); },
    access: accessWith({ kind: "none", tenantId: null, dossierId: null, reason: "unauthorized" }),
  });
  const res = fakeRes();
  await handler({ method: "POST", body: { ...event, submissionId: "fresh-app" }, headers: {}, query: {} }, res);
  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(res.body, { success: false, warning: "event_write_failed" });
});

test("a fresh application (no matching dossier) writes exactly as before, with no credential", async () => {
  let wrote = false;
  const sql = fakeSql(null);
  handler.__setDeps(deps(sql, { kind: "none", tenantId: null, dossierId: null, reason: "unauthorized" }, () => { wrote = true; }));
  const res = fakeRes();
  await handler({ method: "POST", body: { ...event, submissionId: "fresh-app" }, headers: {}, query: {} }, res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.success, true);
  assert.strictEqual(wrote, true);
});

test("a dossier-keyed record with no credential is refused and not written", async () => {
  let wrote = false;
  handler.__setDeps(deps(fakeSql(ROW), { kind: "none", tenantId: null, dossierId: null, reason: "unauthorized" }, () => { wrote = true; }));
  const res = fakeRes();
  await handler({ method: "POST", body: { ...event }, headers: {}, query: {} }, res);
  assert.strictEqual(res.statusCode, 401);
  assert.strictEqual(wrote, false);
});

test("an analyst cannot add records to a customer-owned dossier", async () => {
  let wrote = false;
  handler.__setDeps(deps(fakeSql({ ...ROW, owned_by: "customer" }), ANALYST, () => { wrote = true; }));
  const res = fakeRes();
  await handler({ method: "POST", body: { ...event }, headers: {}, query: {} }, res);
  assert.strictEqual(res.statusCode, 403);
  assert.deepStrictEqual(res.body, { error: "dossier_locked" });
  assert.strictEqual(wrote, false);
});

test("a customer's record is written and transfers ownership of the dossier", async () => {
  let wrote = false;
  const sql = fakeSql(ROW);
  handler.__setDeps(deps(sql, CUSTOMER, () => { wrote = true; }));
  const res = fakeRes();
  await handler({ method: "POST", body: { ...event }, headers: {}, query: {} }, res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(wrote, true);
  const flip = sql.log.find((s) => /UPDATE entity_dossiers/i.test(s.text));
  assert.ok(flip, "expected an ownership update");
  assert.match(flip.text, /owned_by/);
  assert.ok(flip.values.includes("d-1"));
});

test("a customer's ownership UPDATE throws → no change record is written", async () => {
  let wrote = false;
  const sql = fakeSql(ROW, true); // updateThrows = true
  handler.__setDeps(deps(sql, CUSTOMER, () => { wrote = true; }));
  const res = fakeRes();
  await handler({ method: "POST", body: { ...event }, headers: {}, query: {} }, res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.success, false);
  assert.strictEqual(wrote, false, "expected no event written when ownership update fails");
});

test("a soft-deleted dossier's id still requires a credential — it is not a fresh application", async () => {
  let wrote = false;
  const sql = fakeSql({ ...ROW, status: "deleted" });
  handler.__setDeps(deps(sql, { kind: "none", tenantId: null, dossierId: null, reason: "unauthorized" }, () => { wrote = true; }));
  const res = fakeRes();
  await handler({ method: "POST", body: { ...event }, headers: {}, query: {} }, res);
  assert.strictEqual(res.statusCode, 401);
  assert.strictEqual(wrote, false);
});

test("a credentialed customer cannot write to a soft-deleted dossier — no write, no ownership flip", async () => {
  let wrote = false;
  const sql = fakeSql({ ...ROW, status: "deleted" });
  handler.__setDeps(deps(sql, CUSTOMER, () => { wrote = true; }));
  const res = fakeRes();
  await handler({ method: "POST", body: { ...event }, headers: {}, query: {} }, res);
  assert.strictEqual(res.statusCode, 404);
  assert.deepStrictEqual(res.body, { error: "dossier_not_found" });
  assert.strictEqual(wrote, false);
  assert.ok(!sql.log.some((s) => /UPDATE entity_dossiers/i.test(s.text)), "expected no ownership update");
});

test("a credentialed analyst cannot write to a soft-deleted dossier", async () => {
  let wrote = false;
  const sql = fakeSql({ ...ROW, status: "deleted" });
  handler.__setDeps(deps(sql, ANALYST, () => { wrote = true; }));
  const res = fakeRes();
  await handler({ method: "POST", body: { ...event }, headers: {}, query: {} }, res);
  assert.strictEqual(res.statusCode, 404);
  assert.deepStrictEqual(res.body, { error: "dossier_not_found" });
  assert.strictEqual(wrote, false);
});

test("a customer cannot add records to another dossier", async () => {
  let wrote = false;
  handler.__setDeps(deps(fakeSql({ ...ROW, id: "d-2" }), CUSTOMER, () => { wrote = true; }));
  const res = fakeRes();
  await handler({ method: "POST", body: { ...event, submissionId: "d-2" }, headers: {}, query: {} }, res);
  assert.strictEqual(res.statusCode, 403);
  assert.strictEqual(wrote, false);
});
