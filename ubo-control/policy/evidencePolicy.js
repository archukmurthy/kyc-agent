"use strict";

const { createHash } = require("node:crypto");
const {
  RESOLUTION_EFFECT,
  RESOLUTION_STRATEGY,
  RISK_LEVEL,
} = require("../contracts/constants");
const { validateEvidenceReference } = require("../contracts/evidenceReference");
const { validateOwnershipCase } = require("../domain/ownershipCase");
const {
  assertAllowedKeys,
  assertArray,
  assertDataOnly,
  assertEnum,
  assertNonEmptyString,
  assertOptionalNonEmptyString,
  assertPlainObject,
  cloneData,
  deepFreeze,
  fail,
} = require("../internal/validation");
const { canonicalizeJson } = require("./canonicalJson");
const { POLICY_TRUTH_VALUE, evaluateConditionExpression } = require("./conditionEvaluator");
const { hashPolicyPack, validatePolicyPack } = require("./policyPack");

const EVIDENCE_CLASSIFICATION_STATUS = Object.freeze({
  CLASSIFIED: "CLASSIFIED",
  UNCLASSIFIED: "UNCLASSIFIED",
});

const EVIDENCE_SOURCE_ORIGIN = Object.freeze({
  INDEPENDENT_OF_APPLICANT: "INDEPENDENT_OF_APPLICANT",
  APPLICANT_ORIGINATED: "APPLICANT_ORIGINATED",
  UNKNOWN: "UNKNOWN",
});

const EVIDENCE_CURRENT_STATE = Object.freeze({
  CURRENT: "CURRENT",
  HISTORICAL: "HISTORICAL",
  CEASED: "CEASED",
  UNKNOWN: "UNKNOWN",
});

const EVIDENCE_SUPPORT_DIRECTION = Object.freeze({
  POSITIVE: "POSITIVE",
  NEGATIVE: "NEGATIVE",
});

const EVIDENCE_SUFFICIENCY_STATUS = Object.freeze({
  SUFFICIENT: "SUFFICIENT",
  INSUFFICIENT: "INSUFFICIENT",
  INDETERMINATE: "INDETERMINATE",
});

function digest(value) {
  return createHash("sha256").update(canonicalizeJson(value)).digest("hex");
}

function validateTimestamp(value, path) {
  assertNonEmptyString(value, path);
  if (Number.isNaN(Date.parse(value))) fail(`${path} must be an ISO-compatible timestamp`);
}

function policyIdentity(loadedPolicyPack) {
  assertPlainObject(loadedPolicyPack, "loadedPolicyPack");
  assertPlainObject(loadedPolicyPack.policyPack, "loadedPolicyPack.policyPack");
  assertPlainObject(loadedPolicyPack.identity, "loadedPolicyPack.identity");
  validatePolicyPack(loadedPolicyPack.policyPack);
  const actualHash = hashPolicyPack(loadedPolicyPack.policyPack);
  if (loadedPolicyPack.identity.hash !== actualHash) fail("loadedPolicyPack.identity.hash must match canonical policy content", "POLICY_CONFIGURATION_ERROR");
  const identity = {
    policyPackId: loadedPolicyPack.policyPack.policyPackId,
    policyVersion: loadedPolicyPack.policyPack.version,
    policyHash: actualHash,
    policySchemaVersion: loadedPolicyPack.policyPack.schemaVersion,
  };
  if (loadedPolicyPack.identity.policyPackId !== identity.policyPackId
    || loadedPolicyPack.identity.version !== identity.policyVersion
    || loadedPolicyPack.identity.schemaVersion !== identity.policySchemaVersion) {
    fail("loadedPolicyPack.identity must match canonical policy content", "POLICY_CONFIGURATION_ERROR");
  }
  return identity;
}

function durableEvidenceIdentity(reference) {
  validateEvidenceReference(reference);
  return {
    ...(reference.system !== undefined ? { system: reference.system } : {}),
    ...(reference.namespace !== undefined ? { namespace: reference.namespace } : {}),
    referenceType: reference.referenceType,
    referenceId: reference.referenceId,
  };
}

