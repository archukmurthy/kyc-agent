# Evidence Platform Core V1 — Normative Contract Candidates and Handoffs

**Audit date:** 8 September 2026

**Baseline:** `4602d763bd728f36b16de335cdd85cd6abced55d`

| Closure identifier | Status |
|---|---|
| `implementationBaselineSha` | `4602d763bd728f36b16de335cdd85cd6abced55d` |
| `consumerFacadeGovernanceSha` | `9d8ba6fbd808b1306b628371867f3e68b43485ea` |
| `consumerFacadeImplementationSha` | `c55354aeb334c7c99201ade7a5b3d96e030d3266` |
| `contractFreezeSha` | `c55354aeb334c7c99201ade7a5b3d96e030d3266` |
| `closureDocumentationSha` | Pending until this closure-documentation commit is created |
| `mainMergeSha` | Absent |
| PR numbers | None |
| Push status | Not pushed |

This is the normative Evidence V1 contract document. It identifies the frozen in-process consumer boundary and the stability of adjacent contracts; it does not declare the current Evidence Lab endpoints production-safe. Production activation still requires trusted authentication/authorization, operational controls, and consumer-specific integration tests.

## Contract maturity vocabulary

| Label | Meaning |
|---|---|
| FROZEN | Intentionally designated and versioned for downstream consumption through a defined authorized public entry point, with protecting tests and Architecture Authority approval. |
| PROVISIONAL | Candidate semantics or shape that may be inspected but is not yet a compatibility promise. |
| INTERNAL ONLY | Evidence implementation detail whose module shape may evolve; downstream code must use a published façade. |
| LAB ONLY | Local acceptance HTTP/UI adapter using environment-derived trust or other Lab assumptions. |
| FIXTURE/TEST ONLY | Deterministic demonstration or test dependency; never production Evidence. |

## V1 contract-freeze status

**Overall status: FROZEN IN-PROCESS CONSUMER CONTRACT at `c55354aeb334c7c99201ade7a5b3d96e030d3266`.**

The only supported downstream Evidence V1 import path is:

```js
const {
  CONSUMER_CONTRACT_VERSION,
  CONTRACT_VERSIONS,
  ERROR_CODES,
  OPERATION_NAMES,
  createEvidenceConsumer,
} = require("evidence/consumer/v1");
```

Repository-relative source: `evidence/consumer/v1/index.js`.

The exact factory and operation signatures are:

```js
const evidence = createEvidenceConsumer({
  interpretationService,
  reconstructionService,
  packageService,
});

await evidence.resolveArtifactReference(trustedAuthorizationContext, consumerRequest);
await evidence.interpretArtifacts(trustedAuthorizationContext, consumerRequest);
await evidence.getInterpretationOperation(trustedAuthorizationContext, consumerRequest);
await evidence.getInterpretationHistory(trustedAuthorizationContext, consumerRequest);
await evidence.reconstructEvidence(trustedAuthorizationContext, consumerRequest);
await evidence.listEvidencePackages(trustedAuthorizationContext, consumerRequest);
await evidence.reopenEvidencePackage(trustedAuthorizationContext, consumerRequest);
await evidence.verifyEvidencePackage(trustedAuthorizationContext, consumerRequest);
```

`createEvidenceConsumer(...)` is invoked by a trusted host/Evidence composition root. Consumer-domain adapters such as the UBO adapter must not construct Evidence internal services and must not deep-import A3, R2, R4, A5a, A5b, repository, or storage modules. The consumer adapter receives an already-constructed EvidenceConsumerV1 instance, or an authenticated transport that preserves the exact V1 contract in a future deployment.

A future authenticated HTTP/RPC transport may wrap this façade, but remains a production-integration task and must preserve the frozen V1 DTO semantics.

Every call returns either `{ contractVersion: "evidence-consumer-v1", operation, ok: true, result }` or `{ contractVersion: "evidence-consumer-v1", operation, ok: false, error }`. Authority always comes from the first argument. Consumer request fields cannot grant tenant, context, subject, caller, actor, access-scope, storage, or hash authority.

### Frozen contract/version table

