"use strict";

const { createHash } = require("node:crypto");
const { PERCENTAGE_VALUE_TYPE } = require("../contracts/constants");
const { validateEvidenceReference } = require("../contracts/evidenceReference");
const {
  compare,
  decimalNumberToRational,
  intervalFromPercentageValue,
  rationalToDecimal,
} = require("../domain/exactPercentage");
const { GRAPH_DIMENSION, TEMPORAL_STATE } = require("../domain/ownershipGraph");
const { UboContractError } = require("../errors");
const {
  assertDataOnly,
  assertNonEmptyString,
  assertPlainObject,
  cloneData,
  deepFreeze,
} = require("../internal/validation");
const { canonicalizeJson } = require("./canonicalJson");
const { EVIDENCE_CURRENT_STATE, EVIDENCE_SOURCE_ORIGIN, durableEvidenceIdentity } = require("./evidencePolicy");
const { hashPolicyPack, validatePolicyPack } = require("./policyPack");

const PERCENTAGE_EVIDENCE_ALGORITHM = "ubo-percentage-evidence-v1";
const PERCENTAGE_EVIDENCE_ASSESSMENT_VERSION = "ubo-percentage-evidence-assessment-v1";
const PERCENTAGE_EVIDENCE_GOVERNANCE_STATE = "REVIEW_ONLY";

const PERCENTAGE_EVIDENCE_STATE = Object.freeze({
  DECLARED_EXACT: "DECLARED_EXACT",
  INDEPENDENT_BAND_CORROBORATED: "INDEPENDENT_BAND_CORROBORATED",
  EXACT_VALUE_VERIFIED: "EXACT_VALUE_VERIFIED",
});

const PERCENTAGE_EVIDENCE_CONSISTENCY = Object.freeze({
  CONSISTENT: "CONSISTENT",
  CONTRADICTED: "CONTRADICTED",
  REVIEW_REQUIRED: "REVIEW_REQUIRED",
  UNASSESSED: "UNASSESSED",
});

const OPERATIONAL_SUFFICIENCY = Object.freeze({
  NOT_ASSESSED: "NOT_ASSESSED",
  REQUIRES_POLICY_SIGNOFF: "REQUIRES_POLICY_SIGNOFF",
});

const PERCENTAGE_EVIDENCE_ERROR_CODE = Object.freeze({
  INVALID_INPUT: "INVALID_PERCENTAGE_EVIDENCE_INPUT",
  INVALID_POLICY_PACK: "INVALID_PERCENTAGE_EVIDENCE_POLICY_PACK",
  POLICY_IDENTITY_REQUIRED: "PERCENTAGE_EVIDENCE_POLICY_IDENTITY_REQUIRED",
  POLICY_IDENTITY_MISMATCH: "PERCENTAGE_EVIDENCE_POLICY_IDENTITY_MISMATCH",
  UNSUPPORTED_POLICY_SCHEMA: "UNSUPPORTED_PERCENTAGE_EVIDENCE_POLICY_SCHEMA",
  POLICY_DOCTRINE_MISSING: "PERCENTAGE_EVIDENCE_POLICY_DOCTRINE_MISSING",
});

class PercentageEvidenceAssessmentError extends UboContractError {
  constructor(message, { code = PERCENTAGE_EVIDENCE_ERROR_CODE.INVALID_INPUT, details, cause } = {}) {
    super(message, { code, cause });
    if (details !== undefined) this.details = deepFreeze(cloneData(details));
  }
}

function fail(message, code, details, cause) {
  throw new PercentageEvidenceAssessmentError(message, { code, details, cause });
}

function digest(value) {
  return createHash("sha256").update(canonicalizeJson(value), "utf8").digest("hex");
}

function canonicalSort(values) {
  return cloneData(values || []).sort((left, right) => canonicalizeJson(left).localeCompare(canonicalizeJson(right)));
}

function uniqueStrings(values) {
  return [...new Set((values || []).filter((value) => typeof value === "string" && value.trim() !== ""))].sort();
}

