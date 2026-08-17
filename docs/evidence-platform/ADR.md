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

Stage A2 introduces Companies House as the first real producer. One requested collection obtains materially distinct source areas: Company Profile API, Officers API, PSC API, and the public Company Overview website. These source areas can succeed or fail independently. Real producer retries must be distinguished from intentional recollection, and identical artifact hashes must not collapse acquisition history.

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

Company Profile API, Officers API, PSC API, and Company Overview website are separate Acquisitions. A successful Acquisition may produce its corresponding Evidence Asset and Artifacts. A failed or inconclusive Acquisition remains durable history and produces no Evidence Asset. The overall collection may be successful, partial, failed, or inconclusive.

For structured Companies House APIs, exact response-body bytes are the primary machine-readable Artifacts and are fingerprinted with SHA-256. Paginated Officers and PSC responses are preserved page-by-page. Rendered website HTML and screenshot bytes are separate Artifacts on a separate website Evidence Asset. Website evidence does not replace or impersonate API evidence.

Source representations are preserved before deterministic schema-aligned extraction. Derived values retain lineage to the applicable Artifact and do not rewrite source facts. Ownership bands remain bands or explicitly identified minimums and are not converted into false exact percentages.

Companies House evidence is public independently self-sourced evidence and may later be associated with multiple contexts without copying the canonical Asset, subject to separately authorized acceptance and freshness rules.

The final A1 evidence graph for a collection is persisted transactionally. Artifact storage and database persistence must use deterministic retry-safe identities so a persistence retry does not create uncontrolled duplicates. SHA-256 equality does not define Acquisition identity, Asset identity, authorization, semantic equivalence, or reuse eligibility.

Stage A2 does not create a general evidence retrieval service, private-evidence API, filing/document producer, UBO redesign, matching engine, satisfaction engine, freshness engine, or KYC integration.

### Consequences

Stage A2 requires a small durable, producer-neutral collection-operation and idempotency boundary, transactional A1 graph persistence, durable artifact storage, an Evidence-owned Companies House producer, deterministic extractors, and an internal Evidence Lab acceptance surface.

Successful source areas survive and remain valid when another source area fails. Intentional recollection creates new history. Existing KYC, self-source, and UBO behavior remains unchanged.
