# ADR 0014: Asynchronous resolution orchestration and fallback review

- Status: Accepted
- Decision date: 2026-08-29
- Authority: UBO Control Room

## Context

G2.4A identifies semantic missing information, substantive policy gaps and operational blockers, but does not choose an executable action or determine a case outcome. Senior-managing-official fallback additionally requires an authoritative exhaustion judgment. Making that judgment a synchronous analyst dependency would couple UBO reasoning to a customer journey and case-management implementation.

## Decision

Resolution orchestration preserves the sequence `InformationNeed → ResolutionOption → ActionIntent → ResolutionAttempt`. Options are policy permissions; intents are host-neutral executable requests; attempts record what actually happened. Equivalent intents coalesce semantically, but no generic priority/scoring doctrine is introduced. Action success returns facts/evidence for a later normal reasoning pass and never directly changes a requirement.

Human review requirements are asynchronous domain outputs, not synchronous customer-journey dependencies. UBO Control prepares a case/policy/graph-pinned review package with durable reasoning references; the consuming product decides where review occurs. The package is not a UI and is not the complete immutable G2.4C DecisionSnapshot.

The machine may emit `FALLBACK_REVIEW_CANDIDATE` and `READY_FOR_EXHAUSTION_REVIEW`, but never `ALL_POSSIBLE_MEANS_EXHAUSTED`. Only a current `FallbackExhaustionDecision` from `ANALYST` or `COMPLIANCE` may derive fallback eligibility. `NO_DATA`, operational failure, caller facts and attempt count cannot substitute. A negative decision must create a concrete InformationNeed before any later resolution option or customer action.

Senior-management candidate information may be collected before review, but `SENIOR_MANAGEMENT_CANDIDATE` is not beneficial-owner status. The `senior_managing_official_fallback` role is projected only after a valid positive exhaustion decision and explicit selection from established canonical candidate people.

Terminal policy precedence is `CDD_FAILURE → SPECIALIST_REVIEW_REQUIRED → RESOLVED_VIA_SMO_FALLBACK → expressly permitted RESOLVED_PROVISIONALLY → RESOLVED → UNRESOLVABLE`; otherwise orchestration remains non-terminal `IN_PROGRESS`.

## Consequences

The customer-facing portion can be complete while internal review is pending. Review decisions cannot silently cross case, policy, graph or reasoning-manifest revisions. UBO Control remains portable and offline: it owns no analyst dashboard, onboarding screen, provider execution, ticket, regulatory submission, authoritative customer risk, persistence, full decision snapshot or snapshot-history mechanism.

UK Corporate `1.4-RC` with Policy Pack schema `1.1` carries these declarative semantics while historical `1.3-RC` remains unchanged. The public `index.js` contract is not widened.