function validateLoadedPolicy(loaded) {
  if (!loaded || typeof loaded !== "object" || !loaded.policyPack || !loaded.identity) {
    fail("percentage evidence assessment requires a loaded Policy Pack", PERCENTAGE_EVIDENCE_ERROR_CODE.POLICY_IDENTITY_REQUIRED);
  }
  const { policyPack, identity } = loaded;
  try {
    validatePolicyPack(policyPack);
  } catch (cause) {
    fail("percentage evidence assessment received an invalid Policy Pack", PERCENTAGE_EVIDENCE_ERROR_CODE.INVALID_POLICY_PACK, undefined, cause);
  }
  const canonicalHash = hashPolicyPack(policyPack);
  const expected = {
    schemaId: policyPack.schemaId,
    schemaVersion: policyPack.schemaVersion,
    policyPackId: policyPack.policyPackId,
    version: policyPack.version,
    hash: canonicalHash,
  };
  if (Object.entries(expected).some(([field, value]) => identity[field] !== value)) {
    fail("loaded Policy Pack identity does not match canonical content", PERCENTAGE_EVIDENCE_ERROR_CODE.POLICY_IDENTITY_MISMATCH);
  }
  if (policyPack.schemaVersion !== "1.3") {
    fail("percentage evidence assessment requires Policy Pack schema 1.3", PERCENTAGE_EVIDENCE_ERROR_CODE.UNSUPPORTED_POLICY_SCHEMA);
  }
  const states = policyPack.percentageEvidenceStates || [];
  if (!Object.values(PERCENTAGE_EVIDENCE_STATE).every((state) => states.includes(state))
    || policyPack.declaredExactWithinIndependentBand?.result !== PERCENTAGE_EVIDENCE_STATE.INDEPENDENT_BAND_CORROBORATED
    || policyPack.declaredExactWithinIndependentBand?.exactValueVerification !== false) {
    fail("Policy Pack does not declare the required percentage-evidence doctrine", PERCENTAGE_EVIDENCE_ERROR_CODE.POLICY_DOCTRINE_MISSING);
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

function relationshipSemantic(raw, path) {
  assertPlainObject(raw, path);
  assertDataOnly(raw, path);
  ["relationshipId", "holderEntityId", "targetEntityId", "relationshipBasis", "dimension", "temporalState"]
    .forEach((field) => assertNonEmptyString(raw[field], `${path}.${field}`));
  if (![GRAPH_DIMENSION.ECONOMIC, GRAPH_DIMENSION.VOTING].includes(raw.dimension)) fail(`${path}.dimension must be ECONOMIC or VOTING`);
  if (!Object.values(TEMPORAL_STATE).includes(raw.temporalState)) fail(`${path}.temporalState is unsupported`);
  return {
    relationshipId: raw.relationshipId,
    holderEntityId: raw.holderEntityId,
    targetEntityId: raw.targetEntityId,
    relationshipBasis: raw.relationshipBasis,
    dimension: raw.dimension,
    temporalState: raw.temporalState,
    ...(raw.interestClassRef === undefined ? {} : { interestClassRef: assertNonEmptyString(raw.interestClassRef, `${path}.interestClassRef`) }),
    ...(raw.denominatorRef === undefined ? {} : { denominatorRef: assertNonEmptyString(raw.denominatorRef, `${path}.denominatorRef`) }),
  };
}

function normalizeMeasurement(measurement, expectedType, path) {
  assertPlainObject(measurement, path);
  assertDataOnly(measurement, path);
  if (measurement.type !== expectedType) fail(`${path}.type must equal ${expectedType}`);
  if (expectedType === PERCENTAGE_VALUE_TYPE.RANGE
    && (typeof measurement.lowerInclusive !== "boolean" || typeof measurement.upperInclusive !== "boolean")) {
    fail(`${path} range endpoint inclusivity must be boolean`);
  }
  let interval;
  try {
    interval = intervalFromPercentageValue(measurement);
  } catch (cause) {
    fail(`${path} is malformed`, PERCENTAGE_EVIDENCE_ERROR_CODE.INVALID_INPUT, undefined, cause);
  }
  const zero = decimalNumberToRational(0);
  const hundred = decimalNumberToRational(100);
  if (compare(interval.lower, zero) < 0 || compare(interval.upper, hundred) > 0
    || compare(interval.lower, interval.upper) > 0
    || (compare(interval.lower, interval.upper) === 0 && (!interval.lowerInclusive || !interval.upperInclusive))) {
    fail(`${path} is outside the percentage domain`);
  }
  if (expectedType === PERCENTAGE_VALUE_TYPE.EXACT) {
    return { type: expectedType, value: rationalToDecimal(interval.lower) };
  }
  return {
    type: expectedType,
    lowerBound: rationalToDecimal(interval.lower),
    upperBound: rationalToDecimal(interval.upper),
    lowerInclusive: interval.lowerInclusive,
    upperInclusive: interval.upperInclusive,
  };
}

function normalizeIndependence(raw, path) {
  assertPlainObject(raw, path);
  assertDataOnly(raw, path);
  ["sourceId", "artifactId", "basis"].forEach((field) => assertNonEmptyString(raw[field], `${path}.${field}`));
  return { sourceId: raw.sourceId, artifactId: raw.artifactId, basis: raw.basis };
}

function normalizeDeclaration(raw, relationshipIdentity) {
  if (raw === undefined) return undefined;
  assertPlainObject(raw, "declaredPercentage");
  assertDataOnly(raw, "declaredPercentage");
  validateEvidenceReference(raw.evidenceReference, "declaredPercentage.evidenceReference");
  const relationship = relationshipSemantic(raw.relationshipIdentity, "declaredPercentage.relationshipIdentity");
  if (canonicalizeJson(relationship) !== canonicalizeJson(relationshipIdentity)) fail("declaration relationship identity does not match assessment relationship");
  return {
    measurement: normalizeMeasurement(raw.measurement, PERCENTAGE_VALUE_TYPE.EXACT, "declaredPercentage.measurement"),
    evidenceReference: cloneData(raw.evidenceReference),
    relationshipIdentity: relationship,
    ...(raw.declarationAuthority === undefined ? {} : { declarationAuthority: assertNonEmptyString(raw.declarationAuthority, "declaredPercentage.declarationAuthority") }),
  };
}

function normalizeSource(raw, expectedType, path, relationshipIdentity, exact = false) {
  assertPlainObject(raw, path);
  assertDataOnly(raw, path);
  validateEvidenceReference(raw.evidenceReference, `${path}.evidenceReference`);
  if (!Object.values(EVIDENCE_SOURCE_ORIGIN).includes(raw.sourceOrigin)) fail(`${path}.sourceOrigin is unsupported`);
  const independenceBasis = normalizeIndependence(raw.independenceBasis, `${path}.independenceBasis`);
  const relationship = relationshipSemantic(raw.relationshipIdentity, `${path}.relationshipIdentity`);
  const relationshipMatches = canonicalizeJson(relationship) === canonicalizeJson(relationshipIdentity);
  assertNonEmptyString(raw.currentness, `${path}.currentness`);
  if (!Object.values(EVIDENCE_CURRENT_STATE).includes(raw.currentness)) fail(`${path}.currentness is unsupported`);
  const capable = exact ? raw.establishesExactValue === true : true;
  const measurement = normalizeMeasurement(raw.measurement, expectedType, `${path}.measurement`);
  return {
    sourceAssessmentId: `percentage-source:${digest({
      evidenceIdentity: durableEvidenceIdentity(raw.evidenceReference),
      independenceBasis,
      relationship,
      measurement,
      exactValueCapability: capable,
    }).slice(0, 24)}`,
    measurement,
    evidenceReference: cloneData(raw.evidenceReference),
    sourceOrigin: raw.sourceOrigin,
    independenceBasis,
    relationshipIdentity: relationship,
    relationshipMatches,
    currentnessMatches: raw.currentness === relationshipIdentity.temporalState,
    ...(exact ? { establishesExactValue: capable } : {}),
  };
}

function asArray(value) {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function isIndependent(source) {
  return source.sourceOrigin === EVIDENCE_SOURCE_ORIGIN.INDEPENDENT_OF_APPLICANT
    && source.relationshipMatches
    && source.currentnessMatches;
}

function bandComparison(declaration, band) {
  const declared = decimalNumberToRational(declaration.measurement.value);
  const interval = intervalFromPercentageValue(band.measurement);
  const lowerComparison = compare(declared, interval.lower);
  const upperComparison = compare(declared, interval.upper);
  const lowerSatisfied = lowerComparison > 0 || (lowerComparison === 0 && interval.lowerInclusive);
  const upperSatisfied = upperComparison < 0 || (upperComparison === 0 && interval.upperInclusive);
  return {
    sourceAssessmentId: band.sourceAssessmentId,
    declaredValue: declaration.measurement.value,
    band: cloneData(band.measurement),
    lowerComparison,
    lowerEndpointIncluded: interval.lowerInclusive,
    upperComparison,
    upperEndpointIncluded: interval.upperInclusive,
    contained: lowerSatisfied && upperSatisfied,
  };
}

function exactComparison(declaration, source) {
  return {
    sourceAssessmentId: source.sourceAssessmentId,
    declaredValue: declaration.measurement.value,
    independentExactValue: source.measurement.value,
    equal: compare(decimalNumberToRational(declaration.measurement.value), decimalNumberToRational(source.measurement.value)) === 0,
  };
}

function assessPercentageEvidenceV1({
  policyPack: loadedPolicyPack,
  declaredPercentage,
  independentBandEvidence,
  exactValueEvidence,
  relationshipIdentity: suppliedRelationshipIdentity,
  evaluationTime,
}) {
  try {
    const policy = validateLoadedPolicy(loadedPolicyPack);
    const relationshipIdentity = relationshipSemantic(suppliedRelationshipIdentity, "relationshipIdentity");
    if (evaluationTime !== undefined) {
      assertNonEmptyString(evaluationTime, "evaluationTime");
      if (Number.isNaN(Date.parse(evaluationTime))) fail("evaluationTime must be an ISO-compatible timestamp");
    }
    const declaration = normalizeDeclaration(declaredPercentage, relationshipIdentity);
    const bands = asArray(independentBandEvidence).map((source, index) => normalizeSource(
      source,
      PERCENTAGE_VALUE_TYPE.RANGE,
      `independentBandEvidence[${index}]`,
      relationshipIdentity,
    )).sort((left, right) => left.sourceAssessmentId.localeCompare(right.sourceAssessmentId));
    const exactSources = asArray(exactValueEvidence).map((source, index) => normalizeSource(
      source,
      PERCENTAGE_VALUE_TYPE.EXACT,
      `exactValueEvidence[${index}]`,
      relationshipIdentity,
      true,
    )).sort((left, right) => left.sourceAssessmentId.localeCompare(right.sourceAssessmentId));

    const eligibleBands = bands.filter(isIndependent);
    const eligibleExact = exactSources.filter((source) => isIndependent(source) && source.establishesExactValue);
    const bandComparisons = declaration ? eligibleBands.map((band) => bandComparison(declaration, band)) : [];
    const exactComparisons = declaration ? eligibleExact.map((source) => exactComparison(declaration, source)) : [];
    const matchingBand = bandComparisons.some(({ contained }) => contained);
    const contradictoryBand = bandComparisons.some(({ contained }) => !contained);
    const exactValues = uniqueStrings(eligibleExact.map(({ measurement }) => measurement.value));
    const conflictingExactSources = exactValues.length > 1;
    const matchingExact = declaration
      ? exactComparisons.some(({ equal }) => equal)
      : eligibleExact.length > 0;
    const contradictoryExact = declaration && exactComparisons.some(({ equal }) => !equal);

    const evidenceStates = [];
    if (declaration) evidenceStates.push(PERCENTAGE_EVIDENCE_STATE.DECLARED_EXACT);
    if (declaration && matchingBand) evidenceStates.push(PERCENTAGE_EVIDENCE_STATE.INDEPENDENT_BAND_CORROBORATED);
    if (matchingExact && !conflictingExactSources && !contradictoryExact) evidenceStates.push(PERCENTAGE_EVIDENCE_STATE.EXACT_VALUE_VERIFIED);

    let consistencyState = PERCENTAGE_EVIDENCE_CONSISTENCY.UNASSESSED;
    let reasonCode = "NO_COMPARABLE_INDEPENDENT_PERCENTAGE_SOURCE";
    if (conflictingExactSources) {
      consistencyState = PERCENTAGE_EVIDENCE_CONSISTENCY.REVIEW_REQUIRED;
      reasonCode = "CONFLICTING_INDEPENDENT_EXACT_SOURCES_NO_WINNER";
    } else if (contradictoryBand || contradictoryExact) {
      consistencyState = PERCENTAGE_EVIDENCE_CONSISTENCY.CONTRADICTED;
      reasonCode = contradictoryExact ? "DECLARATION_CONTRADICTS_INDEPENDENT_EXACT_VALUE" : "DECLARATION_OUTSIDE_INDEPENDENT_BAND";
    } else if (matchingBand || matchingExact) {
      consistencyState = PERCENTAGE_EVIDENCE_CONSISTENCY.CONSISTENT;
      reasonCode = matchingExact
        ? declaration ? "DECLARATION_MATCHES_INDEPENDENT_EXACT_VALUE" : "INDEPENDENT_EXACT_VALUE_ESTABLISHED"
        : "DECLARATION_CONTAINED_IN_INDEPENDENT_BAND";
    }

    const bandCorroborationCombination = consistencyState === PERCENTAGE_EVIDENCE_CONSISTENCY.CONSISTENT
      && evidenceStates.includes(PERCENTAGE_EVIDENCE_STATE.DECLARED_EXACT)
      && evidenceStates.includes(PERCENTAGE_EVIDENCE_STATE.INDEPENDENT_BAND_CORROBORATED);
    const operationalSufficiency = bandCorroborationCombination
      ? OPERATIONAL_SUFFICIENCY.REQUIRES_POLICY_SIGNOFF
      : OPERATIONAL_SUFFICIENCY.NOT_ASSESSED;
    const requiredSignoffIds = bandCorroborationCombination ? ["A-03"] : [];
    const independentSources = [...eligibleBands, ...eligibleExact];
    const distinctIndependentArtifacts = [...new Map(independentSources.map((source) => [
      source.independenceBasis.artifactId,
      {
        artifactId: source.independenceBasis.artifactId,
        sourceIds: uniqueStrings(independentSources
          .filter((candidate) => candidate.independenceBasis.artifactId === source.independenceBasis.artifactId)
          .map((candidate) => candidate.independenceBasis.sourceId)),
        basis: source.independenceBasis.basis,
        evidenceReferences: canonicalSort(independentSources
          .filter((candidate) => candidate.independenceBasis.artifactId === source.independenceBasis.artifactId)
          .map(({ evidenceReference }) => evidenceReference)),
      },
    ])).values()].sort((left, right) => left.artifactId.localeCompare(right.artifactId));

    const semantic = {
      algorithmVersion: PERCENTAGE_EVIDENCE_ALGORITHM,
      policyIdentity: policy.policyIdentity,
      relationshipIdentity,
      declaration: declaration || null,
      bands,
      exactSources,
      evaluationTime: evaluationTime || null,
      bandComparisons,
      exactComparisons,
      evidenceStates: evidenceStates.sort(),
      consistencyState,
      reasonCode,
      operationalSufficiency,
      requiredSignoffIds,
    };
    return deepFreeze(cloneData({
      assessmentContractVersion: PERCENTAGE_EVIDENCE_ASSESSMENT_VERSION,
      algorithmVersion: PERCENTAGE_EVIDENCE_ALGORITHM,
      assessmentId: `${PERCENTAGE_EVIDENCE_ASSESSMENT_VERSION}:${digest(semantic).slice(0, 32)}`,
      policyIdentity: policy.policyIdentity,
      relationshipIdentity,
      ...(evaluationTime === undefined ? {} : { evaluationTime }),
      ...(declaration === undefined ? {} : { declaration }),
      independentBandSources: bands,
      independentExactSources: exactSources,
      endpointComparisons: bandComparisons,
      exactValueComparisons: exactComparisons,
      evidenceStates: evidenceStates.sort(),
      consistencyState,
      reasonCode,
      conflict: consistencyState === PERCENTAGE_EVIDENCE_CONSISTENCY.CONTRADICTED
        || consistencyState === PERCENTAGE_EVIDENCE_CONSISTENCY.REVIEW_REQUIRED
        ? {
          state: consistencyState,
          reasonCode,
          declarationReference: declaration?.evidenceReference,
          bandReferences: contradictoryBand ? eligibleBands.filter((band) => !bandComparison(declaration, band).contained).map(({ evidenceReference }) => evidenceReference) : [],
          exactReferences: (contradictoryExact || conflictingExactSources) ? eligibleExact.map(({ evidenceReference }) => evidenceReference) : [],
          winnerSelected: false,
        } : null,
      independence: {
        distinctIndependentArtifactCount: distinctIndependentArtifacts.length,
        distinctIndependentArtifacts,
      },
      operationalSufficiency,
      requiredSignoffIds,
      claimAdjudicationChanged: false,
      scope: "PERCENTAGE_EVIDENCE_CLASSIFICATION_ONLY",
      governance: {
        governanceState: PERCENTAGE_EVIDENCE_GOVERNANCE_STATE,
        productionAuthorized: false,
        requiredSignoffIds,
        policyStatus: policy.policyPack.status,
      },
    }));
  } catch (error) {
    if (error instanceof PercentageEvidenceAssessmentError) throw error;
    fail(error.message, PERCENTAGE_EVIDENCE_ERROR_CODE.INVALID_INPUT, undefined, error);
  }
}

module.exports = {
  OPERATIONAL_SUFFICIENCY,
  PERCENTAGE_EVIDENCE_ALGORITHM,
  PERCENTAGE_EVIDENCE_ASSESSMENT_VERSION,
  PERCENTAGE_EVIDENCE_CONSISTENCY,
  PERCENTAGE_EVIDENCE_ERROR_CODE,
  PERCENTAGE_EVIDENCE_GOVERNANCE_STATE,
  PERCENTAGE_EVIDENCE_STATE,
  PercentageEvidenceAssessmentError,
  assessPercentageEvidenceV1,
};
