# Production Readiness - What We Fix Next, In Order

**Who this is for:** anyone on the team. No technical background needed.
**Last updated:** 17 September 2026.

**Where it comes from:** outside experts reviewed our platform and wrote a report (*Production & Investor Readiness Plan*, 4 September 2026) listing 34 things to fix. We went through our code and checked every one. We also found four more problems ourselves.

**How to read this:** every item below has three lines.
- **They said** - what the report asked for.
- **What it means** - the same thing in plain words, and where we stand today.
- **We will** - what we are going to do about it.

---

## 1. Where we stand

The report has two finish lines:
- **Finish line 1:** safe for a real customer's data. 23 items.
- **Finish line 2:** ready for an investor's technical reviewer. 11 items.

| | Done | Half done | Not started |
| --- | --- | --- | --- |
| Finish line 1 (real customer) | 4 | 10 | 9 |
| Finish line 2 (investor) | 0 | 3 | 8 |

**One rule until we get there:** demos use made-up companies and made-up people only. No real person's data goes into the system until Batch 5 below is signed off. This costs us nothing and removes most of the risk right away.

**The order:**

```
Batch 0  Lock the open doors                  a few days    ← start here
Batch 1  Proper logins                        1-2 weeks
Batch 2  Keep customers' data apart           1-2 weeks
Batch 3  Save things honestly                 2 weeks
Batch 4  Remember every decision              1-2 weeks
Batch 5  Protect people's personal details    2 weeks       ← real data allowed after this
Batch 6  Ready for an investor's reviewer     3-4 weeks     ← can run alongside 4 and 5
Always   Hunt for bugs and slowness           during every batch
```

---

## 2. Four problems we found ourselves

These came after the report was written, so they are not in it. We found them by reading our own code.

### H1 - One page hands out people's identity details with no login
- **What it is:** the reviewer page (`api/idv-match/reviewer.js`) asks "who are you?" and simply believes whatever name is typed into the web address. Then it unlocks and shows that person's identity details.
- **Why it matters:** anyone who knows the address can read real people's identity data. This is the most serious thing on this page.
- **We will:** require a real login, and take the person's identity from that login instead of from the address.

### H2 - Logging in as an admin gives back the password itself
- **What it is:** when an admin logs in, the system hands the browser the password back as the "pass" it keeps (`api/admin-auth.js`, lines 122 and 134).
- **Why it matters:** that pass never expires and cannot be cancelled. If it leaks from one person's computer, the only fix is changing the password for everybody.
- **We will:** hand back a temporary pass that expires and can be switched off for one person, and never send the password back.

### H3 - Pages that cost money, or show data, are open to anyone
- **What it is:** these have no login and no usage limit: the paid lookup pages (`nium/*`), `company-search`, `kyc-lookup`, the ownership lab pages, file upload and download, and the activity dashboard.
- **Why it matters:** a stranger can run up our bill with paid lookups, download our files, or look at every customer's activity.
- **We will:** put a login on each one and cap how many times it can be called in an hour.

### H4 - Any website can call our system
- **What it is:** our pages accept requests from any site on the internet (the setting is wide open everywhere).
- **Why it matters:** another website can quietly use a logged-in user's browser to call our system as if it were them.
- **We will:** keep a short list of our own web addresses and refuse everything else.

---

## Batch 0 - Lock the open doors *(a few days)* - **DONE 18 September 2026**

Small changes, big effect. This closes the four problems above and the easy half
of what the report asked for.

**What actually shipped, and one honest correction.** Seven routes that accepted
anyone are now closed, the wildcard CORS is gone from all 17 routes, uploads are
checked where they arrive, and every route with no credential is at least
rate-limited. A rule-test now holds all of it in place.

The correction: 0.2 said the document routes would get an owner check. They
cannot yet. Nothing records who owns an uploaded file until final submit
(readiness item 3.1), and the wizard has no login to check against until Batch 1
- the audit put authentication first for exactly this reason. So the document
routes got what is available today: real file validation, a rate limit, and a
route-table entry naming them as still open. **The document ownership check
lands in Batch 3, once uploads record an owner.**

