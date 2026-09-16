"use strict";

const { spawnSync } = require("node:child_process");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

function run(label, args) {
  console.log(`\n[ubo-demo regression] ${label}`);
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    env: { ...process.env, CI: "true" },
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

run("customer demo UI and replay contract", [
  require.resolve("react-scripts/scripts/test"),
  "--watchAll=false",
  "--testMatch=**/*.test.{js,jsx}",
  "--testPathPattern=src[\\\\/]uboDemo[\\\\/]UboDemoRoot.test.jsx",
  `--moduleNameMapper=${JSON.stringify({
    "^react$": "<rootDir>/node_modules/react",
    "^react-dom$": "<rootDir>/node_modules/react-dom",
    "^react-dom/(.*)$": "<rootDir>/node_modules/react-dom/$1",
    "^react/(.*)$": "<rootDir>/node_modules/react/$1",
  })}`,
]);

run("live/replay translation, review, projection and renderer", [
  "--test",
  "ubo-control-lab/__tests__/uboDemoDevAssets.nodetest.js",
  "ubo-control-lab/__tests__/demoAutoReview.nodetest.js",
  "ubo-control-lab/__tests__/tdrDemoScreen2.nodetest.js",
  "agents/ubo/__tests__/recursiveCompaniesHouseExpansion.nodetest.js",
  "integrations/ubo-control/legacy-discovery/__tests__/legacyDiscoveryAdapter.nodetest.js",
  "integrations/ubo-control/legacy-discovery/__tests__/liveComposition.e2e.nodetest.js",
  "ubo-control-ui/__tests__/OwnershipGraph.nodetest.js",
]);

console.log("\n[ubo-demo regression] PASS");
