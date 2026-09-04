"use strict";

const { createHash } = require("node:crypto");
const { PERCENTAGE_VALUE_TYPE } = require("../contracts/constants");
const {
  HUNDRED,
  compare,
  decimalNumberToRational,
  intervalFromPercentageValue,
  rationalToDecimal,
} = require("../domain/exactPercentage");
const { UboContractError } = require("../errors");
const {
  assertDataOnly,
  assertNonEmptyString,
  assertPlainObject,
  cloneData,
  deepFreeze,
} = require("../internal/validation");
const { canonicalizeJson } = require("./canonicalJson");

const PERCENTAGE_PRECISION_ALGORITHM = "ubo-percentage-precision-v1";
const PERCENTAGE_PRECISION_ASSESSMENT_VERSION = "ubo-percentage-precision-assessment-v1";

const PERCENTAGE_PRECISION_STATE = Object.freeze({
  NOT_REQUIRED: "NOT_REQUIRED",
  REQUIRED_FOR_THRESHOLD_DETERMINATION: "REQUIRED_FOR_THRESHOLD_DETERMINATION",
  REQUIRED_FOR_LAYER_CLOSURE: "REQUIRED_FOR_LAYER_CLOSURE",
  BLOCKED_BY_NON_PERCENTAGE_FACT: "BLOCKED_BY_NON_PERCENTAGE_FACT",
  NOT_APPLICABLE: "NOT_APPLICABLE",
});

const PERCENTAGE_PRECISION_ERROR_CODE = Object.freeze({
  INVALID_INPUT: "INVALID_PERCENTAGE_PRECISION_INPUT",
  INVALID_THRESHOLD: "INVALID_PERCENTAGE_PRECISION_THRESHOLD",
});

class PercentagePrecisionError extends UboContractError {
  constructor(message, { code = PERCENTAGE_PRECISION_ERROR_CODE.INVALID_INPUT, details, cause } = {}) {
    super(message, { code, cause });
    if (details !== undefined) this.details = deepFreeze(cloneData(details));
  }
}

function fail(message, code, details, cause) {
  throw new PercentagePrecisionError(message, { code, details, cause });
}

function digest(value) {
  return createHash("sha256").update(canonicalizeJson(value), "utf8").digest("hex");
}

function thresholdDescriptor(threshold, path) {
  try {
    assertPlainObject(threshold, path);
    if ((typeof threshold.value !== "number" && typeof threshold.value !== "string")
      || String(threshold.value).trim() === "") throw new TypeError(`${path}.value must be a decimal percentage`);
    const value = decimalNumberToRational(threshold.value);
    if (compare(value, decimalNumberToRational(0)) < 0 || compare(value, decimalNumberToRational(100)) > 0) {
      throw new TypeError(`${path}.value must be between 0 and 100`);
    }
    if (![">", ">="].includes(threshold.comparator)) throw new TypeError(`${path}.comparator must be > or >=`);
    return {
      value: rationalToDecimal(value),
      comparator: threshold.comparator,
      classification: threshold.classification || "STATUTORY",
    };
  } catch (cause) {
    fail(cause.message, PERCENTAGE_PRECISION_ERROR_CODE.INVALID_THRESHOLD, undefined, cause);
  }
}

function thresholdSatisfiedAt(value, inclusive, threshold) {
  const comparison = compare(value, decimalNumberToRational(threshold.value));
  return threshold.comparator === ">"
    ? comparison > 0 || (comparison === 0 && !inclusive)
    : comparison >= 0;
}

function thresholdNotSatisfiedAt(value, inclusive, threshold) {
  const comparison = compare(value, decimalNumberToRational(threshold.value));
  return threshold.comparator === ">"
    ? comparison <= 0
    : comparison < 0 || (comparison === 0 && !inclusive);
}

function thresholdMetByEveryResidual(residual, threshold) {
  const value = residual.lower;
  const inclusive = residual.lowerInclusive;
  const comparison = compare(value, decimalNumberToRational(threshold.value));
  if (threshold.comparator === ">") return comparison > 0 || (comparison === 0 && !inclusive);
  return comparison >= 0;
}

