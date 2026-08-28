"use strict";

const { createHash } = require("node:crypto");
const {
  assertAllowedKeys,
  assertArray,
  assertDataOnly,
  assertEnum,
  assertNonEmptyString,
  assertPlainObject,
  assertUniqueStrings,
  cloneData,
  deepFreeze,
} = require("../internal/validation");
const { PolicyPackIntegrityError, PolicyPackValidationError } = require("../errors");
const {
  APPLICABILITY_MODEL_VERSION,
  CAPABILITY_CONTRACT_VERSION,
  CLAIM_STATE_MODEL_VERSION,
  CONDITION_LANGUAGE_VERSION,
  POLICY_PACK_SCHEMA_ID,
  POLICY_PACK_SCHEMA_VERSION,
  REQUIREMENT_STATE_MODEL_VERSION,
  RESOLUTION_EFFECT,
  RESOLUTION_SEMANTICS_VERSION,
  RESOLUTION_STRATEGY,
  RISK_LEVEL,
  RISK_LEVEL_MODEL_VERSION,
} = require("../contracts/constants");
const { CANONICALIZATION_ALGORITHM, canonicalizeJson } = require("./canonicalJson");
const { validateConditionExpression } = require("./conditionLanguage");

const TOP_LEVEL_FIELDS = Object.freeze([
  "schemaId",
  "schemaVersion",
  "policyPackId",
  "version",
  "status",
  "jurisdiction",
  "domain",
  "supersedes",
  "applicability",
  "effectivePeriod",
  "engineSemantics",
  "sourceTraceability",
  "lifecyclePolicy",
  "entityProfiles",
  "definitions",
  "parameters",
  "evidenceModel",
  "evidenceCatalogue",
  "roleProjection",
  "requirements",
  "rules",
  "informationNeedPolicy",
  "terminalOutcomes",
  "actionTemplates",
]);

const ENGINE_SEMANTIC_FIELDS = Object.freeze([
  "capabilityContractVersion",
  "conditionLanguageVersion",
  "requirementStateModelVersion",
  "claimStateModelVersion",
  "applicabilityModelVersion",
  "resolutionSemanticsVersion",
  "riskLevelModelVersion",
  "canonicalizationAlgorithm",
]);

const PARAMETER_REFERENCE_FIELDS = new Set([
  "thresholdRef",
  "minStrengthRef",
  "maxRiskRef",
  "periodicRef",
  "levelRef",
  "maxAgeRef",
]);

const ACTION_CONTENT_STATUS = Object.freeze({
  SUPPLIED: "SUPPLIED",
  UNRESOLVED_SOURCE_REFERENCE: "UNRESOLVED_SOURCE_REFERENCE",
});

function policyError(message, code = "INVALID_POLICY_PACK") {
  throw new PolicyPackValidationError(message, { code });
}

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

function assertSupportedEngineSemantics(engineSemantics) {
  assertPlainObject(engineSemantics, "policyPack.engineSemantics");
  assertAllowedKeys(engineSemantics, ENGINE_SEMANTIC_FIELDS, "policyPack.engineSemantics");

  const expected = {
    capabilityContractVersion: CAPABILITY_CONTRACT_VERSION,
    conditionLanguageVersion: CONDITION_LANGUAGE_VERSION,
    requirementStateModelVersion: REQUIREMENT_STATE_MODEL_VERSION,
    claimStateModelVersion: CLAIM_STATE_MODEL_VERSION,
    applicabilityModelVersion: APPLICABILITY_MODEL_VERSION,
    resolutionSemanticsVersion: RESOLUTION_SEMANTICS_VERSION,
    riskLevelModelVersion: RISK_LEVEL_MODEL_VERSION,
    canonicalizationAlgorithm: CANONICALIZATION_ALGORITHM,
  };

  for (const [field, value] of Object.entries(expected)) {
    if (engineSemantics[field] !== value) {
      policyError(
        `policyPack.engineSemantics.${field} must equal supported version ${value}`,
        "UNSUPPORTED_POLICY_SEMANTICS_VERSION",
      );
    }
  }
}

function objectKeys(value, path) {
  assertPlainObject(value, path);
  return Object.keys(value);
}

