# UBO Control build ledger

| Field | Current state |
|---|---|
| Gate / sub-gate | Gate 1 / G1.1 — Product Foundation |
| Branch | `codex/ubo-control-g1-1` |
| Base commit | `a0f11283b108b79ff8648130658977ef821007f4` (`origin/main`) |
| PR | Pending |
| Completed implementation | Standalone root; public entry point; capability, candidate-fact, evidence, percentage, and identity contracts; Policy Pack validation/canonical hashing; explicit composition; governance and ADRs |
| Outstanding implementation | Complete final diff/commit/push sequence and prepare G1.1 acceptance report |
| Tests / status | G1.1: 29/29 passed; 98.73% line / 94.01% branch coverage. Host before and after: 25 suites / 482 tests passed. Legacy UBO framework and recalculation regressions passed. Production build passed. |
| Active escalations | None. Option B contract decisions approved by Control Room on 2026-08-28. |
| Next approved step | Complete and report G1.1 only; stop for Control Room acceptance before G1.2. |

## Scope guard

G1.1 contains no UK determination rules, ownership calculations, identity-matching algorithm, conflict adjudication, gap determination, onboarding integration, live provider, Evidence Platform integration, persistence, UI, or legacy refactor.
