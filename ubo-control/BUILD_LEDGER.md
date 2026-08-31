# UBO Control build ledger

| Field | Current state |
|---|---|
| Gate / sub-gate | Gate 5.2 / **G5.2B — Low-Friction Resolution Planning** |
| Parallel-gate state | **Gate 4: PAUSED — Evidence Platform prerequisite programme in progress. Gate 5.1: APPROVED FOR PARALLEL EXECUTION.** The renderer consumes only the accepted G5.1A projection and is independent of live Extraction. |
| Branch | `codex/ubo-control-g5-2b-low-friction-resolution-planner` |
| Base commit | `5105da3a28d6c47bf41e64db3a52f054960d6407` (normal merge of accepted PR #41 into latest `origin/main`) |
| Latest accepted PR | [#41 — G5.2A adaptive UBO journey projection](https://github.com/archukmurthy/kyc-agent/pull/41), merged normally as `5105da3a28d6c47bf41e64db3a52f054960d6407`; source branch deleted. |
| Current PR | G5.2B PR pending creation; do not merge without Control Room acceptance. |
| Completed implementation | Separate public `planUboResolution`; verified-snapshot-only `ubo-resolution-plan-v1`; pinned `ubo-low-friction-planner-v1`; semantic system/customer/internal/complete/blocked waves; attempt-aware system planning; CustomerResolutionBundles; targeted evidence and lightweight-response selection; deferred alternatives; specialist/terminal guards. |
| Scenario coverage | P01 complete, P02 Discovery, P03 held artifact, P04 joint system wave, P05 NO_DATA progression, P06 operational failure, P07 lightweight response, P08 targeted document, P09 information+document bundle, P10 shared need, P11 known/missing identity, P12 senior-management prep, P13 internal review, P14 specialist stop, P15 before/after and P16 no speculative controls; additional hold, analyst-option, terminal and PARTIAL coverage. |
| Public/product boundary | `DecisionSnapshot → JourneyProjection → planUboResolution → ResolutionPlan → host`. Planner selection is advisory product logic over permitted recorded options; it cannot execute capabilities, alter policy sufficiency, resolve requirements, mutate snapshots or prescribe UI. |
| Outstanding implementation | Runtime execution/wiring, final host journey UX, host-screen integration, configurable future planning profiles and historical comparison/diff remain future work. Gate 4 remains paused on Evidence Platform prerequisites. |
| Tests / status | G5.2B 27/27 passed with `uboResolutionPlanner.js` at 97.34% line / 81.96% branch / 92.41% function coverage; planner/journey/graph suites 57/57; standalone core 235/235; adapter/Discovery composition 43/43; renderer regression 22/22; architecture 13/13; host 25 suites / 482 tests; production build and `git diff --check` passed. |
| Active escalations | None. G5.2A is accepted; the Control Room approved G5.2B product planning and JH-006 v1 tier/wave doctrine only. |
| Product requirement | [PR-PLN-001](docs/product/product-requirements.md) — `IN_IMPLEMENTATION — G5.2B IN REVIEW`; PR-JRN-001 is implemented after G5.2A acceptance. |
| Next approved step | Complete G5.2B verification and open its own PR. Do not merge and do not begin runtime/onboarding integration. |

## Scope guard

G5.2B selects only already-permitted recorded ResolutionOptions from a verified DecisionSnapshot. It does not execute them, change policy sufficiency, resolve requirements, recompute ownership, choose conflicting claims, retrieve evidence, add a document graph, mutate/reconstruct history, or integrate an onboarding or analyst screen. Evidence Platform worktrees and branches remain untouched.
