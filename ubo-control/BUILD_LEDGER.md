# UBO Control build ledger

| Field | Current state |
|---|---|
| Gate / sub-gate | Gate 2 / **G2.4A — Requirement Resolution** |
| Branch | `codex/ubo-control-g2-4a-requirement-resolution` |
| Base commit | `3e33502f4ed71b6ab32f1a012bdb3c0222cbde14` (PR #33 normal merge on `origin/main`) |
| Latest accepted PR | [#33 — UBO Control G2.3 policy determination](https://github.com/archukmurthy/kyc-agent/pull/33), merged normally with merge commit `3e33502f4ed71b6ab32f1a012bdb3c0222cbde14`; remote G2.3 branch deleted |
| Current PR | [#34 — UBO Control G2.4A requirement resolution](https://github.com/archukmurthy/kyc-agent/pull/34) — do not merge without Control Room acceptance |
| Completed implementation | Policy-hash/case-revision-pinned `EvidencePolicyClassification`; pack-owned non-additive evidence sufficiency; `ubo-requirement-resolution-v1` approved state precedence; R01/R02/R03/R04/R05/R06/R07/R08/R11/R12 resolution; immutable semantic InformationNeeds, PolicyGaps and OperationalBlockers; distinct-source/freshness/current-state handling; append-only need lifecycle |
| Scenario coverage | G2.4A exercises S01/S03/S05/S06/S07/S08/S13/S15/S16/S17/S18 plus P01/P02/P08-shaped inputs through focused direct/indirect/legal-holder/control/identity/corroboration/trust/nominee/capability fixtures, including shared needs and distinct evidence-source cases |
| Public/product boundary | No `index.js` expansion; no provider, legacy UBO, Evidence Platform, onboarding, host database, migration, Vercel or persistence dependency |
| Outstanding implementation | Verification and PR review within G2.4A. Resolution option/action selection, priority, SMO fallback, discrepancy orchestration, risk signals, residual completeness, terminal outcome, full decision snapshots, re-resolution orchestration and all integration remain unopened G2.4B/later work. |
| Tests / status | Focused G2.4A suite 29/29 passed. Full UBO 180/180 passed with 98.04% line / 89.45% branch / 98.08% function coverage. Host 25 suites / 482 tests passed. Architecture 2/2 passed. Legacy UBO framework and recalculation smoke tests passed. Production build passed. `git diff --check` passed. |
| Active escalations | None. R07 uses the existing canonical name, G2.3 role/basis, and operative `ENTITY_ATTRIBUTE` claim representation; no public person/EvidenceReference/capability contract, evidence precedence, temporal winner, automatic conflict resolution, inferred independence, Policy Pack semantic, action priority, fallback or public API change was required. |
| Next approved step | Complete verification, open and report the dedicated G2.4A PR only; do not merge it and do not start G2.4B. |

## Scope guard

G2.4A deterministically resolves individual requirements from pinned G2.2/G2.3 artifacts and explicit evidence-policy classifications. It may emit semantic InformationNeeds, substantive PolicyGaps, and operational-only blockers, but it does not select or prioritize an action and produces no question, document request, analyst task, fallback, discrepancy workflow, risk signal, terminal case outcome, full snapshot, journey projection, provider call or persistence behavior. G2.4B has not started.
