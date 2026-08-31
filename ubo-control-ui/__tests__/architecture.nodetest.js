"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const core = path.resolve(root, "..", "ubo-control");
const componentSource = fs.readFileSync(path.join(root, "OwnershipGraph.js"), "utf8");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

function javascriptFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return javascriptFiles(absolute);
    return entry.name.endsWith(".js") ? [absolute] : [];
  });
}

test("renderer production depends only on React and the public projection data contract", () => {
  assert.deepEqual([...componentSource.matchAll(/require\(["']([^"']+)["']\)/g)].map((match) => match[1]), ["react"]);
  assert.doesNotMatch(componentSource, /ubo-control\/|src\/App|agents\/ubo|integrations\/ubo-control|EvidencePlatform|documentOwnershipGraph/i);
  assert.deepEqual(packageJson.peerDependencies, { react: ">=18", "react-dom": ">=18" });
  assert.equal(packageJson.dependencies, undefined);
});

test("headless UBO core never imports the UI package", () => {
  javascriptFiles(core).forEach((file) => assert.doesNotMatch(fs.readFileSync(file, "utf8"), /ubo-control-ui|ownership-graph-ui/i, file));
});

test("renderer accepts projection only and contains no compliance or percentage-calculation inputs", () => {
  assert.match(componentSource, /function OwnershipGraph\(\{ projection: supplied, detailLevel/);
  assert.doesNotMatch(componentSource, /rawDecisionSnapshot|policyPack|uboThreshold|ownershipThreshold|createUboDecisionApplication|projectOwnershipGraph/);
  assert.doesNotMatch(componentSource, /measurement\.(value|lowerBound|upperBound)\s*[*/+-]/);
  assert.doesNotMatch(componentSource, /reduce\([^\n]+(measurement|contribution|aggregateKnownValue)/);
});

test("demo fixtures are generated through the public projection and not a visual domain model", () => {
  const generator = fs.readFileSync(path.join(root, "fixtures", "buildFixtureProjections.js"), "utf8");
  assert.match(generator, /require\("\.\.\/\.\.\/ubo-control"\)/);
  assert.match(generator, /projectOwnershipGraph/);
  assert.doesNotMatch(generator, /DocumentOwnershipGraph|legacy.*ownershipGraph/i);
  assert.doesNotMatch(fs.readFileSync(path.join(root, "demo", "demo.js"), "utf8"), /src\/App|api\/ubo-discovery|fetch\([^)]*api\//);
});
