# Part 4 - Pre-boarding Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the small pre-boarding leftovers from the 2026-09-13 audit: analyst resume returns to the dossier, sourced registry documents survive resume, a lost save response can never create a duplicate dossier, the dead `?ref` landing is removed, and the orphan lifecycle tests run.

**Architecture:** Server-side idempotent create via a client-minted `creationKey` (migration 028, partial unique index + `ON CONFLICT`). Client-side: an in-flight guard and a stable creation key in `saveDossier`; the draft carries `selfSourceResults` (File objects stripped by a pure helper) and `applyResume` re-derives the analyst's dossier view. Dead code deleted; the `test:node` glob widened.

**Tech Stack:** Node 24 CommonJS (`api/`), CRA React 18 (`src/`), Neon Postgres, `node --test`, Jest + Testing Library.

## Global Constraints

- **CommonJS in `api/` and `lib/`**; every changed handler stays mounted in `src/setupProxy.js`.
- **Tests:** backend → `*.nodetest.js` with `__setDeps` fakes via `npm run test:node`; frontend → Jest render tests on real DOM. Every node test file must be reachable from the `test:node` glob.
- **Migrations** additive and idempotent (`IF NOT EXISTS`), applied with `node db/apply.js db/migrations/<file>.sql`. Parts 1 and 3 used 026 and 027; this part uses **028**.
- **No new runtime dependency.** Inline styles only. `src/App.js` hooks are never conditional or reordered; gap/stakeholder values stay in refs.
- **Never call a real paid API in tests.** The dev Neon database may be written by migration steps only.
- **Tenant resolution stays 3-strict** (no `"nium"` fallback).

### Refinements over the spec (binding)

