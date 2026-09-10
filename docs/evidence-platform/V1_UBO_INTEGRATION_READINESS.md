# Evidence Platform V1 — UBO Integration Readiness Export

**Conclusion:** `READY_FOR_G4_1`

```text
Evidence Core V1 architecture: COMPLETE
Evidence V1 in-process public consumer contract: FROZEN
Controlled pilot readiness: READY WITH BLOCKERS
Production readiness: NOT READY
```

This export is consumer-specific guidance for the UBO G4.1 read-only contract-fit diagnostic and a later separately authorized deterministic fixture adapter. `V1_CONTRACTS.md` remains the normative Evidence V1 contract document. This export does not freeze a second contract, authorize production activation, or authorize imports of Evidence internals.

The authoritative frozen definitions are the `V1 contract-freeze status`, `Frozen request, result, and error DTOs`, version table, and authorization sections of `V1_CONTRACTS.md`. Historical pre-façade sections remain audit evidence only. The examples below apply the frozen contract without changing it.

## A. Baseline commit, PR, and status

| Item | Exact status |
|---|---|
| `implementationBaselineSha` | `4602d763bd728f36b16de335cdd85cd6abced55d` |
| A5b | Complete, accepted, and committed |
| `consumerFacadeGovernanceSha` | `9d8ba6fbd808b1306b628371867f3e68b43485ea` |
| `consumerFacadeImplementationSha` | `c55354aeb334c7c99201ade7a5b3d96e030d3266` |
| `contractFreezeSha` | `c55354aeb334c7c99201ade7a5b3d96e030d3266` |
| `closureDocumentationSha` | Pending until this closure-documentation commit is created |
| `mainMergeSha` | Absent: the Evidence baseline is not contained in local `main` |
| Branch | `feature/evidence-platform` |
| Worktree | Expected clean after the approved closure-documentation commit |
| Push status | Not pushed |
| PR numbers | None recorded or supplied |
| Evidence tests | 255/255 passed including 9/9 focused V1 consumer-contract tests |
| KYC regression | 24 suites / 475 tests passed after façade implementation |
| Database verification | Disposable PostgreSQL migrations 010–019 and A5b smoke passed |
| Production build | Passed after façade implementation |

Evidence V1 consumer contracts are **FROZEN** at the single in-process import below, implemented and accepted at `c55354aeb334c7c99201ade7a5b3d96e030d3266`. Trusted host authentication/authorization and production release controls remain separate activation blockers.

## B. Exact public entry point

The only Evidence V1 entry point a downstream adapter may import is:

```js
const {
  CONSUMER_CONTRACT_VERSION,
  CONTRACT_VERSIONS,
  ERROR_CODES,
  OPERATION_NAMES,
  createEvidenceConsumer,
} = require("evidence/consumer/v1");
```

Repository-relative source: `evidence/consumer/v1/index.js`. Its factory returns `resolveArtifactReference`, `interpretArtifacts`, `getInterpretationOperation`, `getInterpretationHistory`, `reconstructEvidence`, `listEvidencePackages`, `reopenEvidencePackage`, and `verifyEvidencePackage`. Every method takes `(trustedAuthorizationContext, consumerRequest)` and returns a versioned success/error envelope.

The façade returns Evidence identities and safe metadata, never Artifact bytes, storage paths/keys/references, Blob URLs, credentials, or downstream business conclusions. It delegates to the accepted services listed below; those modules remain internal and must not be imported by the downstream adapter.

`createEvidenceConsumer(...)` is invoked by a trusted host/Evidence composition root. Consumer-domain adapters such as the UBO adapter must not construct Evidence internal services and must not deep-import A3, R2, R4, A5a, A5b, repository, or storage modules. The consumer adapter receives an already-constructed EvidenceConsumerV1 instance, or an authenticated transport that preserves the exact V1 contract in a future deployment.

A future authenticated HTTP/RPC transport may wrap the façade. It remains a production-integration task and must not change the frozen V1 DTO semantics.

