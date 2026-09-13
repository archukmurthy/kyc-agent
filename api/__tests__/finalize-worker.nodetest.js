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
    countDeadLettered: async () => 0,
  };
  const r = await runWorker(deps);
  assert.deepStrictEqual(r, { claimed: 2, done: 2, failed: 0, deadLettered: 0 });
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
    countDeadLettered: async () => 0,
  };
  const r = await runWorker(deps);
  assert.deepStrictEqual(r, { claimed: 2, done: 1, failed: 1, deadLettered: 0 });
  assert.deepStrictEqual(failed, ["a"]);
  assert.deepStrictEqual(done, ["b"]);
});

test("returns a deadLettered field sourced from countDeadLettered", async () => {
  const deps = {
    claimPending: async () => [],
    finalizeSubmission: async () => ({ sessionId: "s" }),
    markDone: async () => {},
    markFailed: async () => {},
    countDeadLettered: async () => 4,
  };
  const r = await runWorker(deps);
  assert.deepStrictEqual(r, { claimed: 0, done: 0, failed: 0, deadLettered: 4 });
});

test("passes limit=20/staleSeconds=300 defaults to claimPending when env is unset", async () => {
  const prevLimit = process.env.FINALIZE_BATCH_LIMIT;
  const prevStale = process.env.FINALIZE_STALE_SECONDS;
  delete process.env.FINALIZE_BATCH_LIMIT;
  delete process.env.FINALIZE_STALE_SECONDS;
  let captured;
  try {
    await runWorker({
      claimPending: async (opts) => { captured = opts; return []; },
      finalizeSubmission: async () => ({}),
      markDone: async () => {},
      markFailed: async () => {},
      countDeadLettered: async () => 0,
    });
  } finally {
    if (prevLimit === undefined) delete process.env.FINALIZE_BATCH_LIMIT; else process.env.FINALIZE_BATCH_LIMIT = prevLimit;
    if (prevStale === undefined) delete process.env.FINALIZE_STALE_SECONDS; else process.env.FINALIZE_STALE_SECONDS = prevStale;
  }
  assert.deepStrictEqual(captured, { limit: 20, staleSeconds: 300 });
});

test("falls back to defaults when env values are negative", async () => {
  const prevLimit = process.env.FINALIZE_BATCH_LIMIT;
  const prevStale = process.env.FINALIZE_STALE_SECONDS;
  process.env.FINALIZE_BATCH_LIMIT = "-5";
  process.env.FINALIZE_STALE_SECONDS = "-60";
  let captured;
  try {
    await runWorker({
      claimPending: async (opts) => { captured = opts; return []; },
      finalizeSubmission: async () => ({}),
      markDone: async () => {},
      markFailed: async () => {},
      countDeadLettered: async () => 0,
    });
  } finally {
    if (prevLimit === undefined) delete process.env.FINALIZE_BATCH_LIMIT; else process.env.FINALIZE_BATCH_LIMIT = prevLimit;
    if (prevStale === undefined) delete process.env.FINALIZE_STALE_SECONDS; else process.env.FINALIZE_STALE_SECONDS = prevStale;
  }
  assert.deepStrictEqual(captured, { limit: 20, staleSeconds: 300 });
});

test("falls back to defaults when env values are zero", async () => {
  const prevLimit = process.env.FINALIZE_BATCH_LIMIT;
  const prevStale = process.env.FINALIZE_STALE_SECONDS;
  process.env.FINALIZE_BATCH_LIMIT = "0";
  process.env.FINALIZE_STALE_SECONDS = "0";
  let captured;
  try {
    await runWorker({
      claimPending: async (opts) => { captured = opts; return []; },
      finalizeSubmission: async () => ({}),
      markDone: async () => {},
      markFailed: async () => {},
      countDeadLettered: async () => 0,
    });
  } finally {
    if (prevLimit === undefined) delete process.env.FINALIZE_BATCH_LIMIT; else process.env.FINALIZE_BATCH_LIMIT = prevLimit;
    if (prevStale === undefined) delete process.env.FINALIZE_STALE_SECONDS; else process.env.FINALIZE_STALE_SECONDS = prevStale;
  }
  assert.deepStrictEqual(captured, { limit: 20, staleSeconds: 300 });
});

test("honors FINALIZE_BATCH_LIMIT / FINALIZE_STALE_SECONDS env overrides", async () => {
  const prevLimit = process.env.FINALIZE_BATCH_LIMIT;
  const prevStale = process.env.FINALIZE_STALE_SECONDS;
  process.env.FINALIZE_BATCH_LIMIT = "5";
  process.env.FINALIZE_STALE_SECONDS = "60";
  let captured;
  try {
    await runWorker({
      claimPending: async (opts) => { captured = opts; return []; },
      finalizeSubmission: async () => ({}),
      markDone: async () => {},
      markFailed: async () => {},
      countDeadLettered: async () => 0,
    });
  } finally {
    if (prevLimit === undefined) delete process.env.FINALIZE_BATCH_LIMIT; else process.env.FINALIZE_BATCH_LIMIT = prevLimit;
    if (prevStale === undefined) delete process.env.FINALIZE_STALE_SECONDS; else process.env.FINALIZE_STALE_SECONDS = prevStale;
  }
  assert.deepStrictEqual(captured, { limit: 5, staleSeconds: 60 });
});

test("falls back to defaults when env values are NaN", async () => {
  const prevLimit = process.env.FINALIZE_BATCH_LIMIT;
  const prevStale = process.env.FINALIZE_STALE_SECONDS;
  process.env.FINALIZE_BATCH_LIMIT = "not-a-number";
  process.env.FINALIZE_STALE_SECONDS = "also-not-a-number";
  let captured;
  try {
    await runWorker({
      claimPending: async (opts) => { captured = opts; return []; },
      finalizeSubmission: async () => ({}),
      markDone: async () => {},
      markFailed: async () => {},
      countDeadLettered: async () => 0,
    });
  } finally {
    if (prevLimit === undefined) delete process.env.FINALIZE_BATCH_LIMIT; else process.env.FINALIZE_BATCH_LIMIT = prevLimit;
    if (prevStale === undefined) delete process.env.FINALIZE_STALE_SECONDS; else process.env.FINALIZE_STALE_SECONDS = prevStale;
  }
  assert.deepStrictEqual(captured, { limit: 20, staleSeconds: 300 });
});
