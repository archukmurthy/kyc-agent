# Evidence Platform — Current Build Brief

# Stage A3 — Extraction, Interpretation, and Verification Lineage

## 1. Objective

Extend the accepted A1/A2 Evidence domain so preserved Evidence Artifacts can produce reconstructable, evidence-grounded facts through deterministic extraction, AI-assisted semantic interpretation, bounded KYC/KYB-relevant discovery, explicit derivation lineage, explainable extraction-support assessment, and selective independent verification.

A3 is an Evidence interpretation and verification-lineage stage. It does not become the KYC decision engine, redesign existing source steering, or implement matching and requirement satisfaction.

---

## 2. Existing Domain Must Be Extended

Build on the existing A1/A2 entities and invariants:

```text
Acquisition
    ↓
Evidence Asset
    ↓
Artifact + fingerprint + temporal provenance
    ↓
Extraction Run
    ↓
Evidence-grounded result
```

Do not create parallel Artifact, extraction-run, provenance, integrity, collection, identity, access, retry, or recollection concepts.

The current A1 extracted-value persistence requires a non-null schema field. A3 must add the minimum additive persistence needed to represent discovered facts without fabricating a schema field or information-need identifier. Derived facts likewise require explicit lineage to their input fact or facts and the transformation/classification that produced them. Existing A1/A2 data and behavior must remain valid.

Exact table names, internal API names, module organization, reversible enum names, test-fixture organization, and prompt/extractor packaging are implementation details.

---

## 3. Upstream Context Boundary

A3 must be capable of receiving an extraction context that may describe:

* subject and Evidence context;
* jurisdiction;
* applicable schema/context;
* requested information needs or concepts;
* source/producer context and supplied policy references.

Do not design the final KYC-to-Evidence integration contract. Use a bounded internal/Lab contract or fixture context sufficient to prove A3.

Where an existing configurable KYC/KYB schema concept or information need is supplied, it is authoritative. Do not create a parallel Evidence-owned customer schema or silently change the meaning of an existing concept.

Preserve a real schema/version reference where supplied. If no explicit version exists, allow null/absent version lineage or the already approved non-breaking current/latest compatibility convention. Do not invent historical versions or implement schema versioning.

---

## 4. Extraction Modes

Support deterministic and AI Extraction Runs under common lineage.

Use deterministic extraction when a structured Artifact exposes a reliably addressable value. Do not call AI merely to reinterpret a value that can be safely extracted in code.

Use AI where semantic interpretation adds material value, including representative cases involving:

* unstructured documents;
* rendered webpages;
* images or screenshots;
* ambiguous labels or readings;
* semantic mapping between source language and a requested concept;
* discovered-fact identification;
* explicitly permitted derived interpretation.

Semantic matching must not silently equate non-equivalent concepts. The extractor must retain the source representation and explanation/lineage needed to understand the mapping.

Do not build a large source- or document-specific deterministic extractor library. Small deterministic fixtures/adapters needed to demonstrate the common architecture are allowed. Existing Companies House producer behavior must not be expanded or refactored merely for convenience.

---

## 5. Requested and Discovered Facts

A3 has two bounded responsibilities:

1. seek facts responsive to supplied schema information needs; and
2. identify additional facts reasonably relevant to KYC/KYB/compliance context.

Every produced fact must state whether it was requested or discovered.

A discovered fact:

* may have an authoritative external concept reference where one genuinely exists;
* must not use an invented schema field or fake information-need identifier;
* must not modify a configured KYC schema;
* must not automatically create or satisfy a requirement;
* must not change an onboarding form;
* may be returned as additional qualified information for downstream evaluation.

Discovery must be bounded. Do not extract arbitrary incidental content and do not create a universal closed ontology of every possible KYC/KYB fact.

---

## 6. Direct and Derived Facts

A direct/source fact records what the preserved evidence itself states.

A derived fact records an interpretation, normalization, classification, or transformation. It must never be represented as if the source stated it directly.

For a derived fact preserve, where applicable:

* input source fact or facts;
* source Artifact or Artifacts;
* producing Extraction Run;
* transformation, reference, or classification identity;
* transformation version where available;
* derived value;
* derivation time.

For the Lab, demonstrate a source fact such as `SIC code = 62020` and a separately identified derived interpretation produced through an explicit, versioned fixture classification. Do not silently transform SIC into an existing field with different semantics.

---

## 7. Source Trust and Extraction Support

Keep source trust and extraction support independent.

