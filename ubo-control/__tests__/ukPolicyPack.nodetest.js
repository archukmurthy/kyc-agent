"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  CONDITION_LANGUAGE_VERSION,
  POLICY_PACK_SCHEMA_ID,
  POLICY_PACK_SCHEMA_VERSION,
  REQUIREMENT_STATE,
  RESOLUTION_STRATEGY,
  hashPolicyPack,
  loadPolicyPack,
  validateConditionExpression,
  validatePolicyPack,
} = require("..");

const POLICY_DIRECTORY = path.join(__dirname, "..", "policies", "uk-corporate", "1.3-rc");
const policyPack = JSON.parse(fs.readFileSync(path.join(POLICY_DIRECTORY, "policy.json"), "utf8"));
const assertionPlan = JSON.parse(
  fs.readFileSync(path.join(POLICY_DIRECTORY, "test-assertion-plan.json"), "utf8"),
);
const { allScenarios } = require("../test-support/scenarioCorpus");
const EXPECTED_POLICY_HASH = "sha256:6bb687ae0c65de7063473db7d34c4f693279dafdd7ef293c79d22347aab29496";

function walk(value, visit) {
  if (Array.isArray(value)) {
    value.forEach((item) => walk(item, visit));
    return;
  }
  if (value === null || typeof value !== "object") return;
  Object.entries(value).forEach(([key, item]) => {
    visit(key, item);
    walk(item, visit);
  });
}

test("the canonical UK Corporate v1.3-RC artifact validates, loads, and pins its exact identity", () => {
  assert.equal(validatePolicyPack(policyPack), true);
  assert.equal(policyPack.schemaId, POLICY_PACK_SCHEMA_ID);
  assert.equal(policyPack.schemaVersion, POLICY_PACK_SCHEMA_VERSION);
  assert.equal(policyPack.policyPackId, "UBO-UK-CORPORATE");
  assert.equal(policyPack.version, "1.3-RC");
  assert.equal(policyPack.status, "CONTROL_ROOM_REVIEW");
  assert.equal(policyPack.supersedes, "1.2-RC");
  assert.equal(hashPolicyPack(policyPack), EXPECTED_POLICY_HASH);
  assert.equal(loadPolicyPack(policyPack, { expectedHash: EXPECTED_POLICY_HASH }).identity.hash, EXPECTED_POLICY_HASH);
});

test("runtime traceability pins the supplied Control Room source without making it the runtime contract", () => {
  assert.equal(
    policyPack.sourceTraceability.sourceFileName,
    "ubo-policy-pack.uk-corporate.v1.3-RC.control-room-source.json",
  );
  assert.equal(
    policyPack.sourceTraceability.sourceSha256,
    "sha256:921355c9d4e7a170156c8adff7e9a272a36daf9d63ca5d1352363f5139483b3b",
  );
  assert.equal(policyPack.sourceTraceability.sourcePolicyVersion, "1.3-RC");
  assert.equal(policyPack.sourceTraceability.runtimeReadiness, "CONTROL_ROOM_REVIEW");
  assert.equal(Object.prototype.hasOwnProperty.call(policyPack, "artifactRole"), false);
});

