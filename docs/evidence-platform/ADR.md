# Evidence Platform — Architecture Decision Log

## Purpose

This document records deliberate architectural decisions for the Evidence Platform.

The governing rule is:

> **No architecture change enters code without a named decision.**

The Architecture document defines the current target architecture.

This log explains **why significant choices were made and when they changed**.

---

# Decision Statuses

Every decision uses one of:

- **PROPOSED** — under consideration; must not yet drive architecture-changing implementation.
- **APPROVED** — authoritative.
- **REJECTED** — considered and deliberately not adopted.
- **SUPERSEDED** — previously approved but replaced by another named decision.
- **DEFERRED** — valid question but intentionally postponed.

---

# ADR-001 — Architecture Authority and Codex Decision Boundary

**Status:** APPROVED

## Context

Codex can independently infer refactors and architectural improvements while implementing the Evidence Platform.

This is valuable for implementation quality but creates a risk that deliberate domain and architectural decisions evolve implicitly through code changes.

## Decision

Architecture is governed through the Evidence Platform Architecture and this Decision Log.

Codex has implementation authority within approved architectural boundaries.

If Codex identifies a change affecting domain semantics, boundaries, ownership, lifecycle, provenance, identity, historical reconstruction, approved interfaces, or architectural invariants, it must propose the change rather than silently implement it.

## Consequence

Engineering autonomy remains high for implementation choices.

Architectural evolution becomes explicit and reviewable.

---

# ADR-002 — Evidence Is a First-Class Domain Concept

**Status:** APPROVED

## Context

Traditional KYC implementations frequently treat evidence as an attachment to a customer record, case, RFI, or workflow.

This prevents durable reuse, provenance management, and historical reconstruction.

## Decision

Evidence will be represented as a first-class domain concept with durable identity and provenance independent of the workflow that requested it.

## Consequence

Requirements, investigations, dossiers, assertions, and decisions may reference evidence rather than own its identity.

---

# ADR-003 — Source Evidence and Derived Knowledge Remain Distinct

**Status:** APPROVED

## Context

Extraction systems and AI agents can turn documents and web captures into structured facts.

Collapsing the extracted fact into the source evidence destroys an important epistemic distinction.

## Decision

The architecture will preserve meaningful distinctions between:

- source evidence;
- observations extracted from evidence;
- normalized facts/assertions;
- decisions/conclusions.

Lineage between these layers must be retained.

## Consequence

The platform can explain not only what it believes but why.

---

# ADR-004 — Historical Reconstruction Is a Core Requirement

**Status:** APPROVED

## Context

Customers, analysts, automated agents, regulators, compliance functions, and appropriately authorized investigative requests may require reconstruction of historical state.

Current-state-only persistence cannot reliably answer these questions.

## Decision

Evidence architecture must preserve sufficient historical information and relationships to reconstruct material prior states and the evidentiary basis of decisions.

## Consequence

Destructive current-state replacement should be avoided where it would destroy meaningful historical context.

---

# ADR-005 — Evidence Collection and Interpretation Are Separate Concerns

**Status:** APPROVED

## Context

Evidence acquisition and interpretation frequently occur close together technically, particularly in automated collection agents.

However, acquiring a source and determining what that source proves are different responsibilities.

## Decision

The architecture will preserve the semantic separation between evidence acquisition and evidence interpretation.

They may execute within the same runtime or workflow where appropriate, but their outputs and responsibilities must remain distinguishable.

## Consequence

Collected evidence remains usable even if extraction/interpretation logic changes later.

---

# ADR-006 — Existing KYC Behavior Is Protected During Evidence Platform Introduction

**Status:** APPROVED

## Context

Evidence Platform capabilities are being introduced into an existing KYC system.

Uncontrolled refactoring creates unnecessary implementation and operational risk.

## Decision

Evidence Platform development will be additive wherever practical.

Existing KYC behavior may only be intentionally altered through explicitly authorized work.

## Consequence

Codex must identify rather than silently resolve conflicts between target Evidence architecture and existing KYC implementation.

---

# ADR-007 — Canonical Evidence May Be Reused Across Contexts

**Status:** APPROVED

## Context

The same source artifact may be relevant to multiple requirements, investigations, facts, or dossiers.

Treating every use as an independently owned copy obscures identity and lineage.

## Decision

Canonical Evidence Asset identity will be conceptually independent of the requirement, investigation, dossier, or workflow consuming it.

Context-specific relationships will be represented separately.

## Consequence

Evidence reuse becomes possible without destroying contextual meaning.

---

# ADR-008 — Architecture Changes Require Named Decisions

**Status:** APPROVED

## Context

