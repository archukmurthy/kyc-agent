const test = require("node:test");
const assert = require("node:assert/strict");
const { ScreeningProvider, REQUIRED_METHODS, assertScreeningProvider } = require("../contracts/screeningProvider");

test("REQUIRED_METHODS lists the screening contract", () => {
  assert.deepEqual(REQUIRED_METHODS, ["screenPerson", "getCapabilities", "getMonitoringStatus"]);
});

test("base ScreeningProvider methods throw Not implemented", async () => {
  const p = new ScreeningProvider();
  await assert.rejects(() => p.screenPerson({}), /Not implemented/);
});

test("assertScreeningProvider rejects an incomplete adapter naming the missing method", () => {
  assert.throws(() => assertScreeningProvider({ screenPerson() {}, getCapabilities() {} }), /getMonitoringStatus/);
});

test("assertScreeningProvider accepts a complete adapter", () => {
  const ok = { screenPerson() {}, getCapabilities() {}, getMonitoringStatus() {} };
  assert.equal(assertScreeningProvider(ok), ok);
});