function assertReferenceExists(reference, known, path, referenceKind) {
  assertNonEmptyString(reference, path);
  if (!known.has(reference)) {
    policyError(`${path} references unknown ${referenceKind} ${reference}`, "UNKNOWN_POLICY_REFERENCE");
  }
}

function collectUnresolvedReferences(sourceTraceability, field) {
  if (!sourceTraceability) return new Set();
  const references = sourceTraceability[field] || [];
  assertArray(references, `policyPack.sourceTraceability.${field}`);
  const identifiers = references.map((reference, index) => {
    assertPlainObject(reference, `policyPack.sourceTraceability.${field}[${index}]`);
    assertNonEmptyString(
      reference.sourceReference,
      `policyPack.sourceTraceability.${field}[${index}].sourceReference`,
    );
    assertNonEmptyString(reference.reason, `policyPack.sourceTraceability.${field}[${index}].reason`);
    return reference.sourceReference;
  });
  assertUniqueStrings(identifiers, `policyPack.sourceTraceability.${field} identifiers`);
  return new Set(identifiers);
}

function validateActionTemplates(actionTemplates, sourceTraceability) {
  const actionIds = objectKeys(actionTemplates, "policyPack.actionTemplates");
  const unresolvedReferences = sourceTraceability?.unresolvedActionTemplateSourceReferences || [];
  assertArray(
    unresolvedReferences,
    "policyPack.sourceTraceability.unresolvedActionTemplateSourceReferences",
  );
  const unresolvedBySemanticId = new Map();
  const unresolvedIds = unresolvedReferences.map((reference, index) => {
    const path = `policyPack.sourceTraceability.unresolvedActionTemplateSourceReferences[${index}]`;
    assertPlainObject(reference, path);
    assertNonEmptyString(reference.semanticId, `${path}.semanticId`);
    assertNonEmptyString(reference.sourceReference, `${path}.sourceReference`);
    assertNonEmptyString(reference.reason, `${path}.reason`);
    unresolvedBySemanticId.set(reference.semanticId, reference);
    return reference.semanticId;
  });
  assertUniqueStrings(unresolvedIds, "policyPack unresolved action-template identifiers");
  const unresolvedSemanticIds = new Set(unresolvedIds);

  actionIds.forEach((actionId) => {
    if (!/^[A-Z][A-Z0-9_]*$/.test(actionId) || /^B\d+$/.test(actionId)) {
      policyError(`policyPack.actionTemplates contains non-semantic identifier ${actionId}`);
    }
    const template = actionTemplates[actionId];
    assertPlainObject(template, `policyPack.actionTemplates.${actionId}`);
    assertEnum(
      template.contentStatus,
      ACTION_CONTENT_STATUS,
      `policyPack.actionTemplates.${actionId}.contentStatus`,
    );

    if (template.contentStatus === ACTION_CONTENT_STATUS.SUPPLIED) {
      if (template.text !== undefined) {
        assertNonEmptyString(template.text, `policyPack.actionTemplates.${actionId}.text`);
      }
      if (template.textByEntityProfile !== undefined) {
        assertPlainObject(
          template.textByEntityProfile,
          `policyPack.actionTemplates.${actionId}.textByEntityProfile`,
        );
        const profileTexts = Object.entries(template.textByEntityProfile);
        if (profileTexts.length === 0) {
          policyError(`Supplied action template ${actionId} has no entity-profile wording`);
        }
        profileTexts.forEach(([profile, text]) => {
          assertNonEmptyString(profile, `policyPack.actionTemplates.${actionId}.textByEntityProfile key`);
          assertNonEmptyString(
            text,
            `policyPack.actionTemplates.${actionId}.textByEntityProfile.${profile}`,
          );
        });
      }
      if (template.text === undefined && template.textByEntityProfile === undefined) {
        policyError(`Supplied action template ${actionId} requires text or textByEntityProfile`);
      }
      if (unresolvedSemanticIds.has(actionId)) {
        policyError(`Action template ${actionId} cannot be both supplied and unresolved`);
      }
    } else {
      assertNonEmptyString(template.sourceReference, `policyPack.actionTemplates.${actionId}.sourceReference`);
      if (template.text !== undefined || template.textByEntityProfile !== undefined) {
        policyError(`Unresolved action template ${actionId} must not invent interaction wording`);
      }
      if (!unresolvedSemanticIds.has(actionId)) {
        policyError(`Unresolved action template ${actionId} is missing source-integrity metadata`);
      }
      if (unresolvedBySemanticId.get(actionId).sourceReference !== template.sourceReference) {
        policyError(`Unresolved action template ${actionId} has inconsistent source-reference metadata`);
      }
    }
  });

  unresolvedSemanticIds.forEach((actionId) => {
    if (!Object.prototype.hasOwnProperty.call(actionTemplates, actionId)) {
      policyError(`Source integrity references unknown action template ${actionId}`);
    }
  });

  return new Set(actionIds);
}

