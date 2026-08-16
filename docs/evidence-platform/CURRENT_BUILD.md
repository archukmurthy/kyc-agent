# Evidence Platform — Current Build Brief

# Stage A1 — Core Evidence Domain + Extraction Lineage

## Objective

Build the minimum durable Evidence Platform domain required to represent:

```text
business evidence need
        ↓
attempt to obtain evidence
        ↓
evidence obtained
        ↓
preserved representations
        ↓
provenance/integrity
        ↓
schema-aligned extraction lineage
```

This phase establishes the core model.

It does not connect a real external evidence producer yet.

---

## Required Stage A1 capabilities

Implement the minimum architecture necessary to represent and persist:

### Evidence Requirement

A business-level evidence requirement containing one or more information needs aligned to existing KYC/KYB schema concepts.

Do not create one Evidence Requirement per field.

### Evidence Acquisition

Record an attempt to obtain evidence.

Support at minimum:

* success;
* failure;
* inconclusive.

Retain timestamps, source/method context, outcome and failure/inconclusive reason where applicable.

### Evidence Asset

Represent a distinct logical piece of evidence produced by a successful acquisition.

One Acquisition may produce zero, one or many Evidence Assets.

### Evidence Artifact

Represent a preserved source representation belonging to an Evidence Asset.

Support metadata necessary to distinguish artifact type/representation and durable storage reference.

Do not implement speculative support for every possible artifact format.

### Integrity

Persist cryptographic artifact fingerprint information sufficient for tamper/integrity verification.

Use the architecture-approved SHA-256 approach unless repository constraints reveal a reason requiring Architecture Authority review.

### Provenance

Preserve sufficient provenance to reconstruct:

* source;
* acquisition;
* method;
* actor/system where applicable;
* collection time;
* subject/context where appropriate;
* source locator/reference where available.

Do not force all producer-specific metadata into the canonical asset if it belongs in producer/acquisition metadata.

### Evidence Subject Reference

Record the real-world subject of evidence using available stable surrounding-platform references and/or authoritative source identifiers where appropriate.

The same real-world company must not be treated as a different subject solely because it appears in different cases or customer contexts.

Do not build a new global master-entity/company identity system. Evidence owns the evidence-to-subject relationship, not global entity resolution.

If repository inspection finds no safe existing way to represent the necessary subject reference without making a new canonical identity decision, STOP and report that specific issue.

### Provenance/access class and reuse boundary

Represent provenance/access class sufficiently to distinguish:

* independently self-sourced public evidence, which may be structurally eligible for reuse across tenant/customer contexts subject to later acceptance, freshness, suitability, security and policy rules; and
* customer-provided/private evidence, which is context/tenant restricted and must not be reused across unrelated tenants/customer contexts.

A1 does not implement the full cross-tenant reuse decision engine. Its model must permit future eligible public-evidence reuse while prohibiting cross-tenant private-evidence reuse or visibility.

Identical fingerprints do not authorize reuse or access. Any future physical deduplication must preserve logical isolation.

### Extraction Run

Represent a derivation/extraction operation performed against preserved evidence.

The design must support multiple extraction runs against the same evidence over time.

### Schema-aligned Extracted Values

Represent extracted values mapped to existing applicable KYC/KYB schema concepts.

Each extracted value must retain lineage to the Extraction Run and underlying evidence/artifact.

The existing configurable KYC/KYB schema is authoritative. Do not create a parallel Evidence field ontology.

Where a stable schema/version identifier exists, record it in Extraction Run lineage. The current configurable schema has no explicit version identifier, so A1 must allow the version reference to be absent/null or use a clearly documented non-breaking `current/latest` compatibility convention consistent with repository conventions.

Do not invent historical version numbers, build schema versioning inside Evidence Platform, or fail lineage because no explicit version exists. Preserve a non-destructive path for recording real schema versions later where reasonably possible.

Do not implement actual AI extraction in A1.

Use fixtures/test data to prove the lineage model.

---

# 5. Persistence

Stage A1 may introduce new forward-only Evidence Platform persistence/migrations as required.

Do not alter or repurpose existing KYC evidence tables.

Do not migrate legacy evidence during A1.

Do not dual-write existing KYC flows.

The new persistence belongs to the bounded Evidence Platform.

Before finalizing schema design, inspect existing repository/database conventions and follow them where they do not conflict with approved Evidence architecture.

If a schema decision would materially constrain future architecture and is not resolved by the approved ADRs, STOP and raise it rather than guessing.

