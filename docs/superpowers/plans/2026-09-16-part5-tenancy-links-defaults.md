# Part 5 — Tenancy, Links and Default Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make pre-boarding tenant-scoped and server-verified, stop Nium leaking into other tenants' customer-facing surfaces, and turn the Nium seed into a named, undeletable "default settings" template with protection driven by a registry flag instead of the literal id `"nium"`.

**Architecture:** A new CommonJS `lib/tenantRegistry.js` becomes the single reader of the `tenant-registry` KV entry, and every tenant-existence / active / pre-boarding-enabled / protected decision routes through it. `api/config.js` stops auto-creating tenants; `api/tenants.js` owns registry writes and gains a pre-boarding toggle. A new `lib/configTemplates.js` wraps `lib/seedConfig.js` as named templates exposed by `api/config-templates.js`, replacing the two drifting client copies. Pre-boarding moves to its own `/preboarding` route with a server-checked gate (`api/preboarding-auth.js`) that binds the analyst session to a verified tenant.

**Tech Stack:** Create React App (React 18, inline styles, no router), CommonJS Vercel serverless functions in `api/`, shared CommonJS modules in `lib/`, `lib/storage.js` (KV / Redis / filesystem), `node --test` for backend tests, CRA Jest + Testing Library for frontend tests.

## Global Constraints

- **CommonJS in `api/` and `lib/`** (`module.exports` / `require`) so `src/setupProxy.js` can mount the same handlers under `npm start`.
- **Every new handler is registered in `src/setupProxy.js`** by requiring the real handler — never by copying its body.
- **Backend tests** are `*.nodetest.js` using `node:test` + `node:assert`, with fakes injected through a `__setDeps` seam; they must be matched by the `test:node` glob in `package.json:26` (`lib/__tests__/*.nodetest.js api/__tests__/*.nodetest.js`).
- **Frontend tests** are CRA Jest render tests asserting real DOM behaviour.
- **Tenant resolution stays 3-strict:** no `"nium"` fallback anywhere, client or server.
- **No new runtime dependency.**
- **Inline styles only** in React; match each file's existing conventions.
- **Secrets stay server-side**; new env vars are documented in `.env.example` with placeholder values.
- **Commands:** `npm run test:node` (backend), `CI=true npx react-scripts test --watchAll=false <path>` (single frontend suite), `npm run build` (production build).
- **Known-flaky frontend suites** (`PolicySimulator.test.jsx`, `appMounts.test.jsx`, `noTenantLanding.integration.test.jsx`) must be re-run in isolation before being treated as regressions.

---

## File Structure

**New files**

| File | Responsibility |
|---|---|
| `lib/tenantRegistry.js` | Single reader/query surface for the `tenant-registry` entry: existence, active, pre-boarding-enabled, protected. |
| `lib/__tests__/tenantRegistry.nodetest.js` | Tests for the above. |
| `lib/configTemplates.js` | Named config templates (`nium-default`), brand-cleared, built from `lib/seedConfig.js`. |
| `lib/__tests__/configTemplates.nodetest.js` | Tests for the above. |
| `api/config-templates.js` | `GET` list / `GET ?id=` build a template (admin-authed). |
| `api/__tests__/config-templates.nodetest.js` | Tests for the above. |
| `api/preboarding-auth.js` | `GET` availability probe, `POST` password check; binds the analyst to a verified tenant. |
| `api/__tests__/preboarding-auth.nodetest.js` | Tests for the above. |
| `src/components/preboarding/PreboardingUnavailable.jsx` | Screen for unknown / inactive / pre-boarding-disabled tenants. |

**Modified files**

| File | Change |
|---|---|
| `lib/tenant.js` | Drop the `TENANT_ID` env fallback (server becomes 3-strict). |
| `api/config.js` | No auto-seed for unknown tenants (404), legacy back-fill, protection by registry flag, self-heal archives first. |
| `api/config-versions.js` | Rollback honours the same empty-config guard; auth by protected flag. |
| `api/tenants.js` | Registry reads via `lib/tenantRegistry.js`; `isProtected` back-fill; `toggle-preboarding` action; brand-cleared template copy. |
| `api/benchmark.js` | Use the shared config reader instead of its copy-pasted `seedTenant`/`readConfig`. |
| `api/invite.js` | Email subject/body/sign-off/sender use the tenant's company name. |
| `lib/seedConfig.js` | Default template no longer carries Nium's brand name or manual-form URL. |
| `src/index.js` | `/preboarding` route; title logic. |
| `vercel.json` | `/preboarding` rewrites. |
| `src/App.js` | `preboarding` prop, legacy `?preboarding=1` redirect, single param read, server-checked gate, tenant from the auth response, tenant+flow-scoped draft, no `MANUAL_FORM_URL` fallback. |
| `src/components/preboarding/PreboardingGate.jsx` | Calls `/api/preboarding-auth` instead of comparing a client constant. |
| `src/components/preboarding/InviteScreen.jsx` | Email preview uses the tenant's company name. |
| `src/components/companyLookup/JourneyPicker.jsx` | Card C renders only when the tenant configured a manual-form URL. |
| `src/components/Step2DynamicForm.jsx` | Brand strings take the company name from props. |
| `src/utils/submissionDraft.js` | Draft carries `tenantId` + `agentType`; `loadDraft` filters. |
| `src/constants/appConstants.js` | Remove `MANUAL_FORM_URL`. |
| `src/config/localDefaultConfig.js` | Neutral company block. |
| `src/admin/AdminRoot.jsx` | Offline fallback stops special-casing `"nium"`. |
| `src/admin/AdminDashboard.jsx` | Preview URL always carries the tenant. |
| `src/admin/steps/StepPublish.jsx` | Preview + "View live flow" always carry the tenant; "Apply default settings" action. |
| `src/superadmin/components/TenantCard.jsx` | URLs always carry the tenant; pre-boarding toggle. |
| `src/superadmin/components/CredentialsModal.jsx` | URLs already carry the tenant — add the pre-boarding URL. |
| `src/superadmin/components/CreateTenantModal.jsx` | Template label wording. |
| `src/superadmin/SuperAdminDashboard.jsx` | Wire the pre-boarding toggle. |
| `lib/seedSchemas.js`, `src/pipeline.js` | Brand-neutral FI labels. |
| `src/setupProxy.js` | Mount `preboarding-auth` and `config-templates`. |
| `.env.example` | Add `PREBOARDING_PASSWORD`; mark `TENANT_ID` removed. |

**Deleted files**

| File | Why |
|---|---|
| `src/admin/defaultConfig.js` | Drifted duplicate of `lib/seedConfig.js`; replaced by `api/config-templates.js`. |

---

## Task 1: Tenant registry helper + 3-strict server tenant resolution

**Files:**
- Create: `lib/tenantRegistry.js`
- Create: `lib/__tests__/tenantRegistry.nodetest.js`
- Modify: `lib/tenant.js:29-54`
- Modify: `lib/__tests__/tenant.nodetest.js`

**Interfaces:**
- Consumes: `lib/storage.js` (`get`, `set`).
- Produces:
  - `readRegistry(): Promise<Array<Entry>>` — `[]` when absent.
  - `findTenant(id): Promise<Entry|null>`
  - `tenantExists(id): Promise<boolean>`
  - `isTenantActive(id): Promise<boolean>` — `false` when missing; `true` unless `isActive === false`.
  - `isPreboardingEnabled(id): Promise<boolean>` — `true` only when `preboardingEnabled === true`.
  - `isProtectedTenant(id): Promise<boolean>` — `true` when `isProtected === true` or `isInternal === true`.
  - `upsertEntry(id, patch): Promise<Array<Entry>>`
  - `__setDeps({ storage })` — test seam.
  - `Entry = { tenantId, companyName, createdAt, createdBy, lastPublishedAt, isActive, isInternal, isBlank, isProtected?, preboardingEnabled? }`
  - `REGISTRY_KEY = "tenant-registry"`

- [ ] **Step 1: Write the failing test**

Create `lib/__tests__/tenantRegistry.nodetest.js`:

```js
const { test } = require("node:test");
const assert = require("node:assert");
const registry = require("../tenantRegistry");

function fakeStorage(initial) {
  const data = { ...(initial || {}) };
  return {
    data,
    async get(key) { return key in data ? data[key] : null; },
    async set(key, value) { data[key] = value; },
  };
}

test("readRegistry returns [] when nothing is stored", async () => {
  registry.__setDeps({ storage: fakeStorage() });
  assert.deepStrictEqual(await registry.readRegistry(), []);
});

test("tenantExists is true only for registered ids", async () => {
  registry.__setDeps({ storage: fakeStorage({ "tenant-registry": [{ tenantId: "acme" }] }) });
  assert.strictEqual(await registry.tenantExists("acme"), true);
  assert.strictEqual(await registry.tenantExists("acmee"), false);
});

test("isTenantActive is false for unknown tenants and for isActive:false", async () => {
  registry.__setDeps({ storage: fakeStorage({ "tenant-registry": [
    { tenantId: "acme", isActive: true },
    { tenantId: "dormant", isActive: false },
    { tenantId: "legacy" },
  ] }) });
  assert.strictEqual(await registry.isTenantActive("acme"), true);
  assert.strictEqual(await registry.isTenantActive("dormant"), false);
  assert.strictEqual(await registry.isTenantActive("legacy"), true);
  assert.strictEqual(await registry.isTenantActive("ghost"), false);
});

test("isPreboardingEnabled requires an explicit true", async () => {
  registry.__setDeps({ storage: fakeStorage({ "tenant-registry": [
    { tenantId: "on", preboardingEnabled: true },
    { tenantId: "off", preboardingEnabled: false },
    { tenantId: "unset" },
  ] }) });
  assert.strictEqual(await registry.isPreboardingEnabled("on"), true);
  assert.strictEqual(await registry.isPreboardingEnabled("off"), false);
  assert.strictEqual(await registry.isPreboardingEnabled("unset"), false);
  assert.strictEqual(await registry.isPreboardingEnabled("ghost"), false);
});

test("isProtectedTenant honours isProtected and legacy isInternal", async () => {
  registry.__setDeps({ storage: fakeStorage({ "tenant-registry": [
    { tenantId: "flagged", isProtected: true },
    { tenantId: "legacy-internal", isInternal: true },
    { tenantId: "plain" },
  ] }) });
  assert.strictEqual(await registry.isProtectedTenant("flagged"), true);
  assert.strictEqual(await registry.isProtectedTenant("legacy-internal"), true);
  assert.strictEqual(await registry.isProtectedTenant("plain"), false);
});

test("upsertEntry patches an existing entry and appends a new one", async () => {
  const storage = fakeStorage({ "tenant-registry": [{ tenantId: "acme", isActive: true }] });
  registry.__setDeps({ storage });
  await registry.upsertEntry("acme", { preboardingEnabled: true });
  await registry.upsertEntry("new-co", { companyName: "New Co" });
  const stored = storage.data["tenant-registry"];
  assert.deepStrictEqual(stored[0], { tenantId: "acme", isActive: true, preboardingEnabled: true });
  assert.deepStrictEqual(stored[1], { tenantId: "new-co", companyName: "New Co" });
});

test("a storage failure degrades to an empty registry instead of throwing", async () => {
  registry.__setDeps({ storage: { async get() { throw new Error("kv down"); }, async set() {} } });
  assert.deepStrictEqual(await registry.readRegistry(), []);
  assert.strictEqual(await registry.tenantExists("acme"), false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test lib/__tests__/tenantRegistry.nodetest.js`
Expected: FAIL — `Cannot find module '../tenantRegistry'`.

- [ ] **Step 3: Implement `lib/tenantRegistry.js`**

```js
// Single read surface for the tenant registry (KV key "tenant-registry").
//
// Every "does this tenant exist / is it active / may it use pre-boarding / is
// it protected" decision goes through here, so those answers can never drift
// between endpoints. api/tenants.js still owns registry WRITES (it is the
// super-admin surface); this module exposes upsertEntry for it to use.
//
// CommonJS so api/ handlers and src/setupProxy.js can require it.

const storage = require("./storage");

const REGISTRY_KEY = "tenant-registry";

// Injected deps (overridable in tests via __setDeps) — mirrors api/submit.js.
let _deps = { storage };

async function readRegistry() {
  try {
    const stored = await _deps.storage.get(REGISTRY_KEY);
    return Array.isArray(stored) ? stored : [];
  } catch (_) {
    // A storage blip must never read as "this tenant exists" — callers treat
    // an empty registry as "unknown tenant", which fails closed.
    return [];
  }
}

async function findTenant(tenantId) {
  if (!tenantId) return null;
  const reg = await readRegistry();
  return reg.find((t) => t && t.tenantId === tenantId) || null;
}

async function tenantExists(tenantId) {
  return (await findTenant(tenantId)) !== null;
}

// Unknown → false. Known → active unless explicitly deactivated.
async function isTenantActive(tenantId) {
  const entry = await findTenant(tenantId);
  if (!entry) return false;
  return entry.isActive !== false;
}

// Opt-in only: pre-boarding stays off until a super-admin turns it on.
async function isPreboardingEnabled(tenantId) {
  const entry = await findTenant(tenantId);
  return !!(entry && entry.preboardingEnabled === true);
}

// isInternal is the legacy spelling of the same idea; both count.
async function isProtectedTenant(tenantId) {
  const entry = await findTenant(tenantId);
  return !!(entry && (entry.isProtected === true || entry.isInternal === true));
}

async function upsertEntry(tenantId, patch) {
  const reg = await readRegistry();
  const idx = reg.findIndex((t) => t && t.tenantId === tenantId);
  if (idx >= 0) {
    reg[idx] = { ...reg[idx], ...patch };
  } else {
    reg.push({ tenantId, ...patch });
  }
  await _deps.storage.set(REGISTRY_KEY, reg);
  return reg;
}

module.exports = {
  REGISTRY_KEY,
  readRegistry,
  findTenant,
  tenantExists,
  isTenantActive,
  isPreboardingEnabled,
  isProtectedTenant,
  upsertEntry,
};

// Test seam only.
module.exports.__setDeps = (d) => { _deps = { ..._deps, ...d }; };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test lib/__tests__/tenantRegistry.nodetest.js`
Expected: PASS — 7 tests.

- [ ] **Step 5: Write the failing test for 3-strict server resolution**

Replace the `TENANT_ID` case in `lib/__tests__/tenant.nodetest.js` (the test asserting the env fallback resolves) with:

