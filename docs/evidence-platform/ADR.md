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

**Status:** APPROVED

**Implementation:** Stage A3 accepted and implemented in `b1a23dfe8ba871c089c67e0203e527fce32854a9`.

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

#### Same-Evidence-Asset multi-Artifact interpretation is an A3 input boundary

One logical Evidence Asset may contain multiple preserved Artifacts that together form the meaningful interpretation input, including ordered registry pages, paginated API responses, multi-page web captures, and other multi-part source material. A3 may interpret either one Artifact or an explicitly selected coherent set of existing Artifacts belonging to the same Evidence Asset. The Evidence Asset is the grouping boundary for this A3 increment. A3 must not automatically combine Artifacts from different Evidence Assets, acquisitions, recollections, contexts, or API and website Evidence Assets, or combine public and private evidence merely because it concerns the same subject.

This uses the existing Evidence Asset and Artifact identities and the existing ability for one Extraction Run to reference multiple input Artifacts. It does not create a document identity, page-bundle identity, global document abstraction, source-specific pagination object, or second Evidence Asset concept.

Every input Artifact must be resolved and authorized server-side, loaded from authoritative Evidence storage, and independently verified against its persisted SHA-256 fingerprint before provider execution. Each retains its own source provenance, capture timestamp, representation identity, and Artifact boundary. Browser-supplied paths, storage references, bytes, fingerprints, or credentials are not authoritative. If the existing same-Evidence-Asset access model cannot safely authorize every selected input without inventing a cross-context access policy, implementation must stop for Architecture Authority.

Where persisted source ordering or page ordering exists, A3 may construct the provider input in that order. It must not invent source-specific ordering in the generic A3 layer. If ordering is absent or ambiguous and materially affects interpretation, A3 must report that limitation rather than fabricate an order.

Input completeness and extraction completeness remain explicit. When an Evidence Asset is known to contain a required ordered set, interpreting fewer than that complete set cannot be represented as complete interpretation of the Evidence Asset. Missing, unreadable, unauthorized, unverifiable, skipped, sampled, truncated, or provider-limited inputs must remain observable through the existing complete/incomplete, limitations, and support semantics. Required-input failure must not silently produce a complete result.

The provider-neutral boundary may receive a coherent ordered set of verified Artifact inputs. Each input retains sufficient identity and representation context for the provider and normalizer to distinguish Artifact boundaries. The provider may reason across the selected Evidence Asset input, but every resulting fact must identify the Artifact or Artifacts that actually support it; unsupported cross-Artifact inference must not be represented as a directly stated source fact.

#### Facts retain precise Artifact support lineage

Extraction Run input lineage alone does not establish that every fact is supported by every input Artifact. A3 therefore authorizes an additive, immutable Fact-to-Artifact support relationship where the current single `artifact_id` cannot represent support honestly. One fact may be supported by one Artifact or multiple Artifacts without duplicating the fact. Existing single-Artifact facts remain valid. Source Artifacts remain unchanged, and the implementation must not fabricate support merely because an Artifact participated in the run. Exact relationship, table, and API names remain implementation details. If persistence is required, use a new additive forward-only migration; do not modify migration 012.

#### Exact raw provider exchange remains deferred

Exact AI request/response persistence is not authorized in this increment. Current A3 lineage continues to preserve input Artifact identities, provider, model, instruction/extractor reference, extraction timestamps, normalized outcomes, persisted facts, and support/completeness metadata, but must not claim byte-for-byte provider-response reconstructability. Policy for duplication of private evidence, request and response retention, access inheritance across multiple inputs, encryption/redaction, retention/deletion, and malformed or failed response retention remains deferred to the Production Readiness Register and a later Architecture Authority decision.

#### Relationship to ADR-010 and ADR-011

ADR-012 refines ADR-010's A1-stage limitation that structured extracted values remain confined to applicable schema fields. Schema-directed facts remain schema-aligned, but A3 may additionally preserve explicitly marked discovered facts through the additive extension above. This is not permission to create or modify KYC schema concepts.

ADR-010 assigns downstream semantic comparison and KYC business meaning to KYC/Onboarding. A3 does not take that responsibility. Its semantic work is limited to explaining what evidence directly says, how source terminology relates to a supplied concept, and how an explicitly identified derivation was produced. KYC continues to decide whether concepts are operationally equivalent, conflicting, acceptable, or useful for a decision.

ADR-011's description of Companies House APIs as authoritative structured source evidence remains the approved A2 collection and presentation boundary. It does not establish a universal A3 source-trust tier for every jurisdiction, information need, tenant, or business policy. A3 preserves that provenance and any supplied policy context without deriving extraction support from it.

### Consequences

A3 extends the existing Evidence domain; it does not create a parallel extraction subsystem. The A1/A2 Artifact, Extraction Run, extracted-value, integrity, reuse, recollection, and access semantics remain authoritative.

A3 acceptance now includes appending a real interpretation to one existing persisted A2 Artifact or an explicitly selected coherent set of Artifacts from the same Evidence Asset through server-authoritative storage retrieval and independent SHA-256 verification. This requires bounded Artifact read paths and an append-only repository/service path, but no new Evidence identity. Existing A2 deterministic extraction is not duplicated, provider-neutrality is retained, and fixture execution remains available for deterministic tests.

An additive schema extension is required for discovered facts that have no configured schema destination. Additive lineage relationships are also required for derived facts and precise Fact-to-Artifact support, and may be required to make independent verification relationships explicit. These extensions must preserve current A1/A2 records and cannot require fake schema concepts, fake information needs, duplicated facts, modification of migration 012, or destructive rewriting.

Implementation may choose reversible module organization, table and internal enum names consistent with these semantics, fixture organization, internal API naming, and prompt/extractor packaging. Implementation must stop for Architecture Authority before changing schema meanings, automatically adopting discovered facts into KYC, combining source trust with extraction support, defining universal trust tiers, selecting a winning fact, changing downstream KYC behavior, coupling irreversibly to an AI provider, changing A1/A2 identity/reuse semantics, or weakening historical provenance.

Stage A3 explicitly excludes final KYC integration, KYC UI integration, legacy source-steering redesign, universal trust policy, admin trust configuration, matching and satisfaction, conflict resolution, customer/analyst/risk decisioning, Ledger, Package, DRS, automatic schema expansion, global entity resolution, broad document-authenticity determination, automatic verification of every result, numerical confidence calibration, AI training, and a source-specific optimization library.

---

## ADR-013 — Evidence-to-Need Evaluation and the A4a/A4b Boundary

**Status:** APPROVED

**Date:** 2026-08-19

**Raised by:** Architecture Authority

### Context

Stages A1–A3 establish Evidence Requirements, schema-aligned Information Needs, immutable Evidence Assets and Artifacts, Extraction Runs, requested and discovered Facts, direct and derived grounding, extraction-support states, independent-verification lineage, and precise Fact-to-Artifact support.

They do not establish a durable evaluation of how a Fact relates to an Information Need. Existing relationships must not be misread as that evaluation: an Asset associated with a Requirement is not proof of satisfaction; a requested Fact carrying schema or Information Need lineage is not an acceptance result; A3 extraction support describes whether evidence supports a Fact, not whether KYC accepts that Fact for a requirement.

The previously contemplated Stage A4 combined candidate matching, evidence coverage, conflict assessment, requirement satisfaction, and operative-value selection. Repository diagnosis established that these responsibilities require different semantics and ownership. In particular, Information Needs do not yet express scalar-versus-collection shape, cardinality, complete-set or legitimate-empty-set semantics, requiredness, temporal scope, freshness, or source suitability. Final KYC satisfaction and operative-value selection are downstream business decisions under ADR-010 and ADR-012.

### Decision

#### Stage A4 is split at a semantic boundary

Stage A4 is divided into:

* **A4a — Fact-to-Information-Need Evaluation**, which evaluates how an immutable Evidence Fact relates to an explicitly supplied Information Need; and
* **A4b — Coverage, Conflict, and Provisional Requirement Assessment**, which may later reason across candidate evaluations once the required collection, cardinality, temporal, source-policy, and aggregation semantics are separately governed.

A4a may be implemented only through a separately authorized build task. A4b is not authorized for implementation by this decision.

#### Three meanings remain separate

The platform must preserve three distinct concepts:

```text
A3 Evidence Support
= does preserved evidence support this Fact?

A4a Evidence-to-Need Evaluation
= does this Fact address this supplied Information Need?

Downstream KYC Satisfaction
= is this evidence acceptable and sufficient under current KYC policy?
```

No status, score, or projection may collapse these meanings.

#### Evidence-to-Need Evaluation is immutable and relational

A4a introduces the architectural concept of an immutable **Evidence-to-Need Evaluation**. Exact internal names remain an implementation detail.

An evaluation relates:

```text
immutable Fact
      ↓
explicitly supplied Information Need
      ↓
evaluation method and version
      ↓
result, explanation, qualifications, ambiguity, and limitations
```

The relationship must not be represented by mutating either the Fact or the Information Need.

An evaluation must retain reconstructable lineage sufficient to identify its Fact and Information Need inputs, evaluator or method identity and version, evaluation time, relevant supplied comparison or policy context, result, explanation/signals, and limitations. Where normalization or transformation is used, raw values remain unchanged and the named/versioned normalization or transformation remains explicit.

#### Bounded evaluation methods are permitted

A4a may use appropriately bounded methods including:

* exact typed matching;
* explicit deterministic normalization;
* structured or component comparison where an upstream structure is supplied;
* semantic concept matching; and
* approved derived or equivalence relationships where explicit transformation lineage exists.

Normalization must be explicit and versioned. A normalized comparison value does not replace or rewrite the original Fact.

Provider-neutral AI-assisted semantic evaluation is permitted where deterministic comparison is insufficient. Semantic evaluation must preserve provider, model, instruction or evaluator version, inputs, evaluation time, explanation/signals, and relevant limitations. AI does not become schema authority, fabricate an Information Need, establish final KYC satisfaction, or select an operative value.

#### Discovered Facts remain discovered

An A3 discovered Fact may be evaluated as a candidate for an explicitly supplied Information Need through a new immutable A4a evaluation.

```text
A3 discovered Fact
      ↓
A4a immutable candidate evaluation
      ↓
supplied Information Need
```

The discovered Fact must not be mutated to add `schema_field_id` or `information_need_id`, converted into a requested Fact, treated as an automatic schema recommendation, or used to modify the upstream KYC/KYB schema.

#### Evaluation results are not acceptance decisions

A4a must support a bounded, neutral vocabulary capable of representing meanings such as:

* addresses;
* partially addresses;
* ambiguous;
* insufficient;
* does not address; and
* indeterminate or not evaluated.

Exact enum spelling remains an implementation detail unless subsequently frozen. Terms must not imply final KYC acceptance or satisfaction.

A4a may identify disagreement between genuinely comparable candidate Facts and explain the comparison, but it must not choose a winner. Comparability must not be inferred merely because values look similar or share a broad subject. For example, registered and operating addresses remain different concepts unless an upstream contract explicitly establishes a meaningful comparison.

#### Source trust, temporal context, and evaluation remain distinct

Source trust and A3 extraction support remain separate from A4a evaluation. A4a may consume explicitly supplied and versioned source-policy context where relevant, but it must not invent or embed a universal source hierarchy or copy the current KYC application's primary/secondary/tertiary mechanism into Evidence as universal policy. Companies House must not become a generic rule that always wins.

A4a may expose Artifact observation/capture time, source-effective dates actually present in evidence, Fact and Extraction Run timestamps, evaluation time, and supplied temporal context. It must not implement `latest value wins`, silently treat later evidence as operative, or invent freshness policy.

Re-evaluation is append-only. A later evaluation using new evidence, a new evaluator, or new supplied context creates new history and does not rewrite a prior evaluation.

#### Additive persistence is expected but not yet implemented

A future A4a implementation may add forward-only persistence conceptually equivalent to:

* an evaluation run or header identifying the Information Need, evaluator/method/version, supplied comparison or policy context, evaluation time, and limitations; and
* one or more candidate evaluations identifying the Fact, relation/result, comparison method, normalized comparison inputs where applicable, normalization/transformation reference, reasons/signals, ambiguity, and limitations.

The implementation must not overload:

* `evidence_facts.support_state`;
* `evidence_verification_attempts`;
* `evidence_requirement_assets`;
* `evidence_requirements.status`; or
* mutable JSON on existing Facts.

Existing A1–A3 records remain immutable. No migration is authorized by this governance-only task.

#### A4b requires separate governance

A4b cannot be implemented honestly until separately governed semantics or upstream inputs exist for at least:

* scalar versus collection shape;
* cardinality and minimum/maximum counts where applicable;
* complete-set and `all current X` semantics;
* legitimate empty-set semantics;
* required versus optional status;
* temporal scope and current-as-of meaning;
* freshness policy;
* source suitability and acceptability;
* genuinely comparable conflict rules; and
* aggregation from candidate evaluations to requirement-level evidence coverage.

Complete capture or interpretation of all Artifacts in an Evidence Asset does not by itself establish satisfaction of an Information Need meaning `all current directors`. Likewise, authoritative evidence stating that no registrable PSC exists is materially different from unavailable evidence, failed capture, or no extracted Facts.

#### Final KYC ownership remains downstream

KYC/Onboarding retains exclusive responsibility for:

* final KYC requirement satisfaction;
* source or value winner selection;
* operative customer values;
* customer correctness and dispute resolution;
* corroboration requirements;
* analyst, compliance, and risk decisions;
* approve, reject, refer, or escalate decisions; and
* onboarding progression.

Evidence may provide qualified, reconstructable assessments for downstream consumption. It must not make those decisions itself.

#### Relationship to ADR-010 and ADR-012

This decision clarifies rather than silently reinterprets ADR-010 and ADR-012. ADR-010 assigns operative onboarding values, source priority, conflict consequences, and KYC decisioning to KYC/Onboarding. ADR-012 limits A3 to explaining what preserved evidence says and how strongly it supports a Fact. ADR-013 adds the intervening Evidence-to-Need relationship without moving downstream ownership into Evidence.

The former roadmap wording assigning A4 `operative evidence/value selection under approved downstream policy` is superseded by this clarification. Evidence may expose candidates, qualified evaluations, coverage, and comparable disagreement under separately governed inputs; KYC/Onboarding selects the operative value and determines final satisfaction.

### Consequences

A4a can establish durable candidate-evaluation lineage without pretending to complete KYC decisioning. Discovered Facts remain useful without schema mutation. Deterministic and AI-assisted evaluation can share provider-neutral lineage. Historical re-evaluation remains reconstructable.

A4a explicitly excludes source-winner or operative-value selection, final KYC satisfaction, customer correction decisions, analyst/risk decisions, universal trust tiers, freshness/latest-wins policy, identity resolution, cross-tenant private-evidence discovery, schema mutation, automatic adoption of discovered Facts, unsupported transformations such as ungoverned SIC-to-industry mapping, recollection, automatic reinterpretation, A5 Ledger/Package work, legacy KYC source-steering redesign, and changes to normal KYC behavior.

---

## ADR-014 — Generic Private Artifact Ingestion and Authorized Reopen

**Status:** APPROVED

**Date:** 2026-08-31

**Raised by:** Architecture Authority

### Context

Stage A1 established immutable Evidence Acquisitions, Assets, Artifacts, access scopes, SHA-256 integrity metadata, and storage references. Stage A2 proved production-backed storage and transactional persistence for public Companies House evidence. Stage A3 proved server-side Artifact retrieval and fingerprint verification before interpretation. Stage A4a is complete, while A4b remains deferred.

Future Evidence consumers need a smaller prerequisite before broader integration: an already-authorized private/customer file must be preservable as generic Evidence without requiring the Evidence Platform to understand UBO, KYC satisfaction, document contents, or downstream operative values.

Repository diagnosis established that the current model already contains the necessary logical evidence primitives. The missing capability is a generic production service boundary that validates and stores opaque private binary media, creates the existing immutable provenance graph, and later reopens it under exact private access scope.

### Observed Repository Evidence

* `evidence_artifacts` already records Artifact identity, representation type, media type, original name, storage provider/key/reference, size, SHA-256, capture time, metadata, and creation time.
* `evidence_acquisitions` already records tenant, context, subject, source type/provider/locator, acquisition method, actor, outcome, timestamps, and producer metadata.
* `evidence_assets` and `evidence_asset_access_scopes` already support `context_restricted` evidence with tenant/context scope.
* `evidence_collection_operations` already supplies producer-neutral operation identity and a unique producer/request-key boundary suitable for retry idempotency.
* the existing Artifact stores accept opaque bytes; Vercel Blob is the current production adapter, filesystem storage is the local adapter, and memory/fixture content is test-only.
* the existing server-side Artifact reader can reopen filesystem and private Vercel Blob bytes, while A3 demonstrates SHA-256 verification after read.
* the current A3 interpretation lookup contains a same-tenant authorization shortcut in addition to access-scope checks. This is a bounded implementation defect against the already-approved private/context-restricted Evidence invariant, not a new architecture decision. It is not sufficient for R1 private reopen and must not be copied into the generic private boundary.

### Decision

#### R1 is generic Evidence infrastructure

Insert **Evidence Consumer Readiness R1 — Private Artifact Ingestion** after A4a and before A4b.

