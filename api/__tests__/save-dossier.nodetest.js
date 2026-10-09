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
//
// `snapshotUpdateResults`, when given, is a queue consumed one entry per
// call to the combined WITH-snapshot/UPDATE statement: each entry is either
// `{ rows }` (resolve) or `{ error }` (reject) - the last entry repeats once
// the queue is exhausted. Lets tests drive the 23505-retry path without a
// real database.
function fakeSql({ lookupRow = null, updateRows = [{ id: "d-1" }], insertId = "d-new", snapshotUpdateResults = null } = {}) {
  const log = [];
  let snapshotUpdateCalls = 0;
  const sql = (strings, ...values) => {
    const text = strings.join(" ");
    // Must be checked before the plain "lookup"/"insert" checks below: the
    // combined statement's snap CTE also contains a SELECT ... FROM
    // entity_dossiers, and "entity_dossier_versions" also matches a naive
    // "INSERT INTO entity_dossiers" check.
    if (/WITH[\s\S]*INSERT INTO entity_dossier_versions[\s\S]*UPDATE entity_dossiers/i.test(text)) {
      log.push({ kind: "snapshot_update", text, values });
      if (snapshotUpdateResults) {
        const entry = snapshotUpdateResults[Math.min(snapshotUpdateCalls, snapshotUpdateResults.length - 1)];
        snapshotUpdateCalls++;
        return entry.error ? Promise.reject(entry.error) : Promise.resolve(entry.rows);
      }
      return Promise.resolve(updateRows);
    }
    if (/INSERT INTO tenants/i.test(text)) { log.push({ kind: "tenants_upsert", values }); return Promise.resolve([]); }
    if (/SELECT[\s\S]*FROM entity_dossiers/i.test(text)) { log.push({ kind: "lookup", values }); return Promise.resolve(lookupRow ? [lookupRow] : []); }
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
    throw new Error("connection terminated unexpectedly - internal detail");
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
  assert.deepStrictEqual(sql.kinds(), ["lookup", "tenants_upsert", "snapshot_update"]);
  // The UPDATE itself must re-check ownership (TOCTOU guard) - not just the
  // earlier permission SELECT. Removing this clause from the SQL must fail
  // this test.
  const update = sql.log.find((l) => l.kind === "snapshot_update");
  assert.match(update.text, /owned_by\s*<>\s*'customer'/);
});

test("an analyst cannot update a customer-owned dossier", async () => {
  const sql = fakeSql({ lookupRow: { id: "d-1", tenant_id: "acme", owned_by: "customer" } });
  handler.__setDeps({ neon: () => sql, access: accessWith(ANALYST) });
  const res = fakeRes();
  await handler(req({ ...base, dossierId: "d-1" }), res);
  assert.strictEqual(res.statusCode, 403);
  assert.deepStrictEqual(res.body, { error: "dossier_locked" });
  assert.ok(!sql.kinds().includes("snapshot_update"));
  assert.ok(!sql.kinds().includes("insert"));
});

test("TOCTOU: the row flips to customer-owned between the permission SELECT and the UPDATE - analyst gets 403 dossier_locked, never falls through to INSERT", async () => {
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
  assert.deepStrictEqual(sql.kinds(), ["lookup", "tenants_upsert", "snapshot_update"]);
  assert.ok(!sql.kinds().includes("insert"), "must never fall through to INSERT after a raced UPDATE");
});

