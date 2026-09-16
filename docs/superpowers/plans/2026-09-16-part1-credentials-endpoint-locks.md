# Part 1 — Credentials and Endpoint Locks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every dossier endpoint answers only to a verified caller — an analyst holding the server-checked pre-boarding password for a tenant with pre-boarding enabled, or a customer holding a signed, expiring, revocable link token for exactly that dossier — and an analyst can no longer change a dossier once the customer has.

**Architecture:** `lib/dossierToken.js` mints and verifies an HMAC-signed link token and holds a per-dossier revocation cutoff in `lib/storage.js`. `lib/dossierAccess.js` turns any request into an *actor* (`analyst` / `customer` / `none`) and answers "may this actor read / write this dossier row?". Every dossier endpoint (`get-dossier`, `save-dossier`, `search-attempt`, `invite`, the new `revoke-dossier-token`, and the dossier-keyed paths of `change-events` / `amendment-documents`) calls those two modules instead of hand-rolling checks. A migration adds `entity_dossiers.owned_by`, which flips to `customer` on the customer's first write. On the client, `src/utils/dossierCredential.js` holds whichever credential the browser has and every dossier call attaches it.

**Tech Stack:** Create React App (React 18, inline styles, no router), CommonJS Vercel functions in `api/`, shared CommonJS `lib/`, Neon Postgres via `@neondatabase/serverless`, `lib/storage.js` (KV / Redis / filesystem), `node:crypto`, `node --test`, CRA Jest + Testing Library.

## Global Constraints

- **CommonJS in `api/` and `lib/`**; `src/` is ESM, except `src/pipeline.js` and `src/reresearch/*.js`, which are CommonJS and must keep that shape.
- **Every handler is mountable by `src/setupProxy.js`** by requiring the real handler — never a copied body. POST routes parse the JSON body themselves before delegating; GET routes use `adapt(...)`.
- **Backend tests** are `*.nodetest.js` under `lib/__tests__/` or `api/__tests__/` (run by `npm run test:node`), with fakes injected through `__setDeps` seams. **Frontend tests** are CRA Jest + Testing Library asserting real rendered DOM.
- **Tenant resolution stays 3-strict** (`lib/tenant.js#getTenantIdFromRequest`: `?tenant=`, then `x-tenant-id`, else `""`). No literal tenant id in any runtime policy check.
- **Constant-time comparison** for every secret or signature comparison.
- **No new runtime dependency.**
- **Secrets stay server-side**; new env vars documented in `.env.example` with placeholder values only.
- **Migrations are additive and idempotent** (`IF NOT EXISTS`), numbered from `026`, applied with `node db/apply.js db/migrations/<file>.sql`.
- **`src/App.js` is ~5,500 lines:** surgical edits only; hook call order is load-bearing; gap/stakeholder values stay in refs.
- **Never commit `CLAUDE.md` or `context.md`** — both carry unrelated uncommitted edits. Stage explicit paths; never `git add -A` / `git commit -a`.

## Decisions locked for this plan (from the approved spec, plus three refinements found while planning)

1. **Customer link:** `/?tenant=<id>&dossierToken=<token>&journey=customer`. Old `?dossierId=` links stop working (no grace period).
2. **Token lifetime:** 30 days.
3. **Analyst credential:** the pre-boarding password sent as `Authorization: Bearer <password>`, valid only for a tenant that is active and has pre-boarding enabled.
4. **Customer credential:** `Authorization: Bearer dossier:<token>`, or `?dossierToken=<token>` on the landing GET.
5. **Ownership lock:** `entity_dossiers.owned_by` flips to `customer` on the customer's first write (a dossier save or a change record). After that the analyst may still READ, never WRITE.
6. **Refinement — revocation is per dossier, not per token.** Revoking records "tokens for this dossier issued at or before now are dead". It kills every outstanding copy of the link (including forwarded ones) and needs no per-token id list. A fresh invite afterwards mints a working token.
7. **Refinement — keep `save-dossier`'s `INSERT INTO tenants` upsert.** The spec proposed removing it, but Part 5 guarantees a tenant exists in the KV *registry*, not in the Postgres `tenants` table the dossier row references. The actual hole was that the tenant came from the request body. The fix keeps the upsert and feeds it only the server-verified tenant.
8. **Refinement — this migration is `026` and covers ownership only.** Part 3's snapshot/search-count/submission-link columns will use `027`.

---

## File Structure

**New files**

| File | Responsibility |
|---|---|
| `lib/dossierToken.js` | Mint / verify the signed link token; per-dossier revocation cutoff. |
| `lib/__tests__/dossierToken.nodetest.js` | Tests for the above. |
| `lib/dossierAccess.js` | Request → actor; read/write permission for a dossier row; deny status mapping. |
| `lib/__tests__/dossierAccess.nodetest.js` | Tests for the above. |
| `db/migrations/026_dossier_ownership.sql` | `owned_by`, `last_customer_action_at` on `entity_dossiers`. |
| `api/revoke-dossier-token.js` | Analyst-only: revoke every outstanding link for a dossier. |
| `api/__tests__/revoke-dossier-token.nodetest.js` | Tests for the above. |
| `api/__tests__/search-attempt.nodetest.js` | Tests for the locked counter. |
| `api/__tests__/change-events.nodetest.js` | Tests for the dossier-keyed lock. |
| `api/__tests__/amendment-documents.nodetest.js` | Tests for the dossier-keyed lock. |
| `src/utils/dossierCredential.js` | Client holder for the analyst or customer credential; builds request headers. |
| `src/utils/__tests__/dossierCredential.test.js` | Tests for the above. |
| `src/components/preboarding/LinkUnavailable.jsx` | Screen for an expired / revoked / invalid customer link. |

**Modified files**

| File | Change |
|---|---|
| `api/get-dossier.js` | Actor required; customer reads only its token's dossier; returns `owned_by`. |
| `api/save-dossier.js` | Actor required; create is analyst-only; analyst cannot update a customer-owned row; customer write flips ownership; tenant from the credential. |
| `api/search-attempt.js` | Actor required; tenant-scoped; analyst cannot increment on a customer-owned row. |
| `api/invite.js` | Analyst-only; dossier must exist in the analyst's tenant; emails a token link; stops trusting a client-built link; stops persisting the link. |
| `api/change-events.js` | For a dossier-keyed event: actor required, analyst locked out of customer-owned rows, customer write flips ownership. Fresh (non-dossier) applications unchanged. |
| `api/amendment-documents.js` | For a dossier-keyed read: actor required. Fresh applications unchanged. |
| `src/setupProxy.js` | Mount `change-events`, `amendment-documents`, `revoke-dossier-token`. |
| `src/App.js` | Store the analyst credential on unlock; customer landing via `dossierToken`; credential headers on every dossier call; link-unavailable screen; review-only banner. |
| `src/components/preboarding/InviteScreen.jsx` | Send the analyst credential; render the link the server returns. |
| `src/components/preboarding/DossierView.jsx` | Disable save / invite actions when the dossier is customer-owned. |
| `src/components/changeDialogue/ChangeDialogue.jsx`, `src/components/amendmentDocuments/AmendmentDocuments.jsx` | Attach credential headers. |
| `src/reresearch/failureFlag.js` | Accept optional request headers. |
| `.env.example`, `docs/BACKLOG.md` | New secret; deploy gate; backlog notes. |

---

## Task 1: Signed dossier link token

**Files:**
- Create: `lib/dossierToken.js`, `lib/__tests__/dossierToken.nodetest.js`
- Modify: `.env.example`

**Interfaces:**
- Produces:
  - `mint({ dossierId, tenantId, ttlMs? }): string` — throws `Error("DOSSIER_TOKEN_SECRET not configured")` when the secret is absent; throws when `dossierId` or `tenantId` is missing.
  - `verify(token): Promise<{ valid: boolean, reason: null | "no_secret" | "malformed" | "bad_signature" | "expired" | "revoked" | "revocation_unavailable", payload? }>` — `payload = { dossierId, tenantId, iat, exp }`, both times in epoch milliseconds.
  - `revokeAllForDossier(dossierId): Promise<{ revokedBefore: number }>`
  - `DEFAULT_TTL_MS = 2592000000` (30 days)
  - `__setDeps({ storage, now })`

- [ ] **Step 1: Write the failing test**

Create `lib/__tests__/dossierToken.nodetest.js`:

```js
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test lib/__tests__/dossierToken.nodetest.js`
Expected: FAIL — `Cannot find module '../dossierToken'`.

- [ ] **Step 3: Implement `lib/dossierToken.js`**

```js
// Signed, expiring, revocable customer link token for a dossier.
//
// Format: base64url(JSON payload) + "." + base64url(HMAC-SHA256(payloadPart)).
// Payload: { dossierId, tenantId, iat, exp } — times in epoch milliseconds.
// Secret: DOSSIER_TOKEN_SECRET. Absent secret → mint throws, verify fails closed.
//
// Revocation is PER DOSSIER, not per token: revoking records "every token for
// this dossier issued at or before now is dead". That kills every outstanding
// copy of the link (including one the customer forwarded) without keeping a
// list of token ids, and a fresh invite afterwards still works.
//
// CommonJS so api/ handlers and src/setupProxy.js can require it.

const crypto = require("node:crypto");
const storage = require("./storage");

const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// Injected deps (overridable in tests via __setDeps) — mirrors api/submit.js.
let _deps = { storage, now: () => Date.now() };

function secret() {
  return process.env.DOSSIER_TOKEN_SECRET || "";
}

function sign(body, key) {
  return crypto.createHmac("sha256", key).update(body).digest("base64url");
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function revokeKey(dossierId) {
  return `dossier-token-revoked:${dossierId}`;
}

function mint({ dossierId, tenantId, ttlMs = DEFAULT_TTL_MS } = {}) {
  const key = secret();
  if (!key) throw new Error("DOSSIER_TOKEN_SECRET not configured");
  if (!dossierId || !tenantId) throw new Error("dossierId and tenantId are required");
  const iat = _deps.now();
  const payload = { dossierId: String(dossierId), tenantId: String(tenantId), iat, exp: iat + ttlMs };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body, key)}`;
}

async function verify(token) {
  const key = secret();
  if (!key) return { valid: false, reason: "no_secret" };
  if (typeof token !== "string") return { valid: false, reason: "malformed" };

  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { valid: false, reason: "malformed" };

  // Signature first: never parse or trust a payload we did not sign.
  if (!safeEqual(parts[1], sign(parts[0], key))) return { valid: false, reason: "bad_signature" };

  let payload;
  try {
    payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
  } catch (_) {
    return { valid: false, reason: "malformed" };
  }
  if (!payload || !payload.dossierId || !payload.tenantId
      || !Number.isFinite(payload.iat) || !Number.isFinite(payload.exp)) {
    return { valid: false, reason: "malformed" };
  }

  if (payload.exp <= _deps.now()) return { valid: false, reason: "expired", payload };

  let cutoff;
  try {
    cutoff = await _deps.storage.get(revokeKey(payload.dossierId));
  } catch (_) {
    // Fail closed: if we cannot tell whether this link was revoked, refuse it.
    return { valid: false, reason: "revocation_unavailable", payload };
  }
  if (cutoff && Number.isFinite(cutoff.revokedBefore) && payload.iat <= cutoff.revokedBefore) {
    return { valid: false, reason: "revoked", payload };
  }

  return { valid: true, reason: null, payload };
}

async function revokeAllForDossier(dossierId) {
  if (!dossierId) throw new Error("dossierId is required");
  const revokedBefore = _deps.now();
  // TTL matches a token's own lifetime: once it lapses, every token it covered
  // has expired on its own, so the record can safely disappear.
  await _deps.storage.set(revokeKey(dossierId), { revokedBefore }, { ttlSeconds: Math.ceil(DEFAULT_TTL_MS / 1000) });
  return { revokedBefore };
}

module.exports = { mint, verify, revokeAllForDossier, DEFAULT_TTL_MS };

