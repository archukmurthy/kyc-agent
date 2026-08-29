# UBO Control build ledger

| Field | Current state |
|---|---|
| Gate / sub-gate | Gate 2 / **G2.2 — Canonical Graph + Deterministic Percentage Calculation** |
| Branch | `codex/ubo-control-g2-2-graph-calculation` |
| Base commit | `ee79b4581429dcafa600a48f1692bb6cd2fbdda4` (PR #31 normal merge on `origin/main`) |
| Latest accepted PR | [#31 — UBO Control G2.1 ownership cases and candidate claims](https://github.com/archukmurthy/kyc-agent/pull/31), merged normally with merge commit `ee79b4581429dcafa600a48f1692bb6cd2fbdda4`; remote G2.1 branch deleted |
| Current PR | [#32 — UBO Control G2.2 canonical graph and deterministic calculation](https://github.com/archukmurthy/kyc-agent/pull/32) — do not merge without Control Room acceptance |
| Completed implementation | Immutable `ubo-graph-v1` graph from eligible operative claims; corroborating-claim coalescence; typed truth-set/invariant errors; exact rational and interval arithmetic; homogeneous economic/voting look-through; distinct-path aggregation; relevant-cycle/unknown/no-path statuses |
| Scenario coverage | G2.2 materially exercises unchanged S01, S02, S03, S04, S09, S10, S14, S18 and S19 through explicit G2.1 identity and operative-claim decisions, plus focused exact/range/unknown/temporal/path fixtures |
| Public/product boundary | No `index.js` expansion; no provider, legacy UBO, Evidence Platform, onboarding, host database, migration, Vercel or persistence dependency |
| Outstanding implementation | PR review within G2.2. Threshold qualification, policy interpretation, UBO/PSC/controller determination and every G2.3 concern remain unopened. |
| Tests / status | UBO 133/133 passed; 98.61% line / 92.83% branch coverage. Host 25 suites / 482 tests passed. Architecture 2/2 passed. Legacy UBO framework and recalculation smoke tests passed. Production build passed. `git diff --check` passed. |
| Active escalations | None. Existing data-only qualifiers can explicitly distinguish separate rights/instruments; G2.2 adds no public percentage/graph contract, relationship semantics, mixed-chain inference, evidence/temporal precedence, cycle algebra, repair rule or public API. |
| Next approved step | Open and report the G2.2 PR only; do not merge it and do not start G2.3. |

## Scope guard

G2.2 converts the explicitly adjudicated G2.1 operative truth set into a deterministic immutable graph and performs mathematical percentage look-through only. It contains no threshold/control qualification, Policy Pack evaluation, evidence sufficiency, requirement resolution, InformationNeed/gap/action generation, UBO/PSC/controller determination, SMO fallback, discrepancy handling, decision snapshot, onboarding projection, live provider or persistence behavior. G2.3 has not started.
