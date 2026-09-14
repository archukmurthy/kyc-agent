# UAJ-01 adaptive journey coordinator

`createAdaptiveJourneyCoordinator` is a review-only, host-neutral coordinator above the public UBO Decision Application v3 and injected Discovery/Extraction capability ports. It does not calculate ownership, decide qualification, plan resolution work, or write directly to a graph.

## Contract

The coordinator owns explicit operation sequencing and a data-only `ubo-adaptive-journey-session-v1` record:

1. `startCase` authorises one bounded research operation, intakes the returned CandidateFacts, and pauses for any explicit decisions.
2. `applyDecisions` accepts only `EXPLICIT_REVIEW` in UAJ-01, calls public `applyDecisions`, and evaluates once all candidate identity/claim decisions are complete.
3. The adaptive view derives `CONFIRM`, `NAMED_GAP`, `STRUCTURE`, `WAIT_REVIEW`, or `COMPLETE` only from the exact pinned JourneyProjection v2.
4. `submitCustomerAction` applies an existing CustomerAction v2 against its source Snapshot/Plan. Safe no-decision evaluation is automatic; stale pins remain rejected by Decision Application v3.
5. `useExistingArtifact` first obtains the public Evidence handoff, invokes an injected ExtractionService with existing Artifact references only, intakes the resulting candidates into the same case, and pauses for explicit review.
6. `executePermittedSystemActions` runs only current plan-selected actions within configured call, concurrency, elapsed-time and cost-unit limits. It records substantive and operational outcomes separately.
7. `publishExceptionRound` groups only current permitted customer bundles. A second routine LOW/MEDIUM round requires an analyst escalation reason and never closes an InformationNeed.
8. `buildDelegationAction` reuses the public data-only delegation contract. Preparing the handoff pauses the applicant task; it sends no invitation, grants no access or signing authority, and does not mark the work complete.

Opening, rendering or validating a session performs no acquisition call. Stable operation/request identities make retries idempotent at the public product boundaries. Source bytes, credentials, Blob URLs and filesystem paths are not accepted into the browser-local Lab cache.

The review Lab stores its integrity-sealed resume envelope under `ubo-control-lab.adaptive-journey.v2`. The pre-merge v2 key deliberately prevents a corrected build from reusing presentation state written by the superseded initial preview.

## Decision and automation boundary

UAJ-01 supports explicit reviewer decisions and emits `ubo-shadow-auto-eligibility-v1`. The shadow report cannot create operative claims and is never counted as zero-analyst-touch. A-03 and a versioned automatic-decision authority remain failed prerequisites.

The fixture-only Lab reviewer is clearly labelled and exists only to exercise the real `applyDecisions` operation. It is unavailable as a production or live automatic-decision rule.

## Confirmation boundary

The current CustomerAction v2 confirmation is reused. Because the accepted public contract does not yet expose a durable Confirmed Ownership Statement envelope, UAJ-01 returns `ubo-confirmed-ownership-statement-view-v1` with `durabilityStatus=PENDING_DURABLE_CONTRACT`. It pins the exact source Snapshot and material scope, and is explicitly not an Evidence Artifact or professional certification.

## UAJ-02 contract needs (draft only)

UAJ-02 should add, through separately governed contracts:

- a durable in-flow ownership declaration/Confirmed Ownership Statement envelope with signer capacity, exact scope, source Snapshot, submitted time and information-as-at time;
- a scoped responder execution contract backed by host authentication/authorisation, without widening delegated signing authority;
- a versioned automatic-decision rule executor that calls public `applyDecisions` and records rule/version/hash, governing authority, prerequisites, source support, rationale, actual decision time and case revision;
- explicit A-03 evidence-sufficiency gating and a band-consistency rule case;
- a genuine zero-analyst simple fixture that executes the governed rule, rather than relabelling fixture decisions.

None of those behaviors is active in UAJ-01.

## Deliberate exclusions

No production upload, trusted private ingestion, downstream IDV/screening, onboarding integration, persistence, policy approval or production activation is included.
