const { test, before, after } = require("node:test");
const assert = require("node:assert");
const handler = require("../revoke-dossier-token");

let prevUrl;
before(() => { prevUrl = process.env.DATABASE_URL; process.env.DATABASE_URL = "postgres://test"; });
after(() => { if (prevUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = prevUrl; });

function fakeRes() {
  return { statusCode: null, body: null, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, end() { return this; } };
}

function accessWith(actor) {
  const real = require("../../lib/dossierAccess");
  return { ...real, resolveDossierActor: async () => actor };
}

const ANALYST = { kind: "analyst", tenantId: "acme", dossierId: null, reason: null };
const req = (body) => ({ method: "POST", body, headers: {}, query: {} });

test("only an analyst may revoke", async () => {
  let revoked = false;
  handler.__setDeps({
    neon: () => () => Promise.resolve([{ id: "d-1" }]),
    access: accessWith({ kind: "customer", tenantId: "acme", dossierId: "d-1", reason: null }),
    dossierToken: { revokeAllForDossier: async () => { revoked = true; return { revokedBefore: 1 }; } },
  });
  const res = fakeRes();
  await handler(req({ dossierId: "d-1" }), res);
  assert.strictEqual(res.statusCode, 403);
  assert.strictEqual(revoked, false);
});

test("a dossier outside the analyst's tenant is a 404 and nothing is revoked", async () => {
  let revoked = false;
  handler.__setDeps({
    neon: () => () => Promise.resolve([]),
    access: accessWith(ANALYST),
    dossierToken: { revokeAllForDossier: async () => { revoked = true; return { revokedBefore: 1 }; } },
  });
  const res = fakeRes();
  await handler(req({ dossierId: "d-1" }), res);
  assert.strictEqual(res.statusCode, 404);
  assert.strictEqual(revoked, false);
});

test("an analyst revokes every outstanding link for its dossier", async () => {
  let revokedFor = null;
  handler.__setDeps({
    neon: () => () => Promise.resolve([{ id: "d-1" }]),
    access: accessWith(ANALYST),
    dossierToken: { revokeAllForDossier: async (id) => { revokedFor = id; return { revokedBefore: 1234 }; } },
  });
  const res = fakeRes();
  await handler(req({ dossierId: "d-1" }), res);
  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(res.body, { success: true, revokedBefore: 1234 });
  assert.strictEqual(revokedFor, "d-1");
});

test("400 without a dossierId", async () => {
  handler.__setDeps({ neon: () => () => Promise.resolve([]), access: accessWith(ANALYST), dossierToken: { revokeAllForDossier: async () => ({}) } });
  const res = fakeRes();
  await handler(req({}), res);
  assert.strictEqual(res.statusCode, 400);
});

test("without DATABASE_URL the request fails closed and nothing is revoked", async () => {
  const savedUrl = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  let revoked = false;
  handler.__setDeps({
    neon: () => () => Promise.resolve([{ id: "d-1" }]),
    access: accessWith(ANALYST),
    dossierToken: { revokeAllForDossier: async () => { revoked = true; return { revokedBefore: 1 }; } },
  });
  const res = fakeRes();
  try {
    await handler(req({ dossierId: "d-1" }), res);
  } finally {
    if (savedUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = savedUrl;
  }
  assert.strictEqual(res.statusCode, 500);
  assert.deepStrictEqual(res.body, { error: "not_configured" });
  assert.strictEqual(revoked, false);
});