| Contract | Version |
|---|---|
| Consumer envelope | `evidence-consumer-v1` |
| Trusted authorization context | `evidence-trusted-authorization-v1` |
| Artifact reference | `evidence-artifact-reference-v1` |
| Targeted interpretation request | `evidence-interpretation-request-v1` |
| Interpretation result | `evidence-interpretation-result-v1` |
| Interpretation history | `evidence-interpretation-history-v1` |
| Requested-concept outcome | `evidence-requested-concept-outcome-v1` |
| Ordinary Fact | `evidence-fact-v1` |
| Typed relationship Fact | `evidence-typed-relationship-v1` |
| Source-party snapshot | `evidence-source-party-v1` |
| Relationship value | `evidence-relationship-value-v1` |
| Temporal state | `evidence-temporal-state-v1` |
| Evidence locator | `evidence-locator-v1` |
| Integrity digest | `evidence-integrity-digest-v1` |
| Operation error/outcome | `evidence-operation-outcome-v1` |
| Point-in-time reconstruction | `evidence-reconstruction-v1` |
| Evidence Package reference/result | `evidence-package-v1` |
| Accepted typed-relationship vocabulary | `evidence-relationship-v1` |
| Accepted A5a availability rules | `evidence-a5a-availability-v1` |
| Accepted Package manifest | `evidence-package-manifest-v1` |
| Accepted Package canonicalization | `evidence-package-canonical-json-v1` |

### Frozen request, result, and error DTOs

`trustedAuthorizationContext` has version `evidence-trusted-authorization-v1` and the exact allowed fields `tenantId`, `contextId`, `callerScope`, `actorType`, optional `actorId`, and optional `subjectReferenceId`. It is supplied by a trusted server host and is never copied from consumer request data.

| Operation | `consumerRequest` fields after `contractVersion` |
|---|---|
| `resolveArtifactReference` | `artifactId` |
| `interpretArtifacts` | mandatory `operationKey`, `artifactIds`, `requestedConcepts`; optional bounded `extractionContext`, `correlation` |
| `getInterpretationOperation` | mandatory `operationId`; optional `artifactIds` filter |
| `getInterpretationHistory` | optional `artifactIds` filter |
| `reconstructEvidence` | mandatory `asOf`; optional `subjectReferenceId` |
| `listEvidencePackages` | mandatory `subjectReferenceId` |
| `reopenEvidencePackage` | mandatory `packageId` |
| `verifyEvidencePackage` | mandatory `packageId` |

Unknown request properties fail as `invalid_request`. In particular, requests cannot supply trusted tenant/context/caller/actor/access scope, raw Artifact bytes, storage locator, Blob URL, filesystem path, authoritative digest, or downstream policy conclusion.

The interpretation result exposes the operation and Extraction Run lineage; safe Artifact references and verified digests; requested-concept outcomes; requested-responsive and open-discovery ordinary Facts; typed relationship extensions; source-party snapshots; exact/range/qualitative/unknown value semantics; temporal state; supporting Artifact IDs and R3 locators; completeness/limitations; provider/model/instruction lineage; timestamps; and opaque correlation. Unknown internal object properties are not copied through.

The bounded public error codes are `invalid_request`, `access_denied`, `package_not_materializable`, `not_found`, `artifact_unavailable`, `artifact_integrity_mismatch`, `unsupported_media`, `unsupported_concept`, `incomplete_interpretation`, `provider_unavailable`, `provider_timeout`, `provider_failure`, `malformed_provider_result`, `cross_asset_selection`, `idempotency_conflict`, `persistence_failure`, `package_integrity_failure`, and `operation_failed`. An error DTO contains only `contractVersion`, `code`, `category`, a consumer-safe `message`, and `retryable`; it never returns SQL, stack traces, paths, storage references, provider credentials, or private implementation names.

`complete` remains only an interpretation-completeness statement about the selected Artifact inputs and execution. It does not assert complete real-world discovery, ownership-graph completeness, source truth, KYC completeness, or downstream policy satisfaction.

Only `evidence/consumer/v1/index.js` and the bounded DTOs reachable through it are **FROZEN**. Repositories, tables, storage/readers, providers, stage services, memory stores, and producer contracts remain **INTERNAL ONLY**. `api/evidence/*` and the Evidence Lab remain **LAB ONLY**. Deterministic fixtures, including `evidence/consumer/v1/__fixtures__/bettercomms.js`, remain **FIXTURE/TEST ONLY**.

The implementation delegates to accepted services; it creates no second interpretation, authorization, reconstruction, Package, Fact, or producer system. It returns no raw Artifact bytes, Blob URL, filesystem path, storage key/reference, credential, or downstream business conclusion. The producer boundary remains separately owned by the Evidence Producers Control Room.

`contractFreezeSha` is `c55354aeb334c7c99201ade7a5b3d96e030d3266`. This freeze classification permits the G4.1 read-only diagnostic and deterministic fixture-adapter implementation. Production adapter activation remains blocked by trusted host authentication/authorization and the release gates in `V1_READINESS.md`.

