# How We Build

The working agreement for this project. Read this at the start of any session
before planning work. It is short on purpose — a long one rots.

Decided 18 September 2026. Change it by editing this file, not by remembering
something different.

---

## 1. Two lanes, decided by file path (never by opinion)

**Guarded** — a change is Guarded if it touches ANY of:

- anything in `api/`
- `lib/auth.js`, `lib/dossierAccess.js`, `lib/tenantRegistry.js`,
  `lib/rateLimit.js`, `lib/storage.js`, `lib/researchGrant.js`
- anything in `db/migrations/`
- the submit / finalize path (`src/App.js` submit handlers,
  `api/lib/finalizeSubmission.js`)
- anything involving a password, token, secret, tenant, money, or personal data

One Guarded file makes the whole change Guarded. No splitting hairs.

**Everything else** is Standard.

---

## 2. The five stages

1. **Plan** — exact files, exact interfaces, and the tests that will prove it.
   Guarded also states in one line what goes wrong if this is built badly
   (who gets in, what leaks, what breaks). Skip only for copy/doc edits.
2. **Build** — test first for anything with logic. Lint and covering tests run
   after each edit. Agents get file:line pointers, never "go find it".
   Parallel agents only on file lists that do not overlap — write the list first.
3. **Prove** — full suite and a clean build before every pull request, always.
   Guarded also gets an adversarial reviewer told exactly what to attack, and
   database changes get a tested way to undo them.
4. **Gate** — automatic checks run on every pull request (`.github/workflows/ci.yml`).
   GitHub cannot enforce the block on a private personal repo, so **nothing red
   gets merged is an agreement, not a wall** (PROC-4). Two backstops: the checks
   are visible on every pull request, and `.githooks/pre-push` runs the suites
   before a push. Enable it once per clone:
   `git config core.hooksPath .githooks`. Skipping it with `--no-verify` is for
   emergencies, and the next push runs it anyway.
5. **Learn** — every bug adds the test that would have caught it, in the same
   pull request. One line recorded on where it was caught.

**Evidence, not impressions.** A claim that something works carries the command
and its output. "It looked fine" is never evidence.

---

## 3. What must be updated, and when

Three things happen in the SAME pull request as the work, never afterwards:

1. **Added or changed a route** → it is in the route table, or the build fails.
2. **Fixed a bug** → the test that would have caught it ships with the fix.
3. **Changed a boundary** (new module, new rule, new dependency between parts)
   → the map in `CLAUDE.md` changes too.

### Living artifacts

| Artifact | Update when | Kept honest by |
| --- | --- | --- |
| Route table (`api/__tests__/routeAuth.nodetest.js` fixture) | Any new/changed route | Test fails if a route is missing |
| Rule-tests | Every bug found | Habit, visible in the fix's PR |
| `docs/BACKLOG.md` | Anything deferred or closed | Habit |
| `CLAUDE.md` map | New module/folder, new invariant, Guarded list changes | Partly tested (folders exist, routes listed); plus the per-batch read |
| `.env.example` | A new setting is read by code | Test: every `process.env.X` has an entry |
| `package.json` test globs | New test folder | Test: every `*.nodetest.js` is covered by a glob |
| `docs/PRODUCTION-READINESS-PLAN.md` progress table | A batch merges | Habit, per batch |

### Cadence

- **Per change:** the three rules above.
- **Per batch:** update the progress table; spend five minutes asking whether
  the `CLAUDE.md` map is still true; note where each defect was caught.
- **Per phase:** documentation sweep; remove dead code and retired rules.
- **On a timer, not by memory:** dependency scan (runs in the automatic checks);
  AI model identifiers — read them from the API response rather than keeping a
  list, because hand-kept lists rot silently (one already did).

### What should NOT become a document

- Which database changes have been applied — the migration runner records it.
- What the code does — the code says it. Documents hold decisions and
  boundaries: what there is exactly one of, what must never happen, which way
  dependencies run. Those change rarely, so they stay true.

### What to remove

- A rule that a test now enforces: delete the prose, keep the test.
- A backlog item that is done or overtaken: mark it, do not delete the history.
- A document nobody has read in a phase: delete it rather than maintain it.
- Any `CLAUDE.md` line that is no longer true: fix it the moment it is spotted.
  A stale map is worse than no map — it misleads every agent that reads it.

---

## 4. Standing rules

- Watch for bugs, slowness and duplication in every file worked in. Small and
  safe gets fixed now; bigger goes to `docs/BACKLOG.md` with a reason.
- `src/App.js` shrinks whenever it is touched. It never grows.
- No route's access widens without a rule-test covering it.
- Secrets never go into files, tests, or the automatic checks.
- Synthetic data only, until Batch 5 of the readiness plan is signed off.
- Anything irreversible or customer-facing: ask first.

---

## 5. Enforcement tooling — build status

These are what make the agreement real rather than remembered. Tracked as
PROC-1 to PROC-4 in `docs/BACKLOG.md`.

| # | Tool | Status |
| --- | --- | --- |
| 1 | `CLAUDE.md` rewritten as a true map of the system | Not built |
| 2 | Lint + covering tests run automatically after each edit | Not built |
| 3 | Rule-tests (route table first, then one per bug class) | Not built |
| 4 | Automatic checks on every pull request | Built (`.github/workflows/ci.yml`) |
| 5 | Those checks *blocking* a merge | Blocked — GitHub does not enforce rulesets on a private personal repo; the ruleset is saved and activates if the repo moves to an organization on Team |
| 6 | `.githooks/pre-push` backstop | Built — run `git config core.hooksPath .githooks` once per clone |

The merge block is the one piece the platform will not give us for free, so
treat the full suite before a pull request as compulsory anyway. The owner chose
to stay on the free plan for now (2026-09-18); revisit when the repo moves to an
organization.

---

## 6. Why this exists

Speed comes from deleting repetition — re-reading, re-deriving, re-checking by
eye what a test can check. It never comes from deleting checks. Anything that
trades safety for speed was considered and rejected.
