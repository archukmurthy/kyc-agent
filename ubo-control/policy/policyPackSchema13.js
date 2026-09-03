"use strict";

const {
  assertAllowedKeys,
  assertArray,
  assertEnum,
  assertFinitePercentage,
  assertNonEmptyString,
  assertPlainObject,
  assertUniqueStrings,
} = require("../internal/validation");

const SIGNOFF_STATUS = Object.freeze({
  OPEN: "OPEN",
  RESEARCH_COMPLETE_SIGNOFF_PENDING: "RESEARCH_COMPLETE_SIGNOFF_PENDING",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  DEFERRED: "DEFERRED",
  WATCH: "WATCH",
});

const POLICY_RELEASE_STATUS = Object.freeze({
  CONTROL_ROOM_REVIEW: "CONTROL_ROOM_REVIEW",
  PRODUCTION_APPROVED: "PRODUCTION_APPROVED",
  RETIRED: "RETIRED",
});

const PERCENTAGE_EVIDENCE_STATE = Object.freeze({
  DECLARED_EXACT: "DECLARED_EXACT",
  INDEPENDENT_BAND_CORROBORATED: "INDEPENDENT_BAND_CORROBORATED",
  EXACT_VALUE_VERIFIED: "EXACT_VALUE_VERIFIED",
});

const PHASE = Object.freeze({
  BASE_APPLICABILITY: "BASE_APPLICABILITY",
  CANONICAL_GRAPH_AND_DEPTH: "CANONICAL_GRAPH_AND_DEPTH",
  CALCULATIONS_AND_ATTRIBUTIONS: "CALCULATIONS_AND_ATTRIBUTIONS",
  QUALIFICATION: "QUALIFICATION",
  DERIVED_REQUIREMENT_APPLICABILITY: "DERIVED_REQUIREMENT_APPLICABILITY",
  EVIDENCE_SUFFICIENCY: "EVIDENCE_SUFFICIENCY",
  INFORMATION_NEEDS: "INFORMATION_NEEDS",
  RESOLUTION_PLANNING: "RESOLUTION_PLANNING",
  DECISION_SNAPSHOT: "DECISION_SNAPSHOT",
});

const SCHEMA_13_FIELDS = Object.freeze([
  "legalBaseline",
  "productionReadiness",
  "signoffs",
  "qualificationDoctrine",
  "statutoryThresholds",
  "firmCollectionThreshold",
  "firmLayerHolderCollection",
  "layerCompletenessDoctrine",
  "percentageEvidenceStates",
  "declaredExactWithinIndependentBand",
  "controlActionGating",
  "residualConfirmationBundle",
  "listedTreatment",
  "exhaustionMeasureCategories",
  "allowedDispositions",
  "reasonRequiredForNonExecuted",
  "authorisedExhaustionDecisionOrigins",
  "structureAcquisition",
  "phasedEvaluationOrder",
]);

function requireFields(value, fields, path) {
  const missing = fields.filter((field) => !Object.prototype.hasOwnProperty.call(value, field));
  if (missing.length > 0) throw new TypeError(`${path} is missing required field(s): ${missing.join(", ")}`);
}

function assertBoolean(value, path) {
  if (typeof value !== "boolean") throw new TypeError(`${path} must be a boolean`);
}

function assertDateString(value, path) {
  assertNonEmptyString(value, path);
  if (Number.isNaN(Date.parse(value))) throw new TypeError(`${path} must be a valid ISO-compatible date or timestamp`);
}

function assertStringArray(value, path) {
  assertUniqueStrings(value, path);
}

function validateAuthority(value, path) {
  assertPlainObject(value, path);
  assertAllowedKeys(value, ["identity", "capacity"], path);
  requireFields(value, ["identity", "capacity"], path);
  assertNonEmptyString(value.identity, `${path}.identity`);
  assertNonEmptyString(value.capacity, `${path}.capacity`);
}

