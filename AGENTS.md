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
4. fallback `"demo"`

### URLs

| Tenant            | Customer flow                | Admin                            |
| ----------------- | ---------------------------- | -------------------------------- |
| Primary (Demo)    | `/`                          | `/admin`                         |
| Any other tenant  | `/?tenant={tenantId}`        | `/admin?tenant={tenantId}`       |

Preview: customer flow at `/?tenant={tenantId}&preview=true` shows the amber
"Preview Mode" banner and is opened by the admin "Preview" button.

### Creating a new tenant

1. Sign in to `/admin` (Demo admin)
2. Click "+ Create New Tenant" on the dashboard banner
3. Enter a tenant ID (lowercase letters, numbers, hyphens; max 32 chars)
4. Pick start-from: blank (empty config) or copy-from-Demo-defaults
5. The success screen links straight into the new tenant's admin and customer
   flow

### Demo protection

- The Demo config is the only one that auto-seeds from
  `lib/seedConfig.js#buildDefaultConfig` on first read. Every other tenant
  seeds blank via `buildBlankConfig`.
- `POST /api/config?tenant=demo` refuses publishes that have zero licences or
  zero active entity types — guards against an accidental wipe.
- Reads of the Demo config self-heal: if the stored config has no licences
  (corrupted / accidentally cleared) it's re-seeded from defaults and the
  customer flow is never left broken.

### Env vars

- `TENANT_ID=demo` — the default tenant served when no `?tenant=` is present
- `ADMIN_PASSWORD=...` — shared across all tenants for now (per-tenant
  passwords are a future change)

## Architecture

This is a single-page React app (Create React App) with one Vercel serverless function. The app is a 5-step KYC onboarding wizard for Demo: **Input → Research → Confirm → Fill Gaps → Declare**.

### Two-piece structure

- **`src/App.js`** — the heart of the frontend: the `KYCAgent` component owns all state, effects, step routing and page rendering (styling is inline; there are no CSS files and no router; `src/index.js` just mounts it). Pure constants, prompts, demo fixtures, small shared components and stateless workflow helpers live in dedicated modules under `src/constants/`, `src/utils/`, `src/config/`, `src/demo/`, `src/components/` and `src/workflows/` — see the FRONTEND MODULE MAP section below.
- **`api/research.js`** — Vercel serverless function that proxies the frontend's prompt to `https://api.anthropic.com/v1/messages` using `Codex-sonnet-4-5` with the `web_search_20250305` tool. Its sole purpose is to keep `ANTHROPIC_API_KEY` server-side; it does no business logic and does not transform the prompt.

The frontend calls `POST /api/research` with `{ prompt }`, then parses the model's text response as JSON (stripping ```` ```json ```` fences and slicing from the first `{` to the last `}`).

### Jurisdiction schemas drive everything

The core domain concept: Demo holds licences in some markets but not others. `LICENSED_MARKETS` in `App.js` lists country codes Demo is licensed in (currently just `"GB"`). Country selection determines:

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

## RULE 6 — WORKTREE SETUP
Extractions and refactors run in a git
worktree under .claude/worktrees/. Three
environment landmines fire there and NOT in
the primary repo. Handle all three BEFORE
writing code — each one, discovered mid-run,
reads as a self-inflicted regression.

### 6a. Pull the primary worktree first
C:\kyc-agent-deploy does NOT auto-follow
origin/main. Before cutting a branch:

    git -C C:\kyc-agent-deploy pull --ff-only origin main

Skip it and the branch is cut one behind,
then needs a rebase before merge. This has
happened before.

### 6b. Baseline the render suite BEFORE editing
In a worktree the JSX render suites fail with
"Invalid hook call ... more than one copy of
React". The worktree has no
@testing-library/react, so it resolves from
the parent repo and drags the PARENT's
react-dom in beside the worktree's react.
Both are the same version — these are
duplicate INSTANCES, not a version clash, so
do not go hunting for a version mismatch.

Pin them at run time. No committed file
changes, no package install:

    CI=true npx react-scripts test --watchAll=false \
      --testMatch='**/*.test.{js,jsx}' \
      --moduleNameMapper='{"^react$":"<rootDir>/node_modules/react","^react-dom$":"<rootDir>/node_modules/react-dom","^react-dom/(.*)$":"<rootDir>/node_modules/react-dom/$1","^react/(.*)$":"<rootDir>/node_modules/react/$1"}'

