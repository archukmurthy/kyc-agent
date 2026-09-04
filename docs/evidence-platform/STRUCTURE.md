# Evidence Platform Structure

Stage A0 establishes an isolated, callable seam without implementing Evidence Platform domain behavior.

- `evidence/platform.js` is the dependency-free server-side module boundary. It currently reports only platform availability and the authorized build stage.
- `api/evidence/status.js` exposes that boundary through `GET /api/evidence/status`.
- `public/evidence-lab.html` is an internal static test harness. It calls the status endpoint and renders whether the boundary is reachable.
- `evidence/__tests__/platform.nodetest.js` verifies the module and route contract without external services.
- `src/setupProxy.js` registers the same GET route for local CRA development.

At Stage A0, this scaffold intentionally defined no substantive Evidence domain behavior. The existing KYC and Pre-boarding customer journeys remain separate and unchanged.

## Stage A1 additions

- `evidence/a1/domain.js` validates the approved core-domain and lineage invariants without owning KYC decisioning.
- `evidence/a1/fixtures.js` defines deterministic Companies House and customer-upload scenarios, including recollection and independent extraction results.
- `evidence/a1/repository.js` provides memory and injected-PostgreSQL persistence boundaries for the same validated graph.
- `evidence/a1/service.js` exercises the fixture graph through the repository boundary.
- `api/evidence/a1-fixture.js` exposes the fixture-only demonstration to Evidence Lab; it does not connect a real producer.
- `db/migrations/010_evidence_platform_a1.sql` defines additive, bounded Evidence persistence without altering legacy tables.
- `public/evidence-lab.html` renders the fixture demonstration separately from the customer journey.

Stage A1 does not implement real acquisition, AI extraction, verification decisioning, matching, satisfaction, ledger, packaging, or KYC integration.

## Stage A2 additions

- `evidence/a2/` contains the producer-neutral collection identity boundary and the bounded six-acquisition Companies House producer, exact-byte artifact storage, deterministic API extraction, paginated Overview/Officers/PSC website capture, fixtures, and transactional repository.
- `api/evidence/a2-collect.js` exposes the internal live/fixture collection operation to Evidence Lab without changing existing KYC routes.
- `evidence/a2/historyService.js` and `api/evidence/a2-existing.js` reopen the latest usable public live Companies House collection by producer coordinates using read-only persistence queries. They do not invoke Companies House, start a browser, create Evidence records, or expose Artifact storage locations.
- `db/migrations/011_evidence_platform_a2.sql` adds collection-operation identity and an additive acquisition relationship.
- `public/evidence-lab.html` clearly separates fixture and live collection, distinguishes structured API completeness from supplementary human-viewable capture completeness, and renders acquisitions, page artifacts, fingerprints, failures, and extraction lineage.

The standalone A2 Lab uses an explicitly named default extraction context only to demonstrate deterministic lineage. It does not make the Companies House producer inherently dependent on `FI:uk-licence`; the future upstream KYC/Onboarding context handoff remains outside A2.

Stage A2 does not redirect existing Companies House, KYC, self-source, dossier, or UBO behavior.

## Stage A3 additions

