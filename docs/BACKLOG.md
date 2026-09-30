# BACKLOG.md

Persistent source of truth for deferred work, agreed future improvements, tech debt, and hardening tasks for the kyc-agent project. Reviewed before significant new development. Items are updated (not deleted) as they progress.

**Status legend:** `OPEN` · `IN PROGRESS` · `DONE` · `WONTFIX`
**Priority:** `P0` (blocker) · `P1` (high) · `P2` (medium) · `P3` (low)

**Production readiness:** the audit-derived, ordered programme (Batches 0–6) lives in
[`docs/PRODUCTION-READINESS-PLAN.md`](PRODUCTION-READINESS-PLAN.md). Items discovered
while working a batch land here; the batch plan links back to them.

---

## Open dependencies (waiting on external input)

### DEP-1 — Confirm/obtain a writable test database for IDV results
- **Category:** Dependency / Infra · **Priority:** P1 · **Status:** OPEN (waiting on client)
- **What:** Client-provided Neon DB (`ep-blue-mouse-abxjk5d5-…eu-west-2`) — unknown whether it is test or shared/prod. Need confirmation it's safe to write test rows, or a dedicated Neon branch connection string.
- **Why:** IDV spike must persist mapped fields + extras; we won't write to a possibly-real DB unconfirmed.
- **Interim:** spike builds against a local file/in-memory store; Neon wiring flipped on once confirmed. No blocking.
- **Area:** spike persistence layer, `.env.local` `DATABASE_URL`.

### DEP-2 — Set `CRON_SECRET` in Vercel (Production) and redeploy
- **Category:** Security / Deploy · **Priority:** P1 · **Status:** OPEN (manual step for the owner — deferred 2026-09-15)
- **What:** Add a long random `CRON_SECRET` env var in the Vercel project (Production), then redeploy so it takes effect.
- **Why:** `api/finalize-submissions.js` only checks `Authorization: Bearer <CRON_SECRET>` when the var is set. Unset, anyone with the URL can trigger the submission retry worker. Nothing leaks and finalize is idempotent, but repeated calls add DB load and cost. Vercel Cron sends the header automatically once the var exists.
- **Local:** not needed. Vercel Cron doesn't run locally, and the worker only runs via `npm run worker:finalize`.
- **Area:** Vercel env settings, `api/finalize-submissions.js`, `vercel.json` `crons`.

### DEP-3 — Part 1 deploy gates: DOSSIER_TOKEN_SECRET + migration 026
- **Category:** Security / Deploy · **Priority:** P1 · **Status:** OPEN (manual step for the owner)
- **What:** (1) Set `DOSSIER_TOKEN_SECRET` to a long random value in every environment that sends invites or serves customer links. (2) Apply `db/migrations/026_dossier_ownership.sql` to each database (`node db/apply.js db/migrations/026_dossier_ownership.sql`).
- **Why:** Without the secret, invites return 500 and every customer link is refused. Without the migration, dossier reads and writes fail on the missing `owned_by` column.
- **Breaking by design:** every previously-emailed `?dossierId=` link stops working; analysts re-send invites.

### DEP-4 — Part 2 deploy notes: rate-limit storage + research cache reset
- **Category:** Deploy · **Priority:** P2 · **Status:** OPEN (manual step for the owner)
- **What:** (1) Rate-limit counters live in `lib/storage.js`. On Vercel without KV/Redis they fall back to per-instance `/tmp`, so limits are per instance, not global; and the filesystem backend ignores TTLs, so `ratelimit:*` keys pile up in `.config-store.json` (local) or `/tmp` until the instance recycles. Provision KV/Redis (same as PREB-6). (2) The research cache key now includes tenant, ownership type and registration number, so every existing `research_cache` row stops matching; the first research per company after deploy is a live (paid) call. (3) `benchmark/run.mjs` needs `BENCHMARK_ADMIN_TOKEN` and a `?tenant=` in `--endpoint`.
- **Why:** Behaviour changes that are correct by design but surprise on first deploy.
- **Raised 2026-09-20:** this now matters more. `lib/loginThrottle.js` (AUTH-1) and the per-person rate limits both count through `lib/storage.js`. Without KV/Redis each serverless instance counts separately, so an attacker gets 5 password guesses *per instance* rather than 5 in total, and a caller gets their hourly allowance per instance. Both work correctly locally and are weaker in production in proportion to how many instances are running. One integration, one env var, no code change.

### DEP-5 — Part 3 deploy gate: migration 027
- **Category:** Deploy · **Priority:** P1 · **Status:** OPEN (manual step for the owner)
- **What:** Apply `db/migrations/027_customer_corrections.sql` to each database (`node db/apply.js db/migrations/027_customer_corrections.sql`) BEFORE deploying Part 3.
- **Why:** Without it, dossier updates fail (the snapshot insert targets `entity_dossier_versions`), the customer re-search counter reads a missing `customer_searches` column, and submissions fail on `onboarding_sessions.dossier_id`.

### DEP-6 — Part 4 deploy gate: migration 028
- **Category:** Deploy · **Priority:** P1 · **Status:** OPEN (manual step for the owner)
- **What:** Apply `db/migrations/028_dossier_creation_key.sql` to each database (`node db/apply.js db/migrations/028_dossier_creation_key.sql`) BEFORE deploying Part 4.
- **Why:** The dossier INSERT writes `creation_key` and uses `ON CONFLICT (tenant_id, creation_key)`; without the column and unique index every first save fails.

---

## Didit IDV integration — deferred to the production-hardening phase

These were agreed during design of the Didit IDV spike (Hybrid Option A: spike thin on sandbox, then harden). The spike must NOT handle real PII; everything below gates the transition from spike → production.

### IDV-1 — Adopt encrypted-storage security model before real PII
- **Category:** Security / Data protection
- **Priority:** P0 (blocks any real-customer go-live)
- **Status:** OPEN
- **What:** The spike writes Didit identity data into ordinary app storage (mapped fields + an extras JSON blob) using Didit **sandbox / synthetic** data only. Before any real person verifies, migrate identity PII into the hardened `idv/` module's model: envelope encryption (per-item DEK, AES-256-GCM, KMS-wrapped), per-tenant RLS, PII held behind a reference, OIDC-gated access.
- **Why:** KYC identity documents (doc numbers, DOB, address, biometrics results) must not sit in plaintext across general app tables in production. The `idv/` module was purpose-built for this.
- **Recommended approach:** Reuse `idv/` module storage layer (`postgresSecureIdentityStore`, `SecureIdentityStore`), route mapped fields as references, decrypt-on-read under authorization.
- **Area:** `idv/`, new `api/idv-*` routes, wizard verification step.
- **Blockers/deps:** requires **managed KMS key provider**, **OIDC issuer + JWKS**, and a **separate IDV Neon DB** (`IDV_DATABASE_URL`) — likely client-supplied. See IDV-2.

### IDV-2 — Provision production security infrastructure
- **Category:** Infrastructure / Security
- **Priority:** P1
- **Status:** OPEN
- **What:** Stand up the prerequisites the `idv/` module requires in production: a managed KMS-backed `ManagedKeyProvider` (local test key is forbidden in prod), an OIDC issuer/audience over HTTPS with JWKS, and the separate `IDV_DATABASE_URL` database + schema (`npm run idv:migrate`).
- **Why:** Needed for IDV-1; module hard-guards refuse to run in production without them.
- **Blockers/deps:** client to provide/confirm KMS, OIDC, and DB.
- **Note (Phase 2.5):** the dev Vault is the module's **in-memory synthetic store**, which does **not** survive across serverless invocations. So today `secure_identity_reference` persists in Postgres but the referenced PII is write-and-lose between requests — fine for proving the Evidence architecture on synthetic Didit data, but the feature is not functionally end-to-end for identity read-back until the durable Postgres Vault (this item) is wired. Flag stays OFF meanwhile.
- **Note (Section B, 2026-09-09):** because of the above, the live band comparison (`api/idv-match/resolve.js`) reads identity from a **fresh in-memory canonical map** (re-pull the Didit decision + `mapDiditDecision`), NOT a Vault re-read. The Vault keeps the reference for audit only. Once the durable Vault exists, switch the comparison to an **authorized Vault re-read** (`identityVault.retrieveForAuthorizedPurpose` with a field allowlist) so the identity isn't re-pulled from the provider on each resolve.

### IDV-3 — Add production webhook ingestion (HMAC) alongside polling
- **Category:** Reliability / Integration
- **Priority:** P1
- **Status:** OPEN
- **What:** Spike retrieves results by **polling** `GET /v3/session/{id}/decision/` on redirect-back (no public ingress needed). Production should also accept Didit's **webhook** (full decision, HMAC-signed) for push updates + async/cross-device completion where the user never returns to our tab.
- **Why:** Polling alone misses completions where the user abandons our tab; webhook is the authoritative push path.
- **Recommended approach:** Reuse `verifyDiditWebhook` (three HMAC schemes + 300s replay window) and the module's reconciliation (untrusted simple-signature → re-pull). Needs a stable public webhook URL (client env currently uses an ephemeral Cloudflare tunnel — replace with a stable prod endpoint).
- **Area:** new `api/idv-webhook.js`, `idv/security/webhookSignatures.js`.

### IDV-5 — Spike code minors to revisit at hardening
- **Category:** Tech debt · **Priority:** P3 · **Status:** MOSTLY RESOLVED (spike removed 2026-09-09)
- **Resolved:** the Didit spike endpoints (`api/idv-start|idv-result|idv-save.js`), `lib/didit/mapDecision.js` (speculative aliases), `lib/didit/store.js`, `lib/didit/iso3to2.js`, `IdentityVerificationStep` + its `act()`-warning test, and their tests were **deleted** (orphaned once the bands flow replaced the spike). `api/idv-result.js` broad try/catch is gone with it.
- **Remaining:** `lib/didit/diditClient.js` — `metadata:{ref}` is redundant (`vendor_data` carries the ref); verify Didit accepts it or drop. (diditClient + webhookSignature are kept — idv-match uses them.)
- **What:** Minor code-quality items deferred from the spike's whole-branch review:
  - `lib/didit/mapDecision.js` — speculative field-name aliases (`id_verification`, `liveness`, `expiry_date`, `issuing_country`, `formatted_address`, …) are untested `||` fallbacks; verify against real Didit responses or trim.
  - `lib/didit/diditClient.js` — `metadata:{ref}` is redundant (`vendor_data` already carries the ref); verify Didit sandbox accepts it or drop it.
  - `api/idv-result.js` — broad `try/catch` labels mapping/store faults as `didit_result_failed` (upstream); narrow it when hardening.
  - `src/components/idv/__tests__/IdentityVerificationStep.test.jsx` — passing test emits React `act()` warnings (async QR resolves after the act block); flush microtasks inside `act` for pristine output.
- **Why:** Harmless in the sandbox spike; worth cleaning when the integration goes real.
- **Area:** `lib/didit/`, `api/idv-result.js`, IDV component test.

### IDV-4 — First-class platform fields for identity document data (incl. review finding P8)
- **Category:** Data model / Product
- **Priority:** P2
- **Status:** OPEN
- **What:** Platform has applicant fields for name / DOB / nationality, but **none** for document number, document type, document expiry, issuing state, **gender**, place of birth, or residential address. The IDV step shows + locally persists these "extras", but only the 4 mapped identity fields reach the onboarding submission (review finding **P8**). Promote the extras to first-class applicant schema fields (with provenance) and wire them into the submit payload so they're saved with the record.
- **Why:** These are core KYC identity attributes; leaving them only in the local store means the bank form never receives them.
- **Enum mapping needed on promotion:** Didit `gender` "F"/"M" → the app's gender vocabulary (e.g. "Female"/"Male"); `document_type` "Passport" already matches `documentRequirements.js` tokens (low risk).
- **Area:** `lib/seedSchemas.js`, applicant schema, `field_provenance`, `src/components/applicant/`, `api/submit.js`, `src/components/idv/IdentityVerificationStep.jsx` (extend `MAPPED_KEYS`).

---

### SCR-1 — Verify ComplyCube live webhook + provision COMPLYCUBE_WEBHOOK_SECRET
- **Category:** Integration / Testing · **Priority:** P2 · **Status:** OPEN
- **What:** The screening webhook (`api/idv-match/screening/webhook.js`, SDK `EventVerifier`) is unit-tested with stubs but not yet verified against a real ComplyCube-signed delivery. Needs `COMPLYCUBE_WEBHOOK_SECRET` (from the ComplyCube portal — currently missing from `.env.local`) and a public webhook URL. The create→check→result path IS proven end-to-end against the sandbox.
- **Why:** Confirm live signature verification + the async completion path before production.
- **Area:** `api/idv-match/screening/webhook.js`, ComplyCube portal config.

