# UBO Control product requirements

## PR-POL-001 — Policy Schema 1.3 & Runtime Readiness

**Status:** IMPLEMENTED — FREEZE IMPLEMENTATION WAVE 1

**Target:** UK MVP successor-policy readiness boundary

UBO Control must validate future camelCase schema-1.3 Policy Packs additively and expose an explicit, provider-neutral assessment of whether a pack may be used in Lab, production, or historical-reconstruction context.

Acceptance principles:

- Schemas 1.0, 1.1 and 1.2 and their canonical hashes remain unchanged.
- Schema 1.3 strictly validates the accepted Freeze Pack structures but Wave 1 does not ship UK Corporate 1.6-RC policy content or execute its doctrine.
- Machine-readable sign-offs and production requirements are declared by the pack; the runtime never hard-codes Control Room identifiers.
- Disabled optional-feature dependencies do not block merely by existing; enabled unsigned features do.
- `LAB` clearly identifies review packs, `PRODUCTION` fails closed, and `HISTORICAL_RECONSTRUCTION` requires the exact pinned policy identity/hash and cannot create a new production determination.
- Evaluation time is explicit and results are deterministic, immutable, JSON serializable, and protected by stable typed errors.
- Existing Decision Application v1/v2 behavior and operation sets remain unchanged.
- The current 1.5-RC Lab shows a persistent review-policy watermark without changing decisions, graph, journey, planner, or customer action semantics.
- Legacy repository threshold shorthand is non-authoritative for fresh successor UBO Control; the future Policy Pack owns its comparator while historical behavior remains untouched.

## PR-POL-002 — UK Corporate v1.6-RC Review Policy Container

**Status:** IMPLEMENTED — FREEZE IMPLEMENTATION WAVE 2; EXECUTION NOT STARTED

**Target:** Immutable successor-policy data and governance artifacts

UK Corporate `1.6-RC` is a schema-1.3, `CONTROL_ROOM_REVIEW`, LAB-only policy artifact with null effective date and approver. It records the frozen doctrine, A-01–A-18 states, feature defaults and unsupported successor runtime dependencies without selecting or executing the pack.

Acceptance principles:

- The artifact lives at `policies/uk-corporate/1.6-rc/policy.json` with canonical identity pinned in its source mapping.
- A-08, A-09, A-10 and A-11 are mandatory production sign-offs; no A-record is approved.
- Lab readiness is `REVIEW_ONLY`, production readiness is `BLOCKED`, and unsupported successor dependencies are visible.
- Statutory economic and voting thresholds are separate immutable `>25` declarations; disabled firm thresholds cannot suppress or project statutory status.
- Qualification routes, layer completeness, percentage evidence, control gating, residual statements, listed cases, exhaustion categories, acquisition strategies and phase order are policy data only.
- R01–R14 identifiers remain stable and their successor intent is source-mapped without wiring successor resolvers.
- Only the approved `DISCLOSE_SHARE_OWNERSHIP` structured contract is carried forward as Control Room-approved content; unresolved customer content remains blocked.
- E01/E02/E08/E10 stay unresolved and production-disabled pending A-16.
- Current Decision Application v1/v2, DecisionSnapshot v1, Lab/ASDA, graph, journey, planner and public API behavior remain unchanged and continue using `1.5-RC`.
- `test-assertion-plan.json` classifies every File 07 assertion honestly; a policy declaration is never represented as executable behavior.

## PR-POL-003 — QualificationBasis v2 and Effective-Interest Route Wrapper

**Status:** IMPLEMENTED INTERNALLY — FREEZE IMPLEMENTATION WAVE 3; NOT RUNTIME-WIRED

**Target:** Route-specific successor qualification reasoning

UBO Control must preserve effective-interest qualification reasoning as immutable statutory and firm-policy bases without altering the accepted percentage arithmetic or implying a final whole-person UBO outcome.

Acceptance principles:

- `ubo-qualification-basis-v2` pins policy/hash, graph, calculation, person, target, route, classification, dimension, method, threshold, state, paths and available support references.
- `ubo-effective-interest-qualification-v2` consumes only a recorded `ubo-percentage-lookthrough-v1` result with `ADOPTED_INTERPRETATION`; it performs no graph or arithmetic work.
- Only canonical natural persons can hold final basis records; legal entities remain graph/frontier inputs for later routes.
- Economic and voting thresholds remain independent and `>` / `>=` plus range endpoint semantics are exact.
- Partial, unresolved, cyclic and no-path results cannot become false negatives; no path is not calculated zero.
- Enabled firm collection policy creates a separate `FIRM_POLICY` basis and cannot capture fewer people than statute or suppress statutory status.
- The internal handoff result retains all bases and explicitly lists unassessed management-control and PSC-condition routes. It exposes no authoritative `isUbo`/`qualifies` boolean.
- The modules are not exported or wired into Decision Application, v1 snapshots/projections/planner, UI, Lab, ASDA, legacy Discovery or host onboarding.
- UK Corporate 1.6-RC remains `REVIEW_ONLY`/production-blocked and no Policy Pack bytes or hashes change.

## PR-POL-004 — Company Schedule 1A / PSC-Condition Attribution v1

**Status:** IMPLEMENTED INTERNALLY — REVIEW ONLY

**Target:** Freeze Implementation Wave 4

UBO Control must assess supported company PSC conditions as a separate statutory route without changing effective-interest arithmetic. `ubo-psc-attribution-v1` consumes operative canonical relationships, canonical COMPANY profiles and provider-neutral support references; it emits immutable route-specific QualificationBasis v2 records inside `ubo-psc-attribution-assessment-v1`.

Acceptance principles:

- Company shares require explicit `SHARE_OWNERSHIP`; voting, appointment/removal and SIoC stay distinct.
- Indirect attribution requires a complete current COMPANY-only majority chain established by strict-majority voting or explicit majority appointment/removal semantics.
- The full target right is attributed without upstream percentage multiplication; each distinct target right is counted once and every supporting chain remains visible.
- LLP/trust/specialist paths stop with diagnostics, joint arrangements are not implemented, and trust/firm condition 5 remains unassessed.
- Results remain A-09-dependent, review-only and production-unauthorized; A-12/A-13/A-06 are retained where applicable.
- No whole-person result, Decision Application/Snapshot/projection/Lab behavior or public export is introduced.

## PR-VIS-001 — Ownership Graph Projection & Interactive Renderer

**Status:** IMPLEMENTED — G5.1A AND G5.1B ACCEPTED

**Target:** Gate 5.1

UBO Control must expose a provider-neutral ownership/control graph projection capable of powering an interactive visual explanation of established structure, effective-interest paths, qualifying bases, unresolved branches, conflicts and historical decision states.

Acceptance principles:

- The projection is driven by the fresh canonical UBO graph and `DecisionSnapshot`, never the legacy Discovery graph.
- It works regardless of whether facts originated from Discovery, Extraction, customer answers or internal review.
- Economic ownership, voting rights and control remain distinguishable.
- It explains calculations such as `80% × 50% = 40%` and why a person qualifies.
- It represents unresolved branches and conflicts.
- It can reflect structural change after new evidence and re-resolution.
- It supports simplified customer presentation and richer analyst presentation.
- Historical `DecisionSnapshot` records may later be compared.
- The old legacy graph renderer is interaction/design reference only; none of its graph, calculation or UBO domain logic is authoritative.
- API-only customers can consume the projection without using our renderer.

G5.1A implements the accepted public, provider-neutral projection contract. G5.1B implements the accepted reusable interactive renderer and deterministic standalone demo outside the headless product root. Host-screen integration and historical comparison remain outstanding.

## PR-JRN-001 — Adaptive UBO Journey Projection

**Status:** IMPLEMENTED — G5.2A ACCEPTED

**Target:** Gate 5.2A

