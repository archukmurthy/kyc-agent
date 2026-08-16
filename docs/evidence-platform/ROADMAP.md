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

### Stage A2 — First Representative Producer

Use automated web/regulator evidence as the first demanding producer.

The target representative journey is conceptually:

```text
Company
→ Requirement
→ FCA/regulator source
→ browser/rendered acquisition
→ point-in-time capture
→ durable Evidence Asset
→ provenance + fingerprint
```

Do not assume existing capture implementations should simply be restored. Reuse appropriate components only where they fit the approved architecture.

### Stage A3 — Interpretation and Verification

Add:

* observations;
* normalized facts/assertions;
* richer interpretation and derivation lineage;
* independent re-extraction and verification capabilities.

Maintain the distinction between source evidence and derived knowledge.

### Stage A4 — Matching and Satisfaction

Add:

* Evidence Match;
* acceptance evaluation;
* requirement satisfaction;
* contradiction/insufficiency where required.

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
