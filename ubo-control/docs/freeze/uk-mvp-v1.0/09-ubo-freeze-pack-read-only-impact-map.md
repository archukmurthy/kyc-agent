# UBO Control UK MVP Freeze Pack v1.0 — read-only impact map

Audit date: 2026-09-03  
Authority order applied: File 01 → File 08 → Files 02–07 → current architecture/ADRs/tests.  
Repository basis: PR #45 head `5d7b68780283a9477d04a8c2f8be767285296d93`.

This document executes File 09 only. It is an impact map, not an implementation plan authorization. No production code, Policy Pack, test, fixture, adapter, UI, migration or PR content was changed.

## A. Executive impact verdict

The current fresh UBO Control is a sound base for the freeze, but it is **not freeze-compliant as a whole**. Its strongest reusable assets are the standalone boundary, candidate-before-conclusion model, explicit identity/adjudication, canonical graph, exact homogeneous-dimension arithmetic, evidence-reference boundary, immutable history, asynchronous fallback architecture, public projection seams, and the repaired PR #45 Lab graph interactions.

The principal gaps are additive domain and orchestration capabilities rather than reasons to rewrite the core:

1. no Schedule 1A/PSC-condition attribution engine;
2. no per-layer/per-dimension closure evaluator or firm threshold overlay;
3. qualification bases lack the frozen statutory/firm classification and route/method vocabulary;
4. calculation planning and R01/R04 need generation fan out across reverse-reachable intermediaries;
5. R02/R03/R07 applicability still depends on caller-supplied placeholder facts rather than earlier derived phases;
6. InformationNeed identity/state/target vocabulary is too narrow for causal frontiers and double-counted path diagnostics remain separate projected unresolved items;
7. the planner has no acquisition-strategy state, RegistryCapabilityProfile, predictive chart pivot, or no-oscillation pin;
8. snapshots are currently created **before** the separate public planner runs, conflicting with the freeze's required plan-before-snapshot phase and profile pinning;
9. listed treatment, R09 taxonomy/report-candidate semantics, measure-category dispositions, residual bundle and production approval guard are not implemented;
10. the Lab lacks the freeze's review-policy watermark, ownership-first control toggles, frozen edge/node status vocabulary and separate attribution explanation; applicant projection remains more diagnostic than the frozen minimal journey.

Recommended architectural stance: preserve v1.5-RC and all v1 public artifacts; implement the freeze through a schema-1.3/v1.6-RC successor, new versioned reasoning artifacts and v2 projection/plan/snapshot contracts, while keeping Decision Application v1/v2 available unchanged. Do not retrofit new doctrine into historical v1 snapshots.

Release verdict: **Lab-only successor work may begin in controlled PR waves after Control Room authorization; production approval remains blocked by File 08 sign-offs, especially A-08, A-09, A-10 and A-11.** LLP/TDR attribution remains provisional under A-06.

## B. Preserve unchanged

These current modules already implement freeze invariants and should remain behaviorally unchanged except for narrow additive integration points:

| Existing seam | Preserve because |
|---|---|
| `ubo-control/contracts/candidateFact.js`, `candidatePartyReference.js`, `capability.js`, `evidenceReference.js`, `identityResolutionDecision.js`, `percentageValue.js` | Candidate facts remain non-authoritative, party identity is explicit, exact/range/unknown values survive, capability outcomes stay typed, and only provider-neutral durable evidence references enter core. Capability contract `1.0.0` need not change. |
| `ubo-control/domain/ownershipCase.js` and `candidateClaim.js` | Explicit registration, identity decisions, claim adjudication, immutable revisions, no name-based merge, and no direct graph mutation satisfy Files 01/03/07. |
| `ubo-control/domain/ownershipGraph.js` | `ubo-graph-v1` admits only operative claims, coalesces corroboration without doubling rights, rejects incompatible slots/impossible minimum totals, preserves parallel semantic relationships and currentness. Additive qualifiers may be needed for new attribution/closure inputs, but the graph algorithm itself need not be rewritten. |
| `ubo-control/domain/exactPercentage.js` and `percentageCalculation.js` | `ubo-percentage-lookthrough-v1` already supplies exact rational arithmetic, interval endpoints, path multiplication, same-person independent-path aggregation, cycle safety, `NO_PATH`, and strict economic/voting separation required by the freeze. It should remain the effective-interest route only. |
| `ubo-control/policy/canonicalJson.js` and policy hashing/loading architecture | Canonical identity, data-only validation, hashing and immutable loading remain correct. Add schema 1.3 validation beside existing schemas rather than changing old hashes. |
| `ubo-control/policy/evidencePolicy.js` | Provider-neutral classification, currentness/freshness, non-additive strength, independence and corroboration boundaries are reusable. Extend classifications for percentage evidence states; do not replace the evidence model. |
| `ubo-control/domain/decisionSnapshot.js` history principles | Append-only linear history, immutable predecessors, policy/algorithm pins and reconstruction-without-recalculation exactly match the freeze. Preserve v1 reconstruction; add a new snapshot version/dispatcher. |
| `ubo-control/composition/createUboControl.js` | Exactly two injected capability ports and no implicit provider selection are frozen invariants. |
| `integrations/ubo-control/legacy-discovery/` | Correctly remains outside core and now gives Companies House nature-of-control priority over synthetic legacy conclusions. Its public capability output should remain `1.0.0`; do not modify legacy Discovery. |
| `ubo-control/domain/resolutionOrchestrationArtifacts.js` and the asynchronous fallback decision boundary | `InformationNeed → ResolutionOption → ActionIntent → ResolutionAttempt`, pinned review packages, analyst/compliance authority, stale-decision rejection and no `NO_DATA` fallback are reusable. Add category dispositions rather than replacing the review model. |
| `ubo-control/application/applyCustomerInput.js` | Strict planned-action correlation, candidate-not-operative customer facts, exact identity rules, immutable history and evidence handoff boundary remain correct. New customer actions should use a successor event contract. |
| `ubo-control/projection/ownershipGraphProjection.js`, `uboJourneyProjection.js`, and public stateless projection pattern | The separation from policy/calculation and verified-snapshot input are correct. Retain v1 implementations for v1 snapshots and add successor projections. |
| `ubo-control-ui/OwnershipGraph.js` PR #45 work | One canonical node per entity, one graph, readable Fit width/Overview, deterministic unresolved inspection, parallel-edge lanes, node/edge selection and clear-selection behavior satisfy important File 06/07 interaction invariants. |
| `ubo-control-ui/UboJourney.js` boundary | Host-neutral rendering from public projections/plans and emission of data-only customer actions are correct architectural seams. The content and contract require a successor, not a move into core. |
| Existing adapter, architecture, arithmetic, identity, snapshot and Lab regression tests | File 07 §3 is substantially covered and should remain a permanent compatibility net. |

## C. Conflict/change list

