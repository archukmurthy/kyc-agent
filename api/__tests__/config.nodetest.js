const { test } = require("node:test");
const assert = require("node:assert");
const handler = require("../config");
const storage = require("../../lib/storage");
const registry = require("../../lib/tenantRegistry");

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
  const fake = fakeStorage({ "tenant-registry": [{ tenantId: TENANT }] });
  handler.__setDeps({ storage: fake });
  registry.__setDeps({ storage: fake });
  t.after(async () => {
    const keys = await storage.list(`config:${TENANT}`);
    for (const k of keys) await storage.del(k);
  });

  const { req, res } = fakeReqRes({ method: "GET", query: { tenant: TENANT } });
  await handler(req, res);

  assert.notStrictEqual(res.statusCode, 400);
});

function fakeStorage(initial) {
  const data = { ...(initial || {}) };
  return {
    data,
    async get(key) { return key in data ? data[key] : null; },
    async set(key, value) { data[key] = value; },
    async del(key) { delete data[key]; },
    async list(prefix) { return Object.keys(data).filter((k) => k.startsWith(prefix)); },
  };
}

test("GET for a tenant that is not in the registry returns 404 and seeds nothing", async () => {
  const storage = fakeStorage({ "tenant-registry": [{ tenantId: "acme" }] });
  handler.__setDeps({ storage });
  registry.__setDeps({ storage });

  const { req, res } = fakeReqRes({ method: "GET", query: { tenant: "acmee" } });
  await handler(req, res);

  assert.strictEqual(res.statusCode, 404);
  assert.deepStrictEqual(res.body, { error: "tenant_not_found" });
  assert.strictEqual(storage.data["config:acmee"], undefined);
});

test("GET for a registered tenant with no config seeds a blank one", async () => {
  const storage = fakeStorage({ "tenant-registry": [{ tenantId: "acme" }] });
  handler.__setDeps({ storage });
  registry.__setDeps({ storage });

  const { req, res } = fakeReqRes({ method: "GET", query: { tenant: "acme" } });
  await handler(req, res);

  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body._isBlank, true);
  assert.ok(storage.data["config:acme"], "config should have been seeded");
});

test("a legacy tenant (config exists, no registry entry) is served and back-filled", async () => {
  const storage = fakeStorage({
    "tenant-registry": [],
    "config:oldco": { _tenantId: "oldco", _version: 3, licences: [{ id: "GB" }], company: { name: "Old Co" } },
  });
  handler.__setDeps({ storage });
  registry.__setDeps({ storage });

  const { req, res } = fakeReqRes({ method: "GET", query: { tenant: "oldco" } });
  await handler(req, res);

  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body._version, 3);
  const entry = storage.data["tenant-registry"].find((t) => t.tenantId === "oldco");
  assert.ok(entry, "legacy tenant should be back-filled into the registry");
  assert.strictEqual(entry.companyName, "Old Co");
});
