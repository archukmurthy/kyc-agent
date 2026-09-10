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
Evidence-to-Need Evaluation
        ↓
Provisional Requirement Assessment
        ↓
Downstream KYC Satisfaction / Decisioning
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

A3 also includes interpretation of an explicitly selected coherent set of existing Artifacts belonging to the same Evidence Asset where complete interpretation requires the set, such as ordered or paginated source material. Each input remains independently authorized, fingerprint-verified, ordered only from persisted source ordering, and reconstructable as a distinct Artifact. Run input lineage and immutable Fact-to-Artifact support lineage must distinguish which Artifact or Artifacts actually support each fact. Partial input must not masquerade as complete. This does not authorize automatic cross-Asset, cross-acquisition, cross-recollection, cross-context, or API-plus-website interpretation, and it creates no new evidence identity or universal source-specific ontology.

A3 does not own source-trust policy, redesign existing KYC source steering, decide requirement satisfaction, select a winning source/value, resolve customer disputes, mutate schemas, or make KYC/compliance decisions. Final KYC context handoff and downstream UI integration remain deferred.

### Stage A4 — Evidence-to-Need Evaluation and Provisional Assessment

Stage A4 is split at a controlled semantic boundary.

#### Stage A4a — Fact-to-Information-Need Evaluation

Add immutable, reconstructable Evidence-to-Need Evaluation that determines how a Fact relates to an explicitly supplied Information Need.

A4a may use exact typed matching, explicit versioned normalization, structured/component comparison under an upstream-supplied structure, semantic concept matching, and approved derived/equivalence relationships with explicit transformation lineage. Provider-neutral AI-assisted semantic evaluation is permitted where deterministic comparison is insufficient.

A4a keeps A3 evidence support, Evidence-to-Need evaluation, and downstream KYC satisfaction separate. It may report that a Fact addresses, partially addresses, ambiguously addresses, is insufficient for, does not address, or cannot yet be evaluated against a Need. Exact internal enum names remain implementation details and must not imply final KYC acceptance.

An A3 discovered Fact may become the input to an immutable candidate evaluation against a supplied Information Need. The discovered Fact remains discovered and is not mutated into a requested Fact, assigned a fabricated schema field or Information Need, or used to change the upstream schema.

Comparable disagreement may be identified and explained without choosing a winning Fact. Source trust, extraction support, and Evidence-to-Need evaluation remain independent. Supplied/versioned policy context may be consumed, but Evidence does not define a universal source hierarchy or latest-wins rule. Re-evaluation is append-only.

A4a does not implement final KYC requirement satisfaction, operative-value selection, customer correction or acceptance, analyst/risk decisions, onboarding progression, or changes to existing KYC behavior.

#### Evidence Consumer Readiness R1 — Private Artifact Ingestion

Before A4b, add the generic production boundary required for an already-authorized host upload to become immutable private Evidence.

R1 accepts server-side authorized PDF, PNG, and JPEG bytes; validates bounded media metadata; preserves the exact original bytes in approved Evidence storage; calculates and verifies SHA-256; and creates the existing Collection Operation, Acquisition, context-restricted Evidence Asset, explicit tenant/context access scope, and Artifact provenance. The same boundary must support strictly authorized server-side reopen with fingerprint verification while keeping storage references and credentials private.

R1 reuses the approved A1/A2 Evidence and storage primitives. It distinguishes idempotent retry of one logical upload from a deliberate new upload that happens to contain identical bytes. SHA-256 remains integrity metadata and never becomes Evidence identity, reuse authority, or access authority. Upload/capture time remains separate from an explicitly supplied source-effective date.

R1 is generic Evidence infrastructure, not a UBO or KYC upload feature. It performs no extraction, interpretation, Fact creation, Evidence-to-Need evaluation, trust assessment, satisfaction, operative-value selection, or external-custody identity/biometric storage. R2, R3, R4, consumer integration, and A4b remain separately governed and deferred.

#### Evidence Consumer Readiness R2 — Targeted Interpretation Boundary

**Accepted and implemented at `0e31ba490452b50e1cf618a23231d980d9ca4977`.** R2 exposes a stable provider-neutral consumer boundary around the existing A3 interpretation machinery. An authorized server-side consumer supplies persisted Artifact IDs, one or more neutral requested concepts, a bounded extraction context, and optional opaque correlation. Evidence resolves and authorizes persisted Artifacts, reads and verifies SHA-256, interprets one Artifact or a coherent same-Evidence-Asset set, and appends immutable Extraction Run, Fact, completeness, support, and Fact-to-Artifact lineage.

