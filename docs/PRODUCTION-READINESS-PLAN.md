# Production Readiness — What We Build Next, In Order

**Written for:** anyone on the team, technical or not.
**Last updated:** 17 September 2026.
**Where this came from:** the outside audit plan (*Production & Investor Readiness Plan*, 4 Sept 2026) checked item by item against the code as it stands today, plus problems we found ourselves while checking.

---

## 1. The short version

The audit plan lists 34 things to fix before we are safe for a real customer and ready for an investor's technical review. We checked all of them against our code.

| Group | Done | Half done | Not started |
| --- | --- | --- | --- |
| Before a real customer (23 items) | 4 | 10 | 9 |
| Before an investor review (11 items) | 0 | 3 | 8 |

We also found **four problems the audit did not list**, because they came in after it was written. Two of them are serious enough to fix this week.

**The rule that keeps us safe meanwhile:** until Batch 5 is finished, demos run on made-up companies and made-up people only. No real customer's data goes in. This costs nothing and removes most of the risk.

---

## 2. The holes we found ourselves

These are not in the audit document. We found them while checking the code.

| ID | Problem | Why it matters |
| --- | --- | --- |
| H1 | `api/idv-match/reviewer.js` has no login. It believes whatever user id the caller types into the web address, then hands back decrypted identity data. | Anyone who knows the address can read people's identity details. Worst item on this page. |
| H2 | The admin login hands back the password itself as the "pass" the browser keeps (`api/admin-auth.js:122,134`). | The pass never expires and cannot be cancelled. If it leaks, the only fix is changing the password for everyone. |
| H3 | Routes that cost money or show data have no login and no usage limit: `nium/*` (paid lookups), `company-search`, `kyc-lookup`, `ubo-control-lab`, `ubo-recalculate`, `get-document`, `upload-document`, `change-intelligence-metrics`. | A stranger can run up our bill, download files, or see every tenant's activity. |
| H4 | Every route accepts requests from any website (CORS is wide open). | Another site can call our routes using a signed-in user's browser. |

---

## 3. How the work is ordered

Seven batches. Each one ends with something we can prove works. Later batches assume the earlier ones are done.

```
Batch 0  Lock the open doors                 (days)      ← start here
Batch 1  Real logins and sessions            (1-2 weeks)
Batch 2  Keep tenants apart in the database  (1-2 weeks)
Batch 3  Honest saving                       (2 weeks)
Batch 4  Record every decision               (1-2 weeks)
Batch 5  Protect personal data               (2 weeks)    ← after this, real data is allowed
Batch 6  Ready for an investor's reviewer    (3-4 weeks)  ← can overlap Batch 4-5
Always   Bug and speed watch                 (every batch)
```

---

## Batch 0 — Lock the open doors

**Goal:** nobody outside the company can read data, download files, or spend our money.
**Covers:** H1, H3, H4, and parts of audit items 1.1, 1.4, 1.5, 5.1.

| # | What we do | How we prove it |
| --- | --- | --- |
| 0.1 | Put a login check on `api/idv-match/reviewer.js` and stop trusting the user id from the web address. | A call with no login gets refused. A test locks this in. |
| 0.2 | Put a login check on `get-document` and `upload-document`, and check the caller owns the file, not just that they know its address. | Someone else's file link returns "not allowed". |
| 0.3 | Put a login check plus a usage limit on the paid routes (`nium/*`, `company-search`, `kyc-lookup`) and the UBO lab routes. | No login means no charge; the limit shows up in tests. |
| 0.4 | Put an admin login check on `change-intelligence-metrics`, and only show that tenant's own events. | Tenant A's numbers contain nothing from Tenant B. |
| 0.5 | Replace "any website may call us" with a list of allowed addresses, set once in one shared file. | A call claiming to be from an unknown site is refused. |
| 0.6 | Check uploaded files on the server: type, size, and that the contents match the claimed type. | A 100MB file and a renamed program are both refused. |
| 0.7 | Add usage limits to the invite email route and the upload route. | Repeated calls get refused after the limit. |

**Also in this batch:** write down every route in one table (address, who may call it, what limit applies) and add a test that fails when a new route is added without a decision. This stops the same hole reappearing.

---

## Batch 1 — Real logins and sessions

**Goal:** the system knows who is calling, and which customer they belong to, from the login itself.
**Covers:** audit items 1.1, 1.2, 1.3, plus H2.

