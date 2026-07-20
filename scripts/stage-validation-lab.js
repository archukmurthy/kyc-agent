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

console.log("Staged Validation Agent LOA lab assets in build/.");
