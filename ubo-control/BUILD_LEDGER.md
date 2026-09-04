# UBO Control build ledger

| Field | Current state |
|---|---|
| Gate / sub-gate | **UBO Control Freeze Implementation — Wave 5: Review-only LLP and mixed COMPANY/LLP PSC attribution** |
| G5.3B | **KYB Onboarding Integration Diagnosis — ACCEPTED**; preserved at `docs/integration/kyb-onboarding-integration-diagnosis.md`. |
| KYB onboarding integration | **DEFERRED** until after UBO Control Lab validation. |
| Parallel-gate state | **Gate 4: PAUSED** pending Evidence prerequisites. When ready, Evidence integrates into the Lab before KYB onboarding. |
| Branch | `codex/ubo-control-freeze-w5-llp-attribution-review-only` |
| Base commit | `2bcae34c817a4df9ab4e9e5e8e03afeec527117a` (accepted PR #49 normal merge on `origin/main`). |
| Latest accepted PR | [#49 — Freeze Wave 4: company PSC-condition attribution](https://github.com/archukmurthy/kyc-agent/pull/49), merged normally as `2bcae34c817a4df9ab4e9e5e8e03afeec527117a`. |
| Current PR | Wave 5 PR pending creation; keep open for Control Room review and do not merge automatically. |
| Versioning | Default `ubo-decision-application-v1` remains exactly `intake`, `applyDecisions`, `evaluate`. Explicit `ubo-decision-application-v2` adds `applyCustomerInput`. |
| Completed G5.3C implementation | Snapshot/plan-pinned customer-action validation; customer provenance; candidate relationship and identity-attribute facts; case-scoped natural-person registration; exact-ID identity resolution; confirmation/correction/negative-answer semantics; senior-management preparation; alternative provenance; external evidence handoff; explicit decision targets; separate evaluation. |
| Product architecture | `DecisionSnapshot + ResolutionPlan + ubo-customer-action-v1 → applyCustomerInput → sealed caseState → applyDecisions if required → evaluate → fresh DecisionSnapshot`. |
| Public/product boundary | No host, React, provider, persistence or Evidence dependency in the application operation. No graph/qualification/requirement/snapshot result is produced by customer input alone. |
| Scenario coverage | Foreign HoldCo before/after; multiple and same-name new owners; unique external ID; identity attribute; negative answer; confirmation; correction; selected alternative; senior-management candidate; evidence handoff; stale/unauthorized action; immutability, serialization and determinism. |
| G5.3D implementation | Standalone `/ubo-control-lab/`; Fixture and Live Discovery modes; disabled Live Evidence mode; shared Customer/Compliance/History views; R01–R14; decision consoles; candidate-source inspection; planner; feedback export; diagnostics; session-only sealed state. |
| Wave 1 implementation | Preserved Freeze Pack; additive strict schema 1.3 validator; machine-readable sign-off/readiness structures; public `ubo-policy-readiness-v1`; explicit LAB/PRODUCTION/HISTORICAL_RECONSTRUCTION modes; persistent Lab review watermark. |
| Wave 2 implementation | **UK Corporate v1.6-RC review-policy container — implemented. Execution: NOT STARTED.** Immutable schema-1.3 policy data, source mapping, exact File 07 assertion inventory, machine-readable A-01–A-18 states, feature defaults and unsupported successor dependencies are present. |
| Wave 3 implementation | **Internal route-specific qualification reasoning — implemented; runtime wiring not started.** Immutable `ubo-qualification-basis-v2` records and the pure `ubo-effective-interest-qualification-v2` wrapper consume recorded v1 arithmetic, retain statutory/firm classifications, and explicitly preserve unassessed routes. |
| Wave 4 implementation | **Internal company PSC-condition attribution — implemented review-only; runtime wiring not started.** Pure `ubo-psc-attribution-v1` emits `ubo-psc-attribution-assessment-v1` with route-aware QualificationBasis v2 records, full target-right attribution, unique-right aggregation and complete path/support trace. |
| Wave 5 implementation | **Internal LLP and mixed COMPANY/LLP attribution — implemented review-only under A-06-WA-01; runtime wiring not started.** Separate `ubo-llp-psc-attribution-v1` emits `ubo-llp-psc-attribution-assessment-v1`, preserves LLP surplus-asset semantics, allows only explicit voting/appointment majority steps, and leaves final TDR/ASDA status unresolved. |
| Successor policy | UK Corporate `1.6-RC`, schema `1.3`, `CONTROL_ROOM_REVIEW`, null effective date/approver, canonical hash `sha256:6f4235ca32b961868f294b862810d101516a35a5ce8fe8a031ec2d2166e6e969`; LAB readiness `REVIEW_ONLY`; PRODUCTION `BLOCKED`. Historical `1.5-RC` remains immutable at `sha256:724c2fa4820e02daddc24e652b50748646d87017cbfa632c062bc9e27de4b790`. |
| Current Lab/runtime | Continues using UK Corporate `1.5-RC`; Decision Application v1/v2, DecisionSnapshot v1, ASDA, graph, journey and planner semantics are unchanged. |
| Customer cycle | LAB18 runs a real foreign-HoldCo Snapshot A through `UboJourney` → `applyCustomerInput` → explicit claim adjudication → linked Snapshot B; no snapshot or alternate-field workaround. |
| Outstanding implementation | Trust/firm and joint attribution, fund/LP profiles, approved agreement/dominant-control semantics, final TDR/ASDA conclusion, management-control successor assessment, final route union/person-role projection, layer closure, phased coordination, frontier needs, planner v2, snapshot/projection/Lab v2, applicant v2, Evidence integration and host onboarding remain outside Wave 5. |
| Active escalations | None. Existing canonical qualifiers faithfully distinguish surplus-asset, voting and management-appointment rights; no graph, CandidateFact, adapter or public-contract change is required. Agreement/dominant-control majority semantics remain explicitly unsupported. |
| Next | **Control Room review of the Wave 5 PR.** Do not begin Wave 6. |

## Scope guard

Wave 5 adds only the separate internal pure LLP/mixed attribution algorithm/envelope, the optional private QualificationBasis v2 working-assumption identity, focused tests and governance traceability. It does not change company attribution, percentage arithmetic, UK Corporate 1.5-RC or 1.6-RC policy artifacts, public exports, `src/App.js`, Decision Application v1/v2 behavior, current policy determination/requirements/snapshot/graph projection/journey/planner/customer actions, ASDA fixtures, Lab semantics, legacy Discovery implementation, dossiers, host persistence, Evidence Platform, uploads or database migrations. It introduces no joint attribution, final TDR/ASDA answer, trust/firm condition, fund/LP traversal, final union or person-level UBO implementation.
