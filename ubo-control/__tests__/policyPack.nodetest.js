"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  CANONICALIZATION_ALGORITHM,
  PolicyPackIntegrityError,
  PolicyPackValidationError,
  canonicalizeJson,
  hashPolicyPack,
  loadPolicyPack,
  validatePolicyPack,
} = require("..");

function validPolicyPack(overrides = {}) {
  return {
    schemaVersion: "1.0.0",
    policyPackId: "test.pack",
    version: "1.0.0",
    jurisdiction: "GB",
    applicability: { subjectType: "CORPORATE" },
    effectivePeriod: { from: "2026-01-01" },
    requirements: [{ requirementId: "req-1", ruleIds: ["rule-1"] }],
    rules: [{ ruleId: "rule-1", definition: { kind: "PLACEHOLDER" } }],
    ...overrides,
  };
}

test("canonical JSON has a fixed deterministic vector", () => {
  assert.equal(CANONICALIZATION_ALGORITHM, "ubo-canonical-json-v1");
  assert.equal(canonicalizeJson({ b: 2, a: 1 }), '{"a":1,"b":2}');
  assert.equal(
    canonicalizeJson({ z: [3, { y: true, x: null }], a: "text" }),
    '{"a":"text","z":[3,{"x":null,"y":true}]}',
  );
});

test("a valid top-level Policy Pack validates and has a fixed hash vector", () => {
  const pack = validPolicyPack();
  assert.equal(validatePolicyPack(pack), true);
  assert.equal(
    hashPolicyPack(pack),
    "sha256:5dd8e5baecb90db292bee18a2a31286f0e7d7dfbd8d5d5446a06d6f684ee8ec0",
  );
});

test("insignificant whitespace, line endings, and object key order do not change policy identity", () => {
  const compact = JSON.stringify(validPolicyPack());
  const reorderedWithCrLf = [
    "{",
    '  "rules": [{"definition":{"kind":"PLACEHOLDER"},"ruleId":"rule-1"}],',
    '  "requirements": [{"ruleIds":["rule-1"],"requirementId":"req-1"}],',
    '  "effectivePeriod": {"from":"2026-01-01"},',
    '  "applicability": {"subjectType":"CORPORATE"},',
    '  "jurisdiction": "GB",',
    '  "version": "1.0.0",',
    '  "policyPackId": "test.pack",',
    '  "schemaVersion": "1.0.0"',
    "}",
  ].join("\r\n");

  assert.equal(hashPolicyPack(compact), hashPolicyPack(reorderedWithCrLf));
});

test("a material Policy Pack change changes its hash", () => {
  assert.notEqual(
    hashPolicyPack(validPolicyPack()),
    hashPolicyPack(validPolicyPack({ version: "1.0.1" })),
  );
});

test("Policy Packs reject executable and non-data content", () => {
  const executable = validPolicyPack({
    rules: [{ ruleId: "rule-1", execute: () => true }],
  });
  assert.throws(() => validatePolicyPack(executable), PolicyPackValidationError);
  assert.throws(
    () => validatePolicyPack(validPolicyPack({ applicability: new Date() })),
    PolicyPackValidationError,
  );
});

test("Policy Packs reject malformed identifiers and references", () => {
  assert.throws(() => validatePolicyPack(validPolicyPack({ policyPackId: "" })), PolicyPackValidationError);
  assert.throws(() => validatePolicyPack(validPolicyPack({
    requirements: [
      { requirementId: "duplicate", ruleIds: [] },
      { requirementId: "duplicate", ruleIds: [] },
    ],
  })), PolicyPackValidationError);
  assert.throws(() => validatePolicyPack(validPolicyPack({
    requirements: [{ requirementId: "req-1", ruleIds: ["missing-rule"] }],
  })), PolicyPackValidationError);
});

test("loading pins identity, verifies an expected hash, clones data, and freezes the result", () => {
  const source = validPolicyPack();
  const expectedHash = hashPolicyPack(source);
  const loaded = loadPolicyPack(source, { expectedHash });

  assert.equal(loaded.identity.hash, expectedHash);
  assert.equal(loaded.identity.hashAlgorithm, "sha256");
  assert.equal(loaded.identity.canonicalizationAlgorithm, CANONICALIZATION_ALGORITHM);
  assert.notEqual(loaded.policyPack, source);
  assert.equal(Object.isFrozen(loaded), true);
  assert.equal(Object.isFrozen(loaded.policyPack.requirements[0]), true);

  assert.throws(
    () => loadPolicyPack(source, { expectedHash: `sha256:${"0".repeat(64)}` }),
    PolicyPackIntegrityError,
  );
});