// Test seam only.
module.exports.__setDeps = (d) => { _deps = { ..._deps, ...d }; };
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test lib/__tests__/dossierToken.nodetest.js`
Expected: PASS (11 tests).

- [ ] **Step 5: Document the secret**

Append to `.env.example`:

```
# Signs customer dossier link tokens (/?tenant=<id>&dossierToken=<token>).
# Required for invites and for customers opening their link. Use a long random
# value (e.g. `openssl rand -base64 48`). Rotating it invalidates every link.
DOSSIER_TOKEN_SECRET=change-me-to-a-long-random-value
```

- [ ] **Step 6: Commit**

```bash
git add lib/dossierToken.js lib/__tests__/dossierToken.nodetest.js .env.example
git commit -m "feat(security): signed, expiring, per-dossier-revocable customer link token"
```

---

## Task 2: Dossier access — actor resolution and permissions

**Files:**
- Create: `lib/dossierAccess.js`, `lib/__tests__/dossierAccess.nodetest.js`

**Interfaces:**
- Consumes: `lib/dossierToken.js#verify` (Task 1); `lib/auth.js#verifyEnvBearer`; `lib/tenantRegistry.js#isTenantActive`, `#isPreboardingEnabled`; `lib/tenant.js#getTenantIdFromRequest`.
- Produces:
  - `resolveDossierActor(req): Promise<Actor>` where `Actor = { kind: "analyst" | "customer" | "none", tenantId: string | null, dossierId: string | null, reason: string | null }`.
  - `canReadDossier(actor, row): { ok: true } | { ok: false, status: number, error: string }` — `row = { id, tenant_id, owned_by }` or `null`.
  - `canWriteDossier(actor, row)` — same shape; additionally refuses an analyst on a customer-owned row with `403 dossier_locked`.
  - `denyFor(actor): { status, error }` — `expired → 410 link_expired`, `revoked → 410 link_revoked`, everything else `401 unauthorized`.
  - `__setDeps({ verifyEnvBearer, dossierToken, registry })`

- [ ] **Step 1: Write the failing test**

Create `lib/__tests__/dossierAccess.nodetest.js`:

```js
const { test } = require("node:test");
const assert = require("node:assert");
const access = require("../dossierAccess");

function req({ auth, query = {}, headers = {} } = {}) {
  return { query, headers: { ...headers, ...(auth ? { authorization: auth } : {}) }, url: "/api/x" };
}

function deps({ tokenResult, analystOk = true, active = true, preboarding = true } = {}) {
  return {
    verifyEnvBearer: (tok) => analystOk && tok === "analyst-pw",
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

test("the analyst password resolves to an analyst for an active tenant with pre-boarding on", async () => {
  access.__setDeps(deps());
  const a = await access.resolveDossierActor(req({ auth: "Bearer analyst-pw", query: { tenant: "acme" } }));
  assert.deepStrictEqual(a, { kind: "analyst", tenantId: "acme", dossierId: null, reason: null });
});

test("the analyst password is refused for a tenant without pre-boarding, an inactive tenant, or no tenant", async () => {
  access.__setDeps(deps({ preboarding: false }));
  assert.strictEqual((await access.resolveDossierActor(req({ auth: "Bearer analyst-pw", query: { tenant: "acme" } }))).kind, "none");

  access.__setDeps(deps({ active: false }));
  assert.strictEqual((await access.resolveDossierActor(req({ auth: "Bearer analyst-pw", query: { tenant: "acme" } }))).kind, "none");

  access.__setDeps(deps());
  const noTenant = await access.resolveDossierActor(req({ auth: "Bearer analyst-pw" }));
  assert.strictEqual(noTenant.kind, "none");
  assert.strictEqual(noTenant.reason, "tenant_required");
});

test("a wrong analyst password is refused", async () => {
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test lib/__tests__/dossierAccess.nodetest.js`
Expected: FAIL — `Cannot find module '../dossierAccess'`.

- [ ] **Step 3: Implement `lib/dossierAccess.js`**

