const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const buildDirectory = path.join(root, "build");

if (!fs.existsSync(buildDirectory)) {
  throw new Error("Build directory does not exist. Run react-scripts build first.");
}

fs.cpSync(path.join(root, "agents", "validation"), path.join(buildDirectory, "agents", "validation"), {
  recursive: true,
});
fs.cpSync(path.join(root, "validation-lab"), path.join(buildDirectory, "validation-lab"), {
  recursive: true,
});

const uboLabBuild = path.join(buildDirectory, "ubo-control-lab");
const uboLabVendor = path.join(uboLabBuild, "vendor");
fs.cpSync(path.join(root, "ubo-control-lab", "browser"), uboLabBuild, { recursive: true });
fs.mkdirSync(uboLabVendor, { recursive: true });
[
  ["node_modules/react/umd/react.production.min.js", "react.production.min.js"],
  ["node_modules/react-dom/umd/react-dom.production.min.js", "react-dom.production.min.js"],
  ["ubo-control-ui/OwnershipGraph.js", "OwnershipGraph.js"],
  ["ubo-control-ui/UboJourney.js", "UboJourney.js"],
  ["ubo-control-ui/ownership-graph.css", "ownership-graph.css"],
  ["ubo-control-ui/ubo-journey.css", "ubo-journey.css"],
].forEach(([source, destination]) => fs.copyFileSync(path.join(root, source), path.join(uboLabVendor, destination)));

console.log("Staged Validation Agent LOA and UBO Control Lab assets in build/.");