UBO Control must expose a provider-neutral, host-neutral journey projection from a verified DecisionSnapshot. The projection organizes already-recorded InformationNeeds, ResolutionOptions, ActionIntents, operational blockers, reviews and qualifying-person handoff data without rerunning discovery, graph construction, calculation, policy determination or resolution orchestration.

Acceptance principles:

- Customer work is emitted only from open customer-resolvable ActionIntents.
- Known information is not requested again; partial identity work contains only missing R07 attributes.
- Shared facts, needs and acceptable artifacts coalesce into stable semantic work items.
- Resolution options remain unranked in the projection; any later operational selection is a separate versioned planner concern.
- System work, operational blockers and internal/specialist review remain separate from customer work.
- Policy wording is referenced, never invented; unresolved source wording remains explicitly unresolved.
- Customer work is entity-profile aware and contains no host route, screen, form or component identifiers.
- Qualifying-person handoff stops at canonical identity, roles, basis and R07 completeness; downstream IDV, screening, POI and POA remain outside UBO Control.
- Re-projecting a later verified DecisionSnapshot naturally removes satisfied work.

## PR-PLN-001 — Low-Friction UBO Resolution Planning

**Status:** IN_IMPLEMENTATION — G5.2B IN REVIEW

**Target:** Gate 5.2B

UBO Control must expose a provider-neutral advisory ResolutionPlan derived from a verified DecisionSnapshot. The planner selects only currently applicable, Policy Pack-permitted ResolutionOptions and recorded ActionIntents. It prioritizes zero-customer-friction resolution, minimizes and coalesces necessary customer work, then routes internal/specialist review without changing policy sufficiency or executing capabilities.

Acceptance principles:

- Contract `ubo-resolution-plan-v1` and planner strategy `ubo-low-friction-planner-v1` are explicit and independently versioned from Policy Packs.
- Resolved information produces no work.
- Discovery, existing-artifact interpretation and deterministic re-evaluation can share one system wave; no provider or capability precedence is invented.
- ResolutionAttempt history suppresses unchanged substantive repeats after NO_DATA, UNSUPPORTED, final INCONCLUSIVE or PARTIAL outcomes.
- Operational failure preserves retry/hold or blocked state and never independently creates customer remediation.
- Customer actions begin only after no actionable system route remains for the relevant need and are coalesced into stable CustomerResolutionBundles.
- Lightweight sufficient response/confirmation is preferred to re-entry or unnecessary evidence; known required information and evidence are bundled rather than serialized.
- Evidence types and ownership-chart relevance come only from recorded ResolutionOptions.
- Internal/fallback review follows currently known customer work; specialist stops override ordinary flow.
- Plans are advisory, immutable, deterministic and contain no execution, host UI, provider ranking or numeric friction score.

## PR-LAB-001 — Standalone UBO Control Lab

**Status:** READY FOR CONTROL ROOM PRODUCT TESTING — G5.3D

**Target:** Gate 5.3D

UBO Control must provide a standalone, deployed compliance-testing Lab that exercises the real public Decision Application, projections, planner, reusable customer journey and ownership renderer without integrating into KYB onboarding.

Acceptance principles:

- Fixture mode exposes LAB01–LAB18 and runs the real deterministic product pipeline.
- Live Discovery mode uses the accepted legacy Discovery composition while treating provider conclusions as non-authoritative candidate material.
- Live Evidence is visibly unavailable until Gate 4 prerequisites are accepted; the Lab does not simulate extraction.
- Customer and Compliance views share one sealed session state and current DecisionSnapshot.
- LAB18 applies the approved structured current-share-ownership question through `ubo-customer-action-v1`, explicit claim adjudication and a fresh linked DecisionSnapshot.
- Compliance users can inspect candidate provenance, decide identity and claim targets, review R01–R14, view history, compare snapshots, inspect the low-friction plan and export local feedback.
- Lab session state is ephemeral and never writes dossiers, onboarding state or a new database model.
- The Lab remains separate from `src/App.js`; KYB onboarding integration is deferred until Control Room product validation.
