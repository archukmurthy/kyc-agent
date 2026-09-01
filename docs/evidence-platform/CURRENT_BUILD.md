# Evidence Platform — Current Build Brief

# Evidence Consumer Readiness R2 — Targeted Interpretation Boundary

## Governance Status

This is the approved R2 implementation brief after completed R1 at commit `0bd62ee351b6a1ac0ca2f882ac338d790657f313`.

Architecture Authority has approved ADR-015, resolved fresh-execution idempotency, and authorized only the bounded R2 implementation described here.

R3, R4, A4b, UBO integration, and existing KYC behavior remain deferred and outside this build.

---

## 1. Objective

Define the smallest stable, provider-neutral Evidence boundary through which an already-authorized consumer may request targeted interpretation of already-preserved Evidence Artifacts.

```text
authorized consumer
      ↓
persisted Artifact IDs
+ neutral requested concepts
+ bounded extraction context
+ opaque correlation
      ↓
Evidence resolve → authorize → read → verify SHA-256
      ↓
existing A3 interpretation machinery
      ↓
immutable Extraction Run + reusable Facts + lineage
```

R2 wraps and hardens A3 for downstream integration. It does not create a second interpretation engine.

---

## 2. Existing A3 capability to reuse

`LiveArtifactInterpretationService.interpret` already accepts internally:

```text
artifactId or artifactIds[]
tenantId
contextId?
requestedConcepts[]?
extractionContext?
```

It already:

1. resolves each persisted Artifact through the repository;
2. authorizes public or exact private tenant/context access;
3. rejects cross-Evidence-Asset input sets;
4. orders persisted multi-page Artifacts and assesses input completeness;
5. rejects unsupported media before provider execution;
6. reads bytes from authoritative server-side storage;
7. verifies persisted SHA-256 for every Artifact;
8. sends several requested concepts in one provider request;
9. accepts several provider Facts in one run;
10. distinguishes requested and discovered Facts;
11. preserves explicit Fact-to-Artifact support;
12. records provider, model, instruction, extraction context, timestamps, and support;
13. appends immutable Extraction Run history; and
14. reopens history separately without a provider call.

The minimum R2 implementation should delegate to these capabilities rather than duplicate them.

---

## 3. Current integration gaps

The current `/api/evidence/a3-interpret` and `/api/evidence/a3-history` handlers are Lab/internal adapters, not stable production consumer contracts.

They currently:

* resolve tenant from server environment but do not propagate an authorized `contextId`;
* therefore cannot use the corrected exact-context path for private R1 Artifacts;
* ignore caller `requestedConcepts` and `extractionContext` even though the internal service supports them;
* default missing values to standalone Evidence Lab concepts/context;
* have no opaque correlation envelope;
* return a large Lab-shaped object containing internal structures;
* do not validate concept count, description size, context shape, or Artifact-set bounds;
* do not expose a distinct unsupported-concept state; and
* have no operation-level idempotency contract for a lost-response retry.

R2 must add a new stable adapter. It must not silently redefine the existing Lab endpoints as production contracts.

---

## 4. Proposed R2 request boundary

Conceptually:

```text
interpretArtifacts({
  artifactIds: [...],
  requestedConcepts: [
    { concept, description? }
  ],
  extractionContext: {
    jurisdiction?,
    language?,
    schemaReference?,
    schemaVersionReference?,
    purpose?,
    otherApprovedNeutralConstraints?
  },
  correlation: {
    requestId?,
    externalReferences?: [{ system, type, id }]
  }
})
```

Exact API/service names and bounded size/count limits remain implementation details.

Trusted host state supplies authorized tenant, Evidence context, actor, and authorization. The request payload is not proof of authority.

Consumers supply persisted Artifact IDs only. They do not supply authoritative bytes, fingerprints, media/source metadata, Blob URLs, filesystem paths, storage keys, or credentials.

---

## 5. Neutral requested concepts

R2 supports one or several neutral Evidence semantic concepts in one interpretation operation. Examples include:

* economic ownership relationship;
* voting rights;
* appointment or removal rights;
* registered entity identifiers;
* former legal names; and
* registered address.

The request must not instruct Evidence to determine UBO/controller status, calculate policy ownership thresholds, satisfy a KYC requirement, select a winner, or make an operative business decision.

Consumer-domain Information Need IDs, policy IDs, UBO IDs, or similar references belong only in opaque correlation. They do not become Evidence Information Needs, schema fields, foreign keys, or provider instructions.

A3 open discovery remains enabled. Additional clearly relevant facts remain `discovered`; Evidence does not mutate the request or schema.

---

## 6. Extraction context and opaque correlation

Extraction context is Evidence-facing interpretation input. R2 validates a bounded neutral shape, persists it with the run, and forwards only approved interpretation fields to the provider.

Opaque correlation is reconstructive caller metadata. Evidence validates only its bounded shape/size, persists and returns it, but does not interpret, dereference, authorize from, or forward it to the semantic provider.

Correlation must remain separate from:

* Evidence identity;
* Extraction Run identity;
* idempotency;
* requested concepts;
* extraction context;
* Evidence Information Needs; and
* policy/domain semantics.

Existing Extraction Run JSONB metadata is sufficient for bounded correlation. No migration is expected unless Architecture Authority later requires searchable/unique correlation semantics.

---

## 7. Artifact selection and authorization

R2 may interpret:

* one persisted Artifact; or
* an explicit coherent set of persisted Artifacts belonging to one Evidence Asset.

Cross-Evidence-Asset selection remains prohibited. Run-input lineage records every selected Artifact, while Fact-to-Artifact support records only the Artifact or Artifacts that actually support each Fact.

Public access remains governed by the existing public rule. Private access requires:

```text
context_restricted Asset
+ exact authorized tenant
+ exact authorized Evidence context
+ matching explicit Asset access scope
```

Authorization occurs before storage access or provider execution. Same-tenant membership alone is insufficient.

---

## 8. Media boundary

R2 does not add interpretation media.

Current supported media remain:

* `application/json` and compatible `+json`; and
* `text/html`.

An R1-preserved PDF, PNG, or JPEG remains valid stored Evidence but must receive explicit `unsupported_media_type` from R2 until R3 is separately authorized.

Artifact preservation success must never imply current interpretability.

---

## 9. Outcome model

Per requested concept, R2 must distinguish:

| Outcome | Meaning |
|---|---|
| `found` | supported Fact(s) answer the requested concept |
| `not_found` | interpretable, sufficiently complete input does not represent the requested fact |
| `not_evaluated` | incomplete/unreadable input or another limitation prevented evaluation |
| `unsupported` | current interpretation capability does not support the requested concept |

Operation/run outcomes must additionally distinguish:

* completed interpretation;
* completed but partial/incomplete interpretation;
* legitimate completion with no relevant Facts found;
* inconclusive interpretation;
* unsupported media;
* provider unavailable/not configured;
* malformed/truncated/timed-out provider result;
* storage read failure;
* Artifact integrity failure;
* access denial;
* cross-Asset input rejection; and
* persistence failure.

`unsupported` is not `not_found`; `not_found` is not provider failure; incomplete is not unavailable; and access/integrity/persistence failures are not “no data.”

No unsupported/failed result may fabricate a Fact.

---

## 10. Historical versus fresh execution

R2 exposes separate contracts:

```text
openInterpretationHistory(...)
  external source call: NO
  provider call: NO
  new run: NO

interpretArtifacts(...)
  external source call: NO
  provider call: MAYBE/YES
  new immutable run: YES
```

Selecting or resolving an Artifact, inspecting history, or round-tripping correlation must never trigger a provider call.

Historical output includes persisted requested-concept outcomes, Facts, support/completeness, input and Fact-support lineage, provider/model/instruction references, timestamps, failures, and opaque correlation.

---

## 11. Durable operation-key idempotency

Every stable fresh R2 request requires a caller-supplied `operationKey`. Historical reopening remains separate and requires no operation key. Correlation is not idempotency or run identity.

