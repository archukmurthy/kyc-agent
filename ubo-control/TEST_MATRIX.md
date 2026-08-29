# UBO Control test matrix

| Material module / invariant | Protecting executable test |
|---|---|
| Product-root dependency direction | `__tests__/architecture.nodetest.js` — production imports remain inside root or use Node built-ins |
| No legacy UBO or Evidence Platform implementation import | `__tests__/architecture.nodetest.js` — prohibited import scan |
| Deliberate public entry point | `__tests__/architecture.nodetest.js` — exact export set |
| Versioned stateless Decision Application façade | `__tests__/decisionApplication.nodetest.js` — exact three-operation surface, explicit version validation, immutable opaque state and no hidden application memory |
| Serializable application state | decision-application round trip — intake → JSON → apply decisions → JSON → evaluate works in a new façade instance |
| Explicit decision targets and operations | decision-application target/decision tests — stable party/claim IDs, entity registration, identity resolution, claim adjudication, undecided-target rejection and explicit uncertainty |
| Internal calculation planning / small evaluation output | decision-application full-pipeline test — policy-profile economic/voting planning, fresh deterministic snapshot, no public `calculationRequests`, graph or duplicate policy output |
| Typed application error contract | decision-application invalid version/input/state/target/decision/evaluation tests — one public error type with stable codes and protected-state tamper rejection |
| Optional adapter dependency direction | `../integrations/ubo-control/legacy-discovery/__tests__/architecture.nodetest.js` — core never imports integrations; adapter imports only the public UBO root |
| Production legacy HTTP transport | adapter `httpTransport.nodetest.js` — configured HTTP(S) base, JSON POST, timeout mapping, malformed JSON preservation and no embedded credential/hostname |
| One external composition point | adapter architecture suite — HTTP transport → legacy adapter plus public Decision Application, no core deep import, endpoint implementation import or stub fallback |
| Fresh G3.2 composition proof | adapter `liveComposition.e2e.nodetest.js` — D1 direct exact, D2 multilayer 60%×50%=30%, D3 unresolved branch and D4 voting/economic separation through a fresh snapshot |
| Integration anti-corruption invariance | G3.2 E2E pollution test — changed legacy `ubos`, effective result and threshold cannot change capability facts or fresh snapshot semantics |
| Composition failure paths | G3.2 E2E failure test — unavailable, malformed, NO_DATA and PARTIAL remain distinct and create no false qualifying owner |
| No legacy implementation import | adapter architecture suite — no `agents/ubo`, endpoint module, provider, persistence or onboarding source import |
| Legacy request minimization and transport injection | adapter L01/unsupported/configuration tests — public request validation; name/jurisdiction/explicit registration only; no thresholds/provider selection; no implicit transport |
| Legacy conclusion anti-corruption | adapter L06/L07 and invariance tests — UBO/effective ownership/control/threshold/gaps/stakeholders/reviewer/cache changes cannot alter candidate output |
| Economic/voting and percentage fidelity | adapter L01–L04 plus lower-bound test — exact ownership, reconstructable range, voting separation, ambiguous omission and UNKNOWN precision loss |
| Candidate identity and direction | adapter L01/L05 — grammatical owner-to-owned direction, legal-entity registry identifier, no legacy-node canonical identity or name merge |
| Duplicate/conflicting assertion preservation | adapter L08 — distinct source assertions remain separate candidate facts with separate support |
| Conservative capability outcomes | adapter L09–L13 — PARTIAL/NO_DATA/INCONCLUSIVE/UNSUPPORTED/UNAVAILABLE/FAILED remain distinct; no operational failure becomes NO_DATA |
| Legacy evidence-reference limits | adapter L14 — fact/operation references remain separate and no source, hash, locator or integrity proof is invented |
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
| OwnershipCase stable identity and deterministic revisions | `__tests__/ownershipCase.nodetest.js` — equivalent creation, revision/event IDs, immutable projections and external references |
| Canonical entity categories and metadata | `__tests__/ownershipCase.nodetest.js` — natural person, legal entity, trust/legal arrangement, other and unknown categories plus aliases, external IDs, jurisdiction and metadata preservation |
| Names never become canonical identity keys | `__tests__/ownershipCase.nodetest.js` — same-name canonical entities and S09 candidate endpoints remain distinct |
| Pure candidate-fact intake and source immutability | `__tests__/ownershipCase.nodetest.js` — S01 input/result cloning, stable source references and no graph mutation |
| Stable UBO candidate-claim identity and direction | `__tests__/ownershipCase.nodetest.js` — deterministic case/operation/fact IDs and original subject/relationship/object order |
| Company/LLP candidate-claim semantics | `__tests__/ownershipCase.nodetest.js` — S01 and S02 relationship/qualifier preservation |
| Range, voting, significant-control and trust claim integrity | `__tests__/ownershipCase.nodetest.js` — S10, S14, S16 and S17 exact typed structures |
| Temporal/current-state qualifier preservation | `__tests__/ownershipCase.nodetest.js` — supplied ceased/historical qualifiers remain unchanged and unadjudicated |
| Failure/no-data intake cannot create conclusions | `__tests__/ownershipCase.nodetest.js` — S06/S07 and defensive FAILED-with-fact case create operation records but zero claims |
| Conflict and duplicate candidate preservation | `__tests__/ownershipCase.nodetest.js` — S09 and S19 claims remain independently addressable and evidence-backed |
| Explicit identity operations | `__tests__/ownershipCase.nodetest.js` — existing/new entity resolution, unresolved endpoints, rejected match, unknown-key/entity and party-mismatch failures |
| Explicit claim-state transitions and append-only adjudication | `__tests__/ownershipCase.nodetest.js` — CANDIDATE→PROVISIONAL→OPERATIVE history and prior immutable projections |
| Invalid and terminal claim-state transitions | `__tests__/ownershipCase.nodetest.js` — previous-state mismatch, no-op, return-to-CANDIDATE and terminal-state rejection |
| Supersession remains reconstructable | `__tests__/ownershipCase.nodetest.js` — S19 original claims, source references and superseded-by decision remain present |
| Structural graph eligibility only | `__tests__/ownershipCase.nodetest.js` — requires OPERATIVE relationship plus two explicit resolved canonical endpoints; creates no graph |
| G2.1 remains internal/offline | `__tests__/ownershipCase.nodetest.js` and `__tests__/architecture.nodetest.js` — unchanged public exports and no provider/host/external package dependency |
| Operative-claims-only immutable graph | `__tests__/ownershipGraph.nodetest.js` — revision-pinned frozen graph; candidate/non-resolved filtering remains protected by the G2.1 eligibility suite |
| Canonical graph identity and ordering | `__tests__/ownershipGraph.nodetest.js` — fixed algorithm identity, canonical SHA-256 fingerprint, entity/fact/object-key reordering equivalence, and material-change divergence |
| Grammatical graph direction and fact-only content | `__tests__/ownershipGraph.nodetest.js` — canonical subject/object IDs, relationship bases, measurements, qualifiers and no policy conclusion fields |
| Corroborating-claim coalescence | `__tests__/ownershipGraph.nodetest.js` — S19 and focused duplicate 40% assertions produce one relationship with all supporting claim IDs and one 40% contribution |
| Distinct parallel interests | `__tests__/ownershipGraph.nodetest.js` — explicit interest qualifiers preserve separate relationships and separate path contributions |
| Conflicting operative truth set | `__tests__/ownershipGraph.nodetest.js` — incompatible same-slot values and explicitly identity-resolved S09 fail with `CONFLICTING_OPERATIVE_CLAIMS` before arithmetic |
| Exact rational percentage arithmetic | `__tests__/ownershipGraph.nodetest.js` — 40%, 60%×70%=42%, 80%×50%×40%=16%, and 0.1%+0.2%=0.3% without binary floating-point artifacts |
| Range multiplication and endpoint attainability | `__tests__/ownershipGraph.nodetest.js` — product bounds, open/closed endpoints, attainable zero lower bound and exact-zero/open-factor product |
| Multiple-path and interval aggregation | `__tests__/ownershipGraph.nodetest.js` — 18%+12%=30%, shared downstream relationship, range bound sums, and deterministic 100% cap |
| Minimum-total graph invariant | `__tests__/ownershipGraph.nodetest.js` — current same-dimension minimum interests above 100% fail with `IMPOSSIBLE_MINIMUM_TOTAL` rather than normalization |
| UNKNOWN and temporal uncertainty | `__tests__/ownershipGraph.nodetest.js` — known contribution retained as `PARTIAL`, unknown-only `UNRESOLVED`, unrelated unknown ignored, ceased excluded, unknown currentness surfaced, contradictory time state rejected |
| `NO_PATH` is not 0% | `__tests__/ownershipGraph.nodetest.js` — absent path returns non-numeric `NO_PATH` while an explicit zero path returns complete exact 0 |
| Relevant-cycle fail-safe | `__tests__/ownershipGraph.nodetest.js` — relevant cycle recorded and blocks `COMPLETE`; unrelated cycle leaves the requested calculation complete |
| Economic/voting dimension separation | `__tests__/ownershipGraph.nodetest.js` — independent values, no mixed-chain look-through, and non-percentage appointment relationship retained without multiplication |
| Gate 1 scenarios through explicit G2.1 decisions | `__tests__/ownershipGraph.nodetest.js` — unchanged S01, S02, S03, S04, S09, S10, S14, S18 and S19 inputs materially exercise graph semantics |
| G2.2 remains internal/offline and policy-free | `__tests__/ownershipGraph.nodetest.js` and `__tests__/architecture.nodetest.js` — no public export expansion, host/provider/network dependency, threshold or UBO/PSC/controller conclusion |
| Executable `ubo-condition-v1` three-valued semantics | `__tests__/policyDetermination.nodetest.js` — exhaustive AND/OR truth tables, comparisons, precedence, explicit null/missing rules, and invalid syntax as `POLICY_CONFIGURATION_ERROR` without dynamic evaluation |
| Pack and requirement applicability remain separate | `__tests__/policyDetermination.nodetest.js` — COMPANY/LLP in-scope, explicit out-of-scope route, unknown profile, and per-requirement `APPLIES`/`DOES_NOT_APPLY`/`UNKNOWN` results |
| Policy-owned exclusive percentage thresholds | `__tests__/policyDetermination.nodetest.js` — below/equal/above boundaries, a non-25 pack value, exact range endpoints, and no hard-coded jurisdiction threshold |
| Partial, unresolved, cycle-bearing and `NO_PATH` interpretation | `__tests__/policyDetermination.nodetest.js` — known positive partial contribution may satisfy, while incomplete evidence and no path never produce a negative determination |
| Economic and voting bases stay separate | `__tests__/policyDetermination.nodetest.js` — R01 consumes only ECONOMIC and R04 only VOTING G2.2 results without recomputation or basis conversion |
| COMPANY/LLP economic and appointment semantics | `__tests__/policyDetermination.nodetest.js` — S01/S02-shaped percentage facts and explicit S15 COMPANY/LLP majority qualifiers produce only pack-defined roles; generic appointment rights do not qualify |
| Significant-control establishment versus ambiguity | `__tests__/policyDetermination.nodetest.js` — explicit operative P02-shaped control can satisfy while S16-style ambiguous rights remain `REVIEW_REQUIRED` and do not qualify a person |
| Natural-person-only qualifying projection | `__tests__/policyDetermination.nodetest.js` — multiple bases merge into one canonical natural person; qualifying legal entities remain explicitly unresolved and are never emitted as people |
| Policy determination pinning and purity | `__tests__/policyDetermination.nodetest.js` — exact pack ID/version/hash/schema and algorithm identity, deterministic deep-frozen output, source/calculation immutability, and tampered identity rejection |
| G2.3 remains internal/offline and stops before resolution planning | `__tests__/policyDetermination.nodetest.js` and `__tests__/architecture.nodetest.js` — no public export expansion, InformationNeed/gap/action/question/document/analyst-task/SMO/snapshot/persistence/provider/onboarding behavior |
| EvidencePolicyClassification identity and audit boundary | `__tests__/requirementResolution.nodetest.js` — deterministic policy-hash/case-revision pin, explicit source origin/support, malformed rejection, case-reference linkage, immutability, and retained unclassified evidence |
| Non-additive evidence strength and independent constraints | `__tests__/requirementResolution.nodetest.js` — minimum pass/fail, two low items never add, `canResolveAlone`, corroboration, `POSITIVE_ONLY`, `CORROBORATIVE_ONLY`, and no provider numeric authority |
| Evidence currentness and deterministic freshness | `__tests__/requirementResolution.nodetest.js` — supplied evaluation date, Policy Pack calendar-month maximum age, and current versus stale/historical handling without system time |
| Distinct independent-source corroboration | `__tests__/requirementResolution.nodetest.js` — applicant declaration failure, configured one/two-source thresholds, same durable source deduplication, distinct-source counting, and `UNKNOWN` origin exclusion |
| Approved requirement-state precedence | `__tests__/requirementResolution.nodetest.js` — `N_A`, applicability `UNRESOLVED`, explicitly relevant `CONFLICT`, G2.3 `REVIEW_REQUIRED`, evidenced `RESOLVED`, substantive `GAP`, and operational-only `UNRESOLVED` |
| R01/R02/R03 resolution semantics | `__tests__/requirementResolution.nodetest.js` — evidenced direct natural person, unresolved legal holder need, COMPLETE calculation, partial/cycle gap, and separately evidenced intermediate existence/relationships |
| R04/R05/R06 control resolution | `__tests__/requirementResolution.nodetest.js` — separate evidenced voting/appointment/other-control bases, shared legal-entity resolution need, S16 review precedence, HIGH-risk attestation restriction, and PSC silence non-negativity |
| R07 identity-attribute boundary | `__tests__/requirementResolution.nodetest.js` — canonical name/control basis plus operative `ENTITY_ATTRIBUTE` claims, only explicitly required missing attributes, and no IDV/POI/POA/screening need |
| R08 corroboration without UBO inference | `__tests__/requirementResolution.nodetest.js` — independent PSC evidence may resolve corroboration while creating no qualifying person or R01 conclusion |
| R11/R12 specialist and explicit-fact boundaries | `__tests__/requirementResolution.nodetest.js` — trust presence remains specialist review, incomplete structure cannot prove no trust, nominee positive needs a principal, and silence cannot prove no nominee/bearer arrangement |
| Capability outcomes remain distinct | `__tests__/requirementResolution.nodetest.js` — COMPLETE/PARTIAL/NO_DATA/INCONCLUSIVE/UNSUPPORTED/UNAVAILABLE/FAILED semantics; only unavailable/failed create OperationalBlockers and never PolicyGaps by themselves |
| InformationNeed semantics and lifecycle | `__tests__/requirementResolution.nodetest.js` — shared semantic need deduplication, different-concept separation, OPEN→SATISFIED→reopened append-only reconstruction, and unordered permitted strategies |
| G2.4A purity and exclusions | `__tests__/requirementResolution.nodetest.js` and `__tests__/architecture.nodetest.js` — deterministic deep-frozen output/input immutability, no public export, action/priority/question/document/task/fallback/outcome/snapshot/provider/persistence/onboarding behavior |
| UK Corporate 1.4-RC schema successor | `__tests__/ukPolicyPack14.nodetest.js` — schema 1.1 identity/hash, immutable 1.3-RC compatibility, exact asynchronous fallback policy, senior-candidate distinction, terminal precedence, source traceability and data-only boundary |
| ResolutionOption versus ActionIntent | `__tests__/resolutionOrchestration.nodetest.js` — multiple unranked policy options, unique applicable action, policy-content blocking, fact/evidence/template references and no generic priority field |
| Semantic action coalescence | `__tests__/resolutionOrchestration.nodetest.js` — shared need/requirement references produce one intent while unrelated semantic targets remain distinct |
| Operational intent separation | `__tests__/resolutionOrchestration.nodetest.js` — failed/unavailable capability produces retry/hold and never automatic customer evidence collection |
| Append-only ResolutionAttempt | `__tests__/resolutionOrchestration.nodetest.js` — deterministic sequence, retained NO_DATA followed by success, operationally blocked provider outcome, reference-only results and no direct requirement mutation |
| Asynchronous fallback-review candidate | `__tests__/resolutionOrchestration.nodetest.js` — pre-requirement/customer-need/specialist/operational preconditions, no synchronous analyst dependency, preparatory senior-management collection and repeat-question suppression |
| Review package and decision pins | `__tests__/resolutionOrchestration.nodetest.js` — exact case/policy/graph/manifest references, durable measures-taken summary, current analyst/compliance decision, stale-decision rejection and caller-eligibility bypass protection |
| Negative exhaustion decision | `__tests__/resolutionOrchestration.nodetest.js` — concrete further InformationNeed required, no generic RFI, and InformationNeed precedes later option/action planning |
| Valid SMO application | `__tests__/resolutionOrchestration.nodetest.js` — explicit canonical senior candidate only, role after positive exhaustion decision, measures/decision references, existing role isolation and Policy Pack HIGH signal |
| R09 discrepancy states | `__tests__/resolutionOrchestration.nodetest.js` — explicit match, potential mismatch/review, PSC silence protection, PSC/MLR definition difference, non-material rationale and no reporting submission |
| R13 and UBO risk signals | `__tests__/resolutionOrchestration.nodetest.js` — configured depth/cross-border signals with graph/calculation basis, R11 trust and R10 fallback signals, and no authoritative host-risk mutation |
| R14 residual completeness | `__tests__/resolutionOrchestration.nodetest.js` — not actionable before closing boundary, one attestation action when ready, referenced positive resolution of R14 only, and missing/refused blocking of normal resolution |
| Terminal precedence | `__tests__/resolutionOrchestration.nodetest.js` — ordinary/fallback/specialist/CDD outcomes, conflict/incomplete IN_PROGRESS, no unapproved provisional path and no terminal-count shortcut |
| G2.4B purity and exclusions | `__tests__/resolutionOrchestration.nodetest.js` and `__tests__/architecture.nodetest.js` — deterministic frozen offline output, unchanged public exports, no snapshot/hash/history/provider/persistence/UI/onboarding/AI-reviewer behavior |
| DecisionSnapshot canonical identity | `__tests__/decisionSnapshot.nodetest.js` — stable object-order identity, SHA-256 canonical hash, recording-metadata exclusion, checkpoint/event inclusion and tamper rejection |
| Material hash sensitivity | `__tests__/decisionSnapshot.nodetest.js` — Policy Pack hash, effective parameter, operative claim, graph, calculation, qualifying person, requirement resolution, InformationNeed, review decision and terminal changes all diverge |
| Snapshot consistency validation | `__tests__/decisionSnapshot.nodetest.js` — mixed case/graph revision, stale Policy Pack identity, evaluation-time mismatch and inconsistent terminal state fail deterministically |
| Append-only linear DecisionHistory | `__tests__/decisionSnapshot.nodetest.js` — explicit genesis, predecessor link, immutable prior snapshot, typed stale-head rejection and no silent fork |
| Historical policy and algorithm pinning | `__tests__/decisionSnapshot.nodetest.js` — later policy/algorithm checkpoint creates a successor while the old snapshot remains reconstructable under its original identity |
| Historical reconstruction | `__tests__/decisionSnapshot.nodetest.js` — resolved, partial/open need, internal review, SMO fallback, specialist and conflict states reproduce exactly without recalculation |
| R10 snapshot measures manifest | `__tests__/decisionSnapshot.nodetest.js` — fallback snapshot retains review manifest hash, attempts/capability/evidence/calculation/requirement references, review requirement, decision, role and HIGH signal |
| Explicit checkpoint re-resolution | `__tests__/decisionSnapshot.nodetest.js` — customer fact and analyst review CASE_EVENT successors, unchanged predecessors, SUBMIT_GATE non-final truth and deterministic history append |
| End-to-end Gate 2 determinism | `__tests__/decisionSnapshot.nodetest.js` — same case/policy/checkpoint/algorithm inputs produce equivalent content/hash entirely offline with no system time or provider/persistence dependency |
| G2.4C purity and exclusions | `__tests__/decisionSnapshot.nodetest.js` and `__tests__/architecture.nodetest.js` — internal-only coordinator, unchanged public exports, no provider execution, persistence, host/UI, scheduler or Gate 3 behavior |
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
| Supplied assertion inventory is complete without false behavioral coverage | `__tests__/ukPolicyPack.nodetest.js` — exact 22-item one-to-one plan with 1 G2.1, 4 G2.2, 5 G2.3, 6 G2.4A, 5 G2.4B-deferred and 1 later-integration classifications |
| Canonical policy serialization | `__tests__/policyPack.nodetest.js` — fixed canonicalization vector |
| Stable policy hash across insignificant formatting | `__tests__/policyPack.nodetest.js` — whitespace/order/line-ending equivalence |
| Material policy change changes identity | `__tests__/policyPack.nodetest.js` — changed-data hash vector |
| Policy hash pinning and immutable load | `__tests__/policyPack.nodetest.js` — expected hash and frozen result |
| Composition validates capability traffic | `__tests__/composition.nodetest.js` — request/result validation and request ID correlation |
| Scripted Discovery/Extraction service shapes | `__tests__/scriptedStubs.nodetest.js` — approved duck types and production composition with explicit injection |
| Exact sequential stub responses and exhaustion | `__tests__/scriptedStubs.nodetest.js` — configured ordering, exact outcomes, request correlation, and visible queue exhaustion |
| Stub defensive copying and fixture immutability | `__tests__/scriptedStubs.nodetest.js` and `__tests__/scenarioCorpus.nodetest.js` — configuration isolation, frozen run results, repeat runs |
| No implicit/public stub selection | `__tests__/scriptedStubs.nodetest.js` and `__tests__/architecture.nodetest.js` — no composition import/fallback and unchanged exact public exports |
| Required scenario universe | `__tests__/scenarioCorpus.nodetest.js` — exact S01–S20 and P01–P08 indexes |
| Every scenario is contract-valid and executable | `__tests__/scenarioCorpus.nodetest.js` — per-core named tests, focused-fixture execution, and production-validator corruption cases |
| COMPANY/LLP semantics remain distinct | `__tests__/scenarioCorpus.nodetest.js` — SHARE_OWNERSHIP versus SURPLUS_ASSET_RIGHTS and board versus LLP management concepts |
| Ownership/voting/control bases are not retyped | `__tests__/scenarioCorpus.nodetest.js` — S14–S16 exact relationship and qualifier assertions |
| Multilayer/multipath/conflict/cycle/duplicate facts remain separate | `__tests__/scenarioCorpus.nodetest.js` — S03, S04, S09, S18, and S19 direction/order/cardinality |
| Exact/range/unknown values survive scenario execution | `__tests__/scenarioCorpus.nodetest.js` — S01, S10, and S12 exact structures with no scalar coercion |
| Fact versus operation evidence in scenarios | `__tests__/scenarioCorpus.nodetest.js` — S03 different subsets and operation-only reference |
| NO_DATA versus UNAVAILABLE/FAILED | `__tests__/scenarioCorpus.nodetest.js` — S06, S07, and S13 exact outcomes with no fabricated facts |
| New/canonical/same-name candidate identities | `__tests__/scenarioCorpus.nodetest.js` — S01, P06, and S09 without name-based merging |
| Trust and listed/out-of-scope representability | `__tests__/scenarioCorpus.nodetest.js` — S17 trust relationships and S20 policy route input without routing |
| Future reasoning remains non-executed metadata | `__tests__/scenarioCorpus.nodetest.js` — forbidden decision-output scan and exact future-expectation status |
| Scenario/policy referential integrity | `__tests__/scenarioCorpus.nodetest.js` and `__tests__/ukPolicyPack.nodetest.js` — requirements/actions/evidence/scenario IDs exist; B/E unresolved references unchanged |
| Entire corpus runs offline without legacy/provider services | `__tests__/scenarioCorpus.nodetest.js` and `__tests__/architecture.nodetest.js` — blocked network run and prohibited dependency scan |

