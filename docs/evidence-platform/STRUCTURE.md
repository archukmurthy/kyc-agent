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
