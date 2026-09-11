const test = require("node:test");
const assert = require("node:assert/strict");
const { ComplyCubeScreeningAdapter } = require("../providers/complyCubeScreeningAdapter");
const { assertScreeningProvider } = require("../contracts/screeningProvider");

const ccStub = {
  createClient: async () => ({ id: "cli_1" }),
  createScreeningCheck: async () => ({ id: "chk_1", status: "pending", result: {} }),
  getCheck: async () => ({ id: "chk_1", status: "complete", result: { outcome: "attention", breakdown: { summary: { pep: { pep: "attention" } }, matches: [{}] } } }),
};

test("adapter satisfies the ScreeningProvider contract", () => {
  assertScreeningProvider(new ComplyCubeScreeningAdapter());
});

test("screenPerson returns provider ids and a canonical result (null when pending)", async () => {
  const a = new ComplyCubeScreeningAdapter();
  const out = await a.screenPerson({ firstName: "A", lastName: "B" }, { complyCubeClient: ccStub });
  assert.equal(out.providerClientId, "cli_1");
  assert.equal(out.providerCheckId, "chk_1");
  // pending check (no outcome) -> result null
  assert.equal(out.result, null);
});

test("screenPerson returns canonical result when the check completes synchronously", async () => {
  const sync = { ...ccStub, createScreeningCheck: async () => ({ id: "chk_2", status: "complete", result: { outcome: "clear", breakdown: { summary: {}, matches: [] } } }) };
  const a = new ComplyCubeScreeningAdapter();
  const out = await a.screenPerson({ firstName: "A", lastName: "B" }, { complyCubeClient: sync });
  assert.equal(out.result.hit, false);
  assert.deepEqual(out.result.observations, { watchlist: false, pep: false, adverseMedia: false, other: false });
});

test("getCapabilities reports ongoingMonitoring false and getMonitoringStatus disabled", async () => {
  const a = new ComplyCubeScreeningAdapter();
  assert.equal(a.getCapabilities().ongoingMonitoring, false);
  assert.deepEqual(await a.getMonitoringStatus("ref"), { enabled: false });
});
