# Didit IDV Spike - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire a Didit identity-verification step into the KYC wizard that starts a sandbox session, lets the user verify on any device via QR, pulls the result, maps it to applicant fields, and stores the extras locally.

**Architecture:** A thin, self-contained `lib/didit/` connector (create session + poll decision) - NOT the `idv/` module's internals. Two additive serverless routes (`api/idv-start`, `api/idv-result`), one new wizard step component, and minimal additive edits to `App.js` + `setupProxy.js`. Persistence is a local JSON file for the spike.

**Tech Stack:** Node 24 (global `fetch`), CommonJS for `lib/`+`api/` (matches repo), React 18 (CRA) for the component, `qrcode` for the QR image, `node:test` + `node:assert` for tests (matches repo).

## Global Constraints

- **Sandbox / synthetic only.** Env is `IDV_RUNTIME_MODE=test`, `IDV_SYNTHETIC_ONLY=1`, `DIDIT_ENVIRONMENT=sandbox`. **No real PII may flow through the spike.**
- **`DIDIT_API_KEY` is server-side only** - never imported into `src/` or sent to the browser.
- **No new runtime dependency beyond `qrcode`.** Do not import anything from `idv/` (respect its `index.js`-only boundary).
- **Didit base URL:** `https://verification.didit.me`. Create: `POST /v3/session/`. Retrieve: `GET /v3/session/{session_id}/decision/`. Auth header: `x-api-key`.
- **Correlation:** our `ref` (the wizard's `submissionId`) is sent as Didit `vendor_data`.
- **Commits:** plain message, no assistant-identity trailers. Work stays on `dev/local-work` in `E:\kyc-agent-dev`; never touch `main`.
- **Existing field ids** for mapping (do not rename): `applicantFirstName`, `applicantLastName`, `applicantDateOfBirth`, `applicantNationality`.
- **Applicant prefill contract:** `applicantAgentValues` is `{ fieldId: value }`, set via `setApplicantAgentValues`.

---

## File Structure

- Create `lib/didit/mapDecision.js` - pure Didit-decision → `{ status, verified, mappedFields, extras }`.
- Create `lib/didit/diditClient.js` - `createSession()` / `getDecision()` against Didit v3.
- Create `lib/didit/store.js` - local JSON file store (`.didit-store.json`).
- Create `api/idv-start.js` - POST route: create session + persist link.
- Create `api/idv-result.js` - POST route: poll decision + map + persist.
- Create `src/components/idv/IdentityVerificationStep.jsx` - the wizard step UI (QR + poll + display).
- Create tests: `lib/didit/__tests__/mapDecision.nodetest.js`, `diditClient.nodetest.js`, `store.nodetest.js`, `api/__tests__/idv-start.nodetest.js`, `api/__tests__/idv-result.nodetest.js`.
- Modify `src/setupProxy.js` - mount the two routes for local dev.
- Modify `src/App.js` - add the step to `stepsFor`/`stepNames`, render the step, add a dev-only shortcut.

---

### Task 1: `mapDecision` - pure decision mapper

**Files:**
- Create: `lib/didit/mapDecision.js`
- Test: `lib/didit/__tests__/mapDecision.nodetest.js`

**Interfaces:**
- Produces: `mapDecision(payload) -> { status: string, verified: boolean, mappedFields: { [fieldId]: string }, extras: object }`. `mappedFields` uses the four existing applicant field ids. `verified` is `true` when status is `Approved`/`APPROVED`.

- [ ] **Step 1: Write the failing test**

```js
// lib/didit/__tests__/mapDecision.nodetest.js
const { test } = require("node:test");
const assert = require("node:assert");
const { mapDecision } = require("../mapDecision");

const SAMPLE = {
  status: "Approved",
  decision: {
    status: "Approved",
    id_verifications: [{
      first_name: "ADA", last_name: "LOVELACE",
      date_of_birth: "1815-12-10", nationality: "GB",
      document_type: "PASSPORT", document_number: "X1234567",
      expiration_date: "2030-01-01", issuing_state: "GBR",
      parsed_address: { full: "12 Analytical Ave, London" },
    }],
    liveness_checks: [{ status: "PASSED", score: 0.98 }],
    face_matches: [{ status: "PASSED", score: 0.95 }],
  },
};

test("maps identity fields and captures extras", () => {
  const out = mapDecision(SAMPLE);
  assert.strictEqual(out.status, "Approved");
  assert.strictEqual(out.verified, true);
  assert.deepStrictEqual(out.mappedFields, {
    applicantFirstName: "ADA",
    applicantLastName: "LOVELACE",
    applicantDateOfBirth: "1815-12-10",
    applicantNationality: "GB",
  });
  assert.strictEqual(out.extras.documentNumber, "X1234567");
  assert.strictEqual(out.extras.documentType, "PASSPORT");
  assert.strictEqual(out.extras.expirationDate, "2030-01-01");
  assert.strictEqual(out.extras.livenessStatus, "PASSED");
  assert.strictEqual(out.extras.faceMatchStatus, "PASSED");
});

test("handles a not-yet-complete decision without throwing", () => {
  const out = mapDecision({ status: "In Progress" });
  assert.strictEqual(out.status, "In Progress");
  assert.strictEqual(out.verified, false);
  assert.deepStrictEqual(out.mappedFields, {});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test lib/didit/__tests__/mapDecision.nodetest.js`
Expected: FAIL - `Cannot find module '../mapDecision'`.

- [ ] **Step 3: Write minimal implementation**

```js
// lib/didit/mapDecision.js
"use strict";

function firstOf(arr) {
  return Array.isArray(arr) && arr.length ? arr[0] : {};
}

function mapDecision(payload) {
  const d = (payload && payload.decision) || payload || {};
  const status = d.status || (payload && payload.status) || "Unknown";
  const verified = String(status).toUpperCase() === "APPROVED";

  const idv = firstOf(d.id_verifications || d.id_verification);
  const mappedFields = {};
  if (idv.first_name) mappedFields.applicantFirstName = idv.first_name;
  if (idv.last_name) mappedFields.applicantLastName = idv.last_name;
  if (idv.date_of_birth) mappedFields.applicantDateOfBirth = idv.date_of_birth;
  if (idv.nationality) mappedFields.applicantNationality = idv.nationality;

  const liveness = firstOf(d.liveness_checks || d.liveness);
  const faceMatch = firstOf(d.face_matches || d.face_match);

  const extras = {
    documentType: idv.document_type || null,
    documentNumber: idv.document_number || null,
    expirationDate: idv.expiration_date || idv.expiry_date || null,
    dateOfIssue: idv.date_of_issue || null,
    issuingState: idv.issuing_state || idv.issuing_country || null,
    gender: idv.gender || null,
    placeOfBirth: idv.place_of_birth || null,
    address:
      (idv.parsed_address && (idv.parsed_address.full || idv.parsed_address)) ||
      idv.formatted_address || idv.address || null,
    mrz: idv.mrz || null,
    livenessStatus: liveness.status || null,
    faceMatchStatus: faceMatch.status || null,
    diditStatus: status,
  };

  return { status, verified, mappedFields, extras };
}

module.exports = { mapDecision };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test lib/didit/__tests__/mapDecision.nodetest.js`
Expected: PASS - `tests 2 / pass 2 / fail 0`.

- [ ] **Step 5: Commit**

```bash
git add lib/didit/mapDecision.js lib/didit/__tests__/mapDecision.nodetest.js
git commit -m "feat(idv): pure Didit decision mapper"
```

---

### Task 2: `diditClient` - session create + decision fetch

**Files:**
- Create: `lib/didit/diditClient.js`
- Test: `lib/didit/__tests__/diditClient.nodetest.js`

**Interfaces:**
- Produces:
  - `createSession({ vendorData, callbackUrl }) -> Promise<{ providerSessionId, hostedUrl, status }>`
  - `getDecision(providerSessionId) -> Promise<object>` (raw Didit decision JSON)
- Consumes: env `DIDIT_BASE_URL` (default `https://verification.didit.me`), `DIDIT_API_KEY`, `DIDIT_WORKFLOW_ID`, `DIDIT_ENVIRONMENT`, `IDV_SYNTHETIC_ONLY`.

- [ ] **Step 1: Write the failing test**

```js
// lib/didit/__tests__/diditClient.nodetest.js
const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");

let client;
const realFetch = global.fetch;

beforeEach(() => {
  process.env.DIDIT_API_KEY = "test-key";
  process.env.DIDIT_WORKFLOW_ID = "wf-1";
  process.env.DIDIT_ENVIRONMENT = "sandbox";
  process.env.IDV_SYNTHETIC_ONLY = "1";
  delete require.cache[require.resolve("../diditClient")];
  client = require("../diditClient");
});
afterEach(() => { global.fetch = realFetch; });

test("createSession posts to /v3/session/ with x-api-key and returns id+url", async () => {
  let seen;
  global.fetch = async (url, opts) => {
    seen = { url, opts };
    return { ok: true, status: 201, json: async () => ({ session_id: "sess-1", url: "https://verification.didit.me/s/abc", status: "Not Started" }) };
  };
  const out = await client.createSession({ vendorData: "ref-1", callbackUrl: "https://cb" });
  assert.strictEqual(out.providerSessionId, "sess-1");
  assert.strictEqual(out.hostedUrl, "https://verification.didit.me/s/abc");
  assert.match(seen.url, /\/v3\/session\/$/);
  assert.strictEqual(seen.opts.headers["x-api-key"], "test-key");
  const body = JSON.parse(seen.opts.body);
  assert.strictEqual(body.vendor_data, "ref-1");
  assert.strictEqual(body.workflow_id, "wf-1");
});

test("getDecision GETs the decision endpoint by session id", async () => {
  let seenUrl;
  global.fetch = async (url, opts) => {
    seenUrl = url;
    assert.strictEqual(opts.method, "GET");
    return { ok: true, status: 200, json: async () => ({ status: "Approved" }) };
  };
  const out = await client.getDecision("sess-1");
  assert.match(seenUrl, /\/v3\/session\/sess-1\/decision\/$/);
  assert.strictEqual(out.status, "Approved");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test lib/didit/__tests__/diditClient.nodetest.js`
Expected: FAIL - `Cannot find module '../diditClient'`.

- [ ] **Step 3: Write minimal implementation**

```js
// lib/didit/diditClient.js
"use strict";

const BASE = process.env.DIDIT_BASE_URL || "https://verification.didit.me";

function apiKey() {
  const k = process.env.DIDIT_API_KEY;
  if (!k) throw new Error("DIDIT_API_KEY is not set");
  return k;
}

async function createSession({ vendorData, callbackUrl } = {}) {
  const body = {
    workflow_id: process.env.DIDIT_WORKFLOW_ID,
    vendor_data: vendorData,
    callback_method: "both",
    metadata: { ref: vendorData },
  };
  if (callbackUrl) body.callback = callbackUrl;
  const synthetic =
    process.env.IDV_SYNTHETIC_ONLY === "1" ||
    (process.env.DIDIT_ENVIRONMENT || "").toLowerCase() === "sandbox";
  if (synthetic) body.sandbox_scenario = "approved";

  const res = await fetch(`${BASE}/v3/session/`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey() },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Didit create-session failed: ${res.status}`);
  const data = await res.json();
  if (!data.session_id || !data.url) {
    throw new Error("Didit create-session response missing session_id or url");
  }
  return { providerSessionId: data.session_id, hostedUrl: data.url, status: data.status };
}