```js
// Who is calling a dossier endpoint, and what may they do?
//
// Two credentials exist:
//   analyst  — `Authorization: Bearer <PREBOARDING_PASSWORD>`, valid only for
//              the tenant the request names, and only while that tenant is
//              active with pre-boarding enabled.
//   customer — a signed link token (lib/dossierToken.js), sent as
//              `Authorization: Bearer dossier:<token>` or `?dossierToken=`.
//              It names exactly one dossier and one tenant.
//
// Every dossier endpoint resolves an actor here and asks canReadDossier /
// canWriteDossier, so the rules live in one place instead of being re-derived
// per handler.
//
// CommonJS so api/ handlers and src/setupProxy.js can require it.

const { verifyEnvBearer } = require("./auth");
const dossierToken = require("./dossierToken");
const tenantRegistry = require("./tenantRegistry");
const { getTenantIdFromRequest } = require("./tenant");

// Injected deps (overridable in tests via __setDeps) — mirrors api/submit.js.
let _deps = { verifyEnvBearer, dossierToken, registry: tenantRegistry };

const CUSTOMER_PREFIX = "dossier:";

function none(reason) {
  return { kind: "none", tenantId: null, dossierId: null, reason };
}

function readBearer(req) {
  const headers = (req && req.headers) || {};
  const raw = headers.authorization || headers.Authorization || "";
  return typeof raw === "string" && raw.startsWith("Bearer ") ? raw.slice("Bearer ".length) : "";
}

async function resolveDossierActor(req) {
  const bearer = readBearer(req);
  const queryToken = req && req.query && typeof req.query.dossierToken === "string" ? req.query.dossierToken : "";
  const requestTenant = getTenantIdFromRequest(req);

  const customerToken = bearer.startsWith(CUSTOMER_PREFIX) ? bearer.slice(CUSTOMER_PREFIX.length) : queryToken;
  if (customerToken) {
    const v = await _deps.dossierToken.verify(customerToken);
    if (!v.valid) return none(v.reason);
    // The token is the authority on tenant; a request naming a different one
    // is either a mistake or an attempt to cross tenants.
    if (requestTenant && requestTenant !== v.payload.tenantId) return none("tenant_mismatch");
    return { kind: "customer", tenantId: v.payload.tenantId, dossierId: v.payload.dossierId, reason: null };
  }

  if (bearer) {
    if (!_deps.verifyEnvBearer(bearer, "PREBOARDING_PASSWORD")) return none("invalid_credential");
    if (!requestTenant) return none("tenant_required");
    if (!(await _deps.registry.isTenantActive(requestTenant))) return none("tenant_inactive");
    if (!(await _deps.registry.isPreboardingEnabled(requestTenant))) return none("preboarding_disabled");
    return { kind: "analyst", tenantId: requestTenant, dossierId: null, reason: null };
  }

  return none("unauthorized");
}

function denyFor(actor) {
  if (actor && actor.reason === "expired") return { status: 410, error: "link_expired" };
  if (actor && actor.reason === "revoked") return { status: 410, error: "link_revoked" };
  return { status: 401, error: "unauthorized" };
}

const OK = { ok: true };

function canReadDossier(actor, row) {
  if (!actor || actor.kind === "none") {
    const d = denyFor(actor);
    return { ok: false, status: d.status, error: d.error };
  }
  if (!row) return { ok: false, status: 404, error: "dossier_not_found" };

  if (actor.kind === "analyst") {
    // Another tenant's dossier is reported as not found, so an analyst cannot
    // probe which ids exist elsewhere.
    return actor.tenantId === row.tenant_id ? OK : { ok: false, status: 404, error: "dossier_not_found" };
  }

  // customer
  return actor.dossierId === String(row.id) && actor.tenantId === row.tenant_id
    ? OK
    : { ok: false, status: 403, error: "forbidden" };
}

function canWriteDossier(actor, row) {
  const read = canReadDossier(actor, row);
  if (!read.ok) return read;
  if (actor.kind === "analyst" && row.owned_by === "customer") {
    return { ok: false, status: 403, error: "dossier_locked" };
  }
  return OK;
}

module.exports = { resolveDossierActor, canReadDossier, canWriteDossier, denyFor };

// Test seam only.
module.exports.__setDeps = (d) => { _deps = { ..._deps, ...d }; };
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test lib/__tests__/dossierAccess.nodetest.js`
Expected: PASS (14 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/dossierAccess.js lib/__tests__/dossierAccess.nodetest.js
git commit -m "feat(security): one place that resolves dossier callers and decides read/write"
```

---

## Task 3: Ownership migration

**Files:**
- Create: `db/migrations/026_dossier_ownership.sql`

**Interfaces:**
- Produces: `entity_dossiers.owned_by TEXT NOT NULL DEFAULT 'analyst'`, `entity_dossiers.last_customer_action_at TIMESTAMPTZ`.

- [ ] **Step 1: Write the migration**

Create `db/migrations/026_dossier_ownership.sql`:

```sql
-- 026_dossier_ownership.sql
-- Who controls a dossier. 'analyst' until the customer first changes anything
-- (a dossier save or a change record), then 'customer' — after which the
-- analyst may still read the dossier but can no longer write to it.
-- Additive and idempotent: existing rows default to 'analyst'.
ALTER TABLE entity_dossiers
  ADD COLUMN IF NOT EXISTS owned_by TEXT NOT NULL DEFAULT 'analyst';

-- When the customer last wrote to this dossier (audit + support visibility).
ALTER TABLE entity_dossiers
  ADD COLUMN IF NOT EXISTS last_customer_action_at TIMESTAMPTZ;
```

- [ ] **Step 2: Apply to the development database**

Run: `node db/apply.js db/migrations/026_dossier_ownership.sql`
Expected: each statement reports success; re-running reports success again (idempotent).

- [ ] **Step 3: Verify the columns exist**

Run:

```bash
node -e "require('dotenv').config({path:'.env.local'});const{neon}=require('@neondatabase/serverless');neon(process.env.DATABASE_URL)\`SELECT column_name, data_type, column_default FROM information_schema.columns WHERE table_name='entity_dossiers' AND column_name IN ('owned_by','last_customer_action_at') ORDER BY 1\`.then(r=>console.log(JSON.stringify(r,null,2)))"
```

Expected: two rows — `last_customer_action_at` (`timestamp with time zone`) and `owned_by` (`text`, default `'analyst'::text`).

- [ ] **Step 4: Commit**

```bash
git add db/migrations/026_dossier_ownership.sql
git commit -m "feat(db): 026 dossier ownership columns"
```

---

## Task 4: Lock `get-dossier`

**Files:**
- Modify: `api/get-dossier.js`
- Modify: `api/__tests__/get-dossier.nodetest.js`

**Interfaces:**
- Consumes: `lib/dossierAccess.js` (Task 2); `owned_by` column (Task 3).
- Produces:
  - Customer: `GET /api/get-dossier?dossierToken=<t>` (or `Bearer dossier:<t>`) → `200 { success: true, dossier }` for the token's dossier. No `id` param needed.
  - Analyst: `GET /api/get-dossier?tenant=<id>&id=<dossierId>` with `Bearer <password>` → same.
  - `dossier` now includes `id` and `owned_by`.
  - Refusals: `401 unauthorized`, `410 link_expired | link_revoked`, `400 dossierId_required` (analyst without `id`), `404 dossier_not_found`, `403 forbidden`.
  - `module.exports.__setDeps({ neon, access })`.

- [ ] **Step 1: Replace the test file**

Replace the contents of `api/__tests__/get-dossier.nodetest.js`:

```js
const { test, before, after } = require("node:test");
const assert = require("node:assert");
const handler = require("../get-dossier");

let prevUrl;
before(() => { prevUrl = process.env.DATABASE_URL; process.env.DATABASE_URL = "postgres://test"; });
after(() => { if (prevUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = prevUrl; });

function fakeRes() {
  return {
    statusCode: null, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

function fakeSql(row) {
  const calls = [];
  const sql = (strings, ...values) => { calls.push({ text: strings.join("?"), values }); return Promise.resolve(row ? [row] : []); };
  sql.calls = calls;
  return sql;
}

function accessWith(actor) {
  const real = require("../../lib/dossierAccess");
  return { ...real, resolveDossierActor: async () => actor };
}

const ROW = { id: "d-1", tenant_id: "acme", owned_by: "analyst", company_name: "Acme Ltd" };
const ANALYST = { kind: "analyst", tenantId: "acme", dossierId: null, reason: null };
const CUSTOMER = { kind: "customer", tenantId: "acme", dossierId: "d-1", reason: null };
const req = (query = {}) => ({ method: "GET", query, headers: {}, url: "/api/get-dossier" });

test("no credential is a 401 before any database work", async () => {
  const sql = fakeSql(ROW);
  handler.__setDeps({ neon: () => sql, access: accessWith({ kind: "none", tenantId: null, dossierId: null, reason: "unauthorized" }) });
  const res = fakeRes();
  await handler(req({ id: "d-1", tenant: "acme" }), res);
  assert.strictEqual(res.statusCode, 401);
  assert.deepStrictEqual(res.body, { error: "unauthorized" });
  assert.strictEqual(sql.calls.length, 0);
});

test("an expired customer link is a 410", async () => {
  handler.__setDeps({ neon: () => fakeSql(ROW), access: accessWith({ kind: "none", tenantId: null, dossierId: null, reason: "expired" }) });
  const res = fakeRes();
  await handler(req({ dossierToken: "t" }), res);
  assert.strictEqual(res.statusCode, 410);
  assert.deepStrictEqual(res.body, { error: "link_expired" });
});

test("a customer reads its own dossier without supplying an id", async () => {
  const sql = fakeSql(ROW);
  handler.__setDeps({ neon: () => sql, access: accessWith(CUSTOMER) });
  const res = fakeRes();
  await handler(req({ dossierToken: "t" }), res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.success, true);
  assert.strictEqual(res.body.dossier.id, "d-1");
  assert.strictEqual(res.body.dossier.owned_by, "analyst");
  // The query is scoped by the TOKEN's dossier and tenant, not by any request param.
  assert.ok(sql.calls[0].values.includes("d-1"));
  assert.ok(sql.calls[0].values.includes("acme"));
});

test("a customer supplying some other id still only reads the token's dossier", async () => {
  const sql = fakeSql(ROW);
  handler.__setDeps({ neon: () => sql, access: accessWith(CUSTOMER) });
  const res = fakeRes();
  await handler(req({ dossierToken: "t", id: "d-999" }), res);
  assert.strictEqual(res.statusCode, 200);
  assert.ok(!sql.calls[0].values.includes("d-999"));
});

test("an analyst must name the dossier", async () => {
  handler.__setDeps({ neon: () => fakeSql(ROW), access: accessWith(ANALYST) });
  const res = fakeRes();
  await handler(req({ tenant: "acme" }), res);
  assert.strictEqual(res.statusCode, 400);
  assert.deepStrictEqual(res.body, { error: "dossierId_required" });
});

test("an analyst reads a dossier in its tenant, including a customer-owned one", async () => {
  handler.__setDeps({ neon: () => fakeSql({ ...ROW, owned_by: "customer" }), access: accessWith(ANALYST) });
  const res = fakeRes();
  await handler(req({ tenant: "acme", id: "d-1" }), res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.dossier.owned_by, "customer");
});

test("a dossier that does not exist in the actor's tenant is a 404", async () => {
  handler.__setDeps({ neon: () => fakeSql(null), access: accessWith(ANALYST) });
  const res = fakeRes();
  await handler(req({ tenant: "acme", id: "d-1" }), res);
  assert.strictEqual(res.statusCode, 404);
  assert.deepStrictEqual(res.body, { success: false, error: "dossier_not_found" });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test api/__tests__/get-dossier.nodetest.js`
Expected: FAIL — `handler.__setDeps is not a function`.

- [ ] **Step 3: Implement**

Replace the body of `api/get-dossier.js` from the first `require` to the end with:

```js
const { neon } = require("@neondatabase/serverless");
const dossierAccess = require("../lib/dossierAccess");

// Injected deps (overridable in tests via __setDeps) — mirrors api/submit.js.
let _deps = { neon, access: dossierAccess };

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Credential first: nothing about any dossier is revealed to an anonymous caller.
  const actor = await _deps.access.resolveDossierActor(req);
  if (actor.kind === "none") {
    const deny = _deps.access.denyFor(actor);
    return res.status(deny.status).json({ error: deny.error });
  }

  // A customer's token names exactly one dossier; a request-supplied id is ignored.
  const id = actor.kind === "customer" ? actor.dossierId : req.query && req.query.id;
  if (!id) {
    return res.status(400).json({ error: "dossierId_required" });
  }

  if (!process.env.DATABASE_URL) {
    return res.status(200).json({ success: false, error: "Database not configured" });
  }

  try {
    const sql = _deps.neon(process.env.DATABASE_URL);

    // Scoped by the VERIFIED tenant, never a request parameter.
    const rows = await sql`
      SELECT
        id,
        tenant_id,
        owned_by,
        company_name,
        country_code,
        country_name,
        entity_type,
        ownership_type,
        verified_data,
        probable_data,
        indicative_data,
        stakeholders,
        required_documents,
        included_fields,
        excluded_fields,
        custom_questions,
        raw_research,
        total_fields,
        verified_fields,
        probable_fields,
        indicative_fields,
        missing_fields,
        fill_rate,
        verified_fill_rate,
        status,
        saved_at AS generated_at
      FROM entity_dossiers
      WHERE id = ${id}
      AND tenant_id = ${actor.tenantId}
      AND status != 'deleted'
      LIMIT 1
    `;

    const row = rows.length ? rows[0] : null;
    const permitted = _deps.access.canReadDossier(actor, row);
    if (!permitted.ok) {
      return res.status(permitted.status).json(
        permitted.status === 404 ? { success: false, error: permitted.error } : { error: permitted.error }
      );
    }

    return res.status(200).json({ success: true, dossier: row });
  } catch (err) {
    console.error("[get-dossier] Error:", err);
    return res.status(200).json({ success: false, error: err.message });
  }
};

// Test seam only.
module.exports.__setDeps = (d) => { _deps = { ..._deps, ...d }; };
```

Update the file's header comment so it describes the two credentials and the removal of the bare-id link, replacing the sentence about `?dossierId=<id>&journey=customer`.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test api/__tests__/get-dossier.nodetest.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add api/get-dossier.js api/__tests__/get-dossier.nodetest.js
git commit -m "feat(security): get-dossier requires an analyst or customer credential"
```

---

## Task 5: Lock `save-dossier` and add the ownership flip

**Files:**
- Modify: `api/save-dossier.js`
- Modify: `api/__tests__/save-dossier.nodetest.js`

**Interfaces:**
- Consumes: `lib/dossierAccess.js`; `owned_by`, `last_customer_action_at`.
- Produces:
  - Tenant comes ONLY from the credential; `body.tenantId` is ignored.
  - Create (no `dossierId`): analyst only; customer → `403 forbidden`.
  - Update (`dossierId`): row looked up first; `canWriteDossier` decides; analyst on a customer-owned row → `403 dossier_locked`; customer on another dossier → `403 forbidden`.
  - Analyst update with a stale id (no row in tenant) → INSERT fallback as today. Customer with no matching row → `404 dossier_not_found`.
  - A customer update sets `owned_by = 'customer'` and `last_customer_action_at = NOW()`.
  - The `INSERT INTO tenants` upsert stays, fed only the verified tenant.
  - `module.exports.__setDeps({ neon, access })`.

- [ ] **Step 1: Replace the test file**

Replace the contents of `api/__tests__/save-dossier.nodetest.js`:

```js
const { test, before, after } = require("node:test");
const assert = require("node:assert");
const handler = require("../save-dossier");

let prevUrl;
before(() => { prevUrl = process.env.DATABASE_URL; process.env.DATABASE_URL = "postgres://test"; });
after(() => { if (prevUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = prevUrl; });

function fakeRes() {
  return {
    statusCode: null, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

// Records statement kinds and the values bound to them.
function fakeSql({ lookupRow = null, updateRows = [{ id: "d-1" }], insertId = "d-new" } = {}) {
  const log = [];
  const sql = (strings, ...values) => {
    const text = strings.join(" ");
    if (/INSERT INTO tenants/i.test(text)) { log.push({ kind: "tenants_upsert", values }); return Promise.resolve([]); }
    if (/SELECT[\s\S]*FROM entity_dossiers/i.test(text)) { log.push({ kind: "lookup", values }); return Promise.resolve(lookupRow ? [lookupRow] : []); }
    if (/UPDATE entity_dossiers/i.test(text)) { log.push({ kind: "update", text, values }); return Promise.resolve(updateRows); }
    if (/INSERT INTO entity_dossiers/i.test(text)) { log.push({ kind: "insert", values }); return Promise.resolve([{ id: insertId }]); }
    log.push({ kind: "unknown", values });
    return Promise.resolve([]);
  };
  sql.log = log;
  sql.kinds = () => log.map((l) => l.kind);
  return sql;
}

function accessWith(actor) {
  const real = require("../../lib/dossierAccess");
  return { ...real, resolveDossierActor: async () => actor };
}

const ANALYST = { kind: "analyst", tenantId: "acme", dossierId: null, reason: null };
const CUSTOMER = { kind: "customer", tenantId: "acme", dossierId: "d-1", reason: null };
const base = { company: { name: "Acme Ltd", code: "GB", countryName: "United Kingdom" }, entityType: "company" };
const req = (body) => ({ method: "POST", body, headers: {}, query: {} });

test("no credential is a 401 and nothing is written", async () => {
  const sql = fakeSql();
  handler.__setDeps({ neon: () => sql, access: accessWith({ kind: "none", tenantId: null, dossierId: null, reason: "unauthorized" }) });
  const res = fakeRes();
  await handler(req({ ...base }), res);
  assert.strictEqual(res.statusCode, 401);
  assert.deepStrictEqual(sql.kinds(), []);
});

test("an analyst creates a dossier under the VERIFIED tenant, ignoring body.tenantId", async () => {
  const sql = fakeSql({ insertId: "d-fresh" });
  handler.__setDeps({ neon: () => sql, access: accessWith(ANALYST) });
  const res = fakeRes();
  await handler(req({ ...base, tenantId: "evil-tenant" }), res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.dossierId, "d-fresh");
  assert.deepStrictEqual(sql.kinds(), ["tenants_upsert", "insert"]);
  assert.ok(sql.log[0].values.includes("acme"));
  assert.ok(!sql.log[0].values.includes("evil-tenant"));
  assert.ok(sql.log[1].values.includes("acme"));
});

test("a customer can never create a dossier", async () => {
  const sql = fakeSql();
  handler.__setDeps({ neon: () => sql, access: accessWith(CUSTOMER) });
  const res = fakeRes();
  await handler(req({ ...base }), res);
  assert.strictEqual(res.statusCode, 403);
  assert.deepStrictEqual(res.body, { error: "forbidden" });
  assert.ok(!sql.kinds().includes("insert"));
});

test("an analyst updates its own analyst-owned dossier in place", async () => {
  const sql = fakeSql({ lookupRow: { id: "d-1", tenant_id: "acme", owned_by: "analyst" } });
  handler.__setDeps({ neon: () => sql, access: accessWith(ANALYST) });
  const res = fakeRes();
  await handler(req({ ...base, dossierId: "d-1" }), res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.dossierId, "d-1");
  assert.deepStrictEqual(sql.kinds(), ["lookup", "tenants_upsert", "update"]);
});

test("an analyst cannot update a customer-owned dossier", async () => {
  const sql = fakeSql({ lookupRow: { id: "d-1", tenant_id: "acme", owned_by: "customer" } });
  handler.__setDeps({ neon: () => sql, access: accessWith(ANALYST) });
  const res = fakeRes();
  await handler(req({ ...base, dossierId: "d-1" }), res);
  assert.strictEqual(res.statusCode, 403);
  assert.deepStrictEqual(res.body, { error: "dossier_locked" });
  assert.ok(!sql.kinds().includes("update"));
  assert.ok(!sql.kinds().includes("insert"));
});

test("an analyst's stale id still falls back to INSERT rather than dropping the save", async () => {
  const sql = fakeSql({ lookupRow: null, insertId: "d-2" });
  handler.__setDeps({ neon: () => sql, access: accessWith(ANALYST) });
  const res = fakeRes();
  await handler(req({ ...base, dossierId: "does-not-exist" }), res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.dossierId, "d-2");
  assert.deepStrictEqual(sql.kinds(), ["lookup", "tenants_upsert", "insert"]);
});

test("a customer update flips ownership to the customer", async () => {
  const sql = fakeSql({ lookupRow: { id: "d-1", tenant_id: "acme", owned_by: "analyst" } });
  handler.__setDeps({ neon: () => sql, access: accessWith(CUSTOMER) });
  const res = fakeRes();
  await handler(req({ ...base, dossierId: "d-1" }), res);
  assert.strictEqual(res.statusCode, 200);
  const update = sql.log.find((l) => l.kind === "update");
  assert.match(update.text, /owned_by/);
  assert.match(update.text, /last_customer_action_at/);
  assert.ok(update.values.includes("customer"));
});

test("a customer cannot update a different dossier than its token names", async () => {
  const sql = fakeSql({ lookupRow: { id: "d-2", tenant_id: "acme", owned_by: "analyst" } });
  handler.__setDeps({ neon: () => sql, access: accessWith(CUSTOMER) });
  const res = fakeRes();
  await handler(req({ ...base, dossierId: "d-2" }), res);
  assert.strictEqual(res.statusCode, 403);
  assert.ok(!sql.kinds().includes("update"));
});

test("a customer whose dossier no longer exists gets 404, not a fresh insert", async () => {
  const sql = fakeSql({ lookupRow: null });
  handler.__setDeps({ neon: () => sql, access: accessWith(CUSTOMER) });
  const res = fakeRes();
  await handler(req({ ...base, dossierId: "d-1" }), res);
  assert.strictEqual(res.statusCode, 404);
  assert.ok(!sql.kinds().includes("insert"));
});

test("400 when company.name is missing", async () => {
  handler.__setDeps({ neon: () => fakeSql(), access: accessWith(ANALYST) });
  const res = fakeRes();
  await handler(req({}), res);
  assert.strictEqual(res.statusCode, 400);
});

test("no DATABASE_URL → 200 with warning, database never touched", async () => {
  const prev = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    let neonCalled = false;
    handler.__setDeps({ neon: () => { neonCalled = true; return fakeSql(); }, access: accessWith(ANALYST) });
    const res = fakeRes();
    await handler(req({ ...base }), res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.success, false);
    assert.strictEqual(neonCalled, false);
  } finally {
    if (prev === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = prev;
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test api/__tests__/save-dossier.nodetest.js`
Expected: FAIL — the handler ignores the actor, so the 401 / 403 / tenant-from-credential cases fail.

- [ ] **Step 3: Implement**

In `api/save-dossier.js`:

Add after the `neon` require and change the deps:

```js
const dossierAccess = require("../lib/dossierAccess");

// Injected deps (overridable in tests via __setDeps) — mirrors api/submit.js.
let _deps = { neon, access: dossierAccess };
```

Immediately after the `405` guard, resolve the actor:

```js
  // Credential first. The tenant comes from the credential ONLY — a request
  // body can no longer name (or create) a tenant.
  const actor = await _deps.access.resolveDossierActor(req);
  if (actor.kind === "none") {
    const deny = _deps.access.denyFor(actor);
    return res.status(deny.status).json({ error: deny.error });
  }
  const tenantId = actor.tenantId;
```

Remove `tenantId,` from the `req.body` destructuring list, and change the `400` guard to:

```js
  if (!company?.name) {
    return res.status(400).json({ error: "company.name required" });
  }

  // Customers only ever refresh their own dossier; creating one is analyst work.
  if (actor.kind === "customer" && !dossierId) {
    return res.status(403).json({ error: "forbidden" });
  }
```

Inside the `try`, BEFORE the tenants upsert, add the lookup and permission check:

```js
    const sql = _deps.neon(process.env.DATABASE_URL);

    let existing = null;
    if (dossierId) {
      const found = await sql`
        SELECT id, tenant_id, owned_by
        FROM entity_dossiers
        WHERE id = ${dossierId} AND tenant_id = ${tenantId} AND status != 'deleted'
        LIMIT 1
      `;
      existing = found.length ? found[0] : null;

      if (existing) {
        const permitted = _deps.access.canWriteDossier(actor, existing);
        if (!permitted.ok) return res.status(permitted.status).json({ error: permitted.error });
      } else if (actor.kind === "customer") {
        // The customer's dossier is gone; never let a customer mint a new one.
        return res.status(404).json({ error: "dossier_not_found" });
      }
    }

    const isCustomer = actor.kind === "customer";
```

Delete the old `const sql = _deps.neon(process.env.DATABASE_URL);` line that followed. Keep the `INSERT INTO tenants` upsert as-is; add this comment above it:

```js
    // Ensure the Postgres tenants row exists (slug is NOT NULL). The tenant id
    // here is the VERIFIED one from the credential — the historical hole was
    // that it came from the request body, letting any caller create tenants.
```

Change `if (dossierId) {` (the UPDATE block) to `if (existing) {`, and add these two assignments to the UPDATE's `SET` list, directly before `status = 'ready',`:

```js
          owned_by = CASE WHEN ${isCustomer} THEN 'customer' ELSE owned_by END,
          last_customer_action_at = CASE WHEN ${isCustomer} THEN NOW() ELSE last_customer_action_at END,
```

Change the INSERT fallback condition from `if (!dossierId || rows.length === 0) {` to:

```js
    if (!existing || rows.length === 0) {
```

Rewrite the top-of-file comment to state: callers must hold an analyst or customer credential; the tenant comes from the credential; customers only update their own dossier and their write transfers ownership; analysts cannot write a customer-owned dossier.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test api/__tests__/save-dossier.nodetest.js`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add api/save-dossier.js api/__tests__/save-dossier.nodetest.js
git commit -m "feat(security): save-dossier takes its tenant from the credential and honours ownership"
```

---

## Task 6: Lock and tenant-scope `search-attempt`

**Files:**
- Modify: `api/search-attempt.js`
- Create: `api/__tests__/search-attempt.nodetest.js`

**Interfaces:**
- Consumes: `lib/dossierAccess.js`.
- Produces:
  - `GET` → read permission; `POST` (increment) → write permission.
  - Customer: dossier id comes from the token. Analyst: from `dossierId` (query for GET, body for POST).
  - Every statement is scoped `WHERE id = … AND tenant_id = <verified tenant>`.
  - Refusals: `401`, `410`, `400 dossierId_required`, `404 dossier_not_found`, `403 forbidden | dossier_locked`.
  - `module.exports.__setDeps({ neon, access })`.

- [ ] **Step 1: Write the failing test**

Create `api/__tests__/search-attempt.nodetest.js`:

```js
const { test, before, after } = require("node:test");
const assert = require("node:assert");
const handler = require("../search-attempt");

let prevUrl;
before(() => { prevUrl = process.env.DATABASE_URL; process.env.DATABASE_URL = "postgres://test"; });
after(() => { if (prevUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = prevUrl; });

function fakeRes() {
  return { statusCode: null, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}

function fakeSql(row) {
  const log = [];
  const sql = (strings, ...values) => {
    const text = strings.join(" ");
    log.push({ text, values });
    if (/UPDATE entity_dossiers/i.test(text)) return Promise.resolve(row ? [{ search_attempts: (row.search_attempts || 0) + 1 }] : []);
    return Promise.resolve(row ? [row] : []);
  };
  sql.log = log;
  return sql;
}

function accessWith(actor) {
  const real = require("../../lib/dossierAccess");
  return { ...real, resolveDossierActor: async () => actor };
}

const ROW = { id: "d-1", tenant_id: "acme", owned_by: "analyst", search_attempts: 1 };
const ANALYST = { kind: "analyst", tenantId: "acme", dossierId: null, reason: null };
const CUSTOMER = { kind: "customer", tenantId: "acme", dossierId: "d-1", reason: null };

test("no credential is a 401 and the counter is untouched", async () => {
  const sql = fakeSql(ROW);
  handler.__setDeps({ neon: () => sql, access: accessWith({ kind: "none", tenantId: null, dossierId: null, reason: "unauthorized" }) });
  const res = fakeRes();
  await handler({ method: "POST", body: { dossierId: "d-1" }, query: {}, headers: {} }, res);
  assert.strictEqual(res.statusCode, 401);
  assert.strictEqual(sql.log.length, 0);
});

test("every statement is scoped by the verified tenant", async () => {
  const sql = fakeSql(ROW);
  handler.__setDeps({ neon: () => sql, access: accessWith(CUSTOMER) });
  const res = fakeRes();
  await handler({ method: "POST", body: {}, query: {}, headers: {} }, res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.attempts, 2);
  for (const stmt of sql.log) {
    assert.match(stmt.text, /tenant_id/, "every statement must filter on tenant_id");
    assert.ok(stmt.values.includes("acme"));
  }
});

test("a customer reads its own counter from the token, ignoring a supplied id", async () => {
  const sql = fakeSql(ROW);
  handler.__setDeps({ neon: () => sql, access: accessWith(CUSTOMER) });
  const res = fakeRes();
  await handler({ method: "GET", query: { dossierId: "d-999" }, headers: {} }, res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.attempts, 1);
  assert.ok(!sql.log[0].values.includes("d-999"));
});

test("an analyst must name the dossier", async () => {
  handler.__setDeps({ neon: () => fakeSql(ROW), access: accessWith(ANALYST) });
  const res = fakeRes();
  await handler({ method: "GET", query: {}, headers: {} }, res);
  assert.strictEqual(res.statusCode, 400);
  assert.deepStrictEqual(res.body, { error: "dossierId_required" });
});

test("an analyst cannot increment a customer-owned dossier's counter", async () => {
  const sql = fakeSql({ ...ROW, owned_by: "customer" });
  handler.__setDeps({ neon: () => sql, access: accessWith(ANALYST) });
  const res = fakeRes();
  await handler({ method: "POST", body: { dossierId: "d-1" }, query: {}, headers: {} }, res);
  assert.strictEqual(res.statusCode, 403);
  assert.deepStrictEqual(res.body, { error: "dossier_locked" });
  assert.ok(!sql.log.some((s) => /UPDATE/i.test(s.text)));
});

test("a dossier in another tenant is a 404", async () => {
  handler.__setDeps({ neon: () => fakeSql(null), access: accessWith(ANALYST) });
  const res = fakeRes();
  await handler({ method: "GET", query: { dossierId: "d-1" }, headers: {} }, res);
  assert.strictEqual(res.statusCode, 404);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test api/__tests__/search-attempt.nodetest.js`
Expected: FAIL — `handler.__setDeps is not a function`.

- [ ] **Step 3: Implement**

Replace everything in `api/search-attempt.js` from the `neon` require to the end with:

```js
const { neon } = require("@neondatabase/serverless");
const dossierAccess = require("../lib/dossierAccess");

// Injected deps (overridable in tests via __setDeps) — mirrors api/submit.js.
let _deps = { neon, access: dossierAccess };

module.exports = async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const actor = await _deps.access.resolveDossierActor(req);
  if (actor.kind === "none") {
    const deny = _deps.access.denyFor(actor);
    return res.status(deny.status).json({ error: deny.error });
  }

  const requested = req.method === "GET" ? req.query && req.query.dossierId : (req.body || {}).dossierId;
  const dossierId = actor.kind === "customer" ? actor.dossierId : requested;
  if (!dossierId) {
    return res.status(400).json({ error: "dossierId_required" });
  }

  if (!process.env.DATABASE_URL) {
    console.warn("[search-attempt] No DATABASE_URL");
    return res.status(200).json({ attempts: null, warning: "Database not configured" });
  }

  try {
    const sql = _deps.neon(process.env.DATABASE_URL);

    // Tenant-scoped: an id from another tenant is simply not found.
    const found = await sql`
      SELECT id, tenant_id, owned_by, search_attempts
      FROM entity_dossiers
      WHERE id = ${dossierId} AND tenant_id = ${actor.tenantId} AND status != 'deleted'
      LIMIT 1
    `;
    const row = found.length ? found[0] : null;

    const permitted = req.method === "POST"
      ? _deps.access.canWriteDossier(actor, row)
      : _deps.access.canReadDossier(actor, row);
    if (!permitted.ok) return res.status(permitted.status).json({ error: permitted.error });

    if (req.method === "GET") {
      return res.status(200).json({ attempts: row.search_attempts });
    }

    // Atomic increment — the database is the single source of truth, so two
    // concurrent re-search clicks can't both read the same pre-increment value.
    const rows = await sql`
      UPDATE entity_dossiers
      SET search_attempts = search_attempts + 1
      WHERE id = ${dossierId} AND tenant_id = ${actor.tenantId}
      RETURNING search_attempts
    `;
    const attempts = rows.length ? rows[0].search_attempts : null;
    console.log(`[search-attempt] dossier ${dossierId} → attempt ${attempts}`);
    return res.status(200).json({ attempts });
  } catch (err) {
    console.error("[search-attempt] ❌", err.message);
    return res.status(200).json({ attempts: null, warning: err.message });
  }
};

// Test seam only.
module.exports.__setDeps = (d) => { _deps = { ..._deps, ...d }; };
```

Update the header comment to say the counter is credential-gated and tenant-scoped.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test api/__tests__/search-attempt.nodetest.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add api/search-attempt.js api/__tests__/search-attempt.nodetest.js
git commit -m "feat(security): search-attempt is credential-gated and tenant-scoped"
```

---

## Task 7: Analyst-only invite with a token link, and link revocation

**Files:**
- Modify: `api/invite.js`, `api/__tests__/invite.nodetest.js`
- Create: `api/revoke-dossier-token.js`, `api/__tests__/revoke-dossier-token.nodetest.js`
- Modify: `src/setupProxy.js`

**Interfaces:**
- Consumes: `lib/dossierAccess.js`, `lib/dossierToken.js#mint`, `#revokeAllForDossier`.
- Produces:
  - `POST /api/invite` — analyst only (`401` / `403 forbidden` otherwise); `dossierId` must exist in the analyst's tenant (`404`); `500 not_configured` when `DOSSIER_TOKEN_SECRET` is unset; response `link` is `${origin}/?tenant=<t>&dossierToken=<token>&journey=customer`; the body's `tenantId` and `link` are ignored; the persisted invite record contains no link and no token.
  - `POST /api/revoke-dossier-token` body `{ dossierId }` — analyst only; `404` if the dossier is not in the analyst's tenant; `200 { success: true, revokedBefore }`.
  - Both expose `__setDeps({ neon, access, dossierToken, ... })`.

- [ ] **Step 1: Replace the invite tests**

Replace the contents of `api/__tests__/invite.nodetest.js`:

```js
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

function setup(t, { actor = ANALYST, row = ROW, secret = SECRET, sendEmail, readConfigForTenant } = {}) {
  const handler = require("../invite");
  const prevKey = process.env.RESEND_API_KEY;
  const prevSecret = process.env.DOSSIER_TOKEN_SECRET;
  delete process.env.RESEND_API_KEY;
  if (secret === null) delete process.env.DOSSIER_TOKEN_SECRET; else process.env.DOSSIER_TOKEN_SECRET = secret;
  t.after(() => {
    if (prevKey === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = prevKey;
    if (prevSecret === undefined) delete process.env.DOSSIER_TOKEN_SECRET; else process.env.DOSSIER_TOKEN_SECRET = prevSecret;
  });
  const store = fakeStore();
  handler.__setDeps({
    store,
    neon: () => fakeSql(row),
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test api/__tests__/invite.nodetest.js`
Expected: FAIL — the handler has no actor check and still emails a `dossierId=` link.

- [ ] **Step 3: Implement the invite changes**

In `api/invite.js`:

Replace the requires and deps block with:

```js
const crypto = require("crypto");
const { neon } = require("@neondatabase/serverless");
const store = require("../lib/storage.js");
const dossierAccess = require("../lib/dossierAccess");
const dossierToken = require("../lib/dossierToken");
const { readConfigForTenant } = require("./config");

const INVITE_RECORD_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
```

and

```js
// Injected deps (overridable in tests via __setDeps) — mirrors api/submit.js.
let _deps = { store, sendEmail, readConfigForTenant, neon, access: dossierAccess, dossierToken };
```

Delete the `isValidDossierLink` function entirely (the client no longer builds links).

Replace the handler body from `const { email, contactName, companyName, origin, dossierId, tenantId, link: clientLink } =` through the `inviteRecord` persistence block with:

```js
  const actor = await _deps.access.resolveDossierActor(req);
  if (actor.kind === "none") {
    const deny = _deps.access.denyFor(actor);
    return res.status(deny.status).json({ error: deny.error });
  }
  if (actor.kind !== "analyst") {
    return res.status(403).json({ error: "forbidden" });
  }
  const tenantId = actor.tenantId;

  const { email, contactName, companyName, origin, dossierId } = req.body || {};
  if (!email || !contactName) {
    return res.status(400).json({ error: "Missing email or contactName" });
  }
  if (!dossierId) {
    return res.status(400).json({ error: "Missing dossierId — save the dossier before inviting" });
  }

  if (!process.env.DOSSIER_TOKEN_SECRET) {
    console.error("[invite] DOSSIER_TOKEN_SECRET is not configured");
    return res.status(500).json({ error: "not_configured" });
  }

  // The dossier must exist in the ANALYST's tenant before we issue a link to it.
  if (process.env.DATABASE_URL) {
    const sql = _deps.neon(process.env.DATABASE_URL);
    const found = await sql`
      SELECT id FROM entity_dossiers
      WHERE id = ${dossierId} AND tenant_id = ${tenantId} AND status != 'deleted'
      LIMIT 1
    `;
    if (!found.length) return res.status(404).json({ error: "dossier_not_found" });
  }

  const token = _deps.dossierToken.mint({ dossierId, tenantId });
  const baseOrigin = resolveOrigin(req, origin);
  // The server builds the only link. A client-supplied link is never used.
  const link = `${baseOrigin}/?tenant=${encodeURIComponent(tenantId)}&dossierToken=${encodeURIComponent(token)}&journey=customer`;

  // Persist WHO was invited to WHAT — never the link or the token, which are
  // bearer credentials and have no business sitting in a KV record.
  const inviteId = crypto.randomBytes(18).toString("base64url");
  const inviteRecord = {
    inviteId,
    email,
    contactName,
    companyName: companyName || null,
    dossierId,
    tenantId,
    createdAt: new Date().toISOString(),
    status: "invited",
  };
  try {
    await _deps.store.set(`invite:${inviteId}`, inviteRecord, { ttlSeconds: INVITE_RECORD_TTL_SECONDS });
  } catch (e) {
    console.warn("invite persist failed:", e && e.message);
  }
```

In every JSON response below that point, replace `token,` with `inviteId,`.

Update the CORS allow-headers line to `res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Tenant-Id");`, and rewrite the header comment's "THE LINK" paragraph to describe the analyst-only credential and the server-built token link.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test api/__tests__/invite.nodetest.js`
Expected: PASS (10 tests).

- [ ] **Step 5: Write the revoke test**

Create `api/__tests__/revoke-dossier-token.nodetest.js`:

```js
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
```

- [ ] **Step 6: Implement `api/revoke-dossier-token.js`**

```js
// Revoke every outstanding customer link for a dossier.
//
// POST { dossierId } — analyst only. Tokens for this dossier issued at or before
// the call stop working immediately (lib/dossierToken.js); a fresh invite
// afterwards issues a working one. There is no UI for this yet (backlog PREB-2).
//
// CommonJS (module.exports) so src/setupProxy.js can require() it for local dev.

const { neon } = require("@neondatabase/serverless");
const dossierAccess = require("../lib/dossierAccess");
const dossierToken = require("../lib/dossierToken");

// Injected deps (overridable in tests via __setDeps) — mirrors api/submit.js.
let _deps = { neon, access: dossierAccess, dossierToken };

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Tenant-Id");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const actor = await _deps.access.resolveDossierActor(req);
  if (actor.kind === "none") {
    const deny = _deps.access.denyFor(actor);
    return res.status(deny.status).json({ error: deny.error });
  }
  if (actor.kind !== "analyst") return res.status(403).json({ error: "forbidden" });

  const dossierId = (req.body || {}).dossierId;
  if (!dossierId) return res.status(400).json({ error: "dossierId_required" });

  try {
    if (process.env.DATABASE_URL) {
      const sql = _deps.neon(process.env.DATABASE_URL);
      const found = await sql`
        SELECT id FROM entity_dossiers
        WHERE id = ${dossierId} AND tenant_id = ${actor.tenantId}
        LIMIT 1
      `;
      if (!found.length) return res.status(404).json({ error: "dossier_not_found" });
    }
    const { revokedBefore } = await _deps.dossierToken.revokeAllForDossier(dossierId);
    return res.status(200).json({ success: true, revokedBefore });
  } catch (err) {
    console.error("[revoke-dossier-token]", err);
    return res.status(500).json({ error: "revoke_failed" });
  }
};

// Test seam only.
module.exports.__setDeps = (d) => { _deps = { ..._deps, ...d }; };
```

- [ ] **Step 7: Mount it for local dev**

In `src/setupProxy.js`, add beside the other handler requires:

```js
const revokeDossierTokenHandler = require(path.join(__dirname, "..", "api", "revoke-dossier-token.js"));
```

and beside the `/api/invite` registration:

```js
  // Revoke every outstanding customer link for a dossier (analyst only).
  app.post("/api/revoke-dossier-token", (req, res) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      try { req.body = raw ? JSON.parse(raw) : {}; } catch (_) { req.body = {}; }
      adapt(revokeDossierTokenHandler)(req, res);
    });
  });
```

- [ ] **Step 8: Run both suites**

Run: `node --test api/__tests__/invite.nodetest.js api/__tests__/revoke-dossier-token.nodetest.js`
Expected: PASS (14 tests).

- [ ] **Step 9: Commit**

```bash
git add api/invite.js api/__tests__/invite.nodetest.js api/revoke-dossier-token.js api/__tests__/revoke-dossier-token.nodetest.js src/setupProxy.js
git commit -m "feat(security): analyst-only invites carry a signed token link; per-dossier link revocation"
```

---

## Task 8: Lock dossier-keyed change records and amendment documents

**Files:**
- Modify: `api/change-events.js`, `api/amendment-documents.js`
- Create: `api/__tests__/change-events.nodetest.js`, `api/__tests__/amendment-documents.nodetest.js`
- Modify: `src/setupProxy.js`

**Interfaces:**
- Consumes: `lib/dossierAccess.js`.
- Produces:
  - A request whose `submissionId` matches an `entity_dossiers.id` is **dossier-keyed** and requires an actor: `POST /api/change-events` → write permission; `GET /api/amendment-documents` → read permission.
  - A dossier-keyed change record written by a **customer** sets `owned_by = 'customer'` and `last_customer_action_at = NOW()` on that dossier.
  - A request whose `submissionId` matches no dossier (a fresh application) behaves exactly as today — backlog PLAT-7.
  - Refusals use the standard `401 / 410 / 403 / 404` shapes.
  - `change-events.__setDeps({ neon, writeEvent, access })`; `amendment-documents.__setDeps({ neon, getEventsBySubmission, deriveAmendmentDocuments, access })`.

- [ ] **Step 1: Write the failing change-events test**

Create `api/__tests__/change-events.nodetest.js`:

```js
const { test, before, after } = require("node:test");
const assert = require("node:assert");
const handler = require("../change-events");

let prevUrl;
before(() => { prevUrl = process.env.DATABASE_URL; process.env.DATABASE_URL = "postgres://test"; });
after(() => { if (prevUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = prevUrl; });

function fakeRes() {
  return { statusCode: null, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}

function fakeSql(dossierRow) {
  const log = [];
  const sql = (strings, ...values) => {
    const text = strings.join(" ");
    log.push({ text, values });
    if (/SELECT[\s\S]*FROM entity_dossiers/i.test(text)) return Promise.resolve(dossierRow ? [dossierRow] : []);
    return Promise.resolve([]);
  };
  sql.log = log;
  return sql;
}

function accessWith(actor) {
  const real = require("../../lib/dossierAccess");
  return { ...real, resolveDossierActor: async () => actor };
}

const ROW = { id: "d-1", tenant_id: "acme", owned_by: "analyst" };
const event = { submissionId: "d-1", fieldId: "company_name" };
const ANALYST = { kind: "analyst", tenantId: "acme", dossierId: null, reason: null };
const CUSTOMER = { kind: "customer", tenantId: "acme", dossierId: "d-1", reason: null };

function deps(sql, actor, onWrite) {
  return {
    neon: () => sql,
    writeEvent: async (_sql, ev) => { if (onWrite) onWrite(ev); return { id: "e-1", field_id: ev.fieldId, workflow: "x" }; },
    access: accessWith(actor),
  };
}

test("a fresh application (no matching dossier) writes exactly as before, with no credential", async () => {
  let wrote = false;
  const sql = fakeSql(null);
  handler.__setDeps(deps(sql, { kind: "none", tenantId: null, dossierId: null, reason: "unauthorized" }, () => { wrote = true; }));
  const res = fakeRes();
  await handler({ method: "POST", body: { ...event, submissionId: "fresh-app" }, headers: {}, query: {} }, res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.success, true);
  assert.strictEqual(wrote, true);
});

test("a dossier-keyed record with no credential is refused and not written", async () => {
  let wrote = false;
  handler.__setDeps(deps(fakeSql(ROW), { kind: "none", tenantId: null, dossierId: null, reason: "unauthorized" }, () => { wrote = true; }));
  const res = fakeRes();
  await handler({ method: "POST", body: { ...event }, headers: {}, query: {} }, res);
  assert.strictEqual(res.statusCode, 401);
  assert.strictEqual(wrote, false);
});

test("an analyst cannot add records to a customer-owned dossier", async () => {
  let wrote = false;
  handler.__setDeps(deps(fakeSql({ ...ROW, owned_by: "customer" }), ANALYST, () => { wrote = true; }));
  const res = fakeRes();
  await handler({ method: "POST", body: { ...event }, headers: {}, query: {} }, res);
  assert.strictEqual(res.statusCode, 403);
  assert.deepStrictEqual(res.body, { error: "dossier_locked" });
  assert.strictEqual(wrote, false);
});

test("a customer's record is written and transfers ownership of the dossier", async () => {
  let wrote = false;
  const sql = fakeSql(ROW);
  handler.__setDeps(deps(sql, CUSTOMER, () => { wrote = true; }));
  const res = fakeRes();
  await handler({ method: "POST", body: { ...event }, headers: {}, query: {} }, res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(wrote, true);
  const flip = sql.log.find((s) => /UPDATE entity_dossiers/i.test(s.text));
  assert.ok(flip, "expected an ownership update");
  assert.match(flip.text, /owned_by/);
  assert.ok(flip.values.includes("d-1"));
});

test("a customer cannot add records to another dossier", async () => {
  let wrote = false;
  handler.__setDeps(deps(fakeSql({ ...ROW, id: "d-2" }), CUSTOMER, () => { wrote = true; }));
  const res = fakeRes();
  await handler({ method: "POST", body: { ...event, submissionId: "d-2" }, headers: {}, query: {} }, res);
  assert.strictEqual(res.statusCode, 403);
  assert.strictEqual(wrote, false);
});
```

- [ ] **Step 2: Write the failing amendment-documents test**

Create `api/__tests__/amendment-documents.nodetest.js`:

```js
const { test, before, after } = require("node:test");
const assert = require("node:assert");
const handler = require("../amendment-documents");

let prevUrl;
before(() => { prevUrl = process.env.DATABASE_URL; process.env.DATABASE_URL = "postgres://test"; });
after(() => { if (prevUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = prevUrl; });

function fakeRes() {
  return { statusCode: null, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}

function accessWith(actor) {
  const real = require("../../lib/dossierAccess");
  return { ...real, resolveDossierActor: async () => actor };
}

function deps(dossierRow, actor) {
  return {
    neon: () => () => Promise.resolve(dossierRow ? [dossierRow] : []),
    getEventsBySubmission: async () => [{ id: "e" }],
    deriveAmendmentDocuments: () => [{ docType: "Certificate" }],
    access: accessWith(actor),
  };
}

const ROW = { id: "d-1", tenant_id: "acme", owned_by: "customer" };
const req = (submissionId) => ({ method: "GET", query: { submissionId }, headers: {} });

test("a fresh application's documents are readable as before", async () => {
  handler.__setDeps(deps(null, { kind: "none", tenantId: null, dossierId: null, reason: "unauthorized" }));
  const res = fakeRes();
  await handler(req("fresh-app"), res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.documents.length, 1);
});

test("a dossier's documents need a credential", async () => {
  handler.__setDeps(deps(ROW, { kind: "none", tenantId: null, dossierId: null, reason: "unauthorized" }));
  const res = fakeRes();
  await handler(req("d-1"), res);
  assert.strictEqual(res.statusCode, 401);
  assert.strictEqual(res.body.documents, undefined);
});

test("an analyst may READ a customer-owned dossier's documents", async () => {
  handler.__setDeps(deps(ROW, { kind: "analyst", tenantId: "acme", dossierId: null, reason: null }));
  const res = fakeRes();
  await handler(req("d-1"), res);
  assert.strictEqual(res.statusCode, 200);
});

test("a customer reads only its own dossier's documents", async () => {
  handler.__setDeps(deps({ ...ROW, id: "d-2" }, { kind: "customer", tenantId: "acme", dossierId: "d-1", reason: null }));
  const res = fakeRes();
  await handler(req("d-2"), res);
  assert.strictEqual(res.statusCode, 403);
});
```

- [ ] **Step 3: Run to verify both fail**

Run: `node --test api/__tests__/change-events.nodetest.js api/__tests__/amendment-documents.nodetest.js`
Expected: FAIL — `handler.__setDeps is not a function`.

- [ ] **Step 4: Implement `api/change-events.js`**

Replace everything from the `neon` require to the end with:

```js
const { neon } = require("@neondatabase/serverless");
const { writeEvent } = require("../src/changeIntelligence/events/writeEvent");
const dossierAccess = require("../lib/dossierAccess");

// Injected deps (overridable in tests via __setDeps) — mirrors api/submit.js.
let _deps = { neon, writeEvent, access: dossierAccess };

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const event = req.body || {};

  if (!process.env.DATABASE_URL) {
    console.warn("[change-events] No DATABASE_URL — event not persisted");
    return res.status(200).json({ success: false, warning: "Database not configured" });
  }

  try {
    const sql = _deps.neon(process.env.DATABASE_URL);

    // Is this record about a DOSSIER? `id::text` so a non-UUID submission id
    // (a fresh application) is simply "no match" rather than a cast error.
    let dossier = null;
    if (event.submissionId) {
      const found = await sql`
        SELECT id, tenant_id, owned_by
        FROM entity_dossiers
        WHERE id::text = ${String(event.submissionId)} AND status != 'deleted'
        LIMIT 1
      `;
      dossier = found.length ? found[0] : null;
    }

    let actor = null;
    if (dossier) {
      actor = await _deps.access.resolveDossierActor(req);
      const permitted = _deps.access.canWriteDossier(actor, dossier);
      if (!permitted.ok) return res.status(permitted.status).json({ error: permitted.error });
    }
    // A fresh application (no dossier) is unchanged — backlog PLAT-7.

    const row = await _deps.writeEvent(sql, event);

    if (dossier && actor && actor.kind === "customer") {
      // The customer changed something: from now on the analyst may only read.
      await sql`
        UPDATE entity_dossiers
        SET owned_by = 'customer', last_customer_action_at = NOW()
        WHERE id = ${dossier.id} AND tenant_id = ${dossier.tenant_id}
      `;
    }

    console.log(`[change-events] ✅ event ${row.id} (${row.field_id} / ${row.workflow})`);
    return res.status(200).json({ success: true, id: row.id });
  } catch (err) {
    // writeEvent throws on enum drift, missing required context, or a bad
    // supersede target. Surface it without failing the user's flow.
    console.error("[change-events] ❌", err.message);
    return res.status(200).json({ success: false, warning: err.message });
  }
};

// Test seam only.
module.exports.__setDeps = (d) => { _deps = { ..._deps, ...d }; };
```

Update the header comment: remove the "NOT proxied under local npm start" note and state that dossier-keyed records require a credential and a customer record transfers ownership.

- [ ] **Step 5: Implement `api/amendment-documents.js`**

Replace everything from the `neon` require to the end with:

```js
const { neon } = require("@neondatabase/serverless");
const { getEventsBySubmission } = require("../src/changeIntelligence/events/readEvents");
const { deriveAmendmentDocuments } = require("../src/changeIntelligence/amendmentDocuments");
const dossierAccess = require("../lib/dossierAccess");

// Injected deps (overridable in tests via __setDeps) — mirrors api/submit.js.
let _deps = { neon, getEventsBySubmission, deriveAmendmentDocuments, access: dossierAccess };

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const submissionId = req.query && req.query.submissionId;
  if (!submissionId) {
    return res.status(400).json({ error: "submissionId is required" });
  }

  if (!process.env.DATABASE_URL) {
    console.warn("[amendment-documents] No DATABASE_URL — returning empty list");
    return res.status(200).json({ documents: [] });
  }

  try {
    const sql = _deps.neon(process.env.DATABASE_URL);

    const found = await sql`
      SELECT id, tenant_id, owned_by
      FROM entity_dossiers
      WHERE id::text = ${String(submissionId)} AND status != 'deleted'
      LIMIT 1
    `;
    const dossier = found.length ? found[0] : null;
    if (dossier) {
      const actor = await _deps.access.resolveDossierActor(req);
      const permitted = _deps.access.canReadDossier(actor, dossier);
      if (!permitted.ok) return res.status(permitted.status).json({ error: permitted.error });
    }
    // A fresh application (no dossier) is unchanged — backlog PLAT-7.

    const events = await _deps.getEventsBySubmission(sql, submissionId);
    const documents = _deps.deriveAmendmentDocuments(events);
    return res.status(200).json({ documents });
  } catch (err) {
    // A read failure must not break the Fill Gaps page — return an empty list
    // and log. The customer still sees the standard Required Documents step.
    console.error("[amendment-documents] ❌", err.message);
    return res.status(200).json({ documents: [], warning: err.message });
  }
};

// Test seam only.
module.exports.__setDeps = (d) => { _deps = { ..._deps, ...d }; };
```

Update the header comment the same way as change-events.

- [ ] **Step 6: Mount both for local dev**

In `src/setupProxy.js`, add beside the other requires:

```js
const changeEventsPostHandler = require(path.join(__dirname, "..", "api", "change-events.js"));
const amendmentDocumentsGetHandler = require(path.join(__dirname, "..", "api", "amendment-documents.js"));
```

If `changeEventsHandler` / `amendmentDocumentsHandler` are already required under those names, reuse them instead of adding duplicates. Register (only if no route for these paths exists yet):

```js
  // Change Intelligence write path — dossier-keyed records are credential-gated.
  app.post("/api/change-events", (req, res) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      try { req.body = raw ? JSON.parse(raw) : {}; } catch (_) { req.body = {}; }
      adapt(changeEventsPostHandler)(req, res);
    });
  });
  app.get("/api/amendment-documents", adapt(amendmentDocumentsGetHandler));
```

- [ ] **Step 7: Run to verify both pass**

Run: `node --test api/__tests__/change-events.nodetest.js api/__tests__/amendment-documents.nodetest.js`
Expected: PASS (9 tests).

- [ ] **Step 8: Run the backend suite**

Run: `npm run test:node`
Expected: PASS, no failures.

- [ ] **Step 9: Commit**

```bash
git add api/change-events.js api/amendment-documents.js api/__tests__/change-events.nodetest.js api/__tests__/amendment-documents.nodetest.js src/setupProxy.js
git commit -m "feat(security): dossier-keyed change records and amendment documents require a credential"
```

---

## Task 9: Client credential holder and the analyst side

**Files:**
- Create: `src/utils/dossierCredential.js`, `src/utils/__tests__/dossierCredential.test.js`
- Modify: `src/App.js` (gate unlock handler; `saveDossier`; the `/api/search-attempt` POST)
- Modify: `src/components/preboarding/InviteScreen.jsx`
- Modify: `src/components/preboarding/__tests__/Preboarding.render.test.jsx`

**Interfaces:**
- Consumes: the endpoint contracts from Tasks 4-7.
- Produces:
  - `setAnalystCredential(token: string)`, `setCustomerDossierToken(token: string)`, `clearDossierCredentials()`.
  - `getDossierAuthHeaders(tenantId?: string): Record<string, string>` — returns `{ Authorization: "Bearer dossier:<t>", "X-Tenant-Id": <tenant> }` when a customer token is held, else `{ Authorization: "Bearer <password>", "X-Tenant-Id": <tenant> }` when an analyst credential is held, else `{ "X-Tenant-Id": <tenant> }` (or `{}` with no tenant). `tenantId` defaults to `getTenantId()`.
  - Storage keys (sessionStorage): `preboarding_token`, `dossier_token`.

- [ ] **Step 1: Write the failing test**

Create `src/utils/__tests__/dossierCredential.test.js`:

```js
import {
  setAnalystCredential,
  setCustomerDossierToken,
  clearDossierCredentials,
  getDossierAuthHeaders,
} from "../dossierCredential";

afterEach(() => {
  clearDossierCredentials();
  window.history.pushState({}, "", "/");
});

test("no credential yields only the tenant header", () => {
  expect(getDossierAuthHeaders("acme")).toEqual({ "X-Tenant-Id": "acme" });
});

test("no credential and no tenant yields no headers", () => {
  expect(getDossierAuthHeaders("")).toEqual({});
});

test("an analyst credential becomes a plain bearer", () => {
  setAnalystCredential("analyst-pw");
  expect(getDossierAuthHeaders("acme")).toEqual({ Authorization: "Bearer analyst-pw", "X-Tenant-Id": "acme" });
});

test("a customer token becomes a dossier-prefixed bearer and wins over an analyst credential", () => {
  setAnalystCredential("analyst-pw");
  setCustomerDossierToken("tok");
  expect(getDossierAuthHeaders("acme")).toEqual({ Authorization: "Bearer dossier:tok", "X-Tenant-Id": "acme" });
});

test("the tenant defaults to the URL tenant", () => {
  window.history.pushState({}, "", "/?tenant=acme");
  setAnalystCredential("analyst-pw");
  expect(getDossierAuthHeaders()).toEqual({ Authorization: "Bearer analyst-pw", "X-Tenant-Id": "acme" });
});

test("credentials survive a module-level reload via sessionStorage", () => {
  setAnalystCredential("analyst-pw");
  expect(sessionStorage.getItem("preboarding_token")).toBe("analyst-pw");
});

test("clearing removes both credentials", () => {
  setAnalystCredential("analyst-pw");
  setCustomerDossierToken("tok");
  clearDossierCredentials();
  expect(getDossierAuthHeaders("acme")).toEqual({ "X-Tenant-Id": "acme" });
  expect(sessionStorage.getItem("preboarding_token")).toBeNull();
  expect(sessionStorage.getItem("dossier_token")).toBeNull();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `CI=true npx react-scripts test --watchAll=false src/utils/__tests__/dossierCredential.test.js`
Expected: FAIL — `Cannot find module '../dossierCredential'`.

- [ ] **Step 3: Implement `src/utils/dossierCredential.js`**

```js
// The browser's credential for dossier endpoints.
//
// A browser session is EITHER an analyst (the server-checked pre-boarding
// password, returned by /api/preboarding-auth) OR a customer (the signed link
// token from their invite URL). Every dossier call attaches whichever this tab
// holds via getDossierAuthHeaders(), so call sites never hand-build headers.
//
// sessionStorage (per tab, cleared when the tab closes) mirrors how the admin
// panel holds its token. Storage can be unavailable — every access is guarded.

import { getTenantId } from "./tenant";

const ANALYST_KEY = "preboarding_token";
const CUSTOMER_KEY = "dossier_token";

const memory = { analyst: "", customer: "" };

function write(key, value) {
  try {
    if (value) sessionStorage.setItem(key, value);
    else sessionStorage.removeItem(key);
  } catch (_) { /* storage unavailable — memory still holds it for this page */ }
}

function read(key) {
  try { return sessionStorage.getItem(key) || ""; } catch (_) { return ""; }
}

export function setAnalystCredential(token) {
  memory.analyst = token || "";
  write(ANALYST_KEY, memory.analyst);
}

export function setCustomerDossierToken(token) {
  memory.customer = token || "";
  write(CUSTOMER_KEY, memory.customer);
}

export function clearDossierCredentials() {
  memory.analyst = "";
  memory.customer = "";
  write(ANALYST_KEY, "");
  write(CUSTOMER_KEY, "");
}

export function getDossierAuthHeaders(tenantId) {
  const tenant = tenantId === undefined ? getTenantId() : tenantId;
  const headers = tenant ? { "X-Tenant-Id": tenant } : {};

  // A customer token wins: a tab that opened an invite link acts as that customer.
  const customer = memory.customer || read(CUSTOMER_KEY);
  if (customer) return { Authorization: `Bearer dossier:${customer}`, ...headers };

  const analyst = memory.analyst || read(ANALYST_KEY);
  if (analyst) return { Authorization: `Bearer ${analyst}`, ...headers };

  return headers;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `CI=true npx react-scripts test --watchAll=false src/utils/__tests__/dossierCredential.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Wire the analyst side in `src/App.js`**

Add to the imports:

```js
import { setAnalystCredential, getDossierAuthHeaders } from "./utils/dossierCredential";
```

In the `PreboardingGate` `onUnlocked` handler (inside the routing block), directly after `setPreboardingToken(token);`, add:

```js
          setAnalystCredential(token);
```

In `saveDossier`, change the fetch headers:

```js
      const response = await fetch("/api/save-dossier", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getDossierAuthHeaders(preboardingTenantId || tenantId) },
        body: JSON.stringify(payload),
      });
```

Directly after `const result = await response.json();` add a locked-dossier message so a refused save is explained rather than shown as a generic failure:

```js
      if (response.status === 403 && result.error === "dossier_locked") {
        setDossierSaveError("The customer has taken over this application, so it can no longer be changed here.");
        return;
      }
```

In the `/api/search-attempt` POST inside `proceedFromJourney`, change the headers:

```js
        fetch("/api/search-attempt", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...getDossierAuthHeaders() },
          body: JSON.stringify({ dossierId }),
        })
```

- [ ] **Step 6: Render the server-issued link in `InviteScreen.jsx`**

Add the import:

```js
import { getDossierAuthHeaders } from "../../utils/dossierCredential";
```

Delete `buildDossierLink`. Replace `handleSendInvite` with:

```js
    // The SERVER builds the link: it signs a token for this dossier, so there is
    // no client-built link to drift from, and no raw dossier id ever leaves.
    async function handleSendInvite() {
      if (!inviteEmail || !inviteContactName || !dossierId) return;
      try {
        const resp = await fetch('/api/invite', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getDossierAuthHeaders(tenantId) },
          body: JSON.stringify({
            email: inviteEmail,
            contactName: inviteContactName,
            companyName: companyDisplayName,
            origin: window.location.origin,
            dossierId,
          }),
        });
        const data = await resp.json();
        if (!resp.ok || !data.link) {
          console.warn('Invite was not issued:', data && data.error);
          return;
        }
        setInviteLink(data.link);
        setInviteSent(true);
      } catch (err) {
        console.warn('Invite send failed, email may not have been dispatched:', err);
      }
    }
