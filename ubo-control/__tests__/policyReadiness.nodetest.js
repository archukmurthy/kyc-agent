"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  UBO_POLICY_READINESS,
  UBO_POLICY_READINESS_CONTRACT_VERSION,
  UBO_POLICY_READINESS_ERROR_CODE,
  UBO_POLICY_RUNTIME_MODE,
  UboPolicyReadinessError,
  assessUboPolicyPackReadiness,
  hashPolicyPack,
  validatePolicyPack,
} = require("..");
const POLICY_10 = require("../policies/uk-corporate/1.3-rc/policy.json");
const POLICY_11 = require("../policies/uk-corporate/1.4-rc/policy.json");
const POLICY_12 = require("../policies/uk-corporate/1.5-rc/policy.json");
const { clone, schema13Policy } = require("./fixtures/policyPack13");

const EVALUATION_TIME = "2026-09-03T12:00:00.000Z";
const V15_HASH = "sha256:724c2fa4820e02daddc24e652b50748646d87017cbfa632c062bc9e27de4b790";

function assess(policyPack, runtimeMode = UBO_POLICY_RUNTIME_MODE.PRODUCTION, extra = {}) {
  return assessUboPolicyPackReadiness({ policyPack, runtimeMode, evaluationTime: EVALUATION_TIME, ...extra });
}

function reasonCodes(result) {
  return result.blockingReasons.map(({ code }) => code);
}

function demoteSignoff(policy, status, signoffId = "TEST-SIGNOFF-MANDATORY") {
  const signoff = policy.signoffs.find((item) => item.signoffId === signoffId);
  signoff.status = status;
  delete signoff.approver;
  delete signoff.approvedAt;
  delete signoff.effectiveFrom;
}

function pin(policyPack) {
  return {
    schemaId: policyPack.schemaId,
    schemaVersion: policyPack.schemaVersion,
    policyPackId: policyPack.policyPackId,
    version: policyPack.version,
    hash: hashPolicyPack(policyPack),
  };
}

test("schemas 1.0, 1.1 and 1.2 remain valid and the v1.5 canonical hash is unchanged", () => {
  assert.equal(validatePolicyPack(POLICY_10), true);
  assert.equal(validatePolicyPack(POLICY_11), true);
  assert.equal(validatePolicyPack(POLICY_12), true);
  assert.equal(hashPolicyPack(POLICY_12), V15_HASH);
});

test("strict schema 1.3 accepts the complete camelCase test fixture", () => {
  const policy = schema13Policy();
  assert.equal(policy.schemaVersion, "1.3");
  assert.equal(validatePolicyPack(policy), true);
});

test("strict schema 1.3 rejects malformed doctrine, readiness and sign-off fields", () => {
  const doctrine = schema13Policy();
  doctrine.qualificationDoctrine.routes[0].unsupportedMeaning = true;
  assert.throws(() => validatePolicyPack(doctrine), /unsupported field/);

  const readiness = schema13Policy();
  readiness.productionReadiness.features[0].enabled = "yes";
  assert.throws(() => validatePolicyPack(readiness), /must be a boolean/);

  const signoff = schema13Policy();
  signoff.signoffs[0].status = "SIGNED";
  assert.throws(() => validatePolicyPack(signoff), /must be one of/);

  const incompleteApproval = schema13Policy();
  delete incompleteApproval.signoffs[0].approver;
  assert.throws(() => validatePolicyPack(incompleteApproval), /missing required field/);
});

test("schema 1.3 accepts the complete approved sign-off status vocabulary", () => {
  for (const status of ["OPEN", "RESEARCH_COMPLETE_SIGNOFF_PENDING", "REJECTED", "DEFERRED", "WATCH"]) {
    const policy = schema13Policy();
    demoteSignoff(policy, status);
    assert.equal(validatePolicyPack(policy), true);
  }
  assert.equal(validatePolicyPack(schema13Policy()), true, "the default fixture covers APPROVED with approver identity and dates");
});

test("current v1.5 is review-only with a watermark in LAB", () => {
  const result = assess(POLICY_12, UBO_POLICY_RUNTIME_MODE.LAB);
  assert.equal(result.contractVersion, UBO_POLICY_READINESS_CONTRACT_VERSION);
  assert.equal(result.readiness, UBO_POLICY_READINESS.REVIEW_ONLY);
  assert.equal(result.watermarkRequired, true);
  assert.equal(result.policyIdentity.policyPackId, "UBO-UK-CORPORATE");
  assert.equal(result.policyIdentity.version, "1.5-RC");
  assert.equal(result.policyIdentity.hash, V15_HASH);
  assert.deepEqual(reasonCodes(result), [
    "POLICY_NOT_PRODUCTION_APPROVED",
    "EFFECTIVE_FROM_MISSING",
    "APPROVING_AUTHORITY_MISSING",
  ]);
});

