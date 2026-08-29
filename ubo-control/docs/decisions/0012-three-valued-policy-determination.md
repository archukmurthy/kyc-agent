# ADR 0012: Three-valued policy determination

- Status: Accepted
- Decision date: 2026-08-29
- Authority: UBO Control Room

## Context

G2.2 produces exact, ranged, partial, unresolved, cycle-bearing, and no-path percentage calculations plus non-percentage control relationships. G2.3 must interpret those immutable facts against the approved Policy Pack without rebuilding arithmetic, inventing certainty from missing data, or beginning the G2.4 evidence-sufficiency and resolution-planning workflow.

Policy applicability and requirement conditions can depend on facts that are absent or unresolved. Treating unknown as false would silently turn incomplete investigations into negative determinations. Percentage ranges, partial positive contributions, legal-entity holders, entity-profile-specific appointment rights, and ambiguous significant-control facts likewise require explicit non-binary outcomes.

## Decision

Use a pure internal `ubo-policy-determination-v1` stage pinned to the canonical Policy Pack ID, policy version, schema identity, and hash. The stage consumes G2.2 calculation outputs and graph facts as supplied; it does not traverse ownership paths or recompute percentages.

Evaluate `ubo-condition-v1` through the validated AST with three truth values: `TRUE`, `FALSE`, and `UNKNOWN`. Logical operators use explicit truth tables. Missing and null values yield `UNKNOWN` for ordinary comparisons; only the intentional `== null` and `!= null` forms distinguish nullish from present non-null data. Invalid syntax or unsupported operands are policy configuration errors, never false business results. Dynamic code evaluation and host access are prohibited.

Represent pack applicability separately from requirement applicability. Assess each policy basis as `SATISFIED`, `NOT_SATISFIED`, `INDETERMINATE`, or `REVIEW_REQUIRED`. Read exclusive thresholds only from the pack. Preserve exact range endpoint semantics. A known partial contribution may prove a positive result, but incomplete evidence, an unresolved cycle, or `NO_PATH` can never prove a negative result.

Keep economic ownership, voting control, appointment control, and other significant control as separate bases. Appointment control requires the explicit Policy Pack COMPANY or LLP majority qualifiers. Ambiguous other-means control requires review. Project qualifying people only from canonical natural-person holders and only with Policy Pack role vocabulary; retain a qualifying legal-entity basis as unresolved rather than projecting a person.

G2.3 emits no InformationNeed, gap, action, question, document request, analyst task, SMO fallback, final terminal requirement outcome, discrepancy workflow, snapshot, provider call, persistence, onboarding projection, or public API.

## Consequences

Policy interpretation is deterministic, immutable, auditable, and safe under incomplete information. Exact G2.2 arithmetic remains the sole source of percentage calculations, while policy versions and hashes make interpretation reproducible. Unknown facts cannot become accidental negative decisions, legal entities cannot masquerade as natural persons, and ambiguous control cannot silently qualify a UBO.

G2.4 must separately decide evidence sufficiency, terminal requirement resolution, and the information/action plan. Any public policy-result contract, additional role, threshold unit, null rule, control inference, or fallback behavior requires a separate approved change.