| Frozen change | Current behavior/conflict | Required disposition | Primary risk/sign-off |
|---|---|---|---|
| Qualification basis model | Current basis records type, holder, state, threshold and calculation/relationship references, but not statutory vs firm classification, legal route/limb, method status, direct/indirect, attribution trace or complete evidence lineage. `qualifyingPersons` is role-centric. | **Modify/add** immutable qualification-basis v2 model; retain all successful bases. | High legal/audit risk; A-09, A-06 for LLP. |
| PSC/Schedule 1A attribution | No `ubo-psc-attribution-v1`; PSC data is source/reconciliation input only. Percentage multiplication is the only indirect quantitative method. | **Add** separate pure attribution algorithm. Do not alter percentage engine. | Critical; company mapping A-09, LLP/TDR A-06, joint A-13, appoint/remove A-12. |
| Layer closure | No direct-layer residual evaluator; R01 legal-entity bases create open needs without threshold-sensitive closure. | **Add** pure `layerClosure` algorithm with denominator/overlap/currentness/joint qualifiers. | High; A-03 for declaration-band sufficiency. |
| Firm threshold overlay | v1.5 says statutory parameters may be lowered; lowering currently changes statutory role projection. This conflicts with separate statutory and stricter firm outputs. | **Replace in successor policy**, **add** parallel firm qualification/closure output; leave v1.5 immutable. | Critical misclassification risk; A-18 deferred for layer-holder option. |
| Phased evaluation | Current broad order is graph → calculations → policy → requirements → orchestration → snapshot, but R02/R03 read caller `facts.ownership_layers`, R07 reads caller `facts.qualifying_persons_count`, and R13 derives depth only later. Public plan is computed after snapshot. | **Refactor/add** acyclic coordinator with derived phase context. Resolve plan-before-snapshot/profile-pin conflict through a new versioned coordinator/snapshot, not circular calls. | High determinism/compatibility risk. |
| R01–R14 rescoping | Several requirements are sound, but R01/R04 fan out and R02/R03/R07 applicability uses placeholders. R09/R10/R11/R12/R14 need successor semantics described below. | **Modify** resolvers and successor pack; keep IDs but version meaning with policy 1.6. | High; requirement-by-requirement dependencies in §H. |
| Frontier InformationNeeds | Current semantic target is only optional entity/relationship/attribute + concept; identity omits policy version, target kind, temporal scope and causal frontier. Current states are only OPEN/SATISFIED/SUPERSEDED. | **Modify/add** InformationNeed v2 with causal target kinds, dependent diagnostics and expanded state/projection model. | High migration/deduplication risk. |
| Projection dedup/status | `projectUnresolved` emits both open needs and unresolved calculation paths. ASDA displays 35 items from 20 needs + 15 paths. Nodes can inherit broad unresolved presentation. | **Replace in projection v2** with causal need counts plus separately linked affected paths; add frozen edge/node vocabularies. | High UX/audit interpretation risk. |
| RegistryCapabilityProfile | Absent. Planner accepts only a DecisionSnapshot and cannot pin capability/entitlement context. | **Add** provider-neutral profile contract outside Policy Pack and new planner/snapshot pins. | A-15; stale/false entitlement risk. |
| Chart-assisted pivot | Planner selects existing allowed options by friction wave; chart is recommended only if an option explicitly names it. No DISCOVERY_LED/CHART_ASSISTED/SPECIALIST strategy, predictive pivot or no-oscillation state. | **Modify in planner v2**; add acquisition strategy and wave identity, keep charts as candidate facts. | Medium/high; operational configuration and Evidence dependency. |
| Residual bundle | Current bundles group by entity/family/action. R06 B4 and R11 B2 are content-blocked; R12 and R14 are separate. There is no one-screen bundle with independently stored statements. | **Add** plan/journey/action v2 bundle projection; each statement remains separate. | A-02 and A-17 block production. |
| Listed treatment | `listed_company` returns out-of-scope route metadata only. No listing evidence evaluation, listed-subsidiary rule or intermediate terminus. | **Add** policy-driven facts/outcomes. Keep arbitrary intermediate terminus OFF. | A-14 customer, A-07 subsidiary, A-01 optional intermediate. |
| SMO measure categories | Current review package summarizes actual ResolutionAttempts but has no category inventory or EXECUTED/UNAVAILABLE/IRRELEVANT/DISPROPORTIONATE dispositions/reasons. | **Extend** fallback manifest and snapshot under new versions; preserve async authority. | A-10 blocks production. |
| R09 taxonomy | Current states are NO_DISCREPANCY, POTENTIAL_DISCREPANCY, NON_REPORTABLE_DEFINITION_DIFFERENCE, REVIEW_REQUIRED; explicit NON_MATERIAL can resolve. No frozen four-category taxonomy or analyst-confirmed Reg 30A report candidate. | **Modify/add** typed comparison and review output; regulatory submission remains host-owned. | High; legal/reportability mapping. |
| Runtime policy approval guard | Loader validates structure/hash but accepts CONTROL_ROOM_REVIEW, null effective date and null approver in any composition. No release-signoff/algorithm compatibility guard. | **Add** explicit runtime mode/guard; Lab may allow review packs, production must fail closed. | A-08/A-09/A-10/A-11 plus enabled optional sign-offs. |
| Lifecycle events | v1.5 retains opaque unresolved E01/E02/E08/E10 references. | **Replace only in v1.6** with approved semantic event IDs after source recovery. | A-16. |
| Applicant projection | Current journey is semantic and progressive, but lacks acquisition strategy, chart/guided-builder route, residual statement bundle, delegation/as-at provenance and a deliberately simple established-spine/frontier projection. | **Add successor journey/plan/action contracts**; keep full graph optional and analyst detail out. | A-02/A-04/A-17 and host integration. |
| Lab projection | PR #45 fixes graph size/selection and one-graph behavior, but there are no ownership/control toggles, frozen edge/node status vocabulary, separate effective/attribution/management routes, causal counts or persistent review-policy watermark. | **Modify Lab against v2 projections** after domain contracts land. | Medium; must not hide unresolved doctrine or hard-code ASDA. |

### Freeze-to-repository documentation conflicts requiring Control Room resolution

1. File 02 examples use snake_case fields such as `policy_id`, `schema_version`, `qualification_doctrine`; the current strict schema uses camelCase (`policyPackId`, `schemaVersion`, etc.). File 02 is explicitly a change specification, not final JSON, so the canonical schema-1.3 field naming/mapping is unresolved and must not be guessed.
2. v1.5's statutory threshold parameter says it may be lowered; File 01 requires a fixed statutory result plus separate stricter firm overlay. This is a real policy conflict resolved only by an immutable v1.6 successor, never by reinterpreting v1.5.
3. ADR 0017/0015 currently places the authoritative DecisionSnapshot at the end of re-resolution and ADR 0021 derives the public plan afterward. File 01 phase order and File 02 profile pinning require resolution planning before the snapshot. A successor architecture decision is required.
4. ADR 0013 deliberately models operational blockers and specialist/review artifacts separately from the three-state InformationNeed lifecycle. File 04 calls REVIEW_REQUIRED, BLOCKED_OPERATIONALLY and SPECIALIST minimum need states. The successor must decide whether these become actual need states or a normalized projection over separate artifacts; this export does not decide.
5. File 08 defines a status vocabulary but its register table contains no status column or per-row status values. No supplied entry can be evidenced as `APPROVED`; defaults must therefore remain in force. File 01 explicitly calls A-06 open. Control Room should add explicit status/evidence records before implementation treats any sign-off as complete.
6. Root repository guidance says UK/EU UBO is “25% or more”; the current fresh Policy Pack and Freeze File 01 require **more than 25%**. Fresh UBO correctly uses the exclusive pack comparator. The older root guidance must not govern fresh UBO implementation.

## D. File/module mapping

| Change area | Current module/file | Current behavior | Target seam | Disposition | Contract/data/history/test impact | Risk |
|---|---|---|---|---|---|---|
| Policy schema/guard | `policy/policyPack.js`; `policies/uk-corporate/1.5-rc/policy.json`; `lab/server/labEngine.js` | Strict schemas 1.0–1.2; Lab literal-loads 1.5; no production-readiness guard. | Add schema-1.3 validator and runtime load mode/approval check; add immutable `1.6-rc/`. | Add; keep old. | New policy hash; v1.5 snapshots untouched; new validation/safety tests. | Critical. |
| Qualification records | `policy/policyDetermination.js` | Basis types and roles, any satisfied natural-person basis projects qualification. | Extend/replace internal basis projection with route-aware `QualificationBasis` v2 and statutory/firm result. | Modify/add. | Snapshot/projection v2; old v1 basis retained. | Critical. |
| Effective interest | `domain/exactPercentage.js`; `domain/percentageCalculation.js` | Correct homogeneous exact/range arithmetic. | Keep algorithm; identify output method as `EFFECTIVE_INTEREST`/`ADOPTED_INTERPRETATION`. | Keep + metadata adapter. | Prefer wrapper metadata in v2, no arithmetic version change. | Low. |
| PSC attribution | No current module; source PSC facts enter graph via adapters; R09 compares summaries. | Absent. | New pure `domain/pscAttribution.js` plus policy configuration interpreter. | Add. | New algorithm pin, snapshot/projection v2; extensive gated tests. | Critical. |
| Layer closure | No current evaluator. | R01 bases/needs substitute for closure. | New pure `domain/layerClosure.js`. | Add. | New algorithm pin and causal diagnostics. | High. |
| Percentage evidence state | `policy/evidencePolicy.js`; evidence classifications in resolution inputs | Strength/origin/currentness/effect, not declared/band/exact state. | Add percentage-specific classification fields/rules without mutating numeric claims. | Modify/add. | Evidence classification/snapshot v2; A-03 tests. | High. |
| Phased coordinator | `application/createUboDecisionApplication.js#planCalculations`; `application/reResolveDecision.js` | Broad requests, caller placeholder facts, snapshot before public plan. | New coordinator version with immutable phase artifacts and earlier derived facts. | Replace orchestration path for successor only. | Decision Application/snapshot/plan version decision; keep v1/v2 paths. | High. |
| Need targets/lifecycle | `domain/resolutionArtifacts.js`; `policy/requirementResolution.js` | Entity-centric semantic identity; three need states; separate gaps/blockers/reviews. | Add target kind, causal frontier/edge, temporal/policy identity, dependent diagnostics; reconcile state-model decision. | Modify/add. | Snapshot and projections v2; historical record IDs unchanged. | High. |
| Need projection | `projection/ownershipGraphProjection.js#projectUnresolved` | Needs and affected paths are peer unresolved entries. | Causal `needs`, separate `affectedCalculations/paths`, correct counts. | Replace in projection v2. | Graph projection v2/UI tests. | High. |
| Acquisition planner | `planning/uboResolutionPlanner.js` | System/customer/internal wave from options; no capability profile or named acquisition mode. | Planner v2 with strategy selection, wave pin, profile ref and no oscillation without material change. | Add successor. | ResolutionPlan v2 and snapshot v2; A-15. | High. |
| Registry profile | None | Absent. | New `planning/registryCapabilityProfile.js` or equivalent public data validator outside legal policy. | Add. | New public profile contract; no capability-port change. | High. |
| Fallback manifest | `policy/resolutionOrchestration.js`; `domain/resolutionOrchestrationArtifacts.js` | Pinned attempts and human decision, but no category disposition inventory. | Extend successor review package/decision with categories and reasons. | Modify/add. | Snapshot v2; A-10. | High. |
| R09 | `policy/resolutionOrchestration.js#assessPscDiscrepancy` | Equality plus explicit definition/non-material classification. | Frozen taxonomy, analyst material decision, host-neutral report candidate. | Modify/add. | Snapshot/projections v2. | High. |
| Listed/specialist | `policy/policyDetermination.js#evaluatePolicyApplicability`; policy `applicability.outOfScopeRoutes`; R11/R12/R06 | Metadata-only listed route; trust/R06 specialist; other structures not routed. | Add fact-verifying customer/subsidiary routes; extend specialist route types; intermediate terminus off. | Add successor. | Policy 1.6/schema 1.3; A-01/05/07/14. | High. |
| Residual bundle | `planning/uboResolutionPlanner.js#customerBundles`; `projection/uboJourneyProjection.js`; `UboJourney.js`; `applyCustomerInput.js` | Bundles by entity/family; no independent residual statements in one interaction. | Plan/journey/customer-action v2 bundle with independent statement IDs/results. | Add successor. | Public contracts and content sign-off. | High. |
| Lab | `ubo-control-lab/server/labEngine.js`; browser files; `OwnershipGraph.js` | Good current inspection interactions; 1.5 review pack not watermarked; no route/closure/profile views. | Consume v2 projections, show watermark, toggles, causal counts, separate routes/closure. | Modify after domain. | Lab session contract may need v2; retain replay v1 input. | Medium. |
| Applicant | `projection/uboJourneyProjection.js`; `planning/uboResolutionPlanner.js`; `ubo-control-ui/UboJourney.js` | Public adaptive UI exists, not integrated into host onboarding; can expose graph and current entity-centric bundles. | Minimal applicant v2 projection with confirm/change, structure evidence/guided builder, residual bundle, delegation/provenance. | Add successor. | Journey/plan/action v2 and later host PR. | High. |
| History/replay | `domain/decisionSnapshot.js`; Lab replay store | v1 reconstructs exact recorded state; Lab replay stores Discovery result, not policy identity/snapshot. | Multi-version verify/reconstruct; replay must distinguish raw capability replay from historical decision replay and selected policy. | Add. | No mutation of old records. | High. |
| Evidence boundary | Core `EvidenceReference`; `origin/main:idv/contracts/evidenceIntegration.js` | Main contains a deliberately unimplemented IDV evidence integration; Lab says Evidence disabled; no active UBO Evidence adapter on main. | Keep boundary; future adapter translates evidence artifacts/facts only when Gate 4 resumes. | Keep/defer. | No current contract or worktree change. | Low now. |

