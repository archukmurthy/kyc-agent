# BACKLOG.md

Persistent source of truth for deferred work, agreed future improvements, tech debt, and hardening tasks for the kyc-agent project. Reviewed before significant new development. Items are updated (not deleted) as they progress.

**Status legend:** `OPEN` · `IN PROGRESS` · `DONE` · `WONTFIX`
**Priority:** `P0` (blocker) · `P1` (high) · `P2` (medium) · `P3` (low)

---

## Open dependencies (waiting on external input)

### DEP-1 — Confirm/obtain a writable test database for IDV results
- **Category:** Dependency / Infra · **Priority:** P1 · **Status:** OPEN (waiting on client)
- **What:** Client-provided Neon DB (`ep-blue-mouse-abxjk5d5-…eu-west-2`) — unknown whether it is test or shared/prod. Need confirmation it's safe to write test rows, or a dedicated Neon branch connection string.
- **Why:** IDV spike must persist mapped fields + extras; we won't write to a possibly-real DB unconfirmed.
- **Interim:** spike builds against a local file/in-memory store; Neon wiring flipped on once confirmed. No blocking.
- **Area:** spike persistence layer, `.env.local` `DATABASE_URL`.

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