```js
test("TENANT_ID env var is NOT a fallback — the server is 3-strict like the client", async (t) => {
  const prev = process.env.TENANT_ID;
  process.env.TENANT_ID = "nium";
  t.after(() => {
    if (prev === undefined) delete process.env.TENANT_ID;
    else process.env.TENANT_ID = prev;
  });

  // No ?tenant=, no x-tenant-id: an env var must not silently pick a tenant.
  assert.strictEqual(getTenantIdFromRequest({ query: {}, headers: {}, url: "/api/config" }), "");
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `node --test lib/__tests__/tenant.nodetest.js`
Expected: FAIL — returns `"nium"`, expected `""`.

- [ ] **Step 7: Drop the env fallback**

In `lib/tenant.js`, replace the final line of `getTenantIdFromRequest` (`return sanitiseTenantId(process.env.TENANT_ID);`) with:

```js
  // 3-strict: no TENANT_ID fallback. A request that names no tenant HAS no
  // tenant — callers return tenant_required rather than silently serving one.
  return "";
```

Update the doc comment above it (priority list item 3) to read:

```js
 *   3. "" — no tenant. Callers MUST treat this as "tenant required", not
 *      silently serve/seed anything for it. There is no env-var fallback.
```

- [ ] **Step 8: Run both suites**

Run: `node --test lib/__tests__/tenant.nodetest.js lib/__tests__/tenantRegistry.nodetest.js`
Expected: PASS.

- [ ] **Step 9: Update `.env.example`**

Replace the `TENANT_ID=nium` line with:

```
# TENANT_ID is no longer used — tenant resolution is 3-strict (?tenant= or the
# x-tenant-id header). Set nothing here; a request without a tenant is refused.
```

- [ ] **Step 10: Commit**

```bash
git add lib/tenantRegistry.js lib/__tests__/tenantRegistry.nodetest.js lib/tenant.js lib/__tests__/tenant.nodetest.js .env.example
git commit -m "feat(tenancy): tenant registry helper; drop the server TENANT_ID fallback"
```

---

## Task 2: `api/config.js` — stop auto-creating tenants

**Files:**
- Modify: `api/config.js:56-87` (`seedTenant`, `readConfig`), `:110-119` (GET)
- Test: `api/__tests__/config.nodetest.js`

**Interfaces:**
- Consumes: `lib/tenantRegistry.js#tenantExists`, `#upsertEntry` (Task 1).
- Produces: `GET /api/config?tenant=<unknown>` → `404 { error: "tenant_not_found" }`; a legacy tenant (config present, no registry entry) is back-filled into the registry and served; `module.exports.__setDeps({ storage, registry })` test seam on `api/config.js`.

- [ ] **Step 1: Write the failing tests**

Append to `api/__tests__/config.nodetest.js`:

```js
const registry = require("../../lib/tenantRegistry");

function fakeStorage(initial) {
  const data = { ...(initial || {}) };
  return {
    data,
    async get(key) { return key in data ? data[key] : null; },
    async set(key, value) { data[key] = value; },
    async del(key) { delete data[key]; },
    async list(prefix) { return Object.keys(data).filter((k) => k.startsWith(prefix)); },
  };
}

test("GET for a tenant that is not in the registry returns 404 and seeds nothing", async () => {
  const storage = fakeStorage({ "tenant-registry": [{ tenantId: "acme" }] });
  handler.__setDeps({ storage });
  registry.__setDeps({ storage });

  const { req, res } = fakeReqRes({ method: "GET", query: { tenant: "acmee" } });
  await handler(req, res);

  assert.strictEqual(res.statusCode, 404);
  assert.deepStrictEqual(res.body, { error: "tenant_not_found" });
  assert.strictEqual(storage.data["config:acmee"], undefined);
});

test("GET for a registered tenant with no config seeds a blank one", async () => {
  const storage = fakeStorage({ "tenant-registry": [{ tenantId: "acme" }] });
  handler.__setDeps({ storage });
  registry.__setDeps({ storage });

  const { req, res } = fakeReqRes({ method: "GET", query: { tenant: "acme" } });
  await handler(req, res);

  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body._isBlank, true);
  assert.ok(storage.data["config:acme"], "config should have been seeded");
});

test("a legacy tenant (config exists, no registry entry) is served and back-filled", async () => {
  const storage = fakeStorage({
    "tenant-registry": [],
    "config:oldco": { _tenantId: "oldco", _version: 3, licences: [{ id: "GB" }], company: { name: "Old Co" } },
  });
  handler.__setDeps({ storage });
  registry.__setDeps({ storage });

  const { req, res } = fakeReqRes({ method: "GET", query: { tenant: "oldco" } });
  await handler(req, res);

  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body._version, 3);
  const entry = storage.data["tenant-registry"].find((t) => t.tenantId === "oldco");
  assert.ok(entry, "legacy tenant should be back-filled into the registry");
  assert.strictEqual(entry.companyName, "Old Co");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test api/__tests__/config.nodetest.js`
Expected: FAIL — `handler.__setDeps is not a function`.

- [ ] **Step 3: Implement the seam and the gate**

In `api/config.js`, after the `require` block add:

```js
const tenantRegistry = require("../lib/tenantRegistry");

// Injected deps (overridable in tests via __setDeps) — mirrors api/submit.js.
let _deps = { storage, registry: tenantRegistry };
```

Replace every `storage.` call in the file with `_deps.storage.` and every registry call with `_deps.registry.`, then replace `seedTenant` / `readConfig` with:

```js
// Seed a tenant that doesn't yet have a config. Only tenants that exist (a
// registry entry, or a pre-existing config from before the registry) are ever
// seeded — a typo must not conjure a tenant into being.
async function seedTenant(tenant) {
  const seeded = (await _deps.registry.isProtectedTenant(tenant))
    ? buildDefaultConfig(tenant)
    : buildBlankConfig(tenant);
  seeded._tenantId = tenant;
  await _deps.storage.set(configKey(tenant), seeded);
  return seeded;
}

// Read the live config for a tenant. Returns null when the tenant is unknown
// (no registry entry AND no legacy config) so the handler can 404.
// Protected tenants self-heal: a config with no licences is archived and
// re-seeded from the template so the live customer flow is never broken.
async function readConfig(tenant) {
  const stored = await _deps.storage.get(configKey(tenant));

  if (!stored) {
    if (!(await _deps.registry.tenantExists(tenant))) return null;
    return seedTenant(tenant);
  }

  // Legacy tenant: it has a config but predates the registry. Back-fill the
  // entry so every later existence check agrees with reality.
  if (!(await _deps.registry.tenantExists(tenant))) {
    await _deps.registry.upsertEntry(tenant, {
      companyName: (stored.company && stored.company.name) || tenant,
      createdAt: stored._seededAt || new Date().toISOString(),
      createdBy: "back-fill",
      lastPublishedAt: stored._publishedAt || null,
      isActive: true,
      isInternal: false,
      isBlank: stored._isBlank === true,
    });
  }

  if (await _deps.registry.isProtectedTenant(tenant)) {
    const hasLicences = Array.isArray(stored.licences) && stored.licences.length > 0;
    if (!hasLicences) {
      // eslint-disable-next-line no-console
      console.warn(`Protected tenant "${tenant}" config missing licences — self-healing from the default template`);
      // Archive the broken config first: self-heal must never be the only
      // copy of what was there (it used to overwrite silently).
      const brokenVersion = stored._version || 0;
      await _deps.storage.set(versionKey(tenant, brokenVersion), stored);
      const fresh = buildDefaultConfig(tenant);
      fresh._tenantId = tenant;
      fresh._selfHealedAt = new Date().toISOString();
      await _deps.storage.set(configKey(tenant), fresh);
      return fresh;
    }
  }

  return stored;
}
```

In the `GET` branch:

```js
    if (req.method === "GET") {
      const cfg = await readConfig(tenant);
      if (!cfg) return res.status(404).json({ error: "tenant_not_found" });
      return res.status(200).json(cfg);
    }
```

In the `POST` branch, replace `const previous = await readConfig(tenant);` with:

```js
      const previous = (await readConfig(tenant)) || {};
```

At the end of the file add:

```js
// Test seam only.
module.exports.__setDeps = (d) => { _deps = { ..._deps, ...d }; };
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test api/__tests__/config.nodetest.js`
Expected: PASS. The pre-existing `?tenant=<id> resolves normally` test now needs a registry entry — update it to seed `"tenant-registry": [{ tenantId: TENANT }]` into the fake storage it injects, keeping its cleanup.

- [ ] **Step 5: Commit**

```bash
git add api/config.js api/__tests__/config.nodetest.js
git commit -m "fix(tenancy): config GET 404s for unknown tenants instead of creating them"
```

---

## Task 3: Protection by registry flag (publish, rollback, delete, auth)

**Files:**
- Modify: `api/config.js:38-54` (`authorizeAdmin`), `:133-143` (empty-publish guard), `:171-182` (DELETE)
- Modify: `api/config-versions.js:20-31` (`authorizeAdmin`), `:92-134` (rollback)
- Test: `api/__tests__/config-protection.nodetest.js` (new)

**Interfaces:**
- Consumes: `lib/tenantRegistry.js#isProtectedTenant`, `api/config.js#__setDeps` (Tasks 1-2).
- Produces: `DELETE /api/config` → `403 { error: "tenant_protected" }` for protected tenants; the empty-config publish guard applies to any protected tenant; `POST /api/config-versions` refuses a rollback to a gutted config with `400 { error: "empty_config_rejected" }`; `api/config-versions.js#__setDeps({ storage, registry })`.

- [ ] **Step 1: Write the failing tests**

Create `api/__tests__/config-protection.nodetest.js`:

```js
const { test } = require("node:test");
const assert = require("node:assert");
const configHandler = require("../config");
const versionsHandler = require("../config-versions");
const registry = require("../../lib/tenantRegistry");

const ADMIN = "test-admin-password";

function fakeStorage(initial) {
  const data = { ...(initial || {}) };
  return {
    data,
    async get(key) { return key in data ? data[key] : null; },
    async set(key, value) { data[key] = value; },
    async del(key) { delete data[key]; },
    async list(prefix) { return Object.keys(data).filter((k) => k.startsWith(prefix)); },
  };
}

function fakeReqRes({ method = "GET", query = {}, headers = {}, body = undefined } = {}) {
  const req = { method, query, headers, body, url: "/api/config" };
  const res = {
    statusCode: null,
    body: null,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    end() { return this; },
  };
  return { req, res };
}

const GOOD_CONFIG = {
  _version: 4,
  licences: [{ id: "GB" }],
  entityTypes: [{ id: "Corporate", active: true }],
  schemas: { "Corporate:GB": { researchFields: [], gapFields: [] } },
};

function protectedStore() {
  return fakeStorage({
    "tenant-registry": [{ tenantId: "acme", isProtected: true }],
    "config:acme": { ...GOOD_CONFIG },
    "config:acme:v3": { _version: 3, licences: [{ id: "GB" }], entityTypes: [{ id: "Corporate", active: true }] },
    "config:acme:v2": { _version: 2, licences: [], entityTypes: [] },
  });
}

function withAdmin(t) {
  const prev = process.env.ADMIN_PASSWORD;
  process.env.ADMIN_PASSWORD = ADMIN;
  t.after(() => {
    if (prev === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = prev;
  });
}

test("DELETE is refused for a protected tenant and keeps every version", async (t) => {
  withAdmin(t);
  const storage = protectedStore();
  configHandler.__setDeps({ storage });
  registry.__setDeps({ storage });

  const { req, res } = fakeReqRes({
    method: "DELETE",
    query: { tenant: "acme" },
    headers: { authorization: `Bearer ${ADMIN}` },
  });
  await configHandler(req, res);

  assert.strictEqual(res.statusCode, 403);
  assert.deepStrictEqual(res.body, { error: "tenant_protected" });
  assert.ok(storage.data["config:acme"], "live config must survive");
  assert.ok(storage.data["config:acme:v3"], "archived versions must survive");
});

test("DELETE still works for an unprotected tenant", async (t) => {
  withAdmin(t);
  const storage = fakeStorage({
    "tenant-registry": [{ tenantId: "plain", isProtected: false }],
    "config:plain": { _version: 1 },
  });
  configHandler.__setDeps({ storage });
  registry.__setDeps({ storage });

  const { req, res } = fakeReqRes({
    method: "DELETE",
    query: { tenant: "plain" },
    headers: { authorization: `Bearer ${ADMIN}` },
  });
  await configHandler(req, res);

  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(storage.data["config:plain"], undefined);
});

test("publishing a gutted config is refused for any protected tenant (not just nium)", async (t) => {
  withAdmin(t);
  const storage = protectedStore();
  configHandler.__setDeps({ storage });
  registry.__setDeps({ storage });

  const { req, res } = fakeReqRes({
    method: "POST",
    query: { tenant: "acme" },
    headers: { authorization: `Bearer ${ADMIN}` },
    body: { licences: [], entityTypes: [] },
  });
  await configHandler(req, res);

  assert.strictEqual(res.statusCode, 400);
  assert.match(res.body.error, /empty configuration/i);
  assert.strictEqual(storage.data["config:acme"]._version, 4, "live config untouched");
});

test("rolling a protected tenant back to a gutted version is refused", async (t) => {
  withAdmin(t);
  const storage = protectedStore();
  versionsHandler.__setDeps({ storage });
  registry.__setDeps({ storage });

  const { req, res } = fakeReqRes({
    method: "POST",
    query: { tenant: "acme" },
    headers: { authorization: `Bearer ${ADMIN}` },
    body: { version: 2 },
  });
  await versionsHandler(req, res);

  assert.strictEqual(res.statusCode, 400);
  assert.deepStrictEqual(res.body, { error: "empty_config_rejected" });
  assert.strictEqual(storage.data["config:acme"]._version, 4);
});

test("rolling back to a healthy version still works", async (t) => {
  withAdmin(t);
  const storage = protectedStore();
  versionsHandler.__setDeps({ storage });
  registry.__setDeps({ storage });

  const { req, res } = fakeReqRes({
    method: "POST",
    query: { tenant: "acme" },
    headers: { authorization: `Bearer ${ADMIN}` },
    body: { version: 3 },
  });
  await versionsHandler(req, res);

  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(storage.data["config:acme"]._rolledBackFrom, 3);
});

test("self-heal archives the broken config before overwriting it", async (t) => {
  const storage = fakeStorage({
    "tenant-registry": [{ tenantId: "acme", isProtected: true }],
    "config:acme": { _version: 7, licences: [], entityTypes: [] },
  });
  configHandler.__setDeps({ storage });
  registry.__setDeps({ storage });

  const { req, res } = fakeReqRes({ method: "GET", query: { tenant: "acme" } });
  await configHandler(req, res);

  assert.strictEqual(res.statusCode, 200);
  assert.ok(res.body.licences.length > 0, "served config is healed");
  assert.ok(storage.data["config:acme:v7"], "broken config archived before overwrite");
  assert.deepStrictEqual(storage.data["config:acme:v7"].licences, []);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test api/__tests__/config-protection.nodetest.js`
