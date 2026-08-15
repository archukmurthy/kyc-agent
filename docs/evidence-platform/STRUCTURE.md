# Evidence Platform Stage A0 Structure

Stage A0 establishes an isolated, callable seam without implementing Evidence Platform domain behavior.

- `evidence/platform.js` is the dependency-free server-side module boundary. It currently reports only platform availability and the authorized build stage.
- `api/evidence/status.js` exposes that boundary through `GET /api/evidence/status`.
- `public/evidence-lab.html` is an internal static test harness. It calls the status endpoint and renders whether the boundary is reachable.
- `evidence/__tests__/platform.nodetest.js` verifies the module and route contract without external services.
- `src/setupProxy.js` registers the same GET route for local CRA development.

This scaffold does not define domain identities, persistence, tenancy, authorization, capture, extraction, requirements, matching, audit semantics, external integrations, or production workflow behavior. The existing KYC and Pre-boarding customer journeys remain separate and unchanged.
