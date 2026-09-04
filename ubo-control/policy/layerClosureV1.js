"use strict";

const { createHash } = require("node:crypto");
const { PERCENTAGE_VALUE_TYPE } = require("../contracts/constants");
const { validateEvidenceReference } = require("../contracts/evidenceReference");
const { CANONICAL_ENTITY_CATEGORY } = require("../domain/canonicalEntity");
const {
  HUNDRED,
  addIntervals,
  compare,
  decimalNumberToRational,
  intervalFromPercentageValue,
  intervalToCalculatedValue,
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
const { validatePolicyPack } = require("./policyPack");
const {
  assessPercentagePrecisionV1,
} = require("./percentagePrecisionV1");

const LAYER_CLOSURE_ALGORITHM = "ubo-layer-closure-v1";
const LAYER_CLOSURE_ASSESSMENT_VERSION = "ubo-layer-closure-assessment-v1";
const LAYER_CLOSURE_GOVERNANCE_STATE = "REVIEW_ONLY";

const LAYER_CLOSURE_STATE = Object.freeze({
  CLOSED: "CLOSED",
  OPEN: "OPEN",
  INDETERMINATE: "INDETERMINATE",
  REVIEW_REQUIRED: "REVIEW_REQUIRED",
});

const QUALIFIER_STATE = Object.freeze({
  SATISFIED: "SATISFIED",
  INDETERMINATE: "INDETERMINATE",
  REVIEW_REQUIRED: "REVIEW_REQUIRED",
});

const HOLDER_IDENTITY_STATE = Object.freeze({
  IDENTIFIED: "IDENTIFIED",
  UNRESOLVED: "UNRESOLVED",
  UNKNOWN: "UNKNOWN",
});

const JOINT_ARRANGEMENT_QUALIFIER_STATE = Object.freeze({
  NO_RELEVANT_SIGNAL: "NO_RELEVANT_SIGNAL",
  NEGATIVE_ESTABLISHED: "NEGATIVE_ESTABLISHED",
  POSITIVE_SIGNAL: "POSITIVE_SIGNAL",
  UNKNOWN_MATERIAL: "UNKNOWN_MATERIAL",
});

const LAYER_CLOSURE_ERROR_CODE = Object.freeze({
  INVALID_INPUT: "INVALID_LAYER_CLOSURE_INPUT",
  INVALID_POLICY_PACK: "INVALID_LAYER_CLOSURE_POLICY_PACK",
  POLICY_IDENTITY_REQUIRED: "LAYER_CLOSURE_POLICY_IDENTITY_REQUIRED",
  POLICY_IDENTITY_MISMATCH: "LAYER_CLOSURE_POLICY_IDENTITY_MISMATCH",
  UNSUPPORTED_POLICY_SCHEMA: "UNSUPPORTED_LAYER_CLOSURE_POLICY_SCHEMA",
  UNSUPPORTED_METHOD: "UNSUPPORTED_LAYER_CLOSURE_METHOD",
  UNSUPPORTED_TARGET_PROFILE: "UNSUPPORTED_LAYER_CLOSURE_TARGET_PROFILE",
  INCOMPATIBLE_HOLDING_SEMANTICS: "INCOMPATIBLE_LAYER_CLOSURE_HOLDING_SEMANTICS",
  INFEASIBLE_DIRECT_TOTAL: "INFEASIBLE_LAYER_CLOSURE_DIRECT_TOTAL",
});

class LayerClosureError extends UboContractError {
  constructor(message, { code = LAYER_CLOSURE_ERROR_CODE.INVALID_INPUT, details, cause } = {}) {
    super(message, { code, cause });
    if (details !== undefined) this.details = deepFreeze(cloneData(details));
  }
}

function fail(message, code, details, cause) {
  throw new LayerClosureError(message, { code, details, cause });
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

function uniqueData(values) {
  const sorted = canonicalSort(values || []);
  return sorted.filter((value, index) => index === 0 || canonicalizeJson(value) !== canonicalizeJson(sorted[index - 1]));
}

function policyIdentity(policyPack, canonicalHash) {
  return {
    policyPackId: policyPack.policyPackId,
    version: policyPack.version,
    schemaVersion: policyPack.schemaVersion,
    canonicalHash,
  };
}

function validateLoadedPolicy(loaded) {
  if (!loaded || typeof loaded !== "object" || !loaded.policyPack || !loaded.identity) {
    fail("layer closure requires a loaded Policy Pack", LAYER_CLOSURE_ERROR_CODE.POLICY_IDENTITY_REQUIRED);
  }
  const policyPack = loaded.policyPack;
  // Compute identity before validation so an invalid firm-only overlay can be
  // reported without suppressing an otherwise valid statutory assessment.
  const canonicalHash = `sha256:${digest(policyPack)}`;
  const expected = {
    schemaId: policyPack.schemaId,
    schemaVersion: policyPack.schemaVersion,
    policyPackId: policyPack.policyPackId,
    version: policyPack.version,
    hash: canonicalHash,
  };
  if (Object.entries(expected).some(([field, value]) => loaded.identity[field] !== value)) {
    fail("loaded Policy Pack identity does not match canonical content", LAYER_CLOSURE_ERROR_CODE.POLICY_IDENTITY_MISMATCH);
  }
  let malformedFirmThreshold;
  try {
    validatePolicyPack(policyPack);
  } catch (cause) {
    const withoutFirm = cloneData(policyPack);
    withoutFirm.firmCollectionThreshold = {
      enabled: false,
      value: null,
      comparator: null,
      classification: "FREE_WITHIN_STRICTER_THAN_STATUTE",
      projectedRole: "firm_policy_qualifying_person",
      neverProjectsStatutoryRole: true,
    };
    try {
      validatePolicyPack(withoutFirm);
      malformedFirmThreshold = {
        code: "MALFORMED_FIRM_COLLECTION_THRESHOLD",
        reasonCode: "FIRM_THRESHOLD_CONFIGURATION_INVALID",
      };
    } catch (_notOnlyFirm) {
      fail("layer closure received an invalid Policy Pack", LAYER_CLOSURE_ERROR_CODE.INVALID_POLICY_PACK, undefined, cause);
    }
  }
  if (policyPack.schemaVersion !== "1.3") {
    fail("layer closure requires Policy Pack schema 1.3", LAYER_CLOSURE_ERROR_CODE.UNSUPPORTED_POLICY_SCHEMA);
  }
  if (policyPack.layerCompletenessDoctrine?.closureMethod !== LAYER_CLOSURE_ALGORITHM) {
    fail(`Policy Pack closure method must equal ${LAYER_CLOSURE_ALGORITHM}`, LAYER_CLOSURE_ERROR_CODE.UNSUPPORTED_METHOD);
  }
  return { policyPack, identity: policyIdentity(policyPack, canonicalHash), malformedFirmThreshold };
}

function entityProfile(targetEntity) {
  assertPlainObject(targetEntity, "targetEntity");
  assertDataOnly(targetEntity, "targetEntity");
  assertNonEmptyString(targetEntity.entityId, "targetEntity.entityId");
  if (targetEntity.category !== CANONICAL_ENTITY_CATEGORY.LEGAL_ENTITY) {
    fail("layer closure target must be a legal entity", LAYER_CLOSURE_ERROR_CODE.UNSUPPORTED_TARGET_PROFILE);
  }
  const profile = String(targetEntity.entityTypeMetadata?.entityProfile
    || targetEntity.entityTypeMetadata?.sourceEntityType
    || targetEntity.entityTypeMetadata?.legalEntityProfile
    || "UNKNOWN").toUpperCase();
  if (!["COMPANY", "LLP"].includes(profile)) {
    fail("layer closure supports only COMPANY and LLP targets", LAYER_CLOSURE_ERROR_CODE.UNSUPPORTED_TARGET_PROFILE, {
      targetEntityId: targetEntity.entityId,
      targetEntityProfile: profile,
      disposition: "REVIEW_SPECIALIST_PROFILE",
    });
  }
  return profile;
}

function caseReference(value) {
  if (value === undefined) return undefined;
  const reference = Number.isSafeInteger(value) ? { revision: value } : value;
  assertPlainObject(reference, "caseRevision");
  assertDataOnly(reference, "caseRevision");
  if (!Number.isSafeInteger(reference.revision) || reference.revision < 1) fail("case revision must be positive");
  if (reference.caseId !== undefined) assertNonEmptyString(reference.caseId, "caseRevision.caseId");
  if (reference.revisionId !== undefined) assertNonEmptyString(reference.revisionId, "caseRevision.revisionId");
  return {
    revision: reference.revision,
    ...(reference.caseId === undefined ? {} : { caseId: reference.caseId }),
    ...(reference.revisionId === undefined ? {} : { revisionId: reference.revisionId }),
  };
}

function graphReference(value) {
  if (value === undefined) return undefined;
  assertNonEmptyString(value, "graphVersion");
  const match = /^ubo-graph-v1:([a-f0-9]{64})$/.exec(value);
  if (!match) fail("graphVersion must carry a canonical graph fingerprint");
  return { graphVersion: value, graphFingerprint: `sha256:${match[1]}` };
}

function validateTimestamp(value, path) {
  assertNonEmptyString(value, path);
  if (Number.isNaN(Date.parse(value))) fail(`${path} must be an ISO-compatible timestamp`);
  return value;
}

function expectedBasis(profile, dimension) {
  if (dimension === GRAPH_DIMENSION.VOTING) return ["VOTING_RIGHTS"];
  return profile === "LLP"
    ? ["LLP_SURPLUS_ASSET_RIGHTS", "SURPLUS_ASSET_RIGHTS"]
    : ["COMPANY_SHARE_OWNERSHIP", "SHARE_OWNERSHIP"];
}

function holdingSemantic(holding) {
  return {
    relationshipId: holding.relationshipId,
    holderEntityId: holding.holderEntityId,
    targetEntityId: holding.targetEntityId,
    holderIdentityState: holding.holderIdentityState,
    targetEntityProfile: holding.targetEntityProfile,
    dimension: holding.dimension,
    interestBasis: holding.interestBasis,
    denominatorRef: holding.denominatorRef,
    interestClassRef: holding.interestClassRef || null,
    targetRightId: holding.targetRightId,
    interestSlotId: holding.interestSlotId || null,
    measurement: holding.measurement,
    temporalState: holding.temporalState,
    attributedCopyOfRightId: holding.attributedCopyOfRightId || null,
  };
}

function rightDecisionSemantic(holding) {
  const { relationshipId, ...semantic } = holdingSemantic(holding);
  return semantic;
}

function normalizeHolding(raw, index, targetEntityId, profile, dimension) {
  const path = `directHoldings[${index}]`;
  assertPlainObject(raw, path);
  assertDataOnly(raw, path);
  ["relationshipId", "holderEntityId", "targetEntityId", "holderIdentityState", "targetEntityProfile", "dimension",
    "interestBasis", "denominatorRef", "targetRightId", "temporalState"].forEach((field) => assertNonEmptyString(raw[field], `${path}.${field}`));
  if (raw.targetEntityId !== targetEntityId || raw.targetEntityProfile !== profile || raw.dimension !== dimension) {
    fail("direct holding target/profile/dimension conflicts with requested layer", LAYER_CLOSURE_ERROR_CODE.INCOMPATIBLE_HOLDING_SEMANTICS, { relationshipId: raw.relationshipId });
  }
  if (!Object.values(HOLDER_IDENTITY_STATE).includes(raw.holderIdentityState)) fail(`${path}.holderIdentityState is unsupported`);
  if (![TEMPORAL_STATE.CURRENT, TEMPORAL_STATE.CEASED, TEMPORAL_STATE.UNKNOWN, "HISTORICAL"].includes(raw.temporalState)) {
    fail(`${path}.temporalState is unsupported`);
  }
  if (!expectedBasis(profile, dimension).includes(raw.interestBasis)) {
    fail("direct holding legal/economic basis is incompatible with target profile and dimension", LAYER_CLOSURE_ERROR_CODE.INCOMPATIBLE_HOLDING_SEMANTICS, {
      relationshipId: raw.relationshipId,
      targetEntityProfile: profile,
      dimension,
      interestBasis: raw.interestBasis,
    });
  }
  assertPlainObject(raw.measurement, `${path}.measurement`);
  if (![PERCENTAGE_VALUE_TYPE.EXACT, PERCENTAGE_VALUE_TYPE.RANGE, PERCENTAGE_VALUE_TYPE.UNKNOWN].includes(raw.measurement.type)) {
    fail(`${path}.measurement.type is unsupported`);
  }
  if (raw.measurement.type !== PERCENTAGE_VALUE_TYPE.UNKNOWN) {
    if (raw.measurement.type === PERCENTAGE_VALUE_TYPE.RANGE
      && (typeof raw.measurement.lowerInclusive !== "boolean" || typeof raw.measurement.upperInclusive !== "boolean")) {
      fail(`${path}.measurement range endpoint inclusivity must be boolean`);
    }
    let interval;
    try {
      interval = intervalFromPercentageValue(raw.measurement);
    } catch (cause) {
      fail(`${path}.measurement is malformed`, LAYER_CLOSURE_ERROR_CODE.INVALID_INPUT, undefined, cause);
    }
    const zero = decimalNumberToRational(0);
    if (compare(interval.lower, zero) < 0 || compare(interval.upper, HUNDRED) > 0
      || compare(interval.lower, interval.upper) > 0
      || (compare(interval.lower, interval.upper) === 0 && (!interval.lowerInclusive || !interval.upperInclusive))) {
      fail(`${path}.measurement is outside the percentage domain`);
    }
  } else if (raw.measurement.reason !== undefined) {
    assertNonEmptyString(raw.measurement.reason, `${path}.measurement.reason`);
  }
  const operativeClaimReferences = raw.operativeClaimReferences || [];
  const evidenceReferences = raw.evidenceReferences || [];
  if (!Array.isArray(operativeClaimReferences) || !Array.isArray(evidenceReferences)) fail(`${path} support references must be arrays`);
  operativeClaimReferences.forEach((reference, referenceIndex) => assertNonEmptyString(reference, `${path}.operativeClaimReferences[${referenceIndex}]`));
  evidenceReferences.forEach((reference, referenceIndex) => validateEvidenceReference(reference, `${path}.evidenceReferences[${referenceIndex}]`));
  if (raw.interestClassRef !== undefined) assertNonEmptyString(raw.interestClassRef, `${path}.interestClassRef`);
  if (raw.interestSlotId !== undefined) assertNonEmptyString(raw.interestSlotId, `${path}.interestSlotId`);
  if (raw.attributedCopyOfRightId !== undefined) assertNonEmptyString(raw.attributedCopyOfRightId, `${path}.attributedCopyOfRightId`);
  return {
    ...holdingSemantic(raw),
    operativeClaimReferences: uniqueStrings(operativeClaimReferences),
    evidenceReferences: uniqueData(evidenceReferences),
  };
}

function references(context) {
  const values = context?.references || context?.supportingReferences || context?.blockingReferences || [];
  if (!Array.isArray(values)) fail("qualifier references must be an array");
  return uniqueData(values);
}

function qualifier(qualifierId, state, reasonCode, refs = []) {
  return { qualifierId, state, reasonCode, references: uniqueData(refs) };
}

function sumIntervals(intervals) {
  if (intervals.length === 0) {
    return {
      lower: decimalNumberToRational(0),
      upper: decimalNumberToRational(0),
      lowerInclusive: true,
      upperInclusive: true,
    };
  }
  return intervals.slice(1).reduce((sum, interval) => addIntervals(sum, interval), intervals[0]);
}

function complement(value) {
  return {
    numerator: HUNDRED.numerator * value.denominator - value.numerator * HUNDRED.denominator,
    denominator: HUNDRED.denominator * value.denominator,
  };
}

function residualInterval(sum) {
  const upperComparison = compare(sum.upper, HUNDRED);
  const feasibleUpper = upperComparison > 0 ? HUNDRED : sum.upper;
  const feasibleUpperInclusive = upperComparison > 0 ? true : sum.upperInclusive;
  return {
    lower: complement(feasibleUpper),
    upper: complement(sum.lower),
    lowerInclusive: feasibleUpperInclusive,
    upperInclusive: sum.lowerInclusive,
  };
}

function thresholdDescriptor(threshold, classification, dimension, reference) {
  return {
    value: threshold.value,
    comparator: threshold.comparator,
    classification,
    sourceClassification: threshold.classification,
    legalBasis: threshold.legalBasis || "FIRM_COLLECTION_POLICY",
    policyFieldReference: reference,
    dimension,
  };
}

function additionalPossible(residual, threshold) {
  const comparison = compare(residual.upper, decimalNumberToRational(threshold.value));
  if (threshold.comparator === ">") return comparison > 0;
  return comparison > 0 || (comparison === 0 && residual.upperInclusive);
}

function arithmeticClosure(residual, threshold) {
  const possible = additionalPossible(residual, threshold);
  return {
    state: possible ? LAYER_CLOSURE_STATE.OPEN : LAYER_CLOSURE_STATE.CLOSED,
    reasonCode: possible ? "ADDITIONAL_THRESHOLD_HOLDER_MATHEMATICALLY_POSSIBLE" : "NO_ADDITIONAL_THRESHOLD_HOLDER_MATHEMATICALLY_POSSIBLE",
    additionalQualifyingHolderPossible: possible,
  };
}

function applyQualifiers(arithmetic, qualifiers) {
  const review = qualifiers.filter(({ state }) => state === QUALIFIER_STATE.REVIEW_REQUIRED);
  if (review.length > 0) {
    return {
      state: LAYER_CLOSURE_STATE.REVIEW_REQUIRED,
      arithmeticState: arithmetic.state,
      reasonCode: "CLOSURE_REQUIRES_INTERPRETIVE_REVIEW",
      blockingQualifierIds: review.map(({ qualifierId }) => qualifierId).sort(),
      additionalQualifyingHolderPossible: arithmetic.additionalQualifyingHolderPossible,
    };
  }
  const blockers = qualifiers.filter(({ state }) => state === QUALIFIER_STATE.INDETERMINATE);
  if (blockers.length > 0) {
    return {
      state: LAYER_CLOSURE_STATE.INDETERMINATE,
      arithmeticState: arithmetic.state,
      reasonCode: "REQUIRED_CLOSURE_QUALIFIER_NOT_ESTABLISHED",
      blockingQualifierIds: blockers.map(({ qualifierId }) => qualifierId).sort(),
      additionalQualifyingHolderPossible: arithmetic.additionalQualifyingHolderPossible,
    };
  }
  return { ...arithmetic, arithmeticState: arithmetic.state, blockingQualifierIds: [] };
}

function firmThreshold(policyPack, malformedFirmThreshold, statutory) {
  if (malformedFirmThreshold) return { error: malformedFirmThreshold };
  const firm = policyPack.firmCollectionThreshold;
  if (firm.enabled !== true) return {};
  if (typeof firm.value !== "number" || !Number.isFinite(firm.value) || firm.value < 0 || firm.value > 100
    || ![">", ">="].includes(firm.comparator)) {
    return { error: { code: "MALFORMED_FIRM_COLLECTION_THRESHOLD", reasonCode: "FIRM_THRESHOLD_CONFIGURATION_INVALID" } };
  }
  const comparison = compare(decimalNumberToRational(firm.value), decimalNumberToRational(statutory.value));
  const equalButNarrower = comparison === 0 && statutory.comparator === ">=" && firm.comparator === ">";
  if (comparison > 0 || equalButNarrower) {
    return { error: { code: "UNSAFE_FIRM_COLLECTION_THRESHOLD", reasonCode: "FIRM_THRESHOLD_WOULD_IDENTIFY_FEWER_HOLDERS_THAN_STATUTE" } };
  }
  return { threshold: firm };
}

function assessLayerClosureV1({
  policyPack: loadedPolicyPack,
  targetEntity,
  dimension,
  directHoldings,
  denominatorContext,
  shareClassContext,
  conflictContext,
  jointArrangementContext,
  evaluationTime,
  caseRevision: suppliedCaseRevision,
  graphVersion,
}) {
  try {
    const policy = validateLoadedPolicy(loadedPolicyPack);
    const profile = entityProfile(targetEntity);
    if (![GRAPH_DIMENSION.ECONOMIC, GRAPH_DIMENSION.VOTING].includes(dimension)) fail("dimension must be ECONOMIC or VOTING");
    if (!Array.isArray(directHoldings)) fail("directHoldings must be an array");
    const normalized = directHoldings
      .map((holding, index) => normalizeHolding(holding, index, targetEntity.entityId, profile, dimension))
      .sort((left, right) => left.relationshipId.localeCompare(right.relationshipId));
    const caseRef = caseReference(suppliedCaseRevision);
    const graphRef = graphReference(graphVersion);
    const evaluatedAt = evaluationTime === undefined ? undefined : validateTimestamp(evaluationTime, "evaluationTime");

    [
      [denominatorContext, "denominatorContext"],
      [shareClassContext, "shareClassContext"],
      [conflictContext, "conflictContext"],
      [jointArrangementContext, "jointArrangementContext"],
    ].forEach(([context, path]) => {
      if (context !== undefined) {
        assertPlainObject(context, path);
        assertDataOnly(context, path);
      }
    });

    const denominatorState = denominatorContext?.state || "UNKNOWN";
    const denominatorRef = denominatorContext?.denominatorRef;
    if (denominatorRef !== undefined) assertNonEmptyString(denominatorRef, "denominatorContext.denominatorRef");
    const currentCandidates = normalized.filter(({ temporalState }) => ![TEMPORAL_STATE.CEASED, "HISTORICAL"].includes(temporalState));
    const incompatibleDenominatorIds = currentCandidates
      .filter((holding) => denominatorRef !== undefined && holding.denominatorRef !== denominatorRef)
      .map(({ relationshipId }) => relationshipId);

    const excluded = [];
    const eligible = [];
    normalized.forEach((holding) => {
      if (holding.attributedCopyOfRightId !== null) {
        excluded.push({ relationshipId: holding.relationshipId, targetRightId: holding.targetRightId, reasonCode: "ATTRIBUTED_COPY_OF_DIRECT_RIGHT" });
      } else if ([TEMPORAL_STATE.CEASED, "HISTORICAL"].includes(holding.temporalState)) {
        excluded.push({ relationshipId: holding.relationshipId, targetRightId: holding.targetRightId, reasonCode: "NON_CURRENT_HOLDING_EXCLUDED" });
      } else if (holding.temporalState === TEMPORAL_STATE.UNKNOWN) {
        excluded.push({ relationshipId: holding.relationshipId, targetRightId: holding.targetRightId, reasonCode: "HOLDING_CURRENTNESS_UNKNOWN" });
      } else if (incompatibleDenominatorIds.includes(holding.relationshipId)) {
        excluded.push({ relationshipId: holding.relationshipId, targetRightId: holding.targetRightId, reasonCode: "INCOMPATIBLE_DENOMINATOR" });
      } else if (holding.measurement.type === PERCENTAGE_VALUE_TYPE.UNKNOWN) {
        excluded.push({ relationshipId: holding.relationshipId, targetRightId: holding.targetRightId, reasonCode: "PERCENTAGE_UNKNOWN" });
      } else {
        eligible.push(holding);
      }
    });

    const byRight = new Map();
    eligible.forEach((holding) => {
      if (!byRight.has(holding.targetRightId)) byRight.set(holding.targetRightId, []);
      byRight.get(holding.targetRightId).push(holding);
    });
    const representatives = [];
    const overlapIds = [];
    for (const [targetRightId, holdings] of byRight.entries()) {
      const semantics = new Set(holdings.map((holding) => canonicalizeJson(rightDecisionSemantic(holding))));
      if (semantics.size > 1) {
        overlapIds.push(...holdings.map(({ relationshipId }) => relationshipId));
        holdings.forEach((holding) => excluded.push({ relationshipId: holding.relationshipId, targetRightId, reasonCode: "CONFLICTING_RECORDS_FOR_SAME_DIRECT_RIGHT" }));
        continue;
      }
      const representative = holdings[0];
      const duplicates = holdings.filter(({ relationshipId }) => relationshipId !== representative.relationshipId);
      representative.operativeClaimReferences = uniqueStrings(holdings.flatMap(({ operativeClaimReferences }) => operativeClaimReferences));
      representative.evidenceReferences = uniqueData(holdings.flatMap(({ evidenceReferences }) => evidenceReferences));
      representatives.push(representative);
      duplicates.forEach((holding) => excluded.push({ relationshipId: holding.relationshipId, targetRightId: holding.targetRightId, reasonCode: "DUPLICATE_SUPPORT_FOR_SAME_DIRECT_RIGHT" }));
    }
    const bySlot = new Map();
    representatives.forEach((holding) => {
      const slot = holding.interestSlotId || holding.targetRightId;
      if (!bySlot.has(slot)) bySlot.set(slot, []);
      bySlot.get(slot).push(holding);
    });
    const counted = [];
    for (const [slot, holdings] of bySlot.entries()) {
      if (holdings.length > 1) {
        overlapIds.push(...holdings.map(({ relationshipId }) => relationshipId));
        holdings.forEach((holding) => excluded.push({ relationshipId: holding.relationshipId, targetRightId: holding.targetRightId, interestSlotId: slot, reasonCode: "OVERLAPPING_DIRECT_INTEREST_SLOT" }));
      } else {
        counted.push(holdings[0]);
      }
    }
    counted.sort((left, right) => left.targetRightId.localeCompare(right.targetRightId));
    excluded.sort((left, right) => canonicalizeJson(left).localeCompare(canonicalizeJson(right)));

    const intervals = counted.map(({ measurement }) => intervalFromPercentageValue(measurement));
    const sum = sumIntervals(intervals);
    const lowerComparedToHundred = compare(sum.lower, HUNDRED);
    if (lowerComparedToHundred > 0 || (lowerComparedToHundred === 0 && !sum.lowerInclusive)) {
      fail("minimum attainable direct-layer total exceeds 100%", LAYER_CLOSURE_ERROR_CODE.INFEASIBLE_DIRECT_TOTAL, {
        directHoldingSumInterval: intervalToCalculatedValue(sum),
      });
    }
    const residual = residualInterval(sum);
    const sumValue = intervalToCalculatedValue(sum);
    const residualValue = intervalToCalculatedValue(residual);

    const unidentified = currentCandidates.filter(({ holderIdentityState }) => holderIdentityState !== HOLDER_IDENTITY_STATE.IDENTIFIED);
    const currentnessUnknown = currentCandidates.filter(({ temporalState }) => temporalState === TEMPORAL_STATE.UNKNOWN);
    const percentageUnknown = currentCandidates.filter(({ measurement }) => measurement.type === PERCENTAGE_VALUE_TYPE.UNKNOWN);
    const classState = shareClassContext?.state || ((profile === "COMPANY" && dimension === GRAPH_DIMENSION.ECONOMIC) ? "UNKNOWN" : "NOT_APPLICABLE");
    const conflictState = conflictContext?.state || "UNKNOWN_MATERIAL";
    const jointState = jointArrangementContext?.state || JOINT_ARRANGEMENT_QUALIFIER_STATE.UNKNOWN_MATERIAL;
    const jointMaterial = jointArrangementContext?.material !== false;

    const qualifiers = [
      qualifier(
        "HOLDERS_IDENTIFIED",
        unidentified.length === 0 ? QUALIFIER_STATE.SATISFIED : QUALIFIER_STATE.INDETERMINATE,
        unidentified.length === 0 ? "ALL_MATERIAL_HOLDERS_IDENTIFIED" : "MATERIAL_HOLDER_IDENTITY_UNRESOLVED",
        unidentified.map(({ holderEntityId }) => holderEntityId),
      ),
      qualifier(
        "COMPATIBLE_DENOMINATOR",
        denominatorState === "COMPATIBLE" && incompatibleDenominatorIds.length === 0 ? QUALIFIER_STATE.SATISFIED : QUALIFIER_STATE.INDETERMINATE,
        denominatorState === "COMPATIBLE" && incompatibleDenominatorIds.length === 0 ? "COMMON_DENOMINATOR_EXPLICITLY_ESTABLISHED" : "DENOMINATOR_COMPATIBILITY_NOT_ESTABLISHED",
        [...references(denominatorContext), ...incompatibleDenominatorIds],
      ),
      qualifier(
        "SHARE_CLASS_TREATMENT_SUFFICIENT",
        ["SUFFICIENT", "ESTABLISHED", "NON_MATERIAL", "NOT_APPLICABLE"].includes(classState) ? QUALIFIER_STATE.SATISFIED : QUALIFIER_STATE.INDETERMINATE,
        ["SUFFICIENT", "ESTABLISHED", "NON_MATERIAL", "NOT_APPLICABLE"].includes(classState) ? "SHARE_CLASS_TREATMENT_ESTABLISHED_OR_NON_MATERIAL" : "SHARE_CLASS_TREATMENT_NOT_ESTABLISHED",
        references(shareClassContext),
      ),
      qualifier(
        "NON_OVERLAPPING_INTERESTS",
        overlapIds.length === 0 ? QUALIFIER_STATE.SATISFIED : QUALIFIER_STATE.INDETERMINATE,
        overlapIds.length === 0 ? "DISTINCT_INTEREST_SLOTS_ESTABLISHED" : "OVERLAPPING_OR_CONFLICTING_INTEREST_SLOTS",
        overlapIds,
      ),
      qualifier(
        "CURRENTNESS_SUFFICIENT",
        currentnessUnknown.length === 0 ? QUALIFIER_STATE.SATISFIED : QUALIFIER_STATE.INDETERMINATE,
        currentnessUnknown.length === 0 ? "CURRENT_HOLDINGS_IDENTIFIED_AND_HISTORICAL_HOLDINGS_EXCLUDED" : "MATERIAL_HOLDING_CURRENTNESS_UNKNOWN",
        currentnessUnknown.map(({ relationshipId }) => relationshipId),
      ),
      qualifier(
        "NO_MATERIAL_CONTRADICTION",
        ["NONE", "NO_MATERIAL_CONTRADICTION"].includes(conflictState)
          ? QUALIFIER_STATE.SATISFIED
          : conflictState === "REVIEW_REQUIRED" ? QUALIFIER_STATE.REVIEW_REQUIRED : QUALIFIER_STATE.INDETERMINATE,
        ["NONE", "NO_MATERIAL_CONTRADICTION"].includes(conflictState)
          ? "NO_MATERIAL_CONTRADICTION_EXPLICITLY_REPORTED"
          : conflictState === "REVIEW_REQUIRED" ? "MATERIAL_CONTRADICTION_REQUIRES_REVIEW" : "MATERIAL_CONTRADICTION_UNRESOLVED",
        references(conflictContext),
      ),
      qualifier(
        "NO_OPEN_RELEVANT_JOINT_ARRANGEMENT",
        [JOINT_ARRANGEMENT_QUALIFIER_STATE.NO_RELEVANT_SIGNAL, JOINT_ARRANGEMENT_QUALIFIER_STATE.NEGATIVE_ESTABLISHED].includes(jointState) || !jointMaterial
          ? QUALIFIER_STATE.SATISFIED
          : jointState === JOINT_ARRANGEMENT_QUALIFIER_STATE.POSITIVE_SIGNAL ? QUALIFIER_STATE.REVIEW_REQUIRED : QUALIFIER_STATE.INDETERMINATE,
        !jointMaterial ? "JOINT_ARRANGEMENT_SIGNAL_EXPLICITLY_NON_MATERIAL"
          : jointState === JOINT_ARRANGEMENT_QUALIFIER_STATE.NO_RELEVANT_SIGNAL ? "CALLER_REPORTS_NO_RELEVANT_JOINT_SIGNAL"
            : jointState === JOINT_ARRANGEMENT_QUALIFIER_STATE.NEGATIVE_ESTABLISHED ? "ABSENCE_OF_JOINT_ARRANGEMENT_ESTABLISHED"
              : jointState === JOINT_ARRANGEMENT_QUALIFIER_STATE.POSITIVE_SIGNAL ? "POSITIVE_JOINT_ARRANGEMENT_SIGNAL_REQUIRES_REVIEW"
                : "MATERIAL_JOINT_ARRANGEMENT_STATE_UNKNOWN",
        references(jointArrangementContext),
      ),
    ];
    if (percentageUnknown.length > 0) {
      qualifiers.push(qualifier("PERCENTAGE_VALUES_ESTABLISHED", QUALIFIER_STATE.INDETERMINATE, "MATERIAL_PERCENTAGE_UNKNOWN", percentageUnknown.map(({ relationshipId }) => relationshipId)));
    }

    const thresholdKey = dimension === GRAPH_DIMENSION.ECONOMIC ? "economic" : "voting";
    const statutoryThreshold = policy.policyPack.statutoryThresholds[thresholdKey];
    const statutoryDescriptor = thresholdDescriptor(statutoryThreshold, "STATUTORY", dimension, `statutoryThresholds.${thresholdKey}`);
    const statutoryArithmetic = arithmeticClosure(residual, statutoryThreshold);
    const statutoryClosure = {
      threshold: statutoryDescriptor,
      residualInterval: residualValue,
      ...applyQualifiers(statutoryArithmetic, qualifiers),
    };

    const firm = firmThreshold(policy.policyPack, policy.malformedFirmThreshold, statutoryThreshold);
    let firmPolicyClosure;
    let firmPolicyConfigurationError;
    if (firm.threshold) {
      const descriptor = thresholdDescriptor(firm.threshold, "FIRM_POLICY", dimension, "firmCollectionThreshold");
      firmPolicyClosure = {
        threshold: descriptor,
        residualInterval: residualValue,
        ...applyQualifiers(arithmeticClosure(residual, firm.threshold), qualifiers),
      };
    } else if (firm.error) {
      firmPolicyConfigurationError = firm.error;
    }

    const nonPercentageBlockers = qualifiers
      .filter((item) => item.state !== QUALIFIER_STATE.SATISFIED && qualifierIsNonPercentage(item))
      .map(({ qualifierId }) => qualifierId);
    const precision = assessPercentagePrecisionV1({
      layerClosureAssessment: {
        ...(percentageUnknown.length === 0 ? { residualInterval: residualValue } : {}),
        thresholds: [statutoryDescriptor, ...(firmPolicyClosure ? [firmPolicyClosure.threshold] : [])],
        nonPercentageBlockers,
      },
    });
    const claimReferences = uniqueStrings(normalized.flatMap(({ operativeClaimReferences }) => operativeClaimReferences));
    const evidenceReferences = uniqueData(normalized.flatMap(({ evidenceReferences }) => evidenceReferences));
    const requiredSignoffIds = jointMaterial
      && [JOINT_ARRANGEMENT_QUALIFIER_STATE.POSITIVE_SIGNAL, JOINT_ARRANGEMENT_QUALIFIER_STATE.UNKNOWN_MATERIAL].includes(jointState)
      ? ["A-13"] : [];
    const semantic = {
      algorithmVersion: LAYER_CLOSURE_ALGORITHM,
      policyIdentity: policy.identity,
      caseReference: caseRef || null,
      graphReference: graphRef || null,
      targetEntityId: targetEntity.entityId,
      targetEntityProfile: profile,
      dimension,
      directHoldings: canonicalSort(normalized.map(holdingSemantic)),
      denominatorContext: { state: denominatorState, denominatorRef: denominatorRef || null, references: references(denominatorContext) },
      shareClassContext: { state: classState, references: references(shareClassContext) },
      conflictContext: { state: conflictState, references: references(conflictContext) },
      jointArrangementContext: { state: jointState, material: jointMaterial, references: references(jointArrangementContext) },
      evaluationTime: evaluatedAt || null,
      statutoryClosure,
      firmPolicyClosure: firmPolicyClosure || null,
      firmPolicyConfigurationError: firmPolicyConfigurationError || null,
      exactnessNeededForDetermination: precision,
      operativeClaimReferences: claimReferences,
      evidenceReferences,
    };
    return deepFreeze(cloneData({
      assessmentContractVersion: LAYER_CLOSURE_ASSESSMENT_VERSION,
      algorithmVersion: LAYER_CLOSURE_ALGORITHM,
      assessmentId: `${LAYER_CLOSURE_ASSESSMENT_VERSION}:${digest(semantic).slice(0, 32)}`,
      policyIdentity: policy.identity,
      ...(caseRef === undefined ? {} : { caseReference: caseRef }),
      ...(graphRef === undefined ? {} : { graphReference: graphRef }),
      ...(evaluatedAt === undefined ? {} : { evaluationTime: evaluatedAt }),
      targetEntity: { entityId: targetEntity.entityId, entityProfile: profile },
      dimension,
      countedDirectRightIds: counted.map(({ targetRightId }) => targetRightId).sort(),
      countedRelationshipIds: counted.map(({ relationshipId }) => relationshipId).sort(),
      excludedDirectRights: excluded,
      directHoldingSumInterval: sumValue,
      residualInterval: residualValue,
      qualifiers,
      statutoryClosure,
      ...(firmPolicyClosure === undefined ? {} : { firmPolicyClosure }),
      ...(firmPolicyConfigurationError === undefined ? {} : { firmPolicyConfigurationError }),
      additionalQualifyingHolderPossible: {
        value: statutoryClosure.state === LAYER_CLOSURE_STATE.INDETERMINATE || statutoryClosure.state === LAYER_CLOSURE_STATE.REVIEW_REQUIRED
          ? "unknown" : statutoryClosure.additionalQualifyingHolderPossible,
        arithmeticValue: statutoryArithmetic.additionalQualifyingHolderPossible,
        threshold: statutoryDescriptor,
        residualInterval: residualValue,
      },
      exactnessNeededForDetermination: precision,
      operativeClaimReferences: claimReferences,
      evidenceReferences,
      scope: "DIRECT_LAYER_PER_DIMENSION_REASONING_ONLY",
      governance: {
        governanceState: LAYER_CLOSURE_GOVERNANCE_STATE,
        productionAuthorized: false,
        requiredSignoffIds,
        policyStatus: policy.policyPack.status,
      },
    }));
  } catch (error) {
    if (error instanceof LayerClosureError) throw error;
    fail(error.message, LAYER_CLOSURE_ERROR_CODE.INVALID_INPUT, undefined, error);
  }
}

function qualifierIsNonPercentage(item) {
  return item.qualifierId !== "PERCENTAGE_VALUES_ESTABLISHED";
}

module.exports = {
  HOLDER_IDENTITY_STATE,
  JOINT_ARRANGEMENT_QUALIFIER_STATE,
  LAYER_CLOSURE_ALGORITHM,
  LAYER_CLOSURE_ASSESSMENT_VERSION,
  LAYER_CLOSURE_ERROR_CODE,
  LAYER_CLOSURE_GOVERNANCE_STATE,
  LAYER_CLOSURE_STATE,
  QUALIFIER_STATE,
  LayerClosureError,
  assessLayerClosureV1,
};
