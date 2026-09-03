# UBO Control build ledger

| Field | Current state |
|---|---|
| Gate / sub-gate | **UBO Control Freeze Implementation — Wave 1: Policy Schema 1.3 and Runtime Readiness Guard** |
| G5.3B | **KYB Onboarding Integration Diagnosis — ACCEPTED**; preserved at `docs/integration/kyb-onboarding-integration-diagnosis.md`. |
| KYB onboarding integration | **DEFERRED** until after UBO Control Lab validation. |
| Parallel-gate state | **Gate 4: PAUSED** pending Evidence prerequisites. When ready, Evidence integrates into the Lab before KYB onboarding. |
| Branch | `codex/ubo-control-freeze-w1-policy-readiness` |
| Base commit | `417a1e590ad39f8a555870b6462c8acabecef302` (accepted PR #45 normal merge on `origin/main`). |
| Latest accepted PR | [#45 — G5.3D UBO Control Lab](https://github.com/archukmurthy/kyc-agent/pull/45), merged normally as `417a1e590ad39f8a555870b6462c8acabecef302`. |
| Current PR | [#46 — Freeze Implementation Wave 1](https://github.com/archukmurthy/kyc-agent/pull/46) — open for Control Room review; do not merge automatically. |
| Versioning | Default `ubo-decision-application-v1` remains exactly `intake`, `applyDecisions`, `evaluate`. Explicit `ubo-decision-application-v2` adds `applyCustomerInput`. |
| Completed G5.3C implementation | Snapshot/plan-pinned customer-action validation; customer provenance; candidate relationship and identity-attribute facts; case-scoped natural-person registration; exact-ID identity resolution; confirmation/correction/negative-answer semantics; senior-management preparation; alternative provenance; external evidence handoff; explicit decision targets; separate evaluation. |
| Product architecture | `DecisionSnapshot + ResolutionPlan + ubo-customer-action-v1 → applyCustomerInput → sealed caseState → applyDecisions if required → evaluate → fresh DecisionSnapshot`. |
| Public/product boundary | No host, React, provider, persistence or Evidence dependency in the application operation. No graph/qualification/requirement/snapshot result is produced by customer input alone. |
| Scenario coverage | Foreign HoldCo before/after; multiple and same-name new owners; unique external ID; identity attribute; negative answer; confirmation; correction; selected alternative; senior-management candidate; evidence handoff; stale/unauthorized action; immutability, serialization and determinism. |
| G5.3D implementation | Standalone `/ubo-control-lab/`; Fixture and Live Discovery modes; disabled Live Evidence mode; shared Customer/Compliance/History views; R01–R14; decision consoles; candidate-source inspection; planner; feedback export; diagnostics; session-only sealed state. |
| Wave 1 implementation | Preserved Freeze Pack; additive strict schema 1.3 validator; machine-readable sign-off/readiness structures; public `ubo-policy-readiness-v1`; explicit LAB/PRODUCTION/HISTORICAL_RECONSTRUCTION modes; persistent Lab review watermark. |
| Successor policy | No UK Corporate 1.6-RC artifact is introduced. UK Corporate `1.5-RC` remains immutable schema `1.2` with canonical hash `sha256:724c2fa4820e02daddc24e652b50748646d87017cbfa632c062bc9e27de4b790`. |
| Customer cycle | LAB18 runs a real foreign-HoldCo Snapshot A through `UboJourney` → `applyCustomerInput` → explicit claim adjudication → linked Snapshot B; no snapshot or alternate-field workaround. |
| Outstanding implementation | All Wave 2 successor-policy doctrine and contracts, Gate 4 Artifact/Extraction integration, and later feature-flagged KYB onboarding integration remain outside this wave. |
| Active escalations | Source package did not supply a File 00; Wave 1 adds a metadata-only `00-FREEZE-PACK-MANIFEST.md` and preserves Files 01–09 plus the accepted impact map verbatim. No doctrine was invented. |
| Next | **Control Room review of the Wave 1 PR.** Do not begin Wave 2. |

## Scope guard

Wave 1 adds only documentation preservation, additive schema-1.3 validation, the independent policy-readiness operation and Lab readiness presentation. It does not modify `src/App.js`, Decision Application v1/v2 behavior, current policy calculations/requirements/graph/planner/customer actions, legacy Discovery implementation, dossiers, host persistence, Evidence Platform, uploads or database migrations. It implements none of the excluded successor doctrine.
