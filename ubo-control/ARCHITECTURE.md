# UBO Control architecture

UBO Control is a standalone product temporarily co-located in the KYC host repository. This document states the current Control Room-approved architecture and public boundaries.

## Product boundary

`ubo-control/index.js` is the only public entry point. Production code beneath this root has no production dependency on the host, legacy UBO, onboarding, Evidence Platform implementation, provider SDK, host database, or Vercel infrastructure.

The host application will eventually depend on UBO Control through the public entry point. Dependency direction never points from UBO Control into the host.

## Ownership graph projection boundary

G5.1A adds the deliberately public, stateless `ubo-ownership-graph-projection-v1` consumer contract:

```text
DecisionSnapshot
      ↓
provider-neutral OwnershipGraphProjection
      ↓
renderer / host / API consumer
```

`projectOwnershipGraph({ decisionSnapshot })` accepts one already-created DecisionSnapshot, verifies its schema and canonical hash, and returns an immutable, deterministic, data-only and JSON-serializable projection. It purposefully selects canonical subject/node identity, graph relationships, already-recorded calculations and ordered paths, policy qualifications, semantic unresolved needs, conflicts, reviews, snapshot/history identity and machine-derived summary counts. Evidence remains opaque provider-neutral `EvidenceReference` data.

Projection is not another reasoning stage. It never adjudicates claims, rebuilds the canonical graph, recalculates percentages, reevaluates policy, resolves requirements or chooses a conflict winner. Presentation layers may explain UBO reasoning but may not recompute or reinterpret UBO domain conclusions. The contract carries semantic flags and durable references, never colours, layout coordinates, SVG/Canvas/DOM instructions, React components or customer-screen wording.

The projection has no dependency on the legacy Discovery graph, legacy calculations, provider responses, a document graph, Evidence Platform, onboarding state or renderer implementation. Historical snapshots are projected using their recorded reasoning and algorithm identities; G5.1A does not implement historical comparison. G5.1B owns the interactive renderer and its presentation choices.

## Adaptive journey projection boundary

G5.2A adds a sibling public projection over the same verified decision record:

```text
                         ┌→ projectOwnershipGraph → renderer / host / API
verified DecisionSnapshot┤
                         └→ projectUboJourney ─────→ host journey / API
```

`projectUboJourney({ decisionSnapshot })` returns the immutable, deterministic and data-only `ubo-journey-projection-v1` contract. It consumes only recorded DecisionSnapshot outputs: InformationNeeds, unranked ResolutionOptions, ActionIntents, operational blockers, internal reviews, terminal state, canonical entities and qualifying-person determinations. It is not part of `createUboDecisionApplication` and does not call a capability or rerun any reasoning stage.

Customer work is projected only from open customer-resolvable ActionIntents. Shared semantic work is coalesced, established identity fields are separated from missing R07 fields, and operational failure never becomes a customer request. System work, blockers, analyst review, fallback review and specialist review remain explicit separate surfaces. `SPECIALIST_REVIEW_REQUIRED` halts ordinary customer work; a completed case emits no synthetic continuation item.

The contract carries stable semantic identifiers and canonical entity, relationship, InformationNeed and requirement references. It contains no screen, page, route, button, form, DOM, React or provider identifiers. Policy-approved action-template references may be carried; source wording marked unresolved is never invented by the projection. Resolution options are deliberately labelled unranked: G5.2A does not implement JH-006 priority or the future G5.2B resolution-selection policy.

## Low-friction resolution-planning boundary

G5.2B adds a distinct advisory product layer after policy/orchestration and journey projection:

```text
DecisionSnapshot
      ↓
JourneyProjection
      ↓
planUboResolution
      ↓
ResolutionPlan
      ↓
host / automation / onboarding consumer
```

`planUboResolution({ decisionSnapshot })` verifies the snapshot, reuses `projectUboJourney` semantics internally, and returns immutable `ubo-resolution-plan-v1` data pinned to `ubo-low-friction-planner-v1`. A host never needs private G2.4 modules. The planner reads only recorded open InformationNeeds, ResolutionOptions, ActionIntents, ResolutionAttempts, blockers, review state and terminal outcomes.

Planning is operational advice, not compliance reasoning. Policy decides which strategies are permitted and sufficient; the planner can select only currently `APPLICABLE` recorded options. It cannot create a requirement, make an option applicable, weaken evidence sufficiency, resolve a requirement, mutate a DecisionSnapshot or execute Discovery/Extraction.

The v1 planner uses semantic tiers rather than scores: resolved work disappears; actionable zero-customer routes form a system wave; necessary customer work forms coalesced CustomerResolutionBundles; internal/specialist review follows; and non-success terminal policy outcomes remain DecisionSnapshot-owned blocked states. Discovery and interpretation of already-held artifacts have no universal precedence and may share a system wave. The host must re-evaluate after materially different waves before requesting avoidable later work.

ResolutionAttempt history prevents unchanged substantive repeats after `NO_DATA`, `UNSUPPORTED`, final `INCONCLUSIVE` or `PARTIAL`. `FAILED` and `UNAVAILABLE` remain operational retry/hold or blocked states and never, by themselves, unlock customer remediation. Deferred alternatives remain visible without being labelled invalid.