1. **Spec item 4's "duplicate `?preboarding` parse" is already gone** (Part 5 reads it once, `src/App.js` pre-boarding redirect effect). Only the `?ref` hydration effect is removed here.
2. **Spec item 5's `src/reresearch/tests` is already wired** (Part 3). Only `dossierLifecycle/__tests__/*.test.js` is added.
3. **Analyst resume re-derives** the dossier view in `applyResume` (`agentType === "preboarding"` && restored `dossierId` && restored step is the journey's confirm step) instead of persisting `showDossierView`.
4. **The creation key is per research run**: minted lazily on the first save of a dossier that has no id, reused by every retry until a save returns an id, and cleared by `resetAll` and whenever a new analyst research run completes.
5. **Duplicate create returns the existing row's id** (`ON CONFLICT (tenant_id, creation_key) WHERE creation_key IS NOT NULL DO UPDATE SET creation_key = EXCLUDED.creation_key RETURNING id`); the second request's content is not written (the analyst's next Update writes it).

---

### Task 1: Idempotent dossier create (migration 028 + `save-dossier`)

**Files:**
- Create: `db/migrations/028_dossier_creation_key.sql`
- Modify: `api/save-dossier.js`, `api/__tests__/save-dossier.nodetest.js`

**Interfaces:**
- Produces:
  - `entity_dossiers.creation_key UUID` + unique partial index `entity_dossiers_tenant_creation_key_uidx ON (tenant_id, creation_key) WHERE creation_key IS NOT NULL`.
  - `POST /api/save-dossier` accepts optional body `creationKey` (UUID string). On the INSERT branch it is stored; a repeat INSERT with the same `(tenant, creationKey)` returns the existing row's id instead of creating a second row. A non-UUID value is ignored (bound as `null`). The UPDATE branch ignores it.

- [ ] **Step 1: Write the migration**

Create `db/migrations/028_dossier_creation_key.sql`:

```sql
-- 028_dossier_creation_key.sql
-- Part 4: idempotent dossier creation. The analyst's browser mints one key per
-- research run and sends it with the first save; a retried create (the first
-- response was lost) finds the same key and gets the existing dossier back
-- instead of inserting a duplicate. Additive and idempotent.
ALTER TABLE entity_dossiers
  ADD COLUMN IF NOT EXISTS creation_key UUID;

CREATE UNIQUE INDEX IF NOT EXISTS entity_dossiers_tenant_creation_key_uidx
  ON entity_dossiers (tenant_id, creation_key)
  WHERE creation_key IS NOT NULL;
```

- [ ] **Step 2: Apply to the dev database twice and verify**

Run: `node db/apply.js db/migrations/028_dossier_creation_key.sql` (twice). Expected: both succeed.

Run (prints metadata only, never secrets):

```bash
node -e '
require("dotenv").config({ path: ".env.local" });
const { neon } = require("@neondatabase/serverless");
const sql = neon(process.env.DATABASE_URL);
(async () => {
  console.log(await sql`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = ${"entity_dossiers"} AND column_name = ${"creation_key"}`);
  console.log(await sql`SELECT indexdef FROM pg_indexes WHERE indexname = ${"entity_dossiers_tenant_creation_key_uidx"}`);
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
'
```

Expected: `creation_key uuid`; an index definition containing `WHERE (creation_key IS NOT NULL)`.

- [ ] **Step 3: Write the failing tests**

In `api/__tests__/save-dossier.nodetest.js`, make the `insert` branch of `fakeSql` record `text` if it does not already (`log.push({ kind: "insert", text, values })`), then append:

```js
test("a first save stores a valid creationKey and conflicts on (tenant, creation_key) instead of duplicating", async () => {
  const sql = fakeSql({ insertId: "d-new" });
  handler.__setDeps({ neon: () => sql, access: accessWith(ANALYST) });
  const key = "3f2b8a4e-9c1d-4e6f-8a2b-7c9d0e1f2a3b";
  const res = fakeRes();
  await handler(req({ ...base, creationKey: key }), res);
  assert.deepStrictEqual(res.body, { success: true, dossierId: "d-new" });
  const insert = sql.log.find((l) => l.kind === "insert");
  assert.match(insert.text, /creation_key/);
  assert.match(insert.text, /ON CONFLICT\s*\(\s*tenant_id\s*,\s*creation_key\s*\)\s*WHERE\s+creation_key\s+IS\s+NOT\s+NULL/i);
  assert.match(insert.text, /RETURNING id/i);
  assert.ok(insert.values.includes(key));
});

test("a non-UUID creationKey is ignored (bound as null)", async () => {
  for (const creationKey of ["not-a-uuid", 42, "x".repeat(40)]) {
    const sql = fakeSql({ insertId: "d-new" });
    handler.__setDeps({ neon: () => sql, access: accessWith(ANALYST) });
    await handler(req({ ...base, creationKey }), fakeRes());
    const insert = sql.log.find((l) => l.kind === "insert");
    assert.ok(!insert.values.includes(creationKey));
    assert.ok(insert.values.includes(null));
  }
});

test("an update never touches creation_key", async () => {
  const sql = fakeSql({ lookupRow: { id: "d-1", tenant_id: "acme", owned_by: "analyst" } });
  handler.__setDeps({ neon: () => sql, access: accessWith(ANALYST) });
  await handler(req({ ...base, dossierId: "d-1", creationKey: "3f2b8a4e-9c1d-4e6f-8a2b-7c9d0e1f2a3b" }), fakeRes());
  const update = sql.log.find((l) => l.kind === "update");
  assert.doesNotMatch(update.text, /creation_key/);
});
```

Run: `node --test api/__tests__/save-dossier.nodetest.js`
Expected: FAIL - no `creation_key` in the INSERT.

- [ ] **Step 4: Implement in `api/save-dossier.js`**

1. Add `creationKey,` to the body destructuring.
2. After the `seededByValue` line add:

```js
  // One key per analyst research run (Part 4): a retried first save with the
  // same key returns the existing dossier instead of inserting a duplicate.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const creationKeyValue = typeof creationKey === "string" && UUID_RE.test(creationKey) ? creationKey.toLowerCase() : null;
```

3. In the INSERT column list add `creation_key,` after `seeded_by,`; in VALUES add `${creationKeyValue},` after `${seededByValue},`.
4. Replace the INSERT's `RETURNING id` with:

```sql
      ON CONFLICT (tenant_id, creation_key) WHERE creation_key IS NOT NULL
      DO UPDATE SET creation_key = EXCLUDED.creation_key
      RETURNING id
```

(The no-op `DO UPDATE` is what makes `RETURNING id` return the existing row.)

- [ ] **Step 5: Run the tests and verify the SQL against the dev database**

Run: `node --test api/__tests__/save-dossier.nodetest.js` and `npm run test:node`. Expected: PASS, 0 failures.

Run (EXPLAIN only - plans the statement without executing it):

```bash
node -e '
require("dotenv").config({ path: ".env.local" });
const { neon } = require("@neondatabase/serverless");
const sql = neon(process.env.DATABASE_URL);
(async () => {
  const rows = await sql`EXPLAIN INSERT INTO entity_dossiers (tenant_id, company_name, creation_key, status, saved_at)
    VALUES (${"nium"}, ${"Explain Check Ltd"}, ${"3f2b8a4e-9c1d-4e6f-8a2b-7c9d0e1f2a3b"}, ${"ready"}, NOW())
    ON CONFLICT (tenant_id, creation_key) WHERE creation_key IS NOT NULL
    DO UPDATE SET creation_key = EXCLUDED.creation_key
    RETURNING id`;
  console.log("ok, plan lines:", rows.length);
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
'
```

Expected: `ok, plan lines: <n>` (no error about a missing unique constraint).

- [ ] **Step 6: Commit**

```bash
git add db/migrations/028_dossier_creation_key.sql api/save-dossier.js api/__tests__/save-dossier.nodetest.js
git commit -m "feat(dossier): idempotent first save via a per-run creation key (migration 028)"
```

---

### Task 2: `saveDossier` in-flight guard and stable creation key

**Files:**
- Modify: `src/App.js` (`saveDossier`, `buildDossierPayload`, `resetAll`, analyst research completion in `doResearch` / `doDummyResearch`)
- Modify: `src/components/preboarding/__tests__/Preboarding.render.test.jsx`

**Interfaces:**
- Consumes: Task 1 `creationKey` body field.
- Produces: `saveDossier` returns the same in-flight promise to concurrent callers; the payload carries `creationKey` only when there is no `dossierId`.

- [ ] **Step 1: Write the failing render tests**

Append to `src/components/preboarding/__tests__/Preboarding.render.test.jsx`:

```jsx
describe("dossier creation is idempotent", () => {
  const saveBodies = () =>
    global.fetch.mock.calls
      .filter(([url]) => String(url).includes("/api/save-dossier"))
      .map(([, init]) => JSON.parse(init.body));

  it("a retried first save re-sends the SAME creation key", async () => {
    let attempt = 0;
    fetchRoutes["/api/save-dossier"] = () => {
      attempt += 1;
      return attempt === 1
        ? Promise.reject(new Error("network lost after insert"))
        : Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ success: true, dossierId: "d-1" }) });
    };
    await driveToDossier();
    fireEvent.click(buttonsWithText(/Retry save/i)[0]);
    await settle(0);

    const bodies = saveBodies();
    expect(bodies.length).toBe(2);
    expect(bodies[0].creationKey).toMatch(/^[0-9a-f-]{36}$/i);
    expect(bodies[1].creationKey).toBe(bodies[0].creationKey);
    expect(bodies[0].dossierId).toBeFalsy();
  });

  it("a save of an existing dossier sends no creation key", async () => {
    fetchRoutes["/api/save-dossier"] = () =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ success: true, dossierId: "d-1" }) });
    await driveToDossier();
    fireEvent.click(buttonsWithText(/^Update$/)[0]);
    await settle(0);

    const bodies = saveBodies();
    expect(bodies.length).toBeGreaterThanOrEqual(2);
    const last = bodies[bodies.length - 1];
    expect(last.dossierId).toBe("d-1");
    expect(last).not.toHaveProperty("creationKey");
  });

  it("concurrent saves while one is in flight make only one request", async () => {
    let resolveSave;
    fetchRoutes["/api/save-dossier"] = () =>
      new Promise((resolve) => {
        resolveSave = () => resolve({ ok: true, status: 200, json: () => Promise.resolve({ success: true, dossierId: "d-1" }) });
      });
    await driveToDossier(); // the auto-save is now in flight and unresolved
    expect(saveBodies().length).toBe(1);
    // A second trigger while in flight (e.g. the Retry/Save control) must not POST again.
    const retry = buttonsWithText(/Save Dossier|Retry save/i)[0];
    if (retry) fireEvent.click(retry);
    await settle(0);
    expect(saveBodies().length).toBe(1);
    await act(async () => { resolveSave(); });
    await settle(0);
  });
});
```

If `driveToDossier` shows the dossier view only after the save resolves (so no save control is clickable during flight in the third test), read how `saveDossier` sets `setShowDossierView` and adjust ONLY the third test to call the save trigger that exists in that state; keep the "exactly one request while in flight" assertion.

Run: `CI=true npx react-scripts test --watchAll=false src/components/preboarding/__tests__/Preboarding.render.test.jsx`
Expected: FAIL - no `creationKey`; second concurrent call posts.

- [ ] **Step 2: Implement in `src/App.js`**

1. Next to the other refs near `saveDossier`'s related state (e.g. after `const [dossierSaveError, setDossierSaveError] = useState("");`), add:

```js
  // Part 4: one creation key per analyst research run, re-sent by every retry of
  // the FIRST save so a lost response can never insert a duplicate dossier; and
  // the in-flight save promise, shared by concurrent callers.
  const creationKeyRef = useRef(null);
  const saveInFlightRef = useRef(null);
```

2. In `buildDossierPayload`'s returned object, directly after `dossierId,` add:

```js
      // Only a create carries the key; an update is keyed by dossierId.
      ...(dossierId ? {} : { creationKey: creationKeyRef.current || (creationKeyRef.current = genUUID()) }),
```

3. Wrap `saveDossier`: rename the existing `const saveDossier = async ({ reason } = {}) => { ... };` body to `const runSaveDossier = async ({ reason } = {}) => { ... };` (unchanged body), and add directly after it:

```js
  const saveDossier = (options) => {
    if (saveInFlightRef.current) return saveInFlightRef.current;
    const p = runSaveDossier(options).finally(() => { saveInFlightRef.current = null; });
    saveInFlightRef.current = p;
    return p;
  };
```

4. In `runSaveDossier`, where a successful save sets `setDossierId(result.dossierId)`, add `creationKeyRef.current = null;` on the next line.
5. In `resetAll`, add `creationKeyRef.current = null;` next to `setDossierId` handling.
6. Where a NEW analyst research run completes and replaces `research` (in `doResearch`'s success block and `doDummyResearch`'s success block, next to `setOnboardingSubmissionId(genUUID())`), add `if (!dossierId) creationKeyRef.current = null;`.

Confirm `genUUID` is already in scope in `App.js` (it is used for `onboardingSubmissionId`).

- [ ] **Step 3: Run the tests**

Run: `CI=true npx react-scripts test --watchAll=false src/components/preboarding src/components/applicant`
Expected: PASS.

Run: `CI=true npx react-scripts test --watchAll=false` (re-run known-flaky `PolicySimulator.test.jsx`, `appMounts.test.jsx`, `noTenantLanding.integration.test.jsx` in isolation before calling a failure a regression) and `CI=true npm run build`.
Expected: PASS; `Compiled successfully.`

- [ ] **Step 4: Commit**

```bash
git add src/App.js src/components/preboarding/__tests__/Preboarding.render.test.jsx
git commit -m "fix(preboarding): a retried or concurrent first save can never create a duplicate dossier"
```

---

### Task 3: Analyst resume returns to the dossier with its sourced documents

**Files:**
- Modify: `src/utils/submissionDraft.js`, `src/utils/__tests__/submissionDraft.test.js`
- Modify: `src/App.js` (draft save effect, `applyResume`)
- Modify: `src/components/preboarding/__tests__/Preboarding.render.test.jsx`

**Interfaces:**
- Produces:
  - `draftableSelfSourceResults(selfSourceResults)` in `src/utils/submissionDraft.js` → a JSON-safe copy with every `results[].manualUploadFile` removed (`null` in → `null` out).
  - The draft saves `selfSourceResults` (via the helper) and `applyResume` restores it.
  - `applyResume` sets `showDossierView(true)` when `agentType === "preboarding"`, the draft has a `dossierId`, and the restored step equals `stepsFor(journeyType || "ai_only").confirm`.

- [ ] **Step 1: Write the failing tests**

Append to `src/utils/__tests__/submissionDraft.test.js`:

```js
import { draftableSelfSourceResults } from "../submissionDraft";

test("draftableSelfSourceResults drops File objects and keeps everything else", () => {
  expect(draftableSelfSourceResults(null)).toBeNull();
  const input = {
    summary: { retrieved: 1 },
    results: [
      { requirement: "Certificate", status: "retrieved", sourceUrl: "https://x", manualUploadFile: new Blob(["x"]) },
      { requirement: "Register extract", status: "manually_uploaded", manualUploadName: "extract.pdf" },
    ],
  };
  const out = draftableSelfSourceResults(input);
  expect(out.summary).toEqual({ retrieved: 1 });
  expect(out.results[0]).toEqual({ requirement: "Certificate", status: "retrieved", sourceUrl: "https://x" });
  expect(out.results[1]).toEqual({ requirement: "Register extract", status: "manually_uploaded", manualUploadName: "extract.pdf" });
  expect(input.results[0].manualUploadFile).toBeDefined(); // the live state is not mutated
  expect(() => JSON.stringify(out)).not.toThrow();
});
```

Append to `src/components/preboarding/__tests__/Preboarding.render.test.jsx`:

```jsx
describe("analyst resume", () => {
  it("resuming a saved dossier returns the analyst to the dossier view with its registry documents", async () => {
    fetchRoutes["/api/save-dossier"] = () =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ success: true, dossierId: "d-1" }) });
    await driveToDossier();
    // Seed a registry document into the live draft the way the Documents step would,
    // by writing the draft directly (the analyst journey has no self-source step in the dummy path).
    await settle(1000); // let the debounced draft save run
    const { DRAFT_KEY } = require("../../../utils/submissionDraft");
    const draft = JSON.parse(localStorage.getItem(DRAFT_KEY));
    expect(draft && draft.state && draft.state.dossierId).toBe("d-1");
    draft.state.selfSourceResults = {
      results: [{ requirement: "Certificate of Incorporation", localEquivalent: "Companies House certificate", status: "retrieved", retrievedAt: "2026-09-16T10:00:00Z" }],
    };
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));

    cleanup();
    await mountAtGate();
    await unlock();
    fireEvent.click(buttonsWithText(/^Resume$/)[0]);
    await settle(0);

    expect(bodyText()).toMatch(/Documents Sourced/);
    expect(bodyText()).toMatch(/Companies House certificate/);
    expect(bodyText()).not.toMatch(/Company Lookup/);
  });
});
```

Add `cleanup` to the `@testing-library/react` import at the top of the file if it is not already imported. If the resume banner is only rendered on a surface the gate hides, read `src/App.js` around the `resumeOffer &&` render and drive to it the way the real analyst would (gate unlock first); keep the three final assertions.

Run: `CI=true npx react-scripts test --watchAll=false src/utils/__tests__/submissionDraft.test.js src/components/preboarding/__tests__/Preboarding.render.test.jsx`
Expected: FAIL - helper missing; resume lands on the lookup page without registry documents.

- [ ] **Step 2: Implement**

In `src/utils/submissionDraft.js` append:

```js
// Registry self-source results can hold browser File objects (a manually
// uploaded registry document) that cannot survive JSON. Keep everything else so
// the dossier's "Documents Sourced" list survives a resume.
export function draftableSelfSourceResults(selfSourceResults) {
  if (!selfSourceResults || typeof selfSourceResults !== "object") return null;
  const results = Array.isArray(selfSourceResults.results)
    ? selfSourceResults.results.map((item) => {
        if (!item || typeof item !== "object") return item;
        const { manualUploadFile, ...rest } = item;
        return rest;
      })
    : selfSourceResults.results;
  return { ...selfSourceResults, results };
}
```

In `src/App.js`:

1. Import it: change `import { saveDraft, loadDraft, clearDraft } from "./utils/submissionDraft";` to `import { saveDraft, loadDraft, clearDraft, draftableSelfSourceResults } from "./utils/submissionDraft";`.
2. In the draft-save effect's `saveDraft({ ... })` object, add `selfSourceResults: draftableSelfSourceResults(selfSourceResults),` next to `docSearchResults,`, and add `selfSourceResults` to that effect's dependency array next to `docSearchResults`.
3. Update the KEEP IN SYNC comment above the effect: remove any claim that self-source results are not saved, and mention that File objects are stripped by `draftableSelfSourceResults`.
4. In `applyResume`, next to `setDocSearchResults(s.docSearchResults || null);` add `setSelfSourceResults(s.selfSourceResults || null);`, and directly before `setStep(s.step || 0);` add:

```js
    // An analyst who saved a dossier and refreshed returns to the dossier view,
    // not the confirm step behind it (re-derived; the flag itself is not saved).
    if (agentType === "preboarding" && s.dossierId && s.step === stepsFor(s.journeyType || "ai_only").confirm) {
      setShowDossierView(true);
    }
```

- [ ] **Step 3: Run the tests**

Run: `CI=true npx react-scripts test --watchAll=false src/utils src/components/preboarding src/components/applicant src/components/aiDocuments`
Expected: PASS.

Run: full `CI=true npx react-scripts test --watchAll=false` and `CI=true npm run build`.
Expected: PASS; `Compiled successfully.`

- [ ] **Step 4: Commit**

```bash
git add src/utils/submissionDraft.js src/utils/__tests__/submissionDraft.test.js src/App.js src/components/preboarding/__tests__/Preboarding.render.test.jsx
git commit -m "feat(preboarding): resume returns the analyst to the dossier with its sourced registry documents"
```

---

### Task 4: Remove the dead `?ref` landing; run the lifecycle tests

**Files:**
- Modify: `src/App.js`
- Modify: `package.json`

**Interfaces:** none.

- [ ] **Step 1: Confirm nothing writes the snapshot**

Use the Grep tool for `nium_invite_` across the repository (excluding `node_modules`, `build`). Expected: only the read in `src/App.js`'s `?ref` hydration effect. If anything else writes it, stop and report NEEDS_CONTEXT.

- [ ] **Step 2: Delete the effect**

In `src/App.js` delete, as one block, the comment starting `// Customer invite landing. When the app is opened via an invite link` through the end of that `useEffect` (the `}, []);` after `trackEvent("invite_link_opened", { token: ref, ... })`), including `const inviteHydratedRef = useRef(false);`. This removes one unconditional `useRef` and one unconditional `useEffect` together - acceptable because hook order stays consistent across renders.

Then update comments that describe the removed path:
- The `landedViaLink` state comment ("…invite link (?dossierId&journey=customer or ?ref)…", "…the ?ref hydration effect…") → describe the token link only.
- The dossier-backed landing comment ("…(unlike the localStorage `?ref` path)…") → drop the comparison.

Use the Grep tool for `?ref` and `inviteHydratedRef` in `src/App.js` afterwards. Expected: no code matches.

- [ ] **Step 3: Wire the lifecycle tests**

Run first: `node --test dossierLifecycle/__tests__/*.test.js` - expected PASS (36 tests). If it fails, stop and report.

In `package.json` change `test:node` to:

```json
"test:node": "node --test lib/__tests__/*.nodetest.js api/__tests__/*.nodetest.js src/reresearch/tests/*.nodetest.js dossierLifecycle/__tests__/*.test.js",
```

- [ ] **Step 4: Run everything**

Run: `npm run test:node` (expected: previous count + 36, 0 failures), full `CI=true npx react-scripts test --watchAll=false`, `CI=true npm run build`.
Expected: PASS; `Compiled successfully.`

- [ ] **Step 5: Commit**

```bash
git add src/App.js package.json
git commit -m "chore(preboarding): remove the dead ?ref invite landing; run dossier lifecycle tests in test:node"
```

---

### Task 5: Verification and backlog

**Files:**
- Modify: `docs/BACKLOG.md`

- [ ] **Step 1: Full verification**

Run: `npm run test:node`, `CI=true npx react-scripts test --watchAll=false`, `CI=true npm run build`. Expected: all pass.

- [ ] **Step 2: Backlog**

Add under **Open dependencies** after DEP-5:

```markdown
### DEP-6 - Part 4 deploy gate: migration 028
- **Category:** Deploy · **Priority:** P1 · **Status:** OPEN (manual step for the owner)
- **What:** Apply `db/migrations/028_dossier_creation_key.sql` to each database (`node db/apply.js db/migrations/028_dossier_creation_key.sql`) BEFORE deploying Part 4.
- **Why:** The dossier INSERT writes `creation_key` and uses `ON CONFLICT (tenant_id, creation_key)`; without the column and unique index every first save fails.
```

- [ ] **Step 3: Commit**

```bash
git add docs/BACKLOG.md
git commit -m "docs: Part 4 deploy gate (migration 028)"
```

---

## Manual QA checklist (owner)

1. Analyst: research, let the dossier auto-save, refresh the tab, unlock, Resume → you land on the dossier (not the lookup), with its sourced documents listed.
2. Analyst: with dev tools set offline, click Save Dossier (fails), go back online, Retry save → exactly one dossier row in Neon.
3. An old `/?ref=...` URL just opens the normal flow.
