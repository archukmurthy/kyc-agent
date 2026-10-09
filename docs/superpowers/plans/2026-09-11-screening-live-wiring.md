# Screening Live Wiring (SCR-2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Actually run PEP/sanctions/adverse-media screening in the live band flow - screen the Didit-verified document identity once IDV is terminal, feed a real hit into the band decision, and behind a provider abstraction that lets a second screening provider slot in without a rewrite.

**Architecture:** A `ScreeningProvider` contract (parallel to the IDV `ProviderAdapter`, NOT folded into it) with a ComplyCube adapter and a provider-neutral canonical result shape; `startScreening`/`hasScreeningHit` refactored onto that seam. Wiring point is `resolveAttempt` (resolve.js) - the exact moment IDV is terminal and the verified identity is known. Sync-now scope: a synchronous result feeds the band immediately; a pending result puts the attempt in a poll-hold (the client already polls `/resolve`) and the ComplyCube webhook re-resolves to cover the abandoned-tab case. Ongoing monitoring and category-specific policy are deferred (SCR-3/SCR-4). The persisted `categories` column keeps its existing neutral vocabulary, so there is **no DB migration**.

**Tech Stack:** Node CommonJS serverless handlers, `@complycube/api` SDK (stubbed in all tests), Neon HTTP driver, `node:test` for backend suites. React client unchanged except it already polls `/resolve`.

## Global Constraints

- Everything stays behind `IDV_DISCREPANCY_BANDS_ENABLED` (`bandsEnabled()` in `api/idv-match/config.js`). Flag OFF ⇒ `resolveAttempt` returns `{ enabled:false }` before any screening runs - the live journey is unchanged. Copy verbatim.
- **No real/paid ComplyCube calls in any automated test.** Every test injects a stubbed SDK/client via `deps`. Live sandbox proof is a manual, explicitly-approved step (see final task), never in `npm test`.
- **No DB migration.** Persist screening categories in the existing `idv_screening_checks.categories` JSONB using the current neutral keys `{ watchlist, pep, adverseMedia, other }`.
- **Data minimization holds:** never persist match PII / names / scores of watchlist entries - only outcome + boolean categories, exactly as today.
- Decisions locked (2026-09-11): (1) separate `ScreeningProvider` abstraction, kit extraction deferred to SCR-5; (2) sync-now, monitoring-later (SCR-3 deferred); (3) screen the verified document identity post-IDV; (4) uniform hard-exclusion (SCR-4 deferred).
- Follow existing patterns: pure interpret, injectable `deps = {}`, `"use strict"`, throw-on-failure in stores.

---

### Task 1: Fix the screening-hit object-truthiness bug (correctness, independent)

`resolveAttempt` passes the whole `hasScreeningHit()` object as `screeningHit` into the pipeline; `assignBand`/`resolveBandB` treat `screeningHit` as a boolean (`!!(screeningHit || escalationFlag)`). A non-null object is always truthy, so the moment screening produces any row, **every** resolve is forced to `hard_exclusion → review`. Masked today only because the flag is OFF and unit tests inject a boolean. Fix at the wiring seam: pass the boolean `.hit`.

**Files:**
- Modify: `api/idv-match/resolve.js` (the `screeningHit` variable + the `pipeline({... screeningHit ...})` call, around lines 100 and 149)
- Test: `api/idv-match/__tests__/flagsResolve.nodetest.js` (add a case)

**Interfaces:**
- Consumes: `hasScreeningHit(attemptId) -> { hit, pending, notProcessed, categories, count }` (unchanged).
- Produces: `resolveAttempt` passes a **boolean** `screeningHit` into `runBandPipeline` (later tasks rely on this being a boolean).

- [ ] **Step 1: Write the failing test**

Add to `api/idv-match/__tests__/flagsResolve.nodetest.js` (mirror the existing `deps()` helper in that file - it already stubs `attemptStore`, `matchDecisionStore`, `getDecision`, `mapDiditDecision`, `runBandPipeline`; extend it to capture the pipeline input):

```js
test("resolveAttempt passes a boolean screeningHit (not the accessor object) into the pipeline", async () => {
  process.env.IDV_DISCREPANCY_BANDS_ENABLED = "true";
  let capturedScreeningHit = "UNSET";
  const d = deps({
    hasScreeningHit: async () => ({ hit: false, pending: false, notProcessed: false, categories: {}, count: 1 }),
    runBandPipeline: async (input) => { capturedScreeningHit = input.screeningHit; return { enabled: true, band: "A", outcomeType: "auto_match" }; },
  });
  await resolveAttempt("att-1", d);
  assert.strictEqual(typeof capturedScreeningHit, "boolean");
  assert.strictEqual(capturedScreeningHit, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test api/idv-match/__tests__/flagsResolve.nodetest.js`
Expected: FAIL - `capturedScreeningHit` is an object, `typeof` is `"object"`.

- [ ] **Step 3: Write minimal implementation**

In `api/idv-match/resolve.js`, the screening read currently is:

```js
const screeningHit = await screeningHitFor(attemptId);
```