| Need | Nearest current implementation/export | Exact current signature | Classification |
|---|---|---|---|
| Resolve an authorized Artifact | `evidence/a3/repository.js` — `PostgresA3Repository.findArtifactForInterpretation` | `findArtifactForInterpretation({ artifactId, tenantId, contextId = null })` | **INTERNAL ONLY** |
| Read verified Artifact bytes | `evidence/a3/artifactReader.js` — `EvidenceArtifactReader.read` | `read(artifact)` | **INTERNAL ONLY** |
| Targeted interpretation | `evidence/r2/service.js` — `TargetedInterpretationService.interpret` | `interpret(input, trustedAuthorization)` | **PROVISIONAL** |
| Interpretation history | `evidence/r2/service.js` — `TargetedInterpretationService.history` | `history({ artifactIds = [] }, trustedAuthorization)` | **PROVISIONAL** |
| Single interpretation operation | No dedicated service/public export | Not available; current authorized history returns an operation list | **PROVISIONAL** |
| Ordinary/typed Fact result retrieval | `evidence/r2/service.js` — internal helpers `publicFact`, `publicTypedRelationship` | `publicFact(fact, requestedConcepts)`; `publicTypedRelationship(relationship)` | **PROVISIONAL** |
| Point-in-time reconstruction | `evidence/a5a/service.js` — `EvidenceReconstructionService.reconstructEvidence` | `reconstructEvidence({ authorizedTenant, authorizedContext, subject = null, asOf })` | **INTERNAL ONLY** |
| Package list | `evidence/a5b/service.js` — `EvidencePackageService.listAuthorizedPackages` | `listAuthorizedPackages({ tenantId, contextId, subjectReferenceId })` | **INTERNAL ONLY** |
| Package reopen | `evidence/a5b/service.js` — `EvidencePackageService.reopenPackage` | `reopenPackage({ tenantId, contextId, packageId })` | **INTERNAL ONLY** |
| Package verify | `evidence/a5b/service.js` — `EvidencePackageService.verifyPackageManifest` | `verifyPackageManifest({ tenantId, contextId, packageId })` | **INTERNAL ONLY** |

UBO must not import these paths. G4.1 may inspect and map the documented shapes without compiling an adapter against them. A later bounded Evidence task must publish a versioned façade whose implementation delegates to these services.

The dependency-injected façade adds no HTTP transport or authentication system. A trusted host constructs the accepted R2, A5a, and A5b services and passes its verified authorization context separately from the consumer request. A producer façade remains a separate Evidence Producers Control Room boundary because collection/ingestion creates Evidence while this consumer façade resolves, interprets, reconstructs, and reopens existing Evidence.

### Frozen downstream contract table

| Contract | Version | Status |
|---|---|---|
| Consumer envelope | `evidence-consumer-v1` | **FROZEN** |
| Trusted authorization | `evidence-trusted-authorization-v1` | **FROZEN** |
| Artifact reference | `evidence-artifact-reference-v1` | **FROZEN** |
| Interpretation request/result/history | `evidence-interpretation-request-v1` / `evidence-interpretation-result-v1` / `evidence-interpretation-history-v1` | **FROZEN** |
| Requested outcome and Fact | `evidence-requested-concept-outcome-v1` / `evidence-fact-v1` | **FROZEN** |
| Typed relationship/party/value/temporal | `evidence-typed-relationship-v1` / `evidence-source-party-v1` / `evidence-relationship-value-v1` / `evidence-temporal-state-v1` | **FROZEN** |
| Locator and digest | `evidence-locator-v1` / `evidence-integrity-digest-v1` | **FROZEN** |
| Error/outcome | `evidence-operation-outcome-v1` | **FROZEN** |
| Reconstruction and Package | `evidence-reconstruction-v1` / `evidence-package-v1` | **FROZEN** |
| Accepted nested vocabularies | `evidence-relationship-v1`, `evidence-a5a-availability-v1`, `evidence-package-manifest-v1`, `evidence-package-canonical-json-v1` | Reused unchanged |

## C. Historical pre-façade contract inventory

The following table records why the closure audit required ADR-020. Its missing/provisional API findings are superseded by the frozen table above; its stage-module classifications remain authoritative.

