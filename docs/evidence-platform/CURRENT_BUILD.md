# Evidence Platform — Current Build Brief

**Current phase:** Phase 0 — Repository and Architecture Reconciliation

**Authorization type:** Diagnostic only

**Architecture changes authorized:** None

**Production behavior changes authorized:** None

**Database migrations authorized:** None

**Broad refactoring authorized:** None

---

# Objective

Inspect the existing repository and determine how the current implementation relates to the approved Evidence Platform architecture.

The purpose is to establish the safest implementation path before new Evidence Platform foundations are built.

---

# Required Inputs

Read and follow:

1. Evidence Platform — Architecture and Design Authority
2. Evidence Platform — Architecture Decision Log
3. Evidence Platform — Controlled Implementation Roadmap
4. Evidence Platform — Standing Instructions for Codex
5. This Current Build Brief

Where repository behavior conflicts with these documents, do not silently resolve the conflict.

Report it.

---

# Investigation Scope

Inspect the repository for implementation related to:

- evidence;
- documents and attachments;
- source/citation/provenance concepts;
- capture/browser/screenshot/PDF functionality;
- Evidence Agent functionality;
- RFI evidence collection;
- DRS/evidence interaction;
- dossier/case packaging;
- UBO-related evidence/provenance;
- audit trails;
- hashing/fingerprinting;
- historical state;
- workflow events;
- existing KYC persistence and domain models;
- external source acquisition;
- extraction/normalization;
- existing tests covering any of the above.

Follow references rather than relying only on filename searches.

---

# Questions to Answer

## Existing Evidence Model

What currently represents evidence?

Is evidence currently:

- a file;
- attachment;
- document;
- URL;
- screenshot;
- database entity;
- workflow artifact;
- combination of these?

Where is its identity defined?

Who owns it?

---

## Persistence

Where are evidence-like artifacts persisted?

What database entities, object storage, or external systems are involved?

What lifecycle exists?

Are records mutated, replaced, versioned, or appended?

---

## Provenance

What provenance is currently retained?

Can the system determine:

- original source;
- URL/source identifier;
- acquisition time;
- acquisition actor/process;
- capture mechanism;
- transformation history;
- evidence-to-fact lineage?

Identify what exists and what is missing.

---

## Integrity

Search for:

- hashes;
- fingerprints;
- checksums;
- immutable storage;
- content-addressed storage;
- audit signatures;
- tamper detection.

For each mechanism found, establish what it actually guarantees.

---

## Collection

Identify current mechanisms for:

- browser collection;
- screenshots;
- PDF generation;
- registry lookup;
- API acquisition;
- analyst upload;
- Evidence Agent collection.

Determine where collected artifacts currently go.

---

## Interpretation

Identify current mechanisms for:

- OCR;
- extraction;
- normalization;
- fact creation;
- LLM interpretation;
- analyst interpretation.

Determine whether source lineage survives these transformations.

---

## Requirements / RFI

Determine how evidence requests are currently represented.

Establish whether requirement semantics are mixed with evidence persistence.

---

## Dossier / Decision

Determine whether evidence is currently associated with:

- cases;
- customers;
- investigations;
- decisions;
- reviews;
- dossiers.

Determine whether historical reconstruction is currently possible.

---

## Existing KYC Dependencies

Identify existing KYC modules that would be affected by introducing canonical Evidence Platform capability.

Do not modify them.

Map dependencies and integration boundaries.

---

# Required Deliverable

Return a structured diagnostic with these sections.

## 1. Executive Summary

Concise description of the current Evidence-related architecture and the most important gaps.

## 2. Repository Map

Relevant files/modules/services/tables and their responsibilities.

## 3. Current Evidence Flow

Trace at least the major existing flow(s):

```text
source/request
→ collection
→ persistence
→ extraction
→ KYC usage
→ audit/history
```

Use actual repository components.

## 4. Current Domain Model

Describe existing evidence-related entities and ownership.

## 5. Architecture Comparison

For each major target concept:

```text
Evidence Source
Acquisition
Evidence Asset
Provenance
Integrity
Observation
Assertion
Evidence Requirement
Dossier
Decision lineage
Historical reconstruction
```

classify current support as:

```text
EXISTS
PARTIAL
ABSENT
CONFLICTS WITH TARGET
UNCLEAR
```

and provide repository evidence for the classification.

## 6. Reusable Components

What existing implementation should probably be preserved?

Explain why.

## 7. Architectural Conflicts

Anything in the current implementation that conflicts with an approved invariant.

Do not solve these automatically.

## 8. Migration Risks

Identify persistence, compatibility, operational, or historical-data risks.

## 9. Test Coverage

What relevant behavior is already protected by tests?

What critical behavior lacks tests?

## 10. Recommended Phase 1 Boundary

Based on repository reality, propose the smallest safe implementation scope for:

**Canonical Evidence Foundation**

Do not implement it.

## 11. Proposed Architecture Decisions

If repository reality exposes decisions that Architecture Authority must make, list each as a separate proposed ADR.

## 12. Out-of-Scope Findings

Anything important discovered that should be handled later.

---

# Evidence Standard for the Diagnostic

For every important claim, identify the concrete repository evidence supporting it:

- file;
- class/function;
- schema/migration;
- test;
- runtime configuration;
- call path.

Separate:

**OBSERVED IN CODE**

from:

**ASSUMPTION**

from:

**RECOMMENDATION**

from:

**ARCHITECTURE CHANGE PROPOSED**

---

# Constraints

Do not:

- implement the Evidence Platform;
- create new architecture;
- perform broad refactors;
- modify existing KYC behavior;
- introduce migrations;
- rename major domain concepts;
- remove apparently obsolete Evidence-related code;
- "clean up" architecture while investigating.

Minor temporary investigative tooling is acceptable if necessary, but avoid material repository changes.

---

# Completion Condition

Phase 0 is complete when Architecture Authority can answer:

> Given what actually exists in the repository, what is the smallest safe first implementation that moves us toward the approved Evidence Platform architecture without accidentally rewriting KYC or creating a second competing evidence architecture?

Stop after delivering the diagnostic.

Wait for Architecture Authority review before implementing Phase 1.
