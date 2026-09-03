"use strict";

const { createHash } = require("node:crypto");
const { PERCENTAGE_VALUE_TYPE } = require("../contracts/constants");
const { validateEvidenceReference } = require("../contracts/evidenceReference");
const { CANONICAL_ENTITY_CATEGORY } = require("../domain/canonicalEntity");
const { compare, decimalNumberToRational } = require("../domain/exactPercentage");
const { GRAPH_DIMENSION } = require("../domain/ownershipGraph");
const { CALCULATION_ALGORITHM, CALCULATION_STATUS } = require("../domain/percentageCalculation");
const {
  QUALIFICATION_ASSESSMENT_STATE,
  QUALIFICATION_BASIS_ERROR_CODE,
  QUALIFICATION_CLASSIFICATION,
  QUALIFICATION_DIRECTNESS,
  QUALIFICATION_ROUTE,
  QualificationBasisV2Error,
  createQualificationBasisV2,
} = require("../domain/qualificationBasisV2");
const {
  assertDataOnly,
  assertNonEmptyString,
  assertPlainObject,
  cloneData,
  deepFreeze,
} = require("../internal/validation");
const { canonicalizeJson } = require("./canonicalJson");
const { hashPolicyPack, validatePolicyPack } = require("./policyPack");

const EFFECTIVE_INTEREST_QUALIFICATION_VERSION = "ubo-effective-interest-qualification-v2";
const EFFECTIVE_INTEREST_METHOD_STATUS = "ADOPTED_INTERPRETATION";
const ALL_QUALIFICATION_ROUTES = Object.freeze([
  QUALIFICATION_ROUTE.MANAGEMENT_CONTROL,
  QUALIFICATION_ROUTE.EFFECTIVE_INTEREST,
  QUALIFICATION_ROUTE.PSC_CONDITION_ATTRIBUTION,
]);

function qualificationError(message, code, details, cause) {
  throw new QualificationBasisV2Error(message, { code, details, cause });
}

function hash(value) {
  return createHash("sha256").update(canonicalizeJson(value), "utf8").digest("hex");
}

function canonicalSort(values) {
  return cloneData(values).sort((left, right) => canonicalizeJson(left).localeCompare(canonicalizeJson(right)));
}

function uniqueStrings(values) {
  return [...new Set(values || [])].sort();
}

function normalizeCaseReference(caseRevision) {
  if (caseRevision === undefined) return undefined;
  if (Number.isSafeInteger(caseRevision) && caseRevision > 0) return { revision: caseRevision };
  assertPlainObject(caseRevision, "caseRevision");
  const reference = {};
  if (caseRevision.caseId !== undefined) {
    assertNonEmptyString(caseRevision.caseId, "caseRevision.caseId");
    reference.caseId = caseRevision.caseId;
  }
  if (!Number.isSafeInteger(caseRevision.revision) || caseRevision.revision < 1) {
    qualificationError("caseRevision.revision must be a positive safe integer", QUALIFICATION_BASIS_ERROR_CODE.INVALID_INPUT);
  }
  reference.revision = caseRevision.revision;
  if (caseRevision.revisionId !== undefined) {
    assertNonEmptyString(caseRevision.revisionId, "caseRevision.revisionId");
    reference.revisionId = caseRevision.revisionId;
  }
  return reference;
}

