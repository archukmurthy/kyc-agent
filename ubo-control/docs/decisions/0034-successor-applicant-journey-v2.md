# ADR 0034: Separate successor applicant journey v2

## Status

Accepted for Wave 11B1 review-mode implementation. Production execution remains unauthorized.

## Decision

The successor applicant experience is a separate `UboApplicantJourneyV2` component. It does not alter `UboJourney` v1 or the analyst `OwnershipGraph`.

`ubo-journey-projection-v2` is the sole authoritative product-state input. Host-resolved content supplies presentation wording only and cannot add bundles, actions, targets, concepts or permissions. The component emits a fully pinned `ubo-customer-action-v2` through a host callback and performs no decision reasoning.

The Lab exposes the lifecycle as separate operations: `applyCustomerInput`, explicit identity/claim decisions, then `evaluate`. Applicant submission cannot silently produce a new snapshot. Snapshot history is retained.

Applicant and analyst views remain distinct. The applicant receives a compact, read-only ownership summary and coherent bundle tasks, not the analyst graph or causal diagnostics.

External Evidence stops at the accepted data-only handoff and contains no upload implementation. Delegation stops at a host-owned handoff and sends no message. Missing approved content and blocking sign-offs fail closed. Drafts are invalidated by changed snapshot or plan pins.

The uncommitted Evidence adapter worktree is neither imported nor used. Wave 11B2 upload/private ingestion, host onboarding, persistence and production policy activation are deferred.

## Consequences

The UI package gains one deliberate React export and stylesheet. The fixture-only successor Lab gains four explicit host operations and fifteen actual-contract scenarios. The headless UBO public root, domain contracts, policy JSON, planning semantics and Decision Application v3 semantics remain unchanged.