### BANDS-1 — "I changed my name" IMAGE OCR adapter
- **Category:** Feature / Integration · **Priority:** P2 · **Status:** PARTIAL (port built; image adapter remains)
- **What:** The name-extraction **port is now built** (`api/idv-match/nameExtraction.js`) and wired into `explain.js`/`handleExplanation`: **text-layer** documents (deed-poll exports, typed transcriptions) are tokenized and the BOTH-names check works today. What remains is an **image-OCR adapter** for scanned certs/images (the seam accepts an injected `ocr(bytes, contentType)` fn). Recommended: **tesseract.js** (free, local, no paid API — but a heavy WASM dependency, so confirm before adding) or a cloud OCR (paid — needs approval). Until an image adapter exists, an image with no text routes to `unresolved_to_review` (never a false pass).
- **Area:** `api/idv-match/nameExtraction.js` (add image adapter), `IdvMatchVerification.jsx` (send bytes for image uploads).

### BANDS-2 — Verify Didit document-image field names
- **Category:** Integration / Correctness · **Priority:** P2 · **Status:** OPEN
- **What:** `api/idv-match/mediaCapture.js` extracts document-image presigned URLs from the Didit decision using candidate field names (`front_image` / `back_image` / `portrait_image`, plus a `documents[]`/`images[]` fallback). Confirm the exact keys against a real Didit sandbox response and trim/adjust; if the keys differ, images silently aren't captured (no error, just nothing stored).
- **Area:** `api/idv-match/mediaCapture.js` (`KIND_FIELDS`).

### UX-1 — One-click onboarding: reduce user interactions (remaining slices)
- **Category:** UX / Architecture · **Priority:** P2 · **Status:** OPEN (Slice 1 DONE)
- **Goal:** exception-based interaction model — the system proceeds automatically wherever it already has reliable data; the user is involved only for genuine input (upload, edit-wrong-data, missing info) or ambiguity. Target happy path ≈ 3 actions (name+country+entity → Didit selfie → consent → submit).
- **DONE — Slice 1:** Applicant dropdown → Didit-first backend auto-route (`officerMatch.pickBestOfficer`, `auto_match` snapshot). Extracted cells auto-accepted, edit retained.
- **Remaining slices (queued; do on request, in rough impact order):**
  1. **Kill the journey picker** — default to auto max-prefill research; "upload docs" becomes the low-coverage exception (the Confirm-page escape already exists). Touches `JourneyPicker`, `proceedFromJourney` (App.js), Input step.
  2. **Auto-confirm foundational facts** → exception-only (5-fact gate on Applicant page; all 5 are system-known). Surface only a disputed fact. `FoundationalFactsGate`.
  3. **Pre-fill nature/account gap fields** from research analogues (`annualRevenue→sizeAnnualTurnover`, `employees→sizeTotalEmployees`, `countriesOfOperation→natureOperatingCountries`, `sicCode→natureIndustryCodes`) — currently re-asked blank. `getCombinedGaps`/`FillGapsPage`.
  4. **Auto-advance Confirm** when nothing needs-you & no missing docs (Confirm becomes exception-only). `ConfirmStep`/`submitBlockers`.
  5. **Remove the legacy `identityVerification` step** (index 3, `idvSpike`) — redundant with inline bands IDV on the Applicant page.
  6. **Auto-proceed from verified cells** when all required applicant fields present (drop the extra confirm click).
- **Compliance guardrail (from the audit):** keep explicit user action ONLY where regulation demands it — consent checkbox, PEP self-declaration, and low-confidence/unverified sources. Everything the system is confident about is auto-confirmed silently.
- **Area:** `src/App.js`, `src/components/{applicant,companyConfirm,fillGaps}`, `api/idv-match/*`.

### BANDS-3 — Clearly-different name should demote to Band C, not neutral review
- **Category:** Bands / Correctness · **Priority:** P2 · **Status:** OPEN
- **What:** When the document name is not plausibly the same person as the CH officer (fails phonetic + transliteration + fuzzy, score below `thresholds.skipToReview`), `resolveBandB` now short-circuits to neutral **review** (`not_plausibly_same_person`) instead of opening the "what explains the difference?" dialogue — correct not to interrogate a clearly-different person. But per the bands doc this case is really **Band C** (different person → LOA path / escalation), not a silent in-review. `assignBand` still routes any `name.comparable` case to Band B before the resolver sees it.
- **Do:** route the clearly-different case to Band C (LOA path + escalation) at band-assignment time, with the verbatim Band C copy, rather than resolver-level review. Add a scenario test.
- **Area:** `api/idv-match/bandAssignment.js`, `api/idv-match/resolution.js` (`resolveBandB` short-circuit), `scenarios.nodetest.js`.

### SCR-2 — Wire screening (PEP/sanctions/adverse-media) into the live flow
- **Category:** Compliance / Integration · **Priority:** P1 (compliance hole if unwired) · **Status:** WIRED (flag-gated OFF; live sandbox proof pending approval)
- **What:** The screening module is built + sandbox-proven (Phase 3: ComplyCube adapter → check → interpret → store → webhook) and the band logic **consumes** `hasScreeningHit()` (Phase 5 hard-exclusion), but nothing **calls `startScreening`** in the applicant flow — so today the accessor always returns "no hit" and PEP/sanctions is never actually checked.
- **Why non-trivial (design decisions):**
  - **Who to screen:** the Companies House officer name, the verified *document* name, or both ("either name version" per the doc).
  - **When:** after verification (when the real identity is known).
  - **Async timing:** ComplyCube returns via webhook, so a hit can arrive *after* `resolve` ran while the band decision reads `hasScreeningHit` synchronously — needs a "screening pending → hold/review" state and a re-resolve when the hit lands.
- **Impact:** production MUST wire this or sanctions/PEP is never run. Also required for a full demo of the PEP/sanctions path.
- **Decisions locked (2026-09-11):** (1) **separate `ScreeningProvider` abstraction** + shared provider-kit, parallel to the IDV `ProviderAdapter` — do NOT force screening into the 7-method IDV contract; (2) **sync-now, monitoring-later**: screen after IDV terminal, sync result feeds band, pending → hold → re-resolve on webhook/reconcile, monitoring hook stubbed not wired; (3) **screen the verified document identity, post-IDV** (Didit-proven name/DOB); (4) **uniform hard-exclusion** for any hit for now.
- **Must-fix bug (do as part of wiring):** `resolve.js:87` passes the whole `hasScreeningHit()` object into the pipeline; `bandAssignment.js:46` does `!!(screeningHit || escalationFlag)` — a non-null object is always truthy, so once wired *every* resolve would force `hard_exclusion → review`. Pass `screeningHit.hit` (and thread `categories`/`pending`).
- **Area:** `api/idv-match/screening/index.js` (`startScreening`), `resolve.js` / `pipeline.js`, `webhook` (re-resolve on screening result).
- **Follow-ups still open:** SCR-1 (live webhook secret), SCR-3 (ongoing monitoring), SCR-4 (category policy), SCR-5 (provider-kit extraction) — all deferred, tracked below.

### SCR-3 — Screening: ongoing-monitoring + full async (deferred alternative to SCR-2)
- **Category:** Compliance / Integration · **Priority:** P2 · **Status:** OPEN (deferred by SCR-2 decision)
- **What:** SCR-2 ships "sync-now, monitoring-later". This item is the deferred half: subscribe to ComplyCube **ongoing monitoring** (`enableMonitoring`) so a watchlist change days/weeks after onboarding produces a late hit that **auto-reopens** the case for review. SCR-2 leaves the monitoring hook stubbed; wire it here.
- **Why:** real AML requires continuous screening, not a one-shot at onboarding.
- **Area:** `screening/` adapter (`getMonitoringStatus`/subscribe), webhook re-resolve path, a "reopen case" state.

### SCR-4 — Category-specific screening decision policy (deferred alternative to SCR-2)
- **Category:** Compliance / Product · **Priority:** P2 · **Status:** OPEN (deferred by SCR-2 decision)
- **What:** SCR-2 ships **uniform hard-exclusion** (any hit → review). This item replaces it with a **category → action matrix** — e.g. sanctions → hard block, PEP → enhanced-diligence review, adverse-media → analyst review, watchlist-other → review. No such policy exists in code or docs today (`bandAssignment.js` branches on none of it); needs the client/compliance owner to define the exact mapping before building.
- **Area:** `api/idv-match/bandAssignment.js`, `ScreeningObservation` categories, resolution routing.

### SCR-5 — Extract a shared provider-kit (deferred plumbing from SCR-2)
- **Category:** Architecture / Tech debt · **Priority:** P3 · **Status:** OPEN (deferred by SCR-2 decision, 2026-09-11)
- **What:** SCR-2 builds the `ScreeningProvider` contract + ComplyCube adapter + canonical model + registry (the part that makes "add a provider" real), but deliberately does NOT build the "shared provider-kit" (HMAC verify / idempotency / sandbox guard / injectable deps shared across BOTH the IDV `ProviderAdapter` family and the screening family). Reason: every one of those pieces already exists and works (ComplyCube SDK `EventVerifier`, `screening/config.assertKeyMatchesMode`, natural webhook re-pull idempotency, the `deps={}` pattern) — extracting a shared module for a single real consumer is speculative. Extract it only once a **second** screening provider (or an IDV-onto-kit migration) exists, so the common shape reveals itself instead of being guessed around ComplyCube.
- **Why deferred:** building the abstraction before two real consumers exist repeats the "leaky, refactor-later" failure mode we rejected when declining "force screening into the IDV adapter."
- **Area:** new `shared/providerKit/` (future), `idv/providers/*`, `api/idv-match/screening/*`.

### SCR-6 — No-officer-match (Band C) identities are not screened — compliance sign-off (flag-on prerequisite)
- **Category:** Compliance · **Priority:** P1 (flag-on blocker) · **Status:** DONE (implemented 2026-09-12)
- **What:** SCR-2 screens the verify_only path and the auto_match path. The remaining unscreened path was the **no-officer-match Band C** early return in `resolve.js` (`officerSnapshot.mode === "auto_match"` with `pick.matched === false`): the applicant's document didn't match any registered officer, so they're demoted to the LOA path with `escalate: true`, and the function returned **before** the screening gate — so their identity was never PEP/sanctions-screened by us.
- **Resolved:** the no-officer-match branch now runs the same shared `screeningGate()` (fail-closed hold on pending/unavailable) before deciding the outcome. A screening **hit** routes to `unresolved_to_review` (superseding the LOA path — a review + escalation task are both created); a **clear** result proceeds to the existing Band C `demoted_to_loa_path` outcome unchanged.
- **Area:** `api/idv-match/resolve.js` (no-officer-match Band C branch).

### EVID-1 — Evidence Platform integration (consume the outbox)
- **Category:** Architecture / Integration · **Priority:** P2 · **Status:** OPEN
- **What:** Phase 2.5 builds the `IdvEvidencePublisher` append-only outbox (references + provenance only, no plaintext/biometrics). Do NOT create Evidence rows / call the Evidence Platform until the **Evidence Control Room** approves the external-custody + Vault-reference contract. Consumption is deferred.
- **Area:** `api/idv-match/` evidence outbox; the `idv/` module's `IdvEvidenceIntegration` stub.

### MEDIA-1 — Production media hardening + selfie storage + retention policy
- **Category:** Security / Product · **Priority:** P2 · **Status:** OPEN
- **What:** Document images are stored in a hardened private Blob, envelope-encrypted with the **dev/test** key provider now; production needs the **real KMS** provider (see IDV-2). **Selfie/liveness storage is deferred** — the Evidence doc forbids persisting selfie media; add only later if legally justified, as a documented restricted-store exception. Document-image **retention is currently 'forever'** — revisit per the compliance/KYC record-retention period when the user specifies.
- **Area:** `api/idv-match/media/`, private Blob, key provider.

---

## Phase E findings (Evidence-contract alignment hardening)

### IDVSEC-1 — Reviewer reveal endpoint is unauthenticated
- **Category:** Security · **Priority:** P1 (blocks flag-on in prod) · **Status:** OPEN
- **What:** `api/idv-match/reviewer.js` `revealField` returns the FULL decrypted PII for a field to any caller — it trusts the `actorId` in the request rather than verifying an authenticated reviewer (the Vault audit logs a self-declared actor). `getCase` similarly needs an authenticated reviewer.
- **Why:** With the flag OFF + dev it's inert, but if `IDV_DISCREPANCY_BANDS_ENABLED` is turned on in production before real auth (OIDC, IDV-2), it is a PII-disclosure hole.
- **Fix:** gate `getCase`/`revealField` behind real reviewer auth (OIDC per IDV-2); interim stopgap = the app's existing admin authentication. Do NOT enable the flag in prod until done.
- **Area:** `api/idv-match/reviewer.js`, `src/setupProxy.js` mounts, Vercel routes.

