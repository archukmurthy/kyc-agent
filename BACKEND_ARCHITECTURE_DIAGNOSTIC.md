# Backend & Cloud Architecture Diagnostic — Handover Report

**Repository:** `archukmurthy/kyc-agent`
**Commit assessed:** `50a06b7` (merge of `refactor/modular-architecture`)
**Date:** 2026-07-27
**Audience:** incoming backend engineer
**Method:** static read of the repository, plus a live `npm install`, `npm test`, `node --test` and `npm audit` run in a clean container. Every claim below cites a file. Where the repo cannot tell us the answer (e.g. what is actually provisioned in the hosting account), the item is marked **UNKNOWN** rather than guessed.

---

## 0. Status legend

| Mark | Meaning |
| --- | --- |
| ✅ **VERIFIED PRESENT** | Confirmed in the repo, and where possible executed |
| 🟡 **PARTIAL** | Exists but incomplete, inconsistent, or only wired on some paths |
| ❌ **MISSING** | Not in the repo; expected for a system of this kind |
| ❓ **UNKNOWN** | Cannot be determined from the repo — needs an answer from the current owner |

---

## 1. Executive summary

### 1.1 The headline: there is no Azure in this project

The brief asked for an "Azure architecture diagnostic." **This project contains no Azure resources, no Azure SDKs, no Azure configuration, and no reference to Azure of any kind.** A case-insensitive search for `azure` across every tracked file (excluding `node_modules` and `package-lock.json`) returns zero matches. The full git history contains no Azure artefact that was ever added and later removed.

The platform is built entirely on **Vercel + Neon + Upstash/Vercel KV + Vercel Blob**:

| Concern | Actual provider | Evidence |
| --- | --- | --- |
| Hosting / compute | Vercel serverless functions | `vercel.json`, `api/*.js` |
| Relational DB | Neon Postgres (serverless driver) | `@neondatabase/serverless` in `package.json`; `db/apply.js` |
| Key-value / config store | Vercel KV or Upstash Redis | `lib/storage.js` |
| Object storage | Vercel Blob | `api/upload-document.js` |
| Email | Resend | `api/invite.js` |
| LLM | Anthropic Claude API | `api/research.js` |

Section 4 gives an Azure-equivalence mapping in case a migration is the actual intent behind the request — but nothing in the codebase suggests a migration has been started or planned. **This is the single most important thing to confirm with the current owner before any work starts** (see Question Q1, §11).

### 1.2 Overall assessment

This is a **fast-moving, functionally rich prototype that has grown well past prototype scale without acquiring any of the operational scaffolding a production system needs.** The domain logic is genuinely substantial and, in places, thoughtfully designed — the append-only event store (`db/migrations/007_change_events.sql`), the deterministic dossier lifecycle machine (`dossierLifecycle/`), and the provenance model (`field_provenance`) are the work of someone thinking carefully about auditability.

That quality is not matched by the platform layer. Concretely:

- **There is no CI/CD.** No `.github/` directory has ever existed in this repo's history. Deployment is a raw `git push` to `main` with Vercel's auto-build. Nothing gates a broken commit.
- **There is no baseline database migration.** Migrations start at `002`. Ten tables that production code writes to — including `onboarding_sessions`, `clients`, `field_values` and `tenants` — have no `CREATE TABLE` anywhere in the repo. The baseline lives in a gitignored `migrate.sql` (`.gitignore:20`). **The schema cannot currently be rebuilt from source.**
- **Authentication is not fit for the data it protects.** Passwords are hashed with a hand-rolled non-cryptographic 32-bit hash (`lib/auth.js:4-15`), the session token *is the plaintext password*, and 23 of 28 API routes have no authorization check at all.
- **`/api/research` is an unauthenticated, unmetered proxy to the Anthropic API** that accepts caller-controlled `model`, `messages`, `tools` and `max_tokens` (`api/research.js:23-25, 79-94`). Anyone who finds the URL can spend the company's Anthropic budget.
- **Uploaded KYC documents are written to public blob storage** with `access: "public"` (`api/upload-document.js:52`) — passports and incorporation certificates behind guessable-suffix public URLs.
- **There is no observability.** No error tracker, no metrics, no structured logging, no health check endpoint. The only instrumentation is `console.log`.
- **`npm test` runs 5 of the 24 test files in the repo.** The other 19 use Node's built-in test runner and are invisible to CRA's Jest. Running them properly surfaces **1 genuine failing test** in the change-classification policy matrix that nobody would currently see.

None of this makes the product wrong. It makes it **undeployable to a real compliance workload in its current state.** The roadmap in §12 sequences the fixes.

### 1.3 Scale

| Metric | Value |
| --- | --- |
| Total JS/JSX LOC (excl. `node_modules`, `build`) | ~45,300 |
| API routes | 28 (`api/*.js` + `api/nium/*.js`) |
| `src/App.js` | 8,577 lines — single file |
| SQL migrations in repo | 8 (numbered 002–009) |
| Tables created by repo migrations | 16 |
| Tables written by code but **not** created by any repo migration | 10 |
| Test files | 24 (5 run by `npm test`) |
| npm vulnerabilities | 44 (2 critical, 22 high) |

---

## 2. Current backend architecture

### 2.1 Shape — ✅ VERIFIED PRESENT

A **serverless-function monolith**. There is no long-running server process, no Express app in production, no service boundary, and no message queue. Each file under `api/` becomes an independently-invoked Vercel function by filesystem convention (`vercel.json` declares `framework: "create-react-app"` and nothing more).

Business logic is split across four layers, none of which is enforced by tooling:

| Layer | Location | Purpose |
| --- | --- | --- |
| HTTP handlers | `api/*.js` (28 files) | Request parse, orchestration, response |
| Shared server libs | `lib/*.js` (9 files, 1,384 LOC) | Storage, tenancy, auth, Nium client, cache, seeds |
| Agent packages | `agents/**` | Doc search, self-source, UBO discovery, LOA validation |
| Domain state machines | `dossierLifecycle/`, `src/changeIntelligence/` | Pure logic, well-tested |

### 2.2 Text architecture diagram

