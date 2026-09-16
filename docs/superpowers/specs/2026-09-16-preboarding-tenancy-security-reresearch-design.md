# Design — Tenant-scoped pre-boarding, dossier security, AI-endpoint hardening, customer self-serve re-research

**Date:** 2026-09-16
**Status:** approved section-by-section by the product owner (2026-09-15 / 2026-09-16)
**Supersedes:** the Phase-2 "Option A" sketch in `context.md` §17 (kept, extended)
**Related:** `docs/preboarding-audit-2026-09-13.md`, `docs/BACKLOG.md` (DEP-2, PLAT-6, PLAT-7, PREB-1, PREB-2, PREB-3, RERES-1, BRAND-1)

---

## 1. Goal

Make the pre-boarding → invite → customer-onboarding path correct per tenant, authenticated, cost-safe, and able to re-research when the customer corrects the analyst's data — without losing the audit trail.

Five parts, built in this order. Each is independently shippable and independently testable.

| # | Part | Why it comes here |
|---|---|---|
| 5 | Tenancy, links and default settings | Everything downstream depends on the tenant being resolved and verified correctly |
| 1 | Credentials and endpoint locks | The customer token is the key the re-research flow uses |
| 2 | AI-endpoint hardening | Research must be server-built before re-research multiplies the call volume |
| 3 | Customer correction → re-research | The product change the owner actually asked for |
| 4 | Pre-boarding polish | Small leftovers from the 2026-09-13 audit |

**Non-goals (explicitly backlogged):** per-tenant analyst passwords (PREB-3), analyst dashboard + notifications (PREB-1), revoke UI (PREB-2), per-tenant daily AI spend cap (PLAT-6), keying fresh (no-link) applications (PLAT-7), internal brand-name cleanup (BRAND-1), "re-search on every corrected fact" (RERES-1).

---

## 2. Global constraints

- **CommonJS in `api/` and `lib/`** (`module.exports` / `require`), so `src/setupProxy.js` can mount the same handlers for `npm start`. `api/research.js` is currently ESM and is converted.
- **Every new/changed handler is registered in `src/setupProxy.js`.** No hand-copied handler bodies there (the existing research copy is deleted).
- **Tests:** backend → `*.nodetest.js` with injected fakes (`__setDeps`), run by `npm run test:node`; frontend → jest render tests asserting real DOM behaviour. Every new node test file must be reachable from the `test:node` glob.
- **Migrations** are additive and idempotent (`IF NOT EXISTS`), numbered from **026**, applied with `node db/apply.js db/migrations/<file>.sql`.
- **No new runtime dependency** unless a task states one and justifies it.
- **Secrets** stay server-side; new env vars are documented in `.env.example` with placeholder values.
- **Constant-time comparison** (`crypto.timingSafeEqual`) for every secret/signature comparison.
- **Tenant resolution stays 3-strict**: no `"nium"` fallback anywhere, client or server.
- **Inline styles only** in React; match the surrounding file's conventions.
- **Refs, not state, for gap/stakeholder form values** (`gapRef`, `stakeholdersRef`) — do not lift to `useState`.

---

## 3. Part 5 — Tenancy, links and default settings

### 3.1 Problem (measured, not assumed)

