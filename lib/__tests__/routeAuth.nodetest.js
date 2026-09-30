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
const userAccess = require("../userAccess");

let accessStore;
function withClerkAndAccess(session, access, fn, { getUser = async () => null, store = null } = {}) {
  const saved = process.env.CLERK_SECRET_KEY;
  process.env.CLERK_SECRET_KEY = "sk_test_x";
  // getUser is always stubbed: without it the no-access path reaches Clerk's
  // real API, which a test must never do.
  clerkAuth.__setDeps({ verifyToken: async () => session, getUser });
  accessStore = access;
  userAccess.__setDeps({
    storage: store || {
      get: async (k) => (k.startsWith("user-access:") && accessStore ? accessStore : null),
      set: async () => {},
    },
  });
  const done = () => {
    clerkAuth.__resetDeps();
    if (saved === undefined) delete process.env.CLERK_SECRET_KEY;
    else process.env.CLERK_SECRET_KEY = saved;
  };
  return Promise.resolve(fn()).finally(done);
}

test("requireStaff: with Clerk unconfigured the route is left as it was", async () => {
  delete process.env.CLERK_SECRET_KEY;
  const res = makeRes();
  const actor = await routeAuth.requireStaff(makeReq(), res);
  assert.equal(actor.kind, "unauthenticated");
  assert.equal(res.ended, false, "nothing is refused while Clerk is off");
});

test("requireStaff: with Clerk on, no token is a 401", async () => {
  await withClerkAndAccess(null, null, async () => {
    const res = makeRes();
    const actor = await routeAuth.requireStaff(makeReq(), res);
    assert.equal(actor, null);
    assert.equal(res.statusCode, 401);
  });
});

test("requireStaff: signed in but not on the access list is refused, and told why", async () => {
  // The common case on day one: a real colleague whose account exists and whom
  // nobody has added yet. "no_access" says that; "forbidden" would not.
  await withClerkAndAccess({ sub: "user_new" }, null, async () => {
    const res = makeRes();
    const actor = await routeAuth.requireStaff(makeReq({ headers: { authorization: "Bearer t" } }), res);
    assert.equal(actor, null);
    assert.equal(res.statusCode, 403);
    assert.deepEqual(res.body, { error: "no_access" });
  });
});

test("requireStaff: a listed analyst gets their own company, whatever Clerk says", async () => {
  // The tenant comes from our list, never from the token or the URL.
  await withClerkAndAccess(
    { sub: "user_1", org_id: "org_from_clerk" },
    { tenantId: "acme", role: "analyst" },
    async () => {
      const res = makeRes();
      const actor = await routeAuth.requireStaff(makeReq({ headers: { authorization: "Bearer t" }, query: { tenant: "someone-else" } }), res);
      assert.equal(actor.kind, "staff");
      assert.equal(actor.tenantId, "acme");
      assert.equal(actor.role, "analyst");
    }
  );
});

test("requireStaff: a role the route does not allow is refused with 403", async () => {
  await withClerkAndAccess({ sub: "user_1" }, { tenantId: "acme", role: "analyst" }, async () => {
    const res = makeRes();
    const actor = await routeAuth.requireStaff(makeReq({ headers: { authorization: "Bearer t" } }), res, { roles: ["admin"] });
    assert.equal(actor, null);
    assert.equal(res.statusCode, 403);
  });
});

test("requireStaff: an owner passes a role check they are not named in", async () => {
  await withClerkAndAccess({ sub: "user_boss" }, { tenantId: null, role: "owner" }, async () => {
    const res = makeRes();
    const actor = await routeAuth.requireStaff(makeReq({ headers: { authorization: "Bearer t" } }), res, { roles: ["admin"] });
    assert.equal(actor.role, "owner");
  });
});

test("requireStaff: an invitation sent before they signed up becomes access on arrival", async () => {
  // An admin invites a colleague by email, because nobody has a Clerk id until
  // they sign in. This is where that invitation is collected.
  const store = new Map([[
    "user-access:pending:new@acme.test",
    { email: "new@acme.test", tenantId: "acme", role: "admin", addedBy: "user_admin" },
  ]]);
  await withClerkAndAccess(
    { sub: "user_new" },
    null,
    async () => {
      const res = makeRes();
      const actor = await routeAuth.requireStaff(makeReq({ headers: { authorization: "Bearer t" } }), res);
      assert.equal(actor.role, "admin");
      assert.equal(actor.tenantId, "acme");
      assert.equal(store.has("user-access:pending:new@acme.test"), false, "a claimed invitation is spent");
    },
    {
      getUser: async () => ({
        primaryEmailAddressId: "idem_1",
        emailAddresses: [{ id: "idem_1", emailAddress: "new@acme.test", verification: { status: "verified" } }],
      }),
      store: {
        get: async (k) => (store.has(k) ? store.get(k) : null),
        set: async (k, v) => { store.set(k, v); },
        del: async (k) => { store.delete(k); },
      },
    }
  );
});

