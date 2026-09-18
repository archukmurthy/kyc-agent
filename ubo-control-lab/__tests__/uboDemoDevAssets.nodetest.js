"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { GRAPH_ASSETS, stageUboDemoGraphAssets } = require("../../scripts/stage-ubo-demo-dev");

test("local demo start stages every graph iframe dependency from the approved sources", () => {
  const root = path.resolve(__dirname, "..", "..");
  const temporaryPublic = fs.mkdtempSync(path.join(os.tmpdir(), "ubo-demo-assets-"));
  try {
    const staged = stageUboDemoGraphAssets(root, temporaryPublic);
    assert.equal(staged.length, GRAPH_ASSETS.length);
    const graphDocument = fs.readFileSync(path.join(root, "public", "ubo-demo-graph.html"), "utf8");
    GRAPH_ASSETS.forEach(([source, filename]) => {
      assert.match(graphDocument, new RegExp(`/ubo-control-lab/vendor/${filename.replaceAll(".", "\\.")}`));
      assert.deepEqual(
        fs.readFileSync(path.join(temporaryPublic, "ubo-control-lab", "vendor", filename)),
        fs.readFileSync(path.join(root, source)),
      );
    });
    const scripts = require(path.join(root, "package.json")).scripts;
    assert.equal(scripts.prestart, "node scripts/stage-ubo-demo-dev.js");
  } finally {
    fs.rmSync(temporaryPublic, { recursive: true, force: true });
  }
});

test("customer ownership chart opens with the complete extracted graph in view", () => {
  const root = path.resolve(__dirname, "..", "..");
  const graphDocument = fs.readFileSync(path.join(root, "public", "ubo-demo-graph.html"), "utf8");
  const analystComposition = fs.readFileSync(path.join(root, "src", "uboDemo", "UboDemoRoot.jsx"), "utf8");
  const customerComposition = fs.readFileSync(path.join(root, "src", "uboDemo", "customer", "CustomerOwnershipGraph.jsx"), "utf8");

  assert.match(graphDocument, /initialView:\s*"OVERVIEW"/);
  assert.doesNotMatch(graphDocument, /initialView:\s*"FIT_WIDTH"/);
  assert.match(analystComposition, /src="\/ubo-demo-graph\.html\?v=overview-1"/);
  assert.match(customerComposition, /src="\/ubo-demo-graph\.html\?v=overview-1"/);
});
