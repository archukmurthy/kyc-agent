# UBO Control product requirements

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
