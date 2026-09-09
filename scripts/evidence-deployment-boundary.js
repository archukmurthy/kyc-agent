"use strict";

const fs = require("fs");
const path = require("path");

const REQUIRED_IGNORE_RULES = Object.freeze([
  "api/evidence/**",
  "public/evidence-lab*",
]);

function relative(root, file) {
  return path.relative(root, file).split(path.sep).join("/");
}

function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  });
}

function readIgnoreRules(root) {
  const ignorePath = path.join(root, ".vercelignore");
  if (!fs.existsSync(ignorePath)) throw new Error(".vercelignore is missing from the Vercel project root");
  return fs.readFileSync(ignorePath, "utf8").split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
}

function isExcluded(deploymentPath, rules) {
  const normalized = deploymentPath.replace(/\\/g, "/");
  return (rules.includes("api/evidence/**") && normalized.startsWith("api/evidence/"))
    || (rules.includes("public/evidence-lab*") && normalized.startsWith("public/evidence-lab"));
}

function htmlLocalReferences(root) {
  const htmlPath = path.join(root, "public", "evidence-lab.html");
  if (!fs.existsSync(htmlPath)) return [];
  const html = fs.readFileSync(htmlPath, "utf8");
  return [...html.matchAll(/(?:src|href)=["'](\/[^"']+)["']/g)]
    .map((match) => match[1].split(/[?#]/)[0])
    .filter((item) => !item.startsWith("/api/"))
    .map((item) => `public/${item.replace(/^\/+/, "")}`)
    .filter((item) => fs.existsSync(path.join(root, item)))
    .sort();
}

function inventoryLabSurfaces(root) {
  const apiFunctions = walk(path.join(root, "api", "evidence")).map((file) => relative(root, file)).sort();
  const namedAssets = walk(path.join(root, "public"))
    .map((file) => relative(root, file))
    .filter((file) => path.basename(file).startsWith("evidence-lab"));
  const publicAssets = [...new Set([...namedAssets, ...htmlLocalReferences(root)])].sort();
  return { apiFunctions, publicAssets };
}

function deployableFunctionInventory(root, rules) {
  return walk(path.join(root, "api"))
    .map((file) => relative(root, file))
    .filter((file) => /\.(?:js|mjs|cjs|ts)$/.test(file) && !isExcluded(file, rules))
    .sort();
}

function sanitizeBuildOutput(root) {
  const buildRoot = path.join(root, "build");
  const removed = walk(buildRoot).filter((file) => path.basename(file).startsWith("evidence-lab"));
  for (const file of removed) fs.rmSync(file, { force: true });
  return removed.map((file) => relative(root, file)).sort();
}

function verifyBoundary(root, {
  requireBuild = true,
  requireSourceInventory = process.env.VERCEL !== "1",
} = {}) {
  const rules = readIgnoreRules(root);
  for (const rule of REQUIRED_IGNORE_RULES) {
    if (!rules.includes(rule)) throw new Error(`Required Vercel exclusion is missing: ${rule}`);
  }

  const inventory = inventoryLabSurfaces(root);
  if (requireSourceInventory) {
    if (!inventory.apiFunctions.length) throw new Error("No Evidence Lab API functions were discovered");
    if (!inventory.publicAssets.length) throw new Error("No Evidence Lab public assets were discovered");
    for (const file of [...inventory.apiFunctions, ...inventory.publicAssets]) {
      if (!isExcluded(file, rules)) throw new Error(`Evidence Lab surface is deployable: ${file}`);
    }
  } else if (inventory.apiFunctions.length || inventory.publicAssets.length) {
    throw new Error("Evidence Lab source survived Vercel upload filtering");
  }

  const frozenFacade = "evidence/consumer/v1/index.js";
  if (isExcluded(frozenFacade, rules)) throw new Error("Frozen Evidence consumer façade must remain deployable source");

  const ordinaryApis = ["api/research.js", "api/doc-search.js"];
  for (const file of ordinaryApis) {
    if (!fs.existsSync(path.join(root, file))) throw new Error(`Expected ordinary API route is missing: ${file}`);
    if (isExcluded(file, rules)) throw new Error(`Ordinary API route was excluded: ${file}`);
  }

  const functions = deployableFunctionInventory(root, rules);
  if (functions.some((file) => file.startsWith("api/evidence/"))) throw new Error("Evidence Lab function remains deployable");

  const buildRoot = path.join(root, "build");
  if (requireBuild && !fs.existsSync(buildRoot)) throw new Error("Production build output is missing");
  const buildLabAssets = walk(buildRoot).map((file) => relative(buildRoot, file)).filter((file) => path.basename(file).startsWith("evidence-lab"));
  if (buildLabAssets.length) throw new Error(`Evidence Lab assets remain in production build: ${buildLabAssets.join(", ")}`);

  return {
    ignoreRules: rules,
    sourceInventoryMode: requireSourceInventory ? "repository" : "filtered-vercel-upload",
    inventory,
    deployableFunctionCount: functions.length,
    buildLabAssets,
  };
}

if (require.main === module) {
  const root = path.resolve(__dirname, "..");
  if (process.argv.includes("--sanitize-build")) sanitizeBuildOutput(root);
  const result = verifyBoundary(root, { requireBuild: process.argv.includes("--verify") });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

module.exports = {
  REQUIRED_IGNORE_RULES,
  deployableFunctionInventory,
  inventoryLabSurfaces,
  isExcluded,
  readIgnoreRules,
  sanitizeBuildOutput,
  verifyBoundary,
};
