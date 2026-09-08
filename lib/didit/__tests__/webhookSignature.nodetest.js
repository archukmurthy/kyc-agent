const { test } = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");
const { verifyDiditWebhook, REPLAY_WINDOW_SECONDS } = require("../webhookSignature");

const SECRET = "test-webhook-secret";
const NOW = 1_757_000_000_000; // fixed clock (ms)
const TS = Math.floor(NOW / 1000);

const PAYLOAD = {
  event_id: "evt-1",
  session_id: "sess-1",
  status: "Approved",
  webhook_type: "status.updated",
  timestamp: TS,
  decision: { status: "Approved" },
};
const RAW = JSON.stringify(PAYLOAD);

function hmac(data) {
  return crypto.createHmac("sha256", SECRET).update(data).digest("hex");
}
function canonical(v) {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object") {
    return Object.keys(v).sort().reduce((o, k) => { o[k] = canonical(v[k]); return o; }, {});
  }
  return v;
}

test("accepts a valid X-Signature-V2 (canonical JSON) and trusts the decision", () => {
  const sig = hmac(JSON.stringify(canonical(PAYLOAD)));
  const r = verifyDiditWebhook({ rawBody: RAW, headers: { "x-timestamp": String(TS), "x-signature-v2": sig }, secret: SECRET, now: NOW });
  assert.strictEqual(r.valid, true);
  assert.strictEqual(r.decisionTrusted, true);
  assert.strictEqual(r.method, "v2");
  assert.strictEqual(r.sessionId, "sess-1");
});

test("accepts a valid X-Signature (raw body) and trusts the decision", () => {
  const sig = hmac(RAW);
  const r = verifyDiditWebhook({ rawBody: RAW, headers: { "x-timestamp": String(TS), "x-signature": sig }, secret: SECRET, now: NOW });
  assert.strictEqual(r.valid, true);
  assert.strictEqual(r.decisionTrusted, true);
  assert.strictEqual(r.method, "raw");
});

test("accepts X-Signature-Simple but does NOT trust the decision payload", () => {
  const envelope = `${TS}:sess-1:Approved:status.updated`;
  const sig = hmac(envelope);
  const r = verifyDiditWebhook({ rawBody: RAW, headers: { "x-timestamp": String(TS), "x-signature-simple": sig }, secret: SECRET, now: NOW });
  assert.strictEqual(r.valid, true);
  assert.strictEqual(r.decisionTrusted, false);
  assert.strictEqual(r.method, "simple");
});

test("rejects a tampered signature", () => {
  const r = verifyDiditWebhook({ rawBody: RAW, headers: { "x-timestamp": String(TS), "x-signature-v2": hmac("not-the-body") }, secret: SECRET, now: NOW });
  assert.strictEqual(r.valid, false);
  assert.strictEqual(r.reason, "invalid_signature");
});

test("rejects a stale timestamp outside the replay window", () => {
  const sig = hmac(JSON.stringify(canonical(PAYLOAD)));
  const staleNow = NOW + (REPLAY_WINDOW_SECONDS + 5) * 1000;
  const r = verifyDiditWebhook({ rawBody: RAW, headers: { "x-timestamp": String(TS), "x-signature-v2": sig }, secret: SECRET, now: staleNow });
  assert.strictEqual(r.valid, false);
  assert.strictEqual(r.reason, "stale");
});

test("rejects bad JSON, missing timestamp, and missing secret", () => {
  assert.strictEqual(verifyDiditWebhook({ rawBody: "{", headers: {}, secret: SECRET, now: NOW }).reason, "bad_json");
  assert.strictEqual(verifyDiditWebhook({ rawBody: JSON.stringify({ session_id: "s" }), headers: {}, secret: SECRET, now: NOW }).reason, "no_timestamp");
  assert.strictEqual(verifyDiditWebhook({ rawBody: RAW, headers: { "x-timestamp": String(TS) }, secret: "", now: NOW }).reason, "no_secret");
});
