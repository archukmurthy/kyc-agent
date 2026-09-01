"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const core = path.resolve(root, "..", "ubo-control");
const componentSource = fs.readFileSync(path.join(root, "OwnershipGraph.js"), "utf8");
const journeySource = fs.readFileSync(path.join(root, "UboJourney.js"), "utf8");
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

test("adaptive journey imports only React and the sibling public graph renderer", () => {
  assert.deepEqual([...journeySource.matchAll(/require\(["']([^"']+)["']\)/g)].map((match) => match[1]), ["react", "./OwnershipGraph"]);
  assert.doesNotMatch(journeySource, /ubo-control\/|src\/App|agents\/ubo|integrations\/ubo-control|api\/|createUboDecisionApplication|PolicyPack|DiscoveryService|ExtractionService|EvidencePlatform/i);
});

test("adaptive journey accepts only public projection and plan inputs and emits host-neutral data", () => {
  assert.match(journeySource, /function UboJourney\(\{ journey: suppliedJourney, plan: suppliedPlan, graph: suppliedGraph, onAction/);
  assert.match(journeySource, /ubo-journey-projection-v1/);
  assert.match(journeySource, /ubo-resolution-plan-v1/);
  assert.match(journeySource, /ubo-customer-action-v1/);
  assert.doesNotMatch(journeySource, /decisionSnapshot\s*[:,]|rawInformationNeeds|policyPack\s*[:,]/i);
  assert.doesNotMatch(journeySource, /fetch\s*\(|XMLHttpRequest|FormData|FileReader|base64|\.discover\s*\(|\.extract\s*\(/i);
});

test("journey renderer contains no policy threshold, provider choice, or authoritative state mutation", () => {
  assert.doesNotMatch(journeySource, /ownershipThreshold|uboThreshold|percentage\s*[><=]|Companies House|Discovery vendor|provider choice/i);
  assert.doesNotMatch(journeySource, /setJourney|setPlan|journey\.[A-Za-z0-9_]+\s*=(?!=)|plan\.[A-Za-z0-9_]+\s*=(?!=)/);
  assert.match(journeySource, /This component does not change UBO case state/);
});

test("demo fixtures are generated through the public projection and not a visual domain model", () => {
  const generator = fs.readFileSync(path.join(root, "fixtures", "buildFixtureProjections.js"), "utf8");
  assert.match(generator, /require\("\.\.\/\.\.\/ubo-control"\)/);
  assert.match(generator, /projectOwnershipGraph/);
  assert.doesNotMatch(generator, /DocumentOwnershipGraph|legacy.*ownershipGraph/i);
  assert.doesNotMatch(fs.readFileSync(path.join(root, "demo", "demo.js"), "utf8"), /src\/App|api\/ubo-discovery|fetch\([^)]*api\//);
});

test("standalone demo switches graph and customer journey fixtures without host onboarding", () => {
  const demo = fs.readFileSync(path.join(root, "demo", "demo.js"), "utf8");
  const server = fs.readFileSync(path.join(root, "demo", "server.js"), "utf8");
  assert.match(demo, /Customer journeys/);
  assert.match(demo, /Graph renderer/);
  assert.match(demo, /CUI17/);
  assert.match(server, /journey-fixtures\.json/);
  assert.doesNotMatch(`${demo}\n${server}`, /src\/App|api\/research|api\/ubo-discovery/i);
});