Within the trusted tenant/context/caller scope:

```text
same operationKey + same canonical request
  completed   → return existing result; provider NO; new run NO
  in_progress → return current status; provider NO; new run NO
  failed      → return persisted failure; automatic retry NO; new run NO

same operationKey + changed canonical request
  → idempotency_conflict

new operationKey
  → explicit new operation and immutable Extraction Run
```

The canonical fingerprint includes trusted tenant/context scope, authoritative resolved Artifact order, neutral requested concepts/descriptions/bounded Evidence linkage, validated extraction context, opaque correlation, and persisted trusted caller metadata. Provider/model/instruction configuration is excluded. The actual execution configuration remains persisted lineage.

R2 is authorized to add migration 015 as one forward-only interpretation-operation table with atomic scoped uniqueness, request fingerprint, bounded correlation, status, optional run reference, bounded failure, and timestamps. Migrations 010–014 remain immutable. No general workflow engine is authorized.

---

## 12. Stable response boundary

The R2 response should intentionally expose:

* run identity and status;
* safe Evidence Artifact/Asset identities;
* integrity result;
* requested-concept outcomes;
* requested and discovered Facts;
* explicit supporting Artifact IDs per Fact;
* input and extraction completeness/limitations;
* provider/model/instruction lineage;
* evidence-capture and extraction timestamps;
* bounded non-secret failure details; and
* opaque caller correlation.

It must not expose storage keys/references, credentials, provider prompts/raw responses, repository row shapes, Lab fixture defaults, or unbounded internal error objects.

---

## 13. Separation from A4a and consumer policy

R2 produces and retrieves A3 Evidence Facts. It does not automatically call A4a.

```text
R2 interpretation → Evidence Facts

separately:

A4a Fact-to-Information-Need evaluation
```

R2 does not select operative values, aggregate conflicts, assess coverage, determine satisfaction, calculate ownership, identify UBOs/controllers, mutate schemas, or import UBO/KYC/EDD/source-of-funds contracts.

---

## 14. Required future characterization

Before R2 can be accepted, separately authorized implementation must prove:

1. one persisted Artifact plus one requested concept;
2. one Artifact plus several requested concepts in one provider operation;
3. one operation producing several Facts;
4. requested and discovered Facts coexisting;
5. opaque correlation round-trip without provider exposure or domain adoption;
6. exact tenant/context authorization for private Evidence;
7. existing public Artifact interpretation remains permitted;
8. coherent same-Asset multi-Artifact interpretation;
9. cross-Asset selection rejected;
10. every Artifact SHA-256 verified before provider execution;
11. unsupported concept differentiated from legitimate not-found;
12. PDF/image reported unsupported before R3;
13. provider failure differentiated from no data;
14. history reopened without provider call;
15. deliberate fresh interpretation creates new immutable history;
16. Fact-to-Artifact support remains precise; and
17. no downstream policy/domain imports or automatic A4a action.

---

## 15. Stop conditions

Stop for Architecture Authority if R2 requires:

* idempotency semantics beyond the approved scoped operation-key contract;
* arbitrary cross-Evidence-Asset interpretation;
* weakening private tenant/context access;
* authoritative browser-supplied bytes or storage metadata;
* adopting foreign domain IDs as Evidence identities;
* a new general interpretation engine;
* PDF/image interpretation or locators;
* typed relational ownership Facts;
* automatic A4a evaluation;
* UBO/controller or KYC satisfaction logic;
* A4b; or
* rewriting migrations 010–014.

---

# Prior Accepted Build Brief — R1 Private Artifact Ingestion

The remainder of this file preserves the previously approved R1 brief for governance history. R1 was implemented at `0bd62ee351b6a1ac0ca2f882ac338d790657f313` and is not reopened by the proposed R2 governance.

---

## 1. Objective

Create the smallest production-capable generic Evidence boundary through which an already-authorized server-side private/customer upload can become immutable Evidence and later be reopened by an authorized server-side consumer.

