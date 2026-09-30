"use strict";

// The daily run that deletes non-buyers' trial workspaces. Order matters, and
// so does what happens when a step fails: uploaded files go FIRST, so a file
// is never left behind with no database row pointing at it; if a file cannot
// be deleted, that workspace is left whole for tomorrow's run.

const { test } = require("node:test");
const assert = require("node:assert");
const { runTrialPurge } = require("../uboTrialPurge");

const DUE = { userId: "user_a", tenantId: "trial-acme-1", code: "ACME-7D3K", company: "Acme", trialEndsAt: "2026-06-01T00:00:00.000Z" };

function harness({ due = [DUE], failFile = false } = {}) {
  const calls = [];
  const deps = {
    trials: {
      dueForDeletion: async () => due,
      forgetTrial: async (w, { deletedAt }) => calls.push(["forgetTrial", w.userId, Boolean(deletedAt)]),
    },
    purgeTenant: async (db, tenantId, { dryRun = false } = {}) => {
      calls.push([dryRun ? "plan" : "purgeTenant", tenantId]);
      return { tenantId, dryRun, counts: { ubo_poc_cases: 1 }, sharedRemoved: {}, storageKeys: ["evidence/acme/chart.jpg"] };
    },
    forgetResearch: async (tenantId) => { calls.push(["forgetResearch", tenantId]); return 2; },
    revokeAccess: async (userId) => calls.push(["revokeAccess", userId]),
  };
  const artifactStore = {
    delete: async (key) => {
      calls.push(["deleteFile", key]);
      if (failFile) throw new Error("blob store unavailable");
    },
  };
  return { calls, run: (opts = {}) => runTrialPurge({ db: {}, artifactStore, now: Date.parse("2026-09-30T00:00:00.000Z"), deps, ...opts }) };
}

test("files go first, then the rows, the research, the access and the person", async () => {
  const { calls, run } = harness();
  const result = await run();
  assert.deepStrictEqual(calls, [
    ["plan", "trial-acme-1"],
    ["deleteFile", "evidence/acme/chart.jpg"],
    ["purgeTenant", "trial-acme-1"],
    ["forgetResearch", "trial-acme-1"],
    ["revokeAccess", "user_a"],
    ["forgetTrial", "user_a", true],
  ]);
  assert.strictEqual(result.deleted.length, 1);
  assert.deepStrictEqual(result.failed, []);
});

test("a file that cannot be deleted leaves the whole workspace for tomorrow", async () => {
  const { calls, run } = harness({ failFile: true });
  const result = await run();
  assert.ok(!calls.some(([step]) => ["purgeTenant", "forgetResearch", "revokeAccess", "forgetTrial"].includes(step)), JSON.stringify(calls));
  assert.strictEqual(result.deleted.length, 0);
  assert.strictEqual(result.failed.length, 1);
  assert.strictEqual(result.failed[0].tenantId, "trial-acme-1");
  assert.doesNotMatch(JSON.stringify(result), /user_a|Acme/, "the report names workspaces, not people or companies");
});

test("a dry run says what would go and deletes nothing", async () => {
  const { calls, run } = harness();
  const result = await run({ dryRun: true });
  assert.deepStrictEqual(calls, [["plan", "trial-acme-1"]]);
  assert.strictEqual(result.planned.length, 1);
  assert.deepStrictEqual(result.planned[0].counts, { ubo_poc_cases: 1 });
});

test("with nothing due, nothing is touched", async () => {
  const { calls, run } = harness({ due: [] });
  const result = await run();
  assert.deepStrictEqual(calls, []);
  assert.deepStrictEqual(result, { deleted: [], failed: [], planned: [] });
});