R2 preserves open discovery and keeps requested Facts distinct from discovered Facts. It distinguishes found, legitimate not-found, not-evaluated/incomplete, unsupported concepts, unsupported media, provider failure, integrity failure, access denial, inconclusive interpretation, and persistence failure. Historical retrieval remains a separate no-provider-call operation from deliberate fresh interpretation.

R2 uses only current JSON/HTML interpretation capability. PDF/image interpretation and locators belong to R3; typed relational Facts belong to R4. R2 does not import consumer-domain identifiers or policy semantics, perform A4a automatically, calculate ownership, determine UBO/controllers, assess requirement satisfaction, or implement A4b.

Every stable fresh R2 request carries a caller-supplied operation key. Atomic scoped uniqueness returns completed, in-progress, or failed operations without another provider call or Extraction Run; changed canonical input under the same key conflicts; deliberate retry or reinterpretation uses a new key. One bounded additive interpretation-operation migration after 014 is authorized. Opaque correlation remains separate from operation identity even though it participates in canonical request consistency.

#### Evidence Consumer Readiness R3 — PDF/Image Interpretation and Locators

**Accepted and implemented at `ec96fe358ef09bdec15dd14f23a7ade1b36aba06`.**

Extend the existing A3/R2 interpretation path to the PDF, PNG, and JPEG media already preserved by R1. R3 retains the same trusted server-side resolution, exact private tenant/context authorization, SHA-256 verification, neutral requested-concept model, open discovery, append-only Extraction Runs/Facts, and no-provider history reopening.

R3 introduces a provider-neutral multimodal content boundary for verified text, image, and PDF/document inputs. Provider-native content blocks remain inside each provider adapter. The first Anthropic adapter may use base64 PDF/image blocks only within bounded request, byte, page, pixel, and model-capability limits; it must not expose storage references, trust filename extensions, silently convert preserved media, persist raw provider exchanges, or treat provider/model support as Evidence authority.

Initial direct-base64 execution is bounded to 10 MiB and 100 pages per PDF, 7.5 MB and 8,000 × 8,000 per PNG/JPEG, at most 20 explicitly selected same-Asset Artifacts, and at most 20 MiB aggregate original binary content. Provider/model preflight applies any stricter active limit. Limit rejection never changes or discards the preserved Artifact.

R3 adds durable Evidence-owned source locators beneath the existing Fact-to-Artifact support relationship. JSON should retain a path/key and bounded source support; HTML should retain a reliable section/DOM reference where available and an excerpt; PDF must retain a page/page range and supporting text or truthful visual support description; image Facts must retain the supporting Artifact and a support description/excerpt. Bounding boxes are optional and must not be fabricated or stored without an explicit mappable coordinate space.

Migration 013 remains the authoritative support pair but cannot represent per-Fact/per-Artifact locations. R3 therefore proposes one additive locator relation after migration 015, without rewriting migrations 010–015 or hiding locator identity in run/Fact JSON metadata.

One operation may interpret an explicit coherent ordered set of Artifacts only when they belong to the same Evidence Asset, including HTML plus a screenshot. Fact support and locators attach only to the Artifact(s) that actually support each Fact. Cross-Asset bundles remain prohibited.

R3 preserves explicit current/ceased/historical/effective statements and uncertainty as source-supported Facts with locators. It does not infer currentness, calculate ownership, create UBO/controller conclusions, define typed relationship edges, determine satisfaction, select winners, or implement A4b. Typed relational Facts remain R4.

#### Evidence Consumer Readiness R4 — Typed Relational Facts

**Accepted and implemented at `450ae41e2871a5145667b8fec906a84d5b5bbc93` under approved ADR-017.**

Add a provider-neutral typed extension to an ordinary immutable Evidence Fact for an individual source-supported relationship:

```text
source party
    relationship
target party or arrangement
```

The documented direction is always subject–relationship–object: the subject holds, exercises, performs, or is assigned the relationship toward the object. Provider-native direction and passive source wording must not leak into persisted semantics.

R4 should support source-party snapshots for natural persons, legal entities, trusts/legal arrangements, and unknown/other parties without creating canonical global entities. It should introduce a versioned neutral vocabulary covering economic ownership, voting rights, appointment/removal rights, formal decision/control rights, significant influence/control, director/officer/signatory roles, trust roles, nominee/on-behalf-of relationships, and `OTHER` only for an understood out-of-vocabulary relationship. Ambiguous relationship meaning or direction remains untyped. Source-specific codes remain preserved metadata and map only through deterministic versioned rules.

