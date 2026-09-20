"use strict";

// AUTH-1, end to end: the library being correct proves nothing if a route
// forgets to call it. These drive the real handlers.

const { test, beforeEach } = require("node:test");
const assert = require("node:assert");

const loginThrottle = require("../../lib/loginThrottle");
const adminAuth = require("../admin-auth");
const preboardingAuth = require("../preboarding-auth");

let store;
beforeEach(() => {
  store = new Map();
  loginThrottle.__setDeps({
    storage: {
      get: async (k) => (store.has(k) ? store.get(k) : null),
      set: async (k, v) => { store.set(k, v); },
      del: async (k) => { store.delete(k); },
    },
    now: () => 1_700_000_000_000,
  });
});

function post(body, ip = "5.5.5.5") {
  const req = { method: "POST", body, headers: { "x-forwarded-for": ip }, query: { tenant: "acme" }, url: "/api/admin-auth?tenant=acme" };
  const res = {
    statusCode: null, body: null, headers: {},
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    end() { return this; },
  };
  return { req, res };
}

test("the sixth wrong admin password is refused by the throttle, not the check", async () => {
  adminAuth.__setDeps({ storage: { get: async () => ({ passwordHash: "not-a-match" }), set: async () => {} } });

  for (let i = 0; i < 5; i++) {
    const { req, res } = post({ password: `guess-${i}` });
    await adminAuth(req, res);
    assert.equal(res.statusCode, 401, `attempt ${i + 1} should be a plain refusal`);
  }

  const { req, res } = post({ password: "guess-6" });
  await adminAuth(req, res);
  assert.equal(res.statusCode, 429, "guessing must stop being cheap");
  assert.equal(res.body.error, "too_many_attempts");
  assert.ok(res.headers["retry-after"], "a client needs to know how long to wait");
});

test("a different tenant is unaffected by another tenant's attacker", async () => {
  adminAuth.__setDeps({ storage: { get: async () => ({ passwordHash: "not-a-match" }), set: async () => {} } });
  for (let i = 0; i < 5; i++) {
    const { req, res } = post({ password: "x" }, "6.6.6.6");
    await adminAuth(req, res);
  }
  const other = post({ password: "x" }, "7.7.7.7");
  other.req.query = { tenant: "beta" };
  await adminAuth(other.req, other.res);
  assert.equal(other.res.statusCode, 401, "a locked tenant must not lock everyone else out");
});

test("the pre-boarding analyst login is throttled too", async () => {
  process.env.PREBOARDING_PASSWORD = "the-real-one";
  // The route checks the tenant is real and pre-boarding-enabled before it
  // looks at a password, so the throttle only guards tenants that exist.
  preboardingAuth.__setDeps({
    registry: {
      tenantExists: async () => true,
      isTenantActive: async () => true,
      isPreboardingEnabled: async () => true,
      findTenant: async () => ({ id: "acme", companyName: "Acme" }),
    },
  });
  const call = () => {
    const { req, res } = post({ password: "wrong" }, "8.8.8.8");
    req.url = "/api/preboarding-auth?tenant=acme";
    return { req, res };
  };
  let last = null;
  for (let i = 0; i < 6; i++) {
    const { req, res } = call();
    await preboardingAuth(req, res);
    last = res;
  }
  assert.equal(last.statusCode, 429);
  delete process.env.PREBOARDING_PASSWORD;
});