Rename it to keep the full signal available, and pass only the boolean into the pipeline. Change the read to:

```js
const screening = await screeningHitFor(attemptId);
```

Then in the `pipeline({ ... })` call, change the `screeningHit` line from `screeningHit,` to:

```js
screeningHit: screening.hit,
```

(Later tasks add pending-hold using `screening.pending`; leave the rest of the object addressable via `screening`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test api/idv-match/__tests__/flagsResolve.nodetest.js`
Expected: PASS (all cases in the file).

- [ ] **Step 5: Commit**

```bash
git add api/idv-match/resolve.js api/idv-match/__tests__/flagsResolve.nodetest.js
git commit -m "fix(idv-match): pass boolean screeningHit into band pipeline (object was always truthy → forced review)"
```

---

### Task 2: Canonical screening result model

Provider-neutral shape so the store/band logic never see provider field names. The neutral category vocabulary is the one already persisted (`watchlist/pep/adverseMedia/other`), so this normalizes TO that - no new enum, no migration.

**Files:**
- Create: `api/idv-match/screening/canonical.js`
- Test: `api/idv-match/screening/__tests__/canonical.nodetest.js`

**Interfaces:**
- Produces:
  - `OBSERVATION_KEYS = ["watchlist","pep","adverseMedia","other"]`
  - `normalizeScreening(interpreted) -> { status, outcome, hit, notProcessed, observations: {watchlist,pep,adverseMedia,other}, matchCount }` where `interpreted` is the output of `interpret.js#interpretCheck`. `observations` is always all four boolean keys (missing ⇒ false).

- [ ] **Step 1: Write the failing test**

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeScreening, OBSERVATION_KEYS } = require("../canonical");

test("normalizeScreening maps interpret output to the neutral observation vocabulary", () => {
  const out = normalizeScreening({
    status: "complete", outcome: "attention", hit: true, notProcessed: false,
    categories: { watchlist: true, pep: false, adverseMedia: true, other: false }, matchCount: 3,
  });
  assert.deepEqual(out, {
    status: "complete", outcome: "attention", hit: true, notProcessed: false,
    observations: { watchlist: true, pep: false, adverseMedia: true, other: false }, matchCount: 3,
  });
});