Architectural drift often occurs through individually reasonable implementation decisions.

## Decision

Any material change to an approved Evidence Platform architecture decision or invariant requires a named ADR before implementation.

## Consequence

The codebase cannot become the accidental source of architectural truth.

---

# New ADR Template

## ADR-XXX — [Decision Name]

**Status:** PROPOSED

**Date:** YYYY-MM-DD

**Raised by:** [Architecture Authority / Codex / Engineering / Other]

### Context

What problem or discovery created the decision?

### Observed Evidence

What has actually been established?

### Decision

What are we choosing?

### Alternatives Considered

What other approaches were considered?

### Rationale

Why is this option preferable?

### Architectural Impact

Which domains, boundaries, interfaces, invariants, or ownership rules change?

### Data / Migration Impact

What happens to existing persisted data and deployed systems?

### Compatibility Impact

Does this affect existing KYC behavior or integrations?

### Risks

What new risks are introduced?

### Decision

**APPROVE / REJECT / DEFER**

### Implementation Authorization

What implementation is now authorized as a consequence of this decision?

---

# Codex Proposal Template

When Codex believes architecture should change, it should submit:

## ARCHITECTURE CHANGE PROPOSED

**Suggested decision name:**

**Current architecture:**

**Observed problem:**

**Evidence from code/tests/runtime:**

**Proposed architecture:**

**Why this is better:**

**Affected components:**

**Migration consequences:**

**Compatibility consequences:**

**Risks:**

**Alternatives:**

**What happens if we do nothing:**

**Recommendation:**

No implementation of the proposed architectural change should occur until the decision is approved.

---

## ADR-009 — Build Evidence Platform Independently Before Legacy Integration

**Status:** APPROVED

### Context

Repository diagnosis established that evidence-related functionality currently exists across multiple fragmented mechanisms, including dossier JSON, document records, field provenance, change events, UBO evidence structures, temporary capture files, selected Blob-backed uploads, browser-local files, and an older unmerged Evidence Collection MVP.

Attempting to transform these mechanisms incrementally into the target Evidence Platform would tightly couple new platform development to existing KYC implementation details and increase migration risk.

### Decision

Evidence Platform V1 will initially be built as a new bounded module inside the existing repository and deployment ecosystem.

It will have:

* its own domain boundary;
* its own service/API boundary;
* new forward-only Evidence-specific persistence where required;
* an internal Evidence Lab/test harness;
* no dependency on the existing customer onboarding UX for demonstrating its core lifecycle.

Existing KYC and Pre-boarding evidence mechanisms will initially remain operational and unchanged.

Evidence Platform V1 must first demonstrate its architecture independently.

Once proven, existing producers and consumers will be integrated progressively through adapters and bounded integration changes.

Legacy evidence mechanisms will only be retired after replacement paths are proven.

This is a strangler migration strategy.

### Physical Architecture

Logical separation is required now.

Physical infrastructure separation is not required now.

Initially remain within the existing:

* Git repository;
* deployment ecosystem;
* database infrastructure;
* authentication/security ecosystem where appropriate.

Do not create a separate repository, database platform, microservice estate, or deployment stack merely to achieve logical separation.

The architecture should preserve the option for later physical separation.

### Existing System Protection

During Stage A and Stage B, existing KYC and Pre-boarding behavior is a protected boundary.

Do not modify existing flows unless a Current Build Brief explicitly authorizes integration.

### Consequences

Evidence Platform development can proceed without requiring simultaneous migration of legacy evidence flows.

The platform can be tested independently.

Existing products can continue shipping.

Integration occurs later and deliberately.

Some temporary duplication between legacy evidence mechanisms and the new Evidence Platform is accepted during migration.

---

## ADR-010 — Core Evidence Domain, Capture, Reuse, and Extraction Lineage

**Status:** APPROVED

### Context

Stage A1 needs a durable model that distinguishes a business evidence need, attempts to obtain evidence, logical evidence obtained, preserved point-in-time representations, and values derived from those representations. It must support reuse and historical reconstruction without coupling collection to onboarding presentation or KYC decisioning.

### Decision

#### Evidence Requirement is a business-level need

An Evidence Requirement represents a meaningful business evidence need and may contain multiple information needs aligned to the applicable existing KYC/KYB schema. It is not one requirement per field. Evidence Platform must not create a competing vocabulary where the product schema already defines the concept. Requirements may later be partially or fully supported by evidence; detailed matching and satisfaction semantics are outside Stage A1.

#### Acquisition is distinct from evidence obtained