function validateLegalBaseline(value) {
  const path = "policyPack.legalBaseline";
  assertPlainObject(value, path);
  const fields = ["statute", "supervisorProfile", "pscInterpretationProfile", "transitionalGuidanceNote", "deltaMemoRef"];
  assertAllowedKeys(value, fields, path);
  requireFields(value, fields, path);
  fields.forEach((field) => assertNonEmptyString(value[field], `${path}.${field}`));
}

function validateEffectivePeriod(value) {
  const path = "policyPack.effectivePeriod";
  assertPlainObject(value, path);
  assertAllowedKeys(value, ["from", "to"], path);
  requireFields(value, ["from"], path);
  if (value.from !== null) assertDateString(value.from, `${path}.from`);
  if (value.to !== undefined && value.to !== null) assertDateString(value.to, `${path}.to`);
  if (value.from !== null && value.to !== undefined && value.to !== null
    && Date.parse(value.to) <= Date.parse(value.from)) {
    throw new TypeError(`${path}.to must be later than from`);
  }
}

function validateSignoffs(signoffs) {
  const path = "policyPack.signoffs";
  assertArray(signoffs, path);
  const identifiers = signoffs.map((signoff, index) => {
    const itemPath = `${path}[${index}]`;
    assertPlainObject(signoff, itemPath);
    assertAllowedKeys(signoff, [
      "signoffId", "status", "scope", "productionBlocking", "decisionReference",
      "evidenceReference", "approver", "approvedAt", "effectiveFrom",
    ], itemPath);
    requireFields(signoff, ["signoffId", "status", "scope", "productionBlocking"], itemPath);
    assertNonEmptyString(signoff.signoffId, `${itemPath}.signoffId`);
    assertEnum(signoff.status, SIGNOFF_STATUS, `${itemPath}.status`);
    assertNonEmptyString(signoff.scope, `${itemPath}.scope`);
    assertBoolean(signoff.productionBlocking, `${itemPath}.productionBlocking`);
    ["decisionReference", "evidenceReference"].forEach((field) => {
      if (signoff[field] !== undefined) assertNonEmptyString(signoff[field], `${itemPath}.${field}`);
    });
    if (signoff.status === SIGNOFF_STATUS.APPROVED) {
      requireFields(signoff, ["approver", "approvedAt", "effectiveFrom"], itemPath);
      validateAuthority(signoff.approver, `${itemPath}.approver`);
      assertDateString(signoff.approvedAt, `${itemPath}.approvedAt`);
      assertDateString(signoff.effectiveFrom, `${itemPath}.effectiveFrom`);
    } else if (signoff.approver !== undefined || signoff.approvedAt !== undefined || signoff.effectiveFrom !== undefined) {
      throw new TypeError(`${itemPath} may carry approval identity and dates only when status is APPROVED`);
    }
    return signoff.signoffId;
  });
  assertUniqueStrings(identifiers, "policyPack signoff identifiers");
  return new Set(identifiers);
}

