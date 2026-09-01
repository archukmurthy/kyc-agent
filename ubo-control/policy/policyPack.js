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
  CAPABILITY_OUTCOME_STATE,
  CLAIM_STATE_MODEL_VERSION,
  CONDITION_LANGUAGE_VERSION,
  POLICY_PACK_SCHEMA_ID,
  POLICY_PACK_SCHEMA_VERSION,
  PERCENTAGE_VALUE_TYPE,
  RELATIONSHIP_TYPE,
  REQUIREMENT_STATE,
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
  "fallbackReviewPolicy",
  "resolutionOrchestrationPolicy",
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
  CONTROL_ROOM_APPROVED: "CONTROL_ROOM_APPROVED",
  UNRESOLVED_SOURCE_REFERENCE: "UNRESOLVED_SOURCE_REFERENCE",
});

const SUPPORTED_POLICY_PACK_SCHEMA_VERSIONS = new Set([POLICY_PACK_SCHEMA_VERSION, "1.1", "1.2"]);
const ACTION_SUBMISSION_FACT_TYPE = Object.freeze({ RELATIONSHIP: "RELATIONSHIP" });
const ACTION_SUBMISSION_DIRECTION = Object.freeze({ OWNER_TO_TARGET: "OWNER_TO_TARGET" });
const ACTION_SUBMISSION_TARGET = Object.freeze({ INFORMATION_NEED_SUBJECT: "INFORMATION_NEED_SUBJECT" });
const FALLBACK_REVIEW_STATE = Object.freeze({
  PENDING: "PENDING",
  RESOLVED: "RESOLVED",
  SUPERSEDED: "SUPERSEDED",
});
const FALLBACK_EXHAUSTION_DECISION = Object.freeze({
  ALL_POSSIBLE_MEANS_EXHAUSTED: "ALL_POSSIBLE_MEANS_EXHAUSTED",
  FURTHER_MEASURES_AVAILABLE: "FURTHER_MEASURES_AVAILABLE",
});
const FALLBACK_DECISION_ORIGIN = Object.freeze({ ANALYST: "ANALYST", COMPLIANCE: "COMPLIANCE" });
const TERMINAL_OUTCOME = Object.freeze({
  CDD_FAILURE: "CDD_FAILURE",
  SPECIALIST_REVIEW_REQUIRED: "SPECIALIST_REVIEW_REQUIRED",
  RESOLVED_VIA_SMO_FALLBACK: "RESOLVED_VIA_SMO_FALLBACK",
  RESOLVED_PROVISIONALLY: "RESOLVED_PROVISIONALLY",
  RESOLVED: "RESOLVED",
  UNRESOLVABLE: "UNRESOLVABLE",
});

function validateUniqueEnumArray(values, allowed, path) {
  assertArray(values, path);
  values.forEach((value, index) => assertEnum(value, allowed, `${path}[${index}]`));
  assertUniqueStrings(values, path);
}

