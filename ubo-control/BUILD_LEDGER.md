# UBO Control build ledger

| Field | Current state |
|---|---|
| Gate / sub-gate | Gate 1 / G1.2B — Deterministic Stubs + Scenario Universe |
| Branch | `codex/ubo-control-g1-2b` |
| Base commit | `92af704a9b39d141578cf47669ecbd228893f571` (G1.2A merge on `origin/main`) |
| Prior accepted PR | [#28 — UBO Control G1.2A policy schema and UK pack](https://github.com/archukmurthy/kyc-agent/pull/28), merged with merge commit `92af704a9b39d141578cf47669ecbd228893f571`; remote G1.2A branch deleted |
| Current PR | Pending for this branch |
| Completed implementation | Explicitly injected sequential Discovery/Extraction stubs; strict scenario validation and isolated runner; 20 required core scenarios; 8 policy-focused input fixtures; one-to-one executable representability links for all 22 policy assertions; honest Gate 2/integration deferrals; architecture and test governance |
| Outstanding implementation | Current-main rebase if required, final diff review, commit/push, and PR creation |
| Tests / status | G1.2A merged baseline: 45/45 passed. G1.2B: 88/88 passed; 98.88% line / 96.14% branch coverage. Host: 25 suites / 482 tests passed. Legacy UBO framework and recalculation smoke tests passed. Production build passed. |
| Active escalations | None. Eight assertions previously labelled `G1.2B_SCENARIO` require qualification, claim creation, requirement resolution, information-need creation, controller projection, or review routing; their inputs are scenario-protected and their behavior is reclassified to Gate 2. |
| Next approved step | Finalize and report G1.2B only; do not start Gate 2. |

## Scope guard

G1.2B adds test infrastructure and representability fixtures only. It contains no policy evaluation, graph join/mutation, ownership arithmetic, threshold qualification, identity merge, claim adjudication, UBO/PSC/controller determination, requirement resolution, information-need orchestration, gap/customer-action generation, fallback/routing determination, live provider, Evidence Platform/onboarding integration, persistence, migration, UI, or legacy refactor.