function validatedPolicy(loadedPolicyPack) {
  if (!loadedPolicyPack || typeof loadedPolicyPack !== "object" || !loadedPolicyPack.policyPack || !loadedPolicyPack.identity) {
    qualificationError(
      "effective-interest qualification requires a loaded Policy Pack with exact identity",
      QUALIFICATION_BASIS_ERROR_CODE.POLICY_IDENTITY_REQUIRED,
    );
  }
  const { policyPack, identity } = loadedPolicyPack;
  try {
    validatePolicyPack(policyPack);
  } catch (cause) {
    qualificationError("effective-interest qualification received an invalid Policy Pack", QUALIFICATION_BASIS_ERROR_CODE.INVALID_POLICY_PACK, undefined, cause);
  }
  if (policyPack.schemaVersion !== "1.3") {
    qualificationError("effective-interest qualification requires Policy Pack schema 1.3", QUALIFICATION_BASIS_ERROR_CODE.UNSUPPORTED_POLICY_SCHEMA);
  }
  const canonicalHash = hashPolicyPack(policyPack);
  const expectedIdentity = {
    schemaId: policyPack.schemaId,
    schemaVersion: policyPack.schemaVersion,
    policyPackId: policyPack.policyPackId,
    version: policyPack.version,
    hash: canonicalHash,
  };
  if (Object.entries(expectedIdentity).some(([field, value]) => identity[field] !== value)) {
    qualificationError("loaded Policy Pack identity does not match its canonical content", QUALIFICATION_BASIS_ERROR_CODE.POLICY_IDENTITY_MISMATCH);
  }
  return {
    policyPack,
    policyIdentity: {
      policyPackId: policyPack.policyPackId,
      version: policyPack.version,
      schemaVersion: policyPack.schemaVersion,
      canonicalHash,
    },
  };
}

function decimal(value, path) {
  if ((typeof value !== "number" && typeof value !== "string") || String(value).trim() === "") {
    qualificationError(`${path} must be a decimal percentage`, QUALIFICATION_BASIS_ERROR_CODE.INCONSISTENT_CALCULATION);
  }
  let rational;
  try {
    rational = decimalNumberToRational(value);
  } catch (cause) {
    qualificationError(`${path} must be a decimal percentage`, QUALIFICATION_BASIS_ERROR_CODE.INCONSISTENT_CALCULATION, undefined, cause);
  }
  if (compare(rational, decimalNumberToRational(0)) < 0 || compare(rational, decimalNumberToRational(100)) > 0) {
    qualificationError(`${path} must be between 0 and 100`, QUALIFICATION_BASIS_ERROR_CODE.INCONSISTENT_CALCULATION);
  }
  return rational;
}

function normalizeCalculatedValue(value, path) {
  assertPlainObject(value, path);
  if (value.type === PERCENTAGE_VALUE_TYPE.EXACT) {
    decimal(value.value, `${path}.value`);
    return { type: value.type, value: String(value.value) };
  }
  if (value.type === PERCENTAGE_VALUE_TYPE.RANGE) {
    const lower = decimal(value.lowerBound, `${path}.lowerBound`);
    const upper = decimal(value.upperBound, `${path}.upperBound`);
    if (compare(lower, upper) > 0 || typeof value.lowerInclusive !== "boolean" || typeof value.upperInclusive !== "boolean") {
      qualificationError(`${path} is not a valid percentage range`, QUALIFICATION_BASIS_ERROR_CODE.INCONSISTENT_CALCULATION);
    }
    if (compare(lower, upper) === 0 && (!value.lowerInclusive || !value.upperInclusive)) {
      qualificationError(`${path} must not describe an empty range`, QUALIFICATION_BASIS_ERROR_CODE.INCONSISTENT_CALCULATION);
    }
    return {
      type: value.type,
      lowerBound: String(value.lowerBound),
      upperBound: String(value.upperBound),
      lowerInclusive: value.lowerInclusive,
      upperInclusive: value.upperInclusive,
    };
  }
  if (value.type === PERCENTAGE_VALUE_TYPE.UNKNOWN) {
    return value.reason === undefined ? { type: value.type } : { type: value.type, reason: String(value.reason) };
  }
  qualificationError(`${path}.type is unsupported`, QUALIFICATION_BASIS_ERROR_CODE.INCONSISTENT_CALCULATION);
}

function normalizePath(path, state, pathName) {
  assertPlainObject(path, pathName);
  assertNonEmptyString(path.pathId, `${pathName}.pathId`);
  if (!Array.isArray(path.relationshipIds) || path.relationshipIds.length === 0) {
    qualificationError(`${pathName}.relationshipIds must identify an ordered path`, QUALIFICATION_BASIS_ERROR_CODE.INCONSISTENT_CALCULATION);
  }
  path.relationshipIds.forEach((id, index) => assertNonEmptyString(id, `${pathName}.relationshipIds[${index}]`));
  const normalized = { pathId: path.pathId, state, relationshipIds: cloneData(path.relationshipIds) };
  if (state === "KNOWN") normalized.contribution = normalizeCalculatedValue(path.contribution, `${pathName}.contribution`);
  if (state === "UNRESOLVED") {
    if (!Array.isArray(path.reasons) || path.reasons.length === 0) {
      qualificationError(`${pathName}.reasons must identify why the path is unresolved`, QUALIFICATION_BASIS_ERROR_CODE.INCONSISTENT_CALCULATION);
    }
    normalized.reasons = uniqueStrings(path.reasons.map((reason, index) => {
      assertNonEmptyString(reason, `${pathName}.reasons[${index}]`);
      return reason;
    }));
  }
  return normalized;
}

