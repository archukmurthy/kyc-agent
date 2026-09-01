"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const handler = require("../../api/ubo-control-lab");

function invoke(method, body) {
  return new Promise((resolve, reject) => {
    let statusCode = 200;
    const headers = {};
    const response = {
      status(code) { statusCode = code; return this; },
      setHeader(name, value) { headers[name.toLowerCase()] = value; return this; },
      json(payload) { resolve({ statusCode, headers, payload }); return this; },
    };
    Promise.resolve(handler({ method, body }, response)).catch(reject);
  });
}

test("Lab API exposes the fixture catalogue without cacheable state", async () => {
  const result = await invoke("GET");
  assert.equal(result.statusCode, 200);
  assert.equal(result.headers["cache-control"], "no-store");
  assert.equal(result.payload.fixtures.length, 18);
});

test("Lab API starts a deterministic fixture through the real engine", async () => {
  const result = await invoke("POST", {
    operation: "START_FIXTURE",
    payload: { fixtureId: "LAB02" },
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.mode, "FIXTURE");
  assert.equal(result.payload.snapshots[0].view.snapshot.snapshotSchemaVersion, "ubo-decision-snapshot-v1");
});

test("Lab API rejects unsupported operations without leaking implementation details", async () => {
  const result = await invoke("POST", { operation: "NOT_A_LAB_OPERATION" });
  assert.equal(result.statusCode, 400);
  assert.deepEqual(result.payload, { error: "Unsupported Lab operation" });
});

test("Lab API rejects unsupported methods", async () => {
  const result = await invoke("DELETE");
  assert.equal(result.statusCode, 405);
  assert.deepEqual(result.payload, { error: "Method not allowed" });
});
