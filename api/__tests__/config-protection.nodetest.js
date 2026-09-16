const { test } = require("node:test");
const assert = require("node:assert");
const configHandler = require("../config");
const versionsHandler = require("../config-versions");
const registry = require("../../lib/tenantRegistry");
const { hashPassword } = require("../../lib/auth");

const ADMIN = "test-admin-password";

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

function fakeReqRes({ method = "GET", query = {}, headers = {}, body = undefined } = {}) {
  const req = { method, query, headers, body, url: "/api/config" };
  const res = {
    statusCode: null,
    body: null,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    end() { return this; },
  };
  return { req, res };
}

const GOOD_CONFIG = {
  _version: 4,
  licences: [{ id: "GB" }],
  entityTypes: [{ id: "Corporate", active: true }],
  schemas: { "Corporate:GB": { researchFields: [], gapFields: [] } },
};

function protectedStore() {
  return fakeStorage({
    "tenant-registry": [{ tenantId: "acme", isProtected: true }],
    // "acme" is flagged protected but is NOT a platform tenant, and the
    // ADMIN_PASSWORD env fallback is platform-only (a static list in
    // lib/tenantRegistry.js — it must not widen to every tenant when the
    // registry is unreadable). So it authenticates with its own per-tenant
    // password, exactly like any real protected-but-not-platform tenant.
    // These tests are about the destructive GUARDS, not about auth.
    "tenant-auth:acme": { passwordHash: hashPassword(ADMIN) },
    "config:acme": { ...GOOD_CONFIG },
    "config:acme:v3": { _version: 3, licences: [{ id: "GB" }], entityTypes: [{ id: "Corporate", active: true }] },
    "config:acme:v2": { _version: 2, licences: [], entityTypes: [] },
  });
}

