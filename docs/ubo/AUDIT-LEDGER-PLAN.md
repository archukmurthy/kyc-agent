# The UBO audit ledger (UBO-33)

P0 row 10. The Production Readiness Solution Guide, sections 19-21: the audit
page backed by an append-only event store, each event carrying who, what,
which case, a correlation id, what it relates to and a reason code, with event
time kept apart from receipt time.

## What is built

**One table, `ubo_audit_events`** (`db/migrations/029_ubo_audit_events.sql`,
in the UBO migration set):

| Column | What |
| --- | --- |
| `event_id` | the event |
| `tenant_id`, `case_id` | whose case |
| `actor_type`, `actor_id` | CUSTOMER, ANALYST or SYSTEM; the Clerk user id, never an email |
| `event_type` | from a fixed list (`ubo-control-lab/server/auditLedger.js`) |
| `occurred_at` | when it happened (an answer: when the customer gave it) |
| `received_at` | when the server received the request |
| `recorded_at` | when the row was written |
| `effective_at` | when it takes effect in the world, where the event says (a date answer) |
| `correlation_id` | one id for the whole request; the caller may send `x-correlation-id` |
| `operation_id` | the command's idempotency key |
| `related_assertion_id`, `related_artifact_id`, `related_assessment_id`, `related_question_id` | what it is about |
| `reason_code`, `detail` | why, and the small facts an auditor needs |
| `retain_until` | seven years (`lib/uboRetention.js`) |

**Append-only in the database, not by convention.** A trigger refuses every
UPDATE, DELETE and TRUNCATE with an error - except a DELETE in a transaction
that has set `ubo.audit_purge = 'on'`, which only the trial purge does,
because a non-buyer's trial is truly deleted (UBO-26). (A trigger, not rules:
`INSERT ... ON CONFLICT` is refused on a table with rules. The migration runner
now keeps a `$$`-quoted function body whole.)

**Written in the same transaction as the change it records** - the case
command's (`PostgresPocCaseRepository.apply`) - so a change and its audit row
stand or fall together. A replayed command records nothing twice (a dedupe
key per operation, event and subject).

**The events.** From the case commands: CASE_CREATED, CASE_COMPANY_CHANGED,
RESEARCH_RECORDED, OWNERSHIP_CHART_ATTACHED, QUESTION_ASKED,
CUSTOMER_ANSWER_RECEIVED, CUSTOMER_ANSWERS_RESET, EVIDENCE_RECEIVED,
UBO_ASSESSMENT_COMPLETED, IDV_COMPLETED, ANALYST_OVERRIDE (a reopen). From the
calculation's own history, mirrored as it appears: OWNERSHIP_CONTROL_ASSESSMENT_RECALCULATED,
IDV_REQUIREMENT_CREATED, IDV_REQUIREMENT_NO_LONGER_CURRENT,
AGGREGATE_OWNERSHIP_CHANGED, UBO_DETERMINATION_CHANGED,
SENIOR_MANAGEMENT_FALLBACK_ACTIVATED, FINAL_VERIFICATION_ASSESSMENT_CREATED.
From the document route: DOCUMENT_UPLOADED, DOCUMENT_EXTRACTED,
DOCUMENT_EXTRACTION_FAILED.

**Read** by staff only - `GET /api/ubo-poc-case?caseId=…&ledger=1` - and shown
on the analyst's Audit page.

## Not built, and why

- **RESEARCH_STARTED and provider calls** (section 21's chain through research
  and provider calls): research runs before a case exists and has its own
  persistence (`agents/ubo/uboPersistence.js`, UBO-18). The ledger starts at
  the case; the research's arrival is RESEARCH_RECORDED.
- **ANALYST_OVERRIDE of a fact**: there is no override step yet; the only
  analyst intervention is a reopen, recorded as ANALYST_OVERRIDE with reason
  CASE_REOPENED.
- **Assertion ids**: the case's facts carry no stable assertion id yet
  (section 21's shared identity). The column exists for when they do.
