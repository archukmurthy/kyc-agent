# Decision 0020 — Verified-snapshot adaptive journey projection

**Status:** Proposed for G5.2A acceptance.

## Decision

Expose `projectUboJourney({ decisionSnapshot, contractVersion? })` as a separate public, stateless operation returning `ubo-journey-projection-v1`.

The operation verifies the supplied DecisionSnapshot and projects only its already-recorded decision outputs. Open customer-resolvable ActionIntents become stable semantic customer work items. System work, operational blockers, analyst/specialist work and fallback review remain separate. Qualifying-person handoff includes canonical person identity, recorded roles and bases, known identity fields and missing UBO-R07 attributes only.

## Consequences

The projection cannot rerun Discovery or Extraction, rebuild the graph, recalculate ownership, evaluate policy, resolve requirements, select a ResolutionOption or rank candidate resolution routes. ResolutionOptions are exposed as unranked alternatives. JH-006 therefore remains `HYPOTHESIS — NOT APPROVED EXECUTION LOGIC` for G5.2B or later.

Host applications receive semantic data rather than a prescribed journey implementation. The contract has no screens, routes, form identifiers, provider payloads or framework dependencies. Policy wording is never synthesized: supplied template references are identified as available and unresolved source references remain explicitly unresolved.

Because the projection is derived independently for each verified snapshot, satisfied work disappears when a later snapshot no longer records the corresponding open ActionIntent. G5.2A performs no snapshot diff and stores no journey state.