test("engine and architecture conventions are referenced by version rather than tenant-editable copies", () => {
  assert.equal(policyPack.engineSemantics.conditionLanguageVersion, CONDITION_LANGUAGE_VERSION);
  assert.equal(Object.prototype.hasOwnProperty.call(policyPack, "conventions"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(policyPack, "runtimeContract"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(policyPack, "mvpArchitectureInvariants"), false);
  assert.deepEqual(Object.values(REQUIREMENT_STATE), [
    "UNRESOLVED",
    "RESOLVED",
    "GAP",
    "CONFLICT",
    "REVIEW_REQUIRED",
    "N_A",
  ]);
});

test("all runtime conditions conform to ubo-condition-v1 without evaluation", () => {
  const conditions = [];
  walk(policyPack, (key, value) => {
    if (key === "condition") conditions.push(value);
  });
  assert.ok(conditions.length > 0);
  conditions.forEach((condition) => assert.equal(validateConditionExpression(condition), true));
  assert.equal(Object.prototype.hasOwnProperty.call(require(".."), "evaluateConditionExpression"), false);
});

test("resolution strategies remain provider-neutral and Extraction remains only a candidate-fact source", () => {
  const strategies = new Set();
  walk(policyPack.requirements, (key, value) => {
    if (key === "strategy") strategies.add(value);
  });
  assert.deepEqual([...strategies].sort(), Object.values(RESOLUTION_STRATEGY).sort());
  assert.equal(strategies.has("COMPANIES_HOUSE"), false);
  assert.equal(strategies.has("EXTRACTION"), false);
  assert.ok(policyPack.informationNeedPolicy.candidateFactSources.includes("EXTRACTION"));
  assert.equal(
    policyPack.informationNeedPolicy.permittedResolutionStrategies.includes("EXTRACTION"),
    false,
  );
});

test("durable action identifiers are semantic while missing B-source wording remains explicit", () => {
  const actionIds = Object.keys(policyPack.actionTemplates);
  actionIds.forEach((actionId) => {
    assert.match(actionId, /^[A-Z][A-Z0-9_]*$/);
    assert.doesNotMatch(actionId, /^B\d+$/);
  });

  assert.deepEqual(
    policyPack.sourceTraceability.unresolvedActionTemplateSourceReferences
      .map((reference) => `${reference.semanticId}:${reference.sourceReference}`)
      .sort(),
    [
      "CAPTURE_QUALIFYING_PERSON_IDENTITY:B1",
      "DISCLOSE_OTHER_SIGNIFICANT_CONTROL:B4",
      "DISCLOSE_SHARE_OWNERSHIP:B1",
      "DISCLOSE_TRUST_IN_CHAIN:B2",
    ],
  );
  policyPack.sourceTraceability.unresolvedActionTemplateSourceReferences.forEach((reference) => {
    assert.equal(policyPack.actionTemplates[reference.semanticId].contentStatus, "UNRESOLVED_SOURCE_REFERENCE");
  });
});

test("all unresolved lifecycle events are explicit and no host event model is inferred", () => {
  const referencedEvents = new Set();
  policyPack.requirements.forEach((requirement) => {
    (requirement.refresh?.eventSourceRefs || []).forEach((event) => referencedEvents.add(event));
  });
  const unresolvedEvents = new Set(
    policyPack.sourceTraceability.unresolvedLifecycleEventSourceReferences.map(
      (reference) => reference.sourceReference,
    ),
  );
  assert.deepEqual([...referencedEvents].sort(), ["E01", "E02", "E08", "E10"]);
  assert.deepEqual([...unresolvedEvents].sort(), [...referencedEvents].sort());
  assert.equal(Object.prototype.hasOwnProperty.call(policyPack.lifecyclePolicy, "eventCatalogue"), false);
});

test("every supplied policy test assertion has exactly one honest future-test classification", () => {
  const supplied = policyPack.requirements.flatMap((requirement) =>
    (requirement.testAssertions || []).map((assertion) => `${requirement.requirementId}\u0000${assertion}`));
  const planned = assertionPlan.map((entry) => `${entry.requirementId}\u0000${entry.assertion}`);
  assert.equal(supplied.length, 22);
  assert.equal(new Set(planned).size, planned.length);
  assert.deepEqual([...planned].sort(), [...supplied].sort());
  const allowedStatuses = new Set([
    "SCHEMA_PROTECTED_NOW",
    "G1.2B_SCENARIO",
    "GATE_2_REASONING",
    "LATER_INTEGRATION",
  ]);
  assertionPlan.forEach((entry) => assert.ok(allowedStatuses.has(entry.status)));
  assert.equal(assertionPlan.some((entry) => entry.status === "SCHEMA_PROTECTED_NOW"), false);
  assert.equal(assertionPlan.some((entry) => entry.status === "G1.2B_SCENARIO"), false);
  assert.equal(assertionPlan.filter((entry) => entry.status === "GATE_2_REASONING").length, 21);
  assert.equal(assertionPlan.filter((entry) => entry.status === "LATER_INTEGRATION").length, 1);
});

test("all policy assertions link to executable representability scenarios without claiming reasoning coverage", () => {
  const scenarioIds = new Set(allScenarios.map(({ id }) => id));
  assertionPlan.forEach((entry) => {
    assert.ok(Array.isArray(entry.scenarioIds) && entry.scenarioIds.length > 0);
    entry.scenarioIds.forEach((scenarioId) => assert.equal(scenarioIds.has(scenarioId), true));
    assert.equal(entry.g1_2bProtection, "REPRESENTABILITY_INPUT_ONLY");
    assert.equal(typeof entry.deferredBehavior, "string");
    assert.ok(entry.deferredBehavior.length > 0);
  });
});

test("the artifact remains pure JSON data with no callback or executable rule field", () => {
  const serialized = JSON.stringify(policyPack);
  assert.doesNotMatch(serialized, /"(?:execute|callback|handler|function)"\s*:/i);
  assert.deepEqual(policyPack.rules, []);
});
