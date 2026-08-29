# UBO Control build ledger

| Field | Current state |
|---|---|
| Gate / sub-gate | Gate 3 / **G3.2 — Live Discovery Composition** |
| Branch | `codex/ubo-control-g3-2-live-discovery-composition` |
| Base commit | `44190814dfc74d241f0884dd6ff625188822bbe2` (PR #37 normal merge on `origin/main`) |
| Latest accepted PR | [#37 — UBO Control G3.1 legacy Discovery adapter](https://github.com/archukmurthy/kyc-agent/pull/37), merged normally with merge commit `44190814dfc74d241f0884dd6ff625188822bbe2`; remote G3.1 branch deleted |
| Current PR | Pending dedicated G3.2 PR — do not merge without Control Room acceptance |
| Completed implementation | Approved stateless/versioned Decision Application façade; protected serializable case state; explicit decision targets/operations; internal calculation planner; typed application errors; actual configured HTTP transport; one external composition point; offline D1–D4 full-pipeline proof; failure and anti-corruption invariance; opt-in live verifier |
| Scenario coverage | G3.1 L01–L14 remain protected. G3.2 D1 direct exact, D2 multilayer fresh 60%×50%=30%, D3 unresolved branch, D4 voting/control separation, polluted legacy conclusions, unavailable/malformed/NO_DATA/PARTIAL paths |
| Public/product boundary | Integration consumes only the deliberate public façade; `OwnershipCase`, graph, calculation, policy, requirement, orchestration and snapshot constructors stay private; core imports no integration; no provider credential or environment type enters UBO |
| Outstanding implementation | Open and report the dedicated G3.2 PR. Do not merge and do not begin Gate 4. |
| Tests / status | Standalone UBO 233/233 passed; adapter/composition 43/43 passed; architecture 7/7 passed; host 25 suites / 482 tests passed; legacy framework and recalculation smokes passed; production build passed; `git diff --check` passed. Controlled live verification completed for NIUM FINTECH LIMITED (`NO_DATA`) and REVOLUT LTD (`PARTIAL`, five candidates) with fresh unresolved snapshots and no fixture fallback. |
| Active escalations | Public application API escalation accepted and implemented as `createUboDecisionApplication({ policyPack })`; no further escalation is active. |
| Future requirement | [PR-VIS-001](docs/product/product-requirements.md) — approved ownership graph projection and interactive renderer, not implemented, target Gate 5.1 |
| Next approved step | Finish G3.2 verification and open/report its PR only. |

## Scope guard

G3.2 proves real legacy output can traverse the anti-corruption adapter and the public Decision Application into fresh UBO reasoning. The harness applies only explicitly supplied identity/adjudication decisions. It does not trust legacy conclusions, repair source loss, introduce fuzzy matching, auto-operate claims, persist snapshots, integrate onboarding/Extraction/Evidence, or implement PR-VIS-001.
