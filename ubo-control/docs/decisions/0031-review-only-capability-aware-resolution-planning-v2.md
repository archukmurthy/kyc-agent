# ADR 0031: Review-only capability-aware ResolutionPlan v2

**Status:** Accepted for Wave 9 review-mode implementation
**Date:** 2026-09-06

## Context

Wave 8 produces causal InformationNeed v2 records but deliberately bridges them into the v1 compatibility planner. That bridge cannot distinguish configured acquisition coverage, assign a structure-acquisition strategy per causal branch, group several compatible needs into one coherent action, or suppress exhausted semantic retries without conflating operational failure with customer burden.

Registry capability is operational planning context. It is not source evidence and cannot establish ownership, absence, currentness, completeness or qualification. Predictive use also remains governed by open sign-off A-15.

## Decision

Add private `ubo-registry-capability-profile-v1` and `ubo-registry-capability-entry-v1` contracts. Profiles are immutable, canonical-hashed and JSON-serializable. Matching uses exact jurisdiction, entity profile, information concept, relationship dimension/basis, acquisition channel and entitlement-context codes. `ANY` is the only wildcard. The most-specific unique match wins; equal-specificity ambiguity fails. Explicit evaluation time determines whether the profile is current, stale or future-effective.

Profile states `SUPPORTED`, `PARTIAL`, `UNSUPPORTED`, `RESTRICTED` and `UNKNOWN` remain distinct from entitlement states `ENTITLED`, `NOT_ENTITLED`, `UNKNOWN` and `NOT_APPLICABLE`. Profile data guides route selection only. Credentials, secrets, raw provider results, customer facts and Evidence objects are rejected. Profile-driven results pin ID, version, hash, entitlement context, used entry IDs, governance and A-15.

Add private `ubo-low-friction-planner-v2` producing `ubo-resolution-plan-v2`. Planning occurs per deterministic causal ResolutionGroup. Structural groups receive `DISCOVERY_LED`, `CHART_ASSISTED` or `SPECIALIST`; targeted non-structural work uses `NOT_APPLICABLE`. A coherent option may cover several needs, but every original need and requirement ID remains recorded and unresolved until later evidence intake, extraction, adjudication and re-evaluation.

The planning hierarchy is system-first, then customer, then internal/specialist review, then complete/blocked. Several independent zero-friction actions may share one SYSTEM wave. No numeric friction score or provider precedence exists. A current supported/partial and entitled entry may select Discovery. Current unsupported/restricted or substantively exhausted Discovery may select an approved chart/structure-evidence route without requiring a paid failure. UNKNOWN capability, graph depth and cross-border shape do not themselves prove opacity.

Attempt matching pins cause/group, semantic route, profile/capability and material-input identity. NO_DATA, UNSUPPORTED and final INCONCLUSIVE suppress unchanged substantive repetition. PARTIAL permits only residual needs. UNAVAILABLE may retry or hold; FAILED holds. Neither operational state independently creates customer work. A material cause, graph, profile, entitlement, artifact or approved decision change may make a route eligible again; display-only changes do not.

Plan, group, strategy-assignment, action and wave identities are deterministic. A predecessor plan records prior/current strategy and a material-change reason. Equivalent material inputs produce the same assignment and wave, preventing unrecorded Discovery/chart oscillation.

ResolutionPlan v2 is created once before DecisionSnapshot v2. Wave 9 Phase 8 pins the planner, profile, used entry IDs, strategies, predecessor and exact plan ID/hash. Snapshot verification reconstructs Wave 7, Wave 8 and Wave 9 by their recorded algorithms and never runs the current planner over historical content.

## Governance and boundary

Every Wave 9 result is `runtimeMode=LAB`, `governanceState=REVIEW_ONLY`, `productionAuthorized=false` and has maturity `SUCCESSOR_PLANNER_COMPLETE_REVIEW_ONLY`. Profile-driven planning requires A-15, which remains OPEN. A-10 measure-category execution is not added.

RegistryCapabilityProfile, ResolutionPlan v2, planner v2 and the v3 review evaluation remain internal and absent from `index.js`. This wave does not alter Decision Application v1/v2, public planner/projections/customer actions, Lab, ASDA v1, legacy Discovery, Evidence Platform or onboarding. It does not execute Discovery, upload or extract artifacts, create facts, satisfy needs, make analyst decisions or invent customer wording. Wave 10 owns any public/Lab v3 boundary; Wave 11 owns applicant journey/customer contracts.

## Consequences

The review pipeline can now explain why one causal branch is Discovery-led, another chart-assisted, another specialist-led and a targeted identity task is non-structural. It can bundle compatible work without path-count inflation, preserve review and blocked-content states separately, and deterministically identify the next re-evaluation trigger. Production use remains blocked pending explicit governance and later public/runtime integration decisions.
