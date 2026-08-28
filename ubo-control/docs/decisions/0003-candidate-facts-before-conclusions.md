# ADR 0003: Candidate facts before conclusions

- Status: Accepted
- Decision date: 2026-08-28
- Authority: UBO Control Room

## Context

External capabilities can observe or infer potentially useful material, but they do not own authoritative UBO policy conclusions.

## Decision

Discovery and Extraction return `RELATIONSHIP` and `ENTITY_ATTRIBUTE` candidate facts plus typed capability outcomes. They never return authoritative UBO, PSC, owner, or controller conclusions and never mutate the canonical graph. Relationships use grammatical `subject relationship object` direction and jurisdiction-neutral vocabulary.

## Consequences

Later identity, conflict, graph, calculation, and policy stages can remain deterministic and auditable. Gate 1 implements none of those conclusions.
