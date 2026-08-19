# Evidence Platform — Current Build Brief

# Stage A4a — Fact-to-Information-Need Evaluation

## Governance Status

This brief defines the controlled Stage A4a architecture and future acceptance boundary.

This governance task does not authorize implementation. Do not create production code, migrations, APIs, Evidence Lab behavior, tests, or persistence until a separate A4a implementation authorization is issued.

Stage A4b is explicitly deferred and is not authorized by this brief.

---

## 1. Objective

Extend the accepted A1–A3 Evidence domain with an immutable and reconstructable evaluation of how an Evidence Fact relates to an explicitly supplied Information Need.

A4a answers:

> Does this Fact address this Information Need, by what method, with what qualifications or ambiguity, and with what reconstructable lineage?

A4a does not determine final KYC satisfaction, select an operative value, decide which source wins, resolve a customer dispute, or make an onboarding decision.

---

## 2. Mandatory Semantic Separation

Preserve three distinct concepts:

```text
A3 Evidence Support
    ↓
Does preserved evidence support this Fact?

A4a Evidence-to-Need Evaluation
    ↓
Does this Fact address this supplied Information Need?

Downstream KYC Satisfaction
    ↓
Is this evidence acceptable and sufficient under current KYC policy?
```

These concepts must never be collapsed into one status, score, field, or projection.

In particular:

* `evidence_facts.support_state` remains A3 evidence support;
* an Asset associated with a Requirement does not imply satisfaction;
* a requested Fact carrying schema or Information Need lineage does not imply acceptance;
* an independent-verification agreement does not imply final correctness; and
* capture or interpretation completeness does not imply requirement satisfaction.

---

## 3. Existing Domain Must Be Reused

Build on the accepted A1–A3 domain:

```text
Evidence Requirement
    ↓
Information Need

Evidence Asset
    ↓
Artifact
    ↓
Extraction Run
    ↓
Fact + A3 support + Artifact/derivation/verification lineage
```

Do not create parallel Requirement, Information Need, Fact, Artifact, Extraction Run, support, derivation, verification, subject, context, access, collection, or provenance concepts.

A4a evaluates existing immutable Facts against existing explicitly supplied Information Needs. It does not recollect evidence or reinterpret an Artifact merely to perform the evaluation.

---

## 4. Evidence-to-Need Evaluation

Introduce the architectural concept of an immutable Evidence-to-Need Evaluation, or a semantically equivalent neutral implementation name.

An evaluation relates:

```text
immutable Fact
      ↓
explicitly supplied Information Need
      ↓
evaluation method and version
      ↓
result + explanation + qualifications + limitations
```

Do not mutate the Fact or Information Need to represent this relationship.

Every evaluation must retain enough lineage to reconstruct, where applicable:

* the evaluated Information Need;
* the candidate Fact;
* the Fact's existing Extraction Run, Artifact support, derivation, and verification lineage by reference;
* evaluator type, identity, and version;
* deterministic method, normalization, transformation, provider/model, or instruction reference and version;
* raw and normalized comparison inputs where normalization is used;
* supplied comparison, schema, temporal, or policy context;
* result;
* explanation, reasons, or signals;
* ambiguity, qualifications, and limitations; and
* evaluation time.

Exact table names, internal API names, module organization, and enum spelling remain implementation details unless a later decision freezes them.

---

## 5. Permitted Evaluation Methods

A4a may use bounded methods including:

### Exact typed matching

Compare values only under a supplied or authoritative type/identifier meaning, such as the same identifier scheme. String equality alone must not create subject identity or semantic equivalence.

### Deterministic normalization

Apply a named and versioned normalization method while preserving the original Fact unchanged.

Example:

```text
Raw Fact:       TESCO PLC
Need concept:   business_name
Comparison:     Tesco Plc
Method:         <named/versioned normalization>
```

The normalized comparison input is evaluation lineage, not a replacement Fact.

### Structured or component comparison

Compare structured values or components only where the upstream Information Need or supplied evaluation context defines the relevant structure. Partial component coverage and incompatible shapes must remain explicit.

### Semantic concept matching

Determine whether differently expressed concepts are candidates for the same supplied Information Need. Semantic evaluation must not silently equate concepts that may carry different business meanings.

### Approved derived or equivalence relationships

Use an approved transformation or equivalence relationship only where explicit transformation lineage exists. Do not invent semantic transformations to force a match.

Deterministic methods are preferred when they can evaluate the relationship reliably. AI must not be introduced merely to repeat deterministic comparison.

---

## 6. Provider-Neutral AI-Assisted Evaluation

Provider-neutral AI-assisted semantic evaluation is permitted where deterministic comparison is insufficient.

This is particularly relevant when an A3 discovered Fact uses source terminology that may relate to a supplied KYC/KYB Information Need.

AI evaluation must retain reconstructable lineage including, where applicable:

* provider and model/version;
* instruction or evaluator reference/version;
* Fact and Information Need inputs;
* supplied schema and evaluation context;
* evaluation timestamp;
* result and explanation/signals; and
* ambiguity and limitations.

AI does not:

* become schema authority;
* create or fabricate an Information Need;
* modify the upstream schema;
* convert a discovered Fact into a requested Fact;
* establish final KYC satisfaction;
* choose a winning source or value; or
* make a customer, analyst, risk, or onboarding decision.

Persisted semantics must remain provider-neutral. Credentials and secrets remain environment-only and must never appear in evaluation records or browser responses.

---

## 7. Discovered Facts

Preserve this flow:

```text
A3 discovered Fact
      ↓
A4a immutable candidate evaluation
      ↓
explicitly supplied Information Need
```

The discovered Fact remains discovered.

Do not:

* add `schema_field_id` or `information_need_id` to the Fact;
* rewrite it as requested;
* fabricate schema lineage;
* automatically recommend or perform schema mutation;
* change an onboarding form; or
* treat a candidate evaluation as automatic KYC adoption.

---

## 8. Evaluation Outcomes

A4a must support a bounded, neutral vocabulary capable of expressing meanings such as:

* addresses;
* partially addresses;
* ambiguous;
* insufficient;
* does not address; and
* indeterminate or not evaluated.

Exact enum spelling may follow repository conventions. Names must not imply final KYC acceptance, approval, or satisfaction.

An evaluation must be allowed to retain a candidate even when the A3 Fact has `needs_verification` support. Fact support and Need evaluation remain independently visible.

If disagreement is represented in A4a, it is limited to genuinely comparable Facts or comparison inputs. A4a may identify and explain disagreement but must not calculate a universal source preference or choose a winner.

Registered and operating address, current and historical value, or different identifier schemes must not be treated as comparable merely because their displayed strings look similar.

---

## 9. Source Trust and Policy Context

Source trust, A3 extraction support, and A4a Evidence-to-Need evaluation remain independent.

A4a may consume explicitly supplied and versioned source-policy or comparison context where relevant to the evaluation. It must preserve that supplied context as lineage without becoming its owner.

Do not:

* define universal source-trust tiers;
* copy the current KYC application's coarse primary/secondary/tertiary mechanism into Evidence;
* treat Companies House as universally authoritative for every concept, jurisdiction, tenant, or purpose;
* treat customer-provided evidence as universally weak or authoritative; or
* derive an A4a result mechanically from source tier or A3 support state.

---

## 10. Temporal Behavior and Re-evaluation

A4a may compare and expose:

* Evidence Asset observation time;
* Artifact capture time;
* source-effective dates actually represented by evidence or Facts;
* Extraction Run and Fact timestamps;
* evaluation time; and
* supplied temporal context or policy reference.

Do not invent source-effective dates, freshness policy, or a `latest value wins` rule. Later evidence must not silently become operative merely because it is newer.

Re-evaluation is append-only:

```text
Monday
Evaluation 1 → Fact A addresses Need X

Friday
New Fact B or new supplied context
Evaluation 2 → new assessment
```

Evaluation 2 must not rewrite Evaluation 1. Both evaluations, inputs, methods, contexts, results, and timestamps remain reconstructable.

Retries, idempotent replay, and deliberate later evaluation must not be silently conflated if doing so would weaken history. Exact implementation mechanics remain discretionary unless they create a new material evaluation-identity policy.

---

## 11. Future Additive Persistence Direction

A4a is expected to require forward-only additive persistence conceptually equivalent to:

### Evaluation Run or Header

* Information Need;
* evaluator or method identity/version;
* supplied comparison, schema, temporal, or policy context;
* evaluation time; and
* limitations.

### Candidate Evaluation

* evaluation;
* Fact;
* relation/result;
* comparison method;
* normalized comparison inputs where applicable;
* normalization/transformation reference;
* reasons/signals; and
* ambiguity, qualifications, or limitations.

The future implementation must not overload:

* `evidence_facts.support_state`;
* `evidence_verification_attempts`;
* `evidence_requirement_assets`;
* `evidence_requirements.status`; or
* mutable JSON on existing Facts.

Existing A1–A3 records remain immutable. Do not modify migrations 010–013. This governance task does not authorize creation of migration 014 or any other migration.

---

## 12. Evidence Lab Acceptance Scenarios

A future A4a implementation must provide deterministic, isolated acceptance scenarios covering at least:

1. **Exact identifier match** — a typed identifier Fact exactly addresses the supplied identifier Need.
2. **Normalized business-name match** — raw values remain unchanged while a named/versioned normalization is visible.
3. **Qualified semantic concept match** — differently worded concepts produce an explained, qualified candidate relationship.
4. **Clear mismatch** — the relationship is recorded truthfully without subject reassignment or fabricated equivalence.
5. **Comparable competing Facts** — disagreement is visible and explained without a selected winner.
6. **Fact needing verification** — A3 support remains `needs_verification` while A4a separately evaluates whether the Fact addresses the Need.
7. **Discovered Fact candidate** — a discovered Fact is evaluated against a supplied Need without mutating the Fact or schema.
8. **Collection boundary** — complete capture/interpretation is shown separately from requirement satisfaction where cardinality semantics are absent.
9. **Legitimate empty set** — authoritative no-PSC/no-registrable-member evidence is distinguishable from unavailable evidence, capture failure, or no extracted Facts.
10. **Historical re-evaluation** — two evaluations remain append-only and separately inspectable after new evidence or context arrives.