## E. Public-contract/version map

### Current public/runtime versions

| Surface | Current version |
|---|---|
| Capability result/request | `1.0.0` |
| Decision Application | `ubo-decision-application-v1`, opt-in `ubo-decision-application-v2` |
| Customer action | `ubo-customer-action-v1` |
| DecisionSnapshot schema | `ubo-decision-snapshot-v1` |
| OwnershipGraphProjection | `ubo-ownership-graph-projection-v1` |
| JourneyProjection | `ubo-journey-projection-v1` |
| ResolutionPlan / planner | `ubo-resolution-plan-v1` / `ubo-low-friction-planner-v1` |
| Lab session / Discovery replay | `ubo-control-lab-session-v1` / `ubo-control-lab-discovery-replay-v1` |
| Policy Pack schemas accepted | `1.0`, `1.1`, `1.2` (exported baseline constant remains `1.0`) |
| Graph / effective calculation / policy determination | `ubo-graph-v1` / `ubo-percentage-lookthrough-v1` / `ubo-policy-determination-v1` |

### Recommended change classification

| Surface | Recommendation | Reason |
|---|---|---|
| DiscoveryService/ExtractionService capability `1.0.0` | **No change** | Freeze explicitly preserves ports; existing facts can carry needed source qualifiers. Add a future contract only if an attribution fact cannot be expressed without overloading current qualifiers. |
| Policy Pack | **New schema 1.3 and policy 1.6-RC** | New top-level doctrine, sign-off markers, separate thresholds, routes, closure, listed, acquisition and approval metadata are material. Continue validating 1.0–1.2 unchanged. |
| Decision Application | **New v3 for successor evaluation; keep v1/v2 exact** | v1/v2 strict request/response expectations currently return snapshot v1. A v3 avoids silently changing snapshot semantics while accommodating phased inputs/history. If implementation proves all new inputs are policy/graph-derived and response negotiation is explicit, a narrower additive v2 extension could be reconsidered, but current strict contracts favor v3. |
| DecisionSnapshot | **New v2** | New qualification/attribution/closure algorithms, profile pin, causal needs, acquisition plan and approval state materially change the durable reasoning schema. |
| OwnershipGraphProjection | **New v2** | Separate causal needs/path diagnostics, route qualifications, closure and edge/node evidence statuses change meaning and counts. |
| JourneyProjection | **New v2** | Acquisition route, residual statements, simple applicant structure/frontier, delegation and customer-complete semantics require material fields. |
| ResolutionPlan | **New v2** | Named acquisition strategy, RegistryCapabilityProfile identity, wave identity/no-oscillation and causal bundles are material. Planner identity should also become v2. |
| RegistryCapabilityProfile | **New additive public data contract v1** | It is provider/configuration planning context outside Policy Pack and must be validated/pinned without changing capability ports. |
| Customer action | **New v2** | Residual statement IDs/results, chart/guided-structure actions, confirmer capacity/as-at provenance and delegation exceed the existing strict action vocabulary. Keep v1 accepted for v1 plans. |
| UI React component API | **Additive multi-version adapters/components** | Existing v1 renderers should remain usable. Add explicit v2 consumers rather than making a v1 component reinterpret new semantics. |
| Lab session | **New v2 if it persists both v1/v2 views** | Session is Lab-only, but explicit versioning prevents mixed snapshot/projection semantics. |
| Discovery replay | **Additive same version only for old record validation; new replay v2 for policy/profile metadata** | Existing replay v1 is a normalized capability capture and should stay readable. It cannot claim historical decision reproducibility because it does not pin policy or snapshot. |

## F. Policy Pack/schema map

Current Lab policy identity:

- path: `ubo-control/policies/uk-corporate/1.5-rc/policy.json`;
- ID `UBO-UK-CORPORATE`;
- version `1.5-RC`;
- schema `1.2`;
- status `CONTROL_ROOM_REVIEW`;
- effective-from `null`;
- approver `null`;
- canonical hash `sha256:724c2fa4820e02daddc24e652b50748646d87017cbfa632c062bc9e27de4b790`.

The Lab definitely passes this exact object to Decision Application v2. The generic factory has no global default and evaluates whichever valid pack its caller supplies.

| Schema/policy addition from File 02 | Current state | Impact |
|---|---|---|
| Legal baseline and delta memo | Only prose/source traceability; no structured baseline object. | Add schema-1.3 structure; A-08 marker mandatory. |
| Qualification doctrine/routes | Implicit code basis types, no policy route catalogue. | Add data-only route catalogue plus algorithm compatibility validation. |
| Separate statutory thresholds | Two lowerable `percent_exclusive` parameters. | Replace bound semantics in 1.6; retain 25 `>` statutory fields. |
| Firm threshold/role | Absent. | Add disabled-by-default overlay and distinct role. |
| Deferred firm layer holder | Absent. | Add disabled descriptor only; no runtime per File 02/A-18. |
| Layer completeness doctrine | Absent. | Add policy outputs/qualifiers; arithmetic stays engine-owned. |
| Percentage evidence states | Absent. | Add catalogue/rules; A-03 marker. |
| Control action gating | Strategies exist but no frozen materiality/frontier gate. | Add policy constraints consumed by need/planner v2; A-04 for numeric questions. |
| Residual bundle | No bundle policy. | Add separate statement descriptors with A-02/A-17 markers. |
| Listed treatment | One generic out-of-scope listed route. | Replace with three explicit cases and evidence requirements. |
| Exhaustion categories/dispositions | Attempts and review manifest only. | Add categories; A-10 marker. |
| Structure acquisition hooks | Chart evidence may appear as option only. | Add allowed strategies/evidence; Registry profile remains outside pack. |
| Phased order | Absent. | Add semantic pin and validate permitted expression dependencies. |
| Registry profile ref requirement | Absent. | Pack can declare required plan/snapshot ref shape, but profile content stays external. |
| R01–R14 rescoping | v1.5 requirement IDs/titles and rules exist. | Keep stable IDs where possible; change 1.6 conditions/strategies/definitions with explicit source mapping. |
| Production approval/sign-offs | Status/readiness/approver fields exist but are not enforced; sign-offs not machine-readable. | Add machine-readable approval markers and runtime guard. |
| Lifecycle events | Four unresolved opaque source codes. | Add semantic events only after A-16 mapping. |

Schema implementation must resolve the snake_case/camelCase mapping conflict before authoring the final JSON. v1.5 source and hash are immutable.

## G. Snapshot compatibility plan

