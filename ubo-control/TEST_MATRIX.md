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
| Schema identity separate from policy version | `__tests__/policyPack.nodetest.js` — exact schema ID/version and independent policy version validation |
| Versioned engine-semantic pins | `__tests__/policyPack.nodetest.js` — every approved semantic version is required and exact |
| Engine-owned state/strategy/effect/risk vocabularies | `__tests__/architecture.nodetest.js` and `__tests__/policyPack.nodetest.js` — deliberate exports and rejection of unsupported policy values |
| `UNRESOLVED` is distinct from `GAP` | `__tests__/architecture.nodetest.js` — exact requirement-state vocabulary |
| Safe `ubo-condition-v1` syntax boundary | `__tests__/conditionLanguage.nodetest.js` — accepted grammar and rejection of calls, execution, unsupported roots/operators, malformed and chained expressions |
| Referenced condition parameters exist | `__tests__/policyPack.nodetest.js` — dangling `params.*` and `{param:...}` references rejected |
| Strict definition/evidence/action/profile/event references | `__tests__/policyPack.nodetest.js` — dangling references and invalid unresolved-reference records rejected |
| Semantic action IDs rather than source B-codes | `__tests__/policyPack.nodetest.js` and `__tests__/ukPolicyPack.nodetest.js` — B-code durable IDs rejected and source references retained separately |
| Source/runtime separation | `__tests__/policyPack.nodetest.js` — architecture/runtime-contract top-level data rejected; `__tests__/ukPolicyPack.nodetest.js` — source traceability pinned |
| UK Corporate 1.3-RC canonical runtime identity | `__tests__/ukPolicyPack.nodetest.js` — source byte hash, runtime canonical hash, identity/status, counts, immutability, and closed references |
| Missing B1/B2/B4 and E01/E02/E08/E10 content remains unresolved | `__tests__/ukPolicyPack.nodetest.js` — exact unresolved reference sets and no invented text |
| Supplied assertion inventory is complete without false behavioral coverage | `__tests__/ukPolicyPack.nodetest.js` — exact 22-item one-to-one plan and allowed deferral states; no `SCHEMA_PROTECTED_NOW` claims |
| Canonical policy serialization | `__tests__/policyPack.nodetest.js` — fixed canonicalization vector |
| Stable policy hash across insignificant formatting | `__tests__/policyPack.nodetest.js` — whitespace/order/line-ending equivalence |
| Material policy change changes identity | `__tests__/policyPack.nodetest.js` — changed-data hash vector |
| Policy hash pinning and immutable load | `__tests__/policyPack.nodetest.js` — expected hash and frozen result |
| Composition validates capability traffic | `__tests__/composition.nodetest.js` — request/result validation and request ID correlation |

## UK Corporate supplied assertion plan

These are the 22 behavioral assertions supplied with the Control Room source. G1.2A protects their exact, one-to-one inventory and deferral classification, but does not claim the behavior itself is implemented. `G1.2B_SCENARIO` means a future policy scenario; `GATE_2_REASONING` means a future reasoning test; `LATER_INTEGRATION` means a test requiring a later integration boundary.

| Requirement | Supplied assertion | Status | Current executable protection |
|---|---|---|---|
| UBO-R01 | COMPANY: direct qualifying share owner is identified from supported evidence. | `G1.2B_SCENARIO` | Plan integrity only; behavior deferred |
| UBO-R01 | LLP: qualifying rights to surplus assets are evaluated using LLP semantics. | `G1.2B_SCENARIO` | Plan integrity only; behavior deferred |
| UBO-R01 | Corporate holder creates an InformationNeed until ultimate natural persons are resolved. | `G1.2B_SCENARIO` | Plan integrity only; behavior deferred |
| UBO-R02 | Percentage chains multiply deterministically. | `GATE_2_REASONING` | Plan integrity only; behavior deferred |
| UBO-R02 | Independent qualifying paths aggregate. | `GATE_2_REASONING` | Plan integrity only; behavior deferred |
| UBO-R02 | Ranges remain ranges/min-max rather than being silently converted to exact percentages. | `GATE_2_REASONING` | Plan integrity only; behavior deferred |
| UBO-R02 | Cycles cannot silently produce a numeric answer. | `GATE_2_REASONING` | Plan integrity only; behavior deferred |
| UBO-R05 | COMPANY: qualifying board-majority appointment right produces controller_appointment. | `G1.2B_SCENARIO` | Plan integrity only; behavior deferred |
| UBO-R05 | LLP: qualifying majority-management appointment right produces controller_appointment. | `G1.2B_SCENARIO` | Plan integrity only; behavior deferred |
| UBO-R05 | Risk checkpoint HIGH invalidates attestation-only closure and produces documentary gap without bespoke screen logic. | `GATE_2_REASONING` | Plan integrity only; behavior deferred |
| UBO-R06 | Positive registry control fact may create a candidate claim. | `G1.2B_SCENARIO` | Plan integrity only; behavior deferred |
| UBO-R06 | Absence of PSC condition-4 data does not negatively resolve the requirement. | `G1.2B_SCENARIO` | Plan integrity only; behavior deferred |
| UBO-R06 | Ambiguous veto/decision rights route to REVIEW_REQUIRED rather than automatic UBO determination. | `G1.2B_SCENARIO` | Plan integrity only; behavior deferred |
| UBO-R08 | Customer declaration alone cannot resolve R08. | `GATE_2_REASONING` | Plan integrity only; behavior deferred |
| UBO-R08 | Numeric evidence strength alone cannot bypass independent-source requirement. | `GATE_2_REASONING` | Plan integrity only; behavior deferred |
| UBO-R08 | Companies House PSC information may corroborate but must not automatically become final UBO conclusion. | `GATE_2_REASONING` | Plan integrity only; behavior deferred |
| UBO-R09 | Material missing PSC may create reportable discrepancy workflow. | `LATER_INTEGRATION` | Plan integrity only; integration deferred |
| UBO-R09 | Difference caused only by PSC-vs-MLR definition mismatch is not automatically reportable. | `GATE_2_REASONING` | Plan integrity only; behavior deferred |
| UBO-R09 | Non-material discrepancy records rationale without automatically invoking report workflow. | `GATE_2_REASONING` | Plan integrity only; behavior deferred |
| UBO-R10 | Fallback cannot activate merely because DiscoveryService returned NO_DATA. | `GATE_2_REASONING` | Plan integrity only; behavior deferred |
| UBO-R10 | Fallback cannot activate when required measures were not actually completed. | `GATE_2_REASONING` | Plan integrity only; behavior deferred |
| UBO-R10 | Snapshot records measures taken and reason fallback was permitted. | `GATE_2_REASONING` | Plan integrity only; behavior deferred |
