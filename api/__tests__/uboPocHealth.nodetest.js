"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const health = require("../ubo-poc-health.js");

function response() {
  return {
    statusCode: null, body: null, headers: {},
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function withEnvironment(values, work) {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.entries(values).forEach(([key, value]) => { if (value == null) delete process.env[key]; else process.env[key] = value; });
  return Promise.resolve().then(work).finally(() => Object.entries(previous).forEach(([key, value]) => { if (value == null) delete process.env[key]; else process.env[key] = value; }));
}

test("internal POC health rejects unauthenticated requests without probing dependencies", async () => {
  await withEnvironment({ UBO_POC_HEALTH_KEY: "health-secret" }, async () => {
    let dbCalls = 0;
    const handler = health.createHandler({ dbFactory: () => { dbCalls += 1; throw new Error("must not run"); } });
    const res = response();
    await handler({ method: "GET", headers: {} }, res);
    assert.equal(res.statusCode, 401);
    assert.deepEqual(res.body, { error: "Unauthorized" });
    assert.equal(dbCalls, 0);
  });
});
test("internal POC health reports all configured dependencies without exposing secrets", async () => {
  await withEnvironment({
    UBO_POC_HEALTH_KEY: "health-secret",
    ANTHROPIC_API_KEY: "anthropic-secret",
    COMPANIES_HOUSE_API_KEY: "companies-house-secret",
    BLOB_READ_WRITE_TOKEN: "blob-secret",
  }, async () => {
    let query = 0;
    const db = {
      async query() {
        query += 1;
        if (query === 1) return { rows: [{}] };
        if (query === 2) return { rows: [{ artifacts: "evidence_artifacts", jobs: "evidence_customer_extraction_jobs" }] };
        return { rows: [{ queued: 0, stale: 0 }] };
      },
      async close() {},
    };
    const handler = health.createHandler({ dbFactory: () => db, fetchImpl: async () => ({ ok: true, status: 200 }) });
    const res = response();
    await handler({ method: "GET", headers: { "x-internal-health-key": "health-secret" } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.status, "healthy");
    assert.equal(res.body.checks.evidencePersistence.artifactStore, "vercel_blob");
    assert.equal(res.body.checks.extractionWorker.stale, 0);
    assert.doesNotMatch(JSON.stringify(res.body), /anthropic-secret|companies-house-secret|blob-secret|health-secret/);
  });
});