function validateEvidenceCatalogue(evidenceCatalogue, parameters) {
  assertPlainObject(evidenceCatalogue, "policyPack.evidenceCatalogue");
  assertArray(evidenceCatalogue.items, "policyPack.evidenceCatalogue.items");
  const keys = evidenceCatalogue.items.map((item, index) => {
    assertPlainObject(item, `policyPack.evidenceCatalogue.items[${index}]`);
    assertNonEmptyString(item.key, `policyPack.evidenceCatalogue.items[${index}].key`);
    if (item.maxAgeRef !== undefined) {
      assertReferenceExists(
        item.maxAgeRef,
        parameters,
        `policyPack.evidenceCatalogue.items[${index}].maxAgeRef`,
        "parameter",
      );
    }
    return item.key;
  });
  assertUniqueStrings(keys, "policyPack evidence identifiers");
  return new Set(keys);
}

function entityConceptsByProfile(entityProfiles, evidenceItems) {
  assertPlainObject(entityProfiles, "policyPack.entityProfiles");
  const concepts = new Map();
  Object.entries(entityProfiles).forEach(([entityType, entityProfile]) => {
    const path = `policyPack.entityProfiles.${entityType}`;
    assertPlainObject(entityProfile, path);
    assertNonEmptyString(entityProfile.profile, `${path}.profile`);
    const profileConcepts = concepts.get(entityProfile.profile) || new Set();
    ["economicInterestConcept", "votingConcept", "appointmentControlConcept"].forEach((field) => {
      assertNonEmptyString(entityProfile[field], `${path}.${field}`);
      profileConcepts.add(entityProfile[field]);
    });
    concepts.set(entityProfile.profile, profileConcepts);

    assertArray(entityProfile.primaryGovernanceDocuments, `${path}.primaryGovernanceDocuments`);
    entityProfile.primaryGovernanceDocuments.forEach((reference, index) => {
      assertReferenceExists(
        reference,
        evidenceItems,
        `${path}.primaryGovernanceDocuments[${index}]`,
        "evidence item",
      );
    });
  });
  return concepts;
}

function walkPolicyData(value, visitor, path = "policyPack") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkPolicyData(item, visitor, `${path}[${index}]`));
    return;
  }
  if (value === null || typeof value !== "object") return;
  Object.entries(value).forEach(([key, item]) => {
    const itemPath = `${path}.${key}`;
    visitor(key, item, itemPath, value);
    walkPolicyData(item, visitor, itemPath);
  });
}