ResolutionPlan data carries canonical entity, relationship, InformationNeed and requirement references. It contains no provider selection, execution callback, cost/latency ranking, numeric friction score, form/screen/route instruction or Evidence Platform dependency. Future operational profiles require separate explicit product versions and cannot alter UBO compliance reasoning.

## External capability ports

UBO Control has exactly two candidate-fact acquisition ports:

- `DiscoveryService.discover(request)`
- `ExtractionService.extract(request)`

They are asynchronous duck-typed contracts, not framework base classes. Providers are explicitly injected. Missing or invalid providers fail composition with `UboConfigurationError`; no provider or stub is auto-selected.

G1.2B supplies deterministic `StubDiscoveryService` and `StubExtractionService` implementations under `test-support/`. They are internal test infrastructure, are absent from the public entry point, and can be used only when a test or development harness injects them explicitly. They contain no provider selection, environment configuration, network access, persistence, or production fallback behavior.

Both requests carry `contractVersion`, `requestId`, `caseId`, and `informationNeeds`. Discovery additionally carries `subject`. Extraction additionally carries `artifactEvidenceReferences`, which point to externally held evidence.

Both capabilities return:

```text
{
  contractVersion,
  requestId,
  outcome,
  candidateFacts,
  operationEvidenceReferences,
  issues
}
```

Candidate facts, operation evidence references, and issues are always arrays. Provider-specific response structures do not cross this boundary.

## Optional host integration boundary

Host/provider adapters live outside the standalone product root and depend inward on the deliberate `ubo-control/index.js` surface. Production code inside `ubo-control/` never imports `integrations/`; an integration may not deep-import private core modules.

G3.1 adds the disposable `integrations/ubo-control/legacy-discovery/` anti-corruption adapter. It implements `DiscoveryService` using an explicitly injected transport for the external `POST /api/ubo-discovery` capability. The adapter imports no legacy implementation, provider SDK, persistence, onboarding or Evidence Platform code. It translates only sufficiently definite direct source assertions into candidate facts and ignores legacy UBO, effective-ownership, threshold, control, gap, stakeholder, reviewer and cached-determination conclusions. Known legacy loss is expressed through conservative capability outcomes and stable integration issues, never by weakening core candidate-fact, graph, calculation, policy, evidence or decision-history semantics.

The adapter remains outside core because it is host-specific disposable infrastructure. Removing it requires no change to UBO Control. G3.1 contains no live endpoint composition; deterministic tests inject response fixtures.

## Candidate facts and graph direction

Capabilities return candidate facts, never authoritative owners, PSCs, controllers, UBO decisions, or graph mutations. Supported fact forms are `RELATIONSHIP` and `ENTITY_ATTRIBUTE`.

Relationship direction is grammatical: `subject relationship object`. “Alice ECONOMIC_OWNERSHIP HoldCo” means Alice economically owns HoldCo. Storage convenience must not reverse it.

Relationship types are jurisdiction-neutral facts. UK PSC conditions and other policy conclusions remain Policy Pack concerns. Gate 1 does not perform qualification, conflict resolution, graph mutation, or effective-ownership calculation.

## Candidate identity

A `CandidatePartyReference` may refer to an existing canonical `entityId`, but newly discovered parties do not require one. A useful name or external identifier is sufficient. Names are assertions and aliases, never identity keys.

Identity resolution is explicit and auditable through `IdentityResolutionDecision`. It supports `RESOLVED`, `UNRESOLVED`, and `REJECTED`. Gate 1 does not implement matching doctrine or automatic name-based merging.

## G2.1 case and claim boundary

`OwnershipCase` is the aggregate root for UBO-owned reasoning state. It has a stable case ID, an external customer/subject reference, optional opaque host references, and deterministic revision/event identities. Every change returns a new deeply frozen case projection; prior projections, claim creation state, identity decisions, adjudications, capability-operation records and case events remain reconstructable. The aggregate stores no raw evidence artifact and has no persistence or host-case dependency.

Canonical entities are UBO-owned records with stable entity IDs and one of `NATURAL_PERSON`, `LEGAL_ENTITY`, `TRUST_OR_LEGAL_ARRANGEMENT`, `OTHER` or `UNKNOWN`. Names, aliases, external identifiers, jurisdiction and entity-type metadata are retained as assertions. Equal or normalized names never create an identity match, merge or canonical key.

Validated capability results enter through a pure intake operation. Intake does not call a capability or provider. It records the capability request/outcome and opaque operation evidence references, then creates separate UBO candidate claims for claimable candidate facts. Each claim has a deterministic stable ID scoped to the case and intake operation, a reference to the originating request/fact, preserved grammatical direction, typed measurement, qualifiers and fact-level evidence references. Capability inputs are cloned rather than mutated. `NO_DATA`, `UNAVAILABLE`, `FAILED` and other non-claimable outcomes create no ownership/control claim and never become negative conclusions.

