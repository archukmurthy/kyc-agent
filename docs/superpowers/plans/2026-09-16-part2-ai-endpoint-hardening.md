# Part 2 — AI-Endpoint Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop every Claude-spending endpoint from accepting client-authored prompts, models or tools, and put a per-caller rate limit in front of all of them.

**Architecture:** `/api/research` becomes a CommonJS handler that takes structured input (`mode` + company facts), loads the tenant's stored config, and builds the prompt server-side with the same `src/pipeline.js` builders the browser used. A new `lib/rateLimit.js` (fixed window over `lib/storage.js`) keys callers by verified analyst tenant, verified customer dossier, or IP. The policy simulator sends its structured form and the server builds the message; the benchmark requires the tenant admin credential.

**Tech Stack:** Node 24 CommonJS (`api/`, `lib/`), CRA React 18 (`src/`), `node --test`, Jest + Testing Library, Neon Postgres (`research_cache`), `lib/storage.js` (KV / Redis / filesystem).

## Global Constraints

- **CommonJS in `api/` and `lib/`** (`module.exports` / `require`), so `src/setupProxy.js` can mount the same handlers for `npm start`. `api/research.js` is currently ESM and is converted.
- **Every new/changed handler is registered in `src/setupProxy.js`.** No hand-copied handler bodies there (the existing research copy is deleted).
- **Tests:** backend → `*.nodetest.js` with injected fakes (`__setDeps`), run by `npm run test:node` (glob `lib/__tests__/*.nodetest.js api/__tests__/*.nodetest.js`); frontend → jest render tests asserting real DOM behaviour. Every new node test file must be reachable from the `test:node` glob.
- **No new runtime dependency.**
- **Secrets** stay server-side; new env vars are documented in `.env.example` with placeholder values.
- **Constant-time comparison** (`crypto.timingSafeEqual`) for every secret/signature comparison (reuse `lib/auth.js#verifyEnvBearer` / `api/config.js#authorizeAdmin`; do not hand-roll `===` on a new secret).
- **Tenant resolution stays 3-strict**: no `"nium"` fallback anywhere, client or server.
- **Inline styles only** in React; match the surrounding file's conventions (the policy simulator uses its existing Tailwind class names).
- **Refs, not state, for gap/stakeholder form values** — do not lift to `useState`. `src/App.js` hook order is load-bearing: do not add, remove or reorder hooks.
- **Never call a real paid API in tests.** Every Anthropic call is behind an injected fake or an unset `ANTHROPIC_API_KEY`.
- **`client_prompt_not_allowed`**: `prompt`, `messages`, `model`, `tools`, `max_tokens` in a `/api/research` body → `400 { error: "client_prompt_not_allowed" }`.
- **Rate-limit defaults (per hour, env-tunable):** research 40 (`RATE_LIMIT_RESEARCH`), doc-search 40 (`RATE_LIMIT_DOC_SEARCH`), self-source 40 (`RATE_LIMIT_SELF_SOURCE`), ubo-discovery 20 (`RATE_LIMIT_UBO_DISCOVERY`), generate-policy 10 (`RATE_LIMIT_GENERATE_POLICY`), analyst bucket 200 (`RATE_LIMIT_ANALYST`). Exceeded → `429 { error: "rate_limited", retryAfterSeconds }` + `Retry-After`. Client copy: `Too many requests — please try again in N minutes`.
- **Storage keys** `ratelimit:<bucket>:<key>:<windowStart>` with a TTL of one window.
- **Research response shape unchanged** (`content`, `usage`, `_fromCache`, `_cachedAt`) so `src/App.js` cost tracking keeps working.
- **Research cache key:** `tenant | companyName | jurisdiction | entityType | ownershipType | registrationNumber`.
- **Benchmark** requires the tenant admin credential and keeps its 25-company cap.

### Refinements over the spec (controller decisions, binding)

1. **No `lib/configStore.js` extraction.** Part 5 already made `api/config.js#readConfigForTenant` the one shared reader (benchmark uses it). This plan also exports `authorizeAdminForTenant` from `api/config.js` rather than moving code.
2. **Tenant travels as `X-Tenant-Id`** (via `getDossierAuthHeaders(tenant)`), resolved by `lib/tenant.js#getTenantIdFromRequest`, not as a body field — same as every other endpoint.
3. **`countryName` is accepted** as prompt copy (trimmed, ≤100 chars, control characters stripped); the server has no country-name table and the prompt text must stay identical.
4. **Admin credential for preview travels as `X-Admin-Token`**, so `Authorization` stays free for the analyst/customer credential that picks the rate-limit bucket. `draftConfig` is used only when `authorizeAdminForTenant(tenant, token)` is true; otherwise it is silently ignored.
5. **Draft-config research never reads or writes the research cache** (the cache key does not include config version, so a draft must not poison live results).
6. **Rate-limit identity comes only from a VERIFIED credential** (`lib/dossierAccess.js#resolveDossierActor`). Analyst key = `analyst:<tenantId>` (one shared password, so the tenant is the discriminator); customer key = `dossier:<dossierId>`; anything else (no credential, invalid, expired) = `ip:<first x-forwarded-for entry>` → `x-real-ip` → socket address.
7. **The rate limiter fails open** on a storage error (logged). It controls spend, not access; a KV blip must not stop onboarding.
8. **Gap recovery sends field ids**; the server maps them onto the tenant schema's `researchFields` (unknown ids dropped). Upgradeable targets therefore carry schema labels and search hints instead of the AI's row labels — an intended small prompt change.
9. **The shared policy module lives at `src/policySimulator/policyConfig.js`** (CommonJS in `src/`, the `src/pipeline.js` precedent), because CRA forbids importing from outside `src/`.
10. **`scripts/tests/policy-simulator-api.test.js` moves to `api/__tests__/generate-policy.nodetest.js`** so `npm run test:node` runs it.

---

## File structure

| File | Responsibility |
|---|---|
| `lib/rateLimit.js` (new) | Fixed-window counter, caller identity, `enforceRateLimit(req,res,bucket)` |
| `lib/researchPrompts.js` (new) | Validates structured research input and builds the Anthropic request per mode |
| `src/constants/extractionPrompts.js` | Becomes CommonJS; adds `EXTRACTION_PROMPT_BY_DOC_KEY` |
| `lib/researchCache.js` | Becomes CommonJS; tenant-aware cache key |
| `api/research.js` | Rewritten CommonJS handler: validate → rate limit → config → build → cache → Anthropic |
| `api/config.js` | Exports `authorizeAdminForTenant` |
| `src/setupProxy.js` | Research hand-copy replaced by the real handler |
| `src/utils/rateLimitMessage.js` (new) | Client 429 copy |
| `src/App.js`, `src/workflows/documentWorkflow.js` | Research / gap / extraction / doc-search / self-source call sites |
| `api/benchmark.js`, `benchmark/run.mjs` | Admin credential |
| `api/doc-search.js`, `api/self-source.js`, `api/ubo-discovery.js`, `api/ubo-control-lab.js` | Rate limit |
| `src/policySimulator/policyConfig.js` (new) | Option lists, `buildUserMessage`, `validatePolicyForm` |
| `api/generate-policy.js`, `src/policySimulator/PolicySimulator.jsx` | Structured form |

---

### Task 1: `lib/rateLimit.js`

**Files:**
- Create: `lib/rateLimit.js`
- Test: `lib/__tests__/rateLimit.nodetest.js`

**Interfaces:**
- Consumes: `lib/storage.js` (`get(key)`, `set(key, value, { ttlSeconds })`), `lib/dossierAccess.js#resolveDossierActor(req)` → `{ kind: "analyst"|"customer"|"none", tenantId, dossierId }`.
- Produces:
  - `check({ bucket, key, limit, windowSeconds? })` → `Promise<{ allowed: boolean, remaining: number, retryAfterSeconds: number }>`
  - `callerKey(req)` → `Promise<{ key: string, analyst: boolean }>`
  - `enforceRateLimit(req, res, bucket)` → `Promise<boolean>` (true = proceed; false = a 429 was already sent). Works with Vercel-style `res.status().json()` and with bare `res.statusCode`/`res.end()`.
  - `DEFAULT_LIMITS`, `DEFAULT_ANALYST_LIMIT`, `WINDOW_SECONDS`, `__setDeps({ storage, resolveDossierActor, now })`.

- [ ] **Step 1: Write the failing test**

Create `lib/__tests__/rateLimit.nodetest.js`:

```js
const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const rateLimit = require("../rateLimit");

const H = 3600 * 1000;

function fakeStorage() {
  const data = {};
  const ttls = {};
  return {
    data,
    ttls,
    async get(k) { return k in data ? data[k] : null; },
    async set(k, v, opts) { data[k] = v; ttls[k] = opts && opts.ttlSeconds; },
  };
}

function fakeRes() {
  return {
    statusCode: null, body: null, headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

function reqWith(headers = {}) {
  return { headers, socket: { remoteAddress: "9.9.9.9" } };
}

let storage;
let clock;
let actor;

beforeEach(() => {
  storage = fakeStorage();
  clock = 500 * H;
  actor = { kind: "none", reason: "unauthorized" };
  rateLimit.__setDeps({ storage, now: () => clock, resolveDossierActor: async () => actor });
  for (const k of Object.keys(process.env)) if (k.startsWith("RATE_LIMIT_")) delete process.env[k];
});

test("default limits match the spec", () => {
  assert.deepStrictEqual(rateLimit.DEFAULT_LIMITS, {
    research: 40, "doc-search": 40, "self-source": 40, "ubo-discovery": 20, "generate-policy": 10,
  });
  assert.strictEqual(rateLimit.DEFAULT_ANALYST_LIMIT, 200);
  assert.strictEqual(rateLimit.WINDOW_SECONDS, 3600);
});

test("check allows up to the limit and blocks the next call in the same window", async () => {
  for (let i = 0; i < 3; i++) {
    const r = await rateLimit.check({ bucket: "research", key: "ip:1.2.3.4", limit: 3 });
    assert.strictEqual(r.allowed, true);
    assert.strictEqual(r.remaining, 2 - i);
  }
  const blocked = await rateLimit.check({ bucket: "research", key: "ip:1.2.3.4", limit: 3 });
  assert.strictEqual(blocked.allowed, false);
  assert.strictEqual(blocked.remaining, 0);
  assert.strictEqual(blocked.retryAfterSeconds, 3600);
});

test("keys carry the window start with a one-window TTL, and a new window resets the count", async () => {
  await rateLimit.check({ bucket: "research", key: "ip:a", limit: 1 });
  const key = `ratelimit:research:ip:a:${500 * H}`;
  assert.strictEqual(storage.data[key], 1);
  assert.strictEqual(storage.ttls[key], 3600);
  assert.strictEqual((await rateLimit.check({ bucket: "research", key: "ip:a", limit: 1 })).allowed, false);
  clock += H;
  assert.strictEqual((await rateLimit.check({ bucket: "research", key: "ip:a", limit: 1 })).allowed, true);
});

test("retryAfterSeconds counts down to the end of the window", async () => {
  clock = 500 * H + 30 * 60 * 1000;
  await rateLimit.check({ bucket: "research", key: "ip:b", limit: 1 });
  const blocked = await rateLimit.check({ bucket: "research", key: "ip:b", limit: 1 });
  assert.strictEqual(blocked.retryAfterSeconds, 1800);
});

test("callerKey uses only verified credentials, otherwise the client IP", async () => {
  actor = { kind: "analyst", tenantId: "acme", dossierId: null };
  assert.deepStrictEqual(await rateLimit.callerKey(reqWith()), { key: "analyst:acme", analyst: true });
  actor = { kind: "customer", tenantId: "acme", dossierId: "d-1" };
  assert.deepStrictEqual(await rateLimit.callerKey(reqWith()), { key: "dossier:d-1", analyst: false });
  actor = { kind: "none", reason: "invalid_credential" };
  assert.deepStrictEqual(
    await rateLimit.callerKey(reqWith({ "x-forwarded-for": "1.1.1.1, 10.0.0.1" })),
    { key: "ip:1.1.1.1", analyst: false },
  );
  assert.deepStrictEqual(await rateLimit.callerKey(reqWith({ "x-real-ip": "2.2.2.2" })), { key: "ip:2.2.2.2", analyst: false });
  assert.deepStrictEqual(await rateLimit.callerKey(reqWith()), { key: "ip:9.9.9.9", analyst: false });
});

test("callerKey treats a throwing credential check as no credential", async () => {
  rateLimit.__setDeps({ resolveDossierActor: async () => { throw new Error("registry down"); } });
  assert.deepStrictEqual(await rateLimit.callerKey(reqWith({ "x-forwarded-for": "3.3.3.3" })), { key: "ip:3.3.3.3", analyst: false });
});

test("enforceRateLimit sends 429 with Retry-After once the bucket limit is spent", async () => {
  process.env.RATE_LIMIT_RESEARCH = "2";
  const req = reqWith({ "x-forwarded-for": "5.5.5.5" });
  assert.strictEqual(await rateLimit.enforceRateLimit(req, fakeRes(), "research"), true);
  assert.strictEqual(await rateLimit.enforceRateLimit(req, fakeRes(), "research"), true);
  const res = fakeRes();
  assert.strictEqual(await rateLimit.enforceRateLimit(req, res, "research"), false);
  assert.strictEqual(res.statusCode, 429);
  assert.deepStrictEqual(res.body, { error: "rate_limited", retryAfterSeconds: 3600 });
  assert.strictEqual(res.headers["Retry-After"], "3600");
});

test("buckets are independent per endpoint and per caller", async () => {
  process.env.RATE_LIMIT_RESEARCH = "1";
  process.env.RATE_LIMIT_DOC_SEARCH = "1";
  const a = reqWith({ "x-forwarded-for": "6.6.6.6" });
  const b = reqWith({ "x-forwarded-for": "7.7.7.7" });
  assert.strictEqual(await rateLimit.enforceRateLimit(a, fakeRes(), "research"), true);
  assert.strictEqual(await rateLimit.enforceRateLimit(a, fakeRes(), "doc-search"), true);
  assert.strictEqual(await rateLimit.enforceRateLimit(b, fakeRes(), "research"), true);
  assert.strictEqual(await rateLimit.enforceRateLimit(a, fakeRes(), "research"), false);
});

test("a verified analyst gets the analyst limit instead of the endpoint limit", async () => {
  process.env.RATE_LIMIT_RESEARCH = "1";
  process.env.RATE_LIMIT_ANALYST = "3";
  actor = { kind: "analyst", tenantId: "acme", dossierId: null };
  const req = reqWith();
  for (let i = 0; i < 3; i++) assert.strictEqual(await rateLimit.enforceRateLimit(req, fakeRes(), "research"), true);
  assert.strictEqual(await rateLimit.enforceRateLimit(req, fakeRes(), "research"), false);
});

test("an invalid env value falls back to the default limit", async () => {
  process.env.RATE_LIMIT_UBO_DISCOVERY = "not-a-number";
  const req = reqWith({ "x-forwarded-for": "8.8.8.8" });
  for (let i = 0; i < 20; i++) assert.strictEqual(await rateLimit.enforceRateLimit(req, fakeRes(), "ubo-discovery"), true);
  assert.strictEqual(await rateLimit.enforceRateLimit(req, fakeRes(), "ubo-discovery"), false);
});

test("a storage failure fails open", async () => {
  rateLimit.__setDeps({ storage: { async get() { throw new Error("kv down"); }, async set() {} } });
  assert.strictEqual(await rateLimit.enforceRateLimit(reqWith(), fakeRes(), "research"), true);
});

test("an unknown bucket is a programming error, not a silent pass", async () => {
  await assert.rejects(() => rateLimit.enforceRateLimit(reqWith(), fakeRes(), "nope"), /unknown rate-limit bucket/);
});

test("a bare res (statusCode + end) still receives a JSON 429", async () => {
  process.env.RATE_LIMIT_GENERATE_POLICY = "1";
  const req = reqWith({ "x-forwarded-for": "4.4.4.4" });
  const bare = () => ({
    statusCode: 200, headers: {}, payload: null,
    setHeader(k, v) { this.headers[k] = v; },
    end(p) { this.payload = JSON.parse(p); },
  });
  assert.strictEqual(await rateLimit.enforceRateLimit(req, bare(), "generate-policy"), true);
  const res = bare();
  assert.strictEqual(await rateLimit.enforceRateLimit(req, res, "generate-policy"), false);
  assert.strictEqual(res.statusCode, 429);
  assert.deepStrictEqual(res.payload, { error: "rate_limited", retryAfterSeconds: 3600 });
  assert.strictEqual(res.headers["Retry-After"], "3600");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test lib/__tests__/rateLimit.nodetest.js`
