# Didit IDV Spike — Design Spec

**Date:** 2026-09-07
**Status:** Approved design (spike scope)
**Branch/worktree:** `dev/local-work` @ `E:\kyc-agent-dev`
**Related:** `BACKLOG.md` (IDV-1..4, DEP-1), memory `phase2-target-didit-idv`

---

## 1. Goal

Prove the end-to-end Didit identity-verification loop, wired into the KYC wizard, on **sandbox / synthetic data only**:

> reach a Verification step → start a Didit session → user verifies (any device, via QR) → we pull the decision → map it to applicant fields + capture "extra" data points → display the result and persist it (locally for now).

**Non-goals (spike):** real customer PII, production security/storage, webhooks, all journeys, admin/reporting surfaces. These are the productionization phase (see §11).

## 2. Guiding decisions (agreed)

- **Hybrid Option A.** Thin connector for the spike; adopt the hardened `idv/` module's storage/security model at productionization — *before any real PII flows*.
- **Self-contained connector, not idv internals.** The `idv/` module's rule is "consume only `idv/index.js`," and it exposes no standalone Didit adapter. Rather than breach that boundary (and couple to a module under active Wave development), the spike uses a small `lib/didit/` connector that mirrors the documented Didit v3 contract. Retiring it for the real module is IDV-1.
- **Poll-on-return retrieval** for the spike (no public webhook ingress needed). Webhook is IDV-3.
- **Dev-only shortcut** to reach the step, bypassing the AI-research step (which needs `ANTHROPIC_API_KEY` we don't have). Removed/disabled in production.
- **New dedicated wizard step** ("Identity Verification") right after **Applicant** — smallest, gate-able App.js change.
- **Local file store** for persistence during the spike; flip to Neon once the DB is confirmed a test DB (DEP-1).

## 3. Didit mechanics (confirmed from live docs + existing `idv/` adapter)

- **Create session:** `POST https://verification.didit.me/v3/session/`, header `x-api-key`. Body: `workflow_id`, `vendor_data` (our correlation id), `callback`, `metadata`, and (sandbox) `sandbox_scenario`. Returns `session_id` + hosted `url`.
- **Retrieve decision (cross-device safe, poll-able):** `GET /v3/session/{session_id}/decision/`, header `x-api-key`. Pure session-id lookup — no device/cookie dependency.
- **User correlation:** `vendor_data` = our `submissionId`; echoed in create response, webhook, and decision. Plus `session_id` join key.
- **Data returned (Full KYC):** name, DOB, nationality, gender, place/date of birth, document type/number/expiry/issue, MRZ, address/parsed address, liveness score, face-match, optional AML/PEP. Images/videos are temporary presigned links (not stored in spike).

## 4. Architecture / components

All new files except one additive edit to `App.js` and `setupProxy.js`.

| Component | File | Responsibility |
|---|---|---|
| Didit client | `lib/didit/diditClient.js` | `createSession({vendorData, callbackUrl})` → POST; `getDecision(sessionId)` → GET. Reads `DIDIT_*` env; adds `sandbox_scenario` when synthetic. **Server-side only.** |
| Decision mapper | `lib/didit/mapDecision.js` | Pure: Didit decision → `{ status, mappedFields, extras }`. Deterministic, unit-tested. |
| Store | `lib/didit/store.js` | Persistence interface. Default = **local JSON file** in worktree (gitignored). Neon impl behind a flag (DEP-1). Stores session link + latest mapped result + extras keyed by our ref. |
| Start route | `api/idv-start.js` | POST → `createSession(vendorData=ref)`; records `ref ↔ providerSessionId`; returns `{ hostedUrl, providerSessionId }`. |
| Result route | `api/idv-result.js` | POST → `getDecision` → `mapDecision` → `store` → returns `{ status, mappedFields, extras }`. Poll target. |
| Wizard step | `src/components/idv/IdentityVerificationStep.jsx` | UI: "Start verification" → show hosted link + **QR** → "Check status" (poll) → on VERIFIED, populate applicant fields + show extras/status. |
| Wizard wiring | `src/App.js` (edit) | One step-map entry after `applicant` + one render branch. Covered by `appMounts` test; diff shown before applying. |
| Dev proxy | `src/setupProxy.js` (edit) | Mount `/api/idv-start` + `/api/idv-result` for local dev (additive). |
| Dev shortcut | `src/App.js` / `index.js` (dev-guarded) | Jump to Verification step in dev mode only. |

QR: generated on our page from the hosted URL (small QR helper/dependency).

## 5. Data flow

```
Wizard (Verification step)
  │  POST /api/idv-start { ref = submissionId }
  ▼
api/idv-start → diditClient.createSession(vendor_data=ref, callback)
  │  { hostedUrl, providerSessionId }   store: ref ↔ providerSessionId
  ▼
Page shows hosted URL + QR
  │  user scans QR on phone → completes Didit sandbox flow (any device)
  ▼
Wizard "Check status"  POST /api/idv-result { ref }
  ▼
api/idv-result → diditClient.getDecision(providerSessionId)
             → mapDecision(decision) → { status, mappedFields, extras }
             → store.save(ref, ...)
  ▼
Page: applicant cells populate (mappedFields) + extras shown; extras persisted in local store
```

## 6. Field mapping

**Mapped to existing platform fields** (from `src/workflows/applicantWorkflow.js` / `lib/seedSchemas.js`):

| Didit | Platform field id |
|---|---|
| first_name | `applicantFirstName` |
| last_name | `applicantLastName` |
| date_of_birth | `applicantDateOfBirth` |
| nationality | `applicantNationality` |

**Extras (no platform field yet → stored in the store blob):** document_type, document_number, expiration_date, date_of_issue, issuing_state, address/parsed_address, place_of_birth, gender, MRZ, liveness score/result, face_match score/result, AML/PEP (if enabled), Didit `session_id`, `status`, timestamps. Promoting any of these to first-class fields is IDV-4.

## 7. Persistence (spike)

- Local JSON file in the worktree (e.g. `.didit-store.json`), **gitignored** — never committed, never leaves the machine.
- Keyed by our `ref` (`submissionId`). Holds: `{ providerSessionId, status, mappedFields, extras, updatedAt }`.
- Swap to Neon (or the idv encrypted store) is a store-implementation change only; call sites unchanged (DEP-1 / IDV-1).

## 8. Error handling

- Didit non-2xx → surfaced with a retry hint (429/5xx retryable); no secrets/PII in the message.
- Poll reflects intermediate states (pending / in-progress / in-review / declined / expired) via canonical status mapping; not just success.
- Poll timeout guard (bounded attempts) so the UI never hangs forever.
- Missing/invalid `DIDIT_*` config → clear server error, never a silent wrong call.

## 9. Security (spike)

- **Sandbox + synthetic only** (`IDV_RUNTIME_MODE=test`, `IDV_SYNTHETIC_ONLY=1`, `DIDIT_ENVIRONMENT=sandbox`). No real PII. **Hard rule:** no real PII until productionization (IDV-1/2) is done.
- `DIDIT_API_KEY` used **server-side only**; never sent to the browser or embedded in the bundle.
- No PII, tokens, or secrets in logs.
- Local store gitignored; `.env.local` gitignored (confirmed).

## 10. Testing

- **Unit:** `lib/didit/mapDecision.js` against a synthetic Didit decision fixture — asserts correct `mappedFields` + `extras` extraction (the money path).
- **Smoke:** `diditClient` happy-path with a stubbed `fetch` (no live network).
- Existing `appMounts` characterization test guards the App.js edit (wizard still mounts).
- No live Didit/DB calls in automated tests.

## 11. Deferred to productionization (tracked in BACKLOG.md)

- **IDV-1** — adopt the `idv/` module's encrypted-storage model (envelope encryption, RLS, OIDC-gated) before real PII.
- **IDV-2** — provision KMS key provider, OIDC issuer/JWKS, separate `IDV_DATABASE_URL` DB.
- **IDV-3** — production webhook ingestion (HMAC) alongside polling; replace ephemeral Cloudflare tunnel with a stable endpoint.
- **IDV-4** — first-class platform fields for document number/type/expiry/address.
- **DEP-1** — confirm/obtain a writable test database (interim: local store).

## 12. Success criteria (spike is "done")

1. From `http://localhost:3000`, reach the Verification step via the dev shortcut.
2. "Start verification" returns a Didit sandbox hosted URL + a scannable QR.
3. Completing the sandbox flow on a second device, then "Check status," pulls a decision.
4. Applicant cells populate from `mappedFields`; extras are visible and persisted in the local store.
5. `mapDecision` unit test passes; the app still builds and `appMounts` passes.

## 13. Open items

- Which single journey to wire the spike step into (default: the simplest reachable one; confirm at plan time).
- QR helper choice (tiny dependency vs inline) — decided at plan time.
- Didit workflow confirmed as a sandbox/test workflow in the Business Console (optional verification).
