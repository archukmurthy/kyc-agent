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
- The **audit row is hers** and not to be actioned by us.
- **Retention is seven years**, hard-coded with a comment, nothing ever
  hard-deleted, and a backlog item to make it configurable later (UBO-RET-1).

Status as at 2026-09-22. Update this table in the same commit as the work, the
way `CLAUDE.md` is updated — a stale status here is worse than none.

| # | Row | Status | Where it stands |
| --- | --- | --- | --- |
| 1 | Authentication | **Done bar the owner's Clerk settings** | Clerk sign-in, server-side verification, trial gate, and a person nobody has added yet is now told so rather than shown a bare error. What remains is not code: password reset / MFA toggles in Clerk, and a production instance - blocked on the domain decision (GOLIVE-3). |
| 2 | Organisations and roles | **Done** (2026-09-22) | `/ubo-people`, `api/ubo-people.js`. Owner / admin / analyst enforced server-side; invitations by email claimed at first sign-in. The "customer role" is deliberately unbuilt. |
| 3 | Tenant isolation | **Half done** | The server half: every caller's company comes from our access list, never from the URL or the body. The data half needs UBO's tables to scope. |
| 4 | Database / persistence | **Hers** | `docs/ubo/SCHEMA-PROPOSAL.md` is a proposal only — nothing applied, five open questions. Seven rows wait on this. |
| 5 | Durable jobs | **Blocked** | The machinery could be built from the submission-queue shape, but the moment it needs a jobs table it stops. Guessing the shape wastes the work. |
| 6 | Evidence upload | **Hers** | Needs tables and a flow. |
| 7 | Questions | **Hers** | Needs tables and a flow. |
| 8 | Analyst review | **Hers** | Needs tables and a flow. |
| 9 | Policy mode | **Hers** | Needs tables and a flow. |
| 10 | Audit history | **Blocked by her instruction**, not by a dependency | She asked that this not be actioned. |
| 11 | Observability | **Done bar the alarm** (2026-09-22) | `lib/requestLog.js`: one structured line per failure with a request id the caller can quote, and nothing anybody typed. `GET /api/health` answers booleans only, 503 when the store is down. What remains is the owner's: somewhere for those lines to raise an alarm (GOLIVE-6). |
| 12 | Backups and recovery | **Blocked** | Nothing to restore until the tables exist. A backup nobody has restored is not a backup. |
| 13 | Retention | **The rule is done** (2026-09-22) | `lib/uboRetention.js`: seven years, hard-coded, with a test that fails if it is ever read from configuration. Records are stamped on write with the period they were made under. Enforcement over UBO case data follows the tables - and will not have to be remembered then (UBO-RET-1). |
| 14 | Provider controls | **Done** (2026-09-22) | Timeouts on every provider call, two daily ceilings (100 per account, 500 platform-wide) with alerts at 60% and 85%, keys server-side. Figures are arithmetic, not measurement — COST-1. |
| 15 | Security regression tests | **Done** (2026-09-22) | `api/__tests__/adversarial.nodetest.js` - 13 tests written from the attacker's side: taking another workspace, escalating a role, spending on an ended trial, forging an address for a fresh allowance, oversized and disguised uploads. Three of them found real defects rather than confirming good behaviour (UBO-3, UBO-4, SEC-1). |
| 16 | Admin and support basics | **Partly** (2026-09-22) | The people screen and the trial screen, which now shows research runs used per prospect and flags one about to run out. Inspecting a failed job, retrying it safely and seeing a submission queue all still need the jobs table. |

## The count

As at 2026-09-22: **five rows done** (2, 13's rule, 14, 15, and 11 and 1 bar a
setting the owner controls). **Three partly** (3, 13's enforcement, 16). **Eight
waiting**, of which seven wait on the schema and one waits on her instruction.

Everything buildable without the schema is now built. What is left on this list
is hers, or waits on her tables.

That reads thin and is not: rows 1 and 2 are the two rows that decide whether a
prospect can touch anything at all, and row 14 is the one that decides what a
bad week costs us.

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

## The one question that changes the count

*"Shall I define the UBO tables, or will you?"* If the answer is us, rows 3, 4,
5, 6 and 16 all become buildable at once. Nothing else on this page is worth as
much.
