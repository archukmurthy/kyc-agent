# ADR 0015: Immutable decision snapshots and linear history

- Status: Accepted for G2.4C implementation
- Decision date: 2026-08-29
- Authority: UBO Control Room

## Context

Gate 2 can deterministically derive a complete UBO decision, including unresolved and internal-review states, but the reasoning would be historically ambiguous if later case facts, policy or algorithms silently replaced the inputs used at an earlier checkpoint. Reconstruction must not depend on recollecting evidence, the host onboarding application, current provider state, or the latest Policy Pack.

## Decision

Each explicit `CASE_OPEN`, `SESSION_START`, `SUBMIT_GATE` or host-neutral `CASE_EVENT` evaluation may create an immutable `ubo-decision-snapshot-v1`. The canonical decision content pins the case revision, checkpoint/event reference, explicit evaluation time, Policy Pack identity/hash/effective parameters, every relevant algorithm identity, normalized UBO-owned reasoning records and the complete decision output. Raw external evidence remains referenced, not copied.

Decision identity is SHA-256 over UTF-8 `ubo-canonical-json-v1` serialization of the canonical decision content. Recording metadata is outside that hash. Checkpoint context, predecessor and supersession reason are inside it. Equivalent object insertion order is stable; any material reasoning change produces another identity.

History is append-only and linear per OwnershipCase for MVP. Genesis has an explicit null predecessor. Every successor points to the immediately preceding accepted snapshot; predecessors are never mutated. A caller must present the expected current head, and stale-head resolution fails with typed `STALE_DECISION_HISTORY_HEAD` rather than creating an implicit branch.

Historical policy and algorithm identities are permanent. A later policy/algorithm change is a new re-resolution and snapshot, never a reinterpretation or rewrite of the old record. `ubo-decision-reconstruction-v1` verifies and reproduces the historical recorded decision; it does not recalculate. Re-resolution is a separate pure coordinator over current supplied domain inputs and an approved checkpoint.

## Consequences

Unresolved, review-required, conflict, fallback and terminal states remain truthful and reconstructable. R10 fallback snapshots retain the complete measures-taken reasoning manifest and authoritative review decision. Verification is offline and detects payload tampering, mixed reasoning revisions, stale policy/graph/review identities and broken history links.

G2.4C defines a persistence-ready internal contract only. It adds no database, object/KV/filesystem storage, history branching/merge model, provider execution, event subscription, UI, host integration, public `index.js` API or Gate 3 capability adapter.
