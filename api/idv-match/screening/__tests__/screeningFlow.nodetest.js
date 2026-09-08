const { test } = require("node:test");
const assert = require("node:assert");
const { startScreening, hasScreeningHit } = require("../index");
const { processScreeningWebhook } = require("../webhook");

// ---------- startScreening ----------
test("startScreening creates a ComplyCube client + check and stores a pending row", async () => {
  const calls = {};
  const deps = {
    complyCubeClient: {
      createClient: async (p) => { calls.person = p; return { id: "ccc-1" }; },
      createScreeningCheck: async (id) => { calls.checkClientId = id; return { id: "chk-1", status: "pending" }; },
    },
    store: {
      createScreening: async (args) => { calls.created = args; return "srow-1"; },
      updateScreeningResult: async (...a) => { calls.updated = a; },
    },
  };
  const out = await startScreening("att-1", { firstName: "John", lastName: "Doe" }, deps);
  assert.deepStrictEqual(out, { screeningId: "srow-1", complyCubeCheckId: "chk-1" });
  assert.strictEqual(calls.checkClientId, "ccc-1");
  assert.strictEqual(calls.created.attemptId, "att-1");
  assert.strictEqual(calls.created.complyCubeCheckId, "chk-1");
  assert.strictEqual(calls.updated, undefined, "pending check is not stored as a result yet");
});

test("startScreening records a synchronously-complete check", async () => {
  const calls = {};
  const deps = {
    complyCubeClient: {
      createClient: async () => ({ id: "ccc-2" }),
      createScreeningCheck: async () => ({ id: "chk-2", status: "complete", result: { outcome: "clear", breakdown: { summary: {}, matches: [] } } }),
    },
    store: { createScreening: async () => "srow-2", updateScreeningResult: async (id, patch) => { calls.updated = { id, patch }; } },
  };
  await startScreening("att-2", { firstName: "A", lastName: "B" }, deps);
  assert.strictEqual(calls.updated.id, "srow-2");
  assert.strictEqual(calls.updated.patch.outcome, "clear");
});

// ---------- hasScreeningHit ----------
test("hasScreeningHit aggregates rows: any attention is a hit", async () => {
  const store = {
    listByAttempt: async () => ([
      { outcome: "attention", status: "complete", categories: { pep: true, watchlist: false } },
      { outcome: "clear", status: "complete", categories: {} },
    ]),
  };
  const r = await hasScreeningHit("att-1", { store });
  assert.strictEqual(r.hit, true);
  assert.strictEqual(r.categories.pep, true);
  assert.strictEqual(r.count, 2);
});

test("hasScreeningHit surfaces pending and not_processed (never silently clear)", async () => {
  const store = {
    listByAttempt: async () => ([
      { outcome: null, status: "pending" },
      { outcome: "not_processed", status: "complete" },
    ]),
  };
  const r = await hasScreeningHit("att-1", { store });
  assert.strictEqual(r.hit, false);
  assert.strictEqual(r.pending, true);
  assert.strictEqual(r.notProcessed, true);
});

// ---------- webhook ----------
function makeWebhookDeps(over = {}) {
  const calls = {};
  return {
    calls,
    deps: {
      verifyEvent: over.verifyEvent || (() => ({ type: "check.completed.attention", payload: { id: "chk-1" } })),
      store: {
        getByCheckId: over.getByCheckId || (async () => ({ id: "srow-1" })),
        updateScreeningResult: async (id, patch) => { calls.updated = { id, patch }; },
      },
      getCheck: over.getCheck || (async () => ({ status: "complete", result: { outcome: "attention", breakdown: { summary: { pep: { level1: "attention" } }, matches: [{ id: "m" }] } } })),
    },
  };
}

test("webhook: missing secret -> 500, bad signature -> 401", async () => {
  const noSecret = await processScreeningWebhook({ rawBody: "{}", signature: "s", secret: "" }, {});
  assert.strictEqual(noSecret.statusCode, 500);

  const { deps } = makeWebhookDeps({ verifyEvent: () => { throw new Error("bad"); } });
  const bad = await processScreeningWebhook({ rawBody: "{}", signature: "s", secret: "sec" }, deps);
  assert.strictEqual(bad.statusCode, 401);
});

test("webhook: unknown check -> 404; non-completion event ignored", async () => {
  const { deps } = makeWebhookDeps({ getByCheckId: async () => null });
  const missing = await processScreeningWebhook({ rawBody: "{}", signature: "s", secret: "sec" }, deps);
  assert.strictEqual(missing.statusCode, 404);

  const { deps: d2 } = makeWebhookDeps({ verifyEvent: () => ({ type: "check.pending", payload: { id: "chk-1" } }) });
  const ignored = await processScreeningWebhook({ rawBody: "{}", signature: "s", secret: "sec" }, d2);
  assert.strictEqual(ignored.statusCode, 200);
  assert.strictEqual(ignored.body.ignored, "check.pending");
});

test("webhook: completion event re-pulls, interprets, and stores the hit", async () => {
  const { deps, calls } = makeWebhookDeps();
  const r = await processScreeningWebhook({ rawBody: "{}", signature: "s", secret: "sec" }, deps);
  assert.strictEqual(r.statusCode, 200);
  assert.strictEqual(r.body.hit, true);
  assert.strictEqual(calls.updated.id, "srow-1");
  assert.strictEqual(calls.updated.patch.outcome, "attention");
  assert.strictEqual(calls.updated.patch.categories.pep, true);
});
