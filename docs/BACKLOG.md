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
- **Category:** Tech debt · **Priority:** P3 · **Status:** OPEN
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

### BANDS-1 — "I changed my name" document name-extraction (OCR)
- **Category:** Feature / Integration · **Priority:** P2 · **Status:** OPEN
- **What:** The Band B `changed_name` path (`api/idv-match/explain.js` → `handleExplanation`) checks whether an uploaded marriage-cert/deed-poll contains BOTH names. Name extraction from the uploaded document is an injectable seam (`extractNames`) that is **not yet implemented** — until it is, `changed_name` with a real upload routes to `unresolved_to_review` (safe default, never a false pass). Wire real extraction (Didit document read or an OCR/name-match service) so a valid linking document resolves `same_person_name_change_evidenced`.
- **Area:** `api/idv-match/explain.js`, `resolution.js handleExplanation`.

### EVID-1 — Evidence Platform integration (consume the outbox)
- **Category:** Architecture / Integration · **Priority:** P2 · **Status:** OPEN
- **What:** Phase 2.5 builds the `IdvEvidencePublisher` append-only outbox (references + provenance only, no plaintext/biometrics). Do NOT create Evidence rows / call the Evidence Platform until the **Evidence Control Room** approves the external-custody + Vault-reference contract. Consumption is deferred.
- **Area:** `api/idv-match/` evidence outbox; the `idv/` module's `IdvEvidenceIntegration` stub.

### MEDIA-1 — Production media hardening + selfie storage + retention policy
- **Category:** Security / Product · **Priority:** P2 · **Status:** OPEN
- **What:** Document images are stored in a hardened private Blob, envelope-encrypted with the **dev/test** key provider now; production needs the **real KMS** provider (see IDV-2). **Selfie/liveness storage is deferred** — the Evidence doc forbids persisting selfie media; add only later if legally justified, as a documented restricted-store exception. Document-image **retention is currently 'forever'** — revisit per the compliance/KYC record-retention period when the user specifies.
- **Area:** `api/idv-match/media/`, private Blob, key provider.

---

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
