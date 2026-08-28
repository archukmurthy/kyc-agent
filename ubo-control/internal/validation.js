"use strict";

const { UboContractError } = require("../errors");

function fail(message, code = "INVALID_CONTRACT_VALUE") {
  throw new UboContractError(message, { code });
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertPlainObject(value, path) {
  if (!isPlainObject(value)) fail(`${path} must be a plain object`);
  return value;
}

function assertArray(value, path) {
  if (!Array.isArray(value)) fail(`${path} must be an array`);
  return value;
}

function assertNonEmptyString(value, path) {
  if (typeof value !== "string" || value.trim() === "") {
    fail(`${path} must be a non-empty string`);
  }
  return value;
}

function assertOptionalNonEmptyString(value, path) {
  if (value !== undefined) assertNonEmptyString(value, path);
}

function assertFinitePercentage(value, path) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) {
    fail(`${path} must be a finite number between 0 and 100`);
  }
  return value;
}

function assertEnum(value, allowed, path) {
  if (!Object.values(allowed).includes(value)) {
    fail(`${path} must be one of: ${Object.values(allowed).join(", ")}`);
  }
  return value;
}

function assertDataOnly(value, path = "value", seen = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;

  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail(`${path} must contain only finite JSON numbers`);
    return value;
  }

  if (typeof value !== "object") {
    fail(`${path} must contain JSON data only`);
  }

  if (seen.has(value)) fail(`${path} must not contain circular references`);
  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach((item, index) => assertDataOnly(item, `${path}[${index}]`, seen));
  } else {
    assertPlainObject(value, path);
    for (const [key, item] of Object.entries(value)) {
      assertDataOnly(item, `${path}.${key}`, seen);
    }
  }

  seen.delete(value);
  return value;
}

function cloneData(value) {
  assertDataOnly(value);
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

function assertUniqueStrings(values, path) {
  assertArray(values, path);
  const seen = new Set();
  values.forEach((value, index) => {
    assertNonEmptyString(value, `${path}[${index}]`);
    if (seen.has(value)) fail(`${path} contains duplicate identifier ${value}`);
    seen.add(value);
  });
  return values;
}

function assertAllowedKeys(value, allowedKeys, path) {
  assertPlainObject(value, path);
  const allowed = new Set(allowedKeys);
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key));
  if (unexpected.length > 0) {
    fail(`${path} contains unsupported field(s): ${unexpected.join(", ")}`);
  }
  return value;
}

module.exports = {
  assertAllowedKeys,
  assertArray,
  assertDataOnly,
  assertEnum,
  assertFinitePercentage,
  assertNonEmptyString,
  assertOptionalNonEmptyString,
  assertPlainObject,
  assertUniqueStrings,
  cloneData,
  deepFreeze,
  fail,
  isPlainObject,
};
