# UBO Control implementation contract

This directory is a standalone product temporarily co-located in the host repository. Its production code must remain mechanically extractable into a separate repository.

## Product boundary

- Production code inside `ubo-control/` may not import production code outside `ubo-control/`.
- Discovery and Extraction are external capabilities reached only through the approved `DiscoveryService` and `ExtractionService` contracts.
- Do not import legacy UBO internals, onboarding code, Evidence Platform internals, host database code, provider SDKs, or deployment-specific infrastructure.
- The host may consume the public `ubo-control/index.js` API. UBO Control must not consume host application code.

## Architecture authority

- The Control Room owns policy, graph, candidate-fact, evidence-boundary, gap, identity, audit, and deterministic-calculation semantics.
- Do not change those semantics or the standalone-product boundary without explicit Control Room approval.
- Codex may draft an architectural change or implement an approved decision. Codex may not self-approve an architectural change.
- Gate and sub-gate progression requires explicit Control Room acceptance.

## Providers and stubs

- Providers are supplied only through explicit dependency injection.
- Stubs can never be selected automatically or used as an implicit production fallback.
- Missing or invalid required providers must fail with the approved typed configuration error.

## Tests and changes

- Every implementation change must include its protecting executable tests in the same PR.
- “Implementation now, tests later” is not an accepted intermediate state.
- Bug fixes require a regression test wherever technically meaningful.
- Keep `BUILD_LEDGER.md` and `TEST_MATRIX.md` accurate in every meaningful UBO PR.
- Keep changes within the currently approved gate scope.
