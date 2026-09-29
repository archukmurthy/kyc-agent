# Part 3 — Customer Correction → Re-research Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a customer marks one of the five foundational facts wrong, they type the right value on the same page; entity type alone re-derives the schema, anything else re-runs research with the corrected values (spending one of two server-counted re-searches), every dossier overwrite is snapshotted, and nothing is reset.

**Architecture:** A pure decision module (`src/reresearch/correctionPlan.js`) turns "current facts + corrections" into `re_derive` / `re_search`. The server owns the retry count (`entity_dossiers.customer_searches` for link customers, `lib/storage.js` for fresh customers) and snapshots every dossier row into an append-only `entity_dossier_versions` table before overwriting it. In `src/App.js`, `doResearch` and `saveDossier` accept explicit overrides so a correction never reads stale state, and a new `applyCorrections` handler drives the flow from the Applicant page's facts gate.

**Tech Stack:** Node 24 CommonJS (`api/`, `lib/`), CRA React 18 (`src/`), Neon Postgres (`@neondatabase/serverless`, `pg` pool in `api/lib/neonPool.js`), `lib/storage.js`, `node --test`, Jest + Testing Library.

## Global Constraints

- **CommonJS in `api/` and `lib/`** (`module.exports` / `require`), so `src/setupProxy.js` can mount the same handlers for `npm start`.
- **Every new/changed handler is registered in `src/setupProxy.js`.**
- **Tests:** backend → `*.nodetest.js` with injected fakes (`__setDeps`), run by `npm run test:node`; frontend → jest render tests asserting real DOM behaviour. Every new node test file must be reachable from the `test:node` glob.
- **Migrations** are additive and idempotent (`IF NOT EXISTS`), applied with `node db/apply.js db/migrations/<file>.sql`. Part 1 used **026**; this part uses **027**.
- **No new runtime dependency.**
- **Tenant resolution stays 3-strict**: no `"nium"` fallback anywhere, client or server.
- **Inline styles only** in React; match the surrounding file's conventions.
- **Refs, not state, for gap/stakeholder form values** (`gapRef`, `stakeholdersRef`) — do not lift to `useState`. Hooks in `src/App.js` are never conditional; new `useState` calls are added unconditionally next to related state.
- **Never call a real paid API in tests.**
- **Decision rule (spec §6.1):** entity type only → re-derive (no search, no retry). Anything else (company name, country, registration number, ownership type, or a mix) → full re-search, one retry consumed.
- **Customer gets 2 re-searches**; the analyst's original search does not count.
- **Every dossier version is snapshotted** before it is overwritten.
- **Same flow for fresh (no-link) customers**; their retry count is keyed by application id in storage (`research-attempts:<applicationId>`, 30-day TTL).
- **Submissions record their source dossier.**
- **Analyst becomes read-only once the customer has changed anything.**
- **Cap copy:** `CONTACT_ADMIN_MSG` from `src/reresearch/searchPolicy.js`.

### Refinements over the spec (controller decisions, binding)

