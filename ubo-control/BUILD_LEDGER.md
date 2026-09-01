# UBO Control build ledger

| Field | Current state |
|---|---|
| Gate / sub-gate | Gate 5.3 / **G5.3D — UBO Control Lab: READY FOR CONTROL ROOM PRODUCT TESTING** |
| G5.3B | **KYB Onboarding Integration Diagnosis — ACCEPTED**; preserved at `docs/integration/kyb-onboarding-integration-diagnosis.md`. |
| KYB onboarding integration | **DEFERRED** until after UBO Control Lab validation. |
| Parallel-gate state | **Gate 4: PAUSED** pending Evidence prerequisites. When ready, Evidence integrates into the Lab before KYB onboarding. |
| Branch | `codex/ubo-control-g5-3d-control-lab` |
| Base commit | `312bb892d51a82563103875d118561114befc6e2` (accepted PR #44 merge on `origin/main`). |
| Latest accepted PR | [#44 — G5.3C customer input application boundary](https://github.com/archukmurthy/kyc-agent/pull/44), merged normally as `312bb892d51a82563103875d118561114befc6e2`. |
| Current PR | G5.3D standalone UBO Control Lab — open and unmerged after completion. |
| Versioning | Default `ubo-decision-application-v1` remains exactly `intake`, `applyDecisions`, `evaluate`. Explicit `ubo-decision-application-v2` adds `applyCustomerInput`. |
| Completed G5.3C implementation | Snapshot/plan-pinned customer-action validation; customer provenance; candidate relationship and identity-attribute facts; case-scoped natural-person registration; exact-ID identity resolution; confirmation/correction/negative-answer semantics; senior-management preparation; alternative provenance; external evidence handoff; explicit decision targets; separate evaluation. |
| Product architecture | `DecisionSnapshot + ResolutionPlan + ubo-customer-action-v1 → applyCustomerInput → sealed caseState → applyDecisions if required → evaluate → fresh DecisionSnapshot`. |
| Public/product boundary | No host, React, provider, persistence or Evidence dependency in the application operation. No graph/qualification/requirement/snapshot result is produced by customer input alone. |
| Scenario coverage | Foreign HoldCo before/after; multiple and same-name new owners; unique external ID; identity attribute; negative answer; confirmation; correction; selected alternative; senior-management candidate; evidence handoff; stale/unauthorized action; immutability, serialization and determinism. |
| G5.3D implementation | Standalone `/ubo-control-lab/`; Fixture and Live Discovery modes; disabled Live Evidence mode; shared Customer/Compliance/History views; R01–R14; decision consoles; candidate-source inspection; planner; feedback export; diagnostics; session-only sealed state. |
| Successor policy | UK Corporate `1.5-RC`, Policy Pack schema `1.2`, resolves `DISCLOSE_SHARE_OWNERSHIP` using Control Room successor content and a strict structured submission contract. Historical `1.4-RC` is unchanged. |
| Customer cycle | LAB18 runs a real foreign-HoldCo Snapshot A through `UboJourney` → `applyCustomerInput` → explicit claim adjudication → linked Snapshot B; no snapshot or alternate-field workaround. |
| Outstanding implementation | Gate 4 Artifact/Extraction integration when prerequisites are ready; later feature-flagged KYB onboarding integration after Lab product validation. |
| Active escalations | None. The G5.3D policy escalation was resolved by the Control Room decision dated 2026-09-01. |
| Next after G5.3D | **Control Room / compliance practitioner testing in the deployed UBO Control Lab.** Do not begin KYB onboarding integration. |

## Scope guard

G5.3D adds only the standalone Lab surface, its session-only API composition, the approved 1.5-RC successor Policy Pack and strict semantic customer-action validation. It does not modify `src/App.js`, current onboarding screens, dossiers, host persistence, Evidence Platform, uploads or database migrations.