function normalizeRelationshipSupport(calculation, pathReferences) {
  const ids = new Set(pathReferences.flatMap(({ relationshipIds }) => relationshipIds));
  const supplied = calculation.relationshipReferences || [];
  if (!Array.isArray(supplied)) qualificationError("calculationResult.relationshipReferences must be an array", QUALIFICATION_BASIS_ERROR_CODE.INCONSISTENT_CALCULATION);
  const byId = new Map([...ids].map((relationshipId) => [relationshipId, {
    relationshipId,
    supportingClaimIds: [],
    evidenceReferences: [],
  }]));
  supplied.forEach((reference, index) => {
    assertPlainObject(reference, `calculationResult.relationshipReferences[${index}]`);
    assertNonEmptyString(reference.relationshipId, `calculationResult.relationshipReferences[${index}].relationshipId`);
    if (!ids.has(reference.relationshipId)) {
      qualificationError("calculation support references a relationship outside its recorded paths", QUALIFICATION_BASIS_ERROR_CODE.INCONSISTENT_CALCULATION);
    }
    const supportingClaimIds = reference.supportingClaimIds || [];
    const evidenceReferences = reference.evidenceReferences || [];
    if (!Array.isArray(supportingClaimIds) || !Array.isArray(evidenceReferences)) {
      qualificationError("calculation relationship support arrays are malformed", QUALIFICATION_BASIS_ERROR_CODE.INCONSISTENT_CALCULATION);
    }
    supportingClaimIds.forEach((id, claimIndex) => assertNonEmptyString(id, `calculationResult.relationshipReferences[${index}].supportingClaimIds[${claimIndex}]`));
    evidenceReferences.forEach((item, evidenceIndex) => validateEvidenceReference(item, `calculationResult.relationshipReferences[${index}].evidenceReferences[${evidenceIndex}]`));
    byId.set(reference.relationshipId, {
      relationshipId: reference.relationshipId,
      supportingClaimIds: uniqueStrings(supportingClaimIds),
      evidenceReferences: canonicalSort(evidenceReferences),
    });
  });
  return [...byId.values()].sort((left, right) => left.relationshipId.localeCompare(right.relationshipId));
}

