"use strict";

const {
  assertDataOnly,
  assertEnum,
  assertFinitePercentage,
  assertOptionalNonEmptyString,
  assertPlainObject,
  fail,
} = require("../internal/validation");
const { PERCENTAGE_VALUE_TYPE } = require("./constants");

function validatePercentageValue(percentage, path = "percentage") {
  assertPlainObject(percentage, path);
  assertEnum(percentage.type, PERCENTAGE_VALUE_TYPE, `${path}.type`);

  if (percentage.type === PERCENTAGE_VALUE_TYPE.EXACT) {
    assertFinitePercentage(percentage.value, `${path}.value`);
  }

  if (percentage.type === PERCENTAGE_VALUE_TYPE.RANGE) {
    assertFinitePercentage(percentage.lowerBound, `${path}.lowerBound`);
    assertFinitePercentage(percentage.upperBound, `${path}.upperBound`);
    if (typeof percentage.lowerInclusive !== "boolean") {
      fail(`${path}.lowerInclusive must be boolean`);
    }
    if (typeof percentage.upperInclusive !== "boolean") {
      fail(`${path}.upperInclusive must be boolean`);
    }
    if (percentage.lowerBound > percentage.upperBound) {
      fail(`${path}.lowerBound must not exceed upperBound`);
    }
    if (
      percentage.lowerBound === percentage.upperBound &&
      (!percentage.lowerInclusive || !percentage.upperInclusive)
    ) {
      fail(`${path} must not describe an empty range`);
    }
  }

  if (percentage.type === PERCENTAGE_VALUE_TYPE.UNKNOWN) {
    assertOptionalNonEmptyString(percentage.reason, `${path}.reason`);
  }

  assertDataOnly(percentage, path);
  return true;
}

module.exports = { validatePercentageValue };
