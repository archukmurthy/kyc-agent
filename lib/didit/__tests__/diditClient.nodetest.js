// lib/didit/__tests__/diditClient.nodetest.js
const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");

let client;
const realFetch = global.fetch;

beforeEach(() => {
  process.env.DIDIT_API_KEY = "test-key";
  process.env.DIDIT_WORKFLOW_ID = "wf-1";
  process.env.DIDIT_ENVIRONMENT = "sandbox";
  process.env.IDV_SYNTHETIC_ONLY = "1";
  delete require.cache[require.resolve("../diditClient")];
  client = require("../diditClient");
});
afterEach(() => { global.fetch = realFetch; });

test("createSession posts to /v3/session/ with x-api-key and returns id+url", async () => {
  let seen;
  global.fetch = async (url, opts) => {
    seen = { url, opts };
    return { ok: true, status: 201, json: async () => ({ session_id: "sess-1", url: "https://verification.didit.me/s/abc", status: "Not Started" }) };
  };
  const out = await client.createSession({ vendorData: "ref-1", callbackUrl: "https://cb" });
  assert.strictEqual(out.providerSessionId, "sess-1");
  assert.strictEqual(out.hostedUrl, "https://verification.didit.me/s/abc");
  assert.match(seen.url, /\/v3\/session\/$/);
  assert.strictEqual(seen.opts.headers["x-api-key"], "test-key");
  const body = JSON.parse(seen.opts.body);
  assert.strictEqual(body.vendor_data, "ref-1");
  assert.strictEqual(body.workflow_id, "wf-1");
});

test("getDecision GETs the decision endpoint by session id", async () => {
  let seenUrl;
  global.fetch = async (url, opts) => {
    seenUrl = url;
    assert.strictEqual(opts.method, "GET");
    return { ok: true, status: 200, json: async () => ({ status: "Approved" }) };
  };
  const out = await client.getDecision("sess-1");
  assert.match(seenUrl, /\/v3\/session\/sess-1\/decision\/$/);
  assert.strictEqual(out.status, "Approved");
});