function validateProductionReadiness(value, knownSignoffs) {
  const path = "policyPack.productionReadiness";
  assertPlainObject(value, path);
  const fields = ["releaseStatus", "approvingAuthority", "mandatorySignoffIds", "features", "requiredAlgorithms"];
  assertAllowedKeys(value, fields, path);
  requireFields(value, fields, path);
  assertEnum(value.releaseStatus, POLICY_RELEASE_STATUS, `${path}.releaseStatus`);
  if (value.approvingAuthority !== null) validateAuthority(value.approvingAuthority, `${path}.approvingAuthority`);
  assertStringArray(value.mandatorySignoffIds, `${path}.mandatorySignoffIds`);
  value.mandatorySignoffIds.forEach((signoffId) => {
    if (!knownSignoffs.has(signoffId)) throw new TypeError(`${path}.mandatorySignoffIds references unknown signoff ${signoffId}`);
  });

  assertArray(value.features, `${path}.features`);
  const featureIds = value.features.map((feature, index) => {
    const itemPath = `${path}.features[${index}]`;
    assertPlainObject(feature, itemPath);
    assertAllowedKeys(feature, ["featureId", "enabled", "requiredSignoffIds"], itemPath);
    requireFields(feature, ["featureId", "enabled", "requiredSignoffIds"], itemPath);
    assertNonEmptyString(feature.featureId, `${itemPath}.featureId`);
    assertBoolean(feature.enabled, `${itemPath}.enabled`);
    assertStringArray(feature.requiredSignoffIds, `${itemPath}.requiredSignoffIds`);
    feature.requiredSignoffIds.forEach((signoffId) => {
      if (!knownSignoffs.has(signoffId)) throw new TypeError(`${itemPath}.requiredSignoffIds references unknown signoff ${signoffId}`);
    });
    return feature.featureId;
  });
  assertUniqueStrings(featureIds, "policyPack production feature identifiers");

  assertArray(value.requiredAlgorithms, `${path}.requiredAlgorithms`);
  const algorithmIds = value.requiredAlgorithms.map((algorithm, index) => {
    const itemPath = `${path}.requiredAlgorithms[${index}]`;
    assertPlainObject(algorithm, itemPath);
    assertAllowedKeys(algorithm, ["algorithmId", "version"], itemPath);
    requireFields(algorithm, ["algorithmId", "version"], itemPath);
    assertNonEmptyString(algorithm.algorithmId, `${itemPath}.algorithmId`);
    assertNonEmptyString(algorithm.version, `${itemPath}.version`);
    return algorithm.algorithmId;
  });
  assertUniqueStrings(algorithmIds, "policyPack required algorithm identifiers");
}

function validateQualificationDoctrine(value, knownSignoffs) {
  const path = "policyPack.qualificationDoctrine";
  assertPlainObject(value, path);
  assertAllowedKeys(value, ["personQualifiesWhen", "recordAllQualifyingBases", "routes"], path);
  requireFields(value, ["personQualifiesWhen", "recordAllQualifyingBases", "routes"], path);
  assertNonEmptyString(value.personQualifiesWhen, `${path}.personQualifiesWhen`);
  assertBoolean(value.recordAllQualifyingBases, `${path}.recordAllQualifyingBases`);
  assertArray(value.routes, `${path}.routes`);
  const routeIds = value.routes.map((route, index) => {
    const itemPath = `${path}.routes[${index}]`;
    assertPlainObject(route, itemPath);
    assertAllowedKeys(route, [
      "id", "legalBasis", "method", "methodStatus", "dimensions", "conditions",
      "indirectAttribution", "approvalState", "signoffId",
    ], itemPath);
    requireFields(route, ["id", "legalBasis", "method"], itemPath);
    ["id", "legalBasis", "method"].forEach((field) => assertNonEmptyString(route[field], `${itemPath}.${field}`));
    ["methodStatus", "indirectAttribution", "approvalState"].forEach((field) => {
      if (route[field] !== undefined) assertNonEmptyString(route[field], `${itemPath}.${field}`);
    });
    ["dimensions", "conditions"].forEach((field) => {
      if (route[field] !== undefined) assertStringArray(route[field], `${itemPath}.${field}`);
    });
    if (route.signoffId !== undefined) {
      assertNonEmptyString(route.signoffId, `${itemPath}.signoffId`);
      if (!knownSignoffs.has(route.signoffId)) throw new TypeError(`${itemPath}.signoffId references unknown signoff ${route.signoffId}`);
    }
    return route.id;
  });
  assertUniqueStrings(routeIds, "policyPack qualification route identifiers");
}

function validateThreshold(value, path) {
  assertPlainObject(value, path);
  assertAllowedKeys(value, ["value", "comparator", "classification", "legalBasis"], path);
  requireFields(value, ["value", "comparator", "classification", "legalBasis"], path);
  assertFinitePercentage(value.value, `${path}.value`);
  if (![">", ">="].includes(value.comparator)) throw new TypeError(`${path}.comparator must be > or >=`);
  assertNonEmptyString(value.classification, `${path}.classification`);
  assertNonEmptyString(value.legalBasis, `${path}.legalBasis`);
}

