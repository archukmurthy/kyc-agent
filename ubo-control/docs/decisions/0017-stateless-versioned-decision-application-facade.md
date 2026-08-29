# ADR 0017: Stateless versioned Decision Application façade

## Status

Accepted for G3.2.

## Decision

External consumers invoke UBO reasoning only through the small stateless, provider-neutral and explicitly versioned `createUboDecisionApplication({ policyPack })` façade. Its only operations are `intake`, `applyDecisions`, and `evaluate`.

Every case mutation is represented by a new immutable, data-only, serializable and integrity-protected `DecisionApplicationCaseState` envelope. Consumers supply explicit entity registrations, identity decisions and claim adjudications against stable targets. Evaluation derives policy-required calculation work internally and returns the authoritative fresh `DecisionSnapshot` only.

`OwnershipCase`, graph construction, percentage traversal, policy determination, requirement resolution, orchestration, snapshot construction and re-resolution coordination remain private implementation. The public contract does not expose calculation requests or provider/host types. All façade failures use one typed application error surface with stable codes.

## Consequences

The boundary is serverless-safe, persistence-neutral, deterministic, horizontally scalable and portable to a separate service/repository. A consumer can round-trip state through JSON without importing a private constructor. The existing `createUboControl` capability façade remains separate and unchanged. Integrations depend inward on the public UBO entry point; the standalone core never imports them.
