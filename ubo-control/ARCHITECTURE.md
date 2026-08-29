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

## Testing boundary

Every behavior and architectural invariant is protected in the same PR that introduces it. The architecture suite denies non-built-in imports outside the product root, protects the deliberate public export set, and verifies explicit provider composition.