function validateStatutoryThresholds(value) {
  const path = "policyPack.statutoryThresholds";
  assertPlainObject(value, path);
  assertAllowedKeys(value, ["economic", "voting"], path);
  requireFields(value, ["economic", "voting"], path);
  validateThreshold(value.economic, `${path}.economic`);
  validateThreshold(value.voting, `${path}.voting`);
}

function validateFirmCollectionThreshold(value) {
  const path = "policyPack.firmCollectionThreshold";
  assertPlainObject(value, path);
  const fields = ["enabled", "value", "comparator", "classification", "projectedRole", "neverProjectsStatutoryRole"];
  assertAllowedKeys(value, fields, path);
  requireFields(value, fields, path);
  assertBoolean(value.enabled, `${path}.enabled`);
  if (value.value !== null) assertFinitePercentage(value.value, `${path}.value`);
  if (value.comparator !== null && ![">", ">="].includes(value.comparator)) throw new TypeError(`${path}.comparator must be null, > or >=`);
  if (value.enabled && (value.value === null || value.comparator === null)) throw new TypeError(`${path} requires value and comparator when enabled`);
  assertNonEmptyString(value.classification, `${path}.classification`);
  assertNonEmptyString(value.projectedRole, `${path}.projectedRole`);
  assertBoolean(value.neverProjectsStatutoryRole, `${path}.neverProjectsStatutoryRole`);
  if (value.neverProjectsStatutoryRole !== true) throw new TypeError(`${path}.neverProjectsStatutoryRole must be true`);
}

function validateFirmLayerHolderCollection(value) {
  const path = "policyPack.firmLayerHolderCollection";
  assertPlainObject(value, path);
  const fields = ["status", "enabled", "requiresFirmSop", "projectedRole"];
  assertAllowedKeys(value, fields, path);
  requireFields(value, fields, path);
  assertNonEmptyString(value.status, `${path}.status`);
  assertBoolean(value.enabled, `${path}.enabled`);
  assertBoolean(value.requiresFirmSop, `${path}.requiresFirmSop`);
  assertNonEmptyString(value.projectedRole, `${path}.projectedRole`);
}

function validateLayerCompletenessDoctrine(value) {
  const path = "policyPack.layerCompletenessDoctrine";
  assertPlainObject(value, path);
  const fields = ["scope", "closureMethod", "outputs", "qualifiers", "precisionEscalation"];
  assertAllowedKeys(value, fields, path);
  requireFields(value, fields, path);
  ["scope", "closureMethod", "precisionEscalation"].forEach((field) => assertNonEmptyString(value[field], `${path}.${field}`));
  assertStringArray(value.outputs, `${path}.outputs`);
  assertStringArray(value.qualifiers, `${path}.qualifiers`);
}

function validateDeclaredExact(value) {
  const path = "policyPack.declaredExactWithinIndependentBand";
  assertPlainObject(value, path);
  const fields = ["result", "exactValueVerification", "sufficiencyByRisk", "outsideBand"];
  assertAllowedKeys(value, fields, path);
  requireFields(value, fields, path);
  assertNonEmptyString(value.result, `${path}.result`);
  assertBoolean(value.exactValueVerification, `${path}.exactValueVerification`);
  assertNonEmptyString(value.sufficiencyByRisk, `${path}.sufficiencyByRisk`);
  assertNonEmptyString(value.outsideBand, `${path}.outsideBand`);
}

