# UBO Control build ledger

| Field | Current state |
|---|---|
| Gate / sub-gate | Gate 5.3 / **G5.3A — Adaptive Customer Journey UI** |
| Parallel-gate state | **Gate 4: PAUSED** on the independent Evidence Platform prerequisite programme. G5.3A evidence interactions are presentation-only host intents. |
| Branch | `codex/ubo-control-g5-3a-adaptive-customer-journey-ui` |
| Base commit | `8346355157a751449530765f4aac37eecd136e62` (normal merge of accepted PR #42 into latest `origin/main`) |
| Latest accepted PR | [#42 — G5.2B low-friction UBO resolution planner](https://github.com/archukmurthy/kyc-agent/pull/42), merged normally as `8346355157a751449530765f4aac37eecd136e62`; source branch deleted. |
| Current PR | [#43 — G5.3A adaptive customer journey UI](https://github.com/archukmurthy/kyc-agent/pull/43) — open and unmerged; do not merge without Control Room acceptance. |
| Completed implementation | Reusable `UboJourney`; `ubo-customer-action-v1`; public JourneyProjection/ResolutionPlan-only boundary; optional reused `OwnershipGraph`; known/missing separation; confirmation; semantic field generation; coalesced information/evidence tasks; evidence handoff intent; system/blocker/review/specialist states; COMPANY/LLP language; validation/accessibility; CUI01–CUI17 standalone harness. |
| Product architecture | `DecisionSnapshot → JourneyProjection + ResolutionPlan → UboJourney → host-neutral customer action → future host processing/re-resolution`. UI local state is ephemeral and never authoritative UBO state. |
| Scenario coverage | CUI01 resolved, CUI02 confirmation, CUI03 foreign HoldCo, CUI04 missing identity, CUI05 voting, CUI06 appointment, CUI07 coalescence, CUI08 information+evidence, CUI09 targeted evidence, CUI10 system wave, CUI11 operational blocker, CUI12 internal review, CUI13 specialist/trust, CUI14 senior-management prep, CUI15 LLP, CUI16 unavailable wording, CUI17 before/after. |
| Public/product boundary | UI accepts only `ubo-journey-projection-v1`, `ubo-resolution-plan-v1`, and optional `ubo-ownership-graph-projection-v1`; emits only serializable `ubo-customer-action-v1`. No core-to-UI dependency. |
| Outstanding implementation | Host event processing, authoritative customer-response ingestion, upload/Evidence Platform handoff, host onboarding integration and production configuration error handling remain future gates. |
| Tests / status | Adaptive UI 46/46; Journey/Planner/Graph projections 57/57; standalone UBO 292/292; Discovery integration 43/43; architecture 17/17; host 25 suites / 482 tests; `UboJourney.js` 99.63% line / 81.22% branch / 89.47% function coverage; production build passed; manual desktop/mobile/CUI17 acceptance passed; final diff check passed. |
| Active escalations | None. G5.2B and JH-006 are accepted. No Decision Application expansion was required. |
| Next approved step | Complete G5.3A PR and return it for Control Room review. Do not merge and do not begin host onboarding integration. |

## Scope guard

G5.3A is reusable standalone UI product work only. It does not modify `src/App.js`, an existing onboarding screen, a host API route, a dossier flow, case management, `createUboDecisionApplication`, UBO policy/determination logic, provider execution or Evidence Platform ingestion. Files and raw document bytes never enter the component event.