Expected: FAIL — `Cannot find module '../rateLimit'`.

- [ ] **Step 3: Implement `lib/rateLimit.js`**

```js
// Fixed-window rate limiter for the endpoints that spend Claude tokens.
//
// Callers are identified only by a VERIFIED credential (lib/dossierAccess.js):
// a pre-boarding analyst shares one bucket per tenant, a customer link shares
// one bucket per dossier, and everyone else is bucketed by client IP. An
// unverifiable credential never earns its own bucket — otherwise a random
// Bearer value per request would dodge the limit.
//
// Spend control, not access control: a storage failure is logged and the
// request is allowed.
//
// CommonJS so api/ handlers and src/setupProxy.js can require it.

const storage = require("./storage");
const { resolveDossierActor } = require("./dossierAccess");

const WINDOW_SECONDS = 3600;
const DEFAULT_LIMITS = Object.freeze({
  research: 40,
  "doc-search": 40,
  "self-source": 40,
  "ubo-discovery": 20,
  "generate-policy": 10,
});
const DEFAULT_ANALYST_LIMIT = 200;

let _deps = { storage, resolveDossierActor, now: () => Date.now() };

function envLimit(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function envNameFor(bucket) {
  return `RATE_LIMIT_${bucket.toUpperCase().replace(/-/g, "_")}`;
}

async function check({ bucket, key, limit, windowSeconds = WINDOW_SECONDS }) {
  const nowMs = _deps.now();
  const windowMs = windowSeconds * 1000;
  const windowStart = Math.floor(nowMs / windowMs) * windowMs;
  const storageKey = `ratelimit:${bucket}:${key}:${windowStart}`;
  const retryAfterSeconds = Math.max(1, Math.ceil((windowStart + windowMs - nowMs) / 1000));

  const current = Number(await _deps.storage.get(storageKey)) || 0;
  if (current >= limit) return { allowed: false, remaining: 0, retryAfterSeconds };

  // ponytail: fixed-window read-modify-write, not atomic — concurrent requests
  // at the limit edge can overshoot by a few. Swap for an atomic INCR if that
  // ever matters.
  await _deps.storage.set(storageKey, current + 1, { ttlSeconds: windowSeconds });
  return { allowed: true, remaining: limit - current - 1, retryAfterSeconds };
}

function clientIp(req) {
  const h = (req && req.headers) || {};
  const forwarded = typeof h["x-forwarded-for"] === "string" ? h["x-forwarded-for"].split(",")[0].trim() : "";
  if (forwarded) return forwarded;
  const real = typeof h["x-real-ip"] === "string" ? h["x-real-ip"].trim() : "";
  if (real) return real;
  return (req && req.socket && req.socket.remoteAddress) || "unknown";
}

async function callerKey(req) {
  let actor = null;
  try {
    actor = await _deps.resolveDossierActor(req);
  } catch (_) {
    actor = null;
  }
  if (actor && actor.kind === "analyst" && actor.tenantId) return { key: `analyst:${actor.tenantId}`, analyst: true };
  if (actor && actor.kind === "customer" && actor.dossierId) return { key: `dossier:${actor.dossierId}`, analyst: false };
  return { key: `ip:${clientIp(req)}`, analyst: false };
}

function sendRateLimited(res, retryAfterSeconds) {
  const body = { error: "rate_limited", retryAfterSeconds };
  if (typeof res.setHeader === "function") res.setHeader("Retry-After", String(retryAfterSeconds));
  if (typeof res.status === "function" && typeof res.json === "function") {
    return res.status(429).json(body);
  }
  res.statusCode = 429;
  if (typeof res.setHeader === "function") res.setHeader("Content-Type", "application/json; charset=utf-8");
  return res.end(JSON.stringify(body));
}

async function enforceRateLimit(req, res, bucket) {
  if (!Object.prototype.hasOwnProperty.call(DEFAULT_LIMITS, bucket)) {
    throw new Error(`unknown rate-limit bucket: ${bucket}`);
  }
  try {
    const caller = await callerKey(req);
    const limit = caller.analyst
      ? envLimit("RATE_LIMIT_ANALYST", DEFAULT_ANALYST_LIMIT)
      : envLimit(envNameFor(bucket), DEFAULT_LIMITS[bucket]);
    const result = await check({ bucket, key: caller.key, limit });
    if (result.allowed) return true;
    sendRateLimited(res, result.retryAfterSeconds);
    return false;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[rate-limit] ${bucket} check failed, allowing the request:`, err && err.message);
    return true;
  }
}

module.exports = {
  check,
  callerKey,
  clientIp,
  enforceRateLimit,
  DEFAULT_LIMITS,
  DEFAULT_ANALYST_LIMIT,
  WINDOW_SECONDS,
};

// Test seam only.
module.exports.__setDeps = (d) => { _deps = { ..._deps, ...d }; };
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test lib/__tests__/rateLimit.nodetest.js`
Expected: PASS, 13 tests.

Run: `npm run test:node`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add lib/rateLimit.js lib/__tests__/rateLimit.nodetest.js
git commit -m "feat(security): fixed-window rate limiter keyed by verified caller"
```

---

### Task 2: Server-built research prompts

**Files:**
- Modify: `src/constants/extractionPrompts.js` (ESM → CommonJS, add `EXTRACTION_PROMPT_BY_DOC_KEY`)
- Create: `src/constants/__tests__/extractionPrompts.test.js`
- Create: `lib/researchPrompts.js`
- Test: `lib/__tests__/researchPrompts.nodetest.js`

**Interfaces:**
- Consumes: `src/pipeline.js` (`buildPrompt`, `buildGapRecoveryPrompt`, `computeResearchStrategy`, `getSchemaFromConfig`, `RESEARCH_TOOLS`); `lib/seedConfig.js#buildDefaultConfig` (tests only).
- Produces:
  - `src/constants/extractionPrompts.js` exports the six `*_EXTRACTION_PROMPT` strings (unchanged text) plus `EXTRACTION_PROMPT_BY_DOC_KEY` (keys = `DOC_TYPES[].key`).
  - `lib/researchPrompts.js`:
    - `buildAnthropicRequest(body, tenantConfig)` → `{ mode, requestBody, cacheKeyParts, officers }`
      - `requestBody` = `{ model, max_tokens, messages, tools? }` ready for `POST /v1/messages`.
      - `cacheKeyParts` = `{ companyName, jurisdiction, entityType, ownershipType, registrationNumber }` for `mode: "research"`, else `null`.
      - `officers` = `{ companyName, jurisdiction, registrationNumber }` for `mode: "research"`, else `null`.
      - Throws `ResearchInputError` with `.code` ∈ `client_prompt_not_allowed | invalid_mode | missing_company_fields | invalid_schema | no_gap_fields | invalid_doc_key | invalid_media_type | invalid_file | invalid_wolfsberg_fields`.
    - `ResearchInputError`, `CLIENT_OWNED_KEYS`, `RESEARCH_MODEL` (`"claude-sonnet-4-5"`), `RESEARCH_MAX_TOKENS` (16000), `EXTRACTION_MAX_TOKENS` (4096).

Request body contract (all modes): `{ mode: "research" | "gap_recovery" | "extract_document", ... }`
- `research`: `companyName`, `countryCode`, `countryName?`, `entityType`, `ownershipType?`, `registrationNumber?`, `forceRefresh?`, `wolfsbergFields?` (object), `sourcedDocuments?` (`[{ label, year, sourceUrl, sourceLabel }]`)
- `gap_recovery`: `companyName`, `countryCode`, `countryName?`, `entityType`, `ownershipType?`, `missingFields: [fieldId]`, `upgradeableFields: [fieldId]`
- `extract_document`: `docKey`, `file: { mediaType, base64 }`
- any mode: `draftConfig?` (handled by the endpoint in Task 4, ignored here)

- [ ] **Step 1: Write the failing Jest sync test**

Create `src/constants/__tests__/extractionPrompts.test.js`:

```js
import { DOC_TYPES } from "../docTypes";
import { EXTRACTION_PROMPT_BY_DOC_KEY } from "../extractionPrompts";

test("the server lookup has exactly one prompt per document slot, identical to the slot's prompt", () => {
  expect(Object.keys(EXTRACTION_PROMPT_BY_DOC_KEY).sort()).toEqual(DOC_TYPES.map((d) => d.key).sort());
  for (const d of DOC_TYPES) {
    expect(EXTRACTION_PROMPT_BY_DOC_KEY[d.key]).toBe(d.extractionPrompt);
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `CI=true npx react-scripts test --watchAll=false src/constants/__tests__/extractionPrompts.test.js`
Expected: FAIL — `EXTRACTION_PROMPT_BY_DOC_KEY` is undefined.

- [ ] **Step 3: Convert `src/constants/extractionPrompts.js` to CommonJS**

1. Replace each of the six `export const ` prefixes with `const ` (the prompt text itself must not change by a single character).
2. Insert this header at the very top of the file:

```js
// Document-extraction prompts. CommonJS (the src/pipeline.js precedent) so the
// server can require them for POST /api/research mode "extract_document" while
// src/constants/docTypes.js keeps importing them for the upload slots.
```

3. Append at the end of the file:

```js

// Server lookup for POST /api/research mode "extract_document": the client
// names a document slot, never the prompt. Keys match DOC_TYPES[].key.
const EXTRACTION_PROMPT_BY_DOC_KEY = Object.freeze({
  wolfsberg: WOLFSBERG_EXTRACTION_PROMPT,
  certificate: CERT_EXTRACTION_PROMPT,
  licence: LICENCE_EXTRACTION_PROMPT,
  annualReport: ANNUAL_REPORT_EXTRACTION_PROMPT,
  financialStatements: ANNUAL_REPORT_EXTRACTION_PROMPT,
  orgChart: ORG_CHART_EXTRACTION_PROMPT,
  amlPolicy: AML_POLICY_EXTRACTION_PROMPT,
});

module.exports = {
  WOLFSBERG_EXTRACTION_PROMPT,
  CERT_EXTRACTION_PROMPT,
  LICENCE_EXTRACTION_PROMPT,
  ANNUAL_REPORT_EXTRACTION_PROMPT,
  ORG_CHART_EXTRACTION_PROMPT,
  AML_POLICY_EXTRACTION_PROMPT,
  EXTRACTION_PROMPT_BY_DOC_KEY,
};
```

`src/constants/docTypes.js` keeps its existing named `import { ... } from "./extractionPrompts";` unchanged. Before moving on, use the Grep tool for `extractionPrompts` across `src/` and confirm every importer uses named imports only.

- [ ] **Step 4: Run the Jest sync test**

Run: `CI=true npx react-scripts test --watchAll=false src/constants/__tests__/extractionPrompts.test.js`
Expected: PASS.

- [ ] **Step 5: Write the failing node test for the prompt builder**

Create `lib/__tests__/researchPrompts.nodetest.js`:

```js
const { test } = require("node:test");
const assert = require("node:assert");
const pipeline = require("../../src/pipeline");
const { buildDefaultConfig } = require("../seedConfig");
const { EXTRACTION_PROMPT_BY_DOC_KEY } = require("../../src/constants/extractionPrompts");
const {
  buildAnthropicRequest,
  ResearchInputError,
  CLIENT_OWNED_KEYS,
  RESEARCH_MODEL,
  RESEARCH_MAX_TOKENS,
  EXTRACTION_MAX_TOKENS,
} = require("../researchPrompts");

const cfg = buildDefaultConfig("acme");

// Verbatim copy of the browser composition that src/App.js doResearch used
// before Part 2 (buildPrompt + PRIMARY COMPANY IDENTIFIER + AUTOMATICALLY
// SOURCED DOCUMENTS). The server must reproduce it byte for byte.
function legacyBrowserPrompt({ companyName, countryName, countryCode, schema, wolfsbergFields, ownershipType, regNumber, acceptedDocs }) {
  let researchPrompt = pipeline.buildPrompt(companyName, countryName, countryCode, schema, wolfsbergFields, ownershipType);
  const trimmedRegNumber = regNumber.trim();
  if (trimmedRegNumber) {
    researchPrompt += `\n\nPRIMARY COMPANY IDENTIFIER:\n` +
      `The customer provided this official business registration / company number: ${trimmedRegNumber}.\n` +
      `Use it as the PRIMARY key to identify the exact company in ` +
      `${countryName} (Companies House and any ` +
      `other applicable company register), so you pull the precise entity ` +
      `rather than name-matching. If this number does not correspond to a ` +
      `real company, ignore it and fall back to researching by the company ` +
      `name "${companyName}".\n`;
  }
  if (acceptedDocs.length > 0) {
    researchPrompt += `\n\nAUTOMATICALLY SOURCED DOCUMENTS:\n`;
    researchPrompt += `The following documents have been ` +
      `sourced automatically and are available ` +
      `for field extraction:\n\n`;
    acceptedDocs.forEach((doc) => {
      researchPrompt += `- ${doc.label} (${doc.year})\n`;
      researchPrompt += `  URL: ${doc.sourceUrl}\n`;
      researchPrompt += `  Source: ${doc.sourceLabel}\n`;
      researchPrompt += `  Please extract all relevant ` +
        `compliance fields from this document.\n\n`;
    });
  }
  return researchPrompt;
}

const DOCS = [
  { label: "Annual Report", year: 2024, sourceUrl: "https://example.com/ar.pdf", sourceLabel: "Company website" },
  { label: "Confirmation Statement", year: 2023, sourceUrl: "https://find-and-update.company-information.service.gov.uk/x", sourceLabel: "Companies House" },
];

function researchBody(extra = {}) {
  return {
    mode: "research",
    companyName: "Britannia Group Limited",
    countryCode: "GB",
    countryName: "United Kingdom",
    entityType: "Corporate",
    ownershipType: "private_limited",
    registrationNumber: "01234567",
    wolfsbergFields: { legal_name: "Britannia Group Limited" },
    sourcedDocuments: DOCS,
    ...extra,
  };
}

function codeOf(fn) {
  try { fn(); } catch (err) { assert.ok(err instanceof ResearchInputError, `expected ResearchInputError, got ${err}`); return err.code; }
  assert.fail("expected a throw");
}