```
                                  ┌──────────────────────────────┐
   BROWSER                        │  Vercel Edge / CDN           │
   ┌────────────────────┐         │  static assets from build/   │
   │ React SPA (CRA)    │◀────────│  vercel.json rewrites →      │
   │ src/App.js (8.5k)  │         │  index.html for all routes   │
   │  / customer flow   │         └──────────────────────────────┘
   │  /admin            │
   │  /super-admin      │
   └─────────┬──────────┘
             │ fetch  POST/GET /api/*
             │ Authorization: Bearer <PLAINTEXT PASSWORD>   ⚠ §7.3
             ▼
╔═══════════════════════════════════════════════════════════════════════════╗
║  VERCEL SERVERLESS FUNCTIONS  (api/ — 28 routes, no shared process)        ║
║                                                                           ║
║  ┌── config & tenancy ─────────┐  ┌── research / AI ──────────────────┐   ║
║  │ config.js         [AUTH ✓]  │  │ research.js        [NO AUTH] ⚠   │   ║
║  │ config-versions.js[AUTH ✓]  │  │ doc-search.js      [NO AUTH] ⚠   │   ║
║  │ tenants.js        [AUTH ✓]  │  │ self-source.js     [NO AUTH] ⚠   │   ║
║  │ admin-auth.js               │  │ ubo-discovery.js   [NO AUTH] ⚠   │   ║
║  │ super-admin-auth.js         │  │ kyc-lookup.js      [NO AUTH] ⚠   │   ║
║  └─────────────────────────────┘  │ benchmark.js       [NO AUTH] ⚠   │   ║
║                                   └───────────────────────────────────┘   ║
║  ┌── journey persistence ──────┐  ┌── docs / dossier ─────────────────┐   ║
║  │ submit.js         [NO AUTH] │  │ upload-document.js [NO AUTH] ⚠   │   ║
║  │ track-event.js    [NO AUTH] │  │ save-dossier.js    [NO AUTH] ⚠   │   ║
║  │ change-events.js  [NO AUTH] │  │ get-dossier.js     [NO AUTH] ⚠   │   ║
║  │ search-attempt.js [NO AUTH] │  │ dossier-reseed.js  [NO AUTH] ⚠   │   ║
║  └─────────────────────────────┘  └───────────────────────────────────┘   ║
║                                                                           ║
║  shared: lib/storage · lib/tenant · lib/auth · lib/niumClient ·           ║
║          lib/researchCache · lib/persist · lib/seedConfig                 ║
╚═══════╤═════════════════╤══════════════════╤═══════════════╤══════════════╝
        │                 │                  │               │
        ▼                 ▼                  ▼               ▼
  ┌───────────┐   ┌──────────────┐   ┌──────────────┐  ┌──────────────────┐
  │ NEON      │   │ VERCEL KV /  │   │ VERCEL BLOB  │  │ EXTERNAL APIs    │
  │ POSTGRES  │   │ UPSTASH      │   │              │  │                  │
  │           │   │ REDIS        │   │ KYC docs     │  │ • Anthropic      │
  │ journeys  │   │              │   │ access:      │  │ • Companies Hse  │
  │ events    │   │ config:{t}   │   │  "public" ⚠  │  │ • Nium V5 /eKYB  │
  │ field_    │   │ tenant-auth: │   └──────────────┘  │ • Resend (email) │
  │  provenance│  │  {t}         │                     │ • ~15 registries │
  │ entity_   │   │ tenant-      │   ┌──────────────┐  │   (web scrape)   │
  │  dossiers │   │  registry    │   │ FILESYSTEM   │  └──────────────────┘
  │ change_   │   │ invite:{tok} │   │ FALLBACK     │
  │  events   │   │              │   │ /tmp — ⚠     │
  │ …+10 with │   │ ⚠ silent     │   │ EPHEMERAL,   │
  │ NO baseline│  │  3-tier      │   │ per-instance │
  │  migration │  │  fallback    │   └──────────────┘
  └───────────┘   └──────────────┘
        ▲
        │  ⚠ NO CI/CD. Deploy = git push main → Vercel auto-build.
        │  ⚠ NO IaC. All resources provisioned by hand in dashboards.
        │  ⚠ NO monitoring, no alerting, no health check, no backups verified.
```

### 2.3 Local development parity — 🟡 PARTIAL

`src/setupProxy.js` (412 lines) re-mounts 27 of the 28 API handlers onto CRA's dev server by `require()`-ing the same files production uses. This is a genuinely good decision — dev and prod run identical handler code.

Two caveats:

- It hand-rolls a Vercel-response shim (`adapt()`, `src/setupProxy.js:44-57`) providing only `res.status` and `res.json`. Any handler using another Vercel response helper will behave differently in dev.
- The route list is **manually maintained**. Adding a file to `api/` silently works in production and silently 404s locally until someone remembers to register it. `api/amendment-documents.js` and `api/get-dossier.js` are wired; verify each new one.

---

## 3. Cloud resources and configuration

### 3.1 Azure — ❌ NOT PRESENT

No Azure resource, SDK, config file, ARM/Bicep template, or `azure-pipelines.yml` exists in this repository or in its git history.

### 3.2 Actual hosting: Vercel — 🟡 PARTIAL (config in repo; provisioning UNKNOWN)

`vercel.json` is the entire infrastructure definition:

```jsonc
{
  "framework": "create-react-app",
  "buildCommand": "npm run build",
  "outputDirectory": "build",
  "functions": {
    "api/doc-search.js":  { "maxDuration": 60 },
    "api/self-source.js": { "maxDuration": 60 }
  },
  "rewrites": [ /* SPA catch-all */ ]
}
```

| Item | Status | Note |
| --- | --- | --- |
| Function timeouts | 🟡 PARTIAL | Only 2 of 28 routes get an extended 60s budget. `api/ubo-discovery.js`, `api/benchmark.js` and `api/research.js` all run multi-step LLM work on the **default** timeout. See Risk R-07. |
| Memory / CPU sizing | ❌ MISSING | No `memory` set on any function; all run at Vercel's default. |
| Region pinning | ❌ MISSING | No `regions` key. For a UK/SG KYC product handling personal data, **function region is a data-residency question, not a latency one.** |
| Vercel plan (Hobby/Pro/Enterprise) | ❓ UNKNOWN | Determines the default timeout ceiling and whether the region/memory controls above are even available. |
| Custom domain / WAF / DDoS config | ❓ UNKNOWN | Not expressible in `vercel.json`. `api/invite.js:55` hardcodes `https://kyc-agent-deploy.vercel.app` as the invite-link fallback origin. |
| Preview-deployment protection | ❓ UNKNOWN | **Material:** without it, every PR preview is a public URL running the same unauthenticated `/api/research` proxy against production secrets. |

