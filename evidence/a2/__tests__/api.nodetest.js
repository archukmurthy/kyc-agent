"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const handler = require("../../../api/evidence/a2-collect");

function responseRecorder() {
  return { headers: {}, statusCode: 0, body: null, setHeader(k, v) { this.headers[k] = v; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}

test("A2 fixture API is explicitly labelled and returns inspectable lineage", async () => {
  const res = responseRecorder();
  await handler({ method: "POST", body: { mode: "fixture", producerRequestKey: "api-fixture", collectionCoordinates: { jurisdiction: "GB", companyNumber: "12345678" } } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.summary.mode, "fixture");
  assert.equal(res.body.summary.status, "successful");
  assert.ok(Object.keys(res.body.inspection.artifacts).length > 0);
});

test("A2 API rejects unsupported methods", async () => {
  const res = responseRecorder();
  await handler({ method: "GET" }, res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.Allow, "POST");
});
