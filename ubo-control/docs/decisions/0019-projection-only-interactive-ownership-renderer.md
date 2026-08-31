# ADR 0019: Projection-only interactive ownership renderer

## Status

Proposed for G5.1B acceptance.

## Decision

The interactive ownership renderer lives in the separate `ubo-control-ui/` package and accepts only the public `ubo-ownership-graph-projection-v1` value. Its dependency direction is one-way: `DecisionSnapshot → projectOwnershipGraph → OwnershipGraph`. The standalone UBO core never imports the UI package.

The renderer may validate the projection, compute presentation-only geometry, navigate durable references and format already-recorded values. It may not construct or adjudicate claims, calculate effective interests, evaluate policy, resolve requirements, choose conflicts or infer qualifications. Calculation explanations concatenate the projection's recorded direct measurements and recorded contribution; no UI arithmetic occurs.

The React component supports `CUSTOMER` and `EXPLAIN` detail levels, interactive node/relationship/path/conflict/review selection, path emphasis, pan/zoom/fit, semantic node/relationship styling, keyboard operation, named SVG content and a screen-reader text description. A standalone deterministic demo presents UI01–UI12 without a provider, host application, onboarding flow or Evidence Platform.

## Consequences

API-only customers remain free to consume the public projection without this renderer. Host products can compose the UI later without giving the renderer authority over onboarding or case state. Historical comparison remains a future capability: G5.1B can display an explicitly selected historical projection and demonstrates before/after projection replacement, but does not reconstruct, diff or merge DecisionSnapshots.

The legacy `public/ubo-lab.html` renderer remains a design reference only. No legacy graph, threshold, UBO conclusion, calculation or flag logic is imported or copied. Visual fixtures are generated through public Decision Application and projection operations and are checked into source control for deterministic review.
