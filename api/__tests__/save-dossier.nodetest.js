const { test, before, after } = require("node:test");
const assert = require("node:assert");
const handler = require("../save-dossier");

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

// Records statement kinds and the values bound to them.
function fakeSql({ lookupRow = null, updateRows = [{ id: "d-1" }], insertId = "d-new" } = {}) {
  const log = [];
  const sql = (strings, ...values) => {
    const text = strings.join(" ");
    if (/INSERT INTO entity_dossier_versions/i.test(text)) { log.push({ kind: "snapshot", text, values }); return Promise.resolve([]); }
    if (/INSERT INTO tenants/i.test(text)) { log.push({ kind: "tenants_upsert", values }); return Promise.resolve([]); }
    if (/SELECT[\s\S]*FROM entity_dossiers/i.test(text)) { log.push({ kind: "lookup", values }); return Promise.resolve(lookupRow ? [lookupRow] : []); }
    if (/UPDATE entity_dossiers/i.test(text)) { log.push({ kind: "update", text, values }); return Promise.resolve(updateRows); }
    if (/INSERT INTO entity_dossiers/i.test(text)) { log.push({ kind: "insert", text, values }); return Promise.resolve([{ id: insertId }]); }
    log.push({ kind: "unknown", values });
    return Promise.resolve([]);
  };
  sql.log = log;
  sql.kinds = () => log.map((l) => l.kind);
  return sql;
}

function accessWith(actor) {
  const real = require("../../lib/dossierAccess");
  return { ...real, resolveDossierActor: async () => actor };
}

const ANALYST = { kind: "analyst", tenantId: "acme", dossierId: null, reason: null };
const CUSTOMER = { kind: "customer", tenantId: "acme", dossierId: "d-1", reason: null };
const base = { company: { name: "Acme Ltd", code: "GB", countryName: "United Kingdom" }, entityType: "company" };
const req = (body) => ({ method: "POST", body, headers: {}, query: {} });

test("a DB failure reports a fixed code, never the raw error text", async () => {
  const throwingSql = (strings) => {
    const text = strings.join(" ");
    if (/INSERT INTO tenants/i.test(text)) return Promise.resolve([]);
    throw new Error("connection terminated unexpectedly — internal detail");
  };
  handler.__setDeps({ neon: () => throwingSql, access: accessWith(ANALYST) });
  const res = fakeRes();
  await handler(req({ ...base }), res);
  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(res.body, { success: false, dossierId: null, warning: "save_failed" });
});

test("no credential is a 401 and nothing is written", async () => {
  const sql = fakeSql();
  handler.__setDeps({ neon: () => sql, access: accessWith({ kind: "none", tenantId: null, dossierId: null, reason: "unauthorized" }) });
  const res = fakeRes();
  await handler(req({ ...base }), res);
  assert.strictEqual(res.statusCode, 401);
  assert.deepStrictEqual(sql.kinds(), []);
});

test("an analyst creates a dossier under the VERIFIED tenant, ignoring body.tenantId", async () => {
  const sql = fakeSql({ insertId: "d-fresh" });
  handler.__setDeps({ neon: () => sql, access: accessWith(ANALYST) });
  const res = fakeRes();
  await handler(req({ ...base, tenantId: "evil-tenant" }), res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.dossierId, "d-fresh");
  assert.deepStrictEqual(sql.kinds(), ["tenants_upsert", "insert"]);
  assert.ok(sql.log[0].values.includes("acme"));
  assert.ok(!sql.log[0].values.includes("evil-tenant"));
  assert.ok(sql.log[1].values.includes("acme"));
});

test("a customer can never create a dossier", async () => {
  const sql = fakeSql();
  handler.__setDeps({ neon: () => sql, access: accessWith(CUSTOMER) });
  const res = fakeRes();
  await handler(req({ ...base }), res);
  assert.strictEqual(res.statusCode, 403);
  assert.deepStrictEqual(res.body, { error: "forbidden" });
  assert.ok(!sql.kinds().includes("insert"));
});

test("an analyst updates its own analyst-owned dossier in place", async () => {
  const sql = fakeSql({ lookupRow: { id: "d-1", tenant_id: "acme", owned_by: "analyst" } });
  handler.__setDeps({ neon: () => sql, access: accessWith(ANALYST) });
  const res = fakeRes();
  await handler(req({ ...base, dossierId: "d-1" }), res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.dossierId, "d-1");
  assert.deepStrictEqual(sql.kinds(), ["lookup", "tenants_upsert", "snapshot", "update"]);
  // The UPDATE itself must re-check ownership (TOCTOU guard) — not just the
  // earlier permission SELECT. Removing this clause from the SQL must fail
  // this test.
  const update = sql.log.find((l) => l.kind === "update");
  assert.match(update.text, /owned_by\s*<>\s*'customer'/);
});

