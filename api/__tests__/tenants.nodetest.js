const { test } = require("node:test");
const assert = require("node:assert");
const handler = require("../tenants");
const registry = require("../../lib/tenantRegistry");

const SUPER = "test-super-password";

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

function fakeReqRes({ method = "GET", query = {}, body = undefined } = {}) {
  const req = { method, query, body, headers: { authorization: `Bearer ${SUPER}` }, url: "/api/tenants" };
  const res = {
    statusCode: null, body: null, headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    end() { return this; },
  };
  return { req, res };
}

function withSuperAdmin(t) {
  const prev = process.env.SUPER_ADMIN_PASSWORD;
  process.env.SUPER_ADMIN_PASSWORD = SUPER;
  t.after(() => {
    if (prev === undefined) delete process.env.SUPER_ADMIN_PASSWORD;
    else process.env.SUPER_ADMIN_PASSWORD = prev;
  });
}

test("toggle-preboarding flips the registry flag", async (t) => {
  withSuperAdmin(t);
  const storage = fakeStorage({ "tenant-registry": [{ tenantId: "acme", isActive: true }] });
  handler.__setDeps({ storage });
  registry.__setDeps({ storage });

  const { req, res } = fakeReqRes({
    method: "PUT",
    query: { action: "toggle-preboarding", tenantId: "acme" },
    body: { preboardingEnabled: true },
  });
  await handler(req, res);

  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(res.body, { success: true, preboardingEnabled: true });
  assert.strictEqual(storage.data["tenant-registry"][0].preboardingEnabled, true);
});

test("toggle-preboarding refuses an unknown tenant", async (t) => {
  withSuperAdmin(t);
  const storage = fakeStorage({ "tenant-registry": [{ tenantId: "acme" }] });
  handler.__setDeps({ storage });
  registry.__setDeps({ storage });

  const { req, res } = fakeReqRes({
    method: "PUT",
    query: { action: "toggle-preboarding", tenantId: "ghost" },
    body: { preboardingEnabled: true },
  });
  await handler(req, res);

  assert.strictEqual(res.statusCode, 404);
  assert.deepStrictEqual(res.body, { error: "tenant_not_found" });
});

test("a newly created tenant is unprotected with pre-boarding off", async (t) => {
  withSuperAdmin(t);
  const storage = fakeStorage({ "tenant-registry": [] });
  handler.__setDeps({ storage });
  registry.__setDeps({ storage });

  const { req, res } = fakeReqRes({
    method: "POST",
    body: { tenantId: "newco", companyName: "New Co", password: "pw-123456", startFrom: "blank" },
  });
  await handler(req, res);

  assert.strictEqual(res.statusCode, 200);
  const entry = storage.data["tenant-registry"].find((x) => x.tenantId === "newco");
  assert.strictEqual(entry.isProtected, false);
  assert.strictEqual(entry.preboardingEnabled, false);
  assert.strictEqual(res.body.preboardingUrl, "/preboarding?tenant=newco");
});

test("the seeded platform entry is marked protected", async (t) => {
  withSuperAdmin(t);
  const storage = fakeStorage({});
  handler.__setDeps({ storage });
  registry.__setDeps({ storage });

  const { req, res } = fakeReqRes({ method: "GET" });
  await handler(req, res);

  assert.strictEqual(res.statusCode, 200);
  const seeded = storage.data["tenant-registry"][0];
  assert.strictEqual(seeded.isProtected, true);
});

// ── Registry durability (final-review CT-1) ────────────────────────────────
// readRegistry() is deliberately fail-soft and answers [] for BOTH "empty"
// and "unreadable". ensureRegistry must not read the second as the first:
// lib/storage.js#get throws on KV/Redis failure, so seeding on a read blip
// would overwrite every real tenant entry with a platform-only registry.
test("an unreadable registry is never reseeded — no write, error surfaces", async (t) => {
  withSuperAdmin(t);
  let writes = 0;
  const storage = {
    async get() { throw new Error("kv down"); },
    async set() { writes += 1; },
    async del() {},
    async list() { return []; },
  };
  handler.__setDeps({ storage });
  registry.__setDeps({ storage });

  const { req, res } = fakeReqRes({ method: "GET" });
  await handler(req, res);

  assert.strictEqual(writes, 0, "a read blip must not rewrite the registry");
  assert.strictEqual(res.statusCode, 500);
});

