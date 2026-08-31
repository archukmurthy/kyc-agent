# UBO Control product requirements

## PR-VIS-001 — Ownership Graph Projection & Interactive Renderer

**Status:** IN_IMPLEMENTATION — G5.1A ACCEPTED / G5.1B IN REVIEW

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

G5.1A implements the accepted public, provider-neutral projection contract. G5.1B implements a reusable interactive renderer and deterministic standalone demo outside the headless product root; it is not marked implemented until Control Room acceptance. Host-screen integration and historical comparison remain outstanding.