function evidenceReferencesInCase(caseState) {
  return [
    ...caseState.candidateClaims.flatMap(({ evidenceReferences }) => evidenceReferences),
    ...caseState.claimAdjudications.flatMap(({ supportingEvidenceReferences }) => supportingEvidenceReferences),
    ...caseState.capabilityOperations.flatMap(({ operationEvidenceReferences }) => operationEvidenceReferences),
    ...caseState.identityDecisions.flatMap(({ evidenceReferences }) => evidenceReferences),
  ];
}

function requireCaseEvidenceReference(caseState, reference) {
  const identity = canonicalizeJson(reference);
  if (!evidenceReferencesInCase(caseState)
    .some((candidate) => canonicalizeJson(candidate) === identity)) {
    fail("evidence classification reference is not present in the OwnershipCase revision");
  }
}

function validateSupport(support, path, policyPack) {
  assertPlainObject(support, path);
  assertAllowedKeys(support, [
    "requirementId",
    "direction",
    "policyFactKey",
    "resolutionStrategy",
    "concept",
    "subjectEntityId",
    "relationshipId",
    "attribute",
    "basisAssessmentIds",
    "claimIds",
  ], path);
  assertNonEmptyString(support.requirementId, `${path}.requirementId`);
  if (!policyPack.requirements.some(({ requirementId }) => requirementId === support.requirementId)) {
    fail(`${path}.requirementId is not present in the Policy Pack`);
  }
  assertEnum(support.direction, EVIDENCE_SUPPORT_DIRECTION, `${path}.direction`);
  assertEnum(support.resolutionStrategy, RESOLUTION_STRATEGY, `${path}.resolutionStrategy`);
  assertOptionalNonEmptyString(support.policyFactKey, `${path}.policyFactKey`);
  assertOptionalNonEmptyString(support.concept, `${path}.concept`);
  assertOptionalNonEmptyString(support.subjectEntityId, `${path}.subjectEntityId`);
  assertOptionalNonEmptyString(support.relationshipId, `${path}.relationshipId`);
  assertOptionalNonEmptyString(support.attribute, `${path}.attribute`);
  ["basisAssessmentIds", "claimIds"].forEach((field) => {
    assertArray(support[field] || [], `${path}.${field}`);
    (support[field] || []).forEach((value, index) => assertNonEmptyString(value, `${path}.${field}[${index}]`));
  });
}

function classificationPayload(record) {
  const { classificationId, durableEvidenceId, ...payload } = record;
  return payload;
}

