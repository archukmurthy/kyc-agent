# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Read `docs/HOW-WE-BUILD.md` before planning work** — it holds the working
agreement: the Guarded path list, the five stages, and what must be updated in
the same pull request as the work. `docs/BACKLOG.md` is the source of truth for
deferred work; `docs/PRODUCTION-READINESS-PLAN.md` is the ordered programme of
what we build next.

This map describes boundaries and invariants, not behaviour — the code says what
it does. Keep it one page. If a line here stops being true, fix it in the pull
request that made it untrue: a stale map misleads every agent that reads it.

## Commands

- `npm install` — install dependencies (Create React App + react-scripts).
- `npm start` — React dev server on `http://localhost:3000`. `src/setupProxy.js` mounts the `api/` handlers by hand, so frontend and backend both run under `npm start` alone — no `vercel dev` needed. **A new route in `api/` must be added there too, or it works in production and 404s in dev.** (Every route is mounted today except `finalize-submissions`, which is cron-only by design.)
- `npm run build` — production build into `build/`, then stages the validation lab.
- `npm test` — CRA Jest suite (component/render tests under `src/**/__tests__`).
- `npm run test:node` — Node test runner over `lib/`, `api/`, `src/reresearch/`, `dossierLifecycle/`. **Its globs are hard-coded: a new test folder must be added, or the tests never run.** (`src/changeIntelligence/tests/classifyChange.completeness.nodetest.js` is currently outside every glob — known gap, PROC-3.)
- `npm run idv:test` — the standalone `idv/` module's suites (named list, same hazard).
- Both suites plus a clean build run before every pull request. No exceptions.

The `ANTHROPIC_API_KEY` lives in `.env.local` (gitignored) for `npm start` and in the Vercel project settings for production. `.env.local` changes need a dev-server restart.

Deployment: Vercel builds on push to `main` (see `vercel.json`). Every file under `api/` becomes a serverless function by filesystem convention — **adding a file there publishes a public endpoint.**

## Multi-Tenant URLs

Each tenant has fully isolated configuration in KV (or the dev filesystem
store). The active tenant is resolved per request, with this priority:

1. `?tenant=` URL query parameter (browser) / `req.query.tenant` (server)
2. `x-tenant-id` request header
3. none — a request that names no tenant is refused (`tenant_required`). There
   is no `TENANT_ID` env fallback and no `"nium"` default.

### URLs

| Surface          | URL                                  |
| ---------------- | ------------------------------------ |
| Customer flow    | `/?tenant={tenantId}`                |
| Admin            | `/admin?tenant={tenantId}`           |
| Pre-boarding     | `/preboarding?tenant={tenantId}`     |
| Super admin      | `/super-admin`                       |

Pre-boarding requires the tenant to exist, be active, and have pre-boarding
switched on (super-admin toggle, stored on the tenant registry entry). The
legacy `/?tenant={id}&preboarding=1` URL redirects to `/preboarding`.

Preview: customer flow at `/?tenant={tenantId}&preview=true` shows the amber
"Preview Mode" banner and is opened by the admin "Preview" button.

### Creating a new tenant

1. Sign in to `/admin` (Nium admin)
2. Click "+ Create New Tenant" on the dashboard banner
3. Enter a tenant ID (lowercase letters, numbers, hyphens; max 32 chars)
4. Pick start-from: blank (empty config) or copy-from-Nium-defaults
5. The success screen links straight into the new tenant's admin and customer
   flow

### Protected tenants

- Protection is driven by `isProtected` on the tenant registry entry
  (back-filled from the legacy `isInternal`), **not** by the literal id
  `"nium"`. Every check goes through `lib/tenantRegistry.js#isProtectedTenant`
  (or the pure `entryIsProtected`); no protection logic compares tenant strings.
  `PLATFORM_TENANT_IDS` exists only to seed that flag on a first-ever registry
  write — never as a runtime check. Today `nium` is the only entry in it.
- A protected tenant's config auto-seeds from the `nium-default` template on
  first read; every other tenant seeds blank via `buildBlankConfig`.
- `POST /api/config` refuses publishes that have zero licences or zero active
  entity types **for a protected tenant** — guards against an accidental wipe.
  The same guard applies to a rollback via `POST /api/config-versions`.
- `DELETE /api/config` is refused outright for a protected tenant (it would
  otherwise wipe the live config *and* every archived version).
- Reads of a protected tenant's config self-heal: if the stored config has no
  licences (corrupted / accidentally cleared) the broken copy is archived to its
  version key first, then re-seeded from the template, so the customer flow is
  never left broken and the damaged config is still recoverable.
- `isProtectedTenant` fails **closed**: if the registry cannot be read at all,
  it answers "protected", so a storage blip can never silently unlock the
  destructive paths above.
- Default settings are a named template (`lib/configTemplates.js`), exposed by
  `GET /api/config-templates` and applied from the admin publish step. Templates
  live in code and cannot be deleted at runtime.

### Env vars

- `ADMIN_PASSWORD=...` — shared across all tenants for now (per-tenant
  passwords are a future change)