RUN THIS BEFORE YOU TOUCH ANY CODE. Unmapped,
it is ~101 red of 374 — all 5 render suites,
none of them your fault. Establishing that
baseline first is the only thing that makes a
LATER red attributable to your change.

### 6c. Smoke harness env + the Jest glob
npm run test:smoke:db reads .env.test.local
from process.cwd(), and that gitignored file
exists only in the primary repo. Copy it into
the worktree first. It must provide:

  TEST_DATABASE_URL
    a DISPOSABLE Neon branch — never the
    application database
  REAL_DB_SMOKE_CONFIRM
    = I_UNDERSTAND_TEST_DATA_WILL_BE_WRITTEN

The harness refuses to run if
TEST_DATABASE_URL normalises to DATABASE_URL
(scripts/real-db-smoke.js#requireSafeTestDatabase).
That is a hard guard, not a convention — but
set the value correctly rather than relying
on it.

Same non-inheritance trap applies to the
sibling .env.local used by the dev server. It
can be PRESENT but STALE (rotated Neon
credential, missing BLOB_READ_WRITE_TOKEN),
which breaks pre-boarding — save-dossier is
its spine — and looks exactly like a broken
refactor. Fingerprint both copies before
blaming code; never print the values:

    for k in DATABASE_URL ANTHROPIC_API_KEY BLOB_READ_WRITE_TOKEN; do
      v=$(grep -m1 "^$k=" .env.local | cut -d= -f2-)
      echo "$k ${#v} $(printf %s "$v" | sha256sum | cut -c1-12)"
    done

Separately, and independent of any env: Jest
run from a .claude/worktrees/ path finds 0
tests unless you pass
--testMatch='**/*.test.{js,jsx}'. The default
glob breaks on the backslash in the path, and
the suite silently runs nothing.

## RULE 7 — PARALLEL-EDIT SAFETY
Two agents must NEVER edit src/App.js — or any
shared file — concurrently in the same working
tree.

Concurrent edits RACE. An agent that trusts its
line numbers (the normal, reasonable thing) will
silently overwrite the other agent's edit. The
result is a regression discovered later, when
tests go red for no explicable reason — exactly
the silent failure the net-first discipline
exists to prevent.

This is not hypothetical. It happened during the
A‖C extraction (AIDocumentsPage ‖ JourneyPicker).
Both agents believed they were in separate
worktrees. They were not — both were editing
C:\kyc-agent-deploy directly. App.js shifted
twice mid-surgery (6944 → 6704 → 6707) and the
pair landed green ONLY because one agent had
improvised the guards in 7c below. Without them
the second move would have destroyed the first.

### 7a. Pick ONE of these — mandatory
Any parallel pair that touches App.js MUST use
(1) or (2). There is no third option.

(1) GENUINE git worktree isolation. Each agent
    in a real, separate checkout — its own
    filesystem path with its own working tree.
    Merge at the end: first agent merges to
    main, second REBASES onto it, and the
    SECOND agent runs BOTH nets, because one
    page's net driver may thread through the
    other's component. (The AI-Documents net
    drives through the journey picker to reach
    its step — a real instance of this.)

    VERIFY the isolation before relying on it.
    A .claude/worktrees or .codex-worktrees
    path did NOT provide it previously. Check
    `git rev-parse --show-toplevel` actually
    differs between the agents.

(2) SERIALIZE the App.js edits. The component
    files and characterisation nets are
    SEPARATE files and are ALWAYS safe to
    author in parallel. Only the App.js
    call-site + import edits race. So: author
    both components and both nets in parallel,
    then apply the two App.js edits one at a
    time — first agent's move and merge, then
    the second re-anchors BY SYMBOL against the
    updated App.js and applies its edit.

### 7b. What is and is not the serialization point
Nets and components: always parallel-safe.
App.js call site + import: the ONLY racing
surface. When in doubt, serialize the App.js
edit. Cost of serializing: one extra sequential
step. Cost of getting it wrong: silently
clobbering another agent's work.

