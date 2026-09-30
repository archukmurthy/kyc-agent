"use strict";

// The daily run that deletes non-buyers' trial workspaces (lib/uboTrialPurge.js).
// What these hold, after two reviews stopped earlier versions:
//   - rows first, all or nothing (db/tenantPurge.js); a workspace another one
//     touches is BLOCKED - reported, not forgotten, retried tomorrow
//   - the files about to lose their rows are recorded BEFORE the commit, and
//     deleted only after it, and only if no row still names them
//   - it runs nowhere unless switched on, and never on a workspace id that is
//     not a trial workspace or that is protected
//   - every access record pointing at the workspace goes, and only those

const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const { runTrialPurge } = require("../uboTrialPurge");

const DUE = { userId: "user_a", tenantId: "trial-acme-1a2b3c4d", code: "ACME-7D3K", company: "Acme", trialEndsAt: "2026-06-01T00:00:00.000Z" };
const FILE = { provider: "vercel_blob", key: "evidence/acme/chart.jpg" };

function harness({ due = [DUE], blocked = false, access = [{ userId: "user_a", tenantId: DUE.tenantId }, { userId: "user_colleague", tenantId: DUE.tenantId }, { userId: "user_elsewhere", tenantId: "acme-bank" }], fileStillNamed = false, fileFails = false, protectedIds = [], pending = [] } = {}) {
  const calls = [];
  const kv = new Map([["ubo-trial-purge:pending-files", pending]]);
  const deps = {
    trials: {
      dueForDeletion: async () => due,
      forgetTrial: async (w) => calls.push(["forgetTrial", w.userId]),
    },
    purgeTenant: async (db, tenantId, { dryRun = false, beforeCommit } = {}) => {
      calls.push([dryRun ? "plan" : "purgeTenant", tenantId]);
      if (blocked) return { tenantId, blocked: true, touches: { "referenced:x->y": 1 }, counts: { ubo_poc_cases: 1 }, files: [] };
      if (!dryRun && beforeCommit) {
        await beforeCommit([FILE]);
        calls.push(["pendingBeforeCommit", JSON.stringify(kv.get("ubo-trial-purge:pending-files"))]);
      }
      return { tenantId, blocked: false, counts: { ubo_poc_cases: 1 }, sharedRemoved: {}, files: [FILE] };
    },
    fileStillNamed: async () => fileStillNamed,
    deleteFile: async (file) => { calls.push(["deleteFile", file.key]); if (fileFails) throw new Error("blob store unavailable"); },
    forgetResearch: async (tenantId) => { calls.push(["forgetResearch", tenantId]); return 2; },
    listAccess: async (tenantId) => access.filter((entry) => entry.tenantId === tenantId),
    revokeAccess: async (userId) => calls.push(["revokeAccess", userId]),
    listPending: async () => [{ email: "a@acme.test", tenantId: DUE.tenantId }],
    cancelInvite: async (email) => calls.push(["cancelInvite", email]),
    isProtectedTenant: async (tenantId) => protectedIds.includes(tenantId),
    storage: { get: async (k) => kv.get(k) ?? null, set: async (k, v) => { kv.set(k, v); } },
  };
  return { calls, kv, run: (opts = {}) => runTrialPurge({ db: {}, now: Date.parse("2026-09-30T00:00:00.000Z"), deps, ...opts }) };
}

let saved;
beforeEach(() => { saved = process.env.UBO_TRIAL_PURGE_ENABLED; process.env.UBO_TRIAL_PURGE_ENABLED = "1"; });
afterEach(() => { if (saved === undefined) delete process.env.UBO_TRIAL_PURGE_ENABLED; else process.env.UBO_TRIAL_PURGE_ENABLED = saved; });

