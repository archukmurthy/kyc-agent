# Standalone Identity Verification

Provider-neutral hosted IDV for Didit Full KYC and Veriff Essential / Full Auto.
The module runs independently of the KYC UI and Evidence Platform.

## Architecture

```text
KYC consumer contract / controlled POC
                 |
                 v
             IdvService
       +---------+----------+
       |                    |
 ProviderAdapter      operational stores
 Didit / Veriff       session/result/event/cost
       |
 vendor-hosted media custody

structured identity attributes
       |
       v
SecureIdentityStore -> envelope encryption -> ManagedKeyProvider
       |
PostgreSQL ciphertext + forced tenant RLS + PII-free access audit
```

Raw documents, selfies, videos, NFC payloads, biometric templates/vectors, and
hosted-session tokens are never persisted. They remain with the provider.
Structured identity PII is removed before operational result persistence and is
stored only through `SecureIdentityStore`.

## Security boundary

- Production uses a provider-neutral `ManagedKeyProvider`. A random per-item
  256-bit DEK encrypts JSON with AES-256-GCM; the managed provider wraps the DEK.
- The database stores ciphertext, nonce/tag, wrapped DEK, KMS provider/key
  identity/version, classification, retention state, and non-PII audit metadata.
- `LocalTestManagedKeyProvider` takes an explicit in-memory key, never reads an
  environment master key, and refuses production mode.
- OIDC/JWT authentication validates asymmetric signature, issuer, audience,
  expiry/not-before, subject, and the configured signed tenant claim via JWKS.
- `subject_id` comes from an authorized KYC resource resolver. Purpose is chosen
  by server code. Neither is trusted from a client query/header.
- Every protected operation requires actor, tenant, subject, purpose,
  correlation ID, scopes/roles, and an explicit field allowlist.
- PostgreSQL transactions set `app.tenant_id` transaction-locally. Forced RLS
  default-denies when it is absent; explicit application authorization remains.

See `docs/idv/SECURITY_AND_DEPLOYMENT.md` for deployment requirements.

## Persistence and route surfaces

The idempotent module-local schema is
`idv/persistence/migrations/001_idv_module_schema.sql`. It does not consume a
repository-global migration number, avoiding collision with parallel Evidence
migrations. At integration time it may be applied independently with
`npm run idv:migrate` or assigned the then-current global number.

`idv/http/handlerFactories.js` keeps provider webhooks and trusted internal IDV
APIs separate. `idv/harness/server.js` is a separately enabled POC-only server;
production configuration rejects it. No KYC or Evidence route is mounted by
this branch.

## Validation

```powershell
npm run idv:test
npm run idv:security-scan
npm run build
```

All committed fixtures are synthetic and make no network calls. Real provider
testing requires credentials, configured workflows, approved encrypted PII
storage, OIDC identities, and public HTTPS webhook/return endpoints.

## Provider and measurement documentation

- `docs/idv/ADDING_A_PROVIDER.md`
- `docs/idv/METRICS.md`
- `docs/idv/POC_PROTOCOL.md`
- `docs/idv/SECURITY_AND_DEPLOYMENT.md`
- `docs/idv/MERGE_STRATEGY.md`

The future Evidence adapter remains deliberately empty. Canonical external
evidence references preserve vendor custody and provenance without creating or
depending on Evidence Platform objects.