Expected: FAIL — DELETE returns 200; the publish guard only fires for `"nium"`; `versionsHandler.__setDeps` is undefined.

- [ ] **Step 3: Implement in `api/config.js`**

Replace the Nium-specific branch in `authorizeAdmin`:

```js
async function authorizeAdmin(tenant, token) {
  if (!token) return false;
  try {
    const stored = await _deps.storage.get(authKey(tenant));
    if (stored && verifyPassword(token, stored.passwordHash)) return true;
  } catch (_) {}
  // Protected (platform) tenants keep the env-password path so the very first
  // publish works before the per-tenant auth entry is seeded.
  if (await _deps.registry.isProtectedTenant(tenant)) {
    const env = process.env.ADMIN_PASSWORD;
    if (env && token === env) return true;
  }
  return false;
}
```

Replace the empty-publish guard:

```js
      // Protected-tenant protection — refuse empty publishes that would wipe
      // the live schemas. Self-healing only catches reads; this catches writes.
      if (await _deps.registry.isProtectedTenant(tenant)) {
        const lic = Array.isArray(body.licences) ? body.licences.length : 0;
        const ent = Array.isArray(body.entityTypes) ? body.entityTypes.filter((e) => e && e.active !== false).length : 0;
        if (lic === 0 || ent === 0) {
          return res.status(400).json({
            error: "Cannot publish an empty configuration for a protected tenant. Please ensure at least one licence and one entity type are configured.",
          });
        }
      }
```

Add the DELETE guard immediately after its auth check:

```js
      if (await _deps.registry.isProtectedTenant(tenant)) {
        // A protected tenant's config and its whole version history are not
        // deletable: this endpoint used to wipe config:<t> AND config:<t>:v*.
        return res.status(403).json({ error: "tenant_protected" });
      }
```

- [ ] **Step 4: Implement in `api/config-versions.js`**

Add after the requires:

```js
const tenantRegistry = require("../lib/tenantRegistry");

// Injected deps (overridable in tests via __setDeps) — mirrors api/submit.js.
let _deps = { storage, registry: tenantRegistry };
```

Replace every `storage.` with `_deps.storage.`, mirror the `authorizeAdmin` change from Step 3 (`_deps.registry.isProtectedTenant(tenant)` instead of `tenant === "nium"`), add the tenant guard at the top of the handler (after `const tenant = ...`):

```js
  if (!tenant) {
    return res.status(400).json({ error: "tenant_required" });
  }
```

and add the rollback guard immediately after the `archived` lookup:

```js
      // A rollback is a publish by another name: apply the same protection so
      // a gutted archived version can't be restored over a protected tenant.
      if (await _deps.registry.isProtectedTenant(tenant)) {
        const lic = Array.isArray(archived.licences) ? archived.licences.length : 0;
        const ent = Array.isArray(archived.entityTypes)
          ? archived.entityTypes.filter((e) => e && e.active !== false).length
          : 0;
        if (lic === 0 || ent === 0) {
          return res.status(400).json({ error: "empty_config_rejected" });
        }
      }
```

At the end of the file add:

```js
// Test seam only.
module.exports.__setDeps = (d) => { _deps = { ..._deps, ...d }; };
```

- [ ] **Step 5: Run to verify it passes**

Run: `node --test api/__tests__/config-protection.nodetest.js api/__tests__/config.nodetest.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add api/config.js api/config-versions.js api/__tests__/config-protection.nodetest.js
git commit -m "feat(tenancy): protect platform tenants by registry flag across delete, publish and rollback"
```

---

## Task 4: `api/tenants.js` — registry helper, protection back-fill, pre-boarding toggle

**Files:**
- Modify: `api/tenants.js:57-91` (registry helpers), `:126-201` (create), `:204-241` (PUT actions)
- Modify: `api/benchmark.js:75-100` (drop the copy-pasted reader)
- Test: `api/__tests__/tenants.nodetest.js` (new)

**Interfaces:**
- Consumes: `lib/tenantRegistry.js` (Task 1).
- Produces: `PUT /api/tenants?action=toggle-preboarding&tenantId=<id>` with body `{ preboardingEnabled: boolean }` → `{ success: true, preboardingEnabled }`; created tenants get `isProtected: false, preboardingEnabled: false`; the seeded platform entry gets `isProtected: true`; `GET /api/tenants` returns `preboardingEnabled` per tenant; `api/tenants.js#__setDeps({ storage, registry })`.

- [ ] **Step 1: Write the failing test**

Create `api/__tests__/tenants.nodetest.js`:

```js
const { test } = require("node:test");
const assert = require("node:assert");
const handler = require("../tenants");
const registry = require("../../lib/tenantRegistry");

const SUPER = "test-super-password";

function fakeStorage(initial) {
  const data = { ...(initial || {}) };
  return {
    data,
    async get(key) { return key in data ? data[key] : null; },
    async set(key, value) { data[key] = value; },
    async del(key) { delete data[key]; },
    async list(prefix) { return Object.keys(data).filter((k) => k.startsWith(prefix)); },
  };
}

function fakeReqRes({ method = "GET", query = {}, body = undefined } = {}) {
  const req = { method, query, body, headers: { authorization: `Bearer ${SUPER}` }, url: "/api/tenants" };
  const res = {
    statusCode: null, body: null, headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    end() { return this; },
  };
  return { req, res };
}

function withSuperAdmin(t) {
  const prev = process.env.SUPER_ADMIN_PASSWORD;
  process.env.SUPER_ADMIN_PASSWORD = SUPER;
  t.after(() => {
    if (prev === undefined) delete process.env.SUPER_ADMIN_PASSWORD;
    else process.env.SUPER_ADMIN_PASSWORD = prev;
  });
}

test("toggle-preboarding flips the registry flag", async (t) => {
  withSuperAdmin(t);
  const storage = fakeStorage({ "tenant-registry": [{ tenantId: "acme", isActive: true }] });
  handler.__setDeps({ storage });
  registry.__setDeps({ storage });

  const { req, res } = fakeReqRes({
    method: "PUT",
    query: { action: "toggle-preboarding", tenantId: "acme" },
    body: { preboardingEnabled: true },
  });
  await handler(req, res);

  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(res.body, { success: true, preboardingEnabled: true });
  assert.strictEqual(storage.data["tenant-registry"][0].preboardingEnabled, true);
});

test("toggle-preboarding refuses an unknown tenant", async (t) => {
  withSuperAdmin(t);
  const storage = fakeStorage({ "tenant-registry": [{ tenantId: "acme" }] });
  handler.__setDeps({ storage });
  registry.__setDeps({ storage });

  const { req, res } = fakeReqRes({
    method: "PUT",
    query: { action: "toggle-preboarding", tenantId: "ghost" },
    body: { preboardingEnabled: true },
  });
  await handler(req, res);

  assert.strictEqual(res.statusCode, 404);
  assert.deepStrictEqual(res.body, { error: "tenant_not_found" });
});

test("a newly created tenant is unprotected with pre-boarding off", async (t) => {
  withSuperAdmin(t);
  const storage = fakeStorage({ "tenant-registry": [] });
  handler.__setDeps({ storage });
  registry.__setDeps({ storage });

  const { req, res } = fakeReqRes({
    method: "POST",
    body: { tenantId: "newco", companyName: "New Co", password: "pw-123456", startFrom: "blank" },
  });
  await handler(req, res);

  assert.strictEqual(res.statusCode, 200);
  const entry = storage.data["tenant-registry"].find((x) => x.tenantId === "newco");
  assert.strictEqual(entry.isProtected, false);
  assert.strictEqual(entry.preboardingEnabled, false);
  assert.strictEqual(res.body.preboardingUrl, "/preboarding?tenant=newco");
});

test("the seeded platform entry is marked protected", async (t) => {
  withSuperAdmin(t);
  const storage = fakeStorage({});
  handler.__setDeps({ storage });
  registry.__setDeps({ storage });

  const { req, res } = fakeReqRes({ method: "GET" });
  await handler(req, res);

  assert.strictEqual(res.statusCode, 200);
  const seeded = storage.data["tenant-registry"][0];
  assert.strictEqual(seeded.isProtected, true);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test api/__tests__/tenants.nodetest.js`
Expected: FAIL — `handler.__setDeps is not a function`.

- [ ] **Step 3: Implement**

In `api/tenants.js`: add `const tenantRegistry = require("../lib/tenantRegistry");` and the `_deps` seam (`{ storage, registry: tenantRegistry }`), replace `storage.` with `_deps.storage.`, delete the local `readRegistry` / `updateRegistryEntry` (use `_deps.registry.readRegistry()` / `_deps.registry.upsertEntry()`), and:

Add `isProtected: true, preboardingEnabled: false` to the seeded entry in `ensureRegistry`, plus a back-fill for existing stores:

```js
async function ensureRegistry() {
  let reg = await _deps.registry.readRegistry();
  if (!reg.length) {
    reg = [
      {
        tenantId: "nium",
        companyName: "Nium",
        createdAt: new Date().toISOString(),
        createdBy: "system",
        lastPublishedAt: null,
        isActive: true,
        isInternal: true,
        isProtected: true,
        preboardingEnabled: true,
        isBlank: false,
      },
    ];
    await _deps.storage.set(REGISTRY_KEY, reg);
    return reg;
  }
  // Back-fill the protection flag for registries written before it existed:
  // isInternal was the old spelling of the same idea.
  const needsBackfill = reg.some((t) => t && t.isProtected === undefined && t.isInternal === true);
  if (needsBackfill) {
    reg = reg.map((t) => (t && t.isProtected === undefined && t.isInternal === true ? { ...t, isProtected: true } : t));
    await _deps.storage.set(REGISTRY_KEY, reg);
  }
  return reg;
}
```

Add `isProtected: false, preboardingEnabled: false` to the entry pushed by the create branch, and add `preboardingUrl` to its response:

```js
      return res.status(200).json({
        success: true,
        tenantId,
        companyName: companyName.trim(),
        adminUrl: `/admin?tenant=${tenantId}`,
        customerUrl: `/?tenant=${tenantId}`,
        preboardingUrl: `/preboarding?tenant=${tenantId}`,
      });
```

Add the new PUT action next to `toggle-status`:

```js
      if (action === "toggle-preboarding") {
        if (!(await _deps.registry.tenantExists(tenantId))) {
          return res.status(404).json({ error: "tenant_not_found" });
        }
        const body = await readBody(req);
        const preboardingEnabled = !!(body && body.preboardingEnabled);
        await _deps.registry.upsertEntry(tenantId, { preboardingEnabled });
        return res.status(200).json({ success: true, preboardingEnabled });
      }
```

Replace the `tenantId === "nium"` check in `toggle-status` with:

```js
      if (action === "toggle-status") {
        if (await _deps.registry.isProtectedTenant(tenantId)) {
          return res.status(400).json({ error: "A protected platform tenant cannot be deactivated." });
        }
```

At the end of the file add the seam:

```js
// Test seam only.
module.exports.__setDeps = (d) => { _deps = { ..._deps, ...d }; };
```

- [ ] **Step 4: Remove the duplicated reader in `api/benchmark.js`**

Delete the local `configKey` / `seedTenant` / `readConfig` block (`api/benchmark.js:75-100`) and require the config module's reader instead:

```js
const { readConfigForTenant } = require("./config");
```

Add that named export at the end of `api/config.js`:

```js
// Shared reader for other server modules (api/benchmark.js, api/research.js).
// Returns null for an unknown tenant — callers decide how to respond.
module.exports.readConfigForTenant = readConfig;
```

Replace `readConfig(tenant)` call sites in `api/benchmark.js` with `readConfigForTenant(tenant)` and handle `null` by returning `404 { error: "tenant_not_found" }`.

- [ ] **Step 5: Run the backend suite**

Run: `npm run test:node`
Expected: PASS (all files).

- [ ] **Step 6: Commit**

```bash
git add api/tenants.js api/benchmark.js api/config.js api/__tests__/tenants.nodetest.js
git commit -m "feat(tenancy): registry-backed tenant flags, pre-boarding toggle, shared config reader"
```

---

## Task 5: Config templates (server)

**Files:**
- Create: `lib/configTemplates.js`, `lib/__tests__/configTemplates.nodetest.js`
- Create: `api/config-templates.js`, `api/__tests__/config-templates.nodetest.js`
- Modify: `lib/seedConfig.js:92-101` (company block)
- Modify: `api/tenants.js` create branch (template id)
- Modify: `src/setupProxy.js`

**Interfaces:**
- Consumes: `lib/seedConfig.js#buildDefaultConfig`, `lib/tenantRegistry.js`.
- Produces:
  - `listTemplates(): Array<{ id, label, description }>` — currently one entry, `id: "nium-default"`.
  - `buildTemplateConfig(id, tenantId): Object|null` — brand-cleared config, `_templateId` stamped.
  - `GET /api/config-templates` → `{ templates: [...] }` (admin-authed).
  - `GET /api/config-templates?id=nium-default&tenant=<id>` → the built config (admin-authed).

- [ ] **Step 1: Write the failing test**

Create `lib/__tests__/configTemplates.nodetest.js`:

```js
const { test } = require("node:test");
const assert = require("node:assert");
const { listTemplates, buildTemplateConfig } = require("../configTemplates");

test("listTemplates exposes the default settings template", () => {
  const ids = listTemplates().map((t) => t.id);
  assert.ok(ids.includes("nium-default"));
  const entry = listTemplates().find((t) => t.id === "nium-default");
  assert.strictEqual(typeof entry.label, "string");
  assert.ok(entry.label.length > 0);
});

test("buildTemplateConfig returns a brand-free config stamped for the tenant", () => {
  const cfg = buildTemplateConfig("nium-default", "acme");
  assert.strictEqual(cfg._tenantId, "acme");
  assert.strictEqual(cfg._templateId, "nium-default");
  assert.strictEqual(cfg.company.name, "");
  assert.strictEqual(cfg.company.manualFormUrl, "");
  assert.ok(cfg.licences.length >= 2, "keeps the reference licences");
  assert.ok(Object.keys(cfg.schemas).length >= 8, "keeps the reference schemas");
  const serialised = JSON.stringify(cfg);
  assert.doesNotMatch(serialised, /nium\.com/i, "no Nium URLs may survive");
});

test("an unknown template id returns null", () => {
  assert.strictEqual(buildTemplateConfig("does-not-exist", "acme"), null);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test lib/__tests__/configTemplates.nodetest.js`
Expected: FAIL — `Cannot find module '../configTemplates'`.

- [ ] **Step 3: Implement `lib/configTemplates.js`**

```js
// Named configuration templates.
//
// A template is reference configuration a tenant can START FROM (at creation,
// via super-admin, or later via the admin "Apply default settings" action).
// Templates live in code, so they cannot be deleted at runtime — that is the
// point: the platform must always have something to seed from.
//
// Brand fields are CLEARED here. The reference data (licences, entity types,
// schemas, source tiers, documents) is generic; the company name and the
// manual application form URL belong to whoever applies the template.
//
// CommonJS so api/ handlers and src/setupProxy.js can require it.

const { buildDefaultConfig } = require("./seedConfig");

const TEMPLATES = [
  {
    id: "nium-default",
    label: "Nium default settings",
    description: "UK + Singapore licences, four entity types and the reference schemas, source tiers and document sets.",
    build: buildDefaultConfig,
  },
];

function listTemplates() {
  return TEMPLATES.map(({ id, label, description }) => ({ id, label, description }));
}

function buildTemplateConfig(templateId, tenantId) {
  const template = TEMPLATES.find((t) => t.id === templateId);
  if (!template) return null;
  const config = template.build(tenantId);
  config._tenantId = tenantId;
  config._templateId = template.id;
  config._isDefault = false;
  config._isBlank = false;
  config.company = {
    ...(config.company || {}),
    name: "",
    logo: null,
    manualFormUrl: "",
  };
  return config;
}

module.exports = { listTemplates, buildTemplateConfig };
```

- [ ] **Step 4: Clear the brand fields at the source**

In `lib/seedConfig.js`, change the `company` block of `buildDefaultConfig` so the seed itself carries no brand:

```js
    company: {
      name: "",
      logo: null,
      manualFormUrl: "",
      privacyPolicyUrl: "",
      submissionWebhookUrl: "",
      submissionEmail: "",
      primaryContactName: "",
      primaryContactEmail: "",
    },
```

- [ ] **Step 5: Run the template test**

Run: `node --test lib/__tests__/configTemplates.nodetest.js`
Expected: PASS.

- [ ] **Step 6: Write the failing endpoint test**

Create `api/__tests__/config-templates.nodetest.js`:

```js
const { test } = require("node:test");
const assert = require("node:assert");
const handler = require("../config-templates");
const registry = require("../../lib/tenantRegistry");

const ADMIN = "test-admin-password";

function fakeStorage(initial) {
  const data = { ...(initial || {}) };
  return {
    data,
    async get(key) { return key in data ? data[key] : null; },
    async set(key, value) { data[key] = value; },
  };
}

function fakeReqRes({ query = {}, headers = {} } = {}) {
  const req = { method: "GET", query, headers, url: "/api/config-templates" };
  const res = {
    statusCode: null, body: null, headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    end() { return this; },
  };
  return { req, res };
}

function withAdmin(t) {
  const prev = process.env.ADMIN_PASSWORD;
  process.env.ADMIN_PASSWORD = ADMIN;
  t.after(() => {
    if (prev === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = prev;
  });
}

test("listing templates requires an admin credential", async (t) => {
  withAdmin(t);
  const storage = fakeStorage({ "tenant-registry": [{ tenantId: "acme", isProtected: true }] });
  handler.__setDeps({ storage });
  registry.__setDeps({ storage });

  const { req, res } = fakeReqRes({ query: { tenant: "acme" } });
  await handler(req, res);
  assert.strictEqual(res.statusCode, 401);
});

test("an authed list returns the template ids", async (t) => {
  withAdmin(t);
  const storage = fakeStorage({ "tenant-registry": [{ tenantId: "acme", isProtected: true }] });
  handler.__setDeps({ storage });
  registry.__setDeps({ storage });

  const { req, res } = fakeReqRes({
    query: { tenant: "acme" },
    headers: { authorization: `Bearer ${ADMIN}` },
  });
  await handler(req, res);

  assert.strictEqual(res.statusCode, 200);
  assert.ok(res.body.templates.some((x) => x.id === "nium-default"));
});

test("?id= builds the template for the requesting tenant", async (t) => {
  withAdmin(t);
  const storage = fakeStorage({ "tenant-registry": [{ tenantId: "acme", isProtected: true }] });
  handler.__setDeps({ storage });
  registry.__setDeps({ storage });

  const { req, res } = fakeReqRes({
    query: { tenant: "acme", id: "nium-default" },
    headers: { authorization: `Bearer ${ADMIN}` },
  });
  await handler(req, res);

  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.config._tenantId, "acme");
  assert.strictEqual(res.body.config.company.name, "");
});

test("an unknown template id is a 404", async (t) => {
  withAdmin(t);
  const storage = fakeStorage({ "tenant-registry": [{ tenantId: "acme", isProtected: true }] });
  handler.__setDeps({ storage });
  registry.__setDeps({ storage });

  const { req, res } = fakeReqRes({
    query: { tenant: "acme", id: "nope" },
    headers: { authorization: `Bearer ${ADMIN}` },
  });
  await handler(req, res);

  assert.strictEqual(res.statusCode, 404);
  assert.deepStrictEqual(res.body, { error: "template_not_found" });
});
```

- [ ] **Step 7: Run to verify it fails**

Run: `node --test api/__tests__/config-templates.nodetest.js`
Expected: FAIL — `Cannot find module '../config-templates'`.

- [ ] **Step 8: Implement `api/config-templates.js`**

```js
// Named configuration templates for the admin "Apply default settings" action
// and for super-admin tenant creation.
//
// GET                       — list available templates (admin-authed)
// GET ?id=<templateId>      — build that template for the resolved tenant
//
// Admin-authed because a template response is configuration shaped: it is not
// secret, but it is not public surface either. CommonJS, mirroring api/config.js.

const storage = require("../lib/storage");
const tenantRegistry = require("../lib/tenantRegistry");
const { getTenantIdFromRequest } = require("../lib/tenant");
const { verifyPassword } = require("../lib/auth");
const { listTemplates, buildTemplateConfig } = require("../lib/configTemplates");

// Injected deps (overridable in tests via __setDeps) — mirrors api/submit.js.
let _deps = { storage, registry: tenantRegistry };

async function authorizeAdmin(tenant, token) {
  if (!token) return false;
  try {
    const stored = await _deps.storage.get(`tenant-auth:${tenant}`);
    if (stored && verifyPassword(token, stored.passwordHash)) return true;
  } catch (_) {}
  if (await _deps.registry.isProtectedTenant(tenant)) {
    const env = process.env.ADMIN_PASSWORD;
    if (env && token === env) return true;
  }
  return false;
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Tenant-Id");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const tenant = getTenantIdFromRequest(req);
  if (!tenant) return res.status(400).json({ error: "tenant_required" });

  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
  if (!(await authorizeAdmin(tenant, token))) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const id = (req.query && req.query.id) || "";
  if (!id) return res.status(200).json({ templates: listTemplates() });

  const config = buildTemplateConfig(id, tenant);
  if (!config) return res.status(404).json({ error: "template_not_found" });
  return res.status(200).json({ templateId: id, config });
};

// Test seam only.
module.exports.__setDeps = (d) => { _deps = { ..._deps, ...d }; };
```

- [ ] **Step 9: Use the template in tenant creation**

In `api/tenants.js`, replace the `startFrom === "nium-defaults"` branch with:

```js
      let config;
      if (startFrom === "nium-defaults" || startFrom === "nium-default") {
        config = buildTemplateConfig("nium-default", tenantId);
      } else {
        config = buildBlankConfig(tenantId);
      }
```

adding `const { buildTemplateConfig } = require("../lib/configTemplates");` to the requires and dropping the now-unused `buildDefaultConfig` import. The existing `config.company = { ...(config.company || {}), name: companyName.trim() }` line stays: it fills the cleared name.

- [ ] **Step 10: Register the route for local dev**

In `src/setupProxy.js`, add next to the other handler requires:

```js
const configTemplatesHandler = require(path.join(__dirname, "..", "api", "config-templates.js"));
```

and next to `app.all("/api/config-versions", ...)`:

```js
  app.get("/api/config-templates", adapt(configTemplatesHandler));
```

- [ ] **Step 11: Run the backend suite**

Run: `npm run test:node`
Expected: PASS.

- [ ] **Step 12: Commit**

```bash
git add lib/configTemplates.js lib/__tests__/configTemplates.nodetest.js api/config-templates.js api/__tests__/config-templates.nodetest.js lib/seedConfig.js api/tenants.js src/setupProxy.js
git commit -m "feat(config): named, brand-free default-settings template with an admin endpoint"
```

---

## Task 6: Remove the drifting client config copies

**Files:**
- Delete: `src/admin/defaultConfig.js`
- Modify: `src/admin/AdminRoot.jsx:4`, `:42-43`
- Modify: `src/config/localDefaultConfig.js:7`, `:17-26`
- Modify: `src/constants/appConstants.js:59-60`
- Modify: `src/__tests__/characterization.pure.test.js:56`, `:136`

**Interfaces:**
- Consumes: `lib/seedConfig.js#buildBlankConfig` semantics (mirrored client-side by the blank fallback below).
- Produces: `buildLocalDefaultConfig()` keeps its signature and schema keys; `company.name` is now `""`; `MANUAL_FORM_URL` no longer exists.

- [ ] **Step 1: Write the failing test**

In `src/__tests__/characterization.pure.test.js`, replace the `MANUAL_FORM_URL` assertion (line 56) with nothing (delete the line and its import), and replace line 136 with:

```js
  expect(cfg.company.name).toBe('');
  expect(cfg.company.manualFormUrl).toBe('');
```

- [ ] **Step 2: Run to verify it fails**

Run: `CI=true npx react-scripts test --watchAll=false src/__tests__/characterization.pure.test.js`
Expected: FAIL — `expected '' but received 'Nium'`.

- [ ] **Step 3: Neutralise the offline fallback**

In `src/config/localDefaultConfig.js`, delete the `MANUAL_FORM_URL` import and change the company block to:

```js
  company: {
    name: "",
    logo: null,
    manualFormUrl: "",
    privacyPolicyUrl: "",
    submissionWebhookUrl: "",
    submissionEmail: "",
    primaryContactName: "",
    primaryContactEmail: "",
  },
```

In `src/constants/appConstants.js`, delete lines 59-60 (`MANUAL_FORM_URL` and its TODO comment).

- [ ] **Step 4: Point AdminRoot at a blank fallback**

In `src/admin/AdminRoot.jsx`, replace the import on line 4 with:

```js
import { buildLocalDefaultConfig } from "../config/localDefaultConfig";
```

and the offline fallback (lines 42-43) with:

```js
      // Offline fallback: a neutral local config so the admin UI still renders.
      // No tenant is special-cased — the live config is the only source of a
      // tenant's real settings, and "Apply default settings" (Step 5) is how a
      // template is pulled in deliberately.
      setTenantConfig({ ...buildLocalDefaultConfig(), _tenantId: tenantId, _isBlank: true });
```

- [ ] **Step 5: Delete the duplicate**

```bash
git rm src/admin/defaultConfig.js
```

- [ ] **Step 6: Verify nothing else imports it**

Run: `npx rg "defaultConfig" src/ --glob '!**/__tests__/**'`
Expected: only `src/config/localDefaultConfig.js` matches (plus the comment in `src/utils/ownershipTypes.js:5`, which should be updated to drop the `src/admin/defaultConfig.js` reference).

- [ ] **Step 7: Run tests and build**

Run: `CI=true npx react-scripts test --watchAll=false src/__tests__/characterization.pure.test.js`
Expected: PASS.
Run: `npm run build`
Expected: compiles with no "module not found" error.

- [ ] **Step 8: Commit**

```bash
git add -A src/admin/defaultConfig.js src/admin/AdminRoot.jsx src/config/localDefaultConfig.js src/constants/appConstants.js src/__tests__/characterization.pure.test.js src/utils/ownershipTypes.js
git commit -m "refactor(config): delete the drifted client default-config copy; neutral offline fallback"
```

---

## Task 7: Admin "Apply default settings"

**Files:**
- Modify: `src/admin/steps/StepPublish.jsx:40-56` (props/state), `:126-175` (actions area)
- Test: `src/admin/steps/__tests__/StepPublish.applyDefaults.test.jsx` (new)

**Interfaces:**
- Consumes: `GET /api/config-templates?id=nium-default&tenant=<id>` (Task 5); `onChange(patch)` — the existing prop the wizard already passes.
- Produces: a button labelled `Apply default settings`; on confirm it fetches the template and calls `onChange(templateConfig)`; nothing is published.

- [ ] **Step 1: Write the failing test**

Create `src/admin/steps/__tests__/StepPublish.applyDefaults.test.jsx`:

```jsx
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import StepPublish from "../StepPublish";

const CONFIG = {
  _version: 2,
  licences: [{ id: "GB", jurisdictionCode: "GB" }],
  entityTypes: [{ id: "Corporate", active: true }],
  schemas: { "Corporate:GB": { researchFields: [{ field: "a" }], gapFields: [] } },
  documents: {},
  company: { name: "Acme" },
};

beforeEach(() => {
  window.history.pushState({}, "", "/admin?tenant=acme");
  global.fetch = jest.fn(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        templateId: "nium-default",
        config: { _templateId: "nium-default", licences: [{ id: "GB" }, { id: "SG" }], entityTypes: [], schemas: {}, company: { name: "" } },
      }),
    })
  );
  window.confirm = jest.fn(() => true);
});

afterEach(() => {
  jest.restoreAllMocks();
  window.history.pushState({}, "", "/");
});

test("Apply default settings loads the template into the draft without publishing", async () => {
  const onChange = jest.fn();
  render(<StepPublish config={CONFIG} onChange={onChange} adminToken="tok" tenantId="acme" />);

  fireEvent.click(screen.getByRole("button", { name: /Apply default settings/i }));

  await waitFor(() => expect(onChange).toHaveBeenCalled());
  const applied = onChange.mock.calls[0][0];
  expect(applied._templateId).toBe("nium-default");
  // The template is fetched, never published: no POST to /api/config.
  const posted = global.fetch.mock.calls.filter(([, opts]) => opts && opts.method === "POST");
  expect(posted).toHaveLength(0);
});

test("declining the confirmation leaves the draft untouched", async () => {
  window.confirm = jest.fn(() => false);
  const onChange = jest.fn();
  render(<StepPublish config={CONFIG} onChange={onChange} adminToken="tok" tenantId="acme" />);

  fireEvent.click(screen.getByRole("button", { name: /Apply default settings/i }));

  expect(onChange).not.toHaveBeenCalled();
  expect(global.fetch).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `CI=true npx react-scripts test --watchAll=false src/admin/steps/__tests__/StepPublish.applyDefaults.test.jsx`
Expected: FAIL — no button named "Apply default settings".

- [ ] **Step 3: Implement**

In `src/admin/steps/StepPublish.jsx`, add state next to the existing `publishError` state:

```js
  const [applyingTemplate, setApplyingTemplate] = useState(false);
  const [templateError, setTemplateError] = useState(null);
```

Add the handler next to `handlePreview`:

```js
  // Load the named default-settings template into the working draft. It is a
  // DRAFT action on purpose: nothing goes live until Publish, and the current
  // live version is already archived by the publish path itself.
  async function handleApplyDefaults() {
    if (!adminToken) return;
    const ok = window.confirm(
      "Replace your unsaved configuration with the default settings template?\n\n" +
      "Your currently published version is not affected until you press Publish."
    );
    if (!ok) return;
    setApplyingTemplate(true);
    setTemplateError(null);
    try {
      const r = await fetch(
        `/api/config-templates?id=nium-default&tenant=${encodeURIComponent(activeTenant)}`,
        { headers: { Authorization: `Bearer ${adminToken}`, "X-Tenant-Id": activeTenant }, cache: "no-store" }
      );
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      if (onChange) onChange(data.config);
    } catch (err) {
      setTemplateError(err.message);
    } finally {
      setApplyingTemplate(false);
    }
  }
```

Add the button immediately after the closing `</button>` of "👁 Preview current changes ↗" (inside the same wrapper `div`):

```jsx
        <button
          type="button"
          onClick={handleApplyDefaults}
          disabled={applyingTemplate || !adminToken}
          title="Loads the default settings template into your draft. Review it, then Publish to make it live."
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            marginLeft: 10,
            padding: "9px 18px",
            background: "#fff",
            color: "#0369A1",
            border: "1px solid #BAE6FD",
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 600,
            cursor: applyingTemplate || !adminToken ? "not-allowed" : "pointer",
            opacity: applyingTemplate || !adminToken ? 0.5 : 1,
            fontFamily: "inherit",
          }}
        >
          {applyingTemplate ? "Applying…" : "⚙ Apply default settings"}
        </button>
        {templateError && (
          <div style={{ marginTop: 8, fontSize: 12, color: adminColors.danger }}>
            Could not load the template: {templateError}
          </div>
        )}
```

- [ ] **Step 4: Run to verify it passes**

Run: `CI=true npx react-scripts test --watchAll=false src/admin/steps/__tests__/StepPublish.applyDefaults.test.jsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/admin/steps/StepPublish.jsx src/admin/steps/__tests__/StepPublish.applyDefaults.test.jsx
git commit -m "feat(admin): Apply default settings loads the template into the draft"
```

---

## Task 8: Admin and super-admin links always carry the tenant

**Files:**
- Modify: `src/admin/AdminDashboard.jsx:169-186`
- Modify: `src/admin/steps/StepPublish.jsx:87-101`, `:114-120`
- Modify: `src/superadmin/components/TenantCard.jsx:7-15`
- Modify: `src/superadmin/components/CredentialsModal.jsx:19-20`
- Test: `src/superadmin/components/__tests__/TenantCard.urls.test.jsx` (new)

**Interfaces:**
- Consumes: nothing new.
- Produces: every admin/customer/preview/pre-boarding URL contains `?tenant=<id>`; `TenantCard` receives `onTogglePreboarding(tenant)` (wired in Task 9).

- [ ] **Step 1: Write the failing test**

Create `src/superadmin/components/__tests__/TenantCard.urls.test.jsx`:

```jsx
import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import TenantCard from "../TenantCard";

const noop = () => {};

test("the platform tenant's URLs still carry ?tenant= (they used to drop it)", () => {
  render(
    <TenantCard
      tenant={{ tenantId: "nium", companyName: "Nium", isInternal: true, isActive: true }}
      onResetPassword={noop}
      onToggleStatus={noop}
      onTogglePreboarding={noop}
    />
  );
  const text = document.body.textContent || "";
  expect(text).toContain("/admin?tenant=nium");
  expect(text).toContain("/?tenant=nium");
});