1. Keep `ubo-decision-snapshot-v1`, `ubo-decision-snapshot-construction-v1`, `ubo-decision-reconstruction-v1`, current canonicalization and all v1 validators unchanged for historical content.
2. Add `ubo-decision-snapshot-v2` with explicit pins for policy 1.6/schema 1.3, qualification methods/statuses, `ubo-psc-attribution-v1`, layer-closure algorithm, acquisition planner version, RegistryCapabilityProfile identity/entitlement context and policy approval/sign-off state.
3. Add a version dispatcher that verifies/reconstructs v1 with old code paths and v2 with successor code paths. Reconstruction remains projection of recorded data; it never runs current algorithms against old facts.
4. A re-evaluation of a v1 case under v1.6 is a new v2 snapshot linked by the existing history/supersession model with `POLICY_CHANGED`; it must not mutate or reclassify the v1 result.
5. Retain v1 public projections/plans/renderers for v1 snapshots. Produce v2 projections/plans for v2 snapshots. A Lab comparison may show both, labelled with doctrine/policy/algorithm versions.
6. Keep the legacy adapter's capability `1.0.0` output unchanged. The same candidate facts can feed either Decision Application generation; the selected policy/application contract determines the new decision.
7. Lab Discovery replay v1 remains a valid capture of normalized candidate facts, but replaying it is **not** historical decision reconstruction because the record lacks policy/snapshot/profile pins. Preserve old records, label them as capability replays, and require explicit policy selection. Use replay v2 or stored DecisionSnapshots for exact doctrine replay.
8. Retain current PR #45 ASDA/TDR source fixtures as v1.5 characterization inputs. Preserve their v1 golden outputs for regression and add separate v1.6/v2 expected artifacts. Do not overwrite names or make old fixtures appear to have always used the new doctrine.
9. No database migration is currently required inside standalone UBO Control because it owns no persistence. Host persistence must store contract/schema identity and accept both payload generations before activation. If existing columns enforce one snapshot/projection shape, add a forward migration; never rewrite stored v1 JSON.
10. `TEST_MATRIX.md` should gain freeze traceability rows with policy/algorithm version and sign-off state. Existing rows remain historical evidence rather than being edited to claim new coverage.

## H. R01–R14 impact

| Requirement | Current executable behavior | Frozen target and disposition | Contracts/tests/sign-off |
|---|---|---|---|
| R01 — ultimate economic interests | Always applicable. The application plans an ECONOMIC calculation for every reverse-reachable holder. Each legal-entity or indeterminate basis can create an entity-targeted `CURRENT_OWNERSHIP_AND_CONTROL` need; qualifying natural persons still require evidence sufficiency. | Evaluate at the regulated subject using effective-interest, attribution and layer-closure outputs. Generate one causal frontier/edge/precision need, not one per affected intermediary. Preserve natural-person-only qualification. **Modify resolver/planner; add closure/attribution.** | Snapshot/projection v2; tests for closure, frontier and route combination. A-03/A-09/A-06 where applicable. |
| R02 — indirect calculations | Applicability is `facts.ownership_layers >= 2` supplied by the caller. COMPLETE pinned calculations resolve; partial/cycle/value problems create calculation/relationship-targeted needs. | Derive applicability from graph depth/active calculations in an earlier phase. Needs point only to the blocking edge/value/cycle and affected calculations link to it. **Modify phased coordinator/resolver.** | No arithmetic change; phase/need/snapshot tests. |
| R03 — intermediate evidence | Same caller-supplied layer applicability. Separately checks intermediate entity existence and relationship evidence, potentially creating per-entity/per-relationship needs. | Derive from graph. Preserve separate existence/relationship/currentness/corroboration semantics, but coalesce one causal frontier/structure evidence action across supported edges. **Modify resolver/planner.** | InformationNeed/plan v2; no change to EvidenceReference. |
| R04 — voting | Always applicable. Application plans same-dimension voting calculations for every reverse-reachable voting holder; resolver may create one voting need per legal/indeterminate basis. Economic/voting arithmetic is correctly separate. | Preserve subject-level voting assessment. Intermediary needs only for a relied control/attribution chain, positive signal or material legal-entity-held right. Numeric customer questions are last-resort gated. **Keep arithmetic; modify planning/needs/actions.** | A-04 for templates/authority/corroboration; attribution A-09/A-06. |
| R05 — appointment/removal | Always applicable. Only direct non-ceased appointment/removal/formal-control edges into the regulated subject are assessed. Exact profile/concept/management body plus `scope=MAJORITY` qualifies; combined source semantics remain indeterminate. | Largely aligned. Preserve combined/alternative source fact and require majority scope. Add subject/control-frontier need and last-resort customer gate; avoid unrelated intermediary fan-out. **Keep determination core, extend route/need metadata.** | A-12 blocks conclusive Companies House mapping; A-04 customer questions. |
| R06 — other/management control | Always applicable. Direct current unambiguous SIoC qualifies; ambiguity/de-facto/interpretation routes review. With no positive fact/sufficient negative evidence, one subject need is created. B4 wording is blocked. | Split frozen management-control route metadata from other-control evidence/review. Preserve deterministic positives/review. Negative leg may enter residual bundle only after sign-off. **Modify qualification taxonomy/projection; preserve review logic.** | A-02/A-17 residual content; ambiguous specialist remains. |
| R07 — qualifying-person identity | Applicability is caller `facts.qualifying_persons_count >= 1`; one need per missing configured attribute/person. No downstream IDV/POI/POA/screening. B1 wording unresolved. | Derive applicability from actual statutory/firm qualifying output in prior phase; collect only missing UBO attributes and preserve downstream KYC boundary. **Modify phase condition, keep granular collection.** | A-17 content; journey/handoff v2 distinguishes statutory/firm. |
| R08 — independent corroboration | Always applicable; one regulated-subject/structure-level need if distinct independent eligible sources are below configured count. PSC evidence may corroborate without determining UBO. | Substantially aligned. Add explicit relationship coverage and percentage evidence states; registry band consistency must not equal exact verification. **Keep one need, extend evidence output.** | A-03; evidence-state tests. |
| R09 — PSC discrepancy | GB. Deferred to orchestration. Missing/empty PSC input routes review; exact facts match; explicit definition difference/non-material rationale can resolve; otherwise potential discrepancy. No InformationNeed; analyst action only. | Add REGISTER_SCOPE_DIFFERENCE, METHOD_DIFFERENCE, TIMING_STALENESS, MATERIAL_DISCREPANCY and indeterminate/review handling. Only analyst-confirmed material discrepancy emits host-facing Reg 30A report candidate; never submit. **Replace taxonomy in successor.** | Snapshot/projection v2; legal classification tests. |
| R10 — SMO fallback | Caller applicability condition exists but orchestration derives eligibility. Requires no qualifying person/firm-unsatisfied, preconditions, no customer needs/specialist/operational blockers, complete candidate data, current pinned analyst/compliance decision and explicit SMO application. Attempts manifest is preserved. | Preserve asynchronous architecture. Add case-specific measure categories and dispositions/reasons; keep customer completion independent of internal review. **Extend manifest/decision only.** | A-10; snapshot/plan v2. No `NO_DATA` shortcut. |
| R11 — trust | Always applicable. Positive trust bases route specialist review; explicit `trust_in_chain=false` may resolve; otherwise one subject trust need. B2 is blocked. | Preserve independent positive specialist route. Negative statement may be one element of signed residual bundle; trust/fund/LP distinctions need expanded specialist taxonomy. **Modify bundle/routing metadata.** | A-02/A-17; A-05 for fund/GP route. |
| R12 — nominee/bearer | Always applicable. Positive bearer routes review; nominee without supported natural principal creates underlying-principal need; silence creates one subject status need. Negative evidence/attestation can resolve under current policy. | Preserve independent signals; positive bearer and unresolved nominee principal route specialist where required; negative statement can be bundled but remains separate. **Modify specialist/bundle projection.** | A-02/A-17; nominee/joint facts may invoke A-13. |
| R13 — depth/cross-border risk | Always applicable; orchestration derives maximum path length/cross-border relationships after requirement resolution and resolves R13, emitting UBO risk signals without mutating host risk. | Preserve risk-signal-only boundary, but derive structural depth in the earlier graph phase so R02/R03 can consume it. **Move derivation earlier; retain final output.** | Coordinator/snapshot tests; no host-risk contract change. |
| R14 — residual completeness | Always applicable. Unavailable until all prior requirements resolve/N/A; then missing/refused attestation is a gap and accepted referenced attestation resolves R14 only. It cannot cure other requirements. | Preserve semantics. Present as a distinct statement inside the residual bundle only after its readiness boundary. **Keep resolver; extend plan/journey presentation.** | A-02/A-17. |

No requirement ID needs to be renumbered. Policy version 1.6 must make changed semantics explicit; historical 1.5 requirement results retain their original meaning.

## I. InformationNeed and planner impact

### Current cause of fan-out

`createUboDecisionApplication.js#planCalculations` enumerates every reverse-reachable upstream entity separately for every configured percentage dimension. `policyDetermination.js` creates a basis for every request. `requirementResolution.js` creates entity-targeted R01/R04 needs for indeterminate/legal-entity bases. Because entity ID is part of current need identity, each intermediary remains a distinct need. `ownershipGraphProjection.js#projectUnresolved` then publishes unresolved calculation paths beside those needs as additional unresolved items.

In the ASDA temporal-unknown characterization this yields eight R01 needs, seven R04 needs and 15 duplicate affected-path entries. The behavior is deterministic and tested, but it conflicts with the frozen causal-frontier model.

### Required causal model

The successor should:

1. discover the smallest blocking frontier/edge/route/evidence/review target;
2. create one semantic need for that cause, with policy/temporal/frontier identity;
3. attach every affected calculation/path/requirement as diagnostics and dependencies;
4. keep distinct causes distinct even on the same entity;
5. expose need count, affected-path count, customer-work count and review count separately;
6. select an acquisition strategy once per material resolution wave;
7. run zero-customer-friction routes first when expected to resolve the frontier;
8. use RegistryCapabilityProfile to pivot directly to chart-assisted work when opacity is predictably established;
9. batch shared structure/governance causes without treating the chart as proof;
10. re-evaluate only after material facts/evidence/profile state changes.

### Current versus target model

| Concern | Current | Frozen target | Impact |
|---|---|---|---|
| Target kinds | Entity, optional relationship/attribute, concept | CASE, FRONTIER_ENTITY, RELATIONSHIP/EDGE, PERSON_ATTRIBUTE, QUALIFICATION_ROUTE, REVIEW_DECISION, EVIDENCE_SUFFICIENCY, SPECIALIST_ROUTE | InformationNeed v2. |
| Identity | Case + entity/relationship/attribute/concept | Also dimension, temporal scope, policy requirement set/version, causal edge/frontier | New stable IDs for new snapshots only. |
| State | OPEN/SATISFIED/SUPERSEDED; blockers/reviews separate | Minimum normalized vocabulary also includes REVIEW_REQUIRED/BLOCKED_OPERATIONALLY/SPECIALIST | Contract decision noted in §C; projection must normalize even if internals stay separate. |
| Calculation diagnostic | Peer unresolved projection item | Attached affected diagnostic to causal need | Graph projection v2. |
| R01/R04 | Per reverse-reachable calculated holder | Subject assessment plus material frontier/positive control chain | Coordinator/resolver rewrite at narrow seam. |
| Customer gate | Customer option selected when no system action for that need | Also materiality, approved wording, respondent authority, evidence insufficiency, no specialist stop | Plan v2; A-04/A-17. |
| Chart | Only if current option explicitly lists chart | Predictive CHART_ASSISTED mode using validated profile/common cause | Planner v2/Profile v1. |
| Attempts | Substantive outcomes suppress unchanged option; operational errors retry/hold | Preserve, plus profile/material-change-aware new attempt eligibility | Planner v2. |
| Explanation | Rationale codes and alternatives | Causal reason, route permission, lower-friction exhaustion, expected outcome, re-evaluation trigger | ResolutionPlan v2. |

## J. Lab and customer-journey impact

### Lab/analyst

Preserve PR #45's one graph, subject-centred hierarchy, Fit width/Overview, parallel edge routing, deterministic unresolved panel, node/edge selection and clear-selection behaviors.

Required changes after v2 domain contracts exist:

- default to economic ownership with explicit Ownership/Voting/Control/All overlays;
- show edge evidence status (VERIFIED/CORROBORATED/DECLARED/CONTRADICTED/STALE/UNKNOWN/REVIEW_REQUIRED) rather than blanket entity unresolved state;
- show node roles (SUBJECT, QUALIFYING_PERSON, FIRM_POLICY_PERSON, NOT_CONFIRMED_UBO, FRONTIER_ENTITY, SPECIAL_STRUCTURE, REVIEW_REQUIRED, IDENTITY_UNRESOLVED);
- expose effective-interest, Schedule 1A attribution and management-control routes separately;
- show statutory versus firm-policy classification and all basis/algorithm/policy references;
- show one causal need with linked affected paths rather than duplicate unresolved rows;
- expose layer-closure result/blockers and acquisition strategy/profile identity;
- persistently watermark review packs: `REVIEW POLICY — NOT APPROVED FOR PRODUCTION`;
- keep explicit identity, claim, conflict and fallback consoles;
- use the actual v2 JourneyProjection/ResolutionPlan in applicant preview.

### Applicant

Current strengths: known data is not re-requested in several fixtures, work is progressive, operational/internal/specialist states do not expose a customer form, qualifying-person handoff is separate, and customer completion can precede internal review.

Required successor behavior:

- data-rich cases show a calm established-structure confirmation and “Something has changed” route;
- decision-sensitive exactness alone creates a percentage question;
- predictable opacity creates one structure-evidence request or guided builder;
- charts/documents become candidate facts and accessible edges remain independently verified;
- residual negative statements appear in one interaction but remain individually stored and branch independently;
- control questions are factual, last-resort and respondent-authority gated;
- delegation, confirmer identity/capacity/date/as-at date and affected references are retained;
- the optional visual contains only the established ownership spine, qualifying persons and one material frontier;
- applicant completion remains distinct from analyst/specialist/final-case completion;
- downstream IDV/screening/POI/POA remains outside UBO.

The current reusable `UboJourney` should not become the analyst Lab. A v2 applicant projection/component can coexist with current v1 fixtures until host onboarding integration is separately authorized.

## K. File 07 test gap matrix

Classification vocabulary:

- **PASS** — existing passing test directly protects the case;
- **CHANGE** — an existing test/fixture exists but its expectation must change under the successor doctrine;
- **NEW** — no adequate current executable case;
- **BLOCKED** — new test/implementation must remain non-production or pending until named sign-off;
- **DEFERRED** — explicitly outside the authorized cycle.

### K1. Existing invariants and threshold/firm overlay

| File 07 required case | Status | Current/required test mapping |
|---|---|---|
| No legacy imports in core | PASS | `ubo-control/__tests__/architecture.nodetest.js`; adapter architecture test. |
| No Evidence implementation imports in core | PASS | Core architecture test and `contracts.nodetest.js` EvidenceReference boundary. |
| Candidate facts are not conclusions | PASS | `contracts`, `ownershipCase`, adapter L06/L07 and E2E legacy pollution tests. |
| No direct graph mutation | PASS | `ownershipCase.nodetest.js` graph eligibility and Decision Application tests. |
| Exact/range/unknown values | PASS | `contracts`, `ownershipCase`, `ownershipGraph` tests. |
| No floating-point drift | PASS | `ownershipGraph.nodetest.js` exact rational arithmetic test. |
| Path multiplication | PASS | Multi-layer exact 60% × 50% and E2E-D2 tests. |
| Independent-path aggregation | PASS | `ownershipGraph` and projection V03 tests. |
| Duplicate evidence does not duplicate ownership | PASS | Graph corroboration and ASDA exact-ID coalescence tests. |
| Incompatible operative claims fail | PASS | `ownershipGraph.nodetest.js` conflicting slot/error tests. |
| `NO_PATH` is not zero | PASS | `ownershipGraph` and `policyDetermination` tests. |
| Cycles fail safely | PASS | `ownershipGraph`/R02 cycle tests. |
| Voting/economic separation | PASS | Graph, policy, adapter and ASDA voting tests. |
| Operational failure is not `NO_DATA` | PASS | Contracts, requirements, planner P05/P06 and adapter outcome tests. |
| Explicit identity and adjudication | PASS | `ownershipCase`, Decision Application and Lab console tests. |
| Immutable snapshots | PASS | Full `decisionSnapshot.nodetest.js` identity/history suite. |
| Customer action through application boundary | PASS | `customerInputApplication.nodetest.js`. |
| Replay performs no live paid search | PASS | Lab replay API/engine tests. |
| One canonical entity equals one visual node | PASS | Projection convergence and sanitized ASDA tests. |
| Statutory `>25` comparator on same graph | PASS | Current generic exclusive-threshold exact/range tests. |
| Statutory `>=25` comparator on same graph | NEW | Current policy comparator only supports `percent_exclusive`; add generic comparator matrix without changing UK baseline. |
| Firm `>=10` on same graph | NEW | Firm overlay absent. |
| Statutory and firm thresholds simultaneously | NEW | Parallel outputs absent. |
| 15% person is firm-policy person at `>=10` | NEW | Add QualificationBasis v2 case. |
| 15% person is not statutory UBO at `>25` | NEW | Same graph, separate statutory result. |
| Host handoff retains both classifications | NEW | JourneyProjection/host handoff v2. |
| Firm threshold cannot suppress statutory UBO | NEW | Policy/schema validation plus determination test. |

### K2. Layer closure and precision

| File 07 required case | Status | Current/required test mapping |
|---|---|---|
| `(75,100]` with `>25` → CLOSED | NEW | Layer-closure algorithm absent. |
| `[75,100]` with `>=25` → OPEN | NEW | Requires inclusive comparator closure logic. |
| `[76,100]` with `>=25` → CLOSED | NEW | Closure truth table. |
| 75% with firm `>=10` → OPEN | NEW | Parallel firm closure. |
| 40% + 35% lower bounds with `>25` → CLOSED | NEW | Direct-layer non-overlapping sum/residual case. |
| Unknown/unidentified holder → INDETERMINATE | NEW | Closure identity qualifier. |
| Dual-class shares: economic closed, voting open | NEW | Per-dimension denominator/share-class closure. |
| Invalid denominator blocks closure | NEW | Add typed invalid-denominator error/state. |
| Overlapping interests fail | NEW | Add overlap validation; current graph only catches minimum totals >100. |
| Contradictory sources block closure | NEW | Link existing conflict artifact to closure state. |
| Stale/unknown currentness blocks closure when material | NEW | Current paths become unresolved, but no layer closure output exists. |
| Joint-arrangement signal blocks closure | BLOCKED A-13 | Preserve signal/review until legal mapping. |
| Closure does not imply exact value verified | NEW | Percentage evidence-state separation. |
| Band wholly above/below active result → no exact request | NEW | Decision-sensitive precision evaluator absent. |
| Interval straddles result → exactness needed | NEW | Current threshold basis is indeterminate but R01 may request broad ownership; add explicit exactness output. |
| Registry band + declaration → CORROBORATED, not verified | BLOCKED A-03 | Add characterization now; operational sufficiency waits for MLRO. |
| Outside-band declaration → conflict | NEW | Reuse explicit claim conflict/R09 handoff; add evidence-state case. |

