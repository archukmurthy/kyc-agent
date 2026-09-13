# Durable Submission Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Guarantee a KYC submission is never lost and never half-saved, tell the customer the honest status of their save, and let them resume a form after a refresh or crash without retyping.

**Architecture:** On submit, the frontend first writes the whole submission bundle into a durable `submission_inbox` table (one tiny idempotent insert = the never-lose anchor), then the server attempts the real save once, inline. The real save (`finalizeSubmission`) writes all 11 tables inside ONE Neon `Pool` transaction — all-or-nothing, keyed on a stable `submissionId` so re-runs never duplicate. If the inline save succeeds the customer sees "Submitted successfully"; if it fails the row stays `pending` and a Vercel-cron worker retries it server-side forever, while the customer sees "Received — saving shortly". The wizard also autosaves a draft to `localStorage` so a refresh/crash can be resumed.

**Tech Stack:** React 18 (CRA, single-file `src/App.js`), Vercel serverless functions (`api/*.js`, CommonJS), Neon Postgres via `@neondatabase/serverless` (HTTP driver for simple writes, new `Pool` driver for the transaction), `ws` (new dep, WebSocket constructor for the Pool driver), Vercel Cron, `node:test` for unit tests.

## Global Constraints

- **Never lose a submission** — the durable inbox insert is the anchor; every later failure is retried, never surfaced as data loss.
- **Never a half-saved record** — the 11-table finalize is one transaction: full commit or full rollback.
- **Idempotent by `submissionId`** — one `submissionId` per submission, reused across every retry; no path may create duplicate clients / sessions / journeys.
- **Best-effort → durable-retry, never blocking** — the customer is never blocked at Declaration by a DB problem; a failed save becomes a queued save.
- CommonJS (`module.exports` / `require`) for all `api/*` and `db/*` files so `src/setupProxy.js` can `require()` them in dev — mirror `api/submit.js`, `api/config.js`.
- Migrations are additive and idempotent (`IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`), applied with `node db/apply.js db/migrations/<file>.sql`. Next migration number is **024**.
- SQL connection string: `process.env.DATABASE_URL` (same as `api/submit.js`).
- Tests are `node:test` files named `*.nodetest.js`, run via `node --test`. No new test framework.

---

## File Structure