function createEvidencePolicyClassification({ loadedPolicyPack, caseState, input }) {
  const identity = policyIdentity(loadedPolicyPack);
  validateOwnershipCase(caseState);
  assertPlainObject(input, "evidencePolicyClassificationInput");
  assertAllowedKeys(input, [
    "evidenceReference",
    "evidenceCatalogueKey",
    "sourceOrigin",
    "capturedAt",
    "sourceEffectiveAt",
    "currentState",
    "classificationBasis",
    "supports",
  ], "evidencePolicyClassificationInput");
  validateEvidenceReference(input.evidenceReference, "evidencePolicyClassificationInput.evidenceReference");
  requireCaseEvidenceReference(caseState, input.evidenceReference);
  assertOptionalNonEmptyString(input.evidenceCatalogueKey, "evidencePolicyClassificationInput.evidenceCatalogueKey");
  assertEnum(input.sourceOrigin, EVIDENCE_SOURCE_ORIGIN, "evidencePolicyClassificationInput.sourceOrigin");
  if (input.capturedAt !== undefined) validateTimestamp(input.capturedAt, "evidencePolicyClassificationInput.capturedAt");
  if (input.sourceEffectiveAt !== undefined) validateTimestamp(input.sourceEffectiveAt, "evidencePolicyClassificationInput.sourceEffectiveAt");
  if (input.currentState !== undefined) assertEnum(input.currentState, EVIDENCE_CURRENT_STATE, "evidencePolicyClassificationInput.currentState");
  assertPlainObject(input.classificationBasis, "evidencePolicyClassificationInput.classificationBasis");
  assertNonEmptyString(input.classificationBasis.origin, "evidencePolicyClassificationInput.classificationBasis.origin");
  assertDataOnly(input.classificationBasis, "evidencePolicyClassificationInput.classificationBasis");
  assertArray(input.supports, "evidencePolicyClassificationInput.supports");
  input.supports.forEach((support, index) => validateSupport(support, `evidencePolicyClassificationInput.supports[${index}]`, loadedPolicyPack.policyPack));

  const catalogueItem = loadedPolicyPack.policyPack.evidenceCatalogue.items
    .find(({ key }) => key === input.evidenceCatalogueKey);
  const record = {
    policyIdentity: identity,
    caseReference: { caseId: caseState.caseId, revisionId: caseState.revisionId, revision: caseState.revision },
    evidenceReference: cloneData(input.evidenceReference),
    classificationStatus: catalogueItem
      ? EVIDENCE_CLASSIFICATION_STATUS.CLASSIFIED
      : EVIDENCE_CLASSIFICATION_STATUS.UNCLASSIFIED,
    sourceOrigin: input.sourceOrigin,
    classificationBasis: cloneData(input.classificationBasis),
    supports: cloneData(input.supports).map((support) => ({
      ...support,
      basisAssessmentIds: [...new Set(support.basisAssessmentIds || [])].sort(),
      claimIds: [...new Set(support.claimIds || [])].sort(),
    })).sort((left, right) => canonicalizeJson(left).localeCompare(canonicalizeJson(right))),
  };
  if (input.evidenceCatalogueKey !== undefined) record.evidenceCatalogueKey = input.evidenceCatalogueKey;
  if (catalogueItem) {
    record.policyCharacteristics = {
      authority: catalogueItem.authority,
      defaultStrength: catalogueItem.defaultStrength,
      for: cloneData(catalogueItem.for),
      ...(catalogueItem.maxAgeRef ? { maxAgeRef: catalogueItem.maxAgeRef } : {}),
    };
  } else {
    record.unclassifiedReasonCode = input.evidenceCatalogueKey
      ? "EVIDENCE_CATALOGUE_ITEM_NOT_FOUND"
      : "EVIDENCE_CATALOGUE_KEY_NOT_SUPPLIED";
  }
  if (input.capturedAt !== undefined) record.capturedAt = input.capturedAt;
  if (input.sourceEffectiveAt !== undefined) record.sourceEffectiveAt = input.sourceEffectiveAt;
  if (input.currentState !== undefined) record.currentState = input.currentState;
  record.durableEvidenceId = `evidence-source:${digest(durableEvidenceIdentity(record.evidenceReference))}`;
  record.classificationId = `evidence-classification:${digest(classificationPayload(record))}`;
  return deepFreeze(record);
}

