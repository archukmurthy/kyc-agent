# UBO Control architecture

UBO Control is a standalone product temporarily co-located in the KYC host repository. This document states the current Control Room-approved architecture and public boundaries.

## Product boundary

`ubo-control/index.js` is the only public entry point. Production code beneath this root has no production dependency on the host, legacy UBO, onboarding, Evidence Platform implementation, provider SDK, host database, or Vercel infrastructure.

The host application will eventually depend on UBO Control through the public entry point. Dependency direction never points from UBO Control into the host.

## External capability ports

UBO Control has exactly two candidate-fact acquisition ports:

- `DiscoveryService.discover(request)`
- `ExtractionService.extract(request)`

They are asynchronous duck-typed contracts, not framework base classes. Providers are explicitly injected. Missing or invalid providers fail composition with `UboConfigurationError`; no provider or stub is auto-selected.

G1.2B supplies deterministic `StubDiscoveryService` and `StubExtractionService` implementations under `test-support/`. They are internal test infrastructure, are absent from the public entry point, and can be used only when a test or development harness injects them explicitly. They contain no provider selection, environment configuration, network access, persistence, or production fallback behavior.

Both requests carry `contractVersion`, `requestId`, `caseId`, and `informationNeeds`. Discovery additionally carries `subject`. Extraction additionally carries `artifactEvidenceReferences`, which point to externally held evidence.

Both capabilities return:

```text
{
  contractVersion,
  requestId,
  outcome,
  candidateFacts,
  operationEvidenceReferences,
  issues
}
```

Candidate facts, operation evidence references, and issues are always arrays. Provider-specific response structures do not cross this boundary.

## Candidate facts and graph direction

Capabilities return candidate facts, never authoritative owners, PSCs, controllers, UBO decisions, or graph mutations. Supported fact forms are `RELATIONSHIP` and `ENTITY_ATTRIBUTE`.

Relationship direction is grammatical: `subject relationship object`. “Alice ECONOMIC_OWNERSHIP HoldCo” means Alice economically owns HoldCo. Storage convenience must not reverse it.

Relationship types are jurisdiction-neutral facts. UK PSC conditions and other policy conclusions remain Policy Pack concerns. Gate 1 does not perform qualification, conflict resolution, graph mutation, or effective-ownership calculation.

## Candidate identity

A `CandidatePartyReference` may refer to an existing canonical `entityId`, but newly discovered parties do not require one. A useful name or external identifier is sufficient. Names are assertions and aliases, never identity keys.

Identity resolution is explicit and auditable through `IdentityResolutionDecision`. It supports `RESOLVED`, `UNRESOLVED`, and `REJECTED`. Gate 1 does not implement matching doctrine or automatic name-based merging.

## G2.1 case and claim boundary

`OwnershipCase` is the aggregate root for UBO-owned reasoning state. It has a stable case ID, an external customer/subject reference, optional opaque host references, and deterministic revision/event identities. Every change returns a new deeply frozen case projection; prior projections, claim creation state, identity decisions, adjudications, capability-operation records and case events remain reconstructable. The aggregate stores no raw evidence artifact and has no persistence or host-case dependency.

Canonical entities are UBO-owned records with stable entity IDs and one of `NATURAL_PERSON`, `LEGAL_ENTITY`, `TRUST_OR_LEGAL_ARRANGEMENT`, `OTHER` or `UNKNOWN`. Names, aliases, external identifiers, jurisdiction and entity-type metadata are retained as assertions. Equal or normalized names never create an identity match, merge or canonical key.

Validated capability results enter through a pure intake operation. Intake does not call a capability or provider. It records the capability request/outcome and opaque operation evidence references, then creates separate UBO candidate claims for claimable candidate facts. Each claim has a deterministic stable ID scoped to the case and intake operation, a reference to the originating request/fact, preserved grammatical direction, typed measurement, qualifiers and fact-level evidence references. Capability inputs are cloned rather than mutated. `NO_DATA`, `UNAVAILABLE`, `FAILED` and other non-claimable outcomes create no ownership/control claim and never become negative conclusions.

Every claim starts in `CANDIDATE`. A different claim state can be projected only from an explicit immutable adjudication record containing its prior/resulting state, reason code, origin, time and relevant evidence/claim references. G2.1 implements no evidence precedence, conflict winner, recency, exact-versus-range or duplicate-interest doctrine. Competing and apparently duplicate claims remain separately addressable. `SUPERSEDED` and `REJECTED` are terminal mechanical states; prior claim content and adjudications are retained.

Each claim endpoint has a claim-scoped candidate-party key. Resolution to an existing or newly created canonical entity, deliberate non-resolution, and rejection of a proposed match all require an explicit `IdentityResolutionDecision`. A supplied candidate `entityId` is not an automatic resolution. Repeated names across candidate endpoints or canonical entities have no matching effect.

G2.1 exposes only a structural graph-eligibility projection. A relationship claim is `GRAPH_ELIGIBLE` only when it is `OPERATIVE` and both candidate endpoints have current explicit `RESOLVED` decisions to canonical entities in the case. Entity-attribute claims, non-operative claims and unresolved/rejected endpoints are not eligible. This projection does not create an edge or graph and performs no traversal, arithmetic, policy evaluation or UBO determination.