- `evidence/a3/domain.js` validates requested/discovered, direct/derived, support, derivation, verification, and immutable-lineage invariants while continuing to validate the underlying A1 graph.
- `evidence/a3/providers.js` defines the substitutable, media-aware semantic-extraction provider boundary, a no-cost fixture adapter, and an optional environment-configured Anthropic adapter for local live acceptance.
- `evidence/a3/extractor.js` converts provider output into common Evidence facts and derives explainable support states from evidence signals rather than source trust.
- `evidence/a3/artifactReader.js` resolves bounded server-side reads through the existing Evidence filesystem or private Blob storage providers without exposing storage access to the browser/provider.
- `evidence/a3/liveService.js` resolves one or more persisted A2 Artifacts from the same Evidence Asset, authorizes and verifies each SHA-256 independently, preserves persisted input order and completeness limitations, filters duplicate A2 deterministic values, and appends one immutable A3 interpretation against the existing graph.
- `evidence/a3/fixtures.js` demonstrates deterministic and semantic extraction, discovered facts, SIC derivation, qualified output, agreement/disagreement verification, failed attempts, and capture-versus-re-extraction time.
- `evidence/a3/repository.js` extends existing A1 Extraction Runs, resolves authorized persisted Artifacts, and appends A3 facts and lineage without re-persisting or modifying the A1/A2 graph.
- `evidence/a3/service.js` provides the isolated fixture demonstration used by `api/evidence/a3-fixture.js` and Evidence Lab.
- `db/migrations/012_evidence_platform_a3.sql` additively extends Extraction Run lineage and adds fact, derivation, multi-Artifact input, and verification relationships.
- `db/migrations/013_evidence_fact_artifact_support.sql` additively records the precise one-or-many input Artifacts that support each Fact; migration 012 remains immutable.
- `scripts/evidence-a3-db-smoke.js` applies A1 and A3 migrations only to the guarded disposable Evidence test database and verifies representative persisted lineage.
- `api/evidence/a3-interpret.js` and `api/evidence/a3-config.js` expose the internal live preserved-Artifact operation and non-secret readiness state.
- `evidence/a3/historyService.js` and `api/evidence/a3-history.js` reopen persisted interpretation runs and Facts for an authorized Artifact without reading Artifact bytes or invoking a semantic provider.
- `public/evidence-lab.html`, `public/evidence-lab.js`, and `public/evidence-lab-state.js` keep view-existing, view-interpretation-history, explicit fresh interpretation, and explicit recollection separate; retain interpretation cards across Artifact selections; and guard repeated submissions with truthful indeterminate execution state.

Stage A3 does not implement matching, satisfaction, source winner selection, trust policy, customer or analyst decisioning, schema mutation, KYC integration, Ledger, Package, or later roadmap stages.

## Stage A4a additions

- `evidence/a4a/` evaluates explicitly selected immutable A3 Facts against one existing persisted Information Need using exact typed comparison, versioned conservative normalization, or a provider-neutral semantic evaluator.
- `db/migrations/014_evidence_need_evaluations.sql` adds immutable evaluation runs and per-Fact conclusions without changing migrations 010-013 or existing Facts and Information Needs.
- `api/evidence/a4a-evaluate.js` resolves submitted Fact and Information Need IDs server-side within tenant, context, subject, and public/private access boundaries; `a4a-history.js` reopens prior evaluations without a provider call.
- `api/evidence/a4a-options.js` provides a read-only, tenant/context-scoped view of existing human-readable Information Needs and A3 Facts for a loaded Evidence collection. Evidence Lab submits the underlying persisted IDs; it does not fabricate selector records.
- `api/evidence/a4a-fixture.js` and Evidence Lab expose the ten approved no-cost product scenarios. A live semantic action is explicit and separately identified.

Evidence Lab defaults to an automatic routing preview over the existing exact-typed, conservative-normalization, and semantic methods. It truthfully reports that standalone Information Needs currently carry a schema concept but no expected comparison value, keeps manual comparison input under advanced testing controls, and never invokes a provider merely because a reviewer selects a Need or Fact.

A4a records only whether a Fact addresses an Information Need, with reasoning, qualifications, comparison inputs, evaluator lineage, and timestamps. It does not select a winner or operative value, decide final KYC satisfaction, aggregate conflicts, infer collection completeness, create Facts or derivations, or implement A4b.

## Consumer Readiness R1 additions

- `evidence/r1/` implements generic private Artifact validation, idempotent ingestion, exact tenant-plus-context authorization, stored-byte SHA-256 readback verification, immutable Evidence persistence and authorized reopen.
- `api/evidence/r1-*.js` exposes a local-only Lab adapter using server-resolved tenant authority. Production consumers call the server-side R1 service only after their host authorization boundary; the browser is never accepted as proof of tenant/context authority.
- Existing A1/A2 persistence and Artifact storage are reused without a migration. PDF, PNG and JPEG acquisition support remains independent from interpretation support.
- Evidence Lab distinguishes successful preservation from interpretation and verifies authorized reopen without exposing storage references or credentials.