### 0.1 Put a login on every page that handles customer data
- **They said:** *"Deny-by-default authentication on every non-public API route."* (item 1.1)
- **What it means:** every page should refuse anyone who is not logged in, unless it is meant to be public. Today the customer dossier pages do check, but the ones in H1 and H3 do not.
- **We will:** add the check to every page that is missing it, list all our pages in one table saying who may use each, and add an automatic test that fails if someone adds a new page without deciding.

### 0.2 Only the owner can open a file
- **They said:** *"The private document proxy must check ownership, not just possession of a URL."* (item 1.5)
- **What it means:** right now, anyone holding a file's web address can download it. The system never asks whether the file belongs to them.
- **We will:** check that the person asking owns the case the file belongs to, and refuse them otherwise.

### 0.3 Check uploaded files
- **They said:** *"File-upload validation: type, size, and content checks."* (item 5.1)
- **What it means:** we check the file type and size in the browser, but the browser is easy to bypass. The server that actually receives the file checks nothing.
- **We will:** check type, size and real contents on the server, and refuse anything odd.

### 0.4 Limit how often costly pages can be called
- **They said:** *"Rate-limit paid, email, and upload routes."* (part of item 1.4)
- **What it means:** we already limit the five AI pages. Invite emails, uploads, downloads and the paid lookups have no limit at all.
- **We will:** use the same limiter we already have on those pages too.

### 0.5 Only allow requests from our own website
- **They said:** *"Restrict production origins (CORS)."* (part of item 1.4)
- **What it means:** this is H4 above.
- **We will:** set the allowed list once in a shared file so every page gets it automatically.

### 0.6 The activity dashboard shows one customer at a time
- **They said:** *"Tenant-scope the change-events model and the metrics endpoint."* (item 3.3)
- **What it means:** the dashboard today shows activity from every customer mixed together, and needs no login.
- **We will:** require an admin login and show only that customer's own activity.

---

## Batch 1 - Proper logins *(1-2 weeks)*

Everything else rests on the system knowing who is calling and which customer they work for.

### 1.1 Store passwords the proper way
- **They said:** *"Proper hashing (bcrypt/argon2)."* (item 1.3)
- **What it means:** we scramble passwords with something we wrote ourselves. It is weak, and a copy of our database would let someone work the passwords back out.
- **We will:** use one of the standard, purpose-built methods so the stored value cannot be reversed.

### 1.2 Give out passes that expire and can be cancelled
- **They said:** *"Real expiring/revocable session tokens; never return the password as a token."* (item 1.3)
- **What it means:** this is H2 above. A pass should behave like a hotel key card, not like handing out the master key.
- **We will:** issue a pass that times out on its own and can be cancelled for one person without affecting anyone else.

### 1.3 Stop password guessing, remove example passwords
- **They said:** *"Rate-limit login, remove guessable example defaults."* (item 1.3)
- **What it means:** someone can try passwords as fast as they like, and our sample settings file ships with easy-to-guess ones.
- **We will:** slow down repeated attempts and take the examples out.

### 1.4 Work out the customer from the login, not the web address
- **They said:** *"Derive tenant from the authenticated identity, never from query string, header, or body."* (item 1.2)
- **What it means:** today the system decides which customer you are working on by reading `?tenant=` in the address. Change that word and you are somewhere else. Customer links are safe because they are signed, but staff logins are not.
- **We will:** attach the customer to the login itself, so editing the address changes nothing.

### 1.5 One password per customer, not one shared password
- **They said:** covered by item 1.2, and already on our backlog as PREB-3.
- **What it means:** every pre-boarding analyst shares one password that works for every customer.
- **We will:** give each customer their own, so one leak affects one customer.

### 1.6 Change every secret, and write down how
- **They said:** *"Rotate all credentials."* (part of item 1.4)
- **What it means:** our secrets have been in chat logs, screens and files during building. We should assume they are no longer secret.
- **We will:** change them all once this batch is live, and write a short page on how to change each one again.

---

## Batch 2 - Keep customers' data apart *(1-2 weeks)*