## Historical pre-façade closure-audit record

The module inventory below records the state at implementation baseline `4602d763bd728f36b16de335cdd85cd6abced55d`. Where it says that a façade or version was missing/provisional, the authoritative frozen addendum above supersedes that historical finding without reclassifying the underlying stage module as public.

### Exact current modules and exports

| Capability | Authoritative current source/export | Exact operation signature | Recorded version | Status | Protecting tests |
|---|---|---|---|---|---|
| Public consumer façade | No implementation exists. `evidence/platform.js` exports only `getPlatformStatus()` | Not available | Missing | **PROVISIONAL** | `evidence/__tests__/platform.nodetest.js` protects only status/scaffold behavior |
| Authorized Artifact resolution | `evidence/a3/repository.js` — `PostgresA3Repository.findArtifactForInterpretation` | `findArtifactForInterpretation({ artifactId, tenantId, contextId = null })` | Missing | **INTERNAL ONLY** | `evidence/a3/__tests__/liveArtifact.nodetest.js`; `evidence/r2/__tests__/r2.nodetest.js` |
| Artifact byte read | `evidence/a3/artifactReader.js` — `EvidenceArtifactReader.read` | `read(artifact)` | Missing | **INTERNAL ONLY** | `evidence/a3/__tests__/artifactReader.nodetest.js`; `evidence/r2/__tests__/r2.nodetest.js` |
| Artifact reference/metadata projection | `evidence/r2/service.js` — nested output from `buildResult` | `result.evidence.artifacts[]` | Missing Artifact-reference contract version | **PROVISIONAL** | `evidence/r2/__tests__/r2.nodetest.js`; `evidence/r2/__tests__/api.nodetest.js` |
| Targeted interpretation | `evidence/r2/service.js` — `TargetedInterpretationService.interpret` | `interpret(input, trustedAuthorization)` | Missing contract version | **PROVISIONAL** | `evidence/r2/__tests__/r2.nodetest.js`; `evidence/r2/__tests__/api.nodetest.js`; `evidence/r4/__tests__/liveProviderStructured.nodetest.js` |
| Interpretation history | `evidence/r2/service.js` — `TargetedInterpretationService.history` | `history({ artifactIds = [] }, trustedAuthorization)` | Missing contract version | **PROVISIONAL** | `evidence/r2/__tests__/r2.nodetest.js`; `evidence/r2/__tests__/api.nodetest.js` |
| Single interpretation-operation retrieval | No dedicated service/public export exists; R2 history returns authorized operation lists | Not available | Missing | **PROVISIONAL** | History-list tests only; no single-operation façade test |
| R2 request validation | `evidence/r2/domain.js` — `validateRequest`, `validateAuthorization` | `validateRequest(input)`; `validateAuthorization(input)` | Missing contract/schema version | **INTERNAL ONLY** | `evidence/r2/__tests__/r2.nodetest.js` |
| Interpretation result | `evidence/r2/service.js` — `buildResult`, `publicFact`, `publicTypedRelationship` | `buildResult(operation, interpreted, request, completedAt)` | Missing response version | **PROVISIONAL** | `evidence/r2/__tests__/r2.nodetest.js`; `evidence/r4/__tests__/r4.nodetest.js` |
| Ordinary Fact consumer projection | `evidence/a3/domain.js`; projected by `evidence/r2/service.js` `publicFact` | Persisted Fact mapped to bounded R2 result | Missing Fact schema version | **PROVISIONAL** | `evidence/a3/__tests__/domain.nodetest.js`; `evidence/a3/__tests__/persistence.nodetest.js`; R2 tests |
| Typed relationship consumer projection | `evidence/r4/domain.js`; projected by `evidence/r2/service.js` `publicTypedRelationship` | Validated relationship extension mapped beneath one Fact | `evidence-relationship-v1`; API version missing | **PROVISIONAL** | `evidence/r4/__tests__/r4.nodetest.js`; `evidence/r4/__tests__/liveProviderStructured.nodetest.js` |
| Source-party snapshot | `evidence/r4/domain.js` — `validateParty` | `validateParty(input, label)` | Part of `evidence-relationship-v1`; no separate API version | **INTERNAL ONLY** | `evidence/r4/__tests__/r4.nodetest.js` |
| Relationship vocabulary/direction | `evidence/r4/domain.js` — `RELATIONSHIP_TYPES`; `validateTypedRelationshipCandidate` | Candidate requires `directionEstablished === true`; persists subject → relationship → object | `evidence-relationship-v1` | **INTERNAL ONLY** | `evidence/r4/__tests__/r4.nodetest.js`; `evidence/r4/__tests__/liveProviderStructured.nodetest.js` |
| Value kind/measurement | `evidence/r4/domain.js` — `VALUE_KINDS`, `MEASUREMENT_TYPES`, `validateValue` | `validateValue(input)` | `evidence-relationship-v1` | **INTERNAL ONLY** | `evidence/r4/__tests__/r4.nodetest.js` |
| Temporal state | `evidence/r4/domain.js` — `TEMPORAL_STATES`, `validateTemporal` | `validateTemporal(input = {})` | `evidence-relationship-v1` | **INTERNAL ONLY** | `evidence/r4/__tests__/r4.nodetest.js` |
| Locator | `evidence/a3/locators.js` — `normalizeLocator`, `assessFactLocators` | Internal normalization beneath Fact↔Artifact support | Missing locator schema version | **INTERNAL ONLY** | `evidence/r3/__tests__/r3.nodetest.js`; `evidence/r4/__tests__/liveProviderStructured.nodetest.js` |
| Artifact SHA-256 consumer projection | `evidence/a1/domain.js` — `sha256`; verified by A3/R1 readers and projected by R2 | SHA-256 over exact preserved Artifact bytes | Algorithm recorded as `sha256`; no public digest-contract version | **PROVISIONAL** | A1 domain, R1 service, A3 Artifact-reader, and R2 integrity tests |
| Interpretation operation/outcome/error | `evidence/r2/service.js` — `TargetedInterpretationService`, `safeMessage`, `buildResult` | Operation/result or bounded failure returned from `interpret`/`history` | Missing outcome/error vocabulary version | **PROVISIONAL** | `evidence/r2/__tests__/r2.nodetest.js`; `evidence/r2/__tests__/api.nodetest.js` |
| Point-in-time reconstruction | `evidence/a5a/service.js` — `EvidenceReconstructionService.reconstructEvidence` | `reconstructEvidence({ authorizedTenant, authorizedContext, subject = null, asOf })` | `evidence-a5a-availability-v1` applies to availability rules; response contract version missing | **INTERNAL ONLY** | `evidence/a5a/__tests__/a5a.nodetest.js` |
| Package list/reopen/verify | `evidence/a5b/service.js` — `EvidencePackageService` | `listAuthorizedPackages({ tenantId, contextId, subjectReferenceId })`; `reopenPackage({ tenantId, contextId, packageId })`; `verifyPackageManifest({ tenantId, contextId, packageId })` | Service response version missing | **INTERNAL ONLY** | `evidence/a5b/__tests__/a5b.nodetest.js` |
| Evidence Package manifest | `evidence/a5b/domain.js` — `MANIFEST_VERSION`, `buildManifest`, `verifyStoredPackage` | Canonical frozen reconstruction manifest plus relational membership | `evidence-package-manifest-v1` | **INTERNAL ONLY** | `evidence/a5b/__tests__/a5b.nodetest.js` |
| Package-manifest SHA-256 | `evidence/a5b/canonicalize.js` — `CANONICALIZATION_VERSION`, `sha256`; used by A5b service/domain | SHA-256 over exact canonical manifest bytes | `evidence-package-canonical-json-v1` | **INTERNAL ONLY** | `evidence/a5b/__tests__/a5b.nodetest.js` canonical golden/integrity tests |
| Semantic provider instruction | `evidence/a3/anthropicOutputSchema.js`; `evidence/a3/providers.js` | Provider-adapter implementation detail | `evidence-r4-live-v4-typed-relations-shallow` | **INTERNAL ONLY** | `evidence/r4/__tests__/liveProviderStructured.nodetest.js` |
| Evidence HTTP routes | `api/evidence/*.js` | Lab-specific handlers | No versioned API envelope | **LAB ONLY** | Stage API characterization tests |
| Deterministic providers and example graphs | `evidence/**/fixtures.js`, test helpers | Test-specific | Fixture-local only | **FIXTURE/TEST ONLY** | Corresponding fixture/unit tests |

