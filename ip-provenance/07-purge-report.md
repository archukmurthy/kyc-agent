# 07 — Nium Exposure Purge Report

Surgical removal of previous-employer (Nium/Instarem) material, in three
sweeps, on branch `chore/provenance-cleanup` (cut from `origin/main`).
Each sweep is a single reviewable commit.

| Sweep | Commit | Subject |
| ----- | ------ | ------- |
| 1 | `ef9321d` | delete the Nium API integration |
| 2 | `27fbac9` | scrub cosmetic Nium/Instarem references |
| 3 | `fb427be` | re-derive contaminated document-requirements matrix rows |

> **Note on the protected evidence folders.** The rails named `/audit`,
> `/audit-reconciliation`, `/ip-provenance`, `docs/technology-due-diligence`
> and the branch `refactor/modular-architecture` as "do not touch". **None of
> them exist in this repository** (checked against `origin/main` and every
> remote branch), so there was nothing to exclude. `/ip-provenance/` was
> created solely to hold this report, as instructed.

---

## Sweep 1 — Nium API integration deleted

### Files deleted (9)
- `lib/niumClient.js` — Nium eKYB transport client (base URLs, `x-api-key`
  auth, preprod/prod hostnames, `fetchExhaustiveDetails` /
  `fetchOnboardingConstants` / `fetchPublicDetails`, `NiumAPIError`).
- `api/nium/constants.js`, `api/nium/public-details.js`,
  `api/nium/exhaustive-details.js` — the whole `api/nium/` route folder
  (encoded the `/api/v5/client/{clientHashId}/...` paths and the corporate
  `exhaustiveDetailsSearch` call).
- `agents/kycLookupAgent.js` — the KYC-lookup agent; existed only to drive
  the Nium eKYB V5 API via `niumClient`.
- `api/kyc-lookup.js` — the `/api/kyc-lookup` route; existed only to invoke
  `kycLookupAgent`.
- `agents/ubo/niumOwnershipAdapter.js` — a UBO ownership adapter over the
  agent; was unwired dead code (imported nowhere).
- `scripts/nium-connectivity-check.js` — Nium API connectivity probe.
- `agents/KYC_LOOKUP_AGENT_HANDOFF.md` — documentation for the deleted
  integration (auth pattern, endpoints, V5 fingerprints).

### Call sites repaired (5)
- `src/setupProxy.js` — removed the dev-server `require`s and routes for
  `/api/nium/constants`, `/api/nium/public-details`,
  `/api/nium/exhaustive-details` and `/api/kyc-lookup`.
- `src/App.js` — removed the `startNiumApiLookup` and `findNiumRegNumber`
  handlers, the `niumRegNumber` / `niumSearch*` state, the `nium_api`
  loader-message branch, and the reg-number field in the `/api/self-source`
  payload (it was already `null` on every surviving journey).
- `src/constants/appConstants.js` — removed `SHOW_NIUM_REG_PANEL`,
  `NIUM_DEMO_REG_NUMBER`, `NIUM_DEMO_COUNTRY`.
- `src/components/companyLookup/JourneyPicker.jsx` — removed Card D
  (the "Nium API Lookup" journey card) and the registration-number resolver
  panel, plus their now-unused props/imports.
- `src/components/companyLookup/__tests__/JourneyPicker.render.test.jsx` —
  dropped the Card D / reg-panel test assertions for the removed feature.

### Functionality removed (existed ONLY through the Nium integration)
- **The test-mode "Nium API Lookup" journey** (journey type `nium_api`,
  Card D on the journey picker) — pulled verified registry data straight
  from the Nium eKYB sandbox instead of AI research.
- **The Companies-House-backed registration-number resolver panel** that fed
  that journey (behind `SHOW_NIUM_REG_PANEL`, already `false` in the running
  app). Note: the underlying public `GET /api/company-search` endpoint is
  **retained** — it is Companies House, not Nium.

The surviving customer flow (AI-documents, AI-research, manual, max-prefill)
and the UBO framework (Companies House + web-research adapters) are unaffected.

---

## Sweep 2 — cosmetic references scrubbed

### Named changes
- **Default tenant `nium` → `demo`** everywhere: the tenant resolvers
  (`lib/tenant.js`, `src/utils/tenant.js`), the config self-seed / self-heal /
  empty-publish-protection logic (`api/config.js`, `lib/seedConfig.js`), admin
  and super-admin UI, fixtures, `.env.example`, docs, and two SQL migration
  **comments** (see the migration note below).
