# IDV security and deployment contract

## Production prerequisites

Production initialization fails unless all of these are supplied:

1. An approved `ManagedKeyProvider` subclass backed by a managed KMS/key vault,
   marked `productionReady`, with an active provider ID, key ID, and key version.
2. Runtime permission to wrap/unwrap DEKs using that key. Rotation must retain
   unwrap access to referenced old versions while new writes use the active one.
3. Durable PostgreSQL stores and the IDV module schema.
4. A production DB role that does not own protected tables, is not superuser,
   and has no `BYPASSRLS`. Grant only required DML permissions.
5. Trusted OIDC issuer, audience, tenant claim mapping, role/scope mapping, and
   service identity. The issuer and JWKS endpoints must use HTTPS.
6. A server-side resolver proving the opaque KYC `subject_id` belongs to the
   authenticated tenant. It receives the verified actor/tenant/purpose context,
   not an untrusted tenant query parameter.
7. Provider credentials, workflows, callback URLs, public webhook URLs, and
   signature secrets for each enabled provider.

No environment-variable master-key option exists. Concrete KMS and IdP binding
is deployment configuration; the IDV domain does not select a cloud.

## Envelope encryption

`EnvelopeEncryption` generates a random 32-byte DEK for each encrypted identity
attribute or customer response. AES-256-GCM encrypts the serialized structured
record with random 96-bit nonce and AAD binding:

```text
tenant + subject + identity reference + record kind + item ID + concept
```

`ManagedKeyProvider.wrapKey()` wraps the DEK. The plaintext DEK is zeroed after
use. Database rows contain only ciphertext and envelope metadata. Changing an
AAD tenant/subject/item, authentication tag, ciphertext, or wrapped-key version
causes authenticated decryption failure.

This is an envelope format around standard Node cryptographic primitives; it is
not a new cipher or custom key derivation scheme.

## Authorization

`OidcJwtAuthenticator` validates a signed asymmetric JWT and constructs the only
accepted `SecurityContext`:

```text
actor_id  <- verified sub
tenant_id <- configurable issuer-signed tenant/org claim
roles/scopes, issuer, audience <- verified token
subject_id <- authorized server-side KYC resource
purpose    <- server-selected operation
```

Default scopes are `idv:pii:write`, `idv:pii:confirm`, `idv:pii:read`,
`idv:pii:delete`, and `idv:pii:retention`. Document/government identifiers also
require `idv:pii:restricted`. Deployment may supply reviewed purpose policy.

Do not derive PII authorization from `?tenant=`, `x-tenant-id`, the repository's
admin-password bearer flow, or client-supplied purpose/subject fields.

Provider webhooks authenticate provider HMAC, then use an injected verified
OIDC workload SecurityContext for the structured-PII write. HMAC alone does not
grant tenant authority.

## RLS and pooling

Protected transactions run:

```sql
BEGIN;
SELECT set_config('app.tenant_id', $trusted_tenant, true);
-- explicitly tenant-scoped application queries
COMMIT;
```

The `true` flag makes context transaction-local so pooled connections cannot
leak tenant state. Every encrypted identity, response, record, and audit row has
`tenant_id`; RLS is enabled and forced. Policies compare it to
`current_setting('app.tenant_id', true)`. Missing context returns no access.

## Classification, exposure, and audit

Names, DOB, nationality, addresses, document metadata, and provider extraction
values are protected identity PII. Document numbers and government identifiers
are restricted PII. Numeric biometric scores are suppressed by default; only a
normalized PASS/FAIL/REVIEW observation and a score-available boolean remain.

Reads require explicit concepts and may optionally restrict attribute IDs.
Audit records contain tenant, actor, subject, purpose, action, field categories,
outcome, correlation ID, and time—never identity values. `safeLogger` allowlists
operational identifiers and discards arbitrary fields.

## Retention and deletion

Retention metadata is policy-provided; this module does not invent enterprise
periods. Structured PII deletion may be immediate or scheduled. Legal hold
blocks deletion. Immediate deletion removes encrypted attributes/responses while
retaining permitted PII-free audit metadata and provider/session references for
vendor reconciliation. Vendor raw-evidence retention is a separate clock.

## Deployment route separation

- Provider webhook handlers: public HTTPS, provider-signature authenticated,
  idempotent, no harness Basic auth.
- Internal IDV handler: OIDC bearer authentication and authorized KYC subject
  resolution. Tenant never comes from a query/header.
- POC harness: separate server, `IDV_POC_HARNESS_ENABLED=1`, forbidden in
  production. Remote access also needs POC Basic protection; real PII actions
  still require injected OIDC contexts.

These factories are intentionally not mounted in `src/setupProxy.js` or KYC.
Deployment mounting belongs in a later narrow integration change.
