"use strict";

const { assertDataOnly } = require("../internal/validation");

const CANONICALIZATION_ALGORITHM = "ubo-canonical-json-v1";

function serialize(value) {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(serialize).join(",")}]`;
  }

  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${serialize(value[key])}`).join(",")}}`;
}

function canonicalizeJson(value) {
  assertDataOnly(value, "canonicalJsonInput");
  return serialize(value);
}

module.exports = { CANONICALIZATION_ALGORITHM, canonicalizeJson };