function validateSchema11Orchestration(policyPack, context) {
  if (policyPack.schemaVersion === "1.0") {
    if (policyPack.fallbackReviewPolicy !== undefined || policyPack.resolutionOrchestrationPolicy !== undefined) {
      policyError("Policy Pack schema 1.0 cannot contain schema 1.1 orchestration policy");
    }
    return;
  }

  const fallback = policyPack.fallbackReviewPolicy;
  assertPlainObject(fallback, "policyPack.fallbackReviewPolicy");
  assertAllowedKeys(fallback, [
    "reviewType",
    "candidateState",
    "readyRecommendation",
    "fallbackNecessityStates",
    "requiredPreFallbackRequirementIds",
    "conditionalPreFallbackRequirementIds",
    "satisfactoryRequirementStates",
    "blockingRequirementStates",
    "customerResolvableStrategies",
    "specialistRequirementIds",
    "operationalOutcomesThatNeverProveExhaustion",
    "reviewRequirementStates",
    "decisionValues",
    "authoritativeDecisionOrigins",
    "positiveDecision",
    "derivedEligibilityFactKey",
    "negativeDecisionRequiresConcreteInformationNeed",
    "candidateRole",
    "fallbackRole",
    "candidateCollectionActionTemplateId",
  ], "policyPack.fallbackReviewPolicy");
  ["reviewType", "candidateState", "readyRecommendation", "positiveDecision", "derivedEligibilityFactKey",
    "candidateRole", "fallbackRole", "candidateCollectionActionTemplateId"].forEach((field) => {
    assertNonEmptyString(fallback[field], `policyPack.fallbackReviewPolicy.${field}`);
  });
  assertUniqueStrings(fallback.fallbackNecessityStates, "policyPack.fallbackReviewPolicy.fallbackNecessityStates");
  const approvedNecessityStates = ["NO_QUALIFYING_PERSON_ESTABLISHED", "FIRM_UNSATISFIED_WITH_IDENTIFIED_PERSON"];
  if (canonicalizeJson([...fallback.fallbackNecessityStates].sort()) !== canonicalizeJson(approvedNecessityStates.sort())) {
    policyError("schema 1.1 fallback necessity states must preserve no-person/firm-unsatisfied doctrine");
  }
  ["requiredPreFallbackRequirementIds", "conditionalPreFallbackRequirementIds", "specialistRequirementIds"].forEach((field) => {
    assertUniqueStrings(fallback[field], `policyPack.fallbackReviewPolicy.${field}`);
    fallback[field].forEach((requirementId, index) => assertReferenceExists(
      requirementId,
      context.requirements,
      `policyPack.fallbackReviewPolicy.${field}[${index}]`,
      "requirement",
    ));
  });
  validateUniqueEnumArray(fallback.satisfactoryRequirementStates, REQUIREMENT_STATE, "policyPack.fallbackReviewPolicy.satisfactoryRequirementStates");
  validateUniqueEnumArray(fallback.blockingRequirementStates, REQUIREMENT_STATE, "policyPack.fallbackReviewPolicy.blockingRequirementStates");
  validateUniqueEnumArray(fallback.customerResolvableStrategies, RESOLUTION_STRATEGY, "policyPack.fallbackReviewPolicy.customerResolvableStrategies");
  validateUniqueEnumArray(fallback.operationalOutcomesThatNeverProveExhaustion, CAPABILITY_OUTCOME_STATE, "policyPack.fallbackReviewPolicy.operationalOutcomesThatNeverProveExhaustion");
  validateUniqueEnumArray(fallback.reviewRequirementStates, FALLBACK_REVIEW_STATE, "policyPack.fallbackReviewPolicy.reviewRequirementStates");
  validateUniqueEnumArray(fallback.decisionValues, FALLBACK_EXHAUSTION_DECISION, "policyPack.fallbackReviewPolicy.decisionValues");
  validateUniqueEnumArray(fallback.authoritativeDecisionOrigins, FALLBACK_DECISION_ORIGIN, "policyPack.fallbackReviewPolicy.authoritativeDecisionOrigins");
  if (!fallback.decisionValues.includes(fallback.positiveDecision)) policyError("fallback positiveDecision must be an allowed decision");
  if (fallback.negativeDecisionRequiresConcreteInformationNeed !== true) policyError("schema 1.1 fallback review requires a concrete InformationNeed for further measures");
  assertReferenceExists(fallback.candidateCollectionActionTemplateId, context.actionTemplates,
    "policyPack.fallbackReviewPolicy.candidateCollectionActionTemplateId", "action template");

  const orchestration = policyPack.resolutionOrchestrationPolicy;
  assertPlainObject(orchestration, "policyPack.resolutionOrchestrationPolicy");
  assertAllowedKeys(orchestration, [
    "terminalPrecedence",
    "engineNonTerminalState",
    "provisionalRequirementIds",
    "specialistReviewRequirementIds",
    "customerProjectionStates",
    "pscDiscrepancyStates",
    "riskSignalTypes",
  ], "policyPack.resolutionOrchestrationPolicy");
  validateUniqueEnumArray(orchestration.terminalPrecedence, TERMINAL_OUTCOME, "policyPack.resolutionOrchestrationPolicy.terminalPrecedence");
  if (orchestration.engineNonTerminalState !== "IN_PROGRESS") policyError("schema 1.1 engine non-terminal state must be IN_PROGRESS");
  ["provisionalRequirementIds", "specialistReviewRequirementIds"].forEach((field) => {
    assertUniqueStrings(orchestration[field], `policyPack.resolutionOrchestrationPolicy.${field}`);
    orchestration[field].forEach((requirementId, index) => assertReferenceExists(
      requirementId,
      context.requirements,
      `policyPack.resolutionOrchestrationPolicy.${field}[${index}]`,
      "requirement",
    ));
  });
  assertUniqueStrings(orchestration.customerProjectionStates, "policyPack.resolutionOrchestrationPolicy.customerProjectionStates");
  assertUniqueStrings(orchestration.pscDiscrepancyStates, "policyPack.resolutionOrchestrationPolicy.pscDiscrepancyStates");
  assertUniqueStrings(orchestration.riskSignalTypes, "policyPack.resolutionOrchestrationPolicy.riskSignalTypes");
  const approvedRiskSignals = new Set(orchestration.riskSignalTypes);
  policyPack.requirements.forEach((requirement, requirementIndex) => {
    (requirement.riskSignals || []).forEach((signal, signalIndex) => {
      assertNonEmptyString(signal.emit, `policyPack.requirements[${requirementIndex}].riskSignals[${signalIndex}].emit`);
      if (!approvedRiskSignals.has(signal.emit)) {
        policyError(`policyPack.requirements[${requirementIndex}].riskSignals[${signalIndex}].emit is not approved by resolutionOrchestrationPolicy`);
      }
    });
  });
}