Architecture Authority may freeze a future façade and the minimum request/result/reference/error contracts without changing their Evidence semantics. Until that source path and versioned export exist, consumers use this document for diagnostic fit only.

### Smallest proposed consumer façade — not implemented

The smallest repository-conventional productization task is one dependency-injected CommonJS façade at proposed path `evidence/consumer.js`, backed by one contract-definition module at proposed path `evidence/contracts/v1.js`. These paths and names are recommendations, not current exports or frozen contracts.

The façade should export one factory, proposed as `createEvidenceConsumer(dependencies)`, plus explicit consumer-contract and error-vocabulary version constants. The returned authorized interface should expose bounded operations equivalent to:

```text
resolveAuthorizedArtifactReference(input, trustedAuthorization)
interpretArtifacts(input, trustedAuthorization)
getInterpretationOperation(input, trustedAuthorization)
getInterpretationHistory(input, trustedAuthorization)
reconstructEvidence(input, trustedAuthorization)
listEvidencePackages(input, trustedAuthorization)
reopenEvidencePackage(input, trustedAuthorization)
verifyEvidencePackage(input, trustedAuthorization)
```

Each method would delegate to the accepted R1/A3, R2, A5a, or A5b service and translate its output to a versioned bounded DTO. `getInterpretationOperation` would be a bounded authorized projection over existing R2 operation history; it would add no new Evidence state or interpretation behavior. The façade must keep trusted tenant, context, actor and caller scope separate from ordinary payloads; omit storage keys, URLs, credentials and raw private bytes; and export no UBO/KYC types or decisions.