### IDVSEC-2 — Applicant IDV endpoints keyed only by attempt UUID (no auth)
- **Category:** Security · **Priority:** P2 · **Status:** OPEN
- **What:** `resolve` / `confirm` / `explain` / `session` are unauthenticated, addressed by an unguessable attempt UUID (bearer-style), consistent with the Didit spike. Anyone holding the attempt id can drive/confirm that attempt.
- **Why:** Acceptable for the applicant's own single-use flow, but should move behind session-bound auth for production (tie the attempt to the authenticated onboarding session).
- **Area:** `api/idv-match/{resolve,confirm,explain,session}.js`.

## Platform findings from the Phase 1 audit (candidates — confirm before actioning)

Surfaced during the initial audit; recorded here so they are not lost. Not part of the IDV feature. Confirm with owner whether to schedule.

### PLAT-1 — Unauthenticated private document retrieval (`api/get-document.js`)
- **Category:** Security · **Priority:** P1 · **Status:** OPEN
- **What/Why:** Private documents are served to anyone holding the URL; no real access control. Already flagged P1 in-code as a go-live blocker.
- **Area:** `api/get-document.js`, `api/upload-document.js`.

### PLAT-2 — Weak password hashing (`lib/auth.js`)
- **Category:** Security · **Priority:** P2 · **Status:** OPEN
- **What/Why:** Non-cryptographic 32-bit rolling hash with a fixed public salt — not a KDF. Used for admin/super-admin/tenant auth.
- **Area:** `lib/auth.js`, `src/utils/auth.js`.

### PLAT-3 — No CI; ~73 node:test files + smoke scripts unwired
- **Category:** Testing / DevOps · **Priority:** P2 · **Status:** OPEN
- **What/Why:** Only 24 CRA suites + 7 IDV tests run via npm; nothing gates merges. Regressions (e.g. PLAT-4) slip through.
- **Recommended:** one aggregate test script + minimal CI.

### PLAT-4 — Pre-existing failing test on `main`
- **Category:** Correctness · **Priority:** P2 · **Status:** OPEN
- **What/Why:** `ubo-control/__tests__/ukPolicyPack16.nodetest.js:79` — SHA-256 canonical-hash pin mismatch. Fails on untouched `main`. Either the policy source changed without updating the pin, or the pin is stale.

### PLAT-5 — Inconsistent Claude model IDs across code/docs
- **Category:** Correctness · **Priority:** P3 · **Status:** OPEN
- **What/Why:** `claude-sonnet-4-5`, `claude-sonnet-4-6`, and `claude-sonnet-4-20250514` all appear. Verify each referenced model ID exists to avoid runtime 404s.

### PLAT-6 — Daily research spending cap per tenant
- **Category:** Cost / Security · **Priority:** P2 · **Status:** DONE (2026-09-22) — `lib/spendCap.js`, enforced inside `enforceRateLimit` for the buckets that reach a provider. Circuit breakers rather than working limits, at two levels: 100 calls per account per day (`SPEND_CAP_DAILY`) and 500 across every account together (`SPEND_CAP_PLATFORM_DAILY`) - per-account ceilings multiply with the number of accounts and bound nothing, so the platform one is the figure that answers "what is the worst case on our bill". Both alert at 60% and 85% so an unusual day reaches a human before anything stops, and both are raisable without a deploy. The figures are arithmetic, not measurement - see COST-1. Fails open on a storage error, like the rate limiter. Trials are metered separately by their own non-resetting budget.
- **What:** Stop Claude-backed research for a tenant once a configurable daily USD budget is reached (usage tracked from the cost/token data research already returns). Show the customer a clear message instead of failing silently.
- **Why:** Last-line safety net against a surprise Anthropic bill. The rest of the `/api/research` hardening (server-built prompt, rate limit, key required where one exists) is being built now; only this cap is deferred.
- **Area:** `api/research.js`, `lib/storage.js` (counter), tenant config.
- **Status note (Part 2):** per-caller hourly rate limits shipped on research, doc-search, self-source, ubo-discovery and generate-policy (`lib/rateLimit.js`, `RATE_LIMIT_*`). A per-tenant daily spend cap is still open.

### RERES-3 — Part 3 correction flow: known edges (final review)
- **Category:** Reliability / UX · **Priority:** P3 · **Status:** DONE (2026-09-17)
- **What:**
  - Overlapping correction saves can both snapshot the same version and hit `UNIQUE(dossier_id, version)` → `save_failed` (fails safe: the second save is refused, the customer sees the retry message).
  - The version snapshot and the dossier UPDATE are two statements, not atomic; a single CTE (snapshot + UPDATE) would close the gap.
  - Card A (upload documents) asks the dev paid-call confirm twice: once at the picker (the search is spent there) and again when research runs from the documents step.
  - The picker's cap refusal (`CONTACT_ADMIN_MSG`) posts no re-research failure flag, unlike the Applicant-page correction path.
  - Product question: after a fallback, a tenant with no `manualFormUrl` offers no manual-entry route.
  - A correction spends a new search even when an unused card-A grant is waiting (over-counts by one, never under-counts).
  - The correction change_event is posted before the deferred dossier save, so a failed save still leaves "corrected" in the audit trail; a demo-mode re-derive also posts it.
  - Resuming a saved draft on top of a link landing overwrites the server-loaded `dossierId` / `searchAttempts` with the draft's (the server still refuses a 3rd search).
  - Entering the documents step auto-runs `/api/doc-search` and `/api/self-source` for link customers and analyst Preview — rate-limited (Part 2) but not counted against the 2-search cap.
- **Area:** `api/save-dossier.js`, `src/App.js` (`proceedFromJourney`, `proceedFromDocuments`, `fallBackToManual`, `applyCorrections`, `applyResume`).
- **Resolution (2026-09-17):** snapshot + update are one statement with a single retry on a version collision (`save_conflict` after two); card A confirms once; picker/documents cap refusals post the failure flag (once per session); an unused paid search is reused by a correction; the correction event posts only after the save succeeds; with no `manualFormUrl` a failed/refused search keeps the customer on the Applicant page without prefill (owner decision); resume keeps a link landing's server `dossierId`/count; customers start document search + registry lookup with a "Find documents automatically" button (owner decision).
- **Remaining minors:** a 503 `research_grant_unavailable` leaves the grant unburned but the client drops it; the correction-path cap flag isn't de-duplicated with the picker's; the shared `Btn` doesn't set the HTML `disabled` attribute (loading clicks are ignored, not blocked); the documents button is hidden while test tools are on (local `npm start`). Also (final review): a counter failure that isn't the cap (network, 401, `grant_unavailable`, DB error) is flagged and shown as `no_searches_left` — flag only when `attemptsUsed >= cap`; a consumed grant still allows `gap_recovery` / `extract_document` for its 60-minute life (bounded by the rate limit); with no manual form link, a failed plain picker search also clears the analyst's findings; the local file store keeps `research-grant-used:*` keys forever.

### RERES-2 — `/api/research` does not itself enforce the customer's 2-search cap
- **Category:** Cost · **Priority:** P3 · **Status:** DONE (2026-09-17)
- **What:** The cap lives in `/api/search-attempt` and `/api/research-attempt`, which the client calls before re-researching. A client that skips that call can still run research, bounded only by Part 2's per-caller rate limit. Real fix: have `/api/research` require a one-time attempt grant (e.g. a short-lived signed nonce issued by the attempt endpoints).
- **Also:** fresh-customer counts are keyed by a client-held application id, so a new id gets a new allowance (PLAT-7 territory), and the storage counter is read-modify-write, not atomic.
- **Area:** `api/research.js`, `api/search-attempt.js`, `api/research-attempt.js`.
- **Resolution (2026-09-17):** the attempt counters return a one-time research grant (`lib/researchGrant.js`, 60-minute lifetime, own HMAC key derived from `RESEARCH_GRANT_SECRET` or `DOSSIER_TOKEN_SECRET`); `/api/research` refuses a link customer's call without a valid grant and burns it right before spend (a 429/400/404 doesn't burn it).
- **Still advisory:** fresh customers (no credential — PLAT-7), and a link holder who strips their credential falls back to the anonymous IP-rate-limited tier. One-time use needs shared storage (KV/Redis). A tab that opened a customer link and is later used for a bare fresh lookup still sends the customer token and gets `research_grant_required` (shown raw as "Research failed: research_grant_required").

### RERES-1 — Revisit: re-search on ANY corrected core fact (not just identity facts)
- **Category:** Product / UX · **Priority:** P3 · **Status:** DONE (2026-09-17 — owner chose "always re-search")
- **What:** Being built now (user-refined 2026-09-15): wrong company name / country / registration number / ownership type → full re-search (uses a retry); wrong entity type ONLY → re-derive from existing research (no search, no retry). Alternative to revisit: entity-type corrections also trigger a full re-search.
- **Why deferred:** Re-deriving entity type is cheaper and faster; user wants to reconsider "always re-search" later.
- **Resolution (2026-09-17):** every correction, entity type included, now re-runs research and spends one of the customer's two searches (`src/reresearch/correctionPlan.js`); the re-derive branch in `applyCorrections` was removed.
- **Area:** `src/App.js` foundational-facts correction handlers, `api/dossier-reseed.js` / `dossierLifecycle/`.

### PREB-1 — Analyst dashboard (dossiers + applications) and notifications
- **Category:** Feature · **Priority:** P2 · **Status:** OPEN (deferred by user 2026-09-15)
- **What:** (a) Password-protected analyst page listing dossiers (company, status, customer-corrected?, submitted?) that opens each one, including the analyst's original vs the customer-corrected version. (b) Email the analyst when a customer corrects data or submits (needs "which analyst sent this invite" stored — not captured today).
- **Why deferred:** Being built now is only the data link: submissions record their source `dossierId`, link customers stay linked on "start a brand-new application", and the analyst's original dossier is snapshotted before any customer re-research overwrites it. Today no screen lists dossiers or applications; the analyst can't reopen a dossier after closing the browser.
- **Area:** new analyst UI + list endpoint, `entity_dossiers`, `onboarding_sessions`, `api/invite.js`.

### PREB-2 — Revoke-link UI for customer dossier tokens
- **Category:** Feature · **Priority:** P3 · **Status:** OPEN (deferred by user 2026-09-15)
- **What:** A "Revoke link" button for analysts. The revoke endpoint + server check are being built now; only the UI is deferred.
- **Area:** `src/components/preboarding/**`.
- **Status note (Part 1):** the server side shipped — `POST /api/revoke-dossier-token { dossierId }` (analyst only) revokes every outstanding link for that dossier. Only the button is still missing.

### PREB-4 — Strip the customer link token from the address bar after landing
- **Category:** Security · **Priority:** P3 · **Status:** OPEN (found in Part 1 review 2026-09-16)
- **What:** After the customer lands on `/?tenant=<t>&dossierToken=<tok>&journey=customer`, the token is stored in sessionStorage but stays in the URL (browser history, screenshots, copy-paste). Remove only the `dossierToken` param with `history.replaceState`, keeping `tenant`/`journey` — other code re-reads `window.location.search`.
- **Why not now:** no Referer leak today (no third-party assets; default `strict-origin-when-cross-origin` strips the query cross-origin).
- **Area:** `src/App.js` landing effect.

### PREB-5 — Customer save must not write the analyst's configuration columns
- **Category:** Security · **Priority:** P2 · **Status:** OPEN (found in Part 1 final review 2026-09-16)
- **What:** A customer holding their own dossier token can overwrite `search_attempts`, `seeded_by`, `excluded_fields`, `required_documents`, `verified_data` through `POST /api/save-dossier`. Restrict the customer UPDATE to customer-editable columns; keep the retry count server-owned (Part 3 already stops the client writing `searchAttempts`).
- **Why not now:** customer can only touch their own dossier, and `/api/submit` accepts client-sent data anyway.
- **Progress (Part 3 final review 2026-09-17):** a customer UPDATE now keeps the stored `included_fields`, `excluded_fields` and `custom_questions` (and `search_attempts` is never written). Still open: `seeded_by`, `required_documents`, `verified_data` (and the other research columns).
- **Area:** `api/save-dossier.js`.

### PREB-6 — Revocation store must be shared and fail closed in production
- **Category:** Security / Deploy · **Priority:** P1 · **Status:** OPEN (deploy note, Part 1 final review 2026-09-16)
- **What:** Link revocation (`dossier-token-revoked:<id>`) lives in `lib/storage.js`. On Vercel without KV/Redis it falls back to per-instance `/tmp`, so a revoke only holds on the instance that wrote it; the filesystem backend also swallows read errors, so "fail closed on unreadable store" only holds on KV/Redis. Require KV/Redis wherever customer links are served (pairs with DEP-3).
- **Area:** `lib/storage.js`, `lib/dossierToken.js`, Vercel env.

