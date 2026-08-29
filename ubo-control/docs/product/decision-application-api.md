# UBO Decision Application public API

`createUboDecisionApplication({ policyPack })` is the provider-neutral application boundary for deciding what validated UBO candidate facts and explicit decisions mean. Its wire contract is `ubo-decision-application-v1`, exported as `DECISION_APPLICATION_CONTRACT_VERSION` and required on every operation.

The application is stateless. It retains the immutable loaded Policy Pack configuration, but no mutable case state. Every operation receives either initial case input or a façade-produced `DecisionApplicationCaseState` and returns a new deeply immutable result. The state envelope is data-only, JSON-serializable, versioned and integrity-protected. Its encoded payload is deliberately opaque application state, not a supported `OwnershipCase` wire schema.

## Operations

`intake` accepts exactly one of `caseInput` or `caseState`, plus a public capability result, stable operation ID and explicit recording time. It records candidate claims without resolving identities or adjudicating claims. The result contains only `contractVersion`, the next `caseState`, and stable `decisionTargets` identified by `candidatePartyKey` and `claimId`.

`applyDecisions` accepts the current `caseState` and three explicit arrays: `entityRegistrations`, `identityDecisions`, and `claimAdjudications`. Entity registrations are instructions from which UBO Control creates canonical records; callers cannot replace canonical state wholesale. Every identity and claim outcome remains explicit. The result has the same small shape as intake and identifies anything still undecided.

`evaluate` accepts the current state, host-neutral case context, explicit evaluation time, checkpoint/reference, and already-approved Gate 2 `resolutionInputs`. It rejects undecided candidate parties or claims. UBO Control privately restores the case, builds the canonical graph, derives economic/voting calculation work from the pinned Policy Pack and entity profile, runs the full fresh reasoning pipeline, and returns exactly:

```json
{
  "contractVersion": "ubo-decision-application-v1",
  "decisionSnapshot": {}
}
```

The `DecisionSnapshot` is authoritative for graph identity, calculations, policy bases, qualifying people, requirement states, InformationNeeds, review requirements, risk signals, customer projection, terminal state, Policy Pack identity and decision hash. There is no public `calculationRequests` field and no duplicate graph or policy result.

## Errors and neutrality

All façade failures use `DecisionApplicationError` with a stable code from `DECISION_APPLICATION_ERROR_CODE`. Codes distinguish version mismatch, invalid input/state/capability results, invalid target or decision references, mandatory undecided targets, evaluation preconditions, policy configuration, and stale/inconsistent protected state. Private engine exceptions are retained only as error causes and are not the public error type.

The façade consumes only the public capability-result contract. It has no Discovery, Extraction, provider, legacy endpoint, credential, host database, onboarding, persistence or UI dependency. A case state can be JSON serialized after intake or decisions, restored into a new application instance with the same pinned Policy Pack, and evaluated deterministically without object identity, prototypes, closures or hidden mutable state.