async function getDecision(providerSessionId) {
  const res = await fetch(
    `${BASE}/v3/session/${encodeURIComponent(providerSessionId)}/decision/`,
    { method: "GET", headers: { "x-api-key": apiKey() } }
  );
  if (!res.ok) throw new Error(`Didit get-decision failed: ${res.status}`);
  return res.json();
}

module.exports = { createSession, getDecision };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test lib/didit/__tests__/diditClient.nodetest.js`
Expected: PASS - `tests 2 / pass 2 / fail 0`.

- [ ] **Step 5: Commit**

```bash
git add lib/didit/diditClient.js lib/didit/__tests__/diditClient.nodetest.js
git commit -m "feat(idv): Didit v3 session client"
```

---

### Task 3: `store` - local JSON persistence

**Files:**
- Create: `lib/didit/store.js`
- Test: `lib/didit/__tests__/store.nodetest.js`

**Interfaces:**
- Produces:
  - `saveSession(ref, { providerSessionId }) -> void`
  - `getSession(ref) -> { providerSessionId, ... } | null`
  - `saveResult(ref, { status, verified, mappedFields, extras }) -> void`
  - `getResult(ref) -> object | null`
- Store file path: `process.env.DIDIT_STORE_PATH` if set, else `<cwd>/.didit-store.json`. (Tests set `DIDIT_STORE_PATH` to a temp file.)

- [ ] **Step 1: Write the failing test**

```js
// lib/didit/__tests__/store.nodetest.js
const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

