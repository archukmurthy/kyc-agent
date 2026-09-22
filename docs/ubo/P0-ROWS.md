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
| 1 | Authentication | **Mostly done** | Clerk sign-in, server-side verification, trial gate. Remaining: the `no_access` screen (the server returns it; no screen reads it), password reset / MFA toggles in Clerk, and a production Clerk instance — blocked on the domain decision (GOLIVE-3). |
| 2 | Organisations and roles | **Done** (2026-09-22) | `/ubo-people`, `api/ubo-people.js`. Owner / admin / analyst enforced server-side; invitations by email claimed at first sign-in. The "customer role" is deliberately unbuilt. |
| 3 | Tenant isolation | **Half done** | The server half: every caller's company comes from our access list, never from the URL or the body. The data half needs UBO's tables to scope. |
| 4 | Database / persistence | **Hers** | `docs/ubo/SCHEMA-PROPOSAL.md` is a proposal only — nothing applied, five open questions. Seven rows wait on this. |
| 5 | Durable jobs | **Blocked** | The machinery could be built from the submission-queue shape, but the moment it needs a jobs table it stops. Guessing the shape wastes the work. |
| 6 | Evidence upload | **Hers** | Needs tables and a flow. |
| 7 | Questions | **Hers** | Needs tables and a flow. |
| 8 | Analyst review | **Hers** | Needs tables and a flow. |
| 9 | Policy mode | **Hers** | Needs tables and a flow. |
| 10 | Audit history | **Blocked by her instruction**, not by a dependency | She asked that this not be actioned. |
| 11 | Observability | **Not started** — buildable now | Structured logs with a request id, a health check, somewhere errors land. No schema (GOLIVE-6). |
| 12 | Backups and recovery | **Blocked** | Nothing to restore until the tables exist. A backup nobody has restored is not a backup. |
| 13 | Retention | **Not started** — buildable now | Her instruction is precise enough to implement: seven years, hard-coded with a comment, nothing hard-deleted. The policy and the rule land now; enforcement over UBO data follows the tables (UBO-RET-1). |
| 14 | Provider controls | **Done** (2026-09-22) | Timeouts on every provider call, two daily ceilings (100 per account, 500 platform-wide) with alerts at 60% and 85%, keys server-side. Figures are arithmetic, not measurement — COST-1. |
| 15 | Security regression tests | **Partly** — the rest is buildable now | Per-route refusal tests exist (`api/__tests__/routeTable.nodetest.js`, `unauthenticated-routes`, `ubo-people`). Missing: a suite that actively attacks — one person's workspace from another's session, an expired trial, upload abuse. |
| 16 | Admin and support basics | **Partly** | The people screen and the trial screen are the beginning. Inspecting a failed job, retrying it safely and seeing a submission queue all need the jobs table. |

## The count

**2 rows fully done** (2, 14). **5 partly** (1, 3, 15, 16, and 13 once the rule
lands). **9 waiting**, of which 7 wait on the schema and 1 waits on her
instruction.

That reads thin and is not: rows 1 and 2 are the two rows that decide whether a
prospect can touch anything at all, and row 14 is the one that decides what a
bad week costs us.

## What is still worth doing before the schema arrives

In the order we would take them:

1. **Row 15 — the attack suite.** Written now, it is waiting to catch mistakes
   the day her tables land. That timing is the whole argument.
2. **Row 13 — the retention rule.** Her instruction is specific; writing it down
   as code and a comment now means the tables inherit it rather than acquiring
   it later.
3. **The service boundary.** Her answer 4 defines UBO as a microservice her code
   calls. What that service exposes — operations, inputs, outputs — is design
   work with no schema in it, and it is what makes "call it from my main code"
   possible.
4. **Row 11 — observability.** So a failure at 9pm mid-evaluation reaches us
   rather than the prospect.
5. **Row 1's leftovers.** The `no_access` screen is the visible one: today a
   signed-in person nobody has added sees a bare error.
6. **UBO-2** — a rate-limited call already returns a readable message; the lab
   throws it away and shows "No completed result was returned".

## The one question that changes the count

*"Shall I define the UBO tables, or will you?"* If the answer is us, rows 3, 4,
5, 6 and 16 all become buildable at once. Nothing else on this page is worth as
much.
