"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");

const {
  REQUIRED_IGNORE_RULES,
  deployableFunctionInventory,
  inventoryLabSurfaces,
  isExcluded,
  readIgnoreRules,
  sanitizeBuildOutput,
  verifyBoundary,
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

test("production-boundary verifier accepts the repository source inventory", () => {
  const result = verifyBoundary(root, { requireBuild: false });
  assert.equal(result.inventory.apiFunctions.length, 40);
  assert.deepEqual(result.buildLabAssets, []);
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