function validateEvidencePolicyClassification(record, { loadedPolicyPack, caseState }) {
  assertPlainObject(record, "evidencePolicyClassification");
  assertAllowedKeys(record, [
    "classificationId",
    "durableEvidenceId",
    "policyIdentity",
    "caseReference",
    "evidenceReference",
    "classificationStatus",
    "evidenceCatalogueKey",
    "policyCharacteristics",
    "unclassifiedReasonCode",
    "sourceOrigin",
    "capturedAt",
    "sourceEffectiveAt",
    "currentState",
    "classificationBasis",
    "supports",
  ], "evidencePolicyClassification");
  const identity = policyIdentity(loadedPolicyPack);
  validateOwnershipCase(caseState);
  assertNonEmptyString(record.classificationId, "evidencePolicyClassification.classificationId");
  assertNonEmptyString(record.durableEvidenceId, "evidencePolicyClassification.durableEvidenceId");
  if (canonicalizeJson(record.policyIdentity) !== canonicalizeJson(identity)) fail("evidence classification Policy Pack identity mismatch");
  if (record.caseReference.caseId !== caseState.caseId
    || record.caseReference.revisionId !== caseState.revisionId
    || record.caseReference.revision !== caseState.revision) fail("evidence classification case revision mismatch");
  validateEvidenceReference(record.evidenceReference, "evidencePolicyClassification.evidenceReference");
  requireCaseEvidenceReference(caseState, record.evidenceReference);
  assertEnum(record.classificationStatus, EVIDENCE_CLASSIFICATION_STATUS, "evidencePolicyClassification.classificationStatus");
  assertEnum(record.sourceOrigin, EVIDENCE_SOURCE_ORIGIN, "evidencePolicyClassification.sourceOrigin");
  if (record.capturedAt !== undefined) validateTimestamp(record.capturedAt, "evidencePolicyClassification.capturedAt");
  if (record.sourceEffectiveAt !== undefined) validateTimestamp(record.sourceEffectiveAt, "evidencePolicyClassification.sourceEffectiveAt");
  if (record.currentState !== undefined) assertEnum(record.currentState, EVIDENCE_CURRENT_STATE, "evidencePolicyClassification.currentState");
  assertPlainObject(record.classificationBasis, "evidencePolicyClassification.classificationBasis");
  assertNonEmptyString(record.classificationBasis.origin, "evidencePolicyClassification.classificationBasis.origin");
  assertDataOnly(record.classificationBasis, "evidencePolicyClassification.classificationBasis");
  assertArray(record.supports, "evidencePolicyClassification.supports");
  record.supports.forEach((support, index) => validateSupport(support, `evidencePolicyClassification.supports[${index}]`, loadedPolicyPack.policyPack));
  const item = loadedPolicyPack.policyPack.evidenceCatalogue.items.find(({ key }) => key === record.evidenceCatalogueKey);
  const expectedStatus = item ? EVIDENCE_CLASSIFICATION_STATUS.CLASSIFIED : EVIDENCE_CLASSIFICATION_STATUS.UNCLASSIFIED;
  if (record.classificationStatus !== expectedStatus) fail("evidence classification status does not match Policy Pack catalogue");
  if (item) {
    const expectedCharacteristics = {
      authority: item.authority,
      defaultStrength: item.defaultStrength,
      for: cloneData(item.for),
      ...(item.maxAgeRef ? { maxAgeRef: item.maxAgeRef } : {}),
    };
    if (canonicalizeJson(record.policyCharacteristics) !== canonicalizeJson(expectedCharacteristics)) {
      fail("evidence classification policy characteristics do not match the pinned catalogue item");
    }
    if (record.unclassifiedReasonCode !== undefined) fail("classified evidence cannot carry an unclassified reason");
  } else {
    const expectedReason = record.evidenceCatalogueKey
      ? "EVIDENCE_CATALOGUE_ITEM_NOT_FOUND"
      : "EVIDENCE_CATALOGUE_KEY_NOT_SUPPLIED";
    if (record.unclassifiedReasonCode !== expectedReason || record.policyCharacteristics !== undefined) {
      fail("unclassified evidence must preserve its deterministic classification reason");
    }
  }
  if (record.durableEvidenceId !== `evidence-source:${digest(durableEvidenceIdentity(record.evidenceReference))}`) {
    fail("evidence classification durable source identity mismatch");
  }
  if (record.classificationId !== `evidence-classification:${digest(classificationPayload(record))}`) {
    fail("evidence classification identity mismatch");
  }
  return true;
}

function addUtcMonths(timestamp, months) {
  const date = new Date(timestamp);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + months;
  const targetYear = year + Math.floor(month / 12);
  const targetMonth = ((month % 12) + 12) % 12;
  const finalDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return new Date(Date.UTC(
    targetYear,
    targetMonth,
    Math.min(date.getUTCDate(), finalDay),
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
    date.getUTCMilliseconds(),
  ));
}