- **Password salt `nium-kyc-2026` → `kyb-platform-2026`** in `lib/auth.js`
  and `src/utils/auth.js`. **This invalidates previously stored admin
  password hashes** (see *Items needing your action*).
- **Example passwords** in `.env.example`: `nium-admin-2026 → changeme-admin`,
  `nium-super-2026 → changeme-super`.
- **Validation-engine default LOA recipient `Nium` → `the Platform`** — the
  neutral configurable default, updated in the validator test fixtures and
  `public/validation-lab.html` (the engine reads the recipient from context;
  there was no hardcoded `Nium` in engine code).
- **`CODEX_CONTEXT.md`** — rewritten to drop "for Nium (operating under
  Instarem)". The file has substantial non-Nium purpose (worktree setup,
  architecture, DB layout, function contracts), so it was kept, not deleted.
- **`PRODUCTION_READINESS.md`** — removed the internal Confluence link
  (`instarem.atlassian.net/...`) and the "See Confluence for full details"
  pointers.
- **`CLAUDE.md` / `AGENTS.md`** — the multi-tenant docs updated to describe
  the `demo` default tenant and "Demo protection" so they match the code.

### Renames (identifiers / tokens, all references updated)
- CSS/brand token `niumBlue → brandBlue`
- `niumEntityType → entityCategory` (App.js + self-source / doc-search chain)
- `NIUM_DEFAULT_OWNERSHIP_TYPES → DEFAULT_OWNERSHIP_TYPES`
- `isNium → isDefaultTenant`, `seedNiumAuth → seedDefaultAuth`
- `localStorage` key `nium_invite_ → demo_invite_`
- outbound HTTP `User-Agent` `NiumKYCAgent → KYBResearchAgent`
- `MANUAL_FORM_URL` / seed `manualFormUrl` `https://app.nium.com →
  https://example.com/apply` (placeholder — see *Items needing your action*)
- brand word **`Nium` → `Demo`** in UI copy, research prompts, comments and docs
  (chosen to match the `demo` tenant; rebrand when the real product name is known)

### Employer-specific content removed (beyond plain word-swaps)
- `src/pipeline.js` — deleted the hardcoded **"Nium FinTech Limited"
  known-issue guard** (company number 09337457 + named officers) that
  special-cased the previous employer's own entity in the director-extraction
  prompt. It emitted `""` for every other company, so removal is
  behaviour-preserving except for that one entity.
- `src/pipeline.js` — the director worked-example used **Nium FinTech's real
  directors** (Anupam Pahuja, Prajit Nanu). These names contain no "nium"
  string and so were **not** required by the zero-hit target, but they are
  previous-employer material, so I neutralised them to generic placeholders
  (Jane Smith / John Doe). **Judgment call — flag if you'd rather keep the
  originals.**

---

## Sweep 3 — contaminated matrix rows re-derived (`documentRequirements.js`)

Every flagged entry replaced from a public source; a source note added to each.
**No row required a `TO BE DEFINED` marker** — a public basis was available for
all of them.

| # | Entry | Old attribution (removed) | Re-derived from (public source) |
|---|-------|---------------------------|---------------------------------|
| 1 | UBO threshold — New Zealand | "or Nium applies a stricter internal standard" | NZ AML/CFT Act 2009 + DIA beneficial-ownership guidance (>25% or effective control) |
| 2 | UBO threshold — Indonesia | "per Indonesia MLRO standard"; "at least the second layer" | Presidential Regulation No. 13 of 2018 on Beneficial Ownership (25% + look-through to the natural person) |
| 3 | UBO threshold — Lithuania | "local MLRO direction" | EU AMLD (Directive (EU) 2015/849) + Lithuanian AML/CTF Law |
| 4 | UBO threshold — default | "MLRO direction" | FATF Recommendation 10 / EU AMLD |
| 5 | UBO ID fallback | "subject to policy and MLRO sign-off" | FATF Rec 10 / EU AMLD Art. 3(6) senior-managing-official fallback |
| 6 | UBO escalation step | "Escalate to Compliance or MLRO" | genericised to "Escalate to Compliance" (a workflow step, not a legal requirement) |
| 7 | Indonesia registry notes + overlay | "Indonesia MLRO standard"; "second layer" | AHU / Ministry of Law (Kemenkumham) framework + Perpres 13/2018; function `applyIndonesiaMlroOverlay` renamed `applyIndonesiaOverlay` |
| 8 | Australia registry notes | "AU MLRO confirms new ICDD future-state"; "ICDD Director ID Number" | ABRS / ASIC director-registration regime — Director ID is a directors' obligation, not an AML CDD collection item |
| 9 | UK signatory-authority comment | "UK MLRO requirement" | Money Laundering Regulations 2017 (risk-based CDD) |