test("every client-owned key is refused", () => {
  assert.deepStrictEqual(CLIENT_OWNED_KEYS, ["prompt", "messages", "model", "tools", "max_tokens"]);
  for (const key of CLIENT_OWNED_KEYS) {
    assert.strictEqual(codeOf(() => buildAnthropicRequest(researchBody({ [key]: "x" }), cfg)), "client_prompt_not_allowed");
  }
});

test("an unknown mode is refused", () => {
  assert.strictEqual(codeOf(() => buildAnthropicRequest({ mode: "chat" }, cfg)), "invalid_mode");
  assert.strictEqual(codeOf(() => buildAnthropicRequest({}, cfg)), "invalid_mode");
});

test("research: the server prompt is byte-identical to the old browser prompt (golden)", () => {
  const schema = pipeline.getSchemaFromConfig("GB", "Corporate", cfg);
  const expected = legacyBrowserPrompt({
    companyName: "Britannia Group Limited",
    countryName: "United Kingdom",
    countryCode: "GB",
    schema,
    wolfsbergFields: { legal_name: "Britannia Group Limited" },
    ownershipType: "private_limited",
    regNumber: "01234567",
    acceptedDocs: DOCS,
  });
  const built = buildAnthropicRequest(researchBody(), cfg);
  assert.strictEqual(built.mode, "research");
  assert.strictEqual(built.requestBody.messages[0].content, expected);
  assert.strictEqual(built.requestBody.model, RESEARCH_MODEL);
  assert.strictEqual(built.requestBody.max_tokens, RESEARCH_MAX_TOKENS);
  assert.deepStrictEqual(built.requestBody.tools, pipeline.RESEARCH_TOOLS);
});

test("research: no reg number and no documents gives the plain buildPrompt output", () => {
  const schema = pipeline.getSchemaFromConfig("GB", "Corporate", cfg);
  const built = buildAnthropicRequest(researchBody({ registrationNumber: "", sourcedDocuments: [], wolfsbergFields: undefined }), cfg);
  assert.strictEqual(
    built.requestBody.messages[0].content,
    pipeline.buildPrompt("Britannia Group Limited", "United Kingdom", "GB", schema, {}, "private_limited"),
  );
});

test("research: cache key parts and officers inputs come from the validated input", () => {
  const built = buildAnthropicRequest(researchBody(), cfg);
  assert.deepStrictEqual(built.cacheKeyParts, {
    companyName: "Britannia Group Limited",
    jurisdiction: "GB",
    entityType: "Corporate",
    ownershipType: "private_limited",
    registrationNumber: "01234567",
  });
  assert.deepStrictEqual(built.officers, {
    companyName: "Britannia Group Limited",
    jurisdiction: "GB",
    registrationNumber: "01234567",
  });
  const noReg = buildAnthropicRequest(researchBody({ registrationNumber: "  " }), cfg);
  assert.strictEqual(noReg.officers.registrationNumber, undefined);
});

test("research: missing company facts are refused", () => {
  assert.strictEqual(codeOf(() => buildAnthropicRequest(researchBody({ companyName: "  " }), cfg)), "missing_company_fields");
  assert.strictEqual(codeOf(() => buildAnthropicRequest(researchBody({ countryCode: undefined }), cfg)), "missing_company_fields");
  assert.strictEqual(codeOf(() => buildAnthropicRequest(researchBody({ entityType: 42 }), cfg)), "missing_company_fields");
});

test("research: non-http document URLs are dropped and the list is capped at 10", () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ label: `Doc ${i}`, year: 2020, sourceUrl: `https://e.com/${i}`, sourceLabel: "Web" }));
  const withBad = [{ label: "Evil", year: 2020, sourceUrl: "javascript:alert(1)", sourceLabel: "x" }, ...many];
  const content = buildAnthropicRequest(researchBody({ sourcedDocuments: withBad }), cfg).requestBody.messages[0].content;
  assert.ok(!content.includes("javascript:"));
  assert.ok(content.includes("https://e.com/9"));
  assert.ok(!content.includes("https://e.com/10"));
});

test("research: an oversized wolfsberg payload is refused", () => {
  const huge = { notes: "x".repeat(20001) };
  assert.strictEqual(codeOf(() => buildAnthropicRequest(researchBody({ wolfsbergFields: huge }), cfg)), "invalid_wolfsberg_fields");
});

test("gap_recovery: field ids map onto the tenant schema; unknown ids are dropped", () => {
  const schema = pipeline.getSchemaFromConfig("GB", "Corporate", cfg);
  const [first, second] = schema.researchFields;
  const body = {
    mode: "gap_recovery",
    companyName: "Britannia Group Limited",
    countryCode: "GB",
    countryName: "United Kingdom",
    entityType: "Corporate",
    ownershipType: "private_limited",
    missingFields: [first.field, "not_a_field"],
    upgradeableFields: [second.field],
  };
  const built = buildAnthropicRequest(body, cfg);
  const expected = pipeline.buildGapRecoveryPrompt(
    { name: "Britannia Group Limited", countryName: "United Kingdom" },
    [first],
    [second],
    pipeline.computeResearchStrategy("private_limited", "GB"),
  );
  assert.strictEqual(built.requestBody.messages[0].content, expected);
  assert.ok(!built.requestBody.messages[0].content.includes("not_a_field"));
  assert.deepStrictEqual(built.requestBody.tools, pipeline.RESEARCH_TOOLS);
  assert.strictEqual(built.cacheKeyParts, null);
  assert.strictEqual(built.officers, null);
});

test("gap_recovery: no recognised field is refused", () => {
  const body = { mode: "gap_recovery", companyName: "B", countryCode: "GB", entityType: "Corporate", missingFields: ["nope"], upgradeableFields: "x" };
  assert.strictEqual(codeOf(() => buildAnthropicRequest(body, cfg)), "no_gap_fields");
});

test("extract_document: the server picks the prompt from the doc key and sends no tools", () => {
  const body = { mode: "extract_document", docKey: "certificate", file: { mediaType: "application/pdf", base64: "JVBERi0=" } };
  const built = buildAnthropicRequest(body, cfg);
  assert.deepStrictEqual(built.requestBody, {
    model: RESEARCH_MODEL,
    max_tokens: EXTRACTION_MAX_TOKENS,
    messages: [{
      role: "user",
      content: [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: "JVBERi0=" } },
        { type: "text", text: EXTRACTION_PROMPT_BY_DOC_KEY.certificate },
      ],
    }],
  });
  assert.strictEqual(built.cacheKeyParts, null);
  assert.strictEqual(built.officers, null);
  const image = buildAnthropicRequest({ ...body, docKey: "orgChart", file: { mediaType: "image/png", base64: "iVBOR" } }, cfg);
  assert.strictEqual(image.requestBody.messages[0].content[0].type, "image");
});