### 3.3 Data stores

| Store | Status | Evidence |
| --- | --- | --- |
| Neon Postgres | ✅ VERIFIED PRESENT | `@neondatabase/serverless`; `DATABASE_URL`; HTTP driver used throughout |
| Vercel KV / Upstash Redis | ✅ VERIFIED PRESENT | `lib/storage.js:26-72` — resolves `KV_REST_API_*` or `UPSTASH_REDIS_REST_*` or `REDIS_URL` |
| Vercel Blob | ✅ VERIFIED PRESENT | `api/upload-document.js` |
| Neon branching / PITR / backups | ❓ UNKNOWN | Neon offers PITR, but nothing in the repo confirms it is enabled or at what retention. **Must be verified.** |
| Blob lifecycle / retention policy | ❌ MISSING | No deletion path, no TTL, no retention job anywhere. `retention_actions` exists as a stub table (`003:206-213`) with, per its own comment, "no write paths". |

**The storage fallback chain is a production hazard.** `lib/storage.js` tries KV REST → ioredis → **local filesystem**, and the fallback is *silent*. On Vercel, the filesystem backend writes to `/tmp/config-store.json` (`lib/storage.js:75-77`) — per-instance, ephemeral, wiped on redeploy. If a KV credential is rotated or mis-set, the app does not error: it quietly starts serving per-instance tenant config, and admin publishes vanish. There is no startup assertion that a durable backend was acquired. `lib/storage.js` exports `backend()` for a "diagnostic endpoint" (comment, line 154) but **no such endpoint exists**.

### 3.4 Environment variables and secrets — 🟡 PARTIAL

24 distinct env vars are referenced across the codebase. `.env.example` documents **5**. The other 19 are undocumented.

| Variable | In `.env.example`? | Purpose |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | ✅ | Claude API |
| `ADMIN_PASSWORD` | ✅ | Nium tenant admin fallback |
| `SUPER_ADMIN_PASSWORD` | ✅ | Platform admin |
| `TENANT_ID` | ✅ | Default tenant |
| `KV_REST_API_URL` / `_TOKEN` | ✅ | KV backend |
| `DATABASE_URL` | ❌ | **Neon Postgres — the primary datastore, undocumented** |
| `COMPANIES_HOUSE_API_KEY` | ❌ | UK registry |
| `NIUM_API_KEY`, `NIUM_BASE_URL`, `NIUM_CLIENT_HASH_ID` | ❌ | Nium gateway |
| `NIUM_EKYB_API_KEY`, `_BASE_URL`, `_CLIENT_HASH_ID`, `NIUM_CAAS_BASE_URL` | ❌ | Nium eKYB |
| `RESEND_API_KEY`, `INVITE_FROM_EMAIL` | ❌ | Email |
| `REDIS_URL`, `KV_URL`, `UPSTASH_REDIS_REST_URL`, `_TOKEN` | ❌ | Alternate KV wiring |
| `BLOB_READ_WRITE_TOKEN` | ❌ | Read implicitly by `@vercel/blob` |
| `REGISTRY_{CODE}_API_KEY` / `_USERNAME` / `_PASSWORD` / `_MFA_MODE` | ❌ | **Dynamically constructed** at `agents/ubo/credentialVault.js:6-11` — the set of valid names is not enumerable from the code |

**Secrets management — ❌ MISSING.** There is no vault, no rotation policy, no per-environment separation documented, and no secret-scanning in CI (there is no CI). Secrets live as plaintext Vercel project env vars and a developer's `.env.local`. `.env.example` ships **real-looking default passwords** (`nium-admin-2026`, `nium-super-2026`); if either was ever used as-is in a deployed environment, it is public in git history.

**One good practice worth preserving:** `agents/ubo/credentialVault.js` deliberately exposes no logging or serialisation helpers, and its comment says so. Keep that discipline.

---

## 4. If the intent is an Azure migration

Nothing in the repo indicates this is planned. Recorded only so the mapping exists if Q1 (§11) confirms it:

| Current | Azure equivalent | Migration difficulty |
| --- | --- | --- |
| Vercel Functions (`api/*.js`) | Azure Functions (Node) or Container Apps | **Medium.** Handlers are `(req, res)` Express-ish; needs an adapter layer plus a replacement for the filesystem-routing convention. |
| Vercel static hosting + rewrites | Azure Static Web Apps | Low |
| Neon Postgres | Azure Database for PostgreSQL — Flexible Server | **Low-medium.** `@neondatabase/serverless` HTTP driver would be swapped for `pg`; note the driver's one-statement-per-request limit (`db/apply.js:1-8`) disappears, which would simplify migrations. |
| Vercel KV / Upstash | Azure Cache for Redis | Low — `lib/storage.js` already has an ioredis TCP path. |
| Vercel Blob | Azure Blob Storage | Low — one call site (`api/upload-document.js`). Also the natural moment to fix the public-access defect. |
| Vercel env vars | Azure Key Vault + App Config | Low, and a genuine upgrade |
| (nothing) | Application Insights | The observability gap in §9 |
| (nothing) | Bicep / Terraform | The IaC gap in §8 |

---

## 5. Database and schema

### 5.1 The critical gap: no baseline migration — ❌ MISSING

`db/migrations/` contains **002 through 009**. There is no `001`. `.gitignore:20` reveals why:

```
# Benchmark scratch output + local DB migration (applied directly to Neon)
migrate.sql
```

The baseline was applied by hand to Neon and deliberately excluded from source control. `api/submit.js:8` still refers to it — *"column names below are aligned to the ACTUAL live schema (db/migrate.sql + migration 002)"* — a file no one can read.

**Consequence:** the database cannot be recreated from this repository. There is no way to stand up a new environment, no way to run integration tests against a real schema, and no way to review a schema change against a known baseline. `CODEX_CONTEXT.md` claims "Neon Postgres (22 tables)"; the repo can account for 16.

Tables written by production code with **no `CREATE TABLE` in the repo**:

`tenants` · `clients` · `onboarding_sessions` · `field_values` · `evidence_items` · `documents` · `session_timeline` · `benchmark_runs` · `benchmark_entities` · `ownership_type_library`

Three migrations (`002`, `004`) `ALTER` tables from this invisible set — they will fail on any fresh database.