Every claim starts in `CANDIDATE`. A different claim state can be projected only from an explicit immutable adjudication record containing its prior/resulting state, reason code, origin, time and relevant evidence/claim references. G2.1 implements no evidence precedence, conflict winner, recency, exact-versus-range or duplicate-interest doctrine. Competing and apparently duplicate claims remain separately addressable. `SUPERSEDED` and `REJECTED` are terminal mechanical states; prior claim content and adjudications are retained.

Each claim endpoint has a claim-scoped candidate-party key. Resolution to an existing or newly created canonical entity, deliberate non-resolution, and rejection of a proposed match all require an explicit `IdentityResolutionDecision`. A supplied candidate `entityId` is not an automatic resolution. Repeated names across candidate endpoints or canonical entities have no matching effect.

G2.1 exposes only a structural graph-eligibility projection. A relationship claim is `GRAPH_ELIGIBLE` only when it is `OPERATIVE` and both candidate endpoints have current explicit `RESOLVED` decisions to canonical entities in the case. Entity-attribute claims, non-operative claims and unresolved/rejected endpoints are not eligible. This projection does not create an edge or graph and performs no traversal, arithmetic, policy evaluation or UBO determination.

The G2.1 modules remain internal beneath `domain/`; the deliberate public `index.js` surface is unchanged pending an approved consumer contract.

## G2.2 canonical graph boundary

`ubo-graph-v1` constructs a deeply frozen canonical graph from one immutable `OwnershipCase` revision. Construction reads only relationship claims that are `OPERATIVE` and whose subject and object have explicit current `RESOLVED` identity decisions. It never mutates the case. Graph nodes use canonical UBO entity IDs; relationships preserve grammatical subject-to-object direction, relationship type, measurement, qualifiers, interpreted temporal state, and every supporting operative claim ID.

Relationship slots are identified by canonical endpoints, relationship type, and the complete data-only qualifier set. Equal operative assertions in one slot coalesce into one semantic graph relationship and retain their sorted supporting claim IDs. Materially different values in an otherwise equal slot fail with a typed graph-domain error. Callers distinguish genuinely separate instruments or rights through explicit source qualifiers such as a share class or interest identifier; G2.2 does not guess whether unqualified observations are duplicates or separate interests.

The graph includes percentage and non-percentage facts but no policy conclusion. Economic ownership and voting rights are separate percentage dimensions. Appointment, removal, formal-control, significant-influence, trust, and similar relationships remain graph facts and are not percentage-multiplied. No relationship basis is converted into another.

The graph fingerprint is SHA-256 over `ubo-canonical-json-v1` serialization of the `ubo-graph-v1` algorithm identity, source case ID/revision/revision ID, sorted canonical nodes, and sorted semantic relationships including qualifiers, temporal state, measurements, and supporting claim IDs. It is independent of insertion order, object-key order, memory layout, and wall-clock generation timing. A changed reasoning input changes the fingerprint.

For a current graph, explicit ceased/historical relationships remain visible but are excluded from current arithmetic. Explicitly contradictory current/ceased qualifiers fail deterministically. Unknown currentness remains `UNKNOWN` and makes only a relevant percentage path unresolved. G2.2 applies no temporal precedence rule.

Distinct current percentage relationships into the same entity and dimension cannot have minimum interests totalling more than 100%. Such a graph fails with a typed inconsistency error; percentages are never normalized or proportionally repaired. Upper bounds over 100% alone are not rejected.

## G2.2 deterministic percentage calculation

`ubo-percentage-lookthrough-v1` traverses edge-distinct, node-simple paths in one homogeneous dimension: `ECONOMIC` or `VOTING`. Each path multiplies every percentage edge, and distinct valid paths are summed even when they converge on a shared downstream relationship. A semantic relationship is counted once regardless of how many claims corroborate it. Mixed economic/voting/control paths are not inferred.

Authoritative arithmetic uses normalized `BigInt` rationals derived deterministically from the existing validated JSON-number percentage inputs. No binary floating-point multiplication or addition determines an ownership value. Internal calculated values serialize exact finite decimals as strings; this remains an internal G2.2 artifact and does not widen the public percentage or `index.js` contract.

Ranges use non-negative interval multiplication and addition, preserving lower/upper endpoint attainability, including zero-factor cases. Multiple path ranges sum bound-wise. The universal percentage domain caps a raw aggregate upper bound at an attainable inclusive 100%, while the separate graph invariant prevents that cap from concealing impossible minimum totals. Ranges remain ranges and no threshold is applied.

An `UNKNOWN` percentage or unknown temporal state is never coerced to zero, 100, or a midpoint. Known independent contributions remain available diagnostically. Results distinguish `COMPLETE`, `PARTIAL`, `UNRESOLVED`, and `NO_PATH`; `NO_PATH` has no numeric result and is not exact zero. Each result pins its graph version, algorithm identity, subject, target, dimension, contributing known paths, unresolved paths, relevant cycles, and known aggregate when one exists.

Traversal records a cycle only when it lies in the requested subject-to-target percentage subgraph. It stops at the repeated node, retains any separately calculable acyclic contribution, and prevents a result with a relevant unresolved cycle from being `COMPLETE`. G2.2 does not solve circular ownership algebraically.

Graph construction and calculation remain internal under `domain/`. They contain no threshold qualification, UBO/PSC/controller determination, Policy Pack evaluation, evidence sufficiency, gap/action generation, provider call, persistence, host integration, or public API expansion.