### PREB-7 — Dossier save/resume edges (Part 4 final review)
- **Category:** Reliability / UX · **Priority:** P3 · **Status:** OPEN (found in Part 4 final review 2026-09-17)
- **What:**
  - A retried first save that hits the creation-key conflict returns the existing row without writing the retry's content, yet the UI shows "Saved" — edits made between the lost response and the retry (exclusions, custom questions) are dropped until the analyst clicks Update. Fix: `RETURNING (xmax = 0) AS inserted` and run the update branch when false, or have the client follow a reused-key create with an Update.
  - The creation key lives only in memory; a lost first-save response followed by a page reload + resume mints a new key and can create a duplicate. Fix: mint on research completion and persist it in the draft.
  - Resume doesn't restore `dossierSaved` (shows "Save Dossier" instead of "Saved") or re-read `dossierOwnedBy` (Invite stays enabled after a customer takeover; the server still refuses writes).
  - The draft now carries the full `selfSourceResults`; large results raise the localStorage quota risk (a failed write silently keeps an older draft). Stop persisting `blob:` upload URLs.
  - No test exercises the shared/queued in-flight save (no analyst control can overlap a save; the customer correction path is the only real overlap).
- **Area:** `api/save-dossier.js`, `src/App.js` (`saveDossier`, draft save / `applyResume`), `src/utils/submissionDraft.js`.

### PLAT-8 — `api/change-intelligence-metrics.js` has no server-side auth
- **Category:** Security · **Priority:** P2 · **Status:** OPEN (pre-existing, found in Part 1 final review 2026-09-16)
- **What:** Aggregates all change events (including dossier-keyed ones) and is guarded only on the client. Put it behind admin auth. Also: `api/get-document.js:14-25` comment still says dossier context is unauthenticated — refresh when blob access control (PLAT-1) lands.
- **Area:** `api/change-intelligence-metrics.js`, `api/get-document.js`.

### PLAT-7 — Fresh (no-link) applications can't be keyed: change-events / amendment-documents rely on unguessable ids
- **Category:** Security · **Priority:** P2 · **Status:** OPEN (known limit, accepted 2026-09-15)
- **What:** Dossier-linked applications get their change records and amendment-document reads locked to the customer token / analyst password. Fresh customers (no analyst link) have no credential, so their `onboardingSubmissionId`-keyed writes/reads stay protected only by the random id + rate limit.
- **Real fix:** customer accounts or a server-minted per-application session token issued at research start.
- **Accepted risk (user decision 2026-09-16):** change-events / amendment-documents look up a `submissionId` against `entity_dossiers` before resolving the caller, so an anonymous caller can tell "this id is a dossier" (401) from a fresh application (200). No data or write access leaks; ids are random UUIDs (old `?dossierId=` emails expose some to ex-invitees). Closed by the real fix above.
- **Area:** `api/change-events.js`, `api/amendment-documents.js`, `src/App.js` onboardingSubmissionId.

### PREB-3 — Per-tenant pre-boarding analyst password
- **Scheduled 2026-09-23:** to be done together with PLAT-2, on the owner's decision. They touch the same three login routes, so doing them as one change means one round of testing and one moment where stored passwords are rewritten, rather than two. AUTH-2 (sessions) is already done and is what makes these two the whole of the remaining password work.
- **Note on what AUTH-2 did and did not fix:** a session now names the company it was issued for, so one cannot be replayed against another tenant. It does not stop an analyst simply logging in again against a different tenant with the same shared password - that is this item.
- **Category:** Security · **Priority:** P2 · **Status:** OPEN (deferred to polish phase by user 2026-09-15)
- **What:** Replace the single server-checked `PREBOARDING_PASSWORD` with a password per tenant (set from admin/super admin, stored hashed with a real KDF — see PLAT-2), so an analyst for tenant A can't enter tenant B's pre-boarding.
- **Being built now instead:** `/preboarding?tenant=<id>` entry, per-tenant pre-boarding on/off switch, server check that the tenant exists and is active, analyst session bound to the verified tenant — with one shared analyst password.
- **Area:** `api/preboarding-auth.js`, `lib/auth.js`, tenant settings UI.
- **Status note (2026-09-16):** the tenant-scoped entry, registry checks and server-side gate shipped in Part 5; only the per-tenant password remains.
- **Pre-boarding default (owner decision 2026-09-17):** pre-boarding is ON by default for every tenant — existing tenants with no stored flag, newly created tenants, and legacy back-filled entries. A super-admin can switch a tenant OFF from its card in `/super-admin` ("Disable pre-boarding"); that explicit choice is never overwritten. Unknown or inactive tenants still can't open it. No per-tenant action is needed after deploy.

### BRAND-1 — Neutralize residual "Nium" brand naming (make the product brand-neutral / config-driven)
- **Category:** UX / Architecture · **Priority:** P3 · **Status:** OPEN (discuss before actioning — 2026-09-12)
- **What:** The hardcoded-tenant-**default** bug is fixed (3-strict tenant resolution; no `tenant || "nium"` fallback anywhere; brand falls back to the tenant id). What remains is "Nium" baked in as **product/brand naming**, unrelated to tenant resolution — a rebrand question, not a default-logic defect:
  - `src/App.js` — `C.niumBlue` color token, "Powered by Nium Intelligence Platform", the `nium_api` journey type, `niumRegNumber` field, and a `nium_invite_` localStorage key prefix.
  - Likely more across the codebase (search `nium`/`Nium` case-insensitive; exclude the intentional `seedConfig`/`buildDefaultConfig` Nium reference-tenant seed and `api/config.js` seedTenant policy).
- **Why deferred:** this is a "should the product itself be brand-neutral / fully config-driven" decision, larger than the tenant-leakage fix. Needs a product call on how far to go (rename tokens/keys, make product name config-driven, migrate the `nium_invite_` storage key without breaking existing links, etc.).
- **Action:** revisit with the user before implementing — they asked to discuss again later.
- **Area:** `src/App.js` (+ a repo-wide sweep).
- **Status note (2026-09-16, task 14 brand-consistency pass):** two more hardcoded strings pinned down, both apparently dead/unreachable today rather than live customer-facing copy — confirm reachability before acting on either:
  - `src/App.js:4486` — "Powered by Nium Intelligence Platform", inside `renderLandingPage()`. That function is defined but has no call site anywhere in `App.js` — the analyst agent-selection hub it renders looks parked, matching the "PARKED" note already on `PreboardingGate`'s back-to-agent-selection button (`src/components/preboarding/PreboardingGate.jsx`), which points at this same screen.
  - `src/components/Step2DynamicForm.jsx:492` — "Nium will retrieve these for you" (section heading). It sits inside a JSX comment block explicitly marked "hidden for now per request, but kept here for future use ... To restore, un-comment this block" (lines 485-489), so it does not render either.
  - Separately (not a Nium string, but the same brand-consistency sweep): `ApplicantPage.jsx`'s three reused `DocumentUploadCard` call sites (Signatory ID, Authority-to-act x2) were not passing `brandName` through — fixed in task 14 by threading `brandName` from `App.js`'s `companyName_` the same way `Step2DynamicForm.jsx` already receives it.

## Part 2 final review findings (AI-endpoint hardening, 2026-09-16)

### UBO-1 — UBO discovery defaults tenant to "nium" and trusts a client-supplied tenantId
- **Category:** Security · **Priority:** P2 · **Status:** DONE (2026-09-21) — `api/ubo-discovery.js` takes the company from the signed-in actor (`requireStaff`, `requireTenant: true`) and never from the request body. A local lab with no Clerk configured needs `UBO_DEV_TENANT_ID` set explicitly; absent both, the request is refused rather than defaulted. The entry below is the original report, kept for the record.
- **Status was stale until 2026-09-22:** the fix shipped but this entry still read OPEN, so the backlog disagreed with the code. Noticed while listing what was left to do.
- **What it was:** `api/ubo-discovery.js` did `const { ..., tenantId = "nium", ... } = req.body || {}` — it both defaults an unnamed tenant to `"nium"` (the tenant-resolution rule elsewhere in this codebase is strict: no tenant named is refused, never defaulted) and accepts `tenantId` straight from the request body, so an anonymous caller can write UBO audit rows (`appendAudit`, `persistUboInvestigation`) attributed to any tenant it likes. `public/ubo-lab.html` and the UBO lab's `START_LIVE` operation send no tenant at all and rely on the `"nium"` default, so fixing the endpoint means fixing both together.
- **Also:** the body `tenantId` has no type or length check before it reaches storage keys and the UBO audit insert.
- **Area:** `api/ubo-discovery.js`, `public/ubo-lab.html`, `ubo-control-lab/server/labEngine.js` (`startLive`).

### UBO-2 — UBO lab doesn't surface a 429 to the user
- **Category:** UX · **Priority:** P3 · **Status:** DONE (2026-09-22; reported in the Part 2 final review 2026-09-16)
- **What:** `public/ubo-lab.html` and the UBO lab's `START_LIVE` operation don't special-case a rate-limited response from `/api/ubo-discovery`; a 429 surfaces as a generic "No completed result was returned" / failure rather than telling the user to slow down or retry later.
- **Area:** `public/ubo-lab.html`, `ubo-control-lab/server/labEngine.js`.
- **Update 2026-09-20:** the server half is done. A 429 now carries `scope`, `limit`, `retryAfterSeconds` and a readable `message` ("You have used all 15 requests for this hour. Try again in 12 minutes."). What remains is client-side: show `body.message` instead of collapsing every non-200 into "No completed result was returned".