function normalizeCalculation(calculation, {
  holderEntityId,
  targetEntityId,
  graphVersion,
  graphFingerprint,
  dimension,
  policyIdentity,
}) {
  assertPlainObject(calculation, "calculationResult");
  assertDataOnly(calculation, "calculationResult");
  if (calculation.calculationAlgorithm !== CALCULATION_ALGORITHM) {
    qualificationError(`calculationResult.calculationAlgorithm must equal ${CALCULATION_ALGORITHM}`, QUALIFICATION_BASIS_ERROR_CODE.INCONSISTENT_CALCULATION);
  }
  if (calculation.graphVersion !== graphVersion || calculation.subjectEntityId !== holderEntityId
    || calculation.targetEntityId !== targetEntityId || calculation.dimension !== dimension) {
    qualificationError("calculation identity does not match the requested graph, person, target and dimension", QUALIFICATION_BASIS_ERROR_CODE.INCONSISTENT_CALCULATION);
  }
  if (calculation.graphFingerprint !== undefined && calculation.graphFingerprint !== graphFingerprint) {
    qualificationError("calculation graph fingerprint does not match the requested graph", QUALIFICATION_BASIS_ERROR_CODE.INCONSISTENT_CALCULATION);
  }
  if (calculation.policyIdentity !== undefined
    && canonicalizeJson(calculation.policyIdentity) !== canonicalizeJson(policyIdentity)) {
    qualificationError("calculation Policy Pack identity does not match the assessment policy", QUALIFICATION_BASIS_ERROR_CODE.INCONSISTENT_CALCULATION);
  }
  if (!Object.values(CALCULATION_STATUS).includes(calculation.status)) {
    qualificationError("calculationResult.status is unsupported", QUALIFICATION_BASIS_ERROR_CODE.INCONSISTENT_CALCULATION);
  }
  const known = calculation.knownPaths;
  const unresolved = calculation.unresolvedPaths;
  const cycles = calculation.cycles;
  if (!Array.isArray(known) || !Array.isArray(unresolved) || !Array.isArray(cycles)) {
    qualificationError("calculation path and cycle collections are required", QUALIFICATION_BASIS_ERROR_CODE.INCONSISTENT_CALCULATION);
  }
  const pathReferences = [
    ...known.map((path, index) => normalizePath(path, "KNOWN", `calculationResult.knownPaths[${index}]`)),
    ...unresolved.map((path, index) => normalizePath(path, "UNRESOLVED", `calculationResult.unresolvedPaths[${index}]`)),
  ].sort((left, right) => left.pathId.localeCompare(right.pathId));
  if (new Set(pathReferences.map(({ pathId }) => pathId)).size !== pathReferences.length) {
    qualificationError("calculation path identifiers must be unique", QUALIFICATION_BASIS_ERROR_CODE.INCONSISTENT_CALCULATION);
  }
  const aggregateKnownValue = calculation.aggregateKnownValue === undefined
    ? undefined
    : normalizeCalculatedValue(calculation.aggregateKnownValue, "calculationResult.aggregateKnownValue");
  if (calculation.status === CALCULATION_STATUS.COMPLETE && pathReferences.length > 0 && aggregateKnownValue === undefined) {
    qualificationError("a complete calculation with paths requires an aggregate known value", QUALIFICATION_BASIS_ERROR_CODE.INCONSISTENT_CALCULATION);
  }
  if (calculation.status === CALCULATION_STATUS.NO_PATH && (pathReferences.length > 0 || aggregateKnownValue !== undefined)) {
    qualificationError("NO_PATH calculation must not record paths or a calculated zero", QUALIFICATION_BASIS_ERROR_CODE.INCONSISTENT_CALCULATION);
  }
  if (calculation.status === CALCULATION_STATUS.PARTIAL && (known.length === 0 || (unresolved.length === 0 && cycles.length === 0))) {
    qualificationError("PARTIAL calculation requires known and unresolved contribution", QUALIFICATION_BASIS_ERROR_CODE.INCONSISTENT_CALCULATION);
  }
  const relationshipReferences = normalizeRelationshipSupport(calculation, pathReferences);
  const topLevelClaims = calculation.operativeClaimReferences || [];
  const topLevelEvidence = calculation.evidenceReferences || [];
  if (!Array.isArray(topLevelClaims) || !Array.isArray(topLevelEvidence)) {
    qualificationError("calculation support collections must be arrays", QUALIFICATION_BASIS_ERROR_CODE.INCONSISTENT_CALCULATION);
  }
  topLevelClaims.forEach((id, index) => assertNonEmptyString(id, `calculationResult.operativeClaimReferences[${index}]`));
  topLevelEvidence.forEach((reference, index) => validateEvidenceReference(reference, `calculationResult.evidenceReferences[${index}]`));
  const calculationReferenceIdentity = {
    calculationAlgorithm: calculation.calculationAlgorithm,
    graphVersion: calculation.graphVersion,
    subjectEntityId: calculation.subjectEntityId,
    targetEntityId: calculation.targetEntityId,
    dimension: calculation.dimension,
  };
  const calculationReference = {
    calculationId: calculation.calculationId === undefined
      ? `calculation:${hash(calculationReferenceIdentity).slice(0, 24)}`
      : assertNonEmptyString(calculation.calculationId, "calculationResult.calculationId"),
    ...calculationReferenceIdentity,
    status: calculation.status,
    ...(calculation.policyIdentity === undefined ? {} : { policyIdentity: cloneData(calculation.policyIdentity) }),
  };
  return {
    calculationReference,
    recordedCalculation: {
      status: calculation.status,
      ...(aggregateKnownValue === undefined ? {} : { value: aggregateKnownValue }),
      cycles: canonicalSort(cycles),
    },
    orderedPathReferences: pathReferences,
    relationshipReferences,
    operativeClaimReferences: uniqueStrings([
      ...topLevelClaims,
      ...relationshipReferences.flatMap(({ supportingClaimIds }) => supportingClaimIds),
    ]),
    evidenceReferences: canonicalSort([
      ...topLevelEvidence,
      ...relationshipReferences.flatMap(({ evidenceReferences }) => evidenceReferences),
    ]).filter((reference, index, all) => index === 0 || canonicalizeJson(reference) !== canonicalizeJson(all[index - 1])),
  };
}

