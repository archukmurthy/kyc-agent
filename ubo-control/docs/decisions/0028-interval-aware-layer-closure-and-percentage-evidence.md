# ADR 0028: Interval-aware layer closure and percentage evidence precision

## Status

Accepted for Freeze Implementation Wave 6 architecture in review mode. A-03 and A-13 remain unresolved; this decision does not approve operational or production use.

## Decision

UBO Control implements closure as a pure, internal per-layer and per-dimension reasoning operation. `ubo-layer-closure-v1` assesses one direct COMPANY or LLP target layer for either ECONOMIC or VOTING rights. It does not traverse ownership paths, run PSC attribution, combine dimensions or determine a person's final UBO status.

The operation counts distinct, compatible target rights rather than claims or attribution paths. It sums exact rational intervals while preserving endpoint attainability, then derives the residual interval by complement within the feasible percentage domain. A minimum above 100%, including an open lower bound at 100%, is inconsistent; a broad upper sum above 100% remains visible where a feasible combination still exists. Closure applies the configured comparator to attainable residual values and never hard-codes 25%.

Statutory and enabled firm-policy thresholds produce separate closure results. A stricter safe firm collection threshold may expose a broader collection population but cannot overwrite statutory classification. Unsafe or malformed firm configuration is a typed side result and cannot suppress a valid statutory assessment.

Arithmetic closure is qualified by holder identity, compatible denominator, sufficient share-class treatment, non-overlapping interests, currentness, absence of material contradiction and joint-arrangement context. The result distinguishes mathematical additional-holder possibility from overall factual closure. Positive or materially unknown joint signals retain A-13; no joint arrangement is inferred from percentage patterns.

`ubo-percentage-precision-assessment-v1` reports precision only when it could change a threshold or layer-closure decision. It reports a non-percentage blocker instead of requesting exactness when identity, currentness, denominator, contradiction, joint-arrangement or another factual qualifier is decisive.

`ubo-percentage-evidence-assessment-v1` preserves declaration, independent-band and capable exact-source evidence separately. Endpoint-exact band containment may corroborate a declaration but never verifies its exact value. Capable independent exact evidence alone can establish exact verification. Contradictions preserve every source and select no winner. Evidence classification does not modify the operative relationship claim.

For a consistent `DECLARED_EXACT` plus `INDEPENDENT_BAND_CORROBORATED` combination, the assessment records `REQUIRES_POLICY_SIGNOFF` and A-03. It does not implement a risk-tier sufficiency rule. A-03 does not block arithmetic, consistency or classification.

## Consequences

All outputs are immutable, JSON-serializable, deterministically identified, `REVIEW_ONLY` and production-unauthorized. The components remain absent from the public entry point. UK Corporate 1.5-RC and 1.6-RC policy artifacts are unchanged.

InformationNeed generation, customer questions, R09 execution, planners, phased coordination, final route union/qualification, Decision Application and snapshot successors, projections, Lab/ASDA, Evidence integration and onboarding remain outside Wave 6. A-03 and A-13 remain open.
