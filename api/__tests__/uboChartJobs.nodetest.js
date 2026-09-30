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
    requireUboCaller: async () => actor,
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
  }, { applyCors: () => false, enforceRateLimit: async () => true, requireUboCaller: async () => ({ kind: "staff", tenantId: "trial-acme-1a2b3c4d", role: "analyst" }), demoAllowance: { record: async () => {} } });
  await handler({ method: "POST", headers: {}, body: { demoContext: {}, file: {} } }, fakeRes());
  assert.strictEqual(queries.length, 1);
  assert.deepStrictEqual(queries[0].params, ["trial-acme-1a2b3c4d"]);
});

// Customers: a session for ONE case.
const CUSTOMER = { kind: "customer", tenantId: "trial-acme-1a2b3c4d", caseId: "case-1", role: "customer" };

function customerHandler() {
  const done = [];
  const job = { jobId: "job-1", state: "COMPLETE" };
  const handler = route.createHandler(null, async () => ({ ok: true }), () => ({
    service: {
      ownedByCase: async (jobId, caseId) => jobId === "job-1" && caseId === "case-1",
      start: async () => { done.push("start"); return job; },
      status: async () => { done.push("status"); return job; },
      process: async () => { done.push("process"); return job; },
      retry: async () => { done.push("retry"); return job; },
    },
    close: async () => {},
  }), { applyCors: () => false, enforceRateLimit: async () => true, requireUboCaller: async () => CUSTOMER, demoAllowance: { record: async () => {} } });
  return { handler, done };
}

test("a customer uploads a chart for their own case, and not for another", async () => {
  const { handler, done } = customerHandler();
  const own = fakeRes();
  await handler({ method: "POST", headers: {}, body: { demoContext: { demoCaseId: "case-1" }, file: {} } }, own);
  assert.strictEqual(own.statusCode, 200);
  const other = fakeRes();
  await handler({ method: "POST", headers: {}, body: { demoContext: { demoCaseId: "case-2" }, file: {} } }, other);
  assert.strictEqual(other.statusCode, 404);
  assert.deepStrictEqual(done, ["start"]);
});

test("a customer follows only their own case's jobs, checked before anything runs", async () => {
  const { handler, done } = customerHandler();
  for (const operation of ["GET_EXTRACTION_JOB", "PROCESS_EXTRACTION_JOB", "RETRY_EXTRACTION_JOB"]) {
    const res = fakeRes();
    await handler({ method: "POST", headers: {}, body: { operation, jobId: "job-of-another-case" } }, res);
    assert.strictEqual(res.statusCode, 404, operation);
  }
  assert.deepStrictEqual(done, [], "nothing was processed or retried for another case");
  const own = fakeRes();
  await handler({ method: "POST", headers: {}, body: { operation: "PROCESS_EXTRACTION_JOB", jobId: "job-1" } }, own);
  assert.strictEqual(own.statusCode, 200);
});

// UBO-35: support sees failed and stuck jobs, and a retry is paid for.
function supportHandler(actor, service, recorded) {
  return route.createHandler(null, undefined, () => ({ service, close: async () => {} }), {
    applyCors: () => false,
    enforceRateLimit: async (req, res, bucket) => { recorded.buckets.push(bucket); return true; },
    requireUboCaller: async () => actor,
    demoAllowance: { record: async (bucket) => { recorded.spent.push(bucket); } },
  });
}

test("staff see the jobs needing attention; a customer cannot list them", async () => {
  const recorded = { buckets: [], spent: [] };
  const service = { needingAttention: async () => [{ jobId: "job-9", state: "FAILED" }], ownedByCase: async () => true };
  const res = fakeRes();
  await supportHandler({ kind: "staff", tenantId: "acme", role: "analyst" }, service, recorded)({ method: "POST", headers: {}, body: { operation: "LIST_JOBS_NEEDING_ATTENTION" } }, res);
  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(res.body.jobs, [{ jobId: "job-9", state: "FAILED" }]);
  assert.deepStrictEqual(recorded.buckets, ["ubo-demo-chart-status"], "listing spends nothing");
  const customer = fakeRes();
  await supportHandler({ kind: "customer", tenantId: "acme", caseId: "case-1" }, service, recorded)({ method: "POST", headers: {}, body: { operation: "LIST_JOBS_NEEDING_ATTENTION" } }, customer);
  assert.strictEqual(customer.statusCode, 404);
});

test("a retry that runs the reading again counts toward the demo's uploads; one that does nothing does not", async () => {
  const recorded = { buckets: [], spent: [] };
  let queued = true;
  const service = { retry: async () => ({ jobId: "job-9", state: queued ? "QUEUED" : "COMPLETE", retried: queued }), ownedByCase: async () => true };
  const handler = supportHandler({ kind: "staff", tenantId: "acme", role: "analyst" }, service, recorded);
  await handler({ method: "POST", headers: {}, body: { operation: "RETRY_EXTRACTION_JOB", jobId: "job-9" } }, fakeRes());
  queued = false;
  await handler({ method: "POST", headers: {}, body: { operation: "RETRY_EXTRACTION_JOB", jobId: "job-9" } }, fakeRes());
  assert.deepStrictEqual(recorded.spent, ["ubo-demo-chart"]);
  assert.deepStrictEqual(recorded.buckets, ["ubo-demo-chart", "ubo-demo-chart"], "a retry is checked against the paid limit");
});
