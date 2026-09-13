const { test, before, after } = require("node:test");
const assert = require("node:assert");

// The handler's DATABASE_URL gate runs before deps are consulted (matches
// production). Set a fake value for these tests so the mocked sql path is
// exercised — mirrors the save/restore pattern in submit-handler.nodetest.js.
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

// Fake Neon tag function: records which statement kind each query was
// (tenants upsert / entity_dossiers UPDATE / entity_dossiers INSERT) and
// returns canned RETURNING rows per `updateRows` / `insertId`.
function fakeSql({ updateRows = [{ id: "dossier-1" }], insertId = "dossier-new" } = {}) {
  const kinds = [];
  const sql = (strings) => {
    const text = strings.join(" ");
    if (/INSERT INTO tenants/i.test(text)) { kinds.push("tenants_upsert"); return Promise.resolve([]); }
    if (/UPDATE entity_dossiers/i.test(text)) { kinds.push("update"); return Promise.resolve(updateRows); }
    if (/INSERT INTO entity_dossiers/i.test(text)) { kinds.push("insert"); return Promise.resolve([{ id: insertId }]); }
    kinds.push("unknown");
    return Promise.resolve([]);
  };
  sql.kinds = kinds;
  return sql;
}

const basePayload = {
  tenantId: "nium",
  company: { name: "Acme Ltd", code: "GB", countryName: "United Kingdom" },
  entityType: "company",
};

test("400 when tenantId or company.name is missing", async () => {
  const handler = require("../save-dossier");
  const req = { method: "POST", body: { tenantId: "nium" } };
  const res = fakeRes();
  await handler(req, res);
  assert.strictEqual(res.statusCode, 400);
});

test("no dossierId → INSERTs a new row, never UPDATEs", async () => {
  const handler = require("../save-dossier");
  const fake = fakeSql({ insertId: "dossier-fresh" });
  handler.__setDeps({ neon: () => fake });

  const req = { method: "POST", body: { ...basePayload } };
  const res = fakeRes();
  await handler(req, res);

  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.dossierId, "dossier-fresh");
  assert.deepStrictEqual(fake.kinds, ["tenants_upsert", "insert"]);
});

test("existing dossierId that matches a row → UPDATEs in place, never INSERTs a second row", async () => {
  const handler = require("../save-dossier");
  const fake = fakeSql({ updateRows: [{ id: "dossier-1" }] });
  handler.__setDeps({ neon: () => fake });

  const req = { method: "POST", body: { ...basePayload, dossierId: "dossier-1" } };
  const res = fakeRes();
  await handler(req, res);

  assert.strictEqual(res.statusCode, 200);
  // Same id comes back — the caller's reference (e.g. an already-sent invite
  // link) is never orphaned.
  assert.strictEqual(res.body.dossierId, "dossier-1");
  assert.deepStrictEqual(fake.kinds, ["tenants_upsert", "update"]);
});

test("dossierId that matches no row (stale/foreign id) falls back to INSERT instead of dropping the save", async () => {
  const handler = require("../save-dossier");
  const fake = fakeSql({ updateRows: [], insertId: "dossier-2" });
  handler.__setDeps({ neon: () => fake });

  const req = { method: "POST", body: { ...basePayload, dossierId: "does-not-exist" } };
  const res = fakeRes();
  await handler(req, res);

  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.dossierId, "dossier-2");
  assert.deepStrictEqual(fake.kinds, ["tenants_upsert", "update", "insert"]);
});

test("no DATABASE_URL → 200 with warning, DB never touched", async () => {
  const handler = require("../save-dossier");
  const prev = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    let neonCalled = false;
    handler.__setDeps({ neon: () => { neonCalled = true; return fakeSql(); } });
    const req = { method: "POST", body: { ...basePayload } };
    const res = fakeRes();
    await handler(req, res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.success, false);
    assert.strictEqual(neonCalled, false);
  } finally {
    if (prev === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = prev;
  }
});
