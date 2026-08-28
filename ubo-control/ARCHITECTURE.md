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

Capability outcomes, information needs, unresolved requirements, resolution strategies, and customer/analyst actions remain distinct concepts. Gate 1 does not determine gaps or actions.

## Policy Packs

Policy Packs are data-only versioned JSON artifacts. The G1.1 container validates top-level identity, applicability, effective period, stable requirement and rule IDs, and requirement-to-rule references. G1.1 does not define UK rule vocabulary or determination semantics.

Policy identity is SHA-256 over the UTF-8 bytes of `ubo-canonical-json-v1`, never the source file bytes. Canonicalization recursively sorts object keys, preserves array order, uses JSON string/finite-number encoding, and rejects executable, non-JSON, or circular values. Equivalent parsed data has the same hash despite whitespace, key order, or line-ending differences.

## Testing boundary

Every behavior and architectural invariant is protected in the same PR that introduces it. The architecture suite denies non-built-in imports outside the product root, protects the deliberate public export set, and verifies explicit provider composition.