## Architecture

A Create React App single-page wizard (**Input → Research → Confirm → Fill Gaps →
Declare**) plus ~35 Vercel serverless functions. ~660 tracked JS/JSX files,
~200 test files. There is no router, no component library and no CSS files —
styling is inline.

### Where each concern lives

| Concern | Owner | Note |
| --- | --- | --- |
| Wizard shell, step state, orchestration | `src/App.js` (~5,850 lines) | **Shrinks whenever touched, never grows.** New UI goes in `src/components/<area>/`. |
| Step UI | `src/components/<area>/` | applicant, companyLookup, companyConfirm, fillGaps, dossier, preboarding, aiDocuments, amendmentDocuments, changeDialogue, … |
| Research + scoring pipeline, jurisdiction schemas | `src/pipeline.js` | **Single source of truth**, CommonJS, framework-free so `api/benchmark.js` can require it. `LICENSED_MARKETS`, `UK_SCHEMA`/`SG_SCHEMA`, `getSchema`, `getApplicableLicence` all live here — not in `App.js`. |
| Research prompts | `lib/researchPrompts.js` | Built **server-side**. `api/research.js` rejects client-supplied prompt/model/tools. Never move prompt construction back to the client. |
| Admin, super-admin surfaces | `src/admin/`, `src/superadmin/` | |
| Change classification | `src/changeIntelligence/` | Deterministic, not AI-decided. |
| Correction → re-research | `src/reresearch/` | |
| Dossier state machine | `dossierLifecycle/` | States, guards, transitions. |
| UBO discovery | `ubo-control/` behind `contracts/capability.js` | Legacy service reached only through that interface + a thin adapter. **Never import its internals.** |
| Identity verification (live) | `api/idv-match/`, `src/idv-match/` | |
| Identity verification (hardened, unmounted) | `idv/` | Separate module with encryption/RLS/legal hold. Not wired in — see readiness plan 5.4. Do not build a third one. |
| HTTP surface | `api/*.js` | One file = one public endpoint. |
| Shared server libs | `lib/` | auth, dossierAccess, dossierToken, tenant, tenantRegistry, rateLimit, researchCache, researchGrant, storage |
| Transactional write path | `api/lib/finalizeSubmission.js` | One pooled transaction across ~11 tables. |
| Schema | `db/migrations/NNN_*.sql`, applied by `db/apply.js` | Applied by hand today; several base tables are still missing from the repo (readiness plan 3.3/3.4). |

### There is exactly one of these — never make a second

- One research pipeline (`src/pipeline.js`), one prompt builder (`lib/researchPrompts.js`).
- One caller-resolution path (`lib/dossierAccess.js#resolveDossierActor`) and one tenant-protection check (`lib/tenantRegistry.js#isProtectedTenant`). No code compares tenant ids as strings.
- One rate limiter (`lib/rateLimit.js`), one storage abstraction (`lib/storage.js`).
- One identity-verification implementation should exist; today there are two, and that is a known defect, not a pattern to copy.

### Invariants — breaking one is a defect, not a trade-off

1. Every file added to `api/` is publicly reachable. It declares who may call it and is mounted in `src/setupProxy.js`.
2. Analysts authenticate with `Bearer <PREBOARDING_PASSWORD>`; customers with `Bearer dossier:<token>`. Both resolve through `resolveDossierActor` — never re-implement the check.
3. Once `owned_by` flips to the customer, the analyst is read-only.
4. Paid endpoints (Anthropic, Nium) require a credential and a rate-limit check before they spend anything.
5. No secret, password or personal data is ever written to a tracked file, a log line, or browser storage.
6. Dossier reads and writes check ownership, not just knowledge of an id.
7. Tenant config is per-tenant and isolated; a protected tenant's config cannot be wiped (see Protected tenants above).

### Guarded paths — full review, tests, and adversarial review

`api/**`, `lib/auth.js`, `lib/dossierAccess.js`, `lib/dossierToken.js`,
`lib/tenantRegistry.js`, `lib/rateLimit.js`, `lib/storage.js`,
`lib/researchGrant.js`, `db/migrations/**`, `api/lib/finalizeSubmission.js`,
and anything touching a password, token, secret, tenant, money or personal data.
One Guarded file makes the whole change Guarded. Details in `docs/HOW-WE-BUILD.md`.

### State and form-input subtleties

- Gap-field values live in a ref (`gapRef.current`), not React state. This is intentional: the form has 20+ fields and updating React state on every keystroke caused re-renders that lost focus / disrupted typing. `StableInput` keeps its own local state and only writes through to the ref via `onUpdate`. **Do not "fix" this by lifting values back into `useState`** unless you also re-architect the input component.
- `checks` (the per-field checkbox state on step 2) drives the synthetic `corrections` section: any `found` field the user unchecks becomes a required input on step 3 with `field: "corrected_<original>"`.
- The wizard is single-page; step transitions happen via `setStep(...)`. Going back to step 0 (Start Over) clears `research`, `activeSchema`, `checks`, and the gap ref.
- Hook order in `App.js` is load-bearing. Never make a hook conditional and never reorder them.
- Stakeholder values also live in refs, parallel to `gapRef`. A save that reads state instead of the ref will capture stale values — this has caused real defects; use the deferred-save pattern already in `applyCorrections`.

