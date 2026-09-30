# The sixteen P0 rows — what is done, what is not

Your partner's production-readiness list for the UBO module: sixteen rows, all
marked P0. This file exists because the list arrived as screenshots and lived
only in a conversation — so "which rows are done" was a thing only one person
could answer, and only until they forgot. That is the failure
`docs/HOW-WE-BUILD.md` names: a finding that exists only in a conversation or a
commit message.

**A caveat that matters:** the row titles below are our paraphrase, taken from
the discussion of her list, not her verbatim wording. The numbers are hers and
have been used consistently in every conversation since. If she sends the list
as text, replace these titles with hers rather than keeping ours.

**Her boundary, stated on 2026-09-21:** do not start schema work while she
finalises the flow. Her follow-up answers settled four things:

- UBO gets **its own tables**, separate from the platform's.
- UBO is **standalone** — *"just another microservice I should be able to call
  from my main code, otherwise there is no link"*. So no reference field
  pointing at platform data, in either direction.
- The **audit row was hers** and not to be actioned by us — **reversed 2026-09-24**: the Production Readiness Solution Guide puts an append-only audit event ledger in scope (section 19).
- **Retention is seven years**, hard-coded with a comment, nothing ever
  hard-deleted, and a backlog item to make it configurable later (UBO-RET-1).

Status as at 2026-09-30, after the partner's POC was merged and hardened (branch `ubo/integrate`). Update this table in the same commit as the work, the
way `CLAUDE.md` is updated — a stale status here is worse than none.

| # | Row | Status | Where it stands |
| --- | --- | --- | --- |
| 1 | Authentication | **Done bar the owner's Clerk settings** | Clerk sign-in and server-side verification for staff; customers come in through a signed, recipient-bound link proved by Clerk's emailed code. Left: email-code sign-in switched on, and a production instance - blocked on the domain (GOLIVE-3). |
| 2 | Organisations and roles | **Done** (2026-09-22) | `/ubo-people`, `api/ubo-people.js`. Owner / admin / analyst enforced server-side; a customer is a session on one case, never a role. |
| 3 | Tenant isolation | **Done** (2026-09-30) | Every UBO row and job is scoped to its workspace, a customer to one case; a trial purge proves no other workspace is touched before it deletes. |
| 4 | Database / persistence | **Partly** | Her tables (`021_ubo_poc_case_state.sql`, Evidence jobs) are merged, with a `tenants` table they needed. Left: creating them in the demo's database (UBO-19, UBO-39). |
| 5 | Durable jobs | **Done** (2026-09-30) | Chart-reading jobs are durable and resumable; failed and stuck ones are listed for support and retried safely, a retry counted as the upload it pays for (UBO-35). |
| 6 | Evidence upload | **Done** (2026-09-30) | Her flow; the server now decides from its own reading of each upload, made as evidence for that request. |
| 7 | Questions | **Done** (2026-09-30) | Her flow; the server raises the questions and checks every answer (UBO-13, four adversarial reviews). |
| 8 | Analyst review | **Done** (2026-09-30) | Her analyst view, and a finalised review reopened from it by the analyst only (UBO-29). |
| 9 | Policy mode | **Waiting on the partner** | A named rulebook and three calculation methods exist; what the row requires is not written anywhere (UBO-34). |
| 10 | Audit history | **Partly** | Case events and the calculation's own events are kept. Left: one append-only ledger (UBO-33). |
| 11 | Observability | **Done bar the alarm** (2026-09-22) | `lib/requestLog.js`, `GET /api/health`, and `api/ubo-poc-health.js` behind its own key. Left: somewhere for failures to raise an alarm (GOLIVE-6). |
| 12 | Backups and recovery | **Not started** | Needs the demo's database; then a restore actually proven (UBO-32). |
| 13 | Retention | **Partly** | The seven-year rule is stamped on every record; non-buyers' trial data is truly deleted 90 days after the trial (UBO-26). Left, deferred by the owner: deleting buyers' data after seven years (UBO-36). |
| 14 | Provider controls | **Done** | Timeouts and ceilings (2026-09-22); the public demo adds shared totals of 25 research runs and 25 chart uploads. |
| 15 | Security regression tests | **Done** | The attack suite, and for the UBO demo the server-authority and customer-link attacks - every review finding is a test. |
| 16 | Admin and support basics | **Done** (2026-09-30) | People and trial screens, "Mark as customer", and failed or stuck document readings seen and retried (UBO-35). |

## The count

As at 2026-09-30: **eleven rows done** (2, 3, 5, 6, 7, 8, 14, 15, 16, and 1 and 11 bar
a setting the owner controls). **Four partly** (4, 10, 13, and 9 waiting on the
partner's definition). **One not started** (12, which needs the demo's database).

As at 2026-09-22 it was five done, three partly and eight waiting.

What is left splits three ways: code we are building now (row 10 - UBO-33); things that need the demo's Vercel project and database
(rows 4 and 12 - UBO-39, UBO-19, UBO-32); and one row waiting on the partner's
definition (row 9 - UBO-34). Row 13's last part is deferred by the owner (UBO-36).

## What the attack suite found

Worth reading before anything else on this page, because it is the argument for
writing tests that attack rather than check. Three defects, none of which any
amount of reading had found:

- **UBO-3** - an expired trial could research forever. The end date was checked
  by a banner on the screen and by nothing on the server, and the research
  budget was never counted at all.
- **UBO-4** - the daily spend ceiling did not apply to trial users. The caller's
  workspace came from Clerk's organisation claim, and a trial user is in no
  Clerk organisation, so the ceiling skipped exactly the people it was built
  for.
- **SEC-1** - an anonymous caller could get a fresh rate-limit allowance per
  request by sending their own `x-forwarded-for`. Vercel overwrites it, so
  production was not exposed; nothing in the code said so.

All three are fixed, and recorded in `docs/BACKLOG.md`.

## The service boundary

`docs/ubo/SERVICE-BOUNDARY.md` writes down what the UBO module actually offers a
host system - the two things to construct, their operations, and the six things
the host must bring because the module deliberately has none of them. It carries
one open question for the product owner: in-process package, or a deployed
service with its own URL?

## What was worth doing before the schema arrived - all of it now done

Kept as a record of what was claimed and what was delivered, in the order it was
taken:

1. **Row 15 - the attack suite.** Written before her tables exist, so it is
   waiting to catch mistakes the day they land. It found three defects on the
   way in.
2. **Row 13 - the retention rule.** `lib/uboRetention.js`, with a test that
   fails if the period is ever made configurable by accident.
3. **The service boundary.** `docs/ubo/SERVICE-BOUNDARY.md`.
4. **Row 11 - observability.** `lib/requestLog.js` and `GET /api/health`.
5. **Row 1's leftover.** A person nobody has added yet is now told that, rather
   than being told they are the wrong role.
6. **UBO-2.** A rate-limited call showed "No completed result was returned";
   the lab now shows what the server actually said.

## The question that used to change the count

*"Shall I define the UBO tables, or will you?"* Answered by the merge: her tables
arrived with her POC (2026-09-29), and rows 3, 6 and 7 became done once her flow
was put behind our gates and the calculation moved to the server.
