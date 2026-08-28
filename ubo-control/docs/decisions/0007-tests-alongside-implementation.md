# ADR 0007: Tests alongside implementation

- Status: Accepted
- Decision date: 2026-08-28
- Authority: UBO Control Room

## Context

Deferring tests allows public-contract and boundary drift during gate-based delivery.

## Decision

Every production behavior, module, contract, architectural invariant, and technically meaningful defect fix must add or update its protecting executable tests in the same PR. “Implementation now, tests later” is not an accepted intermediate state.

## Consequences

An implementation unit without its expected tests is incomplete. `TEST_MATRIX.md` maps claims to executable tests but never substitutes for them.