- `?preboarding=1` is global: read in `src/index.js:12` (title only) and `src/App.js:4699` + `:771` (routing). Nothing ties it to a tenant.
- `PREBOARDING_PASSWORD = "ARCH"` (`src/App.js:287`) is a client constant; `PreboardingGate.jsx:37` compares in-browser.
- `GET /api/config?tenant=<anything>` **auto-seeds a blank config** for any sanitised string (`api/config.js:58-71`) — a typo creates a tenant. `api/save-dossier.js:65-69` then creates the Postgres `tenants` row.
- `isActive` (tenant registry) is read only by the super-admin UI; no endpoint enforces it.
- The draft key is global: `kyc_draft_v1` (`src/utils/submissionDraft.js:5`); the draft stores neither `tenantId` nor `agentType`, so a tenant-A draft is offered under tenant B and restores its `dossierId` (`src/App.js:887`).
- **Verified false lead:** no code path injects `tenant=nium` into another tenant's invite link. `preview_tenant_id` and `sessionStorage.tenant_id` are written and never read; `AdminDashboard.jsx:57` default prop never applies; config `_tenantId` is not used for links.
- **Real Nium leaks to customers:** invite email subject/body/sign-off/sender (`api/invite.js:151-168`) and its on-screen preview (`InviteScreen.jsx:82-93,245`); manual-form fallback `https://app.nium.com` (`src/constants/appConstants.js:59` via `src/App.js:4306`, and `lib/seedConfig.js:95` copied into "Nium defaults" tenants); Nium wording in `src/components/Step2DynamicForm.jsx:168,187,216,375`; FI schema labels (`lib/seedSchemas.js:192,246`, mirrored `src/pipeline.js:363,403`); offline fallback company name (`src/config/localDefaultConfig.js:18`).
- **Broken Nium links:** `AdminDashboard.jsx:182` and `StepPublish.jsx:97` omit `&tenant=` for nium; `TenantCard.jsx:13,15` uses `/admin` and `/` for nium/`isInternal`; `StepPublish.jsx:116` "View live flow" opens `/` for everyone. All land on `NoTenantLanding`.
- **Server laxity:** `lib/tenant.js:53` falls back to `TENANT_ID` (set to `nium` in `.env.local`), so a bare `/admin` silently acts on Nium.
- **Defaults:** `lib/seedConfig.js#buildDefaultConfig` is the only "default settings", reachable only via super-admin "copy Nium defaults" at creation (`api/tenants.js:170-178`, static snapshot, not live Nium). Drifting client copies: `src/admin/defaultConfig.js`, `src/config/localDefaultConfig.js`.
- **Nium config is destructible:** `DELETE /api/config?tenant=nium` (`api/config.js:171-182`) removes the config **and every `config:nium:v*`**; rollback (`api/config-versions.js:92-134`) skips the empty-config guard; self-heal (`api/config.js:73-84`) overwrites without archiving.

### 3.2 Decisions

1. **Entry:** `/preboarding?tenant=<id>` (own path, mirrors `/admin`). `/?tenant=<id>&preboarding=1` **redirects** to it (client-side, preserving other params).
2. **Per-tenant switch:** `preboarding.enabled` in tenant config; **super admin only** toggles it (tenant card). Tenant admins see a read-only indicator.
3. **Password:** one shared, **server-checked** analyst password (`PREBOARDING_PASSWORD` env). Per-tenant passwords → PREB-3.
4. **Tenant binding:** the pre-boarding auth response carries the verified tenant; the client uses it for dossier saves and invite links.
5. **No silent tenant creation:** config GET seeds only for tenants that exist (registry entry, or a pre-existing non-blank config for legacy tenants).
6. **Drafts are scoped** by `tenantId` + `agentType`.
7. **Customer-visible brand text** comes from tenant config; internal names stay in BRAND-1.
8. **Default settings become a named template** with an admin "Apply default settings" action; protection keys off a registry flag, not the id `"nium"`.

### 3.3 Design

**Routing.** `src/index.js` gains a `/preboarding` branch (same `path === "/preboarding" || path.startsWith("/preboarding/")` shape as `/admin`) rendering `<KYCAgent preboarding />`. `vercel.json` gains `/preboarding` + `/preboarding/(.*)` rewrites to `/index.html` (explicit, mirroring `/admin`). `src/App.js` takes `preboarding` as a prop; the in-render URL parse at `:4699` and the duplicate at `:771` collapse into one memoised helper that also honours the legacy param and triggers the redirect.

**Tenant gate (client).** `/preboarding` with no `?tenant=` renders `NoTenantLanding` with pre-boarding copy. With a tenant, the gate first calls the auth/status endpoint (below) and renders one of: password form, "not available for this tenant", or "tenant not found / inactive".

