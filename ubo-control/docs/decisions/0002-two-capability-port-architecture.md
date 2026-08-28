# ADR 0002: Two capability ports

- Status: Accepted
- Decision date: 2026-08-28
- Authority: UBO Control Room

## Context

Discovery and document interpretation may be supplied by different external systems without coupling the UBO domain to providers.

## Decision

UBO Control owns exactly two candidate-fact capability contracts: asynchronous `DiscoveryService.discover(request)` and `ExtractionService.extract(request)`. Implementations are duck typed and explicitly injected; no framework inheritance, automatic provider selection, or implicit stub fallback is allowed.

## Consequences

Customer-authored adapters remain possible. Missing or invalid ports fail composition with stable `UboConfigurationError` codes.
