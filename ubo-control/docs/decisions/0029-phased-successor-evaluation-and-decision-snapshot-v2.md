# ADR 0029 — Phased successor evaluation and DecisionSnapshot v2

## Status

Accepted for internal LAB review in Freeze Wave 7. Production and public v3 exposure are not authorized.

## Decision

Implement `ubo-phased-evaluation-v1` as an acyclic nine-phase kernel: base applicability; canonical graph/depth; calculations/attributions; person qualification; derived requirement applicability; evidence sufficiency; compatibility InformationNeeds; compatibility planning; and DecisionSnapshot v2 construction.

Route-specific QualificationBasis v2 records remain distinct. `ubo-person-qualification-assessment-v2` applies statutory disjunction and conservative review/indeterminate precedence; it does not merge percentages or count firm-only satisfaction as statutory qualification. R02, R03 and R07 applicability is derived from graph and person outputs.

Wave 7 uses version-pinned transitional stages `ubo-requirement-resolution-v1-compat` and `ubo-resolution-plan-v1-compat`. The plan is created before snapshot construction and pinned exactly once. `registryCapabilityProfileRef` is null and its state is `NOT_PROVIDED`.

`ubo-decision-snapshot-v2` hashes the policy/graph identities, algorithms, every phase output, qualification/attribution/closure/evidence records, compatibility needs, exact plan, evaluation time and predecessor. `ubo-decision-history-v2` dispatches untouched v1 behavior or v2 verification/reconstruction and supports explicit-reason linear v1→v2 history.

The evaluation kernel, snapshot constructor, union logic and history dispatcher remain internal. Public Decision Application v3 is deferred until Waves 8/9 stabilize InformationNeed v2 and ResolutionPlan v2.

## Consequences

Current Decision Application v1/v2, DecisionSnapshot v1, public planner, projections, Lab/ASDA v1, policy artifacts, Evidence and onboarding remain unchanged. All Wave 7 outputs are LAB-only, `REVIEW_ONLY`, `TRANSITIONAL_REVIEW_ONLY` and production-unauthorized. Historical Wave 7 snapshots remain reconstructable after compatibility stages are replaced.
