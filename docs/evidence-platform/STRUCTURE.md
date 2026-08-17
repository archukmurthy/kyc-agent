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
- `db/migrations/011_evidence_platform_a2.sql` adds collection-operation identity and an additive acquisition relationship.
- `public/evidence-lab.html` clearly separates fixture and live collection, distinguishes structured API completeness from supplementary human-viewable capture completeness, and renders acquisitions, page artifacts, fingerprints, failures, and extraction lineage.

The standalone A2 Lab uses an explicitly named default extraction context only to demonstrate deterministic lineage. It does not make the Companies House producer inherently dependent on `FI:uk-licence`; the future upstream KYC/Onboarding context handoff remains outside A2.

Stage A2 does not redirect existing Companies House, KYC, self-source, dossier, or UBO behavior.
