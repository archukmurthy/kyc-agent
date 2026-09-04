"use strict";

const { createHash } = require("node:crypto");
const { UboContractError } = require("../errors");
const {
  assertDataOnly,
  assertNonEmptyString,
  assertPlainObject,
  cloneData,
  deepFreeze,
} = require("../internal/validation");
const { canonicalizeJson } = require("../policy/canonicalJson");

const QUALIFICATION_BASIS_VERSION = "ubo-qualification-basis-v2";

const QUALIFICATION_ROUTE = Object.freeze({
  MANAGEMENT_CONTROL: "MANAGEMENT_CONTROL",
  EFFECTIVE_INTEREST: "EFFECTIVE_INTEREST",
  PSC_CONDITION_ATTRIBUTION: "PSC_CONDITION_ATTRIBUTION",
});

const QUALIFICATION_CLASSIFICATION = Object.freeze({
  STATUTORY: "STATUTORY",
  FIRM_POLICY: "FIRM_POLICY",
});

const QUALIFICATION_ASSESSMENT_STATE = Object.freeze({
  SATISFIED: "SATISFIED",
  NOT_SATISFIED: "NOT_SATISFIED",
  INDETERMINATE: "INDETERMINATE",
  REVIEW_REQUIRED: "REVIEW_REQUIRED",
});

const QUALIFICATION_DIRECTNESS = Object.freeze({
  DIRECT: "DIRECT",
  INDIRECT: "INDIRECT",
  DIRECT_AND_INDIRECT: "DIRECT_AND_INDIRECT",
  NOT_ESTABLISHED: "NOT_ESTABLISHED",
});

const QUALIFICATION_BASIS_ERROR_CODE = Object.freeze({
  INVALID_BASIS: "INVALID_QUALIFICATION_BASIS_V2",
  INVALID_INPUT: "INVALID_EFFECTIVE_INTEREST_QUALIFICATION_INPUT",
  INVALID_POLICY_PACK: "INVALID_EFFECTIVE_INTEREST_POLICY_PACK",
  POLICY_IDENTITY_REQUIRED: "EFFECTIVE_INTEREST_POLICY_IDENTITY_REQUIRED",
  POLICY_IDENTITY_MISMATCH: "EFFECTIVE_INTEREST_POLICY_IDENTITY_MISMATCH",
  UNSUPPORTED_POLICY_SCHEMA: "UNSUPPORTED_EFFECTIVE_INTEREST_POLICY_SCHEMA",
  ROUTE_NOT_DECLARED: "EFFECTIVE_INTEREST_ROUTE_NOT_DECLARED",
  UNSUPPORTED_ROUTE_METHOD: "UNSUPPORTED_EFFECTIVE_INTEREST_ROUTE_METHOD",
  UNSUPPORTED_ROUTE_METHOD_STATUS: "UNSUPPORTED_EFFECTIVE_INTEREST_METHOD_STATUS",
  DIMENSION_NOT_DECLARED: "EFFECTIVE_INTEREST_DIMENSION_NOT_DECLARED",
  MALFORMED_THRESHOLD: "MALFORMED_EFFECTIVE_INTEREST_THRESHOLD",
  UNSAFE_FIRM_THRESHOLD: "UNSAFE_FIRM_COLLECTION_THRESHOLD",
  INCONSISTENT_CALCULATION: "INCONSISTENT_EFFECTIVE_INTEREST_CALCULATION",
  INELIGIBLE_HOLDER: "INELIGIBLE_QUALIFICATION_BASIS_HOLDER",
});

class QualificationBasisV2Error extends UboContractError {
  constructor(message, { code = QUALIFICATION_BASIS_ERROR_CODE.INVALID_BASIS, details, cause } = {}) {
    super(message, { code, cause });
    if (details !== undefined) this.details = deepFreeze(cloneData(details));
  }
}

function basisError(message, code = QUALIFICATION_BASIS_ERROR_CODE.INVALID_BASIS, details) {
  throw new QualificationBasisV2Error(message, { code, details });
}

function assertVocabulary(value, vocabulary, path) {
  if (!Object.values(vocabulary).includes(value)) {
    basisError(`${path} must be one of: ${Object.values(vocabulary).join(", ")}`);
  }
}

