# ADR 0025: Route-specific QualificationBasis v2 and effective-interest wrapper

## Status

Accepted for Freeze Implementation Wave 3.

## Decision

UBO Control records successor-policy qualification reasoning in immutable `ubo-qualification-basis-v2` records. Each record is route-specific and classification-specific: `STATUTORY` and `FIRM_POLICY` assessments coexist and never overwrite one another. A basis pins the exact Policy Pack identity and canonical hash, optional case revision, graph fingerprint, natural-person holder, regulated target, route, dimension, directness, method status, exact comparator, recorded calculation state and its ordered path/support references.

Wave 3 implements only the pure internal `ubo-effective-interest-qualification-v2` wrapper. It consumes an already-recorded `ubo-percentage-lookthrough-v1` result and does not traverse a graph, multiply or aggregate percentages, resolve identity, adjudicate claims, or reinterpret Evidence. Both economic and voting dimensions retain independent thresholds. Exact and interval comparisons preserve open/closed endpoints, while partial, unresolved, cyclic and no-path results remain conservative.

The handoff-ready result retains every generated basis plus separate statutory, firm-policy, satisfied and indeterminate basis identifiers. It explicitly records `EFFECTIVE_INTEREST` as assessed and the declared management-control and PSC-condition routes as unassessed. It therefore makes no final whole-person positive or negative determination. Failed or indeterminate effective-interest bases remain durable reasoning rather than being discarded.

Basis identity includes policy/hash, case revision when supplied, graph fingerprint, calculation reference, holder, target, route, classification, dimension, comparator/threshold, method/version, assessment semantics, recorded value and ordered paths. Evidence/support recording metadata is deliberately excluded from identity, though available provider-neutral references are retained in the record.

## Consequences

The current Decision Application v1/v2, policy determination v1, DecisionSnapshot v1, projections, planner, UI, Lab, ASDA fixtures, legacy Discovery and host remain unchanged. Neither v2 module is publicly exported or selected by runtime composition. UK Corporate 1.6-RC remains a review-only schema-1.3 artifact; implementing this one required internal algorithm does not make the pack executable or production-ready. PSC attribution, route union, final role projection and successor snapshot integration remain later-wave work.