Relationship quantities must distinguish exact, range, qualitative, and unknown values; support percentages, count-of-total, absolute values, and source-recorded qualitative statements; preserve range inclusivity; and never turn unknown into zero or a range into a midpoint. Explicit current, ceased, historical, unknown-currentness, and effective-date assertions remain source state rather than latest-wins policy.

The persistence is one additive one-to-zero/one typed relationship extension keyed by an existing `evidence_facts` ID. Each extension represents exactly one directed source assertion; independent relationships do not become one opaque typed array. The ordinary Fact retains raw representation, Extraction Run lineage, support state, Fact-to-Artifact support, and R3 locators. Direct source statements may be direct typed Facts. A later mapping of an existing untyped/source-code Fact appends separate derived Facts with existing transformation lineage instead of rewriting the original.

R4 requires deterministic structured-output validation. Invalid typed output leaves any safe underlying ordinary Fact intact and never fabricates a relationship. Companies House PSC bands may later map to the same neutral model only where the code mapping is deterministic; PSC statements, exemptions, unavailable information, and no-registrable-PSC states are not fake relationships.

R4 does not determine UBO/controller status, indirect/effective ownership, thresholds, operative values, winners, requirement coverage, KYC satisfaction, or A4b conclusions. A4a remains the Fact-to-Information-Need evaluation boundary and requires no architecture change merely to receive a typed relational Fact.

#### Stage A4b — Coverage, Conflict, and Provisional Requirement Assessment

**Accepted and implemented at `e0dd4d85be47cfb851d86f41778a9c3a20286b16` under approved ADR-018.**

A4b reasons across an explicitly selected immutable set of A4a evaluations and source-backed Evidence signals to assess evidence coverage, collection/cardinality completeness, legitimate empty sets, comparable disagreement, temporal applicability, and unresolved input limitations.

The diagnostic and proposed architecture are recorded in ADR-018. The existing Information Need remains the stable Evidence target but does not contain sufficient assessment semantics. The recommended boundary is a versioned assessment specification supplied by the consuming domain and immutably snapshotted by Evidence for each assessment. That specification must state the applicable structural and policy inputs, including scalar/collection shape, cardinality, complete-set and legitimate-empty semantics, temporal checkpoint, comparison references, and any freshness/source-suitability context.

A4b outcomes remain multidimensional and provisional: coverage, completeness, comparable disagreement, temporal applicability, and missing-policy/input limitations must not be collapsed into one satisfaction status. A4b does not select an operative value or source winner, calculate indirect ownership, determine UBO/controller status, or determine final KYC satisfaction.

Migration 018 is additive and forward-only. Migrations 010–017 remain immutable and no historical backfill occurred.

#### Downstream KYC/Onboarding

KYC/Onboarding retains source/value winner selection, operative customer values, customer dispute resolution, corroboration requirements, final KYC satisfaction, analyst/risk decisions, and approve/reject/refer/escalate or onboarding-progression decisions.

### Stage A5 — Evidence Reconstruction and Package

Stage A5 is split at the persistence boundary under approved ADR-019. A5a was implemented and accepted at `851a029dff6a66e75c94f323007061c645cb7483`. A5b was implemented and accepted at `4602d763bd728f36b16de335cdd85cd6abced55d`.

#### Stage A5a — Evidence Ledger / Reconstruction

Provide an authorized, deterministic point-in-time reconstruction over the existing A1–A4b/R1–R4 source-of-truth records. Present a stable chronology of Requirements and Information Needs, collections and failures, Assets and Artifacts, extraction/interpretation, Facts and source relationships, locators and integrity lineage, A4a evaluations, A4b assessments, conflicts, gaps, and limitations.

A5a should initially be a read projection, not a duplicate persisted event ledger. It distinguishes governed record availability/knowledge time from collection, capture, observation, source-effective, extraction, verification, evaluation, and assessment time. Because `created_at` is not universally a database-commit timestamp, the projection uses safe parent operation/run completion bounds and prevents later terminal results from leaking into earlier as-of views. It exposes places where the present model cannot reproduce overwritten intermediate transitions, exact commit time, prior requirement status, access-scope revocation history, or unpersisted denied/invalid requests.

