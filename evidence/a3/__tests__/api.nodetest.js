"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const handler = require("../../../api/evidence/a3-fixture");

function recorder() { return { headers: {}, statusCode: 0, body: null, setHeader(k, v) { this.headers[k] = v; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } }; }

test("A3 fixture API requires no AI credentials or database and exposes qualified lineage", async () => {
  const res = recorder(); await handler({ method: "GET" }, res);
  assert.equal(res.statusCode, 200); assert.equal(res.body.stage, "A3"); assert.equal(res.body.fixture, true);
  assert.ok(res.body.facts.some((f) => f.requestStatus === "discovered"));
  assert.ok(res.body.qualifiedOutput); assert.equal(res.body.qualifiedOutput.supportState, "needs_verification");
  assert.deepEqual(res.body.verifications.map((v) => v.outcome).sort(), ["agreement", "disagreement"]);
});

test("A3 fixture API rejects non-GET methods", async () => { const res = recorder(); await handler({ method: "POST" }, res); assert.equal(res.statusCode, 405); assert.equal(res.headers.Allow, "GET"); });
