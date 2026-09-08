const { test } = require("node:test");
const assert = require("node:assert");
const { getAttemptStatus } = require("../status");
const { reconcileAttempt } = require("../reconcile");

// --- status (read-only, no PII) ---
test("getAttemptStatus returns status + booleans only, never identity PII", async () => {
  const store = {
    getAttempt: async () => ({
      id: "att-1",
      status: "Approved",
      verification_result: { status: "Approved", verified: true, mappedFields: { applicantFirstName: "Ada" } },
    }),
  };
  const out = await getAttemptStatus("att-1", { attemptStore: store });
  assert.deepStrictEqual(out, { attemptId: "att-1", status: "Approved", verified: true, hasResult: true });
  assert.ok(!("mappedFields" in out) && !JSON.stringify(out).includes("Ada"), "must not leak PII");
});

test("getAttemptStatus returns null for missing id / attempt", async () => {
  assert.strictEqual(await getAttemptStatus(null, { attemptStore: {} }), null);
  assert.strictEqual(await getAttemptStatus("x", { attemptStore: { getAttempt: async () => null } }), null);
});

// --- reconcile (server-side pull) ---
test("reconcileAttempt pulls the decision and stores it when not terminal", async () => {
  let updated = null;
  const store = {
    getAttempt: async () => ({ id: "att-1", didit_session_id: "sess-1", verification_result: null }),
    updateAttempt: async (id, patch) => { updated = { id, patch }; },
  };
  const r = await reconcileAttempt("att-1", {
    attemptStore: store,
    getDecision: async () => ({ status: "Approved" }),
    mapDecision: (d) => ({ status: d.status, verified: true, mappedFields: {}, extras: {} }),
    now: () => "2026-09-08T00:00:00.000Z",
  });
  assert.strictEqual(r.reconciled, true);
  assert.strictEqual(updated.patch.status, "Approved");
  assert.ok(updated.patch.verificationResult);
});

test("reconcileAttempt skips when already terminal or no session", async () => {
  const terminal = await reconcileAttempt("att-1", {
    attemptStore: { getAttempt: async () => ({ id: "att-1", didit_session_id: "s", verification_result: { status: "Declined" } }) },
  });
  assert.deepStrictEqual(terminal, { reconciled: false, reason: "already_terminal" });

  const noSession = await reconcileAttempt("att-1", {
    attemptStore: { getAttempt: async () => ({ id: "att-1", didit_session_id: null }) },
  });
  assert.deepStrictEqual(noSession, { reconciled: false, reason: "no_session" });
});