function thresholdMetBySomeResidual(residual, threshold) {
  const comparison = compare(residual.upper, decimalNumberToRational(threshold.value));
  if (threshold.comparator === ">") return comparison > 0;
  return comparison > 0 || (comparison === 0 && residual.upperInclusive);
}

function normalizeBlockers(blockers) {
  if (!Array.isArray(blockers)) fail("nonPercentageBlockers must be an array");
  return [...new Set(blockers.map((blocker, index) => {
    if (typeof blocker === "string") return assertNonEmptyString(blocker, `nonPercentageBlockers[${index}]`);
    assertPlainObject(blocker, `nonPercentageBlockers[${index}]`);
    return assertNonEmptyString(blocker.qualifierId || blocker.code, `nonPercentageBlockers[${index}].qualifierId`);
  }))].sort();
}

function assessValue(value, threshold) {
  assertPlainObject(value, "value");
  if (![PERCENTAGE_VALUE_TYPE.EXACT, PERCENTAGE_VALUE_TYPE.RANGE, PERCENTAGE_VALUE_TYPE.UNKNOWN].includes(value.type)) {
    fail("value.type must be EXACT, RANGE or UNKNOWN");
  }
  if (value.type === PERCENTAGE_VALUE_TYPE.UNKNOWN) {
    return {
      state: PERCENTAGE_PRECISION_STATE.NOT_APPLICABLE,
      reasonCode: "UNKNOWN_VALUE_HAS_NO_ESTABLISHED_PRECISION_ROUTE",
      affectedClassifications: [],
    };
  }
  let interval;
  try {
    interval = intervalFromPercentageValue(value);
  } catch (cause) {
    fail("value must be a valid exact/range percentage", PERCENTAGE_PRECISION_ERROR_CODE.INVALID_INPUT, undefined, cause);
  }
  if (value.type === PERCENTAGE_VALUE_TYPE.RANGE
    && (typeof value.lowerInclusive !== "boolean" || typeof value.upperInclusive !== "boolean")) {
    fail("range endpoint inclusivity must be boolean");
  }
  const zero = decimalNumberToRational(0);
  if (compare(interval.lower, zero) < 0 || compare(interval.upper, HUNDRED) > 0
    || compare(interval.lower, interval.upper) > 0
    || (compare(interval.lower, interval.upper) === 0 && (!interval.lowerInclusive || !interval.upperInclusive))) {
    fail("value is outside the percentage domain");
  }
  if (value.type === PERCENTAGE_VALUE_TYPE.EXACT) {
    return {
      state: PERCENTAGE_PRECISION_STATE.NOT_REQUIRED,
      reasonCode: "EXACT_VALUE_ALREADY_ESTABLISHED",
      affectedClassifications: [],
    };
  }
  const whollyAbove = thresholdSatisfiedAt(interval.lower, interval.lowerInclusive, threshold);
  const whollyBelow = thresholdNotSatisfiedAt(interval.upper, interval.upperInclusive, threshold);
  if (whollyAbove || whollyBelow) {
    return {
      state: PERCENTAGE_PRECISION_STATE.NOT_REQUIRED,
      reasonCode: "RANGE_CANNOT_CHANGE_THRESHOLD_OUTCOME",
      affectedClassifications: [],
    };
  }
  return {
    state: PERCENTAGE_PRECISION_STATE.REQUIRED_FOR_THRESHOLD_DETERMINATION,
    reasonCode: "RANGE_CAN_CHANGE_THRESHOLD_OUTCOME",
    affectedClassifications: [threshold.classification],
  };
}