function validateControlActionGating(value) {
  const path = "policyPack.controlActionGating";
  assertPlainObject(value, path);
  assertAllowedKeys(value, ["assessAtRegulatedSubject", "intermediaryControlNeedWhen", "numericCustomerControlQuestions"], path);
  requireFields(value, ["assessAtRegulatedSubject", "intermediaryControlNeedWhen", "numericCustomerControlQuestions"], path);
  assertNonEmptyString(value.assessAtRegulatedSubject, `${path}.assessAtRegulatedSubject`);
  assertStringArray(value.intermediaryControlNeedWhen, `${path}.intermediaryControlNeedWhen`);
  const questionsPath = `${path}.numericCustomerControlQuestions`;
  assertPlainObject(value.numericCustomerControlQuestions, questionsPath);
  assertAllowedKeys(value.numericCustomerControlQuestions, ["mode", "conditions"], questionsPath);
  requireFields(value.numericCustomerControlQuestions, ["mode", "conditions"], questionsPath);
  assertNonEmptyString(value.numericCustomerControlQuestions.mode, `${questionsPath}.mode`);
  assertStringArray(value.numericCustomerControlQuestions.conditions, `${questionsPath}.conditions`);
}

function validateResidualConfirmationBundle(value) {
  const path = "policyPack.residualConfirmationBundle";
  assertPlainObject(value, path);
  assertAllowedKeys(value, ["presentation", "availability", "statements", "independentStatementResults"], path);
  requireFields(value, ["presentation", "availability", "statements", "independentStatementResults"], path);
  assertNonEmptyString(value.presentation, `${path}.presentation`);
  assertBoolean(value.independentStatementResults, `${path}.independentStatementResults`);
  const availabilityPath = `${path}.availability`;
  assertPlainObject(value.availability, availabilityPath);
  assertAllowedKeys(value.availability, ["maximumRisk", "requiresStructureSufficientlyUnderstood", "blockedByPositiveContrarySignal"], availabilityPath);
  requireFields(value.availability, ["maximumRisk", "requiresStructureSufficientlyUnderstood", "blockedByPositiveContrarySignal"], availabilityPath);
  assertNonEmptyString(value.availability.maximumRisk, `${availabilityPath}.maximumRisk`);
  assertBoolean(value.availability.requiresStructureSufficientlyUnderstood, `${availabilityPath}.requiresStructureSufficientlyUnderstood`);
  assertBoolean(value.availability.blockedByPositiveContrarySignal, `${availabilityPath}.blockedByPositiveContrarySignal`);
  assertArray(value.statements, `${path}.statements`);
  const statementIds = value.statements.map((statement, index) => {
    const itemPath = `${path}.statements[${index}]`;
    assertPlainObject(statement, itemPath);
    assertAllowedKeys(statement, ["id", "resolvesRequirement", "resolvesQualifier", "contentStatus"], itemPath);
    requireFields(statement, ["id", "contentStatus"], itemPath);
    assertNonEmptyString(statement.id, `${itemPath}.id`);
    assertNonEmptyString(statement.contentStatus, `${itemPath}.contentStatus`);
    const targets = [statement.resolvesRequirement, statement.resolvesQualifier].filter((item) => item !== undefined);
    if (targets.length !== 1) throw new TypeError(`${itemPath} must resolve exactly one requirement or qualifier`);
    assertNonEmptyString(targets[0], `${itemPath}.resolutionTarget`);
    return statement.id;
  });
  assertUniqueStrings(statementIds, "policyPack residual statement identifiers");
}

function validateListedRoute(value, path, fields) {
  assertPlainObject(value, path);
  assertAllowedKeys(value, fields, path);
  requireFields(value, fields, path);
  Object.entries(value).forEach(([field, item]) => {
    if (field === "enabled" || field.startsWith("requires") && typeof item === "boolean") assertBoolean(item, `${path}.${field}`);
    else if (Array.isArray(item)) assertStringArray(item, `${path}.${field}`);
    else assertNonEmptyString(item, `${path}.${field}`);
  });
}