1. **Migration 027**, not 026. `owned_by` and `last_customer_action_at` already exist (Part 1, migration 026). 027 adds `customer_searches`, `entity_dossier_versions` and `onboarding_sessions.dossier_id`.
2. **The server snapshots on every UPDATE** of an existing dossier, whoever writes it — no client `snapshot` flag. `created_by` is the verified actor kind; `reason` comes from a whitelisted body `saveReason` (`customer_correction` | `analyst_update` | `customer_update`), defaulting by actor kind. A snapshot is skipped when the ownership re-check would refuse the write.
3. **The snapshot happens at the post-research save**, not before research: nothing is overwritten until that save, so the analyst's original is still intact if research fails.
4. **`POST /api/search-attempt` is customer-only** (an analyst never consumes the customer's retries → `403 forbidden`). The atomic increment refuses a third search and also flips `owned_by` to `'customer'` (consuming a search is a customer action). `GET` stays readable by both. Both **fail closed** on a DB error (`allowed: false`).
5. **`POST /api/research-attempt`** (fresh customers) requires a UUID `applicationId`, is unauthenticated, and fails closed on a storage error. `/api/research` itself does not check the count (bounded by Part 2's rate limit) — backlog note in Task 9.
6. **`/api/submit` only links a dossier for a verified customer credential** whose token names that dossier in that tenant; otherwise `dossierId` is dropped before the payload is queued. The ownership flip happens inside `finalizeSubmission`'s transaction.
7. **The "genuinely changed" forks stay.** Their "You got it wrong" buttons (`ownership-misclassified`, `regnumber-misclassified`) now open an inline correction input instead of resetting. `facts-reset-confirm` and its panel are removed.
8. **The `INSERT INTO tenants` upsert in `api/save-dossier.js` stays** (Part 1 decision: the registry and the Postgres `tenants` table are different stores).
9. **In demo mode a re-search correction does not call the paid API**: it updates the facts and keeps the existing (dummy) research, with a `ponytail:` comment.

---

## File structure

| File | Responsibility |
|---|---|
| `db/migrations/027_customer_corrections.sql` (new) | `customer_searches`, `entity_dossier_versions`, `onboarding_sessions.dossier_id` |
| `src/reresearch/correctionPlan.js` (new) | Pure: current facts + corrections → `{ action, changed, next }` |
| `api/search-attempt.js` | Customer re-search counter on `customer_searches` (cap 2) |
| `api/research-attempt.js` (new) | Fresh-customer counter in `lib/storage.js` (cap 2) |
| `api/save-dossier.js`, `api/get-dossier.js` | Snapshot before every update; stop writing `search_attempts`; return `customer_searches` |
| `api/submit.js`, `api/lib/finalizeSubmission.js` | Verified dossier link on submissions; ownership flip |
| `src/components/companyConfirm/FoundationalFactsGate.jsx` | Inline correction inputs + "Update my details" |
| `src/components/applicant/ApplicantPage.jsx` | Passes edit values, option lists and correction callbacks to the gate |
| `src/App.js` | `doResearch`/`saveDossier` overrides, `applyCorrections`, fallback, landing restore, `resetAll`, submit link |

---

### Task 1: Migration 027

**Files:**
- Create: `db/migrations/027_customer_corrections.sql`

**Interfaces:**
- Produces:
  - `entity_dossiers.customer_searches INTEGER NOT NULL DEFAULT 0`
  - `entity_dossier_versions (id UUID PK, dossier_id UUID NOT NULL, tenant_id VARCHAR(64) NOT NULL, version INTEGER NOT NULL, snapshot JSONB NOT NULL, created_by TEXT NOT NULL, reason TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE (dossier_id, version))`
  - `onboarding_sessions.dossier_id TEXT` + index `onboarding_sessions_dossier_id_idx`

- [ ] **Step 1: Write the migration**

Create `db/migrations/027_customer_corrections.sql`:

```sql
-- 027_customer_corrections.sql
-- Part 3: customer correction -> re-research.
-- Additive and idempotent.

-- Server-owned count of re-searches the CUSTOMER has run on this dossier
-- (cap 2). The analyst's original search is not counted. The legacy
-- search_attempts column (migration 008) is left untouched and no longer written.
ALTER TABLE entity_dossiers
  ADD COLUMN IF NOT EXISTS customer_searches INTEGER NOT NULL DEFAULT 0;

-- Append-only history: every dossier row is copied here before it is
-- overwritten, so the analyst's original and every customer revision stay
-- recoverable. No endpoint updates or deletes these rows.
CREATE TABLE IF NOT EXISTS entity_dossier_versions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dossier_id  UUID NOT NULL,
  tenant_id   VARCHAR(64) NOT NULL,
  version     INTEGER NOT NULL,
  snapshot    JSONB NOT NULL,
  created_by  TEXT NOT NULL,
  reason      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (dossier_id, version)
);

-- Which dossier (if any) a submitted application came from.
ALTER TABLE onboarding_sessions
  ADD COLUMN IF NOT EXISTS dossier_id TEXT;

CREATE INDEX IF NOT EXISTS onboarding_sessions_dossier_id_idx
  ON onboarding_sessions (dossier_id);
```

- [ ] **Step 2: Apply to the dev database twice (idempotency)**

Run: `node db/apply.js db/migrations/027_customer_corrections.sql` (twice)
Expected: both runs complete without error.

- [ ] **Step 3: Verify the columns and table exist**

Run (prints column metadata only, never the connection string):

```bash
node -e '
require("dotenv").config({ path: ".env.local" });
const { neon } = require("@neondatabase/serverless");
const sql = neon(process.env.DATABASE_URL);
(async () => {
  console.log(await sql`SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name = ${"entity_dossiers"} AND column_name = ${"customer_searches"}`);
  console.log(await sql`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = ${"entity_dossier_versions"} ORDER BY ordinal_position`);
  console.log(await sql`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = ${"onboarding_sessions"} AND column_name = ${"dossier_id"}`);
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
'
```

Expected: `customer_searches integer NO 0`; the eight `entity_dossier_versions` columns; `dossier_id text`.

- [ ] **Step 4: Commit**

```bash
git add db/migrations/027_customer_corrections.sql
git commit -m "feat(db): 027 customer re-search count, dossier version history, submission dossier link"
```

---

### Task 2: `correctionPlan.js` and wiring `src/reresearch` tests into `test:node`

**Files:**
- Create: `src/reresearch/correctionPlan.js`
- Create: `src/reresearch/tests/correctionPlan.nodetest.js`
- Modify: `package.json` (`test:node` glob)

**Interfaces:**
- Produces: `planCorrection(current, corrections)` → `{ action: "none" | "invalid" | "re_derive" | "re_search", changed: string[], next: { companyName, registrationNumber, countryCode, entityType, ownershipType }, invalid?: string[] }`; `FACT_KEYS`.
  - Keys: `companyName`, `registrationNumber`, `countryCode`, `entityType`, `ownershipType`.
  - Values trimmed; `countryCode` uppercased. A key counts as changed only when it is present in `corrections` and differs from `current` after normalising.
  - `invalid` when a changed required key (`companyName`, `countryCode`, `entityType`) is empty.
  - `re_derive` only when `changed` is exactly `["entityType"]`.

- [ ] **Step 1: Write the failing test**

Create `src/reresearch/tests/correctionPlan.nodetest.js`:

```js
const { test } = require("node:test");
const assert = require("node:assert");
const { planCorrection, FACT_KEYS } = require("../correctionPlan");

const CURRENT = {
  companyName: "Britannia Group Limited",
  registrationNumber: "01234567",
  countryCode: "GB",
  entityType: "Corporate",
  ownershipType: "private_limited",
};

test("the five fact keys", () => {
  assert.deepStrictEqual(FACT_KEYS, ["companyName", "registrationNumber", "countryCode", "entityType", "ownershipType"]);
});

test("no corrections, or corrections equal to the current values, is 'none'", () => {
  assert.strictEqual(planCorrection(CURRENT, {}).action, "none");
  const same = planCorrection(CURRENT, { companyName: "  Britannia Group Limited ", countryCode: "gb" });
  assert.strictEqual(same.action, "none");
  assert.deepStrictEqual(same.changed, []);
});

test("entity type alone re-derives", () => {
  const plan = planCorrection(CURRENT, { entityType: "FI" });
  assert.strictEqual(plan.action, "re_derive");
  assert.deepStrictEqual(plan.changed, ["entityType"]);
  assert.strictEqual(plan.next.entityType, "FI");
  assert.strictEqual(plan.next.companyName, "Britannia Group Limited");
});

test("each other fact alone re-searches", () => {
  for (const [key, value] of [
    ["companyName", "Britannia Holdings Limited"],
    ["registrationNumber", "07654321"],
    ["countryCode", "IE"],
    ["ownershipType", "public_listed"],
  ]) {
    const plan = planCorrection(CURRENT, { [key]: value });
    assert.strictEqual(plan.action, "re_search", key);
    assert.deepStrictEqual(plan.changed, [key]);
  }
});

test("entity type together with anything else re-searches", () => {
  const plan = planCorrection(CURRENT, { entityType: "FI", companyName: "Other Ltd" });
  assert.strictEqual(plan.action, "re_search");
  assert.deepStrictEqual(plan.changed, ["companyName", "entityType"]);
});

test("next carries every fact, corrected ones replaced and normalised", () => {
  const plan = planCorrection(CURRENT, { countryCode: " ie ", registrationNumber: " 999 " });
  assert.deepStrictEqual(plan.next, {
    companyName: "Britannia Group Limited",
    registrationNumber: "999",
    countryCode: "IE",
    entityType: "Corporate",
    ownershipType: "private_limited",
  });
});

test("clearing the registration number is a valid re-search", () => {
  const plan = planCorrection(CURRENT, { registrationNumber: "" });
  assert.strictEqual(plan.action, "re_search");
  assert.strictEqual(plan.next.registrationNumber, "");
});

test("emptying a required fact is invalid", () => {
  const plan = planCorrection(CURRENT, { companyName: "   ", entityType: "FI" });
  assert.strictEqual(plan.action, "invalid");
  assert.deepStrictEqual(plan.invalid, ["companyName"]);
});

test("missing current values are treated as empty strings", () => {
  const plan = planCorrection({}, { companyName: "Acme Ltd", countryCode: "GB", entityType: "Corporate" });
  assert.strictEqual(plan.action, "re_search");
  assert.strictEqual(plan.next.ownershipType, "");
});

test("unknown correction keys are ignored", () => {
  assert.strictEqual(planCorrection(CURRENT, { tenantId: "evil" }).action, "none");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test src/reresearch/tests/correctionPlan.nodetest.js`
Expected: FAIL — `Cannot find module '../correctionPlan'`.

- [ ] **Step 3: Implement `src/reresearch/correctionPlan.js`**

```js
/**
 * correctionPlan.js — pure decision for a customer's correction of the five
 * foundational facts on the Applicant page.
 *
 * Rule (spec §6.1): correcting the entity type ALONE re-derives the schema from
 * the existing research (no search, no retry spent). Any other change — company
 * name, country, registration number, ownership type, or a mix — re-runs the
 * research with the corrected values and spends one of the customer's two
 * server-counted re-searches.
 *
 * No I/O, no React. CommonJS-in-src (the searchPolicy.js precedent) so node
 * --test and App.js can both use it.
 */

const FACT_KEYS = ["companyName", "registrationNumber", "countryCode", "entityType", "ownershipType"];
const REQUIRED_KEYS = ["companyName", "countryCode", "entityType"];

function normalise(key, value) {
  const s = value == null ? "" : String(value).trim();
  return key === "countryCode" ? s.toUpperCase() : s;
}

function planCorrection(current = {}, corrections = {}) {
  const source = current || {};
  const input = corrections || {};
  const next = {};
  const changed = [];
  for (const key of FACT_KEYS) {
    const before = normalise(key, source[key]);
    const provided = Object.prototype.hasOwnProperty.call(input, key);
    const after = provided ? normalise(key, input[key]) : before;
    next[key] = after;
    if (provided && after !== before) changed.push(key);
  }

  if (changed.length === 0) return { action: "none", changed, next };

  const invalid = changed.filter((key) => REQUIRED_KEYS.includes(key) && !next[key]);
  if (invalid.length > 0) return { action: "invalid", changed, next, invalid };

  const action = changed.length === 1 && changed[0] === "entityType" ? "re_derive" : "re_search";
  return { action, changed, next };
}

module.exports = { planCorrection, FACT_KEYS };
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test src/reresearch/tests/correctionPlan.nodetest.js`
Expected: PASS, 10 tests.

- [ ] **Step 5: Wire `src/reresearch/tests` into `test:node`**

Run first: `node --test src/reresearch/tests/*.nodetest.js`
Expected: PASS. If any pre-existing file there fails, stop and report NEEDS_CONTEXT with the failing test names — do not edit those tests.

Then in `package.json`, change the `test:node` script to:

```json
"test:node": "node --test lib/__tests__/*.nodetest.js api/__tests__/*.nodetest.js src/reresearch/tests/*.nodetest.js",
```

- [ ] **Step 6: Run the backend suite**

Run: `npm run test:node`
Expected: PASS, 0 failures.

- [ ] **Step 7: Commit**

```bash
git add src/reresearch/correctionPlan.js src/reresearch/tests/correctionPlan.nodetest.js package.json
git commit -m "feat(reresearch): pure correction plan (re-derive vs re-search); run reresearch tests in test:node"
```

---

### Task 3: Server-counted re-searches (`search-attempt` v2, `research-attempt`)

**Files:**
- Modify: `api/search-attempt.js` (full rewrite below)
- Modify: `api/__tests__/search-attempt.nodetest.js` (full rewrite below)
- Create: `api/research-attempt.js`, `api/__tests__/research-attempt.nodetest.js`
- Modify: `src/setupProxy.js`, `src/reresearch/searchPolicy.js` (header comment only)

**Interfaces:**
- Consumes: `lib/dossierAccess.js` (`resolveDossierActor`, `canReadDossier`, `canWriteDossier`, `denyFor`); `lib/storage.js` (`get`, `set(key, value, { ttlSeconds })`); `SEARCH_CAP` from `src/reresearch/searchPolicy.js`; migration 027 `customer_searches`.
- Produces:
  - `GET /api/search-attempt` (analyst `?dossierId=` or customer token) → `200 { attemptsUsed, remaining, cap }`.
  - `POST /api/search-attempt` (customer token only) → `200 { allowed: true, attemptsUsed, remaining }` | `200 { allowed: false, attemptsUsed, remaining: 0 }` (cap) | `200 { allowed: false, attemptsUsed: null, remaining: null, warning }` (DB error/unset) | `403 { error: "forbidden" }` (analyst) | 401/410/404 per `lib/dossierAccess.js`.
  - `POST /api/research-attempt` body `{ applicationId }` (UUID) → `200 { allowed, attemptsUsed, remaining }` | `400 { error: "invalid_application_id" }` | `200 { allowed: false, attemptsUsed: null, remaining: null, warning: "attempt_store_unavailable" }`.
  - Both `__setDeps`.

- [ ] **Step 1: Rewrite the search-attempt test**

Replace the contents of `api/__tests__/search-attempt.nodetest.js`:

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

// Mirrors Postgres: the UPDATE only matches while customer_searches < 2.
function fakeSql(row) {
  const log = [];
  const state = row ? { ...row } : null;
  const sql = (strings, ...values) => {
    const text = strings.join(" ");
    log.push({ text, values });
    if (/UPDATE entity_dossiers/i.test(text)) {
      if (!state || state.customer_searches >= 2) return Promise.resolve([]);
      state.customer_searches += 1;
      state.owned_by = "customer";
      return Promise.resolve([{ customer_searches: state.customer_searches }]);
    }
    return Promise.resolve(state ? [{ ...state }] : []);
  };
  sql.log = log;
  sql.state = () => state;
  return sql;
}

function accessWith(actor) {
  const real = require("../../lib/dossierAccess");
  return { ...real, resolveDossierActor: async () => actor };
}

const ROW = { id: "d-1", tenant_id: "acme", owned_by: "analyst", customer_searches: 0 };
const ANALYST = { kind: "analyst", tenantId: "acme", dossierId: null, reason: null };
const CUSTOMER = { kind: "customer", tenantId: "acme", dossierId: "d-1", reason: null };
const post = (body = {}) => ({ method: "POST", body, query: {}, headers: {} });
const get = (query = {}) => ({ method: "GET", body: {}, query, headers: {} });

test("no credential is a 401 and the counter is untouched", async () => {
  const sql = fakeSql(ROW);
  handler.__setDeps({ neon: () => sql, access: accessWith({ kind: "none", tenantId: null, dossierId: null, reason: "unauthorized" }) });
  const res = fakeRes();
  await handler(post({ dossierId: "d-1" }), res);
  assert.strictEqual(res.statusCode, 401);
  assert.strictEqual(sql.log.length, 0);
});

test("an analyst can read the count but never consume a customer search", async () => {
  const sql = fakeSql({ ...ROW, customer_searches: 1 });
  handler.__setDeps({ neon: () => sql, access: accessWith(ANALYST) });
  const read = fakeRes();
  await handler(get({ dossierId: "d-1" }), read);
  assert.strictEqual(read.statusCode, 200);
  assert.deepStrictEqual(read.body, { attemptsUsed: 1, remaining: 1, cap: 2 });

  const write = fakeRes();
  await handler(post({ dossierId: "d-1" }), write);
  assert.strictEqual(write.statusCode, 403);
  assert.deepStrictEqual(write.body, { error: "forbidden" });
  assert.ok(!sql.log.some((l) => /UPDATE/i.test(l.text)));
});

test("a customer gets exactly two searches; the third is refused", async () => {
  const sql = fakeSql(ROW);
  handler.__setDeps({ neon: () => sql, access: accessWith(CUSTOMER) });

  const first = fakeRes();
  await handler(post(), first);
  assert.deepStrictEqual(first.body, { allowed: true, attemptsUsed: 1, remaining: 1 });

  const second = fakeRes();
  await handler(post(), second);
  assert.deepStrictEqual(second.body, { allowed: true, attemptsUsed: 2, remaining: 0 });

  const third = fakeRes();
  await handler(post(), third);
  assert.strictEqual(third.statusCode, 200);
  assert.deepStrictEqual(third.body, { allowed: false, attemptsUsed: 2, remaining: 0 });
  assert.strictEqual(sql.state().customer_searches, 2);
});

test("consuming a search flips the dossier to customer-owned", async () => {
  const sql = fakeSql(ROW);
  handler.__setDeps({ neon: () => sql, access: accessWith(CUSTOMER) });
  await handler(post(), fakeRes());
  const update = sql.log.find((l) => /UPDATE entity_dossiers/i.test(l.text));
  assert.match(update.text, /owned_by\s*=/);
  assert.match(update.text, /customer_searches\s*=\s*customer_searches\s*\+\s*1/);
  assert.match(update.text, /customer_searches\s*<\s*/);
});

test("a customer's dossier id comes from the token, never the body", async () => {
  const sql = fakeSql(ROW);
  handler.__setDeps({ neon: () => sql, access: accessWith(CUSTOMER) });
  await handler(post({ dossierId: "someone-else" }), fakeRes());
  assert.ok(sql.log.every((l) => !l.values.includes("someone-else")));
  assert.ok(sql.log.every((l) => l.values.includes("d-1")));
});

test("every statement is scoped by the verified tenant", async () => {
  const sql = fakeSql(ROW);
  handler.__setDeps({ neon: () => sql, access: accessWith(CUSTOMER) });
  await handler(post(), fakeRes());
  assert.ok(sql.log.length >= 2);
  for (const entry of sql.log) {
    assert.match(entry.text, /tenant_id\s*=/);
    assert.ok(entry.values.includes("acme"));
  }
});

test("a dossier in another tenant is a 404", async () => {
  const sql = fakeSql(null);
  handler.__setDeps({ neon: () => sql, access: accessWith(CUSTOMER) });
  const res = fakeRes();
  await handler(post(), res);
  assert.strictEqual(res.statusCode, 404);
});

test("an analyst must name the dossier to read", async () => {
  const sql = fakeSql(ROW);
  handler.__setDeps({ neon: () => sql, access: accessWith(ANALYST) });
  const res = fakeRes();
  await handler(get(), res);
  assert.strictEqual(res.statusCode, 400);
  assert.deepStrictEqual(res.body, { error: "dossierId_required" });
});

test("a DB failure refuses the search (fail closed) with a fixed code", async () => {
  const throwingSql = () => { throw new Error("connection terminated — internal detail"); };
  handler.__setDeps({ neon: () => throwingSql, access: accessWith(CUSTOMER) });
  const res = fakeRes();
  await handler(post(), res);
  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(res.body, { allowed: false, attemptsUsed: null, remaining: null, warning: "search_attempt_failed" });
});

test("no DATABASE_URL refuses the search", async () => {
  const saved = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    handler.__setDeps({ neon: () => { throw new Error("must not connect"); }, access: accessWith(CUSTOMER) });
    const res = fakeRes();
    await handler(post(), res);
    assert.deepStrictEqual(res.body, { allowed: false, attemptsUsed: null, remaining: null, warning: "database_not_configured" });
  } finally {
    process.env.DATABASE_URL = saved;
  }
});
```

- [ ] **Step 2: Write the research-attempt test**

Create `api/__tests__/research-attempt.nodetest.js`:

```js
const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const handler = require("../research-attempt");

function fakeRes() {
  return { statusCode: null, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}

let store;
let ttls;

beforeEach(() => {
  store = {};
  ttls = {};
  handler.__setDeps({
    storage: {
      async get(k) { return k in store ? store[k] : null; },
      async set(k, v, opts) { store[k] = v; ttls[k] = opts && opts.ttlSeconds; },
    },
  });
});

const APP_ID = "3f2b8a4e-9c1d-4e6f-8a2b-7c9d0e1f2a3b";
const post = (body) => ({ method: "POST", body, headers: {}, query: {} });

test("a fresh application gets exactly two searches", async () => {
  const first = fakeRes();
  await handler(post({ applicationId: APP_ID }), first);
  assert.deepStrictEqual(first.body, { allowed: true, attemptsUsed: 1, remaining: 1 });
  const second = fakeRes();
  await handler(post({ applicationId: APP_ID }), second);
  assert.deepStrictEqual(second.body, { allowed: true, attemptsUsed: 2, remaining: 0 });
  const third = fakeRes();
  await handler(post({ applicationId: APP_ID }), third);
  assert.deepStrictEqual(third.body, { allowed: false, attemptsUsed: 2, remaining: 0 });
});

test("the count lives under research-attempts:<applicationId> with a 30-day TTL", async () => {
  await handler(post({ applicationId: APP_ID }), fakeRes());
  assert.strictEqual(store[`research-attempts:${APP_ID}`], 1);
  assert.strictEqual(ttls[`research-attempts:${APP_ID}`], 30 * 24 * 3600);
});

test("applications are counted independently", async () => {
  await handler(post({ applicationId: APP_ID }), fakeRes());
  await handler(post({ applicationId: APP_ID }), fakeRes());
  const other = fakeRes();
  await handler(post({ applicationId: "11111111-2222-4333-8444-555555555555" }), other);
  assert.strictEqual(other.body.allowed, true);
});

test("a missing or non-UUID application id is a 400 and nothing is stored", async () => {
  for (const body of [{}, { applicationId: "" }, { applicationId: "not-a-uuid" }, { applicationId: 42 }, { applicationId: "x".repeat(300) }]) {
    const res = fakeRes();
    await handler(post(body), res);
    assert.strictEqual(res.statusCode, 400);
    assert.deepStrictEqual(res.body, { error: "invalid_application_id" });
  }
  assert.deepStrictEqual(store, {});
});

test("a storage failure refuses the search (fail closed)", async () => {
  handler.__setDeps({ storage: { async get() { throw new Error("kv down"); }, async set() {} } });
  const res = fakeRes();
  await handler(post({ applicationId: APP_ID }), res);
  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(res.body, { allowed: false, attemptsUsed: null, remaining: null, warning: "attempt_store_unavailable" });
});

test("only POST is accepted", async () => {
  const res = fakeRes();
  await handler({ method: "GET", headers: {}, query: {} }, res);
  assert.strictEqual(res.statusCode, 405);
});
```

- [ ] **Step 3: Run to verify both fail**

Run: `node --test api/__tests__/search-attempt.nodetest.js api/__tests__/research-attempt.nodetest.js`
Expected: FAIL — old response shape; `Cannot find module '../research-attempt'`.

- [ ] **Step 4: Rewrite `api/search-attempt.js`**

```js
// Server-authoritative count of the CUSTOMER's re-searches on a dossier →
// Neon `entity_dossiers.customer_searches` (migration 027). Cap: 2. The
// analyst's original search is never counted, and an analyst can never
// consume the customer's searches.
//
//   GET  /api/search-attempt[?dossierId=]  → { attemptsUsed, remaining, cap }
//   POST /api/search-attempt               → { allowed, attemptsUsed, remaining }
//
// Credential-gated and tenant-scoped (lib/dossierAccess.js): a customer's
// dossier id comes only from its signed token; an analyst names one with
// ?dossierId= to read. POST is customer-only. The increment is a single
// conditional UPDATE, so two concurrent clicks cannot both get the second
// search, and it flips owned_by to 'customer' — spending a search is a
// customer action, after which the analyst is read-only.
//
// Fails CLOSED: on a DB error the search is refused (the customer falls back
// to manual entry) rather than letting an unknown count run a paid search.
//
// CommonJS so src/setupProxy.js can mount it for `npm start`.

const { neon } = require("@neondatabase/serverless");
const dossierAccess = require("../lib/dossierAccess");
const { SEARCH_CAP } = require("../src/reresearch/searchPolicy");

// Injected deps (overridable in tests via __setDeps).
let _deps = { neon, access: dossierAccess };

function refused(warning) {
  return { allowed: false, attemptsUsed: null, remaining: null, warning };
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const actor = await _deps.access.resolveDossierActor(req);
  if (actor.kind === "none") {
    const deny = _deps.access.denyFor(actor);
    return res.status(deny.status).json({ error: deny.error });
  }
  if (req.method === "POST" && actor.kind !== "customer") {
    return res.status(403).json({ error: "forbidden" });
  }

  const dossierId = actor.kind === "customer" ? actor.dossierId : req.query && req.query.dossierId;
  if (!dossierId) {
    return res.status(400).json({ error: "dossierId_required" });
  }

  if (!process.env.DATABASE_URL) {
    console.warn("[search-attempt] No DATABASE_URL");
    return req.method === "POST"
      ? res.status(200).json(refused("database_not_configured"))
      : res.status(200).json({ attemptsUsed: null, remaining: null, cap: SEARCH_CAP, warning: "database_not_configured" });
  }

  try {
    const sql = _deps.neon(process.env.DATABASE_URL);

    const found = await sql`
      SELECT id, tenant_id, owned_by, customer_searches
      FROM entity_dossiers
      WHERE id = ${dossierId} AND tenant_id = ${actor.tenantId} AND status != 'deleted'
      LIMIT 1
    `;
    const row = found.length ? found[0] : null;

    const permitted = req.method === "POST"
      ? _deps.access.canWriteDossier(actor, row)
      : _deps.access.canReadDossier(actor, row);
    if (!permitted.ok) return res.status(permitted.status).json({ error: permitted.error });

    const used = Number(row.customer_searches) || 0;
    if (req.method === "GET") {
      return res.status(200).json({ attemptsUsed: used, remaining: Math.max(0, SEARCH_CAP - used), cap: SEARCH_CAP });
    }

    const rows = await sql`
      UPDATE entity_dossiers
      SET customer_searches = customer_searches + 1,
          owned_by = ${"customer"},
          last_customer_action_at = NOW()
      WHERE id = ${dossierId} AND tenant_id = ${actor.tenantId} AND customer_searches < ${SEARCH_CAP}
      RETURNING customer_searches
    `;
    if (rows.length === 0) {
      return res.status(200).json({ allowed: false, attemptsUsed: Math.max(used, SEARCH_CAP), remaining: 0 });
    }
    const attemptsUsed = Number(rows[0].customer_searches);
    console.log(`[search-attempt] dossier ${dossierId} → customer search ${attemptsUsed}`);
    return res.status(200).json({ allowed: true, attemptsUsed, remaining: Math.max(0, SEARCH_CAP - attemptsUsed) });
  } catch (err) {
    console.error("[search-attempt] ❌", err.message);
    return req.method === "POST"
      ? res.status(200).json(refused("search_attempt_failed"))
      : res.status(200).json({ attemptsUsed: null, remaining: null, cap: SEARCH_CAP, warning: "search_attempt_failed" });
  }
};

// Test seam only.
module.exports.__setDeps = (d) => { _deps = { ..._deps, ...d }; };
```

- [ ] **Step 5: Create `api/research-attempt.js`**

```js
// Re-search counter for FRESH customers (no analyst link, so no dossier row).
// Keyed by the application id the browser holds for this research run, stored
// in lib/storage.js as research-attempts:<applicationId> for 30 days. Cap: 2.
//
//   POST /api/research-attempt  { applicationId }  → { allowed, attemptsUsed, remaining }
//
// Unauthenticated by necessity (a fresh customer has no credential — PLAT-7).
// The id must be a UUID so the key space can't be stuffed with arbitrary
// strings. Fails CLOSED on a storage error. Spend is further bounded by the
// /api/research rate limit.
//
// CommonJS so src/setupProxy.js can mount it for `npm start`.

const storage = require("../lib/storage");
const { SEARCH_CAP } = require("../src/reresearch/searchPolicy");

const TTL_SECONDS = 30 * 24 * 3600;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Injected deps (overridable in tests via __setDeps).
let _deps = { storage };

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const applicationId = (req.body || {}).applicationId;
  if (typeof applicationId !== "string" || !UUID_RE.test(applicationId)) {
    return res.status(400).json({ error: "invalid_application_id" });
  }

  const key = `research-attempts:${applicationId.toLowerCase()}`;
  try {
    const used = Number(await _deps.storage.get(key)) || 0;
    if (used >= SEARCH_CAP) {
      return res.status(200).json({ allowed: false, attemptsUsed: used, remaining: 0 });
    }
    // ponytail: read-modify-write, not atomic — two concurrent clicks could both
    // pass at used=1. Bounded (at most one extra search) and rate-limited; swap
    // for an atomic INCR if it ever matters.
    const attemptsUsed = used + 1;
    await _deps.storage.set(key, attemptsUsed, { ttlSeconds: TTL_SECONDS });
    return res.status(200).json({ allowed: true, attemptsUsed, remaining: Math.max(0, SEARCH_CAP - attemptsUsed) });
  } catch (err) {
    console.error("[research-attempt] ❌", err.message);
    return res.status(200).json({ allowed: false, attemptsUsed: null, remaining: null, warning: "attempt_store_unavailable" });
  }
};

// Test seam only.
module.exports.__setDeps = (d) => { _deps = { ..._deps, ...d }; };
```

Note: the test for the storage key uses a lowercase UUID, so `toLowerCase()` keeps it identical.

- [ ] **Step 6: Mount `research-attempt` in `src/setupProxy.js`**

Add next to `searchAttemptHandler`'s require:

```js
const researchAttemptHandler = require(path.join(__dirname, "..", "api", "research-attempt.js"));
```

Add immediately after the existing `/api/search-attempt` POST route block:

```js
  // Fresh-customer re-search counter (no dossier). POST; parse the JSON body.
  app.post("/api/research-attempt", (req, res) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      try { req.body = raw ? JSON.parse(raw) : {}; } catch (_) { req.body = {}; }
      adapt(researchAttemptHandler)(req, res);
    });
  });
