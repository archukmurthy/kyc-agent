# ADR 0033: Decision Application v3 and customer contracts v2

## Status

Accepted for Wave 11A review execution only.

## Decision

Expose `ubo-decision-application-v3` through the standalone product factory with exactly `intake`, `applyDecisions`, `applyCustomerInput`, and `evaluate`. V3 accepts schema-1.3 review policy, requires explicit `LAB` execution, retains the sealed candidate/decision model, invokes the accepted successor phased evaluation, and returns DecisionSnapshot v2 with the exact ResolutionPlan v2 already pinned in that snapshot.

Add the pure public `ubo-journey-projection-v2` over a verified DecisionSnapshot v2. It projects the pinned plan into immutable `ubo-customer-work-bundle-v2` records and keeps customer, system, internal-review, specialist, blocker, Evidence-handoff, policy-content, and final-case states distinct. It neither evaluates policy nor creates a second plan.

Add `ubo-customer-action-v2` and `ubo-customer-action-result-v2`. Every action pins the case revision, snapshot/hash, plan/hash, bundle, group, action, needs, requirements, subject/frontier, policy identity, action type, and submission contract. Accepted structured information becomes customer-originated candidate facts and claims; it never mutates the graph or becomes operative without explicit identity and claim decisions. Applying input and evaluating are separate operations.

## Consequences

- Confirmation records provenance without creating duplicate facts; correction preserves the prior operative claim and creates a candidate change plus an open review target.
- The approved company-share contract preserves owner-to-target `ECONOMIC_OWNERSHIP` with `EXACT`, `RANGE`, or `UNKNOWN` measurement and `SHARE_OWNERSHIP` semantics.
- Evidence requests produce only `ubo-external-evidence-handoff-v1` data. They contain no bytes, Blob URL, filesystem path, repository identifier, fabricated Artifact ID, provider call, or hidden extraction.
- Delegation produces only `ubo-customer-work-delegation-v1`; host authorization, communication, and execution remain outside UBO Control.
- UK Corporate 1.6-RC content/sign-off blocks remain effective. A-02/A-04/A-17 are unchanged and no residual, numeric-control, or identity wording is invented.
- The successor Lab exposes a read-only applicant preview and contract inspector. The final Wave 11B React journey is not implemented.
- Decision Application v1/v2, CustomerAction v1, JourneyProjection v1, Snapshot v1, the baseline Lab, legacy Discovery, policy artifacts/hashes, Evidence integration, persistence, and onboarding remain unchanged.
