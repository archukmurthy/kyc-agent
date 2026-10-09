# Phase 2.5 - Evidence-compatible architecture (Spec)

**Goal:** Re-found the IDV data layer on the existing `idv/` module so the whole feature satisfies the "IDV - Evidence" doc: extracted identity PII lives only in a secure **Vault** (opaque references in our tables, never plaintext), data is modelled as **separate canonical types**, providers are **neutral**, document images are stored in a **hardened restricted media store**, and there is an **Evidence outbox** seam. Refactor the plaintext PII from Phases 1-3. All behind `IDV_DISCREPANCY_BANDS_ENABLED`; live journey unchanged. Comes **before Phase 4** (comparison must read canonical attributes via the Vault, not plaintext).

## Foundation decision (approved)
Adopt the `idv/` module (already implements the Vault, canonical builders, `assertNoRawEvidence`, provider-neutral Didit/Veriff adapters). Consume via its public API. Dev uses the in-memory synthetic Vault + `LocalTestManagedKeyProvider` (no infra). Production KMS/OIDC/separate DB = **backlog IDV-2**. Do **not** build a second Vault.

## In scope

### 1. PII Vault wrapper - `api/idv-match/identityVault.js`
- Thin wrapper over the module's `SecureIdentityStore` (dev: `SyntheticOnlySecureIdentityStore` + `LocalTestManagedKeyProvider`, via the module's public API with a synthetic security context).
- API: `storeExtractedIdentity({ tenantId, subjectId, attributes }) -> secureIdentityReference`; `retrieveForAuthorizedPurpose({ reference, fields, context }) -> { field: value }`; `recordCorrection(...)`.
- **Build step 0:** a short read-only spike of the module's store method signatures (`storeExtractedIdentity`, `retrieveIdentityForAuthorizedPurpose`, `recordCustomerCorrection`, the `SecurityContext`/`PURPOSES` shape) to wire the wrapper correctly.
- Our tables store the returned **opaque reference**, never the plaintext.

### 2. Canonical mapping - replace the flat `mapDecision` blob
- Use the module's `DiditAdapter.normalizeResult` (or the top-level canonical builders) to turn a Didit decision into: `identity_attributes[]`, `verification_observations[]`, `provider_decision`, `external_evidence_references[]`, timestamps.
- **Split by sensitivity:** `identity_attributes` (name/DOB/doc number → PII) go to the **Vault**; `verification_observations` (liveness/face-match outcomes, no scores), `provider_decision`, `external_evidence_references` (non-PII) are stored in our tables.
- The UI reads identity values via an **authorized Vault read** (decrypted for display), not from a plaintext column.

### 3. Refactor Phase 1-3 plaintext (migration 017)
- `idv_verification_attempts`: add `secure_identity_reference`; store only **non-PII** canonical (observations/decision/external-refs) + the Vault reference - stop persisting plaintext identity in `verification_result`.
- ComplyCube: persist **outcome + categories only** (already columns); stop storing the full `result` JSONB (contains match PII/scores) - data minimization.
- Confirm no plaintext PII remains in any idv table, log, or outbox.

### 4. Document media store - `api/idv-match/media/` (migration 018)
- On the completion webhook, download the **document image** presigned URLs (front/back/portrait - **NOT** selfie/liveness/biometrics).
- **Envelope-encrypt** the bytes with the key provider; store ciphertext in **private Vercel Blob**; record `idv_document_media` row: `attempt_id`, `evidence_kind`, `blob_key`, `wrapped_dek`, `nonce`, `sha256` (our own), `content_type`, `provider_reference`, `provider_captured_at`, `received_at`.
- Retrieval handler: **server-side authorization + audit**, decrypt on read (never URL-possession). This becomes an `ExternalEvidenceReference` that is now locally-available (we hold + hashed the bytes).
- Selfies/liveness/biometrics: **not stored** (only an external reference that they existed at Didit). Retention: **forever for now** (BACKLOG MEDIA-1).

### 5. Evidence outbox seam - `api/idv-match/evidenceOutbox.js` (migration 019)
- `IdvEvidencePublisher.publish(envelope)` → append-only `idv_evidence_outbox` row. Envelope = **references + provenance only** (Vault refs + versions, external-evidence refs, observations, provider-decision ref, IDs, timestamps, idempotency key) - **no plaintext, no biometrics**.
- **No consumption / no Evidence rows** until the Evidence Control Room approves the contract (BACKLOG EVID-1).

### 6. Lifecycle + event timing
- Append IDV operational lifecycle events (session_created, hosted_flow_opened, provider_result_received, webhook_received, retry, abandoned, completed, technical_failure) - this is IDV domain history, not a competing Evidence system.
- Preserve distinct timestamps: `occurredAt`/provider time vs `receivedAt` vs `recordedAt`; missing provider time stays missing (use receivedAt as receipt only).
- **Provider outcome ≠ KYC approval** - keep the provider decision as one input; never normalize to KYC approval.

## Security / invariants (Evidence doc)
Never store: raw media (except the doc images we deliberately encrypt), selfies/liveness, biometric templates/vectors, numeric scores, full provider payloads, plaintext PII in ordinary tables/logs/analytics/outbox, or SHA-256 of low-entropy PII. PII only through the Vault. No Evidence repo/table imports. No final conflict resolution or decisioning in the adapter (that's the bands/decisioning layer). Don't touch the `C:\kyc-evidence-platform` / `C:\kyc-ubo-control` worktrees.

## Tests (Evidence doc §17)
Provider adapter returns canonical result; provider-native codes don't leak into core fields; session/reference IDs retained; **no raw doc/selfie/liveness bytes in ordinary storage**; no biometric template/vector stored; **extracted PII written only through the Vault**; ordinary DB rows/outbox/logs contain **no plaintext sensitive values**; provider approval ≠ KYC approval; applicant confirmation preserves original source; **correction creates a new Vault version, original preserved**; applicant-supplied gap not attributed to IDV; duplicate webhook doesn't duplicate history; out-of-order events reconstructable; browser redirect not authoritative; timestamps distinct; scores omitted; **Evidence envelope contains references only**; no Evidence repo imports; no decisioning in the adapter. Fixtures/fakes only - no live provider calls in tests.

## Note on size
This is a large phase - it will be built and reviewed in **sub-steps** (Vault wrapper → canonical mapping → refactor → media store → outbox → lifecycle/tests), each committed + pushed. Prod infra (KMS/OIDC/DB) and Evidence consumption stay deferred (IDV-2, EVID-1, MEDIA-1).

## Definition of done
IDV extracted PII lives only in the Vault (dev synthetic), our tables hold references + non-PII canonical, document images stored encrypted + access-controlled, Evidence outbox port present (unconsumed), plaintext refactored out of Phases 1-3, §17 tests green, flag OFF unchanged, committed + pushed, tracker ticked.
