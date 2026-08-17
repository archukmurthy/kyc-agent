# Evidence Platform — Current Build Brief

# Stage A2 — Companies House Evidence Producer

## 1. Objective

Implement the first real Evidence Platform producer. Given a resolved UK Companies House collection request, independently acquire, preserve, fingerprint, and deterministically extract authoritative Company Profile, complete Officers, and complete PSC API evidence, and preserve supplementary human-viewable Company Overview, Officers, and PSC website evidence into the Stage A1 Evidence domain.

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

One durable, producer-neutral Evidence Collection Operation coordinates six independent Companies House Acquisitions:

1. Company Profile API;
2. Officers API;
3. PSC API;
4. Company Overview website;
5. Officers website;
6. PSC website.

The Collection Operation is an orchestration, lifecycle, and idempotency boundary. It is not an Evidence Asset and does not replace Evidence Acquisition.

Each source records success, failure, incomplete capture, or inconclusive outcome as applicable and independently. Structured-evidence completeness and supplementary human-viewable-capture completeness must remain separately observable. Browser availability or website failure must not determine or downgrade authoritative API completeness.

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
        ├── Company Overview Website Acquisition
        │      └── Company Overview Website Evidence Asset
        │             ├── Rendered HTML Artifact
        │             └── Screenshot Artifact
        │
        ├── Officers Website Acquisition
        │      └── Officers Website Evidence Asset
        │             ├── Page 1 HTML Artifact
        │             ├── Page 1 Screenshot Artifact
        │             ├── Page 2 HTML Artifact
        │             ├── Page 2 Screenshot Artifact
        │             └── ...
        │
        └── PSC Website Acquisition
               └── PSC Website Evidence Asset
                      ├── Page 1 HTML Artifact
                      ├── Page 1 Screenshot Artifact
                      └── ...