function validateThreshold(threshold, path, code = QUALIFICATION_BASIS_ERROR_CODE.MALFORMED_THRESHOLD) {
  try {
    assertPlainObject(threshold, path);
    if (typeof threshold.value !== "number" || !Number.isFinite(threshold.value) || threshold.value < 0 || threshold.value > 100) {
      qualificationError(`${path}.value must be a finite percentage`, code);
    }
    if (![">", ">="].includes(threshold.comparator)) qualificationError(`${path}.comparator must be > or >=`, code);
    assertNonEmptyString(threshold.classification, `${path}.classification`);
    assertNonEmptyString(threshold.legalBasis, `${path}.legalBasis`);
    return threshold;
  } catch (error) {
    if (error instanceof QualificationBasisV2Error) throw error;
    qualificationError(error.message, code, undefined, error);
  }
}

function validateFirmThreshold(threshold) {
  const path = "policyPack.firmCollectionThreshold";
  try {
    assertPlainObject(threshold, path);
    if (typeof threshold.value !== "number" || !Number.isFinite(threshold.value) || threshold.value < 0 || threshold.value > 100) {
      qualificationError(`${path}.value must be a finite percentage`, QUALIFICATION_BASIS_ERROR_CODE.MALFORMED_THRESHOLD);
    }
    if (![">", ">="].includes(threshold.comparator)) {
      qualificationError(`${path}.comparator must be > or >=`, QUALIFICATION_BASIS_ERROR_CODE.MALFORMED_THRESHOLD);
    }
    assertNonEmptyString(threshold.classification, `${path}.classification`);
    assertNonEmptyString(threshold.projectedRole, `${path}.projectedRole`);
    return {
      value: threshold.value,
      comparator: threshold.comparator,
      classification: threshold.classification,
      legalBasis: "FIRM_COLLECTION_POLICY",
    };
  } catch (error) {
    if (error instanceof QualificationBasisV2Error) throw error;
    qualificationError(error.message, QUALIFICATION_BASIS_ERROR_CODE.MALFORMED_THRESHOLD, undefined, error);
  }
}

