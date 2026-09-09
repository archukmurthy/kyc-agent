# IDV Discrepancy Bands — Build Tracker

Single source of truth for what we're building and what's done. Tick items as completed. Each phase runs spec → plan → build → review, all behind `IDV_DISCREPANCY_BANDS_ENABLED` (default OFF).

- Spec (external): `C:\Users\manas\Downloads\claude-code-instruction-idv-discrepancy-bands.md`
- Decisions: memory `idv-discrepancy-bands-decisions`
- Deferred work / debt: `docs/BACKLOG.md`

**Legend:** `[ ]` todo · `[~]` in progress · `[x]` done

---

## Already done (foundation)
- [x] Didit IDV spike (integration, mapper, store, routes, wizard step, QR) — 19 commits
- [x] Full flow analysis (current vs new) + design conversation
- [x] All build decisions finalized + recorded

---

## A. Bands core (9 phases)

### Phase 1 — Foundations  `[x] done (migration applied to idv-dev, round-trip verified)`
- [x] Add `IDV_DISCREPANCY_BANDS_ENABLED` flag (default OFF) — `api/idv-match/config.js`
- [x] Migration 013 : `idv_verification_attempts` — file written (apply pending)
- [x] Migration 013 : `idv_match_decisions` (outcome-type enum CHECK) — file written (apply pending)
- [x] Migration 013 : `idv_applicant_explanations` — file written (apply pending)
- [x] Officer-id capture in CH adapter + snapshot builder (`officerSnapshot.js`, month/year birth only)
- [x] Versioned policy config file (`getPolicy()` accessor, `policyVersion`) — `api/idv-match/policy.js`
- [x] Attempt data-access (`api/idv-match/attemptStore.js`) — code + guard tests
- [x] Apply migration 013 to DB (applied to Neon `idv-dev` schema-only branch; round-trip verified)
- [ ] Phase 1 code review (optional)