An Acquisition records an attempt to obtain evidence and must support successful, failed, and inconclusive outcomes. Failed and inconclusive attempts remain in the historical/audit record even when they produce no Evidence Asset. A successful Acquisition may produce zero, one, or many Evidence Assets. Acquisition must never be modeled as synonymous with Evidence Asset.

#### Evidence Asset and Artifact are separate concepts

An Evidence Asset is a distinct logical piece of evidence that can be preserved, referenced, reused, independently reasoned about, and linked to one or more Artifacts. It is not an Acquisition, raw file/blob, extracted field value, or onboarding UI document.

An Artifact is a preserved point-in-time representation of an Evidence Asset. Examples include machine-readable HTML, structured JSON/API responses, screenshots, PDFs, customer-provided documents, registry-sourced documents, and other appropriate source representations. The requirement is to preserve representation sufficient to reconstruct and verify what was observed, not to mandate HTML or every artifact type for every producer. Where appropriate, preserve both a machine-readable representation for primary extraction and a human-viewable representation for audit and independent verification.

#### Artifact integrity is explicit

Artifacts must support cryptographic fingerprinting using SHA-256 or an architecture-approved equivalent. The fingerprint demonstrates whether preserved content has changed. Fingerprint equality does not establish semantic equality of acquisitions or business context.

#### Historical evidence is append-only

Recollection does not overwrite prior evidence. The platform retains the history needed to reconstruct what was collected, when, from where, and what the source showed at that time. Newer evidence may become more current or relevant without destroying older evidence. Customer replacement evidence likewise does not erase previously self-sourced evidence; both remain with their respective provenance.

#### Physical deduplication must not erase provenance

Independent Acquisitions remain separate evidentiary facts even when they produce byte-identical Artifacts. Physical storage may later be deduplicated when safe, but A1 does not require that optimization and the model must not prevent it. Separate acquisition and provenance histories must remain intact. Fingerprint equality never grants reuse, visibility, or access. Any future physical deduplication must preserve logical access isolation.

#### Evidence may be reused

An Evidence Asset is not owned exclusively by the first Requirement, case, investigation, or onboarding context that caused its collection. It may support multiple Requirements and contexts through separate relationships without copying or re-owning the asset. Reuse eligibility is governed by acceptance policy, including freshness and staleness. Stale evidence remains historical evidence even when no longer eligible for a current freshness-sensitive Requirement. Freshness configuration and decisioning are not Stage A1 scope unless separately authorized.

Reuse eligibility also depends on provenance/access class:

* Public evidence independently obtained from public registries or publicly accessible sources may be structurally eligible for reuse across tenant/customer contexts, subject to later freshness, suitability, security, and policy rules. A1 does not implement the complete cross-tenant reuse engine, but its model must not make eligible future public-evidence reuse impossible.
* Customer-provided or otherwise private evidence is context/tenant restricted in A1 and must not be reused across unrelated tenants or customer contexts. Identical fingerprints do not authorize cross-tenant sharing or visibility.

#### Evidence records subject identity without becoming a master entity system

Evidence must be able to record the real-world subject to which it relates using available stable identifiers or references from the surrounding platform and, where appropriate, authoritative source identifiers—for example, a UK company number. The same real-world company must not automatically become a different subject merely because it appears in multiple cases or customer contexts.

A1 must not create a global master-entity/company identity system. Evidence owns the relationship between evidence and its subject; it does not own global entity resolution. If repository inspection finds no safe existing subject reference capable of meeting A1 needs without a new canonical identity decision, implementation must stop and report that issue.

#### Collection structure does not dictate product presentation

Evidence Platform records how evidence was acquired and related internally. KYC/Onboarding may present assets independently across company details, directors, ownership/UBO, required documents, or other surfaces. Evidence domain structure must not be coupled to current onboarding screens.

#### Extraction is derived from evidence and schema-aligned

An extracted value is derived from evidence and is not original evidence. Each value must retain lineage to its Extraction Run, underlying Evidence Asset, and preserved Artifact. Multiple Extraction Runs may operate on the same preserved evidence over time, and the evidence must remain independently inspectable when deterministic or AI extraction is wrong.

Primary extraction targets the finite applicable KYC/KYB schema rather than discovering unlimited “interesting information.” Evidence Platform must not create a competing field ontology where an existing schema concept is available. Sources should be captured broadly enough for later audit and re-extraction, while structured extraction remains limited to applicable schema fields supported by the source. Stage A1 establishes the lineage/data contract with fixtures and does not implement real AI extraction.