### 5.2 Schema that *is* in the repo — ✅ VERIFIED PRESENT

Three generations of design coexist, by explicit decision (`003` header: *"reconcile, don't greenfield"*):

**Legacy session spine** (invisible baseline) — `clients` → `onboarding_sessions` → `field_values` / `evidence_items` / `session_timeline`.

**Journey model** (`003_persistence_now.sql`, 218 lines) — the current intended spine:

| Table | Role |
| --- | --- |
| `journeys` | Spine. Bridges to legacy via nullable `session_id` + unique index |
| `events` | Append-only actor/step/payload log |
| `field_provenance` | Per-field lineage: layer (L1–L4), source tier, `agent_value` never overwritten, `customer_action` |
| `completion_choice`, `declaration` | Method choice; consent + IP/UA/geo |
| `api_usage` + `pricing` | Per-call token/cost against versioned pricing — good practice |
| `policy_decisions`, `search_results` | Reproducible rule outputs; raw search substrate |
| `screening_results`, `risk_ratings`, `retention_actions` | 🟡 **Stubs. DDL only, explicitly no write paths.** |

**Domain extensions** — `entity_dossiers` (005, +008), `research_cache` (006), `change_events` (007), `ubo_investigations` (009).

`007_change_events.sql` is the strongest piece of schema design here: strictly append-only, corrections modelled as new rows with a `supersedes` self-reference, current value derived at read time, partial indexes on `decided = false` and `escalation = true`. Its column vocabulary is mirrored in `src/changeIntelligence/events/schema.js` and the file says to keep them in sync — **nothing enforces that**, so it is a live drift risk.

### 5.3 Migration tooling — 🟡 PARTIAL

Two runners, because the Neon HTTP driver executes one statement per request:

- `db/migrate.js` — one statement per file; **hardcodes a list of two migrations** (`002`, `004`) and ignores the rest.
- `db/apply.js` — splits on `;` for multi-statement files; **run manually, one file at a time**.

| Missing capability | Impact |
| --- | --- |
| Migration state table | ❌ Nothing records which migrations have been applied to which environment |
| Automatic ordered application | ❌ Each file is applied by hand, from a comment in its own header |
| Down/rollback | ❌ None |
| CI enforcement | ❌ A deploy can ship code requiring a column that was never added |

`db/apply.js:12-14` documents its own parser limits honestly: no semicolons inside string literals, no dollar-quoted function bodies. That holds for today's plain DDL and will break the first time someone writes a trigger or `DO $$` block.

### 5.4 Data protection — ❌ MISSING

This database holds directors' names, addresses, dates of birth, beneficial-ownership structures, IP addresses and consent records.

| Control | Status |
| --- | --- |
| Encryption at rest | ❓ UNKNOWN (Neon default assumed; unverified) |
| Column-level encryption for PII | ❌ MISSING |
| Row-level security / tenant isolation in DB | ❌ MISSING — isolation is application-level only, via a query parameter |
| Retention / erasure implementation | ❌ MISSING — `retention_actions` is a stub |
| Backup schedule + tested restore | ❓ UNKNOWN — **no evidence either exists** |
| Audit log of DB access | ❌ MISSING |

---

## 6. APIs and integrations

### 6.1 Internal API surface — ✅ VERIFIED PRESENT (28 routes)

No OpenAPI spec, no shared request/response envelope, no versioning, and no shared validation. Each handler re-implements body parsing — `readBody()` is copy-pasted verbatim into at least four files (`api/config.js`, `api/admin-auth.js`, `api/super-admin-auth.js`, `api/tenants.js`).

**A deliberate and load-bearing pattern:** several write paths are *designed* never to fail the user. `api/track-event.js:32` — "Always return 200 — event tracking must never block the user"; `api/submit.js:5` — "any DB failure returns HTTP 200 with a warning"; `api/get-dossier.js` returns `200 {success:false}` on error. This is a reasonable UX choice **and it means silent data loss is invisible from the outside.** With no error tracking (§9), a Neon outage during a submission window would drop customer submissions with zero alerting. This is the single highest-value argument for adding an error tracker.

### 6.2 External integrations

| Integration | Status | Evidence & notes |
| --- | --- | --- |
| **Anthropic Claude** | ✅ PRESENT | `api/research.js`. Model default `claude-sonnet-4-5`. **Caller-overridable** — see §7.4. |
| **Companies House** | 🟡 PARTIAL | `api/company-search.js` (search, HTTP Basic), `agents/registries/companiesHouseOfficers.js` (officers). `CODEX_CONTEXT.md` records the officers integration as **built but non-functional** — the configured key is a Streaming key and returns 401. |
| **Nium V5 gateway + eKYB** | 🟡 PARTIAL | `lib/niumClient.js`. eKYB points at **preprod** (`api.preprod.nium.com`, line 30) because "no prod API key + real client hash have been issued". Prod host is a comment. |
| **Resend** (email) | 🟡 PARTIAL | `api/invite.js`. Degrades to `{sent:false, simulated:true}` without a key — good. Default sender is Resend's shared test domain. |
| **Vercel Blob** | ✅ PRESENT | Public-access defect — §7.5 |
| **~15 company registries** | 🟡 PARTIAL | `agents/ubo/registryConfig.js`, `agents/registryUrlBuilder.js` — ASIC, KVK, SEC, MAS, Receita, gsxt, handelsregister, etc. Reached by **Playwright browser automation** (`agents/screenshotHelper.js`, `agents/selfSourceAgent.js:61`). |

### 6.3 Playwright in serverless — 🟡 PARTIAL / high risk

`playwright` is a **production** dependency (`package.json`), and `agents/screenshotHelper.js` launches a browser to screenshot registry pages as compliance evidence.

Running a full Playwright browser inside a Vercel serverless function is at best fragile: the browser binaries are not part of the deployment bundle by default, cold-start cost is severe, and the work must complete inside the function timeout. Both call sites `try/catch` the `require` and warn on failure (`agents/screenshotHelper.js:20-25`), so **the likely production behaviour is that screenshot evidence silently never gets captured.** Whether this path is exercised in production is ❓ UNKNOWN and should be verified early — if screenshots are a compliance requirement, this needs a dedicated container/worker, not a serverless function.

### 6.4 Resilience — ❌ MISSING

No retry logic, no circuit breaker, no timeout on outbound `fetch` calls, no bulkheading. A slow Companies House response consumes the whole function budget. `api/research.js` has no client-side timeout on the Anthropic call.

