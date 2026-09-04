# ADR 0030 — Causal frontier InformationNeeds v2

## Status

Accepted for internal, review-only Wave 8 execution. Public exposure remains deferred.

## Decision

New successor snapshots use `ubo-requirement-resolution-v2` and `ubo-information-need-v2`. A need identifies the smallest presently missing fact, proof condition, or decision. Its causal key is derived from the pinned case and policy, canonical target, concept, dimension/basis, temporal scope, frontier/relationship, and required fact/evidence condition. Requirement IDs, calculations, paths, routes, and supporting references are consequences and therefore merge onto the same causal record.

Targets are limited to `CASE`, `REGULATED_SUBJECT`, `FRONTIER_ENTITY`, `RELATIONSHIP`, `PERSON_ATTRIBUTE_SET`, `QUALIFICATION_ROUTE`, and `EVIDENCE_SUFFICIENCY`. A specific relationship defect takes precedence over a broad frontier. A frontier is the topmost material canonical entity where an otherwise known route can no longer proceed.

Dependent effects are `ubo-need-dependent-diagnostic-v1` records. They never count as needs and cannot independently generate work. InformationNeed lifecycle remains exactly `OPEN`, `SATISFIED`, and `SUPERSEDED`. Operational blockers, review requirements, and specialist routes remain separate records linked from `ubo-requirement-resolution-assessment-v2`.

Phase 7 is authoritative for the new causal set. Phase 8 remains `ubo-resolution-plan-v1-compat`; the private `ubo-information-needs-v2-to-plan-v1-compat` bridge supplies one planner input per open cause and at most one currently applicable transitional option per cause. This is not ResolutionPlan v2 or final action bundling.

`ubo-ownership-graph-projection-v2` is an internal, data-only view of recorded Snapshot v2 artifacts. It separates causal needs, dependent diagnostics, blockers, reviews, and specialist routes, and does not reason or regenerate needs. An identified node is not labelled unresolved merely because a related fact remains open.

## Compatibility and consequences

DecisionSnapshot schema remains v2. Its verifier dispatches by the recorded Phase 7 algorithm so historical Wave 7 `ubo-requirement-resolution-v1-compat` snapshots remain valid while Wave 8 snapshots pin the causal need set/hash, diagnostics, v2 assessments, compatibility adapter, and the exact compatibility plan. InformationNeed v1, DecisionSnapshot v1, public applications/planner/projections, current Lab, legacy Discovery, and both policy artifacts are unchanged.

Pipeline maturity is `TRANSITIONAL_PLANNER_ONLY`. Public Decision Application v3, public projection v2, Planner v2, RegistryCapabilityProfile, Lab v2, Evidence and onboarding integration remain deferred.
