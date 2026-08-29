# UBO Control build ledger

| Field | Current state |
|---|---|
| Gate / sub-gate | Gate 2 / **G2.4C — Decision History & Reconstruction** |
| Branch | `codex/ubo-control-g2-4c-decision-history` |
| Base commit | `a6c7d147ff23c758681491c9e5053ad058217111` (PR #35 normal merge on `origin/main`) |
| Latest accepted PR | [#35 — UBO Control G2.4B resolution orchestration](https://github.com/archukmurthy/kyc-agent/pull/35), merged normally with merge commit `a6c7d147ff23c758681491c9e5053ad058217111`; remote G2.4B branch deleted |
| Current PR | [#36 — UBO Control G2.4C decision history](https://github.com/archukmurthy/kyc-agent/pull/36) — do not merge without Control Room acceptance |
| Completed implementation | Immutable `ubo-decision-snapshot-v1`; canonical decision-content hash with recording metadata excluded; complete normalized reasoning/output manifest; append-only linear history with typed stale-head rejection; policy/algorithm/checkpoint pinning; offline verification and historical reconstruction; explicit pure Gate 2 checkpoint re-resolution coordinator; R10 measures-taken snapshot manifest |
| Scenario coverage | G2.4C covers resolved, partial/open need, internal review, SMO fallback, specialist and conflict reconstruction; customer-fact and analyst-review successors; historical policy/algorithm change; hash-critical material changes; mixed-artifact rejection; CASE_OPEN/SESSION_START/SUBMIT_GATE/CASE_EVENT behavior and end-to-end offline determinism |
| Public/product boundary | No `index.js` expansion; no provider, legacy UBO, Evidence Platform, onboarding, host database, migration, Vercel or persistence dependency |
| Outstanding implementation | Final G2.4C verification and PR review. Persistence, provider integration, automatic checkpoint scheduling, host risk mutation, case-management/onboarding UI and all Gate 3+ integrations remain later work. |
| Tests / status | Focused G2.4C 14/14 passed. Full UBO 225/225 passed with 98.34% line / 89.08% branch / 97.41% function coverage. Host 25 suites / 482 tests passed. Architecture 2/2 passed. Legacy UBO framework and recalculation smokes passed. Production build passed. `git diff --check` passed. |
| Active escalations | None. G2.4C required no public API, persistence/history branching, retroactive policy reinterpretation, legacy event-code meaning, new Policy Pack semantic, provider execution or host identity ownership decision. |
| Next approved step | Complete verification, open and report the dedicated G2.4C PR only; do not merge it and do not begin Gate 3. |

## Scope guard

G2.4C freezes the complete pure Gate 2 result at explicit host-neutral checkpoints, verifies it, appends it to a linear immutable history and reconstructs the historical decision without re-running evidence acquisition or applying current policy/code silently. The implementation contains no UI, assignment, messaging, provider execution, regulatory submission, authoritative host-risk mutation, persistence, automatic scheduler, public API expansion or Gate 3 integration.