R1 accepts an upload only after a trusted host has authorized Evidence Platform custody. It creates generic Evidence provenance and does not create or import consumer-domain concepts.

Conceptually:

```text
authorized host upload
        ↓
generic Evidence ingestion boundary
        ↓
Collection Operation + successful Acquisition
        ↓
immutable context-restricted Evidence Asset
        ↓
immutable original-byte Artifact + SHA-256
        ↓
strictly authorized server-side reopen
```

R1 is not a UBO upload feature. UBO, KYC/KYB, EDD, source-of-funds, analyst workflows, and other domains may later reference the resulting Evidence identities through separately governed consumer integration.

#### The boundary receives trusted context rather than deciding authorization

The normal service input is conceptually equivalent to:

```text
ingestPrivateArtifact({
  idempotencyKey,
  authorizedTenantId,
  authorizedContextId,
  optionalSubjectReferenceId,
  actor/sourceChannel metadata,
  originalBytes or server-side stream,
  declaredMediaType,
  optionalOriginalFilename,
  optionalExplicitSourceEffectiveDate
})
```

Exact API and internal service names remain implementation details.

Tenant, context, actor, and authorization are derived from trusted server-side host context, not accepted as authoritative browser assertions. The context must already exist and belong to the authorized tenant. Its existing subject reference is authoritative for R1; if the caller supplies a subject reference, it must match the context. R1 does not create a master identity system or resolve subject ambiguity.

The boundary returns Evidence operation, Acquisition, Asset, and Artifact identities plus non-secret integrity and media metadata. It never returns storage credentials or treats a browser-supplied storage path/reference as authoritative.

#### Existing Evidence persistence and storage primitives are reused

R1 reuses:

* producer-neutral Collection Operation identity;
* Acquisition provenance and outcomes;
* Evidence Asset identity;
* `context_restricted` access class and explicit tenant/context access scope;
* Artifact identity and metadata;
* the existing Artifact storage abstraction;
* SHA-256 fingerprinting; and
* the existing server-side storage read capability.

The implementation may introduce a generic `evidence/ingestion` service/repository boundary and may reuse or semantics-preservingly extract the existing Artifact-store adapter from its A2-oriented module location. It must not create parallel Evidence, storage, fingerprint, access, context, subject, or provenance concepts.

R1 creates no Requirement, Information Need, Extraction Run, extracted value, Fact, evaluation, or provisional assessment.

#### Media preservation is independent from interpretation

R1 must support preservation of at least:

* `application/pdf`;
* `image/png`; and
* `image/jpeg`.

Declared MIME type, filename extension, and client-supplied metadata are not sufficient by themselves. The implementation must apply bounded server-side media validation, including format-signature validation, configured size limits, and a canonical stored media type. Original filenames are optional untrusted display metadata; they must be sanitized and must not determine storage paths, identity, or authorization.

The preserved Artifact uses a generic representation such as `original_upload`. The logical Evidence type remains generic, such as `private_uploaded_artifact`, unless a separately governed upstream contract supplies a more specific approved classification. Media support for storage does not imply interpretation support. A valid PDF or image may be durably preserved even when no current extractor/provider can interpret it.

#### SHA-256 is integrity metadata, not identity or authorization

The ingestion service calculates SHA-256 from the exact server-side bytes before persistence. After storage, the service must read the stored object through the authoritative storage boundary and verify byte length and SHA-256 before recording successful Artifact persistence.

Fingerprint equality answers only whether bytes are equal. It does not establish that two uploads are the same evidentiary event, the same Evidence Asset, semantically equivalent, reusable, or mutually visible.

Physical deduplication is not an R1 requirement. If introduced later, it must preserve distinct logical provenance and strict access isolation.

#### Retry identity and genuine repeat uploads remain distinct

The authorized host supplies an idempotency key for one logical upload operation. R1 reuses the Collection Operation producer/request-key uniqueness boundary with a neutral private-ingestion producer identity.

* Repeating the same idempotency key for the same authorized tenant, context, media metadata, and byte fingerprint reopens or resumes the same logical operation and must not create a second Acquisition, Asset, or Artifact.
* Reusing the key with different tenant, context, media, metadata that affects provenance, or bytes is an idempotency conflict and must not mutate the existing operation.
* A deliberate new upload/recollection uses a new idempotency key and creates new immutable operation, Acquisition, Asset, and Artifact identities, even when the bytes and SHA-256 are identical.

An implementation may use deterministic internal IDs derived from the operation identity or independently generated immutable IDs. The semantics above, rather than the hash, define retry identity.

#### Private access is exact tenant-and-context access

Every R1 Evidence Asset is `context_restricted` and has an explicit access-scope row for the authorized tenant and Evidence context.

Authorized reopen must require:

```text
Artifact
  → Asset access_class = context_restricted
  → matching explicit asset access scope
  → matching authorized tenant
  → matching authorized Evidence context
```

Same-tenant membership alone is not sufficient. Cross-context and cross-tenant private discovery, reuse, interpretation, or download is not authorized. Fingerprint equality never grants visibility.

R1 implementation is authorized to correct the identified A3 shortcut narrowly so that context-restricted Evidence requires the same exact tenant-and-context access scope before interpretation. Public Evidence behavior remains unchanged. This correction must not become a redesign of Evidence authorization.

R1 must provide or reuse a generic server-side metadata resolver plus Artifact reader that performs authorization before storage access, reads only the persisted storage location, verifies the persisted SHA-256, and returns bytes only to the authorized server-side consumer. Storage keys/references and credentials remain server-only.

#### Upload, capture, observation, and source-effective time remain distinct

R1 records:

* Acquisition start/completion time for the ingestion event;
* Artifact `captured_at` for the time Evidence accepted the exact uploaded bytes;
* Evidence Asset `observed_at` consistently with the ingestion observation; and
* database creation time independently.

An explicitly supplied source/document effective date is preserved separately under the canonical Evidence-owned Artifact metadata property `sourceEffectiveDate`, including that it was host-supplied. R1 does not extract or infer a date from document contents, use filesystem modification time, overwrite capture time with a document date, implement freshness, or make later evidence operative. The existing metadata field is sufficient for minimum R1 preservation; a typed/queryable effective-date column requires a later additive decision only if a real consumer requirement needs it.

#### Failure categories remain non-semantic

R1 must distinguish at least:

* invalid request or media metadata;
* authorization/access denial;
* unsupported or forbidden media;
* idempotency conflict;
* storage failure;
* integrity verification failure; and
* persistence failure.

No failure is represented as `document contains no facts`, unsupported evidence content, or an extraction conclusion. R1 has not interpreted the Artifact.

No successful Asset or Artifact may be claimed unless storage, read-back integrity verification, and logical persistence succeed. Logical Evidence rows are persisted transactionally. If external object storage succeeds but database persistence fails, the operation remains failed/incomplete, no successful Artifact is reported, and any orphan-object cleanup is an operational concern that must not delete prior evidence.

#### External-custody identity evidence remains separate

R1 handles private Evidence that the authorized host has deliberately permitted Evidence Platform to retain. It does not create a general identity/biometric vault. Raw IDV passports, selfies, biometric templates, or other material whose authoritative custody remains in an external identity-verification provider require a separately governed external-custody Evidence capability.

#### No new migration is required by the minimum design

The accepted A1/A2 schema already represents the minimum R1 operation, Acquisition, Asset, access scope, Artifact, media metadata, storage lineage, SHA-256, timestamps, and optional source-effective metadata. The minimum implementation is therefore expected to require no migration.

If implementation discovers that these records cannot be persisted or authorized without changing their semantics, weakening isolation, or overloading observation/effective time, it must stop for Architecture Authority. Existing migrations must not be rewritten; any subsequently approved schema change must be additive and forward-only.

#### Relationship to prior decisions

ADR-014 applies ADR-005 collection/interpretation separation and ADR-010 Asset/Artifact, integrity, append-only history, deduplication, private access, and KYC-ownership decisions to generic private ingestion. It does not reinterpret ADR-012 or ADR-013 and does not authorize A3 interpretation, A4a evaluation, or A4b assessment for the ingested Artifact.

### Consequences

R1 can make PDF and image Evidence durable and reopenable before interpretation support exists. Future consumers receive stable generic Evidence identities rather than owning storage and provenance internals. Retried operations do not create duplicate logical evidence, while deliberate repeated uploads retain independent evidentiary history even when byte-identical.

R1 requires careful server-side authorization, media validation, integrity read-back, and non-secret responses. It explicitly excludes direct browser authority, private-evidence discovery, cross-context reuse, extraction, trust assessment, satisfaction, operative-value selection, UBO semantics, external-custody identity evidence, R2/R3/R4, A4b, and existing KYC behavior changes.

---

## ADR-015 — Targeted Interpretation Boundary for Authorized Evidence Consumers

