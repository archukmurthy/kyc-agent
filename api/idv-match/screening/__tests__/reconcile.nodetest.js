const { test } = require("node:test");
const assert = require("node:assert");
const { reconcileScreening } = require("../index");

// Minimal check payload shaped like interpretCheck expects, grading "attention".
function attentionCheck(id) {
  return {
    id,
    status: "complete",
    result: {
      outcome: "attention",
      breakdown: { summary: { watchlist: "attention" }, matches: [{}] },
    },
  };
}

test("reconcileScreening pulls a pending check and stores the attention outcome", async () => {
  const updates = [];
  const rows = [{ id: "row-1", status: "pending", outcome: null, complycube_check_id: "cc-check-1" }];
  const deps = {
    store: {
      listByAttempt: async () => rows,
      updateScreeningResult: async (id, patch) => { updates.push({ id, patch }); },
    },
    complyCubeClient: {
      getCheck: async (checkId) => attentionCheck(checkId),
    },
  };
  await reconcileScreening("att-1", deps);
  assert.strictEqual(updates.length, 1);
  assert.strictEqual(updates[0].id, "row-1");
  assert.strictEqual(updates[0].patch.outcome, "attention");
});

test("reconcileScreening skips rows that are already complete - getCheck not called", async () => {
  const rows = [{ id: "row-1", status: "complete", outcome: "clear", complycube_check_id: "cc-check-1" }];
  let getCheckCalls = 0;
  const deps = {
    store: {
      listByAttempt: async () => rows,
      updateScreeningResult: async () => { throw new Error("must not be called"); },
    },
    complyCubeClient: {
      getCheck: async () => { getCheckCalls += 1; return attentionCheck("x"); },
    },
  };
  await reconcileScreening("att-1", deps);
  assert.strictEqual(getCheckCalls, 0);
});

test("reconcileScreening swallows a getCheck failure and still processes other pending rows", async () => {
  const updates = [];
  const rows = [
    { id: "row-1", status: "pending", outcome: null, complycube_check_id: "cc-check-1" },
    { id: "row-2", status: "pending", outcome: null, complycube_check_id: "cc-check-2" },
  ];
  const deps = {
    store: {
      listByAttempt: async () => rows,
      updateScreeningResult: async (id, patch) => { updates.push({ id, patch }); },
    },
    complyCubeClient: {
      getCheck: async (checkId) => {
        if (checkId === "cc-check-1") throw new Error("ComplyCube outage");
        return attentionCheck(checkId);
      },
    },
  };
  await assert.doesNotReject(reconcileScreening("att-1", deps));
  assert.strictEqual(updates.length, 1);
  assert.strictEqual(updates[0].id, "row-2");
});
