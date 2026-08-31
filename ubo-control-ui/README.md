# Ownership Graph UI

Reusable interactive renderer for the public `ubo-ownership-graph-projection-v1` contract. It is intentionally outside the headless `ubo-control/` product root and has one production dependency: React supplied by the host.

## Component API

```js
const { OwnershipGraph, DETAIL_LEVEL } = require("@ubo-control/ownership-graph-ui");

<OwnershipGraph
  projection={ownershipGraphProjection}
  detailLevel={DETAIL_LEVEL.EXPLAIN}
  onSelectionChange={(selection) => console.log(selection)}
/>
```

Import `ownership-graph.css` alongside the component. `projection` must be a complete `ubo-ownership-graph-projection-v1` value. `detailLevel` is `CUSTOMER` by default or `EXPLAIN` for richer snapshot/support references. `onSelectionChange` receives data-only selections for entities, relationships, calculation paths, conflicts and reviews. `className` and `height` support host layout without introducing host state.

The component displays recorded nodes, relationships, measurements, calculations, qualifications, unresolved states, conflicts, reviews and opaque support references. It validates and renders; it never calculates ownership, applies policy, adjudicates claims, resolves requirements or calls a provider.

## Standalone demo

From the repository root:

```powershell
node ubo-control-ui/demo/server.js
```

Open `http://127.0.0.1:4175/`. The local demo uses the repository's React runtime and committed deterministic projections; it makes no API call. URL parameters support direct review, for example `?fixture=UI02&state=current&detail=EXPLAIN`.

## Fixtures and tests

`fixtures/buildFixtureProjections.js` constructs DecisionSnapshot scenarios through the public Decision Application and then calls public `projectOwnershipGraph`. The committed JSON is reproducible and covers UI01–UI12, including the two UI12 historical states.

```powershell
node ubo-control-ui/fixtures/buildFixtureProjections.js
node --test ubo-control-ui/__tests__/*.nodetest.js
```

Browser acceptance evidence and its checklist are in `manual-acceptance/`.