```text
Authorized host upload
        ↓
Evidence private-artifact ingestion
        ↓
immutable context-restricted Evidence Asset
        ↓
immutable original-byte Artifact
        ↓
SHA-256 + media + provenance + timestamps
        ↓
strictly authorized server-side reopen
```

R1 preserves bytes and provenance. It does not interpret the document or decide what it proves.

---

## 2. Observed Existing Capability

The existing implementation already provides:

### Persistence

* `evidence_collection_operations` for producer/request operation identity, mode, status, coordinates, and lifecycle timestamps;
* `evidence_acquisitions` for tenant, context, subject, source, method, actor, outcome, and acquisition timestamps;
* `evidence_assets` for durable logical Evidence identity, subject, type/title, access class, and observation time;
* `evidence_asset_access_scopes` for tenant/context visibility;
* `evidence_artifacts` for Artifact identity, representation/media type, original name, storage provider/key/reference, exact size, SHA-256, capture time, and metadata; and
* forward-only transactional graph persistence through the A1/A2 repositories.

### Raw-byte storage

* `VercelBlobArtifactStore` is the current production storage adapter and writes private Blob objects;
* `FileArtifactStore` is the local Evidence-only adapter;
* `MemoryArtifactStore` and `fixture_content` are fixture/test mechanisms; and
* each adapter accepts opaque bytes independently of extraction support.

### Integrity and reopen

* `sha256()` calculates lowercase SHA-256 over exact bytes;
* A2 persists the calculated fingerprint and byte size with every Artifact;
* `EvidenceArtifactReader` reopens filesystem, private Vercel Blob, or fixture bytes server-side; and
* A2 history and A3 live interpretation demonstrate read-time SHA-256 verification before bytes are exposed or interpreted.

### Existing access model

* public Assets are structurally reusable subject to later policy;
* private/customer Assets use `access_class = context_restricted` plus an explicit tenant/context access scope;
* Acquisition carries tenant, context, and subject lineage; and
* Evidence context already belongs to a tenant and subject reference.

The current A3 interpretation repository also contains a same-tenant authorization shortcut. This is a bounded implementation defect against the existing private/context-restricted invariant, not a new architecture decision. It is not an acceptable private-reopen predicate for R1. R1 implementation is authorized to correct it narrowly while leaving public Evidence behavior unchanged.

---

## 3. Existing Domain Must Be Reused

R1 reuses the existing domain chain:

```text
Collection Operation
        ↓
Acquisition
        ↓
Evidence Asset
        ↓
Asset Access Scope
        ↓
Artifact
        ↓
Storage + SHA-256 + Provenance
```

Do not create parallel upload-document, blob, evidence, subject, context, access, provenance, fingerprint, or history concepts.

R1 creates no Evidence Requirement, Information Need, Extraction Run, extracted value, A3 Fact, verification attempt, A4a evaluation, or A4b assessment.

The implementation may add a generic `evidence/ingestion` module and service/repository interfaces. It may reuse or semantics-preservingly extract the existing Artifact-store implementation from its A2-oriented module location. It must not duplicate the storage adapters.

---

## 4. Proposed Service Boundary

The future service input is conceptually equivalent to:

```text
ingestPrivateArtifact({
  idempotencyKey,
  authorizedTenantId,
  authorizedContextId,
  subjectReferenceId?,
  actorType,
  actorId?,
  sourceChannel,
  sourceLocator?,
  bytesOrServerStream,
  declaredMediaType,
  originalFilename?,
  sourceEffectiveDate?
})
```

Exact names and transport remain implementation details.

The boundary receives an upload only after the host has authorized Evidence Platform custody. Tenant, context, and actor identity come from trusted server-side authorization/session context. A browser must not be able to assert an arbitrary tenant, context, actor, storage path, storage reference, fingerprint, or subject association.

The context must exist and belong to the authorized tenant. R1 derives its subject from that context. If a subject reference is supplied, it is a consistency constraint and must match the context; R1 does not resolve identity or create a new canonical subject.

The successful response may expose:

* Collection Operation ID;
* Acquisition ID;
* Evidence Asset ID;
* Artifact ID;
* canonical media type;
* byte size;
* SHA-256;
* ingestion/capture timestamp;
* explicitly supplied source-effective date; and
* safe provenance summary.

It must not expose storage credentials, private storage paths/keys/references, raw authorization context, or unrelated private Evidence.

---

## 5. Media Support and Validation

R1 must support storage/ingestion for at least:

| Media | Canonical MIME type | Minimum server-side signature check |
|---|---|---|
| PDF | `application/pdf` | PDF file signature |
| PNG | `image/png` | PNG binary signature |
| JPEG | `image/jpeg` | JPEG binary signature |

This is preservation support, not interpretation support.

The implementation must:

* accept bytes or a bounded server-side stream rather than a browser storage reference;
* enforce configured byte-size limits before unbounded buffering/storage;
* validate supported file signatures and reject declared-MIME/signature conflict;
* derive a canonical media type from the validated format;
* reject empty, malformed, unsupported, or forbidden media;
* preserve exact original bytes without transcoding, recompression, PDF rewriting, EXIF modification, or image normalization; and
* treat original filename as optional untrusted display metadata.

Filename sanitization must prevent path traversal, header injection, and use as a storage key. The filename does not establish content type, subject, evidence class, or authorization.

Use a generic representation type such as `original_upload` and a generic Evidence type such as `private_uploaded_artifact`. R1 must not create UBO-specific or other consumer-specific media classifications.

It is valid for R1 to preserve an Artifact that A3 cannot interpret. Unsupported interpretation is not unsupported storage.

---

## 6. Storage and Integrity Sequence

For a valid, authorized request:

1. validate operation identity, context, metadata, size, and media signature;
2. calculate SHA-256 over the exact input bytes;
3. store the exact bytes using the configured authoritative Artifact store;
4. read the stored object back through that storage boundary;
5. verify byte size and SHA-256 against the input calculation;
6. persist the Collection Operation, successful Acquisition, context-restricted Asset, access scope, and Artifact in one logical database transaction; and
7. return a non-secret Evidence identity/provenance summary.

No successful Artifact may be reported before read-back integrity and persistence succeed.

SHA-256 means only:

> The reopened Artifact bytes are byte-for-byte identical to the bytes accepted by R1.

SHA-256 is not Evidence identity, semantic equivalence, source trust, reuse permission, or access permission.

Physical deduplication is outside R1. A later optimization must not merge logical Evidence history or weaken private access isolation.

---

## 7. Idempotent Retry and Genuine Repeat Upload

R1 uses the existing producer/request-key uniqueness boundary with a neutral private-ingestion producer identity.

### Retry of one logical operation

The same idempotency key, tenant, context, provenance-affecting metadata, media, and SHA-256 identify the same intended upload operation.

Retry must:

* reopen or resume the existing operation;
* return the same logical operation/Acquisition/Asset/Artifact identities after success;
* make no second successful logical Evidence history; and
* never mutate a previously completed Artifact.

Using the same key with different tenant, context, bytes, canonical media, or material provenance metadata is an `idempotency_conflict`.

### Deliberate repeat upload/recollection

A deliberate new upload uses a new idempotency key and creates new immutable Collection Operation, Acquisition, Asset, and Artifact identities.

This remains true when:

```text
old SHA-256 = new SHA-256
```

Identical bytes do not automatically mean the same evidentiary event.

---

## 8. Private Access and Security

Every R1 Asset must be:

```text
access_class = context_restricted
```

and have an explicit access scope for its authorized tenant and Evidence context.

Authorized reopen requires all of:

* Artifact and Asset exist;
* Asset is context restricted;
* explicit asset scope matches authorized tenant;
* explicit asset scope matches authorized Evidence context;
* context belongs to that tenant;
* subject association remains the one persisted through the context/acquisition; and
* stored bytes pass SHA-256 verification.

Same tenant without the matching context is insufficient. Cross-context and cross-tenant private discovery/reuse are forbidden. Artifact IDs and fingerprints are not bearer tokens.

