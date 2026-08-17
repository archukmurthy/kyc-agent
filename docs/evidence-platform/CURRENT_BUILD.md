# Evidence Platform — Current Build Brief

# Stage A2 — Companies House Evidence Producer

## 1. Objective

Implement the first real Evidence Platform producer. Given a resolved UK Companies House collection request, independently acquire, preserve, fingerprint, and deterministically extract Company Profile, complete Officers, complete PSC, and Company Overview website evidence into the Stage A1 Evidence domain.

The evidence itself is the primary product of A2. Extracted KYC/KYB information is derived from preserved evidence.

---

## 2. Producer Input and Identity Boundary

The core Evidence Collection Operation must remain producer-neutral. Do not add universal company-number fields or a universal producer-input schema.

For A2 only, the Companies House producer contract is:

```text
producer = companies_house
collection_coordinates = { jurisdiction: "GB", companyNumber: "..." }
```

The Companies House company number is a Companies House producer-specific collection identifier and source coordinate, not a mandatory global Evidence Platform subject identifier.

Different future producers may require source-specific identifiers, URLs, legal name plus jurisdiction, licence or certificate references, or other source-appropriate inputs. The broader multi-jurisdiction and multi-producer input model is deferred. A2 must avoid structurally preventing it but must not design other jurisdictions or producers now.

The approved responsibility boundary is:

```text
KYC / Onboarding responsibility
identify subject → resolve ambiguity/conflict → determine appropriate source and collection coordinates

Evidence Platform responsibility
receive resolved collection request → acquire → preserve → fingerprint → extract → maintain provenance
```

A2 does not implement name-only Companies House matching. The Companies House producer must verify that the company number represented by the authoritative Companies House response corresponds to the company number requested. If it does not, the response must not be silently associated with the requested subject. No further identity resolution or discrepancy decisioning is performed by Evidence.

Evidence may associate the collection with an available stable subject reference where safely established, but must not become a global master-entity or identity-resolution system.

---

## 3. Required Collection Model

One durable, producer-neutral Evidence Collection Operation coordinates four independent Companies House Acquisitions:

1. Company Profile API;
2. Officers API;
3. PSC API;
4. Company Overview website.

The Collection Operation is an orchestration, lifecycle, and idempotency boundary. It is not an Evidence Asset and does not replace Evidence Acquisition.

Each source records success, failure, or inconclusive outcome independently. The overall collection may be successful, partial, failed, or inconclusive.

The intended result is:

```text
Companies House Collection Operation
        │
        ├── Profile API Acquisition
        │      └── Profile Evidence Asset
        │             └── Raw JSON Artifact
        │
        ├── Officers API Acquisition
        │      └── Officers Evidence Asset
        │             ├── Raw page 1 JSON Artifact
        │             ├── Raw page 2 JSON Artifact
        │             └── ...
        │
        ├── PSC API Acquisition
        │      └── PSC Evidence Asset
        │             ├── Raw page 1 JSON Artifact
        │             ├── Raw page 2 JSON Artifact
        │             └── ...
        │
        └── Website Acquisition
               └── Company Overview Evidence Asset
                      ├── Rendered HTML Artifact
                      └── Screenshot Artifact
```

A failed or inconclusive Acquisition remains in the historical record and produces no Evidence Asset.

---

## 4. Required Source Surfaces

### Company Profile API

Collect the official structured Companies House company-profile response. Preserve the full response before deriving configured KYB values.

### Officers API

Collect every applicable response page according to Companies House pagination semantics. Preserve all returned source records, including resigned officers. Current-officer filtering is a downstream interpretation and must not alter source evidence.

### PSC API

Collect every applicable response page according to Companies House pagination semantics. Preserve current and ceased PSC records, nature-of-control codes, dates, available identity attributes, and available corporate jurisdiction/registration information.

Do not convert ownership bands into false exact percentages. A derived lower bound must remain explicitly identified as a minimum or band.

### Company Overview Website

Collect the public Companies House company overview page as a separate Acquisition from the APIs. Where technically available, preserve rendered HTML and a screenshot as separate Artifacts on the same website Evidence Asset.

The website Artifacts are supplementary human-viewable representations. They do not replace or impersonate official API evidence.

---

## 5. Artifact Preservation and Integrity

For Company Profile, Officers, and PSC, preserve exact HTTP response-body bytes before interpretation wherever safely available. If runtime behavior requires serialization after parsing, use and document one deterministic canonical serialization at receipt time; hash and store those exact bytes rather than a later reconstruction.