The existing configurable KYC/KYB schema remains authoritative. Extraction Run lineage should record a stable schema/version identifier when one exists. The current configurable schema has no explicit version identifier; this does not block A1. Until versioning exists, the version reference may be absent/null or use a clearly documented, non-breaking `current/latest` compatibility convention consistent with repository conventions. A1 must not invent historical version numbers, implement a schema-versioning subsystem, or fail extraction lineage merely because an explicit version is unavailable. The lineage design should allow a real version identifier to be recorded later without destructive migration or redesign where reasonably possible.

#### Independent verification must remain possible

Where multiple representations exist, the architecture must allow a later independent verification path, such as primary extraction from a machine-readable Artifact and independent re-extraction from a screenshot. Stage A1 does not implement verification workflows, triggers, model selection, comparison logic, discrepancy decisioning, or analyst routing, but must not make them impossible.

An extraction discrepancy—two extraction methods disagreeing about what the same evidence says—is distinct from an evidence discrepancy—two independently understood pieces of evidence reporting different values.

#### Evidence Platform does not own KYC decisioning or schema semantics

Evidence Platform owns evidence collection records, acquisition history, preservation, artifact integrity, provenance, extraction lineage, support for independent verification, and historical reconstruction.

KYC/Onboarding owns customer presentation and correction workflows, operative onboarding values, semantic interpretation between schema concepts, source priority for KYC questions, conflict consequences, risk decisions, analyst routing, and whether onboarding continues. For example, `registered_address` and `operating_address` are distinct concepts and are not necessarily contradictory merely because their values differ. Evidence records what was extracted; KYC/schema reasoning decides whether comparison is meaningful.

The intended product strategy is to self-source where possible, permit customer replacement evidence when self-sourced evidence is unavailable, unsuitable, outdated, or contested, and allow KYC to select the operative evidence/value while Evidence Platform retains both histories and their provenance. Stage A1 supports this historical story but does not implement customer workflow behavior.

### Consequences

Stage A1 may establish model contracts and bounded persistence for:

```text
Evidence Requirement
        ↓
Acquisition
        ↓
Evidence Asset
        ↓
Artifact
        ↓
Provenance + Integrity
        ↓
Extraction Run
        ↓
Schema-aligned extracted values
```

Real producers, AI extraction, independent verification, matching, satisfaction, ledger, packaging, and KYC integration remain later-stage work.

Exact table names, internal API/service names, lifecycle enum names, migration mechanics, and reversible code organization remain implementation decisions within the approved architecture. Detailed retention/deletion policy, storage-provider optimization/selection beyond minimum A1 need, source-specific trust ranking, detailed freshness semantics, the full cross-tenant reuse engine, global entity resolution, and schema-versioning implementation are deliberately deferred and must not be solved during A1.

---

## ADR-011 — Companies House Collection Producer, Partial Success, and Collection Identity

**Status:** APPROVED

### Context

Stage A1 established Evidence Requirement, Acquisition, Evidence Asset, Artifact, integrity, public/private access classification, and extraction lineage. It did not establish a real producer or a durable parent identity for a multi-source collection operation.

Stage A2 introduces Companies House as the first real producer. One requested collection may obtain six materially distinct source areas: Company Profile API, Officers API, PSC API, the public Company Overview website, the public Officers website, and the public PSC website. These source areas can succeed or fail independently. Real producer retries must be distinguished from intentional recollection, and identical artifact hashes must not collapse acquisition history.

### Decision

A Companies House collection is one producer operation with durable collection identity and multiple independent Evidence Acquisitions.

The core Evidence Collection Operation is producer-neutral. It records a stable producer request key, producer-specific structured collection coordinates, an optional subject reference where safely established, live/fixture mode, lifecycle status, timestamps, and failure context. It does not define universal company-number fields or a universal producer-input schema.

For Stage A2 only, the Companies House producer input contract is:

```text
producer = companies_house
collection_coordinates = { jurisdiction: "GB", companyNumber: "..." }
```

The Companies House company number is a producer-specific collection identifier and authoritative source coordinate, not a mandatory global Evidence Platform subject identifier. Future producers may use different coordinates, including source-specific identifiers, URLs, legal name plus jurisdiction, licence or certificate references, or other source-appropriate inputs. The broader multi-jurisdiction and multi-producer input model is deferred. A2 must not structurally prevent those future contracts and must not design them now.

The responsibility boundary is:

```text
KYC / Onboarding responsibility
identify subject → resolve ambiguity/conflict → determine appropriate source and collection coordinates

Evidence Platform responsibility
receive resolved collection request → acquire → preserve → fingerprint → extract → maintain provenance
```

A2 does not implement name-only Companies House matching. A supplied Companies House collection request goes directly to the authoritative Companies House identity using the requested `GB` company number. The Companies House producer must verify that the company number represented by the authoritative Companies House response corresponds to the company number requested. If it does not, the response must not be silently associated with the requested subject. No further identity resolution or discrepancy decisioning is performed by Evidence.

