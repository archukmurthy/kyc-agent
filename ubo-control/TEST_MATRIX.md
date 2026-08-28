# UBO Control test matrix

| Material module / invariant | Protecting executable test |
|---|---|
| Product-root dependency direction | `__tests__/architecture.nodetest.js` — production imports remain inside root or use Node built-ins |
| No legacy UBO or Evidence Platform implementation import | `__tests__/architecture.nodetest.js` — prohibited import scan |
| Deliberate public entry point | `__tests__/architecture.nodetest.js` — exact export set |
| Explicit provider injection / no stub fallback | `__tests__/composition.nodetest.js` — missing-provider failures and exact injected provider calls |
| Typed composition errors and stable codes | `__tests__/composition.nodetest.js` — every approved configuration code |
| Discovery and Extraction request contracts | `__tests__/contracts.nodetest.js` — common and capability-specific request validation |
| Capability outcome vocabulary and semantics | `__tests__/contracts.nodetest.js` — all states, invalid states, `NO_DATA` invariant |
| CandidatePartyReference without canonical entity ID | `__tests__/contracts.nodetest.js` — name/external-ID candidates and empty rejection |
| Grammatical relationship direction and vocabulary | `__tests__/contracts.nodetest.js` — subject/relationship/object preservation |
| Entity-attribute candidate facts | `__tests__/contracts.nodetest.js` — attribute/value validation |
| Exact/range/unknown percentage values | `__tests__/contracts.nodetest.js` — range endpoints preserved and invalid ranges rejected |
| Fact-level versus operation-level evidence | `__tests__/contracts.nodetest.js` — operation references never populate fact support |
| EvidenceReference opacity and integrity metadata | `__tests__/contracts.nodetest.js` — provider-neutral reference validation |
| Explicit identity resolution audit record | `__tests__/contracts.nodetest.js` — statuses, resolved ID, evidence, actor/time |
| Policy Pack top-level/data-only validation | `__tests__/policyPack.nodetest.js` — malformed, executable, duplicate, and unknown-reference rejection |
| Canonical policy serialization | `__tests__/policyPack.nodetest.js` — fixed canonicalization vector |
| Stable policy hash across insignificant formatting | `__tests__/policyPack.nodetest.js` — whitespace/order/line-ending equivalence |
| Material policy change changes identity | `__tests__/policyPack.nodetest.js` — changed-data hash vector |
| Policy hash pinning and immutable load | `__tests__/policyPack.nodetest.js` — expected hash and frozen result |
| Composition validates capability traffic | `__tests__/composition.nodetest.js` — request/result validation and request ID correlation |
