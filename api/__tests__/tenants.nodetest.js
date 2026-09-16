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