The identified A3 same-tenant shortcut must be corrected through this same invariant: context-restricted interpretation requires the exact authorized tenant and context. Do not broaden the correction into a new authorization model or change public Evidence access.

The future reopen boundary is conceptually equivalent to:

```text
readAuthorizedArtifact({ artifactId, authorizedTenantId, authorizedContextId })
```

It resolves metadata and authorization before storage access, reads only the persisted server-side storage location, verifies SHA-256, and returns bytes or an approved server-side stream to the authorized caller. Browser-facing inspection must not expose storage credentials or references.

R1 does not implement retention/deletion, malware scanning policy beyond bounded media validation, content-disarm/reconstruction, antivirus vendor selection, DLP, legal hold, or a general secret/biometric vault. If production security requires any of those before accepting a real consumer, that control must be separately authorized or supplied by the host boundary.

---

## 9. Provenance and Time Semantics

Successful ingestion preserves:

* Evidence Asset and Artifact identities;
* exact original bytes;
* canonical MIME type and byte size;
* optional sanitized original filename;
* Acquisition source channel/provider/locator where applicable;
* acquisition method;
* authorized actor type and identifier where available;
* tenant, Evidence context, and context-derived subject reference;
* private access scope;
* SHA-256 and algorithm;
* acquisition start/completion time;
* Asset observation time;
* Artifact capture/ingestion time; and
* an explicitly supplied source/document effective date.

These times must remain distinct:

```text
source-effective date (optional, host supplied)
≠ acquisition/upload time
≠ Artifact capture time
≠ database creation time
≠ future extraction time
```

R1 must not inspect the document to infer an effective date. It must not use client filesystem modification time as source-effective evidence. A supplied effective date is preserved under the canonical Evidence-owned `artifact_metadata.sourceEffectiveDate` property with its host-supplied provenance and ISO precision. It does not replace `captured_at` or `observed_at`, and it does not establish freshness or current applicability.

---

## 10. Failure Model

The service/API must distinguish at least:

| Failure | Meaning |
|---|---|
| `invalid_request` | required operation/media/context metadata is absent or malformed |
| `access_denied` | trusted authorization does not permit the tenant/context/subject operation |
| `unsupported_media_type` | format is not in the R1 preservation allowlist |
| `invalid_media` | bytes are empty, malformed, or conflict with declared media metadata |
| `idempotency_conflict` | an existing key is reused for materially different input |
| `artifact_storage_failed` | authoritative object storage did not accept or reopen the bytes |
| `artifact_integrity_mismatch` | stored bytes/length do not match the accepted input |
| `evidence_persistence_failed` | logical Evidence transaction did not commit |

Exact internal code spelling may follow repository conventions, but these meanings must remain separately observable without secrets.

None of these failures means:

```text
document contains no facts
```

R1 performs no extraction. A failed or denied request creates no successful Asset or Artifact. Where a failed Collection Operation or Acquisition can be safely and truthfully recorded, it must contain no fabricated evidence result. A persistence failure must not be reported as success even if object storage already contains an orphaned object.

Cleanup of an R1-created orphan storage object may be implemented only as a scoped operational mechanism that cannot delete any previously persisted Artifact or shared physical object.

---

## 11. Production Storage Boundary

Do not assume a new storage subsystem is required.

The minimum R1 implementation should reuse:

* private Vercel Blob for deployed production storage;
* the configured Evidence-only filesystem directory for local acceptance;
* memory/fixture storage only for tests; and
* the existing server-side reader for provider-specific reads.

The production API must fail closed when no approved durable Artifact store is configured. Memory storage and database `fixture_content` are not production fallbacks.

Storage provider selection remains an infrastructure configuration. It must not change Evidence identity, access class, provenance, or retry semantics.

---

## 12. Persistence and Migration Direction

The minimum R1 model is representable without a new migration:

* Collection Operation — migration 011;
* Acquisition, Asset, access scope, and Artifact — migration 010;
* media type and original filename — existing Artifact columns;
* actor/source provenance — existing Acquisition columns and producer metadata;
* source-effective date — canonical `artifact_metadata.sourceEffectiveDate`, distinct from capture time; and
* SHA-256, byte size, capture time, and storage lineage — existing Artifact columns.

