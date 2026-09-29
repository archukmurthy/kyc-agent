# ⭐ RESUME HERE (current state — read this first)

**As of 2026-09-14. Repo: `E:\kyc-agent-dev` (Windows). Remote: `kyc-agent-remote` (github.com/ManasBorole/kyc-agent-remote). Working branch: `dev/local-work`. Default: `main`.**

**Local HEAD:** `b4aa989` — *fix(preboarding): surface silent dossier-save failure…*. `context.md` (this file) is currently untracked.

**What just shipped to `main` (all reviewed, merged via PRs):**
- **Durable submission pipeline** (PRs #1, #2) — inbox + atomic 11-table transaction + cron retry worker + stable submissionId + saved/queued UX + localStorage draft/resume + attempts-on-start/dead-letter hardening. See §6.
- **Preboarding Phase 1** (PR #3, commits `f70afbd`, `9990629`, `b4aa989`) — fixed the dead invite link (email now carries the working DB-backed `?dossierId=` link, validated) and the silent dossier-save failure (retry banner + gated invite). See §4.2 / §13.

**⚠️ OUTSTANDING PROD GATES (not code — a human must do these; the deploy isn't safe/functional until then):**
1. Apply migrations **024 + 025** to the **prod** Neon DB (`node db/apply.js db/migrations/024_submission_inbox.sql` then `025_…`, with `DATABASE_URL`=prod). Live submits error without them.
2. Set **`CRON_SECRET`** in Vercel (Production) — `/api/finalize-submissions` is publicly runnable until set — then redeploy.
3. **Browser QA** the submit flow (saved vs "Retry Submission") + the resume banner. These were the exact seams that hid two Criticals we found.

**▶️ NEXT WORK — Preboarding Phase 2 (security), PAUSED ON A USER DECISION.** User already chose: server-checked shared password for the analyst (per-analyst accounts → backlog) + signed/expiring/revocable token for the customer dossier link. **The open question I asked and am waiting on:** how to auth the endpoints that BOTH the analyst and the customer self-serve flow call (`save-dossier`/`search-attempt`/`dossier-reseed`) — full revised model (token-first, dual-credential) vs a simpler first cut. Full design + the auth/crypto scout findings are in **§17**. Start there. Re-read `docs/preboarding-audit-2026-09-13.md` and `.superpowers/sdd/progress.md`.

**To resume:** read this file top-to-bottom, then `.superpowers/sdd/progress.md` (the task ledger) and `docs/preboarding-audit-2026-09-13.md`. Then confirm the Phase-2 decision with the user and build task-by-task with reviews (§14).

---

# Project Context & Handoff — KYC Onboarding Agent (Nium)

> **Purpose of this file:** complete transfer of project + working-relationship knowledge from one Claude session to another. Assume the reader knows nothing about this project. Written 2026-09-14.
>
> **Confidence tags used throughout:**
> - **[FACT]** — confirmed by reading the code/DB this session or in `CLAUDE.md`.
> - **[CONVENTION]** — a way-of-working the user and I established.
> - **[IMPL]** — current implementation detail (true now, may change).
> - **[KNOWN-ISSUE]** — a real bug / gap / debt.
> - **[VERIFY]** — believed true from prior work / memory but not re-read this session; confirm before relying on it.
>
> **Never** put secrets in code/docs. Env vars are referenced by name with `<SECRET>` placeholders.

---

## 1. Overall Project Context

**[FACT]** This is a **KYC (Know Your Customer) onboarding web app for Nium** (a financial/payments company). It's an AI-assisted onboarding wizard: a business customer enters their company, the app uses Claude with web search to research and pre-fill KYC fields, the customer confirms/corrects, fills gaps, optionally verifies identity, and submits. The submission persists to a Postgres database for compliance.

**[FACT] Core domain concept — jurisdiction & licences.** Nium holds regulatory licences in some markets but not others. `LICENSED_MARKETS` in `src/App.js` lists country codes Nium is licensed in (**currently just `"GB"`**). The selected country determines:
1. **Which schema** — `UK_SCHEMA` for licensed UK, `SG_SCHEMA` (Singapore) as the default fallback for everywhere else. `getSchema(code)` / `getApplicableLicence(code)` encode this.
2. **The research prompt** — `buildPrompt(name, country, schema)` injects the schema's `researchFields` (what Claude searches for) and `gapFields` (what the user fills) as a JSON template; Claude returns ONLY JSON matching it.
3. **The rendered form** — `gapFields` grouped by `section` (`applicant`, `nature`, `account`, `bank`, plus a synthetic `corrections` section).
   To add a licensed market: add the country to `LICENSED_MARKETS`, define `XX_SCHEMA`, update `getSchema`/`getApplicableLicence`.

**[FACT] The wizard steps** (labels vary by journey/agentType): **Input (Company) → [Documents] → Research → Applicant → [Verify ID / IDV] → Confirm → Fill Gaps → Required Docs → Declare**. Step index maps are computed in `src/App.js` (~lines 635-648) and depend on whether IDV is enabled and the journey type.

**[FACT] Two agent modes** (`agentType` state):
- `"onboarding"` — the normal customer flow (default).
- `"preboarding"` — an **analyst** flow: an internal analyst researches a company, builds a "dossier", and sends the customer an invite link that pre-fills onboarding. Entered via URL `?preboarding=1`.

**[FACT] Journey types** (`journeyType`): `"ai_only"` (AI research only) and `"ai_documents"` (AI + uploaded documents). There's also a Nium-API lookup path (`nium_api`).

**[FACT] Tech stack:**
- Frontend: **Create React App (react-scripts 5)**, React 18. The **entire frontend is one file: `src/App.js`** (~5,400 lines, the `KYCAgent` component) plus a growing set of extracted components under `src/components/**`, `src/idv-match/**`, `src/policySimulator/**`. No router, no CSS files — **inline styles only**. `src/index.js` just mounts `App`.
- Backend: **Vercel serverless functions**, one file per route under `api/*.js`. **CommonJS** (`module.exports`/`require`) so `src/setupProxy.js` can `require()` them for local dev.
- DB: **Neon Postgres** via `@neondatabase/serverless`.
- AI: **Anthropic Claude** (`claude-sonnet-4-5` with the `web_search_20250305` tool) via `api/research.js`.
- Deploy: **Vercel** (auto-deploy on push to `main`).

**[FACT] Local dev is single-process:** `npm start` runs the CRA dev server, and `src/setupProxy.js` mounts all `/api/*` routes with the same handlers Vercel uses — so the full app (frontend + backend) works under `npm start` alone. No `vercel dev` needed. `setupProxy.js` manually JSON-parses bodies for POST routes because the CRA dev server doesn't auto-parse.

---

## 2. Multi-Tenancy (important, pervasive)

**[FACT]** Every tenant has fully isolated config in KV (or a dev filesystem store via `lib/storage.js`). Active tenant resolved per request, priority:
1. `?tenant=` URL query (browser) / `req.query.tenant` (server)
2. `x-tenant-id` header
3. `TENANT_ID` env var
4. **historically** fell back to `"nium"` — **but this was removed** (see below).

**[FACT] 3-strict tenant resolution (a change we shipped earlier, per the SDD ledger):** the bare URL with no `?tenant=` now shows a `NoTenantLanding` screen; every tenant **including Nium** needs `?tenant=<id>`. Client `getTenantId()` returns `""` (no nium/env default); `api/config` and `api/get-dossier` return `400 tenant_required` on empty tenant. Do **not** reintroduce a hardcoded `"nium"` fallback in resolution logic.

**[FACT] URLs:**
| | Customer flow | Admin |
|---|---|---|
| Primary (Nium) | `/?tenant=nium` | `/admin?tenant=nium` |
| Any tenant | `/?tenant={id}` | `/admin?tenant={id}` |
| Preview | `/?tenant={id}&preview=true` (amber "Preview Mode" banner) | |
| Preboarding | `/?preboarding=1` (analyst) | |

**[FACT] Nium protection:** the Nium config is the only one that auto-seeds from `lib/seedConfig.js#buildDefaultConfig`; every other tenant seeds blank via `buildBlankConfig`. `POST /api/config?tenant=nium` refuses publishes with zero licences or zero active entity types. Reads of the Nium config self-heal (re-seed if licences missing).

**[FACT] Admin vs Super Admin:**
- **Admin** (`/admin`) — per-tenant config editor. Auth via `ADMIN_PASSWORD` (`api/admin-auth.js`, `api/config.js#authorizeAdmin`). `ADMIN_PASSWORD` is shared across tenants for now (per-tenant passwords are future work).
- **Super Admin** (`/super-admin`) — cross-tenant management (create tenants, etc.). Auth via `SUPER_ADMIN_PASSWORD` (`api/super-admin-auth.js`, `api/tenants.js#requireSuperAdmin`).
- **[FACT] Auth pattern (both):** shared-password → the password itself becomes a **Bearer token**. Client sends `Authorization: Bearer <password>`; server does a plain string compare against the env var (`requireSuperAdmin` in `api/tenants.js:42-55` is the canonical shape). **No sessions, no JWT.** Each endpoint hand-rolls the 6-line Bearer-parse-and-compare (there is **no** shared `lib/requireAuth.js` — though we're about to add `lib/auth.js`, see §17 Phase 2). Note: existing checks use `===`, **not** `crypto.timingSafeEqual` — new security-sensitive checks should prefer `timingSafeEqual` (the team already uses it in `lib/didit/webhookSignature.js`).

---

## 3. The Two Databases

**[FACT]** There are **two Neon databases**, addressed by two env vars:
- **`DATABASE_URL`** — the main app DB (`neondb`). Holds tenants, clients, onboarding_sessions, field_values, the journey model tables, entity_dossiers, submission_inbox, etc.
- **`IDV_DATABASE_URL`** — a **separate `idv` database** for the identity-verification subsystem (Vault, attempts, decisions, media, screening, outbox). **[VERIFY]** Created via SQL, so the Neon web console can't list it — use `IDV_DATABASE_URL` from a desktop client (TablePlus/DBeaver/psql) to browse it.

**[FACT] Neon quirk that bit us before:** data is per **branch**. The dev data lived on a branch with compute endpoint `ep-snowy-cherry-abf2ntrs` (eu-west-2), not `main`/production. If "the data isn't showing" in the Neon console, check the branch dropdown first.

**[FACT] Migrations** live in `db/migrations/NNN_name.sql`, applied with `node db/apply.js db/migrations/<file>.sql` (splits on `;`, strips `--` comments, runs each statement over the Neon HTTP driver). `db/migrate.js` is an older single-statement runner. `db/apply-idv.js` applies IDV schema. Migrations are written **additive + idempotent** (`IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`). **Latest migration number is 025.** Next is 026.
- **[KNOWN-ISSUE / IMPORTANT]** The **base tables** (`clients`, `onboarding_sessions`, `field_values`, `tenants`) have **no committed DDL** — they were bootstrapped directly in Neon before migrations were tracked (numbering starts at 002). So their exact column set / constraints aren't visible in-repo. When altering them, be defensive and inspect the live schema first (`information_schema.columns`). Example gotcha discovered this session: `clients.country_code` is `NOT NULL` in the live DB even though nothing in-repo says so.

---

## 4. Product Areas & User Flows

### 4.1 Onboarding (customer)
**[FACT]** Input company/country/entity/ownership → research (Claude web search via `/api/research`) → Confirm (accept/correct pre-filled fields; unchecking a found field creates a synthetic `corrected_<field>` gap) → Fill Gaps (form for missing fields, grouped by section) → optional IDV → Required Docs (DRS — dynamic document requirements) → Declare (consent + device info) → **Submit**.

**[FACT] Gap-field values live in a ref (`gapRef.current`), NOT React state** — intentional: 20+ fields, updating state per keystroke lost focus. `StableInput` keeps local state and writes through to the ref via `onUpdate`. **Do NOT "fix" this by lifting to `useState`** unless you re-architect the input component. Similarly `stakeholdersRef.current` holds stakeholder data.

**[FACT] Submit (durable pipeline — see §6).**

### 4.2 Pre-boarding (analyst) — **actively being worked on**
**[FACT]** An internal analyst opens `?preboarding=1`, passes a password gate, researches a company (shared `CompanyLookupPage`), the app **auto-saves a "dossier"** to the `entity_dossiers` table ~500ms after research completes, the analyst reviews it in `DossierView`, and sends the customer an **invite link**. The customer opens the link → the dossier hydrates → onboarding starts pre-filled.

**[FACT] Key files:** `src/components/preboarding/PreboardingGate.jsx`, `DossierView.jsx`, `InviteScreen.jsx`; `src/components/companyLookup/CompanyLookupPage.jsx` + `JourneyPicker.jsx`. Backend: `api/save-dossier.js`, `api/get-dossier.js`, `api/dossier-reseed.js`, `api/invite.js`, `api/search-attempt.js`. Table: `entity_dossiers` (`db/migrations/005_entity_dossiers.sql`, extended by `008_dossier_seeded_attempts.sql` adding `seeded_by`/`search_attempts`).

**[FACT] Dossier save = upsert** (`api/save-dossier.js`): `UPDATE ... WHERE id=$dossierId AND tenant_id=$tenantId`, fallback `INSERT` when no dossierId or no row matched. Idempotent on `dossierId+tenant`. `buildDossierPayload()` in `App.js` (~4535-4633) carries `dossierId` to all save call sites (auto-save effect, applyReDerive, DossierView Save/Update buttons).

**[FACT] Two invite branches historically existed; we just fixed this:**
- **Dossier-backed link** `?dossierId=…&tenant=…&journey=customer` — works cross-device (customer landing calls `GET /api/get-dossier`, rebuilds from DB). **This is now the only emailed link.**
- **Legacy `?ref=<token>`** — hydrated only from the **analyst's own browser localStorage** (`nium_invite_<token>`), so it was dead cross-device. **Retired** from the email path this session.

**[FACT] Customer self-serve re-research** — IMPORTANT subtlety: some "analyst" endpoints are **also called by the customer** in a self-serve re-research flow (`seededBy === "customer"`): `save-dossier` (auto-save effect fires for `seededBy==="customer"` too), `search-attempt` (App.js:2725, `isSearchCard && seededBy==="customer"`), and `dossier-reseed` (literally the self-serve reseed endpoint). Only **`/api/invite`** is truly analyst-only. This matters for auth design (§17 Phase 2).

**[FACT] `search-attempt`** = a server-authoritative counter enforcing a **two-retry cap** on customer self-serve re-research.

### 4.3 Admin / Super Admin — see §2.

### 4.4 IDV (Identity Verification) — **[VERIFY] mostly from memory/ledger, re-read `api/idv-match/**` before deep work**
**[VERIFY]** Phase-2 work integrated **Didit** (identity verification) and **ComplyCube** (screening/AML) into the onboarding "Verify ID" step. Key concepts:
- **Discrepancy Bands A/B/C** — the identity-match decision logic. Band A/B/C classify how closely the verified identity matches the researched/entered data; `requiresReview` propagates to hard-stop the flow when review is needed. Files: `api/idv-match/bandAssignment.js`, `behaviors.js`, `resolve.js`, `reconcile.js`, UI in `src/idv-match/**` (`BandResultView.jsx`).
- **Identity Vault** — sensitive PII (name/DOB/document number/etc.) must live only in a secure Vault (`api/idv-match/identityVault.js`, `vaultStore.js`); DB rows/logs/outbox hold **opaque Vault references + versions**, never plaintext, never SHA-256 hashes. Migration 022.
- **Screening (ComplyCube)** — `api/idv-match/screening/**` (`complyCubeClient.js`, `interpret.js`, `store.js`, `webhook.js`). `@complycube/api` SDK. create client → `extensive_screening_check` → getCheck → interpret → store. Outcome `clear|attention|not_processed`; `attention` = hit. Screening is **live-wired** (feature SCR-2), gated by flags; screens everyone; a hit forces a hard-stop review. Nationality must be ISO-2 for ComplyCube (Didit gives ISO-3; `api/idv-match/screening/iso3to2.js` converts). ComplyCube screening is async — `reconcileScreening` re-pulls on each `/resolve` poll (webhook-independent fallback).
- **Evidence outbox** — `api/idv-match/evidenceOutbox.js` + `evidenceOutboxStore.js` (migration 019). Append-only, references-only (no plaintext PII). **No consumer yet** — nothing publishes to the Evidence Platform until "Evidence Control Room" approves (BACKLOG EVID-1).
- **Webhooks** — Didit + ComplyCube signed webhooks; `lib/didit/webhookSignature.js` (HMAC verify, `timingSafeEqualHex`). Mounted in dev via `setupProxy`.
- **[CONVENTION]** IDV is compliance-critical — changes here got **5 review passes**. Treat it as the highest-risk area. Provider outcome ≠ KYC approval.

---

## 5. Integrations & External Services

- **Anthropic Claude API** **[FACT]** — the research engine. `api/research.js` proxies the frontend prompt to `https://api.anthropic.com/v1/messages`, model `claude-sonnet-4-5`, tool `web_search_20250305`. Its only job is to keep `ANTHROPIC_API_KEY` server-side; no business logic. Frontend posts `{ prompt }`, parses the model's text as JSON (strips ```` ```json ```` fences, slices first `{` to last `}`). `api/self-source.js`, `api/doc-search.js`, `api/generate-policy.js`, `api/benchmark.js` also call Claude. `@anthropic-ai/sdk` is a dependency. **Model note:** for new AI work prefer the latest Claude models; the repo currently pins `claude-sonnet-4-5`.
- **Didit** **[VERIFY]** — identity verification provider (document + biometric). Integrated in the IDV step. Server-authoritative sessions, signed idempotent webhook, new attempt per verification. `IDV_DATABASE_URL`.
- **ComplyCube** **[VERIFY]** — screening/AML. `@complycube/api` `^1.1.14`. See §4.4. Key/mode guard enforces `test_`/`live_` prefix.
- **Vercel** **[FACT]** — hosting + serverless + cron. Auto-deploy on push to `main`. `vercel.json` declares `create-react-app` framework, `functions` (maxDuration overrides), and a `crons` array.
- **Neon Postgres** **[FACT]** — two DBs (§3). HTTP driver (`neon()`) for single statements; **Pool driver** (`@neondatabase/serverless` `Pool` + `ws`) for interactive multi-statement transactions (added this session — `api/lib/neonPool.js`).
- **Resend** **[FACT]** — transactional email for invites (`api/invite.js`). `RESEND_API_KEY`. If unset, the code **simulates** the send (dev).
- **Vercel Blob** **[VERIFY]** — document/file storage (`@vercel/blob`). `api/upload-document.js`, `api/get-document.js`, `api/amendment-documents.js`. Files stored in Blob; storage URL / blob_key recorded in the `documents` table.
- **KV / storage** **[FACT]** — `lib/storage.js` abstracts three backends (Vercel KV REST / ioredis / filesystem for dev), auto-selected by which env vars are present. `get`/`set(key,val,{ttlSeconds})`/`del`/`list(prefix)`. Global keyspace, callers namespace by convention (e.g. `config:<tenant>`, `invite:<token>`). Used for tenant config and invite records.
- **Companies House** **[VERIFY]** — UK officer data (`scripts/test-ch-officers.js`, officer-match logic in IDV). Used for officer/UBO enrichment.
- **Vercel Cron** **[FACT]** — runs `/api/finalize-submissions` every minute (submission retry worker, §6). Protected by `CRON_SECRET`.

---

## 6. The Durable Submission Pipeline (built this session — know this well)

**[FACT]** The customer's final Submit is now a **durable, never-lose, never-half-save, idempotent** pipeline. It replaced an old best-effort path that silently lost data.

**Flow:**
1. Frontend mints a **stable `submissionId`** (once, reused across retries — `getSubmissionId()` / `submissionIdRef`, reset only on "Start New Application").
2. As the customer fills the wizard, state auto-saves to **localStorage** (`src/utils/submissionDraft.js` — `saveDraft/loadDraft/clearDraft`, key `kyc_draft_v1`). A **resume banner** offers to restore after a refresh/crash.
3. `POST /api/submit`:
   - **Phase 1 — durable capture:** insert the whole payload into `submission_inbox` (`api/lib/submissionInboxStore.js#enqueue`, idempotent `ON CONFLICT (id) DO NOTHING`). If this throws → `503 {status:"capture_failed"}` (client keeps the draft + retries).
   - **Phase 2 — inline finalize (best-effort, once):** `markProcessing` (claims the row) → `finalizeSubmission` (the real save) → `markDone` on success / `markFailed` on failure. Returns `200 {status:"saved", sessionId,...}` or `200 {status:"queued", submissionId}`.
4. **`finalizeSubmission`** (`api/lib/finalizeSubmission.js`) writes **all ~11 tables in ONE `BEGIN/COMMIT` transaction** on the Pool driver — full commit or full rollback. Idempotent: `onboarding_sessions` upserts on a UNIQUE `submission_id`; children are DELETE-by-parent-then-INSERT; `clients` upserts on `(tenant_id, legal_name, country_code)`; `journeys` on `(session_id)`. **No inner try/catch swallows** (that was the whole point — a child failure aborts the transaction).
5. **Worker** `api/finalize-submissions.js` (Vercel cron, `runWorker`) claims `pending`/`failed` rows (and **stale `processing`** rows older than `FINALIZE_STALE_SECONDS`, to recover crashes) via `claimPending` (`FOR UPDATE SKIP LOCKED`), finalizes each, marks done/failed. A per-row failure never aborts the batch.
6. **Frontend UX:** `saved` → "Application Submitted … successfully" (green ✓). `queued` → "Application Received — saving shortly" (amber ⏳). `capture_failed`/`!ok`/network error → keep the draft, show a **"Retry Submission"** button + error banner (same `submissionId` = idempotent), do NOT show success, do NOT clear the draft. `clearDraft()` only runs when durably captured.

**Attempts / dead-letter [FACT]:** attempts counted **on start** (in `claimPending` for the worker, `markProcessing` for inline; `markFailed` counts only when `markProcessing` didn't — exactly one per start). Cap = `MAX_ATTEMPTS = 25`; past that a row stops being claimed. `markFailed` logs a `DEAD-LETTER` line at the cap; `countDeadLettered` (`status IN ('failed','processing') AND attempts>=MAX`) surfaces it; `runWorker` returns/logs the count. **Dead-letter ALERTING (real notification) is still backlogged.**

**Migrations:** `024_submission_inbox.sql` (table + `onboarding_sessions.submission_id` UNIQUE partial index), `025_submission_inbox_updated_idx.sql` (`(status, updated_at)` index for the stale scan). **Both must be applied to prod DB.**

**Env:** `CRON_SECRET` (guards the worker endpoint — **open if unset**), `FINALIZE_BATCH_LIMIT` (default 20), `FINALIZE_STALE_SECONDS` (default 300). `parseIntEnv` rejects NaN/0/negative.

**Legacy tables written by finalize** (the ~11): `tenants`, `clients`, `onboarding_sessions`, `field_values`, `session_timeline`, plus the journey model: `journeys`, `completion_choice`, `declaration`, `api_usage`, `field_provenance`, `documents`. **[VERIFY]** provenance rules (`agent_value` is always the AI/registry original, never the customer's value) live in `src/utils/fieldProvenance.js`.

---

## 7. Backlog & Task Management **[CONVENTION]**

- **`BACKLOG.md`** at repo root is the deferred-work ledger. Maintain it: when something is deferred, add it; when done, mark/remove it.
- **`fix-or-backlog` rule:** whenever I surface a bug/hardening item, I **ask the user "fix now or backlog?"** rather than silently deferring — and I give a recommendation. The user makes the call.
- **Structure:** items grouped by area, with severity/impact and a short "why". Distinguish bugs vs improvements vs features vs tech-debt.
- **Prioritization:** customer-facing breakage and data-loss/security first; polish/tuning later. Match **verification effort to change risk** (see §14).
- **`.superpowers/sdd/progress.md`** — a **durable progress ledger** for multi-task features (the "SDD ledger"). One line per task: `Task N: complete (commits <base7>..<head7>, review clean)`. It survives context compaction; trust it + `git log` over memory after a reset. It's **git-ignored scratch** (a `git clean -fdx` destroys it). Minor findings for final-review triage are collected here.

---

## 8. Codebase & Development Workflow

**[FACT] Structure:**
- `src/App.js` — the whole `KYCAgent` component (huge). Most state + logic + the submit/dossier flows live here.
- `src/components/**` — extracted UI (companyConfirm, preboarding, companyLookup, changeDialogue, amendmentDocuments, etc.).
- `src/idv-match/**` — IDV UI. `src/policySimulator/**` — policy simulator UI.
- `src/utils/**` — helpers (`submissionDraft.js`, `fieldProvenance.js`).
- `api/*.js` — serverless routes (CommonJS). `api/lib/**` — shared server modules (`neonPool.js`, `submissionInboxStore.js`, `finalizeSubmission.js`). `api/idv-match/**` — IDV backend.
- `lib/**` — shared non-api modules (`storage.js`, `seedConfig.js`, `didit/**`).
- `db/migrations/**`, `db/apply.js`.
- `scripts/**` — demo seeders, smoke tests, diagnostics.

**[FACT] Commands:**
- `npm start` — dev server + mounted API (via `setupProxy.js`). `http://localhost:3000`.
- `npm run build` — production build into `build/` (also runs `scripts/stage-validation-lab.js`).
- `npm test` — CRA Jest (jsdom). Run one file: `CI=true npx react-scripts test --watchAll=false <path>`. **The full CRA suite is slow (~3 min) and has known flaky suites** (`PolicySimulator.test.jsx`, `appMounts.test.jsx`, sometimes `noTenantLanding.integration`) that time out under parallel load — **re-run a failing one in isolation to confirm it's pre-existing flakiness, not your change.**
- `npm run test:node` — Node's built-in test runner over `**/__tests__/*.nodetest.js` (fast, for `api/`/`lib/`). This is where backend logic is tested.
- `npm run idv:test`, `idv:security-scan`, `idv:db:migrate`, `idv:db:seed` — IDV-specific.
- `node db/apply.js db/migrations/<file>.sql` — apply a migration.
- `npm run worker:finalize` — run the submission finalize worker once locally.

**[CONVENTION] How we add/modify code:**
- **Understand before editing.** Trace the real flow end-to-end (every file the change touches) before picking a solution. Laziness that skips comprehension ships confident wrong fixes.
- **Root-cause, not symptom.** Grep every caller of a function before changing it; fix once where all callers route through (e.g. we fixed the dossier-dup at the shared `save-dossier` handler, not per-caller).
- **Match surrounding style** — inline styles, existing state naming, existing patterns. Follow the established (even if large-file) structure; don't unilaterally restructure.
- **Test conventions:** backend → `*.nodetest.js` with injected fakes (`deps.sql`, `__setDeps` seam — mirror `api/submit.js`). Frontend → jest render tests asserting real DOM behavior, not mocks-of-mocks.
- **Verify it actually works** — build compiles, tests pass, and for runtime behavior, exercise the flow (or note where browser QA is required — headless subagents can't drive a browser).

**[CONVENTION] Git & deploy:**
- Remote is **`kyc-agent-remote`** (`github.com/ManasBorole/kyc-agent-remote`). Working branch **`dev/local-work`**. Default branch **`main`**.
- **Don't commit/push unless the user asks.** When they do: push the feature branch to a **remote branch of the same name** (`git push kyc-agent-remote HEAD:refs/heads/dev/local-work`), then open a PR to `main` and merge. **Merging to `main` auto-deploys to production (Vercel).** The local branch's upstream is oddly set to `main` — a bare `git push` would write to main, so always push explicitly to the branch.
- Commit trailer (per repo/session config): `Co-Authored-By: Claude ...` + a `Claude-Session:` line. PR bodies end with the Claude Code generated-with line.
- Isolated worktree: this project runs in `E:\kyc-agent-dev` on `dev/local-work` (a validated baseline).

---

## 9. Bug Investigation & Debugging **[CONVENTION]**

- **Systematic-debugging first** — before proposing a fix, reproduce/understand the failure, trace it through the layers (browser → API → DB → response). Don't guess.
- **Continuous bug/perf watch** — while building any feature, actively scan surrounding code for bugs, perf issues, improvements, and surface them (fix-or-backlog). Don't build heads-down.
- **Where to look first:** for a "not persisting / not saving" bug, check whether the API returns success independent of the real write (the "200-on-failure / silent-loss" anti-pattern — we found it in both `api/submit.js` and `api/save-dossier.js`), and whether the client only `console.warn`s on failure while showing success.
- **Recovering lost conversation context:** Claude Code stores session transcripts as `.jsonl` under `C:\Users\manas\.claude\projects\E--kyc-agent\`. You can grep them to recover what a prior (crashed) session was doing.
- **Common failure patterns seen:** silent 200-on-failure; localStorage-only state that dies cross-device; unauthenticated bearer-URL PII; non-transactional multi-write leaving half-records; idempotency keys not sent from the client (the submit POST once omitted `submissionId` → 400 on every submit); Neon HTTP driver can't do interactive transactions (use Pool); Set-valued state dropped by `JSON.stringify` (needs explicit Array↔Set).

---

## 10. Performance & Optimization **[CONVENTION]**

- **[FACT]** `gapRef`/`stakeholdersRef` refs instead of state to avoid per-keystroke re-renders (§4.1) — a deliberate perf decision; don't undo it.
- **[FACT]** Worker batch size + stale window are env-tunable (`FINALIZE_BATCH_LIMIT`, `FINALIZE_STALE_SECONDS`).
- **[KNOWN-ISSUE]** `idx_submission_inbox_status` was `(status, created_at)`; the stale-processing scan filters `updated_at`, so migration 025 added `(status, updated_at)`. If any scan set grows large, check index coverage.
- **[VERIFY]** No systematic frontend perf pass has been done; `src/App.js` is very large — bundle size and re-render cost are plausible future concerns, not yet measured.

---

## 11. Deployment & Infrastructure

- **[FACT]** `vercel.json`: `create-react-app` framework, `outputDirectory: build`, `functions` maxDuration overrides (`doc-search`/`self-source` 60s, `generate-policy` 300s, `finalize-submissions` 60s), `crons: [{path:"/api/finalize-submissions", schedule:"* * * * *"}]`, and rewrites routing `/admin`, `/super-admin`, `/preview`, `/policy-simulator`, `/api/*`, and everything else to `index.html`.
- **[CONVENTION] Deploy = merge to `main`.** After merging a feature that adds a migration or env var, the **prod DB migration must be run** and **prod env vars set** — code merge alone doesn't do it.
- **[FACT] Env changes need a redeploy** to take effect. `.env.local` changes need a **dev-server restart** (not hot reload).
- **[KNOWN-ISSUE / OUTSTANDING prod gates from this session's work]:**
  1. Apply migrations **024 + 025** to the prod DB (else live submits error).
  2. Set **`CRON_SECRET`** in Vercel (Production) — worker endpoint is public until set; redeploy after.
  3. **Browser QA** of the submit flow (saved vs retry) + resume banner — the two Criticals we fixed were browser-only seams no unit test caught.
- **[FACT] Vercel platform notes (current):** Fluid Compute is default (Node.js, reuses instances across requests — so don't `pool.end()` per request). Node 24 LTS default. Default function timeout 300s. Vercel Postgres/KV as first-party are deprecated in favor of Marketplace, but this project already uses Neon + `lib/storage.js`.

---

## 12. Database & Data (key tables)

**[FACT] Main DB (`DATABASE_URL`):**
- `tenants (id, name, slug)` — upserted on demand.
- `clients (id, tenant_id, legal_name, country_code NOT NULL, entity_type, ownership_type)` — upsert on `(tenant_id, legal_name, country_code)`.
- `onboarding_sessions` — the legacy session record + full cost/token breakdown + `raw_result` JSONB + `submission_id` (UNIQUE, added mig 024) + `status`.
- `field_values (session_id, field_key, value, source_type)`.
- `session_timeline` — audit events (e.g. `applicant_field_overridden`).
- Journey model (mig 003): `journeys`, `completion_choice`, `declaration`, `api_usage`, `field_provenance`, `documents`.
- `entity_dossiers` (mig 005/008) — preboarding dossier: identity, coverage metrics, `included/excluded_fields`, `custom_questions`, `verified/probable/indicative_data`, `stakeholders`, `required_documents`, `raw_research` (JSONB), cost, lifecycle, `seeded_by`, `search_attempts`, `status`. PK is a random `gen_random_uuid()`. Soft-delete via `status != 'deleted'`.
- `submission_inbox` (mig 024) — durable submit queue: `id` (=submissionId, PK), `tenant_id`, `status` (pending/processing/done/failed), `payload` JSONB, `attempts`, `last_error`, `session_id`, timestamps.
- `change_events` (mig 007), `entity dossiers seeded attempts`, `research_cache` (006), `ubo_investigations` (009).

**[FACT] IDV DB (`IDV_DATABASE_URL`)** — mig 013-023: `idv_verification_attempts`, `idv_match_decisions` (append-only, `supersedes`), `idv_document_media`, `idv_webhook_events`, `idv_screening_checks`, `idv_evidence_outbox`, `idv_lifecycle_events`, `idv_review_tasks`, `idv_vault`, `idv_identity_events`.

**[CONVENTION] Data integrity:** idempotency keys for anything retried; DELETE-by-parent-then-INSERT for child re-writes inside a transaction; append-only for audit/decision tables; opaque Vault refs never plaintext PII.

---

## 13. Authentication, Authorization & Security

- **[FACT]** Admin/Super-Admin = shared-password Bearer (§2). No user accounts, no sessions.
- **[KNOWN-ISSUE] Preboarding "password" is fake security** — `PREBOARDING_PASSWORD = "ARCH"` is hardcoded in `src/App.js:287` and checked **client-side only** (`PreboardingGate.jsx`). It gates the UI screen, not the APIs. `save-dossier`/`get-dossier`/`search-attempt`/`dossier-reseed`/`invite` currently require **no auth**. `save-dossier` even creates arbitrary `tenants` rows on demand. **Being fixed in Phase 2 (§17).**
- **[KNOWN-ISSUE] `get-dossier` is unauthenticated PII exposure** — only tenant match + an unguessable UUID gate it; the customer dossier link is an unexpiring, unrevocable bearer URL to full stakeholder PII. **Being fixed in Phase 2** (signed + expiring + revocable token).
- **[KNOWN-ISSUE] `search-attempt` is not tenant-scoped** — `WHERE id = $dossierId` with no `tenant_id`; a cross-tenant caller can read/increment another tenant's retry counter. Fix folded into Phase 2.
- **[FACT]** Webhook security via HMAC signature verification (`lib/didit/webhookSignature.js`, `timingSafeEqualHex`).
- **[FACT]** Invite-link validation (Phase 1): the server validates any client-supplied link against the **server-resolved origin** (from `Host`/`x-forwarded-*`, not the spoofable `body.origin`) plus **exact** `dossierId` and `tenant` query params (parsed via `new URL`), else reconstructs its own link — no open-redirect / email-injection.

---

## 14. Working Style & AI Instructions (READ THIS) **[CONVENTION]**

This is how the user wants Claude to work. These are durable, carried across sessions via memory files.

- **Production-grade always.** Non-negotiable engineering standard: correctness, security, clean architecture, tests. Apply to every change.
- **Subagent-driven development** for multi-task features: dispatch a **fresh implementer subagent per task**, then a **task reviewer subagent** (spec compliance + code quality) after each, then a **broad whole-branch review** at the end. Track in the SDD ledger. Fix Critical/Important findings before moving on. This session ran the entire submission pipeline + preboarding fixes this way and it repeatedly caught real bugs the implementer missed (including 2 Criticals in the final review).
- **Review every change.** Never mark work complete without a review pass and passing tests. Evidence before assertions — run the command, show the output.
- **Risk-based review cadence** — match verification effort to change risk: full loop (tests + review + verify) for risky/logic/core/security; light touch for trivial copy. Classify conservatively.
- **Continuous bug/perf watch** (§9) + **fix-or-backlog** (§7). The **as-I-touch** watch is the default and always on. Do **NOT** schedule standing whole-codebase sweeps; a dedicated platform-wide sweep is on-demand only (run when the user explicitly asks).
- **Ask when genuinely in doubt** — the user explicitly invited questions when a decision is theirs (e.g. this session I stopped before guarding the shared endpoints once I found they're customer-callable, and surfaced the design fork). Don't guess on money/provenance/security columns.
- **Never hit a real/paid external API without asking first** (including for testing). Our own Neon DB is fine to write to; a separate disposable `TEST_DATABASE_URL` guards the real-db smoke script.
- **Keep the user's account identity confidential** — never expose account name/email/identity anywhere.
- **Communication:** the user often asks for **plain-terms explanations** — explain like they're not deep in the code, use analogies, avoid jargon, be honest about tradeoffs. When they ask "explain simply," do that.
- **Honesty:** report outcomes faithfully — if tests fail, say so with output; if a step was skipped, say it; don't claim "done" without verification.
- **Memory files** live at `C:\Users\manas\.claude\projects\E--kyc-agent\memory\` (`MEMORY.md` index + one file per fact). Relevant standing memories: engineering-standards, backlog-hardening-workflow, continuous-bug-perf-watch, risk-based-review-cadence, no-paid-api-without-asking, keep-claude-identity-confidential, idv-discrepancy-bands-decisions, phase2-target-didit-idv, dev-worktree-setup. (These live on THIS machine/account; a new account won't have them — this file is the substitute.)

---

## 15. Plugins, Skills & Modes **[FACT]**

These are Claude Code plugins/skills active on the user's machine. Two of them (**caveman**, **ponytail**) are **persistent output/behavior modes activated automatically at every session start** via `SessionStart` hooks — a new Claude account will only have them if the same plugins are installed there. If they're missing, this section tells the new Claude how the user expects it to behave regardless.

### Caveman (persistent mode — auto-active every session)
- **What:** ultra-compressed "smart caveman" prose — drops articles (a/an/the), filler (just/really/basically), pleasantries, and hedging. Fragments OK. Cuts output tokens ~65%. **Applies to prose ONLY** — code, commit messages, PRs, and documents (like this file) are written **normally and in full**.
- **When it auto-drops to normal:** security warnings, irreversible-action confirmations, and any multi-step sequence where terseness would create ambiguity.
- **Commands:** `/caveman lite|full|ultra` (default full); turn off with "stop caveman" / "normal mode".
- **If the user seems confused by terse replies**, they often ask "explain in simple terms" — switch to plain, full prose with analogies.

### Ponytail (persistent mode — auto-active every session)
- **What:** "lazy senior developer" discipline — force the **simplest solution that actually works**. The ladder: does this need to exist at all (YAGNI) → is it already in the codebase (reuse) → does stdlib/native do it → does an already-installed dep → can it be one line → only then minimal new code. Deletion over addition. Boring over clever.
- **Never lazy about:** understanding the problem (trace the whole flow first), input validation at trust boundaries, error handling that prevents data loss, security, accessibility, tests, or anything the user explicitly asked for.
- **Convention:** mark a deliberate corner-cut with a `ponytail:` code comment naming the ceiling + upgrade path (e.g. `// ponytail: global lock, per-account locks if throughput matters`). Non-trivial logic leaves ONE runnable check behind.
- **Skills:** `/ponytail-review` (review a diff purely for over-engineering), `/ponytail-audit` (whole-repo bloat scan), `/ponytail-debt` (harvest `ponytail:` comments), `/ponytail-gain`, `/ponytail-help`.

### Superpowers (the process toolkit — this is HOW we build)
Invoked via the `Skill` tool. The workflow this project runs on:
- **`brainstorming`** — before any creative/feature work, explore intent/requirements/design first.
- **`writing-plans`** — turn a spec into a bite-sized TDD task plan saved to `docs/superpowers/plans/YYYY-MM-DD-<feature>.md` (each task = failing test → run → implement → run → commit; exact file paths + full code + commands, no placeholders).
- **`subagent-driven-development`** — execute the plan by dispatching a **fresh implementer subagent per task**, a **task-reviewer subagent** (spec + quality) after each, fixing Critical/Important findings, then a **broad whole-branch review** on the strongest model at the end. Track in `.superpowers/sdd/progress.md`. This is the loop that built everything this session and repeatedly caught real bugs (incl. 2 Criticals the implementers missed). Model selection: cheap model for pure transcription tasks, standard for integration/judgment, strongest for the final review + hardest verifies. **Always specify the model when dispatching.**
- **`executing-plans`** — alternative: batch-execute a plan in one session with checkpoints.
- **`requesting-code-review`** / the review templates — the per-task and whole-branch review prompts.
- **`systematic-debugging`** — reproduce/understand/trace before proposing a fix.
- **`test-driven-development`** — red → green → commit.
- **`verification-before-completion`** — run the verification commands and show output before claiming success. Evidence before assertions.
- **`using-git-worktrees`** — isolated workspaces (this project already runs in the `E:\kyc-agent-dev` worktree on `dev/local-work`).
- **`finishing-a-development-branch`** — merge/PR/cleanup options when a branch is done.
- **Helper scripts** used by subagent-driven-development: `scripts/task-brief PLAN N` (extract a task to a file), `scripts/review-package BASE HEAD` (build a review diff file), under the superpowers plugin dir.

### Vercel plugin
- Vercel-specific skills + subagents (deployment-expert, ai-architect, performance-optimizer) and knowledge-updates: Fluid Compute is the default runtime (Node.js, instance reuse — don't `pool.end()` per request), Node 24 LTS, 300s default function timeout, `vercel.ts` config, AI Gateway, Marketplace storage. Use only when the task is actually Vercel-related.

### Other skills available (built-in / on-demand)
`deep-research` (multi-source web research), `dataviz` (any chart/graph — read before writing chart code), `artifact-design` + `artifact-capabilities` (publishing HTML/MD Artifacts), `code-review` / `simplify` / `security-review` (diff review commands), `verify` / `run` (drive the app to confirm a change), `update-config` (settings.json/hooks), `loop` / `schedule` (recurring tasks), `claude-api` (Claude model/pricing reference — read before touching anything Anthropic/Claude-shaped).

### [VERIFY] Plugins the user named but I did NOT see active this session
- **"I Have ADHD"** and **"UI/UX Pro Max"** — mentioned in the handoff request but not observed in this session's tool/skill list. The new account should verify whether they're installed and what workflow they introduce. If UI/design work comes up, check for a `frontend-design` process skill and the `dataviz`/`artifact-design` skills above.

---

## 16. Important Decisions & Historical Context **[FACT unless noted]**

- **Submit made durable + transactional.** The old submit was best-effort (200-on-failure, non-transactional, always showed "success") — it silently lost data and could half-write. We replaced it with the inbox + atomic finalize + worker (§6).
- **Chose Pool driver + `ws`** for the finalize transaction because the Neon HTTP driver can't do interactive multi-statement transactions and our writes chain on `RETURNING` ids. (Considered a writable-CTE single statement — impractical for this many dynamic child rows.)
- **Reverted a "phantom" fix.** We nearly "fixed" a null-`country_code` duplicate-client bug, then found `clients.country_code` is `NOT NULL` in the live DB (so it can't happen) and the original `ON CONFLICT` upsert was already correct + race-safe. **Reverted** rather than ship complexity for an impossible case. Lesson: verify the live schema before "fixing" the base tables.
- **Dossier save: chose upsert over guard.** Re-research is meant to *refresh* the dossier, so a guard-at-source would have silently no-op'd it; upsert (update-in-place by dossierId, tenant-scoped, INSERT fallback) is correct.
- **Invite link: retired `?ref=`** (localStorage-only, dead cross-device) in favor of the DB-backed `?dossierId=` link (Phase 1), and is moving to a **signed token** (Phase 2).
- **[CONVENTION]** When a plan under-specifies tests, the reviewer/controller adds coverage (this happened repeatedly and caught real gaps). When a review finds a plan-mandated defect, it's the human's call.

---

## 17. Known Issues & In-Flight Work

**[IN-FLIGHT] Preboarding Phase 2 (security) — STARTED, PAUSED ON A DECISION.** The user chose: (a) **server-checked shared password** for analyst auth now (per-analyst accounts → backlog); (b) **signed token + expiry + revoke** for the customer dossier link. **Open decision when this handoff was written:** how to auth the **shared** endpoints (`save-dossier`/`search-attempt`/`dossier-reseed`) that both the analyst AND the customer self-serve flow call. Proposed (recommended) design:
- Build the **signed dossier token first** (`lib/dossierToken.js` — HMAC-SHA256 over base64url `{dossierId, tenantId, exp, jti}` + a revocation list in `lib/storage.js` keyed `dossier-token-revoked:<jti>`, verified in `get-dossier`). Reuse `lib/didit/webhookSignature.js` primitives. New env `DOSSIER_TOKEN_SECRET`. Customer link becomes `?dossierToken=<token>` (drop raw `dossierId` from the URL).
- Then auth the endpoints: `invite` → analyst Bearer (`PREBOARDING_PASSWORD`, new env, new `lib/auth.js#requireEnvBearer` using `timingSafeEqual`, new `api/preboarding-auth.js` endpoint for the gate); shared endpoints → analyst Bearer **OR** a valid dossier token whose `dossierId` matches the row being touched; `get-dossier` → valid token (customer) OR analyst Bearer (analyst "Preview" button, which calls `get-dossier` with a raw dossierId). Tenant-scope `search-attempt` regardless.
- **The scout report for this is in a prior turn** (auth/crypto patterns, exact reusable snippets). Re-run a read of `api/tenants.js#requireSuperAdmin`, `api/super-admin-auth.js`, `lib/didit/webhookSignature.js`, `lib/storage.js` before building.
- **Phase 3 (polish, not started):** `showDossierView` not persisted → resume strands the analyst on the customer Confirm step; `selfSourceResults`/manual uploads lost on localStorage resume; first-save duplicate race (no server idempotency key on the INSERT branch); dead code (PreboardingGate "back to agent selection" button, duplicate `?preboarding` param parsing, `nium_invite_` snapshots never cleaned up). Full audit: **`docs/preboarding-audit-2026-09-13.md`**.

**[KNOWN-ISSUE] Other backlog:**
- Dead-letter **alerting** for the submission pipeline (real notification, not just a log line) — deferred by user choice.
- Poison-pill edge: a submission whose finalize **hard-crashes the process** every attempt now terminates at the cap (good) but ends stuck in `processing` with no clean alert (folded into the widened `countDeadLettered`).
- IDV Evidence Platform publish (EVID-1) — the outbox has no consumer yet.
- Per-tenant admin passwords (currently one shared `ADMIN_PASSWORD`).
- Brand-naming cleanup (nium-specific colors/strings/journey types) — a product-rebrand question, out of scope of the tenant-default work already done.

**[KNOWN-ISSUE] Fragile areas:** `src/App.js` is enormous — edits need care and a build+test check. IDV is compliance-critical (5-review-pass area). The base tables have no committed DDL.

---

## 18. Environment & Setup

**[FACT]** `npm install`, then `npm start`. `ANTHROPIC_API_KEY` lives in `.env.local` (gitignored) locally and in Vercel project settings for prod. `.env.example` documents the vars.

**Env vars (names only — never commit values):**
- `ANTHROPIC_API_KEY` `<SECRET>` — Claude.
- `DATABASE_URL` `<SECRET>` — main Neon DB.
- `IDV_DATABASE_URL` `<SECRET>` — IDV Neon DB.
- `TENANT_ID` — default tenant when no `?tenant=` (override only; no `"nium"` fallback in resolution).
- `ADMIN_PASSWORD` `<SECRET>`, `SUPER_ADMIN_PASSWORD` `<SECRET>`.
- `CRON_SECRET` `<SECRET>` — guards `/api/finalize-submissions`. **Must be set in prod.**
- `FINALIZE_BATCH_LIMIT` (default 20), `FINALIZE_STALE_SECONDS` (default 300).
- `RESEND_API_KEY` `<SECRET>` — invite emails (simulated if unset).
- **[VERIFY]** Didit + ComplyCube API keys, Vercel Blob token, KV/Redis creds — check `.env.example` / `api/idv-match/**` for exact names.
- **[PLANNED, Phase 2]** `PREBOARDING_PASSWORD` `<SECRET>`, `DOSSIER_TOKEN_SECRET` `<SECRET>`.

**Common setup gotchas:** `.env.local` changes need a dev-server restart; Neon data is per-branch (check the branch); the CRA test suite is slow with known flakes; the `idv` DB isn't visible in the Neon web console.

---

## 19. Practical Checklists **[CONVENTION]**

**Before modifying code:** read the target + every caller/flow it touches; check for the "silent 200-on-failure" and "localStorage-only cross-device" anti-patterns; confirm which tenant/agentType/journey contexts hit the code (a preboarding endpoint may also be customer-called).

**Before implementing a feature:** brainstorm intent, then a written plan for anything multi-step (`docs/superpowers/plans/`); decompose into task-sized units each with a test; identify env vars / migrations needed (they become deploy gates).

**Before fixing a bug:** reproduce/understand; grep all callers; fix at the root; add a regression test.

**Before marking complete:** tests pass (show output); build compiles; a review pass done; runtime behavior exercised or browser-QA flagged; ledger updated.

**Before deploying (merge to main):** all reviews clean; then run prod migrations + set prod env vars + do browser QA. Remember merge = auto-deploy.

**When adding an integration:** keep secrets server-side (proxy pattern like `api/research.js`); reuse `lib/storage.js` and existing auth/crypto patterns before adding deps.

**When handling files:** Vercel Blob for storage; record storage URL/blob_key in the `documents` table; never store raw File objects in localStorage (non-serializable).

**When modifying DB logic:** inspect the live schema first (base tables have no committed DDL); additive idempotent migrations; idempotency keys for retried writes; DELETE-then-insert children inside the transaction.

**When changing auth/permissions:** mirror `requireSuperAdmin`; prefer `timingSafeEqual`; remember `get-dossier` is customer-reachable (can't require the analyst password); tenant-scope every dossier read/write.

---

## 20. Anything Else

- **[FACT]** `DEPLOYMENT_GUIDE.md` is a beginner Windows walkthrough for the original deployer — not a developer reference; don't edit it for code changes.
- **[FACT]** `scripts/demo/**` has seeders (`seed-complete.js`, `inspect.js`) and diagnostics (`didit-status.js`, `screening-debug.js`). `scripts/real-db-smoke.js` (`npm run test:smoke:db`) needs a disposable `TEST_DATABASE_URL` + confirmation var — it won't touch the shared app DB without them.
- **[CONVENTION]** Windows environment: primary shell is **PowerShell**; a **Bash** tool (Git Bash) is also available. Watch shell-specific syntax. Temp/scratch goes in a job tmp dir, not `/tmp`.
- **[FACT]** Recent shipped features (from the SDD ledger, all reviewed): 3-strict tenant resolution + kill hardcoded Nium; IDV discrepancy bands + screening live-wiring (SCR-2/SCR-6) with hard-stop review; IDV result persistence across step navigation; localhost demo-on default + paid-research confirm guard; applicant-UI refactor; the durable submission pipeline; preboarding Phase 1 (invite link + save-failure surfacing).
- **[VERIFY]** Two PRs (#1, #2) merged the submission pipeline to `main`; PR #3 merged preboarding Phase 1. Confirm `git log main` for exact state.

---

*End of handoff. When in doubt, read the code and the SDD ledger (`.superpowers/sdd/progress.md`) — and ask the user rather than guessing on money, security, or compliance paths.*