function assessLayer(layer) {
  assertPlainObject(layer, "layerClosureAssessment");
  const blockers = normalizeBlockers(layer.nonPercentageBlockers || []);
  const thresholds = (layer.thresholds || []).map((threshold, index) => thresholdDescriptor(threshold, `layerClosureAssessment.thresholds[${index}]`));
  if (blockers.length > 0) {
    return {
      state: PERCENTAGE_PRECISION_STATE.BLOCKED_BY_NON_PERCENTAGE_FACT,
      reasonCode: "NON_PERCENTAGE_QUALIFIER_PREVENTS_DECISION",
      blockers,
      affectedClassifications: [],
    };
  }
  if (!layer.residualInterval || thresholds.length === 0) {
    return {
      state: PERCENTAGE_PRECISION_STATE.NOT_APPLICABLE,
      reasonCode: "NO_COMPLETE_LAYER_INTERVAL_FOR_PRECISION_ASSESSMENT",
      affectedClassifications: [],
    };
  }
  let residual;
  try {
    residual = intervalFromPercentageValue(layer.residualInterval);
  } catch (cause) {
    fail("layerClosureAssessment.residualInterval must be a valid exact/range percentage", PERCENTAGE_PRECISION_ERROR_CODE.INVALID_INPUT, undefined, cause);
  }
  const affected = thresholds.filter((threshold) => (
    thresholdMetByEveryResidual(residual, threshold)
      !== thresholdMetBySomeResidual(residual, threshold)
  )).map(({ classification }) => classification).sort();
  if (affected.length > 0) {
    return {
      state: PERCENTAGE_PRECISION_STATE.REQUIRED_FOR_LAYER_CLOSURE,
      reasonCode: "HOLDING_RANGE_CAN_CHANGE_LAYER_CLOSURE",
      affectedClassifications: [...new Set(affected)],
    };
  }
  return {
    state: PERCENTAGE_PRECISION_STATE.NOT_REQUIRED,
    reasonCode: "LAYER_CLOSURE_CANNOT_CHANGE_WITHIN_ESTABLISHED_INTERVAL",
    affectedClassifications: [],
  };
}

function assessPercentagePrecisionV1(input) {
  try {
    assertPlainObject(input, "percentagePrecisionInput");
    assertDataOnly(input, "percentagePrecisionInput");
    const hasValue = input.value !== undefined || input.threshold !== undefined;
    const hasLayer = input.layerClosureAssessment !== undefined;
    if (hasValue === hasLayer || (hasValue && (input.value === undefined || input.threshold === undefined))) {
      fail("supply either value plus threshold, or layerClosureAssessment");
    }
    const mode = hasLayer ? "LAYER_CLOSURE" : "THRESHOLD_DETERMINATION";
    const normalizedThreshold = hasLayer ? undefined : thresholdDescriptor(input.threshold, "threshold");
    const decision = hasLayer
      ? assessLayer(input.layerClosureAssessment)
      : assessValue(input.value, normalizedThreshold);
    const semantic = {
      algorithmVersion: PERCENTAGE_PRECISION_ALGORITHM,
      mode,
      ...(hasLayer ? { layerClosureAssessment: cloneData(input.layerClosureAssessment) } : {
        value: cloneData(input.value),
        threshold: normalizedThreshold,
      }),
      decision,
    };
    return deepFreeze(cloneData({
      assessmentContractVersion: PERCENTAGE_PRECISION_ASSESSMENT_VERSION,
      algorithmVersion: PERCENTAGE_PRECISION_ALGORITHM,
      assessmentId: `${PERCENTAGE_PRECISION_ASSESSMENT_VERSION}:${digest(semantic).slice(0, 32)}`,
      mode,
      ...(hasLayer ? {} : { value: cloneData(input.value), threshold: normalizedThreshold }),
      ...decision,
    }));
  } catch (error) {
    if (error instanceof PercentagePrecisionError) throw error;
    fail(error.message, PERCENTAGE_PRECISION_ERROR_CODE.INVALID_INPUT, undefined, error);
  }
}

module.exports = {
  PERCENTAGE_PRECISION_ALGORITHM,
  PERCENTAGE_PRECISION_ASSESSMENT_VERSION,
  PERCENTAGE_PRECISION_ERROR_CODE,
  PERCENTAGE_PRECISION_STATE,
  PercentagePrecisionError,
  assessPercentagePrecisionV1,
};