test("an ordinary tenant's URLs carry its own id", () => {
  render(
    <TenantCard
      tenant={{ tenantId: "acme", companyName: "Acme", isActive: true }}
      onResetPassword={noop}
      onToggleStatus={noop}
      onTogglePreboarding={noop}
    />
  );
  const text = document.body.textContent || "";
  expect(text).toContain("/admin?tenant=acme");
  expect(text).toContain("/?tenant=acme");
  expect(text).not.toContain("tenant=nium");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `CI=true npx react-scripts test --watchAll=false src/superadmin/components/__tests__/TenantCard.urls.test.jsx`
Expected: FAIL — the platform tenant renders `/admin` and `/`.

- [ ] **Step 3: Fix the URLs**

`src/superadmin/components/TenantCard.jsx` — replace the two URL constants:

```js
  // Every URL carries its tenant. Tenant resolution is 3-strict: a bare /admin
  // or / resolves to no tenant at all and lands on the no-tenant screen.
  const adminUrl = `/admin?tenant=${tenant.tenantId}`;
  const customerUrl = `/?tenant=${tenant.tenantId}`;
  const preboardingUrl = `/preboarding?tenant=${tenant.tenantId}`;
```

and add a third `UrlRow` under the existing two:

```jsx
          <UrlRow label="Pre-boarding URL" value={origin + preboardingUrl} />
```

`src/admin/AdminDashboard.jsx` — replace the tenant-param logic in `handlePreview`:

```js
    const tenantParam = tenantId ? `&tenant=${encodeURIComponent(tenantId)}` : "";
    window.open(`/?preview=true${tenantParam}`, "_blank");
```

and the `preview_tenant_id` write:

```js
      sessionStorage.setItem(PREVIEW_TENANT_KEY, tenantId);
```

`src/admin/steps/StepPublish.jsx` — same two changes in its `handlePreview`:

```js
      sessionStorage.setItem("preview_tenant_id", activeTenant);
```

```js
    const tenantParam = activeTenant ? `&tenant=${encodeURIComponent(activeTenant)}` : "";
    window.open(`/?preview=true${tenantParam}`, "_blank");
```

and the "View live flow" button:

```jsx
            onClick={() => window.open(`/?tenant=${encodeURIComponent(activeTenant)}`, "_blank")}
```

`src/superadmin/components/CredentialsModal.jsx` — add the pre-boarding URL beside the existing admin/customer URLs, matching their existing markup:

```js
  const preboardingUrl = `${origin}/preboarding?tenant=${tenantId}`;
```

- [ ] **Step 4: Run to verify it passes**

Run: `CI=true npx react-scripts test --watchAll=false src/superadmin/components/__tests__/TenantCard.urls.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/superadmin/components/TenantCard.jsx src/superadmin/components/CredentialsModal.jsx src/admin/AdminDashboard.jsx src/admin/steps/StepPublish.jsx src/superadmin/components/__tests__/TenantCard.urls.test.jsx
git commit -m "fix(admin): every admin, preview and customer URL carries its tenant"
```

---

## Task 9: Super-admin pre-boarding toggle

**Files:**
- Modify: `src/superadmin/SuperAdminDashboard.jsx:77-96` (handlers), and the `<TenantCard>` render
- Modify: `src/superadmin/components/TenantCard.jsx` (button + badge)
- Modify: `src/superadmin/components/CreateTenantModal.jsx:120-125` (label)
- Test: `src/superadmin/components/__tests__/TenantCard.preboarding.test.jsx` (new)

**Interfaces:**
- Consumes: `PUT /api/tenants?action=toggle-preboarding` (Task 4); `TenantCard` props from Task 8.
- Produces: `onTogglePreboarding(tenant)` called with the tenant row; the card shows "Pre-boarding: On/Off".

- [ ] **Step 1: Write the failing test**

Create `src/superadmin/components/__tests__/TenantCard.preboarding.test.jsx`:

```jsx
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import TenantCard from "../TenantCard";

const noop = () => {};

test("shows pre-boarding state and offers the opposite action", () => {
  const onTogglePreboarding = jest.fn();
  render(
    <TenantCard
      tenant={{ tenantId: "acme", companyName: "Acme", isActive: true, preboardingEnabled: false }}
      onResetPassword={noop}
      onToggleStatus={noop}
      onTogglePreboarding={onTogglePreboarding}
    />
  );

  expect(document.body.textContent).toMatch(/Pre-boarding:\s*Off/i);
  fireEvent.click(screen.getByRole("button", { name: /Enable pre-boarding/i }));
  expect(onTogglePreboarding).toHaveBeenCalledWith(
    expect.objectContaining({ tenantId: "acme" })
  );
});

test("an enabled tenant offers Disable", () => {
  render(
    <TenantCard
      tenant={{ tenantId: "acme", companyName: "Acme", isActive: true, preboardingEnabled: true }}
      onResetPassword={noop}
      onToggleStatus={noop}
      onTogglePreboarding={noop}
    />
  );
  expect(document.body.textContent).toMatch(/Pre-boarding:\s*On/i);
  expect(screen.getByRole("button", { name: /Disable pre-boarding/i })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `CI=true npx react-scripts test --watchAll=false src/superadmin/components/__tests__/TenantCard.preboarding.test.jsx`
Expected: FAIL — no such button.

- [ ] **Step 3: Implement the card changes**

In `src/superadmin/components/TenantCard.jsx`, add `onTogglePreboarding` to the props, add the state line inside the meta row (next to "Created" / "Last published"):

```jsx
            <span>
              Pre-boarding: <strong style={{ color: tenant.preboardingEnabled ? adminColors.statusComplete : adminColors.textMuted }}>
                {tenant.preboardingEnabled ? "On" : "Off"}
              </strong>
            </span>
```

and add the button to the action row:

```jsx
        <button
          type="button"
          onClick={() => onTogglePreboarding(tenant)}
          style={adminStyles.btnGhost}
        >
          {tenant.preboardingEnabled ? "Disable pre-boarding" : "Enable pre-boarding"}
        </button>
```

- [ ] **Step 4: Wire the dashboard**

In `src/superadmin/SuperAdminDashboard.jsx`, add the handler next to `handleToggleStatus`:

```js
  async function handleTogglePreboarding(tenant) {
    const next = !tenant.preboardingEnabled;
    const verb = next ? "Enable" : "Disable";
    if (!window.confirm(`${verb} pre-boarding for ${tenant.companyName || tenant.tenantId}?`)) return;
    try {
      const r = await fetch(
        `/api/tenants?action=toggle-preboarding&tenantId=${encodeURIComponent(tenant.tenantId)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ preboardingEnabled: next }),
        }
      );
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      loadTenants();
    } catch (err) {
      alert("Could not update pre-boarding: " + err.message);
    }
  }
```

and pass it to every `<TenantCard …>` render: `onTogglePreboarding={handleTogglePreboarding}`.

- [ ] **Step 5: Retitle the creation option**

In `src/superadmin/components/CreateTenantModal.jsx`, change the second radio card's title/body:

```jsx
          title="Start from default settings"
          body="UK/SG licences, entity types and reference schemas. Brand details stay blank — the client can modify everything."
```

- [ ] **Step 6: Run the tests**

Run: `CI=true npx react-scripts test --watchAll=false src/superadmin/components/__tests__/`
Expected: PASS (both files).

- [ ] **Step 7: Commit**

```bash
git add src/superadmin/SuperAdminDashboard.jsx src/superadmin/components/TenantCard.jsx src/superadmin/components/CreateTenantModal.jsx src/superadmin/components/__tests__/TenantCard.preboarding.test.jsx
git commit -m "feat(super-admin): per-tenant pre-boarding toggle"
```

---

## Task 10: `api/preboarding-auth.js`

**Files:**
- Create: `api/preboarding-auth.js`, `api/__tests__/preboarding-auth.nodetest.js`
- Modify: `lib/auth.js` (add `verifyEnvBearer`)
- Modify: `src/setupProxy.js`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `lib/tenantRegistry.js` (Task 1), `lib/tenant.js#getTenantIdFromRequest`.
- Produces:
  - `lib/auth.js#verifyEnvBearer(token, envName): boolean` — constant-time; `false` when the env var is unset or the token is empty.
  - `GET /api/preboarding-auth?tenant=<id>` → `200 { available: boolean, reason: string|null, companyName }`; `reason` ∈ `tenant_not_found | tenant_inactive | preboarding_disabled | null`.
  - `POST /api/preboarding-auth?tenant=<id>` body `{ password }` → `200 { success: true, token, tenantId, companyName }` or `400 tenant_required` / `404 tenant_not_found` / `403 tenant_inactive` / `403 preboarding_disabled` / `500 not_configured` / `401 invalid_password`.

- [ ] **Step 1: Add the constant-time helper test**

Append to `lib/__tests__/tenant.nodetest.js`'s sibling — create `lib/__tests__/auth.nodetest.js`:

```js
const { test } = require("node:test");
const assert = require("node:assert");
const { verifyEnvBearer } = require("../auth");

test("verifyEnvBearer is false when the env var is unset", (t) => {
  const prev = process.env.TEST_SECRET_ENV;
  delete process.env.TEST_SECRET_ENV;
  t.after(() => { if (prev !== undefined) process.env.TEST_SECRET_ENV = prev; });
  assert.strictEqual(verifyEnvBearer("anything", "TEST_SECRET_ENV"), false);
});

test("verifyEnvBearer matches only the exact value", (t) => {
  const prev = process.env.TEST_SECRET_ENV;
  process.env.TEST_SECRET_ENV = "s3cret-value";
  t.after(() => {
    if (prev === undefined) delete process.env.TEST_SECRET_ENV;
    else process.env.TEST_SECRET_ENV = prev;
  });
  assert.strictEqual(verifyEnvBearer("s3cret-value", "TEST_SECRET_ENV"), true);
  assert.strictEqual(verifyEnvBearer("s3cret-valu", "TEST_SECRET_ENV"), false);
  assert.strictEqual(verifyEnvBearer("", "TEST_SECRET_ENV"), false);
  assert.strictEqual(verifyEnvBearer(null, "TEST_SECRET_ENV"), false);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test lib/__tests__/auth.nodetest.js`
Expected: FAIL — `verifyEnvBearer is not a function`.

- [ ] **Step 3: Implement `verifyEnvBearer`**

In `lib/auth.js`, add at the top `const crypto = require("node:crypto");` and before `module.exports`:

```js
// Constant-time comparison of a bearer token against an env-var secret.
// Length is compared first because timingSafeEqual throws on length mismatch;
// leaking the length of a shared password is not a meaningful weakness here.
function verifyEnvBearer(token, envName) {
  const expected = process.env[envName];
  if (!expected || typeof token !== "string" || !token) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
```

and export it: `module.exports = { hashPassword, verifyPassword, generatePassword, verifyEnvBearer };`

- [ ] **Step 4: Run to verify it passes**

Run: `node --test lib/__tests__/auth.nodetest.js`
Expected: PASS.

- [ ] **Step 5: Write the failing endpoint test**

Create `api/__tests__/preboarding-auth.nodetest.js`:

```js
const { test } = require("node:test");
const assert = require("node:assert");
const handler = require("../preboarding-auth");
const registry = require("../../lib/tenantRegistry");

const PASSWORD = "test-preboarding-password";

function fakeStorage(initial) {
  const data = { ...(initial || {}) };
  return {
    data,
    async get(key) { return key in data ? data[key] : null; },
    async set(key, value) { data[key] = value; },
  };
}

function fakeReqRes({ method = "POST", query = {}, body = undefined } = {}) {
  const req = { method, query, body, headers: {}, url: "/api/preboarding-auth" };
  const res = {
    statusCode: null, body: null, headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    end() { return this; },
  };
  return { req, res };
}

function withPassword(t, value = PASSWORD) {
  const prev = process.env.PREBOARDING_PASSWORD;
  if (value === null) delete process.env.PREBOARDING_PASSWORD;
  else process.env.PREBOARDING_PASSWORD = value;
  t.after(() => {
    if (prev === undefined) delete process.env.PREBOARDING_PASSWORD;
    else process.env.PREBOARDING_PASSWORD = prev;
  });
}

function storeWith(entry) {
  const storage = fakeStorage({ "tenant-registry": entry ? [entry] : [] });
  handler.__setDeps({ storage });
  registry.__setDeps({ storage });
  return storage;
}

test("no tenant is a 400 before any other work", async (t) => {
  withPassword(t);
  storeWith({ tenantId: "acme", isActive: true, preboardingEnabled: true });
  const { req, res } = fakeReqRes({ body: { password: PASSWORD } });
  await handler(req, res);
  assert.strictEqual(res.statusCode, 400);
  assert.deepStrictEqual(res.body, { error: "tenant_required" });
});

test("an unknown tenant is a 404 — a typo must not reach the password check", async (t) => {
  withPassword(t);
  storeWith({ tenantId: "acme", isActive: true, preboardingEnabled: true });
  const { req, res } = fakeReqRes({ query: { tenant: "acmee" }, body: { password: PASSWORD } });
  await handler(req, res);
  assert.strictEqual(res.statusCode, 404);
  assert.deepStrictEqual(res.body, { error: "tenant_not_found" });
});

test("a deactivated tenant is a 403", async (t) => {
  withPassword(t);
  storeWith({ tenantId: "acme", isActive: false, preboardingEnabled: true });
  const { req, res } = fakeReqRes({ query: { tenant: "acme" }, body: { password: PASSWORD } });
  await handler(req, res);
  assert.strictEqual(res.statusCode, 403);
  assert.deepStrictEqual(res.body, { error: "tenant_inactive" });
});

test("pre-boarding switched off is a 403 even with the right password", async (t) => {
  withPassword(t);
  storeWith({ tenantId: "acme", isActive: true, preboardingEnabled: false });
  const { req, res } = fakeReqRes({ query: { tenant: "acme" }, body: { password: PASSWORD } });
  await handler(req, res);
  assert.strictEqual(res.statusCode, 403);
  assert.deepStrictEqual(res.body, { error: "preboarding_disabled" });
});

test("a missing server password is a 500, not an open door", async (t) => {
  withPassword(t, null);
  storeWith({ tenantId: "acme", isActive: true, preboardingEnabled: true });
  const { req, res } = fakeReqRes({ query: { tenant: "acme" }, body: { password: "anything" } });
  await handler(req, res);
  assert.strictEqual(res.statusCode, 500);
  assert.deepStrictEqual(res.body, { error: "not_configured" });
});

test("a wrong password is a 401", async (t) => {
  withPassword(t);
  storeWith({ tenantId: "acme", isActive: true, preboardingEnabled: true });
  const { req, res } = fakeReqRes({ query: { tenant: "acme" }, body: { password: "wrong" } });
  await handler(req, res);
  assert.strictEqual(res.statusCode, 401);
  assert.deepStrictEqual(res.body, { error: "invalid_password" });
});

test("the right password returns the verified tenant and a bearer token", async (t) => {
  withPassword(t);
  storeWith({ tenantId: "acme", companyName: "Acme Ltd", isActive: true, preboardingEnabled: true });
  const { req, res } = fakeReqRes({ query: { tenant: "acme" }, body: { password: PASSWORD } });
  await handler(req, res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.success, true);
  assert.strictEqual(res.body.tenantId, "acme");
  assert.strictEqual(res.body.companyName, "Acme Ltd");
  assert.strictEqual(res.body.token, PASSWORD);
});

test("GET reports availability without needing a password", async (t) => {
  withPassword(t);
  storeWith({ tenantId: "acme", companyName: "Acme Ltd", isActive: true, preboardingEnabled: false });
  const { req, res } = fakeReqRes({ method: "GET", query: { tenant: "acme" } });
  await handler(req, res);
  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(res.body, { available: false, reason: "preboarding_disabled", companyName: "Acme Ltd" });
});

test("GET for an available tenant reports available:true", async (t) => {
  withPassword(t);
  storeWith({ tenantId: "acme", companyName: "Acme Ltd", isActive: true, preboardingEnabled: true });
  const { req, res } = fakeReqRes({ method: "GET", query: { tenant: "acme" } });
  await handler(req, res);
  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(res.body, { available: true, reason: null, companyName: "Acme Ltd" });
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `node --test api/__tests__/preboarding-auth.nodetest.js`
Expected: FAIL — `Cannot find module '../preboarding-auth'`.

- [ ] **Step 7: Implement `api/preboarding-auth.js`**

```js
// Pre-boarding (analyst) access gate.
//
// Replaces the client-side constant that used to gate the pre-boarding screen
// in the browser. The password is checked HERE, and the response carries the
// tenant the server verified — the client uses that tenant for dossier saves
// and invite links instead of trusting whatever is in the URL.
//
//   GET  /api/preboarding-auth?tenant=<id>  → { available, reason, companyName }
//   POST /api/preboarding-auth?tenant=<id>  { password } → { success, token, tenantId, companyName }
//
// Availability is deliberately readable without a password: the gate needs to
// know which screen to render, and "does this tenant have pre-boarding" is not
// a secret. The password itself is compared in constant time.
//
// One shared PREBOARDING_PASSWORD for now; per-tenant analyst passwords are
// backlog PREB-3.
//
// CommonJS (module.exports) so src/setupProxy.js can require() it for local dev.

const storage = require("../lib/storage");
const tenantRegistry = require("../lib/tenantRegistry");
const { getTenantIdFromRequest } = require("../lib/tenant");
const { verifyEnvBearer } = require("../lib/auth");

// Injected deps (overridable in tests via __setDeps) — mirrors api/submit.js.
let _deps = { storage, registry: tenantRegistry };

function readBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body && typeof req.body === "object") return resolve(req.body);
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

// Why pre-boarding is (un)available for this tenant. null = available.
async function availabilityReason(tenant) {
  if (!(await _deps.registry.tenantExists(tenant))) return "tenant_not_found";
  if (!(await _deps.registry.isTenantActive(tenant))) return "tenant_inactive";
  if (!(await _deps.registry.isPreboardingEnabled(tenant))) return "preboarding_disabled";
  return null;
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Tenant-Id");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const tenant = getTenantIdFromRequest(req);
  if (!tenant) return res.status(400).json({ error: "tenant_required" });

  try {
    const entry = await _deps.registry.findTenant(tenant);
    const companyName = (entry && entry.companyName) || "";
    const reason = await availabilityReason(tenant);

    if (req.method === "GET") {
      return res.status(200).json({ available: reason === null, reason, companyName });
    }

    if (reason === "tenant_not_found") return res.status(404).json({ error: reason });
    if (reason) return res.status(403).json({ error: reason });

    if (!process.env.PREBOARDING_PASSWORD) {
      // eslint-disable-next-line no-console
      console.error("[preboarding-auth] PREBOARDING_PASSWORD is not configured");
      return res.status(500).json({ error: "not_configured" });
    }

    const body = await readBody(req);
    const password = body && typeof body.password === "string" ? body.password : "";
    if (!verifyEnvBearer(password, "PREBOARDING_PASSWORD")) {
      return res.status(401).json({ error: "invalid_password" });
    }

    // The password doubles as the bearer token, mirroring api/admin-auth.js.
    return res.status(200).json({ success: true, token: password, tenantId: tenant, companyName });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("preboarding-auth error", err);
    return res.status(500).json({ error: "Server error", message: err.message });
  }
};

// Test seam only.
module.exports.__setDeps = (d) => { _deps = { ..._deps, ...d }; };
```

- [ ] **Step 8: Register the route and document the env var**

In `src/setupProxy.js` add the require:

```js
const preboardingAuthHandler = require(path.join(__dirname, "..", "api", "preboarding-auth.js"));
```

and next to `app.post("/api/admin-auth", ...)`:

```js
  app.get("/api/preboarding-auth", adapt(preboardingAuthHandler));
  app.post("/api/preboarding-auth", (req, res) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      try { req.body = raw ? JSON.parse(raw) : {}; } catch (_) { req.body = {}; }
      adapt(preboardingAuthHandler)(req, res);
    });
  });
```

In `.env.example`, add:

```
# Pre-boarding (analyst) access password — checked server-side by
# /api/preboarding-auth. Shared across tenants for now; per-tenant analyst
# passwords are tracked as backlog PREB-3.
PREBOARDING_PASSWORD=change-me-preboarding
```

- [ ] **Step 9: Run the backend suite**

Run: `npm run test:node`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add api/preboarding-auth.js api/__tests__/preboarding-auth.nodetest.js lib/auth.js lib/__tests__/auth.nodetest.js src/setupProxy.js .env.example
git commit -m "feat(preboarding): server-checked, tenant-verified pre-boarding gate"
```

---

## Task 11: `/preboarding` route and the server-checked gate

**Files:**
- Modify: `src/index.js:9-55`
- Modify: `vercel.json:15-25`
- Modify: `src/App.js:167` (prop), `:771-779` (resetAll param read), `:4695-4740` (routing block)
- Modify: `src/components/preboarding/PreboardingGate.jsx`
- Create: `src/components/preboarding/PreboardingUnavailable.jsx`
- Modify: `src/components/NoTenantLanding.jsx` (pre-boarding copy variant)
- Modify: `src/components/preboarding/__tests__/Preboarding.render.test.jsx`

**Interfaces:**
- Consumes: `GET`/`POST /api/preboarding-auth` (Task 10).
- Produces:
  - `<KYCAgent preboarding />` renders the analyst flow.
  - `App.js` state `preboardingTenantId` — the tenant returned by the auth response; `buildDossierPayload` and the invite screen use it.
  - `PreboardingGate` props: `{ tenantId, onUnlocked(token, resolvedTenantId), trackEvent }`.
  - `PreboardingUnavailable` props: `{ reason, tenantId }` where `reason ∈ "tenant_not_found" | "tenant_inactive" | "preboarding_disabled"`.

- [ ] **Step 1: Update the existing characterisation test to the new entry**

In `src/components/preboarding/__tests__/Preboarding.render.test.jsx`:

Replace the `beforeEach` pushState line with:

```js
  window.history.pushState({}, "", "/preboarding?tenant=nium");
```

Add the auth stubs to the same `beforeEach`, before `pushState`:

```js
  fetchRoutes["/api/preboarding-auth"] = (url, opts) =>
    Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve(
          opts && opts.method === "POST"
            ? { success: true, token: "ARCH", tenantId: "nium", companyName: "Nium" }
            : { available: true, reason: null, companyName: "Nium" }
        ),
    });
```

Replace `mountAtGate` so it renders the pre-boarding surface:

```js
async function mountAtGate() {
  await act(async () => {
    render(<KYCAgent preboarding />);
  });
  await settle(0);
}
```

Replace `unlock` so a wrong code is rejected by the server stub:

```js
/** Step 2 — the password is checked by /api/preboarding-auth, not the bundle. */
async function unlock(code = "ARCH") {
  fireEvent.change(codeInput(), { target: { value: code } });
  fireEvent.click(buttonsWithText(/Access Pre-boarding Agent/i)[0]);
  await settle(0);
}
```

Replace the "a wrong code does NOT unlock" test body with:

```js
  it("a wrong code does NOT unlock — the server rejects it", async () => {
    await mountAtGate();
    fetchRoutes["/api/preboarding-auth"] = (url, opts) =>
      Promise.resolve(
        opts && opts.method === "POST"
          ? { ok: false, status: 401, json: () => Promise.resolve({ error: "invalid_password" }) }
          : { ok: true, json: () => Promise.resolve({ available: true, reason: null, companyName: "Nium" }) }
      );
    await unlock("WRONG");
    expect(screen.getByPlaceholderText(/Enter access code/i)).toBeInTheDocument();
  });
```

Add two new tests at the end of the "pre-boarding gate" describe:

```js
  it("a tenant with pre-boarding switched off never shows the password form", async () => {
    fetchRoutes["/api/preboarding-auth"] = () =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ available: false, reason: "preboarding_disabled", companyName: "Acme" }),
      });
    await mountAtGate();
    expect(screen.queryByPlaceholderText(/Enter access code/i)).not.toBeInTheDocument();
    expect(bodyText()).toMatch(/not available/i);
  });

  it("an unknown tenant is told so, not gated", async () => {
    fetchRoutes["/api/preboarding-auth"] = () =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ available: false, reason: "tenant_not_found", companyName: "" }),
      });
    await mountAtGate();
    expect(screen.queryByPlaceholderText(/Enter access code/i)).not.toBeInTheDocument();
    expect(bodyText()).toMatch(/don't recognise|not recognised|doesn't exist/i);
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `CI=true npx react-scripts test --watchAll=false src/components/preboarding/__tests__/Preboarding.render.test.jsx`
Expected: FAIL — `KYCAgent` ignores the `preboarding` prop, so the gate never renders.

- [ ] **Step 3: Add the route**

In `src/index.js`, replace the `isPreboarding` const and add a branch before the `/preview` branch:

```js
const search = new URLSearchParams(window.location.search);
// Pre-boarding has its own path (/preboarding?tenant=<id>), mirroring /admin.
// The legacy ?preboarding=1 param is still recognised so old bookmarks work;
// App.js redirects those to the new path.
const isPreboardingPath = path === "/preboarding" || path.startsWith("/preboarding/");
const isPreboarding = isPreboardingPath || search.get("preboarding") === "1";
```

```js
} else if (isPreboardingPath) {
  tree = <KYCAgent preboarding />;
  title = "KYC Onboarding Agent | Pre-boarding";
} else if (path === "/preview" || path.startsWith("/preview/")) {
```

In `vercel.json`, add two rewrites above the catch-all:

```json
    { "source": "/preboarding", "destination": "/index.html" },
    { "source": "/preboarding/(.*)", "destination": "/index.html" },
```

- [ ] **Step 4: Accept the prop, redirect the legacy param, read it once**

In `src/App.js`, change the component signature:

```js
export default function KYCAgent({ previewMode = false, preboarding = false } = {}) {
```

Add near the other early state (just after the `tenantId` line at `:176`):

```js
  // Pre-boarding entry. The path (/preboarding) is the real entry; the legacy
  // ?preboarding=1 param is redirected to it once, on mount, so old bookmarks
  // and emailed links keep working. Read in ONE place — this used to be parsed
  // separately here and inside resetAll.
  const isPreboardingSurface = preboarding;
  useEffect(() => {
    if (typeof window === "undefined" || preboarding) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("preboarding") !== "1") return;
    params.delete("preboarding");
    const qs = params.toString();
    window.location.replace(`/preboarding${qs ? `?${qs}` : ""}`);
  }, [preboarding]);

  // The tenant the SERVER verified at the pre-boarding gate. Dossier saves and
  // invite links use this, never the raw URL value.
  const [preboardingTenantId, setPreboardingTenantId] = useState("");
```

In `resetAll`, replace the `preboardingParam` block with:

```js
    setAgentType(isPreboardingSurface ? "preboarding" : "onboarding");
```

In the routing block, replace the `preboardingParam` const and the `agentType === null` branch with:

```js
  if (agentType === null) {
    setAgentType(isPreboardingSurface ? "preboarding" : "onboarding");
    return null;
  }
```

and the gate render with:

```js
  if (agentType === "preboarding" && !preboardingUnlocked) {
    return (
      <PreboardingGate
        tenantId={tenantId}
        onUnlocked={(token, resolvedTenantId) => {
          setPreboardingToken(token);
          setPreboardingTenantId(resolvedTenantId || tenantId);
          setPreboardingUnlocked(true);
          setStep(0);
          setError("");
        }}
        trackEvent={trackEvent}
      />
    );
  }
```

Add `const [preboardingToken, setPreboardingToken] = useState("");` beside `preboardingTenantId`, and delete the now-unused `PREBOARDING_PASSWORD` constant (`:287`) plus the `preboardingPassword` / `preboardingPasswordError` state and their `resetAll` lines.

In `buildDossierPayload`, replace `tenantId,` with:

```js
      // Pre-boarding uses the tenant the server verified at the gate; the
      // customer flow has no gate, so it uses the URL-resolved tenant.
      tenantId: preboardingTenantId || tenantId,
```

- [ ] **Step 5: Rewrite the gate**

Replace the body of `src/components/preboarding/PreboardingGate.jsx` (keeping its existing markup and styles) with a version that talks to the server. The header comment becomes:

```jsx
/**
 * PreboardingGate.jsx — the analyst access gate, screen 1 of pre-boarding.
 *
 * The password is checked by the SERVER (POST /api/preboarding-auth). It used
 * to be compared in the browser against a constant in the bundle, which gated
 * the screen but not the data. The gate also asks the server whether
 * pre-boarding is available for this tenant at all (GET) so an unknown,
 * deactivated or switched-off tenant sees an explanation instead of a password
 * box it could never satisfy.
 *
 * On success the server returns the tenant IT verified; the caller stores that
 * and uses it for dossier saves and invite links.
 */
```

Component:

```jsx
export function PreboardingGate({ tenantId, onUnlocked, trackEvent }) {
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [availability, setAvailability] = React.useState(null); // null = loading

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/preboarding-auth?tenant=${encodeURIComponent(tenantId)}`, { cache: "no-store" });
        const data = await r.json();
        if (!cancelled) setAvailability(data);
      } catch (_) {
        if (!cancelled) setAvailability({ available: false, reason: "tenant_not_found", companyName: "" });
      }
    })();
    return () => { cancelled = true; };
  }, [tenantId]);

  async function handlePasswordSubmit() {
    if (!password || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const r = await fetch(`/api/preboarding-auth?tenant=${encodeURIComponent(tenantId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Tenant-Id": tenantId },
        body: JSON.stringify({ password }),
      });
      const data = await r.json();
      if (!r.ok || !data.success) {
        trackEvent("preboarding_password_failed", { attemptedAt: new Date().toISOString() });
        setError("Incorrect access code. Please try again.");
        setPassword("");
        setSubmitting(false);
        return;
      }
      trackEvent("preboarding_password_correct", { unlockedAt: new Date().toISOString() });
      onUnlocked(data.token, data.tenantId);
    } catch (err) {
      setError("Couldn't reach the server. Check your connection and try again.");
      setSubmitting(false);
    }
  }

  if (availability === null) return null;              // brief: the probe is one request
  if (!availability.available) {
    return <PreboardingUnavailable reason={availability.reason} tenantId={tenantId} />;
  }
  // …existing card markup, with `value={password}`, `onChange` setting password
  // and clearing error, the error paragraph driven by `error`, and the submit
  // button disabled while `submitting`…
}
```

- [ ] **Step 6: Add the unavailable screen**

Create `src/components/preboarding/PreboardingUnavailable.jsx`:

```jsx
/**
 * PreboardingUnavailable.jsx — shown instead of the access gate when the
 * server says pre-boarding isn't available for this tenant. Three reasons, all
 * answered by the server so the browser never has to guess:
 *   tenant_not_found      — the tenant id in the URL isn't registered
 *   tenant_inactive       — the tenant exists but is deactivated
 *   preboarding_disabled  — pre-boarding is switched off for this tenant
 *
 * Deliberately says nothing about which tenants DO exist: this is a public,
 * unauthenticated surface.
 */

