# UBO Decision Application public API

`createUboDecisionApplication({ policyPack, contractVersion })` is the provider-neutral application boundary for validated UBO candidate facts, customer inputs and explicit decisions. Version selection is deliberate:

- omission, or `DECISION_APPLICATION_CONTRACT_VERSION`, selects `ubo-decision-application-v1` with exactly `intake`, `applyDecisions`, and `evaluate`;
- `DECISION_APPLICATION_CONTRACT_VERSION_V2` selects additive `ubo-decision-application-v2` with `intake`, `applyDecisions`, `applyCustomerInput`, and `evaluate`.

The default remains v1. Existing Discovery consumers receive the same operation set and wire version unless they explicitly opt into v2.

The application is stateless. It retains immutable Policy Pack configuration but no mutable case state. Every operation receives initial case input or a façade-produced `DecisionApplicationCaseState` and returns a new deeply immutable result. The state envelope is data-only, JSON-serializable, versioned and integrity-protected. Its encoded payload is deliberately opaque application state, not a supported `OwnershipCase` wire schema.

## Operations

`intake` accepts exactly one of `caseInput` or `caseState`, plus a public capability result, stable operation ID and explicit recording time. It records candidate claims without resolving identities or adjudicating claims. The result contains `contractVersion`, next `caseState`, and stable `decisionTargets` identified by `candidatePartyKey` and `claimId`.

`applyDecisions` accepts current `caseState` and three explicit arrays: `entityRegistrations`, `identityDecisions`, and `claimAdjudications`. Entity registrations are instructions from which UBO Control creates canonical records; callers cannot replace canonical state wholesale. Every identity and claim outcome remains explicit.

`applyCustomerInput` exists only in v2. It accepts current sealed `caseState`, exact `sourceDecisionSnapshot`, complete deterministic `sourceResolutionPlan`, one `ubo-customer-action-v1`, stable `operationId`, explicit `recordedAt`, and data-only `actorReference`. UBO Control verifies the snapshot against the current case revision, reconstructs and compares the plan, and validates bundle, work-item, action-intent, action, InformationNeed, requirement, subject, semantic action, field, alternative and evidence-type references. Unknown, fabricated, unauthorized or stale actions fail before state changes.

It returns normal sealed state and decision targets plus `customerInputResult`, identifying the recorded input, new case-scoped entities, candidate claims, deterministic identity decisions, correction review targets and/or `EXTERNAL_EVIDENCE_REQUIRED` handoffs. It never returns a graph, qualifying-person conclusion, requirement result or DecisionSnapshot.

Customer ownership/control statements become customer-originated candidate facts and remain `CANDIDATE` pending ordinary adjudication. New people require explicit `registerAsNew: true` and a submission-local `localPartyKey`; IDs are case scoped and deterministic, and names are never matching keys. Automatic identity resolution is limited to an explicit existing canonical entity reference or one exact external namespace/value matching exactly one case entity. Identity attributes enter as candidate entity-attribute facts against the referenced person. Confirmations and negative attestations become answers, not duplicate or zero-percent relationships. Corrections preserve original claims and return an open review target. Senior-management input is preparatory only. Alternative selection is provenance, not proof.

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

Freeze Wave 7 adds an internal review-only evaluation kernel and DecisionSnapshot v2. Neither is a public Decision Application operation or factory selection. The v1/v2 API documented below remains unchanged; public v3 exposure is deferred until successor InformationNeed and ResolutionPlan contracts are authorized.
