# ADR 0008: Versioned Policy Pack schema and engine semantics

- Status: Accepted
- Decision date: 2026-08-28
- Authority: UBO Control Room

## Context

Tenant policy versions change independently from the runtime schema and the engine vocabularies that interpret them. Copying engine states and semantics into each pack would allow tenant data to redefine platform behavior and make compatibility ambiguous.

## Decision

Every runtime Policy Pack declares schema identity `ubo-policy-pack` and schema version `1.0`, independently from `policyPackVersion`. It pins versioned engine contracts for capability outcomes, requirement states, claim states, applicability results, resolution semantics, risk levels, condition syntax, and canonicalization. These vocabularies live in code and are referenced, not redefined, by policy data.

`UNRESOLVED` is an engine-owned requirement state distinct from `GAP`. Resolution strategies and effects are provider-neutral engine vocabularies. Runtime validation is strict and rejects unknown top-level fields, unsupported semantic versions, executable values, and dangling references.

## Consequences

Compatibility is explicit and deterministic. Tenant configuration cannot change engine meaning. Schema evolution can proceed separately from compliance-policy revision, and unsupported packs fail before evaluation.
