"use strict";

// The shared route gate: CORS allow-list, credential gate, admin gate.
// Everything here is Guarded (lib/routeAuth.js is on the Guarded path list),
// so each test states the attack it stops, not just the happy path.

const { test } = require("node:test");
const assert = require("node:assert");

const routeAuth = require("../routeAuth");

function makeRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: undefined,
    ended: false,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    getHeader(k) { return this.headers[k.toLowerCase()]; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; this.ended = true; return this; },
    end() { this.ended = true; return this; },
  };
  return res;
}

function makeReq({ method = "GET", origin, headers = {}, query = {} } = {}) {
  const h = { ...headers };
  if (origin) h.origin = origin;
  return { method, headers: h, query };
}

const ORIGIN_ENV = "ALLOWED_ORIGINS";

function withEnv(values, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(values)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test("CORS: an allow-listed origin is echoed back", () => {
  withEnv({ [ORIGIN_ENV]: "https://app.example.com,https://other.example.com" }, () => {
    const res = makeRes();
    routeAuth.applyCors(makeReq({ origin: "https://app.example.com" }), res);
    assert.equal(res.getHeader("access-control-allow-origin"), "https://app.example.com");
    assert.equal(res.getHeader("vary"), "Origin");
  });
});

test("CORS: an origin that is not allow-listed gets no header at all", () => {
  // The attack: evil.example.com calls our API using a signed-in user's browser.
  // Without the header the browser refuses to hand it the response.
  withEnv({ [ORIGIN_ENV]: "https://app.example.com" }, () => {
    const res = makeRes();
    routeAuth.applyCors(makeReq({ origin: "https://evil.example.com" }), res);
    assert.equal(res.getHeader("access-control-allow-origin"), undefined);
  });
});

test("CORS: wildcard is never emitted, even with nothing configured", () => {
  withEnv({ [ORIGIN_ENV]: undefined, VERCEL_URL: undefined, VERCEL_PROJECT_PRODUCTION_URL: undefined }, () => {
    const res = makeRes();
    routeAuth.applyCors(makeReq({ origin: "https://anything.example.com" }), res);
    assert.equal(res.getHeader("access-control-allow-origin"), undefined);
  });
});

test("CORS: a preflight is answered and reported as handled", () => {
  withEnv({ [ORIGIN_ENV]: "https://app.example.com" }, () => {
    const res = makeRes();
    const handled = routeAuth.applyCors(makeReq({ method: "OPTIONS", origin: "https://app.example.com" }), res);
    assert.equal(handled, true);
    assert.equal(res.statusCode, 204);
    assert.equal(res.ended, true);
  });
});

test("CORS: a normal request is not reported as handled", () => {
  const res = makeRes();
  assert.equal(routeAuth.applyCors(makeReq({ origin: "https://app.example.com" }), res), false);
});

test("requireActor: no credential is refused with 401 and returns null", async () => {
  routeAuth.__setDeps({ resolveDossierActor: async () => ({ kind: "none", reason: "unauthorized" }) });
  const res = makeRes();
  const actor = await routeAuth.requireActor(makeReq(), res);
  assert.equal(actor, null);
  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { error: "unauthorized" });
  routeAuth.__resetDeps();
});

test("requireActor: an analyst is allowed through and returned", async () => {
  routeAuth.__setDeps({ resolveDossierActor: async () => ({ kind: "analyst", tenantId: "acme", dossierId: null }) });
  const res = makeRes();
  const actor = await routeAuth.requireActor(makeReq(), res);
  assert.equal(actor.kind, "analyst");
  assert.equal(res.ended, false);
  routeAuth.__resetDeps();
});

test("requireActor: a customer is refused where the route allows analysts only", async () => {
  routeAuth.__setDeps({ resolveDossierActor: async () => ({ kind: "customer", tenantId: "acme", dossierId: "7" }) });
  const res = makeRes();
  const actor = await routeAuth.requireActor(makeReq(), res, { allow: ["analyst"] });
  assert.equal(actor, null);
  assert.equal(res.statusCode, 403);
  routeAuth.__resetDeps();
});

test("requireActor: an expired link says so instead of a bare 401", async () => {
  routeAuth.__setDeps({ resolveDossierActor: async () => ({ kind: "none", reason: "expired" }) });
  const res = makeRes();
  await routeAuth.requireActor(makeReq(), res);
  assert.equal(res.statusCode, 410);
  assert.deepEqual(res.body, { error: "link_expired" });
  routeAuth.__resetDeps();
});