Repeating the same producer request key is a retry of the same logical collection. An intentional recollection uses a new request key and creates new historical acquisitions and evidence even when source bytes are unchanged.

Company Profile API, Officers API, PSC API, Company Overview website, Officers website, and PSC website are six separate Acquisitions. The API and website retrievals retain separate provenance and produce separate Evidence Assets; Officers or PSC website Artifacts must not be attached to the corresponding API Evidence Asset. A successful Acquisition may produce its corresponding Evidence Asset and Artifacts. A failed or inconclusive Acquisition remains durable history. A partially completed website capture may retain its successfully preserved Artifacts while recording the missing or failed representation and marking that website capture incomplete.

Company Profile, Officers, and PSC API acquisitions remain the authoritative structured source evidence. Website acquisitions provide supplementary human-viewable point-in-time evidence. Browser availability or website failure does not invalidate or downgrade otherwise successful authoritative API evidence. Collection and product presentation distinguish structured-evidence completeness from human-viewable-capture completeness, including complete, incomplete, or unavailable human-viewable capture.

For structured Companies House APIs, exact response-body bytes are the primary machine-readable Artifacts and are fingerprinted with SHA-256. Paginated Officers and PSC responses are preserved page-by-page. Rendered website HTML and screenshot bytes are separate Artifacts on their applicable separate website Evidence Asset. The intended complete website package contains both representations and preserves each representation's observable outcome. If HTML succeeds but screenshot creation fails, the HTML remains preserved, the screenshot failure is recorded, and the website capture is incomplete rather than falsely complete. Equivalent semantics apply to other partial website-capture failures.

Officers and PSC website acquisitions follow every explicit Companies House pagination link necessary to preserve the complete human-viewable source representation. First-page-only capture is not complete when additional pages are explicitly present. Each page preserves its URL, ordering, capture time, Artifact fingerprint, and relevant non-secret retrieval metadata.

PSC website acquisition preserves the legitimate state Companies House presents, including current PSCs, ceased PSCs, PSC statements, no registrable PSC, and unavailable or exempt PSC information. A statement or exemption page is valid source evidence and is not a capture failure merely because it displays no PSC person.

Website evidence does not replace, strengthen by assumption, or impersonate API evidence. A2 does not extract or compare webpage facts. Preserving these pages supports point-in-time reconstruction now and possible independently authorized extraction and API-to-web verification later without recollecting the historical webpage.

Source representations are preserved before deterministic schema-aligned extraction. Derived values retain lineage to the applicable Artifact and do not rewrite source facts. Ownership bands remain bands or explicitly identified minimums and are not converted into false exact percentages.

Companies House evidence is public independently self-sourced evidence and may later be associated with multiple contexts without copying the canonical Asset, subject to separately authorized acceptance and freshness rules.

The final A1 evidence graph for a collection is persisted transactionally. Artifact storage and database persistence must use deterministic retry-safe identities so a persistence retry does not create uncontrolled duplicates. SHA-256 equality does not define Acquisition identity, Asset identity, authorization, semantic equivalence, or reuse eligibility.

Stage A2 does not create a general evidence retrieval service, private-evidence API, filing/document producer, UBO redesign, matching engine, satisfaction engine, freshness engine, or KYC integration.

### Consequences

Stage A2 requires a small durable, producer-neutral collection-operation and idempotency boundary, transactional A1 graph persistence, durable artifact storage, an Evidence-owned Companies House producer, deterministic API extractors, and an internal Evidence Lab acceptance surface. One browser session may be reused across website captures as an implementation optimization, but each webpage remains a separate Acquisition, Evidence Asset, and provenance history.

Successful source areas survive and remain valid when another source area fails. Supplementary website failure does not downgrade authoritative structured evidence completeness. Intentional recollection creates new history. Existing KYC, self-source, and UBO behavior remains unchanged.

---

## ADR-012 — Evidence Interpretation, Discovered Facts, and Verification Lineage

**Status:** PROPOSED FOR ARCHITECTURE AUTHORITY REVIEW

### Context

Stages A1 and A2 established preserved Artifacts, integrity, provenance, deterministic Extraction Runs, schema-aligned extracted values, and immutable recollection history. Stage A3 must turn preserved evidence into evidence-grounded facts using deterministic and semantic methods while preserving the differences between source evidence, source facts, derived interpretations, extraction attempts, verification attempts, and downstream KYC or compliance decisions.