test("extract_document: bad doc key, media type or file are refused", () => {
  const ok = { mode: "extract_document", docKey: "certificate", file: { mediaType: "application/pdf", base64: "JVBERi0=" } };
  assert.strictEqual(codeOf(() => buildAnthropicRequest({ ...ok, docKey: "toString" }, cfg)), "invalid_doc_key");
  assert.strictEqual(codeOf(() => buildAnthropicRequest({ ...ok, file: { mediaType: "text/html", base64: "x" } }, cfg)), "invalid_media_type");
  assert.strictEqual(codeOf(() => buildAnthropicRequest({ ...ok, file: { mediaType: "application/pdf", base64: "" } }, cfg)), "invalid_file");
  assert.strictEqual(codeOf(() => buildAnthropicRequest({ ...ok, file: { mediaType: "application/pdf", base64: "a".repeat(6000001) } }, cfg)), "invalid_file");
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `node --test lib/__tests__/researchPrompts.nodetest.js`
Expected: FAIL — `Cannot find module '../researchPrompts'`.

- [ ] **Step 7: Implement `lib/researchPrompts.js`**

```js
// Builds the Anthropic /v1/messages request for POST /api/research from
// structured input. The browser never supplies a prompt, model, tool list or
// token budget: it names a mode and the company facts, and the prompt comes
// from the tenant's own schema via the shared src/pipeline.js builders.
//
// CommonJS so api/research.js and the node tests can require it.

const pipeline = require("../src/pipeline");
const { EXTRACTION_PROMPT_BY_DOC_KEY } = require("../src/constants/extractionPrompts");

const RESEARCH_MODEL = "claude-sonnet-4-5";
const RESEARCH_MAX_TOKENS = 16000;
const EXTRACTION_MAX_TOKENS = 4096;
const MODES = ["research", "gap_recovery", "extract_document"];
const CLIENT_OWNED_KEYS = ["prompt", "messages", "model", "tools", "max_tokens"];
const EXTRACTION_MEDIA_TYPES = ["application/pdf", "image/png", "image/jpeg"];
const MAX_BASE64_CHARS = 6000000;
const MAX_SOURCED_DOCUMENTS = 10;
const MAX_WOLFSBERG_JSON_CHARS = 20000;

class ResearchInputError extends Error {
  constructor(code) {
    super(code);
    this.name = "ResearchInputError";
    this.code = code;
  }
}

// Single-line prompt copy: control characters become spaces, then trim + cap.
function text(value, max) {
  if (typeof value !== "string") return "";
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\x00-\x1f\x7f]/g, " ").trim().slice(0, max);
}

function normaliseSourcedDocuments(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((d) => d && typeof d === "object" && /^https?:\/\//i.test(text(d.sourceUrl, 2000)))
    .slice(0, MAX_SOURCED_DOCUMENTS)
    .map((d) => ({
      label: text(d.label, 200),
      year: text(d.year == null ? "" : String(d.year), 16),
      sourceUrl: text(d.sourceUrl, 2000),
      sourceLabel: text(d.sourceLabel, 200),
    }));
}

function normaliseWolfsberg(fields) {
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) return {};
  let json;
  try {
    json = JSON.stringify(fields);
  } catch (_) {
    throw new ResearchInputError("invalid_wolfsberg_fields");
  }
  if (json.length > MAX_WOLFSBERG_JSON_CHARS) throw new ResearchInputError("invalid_wolfsberg_fields");
  return JSON.parse(json);
}

// Moved verbatim from src/App.js doResearch (Part 2).
function registrationBlock(registrationNumber, countryName, companyName) {
  return `\n\nPRIMARY COMPANY IDENTIFIER:\n` +
    `The customer provided this official business registration / company number: ${registrationNumber}.\n` +
    `Use it as the PRIMARY key to identify the exact company in ` +
    `${countryName} (Companies House and any ` +
    `other applicable company register), so you pull the precise entity ` +
    `rather than name-matching. If this number does not correspond to a ` +
    `real company, ignore it and fall back to researching by the company ` +
    `name "${companyName}".\n`;
}

// Moved verbatim from src/App.js doResearch (Part 2).
function sourcedDocumentsBlock(docs) {
  let block = `\n\nAUTOMATICALLY SOURCED DOCUMENTS:\n`;
  block += `The following documents have been ` +
    `sourced automatically and are available ` +
    `for field extraction:\n\n`;
  docs.forEach((doc) => {
    block += `- ${doc.label} (${doc.year})\n`;
    block += `  URL: ${doc.sourceUrl}\n`;
    block += `  Source: ${doc.sourceLabel}\n`;
    block += `  Please extract all relevant ` +
      `compliance fields from this document.\n\n`;
  });
  return block;
}

function companyFacts(input, tenantConfig) {
  const companyName = text(input.companyName, 200);
  const countryCode = text(input.countryCode, 8).toUpperCase();
  const entityType = text(input.entityType, 64);
  if (!companyName || !countryCode || !entityType) throw new ResearchInputError("missing_company_fields");
  const countryName = text(input.countryName, 100) || countryCode;
  const ownershipType = text(input.ownershipType, 64) || null;
  let schema;
  try {
    schema = pipeline.getSchemaFromConfig(countryCode, entityType, tenantConfig);
  } catch (_) {
    schema = null;
  }
  if (!schema || !Array.isArray(schema.researchFields)) throw new ResearchInputError("invalid_schema");
  return { companyName, countryCode, countryName, entityType, ownershipType, schema };
}

function buildExtractionRequest(input) {
  const docKey = input.docKey;
  if (typeof docKey !== "string" || !Object.prototype.hasOwnProperty.call(EXTRACTION_PROMPT_BY_DOC_KEY, docKey)) {
    throw new ResearchInputError("invalid_doc_key");
  }
  const file = input.file && typeof input.file === "object" ? input.file : {};
  if (!EXTRACTION_MEDIA_TYPES.includes(file.mediaType)) throw new ResearchInputError("invalid_media_type");
  if (typeof file.base64 !== "string" || !file.base64 || file.base64.length > MAX_BASE64_CHARS) {
    throw new ResearchInputError("invalid_file");
  }
  const blockType = file.mediaType.startsWith("image/") ? "image" : "document";
  return {
    mode: "extract_document",
    requestBody: {
      model: RESEARCH_MODEL,
      max_tokens: EXTRACTION_MAX_TOKENS,
      messages: [{
        role: "user",
        content: [
          { type: blockType, source: { type: "base64", media_type: file.mediaType, data: file.base64 } },
          { type: "text", text: EXTRACTION_PROMPT_BY_DOC_KEY[docKey] },
        ],
      }],
    },
    cacheKeyParts: null,
    officers: null,
  };
}

function buildGapRecoveryRequest(input, tenantConfig) {
  const facts = companyFacts(input, tenantConfig);
  const byId = new Map(facts.schema.researchFields.map((f) => [f.field, f]));
  const pick = (ids) => (Array.isArray(ids) ? ids : [])
    .filter((id) => typeof id === "string" && byId.has(id))
    .map((id) => byId.get(id));
  const missing = pick(input.missingFields);
  const upgradeable = pick(input.upgradeableFields);
  if (missing.length + upgradeable.length === 0) throw new ResearchInputError("no_gap_fields");
  const strategy = facts.ownershipType ? pipeline.computeResearchStrategy(facts.ownershipType, facts.countryCode) : null;
  const prompt = pipeline.buildGapRecoveryPrompt(
    { name: facts.companyName, countryName: facts.countryName },
    missing,
    upgradeable,
    strategy,
  );
  return {
    mode: "gap_recovery",
    requestBody: {
      model: RESEARCH_MODEL,
      max_tokens: RESEARCH_MAX_TOKENS,
      messages: [{ role: "user", content: prompt }],
      tools: pipeline.RESEARCH_TOOLS,
    },
    cacheKeyParts: null,
    officers: null,
  };
}

function buildResearchRequest(input, tenantConfig) {
  const facts = companyFacts(input, tenantConfig);
  const registrationNumber = text(input.registrationNumber, 64);
  const sourcedDocuments = normaliseSourcedDocuments(input.sourcedDocuments);
  const wolfsbergFields = normaliseWolfsberg(input.wolfsbergFields);

  let prompt = pipeline.buildPrompt(
    facts.companyName,
    facts.countryName,
    facts.countryCode,
    facts.schema,
    wolfsbergFields,
    facts.ownershipType,
  );
  if (registrationNumber) prompt += registrationBlock(registrationNumber, facts.countryName, facts.companyName);
  if (sourcedDocuments.length > 0) prompt += sourcedDocumentsBlock(sourcedDocuments);

  return {
    mode: "research",
    requestBody: {
      model: RESEARCH_MODEL,
      max_tokens: RESEARCH_MAX_TOKENS,
      messages: [{ role: "user", content: prompt }],
      tools: pipeline.RESEARCH_TOOLS,
    },
    cacheKeyParts: {
      companyName: facts.companyName,
      jurisdiction: facts.countryCode,
      entityType: facts.entityType,
      ownershipType: facts.ownershipType || "",
      registrationNumber,
    },
    officers: {
      companyName: facts.companyName,
      jurisdiction: facts.countryCode,
      registrationNumber: registrationNumber || undefined,
    },
  };
}

function buildAnthropicRequest(body, tenantConfig) {
  const input = body && typeof body === "object" ? body : {};
  if (CLIENT_OWNED_KEYS.some((key) => input[key] !== undefined)) {
    throw new ResearchInputError("client_prompt_not_allowed");
  }
  if (!MODES.includes(input.mode)) throw new ResearchInputError("invalid_mode");
  if (input.mode === "extract_document") return buildExtractionRequest(input);
  if (input.mode === "gap_recovery") return buildGapRecoveryRequest(input, tenantConfig);
  return buildResearchRequest(input, tenantConfig);
}

module.exports = {
  buildAnthropicRequest,
  ResearchInputError,
  CLIENT_OWNED_KEYS,
  RESEARCH_MODEL,
  RESEARCH_MAX_TOKENS,
  EXTRACTION_MAX_TOKENS,
};
```

- [ ] **Step 8: Run to verify it passes**

Run: `node --test lib/__tests__/researchPrompts.nodetest.js`
Expected: PASS, 12 tests. If the golden test fails, diff the two strings — the fix is in `lib/researchPrompts.js`, never in the legacy copy inside the test.

Run: `npm run test:node`
Expected: PASS, 0 failures.

Run: `CI=true npx react-scripts test --watchAll=false src/constants`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/constants/extractionPrompts.js src/constants/__tests__/extractionPrompts.test.js lib/researchPrompts.js lib/__tests__/researchPrompts.nodetest.js
git commit -m "feat(security): build research, gap-recovery and extraction prompts server-side"
```

---

### Task 3: Tenant-aware research cache (CommonJS)

**Files:**
- Modify: `lib/researchCache.js` (full rewrite below)
- Test: `lib/__tests__/researchCache.nodetest.js`

**Interfaces:**
- Consumes: `@neondatabase/serverless#neon`, `research_cache` table (unchanged schema).
- Produces:
  - `buildCacheKey({ tenant, companyName, jurisdiction, entityType, ownershipType, registrationNumber })` → `string` (each part lowercased + trimmed, joined by `|`).
  - `getCachedResearch(parts)` → `Promise<object|null>` (adds `_fromCache`, `_cachedAt`, `_cacheHits`).
  - `saveResearchToCache(parts, result, modelVersion)` → `Promise<void>`.
  - `__setDeps({ neon })`.

Note for the reviewer: existing cache rows use the old 3-part key and simply stop matching (a miss, then a fresh 30-day entry). No migration.

- [ ] **Step 1: Write the failing test**

Create `lib/__tests__/researchCache.nodetest.js`:

```js
const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const cache = require("../researchCache");

function fakeNeon(rows) {
  const log = [];
  const sql = (strings, ...values) => {
    log.push({ text: strings.join("?"), values });
    const p = Promise.resolve(/^\s*SELECT/i.test(strings[0]) ? rows : []);
    return p;
  };
  return { log, neon: () => sql };
}

const PARTS = {
  tenant: "Acme",
  companyName: " Stripe UK ",
  jurisdiction: "GB",
  entityType: "Corporate",
  ownershipType: "private_limited",
  registrationNumber: "SC123",
};

beforeEach(() => { process.env.DATABASE_URL = "postgres://test"; });

test("the key includes tenant, ownership type and registration number, normalised", () => {
  assert.strictEqual(cache.buildCacheKey(PARTS), "acme|stripe uk|gb|corporate|private_limited|sc123");
});

test("the key changes when any of tenant, ownership type or registration number changes", () => {
  const base = cache.buildCacheKey(PARTS);
  assert.notStrictEqual(cache.buildCacheKey({ ...PARTS, tenant: "other" }), base);
  assert.notStrictEqual(cache.buildCacheKey({ ...PARTS, ownershipType: "public_listed" }), base);
  assert.notStrictEqual(cache.buildCacheKey({ ...PARTS, registrationNumber: "" }), base);
});

test("missing parts become empty segments, never 'undefined'", () => {
  assert.strictEqual(cache.buildCacheKey({ tenant: "acme", companyName: "X" }), "acme|x||||");
});

test("a hit is returned with cache markers and queried by the full key", async () => {
  const fake = fakeNeon([{ research_result: { content: [] }, fetched_at: "2026-09-01", expires_at: "2026-10-01", hit_count: 2 }]);
  cache.__setDeps({ neon: fake.neon });
  const hit = await cache.getCachedResearch(PARTS);
  assert.deepStrictEqual(hit, { content: [], _fromCache: true, _cachedAt: "2026-09-01", _cacheHits: 3 });
  assert.ok(fake.log[0].values.includes("acme|stripe uk|gb|corporate|private_limited|sc123"));
});

test("a miss returns null", async () => {
  cache.__setDeps({ neon: fakeNeon([]).neon });
  assert.strictEqual(await cache.getCachedResearch(PARTS), null);
});

test("save writes the full key", async () => {
  const fake = fakeNeon([]);
  cache.__setDeps({ neon: fake.neon });
  await cache.saveResearchToCache(PARTS, { content: [] }, "claude-sonnet-4-5");
  assert.ok(fake.log[0].values.includes("acme|stripe uk|gb|corporate|private_limited|sc123"));
});

test("no DATABASE_URL throws so the caller can fall through to the live API", async () => {
  delete process.env.DATABASE_URL;
  await assert.rejects(() => cache.getCachedResearch(PARTS), /DATABASE_URL not set/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test lib/__tests__/researchCache.nodetest.js`
Expected: FAIL — the ESM file cannot be required (`Unexpected token 'export'` or `__setDeps is not a function`).

- [ ] **Step 3: Rewrite `lib/researchCache.js`**

```js
// Research result cache (cache-first with 30-day TTL).
//
// Company research is expensive: every run hits the Anthropic API. This module
// lets api/research.js serve a previously-fetched result for the same request
// straight from Neon Postgres at zero API cost. The UI's "Force Refresh" toggle
// bypasses the cache when fresh data is needed.
//
// Backed by the research_cache table (db/migrations/006_research_cache.sql).
// Every exported function may throw; callers MUST treat a cache failure as a
// miss and fall through to the live API — never block a research run because
// the cache is unavailable.
//
// The key covers everything that changes the prompt or its answer: tenant
// (each tenant has its own schema), company, jurisdiction, entity type,
// ownership type and registration number.
//
// CommonJS so api/research.js and the node tests can require it. The Neon
// client is built lazily so a missing DATABASE_URL is a catchable error.

const { neon } = require("@neondatabase/serverless");

let _deps = { neon };

function getSql() {
  const conn = process.env.DATABASE_URL;
  if (!conn) throw new Error("DATABASE_URL not set");
  return _deps.neon(conn);
}

function buildCacheKey({ tenant, companyName, jurisdiction, entityType, ownershipType, registrationNumber } = {}) {
  return [tenant, companyName, jurisdiction, entityType, ownershipType, registrationNumber]
    .map((part) => String(part || "").toLowerCase().trim())
    .join("|");
}

async function getCachedResearch(parts) {
  const sql = getSql();
  const key = buildCacheKey(parts);
  const rows = await sql`
    SELECT research_result, fetched_at, expires_at, hit_count
    FROM research_cache
    WHERE cache_key = ${key}
      AND expires_at > NOW()
    LIMIT 1
  `;
  if (rows.length === 0) return null;

  // Increment hit counter (fire and forget — don't await).
  sql`
    UPDATE research_cache
    SET hit_count = hit_count + 1, last_hit_at = NOW()
    WHERE cache_key = ${key}
  `.catch(() => {});

  return {
    ...rows[0].research_result,
    _fromCache: true,
    _cachedAt: rows[0].fetched_at,
    _cacheHits: rows[0].hit_count + 1,
  };
}

async function saveResearchToCache(parts, result, modelVersion) {
  const sql = getSql();
  const key = buildCacheKey(parts);
  await sql`
    INSERT INTO research_cache (cache_key, company_name, jurisdiction, entity_type, research_result, model_version, fetched_at, expires_at, hit_count)
    VALUES (
      ${key},
      ${parts.companyName},
      ${parts.jurisdiction || null},
      ${parts.entityType || null},
      ${JSON.stringify(result)},
      ${modelVersion || null},
      NOW(),
      NOW() + INTERVAL '30 days',
      0
    )
    ON CONFLICT (cache_key) DO UPDATE SET
      research_result = EXCLUDED.research_result,
      model_version   = EXCLUDED.model_version,
      fetched_at      = NOW(),
      expires_at      = NOW() + INTERVAL '30 days',
      hit_count       = 0,
      last_hit_at     = NULL
  `;
}

module.exports = { buildCacheKey, getCachedResearch, saveResearchToCache };

// Test seam only.
module.exports.__setDeps = (d) => { _deps = { ..._deps, ...d }; };
```

The fake in the test returns a plain Promise for the fire-and-forget UPDATE, so `.catch` exists.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test lib/__tests__/researchCache.nodetest.js`
Expected: PASS, 7 tests.

Note: `src/setupProxy.js` still `import()`s this file until Task 4 replaces that block. Task 4 must land before `npm start` is used; the node and Jest suites are unaffected.

- [ ] **Step 5: Commit**

```bash
git add lib/researchCache.js lib/__tests__/researchCache.nodetest.js
git commit -m "feat(research): tenant-aware research cache key; cache module to CommonJS"
```

---

### Task 4: `/api/research` builds every call server-side

**Files:**
- Modify: `api/research.js` (full rewrite below)
- Modify: `api/config.js` (one export line)
- Modify: `src/setupProxy.js` (replace the research hand-copy)
- Test: `api/__tests__/research.nodetest.js`

**Interfaces:**
- Consumes: Task 1 `enforceRateLimit(req, res, "research")`; Task 2 `buildAnthropicRequest`, `ResearchInputError`, `CLIENT_OWNED_KEYS`; Task 3 `getCachedResearch(parts)`, `saveResearchToCache(parts, result, model)`; `api/config.js#readConfigForTenant(tenant)`; `lib/applyOfficersLayer.js` (`fetchOfficersLayer({ companyName, jurisdiction, registrationNumber })`, `injectOfficers(data, officers)`); `lib/tenant.js#getTenantIdFromRequest`.
- Produces:
  - `api/config.js` exports `authorizeAdminForTenant(tenant, token)` → `Promise<boolean>`.
  - `POST /api/research` (headers: `X-Tenant-Id` required; `Authorization` optional analyst/customer credential; `X-Admin-Token` optional, only meaningful with `draftConfig`):
    - `400 { error: "tenant_required" }` — no tenant
    - `400 { error: "client_prompt_not_allowed" }` — any of `prompt|messages|model|tools|max_tokens`
    - `429 { error: "rate_limited", retryAfterSeconds }`
    - `404 { error: "tenant_not_found" }`
    - `400 { error: <ResearchInputError code> }`
    - `500 { error: "Server API key not configured" }`
    - Anthropic non-OK → same status, `{ error: "Claude API error", details }`
    - `500 { error: "research_failed" }` — anything unexpected (no raw message)
    - `200` — the Anthropic response, plus `_fromCache/_cachedAt/_cacheHits` on a cache hit
  - `module.exports.__setDeps({ fetch, cache, officersLayer, enforceRateLimit, readConfigForTenant, authorizeAdmin })`.

- [ ] **Step 1: Export the admin check from `api/config.js`**

Append after the existing `module.exports.readConfigForTenant = readConfig;` line:

```js

// Shared admin check for other server modules (api/research.js draft preview,
// api/benchmark.js). Same rules as the config endpoint itself.
module.exports.authorizeAdminForTenant = authorizeAdmin;
```

- [ ] **Step 2: Write the failing test**

Create `api/__tests__/research.nodetest.js`:

```js
const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const research = require("../research");
const { buildDefaultConfig } = require("../../lib/seedConfig");
const { buildAnthropicRequest } = require("../../lib/researchPrompts");
const pipeline = require("../../src/pipeline");

const STORED = buildDefaultConfig("acme");
const DRAFT = { ...buildDefaultConfig("acme"), _draftMarker: true };

function fakeRes() {
  return {
    statusCode: null, body: null, headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    end() { return this; },
  };
}

function req(body, headers = { "x-tenant-id": "acme" }) {
  return { method: "POST", headers, query: {}, url: "/api/research", body };
}

const researchBody = (extra = {}) => ({
  mode: "research",
  companyName: "Britannia Group Limited",
  countryCode: "GB",
  countryName: "United Kingdom",
  entityType: "Corporate",
  ownershipType: "private_limited",
  registrationNumber: "01234567",
  ...extra,
});

const CLAUDE_OK = { content: [{ type: "text", text: "{\"found\":[]}" }], usage: { input_tokens: 10, output_tokens: 5 } };

let calls;

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  calls = { fetch: [], cacheGet: [], cacheSave: [], readConfig: [], officers: [], inject: [] };
  research.__setDeps({
    fetch: async (url, init) => {
      calls.fetch.push({ url, init, body: JSON.parse(init.body) });
      return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(CLAUDE_OK)) };
    },
    cache: {
      getCachedResearch: async (parts) => { calls.cacheGet.push(parts); return null; },
      saveResearchToCache: async (parts, data, model) => { calls.cacheSave.push({ parts, data, model }); },
    },
    officersLayer: {
      fetchOfficersLayer: async (input) => { calls.officers.push(input); return null; },
      injectOfficers: (data, officers) => { calls.inject.push(officers); },
    },
    enforceRateLimit: async () => true,
    readConfigForTenant: async (tenant) => { calls.readConfig.push(tenant); return tenant === "acme" ? STORED : null; },
    authorizeAdmin: async (tenant, token) => tenant === "acme" && token === "admin-secret",
  });
});

test("rejects every client-authored prompt field before any work", async () => {
  for (const key of ["prompt", "messages", "model", "tools", "max_tokens"]) {
    const res = fakeRes();
    await research(req(researchBody({ [key]: "x" })), res);
    assert.strictEqual(res.statusCode, 400);
    assert.deepStrictEqual(res.body, { error: "client_prompt_not_allowed" });
  }
  assert.strictEqual(calls.fetch.length, 0);
  assert.strictEqual(calls.readConfig.length, 0);
});

test("a request with no tenant is refused", async () => {
  const res = fakeRes();
  await research(req(researchBody(), {}), res);
  assert.strictEqual(res.statusCode, 400);
  assert.deepStrictEqual(res.body, { error: "tenant_required" });
});

test("an unknown tenant is a 404 and nothing is spent", async () => {
  const res = fakeRes();
  await research(req(researchBody(), { "x-tenant-id": "ghost" }), res);
  assert.strictEqual(res.statusCode, 404);
  assert.deepStrictEqual(res.body, { error: "tenant_not_found" });
  assert.strictEqual(calls.fetch.length, 0);
});

test("a rate-limited caller gets the limiter's 429 and nothing else happens", async () => {
  research.__setDeps({ enforceRateLimit: async (_req, res) => { res.status(429).json({ error: "rate_limited", retryAfterSeconds: 60 }); return false; } });
  const res = fakeRes();
  await research(req(researchBody()), res);
  assert.strictEqual(res.statusCode, 429);
  assert.strictEqual(calls.readConfig.length, 0);
  assert.strictEqual(calls.fetch.length, 0);
});

test("research: prompt, model and tools are built from the stored tenant config", async () => {
  const res = fakeRes();
  await research(req(researchBody()), res);
  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(res.body, CLAUDE_OK);
  assert.strictEqual(calls.fetch.length, 1);
  const expected = buildAnthropicRequest(researchBody(), STORED).requestBody;
  assert.deepStrictEqual(calls.fetch[0].body, expected);
  assert.strictEqual(calls.fetch[0].init.headers["x-api-key"], "test-key");
  assert.deepStrictEqual(calls.fetch[0].body.tools, pipeline.RESEARCH_TOOLS);
  assert.deepStrictEqual(calls.officers, [{ companyName: "Britannia Group Limited", jurisdiction: "GB", registrationNumber: "01234567" }]);
});

test("research: the cache key carries tenant, ownership type and registration number", async () => {
  const res = fakeRes();
  await research(req(researchBody()), res);
  const parts = {
    tenant: "acme",
    companyName: "Britannia Group Limited",
    jurisdiction: "GB",
    entityType: "Corporate",
    ownershipType: "private_limited",
    registrationNumber: "01234567",
  };
  assert.deepStrictEqual(calls.cacheGet, [parts]);
  assert.deepStrictEqual(calls.cacheSave[0].parts, parts);
  assert.strictEqual(calls.cacheSave[0].model, "claude-sonnet-4-5");
});

test("research: a cache hit is served without calling Anthropic", async () => {
  research.__setDeps({
    cache: {
      getCachedResearch: async () => ({ content: [], _fromCache: true, _cachedAt: "2026-09-01" }),
      saveResearchToCache: async () => { throw new Error("must not save on a hit"); },
    },
  });
  const res = fakeRes();
  await research(req(researchBody()), res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body._fromCache, true);
  assert.strictEqual(calls.fetch.length, 0);
});

test("research: forceRefresh skips the lookup but still saves", async () => {
  const res = fakeRes();
  await research(req(researchBody({ forceRefresh: true })), res);
  assert.strictEqual(calls.cacheGet.length, 0);
  assert.strictEqual(calls.cacheSave.length, 1);
  assert.strictEqual(calls.fetch.length, 1);
});

test("research: a cache failure falls through to the live call", async () => {
  research.__setDeps({
    cache: {
      getCachedResearch: async () => { throw new Error("db down"); },
      saveResearchToCache: async () => { throw new Error("db down"); },
    },
  });
  const res = fakeRes();
  await research(req(researchBody()), res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(calls.fetch.length, 1);
});

test("draftConfig is ignored without a valid admin token", async () => {
  for (const headers of [{ "x-tenant-id": "acme" }, { "x-tenant-id": "acme", "x-admin-token": "wrong" }]) {
    calls.readConfig = [];
    const res = fakeRes();
    await research(req(researchBody({ draftConfig: DRAFT }), headers), res);
    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(calls.readConfig, ["acme"]);
  }
});

test("draftConfig is honoured with a valid admin token and bypasses the cache", async () => {
  calls.cacheGet = [];
  calls.cacheSave = [];
  const res = fakeRes();
  await research(req(researchBody({ draftConfig: DRAFT }), { "x-tenant-id": "acme", "x-admin-token": "admin-secret" }), res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(calls.readConfig.length, 0);
  assert.strictEqual(calls.cacheGet.length, 0);
  assert.strictEqual(calls.cacheSave.length, 0);
  assert.deepStrictEqual(calls.fetch[0].body, buildAnthropicRequest(researchBody(), DRAFT).requestBody);
});

test("gap_recovery: server-built, never cached, no officers layer", async () => {
  const schema = pipeline.getSchemaFromConfig("GB", "Corporate", STORED);
  const body = {
    mode: "gap_recovery",
    companyName: "Britannia Group Limited",
    countryCode: "GB",
    countryName: "United Kingdom",
    entityType: "Corporate",
    ownershipType: "private_limited",
    missingFields: [schema.researchFields[0].field],
    upgradeableFields: [],
  };
  const res = fakeRes();
  await research(req(body), res);
  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(calls.fetch[0].body, buildAnthropicRequest(body, STORED).requestBody);
  assert.strictEqual(calls.cacheGet.length + calls.cacheSave.length, 0);
  assert.strictEqual(calls.officers.length, 0);
});

test("extract_document: server-built, no tools, never cached", async () => {
  const body = { mode: "extract_document", docKey: "certificate", file: { mediaType: "application/pdf", base64: "JVBERi0=" } };
  const res = fakeRes();
  await research(req(body), res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(calls.fetch[0].body.tools, undefined);
  assert.strictEqual(calls.fetch[0].body.max_tokens, 4096);
  assert.strictEqual(calls.cacheGet.length + calls.cacheSave.length, 0);
});

test("invalid structured input is a 400 with the builder's code", async () => {
  const res = fakeRes();
  await research(req({ mode: "extract_document", docKey: "nope", file: {} }), res);
  assert.strictEqual(res.statusCode, 400);
  assert.deepStrictEqual(res.body, { error: "invalid_doc_key" });
  assert.strictEqual(calls.fetch.length, 0);
});

test("an Anthropic error passes its status and details through", async () => {
  research.__setDeps({
    fetch: async () => ({ ok: false, status: 429, json: async () => ({ error: { type: "rate_limit_error", message: "slow down" } }) }),
  });
  const res = fakeRes();
  await research(req(researchBody()), res);
  assert.strictEqual(res.statusCode, 429);
  assert.deepStrictEqual(res.body, { error: "Claude API error", details: { error: { type: "rate_limit_error", message: "slow down" } } });
});

test("an unexpected failure is a 500 without the raw message", async () => {
  research.__setDeps({ fetch: async () => { throw new Error("socket hang up at 10.0.0.1"); } });
  const res = fakeRes();
  await research(req(researchBody()), res);
  assert.strictEqual(res.statusCode, 500);
  assert.deepStrictEqual(res.body, { error: "research_failed" });
});

test("a missing API key is reported before any Anthropic call", async () => {
  delete process.env.ANTHROPIC_API_KEY;
  const res = fakeRes();
  await research(req(researchBody()), res);
  assert.strictEqual(res.statusCode, 500);
  assert.deepStrictEqual(res.body, { error: "Server API key not configured" });
  assert.strictEqual(calls.fetch.length, 0);
});

test("non-POST methods are refused", async () => {
  const res = fakeRes();
  await research({ method: "GET", headers: {}, query: {}, url: "/api/research" }, res);
  assert.strictEqual(res.statusCode, 405);
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `node --test api/__tests__/research.nodetest.js`
Expected: FAIL — the ESM `api/research.js` cannot be required / `__setDeps is not a function`.

- [ ] **Step 4: Rewrite `api/research.js`**

```js
// POST /api/research — every Claude call for the onboarding research flow.
//
// The browser sends structured input (a mode plus company facts). This handler
// resolves the tenant, rate-limits the caller, loads the tenant's stored
// config and builds the prompt, model, tools and token budget itself
// (lib/researchPrompts.js). A client-authored prompt/messages/model/tools/
// max_tokens is refused outright, so the endpoint can no longer be used as a
// general-purpose Anthropic proxy.
//
// Admin preview may send `draftConfig`; it is honoured only with a valid admin
// token in X-Admin-Token and never touches the research cache.
//
// CommonJS so src/setupProxy.js mounts this exact handler for `npm start`.

const { getTenantIdFromRequest } = require("../lib/tenant");
const researchCache = require("../lib/researchCache");
const officersLayer = require("../lib/applyOfficersLayer");
const { enforceRateLimit } = require("../lib/rateLimit");
const { buildAnthropicRequest, ResearchInputError, CLIENT_OWNED_KEYS } = require("../lib/researchPrompts");
const config = require("./config");

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

let _deps = {
  fetch: (...args) => fetch(...args),
  cache: researchCache,
  officersLayer,
  enforceRateLimit,
  readConfigForTenant: config.readConfigForTenant,
  authorizeAdmin: config.authorizeAdminForTenant,
};

function header(req, name) {
  const headers = (req && req.headers) || {};
  const value = headers[name] || headers[name.toLowerCase()];
  return typeof value === "string" ? value : "";
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Tenant-Id, X-Admin-Token");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const body = req.body && typeof req.body === "object" ? req.body : {};
  const tenant = getTenantIdFromRequest(req);
  if (!tenant) return res.status(400).json({ error: "tenant_required" });
  if (CLIENT_OWNED_KEYS.some((key) => body[key] !== undefined)) {
    return res.status(400).json({ error: "client_prompt_not_allowed" });
  }

  if (!(await _deps.enforceRateLimit(req, res, "research"))) return undefined;

  try {
    let tenantConfig = null;
    let usingDraft = false;
    if (body.draftConfig && typeof body.draftConfig === "object" && !Array.isArray(body.draftConfig)) {
      const adminToken = header(req, "x-admin-token");
      if (adminToken && (await _deps.authorizeAdmin(tenant, adminToken))) {
        tenantConfig = body.draftConfig;
        usingDraft = true;
      }
    }
    if (!tenantConfig) tenantConfig = await _deps.readConfigForTenant(tenant);
    if (!tenantConfig) return res.status(404).json({ error: "tenant_not_found" });

    let built;
    try {
      built = buildAnthropicRequest(body, tenantConfig);
    } catch (err) {
      if (err instanceof ResearchInputError) return res.status(400).json({ error: err.code });
      throw err;
    }

    const cacheParts = built.cacheKeyParts && !usingDraft ? { tenant, ...built.cacheKeyParts } : null;
    if (cacheParts && body.forceRefresh !== true) {
      try {
        const cached = await _deps.cache.getCachedResearch(cacheParts);
        if (cached) return res.status(200).json(cached);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[research-cache] lookup failed, falling through:", err.message);
      }
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "Server API key not configured" });

    // LAYER 1 — Companies House officers (deterministic) for the main research
    // call only; null on non-GB, missing key or failure, and injection is then
    // a no-op.
    const chOfficers = built.officers ? await _deps.officersLayer.fetchOfficersLayer(built.officers) : null;

    const response = await _deps.fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(built.requestBody),
    });
    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: "Claude API error", details: data });
    }

    if (built.officers) _deps.officersLayer.injectOfficers(data, chOfficers);

    if (cacheParts) {
      try {
        await _deps.cache.saveResearchToCache(cacheParts, data, built.requestBody.model);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[research-cache] save failed:", err.message);
      }
    }

    return res.status(200).json(data);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[api/research] failed:", err);
    return res.status(500).json({ error: "research_failed" });
  }
};