## G2.3 policy determination boundary

`ubo-policy-determination-v1` is a pure internal interpretation stage after the G2.2 graph and percentage calculations. It pins the canonical Policy Pack ID, policy version, schema identity, canonical policy hash, and determination algorithm in every result. It verifies that the supplied identity matches the loaded pack and rejects tampering. It does not rebuild the graph or recompute percentage paths.

Policy and requirement applicability are distinct. The pack first yields `APPLIES`, `DOES_NOT_APPLY`, or `UNKNOWN` from its configured entity-type routes. Each requirement then independently evaluates its `ubo-condition-v1` applicability condition to the same three values, subject to the pack result. An out-of-scope route is retained as policy data; an unknown entity profile is not coerced in or out of scope.

`ubo-condition-v1` is interpreted through its validated AST without `eval`, `Function`, `vm`, calls, mutation, or host access. Logical operators use exhaustive three-valued truth tables. A missing identifier is unknown. Missing and explicit null compare equal only for `== null`; `!= null` is true only for a present non-null value. Every other comparison involving missing or null is `UNKNOWN`. Invalid or unsupported syntax is a typed `POLICY_CONFIGURATION_ERROR`, never a false business result.

Each policy basis is assessed as `SATISFIED`, `NOT_SATISFIED`, `INDETERMINATE`, or `REVIEW_REQUIRED`. Percentage qualification reads the pack's `percent_exclusive` threshold parameter and compares exact G2.2 rational strings or interval endpoints without binary floating-point arithmetic. Exact equality does not qualify. A range qualifies only when every attainable value is above the threshold and fails only when every attainable value is at or below it; a straddling range is indeterminate. A known positive contribution in a `PARTIAL` result may already satisfy, but incomplete results never produce a negative conclusion. `UNRESOLVED`, relevant cycles, and `NO_PATH` remain indeterminate; `NO_PATH` is never treated as zero.

Economic ownership and voting control remain separate bases. Appointment control qualifies only when the graph relationship carries the Policy Pack's explicit COMPANY board-majority or LLP management-majority concept and scope. Generic or insufficiently qualified appointment facts do not automatically qualify. An explicit established significant-control relationship can qualify as other-means control; S16-style ambiguity is `REVIEW_REQUIRED` and does not project a person.

Qualifying-person projection includes only canonical `NATURAL_PERSON` entities and only Policy Pack roles: `beneficial_owner`, `controller_voting`, `controller_appointment`, and `controller_other_means`. Multiple satisfied bases for one person are grouped deterministically. A satisfied basis held by a legal entity is retained with `ULTIMATE_NATURAL_PERSON_UNRESOLVED` and is never represented as a natural person.

G2.3 deliberately stops at policy assessment. It does not determine evidence sufficiency or a terminal requirement outcome and does not create InformationNeeds, gaps, actions, questions, document requests, analyst tasks, SMO fallback, discrepancy workflows, decision snapshots, provider calls, persistence, onboarding projection, or public `index.js` exports. Those resolution-planning concerns remain G2.4 or later.

## G2.4A requirement-resolution boundary

`ubo-requirement-resolution-v1` is a pure internal stage after G2.3. It consumes the pinned Policy Pack, exact OwnershipCase revision, canonical graph, supplied G2.2 calculations, G2.3 applicability/basis assessments, explicit evidence-policy classifications, and deterministic facts/answers/evaluation date. It verifies all identities and never reconstructs graph arithmetic or policy qualification.

Each requirement uses the approved `ubo-requirement-state-v1` vocabulary and precedence: `DOES_NOT_APPLY` becomes `N_A`; unknown applicability remains `UNRESOLVED`; an explicitly mapped materially relevant disputed claim becomes `CONFLICT`; a G2.3 interpretation requirement becomes `REVIEW_REQUIRED`; satisfied facts and evidence become `RESOLVED`; a substantive fact/evidence deficit becomes `GAP`; and an explicitly operational-only failure remains `UNRESOLVED` with an OperationalBlocker. An unrelated conflict is never projected across requirements.

`EvidencePolicyClassification` is an immutable, deterministic, case-revision and Policy-Pack-hash-pinned reasoning record. It preserves the durable EvidenceReference, optional catalogue key, explicit source origin (`INDEPENDENT_OF_APPLICANT`, `APPLICANT_ORIGINATED`, or `UNKNOWN`), supplied captured/effective/current-state metadata, classification basis, and explicit requirement/fact/basis support. It does not change the generic EvidenceReference contract and does not infer independence from the uploader. Unknown catalogue mappings remain visible as `UNCLASSIFIED`; they are not discarded or treated as strength zero.

Evidence strength and characteristics come only from the pinned Policy Pack. Strengths are tested per distinct durable source and never added. Numeric minimum, resolution direction/effect, `canResolveAlone`, corroboration, attestation risk permission, current state, freshness, and independent-source count remain separate constraints. `POSITIVE_ONLY` cannot prove absence from silence; `CORROBORATIVE_ONLY` cannot establish an underlying fact alone; `CALCULATION_ONLY` applies only to pinned deterministic calculation. Registry maximum age uses the supplied evaluation date and deterministic calendar-month expiry; no system clock participates.

