"use strict";

const fs = require("fs");
const path = require("path");

const REQUIRED_IGNORE_RULES = Object.freeze([
  "api/evidence/**",
  "public/evidence-lab*",
]);
const REQUIRED_DENIAL_ROUTES = Object.freeze([
  Object.freeze({ src: "/api/evidence(/.*)?", status: 404 }),
  Object.freeze({ src: "/evidence-lab.*", status: 404 }),
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

function readVercelConfig(root) {
  const configPath = path.join(root, "vercel.json");
  if (!fs.existsSync(configPath)) throw new Error("vercel.json is missing from the Vercel project root");
  return JSON.parse(fs.readFileSync(configPath, "utf8"));
}

function patternMatches(pattern, requestPath) {
  return new RegExp(`^(?:${pattern})$`).test(requestPath);
}

function routingDisposition(config, requestPath) {
  const route = (config.routes || []).find((candidate) => patternMatches(candidate.src, requestPath));
  if (route) return route.status ? { kind: "denied", status: route.status } : { kind: "route", destination: route.dest };

  const rewrite = (config.rewrites || []).find((candidate) => patternMatches(candidate.source, requestPath));
  if (!rewrite) return { kind: "filesystem" };
  if (rewrite.destination === "/index.html") return { kind: "spa", destination: rewrite.destination };
  return { kind: "rewrite", destination: rewrite.destination };
}

function verifyRoutingBoundary(root) {
  const config = readVercelConfig(root);
  for (const required of REQUIRED_DENIAL_ROUTES) {
    if (!(config.routes || []).some((route) => route.src === required.src && route.status === required.status)) {
      throw new Error(`Required Evidence denial route is missing: ${required.src}`);
    }
  }

  for (const requestPath of [
    "/api/evidence/status",
    "/api/evidence/a2-config",
    "/evidence-lab.html",
    "/evidence-lab.js",
    "/evidence-lab-state.js",
  ]) {
    const disposition = routingDisposition(config, requestPath);
    if (disposition.kind !== "denied" || disposition.status !== 404) {
      throw new Error(`Evidence path is not explicitly denied: ${requestPath}`);
    }
  }

  if (routingDisposition(config, "/").kind !== "spa") throw new Error("Ordinary KYC root no longer reaches the SPA");
  if (routingDisposition(config, "/admin/settings").kind !== "spa") throw new Error("Ordinary KYC SPA routing was changed");
  const apiDisposition = routingDisposition(config, "/api/config");
  if (apiDisposition.kind !== "rewrite" || apiDisposition.destination !== "/api/$1") {
    throw new Error("Ordinary non-Evidence API routing was changed");
  }

  return {
    denialRoutes: REQUIRED_DENIAL_ROUTES,
    ordinarySpa: routingDisposition(config, "/admin/settings"),
    ordinaryApi: apiDisposition,
  };
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
  const routing = verifyRoutingBoundary(root);

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
    routing,
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
};
