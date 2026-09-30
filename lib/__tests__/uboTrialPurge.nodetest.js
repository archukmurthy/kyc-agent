"use strict";

// The daily run that deletes non-buyers' trial workspaces (lib/uboTrialPurge.js).
// What these hold, after the first version was stopped in review:
//   - rows first, in one transaction; files only afterwards, and only a file
//     no remaining row names - a blocked delete must never cost anyone bytes
//   - it runs nowhere unless switched on, and never on a workspace id that is
//     not a trial workspace or that is protected
//   - access is removed only if it still points at the trial workspace

const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const { runTrialPurge } = require("../uboTrialPurge");

const DUE = { userId: "user_a", tenantId: "trial-acme-1a2b3c4d", code: "ACME-7D3K", company: "Acme", trialEndsAt: "2026-06-01T00:00:00.000Z" };
const FILE = { provider: "vercel_blob", key: "evidence/acme/chart.jpg" };

function harness({ due = [DUE], access = { tenantId: DUE.tenantId }, fileStillNamed = false, fileFails = false, protectedIds = [], pending = [] } = {}) {
  const calls = [];
  const kv = new Map([["ubo-trial-purge:pending-files", pending]]);
  const deps = {
    trials: {
      dueForDeletion: async () => due,
      forgetTrial: async (w) => calls.push(["forgetTrial", w.userId]),
    },
    purgeTenant: async (db, tenantId) => { calls.push(["purgeTenant", tenantId]); return { tenantId, counts: { ubo_poc_cases: 1 }, kept: {}, sharedRemoved: {}, files: [FILE] }; },
    fileStillNamed: async () => fileStillNamed,
    deleteFile: async (file) => { calls.push(["deleteFile", file.key]); if (fileFails) throw new Error("blob store unavailable"); },
    forgetResearch: async (tenantId) => { calls.push(["forgetResearch", tenantId]); return 2; },
    getAccess: async () => access,
    revokeAccess: async (userId) => calls.push(["revokeAccess", userId]),
    listPending: async () => [{ email: "a@acme.test", tenantId: DUE.tenantId }],
    cancelInvite: async (email) => calls.push(["cancelInvite", email]),
    isProtectedTenant: async (tenantId) => protectedIds.includes(tenantId),
    storage: { get: async (k) => kv.get(k) || null, set: async (k, v) => { kv.set(k, v); } },
  };
  return { calls, kv, run: (opts = {}) => runTrialPurge({ db: {}, now: Date.parse("2026-09-30T00:00:00.000Z"), deps, ...opts }) };
}

let saved;
beforeEach(() => { saved = process.env.UBO_TRIAL_PURGE_ENABLED; process.env.UBO_TRIAL_PURGE_ENABLED = "1"; });
afterEach(() => { if (saved === undefined) delete process.env.UBO_TRIAL_PURGE_ENABLED; else process.env.UBO_TRIAL_PURGE_ENABLED = saved; });

test("rows go first, then the files, the research, the access and the person", async () => {
  const { calls, run } = harness();
  const result = await run();
  assert.deepStrictEqual(calls, [
    ["purgeTenant", DUE.tenantId],
    ["deleteFile", FILE.key],
    ["forgetResearch", DUE.tenantId],
    ["revokeAccess", "user_a"],
    ["cancelInvite", "a@acme.test"],
    ["forgetTrial", "user_a"],
  ]);
  assert.deepStrictEqual(result.deleted.map((w) => w.tenantId), [DUE.tenantId]);
});

test("a file some remaining row still names is never deleted", async () => {
  const { calls, run } = harness({ fileStillNamed: true });
  await run();
  assert.ok(!calls.some(([step]) => step === "deleteFile"), JSON.stringify(calls));
});

test("a file that fails to delete is remembered and retried on the next run", async () => {
  const first = harness({ fileFails: true });
  await first.run();
  assert.deepStrictEqual(first.kv.get("ubo-trial-purge:pending-files"), [FILE]);

  const second = harness({ due: [], pending: [FILE] });
  await second.run();
  assert.deepStrictEqual(second.calls, [["deleteFile", FILE.key]]);
  assert.deepStrictEqual(second.kv.get("ubo-trial-purge:pending-files"), []);
});

test("nothing runs unless the purge is switched on for this deployment", async () => {
  delete process.env.UBO_TRIAL_PURGE_ENABLED;
  const { calls, run } = harness();
  const result = await run();
  assert.deepStrictEqual(calls, []);
  assert.strictEqual(result.disabled, true);
});

test("a workspace id that is not a trial workspace is refused, whatever the trial record says", async () => {
  const { calls, run } = harness({ due: [{ ...DUE, tenantId: "nium" }] });
  const result = await run();
  assert.deepStrictEqual(calls, []);
  assert.deepStrictEqual(result.failed, [{ tenantId: "nium", error: "not_a_trial_workspace" }]);
});

test("a protected workspace is never purged", async () => {
  const { calls, run } = harness({ protectedIds: [DUE.tenantId] });
  const result = await run();
  assert.deepStrictEqual(calls, []);
  assert.strictEqual(result.failed[0].error, "protected_workspace");
});

test("access that has moved to a real workspace is left alone", async () => {
  // A tester whose company bought and who was given access to the real
  // workspace, on a trial code nobody marked as a customer.
  const { calls, run } = harness({ access: { tenantId: "acme-bank" } });
  await run();
  assert.ok(!calls.some(([step]) => step === "revokeAccess"), JSON.stringify(calls));
});

test("the report names workspaces only, never a person or a company", async () => {
  const { run } = harness({ fileFails: true });
  const result = await run();
  assert.doesNotMatch(JSON.stringify(result), /user_a|Acme|acme\.test/);
});