**Status:** APPROVED AND IMPLEMENTED

**Date:** 2026-09-01

**Raised by:** Architecture Authority

**Implemented:** 2026-09-01 at commit `0e31ba490452b50e1cf618a23231d980d9ca4977`

### Context

R1 is implemented at commit `0bd62ee351b6a1ac0ca2f882ac338d790657f313` and can preserve and reopen an authorized private Artifact without interpreting it. A3 already contains the provider-neutral machinery needed to interpret one persisted Artifact or a coherent set of Artifacts from one Evidence Asset, verify persisted SHA-256 values, request several semantic concepts, preserve requested and discovered Facts, and append provider/model/instruction lineage.

The existing A3 service is not yet a stable downstream integration boundary. Its public handler is an Evidence Lab adapter: it supplies only Artifact IDs, resolves tenant from environment, ignores caller `requestedConcepts` and `extractionContext`, and supplies no trusted private context. After the approved R1 authorization correction, the handler therefore cannot interpret or reopen history for a private Artifact because exact context is not passed. It also defaults missing concepts/context to standalone Lab fixtures, exposes a Lab-shaped response, has no opaque consumer-correlation contract, and cannot distinguish an unsupported requested concept from a supported concept that is legitimately absent.

### Decision

#### Insert R2 before R3, R4, and A4b

Add **Evidence Consumer Readiness R2 — Targeted Interpretation Boundary** after R1 and before R3, R4, and deferred A4b.

R2 is a stable, provider-neutral service/API boundary around the existing A3 interpretation engine. It is not a new extraction engine and must preserve A3's immutable Extraction Run, Fact, support, and Artifact-lineage model.

Conceptually:

```text
authorized Evidence consumer
        ↓
persisted Artifact IDs
+ neutral requested concepts
+ bounded extraction context
+ opaque caller correlation
        ↓
server resolve → authorize → read → SHA-256 verify
        ↓
existing A3 interpretation machinery
        ↓
immutable Extraction Run + Facts + support lineage
```

#### Trusted authorization and persisted Artifact identities are mandatory

The R2 service receives tenant, context, actor, and authorization from trusted server-side host state. A browser or downstream payload may identify the target context but is not proof of authority.

Consumers provide only persisted Evidence Artifact IDs. They must not provide authoritative bytes, Blob URLs, filesystem paths, storage keys, credentials, fingerprints, source metadata, or other storage/provenance claims. Evidence resolves each Artifact server-side, applies existing public/private access rules, reads the persisted storage location, and verifies its persisted SHA-256 before provider execution.

Public Artifact interpretation remains permitted under the existing public access rule. A `context_restricted` Artifact requires the exact authorized tenant and exact Evidence context plus matching explicit access scope. Same-tenant membership alone remains insufficient.

#### One coherent Evidence Asset per interpretation operation

One R2 operation may select one Artifact or an explicit ordered set of Artifacts belonging to one Evidence Asset. Cross-Evidence-Asset interpretation is rejected. Persisted page order and completeness metadata remain authoritative where available.

Every input Artifact is recorded in Extraction Run input lineage. Fact-to-Artifact support remains explicit: selection as a run input does not imply that every Fact is supported by every input Artifact.

#### Requested concepts are neutral Evidence semantics

R2 accepts one or more bounded neutral semantic concepts, each with an Evidence-facing concept name and optional neutral description. One provider call should answer several concepts where one coherent Artifact set can safely be interpreted together. One run may produce several Facts.

Requested concepts do not carry KYC satisfaction instructions. Evidence may be asked to find economic ownership relationships, voting rights, appointment/removal rights, registered identifiers, former names, or similar source facts. It must not be asked to determine whether a foreign policy requirement is satisfied, identify a UBO/controller, calculate ownership, select an operative value, or decide a case.

R2 must not convert external Information Need IDs, policy IDs, UBO IDs, or other consumer-domain identifiers into Evidence schema fields, Evidence Information Needs, foreign keys, or domain semantics. Schema field and Information Need linkage may be used only when the caller supplies an already-authorized Evidence-native extraction context governed by the existing model.

Open discovery remains permitted: provider output may contain additional clearly relevant Facts beyond the requested concepts. Those Facts remain `discovered`; they do not mutate the request, schema, or caller domain.

#### Extraction context is bounded and correlation is separate

R2 accepts a bounded provider-neutral extraction context sufficient to interpret the evidence, such as jurisdiction, language, schema reference/version when genuinely supplied, temporal purpose, or other neutral interpretation constraints. It must be validated and persisted with the Extraction Run. Arbitrary caller objects must not be blindly treated as authoritative Evidence context or forwarded to a provider.

Caller correlation is a separate opaque envelope, conceptually:

```text
correlation: {
  requestId?,
  externalReferences?: [{ system, type, id }]
}
```

Evidence may validate size/shape, persist it in non-semantic run metadata, and return it for reconstruction. It does not interpret, dereference, authorize from, or create foreign keys around correlation. Correlation is not Evidence identity, Fact identity, Information Need identity, policy input, or provider prompt content.

The existing Extraction Run JSONB metadata can carry bounded correlation without a migration. If atomic lookup or uniqueness semantics are later required, implementation must stop for an additive schema decision.

#### Requested-concept outcomes require distinct Evidence-native states

R2 must preserve a per-requested-concept outcome that distinguishes at least:

* `found` — one or more supported Facts answer the concept;
* `not_found` — the input was interpretable and complete enough to conclude the requested fact was not represented;
* `not_evaluated` — incomplete/unreadable input or another limitation prevented evaluation; and
* `unsupported` — the current interpretation capability does not understand or support the requested concept.

Exact internal enum names remain implementation details, but `unsupported`, `not_found`, `not_evaluated`, provider unavailability/failure, and overall inconclusive interpretation must not be conflated.

A completed run may legitimately contain no persisted Fact when all requested concepts truthfully resolve to `not_found`. An incomplete run with some supported Facts remains a completed but qualified interpretation. Provider, integrity, media, access, and persistence failures are not “no data.”

#### Fresh execution and historical retrieval are separate contracts

R2 exposes two explicit operations:

```text
open existing interpretation history
  → no provider call
  → no new Extraction Run

run fresh interpretation
  → provider call may occur
  → new immutable Extraction Run
```

History retrieval must use the same server-side Artifact authorization boundary and return persisted runs, Facts, requested-concept outcomes, completeness/support, input Artifact lineage, Fact-to-Artifact support, provider/model/instruction lineage, timestamps, and opaque correlation without reading source bytes or invoking a provider unless source-byte verification is explicitly required by a separately governed operation.

#### Every stable fresh execution has a durable operation key

Every fresh request through the stable R2 production boundary contains a caller-supplied `operationKey`. The key identifies one interpretation execution attempt within the trusted authorized caller scope. It is separate from opaque correlation, Evidence/Artifact/Extraction Run identity, and downstream Information Need or policy identity.

For the same authorized scope, the same key plus the same canonical request means the same operation. A completed operation returns its existing operation, Extraction Run, and bounded result without a provider call or new run. An in-progress operation returns current status without a second provider call or new run. A failed operation returns its persisted failure without automatic provider retry or new run. A deliberate retry after failure or deliberate reinterpretation uses a new key and creates a new immutable run.

Reusing a scoped key with a materially different canonical request returns `idempotency_conflict` and does not reinterpret or mutate history.

The canonical request fingerprint includes trusted tenant/context scope, authoritative server-resolved Artifact set and order, requested concepts and their neutral descriptions/bounded Evidence linkage, validated extraction context, bounded opaque correlation, and trusted caller/provenance metadata that is persisted. Caller-supplied hashes/storage data are not authority. Current provider, model, or instruction configuration is excluded from the fingerprint; the configuration actually used remains immutable execution lineage. Reusing an old key after execution configuration changes reopens the original operation.

Correlation remains opaque and separate but participates in request consistency after operation creation. Reusing a key with different correlation is a conflict; correlation history is never silently rewritten.

Production idempotency requires durable atomic uniqueness. R2 is authorized to add one bounded, forward-only migration after 014 for an interpretation-operation record retaining operation identity, trusted tenant/context scope, operation key, canonical request fingerprint, bounded correlation, status, optional Extraction Run reference, bounded failure details, and timestamps. A scoped unique constraint/index must prevent concurrent duplicate execution. R2 must not overload Facts, Artifact metadata, or introduce broader workflow infrastructure.

#### Media support does not expand in R2

R2 supports only the media types currently interpreted by A3: JSON-compatible structured content and HTML. An R1-preserved PDF, PNG, or JPEG remains valid stored Evidence but receives an explicit `unsupported_media_type` interpretation outcome until R3 is separately governed and implemented.

#### Interpretation remains separate from A4a evaluation