// Test seam only.
module.exports.__setDeps = (d) => { _deps = { ..._deps, ...d }; };
```

- [ ] **Step 5: Run to verify it passes**

Run: `node --test api/__tests__/research.nodetest.js`
Expected: PASS, 18 tests.

- [ ] **Step 6: Mount the real handler in `src/setupProxy.js`**

1. Add next to the other handler requires (after `generatePolicyHandler`):

```js
const researchHandler = require(path.join(__dirname, "..", "api", "research.js"));
```

2. Replace the whole `app.post("/api/research", (req, res) => { ... });` block (the hand-copied research logic, from `app.post("/api/research"` down to its closing `});`) with:

```js
  // Research — the real handler (server-built prompts, rate limit, cache).
  app.post("/api/research", (req, res) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      try { req.body = raw ? JSON.parse(raw) : {}; } catch (_) { req.body = {}; }
      adapt(researchHandler)(req, res);
    });
  });
```

3. Use the Grep tool on `src/setupProxy.js` for `officersLayer` and `pathToFileURL`. Delete the `officersLayer` require if it has no remaining use. Keep `pathToFileURL` if anything else still uses it.
4. Update the file's header comment line "Mirrors api/research.js, api/config.js, and api/admin-auth.js so the same" only if it now reads wrongly; the handler list below it is the source of truth.

- [ ] **Step 7: Run the suites**

Run: `npm run test:node`
Expected: PASS, 0 failures.

Run: `node -e "require('./src/setupProxy.js')"`
Expected: exits 0 with no output (the module loads; it exports a function).

- [ ] **Step 8: Commit**

```bash
git add api/research.js api/config.js src/setupProxy.js api/__tests__/research.nodetest.js
git commit -m "feat(security): /api/research refuses client prompts and builds every call server-side"
```

---

### Task 5: Research call sites send structured input

**Files:**
- Create: `src/utils/rateLimitMessage.js`, `src/utils/__tests__/rateLimitMessage.test.js`
- Modify: `src/workflows/documentWorkflow.js` (`extractFromDoc`)
- Create: `src/workflows/__tests__/documentWorkflow.test.js`
- Modify: `src/App.js` (`doResearch`: main research call, gap recovery call, `extractFromDoc` call; imports)
- Modify: `src/__tests__/demoGuard.test.jsx` (new describe block)

**Interfaces:**
- Consumes: Task 4 `POST /api/research` contract; `src/utils/dossierCredential.js#getDossierAuthHeaders(tenantId)` → `{ Authorization?, "X-Tenant-Id" }`; App state `tenantId`, `preboardingTenantId`, `inPreview`, `tenantConfig`.
- Produces:
  - `rateLimitMessage(retryAfterSeconds)` → `"Too many requests — please try again in N minutes"` (`N = max(1, ceil(seconds/60))`, singular "minute" when N is 1; missing/invalid seconds → 1 minute).
  - `extractFromDoc(docType, file, schema, flow, fetchTs, { headers } = {})` — same return shape as today.

- [ ] **Step 1: Write the failing tests**

Create `src/utils/__tests__/rateLimitMessage.test.js`:

```js
import { rateLimitMessage } from "../rateLimitMessage";

test("rounds up to whole minutes", () => {
  expect(rateLimitMessage(120)).toBe("Too many requests — please try again in 2 minutes");
  expect(rateLimitMessage(121)).toBe("Too many requests — please try again in 3 minutes");
});

test("never says zero and uses the singular for one minute", () => {
  expect(rateLimitMessage(5)).toBe("Too many requests — please try again in 1 minute");
  expect(rateLimitMessage(undefined)).toBe("Too many requests — please try again in 1 minute");
  expect(rateLimitMessage("nonsense")).toBe("Too many requests — please try again in 1 minute");
});
```

Create `src/workflows/__tests__/documentWorkflow.test.js`:

```js
import { extractFromDoc } from "../documentWorkflow";

afterEach(() => {
  delete global.fetch;
});

test("document extraction names the slot and sends the file; the server owns prompt, model and tools", async () => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ content: [{ type: "text", text: "[]" }], usage: { input_tokens: 1, output_tokens: 1 } }),
  });
  const file = new File(["%PDF-1.4"], "cert.pdf", { type: "application/pdf" });
  const docType = { key: "certificate", extractionPrompt: "IGNORED BY SERVER", sourceName: "Certificate" };
  const schema = { researchFields: [] };

  const result = await extractFromDoc(docType, file, schema, "corporate", "2026-09-16T00:00:00Z", {
    headers: { "X-Tenant-Id": "acme", Authorization: "Bearer dossier:tok" },
  });

  expect(result.usage).toEqual({ input_tokens: 1, output_tokens: 1 });
  const [url, init] = global.fetch.mock.calls[0];
  expect(url).toBe("/api/research");
  expect(init.headers).toEqual({ "Content-Type": "application/json", "X-Tenant-Id": "acme", Authorization: "Bearer dossier:tok" });
  const body = JSON.parse(init.body);
  expect(body.mode).toBe("extract_document");
  expect(body.docKey).toBe("certificate");
  expect(body.file.mediaType).toBe("application/pdf");
  expect(typeof body.file.base64).toBe("string");
  expect(body.file.base64.length).toBeGreaterThan(0);
  for (const key of ["prompt", "messages", "model", "tools", "max_tokens"]) {
    expect(body).not.toHaveProperty(key);
  }
});
```

