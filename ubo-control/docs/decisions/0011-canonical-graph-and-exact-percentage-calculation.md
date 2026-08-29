# ADR 0011: Canonical graph and exact percentage calculation

- Status: Accepted
- Decision date: 2026-08-29
- Authority: UBO Control Room

## Context

G2.1 preserves candidate assertions, explicit identity decisions, and claim adjudication without constructing a graph. G2.2 requires a reproducible reasoning artifact and mathematical look-through while keeping evidence adjudication and policy qualification outside the calculation layer. Corroborating sources, distinct instruments, ranges, unknown values, and cycles must not cause silent double counting or invented certainty.

## Decision

`ubo-graph-v1` builds an immutable graph only from `OPERATIVE` relationship claims with explicitly resolved canonical endpoints. Semantically equal claims coalesce into one relationship with all supporting claim IDs. Incompatible values in one undistinguished relationship slot and impossible minimum incoming totals fail with typed errors. Explicit qualifiers distinguish genuine parallel interests; the engine invents no discriminator or evidence precedence.

The graph fingerprint is SHA-256 over canonical, sorted reasoning inputs and the source case revision. It is independent of insertion order and generation timing. Temporal qualifiers remain on relationships; ceased relationships are not current arithmetic inputs, contradictory current/ceased semantics fail, and unknown currentness remains visible.

`ubo-percentage-lookthrough-v1` calculates economic and voting dimensions separately over edge-distinct, node-simple paths. It uses exact `BigInt` rational arithmetic internally, preserves interval bounds and endpoint attainability, sums multiple valid paths, and caps aggregate output at the universal 100% domain bound. Unknown numeric or temporal inputs remain unresolved. Relevant cycles are recorded and stop traversal; they are not solved or silently ignored. `NO_PATH` is a distinct non-numeric state, never 0%.

Graph and calculation modules remain internal. They emit reasoning artifacts only and contain no threshold test, policy applicability, UBO/PSC/controller determination, evidence sufficiency decision, gap/action, provider behavior, persistence, or host integration.

## Consequences

Equivalent operative truth sets produce reproducible graph and calculation identities, corroboration cannot double an interest, and binary floating-point artifacts cannot become authoritative values. Future policy gates can interpret exact, ranged, partial, unresolved, cycle-bearing, and no-path results without reconstructing arithmetic or confusing missing paths with negative evidence. Any future public graph/calculation contract, mixed relationship inference, temporal precedence, cycle algebra, or repair rule requires a separate Control Room decision.