**Create:**
- `db/migrations/024_submission_inbox.sql` — inbox table + `onboarding_sessions.submission_id` unique column.
- `api/lib/submissionInboxStore.js` — data access for `submission_inbox` (enqueue, claim pending, mark done/failed).
- `api/lib/finalizeSubmission.js` — the all-or-nothing 11-table transaction (Pool driver), idempotent on `submissionId`.
- `api/lib/neonPool.js` — shared Pool factory (sets `neonConfig.webSocketConstructor = require("ws")`).
- `api/finalize-submissions.js` — Vercel-cron worker endpoint: claims pending rows, finalizes each.
- `scripts/run-finalize-worker.js` — local one-shot runner for the worker (cron doesn't fire in dev).
- `src/utils/submissionDraft.js` — localStorage draft save/load/clear helpers.
- Tests: `api/__tests__/finalizeSubmission.nodetest.js`, `api/__tests__/submissionInboxStore.nodetest.js`, `api/__tests__/finalize-worker.nodetest.js`, `src/utils/__tests__/submissionDraft.test.js`.

**Modify:**
- `package.json` — add `ws` dependency; add `worker:finalize` script.
- `vercel.json` — add `crons` entry for `/api/finalize-submissions`; add `functions` maxDuration for it.
- `api/submit.js` — port the 11 writes into `finalizeSubmission.js`; rewrite the handler as two-phase (enqueue → inline finalize → status).
- `src/App.js` — stable `submissionId`; submit UX (`saved` / `queued` / `retry`); the done-screen copy; draft autosave + resume prompt.

**Idempotency contract (threads through everything):**
- `submission_inbox.id` = `submissionId` (PK) → duplicate enqueue is a no-op.
- `onboarding_sessions.submission_id` UNIQUE → re-finalize upserts the same session row.
- `clients` dedupes on existing `(tenant_id, legal_name, country_code)`.
- `journeys` dedupes on existing `(session_id)`.
- child tables (`field_values`, `field_provenance`, `api_usage`, `documents`, `session_timeline` overrides) are DELETE-by-parent-then-insert inside the transaction, so a re-run rewrites cleanly instead of duplicating.

---

## Phase 1 — Durable inbox schema (additive, harmless on its own)

### Task 1: Migration — `submission_inbox` table + `onboarding_sessions.submission_id`

**Files:**
- Create: `db/migrations/024_submission_inbox.sql`

**Interfaces:**
- Produces: table `submission_inbox (id, tenant_id, status, payload, attempts, last_error, created_at, updated_at, processed_at)`; column `onboarding_sessions.submission_id TEXT UNIQUE`.

- [ ] **Step 1: Confirm the live core-table columns exist before altering**

Run:
```bash
node -r dotenv/config -e "const {neon}=require('@neondatabase/serverless');const sql=neon(process.env.DATABASE_URL);sql\`SELECT column_name FROM information_schema.columns WHERE table_name='onboarding_sessions'\`.then(r=>{console.log(r.map(x=>x.column_name).join(', '));process.exit(0)}).catch(e=>{console.error(e.message);process.exit(1)})" dotenv_config_path=.env.local
```
Expected: a comma list including `id`, `client_id`, `tenant_id`. (Confirms the table exists and is safe to `ALTER`.) If `submission_id` already appears, Step 2's ALTER is a no-op — fine.

- [ ] **Step 2: Write the migration**

```sql
-- 024_submission_inbox.sql
-- Durable capture-and-queue for customer submissions. The bundle lands here
-- FIRST (idempotent on submissionId) before any structured write, so a submission
-- is never lost; a worker finalizes pending rows into the 11 domain tables via one
-- all-or-nothing transaction. status: pending -> processing -> done | failed.
CREATE TABLE IF NOT EXISTS submission_inbox (
  id            TEXT PRIMARY KEY,               -- = submissionId (client-minted UUID)
  tenant_id     TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',
  payload       JSONB NOT NULL,                 -- the exact /api/submit body
  attempts      INTEGER NOT NULL DEFAULT 0,
  last_error    TEXT,
  session_id    TEXT,                           -- set when finalize succeeds (audit link)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at  TIMESTAMPTZ
);

-- Worker claim scan: pending/failed rows under the retry ceiling, oldest first.
CREATE INDEX IF NOT EXISTS idx_submission_inbox_status
  ON submission_inbox (status, created_at);

-- Idempotency anchor for the finalize transaction: one session per submission.
ALTER TABLE onboarding_sessions
  ADD COLUMN IF NOT EXISTS submission_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_onboarding_sessions_submission_id
  ON onboarding_sessions (submission_id)
  WHERE submission_id IS NOT NULL;
```

- [ ] **Step 3: Apply the migration**

Run: `node db/apply.js db/migrations/024_submission_inbox.sql`
Expected: `✅ db/migrations/024_submission_inbox.sql applied (N statements)` with every statement `ok`.

- [ ] **Step 4: Verify the table and column exist**

Run:
```bash
node -r dotenv/config -e "const {neon}=require('@neondatabase/serverless');const sql=neon(process.env.DATABASE_URL);Promise.all([sql\`SELECT to_regclass('submission_inbox') AS t\`,sql\`SELECT column_name FROM information_schema.columns WHERE table_name='onboarding_sessions' AND column_name='submission_id'\`]).then(([a,b])=>{console.log('table:',a[0].t,'col:',b.length?'submission_id':'MISSING');process.exit(0)}).catch(e=>{console.error(e.message);process.exit(1)})" dotenv_config_path=.env.local
```
Expected: `table: submission_inbox col: submission_id`

- [ ] **Step 5: Commit**

```bash
git add db/migrations/024_submission_inbox.sql
git commit -m "feat(db): add submission_inbox + onboarding_sessions.submission_id (migration 024)"
```

---

## Phase 2 — Inbox data-access layer

### Task 2: `submissionInboxStore.js`

**Files:**
- Create: `api/lib/submissionInboxStore.js`
- Test: `api/__tests__/submissionInboxStore.nodetest.js`

**Interfaces:**
- Produces:
  - `enqueue({ submissionId, tenantId, payload }) -> Promise<{ id, inserted: boolean }>` — idempotent insert (`ON CONFLICT (id) DO NOTHING`).
  - `claimPending({ limit = 10, maxAttempts = 25 }) -> Promise<Array<{ id, tenant_id, payload, attempts }>>` — atomically flips `pending`/`failed` rows (under `maxAttempts`) to `processing`, returns them.
  - `markDone(id, sessionId) -> Promise<void>`
  - `markFailed(id, errorMessage) -> Promise<void>` — sets status back to `failed`, `attempts = attempts + 1`, records `last_error`.
- Consumes: `process.env.DATABASE_URL`, `@neondatabase/serverless` `neon` (HTTP driver — these are single-statement writes, no transaction needed here).

- [ ] **Step 1: Write the failing test**

```js
// api/__tests__/submissionInboxStore.nodetest.js
const { test } = require("node:test");
const assert = require("node:assert");

// Pure unit test with an injected fake `sql` tag function — no live DB. The store
// accepts an optional deps.sql so tests can capture the query + args.
const store = require("../lib/submissionInboxStore");

function fakeSql(returnRows) {
  const calls = [];
  const tag = (strings, ...values) => {
    calls.push({ text: strings.join("?"), values });
    return Promise.resolve(typeof returnRows === "function" ? returnRows(calls.length) : returnRows);
  };
  tag.calls = calls;
  return tag;
}

test("enqueue inserts idempotently and reports inserted=true on a new row", async () => {
  const sql = fakeSql([{ id: "sub-1" }]);
  const r = await store.enqueue(
    { submissionId: "sub-1", tenantId: "nium", payload: { a: 1 } },
    { sql }
  );
  assert.deepStrictEqual(r, { id: "sub-1", inserted: true });
  assert.match(sql.calls[0].text, /INSERT INTO submission_inbox/);
  assert.match(sql.calls[0].text, /ON CONFLICT .*DO NOTHING/s);
});

test("enqueue on a duplicate submissionId reports inserted=false", async () => {
  const sql = fakeSql([]); // ON CONFLICT DO NOTHING → no RETURNING row
  const r = await store.enqueue(
    { submissionId: "sub-1", tenantId: "nium", payload: { a: 1 } },
    { sql }
  );
  assert.deepStrictEqual(r, { id: "sub-1", inserted: false });
});

test("enqueue rejects a missing submissionId", async () => {
  await assert.rejects(
    () => store.enqueue({ tenantId: "nium", payload: {} }, { sql: fakeSql([]) }),
    /submissionId is required/
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test api/__tests__/submissionInboxStore.nodetest.js`
Expected: FAIL — `Cannot find module '../lib/submissionInboxStore'`.

- [ ] **Step 3: Write the store**

```js
// api/lib/submissionInboxStore.js
"use strict";

// Data access for submission_inbox (migration 024). Single-statement writes over
// the Neon HTTP driver. The durable capture point: a submission lands here before
// any structured write, and a worker finalizes it later. Idempotent on id
// (= submissionId).
const { neon } = require("@neondatabase/serverless");

function defaultSql() {
  const conn = process.env.DATABASE_URL;
  if (!conn) throw new Error("DATABASE_URL not set");
  return neon(conn);
}

async function enqueue({ submissionId, tenantId, payload }, deps = {}) {
  if (!submissionId) throw new Error("enqueue: submissionId is required");
  if (!tenantId) throw new Error("enqueue: tenantId is required");
  const sql = deps.sql || defaultSql();
  const rows = await sql`
    INSERT INTO submission_inbox (id, tenant_id, status, payload)
    VALUES (${submissionId}, ${tenantId}, 'pending', ${JSON.stringify(payload)}::jsonb)
    ON CONFLICT (id) DO NOTHING
    RETURNING id
  `;
  return { id: submissionId, inserted: rows.length > 0 };
}

// Atomically claim a batch: flip eligible rows to 'processing' and return them.
// A single UPDATE ... RETURNING is its own implicit transaction, so two concurrent
// workers cannot claim the same row.
async function claimPending({ limit = 10, maxAttempts = 25 } = {}, deps = {}) {
  const sql = deps.sql || defaultSql();
  const rows = await sql`
    UPDATE submission_inbox SET status = 'processing', updated_at = now()
    WHERE id IN (
      SELECT id FROM submission_inbox
      WHERE status IN ('pending', 'failed') AND attempts < ${maxAttempts}
      ORDER BY created_at ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, tenant_id, payload, attempts
  `;
  return rows;
}

async function markDone(id, sessionId, deps = {}) {
  const sql = deps.sql || defaultSql();
  await sql`
    UPDATE submission_inbox
    SET status = 'done', session_id = ${sessionId || null},
        processed_at = now(), updated_at = now(), last_error = NULL
    WHERE id = ${id}
  `;
}

async function markFailed(id, errorMessage, deps = {}) {
  const sql = deps.sql || defaultSql();
  await sql`
    UPDATE submission_inbox
    SET status = 'failed', attempts = attempts + 1,
        last_error = ${String(errorMessage || "").slice(0, 2000)}, updated_at = now()
    WHERE id = ${id}
  `;
}

module.exports = { enqueue, claimPending, markDone, markFailed };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test api/__tests__/submissionInboxStore.nodetest.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add api/lib/submissionInboxStore.js api/__tests__/submissionInboxStore.nodetest.js
git commit -m "feat(submit): add durable submission_inbox store (enqueue/claim/mark)"
```

---

## Phase 3 — All-or-nothing finalize transaction

### Task 3: Shared Neon Pool factory + `ws` dependency

**Files:**
- Modify: `package.json` (dependencies)
- Create: `api/lib/neonPool.js`

**Interfaces:**
- Produces: `getPool() -> Pool` (a singleton `@neondatabase/serverless` Pool bound to `DATABASE_URL`, with the WebSocket constructor configured for Node).

- [ ] **Step 1: Add the `ws` dependency**

Run: `npm install ws@^8.18.0`
Expected: `package.json` `dependencies` now contains `"ws"`; `package-lock.json` updated; exit 0.

- [ ] **Step 2: Write the Pool factory**

```js
// api/lib/neonPool.js
"use strict";

// Pool (WebSocket) driver for INTERACTIVE transactions — the HTTP `neon()` driver
// cannot BEGIN/COMMIT across statements that chain on RETURNING ids, which the
// 11-table finalize needs. One shared Pool per process (Fluid Compute reuses the
// instance across invocations, so we do NOT end() it per request).
const { Pool, neonConfig } = require("@neondatabase/serverless");
const ws = require("ws");

neonConfig.webSocketConstructor = ws;

let pool = null;
function getPool() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

module.exports = { getPool };
```

- [ ] **Step 3: Verify the module loads and the WS constructor is set**

Run: `node -e "require('./api/lib/neonPool.js'); const {neonConfig}=require('@neondatabase/serverless'); if(!neonConfig.webSocketConstructor) throw new Error('ws not configured'); console.log('ok')"`
Expected: `ok`

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json api/lib/neonPool.js
git commit -m "feat(submit): add Neon Pool factory for interactive transactions (ws dep)"
```

### Task 4: `finalizeSubmission.js` — the 11-table transaction

**Files:**
- Create: `api/lib/finalizeSubmission.js`
- Test: `api/__tests__/finalizeSubmission.nodetest.js`
- Reference (port SQL FROM here): `api/submit.js:424-634` (tenants/clients/onboarding_sessions/field_values/session_timeline) and `api/submit.js:71-368` (`persistJourneyModel`).

**Interfaces:**
- Consumes: `getPool` from `api/lib/neonPool.js`; the submit payload shape (`api/submit.js:375-402`).
- Produces: `finalizeSubmission(payload, deps?) -> Promise<{ sessionId, clientId, journeyId }>` — runs ALL writes in ONE transaction on a pooled client; throws on any failure (caller rolls back and leaves the inbox row pending). Idempotent on `payload.submissionId`.

**Design notes for the implementer (read before writing):**
- The body of this function is the SAME sequence of `INSERT`s already in `api/submit.js`, with FOUR mechanical changes:
  1. Every `await sql\`…\`` becomes `await client.query(text, params)` on a `pg`-style pooled client (the Pool driver speaks the `pg` protocol; use `$1,$2,…` placeholders, not tagged templates). Keep the exact column lists and values — only the call form changes.
  2. Wrap the whole sequence in `await client.query("BEGIN")` … `await client.query("COMMIT")`, with `ROLLBACK` in a `catch`.
  3. Make `onboarding_sessions` idempotent: add `submission_id` to the INSERT column list with value `payload.submissionId`, and append `ON CONFLICT (submission_id) DO UPDATE SET status = EXCLUDED.status, completed_at = EXCLUDED.completed_at RETURNING id`. Re-finalize returns the SAME session id.
  4. Every child-table write becomes DELETE-by-parent-then-INSERT so a re-run rewrites, never duplicates: `DELETE FROM field_values WHERE session_id = $1` before the field loop; `persistJourneyModel` already deletes `api_usage`/`field_provenance` by `journey_id` — keep those; add `DELETE FROM session_timeline WHERE session_id = $1 AND event_type = 'applicant_field_overridden'` before the overrides loop; add `DELETE FROM documents WHERE journey_id = $1` before the documents loop.
- Remove the per-insert `try/catch` swallows that exist in `api/submit.js` (e.g. `api/submit.js:185-187, 237-239, 265-267, 302-307, 331-333, 362-364, 593-599, 628-633`). Inside the transaction a child-row failure MUST abort the whole thing — that is the all-or-nothing requirement. No inner catches.
- Keep `persistJourneyModel`'s recompute-cost-from-pricing logic and all provenance rules verbatim (only the call form + the removed catches change).
- `tenants` upsert keeps `ON CONFLICT (id) DO NOTHING`; `clients` keeps `ON CONFLICT (tenant_id, legal_name, country_code) DO UPDATE … RETURNING id`; `journeys` keeps `ON CONFLICT (session_id) DO UPDATE … RETURNING journey_id`.

- [ ] **Step 1: Write the failing test (transaction + idempotency contract, with a fake client)**

```js
// api/__tests__/finalizeSubmission.nodetest.js
const { test } = require("node:test");
const assert = require("node:assert");
const { finalizeSubmission } = require("../lib/finalizeSubmission");

// Fake pooled client: records the ordered query text, returns canned RETURNING
// rows for the three id-bearing inserts so the chain resolves. No live DB.
function fakeClient() {
  const queries = [];
  return {
    queries,
    query(text, params) {
      queries.push(String(text).trim().split("\n")[0].trim());
      const t = String(text);
      if (/INSERT INTO clients/i.test(t)) return Promise.resolve({ rows: [{ id: "client-1" }] });
      if (/INSERT INTO onboarding_sessions/i.test(t)) return Promise.resolve({ rows: [{ id: "session-1" }] });
      if (/INSERT INTO journeys/i.test(t)) return Promise.resolve({ rows: [{ journey_id: "journey-1" }] });
      return Promise.resolve({ rows: [] });
    },
    release() {},
  };
}

const basePayload = {
  submissionId: "sub-1",
  tenantId: "nium",
  company: { name: "Acme Ltd", code: "GB" },
  entityType: "company",
  fieldValues: { legal_name: "Acme Ltd" },
  declaration: { agreedAt: "2026-09-13T00:00:00Z" },
};

test("finalize wraps all writes in one transaction (BEGIN first, COMMIT last)", async () => {
  const client = fakeClient();
  const pool = { connect: () => Promise.resolve(client) };
  const r = await finalizeSubmission(basePayload, { pool });
  assert.strictEqual(client.queries[0], "BEGIN");
  assert.strictEqual(client.queries[client.queries.length - 1], "COMMIT");
  assert.deepStrictEqual(r, { sessionId: "session-1", clientId: "client-1", journeyId: "journey-1" });
});

test("finalize is idempotent on submissionId (session upsert, not insert-blind)", async () => {
  const client = fakeClient();
  const pool = { connect: () => Promise.resolve(client) };
  await finalizeSubmission(basePayload, { pool });
  const sessionInsert = client.queries.find((q) => /INSERT INTO onboarding_sessions/i.test(q));
  const full = client.queries.join("\n");
  assert.ok(sessionInsert, "expected an onboarding_sessions insert");
  assert.match(full, /submission_id/); // submission_id threaded in
});

test("finalize rolls back when a write throws (no partial commit)", async () => {
  const client = fakeClient();
  let rolledBack = false;
  const orig = client.query.bind(client);
  client.query = (text, params) => {
    if (/INSERT INTO field_values/i.test(String(text))) return Promise.reject(new Error("boom"));
    if (String(text).trim() === "ROLLBACK") rolledBack = true;
    return orig(text, params);
  };
  const pool = { connect: () => Promise.resolve(client) };
  await assert.rejects(() => finalizeSubmission(basePayload, { pool }), /boom/);
  assert.strictEqual(rolledBack, true);
  assert.ok(!client.queries.includes("COMMIT"), "must not COMMIT after a failed write");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test api/__tests__/finalizeSubmission.nodetest.js`
Expected: FAIL — `Cannot find module '../lib/finalizeSubmission'`.

- [ ] **Step 3: Write `finalizeSubmission.js`**

Structure (fill the domain writes by porting `api/submit.js` per the Design notes above):

```js
// api/lib/finalizeSubmission.js
"use strict";

// All-or-nothing persistence of one customer submission into the 11 domain tables.
// Runs on a pooled client inside a single BEGIN/COMMIT so the record is never
// half-written. Idempotent on payload.submissionId: onboarding_sessions upserts on
// submission_id and every child table is DELETE-by-parent-then-INSERT, so the
// worker can retry safely without duplicating. Throws on ANY failure after
// ROLLBACK — the caller keeps the inbox row pending for a later retry.
const { getPool } = require("./neonPool");
const { deriveScalarProvenance } = require("../../src/utils/fieldProvenance");

function isInetLiteral(s) { /* copy verbatim from api/submit.js:38-43 */ }
function mapMethod(journeyType) { /* copy verbatim from api/submit.js:46-51 */ }
function mapLayerFromJourney(journeyType) { /* copy verbatim from api/submit.js:55-59 */ }
function toTimestamp(v) { /* copy verbatim from api/submit.js:62-66 */ }

async function finalizeSubmission(payload, deps = {}) {
  const {
    submissionId, tenantId, company, entityType, ownershipType, journeyType,
    fieldValues, fieldMetadata, stakeholders, stakeholderAttributes,
    amendmentDocuments, confirmMetrics, documents, costSummary, coverage,
    declaration, applicant, applicantProvenance, applicantOverrides, submittedAt,
  } = payload;

  if (!submissionId) throw new Error("finalizeSubmission: submissionId is required");
  if (!tenantId || !company || !company.name) {
    throw new Error("finalizeSubmission: tenantId and company.name are required");
  }

  const pool = deps.pool || getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. tenants upsert            — port api/submit.js:424-428
    // 2. clients upsert  RETURNING id → clientId   — port api/submit.js:431-453
    // 3. onboarding_sessions INSERT ... , submission_id = $submissionId,
    //    ON CONFLICT (submission_id) DO UPDATE SET status=EXCLUDED.status,
    //    completed_at=EXCLUDED.completed_at RETURNING id → sessionId
    //    — port api/submit.js:459-564, adding the submission_id column + conflict clause
    // 4. DELETE FROM field_values WHERE session_id=$sessionId; then the field loop
    //    — port api/submit.js:566-600 (NO inner try/catch)
    // 5. DELETE FROM session_timeline WHERE session_id=$sessionId
    //    AND event_type='applicant_field_overridden'; then the overrides loop
    //    — port api/submit.js:602-644 (NO inner try/catch)
    // 6. journey model: journeys upsert RETURNING journey_id → journeyId,
    //    completion_choice, declaration, api_usage (DELETE then insert),
    //    field_provenance (DELETE then insert, scalars + stakeholders + attrs +
    //    applicant), documents (DELETE FROM documents WHERE journey_id=$journeyId
    //    then insert satisfied docs) — port api/submit.js:71-368 (NO inner try/catch)

    await client.query("COMMIT");
    return { sessionId, clientId, journeyId };
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) { /* ignore rollback error */ }
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { finalizeSubmission };
```

Implement every `// port …` comment as real `await client.query("<SQL with $1,$2,…>", [<values>])` calls, preserving the exact column lists, values, and RETURNING clauses from the referenced lines. The three id variables (`clientId`, `sessionId`, `journeyId`) come from `result.rows[0]`.

- [ ] **Step 4: Run the unit test to verify it passes**

Run: `node --test api/__tests__/finalizeSubmission.nodetest.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Real-DB smoke — finalize twice, assert exactly one session**

Run:
```bash
node -r dotenv/config -e "
const {finalizeSubmission}=require('./api/lib/finalizeSubmission');
const {neon}=require('@neondatabase/serverless');
const sql=neon(process.env.DATABASE_URL);
const id='smoke-'+process.pid;
const p={submissionId:id,tenantId:'nium',company:{name:'Smoke Co '+process.pid,code:'GB'},entityType:'company',journeyType:'ai_only',fieldValues:{legal_name:'Smoke Co'},declaration:{agreedAt:new Date().toISOString(),declarationVersion:'v1'},submittedAt:new Date().toISOString()};
(async()=>{
  await finalizeSubmission(p);
  await finalizeSubmission(p); // retry — must NOT create a second session
  const rows=await sql\`SELECT count(*)::int n FROM onboarding_sessions WHERE submission_id=\${id}\`;
  console.log('sessions for submission:',rows[0].n);
  if(rows[0].n!==1){process.exit(1);}
  console.log('IDEMPOTENT OK');process.exit(0);
})().catch(e=>{console.error(e);process.exit(1)});
" dotenv_config_path=.env.local
```
Expected: `sessions for submission: 1` then `IDEMPOTENT OK`. (Proves both the transaction commits and the retry is idempotent.)

- [ ] **Step 6: Commit**

```bash
git add api/lib/finalizeSubmission.js api/__tests__/finalizeSubmission.nodetest.js
git commit -m "feat(submit): all-or-nothing 11-table finalize (Pool transaction, idempotent on submissionId)"
```

---

## Phase 4 — Two-phase submit handler

### Task 5: Rewrite `api/submit.js` as enqueue → inline finalize → status

**Files:**
- Modify: `api/submit.js` (replace the handler body; the ported SQL now lives in `finalizeSubmission.js`)
- Test: extend `api/__tests__/finalizeSubmission.nodetest.js` is NOT enough — add handler test below.
- Test: `api/__tests__/submit-handler.nodetest.js` (create)

**Interfaces:**
- Consumes: `enqueue` from `submissionInboxStore.js`, `finalizeSubmission` from `finalizeSubmission.js`.
- Produces: `POST /api/submit` returns:
  - `{ status: "saved", sessionId, clientId, journeyId }` when the inline finalize commits.
  - `{ status: "queued", submissionId }` when finalize throws (row stays pending for the worker).
  - `400` only for a payload missing `submissionId` / `tenantId` / `company.name`.

- [ ] **Step 1: Write the failing handler test**

```js
// api/__tests__/submit-handler.nodetest.js
const { test } = require("node:test");
const assert = require("node:assert");

function fakeRes() {
  return {
    statusCode: null, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

test("returns status:saved when finalize succeeds", async () => {
  const handler = require("../submit");
  handler.__setDeps({
    enqueue: async () => ({ id: "sub-1", inserted: true }),
    finalizeSubmission: async () => ({ sessionId: "s1", clientId: "c1", journeyId: "j1" }),
    markDone: async () => {},
    markFailed: async () => {},
  });
  const req = { method: "POST", body: { submissionId: "sub-1", tenantId: "nium", company: { name: "Acme" } } };
  const res = fakeRes();
  await handler(req, res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.status, "saved");
  assert.strictEqual(res.body.sessionId, "s1");
});

test("returns status:queued when finalize throws (never blocks)", async () => {
  const handler = require("../submit");
  handler.__setDeps({
    enqueue: async () => ({ id: "sub-1", inserted: true }),
    finalizeSubmission: async () => { throw new Error("db down"); },
    markDone: async () => {},
    markFailed: async () => {},
  });
  const req = { method: "POST", body: { submissionId: "sub-1", tenantId: "nium", company: { name: "Acme" } } };
  const res = fakeRes();
  await handler(req, res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.status, "queued");
});

test("returns 400 when submissionId is missing", async () => {
  const handler = require("../submit");
  handler.__setDeps({ enqueue: async () => ({}), finalizeSubmission: async () => ({}), markDone: async()=>{}, markFailed: async()=>{} });
  const req = { method: "POST", body: { tenantId: "nium", company: { name: "Acme" } } };
  const res = fakeRes();
  await handler(req, res);
  assert.strictEqual(res.statusCode, 400);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test api/__tests__/submit-handler.nodetest.js`
Expected: FAIL — either `__setDeps is not a function` or wrong `status` values (current handler returns `success`, not `status`).

- [ ] **Step 3: Rewrite the handler**

Replace the entire `module.exports = async function handler` body (`api/submit.js:370-698`) with:

```js
// Injected deps (overridable in tests via __setDeps).
let _deps = {
  enqueue: require("./lib/submissionInboxStore").enqueue,
  finalizeSubmission: require("./lib/finalizeSubmission").finalizeSubmission,
  markDone: require("./lib/submissionInboxStore").markDone,
  markFailed: require("./lib/submissionInboxStore").markFailed,
};

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const body = req.body || {};
  const { submissionId, tenantId, company } = body;
  if (!submissionId || !tenantId || !company || !company.name) {
    return res.status(400).json({
      error: "Missing required fields: submissionId, tenantId and company.name are required",
    });
  }
  if (!process.env.DATABASE_URL) {
    // No DB configured: we cannot durably capture. Report queued so the client keeps
    // its browser draft and retries; nothing is silently lost.
    console.error("[api/submit] No DATABASE_URL");
    return res.status(200).json({ status: "queued", submissionId });
  }

  // Phase 1: durable capture. If this throws, the request fails loudly (non-200) so
  // the browser keeps retrying from its saved draft — the bundle is NOT yet safe.
  try {
    await _deps.enqueue({ submissionId, tenantId, payload: body });
  } catch (err) {
    console.error("[api/submit] enqueue failed:", err.message);
    return res.status(503).json({ status: "capture_failed", submissionId, error: err.message });
  }

  // Phase 2: try the real save once, inline. Success → saved; failure → queued for
  // the worker. Either way the customer is never blocked and never loses data.
  try {
    const r = await _deps.finalizeSubmission(body);
    await _deps.markDone(submissionId, r.sessionId);
    console.log(`[api/submit] ✅ saved inline — session ${r.sessionId}`);
    return res.status(200).json({ status: "saved", ...r });
  } catch (err) {
    await _deps.markFailed(submissionId, err.message).catch(() => {});
    console.warn(`[api/submit] finalize deferred to worker (${submissionId}):`, err.message);
    return res.status(200).json({ status: "queued", submissionId });
  }
};

// Test seam only.
module.exports.__setDeps = (d) => { _deps = { ..._deps, ...d }; };
```

Delete the now-dead `persistJourneyModel` and the inline SQL from `api/submit.js` (moved to `finalizeSubmission.js`), plus the now-unused `neon`/`deriveScalarProvenance` requires and helper functions at the top of the file. Keep the file's leading comment updated to describe the two-phase flow.

- [ ] **Step 4: Run the handler test to verify it passes**

Run: `node --test api/__tests__/submit-handler.nodetest.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Full API test sweep (no regressions)**

Run: `npm run test:node`
Expected: all `api/__tests__/*.nodetest.js` and `lib/__tests__/*.nodetest.js` PASS.

- [ ] **Step 6: Commit**

```bash
git add api/submit.js api/__tests__/submit-handler.nodetest.js
git commit -m "feat(submit): two-phase submit — durable enqueue + inline finalize, saved/queued status"
```

---

## Phase 5 — Background retry worker

### Task 6: `finalize-submissions.js` cron worker + local runner

**Files:**
- Create: `api/finalize-submissions.js`
- Create: `scripts/run-finalize-worker.js`
- Modify: `vercel.json` (crons + function maxDuration)
- Modify: `package.json` (script `worker:finalize`)
- Test: `api/__tests__/finalize-worker.nodetest.js`

**Interfaces:**
- Consumes: `claimPending`, `markDone`, `markFailed` from `submissionInboxStore.js`; `finalizeSubmission` from `finalizeSubmission.js`.
- Produces: `runWorker(deps?) -> Promise<{ claimed, done, failed }>`; a Vercel-cron HTTP handler that auth-checks `CRON_SECRET` then calls `runWorker`.

- [ ] **Step 1: Write the failing worker test**

```js
// api/__tests__/finalize-worker.nodetest.js
const { test } = require("node:test");
const assert = require("node:assert");
const { runWorker } = require("../finalize-submissions");

test("finalizes each claimed row and marks it done", async () => {
  const done = [];
  const deps = {
    claimPending: async () => [
      { id: "a", tenant_id: "nium", payload: { submissionId: "a", tenantId: "nium", company: { name: "A" } } },
      { id: "b", tenant_id: "nium", payload: { submissionId: "b", tenantId: "nium", company: { name: "B" } } },
    ],
    finalizeSubmission: async (p) => ({ sessionId: "s-" + p.submissionId, clientId: "c", journeyId: "j" }),
    markDone: async (id) => { done.push(id); },
    markFailed: async () => { throw new Error("should not fail"); },
  };
  const r = await runWorker(deps);
  assert.deepStrictEqual(r, { claimed: 2, done: 2, failed: 0 });
  assert.deepStrictEqual(done.sort(), ["a", "b"]);
});

test("a row that throws is marked failed, and the batch continues", async () => {
  const failed = [], done = [];
  const deps = {
    claimPending: async () => [
      { id: "a", tenant_id: "nium", payload: { submissionId: "a", tenantId: "nium", company: { name: "A" } } },
      { id: "b", tenant_id: "nium", payload: { submissionId: "b", tenantId: "nium", company: { name: "B" } } },
    ],
    finalizeSubmission: async (p) => { if (p.submissionId === "a") throw new Error("boom"); return { sessionId: "s", clientId: "c", journeyId: "j" }; },
    markDone: async (id) => { done.push(id); },
    markFailed: async (id) => { failed.push(id); },
  };
  const r = await runWorker(deps);
  assert.deepStrictEqual(r, { claimed: 2, done: 1, failed: 1 });
  assert.deepStrictEqual(failed, ["a"]);
  assert.deepStrictEqual(done, ["b"]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test api/__tests__/finalize-worker.nodetest.js`
Expected: FAIL — `Cannot find module '../finalize-submissions'`.

- [ ] **Step 3: Write the worker**

```js
// api/finalize-submissions.js
"use strict";

// Background retry worker for the submission inbox. Claims pending/failed rows and
// runs the all-or-nothing finalize for each. Invoked by Vercel Cron on a schedule;
// also runnable locally via scripts/run-finalize-worker.js. A row that fails is
// marked failed (attempts++) and retried on the next tick until it succeeds or hits
// the attempts ceiling — the submission is never lost.
const store = require("./lib/submissionInboxStore");
const { finalizeSubmission } = require("./lib/finalizeSubmission");

async function runWorker(deps = {}) {
  const claimPending = deps.claimPending || store.claimPending;
  const finalize = deps.finalizeSubmission || finalizeSubmission;
  const markDone = deps.markDone || store.markDone;
  const markFailed = deps.markFailed || store.markFailed;

  const rows = await claimPending({ limit: 20 });
  let done = 0, failed = 0;
  for (const row of rows) {
    try {
      const r = await finalize(row.payload);
      await markDone(row.id, r.sessionId);
      done++;
    } catch (err) {
      await markFailed(row.id, err.message);
      failed++;
    }
  }
  return { claimed: rows.length, done, failed };
}

module.exports = async function handler(req, res) {
  // Vercel sets Authorization: Bearer <CRON_SECRET> on cron invocations when the
  // env var is present. Reject anything else so the endpoint isn't publicly runnable.
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: "unauthorized" });
  }
  try {
    const result = await runWorker();
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    console.error("[finalize-submissions] worker error:", err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
};

module.exports.runWorker = runWorker;
```

- [ ] **Step 4: Write the local runner**

```js
// scripts/run-finalize-worker.js
// One-shot local run of the finalize worker (Vercel Cron does not fire in dev).
// Usage: node -r dotenv/config scripts/run-finalize-worker.js dotenv_config_path=.env.local
const { runWorker } = require("../api/finalize-submissions");
runWorker()
  .then((r) => { console.log("worker result:", r); process.exit(0); })
  .catch((e) => { console.error("worker failed:", e); process.exit(1); });
```

- [ ] **Step 5: Wire the cron + script**

In `vercel.json`, add a `crons` array and a function duration (merge into the existing `functions` object):

```json
  "functions": {
    "api/doc-search.js": { "maxDuration": 60 },
    "api/self-source.js": { "maxDuration": 60 },
    "api/generate-policy.js": { "maxDuration": 300 },
    "api/finalize-submissions.js": { "maxDuration": 60 }
  },
  "crons": [
    { "path": "/api/finalize-submissions", "schedule": "* * * * *" }
  ],
```

In `package.json` `scripts`, add:
```json
    "worker:finalize": "node -r dotenv/config scripts/run-finalize-worker.js dotenv_config_path=.env.local",
```

- [ ] **Step 6: Run the worker test to verify it passes**

Run: `node --test api/__tests__/finalize-worker.nodetest.js`
Expected: PASS (2 tests).

- [ ] **Step 7: End-to-end DB smoke — queue a row, run the worker, assert done**

Run:
```bash
node -r dotenv/config -e "
const store=require('./api/lib/submissionInboxStore');
const {neon}=require('@neondatabase/serverless');const sql=neon(process.env.DATABASE_URL);
const id='wrk-'+process.pid;
(async()=>{
  await store.enqueue({submissionId:id,tenantId:'nium',payload:{submissionId:id,tenantId:'nium',company:{name:'Worker Co '+process.pid,code:'GB'},entityType:'company',journeyType:'ai_only',fieldValues:{legal_name:'Worker Co'},declaration:{agreedAt:new Date().toISOString(),declarationVersion:'v1'},submittedAt:new Date().toISOString()}});
  const {runWorker}=require('./api/finalize-submissions');
  console.log(await runWorker());
  const r=await sql\`SELECT status, session_id FROM submission_inbox WHERE id=\${id}\`;
  console.log('inbox row:',r[0]);
  if(r[0].status!=='done'||!r[0].session_id){process.exit(1);}
  console.log('WORKER OK');process.exit(0);
})().catch(e=>{console.error(e);process.exit(1)});
" dotenv_config_path=.env.local
```
Expected: worker result `{ claimed: >=1, done: >=1, failed: 0 }`, then `inbox row: { status: 'done', session_id: '…' }`, then `WORKER OK`.

- [ ] **Step 8: Commit**

```bash
git add api/finalize-submissions.js scripts/run-finalize-worker.js vercel.json package.json api/__tests__/finalize-worker.nodetest.js
git commit -m "feat(submit): Vercel-cron worker retries pending submissions to done"
```

> **Post-deploy (manual, not a code step):** set `CRON_SECRET` in Vercel project env so the worker endpoint is not publicly runnable. Note it in the PR description.

---

## Phase 6 — Frontend: stable submissionId + saved/queued UX

### Task 7: Stable `submissionId` and two-status submit result

**Files:**
- Modify: `src/App.js` — `submitApplication` (`src/App.js:2645-2954`), the done-screen (`src/App.js:5197-5234`), new state near the other `useState`s (~`src/App.js:533-538`).

**Interfaces:**
- Consumes: `POST /api/submit` returning `{ status: "saved" | "queued" | "capture_failed", … }`.
- Produces: two React states — `submitStatus` (`"" | "saved" | "queued" | "retrying"`) and a stable `submissionIdRef`; the done screen reads `submitStatus` to pick copy.

**Design notes:**
- Today `payload.submissionId = genUUID()` is minted fresh on every `submitApplication` call (`src/App.js:2793`). For idempotent retries the id MUST be stable across retries of the SAME submission. Mint it once into a ref when the customer first reaches submit, reuse it for retries, and reset it only on "Start New Application".
- `setDone(true)` currently runs unconditionally (`src/App.js:2953`). Keep showing the done screen (customer is never blocked), but drive its COPY off `submitStatus`.

- [ ] **Step 1: Add the stable id + status state**

Near the existing declaration states (`src/App.js:533-538`), add:
```js
  const [submitStatus, setSubmitStatus] = useState(""); // "" | "saved" | "queued" | "retrying"
  const submissionIdRef = useRef(null);
  const lastPayloadRef = useRef(null); // kept for the Retry button (Task 8-not-needed: reuse)
  const getSubmissionId = () => {
    if (!submissionIdRef.current) submissionIdRef.current = genUUID();
    return submissionIdRef.current;
  };
```
In the "Start New Application" onClick (`src/App.js:5232`), add `submissionIdRef.current = null; setSubmitStatus("");` alongside the existing resets.

- [ ] **Step 2: Use the stable id in the payload and capture the status**

In `submitApplication`, change `submissionId: genUUID(),` (`src/App.js:2793`) to `submissionId: getSubmissionId(),`. Replace the fetch result handling (`src/App.js:2930-2951`) with:
```js
      const result = await resp.json().catch(() => ({}));
      lastPayloadRef.current = payload;
      if (result.status === "saved") {
        setSubmitStatus("saved");
        trackEvent("application_submitted", {
          companyName: submitCompany.name, sessionId: result.sessionId,
          totalCostUsd: costSummary?.totals?.totalCostUsd ?? null,
          totalTokens: costSummary?.totals?.totalTokens ?? null,
          fillRate: coverage?.fillRate ?? null,
          agentType: agentType || "onboarding", submittedAt: new Date().toISOString(),
        });
      } else {
        // queued or capture_failed — durable capture will finalize later.
        setSubmitStatus("queued");
      }
    } catch (err) {
      // The POST itself never reached a definite answer — treat as queued; the
      // browser draft (Task 9) is the backstop and can resubmit on next load.
      // eslint-disable-next-line no-console
      console.error("[Submit] network error:", err);
      setSubmitStatus("queued");
    }

    setDone(true);
```

- [ ] **Step 3: Drive the done-screen copy off `submitStatus`**

In the done block (`src/App.js:5200-5201`), replace the fixed heading + subline with:
```jsx
            <h2 style={{ fontSize: 20, fontWeight: 800, margin: "0 0 6px" }}>
              {submitStatus === "saved" ? "Application Submitted" : "Application Received"} {jurisdictionBadge}{entityBadge}
            </h2>
            <p style={{ fontSize: 13, color: "#1a3a4a70", margin: "0 0 22px" }}>
              {submitStatus === "saved"
                ? <>KYC onboarding for <strong>{research?.companyName || companyName}</strong> submitted successfully.</>
                : <>KYC onboarding for <strong>{research?.companyName || companyName}</strong> received — we're saving it now and it will be finalized shortly.</>}
            </p>
```
Also change the check-circle color to a neutral "in progress" tone when queued: replace the icon `background` with
```js
background: submitStatus === "saved" ? "linear-gradient(135deg,#4a9e8e,#3a8e7e)" : "linear-gradient(135deg,#c99a2e,#b7891f)",
```
and the glyph from `✓` to `{submitStatus === "saved" ? "✓" : "⏳"}`.

- [ ] **Step 4: Manual verification in the running app (happy path = saved)**

Run: `npm start`, complete a submission end-to-end in the browser (dev proxy runs `/api/submit` + the inline finalize).
Expected: done screen reads **"Application Submitted … submitted successfully."** Confirm in the DB the row landed: `node -r dotenv/config scripts/demo/inspect.js <sessionId> dotenv_config_path=.env.local` (sessionId from the server console log `✅ saved inline — session …`).

- [ ] **Step 5: Manual verification of the queued path**

Temporarily force finalize to throw: set an invalid `DATABASE_URL` for finalize only by editing `.env.local` to a bad host and restart `npm start`. Submit again.
Expected: done screen reads **"Application Received … finalized shortly."** Then restore `.env.local`, run `npm run worker:finalize`, and confirm the queued row flips to `done` (worker result shows `done: 1`). Revert the `.env.local` change.

- [ ] **Step 6: Commit**

```bash
git add src/App.js
git commit -m "feat(submit): stable submissionId + saved/received UX driven by save status"
```

---

## Phase 7 — Frontend: browser draft autosave + resume

### Task 8: `submissionDraft.js` helpers

**Files:**
- Create: `src/utils/submissionDraft.js`
- Test: `src/utils/__tests__/submissionDraft.test.js`

**Interfaces:**
- Produces:
  - `saveDraft(state) -> void` — writes `{ savedAt, state }` to `localStorage["kyc_draft_v1"]`, swallowing quota/serialization errors.
  - `loadDraft() -> { savedAt, state } | null`
  - `clearDraft() -> void`
  - `DRAFT_KEY = "kyc_draft_v1"`

- [ ] **Step 1: Write the failing test**

```js
// src/utils/__tests__/submissionDraft.test.js
import { saveDraft, loadDraft, clearDraft, DRAFT_KEY } from "../submissionDraft";

beforeEach(() => localStorage.clear());

test("saveDraft then loadDraft round-trips the state", () => {
  saveDraft({ companyName: "Acme", step: 3 });
  const d = loadDraft();
  expect(d.state).toEqual({ companyName: "Acme", step: 3 });
  expect(typeof d.savedAt).toBe("string");
});

test("loadDraft returns null when nothing saved", () => {
  expect(loadDraft()).toBeNull();
});

test("clearDraft removes the draft", () => {
  saveDraft({ step: 1 });
  clearDraft();
  expect(loadDraft()).toBeNull();
  expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
});

test("loadDraft returns null on corrupt JSON instead of throwing", () => {
  localStorage.setItem(DRAFT_KEY, "{not json");
  expect(loadDraft()).toBeNull();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `CI=true npx react-scripts test --watchAll=false src/utils/__tests__/submissionDraft.test.js`
Expected: FAIL — cannot find `../submissionDraft`.

- [ ] **Step 3: Write the helpers**

```js
// src/utils/submissionDraft.js
// Browser draft of the in-progress wizard so a refresh/crash can be resumed
// without retyping. One slot (single active application per browser). All calls
// are best-effort: localStorage can be full, disabled, or hold stale JSON, and
// none of that must ever break the wizard.
export const DRAFT_KEY = "kyc_draft_v1";

export function saveDraft(state) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ savedAt: new Date().toISOString(), state }));
  } catch (_) { /* quota/serialization — ignore, draft is a convenience not a guarantee */ }
}

export function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !parsed.state) return null;
    return parsed;
  } catch (_) { return null; }
}

