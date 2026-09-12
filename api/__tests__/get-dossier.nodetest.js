const { test } = require("node:test");
const assert = require("node:assert");
const handler = require("../get-dossier");

// 3-strict: api/get-dossier.js must refuse when no tenant resolves at all
// (no ?tenant=, no x-tenant-id, no TENANT_ID env) — never silently fall back
// to "nium". This guard runs before the DB query, so it's safe to exercise
// without a real DATABASE_URL.

function fakeReqRes({ query = {}, headers = {} } = {}) {
  const req = { query, headers, method: "GET", url: "/api/get-dossier" };
  const res = {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  return { req, res };
}

test("missing dossierId returns 400 before any tenant/DB work", async () => {
  const { req, res } = fakeReqRes({ query: {} });
  await handler(req, res);
  assert.strictEqual(res.statusCode, 400);
  assert.deepStrictEqual(res.body, { error: "dossierId required" });
});

test("GET with id but no resolvable tenant returns 400 tenant_required, not a nium-default lookup", async (t) => {
  const prevTenantId = process.env.TENANT_ID;
  delete process.env.TENANT_ID;
  t.after(() => {
    if (prevTenantId !== undefined) process.env.TENANT_ID = prevTenantId;
  });

  const { req, res } = fakeReqRes({ query: { id: "dossier-123" } });
  await handler(req, res);

  assert.strictEqual(res.statusCode, 400);
  assert.deepStrictEqual(res.body, { error: "tenant_required" });
});

test("a provided tenant (via ?tenant=) is used verbatim — no DATABASE_URL still proves the guard passed", async (t) => {
  const prevUrl = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  t.after(() => {
    if (prevUrl !== undefined) process.env.DATABASE_URL = prevUrl;
  });

  const { req, res } = fakeReqRes({ query: { id: "dossier-123", tenant: "acme" } });
  await handler(req, res);

  // Cleared the tenant_required 400 using the caller-supplied tenant (not a
  // hardcoded "nium" fallback); next stop is the "no DB configured" branch.
  assert.notStrictEqual(res.statusCode, 400);
  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(res.body, { success: false, error: "Database not configured" });
});

test("tenant resolution falls back to x-tenant-id header when no ?tenant= is present", async (t) => {
  const prevUrl = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  t.after(() => {
    if (prevUrl !== undefined) process.env.DATABASE_URL = prevUrl;
  });

  const { req, res } = fakeReqRes({ query: { id: "dossier-123" }, headers: { "x-tenant-id": "acme" } });
  await handler(req, res);

  assert.notStrictEqual(res.statusCode, 400);
});