test("normalizeScreening defaults every observation key to false and coerces to boolean", () => {
  const out = normalizeScreening({ status: "pending", outcome: null, categories: {} });
  assert.deepEqual(OBSERVATION_KEYS, ["watchlist", "pep", "adverseMedia", "other"]);
  assert.deepEqual(out.observations, { watchlist: false, pep: false, adverseMedia: false, other: false });
  assert.equal(out.hit, false);
  assert.equal(out.notProcessed, false);
  assert.equal(out.matchCount, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test api/idv-match/screening/__tests__/canonical.nodetest.js`
Expected: FAIL - `Cannot find module '../canonical'`.

- [ ] **Step 3: Write minimal implementation**

```js
"use strict";

// Provider-neutral screening result. Adapters normalize their provider's raw
// interpretation into THIS shape so the store + band logic never see provider
// field names. The observation vocabulary is the same neutral set persisted in
// idv_screening_checks.categories, so there is no translation at the DB boundary.
const OBSERVATION_KEYS = Object.freeze(["watchlist", "pep", "adverseMedia", "other"]);

function normalizeScreening(interpreted = {}) {
  const cats = interpreted.categories || {};
  const observations = {};
  for (const k of OBSERVATION_KEYS) observations[k] = !!cats[k];
  return {
    status: interpreted.status || "unknown",
    outcome: interpreted.outcome || null,
    hit: interpreted.outcome === "attention",
    notProcessed: interpreted.outcome === "not_processed",
    observations,
    matchCount: interpreted.matchCount || 0,
  };
}

module.exports = { OBSERVATION_KEYS, normalizeScreening };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test api/idv-match/screening/__tests__/canonical.nodetest.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/idv-match/screening/canonical.js api/idv-match/screening/__tests__/canonical.nodetest.js
git commit -m "feat(idv-match): provider-neutral canonical screening result model"
```

---

### Task 3: ScreeningProvider contract

A small contract parallel to `idv/contracts/providerAdapter.js`. NOT folded into the 7-method IDV contract (screening is not a hosted verification session).

**Files:**
- Create: `api/idv-match/screening/contracts/screeningProvider.js`
- Test: `api/idv-match/screening/__tests__/screeningProvider.contract.nodetest.js`

**Interfaces:**
- Produces:
  - `REQUIRED_METHODS = ["screenPerson","handleWebhook","getCapabilities","getMonitoringStatus"]`
  - `class ScreeningProvider` with those four methods throwing `"Not implemented"`.
  - `assertScreeningProvider(adapter) -> adapter` (throws `TypeError` naming the first missing method).
- Method contracts (documented, implemented by adapters in Task 4):
  - `async screenPerson(subject, deps) -> { providerClientId, providerCheckId, result }` - `subject = { firstName, lastName, dob?, nationality? }`; `result` is a canonical result (Task 2) if the check completed synchronously, else `null` (pending, arrives via webhook).
  - `async handleWebhook({ rawBody, signature, secret }, deps) -> { statusCode, body, checkId?, result? }` - `result` canonical when the delivery is a terminal completion.
  - `getCapabilities() -> { provider, sandbox, ongoingMonitoring }`.
  - `async getMonitoringStatus(subjectRef, deps) -> { enabled }` - SCR-3 stub; returns `{ enabled:false }` today.

- [ ] **Step 1: Write the failing test**

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { ScreeningProvider, REQUIRED_METHODS, assertScreeningProvider } = require("../contracts/screeningProvider");

test("REQUIRED_METHODS lists the screening contract", () => {
  assert.deepEqual(REQUIRED_METHODS, ["screenPerson", "handleWebhook", "getCapabilities", "getMonitoringStatus"]);
});

test("base ScreeningProvider methods throw Not implemented", async () => {
  const p = new ScreeningProvider();
  await assert.rejects(() => p.screenPerson({}), /Not implemented/);
});

test("assertScreeningProvider rejects an incomplete adapter naming the missing method", () => {
  assert.throws(() => assertScreeningProvider({ screenPerson() {}, handleWebhook() {}, getCapabilities() {} }), /getMonitoringStatus/);
});

test("assertScreeningProvider accepts a complete adapter", () => {
  const ok = { screenPerson() {}, handleWebhook() {}, getCapabilities() {}, getMonitoringStatus() {} };
  assert.equal(assertScreeningProvider(ok), ok);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test api/idv-match/screening/__tests__/screeningProvider.contract.nodetest.js`
Expected: FAIL - `Cannot find module '../contracts/screeningProvider'`.

- [ ] **Step 3: Write minimal implementation**

```js
"use strict";

// Screening/AML provider contract - a sibling of the IDV ProviderAdapter, NOT an
// extension of it. Screening is "screen a person against sanctions/PEP/adverse
// media", not a hosted document+liveness session, so it gets its own small shape.
const REQUIRED_METHODS = Object.freeze(["screenPerson", "handleWebhook", "getCapabilities", "getMonitoringStatus"]);

class ScreeningProvider {
  // subject: { firstName, lastName, dob?, nationality? }
  // -> { providerClientId, providerCheckId, result|null }  (result = canonical, null if pending)
  async screenPerson() { throw new Error("Not implemented"); }
  // { rawBody, signature, secret } -> { statusCode, body, checkId?, result? }
  async handleWebhook() { throw new Error("Not implemented"); }
  // -> { provider, sandbox, ongoingMonitoring }
  getCapabilities() { throw new Error("Not implemented"); }
  // SCR-3 (deferred): ongoing monitoring. Returns { enabled:false } until built.
  async getMonitoringStatus() { throw new Error("Not implemented"); }
}

function assertScreeningProvider(adapter) {
  for (const method of REQUIRED_METHODS) {
    if (!adapter || typeof adapter[method] !== "function") {
      throw new TypeError(`Screening provider must implement ${method}()`);
    }
  }
  return adapter;
}

module.exports = { ScreeningProvider, REQUIRED_METHODS, assertScreeningProvider };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test api/idv-match/screening/__tests__/screeningProvider.contract.nodetest.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/idv-match/screening/contracts/ api/idv-match/screening/__tests__/screeningProvider.contract.nodetest.js
git commit -m "feat(idv-match): ScreeningProvider contract (sibling to IDV ProviderAdapter)"
```

---

### Task 4: ComplyCube screening adapter

Implements the contract by wrapping the existing `complyCubeClient` + `interpret` + `normalizeScreening`. This is where ComplyCube specifics stop.

**Files:**
- Create: `api/idv-match/screening/providers/complyCubeScreeningAdapter.js`
- Test: `api/idv-match/screening/__tests__/complyCubeScreeningAdapter.nodetest.js`

**Interfaces:**
- Consumes: `complyCubeClient.{createClient,createScreeningCheck,getCheck}` (Task-agnostic, existing), `interpret.interpretCheck`, `canonical.normalizeScreening`, `screening/webhook.processScreeningWebhook` (existing), `screeningConfig`.
- Produces: `class ComplyCubeScreeningAdapter extends ScreeningProvider`. `module.exports = { ComplyCubeScreeningAdapter }`.
  - `screenPerson(subject, deps) -> { providerClientId, providerCheckId, result|null }`.
  - `handleWebhook(args, deps)` delegates to existing `processScreeningWebhook` and additionally returns `{ checkId, result }` (canonical) on completion.
  - `getCapabilities() -> { provider:"complycube", sandbox: (mode==="test"), ongoingMonitoring:false }`.
  - `getMonitoringStatus() -> { enabled:false }` (SCR-3).

- [ ] **Step 1: Write the failing test**

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { ComplyCubeScreeningAdapter } = require("../providers/complyCubeScreeningAdapter");
const { assertScreeningProvider } = require("../contracts/screeningProvider");

const ccStub = {
  createClient: async () => ({ id: "cli_1" }),
  createScreeningCheck: async () => ({ id: "chk_1", status: "pending", result: {} }),
  getCheck: async () => ({ id: "chk_1", status: "complete", result: { outcome: "attention", breakdown: { summary: { pep: { pep: "attention" } }, matches: [{}] } } }),
};

test("adapter satisfies the ScreeningProvider contract", () => {
  assertScreeningProvider(new ComplyCubeScreeningAdapter());
});

test("screenPerson returns provider ids and a canonical result (null when pending)", async () => {
  const a = new ComplyCubeScreeningAdapter();
  const out = await a.screenPerson({ firstName: "A", lastName: "B" }, { complyCubeClient: ccStub });
  assert.equal(out.providerClientId, "cli_1");
  assert.equal(out.providerCheckId, "chk_1");
  // pending check (no outcome) -> result null
  assert.equal(out.result, null);
});

test("screenPerson returns canonical result when the check completes synchronously", async () => {
  const sync = { ...ccStub, createScreeningCheck: async () => ({ id: "chk_2", status: "complete", result: { outcome: "clear", breakdown: { summary: {}, matches: [] } } }) };
  const a = new ComplyCubeScreeningAdapter();
  const out = await a.screenPerson({ firstName: "A", lastName: "B" }, { complyCubeClient: sync });
  assert.equal(out.result.hit, false);
  assert.deepEqual(out.result.observations, { watchlist: false, pep: false, adverseMedia: false, other: false });
});

test("getCapabilities reports ongoingMonitoring false and getMonitoringStatus disabled", async () => {
  const a = new ComplyCubeScreeningAdapter();
  assert.equal(a.getCapabilities().ongoingMonitoring, false);
  assert.deepEqual(await a.getMonitoringStatus("ref"), { enabled: false });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test api/idv-match/screening/__tests__/complyCubeScreeningAdapter.nodetest.js`
Expected: FAIL - module not found.

- [ ] **Step 3: Write minimal implementation**

```js
"use strict";

// ComplyCube screening adapter - the one place ComplyCube specifics live. Wraps
// the existing thin SDK client + pure interpreter and returns the canonical shape.
const { ScreeningProvider } = require("../contracts/screeningProvider");
const defaultClient = require("../complyCubeClient");
const { interpretCheck } = require("../interpret");
const { normalizeScreening } = require("../canonical");
const { processScreeningWebhook } = require("../webhook");
const { screeningConfig } = require("../config");

class ComplyCubeScreeningAdapter extends ScreeningProvider {
  async screenPerson(subject, deps = {}) {
    const cc = deps.complyCubeClient || defaultClient;
    const client = await cc.createClient(subject, deps);
    const check = await cc.createScreeningCheck(client.id, deps);
    const interpreted = interpretCheck(check);
    // A freshly-created check is usually pending (no outcome yet); only surface a
    // canonical result when the provider already graded it synchronously.
    const result = interpreted.outcome ? normalizeScreening(interpreted) : null;
    return { providerClientId: client.id, providerCheckId: check.id, result };
  }

  async handleWebhook(args, deps = {}) {
    const res = await processScreeningWebhook(args, deps);
    return res; // { statusCode, body: { ..., hit } } - re-resolve is driven by the route (Task 8)
  }

  getCapabilities() {
    const cfg = screeningConfig();
    return { provider: "complycube", sandbox: cfg.mode === "test", ongoingMonitoring: false };
  }

  async getMonitoringStatus() {
    // SCR-3 (deferred): ComplyCube supports ongoing monitoring; not wired yet.
    return { enabled: false };
  }
}

module.exports = { ComplyCubeScreeningAdapter };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test api/idv-match/screening/__tests__/complyCubeScreeningAdapter.nodetest.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/idv-match/screening/providers/ api/idv-match/screening/__tests__/complyCubeScreeningAdapter.nodetest.js
git commit -m "feat(idv-match): ComplyCube screening adapter implementing the ScreeningProvider contract"
```

---

### Task 5: Screening provider registry

Thin selector - returns the configured adapter. No override-router yet (YAGNI until routing rules exist).

**Files:**
- Create: `api/idv-match/screening/registry.js`
- Test: `api/idv-match/screening/__tests__/registry.nodetest.js`

**Interfaces:**
- Consumes: `screeningConfig().provider`, `ComplyCubeScreeningAdapter`.
- Produces: `getScreeningProvider(name?, deps?) -> ScreeningProvider` (defaults to `screeningConfig().provider`; throws on unknown). `module.exports = { getScreeningProvider }`.

- [ ] **Step 1: Write the failing test**

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { getScreeningProvider } = require("../registry");
const { assertScreeningProvider } = require("../contracts/screeningProvider");

test("getScreeningProvider returns the ComplyCube adapter by name", () => {
  assertScreeningProvider(getScreeningProvider("complycube"));
});

test("getScreeningProvider throws on an unknown provider", () => {
  assert.throws(() => getScreeningProvider("nope"), /Unsupported screening provider: nope/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test api/idv-match/screening/__tests__/registry.nodetest.js`
Expected: FAIL - module not found.

- [ ] **Step 3: Write minimal implementation**

```js
"use strict";

// Screening provider registry. One entry today; a second provider (Refinitiv,
// Onfido, sanctions.io) is added here + a new adapter - nothing else changes.
const { ComplyCubeScreeningAdapter } = require("./providers/complyCubeScreeningAdapter");
const { screeningConfig } = require("./config");

const REGISTRY = { complycube: () => new ComplyCubeScreeningAdapter() };

function getScreeningProvider(name = screeningConfig().provider) {
  const key = String(name).toLowerCase();
  const make = REGISTRY[key];
  if (!make) throw new Error(`Unsupported screening provider: ${name}`);
  return make();
}

module.exports = { getScreeningProvider };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test api/idv-match/screening/__tests__/registry.nodetest.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/idv-match/screening/registry.js api/idv-match/screening/__tests__/registry.nodetest.js
git commit -m "feat(idv-match): screening provider registry (config-selected adapter)"
```

---

### Task 6: Refactor startScreening onto the provider seam

`startScreening` should drive the provider (not `complyCubeClient` directly), persist the canonical observations into the existing `categories` column, and stay signature-compatible. `hasScreeningHit` is unchanged (its return shape is a public contract Task 1 & Task 7 depend on).

**Files:**
- Modify: `api/idv-match/screening/index.js`
- Test: `api/idv-match/screening/__tests__/screeningFlow.nodetest.js` (update the two existing `startScreening` tests to the provider-injected shape)

**Interfaces:**
- Consumes: `getScreeningProvider` (Task 5), `store` (existing).
- Produces: `startScreening(attemptId, person, deps) -> { screeningId, providerCheckId }` where `deps.screeningProvider` (a `ScreeningProvider`) is injectable and defaults to `getScreeningProvider()`. `hasScreeningHit` unchanged: `-> { hit, pending, notProcessed, categories:{watchlist,pep,adverseMedia,other}, count }`.

- [ ] **Step 1: Write the failing test**

Replace the two `startScreening` tests in `screeningFlow.nodetest.js` with provider-injected versions:

```js
test("startScreening drives the provider, stores a pending row bound to the attempt", async () => {
  const calls = { created: null, updated: null };
  const provider = {
    screenPerson: async (subject) => { calls.created = subject; return { providerClientId: "cli", providerCheckId: "chk", result: null }; },
  };
  const store = {
    createScreening: async (row) => { calls.row = row; return "scr-1"; },
    updateScreeningResult: async (id, patch) => { calls.updated = { id, patch }; },
  };
  const out = await startScreening("att-1", { firstName: "John", lastName: "Doe" }, { screeningProvider: provider, store });
  assert.deepEqual(out, { screeningId: "scr-1", providerCheckId: "chk" });
  assert.equal(calls.row.complyCubeCheckId, "chk");
  assert.equal(calls.updated, null); // pending -> no result write
});

test("startScreening records a synchronously-complete canonical result", async () => {
  const provider = {
    screenPerson: async () => ({ providerClientId: "cli", providerCheckId: "chk", result: { status: "complete", outcome: "attention", hit: true, notProcessed: false, observations: { watchlist: false, pep: true, adverseMedia: false, other: false }, matchCount: 1 } }),
  };
  let written;
  const store = { createScreening: async () => "scr-2", updateScreeningResult: async (id, patch) => { written = patch; } };
  await startScreening("att-2", { firstName: "A", lastName: "B" }, { screeningProvider: provider, store });
  assert.equal(written.outcome, "attention");
  assert.deepEqual(written.categories, { watchlist: false, pep: true, adverseMedia: false, other: false });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test api/idv-match/screening/__tests__/screeningFlow.nodetest.js`
Expected: FAIL - `startScreening` still calls `complyCubeClient` directly / ignores `deps.screeningProvider`.

- [ ] **Step 3: Write minimal implementation**

Rewrite `startScreening` in `api/idv-match/screening/index.js` (leave `hasScreeningHit` exactly as-is):

```js
"use strict";

// Screening orchestration + the single signal the band logic consumes.
const store = require("./store");
const { getScreeningProvider } = require("./registry");

// Start screening for one person on an attempt via the configured provider, and
// store a pending row bound to the attempt. The result normally arrives later via
// webhook (or server reconcile); a synchronously-graded result is recorded now.
async function startScreening(attemptId, person, deps = {}) {
  if (!attemptId) throw new Error("startScreening: attemptId is required");
  const provider = deps.screeningProvider || getScreeningProvider();
  const s = deps.store || store;

  const { providerClientId, providerCheckId, result } = await provider.screenPerson(person, deps);
  const screeningId = await s.createScreening({
    attemptId,
    provider: "complycube",
    complyCubeClientId: providerClientId,
    complyCubeCheckId: providerCheckId,
  });

  if (result && result.outcome) {
    await s.updateScreeningResult(screeningId, {
      status: result.status,
      outcome: result.outcome,
      categories: result.observations,
    });
  }
  return { screeningId, providerCheckId };
}

async function hasScreeningHit(attemptId, deps = {}) {
  // ... unchanged from current implementation ...
}

module.exports = { startScreening, hasScreeningHit };
```

(Keep the current body of `hasScreeningHit` verbatim.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test api/idv-match/screening/__tests__/screeningFlow.nodetest.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/idv-match/screening/index.js api/idv-match/screening/__tests__/screeningFlow.nodetest.js
git commit -m "refactor(idv-match): startScreening drives the ScreeningProvider seam + canonical result"
```

---

### Task 7: Wire screening into resolveAttempt (screen verified identity, pending-hold)

Screen the Didit-verified document identity once, after the officer is known, and hold the band decision if the result is still pending. Screening runs only for the auto_match/comparison path (not verify_only, which is identity-proof-only).

**Files:**
- Modify: `api/idv-match/resolve.js`
- Test: `api/idv-match/__tests__/flagsResolve.nodetest.js` (extend `deps()` to stub `startScreening`; add hold + screen-once cases)

**Interfaces:**
- Consumes: `startScreening(attemptId, subject, deps)` (Task 6), `hasScreeningHit` (existing), `store.listByAttempt`-backed screening via the screening module.
- Produces: `resolveAttempt` calls `startScreening` at most once per attempt (guarded by "no screening rows yet"), builds `subject` from the verified `identity`, and returns `{ enabled:true, needsRetry:true, pending:true, reasons:["screening_pending"] }` (no decision row) when `screening.pending`.

- [ ] **Step 1: Write the failing test**

Extend the `deps()` helper in `flagsResolve.nodetest.js` to inject `startScreening` and `hasScreeningHit`, then:

```js
test("resolveAttempt screens the verified identity once, then holds while screening is pending", async () => {
  process.env.IDV_DISCREPANCY_BANDS_ENABLED = "true";
  const calls = { started: 0 };
  let rows = []; // no screening rows yet
  const d = deps({
    // terminal Didit decision with a readable identity + an auto_match officer that resolves
    startScreening: async () => { calls.started += 1; rows = [{ status: "pending", outcome: null }]; return { screeningId: "s1" }; },
    hasScreeningHit: async () => rows.length ? { hit: false, pending: true, notProcessed: false, categories: {}, count: 1 } : { hit: false, pending: false, categories: {}, count: 0 },
    listScreeningByAttempt: async () => rows,
  });
  const r = await resolveAttempt("att-1", d);
  assert.equal(calls.started, 1);
  assert.equal(r.pending, true);
  assert.deepEqual(r.reasons, ["screening_pending"]);
  assert.equal(r.band, undefined); // no decision recorded on a hold
});

test("resolveAttempt does not re-screen when a screening row already exists", async () => {
  process.env.IDV_DISCREPANCY_BANDS_ENABLED = "true";
  const calls = { started: 0 };
  const d = deps({
    startScreening: async () => { calls.started += 1; return { screeningId: "s1" }; },
    listScreeningByAttempt: async () => [{ status: "complete", outcome: "clear" }],
    hasScreeningHit: async () => ({ hit: false, pending: false, notProcessed: false, categories: {}, count: 1 }),
  });
  await resolveAttempt("att-1", d);
  assert.equal(calls.started, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test api/idv-match/__tests__/flagsResolve.nodetest.js`
Expected: FAIL - no `startScreening` call / no pending-hold branch.

- [ ] **Step 3: Write minimal implementation**

In `api/idv-match/resolve.js`:

1. Add requires near the existing screening import:

```js
const { hasScreeningHit, startScreening } = require("./screening");
const screeningStore = require("./screening/store");
```

2. In `resolveAttempt`, add injectable deps at the top (next to the others):

```js
const runScreening = deps.startScreening || startScreening;
const listScreening = deps.listScreeningByAttempt || screeningStore.listByAttempt;
```

3. Screen AFTER the auto_match officer is resolved and BEFORE the `pipeline(...)` call (i.e. after the `officerSnapshot.mode === "auto_match"` block, alongside where `screening` was read in Task 1). Replace Task 1's `const screening = await screeningHitFor(attemptId);` region with:

```js
// Screen the verified document identity once IDV is terminal and the officer is
// known (decision (3): screen the proven identity). Idempotent: only start if no
// screening row exists for this attempt. ComplyCube is async - a pending result
// holds the band decision (client keeps polling; the webhook re-resolves).
const existingScreening = await listScreening(attemptId);
if (!existingScreening.length) {
  const subject = {
    firstName: identity.first_name, lastName: identity.last_name,
    dob: identity.date_of_birth || undefined, nationality: identity.nationality || undefined,
  };
  if (subject.firstName && subject.lastName) {
    try {
      await runScreening(attemptId, subject, deps);
    } catch (err) {
      // Never block resolution on a screening-start failure; surface via reasons.
      console.error("[idv-match resolve] screening start failed:", err && err.message);
    }
  }
}
const screening = await screeningHitFor(attemptId);
if (screening.pending) {
  return { enabled: true, needsRetry: true, pending: true, reasons: ["screening_pending"], verifiedFields: toVerifiedFields(identity), vaultError: vaultError || undefined };
}
```

(The `pipeline({... screeningHit: screening.hit ...})` call from Task 1 remains unchanged.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test api/idv-match/__tests__/flagsResolve.nodetest.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/idv-match/resolve.js api/idv-match/__tests__/flagsResolve.nodetest.js
git commit -m "feat(idv-match): screen verified identity post-IDV, hold band while screening pending (SCR-2)"
```

---

### Task 8: Webhook re-resolves the band on screening completion

Cover the abandoned-tab case: when the ComplyCube result lands via webhook, store it (existing) AND re-run `resolveAttempt` so a decision is recorded even if the applicant stopped polling. `resolveAttempt`'s existing idempotency guard prevents a duplicate decision if a poll got there first.

**Files:**
- Modify: `api/idv-match/screening/webhook.js`
- Test: `api/idv-match/screening/__tests__/screeningWebhook.nodetest.js` (add a re-resolve case; if the file doesn't exist, create it with this one case)

**Interfaces:**
- Consumes: `resolveAttempt(attemptId, deps)` (lazy-required to avoid a require cycle), `store.getByCheckId` (existing, row carries `attempt_id`).
- Produces: `processScreeningWebhook` triggers a best-effort re-resolve keyed by the row's `attempt_id` after a completion is stored; injectable via `deps.resolveAttempt`.

- [ ] **Step 1: Write the failing test**

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { processScreeningWebhook } = require("../webhook");

test("a completion webhook re-resolves the band for the attempt", async () => {
  let resolved = null;
  const deps = {
    verifyEvent: () => ({ type: "check.completed", payload: { id: "chk_1" } }),
    store: {
      getByCheckId: async () => ({ id: "scr_1", attempt_id: "att_9" }),
      updateScreeningResult: async () => {},
    },
    getCheck: async () => ({ id: "chk_1", status: "complete", result: { outcome: "attention", breakdown: { summary: { pep: { pep: "attention" } }, matches: [{}] } } }),
    resolveAttempt: async (attemptId) => { resolved = attemptId; return { enabled: true, band: "A" }; },
  };
  const out = await processScreeningWebhook({ rawBody: "{}", signature: "sig", secret: "shh" }, deps);
  assert.equal(out.statusCode, 200);
  assert.equal(resolved, "att_9");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test api/idv-match/screening/__tests__/screeningWebhook.nodetest.js`
Expected: FAIL - `resolveAttempt` never called.

- [ ] **Step 3: Write minimal implementation**

In `api/idv-match/screening/webhook.js`, after the `updateScreeningResult(...)` call inside `processScreeningWebhook`, add a best-effort re-resolve:

```js
  // Re-resolve the band now the screening result is stored - covers the case where
  // the applicant left our tab and is no longer polling /resolve. resolveAttempt is
  // idempotent (a decision already recorded is returned as-is), so a concurrent poll
  // can't double-record. Best-effort: a re-resolve failure never fails the webhook.
  const reResolve = deps.resolveAttempt || require("../resolve").resolveAttempt;
  if (row.attempt_id) {
    try { await reResolve(row.attempt_id); }
    catch (err) { console.error("[idv-match screening webhook] re-resolve failed:", err && err.message); }
  }
```

(The lazy `require("../resolve")` avoids a load-time cycle: resolve.js → screening → webhook → resolve.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test api/idv-match/screening/__tests__/screeningWebhook.nodetest.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/idv-match/screening/webhook.js api/idv-match/screening/__tests__/screeningWebhook.nodetest.js
git commit -m "feat(idv-match): screening webhook re-resolves band on completion (abandoned-tab path)"
```

---

### Task 9: Full backend suite + docs/tracker update

**Files:**
- Modify: `docs/idv-discrepancy-bands/BUILD-TRACKER.md` (tick SCR-2)
- Modify: `docs/BACKLOG.md` (mark SCR-2 wiring done; SCR-1/SCR-3/SCR-4/SCR-5 remain OPEN - the live-webhook-secret + monitoring + category-policy + kit-extraction are still deferred)

**Interfaces:** none (documentation + verification).

- [ ] **Step 1: Run the full backend screening + resolve suites**

Run:
```bash
node --test api/idv-match/screening/__tests__/ api/idv-match/__tests__/flagsResolve.nodetest.js
```
Expected: all PASS (no real network calls - every provider/store is stubbed).

- [ ] **Step 2: Run the CRA client suite for the IDV match component**

Run: `npx react-scripts test --watchAll=false src/idv-match`
Expected: PASS - the client already polls `/resolve`; a `pending: true` hold response keeps it polling (verify the poll loop treats `pending`/`needsRetry` as "keep waiting", same as `verification_in_progress`).

- [ ] **Step 3: Update BUILD-TRACKER**

In `docs/idv-discrepancy-bands/BUILD-TRACKER.md`, under the screening/Phase-5 section, add:
```
- [x] SCR-2 live wiring - startScreening called in resolveAttempt (verified identity, post-IDV); pending-hold + webhook re-resolve; object-truthiness bug fixed; ScreeningProvider abstraction + ComplyCube adapter + registry + canonical model. Kit extraction deferred (SCR-5), monitoring deferred (SCR-3), category policy deferred (SCR-4), live webhook secret deferred (SCR-1). Flag still OFF.
```

- [ ] **Step 4: Update BACKLOG**

In `docs/BACKLOG.md`, change SCR-2 `Status:` to `WIRED (flag-gated OFF; live sandbox proof pending approval)` and add a one-line note that SCR-1/3/4/5 remain the open follow-ups.

- [ ] **Step 5: Commit**

```bash
git add docs/idv-discrepancy-bands/BUILD-TRACKER.md docs/BACKLOG.md
git commit -m "docs(idv-match): SCR-2 screening live-wiring done; SCR-1/3/4/5 remain deferred"
```

---

### Task 10: Manual live-sandbox proof (GATED - requires explicit approval)

**Not part of `npm test`.** A single real ComplyCube **sandbox** (test-key, free) round-trip to confirm the provider seam works end-to-end against the live API shape. **Do not run without the user's explicit go-ahead** (per the no-paid-API-without-asking standard; sandbox is free but any real external call is gated).

- [ ] **Step 1: Confirm approval + test-key env**

Verify `.env.local` has `COMPLYCUBE_API_KEY=test_...`, `SCREENING_RUNTIME_MODE=test`, `IDV_DATABASE_URL` set, and `IDV_DISCREPANCY_BANDS_ENABLED=true` for the local run only. Ask the user before proceeding.

- [ ] **Step 2: Drive one screening via the provider**

Run a one-off node script (in scratchpad) that calls `getScreeningProvider().screenPerson({ firstName:"...", lastName:"..." })` against the sandbox, then `getCheck` the returned id, and prints the canonical `normalizeScreening` output. Confirm a known sandbox "attention" fixture name produces `hit:true` with the expected observation.

- [ ] **Step 3: Record the result in the tracker**

Note the sandbox proof (hit detected via the provider seam) in BUILD-TRACKER; do NOT commit any real response body. Leave the flag OFF afterward.

---

## Self-Review

**Spec coverage:**
- Decision (1) separate abstraction ⇒ Tasks 3-5 (contract, adapter, registry), kit deferred ⇒ SCR-5 backlog. ✓
- Decision (2) sync-now, monitoring-later ⇒ Task 7 (sync + pending-hold), Task 8 (webhook re-resolve); monitoring stub in Tasks 3-4 (`getMonitoringStatus → {enabled:false}`, `ongoingMonitoring:false`), SCR-3 backlog. ✓
- Decision (3) screen verified identity post-IDV ⇒ Task 7 (subject from `identity`, after terminal + officer match, verify_only excluded). ✓
- Decision (4) uniform hard-exclusion ⇒ unchanged `bandAssignment`/`resolveBandB` boolean semantics; SCR-4 backlog. ✓
- Must-fix bug ⇒ Task 1. ✓
- No-migration / data-min / flag-gated / no-paid-API ⇒ Global Constraints + Task 10 gating. ✓

**Placeholder scan:** every code step shows full code; no TODO/TBD; `hasScreeningHit` body explicitly "keep verbatim" (not a placeholder - it is unchanged existing code).

**Type consistency:** `startScreening` returns `{ screeningId, providerCheckId }` (Task 6) - used only internally by resolve (Task 7 ignores the return). `screenPerson -> { providerClientId, providerCheckId, result }` consistent across Tasks 3/4/6. `normalizeScreening` output shape consistent across Tasks 2/4/6. `screening.hit`/`screening.pending` from the unchanged `hasScreeningHit` shape used in Tasks 1/7. ✓

## Open risk noted for the executor
- **Poll/webhook re-resolve race:** a client poll and the webhook can both enter `resolveAttempt` near-simultaneously; the idempotency guard (`decisions.listByAttempt` early-return) closes most of the window but not all. Acceptable for sync-now; if duplicate decision rows ever appear, add a unique partial index on `(attempt_id)` for terminal decisions. `ponytail:` documented ceiling, upgrade path is the unique index.
- **`identity.date_of_birth` format** must match ComplyCube's expected `dob` (`YYYY-MM-DD`); Task 10 confirms against the sandbox. If Didit returns another format, normalize in the adapter's `screenPerson` before `createClient`.

---

## Post-final-review amendments (2026-09-11)
Superseding notes after the whole-branch review (all applied, verified merge-ready):
- **ScreeningProvider contract is 3 methods, not 4** - `handleWebhook` was trimmed (it was dead: the `screening/webhook.js` route owns webhook handling + re-resolve directly). Provider-neutral webhook handling is deferred to SCR-5 with the shared kit. Ignore the 4-method `handleWebhook` references in Tasks 3/4 above.
- **Fail-CLOSED on screening-start failure** - beyond the read-path holds, a start failure that leaves no row (`screeningStartAttempted && count===0`) also holds with `screening_unavailable`; a screening outage never silently onboards an unscreened applicant.
- **verify_only path is screened too** - the screening gate was extracted to `screeningGate()` and applied to both the auto_match and verify_only paths; a verify_only screening hit → review (never auto-success); an unverified verify_only is not screened.
- **Band C no-officer-match** identities remain unscreened (already escalate to manual review) - tracked as SCR-6, a compliance-signed flag-on prerequisite.
