const { test } = require("node:test");
const assert = require("node:assert");
const { toComplyCubeNationality } = require("../iso3to2");

test("toComplyCubeNationality converts ISO-3 to ISO-2 when ComplyCube accepts it", () => {
  assert.strictEqual(toComplyCubeNationality("POL"), "PL");
  assert.strictEqual(toComplyCubeNationality("GBR"), "GB");
});

test("toComplyCubeNationality passes an already-ISO-2 code through when accepted", () => {
  assert.strictEqual(toComplyCubeNationality("PL"), "PL");
  assert.strictEqual(toComplyCubeNationality("gb"), "GB");
});

test("toComplyCubeNationality returns null for an unknown 3-letter code", () => {
  assert.strictEqual(toComplyCubeNationality("XYZ"), null);
});

test("toComplyCubeNationality returns null for an unknown/unaccepted 2-letter code", () => {
  assert.strictEqual(toComplyCubeNationality("ZZ"), null);
});

test("toComplyCubeNationality returns null when no code is given", () => {
  assert.strictEqual(toComplyCubeNationality(undefined), null);
  assert.strictEqual(toComplyCubeNationality(null), null);
  assert.strictEqual(toComplyCubeNationality(""), null);
});
