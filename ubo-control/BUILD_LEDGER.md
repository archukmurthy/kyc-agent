# UBO Control build ledger

| Field | Current state |
|---|---|
| Gate / sub-gate | Gate 5.3 / **G5.3C — Customer Input Application Boundary: ACTIVE** |
| G5.3B | **KYB Onboarding Integration Diagnosis — ACCEPTED**; preserved at `docs/integration/kyb-onboarding-integration-diagnosis.md`. |
| KYB onboarding integration | **DEFERRED** until after UBO Control Lab validation. |
| Parallel-gate state | **Gate 4: PAUSED** pending Evidence prerequisites. When ready, Evidence integrates into the Lab before KYB onboarding. |
| Branch | `codex/ubo-control-g5-3c-customer-input-application` |
| Base commit | `2f4e967251d3d1ae433f0175d1ea0186a7fac54c` (accepted PR #43 merge on `origin/main`). |
| Latest accepted PR | [#43 — G5.3A adaptive customer journey UI](https://github.com/archukmurthy/kyc-agent/pull/43), merged normally as `2f4e967251d3d1ae433f0175d1ea0186a7fac54c`. |
| Current PR | Pending creation for G5.3C; do not merge without Control Room acceptance. |
| Versioning | Default `ubo-decision-application-v1` remains exactly `intake`, `applyDecisions`, `evaluate`. Explicit `ubo-decision-application-v2` adds `applyCustomerInput`. |
| Completed G5.3C implementation | Snapshot/plan-pinned customer-action validation; customer provenance; candidate relationship and identity-attribute facts; case-scoped natural-person registration; exact-ID identity resolution; confirmation/correction/negative-answer semantics; senior-management preparation; alternative provenance; external evidence handoff; explicit decision targets; separate evaluation. |
| Product architecture | `DecisionSnapshot + ResolutionPlan + ubo-customer-action-v1 → applyCustomerInput → sealed caseState → applyDecisions if required → evaluate → fresh DecisionSnapshot`. |
| Public/product boundary | No host, React, provider, persistence or Evidence dependency in the application operation. No graph/qualification/requirement/snapshot result is produced by customer input alone. |
| Scenario coverage | Foreign HoldCo before/after; multiple and same-name new owners; unique external ID; identity attribute; negative answer; confirmation; correction; selected alternative; senior-management candidate; evidence handoff; stale/unauthorized action; immutability, serialization and determinism. |
| Outstanding implementation | G5.3D UBO Control Lab; Gate 4 Artifact/Extraction integration when prerequisites are ready; later feature-flagged KYB onboarding integration. |
| Tests / status | G5.3C 14/14; standalone core 250/250; Journey/Planner/Graph 57/57; adaptive UI/renderer 46/46; Discovery integration 43/43; host 25 suites / 482 tests; production build and final diff check passed. |
| Active escalations | None. V2 versioning and deterministic identity rules are explicitly approved by the G5.3C Control Room instruction. |
| Next after G5.3C | **G5.3D UBO Control Lab**. Do not begin automatically. |

## Scope guard

G5.3C changes only the standalone UBO product contract, its data-only customer event correlation fields, tests and documentation. It does not modify `src/App.js`, current onboarding screens, host API routes, dossiers, host persistence, Evidence Platform, uploads or the future Lab.