```

- [ ] **Step 7: Update the `searchPolicy.js` header comment**

In `src/reresearch/searchPolicy.js`, replace the sentence `The authoritative attempt COUNT lives server-side on entity_dossiers.search_attempts (api/search-attempt.js); this module only interprets a count into UI decisions,` with:

```js
 * The authoritative attempt COUNT lives server-side: entity_dossiers.customer_searches
 * for link customers (api/search-attempt.js) and lib/storage.js for fresh
 * customers (api/research-attempt.js); this module only interprets a count into UI decisions,
```

(Keep the surrounding comment lines and all code unchanged.)

- [ ] **Step 8: Run the tests**

Run: `node --test api/__tests__/search-attempt.nodetest.js api/__tests__/research-attempt.nodetest.js`
Expected: PASS, 16 tests.

Run: `npm run test:node` and `node -e "require('./src/setupProxy.js')"`
Expected: PASS, 0 failures; exit 0.

- [ ] **Step 9: Commit**

```bash
git add api/search-attempt.js api/__tests__/search-attempt.nodetest.js api/research-attempt.js api/__tests__/research-attempt.nodetest.js src/setupProxy.js src/reresearch/searchPolicy.js
git commit -m "feat(reresearch): server-counted customer re-searches (cap 2) for link and fresh customers"
```

---

### Task 4: Snapshot every dossier overwrite; `customer_searches` on read

**Files:**
- Modify: `api/save-dossier.js`, `api/__tests__/save-dossier.nodetest.js`
- Modify: `api/get-dossier.js`, `api/__tests__/get-dossier.nodetest.js`

**Interfaces:**
- Consumes: migration 027 `entity_dossier_versions`, `customer_searches`.
- Produces:
  - `POST /api/save-dossier` accepts optional `saveReason` ∈ `customer_correction | analyst_update | customer_update` (anything else → the actor's default: `customer_update` for a customer, `analyst_update` for an analyst). Before every UPDATE of an existing row it inserts one `entity_dossier_versions` row (`version = max + 1`, `snapshot = to_jsonb(current row)`, `created_by = actor.kind`, `reason`). It no longer reads `searchAttempts` or writes `search_attempts`. Response shape unchanged.
  - `GET /api/get-dossier` also returns `customer_searches`.

- [ ] **Step 1: Update the save-dossier tests**

In `api/__tests__/save-dossier.nodetest.js`:

1. In `fakeSql`, add this branch as the FIRST check inside `sql` (before the `INSERT INTO tenants` check — the snapshot statement contains `SELECT ... FROM entity_dossiers`, which the lookup regex would otherwise swallow):

```js
    if (/INSERT INTO entity_dossier_versions/i.test(text)) { log.push({ kind: "snapshot", text, values }); return Promise.resolve([]); }
```

2. Run `node --test api/__tests__/save-dossier.nodetest.js` and, for every existing test that asserts an exact `sql.kinds()` array containing `"update"`, insert `"snapshot"` immediately before `"update"`. Change nothing else in those tests.

3. Append these tests:

```js
test("every update of an existing dossier snapshots the current row first", async () => {
  const sql = fakeSql({ lookupRow: { id: "d-1", tenant_id: "acme", owned_by: "analyst" } });
  handler.__setDeps({ neon: () => sql, access: accessWith(ANALYST) });
  const res = fakeRes();
  await handler(req({ ...base, dossierId: "d-1" }), res);
  assert.strictEqual(res.statusCode, 200);
  const kinds = sql.kinds();
  assert.ok(kinds.indexOf("snapshot") !== -1, "expected a snapshot");
  assert.ok(kinds.indexOf("snapshot") < kinds.indexOf("update"), "snapshot must precede the update");
  const snap = sql.log.find((l) => l.kind === "snapshot");
  assert.match(snap.text, /to_jsonb/i);
  assert.match(snap.text, /MAX\(\s*v\.version\s*\)/i);
  assert.ok(snap.values.includes("d-1"));
  assert.ok(snap.values.includes("acme"));
  assert.ok(snap.values.includes("analyst"));
  assert.ok(snap.values.includes("analyst_update"));
});

test("a customer correction snapshot records who and why", async () => {
  const sql = fakeSql({ lookupRow: { id: "d-1", tenant_id: "acme", owned_by: "analyst" } });
  handler.__setDeps({ neon: () => sql, access: accessWith(CUSTOMER) });
  await handler(req({ ...base, dossierId: "d-1", saveReason: "customer_correction" }), fakeRes());
  const snap = sql.log.find((l) => l.kind === "snapshot");
  assert.ok(snap.values.includes("customer"));
  assert.ok(snap.values.includes("customer_correction"));
});

test("an unknown saveReason falls back to the actor's default", async () => {
  const sql = fakeSql({ lookupRow: { id: "d-1", tenant_id: "acme", owned_by: "analyst" } });
  handler.__setDeps({ neon: () => sql, access: accessWith(CUSTOMER) });
  await handler(req({ ...base, dossierId: "d-1", saveReason: "drop table" }), fakeRes());
  const snap = sql.log.find((l) => l.kind === "snapshot");
  assert.ok(snap.values.includes("customer_update"));
  assert.ok(!snap.values.includes("drop table"));
});

test("the snapshot re-checks ownership so a locked analyst write leaves no history row", async () => {
  const sql = fakeSql({ lookupRow: { id: "d-1", tenant_id: "acme", owned_by: "analyst" } });
  handler.__setDeps({ neon: () => sql, access: accessWith(ANALYST) });
  await handler(req({ ...base, dossierId: "d-1" }), fakeRes());
  const snap = sql.log.find((l) => l.kind === "snapshot");
  assert.match(snap.text, /owned_by\s*<>\s*'customer'/);
});

test("a first save (insert) writes no snapshot", async () => {
  const sql = fakeSql({ insertId: "d-new" });
  handler.__setDeps({ neon: () => sql, access: accessWith(ANALYST) });
  await handler(req({ ...base }), fakeRes());
  assert.ok(!sql.kinds().includes("snapshot"));
});