function validateThresholdDescriptor(threshold, record, path) {
  assertPlainObject(threshold, path);
  if (typeof threshold.value !== "number" || !Number.isFinite(threshold.value)
    || threshold.value < 0 || threshold.value > 100) {
    basisError(`${path}.value must be a finite percentage`);
  }
  if (![">", ">="].includes(threshold.comparator)) basisError(`${path}.comparator must be > or >=`);
  if (threshold.classification !== record.classification) {
    basisError(`${path}.classification must match the basis classification`);
  }
  ["sourceClassification", "legalBasis", "policyFieldReference", "dimension"].forEach((field) => {
    assertNonEmptyString(threshold[field], `${path}.${field}`);
  });
  if (record.dimension !== threshold.dimension) basisError(`${path}.dimension must match the basis dimension`);
}

function digest(value) {
  return createHash("sha256").update(canonicalizeJson(value), "utf8").digest("hex");
}

// Deliberately excludes evidence/support recording metadata. The basis identity
// covers only the decision semantics pinned by policy, case, graph and calculation.
function qualificationBasisIdentity(record) {
  const identity = {
    basisSchemaVersion: record.basisSchemaVersion,
    policyIdentity: record.policyIdentity,
    graphReference: record.graphReference,
    personEntityId: record.personEntityId,
    holderCategory: record.holderCategory,
    targetEntityId: record.targetEntityId,
    route: record.route,
    classification: record.classification,
    directness: record.directness,
    method: record.method,
    methodStatus: record.methodStatus,
    methodVersion: record.methodVersion,
    assessmentState: record.assessmentState,
    reasonCode: record.reasonCode,
    orderedPathReferences: record.orderedPathReferences,
  };
  if (record.caseReference !== undefined) identity.caseReference = record.caseReference;
  if (record.dimension !== undefined) identity.dimension = record.dimension;
  if (record.condition !== undefined) identity.condition = record.condition;
  if (record.threshold !== undefined) identity.threshold = record.threshold;
  if (record.calculationReference !== undefined) identity.calculationReference = record.calculationReference;
  if (record.recordedCalculation !== undefined) identity.recordedCalculation = record.recordedCalculation;
  if (record.targetRightReferences !== undefined) identity.targetRightReferences = record.targetRightReferences;
  if (record.aggregatedTargetRightValue !== undefined) identity.aggregatedTargetRightValue = record.aggregatedTargetRightValue;
  if (record.attributionChains !== undefined) identity.attributionChains = record.attributionChains;
  if (record.workingAssumptionRef !== undefined) identity.workingAssumptionRef = record.workingAssumptionRef;
  return identity;
}

