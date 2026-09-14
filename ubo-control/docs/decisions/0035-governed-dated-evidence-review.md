# ADR 0035: Governed dated-evidence review

## Decision

Decision Application v3 retains exactly `intake`, `applyDecisions`, `applyCustomerInput`, and `evaluate`. Its existing `applyDecisions` operation gains an additive `ubo-temporal-support-review-v1` payload for explicit LAB/review-only decisions about the date on which existing source statements support specific existing canonical relationships.

The application resolves the source wording, date, scope, CandidateClaims, Artifact references and digest from the sealed case and exact verified source Snapshot v2. Caller-supplied rewrites, foreign Facts, stale snapshots, unsupported relationship coverage, arbitrary `CURRENT` values and qualification conclusions fail closed. Review records are append-only, idempotent by operation key, preserve actual decision time, and require explicit predecessor/supersession links for corrections or withdrawal.

Normal evaluation accepts an optional date-only `assessmentDate`. `ubo-temporal-support-assessment-v1` retains the original source graph and UNKNOWN Fact semantics, then derives date-scoped applicability for each covered relationship. Only an active, unconflicted accepted review for that exact assessment date affects the evaluation graph. Partial coverage cannot complete a path; later dates do not inherit continuity; conflicts and withdrawals remain visible and fail closed.

## Consequences

New snapshots pin the source graph, temporal assessment, requested assessment date and algorithm identity. Existing Snapshot v2 records remain valid and reconstruct without running the new evaluator. Evidence remains the immutable source-statement provider; it does not make UBO temporal or qualification decisions. R08, signer authority, route satisfaction, case completion and production authorization remain separate.

This capability is review-only. It does not authorize a general currentness override, private ingestion, upload, Evidence execution, persistence, onboarding, policy approval or production use.
