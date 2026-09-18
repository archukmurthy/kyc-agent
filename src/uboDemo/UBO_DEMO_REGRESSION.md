# UBO demo release-candidate regression

`npm run test:ubo-demo:critical` is the non-negotiable fast net for demo work. It removes live Companies House and Anthropic credentials from its child processes and uses only saved replay, deterministic transports and reviewed fixtures.

## Protected behavior

| ID | Protection |
| --- | --- |
| DEMO-01 | Company defaults, required fields, stable codes and leading-zero preservation in `UboDemoRoot.test.jsx`. |
| DEMO-02 | Saved British Airways identity, graph restoration and zero live transport in `UboDemoRoot.test.jsx`. |
| DEMO-03 | Recursive TDR expansion and one canonical OC302604 identity in `tdrDemoScreen2.nodetest.js` and `recursiveCompaniesHouseExpansion.nodetest.js`. |
| DEMO-04 | British Airways economic, voting and combined appointment/removal semantics stay distinct in `demoAutoReview.nodetest.js`, `legacyDiscoveryAdapter.nodetest.js` and `OwnershipGraph.nodetest.js`. |
| DEMO-05 | Law Debenture PLC and active PSC-exempt registry context are retained in `recursiveCompaniesHouseExpansion.nodetest.js` and the demo presentation tests. |
| DEMO-06 | IAG Spain/public-company/foreign-frontier context is retained in `recursiveCompaniesHouseExpansion.nodetest.js` and the demo presentation tests. |
| DEMO-07 | Relevant/Full and All/Ownership/Voting/Control are presentation-only filters in `UboDemoRoot.test.jsx` and `CustomerOwnershipChartPage.test.jsx`. |
| DEMO-08 | Customer work has entity/scope context; internal/system work is status, not a customer question, in `UboDemoRoot.test.jsx`. |
| DEMO-09 | Alice's direct 10%, indirect 60% × 30%, recorded 28% and engine qualification trace are covered by demo, chart-analysis and graph tests. |
| DEMO-10 | Saved replay uses `START_DEMO_REVIEW_REPLAY` and never the live transport in `UboDemoRoot.test.jsx` and `demoAutoReview.nodetest.js`. |
| DEMO-11 | Same-host analyst-to-customer handoff preserves case, company and assertions without Discovery in `customerHandoff.test.js` and customer-page tests. |
| DEMO-12 | Bettercomms bytes pass through the existing Evidence/UBO adapter and the reviewed digest selects the source-backed fixture in `customerOwnershipChartDemo.nodetest.js`. |
| DEMO-13 | Uploaded assertions preserve exact, range, unknown/qualitative, currentness and provenance in assertion and chart tests. |
| DEMO-14 | Demo result and chart result refresh are restored from their case-bound browser sessions without execution in page tests. |
| DEMO-15 | Replay identity, handoff case identity and uploaded chart session are case-bound; unrelated facts cannot cross into another company in demo/session tests. |

## Regression tiers

FAST — after every tweak:

```text
npm run test:ubo-demo:critical
```

FOCUSED — before each commit:

```text
npm run test:ubo-demo:critical
<focused test command for the changed component>
```

RC — before push or deployment:

```text
npm run test:ubo-demo:critical
<complete UBO/UI/Lab/Discovery/Evidence suite>
CI=true npx react-scripts test --watchAll=false --testMatch='**/*.test.{js,jsx}'
npm run build
git diff --check
```

An RC refinement is not acceptable while `UBO_DEMO_CRITICAL` is red.
