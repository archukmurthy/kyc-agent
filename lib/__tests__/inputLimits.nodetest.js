const { test } = require("node:test");
const assert = require("node:assert");
const { checkTextFields } = require("../inputLimits");

const LIMITS = { companyName: 200, country: 100, entityType: 64 };

test("all fields within limit pass", () => {
  assert.deepStrictEqual(checkTextFields({ companyName: "Acme", country: "UK" }, LIMITS), { ok: true });
});

test("absent and null fields are skipped, not errors", () => {
  assert.deepStrictEqual(checkTextFields({}, LIMITS), { ok: true });
  assert.deepStrictEqual(checkTextFields({ companyName: null }, LIMITS), { ok: true });
  assert.deepStrictEqual(checkTextFields(undefined, LIMITS), { ok: true });
});

test("an over-long value fails with its field name, without truncating", () => {
  const result = checkTextFields({ companyName: "x".repeat(201) }, LIMITS);
  assert.deepStrictEqual(result, { ok: false, field: "companyName" });
});

test("a value exactly at the limit passes", () => {
  assert.deepStrictEqual(checkTextFields({ companyName: "x".repeat(200) }, LIMITS), { ok: true });
});

test("a non-string value fails, regardless of length", () => {
  assert.deepStrictEqual(checkTextFields({ entityType: 42 }, LIMITS), { ok: false, field: "entityType" });
  assert.deepStrictEqual(checkTextFields({ entityType: {} }, LIMITS), { ok: false, field: "entityType" });
  assert.deepStrictEqual(checkTextFields({ entityType: ["x"] }, LIMITS), { ok: false, field: "entityType" });
  assert.deepStrictEqual(checkTextFields({ entityType: true }, LIMITS), { ok: false, field: "entityType" });
});

test("the first offending field (by limits key order) is reported", () => {
  const result = checkTextFields({ companyName: "x".repeat(201), country: "y".repeat(101) }, LIMITS);
  assert.strictEqual(result.field, "companyName");
});