Every scenario must visibly distinguish:

```text
A3 Fact support
A4a Need evaluation
evidence/input completeness
downstream KYC decision: NOT PERFORMED
```

Fixtures and automated tests must not require live external collection or paid AI calls. Optional live/provider acceptance requires separate authorization and must remain explicit rather than automatic.

---

## 13. Stage A4b Is Deferred

A4b — Coverage, Conflict, and Provisional Requirement Assessment — is not authorized for implementation.

Before A4b can begin, Architecture Authority must separately govern or approve upstream inputs for at least:

* scalar versus collection shape;
* zero-or-one, one, one-or-many, or other cardinality;
* minimum and maximum counts where applicable;
* complete-set and `all current X` semantics;
* legitimate empty-set semantics;
* required versus optional status;
* temporal scope and current-as-of meaning;
* freshness policy;
* source suitability and acceptability;
* genuinely comparable conflict rules; and
* aggregation from candidate evaluations to requirement-level evidence coverage.

For example, complete capture and interpretation of three Companies House Officers pages proves the preserved input was complete under its capture contract. It does not establish that an Information Need meaning `all current directors` is satisfied unless upstream requirement semantics define the required set.

Authoritative PSC evidence stating that no registrable PSC exists is positive evidence of a legitimate empty state. It is not equivalent to an unavailable PSC source, capture failure, incomplete input, or no extracted Facts.

A4b will remain provisional evidence assessment. It will not select the operative value or determine final KYC satisfaction.

---

## 14. Final KYC/Onboarding Boundary

KYC/Onboarding retains responsibility for:

* final KYC requirement satisfaction;
* source and value winner selection;
* operative customer values;
* customer correctness and dispute resolution;
* corroboration requirements;
* analyst, compliance, and risk decisions;
* approve, reject, refer, or escalate decisions; and
* onboarding progression.

Evidence may produce qualified, reconstructable evaluations and later provisional coverage assessments for downstream systems to consume. It must not make those decisions itself.

---

## 15. Existing-System Protection

A4a must remain Evidence-owned and additive.

Do not modify existing KYC/Pre-boarding source classification, schemas, prompts, customer confirmation, customer correction, dossier persistence, submission provenance, Companies House integration, self-source, UBO, source configuration, decision policies, or customer UI behavior.

Do not design or implement the final KYC-to-Evidence or Evidence-to-KYC integration contract during A4a. Any unavoidable change to existing KYC behavior requires separate Architecture Authority review and explicit authorization.

Public/private access rules remain authoritative. A4a must not discover or evaluate context-restricted Facts across unrelated tenants or contexts. If safe candidate access would require a new cross-context policy, stop for Architecture Authority.

---

## 16. Explicit Exclusions

Do not implement:

* A4b coverage aggregation or requirement-level provisional assessment;
* final KYC satisfaction;
* source or value winner selection;
* operative-value selection;
* customer acceptance, correctness, or correction decisions;
* analyst, compliance, or risk decisions;
* approve, reject, refer, escalate, or onboarding-progression decisions;
* universal source-trust tiers;
* freshness policy or latest-wins behavior;
* global identity resolution;
* cross-tenant private-evidence discovery;
* schema creation, mutation, or recommendation;
* automatic adoption of discovered Facts;
* unsupported SIC-to-industry or similar transformations;
* evidence recollection;
* automatic Artifact reinterpretation;
* automatic semantic evaluation merely because a Fact or Need exists;
* cross-Requirement or cross-context evaluation without explicit authorization;
* A5 Ledger or Evidence Package work;
* redesign of existing KYC source steering; or
* changes to normal KYC behavior.

---

## 17. Stop Conditions

Stop and report to Architecture Authority before implementation proceeds if A4a would require:

* inventing or changing Information Need meaning;
* silently treating schema-field lineage as a satisfaction result;
* mutating a Fact to record an evaluation;
* converting a discovered Fact into a requested Fact;
* creating a universal semantic-equivalence or source-trust policy;
* deciding which candidate wins;
* defining final satisfaction, freshness, cardinality, or complete-set semantics;
* weakening A1–A3 immutability, provenance, access, or historical reconstruction;
* evaluating private evidence outside its authorized context;
* irreversible coupling to one AI provider;
* modifying migrations 010–013;
* changing existing KYC behavior; or
* implementing any A4b or later-stage capability.

---

## 18. Future Completion Criteria

When separately authorized and implemented, Stage A4a will be complete when fixtures, automated tests, and the isolated Evidence Lab demonstrate:

```text
explicitly supplied Information Need
        +
immutable A3 Fact with complete evidence lineage
        ↓
named/versioned deterministic or semantic evaluation
        ↓
neutral result + explanation + qualifications
        ↓
append-only reconstructable evaluation history
        ↓
downstream KYC decision: NOT PERFORMED
```

Completion must preserve the separate meanings of A3 support, A4a evaluation, evidence/input completeness, and downstream satisfaction while leaving A4b, KYC decisioning, Ledger/Package, and existing KYC behavior outside A4a.