test("an analyst cannot update a customer-owned dossier", async () => {
  const sql = fakeSql({ lookupRow: { id: "d-1", tenant_id: "acme", owned_by: "customer" } });
  handler.__setDeps({ neon: () => sql, access: accessWith(ANALYST) });
  const res = fakeRes();
  await handler(req({ ...base, dossierId: "d-1" }), res);
  assert.strictEqual(res.statusCode, 403);
  assert.deepStrictEqual(res.body, { error: "dossier_locked" });
  assert.ok(!sql.kinds().includes("update"));
  assert.ok(!sql.kinds().includes("insert"));
});

test("TOCTOU: the row flips to customer-owned between the permission SELECT and the UPDATE — analyst gets 403 dossier_locked, never falls through to INSERT", async () => {
  // The permission SELECT sees owned_by:'analyst' (so canWriteDossier
  // permits), but a concurrent customer write flips owned_by before this
  // UPDATE runs. The re-check clause on the UPDATE's WHERE must then match
  // zero rows.
  const sql = fakeSql({ lookupRow: { id: "d-1", tenant_id: "acme", owned_by: "analyst" }, updateRows: [] });
  handler.__setDeps({ neon: () => sql, access: accessWith(ANALYST) });
  const res = fakeRes();
  await handler(req({ ...base, dossierId: "d-1" }), res);
  assert.strictEqual(res.statusCode, 403);
  assert.deepStrictEqual(res.body, { error: "dossier_locked" });
  assert.deepStrictEqual(sql.kinds(), ["lookup", "tenants_upsert", "snapshot", "update"]);
  assert.ok(!sql.kinds().includes("insert"), "must never fall through to INSERT after a raced UPDATE");
});

test("TOCTOU: a customer's dossier vanishes/locks between the permission SELECT and the UPDATE — 404, never an INSERT", async () => {
  const sql = fakeSql({ lookupRow: { id: "d-1", tenant_id: "acme", owned_by: "analyst" }, updateRows: [] });
  handler.__setDeps({ neon: () => sql, access: accessWith(CUSTOMER) });
  const res = fakeRes();
  await handler(req({ ...base, dossierId: "d-1" }), res);
  assert.strictEqual(res.statusCode, 404);
  assert.deepStrictEqual(res.body, { error: "dossier_not_found" });
  assert.ok(!sql.kinds().includes("insert"), "must never fall through to INSERT after a raced UPDATE");
});

test("an analyst's stale id still falls back to INSERT rather than dropping the save", async () => {
  const sql = fakeSql({ lookupRow: null, insertId: "d-2" });
  handler.__setDeps({ neon: () => sql, access: accessWith(ANALYST) });
  const res = fakeRes();
  await handler(req({ ...base, dossierId: "does-not-exist" }), res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.dossierId, "d-2");
  assert.deepStrictEqual(sql.kinds(), ["lookup", "tenants_upsert", "insert"]);
});

test("a customer update flips ownership to the customer", async () => {
  const sql = fakeSql({ lookupRow: { id: "d-1", tenant_id: "acme", owned_by: "analyst" } });
  handler.__setDeps({ neon: () => sql, access: accessWith(CUSTOMER) });
  const res = fakeRes();
  await handler(req({ ...base, dossierId: "d-1" }), res);
  assert.strictEqual(res.statusCode, 200);
  const update = sql.log.find((l) => l.kind === "update");
  assert.match(update.text, /owned_by/);
  assert.match(update.text, /last_customer_action_at/);
  assert.ok(update.values.includes("customer"));
});

test("a customer cannot update a different dossier than its token names", async () => {
  const sql = fakeSql({ lookupRow: { id: "d-2", tenant_id: "acme", owned_by: "analyst" } });
  handler.__setDeps({ neon: () => sql, access: accessWith(CUSTOMER) });
  const res = fakeRes();
  await handler(req({ ...base, dossierId: "d-2" }), res);
  assert.strictEqual(res.statusCode, 403);
  assert.ok(!sql.kinds().includes("update"));
});

test("a customer whose dossier no longer exists gets 404, not a fresh insert", async () => {
  const sql = fakeSql({ lookupRow: null });
  handler.__setDeps({ neon: () => sql, access: accessWith(CUSTOMER) });
  const res = fakeRes();
  await handler(req({ ...base, dossierId: "d-1" }), res);
  assert.strictEqual(res.statusCode, 404);
  assert.ok(!sql.kinds().includes("insert"));
});