Preserve every Officers and PSC page as a distinct Artifact on its applicable Evidence Asset. Record page order and non-secret request/response metadata sufficient to reconstruct the acquisition.

For website capture:

* preserve post-render DOM serialization as a rendered HTML Artifact encoded deterministically;
* preserve exact screenshot bytes as a separate screenshot Artifact;
* identify both as website representations, not API representations.

For every Artifact:

```text
exact preserved bytes
        ↓
SHA-256
        ↓
artifact fingerprint
```

The fingerprint demonstrates byte integrity only. It does not determine Acquisition identity, Evidence Asset identity, authorization, semantic equivalence, or reuse eligibility. Separate acquisitions remain separate history even when their Artifacts have identical hashes.

Artifacts must use durable storage. Database records must not point to missing or ephemeral artifact content. Credentials and authorization headers must never be preserved in artifact metadata or exposed in Evidence Lab.

---

## 6. Extraction

Use deterministic extraction and mapping wherever Companies House provides structured fields. Do not call an LLM merely to reinterpret authoritative structured API data.

All extracted values must reference concepts from the current applicable configurable KYC/KYB schema. Do not create a competing Evidence field ontology. Where no applicable configured schema concept exists, preserve the information in source evidence without forcing an extracted field.

Schema version may remain absent/null or use the approved non-breaking current/latest compatibility convention under ADR-010. Do not implement schema versioning.

Preserve the distinction between what Companies House returned and what the deterministic mapper derived. Each value must retain lineage to its Extraction Run, Evidence Asset, and exact Artifact/page.

For PSC, preserve original nature-of-control values. Any derived ownership minimum or band must retain its bounded meaning and must not be represented as an exact ownership percentage.

A2 does not require AI extraction or independent screenshot re-extraction/verification.

---

## 7. Transactional and Resumable Persistence

The final intended Evidence graph for a collection must be persisted transactionally:

```text
all graph rows succeed
OR
all graph rows roll back
```

The implementation must not leave an unexplained half-created acquisition, asset, artifact, or extraction graph.

Artifact storage and database persistence do not share one transaction. Use deterministic, retry-safe collection and artifact identities. Store and verify durable artifact bytes before committing database references. If database persistence fails, retain sufficient collection failure state to retry safely without uncontrolled duplicate logical history or references to missing bytes.

Do not silently lose a collection attempt merely because final graph persistence failed.

---

## 8. Producer Identity, Retry, and Recollection

The Collection Operation must record a stable producer request key.

### Retry

The same intended collection operation is retried after processing, storage, or persistence failure. The same producer request key identifies the same logical collection and must not create uncontrolled duplicate history.

### Recollection

A new intentional collection at a later time uses a new producer request key and creates new Acquisitions, Evidence Assets, Artifacts, and Extraction Runs.

### Same bytes

Identical SHA-256 fingerprints do not collapse recollection history. May and August remain separate collection histories even if a source response did not change.

### Accidental duplicate processing

Repeated handling of the same producer request key must return, resume, or safely complete the same logical collection rather than creating a second collection.

---

## 9. Partial Success

Failure of one source area must not invalidate evidence successfully acquired from another source area.

For example:

```text
Profile API:  SUCCESS
Officers API: SUCCESS
PSC API:      FAILED — temporary upstream error
Website:      FAILED — CAPTCHA
```

must result in:

* durable Profile and Officers evidence with complete lineage;
* a failed PSC Acquisition with its reason and no PSC Evidence Asset;
* a failed Website Acquisition with its reason and no Website Evidence Asset;
* overall collection status `partial`.

If expected pagination cannot be completed, the applicable source Acquisition must not be represented as successful complete evidence.

---

## 10. Public Evidence and Access Boundary

Companies House evidence is independently self-sourced public evidence. The model must remain capable of associating an eligible public Evidence Asset with multiple requirements or contexts later without copying or re-owning the asset.

A2 does not implement freshness, suitability, acceptance, or the complete cross-context reuse engine. An explicit recollection creates new evidence history even when earlier public evidence exists.

A2 must not create a general unauthenticated Evidence retrieval service or expand customer/private evidence ingestion and access. The A1 private-evidence authorization limitation remains outside this public producer scope.

---

## 11. Evidence Lab Acceptance Surface

