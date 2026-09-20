"use strict";

// Browser sessions. Today the "token" is the admin password itself: it never
// expires, and revoking it means changing the password for everyone. These
// tests state what replaces it.

const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const session = require("../session");

const SECRET = "test-session-secret-value-long-enough";

let store;
beforeEach(() => {
  process.env.SESSION_SECRET = SECRET;
  store = new Map();
  session.__setDeps({
    storage: {
      get: async (k) => (store.has(k) ? store.get(k) : null),
      set: async (k, v) => { store.set(k, v); },
    },
    now: () => 1_700_000_000_000,
  });
});

test("a minted session names who it is for, and verifies", async () => {
  const token = session.mint({ subject: "admin", tenantId: "acme", role: "admin" });
  const v = await session.verify(token);
  assert.equal(v.valid, true);
  assert.equal(v.payload.tenantId, "acme");
  assert.equal(v.payload.role, "admin");
  assert.ok(v.payload.jti, "every session carries an id so it can be revoked");
});

test("the password never travels in the token", () => {
  const token = session.mint({ subject: "admin", tenantId: "acme", role: "admin", secretValue: "hunter2" });
  assert.ok(!token.includes("hunter2"));
});

test("a tampered token is refused", async () => {
  const token = session.mint({ subject: "admin", tenantId: "acme", role: "admin" });
  // Swap the tenant in the payload and keep the original signature.
  const [payload, sig] = token.split(".");
  const forged = Buffer.from(
    JSON.parse(Buffer.from(payload, "base64url").toString()).tenantId === "acme"
      ? JSON.stringify({ ...JSON.parse(Buffer.from(payload, "base64url").toString()), tenantId: "victim" })
      : "{}"
  ).toString("base64url");
  const v = await session.verify(`${forged}.${sig}`);
  assert.equal(v.valid, false);
  assert.equal(v.reason, "bad_signature");
});

test("an expired session is refused", async () => {
  const token = session.mint({ subject: "admin", tenantId: "acme", role: "admin", ttlSeconds: 60 });
  session.__setDeps({ now: () => 1_700_000_000_000 + 61_000 });
  const v = await session.verify(token);
  assert.equal(v.valid, false);
  assert.equal(v.reason, "expired");
});

test("a revoked session stops working immediately", async () => {
  const token = session.mint({ subject: "admin", tenantId: "acme", role: "admin" });
  assert.equal((await session.verify(token)).valid, true);
  await session.revoke(token);
  const v = await session.verify(token);
  assert.equal(v.valid, false);
  assert.equal(v.reason, "revoked");
});

test("a session signed with another secret is refused", async () => {
  const token = session.mint({ subject: "admin", tenantId: "acme", role: "admin" });
  process.env.SESSION_SECRET = "a-completely-different-secret-value";
  const v = await session.verify(token);
  assert.equal(v.valid, false);
  assert.equal(v.reason, "bad_signature");
});

test("a dossier link token cannot be used as an admin session", async () => {
  // Domain separation: the two token types share a secret fallback, so a token
  // minted for one purpose must not verify for the other.
  const dossierToken = require("../dossierToken");
  process.env.DOSSIER_TOKEN_SECRET = SECRET;
  delete process.env.SESSION_SECRET;
  const link = dossierToken.mint({ dossierId: "1", tenantId: "acme" });
  const v = await session.verify(link);
  assert.equal(v.valid, false);
});

test("garbage is refused rather than throwing", async () => {
  for (const junk of ["", "nonsense", "a.b", "a.b.c.d", null, undefined]) {
    const v = await session.verify(junk);
    assert.equal(v.valid, false, `token=${junk}`);
  }
});
