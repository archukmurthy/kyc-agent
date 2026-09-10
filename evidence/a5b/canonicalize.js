"use strict";

const crypto = require("node:crypto");

const CANONICALIZATION_VERSION = "evidence-package-canonical-json-v1";
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;
const TIME_KEY = /(?:^asOf$|At$|Date$|^occurredAt$|^availableAt$)/;

function canonicalError(message) {
  return Object.assign(new Error(message), { code: "package_canonicalization_failed", statusCode: 400 });
}

function normalizedString(value, key) {
  if (UUID.test(value)) return value.toLowerCase();
  if (TIME_KEY.test(key || "") && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) throw canonicalError(`Invalid canonical timestamp at ${key}`);
    return parsed.toISOString();
  }
  return value;
}

function encode(value, key = "", path = "$") {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(normalizedString(value, key));
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw canonicalError(`Non-finite number at ${path}`);
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) return `[${value.map((item, index) => {
    if (item === undefined) throw canonicalError(`Undefined array value at ${path}[${index}]`);
    return encode(item, "", `${path}[${index}]`);
  }).join(",")}]`;
  if (typeof value === "object") {
    if (value instanceof Date) return JSON.stringify(value.toISOString());
    const keys = Object.keys(value).filter((item) => value[item] !== undefined).sort();
    return `{${keys.map((item) => `${JSON.stringify(item)}:${encode(value[item], item, `${path}.${item}`)}`).join(",")}}`;
  }
  throw canonicalError(`Unsupported canonical value at ${path}`);
}

function canonicalize(value) {
  return Buffer.from(encode(value), "utf8");
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

module.exports = { CANONICALIZATION_VERSION, canonicalize, sha256 };