```

Update the file's header comment: the link is now issued by the server as a signed token link.

- [ ] **Step 7: Update the pre-boarding render tests for the server-issued link**

In `src/components/preboarding/__tests__/Preboarding.render.test.jsx`, in each POPULATED invite test, register an `/api/invite` stub alongside the existing `/api/save-dossier` stub:

```js
    fetchRoutes["/api/invite"] = () =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          sent: false,
          simulated: true,
          link: "http://localhost/?tenant=nium&dossierToken=signed.tok&journey=customer",
        }),
      });
```

Replace the POPULATED link assertions:

```js
    const text = bodyText();
    expect(text).toMatch(/Onboarding link/i);
    expect(text).toContain("dossierToken=signed.tok");
    expect(text).toContain("journey=customer");
    // No raw dossier id and no legacy link ever reach the screen.
    expect(text).not.toContain("dossierId=");
    expect(text).not.toContain("?ref=");
```

Add one test proving the analyst credential is sent:

```js
  it("POPULATED - the invite request carries the analyst credential", async () => {
    fetchRoutes["/api/save-dossier"] = () =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true, dossierId: "dossier_abc123" }) });
    let inviteHeaders = null;
    fetchRoutes["/api/invite"] = (url, opts) => {
      inviteHeaders = opts && opts.headers;
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ link: "http://localhost/?tenant=nium&dossierToken=t&journey=customer" }) });
    };
    await driveToInvite();
    await sendInvite();
    expect(inviteHeaders.Authorization).toBe("Bearer ARCH");
  });
