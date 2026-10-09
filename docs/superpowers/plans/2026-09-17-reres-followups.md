# RERES-2 / RERES-3 Follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the server enforce a link customer's 2-search limit (RERES-2) and close the nine correction-flow rough edges in RERES-3.

**Architecture:** The attempt counters hand back a short-lived signed "research grant"; `/api/research` refuses a customer (link-token) research call without a valid grant and burns it on the main research call. Dossier snapshot + update become one atomic statement. The remaining items are small, behaviour-level fixes in `src/App.js` and the AI-documents page.

**Tech Stack:** Node 24 CommonJS (`api/`, `lib/`), CRA React 18, `node --test`, Jest + Testing Library, Neon Postgres, `lib/storage.js`.

## Global Constraints

- CommonJS in `api/` and `lib/`; every changed handler stays mounted in `src/setupProxy.js`.
- Backend tests: `*.nodetest.js` with `__setDeps` fakes, run by `npm run test:node`. Frontend: Jest render tests on real DOM.
- No new runtime dependency. Inline styles. `src/App.js` hooks never conditional or reordered; gap/stakeholder values stay in refs.
- Never call a real paid API in tests. Constant-time comparison for every signature check (`crypto.timingSafeEqual`).
- No raw error text to clients. Tenant resolution stays 3-strict.
- Never run `git checkout -- <file>` (or any restore) on uncommitted work.

### Owner decisions (binding, 2026-09-17)

1. **RERES-1 is done:** every correction, entity type included, re-runs research (commit cbf5691).
2. **Item 5 - no manual form link:** when research can't run (failure or cap) and the tenant has no `manualFormUrl`, the customer continues on the Applicant page **without prefill** (the wrong company's findings are cleared, their typed applicant details kept). With a `manualFormUrl`, today's picker-with-manual-card fallback stays.
3. **Item 9 - document agents:** for customer research (`isCustomerResearch`), `/api/doc-search` and `/api/self-source` run **only when the customer clicks** a "Find documents automatically" button on the documents step. Analysts (pre-boarding) and plain fresh onboarding keep today's auto-run.

### Scope limit (binding)

The server grant is enforced for **link customers** (a verified `dossier:` token). A fresh customer has no credential (PLAT-7), so the server cannot tell their free first search from a re-search; their count stays advisory. Record this in BACKLOG under RERES-2.

---

### Task 1: Research grants (RERES-2)

**Files:**
- Create: `lib/researchGrant.js`, `lib/__tests__/researchGrant.nodetest.js`
- Modify: `api/search-attempt.js`, `api/research-attempt.js`, `api/research.js` and their node tests; `.env.example`

**Interfaces:**
- `lib/researchGrant.js`:
  - `mint({ subject, tenantId, ttlSeconds = 600 })` → `string` token `base64url(JSON {sub, tid, exp, jti}) + "." + base64url(HMAC-SHA256)`; secret `RESEARCH_GRANT_SECRET`, falling back to `DOSSIER_TOKEN_SECRET`; throws `Error("no_secret")` when neither is set.
  - `verify(token, { subject, tenantId })` → `{ valid: true, payload } | { valid: false, reason }`; reasons `no_secret | malformed | bad_signature | expired | wrong_subject`.
  - `consume(payload)` → `Promise<boolean>`: true the first time a `jti` is burned (storage key `research-grant-used:<jti>`, TTL 900s), false after. `// ponytail:` note that get-then-set is not atomic (bounded: a racing duplicate within one request window).
  - `__setDeps({ storage, now })`.
- `POST /api/search-attempt` allowed → body gains `grant` (subject `dossier:<dossierId>`, tenant = actor tenant). Refused → no grant.
- `POST /api/research-attempt` allowed → body gains `grant` (subject `application:<applicationId>`, `tenantId: ""`). Refused → no grant. (Issued for symmetry; not enforced - see scope limit.)
- A grant mint failure (no secret) on an otherwise allowed attempt → `200 { allowed: false, attemptsUsed, remaining, warning: "grant_unavailable" }` - and the count must NOT be incremented: check the secret is configured BEFORE the increment.
- `POST /api/research`: when `resolveDossierActor(req)` is a **customer**, require header `X-Research-Grant`:
  - verify with `subject: "dossier:" + actor.dossierId`, `tenantId: actor.tenantId`; invalid/missing → `403 { error: "research_grant_required" }` before config read or any spend;
  - `mode: "research"` additionally calls `consume`; already consumed → `403 { error: "research_grant_used" }`;
  - `gap_recovery` / `extract_document` accept a valid unexpired grant whether consumed or not (same run).
  - Analyst and anonymous callers are unchanged. Add `X-Research-Grant` to the CORS allow-headers. Inject the actor resolver and grant module via `__setDeps`.

