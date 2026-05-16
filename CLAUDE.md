# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm install` — install dependencies (Create React App + react-scripts).
- `npm start` — run the React dev server on `http://localhost:3000`. `src/setupProxy.js` auto-mounts `/api/research` on the dev server with the same logic as `api/research.js`, so the full app (frontend + backend) works under `npm start` alone — no `vercel dev` needed.
- `npm run build` — production build into `build/` (the directory Vercel serves).
- `npm test` — runs the CRA Jest test runner. There are currently no tests.

The `ANTHROPIC_API_KEY` lives in two places: locally in `.env.local` at the repo root (gitignored) for `npm start`, and in the Vercel project settings for production. Changes to `.env.local` only take effect after a dev-server restart, not on hot reload.

Deployment is handled by Vercel on push to `main` (see `vercel.json`). The only required env var is `ANTHROPIC_API_KEY`.

## Multi-Tenant URLs

Each tenant has fully isolated configuration in KV (or the dev filesystem
store). The active tenant is resolved per request, with this priority:

1. `?tenant=` URL query parameter (browser) / `req.query.tenant` (server)
2. `x-tenant-id` request header
3. `TENANT_ID` environment variable
4. fallback `"nium"`

### URLs

| Tenant            | Customer flow                | Admin                            |
| ----------------- | ---------------------------- | -------------------------------- |
| Primary (Nium)    | `/`                          | `/admin`                         |
| Any other tenant  | `/?tenant={tenantId}`        | `/admin?tenant={tenantId}`       |

Preview: customer flow at `/?tenant={tenantId}&preview=true` shows the amber
"Preview Mode" banner and is opened by the admin "Preview" button.

### Creating a new tenant

1. Sign in to `/admin` (Nium admin)
2. Click "+ Create New Tenant" on the dashboard banner
3. Enter a tenant ID (lowercase letters, numbers, hyphens; max 32 chars)
4. Pick start-from: blank (empty config) or copy-from-Nium-defaults
5. The success screen links straight into the new tenant's admin and customer
   flow

### Nium protection

- The Nium config is the only one that auto-seeds from
  `lib/seedConfig.js#buildDefaultConfig` on first read. Every other tenant
  seeds blank via `buildBlankConfig`.
- `POST /api/config?tenant=nium` refuses publishes that have zero licences or
  zero active entity types — guards against an accidental wipe.
- Reads of the Nium config self-heal: if the stored config has no licences
  (corrupted / accidentally cleared) it's re-seeded from defaults and the
  customer flow is never left broken.

### Env vars

- `TENANT_ID=nium` — the default tenant served when no `?tenant=` is present
- `ADMIN_PASSWORD=...` — shared across all tenants for now (per-tenant
  passwords are a future change)

## Architecture

This is a single-page React app (Create React App) with one Vercel serverless function. The app is a 5-step KYC onboarding wizard for Nium: **Input → Research → Confirm → Fill Gaps → Declare**.

### Two-piece structure

- **`src/App.js`** — the entire frontend lives in this one file as the `KYCAgent` component. All UI, state, schemas, prompt construction, and styling (inline) are here. There is no component library, no CSS files, and no router. `src/index.js` just mounts it.
- **`api/research.js`** — Vercel serverless function that proxies the frontend's prompt to `https://api.anthropic.com/v1/messages` using `claude-sonnet-4-5` with the `web_search_20250305` tool. Its sole purpose is to keep `ANTHROPIC_API_KEY` server-side; it does no business logic and does not transform the prompt.

The frontend calls `POST /api/research` with `{ prompt }`, then parses the model's text response as JSON (stripping ```` ```json ```` fences and slicing from the first `{` to the last `}`).

### Jurisdiction schemas drive everything

The core domain concept: Nium holds licences in some markets but not others. `LICENSED_MARKETS` in `App.js` lists country codes Nium is licensed in (currently just `"GB"`). Country selection determines:

1. **Which schema is used** — `UK_SCHEMA` for licensed UK customers, `SG_SCHEMA` (Singapore) as the default for everywhere else. `getSchema(code)` and `getApplicableLicence(code)` encode this rule.
2. **The research prompt** — `buildPrompt(name, country, schema)` injects the schema's `researchFields` (what Claude should search for) and `gapFields` (what the user must fill in) directly into the prompt as a JSON template. Claude is instructed to return ONLY a JSON object matching that template.
3. **The form rendered to the user** — `gapFields` are grouped by `section` (`applicant`, `nature`, `account`, `bank`, plus a synthetic `corrections` section for fields the user unchecked) and rendered via `renderGapSection`.

**To add a new licensed market:** add the country to `LICENSED_MARKETS`, define a new `XX_SCHEMA`, and update `getSchema` / `getApplicableLicence` to route to it. Anything not in `LICENSED_MARKETS` automatically falls through to `SG_SCHEMA`.

### State and form-input subtleties

- Gap-field values live in a ref (`gapRef.current`), not React state. This is intentional: the form has 20+ fields and updating React state on every keystroke caused re-renders that lost focus / disrupted typing. `StableInput` keeps its own local state and only writes through to the ref via `onUpdate`. **Do not "fix" this by lifting values back into `useState`** unless you also re-architect the input component.
- `checks` (the per-field checkbox state on step 2) drives the synthetic `corrections` section: any `found` field the user unchecks becomes a required input on step 3 with `field: "corrected_<original>"`.
- The wizard is single-page; step transitions happen via `setStep(...)`. Going back to step 0 (Start Over) clears `research`, `activeSchema`, `checks`, and the gap ref.

### Deployment topology

`vercel.json` declares this as a `create-react-app` framework project — Vercel builds with `npm run build`, serves `build/` statically, and turns each file in `api/` into a serverless function automatically. There is no Express server, no custom routing config, and the `/api/research` route is purely a filesystem convention.

`DEPLOYMENT_GUIDE.md` is a beginner-friendly Windows walkthrough for the original deployer; it is not a developer reference. Don't modify it as part of code changes unless deployment steps actually change.
