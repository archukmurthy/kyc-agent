# UBO Control build ledger

| Field | Current state |
|---|---|
| Gate / sub-gate | Gate 5.2 / **G5.2A — Adaptive Journey Projection** |
| Parallel-gate state | **Gate 4: PAUSED — Evidence Platform prerequisite programme in progress. Gate 5.1: APPROVED FOR PARALLEL EXECUTION.** The renderer consumes only the accepted G5.1A projection and is independent of live Extraction. |
| Branch | `codex/ubo-control-g5-2a-journey-projection` |
| Base commit | `b3825447190c09738f594a48faba6597564a0ea3` (normal merge of accepted PR #40 into latest `origin/main`) |
| Latest accepted PR | [#40 — G5.1B interactive ownership renderer](https://github.com/archukmurthy/kyc-agent/pull/40), merged normally as `b3825447190c09738f594a48faba6597564a0ea3`; source branch deleted. |
| Current PR | [#41 — G5.2A adaptive UBO journey projection](https://github.com/archukmurthy/kyc-agent/pull/41) — open and unmerged; do not merge without Control Room acceptance. |
| Completed implementation | Separate public `projectUboJourney` operation; strict verified `ubo-decision-snapshot-v1` input; immutable `ubo-journey-projection-v1` output; semantic customer/system/internal work separation; stable coalesced work; partial R07 identity handoff; unranked ResolutionOptions; blocker, fallback and specialist handling; before/after natural work removal. |
| Scenario coverage | J01 resolved rich, J02 unresolved foreign chain, J03 missing identity attribute, J04 resolved voting suppression, J05 unresolved voting, J06 appointment control, J07 shared-fact coalescing, J08 one-artifact/many-needs, J09 operational failure, J10 fallback review, J11 preparatory senior management, J12 known senior management suppression, J13 specialist trust, J14 unresolved wording, J15 LLP semantics and J16 before/after work disappearance. |
| Public/product boundary | `DecisionSnapshot → projectOwnershipGraph` and `DecisionSnapshot → projectUboJourney` are sibling projections. Journey projection selects recorded semantics only; it never reruns capabilities, graph, calculation, policy determination or resolution orchestration and contains no host/UI identifiers. |
| Outstanding implementation | G5.2B resolution-option selection/priority, final host journey UX, host-screen integration and historical comparison/diff remain future work. Gate 4 remains paused on Evidence Platform prerequisites. |
| Tests / status | G5.2A 15/15 passed with `uboJourneyProjection.js` at 98.09% line / 72.41% branch / 90.91% function coverage; both public projection suites 30/30; standalone core 234/234; adapter/composition 43/43; renderer regression 22/22; architecture 11/11; host 25 suites / 482 tests; production build and `git diff --check` passed. |
| Active escalations | None. The Control Room explicitly approved the separate public projection operation and parallel Gate 5.1 execution. |
| Product requirement | [PR-JRN-001](docs/product/product-requirements.md) — `IN_IMPLEMENTATION — G5.2A IN REVIEW`; PR-VIS-001 is implemented after G5.1B acceptance. |
| Next approved step | Control Room review of PR #41 only. Do not merge and do not begin G5.2B or onboarding integration. |

## Scope guard

G5.2A projects only already-recorded reasoning from a verified DecisionSnapshot. It does not rank or select ResolutionOptions, recompute ownership, choose conflicting claims, evaluate policy, resolve requirements, retrieve evidence, add a document graph, reconstruct/compare history, or integrate an onboarding or analyst screen. Evidence Platform worktrees and branches remain untouched.
