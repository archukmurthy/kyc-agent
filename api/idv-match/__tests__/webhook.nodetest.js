const { test } = require("node:test");
const assert = require("node:assert");
const { processWebhook } = require("../webhook");

// Build injectable deps with sensible defaults; override per test. The webhook's
// job is routing/dedup/stale-guard/trust - the map->Vault->store work lives
// behind the injectable persistDecision seam (tested separately).
function makeDeps(over = {}) {
  const calls = { persist: null, pulled: false };
  const deps = {
    verify: over.verify || (() => ({
      valid: true, sessionId: "sess-1", status: "Approved", decisionTrusted: true,
      payload: { event_id: "e1", created_at: 1_757_000_000, decision: { status: "Approved" } },
    })),
    attemptStore: {
      getByDiditSession: over.getByDiditSession || (async () => ({ id: "att-1", last_event_at: null })),
    },
    webhookEvents: { markEventProcessed: over.markEventProcessed || (async () => true) },
    getDecision: async () => { calls.pulled = true; return { status: "Approved", pulled: true }; },
    persistDecision: over.persistDecision || (async (args) => {
      calls.persist = args;
      return { providerStatus: "Approved", secureIdentityReference: "ref-1" };
    }),
  };
  return { deps, calls };
}

test("rejects an invalid signature with 401", async () => {
  const { deps } = makeDeps({ verify: () => ({ valid: false, reason: "invalid_signature" }) });
  const r = await processWebhook({ rawBody: "{}", headers: {} }, deps);
  assert.strictEqual(r.statusCode, 401);
});

test("404 when no attempt owns the session", async () => {
  const { deps } = makeDeps({ getByDiditSession: async () => null });
  const r = await processWebhook({ rawBody: "{}", headers: {} }, deps);
  assert.strictEqual(r.statusCode, 404);
});

test("trusted decision is persisted without re-pulling", async () => {
  const { deps, calls } = makeDeps();
  const r = await processWebhook({ rawBody: "{}", headers: {} }, deps);
  assert.strictEqual(r.statusCode, 200);
  assert.strictEqual(calls.pulled, false, "should not re-pull a trusted decision");
  assert.strictEqual(calls.persist.attempt.id, "att-1");
  assert.deepStrictEqual(calls.persist.decision, { status: "Approved" }, "persists the trusted payload decision");
});

test("untrusted (simple) signature makes the SERVER re-pull the decision", async () => {
  const { deps, calls } = makeDeps({
    verify: () => ({ valid: true, sessionId: "sess-1", status: "Approved", decisionTrusted: false, payload: { event_id: "e2", created_at: 1_757_000_000 } }),
  });
  const r = await processWebhook({ rawBody: "{}", headers: {} }, deps);
  assert.strictEqual(r.statusCode, 200);
  assert.strictEqual(calls.pulled, true, "should re-pull when decision not trusted");
  assert.strictEqual(calls.persist.decision.pulled, true, "persists the server-pulled decision");
});

test("duplicate delivery is idempotent (no persist)", async () => {
  const { deps, calls } = makeDeps({ markEventProcessed: async () => false });
  const r = await processWebhook({ rawBody: "{}", headers: {} }, deps);
  assert.strictEqual(r.statusCode, 200);
  assert.strictEqual(r.body.duplicate, true);
  assert.strictEqual(calls.persist, null, "duplicate must not write");
});

test("an out-of-order (older) event is ignored", async () => {
  const { deps, calls } = makeDeps({
    getByDiditSession: async () => ({ id: "att-1", last_event_at: "2030-01-01T00:00:00.000Z" }),
  });
  const r = await processWebhook({ rawBody: "{}", headers: {} }, deps);
  assert.strictEqual(r.statusCode, 200);
  assert.strictEqual(r.body.stale, true);
  assert.strictEqual(calls.persist, null, "stale event must not write");
  assert.strictEqual(calls.pulled, false, "stale event must not even re-pull");
});