### 2.1 Label every table with the customer it belongs to
- **They said:** *"Tenant foreign keys on all main tables."* (item 3.1)
- **What it means:** some tables do not record which customer a row belongs to, so nothing can separate them. The activity table, the research cache and all the identity tables are like this.
- **We will:** add the customer label to those tables and fill it in for existing rows.

### 2.2 Let the database enforce separation itself
- **They said:** *"Database row-level security, so isolation does not depend on application code alone."* (item 3.1)
- **What it means:** today separation depends entirely on our code getting it right every time. One bug and one customer sees another's data. The database can enforce it as a second wall, and ours is not turned on.
- **We will:** turn it on, then prove it by asking the database directly as one customer and getting nothing back that belongs to another.

### 2.3 Stop the test tool writing under one hard-coded customer
- **They said:** *"Stop benchmark writes from landing in a hard-coded tenant."* (item 3.3)
- **What it means:** our internal benchmark tool writes all its rows under one customer's name, whoever actually ran it.
- **We will:** make it record the real customer.

### 2.4 Make the research cache notice when settings change
- **They said:** *"Include server-computed prompt/config hash in the cache key."* (item 3.2)
- **What it means:** we save AI research answers for 30 days to save money. If someone changes that customer's settings, we still serve the old answer for up to 30 days.
- **We will:** include the settings version in what identifies a saved answer, so a settings change produces a fresh one.

### 2.5 Require a login before anything is saved into the shared cache
- **They said:** *"Prevent unauthenticated callers from writing cache entries."* (item 3.2)
- **What it means:** anyone can currently trigger a saved answer that other people then read.
- **We will:** require a login first.

---

## Batch 3 - Save things honestly *(2 weeks)*

### 3.1 Record a file the moment it is uploaded
- **They said:** *"Upload bytes to storage and record an owner/case row at the moment of upload, not at final submit; store content hashes."* (item 2.3)
- **What it means:** an uploaded file is stored, but nothing is written down about it until the very end. If someone abandons halfway, the file sits there with no record of whose it is.
- **We will:** write the record at upload time, with the owner, the case, and a fingerprint of the contents so we can tell if it changed.

### 3.2 One case number for the whole journey
- **They said:** *"One tenant-scoped canonical case ID spanning dossier, session, journey, documents, change events, and final outcome."* (item 2.1)
- **What it means:** journeys that start from a dossier are fine. Journeys without one create two different numbers that never meet, so the record of what changed cannot be joined to the final submission.
- **We will:** use one number throughout, and test that it links every table for one onboarding.

### 3.3 Put the missing database structure into our code repository
- **They said:** *"Put the full database schema under version control; base tables are currently missing from the repo."* (item 2.5)
- **What it means:** several important tables exist only on the live server. Nobody can rebuild the database from our code, and nobody can see their history.
- **We will:** add the missing definitions so a fresh copy of the code can build the whole thing from scratch.

### 3.4 Build a proper database update runner
- **They said:** *"Make the migration runner apply all migrations in order with tracking; fail loudly on drift."* (item 2.5)
- **What it means:** database changes are applied by hand, one file at a time, with nothing recording what was applied. Forgetting one is easy and silent.
- **We will:** build a runner that applies changes in order, records what it did, is safe to run twice, and complains loudly if the live database does not match.

### 3.5 Refuse to start without proper storage
- **They said:** *"Replace the ephemeral filesystem fallback; fail loudly if it would be used in production."* (item 5.4)
- **What it means:** if the durable store is not set up, the system quietly falls back to a temporary file that is wiped whenever the server restarts. Settings and counters vanish and nobody is told.
- **We will:** refuse to start in production, with a clear message, instead of pretending it is fine.

---

## Batch 4 - Remember every decision *(1-2 weeks)*

### 4.1 Write down every decision permanently
- **They said:** *"Immutable decision record for every material outcome: evidence seen, policy version, configuration, model and prompt version, tool calls, human actions and overrides, final decision, actor, timestamps."* (item 4.1)
- **What it means:** if a regulator asks in two years why we approved someone, we cannot answer. We keep a good record for identity matching only, and nothing for the real approve, decline or risk decisions.
- **We will:** write one permanent record per outcome holding all of the above, and prove it by picking an old case and rebuilding its whole story from the database alone.

