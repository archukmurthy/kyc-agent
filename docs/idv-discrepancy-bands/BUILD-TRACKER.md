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
- [~] Document media store: download doc images (NOT selfies) at webhook → envelope-encrypt → private Blob → authorized+audited retrieval + provenance + our SHA-256 (migration) — *sub-step 4: `api/idv-match/media/` (byte AES-256-GCM envelope, KMS-wrapped DEK, SHA-256, doc-only kind allowlist, authorized+audited retrieve, injectable-fetch ingest), migration 018 applied, `@vercel/blob` added, pluggable in-memory/real-Blob backend; 10 hermetic tests + guarded real-Blob round-trip VERIFIED live. Pending: wire ingest into the completion webhook*
- [x] Evidence outbox port (`IdvEvidencePublisher`, references only; no Evidence rows until Control Room approval — BACKLOG EVID-1) (migration) — *sub-step 5: `evidenceOutbox.js` (references-only envelope + `assertReferencesOnly` + `assertNoRawEvidence`, idempotent publish, NO consumer), migration 019 applied; 6 hermetic + 1 guarded DB test*
- [x] Distinct event timestamps (occurredAt/receivedAt/recordedAt); provider outcome ≠ KYC approval — *sub-step 6: `lifecycle.js` (append-only, best-effort, distinct times, missing provider time stays null), migration 020, wired into session + webhook; hermetic + guarded DB tests*
- [x] Tests: Evidence doc §17 list (no plaintext PII in tables/logs/outbox; no raw media/biometrics; PII only via Vault; provider approval ≠ KYC; correction preserves original; idempotency; etc.) — *covered across sub-steps 1-6; `evidenceInvariants.nodetest.js` consolidates the cross-cutting ones. 88 tests, 0 fail*
- [ ] Prod infra (KMS/OIDC/separate DB) → deferred (BACKLOG IDV-2); media prod hardening + selfies + retention → BACKLOG MEDIA-1

### Phase 4 — Comparison hygiene  `[x] done (pure module api/idv-match/matching/, reads canonical identity via Vault, 14 tests)`
- [x] DOB month/year only (never fabricate a day) — `compareDob.js`
- [x] MRZ-first name comparison (MRZ agrees + visual differs → `extraction_error_corrected`) — `compareName.js`
- [x] Ignore address, nationality, gender in matching — `hygiene.js` (`IGNORED_FIELDS`)
- [x] Presentation-difference normalization (case/diacritics/punctuation/order/middle name) — `normalize.js`
- [x] Phase 4 tests + review — 14 tests. **Vault-canonical revision:** `runHygiene({ officerSnapshot, identity })` takes the Vault-retrieved `{concept:value}` map (caller does the authorized read), stays pure

### Phase 5 — Band assignment  `[x] done (pure api/idv-match/bandAssignment.js, 9 tests)`
- [x] Band A / B / C assignment logic — `assignBand({ hygiene, screeningHit, escalationFlag })`; Band B carries no terminal outcome (Phase 6/7 resolve)
- [x] Override: name score never beats DOB month/year conflict — `dob.conflict` → Band C before any name check
- [x] Override: missing/unreadable required data ≠ match (retry path) — `notMatchable` → `needsRetry`, no band
- [x] Hard exclusion: sanctions/PEP/adverse hit or escalation flag → forces review/Band C — `unresolved_to_review`, `resolvedBy: reviewer`, escalate on flag
- [x] Phase 5 tests + review — 9 tests; emits only valid migration-013 `outcome_type` values; records `policyVersion`

### Phase 6 — Name-equivalence engine  `[x] done (pure nameRules.js + nameEquivalence.js, 9 tests)`
- [x] Versioned rule tables (transliteration / phonetic / patronymic), each rule an ID — `nameRules.js` (`RULE_TABLE_VERSION`, soundex, translit groups, patronymic particles/suffixes)
- [x] Configurable thresholds (auto-resolve, skip-to-review, combined) — reads `getPolicy().thresholds`; rule-explained variance clears at the lower `combinedExplanation` bar
- [x] Records which rule ID + score + policy version resolved a case — returns `{ score, ruleIds, ruleExplained, outcome, policyVersion, ruleTableVersion }`
- [x] Phase 6 tests + review — 9 tests (translit / phonetic / patronymic-suffix / patronymic-particle / dialogue / review)

### Phase 7 — Band B resolution flow  `[x] done (server-side logic + verbatim copy; UI screens = applicant-page phase)`
- [x] 5a machine resolution first (auto-resolve `same_person_variation_accepted`) — `resolution.js resolveBandB`; doc spelling canonical, CH alias, rule/score/policy recorded
- [x] 5b disclosure gate (Didit+liveness passed, own record, no restricted flag) — gate closed → `unresolved_to_review` + neutral copy, no dialogue
- [x] 5c one-round dialogue (5 fixed options, verbatim copy) — `copy.js` (names only, "Submit explanation"); 5 `handleExplanation` handlers
- [x] "I changed my name" evidence upload (both names present check) — injectable `extractNames`; both present → `same_person_name_change_evidenced`, else review
- [x] 5d neutral in-review state (verbatim copy) — `COPY.IN_REVIEW`
- [x] Phase 7 tests + review — 12 tests incl. verbatim-copy guards; explanation alone never resolves; registry_error = light-touch, not blocked, reportability task

### Phase 8 — Band A / Band C behaviors  `[x] done (record-only behaviors.js + stores, migration 021, 6 hermetic + guarded DB)`
- [x] Band A success (verbatim copy), `auto_match` / `extraction_error_corrected` — `recordBandOutcome` → decision row, no tasks, `COPY.BAND_A_SUCCESS`
- [x] Band C → `demoted_to_loa_path`, set escalation flag, route to existing LOA path — escalation task (record-only, no `requires_escalation` existed), `route: loa_path`
- [x] Band C identity data stored on attempt only (never officer/UBO/etc.) — `identityScope: attempt_only`; behaviors never writes any person-specific record
- [x] Record-only review task for `unresolved_to_review` / `registry_error_asserted` — `idv_review_tasks` (migration 021); registry = light-touch review + reportability task, applicant proceeds
- [x] Remove the P4 "pick one of two versions" UI — deleted the "Confirm which is correct" block from `IdentityVerificationStep.jsx` (dev-`?idvspike`-only, not the live journey); replaced with a NOTE; component test still green
- [x] TODO marker for future Evidence Ledger integration — `TODO(evidence-ledger)` in `behaviors.js` (publish via the references-only outbox once EVID-1 approves)
- [x] Phase 8 tests + review — 6 hermetic + 1 guarded DB (decision + task persist, append-only)

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
