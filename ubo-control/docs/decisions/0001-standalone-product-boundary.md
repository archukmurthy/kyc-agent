# ADR 0001: Standalone product boundary

- Status: Accepted
- Decision date: 2026-08-28
- Authority: UBO Control Room

## Context

UBO Control is temporarily co-located in an existing KYC repository but is intended to become an independently deployable product.

## Decision

All production dependencies of UBO Control remain beneath `ubo-control/`, except Node built-ins. The host may consume `ubo-control/index.js`; UBO Control may not import host, legacy UBO, onboarding, Evidence Platform implementation, provider SDK, database, or deployment infrastructure.

## Consequences

Repository extraction remains mechanical. Host integrations must use the public API or explicit external adapters.
