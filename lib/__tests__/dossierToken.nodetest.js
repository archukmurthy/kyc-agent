const { test } = require("node:test");
const assert = require("node:assert");
const token = require("../dossierToken");

const SECRET = "test-dossier-secret-please-change";

function fakeStorage(initial) {
  const data = { ...(initial || {}) };
  return {
    data,
    async get(k) { return k in data ? data[k] : null; },
    async set(k, v) { data[k] = v; },
  };
}

function withSecret(t, value = SECRET) {
  const prev = process.env.DOSSIER_TOKEN_SECRET;
  if (value === null) delete process.env.DOSSIER_TOKEN_SECRET;
  else process.env.DOSSIER_TOKEN_SECRET = value;
  t.after(() => {
    if (prev === undefined) delete process.env.DOSSIER_TOKEN_SECRET;
    else process.env.DOSSIER_TOKEN_SECRET = prev;
  });
}

function clockAt(ms) { return () => ms; }

test("a freshly minted token verifies and carries its dossier and tenant", async (t) => {
  withSecret(t);
  token.__setDeps({ storage: fakeStorage(), now: clockAt(1_000_000) });
  const tok = token.mint({ dossierId: "d-1", tenantId: "acme" });
  const r = await token.verify(tok);
  assert.strictEqual(r.valid, true);
  assert.strictEqual(r.reason, null);
  assert.strictEqual(r.payload.dossierId, "d-1");
  assert.strictEqual(r.payload.tenantId, "acme");
  assert.strictEqual(r.payload.exp - r.payload.iat, token.DEFAULT_TTL_MS);
});

test("minting without a secret throws rather than issuing an unsigned token", (t) => {
  withSecret(t, null);
  token.__setDeps({ storage: fakeStorage(), now: clockAt(1) });
  assert.throws(() => token.mint({ dossierId: "d-1", tenantId: "acme" }), /DOSSIER_TOKEN_SECRET/);
});

test("verifying without a secret fails closed", async (t) => {
  withSecret(t);
  token.__setDeps({ storage: fakeStorage(), now: clockAt(1) });
  const tok = token.mint({ dossierId: "d-1", tenantId: "acme" });
  delete process.env.DOSSIER_TOKEN_SECRET;
  const r = await token.verify(tok);
  assert.deepStrictEqual({ valid: r.valid, reason: r.reason }, { valid: false, reason: "no_secret" });
});

test("a tampered payload is rejected", async (t) => {
  withSecret(t);
  token.__setDeps({ storage: fakeStorage(), now: clockAt(1) });
  const tok = token.mint({ dossierId: "d-1", tenantId: "acme" });
  const [, sig] = tok.split(".");
  const forged = Buffer.from(JSON.stringify({ dossierId: "d-2", tenantId: "acme", iat: 1, exp: 9e15 })).toString("base64url");
  const r = await token.verify(`${forged}.${sig}`);
  assert.strictEqual(r.valid, false);
  assert.strictEqual(r.reason, "bad_signature");
});

test("a tampered signature is rejected", async (t) => {
  withSecret(t);
  token.__setDeps({ storage: fakeStorage(), now: clockAt(1) });
  const tok = token.mint({ dossierId: "d-1", tenantId: "acme" });
  const [body] = tok.split(".");
  const r = await token.verify(`${body}.AAAA`);
  assert.strictEqual(r.reason, "bad_signature");
});

test("a token signed with a different secret is rejected", async (t) => {
  withSecret(t, "other-secret");
  token.__setDeps({ storage: fakeStorage(), now: clockAt(1) });
  const tok = token.mint({ dossierId: "d-1", tenantId: "acme" });
  process.env.DOSSIER_TOKEN_SECRET = SECRET;
  const r = await token.verify(tok);
  assert.strictEqual(r.reason, "bad_signature");
});

test("malformed input never throws", async (t) => {
  withSecret(t);
  token.__setDeps({ storage: fakeStorage(), now: clockAt(1) });
  for (const bad of [undefined, null, 42, "", "no-dot", "a.b.c", ".sig", "body."]) {
    const r = await token.verify(bad);
    assert.strictEqual(r.valid, false, `expected invalid for ${String(bad)}`);
  }
});

test("an expired token is rejected", async (t) => {
  withSecret(t);
  const storage = fakeStorage();
  token.__setDeps({ storage, now: clockAt(1_000) });
  const tok = token.mint({ dossierId: "d-1", tenantId: "acme", ttlMs: 500 });
  token.__setDeps({ storage, now: clockAt(1_500) });
  const r = await token.verify(tok);
  assert.strictEqual(r.reason, "expired");
});

test("revoking a dossier kills every token issued before the revocation, not later ones", async (t) => {
  withSecret(t);
  const storage = fakeStorage();
  token.__setDeps({ storage, now: clockAt(1_000) });
  const oldTok = token.mint({ dossierId: "d-1", tenantId: "acme" });
  token.__setDeps({ storage, now: clockAt(2_000) });
  await token.revokeAllForDossier("d-1");
  token.__setDeps({ storage, now: clockAt(3_000) });
  const newTok = token.mint({ dossierId: "d-1", tenantId: "acme" });
  assert.strictEqual((await token.verify(oldTok)).reason, "revoked");
  assert.strictEqual((await token.verify(newTok)).valid, true);
});

test("revoking one dossier does not affect another", async (t) => {
  withSecret(t);
  const storage = fakeStorage();
  token.__setDeps({ storage, now: clockAt(1_000) });
  const other = token.mint({ dossierId: "d-2", tenantId: "acme" });
  token.__setDeps({ storage, now: clockAt(2_000) });
  await token.revokeAllForDossier("d-1");
  assert.strictEqual((await token.verify(other)).valid, true);
});

test("if the revocation list cannot be read, verification fails closed", async (t) => {
  withSecret(t);
  token.__setDeps({ storage: fakeStorage(), now: clockAt(1) });
  const tok = token.mint({ dossierId: "d-1", tenantId: "acme" });
  token.__setDeps({ storage: { async get() { throw new Error("kv down"); }, async set() {} }, now: clockAt(2) });
  const r = await token.verify(tok);
  assert.strictEqual(r.valid, false);
  assert.strictEqual(r.reason, "revocation_unavailable");
});