---

## 7. Authentication and security

**This is the weakest area of the system and the one I would fix first.**

### 7.1 Authorization coverage — ❌ MISSING on 23 of 28 routes

Only 5 routes check authorization: `config.js`, `config-versions.js`, `tenants.js`, `admin-auth.js`, `super-admin-auth.js`.

Unauthenticated, callable by anyone who knows the URL:

`research` · `submit` · `save-dossier` · `get-dossier` · `dossier-reseed` · `upload-document` · `doc-search` · `self-source` · `ubo-discovery` · `ubo-recalculate` · `kyc-lookup` · `benchmark` · `track-event` · `search-attempt` · `change-events` · `change-intelligence-metrics` · `amendment-documents` · `document-requirements` · `company-search` · `nium/constants` · `nium/public-details` · `nium/exhaustive-details`

### 7.2 Password hashing — ❌ BROKEN

`lib/auth.js:4-15` (mirrored in `src/utils/auth.js`, which ships to the browser):

```js
const SALT = "nium-kyc-2026";
function hashPassword(password) {
  let hash = 0;
  for (…) { hash = (hash << 5) - hash + char; hash = hash & hash; }
  return Math.abs(hash).toString(36) + str.length.toString(36);
}
```

A 32-bit non-cryptographic string hash with a single hardcoded global salt, no work factor, and no per-user salt. The output space is ~2³¹ — **brute-forceable in seconds**, and collisions are trivially findable, meaning a *wrong* password can authenticate. The salt is a public string in the repo. Because `src/utils/auth.js` is bundled into the client, the exact algorithm is published to every visitor.

The file's own comment concedes the point: *"Not cryptographically secure… Replace with bcrypt / argon2 if you ever expose tenant passwords externally."* Tenant admin URLs are internet-facing, so that condition is already met.

### 7.3 Session model — ❌ BROKEN

On successful login, both auth endpoints return **the plaintext password as the bearer token**:

- `api/admin-auth.js:127` — `return res.status(200).json({ success: true, token: password, … })`
- `api/super-admin-auth.js:44` — `return res.status(200).json({ success: true, token: expected })` — returns the value of `SUPER_ADMIN_PASSWORD` to the client

Consequences: the token never expires, cannot be revoked without changing the password, is stored client-side, and travels on every `/api/config` request. `api/tenants.js:50` compares the super-admin token with `!==` — a non-constant-time comparison. `api/super-admin-auth.js:43` does the same on the password itself.

### 7.4 `/api/research` is an open LLM proxy — ❌ CRITICAL

`api/research.js:23-25` destructures `model`, `tools`, `max_tokens` and `messages` from the request body, and lines 79-94 forward them to `https://api.anthropic.com/v1/messages` with the server's `ANTHROPIC_API_KEY`. There is no authentication, no rate limit (a repo-wide search for rate limiting returns nothing), no origin restriction, and `Access-Control-Allow-Origin: *`.

Anyone who discovers the endpoint gets an unmetered Claude API key proxy at Nium's expense, with arbitrary prompts, arbitrary model selection and up to `max_tokens` of their choosing. The comment on line 6 — *"Allow CORS from any origin (safe because this only accepts POST with specific body)"* — is not correct; the body shape is fully attacker-controlled.

### 7.5 KYC documents in public storage — ❌ CRITICAL

`api/upload-document.js:52-55`:

```js
const blob = await put(filename, fileBuffer, { access: "public", addRandomSuffix: true });
```

The endpoint has no authentication, no file-type allowlist, no size limit, and no virus scan. It accepts any file from anyone and returns a **publicly readable URL**. The files are passports, proofs of address and incorporation certificates. `addRandomSuffix` is obscurity, not access control — and every URL is then persisted in the database and emailed around, so it leaks through many channels.

### 7.6 Other findings

| Finding | Severity | Evidence |
| --- | --- | --- |
| Hardcoded pre-boarding password `"ARCH"` in client bundle | High | `src/App.js:208` |
| Default passwords committed in `.env.example` | Medium | `nium-admin-2026`, `nium-super-2026` |
| `ADMIN_PASSWORD` shared across all tenants (Nium fallback path) | Medium | `api/config.js:18-20` (acknowledged in comment) |
| Tenant chosen by unauthenticated query param | High | `lib/tenant.js:29-52` — `?tenant=` with no proof of entitlement |
| Dossier IDOR: `/api/get-dossier?id=&tenant=` unauthenticated | High | `api/get-dossier.js` — full PII dossier by ID |
| Invite tokens: 18 random bytes, 30-day TTL, single-use not enforced | Medium | `api/invite.js:24,49` |
| No CSRF protection | Medium | Bearer-token model mitigates partly; no `SameSite` strategy documented |
| No security headers (CSP, HSTS, X-Frame-Options) | Medium | Absent from `vercel.json` |
| 44 npm vulnerabilities (2 critical, 22 high) | High | `npm audit`. Critical: `tar` (arbitrary file write via symlink escape), `shell-quote` (injection), `websocket-driver`. `xlsx` has **no fix available** — prototype pollution + ReDoS, and it is a direct production dependency used by `src/admin/utils/schemaExcel.js`. |

---

## 8. Deployment and CI/CD

### 8.1 CI/CD — ❌ MISSING (entirely)

There is no `.github/` directory, and `git log --all --diff-filter=A` confirms **one has never existed** in this repository's 142-commit history. No GitHub Actions, no GitLab CI, no Jenkins, no `azure-pipelines.yml`.

The deployment process, per `AGENTS.md:14`, is: *"Deployment is handled by Vercel on push to `main`."*

Nothing runs before production:

| Gate | Status |
| --- | --- |
| Tests on PR | ❌ MISSING |
| Lint on PR | ❌ MISSING (an ESLint config exists in `package.json` but is only invoked by `react-scripts` during dev/build) |
| Type checking | ❌ N/A — plain JS, no TypeScript, no JSDoc checking |
| Build verification before merge | ❌ MISSING |
| Migration check | ❌ MISSING — code can ship ahead of schema |
| Dependency / secret scanning | ❌ MISSING |
| Staging environment | ❓ UNKNOWN — no config; Vercel preview deploys presumably serve this role |
| Rollback procedure | ❓ UNKNOWN — Vercel instant-rollback exists but is undocumented here, **and does not roll back applied migrations** |

