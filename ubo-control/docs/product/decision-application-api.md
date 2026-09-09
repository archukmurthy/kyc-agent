# UBO Decision Application public API

`createUboDecisionApplication({ policyPack, contractVersion })` is the provider-neutral application boundary for validated UBO candidate facts, customer inputs and explicit decisions. Version selection is deliberate:

- omission, or `DECISION_APPLICATION_CONTRACT_VERSION`, selects `ubo-decision-application-v1` with exactly `intake`, `applyDecisions`, and `evaluate`;
- `DECISION_APPLICATION_CONTRACT_VERSION_V2` selects additive `ubo-decision-application-v2` with `intake`, `applyDecisions`, `applyCustomerInput`, and `evaluate`.
- `DECISION_APPLICATION_CONTRACT_VERSION_V3` selects review-only `ubo-decision-application-v3` with exactly `intake`, `applyDecisions`, `applyCustomerInput`, and `evaluate`.

The default remains v1. Existing Discovery consumers receive the same operation set and wire version unless they explicitly opt into another version. V3 requires schema-1.3 policy and explicit `LAB` mode. It retains provider-neutral intake and explicit decisions, runs the accepted phased successor evaluation, and returns DecisionSnapshot v2, the exact pinned ResolutionPlan v2, policy readiness/governance, OwnershipGraphProjection v2 and JourneyProjection v2. Production execution fails closed.

The application is stateless. It retains immutable Policy Pack configuration but no mutable case state. Every operation receives initial case input or a façade-produced `DecisionApplicationCaseState` and returns a new deeply immutable result. The state envelope is data-only, JSON-serializable, versioned and integrity-protected. Its encoded payload is deliberately opaque application state, not a supported `OwnershipCase` wire schema.

## Operations

`intake` accepts exactly one of `caseInput` or `caseState`, plus a public capability result, stable operation ID and explicit recording time. It records candidate claims without resolving identities or adjudicating claims. The result contains `contractVersion`, next `caseState`, and stable `decisionTargets` identified by `candidatePartyKey` and `claimId`.

`applyDecisions` accepts current `caseState` and three explicit arrays: `entityRegistrations`, `identityDecisions`, and `claimAdjudications`. Entity registrations are instructions from which UBO Control creates canonical records; callers cannot replace canonical state wholesale. Every identity and claim outcome remains explicit.

`applyCustomerInput` exists in v2 and v3 with version-specific action contracts. V2 retains `ubo-customer-action-v1` unchanged. V3 accepts one `ubo-customer-action-v2` pinned to the case revision, DecisionSnapshot v2/hash, ResolutionPlan v2/hash, customer bundle, ResolutionGroup, ResolutionAction, causal InformationNeeds, requirements, subject/frontier, policy identity, semantic action and submission contract. Unknown, fabricated, unauthorized, blocked or stale actions fail before state changes.

V3 supports confirmation, correction, structured company-share ownership, configured identity attributes, external Evidence requests and data-only delegation. Structured facts remain candidate claims until ordinary explicit identity and adjudication decisions. External Evidence and delegation return typed handoff data only; neither operation executes host work. Applying input never evaluates or directly changes the graph.

JourneyProjection v2 requires the exact schema-1.3 Policy Pack matching the verified snapshot identity. `ResolutionAction.requiredSignoffs` is the complete dependency list, including approved dependencies retained for audit; it is not a pre-filtered blocker list. Each permitted semantic action therefore exposes `signoffDependencies` with recorded statuses and a separate `blockingSignoffs` list. Only exact `APPROVED` clears a dependency. `OPEN`, `RESEARCH_COMPLETE_SIGNOFF_PENDING`, `DEFERRED`, `REJECTED`, `WATCH`, and a missing sign-off record all remain blocking.

It returns normal sealed state and decision targets plus `customerInputResult`, identifying the recorded input, new case-scoped entities, candidate claims, deterministic identity decisions, correction review targets and/or `EXTERNAL_EVIDENCE_REQUIRED` handoffs. It never returns a graph, qualifying-person conclusion, requirement result or DecisionSnapshot.

Customer ownership/control statements become customer-originated candidate facts and remain `CANDIDATE` pending ordinary adjudication. New people require explicit `registerAsNew: true` and a submission-local `localPartyKey`; IDs are case scoped and deterministic, and names are never matching keys. Automatic identity resolution is limited to an explicit existing canonical entity reference or one exact external namespace/value matching exactly one case entity. Identity attributes enter as candidate entity-attribute facts against the referenced person. Confirmations and negative attestations become answers, not duplicate or zero-percent relationships. Corrections preserve original claims and return an open review target. Senior-management input is preparatory only. Alternative selection is provenance, not proof.

A confirmation records `confirmationDoesNotReplaceIndependentEvidence: true` and an `independentEvidenceRequirementState` of `SATISFIED`, `OPEN`, `NOT_APPLICABLE`, or `REVIEW_REQUIRED`. That state is a direct mapping of the pinned Snapshot v2 `UBO-R08` RequirementResolution v2 record; `applyCustomerInput` performs no evidence-sufficiency recalculation. Confirmation never changes R08 and does not falsely request evidence when R08 is already satisfied or not applicable.

`EVIDENCE_ACTION_REQUESTED` records no fact. It returns a correlated external handoff containing semantic evidence types and case/bundle/action/need/requirement/subject references—never a file, Blob URL, bytes or invented Artifact ID.

`evaluate` accepts current state, host-neutral case context, explicit evaluation time, checkpoint/reference, and approved Gate 2 `resolutionInputs`. V2 merges recorded customer answers and preparatory data as authoritative application inputs. Evaluation rejects undecided candidate parties or claims, privately restores the case, builds the graph, derives calculations, runs the fresh reasoning pipeline, and returns only:

```json
{
  "contractVersion": "ubo-decision-application-v1 or ubo-decision-application-v2",
  "decisionSnapshot": {}
}
```

The DecisionSnapshot is authoritative for graph identity, calculations, policy bases, qualifying people, requirement states, InformationNeeds, review requirements, risk signals, customer projection, terminal state, Policy Pack identity and decision hash.

## Errors and neutrality

All failures use `DecisionApplicationError` and stable `DECISION_APPLICATION_ERROR_CODE` values. Customer-input failures distinguish malformed input, unauthorized plan/action semantics, and stale source state. Private engine exceptions remain error causes rather than becoming the public type.

The façade consumes only public data contracts. It has no React, Discovery execution, Extraction execution, provider, legacy endpoint, credential, host database, onboarding, persistence or Evidence Platform dependency. State may be JSON serialized after intake, customer input or decisions, restored into a new instance with the same Policy Pack and version, and evaluated deterministically without object identity, prototypes, closures or hidden mutable state.
# Successor boundary note

Freeze Wave 11A deliberately exposes the review-only v3 application and customer/projection v2 contracts now that successor InformationNeed v2, ResolutionPlan v2 and DecisionSnapshot v2 are accepted. Wave 11B UI, Evidence execution, persistence and onboarding remain deferred.