function validateQualificationBasisV2(record, path = "qualificationBasisV2") {
  try {
    assertPlainObject(record, path);
    assertDataOnly(record, path);
    if (record.basisSchemaVersion !== QUALIFICATION_BASIS_VERSION) {
      basisError(`${path}.basisSchemaVersion must equal ${QUALIFICATION_BASIS_VERSION}`);
    }
    assertNonEmptyString(record.basisId, `${path}.basisId`);
    assertPlainObject(record.policyIdentity, `${path}.policyIdentity`);
    ["policyPackId", "version", "schemaVersion", "canonicalHash"].forEach((field) => {
      assertNonEmptyString(record.policyIdentity[field], `${path}.policyIdentity.${field}`);
    });
    assertPlainObject(record.graphReference, `${path}.graphReference`);
    assertNonEmptyString(record.graphReference.graphVersion, `${path}.graphReference.graphVersion`);
    assertNonEmptyString(record.graphReference.graphFingerprint, `${path}.graphReference.graphFingerprint`);
    assertNonEmptyString(record.personEntityId, `${path}.personEntityId`);
    if (record.holderCategory !== "NATURAL_PERSON") basisError(`${path}.holderCategory must equal NATURAL_PERSON`);
    assertNonEmptyString(record.targetEntityId, `${path}.targetEntityId`);
    assertVocabulary(record.route, QUALIFICATION_ROUTE, `${path}.route`);
    assertVocabulary(record.classification, QUALIFICATION_CLASSIFICATION, `${path}.classification`);
    assertVocabulary(record.directness, QUALIFICATION_DIRECTNESS, `${path}.directness`);
    assertVocabulary(record.assessmentState, QUALIFICATION_ASSESSMENT_STATE, `${path}.assessmentState`);
    ["method", "methodStatus", "methodVersion", "reasonCode"].forEach((field) => {
      assertNonEmptyString(record[field], `${path}.${field}`);
    });
    if (record.dimension !== undefined) {
      if (!["ECONOMIC", "VOTING"].includes(record.dimension)) {
        basisError(`${path}.dimension must be ECONOMIC or VOTING`);
      }
    }
    if (record.condition !== undefined) assertNonEmptyString(record.condition, `${path}.condition`);
    if (record.threshold !== undefined) validateThresholdDescriptor(record.threshold, record, `${path}.threshold`);
    if (record.calculationReference !== undefined) assertPlainObject(record.calculationReference, `${path}.calculationReference`);
    if (record.recordedCalculation !== undefined) assertPlainObject(record.recordedCalculation, `${path}.recordedCalculation`);
    if (record.route === QUALIFICATION_ROUTE.EFFECTIVE_INTEREST) {
      assertNonEmptyString(record.dimension, `${path}.dimension`);
      assertPlainObject(record.threshold, `${path}.threshold`);
      assertPlainObject(record.calculationReference, `${path}.calculationReference`);
      assertPlainObject(record.recordedCalculation, `${path}.recordedCalculation`);
    }
    ["orderedPathReferences", "relationshipReferences", "operativeClaimReferences", "evidenceReferences", "reviewDependencies"]
      .forEach((field) => {
        if (!Array.isArray(record[field])) basisError(`${path}.${field} must be an array`);
      });
    if (record.targetRightReferences !== undefined && !Array.isArray(record.targetRightReferences)) {
      basisError(`${path}.targetRightReferences must be an array`);
    }
    if (record.attributionChains !== undefined && !Array.isArray(record.attributionChains)) {
      basisError(`${path}.attributionChains must be an array`);
    }
    if (record.aggregatedTargetRightValue !== undefined) {
      assertPlainObject(record.aggregatedTargetRightValue, `${path}.aggregatedTargetRightValue`);
    }
    if (record.governance !== undefined) assertPlainObject(record.governance, `${path}.governance`);
    if (record.workingAssumptionRef !== undefined) {
      assertNonEmptyString(record.workingAssumptionRef, `${path}.workingAssumptionRef`);
    }
    assertPlainObject(record.policyRequirement, `${path}.policyRequirement`);
    const expectedId = `${QUALIFICATION_BASIS_VERSION}:${digest(qualificationBasisIdentity(record)).slice(0, 32)}`;
    if (record.basisId !== expectedId) basisError(`${path}.basisId does not match its semantic identity`);
    return true;
  } catch (error) {
    if (error instanceof QualificationBasisV2Error) throw error;
    throw new QualificationBasisV2Error(error.message, {
      code: QUALIFICATION_BASIS_ERROR_CODE.INVALID_BASIS,
      cause: error,
    });
  }
}

function createQualificationBasisV2(input) {
  try {
    assertPlainObject(input, "qualificationBasisV2Input");
    assertDataOnly(input, "qualificationBasisV2Input");
    const record = cloneData({ ...input, basisSchemaVersion: QUALIFICATION_BASIS_VERSION });
    delete record.basisId;
    record.basisId = `${QUALIFICATION_BASIS_VERSION}:${digest(qualificationBasisIdentity(record)).slice(0, 32)}`;
    validateQualificationBasisV2(record);
    return deepFreeze(record);
  } catch (error) {
    if (error instanceof QualificationBasisV2Error) throw error;
    throw new QualificationBasisV2Error(error.message, {
      code: QUALIFICATION_BASIS_ERROR_CODE.INVALID_BASIS,
      cause: error,
    });
  }
}

module.exports = {
  QUALIFICATION_ASSESSMENT_STATE,
  QUALIFICATION_BASIS_ERROR_CODE,
  QUALIFICATION_BASIS_VERSION,
  QUALIFICATION_CLASSIFICATION,
  QUALIFICATION_DIRECTNESS,
  QUALIFICATION_ROUTE,
  QualificationBasisV2Error,
  createQualificationBasisV2,
  qualificationBasisIdentity,
  validateQualificationBasisV2,
};