| # | What we do | How we prove it |
| --- | --- | --- |
| 1.1 | Store admin passwords properly (bcrypt or argon2), not the home-made scrambling we use now. | The stored value cannot be turned back into the password. |
| 1.2 | Hand the browser a real session pass that expires and can be cancelled. Never send the password back. | An old pass stops working; cancelling one logs that person out. |
| 1.3 | Slow down password guessing, and remove the example passwords from the sample settings file. | An automated guessing attempt is blocked after a few tries. |
| 1.4 | Work out which customer a caller belongs to from their login, not from the `?tenant=` part of the address. | A staff member of Customer A cannot reach Customer B's records by editing the address. |
| 1.5 | Give each tenant its own pre-boarding password instead of one shared one. | Customer A's password does not open Customer B. |
| 1.6 | Write down how to change every secret, and change them all once this batch lands. | The old secrets stop working. |

---

## Batch 2 — Keep tenants apart in the database

**Goal:** even if the app code has a bug, the database itself refuses to hand one customer another customer's rows.
**Covers:** audit items 3.1, 3.2, 3.3.

| # | What we do | How we prove it |
| --- | --- | --- |
| 2.1 | Add a customer column to the tables that lack one: `change_events`, `research_cache`, and all the `idv_*` tables. | Every main table has one, checked by a test. |
| 2.2 | Turn on the database's own per-customer rules (row-level security). | Asking the database directly as Customer A returns nothing belonging to Customer B. |
| 2.3 | Filter change events and the metrics screen by customer. | Already covered by 0.4; this makes it enforced by the database too. |
| 2.4 | Stop the benchmark tool writing everything under a hard-coded customer name (`lib/persist.js`). | Benchmark rows land under the customer that ran them. |
| 2.5 | Add the settings version to the research cache key, so a settings change doesn't serve stale answers for up to 30 days. | Changing settings produces a fresh answer, not the old one. |
| 2.6 | Require a login before anything can be written into the shared research cache. | An anonymous call cannot plant an answer for someone else to read. |

---

## Batch 3 — Honest saving

**Goal:** what the screen says happened is what actually happened, and nothing gets lost.
**Covers:** audit items 2.1, 2.3, 2.5, 5.4. (2.2 and 2.4 are already done.)

| # | What we do | How we prove it |
| --- | --- | --- |
| 3.1 | Record a file in the database the moment it is uploaded, with its owner, its case, and a fingerprint of its contents. Today nothing is recorded until final submit. | Abandoned journeys leave no untracked file; every stored file has a database row. |
| 3.2 | Use one case number across the whole journey. Today a journey without a dossier makes two separate ids that never meet. | One case number joins every table for one onboarding. |
| 3.3 | Put the missing table definitions into the repository. `tenants`, `onboarding_sessions`, `documents` and others exist only on the live server. | A fresh copy of the repo can build the whole database from scratch. |
| 3.4 | Build a proper migration runner: applies changes in order, records what it applied, and stops loudly if the live database has drifted. | Running it twice is safe; a missing change is reported, not ignored. |
| 3.5 | Refuse to start in production if the durable store (KV/Redis) is not configured, instead of quietly using a temporary file that vanishes. | Starting without it fails with a clear message. |

---

## Batch 4 — Record every decision

**Goal:** for any past case we can say what was decided, on what evidence, by whom, and why.
**Covers:** audit items 4.1, 4.2, 4.3.

| # | What we do | How we prove it |
| --- | --- | --- |
| 4.1 | Write a permanent record for every real outcome (approve, decline, refer, escalate, risk rating, screening result): the evidence seen, the rules version, the settings, the AI model and prompt version, any human override, who did it and when. | Pick an old case and rebuild the full story from the database alone. |
| 4.2 | Start actually using the four decision tables that exist but were never written to, and always record who decided. | Each table gets rows during a test onboarding. |
| 4.3 | Save the AI request and its answer against the case, and fix the wrong model name we currently stamp on records (`src/utils/costs.js:7` says `claude-sonnet-4-20250514`, the real calls use `claude-sonnet-4-5`). | Every AI-influenced record points at the exact request and the correct model. |
| 4.4 | Never change these records afterwards. A correction is a new record pointing at the old one. | An attempted edit is refused. |

---

## Batch 5 — Protect personal data

**Goal:** real people's details are encrypted, are not lying around in browsers or logs, and can be deleted on request.
**Covers:** audit items 4.4, 4.5, 4.6.
**This is the gate. When this batch is signed off, real customer data may enter the system.**

