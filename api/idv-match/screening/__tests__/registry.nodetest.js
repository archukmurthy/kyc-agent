const test = require("node:test");
const assert = require("node:assert/strict");
const { getScreeningProvider } = require("../registry");
const { assertScreeningProvider } = require("../contracts/screeningProvider");

test("getScreeningProvider returns the ComplyCube adapter by name", () => {
  assertScreeningProvider(getScreeningProvider("complycube"));
});

test("getScreeningProvider throws on an unknown provider", () => {
  assert.throws(() => getScreeningProvider("nope"), /Unsupported screening provider: nope/);
});