test("requireStaff: the invitation is matched on Clerk's email, never the caller's", async () => {
  // Otherwise any signed-in stranger could post boss@ourcustomer.test and
  // collect the admin grant left waiting for somebody else.
  const store = new Map([[
    "user-access:pending:boss@acme.test",
    { email: "boss@acme.test", tenantId: "acme", role: "admin" },
  ]]);
  await withClerkAndAccess(
    { sub: "user_stranger" },
    null,
    async () => {
      const res = makeRes();
      const req = makeReq({ headers: { authorization: "Bearer t" }, body: { email: "boss@acme.test" } });
      const actor = await routeAuth.requireStaff(req, res);
      assert.equal(actor, null);
      assert.equal(res.statusCode, 403);
      assert.equal(store.has("user-access:pending:boss@acme.test"), true, "the invitation is still waiting for the person it was sent to");
    },
    {
      getUser: async () => ({
        primaryEmailAddressId: "idem_1",
        emailAddresses: [{ id: "idem_1", emailAddress: "stranger@example.test", verification: { status: "verified" } }],
      }),
      store: {
        get: async (k) => (store.has(k) ? store.get(k) : null),
        set: async (k, v) => { store.set(k, v); },
        del: async (k) => { store.delete(k); },
      },
    }
  );
});

test("requireStaff: a role cannot be checked when there is nobody to have one", async () => {
  // The gate is inert without Clerk so the demo runs locally with no accounts.
  // But returning the unauthenticated actor made every ROLE check pass - the
  // caller writes `if (!(await requireStaff(req, res, { roles: ["owner"] })))`,
  // and a truthy object is not falsy. An unconfigured deployment therefore let
  // anyone create trial invites with any seats and any research budget. Found
  // by calling the live route with no credentials at all.
  delete process.env.CLERK_SECRET_KEY;
  const res = makeRes();
  const actor = await routeAuth.requireStaff(makeReq(), res, { roles: ["owner"] });
  assert.equal(actor, null, "a role check must refuse, not wave through");
  assert.equal(res.statusCode, 401);
});

test("requireStaff: a route that names no role is still inert without Clerk", async () => {
  // The demo screens depend on this: no accounts needed to run it locally.
  delete process.env.CLERK_SECRET_KEY;
  const res = makeRes();
  const actor = await routeAuth.requireStaff(makeReq(), res);
  assert.equal(actor.kind, "unauthenticated");
  assert.equal(res.ended, false);
});

// requireUboCaller: a UBO route's caller is either a signed-in analyst (Clerk,
// through requireStaff) or a customer holding a session for ONE case
// (lib/uboCustomerLink.js). Written from the customer's side.
const customerLink = require("../uboCustomerLink");

function withSecret(work) {
  const saved = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "route-auth-test-secret-long-enough";
  const store = new Map();
  customerLink.__setDeps({ storage: { get: async (k) => store.get(k) ?? null, set: async (k, v) => { store.set(k, v); } } });
  return Promise.resolve().then(work).finally(() => { if (saved === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = saved; });
}

test("a customer session makes the caller a customer of that one case", () => withSecret(async () => {
  const { session } = customerLink.mintCustomerSession({ caseId: "case-1", tenantId: "trial-acme-1a2b3c4d" });
  const res = makeRes();
  const actor = await routeAuth.requireUboCaller(makeReq({ headers: { "x-ubo-customer-session": session } }), res);
  assert.deepStrictEqual(actor, { kind: "customer", tenantId: "trial-acme-1a2b3c4d", caseId: "case-1", role: "customer" });
  assert.strictEqual(routeAuth.uboCallerTenant(actor), "trial-acme-1a2b3c4d");
}));

test("a bad customer session is refused, never treated as a staff caller", () => withSecret(async () => {
  const res = makeRes();
  const actor = await routeAuth.requireUboCaller(makeReq({ headers: { "x-ubo-customer-session": "forged.token" } }), res);
  assert.strictEqual(actor, null);
  assert.strictEqual(res.statusCode, 401);
}));

test("without a customer session the caller goes through the staff gate", () => withSecret(async () => {
  const actor = await routeAuth.requireUboCaller(makeReq(), makeRes());
  assert.strictEqual(actor.kind, "unauthenticated", "Clerk is off in tests, so requireStaff's own answer comes back");
}));

test("a browser may send the customer session header across origins", () => {
  const res = makeRes();
  routeAuth.applyCors(makeReq({ method: "OPTIONS", origin: "http://localhost:3000" }), res);
  assert.match(String(res.headers["access-control-allow-headers"] || ""), /X-Ubo-Customer-Session/i);
});
