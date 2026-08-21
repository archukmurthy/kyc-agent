# Standalone Identity Verification

This module implements provider-neutral hosted IDV for Didit Full KYC and
Veriff Essential. It runs without the KYC UI and without the Evidence Platform.

## Safety boundary

- Raw document, selfie, video, NFC and biometric material remains with the
  provider. Canonical persistence rejects binary payloads, data URLs and known
  raw-artifact keys.
- Hosted URLs are returned to the caller for redirect but are excluded from the
  stored canonical session.
- Identity attributes are sent only to `SecureIdentityStore`. The repository
  currently has no production PII vault, so the default store rejects PII.
- `SyntheticOnlySecureIdentityStore` exists solely for labelled synthetic POC
  fixtures when `IDV_SYNTHETIC_ONLY=1`.
- Browser return records `CUSTOMER_RETURNED`; it never changes a session to
  `VERIFIED`.

## Structure

```text
idv/domain        canonical session, facts, observations, decisions, states
idv/contracts     provider, secure PII, repository, future Evidence boundaries
idv/providers     Didit v3 and Veriff v1 hosted-flow adapters
idv/security      webhook HMAC and replay-window verification
idv/services      orchestration, routing, costs, lifecycle metrics
idv/stores        standalone in-memory stores and synthetic-only PII store
idv/harness       engineering-only HTTP harness
idv/fixtures      sanitized synthetic provider payloads
idv/__tests__     provider contract, lifecycle, security and metrics tests
```

The future Evidence adapter is intentionally empty. IDV exposes
`external_evidence_references` with provider custody metadata; it does not
invent or import an Evidence schema.

## Test

```powershell
npm run idv:test
```

The tests use synthetic payloads and make no network calls.

## Run the POC harness

Set the variables shown in `.env.idv.example` in the shell, then:

```powershell
npm run idv:harness
```

Open `http://127.0.0.1:3100`. Provider webhooks must target:

```text
POST https://<public-host>/webhooks/didit
POST https://<public-host>/webhooks/veriff
```

The harness binds to loopback by default. Remote binding requires both
`IDV_HARNESS_ALLOW_REMOTE=1` and `IDV_HARNESS_TOKEN`; remote requests then need
`Authorization: Bearer <token>`.

Didit configuration uses the v3 Sessions API and `X-Signature-V2` first, with
raw-body and envelope-only fallbacks. Envelope-only authentication always
forces an authenticated decision API read before result data is trusted.

Veriff signs create-session bodies and session IDs with the shared secret,
verifies signed API responses, and authenticates webhook raw bytes together
with `x-auth-client`.

## Production activation gates

The standalone domain and adapters are complete, but production activation is
blocked until these platform-owned implementations/configuration exist:

1. A reviewed `SecureIdentityStore` providing encryption, authorization,
   retention, deletion and audit.
2. Durable implementations of the session, result, webhook-receipt and event
   repository contracts. Migration numbering is intentionally deferred to the
   integration PR so it cannot collide with parallel Evidence migrations.
3. Didit and Veriff sandbox credentials, workflow configuration and public
   webhook endpoints for controlled live POC runs.

These gates fail closed. The module does not fall back to the repository's
generic KV/filesystem store for PII.
