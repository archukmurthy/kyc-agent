"use strict";

const fs = require("node:fs");
const path = require("node:path");

const GRAPH_ASSETS = Object.freeze([
  ["node_modules/react/umd/react.production.min.js", "react.production.min.js"],
  ["node_modules/react-dom/umd/react-dom.production.min.js", "react-dom.production.min.js"],
  ["ubo-control-ui/OwnershipGraph.js", "OwnershipGraph.js"],
  ["ubo-control-ui/ownership-graph.css", "ownership-graph.css"],
]);

function stageUboDemoGraphAssets(root = path.resolve(__dirname, ".."), publicRoot = path.join(root, "public")) {
  const destination = path.join(publicRoot, "ubo-control-lab", "vendor");
  fs.mkdirSync(destination, { recursive: true });
  GRAPH_ASSETS.forEach(([source, filename]) => {
    const sourcePath = path.join(root, source);
    if (!fs.existsSync(sourcePath)) throw new Error(`Required UBO demo graph asset is missing: ${source}`);
    fs.copyFileSync(sourcePath, path.join(destination, filename));
  });
  return GRAPH_ASSETS.map(([, filename]) => path.join(destination, filename));
}

if (require.main === module) {
  stageUboDemoGraphAssets();
  console.log("Staged UBO demo graph assets for the local development server.");
}

module.exports = Object.freeze({ GRAPH_ASSETS, stageUboDemoGraphAssets });