function minimumStrength(policyPack, requirement, riskLevel) {
  if (!requirement.minStrengthRef && !requirement.minStrengthByRisk) return { value: 0 };
  assertEnum(riskLevel, RISK_LEVEL, "riskLevel");
  if (requirement.minStrengthByRisk) return { value: requirement.minStrengthByRisk[riskLevel], source: "requirement.minStrengthByRisk" };
  const parameter = policyPack.parameters[requirement.minStrengthRef];
  if (!parameter || typeof parameter.value !== "object" || typeof parameter.value[riskLevel] !== "number") {
    fail(`${requirement.minStrengthRef} does not configure strength for ${riskLevel}`, "POLICY_CONFIGURATION_ERROR");
  }
  return { value: parameter.value[riskLevel], parameterRef: requirement.minStrengthRef };
}

function policyStrategyFor(requirement, support, catalogueKey, conditionContext) {
  const candidates = requirement.resolutionStrategies.filter((strategy) => strategy.strategy === support.resolutionStrategy
    && (strategy.evidence === catalogueKey || strategy.evidence === undefined));
  const exact = candidates.filter(({ evidence }) => evidence === catalogueKey);
  const ordered = exact.length > 0 ? exact : candidates.filter(({ evidence }) => evidence === undefined);
  return ordered.find((strategy) => !strategy.condition
    || evaluateConditionExpression(strategy.condition, conditionContext) === POLICY_TRUTH_VALUE.TRUE);
}

function riskAtOrBelow(actual, maximum) {
  const order = { LOW: 1, MEDIUM: 2, HIGH: 3 };
  return order[actual] <= order[maximum];
}