| Contract | API/domain version | Schema/vocabulary version | Authoritative source | Status | Protecting tests |
|---|---|---|---|---|---|
| Public Evidence consumer façade | Missing | Missing | No source path exists | **PROVISIONAL** | None |
| Artifact reference projection | Missing | Artifact persistence from migrations 010/011 | `evidence/r2/service.js` `buildResult().evidence.artifacts` | **PROVISIONAL** | `evidence/r2/__tests__/r2.nodetest.js` |
| Authorized Artifact resolver | Missing | None | `evidence/a3/repository.js` | **INTERNAL ONLY** | `evidence/a3/__tests__/liveArtifact.nodetest.js` |
| Targeted interpretation request | Missing | Bounded field rules, not a named version | `evidence/r2/domain.js` `validateRequest`/`validateAuthorization` | **PROVISIONAL** | `evidence/r2/__tests__/r2.nodetest.js`; `api.nodetest.js` |
| Targeted interpretation result | Missing | Missing | `evidence/r2/service.js` `buildResult` | **PROVISIONAL** | `evidence/r2/__tests__/r2.nodetest.js`; `evidence/r4/__tests__/r4.nodetest.js` |
| Ordinary Fact consumer projection | Missing | A3 persisted shape; no named Fact version | `evidence/a3/domain.js`; R2 `publicFact` projection | **PROVISIONAL** | A3 domain/persistence and R2 tests |
| Typed relationship Fact consumer projection | Missing API version | `evidence-relationship-v1` | `evidence/r4/domain.js`; R2 `publicTypedRelationship` | **PROVISIONAL** | R4 tests |
| Source-party snapshot | Missing API version | Part of `evidence-relationship-v1` | `evidence/r4/domain.js` `validateParty` | **INTERNAL ONLY** | R4 tests |
| Relationship direction/vocabulary | Missing API version | `evidence-relationship-v1` | `evidence/r4/domain.js` | **INTERNAL ONLY** | R4 vocabulary/direction tests |
| Value kind/measurement | Missing API version | `evidence-relationship-v1` | `evidence/r4/domain.js` `validateValue` | **INTERNAL ONLY** | R4 exact/range/qualitative/unknown tests |
| Temporal state | Missing API version | `evidence-relationship-v1` | `evidence/r4/domain.js` `validateTemporal` | **INTERNAL ONLY** | R4 temporal-state tests |
| Evidence locator consumer projection | Missing | No named locator schema version | `evidence/a3/locators.js`; `historyService.js` `mapLocator` | **PROVISIONAL** | R3 locator tests; R4 structured-provider tests |
| Artifact integrity digest | Missing API version | Algorithm is persisted as `sha256` | A1 domain, A3 live service, R2 result | **PROVISIONAL** | A1, A3, R1, R2 tests |
| Interpretation operation/error | Missing | No named outcome/error vocabulary version | `evidence/r2/service.js` | **PROVISIONAL** | R2 service/API tests |
| Provider output schema/instruction | Provider internal | `evidence-r4-live-v4-typed-relations-shallow` | `evidence/a3/anthropicOutputSchema.js`, `providers.js` | **INTERNAL ONLY** | `evidence/r4/__tests__/liveProviderStructured.nodetest.js` |
| Point-in-time reconstruction | Missing response version | `evidence-a5a-availability-v1` | `evidence/a5a/service.js`, `domain.js` | **INTERNAL ONLY** | A5a tests |
| Evidence Package | Missing service response version | Manifest `evidence-package-manifest-v1`; canonicalization `evidence-package-canonical-json-v1` | `evidence/a5b/domain.js`, `service.js` | **INTERNAL ONLY** | A5b tests |
| Package-manifest SHA-256 | Missing service response version | `evidence-package-canonical-json-v1` | `evidence/a5b/canonicalize.js`; `evidence/a5b/domain.js` | **INTERNAL ONLY** | A5b canonical-golden and integrity tests |
| Current `/api/evidence/*` routes | Unversioned | Varies | `api/evidence/*.js` | **LAB ONLY** | Stage API tests |
| Bettercomms-shaped structured provider case | Test-local | Uses relationship v1 and provider instruction v4 | `evidence/r4/__tests__/liveProviderStructured.nodetest.js` | **FIXTURE/TEST ONLY** | Test named below |

No version is inferred where the code records none.

## D. Sanitized ownership-chart request

The exact current callable shape is two arguments:

```js
TargetedInterpretationService.interpret(input, trustedAuthorization)
```

Sanitized G4.1 candidate usage:

```json
{
  "input": {
    "operationKey": "ubo-g4.1-interpretation-0001",
    "artifactIds": ["11111111-1111-4111-8111-111111111111"],
    "requestedConcepts": [
      {
        "concept": "economic_ownership_relationship",
        "description": "Direct source-stated economic ownership relationships and percentages"
      },
      {
        "concept": "officer_relationship",
        "description": "Direct source-stated officer or director relationships and role titles"
      }
    ],
    "extractionContext": {
      "jurisdiction": "GB",
      "language": "en",
      "purpose": "targeted UBO evidence discovery"
    },
    "correlation": {
      "requestId": "ubo-request-0001",
      "externalReferences": [
        {
          "system": "ubo-control",
          "type": "investigation",
          "id": "sanitized-investigation-reference"
        }
      ]
    }
  },
  "trustedAuthorization": {
    "tenantId": "server-resolved-tenant",
    "contextId": "22222222-2222-4222-8222-222222222222",
    "callerScope": "ubo:discovery",
    "actorType": "system",
    "actorId": "ubo-adapter"
  }
}
```

| Field/source group | Required or optional | Authority |
|---|---|---|
| `trustedAuthorization.tenantId` | Required | Trusted host/server only |
| `trustedAuthorization.contextId` | Required | Trusted host/server only |
| `trustedAuthorization.callerScope` | Required | Trusted host/server only |
| `trustedAuthorization.actorType` | Required | Trusted host/server only |
| `trustedAuthorization.actorId` | Optional | Trusted host/server only |
| `input.operationKey` | Required | Caller supplies a deliberate idempotency key; a new key expresses a fresh interpretation intent |
| `input.artifactIds` | Required, unique list of 1–20 | Caller selects opaque persisted references; Evidence resolves them authoritatively |
| `input.requestedConcepts[].concept` | Required, unique list of 1–20 | Caller supplies neutral information concepts |
| Concept `description`, `schemaFieldId`, `informationNeedId` | Optional | Caller may supply only authorized upstream context; neutral concepts must not fabricate schema linkage |
| `input.extractionContext` | Optional | Caller-supplied bounded context; allowed keys are listed below |
| `input.correlation` | Optional | Caller-supplied opaque request/references; not sent to the semantic provider |
| Asset/subject identity, stored Artifact metadata, access scope, Artifact order, storage reference, and persisted SHA-256 | Not caller fields | Evidence resolves these from canonical records |
| Blob URL, filesystem path, storage credential, caller-authoritative hash, arbitrary access scope, provider/model override, or UBO conclusion | Forbidden | Must not be accepted as caller authority |