```

A failed or inconclusive Acquisition remains in the historical record and normally produces no Evidence Asset. When a website acquisition preserves one representation but another fails, retain the successful Artifact and its Evidence Asset, record the failed representation, and mark the website capture incomplete.

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

### Officers Website

Collect the public Companies House Officers page as a separate Acquisition and Evidence Asset from the Officers API. Follow all explicit Companies House pagination necessary to preserve the complete human-viewable source representation. Preserve rendered HTML and screenshot Artifacts for every page. First-page-only capture is not complete when additional pages are explicitly present.

### PSC Website

Collect the public Companies House persons-with-significant-control page as a separate Acquisition and Evidence Asset from the PSC API. Follow all explicit Companies House pagination necessary to preserve the complete human-viewable source representation. Preserve rendered HTML and screenshot Artifacts for every page.

Preserve the legitimate state Companies House presents, including current PSCs, ceased PSCs, PSC statements, no registrable PSC, and unavailable or exempt PSC information. A statement or exemption page is valid source evidence and is not a capture failure merely because no PSC person is displayed.

Company Profile, Officers, and PSC API acquisitions remain the authoritative structured source evidence. Website evidence is supplementary. API and website provenance must not be collapsed, and Officers or PSC website Artifacts must not be attached to the corresponding API Evidence Asset.

---

## 5. Artifact Preservation and Integrity

For Company Profile, Officers, and PSC, preserve exact HTTP response-body bytes before interpretation wherever safely available. If runtime behavior requires serialization after parsing, use and document one deterministic canonical serialization at receipt time; hash and store those exact bytes rather than a later reconstruction.

Preserve every Officers and PSC page as a distinct Artifact on its applicable Evidence Asset. Record page order and non-secret request/response metadata sufficient to reconstruct the acquisition.

For website capture:

* preserve post-render DOM serialization as a rendered HTML Artifact encoded deterministically;
* preserve exact screenshot bytes as a separate screenshot Artifact;
* identify both as website representations, not API representations;
* preserve page URL, page order, capture time, Artifact fingerprint, and relevant non-secret retrieval metadata;
* follow all explicit Officers and PSC website pagination required for complete capture;
* preserve separately observable HTML and screenshot outcomes.

The intended complete website evidence package contains both HTML and screenshot representations for every applicable page. If HTML succeeds but screenshot creation fails, retain the successfully preserved HTML, record the screenshot failure, and mark the website acquisition/capture incomplete rather than falsely complete. Apply equivalent semantics to other partial website-capture failures. Do not weaken successful API evidence.

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

A2 does not require or authorize AI extraction from website evidence, independent screenshot or HTML re-extraction, or API-to-webpage comparison. Website preservation supports point-in-time reconstruction now and future independently authorized verification without requiring recollection of the historical webpage.

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

## 9. Independent Structured and Website Outcomes

Failure of one source area must not invalidate evidence successfully acquired from another source area.

For example:

```text
Profile API:  SUCCESS
Officers API: SUCCESS
PSC API:      SUCCESS
Overview website: SUCCESS
Officers website: FAILED — CAPTCHA
PSC website:      INCOMPLETE — HTML preserved; screenshot failed
```

must result in:

* structured evidence reported as complete, with durable Profile, Officers, and PSC API evidence and complete lineage;
* human-viewable capture reported as incomplete;
* a failed Officers website Acquisition with its reason and no Officers website Evidence Asset;
* a PSC website Evidence Asset retaining its successfully preserved HTML, an observable screenshot failure, and an incomplete capture outcome;
* no invalidation or downgrade of the successful authoritative API evidence.

Collection and product presentation must distinguish:

```text
Structured evidence: complete / partial / failed / inconclusive
Human-viewable capture: complete / incomplete / unavailable
```

Failure of the Overview, Officers, or PSC website acquisition must not determine authoritative API completeness. Successful source areas always survive and remain valid when another source area fails.

If expected API or website pagination cannot be completed, the applicable Acquisition must not be represented as successful complete evidence. This does not change the outcome of its independently acquired counterpart.

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
* current and ceased PSC records and source ownership bands without false exact percentages;
* structured-evidence completeness separately from human-viewable-capture completeness;
* every Overview, Officers, and PSC website page, including page order and separate HTML/screenshot outcomes;
* legitimate PSC statement, no-registrable-PSC, and unavailable or exempt website states without misrepresenting them as capture failures.

For live mode, report whether required credentials, database, durable artifact storage, and browser capability are configured without displaying secrets.

Browser or website capture failure must be visibly separate from successful API evidence and must not downgrade authoritative API completeness.

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
8. Company Overview, Officers, and PSC websites are separate Acquisitions and Evidence Assets from their API counterparts;
9. complete Officers and PSC website pagination preserves HTML and screenshot Artifacts for every explicit page;
10. HTML and screenshot outcomes are separately observable, and a partial capture retains successful Artifacts while remaining incomplete;
11. current and ceased PSCs, PSC statements, no registrable PSC, and unavailable or exempt PSC pages are preserved as legitimate website evidence states;
12. browser failure does not invalidate or downgrade successful authoritative API evidence;
13. structured-evidence completeness and human-viewable-capture completeness are presented separately;
14. partial success persists all source outcomes correctly;
15. transactional failure leaves no unexplained partial Evidence graph;
16. retry does not duplicate the logical collection;
17. recollection creates new history despite identical hashes;
18. extracted values trace to exact API Artifacts and existing schema concepts;
19. no website extraction or API-to-web comparison is introduced;
20. public assets remain structurally associable with multiple contexts;
21. live and fixture Lab results are unmistakably different;
22. no generalized private-evidence access is introduced;
23. existing KYC, self-source, officer injection, and UBO behavior remains unchanged.

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
* deterministic extraction from preserved website HTML or screenshots;
* API-to-webpage fact comparison;
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
six independent source Acquisitions
        ↓
durable exact source Artifacts
        ↓
SHA-256 integrity + provenance
        ↓
deterministic schema-aligned Extraction Runs and values
        ↓
complete A1 lineage
        ↓
separately visible structured completeness, human-viewable capture completeness, partial failure, retry, and recollection behavior
```

while preserving existing KYC, Pre-boarding, self-source, officer injection, dossier, and UBO behavior.
