const { test, afterEach } = require("node:test");
const assert = require("node:assert");

const SECRET = "test-dossier-secret";

function fakeRes() {
  return {
    statusCode: null, body: null, headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    end() { return this; },
  };
}

function fakeStore() {
  const data = {};
  return { data, async set(key, value) { data[key] = value; } };
}

function fakeSql(row) {
  const sql = () => Promise.resolve(row ? [row] : []);
  return sql;
}

function accessWith(actor) {
  const real = require("../../lib/dossierAccess");
  return { ...real, resolveDossierActor: async () => actor };
}

const ANALYST = { kind: "analyst", tenantId: "acme", dossierId: null, reason: null };
const ROW = { id: "dossier-1", tenant_id: "acme" };
const basePayload = { email: "sarah@company.com", contactName: "Sarah Chen", companyName: "Acme Ltd", dossierId: "dossier-1" };

function reqWith(body, headers) {
  return { method: "POST", body, headers: headers || { host: "kyc-agent-deploy.vercel.app" }, query: {} };
}

function setup(t, { actor = ANALYST, row = ROW, secret = SECRET, dbUrl = "postgres://test", sql, sendEmail, readConfigForTenant } = {}) {
  const handler = require("../invite");
  const prevKey = process.env.RESEND_API_KEY;
  const prevSecret = process.env.DOSSIER_TOKEN_SECRET;
  const prevDbUrl = process.env.DATABASE_URL;
  delete process.env.RESEND_API_KEY;
  if (secret === null) delete process.env.DOSSIER_TOKEN_SECRET; else process.env.DOSSIER_TOKEN_SECRET = secret;
  if (dbUrl === null) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = dbUrl;
  t.after(() => {
    if (prevKey === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = prevKey;
    if (prevSecret === undefined) delete process.env.DOSSIER_TOKEN_SECRET; else process.env.DOSSIER_TOKEN_SECRET = prevSecret;
    if (prevDbUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = prevDbUrl;
  });
  const store = fakeStore();
  handler.__setDeps({
    store,
    neon: () => sql || fakeSql(row),
    access: accessWith(actor),
    readConfigForTenant: readConfigForTenant || (async () => ({ company: { name: "Acme Payments" } })),
    sendEmail: sendEmail || (async () => { throw new Error("sendEmail called without a test-provided fake"); }),
  });
  return { handler, store };
}

afterEach(() => {
  const handler = require("../invite");
  handler.__setDeps({ store: fakeStore(), sendEmail: async () => { throw new Error("no fake"); } });
});

test("a customer or anonymous caller cannot send invites", async (t) => {
  const { handler } = setup(t, { actor: { kind: "none", tenantId: null, dossierId: null, reason: "unauthorized" } });
  const res = fakeRes();
  await handler(reqWith({ ...basePayload }), res);
  assert.strictEqual(res.statusCode, 401);

  const { handler: h2 } = setup(t, { actor: { kind: "customer", tenantId: "acme", dossierId: "dossier-1", reason: null } });
  const res2 = fakeRes();
  await h2(reqWith({ ...basePayload }), res2);
  assert.strictEqual(res2.statusCode, 403);
  assert.deepStrictEqual(res2.body, { error: "forbidden" });
});

test("400 when email, contactName or dossierId is missing", async (t) => {
  const { handler } = setup(t);
  for (const body of [{ ...basePayload, email: "" }, { ...basePayload, contactName: "" }, { ...basePayload, dossierId: "" }]) {
    const res = fakeRes();
    await handler(reqWith(body), res);
    assert.strictEqual(res.statusCode, 400);
  }
});

test("a dossier outside the analyst's tenant is a 404", async (t) => {
  const { handler } = setup(t, { row: null });
  const res = fakeRes();
  await handler(reqWith({ ...basePayload }), res);
  assert.strictEqual(res.statusCode, 404);
});

test("without DOSSIER_TOKEN_SECRET no link can be issued", async (t) => {
  const { handler } = setup(t, { secret: null });
  const res = fakeRes();
  await handler(reqWith({ ...basePayload }), res);
  assert.strictEqual(res.statusCode, 500);
  assert.deepStrictEqual(res.body, { error: "not_configured" });
});

function withMintSpy(t) {
  const real = require("../../lib/dossierToken");
  let minted = false;
  const handler = require("../invite");
  handler.__setDeps({ dossierToken: { ...real, mint: (...args) => { minted = true; return real.mint(...args); } } });
  t.after(() => { handler.__setDeps({ dossierToken: real }); });
  return () => minted;
}

test("without DATABASE_URL the request fails closed before minting or storing anything", async (t) => {
  const { handler, store } = setup(t, { dbUrl: null });
  const mintedFn = withMintSpy(t);
  const res = fakeRes();
  await handler(reqWith({ ...basePayload }), res);
  assert.strictEqual(res.statusCode, 500);
  assert.deepStrictEqual(res.body, { error: "not_configured" });
  assert.strictEqual(mintedFn(), false);
  assert.strictEqual(Object.keys(store.data).length, 0);
});

test("a failing dossier lookup fails closed before minting or storing anything", async (t) => {
  const throwingSql = () => { throw new Error("connection refused"); };
  const { handler, store } = setup(t, { sql: throwingSql });
  const mintedFn = withMintSpy(t);
  const res = fakeRes();
  await handler(reqWith({ ...basePayload }), res);
  assert.strictEqual(res.statusCode, 500);
  assert.deepStrictEqual(res.body, { error: "lookup_failed" });
  assert.strictEqual(mintedFn(), false);
  assert.strictEqual(Object.keys(store.data).length, 0);
});

test("the emailed link carries a verifiable token and no raw dossier id", async (t) => {
  const { handler } = setup(t);
  const res = fakeRes();
  await handler(reqWith({ ...basePayload }), res);
  assert.strictEqual(res.statusCode, 200);
  const url = new URL(res.body.link);
  assert.strictEqual(url.origin, "https://kyc-agent-deploy.vercel.app");
  assert.strictEqual(url.searchParams.get("tenant"), "acme");
  assert.strictEqual(url.searchParams.get("journey"), "customer");
  assert.strictEqual(url.searchParams.get("dossierId"), null);
  const tok = url.searchParams.get("dossierToken");
  assert.ok(tok);
  const verified = await require("../../lib/dossierToken").verify(tok);
  assert.strictEqual(verified.valid, true);
  assert.strictEqual(verified.payload.dossierId, "dossier-1");
  assert.strictEqual(verified.payload.tenantId, "acme");
});

test("the tenant comes from the credential; a body tenantId and a client link are ignored", async (t) => {
  const { handler } = setup(t);
  const res = fakeRes();
  await handler(reqWith({ ...basePayload, tenantId: "evil", link: "https://evil.example.com/x" }), res);
  assert.strictEqual(res.statusCode, 200);
  assert.match(res.body.link, /^https:\/\/kyc-agent-deploy\.vercel\.app\//);
  assert.strictEqual(new URL(res.body.link).searchParams.get("tenant"), "acme");
});

test("the persisted invite record never contains the link or the token", async (t) => {
  const { handler, store } = setup(t);
  const res = fakeRes();
  await handler(reqWith({ ...basePayload }), res);
  const records = Object.values(store.data);
  assert.strictEqual(records.length, 1);
  const serialised = JSON.stringify(records[0]);
  assert.doesNotMatch(serialised, /dossierToken/);
  assert.strictEqual(records[0].link, undefined);
  assert.strictEqual(records[0].dossierId, "dossier-1");
  assert.strictEqual(records[0].tenantId, "acme");
});

test("the email uses the tenant's own company name", async (t) => {
  const { handler } = setup(t);
  const res = fakeRes();
  await handler(reqWith({ ...basePayload }), res);
  assert.match(res.body.subject, /Acme Payments/);
  assert.doesNotMatch(res.body.subject, /Nium/i);
  assert.match(res.body.body, /dossierToken=/);
});

test("a tenant with no configured company name falls back to its tenant id", async (t) => {
  const { handler } = setup(t, { readConfigForTenant: async () => ({ company: {} }) });
  const res = fakeRes();
  await handler(reqWith({ ...basePayload }), res);
  assert.match(res.body.subject, /acme/);
});

test("a real send passes the token link to the provider", async (t) => {
  let sent = null;
  const { handler } = setup(t, { sendEmail: async (args) => { sent = args; return { ok: true, data: { id: "p-1" } }; } });
  process.env.RESEND_API_KEY = "test-key";
  const res = fakeRes();
  await handler(reqWith({ ...basePayload }), res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.sent, true);
  assert.match(sent.text, /dossierToken=/);
  assert.doesNotMatch(sent.text, /dossierId=/);
});