| # | What we do | How we prove it |
| --- | --- | --- |
| 5.1 | Encrypt personal details (directors, owners, applicants, ID documents) in the database. | Looking straight at the table shows scrambled text. |
| 5.2 | Stop saving personal details in the browser's storage. The draft feature currently writes the whole wizard, including directors and owners, in plain text. | A sweep of browser storage and our logs finds nothing personal. |
| 5.3 | Build deletion, retention and legal hold across all storage: database, KV, files, caches. Deleting means marking, not wiping, when a legal hold applies. | A deletion request removes or holds every copy of a test person, and we can show it. |
| 5.4 | Decide the identity module question: either plug in the stronger `idv/` module or retire it. Right now we ship it unused next to a weaker copy. | Only one path for personal data exists in the app. |

---

## Batch 6 — Ready for an investor's reviewer

**Goal:** an outside engineer opening the repository sees a maintained, tested, documented system.
**Covers:** audit items 6.1 to 6.11. Can start in parallel with Batch 4.

| # | What we do | How we prove it |
| --- | --- | --- |
| 6.1 | Add automatic checks on every merge: build, all tests, lint, dependency scan, migration check. We have none today. | A failing test blocks the merge. |
| 6.2 | Fix the 44 dependency warnings (2 critical, 21 high). The spreadsheet library has no safe version; it needs replacing by hand. | A clean report, or a written reason for each exception. |
| 6.3 | Bring the classification completeness test into the automatic checks and settle the 390 undecided combinations. | The test passes in the automatic checks. |
| 6.4 | Add logging, error alerts and a health check page. | A deliberately broken call raises an alert. |
| 6.5 | Practise restoring from backup on a throwaway environment and write down the steps and timings. | A witnessed restore, written up. |
| 6.6 | Refresh the documentation. `CLAUDE.md` still describes one file and "no tests"; the app is now 660+ files. There is no README. | A new engineer can set up and find their way from the docs alone. |
| 6.7 | Move off Create React App to a maintained build tool. | The build passes on the new tool. |
| 6.8 | Write the supplier list, the plan for relying on a single AI provider, the cost-per-onboarding model, and the evidence pack. | All four documents exist and are current. |
| 6.9 | Finish the Phase 0 cleanup that never reached the main branch: the old third-party lookup and its branding are still in the code. | No references remain. |

---

## Always on — bug and speed watch

Every batch includes this. It is not a separate phase.

**The rule:** while working in any file, note anything broken, slow, or duplicated. Small and safe gets fixed in the same change. Anything bigger goes in `docs/BACKLOG.md` with a one-line reason. Nothing gets silently dropped.

**Things already worth looking at:**

| Area | What we suspect | When to look |
| --- | --- | --- |
| `src/App.js` | 5,600 lines in one file. Slow to change, easy to break. New work already goes into separate files; the rest comes apart as we touch it. | Ongoing |
| Database speed | We have never checked whether the common lookups use indexes. | Batch 2, while touching the tables |
| Page weight | No one has measured what the browser downloads. The spreadsheet library alone is large. | Batch 6, with the build-tool move |
| Repeated database calls | Submit writes to 11 tables; worth checking none of it runs in a loop. | Batch 3 |
| Research cache | Works, but we do not track how often it hits. A cheap counter tells us what we are really spending. | Batch 2 |
| Draft saving | The wizard saves drafts to browser storage; worth checking it isn't writing on every keystroke. | Batch 5, while removing personal data from it |

**Each batch also reports:** tests passing before and after, anything that got faster or slower, and anything new added to the backlog.

---

## What we are not doing yet

These wait until a named customer or investor asks for them: queues and load handling, a second AI provider in case the first goes down, hosting and data-residency choices, SOC 2 / ISO 27001, multi-factor login, and access reviews.

---

## Progress

Nothing started yet. Each batch gets ticked off here with the date and the pull request number when it merges.

| Batch | Status | Merged |
| --- | --- | --- |
| 0 — Lock the open doors | Not started | — |
| 1 — Real logins and sessions | Not started | — |
| 2 — Keep tenants apart | Not started | — |
| 3 — Honest saving | Not started | — |
| 4 — Record every decision | Not started | — |
| 5 — Protect personal data | Not started | — |
| 6 — Investor readiness | Not started | — |