```

(`"ARCH"` here is only the value the suite's own mocked `/api/preboarding-auth` stub returns as the token — a fixture, not a live credential.)

- [ ] **Step 8: Run the affected suites**

Run: `CI=true npx react-scripts test --watchAll=false src/utils/__tests__/dossierCredential.test.js src/components/preboarding/__tests__/Preboarding.render.test.jsx`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/utils/dossierCredential.js src/utils/__tests__/dossierCredential.test.js src/App.js src/components/preboarding/InviteScreen.jsx src/components/preboarding/__tests__/Preboarding.render.test.jsx
git commit -m "feat(security): analyst requests carry the verified credential; invites show the server-issued link"
```

---

## Task 10: The customer side — token landing, credentialed calls, locked views

**Files:**
- Create: `src/components/preboarding/LinkUnavailable.jsx`
- Modify: `src/App.js` (landing effect; `loadDossierAndStartOnboarding`; the amendment-documents effect; the five `/api/change-events` call sites; the `postReresearchFailureFlag` call; state for link errors and ownership; review-only banner)
- Modify: `src/components/preboarding/DossierView.jsx`
- Modify: `src/components/changeDialogue/ChangeDialogue.jsx`, `src/components/amendmentDocuments/AmendmentDocuments.jsx`
- Modify: `src/reresearch/failureFlag.js`, `src/reresearch/tests/failureFlag.nodetest.js`
- Create: `src/components/preboarding/__tests__/CustomerLinkLanding.test.jsx`

