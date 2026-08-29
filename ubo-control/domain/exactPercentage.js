"use strict";

const { PERCENTAGE_VALUE_TYPE } = require("../contracts/constants");

const HUNDRED = Object.freeze({ numerator: 100n, denominator: 1n });

function greatestCommonDivisor(left, right) {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b !== 0n) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  return a;
}

function rational(numerator, denominator = 1n) {
  if (denominator === 0n) throw new Error("exact percentage denominator cannot be zero");
  const sign = denominator < 0n ? -1n : 1n;
  const divisor = greatestCommonDivisor(numerator, denominator);
  return Object.freeze({
    numerator: (numerator / divisor) * sign,
    denominator: (denominator / divisor) * sign,
  });
}

function decimalNumberToRational(value) {
  const source = String(value).toLowerCase();
  const [coefficient, exponentText] = source.split("e");
  const exponent = exponentText === undefined ? 0 : Number(exponentText);
  const negative = coefficient.startsWith("-");
  const unsigned = negative ? coefficient.slice(1) : coefficient;
  const [whole, fractional = ""] = unsigned.split(".");
  const digits = `${whole}${fractional}` || "0";
  const decimalPlaces = fractional.length - exponent;
  let numerator = BigInt(digits) * (negative ? -1n : 1n);
  let denominator = 1n;
  if (decimalPlaces > 0) denominator = 10n ** BigInt(decimalPlaces);
  if (decimalPlaces < 0) numerator *= 10n ** BigInt(-decimalPlaces);
  return rational(numerator, denominator);
}

function compare(left, right) {
  const difference = left.numerator * right.denominator - right.numerator * left.denominator;
  return difference === 0n ? 0 : difference < 0n ? -1 : 1;
}

function add(left, right) {
  return rational(
    left.numerator * right.denominator + right.numerator * left.denominator,
    left.denominator * right.denominator,
  );
}

function multiply(left, right) {
  return rational(left.numerator * right.numerator, left.denominator * right.denominator);
}

function divide(left, right) {
  return rational(left.numerator * right.denominator, left.denominator * right.numerator);
}

function isZero(value) {
  return value.numerator === 0n;
}

function intervalContainsZero(interval) {
  return isZero(interval.lower) && interval.lowerInclusive;
}

function exactInterval(value) {
  return Object.freeze({
    lower: value,
    upper: value,
    lowerInclusive: true,
    upperInclusive: true,
  });
}

function intervalFromPercentageValue(percentage) {
  if (percentage.type === PERCENTAGE_VALUE_TYPE.UNKNOWN) return null;
  if (percentage.type === PERCENTAGE_VALUE_TYPE.EXACT) {
    return exactInterval(decimalNumberToRational(percentage.value));
  }
  return Object.freeze({
    lower: decimalNumberToRational(percentage.lowerBound),
    upper: decimalNumberToRational(percentage.upperBound),
    lowerInclusive: percentage.lowerInclusive,
    upperInclusive: percentage.upperInclusive,
  });
}

function multiplyPercentageIntervals(left, right) {
  const lower = divide(multiply(left.lower, right.lower), HUNDRED);
  const upper = divide(multiply(left.upper, right.upper), HUNDRED);
  const lowerInclusive = isZero(lower)
    ? intervalContainsZero(left) || intervalContainsZero(right)
    : left.lowerInclusive && right.lowerInclusive;
  const upperInclusive = isZero(upper)
    ? intervalContainsZero(left) || intervalContainsZero(right)
    : left.upperInclusive && right.upperInclusive;
  return Object.freeze({ lower, upper, lowerInclusive, upperInclusive });
}

function addIntervals(left, right) {
  return Object.freeze({
    lower: add(left.lower, right.lower),
    upper: add(left.upper, right.upper),
    lowerInclusive: left.lowerInclusive && right.lowerInclusive,
    upperInclusive: left.upperInclusive && right.upperInclusive,
  });
}

function capPercentageInterval(interval) {
  const upperComparison = compare(interval.upper, HUNDRED);
  if (upperComparison < 0) return interval;
  if (upperComparison === 0) return interval;
  return Object.freeze({
    ...interval,
    upper: HUNDRED,
    upperInclusive: true,
  });
}

function rationalToDecimal(value) {
  let denominator = value.denominator;
  let powersOfTwo = 0;
  let powersOfFive = 0;
  while (denominator % 2n === 0n) {
    denominator /= 2n;
    powersOfTwo += 1;
  }
  while (denominator % 5n === 0n) {
    denominator /= 5n;
    powersOfFive += 1;
  }
  if (denominator !== 1n) throw new Error("exact percentage cannot be represented as a finite decimal");
  const scale = Math.max(powersOfTwo, powersOfFive);
  let scaled = value.numerator;
  scaled *= 2n ** BigInt(scale - powersOfTwo);
  scaled *= 5n ** BigInt(scale - powersOfFive);
  const negative = scaled < 0n;
  let digits = (negative ? -scaled : scaled).toString().padStart(scale + 1, "0");
  if (scale > 0) {
    digits = `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
    digits = digits.replace(/0+$/, "").replace(/\.$/, "");
  }
  return `${negative ? "-" : ""}${digits}`;
}

function intervalToCalculatedValue(interval) {
  const lower = rationalToDecimal(interval.lower);
  const upper = rationalToDecimal(interval.upper);
  if (compare(interval.lower, interval.upper) === 0 && interval.lowerInclusive && interval.upperInclusive) {
    return Object.freeze({ type: PERCENTAGE_VALUE_TYPE.EXACT, value: lower });
  }
  return Object.freeze({
    type: PERCENTAGE_VALUE_TYPE.RANGE,
    lowerBound: lower,
    upperBound: upper,
    lowerInclusive: interval.lowerInclusive,
    upperInclusive: interval.upperInclusive,
  });
}

module.exports = {
  HUNDRED,
  add,
  addIntervals,
  capPercentageInterval,
  compare,
  decimalNumberToRational,
  exactInterval,
  intervalFromPercentageValue,
  intervalToCalculatedValue,
  multiplyPercentageIntervals,
  rationalToDecimal,
};