R2 creates or retrieves A3 Extraction Runs and Evidence Facts. It does not automatically invoke A4a, decide Fact-to-Need evaluation, merge interpretation and evaluation into one opaque call, assess requirement coverage, select winners, or determine downstream KYC satisfaction.

#### Stable boundary and response

The stable R2 response should expose Evidence-native identities and reconstructable lineage intentionally rather than returning the entire internal Lab object. It should include operation/run status, non-secret Artifact/Asset identities, requested-concept outcomes, requested and discovered Facts, explicit Fact support Artifact IDs, completeness/limitations, provider/model/instruction references, capture and extraction timestamps, integrity result, and opaque correlation.

Internal storage references, provider prompts/raw responses, credentials, repository row shapes, Lab defaults, and implementation-only diagnostic structures are excluded. Failures return bounded Evidence-native codes with non-secret diagnostic references where appropriate.

### Consequences

Most R2 behavior can reuse A3 unchanged: multi-concept provider requests, multi-Fact output, requested/discovered status, coherent multi-Artifact enforcement, SHA-256 verification, append-only persistence, provider lineage, Fact-to-Artifact support, and no-cost history reopening already exist.

R2 still requires a production service/API adapter, strict request validation, trusted private context propagation, separation of extraction context from opaque correlation, a stable response contract, and a distinct `unsupported` requested-concept outcome. Current Lab APIs remain internal and are not the stable R2 contract.

One additive migration after 014 is authorized solely for durable interpretation-operation idempotency. Correlation and requested-concept outcome details may continue to use bounded JSONB lineage; no broader workflow schema is authorized.

R2 remains generic Evidence infrastructure. It imports no UBO/KYC/EDD/source-of-funds contracts, creates no foreign policy relationships, performs no ownership calculation, adds no PDF/image interpretation, and does not authorize R3, R4, A4b, or existing KYC behavior changes.

---

## ADR-016 — Multimodal Interpretation and Durable Evidence Locators

**Status:** APPROVED — IMPLEMENTED

**Implemented at:** `ec96fe358ef09bdec15dd14f23a7ade1b36aba06`

**Date:** 2026-09-01

**Raised by:** Architecture Authority

### Context

R1 can durably preserve and reopen private PDF, PNG, and JPEG Artifacts. R2, implemented at commit `0e31ba490452b50e1cf618a23231d980d9ca4977`, provides the stable targeted-interpretation operation boundary around A3. It accepts one or more ordered Artifacts from one Evidence Asset, applies exact private tenant/context authorization, reopens bytes server-side, verifies SHA-256, appends an immutable Extraction Run and Facts, records Fact-to-Artifact support, and reopens historical results without a provider call.

The current interpretation path remains text-only. `evidence/a3/liveService.js` accepts only JSON-compatible media and HTML, decodes verified bytes as UTF-8, and rejects PDF/image media before provider execution. `evidence/a3/providers.js` receives decoded text and builds one string prompt. Its Anthropic adapter does not currently emit provider-native `image` or `document` content blocks.

Migration 013 records only the immutable pair `(fact_id, artifact_id)`. It truthfully identifies which Artifact supports a Fact but cannot durably answer where within that Artifact the support appears. Fact JSON metadata or Extraction Run metadata could technically carry an opaque locator, but neither cleanly represents a repeatable per-Fact, per-Artifact, potentially multi-location lineage relationship.

### Decision

#### Insert R3 after R2 and before R4 and A4b

Add **Evidence Consumer Readiness R3 — PDF/Image Interpretation + Durable Evidence Locators** after R2. R3 extends the existing A3/R2 interpretation engine; it must not create a second extraction engine.

```text
authorized persisted PDF / PNG / JPEG
        ↓
existing R2 resolve and access enforcement
        ↓
server-side read + persisted SHA-256 verification
        ↓
provider-neutral multimodal content
        ↓
provider adapter
        ↓
immutable A3 Extraction Run + Facts
        ↓
Fact-to-Artifact support + durable locator
```

R3 continues to receive neutral requested concepts through R2 and continues A3 open discovery. It does not import consumer-domain policy or identity types.

#### The provider-neutral boundary uses Evidence content items

The provider-facing Evidence abstraction must distinguish content items conceptually equivalent to:

```text
text       — verified JSON/HTML text plus Artifact identity and order
image      — verified PNG/JPEG bytes plus canonical MIME and Artifact identity
document   — verified PDF bytes plus canonical MIME and Artifact identity
```

Each item retains its Evidence Artifact ID, media/representation type, authoritative order, and safe source metadata. Raw bytes remain server-side and are supplied only after authorization and SHA-256 verification. Provider-specific Anthropic `text`, `image`, `document`, base64, citation, or future Files API blocks belong only inside the Anthropic adapter and must not leak into Evidence domain or persistence models.

The adapter must use a configured model whose declared provider capability supports every selected content item. A model name alone is not Evidence authority; unsupported model/media combinations fail before a semantic conclusion is persisted.

Raw provider request/response retention remains deferred. R3 persists normalized Facts, support/completeness, locators, and existing provider/model/instruction lineage, not the raw provider exchange.

#### R3 media scope and limits are bounded

R3 interpretation media are limited to the existing JSON/HTML types plus R1's preserved `application/pdf`, `image/png`, and `image/jpeg`. R3 does not add GIF, WebP, office documents, audio, video, or arbitrary binary interpretation merely because a provider may support them.

For the initial direct Anthropic Messages adapter:

* a PDF must be a structurally readable, standard, unencrypted PDF, no larger than the existing R1 10 MiB raw-byte limit and no more than 100 pages per request;
* a PNG/JPEG must pass canonical MIME/signature validation, be no larger than the smaller of the configured R3 limit and the provider's encoded-image limit, and not exceed 8,000 by 8,000 pixels;
* direct base64 image submission must keep the encoded image block within Anthropic's 10 MB limit, which requires a raw-byte cap of approximately 7.5 MB unless a separately governed/provider-supported transport avoids that encoding overhead;
* one R2 operation remains bounded to at most 20 explicitly selected same-Asset Artifacts, and the combined provider request must remain below the applicable provider request/context limit; and
* aggregate original binary content passed through one direct-base64 interpretation request must not exceed 20 MiB, independently of the 20-Artifact cardinality limit.
* byte, page, dimension, count, and total-request checks occur before paid provider execution where deterministically knowable.

The implementation must parse enough media structure to determine supported type, corruption, PDF encryption/page count, and image dimensions. It must never trust filename extension alone. R1-preserved bytes remain authoritative and must not be rewritten.

Evidence Platform does not rasterize PDFs, transcode images, recompress, crop, resize, rewrite, or replace the preserved canonical Artifact merely to perform interpretation. If later Evidence-owned preprocessing is authorized, every derived representation must be a distinct immutable Artifact with transformation provenance. A provider may internally render PDF pages or resize images according to its documented execution behavior. That execution-time representation is not a new Evidence Artifact, does not change the original SHA-256, must not be presented as original-source geometry, and must be reflected as an interpretation limitation/context where material. R3 must not claim original-PDF pixel coordinates or silently manufacture a coordinate transform from provider-rasterized pages.

These product limits are intentionally below or equal to the current Anthropic platform ceilings and may be lowered by configuration. Raising them or adopting a provider Files API requires a separate operational/privacy review; it must not be achieved by silently changing Evidence semantics.

#### Locators are Evidence-owned support lineage

A locator answers:

> Where in this preserved Artifact is the support for this Fact?

It is subordinate to an existing Fact-to-Artifact support relationship. It is not a Fact, Artifact identity, UBO object, provider response, authorization token, or operative-value decision.

R3 retains the strongest meaningful locator the interpretation can truthfully support:

| Artifact media | Minimum/desired locator |
|---|---|
| JSON | JSON Pointer or equivalent deterministic path/key plus a bounded raw support excerpt/value |
| HTML | reliable DOM/section locator where available plus a bounded supporting excerpt |
| PDF | one-indexed page or page range plus bounded cited/supporting text or a truthful visual support description |
| PNG/JPEG | supporting Artifact plus bounded support description/excerpt; optional region only when reliably produced and mapped |

No precision may be fabricated. A provider-reported PDF page must be within the verified page count. Anthropic PDF citations may be normalized into the Evidence locator model, but provider citation types do not become Evidence types. PDF image-only support that cannot be given a reliable page locator is qualified/incomplete rather than assigned an invented page.

Locator quality and Fact content are related but not identical. If the provider returns an otherwise valid source-derived Fact but its required minimum locator is missing or invalid, preserve the immutable Fact with `needs_verification`, record an explicit locator limitation, and mark the relevant interpretation/completeness result partial. Do not persist the invalid locator and do not claim the Fact is fully supported. A weaker but truthful locator is retained and qualified rather than replaced with invented precision.