function validateSubmissionContract(contract, path) {
  assertPlainObject(contract, path);
  assertAllowedKeys(contract, [
    "factType", "concept", "relationshipType", "direction", "target",
    "allowedMeasurementTypes", "temporalMeaning",
  ], path);
  assertEnum(contract.factType, ACTION_SUBMISSION_FACT_TYPE, `${path}.factType`);
  assertNonEmptyString(contract.concept, `${path}.concept`);
  assertEnum(contract.relationshipType, RELATIONSHIP_TYPE, `${path}.relationshipType`);
  assertEnum(contract.direction, ACTION_SUBMISSION_DIRECTION, `${path}.direction`);
  assertEnum(contract.target, ACTION_SUBMISSION_TARGET, `${path}.target`);
  validateUniqueEnumArray(contract.allowedMeasurementTypes, PERCENTAGE_VALUE_TYPE, `${path}.allowedMeasurementTypes`);
  if (contract.temporalMeaning !== "CURRENT") {
    policyError(`${path}.temporalMeaning must equal CURRENT`);
  }
}

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

function validateActionTemplates(actionTemplates, sourceTraceability, schemaVersion) {
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
  const successorDecisions = sourceTraceability?.successorPolicyDecisions || [];
  assertArray(successorDecisions, "policyPack.sourceTraceability.successorPolicyDecisions");
  const successorBySemanticId = new Map(successorDecisions.map((decision, index) => {
    const path = `policyPack.sourceTraceability.successorPolicyDecisions[${index}]`;
    assertPlainObject(decision, path);
    assertAllowedKeys(decision, [
      "semanticId", "source", "decisionDate", "supersedesUnresolvedReference",
    ], path);
    ["semanticId", "source", "decisionDate", "supersedesUnresolvedReference"].forEach((field) => {
      assertNonEmptyString(decision[field], `${path}.${field}`);
    });
    return [decision.semanticId, decision];
  }));
  assertUniqueStrings([...successorBySemanticId.keys()], "policyPack successor-policy semantic identifiers");

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

    if (template.contentStatus !== ACTION_CONTENT_STATUS.UNRESOLVED_SOURCE_REFERENCE) {
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
      if (template.contentStatus === ACTION_CONTENT_STATUS.CONTROL_ROOM_APPROVED) {
        if (schemaVersion !== "1.2") {
          policyError(`Control Room-approved action template ${actionId} requires Policy Pack schema 1.2`);
        }
        validateSubmissionContract(
          template.submissionContract,
          `policyPack.actionTemplates.${actionId}.submissionContract`,
        );
        assertPlainObject(template.sourceDecision, `policyPack.actionTemplates.${actionId}.sourceDecision`);
        assertAllowedKeys(template.sourceDecision, [
          "source", "decisionDate", "supersedesUnresolvedReference",
        ], `policyPack.actionTemplates.${actionId}.sourceDecision`);
        if (template.sourceDecision.source !== "CONTROL_ROOM_SUCCESSOR_POLICY") {
          policyError(`policyPack.actionTemplates.${actionId}.sourceDecision.source must equal CONTROL_ROOM_SUCCESSOR_POLICY`);
        }
        assertNonEmptyString(template.sourceDecision.decisionDate, `policyPack.actionTemplates.${actionId}.sourceDecision.decisionDate`);
        assertNonEmptyString(template.sourceDecision.supersedesUnresolvedReference,
          `policyPack.actionTemplates.${actionId}.sourceDecision.supersedesUnresolvedReference`);
        if (!sameSuccessorDecision(successorBySemanticId.get(actionId), template.sourceDecision)) {
          policyError(`Control Room-approved action template ${actionId} has inconsistent successor-policy provenance`);
        }
      } else if (template.submissionContract !== undefined || template.sourceDecision !== undefined) {
        policyError(`Only Control Room-approved action template ${actionId} may carry schema 1.2 submission governance`);
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
  successorBySemanticId.forEach((_decision, actionId) => {
    if (actionTemplates[actionId]?.contentStatus !== ACTION_CONTENT_STATUS.CONTROL_ROOM_APPROVED) {
      policyError(`Successor-policy decision ${actionId} does not reference a Control Room-approved action template`);
    }
  });

  return new Set(actionIds);
}

function sameSuccessorDecision(traceabilityDecision, templateDecision) {
  if (!traceabilityDecision) return false;
  return traceabilityDecision.source === templateDecision.source
    && traceabilityDecision.decisionDate === templateDecision.decisionDate
    && traceabilityDecision.supersedesUnresolvedReference === templateDecision.supersedesUnresolvedReference;
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
    if (!SUPPORTED_POLICY_PACK_SCHEMA_VERSIONS.has(policyPack.schemaVersion)) {
      policyError(
        `policyPack.schemaVersion must be one of: ${[...SUPPORTED_POLICY_PACK_SCHEMA_VERSIONS].join(", ")}`,
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
    const actionTemplates = validateActionTemplates(
      policyPack.actionTemplates,
      policyPack.sourceTraceability,
      policyPack.schemaVersion,
    );
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
    context.requirements = new Set(policyPack.requirements.map(({ requirementId }) => requirementId));
    validateRoleProjection(policyPack.roleProjection);
    validateEmbeddedReferences(policyPack, context);
    validateSchema11Orchestration(policyPack, context);

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