function assessmentFor(value, status, threshold) {
  if (status === CALCULATION_STATUS.NO_PATH) {
    return { assessmentState: QUALIFICATION_ASSESSMENT_STATE.INDETERMINATE, reasonCode: "NO_ESTABLISHED_PATH_IS_NOT_ZERO" };
  }
  if (value === undefined || value.type === PERCENTAGE_VALUE_TYPE.UNKNOWN) {
    return { assessmentState: QUALIFICATION_ASSESSMENT_STATE.INDETERMINATE, reasonCode: "NO_DEFENSIBLE_KNOWN_NUMERIC_CONTRIBUTION" };
  }
  const thresholdValue = decimalNumberToRational(threshold.value);
  let lower;
  let upper;
  let lowerInclusive;
  let upperInclusive;
  if (value.type === PERCENTAGE_VALUE_TYPE.EXACT) {
    lower = decimalNumberToRational(value.value);
    upper = lower;
    lowerInclusive = true;
    upperInclusive = true;
  } else {
    lower = decimalNumberToRational(value.lowerBound);
    upper = decimalNumberToRational(value.upperBound);
    lowerInclusive = value.lowerInclusive;
    upperInclusive = value.upperInclusive;
  }
  const lowerComparison = compare(lower, thresholdValue);
  const upperComparison = compare(upper, thresholdValue);
  const guaranteedSatisfied = threshold.comparator === ">"
    ? lowerComparison > 0 || (lowerComparison === 0 && !lowerInclusive)
    : lowerComparison >= 0;
  if (guaranteedSatisfied) {
    return { assessmentState: QUALIFICATION_ASSESSMENT_STATE.SATISFIED, reasonCode: "RECORDED_VALUE_GUARANTEES_THRESHOLD_SATISFACTION" };
  }
  if (status !== CALCULATION_STATUS.COMPLETE) {
    return { assessmentState: QUALIFICATION_ASSESSMENT_STATE.INDETERMINATE, reasonCode: "INCOMPLETE_CALCULATION_MAY_CHANGE_THRESHOLD_OUTCOME" };
  }
  const guaranteedNotSatisfied = threshold.comparator === ">"
    ? upperComparison <= 0
    : upperComparison < 0 || (upperComparison === 0 && !upperInclusive);
  if (guaranteedNotSatisfied) {
    return { assessmentState: QUALIFICATION_ASSESSMENT_STATE.NOT_SATISFIED, reasonCode: "COMPLETE_RECORDED_VALUE_DOES_NOT_SATISFY_THRESHOLD" };
  }
  return { assessmentState: QUALIFICATION_ASSESSMENT_STATE.INDETERMINATE, reasonCode: "RECORDED_RANGE_STRADDLES_THRESHOLD" };
}

function directnessFor(paths) {
  if (paths.length === 0) return QUALIFICATION_DIRECTNESS.NOT_ESTABLISHED;
  const lengths = new Set(paths.map(({ relationshipIds }) => relationshipIds.length === 1 ? "DIRECT" : "INDIRECT"));
  if (lengths.size > 1) return QUALIFICATION_DIRECTNESS.DIRECT_AND_INDIRECT;
  return lengths.has("DIRECT") ? QUALIFICATION_DIRECTNESS.DIRECT : QUALIFICATION_DIRECTNESS.INDIRECT;
}

function assertFirmThresholdSafety(firm, statutory, statutoryBasis) {
  const firmValue = decimalNumberToRational(firm.value);
  const statutoryValue = decimalNumberToRational(statutory.value);
  const comparison = compare(firmValue, statutoryValue);
  const equalButNarrower = comparison === 0 && statutory.comparator === ">=" && firm.comparator === ">";
  if (comparison > 0 || equalButNarrower) {
    qualificationError(
      "enabled firm collection threshold would capture fewer people than the statutory threshold",
      QUALIFICATION_BASIS_ERROR_CODE.UNSAFE_FIRM_THRESHOLD,
      { statutoryBasisId: statutoryBasis.basisId, statutoryAssessmentState: statutoryBasis.assessmentState },
    );
  }
}

function thresholdDescriptor(threshold, { classification, dimension, policyFieldReference }) {
  return {
    value: threshold.value,
    comparator: threshold.comparator,
    classification,
    sourceClassification: threshold.classification,
    legalBasis: threshold.legalBasis,
    policyFieldReference,
    dimension,
  };
}

function makeBasis({
  caseReference,
  policyIdentity,
  graphReference,
  personEntityId,
  targetEntityId,
  dimension,
  threshold,
  classification,
  policyFieldReference,
  route,
  calculation,
  projectedRole,
}) {
  const assessment = assessmentFor(calculation.recordedCalculation.value, calculation.recordedCalculation.status, threshold);
  return createQualificationBasisV2({
    ...(caseReference === undefined ? {} : { caseReference }),
    policyIdentity,
    graphReference,
    personEntityId,
    holderCategory: CANONICAL_ENTITY_CATEGORY.NATURAL_PERSON,
    targetEntityId,
    route: QUALIFICATION_ROUTE.EFFECTIVE_INTEREST,
    classification,
    dimension,
    directness: directnessFor(calculation.orderedPathReferences),
    method: route.method,
    methodStatus: route.methodStatus,
    methodVersion: calculation.calculationReference.calculationAlgorithm,
    assessmentState: assessment.assessmentState,
    reasonCode: assessment.reasonCode,
    threshold: thresholdDescriptor(threshold, { classification, dimension, policyFieldReference }),
    recordedCalculation: calculation.recordedCalculation,
    calculationReference: calculation.calculationReference,
    orderedPathReferences: calculation.orderedPathReferences,
    relationshipReferences: calculation.relationshipReferences,
    operativeClaimReferences: calculation.operativeClaimReferences,
    evidenceReferences: calculation.evidenceReferences,
    policyRequirement: {
      requirementId: dimension === GRAPH_DIMENSION.ECONOMIC ? "UBO-R01" : "UBO-R04",
      routeReference: "qualificationDoctrine.routes.EFFECTIVE_INTEREST",
      thresholdReference: policyFieldReference,
      legalBasis: threshold.legalBasis,
    },
    reviewDependencies: route.signoffId === undefined ? [] : [route.signoffId],
    ...(projectedRole === undefined ? {} : { projectedRole }),
  });
}