### K3. Effective interest, PSC attribution, joint arrangements and LLP

| File 07 required case | Status | Current/required test mapping |
|---|---|---|
| Retain all effective-interest arithmetic cases | PASS | Current exact/range/path/aggregate/NO_PATH/cycle/dimension suite remains unchanged. |
| 60% TopCo; TopCo 40% Customer → effective 24%, attribution positive | BLOCKED A-09 | Effective 24% is already arithmetic-capable; attribution engine/case is new and review-flagged until sign-off. |
| 30% TopCo; TopCo 40% Customer → effective 12%, no majority attribution | BLOCKED A-09 | New attribution negative case. |
| 75–100 chain through several entities → attribution positive | BLOCKED A-09 | New majority-chain range case. |
| One 25–50 link breaks majority chain | BLOCKED A-09 | New comparator/chain case. |
| Voting right attributed separately | BLOCKED A-09 | New dimension-specific attribution case; preserve no mixed traversal. |
| Appointment/removal majority attribution | BLOCKED A-09/A-12 | Current direct majority appointment test exists; indirect Schedule 1A attribution is new. |
| SIoC positive attribution | BLOCKED A-09 | Current direct SIoC qualification exists; PSC-route attribution record is new. |
| UNKNOWN majority step → indeterminate | BLOCKED A-09 | New attribution uncertainty case. |
| No mixed-method percentage | NEW | Add characterization that attribution emits no synthetic effective percentage; existing dimension tests are partial coverage. |
| Multiple qualifying routes retained for one person | CHANGE | Current test retains multiple basis roles, but not multiple frozen legal routes/methods. Update/add v2 expectation. |
| Two explicit joint participants each attributed combined right | BLOCKED A-13 | Do not enable until wording/evidence rule is approved. |
| Similar percentages do not infer joint arrangement | PASS + BLOCKED A-13 | Current ASDA does not infer a joint arrangement; add explicit v2 no-inference test before any future joint implementation. |
| Positive joint signal routes review when not deterministic | BLOCKED A-13 | New explicit signal/review case. |
| LLP surplus-asset condition | PASS for effective route; BLOCKED A-06 for attribution | Current S02 preserves LLP economic concept. New PSC/LLP condition mapping remains provisional. |
| LLP voting | PASS for source/effective dimension; BLOCKED A-06 for attribution | Adapter and ASDA preserve voting band; attribution semantics absent. |
| LLP majority management appointment/removal | PASS direct qualification; BLOCKED A-06/A-12 for statutory attribution | S15 covers approved current direct qualifiers only. |
| LLP majority-chain attribution | BLOCKED A-06 | New; do not enable. |
| TDR characterization provisional until sign-off fixture enabled | CHANGE/BLOCKED A-06 | Current ASDA asserts no qualifying person under effective paths but lacks explicit provisional attribution route/status. Add review/provisional v2 expectation, never hard-code final people. |

### K4. Listed treatment and InformationNeeds

| File 07 required case | Status | Current/required test mapping |
|---|---|---|
| Listed customer with valid market/evidence → listed route | BLOCKED A-14 | Current S20 proves metadata representability only; new evidence-gated route. |
| Invalid/non-qualifying market → no shortcut | BLOCKED A-14 | New negative route case. |
| Majority-owned consolidated listed subsidiary with all proof | BLOCKED A-07 | New customer-level rule. |
| Missing consolidation evidence → unresolved | BLOCKED A-07 | New evidence-need case. |
| Arbitrary intermediate listed parent does not terminate by default | PASS/NEW | Current engine has no intermediate terminus; add explicit successor regression to preserve OFF default. |
| Enabled firm-approved intermediate terminus pins rule/evidence | DEFERRED/BLOCKED A-01 | Optional feature OFF; test remains pending until enabled and approved. |
| One missing frontier edge creates one causal need | NEW | Current need can target a relationship but no frontier algorithm exists. |
| Downstream affected paths link to that need | NEW | Current projection emits paths as peer unresolved rows. |
| No need per intermediary | CHANGE | Current ASDA/product test locks 8 R01 + 7 R04 intermediary needs. |
| No duplicate projection count | CHANGE | Current ASDA test locks 35 = 20 needs + 15 paths. |
| Subject-level R04 remains | NEW | Re-scope current always-applicable behavior into one subject assessment/frontier output. |
| Intermediary R04 only on attribution chain/positive signal | NEW/BLOCKED A-09 where attribution-based | Current broad reverse-reachable voting plan is not materiality-gated. |
| R02/R03 activate from graph-derived facts | CHANGE | Current tests use caller `facts.ownership_layers`; add phased tests. |
| R07 activates from qualifying-person output | CHANGE | Current tests use caller `facts.qualifying_persons_count`. |
| R08 remains one structure-level need | PASS | Existing R08 resolver/tests already create one subject need; extend relationship coverage only. |
| Positive trust/nominee signal remains separate | PASS | R11/R12 current tests preserve independent semantics. |
| Negative residual statements do not fan out | BLOCKED A-02/A-17 | New bundled-presentation/independent-storage tests. |

### K5. Planner/acquisition and residual confirmation

| File 07 required case | Status | Current/required test mapping |
|---|---|---|
| Discovery-led when capability profile predicts coverage | NEW/BLOCKED A-15 | Current P02 is zero-friction first but has no profile or named strategy. |
| Predictive chart pivot on opaque frontier | NEW/BLOCKED A-15 | No profile/frontier pivot. |
| Pivot before paid attempt where configured capability proves unavailable | NEW/BLOCKED A-15 | Current UNAVAILABLE preserves retry/hold; predictive unavailability is absent. |
| Repeated `NO_DATA` plus common structural cause collapses to one structure request | NEW | Current attempts suppress repetition but no common-cause/frontier chart bundle. |
| Chart offered as candidate structure, not proof | PASS architecture / NEW E2E | Current Evidence boundary/customer evidence handoff prevents direct graph mutation; add chart extraction/adjudication flow when Evidence resumes. |
| Accessible extracted edges independently verified | DEFERRED to Evidence workstream | No active Evidence adapter on main. |
| Residual unsupported edges batched | NEW | Needs/planner v2. |
| No oscillation without material change | NEW | No acquisition strategy/wave pin exists. |
| RegistryCapabilityProfile version/hash pinned | NEW/BLOCKED A-15 | No contract or snapshot/plan field. |
| Provider outage does not burden customer | PASS | P06 and journey J09. |
| Guided builder alternative for no-chart SME | NEW | New customer action/journey flow. |
| Delegation preserves actor/capacity | NEW | Existing `actorReference` is present at application boundary, but no delegated bundle contract/capacity/as-at test. |
| One residual interaction with multiple stored statements | BLOCKED A-02/A-17 | New plan/journey/action v2. |
| Each residual statement resolves/branches independently | BLOCKED A-02/A-17 | New. |
| One positive statement does not invalidate other negatives | BLOCKED A-02/A-17 | New. |
| Residual bundle blocked by contrary evidence | BLOCKED A-02 | New policy gate. |
| Residual bundle only at approved risk tier | BLOCKED A-02 | Current attestation max-risk tests cover individual R05 only, not bundle. |
| Final completeness does not cure ownership gap | PASS | Existing R14 tests explicitly protect this; add bundle-level regression later. |

### K6. SMO/exhaustion and R09

| File 07 required case | Status | Current/required test mapping |
|---|---|---|
| Measure categories considered and dispositioned | BLOCKED A-10 | Current manifest has attempts, not categories. |
| Non-executed measure requires reason | BLOCKED A-10 | New validator/test. |
| Case-specific manifest, not universal execution checklist | PASS architecture / BLOCKED A-10 detail | Current manifest is case-specific; successor categories need approved semantics. |
| Analyst/compliance exhaustion decision required | PASS | Existing fallback origin/pin tests. |
| `NO_DATA` alone never triggers fallback | PASS | Existing orchestration test. |
| Operational failure blocks/redirects appropriately | PASS | Existing blocker/fallback/planner tests. |
| Customer refusal → CDD failure, not fallback | NEW | Current explicit `cddUnableToComplete` supports CDD failure, but no refusal-to-handoff characterization. |
| Valid fallback preserves written record and SMO handoff | PASS | Snapshot reconstruction and journey handoff tests. |
| Stale review invalidated by material case change | PASS | Existing stale decision test. |
| First-RLE/register-scope difference | NEW | Frozen R09 taxonomy absent. |
| Effective-interest-only person absent from register → METHOD_DIFFERENCE | NEW | Requires route-aware qualification and taxonomy. |
| Timing/staleness difference | NEW | R09 facts have no typed timing category. |
| Actual contradictory registrable fact → review | PASS partial / CHANGE | Current mismatched facts route potential discrepancy review; add typed material category. |
| Analyst-confirmed material discrepancy → Reg 30A report candidate | NEW | No report-candidate artifact. |
| No automatic regulatory submission | PASS | Current UBO orchestration emits no external submission; preserve in new report-candidate test. |

