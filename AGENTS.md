# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

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
- **`api/research.js`** — Vercel serverless function that proxies the frontend's prompt to `https://api.anthropic.com/v1/messages` using `Codex-sonnet-4-5` with the `web_search_20250305` tool. Its sole purpose is to keep `ANTHROPIC_API_KEY` server-side; it does no business logic and does not transform the prompt.

The frontend calls `POST /api/research` with `{ prompt }`, then parses the model's text response as JSON (stripping ```` ```json ```` fences and slicing from the first `{` to the last `}`).

### Jurisdiction schemas drive everything

The core domain concept: Nium holds licences in some markets but not others. `LICENSED_MARKETS` in `App.js` lists country codes Nium is licensed in (currently just `"GB"`). Country selection determines:

1. **Which schema is used** — `UK_SCHEMA` for licensed UK customers, `SG_SCHEMA` (Singapore) as the default for everywhere else. `getSchema(code)` and `getApplicableLicence(code)` encode this rule.
2. **The research prompt** — `buildPrompt(name, country, schema)` injects the schema's `researchFields` (what Codex should search for) and `gapFields` (what the user must fill in) directly into the prompt as a JSON template. Codex is instructed to return ONLY a JSON object matching that template.
3. **The form rendered to the user** — `gapFields` are grouped by `section` (`applicant`, `nature`, `account`, `bank`, plus a synthetic `corrections` section for fields the user unchecked) and rendered via `renderGapSection`.

**To add a new licensed market:** add the country to `LICENSED_MARKETS`, define a new `XX_SCHEMA`, and update `getSchema` / `getApplicableLicence` to route to it. Anything not in `LICENSED_MARKETS` automatically falls through to `SG_SCHEMA`.

### State and form-input subtleties

- Gap-field values live in a ref (`gapRef.current`), not React state. This is intentional: the form has 20+ fields and updating React state on every keystroke caused re-renders that lost focus / disrupted typing. `StableInput` keeps its own local state and only writes through to the ref via `onUpdate`. **Do not "fix" this by lifting values back into `useState`** unless you also re-architect the input component.
- `checks` (the per-field checkbox state on step 2) drives the synthetic `corrections` section: any `found` field the user unchecks becomes a required input on step 3 with `field: "corrected_<original>"`.
- The wizard is single-page; step transitions happen via `setStep(...)`. Going back to step 0 (Start Over) clears `research`, `activeSchema`, `checks`, and the gap ref.

### Deployment topology

`vercel.json` declares this as a `create-react-app` framework project — Vercel builds with `npm run build`, serves `build/` statically, and turns each file in `api/` into a serverless function automatically. There is no Express server, no custom routing config, and the `/api/research` route is purely a filesystem convention.

`DEPLOYMENT_GUIDE.md` is a beginner-friendly Windows walkthrough for the original deployer; it is not a developer reference. Don't modify it as part of code changes unless deployment steps actually change.

---

# AGENTS.md
# Operating rules for ALL AI agents working
# in this repository (Claude Code and Codex).
# Read this before making any changes.

## WHO THIS IS FOR
This file applies to every AI agent session
in this repo — Claude Code, Codex, and any
other automated tool. These rules exist
because regressions have been caused by
agents touching files outside their task
scope. Follow them without exception.