Exact bounded implementation estimate:

| Proposed file | Purpose |
|---|---|
| `evidence/consumer.js` | Single public factory/operation surface delegating to accepted services |
| `evidence/contracts/v1.js` | Version constants, bounded DTO projection/validation, and public error vocabulary |
| `evidence/__tests__/consumerContract.nodetest.js` | Export and request/result/error golden-contract tests, side-effect characterization, and absence of internal/storage fields |
| `evidence/__tests__/consumerAuthorization.nodetest.js` | Trusted authorization, tenant/context denial, member-access loss, and non-disclosure tests |

No migration or new HTTP route is required for an in-process server-side consumer façade. If remote HTTP access is later required, its authenticated versioned transport is a separate production adapter task. The existing Evidence suite, KYC regression suite, production build, JavaScript parse, diff check, and secret scan remain release gates.

The producer façade should be separate. Producer operations accept source coordinates or uploaded bytes and create collection/ingestion records; consumer operations resolve and interpret existing authorized Evidence or reconstruct/reopen it. Their trust, idempotency, side effects, DTOs and operational controls differ. A future root-level `evidence/producer.js` may wrap the already accepted A2/R1 producer candidates, but it is not needed for the bounded UBO G4.1 consumer façade and is not authorized here.

## Producer-contract candidate — PROVISIONAL

### Purpose

Convert one already-authorized, source-specific collection request into the generic immutable Evidence graph:

```text
trusted producer request
  -> Collection Operation
  -> zero or more Acquisitions
  -> successful Acquisitions produce Evidence Assets
  -> Assets contain one or more exact Artifacts
  -> provenance, access scope, integrity, and partial/failure outcomes
```

### Trusted request candidate

The host supplies or resolves:

* authenticated actor/caller and tenant;
* authorized Evidence context and stable subject reference, when known;
* producer identifier and producer-specific collection coordinates;
* deliberate operation key and mode;
* source purpose/requirement association and bounded opaque correlation; and
* any upstream schema/information-needs context. Evidence does not resolve customer identity, jurisdiction, source choice, or schema choice.

Producer-specific coordinates remain opaque to the generic core. For Companies House they are `{ jurisdiction: "GB", companyNumber: "..." }`; this does not create a universal company-number field or producer-input schema.

### Generic Evidence responsibilities

* validate the trusted request envelope and operation-key semantics;
* create/claim the Collection Operation independently from Artifact hashes;
* persist each source retrieval as a distinct Acquisition with method, locator, actor, time, outcome, reason, and producer metadata;
* create an Asset only for a successful evidentiary acquisition;
* persist exact Artifact bytes through the configured store, media metadata, capture/source-effective time where supplied, and lowercase SHA-256;
* apply public or exact context-restricted access semantics;
* keep partial/failed acquisitions independent from successful evidence;
* commit logical records transactionally and report storage/integrity/persistence failures distinctly;
* support idempotent retry without treating identical content as the same evidentiary event; and
* return safe identifiers/status/provenance without storage credentials or private object references.

### Producer adapter responsibilities

* validate only its source-specific coordinate contract;
* authenticate to and call the external source;
* enforce source-specific identity correspondence rules;
* follow source-specific pagination/navigation completely;
* translate source responses into independent acquisitions and exact representations;
* classify truthful partial/failure outcomes without weakening other acquisitions;
* provide source-specific metadata, URLs, timing, media types, and bytes; and
* optionally provide deterministic extraction mappings only to existing upstream schema concepts.