## UK Corporate supplied assertion plan

These are the 22 behavioral assertions carried into UK Corporate 1.4-RC. G1.2B still protects representability and input setup. The current honest execution inventory is one `G2_1_EXECUTABLE`, four `G2_2_EXECUTABLE`, five `G2_3_EXECUTABLE`, six `G2_4A_EXECUTABLE`, five `G2_4B_EXECUTABLE`, and one `G2_4C_EXECUTABLE`. G2.4C now protects the actual immutable R10 measures-taken DecisionSnapshot; persistence and host integrations remain later work.

| Requirement | Supplied assertion | Status | G1.2B scenario input | Deferred behavior |
|---|---|---|---|---|
| UBO-R01 | COMPANY: direct qualifying share owner is identified from supported evidence. | `G2_3_EXECUTABLE` | S01 | Protected at G2.3: qualification/projection; G2.4A separately protects sufficiency/resolution |
| UBO-R01 | LLP: qualifying rights to surplus assets are evaluated using LLP semantics. | `G2_3_EXECUTABLE` | S02 | Protected at G2.3: LLP qualification/projection; G2.4A separately applies sufficiency |
| UBO-R01 | Corporate holder creates an InformationNeed until ultimate natural persons are resolved. | `G2_4A_EXECUTABLE` | S05, S11 + focused shared-need fixture | Protected: semantic `CURRENT_OWNERSHIP_AND_CONTROL` need without question/document selection |
| UBO-R02 | Percentage chains multiply deterministically. | `G2_2_EXECUTABLE` | S03 + focused exact fixtures | Protected: exact homogeneous-chain arithmetic; qualification remains deferred |
| UBO-R02 | Independent qualifying paths aggregate. | `G2_2_EXECUTABLE` | S04 + focused multipath fixtures | Protected: distinct-path arithmetic; “qualifying” policy remains deferred |
| UBO-R02 | Ranges remain ranges/min-max rather than being silently converted to exact percentages. | `G2_2_EXECUTABLE` | S10 + focused interval fixtures | Protected: range/endpoint arithmetic; threshold interpretation remains deferred |
| UBO-R02 | Cycles cannot silently produce a numeric answer. | `G2_2_EXECUTABLE` | S18 + focused relevant-cycle fixture | Protected: relevant-cycle recording blocks `COMPLETE`; policy consequence remains deferred |
| UBO-R05 | COMPANY: qualifying board-majority appointment right produces controller_appointment. | `G2_3_EXECUTABLE` | S15 | Protected at G2.3: COMPANY qualification/role; G2.4A separately applies sufficiency |
| UBO-R05 | LLP: qualifying majority-management appointment right produces controller_appointment. | `G2_3_EXECUTABLE` | S15 | Protected at G2.3: LLP qualification/role; G2.4A separately applies sufficiency |
| UBO-R05 | Risk checkpoint HIGH invalidates attestation-only closure and produces documentary gap without bespoke screen logic. | `G2_4A_EXECUTABLE` | P08 + focused HIGH-risk attestation fixture | Protected: semantic PolicyGap/InformationNeed; document request remains deferred |
| UBO-R06 | Positive registry control fact may create a candidate claim. | `G2_1_EXECUTABLE` | P02 | Protected: candidate-claim creation; G2.3 separately protects explicit established-control qualification |
| UBO-R06 | Absence of PSC condition-4 data does not negatively resolve the requirement. | `G2_4A_EXECUTABLE` | P02, S06 + focused PSC-silence fixture | Protected: `POSITIVE_ONLY` and NO_DATA never prove negative control |
| UBO-R06 | Ambiguous veto/decision rights route to REVIEW_REQUIRED rather than automatic UBO determination. | `G2_3_EXECUTABLE` | S16 | Protected: review-required assessment with no automatic person qualification; analyst action deferred |
| UBO-R08 | Customer declaration alone cannot resolve R08. | `G2_4A_EXECUTABLE` | P01 + focused origin fixture | Protected: applicant-originated evidence does not count independently |
| UBO-R08 | Numeric evidence strength alone cannot bypass independent-source requirement. | `G2_4A_EXECUTABLE` | P01 + focused configured-count fixtures | Protected: strength and distinct independence are separate constraints |
| UBO-R08 | Companies House PSC information may corroborate but must not automatically become final UBO conclusion. | `G2_4A_EXECUTABLE` | P01, P02 + focused PSC fixture | Protected: R08 corroboration may resolve without a person/R01 conclusion |
| UBO-R09 | Material missing PSC may create reportable discrepancy workflow. | `G2_4B_EXECUTABLE` | P07 + focused explicit-difference fixture | Protected as `POTENTIAL_DISCREPANCY` plus host-neutral analyst review; legal report submission remains outside UBO Control |
| UBO-R09 | Difference caused only by PSC-vs-MLR definition mismatch is not automatically reportable. | `G2_4B_EXECUTABLE` | P07 + focused definition fixture | Protected as `NON_REPORTABLE_DEFINITION_DIFFERENCE` only from explicit rationale |
| UBO-R09 | Non-material discrepancy records rationale without automatically invoking report workflow. | `G2_4B_EXECUTABLE` | P07 + focused non-material fixture | Protected: explicit rationale retained, no regulatory action generated |
| UBO-R10 | Fallback cannot activate merely because DiscoveryService returned NO_DATA. | `G2_4B_EXECUTABLE` | S06, P03 + attempt fixture | Protected: NO_DATA remains a no-resolution attempt and cannot derive eligibility |
| UBO-R10 | Fallback cannot activate when required measures were not actually completed. | `G2_4B_EXECUTABLE` | P03 + candidate-precondition fixtures | Protected: incomplete requirements/needs/specialist/operational state blocks review candidacy |
| UBO-R10 | Review package and positive exhaustion decision record measures taken and reason fallback was permitted. | `G2_4C_EXECUTABLE` | P03 + package/decision/snapshot fixtures | Protected by the actual immutable DecisionSnapshot measures-taken manifest and reconstructable fallback decision |
