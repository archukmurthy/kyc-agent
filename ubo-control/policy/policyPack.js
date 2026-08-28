"use strict";

const { createHash } = require("node:crypto");
const {
  assertArray,
  assertDataOnly,
  assertNonEmptyString,
  assertPlainObject,
  assertUniqueStrings,
  cloneData,
  deepFreeze,
} = require("../internal/validation");
const { PolicyPackIntegrityError, PolicyPackValidationError } = require("../errors");
const { CANONICALIZATION_ALGORITHM, canonicalizeJson } = require("./canonicalJson");

function asParsedData(input) {
  if (Buffer.isBuffer(input)) return asParsedData(input.toString("utf8"));
  if (typeof input === "string") {
    try {
      return JSON.parse(input);
    } catch (cause) {
      throw new PolicyPackValidationError("Policy Pack is not valid JSON", {
        code: "INVALID_POLICY_PACK_JSON",
        cause,
      });
    }
  }
  return input;
}

function validatePolicyPack(input) {
  try {
    const policyPack = asParsedData(input);
    assertPlainObject(policyPack, "policyPack");
    assertDataOnly(policyPack, "policyPack");
    assertNonEmptyString(policyPack.schemaVersion, "policyPack.schemaVersion");
    assertNonEmptyString(policyPack.policyPackId, "policyPack.policyPackId");
    assertNonEmptyString(policyPack.version, "policyPack.version");
    assertNonEmptyString(policyPack.jurisdiction, "policyPack.jurisdiction");
    assertPlainObject(policyPack.applicability, "policyPack.applicability");
    assertPlainObject(policyPack.effectivePeriod, "policyPack.effectivePeriod");
    assertArray(policyPack.requirements, "policyPack.requirements");
    assertArray(policyPack.rules, "policyPack.rules");

    const requirementIds = policyPack.requirements.map((requirement, index) => {
      assertPlainObject(requirement, `policyPack.requirements[${index}]`);
      assertNonEmptyString(requirement.requirementId, `policyPack.requirements[${index}].requirementId`);
      if (requirement.ruleIds !== undefined) {
        assertUniqueStrings(requirement.ruleIds, `policyPack.requirements[${index}].ruleIds`);
      }
      return requirement.requirementId;
    });
    assertUniqueStrings(requirementIds, "policyPack requirement identifiers");

    const ruleIds = policyPack.rules.map((rule, index) => {
      assertPlainObject(rule, `policyPack.rules[${index}]`);
      assertNonEmptyString(rule.ruleId, `policyPack.rules[${index}].ruleId`);
      return rule.ruleId;
    });
    assertUniqueStrings(ruleIds, "policyPack rule identifiers");

    const knownRuleIds = new Set(ruleIds);
    policyPack.requirements.forEach((requirement) => {
      (requirement.ruleIds || []).forEach((ruleId) => {
        if (!knownRuleIds.has(ruleId)) {
          throw new PolicyPackValidationError(
            `Requirement ${requirement.requirementId} references unknown rule ${ruleId}`,
            { code: "UNKNOWN_POLICY_RULE_REFERENCE" },
          );
        }
      });
    });

    return true;
  } catch (error) {
    if (error instanceof PolicyPackValidationError) throw error;
    throw new PolicyPackValidationError(error.message, {
      code: error.code || "INVALID_POLICY_PACK",
      cause: error,
    });
  }
}

function hashPolicyPack(input) {
  const policyPack = asParsedData(input);
  validatePolicyPack(policyPack);
  const canonicalJson = canonicalizeJson(policyPack);
  const digest = createHash("sha256").update(canonicalJson, "utf8").digest("hex");
  return `sha256:${digest}`;
}

function loadPolicyPack(input, { expectedHash } = {}) {
  const parsed = asParsedData(input);
  validatePolicyPack(parsed);
  const policyPack = cloneData(parsed);
  const hash = hashPolicyPack(policyPack);

  if (expectedHash !== undefined && expectedHash !== hash) {
    throw new PolicyPackIntegrityError("Policy Pack hash does not match the expected pin", {
      code: "POLICY_PACK_HASH_MISMATCH",
    });
  }

  return deepFreeze({
    policyPack,
    identity: {
      schemaVersion: policyPack.schemaVersion,
      policyPackId: policyPack.policyPackId,
      version: policyPack.version,
      canonicalizationAlgorithm: CANONICALIZATION_ALGORITHM,
      hashAlgorithm: "sha256",
      hash,
    },
  });
}

module.exports = { hashPolicyPack, loadPolicyPack, validatePolicyPack };