The adapter must not own Evidence identity, storage authorization, KYC satisfaction, source winner selection, global entity resolution, or private cross-tenant reuse.

### Companies House implementation status

`CompaniesHouseEvidenceService` is the accepted first adapter and proves the pattern. Its A2 route, fixture/live dependency selection, Lab tenant input, standalone extraction context, and inspection payload are not the generic production contract. Companies House client/capture/extractor code remains source-specific.

## Consumer-contract candidates — PROVISIONAL

| Candidate | Inputs | Outputs | Current implementation/maturity |
|---|---|---|---|
| Ingest private Artifact | trusted tenant/context/subject, actor/channel, operation key, bytes, MIME, optional original name/effective date | immutable Acquisition/Asset/Artifact identity, media/integrity/provenance, replay state | **PROVISIONAL** service candidate; HTTP route **LAB ONLY** |
| Reopen authorized Artifact | trusted tenant/context plus Artifact ID | verified exact bytes server-side and safe metadata | **INTERNAL ONLY** R1/A3 reader path; browser must not receive storage references |
| Targeted interpretation | trusted authorization, one Asset's ordered Artifact IDs, neutral requested concepts, extraction context, correlation, operation key | immutable operation/run, responsive/discovered Facts, completeness/limitations, locators/typed relations, failure | **PROVISIONAL** service candidate; HTTP routes **LAB ONLY** |
| Interpretation history/preflight/options | trusted tenant/context/caller scope and Artifact selection | no-provider history or media readiness/authorized options | **PROVISIONAL** service candidates; current routes **LAB ONLY** |
| Fact-to-Need evaluation | authorized persisted Need and Fact IDs, explicit method/context and optional comparison | immutable per-Fact result/reason/lineage | **INTERNAL ONLY** until published behind consumer adapter |
| Coverage assessment | authorized exact Need and A4a candidates plus versioned assessment specification | separate provisional coverage/completeness/conflict/temporal/limitation dimensions | **INTERNAL ONLY** until published behind consumer adapter |
| Point-in-time reconstruction | trusted tenant/context/subject and `asOf` | ordered authorized Evidence projection and limitations | **INTERNAL ONLY**; current routes **LAB ONLY** |
| Freeze/reopen/verify Package | trusted scope/purpose/actor/operation key plus complete fresh A5a reconstruction | immutable Package, canonical manifest digest, ordered membership, authorization-aware materialization/integrity | **INTERNAL ONLY**; current routes **LAB ONLY** |

None of these candidates returns a KYC/UBO decision, operative value, source winner, or final satisfaction result.

### Provisional R2 request contract

The current service signature is:

```js
TargetedInterpretationService.interpret(input, trustedAuthorization)
```

`input` contains:

```text
operationKey          required bounded string
artifactIds           required unique list, 1–20 persisted Artifact UUIDs
requestedConcepts     required unique list, 1–20 objects:
  concept             required neutral concept string
  description         optional bounded description
  schemaFieldId       optional; only when supplied by an authorized upstream schema context
  informationNeedId   optional UUID; only when supplied by an authorized upstream context
extractionContext     optional object limited to:
  jurisdiction, language, schemaReference, schemaVersionReference,
  purpose, tenantConfigVersion
correlation           optional object:
  requestId
  externalReferences  up to 20 { system, type, id } objects
```

`trustedAuthorization` is a separate server-resolved argument containing required `tenantId`, `contextId`, `callerScope`, `actorType`, and optional `actorId`. It is not ordinary browser input. Evidence resolves Artifact/Asset/subject/storage/integrity metadata and rejects cross-Asset interpretation. There is no `targetSubject`, provider/model, source-recollection, storage location, caller hash, or raw-byte field in the current R2 request.

History and readiness are separate operations:

```js
TargetedInterpretationService.history({ artifactIds = [] }, trustedAuthorization)
TargetedInterpretationService.options({ contextId = null }, trustedAuthorization)
TargetedInterpretationService.preflight({ artifactIds = [] }, trustedAuthorization)
```

### Provisional R2 result contract

A completed current result contains:

```text
replayed
operation { id, key, status, outcome, startedAt, completedAt }
extractionRun { id, status, startedAt, completedAt, provider, model, instructionReference }
evidence {
  assetId,
  artifacts [{ id, assetId, representationType, mediaType, sizeBytes, capturedAt, order, inputRole }],
  integrity { verified, artifacts [...] },
  mediaPreflight
}
requestedConceptOutcomes [{ concept, status }]
responsiveFacts []
discoveredFacts []
completeness { input, extraction }
limitations []
typedRelationshipCount
correlation
downstreamEvaluation = not_performed
```

Each projected Fact currently contains `id`, `semanticConceptId`, `value`, `requestRelation`, `persistedRequestStatus`, `groundingType`, `supportState`, `supportingArtifactIds`, `supportLocators`, optional `typedRelationship`, and `createdAt`. The top-level `extractionRun.id` supplies the run identity; the public Fact projection does not currently repeat `extractionRunId` or expose a `confidence` field.

The typed relationship projection contains `factId`, `schemaVersion`, `relationshipType`, source `subject` and `object` party snapshots, `value`, `temporal`, `sourceSpecificMetadata`, `qualifications`, `mapping`, and `createdAt`. Value fields preserve exact/range endpoints and inclusivity, count numerator/denominator, qualitative value, unit, or unknown. The projection carries no UBO conclusion.

Current operation status is `completed`, `in_progress`, or `failed`; a completed operation result uses `completed` or `completed_partial`. Requested-concept status is mechanically normalized by the live provider path to `found`, `not_found`, or `not_evaluated`; R2 characterization also contains `unsupported`. These vocabularies are provisional until explicitly versioned. Complete means only that selected input and extraction processing reported no incompleteness—it does not mean all real-world facts were found, source truth was verified, the ownership graph is complete, or a requirement is satisfied.

## Current HTTP/API classification

### Lab-only adapters

All routes under `api/evidence/` are current Evidence Lab integration surfaces, not published production APIs. In particular:

* `a1-fixture`, `a3-fixture`, and `a4a-fixture` are fixture/test-only;
* A2 collection/existing/config exposes a source-specific Lab flow and lacks trusted production caller authorization;
* A3 history/interpret/config exposes internal interpretation behavior using Lab tenant context;
* A4a and A4b routes derive tenant from environment and accept internal persisted identifiers;
* R1 routes are explicitly local-only and transport private files as browser-provided base64;
* R2 routes require trusted host authorization in production, while local fallback uses Evidence Lab identity;
* A5a and A5b dependency factories explicitly reject production/Vercel use; and
* `status` is only capability/readiness metadata, not proof that dependencies or authorization are safe.

### Internal-only services

Repository classes, graph validators, canonicalizers, provider adapters, source-specific extractors/capture clients, comparators, set-assertion mappers, locator validators, reconstruction availability rules, and Package member-resolution logic are Evidence internals. Consumers must not import them to reconstruct policy or bypass authorization.

### Internal IDs currently exposed

Lab/API payloads may expose subject, context, Requirement, Information Need, Collection Operation, Acquisition, Asset, Artifact, Extraction/Interpretation Run, Fact, support/locator, typed relationship/set assertion, evaluation, assessment, Package, and Package-member identifiers. These are valid opaque references but are not a product authorization mechanism and must not become consumer business identity. Production contracts should expose only the minimum references required and keep composite/internal membership keys inside Evidence.

## Versioning requirements before production publication

Version and compatibility rules are required for:

* HTTP path/envelope, request, response, pagination, and error codes;
* producer request and acquisition-result contracts;
* neutral requested-concept and extraction-context envelopes;
* configured schema/information-need references;
* provider/model/instruction and semantic output schema;
* normalization, comparator, assessment-specification, and reconstruction-availability rules;
* locator schema and image coordinate conventions;
* typed relationship/set-assertion vocabularies;
* Package manifest, canonicalization, purpose, and member-type vocabularies; and
* media limits, provider capabilities, and storage adapter behavior.

Persisted version identifiers must remain reconstructable. A version change must not silently reinterpret historical Evidence.

## Authorization assumptions that must become explicit

Current services assume a trusted caller has already established tenant, context, subject, actor, purpose, and caller scope. Production integration must:

1. authenticate the caller and actor;
2. resolve tenant/context/subject server-side;
3. authorize the operation and every private Asset/member;
4. prevent browser-supplied scope from overriding trusted context;
5. record access and operation audit events;
6. apply current authorization on reopen/materialization without leaking inaccessible member metadata; and
7. keep storage keys, credentials, provider secrets, protected values, and raw private bytes server-side.

Package membership, SHA-256 equality, correlation, company number, and possession of an internal UUID never grant access.

## Evidence Producers Control Room handoff

