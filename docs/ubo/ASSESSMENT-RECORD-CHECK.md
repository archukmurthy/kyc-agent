# What an assessment records - against the partner's sixteen (UBO-41)

The partner's list (2026-10-01) of what every UBO assessment must record,
checked against what the code records today. Read-only check, 2026-10-01; nothing
was changed. Where it lives: the case (`ubo_poc_cases`), the assessment's trace
and its version row (`ubo_poc_assessment_versions`).

| # | Must record | Today | Where / what is missing |
| --- | --- | --- | --- |
| 1 | Case ID / reference | **Yes** | `case_id`; each assessment has its own `assessment_id` |
| 2 | Target entity | **Yes** | the case's company (`legalName`) |
| 3 | Registration number | **Yes** | the company's `registrationNumber` |
| 4 | Jurisdiction whose rules apply | **Partly** | the company's `countryCode` (GB) is kept; the assessment does not say which jurisdiction's rules it applied - always UK, implicitly |
| 5 | Entity type | **Partly** | the company's `ownershipType` is on the case, not on the assessment |
| 6 | Assessment as-of date | **No** | only when it was calculated (`calculated_at`), not the date the ownership is assessed as of |
| 7 | Policy ID | **Partly** | recorded as `uk-ubo-discovery`, and person assessments carry another id - not one canonical family such as `UBO-UK-CORPORATE` |
| 8 | Policy version | **Partly** | `1.0`, not tied to the rulebook it implements (`ubo-control/policies/uk-corporate/1.6-rc`) |
| 9 | Policy mode | **No** | planned, on hold (UBO-34) |
| 10 | Policy hash | **No** | planned, on hold (UBO-34); the input state is hashed (`input_state_version`), the policy is not |
| 11 | Statutory threshold / comparator | **Partly** | recorded on each person's assessment, but the default is `>= 25`; the law is `> 25` (fix on hold with UBO-34) |
| 12 | Firm overlay threshold | **No** | planned, on hold (UBO-34) |
| 13 | Calculation method | **Yes** | the chart reference's `calculationMethod` (three methods) |
| 14 | Control discovery mode | **Yes** | `trace.policy.controlDiscoveryMode` (always ownership first, then control) |
| 15 | Evidence / graph snapshot reference | **Partly** | `evidence_references` (the chart's document and job, evidence documents) and the input-state hash; no graph version id |
| 16 | Status / outcome | **Yes** | journey state, each person's determination, who needs identity checks, finalised or not |

**Count: 6 yes, 6 partly, 4 no** - three of the four "no" (9, 10, 12) and one
"partly" (11) are the policy-mode work on hold.

## What would close it, after policy mode

- Rows 7, 8, 10 together: one policy identity on every assessment (the plan in
  `POLICY-MODE-PLAN.md` already covers this).
- Rows 4, 5: copy the jurisdiction and entity type onto the assessment record.
- Row 6: an "as of" date - by default the day of finalising; set by the analyst
  only if the partner wants back-dated assessments.
- Row 15: a graph version id alongside the evidence references.