Current request rules:

* `operationKey`, one to 20 `artifactIds`, and one to 20 unique `requestedConcepts` are required.
* Concept `description`, `schemaFieldId`, and `informationNeedId` are optional. UBO should initially use neutral concepts rather than fabricate Evidence schema linkage.
* `extractionContext` is optional and accepts only `jurisdiction`, `language`, `schemaReference`, `schemaVersionReference`, `purpose`, and `tenantConfigVersion`.
* `correlation` is optional and accepts an optional `requestId` and up to 20 `{system,type,id}` references.
* Trusted `tenantId`, `contextId`, `callerScope`, and `actorType` are required; trusted `actorId` is optional.
* Tenant, context, caller scope, and actor identity belong to the trusted server argument, not ordinary browser input.
* Evidence resolves the Artifact, Asset, subject and stored bytes authoritatively. There is no current R2 `targetSubject` field.
* Storage provider/path/URL, bytes, content hash, access class, provider/model, and Fact IDs are forbidden as caller assertions for this operation.
* Fresh interpretation is this explicit `interpret` call with a deliberate operation key. Prior interpretation reuse is the separate `history` operation. A2 recollection is a separate producer operation; R2 has no recollection switch.

The example is the current service shape, not a frozen public API.

## E. Bettercomms result reference

### Real manual acceptance observation

Architecture Authority recorded a real ownership-chart acceptance run with 14 ordinary provider Facts, six typed candidates, six validations, and six persisted typed relationships:

| Subject | Relationship | Object | Value |
|---|---|---|---|
| Mitchell Fortescue | `ECONOMIC_OWNERSHIP` | Better Holdco | `EXACT` percentage `75` |
| Lee Taylor | `ECONOMIC_OWNERSHIP` | Better Holdco | `EXACT` percentage `25` |
| Better Holdco | `ECONOMIC_OWNERSHIP` | Better Comms VOIP Ltd | `EXACT` percentage `100` |
| Better Holdco | `ECONOMIC_OWNERSHIP` | Better Network Services | `EXACT` percentage `100` |
| Mitchell Fortescue | `OFFICER_OF` | Better Holdco | `QUALITATIVE` value `Managing Director` |
| Lee Taylor | `OFFICER_OF` | Better Holdco | `QUALITATIVE` value `Commercial Director` |

R3 Artifact/locator provenance was reported attached, previous V1 failure history remained immutable, and history reopening made no provider call. These are real manual observations, not stable fixture identities. The development Artifact UUID, tenant/context, and digest are deliberately not made contractual or reproduced here.

### Current R2 result shape

This sanitized fragment uses the exact current `buildResult`/`publicFact` field names. It illustrates two of the six observed relationships; the remaining four use the same shape. Sanitized IDs and digest are not live database values.