let store, tmp;
beforeEach(() => {
  tmp = path.join(os.tmpdir(), `didit-store-test-${process.pid}-${Math.floor(process.hrtime()[1])}.json`);
  process.env.DIDIT_STORE_PATH = tmp;
  delete require.cache[require.resolve("../store")];
  store = require("../store");
});
afterEach(() => { try { fs.unlinkSync(tmp); } catch (_) {} });

test("saves and reads a session link", () => {
  assert.strictEqual(store.getSession("ref-1"), null);
  store.saveSession("ref-1", { providerSessionId: "sess-1" });
  assert.strictEqual(store.getSession("ref-1").providerSessionId, "sess-1");
});

test("merges a result onto an existing ref", () => {
  store.saveSession("ref-1", { providerSessionId: "sess-1" });
  store.saveResult("ref-1", { status: "Approved", verified: true, mappedFields: { applicantFirstName: "ADA" }, extras: { documentNumber: "X1" } });
  const r = store.getResult("ref-1");
  assert.strictEqual(r.verified, true);
  assert.strictEqual(r.mappedFields.applicantFirstName, "ADA");
  assert.strictEqual(store.getSession("ref-1").providerSessionId, "sess-1");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test lib/didit/__tests__/store.nodetest.js`
Expected: FAIL - `Cannot find module '../store'`.

- [ ] **Step 3: Write minimal implementation**

```js
// lib/didit/store.js
"use strict";
const fs = require("node:fs");
const path = require("node:path");

function storePath() {
  return process.env.DIDIT_STORE_PATH || path.join(process.cwd(), ".didit-store.json");
}
function readAll() {
  try { return JSON.parse(fs.readFileSync(storePath(), "utf8")); }
  catch (_) { return {}; }
}
function writeAll(obj) {
  fs.writeFileSync(storePath(), JSON.stringify(obj, null, 2));
}
function merge(ref, patch) {
  const all = readAll();
  all[ref] = { ...(all[ref] || {}), ...patch, updatedAt: new Date().toISOString() };
  writeAll(all);
}
function saveSession(ref, { providerSessionId }) { merge(ref, { providerSessionId }); }
function getSession(ref) { return readAll()[ref] || null; }
function saveResult(ref, { status, verified, mappedFields, extras }) {
  merge(ref, { status, verified, mappedFields, extras });
}
function getResult(ref) { return readAll()[ref] || null; }

module.exports = { saveSession, getSession, saveResult, getResult };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test lib/didit/__tests__/store.nodetest.js`
Expected: PASS - `tests 2 / pass 2 / fail 0`.

- [ ] **Step 5: Commit**

```bash
git add lib/didit/store.js lib/didit/__tests__/store.nodetest.js
git commit -m "feat(idv): local JSON store for spike"
```

---

### Task 4: `api/idv-start` route

**Files:**
- Create: `api/idv-start.js`
- Test: `api/__tests__/idv-start.nodetest.js`

**Interfaces:**
- Consumes: `diditClient.createSession`, `store.saveSession`.
- Produces: `POST /api/idv-start` with body `{ ref }` → `200 { hostedUrl, providerSessionId }`; `400` if `ref` missing; `502` on Didit error.

- [ ] **Step 1: Write the failing test**

```js
// api/__tests__/idv-start.nodetest.js
const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");

const realFetch = global.fetch;
let handler, tmp;

function mockRes() {
  return { statusCode: 200, body: null,
    setHeader() {},
    status(c) { this.statusCode = c; return this; },
    json(d) { this.body = d; return this; } };
}

beforeEach(() => {
  tmp = path.join(os.tmpdir(), `didit-start-${process.pid}-${Math.floor(process.hrtime()[1])}.json`);
  process.env.DIDIT_STORE_PATH = tmp;
  process.env.DIDIT_API_KEY = "k"; process.env.DIDIT_WORKFLOW_ID = "wf";
  ["../idv-start", "../../lib/didit/diditClient", "../../lib/didit/store"]
    .forEach((m) => delete require.cache[require.resolve(m)]);
  handler = require("../idv-start");
});
afterEach(() => { global.fetch = realFetch; try { fs.unlinkSync(tmp); } catch (_) {} });

test("400 when ref missing", async () => {
  const res = mockRes();
  await handler({ method: "POST", body: {} }, res);
  assert.strictEqual(res.statusCode, 400);
});

test("creates session, stores link, returns hostedUrl", async () => {
  global.fetch = async () => ({ ok: true, status: 201,
    json: async () => ({ session_id: "sess-9", url: "https://verification.didit.me/s/z", status: "Not Started" }) });
  const res = mockRes();
  await handler({ method: "POST", body: { ref: "ref-9" } }, res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.providerSessionId, "sess-9");
  const store = require("../../lib/didit/store");
  assert.strictEqual(store.getSession("ref-9").providerSessionId, "sess-9");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test api/__tests__/idv-start.nodetest.js`
Expected: FAIL - `Cannot find module '../idv-start'`.

- [ ] **Step 3: Write minimal implementation**

```js
// api/idv-start.js
"use strict";
const { createSession } = require("../lib/didit/diditClient");
const store = require("../lib/didit/store");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });
  const ref = req.body && req.body.ref;
  if (!ref) return res.status(400).json({ error: "ref_required" });
  try {
    const session = await createSession({
      vendorData: ref,
      callbackUrl: process.env.DIDIT_CALLBACK_URL,
    });
    store.saveSession(ref, { providerSessionId: session.providerSessionId });
    return res.status(200).json({
      hostedUrl: session.hostedUrl,
      providerSessionId: session.providerSessionId,
    });
  } catch (err) {
    return res.status(502).json({ error: "didit_start_failed", detail: String(err.message || err) });
  }
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test api/__tests__/idv-start.nodetest.js`
Expected: PASS - `tests 2 / pass 2 / fail 0`.

- [ ] **Step 5: Commit**

```bash
git add api/idv-start.js api/__tests__/idv-start.nodetest.js
git commit -m "feat(idv): api/idv-start route"
```

---

### Task 5: `api/idv-result` route

**Files:**
- Create: `api/idv-result.js`
- Test: `api/__tests__/idv-result.nodetest.js`

**Interfaces:**
- Consumes: `store.getSession`, `diditClient.getDecision`, `mapDecision`, `store.saveResult`.
- Produces: `POST /api/idv-result` with body `{ ref }` → `200 { status, verified, mappedFields, extras }`; `404` if no session for ref; `502` on Didit error.

- [ ] **Step 1: Write the failing test**

```js
// api/__tests__/idv-result.nodetest.js
const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");

const realFetch = global.fetch;
let handler, store, tmp;

function mockRes() {
  return { statusCode: 200, body: null,
    setHeader() {},
    status(c) { this.statusCode = c; return this; },
    json(d) { this.body = d; return this; } };
}

beforeEach(() => {
  tmp = path.join(os.tmpdir(), `didit-result-${process.pid}-${Math.floor(process.hrtime()[1])}.json`);
  process.env.DIDIT_STORE_PATH = tmp;
  process.env.DIDIT_API_KEY = "k";
  ["../idv-result", "../../lib/didit/diditClient", "../../lib/didit/store", "../../lib/didit/mapDecision"]
    .forEach((m) => delete require.cache[require.resolve(m)]);
  handler = require("../idv-result");
  store = require("../../lib/didit/store");
});
afterEach(() => { global.fetch = realFetch; try { fs.unlinkSync(tmp); } catch (_) {} });

test("404 when ref has no session", async () => {
  const res = mockRes();
  await handler({ method: "POST", body: { ref: "nope" } }, res);
  assert.strictEqual(res.statusCode, 404);
});

test("pulls decision, maps, stores, returns mappedFields", async () => {
  store.saveSession("ref-5", { providerSessionId: "sess-5" });
  global.fetch = async () => ({ ok: true, status: 200, json: async () => ({
    status: "Approved",
    decision: { status: "Approved", id_verifications: [{ first_name: "ADA", last_name: "LOVELACE", document_number: "X1" }] },
  }) });
  const res = mockRes();
  await handler({ method: "POST", body: { ref: "ref-5" } }, res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.verified, true);
  assert.strictEqual(res.body.mappedFields.applicantFirstName, "ADA");
  assert.strictEqual(res.body.extras.documentNumber, "X1");
  assert.strictEqual(store.getResult("ref-5").mappedFields.applicantLastName, "LOVELACE");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test api/__tests__/idv-result.nodetest.js`
Expected: FAIL - `Cannot find module '../idv-result'`.

- [ ] **Step 3: Write minimal implementation**

```js
// api/idv-result.js
"use strict";
const { getDecision } = require("../lib/didit/diditClient");
const { mapDecision } = require("../lib/didit/mapDecision");
const store = require("../lib/didit/store");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });
  const ref = req.body && req.body.ref;
  if (!ref) return res.status(400).json({ error: "ref_required" });
  const session = store.getSession(ref);
  if (!session || !session.providerSessionId) {
    return res.status(404).json({ error: "session_not_found" });
  }
  try {
    const decision = await getDecision(session.providerSessionId);
    const mapped = mapDecision(decision);
    store.saveResult(ref, mapped);
    return res.status(200).json(mapped);
  } catch (err) {
    return res.status(502).json({ error: "didit_result_failed", detail: String(err.message || err) });
  }
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test api/__tests__/idv-result.nodetest.js`
Expected: PASS - `tests 2 / pass 2 / fail 0`.

- [ ] **Step 5: Commit**

```bash
git add api/idv-result.js api/__tests__/idv-result.nodetest.js
git commit -m "feat(idv): api/idv-result route"
```

---

### Task 6: Mount routes in the dev proxy

**Files:**
- Modify: `src/setupProxy.js` (add two `require`s near line 27, two `app.post` blocks near line 319)

**Interfaces:**
- Consumes: `api/idv-start.js`, `api/idv-result.js`, the existing `adapt()` helper.

- [ ] **Step 1: Add the handler requires**

After line 27 (`const saveDossierHandler = require(path.join(__dirname, "..", "api", "save-dossier.js"));`), add:

```js
const idvStartHandler = require(path.join(__dirname, "..", "api", "idv-start.js"));
const idvResultHandler = require(path.join(__dirname, "..", "api", "idv-result.js"));
```

- [ ] **Step 2: Add the route mounts**

After the `/api/save-dossier` block (ends around line 319), add:

```js
  // Didit IDV spike - start a session / poll its result. POST; parse JSON body.
  app.post("/api/idv-start", (req, res) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      try { req.body = raw ? JSON.parse(raw) : {}; } catch (_) { req.body = {}; }
      adapt(idvStartHandler)(req, res);
    });
  });
  app.post("/api/idv-result", (req, res) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      try { req.body = raw ? JSON.parse(raw) : {}; } catch (_) { req.body = {}; }
      adapt(idvResultHandler)(req, res);
    });
  });