Append to `src/__tests__/demoGuard.test.jsx` (after the existing `describe("doResearch paid-call confirm guard", ...)` block):

```jsx
describe("research request shape (server-built prompts)", () => {
  it("sends structured research input, then gap recovery by field id, never a prompt", async () => {
    window.confirm.mockReturnValueOnce(true);
    global.fetch = jest.fn((url) => (url === "/api/research"
      ? Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ content: [{ type: "text", text: "{\"found\":[]}" }], usage: { input_tokens: 1, output_tokens: 1 } }),
      })
      : Promise.reject(new Error("offline test"))));
    await driveToResearchKickoff();
    await settle(5000);

    const bodies = researchCalls().map(([, init]) => JSON.parse(init.body));
    expect(bodies.length).toBeGreaterThanOrEqual(2);
    expect(bodies[0]).toMatchObject({
      mode: "research",
      companyName: "Britannia Group Limited",
      countryCode: "GB",
      entityType: "Corporate",
    });
    expect(typeof bodies[0].ownershipType).toBe("string");
    expect(bodies[1].mode).toBe("gap_recovery");
    expect(Array.isArray(bodies[1].missingFields)).toBe(true);
    expect(bodies[1].missingFields.length).toBeGreaterThan(0);
    bodies[1].missingFields.forEach((id) => expect(typeof id).toBe("string"));
    for (const body of bodies) {
      for (const key of ["prompt", "messages", "model", "tools", "max_tokens"]) {
        expect(body).not.toHaveProperty(key);
      }
    }
  });

  it("shows the rate-limit message when research returns 429", async () => {
    window.confirm.mockReturnValueOnce(true);
    global.fetch = jest.fn((url) => (url === "/api/research"
      ? Promise.resolve({ ok: false, status: 429, json: async () => ({ error: "rate_limited", retryAfterSeconds: 120 }) })
      : Promise.reject(new Error("offline test"))));
    await driveToResearchKickoff();
    await settle(0);

    expect(screen.getAllByText(/Too many requests — please try again in 2 minutes/).length).toBeGreaterThan(0);
  });
});
```

If the 429 test cannot find the text, read how `error` renders on the step `doResearch` returns to (`setStep(S.input)`) and assert against that element — do not weaken the assertion to "anything rendered".

- [ ] **Step 2: Run to verify they fail**

Run: `CI=true npx react-scripts test --watchAll=false src/utils/__tests__/rateLimitMessage.test.js src/workflows/__tests__/documentWorkflow.test.js src/__tests__/demoGuard.test.jsx`
Expected: FAIL — `rateLimitMessage` module missing; extraction body still has `messages`/`model`; research body has `prompt`.

- [ ] **Step 3: Create `src/utils/rateLimitMessage.js`**

```js
// Client copy for a 429 { error: "rate_limited", retryAfterSeconds } from any
// Claude-spending endpoint.
export function rateLimitMessage(retryAfterSeconds) {
  const seconds = Number(retryAfterSeconds);
  const minutes = Math.max(1, Math.ceil((Number.isFinite(seconds) ? seconds : 0) / 60));
  return `Too many requests — please try again in ${minutes} minute${minutes === 1 ? "" : "s"}`;
}
```

- [ ] **Step 4: Update `extractFromDoc` in `src/workflows/documentWorkflow.js`**

Replace the function signature line and the `fetch` call:

```js
export const extractFromDoc = async (docType, file, schema, flow, fetchTs, { headers = {} } = {}) => {
    const base64 = await readFileAsBase64(file);
    const mediaType = file.type === "image/png" || file.type === "image/jpeg" ? file.type : "application/pdf";
    // The server picks the extraction prompt, model and token budget from the
    // document slot (POST /api/research mode "extract_document").
    const resp = await fetch("/api/research", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({
        mode: "extract_document",
        docKey: docType.key,
        file: { mediaType, base64 },
      }),
    });
```

Delete the now-unused `isImage` and `blockType` locals. Everything after the `fetch` stays unchanged.

- [ ] **Step 5: Update `doResearch` in `src/App.js`**

1. Add to the imports near the other `./utils/...` imports:

```js
import { rateLimitMessage } from "./utils/rateLimitMessage";
```

2. Immediately above `const doResearch = async (journeyOverride) => {`, add (plain functions, not hooks):

```js
  // /api/research builds every prompt server-side. The client sends only the
  // tenant, its credential (which picks the rate-limit bucket) and, in admin
  // preview, the staged draft config plus the admin token the server needs to
  // honour it.
  const researchHeaders = () => {
    const headers = { ...getDossierAuthHeaders(preboardingTenantId || tenantId) };
    if (inPreview) {
      try {
        const adminToken = sessionStorage.getItem("admin_token");
        if (adminToken) headers["X-Admin-Token"] = adminToken;
      } catch (_) { /* storage blocked — preview falls back to the live config */ }
    }
    return headers;
  };
  const previewDraftBody = () => (inPreview && tenantConfig ? { draftConfig: tenantConfig } : {});
```

3. In the Phase 1 loop, change the extraction call to:

```js
          const { docFound: dFound, wolfsbergFields: wFields, usage: dUsage } = await extractFromDoc(dt, file, schema, flow, fetchTs, { headers: researchHeaders() });
```

4. Replace everything from the comment `// ─── Phase 2: web research, optionally seeded with Wolfsberg fields ───` down to and including the main `const resp = await fetch("/api/research", { ... });` call with:

```js
      // ─── Phase 2: web research, optionally seeded with Wolfsberg fields ───
      // The server builds the prompt from this tenant's schema, including the
      // PRIMARY COMPANY IDENTIFIER (reg number) and AUTOMATICALLY SOURCED
      // DOCUMENTS blocks (lib/researchPrompts.js).
      const trimmedRegNumber = regNumber.trim();
      const acceptedDocs = (docSearchResults?.documents || [])
        .filter(d => acceptedDocTypes.has(d.type));
      const resp = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...researchHeaders() },
        body: JSON.stringify({
          mode: "research",
          companyName,
          countryCode,
          countryName: countryObj ? countryObj.name : countryCode,
          entityType,
          ownershipType,
          // Optional reg number → primary search key and the Companies House
          // officers layer. Undefined when blank.
          registrationNumber: trimmedRegNumber || undefined,
          forceRefresh,
          wolfsbergFields,
          sourcedDocuments: acceptedDocs.map(({ label, year, sourceUrl, sourceLabel }) => ({ label, year, sourceUrl, sourceLabel })),
          ...previewDraftBody(),
        }),
      });
```

5. In the `if (!resp.ok) {` block right below, insert as its second line (after `const errData = ...`):

```js
        if (resp.status === 429) throw new Error(rateLimitMessage(errData.retryAfterSeconds));
```

6. Delete the line `const recoveryStrategy = ownershipType ? computeResearchStrategy(ownershipType, countryCode) : null;` in Phase 3, and replace the gap-recovery `fetch` call with:

```js
          const gapResp = await fetch("/api/research", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...researchHeaders() },
            body: JSON.stringify({
              mode: "gap_recovery",
              companyName,
              countryCode,
              countryName: countryObj ? countryObj.name : countryCode,
              entityType,
              ownershipType,
              missingFields: cov.missingFields.map((f) => f.field),
              upgradeableFields: upgradeable.map((r) => r.field),
              ...previewDraftBody(),
            }),
          });
```