**Interfaces:**
- Consumes: `src/utils/dossierCredential.js` (Task 9); `GET /api/get-dossier` (Task 4).
- Produces:
  - Landing on `/?tenant=<t>&dossierToken=<tok>&journey=customer` stores the token, loads the dossier through the token, sets `dossierId` from `dossier.id`, and continues exactly as today.
  - A `410` or `401` on that load renders `LinkUnavailable` with a message matching the reason, and never advances into the wizard.
  - A legacy `?dossierId=` link renders `LinkUnavailable` ("This link is no longer valid").
  - `dossierOwnedBy` state (`"analyst" | "customer" | null`) from `dossier.owned_by`.
  - When an analyst previews a dossier whose `dossierOwnedBy === "customer"`, a "Review only" banner renders above the flow.
  - `DossierView` disables its save/update and invite actions when the dossier is customer-owned.
  - `postReresearchFailureFlag({ ...args, headers })` merges optional headers into its request.

- [ ] **Step 1: Write the failing landing test**

Create `src/components/preboarding/__tests__/CustomerLinkLanding.test.jsx`:

```jsx
import React from "react";
import { render, screen, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import KYCAgent from "../../../App";
import { clearDossierCredentials } from "../../../utils/dossierCredential";

jest.setTimeout(60000);

let fetchRoutes = {};
let calls = [];

beforeEach(() => {
  fetchRoutes = {};
  calls = [];
  global.fetch = jest.fn((url, opts) => {
    calls.push({ url: String(url), opts: opts || {} });
    const key = Object.keys(fetchRoutes).find((k) => String(url).includes(k));
    if (key) return fetchRoutes[key](url, opts);
    return Promise.reject(new Error("offline test"));
  });
});

afterEach(() => {
  jest.restoreAllMocks();
  clearDossierCredentials();
  window.history.pushState({}, "", "/");
});

async function mountAt(path) {
  window.history.pushState({}, "", path);
  await act(async () => { render(<KYCAgent />); });
  await act(async () => { await Promise.resolve(); });
}

const bodyText = () => document.body.textContent || "";

test("a valid token link loads the dossier through the token and sends it as a credential", async () => {
  fetchRoutes["/api/get-dossier"] = () => Promise.resolve({
    ok: true, status: 200,
    json: () => Promise.resolve({ success: true, dossier: { id: "d-1", company_name: "Acme Ltd", owned_by: "analyst", raw_research: { found: [] } } }),
  });
  await mountAt("/?tenant=nium&dossierToken=signed.tok&journey=customer");
  const call = calls.find((c) => c.url.includes("/api/get-dossier"));
  expect(call).toBeTruthy();
  expect(call.url).toContain("dossierToken=signed.tok");
  expect(call.url).not.toContain("id=");
  expect(bodyText()).not.toMatch(/no longer valid|expired/i);
});

test("an expired link shows the link-unavailable screen and does not start the wizard", async () => {
  fetchRoutes["/api/get-dossier"] = () => Promise.resolve({
    ok: false, status: 410, json: () => Promise.resolve({ error: "link_expired" }),
  });
  await mountAt("/?tenant=nium&dossierToken=old.tok&journey=customer");
  expect(bodyText()).toMatch(/expired/i);
  expect(bodyText()).toMatch(/new one/i);
});

test("a revoked link says so", async () => {
  fetchRoutes["/api/get-dossier"] = () => Promise.resolve({
    ok: false, status: 410, json: () => Promise.resolve({ error: "link_revoked" }),
  });
  await mountAt("/?tenant=nium&dossierToken=old.tok&journey=customer");
  expect(bodyText()).toMatch(/no longer active|revoked/i);
});

test("a legacy dossierId link is treated as no longer valid and never fetched", async () => {
  await mountAt("/?tenant=nium&dossierId=d-1&journey=customer");
  expect(bodyText()).toMatch(/no longer valid/i);
  expect(calls.find((c) => c.url.includes("/api/get-dossier"))).toBeUndefined();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `CI=true npx react-scripts test --watchAll=false src/components/preboarding/__tests__/CustomerLinkLanding.test.jsx`
Expected: FAIL — the landing effect still reads `dossierId` and never reads `dossierToken`.

- [ ] **Step 3: Create `LinkUnavailable.jsx`**

```jsx
/**
 * LinkUnavailable.jsx — shown to a customer whose onboarding link cannot be
 * used. The server decides why; this only chooses the words. It deliberately
 * reveals nothing about the dossier or the tenant's other applications.
 */

