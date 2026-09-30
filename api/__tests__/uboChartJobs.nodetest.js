"use strict";

// Ownership-chart extraction jobs hold a customer's uploaded document and what
// was read from it. Every job lookup is scoped to a workspace inside the job
// service; these tests pin down that the workspace is the caller's - never a
// hard-coded default, never one named in the request.

const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");

const route = require("../ubo-demo-customer-ownership-chart");
const { CustomerOwnershipExtractionJobService } = require("../../evidence/customerOwnershipJobs/service");

function fakeRes() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    setHeader() { return this; },
    json(value) { this.body = value; return this; },
    end() { return this; },
  };
}

let factoryCalls;
function jobFactory(options) {
  factoryCalls.push(options);
  const job = { jobId: "job-1", state: "COMPLETE", correlationId: "c-1" };
  return { service: { start: async () => job, status: async () => job, process: async () => job, retry: async () => job }, close: async () => {} };
}

function handlerWith(actor) {
  return route.createHandler(null, undefined, jobFactory, {
    applyCors: () => false,
    enforceRateLimit: async () => true,
    requireStaff: async () => actor,
  });
}

let saved;
beforeEach(() => {
  factoryCalls = [];
  saved = { dev: process.env.UBO_DEV_TENANT_ID, vercel: process.env.VERCEL };
  delete process.env.UBO_DEV_TENANT_ID;
  delete process.env.VERCEL;
});
afterEach(() => {
  for (const [key, name] of [["dev", "UBO_DEV_TENANT_ID"], ["vercel", "VERCEL"]]) {
    if (saved[key] === undefined) delete process.env[name];
    else process.env[name] = saved[key];
  }
});

test("a job is looked up in the caller's own workspace", async () => {
  const handler = handlerWith({ kind: "staff", tenantId: "acme", role: "analyst" });
  const res = fakeRes();
  await handler({ method: "POST", headers: {}, body: { operation: "GET_EXTRACTION_JOB", jobId: "job-1" } }, res);
  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(factoryCalls, [{ tenantId: "acme" }]);
});

test("a workspace named in the request is ignored", async () => {
  const handler = handlerWith({ kind: "staff", tenantId: "acme", role: "analyst" });
  await handler({ method: "POST", headers: { "x-tenant-id": "victim" }, query: { tenant: "victim" }, body: { operation: "PROCESS_EXTRACTION_JOB", jobId: "job-1", tenantId: "victim" } }, fakeRes());
  assert.deepStrictEqual(factoryCalls, [{ tenantId: "acme" }]);
});

test("a caller with no workspace never reaches a job", async () => {
  const handler = handlerWith({ kind: "unauthenticated", tenantId: null, role: null });
  const res = fakeRes();
  await handler({ method: "POST", headers: {}, body: { operation: "RETRY_EXTRACTION_JOB", jobId: "job-1" } }, res);
  assert.strictEqual(res.statusCode, 400);
  assert.strictEqual(res.body.error, "tenant_required");
  assert.deepStrictEqual(factoryCalls, []);
});

test("the job service cannot be built without a workspace", () => {
  assert.throws(() => new CustomerOwnershipExtractionJobService({}), /tenant/i);
});

test("the caller's workspace row exists before a chart job is started", async () => {
  const queries = [];
  const handler = route.createHandler(null, undefined, (options) => {
    factoryCalls.push(options);
    const job = { jobId: "job-1", state: "QUEUED" };
    return { db: { query: async (text, params) => { queries.push({ text, params }); return { rows: [] }; } }, service: { start: async () => job }, close: async () => {} };
  }, { applyCors: () => false, enforceRateLimit: async () => true, requireStaff: async () => ({ kind: "staff", tenantId: "trial-acme-1a2b3c4d", role: "analyst" }), demoAllowance: { record: async () => {} } });
  await handler({ method: "POST", headers: {}, body: { demoContext: {}, file: {} } }, fakeRes());
  assert.strictEqual(queries.length, 1);
  assert.deepStrictEqual(queries[0].params, ["trial-acme-1a2b3c4d"]);
});
