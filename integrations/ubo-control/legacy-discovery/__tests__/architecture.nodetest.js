"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ADAPTER_ROOT = path.resolve(__dirname, "..");
const REPOSITORY_ROOT = path.resolve(ADAPTER_ROOT, "../../..");
const CORE_ROOT = path.join(REPOSITORY_ROOT, "ubo-control");

function productionJavaScriptFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (["__tests__", "test-support", "node_modules"].includes(entry.name)) return [];
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return productionJavaScriptFiles(target);
    return entry.isFile() && entry.name.endsWith(".js") ? [target] : [];
  });
}

function importSpecifiers(source) {
  return [...source.matchAll(/require\s*\(\s*["']([^"']+)["']\s*\)/g)].map((match) => match[1]);
}

test("standalone UBO production code never imports outward from integrations", () => {
  for (const file of productionJavaScriptFiles(CORE_ROOT)) {
    const source = fs.readFileSync(file, "utf8");
    assert.equal(/require\s*\([^)]*integrations|import\s+[^;]*integrations/i.test(source), false, path.relative(CORE_ROOT, file));
  }
});

test("legacy adapter depends inward only on the approved UBO public entry point", () => {
  const source = fs.readFileSync(path.join(ADAPTER_ROOT, "index.js"), "utf8");
  assert.deepEqual(importSpecifiers(source), ["../../../ubo-control"]);
  assert.equal(source.includes("../../../ubo-control/"), false);
});

test("adapter imports no legacy implementation, provider, endpoint module, persistence or onboarding source", () => {
  for (const file of productionJavaScriptFiles(ADAPTER_ROOT)) {
    const specifiers = importSpecifiers(fs.readFileSync(file, "utf8"));
    for (const specifier of specifiers) {
      const normalized = specifier.replace(/\\/g, "/").toLowerCase();
      for (const forbidden of ["agents/ubo", "api/ubo-discovery", "companieshouse", "webresearch", "persistence", "src/app", "src/pipeline"]) {
        assert.equal(normalized.includes(forbidden), false, file + " imports " + specifier);
      }
    }
  }
});

test("G3.1 adapter has no built-in network or credential dependency", () => {
  const source = fs.readFileSync(path.join(ADAPTER_ROOT, "index.js"), "utf8");
  assert.equal(/\bfetch\s*\(/.test(source), false);
  assert.equal(/ANTHROPIC|COMPANIES_HOUSE_API_KEY|process\.env/.test(source), false);
});