import React from "react";

const MESSAGES = {
  link_expired: {
    title: "This link has expired",
    body: "Onboarding links are valid for 30 days. Ask your onboarding contact to send you a new one.",
  },
  link_revoked: {
    title: "This link is no longer active",
    body: "It was replaced or withdrawn. Ask your onboarding contact to send you a new one.",
  },
  legacy: {
    title: "This link is no longer valid",
    body: "We've upgraded how onboarding links work. Ask your onboarding contact to send you a new one.",
  },
  invalid: {
    title: "This link isn't valid",
    body: "Check that you opened the full link from your email, or ask your onboarding contact to send you a new one.",
  },
};

export function LinkUnavailable({ reason }) {
  const copy = MESSAGES[reason] || MESSAGES.invalid;
  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      padding: "40px 20px", fontFamily: "'DM Sans','Segoe UI',system-ui,sans-serif",
      background: "linear-gradient(170deg, #f4f8f7 0%, #eaeff4 50%, #f7f4f0 100%)", color: "#1a3a4a",
    }}>
      <div style={{
        width: "100%", maxWidth: 440, background: "#fff", borderRadius: 16,
        padding: "40px 36px", border: "1px solid rgba(26,58,74,0.08)",
        boxShadow: "0 10px 40px rgba(26,58,74,0.10)", textAlign: "center",
      }}>
        <div style={{ fontSize: 40, marginBottom: 18 }}>🔗</div>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: "0 0 10px" }}>{copy.title}</h1>
        <p style={{ fontSize: 14, color: "#1a3a4a99", lineHeight: 1.6, margin: 0 }}>{copy.body}</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Rework the landing in `src/App.js`**

