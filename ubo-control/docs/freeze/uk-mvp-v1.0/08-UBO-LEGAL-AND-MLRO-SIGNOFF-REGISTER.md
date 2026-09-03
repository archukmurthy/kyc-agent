# 08 — UBO Legal and MLRO Sign-off Register

**Status:** CONTROL ROOM GOVERNANCE RECORD  
**Rule:** Nothing marked OPEN may silently enter production-approved policy or deterministic legal conclusions.

---

## Status vocabulary

- `OPEN`
- `RESEARCH_COMPLETE_SIGNOFF_PENDING`
- `APPROVED`
- `REJECTED`
- `DEFERRED`
- `WATCH`

---

# Register

| ID | Topic | Decision required | Default until signed | Suggested owner | Blocks |
|---|---|---|---|---|---|
| A-01 | Intermediate listed parent terminus | Whether an arbitrary listed intermediate may terminate look-through; qualifying market list/evidence | OFF | MLRO + legal | Optional branch-terminus feature |
| A-02 | Residual confirmation bundle | Final wording and whether separate negative statements can satisfy LOW/MEDIUM reasonable-measures policy | Does not close requirements automatically | MLRO + legal | Production customer bundle |
| A-03 | Declaration within registry band | When DECLARED_EXACT + INDEPENDENT_BAND_CORROBORATED is sufficient by risk tier | Corroborated, not exact verified | MLRO | Operational exact-value use |
| A-04 | Numeric control questions | Approved factual templates, respondent-authority rule and corroboration | Disabled except Lab | MLRO/compliance | Last-resort control collection |
| A-05 | Fund/GP ultimate management control | Evidence/criteria for limb (a) in fund/GP structures | Specialist review | Specialist legal/MLRO | PE/fund deterministic route |
| A-06 | LLP Schedule 1A / TDR | Exact Reg 5(2)(a) interplay with LLP modifications; joint-arrangement treatment among TDR holders | TDR conclusion provisional; specialist review | Specialist UK corporate/AML counsel + MLRO | LLP attribution and ASDA final outcome |
| A-07 | Current JMLSG listed subsidiary treatment | Exact current paragraph and evidence standard for majority-owned consolidated subsidiary | Do not auto-apply without evidence/signoff | MLRO/legal | Listed subsidiary rule |
| A-08 | SI 2026/621 delta memo | Clause-by-clause confirmation of Reg 5/28/30A impact | Baseline noted; production legal memo pending | Legal | Production legal baseline approval |
| A-09 | Company Schedule 1A mapping | Verify each condition and majority-chain mapping used by attribution-v1 | Implement behind review flag until approved | UK corporate/AML counsel + MLRO | Production attribution-v1 |
| A-10 | Exhaustion measure categories | Approve categories and EXECUTED/UNAVAILABLE/IRRELEVANT/DISPROPORTIONATE disposition model | Existing async fallback remains; no universal checklist | MLRO | Production fallback policy |
| A-11 | Policy approval metadata | Approver, effective date, release status for v1.6 | Lab only | Policy owner/MLRO | Any production use |
| A-12 | Companies House appoint/remove mapping | Whether source token conclusively establishes majority scope in each company/LLP context | Preserve source fact; review if scope uncertain | Compliance/legal | Automatic R05 qualification |
| A-13 | Joint arrangement wording/evidence | What facts establish a joint arrangement versus mere aligned interests | No inference; positive signal to review | Legal/MLRO | Joint attribution and closure |
| A-14 | Customer listed rule evidence | Evidence required to prove qualifying regulated market/disclosure obligations | Route only after explicit evidence | MLRO | Listed-customer treatment |
| A-15 | RegistryCapabilityProfile governance | Who approves access/entitlement/capability claims and refresh cadence | Planning profile cannot claim unverified entitlement | Ops/compliance | Predictive pivot production use |
| A-16 | Lifecycle event replacement | Map/recover E01/E02/E08/E10 to semantic events | Opaque events not production-active | Policy owner | Event-driven re-resolution |
| A-17 | Policy question content readiness | B2/B4 and remaining templates, including separate residual statements | Missing wording displayed as configuration block | MLRO/compliance/product | Applicant journey release |
| A-18 | Firm layer-holder collection | Written firm SOP, purpose, threshold, risk gating and downstream treatment | DEFERRED / disabled | Deploying firm's MLRO | Optional future firm policy |

---

# Sign-off evidence required

Each approval record should contain:

- sign-off ID;
- question decided;
- approved wording/rule;
- legal/guidance basis;
- approver identity/capacity;
- date;
- effective date;
- affected Policy Pack version;
- affected algorithm version;
- limitations/conditions;
- test cases approved;
- superseded decision, if any.

---

# A-02 proposed review questions

1. Can one customer screen contain separate negative statements for R06/R11/R12/joint arrangements?
2. At which risk tiers may those statements close their respective negative legs?
3. What contrary signals disable attestation?
4. Who may give the confirmation?
5. What as-at date/capacity must be recorded?
6. Which statements require documentary corroboration?

---

# A-03 proposed review questions

1. If customer says 80% and independent registry says 75–100%, may 80% be used as the operative exact value?
2. At LOW/MEDIUM/HIGH risk?
3. What source types qualify as independent band corroboration?
4. When must exact proof be obtained?
5. Does use differ for calculation versus verification?
6. What happens when declaration falls outside the band?

---

# A-06 proposed review questions

1. Confirm the exact LLP-modified PSC condition set.
2. Confirm majority-stake indirect attribution through LLP/company mixed chains.
3. Do three separate 25–50% voting holders imply no individual majority?
4. What evidence could establish a joint arrangement?
5. What evidence establishes ultimate management control over TDR Capital LLP?
6. Which result is deterministic versus analyst/specialist review?

---

# A-10 proposed review questions

1. Are the proposed measure categories complete enough?
2. May a category be IRRELEVANT/DISPROPORTIONATE, and what reason standard applies?
3. What minimum manifest must the reviewer see?
4. Who may approve exhaustion?
5. Is four-eyes approval required?
6. Which events invalidate a prior exhaustion decision?

---

# Release rules

A Policy Pack may become production-approved only when:

- A-08, A-09, A-10 and A-11 are APPROVED;
- any enabled optional feature's own sign-off is APPROVED;
- all customer actions reachable in production have approved content;
- unresolved sign-offs are either disabled or routed safely;
- runtime guard and characterization tests pass.

ASDA may remain usable in the Lab while A-06 is open, provided the TDR outcome is clearly marked provisional/review-required.
