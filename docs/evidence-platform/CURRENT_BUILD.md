# Evidence Platform — Current Build Brief

# Stage A3 — Extraction, Interpretation, Verification Lineage, and Same-Evidence-Asset Multi-Artifact Integration

## 1. Objective

Extend the accepted A1/A2 Evidence domain so preserved Evidence Artifacts can produce reconstructable, evidence-grounded facts through deterministic extraction, AI-assisted semantic interpretation, bounded KYC/KYB-relevant discovery, explicit derivation lineage, explainable extraction-support assessment, and selective independent verification.

A3 is an Evidence interpretation and verification-lineage stage. Its acceptance boundary includes proving that A3 can interpret a real persisted Artifact previously produced by A2 and one explicitly selected coherent set of Artifacts belonging to the same Evidence Asset. It does not become the KYC decision engine, redesign existing source steering, or implement matching and requirement satisfaction.

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

### Real persisted-Artifact append path

Add a bounded real execution path with these semantics:

```text
existing A2 Acquisition
    ↓
existing Evidence Asset
    ↓
existing persisted Artifact
    ↓ server-side load + SHA-256 verification
NEW A3 Extraction Run
    ↓
NEW requested / discovered / derived facts and lineage
```

The path must not recollect Companies House evidence, recreate or re-persist the Acquisition, Evidence Asset, Artifact, or complete A1/A2 graph, change Artifact identity, change capture/observation time, or change its fingerprint. The existing fixture bundle path may remain for deterministic acceptance tests.

The server, not the browser, must resolve the authorized Artifact metadata and A1/A2 provenance, storage reference, media/representation type, timestamps, stored SHA-256 fingerprint, and supplied extraction context. It must load preserved bytes from authorized Evidence storage and verify them against the persisted fingerprint before interpretation. Browser-supplied bytes must not be treated as the authoritative preserved evidence. Do not expose unrestricted storage references, filesystem paths, credentials, database credentials, or arbitrary file-reading capability.

Add only the bounded storage read and append-only persistence capability needed for this path. A real A3 run must append against existing A1/A2 foreign keys rather than re-persisting the base graph.

### Same-Evidence-Asset multi-Artifact append path

Add the remaining bounded A3 capability:

```text
existing Evidence Asset
    ├── existing Artifact A
    ├── existing Artifact B
    └── existing Artifact C
            ↓ server-side authorization, load, ordering, and SHA-256 verification
NEW A3 Extraction Run referencing the selected coherent Artifact set
            ↓
NEW facts with precise supporting-Artifact lineage
```

The Evidence Asset is the grouping boundary. A request may interpret one Artifact or an explicitly selected coherent set belonging to the same Evidence Asset. Do not automatically combine Artifacts from different Evidence Assets, acquisitions, recollections, contexts, or API and website Evidence Assets, or combine public and private evidence merely because it concerns the same subject. Do not introduce a document identity, page-bundle identity, global document abstraction, source-specific pagination object, or second Evidence Asset concept.

For every selected input, the server must resolve its existing identity and provenance, verify authorization under the supplied interpretation context, load authoritative stored bytes, calculate and verify SHA-256, and retain its original capture timestamp and Artifact boundary. The browser must supply only bounded selection identity, never authoritative bytes, paths, storage references, fingerprints, or credentials. If safe authorization would require a new cross-context access policy, stop for Architecture Authority.

Use persisted source/page ordering where it exists. Do not invent source-specific ordering inside generic A3. If order is absent or ambiguous and materially affects interpretation, fail or report an explicit limitation rather than fabricate order.

When the Evidence Asset records a required complete ordered set, interpreting only a subset must be marked incomplete with limitations and appropriate support qualification. Do not silently skip, sample, truncate, or summarize away required inputs. Input-size, provider, or token limits must not turn partial interpretation into a complete result.