An InformationNeed is a domain-semantic statement of missing information, not an action. It records a stable semantic need ID, revision record ID, canonical subject/relationship/attribute target, all requiring requirement IDs, reason and reasoning references, existing EvidenceReferences, and an unordered set of policy-permitted resolution strategies. In addition to the approved core concepts, `ENTITY_PROFILE`, `TRUST_INVOLVEMENT`, and `NOMINEE_OR_BEARER_STATUS` name the domain-neutral missing facts needed for applicability, R11, and R12 without implying a screen or action. Equivalent subject/concept targets deduplicate across requirements while different concepts remain separate. Append-only revision records support `OPEN`, `SATISFIED`, and `SUPERSEDED` without deleting earlier reasoning.

A PolicyGap exists only for an applicable substantive fact/evidence deficit and points to its InformationNeeds. It contains no screen, question, document, or action wording. A capability `UNAVAILABLE` or `FAILED` outcome instead produces an OperationalBlocker tied to its operation and explicitly known affected requirements/needs; `NO_DATA`, `INCONCLUSIVE`, `UNSUPPORTED`, and `PARTIAL` never become negative evidence or operational blockers merely because resolution is incomplete.

G2.4A resolves R01/R02/R03/R04/R05/R06/R07/R08/R11/R12 only within their approved deterministic boundary. R07 reads canonical names, G2.3 control bases, and existing operative `ENTITY_ATTRIBUTE` claims; it performs no IDV, screening, POI, or POA. Trust presence preserves specialist review without generating a route. Nominee facts may create an underlying-principal need, while bearer-share acceptance remains review-only. R09 discrepancy, R10 fallback, R13 risk-signal orchestration, and R14 submit-gate completion remain unresolved for G2.4B/later.

No resolution priority, question/document/task generation, final action, SMO fallback, terminal outcome, full decision snapshot, persistence, provider behavior, onboarding projection, or public `index.js` expansion exists in G2.4A.

## G2.4B resolution-orchestration boundary

`ubo-resolution-orchestration-v1` is a pure internal stage over the exact G2.4A result and its pinned case, graph, calculations, policy assessment, and UK Corporate `1.4-RC` Policy Pack. It does not mutate a requirement merely because an action or capability attempt succeeded: returned facts/evidence must re-enter the normal candidate-fact → claim → graph → calculation → policy → requirement-resolution pipeline.

An `InformationNeed` remains distinct from a `ResolutionOption`, which remains distinct from an `ActionIntent`. Every open semantic need exposes all currently policy-permitted options without generic ranking. Applicability may reflect explicit runtime availability, held evidence, or unresolved canonical question content. An ActionIntent is emitted automatically only when one policy option is uniquely applicable or when policy directly requires review/operational handling. Equivalent semantic intents coalesce while retaining all need, gap, requirement and option references. No universal existing-evidence/discovery/customer/analyst priority doctrine exists.

ActionIntents are host-neutral and limited to discovery, held-artifact interpretation, customer information/evidence/attestation, analyst/specialist review, and operational retry/hold. They contain no UI, message delivery, assignment, SLA, provider request, ticket, or regulatory submission. Operational failure never becomes a customer evidence request. Unresolved Policy Pack wording remains a visible non-actionable option and is never fabricated.

`ResolutionAttempt` is an immutable append-only record with deterministic sequence metadata, referenced needs/options/intents, strategy, domain outcome, optional underlying capability outcome/reference, and returned fact/evidence references. `FAILED`/`UNAVAILABLE` stay `OPERATIONALLY_BLOCKED`; `NO_DATA` is retained as no resolution. Attempts store no raw evidence and never directly resolve requirements.

Human fallback review is asynchronous. The machine may produce `FALLBACK_REVIEW_CANDIDATE` only when no qualifying person has been established or the firm is explicitly unsatisfied with an identified person, the Policy Pack's pre-fallback requirement states are complete, no substantive customer-resolvable ownership/control need or relevant operational blocker remains, and no specialist route would be bypassed. An operational failure becomes irrelevant only when another route has resolved its affected requirement/need. Missing explicit senior-management candidate data creates a preparatory semantic collection need. `SENIOR_MANAGEMENT_CANDIDATE` is not the `senior_managing_official_fallback` role.

Once candidate data is complete, UBO Control emits an immutable `FALLBACK_EXHAUSTION` ReviewRequirement and a review-ready package of durable case/policy/graph, requirement, need, attempt, capability, evidence, calculation, conflict/review and candidate-person references. The package duplicates no raw evidence and is not the complete G2.4C DecisionSnapshot. Human review is a domain output, never a synchronous customer-journey dependency; the consuming product decides where review occurs.

Only a current case/policy/graph/manifest-pinned `ALL_POSSIBLE_MEANS_EXHAUSTED` decision from `ANALYST` or `COMPLIANCE` derives fallback eligibility. Caller facts, attempt counts, `NO_DATA`, `FAILED`, and `UNAVAILABLE` cannot do so. `FURTHER_MEASURES_AVAILABLE` requires a concrete InformationNeed and never directly creates a generic RFI. A stale decision is rejected after material reasoning-state change. Final SMO role application requires an explicit selection from canonical natural persons already established as senior-management candidates; it preserves existing ownership/control roles, the exhaustion decision and measures-taken attempt references.

