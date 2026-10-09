const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const rateLimit = require("../../lib/rateLimit");

function fakeRes() {
  return {
    statusCode: null, body: null, headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    write() { return true; },
    end() { return this; },
  };
}

let seenKeys;

// Every bucket is already full, so the first request is refused.
beforeEach(() => {
  seenKeys = [];
  rateLimit.__setDeps({
    now: () => 500 * 3600 * 1000,
    resolveDossierActor: async () => ({ kind: "none", reason: "unauthorized" }),
    storage: {
      async incr(key) { seenKeys.push(key); return 1000; },
      async get() { throw new Error("the limiter counts in one step, never reads then writes"); },
      async set() { throw new Error("the limiter counts in one step, never reads then writes"); },
    },
  });
});

const ip = { "x-forwarded-for": "7.7.7.7" };

test("doc-search is rate limited after validation, before the agent loads", async () => {
  const handler = require("../doc-search");
  const res = fakeRes();
  await handler({ method: "POST", headers: ip, body: { companyName: "X", country: "UK", ownershipType: "corporate", niumEntityType: "corporate" } }, res);
  assert.strictEqual(res.statusCode, 429);
  assert.strictEqual(res.body.error, "rate_limited");
  assert.ok(seenKeys[0].startsWith("ratelimit:doc-search:ip:7.7.7.7:"));
  const invalid = fakeRes();
  await handler({ method: "POST", headers: ip, body: {} }, invalid);
  assert.strictEqual(invalid.statusCode, 400);
});

test("self-source is rate limited after validation, before the agent loads", async () => {
  const handler = require("../self-source");
  const res = fakeRes();
  await handler({ method: "POST", headers: ip, body: { companyName: "X", incorporationCountry: "United Kingdom", entityType: "Corporate", ownershipType: "private_limited" } }, res);
  assert.strictEqual(res.statusCode, 429);
  assert.ok(seenKeys[0].startsWith("ratelimit:self-source:ip:7.7.7.7:"));
});

test("ubo-discovery is rate limited before any investigation starts", async () => {
  const handler = require("../ubo-discovery");
  const res = fakeRes();
  await handler({ method: "POST", headers: ip, body: { entityName: "X Ltd", jurisdiction: "GB" } }, res);
  assert.strictEqual(res.statusCode, 429);
  assert.ok(seenKeys[0].startsWith("ratelimit:ubo-discovery:ip:7.7.7.7:"));
});

test("the UBO lab's live run draws from the caller's ubo-discovery bucket", async () => {
  const { invokeLegacyDiscovery } = require("../ubo-control-lab");
  const result = await invokeLegacyDiscovery({ entityName: "X Ltd", jurisdiction: "GB" }, { callerHeaders: { "x-forwarded-for": "8.8.8.8" } });
  assert.strictEqual(result.status, 429);
  assert.ok(seenKeys[0].startsWith("ratelimit:ubo-discovery:ip:8.8.8.8:"));
});

// I2 - an over-long or non-string prompt field is a 400 before storage (the
// rate limiter) is ever consulted, for every endpoint that puts request body
// strings into an agent prompt.
test("doc-search: an over-long companyName is refused before the rate limiter runs", async () => {
  const handler = require("../doc-search");
  const res = fakeRes();
  await handler({ method: "POST", headers: ip, body: { companyName: "x".repeat(201), country: "UK", ownershipType: "corporate", niumEntityType: "corporate" } }, res);
  assert.strictEqual(res.statusCode, 400);
  assert.deepStrictEqual(res.body, { error: "invalid_input", field: "companyName" });
  assert.strictEqual(seenKeys.length, 0);
});

test("doc-search: a non-string field is refused before the rate limiter runs", async () => {
  const handler = require("../doc-search");
  const res = fakeRes();
  await handler({ method: "POST", headers: ip, body: { companyName: "X", country: "UK", ownershipType: { x: 1 }, niumEntityType: "corporate" } }, res);
  assert.strictEqual(res.statusCode, 400);
  assert.deepStrictEqual(res.body, { error: "invalid_input", field: "ownershipType" });
  assert.strictEqual(seenKeys.length, 0);
});

test("self-source: an over-long entityType is refused before the rate limiter runs", async () => {
  const handler = require("../self-source");
  const res = fakeRes();
  await handler({ method: "POST", headers: ip, body: { companyName: "X", incorporationCountry: "United Kingdom", entityType: "x".repeat(65), ownershipType: "private_limited" } }, res);
  assert.strictEqual(res.statusCode, 400);
  assert.deepStrictEqual(res.body, { error: "invalid_input", field: "entityType" });
  assert.strictEqual(seenKeys.length, 0);
});

test("self-source: an over-long companyRegistrationNumber is refused before the rate limiter runs", async () => {
  const handler = require("../self-source");
  const res = fakeRes();
  await handler({ method: "POST", headers: ip, body: { companyName: "X", incorporationCountry: "United Kingdom", entityType: "Corporate", ownershipType: "private_limited", companyRegistrationNumber: "1".repeat(65) } }, res);
  assert.strictEqual(res.statusCode, 400);
  assert.deepStrictEqual(res.body, { error: "invalid_input", field: "companyRegistrationNumber" });
  assert.strictEqual(seenKeys.length, 0);
});

test("ubo-discovery: an over-long entityName is refused before the rate limiter runs", async () => {
  const handler = require("../ubo-discovery");
  const res = fakeRes();
  await handler({ method: "POST", headers: ip, body: { entityName: "x".repeat(201), jurisdiction: "GB" } }, res);
  assert.strictEqual(res.statusCode, 400);
  assert.deepStrictEqual(res.body, { error: "invalid_input", field: "entityName" });
  assert.strictEqual(seenKeys.length, 0);
});

test("ubo-discovery: a non-string jurisdiction is refused before the rate limiter runs", async () => {
  const handler = require("../ubo-discovery");
  const res = fakeRes();
  await handler({ method: "POST", headers: ip, body: { entityName: "X Ltd", jurisdiction: 12 } }, res);
  assert.strictEqual(res.statusCode, 400);
  assert.deepStrictEqual(res.body, { error: "invalid_input", field: "jurisdiction" });
  assert.strictEqual(seenKeys.length, 0);
});
