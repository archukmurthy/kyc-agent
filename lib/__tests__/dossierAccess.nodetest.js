const { test } = require("node:test");
const assert = require("node:assert");
const access = require("../dossierAccess");

// Stands in for a token minted by the pre-boarding login.
const ANALYST_SESSION = "analyst-session-token";

function req({ auth, query = {}, headers = {} } = {}) {
  return { query, headers: { ...headers, ...(auth ? { authorization: auth } : {}) }, url: "/api/x" };
}

function deps({ tokenResult, analystOk = true, active = true, preboarding = true, analystTenant = "acme" } = {}) {
  return {
    // An analyst arrives with a SESSION now, not the password - the password is
    // checked once at /api/preboarding-auth and never travels again (AUTH-2).
    // The session names the company it was issued for, which is why the stub
    // carries a tenant.
    session: {
      verify: async (tok) => (analystOk && tok === ANALYST_SESSION
        ? { valid: true, payload: { role: "analyst", tenantId: analystTenant, sub: "analyst:" + analystTenant } }
        : { valid: false, reason: "bad_signature" }),
    },
    verifyEnvBearer: () => false,
    dossierToken: { verify: async () => tokenResult || { valid: false, reason: "malformed" } },
    registry: {
      isTenantActive: async () => active,
      isPreboardingEnabled: async () => preboarding,
    },
  };
}

const VALID = { valid: true, reason: null, payload: { dossierId: "d-1", tenantId: "acme", iat: 1, exp: 9e15 } };

test("no credential resolves to none", async () => {
  access.__setDeps(deps());
  const a = await access.resolveDossierActor(req({ query: { tenant: "acme" } }));
  assert.strictEqual(a.kind, "none");
  assert.deepStrictEqual(access.denyFor(a), { status: 401, error: "unauthorized" });
});

test("a valid customer token in the Authorization header resolves to that dossier and tenant", async () => {
  access.__setDeps(deps({ tokenResult: VALID }));
  const a = await access.resolveDossierActor(req({ auth: "Bearer dossier:tok" }));
  assert.deepStrictEqual(a, { kind: "customer", tenantId: "acme", dossierId: "d-1", reason: null });
});

test("a valid customer token in the query string also resolves", async () => {
  access.__setDeps(deps({ tokenResult: VALID }));
  const a = await access.resolveDossierActor(req({ query: { dossierToken: "tok", tenant: "acme" } }));
  assert.strictEqual(a.kind, "customer");
});

test("a customer token for another tenant than the request names is refused", async () => {
  access.__setDeps(deps({ tokenResult: VALID }));
  const a = await access.resolveDossierActor(req({ auth: "Bearer dossier:tok", query: { tenant: "other" } }));
  assert.strictEqual(a.kind, "none");
  assert.strictEqual(a.reason, "tenant_mismatch");
});

test("expired and revoked customer tokens map to 410 with distinct errors", async () => {
  access.__setDeps(deps({ tokenResult: { valid: false, reason: "expired" } }));
  const expired = await access.resolveDossierActor(req({ auth: "Bearer dossier:tok" }));
  assert.deepStrictEqual(access.denyFor(expired), { status: 410, error: "link_expired" });

  access.__setDeps(deps({ tokenResult: { valid: false, reason: "revoked" } }));
  const revoked = await access.resolveDossierActor(req({ auth: "Bearer dossier:tok" }));
  assert.deepStrictEqual(access.denyFor(revoked), { status: 410, error: "link_revoked" });
});

test("an analyst session resolves to an analyst for an active tenant with pre-boarding on", async () => {
  access.__setDeps(deps());
  const a = await access.resolveDossierActor(req({ auth: `Bearer ${ANALYST_SESSION}`, query: { tenant: "acme" } }));
  assert.deepStrictEqual(a, { kind: "analyst", tenantId: "acme", dossierId: null, reason: null });
});

test("an analyst session is refused for a tenant without pre-boarding, an inactive tenant, or no tenant", async () => {
  access.__setDeps(deps({ preboarding: false }));
  assert.strictEqual((await access.resolveDossierActor(req({ auth: `Bearer ${ANALYST_SESSION}`, query: { tenant: "acme" } }))).kind, "none");

  access.__setDeps(deps({ active: false }));
  assert.strictEqual((await access.resolveDossierActor(req({ auth: `Bearer ${ANALYST_SESSION}`, query: { tenant: "acme" } }))).kind, "none");

  access.__setDeps(deps());
  const noTenant = await access.resolveDossierActor(req({ auth: `Bearer ${ANALYST_SESSION}` }));
  assert.strictEqual(noTenant.kind, "none");
  assert.strictEqual(noTenant.reason, "tenant_required");
});

test("a token we did not mint is refused", async () => {
  access.__setDeps(deps());
  const a = await access.resolveDossierActor(req({ auth: "Bearer wrong", query: { tenant: "acme" } }));
  assert.strictEqual(a.kind, "none");
});