```json
{
  "replayed": false,
  "operation": {
    "id": "33333333-3333-4333-8333-333333333333",
    "key": "ubo-g4.1-interpretation-0001",
    "status": "completed",
    "outcome": "completed",
    "startedAt": "2026-09-03T02:35:00.000Z",
    "completedAt": "2026-09-03T02:36:00.000Z"
  },
  "extractionRun": {
    "id": "44444444-4444-4444-8444-444444444444",
    "status": "completed",
    "startedAt": "2026-09-03T02:35:00.000Z",
    "completedAt": "2026-09-03T02:36:00.000Z",
    "provider": "anthropic",
    "model": "sanitized-model-identifier",
    "instructionReference": "evidence-r4-live-v4-typed-relations-shallow"
  },
  "evidence": {
    "assetId": "55555555-5555-4555-8555-555555555555",
    "artifacts": [
      {
        "id": "11111111-1111-4111-8111-111111111111",
        "assetId": "55555555-5555-4555-8555-555555555555",
        "representationType": "original_upload",
        "mediaType": "image/png",
        "sizeBytes": 580294,
        "capturedAt": "2026-09-01T00:00:00.000Z",
        "order": null,
        "inputRole": "primary"
      }
    ],
    "integrity": {
      "verified": true,
      "artifacts": [
        {
          "artifactId": "11111111-1111-4111-8111-111111111111",
          "verified": true,
          "calculatedSha256": "0000000000000000000000000000000000000000000000000000000000000000"
        }
      ]
    },
    "mediaPreflight": {}
  },
  "requestedConceptOutcomes": [
    { "concept": "economic_ownership_relationship", "status": "found" },
    { "concept": "officer_relationship", "status": "found" }
  ],
  "responsiveFacts": [
    {
      "id": "66666666-6666-4666-8666-666666666666",
      "semanticConceptId": "economic_ownership_relationship",
      "value": "Mitchell Fortescue owns 75% of Better Holdco",
      "requestRelation": "requested_concept_response",
      "persistedRequestStatus": "discovered",
      "groundingType": "direct",
      "supportState": "supported",
      "supportingArtifactIds": ["11111111-1111-4111-8111-111111111111"],
      "supportLocators": [
        {
          "artifactId": "11111111-1111-4111-8111-111111111111",
          "locatorKind": "image",
          "jsonPath": null,
          "domReference": null,
          "pageStart": null,
          "pageEnd": null,
          "supportExcerpt": null,
          "supportDescription": "Source-visible ownership connection and 75% label",
          "region": null,
          "locatorMetadata": { "method": "provider_structured", "qualified": true }
        }
      ],
      "typedRelationship": {
        "factId": "66666666-6666-4666-8666-666666666666",
        "schemaVersion": "evidence-relationship-v1",
        "relationshipType": "ECONOMIC_OWNERSHIP",
        "subject": { "partyType": "natural_person", "name": "Mitchell Fortescue" },
        "object": { "partyType": "legal_entity", "name": "Better Holdco" },
        "value": {
          "kind": "EXACT",
          "measurementType": "percentage",
          "exact": 75,
          "lower": null,
          "upper": null,
          "lowerInclusive": null,
          "upperInclusive": null,
          "numerator": null,
          "denominator": null,
          "qualitative": null,
          "unit": null
        },
        "temporal": {
          "state": "unknown",
          "effectiveFrom": null,
          "effectiveTo": null,
          "sourceEffectiveDate": null,
          "precision": {}
        },
        "sourceSpecificMetadata": {},
        "qualifications": [],
        "mapping": {
          "method": "provider_structured",
          "id": "evidence-r4-provider-output-validator",
          "version": "1",
          "reference": "evidence-r4-live-v4-typed-relations-shallow"
        },
        "createdAt": "2026-09-03T02:35:00.000Z"
      },
      "createdAt": "2026-09-03T02:35:00.000Z"
    },
    {
      "id": "77777777-7777-4777-8777-777777777777",
      "semanticConceptId": "officer_relationship",
      "value": "Mitchell Fortescue is Managing Director of Better Holdco",
      "requestRelation": "requested_concept_response",
      "persistedRequestStatus": "discovered",
      "groundingType": "direct",
      "supportState": "supported",
      "supportingArtifactIds": ["11111111-1111-4111-8111-111111111111"],
      "supportLocators": [
        {
          "artifactId": "11111111-1111-4111-8111-111111111111",
          "locatorKind": "image",
          "jsonPath": null,
          "domReference": null,
          "pageStart": null,
          "pageEnd": null,
          "supportExcerpt": null,
          "supportDescription": "Source-visible role label",
          "region": null,
          "locatorMetadata": { "method": "provider_structured", "qualified": true }
        }
      ],
      "typedRelationship": {
        "factId": "77777777-7777-4777-8777-777777777777",
        "schemaVersion": "evidence-relationship-v1",
        "relationshipType": "OFFICER_OF",
        "subject": { "partyType": "natural_person", "name": "Mitchell Fortescue" },
        "object": { "partyType": "legal_entity", "name": "Better Holdco" },
        "value": {
          "kind": "QUALITATIVE",
          "measurementType": "qualitative",
          "exact": null,
          "lower": null,
          "upper": null,
          "lowerInclusive": null,
          "upperInclusive": null,
          "numerator": null,
          "denominator": null,
          "qualitative": "Managing Director",
          "unit": null
        },
        "temporal": {
          "state": "unknown",
          "effectiveFrom": null,
          "effectiveTo": null,
          "sourceEffectiveDate": null,
          "precision": {}
        },
        "sourceSpecificMetadata": {},
        "qualifications": [],
        "mapping": {
          "method": "provider_structured",
          "id": "evidence-r4-provider-output-validator",
          "version": "1",
          "reference": "evidence-r4-live-v4-typed-relations-shallow"
        },
        "createdAt": "2026-09-03T02:35:00.000Z"
      },
      "createdAt": "2026-09-03T02:35:00.000Z"
    }
  ],
  "discoveredFacts": [],
  "completeness": {
    "input": { "state": "complete", "limitations": [] },
    "extraction": { "state": "complete", "limitations": [] }
  },
  "limitations": [],
  "typedRelationshipCount": 6,
  "correlation": { "requestId": "ubo-request-0001" },
  "downstreamEvaluation": "not_performed"
}
```

The public R2 projection calls the persisted Fact ID `id`; the run ID is the top-level `extractionRun.id`. It does not currently return a separate `evidenceFactId` alias or per-Fact `extractionRunId`. Confidence is not part of the R2 public Fact projection. UBO must not infer absent fields.

