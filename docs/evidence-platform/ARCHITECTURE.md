# Evidence Platform — Architecture and Design Authority

## 1. Purpose

The Evidence Platform provides a common evidence foundation for KYC and related investigative, analytical, regulatory, and agent-driven workflows.

Its purpose is not simply to store documents.

Its purpose is to create a trustworthy, reconstructable relationship between:

**source → capture → evidence → provenance → observation → fact/assertion → requirement → decision → dossier/history**

The platform should allow us to answer not merely:

> What do we believe now?

but:

> What did we know at a particular point in time, what evidence did we possess, where did it come from, what did it demonstrate, what changed, and why did we reach the conclusion we reached?

---

# 2. Architectural North Star

The Evidence Platform is the durable evidence and provenance substrate beneath KYC workflows.

KYC workflows may request evidence, analysts or agents may collect it, extraction systems may interpret it, and downstream processes may consume it.

The Evidence Platform owns the durable evidence story.

Conceptually:

```text
Evidence Source
      ↓
Acquisition / Capture
      ↓
Canonical Evidence Asset
      ↓
Provenance + Integrity
      ↓
Observation / Extraction
      ↓
Fact / Assertion
      ↓
Evidence Relationship
      ↓
Requirement / Investigation / Decision
      ↓
Dossier / Historical Reconstruction
```

These concepts may be implemented through different services, modules, tables, or interfaces over time.

Their semantic distinction must be preserved.

---

# 3. Core Domain Concepts

## Evidence Source

The origin from which evidence can be obtained.

Examples may include:

- public websites;
- official registries;
- regulatory sources;
- corporate websites;
- documents;
- customer-provided materials;
- internal systems;
- third-party data providers;
- analyst captures;
- agent acquisitions.

A source is not itself necessarily an Evidence Asset.

---

## Evidence Acquisition

The event/process by which evidence is obtained.

Acquisition captures context such as:

- acquisition mechanism;
- acquisition time;
- requested target;
- source;
- actor;
- collection method;
- technical metadata;
- success/failure;
- capture context.

Acquisition is an event/process.

Evidence is the durable artifact/result.

---

## Evidence Asset

The canonical durable representation of collected evidence.

An Evidence Asset must have stable identity independent of whatever workflow happened to request it.

Depending on evidence type, an asset may reference or contain:

- document;
- screenshot;
- PDF;
- HTML;
- API response;
- structured record;
- registry result;
- captured webpage;
- image;
- other immutable or versioned evidence representation.

An Evidence Asset must be capable of carrying sufficient metadata and provenance to establish what it represents.

---

## Provenance

Provenance records where evidence came from and the relevant circumstances under which it was obtained.

The platform must preserve enough information to establish lineage between:

- source;
- acquisition;
- asset;
- transformations;
- observations;
- facts/assertions;
- downstream use.

Provenance is not optional descriptive metadata.

It is part of the evidence model.

---

## Integrity / Fingerprint

Where applicable, Evidence Assets should carry cryptographic or equivalent integrity information sufficient to demonstrate whether the retained representation has changed.

Integrity controls must have explicit semantics.

A hash should answer a defined question such as:

> Is the artifact being examined byte-for-byte identical to the artifact originally retained?

Integrity mechanisms must not imply stronger guarantees than they actually provide.

---

## Observation

An Observation represents something extracted or observed from evidence.

Examples:

- a company name appearing on a registry record;
- a registered address;
- a director;
- a date;
- ownership percentage;
- status;
- a statement on a webpage.

Observations must retain lineage to the evidence from which they were obtained.

---

## Fact / Assertion

A normalized proposition used by the application.

Facts/assertions may be supported by one or more observations and Evidence Assets.

The system must preserve the distinction between:

```text
source says X
```

and:

```text
the platform currently believes X
```

They are not semantically equivalent.

---

## Evidence Relationship

Evidence can support, contradict, supersede, contextualize, or otherwise relate to a fact, assertion, requirement, or decision.

These relationships should be explicit enough to support reconstruction and explanation.

---

## Evidence Requirement

A declaration that evidence is needed to establish or investigate something.

A requirement is not evidence.

A requirement can result in collection activity and may eventually be satisfied by one or more Evidence Assets.

Requirement lifecycle and evidence lifecycle must remain distinguishable.

---

## Dossier

A Dossier represents a coherent evidentiary picture assembled for a particular purpose or point in a lifecycle.

It is not simply a folder of documents.

It must eventually be possible to understand:

- which evidence formed the dossier;
- what the evidence supported;
- what state existed at the relevant time;
- how the dossier evolved;
- why particular decisions were reached.

---

# 4. Architectural Boundaries

The architecture should preserve conceptual separation between:

### Collection

Finding and acquiring evidence.

### Evidence Management

Persisting canonical assets, identity, provenance, integrity, lifecycle, and relationships.

### Interpretation

Extracting observations and deriving normalized facts/assertions.

### Requirements

Determining what evidence is required.

### Decisioning

Determining what conclusion or action follows from available facts/evidence.

### Packaging / Dossier

Creating a coherent evidentiary view for a defined purpose.

### Existing KYC Domain

Existing KYC workflows remain consumers/integrators of Evidence Platform capabilities rather than being silently rewritten around the new platform.

These boundaries do not necessarily require independent deployed services.

They are semantic ownership boundaries.

---

# 5. Fundamental Invariants

## INV-01 — Stable Evidence Identity

An Evidence Asset has durable identity independent of the workflow that currently references it.

## INV-02 — Provenance Preservation

Evidence cannot lose its source/acquisition lineage as it travels through downstream processing.