test("requireAdmin: a wrong password is refused", async () => {
  routeAuth.__setDeps({ authorizeAdmin: async () => false });
  const res = makeRes();
  const ok = await routeAuth.requireAdmin(makeReq({ headers: { authorization: "Bearer nope" }, query: { tenant: "acme" } }), res);
  assert.equal(ok, false);
  assert.equal(res.statusCode, 401);
  routeAuth.__resetDeps();
});

test("requireAdmin: a request naming no tenant is refused before any check", async () => {
  let called = false;
  routeAuth.__setDeps({ authorizeAdmin: async () => { called = true; return true; } });
  const res = makeRes();
  const ok = await routeAuth.requireAdmin(makeReq({ headers: { authorization: "Bearer x" } }), res);
  assert.equal(ok, false);
  assert.equal(res.statusCode, 400);
  assert.equal(called, false, "the password must not be checked without a tenant");
  routeAuth.__resetDeps();
});

test("requireAdmin: the right password returns the tenant it authenticated", async () => {
  routeAuth.__setDeps({ authorizeAdmin: async (tenant, token) => tenant === "acme" && token === "secret" });
  const res = makeRes();
  const ok = await routeAuth.requireAdmin(makeReq({ headers: { authorization: "Bearer secret" }, query: { tenant: "acme" } }), res);
  assert.equal(ok, "acme");
  assert.equal(res.ended, false);
  routeAuth.__resetDeps();
});

// ── requireStaff: the UBO surfaces, gated by Clerk ──────────────────────────
//
// Clerk is the identity; the route decides what that identity earns. While
// CLERK_SECRET_KEY is unset the gate is off and the routes behave exactly as
// they do today, which is what lets this ship before the keys exist.

const clerkAuth = require("../clerkAuth");

function withClerk(session, fn) {
  const saved = process.env.CLERK_SECRET_KEY;
  process.env.CLERK_SECRET_KEY = "sk_test_x";
  clerkAuth.__setDeps({ verifyToken: async () => session });
  try {
    return fn();
  } finally {
    clerkAuth.__resetDeps();
    if (saved === undefined) delete process.env.CLERK_SECRET_KEY;
    else process.env.CLERK_SECRET_KEY = saved;
  }
}

test("requireStaff: with Clerk unconfigured the route is left as it was", async () => {
  delete process.env.CLERK_SECRET_KEY;
  const res = makeRes();
  const actor = await routeAuth.requireStaff(makeReq(), res);
  assert.equal(actor.kind, "unauthenticated");
  assert.equal(res.ended, false, "nothing is refused while Clerk is off");
});

test("requireStaff: with Clerk on, no token is a 401", async () => {
  await withClerk(null, async () => {
    const res = makeRes();
    const actor = await routeAuth.requireStaff(makeReq(), res);
    assert.equal(actor, null);
    assert.equal(res.statusCode, 401);
  });
});

test("requireStaff: a signed-in user is returned with their organisation", async () => {
  await withClerk({ sub: "user_1", org_id: "org_a", org_role: "org:admin" }, async () => {
    const res = makeRes();
    const actor = await routeAuth.requireStaff(makeReq({ headers: { authorization: "Bearer t" } }), res);
    assert.equal(actor.kind, "staff");
    assert.equal(actor.userId, "user_1");
    assert.equal(actor.tenantId, "org_a");
    assert.equal(actor.role, "admin");
  });
});

test("requireStaff: a role the route does not allow is refused with 403", async () => {
  await withClerk({ sub: "user_1", org_id: "org_a", org_role: "org:member" }, async () => {
    const res = makeRes();
    const actor = await routeAuth.requireStaff(makeReq({ headers: { authorization: "Bearer t" } }), res, { roles: ["admin"] });
    assert.equal(actor, null);
    assert.equal(res.statusCode, 403);
  });
});

test("requireStaff: a user in no organisation cannot reach tenant work", async () => {
  // Signed in is not the same as belonging somewhere. Without an organisation
  // there is no tenant to scope the work to, so it cannot proceed.
  await withClerk({ sub: "user_1" }, async () => {
    const res = makeRes();
    const actor = await routeAuth.requireStaff(makeReq({ headers: { authorization: "Bearer t" } }), res, { requireTenant: true });
    assert.equal(actor, null);
    assert.equal(res.statusCode, 403);
    assert.deepEqual(res.body, { error: "no_organisation" });
  });
});