test("searchAttempts in the body is ignored; search_attempts is never written", async () => {
  for (const lookupRow of [null, { id: "d-1", tenant_id: "acme", owned_by: "analyst" }]) {
    const sql = fakeSql({ lookupRow });
    handler.__setDeps({ neon: () => sql, access: accessWith(ANALYST) });
    await handler(req({ ...base, dossierId: lookupRow ? "d-1" : undefined, searchAttempts: 99 }), fakeRes());
    for (const entry of sql.log) {
      assert.ok(!entry.values.includes(99), `${entry.kind} bound searchAttempts`);
      if (entry.text) assert.doesNotMatch(entry.text, /search_attempts/);
    }
  }
});
```

For the last test the `insert` branch of `fakeSql` does not record `text`; add `text` to that branch's log entry (`log.push({ kind: "insert", text, values })`) so the assertion can inspect it.

- [ ] **Step 2: Update the get-dossier test**

Append to `api/__tests__/get-dossier.nodetest.js`:

```js
test("the dossier read includes the customer's re-search count", async () => {
  const sql = fakeSql({ ...ROW, customer_searches: 1 });
  handler.__setDeps({ neon: () => sql, access: accessWith(CUSTOMER) });
  const res = fakeRes();
  await handler(req(), res);
  assert.strictEqual(res.statusCode, 200);
  assert.match(sql.calls[0].text, /customer_searches/);
  assert.strictEqual(res.body.dossier.customer_searches, 1);
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `node --test api/__tests__/save-dossier.nodetest.js api/__tests__/get-dossier.nodetest.js`
Expected: FAIL — no snapshot statement; `search_attempts` still written; `customer_searches` not selected.

- [ ] **Step 4: Implement in `api/save-dossier.js`**

1. In the body destructuring, delete `searchAttempts,` and add `saveReason,`.
2. Replace the two lines computing `seededByValue` / `searchAttemptsValue` (and their comment block) with:

```js
  // Self-serve re-research metadata. `seeded_by` records who triggered the
  // search that produced this dossier: 'customer' (self-serve re-research) vs
  // the default 'analyst'. The customer's re-search COUNT is server-owned
  // (api/search-attempt.js → customer_searches) and never written here.
  const seededByValue = seededBy === "customer" ? "customer" : "analyst";
```

3. Directly after the `const isCustomer = actor.kind === "customer";` line, add:

```js
    // Why this version is being replaced — whitelisted, never free text.
    const SAVE_REASONS = ["customer_correction", "analyst_update", "customer_update"];
    const reason = SAVE_REASONS.includes(saveReason) ? saveReason : isCustomer ? "customer_update" : "analyst_update";
```

4. Inside `if (existing) {`, immediately before `rows = await sql\`` UPDATE, add:

```js
      // Keep every version: copy the row as it is NOW into the append-only
      // history before overwriting it, so the analyst's original and every
      // customer revision stay recoverable. Same ownership re-check as the
      // UPDATE below, so a write that will be refused leaves no history row.
      await sql`
        INSERT INTO entity_dossier_versions (dossier_id, tenant_id, version, snapshot, created_by, reason)
        SELECT
          d.id,
          d.tenant_id,
          COALESCE((SELECT MAX(v.version) FROM entity_dossier_versions v WHERE v.dossier_id = d.id), 0) + 1,
          to_jsonb(d),
          ${actor.kind},
          ${reason}
        FROM entity_dossiers d
        WHERE d.id = ${dossierId} AND d.tenant_id = ${tenantId} AND (${isCustomer} OR d.owned_by <> 'customer')
      `;
```

5. In the UPDATE statement delete the line `search_attempts = ${searchAttemptsValue},`.
6. In the INSERT statement delete `search_attempts,` from the column list and `${searchAttemptsValue},` from the values list.
7. In the file header comment add a line after the ownership paragraph: `// Every UPDATE first appends the current row to entity_dossier_versions (migration 027).`

- [ ] **Step 5: Implement in `api/get-dossier.js`**

In the SELECT list, add `customer_searches,` on the line after `owned_by,`.

- [ ] **Step 6: Run to verify they pass**

Run: `node --test api/__tests__/save-dossier.nodetest.js api/__tests__/get-dossier.nodetest.js`
Expected: PASS.

Run: `npm run test:node`
Expected: PASS, 0 failures.

- [ ] **Step 7: Verify the snapshot SQL against the dev database**

Run (zero-row statement against a nil UUID — writes nothing, proves the SQL parses and type-checks):

```bash
node -e '
require("dotenv").config({ path: ".env.local" });
const { neon } = require("@neondatabase/serverless");
const sql = neon(process.env.DATABASE_URL);
(async () => {
  const id = "00000000-0000-0000-0000-000000000000";
  for (const isCustomer of [true, false]) {
    const rows = await sql`
      INSERT INTO entity_dossier_versions (dossier_id, tenant_id, version, snapshot, created_by, reason)
      SELECT d.id, d.tenant_id,
        COALESCE((SELECT MAX(v.version) FROM entity_dossier_versions v WHERE v.dossier_id = d.id), 0) + 1,
        to_jsonb(d), ${"analyst"}, ${"analyst_update"}
      FROM entity_dossiers d
      WHERE d.id = ${id} AND d.tenant_id = ${"nium"} AND (${isCustomer} OR d.owned_by <> ${"customer"})
      RETURNING id`;
    console.log("isCustomer", isCustomer, "ok, rows", rows.length);
  }
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
'
```

Expected: `isCustomer true ok, rows 0` and `isCustomer false ok, rows 0`.

- [ ] **Step 8: Commit**

```bash
git add api/save-dossier.js api/__tests__/save-dossier.nodetest.js api/get-dossier.js api/__tests__/get-dossier.nodetest.js
git commit -m "feat(dossier): snapshot every dossier overwrite; stop client-written search counts; expose customer_searches"
```

---

### Task 5: Submissions record their source dossier

**Files:**
- Modify: `api/submit.js`, `api/__tests__/submit-handler.nodetest.js`
- Modify: `api/lib/finalizeSubmission.js`, `api/__tests__/finalizeSubmission.nodetest.js`

**Interfaces:**
- Consumes: `lib/dossierAccess.js#resolveDossierActor`; migration 027 `onboarding_sessions.dossier_id`.
- Produces:
  - `/api/submit` keeps `body.dossierId` only when the caller holds a customer token whose `dossierId` equals it and whose `tenantId` equals `body.tenantId`; otherwise it sets `dossierId: null` before enqueue/finalize. `__setDeps` gains `access`.
  - `finalizeSubmission(payload)` writes `onboarding_sessions.dossier_id = payload.dossierId || null` and, when `payload.dossierId` is set, runs `UPDATE entity_dossiers SET owned_by = 'customer', last_customer_action_at = NOW() WHERE id = $1 AND tenant_id = $2` inside the same transaction.

- [ ] **Step 1: Write the failing tests**

Append to `api/__tests__/submit-handler.nodetest.js`:

```js
const submitHandler = require("../submit");

function linkDeps(actor, captured) {
  const real = require("../../lib/dossierAccess");
  return {
    access: { ...real, resolveDossierActor: async () => actor },
    enqueue: async (row) => { captured.enqueued = row.payload; },
    markProcessing: async () => {},
    finalizeSubmission: async (payload) => { captured.finalized = payload; return { sessionId: "s-1" }; },
    markDone: async () => {},
    markFailed: async () => {},
  };
}

const LINK_BODY = { submissionId: "sub-9", tenantId: "acme", company: { name: "Acme Ltd" }, dossierId: "d-1" };
const subReq = (body) => ({ method: "POST", body, headers: {}, query: {} });

test("a verified customer's submission keeps its dossier link", async () => {
  const captured = {};
  submitHandler.__setDeps(linkDeps({ kind: "customer", tenantId: "acme", dossierId: "d-1", reason: null }, captured));
  const res = fakeRes();
  await submitHandler(subReq({ ...LINK_BODY }), res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(captured.enqueued.dossierId, "d-1");
  assert.strictEqual(captured.finalized.dossierId, "d-1");
});

test("a dossier id without a matching customer credential is dropped", async () => {
  for (const actor of [
    { kind: "none", tenantId: null, dossierId: null, reason: "unauthorized" },
    { kind: "analyst", tenantId: "acme", dossierId: null, reason: null },
    { kind: "customer", tenantId: "acme", dossierId: "d-OTHER", reason: null },
    { kind: "customer", tenantId: "other-tenant", dossierId: "d-1", reason: null },
  ]) {
    const captured = {};
    submitHandler.__setDeps(linkDeps(actor, captured));
    await submitHandler(subReq({ ...LINK_BODY }), fakeRes());
    assert.strictEqual(captured.enqueued.dossierId, null, JSON.stringify(actor));
    assert.strictEqual(captured.finalized.dossierId, null);
  }
});

test("a credential check that throws drops the link but never blocks the submission", async () => {
  const captured = {};
  const deps = linkDeps(null, captured);
  deps.access = { ...deps.access, resolveDossierActor: async () => { throw new Error("revocation store down"); } };
  submitHandler.__setDeps(deps);
  const res = fakeRes();
  await submitHandler(subReq({ ...LINK_BODY }), res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(captured.enqueued.dossierId, null);
});
```

Append to `api/__tests__/finalizeSubmission.nodetest.js`:

```js
function recordingClient() {
  const calls = [];
  return {
    calls,
    query(text, params) {
      calls.push({ text: String(text), params: params || [] });
      const t = String(text);
      if (/INSERT INTO clients/i.test(t)) return Promise.resolve({ rows: [{ id: "client-1" }] });
      if (/INSERT INTO onboarding_sessions/i.test(t)) return Promise.resolve({ rows: [{ id: "session-1" }] });
      if (/INSERT INTO journeys/i.test(t)) return Promise.resolve({ rows: [{ journey_id: "journey-1" }] });
      return Promise.resolve({ rows: [] });
    },
    release() {},
  };
}

test("the session records its source dossier and the dossier becomes customer-owned in the same transaction", async () => {
  const client = recordingClient();
  await finalizeSubmission({ ...basePayload, dossierId: "d-1" }, { pool: { connect: () => Promise.resolve(client) } });
  const session = client.calls.find((c) => /INSERT INTO onboarding_sessions/i.test(c.text));
  assert.match(session.text, /dossier_id/);
  assert.ok(session.params.includes("d-1"));
  const flipIdx = client.calls.findIndex((c) => /UPDATE entity_dossiers/i.test(c.text));
  assert.ok(flipIdx !== -1, "expected the ownership flip");
  assert.match(client.calls[flipIdx].text, /owned_by\s*=\s*'customer'/);
  assert.deepStrictEqual(client.calls[flipIdx].params, ["d-1", "nium"]);
  const commitIdx = client.calls.findIndex((c) => c.text.trim() === "COMMIT");
  assert.ok(flipIdx < commitIdx);
});

test("a submission without a dossier writes a null link and flips nothing", async () => {
  const client = recordingClient();
  await finalizeSubmission({ ...basePayload }, { pool: { connect: () => Promise.resolve(client) } });
  const session = client.calls.find((c) => /INSERT INTO onboarding_sessions/i.test(c.text));
  assert.match(session.text, /dossier_id/);
  assert.strictEqual(session.params[session.params.length - 1], null);
  assert.ok(!client.calls.some((c) => /UPDATE entity_dossiers/i.test(c.text)));
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test api/__tests__/submit-handler.nodetest.js api/__tests__/finalizeSubmission.nodetest.js`
Expected: FAIL — `dossierId` passes through untouched; no `dossier_id` column; no ownership flip.

- [ ] **Step 3: Implement in `api/submit.js`**

1. Add below the existing requires:

```js
const dossierAccess = require("../lib/dossierAccess");
```

2. Change `let _deps = { enqueue, finalizeSubmission, markProcessing, markDone, markFailed };` to:

```js
let _deps = { enqueue, finalizeSubmission, markProcessing, markDone, markFailed, access: dossierAccess };
```

3. Replace `const body = req.body || {};` with:

```js
  const rawBody = req.body || {};
```

and change the destructuring line to `const { submissionId, tenantId, company } = rawBody;`.

4. Immediately after the `DATABASE_URL` guard block, add:

```js
  // A submission may name the analyst dossier it came from, but only the
  // customer holding that dossier's signed link may claim it — otherwise anyone
  // could attach a submission to (and lock the analyst out of) any dossier.
  let verifiedDossierId = null;
  if (rawBody.dossierId) {
    try {
      const actor = await _deps.access.resolveDossierActor(req);
      if (
        actor.kind === "customer" &&
        actor.dossierId === String(rawBody.dossierId) &&
        actor.tenantId === tenantId
      ) {
        verifiedDossierId = actor.dossierId;
      }
    } catch (err) {
      console.warn("[api/submit] dossier link not verified:", err.message);
    }
  }
  const body = { ...rawBody, dossierId: verifiedDossierId };
```

The rest of the handler keeps using `body` (enqueue payload and `finalizeSubmission(body)`). Move the `DATABASE_URL` guard's `submissionId` use unchanged.

- [ ] **Step 4: Implement in `api/lib/finalizeSubmission.js`**

1. Add `dossierId,` to the destructuring of `payload` near the top of `finalizeSubmission`.
2. In the `INSERT INTO onboarding_sessions` column list, add `dossier_id,` after `raw_result,` (before `completed_at`); in its VALUES add `$30,` after `$29,`; append `dossierId || null` as the last element of the parameter array (after the `JSON.stringify({...})` element).
3. Immediately after `const sessionId = sessionResult.rows[0].id;`, add:

```js
    // A verified customer submission (api/submit.js checked the link token)
    // makes the dossier customer-owned: from now on the analyst may only read it.
    if (dossierId) {
      await client.query(
        `UPDATE entity_dossiers
         SET owned_by = 'customer', last_customer_action_at = NOW()
         WHERE id = $1 AND tenant_id = $2`,
        [dossierId, tenantId]
      );
    }
```

- [ ] **Step 5: Run to verify they pass**

Run: `node --test api/__tests__/submit-handler.nodetest.js api/__tests__/finalizeSubmission.nodetest.js api/__tests__/finalize-worker.nodetest.js`
Expected: PASS.

Run: `npm run test:node`
Expected: PASS, 0 failures.

- [ ] **Step 6: Commit**

```bash
git add api/submit.js api/__tests__/submit-handler.nodetest.js api/lib/finalizeSubmission.js api/__tests__/finalizeSubmission.nodetest.js
git commit -m "feat(submit): verified customer submissions record their source dossier and lock it to the customer"
```

---

### Task 6: Inline corrections on the foundational-facts gate

**Files:**
- Modify: `src/components/companyConfirm/FoundationalFactsGate.jsx` (full rewrite below)
- Create: `src/components/companyConfirm/__tests__/FoundationalFactsGate.test.jsx`

**Interfaces:**
- Produces (component props, in addition to the existing ones except `onReset`, which is removed):
  - each `facts[]` item gains `editValue` (the raw id/code/text to pre-fill).
  - `countryOptions: [{ value, label }]`, `entityTypeOptions: [{ value, label }]` (existing `ownershipTypeOptions` reused).
  - `onApplyCorrections(corrections)` — `corrections` has only the CHANGED keys among `companyName`, `registrationNumber`, `countryCode`, `entityType`, `ownershipType` (fact key `country` maps to `countryCode`), values trimmed.
  - `correctionBusy: boolean`, `correctionError: string`.
- Test ids: inputs `correct-companyName`, `correct-country`, `correct-entityType`, `correct-ownershipType`, `correct-registrationNumber`; panel `facts-corrections-panel`; buttons `facts-apply-corrections`, `facts-corrections-cancel`; error `facts-corrections-error`. Unchanged: `foundational-facts-gate`, `fact-<key>`, `ownership-fork-panel`, `ownership-misclassified`, `ownership-genuinely-changed`, `ownership-changed-panel`, `ownership-new-type`, `ownership-changed-confirm`, `regnumber-*` equivalents.

- [ ] **Step 1: Write the failing component test**

Create `src/components/companyConfirm/__tests__/FoundationalFactsGate.test.jsx`:

```jsx
import React, { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import FoundationalFactsGate from "../FoundationalFactsGate";

const FACTS = [
  { key: "companyName", label: "Company legal name", value: "Britannia Group Limited", editValue: "Britannia Group Limited", disputable: true },
  { key: "registrationNumber", label: "Registration / company number", value: "01234567", editValue: "01234567", disputable: true },
  { key: "country", label: "Registration country", value: "United Kingdom", editValue: "GB", disputable: true },
  { key: "entityType", label: "Entity type", value: "Corporate", editValue: "Corporate", disputable: true },
  { key: "ownershipType", label: "Ownership type", value: "Private Limited Company", editValue: "private_limited", disputable: true },
];

function Harness({ onApplyCorrections = jest.fn(), correctionBusy = false, correctionError = "" }) {
  const [checks, setChecks] = useState({});
  const [ownershipFork, setOwnershipFork] = useState(null);
  const [regNumberFork, setRegNumberFork] = useState(null);
  return (
    <FoundationalFactsGate
      facts={FACTS}
      isConfirmed={(k) => checks[k] !== false}
      onToggle={(k) => {
        const was = checks[k] !== false;
        setChecks((p) => ({ ...p, [k]: !was }));
        if (k === "ownershipType") setOwnershipFork(was ? "choose" : null);
        if (k === "registrationNumber") setRegNumberFork(was ? "choose" : null);
      }}
      ownershipFork={ownershipFork}
      regNumberFork={regNumberFork}
      onOwnershipChanged={() => setOwnershipFork("changed")}
      onRegNumberChanged={() => setRegNumberFork("changed")}
      onOwnershipChangeResolved={jest.fn()}
      onRegNumberChangeResolved={jest.fn()}
      onCancel={() => { setChecks({}); setOwnershipFork(null); setRegNumberFork(null); }}
      ownershipTypeOptions={[{ value: "private_limited", label: "Private Limited Company" }, { value: "public_listed", label: "Public Listed Company" }]}
      countryOptions={[{ value: "GB", label: "United Kingdom" }, { value: "IE", label: "Ireland" }]}
      entityTypeOptions={[{ value: "Corporate", label: "Corporate" }, { value: "FI", label: "Financial Institution" }]}
      onApplyCorrections={onApplyCorrections}
      correctionBusy={correctionBusy}
      correctionError={correctionError}
    />
  );
}

const untick = (label) => fireEvent.click(screen.getByLabelText(new RegExp(`Confirm ${label}`, "i")));

test("unticking company name, country or entity type reveals a pre-filled input", () => {
  render(<Harness />);
  untick("Company legal name");
  expect(screen.getByTestId("correct-companyName")).toHaveValue("Britannia Group Limited");
  untick("Registration country");
  expect(screen.getByTestId("correct-country")).toHaveValue("GB");
  untick("Entity type");
  expect(screen.getByTestId("correct-entityType")).toHaveValue("Corporate");
  expect(screen.getByTestId("facts-corrections-panel")).toBeInTheDocument();
});

test("there is no reset-the-application panel any more", () => {
  render(<Harness />);
  untick("Company legal name");
  expect(screen.queryByTestId("facts-reset-confirm")).not.toBeInTheDocument();
  expect(screen.queryByText(/This restarts your application/)).not.toBeInTheDocument();
});

test("Update my details is disabled until a value actually changes, then sends only changed keys", () => {
  const onApplyCorrections = jest.fn();
  render(<Harness onApplyCorrections={onApplyCorrections} />);
  untick("Company legal name");
  untick("Entity type");
  const button = screen.getByTestId("facts-apply-corrections");
  expect(button).toBeDisabled();
  fireEvent.change(screen.getByTestId("correct-companyName"), { target: { value: "  Britannia Holdings Limited " } });
  expect(button).toBeEnabled();
  fireEvent.click(button);
  expect(onApplyCorrections).toHaveBeenCalledWith({ companyName: "Britannia Holdings Limited" });
});

test("an emptied input blocks the update", () => {
  render(<Harness />);
  untick("Company legal name");
  untick("Registration country");
  fireEvent.change(screen.getByTestId("correct-country"), { target: { value: "IE" } });
  fireEvent.change(screen.getByTestId("correct-companyName"), { target: { value: "   " } });
  expect(screen.getByTestId("facts-apply-corrections")).toBeDisabled();
});

test("country maps to countryCode and several corrections go together", () => {
  const onApplyCorrections = jest.fn();
  render(<Harness onApplyCorrections={onApplyCorrections} />);
  untick("Registration country");
  untick("Entity type");
  fireEvent.change(screen.getByTestId("correct-country"), { target: { value: "IE" } });
  fireEvent.change(screen.getByTestId("correct-entityType"), { target: { value: "FI" } });
  fireEvent.click(screen.getByTestId("facts-apply-corrections"));
  expect(onApplyCorrections).toHaveBeenCalledWith({ countryCode: "IE", entityType: "FI" });
});

test("ownership: 'you got it wrong' opens a correction select; 'genuinely changed' still works", () => {
  const onApplyCorrections = jest.fn();
  render(<Harness onApplyCorrections={onApplyCorrections} />);
  untick("Ownership type");
  expect(screen.getByTestId("ownership-fork-panel")).toBeInTheDocument();
  fireEvent.click(screen.getByTestId("ownership-misclassified"));
  expect(screen.getByTestId("correct-ownershipType")).toHaveValue("private_limited");
  expect(screen.queryByTestId("ownership-fork-panel")).not.toBeInTheDocument();
  fireEvent.change(screen.getByTestId("correct-ownershipType"), { target: { value: "public_listed" } });
  fireEvent.click(screen.getByTestId("facts-apply-corrections"));
  expect(onApplyCorrections).toHaveBeenCalledWith({ ownershipType: "public_listed" });
});

test("ownership 'genuinely changed' fork is unchanged", () => {
  render(<Harness />);
  untick("Ownership type");
  fireEvent.click(screen.getByTestId("ownership-genuinely-changed"));
  expect(screen.getByTestId("ownership-changed-panel")).toBeInTheDocument();
  expect(screen.queryByTestId("correct-ownershipType")).not.toBeInTheDocument();
});

test("registration number: 'you got it wrong' opens a correction input", () => {
  const onApplyCorrections = jest.fn();
  render(<Harness onApplyCorrections={onApplyCorrections} />);
  untick("Registration / company number");
  fireEvent.click(screen.getByTestId("regnumber-misclassified"));
  const input = screen.getByTestId("correct-registrationNumber");
  expect(input).toHaveValue("01234567");
  fireEvent.change(input, { target: { value: "07654321" } });
  fireEvent.click(screen.getByTestId("facts-apply-corrections"));
  expect(onApplyCorrections).toHaveBeenCalledWith({ registrationNumber: "07654321" });
});

test("re-ticking a fact removes its input; cancel clears everything", () => {
  render(<Harness />);
  untick("Company legal name");
  untick("Company legal name");
  expect(screen.queryByTestId("correct-companyName")).not.toBeInTheDocument();
  untick("Entity type");
  fireEvent.click(screen.getByTestId("facts-corrections-cancel"));
  expect(screen.queryByTestId("facts-corrections-panel")).not.toBeInTheDocument();
  screen.getAllByRole("checkbox").forEach((cb) => expect(cb).toBeChecked());
});

test("busy state disables the button and relabels it; the error is shown", () => {
  render(<Harness correctionBusy correctionError="Something went wrong" />);
  untick("Company legal name");
  fireEvent.change(screen.getByTestId("correct-companyName"), { target: { value: "Other Ltd" } });
  const button = screen.getByTestId("facts-apply-corrections");
  expect(button).toBeDisabled();
  expect(button).toHaveTextContent(/Updating your details/);
  expect(screen.getByTestId("facts-corrections-error")).toHaveTextContent("Something went wrong");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `CI=true npx react-scripts test --watchAll=false src/components/companyConfirm/__tests__/FoundationalFactsGate.test.jsx`
Expected: FAIL — no correction inputs.

- [ ] **Step 3: Rewrite `src/components/companyConfirm/FoundationalFactsGate.jsx`**

Replace the whole file with:

```jsx
/**
 * FoundationalFactsGate.jsx — the five foundational facts used to research the
 * company, shown at the TOP of the Applicant page (NOT a new step), each with a
 * confirm checkbox (checked by default). The applicant section below is
 * revealed by the parent only once all five are confirmed.
 *
 * PRESENTATIONAL and CONTROLLED for everything the parent owns (check state,
 * the ownership / registration-number "genuinely changed" forks, the outcome
 * of a correction). The only local state is the text the customer is typing
 * into a correction input before they press "Update my details".
 *
 * Outcomes:
 *   - company name / country / entity type unticked → an inline input
 *     pre-filled with the current value appears under the fact.
 *   - ownership type / registration number unticked → a fork:
 *       "You got it wrong - correct it" → the same inline correction input
 *       "It genuinely changed"          → the existing document-request path
 *   - "Update my details" → onApplyCorrections({ <changed keys only> }). The
 *     parent decides re-derive vs re-search (src/reresearch/correctionPlan.js).
 *     Nothing here resets the application.
 *
 * The registration number is display-only/pre-confirmed when the customer
 * provided it themselves; it is only checkbox-verifiable when research
 * retrieved it (provenance decided by the parent via `disputable`).
 */

import React, { useEffect, useState } from "react";

const CARD = {
  background: "#F8FAFC",
  border: "1px solid #E2E8F0",
  borderRadius: 10,
  padding: "16px 18px",
  marginBottom: 20,
};
const TITLE = { fontSize: 15, fontWeight: 700, color: "#1a3a4a", margin: "0 0 4px" };
const SUMMARY = { fontSize: 13, color: "#1a3a4a99", margin: "0 0 14px", lineHeight: 1.5 };
const ROW = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "9px 0",
  borderTop: "1px solid #E8EDF2",
  flexWrap: "wrap",
};
const FACT_LABEL = { fontSize: 12, color: "#1a3a4a80", width: 200, flexShrink: 0 };
const FACT_VALUE = { fontSize: 13, fontWeight: 600, color: "#1a3a4a", flex: 1, minWidth: 0 };
const NOTE = { fontSize: 11, color: "#1a3a4a70", fontStyle: "italic" };
const DISPUTED_TAG = {
  fontSize: 10, fontWeight: 700, color: "#b91c1c",
  background: "#fef2f2", border: "1px solid #fecaca",
  borderRadius: 99, padding: "2px 8px", whiteSpace: "nowrap",
};
const PANEL = (tone) => ({
  marginTop: 14,
  padding: "14px 16px",
  borderRadius: 8,
  background: tone === "warn" ? "#FEF9EF" : "#EEF6F4",
  border: `1px solid ${tone === "warn" ? "#FCD9A8" : "#BFE0D8"}`,
});
const PANEL_TITLE = (tone) => ({
  fontSize: 13, fontWeight: 700, margin: "0 0 4px",
  color: tone === "warn" ? "#7a4f00" : "#1a3a4a",
});
const PANEL_BODY = (tone) => ({
  fontSize: 12.5, lineHeight: 1.5, margin: "0 0 12px",
  color: tone === "warn" ? "#7a4f00cc" : "#1a3a4acc",
});
const ROW_BTNS = { display: "flex", gap: 8, flexWrap: "wrap" };
const BTN = {
  cursor: "pointer", padding: "8px 14px", fontSize: 13, fontWeight: 600,
  color: "#1a3a4a", background: "#fff", border: "1px solid #CBD5E1",
  borderRadius: 6, fontFamily: "inherit",
};
const BTN_PRIMARY = { ...BTN, background: "#4a9e8e", color: "#fff", border: "1px solid #4a9e8e" };
const BTN_WARN = { ...BTN, background: "#7a4f00", color: "#fff", border: "1px solid #7a4f00" };
const DISABLED = { opacity: 0.5, cursor: "not-allowed" };
const FIELD = {
  width: "100%", padding: "9px 12px", margin: "6px 0 4px",
  border: "1px solid #CBD5E1", borderRadius: 6, fontSize: 13,
  fontFamily: "inherit", background: "#fff", color: "#1a3a4a", boxSizing: "border-box",
};
const ERROR = { fontSize: 12.5, color: "#b91c1c", margin: "0 0 10px" };

// Gate fact key → correction key sent to the parent.
const CORRECTION_KEY = {
  companyName: "companyName",
  registrationNumber: "registrationNumber",
  country: "countryCode",
  entityType: "entityType",
  ownershipType: "ownershipType",
};
const DIRECT_KEYS = ["companyName", "country", "entityType"];

export function FoundationalFactsGate({
  facts = [],
  isConfirmed,
  onToggle,
  ownershipFork = null,
  ownershipChangeFrom = "",
  onOwnershipChanged,
  onCancel,
  ownershipTypeOptions = [],
  onOwnershipChangeResolved,
  regNumberFork = null,
  regNumberChangeFrom = "",
  onRegNumberChanged,
  onRegNumberChangeResolved,
  countryOptions = [],
  entityTypeOptions = [],
  onApplyCorrections,
  correctionBusy = false,
  correctionError = "",
}) {
  const ownershipDisputed = !isConfirmed("ownershipType");
  const regNumberDisputed = !isConfirmed("registrationNumber");

  // Typed-but-not-yet-submitted correction values, keyed by fact key.
  const [drafts, setDrafts] = useState({});
  // "You got it wrong" chosen on the ownership / registration-number forks.
  const [correctingOwnership, setCorrectingOwnership] = useState(false);
  const [correctingRegNumber, setCorrectingRegNumber] = useState(false);
  // Transient values for the "genuinely changed" controls (unchanged flow).
  const [newOwnershipType, setNewOwnershipType] = useState("");
  const [newRegNumber, setNewRegNumber] = useState("");

  // A fact that is re-confirmed (by re-ticking, or by the parent after a
  // correction / cancel) drops its local correction state.
  useEffect(() => { if (!ownershipDisputed) setCorrectingOwnership(false); }, [ownershipDisputed]);
  useEffect(() => { if (!regNumberDisputed) setCorrectingRegNumber(false); }, [regNumberDisputed]);

  const isCorrecting = (fact) => {
    if (!fact.disputable || isConfirmed(fact.key)) return false;
    if (DIRECT_KEYS.includes(fact.key)) return true;
    if (fact.key === "ownershipType") return correctingOwnership;
    if (fact.key === "registrationNumber") return correctingRegNumber;
    return false;
  };
  const draftFor = (fact) =>
    Object.prototype.hasOwnProperty.call(drafts, fact.key) ? drafts[fact.key] : (fact.editValue ?? "");
  const setDraft = (key, value) => setDrafts((prev) => ({ ...prev, [key]: value }));

  const correcting = facts.filter(isCorrecting);
  const allFilled = correcting.every((f) => String(draftFor(f)).trim() !== "");
  const changedFacts = correcting.filter((f) => String(draftFor(f)).trim() !== String(f.editValue ?? "").trim());
  const canApply = correcting.length > 0 && allFilled && changedFacts.length > 0 && !correctionBusy;

  const handleToggle = (key) => {
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    onToggle(key);
  };
  const handleCancel = () => {
    setDrafts({});
    setCorrectingOwnership(false);
    setCorrectingRegNumber(false);
    onCancel();
  };
  const handleApply = () => {
    if (!canApply) return;
    const corrections = {};
    changedFacts.forEach((f) => { corrections[CORRECTION_KEY[f.key]] = String(draftFor(f)).trim(); });
    onApplyCorrections(corrections);
  };

  const renderCorrectionInput = (fact) => {
    const common = {
      value: draftFor(fact),
      onChange: (e) => setDraft(fact.key, e.target.value),
      "data-testid": `correct-${fact.key}`,
      "aria-label": `Correct ${fact.label}`,
      style: FIELD,
      disabled: correctionBusy,
    };
    const options =
      fact.key === "country" ? countryOptions
        : fact.key === "entityType" ? entityTypeOptions
        : fact.key === "ownershipType" ? ownershipTypeOptions
        : null;
    if (options) {
      return (
        <select {...common}>
          <option value="">Select…</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      );
    }
    return (
      <input
        {...common}
        type="text"
        placeholder={fact.key === "companyName" ? "Registered company name" : "Registration / company number"}
      />
    );
  };

  return (
    <div style={CARD} data-testid="foundational-facts-gate">
      <h3 style={TITLE}>Before you continue - confirm the company we researched</h3>
      <p style={SUMMARY}>
        These are the five facts we used to research your company. Leave a box ticked to confirm it,
        or untick anything that's wrong and tell us the right value. We'll only show the rest of this
        page once all five are confirmed.
      </p>

      {facts.map((f) => {
        const confirmed = isConfirmed(f.key);
        const showDisputed = f.disputable && !confirmed;
        return (
          <React.Fragment key={f.key}>
            <label
              style={{ ...ROW, cursor: f.disputable ? "pointer" : "default" }}
              data-testid={`fact-${f.key}`}
            >
              <input
                type="checkbox"
                checked={confirmed}
                disabled={!f.disputable || correctionBusy}
                onChange={() => f.disputable && handleToggle(f.key)}
                style={{
                  width: 15, height: 15, flexShrink: 0,
                  accentColor: "#4a9e8e",
                  cursor: f.disputable ? "pointer" : "not-allowed",
                }}
                aria-label={`Confirm ${f.label}`}
              />
              <span style={FACT_LABEL}>{f.label}</span>
              <span style={FACT_VALUE}>{f.value}</span>
              {f.note && !showDisputed && <span style={NOTE}>{f.note}</span>}
              {showDisputed && <span style={DISPUTED_TAG}>marked incorrect</span>}
            </label>
            {isCorrecting(f) && renderCorrectionInput(f)}
          </React.Fragment>
        );
      })}

      {correcting.length > 0 && (
        <div style={PANEL("info")} data-testid="facts-corrections-panel">
          <p style={PANEL_TITLE("info")}>Update your company details</p>
          <p style={PANEL_BODY("info")}>
            We'll use your corrections to update what we found. You won't lose anything you've already
            entered on this page.
          </p>
          {correctionError && (
            <p style={ERROR} data-testid="facts-corrections-error" role="alert">{correctionError}</p>
          )}
          <div style={ROW_BTNS}>
            <button
              type="button"
              style={canApply ? BTN_PRIMARY : { ...BTN_PRIMARY, ...DISABLED }}
              disabled={!canApply}
              onClick={handleApply}
              data-testid="facts-apply-corrections"
            >
              {correctionBusy ? "Updating your details…" : "Update my details"}
            </button>
            <button
              type="button"
              style={correctionBusy ? { ...BTN, ...DISABLED } : BTN}
              disabled={correctionBusy}
              onClick={handleCancel}
              data-testid="facts-corrections-cancel"
            >
              Cancel - keep my answers
            </button>
          </div>
        </div>
      )}

      {ownershipDisputed && !correctingOwnership && (
        ownershipFork === "changed" ? (
          <div style={PANEL("warn")} data-testid="ownership-changed-panel">
            <p style={PANEL_TITLE("warn")}>What did the ownership type change to?</p>
            <p style={PANEL_BODY("warn")}>
              We've recorded that your ownership type genuinely changed
              {ownershipChangeFrom ? ` from "${ownershipChangeFrom}"` : ""}. Tell us what it changed
              TO - we'll add the supporting documents to your checklist, then you can continue.
            </p>
            <select
              value={newOwnershipType}
              onChange={(e) => setNewOwnershipType(e.target.value)}
              data-testid="ownership-new-type"
              style={{ ...FIELD, border: "1px solid #FCD9A8", margin: "0 0 12px" }}
            >
              <option value="">Select the new ownership type…</option>
              {ownershipTypeOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <div style={ROW_BTNS}>
              <button
                type="button"
                style={newOwnershipType ? BTN_WARN : { ...BTN_WARN, ...DISABLED }}
                disabled={!newOwnershipType}
                onClick={() => newOwnershipType && onOwnershipChangeResolved(newOwnershipType)}
                data-testid="ownership-changed-confirm"
              >
                Confirm change
              </button>
              <button type="button" style={BTN} onClick={handleCancel} data-testid="ownership-changed-cancel">
                Cancel - keep my answers
              </button>
            </div>
          </div>
        ) : (
          <div style={PANEL("warn")} data-testid="ownership-fork-panel">
            <p style={PANEL_TITLE("warn")}>What changed about the ownership type?</p>
            <p style={PANEL_BODY("warn")}>
              Did we get the ownership type wrong, or did your company's ownership type genuinely change
              (for example a re-filing from private to public, or a conversion to a partnership/LLP)?
            </p>
            <div style={ROW_BTNS}>
              <button type="button" style={BTN_PRIMARY} onClick={() => setCorrectingOwnership(true)} data-testid="ownership-misclassified">
                You got it wrong - correct it
              </button>
              <button type="button" style={BTN_WARN} onClick={onOwnershipChanged} data-testid="ownership-genuinely-changed">
                It genuinely changed
              </button>
              <button type="button" style={BTN} onClick={handleCancel} data-testid="ownership-fork-cancel">
                Cancel
              </button>
            </div>
          </div>
        )
      )}

      {regNumberDisputed && !correctingRegNumber && (
        regNumberFork === "changed" ? (
          <div style={PANEL("warn")} data-testid="regnumber-changed-panel">
            <p style={PANEL_TITLE("warn")}>What's the new registration / company number?</p>
            <p style={PANEL_BODY("warn")}>
              We've recorded that your registration / company number genuinely changed
              {regNumberChangeFrom ? ` from "${regNumberChangeFrom}"` : ""}. Enter the new number - we'll
              add the supporting document to your checklist, then you can continue.
            </p>
            <input
              type="text"
              value={newRegNumber}
              onChange={(e) => setNewRegNumber(e.target.value)}
              data-testid="regnumber-new-value"
              placeholder="New registration / company number"
              style={{ ...FIELD, border: "1px solid #FCD9A8", margin: "0 0 12px" }}
            />
            <div style={ROW_BTNS}>
              <button
                type="button"
                style={newRegNumber.trim() ? BTN_WARN : { ...BTN_WARN, ...DISABLED }}
                disabled={!newRegNumber.trim()}
                onClick={() => newRegNumber.trim() && onRegNumberChangeResolved(newRegNumber)}
                data-testid="regnumber-changed-confirm"
              >
                Confirm change
              </button>
              <button type="button" style={BTN} onClick={handleCancel} data-testid="regnumber-changed-cancel">
                Cancel - keep my answers
              </button>
            </div>
          </div>
        ) : (
          <div style={PANEL("warn")} data-testid="regnumber-fork-panel">
            <p style={PANEL_TITLE("warn")}>What changed about the registration number?</p>
            <p style={PANEL_BODY("warn")}>
              Did we get the registration / company number wrong, or did it genuinely change (for example a
              re-registration or conversion that issued a new number)?
            </p>
            <div style={ROW_BTNS}>
              <button type="button" style={BTN_PRIMARY} onClick={() => setCorrectingRegNumber(true)} data-testid="regnumber-misclassified">
                You got it wrong - correct it
              </button>
              <button type="button" style={BTN_WARN} onClick={onRegNumberChanged} data-testid="regnumber-genuinely-changed">
                It genuinely changed
              </button>
              <button type="button" style={BTN} onClick={handleCancel} data-testid="regnumber-fork-cancel">
                Cancel
              </button>
            </div>
          </div>
        )
      )}
    </div>
  );
}

export default FoundationalFactsGate;
```

- [ ] **Step 4: Run to verify it passes**

Run: `CI=true npx react-scripts test --watchAll=false src/components/companyConfirm/__tests__/FoundationalFactsGate.test.jsx`
Expected: PASS, 10 tests.

Note: `ApplicantPage.jsx` still passes `onReset` and no correction props until Task 7; React ignores the unknown prop, and `onApplyCorrections` is only called from a button that cannot be enabled without the edit values Task 7 supplies. Do not run or change `ApplicantPage.render.test.jsx` here.

- [ ] **Step 5: Commit**

```bash
git add src/components/companyConfirm/FoundationalFactsGate.jsx src/components/companyConfirm/__tests__/FoundationalFactsGate.test.jsx
git commit -m "feat(applicant): correct a foundational fact inline instead of restarting the application"
```

---

### Task 7: The correction engine in `src/App.js`

**Files:**
- Modify: `src/App.js`
- Modify: `src/components/applicant/ApplicantPage.jsx`
- Modify: `src/components/applicant/__tests__/ApplicantPage.render.test.jsx`

**Interfaces:**
- Consumes: Task 2 `planCorrection`; Task 3 `POST /api/search-attempt` → `{ allowed, attemptsUsed, remaining }`, `POST /api/research-attempt` `{ applicationId }` → same; Task 4 `saveReason`, `customer_searches`; Task 6 gate props; `postReresearchFailureFlag({ submissionId, dossierId, jurisdiction, stage, reason, headers })`; `CONTACT_ADMIN_MSG`, `evaluateSearchCap`.
- Produces (inside `KYCAgent`):
  - `doResearch(journeyOverride, { overrides, correction } = {})` → resolves `{ research, coverage }` on success, `null` on failure. `overrides` = `{ companyName, registrationNumber, countryCode, entityType, ownershipType }`.
  - `buildDossierPayload(overrides = {})`, `saveDossier({ overrides, reason } = {})` — `overrides` may set `companyName`, `countryCode`, `entityType`, `ownershipType`, `regNumber`, `regNumberSource`, `research`, `coverage`.
  - `applyCorrections(corrections)`; state `correctionBusy`, `correctionError`; `seededBy` becomes settable.
  - `ApplicantPage` props: `onApplyCorrections`, `correctionBusy`, `correctionError`, `countryOptions`, `entityTypeOptions`.

This task is behaviour-heavy. Keep every change inside the named functions and call sites; do not reformat unrelated code.

- [ ] **Step 1: Write the failing render tests**

In `src/components/applicant/__tests__/ApplicantPage.render.test.jsx`:

1. Replace the existing test `"hides the applicant section when a fact is disputed, and restores it"` with:

```jsx
  it("hides the applicant section while a fact is being corrected, and restores it", async () => {
    await driveToApplicant();
    const gate = screen.getByTestId("foundational-facts-gate");
    const nameFact = within(gate).getByLabelText(/Confirm Company legal name/i);

    fireEvent.click(nameFact);
    await settle(0);
    expect(screen.queryByText("Tell us about yourself")).not.toBeInTheDocument();
    expect(screen.getByTestId("correct-companyName")).toBeInTheDocument();
    expect(screen.queryByText(/This restarts your application/)).not.toBeInTheDocument();

    fireEvent.click(nameFact);
    await settle(0);
    expect(screen.getByText("Tell us about yourself")).toBeInTheDocument();
  });
```

2. Append a new describe block at the end of the file:

```jsx
describe("correcting a foundational fact", () => {
  const researchBody = { content: [{ type: "text", text: "{\"companyName\":\"Britannia Holdings Limited\",\"found\":[]}" }], usage: { input_tokens: 1, output_tokens: 1 } };

  function routeFetch(routes) {
    global.fetch = jest.fn((url, init) => {
      const path = String(url).split("?")[0];
      const handler = routes[path];
      if (!handler) return Promise.reject(new Error("offline test"));
      return Promise.resolve(handler(init));
    });
  }
  const calls = (path) => global.fetch.mock.calls.filter(([url]) => String(url).split("?")[0] === path);
  const ok = (body) => ({ ok: true, status: 200, json: async () => body });

  beforeEach(() => {
    window.confirm = jest.fn(() => true);
  });

  it("entity type alone re-derives: no search, no attempt spent, gate re-confirmed", async () => {
    await driveToApplicant();
    routeFetch({});
    const gate = screen.getByTestId("foundational-facts-gate");
    fireEvent.click(within(gate).getByLabelText(/Confirm Entity type/i));
    await settle(0);
    const select = screen.getByTestId("correct-entityType");
    const other = Array.from(select.options).find((o) => o.value && o.value !== select.value);
    expect(other).toBeTruthy();
    fireEvent.change(select, { target: { value: other.value } });
    fireEvent.click(screen.getByTestId("facts-apply-corrections"));
    await settle(5000);

    expect(calls("/api/research")).toHaveLength(0);
    expect(calls("/api/research-attempt")).toHaveLength(0);
    expect(calls("/api/search-attempt")).toHaveLength(0);
    expect(screen.getByText("Tell us about yourself")).toBeInTheDocument();
  });

  it("a company-name correction spends an attempt and re-researches with the corrected name, staying on the page", async () => {
    await driveToApplicant();
    routeFetch({
      "/api/research-attempt": () => ok({ allowed: true, attemptsUsed: 1, remaining: 1 }),
      "/api/research": () => ok(researchBody),
    });
    const gate = screen.getByTestId("foundational-facts-gate");
    fireEvent.click(within(gate).getByLabelText(/Confirm Company legal name/i));
    await settle(0);
    fireEvent.change(screen.getByTestId("correct-companyName"), { target: { value: "Britannia Holdings Limited" } });
    fireEvent.click(screen.getByTestId("facts-apply-corrections"));
    await settle(5000);
    await settle(5000);

    expect(calls("/api/research-attempt")).toHaveLength(1);
    const attemptBody = JSON.parse(calls("/api/research-attempt")[0][1].body);
    expect(attemptBody.applicationId).toMatch(/^[0-9a-f-]{36}$/i);
    const researchCalls = calls("/api/research");
    expect(researchCalls.length).toBeGreaterThanOrEqual(1);
    const first = JSON.parse(researchCalls[0][1].body);
    expect(first.mode).toBe("research");
    expect(first.companyName).toBe("Britannia Holdings Limited");
    expect(first.sourcedDocuments).toEqual([]);
    expect(screen.getByTestId("foundational-facts-gate")).toBeInTheDocument();
    expect(screen.queryByText(/We couldn't complete that search/)).not.toBeInTheDocument();
  });

  it("keeps the applicant's typed details through a re-search", async () => {
    await driveToApplicant();
    fireEvent.change(gapField("email"), { target: { value: "jane@example.com" } });
    routeFetch({
      "/api/research-attempt": () => ok({ allowed: true, attemptsUsed: 1, remaining: 1 }),
      "/api/research": () => ok(researchBody),
    });
    const gate = screen.getByTestId("foundational-facts-gate");
    fireEvent.click(within(gate).getByLabelText(/Confirm Company legal name/i));
    await settle(0);
    fireEvent.change(screen.getByTestId("correct-companyName"), { target: { value: "Britannia Holdings Limited" } });
    fireEvent.click(screen.getByTestId("facts-apply-corrections"));
    await settle(5000);
    await settle(5000);

    expect(gapField("email")).toHaveValue("jane@example.com");
  });

  it("with no searches left: no research, the cap message, manual entry offered", async () => {
    await driveToApplicant();
    routeFetch({
      "/api/research-attempt": () => ok({ allowed: false, attemptsUsed: 2, remaining: 0 }),
      "/api/research": () => ok(researchBody),
    });
    const gate = screen.getByTestId("foundational-facts-gate");
    fireEvent.click(within(gate).getByLabelText(/Confirm Company legal name/i));
    await settle(0);
    fireEvent.change(screen.getByTestId("correct-companyName"), { target: { value: "Britannia Holdings Limited" } });
    fireEvent.click(screen.getByTestId("facts-apply-corrections"));
    await settle(5000);

    expect(calls("/api/research")).toHaveLength(0);
    expect(screen.getAllByText(/You've used your available searches/).length).toBeGreaterThan(0);
  });

  it("a failed re-search falls back to manual entry and flags the failure against the application", async () => {
    await driveToApplicant();
    routeFetch({
      "/api/research-attempt": () => ok({ allowed: true, attemptsUsed: 1, remaining: 1 }),
      "/api/research": () => ({ ok: false, status: 500, json: async () => ({ error: "research_failed" }) }),
      "/api/change-events": () => ok({ success: true }),
    });
    const gate = screen.getByTestId("foundational-facts-gate");
    fireEvent.click(within(gate).getByLabelText(/Confirm Company legal name/i));
    await settle(0);
    fireEvent.change(screen.getByTestId("correct-companyName"), { target: { value: "Britannia Holdings Limited" } });
    fireEvent.click(screen.getByTestId("facts-apply-corrections"));
    await settle(5000);
    await settle(5000);

    expect(screen.getAllByText(/We couldn't complete that search just now/).length).toBeGreaterThan(0);
    const flags = calls("/api/change-events").map(([, init]) => JSON.parse(init.body)).filter((e) => e.fieldId === "reresearch.fallback");
    expect(flags).toHaveLength(1);
    expect(flags[0].submissionId).toBeTruthy();
  });
});
```

The `gapField("email")` helper already exists in the file; if the email placeholder differs, read the applicant section and use the existing applicant email field's placeholder — do not weaken the assertion. If `driveToApplicant` leaves `onboardingSubmissionId` unset (Dummy Research path), make `doDummyResearch` set it the same way `doResearch` does (`setOnboardingSubmissionId(genUUID())` when null) and mention it in your report.

- [ ] **Step 2: Run to verify they fail**

Run: `CI=true npx react-scripts test --watchAll=false src/components/applicant/__tests__/ApplicantPage.render.test.jsx`
Expected: FAIL — no correction inputs wired; no `applyCorrections`.

- [ ] **Step 3: State and imports in `src/App.js`**

1. Add to the imports near `./reresearch/searchPolicy`:

```js
import { planCorrection } from "./reresearch/correctionPlan";
```

2. Replace `const [seededBy] = useState("analyst");` and its comment with:

```js
  // 'customer' once the customer has corrected a foundational fact; recorded on
  // the dossier as seeded_by and used to route a failed re-search to manual entry.
  const [seededBy, setSeededBy] = useState("analyst");
```

3. Directly after `const [regNumberChangeDeclared, setRegNumberChangeDeclared] = useState(null);`, add:

```js
  // Inline correction of the foundational facts (Part 3): busy while a re-search
  // runs from the Applicant page, and the message shown in the gate.
  const [correctionBusy, setCorrectionBusy] = useState(false);
  const [correctionError, setCorrectionError] = useState("");
```

- [ ] **Step 4: `doResearch` takes explicit overrides and returns its result**

In `doResearch`:

1. Change the signature to `const doResearch = async (journeyOverride, { overrides = null, correction = false } = {}) => {`.
2. Immediately after the demo confirm guard block, add:

```js
    // A correction passes the corrected facts EXPLICITLY — state setters from the
    // same click have not re-rendered yet, so the closure values are stale.
    const facts = overrides
      ? {
          companyName: overrides.companyName,
          countryCode: overrides.countryCode,
          entityType: overrides.entityType,
          ownershipType: overrides.ownershipType,
          regNumber: overrides.registrationNumber || "",
        }
      : { companyName, countryCode, entityType, ownershipType, regNumber };
    const factsCountry = COUNTRIES.find((c) => c.code === facts.countryCode);
```

3. Within the body of `doResearch` ONLY, replace every read of `companyName`, `countryCode`, `entityType`, `ownershipType`, `regNumber` and `countryObj` with `facts.companyName`, `facts.countryCode`, `facts.entityType`, `facts.ownershipType`, `facts.regNumber` and `factsCountry` respectively (including the validation lines, `trackEvent` calls, `getSchemaFromConfig`, the request bodies, `classifyWebRow`'s `classifySourceFromConfig` call, and `selfSourcedToRows`). Setters and other functions are untouched.
4. Change `setLoading(true); setStep(S.research); setLoaderIdx(0);` to:

```js
    setLoading(true); setLoaderIdx(0);
    // A correction stays on the Applicant page (the gate shows its own busy state).
    if (!correction) setStep(S.research);
    if (correction) {
      // Documents found for the wrong company must not follow the customer.
      setSelfSourceResults(null);
      setDocSearchResults(null);
      setAcceptedDocTypes(new Set());
    }
```

5. Change `const runDocPhase = journey === "ai_documents" && hasAnyDocs;` to `const runDocPhase = !correction && journey === "ai_documents" && hasAnyDocs;`.
6. Change the `acceptedDocs` line to:

```js
      const acceptedDocs = correction ? [] : (docSearchResults?.documents || [])
        .filter(d => acceptedDocTypes.has(d.type));
```

7. Change `const selfSourcedRows = selfSourcedToRows(selfSourceResults?.selfSourcedFields, schema);` to:

```js
      const selfSourcedRows = correction ? [] : selfSourcedToRows(selfSourceResults?.selfSourcedFields, schema);
```

8. Change `setOnboardingSubmissionId(genUUID());` to:

```js
      // A correction keeps the application id: the fresh-customer retry count and
      // the change_events trail are keyed on it.
      if (!correction || !onboardingSubmissionId) setOnboardingSubmissionId(genUUID());
```

9. Change `gapRef.current = {};` + `setFormVersion(v => v + 1);` in the success block to:

```js
      // A correction keeps everything the customer already typed (applicant
      // details and gap answers live in gapRef).
      if (!correction) {
        gapRef.current = {};
        setFormVersion(v => v + 1);
      }
```

10. Change `setStep(agentType === "preboarding" ? S.confirm : S.applicant);` to:

```js
      if (!correction) setStep(agentType === "preboarding" ? S.confirm : S.applicant);
      return { research: { ...parsed, found: validatedFound }, coverage: cov };
```

11. Replace the whole `catch (err) { ... }` block with:

```js
    } catch (err) {
      if (correction || seededBy === "customer") {
        fallBackToManual({
          stage: "re_research",
          reason: err.message,
          message: "We couldn't complete that search just now. You can continue by entering your application manually below.",
          journey,
        });
      } else {
        setError("Research failed: " + err.message);
        setStep(S.input);
      }
      return null;
    }
```

- [ ] **Step 5: Fallback, attempt and correction handlers**

Directly after `cancelFactDispute` (in the foundational-facts handler section), add:

```js
  // Re-search could not run (failure or no searches left): never strand the
  // customer. Flag it as a data point against whichever id the application has,
  // then open manual entry.
  const fallBackToManual = ({ stage, reason, message, journey }) => {
    postReresearchFailureFlag({
      submissionId: dossierId || onboardingSubmissionId,
      dossierId,
      jurisdiction: countryCode,
      stage,
      reason,
      headers: getDossierAuthHeaders(),
    });
    setError(message);
    setCorrectionError(message);
    setJourneyOpen(true);
    setStep(stepsFor(journey || journeyType || "ai_only").input);
  };

  // Ask the server for one of the customer's two re-searches. Link customers
  // count on the dossier; fresh customers on their application id. Anything but
  // an explicit allow is a refusal.
  const consumeCustomerSearch = async () => {
    try {
      const resp = dossierId
        ? await fetch("/api/search-attempt", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...getDossierAuthHeaders() },
            body: JSON.stringify({ dossierId }),
          })
        : onboardingSubmissionId
          ? await fetch("/api/research-attempt", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ applicationId: onboardingSubmissionId }),
            })
          : null;
      if (!resp) return { allowed: false };
      const data = await resp.json();
      if (Number.isFinite(data.attemptsUsed)) setSearchAttempts(data.attemptsUsed);
      return { allowed: resp.ok && data.allowed === true };
    } catch (_) {
      return { allowed: false };
    }
  };

  // The customer corrected one or more foundational facts. Entity type alone
  // re-derives the schema; anything else re-researches with the corrected
  // values and spends one server-counted search. Never resets the application.
  const applyCorrections = async (corrections) => {
    const current = {
      companyName: research?.companyName || companyName,
      registrationNumber: regNumber,
      countryCode,
      entityType,
      ownershipType,
    };
    const plan = planCorrection(current, corrections);
    if (plan.action === "none") { cancelFactDispute(); return; }
    if (plan.action === "invalid") {
      setCorrectionError("Please fill in every value you're correcting.");
      return;
    }

    const next = plan.next;
    setCorrectionError("");
    setSeededBy("customer");
    setCompanyName(next.companyName);
    setCountryCode(next.countryCode);
    setEntityType(next.entityType);
    setOwnershipType(next.ownershipType);
    if (plan.changed.includes("registrationNumber")) {
      setRegNumber(next.registrationNumber);
      setRegNumberSource(next.registrationNumber ? "customer" : null);
    }

    if (plan.action === "re_derive") {
      let schema = null;
      try {
        schema = getSchemaFromConfig(next.countryCode, next.entityType, tenantConfig);
        setActiveSchema(schema);
      } catch (_) { /* leave the schema as-is */ }
      cancelFactDispute();
      if (dossierId) {
        await saveDossier({ overrides: { entityType: next.entityType }, reason: "customer_correction" });
      }
      return;
    }

    // ponytail: demo mode never spends a paid search — the corrected facts are
    // kept and the existing (dummy) research stands. Real runs go below.
    if (demoMode) { cancelFactDispute(); return; }

    setCorrectionBusy(true);
    try {
      const attempt = await consumeCustomerSearch();
      if (!attempt.allowed) {
        fallBackToManual({ stage: "search_cap", reason: "no_searches_left", message: CONTACT_ADMIN_MSG });
        return;
      }
      const outcome = await doResearch(journeyType || "ai_only", { overrides: next, correction: true });
      if (!outcome) return;
      cancelFactDispute();
      if (dossierId) {
        await saveDossier({
          overrides: {
            companyName: next.companyName,
            countryCode: next.countryCode,
            entityType: next.entityType,
            ownershipType: next.ownershipType,
            regNumber: next.registrationNumber,
            regNumberSource: next.registrationNumber ? "customer" : null,
            research: outcome.research,
            coverage: outcome.coverage,
          },
          reason: "customer_correction",
        });
      }
    } finally {
      setCorrectionBusy(false);
    }
  };
```

- [ ] **Step 6: `buildDossierPayload` / `saveDossier` accept overrides; customers never see the analyst screen**

1. Change `const dossierCompany = () => ({` block to:

```js
  const dossierCompany = (v = {}) => {
    const name = v.companyName ?? (v.research?.companyName || research?.companyName || companyName);
    const code = v.countryCode ?? countryCode;
    const country = COUNTRIES.find((c) => c.code === code);
    return { name, code, countryName: country ? country.name : code };
  };
```

(Check `COUNTRIES` is in scope in `App.js` — it is used for `countryObj`.)

2. Change `const buildDossierPayload = () => {` to `const buildDossierPayload = (overrides = {}) => {` and add as its first lines:

```js
    // Explicit values from a correction win over (possibly stale) closure state.
    const v = {
      companyName: overrides.companyName,
      countryCode: overrides.countryCode,
      research: overrides.research ?? research,
      coverage: overrides.coverage ?? coverage,
      entityType: overrides.entityType ?? entityType,
      ownershipType: overrides.ownershipType ?? ownershipType,
      regNumber: overrides.regNumber ?? regNumber,
      regNumberSource: overrides.regNumberSource !== undefined ? overrides.regNumberSource : regNumberSource,
    };
```

Within `buildDossierPayload` only, replace reads of `research`, `coverage`, `entityType`, `ownershipType`, `regNumber`, `regNumberSource` with `v.research`, `v.coverage`, `v.entityType`, `v.ownershipType`, `v.regNumber`, `v.regNumberSource`, and every `dossierCompany()` call with `dossierCompany(v)`.

3. Delete the `searchAttempts: ...` line (and its comment line) from the returned object.

4. Change `const saveDossier = async () => {` to `const saveDossier = async ({ overrides = {}, reason } = {}) => {`, change `const payload = buildDossierPayload();` to:

```js
    const payload = { ...buildDossierPayload(overrides), ...(reason ? { saveReason: reason } : {}) };
```

5. In `saveDossier`, change `setShowDossierView(true);` to:

```js
    // Only the analyst works in the dossier screen; a customer's save (a
    // correction) stays on the page they are on.
    if (agentType === "preboarding") setShowDossierView(true);
```

and change `companyName: dossierCompany().name,` in the `trackEvent` call to `companyName: payload.company.name,`.

6. In the auto-save `useEffect` condition, change `((agentType === "preboarding" && preboardingUnlocked) || seededBy === "customer") &&` to `agentType === "preboarding" && preboardingUnlocked &&` (a correction saves explicitly; a fresh customer has no dossier to save), and update the comment above it to say so.

7. Every existing call site of `saveDossier()` with no arguments keeps working (defaults). `DossierView.jsx` calls `dossierCompany()` with no argument — still valid.

- [ ] **Step 7: `proceedFromJourney` uses the server counter**

Replace the block from `// A customer re-search consumes an attempt` through the closing `}` of `if (isSearchCard && seededBy === "customer") { ... }` with:

```js
    // A customer who has corrected facts spends a server-counted search on any
    // search card; the server refuses the third.
    if (isSearchCard && seededBy === "customer") {
      const attempt = await consumeCustomerSearch();
      if (!attempt.allowed) {
        setError(CONTACT_ADMIN_MSG);
        return;
      }
    }
```

and change `const proceedFromJourney = () => {` to `const proceedFromJourney = async () => {`. Confirm with the Grep tool that every caller of `proceedFromJourney` ignores its return value (an `onClick` handler).

- [ ] **Step 8: Remove the dead re-derive path**

Use the Grep tool for `applyReDerive`, `pendingReseedMode`, `setPendingReseedMode` across `src/`. `pendingReseedMode` is never set to a non-null value anywhere, so the re-derive UI it gated is unreachable. Delete `applyReDerive`, the `pendingReseedMode` state, and the props that pass them (and their uses in the receiving component) — ONLY if the grep confirms nothing sets `pendingReseedMode` to a non-null value; otherwise leave them and say why in your report.

- [ ] **Step 9: Landing restores the count and registration number**

In `loadDossierAndStartOnboarding`, directly after `setDossierOwnedBy(d.owned_by || null);`, add:

```js
        // The customer's server-counted re-searches, and the registration number
        // the analyst researched with (so a correction compares against it). The
        // source stays null: a restored number is not customer-typed.
        setSearchAttempts(Number(d.customer_searches) || 0);
        setRegNumber(d.raw_research?.registrationNumber || "");
        setRegNumberSource(null);
```

- [ ] **Step 10: Wire the gate in `ApplicantPage.jsx` and pass the props from `App.js`**

In `src/components/applicant/ApplicantPage.jsx`:

1. Add to the destructured props (next to `resolveRegNumberChange`): `onApplyCorrections, correctionBusy = false, correctionError = "", countryOptions = [], entityTypeOptions = [],`.
2. In the `facts` array add `editValue` to each item: `companyName` → `research?.companyName || companyName || ""`; `registrationNumber` → `regValue`; `country` → `countryCode || ""`; `entityType` → `entityType || ""`; `ownershipType` → `ownershipType || ""`.
3. On `<FoundationalFactsGate ...>`: delete `onReset={resetAll}`; add

```jsx
          countryOptions={countryOptions}
          entityTypeOptions={entityTypeOptions}
          onApplyCorrections={onApplyCorrections}
          correctionBusy={correctionBusy}
          correctionError={correctionError}
```

4. Update the comment above `fourDisputed` to say a disputed fact now opens its correction input (no reset).

In `src/App.js`, on the `<ApplicantPage ... />` element add:

```jsx
            onApplyCorrections={applyCorrections}
            correctionBusy={correctionBusy}
            correctionError={correctionError}
            countryOptions={COUNTRIES.map((c) => ({ value: c.code, label: c.name }))}
            entityTypeOptions={(tenantConfig?.entityTypes || []).filter((e) => e.active !== false).map((e) => ({ value: e.id, label: e.label || e.id }))}
```

Check how the Company Lookup page builds its entity-type options (Grep `entityTypes` in `src/App.js` / `src/components/companyLookup`) and use the same source and label field if it differs from the above.

- [ ] **Step 11: Run the tests and build**

Run: `CI=true npx react-scripts test --watchAll=false src/components/applicant src/components/companyConfirm src/__tests__/demoGuard.test.jsx`
Expected: PASS.

Run: `CI=true npx react-scripts test --watchAll=false`
Expected: PASS. Re-run `PolicySimulator.test.jsx`, `appMounts.test.jsx`, `noTenantLanding.integration.test.jsx` in isolation before calling a failure a regression.

Run: `npm run test:node` and `npm run build`
Expected: PASS; `Compiled successfully.`

- [ ] **Step 12: Commit**

```bash
git add src/App.js src/components/applicant/ApplicantPage.jsx src/components/applicant/__tests__/ApplicantPage.render.test.jsx
git commit -m "feat(reresearch): customer corrections re-derive or re-research in place with server-counted retries"
```

---

### Task 8: Start-over keeps the dossier link; submissions carry it

**Files:**
- Modify: `src/App.js` (`resetAll`, `submitApplication`)
- Create: `src/__tests__/startOverAndSubmitLink.test.jsx`

**Interfaces:**
- Consumes: Task 5 `/api/submit` `dossierId` + credential; `clearDraft` from `./utils/submissionDraft`.
- Produces:
  - `resetAll()` also clears `companyName`, `countryCode`, `entityType`, `ownershipType`, `seededBy` (→ `'analyst'`), `correctionBusy`, `correctionError`, and calls `clearDraft()`. When the customer arrived by link (`landedViaLink && dossierId`), it keeps `dossierId`, `landedViaLink` and `searchAttempts`; otherwise it clears them (`searchAttempts` → 0).
  - `/api/submit` request carries `dossierId` and `getDossierAuthHeaders(tenantId)`.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/startOverAndSubmitLink.test.jsx`:

```jsx
/**
 * Start Over clears the lookup and the saved draft (the shared resetAll root),
 * and a submission names its source dossier with the customer's credential.
 * Drives the real app the same way ApplicantPage.render.test.jsx does.
 */
import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import KYCAgent from "../App";
import * as submissionDraft from "../utils/submissionDraft";

jest.setTimeout(60000);

beforeEach(() => {
  global.fetch = jest.fn(() => Promise.reject(new Error("offline test")));
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

const settle = async (ms = 5000) => {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
};

function pickOption(labelText) {
  const option = screen
    .getAllByText(labelText, { exact: false })
    .find((el) => el.children.length === 0);
  expect(option).toBeTruthy();
  fireEvent.mouseDown(option.parentElement);
}

async function driveToApplicant() {
  await act(async () => {
    render(<KYCAgent />);
  });
  await settle(0);
  fireEvent.change(screen.getByPlaceholderText(/Tesco PLC/i), { target: { value: "Britannia Group Limited" } });
  fireEvent.change(screen.getByPlaceholderText(/Select or type entity type/i), { target: { value: "Corporate" } });
  pickOption("🏛 Corporate");
  fireEvent.focus(screen.getByPlaceholderText(/Select ownership type/i));
  pickOption("Private Limited Company");
  fireEvent.change(screen.getByPlaceholderText(/Select or type country/i), { target: { value: "United King" } });
  pickOption("GB - United Kingdom");
  fireEvent.click(screen.getByRole("button", { name: /Dummy Research/i }));
  await settle(5000);
}

test("Start Over from the Applicant page returns to an empty lookup and clears the saved draft", async () => {
  const clearDraft = jest.spyOn(submissionDraft, "clearDraft");
  await driveToApplicant();
  fireEvent.click(screen.getByRole("button", { name: /^Start Over$/ }));
  await settle(0);

  expect(clearDraft).toHaveBeenCalled();
  expect(screen.getByPlaceholderText(/Tesco PLC/i)).toHaveValue("");
  expect(screen.getByPlaceholderText(/Select or type country/i)).toHaveValue("");
});
```

If `jest.spyOn` cannot spy on the ES module export under CRA's Babel config, replace the spy with an assertion that the draft storage key used by `src/utils/submissionDraft.js` is absent from `localStorage` after Start Over (read that file for the key) — do not drop the draft assertion.

Add a second test to the same file for the submit link only if the existing submit render harness (Grep for a test that reaches `/api/submit`, e.g. in `src/__tests__/`) can be reused in under ~40 lines; otherwise cover the submit body with the Step 3 code review and say so in your report.

- [ ] **Step 2: Run to verify it fails**

Run: `CI=true npx react-scripts test --watchAll=false src/__tests__/startOverAndSubmitLink.test.jsx`
Expected: FAIL — the lookup still holds the old company / draft not cleared.

- [ ] **Step 3: Implement**

1. In `resetAll`, directly after `setStep(STEPS.input); setResearch(null); setActiveSchema(null);`, add:

```js
    // A brand-new application starts from an empty lookup and no saved draft —
    // this is the shared root for Start Over and Start New Application.
    setCompanyName(""); setCountryCode(""); setEntityType(""); setOwnershipType("");
    clearDraft();
    setSeededBy("analyst"); setCorrectionBusy(false); setCorrectionError("");
    // A customer who arrived by link stays attached to the analyst's dossier
    // (and keeps its server-counted searches) when starting again.
    const keepDossierLink = landedViaLink && !!dossierId;
```

2. In `resetAll`, replace `setDossierId(null);` with `if (!keepDossierLink) { setDossierId(null); setSearchAttempts(0); }` and replace `setLandedViaLink(false);` (and its comment) with:

```js
    // Only a genuine lookup journey restores the full step bar; a link customer
    // stays on the link journey.
    if (!keepDossierLink) setLandedViaLink(false);
```

3. Confirm `clearDraft` is already imported in `App.js` (it is: `import { saveDraft, loadDraft, clearDraft } from "./utils/submissionDraft";`).

4. In `submitApplication`, change the `/api/submit` fetch headers to `headers: { "Content-Type": "application/json", ...getDossierAuthHeaders(tenantId) },` and add to the body, directly after `tenantId,`:

```js
          // The analyst dossier this application came from. The server keeps it
          // only when this tab holds that dossier's customer link credential.
          dossierId: dossierId || null,
```

5. The "Start New Application" button's inline `setCompanyName("") ...` calls are now redundant with `resetAll`; leave them (harmless) — do not refactor that button.

- [ ] **Step 4: Run to verify it passes**

Run: `CI=true npx react-scripts test --watchAll=false src/__tests__/startOverAndSubmitLink.test.jsx src/components/applicant src/components/preboarding`
Expected: PASS.

Run: `CI=true npx react-scripts test --watchAll=false`
Expected: PASS (re-run known-flaky suites in isolation first).

Run: `npm run build`
Expected: `Compiled successfully.`

- [ ] **Step 5: Commit**

```bash
git add src/App.js src/__tests__/startOverAndSubmitLink.test.jsx
git commit -m "feat(applicant): starting over clears the lookup and draft but keeps a link customer's dossier; submissions carry the dossier link"
```

---

### Task 9: Verification, deploy gate and backlog

**Files:**
- Modify: `docs/BACKLOG.md`

- [ ] **Step 1: Backend suite**

Run: `npm run test:node`
Expected: PASS, 0 failures (now includes `src/reresearch/tests`).

- [ ] **Step 2: Frontend suite**

Run: `CI=true npx react-scripts test --watchAll=false`
Expected: PASS. Re-run `PolicySimulator.test.jsx`, `appMounts.test.jsx`, `noTenantLanding.integration.test.jsx` in isolation before calling a failure a regression.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: `Compiled successfully.`

- [ ] **Step 4: Invariant checks (Grep tool, not `npx rg`)**

- `search_attempts` in `api/` and `src/` (excluding tests and migrations) — expected: no writes remain (`api/save-dossier.js` must not mention it).
- `facts-reset-confirm|This restarts your application` in `src/` — expected: no matches.
- `onReset` in `src/components` — expected: no matches.
- `seededBy === "customer"` in `src/App.js` — expected: only in `doResearch`'s catch and `proceedFromJourney`.

- [ ] **Step 5: Update the backlog**

In `docs/BACKLOG.md`, add under **Open dependencies** (after DEP-4):

```markdown
### DEP-5 — Part 3 deploy gate: migration 027
- **Category:** Deploy · **Priority:** P1 · **Status:** OPEN (manual step for the owner)
- **What:** Apply `db/migrations/027_customer_corrections.sql` to each database (`node db/apply.js db/migrations/027_customer_corrections.sql`) BEFORE deploying Part 3.
- **Why:** Without it, dossier updates fail (the snapshot insert targets `entity_dossier_versions`), the customer re-search counter reads a missing `customer_searches` column, and submissions fail on `onboarding_sessions.dossier_id`.
```

Add a new entry:

```markdown
### RERES-2 — `/api/research` does not itself enforce the customer's 2-search cap
- **Category:** Cost · **Priority:** P3 · **Status:** OPEN (found in Part 3 plan 2026-09-17)
- **What:** The cap lives in `/api/search-attempt` and `/api/research-attempt`, which the client calls before re-researching. A client that skips that call can still run research, bounded only by Part 2's per-caller rate limit. Real fix: have `/api/research` require a one-time attempt grant (e.g. a short-lived signed nonce issued by the attempt endpoints).
- **Also:** fresh-customer counts are keyed by a client-held application id, so a new id gets a new allowance (PLAT-7 territory).
- **Area:** `api/research.js`, `api/search-attempt.js`, `api/research-attempt.js`.
```

- [ ] **Step 6: Commit**

```bash
git add docs/BACKLOG.md
git commit -m "docs: Part 3 deploy gate (migration 027) and research cap follow-up"
```

---

## Manual QA checklist (owner)

1. Analyst: research a company at `/preboarding?tenant=nium`, save, send an invite, open the link in a private window.
2. Customer: untick **Company legal name**, type a corrected name, **Update my details** — the page stays put, shows "Updating your details…", then the gate re-appears confirmed with the new name; applicant details you typed are still there.
3. Customer: untick **Entity type** only, pick another type, **Update my details** — no search runs (network tab shows no `/api/research`).
4. Customer: correct the name twice more — the third time shows "You've used your available searches…" and manual entry.
5. Analyst: open the dossier — "Review only" banner; Save/Invite disabled.
6. Refresh mid-flow as the customer — the link still loads; the search count is remembered.
7. Customer: submit — the application reaches Done; in Neon, `onboarding_sessions.dossier_id` is the dossier id and `entity_dossier_versions` holds the analyst's original.
8. "Start Over" on a fresh (no-link) journey — the lookup page is empty.
