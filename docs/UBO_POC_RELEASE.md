# UBO POC release and rollback runbook

The UBO POC is promoted from `codex/ubo-demo-integrated`. The development branch remains active after promotion; a POC deployment is built from an immutable annotated tag and must not follow later branch commits.

## Release gate

Promote in this order:

1. Confirm the branch and review every working-tree difference.
2. Run the UBO Jest/Node regression suite, IDV tests, health contract tests, and production build.
3. Run the real-provider localhost journey: live company research → ownership/control graph → ownership-chart upload → Evidence extraction → reconciliation → Questions → recalculation → natural-person UBO assessment → dummy IDV → Analyst Review → Audit.
4. Require a validated usable Evidence result under the current COMPLETE/PARTIAL policy. The release smoke currently requires `COMPLETE`; do not silently weaken that assertion.
5. Record the commit SHA, then create one annotated tag such as `ubo-poc-v1.0.0`. Never force-move or reuse a release tag.
6. Build and deploy a dedicated POC project from a clean checkout of that exact tag. Disable Git auto-deploy for the POC project; promote only through an explicit CLI/dashboard deployment of a tag checkout.
7. Call the authenticated `/api/ubo-poc-health` endpoint and require the expected HEALTHY result (or explicitly accepted, understood DEGRADED result).
8. Repeat the entire real-provider journey on the hosted POC URL. A localhost pass alone is not a release.

Recommended commands before tagging:

```powershell
git switch codex/ubo-demo-integrated
git status --short --branch
npm run test:ubo-demo:regression
npm run idv:test
node --test api/__tests__/uboPocHealth.nodetest.js
npm run build
$env:POC_BASE_URL = "http://localhost:3000"
npm run test:ubo-poc:release-smoke
git tag -a ubo-poc-v1.0.0 -m "UBO customer POC v1.0.0" <verified-sha>
git push origin refs/tags/ubo-poc-v1.0.0
```

The scripted release smoke covers the provider-backed research and durable Evidence path. Before promotion, the release operator must also complete and record the browser journey through reconciliation, Questions, recalculation, dummy IDV, Analyst Review, and Audit until those later stages have an automated deployed-path test.

## POC environment checklist

Use POC-specific resources and values. Never copy values into source control.

| Capability | Required configuration |
| --- | --- |
| Release identity | `UBO_POC_ENVIRONMENT`, `UBO_POC_PRODUCT_VERSION`, `UBO_POC_COMMIT_SHA` |
| Browser build identity | `REACT_APP_UBO_ENVIRONMENT`, `REACT_APP_UBO_PRODUCT_VERSION`, `REACT_APP_UBO_COMMIT_SHA` (set before build) |
| Base URL / smoke | `POC_BASE_URL`, optional `POC_SMOKE_TIMEOUT_MS` in the release runner |
| Database | POC-only `DATABASE_URL` and provider-specific Postgres variables where required |
| Evidence artifacts | POC-only `BLOB_READ_WRITE_TOKEN`; do not use hosted filesystem fallback |
| Cache / saved research | POC-only KV REST variables or `REDIS_URL`; do not use hosted filesystem fallback |
| Companies House | `COMPANIES_HOUSE_API_KEY` |
| AI extraction / research | `ANTHROPIC_API_KEY`, `EVIDENCE_A3_ANTHROPIC_MODEL`, and `UBO_RESEARCH_ANTHROPIC_MODEL` if overridden |
| Health | dedicated random `UBO_POC_HEALTH_KEY` |
| Demo / IDV | `UBO_POC_IDV_MODE=DEMO`; dummy IDV only, clearly labelled in the journey and health response |
| Logging | POC log destination/retention settings supported by the hosting account; do not log provider payloads or credentials |

The analyst footer and health response must show the same environment, tag, and commit SHA. CRA `REACT_APP_*` values are embedded at build time, so changing them requires a rebuild.

## Health preflight

`GET /api/ubo-poc-health` requires `x-internal-health-key`. It reports application/release identity, database, Evidence tables and artifact backend, extraction worker state, research cache backend, Companies House connectivity, AI extraction provider, and research provider. Statuses are `HEALTHY`, `DEGRADED`, or `UNAVAILABLE`; credentials are never returned.

An `UNAVAILABLE` result returns HTTP 503. A hosted filesystem artifact or cache backend is explicitly unavailable because it cannot survive deployment/process replacement.

## Persistence inventory

Durable after migration 021 is applied:

- ownership uploads and Artifact bytes when Blob is configured;
- Artifact metadata, extraction jobs, attempts, extraction results, and reuse identity in Postgres;
- the active UBO case projection and append-only case action history in Postgres;
- fact requirements, generated questions, answer submissions, supporting-evidence references, versioned UBO assessments, verification requirements and dummy-IDV completion events in Postgres;
- research/audit persistence and replay/cache records in the configured KV/Redis backend.

Browser state is now a disposable compatibility/read-through cache for:

- the active case pointer and shareable `?case=` selection;
- form drafts that have not been submitted;
- graph zoom, expanded panels, and other display preferences;
- ownership-document preview object URLs and selected-file bytes before upload;
- locally exported/imported replay-library UI selection.

Submitted business state is restored by case ID after refresh, process replacement, or on another browser/device. Unsubmitted drafts and display preferences are intentionally ephemeral and must not be treated as the system of record.

The case projection is mutable for efficient restore, while `ubo_poc_case_events`, answer rows, assessment versions and verification events preserve submitted history. Evidence continues to own artifact bytes and extraction jobs; the case database stores only their durable identifiers.

## Deployment

Create/use a dedicated Vercel project for the POC, provision its dedicated Postgres, Blob, and Redis/KV resources, and configure the variables above for Production only. Disconnect automatic Git production deployments. From a clean checkout detached at the immutable tag, link that checkout to the POC project and run the production deployment command. Record the deployment ID, immutable tag, SHA, and resulting URL.

Do not merge to `main` solely to deploy. The CLI deployment can build the tag checkout directly. If hosting policy is later changed to require a protected deployment branch, report and approve that change before merging.

After deployment, run:

1. authenticated health preflight;
2. the scripted smoke with `POC_BASE_URL` set to the hosted URL;
3. the complete hosted browser journey listed in the release gate.

## Rollback

1. Select the previous known-good immutable UBO POC tag and verify its recorded SHA.
2. Check out that tag in a clean deployment checkout.
3. Rebuild with build metadata set to that tag/SHA and the unchanged compatible POC resource configuration.
4. Deploy it explicitly to the same dedicated POC project and promote that deployment to the POC production alias.
5. Run health preflight and the hosted smoke again.
6. Preserve failed deployment logs and database/artifact data for diagnosis; do not move either tag.

Migration 021 is additive and the application can ignore its new tables when rolling back to a pre-021 binary. Preserve the tables and case data during rollback; do not run destructive down-migrations. Schema changes must remain backward compatible with the previous release before rollback can be considered safe. If not, the release plan must include a tested forward-fix procedure.
