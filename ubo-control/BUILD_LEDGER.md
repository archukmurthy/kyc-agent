# UBO Control build ledger

| Field | Current state |
|---|---|
| Gate / sub-gate | Gate 1 / G1.2A — Policy Schema Hardening + Canonical UK Corporate Policy Pack |
| Branch | `codex/ubo-control-g1-2a` |
| Base commit | `95cb2df3a3f3256a4f99a47ae096492d17e081fb` (G1.1 merge on `origin/main`) |
| Prior accepted PR | [#27 — UBO Control G1.1 product foundation](https://github.com/archukmurthy/kyc-agent/pull/27), merged with merge commit `95cb2df3a3f3256a4f99a47ae096492d17e081fb`; remote G1.1 branch deleted |
| Current PR | [#28 — UBO Control G1.2A policy schema and UK pack](https://github.com/archukmurthy/kyc-agent/pull/28) |
| Completed implementation | Versioned Policy Pack schema and engine-semantic pins; safe `ubo-condition-v1` syntax validation; strict cross-reference validation; canonical UK Corporate 1.3-RC runtime artifact; semantic action IDs; explicit unresolved source references; 22-item assertion plan; architecture, ADR, mapping, and test governance |
| Outstanding implementation | None within approved G1.2A scope; awaiting Control Room review |
| Tests / status | G1.1 baseline on merged main: 29/29 passed. G1.2A: 45/45 passed; 98.13% line / 95.10% branch coverage. Host: 25 suites / 482 tests passed. Legacy UBO framework and recalculation regressions passed. Production build passed. |
| Active escalations | None. The supplied 1.3-RC Control Room source supersedes 1.2-RC and remains `CONTROL_ROOM_REVIEW`; unresolved B1/B2/B4 and E01/E02/E08/E10 references are preserved without invention. |
| Next approved step | Finalize and report G1.2A only; do not start G1.2B or Gate 2 reasoning. |

## Scope guard

G1.2A contains policy data and validation only. It adds no condition evaluation, UK determination engine, ownership calculation, identity-matching algorithm, conflict adjudication, gap determination, customer-action production, onboarding integration, live provider, Evidence Platform integration, persistence, database migration, UI, or legacy refactor.
