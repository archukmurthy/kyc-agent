# ADR 0033: Decision Application v3 and customer contracts v2

## Status

Accepted for Wave 11A review execution only.

## Decision

Expose `ubo-decision-application-v3` through the standalone product factory with exactly `intake`, `applyDecisions`, `applyCustomerInput`, and `evaluate`. V3 accepts schema-1.3 review policy, requires explicit `LAB` execution, retains the sealed candidate/decision model, invokes the accepted successor phased evaluation, and returns DecisionSnapshot v2 with the exact ResolutionPlan v2 already pinned in that snapshot.

Add the pure public `ubo-journey-projection-v2` over a verified DecisionSnapshot v2 and the exact identity-matched schema-1.3 Policy Pack. The pack is used only to classify recorded sign-off dependencies by registered status. The projection projects the pinned plan into immutable `ubo-customer-work-bundle-v2` records and keeps customer, system, internal-review, specialist, blocker, Evidence-handoff, policy-content, and final-case states distinct. It neither re-evaluates requirements nor creates a second plan.

Add `ubo-customer-action-v2` and `ubo-customer-action-result-v2`. Every action pins the case revision, snapshot/hash, plan/hash, bundle, group, action, needs, requirements, subject/frontier, policy identity, action type, and submission contract. Accepted structured information becomes customer-originated candidate facts and claims; it never mutates the graph or becomes operative without explicit identity and claim decisions. Applying input and evaluating are separate operations.

## Consequences

- `ResolutionAction.requiredSignoffs` means all policy dependencies. Dependencies and statuses remain visible for audit; only `APPROVED` is non-blocking, and every other or missing status fails closed in `blockingSignoffs`.
- Confirmation records provenance without creating duplicate facts. It states that confirmation does not replace independent evidence and maps R08 directly from the pinned RequirementResolution v2 record as `SATISFIED`, `OPEN`, `NOT_APPLICABLE`, or `REVIEW_REQUIRED`; it never recalculates or changes evidence sufficiency. Correction preserves the prior operative claim and creates a candidate change plus an open review target.
- The approved company-share contract preserves owner-to-target `ECONOMIC_OWNERSHIP` with `EXACT`, `RANGE`, or `UNKNOWN` measurement and `SHARE_OWNERSHIP` semantics.
- Evidence requests produce only `ubo-external-evidence-handoff-v1` data. They contain no bytes, Blob URL, filesystem path, repository identifier, fabricated Artifact ID, provider call, or hidden extraction.
- Delegation produces only `ubo-customer-work-delegation-v1`; host authorization, communication, and execution remain outside UBO Control.
- UK Corporate 1.6-RC content/sign-off blocks remain effective. A-02/A-04/A-17 are unchanged and no residual, numeric-control, or identity wording is invented.
- The successor Lab exposes a read-only applicant preview and contract inspector. The final Wave 11B React journey is not implemented.
- Decision Application v1/v2, CustomerAction v1, JourneyProjection v1, Snapshot v1, the baseline Lab, legacy Discovery, policy artifacts/hashes, Evidence integration, persistence, and onboarding remain unchanged.