### Deterministic stable test fixture

The frozen façade now includes `evidence/consumer/v1/__fixtures__/bettercomms.js`, a sanitized deterministic complete contract fixture. Its protecting test is:

```text
the deterministic Bettercomms fixture exposes six durable, serializable relationships without business conclusions
```

It protects all six accepted relationships: Mitchell Fortescue 75% and Lee Taylor 25% of Better Holdco; Better Holdco 100% of Better Comms VOIP Ltd and 100% of Better Network Services; and the Managing Director and Commercial Director roles. All six Facts refer to one sanitized deterministic Artifact identity, retain locators, use numeric percentage points or qualitative roles as appropriate, and preserve temporal state `unknown`.

This is **deterministic V1 contract-fixture evidence**, not a replay of mutable Lab data and not proof of general AI extraction quality. The separate real manual acceptance observation established that one reviewed provider run returned and persisted six valid relationships; its development IDs are not published as permanent fixture identities.

Impact of this gap:

* read-only contract-fit diagnostic: **READY**;
* fixture-based adapter implementation: **READY** as a separately authorized UBO task; it was not started by this closure task;
* production adapter activation: **BLOCKED** pending trusted host authentication/authorization, accepted release/deployment integration, and production validation.

## F. Authorization behavior

| Situation | Exact current Evidence behavior |
|---|---|
| Public Evidence | Artifact resolver treats `access_class = public` as structurally accessible; downstream source suitability/reuse policy remains outside Evidence. |
| Private Evidence | Requires trusted tenant and exact context plus an `evidence_asset_access_scopes` row for the Asset. |
| Tenant mismatch | Private Artifact resolves as unauthorized and R2 returns/throws `artifact_access_denied`; storage is not read. |
| Context mismatch | Same fail-closed `artifact_access_denied`; R2 also rejects a requested context differing from trusted authorization. |
| Missing Artifact | `artifact_not_found`. |
| Inaccessible/missing bytes | `artifact_storage_unavailable`; no provider call or Fact; immutable failed run/operation history may be recorded. |
| Integrity mismatch | `artifact_integrity_mismatch` before provider execution; no successful Fact is fabricated. |
| Historical Artifact | Remains immutable and can be reused under current authorization. Evidence does not reconstruct historical access-policy state. |
| Reconstruction | A5a requires current tenant/context and optional exact subject match, then projects records available by `asOf`; denied scope fails closed. |
| Package reopen | A5b authorizes Package context and every private member under current access. Membership grants no access. |
| Package access loss | `package_exists_but_not_materializable_under_current_authorization`, without leaking inaccessible member identity/type/value/count. |

The future UBO adapter must obtain authorization from its host and pass it through the frozen Evidence façade. It must never query repositories/tables or read storage directly to bypass Evidence authorization.

Current Lab routes commonly derive tenant/actor context from local environment configuration. That is **LAB ONLY** convenience, not production authentication and not caller proof.

## G. Evidence-native outcomes and errors

| Outcome/error | Evidence meaning |
|---|---|
| `operation.status = completed`, `outcome = completed` | Input and extraction completeness were not reported incomplete. It does not mean the real world, source, ownership graph, or UBO requirement is complete/correct. |
| `outcome = completed_partial` | Input or extraction completeness is `incomplete`; returned safe Facts remain usable with limitations. |
| Requested status `found` | At least one source-backed persistable Fact responded to that neutral concept. |
| Requested status `not_found` | The supplied preserved Evidence was evaluated for that concept and no source-supported value was returned. It is not proof of real-world absence. |
| Requested status `not_evaluated` | Incomplete/unreadable/limited processing prevented a conclusion for that concept. |
| Requested status `unsupported` | Present in R2 characterization for an unsupported concept; the live provider instruction itself emits only found/not_found/not_evaluated. This vocabulary is not yet versioned. |
| `no_supported_facts` | No supported Fact survived and there was no truthful requested `not_found` result. |
| `unsupported_media_type` | Preservation may remain valid, but targeted interpretation does not support the media. |
| `media_too_large`, `media_limit_exceeded` | Governed R3 request/media limits rejected execution. |
| `invalid_media`, `encrypted_media`, `unsupported_model_media`, `provider_media_rejected` | Media or configured model cannot be safely interpreted. |
| `provider_not_configured` | No configured semantic provider/model. |
| `provider_authentication_failed`, `provider_timeout`, `provider_unavailable`, `provider_failed` | Provider dependency failed; no conclusion is fabricated. |
| `provider_malformed_output`, `provider_output_truncated` | Provider result did not satisfy the structured boundary or exceeded output allowance; partial output is not persisted as success. |
| `artifact_not_found`, `artifact_access_denied` | Reference absent or trusted scope unauthorized. |
| `artifact_storage_unavailable`, `artifact_integrity_mismatch` | Preserved bytes could not be read or failed SHA-256 verification. |
| `cross_asset_interpretation_not_allowed` | Selected Artifacts do not belong to one coherent Evidence Asset. |
| `idempotency_conflict` | Operation key was already used for different canonical input. |
| `operation_persistence_failed`, `database_persistence_failed` | Durable operation or A3 run/Facts could not be persisted. Prior Evidence remains unchanged. |

