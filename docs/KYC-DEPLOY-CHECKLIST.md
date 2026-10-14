# KYC - deploy checklist for merging `manas/kyc-work`

For the partner, before `manas/kyc-work` is merged into `main` and deployed.
Names only - no value in this file is real. Secrets go straight into Vercel
(Settings > Environment Variables > Production), never into chat, email or git.

## 1. Database - DONE (2026-10-14)

Neon project `kyc-agent-db`, branch `main` (`ep-blue-mouse-abxjk5d5`):

- Database `neondb`: migrations `024` to `028` applied (tested first on a
  copy branch). All additive: new tables `submission_inbox`,
  `entity_dossier_versions`; new columns on `entity_dossiers` and
  `onboarding_sessions`. No rows changed; the current live app is unaffected.
- Database `idv`: migrations `013` to `023` were already present.

Nothing to do here.

## 2. Vercel settings

### Point at the two databases
| Name | Value |
| --- | --- |
| `DATABASE_URL` | `kyc-agent-db` main, database `neondb` (already set, presumably) |
| `IDV_DATABASE_URL` | same address, but ending `/idv` instead of `/neondb`. **Required:** without it identity verification falls back to `neondb`, which has no IDV tables. |

### Generate fresh, long random values (never reuse anyone's dev values)
`DOSSIER_TOKEN_SECRET`, `CRON_SECRET`, `SESSION_SECRET`,
`ADMIN_PASSWORD`, `SUPER_ADMIN_PASSWORD`, `PREBOARDING_PASSWORD`,
`IDV_VAULT_WRAP_KEY`, `IDV_MEDIA_WRAP_KEY`

- Without `DOSSIER_TOKEN_SECRET`, invites fail and every customer link is refused.
- The two `*_WRAP_KEY` values encrypt identity data. Once set, **never change
  them** - data encrypted under the old key can no longer be read.
- Optional: `RESEARCH_GRANT_SECRET` (falls back to `DOSSIER_TOKEN_SECRET`).

### Shared storage (rate limits, link revocation)
Add **Upstash Redis** from the Vercel Marketplace and connect it to the
project; it sets `KV_REST_API_URL` and `KV_REST_API_TOKEN` itself. Without it,
password-guess limits and link revocation hold per server instance only.

Blob: `BLOB_READ_WRITE_TOKEN` from the project's own Blob store.

### Provider keys (agree between us whose accounts pay)
`ANTHROPIC_API_KEY`, `COMPANIES_HOUSE_API_KEY`,
`DIDIT_API_KEY`, `DIDIT_WORKFLOW_ID`, `DIDIT_WEBHOOK_SECRET`,
`COMPLYCUBE_API_KEY`, `COMPLYCUBE_WEBHOOK_SECRET`

### Identity verification mode (not secret - current test setting)
| Name | Value |
| --- | --- |
| `DIDIT_BASE_URL` | `https://verification.didit.me` |
| `DIDIT_ENVIRONMENT` | `sandbox` |
| `DIDIT_CALLBACK_URL`, `DIDIT_PUBLIC_WEBHOOK_URL` | **this deployment's own domain**, not ours |
| `IDV_RUNTIME_MODE` | `test` |
| `IDV_SYNTHETIC_ONLY` | `1` |
| `IDV_ENABLED_PROVIDERS` | `DIDIT` |
| `IDV_DISCREPANCY_BANDS_ENABLED` | `1` |
| `SCREENING_RUNTIME_MODE` | `test` |
| `SCREENING_DEFAULT_PROVIDER` | `COMPLYCUBE` |

These keep identity checks in test mode. Moving to real customers' identity
data is a separate decision (BACKLOG IDV-1), not part of this merge.

### Customer invite emails
`RESEND_API_KEY` and `INVITE_FROM_EMAIL` (e.g. `Acme Onboarding <onboarding@acme.com>`).
Without the key, invites are *simulated*: the analyst sees the link and must
send it by hand. Resend only delivers to real customers from a domain verified
in Resend (a few DNS records).

### Leave out
- `TENANT_ID` - removed by design; every request names its tenant.
- `CLERK_SECRET_KEY`, `REACT_APP_CLERK_PUBLISHABLE_KEY`, `PLATFORM_OWNER_CLERK_IDS`,
  every `UBO_*` and `DEMO_TOTAL_*` - UBO pages only.
- `IDV_POC_HARNESS_ENABLED`, `IDV_DEBUG_DIDIT_HTTP`, `SCREENING_DEMO_FORCE_HIT`,
  `SCREENING_LAB_ENABLED` - test switches. `SCREENING_DEMO_FORCE_HIT` would flag
  every customer as a sanctions hit.
- `ALLOWED_ORIGINS` - only needed for a custom domain; Vercel URLs are added
  automatically.

## 3. Then merge

1. Settings above saved for Production.
2. Merge `manas/kyc-work` into `main`; Vercel deploys.
3. Expected change: customer links emailed before this deploy stop working
   (they were unsigned). Analysts re-send invites.

## 4. Afterwards

- The `neondb_owner` password was exposed in a chat on 2026-10-14. Reset it in
  Neon (Roles) and update `DATABASE_URL` and `IDV_DATABASE_URL` in Vercel **at
  the same moment**, or the live app loses its database.
- The `idv` database holds test rows from our local development, which pointed
  at it. Harmless; can be listed and removed on request.
