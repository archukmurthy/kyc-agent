# ADR 0024: Additive Policy Pack schema 1.3 and runtime readiness

## Status

Accepted for UBO Control Freeze Implementation Wave 1.

## Context

UK Corporate 1.5-RC is an immutable schema-1.2 Lab and characterization baseline. Its `CONTROL_ROOM_REVIEW` status, null effective date, and absent approver are intentional and must not be represented as production approval. The accepted UK MVP Freeze Pack requires future policy content to carry machine-readable legal-baseline, doctrine, sign-off, release, feature, and algorithm-compatibility metadata without changing schemas 1.0-1.2 or current Decision Application behavior.

## Decision

- Policy Pack schema 1.3 is additive and uses camelCase. A private strict schema-1.3 validator handles the future structures; historical schema validators and artifacts remain unchanged.
- Machine-readable sign-offs use `OPEN`, `RESEARCH_COMPLETE_SIGNOFF_PENDING`, `APPROVED`, `REJECTED`, `DEFERRED`, and `WATCH`. Approval identity, capacity, approval date, and effective date are mandatory only for `APPROVED` records.
- `productionReadiness` declares mandatory sign-offs, optional features and their dependencies, required algorithm/version pairs, approving authority, and release status. The runtime evaluates those declarations and contains no hard-coded sign-off IDs.
- `assessUboPolicyPackReadiness` is the separate public, stateless `ubo-policy-readiness-v1` operation. It requires explicit evaluation time and returns deeply immutable provider-neutral data.
- `LAB` may assess review packs and requires a watermark when they are not production-ready. `PRODUCTION` fails closed when any declared release, effective-period, approval, sign-off, feature, algorithm, schema, or integrity condition is not ready. `HISTORICAL_RECONSTRUCTION` requires an exact pinned identity/hash and never authorizes a new production determination.
- Decision Application v1 and v2 remain unchanged. No readiness enforcement is inserted into those historical/current compatibility contracts.
- The Lab displays `REVIEW POLICY — NOT APPROVED FOR PRODUCTION` from the current pack's LAB assessment.

## Consequences

- A future schema-1.3 policy can be validated and assessed before its policy content is authorized or shipped.
- Disabled optional features do not become production blockers solely because their sign-offs are open or deferred; enabling such a feature activates its declared sign-off dependencies.
- Old DecisionSnapshots and replay inputs remain readable under their pinned policy identities. Capability replay remains distinct from historical decision reconstruction.
- Wave 1 does not implement UK Corporate 1.6-RC content, qualification/attribution doctrine, InformationNeed v2, planner/snapshot v2, evidence integration, or host onboarding integration.
