# ADR 0016: Host and provider adapters live outside the standalone core

## Status

Accepted for G3.1.

## Decision

Host-specific and provider-specific adapters live outside `ubo-control/` and depend inward only on its deliberate public contract. The standalone UBO core never imports outward from `integrations/`, and external adapters may not deep-import private UBO modules.

The disposable legacy Discovery adapter therefore lives at `integrations/ubo-control/legacy-discovery/`. It implements the public `DiscoveryService` shape around an injected transport and treats `POST /api/ubo-discovery` as an external capability. It imports no legacy implementation source.

## Consequences

- `ubo-control/` remains mechanically extractable and provider-neutral.
- Provider selection, transport, credentials and endpoint execution remain host composition concerns.
- Legacy conclusions cannot enter the fresh graph, calculation, policy or determination layers through an internal dependency.
- The adapter can be deleted or replaced without changing core production code.
- Any future need for a new public UBO surface requires Control Room approval before `index.js` changes.