### K7. ASDA permanent characterization

| File 07 required case | Status | Current/required test mapping |
|---|---|---|
| 12 canonical entities | PASS | Sanitized ASDA exact identity/node test. |
| No duplicate exact registry IDs | PASS | Same ASDA test. |
| Three TDR people are voting `(25,50]`, not economic owners | PASS | Adapter and Lab ASDA voting tests. |
| Mixed voting/economic path is not multiplied | PASS | Graph and ASDA `NO_PATH` tests. |
| Economic chain bands retained | PASS | Adapter/ASDA graph fixture tests. |
| Schedule 1A route evaluated independently | BLOCKED A-06/A-09 | Attribution engine absent; do not assert final TDR answer. |
| TDR governance frontier, not per-intermediary fan-out | CHANGE/BLOCKED A-06 for legal conclusion | Current ASDA test expects intermediary fan-out and lacks frontier artifact. |
| Causal needs not double-counted as paths | CHANGE | Current test explicitly expects 35 projected rows. |
| Ownership-first graph with control toggles | NEW | One readable graph exists, but no overlay toggles/default relationship filter. |
| No blanket unresolved nodes | CHANGE | Node presentation still derives unresolved state broadly; add frozen vocabulary. |
| 2–4 coherent applicant interactions benchmark | CHANGE | Current plan has 18 customer actions in nine bundles. Do not hard-code target count. |
| Final TDR person result marked provisional until A-06 | NEW/BLOCKED A-06 | Current result is zero qualifying persons without a PSC-attribution provisional route. |

### K8. Customer journey

| File 07 required case | Status | Current/required test mapping |
|---|---|---|
| Data-rich confirmation only | PASS partial / NEW v2 | Current CUI confirmation/no unnecessary form tests; add frozen simple applicant projection. |
| Known information not re-requested | PASS | Existing journey/UI confirmation tests. |
| Exactness question only when decision-sensitive | NEW | Current range uncertainty can trigger broad ownership need; no closure exactness output. |
| Chart-assisted route | NEW | Current chart option is passive, not acquisition strategy. |
| No-chart guided builder | NEW | Absent. |
| One batched residual screen | BLOCKED A-02/A-17 | Absent. |
| Separate structured residual statements | BLOCKED A-02/A-17 | Absent. |
| “Something changed” preserves history/conflict | PASS partial / NEW UI | Customer correction preserves history/open review target; first-class applicant route/provenance UI absent. |
| Delegation | NEW | No customer bundle delegation flow. |
| Customer input complete while internal review pending | PASS | Journey J10 and fallback behavior. |
| Downstream IDV handoff remains separate | PASS boundary / NEW host case | R07 excludes IDV/POI/POA/screening and evidence integration remains deferred; add host handoff test later. |

### K9. Lab/analyst projection

| File 07 required case | Status | Current/required test mapping |
|---|---|---|
| One graph | PASS | Lab/UI PR #45 tests. |
| Ownership default | NEW | Current renderer distinguishes types but does not filter to ownership by default. |
| Control toggles | NEW | Absent. |
| Fit width/Overview | PASS | OwnershipGraph and interaction tests. |
| Deterministic unresolved list | PASS current / CHANGE semantics | Interaction is deterministic; v2 list must group causal needs and separate paths. |
| Edge status vocabulary | NEW | Evidence/currentness details exist, frozen status vocabulary does not. |
| Nodes not blanket unresolved | CHANGE | Add node vocabulary and remove dimension-wide unresolved implication. |
| Qualification explanation by route | PASS current basis / CHANGE v2 | Current basis/path explanation exists; route/statutory/firm/attribution detail is absent. |
| Effective-interest and attribution shown separately | BLOCKED A-09/A-06 | Attribution absent. |
| Evidence states visible | NEW | Source/support visible; DECLARED/CORROBORATED/VERIFIED etc. not projected. |
| Old snapshots reconstruct unchanged | PASS core / NEW Lab comparison | Core v1 reconstruction passes; Lab must display old/new doctrine explicitly. |
| Review-policy watermark | NEW | No `REVIEW POLICY — NOT APPROVED FOR PRODUCTION` marker exists. |

### K10. Runtime safety

| File 07 required case | Status | Current/required test mapping |
|---|---|---|
| Non-approved pack rejected outside Lab | NEW/BLOCKED A-11 release definition | Current loader accepts review packs. |
| Null effective date rejected outside Lab | NEW | Current 1.5 null date loads. |
| Missing approver rejected outside Lab | NEW | Current null approver loads. |
| Unresolved blocking sign-off rejected | NEW | No machine-readable sign-off guard. |
| Unsupported policy/algorithm combination rejected | PASS partial / NEW | Existing schema/semantic version pins reject many mismatches; new attribution/closure/planner compatibility matrix is required. |
| Historical pack remains reconstructable | PASS v1 / NEW cross-version | Existing v1 history test; add v1/v2 dispatcher case. |
| DecisionSnapshot pins RegistryCapabilityProfile when used | NEW/BLOCKED A-15 | Profile absent. |

### Test-matrix conclusion

The 449 passing tests are a strong regression net for the current v1.5/v1 contracts, but they must not be presented as coverage of the freeze's new doctrine. The first successor PR should add explicit pending/blocked rows to `TEST_MATRIX.md`; each later PR converts only its own rows to executable coverage. Existing ASDA expectations for 35 unresolved entries and 18 customer actions are **characterization of the current defect shape** and need changed v2 expectations, while remaining preserved under the historical v1.5 test path.

## L. ASDA current-to-freeze delta

### Current sanitized characterization at PR #45 head

The product-snapshot regression deliberately removes `metadata.currentState` from every source edge before fresh evaluation. After explicit identity and claim decisions, current output is:

| Measure | Current result |
|---|---:|
| Canonical entities/nodes | 12 |
| Canonical operative relationships | 25 |
| TDR natural persons | 3 |
| Qualifying persons | 0 |
| Open InformationNeeds | 20 |
| Affected unresolved calculation paths | 15 (8 ECONOMIC, 7 VOTING; all unknown temporal state) |
| Projected unresolved rows | 35 |
| ResolutionOptions | 57 |
| Customer actions | 18 |
| Customer bundles | 9 |
| System actions remaining | 0 |
| Internal review actions | 1 (R09 comparison absent; no linked InformationNeed) |
| Policy-content-blocked needs | 2 (R06/B4 and R11/B2) |

The 20 open needs are R01 8, R04 7, R05 1, R06 1, R08 1, R11 1 and R12 1. The projection adds the same eight economic and seven voting path failures, yielding the observed 16/14/1/1/1/1/1 unresolved display.

### Graph facts to preserve

- the 12 exact canonical identities and one visual node per entity;
- all 25 operative relationships and distinct parallel semantics;
- the economic ownership bands throughout the corporate spine;
- three TDR-person → TDR Capital LLP relationships as `VOTING_RIGHTS RANGE (25%,50%]`, current when the source says current;
- no economic edge manufactured for those three people;
- no voting calculation traversing downstream economic edges;
- the combined/alternative appointment/removal source fact as one interpretation-dependent formal-control relationship;
- surplus-asset rights as LLP economic interest rather than generic company shares;
- all source/claim/evidence references and explicit decision history.

### Missing frozen qualification routes

Current effective-interest output correctly yields no same-dimension person→ASDA voting path and no person economic path for the three TDR individuals. What is missing is a separately recorded Schedule 1A/PSC-condition attribution assessment and its majority-chain/joint-arrangement/LLP reasoning. Management-control and control-holder look-through are also not composed beyond direct subject relationships.

No final TDR UBO answer should be inferred from this gap. Under A-06 the successor must show the attribution route as provisional/review-required until LLP and joint-arrangement doctrine is signed.

### Expected frozen need shape

The exact count must be produced by the future causal algorithm, not encoded in an ASDA branch. Expected categories are:

1. one TDR Capital LLP governance/control/attribution frontier or specialist decision, with its affected routes/paths attached;
2. only decision-sensitive edge-level currentness/percentage/evidence needs at the actual blocking frontier;
3. one structure-level R08 corroboration need if existing evidence still does not satisfy it;
4. separate R06/R11/R12/joint/R14 residual statements, presented in one interaction only after sign-off/readiness;
5. no generic R01/R04 need for each ASDA intermediary and no duplicate path rows counted as needs.

### Expected acquisition/planner direction

Given the sanitized case's already-established long structure, exhausted current Discovery route and shared temporal/structural uncertainty, the frozen planner would normally evaluate a **CHART_ASSISTED targeted structure/governance request** rather than 18 recursive questions, subject to a validated RegistryCapabilityProfile and already-held artifact inventory. Accessible material edges would still be independently verified. The TDR LLP/joint-control legal interpretation is separately **SPECIALIST** while A-06 remains unsigned. These are policy-driven strategy outcomes, not hard-coded ASDA labels.

### Expected Lab/applicant delta