7. Use the Grep tool on `src/App.js` for each of `buildPrompt`, `buildGapRecoveryPrompt`, `RESEARCH_TOOLS`, `computeResearchStrategy`. Remove from the `./pipeline` import list every name that no longer has a use outside the import itself (CRA's build treats unused imports as errors under `CI=true`).

- [ ] **Step 6: Run to verify they pass**

Run: `CI=true npx react-scripts test --watchAll=false src/utils/__tests__/rateLimitMessage.test.js src/workflows/__tests__/documentWorkflow.test.js src/__tests__/demoGuard.test.jsx`
Expected: PASS (the two original demoGuard tests still pass: decline → 0 research calls; accept → exactly 1 research call, because the default fetch mock rejects).

Run: `CI=true npx react-scripts test --watchAll=false`
Expected: PASS. Re-run any of `PolicySimulator.test.jsx`, `appMounts.test.jsx`, `noTenantLanding.integration.test.jsx` in isolation before calling a failure a regression.

Run: `npm run build`
Expected: `Compiled successfully.`

- [ ] **Step 7: Commit**

```bash
git add src/utils/rateLimitMessage.js src/utils/__tests__/rateLimitMessage.test.js src/workflows/documentWorkflow.js src/workflows/__tests__/documentWorkflow.test.js src/App.js src/__tests__/demoGuard.test.jsx
git commit -m "feat(security): research, gap-recovery and extraction calls send structured input"
```

---

### Task 6: Benchmark behind admin auth; rate limits on the agent endpoints

**Files:**
- Modify: `api/benchmark.js`, `api/__tests__/benchmark.nodetest.js` (rewrite), `benchmark/run.mjs`
- Modify: `api/doc-search.js`, `api/self-source.js`, `api/ubo-discovery.js`, `api/ubo-control-lab.js`
- Modify: `src/App.js` (`runRealSelfSource`, `runRealDocSearch`)
- Test: `api/__tests__/agent-rate-limits.nodetest.js`

**Interfaces:**
- Consumes: Task 1 `enforceRateLimit` + `__setDeps`; Task 4 `api/config.js#authorizeAdminForTenant`; Task 5 `rateLimitMessage`.
- Produces:
  - `api/benchmark.js`: `401 { error: "unauthorized" }` unless `Authorization: Bearer <tenant admin password>` passes `authorizeAdminForTenant(tenant, token)`; checked before the config read. `__setDeps({ authorizeAdmin, readConfigForTenant })`.
  - `benchmark/run.mjs`: sends `Authorization: Bearer $BENCHMARK_ADMIN_TOKEN` when that env var is set.
  - `doc-search` / `self-source` / `ubo-discovery`: `429` after input validation, before any agent work.
  - `api/ubo-control-lab.js` exports `invokeLegacyDiscovery(body, headers)` and forwards the caller's `x-forwarded-for`, `x-real-ip`, `authorization`, `x-tenant-id` so START_LIVE draws from the caller's ubo-discovery bucket.

- [ ] **Step 1: Write the failing tests**

Replace the contents of `api/__tests__/benchmark.nodetest.js`:

```js
const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const benchmark = require("../benchmark");

function fakeReqRes({ method = "GET", query = {}, headers = {} } = {}) {
  const req = { method, query, headers, url: "/api/benchmark" };
  const res = {
    statusCode: null, body: null, headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    end() { return this; },
  };
  return { req, res };
}

let readConfigCalls;

beforeEach(() => {
  readConfigCalls = [];
  benchmark.__setDeps({
    authorizeAdmin: async (tenant, token) => tenant === "acme" && token === "admin-secret",
    readConfigForTenant: async (tenant) => { readConfigCalls.push(tenant); return tenant === "acme" ? { entityTypes: [] } : null; },
  });
});

test("no credential is a 401 and the tenant config is never read", async () => {
  const { req, res } = fakeReqRes({ query: { tenant: "acme", companyName: "X", countryCode: "GB", entityType: "Corporate" } });
  await benchmark(req, res);
  assert.strictEqual(res.statusCode, 401);
  assert.deepStrictEqual(res.body, { error: "unauthorized" });
  assert.deepStrictEqual(readConfigCalls, []);
});

test("a wrong admin password is a 401", async () => {
  const { req, res } = fakeReqRes({ query: { tenant: "acme" }, headers: { authorization: "Bearer nope" } });
  await benchmark(req, res);
  assert.strictEqual(res.statusCode, 401);
});

test("no resolvable tenant is a 401 (there is nothing to authenticate against)", async () => {
  const { req, res } = fakeReqRes({ headers: { authorization: "Bearer admin-secret" } });
  await benchmark(req, res);
  assert.strictEqual(res.statusCode, 401);
});

test("an admin credential for a tenant with no config is a 404", async () => {
  benchmark.__setDeps({ authorizeAdmin: async () => true });
  const { req, res } = fakeReqRes({ query: { tenant: "ghost" }, headers: { authorization: "Bearer admin-secret" } });
  await benchmark(req, res);
  assert.strictEqual(res.statusCode, 404);
  assert.deepStrictEqual(res.body, { error: "tenant_not_found" });
});

test("a valid admin credential clears the gate (no company given → 400, still no Anthropic call)", async () => {
  const { req, res } = fakeReqRes({ query: { tenant: "acme" }, headers: { authorization: "Bearer admin-secret" } });
  await benchmark(req, res);
  assert.strictEqual(res.statusCode, 400);
  assert.deepStrictEqual(readConfigCalls, ["acme"]);
});
```

Create `api/__tests__/agent-rate-limits.nodetest.js`:

```js
const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const rateLimit = require("../../lib/rateLimit");

function fakeRes() {
  return {
    statusCode: null, body: null, headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    write() { return true; },
    end() { return this; },
  };
}

let seenKeys;

// Every bucket is already full, so the first request is refused.
beforeEach(() => {
  seenKeys = [];
  rateLimit.__setDeps({
    now: () => 500 * 3600 * 1000,
    resolveDossierActor: async () => ({ kind: "none", reason: "unauthorized" }),
    storage: {
      async get(key) { seenKeys.push(key); return 999; },
      async set() { throw new Error("a refused request must not increment"); },
    },
  });
});

const ip = { "x-forwarded-for": "7.7.7.7" };

test("doc-search is rate limited after validation, before the agent loads", async () => {
  const handler = require("../doc-search");
  const res = fakeRes();
  await handler({ method: "POST", headers: ip, body: { companyName: "X", country: "UK", ownershipType: "corporate", niumEntityType: "corporate" } }, res);
  assert.strictEqual(res.statusCode, 429);
  assert.strictEqual(res.body.error, "rate_limited");
  assert.ok(seenKeys[0].startsWith("ratelimit:doc-search:ip:7.7.7.7:"));
  const invalid = fakeRes();
  await handler({ method: "POST", headers: ip, body: {} }, invalid);
  assert.strictEqual(invalid.statusCode, 400);
});

test("self-source is rate limited after validation, before the agent loads", async () => {
  const handler = require("../self-source");
  const res = fakeRes();
  await handler({ method: "POST", headers: ip, body: { companyName: "X", incorporationCountry: "United Kingdom", entityType: "Corporate", ownershipType: "private_limited" } }, res);
  assert.strictEqual(res.statusCode, 429);
  assert.ok(seenKeys[0].startsWith("ratelimit:self-source:ip:7.7.7.7:"));
});

test("ubo-discovery is rate limited before any investigation starts", async () => {
  const handler = require("../ubo-discovery");
  const res = fakeRes();
  await handler({ method: "POST", headers: ip, body: { entityName: "X Ltd", jurisdiction: "GB" } }, res);
  assert.strictEqual(res.statusCode, 429);
  assert.ok(seenKeys[0].startsWith("ratelimit:ubo-discovery:ip:7.7.7.7:"));
});

test("the UBO lab's live run draws from the caller's ubo-discovery bucket", async () => {
  const { invokeLegacyDiscovery } = require("../ubo-control-lab");
  const result = await invokeLegacyDiscovery({ entityName: "X Ltd", jurisdiction: "GB" }, { "x-forwarded-for": "8.8.8.8" });
  assert.strictEqual(result.status, 429);
  assert.ok(seenKeys[0].startsWith("ratelimit:ubo-discovery:ip:8.8.8.8:"));
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test api/__tests__/benchmark.nodetest.js api/__tests__/agent-rate-limits.nodetest.js`
Expected: FAIL — benchmark has no auth / no `__setDeps`; handlers are not rate limited; `invokeLegacyDiscovery` is not exported.

- [ ] **Step 3: Admin auth in `api/benchmark.js`**

1. Replace `const { readConfigForTenant } = require("./config");` with:

```js
const { readConfigForTenant, authorizeAdminForTenant } = require("./config");

// Injected deps (overridable in tests via __setDeps).
let _deps = { readConfigForTenant, authorizeAdmin: authorizeAdminForTenant };
```

2. Change the CORS headers line to `res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Tenant-Id");`.
3. Replace the start of the `try` block (`const tenantConfig = await readConfigForTenant(tenant);`) with:

```js
    // Admin-only: every benchmark run spends Claude tokens.
    const auth = (req.headers && (req.headers.authorization || req.headers.Authorization)) || "";
    const token = typeof auth === "string" && auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
    if (!tenant || !token || !(await _deps.authorizeAdmin(tenant, token))) {
      return res.status(401).json({ error: "unauthorized" });
    }

    const tenantConfig = await _deps.readConfigForTenant(tenant);
```

4. Update the header comment's usage lines to mention `Authorization: Bearer <tenant admin password>`.
5. Append at the end of the file:

```js

// Test seam only.
module.exports.__setDeps = (d) => { _deps = { ..._deps, ...d }; };
```

- [ ] **Step 4: `benchmark/run.mjs` sends the admin token**

1. Add below the flags comment block (after `//   --out <dir>         default benchmark/out`):

```js
// Env: BENCHMARK_ADMIN_TOKEN — the tenant's admin password; /api/benchmark
// requires it. Put the tenant in --endpoint (…/api/benchmark?tenant=<id>).
```

2. In `callOnce`, change `headers: { 'Content-Type': 'application/json' },` to:

```js
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.BENCHMARK_ADMIN_TOKEN ? { Authorization: `Bearer ${process.env.BENCHMARK_ADMIN_TOKEN}` } : {}),
      },
```

- [ ] **Step 5: Rate limit the agent endpoints**

`api/doc-search.js` — add at the top (after the header comment):

```js
const { enforceRateLimit } = require("../lib/rateLimit");
```

and insert immediately after the `Missing required fields` 400 block, before `try {`:

```js
  if (!(await enforceRateLimit(req, res, "doc-search"))) return undefined;
```

`api/self-source.js` — same require at the top, and immediately after its `Missing required fields` 400 block:

```js
  if (!(await enforceRateLimit(req, res, "self-source"))) return undefined;
```

`api/ubo-discovery.js` — add `const { enforceRateLimit } = require("../lib/rateLimit");` below the other requires, and insert after the `discoveryThreshold` validation line and before `const streaming = ...`:

```js
  if (!(await enforceRateLimit(req, res, "ubo-discovery"))) return undefined;
```

`api/ubo-control-lab.js` — replace `function invokeLegacyDiscovery(body) {` and its `const request = ...` line with:

```js
// Caller identity headers the rate limiter reads; forwarded so a live lab run
// spends the caller's own ubo-discovery bucket.
const FORWARDED_HEADERS = ["x-forwarded-for", "x-real-ip", "authorization", "x-tenant-id"];

function invokeLegacyDiscovery(body, callerHeaders = {}) {
  return new Promise((resolve, reject) => {
    const headers = { accept: "application/json" };
    for (const name of FORWARDED_HEADERS) {
      if (typeof callerHeaders[name] === "string") headers[name] = callerHeaders[name];
    }
    const request = { method: "POST", body, headers };
```

(the rest of the function body is unchanged), change the START_LIVE transport to:

```js
          transport: { invoke: ({ body }) => invokeLegacyDiscovery(body, req.headers || {}) },
```

and append at the end of the file:

```js
module.exports.invokeLegacyDiscovery = invokeLegacyDiscovery;
```

- [ ] **Step 6: Client headers and 429 copy for doc-search / self-source in `src/App.js`**

In `runRealSelfSource`, change the fetch headers and the first `.then`:

```js
    fetch("/api/self-source", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getDossierAuthHeaders(preboardingTenantId || tenantId) },
```

```js
      .then(r => r.json().then(data => (r.status === 429 ? { error: rateLimitMessage(data.retryAfterSeconds) } : data)))
```

In `runRealDocSearch`, the same two changes:

```js
    fetch("/api/doc-search", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getDossierAuthHeaders(preboardingTenantId || tenantId) },
```

```js
      .then(r => r.json().then(data => (r.status === 429 ? { error: rateLimitMessage(data.retryAfterSeconds) } : data)))
```

Both existing `else` branches already render `data.error`.

- [ ] **Step 7: Run to verify they pass**

Run: `node --test api/__tests__/benchmark.nodetest.js api/__tests__/agent-rate-limits.nodetest.js`
Expected: PASS, 9 tests. If requiring `api/ubo-discovery.js` or `api/ubo-control-lab.js` throws at load without env vars, stop and report NEEDS_CONTEXT rather than stubbing the agents.

Run: `npm run test:node`
Expected: PASS, 0 failures.

Run: `CI=true npx react-scripts test --watchAll=false`
Expected: PASS (re-run known-flaky suites in isolation before calling a failure a regression).

Run: `npm run build`
Expected: `Compiled successfully.`

- [ ] **Step 8: Commit**

```bash
git add api/benchmark.js api/__tests__/benchmark.nodetest.js benchmark/run.mjs api/doc-search.js api/self-source.js api/ubo-discovery.js api/ubo-control-lab.js api/__tests__/agent-rate-limits.nodetest.js src/App.js
git commit -m "feat(security): benchmark requires admin auth; rate limits on doc-search, self-source and UBO discovery"
```

---

### Task 7: Policy simulator sends its structured form

**Files:**
- Create: `src/policySimulator/policyConfig.js`
- Modify: `src/policySimulator/PolicySimulator.jsx`, `src/policySimulator/PolicySimulator.test.jsx`
- Modify: `api/generate-policy.js`
- Move: `scripts/tests/policy-simulator-api.test.js` → `api/__tests__/generate-policy.nodetest.js` (and rewrite it)

**Interfaces:**
- Consumes: Task 1 `enforceRateLimit(req, res, "generate-policy")`; Task 5 `rateLimitMessage`.
- Produces:
  - `src/policySimulator/policyConfig.js` (CommonJS): `FIRM_TYPES`, `CUSTOMER_TYPES`, `GEOGRAPHIES`, `PRODUCTS`, `VENDORS`, `RISK_FIELDS`, `TEXT_LIMITS` (`{ policyName: 120, version: 20, otherVendor: 120 }`), `buildUserMessage(form)`, `validatePolicyForm(input)` → `{ ok: true, form }` | `{ ok: false, error: "invalid_policy_configuration", field }`.
  - `POST /api/generate-policy` body `{ form }`: `400 { error: "client_prompt_not_allowed" }` if `prompt` present; `400 { error: "invalid_policy_configuration", field }`; `500` missing key; `429` rate limited; `200 { policyHtml }`; `502 { error }` on model failure (unchanged).
  - `PolicySimulator.jsx` still exports `buildUserMessage`, `createInitialForm`, `sanitizePolicyHtml`, default component.

- [ ] **Step 1: Move and rewrite the API test**

Run: `git mv scripts/tests/policy-simulator-api.test.js api/__tests__/generate-policy.nodetest.js`

Use the Grep tool for `policy-simulator-api` across the repo (excluding `node_modules`, `build`) and update any reference.

Replace the contents of `api/__tests__/generate-policy.nodetest.js`:

```js
const { afterEach, beforeEach, describe, it } = require("node:test");
const assert = require("node:assert/strict");
const handler = require("../generate-policy.js");
const rateLimit = require("../../lib/rateLimit");
const { validatePolicyForm, buildUserMessage, TEXT_LIMITS } = require("../../src/policySimulator/policyConfig");

const { extractPolicyHtml } = handler;

function response() {
  return {
    statusCode: 200,
    headers: {},
    setHeader(key, value) { this.headers[key] = value; },
    end(payload) { this.payload = JSON.parse(payload); },
  };
}

function validForm(extra = {}) {
  return {
    firmType: "Authorised EMI",
    customerTypes: ["Trusts"],
    geography: "Global (all jurisdictions)",
    products: ["International payments / cross-border transfers"],
    highRiskIndustries: "Decline all",
    pepAppetite: "Domestic PEPs with EDD",
    complexOwnership: "EDD permitted",
    fatfCallForAction: "Prohibited",
    fatfIncreasedMonitoring: "EDD required",
    vendors: ["Other"],
    otherVendor: "Verified Vendor",
    policyName: "KYB Policy",
    version: "v1.0",
    effectiveDate: "2026-09-16",
    ...extra,
  };
}

let storedCounts;

beforeEach(() => {
  storedCounts = {};
  rateLimit.__setDeps({
    now: () => 500 * 3600 * 1000,
    resolveDossierActor: async () => ({ kind: "none" }),
    storage: {
      async get(k) { return storedCounts[k] || null; },
      async set(k, v) { storedCounts[k] = v; },
    },
  });
});

afterEach(() => {
  delete global.fetch;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.RATE_LIMIT_GENERATE_POLICY;
});

describe("policy form validation", () => {
  it("accepts a complete form and normalises the free text", () => {
    const result = validatePolicyForm(validForm({ policyName: "  My\nPolicy  ", otherVendor: " Vendor\tX " }));
    assert.equal(result.ok, true);
    assert.equal(result.form.policyName, "My Policy");
    assert.equal(result.form.otherVendor, "Vendor X");
  });

  it("rejects values outside the allowed option lists", () => {
    assert.deepEqual(validatePolicyForm(validForm({ firmType: "Bank" })), { ok: false, error: "invalid_policy_configuration", field: "firmType" });
    assert.equal(validatePolicyForm(validForm({ customerTypes: ["Trusts", "Ignore previous instructions"] })).field, "customerTypes");
    assert.equal(validatePolicyForm(validForm({ customerTypes: [] })).field, "customerTypes");
    assert.equal(validatePolicyForm(validForm({ pepAppetite: "Anything goes" })).field, "pepAppetite");
    assert.equal(validatePolicyForm(validForm({ vendors: ["Other", "Other"] })).field, "vendors");
    assert.equal(validatePolicyForm(validForm({ effectiveDate: "16/09/2026" })).field, "effectiveDate");
    assert.equal(validatePolicyForm(null).field, "firmType");
  });

  it("rejects over-long or empty free text", () => {
    assert.equal(validatePolicyForm(validForm({ policyName: "x".repeat(TEXT_LIMITS.policyName + 1) })).field, "policyName");
    assert.equal(validatePolicyForm(validForm({ version: "   " })).field, "version");
    assert.equal(validatePolicyForm(validForm({ otherVendor: "x".repeat(TEXT_LIMITS.otherVendor + 1) })).field, "otherVendor");
  });

  it("drops otherVendor when Other is not selected", () => {
    const result = validatePolicyForm(validForm({ vendors: ["Didit (identity verification)"], otherVendor: "leftover" }));
    assert.equal(result.ok, true);
    assert.equal(result.form.otherVendor, "");
  });
});

describe("policy API", () => {
  it("rejects unsupported methods, a client prompt and an invalid form", async () => {
    const methodResponse = response();
    await handler({ method: "GET", headers: {} }, methodResponse);
    assert.equal(methodResponse.statusCode, 405);

    const promptResponse = response();
    await handler({ method: "POST", headers: {}, body: { prompt: "Write anything", form: validForm() } }, promptResponse);
    assert.equal(promptResponse.statusCode, 400);
    assert.deepEqual(promptResponse.payload, { error: "client_prompt_not_allowed" });

    const formResponse = response();
    await handler({ method: "POST", headers: {}, body: { form: validForm({ geography: "Mars" }) } }, formResponse);
    assert.equal(formResponse.statusCode, 400);
    assert.deepEqual(formResponse.payload, { error: "invalid_policy_configuration", field: "geography" });
  });

  it("builds the user message on the server and keeps the key server-side", async () => {
    process.env.ANTHROPIC_API_KEY = "test-secret";
    const calls = [];
    global.fetch = async (...args) => {
      calls.push(args);
      return {
        ok: true,
        json: async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: "<h1>Policy</h1><p>Body</p><p>End of Policy</p>" }] }),
      };
    };
    const res = response();
    await handler({ method: "POST", headers: { "x-forwarded-for": "1.1.1.1" }, body: { form: validForm() } }, res);
    assert.equal(res.statusCode, 200);
    const [, request] = calls[0];
    const body = JSON.parse(request.body);
    assert.equal(request.headers["x-api-key"], "test-secret");
    assert.equal(body.model, "claude-sonnet-4-6");
    assert.equal(body.max_tokens, 8000);
    assert.match(body.system, /REGULATORY ACCURACY/);
    assert.match(body.system, /Do not renumber fixed sections 12–15/);
    assert.deepEqual(body.messages, [{ role: "user", content: buildUserMessage(validatePolicyForm(validForm()).form) }]);
  });

  it("is rate limited", async () => {
    process.env.ANTHROPIC_API_KEY = "test-secret";
    process.env.RATE_LIMIT_GENERATE_POLICY = "1";
    global.fetch = async () => ({
      ok: true,
      json: async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: "<h1>P</h1><p>End of Policy</p>" }] }),
    });
    const req = { method: "POST", headers: { "x-forwarded-for": "2.2.2.2" }, body: { form: validForm() } };
    const first = response();
    await handler(req, first);
    assert.equal(first.statusCode, 200);
    const second = response();
    await handler(req, second);
    assert.equal(second.statusCode, 429);
    assert.equal(second.payload.error, "rate_limited");
  });

  it("rejects empty or malformed model output", () => {
    assert.throws(() => extractPolicyHtml({ content: [{ type: "text", text: "plain text" }] }), /unexpected policy format/);
    assert.throws(() => extractPolicyHtml({ content: [{ type: "text", text: "<h1>Partial policy</h1>" }] }), /incomplete policy/);
    assert.throws(() => extractPolicyHtml({ stop_reason: "max_tokens", content: [{ type: "text", text: "<h1>Partial</h1>" }] }), /output limit/);
  });
});
```

- [ ] **Step 2: Add the failing Jest tests**

In `src/policySimulator/PolicySimulator.test.jsx`, add `import { rateLimitMessage } from '../utils/rateLimitMessage';` below the existing imports, and append inside `describe('generation and output', () => { ... })`:

```jsx
  it('sends the structured form, never a prompt', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ policyHtml: '<h1>P</h1>' }) });
    render(<PolicySimulator />);
    completeForm();
    fireEvent.click(screen.getByRole('button', { name: 'Generate Policy' }));
    await screen.findByRole('heading', { name: 'P' });
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe('/api/generate-policy');
    const body = JSON.parse(init.body);
    expect(body).not.toHaveProperty('prompt');
    expect(body.form).toMatchObject({ firmType: 'Authorised EMI', geography: 'Global (all jurisdictions)', pepAppetite: 'Domestic PEPs with EDD' });
  });

  it('shows the rate-limit message on a 429', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({ error: 'rate_limited', retryAfterSeconds: 300 }) });
    render(<PolicySimulator />);
    completeForm();
    fireEvent.click(screen.getByRole('button', { name: 'Generate Policy' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(rateLimitMessage(300));
  });
```

- [ ] **Step 3: Run to verify they fail**

Run: `node --test api/__tests__/generate-policy.nodetest.js`
Expected: FAIL — `Cannot find module '../../src/policySimulator/policyConfig'`.

Run: `CI=true npx react-scripts test --watchAll=false src/policySimulator`
Expected: FAIL — body still carries `prompt`; 429 shows `rate_limited`.

- [ ] **Step 4: Create `src/policySimulator/policyConfig.js`**

```js
// UK KYB Policy Simulator configuration shared by the browser form and
// api/generate-policy.js: the allowed option lists, the user-message builder
// and server-side validation. The browser sends its structured form; the server
// validates it against these lists and builds the message itself, so the
// endpoint cannot be used to send Claude an arbitrary prompt.
//
// CommonJS inside src/ (the src/pipeline.js precedent) so the API can require
// it and CRA can still import it.

const FIRM_TYPES = ["Authorised EMI", "Small EMI", "Authorised PI", "Small PI"];
const CUSTOMER_TYPES = [
  "UK Private Limited Companies",
  "UK Public Limited Companies",
  "UK Limited Liability Partnerships",
  "UK Partnerships",
  "Sole Traders",
  "Trusts",
  "Charities / Non-profit organisations",
  "Financial Institutions",
  "Payment Institutions / EMIs",
  "Marketplaces / Platforms",
  "Crypto-asset businesses",
];
const GEOGRAPHIES = ["UK incorporated entities only", "UK + EEA", "Global (all jurisdictions)"];
const PRODUCTS = [
  "E-money accounts",
  "Domestic payments (GBP)",
  "International payments / cross-border transfers",
  "Foreign exchange (FX)",
  "Debit / prepaid cards",
  "Acquiring / merchant services",
  "Virtual IBANs",
  "Open banking / account information services",
];
const VENDORS = [
  "Companies House API (UK registry)",
  "Didit (identity verification)",
  "ComplyCube (identity + document verification)",
  "Manual document review only",
  "Other",
];
const RISK_FIELDS = [
  {
    key: "highRiskIndustries",
    label: "High-risk industries (gambling, crypto, adult content)",
    options: ["Decline all", "EDD permitted", "Case by case"],
  },
  {
    key: "pepAppetite",
    label: "PEP appetite",
    options: ["Decline all PEPs", "Domestic PEPs with EDD", "All PEPs with EDD"],
  },
  {
    key: "complexOwnership",
    label: "Complex / multi-layered ownership structures",
    options: ["Decline", "EDD permitted"],
  },
  {
    key: "fatfCallForAction",
    label: "FATF Call-for-Action jurisdictions",
    options: ["Prohibited", "Prohibited with exceptions", "EDD required"],
  },
  {
    key: "fatfIncreasedMonitoring",
    label: "FATF Increased-Monitoring jurisdictions",
    options: ["EDD required", "Refer to MLRO", "Standard CDD"],
  },
];
const TEXT_LIMITS = Object.freeze({ policyName: 120, version: 20, otherVendor: 120 });

function buildUserMessage(form) {
  const lines = (items) => items.map((item) => `- ${item}`).join("\n");
  const vendors = form.vendors.map((vendor) =>
    vendor === "Other" ? `Other: ${form.otherVendor.trim()}` : vendor,
  );
  return `Generate a KYB Policy document for the following configuration:

FIRM DETAILS
- Firm type: ${form.firmType}
- Regulator: Financial Conduct Authority (FCA)
- Jurisdiction: United Kingdom

CUSTOMERS IN SCOPE
${lines(form.customerTypes)}

CUSTOMER GEOGRAPHY
- ${form.geography}

PRODUCTS AND SERVICES IN SCOPE
${lines(form.products)}

RISK APPETITE
- High-risk industries: ${form.highRiskIndustries}
- PEP appetite: ${form.pepAppetite}
- Complex ownership structures: ${form.complexOwnership}
- FATF Call-for-Action jurisdictions: ${form.fatfCallForAction}
- FATF Increased-Monitoring jurisdictions: ${form.fatfIncreasedMonitoring}

VERIFICATION VENDORS
${lines(vendors)}

DOCUMENT METADATA
- Policy name: ${form.policyName.trim()}
- Version: ${form.version.trim()}
- Effective date: ${form.effectiveDate}

Configuration fidelity requirements:
- Apply every selected customer type, product, geography, risk appetite, and vendor materially.
- Omit controls that relate only to unselected optional customer or product types unless legally mandatory.
- Treat configured decline or prohibited appetites as hard customer-acceptance stops.

Generate the complete KYB Policy document now, following all rules in your instructions.`;
}

// Single-line free text: any whitespace run (including newlines) becomes one space.
function singleLine(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function validatePolicyForm(input) {
  const f = input && typeof input === "object" ? input : {};
  const fail = (field) => ({ ok: false, error: "invalid_policy_configuration", field });
  const oneOf = (value, list) => typeof value === "string" && list.includes(value);
  const subset = (value, list) => Array.isArray(value)
    && value.length > 0
    && value.every((item) => list.includes(item))
    && new Set(value).size === value.length;
  const capped = (value, max) => {
    const s = singleLine(value);
    return s.length > 0 && s.length <= max;
  };

  if (!oneOf(f.firmType, FIRM_TYPES)) return fail("firmType");
  if (!subset(f.customerTypes, CUSTOMER_TYPES)) return fail("customerTypes");
  if (!oneOf(f.geography, GEOGRAPHIES)) return fail("geography");
  if (!subset(f.products, PRODUCTS)) return fail("products");
  for (const { key, options } of RISK_FIELDS) {
    if (!oneOf(f[key], options)) return fail(key);
  }
  if (!subset(f.vendors, VENDORS)) return fail("vendors");
  const hasOther = f.vendors.includes("Other");
  if (hasOther && !capped(f.otherVendor, TEXT_LIMITS.otherVendor)) return fail("otherVendor");
  if (!capped(f.policyName, TEXT_LIMITS.policyName)) return fail("policyName");
  if (!capped(f.version, TEXT_LIMITS.version)) return fail("version");
  if (typeof f.effectiveDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(f.effectiveDate)) return fail("effectiveDate");

  return {
    ok: true,
    form: {
      firmType: f.firmType,
      customerTypes: [...f.customerTypes],
      geography: f.geography,
      products: [...f.products],
      highRiskIndustries: f.highRiskIndustries,
      pepAppetite: f.pepAppetite,
      complexOwnership: f.complexOwnership,
      fatfCallForAction: f.fatfCallForAction,
      fatfIncreasedMonitoring: f.fatfIncreasedMonitoring,
      vendors: [...f.vendors],
      otherVendor: hasOther ? singleLine(f.otherVendor) : "",
      policyName: singleLine(f.policyName),
      version: singleLine(f.version),
      effectiveDate: f.effectiveDate,
    },
  };
}

module.exports = {
  FIRM_TYPES,
  CUSTOMER_TYPES,
  GEOGRAPHIES,
  PRODUCTS,
  VENDORS,
  RISK_FIELDS,
  TEXT_LIMITS,
  buildUserMessage,
  validatePolicyForm,
};
```

- [ ] **Step 5: Update `api/generate-policy.js`**

1. Add at the top of the file:

```js
const { validatePolicyForm, buildUserMessage } = require('../src/policySimulator/policyConfig');
const { enforceRateLimit } = require('../lib/rateLimit');
```

2. Replace the block from `const prompt = typeof req.body?.prompt === 'string' ...` through the `if (!process.env.ANTHROPIC_API_KEY) { ... }` block with:

```js
  // The browser sends its structured form; the server validates it against the
  // allowed option lists and builds the message. A raw prompt is refused.
  if (req.body?.prompt !== undefined) {
    res.statusCode = 400;
    return res.end(JSON.stringify({ error: 'client_prompt_not_allowed' }));
  }
  const checked = validatePolicyForm(req.body?.form);
  if (!checked.ok) {
    res.statusCode = 400;
    return res.end(JSON.stringify({ error: checked.error, field: checked.field }));
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    res.statusCode = 500;
    return res.end(JSON.stringify({ error: 'The Anthropic API key is not configured.' }));
  }
  if (!(await enforceRateLimit(req, res, 'generate-policy'))) return undefined;
  const prompt = buildUserMessage(checked.form);
```

The Anthropic call below keeps `messages: [{ role: 'user', content: prompt }]` unchanged.

- [ ] **Step 6: Update `src/policySimulator/PolicySimulator.jsx`**

1. Delete the local `FIRM_TYPES`, `CUSTOMER_TYPES`, `GEOGRAPHIES`, `PRODUCTS`, `VENDORS`, `RISK_FIELDS` constants and the local `buildUserMessage` function.
2. Add below the existing imports:

```jsx
import {
  FIRM_TYPES,
  CUSTOMER_TYPES,
  GEOGRAPHIES,
  PRODUCTS,
  VENDORS,
  RISK_FIELDS,
  TEXT_LIMITS,
  buildUserMessage,
} from './policyConfig';
import { rateLimitMessage } from '../utils/rateLimitMessage';

export { buildUserMessage };
```

3. In `generatePolicy`, change the request body and the error line:

```jsx
        body: JSON.stringify({ form }),
```

```jsx
      if (response.status === 429) throw new Error(rateLimitMessage(payload.retryAfterSeconds));
      if (!response.ok) throw new Error(payload.error || 'Claude could not generate the policy.');
```

4. Add `maxLength` to the three free-text inputs so the form cannot produce a server 400: `maxLength={TEXT_LIMITS.otherVendor}` on the Other vendor input, `maxLength={TEXT_LIMITS.policyName}` on the policy name input, `maxLength={TEXT_LIMITS.version}` on the version input.

- [ ] **Step 7: Run to verify they pass**

Run: `node --test api/__tests__/generate-policy.nodetest.js`
Expected: PASS, 8 tests.

Run: `CI=true npx react-scripts test --watchAll=false src/policySimulator`
Expected: PASS (existing tests unchanged, plus 2 new).

Run: `npm run test:node`
Expected: PASS, 0 failures.

Run: `npm run build`
Expected: `Compiled successfully.`

- [ ] **Step 8: Commit**

```bash
git add src/policySimulator/policyConfig.js src/policySimulator/PolicySimulator.jsx src/policySimulator/PolicySimulator.test.jsx api/generate-policy.js api/__tests__/generate-policy.nodetest.js scripts/tests/policy-simulator-api.test.js
git commit -m "feat(security): policy simulator sends its structured form; server validates and builds the message"
```

---

### Task 8: Verification, env docs and backlog

**Files:**
- Modify: `.env.example`, `docs/BACKLOG.md`

- [ ] **Step 1: Backend suite**

Run: `npm run test:node`
Expected: PASS, 0 failures.

- [ ] **Step 2: Frontend suite**

Run: `CI=true npx react-scripts test --watchAll=false`
Expected: PASS. Re-run any of `PolicySimulator.test.jsx`, `appMounts.test.jsx`, `noTenantLanding.integration.test.jsx` in isolation before calling a failure a regression.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: `Compiled successfully.`

- [ ] **Step 4: No client still authors a prompt**

Use the Grep tool (not `npx rg`, which creates a stray README.md on this machine):
- pattern `prompt:` in `src/App.js`, `src/workflows/documentWorkflow.js`, `src/policySimulator/PolicySimulator.jsx` — expected: no request body sets `prompt`.
- pattern `max_tokens|RESEARCH_TOOLS` in `src/` excluding `src/pipeline.js` and test files — expected: no matches.
- pattern `enforceRateLimit` in `api/` — expected: `research.js`, `doc-search.js`, `self-source.js`, `ubo-discovery.js`, `generate-policy.js`.

- [ ] **Step 5: Document the env vars**

Append to `.env.example`:

```bash

# Per-caller hourly limits on the endpoints that spend Claude tokens (optional).
# Callers are bucketed by verified pre-boarding analyst tenant, customer link
# dossier, or client IP. Analysts use RATE_LIMIT_ANALYST on every endpoint.
RATE_LIMIT_RESEARCH=40
RATE_LIMIT_DOC_SEARCH=40
RATE_LIMIT_SELF_SOURCE=40
RATE_LIMIT_UBO_DISCOVERY=20
RATE_LIMIT_GENERATE_POLICY=10
RATE_LIMIT_ANALYST=200

# benchmark/run.mjs only: the tenant's admin password, sent as a Bearer token.
BENCHMARK_ADMIN_TOKEN=your_tenant_admin_password_here
```

- [ ] **Step 6: Update the backlog**

In `docs/BACKLOG.md`, append to the existing **PLAT-6** entry:

```markdown
- **Status note (Part 2):** per-caller hourly rate limits shipped on research, doc-search, self-source, ubo-discovery and generate-policy (`lib/rateLimit.js`, `RATE_LIMIT_*`). A per-tenant daily spend cap is still open.
```

Add under **Open dependencies** (after DEP-3):

```markdown
### DEP-4 — Part 2 deploy notes: rate-limit storage + research cache reset
- **Category:** Deploy · **Priority:** P2 · **Status:** OPEN (manual step for the owner)
- **What:** (1) Rate-limit counters live in `lib/storage.js`; on Vercel without KV/Redis they fall back to per-instance `/tmp`, so limits are per instance, not global — provision KV/Redis (same as PREB-6). (2) The research cache key now includes tenant, ownership type and registration number, so every existing `research_cache` row stops matching; the first research per company after deploy is a live (paid) call. (3) `benchmark/run.mjs` needs `BENCHMARK_ADMIN_TOKEN` and a `?tenant=` in `--endpoint`.
- **Why:** Behaviour changes that are correct by design but surprise on first deploy.
```

- [ ] **Step 7: Commit**

```bash
git add .env.example docs/BACKLOG.md
git commit -m "docs: Part 2 rate-limit env vars and deploy notes"
```

---

## Manual QA checklist (owner)

1. `npm start`, open `/?tenant=nium`, run a real research (confirm the paid prompt) — Confirm step populates exactly as before; browser dev tools show the `/api/research` body has `mode: "research"` and no `prompt`.
2. Upload a certificate on the AI-documents journey — extraction still fills fields; the request body has `mode: "extract_document"`.
3. Set `RATE_LIMIT_RESEARCH=1` in `.env.local`, restart, run research twice — the second shows "Too many requests — please try again in N minutes".
4. `curl -X POST localhost:3000/api/research -H 'X-Tenant-Id: nium' -H 'Content-Type: application/json' -d '{"prompt":"hi"}'` → `400 client_prompt_not_allowed`.
5. Admin → edit a schema field label → Preview → run research — the prompt uses the draft (label visible in the server log if logged) and no cache row is written.
6. `curl localhost:3000/api/benchmark?tenant=nium` → `401`.
7. Policy simulator at `/policy-simulator` still generates a policy.
