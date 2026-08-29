# UBO Control build ledger

| Field | Current state |
|---|---|
| Gate / sub-gate | Gate 2 / **G2.4B — Resolution Orchestration** |
| Branch | `codex/ubo-control-g2-4b-resolution-orchestration` |
| Base commit | `f688e102da4b68e24efceca140b4040af60f3ffb` (PR #34 normal merge on `origin/main`) |
| Latest accepted PR | [#34 — UBO Control G2.4A requirement resolution](https://github.com/archukmurthy/kyc-agent/pull/34), merged normally with merge commit `f688e102da4b68e24efceca140b4040af60f3ffb`; remote G2.4A branch deleted |
| Current PR | [#35 — UBO Control G2.4B resolution orchestration](https://github.com/archukmurthy/kyc-agent/pull/35) — do not merge without Control Room acceptance |
| Completed implementation | UK Corporate 1.4-RC/schema 1.1; immutable ResolutionOptions, ActionIntents and append-only ResolutionAttempts; semantic action coalescence without generic priority; asynchronous FALLBACK_EXHAUSTION ReviewRequirement/package/decision; senior-management candidate preparation; current-state-derived fallback eligibility and explicit SMO application; R09 discrepancy, R10/R11/R13 risk signals, R14 closing attestation, customer interaction projection and deterministic terminal precedence |
| Scenario coverage | G2.4B covers S06/P03 fallback negatives and P07 discrepancy semantics plus focused option/action/attempt, shared-need, operational, senior-candidate, stale-review, positive/negative exhaustion, PSC, depth/cross-border, trust, residual-attestation and ordinary/fallback/specialist/CDD terminal fixtures |
| Public/product boundary | No `index.js` expansion; no provider, legacy UBO, Evidence Platform, onboarding, host database, migration, Vercel or persistence dependency |
| Outstanding implementation | Verification and PR review within G2.4B. Immutable complete DecisionSnapshot, snapshot hashing/supersession, deterministic reconstruction, re-resolution checkpoints/history, persistence, providers, host risk mutation, case-management/onboarding UI and integrations remain G2.4C/later work. |
| Tests / status | Focused schema/orchestration suite 41/41 passed. Full UBO 211/211 passed with 98.00% line / 89.01% branch / 96.85% function coverage. Host 25 suites / 482 tests passed. Architecture 2/2 passed. Legacy UBO framework and recalculation smoke tests passed. Production build passed. `git diff --check` passed. |
| Active escalations | None. The prior exhausted-measures ambiguity was resolved by the accepted asynchronous-review doctrine: the machine emits review readiness; only a current ANALYST/COMPLIANCE decision derives eligibility. No public contract, generic action priority, reportability/materiality law, evidence acceptance rule, provider or host workflow semantic was invented. |
| Next approved step | Complete verification, open and report the dedicated G2.4B PR only; do not merge it and do not start G2.4C. |

## Scope guard

G2.4B deterministically converts pinned G2.4A reasoning into policy-permitted options, uniquely actionable host-neutral intents, attempt/review records, discrepancy/risk/completeness assessments and a policy terminal orchestration state. Human fallback review is asynchronous and externally hosted. The module contains no generic priority, UI, assignment, messaging, provider execution, regulatory submission, authoritative risk mutation, full DecisionSnapshot/history, persistence or public API expansion. G2.4C has not started.