// ── Pre-boarding back-fill (final-review CT-2) ─────────────────────────────
// Production KV already holds a registry, so the seeding branch never runs.
// Without a back-fill every existing tenant — the platform one included —
// resolves to preboardingEnabled: undefined and pre-boarding goes dark.
// Ordinary tenants stay off on purpose: opt-in is the design.
test("back-fill enables pre-boarding for protected entries only, and is idempotent", async (t) => {
  withSuperAdmin(t);
  const storage = fakeStorage({ "tenant-registry": [
    { tenantId: "platform", isInternal: true },
    { tenantId: "acme", isActive: true },
  ] });
  handler.__setDeps({ storage });
  registry.__setDeps({ storage });

  const first = fakeReqRes({ method: "GET" });
  await handler(first.req, first.res);

  const byId = (id) => storage.data["tenant-registry"].find((x) => x.tenantId === id);
  assert.strictEqual(first.res.statusCode, 200);
  assert.strictEqual(byId("platform").isProtected, true);
  assert.strictEqual(byId("platform").preboardingEnabled, true);
  assert.strictEqual(byId("acme").preboardingEnabled, undefined, "ordinary tenants stay opt-in");

  const snapshot = JSON.stringify(storage.data["tenant-registry"]);
  const second = fakeReqRes({ method: "GET" });
  await handler(second.req, second.res);
  assert.strictEqual(JSON.stringify(storage.data["tenant-registry"]), snapshot, "back-fill must be idempotent");
});

// upsertEntry callers: a registry read that fails at the moment of the write
// must surface as a 500 with NO registry write (it used to replace the whole
// registry with the one entry being upserted).
function flakyRegistryStorage(initial, { failFromRead = 1 } = {}) {
  const base = fakeStorage(initial);
  const writes = [];
  let registryReads = 0;
  return {
    data: base.data,
    writes,
    async get(key) {
      if (key === "tenant-registry" && ++registryReads >= failFromRead) throw new Error("kv down");
      return base.get(key);
    },
    async set(key, value) { writes.push(key); return base.set(key, value); },
    async del(key) { return base.del(key); },
    async list(prefix) { return base.list(prefix); },
  };
}

test("create tenant with an unreadable registry → 500 and the registry is not overwritten", async (t) => {
  withSuperAdmin(t);
  const existing = [{ tenantId: "nium", isProtected: true }, { tenantId: "acme" }];
  const storage = flakyRegistryStorage({ "tenant-registry": existing });
  handler.__setDeps({ storage });
  registry.__setDeps({ storage });

  const { req, res } = fakeReqRes({
    method: "POST",
    body: { tenantId: "newco", companyName: "New Co", password: "pw", startFrom: "blank" },
  });
  await handler(req, res);

  assert.strictEqual(res.statusCode, 500);
  assert.ok(!storage.writes.includes("tenant-registry"), "registry must not be written");
  assert.deepStrictEqual(storage.data["tenant-registry"], existing);
});

test("toggle-preboarding whose write-time registry read fails → 500 and no registry write", async (t) => {
  withSuperAdmin(t);
  const existing = [{ tenantId: "nium", isProtected: true }, { tenantId: "acme" }];
  // First read (tenantExists) succeeds; the second (inside upsertEntry) fails.
  const storage = flakyRegistryStorage({ "tenant-registry": existing }, { failFromRead: 2 });
  handler.__setDeps({ storage });
  registry.__setDeps({ storage });

  const { req, res } = fakeReqRes({
    method: "PUT",
    query: { action: "toggle-preboarding", tenantId: "acme" },
    body: { preboardingEnabled: true },
  });
  await handler(req, res);

  assert.strictEqual(res.statusCode, 500);
  assert.ok(!storage.writes.includes("tenant-registry"), "registry must not be written");
  assert.deepStrictEqual(storage.data["tenant-registry"], existing);
});

test("toggle-status whose write-time registry read fails → 500 and no registry write", async (t) => {
  withSuperAdmin(t);
  const existing = [{ tenantId: "nium", isProtected: true }, { tenantId: "acme" }];
  // First read (isProtectedTenant) succeeds; the second (inside upsertEntry) fails.
  const storage = flakyRegistryStorage({ "tenant-registry": existing }, { failFromRead: 2 });
  handler.__setDeps({ storage });
  registry.__setDeps({ storage });

  const { req, res } = fakeReqRes({
    method: "PUT",
    query: { action: "toggle-status", tenantId: "acme" },
    body: { isActive: false },
  });
  await handler(req, res);

  assert.strictEqual(res.statusCode, 500);
  assert.ok(!storage.writes.includes("tenant-registry"), "registry must not be written");
  assert.deepStrictEqual(storage.data["tenant-registry"], existing);
});