Implementation must not rewrite migrations 010–014.

If repository implementation shows a new typed column or state is necessary to preserve these semantics, stop for Architecture Authority. Any approved migration must be additive and forward-only. R1 must not overload extraction or A4a tables.

---

## 13. Required Characterization

When separately authorized, R1 implementation must prove at minimum:

1. PDF ingest and authorized reopen are byte-for-byte exact;
2. PNG ingest and authorized reopen are byte-for-byte exact;
3. JPEG ingest and authorized reopen are byte-for-byte exact;
4. stored SHA-256 matches accepted and reopened bytes;
5. Artifact identity is immutable;
6. tenant/context-restricted visibility succeeds only for the exact authorized scope;
7. cross-context and cross-tenant reads are denied before storage access;
8. canonical media type, size, optional filename, and source metadata are correct;
9. upload/capture time and supplied source-effective date remain distinct;
10. malformed and unsupported media fail without Evidence conclusions;
11. storage, integrity, and persistence failure are separately observable;
12. an idempotent retry creates no second logical evidence event;
13. a deliberate new upload with identical bytes creates new immutable Evidence identities;
14. prior Artifact history is never mutated;
15. API responses expose no storage credentials/references; and
16. no extraction, Fact, evaluation, UBO, KYC, or A4b record is created.

Tests must use fixture bytes and disposable infrastructure. No paid AI request or external evidence-source call is required.

---

## 14. Explicit Exclusions

R1 does not implement:

* document extraction or interpretation;
* PDF text extraction, OCR, vision, or AI provider calls;
* Facts, derived Facts, support states, or verification;
* Evidence-to-Need evaluation;
* A4b coverage/conflict/provisional assessment;
* Requirement satisfaction;
* source trust or suitability;
* operative-value or winner selection;
* evidence reuse or discovery policy;
* private cross-context or cross-tenant access;
* UBO types, IDs, ownership claims, Information Needs, media types, or contract changes;
* KYC/KYB, EDD, source-of-funds, analyst, or other consumer workflow integration;
* creation or resolution of global subject identity;
* direct browser authority to select storage or access scope;
* external-custody IDV passport, selfie, or biometric retention;
* general identity/biometric vault design;
* retention/deletion policy;
* physical deduplication;
* R2, R3, or R4; or
* changes to existing KYC behavior.

---

## 15. Stop Conditions

Stop and report before R1 implementation proceeds if it would require:

* weakening exact tenant/context private access;
* trusting browser-supplied tenant, context, actor, subject, hash, bytes reference, or storage reference as authoritative;
* treating SHA-256 as logical identity or authorization;
* interpreting a document to ingest it;
* creating consumer-specific or UBO domain records;
* taking custody of external-custody IDV/biometric artifacts without separate governance;
* mutating an existing Asset or Artifact on retry or repeated upload;
* using upload time as an inferred document-effective date;
* reporting an extraction/no-facts conclusion for an ingestion failure;
* exposing private storage references or credentials;
* using memory/fixture storage as a production fallback;
* rewriting migrations 010–014;
* implementing A4b, R2, R3, or R4; or
* changing normal KYC/Pre-boarding/UBO behavior.

---

## 16. Future Completion Criteria

After separate implementation authorization, R1 is complete when the isolated Evidence boundary demonstrates:

```text
already-authorized private PDF/PNG/JPEG
        ↓
validated media + exact bytes
        ↓
private durable storage + read-back SHA-256
        ↓
immutable operation/acquisition/asset/artifact provenance
        ↓
exact tenant/context access scope
        ↓
authorized server-side reopen
        ↓
interpretation and downstream decision: NOT PERFORMED
```

Completion must prove idempotent retry and genuine identical-byte repeat uploads as different cases, preserve prior history, and leave R2/R3/R4, A4b, UBO, consumer integration, and existing KYC behavior untouched.
