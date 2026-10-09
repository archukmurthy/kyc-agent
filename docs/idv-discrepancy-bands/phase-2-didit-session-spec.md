# Phase 2 - Didit session rework (Spec)

**Goal:** Make identity verification **server-authoritative and attempt-bound**, so a Didit result is tied to exactly one application + verification attempt + selected-officer snapshot, received securely (signed webhook, with authenticated polling as fallback), and read by the browser only. Re-add MRZ for later matching. All behind `IDV_DISCREPANCY_BANDS_ENABLED` (OFF = today's spike behavior unchanged); nothing wired into the live UI yet (that's the restructuring phase).

## Why (doc Step 2 + Step 3 MRZ)
- The Didit session binding (application + attempt + officer snapshot) must be created **server-side**; the browser can never create or modify it.
- Results processed **server-side only**, via **signature-verified webhook** or **authenticated API retrieval**; reject stale/replayed events.
- The applicant "refresh" is **read-only** - it fetches our stored state, never changes state, never sets a status, never changes the officer.
- A result from one attempt can **never** satisfy another attempt or officer; changing the officer is a **new attempt** (old one preserved, never reused).
- Compare against attributes **extracted from the document** - never our echoed `vendor_data`.
- **MRZ** is required for name comparison (Phase 4), so re-extract it now - but keep it **hidden from the applicant UI**.

## In scope

### 1. Attempt-bound session creation - `api/idv-match/session.js`
`startVerificationAttempt({ applicationId, officerCandidate })` (server-side):
- builds the officer snapshot (`officerSnapshot.buildOfficerSnapshot`),
- `attemptStore.createAttempt(...)` → new attempt id,
- `diditClient.createSession({ vendorData: attemptId, callbackUrl })` - **`vendor_data` = our server-generated attempt id**, not any browser-supplied value,
- persists `didit_session_id` on the attempt,
- returns `{ attemptId, hostedVerificationUrl }`.
The browser receives only the attempt id + hosted URL; it cannot influence the binding.

### 2. Webhook ingestion (signed) - `api/idv-match/webhook.js` + `lib/didit/webhookSignature.js`
- `verifyDiditWebhook({ rawBody, headers, secret })` - our own implementation of Didit's HMAC scheme: try `X-Signature-V2` (canonical sorted-key JSON), `X-Signature` (raw body), `X-Signature-Simple` (`{timestamp}:{session_id}:{status}:{webhook_type}`); constant-time compare; **reject if `X-Timestamp` is outside a 300s window** (replay protection). Returns `{ valid, decisionTrusted }` (`simple` scheme → `decisionTrusted:false`).
- Handler: read raw body, verify (invalid → 401; stale/replay → 401), **look up the attempt by `didit_session_id`**, reconcile status, store the extracted result on the attempt. If `decisionTrusted` is false, the **server** re-pulls `diditClient.getDecision` (reconciliation - server-initiated, never the browser). Idempotent: dedupe by `event_id`.

### 3. Read-only status - `api/idv-match/status.js`
`GET`/`POST` with `{ attemptId }` → returns the **stored** attempt state only (`{ status, verified, hasResult }`). No Didit call, no writes, no state change. This is what the applicant "refresh" hits.

### 4. Server-side reconciliation (polling fallback)
`diditClient.getDecision` is used **only server-side** - by the webhook reconciliation path, and by an internal reconcile function `reconcileAttempt(attemptId)` (callable by a future scheduled job / internal trigger, **not** the browser) for the case where a webhook never arrives. Phase 2 provides the function + tests; a scheduler is out of scope.

### 5. Re-add MRZ - `lib/didit/mapDecision.js`
Restore `extras.mrz` extraction (removed earlier for UI cleanliness). The applicant UI must still **not** render it (the current component already omits object-valued extras; the new UI will too). MRZ is for the server-side matcher only.

### 6. Result-per-attempt integrity
- `attemptStore`: add `getByDiditSession(diditSessionId)`, `updateAttempt(id, { status, diditSessionId, verificationResult, lastEventAt })`.
- A stored result is keyed to its attempt; lookups are by `(didit_session_id → attempt)`. A different attempt/officer can never read another's result.

### 7. Data model addition - `db/migrations/014_idv_attempt_result.sql`
Additive `ALTER TABLE idv_verification_attempts ADD COLUMN IF NOT EXISTS`: `verification_result JSONB`, `last_event_at TIMESTAMPTZ` (event ordering / stale-event rejection). (Migration file created; applied to `idv-dev` on your OK, like Phase 1.)

### 8. Dev routing - `src/setupProxy.js`
Additive mounts for the new routes (session/webhook/status), same pattern as existing idv routes. Production auto-routes `api/idv-match/*`.

## Security (first-class)
- Webhook: HMAC verify + 300s replay window + constant-time compare; reject unsigned/stale/replayed; `event_id` idempotency.
- Binding is server-set (`vendor_data` = server attempt id); browser cannot create/modify it.
- Status endpoint is strictly read-only.
- Compare document-extracted attributes only (never `vendor_data`).
- Attempt ids are unguessable UUIDs; note: production should add proper auth/ownership checks on the status endpoint (tracked for the restructuring/prod phase - not a public data leak now since ids are UUIDs and only status/booleans are returned, no PII).
- No secrets in logs; result JSON contains identity data → server-side only, never returned wholesale to the browser by the status endpoint.

## Out of scope (later phases)
No band assignment, no comparison logic, no screening, no dialogue, no UI wiring. The spike routes (`api/idv-start|result|save`) stay as-is for the dev-only spike step; the new attempt-bound flow lives in `api/idv-match/` and is exercised by tests, not the live journey.

## Testing (mocks/fixtures - no live Didit without asking)
- `verifyDiditWebhook`: valid v2/raw/simple signatures accepted; tampered rejected; stale/`>300s` timestamp rejected; `simple` → `decisionTrusted:false`.
- `session.startVerificationAttempt`: with a stubbed `fetch`, asserts `vendor_data` = attempt id, attempt row created, `didit_session_id` persisted. (Real Didit sandbox call only with your go-ahead.)
- `webhook` handler: stubbed signed payload → attempt looked up by session id, status/result stored; untrusted-simple → server reconcile pulls decision; duplicate `event_id` → idempotent no-op.
- `status`: returns stored state only; makes no external call.
- `mapDecision`: `extras.mrz` present again; UI still doesn't surface it.
- Guarded DB integration (`IDV_MATCH_DB_TEST=1`) for the new attemptStore methods + migration 014, with cleanup.

## Definition of done
Session/webhook/status modules + webhook-signature verifier + reconcile + MRZ re-add + attemptStore additions + migration 014 (applied to `idv-dev` on OK) written and tested (unit + guarded integration); flag OFF leaves the journey unchanged; committed + pushed; tracker ticked. No live Didit call without explicit approval.