### Phase 2 — Didit session rework  `[x] done (migrations applied to idv-dev, verified)`
- [x] Server-created session bound to application + attempt + officer snapshot (browser can't create/modify) — `session.js`
- [x] Signed webhook ingestion (verify signature, reject stale/replay) — `webhook.js` + `webhookSignature.js`
- [x] Polling fallback (`reconcile.js`); refresh endpoint read-only (`status.js`, no PII)
- [x] Result from one attempt can never satisfy another (routing by `didit_session_id`, per-attempt result)
- [x] Re-add MRZ extraction (hidden from UI, server-side only)
- [x] Compare document-extracted attributes, never echoed metadata (mapper reads `id_verifications`)
- [x] Migrations 014 (result cols) + 015 (webhook dedupe) applied to `idv-dev`; guarded integration green
- [ ] Phase 2 code review (optional)

### Phase 3 — ComplyCube screening  `[x] done (SDK; sandbox proof: hit detected; migration 016 applied)`
- [x] Research ComplyCube screening API
- [x] Adapter (SDK client + check) + result interpreter (`interpret.js`) + config test/live guard
- [x] `hasScreeningHit()` accessor + `startScreening()` orchestrator (`index.js`)
- [x] Screening store + migration 016 (applied to idv-dev); webhook (EventVerifier); dev mount
- [x] Env wired (`COMPLYCUBE_API_KEY`, `SCREENING_*`); real sandbox call proved create→check→result→interpret (hit)
- [ ] Live webhook verification — deferred (needs `COMPLYCUBE_WEBHOOK_SECRET` + public URL; see BACKLOG SCR-1)
- [ ] Phase 3 code review (optional)

### Phase 2.5 — Evidence-compatible architecture (PIVOT — build to the "IDV - Evidence" doc)
Adopt the existing `idv/` module foundation; refactor the plaintext PII from Phases 1-3. Comes before Phase 4 (comparison reads the canonical model / Vault).
- [x] Adopt `idv/` module Vault (dev = synthetic in-memory + LocalTestManagedKeyProvider) — store text PII as **opaque Vault references**, never plaintext — *sub-step 1: `api/idv-match/identityVault.js` wrapper; wired via `persistDecision` in sub-step 3*
- [x] Canonical types via the module: ExtractedIdentityAttribute / VerificationObservation / ProviderDecision / ExternalEvidenceReference / lifecycle events — *sub-step 2: `canonicalMapping.js` + MRZ append; 7 tests*
- [x] Provider-neutral: map Didit result → canonical (module's DiditAdapter / normalizeResult) — *sub-step 2*
- [x] Refactor plaintext PII: `verification_result` → Vault ref + non-PII canonical; ComplyCube `result` → minimized (outcome/categories only, drop match PII) — *sub-step 3: migration 017, `persistDecision` seam, `status.js` reads `providerVerified`; 62 tests*
- [ ] Document media store: download doc images (NOT selfies) at webhook → envelope-encrypt → private Blob → authorized+audited retrieval + provenance + our SHA-256 (migration)
- [ ] Evidence outbox port (`IdvEvidencePublisher`, references only; no Evidence rows until Control Room approval — BACKLOG EVID-1) (migration)
- [ ] Distinct event timestamps (occurredAt/receivedAt/recordedAt); provider outcome ≠ KYC approval
- [ ] Tests: Evidence doc §17 list (no plaintext PII in tables/logs/outbox; no raw media/biometrics; PII only via Vault; provider approval ≠ KYC; correction preserves original; idempotency; etc.)
- [ ] Prod infra (KMS/OIDC/separate DB) → deferred (BACKLOG IDV-2); media prod hardening + selfies + retention → BACKLOG MEDIA-1

### Phase 4 — Comparison hygiene  `[~] spec written (revisit: read canonical attributes via Vault, not plaintext)`
- [ ] DOB month/year only (never fabricate a day)
- [ ] MRZ-first name comparison (MRZ agrees + visual differs → `extraction_error_corrected`)
- [ ] Ignore address, nationality, gender in matching
- [ ] Presentation-difference normalization (case/diacritics/punctuation/order/middle name)
- [ ] Phase 4 tests + review

### Phase 5 — Band assignment
- [ ] Band A / B / C assignment logic
- [ ] Override: name score never beats DOB month/year conflict
- [ ] Override: missing/unreadable required data ≠ match (retry path)
- [ ] Hard exclusion: sanctions/PEP/adverse hit or escalation flag → forces review/Band C
- [ ] Phase 5 tests + review

### Phase 6 — Name-equivalence engine
- [ ] Versioned rule tables (transliteration / phonetic / patronymic), each rule an ID
- [ ] Configurable thresholds (auto-resolve, skip-to-review, combined)
- [ ] Records which rule ID + score + policy version resolved a case
- [ ] Phase 6 tests + review

### Phase 7 — Band B resolution flow
- [ ] 5a machine resolution first (auto-resolve `same_person_variation_accepted`)
- [ ] 5b disclosure gate (Didit+liveness passed, own record, no restricted flag)
- [ ] 5c one-round dialogue (5 fixed options, verbatim copy)
- [ ] "I changed my name" evidence upload (both names present check)
- [ ] 5d neutral in-review state (verbatim copy)
- [ ] Phase 7 tests + review

### Phase 8 — Band A / Band C behaviors
- [ ] Band A success (verbatim copy), `auto_match` / `extraction_error_corrected`
- [ ] Band C → `demoted_to_loa_path`, set escalation flag, route to existing LOA path
- [ ] Band C identity data stored on attempt only (never officer/UBO/etc.)
- [ ] Record-only review task for `unresolved_to_review` / `registry_error_asserted`
- [ ] Remove the P4 "pick one of two versions" UI
- [ ] TODO marker for future Evidence Ledger integration
- [ ] Phase 8 tests + review

### Phase 9 — Test suite
- [ ] All 15 required scenarios
- [ ] Off-flag regression (journey identical when flag OFF)
- [ ] Full suite green (before + after)

---

## B. Applicant-page restructuring (behind the flag) — later phase
- [ ] Progressive disclosure — only "Who is completing" selector first
- [ ] Remove Signatory-ID upload (Didit replaces it)
- [ ] Unlisted → Authority-to-Act upload → then inline Didit QR
- [ ] Listed → Didit QR directly (no Authority-to-Act)
- [ ] Delete the separate Verify-ID step + `?idvspike` dev shortcut
- [ ] After verification: mandatory fields + dynamic extra-ID fields
- [ ] Clean tick / confirm / edit UI on the applicant page
- [ ] Persist extras into the real submission (needs `submit.js` exception — show diff first)

## C. Follow-ups (later)
- [ ] Human review queue UI (none exists today)
- [ ] DB-backed threshold config (migrate from policy file)

---

## D. Separate tracked debt (see docs/BACKLOG.md — not this feature)
IDV-1..5, DEP-1, PLAT-1..5.
