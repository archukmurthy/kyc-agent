const { test } = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");
const grant = require("../researchGrant");

const SUBJECT = "dossier:d-1";

function fakeStorage() {
  const data = {};
  const ttls = {};
  return {
    data, ttls,
    async get(k) { return k in data ? data[k] : null; },
    async set(k, v, opts) { data[k] = v; ttls[k] = opts && opts.ttlSeconds; },
  };
}

// Sets both secrets for one test and restores them afterwards.
function withSecrets(t, { research = "grant-secret", dossier = null } = {}) {
  const prev = { r: process.env.RESEARCH_GRANT_SECRET, d: process.env.DOSSIER_TOKEN_SECRET };
  const put = (name, v) => { if (v === null || v === undefined) delete process.env[name]; else process.env[name] = v; };
  put("RESEARCH_GRANT_SECRET", research);
  put("DOSSIER_TOKEN_SECRET", dossier);
  t.after(() => { put("RESEARCH_GRANT_SECRET", prev.r); put("DOSSIER_TOKEN_SECRET", prev.d); });
}

test("a minted grant verifies for its subject and tenant", (t) => {
  withSecrets(t);
  grant.__setDeps({ storage: fakeStorage(), now: () => 1_000_000 });
  const tok = grant.mint({ subject: SUBJECT, tenantId: "acme" });
  const r = grant.verify(tok, { subject: SUBJECT, tenantId: "acme" });
  assert.strictEqual(r.valid, true);
  assert.strictEqual(r.payload.sub, SUBJECT);
  assert.strictEqual(r.payload.tid, "acme");
  assert.strictEqual(r.payload.exp, 1_000_000 + 600 * 1000);
  assert.strictEqual(typeof r.payload.jti, "string");
  assert.ok(r.payload.jti.length >= 16);
});

test("two grants never share a jti", (t) => {
  withSecrets(t);
  grant.__setDeps({ storage: fakeStorage(), now: () => 1 });
  const a = grant.verify(grant.mint({ subject: SUBJECT, tenantId: "acme" }), { subject: SUBJECT, tenantId: "acme" });
  const b = grant.verify(grant.mint({ subject: SUBJECT, tenantId: "acme" }), { subject: SUBJECT, tenantId: "acme" });
  assert.notStrictEqual(a.payload.jti, b.payload.jti);
});

test("a tampered payload is a bad signature", (t) => {
  withSecrets(t);
  grant.__setDeps({ storage: fakeStorage(), now: () => 1 });
  const [, sig] = grant.mint({ subject: SUBJECT, tenantId: "acme" }).split(".");
  const forged = Buffer.from(JSON.stringify({ sub: "dossier:d-2", tid: "acme", exp: 9e15, jti: "x" })).toString("base64url");
  assert.strictEqual(grant.verify(`${forged}.${sig}`, { subject: "dossier:d-2", tenantId: "acme" }).reason, "bad_signature");
});

test("a tampered signature is a bad signature (length-checked, never throws)", (t) => {
  withSecrets(t);
  grant.__setDeps({ storage: fakeStorage(), now: () => 1 });
  const [body, sig] = grant.mint({ subject: SUBJECT, tenantId: "acme" }).split(".");
  const flipped = (sig[0] === "A" ? "B" : "A") + sig.slice(1);
  for (const s of ["AAAA", flipped, sig + "A"]) {
    assert.strictEqual(grant.verify(`${body}.${s}`, { subject: SUBJECT, tenantId: "acme" }).reason, "bad_signature");
  }
});

test("the signature is compared with crypto.timingSafeEqual", (t) => {
  withSecrets(t);
  grant.__setDeps({ storage: fakeStorage(), now: () => 1 });
  const tok = grant.mint({ subject: SUBJECT, tenantId: "acme" });
  const real = crypto.timingSafeEqual;
  let calls = 0;
  crypto.timingSafeEqual = (a, b) => { calls += 1; return real(a, b); };
  t.after(() => { crypto.timingSafeEqual = real; });
  assert.strictEqual(grant.verify(tok, { subject: SUBJECT, tenantId: "acme" }).valid, true);
  assert.strictEqual(calls, 1);
});