### 8.2 IaC — ❌ MISSING

No Terraform, Bicep, ARM, Pulumi, CloudFormation, Dockerfile or docker-compose. Every resource — the Neon project, the KV store, the Blob store, all 24 env vars, domains — was created by hand in a dashboard and exists in exactly one place. **There is no way to recreate this environment, and no record of what it currently is.** Combined with the missing baseline migration (§5.1), a lost Vercel or Neon account is an unrecoverable event.

### 8.3 Testing — 🟡 PARTIAL, and misleading

The repo contains 24 test files. **`npm test` runs 5.**

CRA's Jest is rooted at `src/`, so it collects only `src/**/*.test.{js,jsx}`. Verified by running it:

```
Test Suites: 5 passed, 5 total
Tests:       36 passed, 36 total
```

The other 19 files use Node's built-in test runner (`require('node:test')`) and are invisible to Jest — running them under Jest fails with `ENOENT: no such file or directory, open 'node:test'`. They also do not match `node --test`'s default discovery patterns (`*.nodetest.js` is not a recognised suffix, and the `dossierLifecycle/` and `agents/validation/` suites are outside any auto-discovered path), so **no command in `package.json` executes them at all.**

Running all 19 explicitly:

```
# tests 140   # pass 139   # fail 1
```

**One genuine failure**, in `src/changeIntelligence/tests/classifyChange.completeness.nodetest.js:160` — *"no newly-discovered gaps beyond the expected-known list"*. The policy matrix has uncovered `director` combinations across `add`/`remove` × `ai_correction`/`null` × `reflected`/`not_reflected` × `structured_registry` × `GB`/`SG`. That test exists precisely to catch policy-coverage regressions, and it is currently red and unseen.

No integration tests against a real database, no API contract tests, no E2E tests, no coverage measurement.

The root-level `test-*.js` files (`test-self-source.js`, `test-ubo-framework.js`, etc.) are **manual scripts requiring live API credentials**, not automated tests.

---

## 9. Observability

**❌ MISSING — comprehensively.** A repo-wide search for `sentry|datadog|opentelemetry|winston|pino|app-insights|logtail|newrelic` returns zero matches.

| Capability | Status | Note |
| --- | --- | --- |
| Error tracking | ❌ MISSING | No Sentry or equivalent. Errors go to `console.error` → Vercel logs → gone after the retention window. |
| Structured logging | ❌ MISSING | Free-text `console.log` with emoji prefixes (`api/track-event.js:57`). Not queryable. |
| Metrics / dashboards | ❌ MISSING | No latency, error-rate or throughput metrics |
| Distributed tracing | ❌ MISSING | `lib/niumClient.js:69` generates an `X_REQUEST_ID` per Nium call — the only correlation ID anywhere, and it is not propagated inbound or logged |
| Alerting | ❌ MISSING | Nothing pages anyone |
| Health check endpoint | ❌ MISSING | No `/api/health`. `lib/storage.js:154` exports `backend()` "used by the diagnostic endpoint" — **the endpoint does not exist** |
| Uptime monitoring | ❓ UNKNOWN | Nothing in repo |
| Log retention | ❓ UNKNOWN | Vercel plan-dependent |

**Partial credit where due — the application-level telemetry is unusually good.** The system captures things most products never do: per-call token usage and cost against versioned pricing (`api_usage` + `pricing`), an append-only event log (`events`), a user-journey timeline (`session_timeline` via `api/track-event.js`), and full field-level provenance. There is even a business dashboard (`api/change-intelligence-metrics.js`, `src/changeIntelligence/dashboardMetrics.js`).

The gap is precisely the *operational* half. **You can answer "what did this customer's journey cost?" but not "is the service up?"** — and because so many write paths swallow failures and return 200 (§6.1), you also cannot answer "did we lose any submissions today?"

---

## 10. Risks and gaps

Ordered by expected severity. Likelihood is my judgement; the underlying facts are cited.

| ID | Risk | Sev | Evidence |
| --- | --- | --- | --- |
| **R-01** | **KYC documents publicly accessible.** Passports/proofs of address in public blob storage, no auth on upload. Data-protection incident and a regulatory reportable event. | 🔴 Critical | `api/upload-document.js:52` |
| **R-02** | **Open LLM proxy.** Unauthenticated, unmetered, caller-controls model and prompt. Unbounded cost; reputational exposure if abused for arbitrary generation. | 🔴 Critical | `api/research.js:23-25,79-94` |
| **R-03** | **Database cannot be rebuilt.** No baseline migration; 10 production tables have no DDL in source. New environments and DR are impossible. | 🔴 Critical | `db/migrations/` starts at 002; `.gitignore:20` |
| **R-04** | **Broken password hashing + plaintext-password bearer tokens.** Admin and super-admin access is effectively brute-forceable; tokens never expire. | 🔴 Critical | `lib/auth.js:4-15`; `api/admin-auth.js:127`; `api/super-admin-auth.js:44` |
| **R-05** | **PII readable without authentication.** Dossiers, change events and submissions exposed via unauthenticated routes; tenant selected by query param. | 🔴 Critical | §7.1; `api/get-dossier.js`; `lib/tenant.js:29-52` |
| **R-06** | **No CI/CD.** Nothing prevents a broken or insecure commit reaching production. | 🟠 High | No `.github/` in history |
| **R-07** | **Silent data loss.** Write paths return 200 on failure, and no error tracking exists to notice. | 🟠 High | `api/submit.js:5`; `api/track-event.js:32`; §9 |
| **R-08** | **Silent storage-backend downgrade.** A KV credential problem degrades to ephemeral `/tmp` with no error — tenant config loss. | 🟠 High | `lib/storage.js:26-77` |
| **R-09** | **No backups verified, no tested restore, no retention/erasure implementation.** GDPR erasure cannot currently be executed. | 🟠 High | `retention_actions` stub, `003:206-213` |
| **R-10** | **Test suite gives false assurance.** `npm test` passes while 19 files never run and 1 real failure hides. | 🟠 High | §8.3 |
| **R-11** | **44 npm vulnerabilities.** `xlsx` (direct prod dep) has no fix available. | 🟠 High | `npm audit` |
| **R-12** | **No IaC.** Environment is unreproducible and undocumented; bus factor of one. | 🟠 High | §8.2 |
| **R-13** | **Function timeouts unset on long-running AI routes.** `ubo-discovery`, `research`, `benchmark` on default budget. | 🟡 Medium | `vercel.json` |
| **R-14** | **Playwright in serverless likely non-functional**, failing silently — compliance screenshots may never be captured. | 🟡 Medium | `agents/screenshotHelper.js:20-25` |
| **R-15** | **Key integrations not production-ready.** Companies House officers returns 401 (wrong key type); Nium eKYB points at preprod. | 🟡 Medium | `CODEX_CONTEXT.md`; `lib/niumClient.js:30` |
| **R-16** | **No data-residency control.** No function-region pinning for a UK/SG regulated product. | 🟡 Medium | `vercel.json` |
| **R-17** | **Three coexisting schema generations** (legacy sessions / journey model / domain tables) with bridge columns and duplicated concepts. | 🟡 Medium | `003` header comments |
| **R-18** | **Manual schema-to-code sync.** `007` DDL and `src/changeIntelligence/events/schema.js` are kept in sync by comment only. | 🟡 Medium | `007:14-15` |
| **R-19** | **Migration runner is fragile and partly bypassed.** `db/migrate.js` hardcodes two files; no state table; no rollback. | 🟡 Medium | `db/migrate.js:17-20` |
| **R-20** | **`src/App.js` is 8,577 lines.** Refactoring has begun but the core remains a single-file monolith. | 🟡 Medium | `src/App.js` |
| **R-21** | **No rate limiting anywhere**, on any endpoint. | 🟡 Medium | Repo-wide search |
| **R-22** | **Hardcoded password `"ARCH"` in the client bundle.** | 🟡 Medium | `src/App.js:208` |
| **R-23** | **19 of 24 env vars undocumented**, including `DATABASE_URL`. `REGISTRY_*` names are dynamically constructed and not enumerable. | 🟡 Medium | `.env.example`; `agents/ubo/credentialVault.js:6-11` |
| **R-24** | **No API contract.** No OpenAPI, no versioning, no shared validation; `readBody` duplicated across files. | 🟢 Low | §6.1 |

