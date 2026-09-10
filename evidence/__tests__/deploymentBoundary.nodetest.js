"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");

const {
  REQUIRED_DENIAL_ROUTES,
  REQUIRED_IGNORE_RULES,
  deployableFunctionInventory,
  inventoryLabSurfaces,
  isExcluded,
  readIgnoreRules,
  readVercelConfig,
  routingDisposition,
  sanitizeBuildOutput,
  verifyBoundary,
  verifyRoutingBoundary,
} = require("../../scripts/evidence-deployment-boundary");

const root = path.resolve(__dirname, "..", "..");

test("Vercel upload inventory excludes every discovered Evidence Lab surface", () => {
  const rules = readIgnoreRules(root);
  assert.deepEqual(REQUIRED_IGNORE_RULES.filter((rule) => !rules.includes(rule)), []);
  const inventory = inventoryLabSurfaces(root);
  assert.equal(inventory.apiFunctions.length, 40);
  assert.deepEqual(inventory.publicAssets, [
    "public/evidence-lab-state.js",
    "public/evidence-lab.html",
    "public/evidence-lab.js",
  ]);
  for (const file of [...inventory.apiFunctions, ...inventory.publicAssets]) assert.equal(isExcluded(file, rules), true, file);
});

test("frozen façade and ordinary application APIs are not excluded", () => {
  const rules = readIgnoreRules(root);
  assert.equal(isExcluded("evidence/consumer/v1/index.js", rules), false);
  assert.equal(isExcluded("api/research.js", rules), false);
  assert.equal(isExcluded("api/doc-search.js", rules), false);
  const deployable = deployableFunctionInventory(root, rules);
  assert.equal(deployable.some((file) => file.startsWith("api/evidence/")), false);
  assert.equal(deployable.includes("api/research.js"), true);
});

test("Evidence paths are denied before the SPA fallback while ordinary routing remains intact", () => {
  const config = readVercelConfig(root);
  assert.deepEqual(config.routes, REQUIRED_DENIAL_ROUTES);
  for (const requestPath of [
    "/api/evidence/status",
    "/api/evidence/a5b-verify",
    "/evidence-lab.html",
    "/evidence-lab.js",
    "/evidence-lab-state.js",
  ]) {
    assert.deepEqual(routingDisposition(config, requestPath), { kind: "denied", status: 404 });
  }
  assert.deepEqual(routingDisposition(config, "/admin/settings"), { kind: "spa", destination: "/index.html" });
  assert.deepEqual(routingDisposition(config, "/api/config"), { kind: "rewrite", destination: "/api/$1" });
  assert.doesNotThrow(() => verifyRoutingBoundary(root));
});

test("production-boundary verifier accepts the repository source inventory", () => {
  const result = verifyBoundary(root, { requireBuild: false });
  assert.equal(result.sourceInventoryMode, "repository");
  assert.equal(result.inventory.apiFunctions.length, 40);
  assert.deepEqual(result.buildLabAssets, []);
});

test("production-boundary verifier requires a filtered Vercel upload to contain no Lab source", () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evidence-vercel-upload-"));
  try {
    fs.mkdirSync(path.join(temporaryRoot, "api"), { recursive: true });
    fs.mkdirSync(path.join(temporaryRoot, "evidence", "consumer", "v1"), { recursive: true });
    fs.mkdirSync(path.join(temporaryRoot, "public"), { recursive: true });
    fs.writeFileSync(path.join(temporaryRoot, ".vercelignore"), `${REQUIRED_IGNORE_RULES.join("\n")}\n`);
    fs.writeFileSync(path.join(temporaryRoot, "vercel.json"), JSON.stringify({
      routes: REQUIRED_DENIAL_ROUTES,
      rewrites: [
        { source: "/api/(.*)", destination: "/api/$1" },
        { source: "/admin/(.*)", destination: "/index.html" },
        { source: "/(.*)", destination: "/index.html" },
      ],
    }));
    fs.writeFileSync(path.join(temporaryRoot, "api", "research.js"), "module.exports = {};");
    fs.writeFileSync(path.join(temporaryRoot, "api", "doc-search.js"), "module.exports = {};");
    fs.writeFileSync(path.join(temporaryRoot, "evidence", "consumer", "v1", "index.js"), "module.exports = {};");

    const result = verifyBoundary(temporaryRoot, {
      requireBuild: false,
      requireSourceInventory: false,
    });
    assert.equal(result.sourceInventoryMode, "filtered-vercel-upload");
    assert.deepEqual(result.inventory, { apiFunctions: [], publicAssets: [] });

    fs.mkdirSync(path.join(temporaryRoot, "api", "evidence"), { recursive: true });
    fs.writeFileSync(path.join(temporaryRoot, "api", "evidence", "status.js"), "module.exports = {};");
    assert.throws(
      () => verifyBoundary(temporaryRoot, { requireBuild: false, requireSourceInventory: false }),
      /survived Vercel upload filtering/,
    );
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("build sanitizer removes only Evidence Lab assets", () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evidence-deployment-boundary-"));
  try {
    const build = path.join(temporaryRoot, "build");
    fs.mkdirSync(path.join(build, "static", "js"), { recursive: true });
    fs.writeFileSync(path.join(build, "index.html"), "normal application");
    fs.writeFileSync(path.join(build, "evidence-lab.html"), "lab");
    fs.writeFileSync(path.join(build, "evidence-lab.js"), "lab");
    fs.writeFileSync(path.join(build, "evidence-lab-state.js"), "lab");
    fs.writeFileSync(path.join(build, "static", "js", "main.js"), "normal application");
    assert.equal(sanitizeBuildOutput(temporaryRoot).length, 3);
    assert.equal(fs.existsSync(path.join(build, "evidence-lab.html")), false);
    assert.equal(fs.existsSync(path.join(build, "index.html")), true);
    assert.equal(fs.existsSync(path.join(build, "static", "js", "main.js")), true);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