function assessItem({ classification, support, item, requirement, policyPack, conditionContext, evaluationDate, riskLevel, direction, minimum }) {
  if (!item) {
    return {
      classificationId: classification.classificationId,
      durableEvidenceId: classification.durableEvidenceId,
      classificationStatus: EVIDENCE_CLASSIFICATION_STATUS.UNCLASSIFIED,
      eligible: false,
      reasonCodes: [classification.unclassifiedReasonCode || "UNCLASSIFIED_FOR_POLICY"],
    };
  }
  const strategy = policyStrategyFor(requirement, support, item.key, conditionContext);
  const factRule = support.policyFactKey && item.factRules ? item.factRules[support.policyFactKey] : undefined;
  let effect = strategy?.resolutionEffect || factRule?.resolutionEffect;
  if (!effect
    && support.resolutionStrategy === RESOLUTION_STRATEGY.CUSTOMER_ATTESTATION
    && requirement.attestation?.allowed === true
    && direction === EVIDENCE_SUPPORT_DIRECTION.NEGATIVE) {
    effect = RESOLUTION_EFFECT.POSITIVE_OR_NEGATIVE;
  }
  let canResolveAlone = factRule?.canResolveAlone;
  if (canResolveAlone === undefined) canResolveAlone = item.canResolveAlone;
  if (support.policyFactKey === "ownership_structure" && item.canResolveControllingLayerAlone !== undefined) {
    canResolveAlone = item.canResolveControllingLayerAlone;
  }
  if (canResolveAlone === "REQUIREMENT_DEFINED") canResolveAlone = effect !== RESOLUTION_EFFECT.CORROBORATIVE_ONLY;
  if (canResolveAlone === undefined) canResolveAlone = effect !== RESOLUTION_EFFECT.CORROBORATIVE_ONLY;
  const corroborationRequired = factRule?.corroborationRequired === true
    || item.corroborationRequired === true
    || item.canResolveControllingLayerAlone === false;
  const reasonCodes = [];
  if (!strategy) reasonCodes.push("RESOLUTION_STRATEGY_NOT_PERMITTED_FOR_EVIDENCE");
  if (!effect) reasonCodes.push("RESOLUTION_EFFECT_NOT_CONFIGURED");
  const effectAllowsDirection = direction === EVIDENCE_SUPPORT_DIRECTION.POSITIVE
    ? [RESOLUTION_EFFECT.POSITIVE_ONLY, RESOLUTION_EFFECT.POSITIVE_OR_NEGATIVE, RESOLUTION_EFFECT.CORROBORATIVE_ONLY].includes(effect)
    : effect === RESOLUTION_EFFECT.POSITIVE_OR_NEGATIVE;
  if (!effectAllowsDirection) reasonCodes.push(direction === EVIDENCE_SUPPORT_DIRECTION.NEGATIVE
    ? "EVIDENCE_EFFECT_CANNOT_PROVE_NEGATIVE"
    : "EVIDENCE_EFFECT_CANNOT_SUPPORT_POSITIVE");
  let attestationPermitted = true;
  if (support.resolutionStrategy === RESOLUTION_STRATEGY.CUSTOMER_ATTESTATION) {
    const maximumRisk = requirement.attestation?.maxRiskLevel
      || policyPack.parameters[requirement.attestation?.maxRiskRef]?.value;
    attestationPermitted = requirement.attestation?.allowed === true
      && typeof maximumRisk === "string"
      && riskAtOrBelow(riskLevel, maximumRisk);
    if (!attestationPermitted) reasonCodes.push("ATTESTATION_NOT_PERMITTED_AT_CURRENT_RISK");
  }
  const meetsStrength = item.defaultStrength >= minimum.value;
  if (!meetsStrength) reasonCodes.push("INDIVIDUAL_EVIDENCE_BELOW_MINIMUM_STRENGTH");
  let currentEnough = classification.currentState === EVIDENCE_CURRENT_STATE.CURRENT;
  if (!currentEnough) reasonCodes.push(classification.currentState
    ? "EVIDENCE_NOT_CURRENT"
    : "EVIDENCE_CURRENT_STATE_NOT_ESTABLISHED");
  if (item.maxAgeRef) {
    const maxAge = policyPack.parameters[item.maxAgeRef]?.value;
    const sourceDate = classification.sourceEffectiveAt || classification.capturedAt;
    if (typeof maxAge !== "number" || !sourceDate) {
      currentEnough = false;
      reasonCodes.push("EVIDENCE_FRESHNESS_NOT_ESTABLISHED");
    } else if (addUtcMonths(sourceDate, maxAge).getTime() < new Date(evaluationDate).getTime()) {
      currentEnough = false;
      reasonCodes.push("EVIDENCE_STALE_UNDER_POLICY");
    }
  }
  return {
    classificationId: classification.classificationId,
    durableEvidenceId: classification.durableEvidenceId,
    classificationStatus: classification.classificationStatus,
    evidenceCatalogueKey: item.key,
    sourceOrigin: classification.sourceOrigin,
    defaultStrength: item.defaultStrength,
    resolutionEffect: effect,
    canResolveAlone,
    corroborationRequired,
    meetsStrength,
    effectAllowsDirection,
    currentEnough,
    eligible: Boolean(strategy && effect && meetsStrength && effectAllowsDirection && currentEnough && attestationPermitted),
    reasonCodes,
  };
}