R2 has no standalone `inconclusive` operation outcome. Inconclusive conditions are represented through failure, incomplete input/extraction, `not_evaluated`, support state, and explicit limitations. G4.1 should map Evidence-native outcomes only after contract review.

“Complete” is layer-specific:

* A2 collection status reports the outcomes of the configured acquisitions; structured-evidence and human-viewable-capture completeness remain separate and neither verifies source truth.
* R2 `input.state = complete` means the selected persisted Artifact set had no reported input limitation; `extraction.state = complete` means that extraction processing reported no incompleteness for that input. Neither means all source content or real-world facts were discovered.
* A5a reconstruction is complete only relative to the explicit authorized tenant/context/subject/`asOf` query, the governed availability rules, and disclosed reconstruction limitations.
* A5b manifest verification proves canonical manifest bytes, membership/order consistency, and current materialization authorization. It does not prove member truth, ownership-graph completeness, UBO/KYC satisfaction, or Artifact-source correctness.

## H. Artifact, Fact, relationship, and locator identity

* The Artifact UUID is the durable identity of one preserved source representation/event. SHA-256 protects its exact bytes but is not its identity or authorization.
* An ordinary Fact is an immutable statement produced by one Extraction Run. Its `requestStatus` is `requested` or `discovered`; `groundingType` is `direct` or `derived`; support state is independent of downstream evaluation.
* A typed relationship is a one-to-zero/one extension of an ordinary Fact and uses the same Fact ID. It is not a canonical entity edge or UBO conclusion.
* Subject and object are source-party snapshots, not resolved master entities. Direction is always subject → relationship → object.
* Value kinds are `EXACT`, `RANGE`, `QUALITATIVE`, or `UNKNOWN`. Percentage exact/range values are percentage points; ranges retain endpoints and inclusivity and are never collapsed.
* Temporal states are `current`, `ceased`, `historical`, or `unknown`; Evidence does not infer currentness from a missing cease date.
* One Fact may be supported by one or more Artifacts through separate Fact-to-Artifact support rows.
* Several Facts from one Artifact share that same Artifact ID. UBO can group provenance by Artifact ID without treating that grouping as an independence policy.
* Locators are separate per-Fact/per-Artifact records: JSON path, HTML DOM reference/excerpt, PDF page range/excerpt/description, or image description and optional reliably mapped original-pixel region.
* Extraction Run provider/model/instruction references describe production lineage; they do not establish source truth or confidence.
* Package manifest SHA-256 protects canonical frozen manifest bytes. Artifact SHA-256 separately protects source bytes.
* Package membership references the canonical Artifact/Fact/etc.; it does not duplicate or replace Artifact identity.

Fields UBO must not treat as adjudication include `supportState`, `requested/discovered`, `mapping.method`, `completeness`, provider/model, Package membership, or a successful interpretation. They do not mean threshold passed, independent sources established, policy satisfied, operative claim selected, customer action required, or UBO determined.

## I. Historical reuse, interpretation, and recollection side effects

| Operation | Source call | Browser capture | New Collection Operation | New Artifact | New Extraction Run/Facts | New A4a/A4b | New Package | Record effect |
|---|---:|---:|---:|---:|---|---:|---:|---|
| Reopen existing Artifact | No | No | No | No | No | No | No | No new records; server reads bytes and verifies SHA-256 |
| Reopen prior interpretation (`history`) | No | No | No | No | No | No | No | No new records |
| Deliberate fresh interpretation (`interpret` with new key) | No | No | No | No | One new immutable operation/run; new Facts only when safely supported | No | No | Prior interpretation history remains |
| Same interpretation operation key/same request | No | No | No | No | No | No | No | Replays completed/in-progress/failed operation; no new records |
| Reopen existing public Companies House collection | No | No | No | No | No | No | No | Read-only hydration of the preserved collection graph; no new records |
| Explicit source recollection | Yes | Yes for configured website acquisitions | Yes | Yes for successful source representations | Deterministic A2 Extraction Runs/values may be created; no A3 Facts automatically | No | No | New immutable Collection/Acquisitions/Assets/Artifacts; prior collection remains |
| A5a point-in-time reconstruction | No | No | No | No | No | No | No | Read-only projection; no new records |
| A5b explicit freeze | No | No | No | No | No | No | Yes | Runs fresh authorized A5a reconstruction and atomically stores a new Package unless idempotently replayed |
| A5b Package reopen | No | No | No | No | No | No | No | Reads stored manifest/membership and rechecks access; does not rerun A5a and creates no records |
| A5b Package verify | No | No | No | No | No | No | No | Reopens and hashes exact stored canonical manifest bytes, checks membership/order/access, and creates no records |

