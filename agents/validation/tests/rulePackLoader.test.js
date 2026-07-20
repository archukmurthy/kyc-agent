const assert = require("assert");
const test = require("node:test");
const { loadRulePack, normalizeMarket } = require("../rulepacks/rulePackLoader");

test("rule pack loader resolves UK and Singapore LOA packs", () => {
  assert.strictEqual(loadRulePack({ market: "UK", documentType: "LOA" }).jurisdiction, "UK");
  assert.strictEqual(loadRulePack({ market: "SG", documentType: "LOA" }).jurisdiction, "SG");
});

test("rule pack loader normalizes common market aliases", () => {
  assert.strictEqual(normalizeMarket("GB"), "UK");
  assert.strictEqual(normalizeMarket("Singapore"), "SG");
});