Add to the imports:

```js
import { setCustomerDossierToken } from "./utils/dossierCredential";
import { LinkUnavailable } from "./components/preboarding/LinkUnavailable";
```

Add state next to `dossierId` (unconditionally, beside the other dossier state):

```js
  // Why a customer's invite link could not be used, if it couldn't.
  const [linkError, setLinkError] = useState(null);
  // Who controls the loaded dossier: 'analyst' until the customer changes
  // anything, then 'customer' (the analyst becomes read-only).
  const [dossierOwnedBy, setDossierOwnedBy] = useState(null);
```

Replace the body of the customer-landing effect (the one reading `params.get("dossierId")`) with:

```js
    if (dossierHydratedRef.current) return;
    if (!tenantId) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("journey") !== "customer") return;
    const token = params.get("dossierToken");
    const legacyId = params.get("dossierId");
    if (!token) {
      // Old bare-id links were unauthenticated bearer URLs and no longer work.
      if (legacyId) {
        dossierHydratedRef.current = true;
        setLinkError("legacy");
      }
      return;
    }
    dossierHydratedRef.current = true;
    setCustomerDossierToken(token);
    loadDossierAndStartOnboarding({ tenant: tenantId, dossierToken: token });
```

Change `loadDossierAndStartOnboarding`'s signature and its fetch. Replace:

```js
  async function loadDossierAndStartOnboarding(id, tenant) {
```

with:

```js
  // Two callers: a customer landing via their token link ({ tenant, dossierToken }),
  // and the analyst's "Preview" ({ tenant, dossierId }) which authenticates with
  // the analyst credential already held for this tab.
  async function loadDossierAndStartOnboarding({ tenant, dossierId: requestedId, dossierToken } = {}) {
```

Replace the fetch line and the `const data = await res.json();` line with:

```js
      const query = dossierToken
        ? `dossierToken=${encodeURIComponent(dossierToken)}&tenant=${encodeURIComponent(tenant)}`
        : `id=${encodeURIComponent(requestedId)}&tenant=${encodeURIComponent(tenant)}`;
      const res = await fetch(`/api/get-dossier?${query}`, { headers: getDossierAuthHeaders(tenant) });
      const data = await res.json();
      if (res.status === 410 || res.status === 401) {
        // The link is unusable. Never drop the customer into an empty wizard.
        setLinkError(data && (data.error === "link_expired" || data.error === "link_revoked") ? data.error : "invalid");
        return;
      }
```

Replace `setDossierId(id);` and the `trackEvent("invite_link_opened", { dossierId: id, …` line with:

```js
        setDossierId(d.id);
        setDossierOwnedBy(d.owned_by || null);
        trackEvent("invite_link_opened", { dossierId: d.id, companyName: d.company_name || null, via: "dossier_link" });
```

In the render section, immediately after the existing `if (!tenantId) { return <NoTenantLanding … /> }` early return, add:

```js
  if (linkError) {
    return <LinkUnavailable reason={linkError} />;
  }
```

In `DossierView.jsx`, change the Preview call from `await loadDossierAndStartOnboarding(dossierId, tenantId);` to:

```js
                await loadDossierAndStartOnboarding({ tenant: tenantId, dossierId });
```

- [ ] **Step 5: Credential headers on every dossier-keyed call**

In `src/App.js`:

- The amendment-documents effect: change the fetch to `fetch(\`/api/amendment-documents?submissionId=${encodeURIComponent(submissionId)}\`, { headers: getDossierAuthHeaders() })`.
- Each of the five `fetch("/api/change-events", { method: "POST", headers: { "Content-Type": "application/json" }, …` call sites: change the headers to `{ "Content-Type": "application/json", ...getDossierAuthHeaders() }`.
- The `postReresearchFailureFlag({ … })` call: add `headers: getDossierAuthHeaders(),` to the argument object.

In `src/components/changeDialogue/ChangeDialogue.jsx`: import `getDossierAuthHeaders` from `../../utils/dossierCredential` and change that fetch's headers to `{ 'Content-Type': 'application/json', ...getDossierAuthHeaders() }`.

In `src/components/amendmentDocuments/AmendmentDocuments.jsx`: import it the same way and pass `{ headers: getDossierAuthHeaders() }` as the fetch's second argument.

In `src/reresearch/failureFlag.js`, change `postReresearchFailureFlag` to:

```js
function postReresearchFailureFlag(args = {}) {
  const { headers = {}, ...eventArgs } = args;
  const event = buildReresearchFailureEvent(eventArgs);
  if (typeof fetch === "function") {
    fetch("/api/change-events", {
      method: "POST",
      // Callers pass the tab's dossier credential; this module stays free of
      // browser storage so it remains runnable under node --test.
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(event),
    }).catch((err) => console.warn("[reresearch] failure flag write failed:", err));
  }
  return event;
}
```

Add to `src/reresearch/tests/failureFlag.nodetest.js`:

```js
test("postReresearchFailureFlag merges caller headers and keeps them out of the event", () => {
  const seen = [];
  const prev = global.fetch;
  global.fetch = (url, opts) => { seen.push(opts); return Promise.resolve({}); };
  try {
    const event = postReresearchFailureFlag({ dossierId: "d-1", headers: { Authorization: "Bearer dossier:t" } });
    assert.strictEqual(seen[0].headers.Authorization, "Bearer dossier:t");
    assert.strictEqual(seen[0].headers["Content-Type"], "application/json");
    assert.strictEqual(event.headers, undefined);
    assert.strictEqual(JSON.parse(seen[0].body).headers, undefined);
  } finally {
    global.fetch = prev;
  }
});
```

(Use whatever `require` / `assert` bindings that test file already declares.)

- [ ] **Step 6: Review-only view for a customer-owned dossier**

In `src/App.js`, directly after `if (linkError) { … }`, add a banner flag:

```js
  // An analyst previewing a dossier the customer has taken over may read it but
  // not change it. The server enforces this on every write; the banner says why.
  const reviewOnly = preboardingUnlocked && dossierOwnedBy === "customer";
```

Render this banner at the top of the main onboarding return, immediately inside its outermost wrapper element:

```jsx
      {reviewOnly && (
        <div role="status" style={{
          background: "#fff7ed", border: "1px solid #fdba74", color: "#9a3412",
          padding: "10px 16px", fontSize: 13, fontWeight: 600, textAlign: "center",
        }}>
          Review only — the customer has taken over this application, so nothing here can be changed.
        </div>
      )}
```

Pass `dossierOwnedBy={dossierOwnedBy}` to `<DossierView … />`. In `DossierView.jsx`, accept `dossierOwnedBy` and, where the Save / Update and Invite buttons compute `disabled`, OR in `dossierOwnedBy === "customer"`; next to the Invite button, when that is the reason, show `The customer has taken over this application.` in the existing hint style.

Add a test to `CustomerLinkLanding.test.jsx`:

```jsx
test("the dossier's ownership is recorded from the response", async () => {
  fetchRoutes["/api/get-dossier"] = () => Promise.resolve({
    ok: true, status: 200,
    json: () => Promise.resolve({ success: true, dossier: { id: "d-1", company_name: "Acme Ltd", owned_by: "customer", raw_research: { found: [] } } }),
  });
  await mountAt("/?tenant=nium&dossierToken=signed.tok&journey=customer");
  // A customer (not an analyst) never sees the review-only banner, even on a customer-owned dossier.
  expect(bodyText()).not.toMatch(/Review only/i);
});
```

- [ ] **Step 7: Run the affected suites**

Run:

```bash
CI=true npx react-scripts test --watchAll=false src/components/preboarding/__tests__/CustomerLinkLanding.test.jsx src/components/preboarding/__tests__/Preboarding.render.test.jsx src/components/changeDialogue src/components/amendmentDocuments
node --test src/reresearch/tests/failureFlag.nodetest.js
```

Expected: PASS. If an existing ChangeDialogue or AmendmentDocuments test asserts the exact `fetch` arguments, update it to allow the added headers (use `expect.objectContaining`) without removing its other assertions.

- [ ] **Step 8: Build**

Run: `npm run build`
Expected: compiles. The previous unused-variable warning for `preboardingToken` disappears if it is now used; otherwise it is unchanged.

- [ ] **Step 9: Commit**

```bash
git add src/components/preboarding/LinkUnavailable.jsx src/components/preboarding/__tests__/CustomerLinkLanding.test.jsx src/App.js src/components/preboarding/DossierView.jsx src/components/changeDialogue/ChangeDialogue.jsx src/components/amendmentDocuments/AmendmentDocuments.jsx src/reresearch/failureFlag.js src/reresearch/tests/failureFlag.nodetest.js
git commit -m "feat(security): customers enter through a signed link; every dossier call is credentialed; analysts see customer-owned dossiers read-only"
```

---

## Task 11: Verification, deploy gate and backlog

**Files:**
- Modify: `docs/BACKLOG.md`

- [ ] **Step 1: Backend suite**

Run: `npm run test:node`
Expected: PASS, 0 failures.

- [ ] **Step 2: Frontend suite**

Run: `CI=true npx react-scripts test --watchAll=false`
Expected: PASS. Re-run any of `PolicySimulator.test.jsx`, `appMounts.test.jsx`, `noTenantLanding.integration.test.jsx` in isolation before calling a failure a regression.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: "Compiled successfully".

- [ ] **Step 4: No dossier endpoint answers anonymously**

Run:

```bash
npx rg -n "resolveDossierActor" api/get-dossier.js api/save-dossier.js api/search-attempt.js api/invite.js api/revoke-dossier-token.js api/change-events.js api/amendment-documents.js
```

Expected: every one of the seven files matches.

- [ ] **Step 5: No raw dossier id link remains**

Run: `npx rg -n "dossierId=\\$\\{|dossierId=' ?\\+|&dossierId=" src api --glob '!**/__tests__/**'`
Expected: no matches.

- [ ] **Step 6: Update the backlog**

In `docs/BACKLOG.md`, add under **Open dependencies**:

```markdown
### DEP-3 — Part 1 deploy gates: DOSSIER_TOKEN_SECRET + migration 026
- **Category:** Security / Deploy · **Priority:** P1 · **Status:** OPEN (manual step for the owner)
- **What:** (1) Set `DOSSIER_TOKEN_SECRET` to a long random value in every environment that sends invites or serves customer links. (2) Apply `db/migrations/026_dossier_ownership.sql` to each database (`node db/apply.js db/migrations/026_dossier_ownership.sql`).
- **Why:** Without the secret, invites return 500 and every customer link is refused. Without the migration, dossier reads and writes fail on the missing `owned_by` column.
- **Breaking by design:** every previously-emailed `?dossierId=` link stops working; analysts re-send invites.
```

Append to the existing **PREB-2** entry:

```markdown
- **Status note (Part 1):** the server side shipped — `POST /api/revoke-dossier-token { dossierId }` (analyst only) revokes every outstanding link for that dossier. Only the button is still missing.
```

- [ ] **Step 7: Commit**

```bash
git add docs/BACKLOG.md
git commit -m "docs: Part 1 deploy gates and revocation status"
```

---

## Manual QA checklist (owner)

1. As an analyst at `/preboarding?tenant=nium`, research a company, save the dossier, send an invite — the link shown contains `dossierToken=` and no `dossierId=`.
2. Open that link in a private window — the customer lands pre-filled.
3. Change the token by one character — "This link isn't valid".
4. Open an old `?dossierId=` link — "This link is no longer valid".
5. As the customer, correct any field — then as the analyst, open the dossier: the "Review only" banner shows and Save / Invite are disabled.
6. `POST /api/revoke-dossier-token { dossierId }` as the analyst — the customer's link now says "no longer active"; a fresh invite works.
7. With `DOSSIER_TOKEN_SECRET` unset locally, sending an invite fails rather than issuing an unsigned link.