---

## 11. Questions for the incoming backend engineer

Ordered so the answers unblock the most work. Q1–Q5 should be answered before any code is written.

**Strategic**

1. **Where does Azure come from?** Nothing in this repo touches Azure. Is there (a) a planned migration off Vercel, (b) a separate Azure-hosted system not in this repository, or (c) a misunderstanding of the current stack? Every downstream priority depends on this answer.
2. Is this system live with real customer data today, or still a demo? `CODEX_CONTEXT.md` cites a live URL and `PRODUCTION_READINESS.md` a Confluence register — but the pre-boarding gate is a hardcoded password and eKYB points at preprod. **What is the actual production status, and is real customer PII in that Neon database right now?** This determines whether §7 findings are urgent remediation or pre-launch cleanup.
3. What is the target go-live date and expected volume (journeys/day)? Sizing, rate limits and the serverless-vs-container decision follow from this.
4. Which regulator(s) and which data-residency obligations apply? This drives region pinning, retention, and the encryption decision.
5. Has a security review or pen test been done? Are any of §7's findings already known and accepted?

**Infrastructure & data**

6. **Where is the baseline schema?** Is there a `migrate.sql` or a Neon snapshot anyone still has? Without it, step one is reverse-engineering DDL from a live database. Which environment is the source of truth?
7. What Neon plan and backup/PITR configuration are in place, and **has a restore ever been tested?**
8. Which Vercel plan, and are preview deployments password-protected? (An unprotected preview exposes `/api/research` with production secrets.)
9. Where is the definitive list of production environment variables? Which `REGISTRY_*` credentials are actually provisioned?
10. Is the KV store Vercel KV or Upstash, and has anyone confirmed production is not silently on the `/tmp` filesystem fallback?

**Application**

11. Are the `screening_results`, `risk_ratings` and `retention_actions` stubs scheduled, or aspirational? Retention in particular is a legal obligation, not a feature.
12. Is the Playwright screenshot path exercised in production, and is that evidence a compliance requirement? If yes, it needs somewhere other than a serverless function to run.
13. Is `journey_state` (save-and-resume, per `CODEX_CONTEXT.md`, "planned week of 28 Jun 2026") still wanted? It is not built.
14. Has the correct Companies House **REST/Public Data** key been requested, and is there an owner for obtaining production Nium eKYB credentials?
15. What is the intended end state for the three coexisting schema generations — consolidate onto the journey model, or maintain the bridge indefinitely?
16. Is `xlsx` (unpatchable, prototype pollution + ReDoS) replaceable? `exceljs` or `sheetjs-style` are candidates.

---

## 12. Recommended next steps — prioritised roadmap

Sequenced by risk-reduction per unit of effort. Estimates assume one engineer familiar with the stack.

### Phase 0 — Stop the bleeding (Week 1)

Do these before anything else. If §11 Q2 confirms real customer data is live, treat Phase 0 as an incident.

| # | Action | Fixes | Effort |
| --- | --- | --- | --- |
| 0.1 | Switch blob uploads to private access; serve documents via short-lived signed URLs through an authenticated route. Audit and revoke everything already uploaded publicly. | R-01 | 1–2 d |
| 0.2 | Put authentication + a rate limit in front of `/api/research`; remove caller control of `model` and `tools`; cap `max_tokens` server-side. Check Anthropic billing for anomalous usage. | R-02 | 1 d |
| 0.3 | Add auth middleware and apply it to all 23 unprotected routes. Deny-by-default: a new file in `api/` should be closed until opened. | R-05 | 2–3 d |
| 0.4 | Replace `lib/auth.js` with `bcrypt` or `argon2`; issue short-lived signed session tokens instead of returning the password; force a password reset for every tenant. | R-04 | 2 d |
| 0.5 | Remove the hardcoded `"ARCH"` password and the default passwords in `.env.example`; rotate every credential that has ever been in the repo. | R-22 | 0.5 d |
| 0.6 | Lock CORS to known origins; drop `Access-Control-Allow-Origin: *`. | §7.4 | 0.5 d |

### Phase 1 — Make it reproducible (Weeks 2–3)

