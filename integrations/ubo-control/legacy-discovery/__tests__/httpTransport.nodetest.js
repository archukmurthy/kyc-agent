"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createHttpLegacyDiscoveryTransport } = require("..");

test("production HTTP transport posts JSON to the configured base URL", async () => {
  const calls = [];
  const transport = createHttpLegacyDiscoveryTransport({
    baseUrl: "https://controlled.example",
    fetchImpl: async (...args) => {
      calls.push(args);
      return { status: 200, async text() { return '{"ownershipGraph":{"nodes":[],"edges":[]},"evidence":[]}'; } };
    },
  });
  const response = await transport.invoke({ method: "POST", path: "/api/ubo-discovery", body: { entityName: "Example" } });
  assert.equal(calls[0][0], "https://controlled.example/api/ubo-discovery");
  assert.equal(calls[0][1].method, "POST");
  assert.equal(calls[0][1].body, '{"entityName":"Example"}');
  assert.deepEqual(response, { status: 200, body: { ownershipGraph: { nodes: [], edges: [] }, evidence: [] } });
});

test("transport rejects missing, relative, credential-bearing, or non-HTTP configuration", () => {
  for (const baseUrl of [undefined, "/local", "ftp://example.test", "https://user:secret@example.test"]) {
    assert.throws(() => createHttpLegacyDiscoveryTransport({ baseUrl, fetchImpl: async () => {} }), TypeError);
  }
});

test("transport preserves malformed JSON as a non-object body for conservative adapter failure", async () => {
  const transport = createHttpLegacyDiscoveryTransport({
    baseUrl: "http://127.0.0.1:3000",
    fetchImpl: async () => ({ status: 200, async text() { return "not-json"; } }),
  });
  assert.deepEqual(
    await transport.invoke({ method: "POST", path: "/api/ubo-discovery", body: {} }),
    { status: 200, body: "not-json" },
  );
});

test("transport converts an aborted request into a stable timeout error", async () => {
  const transport = createHttpLegacyDiscoveryTransport({
    baseUrl: "http://127.0.0.1:3000",
    timeoutMs: 5,
    fetchImpl: async (_url, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    }),
  });
  await assert.rejects(
    () => transport.invoke({ method: "POST", path: "/api/ubo-discovery", body: {} }),
    (error) => error.code === "ETIMEDOUT",
  );
});