### Deployment topology

`vercel.json` declares this as a `create-react-app` framework project — Vercel builds with `npm run build`, serves `build/` statically, and turns each file in `api/` into a serverless function automatically. There is no Express server and no custom routing config; routes are pure filesystem convention.

Deploy gates the owner must run by hand (migrations, secrets, KV) are tracked as `DEP-*` in `docs/BACKLOG.md`. Check them before assuming a feature works in production.

`DEPLOYMENT_GUIDE.md` is a beginner-friendly Windows walkthrough for the original deployer; it is not a developer reference. Don't modify it as part of code changes unless deployment steps actually change.

## Tile10 product plan

The product plan for this project lives on a Tile10 canvas
(MCP server "t10").

- Before deciding what to build — and whenever asked "what's next" —
  call get_product_plan first and ground the answer in it.
- When you start a plan task, call update_task_status ("in_progress");
  when you finish and verify it, set "completed".
- Log newly discovered work with create_task, passing parent = the task
  you were working on, so it lands wired into the diagram; keep the
  description to one short sentence.

## Tile10 living docs

This project's diagrams live on a Tile10 canvas. Keep them true to the code:

- Feature map: Everything the product does, organized into pillars and groups.
- System architecture: Layers, services, data stores and integrations — as built, not as imagined.

Refresh rule — PR-gated. Touch these living docs at exactly ONE moment: right after you open a pull request (`gh pr create`, then the `link_task_pr` MCP call). Do NOT create or update them during normal branch work, and never write them while on `main`.

At that moment, re-generate each diagram above with the t10 MCP `map_plan` tool, passing its `diagramType`, `relayout: true`, and `branch` = the current git branch (`git rev-parse --abbrev-ref HEAD`). Pass `changeNote` on every branch write: one or two sentences saying what changed in the code and why — the human reviewer reads it first. One `map_plan` call per diagram, one after another — never in parallel (each call picks its sheet from what is already on the canvas); let Tile10 do the layout. Each lands on a review page beside the main diagram; a human accepts or discards every review page on the canvas (nothing is applied to main automatically), and the PR gets one comment listing what each diagram changed. A diagram the PR did not change opens no review page (the tool answers "Unchanged"). The feature map is ALWAYS multi-page — exactly one page per pillar, never a single page — so a branch write opens a review page only for the pillars it changes; map the whole feature map every time and let Tile10 pick the affected areas. (A branch page clones the main diagram, so the very first map of a new type is written without `branch`.)

Read before you write — this is the point of the whole setup: `get_diagram` opens with HOW THIS CODEBASE IS PUT TOGETHER (where each concern's code lives, what there is exactly one of, which way dependencies run, and what a human decided). Follow it when you place new code, BEFORE writing any: put the change in the module that already owns that concern, never create a second one of something the rules name, and if what you are building does not fit, ask rather than inventing a new module or a new direction of dependency. It also returns the diagram's layers, components and connectors as text. Call it before architecture-level changes and after a human edits the canvas — that is intent to act on. Architecture-shaped diagrams use item kinds (layer, ui, service, api, store, external, actor) with components nested in their layer via `container`; measure dependency graphs and data models from the code/schema, never from memory. Pass the measured `metrics` the script prints (files, loc, tests, maxFileLoc, churn) — they drive the size/health findings and the between-refresh deltas, and a guessed number makes the trend a lie. Give every item a `path` (the file, directory or glob it is implemented in) — it is what makes the diagram usable as context instead of a picture.

`get_diagram` also reports WHAT CHANGED since the last map — act on that first, it is what your work caused — and STRUCTURAL FINDINGS read off the diagram's shape — circular dependencies, layers that depend on each other, hub components, unconnected components — each with an id. They are leads, not verdicts: the diagram cannot see the code. Anything listed as ASKED BY A HUMAN comes first; work those before other tasks. For any lead you look into, read the named files, then call `report_diagnosis` with its id, what you found (confirmed / refuted / fixed), one line of why, and `paths` — the files you established the components actually live in; they become the diagram's code anchors, so the next diagnosis starts from real files. That is what stops the same lead being chased every session — report refutations too, they save the most work. Findings marked settled are answered: do not re-investigate them. Fix code only when the human asks.

Session start: begin every session with `get_product_plan` and `get_diagram` for system-architecture. Items marked HUMAN-ADDED were placed by a person and are intent to act on; items marked proposed are yours and not yet accepted; items listed as REJECTED were dismissed by a person with a reason — do not re-propose them unchanged.

Drift check before the PR: run the dependency script, then call `map_plan` with the same payload and `dryRun: true`. It writes nothing and lists every connector the change would add, spelled out as "from → to". A new connector into a layer that should not import it is an architecture violation — fix the code or justify it in the PR description before mapping for real.