### AUTH-1 — No brute-force protection on admin password checks
- **Category:** Security · **Priority:** P2 · **Status:** DONE (2026-09-20) —  guards all three login routes: 5 failures per account per 15 minutes, 20 per address per hour, counted on failures only and cleared by a success. Fails open on a storage error, deliberately: locking every admin out of every tenant during a KV blip is worse than a guessing window, and the failure is logged. Wiring is covered end to end in , because a correct library proves nothing if a route forgets to call it. The duplicate  comparisons were already merged onto one constant-time check in Batch 0.
- **What:** `/api/admin-auth` and `/api/benchmark`'s admin password check both return a fast, unlimited 401 on a wrong password — nothing throttles repeated guesses against `ADMIN_PASSWORD` / a tenant's hashed password. Now that the comparisons are constant-time (this review's item (b)), the only remaining exposure is guess volume, not timing.
- **Also:** PARTLY FIXED 2026-09-18 — the three `authorizeAdmin` copies (config, config-templates, config-versions) now delegate to `lib/adminAuth.js`, so the two `===` comparisons are gone. The env-password `===` checks in `api/admin-auth.js`, `api/super-admin-auth.js` and `api/tenants.js` remain, as does the absence of any throttle: both are Batch 1 of the readiness plan.
- **Area:** `api/admin-auth.js`, `api/benchmark.js`, `api/config.js#authorizeAdmin`, `api/config-templates.js`, `api/config-versions.js`, `api/super-admin-auth.js`, `api/tenants.js`.

### PERF-1 — Research endpoint cost/ordering inefficiencies
- **Category:** Performance · **Priority:** P3 · **Status:** OPEN (found in Part 2 final review 2026-09-16)
- **What:** Several small inefficiencies in `api/research.js`'s request path: (1) it reads the tenant config from KV before validating the request body, so a malformed request still costs one KV read; (2) a preview analyst without a dossier credential shares the per-IP research rate-limit bucket with every other unauthenticated caller on that IP; (3) both a cache hit and a validation failure still count against the caller's research rate limit, even though neither spends an Anthropic call; (4) rate-limit caller identity trusts `x-forwarded-for`, which is only safe behind Vercel's own edge (spoofable if ever exposed elsewhere).
- **Also:** the research cache key has no tenant config version, so after a schema publish, results cached under the old schema can be served for up to 30 days. Add `_version` to the key (or clear the tenant's rows on publish).
- **Area:** `api/research.js`, `lib/rateLimit.js`, `lib/researchCache.js`.

---

## Process enforcement (working agreement — `docs/HOW-WE-BUILD.md`)

These four make the working agreement enforced rather than remembered. Until
they exist, every rule in that file depends on someone recalling it.

### PROC-1 — `CLAUDE.md` rewritten as a true map of the system
- **Category:** Process / Docs · **Priority:** P1 · **Status:** OPEN (agreed 2026-09-18)
- **What:** `CLAUDE.md` still describes a single-file app with one serverless function and "no tests"; the repo is 660+ files with several suites. Every agent starts from a wrong map and burns turns rediscovering the truth. Rewrite it as boundaries and invariants only — where each concern lives, what there is exactly one of, the Guarded path list, what must never happen — plus a pointer to `docs/HOW-WE-BUILD.md`. Keep it one page; long maps rot.
- **Why:** cheapest change in the programme — it pays back on every task afterwards.
- **Area:** `CLAUDE.md`, optionally a short `api/CLAUDE.md`.

### PROC-2 — Lint + covering tests run automatically after each edit
- **Category:** Process / Tooling · **Priority:** P1 · **Status:** OPEN (agreed 2026-09-18)
- **What:** a Claude Code hook that runs lint and the tests covering an edited file straight after the edit, so mistakes surface in seconds instead of at review. Needs a fast targeted test command (`test:fast`) alongside the existing full suite.
- **Why:** removes a whole review → fix → re-review cycle for ordinary slips without weakening any gate.
- **Area:** `.claude/settings.json` hooks, `package.json` scripts.

### PROC-3 — Rule-tests that encode what reviewers currently check by eye
- **Category:** Process / Security · **Priority:** P1 · **Status:** DONE (2026-09-18) — `api/__tests__/routeTable.nodetest.js` carries the first five rules. Still to add as they come up: every `*.nodetest.js` is covered by a `package.json` glob, and every `process.env.X` appears in `.env.example`.
- **What:** executable invariants, starting with the route table Batch 0 needs anyway: every `api/` route declares who may call it; no route reads the tenant from the query string; nothing writes PII to browser storage; every new table carries a tenant column; no logging of whole request bodies. Then every `*.nodetest.js` is covered by a `package.json` glob, and every `process.env.X` appears in `.env.example`.
- **Why:** each rule retires a class of human review permanently and catches what a tired reviewer misses — it raises the floor while removing work. Standing rule: every bug found adds one.
- **Area:** `api/__tests__/`, `lib/__tests__/`, `package.json`.

### PROC-4 — Automatic checks blocking a merge
- **Category:** Process / CI · **Priority:** P1 · **Status:** PARTIAL (2026-09-18) — checks run, enforcement blocked on the GitHub plan
- **Done:** `.github/workflows/ci.yml` runs the node suite, the IDV suite, the frontend suite and a production build on every pull request; green on run 35310296155 in 2m47s. A `main protection` ruleset requiring the `tests and build` check was created.
- **Blocked:** GitHub does not enforce rulesets on a private repository owned by a personal account — "Your rulesets won't be enforced on this private repository until you move to GitHub Team organization account." The ruleset is saved and starts enforcing by itself once the repo moves to an organization on Team (~$4/user/month). Until then a red merge is prevented by agreement only, not by the platform.
- **Note:** moving the repo to an organization is worth doing on its own merits — a company codebase owned by a personal account is a finding in investor technical due diligence (readiness plan 6.10).
- **What:** no `.github/` exists. Add build, full test suite, lint, dependency scan and migration check on every pull request, with a red result blocking the merge. No secrets in the workflow.
- **Why:** makes the "full suite before merge" rule compulsory instead of voluntary, and moves the waiting off session time.
- **Area:** `.github/workflows/`, repository settings (owner).

### PROC-5 — `package-lock.json` is incomplete; CI cannot use `npm ci`
- **Category:** Build / CI · **Priority:** P2 · **Status:** OPEN (found by the first CI run, 2026-09-18)
- **What:** `npm ci` fails on Linux with "Missing: @emnapi/core@1.11.3 … from lock file". `@napi-rs/wasm-runtime` is in the lock and declares `@emnapi/core`/`@emnapi/runtime` as dependencies, but those entries are absent. Regenerating the lock on Windows does not add them (`npm install --package-lock-only`, with and without `--os=linux --cpu=x64`, reports "up to date"; deleting the lock and regenerating produced a gutted 27-line file, which was restored from backup, not committed). CI therefore runs `npm install --no-audit --no-fund`.
- **Why it matters:** without `npm ci` the dependency tree is resolved fresh on every run, so CI can install patch versions the local machine has never used — a green run here is not proof of the same tree there. It also makes installs slower.
- **Fix:** regenerate the lockfile in a Linux environment (a one-off `workflow_dispatch` job that runs `rm -rf node_modules package-lock.json && npm install` and commits the result, or the same in a container), confirm `npm ci` succeeds, then restore `npm ci` in both jobs of `.github/workflows/ci.yml`.
- **Area:** `package-lock.json`, `.github/workflows/ci.yml`.

---

## Found while building UBO trial access (2026-09-20)

### TEST-1 — Node tests write to the real filesystem store
- **Category:** Test hygiene · **Priority:** P2 · **Status:** PARTIAL — fixed in `api/__tests__/ubo-discovery-tenant.nodetest.js` only
- **What:** Several `node:test` suites exercise handlers that reach `lib/storage.js`, which falls back to `.config-store.json` locally. Cached results and rate-limit counters therefore survive between runs and between suites. One UBO test was passing because an earlier run of the same test had cached the answer — it had quietly stopped testing what it claimed to.
- **Why it matters:** a test that passes for the wrong reason is worse than no test. It also makes the suite order-dependent and unrepeatable on a clean machine.
- **Fix:** give the affected suites an injected in-memory store, the way `lib/__tests__/rateLimit.nodetest.js` does. Candidates: anything touching `research`, `ubo-discovery`, `search-attempt`, `research-attempt`.
- **Area:** `api/__tests__/*`, `lib/storage.js`.

### PLAT-9 — Dead `"nium"` defaults in the UBO persistence keys
- **Category:** Security / Tidiness · **Priority:** P3 · **Status:** DONE (2026-09-22, as part of BRAND-2) — `agents/ubo/uboPersistence.js` now calls `requireTenant()`, which throws. A cache key with no workspace in it is a key SHARED between customers, so refusing is right and substituting a name never was.
- **Status was stale until 2026-09-24.** Third time in this programme that the backlog disagreed with the code (UBO-1, PROC-7, this). Worth a habit: close the entry in the commit that does the work, not afterwards.
- **Original report:**
- **What:** `agents/ubo/uboPersistence.js` builds cache keys with `normalise(tenantId || "nium")` in both `resultKey` and `entityKey`. UBO-1 made the route always pass a real tenant, so the default is unreachable from `api/ubo-discovery.js` — but it is still there for any future caller that forgets.
- **Why:** the same defaulting that UBO-1 was about. An unreachable bad default is a trap, not a safety net.
- **Area:** `agents/ubo/uboPersistence.js`. Owned by the UBO side — worth raising rather than editing.

### PLAT-10 — Five pre-existing lint errors in `api/idv-match/`
- **Category:** Code quality · **Priority:** P3 · **Status:** OPEN
- **What:** `identityVault.js` calls a function named `useDurable` from four non-component functions, which trips `react-hooks/rules-of-hooks` (it is not a React hook; the name is the problem). `media/index.js` uses `globalThis`, which the CRA ESLint env does not declare.
- **Why:** they are the only errors in the repo, so "lint is clean" currently needs an asterisk, and an asterisk is how real errors hide.
- **Fix:** rename `useDurable` to `withDurable`, and declare the env for the media module.
- **Also, found 2026-09-22:** a third instance of the same naming problem - `api/ubo-control-lab.js` calls `usePreingestedBettercommsArtifact` from its handler. Same fix (rename off the `use` prefix), same reason: a function that is not a React hook must not be named like one.
- **Area:** `api/idv-match/identityVault.js`, `api/idv-match/media/index.js`, `api/ubo-control-lab.js`.

### PROC-6 — Two mains, drifting
- **Category:** Process · **Priority:** P1 · **Status:** OPEN (decision taken 2026-09-20: keep two repos for now)
- **What:** `archukmurthy/kyc-agent` holds the UBO work; `ManasBorole/kyc-agent-remote` holds that plus the tenancy and security work. Ours merged theirs on 2026-09-20; theirs has none of ours. Both sides are committing.
- **Why:** every day of parallel work makes the eventual reconciliation larger. Today's auth work already touched files the other side owns (`src/index.js`, three `api/ubo-*` routes, `package.json`, `vercel.json`).
- **Options:** send our work as a PR into theirs; or agree one main and have the other fork from it.
- **Also open, both on the other repo:** PR #64 holds ~370 lines that never reached their main, including "Keep ambiguous chart ownership provisional", which reads like a real fix; and `vercel.json` now carries both `routes` and `rewrites`, a combination Vercel has historically refused — it came from their side and will be found on the first deploy.

---

## UBO trial go-live (2026-09-20)

Real prospects will use this in production, with our API key and their own
documents. These are the gates. Owner items are marked; the rest are ours.

### GOLIVE-1 — Provision KV or Redis before any link is sent
- **Category:** Infra · **Priority:** P0 · **Status:** OPEN (owner)
- **What:** One Vercel integration and one env var. No code change.
- **Why:** every control built on 2026-09-20 counts through `lib/storage.js`. Without a shared store each serverless instance counts separately: 5 password guesses *per instance* rather than 5 in total, and each caller's hourly allowance *per instance*. The limits work locally and are weaker in production in proportion to how many instances are running. Duplicate of DEP-4/PREB-6; repeated here because this is the gate it blocks.

### GOLIVE-2 — Set a hard spend cap in the Anthropic console
- **Category:** Cost · **Priority:** P0 · **Status:** OPEN (owner)
- **What:** A monthly budget ceiling on the provider account itself.
- **Why:** everything we build can fail - a bug, a missed route, a storage outage that fails open. A provider-side ceiling cannot be coded around. Worth doing even if nothing else on this list is.

### GOLIVE-3 — Clerk cannot run a production instance on vercel.app
- **Category:** Security / Auth · **Priority:** P0 · **Status:** OPEN (owner decision)
- **What:** Clerk production instances require a domain you own with DNS records. `vercel.app` cannot have DNS records added, so a vercel.app trial must use a development instance.
- **Why it matters:** per Clerk's own documentation, development instances are "not suitable for production workloads": capped at 100 users, user data cannot be transferred to a production instance later (prospects would re-register), some social logins use shared credentials, and **the session token travels in the query string** (`__clerk_db_jwt`) instead of a cookie - "can be seen directly in server logs, browser history, internet providers' logs, and could be potentially intercepted by third-parties".
- **Recommended:** buy a domain (~10/year), point a subdomain at Vercel, use a production instance. For a KYC product being evaluated by compliance buyers, a session token in the URL is the wrong first impression.
- **If not:** run the trial on the dev instance, keep it to a handful of named contacts, and expect them to re-register later.

### GOLIVE-4 — Add the trial domain to ALLOWED_ORIGINS
- **Category:** Deploy · **Priority:** P1 · **Status:** OPEN (owner)
- **What:** The CORS allow-list refuses unknown origins now, including our own new site if it is not listed.

### GOLIVE-5 — Decide whether the trial deployment gets a DATABASE_URL
- **Category:** Deploy · **Priority:** P1 · **Status:** OPEN (decision)
- **What:** With one, `api/ubo-discovery.js` writes audit rows and migration 009 must be applied there. Without one it skips persistence cleanly (the route already reports "DATABASE_URL not configured").
- **Why:** either is fine. Deciding by accident is not.

### GOLIVE-6 — Somewhere to see errors during a trial
- **Category:** Observability · **Priority:** P1 · **Status:** OPEN
- **What:** Minimum: know how to read Vercel function logs. Better: an alert on error rate.
- **Why:** if something breaks at 9pm mid-evaluation we currently find out from the prospect, or not at all.

### GOLIVE-7 — Decide what happens to prospects' uploaded documents
- **Category:** Privacy · **Priority:** P1 · **Status:** OPEN (decision)
- **What:** Prospects may upload real ownership charts naming real people. That is personal data in our blob store. Decide retention, deletion at trial end, and what we tell them.
- **Why:** they will ask, and the answer should exist before the question.

### GOLIVE-8 — Confirm the Evidence Lab is unreachable on the deployed URL
- **Category:** Security · **Priority:** P1 · **Status:** OPEN
- **What:** A test asserts the vercel.json denial and the .vercelignore rules; nothing has confirmed it against a real deployment. One curl after the first deploy.

### TEST-2 — Heavy frontend suites time out under parallel load
- **Category:** Test hygiene · **Priority:** P2 · **Status:** OPEN (seen 2026-09-20)
- **What:** In a full `npm test` run the suite failed after 56s; run alone it passes 9/9 in a few seconds, and an immediate re-run of the full suite passed 742/742. It is slow enough that Jest's default timeout is reached when workers compete for CPU.
- **Why it matters:** a flaky test is worse than a missing one. Once people learn that a red run might mean nothing, red runs stop being read - and the CI gate we just built depends on red meaning something.
- **Fix:** find what takes tens of seconds (likely a real timer or a large fixture rendered repeatedly), and either fake the timers or shrink the fixture. Raising the timeout hides it rather than fixing it.
- **Seen twice, on different suites (2026-09-20):** `PolicySimulator.test.jsx` failed at 56s in one full run; `src/uboDemo/UboDemoRoot.test.jsx` failed at 61s in the next. Each passes alone in seconds (9/9 and 35/35), and a re-run of the full suite passed 742/742. Two different suites means this is about how the suite is run, not one badly written test.
- **Likely cause:** Jest defaults to a worker per core; on a machine already running a dev server and a watcher, each worker gets a fraction of a CPU and a 5s default timeout is reached by any test doing real rendering work.
- **Fix options, in order of honesty:** find what actually takes tens of seconds and fix it (real timers, large fixtures re-rendered per test); or cap workers (`--maxWorkers=50%`) so each gets enough CPU. Raising the timeout hides it rather than fixing it, and the CI gate depends on red meaning something.
- **Note:** CI itself has been green throughout (3 minutes, dedicated runner). This bites locally and would bite a busier CI machine.
- **Area:** `src/policySimulator/PolicySimulator.test.jsx`, `src/uboDemo/UboDemoRoot.test.jsx`, `package.json` test script.

### DB-1 — Baseline the migration ledger on each database
- **Category:** Deploy · **Priority:** P1 · **Status:** OPEN (owner decision)
- **What:** `db/migrationRunner.js` records what it has applied in a `schema_migrations` table. Every existing database was migrated by hand before the runner existed, so that table starts empty and all 34 files look pending. `npm run db:migrate -- --baseline` records them as applied WITHOUT running them. It must be run once per database, before the first real `db:migrate`.
- **Why it matters:** running the migrations instead of baselining would re-apply the whole history against a live database. Most files are idempotent (`IF NOT EXISTS`) but not all, and a partial run leaves a database nobody can describe.
- **Dev status (2026-09-21):** DONE. All 34 migrations are recorded; `npm run db:migrate -- --dry` reports nothing pending. Two of them (`002_cost_breakdown.sql`, `003_persistence_now.sql`) were applied accidentally during development before the baseline - both idempotent, no DROP/TRUNCATE/DELETE, no data affected. The other 32 were baselined without running.
- **Production:** verify the later migrations' tables and columns actually exist before baselining. On dev the cost of a wrong guess is visible breakage; on production it is a missing table under live traffic.
- **How it happened:** `node -e "require('./db/migrate-all.js')"` was used to check the file loaded. It runs on import, so it started migrating. `db/migrate-all.js` now only runs under `require.main === module`.

### UBO-RET-1 — Make the seven-year retention period configurable
- **Category:** Compliance / Config · **Priority:** P3 · **Status:** OPEN (raised with the decision, 2026-09-22)
- **What:** Retention is fixed at seven years, hard-coded with a comment, on the product owner's instruction ("For now nothing gets deleted for 7 years leave it for configuration to define later date, hard code 7 years with comment and backlog item to make it configurable"). Nothing is ever hard-deleted; rows carry `deleted_at` and stay.
- **Why later:** a retention period that varies per deployment is a compliance question, not a setting. It becomes configurable when a customer's own policy requires a different figure.
- **Area:** UBO persistence layer (see `docs/ubo/SCHEMA-PROPOSAL.md`).

### UBO-DB-1 — Schema proposal awaiting the product owner
- **Decision taken 2026-09-25 (owner):** **Way B — UBO owns its own tables and refers to other modules by plain text, never by a database link.** Written up as section 0 of `docs/ubo/SCHEMA-PROPOSAL.md`, which is where the migrations will be written from.
- **What it resolves:** the Production Readiness Solution Guide describes one shared structure (Case, Parties, Evidence, IDV, Audit together, UBO holding IDV session references, one correlation id across modules). That reads as a single product and contradicts the standing requirement that UBO is sellable on its own. Separation was chosen.
- **The three rules:** UBO owns every table it writes to; references to Evidence and IDV are text and are never followed; `case_id` and `correlation_id` are given to UBO and stamped on its output, never looked up by it.
- **Cost accepted:** a company or person known to both modules is stored twice. Duplication you can see beats a join you cannot remove.
- **Still to confirm with the product owner**, since the guide reads the other way. Nothing has been built on this decision yet - it is recorded so the first migration does not quietly assume the opposite.
- **Category:** Database · **Priority:** P1 · **Status:** OPEN (proposal written, nothing applied)
- **What:** `docs/ubo/SCHEMA-PROPOSAL.md` proposes seven tables in a separate `ubo` schema: workspaces, users, cases, decision_snapshots, artifacts, extractions, research_runs, jobs. Every shape is taken from something `ubo-control/` already emits or something the demo currently loses on refresh.
- **Blocked on:** approval, plus five open questions in section 7 of that document.
- **Diagnosis behind it:** `public.ubo_investigations` exists with 21 columns, zero rows, and no `SELECT` anywhere in the repository - a write-only audit log nobody reads. The engine's DecisionSnapshot is genuinely store-as-is (its id is the hash of its own contents), so audit history is a small job once she is ready for it. The most painful thing currently lost on refresh is an uploaded chart and its extraction.

### COST-1 — Record token usage per provider call, and cap money rather than calls
- **Category:** Cost · **Priority:** P2 · **Status:** OPEN (raised 2026-09-22 while setting the ceilings)
- **What:** `lib/spendCap.js` counts calls. A research run and an entity-match call both count as one, and one costs perhaps ten times the other. The honest unit is money.
- **Why it is not done yet:** nothing records the token usage the API returns on each call, so there is nothing to price. `src/utils/costs.js` has the per-million rates; what is missing is capturing `usage` from each response server-side and storing it against the call.
- **Consequence today:** every figure in the ceilings is arithmetic rather than measurement - roughly 0.12-0.25 USD per research call, so 100/day is about 12-25 USD per account. Nobody has checked that against a real invoice.
- **Worth doing for a second reason:** the same data is what the cost-per-onboarding model needs (readiness plan item 6.9), so it pays for itself twice.
- **Area:** `api/research.js`, `api/generate-policy.js`, `agents/ubo/webResearchOwnershipAdapter.js`, `lib/spendCap.js`, `src/utils/costs.js`.

### PLAT-11 — `/api/ubo-invite` was never mounted in the dev server
- **Category:** Platform · **Priority:** P3 · **Status:** DONE (2026-09-22) — mounted in `src/setupProxy.js` alongside the new `/api/ubo-people`.
- **What happened:** invariant 1 in CLAUDE.md says every file added to `api/` is mounted in `src/setupProxy.js`. `api/ubo-invite.js` was not, so `/ubo-trials` returned a 404 under `npm start` while working in production. Found while adding the people screen, not by a test.
- **Worth noting:** the route table test checks that every route *declares a caller*; nothing checks that every route is *mounted*. That gap is PROC-7.

### PROC-7 — Nothing checks that an api/ route is reachable in dev
- **Category:** Process · **Priority:** P3 · **Status:** DONE (2026-09-22) — see the fuller entry lower in this file. This one was left OPEN when the work landed; a duplicate entry is how a backlog starts lying.
- **What:** `api/__tests__/routeTable.nodetest.js` enforces that each file under `api/` declares who may call it. It does not enforce the other half of invariant 1 — that the route is mounted in `src/setupProxy.js` — so a route can 404 in dev for weeks while working in production (PLAT-11).
- **Fix:** one more assertion in the same test: every `api/*.js` appears in `src/setupProxy.js`, with a named exception list for the cron-only routes (`finalize-submissions`) exactly as the open-route list works today.
- **Why it is not done in this change:** it will fail on more than one existing route, and turning that list green is its own piece of work rather than a rider on the people screen.

### TEST-3 — A test was making a real call to Clerk's API
- **Category:** Testing · **Priority:** P2 · **Status:** DONE (2026-09-22) — `getUser` is now stubbed in the `requireStaff` harness.
- **What happened:** adding the verified-email lookup put a Clerk API call on the no-access path. `lib/__tests__/routeAuth.nodetest.js` had no stub for it, so the suite reached out to Clerk on every run and logged `[clerk] could not read the email for a user: Unauthorized`. It passed either way, which is what made it easy to miss.
- **Same shape as TEST-1** (tests writing to the real store): a seam that exists is not the same as a seam the test uses.


### UBO-3 - An expired trial could research forever, and its budget was never counted
- **Category:** Security / Cost - **Priority:** P1 - **Status:** DONE (2026-09-22) - enforced in `lib/rateLimit.js#enforceRateLimit`, the one gate every paid route already calls.
- **What was wrong:** `lib/uboTrials.js#statusFor` computed `expired`, `readOnly` and `budgetLeft`, and the only thing reading it was `/api/ubo-invite?action=status` - which feeds the banner on the screen. No route checked it. `recordSpend` existed and was called by nothing, so the trial budget was never decremented. A prospect whose seven days were up could keep spending our money, and "100 research runs" was decoration.
- **How it was found:** writing the row-15 attack suite (`api/__tests__/adversarial.nodetest.js`). Not by review, not by a reader - by a test that tried it.
- **Now:** a paid route refuses a read-only trial with 403 `trial_ended` / `trial_budget_spent` and a message that treats the end of a trial as a sales moment; a live trial's call is counted.

### UBO-4 - The daily spend ceiling did not apply to trial users
- **Category:** Cost - **Priority:** P1 - **Status:** DONE (2026-09-22) - `callerKey` resolves the workspace from `lib/userAccess.js`, falling back to Clerk's org claim.
- **What was wrong:** `callerKey` set `tenantId: session.orgId || null`. Trial users are not in a Clerk organisation - their workspace lives in our access list - so `tenantId` was null, and `enforceRateLimit` skips the entire spend-cap block when it is. The ceiling built the day before applied to nobody it was built for.
- **Lesson worth keeping:** two sources of truth for "which workspace", one of them Clerk's. CLAUDE.md says there is exactly one access list; this was a second one, hiding in a single expression.

### SEC-1 - `x-forwarded-for` was trusted for the rate-limit bucket
- **Category:** Security - **Priority:** P3 - **Status:** DONE (2026-09-22) - `x-vercel-forwarded-for` is preferred where present.
- **What was wrong:** an anonymous caller who sends their own `x-forwarded-for` gets a new rate-limit bucket per request, and therefore no limit. Vercel overwrites the header, so production was not exposed - but the code stated no such assumption, and it is wrong on any other host, including the dev server.
- **Note:** the platform header cannot be forged by a caller. The old header is still read as a fallback, so nothing changes where a proxy sets it legitimately.

### OBS-1 - A failure during a trial was unfindable
- **Category:** Observability - **Priority:** P1 - **Status:** DONE (2026-09-22) - `lib/requestLog.js`, wired into the three UBO routes, plus `GET /api/health`.
- **What was wrong:** failures were `console.error("[ubo-people]", message)` with nothing to correlate them, and `api/ubo-discovery.js` logged the whole error object - which can quote the company being researched, the customer's confidential work - and returned the raw internal message to the caller.
- **Now:** one structured line per failure carrying a request id, the route, the status and the ids involved, and nothing anybody typed; the caller gets the same id as a `reference` they can quote. `GET /api/health` answers booleans only and returns 503 when the store is unreachable, so an uptime check can be pointed at it.
- **Remaining, and it is the owner's:** somewhere for those lines to raise an alarm. Reading them still means opening the Vercel dashboard (GOLIVE-6).


### BRAND-2 - The third Nium removal, and the first one with a guard
- **Category:** Security / Brand - **Priority:** P1 - **Status:** DONE (2026-09-22)
- **Why a third time:** the two earlier passes removed instances and installed nothing to stop the next one. Both fixed *tenant resolution* - which customer a request belongs to - and neither touched cache keys, admin branding, the undeployed Evidence Lab, or a SQL literal. "Removed" meant "removed the ones we found that day".
- **The guard:** `api/__tests__/brandDefaults.nodetest.js`. Two rules: no `|| "<brand>"` default anywhere that ships, and no brand name in text a person reads. It found six sites in its first run that a manual search had missed, including the SQL literal below. Exemptions are listed in the file with reasons: the real vendor client, `PLATFORM_TENANT_IDS` (a named list, not a fallback), and the server-side password salt.
- **Removed - defaults:** `agents/ubo/uboPersistence.js` (2, the only ones in the UBO path - a cache key with no workspace is a key *shared between customers*, so it now refuses); `api/evidence/*` (13, via one `evidenceLabTenantId()` that throws); `api/admin-auth.js` (the platform tenant is now whichever one `PLATFORM_TENANT_IDS` names, its display name from `PLATFORM_COMPANY_NAME`); `src/admin/AdminDashboard.jsx`.
- **Removed - visible text:** the admin header showed "Nium" to any tenant with no company name set; "pre-loaded with Nium defaults"; the config template's label and id (`nium-default` to `default`, old spellings still resolve - see `canonicalTemplateId`); the wizard's "Nium will retrieve these for you"; the journey card "Nium API Lookup"; four status and error strings during a lookup; the validation lab's prefilled form.
- **Removed - colour token:** `niumBlue` to `brandBlue` across 33 files. Invisible in any interface, but a rename away from gone, so it went rather than earning an exemption.
- **Kept, deliberately:** `lib/niumClient.js`, `agents/ubo/niumOwnershipAdapter.js`, `agents/kycLookupAgent.js`, the `/api/nium/*` routes and the `nium_api` journey identifier. Nium is a real third-party company-lookup service we pay for; naming the client after the supplier it calls is as correct as naming a Companies House client after Companies House, and `nium_api` may be recorded in stored journeys.
- **Verified:** `grep -i nium build/static/js/*.js` returns only those vendor identifiers - no display text, no defaults.

### SEC-2 - A hard-coded correction naming two real people shipped in every browser bundle
- **Category:** Privacy / Security - **Priority:** P1 - **Status:** DONE (2026-09-22) - removed from `src/pipeline.js`.
- **What it was:** a "KNOWN ISSUE GUARD" block in the research prompt, fired when the company being researched matched `/nium\s*fintech/i`. It named two real individuals, asserted which of them had resigned as a director, gave a UK company number, and instructed the model accordingly.
- **Why it matters:** it was a claim about a named person's employment, hard-coded in the product, compiled into every customer's browser bundle and sent to a third-party model on every matching run. It got there from one bad result during a demo.
- **What covers the same error now:** the three general director rules immediately below it (RULE 2 is resigned directors) with `validateAllDirectors()` as the deterministic backstop. If a specific company ever needs a correction again, it belongs in data a reviewer can see and change - not in a prompt compiled into the bundle.

### SEC-3 - A password salt shipped to the browser, in dead code
- **Category:** Security - **Priority:** P2 - **Status:** DONE (2026-09-22) - `src/utils/auth.js`.
- **What was wrong:** the frontend mirrored the server's `hashPassword`/`verifyPassword`, salt included, so a password-hashing secret was in the bundle any visitor can read. Nothing imported either function - only `generatePassword`, which needs no secret.
- **Fixed by deleting the dead code.** The server-side copy (`lib/auth.js`) is untouched, so no stored hash changes and nobody is locked out.
- **Found by** the brand guard, which flagged the salt for containing a company name. The brand was the least of it.
- **Still open, separately:** both copies used a 32-bit string hash rather than a password hash. That is PLAT-2.

### SEC-4 - A tenant written into SQL as a literal
- **Category:** Security - **Priority:** P2 - **Status:** DONE (2026-09-22) - `lib/persist.js`, `api/benchmark.js`.
- **What was wrong:** every row `persistBenchmarkEntity` wrote - across `benchmark_runs`, `clients` and `onboarding_sessions` - carried `tenant_id = 'nium'` written into the SQL text. A benchmark run by any customer was filed under one particular company, and the lookup that de-duplicates clients searched that company's rows.
- **Now:** the caller passes the tenant it already resolved, and the function refuses without one.
- **Found by** the brand guard on its first run. Two manual cleanups had walked past it.

### SEC-5 - The API would have let somebody create the platform's own workspace
- **Category:** Security - **Priority:** P3 - **Status:** DONE (2026-09-22) - `api/tenants.js`.
- **What was wrong:** the create-tenant screen refused the platform workspace id, and the API did not. `RESERVED_TENANT_IDS` held the three URL path names only, so a tenant created through the API could have collided with the platform's own.
- **Now:** the reserved set includes `PLATFORM_TENANT_IDS`, and the client list holds only the path names, with the server as the authority.


### UBO-5 - A reached limit looked exactly like a crash
- **Category:** UX / Revenue - **Priority:** P1 - **Status:** DONE (2026-09-22) - `src/trials/limitNotice.js`, `src/uboDemo/UboDemoRoot.jsx`.
- **What was wrong:** the demo screen had one error panel for everything. An ended trial produced "Research unavailable / We could not complete this research", the machine code printed in front of the sentence (`trial_ended: ...`), and a "Try live research again" button that could only fail again. Introduced the same morning the server refusals were added (UBO-3).
- **Why it mattered more than it looks:** the end of a trial is the best moment we get - somebody who wants more is telling us they are interested. It read as broken software.
- **Now:** four refusals get their own panel with a heading that names what happened, the server's own sentence (it has the dates and numbers, so only one place writes them), and an action that can work: "get in touch" for a trial that has ended or spent its budget, "try again" only for limits that lift by themselves. Genuine failures still say plainly that something went wrong - "please wait" over a real break is worse than the break.
- **Also fixed on the way:** the client read the refusal code from `result.code` only, while the rate limiter names itself in `result.error`. A 429 therefore arrived with no code at all and was shown as a crash. It now reads both.
- **Worth tidying one day:** two response shapes for the same idea. One would be better, but changing the rate limiter's shape reaches further than this change should.

### UBO-6 - The trials screen could not show whether anyone was using the trial
- **Category:** Product - **Priority:** P2 - **Status:** DONE (2026-09-22) - `lib/uboTrials.js#listInvites`, `src/trials/TrialAdmin.jsx`.
- **What was missing:** seats taken (3 of 5) but not research runs used. Seats say how many people arrived; runs say whether any of them did anything.
- **Why now:** the number only became real this morning. Until UBO-3 the spend was computed but never counted, so "100 research runs" was decoration.
- **Now:** a "Research runs" column (34 / 100), and a "nearly used up" flag at 85% - the same threshold the spend ceiling alerts on, so one number means one thing across the product. An invite created before the count existed reads as 0, not as blank.

### PROC-7 - Nothing checked that an api/ route is reachable in dev
- **Category:** Process - **Priority:** P3 - **Status:** DONE (2026-09-22) - `api/__tests__/routeTable.nodetest.js`.
- **What:** the route table enforced that every route declares who may call it, and nothing enforced the other half of invariant 1 - that it is mounted in `src/setupProxy.js`. A route could 404 locally for weeks while working in production (PLAT-11).
- **Estimate I got wrong:** I said this would fail on several routes and be its own piece of work. Measured instead of guessed: 66 handlers, exactly one unmounted - `finalize-submissions`, which is cron-only and correctly excluded. The test went green immediately with one named exception, and a second test checks that exception still names something real.


### UBO-7 - We broke the demo's live research, and nothing noticed for four days
- **Category:** Regression - **Priority:** P0 - **Status:** DONE (2026-09-22) - `api/ubo-control-lab.js`.
- **What happened:** Batch 0 (18 Sept, commit `00014bd`) put `requireAdmin` in front of `/api/ubo-control-lab`, with the stated reasoning that it was "an internal tool with no caller in the app". That was true of our tree that day. Your partner's UBO demo - which calls that route for every live research run - was merged in on the 23rd, and nobody rechecked. Since then, "Start research" in live mode has been answering **400 `tenant_required`**: the page sends no tenant and no admin password, and the gate demands both.
- **Why no test caught it:** every test in front of it mocks the network. The screen tests assert what the screen does with an answer; the route tests assert what the route does with a request. Nothing checked that the request the screen sends is one the route accepts.
- **Now:** `requireStaff`, the same gate its siblings use - these screens are reached by signed-in trial users, not by an administrator with a shared password.
- **Lesson worth keeping:** "no caller in the app" was a true statement about a moving tree. A reason that depends on what has been merged so far needs re-checking after the next merge, and nothing made that happen.

### UBO-8 - No UBO screen sent the Clerk token, so the trial would have died on launch
- **Category:** Security / Launch - **Priority:** P0 - **Status:** DONE (2026-09-22)
- **What was wrong:** `requireStaff` is deliberately inert while `CLERK_SECRET_KEY` is unset, which is what lets the demo run locally with no accounts. Three screens called staff-gated routes and sent no token: the demo's research call, the ownership chart upload, and the chart comparison. They worked only because the gate was off. **Setting that key is the first thing the trial deployment does** - at which point all three would have answered 401 and the product would have been dead on arrival.
- **Now:** every UBO call carries `clerkAuthHeaders()`, the helper the trials and people screens already used. It returns nothing while Clerk is unconfigured, so local behaviour is unchanged.
- **The test that would have caught all of this:** `api/__tests__/uboScreensReachTheirRoutes.nodetest.js` - each UBO route paired with the screen that calls it, checking the gate against the call. It also checks the mapping itself is current, because a stale mapping tests nothing.

### UBO-9 - The path prospects actually use had no limiter at all
- **Category:** Cost - **Priority:** P0 - **Status:** DONE (2026-09-22)
- **What was wrong:** `/api/ubo-control-lab` reaches Anthropic through its `START_LIVE` operation and had no `enforceRateLimit` call. So the per-person limits, the trial budget and end date (UBO-3) and the daily spend ceilings (UBO-4, row 14) applied to `/api/ubo-discovery` - and the demo does not use that route. Everything built this week to bound the bill missed the path prospects were going to run.
- **Now:** a light bucket on the route (mostly local computation on fixtures and replays) and, for `START_LIVE` only, the **same** `ubo-discovery` allowance as the direct route. Sharing the bucket deliberately: two routes onto one provider must not hand one person two allowances.
- **Found by:** asking what else was left to do without the schema, and reading the call sites rather than trusting a route table.

### DOC-1 - Nothing told a new person how to run this
- **Category:** Documentation - **Priority:** P2 - **Status:** DONE (2026-09-22) - `docs/RUNNING-LOCALLY.md`.
- **What was missing:** no README, no setup guide. Which settings are needed, which you invent yourself, which cost money, what runs without a database, where each screen lives, how to apply the schema, and which known failures are expected - all of it lived in somebody's head or had to be reassembled by reading the code.
- **Written because** the product owner is being sent the branch to run, and the alternative was a wall of instructions in a chat message that she would lose.
- **Includes the honest section:** the pre-existing lint errors, `npm ci` not working, and the Evidence Lab being refused on purpose. An unexplained failure wastes an afternoon.

### AUTH-2 — The login endpoints hand back the password as the session token
- **Category:** Security · **Priority:** P2 · **Status:** DONE (2026-09-23) — all three logins mint a session from `lib/session.js`; nothing accepts a password as a bearer.
- **What shipped:** `authorizeAdmin`, the analyst path in `lib/dossierAccess.js` and `requireSuperAdmin` in `api/tenants.js` all verify a session and check its role, and a session names the company it was issued for, so one tenant's cannot open another's. `POST /api/sign-out` ends one session and leaves colleagues working. Sessions expire after a working day. `SESSION_SECRET` (falling back to `DOSSIER_TOKEN_SECRET`) signs them, with the key derived per purpose so a customer's dossier link can never verify as a staff session.
- **Behaviour change worth knowing:** without either secret, every login now answers 500 with `SESSION_SECRET not configured` rather than working. Deliberate — issuing sessions nobody can verify is worse than failing loudly.
- **What it cost:** 22 tests failed on the first run, every one of them a test that authenticated by putting a password in the Authorization header. One asserted `res.body.token === PASSWORD` — the vulnerability written down as a requirement. `api/__tests__/_sessions.js` mints the real thing for tests that need to be signed in.
- **Found the same way it was fixed:** `GET /api/config` is deliberately open (the customer wizard reads it with no login), so the first live check appeared to show the password still working. It was testing a route with no gate. The verification is only worth what the route you point it at is.
- **Still open, and deliberately separate:** PREB-3 (one shared analyst password across every tenant — the session is now tenant-scoped, but the password that earns it is not) and PLAT-2 (the stored hash is not a password KDF).
- **Originally recorded 2026-09-22 while verifying the pre-boarding flow end to end:**
- **What:** `POST /api/admin-auth` and `POST /api/preboarding-auth` answer a successful login with `{ success: true, token: "<the password they just typed>" }`. Every later call carries it as `Authorization: Bearer <password>`. The password **is** the session.
- **Why it matters, in order:**
  - There is no way to sign somebody out, or to end one session, without changing the password for everybody who shares it.
  - The password is re-transmitted on every single request rather than once at login, so it is in far more places: proxy logs, any error report that captures headers, the browser's memory, and — as this was found — a terminal transcript.
  - It cannot expire. A password captured once is valid until somebody thinks to rotate it.
  - It is indistinguishable from the real credential, so a leaked bearer token is a leaked password.
- **Fix:** mint a short-lived signed session on successful login and return that instead. `lib/dossierToken.js` already does exactly this shape for customers — signed, expiring, revocable — so there is a working pattern in the codebase to copy rather than a design to invent. `lib/session.js` exists from earlier work and was paused.
- **Do it with PREB-3 and PLAT-2**, which touch the same three login routes: one change that gives per-tenant analyst passwords, a real key-derivation function, and a session that is not the password.
- **Note:** this is what leaked an admin password into a session transcript on 2026-09-22. Nothing was exposed outside that session, and the value is a local development password, but it is worth rotating when the three items above are done.


### UBO-10 - An unconfigured deployment let anyone create trial invites
- **Category:** Security - **Priority:** P0 - **Status:** DONE (2026-09-24) - `lib/routeAuth.js#requireStaff`.
- **What was wrong:** the staff gate is deliberately inert while `CLERK_SECRET_KEY` is unset, so the demo runs locally with no accounts. It did that by returning an "unauthenticated" actor - a truthy object. Every caller checks it as `if (!(await requireStaff(req, res, { roles: ["owner"] })))`, and a truthy object is not falsy, so **every role check passed**. On a deployment without Clerk configured, anyone could `POST /api/ubo-invite` with no credentials at all and mint themselves a trial: any number of seats, any number of days, any research budget. A trial is a workspace plus a spending allowance, so that is money.
- **The route's own comment claimed the opposite:** *"The owner actions are checked HERE, on the server... anyone can post to this route directly, and creating invites is how somebody would help themselves to our Anthropic budget."* True with Clerk on. False without it, which is the state a misconfigured or freshly-deployed environment is in.
- **How it was found:** by asking what UBO work remained and then calling the live route with no credentials, rather than reading the code again. Proved by two invites it should never have created - 50 seats and 100,000 research runs - since removed.
- **The rule now:** you cannot check a role you cannot establish. A `requireStaff` call that names roles refuses when there is no identity to have one; a call that names none stays inert, which is what the demo depends on.
- **Second test alongside it:** every owner-gated UBO route must DECLARE its roles to `requireStaff` rather than checking them itself afterwards - a route doing its own check after an unroled call would be waved through exactly as before.
- **Why it matters beyond this route:** GOLIVE-3 is still open, and the answer to it may involve redeploying with different Clerk settings. This was the failure mode that would have made a Clerk misstep expensive rather than merely inconvenient.


### UBO-11 - Three routes demanded a workspace they never read
- **Category:** Correctness / Clarity - **Priority:** P3 - **Status:** DONE (2026-09-24)
- **The sibling of UBO-10.** That one was about roles; this is the same shape one flag over. `requireTenant: true` cannot be enforced when the login is switched off - `requireStaff` returns before it is reached - and `api/ubo-control-lab.js`, `api/ubo-demo-customer-ownership-chart.js` and `api/ubo-demo-entity-resolution.js` all asked for it and then never read a tenant at all.
- **Why it mattered even though nothing was exposed:** a reader sees `requireTenant: true` and believes the request is scoped to one company. It was not. The thing that actually scopes those routes is the rate limiter, which resolves the caller and their workspace itself. A promise the code does not keep is worse than no promise, because the next person builds on it.
- **Now:** the three drop the flag with a comment saying what does scope them. `api/ubo-discovery.js` keeps it, reads it, and handles the switched-off case explicitly with `UBO_DEV_TENANT_ID`.
- **Enforced:** a test walks every route in `api/` and fails any that asks for a tenant without reading one.
- **The rule, written where it is used** (`lib/routeAuth.js`): roles are refused when there is no identity; a tenant is allowed through as null, because the one route that reads it handles that - but a route that will not read it must not ask.

## UBO demo integration (2026-09-29)

The partner's UBO POC (`codex/ubo-demo-integrated`, `ef14ef2`) is merged with
our platform work and becomes the base of a demo real testers use with real
documents. Owner decisions, taken in discussion and recorded here so they are
not lost with it:

- **Home branch:** `codex/ubo-demo-integrated`. Merged locally, tested, then pushed; `dev/local-work` stops.
- **Calculations move to the server.** Today the browser computes the assessment and the server stores it as sent.
- **Customer access:** server-created case id; a signed, single-case, revocable, **recipient-bound** link, valid 30 days (configurable). Opening it sends a one-time code to the recipient's email; the session it starts lasts hours, not 30 days. The partner agreed.
- **IDV:** demo is the skip button only, switched on the server (`UBO_POC_IDV_MODE`), recorded as `DEMO - not verified`. Real is Didit + ComplyCube; a customer's own provider later, as an adapter.
- **Data:** tester uploads are real personal data. Kept during the trial; buyers keep everything (7-year rule); non-buyers deleted 90 days after the trial ends, backups included, legal holds respected.
- **Demo limits:** 25 research runs in total across all testers, and a separate 25 chart uploads in total. Companies House lookups are free and uncounted.
- **Infrastructure:** its own Vercel project and database holding UBO + Evidence only, never KYC tables. Treated as a demo database; a buyer's data moves to the real one later. Vercel address with Clerk's development banner until a domain is bought (GOLIVE-3).
- **Partner's answers:** Way B holds for the real product (text references to Evidence, no cross-product foreign keys); in-process package now, transport-neutral interface; analyst read-only on customer facts after handoff but may add notes, request information or reopen (new version + audit event); automatic review stays in the demo, labelled provisional; sample companies and replays hidden behind a staff-only flag; UK companies only; no proof-of-address, and never claimed; `pr62` stays out.

### UBO-12 - The UBO demo's own endpoints have no gate
- **Category:** Security - **Priority:** P0 - **Status:** DONE (2026-09-29) - Clerk + rate limit + tenant from the caller (`uboCallerTenant`, never on Vercel for the dev fallback) + 3 MB cap; health takes only `UBO_POC_HEALTH_KEY`. Verified against a real database that one workspace cannot read or write another's case.
- **What:** `api/ubo-poc-case.js` reads and writes any case by id with no sign-in, tenant or limit, taking its tenant from `process.env.TENANT_ID || "nium"` (`ubo-control-lab/server/pocCaseState.js`). `api/ubo-poc-health.js` accepts `ADMIN_PASSWORD` as its key and calls paid providers unmetered. Neither is in the route table, so `routeTable.nodetest.js` is red on the merge commit.

### UBO-13 - The server trusts what the browser says
- **Progress (2026-09-30):** identity verification is decided on the server - demo mode must be switched on (`UBO_POC_IDV_MODE=DEMO`, unset refuses), the person must be in the stored assessment, the server applies the completion to its own stored trace and records `DEMO - not verified`. The rest (research, chart, resolution) is plan steps 3-7.
- **Category:** Security / correctness - **Priority:** P0 - **Status:** OPEN
- **What:** the assessment, the questions, IDV completion and `actorType` are all supplied by the browser and stored as sent. Decided: calculations move to the server; IDV completion is recorded only when the server's mode allows it.

### UBO-14 - Two `fetchWithTimeout` helpers with different signatures
- **Category:** Duplication - **Priority:** P3 - **Status:** OPEN
- **What:** `lib/providerCall.js#fetchWithTimeout(url, opts, config)` and `agents/ubo/boundedAsync.js#fetchWithTimeout(fetchImpl, url, opts, config)`. The merge kept hers in the web-research adapter. Pick one.

### UBO-15 - One live run may be charged twice to the discovery allowance
- **Category:** Cost - **Priority:** P2 - **Status:** OPEN - verify first
- **What:** `START_LIVE` in `api/ubo-control-lab.js` spends the `ubo-discovery` bucket, then its nested call to `api/ubo-discovery.js` (now carrying the caller's headers) spends it again. The demo path (`START_DEMO_REVIEW_LIVE`) only spends it once, in the nested call. Settle on one place, which matters once the demo cap is 25 runs in total.

### UBO-16 - Chart-job polling spends the rate limit
- **Category:** Cost / UX - **Priority:** P1 - **Status:** OPEN
- **What:** one upload makes up to 12 POSTs to `ubo-demo-customer-ownership-chart` while polling; each passes `enforceRateLimit("ubo-demo-chart")`, which allows 15 an hour. The demo cap must count uploads, not status polls.

### UBO-17 - Chart jobs are reachable by id alone
- **Category:** Security - **Priority:** P1 - **Status:** DONE (2026-09-29) - the job service is built per request with the caller's tenant (`uboCallerTenant`) and refuses to exist without one; its `"nium"` default is gone.
- **What:** `GET/PROCESS/RETRY_EXTRACTION_JOB` take a `jobId` and never check it belongs to the caller's tenant.

### UBO-18 - Audit writes are fire-and-forget on a serverless platform
- **Category:** Correctness - **Priority:** P2 - **Status:** OPEN
- **What:** `schedulePersistence` in `api/ubo-discovery.js` starts the cache, audit and database writes after the response is sent. On Vercel the function can be frozen once it has responded, so an audit record can be silently lost. Use the platform's `waitUntil`, or await the audit write.

### UBO-19 - The migration runner cannot build a UBO-only database
- **Category:** Deploy - **Priority:** P1 - **Status:** OPEN (before the demo database is migrated)
- **What:** `npm run db:migrate` applies every file in `db/migrations/`, which would put KYC tables into the UBO database. `ubo-dev` was built by calling `migrationRunner.run` with only 001, 009, the evidence files and 021. That needs to be a supported option, not a one-off.

### UBO-20 - The brand-default test does not look where the partner's code lives
- **Category:** Process - **Priority:** P1 - **Status:** DONE (2026-09-29) - the scan now covers `ubo-control-lab/`, `evidence/` and `integrations/`. It found three more in Evidence (a2 identity, a2 service, a4a fixtures), all fixed.
- **What:** `brandDefaults.nodetest.js` skips `evidence/`, `ubo-control-lab/` and `scripts/`, which hold `TENANT_ID || "nium"` and `tenantId = "nium"` today. Widen the scan and remove them.

### UBO-21 - Two of the partner's tests are run by no script
- **Category:** Process - **Priority:** P2 - **Status:** DONE (2026-09-29) - both added to `scripts/run-ubo-demo-critical.js`.
- **What:** `evidence/customerOwnershipJobs/__tests__/service.nodetest.js` and `evidence/a3/__tests__/ownershipChartProfile.nodetest.js`.

### UBO-22 - The case wrapper and client carry no sign-in, and names sit in browser storage
- **Category:** Security / privacy - **Priority:** P1 - **Status:** PARTLY DONE (2026-09-29) - wrapper inside the gates, client sends the token. Names in `localStorage` remain; so does the active case id across a sign-out.
- **What:** `DurablePocCaseBoundary` wraps the tree outside `ClerkGate`; `pocCaseClient.js` sends no Clerk headers; `localStorage` holds the case pointer, research session and trace, including people's names (invariant 5).

### UBO-23 - The live POC is public and unmetered today
- **Category:** Security / cost - **Priority:** P0 - **Status:** OPEN - owner action, not code
- **What:** `ubo-poc-v1.vercel.app` has no sign-in and no limits, and makes paid Anthropic calls. Until the hardened demo replaces it, turn on Vercel password protection for that project.

### UBO-24 - A case id taken in another workspace answers 500
- **Category:** Security (low) / UX - **Priority:** P3 - **Status:** OPEN - goes away with server-created case ids
- **What:** `ubo_poc_cases.case_id` is the primary key on its own. A write to an id another workspace owns fails on the key (nothing written, nothing read) but answers 500 where an unknown id answers 200, so it confirms the id exists elsewhere. Ids are random UUIDs made in the browser, so it needs a leaked id. Fixed properly when the server creates case ids (the signed customer link work); otherwise key on `(tenant_id, case_id)` or answer 409.
- **Found by:** adversarial review of UBO-12.

### EVID-TENANT-1 - Evidence Lab collection uses a sandbox workspace when none is given
- **Category:** Security - **Priority:** P2 - **Status:** OPEN - must close before KYC uses Evidence collection
- **What:** `evidence/a2/identity.js` defaults `tenantId` to `"evidence-lab-sandbox"` (it was `"nium"`). Only the undeployed Evidence Lab reaches it today. Before any product path (the KYC integration) calls a2 collection, it must pass the caller's tenant and the default must go.

### EVID-LAB-1 - Two Evidence Lab API tests fail, and no suite runs them
- **Category:** Process - **Priority:** P3 - **Status:** OPEN
- **What:** `evidence/a2/__tests__` "A2 fixture API is explicitly labelled..." and `evidence/a4a/__tests__` "selection API returns persisted options..." fail on `dev/local-work` too, so they predate the UBO merge. None of the `evidence/*/__tests__` folders except the two UBO ones is in any script, so nobody sees them. Decide whether the Evidence Lab suite runs in CI; if it does, fix these first.
