# Evidence Platform — Controlled Implementation Roadmap

## Stage A — Build Evidence Platform V1 Independently

Goal:

Demonstrate the complete Evidence lifecycle independently of existing KYC/Pre-boarding UX.

Target lifecycle:

```text
Case / Investigation Context
        ↓
Evidence Requirement
        ↓
Acquisition
        ↓
Evidence Asset
        ↓
Durable Raw Artifact
        ↓
Integrity / Fingerprint
        ↓
Provenance
        ↓
Extraction
        ↓
Observation / Fact
        ↓
Evidence Match
        ↓
Requirement Satisfaction
        ↓
Evidence Ledger
        ↓
Evidence Package
```

An internal Evidence Lab/test harness should allow this lifecycle to be exercised without navigating the existing onboarding journey.

Stage A should be delivered through small bounded build briefs rather than one large implementation.

### Stage A0 — Platform Boundary and Evidence Lab Foundation

Establish the bounded Evidence Platform module, contracts, test boundary, and internal Evidence Lab shell.

No legacy integration.

### Stage A1 — Core Evidence Domain + Extraction Lineage

Establish the durable model, contracts, and bounded persistence necessary for:

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

Stage A1 uses fixtures/simulated data to prove this domain and lineage. It does not implement real Companies House acquisition, AI extraction, screenshot verification, matching, satisfaction, Evidence Ledger, Evidence Package, or KYC integration.

### Stage A2 — Companies House Evidence Producer

Build the first real Evidence Platform producer using UK Companies House.

Using the Stage A2 Companies House producer input contract:

```text
producer = companies_house
collection_coordinates = { jurisdiction: "GB", companyNumber: "..." }
```

independently collect and preserve:

* official Company Profile API response;
* complete paginated Officers API responses;
* complete paginated PSC API responses;
* rendered Company Overview HTML and screenshot;
* complete paginated Officers website HTML and screenshots;
* complete paginated PSC website HTML and screenshots, including legitimate statement, no-registrable-PSC, and unavailable or exempt states.

These inputs are producer-specific collection coordinates, not universal Evidence Platform identity fields. The core Evidence Collection Operation remains producer-neutral. The broader multi-jurisdiction and multi-producer input model remains deferred, and Stage A2 must not design it or structurally prevent future source-appropriate contracts.

KYC/Onboarding identifies the subject, resolves ambiguity or conflict, and determines the appropriate source and collection coordinates. Evidence Platform receives the resolved collection request, acquires and preserves evidence, fingerprints Artifacts, performs deterministic schema-aligned extraction, and maintains provenance. Stage A2 does not implement name-only Companies House matching or further identity resolution and discrepancy decisioning.

Treat Company Profile API, Officers API, PSC API, Company Overview website, Officers website, and PSC website as six independent Acquisitions coordinated by one durable collection operation. API evidence remains the authoritative structured source evidence; website evidence is supplementary and retains separate Evidence Assets and provenance. Preserve exact source representations, SHA-256 integrity, public-evidence provenance, deterministic API extraction lineage, independently observable website-capture completeness, retry idempotency, and intentional recollection. Website failure must not downgrade otherwise complete authoritative API evidence, and A2 does not add webpage extraction or API-to-web comparison.

Evidence Lab must visibly distinguish live collection from fixtures and allow Architecture Authority to inspect acquisitions, artifacts, fingerprints, failures, extracted values, and lineage.

Stage A2 does not include Companies House filing history or filing documents, KYC integration, UBO redesign, matching, satisfaction, verification, freshness/reuse decisioning, Ledger, Package, private-evidence APIs, other jurisdictions, or other producers.

### Stage A3 — Extraction, Interpretation, and Verification Lineage

Extend the A1/A2 Evidence domain so preserved Artifacts can produce reconstructable evidence-grounded facts through:

* deterministic extraction of reliably addressable structured values;
* AI-assisted semantic extraction where unstructured or ambiguous evidence requires interpretation;
* schema-directed extraction against upstream-supplied KYC/KYB information needs;
* bounded discovery of additional KYC/KYB-relevant facts without silently expanding the configured schema;
* explicit separation of requested and discovered facts;
* explicit separation of direct/source facts and derived/interpreted facts;
* explainable extraction-support states kept independent from source-trust policy;
* selective, on-demand independent re-extraction and verification;
* immutable Extraction Run and verification history, including disagreement;
* extractor, model, prompt/instruction, transformation, Artifact, and temporal lineage;
* qualified downstream outputs that remain useful when verification is still needed.

A3 extends the existing Artifact, Extraction Run, and extracted-value lineage. It may add the minimum persistence needed to represent discovered facts without fake schema identifiers and derived facts with explicit input/transformation lineage. Reuse or re-extraction must not restamp historical source observation or Artifact capture time.

To complete A3 acceptance, the isolated Evidence Lab must also prove a bounded A2-to-A3 integration path: select an existing persisted A2 Artifact, retrieve its bytes server-side from authorized Evidence storage, verify its stored SHA-256 fingerprint, and append a new A3 Extraction Run and facts against the existing provenance without recollecting or re-persisting the A1/A2 graph. The first real path may support Companies House JSON and rendered HTML; screenshot/image interpretation may follow through the same media-aware provider boundary rather than being forced through a text-only interface. Deterministic A2 extracted values retain their original history and must not be automatically duplicated as A3 facts. Synthetic fixture scenarios remain available but must be visibly distinguished from live preserved-Artifact interpretation.

A3 does not own source-trust policy, redesign existing KYC source steering, decide requirement satisfaction, select a winning source/value, resolve customer disputes, mutate schemas, or make KYC/compliance decisions. Final KYC context handoff and downstream UI integration remain deferred.

### Stage A4 — Matching and Satisfaction

Add:

* Evidence Match;
* acceptance evaluation;
* requirement satisfaction;
* contradiction/insufficiency where required;
* conflict evaluation and operative evidence/value selection under approved downstream policy.

### Stage A5 — Ledger and Package

Add:

* case Evidence Ledger;
* historical/evidentiary view;
* Evidence Package;
* package manifest sufficient to demonstrate the complete independent lifecycle.

### Stage A6 — End-to-End Evidence Lab Validation

Exercise and demonstrate the complete lifecycle through the Evidence Lab.

Stage A is complete when Evidence Platform V1 can independently demonstrate:

```text
Requirement
→ acquisition
→ durable evidence
→ provenance
→ integrity
→ interpretation
→ matching
→ satisfaction
→ ledger
→ package
```

without depending on the existing KYC customer journey.

---

## Stage B — Prove the Producer Abstraction

Prove that materially different evidence producers fit naturally into the same platform model.

At minimum validate:

### Producer 1 — Automated web/regulator evidence

Example: FCA/regulatory source.

### Producer 2 — Customer document

Example: passport or proof of address.

### Producer 3 — Authoritative registry/API evidence

Example: Companies House or equivalent structured authoritative source.

### Producer 4 — Analyst evidence

Manual analyst-provided evidence with actor attribution.

Stage B should test the architecture rather than create producer-specific parallel evidence models.

---

## Stage C — Integrate Existing Products

Once the independent Evidence Platform is proven, progressively integrate KYC and Pre-boarding.

Use adapters and bounded integration changes.

Potential integration surfaces include:

* existing DRS;
* Required Documents;
* amendment evidence;
* customer uploads;
* analyst uploads;
* self-source;
* Companies House;
* internet research;
* Applicant evidence;
* UBO evidence;
* dossier lifecycle;
* final submission.

Integration should proceed producer-by-producer/capability-by-capability rather than by rewriting the entire application.

Feature flags or equivalent controlled activation should be used where appropriate.

---

## Stage D — Retire Legacy Evidence Architecture

Only after replacement behavior is proven:

* retire ephemeral upload paths;
* retire regex/string-based evidence satisfaction;
* retire duplicated evidence metadata;
* migrate/archive obsolete Evidence MVP structures;
* remove superseded evidence storage paths;
* remove legacy integrations that no longer have consumers.

Deletion is the final step, not the migration strategy.
