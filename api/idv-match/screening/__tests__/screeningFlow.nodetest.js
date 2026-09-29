const { test } = require("node:test");
const assert = require("node:assert");
const { startScreening, hasScreeningHit } = require("../index");
const { processScreeningWebhook } = require("../webhook");

// ---------- startScreening ----------
test("startScreening drives the provider, stores a pending row bound to the attempt", async () => {
  const calls = { created: null, updated: null };
  const provider = {
    screenPerson: async (subject) => { calls.created = subject; return { providerClientId: "cli", providerCheckId: "chk", result: null }; },
  };
  const store = {
    createScreening: async (row) => { calls.row = row; return "scr-1"; },
    updateScreeningResult: async (id, patch) => { calls.updated = { id, patch }; },
  };
  const out = await startScreening("att-1", { firstName: "John", lastName: "Doe" }, { screeningProvider: provider, store });
  assert.deepEqual(out, { screeningId: "scr-1", providerCheckId: "chk" });
  assert.equal(calls.row.complyCubeCheckId, "chk");
  assert.equal(calls.updated, null); // pending -> no result write
});

test("startScreening records a synchronously-complete canonical result", async () => {
  const provider = {
    screenPerson: async () => ({ providerClientId: "cli", providerCheckId: "chk", result: { status: "complete", outcome: "attention", hit: true, notProcessed: false, observations: { watchlist: false, pep: true, adverseMedia: false, other: false }, matchCount: 1 } }),
  };
  let written;
  const store = { createScreening: async () => "scr-2", updateScreeningResult: async (id, patch) => { written = patch; } };
  await startScreening("att-2", { firstName: "A", lastName: "B" }, { screeningProvider: provider, store });
  assert.equal(written.outcome, "attention");
  assert.deepEqual(written.categories, { watchlist: false, pep: true, adverseMedia: false, other: false });
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