A5a does not choose latest Evidence, select a winner, create an operative value, determine KYC/UBO satisfaction, or fabricate downstream decision rationale. It is implemented as a read-only projection and introduced no migration.

#### Stage A5b — Immutable Evidence Package

Allow the complete fresh server-generated, authorized A5a reconstruction to be explicitly frozen as a durable immutable package. A package has its own opaque identity, subject/context/purpose and `asOf` scope, exact ordered member references plus bounded frozen member projections, manifest/canonicalization version, assembly time and actor lineage, explicit limitations, SHA-256 manifest fingerprint, and an optional neutral `derivedFrom` predecessor. The browser does not submit arbitrary member IDs. Caller-selected subsets, exclusions, inclusion profiles, and purpose-specific filtering are deferred.

Package membership references canonical Evidence records; it does not copy or re-identify Artifacts. Bounded frozen projections preserve Package meaning where source rows have mutable state, without becoming a second Evidence system. Membership grants no access. Package authorization is evaluated member by member as the intersection of member authorization and is rechecked on reopen/export. Access loss makes the canonical package non-materializable without leaking restricted member metadata; no member is silently omitted.

A frozen package never silently gains later Evidence. A later reconstruction is frozen as a new package with a new freeze-operation key; idempotent retry returns the original Package while same-key changed input conflicts. Canonical JSON bytes and their SHA-256 are stored with relational membership in one atomic transaction. Reopen verifies manifest bytes, digest, version, canonical structure, and member order before authorization/materialization. Optional PDF/ZIP/human-readable output is a derived export, not the canonical package. Additive forward-only migration 019 and the bounded A5b implementation are accepted; export remains deferred.

### Stage A6 — End-to-End Evidence Lab Validation

Exercise and demonstrate the complete lifecycle through the Evidence Lab.

**Closure status: demonstrated and accepted across stage/product reviews, final A5b verification, and the frozen V1 consumer façade at `c55354aeb334c7c99201ade7a5b3d96e030d3266`.** A6 adds no new Evidence domain model or migration.

Stage A is complete when Evidence Platform V1 can independently demonstrate:

```text
Requirement
→ acquisition
→ durable evidence
→ provenance
→ integrity
→ interpretation
→ Evidence-to-Need evaluation
→ provisional evidence assessment
→ ledger
→ package
```

without depending on the existing KYC customer journey.

Architecture Authority confirms that this completes Evidence Core V1 architecture. Evidence Core is **CLOSED / MAINTENANCE**. Controlled-pilot and production hardening remain separate readiness work; the Evidence Lab routes are not production contracts. The precise verdict, blockers, characterization map, and deferred register are in `V1_READINESS.md`.

---

## Stage B — Prove the Producer Abstraction

Prove that materially different evidence producers fit naturally into the same platform model.

This is a post-Core producer track. The accepted Companies House producer and generic private Artifact ingestion already prove two materially different input paths. Further producer work should be owned by the Evidence Producers Control Room through the contract candidate in `V1_CONTRACTS.md`; it must not reopen the accepted Evidence Core identity model without a material ADR.

At minimum validate:

### Producer 1 — Automated web/regulator evidence

Example: FCA/regulatory source.

### Producer 2 — Customer document

Example: an authorized customer-provided PDF/image such as proof of address. External-custody passport, selfie, or biometric Evidence requires the separate IDV/Vault architecture and is not an R1/Core V1 upload case.

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

---

## Evidence Core V1 final closure implementation — Consumer Façade

**Implemented, accepted, and frozen under ADR-020 at `c55354aeb334c7c99201ade7a5b3d96e030d3266`.**

Before downstream integration, publish the single supported in-process Evidence V1 consumer import at `evidence/consumer/v1/index.js`. It delegates to the accepted Artifact, R2, A5a, and A5b services; exposes explicit versioned, bounded DTOs and safe errors; keeps trusted authorization separate from consumer requests; and adds no domain behavior, HTTP transport, producer interface, or migration.

Contract tests protect the exact export/operation names, version identities, trusted authorization separation, public/private access behavior, non-disclosing DTO/error projection, historical reads, reconstruction and Package side effects, and the deterministic six-relationship Bettercomms shape. Only this public entry point and its V1 DTO surface are `FROZEN`. Stage modules, repositories, storage, database tables, Lab routes, and fixtures remain internal, Lab-only, or fixture/test-only. Evidence Core V1 is **CLOSED / MAINTENANCE**; trusted production host integration and operational release gates remain separate blockers.