test("garbage is malformed", (t) => {
  withSecrets(t);
  grant.__setDeps({ storage: fakeStorage(), now: () => 1 });
  for (const bad of [undefined, null, 42, "", "nodot", "a.b.c", ".sig", "body."]) {
    assert.strictEqual(grant.verify(bad, { subject: SUBJECT, tenantId: "acme" }).reason, "malformed");
  }
});

test("a correctly signed payload missing fields is malformed", (t) => {
  withSecrets(t);
  grant.__setDeps({ storage: fakeStorage(), now: () => 1 });
  const body = Buffer.from(JSON.stringify({ sub: SUBJECT, tid: "acme" })).toString("base64url");
  const sig = crypto.createHmac("sha256", "grant-secret").update(body).digest("base64url");
  assert.strictEqual(grant.verify(`${body}.${sig}`, { subject: SUBJECT, tenantId: "acme" }).reason, "malformed");
});

test("an expired grant is refused", (t) => {
  withSecrets(t);
  let now = 1_000_000;
  grant.__setDeps({ storage: fakeStorage(), now: () => now });
  const tok = grant.mint({ subject: SUBJECT, tenantId: "acme", ttlSeconds: 60 });
  now += 60 * 1000;
  assert.strictEqual(grant.verify(tok, { subject: SUBJECT, tenantId: "acme" }).reason, "expired");
});

test("a grant for another subject or tenant is wrong_subject", (t) => {
  withSecrets(t);
  grant.__setDeps({ storage: fakeStorage(), now: () => 1 });
  const tok = grant.mint({ subject: SUBJECT, tenantId: "acme" });
  assert.strictEqual(grant.verify(tok, { subject: "dossier:d-2", tenantId: "acme" }).reason, "wrong_subject");
  assert.strictEqual(grant.verify(tok, { subject: SUBJECT, tenantId: "other" }).reason, "wrong_subject");
});

test("no secret: mint throws, verify fails closed", (t) => {
  withSecrets(t);
  grant.__setDeps({ storage: fakeStorage(), now: () => 1 });
  const tok = grant.mint({ subject: SUBJECT, tenantId: "acme" });
  delete process.env.RESEARCH_GRANT_SECRET;
  assert.throws(() => grant.mint({ subject: SUBJECT, tenantId: "acme" }), /no_secret/);
  assert.strictEqual(grant.verify(tok, { subject: SUBJECT, tenantId: "acme" }).reason, "no_secret");
});

test("falls back to DOSSIER_TOKEN_SECRET", (t) => {
  withSecrets(t, { research: null, dossier: "dossier-secret" });
  grant.__setDeps({ storage: fakeStorage(), now: () => 1 });
  const tok = grant.mint({ subject: SUBJECT, tenantId: "acme" });
  assert.strictEqual(grant.verify(tok, { subject: SUBJECT, tenantId: "acme" }).valid, true);
  const [body] = tok.split(".");
  const expected = crypto.createHmac("sha256", "dossier-secret").update(body).digest("base64url");
  assert.strictEqual(tok.split(".")[1], expected);
});

test("consume burns a jti once, with a 900s TTL", async (t) => {
  withSecrets(t);
  const storage = fakeStorage();
  grant.__setDeps({ storage, now: () => 1 });
  const { payload } = grant.verify(grant.mint({ subject: SUBJECT, tenantId: "acme" }), { subject: SUBJECT, tenantId: "acme" });
  assert.strictEqual(await grant.consume(payload), true);
  assert.strictEqual(await grant.consume(payload), false);
  assert.strictEqual(storage.ttls[`research-grant-used:${payload.jti}`], 900);
});
