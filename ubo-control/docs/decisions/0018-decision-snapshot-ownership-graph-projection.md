# ADR 0018: DecisionSnapshot ownership graph projection boundary

## Status

Accepted for G5.1A.

## Decision

UBO Control exposes the separate stateless and explicitly versioned `projectOwnershipGraph({ decisionSnapshot })` operation. Its `ubo-ownership-graph-projection-v1` result is a purposeful consumer view derived only from a verified DecisionSnapshot.

The projection carries canonical subject and entity nodes, canonical relationships and their opaque evidence support, already-recorded effective-interest calculations and ordered paths, approved qualifications and rationale links, unresolved InformationNeeds, conflicts, internal reviews, historical snapshot identity and deterministic summary counts. Output is immutable, data-only, provider-neutral, renderer-neutral, canonically ordered and losslessly JSON serializable.

The existing Decision Application remains exactly three operations. Projection does not import its private reasoning stages and does not adjudicate claims, reconstruct a graph, perform percentage arithmetic, determine policy, resolve requirements or select a conflicting assertion. Presentation consumers navigate durable IDs from a qualification through calculations and paths to relationships, claims and evidence; they do not infer or recompute conclusions.

## Consequences

The dependency direction is `DecisionSnapshot → OwnershipGraphProjection → renderer / host / API consumer`. Deterministic scenario, legacy Discovery and future Extraction evidence sources share one graph experience because provider identity does not drive projection semantics. No Evidence Platform, legacy graph, document graph, host onboarding, React/DOM, rendering or graph-layout dependency enters the standalone product.

Historical snapshots retain their recorded policy, graph and calculation identities. Unsupported snapshot schemas or inconsistent references fail through the typed public projection error contract rather than being recomputed with current algorithms. G5.1B may render this contract but may not reinterpret the recorded UBO decision.