The current A1 persistence model requires every extracted value to carry a non-null `schema_field_id`. That is sufficient for A1/A2 schema-aligned extraction, but it cannot honestly represent a discovered KYC/KYB-relevant fact for which no configured information need or schema field exists. A1 Extraction Runs can represent multiple attempts against preserved Artifacts, but derived facts also need explicit lineage to their input fact or facts and to the transformation or classification that produced them.

### Decision

#### A3 is an interpretation and verification-lineage layer, not a decision engine

A3 determines what preserved evidence says, identifies relevant source facts, records explicitly permitted derived facts, assesses how strongly the evidence supports each result, and supports selective independent verification. It does not determine requirement satisfaction, choose a winning source or value, decide whether a customer is correct, route analysts, assess risk, or decide whether onboarding proceeds.

#### Upstream schema and information needs remain authoritative

A3 may receive subject/context, jurisdiction, applicable schema context, requested information needs, and source/producer context from an upstream KYC/KYB process. The final KYC-to-Evidence integration contract remains deferred. Where supplied, existing configurable KYC/KYB schema concepts and information needs are authoritative; Evidence must not create a parallel customer schema or silently alter the configured schema.

If a real schema version is supplied, preserve it. If none exists, lineage may retain a null/absent version or an approved non-breaking current/latest convention. Do not fabricate historical versions or build schema versioning in A3.

#### Extraction is semantic where needed and deterministic where reliable

A3 must not be limited to literal field-name matching. It may recognize semantic relevance between source terminology and a requested concept, but it must not silently equate non-equivalent concepts.

Deterministic extraction remains preferred for reliably addressable structured values. AI is appropriate where it adds value for unstructured documents, rendered webpages, images, screenshots, ambiguous labels, semantic concept mapping, discovered-fact identification, or explicitly permitted derivation. Deterministic and AI Extraction Runs use common lineage semantics. A3 must not introduce AI merely to reinterpret structured values that code can extract reliably.

#### Schema-directed and discovered facts are distinct

A3 supports both:

* schema-directed extraction, which seeks facts responsive to supplied information needs; and
* bounded discovery of additional facts reasonably relevant to KYC/KYB/compliance.

A discovered fact must be explicitly distinguishable from a requested fact. It does not create or modify a customer schema field, become a KYC requirement, satisfy an existing requirement, or change an onboarding form. It may leave Evidence as additional qualified information for downstream systems to evaluate.

Discovery is bounded to information reasonably relevant to the supplied KYC/KYB/compliance context. A3 does not extract every piece of incidental content and does not freeze a universal closed list of relevant facts.

Because the A1 extracted-value structure requires a schema field, A3 requires an additive persistence extension that can represent a discovered concept without inventing a fake schema field or information-need identifier. Exact table names, concept-reference representation, and internal contracts are implementation details, but requested-versus-discovered status and any authoritative external concept reference must remain explicit.

#### Source facts and derived facts remain distinct

A direct/source fact records what the preserved evidence itself states. A derived fact records an interpretation, classification, normalization, or transformation and must never be represented as though the source stated it directly.

A3 requires additive lineage capable of relating a derived fact to its input source fact or facts, source Artifact or Artifacts, producing Extraction Run, transformation/classification identity and version where available, derived value, and derivation time. Exact relationship and table names are implementation details. Inventing a schema field or flattening the derivation into a direct extracted value is prohibited.

#### Source trust and extraction support are independent

Source trust asks how authoritative or reliable a source is for the applicable business purpose. Extraction support asks how strongly the captured evidence supports the produced value or interpretation. They must not be combined into one confidence score or derived mechanically from one another.

A3 may carry source identity, producer identity, and supplied policy context. It does not hard-code universal source-trust tiers, redesign legacy KYC source steering, or treat Companies House, a customer upload, or any other provision channel as inherently authoritative for every jurisdiction and information need. Provision channel, document issuer/source identity, and source authority remain distinct.

Extraction support must be explainable and able to reflect readability, direct versus derived grounding, extraction method, reading certainty, semantic ambiguity, multiple plausible values, and independent-verification outcome where applicable. A3 supports downstream semantics equivalent to:

```text
SUPPORTED
SUPPORTED_WITH_QUALIFICATION
NEEDS_VERIFICATION
NOT_SUPPORTED
```

Exact internal names may follow repository conventions. These are evidence-support states, not source-trust tiers. A qualified or tentative value may be returned downstream with its qualifier; downstream KYC owns presentation and acceptance.

#### Independent verification is selective and preserves every attempt

A3 supports on-demand independent re-extraction or verification without automatically running a second AI extraction for every value. Triggers may include degraded evidence, weak grounding, multiple plausible readings, material semantic ambiguity, an explicit downstream request, or a customer contest. Numerical thresholds and automatic calibration remain deferred.

