# ADR 0004: Evidence-reference boundary

- Status: Accepted
- Decision date: 2026-08-28
- Authority: UBO Control Room

## Context

Evidence acquisition and durable raw storage belong outside UBO Control.

## Decision

UBO Control carries opaque, provider-neutral `EvidenceReference` values only. Fact-level references support one fact; operation-level references record material involved in the operation and do not implicitly support facts. UBO Control neither stores raw evidence nor imports Evidence Platform types.

## Consequences

An Evidence Platform adapter can translate artifact, fact, and support identifiers without changing the UBO domain. UBO can run without Evidence Platform.