test("rows, then files, research, every access to the workspace, and the person", async () => {
  const { calls, run, kv } = harness();
  const result = await run();
  assert.deepStrictEqual(calls, [
    ["purgeTenant", DUE.tenantId],
    ["pendingBeforeCommit", JSON.stringify([FILE])],
    ["deleteFile", FILE.key],
    ["forgetResearch", DUE.tenantId],
    ["revokeAccess", "user_a"],
    ["revokeAccess", "user_colleague"],
    ["cancelInvite", "a@acme.test"],
    ["forgetTrial", "user_a"],
  ]);
  assert.deepStrictEqual(result.deleted.map((w) => w.tenantId), [DUE.tenantId]);
  assert.deepStrictEqual(kv.get("ubo-trial-purge:pending-files"), [], "a deleted file leaves the pending list");
  assert.strictEqual(kv.get(`ubo-trial-purge:failures:${DUE.tenantId}`), 0, "success resets the count");
});

test("a workspace another one touches is blocked: reported, nothing else done, not forgotten", async () => {
  const { calls, run } = harness({ blocked: true });
  const result = await run();
  assert.deepStrictEqual(calls, [["purgeTenant", DUE.tenantId]]);
  assert.deepStrictEqual(result.deleted, []);
  assert.deepStrictEqual(result.blocked, [{ tenantId: DUE.tenantId, touches: { "referenced:x->y": 1 } }]);
});

test("a file some remaining row still names is never deleted", async () => {
  const { calls, run } = harness({ fileStillNamed: true });
  await run();
  assert.ok(!calls.some(([step]) => step === "deleteFile"), JSON.stringify(calls));
});

test("a file that fails to delete stays on the list and is retried on the next run", async () => {
  const first = harness({ fileFails: true });
  await first.run();
  assert.deepStrictEqual(first.kv.get("ubo-trial-purge:pending-files"), [FILE]);

  const second = harness({ due: [], pending: [FILE] });
  await second.run();
  assert.deepStrictEqual(second.calls, [["deleteFile", FILE.key]]);
  assert.deepStrictEqual(second.kv.get("ubo-trial-purge:pending-files"), []);
});

test("a workspace is counted as attempted before it starts, so one that times out goes last next time", async () => {
  // A run killed by the platform's time limit never reaches its catch block.
  // The attempt must already be on record by then.
  const kv = new Map();
  let seenDuringPurge;
  await runTrialPurge({
    db: {},
    now: Date.parse("2026-09-30T00:00:00.000Z"),
    deps: {
      trials: { dueForDeletion: async () => [DUE], forgetTrial: async () => {} },
      purgeTenant: async () => { seenDuringPurge = kv.get(`ubo-trial-purge:failures:${DUE.tenantId}`); return { blocked: false, counts: {}, sharedRemoved: {}, files: [] }; },
      fileStillNamed: async () => false, deleteFile: async () => {}, forgetResearch: async () => 0,
      listAccess: async () => [], revokeAccess: async () => {}, listPending: async () => [], cancelInvite: async () => {},
      isProtectedTenant: async () => false,
      storage: { get: async (k) => kv.get(k) ?? null, set: async (k, v) => { kv.set(k, v); } },
    },
  });
  assert.strictEqual(seenDuringPurge, 1, "the attempt was not recorded before the purge started");
  assert.strictEqual(kv.get(`ubo-trial-purge:failures:${DUE.tenantId}`), 0, "and success cleared it");
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

test("a dry run deletes nothing and changes no counters", async () => {
  const { calls, run, kv } = harness();
  const result = await run({ dryRun: true });
  assert.deepStrictEqual(calls, [["plan", DUE.tenantId]]);
  assert.strictEqual(result.planned.length, 1);
  assert.strictEqual(kv.has(`ubo-trial-purge:failures:${DUE.tenantId}`), false);
});

test("the report names workspaces only, never a person or a company", async () => {
  const { run } = harness({ fileFails: true });
  const result = await run();
  assert.doesNotMatch(JSON.stringify(result), /user_a|Acme|acme\.test/);
});
