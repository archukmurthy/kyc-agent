const { test } = require("node:test");
// Sets a session secret, which a login now needs in order to mint one.
require("./_sessions");
const assert = require("node:assert");
const handler = require("../preboarding-auth");
const registry = require("../../lib/tenantRegistry");

const PASSWORD = "test-preboarding-password";

function fakeStorage(initial) {
  const data = { ...(initial || {}) };
  return {
    data,
    async get(key) { return key in data ? data[key] : null; },
    async set(key, value) { data[key] = value; },
  };
}

function fakeReqRes({ method = "POST", query = {}, body = undefined } = {}) {
  const req = { method, query, body, headers: {}, url: "/api/preboarding-auth" };
  const res = {
    statusCode: null, body: null, headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    end() { return this; },
  };
  return { req, res };
}

function withPassword(t, value = PASSWORD) {
  const prev = process.env.PREBOARDING_PASSWORD;
  if (value === null) delete process.env.PREBOARDING_PASSWORD;
  else process.env.PREBOARDING_PASSWORD = value;
  t.after(() => {
    if (prev === undefined) delete process.env.PREBOARDING_PASSWORD;
    else process.env.PREBOARDING_PASSWORD = prev;
  });
}

function storeWith(entry) {
  const storage = fakeStorage({ "tenant-registry": entry ? [entry] : [] });
  handler.__setDeps({ storage });
  registry.__setDeps({ storage });
  return storage;
}

test("no tenant is a 400 before any other work", async (t) => {
  withPassword(t);
  storeWith({ tenantId: "acme", isActive: true, preboardingEnabled: true });
  const { req, res } = fakeReqRes({ body: { password: PASSWORD } });
  await handler(req, res);
  assert.strictEqual(res.statusCode, 400);
  assert.deepStrictEqual(res.body, { error: "tenant_required" });
});

test("an unknown tenant is a 404 - a typo must not reach the password check", async (t) => {
  withPassword(t);
  storeWith({ tenantId: "acme", isActive: true, preboardingEnabled: true });
  const { req, res } = fakeReqRes({ query: { tenant: "acmee" }, body: { password: PASSWORD } });
  await handler(req, res);
  assert.strictEqual(res.statusCode, 404);
  assert.deepStrictEqual(res.body, { error: "tenant_not_found" });
});

test("a deactivated tenant is a 403", async (t) => {
  withPassword(t);
  storeWith({ tenantId: "acme", isActive: false, preboardingEnabled: true });
  const { req, res } = fakeReqRes({ query: { tenant: "acme" }, body: { password: PASSWORD } });
  await handler(req, res);
  assert.strictEqual(res.statusCode, 403);
  assert.deepStrictEqual(res.body, { error: "tenant_inactive" });
});

test("pre-boarding switched off is a 403 even with the right password", async (t) => {
  withPassword(t);
  storeWith({ tenantId: "acme", isActive: true, preboardingEnabled: false });
  const { req, res } = fakeReqRes({ query: { tenant: "acme" }, body: { password: PASSWORD } });
  await handler(req, res);
  assert.strictEqual(res.statusCode, 403);
  assert.deepStrictEqual(res.body, { error: "preboarding_disabled" });
});

test("a missing server password is a 500, not an open door", async (t) => {
  withPassword(t, null);
  storeWith({ tenantId: "acme", isActive: true, preboardingEnabled: true });
  const { req, res } = fakeReqRes({ query: { tenant: "acme" }, body: { password: "anything" } });
  await handler(req, res);
  assert.strictEqual(res.statusCode, 500);
  assert.deepStrictEqual(res.body, { error: "not_configured" });
});

test("a wrong password is a 401", async (t) => {
  withPassword(t);
  storeWith({ tenantId: "acme", isActive: true, preboardingEnabled: true });
  const { req, res } = fakeReqRes({ query: { tenant: "acme" }, body: { password: "wrong" } });
  await handler(req, res);
  assert.strictEqual(res.statusCode, 401);
  assert.deepStrictEqual(res.body, { error: "invalid_password" });
});

test("the right password returns the verified tenant and a bearer token", async (t) => {
  withPassword(t);
  storeWith({ tenantId: "acme", companyName: "Acme Ltd", isActive: true, preboardingEnabled: true });
  const { req, res } = fakeReqRes({ query: { tenant: "acme" }, body: { password: PASSWORD } });
  await handler(req, res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.success, true);
  assert.strictEqual(res.body.tenantId, "acme");
  assert.strictEqual(res.body.companyName, "Acme Ltd");

  // This used to assert res.body.token === PASSWORD - the vulnerability written
  // down as a requirement (AUTH-2). What comes back now is a session.
  assert.notStrictEqual(res.body.token, PASSWORD, "the password must never come back as the token");
  const session = require("../../lib/session");
  const verified = await session.verify(res.body.token);
  assert.strictEqual(verified.valid, true, verified.reason || "");
  assert.strictEqual(verified.payload.role, "analyst");
  assert.strictEqual(verified.payload.tenantId, "acme", "a session names the company it was issued for");
  assert.ok(verified.payload.exp > Date.now(), "and it expires");
});

test("GET reports availability without needing a password", async (t) => {
  withPassword(t);
  storeWith({ tenantId: "acme", companyName: "Acme Ltd", isActive: true, preboardingEnabled: false });
  const { req, res } = fakeReqRes({ method: "GET", query: { tenant: "acme" } });
  await handler(req, res);
  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(res.body, { available: false, reason: "preboarding_disabled", companyName: "Acme Ltd" });
});

test("GET for an available tenant reports available:true", async (t) => {
  withPassword(t);
  storeWith({ tenantId: "acme", companyName: "Acme Ltd", isActive: true, preboardingEnabled: true });
  const { req, res } = fakeReqRes({ method: "GET", query: { tenant: "acme" } });
  await handler(req, res);
  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(res.body, { available: true, reason: null, companyName: "Acme Ltd" });
});