function withAdmin(t) {
  const prev = process.env.ADMIN_PASSWORD;
  process.env.ADMIN_PASSWORD = ADMIN;
  t.after(() => {
    if (prev === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = prev;
  });
}

test("DELETE is refused for a protected tenant and keeps every version", async (t) => {
  withAdmin(t);
  const storage = protectedStore();
  configHandler.__setDeps({ storage });
  registry.__setDeps({ storage });

  const { req, res } = fakeReqRes({
    method: "DELETE",
    query: { tenant: "acme" },
    headers: { authorization: `Bearer ${ADMIN}` },
  });
  await configHandler(req, res);

  assert.strictEqual(res.statusCode, 403);
  assert.deepStrictEqual(res.body, { error: "tenant_protected" });
  assert.ok(storage.data["config:acme"], "live config must survive");
  assert.ok(storage.data["config:acme:v3"], "archived versions must survive");
});

test("DELETE still works for an unprotected tenant", async (t) => {
  withAdmin(t);
  // Non-platform tenants never got the ADMIN_PASSWORD env fallback — that
  // path is, and always was, platform-only. It is gated by the static
  // PLATFORM_TENANT_IDS list rather than by isProtectedTenant, which fails
  // CLOSED and would hand the shared env password every tenant during a
  // storage outage. A normal tenant uses its own per-tenant password.
  const storage = fakeStorage({
    "tenant-registry": [{ tenantId: "plain", isProtected: false }],
    "tenant-auth:plain": { passwordHash: hashPassword(ADMIN) },
    "config:plain": { _version: 1 },
  });
  configHandler.__setDeps({ storage });
  registry.__setDeps({ storage });

  const { req, res } = fakeReqRes({
    method: "DELETE",
    query: { tenant: "plain" },
    headers: { authorization: `Bearer ${ADMIN}` },
  });
  await configHandler(req, res);

  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(storage.data["config:plain"], undefined);
});

test("publishing a gutted config is refused for any protected tenant (not just nium)", async (t) => {
  withAdmin(t);
  const storage = protectedStore();
  configHandler.__setDeps({ storage });
  registry.__setDeps({ storage });

  const { req, res } = fakeReqRes({
    method: "POST",
    query: { tenant: "acme" },
    headers: { authorization: `Bearer ${ADMIN}` },
    body: { licences: [], entityTypes: [] },
  });
  await configHandler(req, res);

  assert.strictEqual(res.statusCode, 400);
  assert.match(res.body.error, /empty configuration/i);
  assert.strictEqual(storage.data["config:acme"]._version, 4, "live config untouched");
});

test("rolling a protected tenant back to a gutted version is refused", async (t) => {
  withAdmin(t);
  const storage = protectedStore();
  versionsHandler.__setDeps({ storage });
  registry.__setDeps({ storage });

  const { req, res } = fakeReqRes({
    method: "POST",
    query: { tenant: "acme" },
    headers: { authorization: `Bearer ${ADMIN}` },
    body: { version: 2 },
  });
  await versionsHandler(req, res);

  assert.strictEqual(res.statusCode, 400);
  assert.deepStrictEqual(res.body, { error: "empty_config_rejected" });
  assert.strictEqual(storage.data["config:acme"]._version, 4);
});

test("rolling back to a healthy version still works", async (t) => {
  withAdmin(t);
  const storage = protectedStore();
  versionsHandler.__setDeps({ storage });
  registry.__setDeps({ storage });

  const { req, res } = fakeReqRes({
    method: "POST",
    query: { tenant: "acme" },
    headers: { authorization: `Bearer ${ADMIN}` },
    body: { version: 3 },
  });
  await versionsHandler(req, res);

  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(storage.data["config:acme"]._rolledBackFrom, 3);
});

test("versions handler with no resolvable tenant returns 400 tenant_required before auth", async (t) => {
  const prevTenantId = process.env.TENANT_ID;
  delete process.env.TENANT_ID;
  t.after(() => {
    if (prevTenantId !== undefined) process.env.TENANT_ID = prevTenantId;
  });

  // No query.tenant, no x-tenant-id header, no TENANT_ID env, and no auth
  // header either — proves the tenant_required guard fires before the
  // (would-be-401) auth check runs.
  const { req, res } = fakeReqRes({ method: "POST", body: { version: 3 } });
  await versionsHandler(req, res);

  assert.strictEqual(res.statusCode, 400);
  assert.deepStrictEqual(res.body, { error: "tenant_required" });
});

test("self-heal archives the broken config before overwriting it", async (t) => {
  const storage = fakeStorage({
    "tenant-registry": [{ tenantId: "acme", isProtected: true }],
    "config:acme": { _version: 7, licences: [], entityTypes: [] },
  });
  configHandler.__setDeps({ storage });
  registry.__setDeps({ storage });

  const { req, res } = fakeReqRes({ method: "GET", query: { tenant: "acme" } });
  await configHandler(req, res);

  assert.strictEqual(res.statusCode, 200);
  assert.ok(res.body.licences.length > 0, "served config is healed");
  assert.ok(storage.data["config:acme:v7"], "broken config archived before overwrite");
  assert.deepStrictEqual(storage.data["config:acme:v7"].licences, []);
});

// ── Env-password fallback vs. fail-closed protection (final-review CT-3) ───
// isProtectedTenant fails CLOSED (unreadable registry → "protected") so a
// storage blip can never unlock a destructive guard. On the AUTH branch that
// same `true` would let the single shared ADMIN_PASSWORD authenticate as ANY
// tenant, so the env fallback must key off the static platform list instead.
const TENANT_PW = "acme-tenant-password";

// A registry outage with the rest of the store still readable — the shape
// that makes the two requirements pull in opposite directions.
function registryDownStore(extra) {
  const data = {
    "tenant-auth:acme": { passwordHash: hashPassword(TENANT_PW) },
    "config:acme": { ...GOOD_CONFIG },
    ...(extra || {}),
  };
  return {
    data,
    async get(key) {
      if (key === "tenant-registry") throw new Error("kv down");
      return key in data ? data[key] : null;
    },
    async set(key, value) { data[key] = value; },
    async del(key) { delete data[key]; },
    async list(prefix) { return Object.keys(data).filter((k) => k.startsWith(prefix)); },
  };
}

test("an unreadable registry does NOT let ADMIN_PASSWORD authenticate a non-platform tenant", async (t) => {
  withAdmin(t);
  const storage = registryDownStore();
  configHandler.__setDeps({ storage });
  registry.__setDeps({ storage });

  const { req, res } = fakeReqRes({
    method: "POST",
    query: { tenant: "acme" },
    headers: { authorization: `Bearer ${ADMIN}` },
    body: { licences: [{ id: "GB" }], entityTypes: [{ id: "Corporate", active: true }] },
  });
  await configHandler(req, res);

  assert.strictEqual(res.statusCode, 401);
  assert.deepStrictEqual(res.body, { error: "Unauthorized" });
});

test("the destructive guard still fails CLOSED when the registry is unreadable", async (t) => {
  withAdmin(t);
  const storage = registryDownStore();
  configHandler.__setDeps({ storage });
  registry.__setDeps({ storage });

  // Authenticated by the tenant's OWN password, so auth is not what refuses.
  const { req, res } = fakeReqRes({
    method: "DELETE",
    query: { tenant: "acme" },
    headers: { authorization: `Bearer ${TENANT_PW}` },
  });
  await configHandler(req, res);

  assert.strictEqual(res.statusCode, 403);
  assert.deepStrictEqual(res.body, { error: "tenant_protected" });
  assert.ok(storage.data["config:acme"], "config must survive a refused delete");
});