```

- [ ] **Step 3: Verify the dev server boots**

Run (restart the dev server): `CI=true` not needed; in the worktree run `npm start`, wait for `webpack compiled successfully`.
Expected: no errors mentioning `idv-start`/`idv-result`.

- [ ] **Step 4: Smoke-check the route wiring**

With the dev server running, in another shell:
Run: `curl -s -X POST http://localhost:3000/api/idv-result -H "content-type: application/json" -d '{}'`
Expected: JSON `{"error":"ref_required"}` (proves the route is mounted and parsing the body).

- [ ] **Step 5: Commit**

```bash
git add src/setupProxy.js
git commit -m "feat(idv): mount idv routes in dev proxy"
```

---

### Task 7: `IdentityVerificationStep` component + QR

**Files:**
- Create: `src/components/idv/IdentityVerificationStep.jsx`
- Test: `src/components/idv/__tests__/IdentityVerificationStep.test.jsx`
- Modify: `package.json` (add `qrcode` dependency)

**Interfaces:**
- Props: `{ submissionId, onVerified(mappedFields), onContinue(), cardStyle, Btn }`.
- Consumes: `POST /api/idv-start`, `POST /api/idv-result`, `qrcode`.

- [ ] **Step 1: Add the QR dependency**

Run (in the worktree): `npm install qrcode@^1.5.4`
Expected: `added N packages`. Confirm `package.json` now lists `"qrcode"` under dependencies.