const ROW = { id: "d-1", tenant_id: "acme", owned_by: "analyst" };
const ANALYST = { kind: "analyst", tenantId: "acme", dossierId: null, reason: null };
const CUSTOMER = { kind: "customer", tenantId: "acme", dossierId: "d-1", reason: null };

test("an analyst reads and writes dossiers in its own tenant", () => {
  assert.deepStrictEqual(access.canReadDossier(ANALYST, ROW), { ok: true });
  assert.deepStrictEqual(access.canWriteDossier(ANALYST, ROW), { ok: true });
});

test("an analyst cannot see another tenant's dossier — reported as not found, not forbidden", () => {
  const r = access.canReadDossier(ANALYST, { ...ROW, tenant_id: "other" });
  assert.deepStrictEqual(r, { ok: false, status: 404, error: "dossier_not_found" });
});

test("an analyst can read but not write a customer-owned dossier", () => {
  const owned = { ...ROW, owned_by: "customer" };
  assert.deepStrictEqual(access.canReadDossier(ANALYST, owned), { ok: true });
  assert.deepStrictEqual(access.canWriteDossier(ANALYST, owned), { ok: false, status: 403, error: "dossier_locked" });
});

test("a customer reads and writes only the dossier its token names", () => {
  assert.deepStrictEqual(access.canReadDossier(CUSTOMER, ROW), { ok: true });
  assert.deepStrictEqual(access.canWriteDossier(CUSTOMER, { ...ROW, owned_by: "customer" }), { ok: true });
  assert.deepStrictEqual(access.canReadDossier(CUSTOMER, { ...ROW, id: "d-2" }), { ok: false, status: 403, error: "forbidden" });
  assert.deepStrictEqual(access.canWriteDossier(CUSTOMER, { ...ROW, tenant_id: "other" }), { ok: false, status: 403, error: "forbidden" });
});

test("a missing row is not found for everyone", () => {
  assert.strictEqual(access.canReadDossier(ANALYST, null).status, 404);
  assert.strictEqual(access.canReadDossier(CUSTOMER, null).status, 404);
});

test("a none actor is never allowed", () => {
  const none = { kind: "none", tenantId: null, dossierId: null, reason: "unauthorized" };
  assert.strictEqual(access.canReadDossier(none, ROW).status, 401);
  assert.strictEqual(access.canWriteDossier(none, ROW).status, 401);
});

test("an empty 'Bearer dossier:' falls back to the query token and is never tried as a password", async () => {
  let analystChecked = false;
  access.__setDeps({
    ...deps({ tokenResult: VALID }),
    verifyEnvBearer: () => { analystChecked = true; return true; },
  });
  const a = await access.resolveDossierActor(req({ auth: "Bearer dossier:", query: { dossierToken: "tok" } }));
  assert.strictEqual(a.kind, "customer");
  assert.strictEqual(analystChecked, false);
});

test("an empty 'Bearer dossier:' with no query token is malformed, never an analyst", async () => {
  let analystChecked = false;
  access.__setDeps({
    ...deps(),
    verifyEnvBearer: () => { analystChecked = true; return true; },
  });
  const a = await access.resolveDossierActor(req({ auth: "Bearer dossier:", query: { tenant: "acme" } }));
  assert.strictEqual(a.kind, "none");
  assert.strictEqual(a.reason, "malformed");
  assert.strictEqual(analystChecked, false);
});

test("an unknown actor kind is denied rather than treated as a customer", () => {
  const weird = { kind: "robot", tenantId: "acme", dossierId: "d-1", reason: null };
  assert.strictEqual(access.canReadDossier(weird, ROW).ok, false);
  assert.strictEqual(access.canReadDossier(weird, ROW).status, 401);
});

test("empty identity values never match each other", () => {
  const blankRow = { id: "d-1", tenant_id: undefined, owned_by: "analyst" };
  assert.strictEqual(access.canReadDossier({ kind: "analyst", tenantId: undefined, dossierId: null, reason: null }, blankRow).ok, false);
  assert.strictEqual(access.canReadDossier({ kind: "customer", tenantId: undefined, dossierId: undefined, reason: null }, { id: undefined, tenant_id: undefined, owned_by: "analyst" }).ok, false);
});

test("a numeric row id still matches a string token dossier id", () => {
  assert.deepStrictEqual(
    access.canReadDossier({ kind: "customer", tenantId: "acme", dossierId: "42", reason: null }, { id: 42, tenant_id: "acme", owned_by: "analyst" }),
    { ok: true }
  );
});

test("an analyst session for one company cannot open another's pre-boarding", async () => {
  // The shared password could be replayed against any tenant (PREB-3 is still
  // open for the password itself). The session cannot: it names its company.
  access.__setDeps(deps({ analystTenant: "someone-else" }));
  const a = await access.resolveDossierActor(req({ auth: `Bearer ${ANALYST_SESSION}`, query: { tenant: "acme" } }));
  assert.strictEqual(a.kind, "none");
  assert.strictEqual(a.reason, "tenant_mismatch");
});
