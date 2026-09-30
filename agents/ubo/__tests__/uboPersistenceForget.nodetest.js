"use strict";

// Deleting a non-buyer's trial workspace (lib/uboTrialPurge.js) must take its
// research with it. The caches expire on their own within 30 days; the audit
// snapshots do not, and each one holds the workspace's research.

const { test } = require("node:test");
const assert = require("node:assert");
const persistence = require("../uboPersistence");

function memoryStore(entries) {
  const data = new Map(Object.entries(entries));
  return {
    data,
    get: async (k) => (data.has(k) ? data.get(k) : null),
    list: async (prefix) => [...data.keys()].filter((k) => k.startsWith(prefix)),
    del: async (k) => { data.delete(k); },
  };
}

test("forgetting a workspace removes its research and audit snapshots, and nobody else's", async () => {
  const store = memoryStore({
    "ubo:audit:1": { id: "1", tenantId: "trial-acme-1", result: {} },
    "ubo:audit:2": { id: "2", tenantId: "trial-other-2", result: {} },
    "ubo:result:v1:trial-acme-1:abc": { result: {} },
    "ubo:web:v1:trial-acme-1:def": { value: {} },
    "ubo:result:v1:trial-other-2:abc": { result: {} },
  });
  const removed = await persistence.forgetTenant("trial-acme-1", store);
  assert.strictEqual(removed, 3);
  assert.deepStrictEqual([...store.data.keys()].sort(), ["ubo:audit:2", "ubo:result:v1:trial-other-2:abc"]);
});

test("a workspace must be named", async () => {
  await assert.rejects(persistence.forgetTenant("", memoryStore({})), /workspace/);
});