- [ ] **Step 2: Write the failing test**

```jsx
// src/components/idv/__tests__/IdentityVerificationStep.test.jsx
import React from "react";
import { act } from "react-dom/test-utils";
import { createRoot } from "react-dom/client";
import IdentityVerificationStep from "../IdentityVerificationStep";

test("renders a Start button and calls /api/idv-start on click", async () => {
  const calls = [];
  global.fetch = jest.fn(async (url) => {
    calls.push(url);
    return { ok: true, json: async () => ({ hostedUrl: "https://verification.didit.me/s/x", providerSessionId: "s1" }) };
  });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <IdentityVerificationStep submissionId="ref-1" onVerified={() => {}} onContinue={() => {}} cardStyle={{}} Btn={(p) => <button {...p} />} />
    );
  });
  const startBtn = [...container.querySelectorAll("button")].find((b) => /start/i.test(b.textContent));
  expect(startBtn).toBeTruthy();
  await act(async () => { startBtn.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  expect(calls.some((u) => String(u).includes("/api/idv-start"))).toBe(true);
  await act(async () => { root.unmount(); });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `CI=true npx react-scripts test --watchAll=false src/components/idv`
Expected: FAIL - cannot find `../IdentityVerificationStep`.

- [ ] **Step 4: Write the component**

```jsx
// src/components/idv/IdentityVerificationStep.jsx
import React, { useState } from "react";
import QRCode from "qrcode";

