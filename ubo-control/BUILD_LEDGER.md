# UBO Control build ledger

| Field | Current state |
|---|---|
| Gate / sub-gate | **UBO Control Freeze Implementation — Wave 2: UK Corporate v1.6-RC Review Policy Container** |
| G5.3B | **KYB Onboarding Integration Diagnosis — ACCEPTED**; preserved at `docs/integration/kyb-onboarding-integration-diagnosis.md`. |
| KYB onboarding integration | **DEFERRED** until after UBO Control Lab validation. |
| Parallel-gate state | **Gate 4: PAUSED** pending Evidence prerequisites. When ready, Evidence integrates into the Lab before KYB onboarding. |
| Branch | `codex/ubo-control-freeze-w2-policy-pack-1-6-rc` |
| Base commit | `b0d196a0ab217a96dc63cf6ebeb238ccd3d2f733` (accepted PR #46 normal merge on `origin/main`). |
| Latest accepted PR | [#46 — Freeze Implementation Wave 1](https://github.com/archukmurthy/kyc-agent/pull/46), merged normally as `b0d196a0ab217a96dc63cf6ebeb238ccd3d2f733`. |
| Current PR | Wave 2 PR pending creation; keep open for Control Room review and do not merge automatically. |
| Versioning | Default `ubo-decision-application-v1` remains exactly `intake`, `applyDecisions`, `evaluate`. Explicit `ubo-decision-application-v2` adds `applyCustomerInput`. |
| Completed G5.3C implementation | Snapshot/plan-pinned customer-action validation; customer provenance; candidate relationship and identity-attribute facts; case-scoped natural-person registration; exact-ID identity resolution; confirmation/correction/negative-answer semantics; senior-management preparation; alternative provenance; external evidence handoff; explicit decision targets; separate evaluation. |
| Product architecture | `DecisionSnapshot + ResolutionPlan + ubo-customer-action-v1 → applyCustomerInput → sealed caseState → applyDecisions if required → evaluate → fresh DecisionSnapshot`. |
| Public/product boundary | No host, React, provider, persistence or Evidence dependency in the application operation. No graph/qualification/requirement/snapshot result is produced by customer input alone. |
| Scenario coverage | Foreign HoldCo before/after; multiple and same-name new owners; unique external ID; identity attribute; negative answer; confirmation; correction; selected alternative; senior-management candidate; evidence handoff; stale/unauthorized action; immutability, serialization and determinism. |
| G5.3D implementation | Standalone `/ubo-control-lab/`; Fixture and Live Discovery modes; disabled Live Evidence mode; shared Customer/Compliance/History views; R01–R14; decision consoles; candidate-source inspection; planner; feedback export; diagnostics; session-only sealed state. |
| Wave 1 implementation | Preserved Freeze Pack; additive strict schema 1.3 validator; machine-readable sign-off/readiness structures; public `ubo-policy-readiness-v1`; explicit LAB/PRODUCTION/HISTORICAL_RECONSTRUCTION modes; persistent Lab review watermark. |
| Wave 2 implementation | **UK Corporate v1.6-RC review-policy container — implemented. Execution: NOT STARTED.** Immutable schema-1.3 policy data, source mapping, exact File 07 assertion inventory, machine-readable A-01–A-18 states, feature defaults and unsupported successor dependencies are present. |
| Successor policy | UK Corporate `1.6-RC`, schema `1.3`, `CONTROL_ROOM_REVIEW`, null effective date/approver, canonical hash `sha256:6f4235ca32b961868f294b862810d101516a35a5ce8fe8a031ec2d2166e6e969`; LAB readiness `REVIEW_ONLY`; PRODUCTION `BLOCKED`. Historical `1.5-RC` remains immutable at `sha256:724c2fa4820e02daddc24e652b50748646d87017cbfa632c062bc9e27de4b790`. |
| Current Lab/runtime | Continues using UK Corporate `1.5-RC`; Decision Application v1/v2, DecisionSnapshot v1, ASDA, graph, journey and planner semantics are unchanged. |
| Customer cycle | LAB18 runs a real foreign-HoldCo Snapshot A through `UboJourney` → `applyCustomerInput` → explicit claim adjudication → linked Snapshot B; no snapshot or alternate-field workaround. |
| Outstanding implementation | QualificationBasis v2, PSC/Schedule 1A attribution, layer closure, phased coordination, frontier needs, planner v2, projection/Lab v2, applicant v2, Evidence integration and host onboarding remain outside Wave 2. |
| Active escalations | None. Schema 1.3 expressed the authorized Wave 2 content without public-schema changes. |
| Next | **Control Room review of the Wave 2 PR.** Do not begin Wave 3. |

## Scope guard

Wave 2 adds only the immutable UK Corporate 1.6-RC review-policy artifact, its source mapping, assertion inventory, tests and governance documentation. The artifact may be schema-validated, hashed and readiness-assessed. It is not selected or executed. Wave 2 does not modify `src/App.js`, Decision Application v1/v2 behavior, current policy calculations/requirements/graph/planner/customer actions, ASDA fixtures, Lab semantics, legacy Discovery implementation, dossiers, host persistence, Evidence Platform, uploads or database migrations.
