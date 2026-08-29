# UBO Control build ledger

| Field | Current state |
|---|---|
| Gate / sub-gate | Gate 3 / **G3.1 — Legacy Discovery Adapter** |
| Branch | `codex/ubo-control-g3-1-legacy-discovery-adapter` |
| Base commit | `ec68bb803ec7a2a9f691b0bcc46e2a8c81df7088` (PR #36 normal merge on `origin/main`) |
| Latest accepted PR | [#36 — UBO Control G2.4C decision history](https://github.com/archukmurthy/kyc-agent/pull/36), merged normally with merge commit `ec68bb803ec7a2a9f691b0bcc46e2a8c81df7088`; remote G2.4C branch deleted |
| Current PR | Pending dedicated G3.1 PR — do not merge without Control Room acceptance |
| Completed implementation | Disposable external legacy Discovery anti-corruption adapter; injected transport; minimum request mapping; provider-neutral candidate-fact translation; exact/range/unknown preservation; voting/economic separation; conservative capability outcomes; stable adapter issues; conclusion-field invariance |
| Scenario coverage | L01–L14 cover exact ownership, reconstructable band, voting, ambiguity, legal-entity identity, ignored conclusions/gaps/projection, conflicting assertions, NO_DATA, PARTIAL, malformed response, service/operational failures and weak provenance |
| Public/product boundary | Adapter lives under `integrations/`; imports only public `ubo-control`; no `index.js` expansion; core imports no adapter; no legacy implementation, provider, Evidence Platform, onboarding, persistence or live endpoint wiring |
| Outstanding implementation | Complete full verification and open the G3.1 PR. Actual endpoint composition/execution is outside G3.1 and must not begin automatically. |
| Tests / status | Adapter 26/26 passed in focused development. Full verification pending. |
| Active escalations | None. The existing deliberate public API was sufficient; no public export expansion was required. |
| Next approved step | Complete verification, open and report the dedicated G3.1 PR only; do not merge it and do not begin G3.2. |

## Scope guard

G3.1 translates only sufficiently definite source assertions retained by the legacy capability into provider-neutral candidate facts. It does not trust legacy UBO/control/effective-ownership/threshold/gap/reviewer conclusions, repair upstream source loss, adjudicate claims, build a fresh graph, calculate interests, apply policy, select providers, execute a live endpoint or integrate onboarding.