## INV-03 — Source vs Derived State

Source evidence, extracted observations, normalized assertions, and decisions remain distinguishable.

## INV-04 — Historical Reconstruction

Updating current state must not make material historical states impossible to reconstruct.

## INV-05 — Integrity Semantics

Where an integrity fingerprint exists, its scope and meaning must be unambiguous.

## INV-06 — Evidence Does Not Equal Requirement

Evidence lifecycle and requirement lifecycle remain distinct.

## INV-07 — Collection Does Not Own Truth

Collection acquires evidence. It does not determine final business truth merely because it captured something.

## INV-08 — Interpretation Retains Lineage

Any material observation derived from evidence must be traceable to its supporting evidence.

## INV-09 — Decisions Remain Explainable

A material decision must ultimately be capable of being reconstructed through the facts/assertions and evidence available to the decision process.

## INV-10 — Existing KYC Behavior Is Protected

Introducing Evidence Platform capability does not implicitly authorize changes to established KYC behavior.

## INV-11 — Auditability Is Architectural

Audit and reconstruction capabilities must emerge from the domain model rather than being bolted on after implementation.

## INV-12 — Evidence Reuse Does Not Destroy Context

The same canonical Evidence Asset may potentially support multiple requirements or investigations without becoming owned by one of them.

---

# 6. Reconstruction Model

The architecture should eventually make the following query possible:

```text
For Party X
at Time T:

What did we believe?
What evidence supported it?
Where did that evidence come from?
When was it acquired?
Was it subsequently changed or superseded?
What observations were extracted?
What conflicting evidence existed?
Which requirements did the evidence satisfy?
Which decisions relied upon it?
Who or what made those decisions?
What changed afterward?
```

This capability is relevant to:

- customers;
- analysts;
- automated agents;
- internal quality/compliance teams;
- regulators;
- appropriately authorized investigative/legal requests.

It is therefore a foundational design requirement rather than a reporting enhancement.

---

# 7. Evidence Lifecycle

The precise implementation may evolve, but the architecture should accommodate a lifecycle conceptually similar to:

```text
requested / discovered
        ↓
acquired
        ↓
canonicalized
        ↓
integrity established
        ↓
observed / extracted
        ↓
related to assertions/requirements
        ↓
consumed in investigation/decision
        ↓
superseded / expired / invalidated where applicable
        ↓
retained for historical reconstruction
```

Superseded evidence should not ordinarily disappear simply because newer evidence exists.

---

# 8. Provenance Chain

The system should support lineage resembling:

```text
Source
  ↓
Acquisition Event
  ↓
Evidence Asset
  ↓
Transformation(s)
  ↓
Observation(s)
  ↓
Assertion(s)
  ↓
Requirement / Decision / Dossier
```

Not every Evidence Asset will necessarily use every stage.

However, implementations must not collapse the chain in a way that prevents later reconstruction.

---

# 9. Human and Agent Symmetry

The platform should assume evidence can be acquired or interpreted by:

- humans;
- deterministic software;
- AI agents;
- third-party systems.

The provenance model should identify the responsible actor/process where relevant.

An AI-produced interpretation must not become indistinguishable from source evidence.

---

# 10. Regulatory and Investigative Reconstruction

The architecture must support at least two distinct external reconstruction patterns.

### Regulatory Review

A regulator may select a customer, field, decision, or period and ask:

> Why was this resolved this way?

The system should support reconstruction of the relevant evidence and decision history.

### Authorized Investigation

An appropriately authorized investigative request may require reconstruction of relationships, evidence, transactions, parties, or historical state across the institution's available information.

The Evidence Platform should provide trustworthy provenance and evidentiary history to authorized downstream processes without weakening normal access controls.

---

# 11. Security and Access Principle

The existence of comprehensive evidence lineage does not imply universal access.

Evidence may have different:

- sensitivity;
- legal restrictions;
- retention rules;
- jurisdictional constraints;
- access permissions.

Architecture should allow evidence identity/provenance to coexist with appropriate authorization boundaries.

---

# 12. Integration Principle

The Evidence Platform should expose capabilities through deliberate interfaces rather than requiring every KYC module to understand evidence persistence internals.

Consumers should interact with stable domain capabilities.

A representative conceptual API might eventually include operations such as:

```text
ingestEvidence(...)
getEvidence(...)
findEvidence(...)
recordObservation(...)
relateEvidence(...)
getEvidenceHistory(...)
reconstructEvidenceState(...)
```

These names are illustrative until explicitly approved as implementation contracts.

---

# 13. What Is Not Yet Frozen

This architecture intentionally does **not** automatically freeze:

- exact database schema;
- exact table names;
- deployment topology;
- service count;
- queue technology;
- storage vendor;
- programming patterns;
- internal framework choices;
- exact API signatures;
- every lifecycle status.

Those become frozen only through approved implementation decisions or ADRs.

---

# 14. Architecture Change Threshold

A change requires Architecture Authority review if it materially changes:

- a domain concept;
- an invariant;
- data ownership;
- lifecycle semantics;
- provenance semantics;
- identity;
- historical reconstruction;
- service/module responsibility;
- an approved interface;
- compatibility expectations;
- audit semantics.

Implementation choices below that threshold remain with Codex/engineering.

---

# 15. Governing Principle

The Evidence Platform should make evidence **durable, attributable, explainable, reusable, integrity-verifiable, and historically reconstructable**.

The goal is not simply to prove that a document exists.

The goal is to preserve the chain by which evidence becomes knowledge and knowledge becomes a decision.
