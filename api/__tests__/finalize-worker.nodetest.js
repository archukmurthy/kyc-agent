// api/__tests__/finalize-worker.nodetest.js
const { test } = require("node:test");
const assert = require("node:assert");
const { runWorker } = require("../finalize-submissions");

test("finalizes each claimed row and marks it done", async () => {
  const done = [];
  const deps = {
    claimPending: async () => [
      { id: "a", tenant_id: "nium", payload: { submissionId: "a", tenantId: "nium", company: { name: "A" } } },
      { id: "b", tenant_id: "nium", payload: { submissionId: "b", tenantId: "nium", company: { name: "B" } } },
    ],
    finalizeSubmission: async (p) => ({ sessionId: "s-" + p.submissionId, clientId: "c", journeyId: "j" }),
    markDone: async (id) => { done.push(id); },
    markFailed: async () => { throw new Error("should not fail"); },
  };
  const r = await runWorker(deps);
  assert.deepStrictEqual(r, { claimed: 2, done: 2, failed: 0 });
  assert.deepStrictEqual(done.sort(), ["a", "b"]);
});

test("a row that throws is marked failed, and the batch continues", async () => {
  const failed = [], done = [];
  const deps = {
    claimPending: async () => [
      { id: "a", tenant_id: "nium", payload: { submissionId: "a", tenantId: "nium", company: { name: "A" } } },
      { id: "b", tenant_id: "nium", payload: { submissionId: "b", tenantId: "nium", company: { name: "B" } } },
    ],
    finalizeSubmission: async (p) => { if (p.submissionId === "a") throw new Error("boom"); return { sessionId: "s", clientId: "c", journeyId: "j" }; },
    markDone: async (id) => { done.push(id); },
    markFailed: async (id) => { failed.push(id); },
  };
  const r = await runWorker(deps);
  assert.deepStrictEqual(r, { claimed: 2, done: 1, failed: 1 });
  assert.deepStrictEqual(failed, ["a"]);
  assert.deepStrictEqual(done, ["b"]);
});
