"use strict";

const assert = require("node:assert/strict");
const { builtinModules } = require("node:module");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const PRODUCT_ROOT = path.resolve(__dirname, "..");
const BUILT_INS = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)]);
const PROHIBITED_IMPORT_FRAGMENTS = [
  "agents/ubo",
  "src/app",
  "src/pipeline",
  "documentrequirements",
  "evidence/platform",
  "evidence/a1",
  "evidence/a2",
  "evidence/a3",
  "@anthropic-ai",
  "@vercel",
  "@neondatabase",
];

function productionJavaScriptFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "__tests__" || entry.name === "node_modules") return [];
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return productionJavaScriptFiles(target);
    return entry.isFile() && entry.name.endsWith(".js") ? [target] : [];
  });
}

function importSpecifiers(source) {
  const specifiers = [];
  const patterns = [
    /require\s*\(\s*["']([^"']+)["']\s*\)/g,
    /import\s+(?:[^"']+?\s+from\s+)?["']([^"']+)["']/g,
    /import\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  patterns.forEach((pattern) => {
    let match;
    while ((match = pattern.exec(source)) !== null) specifiers.push(match[1]);
  });
  return specifiers;
}

test("production imports remain inside the standalone product root", () => {
  for (const file of productionJavaScriptFiles(PRODUCT_ROOT)) {
    const source = fs.readFileSync(file, "utf8");
    for (const specifier of importSpecifiers(source)) {
      const normalized = specifier.replace(/\\/g, "/").toLowerCase();
      for (const prohibited of PROHIBITED_IMPORT_FRAGMENTS) {
        assert.equal(
          normalized.includes(prohibited),
          false,
          `${path.relative(PRODUCT_ROOT, file)} imports prohibited dependency ${specifier}`,
        );
      }

      if (specifier.startsWith(".")) {
        const resolved = path.resolve(path.dirname(file), specifier);
        assert.ok(
          resolved === PRODUCT_ROOT || resolved.startsWith(`${PRODUCT_ROOT}${path.sep}`),
          `${path.relative(PRODUCT_ROOT, file)} escapes the product root via ${specifier}`,
        );
      } else {
        assert.ok(
          BUILT_INS.has(specifier),
          `${path.relative(PRODUCT_ROOT, file)} uses non-built-in package ${specifier}`,
        );
      }
    }
  }
});

test("the public entry point exposes only the approved deliberate surface", () => {
  const publicApi = require("..");
  assert.deepEqual(Object.keys(publicApi).sort(), [
    "APPLICABILITY_MODEL_VERSION",
    "APPLICABILITY_RESULT",
    "CANONICALIZATION_ALGORITHM",
    "CAPABILITY_CONTRACT_VERSION",
    "CAPABILITY_OUTCOME_STATE",
    "CANDIDATE_FACT_TYPE",
    "CLAIM_STATE",
    "CLAIM_STATE_MODEL_VERSION",
    "CONDITION_LANGUAGE_VERSION",
    "DECISION_APPLICATION_CONTRACT_VERSION",
    "DECISION_APPLICATION_ERROR_CODE",
    "OWNERSHIP_GRAPH_PROJECTION_CONTRACT_VERSION",
    "OWNERSHIP_GRAPH_PROJECTION_ERROR_CODE",
    "DecisionApplicationError",
    "OwnershipGraphProjectionError",
    "IDENTITY_RESOLUTION_STATUS",
    "PERCENTAGE_VALUE_TYPE",
    "POLICY_PACK_SCHEMA_ID",
    "POLICY_PACK_SCHEMA_VERSION",
    "PolicyPackIntegrityError",
    "PolicyPackValidationError",
    "RELATIONSHIP_TYPE",
    "REQUIREMENT_STATE",
    "REQUIREMENT_STATE_MODEL_VERSION",
    "RESOLUTION_EFFECT",
    "RESOLUTION_SEMANTICS_VERSION",
    "RESOLUTION_STRATEGY",
    "RISK_LEVEL",
    "RISK_LEVEL_MODEL_VERSION",
    "UBO_CONFIGURATION_ERROR_CODE",
    "UboConfigurationError",
    "UboContractError",
    "canonicalizeJson",
    "createUboDecisionApplication",
    "createUboControl",
    "hashPolicyPack",
    "loadPolicyPack",
    "projectOwnershipGraph",
    "validateCandidateFact",
    "validateCandidatePartyReference",
    "validateCapabilityOutcome",
    "validateCapabilityResult",
    "validateConditionExpression",
    "validateDiscoveryRequest",
    "validateEvidenceReference",
    "validateExtractionRequest",
    "validateIdentityResolutionDecision",
    "validatePercentageValue",
    "validatePolicyPack",
  ].sort());
});
