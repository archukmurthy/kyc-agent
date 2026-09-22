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
- **Category:** Cost / Security · **Priority:** P2 · **Status:** OPEN (deferred by user 2026-09-15)
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
- **Category:** Security · **Priority:** P2 · **Status:** OPEN (found in Part 2 final review 2026-09-16)
- **What:** `api/ubo-discovery.js` does `const { ..., tenantId = "nium", ... } = req.body || {}` — it both defaults an unnamed tenant to `"nium"` (the tenant-resolution rule elsewhere in this codebase is strict: no tenant named is refused, never defaulted) and accepts `tenantId` straight from the request body, so an anonymous caller can write UBO audit rows (`appendAudit`, `persistUboInvestigation`) attributed to any tenant it likes. `public/ubo-lab.html` and the UBO lab's `START_LIVE` operation send no tenant at all and rely on the `"nium"` default, so fixing the endpoint means fixing both together.
- **Also:** the body `tenantId` has no type or length check before it reaches storage keys and the UBO audit insert.
- **Area:** `api/ubo-discovery.js`, `public/ubo-lab.html`, `ubo-control-lab/server/labEngine.js` (`startLive`).

### UBO-2 — UBO lab doesn't surface a 429 to the user
- **Category:** UX · **Priority:** P3 · **Status:** OPEN (found in Part 2 final review 2026-09-16)
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
- **Category:** Security / Tidiness · **Priority:** P3 · **Status:** OPEN
- **What:** `agents/ubo/uboPersistence.js` builds cache keys with `normalise(tenantId || "nium")` in both `resultKey` and `entityKey`. UBO-1 made the route always pass a real tenant, so the default is unreachable from `api/ubo-discovery.js` — but it is still there for any future caller that forgets.
- **Why:** the same defaulting that UBO-1 was about. An unreachable bad default is a trap, not a safety net.
- **Area:** `agents/ubo/uboPersistence.js`. Owned by the UBO side — worth raising rather than editing.

### PLAT-10 — Five pre-existing lint errors in `api/idv-match/`
- **Category:** Code quality · **Priority:** P3 · **Status:** OPEN
- **What:** `identityVault.js` calls a function named `useDurable` from four non-component functions, which trips `react-hooks/rules-of-hooks` (it is not a React hook; the name is the problem). `media/index.js` uses `globalThis`, which the CRA ESLint env does not declare.
- **Why:** they are the only errors in the repo, so "lint is clean" currently needs an asterisk, and an asterisk is how real errors hide.
- **Fix:** rename `useDurable` to `withDurable`, and declare the env for the media module.
- **Area:** `api/idv-match/identityVault.js`, `api/idv-match/media/index.js`.

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
- **Category:** Database · **Priority:** P1 · **Status:** OPEN (proposal written, nothing applied)
- **What:** `docs/ubo/SCHEMA-PROPOSAL.md` proposes seven tables in a separate `ubo` schema: workspaces, users, cases, decision_snapshots, artifacts, extractions, research_runs, jobs. Every shape is taken from something `ubo-control/` already emits or something the demo currently loses on refresh.
- **Blocked on:** approval, plus five open questions in section 7 of that document.
- **Diagnosis behind it:** `public.ubo_investigations` exists with 21 columns, zero rows, and no `SELECT` anywhere in the repository - a write-only audit log nobody reads. The engine's DecisionSnapshot is genuinely store-as-is (its id is the hash of its own contents), so audit history is a small job once she is ready for it. The most painful thing currently lost on refresh is an uploaded chart and its extraction.