R09 compares explicit normalized current UBO/control facts with explicit PSC facts. PSC silence is not negative proof. Results are limited to `NO_DISCREPANCY`, `POTENTIAL_DISCREPANCY`, `NON_REPORTABLE_DEFINITION_DIFFERENCE`, and `REVIEW_REQUIRED`; unmatched facts emit review intent, never a regulator report. Definition-difference and non-material results require explicit rationale rather than invented legal materiality doctrine.

R13 derives chain depth and cross-border graph character and emits only Policy Pack-owned `RATING_FLOOR`/`RATING_SET` signals with graph/calculation basis. R10 and R11 emit their configured HIGH signals only when their own policy conditions hold. UBO Control never imports or mutates authoritative host risk.

R14 is a closing completeness backstop. It becomes actionable only when underlying applicable requirements are complete. A positive referenced attestation resolves R14 only; it never repairs a graph, cures another gap, or proves ownership/control. Missing/refused closing attestation prevents ordinary final resolution.

Terminal orchestration follows Policy Pack precedence: `CDD_FAILURE`, `SPECIALIST_REVIEW_REQUIRED`, `RESOLVED_VIA_SMO_FALLBACK`, expressly permitted `RESOLVED_PROVISIONALLY`, `RESOLVED`, then explicit `UNRESOLVABLE`; otherwise the engine remains non-terminal `IN_PROGRESS`. Requirement counts alone never select an outcome. Conflicts, fallback state, specialist routes, closing attestation and explicit CDD semantics are considered independently.

The customer projection is host-neutral: `CUSTOMER_INPUT_REQUIRED`, `CUSTOMER_INPUT_COMPLETE`, or `INTERNAL_REVIEW_REQUIRED`. It expresses interaction ownership, not an onboarding screen. G2.4B adds no public `index.js` export, persistence, provider execution, host risk mutation, case-management UI, full DecisionSnapshot, snapshot hash/supersession, or G2.4C reconstruction/history behavior.

## G2.4C decision-snapshot and history boundary

`ubo-decision-snapshot-v1` is an immutable record of the complete UBO-owned decision state at one explicit `CASE_OPEN`, `SESSION_START`, `SUBMIT_GATE`, or host-neutral `CASE_EVENT` checkpoint. Construction accepts an explicit evaluation time; no system clock, provider, Discovery/Extraction call, persistence operation, or automatic field-edit trigger participates. `ubo-gate-2-re-resolution-coordinator-v1` is an internal pure composition of the existing case → graph → calculation → determination → requirement-resolution → orchestration stages and snapshot construction.

The canonical decision content pins the exact case revision, checkpoint and semantic event reference, Policy Pack ID/version/schema/canonical hash and effective parameters, graph/calculation/determination/requirement/orchestration/snapshot algorithm identities, minimized canonical entities, identity decisions, operative/provisional/disputed claims, graph, calculations, evidence classifications and support links, attempts, material capability-operation records, review decisions, and the complete historical decision outputs. Raw uploads, registry payloads, screenshots, source HTML and provider payloads remain outside UBO Control.

Decision-content identity is `SHA-256(UTF-8(ubo-canonical-json-v1(canonical decision content)))`, exposed as `sha256:<hex>`. Snapshot schema, algorithms, policy, checkpoint, reasoning, outputs, predecessor and supersession reason are hashed. Externally supplied recording metadata is stored separately and excluded. Object insertion order and recording time cannot change the decision hash; any material reasoning change does. Snapshot verification is offline and checks the canonical hash, case/graph/calculation/policy identities, algorithm pins, predecessor link and internal requirement/need/option/review references.

History is append-only and linear per `OwnershipCase`. Genesis records an explicit null predecessor. Every later snapshot points to the immediately preceding accepted snapshot and states a domain-neutral supersession reason; predecessors are never updated with `supersededBy`. An expected-head check raises typed `STALE_DECISION_HISTORY_HEAD` rather than silently creating a fork. Policy and algorithm changes therefore create new history while old snapshots retain their original identities and remain reconstructable.

`ubo-decision-reconstruction-v1` validates one historical snapshot and returns exactly its recorded qualifying people/bases, requirement states, needs/gaps/blockers, options/intents/reviews, discrepancy reasoning, risk signals, customer projection, measures-taken manifest and terminal state. It does not recollect evidence, rerun a provider, apply the current Policy Pack, or claim an unresolved historical state was complete. Reconstruction and re-resolution are separate operations.

Where SMO fallback exists, the snapshot carries the full R10 measures-taken manifest: attempts, material capability operations, durable evidence and calculation references, requirement resolutions, current ReviewRequirement and authoritative FallbackExhaustionDecision. G2.4C remains internal and persistence-ready only: no database, filesystem/KV/object store, scheduler, provider adapter, UI, host integration, notification, webhook, public `index.js` export or Gate 3 behavior is introduced.

## G3.2 public Decision Application and live-composition boundary

