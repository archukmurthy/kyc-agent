const { test } = require("node:test");
const assert = require("node:assert");
const handler = require("../config");
const storage = require("../../lib/storage");

// 3-strict: api/config.js must refuse to seed/serve when no tenant resolves
// at all (no ?tenant=, no x-tenant-id, no TENANT_ID env) — never silently
// fall back to "nium". This guard runs before any storage access, so it's
// safe to exercise without a real KV/filesystem backend.

function fakeReqRes({ query = {}, headers = {}, method = "GET" } = {}) {
  const req = { query, headers, method, url: "/api/config" };
  const res = {
    statusCode: null,
    body: null,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    end() { return this; },
  };
  return { req, res };
}

test("GET with no resolvable tenant returns 400 tenant_required, not a seeded/served config", async (t) => {
  const prevTenantId = process.env.TENANT_ID;
  delete process.env.TENANT_ID;
  t.after(() => {
    if (prevTenantId !== undefined) process.env.TENANT_ID = prevTenantId;
  });

  const { req, res } = fakeReqRes({ method: "GET" });
  await handler(req, res);

  assert.strictEqual(res.statusCode, 400);
  assert.deepStrictEqual(res.body, { error: "tenant_required" });
});

test("POST with no resolvable tenant also returns 400 before touching auth/storage", async (t) => {
  const prevTenantId = process.env.TENANT_ID;
  delete process.env.TENANT_ID;
  t.after(() => {
    if (prevTenantId !== undefined) process.env.TENANT_ID = prevTenantId;
  });

  const { req, res } = fakeReqRes({ method: "POST" });
  await handler(req, res);

  assert.strictEqual(res.statusCode, 400);
  assert.deepStrictEqual(res.body, { error: "tenant_required" });
});

test("?tenant=<id> resolves normally — the guard doesn't block a real tenant", async (t) => {
  // Distinctive, disposable tenant id so this doesn't collide with real dev
  // data in the local filesystem store fallback (.config-store.json), and
  // cleans up after itself either way.
  const TENANT = "zz-nodetest-config-guard";
  t.after(async () => {
    const keys = await storage.list(`config:${TENANT}`);
    for (const k of keys) await storage.del(k);
  });

  const { req, res } = fakeReqRes({ method: "GET", query: { tenant: TENANT } });
  await handler(req, res);

  assert.notStrictEqual(res.statusCode, 400);
});