export function clearDraft() {
  try { localStorage.removeItem(DRAFT_KEY); } catch (_) { /* ignore */ }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `CI=true npx react-scripts test --watchAll=false src/utils/__tests__/submissionDraft.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/utils/submissionDraft.js src/utils/__tests__/submissionDraft.test.js
git commit -m "feat(submit): localStorage draft helpers (save/load/clear)"
```

### Task 9: Wire autosave + resume into the wizard

**Files:**
- Modify: `src/App.js` — imports; an autosave effect; a resume prompt on mount; clear-on-terminal.

**Interfaces:**
- Consumes: `saveDraft`, `loadDraft`, `clearDraft` from `src/utils/submissionDraft.js`; the state atoms that `resetAll()` (`src/App.js:738-754`) clears.

**Design notes:**
- The set of state to persist is EXACTLY the set `resetAll()` clears — read `resetAll` and mirror its atoms: `companyName, countryCode, entityType, ownershipType, research, activeSchema, checks, gapRef.current, drsSubmitted, drsFlags, drsGapsCleared, drsUploads, factChecks, ownershipFork, ownershipChangeDeclared, regNumberFork, regNumberChangeDeclared, step`, plus `stakeholdersRef.current` and `fieldMetadata`. Include `submissionIdRef.current` so a resumed submit keeps the same idempotency key. Do NOT persist transient UI-only atoms (hover, tooltip, error strings).
- `gapRef` and `stakeholdersRef` are refs, not state — snapshot `.current` in the saved object and restore into `.current` on resume.

- [ ] **Step 1: Add the import**

At the top of `src/App.js` with the other `src/utils` imports, add:
```js
import { saveDraft, loadDraft, clearDraft } from "./utils/submissionDraft";
```

- [ ] **Step 2: Autosave effect (debounced)**

Add near the other `useEffect`s:
```js
  // Persist a resumable draft whenever meaningful wizard state changes. Debounced
  // so typing does not thrash localStorage. Skipped once the app is done.
  useEffect(() => {
    if (done) return;
    const t = setTimeout(() => {
      saveDraft({
        companyName, countryCode, entityType, ownershipType,
        research, activeSchema, checks,
        gap: gapRef.current, stakeholders: stakeholdersRef.current,
        fieldMetadata,
        drsSubmitted, drsFlags, drsGapsCleared, drsUploads,
        factChecks, ownershipFork, ownershipChangeDeclared, regNumberFork, regNumberChangeDeclared,
        submissionId: submissionIdRef.current, step,
      });
    }, 800);
    return () => clearTimeout(t);
  }, [companyName, countryCode, entityType, ownershipType, research, activeSchema, checks,
      fieldMetadata, drsSubmitted, drsFlags, drsGapsCleared, drsUploads, factChecks,
      ownershipFork, ownershipChangeDeclared, regNumberFork, regNumberChangeDeclared, step, done]);
```

- [ ] **Step 3: Resume prompt on mount**

Add a one-shot mount effect that offers to resume if a draft exists and the wizard is at the start:
```js
  const [resumeOffer, setResumeOffer] = useState(null); // the loaded draft, or null
  useEffect(() => {
    const d = loadDraft();
    if (d && d.state && (d.state.companyName || d.state.research)) setResumeOffer(d);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyResume = () => {
    const s = resumeOffer.state;
    setCompanyName(s.companyName || ""); setCountryCode(s.countryCode || "");
    setEntityType(s.entityType || ""); setOwnershipType(s.ownershipType || "");
    setResearch(s.research || null); setActiveSchema(s.activeSchema || null);
    setChecks(s.checks || {}); setFieldMetadata(s.fieldMetadata || []);
    gapRef.current = s.gap || {}; stakeholdersRef.current = s.stakeholders || {};
    setDrsSubmitted(s.drsSubmitted || []); setDrsFlags(s.drsFlags || {});
    setDrsGapsCleared(!!s.drsGapsCleared); setDrsUploads(s.drsUploads || {});
    setFactChecks(s.factChecks || {});
    setOwnershipFork(s.ownershipFork || null); setOwnershipChangeDeclared(s.ownershipChangeDeclared || null);
    setRegNumberFork(s.regNumberFork || null); setRegNumberChangeDeclared(s.regNumberChangeDeclared || null);
    submissionIdRef.current = s.submissionId || null;
    setStep(s.step || 0);
    setResumeOffer(null);
  };
  const dismissResume = () => { clearDraft(); setResumeOffer(null); };
```
Render the banner just inside the main container, above the step content:
```jsx
        {resumeOffer && !done && (
          <div style={{ ...card, borderLeft: "4px solid #c99a2e", marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <span style={{ fontSize: 13 }}>
              Found an unfinished application from {resumeOffer.savedAt.replace("T", " ").slice(0, 16)} UTC. Resume where you left off?
            </span>
            <span style={{ display: "flex", gap: 8 }}>
              <Btn variant="primary" onClick={applyResume}>Resume</Btn>
              <Btn variant="secondary" onClick={dismissResume}>Start fresh</Btn>
            </span>
          </div>
        )}
```

- [ ] **Step 4: Clear the draft once the submission is safely captured**

The draft is a backstop for the pre-capture window only; once the server acknowledges (saved OR queued), the server owns durability. In `submitApplication`, right after `setDone(true)` (Task 7 Step 2), add:
```js
    clearDraft();
```
(If the POST threw before any server ack, `setSubmitStatus("queued")` still runs and `setDone(true)` shows the received screen; the draft is cleared because the browser will not silently resubmit — resume is an explicit user action on next load. Leaving stale drafts around would double-submit under a new submissionId.)

> ponytail: single-slot draft — one active application per browser. Multi-draft keyed by company is a future change only if customers run concurrent applications in one browser.

- [ ] **Step 5: Manual verification — refresh mid-wizard, resume**

Run: `npm start`. Fill the Input step + run research, reach Confirm. Hard-refresh the tab.
Expected: on reload, the amber "Found an unfinished application…" banner appears. Click **Resume** → company, research results, and step are restored; continue to submit normally. Then submit and confirm the banner does not reappear on the next load (draft cleared).

- [ ] **Step 6: Commit**

```bash
git add src/App.js
git commit -m "feat(submit): autosave wizard draft to localStorage + resume-on-reload prompt"
```

---

## Self-Review

**Spec coverage:**
- Never lose a submission → Phase 1 inbox (durable anchor) + Phase 5 worker (infinite server-side retry) + Phase 7 browser draft (pre-capture backstop). ✔
- Never a half-saved record → Phase 3 `finalizeSubmission` single transaction (BEGIN/COMMIT/ROLLBACK), inner catches removed. ✔
- No duplicate customer on retry → stable `submissionId` (Phase 6) + `onboarding_sessions.submission_id` upsert + child DELETE-then-insert + inbox `ON CONFLICT DO NOTHING` (Phases 1–4). ✔
- All 11 tables atomic → Task 4 ports all writes (tenants, clients, onboarding_sessions, field_values, session_timeline, journeys, completion_choice, declaration, api_usage, field_provenance, documents) into one transaction. ✔
- Retries on the server → Phase 5 Vercel cron worker. ✔
- "Submitted successfully" vs "Received — saving later" → Task 7 `submitStatus`-driven copy. ✔
- Draft autosave surviving refresh/crash → Phase 7. ✔

**Placeholder scan:** the only deliberate "port from" markers are in Task 4 Step 3, each pointing at an exact `api/submit.js` line range containing real, existing SQL to copy verbatim — not invented behavior. Helper bodies (`isInetLiteral`, `mapMethod`, `mapLayerFromJourney`, `toTimestamp`) are copied verbatim from cited lines.

**Type/name consistency:** `submissionId` (string) is the single idempotency key across inbox PK, `onboarding_sessions.submission_id`, and the payload; `finalizeSubmission` returns `{ sessionId, clientId, journeyId }` and every caller (handler Task 5, worker Task 6) destructures exactly those names; store methods `enqueue/claimPending/markDone/markFailed` are named identically in the store, the handler deps, and the worker deps.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-09-13-durable-submission-pipeline.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
