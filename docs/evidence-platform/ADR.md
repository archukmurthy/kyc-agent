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