R1 does not extract facts, interpret documents, assess trust or sufficiency, decide KYC outcomes, implement UBO behavior, or start A4b/R2/R3/R4.

## Consumer Readiness R2 additions

- `evidence/r2/domain.js` validates bounded neutral concepts, provider-neutral extraction context, opaque correlation, trusted authorization metadata, operation keys, and canonical request fingerprints.
- `evidence/r2/repository.js` provides durable atomic operation-key claims, immutable completed/failed history, authorized human-readable Artifact selection, and the narrow adapter that prevents a neutral R2 concept from fabricating schema-field or Information-Need linkage in A3 Facts.
- `evidence/r2/service.js` resolves and authorizes persisted Artifact inputs, enforces coherent same-Asset ordering, delegates JSON/HTML interpretation to A3, returns a bounded stable result, and separates fresh execution from no-provider history.
- `api/evidence/r2-*.js` exposes the stable server boundary. Production requests require trusted host authorization; the local Evidence Lab adapter is explicitly non-production.
- `db/migrations/015_evidence_interpretation_operations.sql` adds one durable interpretation-operation record with scoped operation-key uniqueness, request fingerprint, bounded correlation, status, optional Extraction Run linkage, bounded failure, and timestamps. Migrations 010-014 remain unchanged.
- `scripts/evidence-r2-db-smoke.js` verifies migration 015 and atomic operation replay only against the guarded disposable Evidence database.
- Evidence Lab exposes authorized context/Asset/Artifact selection, neutral concepts, a paid-call preview, explicit fresh interpretation, deliberate new operation keys, and no-provider history reopening. Unsupported PDF/image interpretation is distinguished from valid R1 preservation.

R2 creates or reopens A3 interpretation history only. It does not recollect Evidence, invoke A4a, import consumer-domain identifiers, determine UBO/controllers or KYC satisfaction, interpret PDF/images, implement R3/R4, or start A4b.

## Consumer Readiness R3 additions

- `evidence/a3/media.js` applies bounded, deterministic PDF/PNG/JPEG signature, readability, page, dimension, byte, aggregate-request, Artifact-count, and provider/model-capability preflight to server-reopened, SHA-256-verified bytes.
- `evidence/a3/locators.js` validates media-specific source locations and retains only truthful bounded excerpts/descriptions, valid PDF page ranges, and optional original-image coordinates that can be mapped reliably.
- `evidence/a3/providers.js` retains a provider-neutral `text`/`image`/`document` input boundary. Only the Anthropic adapter translates those inputs to provider-native content blocks.
- `db/migrations/016_evidence_fact_artifact_locators.sql` adds immutable zero/one/many source locators beneath the existing Fact-to-Artifact support pair; migrations 010-015 remain unchanged.
- `api/evidence/r2-preflight.js` performs authorized, read-only media readiness checks without provider calls or Evidence writes. The existing R2 interpretation and history routes now support governed PDF, PNG, JPEG, JSON, HTML, and coherent same-Asset mixed-media selections.
- `scripts/evidence-r3-db-smoke.js` verifies migration 016 and persisted locator reopening only against the guarded disposable Evidence database.
- Evidence Lab extends the existing targeted-interpretation experience with explicit no-AI readiness checks, PDF page/image dimension reporting, provider-use preview, and human-readable persisted locator history.

R3 never rewrites canonical Artifacts, changes their SHA-256, persists raw provider exchanges, fabricates locations, infers UBO/currentness/operative claims, crosses Evidence Assets or contexts, or implements R4 or A4b.

## Consumer Readiness R4 additions