`createUboDecisionApplication({ policyPack })` is the standalone product's deliberately small `ubo-decision-application-v1` reasoning boundary. It is separate from the existing capability-oriented `createUboControl`. The application retains only immutable Policy Pack configuration; mutable case state is always supplied and returned explicitly through an integrity-protected, data-only, JSON-serializable `DecisionApplicationCaseState` envelope.

The only public operations are `intake`, `applyDecisions`, and `evaluate`. Intake creates/restores the private case and records a validated capability result without adjudication. Stable candidate-party and claim targets require explicit entity registration, identity decisions and claim adjudication. Evaluation refuses undecided targets, privately plans economic/voting calculations from the applicable Policy Pack entity profile, runs the existing full case → graph → calculation → policy → requirement → orchestration → snapshot pipeline, and returns the authoritative fresh `DecisionSnapshot`. Calculation requests and every private Gate 2 stage remain absent from the public surface. One typed `DecisionApplicationError` surface protects the wire contract with stable codes.

The real legacy HTTP transport and `createLegacyDiscoveryComposition` live outside the product root under `integrations/ubo-control/legacy-discovery/`. They depend only on `ubo-control/index.js`; the core never imports them. Base URL, HTTP timeout and optional injected fetch are infrastructure configuration. Provider credentials, endpoint implementation, legacy conclusions and production stub selection remain behind/outside the boundary. Deterministic E2E tests are offline; controlled live verification is a separate opt-in command and requires explicit harness decisions before evaluation.

No onboarding, Extraction/Evidence Platform integration, persistence, UI or graph renderer is introduced by G3.2. The Gate 5.1 projection and renderer use the fresh canonical graph/DecisionSnapshot rather than legacy graph authority.

## G5.1 ownership-visualisation boundary

`projectOwnershipGraph({ decisionSnapshot })` is the only bridge from the headless product into ownership visualisation. It verifies the supplied `ubo-decision-snapshot-v1` and returns the versioned, immutable, data-only `ubo-ownership-graph-projection-v1` consumer contract. API consumers may stop at that boundary.

The optional React renderer lives in the sibling `ubo-control-ui/` package, never inside or below the standalone core. It imports no UBO private module. Its production dependency is React supplied by the host, and its only domain input is a complete projection. Presentation-only layout, formatting, selection, path emphasis and pan/zoom state may occur in the renderer; graph construction, claim selection, effective-interest arithmetic, policy determination, requirement resolution and qualification inference may not.

The renderer shows the projection's recorded nodes, relationship dimensions/types, exact/range/unknown measurements, calculation paths/contributions, qualification bases, unresolved items, conflicts, reviews and opaque support references. `CUSTOMER` and `EXPLAIN` are presentation detail levels, not different decisions. Replacing one projection with another supports explicit historical or before/after viewing without making the renderer a history engine.

The standalone demo is deterministic and offline. UI01–UI12 fixtures are built through the public Decision Application and public projection operation; the demo imports neither legacy Discovery nor Evidence Platform and performs no API call. Host onboarding, analyst workflow, persistence and historical comparison remain later integration concerns.

## G5.3A adaptive-customer-journey boundary

`UboJourney` lives beside `OwnershipGraph` in `ubo-control-ui/` and consumes only a complete `ubo-journey-projection-v1`, matching `ubo-resolution-plan-v1`, and optional `ubo-ownership-graph-projection-v1`. The headless `ubo-control/` product never imports the UI package. The UI never accepts raw DecisionSnapshot, InformationNeed, Policy Pack, threshold, claim/graph-domain, provider or evidence-platform input.

The component displays the current selected plan: established facts, only missing fields, deliberately coalesced customer bundles, approved confirmation, targeted evidence handoff, and neutral system/blocker/review/complete states. It uses only entity-profile and semantic identifiers already present in the public contracts. It neither ranks alternatives beyond the plan nor fabricates customer wording. The existing OwnershipGraph is optional visual context and canonical graph links connect tasks to nodes/relationships without creating another graph implementation.

Customer input leaves through a data-only `ubo-customer-action-v1` interaction event containing bundle/work-item/action-intent/action references, canonical subject semantics, entered values, confirmation/selected-option results and (when needed) an `EVIDENCE_ACTION_REQUESTED` intent. Files and raw bytes are excluded. Local React state is ephemeral; submission does not mutate a projection or plan and cannot resolve a UBO requirement. Authoritative change requires future host processing and a fresh DecisionSnapshot, projection and plan. `createUboDecisionApplication`, host onboarding and Evidence Platform are unchanged.

## Percentage values

Percentages are typed as `EXACT`, `RANGE`, or `UNKNOWN`. A range retains both bounds and inclusive/exclusive endpoints. Gate 1 never coerces a range to a scalar. G2.2 consumes the unchanged validated input shape through exact internal rational and interval arithmetic. G2.3 interprets only the resulting exact/range aggregate against a Policy Pack threshold; it does not alter the calculation.

## Evidence boundary

UBO Control stores only provider-neutral `EvidenceReference` values containing opaque external references and optional locator/integrity metadata. It does not copy or store raw evidence and does not import Evidence Platform types.

