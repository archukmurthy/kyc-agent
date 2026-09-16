"use strict";

const { spawnSync } = require("node:child_process");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const childEnvironment = { ...process.env, CI: "true", UBO_DEMO_CRITICAL: "true" };

// The critical suite must never be capable of spending provider credit. Every
// covered provider boundary is injected with a deterministic fixture/transport.
delete childEnvironment.COMPANIES_HOUSE_API_KEY;
delete childEnvironment.ANTHROPIC_API_KEY;

function run(label, args) {
  console.log(`\n[UBO_DEMO_CRITICAL] ${label}`);
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    env: childEnvironment,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

run("DEMO-01, 02, 07-11, 14-15 — browser journey, replay, graph, calculation and handoff", [
  require.resolve("react-scripts/scripts/test"),
  "--watchAll=false",
  "--runTestsByPath",
  "src/uboDemo/UboDemoRoot.test.jsx",
  "src/uboDemo/customerHandoff.test.js",
  "src/uboDemo/assertionPresentation.test.js",
  "src/uboDemo/customer/chartComparison.test.js",
  "src/uboDemo/customer/CustomerCompanyPage.test.jsx",
  "src/uboDemo/customer/CustomerOwnershipChartPage.test.jsx",
  `--moduleNameMapper=${JSON.stringify({
    "^react$": "<rootDir>/node_modules/react",
    "^react-dom$": "<rootDir>/node_modules/react-dom",
    "^react-dom/(.*)$": "<rootDir>/node_modules/react-dom/$1",
    "^react/(.*)$": "<rootDir>/node_modules/react/$1",
  })}`,
]);

run("DEMO-03-10, 12-13 — deterministic discovery, projection and Evidence chart intake", [
  "--test",
  "ubo-control-lab/__tests__/uboDemoDevAssets.nodetest.js",
  "ubo-control-lab/__tests__/demoAutoReview.nodetest.js",
  "ubo-control-lab/__tests__/tdrDemoScreen2.nodetest.js",
  "ubo-control-lab/server/__tests__/customerOwnershipChartDemo.nodetest.js",
  "agents/ubo/__tests__/recursiveCompaniesHouseExpansion.nodetest.js",
  "integrations/ubo-control/legacy-discovery/__tests__/legacyDiscoveryAdapter.nodetest.js",
  "integrations/ubo-control/legacy-discovery/__tests__/liveComposition.e2e.nodetest.js",
  "ubo-control-ui/__tests__/OwnershipGraph.nodetest.js",
  "evidence/a3/__tests__/extractor.nodetest.js",
]);

console.log("\n[UBO_DEMO_CRITICAL] PASS — DEMO-01 through DEMO-15; provider credentials withheld");
