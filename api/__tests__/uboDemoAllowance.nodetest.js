"use strict";

// The demo's shared totals (lib/demoAllowance.js) are counted where money is
// actually spent: a live research run, a chart upload. A cached result, a
// status poll or a re-evaluation costs nothing and must not use one up.

const { test, afterEach } = require("node:test");
const assert = require("node:assert");

const discovery = require("../ubo-discovery");
const chart = require("../ubo-demo-customer-ownership-chart");

function fakeRes() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    setHeader() { return this; },
    json(value) { this.body = value; return this; },
    write() { return true; },
    end() { return this; },
  };
}

afterEach(() => discovery.__resetDeps());

function discoveryWith({ cached }) {
  const counted = [];
  discovery.__setDeps({
    requireStaff: async () => ({ kind: "staff", tenantId: "acme", role: "analyst" }),
    enforceRateLimit: async () => true,
    getFresh: async () => (cached ? { result: { status: "resolved", ownershipGraph: { edges: [] } }, cachedAt: "x", expiresAt: "y" } : null),
    runUboFramework: async () => ({ status: "partial", ownershipGraph: { nodes: [], edges: [] }, evidence: [], missingInformation: [] }),
    cacheResult: async () => ({}),
    appendAudit: async () => "audit-1",
    persistUboInvestigation: async () => ({ persisted: true }),
    demoAllowance: { record: async (bucket) => { counted.push(bucket); } },
  });
  return counted;
}

const RESEARCH = { method: "POST", headers: {}, body: { entityName: "Target Ltd", jurisdiction: "GB", forceRefresh: false } };

test("a live research run uses one of the demo's runs", async () => {
  const counted = discoveryWith({ cached: false });
  await discovery(RESEARCH, fakeRes());
  assert.deepStrictEqual(counted, ["ubo-discovery"]);
});

test("a research result served from cache uses none", async () => {
  const counted = discoveryWith({ cached: true });
  await discovery(RESEARCH, fakeRes());
  assert.deepStrictEqual(counted, []);
});

function chartWith() {
  const buckets = [];
  const counted = [];
  const job = { jobId: "job-1", state: "QUEUED", correlationId: "c-1" };
  const handler = chart.createHandler(null, async () => ({ contractVersion: "v1" }), () => ({
    service: { start: async () => job, status: async () => job, process: async () => job, retry: async () => job },
    close: async () => {},
  }), {
    applyCors: () => false,
    enforceRateLimit: async (req, res, bucket) => { buckets.push(bucket); return true; },
    requireStaff: async () => ({ kind: "staff", tenantId: "acme", role: "analyst" }),
    demoAllowance: { record: async (bucket) => { counted.push(bucket); } },
  });
  return { handler, buckets, counted };
}

test("a chart upload is one paid upload; its status polls are not", async () => {
  const { handler, buckets, counted } = chartWith();
  await handler({ method: "POST", headers: {}, body: { demoContext: {}, file: {} } }, fakeRes());
  for (let i = 0; i < 12; i += 1) {
    await handler({ method: "POST", headers: {}, body: { operation: "PROCESS_EXTRACTION_JOB", jobId: "job-1" } }, fakeRes());
    await handler({ method: "POST", headers: {}, body: { operation: "GET_EXTRACTION_JOB", jobId: "job-1" } }, fakeRes());
  }
  assert.deepStrictEqual(counted, ["ubo-demo-chart"]);
  assert.strictEqual(buckets.filter((b) => b === "ubo-demo-chart").length, 1, "polls must not spend the paid hourly limit");
  assert.strictEqual(buckets.filter((b) => b === "ubo-demo-chart-status").length, 24);
});

test("re-evaluating a saved result is not an upload", async () => {
  const { handler, buckets, counted } = chartWith();
  await handler({ method: "POST", headers: {}, body: { operation: "REEVALUATE_SAVED_EXTRACTION", savedResult: {} } }, fakeRes());
  assert.deepStrictEqual(counted, []);
  assert.deepStrictEqual(buckets, ["ubo-demo-chart-status"]);
});