test("400 when company.name is missing", async () => {
  handler.__setDeps({ neon: () => fakeSql(), access: accessWith(ANALYST) });
  const res = fakeRes();
  await handler(req({}), res);
  assert.strictEqual(res.statusCode, 400);
});

test("no DATABASE_URL → 200 with warning, database never touched", async () => {
  const prev = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    let neonCalled = false;
    handler.__setDeps({ neon: () => { neonCalled = true; return fakeSql(); }, access: accessWith(ANALYST) });
    const res = fakeRes();
    await handler(req({ ...base }), res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.success, false);
    assert.strictEqual(neonCalled, false);
  } finally {
    if (prev === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = prev;
  }
});

test("every update of an existing dossier snapshots the current row first", async () => {
  const sql = fakeSql({ lookupRow: { id: "d-1", tenant_id: "acme", owned_by: "analyst" } });
  handler.__setDeps({ neon: () => sql, access: accessWith(ANALYST) });
  const res = fakeRes();
  await handler(req({ ...base, dossierId: "d-1" }), res);
  assert.strictEqual(res.statusCode, 200);
  const kinds = sql.kinds();
  assert.ok(kinds.indexOf("snapshot") !== -1, "expected a snapshot");
  assert.ok(kinds.indexOf("snapshot") < kinds.indexOf("update"), "snapshot must precede the update");
  const snap = sql.log.find((l) => l.kind === "snapshot");
  assert.match(snap.text, /to_jsonb/i);
  assert.match(snap.text, /MAX\(\s*v\.version\s*\)/i);
  assert.ok(snap.values.includes("d-1"));
  assert.ok(snap.values.includes("acme"));
  assert.ok(snap.values.includes("analyst"));
  assert.ok(snap.values.includes("analyst_update"));
});

test("a customer correction snapshot records who and why", async () => {
  const sql = fakeSql({ lookupRow: { id: "d-1", tenant_id: "acme", owned_by: "analyst" } });
  handler.__setDeps({ neon: () => sql, access: accessWith(CUSTOMER) });
  await handler(req({ ...base, dossierId: "d-1", saveReason: "customer_correction" }), fakeRes());
  const snap = sql.log.find((l) => l.kind === "snapshot");
  assert.ok(snap.values.includes("customer"));
  assert.ok(snap.values.includes("customer_correction"));
});

test("an unknown saveReason falls back to the actor's default", async () => {
  const sql = fakeSql({ lookupRow: { id: "d-1", tenant_id: "acme", owned_by: "analyst" } });
  handler.__setDeps({ neon: () => sql, access: accessWith(CUSTOMER) });
  await handler(req({ ...base, dossierId: "d-1", saveReason: "drop table" }), fakeRes());
  const snap = sql.log.find((l) => l.kind === "snapshot");
  assert.ok(snap.values.includes("customer_update"));
  assert.ok(!snap.values.includes("drop table"));
});

test("the snapshot re-checks ownership so a locked analyst write leaves no history row", async () => {
  const sql = fakeSql({ lookupRow: { id: "d-1", tenant_id: "acme", owned_by: "analyst" } });
  handler.__setDeps({ neon: () => sql, access: accessWith(ANALYST) });
  await handler(req({ ...base, dossierId: "d-1" }), fakeRes());
  const snap = sql.log.find((l) => l.kind === "snapshot");
  assert.match(snap.text, /owned_by\s*<>\s*'customer'/);
});

test("a first save (insert) writes no snapshot", async () => {
  const sql = fakeSql({ insertId: "d-new" });
  handler.__setDeps({ neon: () => sql, access: accessWith(ANALYST) });
  await handler(req({ ...base }), fakeRes());
  assert.ok(!sql.kinds().includes("snapshot"));
});

test("searchAttempts in the body is ignored; search_attempts is never written", async () => {
  for (const lookupRow of [null, { id: "d-1", tenant_id: "acme", owned_by: "analyst" }]) {
    const sql = fakeSql({ lookupRow });
    handler.__setDeps({ neon: () => sql, access: accessWith(ANALYST) });
    await handler(req({ ...base, dossierId: lookupRow ? "d-1" : undefined, searchAttempts: 99 }), fakeRes());
    for (const entry of sql.log) {
      assert.ok(!entry.values.includes(99), `${entry.kind} bound searchAttempts`);
      if (entry.text) assert.doesNotMatch(entry.text, /search_attempts/);
    }
  }
});