test("TOCTOU: a customer's dossier vanishes/locks between the permission SELECT and the UPDATE - 404, never an INSERT", async () => {
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
  const update = sql.log.find((l) => l.kind === "snapshot_update");
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
  assert.ok(!sql.kinds().includes("snapshot_update"));
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

test("every update of an existing dossier is a single statement that snapshots the current row and updates it", async () => {
  const sql = fakeSql({ lookupRow: { id: "d-1", tenant_id: "acme", owned_by: "analyst" } });
  handler.__setDeps({ neon: () => sql, access: accessWith(ANALYST) });
  const res = fakeRes();
  await handler(req({ ...base, dossierId: "d-1" }), res);
  assert.strictEqual(res.statusCode, 200);
  // Exactly one statement (plus the tenants upsert and the earlier lookup),
  // not a separate snapshot statement followed by a separate update.
  assert.deepStrictEqual(sql.kinds(), ["lookup", "tenants_upsert", "snapshot_update"]);
  const snap = sql.log.find((l) => l.kind === "snapshot_update");
  // Both halves are present in the one statement...
  assert.match(snap.text, /INSERT INTO entity_dossier_versions/i);
  assert.match(snap.text, /to_jsonb/i);
  assert.match(snap.text, /MAX\(\s*v\.version\s*\)/i);
  assert.match(snap.text, /UPDATE entity_dossiers/i);
  // ...and the ownership re-check appears in BOTH the versions-insert's
  // WHERE and the update's WHERE, not just one of them.
  const recheckCount = (snap.text.match(/owned_by\s*<>\s*'customer'/g) || []).length;
  assert.strictEqual(recheckCount, 2, "the ownership re-check must appear in both the snapshot insert and the update");
  assert.ok(snap.values.includes("d-1"));
  assert.ok(snap.values.includes("acme"));
  assert.ok(snap.values.includes("analyst"));
  assert.ok(snap.values.includes("analyst_update"));
});

test("a customer correction snapshot records who and why", async () => {
  const sql = fakeSql({ lookupRow: { id: "d-1", tenant_id: "acme", owned_by: "analyst" } });
  handler.__setDeps({ neon: () => sql, access: accessWith(CUSTOMER) });
  await handler(req({ ...base, dossierId: "d-1", saveReason: "customer_correction" }), fakeRes());
  const snap = sql.log.find((l) => l.kind === "snapshot_update");
  assert.ok(snap.values.includes("customer"));
  assert.ok(snap.values.includes("customer_correction"));
});

test("an unknown saveReason falls back to the actor's default", async () => {
  const sql = fakeSql({ lookupRow: { id: "d-1", tenant_id: "acme", owned_by: "analyst" } });
  handler.__setDeps({ neon: () => sql, access: accessWith(CUSTOMER) });
  await handler(req({ ...base, dossierId: "d-1", saveReason: "drop table" }), fakeRes());
  const snap = sql.log.find((l) => l.kind === "snapshot_update");
  assert.ok(snap.values.includes("customer_update"));
  assert.ok(!snap.values.includes("drop table"));
});

test("the snapshot re-checks ownership so a locked analyst write leaves no history row", async () => {
  const sql = fakeSql({ lookupRow: { id: "d-1", tenant_id: "acme", owned_by: "analyst" } });
  handler.__setDeps({ neon: () => sql, access: accessWith(ANALYST) });
  await handler(req({ ...base, dossierId: "d-1" }), fakeRes());
  const snap = sql.log.find((l) => l.kind === "snapshot_update");
  assert.match(snap.text, /owned_by\s*<>\s*'customer'/);
});

test("a first save (insert) writes no snapshot", async () => {
  const sql = fakeSql({ insertId: "d-new" });
  handler.__setDeps({ neon: () => sql, access: accessWith(ANALYST) });
  await handler(req({ ...base }), fakeRes());
  assert.ok(!sql.kinds().includes("snapshot_update"));
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

// A customer's link landing never restores the analyst-authored question set,
// so a customer save must keep the stored values rather than wipe them.
const ANALYST_COLUMNS = ["included_fields", "excluded_fields", "custom_questions"];
const analystAuthored = {
  includedFields: ["inc_a"], excludedFields: ["exc_b"],
  customQuestions: [{ text: "Why?", fieldType: "text" }],
};

test("a customer save keeps the analyst-authored included/excluded fields and custom questions", async () => {
  const sql = fakeSql({ lookupRow: { id: "d-1", tenant_id: "acme", owned_by: "analyst" } });
  handler.__setDeps({ neon: () => sql, access: accessWith(CUSTOMER) });
  const res = fakeRes();
  await handler(req({ ...base, dossierId: "d-1", includedFields: [], excludedFields: [], customQuestions: [] }), res);
  assert.strictEqual(res.statusCode, 200);
  const update = sql.log.find((l) => l.kind === "snapshot_update");
  for (const col of ANALYST_COLUMNS) {
    // A bound `true` (isCustomer) picks the stored column over the body value.
    assert.match(update.text, new RegExp(`${col}\\s*=\\s*CASE WHEN\\s+THEN ${col} ELSE\\s+END`));
  }
});

test("an analyst save binds the new included/excluded fields and custom questions", async () => {
  const sql = fakeSql({ lookupRow: { id: "d-1", tenant_id: "acme", owned_by: "analyst" } });
  handler.__setDeps({ neon: () => sql, access: accessWith(ANALYST) });
  const res = fakeRes();
  await handler(req({ ...base, dossierId: "d-1", ...analystAuthored }), res);
  assert.strictEqual(res.statusCode, 200);
  const update = sql.log.find((l) => l.kind === "snapshot_update");
  assert.ok(update.values.includes(JSON.stringify(analystAuthored.includedFields)));
  assert.ok(update.values.includes(JSON.stringify(analystAuthored.excludedFields)));
  assert.ok(update.values.includes(JSON.stringify(analystAuthored.customQuestions)));
  assert.ok(!update.values.includes(true), "the analyst path binds isCustomer=false everywhere");
});

test("a first save stores a valid creationKey and conflicts on (tenant, creation_key) instead of duplicating", async () => {
  const sql = fakeSql({ insertId: "d-new" });
  handler.__setDeps({ neon: () => sql, access: accessWith(ANALYST) });
  const key = "3f2b8a4e-9c1d-4e6f-8a2b-7c9d0e1f2a3b";
  const res = fakeRes();
  await handler(req({ ...base, creationKey: key }), res);
  assert.deepStrictEqual(res.body, { success: true, dossierId: "d-new" });
  const insert = sql.log.find((l) => l.kind === "insert");
  assert.match(insert.text, /creation_key/);
  assert.match(insert.text, /ON CONFLICT\s*\(\s*tenant_id\s*,\s*creation_key\s*\)\s*WHERE\s+creation_key\s+IS\s+NOT\s+NULL/i);
  assert.match(insert.text, /RETURNING id/i);
  assert.ok(insert.values.includes(key));
});

test("a non-UUID creationKey is ignored (bound as null)", async () => {
  for (const creationKey of ["not-a-uuid", 42, "x".repeat(40)]) {
    const sql = fakeSql({ insertId: "d-new" });
    handler.__setDeps({ neon: () => sql, access: accessWith(ANALYST) });
    await handler(req({ ...base, creationKey }), fakeRes());
    const insert = sql.log.find((l) => l.kind === "insert");
    assert.ok(!insert.values.includes(creationKey));
    assert.ok(insert.values.includes(null));
  }
});

test("an update never touches creation_key", async () => {
  const sql = fakeSql({ lookupRow: { id: "d-1", tenant_id: "acme", owned_by: "analyst" } });
  handler.__setDeps({ neon: () => sql, access: accessWith(ANALYST) });
  await handler(req({ ...base, dossierId: "d-1", creationKey: "3f2b8a4e-9c1d-4e6f-8a2b-7c9d0e1f2a3b" }), fakeRes());
  const update = sql.log.find((l) => l.kind === "snapshot_update");
  assert.doesNotMatch(update.text, /creation_key/);
});

test("a version-number collision (23505) retries the statement once and succeeds", async () => {
  const collision = Object.assign(new Error('duplicate key value violates unique constraint "entity_dossier_versions_dossier_id_version_key"'), { code: "23505" });
  const sql = fakeSql({
    lookupRow: { id: "d-1", tenant_id: "acme", owned_by: "analyst" },
    snapshotUpdateResults: [{ error: collision }, { rows: [{ id: "d-1" }] }],
  });
  handler.__setDeps({ neon: () => sql, access: accessWith(ANALYST) });
  const res = fakeRes();
  await handler(req({ ...base, dossierId: "d-1" }), res);
  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(res.body, { success: true, dossierId: "d-1" });
  assert.deepStrictEqual(sql.kinds(), ["lookup", "tenants_upsert", "snapshot_update", "snapshot_update"]);
});

test("two version-number collisions (23505 twice) report save_conflict, not save_failed", async () => {
  const collision = () => Object.assign(new Error('duplicate key value violates unique constraint "entity_dossier_versions_dossier_id_version_key"'), { code: "23505" });
  const sql = fakeSql({
    lookupRow: { id: "d-1", tenant_id: "acme", owned_by: "analyst" },
    snapshotUpdateResults: [{ error: collision() }, { error: collision() }],
  });
  handler.__setDeps({ neon: () => sql, access: accessWith(ANALYST) });
  const res = fakeRes();
  await handler(req({ ...base, dossierId: "d-1" }), res);
  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(res.body, { success: false, dossierId: null, warning: "save_conflict" });
  assert.deepStrictEqual(sql.kinds(), ["lookup", "tenants_upsert", "snapshot_update", "snapshot_update"]);
});

test("a non-23505 error on the combined statement reports save_failed with no retry", async () => {
  const sql = fakeSql({
    lookupRow: { id: "d-1", tenant_id: "acme", owned_by: "analyst" },
    snapshotUpdateResults: [{ error: new Error("connection terminated unexpectedly - internal detail") }],
  });
  handler.__setDeps({ neon: () => sql, access: accessWith(ANALYST) });
  const res = fakeRes();
  await handler(req({ ...base, dossierId: "d-1" }), res);
  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(res.body, { success: false, dossierId: null, warning: "save_failed" });
  // No retry: exactly one attempt at the combined statement.
  assert.deepStrictEqual(sql.kinds(), ["lookup", "tenants_upsert", "snapshot_update"]);
});
