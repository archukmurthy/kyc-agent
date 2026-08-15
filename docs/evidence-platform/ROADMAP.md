# Evidence Platform — Controlled Implementation Roadmap

## Objective

Build the Evidence Platform incrementally while preserving existing KYC behavior and preventing architectural drift.

Each phase must have a bounded implementation authorization.

Completing one phase does not authorize the next.

---

# Phase 0 — Repository and Architecture Reconciliation

**Status:** FIRST PRIORITY

Before significant new implementation, establish the relationship between the target Evidence Platform architecture and the existing repository.

Codex should inspect:

- existing evidence-related models;
- document/file persistence;
- browser/capture implementation;
- Evidence Agent work;
- RFI-related evidence handling;
- DRS/evidence interactions;
- dossier concepts;
- provenance-related implementation;
- hashing/fingerprinting;
- audit/event history;
- existing KYC domain ownership;
- APIs and services likely to interact with Evidence;
- existing tests;
- database migrations.

Output:

```text
CURRENT STATE
TARGET STATE
GAPS
CONFLICTS
REUSABLE COMPONENTS
TECHNICAL DEBT RELEVANT TO EVIDENCE
MIGRATION RISKS
ARCHITECTURE QUESTIONS
RECOMMENDED IMPLEMENTATION SEQUENCE
```

This phase is diagnostic.

Do not perform architectural restructuring during Phase 0 unless separately authorized.

---

# Phase 1 — Canonical Evidence Foundation

Goal:

Create the minimum durable Evidence domain foundation.

Expected scope, subject to repository diagnosis:

- Evidence Asset identity;
- canonical persistence;
- basic evidence metadata;
- source/acquisition lineage;
- integrity/fingerprint semantics;
- ingestion boundary;
- retrieval;
- lifecycle foundations;
- foundational tests.

Key question:

> Can the platform ingest and later retrieve a canonical piece of evidence while proving what it is and where it came from?

Explicitly out of scope unless separately authorized:

- broad Evidence Agent orchestration;
- requirement matching;
- advanced extraction;
- dossier assembly;
- decisioning;
- broad KYC migration.

---

# Phase 2 — Provenance and Acquisition

Goal:

Establish durable evidence lineage.

Potential scope:

- Evidence Source;
- Acquisition Event;
- actor/process provenance;
- capture metadata;
- acquisition timestamps;
- acquisition mechanism;
- transformations;
- lineage queries;
- provenance reconstruction.

Key question:

> Can we reconstruct how this Evidence Asset entered the platform?

---

# Phase 3 — Evidence Collection Integration

Goal:

Connect evidence acquisition mechanisms to canonical Evidence ingestion.

Potential sources include:

- public websites;
- browser captures;
- screenshots;
- PDFs;
- official registries;
- APIs;
- analyst uploads;
- agent-generated acquisition workflows.

Key architectural requirement:

Collection mechanisms produce/submit evidence.

They do not become owners of canonical evidence semantics.

---

# Phase 4 — Observation and Extraction Lineage

Goal:

Allow systems and agents to derive structured observations while retaining exact lineage to source evidence.

Potential scope:

- Observation model;
- extraction run identity;
- extraction actor/model/process;
- evidence-to-observation relationships;
- confidence where appropriate;
- transformation history;
- re-extraction behavior.

Key question:

> For every material extracted value, can we identify exactly which evidence produced it and how?

---

# Phase 5 — Facts / Assertions and Evidentiary Support

Goal:

Represent normalized application knowledge separately from source observations.

Potential scope:

- assertion identity;
- normalization;
- observation-to-assertion lineage;
- multiple supporting sources;
- contradiction;
- supersession;
- confidence/quality semantics where approved;
- temporal validity.

Key question:

> Can the system distinguish what a source stated from what the platform concluded?

---

# Phase 6 — Evidence Requirements

Goal:

Represent what evidence is needed independently of the evidence itself.

Potential scope:

- requirement identity;
- requirement lifecycle;
- requirement target;
- evidence-to-requirement relationships;
- satisfaction;
- insufficiency;
- missing evidence;
- potentially contradictory evidence.

Key question:

> Can the system explain what evidence was required and why particular evidence did or did not satisfy the requirement?

---

# Phase 7 — Dossier and Evidence Packaging

Goal:

Construct coherent evidentiary views for workflows and decisions.

Potential scope:

- dossier identity;
- evidence membership;
- relevant assertions;
- point-in-time representation;
- dossier evolution;
- packaging/export boundaries.

Key question:

> Can we reconstruct the evidence picture presented for a defined purpose at a defined point in time?

---

# Phase 8 — Decision Provenance

Goal:

Connect material decisions to the information available when they were made.

Potential scope:

- decision event;
- decision actor;
- decision inputs;
- supporting assertions;
- supporting evidence;
- rules/models/process versions;
- decision explanation;
- subsequent change.

Key question:

> Can we explain why a decision was reasonable based on what was known at the time?

---

# Phase 9 — Regulatory Reconstruction

Goal:

Provide controlled historical reconstruction capabilities.

Potential queries:

```text
Show the complete evidentiary history for this customer.

Why did this field have value X on date T?

What evidence caused the value to change?

What evidence existed when this decision was made?

Who acquired this evidence?

What source produced it?

Has the retained artifact changed?

What conflicting information existed?

Which subsequent evidence superseded it?
```

Security and authorization must be explicit.

---

# Phase 10 — Advanced Evidence Agent Automation

Goal:

Allow Evidence Agents to automate larger portions of evidence acquisition and interpretation using the stable platform underneath them.

Agents should consume the Evidence Platform rather than create a parallel evidence model.

Potential capabilities:

- source selection;
- automated acquisition;
- source-specific collection;
- evidence quality assessment;
- retry/fallback;
- requirement-driven collection;
- change detection;
- automated refresh;
- analyst escalation.

---

# Parallel Work Rule

Parallel implementation is permitted only where ownership and integration boundaries are sufficiently stable.

Two workstreams must not independently invent competing definitions for:

- Evidence Asset;
- provenance;
- requirement;
- observation;
- assertion;
- dossier;
- lifecycle;
- evidence relationships.

Where multiple branches/worktrees are used, shared contracts must be explicitly identified.

---

# Phase Gate

Before moving from one material phase to another, review:

```text
1. What was implemented?
2. Which invariants were demonstrated?
3. What assumptions became visible?
4. Did implementation expose an architectural conflict?
5. Were any ADRs created?
6. Is existing KYC behavior intact?
7. Are migrations safe?
8. What technical debt was intentionally deferred?
9. Is the next boundary sufficiently defined?
```

Only then authorize the next phase.

---

# Immediate Authorized Direction

The first build-control exercise should be:

**Phase 0 — Repository and Architecture Reconciliation.**

Do not authorize a broad Evidence Platform build until that diagnostic has been reviewed against the architecture.