Extend the internal Evidence Lab so Architecture Authority can initiate and inspect an A2 collection without reading database rows.

Evidence Lab must clearly and persistently distinguish:

```text
LIVE COMPANIES HOUSE COLLECTION
```

from:

```text
FIXTURE / SIMULATED — NOT LIVE SOURCED EVIDENCE
```

For each collection, display:

* requested Companies House collection coordinates;
* producer request/collection identity;
* overall status;
* per-source Acquisition outcome, timestamps, and failure reason;
* Evidence Assets and Artifacts;
* artifact representation, size, and SHA-256 fingerprint;
* safe raw-response, HTML, and screenshot inspection where applicable;
* deterministic extracted values and lineage to the applicable source Artifact;
* current and resigned officer counts while confirming both remain preserved;
* current and ceased PSC records and source ownership bands without false exact percentages.

For live mode, report whether required credentials, database, durable artifact storage, and browser capability are configured without displaying secrets.

Browser or website capture failure must be visibly separate from successful API evidence.

This is an internal acceptance surface, not final customer UI and not a general Evidence retrieval API.

---

## 12. Existing-System Protection

Stage A2 implementation must be additive and Evidence-owned wherever practical.

Do not alter current KYC, Pre-boarding, company-search, dossier, registry self-source, officer injection, or UBO behavior. Do not redesign UBO domain semantics.

Existing Companies House authentication, officer pagination, registry URL construction, and browser capture concepts may be reused or adapted behind bounded Evidence-owned interfaces where they fit the approved architecture. Existing callers must not be migrated or refactored merely for convenience.

Any unavoidable existing-application modification must be minimal, explicitly reported, justified, and regression tested.

---

## 13. Required Tests

Use fixtures/mocks for automated producer tests. Do not require live Companies House calls in the normal test suite.

Tests must demonstrate at minimum:

1. the A2 input contract requires `producer = companies_house` and `collection_coordinates = { jurisdiction: "GB", companyNumber: "..." }` without introducing universal company-number fields;
2. A2 does not perform name-only company matching;
3. the producer verifies that the authoritative response company number corresponds to the requested company number and does not silently associate a mismatch;
4. exact API bytes are stored and fingerprinted;
5. Officers and PSC pagination is complete;
6. resigned officers and ceased PSC source records remain preserved;
7. ownership bands are not converted into exact percentages;
8. HTML and screenshot are separate website Artifacts;
9. browser failure does not invalidate successful API evidence;
10. partial success persists all source outcomes correctly;
11. transactional failure leaves no partial Evidence graph;
12. retry does not duplicate the logical collection;
13. recollection creates new history despite identical hashes;
14. extracted values trace to exact Artifacts and existing schema concepts;
15. public assets remain structurally associable with multiple contexts;
16. live and fixture Lab results are unmistakably different;
17. no generalized private-evidence access is introduced;
18. existing KYC, self-source, officer injection, and UBO behavior remains unchanged.

Any separately authorized database smoke test must use a disposable test database and existing repository safety guards. Do not run A2 migrations against the normal application database during implementation verification.

---

## 14. Explicit Exclusions

Do not implement:

* name-only Companies House matching;
* other jurisdictions or producers;
* a universal producer-input schema;
* Companies House filing-history API;
* Companies House Document API;
* filing PDFs or filing-document extraction;
* incorporation, accounts, or confirmation-statement document retrieval;
* document classification;
* AI extraction of authoritative structured API data;
* screenshot AI extraction or independent verification;
* global entity resolution;
* identity discrepancy decisioning;
* full evidence reuse/freshness decisioning;
* Evidence Match or requirement satisfaction;
* Evidence Ledger or Evidence Package;
* generalized customer/private evidence ingestion or retrieval;
* legacy KYC dual-write or integration;
* UBO redesign;
* schema-versioning implementation;
* unrelated refactoring or behavior changes.

---

## 15. Completion Criteria

Stage A2 is complete when Evidence Lab and automated fixtures demonstrate:

```text
resolved Companies House collection request
        ↓
producer-neutral Collection Operation
        ↓
four independent source Acquisitions
        ↓
durable exact source Artifacts
        ↓
SHA-256 integrity + provenance
        ↓
deterministic schema-aligned Extraction Runs and values
        ↓
complete A1 lineage
        ↓
visible success, partial failure, retry, and recollection behavior
```

while preserving existing KYC, Pre-boarding, self-source, officer injection, dossier, and UBO behavior.