One Extraction Run may reference every selected input Artifact, but that alone does not establish support for each Fact. Add the minimum additive immutable relationship required so each Fact identifies the one or more input Artifacts that actually support it. Existing single-Artifact Facts remain valid, a jointly supported Fact must not be duplicated merely to record multiple supporting Artifacts, and no support relationship may be fabricated from run participation. A new forward-only migration is permitted if required; migration 012 must not be modified.

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

Do not automatically copy existing Companies House deterministic values from `evidence_extracted_values` into new A3 facts. Their original A2 run and Artifact lineage is the truthful extraction history. A unified read projection may display A2 values beside A3 facts if useful without fabricating a new run or backfilling the A3 fact model.

One optional real semantic AI provider adapter is authorized for local Evidence Lab acceptance behind the provider-neutral contract. Keep the deterministic fixture provider so automated tests require no paid AI call. Credentials are environment-only, never committed or displayed, never returned from configuration endpoints, and never persisted in facts or provenance.

The provider boundary may be enriched with a provider-neutral, media-aware input containing one Artifact or a coherent ordered set of verified Artifacts from the same Evidence Asset. For every input preserve Artifact identity, media and representation type, exact verified bytes or protected server-side content, optional decoded text/structured representation, persisted ordering where available, extraction context, and requested concepts. Provider-specific message structures must remain in adapters, and original Artifact boundaries must remain reconstructable. Provider-produced facts must identify their actual supporting Artifact or Artifacts; unsupported cross-Artifact inference must not masquerade as directly stated evidence. The first real path may support Companies House structured JSON and rendered HTML. Screenshot/image interpretation is permitted through this boundary but may remain an explicit controlled follow-on if correct image support is materially larger; do not pass image bytes through a text-only contract or imply that screenshots were interpreted.

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

Retain the isolated fixture/synthetic scenarios so deterministic automated acceptance does not require real customer data, live external requests, or paid AI calls.

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

Also add the bounded real A2-to-A3 product-review journey:

```text
Collect real Companies House company through A2
    ↓
inspect and select an eligible persisted Artifact
    ↓
server retrieves preserved bytes and verifies SHA-256
    ↓
run A3 interpretation
    ↓
inspect real facts and complete A2/A3 lineage
```

Complete the additional same-Evidence-Asset acceptance journey:

```text
select one ordered multi-Artifact Evidence Asset
    ↓
resolve, authorize, load, and fingerprint-verify every selected Artifact
    ↓
run one provider-neutral interpretation over the coherent ordered set
    ↓
inspect input completeness, Artifact boundaries, facts, and per-Fact Artifact support
```

The immediate product-review case may use the complete persisted Officers Website Evidence Asset, including all preserved ordered HTML pages, but the implementation and tests must remain generic rather than creating Companies House-specific interpretation or ordering rules. Do not introduce a universal officer/director ontology. First observe whether complete context improves representation consistency.

The initial real path must support eligible Companies House structured JSON and rendered HTML Artifacts. It must not require recollection. A real result must visibly identify at least:

* input mode: `LIVE PRESERVED ARTIFACT`;
* Collection, Evidence Asset, Artifact, Artifact type, source, and producer;
* capture/observation timestamp separately from extraction timestamp;
* extraction method and provider/model/instruction lineage where applicable;
* requested, discovered, and derived facts where produced;
* support state and signals;
* complete provenance/lineage.

The fixture area must be labelled with the meaning:

```text
A3 SYNTHETIC FIXTURE SCENARIOS

This demonstration uses built-in ABC Limited fixture evidence.
It does not use or interpret the A2 collection shown above.
No live Artifact is selected.
```

Use action wording equivalent to `Run synthetic A3 fixture scenarios` so a reviewer cannot infer that the fixture output came from the preceding live A2 collection.

The Lab is an internal product-review surface, not a final customer UI or decision engine.

---

## 13. Persistence and Historical Invariants

Tests must prove:

* A1/A2 Artifacts and Extraction Runs are extended, not duplicated;
* discovered facts persist without fake schema or information-need identifiers;
* requested/discovered and direct/derived status are explicit;
* every direct fact traces to preserved evidence and its producing run;
* a multi-Artifact run references only explicitly selected, authorized Artifacts from one Evidence Asset;
* every selected input is independently loaded and fingerprint-verified before provider execution;
* every fact identifies the Artifact or Artifacts that actually support it, without treating all run inputs as automatic support;
* persisted ordering is honored and ambiguous material ordering is not fabricated;
* incomplete input sets, skipped inputs, and provider/input limits cannot masquerade as complete interpretation;
* every derived fact traces to its input fact(s), Artifact(s), run, and transformation;
* every verification run remains separate from the original run;
* later runs never rewrite prior output;
* source/capture time is not changed by reuse or re-extraction;
* source trust and extraction support remain independently representable;
* provider/model/prompt or extractor-version lineage is queryable without exposing secrets;
* qualified values can be returned without implying requirement satisfaction or acceptance;
* existing A1/A2 persistence remains compatible and historical provenance is not weakened;
* a real A2 Artifact can be loaded by server-side identity, fingerprint-verified, and interpreted without recreating or changing its A1/A2 graph;
* the real path appends A3 runs and facts against existing provenance;
* existing A2 deterministic extracted values are not duplicated into A3 facts;
* fixture and live preserved-Artifact inputs are clearly distinguishable;
* unsupported media and integrity/provider/storage/persistence failures do not fabricate facts or mutate preserved evidence.

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
* changes to existing KYC behavior;
* materializing or backfilling A2 deterministic extracted values into A3 facts;
* browser-authoritative Artifact byte submission or unrestricted Artifact/storage access;
* bulk reinterpretation or model-evaluation infrastructure;
* pretending screenshot/image interpretation occurred through a text-only provider;
* automatic interpretation across different Evidence Assets, acquisitions, recollections, contexts, or API and website Assets;
* a new document, page-bundle, or global evidence identity;
* a universal officer/director ontology or Companies House-specific semantic normalization;
* exact raw AI request/response persistence, which remains deferred pending security, access, encryption/redaction, and retention policy.

---

## 15A. Failure, Retry, and Re-interpretation Semantics

Truthfully handle Artifact not found, unauthorized Artifact/context access, Artifact storage unavailable, SHA-256 mismatch, unsupported media, AI provider unavailable, provider authentication failure, timeout, malformed output, no supported facts, and database persistence failure.

No failure may mutate or delete the Artifact or A2 evidence, fabricate facts, or silently report successful interpretation. Preserve non-secret failure lineage where appropriate.

Do not silently conflate a retry of a failed execution, an idempotent replay, and a deliberate later interpretation of the same preserved Artifact using a new model, prompt, or context. A legitimate later interpretation may create a new immutable Extraction Run while retaining the original Artifact and every prior run. Exact idempotency mechanics are implementation discretion; stop for Architecture Authority if they require a new material run-identity policy.

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
* modifying legacy source steering or KYC persistence to make A3 convenient;
* treating browser-supplied bytes as authoritative preserved evidence;
* interpreting bytes after a fingerprint mismatch;
* defining a new material retry/replay/re-interpretation identity policy;
* authorizing multiple selected Artifacts safely only by inventing a new cross-context access-intersection policy;
* representing precise multi-Artifact Fact support only by weakening existing Artifact lineage or duplicating Facts.

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

Completion also requires a bounded live preserved-Artifact demonstration:

```text
real persisted A2 Artifact
        ↓ server-side retrieval
verified stored SHA-256
        ↓
NEW immutable A3 Extraction Run
        ↓
real facts + support + complete A2/A3 provenance
```

with truthful failure behavior, separate capture and extraction times, no duplicate A2 deterministic extraction, explicit fixture-versus-live labeling, and no KYC integration or later-stage functionality.

Completion additionally requires one coherent same-Evidence-Asset interpretation demonstrating ordered verified inputs, truthful complete/incomplete input semantics, immutable per-Fact support by one or multiple Artifacts, preserved Artifact boundaries and timestamps, and no automatic cross-Asset combination. Exact raw provider request/response persistence remains deferred and byte-for-byte provider-response reconstructability must not be claimed.