Where practical, an independent verifier inspects preserved evidence without being anchored on the first extractor's answer. Every Extraction Run and verification attempt remains immutable and reconstructable, including disagreements and errors. A later run or correction never rewrites an earlier run. Evidence reports lineage and disagreement; it does not decide which value wins.

Existing A1 Extraction Runs are extended rather than replaced. A3 may require additive relationships or metadata to identify independent verification, the run or fact being examined, and the verification outcome without collapsing either run. The implementation must stop for Architecture Authority if this cannot be achieved without weakening A1/A2 history.

#### Extractor and model lineage is durable

Each run preserves, where applicable, extractor type, deterministic-versus-AI method, provider/model and model version, prompt/instruction or extractor version/reference, extraction context, source Artifact or Artifacts, start/completion times, output, support assessment, and failure state. Secrets and credentials are never stored.

The lineage must permit later analysis of disagreement and error rates by extractor/model/version without requiring destructive redesign. A3 does not build analytics dashboards, training pipelines, fine-tuning, automatic prompt optimization, or automatic schema recommendations.

#### Temporal provenance remains event-specific

A3 builds on A1/A2 acquisition, observation, capture, and storage lineage rather than duplicating or restamping it. It separately records extraction start/completion and independent-verification time where applicable. Reuse or re-extraction never changes the historical observation or Artifact capture time: evidence captured on Monday and extracted on Friday remains represented as those two different events.

Customer confirmation and correction times remain downstream KYC concerns unless a future integration explicitly returns them to Evidence.

#### Downstream output remains qualified and reconstructable

A3 outputs preserve enough information for a later downstream contract to expose, where applicable: value, source/producer, evidence reference, source observation/capture time, extraction time, extraction-support state, requested-versus-discovered status, and direct/source-versus-derived status. The final KYC UI and integration contracts remain out of scope.

#### Bounded real-Artifact integration completes the A3 acceptance boundary

A3 must be capable of interpreting an existing persisted Artifact previously produced by A2. The real execution path identifies the persisted Artifact and appends a new immutable Extraction Run and its facts, derivations, or verification relationships against the existing A1/A2 foreign keys. It must not recollect the source, recreate or re-persist the Acquisition, Evidence Asset, Artifact, or complete A1/A2 graph, or alter the Artifact identity, capture/observation timestamps, storage reference, or fingerprint. The existing deterministic fixture bundle path may remain for repeatable tests and demonstrations.

Artifact retrieval is an internal server-side Evidence capability. Given an authorized Artifact identity and context, the server resolves the Artifact metadata, Evidence Asset, Acquisition/source provenance, subject/context where applicable, storage reference, media/representation type, capture/observation time, stored SHA-256 fingerprint, and relevant supplied extraction context. It loads bytes from an authorized Evidence storage provider and verifies those exact bytes against the persisted fingerprint before interpretation. The browser must not resubmit bytes and have them treated as the authoritative preserved Artifact. Storage references, filesystem paths, credentials, database credentials, and unrestricted file-reading capability must not be exposed to the browser or semantic provider. Missing, inaccessible, unavailable, or fingerprint-mismatched evidence must not be interpreted as valid evidence or produce fabricated facts.

A3 may add bounded read capability to supported Evidence storage providers and a provider-neutral media-aware interpretation request capable of carrying Artifact identity, media and representation type, exact verified bytes or protected server-side content, optional decoded text or structured representation, extraction context, and requested concepts. Provider-specific message formats must remain inside adapters rather than the Evidence domain or persistence model.

One optional real semantic AI provider adapter is authorized for local Evidence Lab acceptance. Provider, model, and instruction lineage remains durable under this ADR; credentials remain environment-only, are never committed or displayed, and are never returned by configuration endpoints or stored in facts/provenance. The deterministic fixture provider remains available and paid AI calls are not required by automated regression tests. The initial real path may support Companies House structured JSON and rendered HTML Artifacts. Screenshot/image interpretation is architecturally permitted through the same media-aware boundary, but it may remain a controlled follow-on if proper image support is materially larger than the bounded integration; screenshot bytes must not be forced through a text-only contract or represented as interpreted when they were not.

A2 deterministic values in `evidence_extracted_values` retain their original A2 Extraction Run and Artifact lineage. The real A3 path must not automatically duplicate those values into new A3 facts merely for representational consistency. A unified read projection may present A2 deterministic values beside A3 facts without fabricating a new extraction event, but materializing or backfilling all A2 values into the A3 fact model is not authorized. AI remains appropriate only where semantic interpretation, bounded discovery, or explicit derivation adds value; reliably addressable Companies House structured values remain on the A2 deterministic path.

