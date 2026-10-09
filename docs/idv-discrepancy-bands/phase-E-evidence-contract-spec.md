# Phase E - Evidence-contract alignment (Spec)

Build the IDV side to the full **IDV-Evidence integration contract** (the "Current
implementation status" + "What the IDV developer should build now" brief). Evidence
Core V1 is frozen and has no write API, so IDV builds its own side, keeps a
references-only outbox ready, and **never writes into Evidence** until the joint
contract is approved. Future Evidence V1.1 (the consumer side) is out of scope.

## Decisions (approved 2026-09-09)
- **KMS:** build against the managed-key interface; run on the dev/local key now; real KMS = IDV-2.
- **IDV database:** a dedicated **IDV-only database** now (`IDV_DATABASE_URL`), isolated from the main app DB. Truly-isolated prod DB stays IDV-2.
- **OIDC:** build the authorization + audit layer against the interface; dev authenticator now; real IDP later.
- **Sensitive-data model:** applicant sees real values → confirms → **sensitive extras stored in the Vault + an immutable confirmation event** → the submission keeps only declared fields + an opaque **reference**.
- **Field split:** `name / DOB / nationality` stay as declared submission fields (and are also recorded in the Vault as extraction + confirmation); `document number / type / expiry / issuing country / gender / place of birth / address` are **Vault-only + reference** (never plaintext on the submission).
- **Reviewer:** server-side **authorized + audited reveal** (masked by default) **and** a minimal read-only reviewer view. Full review-queue UI later.
- **Retention:** build the **separate retention/deletion structure** per data class (provider media / Vault PII / IDV ops / provenance); periods unset/forever until specified.
- **Providers:** Didit now; Veriff stays behind the provider-neutral interface.
- **Outbox:** write the outbox row in the **same transaction** as the decision.
- **O2-2:** build the **verify-only** (no-officer) Didit path for unlisted applicants.

## Sub-steps
- **E1 - Dedicated IDV database.** Create an isolated IDV-only database; `IDV_DATABASE_URL`; migrate the `idv_*` tables into it; data-access reads the IDV DB.
- **E2 - Durable Vault (dev key).** Wire the module's `PostgresSecureIdentityStore` + `EnvelopeEncryption` + `LocalTestManagedKeyProvider` (dev) + dev authenticator behind `identityVault.js`, so PII is durably encrypted with authorized retrieval. Synthetic store stays for unit tests.
- **E3 - Fix the plaintext-extras conflict + immutable events.** Sensitive extras → Vault-only + reference on the submission (drop plaintext extras); new `idv_identity_events` table for immutable confirmation / correction / applicant-supplied gap events (provider value vs applicant event kept distinct).
- **E4 - Reviewer reveal + audit + minimal view.** Authorized + audited Vault fetch (masked by default); append-only access audit; a minimal read-only reviewer view.
- **E5 - Retention structure.** Separate retention/deletion metadata per data class; accessors; periods unset.
- **E6 - Transactional outbox.** Outbox row written in the same DB transaction as the decision.
- **E7 - O2-2 unlisted verify-only.** No-officer session + identity-only resolve (document + liveness proof, no band comparison) → proceed; mounted after the authority-to-act upload.
- **E-tests - §17 + contract tests:** no plaintext sensitive values / biometrics / fake Artifacts in ordinary storage; extraction vs confirmation vs correction vs gap distinct + immutable; outbox references-only + unconsumed; no Evidence-table writes.

## Invariants (unchanged from the contract)
Provider-neutral append-only lifecycle + provenance; sensitive values only via the Vault; Didit passport/selfie/liveness/biometrics as external references (never fake local Artifacts); confirmation/correction/gap as separate immutable events; versioned references-only outbox through a neutral port; **no direct Evidence writes / no deep imports of Evidence internals**; do not build a competing Evidence system (IDV keeps only its own operational history). All behind `IDV_DISCREPANCY_BANDS_ENABLED` (default OFF).