function validateEmbeddedReferences(policyPack, context) {
  walkPolicyData(policyPack, (key, value, path) => {
    if (PARAMETER_REFERENCE_FIELDS.has(key)) {
      assertReferenceExists(value, context.parameters, path, "parameter");
    }
    if (key === "definitionRef") {
      assertReferenceExists(value, context.definitions, path, "definition");
    }
    if (key === "evidence") {
      assertReferenceExists(value, context.evidenceItems, path, "evidence item");
    }
    if (key === "actionTemplateId") {
      assertReferenceExists(value, context.actionTemplates, path, "action template");
    }
    if (key === "strategy") {
      assertEnum(value, RESOLUTION_STRATEGY, path);
    }
    if (key === "resolutionEffect") {
      assertEnum(value, RESOLUTION_EFFECT, path);
    }
    if (key === "level" || key === "maxRiskLevel") {
      assertEnum(value, RISK_LEVEL, path);
    }
    if (key === "condition") {
      try {
        validateConditionExpression(value);
      } catch (cause) {
        policyError(`${path}: ${cause.message}`, cause.code);
      }
      const references = value.matchAll(/\bparams\.([A-Za-z_][A-Za-z0-9_]*)/g);
      for (const match of references) {
        assertReferenceExists(match[1], context.parameters, path, "parameter");
      }
    }
    if (key === "eventSourceRefs") {
      assertArray(value, path);
      value.forEach((reference, index) => {
        if (!context.lifecycleEvents.has(reference) && !context.unresolvedLifecycleEvents.has(reference)) {
          policyError(`${path}[${index}] references unknown lifecycle event ${reference}`);
        }
      });
    }
  });

  walkPolicyData(policyPack, (_key, value, path) => {
    if (typeof value !== "string") return;
    for (const match of value.matchAll(/\{param:([A-Za-z_][A-Za-z0-9_]*)\}/g)) {
      assertReferenceExists(match[1], context.parameters, path, "parameter");
    }
  });
}

function validateRequirements(policyPack, context, conceptsByProfile) {
  assertArray(policyPack.requirements, "policyPack.requirements");
  const requirementIds = policyPack.requirements.map((requirement, index) => {
    const path = `policyPack.requirements[${index}]`;
    assertPlainObject(requirement, path);
    assertNonEmptyString(requirement.requirementId, `${path}.requirementId`);
    if (requirement.ruleIds !== undefined) {
      assertUniqueStrings(requirement.ruleIds, `${path}.ruleIds`);
    }
    if (requirement.testAssertions !== undefined) {
      assertArray(requirement.testAssertions, `${path}.testAssertions`);
      requirement.testAssertions.forEach((assertion, assertionIndex) => {
        assertNonEmptyString(assertion, `${path}.testAssertions[${assertionIndex}]`);
      });
    }
    if (requirement.entitySemantics !== undefined) {
      assertPlainObject(requirement.entitySemantics, `${path}.entitySemantics`);
      Object.entries(requirement.entitySemantics).forEach(([profile, semantics]) => {
        assertPlainObject(semantics, `${path}.entitySemantics.${profile}`);
        if (semantics.concept !== undefined) {
          const knownConcepts = conceptsByProfile.get(profile);
          if (!knownConcepts || !knownConcepts.has(semantics.concept)) {
            policyError(`${path}.entitySemantics.${profile}.concept references unknown profile concept ${semantics.concept}`);
          }
        }
      });
    }
    return requirement.requirementId;
  });
  assertUniqueStrings(requirementIds, "policyPack requirement identifiers");

  policyPack.requirements.forEach((requirement) => {
    (requirement.ruleIds || []).forEach((ruleId) => {
      assertReferenceExists(
        ruleId,
        context.rules,
        `Requirement ${requirement.requirementId}.ruleIds`,
        "rule",
      );
    });
  });
}

function validateRules(rules) {
  assertArray(rules, "policyPack.rules");
  const ruleIds = rules.map((rule, index) => {
    assertPlainObject(rule, `policyPack.rules[${index}]`);
    assertNonEmptyString(rule.ruleId, `policyPack.rules[${index}].ruleId`);
    return rule.ruleId;
  });
  assertUniqueStrings(ruleIds, "policyPack rule identifiers");
  return new Set(ruleIds);
}

function validateRoleProjection(roleProjection) {
  if (roleProjection === undefined) return;
  assertPlainObject(roleProjection, "policyPack.roleProjection");
  assertArray(roleProjection.roles, "policyPack.roleProjection.roles");
  const roles = roleProjection.roles.map((role, index) => {
    assertPlainObject(role, `policyPack.roleProjection.roles[${index}]`);
    assertNonEmptyString(role.role, `policyPack.roleProjection.roles[${index}].role`);
    assertNonEmptyString(role.trigger, `policyPack.roleProjection.roles[${index}].trigger`);
    return role.role;
  });
  assertUniqueStrings(roles, "policyPack projected role identifiers");
}

