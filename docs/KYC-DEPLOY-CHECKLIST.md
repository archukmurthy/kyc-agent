# KYC - deploy checklist for merging `manas/kyc-work`

For the partner, before `manas/kyc-work` is merged into `main` and deployed.

Every key, password and secret this needs is already yours: they are the
values in the `.env.local` we developed against. Copy them into Vercel
(Settings > Environment Variables > Production) - except the few below that
must differ. This file holds names only; values never go into git.

## 1. Database - DONE (2026-10-14)

Neon project `kyc-agent-db`, branch `main` (`ep-blue-mouse-abxjk5d5`):

- Database `neondb`: migrations `024` to `028` applied (tested first on a
  copy branch). All additive: new tables `submission_inbox`,
  `entity_dossier_versions`; new columns on `entity_dossiers` and
  `onboarding_sessions`. No rows changed; the current live app is unaffected.
- Database `idv`: migrations `013` to `023` were already present.

Nothing to do here.

## 2. Vercel settings

### Copy as they are from `.env.local`
- Passwords and secrets: `ADMIN_PASSWORD`, `SUPER_ADMIN_PASSWORD`,
  `PREBOARDING_PASSWORD`, `SESSION_SECRET`, `DOSSIER_TOKEN_SECRET`,
  `CRON_SECRET`
- Identity data encryption: `IDV_VAULT_WRAP_KEY`, `IDV_MEDIA_WRAP_KEY`.
  **Never change these later** - data encrypted under them can no longer be
  read with different ones.
- Identity database: `IDV_DATABASE_URL` (already `kyc-agent-db` main, `/idv`).
  **Required:** without it identity verification falls back to `neondb`,
  which has no IDV tables.
- Shared storage: `KV_REST_API_URL`, `KV_REST_API_TOKEN` (rate limits and link
  revocation; without them these hold per server instance only),
  `BLOB_READ_WRITE_TOKEN`
- Provider keys: `ANTHROPIC_API_KEY`, `COMPANIES_HOUSE_API_KEY`,
  `DIDIT_API_KEY`, `DIDIT_WORKFLOW_ID`, `DIDIT_WEBHOOK_SECRET`,
  `COMPLYCUBE_API_KEY`
- Identity verification mode (test setting, not secret): `DIDIT_BASE_URL`,
  `DIDIT_ENVIRONMENT`, `IDV_RUNTIME_MODE`, `IDV_SYNTHETIC_ONLY`,
  `IDV_ENABLED_PROVIDERS`, `IDV_DISCREPANCY_BANDS_ENABLED`,
  `SCREENING_RUNTIME_MODE`, `SCREENING_DEFAULT_PROVIDER`. These keep identity
  checks in test mode; moving to real customers' identity data is a separate
  decision (BACKLOG IDV-1), not part of this merge.

### Must differ from `.env.local`
| Name | Production value | Why |
| --- | --- | --- |
| `DATABASE_URL` | `kyc-agent-db` main, database `neondb` - the value `.env.local` holds as `POSTGRES_URL` | `.env.local`'s `DATABASE_URL` is a separate dev database (`ep-snowy-cherry`) |
| `DIDIT_CALLBACK_URL` | `https://<production domain>/` - where Didit returns the person after the check | `.env.local` points at a temporary local tunnel (`trycloudflare.com`) |

Also in the **Didit console**: set the webhook address to
`https://<production domain>/api/idv-match/webhook`, so results reach the app.

### Not in `.env.local` - add if wanted
- `RESEND_API_KEY` and `INVITE_FROM_EMAIL` (e.g. `Acme Onboarding <onboarding@acme.com>`).
  Without the key, customer invites are *simulated*: the analyst sees the link
  and sends it by hand. Resend only delivers to real customers from a domain
  verified in Resend (a few DNS records).
- `COMPLYCUBE_WEBHOOK_SECRET` - only if ComplyCube webhooks are switched on.
- `RESEARCH_GRANT_SECRET` - optional; falls back to `DOSSIER_TOKEN_SECRET`.
- `ALLOWED_ORIGINS` - only for a custom domain; Vercel URLs are added
  automatically.

### Leave out
- `TENANT_ID` - removed by design; every request names its tenant.
- `CLERK_SECRET_KEY`, `REACT_APP_CLERK_PUBLISHABLE_KEY`, `PLATFORM_OWNER_CLERK_IDS`,
  every `UBO_*` and `DEMO_TOTAL_*` - UBO pages only.
- `IDV_POC_HARNESS_ENABLED`, `IDV_DEBUG_DIDIT_HTTP`, `SCREENING_DEMO_FORCE_HIT`,
  `SCREENING_LAB_ENABLED` - test switches. `SCREENING_DEMO_FORCE_HIT` would flag
  every customer as a sanctions hit.
- `VITE_GOOGLE_PLACES_API_KEY`, `DIDIT_PUBLIC_WEBHOOK_URL`,
  `DIDIT_BUSINESS_DATA_API_KEY` - not read by the app.
- `PG*` and `POSTGRES_*` - set by the Neon integration if connected; the app
  reads `DATABASE_URL`.

## 3. Then merge

1. Settings above saved for Production.
2. Merge `manas/kyc-work` into `main`; Vercel deploys.
3. Expected change: customer links emailed before this deploy stop working
   (they were unsigned). Analysts re-send invites.

## 4. Afterwards

- The `neondb_owner` password was pasted into a chat on 2026-10-14. Consider
  resetting it in Neon (Roles); if you do, update `DATABASE_URL` and
  `IDV_DATABASE_URL` in Vercel and in `.env.local` **at the same moment**, or
  the live app loses its database.
- The `idv` database holds test rows from local development, which pointed at
  it. Harmless; can be listed and removed on request.