- [ ] Step 1: Write `lib/__tests__/researchGrant.nodetest.js` covering: mint→verify valid; tampered payload → `bad_signature`; tampered signature → `bad_signature`; garbage → `malformed`; expired (fake `now`) → `expired`; wrong subject or tenant → `wrong_subject`; no secret → mint throws / verify `no_secret`; falls back to `DOSSIER_TOKEN_SECRET`; `consume` true once then false; signature compared with `timingSafeEqual` (length-checked). Run: fails (module missing).
- [ ] Step 2: Implement `lib/researchGrant.js` (node:crypto only, mirror `lib/dossierToken.js` style). Run: pass.
- [ ] Step 3: Extend `api/__tests__/search-attempt.nodetest.js` and `api/__tests__/research-attempt.nodetest.js`: an allowed attempt returns a `grant` that verifies for the right subject; a refused attempt returns none; with no secret configured the attempt is refused with `grant_unavailable` and the counter is unchanged. Implement. Run: pass.
- [ ] Step 4: Extend `api/__tests__/research.nodetest.js`: customer actor without grant → 403 `research_grant_required`, no config read, no fetch; with a grant for another dossier → 403; valid grant → research runs and the grant is consumed; the same grant again on `mode:"research"` → 403 `research_grant_used`; the consumed grant still allows `gap_recovery` and `extract_document`; analyst and anonymous callers need no grant. Implement. Run: pass.
- [ ] Step 5: Document `RESEARCH_GRANT_SECRET` (optional; falls back to `DOSSIER_TOKEN_SECRET`) in `.env.example`. `npm run test:node` → 0 failures. Commit: `feat(security): research requires a one-time grant from the attempt counter for link customers (RERES-2)`.

---

### Task 2: Client carries the grant; spent searches are never wasted (RERES-2 client, RERES-3 items 3, 4, 6, 8)

**Files:** `src/App.js`; tests in `src/components/preboarding/__tests__/CustomerLinkLanding.test.jsx` and/or `src/components/applicant/__tests__/ApplicantPage.render.test.jsx`.

**Required behaviour:**
- **Grant plumbing:** `consumeCustomerSearch` stores `data.grant` in a ref (e.g. `researchGrantRef`) when allowed. Every `/api/research` request from `doResearch` / `extractFromDoc` sends `X-Research-Grant` when the ref holds one (via `researchHeaders()`). The grant belongs to one run: it is kept across that run's research, gap-recovery and extraction calls, and cleared when a new search is paid for, on `resetAll`, and when the run finishes.
- **Item 6:** `applyCorrections` uses an already-paid, unused grant (`searchGrantRef.current` true and a stored grant) instead of consuming another search.
- **Item 3:** a customer who paid for card A on the picker is not asked the dev paid-call confirm again when research starts from the documents step (pass the "confirmed" state through `proceedFromDocuments` → `doResearch({ confirmed: true })` while the grant is unused).
- **Item 4:** when `proceedFromJourney` or `proceedFromDocuments` refuses because no searches are left (server `allowed:false` or the client cap), post the same re-research failure flag as the correction path (`postReresearchFailureFlag` with `stage: "search_cap"`, `reason: "no_searches_left"`, `submissionId: dossierId || onboardingSubmissionId`).
- **Item 8:** `applyResume` must not overwrite a link landing's server-loaded state: when `landedViaLink && dossierId` is already set, keep the current `dossierId` and `searchAttempts` instead of the draft's.

**Tests (render):**
- link customer correction: the `/api/research` request carries `X-Research-Grant` equal to the grant the mocked `/api/search-attempt` returned;
- card A paid → back → correction: `/api/search-attempt` called once, `/api/research` still carries the grant;
- picker cap refusal posts one `/api/change-events` body with `fieldId: "reresearch.fallback"` and `afterValue.stage === "search_cap"`;
- resume on a link landing keeps the server count (mock `customer_searches: 1`, draft `searchAttempts: 0` → the picker shows the 1-used state or equivalent observable);
- the card A double-confirm: `window.confirm` called exactly once for picker card A → documents → Continue (localhost harness).