---

# 6. Minimal Service/API Surface

Extend the A0 Evidence Platform boundary only as necessary to exercise and test the Stage A1 domain.

Do not build a broad public API.

Prefer a minimal internal service boundary.

Evidence Lab may be extended enough to demonstrate/test A1 using dummy data.

Do not create a polished UI.

A useful A1 Evidence Lab demonstration might show:

```text
Requirement:
Verify company registration details

Acquisition:
Companies House simulation
SUCCESS

Evidence:
Company profile

Artifacts:
machine-readable capture
screenshot

Extraction:
legal_name -> ABC Limited
company_number -> 12345678
status -> Active
registered_address -> 25 King Street

Lineage:
each value traces back to extraction + artifact + evidence + acquisition
```

This is fixture/simulated evidence.

Do not connect Companies House yet.

---

# 7. Required Tests

Tests should demonstrate at minimum:

1. one Requirement can contain multiple schema-aligned information needs;
2. failed Acquisition exists without Evidence Asset;
3. inconclusive Acquisition exists without Evidence Asset;
4. successful Acquisition can produce multiple Evidence Assets;
5. one Evidence Asset can have multiple Artifacts;
6. artifacts have integrity fingerprints;
7. recollection can create new evidence without overwriting old evidence;
8. identical artifact content does not require loss of separate provenance/acquisition history;
9. one Evidence Asset is structurally capable of being associated with multiple requirements/contexts without copying the evidence;
10. multiple Extraction Runs can reference the same preserved evidence;
11. extracted values trace back to their Extraction Run and underlying evidence/artifact;
12. schema concepts distinguish values such as `registered_address` and `operating_address`;
13. eligible public evidence is structurally reusable across contexts while private/customer evidence remains context/tenant restricted;
14. identical fingerprints do not collapse separate access/provenance boundaries;
15. evidence can reference a stable real-world subject without introducing a global entity-resolution system;
16. extraction lineage works without an explicit schema version and can accommodate a future real version identifier;
17. no existing KYC evidence behavior is changed.

Do not build Stage A4 matching/satisfaction merely to satisfy test #9.

Test structural capability only.

---

# 8. Explicitly Out of Scope

Do NOT implement:

* real Companies House integration;
* FCA integration;
* general internet research;
* browser automation;
* real screenshot capture;
* real AI extraction;
* second/verification extractor;
* automatic discrepancy detection;
* source trust ranking;
* freshness admin UI;
* freshness decision engine;
* Evidence Match;
* requirement satisfaction;
* Evidence Ledger;
* Evidence Package;
* customer contest workflow;
* customer replacement UX;
* analyst routing;
* KYC decisioning;
* DRS integration;
* Required Documents integration;
* existing upload migration;
* UBO migration;
* legacy Evidence migration;
* deletion or modification of existing evidence mechanisms.

---

# 9. Existing Application Protection

Existing KYC and Pre-boarding behavior remains a protected boundary.

Prefer additive Evidence Platform files, tables and internal routes/services.

Any required modification to an existing application file must be:

* minimal;
* explicitly reported;
* justified;
* regression tested.

Do not refactor unrelated existing code.

---

# 10. Implementation Authority and Deferred Decisions

Codex may choose the following as implementation details within the approved architecture:

* exact Evidence table names;
* internal API/service contract names;
* exact lifecycle enum/status names;
* migration implementation details;
* normal reversible code organization decisions.

The following are deliberately deferred and must not be solved during A1:

* detailed evidence retention/deletion policy;
* storage-provider optimization/selection beyond the minimum A1 need;
* source-specific trust ranking;
* detailed freshness semantics/configuration;
* full cross-tenant reuse decision engine;
* global entity resolution;
* schema-versioning implementation.

Use the smallest reversible implementation where a technical choice is necessary but does not alter approved product semantics. Stop and raise any newly discovered issue that would materially constrain architecture and is not resolved by the approved ADRs.

---

# 11. Completion Criteria

Stage A1 will be complete when the system can demonstrate, using fixtures/simulated data:

```text
Business Requirement
        ↓
Acquisition attempts
        ↓
Successful Evidence Asset(s)
        ↓
Preserved Artifact(s)
        ↓
Fingerprint + Provenance
        ↓
Extraction Run
        ↓
Schema-aligned extracted values
        ↓
Complete lineage back to preserved evidence
```

while also demonstrating failed/inconclusive acquisition history and preserving existing KYC behavior.
