# UBO Control build ledger

| Field | Current state |
|---|---|
| Gate / sub-gate | Gate 5.1 / **G5.1A — Ownership Graph Projection** |
| Parallel-gate state | **Gate 4: PAUSED — Evidence Platform prerequisite programme in progress. Gate 5.1: APPROVED FOR PARALLEL EXECUTION.** OwnershipGraphProjection depends only on completed Gate 2 DecisionSnapshot semantics and is independent of live Extraction. |
| Branch | `codex/ubo-control-g5-1a-ownership-graph-projection` |
| Base commit | `8f844b6bd4a4266bdac7850eb91ceae5edb45a53` (latest `origin/main` at branch creation) |
| Latest accepted PR | Gate 4.0 diagnosis is accepted; its clean local diagnosis branch contained no implementation and was removed after confirming it matched `origin/main`. Evidence prerequisite worktrees and branches remain untouched. |
| Current PR | [#39 — G5.1A ownership graph projection](https://github.com/archukmurthy/kyc-agent/pull/39) — open and unmerged; do not merge without Control Room acceptance. |
| Completed implementation | Public stateless `projectOwnershipGraph({ decisionSnapshot })`; explicit `ubo-ownership-graph-projection-v1` contract; verified-snapshot-only projection; typed stable errors; immutable deterministic data-only nodes, relationships, recorded calculations/paths, qualifications, unresolved needs, conflicts, reviews, snapshot identity and summary. |
| Scenario coverage | V01 direct economic, V02 multilayer, V03 multiple paths, V04 range endpoints, V05 voting separation, V06 appointment control, V07 unresolved foreign branch, V08 conflict, V09 trust, V10 internal review, V11 SMO fallback, V12 deterministic/legacy Discovery/future Extraction provider neutrality; explainability and JSON round-trip invariants. |
| Public/product boundary | `DecisionSnapshot → OwnershipGraphProjection → renderer / host / API consumer`. Projection never imports/re-runs claim adjudication, graph construction, percentage calculation, policy determination or requirement resolution. No legacy graph, host, provider, Evidence Platform, UI or renderer dependency enters the standalone product. |
| Outstanding implementation | G5.1B interactive renderer and later host integration. Historical comparison is not implemented. Gate 4 remains paused on Evidence Platform prerequisites. |
| Tests / status | Projection 15/15 passed with 86.55% line / 68.52% branch / 89.72% function coverage; standalone UBO 248/248 passed; adapter/composition 43/43 passed; architecture 7/7 passed; host 25 suites / 482 tests passed; legacy framework and recalculation smokes passed; production build passed; `git diff --check` passed. |
| Active escalations | None. The Control Room explicitly approved the separate public projection operation and parallel Gate 5.1 execution. |
| Product requirement | [PR-VIS-001](docs/product/product-requirements.md) — `IN_IMPLEMENTATION — G5.1A PROJECTION`; renderer remains outstanding. |
| Next approved step | Control Room review of PR #39 only. Do not merge and do not begin G5.1B. |

## Scope guard

G5.1A projects only already-recorded reasoning from a verified DecisionSnapshot. It does not recompute ownership, choose conflicting claims, evaluate policy, resolve requirements, retrieve evidence, add a document graph, compare history, or define presentation styling. G5.1B and all onboarding, analyst-screen and Evidence Platform integration remain outside this branch.