Also scrubbed the residual cosmetic `Nium` brand in this file (header /
derivation comments and the "Nium customer application form" document names) to
`Demo`.

- **Rows left unchanged because already publicly attributable:** the Australia
  25% UBO threshold (AUSTRAC definition) and every jurisdiction's `registry` /
  `citations` block (they already cite the registry, regulator and statute).
- **Kept deliberately:** `MOLHR` / `MLOHR` — this is Indonesia's **Ministry of
  Law** (Kemenkumham), a public body, **not** the internal MLRO role.

---

## Verification results

| Check | Target | Result |
| ----- | ------ | ------ |
| Case-insensitive `nium` / `instarem` across the tree (excl. `node_modules`, `build`) | 0 | **0** ✓ |
| V5 fingerprints `clientHashId`, `exhaustiveDetailsSearch`, `/api/v5/` (outside evidence folders — none exist) | 0 | **0** ✓ |
| Production build (`CI=true npm run build`) | pass | **Compiled successfully** ✓ |
| Test suite (`CI=true npm test`) | pass | **478 passed, 25 suites** ✓ |
| Validation suite (`node --test agents/validation/tests/*.test.js`) | pass | **18 passed, 0 failed** ✓ |

No test failed for a reason unrelated to these changes.

---

## Items needing your action

1. **Deployed admin passwords will stop working — salt changed.** The password
   hash salt moved from `nium-kyc-2026` to `kyb-platform-2026`, so every admin
   password **hash** already stored in Vercel KV will no longer verify.
   Re-seed / re-set the per-tenant admin passwords after deploy. Also update the
   `ADMIN_PASSWORD` / `SUPER_ADMIN_PASSWORD` environment variables (the
   `.env.example` placeholders are now `changeme-admin` / `changeme-super`).

2. **`TENANT_ID` environment variable.** If production sets `TENANT_ID=nium`,
   change it to `demo` (the code default fallback is now `demo`).

3. **Stored data still keyed to tenant `"nium"` — I did NOT touch the DB.**
   The default tenant id is now `demo`. Any config in KV, and any rows in
   `entity_dossiers` / `onboarding_sessions` / `field_provenance` /
   `session_timeline` / etc. with `tenant_id = 'nium'`, are now **orphaned** —
   the app self-seeds a fresh `demo` config and looks up `demo` by default.
   Decide whether to migrate the stored `nium` tenant data to `demo` or leave
   it. (Per the rails, I made no queries and no data changes.)

4. **`MANUAL_FORM_URL` is a placeholder.** It is now `https://example.com/apply`
   (was `https://app.nium.com`), and `appConstants.js` carries a
   `// TODO: replace with actual product form URL`. Set the real manual-form URL.

5. **Neutral brand name "Demo".** UI copy, prompts and the seed
   `company.name` now say `Demo`. Rebrand to the real product name when known.

6. **Judgment call — director worked-example names.** I replaced the previous
   employer's real directors (Anupam Pahuja, Prajit Nanu) in the pipeline
   prompt example with generic placeholders. Revert if you'd prefer the
   originals kept (they contain no "nium" string, so the zero-hit target does
   not require the change).

7. **Migration-file comments.** Sweep 2 edited `--` **comments only** in
   `db/migrations/003_persistence_now.sql` and `007_change_events.sql`
   (a `'nium'` example slug and a `'Nium'` entry in a `source_provider`
   example list). `db/apply.js` strips `--` comments before executing, so these
   edits are inert to the database and do not change what the migrations do.
   Flagged here because the repo convention is "never modify existing
   migrations"; revert if you'd rather list them as justified remaining hits
   instead.

8. **`TO BE DEFINED` matrix decisions:** none. Every flagged matrix row had a
   public source, so no row was left `TO BE DEFINED`.

The branch is pushed for your review; nothing has been merged to `main`.