test("current v1.5 fails closed in PRODUCTION", () => {
  const result = assess(POLICY_12);
  assert.equal(result.readiness, UBO_POLICY_READINESS.BLOCKED);
  assert.equal(result.newProductionDeterminationPermitted, false);
});

test("a valid production-ready schema-1.3 fixture succeeds", () => {
  const result = assess(schema13Policy());
  assert.equal(result.readiness, UBO_POLICY_READINESS.READY);
  assert.equal(result.effectiveState, "EFFECTIVE");
  assert.equal(result.watermarkRequired, false);
  assert.equal(result.newProductionDeterminationPermitted, true);
});

test("null effective date fails in PRODUCTION", () => {
  const policy = schema13Policy();
  policy.effectivePeriod.from = null;
  const result = assess(policy);
  assert.equal(result.readiness, UBO_POLICY_READINESS.BLOCKED);
  assert.ok(reasonCodes(result).includes("EFFECTIVE_FROM_MISSING"));
});

test("missing approving authority fails in PRODUCTION", () => {
  const policy = schema13Policy();
  policy.productionReadiness.approvingAuthority = null;
  const result = assess(policy);
  assert.ok(reasonCodes(result).includes("APPROVING_AUTHORITY_MISSING"));
});

test("future and expired policies fail at the supplied deterministic evaluation time", () => {
  const future = schema13Policy();
  future.effectivePeriod.from = "2026-10-01T00:00:00.000Z";
  future.effectivePeriod.to = "2027-10-01T00:00:00.000Z";
  const futureResult = assess(future);
  assert.equal(futureResult.effectiveState, "NOT_YET_EFFECTIVE");
  assert.ok(reasonCodes(futureResult).includes("POLICY_NOT_YET_EFFECTIVE"));

  const expired = schema13Policy();
  expired.effectivePeriod.from = "2025-01-01T00:00:00.000Z";
  expired.effectivePeriod.to = "2026-01-01T00:00:00.000Z";
  const expiredResult = assess(expired);
  assert.equal(expiredResult.effectiveState, "EXPIRED");
  assert.ok(reasonCodes(expiredResult).includes("POLICY_EXPIRED"));
});

test("mandatory OPEN and research-complete-pending sign-offs fail", () => {
  for (const status of ["OPEN", "RESEARCH_COMPLETE_SIGNOFF_PENDING"]) {
    const policy = schema13Policy();
    demoteSignoff(policy, status);
    const result = assess(policy);
    assert.equal(result.readiness, UBO_POLICY_READINESS.BLOCKED);
    assert.deepEqual(result.blockingReasons.find(({ code }) => code === "REQUIRED_SIGNOFF_NOT_APPROVED").signoffIds, ["TEST-SIGNOFF-MANDATORY"]);
  }
});

test("enabled unsigned feature blocks while the same disabled optional feature does not", () => {
  const disabled = schema13Policy();
  demoteSignoff(disabled, "DEFERRED", "TEST-SIGNOFF-OPTIONAL");
  const disabledResult = assess(disabled);
  assert.equal(disabledResult.readiness, UBO_POLICY_READINESS.READY);
  assert.deepEqual(disabledResult.enabledFeatures, []);
  assert.equal(disabledResult.unresolvedSignoffs[0].signoffId, "TEST-SIGNOFF-OPTIONAL");

  const enabled = clone(disabled);
  enabled.productionReadiness.features[0].enabled = true;
  const enabledResult = assess(enabled);
  assert.equal(enabledResult.readiness, UBO_POLICY_READINESS.BLOCKED);
  assert.deepEqual(enabledResult.enabledFeatures, ["OPTIONAL_TEST_FEATURE"]);
  assert.ok(reasonCodes(enabledResult).includes("REQUIRED_SIGNOFF_NOT_APPROVED"));
});

test("unsupported required algorithm fails closed", () => {
  const policy = schema13Policy();
  policy.productionReadiness.requiredAlgorithms.push({ algorithmId: "futureCoordinator", version: "ubo-future-v9" });
  const result = assess(policy);
  assert.equal(result.readiness, UBO_POLICY_READINESS.BLOCKED);
  assert.deepEqual(result.unsupportedAlgorithms, [{ algorithmId: "futureCoordinator", version: "ubo-future-v9" }]);
});