Bounding boxes are optional in R3. They may be stored only when the adapter can record the coordinate system, source dimensions, provider-visible dimensions/transformation, and confidence/qualification necessary to map them back to the preserved Artifact. Anthropic may resize images, and PDF pages are rasterized at dimensions the caller does not control; unqualified provider coordinates therefore must not be treated as original-Artifact coordinates.

#### Durable locators require one additive persistence structure

Migration 013 remains authoritative for the existence of Fact-to-Artifact support but has no locator columns. R3 therefore proposes one forward-only additive migration after 015 for a child relation conceptually equivalent to `evidence_fact_artifact_locators`.

Each immutable locator row is anchored to an existing `(fact_id, artifact_id)` support pair and records, as applicable:

* immutable locator identity and ordinal;
* locator kind/media;
* JSON path, HTML section/DOM reference, or PDF page start/end;
* bounded supporting excerpt or support description;
* optional bounded region metadata with an explicit coordinate space;
* adapter/provider locator method and qualification metadata; and
* creation time.

Several locations may support one Fact in one Artifact. A Fact supported by several Artifacts has separate support pairs and separate locators. Existing Facts/runs remain unchanged. Reinterpretation appends a new Extraction Run, Facts, support pairs, and locators; it never updates prior locator history.

Do not hide this relationship solely in `evidence_facts.support_signals`, `source_policy_context`, Artifact metadata, or run metadata. Those existing JSONB fields remain appropriate for bounded assessment/context, not the durable identity of per-Artifact source locations.

#### Coherent mixed-Artifact interpretation is allowed only within one Asset

R3 may interpret an explicit ordered coherent same-Asset set such as:

```text
rendered HTML + screenshot image
```

or, if both representations already exist as preserved Artifacts:

```text
PDF + derived/rendered page images
```

All existing A3/R2 rules remain: every Artifact is independently resolved, authorized, read, and verified; the selected set belongs to one Evidence Asset; persisted ordering is authoritative; every run input is recorded; and each Fact links only to the Artifact(s) that actually support it. Selecting an Artifact does not imply support. Arbitrary cross-Asset, cross-acquisition, cross-recollection, or cross-context bundles remain prohibited.

#### Temporal/currentness statements remain source facts, not policy conclusions

R3 may preserve explicit source-supported statements such as `current`, `ceased`, `historical`, `effective from`, `effective to`, and unknown currentness using the existing A3 Fact representation, raw representation, support state, and locator. An explicitly supplied R1 `sourceEffectiveDate` remains separate Artifact metadata and may be exposed as interpretation context/provenance; it is not silently converted into a Fact or currentness conclusion.

Absence of a cease date does not establish current status unless an authoritative source contract explicitly supplies that semantic rule. Ambiguous or unstated currentness is preserved as uncertainty/qualification. Typed temporal relationship applicability belongs to R4 or later policy governance.

#### Failures remain explicit and non-semantic

R3 must distinguish at least:

* unsupported media or configured model/media combination;
* corrupt, unreadable, encrypted, or malformed media;
* media byte/page/pixel/count/request limit exceeded;
* Artifact storage unavailable;
* Artifact SHA-256 integrity mismatch;
* provider unavailable/authentication/timeout/failure;
* provider media rejection;
* malformed or truncated provider result;
* invalid/missing locator for a fact that requires one;
* inconclusive interpretation;
* legitimate requested concept not found;
* partial/incomplete extraction; and
* persistence failure.

No failure is represented as `no facts`. Authorization, storage, integrity, and deterministic media validation occur before provider execution. A failed operation retains immutable R2/A3 failure history without a fabricated Fact. A successful prior Artifact or interpretation remains unchanged.

#### Historical reopening remains provider-free

Historical R3 results reopen through the existing authorized R2/A3 history path. Reopening returns persisted run inputs, Facts, Fact-to-Artifact support, locators, provider/model/instruction lineage, support/completeness, and timestamps without reading the source again or making a provider call. A deliberate fresh interpretation uses a new R2 operation key and appends new history.

#### R3 stops before typed relational meaning

R3 may extract source-supported entity names, identifiers, ownership percentages, voting rights, appointment/removal statements, control descriptions, and temporal statements using existing A3 Fact values. It does not create graph edges, canonical ownership calculations, UK PSC/UBO semantics, `isUbo`, `qualifies`, effective indirect ownership, thresholds, winners, KYC satisfaction, A4b assessments, or downstream decisions.

Stable typed relational Facts belong to R4. If a multimodal result cannot be represented truthfully without inventing the R4 relationship model, R3 must report the limitation and stop rather than improvise one.

### Consequences

R3 can reuse the R1/R2 storage, authorization, SHA-256, operation, requested-concept, history, and append-only extraction paths. The main implementation work is a provider-neutral multimodal content adapter, deterministic media validation, normalized locator output, one additive locator migration/repository path, and Lab presentation.

The previously preserved Tesco annual-report PDF and ownership-chart PNG can become manual acceptance inputs without Companies House recollection. A paid provider call remains explicit; selection and history reopening remain free of provider calls.

R3 does not authorize a second extraction engine, new Evidence identity, provider-file persistence, media conversion, raw provider exchange retention, cross-Asset interpretation, R4, A4b, UBO/KYC policy, or changes to existing KYC behavior.

---

## ADR-017 — Typed Source-Relationship Facts

**Status:** APPROVED — IMPLEMENTED

**Date:** 2026-09-01

**Raised by:** Architecture Authority

**Implemented at:** `450ae41e2871a5145667b8fec906a84d5b5bbc93`

### Context

R3 can now interpret preserved JSON, HTML, PDF, PNG, and JPEG Artifacts and append immutable source-supported A3 Facts with precise Fact-to-Artifact support and durable locators. Those Facts can contain scalar, object, or array JSONB values. The current model reliably preserves what an interpretation returned, but it does not establish typed relational meaning inside an arbitrary JSON object.

Persisted Lab evidence confirms that `evidence_facts.fact_value` already contains strings, numbers, booleans, objects, and arrays. Existing structured concepts include officers, persons with significant control, ownership structures, and ultimate-beneficial-owner-shaped arrays. PostgreSQL validates that a value is JSONB, while the A3 domain validates Fact lineage, requested/discovered state, direct/derived grounding, and support state. Neither validates that a JSON object has a stable subject, relationship, object, direction, quantitative meaning, temporal assertion, or party identity grammar.

Treating an opaque provider-produced JSON object as a typed relationship would therefore require every consumer to guess its semantics. Creating a separate standalone relationship identity would instead duplicate Evidence Fact identity and weaken the existing Fact, Extraction Run, support, derivation, and locator chain.

### Decision

#### R4 represents source assertions, not downstream conclusions

Insert **Evidence Consumer Readiness R4 — Typed Relational Facts** after R3 and before A4b.

R4 represents an individual source-supported assertion using the documented grammar:

```text
subject
  relationship
object
```

The subject is the party that holds, exercises, performs, or is assigned the relationship; the object is the party or arrangement to which the relationship applies.

```text
Alice
  ECONOMIC_OWNERSHIP
HoldCo Ltd
```

means that the source asserts Alice owns HoldCo Ltd. Provider-native direction, passive voice, arrow orientation, and source-specific field order must be normalized to this grammar before persistence. If direction cannot be established deterministically, no typed relationship is persisted.

R4 stops at the source relationship assertion. It does not calculate indirect/effective ownership, multiply ownership chains, apply regulatory thresholds, identify UBOs/controllers, choose an operative claim, assess requirement coverage, decide KYC satisfaction, or perform A4b aggregation.

#### A typed relationship extends one ordinary Evidence Fact

The recommended persistence model is:

```text
evidence_facts
      1
      ↓ 0..1
typed relationship extension
```

The ordinary Fact remains the stable Evidence Fact identity. Its Extraction Run, requested/discovered state, direct/derived grounding, support state, raw representation, Fact-to-Artifact support, and R3 locators remain authoritative lineage. The relationship extension supplies queryable, provider-neutral relational semantics; it is not another Fact and does not replace the Fact's raw/source representation.

One typed relational Fact represents exactly one directed source assertion. A source containing several independent relationships normally produces one ordinary Fact and extension per relationship; it does not hide those assertions inside one opaque typed relationship array. Existing historical object/array Facts remain valid. Deliberately mapping an existing array Fact creates separate derived Facts with explicit transformation lineage.

An explicitly stated source relationship may be one direct Fact with a validated relationship extension and the original source wording in `raw_representation`. No duplicate opaque Fact is required merely to retain wording.

When an already-persisted untyped Fact or source-specific code is later mapped to a neutral relationship, the original Fact is not rewritten. R4 appends a new derived Fact, links it through `evidence_fact_derivations`, and attaches the typed relationship extension to that derived Fact. The derivation records the mapper/transformation identity, version, reference, and time.

