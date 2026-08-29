# UBO Control build ledger

| Field | Current state |
|---|---|
| Gate / sub-gate | Gate 2 / **G2.3 — Policy Determination** |
| Branch | `codex/ubo-control-g2-3-policy-determination` |
| Base commit | `3e47fce6db31e7dde15323f3133aa7424875a698` (PR #32 normal merge on `origin/main`) |
| Latest accepted PR | [#32 — UBO Control G2.2 canonical graph and deterministic calculation](https://github.com/archukmurthy/kyc-agent/pull/32), merged normally with merge commit `3e47fce6db31e7dde15323f3133aa7424875a698`; remote G2.2 branch deleted |
| Current PR | [#33 — UBO Control G2.3 policy determination](https://github.com/archukmurthy/kyc-agent/pull/33) — do not merge without Control Room acceptance |
| Completed implementation | Pure `ubo-condition-v1` three-valued evaluator; separate pack/requirement applicability; policy-hash-pinned `ubo-policy-determination-v1`; pack-owned exclusive threshold and exact interval interpretation; G2.2 calculation consumption; separate economic/voting/appointment/other-control bases; explicit ambiguity review; natural-person-only role projection with unresolved legal-entity preservation |
| Scenario coverage | G2.3 protects S01/S02-shaped COMPANY/LLP economics, R02 calculation consumption, R04 voting separation, S15 explicit COMPANY/LLP appointment-majority semantics, P02-style established significant control, S16 ambiguity, multiple-role grouping, legal-entity unresolved handling, and focused threshold/range/partial/no-path/applicability fixtures |
| Public/product boundary | No `index.js` expansion; no provider, legacy UBO, Evidence Platform, onboarding, host database, migration, Vercel or persistence dependency |
| Outstanding implementation | Verification and PR review within G2.3. Evidence sufficiency, final requirement resolution, InformationNeeds, gaps, actions, questions/documents/tasks, SMO fallback, discrepancy workflow, snapshots, providers, persistence and onboarding remain unopened G2.4/later work. |
| Tests / status | UBO 151/151 passed; 97.99% line / 91.27% branch / 98.33% function coverage. Host 25 suites / 482 tests passed. Architecture 2/2 passed. Legacy UBO framework and recalculation smoke tests passed. Production build passed. `git diff --check` passed. |
| Active escalations | None. G2.3 uses existing Policy Pack semantics and explicit graph qualifiers; it introduces no public API, new policy role, inferred appointment rule, negative inference from incomplete calculation, or G2.4 planning behavior. |
| Next approved step | Complete verification, open and report the dedicated G2.3 PR only; do not merge it and do not start G2.4. |

## Scope guard

G2.3 deterministically interprets the immutable G2.2 graph and supplied calculation results against the pinned Policy Pack. It may assess a policy basis and project pack-defined roles for canonical natural persons, but it does not resolve evidence sufficiency or produce a terminal workflow result. It contains no InformationNeed/gap/action/question/document/task generation, SMO fallback, discrepancy handling, decision snapshot, onboarding projection, live provider or persistence behavior. G2.4 has not started.
