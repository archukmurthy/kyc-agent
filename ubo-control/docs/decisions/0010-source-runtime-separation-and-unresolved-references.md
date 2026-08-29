# ADR 0010: Preserve source/runtime separation and unresolved references

- Status: Accepted
- Decision date: 2026-08-28
- Authority: UBO Control Room

## Context

The Control Room source contains compliance content, traceability, and references to source material not supplied in full. It also describes concepts that belong to engine governance or future host integration. Treating the source file as an executable runtime artifact would mix these ownership boundaries and invite invented mappings.

## Decision

The canonical runtime pack is a derived, data-only artifact with explicit source filename, source hash, source version/status, and revision traceability. Compliance meaning is preserved while source field names may be normalized to the runtime schema.

Architecture invariants, engine I/O contracts, and host presentation/routing concerns remain outside policy data. Semantic action template IDs are runtime identifiers; B-codes remain source references only. Missing B1, B2, and B4 content and missing E01, E02, E08, and E10 lifecycle definitions remain explicit unresolved source references. No host IDs or policy wording are invented.

## Consequences

Reviewers can reproduce the source-to-runtime mapping and distinguish source provenance from runtime identity. Production activation remains blocked wherever unresolved source material is required, and later host integration cannot silently redefine the pack.
