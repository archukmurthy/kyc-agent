const { test } = require("node:test");
const assert = require("node:assert");
const { processWebhook } = require("../webhook");

// Build injectable deps with sensible defaults; override per test.
function makeDeps(over = {}) {
  const calls = { update: null, pulled: false };
  const deps = {
    verify: over.verify || (() => ({
      valid: true, sessionId: "sess-1", status: "Approved", decisionTrusted: true,
      payload: { event_id: "e1", created_at: 1_757_000_000, decision: { status: "Approved" } },
    })),
    attemptStore: {
      getByDiditSession: over.getByDiditSession || (async () => ({ id: "att-1", last_event_at: null })),
      updateAttempt: async (id, patch) => { calls.update = { id, patch }; },
    },
    webhookEvents: { markEventProcessed: over.markEventProcessed || (async () => true) },
    getDecision: async () => { calls.pulled = true; return { status: "Approved" }; },
    mapDecision: over.mapDecision || ((d) => ({ status: d.status, verified: d.status === "Approved", mappedFields: {}, extras: {} })),
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

test("trusted decision is stored without re-pulling", async () => {
  const { deps, calls } = makeDeps();
  const r = await processWebhook({ rawBody: "{}", headers: {} }, deps);
  assert.strictEqual(r.statusCode, 200);
  assert.strictEqual(calls.pulled, false, "should not re-pull a trusted decision");
  assert.strictEqual(calls.update.id, "att-1");
  assert.strictEqual(calls.update.patch.status, "Approved");
  assert.ok(calls.update.patch.verificationResult, "stores the mapped result");
});

test("untrusted (simple) signature makes the SERVER re-pull the decision", async () => {
  const { deps, calls } = makeDeps({
    verify: () => ({ valid: true, sessionId: "sess-1", status: "Approved", decisionTrusted: false, payload: { event_id: "e2", created_at: 1_757_000_000 } }),
  });
  const r = await processWebhook({ rawBody: "{}", headers: {} }, deps);
  assert.strictEqual(r.statusCode, 200);
  assert.strictEqual(calls.pulled, true, "should re-pull when decision not trusted");
  assert.ok(calls.update.patch.verificationResult);
});

test("duplicate delivery is idempotent (no update)", async () => {
  const { deps, calls } = makeDeps({ markEventProcessed: async () => false });
  const r = await processWebhook({ rawBody: "{}", headers: {} }, deps);
  assert.strictEqual(r.statusCode, 200);
  assert.strictEqual(r.body.duplicate, true);
  assert.strictEqual(calls.update, null, "duplicate must not write");
});

test("an out-of-order (older) event is ignored", async () => {
  const { deps, calls } = makeDeps({
    getByDiditSession: async () => ({ id: "att-1", last_event_at: "2030-01-01T00:00:00.000Z" }),
  });
  const r = await processWebhook({ rawBody: "{}", headers: {} }, deps);
  assert.strictEqual(r.statusCode, 200);
  assert.strictEqual(r.body.stale, true);
  assert.strictEqual(calls.update, null, "stale event must not write");
});