### 7c. Standard defenses — default, not improvised
Any App.js edit that could run under concurrency
must do all three. These caught the A‖C
near-misses:

  - RE-ANCHOR BY SYMBOL at execution time, never
    by a cached line number. Line numbers from a
    read taken minutes ago are already stale.
  - DIFF-VERIFY the moved region is byte-identical
    to the source before installing. If it
    drifted, someone else edited it — abort.
  - CHECKSUM-GUARD the target. Record App.js's
    hash before the rebuild; if it differs at
    install time, ABORT and re-anchor. Never
    install over a file that shifted underneath
    you.

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

## FRONTEND MODULE MAP

The modularization refactor (first phase,
2026-07) moved the pure, self-contained
parts of src/App.js into dedicated modules.
This is a first modularization pass that
creates parallel-development seams — it is
NOT the final breakup of App.js, which
remains large. src/App.js still owns ALL
state, effects, step routing and page
rendering — the RULE 1 restrictions on it
are unchanged. The extracted modules are:

  src/constants/
    theme.js            — C colour palette
    appConstants.js     — SHOW_TEST_TOOLS /
      TEST_FLAG, MANUAL_FORM_URL, COUNTRIES,
      OWNERSHIP_ID_TO_DRS, CACHE_STALE_DAYS
    extractionPrompts.js — per-document AI
      extraction prompts (Wolfsberg, cert,
      licence, annual report, org chart, AML)
    docTypes.js         — DOC_TYPES catalogue,
      initialUploadedDocs, docTypesForEntity,
      buildPhase1Msgs
    loaderMessages.js   — research/doc loader
      message lists

  src/utils/
    costs.js            — API_PRICING,
      calcCostUsd, buildCostSummary
    extractionMapping.js — EXTRACTION_KEY_TO_
      SCHEMA, mapExtractedKey,
      normalizeResearchFieldIds,
      selfSourcedToRows
    files.js            — readFileAsBase64,
      formatFetchedAt

  src/config/
    localDefaultConfig.js — offline fallback
      tenant config (buildLocalDefaultConfig)

  src/demo/
    demoData.js         — TEST_DATA,
      DUMMY_RESEARCH_VALUES, demo doc-search
      and self-source fixtures (synthetic
      sentinels only — see PR-059 A)

  src/components/
    banners/PreviewBanner.jsx
    banners/DemoBanner.jsx
    banners/DemoToggle.jsx
    inputs/StableInput.jsx   — CRITICAL:
      local-state + gapRef write-through;
      do not lift values into parent state
    inputs/PrePopulatedField.jsx
    dossier/DossierSection.jsx

  src/workflows/
    documentWorkflow.js — stateless
      browser-side document-workflow logic
      (no React state): mapToDocAgent
      OwnershipType and preCheckDocFor
      OwnershipType are pure mapping
      helpers; extractFromDoc performs I/O
      (reads the uploaded file, POSTs to
      /api/research for extraction)
    applicantWorkflow.js — genUUID,
      isCorporateStakeholder,
      APPLICANT_FALLBACK_FIELDS,
      getApplicantCandidates,
      buildApplicantProvenance (pure; App.js
      wraps them with its state)

  src/__tests__/
    appMounts.test.jsx  — full-tree mount
      characterization test
    characterization.pure.test.js
    characterization.workflows.test.js
      — golden-value tests pinning the
        extracted modules to pre-refactor
        behaviour

Module ownership for agents:
  - A task scoped to prompts, doc catalogue,
    constants, demo fixtures or the pure
    workflow helpers should edit ONLY the
    matching module above — not App.js.
  - A task scoped to state, effects, step
    routing or page rendering still edits
    App.js under the RULE 1 constraints
    (only the named function).
  - The existing extracted helpers must
    remain free of React state — state is
    passed in as arguments. Moving state
    handling out of App.js (e.g. into a
    dedicated hook) is allowed only as an
    explicitly scoped refactor task, never
    as a side effect of another change.
  - Run scripts/refactor-smoke-checklist.md
    (all 6 checks) plus `npx react-scripts
    test --watchAll=false` after touching
    any of these modules.

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
