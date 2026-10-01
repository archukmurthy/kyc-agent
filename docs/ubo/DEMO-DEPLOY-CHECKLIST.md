# UBO demo - deploy-day checklist

For the day the partner's project (`ubo-poc-v1`) is in the owner's Vercel
account (UBO-39). Go top to bottom; each step says who does it. Secrets are
typed straight into Vercel or `.env.local` - never into chat, email or Git.

## Before the day

- [ ] **Partner:** password-protect the current live demo (Vercel → project →
      Settings → Deployment Protection). It stays on until step 7.
- [ ] **Partner:** transfer the project to the owner's Vercel account
      (Settings → Transfer), and check that the database, file storage and cache
      moved with it. If they did not, tell Claude - new ones are a small job.
- [ ] **Owner:** confirm the Vercel plan allows the every-minute scheduled job
      (UBO-37). If the KYC app has deployed since 2026-09-20, it does.
- [ ] **Owner, deferred:** the privacy notice must say testers' documents are
      stored in Singapore (the file storage is `sin1`), or move storage to London.

## 1. Sign-in (Clerk) - owner

- [ ] Create a Clerk application for the demo (a development instance is fine;
      the banner is expected until there is a domain - GOLIVE-3).
- [ ] In Clerk: sign-in options → turn on **Email verification code**.
- [ ] Copy the publishable key and the secret key, for step 2.

## 2. Settings - owner, in Vercel → Settings → Environment Variables (Production)

The database, file storage and cache settings are already there, from the
connected storage. Add:

| Name | Value |
| --- | --- |
| `PRODUCT_MODE` | `ubo` |
| `REACT_APP_PRODUCT_MODE` | `ubo` |
| `REACT_APP_CLERK_PUBLISHABLE_KEY` | Clerk publishable key |
| `CLERK_SECRET_KEY` | Clerk secret key |
| `ANTHROPIC_API_KEY` | the Anthropic key (check it is there already) |
| `COMPANIES_HOUSE_API_KEY` | the Companies House key (check it is there already) |
| `SESSION_SECRET` | a new long random string |
| `CRON_SECRET` | a new long random string |
| `UBO_POC_HEALTH_KEY` | a new long random string |
| `UBO_TRIAL_PURGE_ENABLED` | `1` |
| `UBO_POC_IDV_MODE` | `DEMO` |
| `DEMO_TOTAL_RESEARCH_RUNS` | `25` |
| `DEMO_TOTAL_CHART_UPLOADS` | `25` |
| `PLATFORM_OWNER_CLERK_IDS` | added in step 6 |

A random string: in the terminal, `! node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`,
pasted straight into Vercel. `PRODUCT_MODE` and `UBO_TRIAL_PURGE_ENABLED` go on
the demo only - never on the KYC app.

## 3. Tables - Claude, with the owner's go

- [ ] The owner puts the demo database's connection string in
      `E:\kyc-agent-ubo\.env.local` as `DEMO_DATABASE_URL` (not in chat).
- [ ] Claude: a dry run (`npm run db:migrate:ubo -- --dry`) against it, and a
      look at what data is already there (the old POC's cases: keep or clear -
      the owner decides).
- [ ] Claude: `npm run db:migrate:ubo` - UBO and Evidence tables only, including
      the audit ledger (029). **Without it every case step fails.**

## 4. The code - owner says "push"

- [ ] Claude pushes the work onto `codex/ubo-demo-integrated` (nothing is pushed
      until the owner says so).
- [ ] Owner: Vercel → Settings → Git → production branch `codex/ubo-demo-integrated`.

## 5. Deploy - owner

- [ ] Deploy, and redeploy after any settings change.

## 6. First sign-in - owner

- [ ] Open `<address>/ubo-trials` and sign up with the email code.
- [ ] Copy your user id (Clerk dashboard → Users) into `PLATFORM_OWNER_CLERK_IDS`
      in Vercel, and redeploy. You are now the owner.

## 7. Check it - Claude, then owner

- [ ] Claude: the health endpoint answers (with `UBO_POC_HEALTH_KEY`), and the
      KYC pages answer "not found" (the demo is UBO only).
- [ ] Claude: the browser check on the live address (UBO-31) - paid steps only
      with the owner's go.
- [ ] Partner: remove the password protection from "Before the day".
- [ ] Owner: create the first trial invite on `/ubo-trials` and send the link.