Fact-level `evidenceReferences` support only the candidate fact carrying them. Result-level `operationEvidenceReferences` identify material involved in the operation and never become fact support implicitly.

## Capability outcomes

The approved states are `COMPLETE`, `PARTIAL`, `NO_DATA`, `INCONCLUSIVE`, `UNSUPPORTED`, `UNAVAILABLE`, and `FAILED`. Operational unavailability or failure is not negative ownership/control evidence.

Capability outcomes, information needs, requirement states, resolution strategies, and customer/analyst actions remain distinct concepts. `UNRESOLVED` means a requirement has not yet been determined; it is not a synonym for `GAP`. Capability failure, unavailability, or `NO_DATA` never resolves a requirement negatively by itself.

## Policy Packs

Policy Packs are data-only versioned JSON runtime artifacts. The schema identity is independent of the tenant policy version. Historical packs use `ubo-policy-pack` / `1.0`; schema `1.1` adds validated fallback-review and resolution-orchestration policy data while retaining `1.0` loading compatibility. A pack pins the exact engine-owned semantic contract versions it requires: capability outcomes, requirement states, claim states, three-valued applicability, resolution semantics, risk levels, condition language, and canonicalization. Engine vocabulary is not duplicated or redefined as tenant data.

The runtime schema validates identity, status, jurisdiction, applicability, effective period, entity profiles, parameters, definitions, evidence catalogue references, requirements, action templates, resolution strategies/effects, and lifecycle source references. References are closed and strict. Missing source content remains an explicit unresolved source reference; a runtime artifact must not silently map it to a host ID or invent policy text.

Policy source and runtime artifacts are separate. Source provenance, review status, source hash, and unresolved references remain visible in the runtime artifact. Host presentation labels, application route IDs, engine I/O contracts, and architecture invariants are not policy content. Semantic action template IDs are durable runtime identifiers; source questionnaire labels such as `B1` remain traceability metadata only.

Policy identity is SHA-256 over the UTF-8 bytes of `ubo-canonical-json-v1`, never the source file bytes. Canonicalization recursively sorts object keys, preserves array order, uses JSON string/finite-number encoding, and rejects executable, non-JSON, or circular values. Equivalent parsed data has the same hash despite whitespace, key order, or line-ending differences.

## Condition-language boundary

`ubo-condition-v1` is a deterministic, data-only syntax contract. It permits `always`; paths rooted at `case`, `facts`, `answers`, or `params`; JSON-like scalar literals; comparison operators `==`, `!=`, `>`, `>=`, `<`, and `<=`; logical operators `&&` and `||`; and parentheses. Calls, member execution, assignments, arithmetic, arrays, unsupported namespaces, and chained comparisons are invalid.

Its eventual evaluator uses `TRUE`, `FALSE`, and `UNKNOWN`. Missing or null operands produce `UNKNOWN` unless the expression explicitly compares with `null`. G1.2A validates syntax and referenced parameters only. It does not evaluate conditions, determine applicability, resolve requirements, or produce actions.

## Resolution and lifecycle boundaries

The engine owns the provider-neutral resolution strategy vocabulary (`DISCOVERY`, `EXISTING_EVIDENCE`, `CUSTOMER_DOCUMENT`, `CUSTOMER_QUESTION`, `CUSTOMER_ATTESTATION`, `DETERMINISTIC_CALCULATION`, and `ANALYST_REVIEW`) and resolution effects. Extraction remains a candidate-fact acquisition capability; `CUSTOMER_DOCUMENT` is a policy strategy, not a provider or capability name.

Lifecycle checkpoints in a Policy Pack are host-neutral metadata. They do not subscribe to host events and do not trigger autonomous re-resolution. A host may request a future evaluation explicitly, but G1.2A contains no lifecycle engine or host integration.

## Scenario-corpus boundary

The G1.2B corpus is an internal, reusable universe of contract-valid capability requests and configured results. It is not a public product contract or a reasoning DSL. Each run creates isolated stub queues, validates requests and results through the production contracts, and returns defensive data copies. A repeated run starts with fresh queue state and is deterministic.

Scenarios preserve directed candidate facts, exact/range/unknown percentages, fact-level and operation-level evidence, capability outcomes, entity-specific qualifiers, ambiguity, conflicts, cycles, and sequential Discovery/Extraction calls. The corpus itself never pre-bakes a graph, identity merge, claim decision, effective ownership, threshold qualification, UBO/PSC/controller status, requirement resolution, information need, gap, fallback, route, or policy result. G2.2 tests explicitly create G2.1 identity/adjudication decisions around selected unchanged scenario inputs before exercising graph construction. G2.3 tests then feed explicitly constructed graph/calculation inputs into the production policy interpreter; they do not turn future-expectation metadata into executable decisions.

## Testing boundary

Every behavior and architectural invariant is protected in the same PR that introduces it. The architecture suite denies non-built-in imports outside the product root, protects the deliberate public export set, and verifies explicit provider composition. The scenario, graph/calculation, policy-determination, requirement-resolution, orchestration, and decision-snapshot/history suites run offline using only internal production modules, explicitly constructed test inputs or stubs, and production contract validators; they import no legacy, Evidence Platform, onboarding, provider, database, or deployment implementation.