| # | Action | Fixes | Effort |
| --- | --- | --- | --- |
| 1.1 | **Dump the live Neon schema and commit it as `001_baseline.sql`.** Verify migrations 002–009 apply cleanly onto it in a fresh database. Nothing else in this phase is safe until this is done. | R-03 | 1–2 d |
| 1.2 | Adopt a real migration tool with a state table and ordered application (`node-pg-migrate`, Drizzle, or Flyway). Retire `db/migrate.js`'s hardcoded list. | R-19 | 2 d |
| 1.3 | Add GitHub Actions CI: install, lint, build, **and a single `npm test` that runs all 24 test files** (add a `test:node` script for the `node --test` suites and have `npm test` invoke both). Require green on PR. | R-06, R-10 | 2 d |
| 1.4 | Fix the failing `classifyChange.completeness` test — close the uncovered `director` policy combinations or explicitly accept them in the expected-known list. | §8.3 | 1 d |
| 1.5 | Confirm and document Neon backup/PITR settings; **perform one restore drill** and write down the runbook. | R-09 | 1 d |
| 1.6 | Document all 24 env vars in `.env.example`, including `DATABASE_URL` and the `REGISTRY_*` pattern. | R-23 | 0.5 d |

### Phase 2 — Make it observable (Weeks 4–5)

| # | Action | Fixes | Effort |
| --- | --- | --- | --- |
| 2.1 | Add Sentry (or equivalent) to every API route. **Critically: report to it from the `catch` blocks that currently return 200.** This is what makes silent data loss visible. | R-07 | 2 d |
| 2.2 | Add `/api/health` covering Neon, KV (using the existing `storage.backend()`), and Blob. Wire uptime monitoring to it. | §9 | 1 d |
| 2.3 | **Make the storage fallback loud**: fail startup, or at minimum alert, when a durable backend was expected and the filesystem was selected. | R-08 | 0.5 d |
| 2.4 | Structured JSON logging with a request ID propagated inbound → outbound (extend the existing `X_REQUEST_ID`). | §9 | 2 d |
| 2.5 | Alerts on error rate, submission-failure count, and Anthropic spend. | §9 | 1 d |

### Phase 3 — Make it maintainable (Weeks 6–9)

| # | Action | Fixes | Effort |
| --- | --- | --- | --- |
| 3.1 | `npm audit fix`; replace `xlsx`; add Dependabot + secret scanning to CI. | R-11 | 2–3 d |
| 3.2 | Codify infrastructure — Terraform for Neon/Upstash/Vercel where providers allow, and a written runbook for the rest. Remove the bus factor. | R-12 | 3–5 d |
| 3.3 | Set `maxDuration` and `memory` per function; pin regions for data residency. | R-13, R-16 | 1 d |
| 3.4 | Extract shared middleware: `readBody`, auth, tenant resolution, error envelope, validation. Delete the four copies of `readBody`. | R-24 | 3 d |
| 3.5 | Move Playwright registry automation out of serverless into a dedicated worker/container — or formally decide screenshots are not required and delete the path. | R-14 | 3–5 d |
| 3.6 | Implement retention + erasure against `retention_actions`. Legal obligation, currently a stub. | R-09 | 3–5 d |
| 3.7 | Generate the `change_events` DDL and `src/changeIntelligence/events/schema.js` from one source, or add a CI check that they agree. | R-18 | 1 d |
| 3.8 | Add integration tests against a real Postgres (Testcontainers or a Neon branch per PR) covering `submit`, `save-dossier`, `get-dossier`. | §8.3 | 3–5 d |

### Phase 4 — Structural (Weeks 10+)

| # | Action | Fixes |
| --- | --- | --- |
| 4.1 | Continue the `src/App.js` decomposition already begun in `src/workflows/` and `src/components/`. | R-20 |
| 4.2 | Consolidate the three schema generations onto the journey model; retire the legacy session spine once reads are migrated. | R-17 |
| 4.3 | Publish an OpenAPI spec; add request validation (Zod) at every boundary. | R-24 |
| 4.4 | Enforce tenant isolation in the database (RLS), not only in application code. | R-05 |
| 4.5 | Resolve integration blockers: correct Companies House key, production Nium eKYB credentials. | R-15 |
| 4.6 | Evaluate whether long-running AI orchestration belongs in serverless at all, or in a queue + worker architecture. | R-13 |

---

## Appendix A — Evidence index

| Claim | File |
| --- | --- |
| No Azure anywhere | repo-wide case-insensitive search, 0 matches |
| No CI ever existed | `git log --all --diff-filter=A --name-only` |
| Missing baseline migration | `db/migrations/` starts at 002; `.gitignore:20`; `api/submit.js:8` |
| Broken password hash | `lib/auth.js:4-15`; `src/utils/auth.js:5-21` |
| Password returned as token | `api/admin-auth.js:127`; `api/super-admin-auth.js:44` |
| Open LLM proxy | `api/research.js:6,23-25,79-94` |
| Public blob uploads | `api/upload-document.js:52` |
| Silent storage fallback | `lib/storage.js:26-77,154` |
| Best-effort 200 on failure | `api/submit.js:5`; `api/track-event.js:32`; `api/get-dossier.js` |
| Test suite gap | `npm test` → 5 suites/36 tests; `node --test` over 19 files → 140 tests, 1 fail |
| Failing test | `src/changeIntelligence/tests/classifyChange.completeness.nodetest.js:160` |
| Dependency vulnerabilities | `npm audit` → 44 (2 critical, 22 high) |
| Preprod Nium endpoint | `lib/niumClient.js:30` |
| Companies House 401 | `CODEX_CONTEXT.md` §"WHAT IS CURRENTLY BROKEN" |
| Hardcoded pre-boarding password | `src/App.js:208` |
| Stub tables, no write paths | `db/migrations/003_persistence_now.sql:196-213` |

## Appendix B — Commands used

```bash
# Structure & search
find . -not -path './node_modules/*' -not -path './.git/*' -type f
grep -ri "azure" . --exclude-dir=node_modules --exclude=package-lock.json   # 0 matches
git log --all --diff-filter=A --name-only --pretty=format:                  # no CI ever

# Verification (clean container)
npm install --no-audit --no-fund
CI=true npx react-scripts test --watchAll=false        # 5 suites, 36 tests, all pass
node --test $(find . \( -name "*.nodetest.js" \
  -o -path "./dossierLifecycle/*" -name "*.test.js" \
  -o -path "./agents/validation/*" -name "*.test.js" \) \
  -not -path "./node_modules/*")                       # 140 tests, 139 pass, 1 FAIL
npm audit                                              # 44 vulns (2 critical, 22 high)
```