```text
source trust
= policy view of source authority/reliability for a business purpose

extraction support
= how strongly the preserved evidence supports the produced value or interpretation
```

Do not derive extraction support directly from a source tier. Do not derive source trust from extraction certainty. Do not combine both into one percentage.

A3 may preserve supplied source-policy context, but it must not:

* hard-code universal trust tiers;
* encode Companies House as universally Tier 1;
* encode customer upload as authoritative;
* conflate provision channel, document issuer, and source authority;
* redesign existing KYC source-steering behavior;
* add admin source-trust configuration.

Extraction support must be explainable and accommodate signals such as readability, direct/derived grounding, extraction method, reading certainty, semantic ambiguity, multiple plausible values, and verification outcome.

Support a downstream state with semantics equivalent to:

```text
SUPPORTED
SUPPORTED_WITH_QUALIFICATION
NEEDS_VERIFICATION
NOT_SUPPORTED
```

Exact names may be refined consistently in implementation. These states describe evidence/extraction support, not source authority. A `NEEDS_VERIFICATION` value may still be returned downstream with its qualifier; A3 must not decide how KYC presents or accepts it.

---

## 8. Selective Independent Verification

Support independent re-extraction/verification on demand. Do not automatically run a second AI extraction for every value and do not hard-code a numerical confidence threshold.

The fixture/Lab contract may request verification for cases such as degraded evidence, multiple plausible readings, semantic ambiguity, an explicit downstream request, or a simulated customer contest.

Where practical, the independent verifier must inspect the preserved evidence without being given the first extractor's answer. Preserve:

* the original run and output;
* the independent run and output;
* the relationship between the verification attempt and the result under review;
* support assessments and disagreement;
* all extractor/model lineage and timestamps.

Do not overwrite or correct the original run in place. Evidence reports agreement or disagreement and provenance; it does not decide which value wins or whether a customer assertion is correct.

---

## 9. Extractor and Model Lineage

Each Extraction Run must retain, where applicable:

* deterministic or AI extractor type;
* extractor name and version;
* model provider, model, and model/version identifier;
* prompt/instruction or extractor reference/version;
* extraction context;
* exact source Artifact or Artifacts;
* start and completion timestamps;
* success, failure, or other explicit outcome;
* produced result and extraction-support assessment;
* non-secret error context.

Never store credentials, API keys, authorization headers, or other secrets.

The design must permit later measurement of disagreement and error rates by extractor/model/version without destructive migration, but A3 does not build analytics, training, fine-tuning, prompt optimization, or automatic model selection.

Avoid irreversible coupling of persisted meaning to one AI provider. Provider-specific adapters are allowed behind the common lineage boundary.

---

## 10. Temporal Provenance and Reuse

Retain the distinct meanings of existing A1/A2 timestamps and add only A3 interpretation events:

* acquisition requested/started and completed/retrieved;
* source observed;
* Artifact captured and stored;
* extraction started and completed;
* independent verification performed.

Do not duplicate or overwrite existing acquisition/capture timestamps. Reuse and re-extraction must not fabricate freshness.

For evidence captured on Monday and re-extracted on Friday, downstream lineage must continue to show Monday as source observation/capture and Friday as extraction time.

Customer confirmation/correction timestamps remain downstream KYC concerns unless a future authorized integration supplies them back to Evidence.

---

## 11. Downstream Qualified Output

Provide an internal/Lab output capable of retaining, where applicable:

* extracted or derived value;
* source and producer identity;
* Evidence Asset and Artifact reference;
* source observation/capture timestamp;
* extraction timestamp;
* extraction-support state and explanation/signals;
* requested-versus-discovered status;
* direct/source-versus-derived status;
* extractor/model/transformation lineage;
* independent-verification relationship and outcome.

The final KYC UI and Evidence-to-KYC integration contract are not part of A3.

---

## 12. Evidence Lab Acceptance Scenarios

Extend the isolated Evidence Lab using fixtures/synthetic evidence. Do not require real customer data or live external requests.

The Lab and automated tests must demonstrate at minimum:

1. **Deterministic structured extraction:** Companies House-style JSON produces a direct, schema-aligned fact through a deterministic run with `SUPPORTED` semantics.
2. **Semantic document extraction:** a supplied schema concept and differently worded document content are semantically related through an AI-capable extraction boundary with full lineage.
3. **Discovered fact:** an unrequested previous legal name is retained as discovered without inventing a schema field or satisfying a requirement.
4. **Derived fact:** a direct SIC-code fact and its explicit fixture-classified interpretation remain separate with transformation lineage.
5. **Uncertain extraction:** degraded synthetic evidence yields a tentative value with `NEEDS_VERIFICATION`, and the qualified value remains available in output.
6. **Independent verification:** original and independent runs disagree; both remain immutable and visible without a selected winner.
7. **Temporal lineage:** evidence captured at date A and re-extracted at date B visibly retains both dates.
8. **Source-trust separation:** a lower-trust policy context may still have strong extraction support, and authoritative policy context may still have weak support, without either value being mechanically derived from the other.
9. **Failure history:** failed extraction/verification remains reconstructable and does not corrupt the preserved Artifact or prior successful runs.
10. **Existing-system protection:** A1/A2 fixtures and Companies House producer behavior remain unchanged, and existing KYC regression tests remain green.

The Lab is an internal product-review surface, not a final customer UI or decision engine.

---

## 13. Persistence and Historical Invariants

Tests must prove:

* A1/A2 Artifacts and Extraction Runs are extended, not duplicated;
* discovered facts persist without fake schema or information-need identifiers;
* requested/discovered and direct/derived status are explicit;
* every direct fact traces to preserved evidence and its producing run;
* every derived fact traces to its input fact(s), Artifact(s), run, and transformation;
* every verification run remains separate from the original run;
* later runs never rewrite prior output;
* source/capture time is not changed by reuse or re-extraction;
* source trust and extraction support remain independently representable;
* provider/model/prompt or extractor-version lineage is queryable without exposing secrets;
* qualified values can be returned without implying requirement satisfaction or acceptance;
* existing A1/A2 persistence remains compatible and historical provenance is not weakened.

Use additive migrations only. Do not modify migrations 010 or 011. Any database smoke test requires separate authorization and a disposable test database under existing safety guards.

---

## 14. Existing-System Protection

A3 implementation must remain Evidence-owned and additive.

Do not modify existing KYC/Pre-boarding source classification, prompts, customer confirmation, dossier persistence, submission provenance, Companies House officer injection, self-source, UBO, source configuration, or customer UI behavior.

Do not integrate A3 into the existing KYC workflow during this stage. Reuse accepted A1/A2 interfaces and fixtures without changing their semantics. Any unavoidable legacy-system modification requires Architecture Authority review before implementation.

---

## 15. Explicit Exclusions

Do not implement:

* final KYC-to-Evidence context handoff;
* final Evidence-to-KYC API or UI integration;
* redesign or cleanup of legacy KYC source steering;
* universal source-trust or jurisdiction trust tiers;
* admin source-trust configuration;
* automatic source winner or conflicting-value selection;
* Evidence Match, acceptance evaluation, or requirement satisfaction;
* customer, analyst, compliance, or risk decisioning;
* customer correction workflow;
* Evidence Ledger, Evidence Package, or DRS;
* automatic schema expansion, mutation, or recommendations;
* global entity resolution;
* broad document-authenticity determination;
* automatic independent verification for every result;
* numerical confidence calibration or a fixed confidence threshold;
* AI training, fine-tuning, analytics dashboards, or automatic prompt optimization;
* a broad source/document-specific optimization library;
* new Companies House collection surfaces or live external requests;
* changes to existing KYC behavior.

---

## 16. Stop Conditions

Stop and report to Architecture Authority before implementation proceeds if it would require:

* changing the meaning of an existing KYC/KYB schema concept;
* inventing a schema field, information need, or schema version;
* automatically adopting discovered facts into a configured schema;
* combining source trust and extraction support;
* defining universal trust tiers;
* selecting which conflicting fact wins;
* changing downstream KYC behavior;
* making derived facts indistinguishable from direct/source facts;
* weakening or rewriting A1/A2 history, identity, access, reuse, or recollection semantics;
* irreversible coupling to one AI/model provider;
* modifying legacy source steering or KYC persistence to make A3 convenient.

---

## 17. Completion Criteria

Stage A3 is complete when fixtures, automated tests, and the isolated Evidence Lab demonstrate:

```text
preserved A1/A2 Artifact
        ↓
deterministic or semantic Extraction Run
        ↓
requested or discovered fact
        ↓
direct/source or explicitly derived meaning
        ↓
explainable extraction-support state
        ↓
optional independent verification
        ↓
immutable, temporally correct, reconstructable lineage
        ↓
qualified downstream output without KYC decisioning
```

while leaving matching, satisfaction, conflict resolution, Ledger/Package, final integration, source-trust policy, and existing KYC behavior outside A3.