**`POST /api/preboarding-auth`** (new, CommonJS):
- Body `{ password }`; tenant from `getTenantIdFromRequest`.
- 400 `tenant_required` when no tenant.
- 404 `tenant_not_found` when the tenant has no registry entry **and** no existing non-blank config.
- 403 `tenant_inactive` when `isActive === false`; 403 `preboarding_disabled` when `config.preboarding?.enabled !== true`.
- 500 when `PREBOARDING_PASSWORD` is unset; 401 on mismatch (`timingSafeEqual` via `lib/auth.js#verifyEnvBearer`).
- 200 `{ success: true, token: <password>, tenantId, companyName }` — same shape as `api/admin-auth.js`, so the client stores it in `sessionStorage` (`preboarding_token`, `preboarding_tenant`) exactly like `AdminRoot`.
- `GET` (no password) returns only `{ available: boolean, reason }` so the gate can render the right screen without probing the password.

**Tenant existence helper.** New `lib/tenantRegistry.js` (CommonJS): `readRegistry()`, `findTenant(id)`, `tenantExists(id)`, `isTenantActive(id)`. `api/tenants.js` keeps ownership of writes and is refactored to use the helper (no second registry reader; `api/benchmark.js`'s copy-pasted `readConfig`/`seedTenant` is replaced by the shared one).

**Config seeding change** (`api/config.js`): `seedTenant` is called only when `tenantExists(id)`; otherwise GET returns **404 `tenant_not_found`**. Legacy tenants (config exists, registry entry missing) are treated as existing and back-filled into the registry on read.

**Analyst→tenant binding.** `buildDossierPayload` uses the tenant from the auth response (state), not `getTenantId()`; `InviteScreen` stops building the link locally and renders the one `/api/invite` returns (see Part 1). `api/invite.js` and `api/save-dossier.js` additionally require the analyst credential (Part 1) and take the tenant from the verified credential context, ignoring `body.tenantId` when a credential is present.

**Draft scoping** (`src/utils/submissionDraft.js`): `saveDraft` stores `{ tenantId, agentType, state }`; `loadDraft(tenantId, agentType)` returns `null` on mismatch. `src/App.js:858-862` passes both. Legacy drafts (no tenant recorded) are ignored.

**Brand de-Niuming (customer-visible only).**
- `api/invite.js`: subject/body/sign-off use `companyName` resolved server-side from the tenant config (`config.company.name`), falling back to the tenant id; the `from` name uses the same, with `INVITE_FROM_EMAIL` still overriding the address.
- `InviteScreen.jsx`: preview text mirrors the server template using `tenantConfig.company.name`.
- `src/App.js:4306`: `manualFormUrl` no longer falls back to `MANUAL_FORM_URL`; Card C ("I'll complete the form myself") renders only when the tenant configured one. `src/constants/appConstants.js:59` constant is removed.
- `lib/seedConfig.js`: template drops `manualFormUrl` (empty string) and sets `company.name` to `""` (the creating flow supplies it).
- `src/components/Step2DynamicForm.jsx`: the four strings take the company name from config.
- `lib/seedSchemas.js` + `src/pipeline.js` FI labels become brand-neutral ("your account with us", "how our products will be used").
- `src/config/localDefaultConfig.js`: company name becomes `""` (header/footer already fall back to the tenant id).

**Broken-link fixes.** `AdminDashboard.handlePreview`, `StepPublish.handlePreview`, `StepPublish` "View live flow", `TenantCard` admin/customer URLs and `CredentialsModal` all always append `?tenant=<id>`. `lib/tenant.js` drops the `TENANT_ID` fallback (server becomes 3-strict like the client); `.env.example` marks it removed; `src/setupProxy.js`'s comment is updated.

**Default-settings template.**
- `lib/configTemplates.js` (new, CommonJS): `listTemplates()` → `[{ id: "nium-default", label: "Nium default settings", description }]`; `buildTemplateConfig(id, tenantId)` → delegates to `lib/seedConfig.js#buildDefaultConfig` and clears brand fields. Templates live in code, so they cannot be deleted at runtime.
- `GET /api/config-templates` lists them; `GET /api/config-templates?id=nium-default&tenant=<id>` returns the built config (admin credential required).
- Admin panel: **"Apply default settings"** in `StepPublish` — confirm dialog → archive current version → load the template into the working draft (not published). Publish remains the only path to live.
- Super admin create: unchanged options, but the copy is brand-cleared and `startFrom` values become `blank` | `nium-default`.
- `src/admin/defaultConfig.js` and the seed half of `src/config/localDefaultConfig.js` are deleted; the admin offline fallback fetches the template (and, if offline, renders blank).

**Protection flags.** Registry entries gain `isProtected` (back-filled `true` for `nium`, and for any entry with `isInternal: true`). Enforcement moves off the literal id:
- `DELETE /api/config` → 403 for protected tenants.
- `POST /api/config` empty-config guard applies to protected tenants (today: `nium` only).
- `POST /api/config-versions` (rollback) applies the same guard.
- Self-heal archives the broken config as a version before overwriting.
- `api/config.js`/`api/config-versions.js` env-password fallback keys off `isProtected` + `ADMIN_PASSWORD` rather than `=== "nium"`.

### 3.4 Tests (Part 5)

Node: preboarding-auth (no tenant / unknown / inactive / disabled / no env / wrong password / success shape, and the `GET` availability probe); config GET 404 for unknown tenant + legacy back-fill; invite email uses tenant company name; protected-tenant delete/publish/rollback refusals; self-heal archives first; template list/build is brand-free; `lib/tenant.js` has no env fallback.
Jest: `/preboarding` renders the gate; legacy `?preboarding=1` redirects; disabled/unknown tenant screens; Card C hidden without `manualFormUrl`; draft from another tenant is not offered; admin preview URL always carries the tenant.

---

## 4. Part 1 — Credentials and endpoint locks

### 4.1 Decisions

- **Customer key:** signed, expiring (30 days), revocable `dossierToken`.
- **Analyst key:** shared password, server-checked, Bearer.
- **Dual-credential** on the shared endpoints (the customer re-research path needs them).
- **Old `?dossierId=` links break** — no grace period.
- **Ownership lock:** once the customer has changed anything (or submitted), the analyst is read-only for that dossier, enforced server-side.
- `change-events` (write) and `amendment-documents` (read) get the same locks.

### 4.2 Design

**`lib/dossierToken.js`** (new, CommonJS):
- `mint({ dossierId, tenantId, ttlSeconds = 2592000 })` → `base64url(JSON payload) + "." + hex HMAC-SHA256`, payload `{ dossierId, tenantId, exp, jti }`, secret `DOSSIER_TOKEN_SECRET`.
- `verify(token)` → `{ valid, reason, payload }`; reasons: `malformed`, `bad_signature`, `expired`, `revoked`, `no_secret`. Signature compared with `timingSafeEqualHex` (reuse the primitive from `lib/didit/webhookSignature.js`).
- `revoke(jti, exp)` / `isRevoked(jti)` via `lib/storage.js` key `dossier-token-revoked:<jti>` with TTL to the token's own expiry.
- No new dependency (node:crypto only).

**`lib/auth.js`** gains `requireEnvBearer(req, res, envName)` (constant-time) and `readBearer(req)`. Existing hash helpers stay (weak-hash replacement remains PLAT-2).

**`lib/dossierAccess.js`** (new, CommonJS) — one place that answers "who is calling, and may they touch this dossier?":
```
resolveDossierActor(req)          → { kind: "analyst"|"customer"|"none", tenantId, dossierId|null, reason }
assertCanReadDossier(actor, row)  → { ok, status, error }
assertCanWriteDossier(actor, row) → { ok, status, error }   // refuses analyst writes to customer-owned rows
```
Ownership: `entity_dossiers.owned_by` (`'analyst' | 'customer'`, migration 026, default `'analyst'`) flips to `'customer'` on the customer's first write (correction, re-research save, or submit).

**Endpoint matrix.**

| Endpoint | analyst Bearer | customer token | Notes |
|---|---|---|---|
| `POST /api/preboarding-auth` | — | — | issues the analyst credential |
| `POST /api/invite` | required | — | mints the dossier token, emails the token link |
| `POST /api/revoke-dossier-token` (new) | required | — | body `{ dossierId }` or `{ jti }`; revokes |
| `GET /api/get-dossier` | read any dossier in its tenant | read only its own dossier | token tenant must match the row |
| `POST /api/save-dossier` (update) | refused when `owned_by = 'customer'` | own dossier only | tenant from credential |
| `POST /api/save-dossier` (create) | required | refused | customers never create dossiers |
| `GET/POST /api/search-attempt` | own tenant | own dossier | **adds the missing `tenant_id` filter** |
| `POST /api/change-events` (dossier-keyed) | read-only for customer-owned | own dossier | non-dossier ids unchanged (PLAT-7) |
| `GET /api/amendment-documents` (dossier-keyed) | own tenant | own dossier | same |
| `POST /api/dossier-reseed` | — | — | pure decision, stores/returns nothing |

Failures: `401 unauthorized`, `403 dossier_locked`, `410 link_expired` / `link_revoked` (customer-facing copy: "This link has expired — ask your onboarding contact for a new one").

**Link format.** `/?tenant=<id>&dossierToken=<token>&journey=customer`. `InviteScreen` no longer builds the link: it POSTs to `/api/invite` and renders the link the server returns (single source of truth). `api/invite.js` keeps the same-origin validation for any client-supplied link and drops `dossierId` from the URL. `src/App.js` link-landing reads `dossierToken`, sends it as `Authorization: Bearer dossier:<token>` (or `?dossierToken=`, see below) to `get-dossier`, and keeps it in memory + draft for later calls.

**Credential transport.** Analyst: `Authorization: Bearer <password>`. Customer: `Authorization: Bearer dossier:<token>` for POSTs; `?dossierToken=` for the initial GET landing (the browser navigates there). `resolveDossierActor` accepts both.

**Preview (analyst) is read-only** for customer-owned dossiers: the client shows a "Review only" banner and disables save/re-search/submit/correction actions; the server refuses regardless.

**`save-dossier` hardening:** the `INSERT INTO tenants` upsert is removed — the tenant must already exist (Part 5 guarantees it).

### 4.3 Tests (Part 1)

Node: token mint/verify (valid, tampered payload, tampered signature, expired, revoked, wrong secret, missing secret); `resolveDossierActor` for both credential shapes; per-endpoint matrix (each cell: allowed / 401 / 403 / 410); analyst write refused on a customer-owned row; token for dossier A cannot touch dossier B or another tenant; `search-attempt` tenant scoping; invite returns a token link and never a raw `dossierId`.
Jest: gate calls the server and stores the credential; expired-link screen; invite screen renders the server link; Review-only banner disables actions.

---

## 5. Part 2 — AI-endpoint hardening

### 5.1 Decisions

A (server-built prompts), B (rate limit), D (credential-aware buckets) now; C (daily spend cap) → PLAT-6. All six Claude-spending endpoints are covered. Preview uses draft config only with a valid admin credential.

### 5.2 Design

**`api/research.js` new contract** (CommonJS):
```
POST /api/research
{ mode: "research" | "gap_recovery" | "extract_document",
  tenant, companyName, countryCode, entityType, ownershipType, registrationNumber,
  forceRefresh, sourcedDocuments: [{label, year, sourceUrl, sourceLabel}],
  wolfsbergFields,                       // mode=research
  missingFields: [fieldId], upgradeableFields: [fieldId],   // mode=gap_recovery
  docKey, file: { mediaType, base64 },   // mode=extract_document
  draftConfig }                          // preview only; requires admin credential
```
- `prompt`, `messages`, `model`, `tools`, `max_tokens` from the client are **rejected** (400 `client_prompt_not_allowed`).
- The server resolves the tenant config (`lib/configStore.js`, extracted from `api/config.js` so research/benchmark/config share one reader), then `getSchemaFromConfig` + `buildPrompt` / `buildGapRecoveryPrompt` from `src/pipeline.js` (already CommonJS and already required by `api/benchmark.js`).
- Reg-number and "automatically sourced documents" blocks move from `src/App.js:1676-1700` into the server prompt builder.
- Extraction prompts move to `src/constants/extractionPrompts.js` → CommonJS (imported by both `src/constants/docTypes.js` and the server).
- Model, tools (`RESEARCH_TOOLS`) and `max_tokens` are server-owned.
- Response shape is unchanged (`usage`, `content`, `_fromCache`, `_cachedAt`) so `src/App.js` cost tracking keeps working.
- **Cache key** (`lib/researchCache.js`) becomes `tenant | companyName | jurisdiction | entityType | ownershipType | registrationNumber`; `lib/researchCache.js` converts to CommonJS with the handler.
- `src/setupProxy.js:80-191` hand-copy is deleted; the route mounts the real handler.

**`lib/rateLimit.js`** (new, CommonJS): `check({ bucket, key, limit, windowSeconds })` → `{ allowed, remaining, retryAfterSeconds }`, backed by `lib/storage.js` with keys `ratelimit:<bucket>:<key>:<windowStart>` and a TTL of one window. Non-atomic read-modify-write is accepted at the limit edge (`// ponytail: fixed-window counter, swap for an atomic INCR if the edge case matters`). Key selection: analyst credential → `analyst:<hash>`; dossier token → `dossier:<dossierId>`; otherwise `ip:<first x-forwarded-for entry>`.

Defaults (env-tunable, `RATE_LIMIT_*`): research 40/h, doc-search 40/h, self-source 40/h, ubo-discovery 20/h, generate-policy 10/h, analyst bucket 200/h. Exceeded → `429 { error: "rate_limited", retryAfterSeconds }` + `Retry-After`; the client shows "Too many requests — please try again in N minutes".

**Other endpoints.**
- `api/benchmark.js`: requires the admin credential (`requireEnvBearer` / tenant-auth), plus the shared config reader; keeps its 25-company cap.
- `api/generate-policy.js`: accepts the **structured form** instead of `prompt`; validation against the allowed option lists; free-text fields (`policyName`, `version`, `otherVendor`) trimmed + length-capped; the server builds the user message (the builder moves out of `src/policySimulator/PolicySimulator.jsx` into a shared CommonJS module used by both).
- `api/doc-search.js`, `api/self-source.js`, `api/ubo-discovery.js`, `api/ubo-control-lab.js`: rate limit only (they already take structured input). `public/ubo-lab.html` has no login, so no credential requirement.

### 5.3 Tests (Part 2)

Node: research rejects `prompt`/`messages`/`model`/`tools`/`max_tokens`; builds the prompt from tenant config; `draftConfig` ignored without a valid admin credential and honoured with one; cache key varies by tenant/ownership/reg number; each mode's happy path with an injected fake fetch; rate limiter allows N, blocks N+1, resets after the window, and buckets by analyst/dossier/ip; benchmark 401 without credential; policy simulator rejects unknown option values and over-long text.
Jest: the three call sites send the new body shape; the 429 message renders.

---

## 6. Part 3 — Customer correction → re-research

### 6.1 Decisions

- **Entity type only** → re-derive (no search, no retry). **Anything else** (company name, country, registration number, ownership type, or a mix) → full re-search, one retry consumed.
- Inline correction inputs on the facts gate; no hard reset.
- **Customer gets 2 re-searches**; the analyst's original search does not count.
- **Every dossier version is snapshotted** before it is overwritten; the analyst's original is therefore always recoverable.
- Same flow for fresh (no-link) customers; their retry count is keyed by application id in storage.
- Submissions record their source dossier.
- Analyst becomes read-only once the customer has changed anything.

### 6.2 Design

**Migration 026** (single file):
- `entity_dossiers`: `owned_by TEXT NOT NULL DEFAULT 'analyst'`, `customer_searches INTEGER NOT NULL DEFAULT 0` (new, server-owned; the legacy `search_attempts` column is left untouched), `last_customer_action_at TIMESTAMPTZ`.
- `entity_dossier_versions` (new): `id UUID PK`, `dossier_id`, `tenant_id`, `version INTEGER`, `snapshot JSONB`, `created_by TEXT` (`analyst`/`customer`/`system`), `reason TEXT`, `created_at`. Unique `(dossier_id, version)`. Append-only; no update/delete endpoint exists.
- `onboarding_sessions`: `dossier_id TEXT` + index.

**Gate UI** (`FoundationalFactsGate.jsx` + `ApplicantPage.jsx`): unticking a fact reveals the matching input (text for company name / registration number; selects for country, entity type, ownership type) pre-filled with the current value. Multiple facts can be corrected at once. A single **"Update my details"** button submits them. The existing "it genuinely changed" forks for ownership and registration number are unchanged (document request + continue). The reset buttons (`facts-reset-confirm`, `ownership-misclassified`, `regnumber-misclassified`) are replaced by the correction flow; a separate explicit "Start a brand-new application" action remains.

**Decision + execution** (new module `src/reresearch/correctionPlan.js`, pure + unit-tested): given the corrected fields → `{ action: "re_search" | "re_derive", changed: [...] }`. `action = "re_derive"` only when the sole change is `entityType`.

**`re_search` path (`applyCorrections`)**:
1. Set the corrected values into state.
2. Ask the server for permission + count: `POST /api/search-attempt` (dossier) or `POST /api/research-attempt` (fresh, storage-keyed by application id) → `{ allowed, attemptsUsed, remaining }`. Not allowed → Step 5 fallback.
3. `POST /api/save-dossier` with `snapshot: true` → the server writes the current row into `entity_dossier_versions` **before** applying the update, and flips `owned_by` to `'customer'`.
4. Run research with the corrected values passed as **explicit arguments** (`doResearch({ overrides })` — today it reads stale closure state) and `forceRefresh` semantics covered by the new cache key.
5. Keep: applicant details (`gapRef` applicant keys), gap answers, IDV state, uploaded files, `dossierId`, `landedViaLink`, `onboardingSubmissionId` (no rotation on the dossier path).
   Replace: `research`, `checks`, `affirmedFields`, `inlineEditOpen`, stakeholder state, `coverage`, `fieldMetadata`, **and `selfSourceResults`** (stale-company leak fixed).
   Reset: `factChecks` and both forks, so the gate re-renders confirmed against the new values.
6. Save the new dossier (`seeded_by: 'customer'`), log a `change_events` entry describing the correction.
7. Stay on the Applicant page throughout (loading state), never `resetAll`.

**`re_derive` path:** re-resolve the schema from the corrected entity type, **then** save (today `applyReDerive` saves in the same tick and persists the stale schema), snapshot first, no attempt consumed, stay on the page.

**Fallback (Step 5):** research failure or no retries left → friendly copy (`CONTACT_ADMIN_MSG` for the cap) + manual entry; `postReresearchFailureFlag` is called with `submissionId = dossierId || onboardingSubmissionId` so it is never dropped; the flag is posted for all research paths (not just `doResearch`'s catch).

**Server-authoritative counting:** `customer_searches` is incremented only by the server (`api/search-attempt.js` POST, tenant-scoped, token-verified). `buildDossierPayload` stops sending `searchAttempts`; `api/save-dossier.js` stops writing that column. `api/get-dossier.js` returns `customer_searches` and `owned_by`; the link landing restores the count **and `registrationNumber`** (`rawResearch.registrationNumber`, currently never read back).

**Fresh customers:** `api/research-attempt.js` (new) keeps the count in `lib/storage.js` under `research-attempts:<applicationId>` with a 30-day TTL. No dossier row, no snapshot.

**"Start a brand-new application":** `resetAll` also clears `companyName`, `countryCode`, `entityType`, `ownershipType` and calls `clearDraft()` (fixes both audit bugs at the shared root, so the Applicant "Start Over" and "Start New Application" buttons inherit the fix). On the link journey it keeps `dossierId` + `landedViaLink` so the new application stays attached to the analyst's dossier.

**Submission link:** `src/App.js` sends `dossierId` in the `/api/submit` body; `api/lib/finalizeSubmission.js` writes `onboarding_sessions.dossier_id`; the customer's submit flips `owned_by` to `'customer'`.

**Customer never sees the analyst screen:** `saveDossier` sets `showDossierView(true)` only when `agentType === "preboarding"`.

### 6.3 Tests (Part 3)

Node: `correctionPlan` truth table; snapshot written before update, with version numbering; analyst write refused after `owned_by='customer'`; `customer_searches` increments only server-side, blocks the 3rd, is tenant-scoped; fresh-customer attempt store; `get-dossier` returns the new fields; finalize writes `dossier_id`.
Jest: unticking each fact reveals the right input; "Update my details" triggers search vs re-derive per the rule; kept-vs-replaced state after a re-search; cap message + manual entry; failure fallback; no analyst dossier screen for customers; "start a brand-new application" clears the lookup fields and the draft but keeps the dossier link.
Browser QA checklist (owner): link → correct name → re-search → continue → submit; correct entity type only; third re-search blocked; refresh mid-flow.

---

## 7. Part 4 — Pre-boarding polish

1. **Analyst resume** — persist `showDossierView` in the draft (or re-derive it: `agentType==='preboarding' && dossierId && step===confirm`) so resume returns the analyst to `DossierView`.
2. **`selfSourceResults` in the draft** — add it (plain JSON: labels + URLs) so sourced documents survive resume; `manuallyUploadedDocs` derives from it.
3. **First-save duplicate race** — client in-flight guard in `saveDossier` + a client-minted `creationKey` sent on the INSERT branch, unique-indexed server-side so a repeat create is ignored.
4. **Dead code** — remove the `?ref` hydration effect (`src/App.js:1002-1031`; nothing has written `nium_invite_*` since Phase 1) and the duplicate `?preboarding` parse (folded into Part 5). The parked "Back to agent selection" button stays parked.
5. **Wire orphan tests** — extend the `test:node` glob to cover `src/reresearch/tests/*.nodetest.js` and `dossierLifecycle/__tests__/*`.

Tests: resume returns to the dossier; sourced docs survive resume; double save creates one row; a link without `?ref` still works; the newly wired suites pass.

---

## 8. Rollout and deploy gates

- **Migrations:** 026 must be applied to dev and prod (`node db/apply.js db/migrations/026_*.sql`).
- **New env vars:** `DOSSIER_TOKEN_SECRET` (required), `PREBOARDING_PASSWORD` (required), `RATE_LIMIT_*` (optional), `INVITE_FROM_EMAIL` (existing). `TENANT_ID` is removed from use.
- **Breaking:** existing `?dossierId=` invite links stop working (accepted); analysts must use `/preboarding?tenant=<id>`; `?preboarding=1` redirects.
- **Outstanding unrelated gates** (from the previous branch): migrations 024/025 on prod, `CRON_SECRET` (DEP-2), submit-flow browser QA.

## 9. Risks

- `src/App.js` is ~5,400 lines; Parts 3 and 5 touch it heavily. Mitigation: extract the correction logic into `src/reresearch/correctionPlan.js` and keep handlers thin; run build + full jest after each task.
- Moving prompt construction server-side changes research output if the stored tenant config differs from the browser's. Mitigation: a golden-prompt test comparing the server-built prompt against the current browser-built prompt for the Nium default config.
- Locking endpoints can break flows we have not mapped. Mitigation: the endpoint matrix is exhaustive and each cell is tested; `dossier-reseed` deliberately stays open.
- Jest suites `PolicySimulator.test.jsx`, `appMounts.test.jsx`, `noTenantLanding.integration.test.jsx` are known-flaky under parallel load — re-run failures in isolation before treating them as regressions.