### First proposed producer: known-domain company website

The host resolves the company/subject and the approved known domain before calling Evidence. The producer receives the authorized context plus source coordinates such as an approved canonical domain/URL. It must not perform name-only global matching or become the master entity system.

Recommended bounded implementation:

1. implement a source-specific adapter behind the generic producer candidate above;
2. create one new immutable Collection Operation for each deliberate collection and preserve idempotent retry separately;
3. create separate Acquisitions for materially distinct pages/source retrievals;
4. follow explicit same-domain pagination/navigation according to a versioned capture recipe;
5. preserve exact rendered HTML and screenshots as separate Artifacts with URL/order/time/media/SHA-256 metadata;
6. represent blocked, unavailable, incomplete, or partially captured pages truthfully without downgrading other successful acquisitions;
7. reuse configured storage, access, and server-side reopen; and
8. defer extraction unless a separately approved deterministic/semantic producer mapping is supplied.

Producer Control Room must decide robots/terms/legal policy, redirect/domain rules, capture depth, session/cookie handling, rate limits, change detection, and operational ownership. It must not create parallel Evidence tables or couple the generic collection model to website coordinates.

## UBO handoff

An adapter may place Evidence R2 behind UBO-owned `ExtractionService` and `DiscoveryService` interfaces:

* UBO supplies authorized context, selected Artifact references, neutral targeted concepts, correlation, and deliberate operation key;
* Evidence returns responsive/discovered Facts, source support/locators, typed relationship candidates that passed Evidence validation, percentage exact/range values, temporal state, completeness/limitations, and bounded failures;
* UBO maps those Evidence references into its own investigation model and retains Evidence Artifact/Fact/run identifiers for provenance; and
* history and retry use the Evidence operation contract without recollecting source Evidence.

Before integration, publish/version the adapter envelope, trusted authorization, consumer concept catalogue, failure translation, and a UBO-representative quality corpus. Evidence must not calculate indirect ownership, choose a controlling relationship, resolve identity, select winners, or determine a UBO.

## KYC handoff and smallest controlled vertical

The smallest useful vertical is:

```text
KYC-authenticated company context
  -> KYC resolves subject, jurisdiction, configured schema and Information Needs
  -> Evidence collects/reopens approved source Artifacts
  -> Evidence produces Facts, provenance, evaluations, and provisional assessments
  -> KYC adapter receives candidates plus Evidence references/limitations
  -> KYC owns operative-value selection, customer correction, risk, and final satisfaction
```

A bounded pilot can start with registered company name, company number, and registered address for one GB company context, using Companies House and optionally one authorized customer document. Required work is the trusted context/schema/Need handoff, versioned result adapter, authentication/authorization integration, and explicit KYC decision provenance. Evidence must not write directly into KYC form state, dossier fields, requirement status, customer answers, or risk outcomes.

## IDV handoff

V1 already supplies useful foundations: provenance, immutable history, source/correlation references, conflict preservation, authorization checks, point-in-time reconstruction, and immutable Packages.

IDV still requires separate architecture for:

* external-custody Evidence identity;
* Vault-backed protected-value references;
* Verification Observation and Provider Assertion primitives;
* a versioned IDV-to-Evidence integration envelope;
* reconstruction and Package behavior for Vault/external-custody members; and
* coordinated retention, revocation, disclosure, and access.

Didit-held passport, selfie, biometric, or raw identity-document content must not be represented as locally preserved R1 Artifact bytes. Evidence may later preserve authorized assertions/references and their provenance only under approved external-custody/Vault governance.

## Forbidden downstream dependencies

Consumers and producers must not:

* write Evidence tables directly or import repositories to bypass services;
* treat internal UUIDs, SHA-256, storage paths, Package membership, or correlation as authorization or business identity;
* depend on Evidence Lab HTML, route payloads, environment-derived tenant defaults, fixture content, or standalone A2 schema context;
* read object storage directly or receive storage credentials/references;
* mutate Evidence Facts, history, manifests, or Package membership;
* infer KYC/UBO satisfaction, source truth, trust, currentness, or operative values from Evidence support/evaluation/assessment alone;
* collapse public and context-restricted Evidence or share private Evidence because bytes match;
* fabricate schema fields, Information Needs, image coordinates, historical versions, or missing provenance;
* persist raw provider exchanges without separate governance; or
* assume a current module signature is a permanent public contract.

Downstream integration uses a versioned server-side adapter, passes trusted scope explicitly, handles partial/failed/indeterminate outcomes, and preserves Evidence references for reconstruction.