Commit: `fix(reresearch): carry the research grant; never waste or double-confirm a paid search; flag picker cap refusals; resume keeps link state`.

---

### Task 3: Atomic snapshot + update (RERES-3 items 1, 2)

**Files:** `api/save-dossier.js`, `api/__tests__/save-dossier.nodetest.js`.

**Required behaviour:**
- Replace the separate snapshot INSERT and dossier UPDATE with ONE statement: `WITH snap AS (INSERT INTO entity_dossier_versions (...) SELECT ... FROM entity_dossiers d WHERE <same id/tenant/ownership re-check> RETURNING version) UPDATE entity_dossiers SET ... WHERE <same> RETURNING id`. All bound values, the CASE columns, the ownership re-check and the 0-row → 403/404 handling stay identical.
- On a unique violation (`err.code === "23505"` on the versions constraint) retry the statement once (a concurrent save took the version number). A second violation → `200 { success: false, dossierId: null, warning: "save_conflict" }`.
- Update the test fake to classify the combined statement (e.g. kind `"snapshot_update"`, detected by `WITH` + `entity_dossier_versions` + `UPDATE entity_dossiers`) and update every exact `sql.kinds()` array that contained `"snapshot","update"`. Add tests: one statement per update; the statement contains both the versions insert and the update with the same re-check; a 23505 on the first attempt retries and succeeds; two 23505s → `save_conflict`.
- Verify against the dev DB with `EXPLAIN` on the combined statement (plans without executing; print only "ok").

Commit: `fix(dossier): snapshot and update in one statement; retry a version collision once (RERES-3)`.

---

### Task 4: Correction log after save; no-manual-form fallback; documents on click (RERES-3 items 5, 7, 9)

**Files:** `src/App.js`, `src/components/aiDocuments/AIDocumentsPage.jsx`, tests (applicant, CustomerLinkLanding, AIDocumentsPage render tests).

**Required behaviour:**
- **Item 7:** for a dossier customer the correction `change_event` is posted only after the deferred save succeeds (carry the pending event in `pendingCorrectionSave` and post it in the effect's success branch). A fresh customer (no dossier, nothing to save) still posts right after research succeeds. A failed save posts nothing.
- **Item 5:** `fallBackToManual` checks `manualFormUrl_`. With a URL → unchanged. Without → stay on the Applicant step (no picker), close the gate, clear the wrong company's findings (`research.found` → `[]`, `checks` → `{}`, `coverage` → null, stakeholder state reset) while keeping `gapRef`, and show: `"We couldn't look up your company automatically. Please continue and fill in your application below."` The failure flag is still posted.
- **Item 9:** the auto-run effect that calls `runRealDocSearch()` / `runRealSelfSource()` on entering the documents step skips when `isCustomerResearch` (and not demo/test mode, which keeps its dummy results). `AIDocumentsPage` renders a visible **"Find documents automatically"** button for that case which calls both runners once (disabled while loading, hidden after results exist). Analysts and fresh onboarding keep auto-run. Wire the new prop(s) from `App.js`.

**Tests:**
- dossier customer correction with a failing save posts no `foundational_facts.correction` event; a successful save posts exactly one, after the `/api/save-dossier` call;
- a failed correction search on a tenant with no manual form link keeps the customer on the Applicant page with the message, no `/api/research` findings shown, typed email kept;
- link customer on the documents step: no `/api/doc-search` / `/api/self-source` call until the button is clicked; clicking calls each once; an analyst (pre-boarding) still auto-runs.

Commit: `fix(reresearch): log corrections after they save; no-manual-form fallback keeps the customer on the page; customers start document search themselves (RERES-3)`.

---

### Task 5: Verification and backlog

- [ ] `npm run test:node`, full `CI=true npx react-scripts test --watchAll=false` (re-run known-flaky suites in isolation), `CI=true npm run build` - all pass.
- [ ] `docs/BACKLOG.md`: mark RERES-2 and RERES-3 DONE with a one-line resolution each; add under RERES-2 that fresh-customer counts stay advisory until PLAT-7; note `RESEARCH_GRANT_SECRET` (optional) next to DEP-3.
- [ ] Commit: `docs: RERES-2 and RERES-3 done`.