test("malformed schema and mismatched hash fail with stable typed errors", () => {
  const malformed = schema13Policy();
  malformed.schemaVersion = "9.9";
  assert.throws(() => assess(malformed), (error) => error instanceof UboPolicyReadinessError
    && error.code === UBO_POLICY_READINESS_ERROR_CODE.INVALID_POLICY_PACK);

  const policy = schema13Policy();
  const expected = pin(policy);
  expected.hash = "sha256:0000000000000000000000000000000000000000000000000000000000000000";
  assert.throws(() => assess(policy, UBO_POLICY_RUNTIME_MODE.PRODUCTION, { pinnedPolicyIdentity: expected }), (error) =>
    error instanceof UboPolicyReadinessError
      && error.code === UBO_POLICY_READINESS_ERROR_CODE.POLICY_IDENTITY_MISMATCH);

  const malformedPin = pin(policy);
  malformedPin.hash = "not-a-sha256-pin";
  assert.throws(() => assess(policy, UBO_POLICY_RUNTIME_MODE.PRODUCTION, { pinnedPolicyIdentity: malformedPin }), (error) =>
    error instanceof UboPolicyReadinessError
      && error.code === UBO_POLICY_READINESS_ERROR_CODE.POLICY_IDENTITY_REQUIRED);
});

test("historical reconstruction accepts the exact pinned v1.5 review pack", () => {
  const result = assess(POLICY_12, UBO_POLICY_RUNTIME_MODE.HISTORICAL_RECONSTRUCTION, {
    pinnedPolicyIdentity: pin(POLICY_12),
  });
  assert.equal(result.readiness, UBO_POLICY_READINESS.REVIEW_ONLY);
  assert.deepEqual(reasonCodes(result), ["HISTORICAL_RECONSTRUCTION_ONLY"]);
  assert.equal(result.newProductionDeterminationPermitted, false);
});

test("historical reconstruction rejects hash mismatch", () => {
  const expected = pin(POLICY_12);
  expected.hash = "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
  assert.throws(() => assess(POLICY_12, UBO_POLICY_RUNTIME_MODE.HISTORICAL_RECONSTRUCTION, {
    pinnedPolicyIdentity: expected,
  }), (error) => error.code === UBO_POLICY_READINESS_ERROR_CODE.POLICY_IDENTITY_MISMATCH);
});

test("historical mode cannot authorize a new production determination", () => {
  const result = assess(schema13Policy(), UBO_POLICY_RUNTIME_MODE.HISTORICAL_RECONSTRUCTION, {
    pinnedPolicyIdentity: pin(schema13Policy()),
    intendedUse: "NEW_DETERMINATION",
  });
  assert.equal(result.readiness, UBO_POLICY_READINESS.BLOCKED);
  assert.deepEqual(reasonCodes(result), ["HISTORICAL_MODE_PROHIBITS_NEW_DETERMINATION"]);
  assert.equal(result.newProductionDeterminationPermitted, false);
});

test("readiness output is deterministic, deeply immutable and JSON serializable", () => {
  const first = assess(POLICY_12, UBO_POLICY_RUNTIME_MODE.LAB);
  const second = assess(POLICY_12, UBO_POLICY_RUNTIME_MODE.LAB);
  assert.deepEqual(first, second);
  assert.deepEqual(JSON.parse(JSON.stringify(first)), first);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.policyIdentity), true);
  assert.equal(Object.isFrozen(first.blockingReasons), true);
});

test("unsupported mode and implicit evaluation time are stable typed errors", () => {
  assert.throws(() => assessUboPolicyPackReadiness({ policyPack: POLICY_12, runtimeMode: "DEV", evaluationTime: EVALUATION_TIME }), (error) =>
    error instanceof UboPolicyReadinessError
      && error.code === UBO_POLICY_READINESS_ERROR_CODE.UNSUPPORTED_RUNTIME_MODE);
  assert.throws(() => assessUboPolicyPackReadiness({ policyPack: POLICY_12, runtimeMode: UBO_POLICY_RUNTIME_MODE.LAB }), (error) =>
    error instanceof UboPolicyReadinessError
      && error.code === UBO_POLICY_READINESS_ERROR_CODE.EVALUATION_TIME_REQUIRED);
});
