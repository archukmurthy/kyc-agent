"use strict";

// AUTH-2: a login hands back a session, and nothing accepts a password as a
// bearer.
//
// Until 2026-09-23 a successful login answered with the password just typed,
// and every later request carried it. So the password could not expire, could
// not be revoked without changing it for everybody who shared it, was re-sent
// on every call rather than once, and a captured token was a captured
// password. One of those tests literally asserted `token === PASSWORD`.
//
// These are the guarantees that replaced it.

const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
require("./_sessions");

const session = require("../../lib/session");
const adminAuth = require("../../lib/adminAuth");
const access = require("../../lib/dossierAccess");
const signOut = require("../sign-out");

const store = new Map();
const memory = {
  get: async (k) => (store.has(k) ? store.get(k) : null),
  set: async (k, v) => { store.set(k, v); },
  del: async (k) => { store.delete(k); },
};

const SAVED = {};
beforeEach(() => {
  store.clear();
  session.__setDeps({ storage: memory, now: () => Date.now() });
  adminAuth.__setDeps({ storage: memory });
  signOut.__resetDeps();
  signOut.__setDeps({ enforceRateLimit: async () => true, session });
  for (const k of ["ADMIN_PASSWORD", "PREBOARDING_PASSWORD", "SUPER_ADMIN_PASSWORD"]) {
    SAVED[k] = process.env[k];
    process.env[k] = "the-shared-password";
  }
});
afterEach(() => {
  for (const [k, v] of Object.entries(SAVED)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

function res() {
  return {
    statusCode: null, body: null, headers: {},
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    end() { return this; },
  };
}

// ── nothing takes a password as a bearer ──────────────────────────────────

test("the shared password is not an admin credential", async () => {
  // The whole point. Before this, the password WAS the token.
  assert.equal(await adminAuth.authorizeAdmin("nium", "the-shared-password"), false);
  assert.equal(await adminAuth.authorizeAdmin("acme", "the-shared-password"), false);
});

test("the pre-boarding password is not an analyst credential", async () => {
  access.__setDeps({
    session,
    registry: { isTenantActive: async () => true, isPreboardingEnabled: async () => true },
  });
  const actor = await access.resolveDossierActor({
    headers: { authorization: "Bearer the-shared-password" },
    query: { tenant: "acme" },
    url: "/api/x",
  });
  assert.equal(actor.kind, "none");
  assert.equal(actor.reason, "invalid_credential");
});

// ── what a session earns ──────────────────────────────────────────────────

test("an admin session opens its own company and no other", async () => {
  const token = session.mint({ subject: "admin:acme", tenantId: "acme", role: "admin" });
  assert.equal(await adminAuth.authorizeAdmin("acme", token), true);
  assert.equal(await adminAuth.authorizeAdmin("rival", token), false);
});

test("an analyst session is not an admin session", async () => {
  // Same signature, same secret, different role. Checked rather than assumed:
  // a signature proves we issued it, not what we issued it for.
  const analyst = session.mint({ subject: "analyst:acme", tenantId: "acme", role: "analyst" });
  assert.equal(await adminAuth.authorizeAdmin("acme", analyst), false);
});

test("a customer's dossier link is not a staff session", async () => {
  // Both are signed with the same secret when only DOSSIER_TOKEN_SECRET is set.
  // The key is derived per purpose, so one cannot verify as the other.
  const dossierToken = require("../../lib/dossierToken");
  const saved = process.env.DOSSIER_TOKEN_SECRET;
  process.env.DOSSIER_TOKEN_SECRET = process.env.SESSION_SECRET || "shared-secret";
  try {
    const link = dossierToken.mint({ dossierId: "d-1", tenantId: "acme" });
    const asStaff = await session.verify(link);
    assert.equal(asStaff.valid, false, "a customer link must never pass as a staff session");
  } finally {
    if (saved === undefined) delete process.env.DOSSIER_TOKEN_SECRET;
    else process.env.DOSSIER_TOKEN_SECRET = saved;
  }
});

// ── the things a password could never do ──────────────────────────────────

test("a session expires; a password never did", async () => {
  const token = session.mint({ subject: "admin:acme", tenantId: "acme", role: "admin", ttlSeconds: 60 });
  assert.equal(await adminAuth.authorizeAdmin("acme", token), true);

  session.__setDeps({ storage: memory, now: () => Date.now() + 61 * 1000 });
  assert.equal(await adminAuth.authorizeAdmin("acme", token), false, "an expired session is no longer a credential");
});

test("signing out ends that session and nobody else's", async () => {
  // Impossible before: the only way to end a session was to change the
  // password, which ended everyone's.
  const mine = session.mint({ subject: "admin:acme", tenantId: "acme", role: "admin" });
  const colleague = session.mint({ subject: "admin:acme", tenantId: "acme", role: "admin" });
  assert.equal(await adminAuth.authorizeAdmin("acme", mine), true);

  const r = res();
  await signOut({ method: "POST", headers: { authorization: `Bearer ${mine}` }, url: "/api/sign-out" }, r);
  assert.equal(r.statusCode, 200);

  assert.equal(await adminAuth.authorizeAdmin("acme", mine), false, "my session is over");
  assert.equal(await adminAuth.authorizeAdmin("acme", colleague), true, "my colleague is still working");
});

test("signing out answers the same whatever it is given", async () => {
  // Otherwise it tells an attacker whether a token is real.
  for (const header of [`Bearer ${session.mint({ subject: "a", role: "admin", tenantId: "acme" })}`, "Bearer nonsense", ""]) {
    const r = res();
    await signOut({ method: "POST", headers: header ? { authorization: header } : {}, url: "/api/sign-out" }, r);
    assert.equal(r.statusCode, 200);
    assert.deepEqual(r.body, { success: true });
  }
});

test("a session that cannot be checked for revocation is refused", async () => {
  // Fail closed: an unreadable store must not resurrect a session somebody
  // deliberately ended.
  const token = session.mint({ subject: "admin:acme", tenantId: "acme", role: "admin" });
  session.__setDeps({ storage: { get: async () => { throw new Error("kv down"); }, set: async () => {} } });
  assert.equal(await adminAuth.authorizeAdmin("acme", token), false);
});

test("a tampered session is refused", async () => {
  const token = session.mint({ subject: "admin:acme", tenantId: "acme", role: "admin" });
  const [body] = token.split(".");
  // Re-sign nothing: swap the payload for one claiming super-admin.
  const forgedBody = Buffer.from(JSON.stringify({
    sub: "admin:acme", tenantId: "acme", role: "super-admin", jti: "x", typ: "staff-session/v1",
    iat: Date.now(), exp: Date.now() + 60000,
  })).toString("base64url");
  const forged = `${forgedBody}.${token.split(".")[1]}`;
  assert.notEqual(forgedBody, body);
  assert.equal((await session.verify(forged)).valid, false);
});
