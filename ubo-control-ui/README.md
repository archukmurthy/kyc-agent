# UBO Control UI

Reusable React presentation components for the public UBO Control consumer contracts. The package is intentionally outside the headless `ubo-control/` product root and has one host-supplied production dependency: React.

## Adaptive customer journey

```js
const { UboJourney } = require("@ubo-control/ui");

<UboJourney
  journey={journeyProjection}
  plan={resolutionPlan}
  graph={ownershipGraphProjection}
  onAction={(event) => processCustomerAction(event)}
/>
```

Import `ubo-journey.css` and `ownership-graph.css`. The component requires matching `ubo-journey-projection-v1` and `ubo-resolution-plan-v1` values. `graph` is optional and, when supplied, must be `ubo-ownership-graph-projection-v1`.

`UboJourney` renders only the current plan. It separates already-established information from missing information, preserves coalesced bundles, combines known structured-information and evidence intents in one task, and stops customer forms for system, blocked, internal-review, specialist-review and complete states. COMPANY and LLP labels follow the public entity-profile semantics. Missing approved wording produces `Customer wording not configured`; the UI never generates a question.

Graph selection and bundle selection are linked through canonical entity/relationship IDs. The graph remains optional and is never required to complete the form. At narrow widths the graph and task stack rather than compressing side by side.

### Customer action event

`onAction` receives a serializable `ubo-customer-action-v1` value:

```js
{
  contractVersion: "ubo-customer-action-v1",
  eventType: "CUSTOMER_ACTION_SUBMITTED", // or EVIDENCE_ACTION_REQUESTED
  bundleId: "customer-resolution-bundle:...",
  workItemIds: ["customer-work-item:..."],
  actionIntentIds: ["action-intent:..."],
  actionIds: ["resolution-action:..."],
  semanticActionTypes: ["PROVIDE_MISSING_INFORMATION"],
  subject: {
    entityId: "entity-id",
    family: "OWNERSHIP_AND_CONTROL",
    entityProfile: "COMPANY"
  },
  values: { country_of_residence: "United Kingdom" },
  confirmationResult: null,
  selectedCustomerResolutionOptionId: null,
  evidenceAction: null
}
```

Evidence events contain semantic evidence types only. They never contain a file, raw bytes or base64. The consuming host owns upload, processing and authoritative re-resolution.

Submission does not mutate the supplied journey or plan and does not mark a task complete locally. The required lifecycle is:

```text
customer action → host processing → UBO re-evaluation
→ new DecisionSnapshot → new projections/plan → rerender
```

## Ownership graph

```js
const { OwnershipGraph, DETAIL_LEVEL } = require("@ubo-control/ui");

<OwnershipGraph
  projection={ownershipGraphProjection}
  detailLevel={DETAIL_LEVEL.EXPLAIN}
  onSelectionChange={(selection) => console.log(selection)}
/>
```

`projection` is a complete `ubo-ownership-graph-projection-v1` value. `detailLevel` is `CUSTOMER` by default or `EXPLAIN` for richer snapshot/support references. `highlightEntityIds` and `highlightRelationshipIds` allow a host component to emphasize canonical graph links without changing graph state.

The renderer displays recorded nodes, relationships, measurements, calculations, qualifications, unresolved states, conflicts, reviews and opaque support references. It validates and renders; it never calculates ownership, applies policy, adjudicates claims, resolves requirements or calls a provider.

## Standalone demo

From the repository root:

```powershell
node ubo-control-ui/demo/server.js
```

Open `http://127.0.0.1:4175/`. Switch between Customer journeys (CUI01–CUI17) and Graph renderer (UI01–UI12). Direct journey review URLs use `?mode=journey&fixture=CUI03&state=current`; CUI17 demonstrates the before/after host re-resolution cycle. The local demo uses committed deterministic public-contract fixtures and makes no API call.

## Fixtures and tests

```powershell
node ubo-control-ui/fixtures/buildFixtureProjections.js
node ubo-control-ui/fixtures/buildJourneyFixtures.js
node --test ubo-control-ui/__tests__/*.nodetest.js
```

The journey suite protects public-contract boundaries, minimal-field behavior, confirmation, coalescence, evidence intents, state handling, COMPANY/LLP semantics, validation, immutable submission, graph linkage, accessibility semantics and all CUI01–CUI17 renders. Browser acceptance evidence and its checklist are in `manual-acceptance/`.