#### Parties are source snapshots, not canonical entities

Each subject and object is a validated source-party snapshot containing only explicitly supported attributes:

* party type: `natural_person`, `legal_entity`, `trust_or_legal_arrangement`, or `unknown_or_other`;
* source-recorded name or bounded source description;
* jurisdiction where the source explicitly states it;
* source-recorded external registry identifiers, including scheme and value, where explicitly present; and
* bounded source-specific party metadata needed for reconstruction.

Source-party snapshots are not global persons, companies, subjects, UBO identities, or entity-resolution records. Equal names or identifiers do not merge parties. Downstream identity resolution may later associate snapshots with canonical entities under separately governed authority.

#### Relationship vocabulary is provider-neutral and versioned

The initial neutral vocabulary should cover at least:

* `ECONOMIC_OWNERSHIP`;
* `VOTING_RIGHTS`;
* `APPOINTMENT_RIGHTS`;
* `REMOVAL_RIGHTS`;
* `FORMAL_DECISION_RIGHTS`;
* `SIGNIFICANT_INFLUENCE_OR_CONTROL`;
* `DIRECTOR_OF` and `OFFICER_OF`;
* `AUTHORIZED_SIGNATORY_FOR`;
* `CONTROL_OVER`;
* `SETTLOR_OF`, `TRUSTEE_OF`, `PROTECTOR_OF`, and `BENEFICIARY_OF`;
* `NOMINEE_FOR` / `ACTS_ON_BEHALF_OF`; and
* `OTHER` only when the source relationship is understood but falls outside the initial controlled vocabulary, with the original source label and meaning retained.

The vocabulary and direction grammar carry a version. UK PSC nature-of-control codes and provider-specific labels are source metadata, not the canonical Evidence vocabulary.

A source-specific code may map to a neutral relationship only under an explicit deterministic, versioned mapping. `OTHER` is not a generic unknown bucket. If relationship meaning or grammatical direction cannot be established safely, the assertion remains an ordinary Evidence Fact and the typed-mapping limitation is recorded; no typed relationship is forced or guessed.

#### Relationship quantities preserve shape and uncertainty

The value model must remain useful beyond percentages. It should distinguish:

* value kind: `EXACT`, `RANGE`, `QUALITATIVE`, or `UNKNOWN`;
* measure kind: percentage, count-of-total, absolute number, qualitative classification, or no stated quantity;
* unit where applicable;
* exact numeric value or exact numerator/denominator;
* lower and upper range bounds plus independent inclusivity;
* source-recorded qualitative value without invented numeric conversion; and
* raw source wording.

For example, `more than 25% but not more than 50%` is preserved as lower `25` exclusive and upper `50` inclusive. It must never become 25%, 37.5%, or another exact value. `3 of 5 directors` is an exact count-of-total value. `majority voting rights` remains a qualitative assertion unless a separately governed source contract supplies a deterministic numeric meaning. `UNKNOWN` has no numeric zero.

Numeric validation must reject malformed bounds, lower greater than upper, invalid inclusivity, invalid percentages, and invalid count denominators. A value shape that fails validation does not become a typed relationship.

#### Temporal assertions are explicit and non-operative

A typed relationship may retain source-supported:

* currentness: `current`, `ceased`, `historical`, or `unknown_currentness`;
* effective-from and effective-to values with source precision;
* source-effective date where explicitly supplied; and
* temporal qualifications or uncertainty.

No current relationship is inferred merely because a cease date is absent. Notification, filing, capture, extraction, and source-effective times remain distinct. Historical and contradictory relationships coexist. R4 does not implement latest-wins or temporal applicability policy.

#### Typed mapping has explicit lineage and deterministic validation

Every typed relationship must be reconstructable through:

```text
typed relationship extension
        ↓
Evidence Fact
        ↓
Extraction Run and mapper/extractor/version lineage
        ↓
Fact-to-Artifact support
        ↓
R3 locator(s)
```

The relationship extension records the grammar/schema version and the mapper or normalizer identity/version where that lineage is not already sufficient in the Extraction Run. Source-specific codes remain in bounded source metadata.

Provider/model-produced structured relationships pass deterministic schema validation before the typed extension is persisted. Validation covers party structures, allowed relationship basis, direction, value shape, numeric bounds, temporal fields, and support linkage.

Malformed typed output never becomes a clean relationship. A safe underlying ordinary Fact may still be preserved with its raw source wording and support. The failed/partial mapping remains visible through immutable Extraction Run support/completeness or failure metadata. A post-hoc mapper failure leaves the input Fact unchanged and records no typed relationship.

Provider confidence, where supplied, may be retained as extraction metadata. It is not evidence strength, UBO confidence, KYC confidence, a winner threshold, or policy sufficiency.

#### One additive persistence structure is justified

Opaque `fact_value` JSONB alone is insufficient because it provides no enforceable relationship grammar or queryable typed integrity. A standalone relationship domain disconnected from `evidence_facts` is also rejected because it would duplicate Fact identity and lineage.

R4 uses the smallest forward-only additive persistence structure after migration 016: a one-to-zero/one relationship extension keyed by `fact_id`. Critical enums and value-shape invariants are enforced through deterministic domain validation and database constraints where practical; bounded party, qualifier, source-specific, and precision metadata may remain validated JSONB snapshots.

Migration 017 is authorized as the next migration. Migrations 010–016 remain immutable. Exact table/property names and the final split between typed columns and validated JSONB are reversible implementation details within this approved persistence direction.

#### A4a remains the evaluation boundary

R4 does not change A4a's Fact-to-Information-Need responsibility. A typed relational Fact is still an immutable Fact that A4a may evaluate against an explicitly supplied Need.

No A4a schema migration is currently required. Existing semantic evaluation can receive a structured Fact snapshot. A future deterministic relational comparator may read the typed extension under A4a's already governed structured/component-comparison authority, but that implementation is separately scoped. R4 does not automatically run A4a or assess collections/cardinality.

#### Companies House PSC compatibility

Companies House PSC API Artifacts already preserve `kind`, `natures_of_control`, names, notification dates, cease dates, statements, and raw pagination. The current A2 deterministic extractor stores schema-specific objects and an ownership/voting band object, but those values are not provider-neutral typed relationships and A2 is not changed by R4 governance.

A future R4 mapper may deterministically map:

* an explicitly typed PSC person/entity to the corresponding source-party type;
* `ownership-of-shares-*` codes to `ECONOMIC_OWNERSHIP` ranges;
* `voting-rights-*` codes to `VOTING_RIGHTS` ranges;
* explicit appointment/removal codes to the corresponding neutral rights; and
* significant-influence/control codes to a qualified neutral relationship.

The original Companies House code remains source-specific metadata and, where mapping is a transformation of a source-code Fact, derivation lineage is required. A cease date may support ceased/historical state. Absence of a cease date is not silently converted to current without a governed authoritative source rule.

PSC statements, exemptions, unavailable information, and no-registrable-PSC states are valid source evidence but are not party-to-party relationships. They remain ordinary Facts/state evidence and must never become fake zero-ownership relationships.

### Consequences

R4 can make individual source relationships machine-readable while retaining the ordinary Fact, source wording, support state, Artifact support, locators, and immutable interpretation history. Contradictory relationship Facts can coexist without winner selection. One Artifact may support several relationships, and each relationship remains independently traceable.

The decision introduces no master entity system, UBO domain, ownership-chain calculation, source winner, KYC decision, A4b aggregation, or change to existing KYC behavior.

Architecture Authority approved the one-to-one extension model, initial versioned relationship vocabulary, party snapshot grammar, value/temporal grammar, direct-versus-derived mapping rule, and migration 017 direction on 2026-09-01.

---

## ADR-018 — Provisional Evidence Coverage, Completeness, and Comparable-Disagreement Assessment

**Status:** APPROVED — IMPLEMENTATION AUTHORIZED

**Date:** 2026-09-01

**Raised by:** Architecture Authority

### Context

ADR-013 split A4 into immutable Fact-to-Information-Need evaluation (A4a) and later provisional coverage/conflict assessment (A4b). A4a is implemented and preserves whether each immutable Fact addresses a supplied Information Need without changing A3 support or determining KYC satisfaction. ADR-017 and R4 add typed source-relationship Facts without coverage, aggregation, winner selection, indirect ownership, UBO qualification, or downstream decisioning.

Repository diagnosis confirms that the current Information Need stores only its Requirement, schema reference/version/configuration lineage, and schema field identifier. It has no scalar/collection shape, cardinality, one-of/all-of rule, legitimate-empty rule, temporal checkpoint, expected type/value, completeness proof rule, freshness, or source-suitability semantics. `evidence_requirements.status` remains only `open` or `closed` lifecycle state.

