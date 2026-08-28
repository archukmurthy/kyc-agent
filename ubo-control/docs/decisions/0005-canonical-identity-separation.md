# ADR 0005: Canonical identity separation

- Status: Accepted
- Decision date: 2026-08-28
- Authority: UBO Control Room

## Context

Newly discovered parties often lack a canonical UBO entity identifier, and equal normalized names do not establish identity.

## Decision

Capabilities return `CandidatePartyReference` values that may omit `entityId` when a useful name or external identifier is present. Canonical resolution is represented separately by an auditable `IdentityResolutionDecision` with `RESOLVED`, `UNRESOLVED`, or `REJECTED` status.

## Consequences

No automatic name-based merge is permitted. Matching doctrine and resolution algorithms are deferred beyond G1.1.