import React from "react";
import { C } from "../../constants/theme";

const MESSAGES = {
  tenant_not_found: {
    title: "We don't recognise this address",
    body: "The tenant in this link doesn't exist. Check the link with whoever sent it to you.",
  },
  tenant_inactive: {
    title: "This tenant is not active",
    body: "Pre-boarding is unavailable while the tenant is deactivated. Contact your platform administrator.",
  },
  preboarding_disabled: {
    title: "Pre-boarding is not available for this tenant",
    body: "Pre-boarding hasn't been switched on here. Your platform administrator can enable it.",
  },
};

export function PreboardingUnavailable({ reason, tenantId }) {
  const copy = MESSAGES[reason] || MESSAGES.tenant_not_found;
  return (
    <div style={{
      minHeight: "100vh", background: C.background, display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", padding: "40px 20px",
      fontFamily: "'DM Sans','Segoe UI',system-ui,sans-serif", color: C.text,
    }}>
      <div style={{
        width: "100%", maxWidth: 420, background: C.surface, borderRadius: 16,
        padding: "40px 36px", border: `1px solid ${C.border}`,
        boxShadow: "0 8px 32px rgba(0,0,0,0.06)", textAlign: "center",
      }}>
        <div style={{ fontSize: 40, marginBottom: 20 }}>🚫</div>
        <h2 style={{ fontSize: 20, fontWeight: 800, margin: "0 0 8px 0" }}>{copy.title}</h2>
        <p style={{ fontSize: 14, color: C.textSec, lineHeight: 1.6, margin: 0 }}>{copy.body}</p>
        {tenantId && (
          <div style={{ marginTop: 18, fontSize: 11, color: C.textMuted, fontFamily: "monospace" }}>
            tenant: {tenantId}
          </div>
        )}
      </div>
    </div>
  );
}
```

Import it in `PreboardingGate.jsx`: `import { PreboardingUnavailable } from "./PreboardingUnavailable";`

- [ ] **Step 7: Handle `/preboarding` with no tenant at all**

`src/App.js:4297` already returns `<NoTenantLanding />` when `tenantId` is empty, and that guard runs before the pre-boarding routing block — so `/preboarding` with no `?tenant=` lands there. Give it pre-boarding copy so the analyst is told what to add:

In `src/App.js`, change that guard to:

```js
  if (!tenantId) {
    return <NoTenantLanding surface={isPreboardingSurface ? "preboarding" : "onboarding"} />;
  }