function validateListedTreatment(value) {
  const path = "policyPack.listedTreatment";
  assertPlainObject(value, path);
  const fields = ["customerListed", "customerConsolidatedSubsidiaryOfListed", "intermediateListedParentTerminus"];
  assertAllowedKeys(value, fields, path);
  requireFields(value, fields, path);
  validateListedRoute(value.customerListed, `${path}.customerListed`, ["status", "authority", "requires", "route"]);
  validateListedRoute(value.customerConsolidatedSubsidiaryOfListed, `${path}.customerConsolidatedSubsidiaryOfListed`, ["status", "authority", "requires"]);
  validateListedRoute(value.intermediateListedParentTerminus, `${path}.intermediateListedParentTerminus`, ["enabled", "status", "requiresMarketList", "requiresListingAndDisclosureEvidence"]);
}

function validateStructureAcquisition(value) {
  const path = "policyPack.structureAcquisition";
  assertPlainObject(value, path);
  const fields = ["allowedStrategies", "chartIsCandidateStructureNotProof", "permittedStructureEvidence"];
  assertAllowedKeys(value, fields, path);
  requireFields(value, fields, path);
  assertStringArray(value.allowedStrategies, `${path}.allowedStrategies`);
  assertBoolean(value.chartIsCandidateStructureNotProof, `${path}.chartIsCandidateStructureNotProof`);
  assertStringArray(value.permittedStructureEvidence, `${path}.permittedStructureEvidence`);
}

function validatePolicyPackSchema13(policyPack) {
  requireFields(policyPack, SCHEMA_13_FIELDS, "policyPack");
  validateEffectivePeriod(policyPack.effectivePeriod);
  validateLegalBaseline(policyPack.legalBaseline);
  const signoffs = validateSignoffs(policyPack.signoffs);
  validateProductionReadiness(policyPack.productionReadiness, signoffs);
  validateQualificationDoctrine(policyPack.qualificationDoctrine, signoffs);
  validateStatutoryThresholds(policyPack.statutoryThresholds);
  validateFirmCollectionThreshold(policyPack.firmCollectionThreshold);
  validateFirmLayerHolderCollection(policyPack.firmLayerHolderCollection);
  validateLayerCompletenessDoctrine(policyPack.layerCompletenessDoctrine);
  assertArray(policyPack.percentageEvidenceStates, "policyPack.percentageEvidenceStates");
  policyPack.percentageEvidenceStates.forEach((state, index) => assertEnum(state, PERCENTAGE_EVIDENCE_STATE, `policyPack.percentageEvidenceStates[${index}]`));
  assertUniqueStrings(policyPack.percentageEvidenceStates, "policyPack.percentageEvidenceStates");
  validateDeclaredExact(policyPack.declaredExactWithinIndependentBand);
  validateControlActionGating(policyPack.controlActionGating);
  validateResidualConfirmationBundle(policyPack.residualConfirmationBundle);
  validateListedTreatment(policyPack.listedTreatment);
  assertStringArray(policyPack.exhaustionMeasureCategories, "policyPack.exhaustionMeasureCategories");
  assertStringArray(policyPack.allowedDispositions, "policyPack.allowedDispositions");
  assertBoolean(policyPack.reasonRequiredForNonExecuted, "policyPack.reasonRequiredForNonExecuted");
  assertStringArray(policyPack.authorisedExhaustionDecisionOrigins, "policyPack.authorisedExhaustionDecisionOrigins");
  validateStructureAcquisition(policyPack.structureAcquisition);
  assertArray(policyPack.phasedEvaluationOrder, "policyPack.phasedEvaluationOrder");
  policyPack.phasedEvaluationOrder.forEach((phase, index) => assertEnum(phase, PHASE, `policyPack.phasedEvaluationOrder[${index}]`));
  assertUniqueStrings(policyPack.phasedEvaluationOrder, "policyPack.phasedEvaluationOrder");
  return true;
}

module.exports = {
  POLICY_RELEASE_STATUS,
  SIGNOFF_STATUS,
  validatePolicyPackSchema13,
};