function validatePolicyPack(input) {
  try {
    const policyPack = asParsedData(input);
    assertPlainObject(policyPack, "policyPack");
    assertDataOnly(policyPack, "policyPack");
    assertAllowedKeys(policyPack, TOP_LEVEL_FIELDS, "policyPack");

    if (policyPack.schemaId !== POLICY_PACK_SCHEMA_ID) {
      policyError(`policyPack.schemaId must equal ${POLICY_PACK_SCHEMA_ID}`, "UNSUPPORTED_POLICY_SCHEMA");
    }
    if (policyPack.schemaVersion !== POLICY_PACK_SCHEMA_VERSION) {
      policyError(
        `policyPack.schemaVersion must equal ${POLICY_PACK_SCHEMA_VERSION}`,
        "UNSUPPORTED_POLICY_SCHEMA",
      );
    }
    assertNonEmptyString(policyPack.policyPackId, "policyPack.policyPackId");
    assertNonEmptyString(policyPack.version, "policyPack.version");
    assertNonEmptyString(policyPack.status, "policyPack.status");
    assertNonEmptyString(policyPack.jurisdiction, "policyPack.jurisdiction");
    assertPlainObject(policyPack.applicability, "policyPack.applicability");
    assertPlainObject(policyPack.effectivePeriod, "policyPack.effectivePeriod");
    assertSupportedEngineSemantics(policyPack.engineSemantics);

    if (policyPack.sourceTraceability !== undefined) {
      assertPlainObject(policyPack.sourceTraceability, "policyPack.sourceTraceability");
      if (policyPack.sourceTraceability.sourceSha256 !== undefined) {
        if (!/^sha256:[0-9a-f]{64}$/.test(policyPack.sourceTraceability.sourceSha256)) {
          policyError("policyPack.sourceTraceability.sourceSha256 must be a lowercase sha256 pin");
        }
      }
    }

    const parameters = new Set(objectKeys(policyPack.parameters, "policyPack.parameters"));
    const definitions = new Set(objectKeys(policyPack.definitions, "policyPack.definitions"));
    const rules = validateRules(policyPack.rules);
    const unresolvedLifecycleEvents = collectUnresolvedReferences(
      policyPack.sourceTraceability,
      "unresolvedLifecycleEventSourceReferences",
    );
    const lifecycleEvents = new Set(
      policyPack.lifecyclePolicy?.eventCatalogue
        ? objectKeys(policyPack.lifecyclePolicy.eventCatalogue, "policyPack.lifecyclePolicy.eventCatalogue")
        : [],
    );
    const actionTemplates = validateActionTemplates(policyPack.actionTemplates, policyPack.sourceTraceability);
    const evidenceItems = validateEvidenceCatalogue(policyPack.evidenceCatalogue, parameters);
    const conceptsByProfile = entityConceptsByProfile(policyPack.entityProfiles, evidenceItems);

    const context = {
      actionTemplates,
      definitions,
      evidenceItems,
      lifecycleEvents,
      parameters,
      rules,
      unresolvedLifecycleEvents,
    };

    validateRequirements(policyPack, context, conceptsByProfile);
    validateRoleProjection(policyPack.roleProjection);
    validateEmbeddedReferences(policyPack, context);

    if (policyPack.informationNeedPolicy?.permittedResolutionStrategies !== undefined) {
      assertArray(
        policyPack.informationNeedPolicy.permittedResolutionStrategies,
        "policyPack.informationNeedPolicy.permittedResolutionStrategies",
      );
      policyPack.informationNeedPolicy.permittedResolutionStrategies.forEach((strategy, index) => {
        assertEnum(
          strategy,
          RESOLUTION_STRATEGY,
          `policyPack.informationNeedPolicy.permittedResolutionStrategies[${index}]`,
        );
      });
    }

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
      schemaId: policyPack.schemaId,
      schemaVersion: policyPack.schemaVersion,
      policyPackId: policyPack.policyPackId,
      version: policyPack.version,
      status: policyPack.status,
      canonicalizationAlgorithm: CANONICALIZATION_ALGORITHM,
      hashAlgorithm: "sha256",
      hash,
    },
  });
}

module.exports = { hashPolicyPack, loadPolicyPack, validatePolicyPack };