The isolated Evidence Lab may prove the bounded journey from a real A2 collection to selection of an eligible persisted Artifact, server-side retrieval and integrity verification, a new A3 interpretation, and display of facts and complete lineage. A live result must identify its `LIVE PRESERVED ARTIFACT` input mode, collection, Evidence Asset, Artifact and type, source/producer, capture and extraction timestamps, extraction method/provider, requested/discovered/derived facts where produced, support state/signals, and provenance. The fixture demonstration must instead be explicitly labelled `A3 SYNTHETIC FIXTURE SCENARIOS`, state that it uses built-in ABC Limited evidence and does not use the preceding A2 collection, state that no live Artifact is selected, and use action wording equivalent to `Run synthetic A3 fixture scenarios`.

For a real Artifact captured on Monday and interpreted on Friday, Monday remains the observation/capture time and Friday is the new extraction time. A later deliberate interpretation of the same Artifact with a new model, prompt, or context may create another immutable Extraction Run. A retry of a failed execution, an idempotent replay, and a deliberate later re-interpretation must not be silently conflated. Exact idempotency mechanics remain an implementation detail unless they require a new material run-identity policy, in which case implementation must stop for Architecture Authority.

The real path must report truthful outcomes for Artifact not found, unauthorized Artifact/context access, storage unavailability, fingerprint mismatch, unsupported media type, provider unavailability, authentication failure, timeout, malformed provider output, no supported facts, and database persistence failure. Failures must not mutate or delete A2 evidence, fabricate facts, or silently claim success, and failure lineage must be preserved where appropriate.

This bounded A2-to-A3 path is Evidence Platform integration, not KYC integration. It does not authorize matching, satisfaction, source-winner or trust-policy decisions, customer/analyst decisioning, schema mutation, bulk reinterpretation, analytics/model evaluation infrastructure, Ledger, Package, DRS, or later roadmap stages.

#### Relationship to ADR-010 and ADR-011

ADR-012 refines ADR-010's A1-stage limitation that structured extracted values remain confined to applicable schema fields. Schema-directed facts remain schema-aligned, but A3 may additionally preserve explicitly marked discovered facts through the additive extension above. This is not permission to create or modify KYC schema concepts.

ADR-010 assigns downstream semantic comparison and KYC business meaning to KYC/Onboarding. A3 does not take that responsibility. Its semantic work is limited to explaining what evidence directly says, how source terminology relates to a supplied concept, and how an explicitly identified derivation was produced. KYC continues to decide whether concepts are operationally equivalent, conflicting, acceptable, or useful for a decision.

ADR-011's description of Companies House APIs as authoritative structured source evidence remains the approved A2 collection and presentation boundary. It does not establish a universal A3 source-trust tier for every jurisdiction, information need, tenant, or business policy. A3 preserves that provenance and any supplied policy context without deriving extraction support from it.

### Consequences

A3 extends the existing Evidence domain; it does not create a parallel extraction subsystem. The A1/A2 Artifact, Extraction Run, extracted-value, integrity, reuse, recollection, and access semantics remain authoritative.

A3 acceptance now includes appending a real interpretation to an existing persisted A2 Artifact through server-authoritative storage retrieval and SHA-256 verification. This requires a bounded Artifact read path and append-only repository/service path, but no Evidence-domain redesign. Existing A2 deterministic extraction is not duplicated, provider-neutrality is retained, and fixture execution remains available for deterministic tests.

An additive schema extension is required for discovered facts that have no configured schema destination. An additive lineage relationship is also required for derived facts and may be required to make independent verification relationships explicit. These extensions must preserve current A1/A2 records and cannot require fake schema concepts, fake information needs, or destructive rewriting.

Implementation may choose reversible module organization, table and internal enum names consistent with these semantics, fixture organization, internal API naming, and prompt/extractor packaging. Implementation must stop for Architecture Authority before changing schema meanings, automatically adopting discovered facts into KYC, combining source trust with extraction support, defining universal trust tiers, selecting a winning fact, changing downstream KYC behavior, coupling irreversibly to an AI provider, changing A1/A2 identity/reuse semantics, or weakening historical provenance.

Stage A3 explicitly excludes final KYC integration, KYC UI integration, legacy source-steering redesign, universal trust policy, admin trust configuration, matching and satisfaction, conflict resolution, customer/analyst/risk decisioning, Ledger, Package, DRS, automatic schema expansion, global entity resolution, broad document-authenticity determination, automatic verification of every result, numerical confidence calibration, AI training, and a source-specific optimization library.
