"use strict";

// The public demo has a fixed number of paid runs for everyone together - 25
// research runs and 25 chart uploads - because it is paid for, not sold. These
// tests hold that line: counted once per paid run, refused after the last one,
// and absent entirely where the setting is not configured (the platform).

const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");

const allowance = require("../demoAllowance");

let store;
let saved;
beforeEach(() => {
  store = require("../storage").createMemoryStore();
  allowance.__setDeps({ storage: store });
  saved = { research: process.env.DEMO_TOTAL_RESEARCH_RUNS, chart: process.env.DEMO_TOTAL_CHART_UPLOADS };
  delete process.env.DEMO_TOTAL_RESEARCH_RUNS;
  delete process.env.DEMO_TOTAL_CHART_UPLOADS;
});
afterEach(() => {
  for (const [key, name] of [["research", "DEMO_TOTAL_RESEARCH_RUNS"], ["chart", "DEMO_TOTAL_CHART_UPLOADS"]]) {
    if (saved[key] === undefined) delete process.env[name];
    else process.env[name] = saved[key];
  }
});

test("with no total configured, nothing is ever refused and nothing is counted", async () => {
  for (let i = 0; i < 50; i += 1) await allowance.record("ubo-discovery");
  assert.deepStrictEqual(await allowance.check("ubo-discovery"), { blocked: false });
  assert.deepStrictEqual(await store.list(""), []);
});

test("runs counted at the same moment are all counted", async () => {
  process.env.DEMO_TOTAL_RESEARCH_RUNS = "100";
  await Promise.all(Array.from({ length: 20 }, () => allowance.record("ubo-discovery")));
  assert.strictEqual((await allowance.check("ubo-discovery")).used, 20);
});

test("the research total is shared by everyone and refuses after the last run", async () => {
  process.env.DEMO_TOTAL_RESEARCH_RUNS = "2";
  assert.strictEqual((await allowance.check("ubo-discovery")).blocked, false);
  await allowance.record("ubo-discovery");
  await allowance.record("ubo-discovery");
  const refused = await allowance.check("ubo-discovery");
  assert.strictEqual(refused.blocked, true);
  assert.strictEqual(refused.used, 2);
  assert.strictEqual(refused.limit, 2);
  assert.match(refused.message, /2 research runs/);
});

test("research and chart uploads are separate totals", async () => {
  process.env.DEMO_TOTAL_RESEARCH_RUNS = "1";
  process.env.DEMO_TOTAL_CHART_UPLOADS = "1";
  await allowance.record("ubo-discovery");
  assert.strictEqual((await allowance.check("ubo-discovery")).blocked, true);
  assert.strictEqual((await allowance.check("ubo-demo-chart")).blocked, false);
});

test("buckets outside the demo are never limited by it", async () => {
  process.env.DEMO_TOTAL_RESEARCH_RUNS = "1";
  await allowance.record("research");
  assert.deepStrictEqual(await allowance.check("research"), { blocked: false });
});

test("a nonsense setting means no total, not a total of zero", async () => {
  process.env.DEMO_TOTAL_CHART_UPLOADS = "lots";
  await allowance.record("ubo-demo-chart");
  assert.strictEqual((await allowance.check("ubo-demo-chart")).blocked, false);
});