The platform already preserves several distinct completeness signals: A2 collection/acquisition/capture outcomes; A3 selected-input and extraction completeness; A3 Fact support; A4a Fact-to-Need evaluation; and R4 typed value/relationship/temporal shape. None is equivalent to Information Need completeness or final KYC satisfaction.

### Decision

#### A4b is an immutable provisional Evidence assessment

A4b may assess an explicitly supplied Information Need using an explicitly selected immutable set of A4a evaluations and related source-backed Evidence signals.

It may report coverage, completeness, legitimate-empty evidence, comparable disagreement, temporal applicability, and missing-input/policy limitations. It must not select an operative value or source winner, determine customer correctness, calculate indirect ownership, identify a UBO/controller, mutate a canonical graph, or determine final KYC satisfaction or a compliance decision.

#### Assessment semantics use a hybrid ownership model

The existing Information Need remains the stable Evidence target and is not mutated into a consumer policy object.

The consuming domain supplies a bounded, versioned Assessment Specification for the assessment purpose. Evidence validates and deterministically canonicalizes its neutral contract, persists the exact immutable specification snapshot/reference with the assessment run, applies only those supplied semantics to Evidence-owned provenance/facts, and returns explicit limitations where inputs are absent. The specification accepts data and opaque references only; it must not accept arbitrary executable policy or prompt text.

Evidence owns Fact/Evaluation identity, provenance, capture/source-effective/effective timestamps, immutable assessment lineage, neutral comparator execution, and qualified output. Whether a downstream process requires the Need to be satisfied is not an A4b assessment input. The consuming domain owns requiredness, acceptable freshness, source suitability/corroboration, temporal checkpoint policy, and final satisfaction/decision meaning. Consumer policy objects are not imported directly; neutral versioned inputs and opaque external policy references cross the boundary.

Where a required specification or policy input is absent, A4b returns `indeterminate` or `policy/context required`. It does not invent defaults.

The bounded specification contains semantic equivalents of: specification version; scalar/collection Need shape; optional expected Evidence-native value shape; named/versioned comparator profile; optional complete-set and cardinality semantics; temporal scope (`any`, `current`, `as_of`, or `historical`) and an `as_of` checkpoint where required; bounded caller-supplied party associations; bounded candidate eligibility/suitability context; and opaque external policy references. Required/optional business-process status, downstream thresholds, UBO rules, and final-satisfaction semantics are excluded.

#### Assessment dimensions remain separate

Coverage, completeness, comparable disagreement, temporal applicability, and assessment-input/policy sufficiency are separate result dimensions with reasons, qualifications, limitations, and contribution lineage. They must not be collapsed into one overloaded status.

The neutral conceptual vocabulary includes:

* coverage: covered, partially covered, uncovered, or indeterminate;
* completeness: complete, incomplete, indeterminate, or not applicable;
* comparable disagreement: none, present, indeterminate, or not applicable;
* temporal applicability: applicable, partially applicable, not applicable, or indeterminate;
* empty-set state: established empty, not established, indeterminate, or not applicable; and
* input sufficiency: sufficient or insufficient.

These dimensions remain independently visible and must never be collapsed into `KYC satisfied = true`.

#### A4a evaluations are explicit immutable inputs

An A4b assessment records the exact A4a evaluation IDs and corresponding Fact IDs it consumed, plus relevant typed set-assertion Facts where applicable. It does not silently select the latest evaluation, search for newer Facts, or rerun semantic A4a matching. Later Facts, A4a reevaluation, specification changes, or policy changes create a new A4b assessment; earlier assessments remain reconstructable.

#### Scalar comparison is bounded and non-operative

For a scalar Need, A4b may determine whether candidate evaluations provide coverage and whether genuinely comparable values agree, are compatible, disagree, or cannot safely be compared under a named/versioned comparator.

Scalar typed comparison requires compatible types and identifier schemes. Normalized text requires the same concept and an explicit conservative normalizer/version. Structured addresses require an approved component and address-role mapping. A disagreement never selects a winner.

#### Collection completeness requires explicit closing evidence

Collection membership remains represented by individual Facts or typed relationship Facts. Observed members do not establish a complete set.

A complete collection assessment requires a supplied specification defining the set/cardinality semantics plus Evidence capable of closing the set: for example an explicit source-supported total or completeness statement, or a governed authoritative complete-set contract combined with successful source collection and complete extraction. Pagination completion may be necessary but is not sufficient by itself.

A4b distinguishes observed-member count, source-declared total, supplied cardinality, source collection completeness, extraction completeness, and Information Need completeness.

#### Legitimate empty is explicit source evidence

An explicit source assertion such as `no registrable PSC` is materially different from failed collection, partial collection, incomplete extraction, no extracted Fact, or a requested concept that was not evaluated.

Legitimate empty must be represented without a fake party, fake relationship, or zero ownership. The approved model is a generic typed set-assertion extension keyed one-to-zero/one by an ordinary Evidence Fact, analogous to R4 typed relationships. The ordinary Fact retains Extraction Run, source wording, Artifact support, R3 locator, support state, and immutable history.

The extension records a versioned set concept; empty state (`established_empty`, `non_empty`, or `unknown`); completeness state (`complete`, `incomplete`, or `unknown`); optional explicit member count only where the source supplies it; current/historical/unknown temporal state and explicit effective dates; and bounded source-specific metadata. Direct source statements may carry direct extensions. Deterministic source mapping creates a new derived Fact with explicit mapper/version lineage rather than rewriting an input Fact. Failed or incomplete acquisition and zero extracted Facts never create an established-empty assertion. No historical rows are automatically backfilled.

Until explicit source evidence and the supplied empty-set semantics are available, A4b returns indeterminate rather than inferring empty or complete.

#### Comparable disagreement respects concept, identity, measure, and time

Numeric exact/range values are comparable only when concept, relationship, measure, unit, party association, and temporal basis are compatible. An exact value outside a range or non-overlapping ranges may disagree; overlapping ranges are compatible but not proof of equality.

Different relationship types such as economic ownership and voting rights do not conflict automatically. Non-overlapping historical periods do not conflict automatically. Unknown currentness remains unresolved. R4 source-party snapshots are not canonical identities; cross-source relationship comparison requires exact stable source identifiers or an explicit upstream party association, not name similarity.

Every disagreement finding retains candidate/evaluation IDs, compared values, source/capture/effective dates, comparator/version, comparability reason, disagreement nature, and limitations. It never records a winner.

#### Temporal, source-suitability, and freshness policy remain supplied inputs

Evidence owns source/capture/effective factual timestamps. The consumer-owned Assessment Specification supplies any checkpoint/as-of date and policy rule defining currentness, freshness, source suitability, or corroboration. A4b may apply those supplied rules but may not create universal trust tiers, Companies-House-always-wins, fixed-age validity, latest-wins, or customer-evidence policy.

Missing necessary policy produces an explicit indeterminate/policy-input-required result.

#### Additive immutable persistence is expected

Future A4b implementation should use additive structures conceptually equivalent to:

* an immutable coverage assessment run linked to the Information Need and containing the specification reference/version/snapshot, evaluator/comparator lineage, assessment time, multidimensional results, and limitations;
* candidate/contribution rows linked to exact A4a evaluations and Facts; and
* comparable-disagreement finding/link rows retaining comparator and temporal basis.

The same additive migration may include the approved typed set-assertion extension for legitimate-empty and complete-set source assertions. No existing status or mutable Fact JSON may be overloaded. Existing data requires no automatic backfill.

Migration 018 is authorized as one additive forward-only migration after 017. Migrations 010–017 remain immutable.

#### Requirement lifecycle and downstream decision ownership are unchanged

`evidence_requirements.status` remains requirement lifecycle only. It does not become Evidence coverage, KYC satisfaction, operative-value selection, or a decision state.

KYC/Onboarding/UBO or another authorized consumer retains source/value winner selection, operative values, final satisfaction, customer correctness/dispute handling, indirect-ownership calculation, UBO/controller qualification, approve/reject/refer/escalate decisions, and workflow progression.

### Consequences

A4b can produce reconstructable provisional Evidence assessments without pretending that Evidence owns consumer policy. Scalar and collection coverage remain truthful, legitimate empty states remain distinguishable from failure, comparable disagreements remain qualified and non-operative, and historical assessments remain immutable.

Architecture Authority approved the hybrid Assessment Specification boundary, bounded schema, separate outcome dimensions, typed set-assertion extension, explicit party-association boundary, deterministic comparator direction, immutable run/candidate/finding persistence, and migration 018 on 2026-09-01.

This decision authorizes only bounded A4b implementation and Lab characterization. It does not authorize KYC/UBO integration, indirect ownership, operative-value selection, winner selection, final satisfaction, provider calls, recollection, reinterpretation, schema mutation, or changes to existing KYC behavior.
