# UBO Discovery & Determination Framework

## Ownership and boundary

This is a standalone Node.js agent package. It does not import the React UI,
the onboarding workflow, or existing KYC agents. Its public entry point is
`runUboFramework` in `uboOrchestrator.js`; it can be moved into a separate
service or called by an API layer without changing its core logic.

## Try it interactively

Run this from the repository root:

```powershell
node agents/ubo/playground.js
```

The playground asks for a customer company and then ownership links. It uses
only the data typed into the terminal, so it is safe to use locally and does
not make external requests. It prints UBOs, effective ownership, explanation
chains, unresolved items, and budget use as JSON.

## Live UBO Lab

Start the application with `npm start`, then open
`http://localhost:3000/ubo-lab.html`. This separate page calls
`POST /api/ubo-discovery`, which uses the configured registry integration
(Companies House) to retrieve direct disclosed stakeholders and recursively
looks up corporate owners. The optional web-research checkbox supplements the
registry data with source-cited web research. These are real external lookups
and may be chargeable; only use them for companies you are authorised to
investigate.

## Agent modules

| Module | Responsibility |
| --- | --- |
| `ownershipDiscoveryAgent.js` | Calls injected registry/search/document adapters and collects evidence only. |
| `ownershipGraphBuilderAgent.js` | Converts statements into canonical nodes and edges. |
| `evidenceResolutionAgent.js` | Ranks conflicting values using reliability, recency, relevance, and extraction quality. |
| `recursiveOwnershipExpansionAgent.js` | Recurses without a fixed depth limit; observes terminal conditions and materiality. |
| `materialityEvaluationAgent.js` | Stops paths that cannot reach the configured discovery threshold. |
| `ownershipCalculationAgent.js` | Deterministically multiplies ownership paths. No LLM calculations. |
| `controlAnalysisAgent.js` | Reports non-ownership control relationships independently. |
| `uboDeterminationAgent.js` | Applies tenant thresholds and combines ownership/control outcomes. |
| `explainabilityAgent.js` | Produces chains and source-evidence references for audit. |

## Integration contract

```js
const { runUboFramework } = require("./agents/ubo/uboOrchestrator");

const result = await runUboFramework({
  entityName: "ABC Ltd",
  registrationNumber: "12345678",
  jurisdiction: "GB",
  tenantConfig: { uboRules: { uboThreshold: 25, discoveryThreshold: 5 } },
  adapters: {
    registry: async ({ entity }) => ({
      statements: [{
        owner: { name: "Jane Doe", type: "individual", jurisdiction: "GB" },
        ownedEntity: entity,
        ownershipPercentage: 60,
        evidenceIds: ["uk-filing-17"],
        confidence: 95,
      }],
      evidence: [{ id: "uk-filing-17", source: "Companies House", sourceReliability: 95 }],
    }),
  },
});
```

An adapter must be an async function returning `statements`, `evidence`,
`missingInformation`, and optionally `documentsDownloaded`. Adapters never
determine a UBO. All vendor credentials, fetch policy, and retry logic belong
in the adapter, not this framework.

## Current implementation decisions

- A path stops at a natural person, public company, government, trust, or
  foundation; trust/foundation cases are marked for a dedicated workflow.
- Branches with maximum possible effective ownership below `discoveryThreshold`
  are noted as `not_material`, not treated as unresolved.
- Search limits are hard ceilings. Hitting one returns `partial`.
- Missing evidence and ownership cycles return `partial`; a caller may map a
  no-evidence case to `unresolved` if its policy requires that stricter label.

## Next handoff work

1. Implement production registry, web-search, document retrieval, and
   extraction adapters per jurisdiction.
2. Add a trust/foundation specialist workflow and feed its control parties back
   as graph edges.
3. Persist graph/evidence snapshots plus adapter request metadata for audit.
4. Add an API endpoint or worker once a service owner chooses its authentication
   and tenant-resolution model.