function assessEvidenceSufficiency({
  loadedPolicyPack,
  caseState,
  requirementId,
  classifications,
  conditionContext,
  evaluationDate,
  riskLevel,
  direction,
  supportFilter = () => true,
  independentCorroboration = false,
}) {
  const identity = policyIdentity(loadedPolicyPack);
  validateOwnershipCase(caseState);
  validateTimestamp(evaluationDate, "evaluationDate");
  assertEnum(direction, EVIDENCE_SUPPORT_DIRECTION, "evidenceDirection");
  assertArray(classifications, "evidenceClassifications");
  classifications.forEach((classification) => validateEvidencePolicyClassification(classification, { loadedPolicyPack, caseState }));
  const policyPack = loadedPolicyPack.policyPack;
  const requirement = policyPack.requirements.find((candidate) => candidate.requirementId === requirementId);
  if (!requirement) fail(`unknown requirement ${requirementId}`);
  const minimum = minimumStrength(policyPack, requirement, riskLevel);
  const assessments = [];
  classifications.forEach((classification) => {
    classification.supports
      .filter((support) => support.requirementId === requirementId
        && support.direction === direction
        && supportFilter(support))
      .forEach((support) => {
        const item = policyPack.evidenceCatalogue.items.find(({ key }) => key === classification.evidenceCatalogueKey);
        assessments.push(assessItem({
          classification,
          support,
          item,
          requirement,
          policyPack,
          conditionContext,
          evaluationDate,
          riskLevel,
          direction,
          minimum,
        }));
      });
  });
  const bySource = new Map();
  assessments.forEach((assessment) => {
    const existing = bySource.get(assessment.durableEvidenceId);
    if (!existing || (!existing.eligible && assessment.eligible)) bySource.set(assessment.durableEvidenceId, assessment);
  });
  const distinct = [...bySource.values()];
  const eligible = distinct.filter(({ eligible: qualifies }) => qualifies);
  const independent = eligible.filter(({ sourceOrigin }) => sourceOrigin === EVIDENCE_SOURCE_ORIGIN.INDEPENDENT_OF_APPLICANT);
  const configuredIndependentCount = policyPack.parameters.required_independent_ownership_corroboration_sources?.value;
  let sufficient;
  const reasonCodes = [];
  if (independentCorroboration) {
    if (!Number.isSafeInteger(configuredIndependentCount) || configuredIndependentCount < 1) {
      fail("required independent corroboration source count must be a positive integer", "POLICY_CONFIGURATION_ERROR");
    }
    sufficient = independent.length >= configuredIndependentCount;
    if (!sufficient) reasonCodes.push("DISTINCT_INDEPENDENT_SOURCE_COUNT_BELOW_POLICY_MINIMUM");
  } else {
    const establishing = eligible.filter(({ resolutionEffect }) => resolutionEffect !== RESOLUTION_EFFECT.CORROBORATIVE_ONLY);
    const alone = establishing.some(({ canResolveAlone, corroborationRequired }) => canResolveAlone === true && !corroborationRequired);
    const supportedCombination = establishing.length > 0 && eligible.length >= 2;
    sufficient = alone || supportedCombination;
    if (eligible.length === 0) reasonCodes.push("NO_INDIVIDUAL_EVIDENCE_ITEM_MEETS_POLICY_RULES");
    else if (establishing.length === 0) reasonCodes.push("CORROBORATIVE_EVIDENCE_CANNOT_ESTABLISH_UNDERLYING_FACT_ALONE");
    else if (!sufficient) reasonCodes.push("EVIDENCE_CANNOT_RESOLVE_ALONE_OR_REQUIRED_CORROBORATION_MISSING");
  }
  const result = {
    policyIdentity: identity,
    requirementId,
    status: sufficient ? EVIDENCE_SUFFICIENCY_STATUS.SUFFICIENT : EVIDENCE_SUFFICIENCY_STATUS.INSUFFICIENT,
    direction,
    minimumStrength: minimum,
    consideredEvidence: assessments.sort((left, right) => left.classificationId.localeCompare(right.classificationId)),
    distinctEligibleSourceIds: eligible.map(({ durableEvidenceId }) => durableEvidenceId).sort(),
    distinctIndependentSourceIds: independent.map(({ durableEvidenceId }) => durableEvidenceId).sort(),
    reasonCodes,
  };
  return deepFreeze(result);
}

module.exports = {
  EVIDENCE_CLASSIFICATION_STATUS,
  EVIDENCE_CURRENT_STATE,
  EVIDENCE_SOURCE_ORIGIN,
  EVIDENCE_SUFFICIENCY_STATUS,
  EVIDENCE_SUPPORT_DIRECTION,
  assessEvidenceSufficiency,
  createEvidencePolicyClassification,
  durableEvidenceIdentity,
  validateEvidencePolicyClassification,
};
