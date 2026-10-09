# Phase 1 - Foundations (Spec)

**Goal:** Lay the inert groundwork for the discrepancy-bands feature - feature flag, data model, officer-snapshot capture, and the versioned policy config - with **zero change to live behavior** (flag OFF; nothing wired into the journey yet).

**Flag:** everything gated by `IDV_DISCREPANCY_BANDS_ENABLED` (default OFF). Phase 1 only *reads* the flag; it changes no journey behavior.

## In scope
1. **Feature flag accessor** - `api/idv-match/config.js` → `bandsEnabled()` returns true only when `IDV_DISCREPANCY_BANDS_ENABLED` is `1`/`true`; default false. Add `IDV_DISCREPANCY_BANDS_ENABLED=0` to `.env.local`.
2. **Data model** - migration `db/migrations/013_idv_match.sql` (multi-statement, idempotent `IF NOT EXISTS`, applied via `db/apply.js`; matches existing snake_case + JSONB + `timestamptz default now()` conventions). Three tables:
   - **`idv_verification_attempts`** - `id`, `application_id`, `selected_officer` (JSONB snapshot: name, birth_month_year, role, officer_id, retrieved_at), `didit_session_id`, `status`, `created_at`, `updated_at`.
   - **`idv_match_decisions`** - `id`, `attempt_id`, `band` (A/B/C), `match_score`, `steps` (JSONB - normalization/comparison steps), `outcome_type`, `basis`, `policy_version`, `resolved_by` (system/applicant-dialogue/reviewer), `created_at`. `outcome_type` constrained to exactly: `auto_match`, `same_person_variation_accepted`, `same_person_name_change_evidenced`, `registry_error_asserted`, `extraction_error_corrected`, `unresolved_to_review`, `demoted_to_loa_path`.
   - **`idv_applicant_explanations`** - `id`, `attempt_id`, `explanation_category`, `free_text`, `uploaded_document_ref`, `system_conclusion`, `created_at`.
   - **Append-only in spirit:** no UPDATE/DELETE of decisions; a changed outcome is a new superseding row. (`updated_at` on the attempt row is only for its session lifecycle status, not decisions.)
3. **Officer id capture** - enrich `agents/registries/companiesHouseOfficers.js` to include the CH `officer_id` (from the officer's `links`) on the mapped candidate. (Currently name/role/nationality/DOB are mapped; officer id is not.) Additive, non-breaking.
4. **Officer-snapshot builder** - `api/idv-match/officerSnapshot.js` → `buildOfficerSnapshot(candidate, { retrievedAt })` → `{ name, birthMonthYear, role, officerId, retrievedAt }`. Birth is **month/year only** (never a day).
5. **Policy config (versioned)** - `api/idv-match/policy.js` → `getPolicy()` returns `{ policyVersion, thresholds: { autoResolve, skipToReview, combinedExplanation }, ruleTables: {} }` (rule tables filled in Phase 6). Single accessor so a later DB-backed swap is one change. `policyVersion` (e.g. `idv-match-1.0.0`) is stamped on every decision.
6. **Attempt persistence helper** - `api/idv-match/attemptStore.js` → `createAttempt(applicationId, snapshot)` / `getAttempt(id)` against Neon (`DATABASE_URL`). Used by Phase 2; not called by any live path yet.

## Out of scope (later phases)
No comparison, no band logic, no Didit changes, no screening, no UI, no journey wiring. Nothing runs unless a later phase calls it behind the flag.

## Tests
- `config.bandsEnabled()` default false; true when env set.
- `policy.getPolicy()` returns the versioned shape with a `policyVersion`.
- `buildOfficerSnapshot()` produces the exact shape; birth is month/year only.
- Officer-id enrichment maps the CH officer id when present, omits gracefully when absent.
- (Migration + `attemptStore` DB round-trip: tested once we can run against a confirmed DB - see Open items.)

## Open items / needs confirmation
- **Applying migration 013 to the database** touches your Neon schema. I'll **create the migration file** in Phase 1 but **ask before running it** against the DB (ties to DEP-1 - confirm which DB is safe to migrate). Until applied, `attemptStore` is code-only.
- Protected files: none touched. `agents/registries/companiesHouseOfficers.js` and `.env.local` are not protected.

## Definition of done (Phase 1)
Flag accessor + policy file + snapshot builder + officer-id enrichment + attempt store written and unit-tested; migration 013 file created (apply deferred to your DB confirmation); no live behavior changed; committed + pushed; tracker ticked.
