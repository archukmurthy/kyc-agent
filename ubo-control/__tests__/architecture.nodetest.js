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
    "DECISION_APPLICATION_CONTRACT_VERSION_V2",
    "DECISION_APPLICATION_ERROR_CODE",
    "OWNERSHIP_GRAPH_PROJECTION_CONTRACT_VERSION",
    "OWNERSHIP_GRAPH_PROJECTION_ERROR_CODE",
    "UBO_JOURNEY_PROJECTION_CONTRACT_VERSION",
    "UBO_JOURNEY_PROJECTION_ERROR_CODE",
    "UBO_RESOLUTION_PLAN_CONTRACT_VERSION",
    "UBO_RESOLUTION_PLANNER_ERROR_CODE",
    "UBO_RESOLUTION_PLANNER_VERSION",
    "UBO_POLICY_READINESS",
    "UBO_POLICY_READINESS_CONTRACT_VERSION",
    "UBO_POLICY_READINESS_ERROR_CODE",
    "UBO_POLICY_RUNTIME_MODE",
    "DecisionApplicationError",
    "OwnershipGraphProjectionError",
    "UboJourneyProjectionError",
    "UboResolutionPlannerError",
    "UboPolicyReadinessError",
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
    "assessUboPolicyPackReadiness",
    "createUboDecisionApplication",
    "createUboControl",
    "hashPolicyPack",
    "loadPolicyPack",
    "projectOwnershipGraph",
    "projectUboJourney",
    "planUboResolution",
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

test("policy readiness remains stateless, provider-neutral and separate from Decision Application v1/v2", () => {
  const source = fs.readFileSync(path.join(PRODUCT_ROOT, "policy", "policyReadiness.js"), "utf8");
  assert.doesNotMatch(source, /Date\.now|new Date\s*\(|fetch\s*\(|React|DOM|provider|vendor/i);
  assert.doesNotMatch(source, /createUboDecisionApplication|\.evaluate\s*\(|\.intake\s*\(|\.applyDecisions\s*\(/);
  assert.doesNotMatch(source, /A-\d+/);
  assert.match(source, /HISTORICAL_MODE_PROHIBITS_NEW_DETERMINATION/);
});

test("the resolution planner is advisory, host neutral, and contains no opaque score or capability execution", () => {
  const source = fs.readFileSync(path.join(PRODUCT_ROOT, "planning", "uboResolutionPlanner.js"), "utf8");
  assert.doesNotMatch(source, /React|DOM|screenId|pageId|routeId|formId|buttonId/);
  assert.doesNotMatch(source, /frictionScore|costScore|priorityScore|providerRank|vendorRank/);
  assert.doesNotMatch(source, /\.discover\s*\(|\.extract\s*\(|fetch\s*\(|createUboDecisionApplication|orchestrateResolution/);
});

test("Wave 9 capability/profile planning remains private, deterministic and execution-free", () => {
  const planner = fs.readFileSync(path.join(PRODUCT_ROOT, "planning", "resolutionPlanV2.js"), "utf8");
  const profile = fs.readFileSync(path.join(PRODUCT_ROOT, "planning", "registryCapabilityProfileV1.js"), "utf8");
  for (const source of [planner, profile]) {
    assert.doesNotMatch(source, /React|DOM|screenId|pageId|formId|buttonId|src[\\/]App/i);
    assert.doesNotMatch(source, /frictionScore|costScore|priorityScore|providerRank|vendorRank/i);
    assert.doesNotMatch(source, /\.discover\s*\(|\.extract\s*\(|fetch\s*\(|EvidencePlatform|upload|fileBytes|raw provider/i);
    assert.doesNotMatch(source, /Date\.now\s*\(|new Date\s*\(/);
  }
  const publicSource = fs.readFileSync(path.join(PRODUCT_ROOT, "index.js"), "utf8");
  assert.doesNotMatch(publicSource, /registryCapabilityProfileV1|resolutionPlanV2|planUboResolutionV2/);
});

test("Wave 10 review entry is deliberate and the successor Lab crosses only that boundary", () => {
  const reviewEntry = fs.readFileSync(path.join(PRODUCT_ROOT, "review", "index.js"), "utf8");
  const reviewApplication = fs.readFileSync(path.join(PRODUCT_ROOT, "application", "createUboReviewApplication.js"), "utf8");
  const reviewLab = fs.readFileSync(path.resolve(PRODUCT_ROOT, "..", "ubo-control-lab", "server", "reviewLabEngine.js"), "utf8");
  assert.match(reviewLab, /require\("\.\.\/\.\.\/ubo-control\/review"\)/);
  assert.equal((reviewLab.match(/require\([^\n]*ubo-control/g) || []).length, 1);
  assert.doesNotMatch(reviewLab, /ubo-control\/(application|domain|planning|projection|policy|calculation)\//);
  for (const source of [reviewEntry, reviewApplication, reviewLab]) {
    assert.doesNotMatch(source, /EvidencePlatform|ExtractionService|src[\\/]App|entity_dossiers|journey_state|@vercel|@neondatabase|fetch\s*\(/i);
  }
  assert.doesNotMatch(reviewApplication, /applyCustomerInput|CustomerAction|JourneyProjection/);
});

test("the journey projection is host/UI neutral and contains no resolution ranking logic", () => {
  const source = fs.readFileSync(path.join(PRODUCT_ROOT, "projection", "uboJourneyProjection.js"), "utf8");
  assert.doesNotMatch(source, /React|DOM|screenId|pageId|routeId|formId|buttonId/);
  assert.doesNotMatch(source, /priorityScore|recommendedOption|rankResolution|JH-006/);
  assert.doesNotMatch(source, /createUboDecisionApplication|orchestrateResolution|buildCanonicalOwnershipGraph|calculateEffectivePercentage/);
});

test("customer-input application remains standalone, data-only, and cannot execute host, UI, or Evidence concerns", () => {
  const source = fs.readFileSync(path.join(PRODUCT_ROOT, "application", "applyCustomerInput.js"), "utf8");
  assert.doesNotMatch(source, /React|ubo-control[-]ui|src\/App|pipeline|stakeholder|dossier|host DB/i);
  assert.doesNotMatch(source, /fetch\s*\(|\/api\/research|Blob|base64|fileBytes|rawFile/);
  assert.doesNotMatch(source, /senior_managing_official_fallback/);
  assert.doesNotMatch(source, /fuzzy|similar name|normalized name|confidence/i);
});

test("the standalone Lab stays outside onboarding, Evidence, and persistence boundaries", () => {
  const labRoot = path.resolve(PRODUCT_ROOT, "..", "ubo-control-lab");
  const serverSource = fs.readFileSync(path.join(labRoot, "server", "labEngine.js"), "utf8");
  const apiSource = fs.readFileSync(path.resolve(PRODUCT_ROOT, "..", "api", "ubo-control-lab.js"), "utf8");
  const browserSource = fs.readFileSync(path.join(labRoot, "browser", "lab.js"), "utf8");

  for (const source of [serverSource, apiSource, browserSource]) {
    assert.doesNotMatch(source, /src[\\/]App|entity_dossiers|journey_state|db[\\/]|migrations[\\/]/i);
  }
  assert.doesNotMatch(serverSource, /evidencePlatform|extractFromDoc|documentWorkflow/i);
  assert.match(browserSource, /Live Evidence/);
  assert.match(browserSource, /Unavailable until Gate 4/i);
});