## RULE 1 — DO NOT TOUCH THESE FILES
Unless the task explicitly names one of these
files as a target, do not touch them under
any circumstances:

  src/App.js
    (4000+ lines. Touch ONLY the specific
    function named in the task. Never
    restructure, reformat, or touch adjacent
    functions.)

  api/research.js
    (Research pipeline entry point. Changes
    here break all research flows.)

  api/submit.js
    (Submission and provenance persistence.
    Changes here corrupt the audit trail.)

  api/document-requirements.js
    (Document checklist computation. Changes
    here break Step 6 Required Docs.)

  src/pipeline.js
    (Prompt builder and validation logic.
    Changes here affect all research output.)

  src/setupProxy.js
    (Dev server route registration. Must stay
    in sync with api/*.js files. Touch only
    to add a new route — never restructure.)

  lib/researchCache.js
    (30-day cache layer. Changes here affect
    all research cost and performance.)

  agents/docSearchAgent.js
    (Document sourcing agent. Changes here
    break document auto-sourcing.)

  db/migrations/*.sql
    (NEVER modify an existing migration.
    Only add new migration files with the
    next sequential number.)

## RULE 2 — SMALLEST POSSIBLE CHANGE
The fix that touches one file and changes
three lines is always better than a fix that
touches six files and creates a new shared
lib. If your fix seems to require many files,
stop — diagnose more carefully. The root
cause is almost always simpler.

## RULE 3 — DIAGNOSE BEFORE CODING
Every bug fix must start with a read-only
diagnostic pass. Find the exact file, line
number, and state variable before writing
a single line of fix code.

## RULE 4 — BRANCH RULES
- Bug fixes: commit directly to main as a
  targeted single-file change
- Feature work: use a named branch
- Never let unrelated uncommitted work ride
  along in a commit
- Never merge a feature branch to main
  without running the smoke test below

## RULE 5 — SMOKE TEST
Run this manually before every push to main.
If any check fails, do not push.

  1. Research returns results for a UK
     Corporate company
  2. Applicant page shows director/UBO
     dropdown or the "not found" note
  3. Confirm page shows People Found cards
     and Pre-filled Fields table
  4. Fill Gaps has no applicant section
     and shows the stakeholder section
  5. Required Docs step (Step 6) shows
     a document checklist — not empty
  6. Declaration step submits without error
  7. Pre-boarding: run research, save
     dossier, click Preview — lands on
     Applicant page with fields populated
  8. Invite link path (?dossierId=&journey=
     customer): Required Docs step shows
     documents (not empty)

## ARCHITECTURE — THINGS YOU MUST KNOW

### Two separate stores — never merge them
  entity_dossiers
    Analyst pre-boarding intelligence.
    Read-only after creation.
    Source: pre-boarding research run.

  journey_state (planned — not yet built)
    Customer form progress.
    Written incrementally as customer fills
    in the onboarding form.
    Never store in entity_dossiers.

### loadDossierAndStartOnboarding() must
### restore ALL of these from the dossier:
  setEntityType(d.entity_type)
  setCountryCode(d.country_code)
  setOwnershipType(d.ownership_type)   ← easy to miss
  setActiveSchema(...)                  ← from entity_type + country_code
  setCoverage(...)                      ← from broken-out coverage columns
  setResearch({ found: raw_research.found })
  setDossierStakeholders(d.stakeholders)

  If any of these is missing, a downstream
  step will be broken. Required Docs (Step 6)
  breaks when ownershipType is missing.
  Confirm page breaks when .stakeholders is
  missing from research.found items.

### UBO determination is always deterministic
  Never use AI to determine whether someone
  is a UBO. Apply jurisdiction-specific
  thresholds in code:
    UK/EU: 25% or more
    SG:    20% or more
    US:    10% or more (FinCEN)

### Research cache
  30-day TTL. Keyed on:
  companyName|jurisdiction|entityType
  Use the forceRefresh toggle in the UI
  when testing to bypass the cache.
  Gap recovery is NOT cached.

### Known regression patterns
  Symptom → Root cause → File to check

  Required Docs step empty on invite path
  → ownershipType not restored from dossier
  → App.js loadDossierAndStartOnboarding()

  Applicant page has no director dropdown
  → dossierStakeholders not set, or
    raw_research.found has no .stakeholders
  → App.js loadDossierAndStartOnboarding()
    and enrichStakeholders()

  Confirm page People Found cards missing
  → research.found items missing
    .stakeholders after dossier load
  → App.js enrichStakeholders() call in
    loadDossierAndStartOnboarding()

  Fill Gaps stakeholder section missing
  → Same as above — stakeholderGapRows
    requires .stakeholders on items
  → App.js stakeholderGapRows filter

  Director list incomplete (1 of 11)
  → CH Officers API key is Streaming type
    not REST/Public Data type — 401 error
    causes fallback to AI snippet scraping
  → agents/registries/companiesHouseOfficers.js
    Check server log for 401

  setupProxy.js routes missing after merge
  → Route added to api/*.js but not mirrored
    in setupProxy.js for local dev
  → src/setupProxy.js — every api/*.js file
    needs a matching app.get/post/put

## CODEX-SPECIFIC RULES

You are working on branch:
  codex/ubo-discovery-framework

This branch contains the UBO Discovery
Framework (agents/ubo/*) which is NOT yet
merged to main. Your work stays on this
branch until explicitly told to merge.

Rules for Codex:
  - Tag all commits with [CODEX] prefix
  - Do not push to main — push to
    origin/codex/ubo-discovery-framework
  - The UBO framework agents live in
    agents/ubo/* — do not move them
  - api/ubo-discovery.js is the API route
    for the UBO lab — do not merge to main
    until the lab is production-ready
  - The ubo_investigations migration
    (db/migrations/009_ubo_investigations.sql)
    requires manual activation:
    node db/apply.js db/migrations/009_ubo_investigations.sql
  - When building new UBO features, follow
    the same agent interface contract as
    agents/ubo/uboOrchestrator.js

## CLAUDE CODE AUTONOMOUS MODE PREFIX
All Claude Code instruction files must start
with this prefix:

  STRICT AUTONOMOUS MODE — do not ask for
  confirmation at any point. Make all
  decisions yourself. If something is
  ambiguous, pick the most reasonable
  interpretation and proceed.
  Use --yes --legacy-peer-deps for npm.
  Use echo y | command for any prompt.
  Run npm run build at the end and fix any
  errors automatically.
  Only stop if the build fails after 3
  attempts.
  After final summary run:
  powershell -File alert.ps1