### 4.2 Start using the decision tables we already built
- **They said:** *"Activate the existing but unused decision tables with real write paths; record a decision actor."* (item 4.2)
- **What it means:** four tables were created for decisions, risk ratings, screening results and deletions. Nothing has ever written to them.
- **We will:** connect them and always record who decided.

### 4.3 Save what we asked the AI, and fix the wrong model name
- **They said:** *"Persist AI request/prompt/tool traces and model versions case-linked; correct the retired model identifier."* (item 4.3)
- **What it means:** we store which AI model produced each field, but the name we store is wrong: the code says one model (`src/utils/costs.js`) while the real calls use another. We also keep no copy of the question we asked.
- **We will:** save the question and answer against the case, and record the model the system really used.

### 4.4 Never edit a decision afterwards
- **They said:** *"Immutable... supersession chain."* (item 4.1)
- **What it means:** a decision record that can be edited afterwards proves nothing.
- **We will:** make corrections add a new record pointing back at the old one, and refuse edits.

---

## Batch 5 - Protect people's personal details *(2 weeks)*

**This is the gate. Once this is signed off, real customer data may enter the system.**

### 5.1 Encrypt personal details in the database
- **They said:** *"Encrypt personal-data fields on the live path (directors, UBOs, applicants, ID documents)."* (item 4.4)
- **What it means:** names, dates of birth and document details sit in plain readable text. Anyone with a copy of the database can read everything. We built proper encryption once, but only for the separate identity module.
- **We will:** apply the same approach to the main path, so looking straight at the table shows scrambled text.

### 5.2 Stop storing personal details in the browser
- **They said:** *"Stop writing PII to logs, localStorage and sessionStorage."* (item 4.4)
- **What it means:** the draft-saving feature writes the whole form, including directors and owners, into the browser's own storage in plain text. It stays there on a shared or stolen computer.
- **We will:** keep drafts on the server instead, then sweep the browser and our logs to confirm nothing personal is left.

### 5.3 Make deletion actually work everywhere
- **They said:** *"Retention, deletion, and legal-hold semantics across all stores - soft-delete with legal hold rather than hard delete."* (item 4.5)
- **What it means:** people have a legal right to ask us to delete their data, but we also have to keep records for a period. Right now we have neither properly: data is spread across the database, the file store and caches with no way to find every copy. A "legal hold" means we mark data as kept on purpose, for a stated reason, instead of wiping it.
- **We will:** build one deletion process across every place we store data, and prove it by deleting a test person and showing every copy is gone or held.

### 5.4 Settle the identity module question
- **They said:** *"Integrate the existing IDV module into the main application, or apply its patterns to the live path. Do not run two parallel implementations."* (item 4.6)
- **What it means:** we have a well-built identity module with encryption and deletion that is not connected to anything, sitting beside a weaker version that the app actually uses. Two versions means two places to fix every bug.
- **We will:** pick one - connect the strong one, or take its good parts and retire it - so only one path for personal data exists.

---

## Batch 6 - Ready for an investor's reviewer *(3-4 weeks, can run alongside Batch 4 and 5)*

None of these block a customer. All of them shape how an outside engineer judges us.

### 6.1 Check every change automatically before it merges
- **They said:** *"CI release gates: build, full test suite, lint, dependency scan, and migration check on every merge."* (item 6.3)
- **What it means:** we have good tests, but nothing forces them to run. A broken change can merge if someone forgets.
- **We will:** set up automatic checks so a failing test blocks the merge.

### 6.2 Fix the outdated libraries
- **They said:** *"Dependency triage; replace the spreadsheet library pinned to a version with a known high-severity vulnerability."* (item 6.1)
- **What it means:** 44 known security warnings in what we ship, 2 critical and 21 high. The spreadsheet library has no fixed version available, so it must be swapped by hand.
- **We will:** replace that one, and go through the rest deciding "fix" or "does not affect us, and here is why".

### 6.3 Finish the half-decided change rules
- **They said:** *"Close the undecided change-classification combinations exposed by the completeness test; bring that test into the CI gate."* (item 6.4)
- **What it means:** we have a test that lists every possible kind of change and checks we have decided what to do about each. 390 are still undecided, and the test does not run with the others.
- **We will:** decide the remaining ones and add the test to the automatic checks.