- Lab: ownership-default map, optional control overlays, causal frontier and affected paths separated, route-by-route qualification/closure, explicit provisional/sign-off markers, review-policy watermark.
- Applicant: likely one structure/governance evidence interaction, one targeted residual fact round if still needed, and one residual confirmation interaction when signed—approximately 2–4 coherent interactions as a benchmark, not a policy constant.
- Planner explanation: state why zero-friction routes are exhausted/predictably insufficient, which causal need a request covers, expected resolution, and re-evaluation trigger.

## M. Proposed small-PR sequence

Each PR is a stop point. No later PR should begin automatically.

| PR wave | Objective and modules | Tests/acceptance | Dependencies/sign-off | Rollback/compatibility risk |
|---|---|---|---|---|
| 1. Schema 1.3 + runtime approval guard | Extend `policyPack.js` with a separate schema-1.3 validator, approval/sign-off compatibility checks and explicit LAB vs PRODUCTION load mode; expose policy readiness to Lab and add persistent watermark. | Reject review/null-date/null-approver/blocking-signoff packs in production; allow and watermark them in Lab; schemas 1.0–1.2 unchanged. | Control Room resolves schema field naming; A-11 defines approval record, A-08/A-09/A-10 blockers. | Low if additive; highest risk is accidentally blocking historical/replay use, prevented by explicit mode. |
| 2. v1.6-RC policy container | Add immutable `policies/uk-corporate/1.6-rc/` JSON/source mapping/test plan with machine-readable unresolved sign-offs; no new engine execution. | Exact hash/schema/source tests; v1.5 hash remains fixed; all references close or are explicitly blocked. | PR1; File 02 canonical field mapping. | Low; pack remains Lab-only. |
| 3. QualificationBasis v2 + effective route wrapper | Add immutable statutory/firm route record and wrap existing percentage results as `EFFECTIVE_INTEREST/ADOPTED_INTERPRETATION`; do not change arithmetic. | Current effective cases identical; all routes retained; firm/statutory labels separate; no naked boolean. | PR2; no A-09 needed for effective route. | Medium public snapshot/projection risk; keep unwired/pure or version-gated. |
| 4. Company Schedule 1A attribution | Add pure `ubo-psc-attribution-v1` for approved company condition/majority-chain inputs behind review flag. | File 07 company attribution matrix, typed errors, no mixed percentage, source/claim/evidence trace. | PR3; A-09 required for production, A-12/A-13 for affected conditions. | High legal risk; disable production until approval. |
| 5. LLP attribution | Add LLP-specific mapping and TDR provisional characterization only after doctrine approval. | LLP surplus/voting/appointment/majority-chain and ASDA review/provisional cases. | PR4; **must wait for A-06**, plus A-12/A-13 as applicable. | Critical; rollback by leaving LLP route disabled. |
| 6. Layer closure/evidence precision | Add pure closure evaluator and percentage evidence states; no need/planner change yet. | Full closure/qualifier/precision truth tables; numeric facts remain unchanged. | PR2/3; A-03 for declaration-band sufficiency. | Medium; version algorithm and keep old results. |
| 7. Phased coordinator + snapshot v2 | Add acyclic derived phase context, graph-derived R02/R03 and qualification-derived R07; incorporate attribution/closure and resolve plan-before-snapshot architecture. Add v2 history dispatcher. | Phase dependency tests, v1 reconstruction unchanged, v2 algorithm/profile/approval pins, no circular inputs. | PR3/4/6; successor ADR required. | High; isolate behind Decision Application v3. |
| 8. Frontier InformationNeeds | Add target kinds, causal frontier/edge generation, dependent diagnostics, R01–R14 successor resolvers and projection v2 deduplication. | One cause/one need, no per-intermediary fan-out, paths linked not counted, expanded state vocabulary, ASDA causal shape. | PR7; A-04/A-12/A-13 for gated facts. | High record-ID/count change; only v2 records change. |
| 9. Planner v2 + RegistryCapabilityProfile | Add profile contract, acquisition strategy, predictive chart pivot, wave pin/no oscillation, causal bundles and explanation. | File 07 planner matrix; profile ID/version/hash/entitlement in plan/snapshot; provider failure remains non-customer. | PR7/8; A-15, A-10 for exhaustion categories. | High operational-staleness risk; explicit pin/refresh rules. |
| 10. Lab v2 projection | Add ownership/control toggles, frozen status vocabularies, route/closure/profile views, causal counts and old/new doctrine comparison while preserving PR #45 interactions. | File 07 Lab suite plus manual ASDA evidence; one graph/Fit/selection remains green. | PR7–9; A-06 shown as provisional, not decided. | Medium presentation risk; v1 Lab route remains available. |
| 11. Applicant journey v2 | Add minimal applicant projection/UI, chart/guided-builder action, residual bundle, delegation/provenance and customer-action v2. | File 07 customer/residual tests; no full analyst graph; customer completion distinct from internal completion. | PR8/9; A-02/A-04/A-17. | High wording/host contract risk; remain standalone until approved. |
| 12. Evidence adapter | Translate approved Evidence artifacts/fact supports into existing provider-neutral references and candidate facts; charts never become truth automatically. | Architecture, extraction/adjudication, accessible-edge verification, raw-byte exclusion. | Gate 4 resumed; Evidence contract available. | Medium integration risk; adapter stays outside core. |
| 13. Host/onboarding integration | Embed applicant v2, persist multi-version snapshots/actions and wire downstream IDV/report-candidate handoffs. | Host regression/smoke, invite/dossier paths, multi-version persistence, no automatic Reg 30A submission. | All prior accepted; relevant sign-offs approved. | Highest host risk; feature flag and rollback to current journey. |

## N. Sign-off blockers

File 08 supplies no per-row status field or approval evidence. The table below therefore records the supplied default as controlling; it does not infer approval.

| ID | Current governing default / impact |
|---|---|
| A-01 | Intermediate listed terminus OFF; optional feature deferred. |
| A-02 | Residual bundle cannot close requirements automatically; blocks production bundle. |
| A-03 | Declaration inside registry band is corroborated, not exact verified; blocks risk-tier sufficiency automation. |
| A-04 | Numeric control questions disabled outside Lab; blocks last-resort applicant control collection. |
| A-05 | Fund/GP ultimate management control routes specialist; blocks deterministic PE/fund route. |
| A-06 | TDR/LLP attribution conclusion provisional and specialist; blocks LLP attribution and final ASDA outcome. |
| A-07 | Listed-subsidiary rule must not auto-apply; blocks that route. |
| A-08 | Legal delta memo pending; release-blocking for production baseline. |
| A-09 | Company Schedule 1A mapping may be implemented only behind review flag; release-blocking for production attribution. |
| A-10 | Existing async fallback remains; no universal category checklist; release-blocking for new exhaustion policy. |
| A-11 | v1.6 has no production approver/effective release; Lab only and release-blocking. |
| A-12 | Appoint/remove source preserves fact but uncertain scope routes review; blocks automatic R05 qualification. |
| A-13 | No joint-arrangement inference; positive signal routes review; blocks joint attribution/closure. |
| A-14 | Listed-customer route requires explicit evidence/sign-off. |
| A-15 | Capability profile cannot claim unverified entitlement; blocks production predictive pivot. |
| A-16 | Opaque lifecycle codes remain non-production-active; blocks semantic event re-resolution. |
| A-17 | Missing B2/B4 and residual wording remains configuration-blocked; blocks applicant release. |
| A-18 | Firm layer-holder collection disabled/deferred; no runtime implementation in this cycle. |

Minimum production release sign-offs from File 08 are A-08, A-09, A-10 and A-11, plus every enabled optional feature and every reachable customer action's content. A-06 is additionally mandatory for a deterministic final TDR/LLP attribution result.

## O. Repository/worktree confirmation

| Check | Verified result |
|---|---|
| Repository | `C:\kyc-ubo-control` |
| Branch | `codex/ubo-control-g5-3d-control-lab` |
| Commit | `5d7b68780283a9477d04a8c2f8be767285296d93` |
| PR #45 | OPEN, non-draft, base `main`, head SHA matches local; GitHub returned mergeability `UNKNOWN` at inspection time. |
| Remote main | `312bb892d51a82563103875d118561114befc6e2`, matching local `origin/main`. |
| Worktree before and after diagnostic | Clean; no uncommitted tracked or untracked files reported. |
| UBO test run | 449 tests; 449 passed; 0 failed, cancelled, skipped or todo. Duration 6.14s. |
| Lab Policy Pack | `UBO-UK-CORPORATE` `1.5-RC`, schema `1.2`, `CONTROL_ROOM_REVIEW`, effective date null, approver null. |
| Policy hash | `sha256:724c2fa4820e02daddc24e652b50748646d87017cbfa632c062bc9e27de4b790` |
| Evidence workstream from main only | No active UBO Evidence adapter/implementation is present. `idv/contracts/evidenceIntegration.js` is explicitly unimplemented/deferred; PR #45 Lab exposes Evidence as disabled. No Evidence worktree was inspected or modified. |
| Changes made by this task | None in PR #45 or either repository worktree. This report is stored outside the repository in the Codex artifact directory. |

Final control: stop here. Do not implement any proposed PR until Control Room authorizes that specific first wave.