- `evidence/r4/domain.js` owns the versioned provider-neutral subject–relationship–object grammar and deterministic party, vocabulary, value, temporal, direction, and lineage validation.
- `evidence/r4/pscMapper.js` is an explicit bounded deterministic Companies House PSC nature-of-control adapter. It appends derived Facts and existing derivation lineage only for unambiguous mappings; it never rewrites A2/A3 source Facts or automatically backfills history.
- `db/migrations/017_evidence_typed_relationships.sql` adds one optional typed relationship extension keyed one-to-one by an ordinary `evidence_facts` ID. Core grammar remains queryable while bounded source snapshots and metadata remain validated JSONB.
- The existing A3/R2/R3 interpretation path may accept an optional provider candidate, validates it inside Evidence, persists only valid extensions, and retains a safe ordinary Fact plus an immutable limitation when typing fails.
- Existing R2 result/history and Evidence Lab cards show human-readable source assertions, values, temporal state, support locators, and provider/mapper lineage while retaining the ordinary Fact for reconstruction.
- `scripts/evidence-r4-db-smoke.js` verifies migration 017, typed range semantics, one-Fact/one-extension persistence, Fact-to-Artifact/locator reconstruction, and immutable prior evidence against only the guarded disposable Evidence database.

R4 represents individual source assertions only. It does not create canonical parties, compute direct or indirect UBO status, select winners or operative values, infer currentness, determine KYC satisfaction, run A4a automatically, or implement A4b.

## Stage A4b additions

- `evidence/a4b/domain.js` validates and canonicalizes the bounded, versioned Assessment Specification. It rejects executable policy/prompt fields and does not add downstream requiredness, KYC thresholds or UBO rules to Information Needs.
- `evidence/a4b/comparators.js` provides the named/versioned conservative scalar and typed-relationship comparators. Exact/range overlap, explicit temporal applicability and governed party association are assessed without fuzzy matching, latest-wins logic or winner selection.
- `evidence/a4b/setAssertions.js` validates one optional typed set-assertion extension per ordinary Fact and contains the explicitly bounded Companies House no-registrable-PSC mapping. An incomplete/failed acquisition or no extracted value can never establish an empty set.
- `evidence/a4b/repository.js` resolves only caller-supplied immutable A4a evaluation and Fact pairs within existing subject, tenant, context and access boundaries; persists immutable runs, candidates and pairwise findings; and reopens history without a new assessment.
- `evidence/a4b/service.js` reports coverage, completeness, comparable disagreement, temporal applicability, empty-set state and input sufficiency as separate dimensions. It never mutates a Fact, Information Need or requirement lifecycle and never emits an operative value, winner, KYC outcome or UBO conclusion.
- `db/migrations/018_evidence_coverage_assessments.sql` additively creates the typed set-assertion extension, assessment runs, exact candidate contribution rows and pairwise comparison findings. Migrations 010-017 remain unchanged and no historical data is backfilled.
- `api/evidence/a4b-*.js` and Evidence Lab expose human-readable explicit A4a candidate selection, bounded scalar/collection and temporal semantics, explicit party associations, immutable assessment execution and no-compute history reopening.
- `scripts/evidence-a4b-db-smoke.js` exercises migrations 010-018 and the A4b foreign-key/append-only shape only against a guarded disposable PostgreSQL database.

A4b does not run A4a, call a semantic provider, pick latest Facts/evaluations, infer source suitability/freshness, choose a winner, determine KYC satisfaction or UBO status, mutate a graph, or implement customer-question decisioning.

## Characterization Net Coverage Map

| A4b invariant | Protecting net |
| --- | --- |
| Bounded specification; no executable/downstream policy | `evidence/a4b/__tests__/a4b.nodetest.js` specification cases |
| Exact A4a evaluation + Fact identity; access and no auto-latest | A4b service/repository tests and PostgreSQL smoke |
| Scalar coverage and no winner | A4b scalar coverage/agreement/disagreement cases |
| Exact/range and range/range compatibility | A4b typed comparator cases |
| Explicit party association only | A4b stable-identifier, caller-association and same-name rejection cases |
| Temporal overlap; no latest-wins conflict | A4b historical/current/as-of comparator cases |
| Members do not imply closure; explicit completeness/cardinality | A4b collection and cardinality cases |
| Legitimate empty set only from explicit successful source semantics | A4b typed-set and Companies House mapping cases |
| Six independent dimensions; no KYC/UBO conclusion | A4b service and Evidence Lab characterization cases |
| Immutable append and no-compute history | A4b memory/repository history cases |
| Additive migration and relational lineage | Migration characterization and `scripts/evidence-a4b-db-smoke.js` |