The G2.1 modules remain internal beneath `domain/`; the deliberate public `index.js` surface is unchanged pending an approved consumer contract.

## Percentage values

Percentages are typed as `EXACT`, `RANGE`, or `UNKNOWN`. A range retains both bounds and inclusive/exclusive endpoints. Gate 1 never coerces a range to a scalar and does not implement threshold crossing or indirect arithmetic.

## Evidence boundary

UBO Control stores only provider-neutral `EvidenceReference` values containing opaque external references and optional locator/integrity metadata. It does not copy or store raw evidence and does not import Evidence Platform types.

Fact-level `evidenceReferences` support only the candidate fact carrying them. Result-level `operationEvidenceReferences` identify material involved in the operation and never become fact support implicitly.

## Capability outcomes

The approved states are `COMPLETE`, `PARTIAL`, `NO_DATA`, `INCONCLUSIVE`, `UNSUPPORTED`, `UNAVAILABLE`, and `FAILED`. Operational unavailability or failure is not negative ownership/control evidence.

Capability outcomes, information needs, requirement states, resolution strategies, and customer/analyst actions remain distinct concepts. `UNRESOLVED` means a requirement has not yet been determined; it is not a synonym for `GAP`. Capability failure, unavailability, or `NO_DATA` never resolves a requirement negatively by itself.

## Policy Packs

Policy Packs are data-only versioned JSON runtime artifacts. The schema identity (`ubo-policy-pack` / `1.0`) is independent of the tenant policy version. A pack pins the exact engine-owned semantic contract versions it requires: capability outcomes, requirement states, claim states, three-valued applicability, resolution semantics, risk levels, condition language, and canonicalization. Engine vocabulary is not duplicated or redefined as tenant data.

The runtime schema validates identity, status, jurisdiction, applicability, effective period, entity profiles, parameters, definitions, evidence catalogue references, requirements, action templates, resolution strategies/effects, and lifecycle source references. References are closed and strict. Missing source content remains an explicit unresolved source reference; a runtime artifact must not silently map it to a host ID or invent policy text.

Policy source and runtime artifacts are separate. Source provenance, review status, source hash, and unresolved references remain visible in the runtime artifact. Host presentation labels, application route IDs, engine I/O contracts, and architecture invariants are not policy content. Semantic action template IDs are durable runtime identifiers; source questionnaire labels such as `B1` remain traceability metadata only.

Policy identity is SHA-256 over the UTF-8 bytes of `ubo-canonical-json-v1`, never the source file bytes. Canonicalization recursively sorts object keys, preserves array order, uses JSON string/finite-number encoding, and rejects executable, non-JSON, or circular values. Equivalent parsed data has the same hash despite whitespace, key order, or line-ending differences.

## Condition-language boundary

`ubo-condition-v1` is a deterministic, data-only syntax contract. It permits `always`; paths rooted at `case`, `facts`, `answers`, or `params`; JSON-like scalar literals; comparison operators `==`, `!=`, `>`, `>=`, `<`, and `<=`; logical operators `&&` and `||`; and parentheses. Calls, member execution, assignments, arithmetic, arrays, unsupported namespaces, and chained comparisons are invalid.

Its eventual evaluator uses `TRUE`, `FALSE`, and `UNKNOWN`. Missing or null operands produce `UNKNOWN` unless the expression explicitly compares with `null`. G1.2A validates syntax and referenced parameters only. It does not evaluate conditions, determine applicability, resolve requirements, or produce actions.

## Resolution and lifecycle boundaries

The engine owns the provider-neutral resolution strategy vocabulary (`DISCOVERY`, `EXISTING_EVIDENCE`, `CUSTOMER_DOCUMENT`, `CUSTOMER_QUESTION`, `CUSTOMER_ATTESTATION`, `DETERMINISTIC_CALCULATION`, and `ANALYST_REVIEW`) and resolution effects. Extraction remains a candidate-fact acquisition capability; `CUSTOMER_DOCUMENT` is a policy strategy, not a provider or capability name.

Lifecycle checkpoints in a Policy Pack are host-neutral metadata. They do not subscribe to host events and do not trigger autonomous re-resolution. A host may request a future evaluation explicitly, but G1.2A contains no lifecycle engine or host integration.

## Scenario-corpus boundary

The G1.2B corpus is an internal, reusable universe of contract-valid capability requests and configured results. It is not a public product contract or a reasoning DSL. Each run creates isolated stub queues, validates requests and results through the production contracts, and returns defensive data copies. A repeated run starts with fresh queue state and is deterministic.

Scenarios preserve directed candidate facts, exact/range/unknown percentages, fact-level and operation-level evidence, capability outcomes, entity-specific qualifiers, ambiguity, conflicts, cycles, and sequential Discovery/Extraction calls. They never join a graph, calculate effective ownership, qualify thresholds, merge identities, choose claims, determine UBO/PSC/controller status, resolve requirements, create information needs or gaps, activate fallback, route a case, or evaluate policy. Later-Gate expectations are labelled non-executed metadata only.

## Testing boundary

Every behavior and architectural invariant is protected in the same PR that introduces it. The architecture suite denies non-built-in imports outside the product root, protects the deliberate public export set, and verifies explicit provider composition. The scenario suite runs offline using only explicitly constructed internal stubs and production contract validators; it imports no legacy, Evidence Platform, onboarding, provider, database, or deployment implementation.
