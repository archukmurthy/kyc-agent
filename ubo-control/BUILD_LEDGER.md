# UBO Control build ledger

| Field | Current state |
|---|---|
| Gate / sub-gate | Gate 5.1 / **G5.1B — Interactive Ownership Renderer** |
| Parallel-gate state | **Gate 4: PAUSED — Evidence Platform prerequisite programme in progress. Gate 5.1: APPROVED FOR PARALLEL EXECUTION.** The renderer consumes only the accepted G5.1A projection and is independent of live Extraction. |
| Branch | `codex/ubo-control-g5-1b-interactive-ownership-renderer` |
| Base commit | `ab3fd66a73cc21c8a8166f6746ac70f7b960b31a` (normal merge of accepted PR #39 into latest `origin/main`) |
| Latest accepted PR | [#39 — G5.1A ownership graph projection](https://github.com/archukmurthy/kyc-agent/pull/39), merged normally as `ab3fd66a73cc21c8a8166f6746ac70f7b960b31a`; source branch deleted. |
| Current PR | Not yet opened. This branch must remain unmerged until Control Room acceptance. |
| Completed implementation | Separate React `ubo-control-ui/` package; strict `ubo-ownership-graph-projection-v1` input; deterministic top-down SVG layout; semantic nodes/edges/badges; recorded calculation and qualification explanations; unresolved/conflict/review/support detail; path highlighting; pan/zoom/fit; keyboard and screen-reader support; responsive customer/explain views; offline standalone demo and browser acceptance evidence. |
| Scenario coverage | UI01 direct owner, UI02 multilayer `80% × 50% = 40%`, UI03 multiple paths, UI04 range endpoints, UI05 economic/voting, UI06 appointment control, UI07 partial live-style economic/voting/control candidates plus unknown foreign branch/currentness and no qualifying person, UI08 conflict, UI09 trust, UI10 SMO fallback, UI11 NO_DATA-style state and UI12 explicit before/after projection replacement. Fixtures are generated through public Decision Application + projection operations. |
| Public/product boundary | `DecisionSnapshot → OwnershipGraphProjection → optional renderer / host / API consumer`. The core never imports UI. The renderer validates, lays out and navigates recorded projection data; it does not construct claims/graphs, calculate interests, apply policy, resolve requirements, choose conflicts, infer qualifications or call a provider. |
| Outstanding implementation | Host-screen integration and historical comparison/diff remain future work. G5.1B awaits Control Room acceptance. Gate 4 remains paused on Evidence Platform prerequisites. |
| Tests / status | Renderer 22/22 passed with `OwnershipGraph.js` at 95.01% line / 72.80% branch / 87.16% function coverage; projection 15/15 passed; standalone UBO 248/248 passed (233 core + 15 projection); adapter/composition 43/43 passed; architecture 11/11 passed; host 25 suites / 482 tests passed; exact fixture regeneration, legacy framework/recalculation smokes, production build and `git diff --check` passed. Six browser acceptance screenshots recorded. |
| Active escalations | None. The Control Room explicitly approved the separate public projection operation and parallel Gate 5.1 execution. |
| Product requirement | [PR-VIS-001](docs/product/product-requirements.md) — `IN_IMPLEMENTATION — G5.1A ACCEPTED / G5.1B IN REVIEW`; do not mark implemented until renderer acceptance. |
| Next approved step | Open one G5.1B PR for Control Room review. Do not merge. |

## Scope guard

G5.1B renders only already-projected reasoning from a verified DecisionSnapshot. It does not recompute ownership, choose conflicting claims, evaluate policy, resolve requirements, retrieve evidence, add a document graph, reconstruct/compare history, or integrate an onboarding or analyst screen. Evidence Platform worktrees and branches remain untouched.