### 6.4 Notice when something breaks
- **They said:** *"Observability: structured logging, error monitoring, alerting, health checks."* (item 6.6)
- **What it means:** if the platform breaks at 2am, nothing tells us. We find out when a customer complains.
- **We will:** add error alerts and a health page, and test it by breaking something on purpose.

### 6.5 Practise restoring from backup
- **They said:** *"Witnessed backup restore drill with documented recovery procedure, RTO/RPO, and evidence."* (item 6.5)
- **What it means:** a backup nobody has ever restored is not a backup. We have never tried.
- **We will:** restore onto a throwaway environment while someone watches, and write down the steps and how long it took.

### 6.6 Fix the documentation
- **They said:** *"Developer guides currently describe a much smaller application."* (item 6.7)
- **What it means:** our main guide still says the app is one file with no tests. It is now over 660 files with several test suites. There is no README at all. A new engineer would be lost.
- **We will:** rewrite it so someone new can set up and find their way from the docs alone.

### 6.7 Move off the retired build tool
- **They said:** *"Retire the deprecated build toolchain (Create React App)."* (item 6.2)
- **What it means:** the tool that packages our app was discontinued. It gets no security fixes, and reviewers spot it immediately.
- **We will:** move to a maintained one and check the app still builds and runs.

### 6.8 Write the four business documents
- **They said:** items 6.8, 6.9 and 6.10 - supplier register, AI-provider backup plan, cost per onboarding, and the evidence pack for reviewers.
- **What it means:** an investor's reviewer will ask what happens if our AI provider goes down, what each onboarding costs us, and to see our security and data documents. We have none of these written.
- **We will:** write all four and keep them current.

### 6.9 Finish the cleanup that never landed
- **They said:** the report lists this as done and waiting to merge.
- **What it means:** the old third-party lookup and its branding are still in the main code. The cleanup must be sitting on a branch that was never merged.
- **We will:** find that branch, finish it, and merge it.

---

## Always on - hunting bugs and slowness

This is not a separate phase. It happens inside every batch.

**The rule:** whenever we work in a file, we note anything broken, slow or duplicated. Small and safe gets fixed then and there. Anything bigger goes into `docs/BACKLOG.md` with a one-line reason. Nothing gets quietly dropped.

**What we already suspect is worth a look:**

| What | Why we suspect it | When we look |
| --- | --- | --- |
| The main app file | 5,600 lines in one file. Slow to change and easy to break. New work already goes elsewhere; the rest comes apart as we touch it. | Ongoing |
| Database speed | Nobody has ever checked whether our common lookups are using the right shortcuts. | Batch 2, while we are in those tables |
| Page download size | Nobody has measured what a customer's browser downloads. The spreadsheet library alone is big. | Batch 6, with the build-tool move |
| Repeated database calls | Submitting writes to 11 tables. Worth checking none of that is running in a loop. | Batch 3 |
| Research cache | It works, but we do not track how often it saves us a paid call. A simple counter tells us what we really spend. | Batch 2 |
| Draft saving | Worth checking it is not writing to storage on every keystroke. | Batch 5, while we take personal data out of it |

**Every batch reports:** tests passing before and after, anything that got faster or slower, and anything new added to the backlog.

---

## What we are deliberately leaving for later

These wait until a named customer or investor actually asks: handling large volumes with queues, a second AI provider for when the first goes down, where data is hosted, formal certifications like SOC 2, two-step login, and regular access reviews. Building them now would be guessing.

---

## Progress

| Batch | Status | Merged |
| --- | --- | --- |
| 0 - Lock the open doors | Done, except the document owner check (moved to Batch 3, needs 3.1) | PR #14 |
| 1 - Proper logins | Not started | - |
| 2 - Keep customers' data apart | Not started | - |
| 3 - Save things honestly | Not started | - |
| 4 - Remember every decision | Not started | - |
| 5 - Protect personal details | Not started | - |
| 6 - Investor readiness | Not started | - |
