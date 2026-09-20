# ADR 0032: Review-only entry point and Lab v2 coexistence

## Status

Accepted for Wave 10 review execution only.

## Decision

Add `ubo-control/review/index.js` as a deliberate, supported testing surface while preserving the exact stable exports and behavior of `ubo-control/index.js`. The review factory exposes exactly `intake`, `applyDecisions`, and `evaluate`. It invokes the actual phased successor pipeline, returns DecisionSnapshot v2 with its exact pinned ResolutionPlan v2, and exposes OwnershipGraphProjection v2 only through the review entry.

The standalone Lab keeps baseline 1.5-RC/session-v1 behavior and adds an explicitly selected 1.6-RC/session-v2 review workspace. Successor fixture, replay and one-shot live inputs enter the same provider-neutral intake and explicit decision model. RegistryCapabilityProfile is planning context pinned into new immutable snapshots; it is not evidence.

## Consequences

- The main production entry remains unchanged.
- Successor Lab code may import UBO semantics only from `ubo-control/review`.
- The Lab displays recorded projection, qualification, causal needs, plan, evidence references, governance and history without recalculating them.
- Ownership/Voting/Control/All filtering is presentation-only.
- 1.6-RC remains `REVIEW_ONLY`, `productionAuthorized=false`, and persistently watermarked.
- CustomerAction v2, JourneyProjection v2, final Decision Application v3, generic plan execution, Evidence/Extraction, host integration, persistence and onboarding remain deferred.

