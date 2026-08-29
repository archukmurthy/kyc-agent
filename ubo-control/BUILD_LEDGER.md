# UBO Control build ledger

| Field | Current state |
|---|---|
| Gate / sub-gate | Gate 2 / **G2.1 — OwnershipCase + Candidate Claims** |
| Branch | `codex/ubo-control-g2-1-case-claims` |
| Base commit | `5096f75f01e3b776117818da70bf75be26ca6fec` (PR #30 merge on `origin/main`) |
| Latest accepted PR | [#30 — UBO Control practitioner research hypotheses](https://github.com/archukmurthy/kyc-agent/pull/30), merged with merge commit `5096f75f01e3b776117818da70bf75be26ca6fec`; remote documentation branch deleted |
| Current PR | G2.1 implementation PR pending |
| Completed implementation | Pure immutable `OwnershipCase`; UBO-owned canonical entities; validated capability-result intake; deterministic candidate claims; explicit identity decisions; explicit claim-state adjudication history; structural graph-eligibility projection only |
| Scenario coverage | G2.1 materially exercises S01, S02, S05, S06, S07, S08, S09, S10, S14, S16, S17 and S19, including newly discovered, canonical, same-name and explicitly rejected identity cases |
| Public/product boundary | No `index.js` expansion; no provider, legacy UBO, Evidence Platform, onboarding, host database, migration, Vercel or persistence dependency |
| Outstanding implementation | PR review within G2.1. G2.2 graph construction/calculation remains unopened. |
| Tests / status | UBO 113/113 passed; 98.44% line / 93.25% branch coverage. Host 25 suites / 482 tests passed. Architecture 2/2 passed. Legacy UBO framework and recalculation smoke tests passed. Production build passed. `git diff --check` passed. |
| Active escalations | None. No conflict winner, evidence/temporal precedence, duplicate-interest, automatic identity, graph, calculation, policy sufficiency or public API doctrine was introduced. |
| Next approved step | Complete and report the G2.1 PR only; do not start G2.2. |

## Scope guard

G2.1 converts validated capability candidate facts into auditable UBO-owned case and claim records. It contains no graph construction/traversal, ownership or range arithmetic, threshold/control qualification, Policy Pack evaluation, requirement resolution, InformationNeed/gap/action generation, UBO/PSC/controller determination, SMO fallback, decision snapshot, onboarding projection, live provider or persistence behavior. G2.2 has not started.