```

In `src/components/NoTenantLanding.jsx`, accept the prop and swap the two copy strings (everything else stays):

```jsx
export default function NoTenantLanding({ surface = "onboarding" }) {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const isPreboarding = surface === "preboarding";
  const exampleUrl = isPreboarding ? `${origin}/preboarding?tenant=acme` : `${origin}/?tenant=acme`;
  const heading = isPreboarding ? "No tenant selected" : "No tenant selected";
  const explainer = isPreboarding
    ? "Pre-boarding runs per organization, each with its own configuration. A tenant must be specified in the URL before the analyst flow can start."
    : "This page serves multiple organizations, each with its own configuration. A tenant must be specified in the URL before onboarding can start.";
```

then use `{heading}` in the `<h1>` and `{explainer}` in the `<p>` beneath it.

Add to `src/components/preboarding/__tests__/Preboarding.render.test.jsx`:

```js
  it("/preboarding with no tenant explains what to add instead of gating", async () => {
    window.history.pushState({}, "", "/preboarding");
    await act(async () => { render(<KYCAgent preboarding />); });
    await settle(0);
    expect(screen.queryByPlaceholderText(/Enter access code/i)).not.toBeInTheDocument();
    expect(bodyText()).toMatch(/No tenant selected/i);
    expect(bodyText()).toMatch(/analyst flow/i);
  });
```

- [ ] **Step 8: Run the suite**

Run: `CI=true npx react-scripts test --watchAll=false src/components/preboarding/__tests__/Preboarding.render.test.jsx src/__tests__/noTenantLanding.integration.test.jsx`
Expected: PASS (all tests, including the two new availability tests and the no-tenant test). The existing no-tenant integration suite must stay green — `surface` defaults to `"onboarding"`, so its copy is unchanged.

- [ ] **Step 9: Verify the build**

Run: `npm run build`
Expected: compiles; no reference to `PREBOARDING_PASSWORD` remains in `src/` (`npx rg "PREBOARDING_PASSWORD" src/` returns nothing).

- [ ] **Step 10: Commit**

```bash
git add src/index.js vercel.json src/App.js src/components/preboarding/PreboardingGate.jsx src/components/preboarding/PreboardingUnavailable.jsx src/components/NoTenantLanding.jsx src/components/preboarding/__tests__/Preboarding.render.test.jsx
git commit -m "feat(preboarding): /preboarding route with a server-checked, tenant-bound gate"
```

---

## Task 12: Tenant- and flow-scoped drafts

**Files:**
- Modify: `src/utils/submissionDraft.js`
- Modify: `src/App.js:815-862` (save + resume offer)
- Test: `src/utils/__tests__/submissionDraft.test.js`

**Interfaces:**
- Consumes: `tenantId`, `agentType` from `src/App.js`.
- Produces:
  - `saveDraft(state, { tenantId, agentType })` — stores `{ savedAt, tenantId, agentType, state }`.
  - `loadDraft({ tenantId, agentType })` — returns the draft only when both match; `null` otherwise (including legacy drafts with no recorded tenant).
  - `clearDraft()` unchanged.

- [ ] **Step 1: Write the failing test**

Append to `src/utils/__tests__/submissionDraft.test.js`:

```js
import { saveDraft, loadDraft, clearDraft } from '../submissionDraft';

describe('draft scoping', () => {
  afterEach(() => clearDraft());

  test('a draft is returned for the same tenant and flow', () => {
    saveDraft({ companyName: 'Acme' }, { tenantId: 'acme', agentType: 'onboarding' });
    const d = loadDraft({ tenantId: 'acme', agentType: 'onboarding' });
    expect(d.state.companyName).toBe('Acme');
  });

  test('a draft from another tenant is never offered', () => {
    saveDraft({ companyName: 'Acme' }, { tenantId: 'acme', agentType: 'onboarding' });
    expect(loadDraft({ tenantId: 'other', agentType: 'onboarding' })).toBeNull();
  });

  test('an analyst draft is not offered in the customer flow', () => {
    saveDraft({ companyName: 'Acme' }, { tenantId: 'acme', agentType: 'preboarding' });
    expect(loadDraft({ tenantId: 'acme', agentType: 'onboarding' })).toBeNull();
  });

  test('a legacy draft with no recorded tenant is ignored', () => {
    localStorage.setItem('kyc_draft_v1', JSON.stringify({ savedAt: '2026-01-01T00:00:00.000Z', state: { companyName: 'Old' } }));
    expect(loadDraft({ tenantId: 'acme', agentType: 'onboarding' })).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `CI=true npx react-scripts test --watchAll=false src/utils/__tests__/submissionDraft.test.js`
Expected: FAIL — cross-tenant load returns the draft.

- [ ] **Step 3: Implement**

Replace `saveDraft` / `loadDraft` in `src/utils/submissionDraft.js`:

```js
// The draft is scoped to ONE tenant and ONE flow. A single global slot used to
// offer tenant A's half-finished application under tenant B (restoring its
// dossierId, which then saved into the wrong tenant), and offered a customer
// draft inside the analyst flow. A draft that doesn't match both is ignored.
export function saveDraft(state, scope) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      savedAt: new Date().toISOString(),
      tenantId: (scope && scope.tenantId) || "",
      agentType: (scope && scope.agentType) || "",
      state,
    }));
  } catch (_) { /* quota/serialization — ignore, draft is a convenience not a guarantee */ }
}

export function loadDraft(scope) {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !parsed.state) return null;
    const wantTenant = (scope && scope.tenantId) || "";
    const wantAgent = (scope && scope.agentType) || "";
    // Legacy drafts (written before scoping) carry no tenant — ignore them
    // rather than guess which tenant they belonged to.
    if (!parsed.tenantId || parsed.tenantId !== wantTenant) return null;
    if (parsed.agentType !== wantAgent) return null;
    return parsed;
  } catch (_) { return null; }
}
```

In `src/App.js`, pass the scope at both call sites:

```js
      saveDraft({
        // …unchanged payload…
      }, { tenantId, agentType });
```

```js
  useEffect(() => {
    if (!tenantId || !agentType) return;
    const d = loadDraft({ tenantId, agentType });
    if (d && d.state && (d.state.companyName || d.state.research)) setResumeOffer(d);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, agentType]);
```

- [ ] **Step 4: Run to verify it passes**

Run: `CI=true npx react-scripts test --watchAll=false src/utils/__tests__/submissionDraft.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/submissionDraft.js src/App.js src/utils/__tests__/submissionDraft.test.js
git commit -m "fix(draft): scope the resume draft to its tenant and flow"
```

---

## Task 13: De-Nium the customer-visible surfaces

**Files:**
- Modify: `api/invite.js:151-168`
- Modify: `src/components/preboarding/InviteScreen.jsx:80-93`, `:245`
- Modify: `src/components/companyLookup/JourneyPicker.jsx:183-202`
- Modify: `src/App.js:4306`, and the `<JourneyPicker>` render
- Modify: `src/components/Step2DynamicForm.jsx:168`, `:187`, `:216`, `:375`
- Modify: `lib/seedSchemas.js:192`, `:246`; `src/pipeline.js:363`, `:403`
- Test: `api/__tests__/invite.nodetest.js` (extend), `src/components/companyLookup/__tests__/JourneyPicker.cardC.test.jsx` (new)

**Interfaces:**
- Consumes: `lib/configTemplates.js` (Task 5), `api/config.js#readConfigForTenant` (Task 4).
- Produces: `api/invite.js` resolves `companyName` server-side from the tenant config (falling back to the tenant id); `JourneyPicker` gains a `manualFormUrl` prop and hides Card C when it is empty; `Step2DynamicForm` gains a `brandName` prop.

- [ ] **Step 1: Write the failing test for the email**

Append to `api/__tests__/invite.nodetest.js`:

```js
test("the email uses the tenant's own company name, not a hardcoded brand", async (t) => {
  const handler = require("../invite");
  const prevKey = process.env.RESEND_API_KEY;
  delete process.env.RESEND_API_KEY;
  const store = fakeStore();
  handler.__setDeps({
    store,
    readConfigForTenant: async () => ({ company: { name: "Acme Payments" } }),
  });
  try {
    const res = fakeRes();
    await handler(reqWith({ ...basePayload, tenantId: "acme" }), res);

    assert.strictEqual(res.statusCode, 200);
    assert.match(res.body.subject, /Acme Payments/);
    assert.doesNotMatch(res.body.subject, /Nium/i);
    assert.doesNotMatch(res.body.body, /Nium/i);
  } finally {
    if (prevKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = prevKey;
  }
});

test("a tenant with no configured company name falls back to its tenant id", async (t) => {
  const handler = require("../invite");
  const prevKey = process.env.RESEND_API_KEY;
  delete process.env.RESEND_API_KEY;
  handler.__setDeps({ store: fakeStore(), readConfigForTenant: async () => ({ company: {} }) });
  try {
    const res = fakeRes();
    await handler(reqWith({ ...basePayload, tenantId: "acme" }), res);
    assert.match(res.body.subject, /acme/);
    assert.doesNotMatch(res.body.subject, /Nium/i);
  } finally {
    if (prevKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = prevKey;
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test api/__tests__/invite.nodetest.js`
Expected: FAIL — `res.body.subject` is undefined and the text still says "Nium".

- [ ] **Step 3: Implement the email change**

In `api/invite.js`, add to the deps seam: `const { readConfigForTenant } = require("./config");` and `let _deps = { store, sendEmail, readConfigForTenant };`

Before building the subject:

```js
  // Brand comes from the tenant's own configuration. It used to be hardcoded,
  // so every tenant's customers received a Nium-branded email.
  let brandName = tenantId;
  try {
    const cfg = await _deps.readConfigForTenant(tenantId);
    const configured = cfg && cfg.company && cfg.company.name;
    if (typeof configured === "string" && configured.trim()) brandName = configured.trim();
  } catch (_) { /* fall back to the tenant id */ }
```

Replace the subject/body/sender:

```js
  const subject = `Your ${brandName} onboarding is ready${companyName ? ` — ${companyName}` : ""}`;
  const text = `Dear ${contactName},

Thank you for your interest in ${brandName}. We have begun reviewing your application${companyName ? ` for ${companyName}` : ""} and are ready to proceed with the next step.

Please complete your onboarding by clicking the link below:

${link}

This link is unique to your application. Once you click it, you will be guided through a short onboarding form. The process typically takes 10–15 minutes.

If you have any questions, please do not hesitate to reach out to your ${brandName} contact.

Best regards,
${brandName} Onboarding Team`;

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.INVITE_FROM_EMAIL || `${brandName} Onboarding <onboarding@resend.dev>`;
```

Add `subject` and `body: text` to all four response payloads (simulate, success, and both 502 paths) so the client can render exactly what was sent and the tests can assert on it.

- [ ] **Step 4: Mirror it in the invite preview**

In `src/components/preboarding/InviteScreen.jsx`, add a `brandName` prop (passed from `src/App.js` as `tenantConfig?.company?.name || tenantId`), and replace the three "Nium" occurrences in `emailBody` and the subject preview with `${brandName}`.

- [ ] **Step 5: Write the failing Card C test**

Create `src/components/companyLookup/__tests__/JourneyPicker.cardC.test.jsx`:

```jsx
import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { JourneyPicker } from "../JourneyPicker";

const base = {
  selectedJourneyCard: null,
  setSelectedJourneyCard: () => {},
  setError: () => {},
  searchAttempts: 0,
  demoMode: false,
};

test("Card C is hidden when the tenant configured no manual form URL", () => {
  render(<JourneyPicker {...base} manualFormUrl="" />);
  expect(screen.queryByText(/I'll complete the form myself/i)).not.toBeInTheDocument();
});

test("Card C renders when the tenant configured one", () => {
  render(<JourneyPicker {...base} manualFormUrl="https://acme.example/apply" />);
  expect(screen.getByText(/I'll complete the form myself/i)).toBeInTheDocument();
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `CI=true npx react-scripts test --watchAll=false src/components/companyLookup/__tests__/JourneyPicker.cardC.test.jsx`
Expected: FAIL — Card C renders unconditionally.

- [ ] **Step 7: Implement**

In `src/components/companyLookup/JourneyPicker.jsx`, add `manualFormUrl` to the props and wrap the Card C block:

```jsx
        {/* Card C — only when the tenant configured its own manual application
            form. There is no platform-wide fallback: a link to someone else's
            form is worse than no card at all. */}
        {manualFormUrl ? (() => {
          // …existing Card C body…
        })() : null}
```

In `src/App.js` line 4306:

```js
  const manualFormUrl_ = tenantConfig?.company?.manualFormUrl || "";
```

and pass `manualFormUrl={manualFormUrl_}` to `<JourneyPicker …>`.

In `src/components/Step2DynamicForm.jsx`, add a `brandName` prop (default `"we"` is wrong for the possessive cases, so default to `""` and guard), and replace the four strings:

- `:168` → `<span style={styles.autoBadge}>{brandName ? `${brandName}-sourced` : "Auto-sourced"}</span>`
- `:187` → `{brandName ? `${brandName} retrieves this automatically.` : "We retrieve this automatically."}{' '}`
- `:216` → `As a Financial Institution, {brandName || "we"} require{brandName ? "s" : ""} a completed Correspondent Banking Due Diligence Questionnaire (CBDDQ).`
- `:375` → `<span>Requirements for <strong>{companyName}</strong>{onboardingCountry ? <> - onboarding via <strong>{brandName ? `${brandName} ${onboardingCountry}` : onboardingCountry}</strong></> : null}</span>`

Pass `brandName={companyName_}` from `src/App.js` where `<Step2DynamicForm …>` is rendered.

In `lib/seedSchemas.js` and `src/pipeline.js`, replace the two FI labels in both files (they must stay identical):

- `"Will you fund your Nium account from outside your incorporated country?"` → `"Will you fund your account from outside your incorporated country?"`
- `"Please describe how Nium's products will be used"` → `"Please describe how our products will be used"`

- [ ] **Step 8: Run the tests**

Run: `node --test api/__tests__/invite.nodetest.js`
Expected: PASS.
Run: `CI=true npx react-scripts test --watchAll=false src/components/companyLookup/__tests__/JourneyPicker.cardC.test.jsx`
Expected: PASS.

- [ ] **Step 9: Verify no customer-facing brand strings remain**

Run: `npx rg -i "nium" src/components src/App.js api/invite.js lib/seedSchemas.js`
Expected: only internal identifiers (`nium_api`, `niumRegNumber`, `niumBlue`, `nium_invite_`, the Nium API journey block) — all tracked by backlog BRAND-1. No customer-visible sentence, email text or URL.

- [ ] **Step 10: Commit**

```bash
git add api/invite.js src/components/preboarding/InviteScreen.jsx src/components/companyLookup/JourneyPicker.jsx src/components/Step2DynamicForm.jsx src/App.js lib/seedSchemas.js src/pipeline.js api/__tests__/invite.nodetest.js src/components/companyLookup/__tests__/JourneyPicker.cardC.test.jsx
git commit -m "fix(brand): customer-facing copy, emails and the manual-form link follow the tenant"
```

---

## Task 14: Full verification and documentation

**Files:**
- Modify: `CLAUDE.md` (Multi-Tenant URLs section)
- Modify: `docs/BACKLOG.md` (mark what this part closed)

- [ ] **Step 1: Run the whole backend suite**

Run: `npm run test:node`
Expected: PASS, no failures.

- [ ] **Step 2: Run the whole frontend suite**

Run: `CI=true npx react-scripts test --watchAll=false`
Expected: PASS except the known flaky suites; re-run any failure in isolation (`CI=true npx react-scripts test --watchAll=false <path>`) and only treat it as a regression if it fails alone.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: "Compiled successfully" (warnings acceptable).

- [ ] **Step 4: Update `CLAUDE.md`**

In the **Multi-Tenant URLs** section, replace the resolution list and table with:

```markdown
The active tenant is resolved per request, with this priority:

1. `?tenant=` URL query parameter (browser) / `req.query.tenant` (server)
2. `x-tenant-id` request header
3. none — a request that names no tenant is refused (`tenant_required`). There
   is no `TENANT_ID` env fallback and no `"nium"` default.

### URLs

| Surface          | URL                                  |
| ---------------- | ------------------------------------ |
| Customer flow    | `/?tenant={tenantId}`                |
| Admin            | `/admin?tenant={tenantId}`           |
| Pre-boarding     | `/preboarding?tenant={tenantId}`     |
| Super admin      | `/super-admin`                       |

Pre-boarding requires the tenant to exist, be active, and have pre-boarding
switched on (super-admin toggle, stored on the tenant registry entry). The
legacy `/?tenant={id}&preboarding=1` URL redirects to `/preboarding`.
```

Add under **Nium protection**:

```markdown
- Protection is driven by `isProtected` on the tenant registry entry (back-filled
  from the legacy `isInternal`), not by the literal id `"nium"`. A protected
  tenant cannot be deleted, cannot be published or rolled back into an empty
  config, and self-heals from the `nium-default` template (archiving the broken
  config first).
- Default settings are a named template (`lib/configTemplates.js`), exposed by
  `GET /api/config-templates` and applied from the admin publish step. Templates
  live in code and cannot be deleted at runtime.
```

- [ ] **Step 5: Update the backlog**

In `docs/BACKLOG.md`, append to `PREB-3` (per-tenant analyst password): `- **Status note (2026-09-16):** the tenant-scoped entry, registry checks and server-side gate shipped in Part 5; only the per-tenant password remains.`

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md docs/BACKLOG.md
git commit -m "docs: tenant-scoped pre-boarding URLs, protected-tenant rules and default-settings template"
```

---

## Manual QA checklist (owner, after the branch is merged to a preview deploy)

1. `/preboarding?tenant=nium` → password screen → correct password → company lookup.
2. `/preboarding?tenant=<typo>` → "We don't recognise this address".
3. Super admin → Acme → "Enable pre-boarding" → `/preboarding?tenant=acme` now shows the password screen; disable it again → the unavailable screen returns.
4. `/?tenant=nium&preboarding=1` → redirects to `/preboarding?tenant=nium`.
5. Admin (any tenant) → Preview → the preview tab shows that tenant's flow, not the no-tenant screen.
6. Super admin → tenant card → Open Admin / Open Flow / Pre-boarding URL all open the right tenant.
7. Admin → Publish step → "Apply default settings" → draft fills → Publish → settings live; Version history shows the previous version.
8. Send an invite as a non-Nium tenant → the email preview and the email itself name that tenant, not Nium.
9. A tenant with no manual-form URL → the journey screen shows no "I'll complete the form myself" card.
10. Start an application as tenant A, refresh, then open tenant B → no resume banner offering A's draft.