function assessEffectiveInterestQualificationV2({
  policyPack: loadedPolicyPack,
  calculationResult,
  holderEntity,
  targetEntityId,
  caseRevision,
  graphVersion,
}) {
  try {
    assertPlainObject(holderEntity, "holderEntity");
    assertNonEmptyString(holderEntity.entityId, "holderEntity.entityId");
    if (holderEntity.category !== CANONICAL_ENTITY_CATEGORY.NATURAL_PERSON) {
      qualificationError("QualificationBasis v2 holder must be a canonical NATURAL_PERSON", QUALIFICATION_BASIS_ERROR_CODE.INELIGIBLE_HOLDER);
    }
    assertNonEmptyString(targetEntityId, "targetEntityId");
    assertNonEmptyString(graphVersion, "graphVersion");
    const fingerprintMatch = /^ubo-graph-v1:([a-f0-9]{64})$/.exec(graphVersion);
    if (!fingerprintMatch) qualificationError("graphVersion must carry the canonical graph fingerprint", QUALIFICATION_BASIS_ERROR_CODE.INVALID_INPUT);
    const { policyPack, policyIdentity } = validatedPolicy(loadedPolicyPack);
    const route = policyPack.qualificationDoctrine.routes.find(({ id }) => id === QUALIFICATION_ROUTE.EFFECTIVE_INTEREST);
    if (!route) qualificationError("Policy Pack does not declare EFFECTIVE_INTEREST", QUALIFICATION_BASIS_ERROR_CODE.ROUTE_NOT_DECLARED);
    if (route.method !== CALCULATION_ALGORITHM) {
      qualificationError(`EFFECTIVE_INTEREST method must equal ${CALCULATION_ALGORITHM}`, QUALIFICATION_BASIS_ERROR_CODE.UNSUPPORTED_ROUTE_METHOD);
    }
    if (route.methodStatus !== EFFECTIVE_INTEREST_METHOD_STATUS) {
      qualificationError(`EFFECTIVE_INTEREST methodStatus must equal ${EFFECTIVE_INTEREST_METHOD_STATUS}`, QUALIFICATION_BASIS_ERROR_CODE.UNSUPPORTED_ROUTE_METHOD_STATUS);
    }
    const dimension = calculationResult?.dimension;
    if (![GRAPH_DIMENSION.ECONOMIC, GRAPH_DIMENSION.VOTING].includes(dimension)
      || !Array.isArray(route.dimensions) || !route.dimensions.includes(dimension)) {
      qualificationError("calculation dimension is not declared for EFFECTIVE_INTEREST", QUALIFICATION_BASIS_ERROR_CODE.DIMENSION_NOT_DECLARED);
    }
    const thresholdKey = dimension === GRAPH_DIMENSION.ECONOMIC ? "economic" : "voting";
    const statutoryThreshold = validateThreshold(policyPack.statutoryThresholds[thresholdKey], `policyPack.statutoryThresholds.${thresholdKey}`);
    const caseReference = normalizeCaseReference(caseRevision);
    const graphReference = { graphVersion, graphFingerprint: `sha256:${fingerprintMatch[1]}` };
    const calculation = normalizeCalculation(calculationResult, {
      holderEntityId: holderEntity.entityId,
      targetEntityId,
      graphVersion,
      graphFingerprint: graphReference.graphFingerprint,
      dimension,
      policyIdentity,
    });
    const statutoryBasis = makeBasis({
      caseReference,
      policyIdentity,
      graphReference,
      personEntityId: holderEntity.entityId,
      targetEntityId,
      dimension,
      threshold: statutoryThreshold,
      classification: QUALIFICATION_CLASSIFICATION.STATUTORY,
      policyFieldReference: `statutoryThresholds.${thresholdKey}`,
      route,
      calculation,
    });
    const bases = [statutoryBasis];
    if (policyPack.firmCollectionThreshold.enabled === true) {
      let firmThreshold;
      try {
        firmThreshold = validateFirmThreshold(policyPack.firmCollectionThreshold);
      } catch (error) {
        if (error instanceof QualificationBasisV2Error) {
          error.details = deepFreeze({
            ...(error.details || {}),
            statutoryBasisId: statutoryBasis.basisId,
            statutoryAssessmentState: statutoryBasis.assessmentState,
          });
        }
        throw error;
      }
      assertFirmThresholdSafety(firmThreshold, statutoryThreshold, statutoryBasis);
      bases.push(makeBasis({
        caseReference,
        policyIdentity,
        graphReference,
        personEntityId: holderEntity.entityId,
        targetEntityId,
        dimension,
        threshold: firmThreshold,
        classification: QUALIFICATION_CLASSIFICATION.FIRM_POLICY,
        policyFieldReference: "firmCollectionThreshold",
        route,
        calculation,
        projectedRole: policyPack.firmCollectionThreshold.projectedRole,
      }));
    }
    const declaredRoutes = policyPack.qualificationDoctrine.routes.map(({ id }) => id);
    const unassessedRoutes = ALL_QUALIFICATION_ROUTES.filter((routeId) => declaredRoutes.includes(routeId)
      && routeId !== QUALIFICATION_ROUTE.EFFECTIVE_INTEREST);
    const result = {
      assessmentSchemaVersion: EFFECTIVE_INTEREST_QUALIFICATION_VERSION,
      assessmentId: `${EFFECTIVE_INTEREST_QUALIFICATION_VERSION}:${hash({
        policyIdentity,
        caseReference: caseReference || null,
        graphReference,
        calculationReference: calculation.calculationReference,
        basisIds: bases.map(({ basisId }) => basisId),
      }).slice(0, 32)}`,
      ...(caseReference === undefined ? {} : { caseReference }),
      policyIdentity,
      graphReference,
      calculationReference: calculation.calculationReference,
      personReference: { entityId: holderEntity.entityId, category: holderEntity.category },
      targetEntityId,
      assessedRoutes: [QUALIFICATION_ROUTE.EFFECTIVE_INTEREST],
      unassessedRoutes,
      scope: "ROUTE_SPECIFIC_NOT_FINAL_PERSON_DETERMINATION",
      routeCoverageComplete: unassessedRoutes.length === 0,
      basisRecords: bases,
      statutoryBasisIds: bases.filter(({ classification }) => classification === QUALIFICATION_CLASSIFICATION.STATUTORY).map(({ basisId }) => basisId),
      firmPolicyBasisIds: bases.filter(({ classification }) => classification === QUALIFICATION_CLASSIFICATION.FIRM_POLICY).map(({ basisId }) => basisId),
      satisfiedBasisIds: bases.filter(({ assessmentState }) => assessmentState === QUALIFICATION_ASSESSMENT_STATE.SATISFIED).map(({ basisId }) => basisId),
      indeterminateBasisIds: bases.filter(({ assessmentState }) => assessmentState === QUALIFICATION_ASSESSMENT_STATE.INDETERMINATE).map(({ basisId }) => basisId),
    };
    return deepFreeze(cloneData(result));
  } catch (error) {
    if (error instanceof QualificationBasisV2Error) throw error;
    qualificationError(error.message, QUALIFICATION_BASIS_ERROR_CODE.INVALID_INPUT, undefined, error);
  }
}

module.exports = {
  ALL_QUALIFICATION_ROUTES,
  EFFECTIVE_INTEREST_METHOD_STATUS,
  EFFECTIVE_INTEREST_QUALIFICATION_VERSION,
  assessEffectiveInterestQualificationV2,
};