Fresh interpretation never recollects Evidence. Recollection never automatically invokes A3. Historical access is always subject to current authorization.

## J. Relevant protecting tests

| Contract concern | Test reference |
|---|---|
| Trusted R2 authorization and bounded API result | `evidence/r2/__tests__/api.nodetest.js` — `stable R2 interpret API uses trusted request authorization and returns a bounded result` |
| History/options make no provider call | `evidence/r2/__tests__/api.nodetest.js` — `history and options are explicit no-provider read operations` |
| Idempotency and immutable replay | `evidence/r2/__tests__/r2.nodetest.js` — operation-key/replay characterizations |
| `not_found` remains distinct | `evidence/r2/__tests__/r2.nodetest.js` — `legitimate requested-concept absence remains not-found rather than unsupported` |
| Integrity checked before provider | `evidence/r2/__tests__/r2.nodetest.js` — `Artifact integrity mismatch is detected before provider execution` |
| Storage failure creates no Fact/provider call | `evidence/r2/__tests__/r2.nodetest.js` — `unavailable Artifact bytes make no provider call or Fact and retain immutable failed-operation history` |
| Neutral concept does not fabricate schema linkage | `evidence/r2/__tests__/r2.nodetest.js` — `the R2 adapter never fabricates schema linkage for a neutral requested concept` |
| Full typed value grammar and direction | `evidence/r4/__tests__/r4.nodetest.js` — exact/range/unknown/qualitative, vocabulary, direction, temporal and lineage tests |
| Bettercomms-shaped provider output | `evidence/r4/__tests__/liveProviderStructured.nodetest.js` — `structured live contract validates 75, 25 and 100 percentage-point ownership plus director/officer roles` |
| Closed provider schema and media locators | Same file — structured locator and closed-schema tests |
| No UBO engine/import | `evidence/r4/__tests__/r4.nodetest.js` — `R4 remains generic Evidence infrastructure with no UBO, indirect-ownership, winner or A4b engine` |
| Reconstruction access/as-of | `evidence/a5a/__tests__/a5a.nodetest.js` |
| Package identity/integrity/member authorization | `evidence/a5b/__tests__/a5b.nodetest.js` |

Architecture/regression coverage is strong. The missing complete Bettercomms fixture and the golden-corpus AI-quality work remain explicit gaps.

## K. Frozen, provisional, internal, Lab, and fixture list

### FROZEN

* `evidence/consumer/v1/index.js`, the only supported downstream import;
* the version constants and bounded request/result/error DTOs reachable through that entry point; and
* the exact eight façade operation names and two-argument trusted-authorization signatures.

### PROVISIONAL

None of the underlying stage services is promoted to a provisional public import. Compatible evolution must occur behind the frozen façade or through a separately governed contract version.

### INTERNAL ONLY

* all repositories and database tables;
* `EvidenceArtifactReader` and storage adapters;
* `LiveArtifactInterpretationService` and A3 extractors/providers;
* R4 validators/mappers;
* A5a reconstruction and A5b Package services until exposed through the façade; and
* provider schemas/instructions.

### LAB ONLY

All current `api/evidence/*` routes and Evidence Lab UI flows. They use environment-derived trust and/or explicitly reject production.

### FIXTURE/TEST ONLY

Memory repositories/stores, fixture providers, A1/A2/A3/A4a fixtures, and test-local Bettercomms-shaped values.

### Blocking effect

| Gap | G4.1 read-only diagnostic | Fixture adapter work | Production adapter |
|---|---|---|---|
| Public façade | Ready | Ready against frozen import | Trusted host/release integration still blocks activation |
| Request/result/error versions | Ready | Ready | Compatibility/release policy still required for transport evolution |
| Complete deterministic six-relationship ownership fixture | Ready | Ready | Golden-corpus quality evidence still required |
| Trusted host auth not integrated | Does not block | Can be simulated only in fixtures | Blocks |
| Golden corpus/quality thresholds absent | Does not block | Does not block mechanical adapter fixtures | Blocks reliance on semantic output |

## L. Boundary confirmation

Repository inspection found:

* no Evidence production import of UBO graph or policy code;
* no Evidence emission of `isUbo`, `thresholdPassed`, `qualifyingPerson`, `operativeClaim`, `policySatisfied`, or `customerAction`;
* explicit tests protecting the absence of UBO determination and indirect-ownership logic;
* no repository or database table declared as a consumer contract;
* no Blob URL or filesystem path required by the provisional R2 result; and
* one safe in-process basis for downstream consumption: the frozen `evidence/consumer/v1/index.js` boundary.

The bounded Evidence consumer façade and deterministic contract fixture were implemented without a migration, database record, UBO code/import, provider call, or source call. No downstream adapter was started and nothing was pushed.
