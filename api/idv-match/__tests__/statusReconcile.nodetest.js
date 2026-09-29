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
      // Non-PII canonical bundle only (post-refactor). No mappedFields.
      verification_result: { providerStatus: "Approved", providerVerified: true, observations: [] },
    }),
  };
  const out = await getAttemptStatus("att-1", { attemptStore: store });
  assert.deepStrictEqual(out, { attemptId: "att-1", status: "Approved", verified: true, hasResult: true });
});

test("getAttemptStatus returns null for missing id / attempt", async () => {
  assert.strictEqual(await getAttemptStatus(null, { attemptStore: {} }), null);
  assert.strictEqual(await getAttemptStatus("x", { attemptStore: { getAttempt: async () => null } }), null);
});

// --- reconcile (server-side pull) ---
test("reconcileAttempt pulls the decision and persists it when not terminal", async () => {
  let persisted = null;
  const attempt = { id: "att-1", didit_session_id: "sess-1", status: "created" };
  const r = await reconcileAttempt("att-1", {
    attemptStore: { getAttempt: async () => attempt },
    getDecision: async () => ({ status: "Approved" }),
    persistDecision: async (args) => { persisted = args; return { providerStatus: "Approved" }; },
    now: () => "2026-09-08T00:00:00.000Z",
  });
  assert.strictEqual(r.reconciled, true);
  assert.strictEqual(r.status, "Approved");
  assert.strictEqual(persisted.attempt.id, "att-1");
  assert.deepStrictEqual(persisted.decision, { status: "Approved" });
});

test("reconcileAttempt skips when already terminal (by attempt status) or no session", async () => {
  const terminal = await reconcileAttempt("att-1", {
    attemptStore: { getAttempt: async () => ({ id: "att-1", didit_session_id: "s", status: "Declined" }) },
    persistDecision: async () => { throw new Error("must not persist a terminal attempt"); },
  });
  assert.deepStrictEqual(terminal, { reconciled: false, reason: "already_terminal" });

  const noSession = await reconcileAttempt("att-1", {
    attemptStore: { getAttempt: async () => ({ id: "att-1", didit_session_id: null }) },
  });
  assert.deepStrictEqual(noSession, { reconciled: false, reason: "no_session" });
});