const genRef = () =>
  (typeof crypto !== "undefined" && crypto.randomUUID)
    ? `dev-${crypto.randomUUID()}`
    : `dev-${Date.now()}`;

export default function IdentityVerificationStep({ submissionId, onVerified, onContinue, cardStyle, Btn }) {
  const [ref] = useState(submissionId || genRef());
  const [hostedUrl, setHostedUrl] = useState(null);
  const [qr, setQr] = useState(null);
  const [status, setStatus] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const start = async () => {
    setBusy(true); setError(null);
    try {
      const r = await fetch("/api/idv-start", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ref }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail || data.error || "start failed");
      setHostedUrl(data.hostedUrl);
      setQr(await QRCode.toDataURL(data.hostedUrl));
      setStatus("Not Started");
    } catch (e) { setError(String(e.message || e)); }
    finally { setBusy(false); }
  };

  const check = async () => {
    setBusy(true); setError(null);
    try {
      const r = await fetch("/api/idv-result", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ref }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail || data.error || "result failed");
      setStatus(data.status); setResult(data);
      if (data.verified && data.mappedFields) onVerified(data.mappedFields);
    } catch (e) { setError(String(e.message || e)); }
    finally { setBusy(false); }
  };

  return (
    <div style={cardStyle}>
      <h2>Identity Verification</h2>
      <p style={{ color: "#666" }}>Verify the applicant's identity with Didit (sandbox - synthetic data only).</p>

      {!hostedUrl && <Btn onClick={start} disabled={busy}>{busy ? "Starting…" : "Start verification"}</Btn>}

      {hostedUrl && (
        <div style={{ marginTop: 16 }}>
          <p>Scan this QR on another device, or open the link:</p>
          {qr && <img src={qr} alt="Didit verification QR" style={{ width: 200, height: 200 }} />}
          <p><a href={hostedUrl} target="_blank" rel="noreferrer">{hostedUrl}</a></p>
          <Btn onClick={check} disabled={busy}>{busy ? "Checking…" : "Check status"}</Btn>
          {status && <p>Status: <strong>{status}</strong></p>}
        </div>
      )}

      {result && result.verified && (
        <div style={{ marginTop: 16 }}>
          <h3>Verified - mapped fields</h3>
          <ul>
            {Object.entries(result.mappedFields).map(([k, v]) => (<li key={k}>{k}: {String(v)}</li>))}
          </ul>
          <h3>Extra data (stored)</h3>
          <ul>
            {Object.entries(result.extras).filter(([, v]) => v != null).map(([k, v]) => (
              <li key={k}>{k}: {typeof v === "object" ? JSON.stringify(v) : String(v)}</li>
            ))}
          </ul>
          <Btn onClick={onContinue}>Continue</Btn>
        </div>
      )}

      {error && <p style={{ color: "crimson" }}>Error: {error}</p>}
    </div>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `CI=true npx react-scripts test --watchAll=false src/components/idv`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/components/idv/IdentityVerificationStep.jsx src/components/idv/__tests__/IdentityVerificationStep.test.jsx
git commit -m "feat(idv): identity verification step component with QR"
```

---

### Task 8: Wire the step into the wizard + dev shortcut

**Files:**
- Modify: `src/App.js` (`stepsFor` ~line 595, `stepNames` ~line 600, add render block after the Applicant block ~line 4783, add dev-shortcut effect)

**Interfaces:**
- Consumes: `IdentityVerificationStep`, existing `dossierId`, `onboardingSubmissionId`, `setApplicantAgentValues`, `scrollAndSetStep`, `STEPS`, `card`, `Btn`.

- [ ] **Step 1: Import the component**

Near the other `src/components/*` imports at the top of `App.js`, add:

```js
import IdentityVerificationStep from "./components/idv/IdentityVerificationStep";
```

- [ ] **Step 2: Add the step to the step maps**

Replace the `stepsFor` / `stepNames` block (lines 595-602) with:

```js
  const stepsFor = (j) => j === "ai_documents"
    ? { input: 0, documents: 1, research: 2, applicant: 3, identityVerification: 4, confirm: 5, fillGaps: 6, documentRequirements: 7, declare: 8 }
    : { input: 0, research: 1, applicant: 2, identityVerification: 3, confirm: 4, fillGaps: 5, documentRequirements: 6, declare: 7 };
  const isAiDocs = journeyType === "ai_documents";
  const STEPS = stepsFor(journeyType);
  const stepNames = isAiDocs
    ? ["Company", "Documents", "Research", "Applicant", "Verify ID", "Confirm", "Fill Gaps", "Required Docs", "Declare"]
    : ["Company", "Research", "Applicant", "Verify ID", "Confirm", "Fill Gaps", "Required Docs", "Declare"];
```

- [ ] **Step 3: Render the step**

Immediately after the Applicant render block closes (the `)}` at line 4783), insert:

```jsx
        {step === STEPS.identityVerification && agentType !== "preboarding" && (
          <IdentityVerificationStep
            submissionId={dossierId || onboardingSubmissionId}
            onVerified={(mappedFields) =>
              setApplicantAgentValues((prev) => ({ ...prev, ...mappedFields }))}
            onContinue={() => scrollAndSetStep(STEPS.confirm)}
            cardStyle={card}
            Btn={Btn}
          />
        )}
```

- [ ] **Step 4: Add the dev-only shortcut**

Near the top of the component body (after `const STEPS = stepsFor(journeyType);` is in scope - place it with the other top-level `useEffect`s), add:

```jsx
  React.useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const p = new URLSearchParams(window.location.search);
    if (p.get("idvspike") === "1") {
      setStep(stepsFor(journeyType).identityVerification);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```

- [ ] **Step 5: Verify the app still builds and mounts**

Run: `CI=true npm run build`
Expected: `Compiled successfully` (warnings OK), exit 0.
Run: `CI=true npx react-scripts test --watchAll=false src/__tests__/appMounts.test.jsx`
Expected: PASS (wizard still mounts).

- [ ] **Step 6: Manual end-to-end check (sandbox)**

1. In the worktree: `npm start`; open `http://localhost:3000/?idvspike=1`.
2. Confirm you land on the **Identity Verification** step.
3. Click **Start verification** → a QR + hosted link appear.
4. Scan the QR on a phone → complete the Didit **sandbox** flow.
5. Back on the laptop, click **Check status** → status becomes `Approved`, mapped fields + extras render.
6. Open `E:\kyc-agent-dev\.didit-store.json` → confirm the ref holds `mappedFields` + `extras`.

- [ ] **Step 7: Commit**

```bash
git add src/App.js
git commit -m "feat(idv): wire identity verification step into wizard"
```

---

## Self-Review

- **Spec coverage:** reach step (T8) ✅; start session + QR (T2, T7) ✅; cross-device poll retrieval (T2 `getDecision`, T5) ✅; map to fields (T1, prefill in T8) ✅; store extras locally (T3, T5) ✅; poll-on-return (T5/T7) ✅; dev shortcut (T8) ✅; sandbox/synthetic + server-side key (Global Constraints, T2) ✅; tests (T1-T5, T7) ✅; deferred items live in `BACKLOG.md` ✅.
- **Placeholder scan:** no TBD/TODO; every code step shows full code.
- **Type consistency:** `createSession → {providerSessionId, hostedUrl, status}`, `getDecision → decision`, `mapDecision → {status, verified, mappedFields, extras}`, `store.get/saveSession/Result`, route bodies `{ ref }` - consistent across T1-T8.

## Out of scope (tracked in BACKLOG.md)

IDV-1 encrypted storage, IDV-2 KMS/OIDC/DB infra, IDV-3 production webhook, IDV-4 first-class identity fields, DEP-1 real test DB. The spike must remain sandbox/synthetic until IDV-1/2 land.
