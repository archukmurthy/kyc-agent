# ADR 0006: Policy Pack serialization and hash

- Status: Accepted
- Decision date: 2026-08-28
- Authority: UBO Control Room

## Context

Policy decisions must pin the exact logical artifact while remaining stable across insignificant source formatting changes and compatible with a future Policy Simulator/Compiler.

## Decision

Policy Packs are data-only, versioned JSON. G1.1 validates the approved top-level container, stable identifiers, and rule references but does not define UK rule vocabulary. Identity is `sha256:<hex>` over UTF-8 `ubo-canonical-json-v1`: object keys sorted recursively, array order retained, JSON scalar encoding, and non-JSON/executable/circular data rejected.

## Consequences

Whitespace, key order, and line-ending changes do not alter policy identity. Material data changes do. Fixed vectors protect the algorithm.
