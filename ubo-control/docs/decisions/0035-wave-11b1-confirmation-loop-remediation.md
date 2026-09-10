# ADR 0035 — Wave 11B1 confirmation-loop remediation

Status: review-only correction on the open Wave 11B1 pull request.

## Decision

`CONFIRM_ESTABLISHED_INFORMATION` is compatible only with an InformationNeed that asks whether an already identified relationship remains current. It cannot cover a missing person, owner, relationship, percentage, control attribution or other absent substantive fact. The AJV2-01/AJV2-02 test-only fixtures therefore make the established `tdr-gp-a → bellis-finco` control relationship's currentness unknown; they no longer map the separate missing-natural-person-controller frontier to generic confirmation.

An accepted confirmation records one planner-consumable `NO_RESOLUTION` attempt with the existing `NO_DATA` substantive capability outcome. It pins the source case revision, Snapshot, ResolutionPlan, resolution bundle/group/action, causal need, action/submission/content semantics, target/frontier, actor and dates, customer-result identity, the full source-plan fingerprint, and two stable internal fingerprints:

- `semanticRouteKey` identifies the causal group and route without transient Snapshot, plan, bundle, action or need IDs.
- `materialCauseFingerprint` identifies the material graph facts, causal need semantics and expected facts.

`semanticAttemptKey` combines those values. A new case revision, Snapshot, plan, bundle or action ID does not reset an exhausted route. A recorded material graph/cause change does. A different target, action, submission, content reference or causal route remains independently eligible.

Substantive exhaustion takes precedence over `currentlyAvailable` for system, chart/customer and internal candidate selection. Operational `UNAVAILABLE`/`FAILED` retry-or-hold behavior remains separate.

## Deterministic AJV2-01 trace

At the fixed fixture timestamps, the regression pins this internal trace:

| Item | Recorded value |
| --- | --- |
| Causal need | `ubo-information-need-v2:52dac3be7b992e0c62415b77da61af34` — `RELATIONSHIP_CURRENTNESS`, requiring `CURRENTNESS_STATE=CURRENT` |
| Target relationship | `tdr-gp-a → bellis-finco`, `SIGNIFICANT_INFLUENCE_OR_CONTROL`, currentness `UNKNOWN` |
| Initial group | `ubo-resolution-group-v1:a035131d4c4ca9ea23414284a3558a99` |
| Initial customer bundle | `ubo-customer-work-bundle-v2:0b84ae559f2744424f9d16d9c703fa2e` |
| Initial plan bundle | `ubo-customer-resolution-bundle-v2:1c5df1f3090bf59b016e94d453cd14a4` |
| Initial action | `ubo-resolution-action-v2:c57ec4c97df41bd97df2d4ae35c3583b` |
| Action/submission/content | `CONFIRM_ESTABLISHED_INFORMATION` / `ubo-established-information-confirmation-v1` / `TEST_ONLY_CONFIRM_ESTABLISHED` |
| Accepted customer action | `accepted-customer-action-v2:a18e67c83ce302616c22d8f1` |
| Completed attempt/outcome | `resolution-attempt:04a45402937acc0021824103` / `NO_RESOLUTION` (`NO_DATA` capability outcome) |
| Semantic attempt key | `ubo-resolution-semantic-attempt:be41d0d30ab0448be8759de822dc9fd5` |
| Material fact fingerprint | `sha256:06212ff314fed4c28123dfdcfe8dc8ada252f1897932bbb7c81ca462fad46dd7` |
| Successor result | new plan `ubo-resolution-plan-v2:cf5f5e9c1ab62077f77feee00210ac2d`; no replacement customer action; `INTERNAL_REVIEW`, customer input complete, final case incomplete |

The exact deterministic hashes are asserted in `ubo-control-lab/__tests__/applicantJourneyLab.nodetest.js` and inspectable in the Lab's Recorded Customer History panel; they are derived identities, not policy content.

## Boundary

This correction adds no public export or contract version, changes no policy JSON or sign-off status, and does not touch legacy Discovery, Evidence, onboarding, persistence, production activation or Wave 11B2.
