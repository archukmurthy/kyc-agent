# UBO Control build ledger

| Field | Current state |
|---|---|
| Gate / sub-gate | **UBO Control Freeze Implementation — Wave 3: QualificationBasis v2 and Effective-Interest Route Wrapper** |
| G5.3B | **KYB Onboarding Integration Diagnosis — ACCEPTED**; preserved at `docs/integration/kyb-onboarding-integration-diagnosis.md`. |
| KYB onboarding integration | **DEFERRED** until after UBO Control Lab validation. |
| Parallel-gate state | **Gate 4: PAUSED** pending Evidence prerequisites. When ready, Evidence integrates into the Lab before KYB onboarding. |
| Branch | `codex/ubo-control-freeze-w3-qualification-basis-v2` |
| Base commit | `bb079e00cbb55c2316c2603196ec665fcc3bde7a` (accepted PR #47 normal merge on `origin/main`). |
| Latest accepted PR | [#47 — Freeze Wave 2: UK Corporate v1.6-RC review policy](https://github.com/archukmurthy/kyc-agent/pull/47), merged normally as `bb079e00cbb55c2316c2603196ec665fcc3bde7a`. |
| Current PR | Wave 3 PR to be opened; keep open for Control Room review and do not merge automatically. |
| Versioning | Default `ubo-decision-application-v1` remains exactly `intake`, `applyDecisions`, `evaluate`. Explicit `ubo-decision-application-v2` adds `applyCustomerInput`. |
| Completed G5.3C implementation | Snapshot/plan-pinned customer-action validation; customer provenance; candidate relationship and identity-attribute facts; case-scoped natural-person registration; exact-ID identity resolution; confirmation/correction/negative-answer semantics; senior-management preparation; alternative provenance; external evidence handoff; explicit decision targets; separate evaluation. |
| Product architecture | `DecisionSnapshot + ResolutionPlan + ubo-customer-action-v1 → applyCustomerInput → sealed caseState → applyDecisions if required → evaluate → fresh DecisionSnapshot`. |
| Public/product boundary | No host, React, provider, persistence or Evidence dependency in the application operation. No graph/qualification/requirement/snapshot result is produced by customer input alone. |
| Scenario coverage | Foreign HoldCo before/after; multiple and same-name new owners; unique external ID; identity attribute; negative answer; confirmation; correction; selected alternative; senior-management candidate; evidence handoff; stale/unauthorized action; immutability, serialization and determinism. |
| G5.3D implementation | Standalone `/ubo-control-lab/`; Fixture and Live Discovery modes; disabled Live Evidence mode; shared Customer/Compliance/History views; R01–R14; decision consoles; candidate-source inspection; planner; feedback export; diagnostics; session-only sealed state. |
| Wave 1 implementation | Preserved Freeze Pack; additive strict schema 1.3 validator; machine-readable sign-off/readiness structures; public `ubo-policy-readiness-v1`; explicit LAB/PRODUCTION/HISTORICAL_RECONSTRUCTION modes; persistent Lab review watermark. |
| Wave 2 implementation | **UK Corporate v1.6-RC review-policy container — implemented. Execution: NOT STARTED.** Immutable schema-1.3 policy data, source mapping, exact File 07 assertion inventory, machine-readable A-01–A-18 states, feature defaults and unsupported successor dependencies are present. |
| Wave 3 implementation | **Internal route-specific qualification reasoning — implemented; runtime wiring not started.** Immutable `ubo-qualification-basis-v2` records and the pure `ubo-effective-interest-qualification-v2` wrapper consume recorded v1 arithmetic, retain statutory/firm classifications, and explicitly preserve unassessed routes. |
| Successor policy | UK Corporate `1.6-RC`, schema `1.3`, `CONTROL_ROOM_REVIEW`, null effective date/approver, canonical hash `sha256:6f4235ca32b961868f294b862810d101516a35a5ce8fe8a031ec2d2166e6e969`; LAB readiness `REVIEW_ONLY`; PRODUCTION `BLOCKED`. Historical `1.5-RC` remains immutable at `sha256:724c2fa4820e02daddc24e652b50748646d87017cbfa632c062bc9e27de4b790`. |
| Current Lab/runtime | Continues using UK Corporate `1.5-RC`; Decision Application v1/v2, DecisionSnapshot v1, ASDA, graph, journey and planner semantics are unchanged. |
| Customer cycle | LAB18 runs a real foreign-HoldCo Snapshot A through `UboJourney` → `applyCustomerInput` → explicit claim adjudication → linked Snapshot B; no snapshot or alternate-field workaround. |
| Outstanding implementation | PSC/Schedule 1A attribution, management-control successor assessment, final route union/person-role projection, layer closure, phased coordination, frontier needs, planner v2, snapshot/projection/Lab v2, applicant v2, Evidence integration and host onboarding remain outside Wave 3. |
| Active escalations | None. The accepted schema-1.3 declarations support the internal effective-interest wrapper without Policy Pack or public-contract changes. |
| Next | **Control Room review of the Wave 3 PR.** Do not begin Wave 4. |

## Scope guard

Wave 3 adds only the internal QualificationBasis v2 model, pure effective-interest wrapper, focused tests and governance traceability. It does not change percentage arithmetic, UK Corporate 1.5-RC or 1.6-RC policy artifacts, public exports, `src/App.js`, Decision Application v1/v2 behavior, current policy determination/requirements/snapshot/graph projection/journey/planner/customer actions, ASDA fixtures, Lab semantics, legacy Discovery implementation, dossiers, host persistence, Evidence Platform, uploads or database migrations.
