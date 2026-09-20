const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const rateLimit = require("../rateLimit");

const H = 3600 * 1000;

function fakeStorage() {
  const data = {};
  const ttls = {};
  return {
    data,
    ttls,
    async get(k) { return k in data ? data[k] : null; },
    async set(k, v, opts) { data[k] = v; ttls[k] = opts && opts.ttlSeconds; },
  };
}

function fakeRes() {
  return {
    statusCode: null, body: null, headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

function reqWith(headers = {}) {
  return { headers, socket: { remoteAddress: "9.9.9.9" } };
}

let storage;
let clock;
let actor;

beforeEach(() => {
  storage = fakeStorage();
  clock = 500 * H;
  actor = { kind: "none", reason: "unauthorized" };
  rateLimit.__setDeps({ storage, now: () => clock, resolveDossierActor: async () => actor });
  for (const k of Object.keys(process.env)) if (k.startsWith("RATE_LIMIT_")) delete process.env[k];
});

test("default limits match the spec", () => {
  assert.deepStrictEqual(rateLimit.DEFAULT_LIMITS, {
    // Claude spend
    research: 40, "doc-search": 40, "self-source": 40, "ubo-discovery": 20, "generate-policy": 10,
    // Batch 0: routes the wizard reaches with no credential, where the limiter
    // is the only brake until Batch 1.
    "company-search": 60, "kyc-lookup": 30, "document-requirements": 120,
    "track-event": 300, "upload-document": 60, "get-document": 300,
    "research-attempt": 20,
    // UBO demo routes, merged in with the UBO work. Both reach Anthropic.
    "ubo-demo-chart": 20, "ubo-demo-entity": 40,
  });
  assert.strictEqual(rateLimit.DEFAULT_ANALYST_LIMIT, 200);
  assert.strictEqual(rateLimit.WINDOW_SECONDS, 3600);
});

test("check allows up to the limit and blocks the next call in the same window", async () => {
  for (let i = 0; i < 3; i++) {
    const r = await rateLimit.check({ bucket: "research", key: "ip:1.2.3.4", limit: 3 });
    assert.strictEqual(r.allowed, true);
    assert.strictEqual(r.remaining, 2 - i);
  }
  const blocked = await rateLimit.check({ bucket: "research", key: "ip:1.2.3.4", limit: 3 });
  assert.strictEqual(blocked.allowed, false);
  assert.strictEqual(blocked.remaining, 0);
  assert.strictEqual(blocked.retryAfterSeconds, 3600);
});

test("keys carry the window start with a one-window TTL, and a new window resets the count", async () => {
  await rateLimit.check({ bucket: "research", key: "ip:a", limit: 1 });
  const key = `ratelimit:research:ip:a:${500 * H}`;
  assert.strictEqual(storage.data[key], 1);
  assert.strictEqual(storage.ttls[key], 3600);
  assert.strictEqual((await rateLimit.check({ bucket: "research", key: "ip:a", limit: 1 })).allowed, false);
  clock += H;
  assert.strictEqual((await rateLimit.check({ bucket: "research", key: "ip:a", limit: 1 })).allowed, true);
});

test("retryAfterSeconds counts down to the end of the window", async () => {
  clock = 500 * H + 30 * 60 * 1000;
  await rateLimit.check({ bucket: "research", key: "ip:b", limit: 1 });
  const blocked = await rateLimit.check({ bucket: "research", key: "ip:b", limit: 1 });
  assert.strictEqual(blocked.retryAfterSeconds, 1800);
});

test("callerKey uses only verified credentials, otherwise the client IP", async () => {
  actor = { kind: "analyst", tenantId: "acme", dossierId: null };
  assert.deepStrictEqual(await rateLimit.callerKey(reqWith()), { key: "analyst:acme", analyst: true });
  actor = { kind: "customer", tenantId: "acme", dossierId: "d-1" };
  assert.deepStrictEqual(await rateLimit.callerKey(reqWith()), { key: "dossier:d-1", analyst: false });
  actor = { kind: "none", reason: "invalid_credential" };
  assert.deepStrictEqual(
    await rateLimit.callerKey(reqWith({ "x-forwarded-for": "1.1.1.1, 10.0.0.1" })),
    { key: "ip:1.1.1.1", analyst: false },
  );
  assert.deepStrictEqual(await rateLimit.callerKey(reqWith({ "x-real-ip": "2.2.2.2" })), { key: "ip:2.2.2.2", analyst: false });
  assert.deepStrictEqual(await rateLimit.callerKey(reqWith()), { key: "ip:9.9.9.9", analyst: false });
});

test("callerKey treats a throwing credential check as no credential", async () => {
  rateLimit.__setDeps({ resolveDossierActor: async () => { throw new Error("registry down"); } });
  assert.deepStrictEqual(await rateLimit.callerKey(reqWith({ "x-forwarded-for": "3.3.3.3" })), { key: "ip:3.3.3.3", analyst: false });
});

test("enforceRateLimit sends 429 with Retry-After once the bucket limit is spent", async () => {
  process.env.RATE_LIMIT_RESEARCH = "2";
  const req = reqWith({ "x-forwarded-for": "5.5.5.5" });
  assert.strictEqual(await rateLimit.enforceRateLimit(req, fakeRes(), "research"), true);
  assert.strictEqual(await rateLimit.enforceRateLimit(req, fakeRes(), "research"), true);
  const res = fakeRes();
  assert.strictEqual(await rateLimit.enforceRateLimit(req, res, "research"), false);
  assert.strictEqual(res.statusCode, 429);
  assert.deepStrictEqual(res.body, { error: "rate_limited", retryAfterSeconds: 3600 });
  assert.strictEqual(res.headers["Retry-After"], "3600");
});

test("buckets are independent per endpoint and per caller", async () => {
  process.env.RATE_LIMIT_RESEARCH = "1";
  process.env.RATE_LIMIT_DOC_SEARCH = "1";
  const a = reqWith({ "x-forwarded-for": "6.6.6.6" });
  const b = reqWith({ "x-forwarded-for": "7.7.7.7" });
  assert.strictEqual(await rateLimit.enforceRateLimit(a, fakeRes(), "research"), true);
  assert.strictEqual(await rateLimit.enforceRateLimit(a, fakeRes(), "doc-search"), true);
  assert.strictEqual(await rateLimit.enforceRateLimit(b, fakeRes(), "research"), true);
  assert.strictEqual(await rateLimit.enforceRateLimit(a, fakeRes(), "research"), false);
});

test("a verified analyst gets the analyst limit instead of the endpoint limit", async () => {
  process.env.RATE_LIMIT_RESEARCH = "1";
  process.env.RATE_LIMIT_ANALYST = "3";
  actor = { kind: "analyst", tenantId: "acme", dossierId: null };
  const req = reqWith();
  for (let i = 0; i < 3; i++) assert.strictEqual(await rateLimit.enforceRateLimit(req, fakeRes(), "research"), true);
  assert.strictEqual(await rateLimit.enforceRateLimit(req, fakeRes(), "research"), false);
});

test("an invalid env value falls back to the default limit", async () => {
  process.env.RATE_LIMIT_UBO_DISCOVERY = "not-a-number";
  const req = reqWith({ "x-forwarded-for": "8.8.8.8" });
  for (let i = 0; i < 20; i++) assert.strictEqual(await rateLimit.enforceRateLimit(req, fakeRes(), "ubo-discovery"), true);
  assert.strictEqual(await rateLimit.enforceRateLimit(req, fakeRes(), "ubo-discovery"), false);
});

test("a storage failure fails open", async () => {
  rateLimit.__setDeps({ storage: { async get() { throw new Error("kv down"); }, async set() {} } });
  assert.strictEqual(await rateLimit.enforceRateLimit(reqWith(), fakeRes(), "research"), true);
});

test("an unknown bucket is a programming error, not a silent pass", async () => {
  await assert.rejects(() => rateLimit.enforceRateLimit(reqWith(), fakeRes(), "nope"), /unknown rate-limit bucket/);
});

test("a bare res (statusCode + end) still receives a JSON 429", async () => {
  process.env.RATE_LIMIT_GENERATE_POLICY = "1";
  const req = reqWith({ "x-forwarded-for": "4.4.4.4" });
  const bare = () => ({
    statusCode: 200, headers: {}, payload: null,
    setHeader(k, v) { this.headers[k] = v; },
    end(p) { this.payload = JSON.parse(p); },
  });
  assert.strictEqual(await rateLimit.enforceRateLimit(req, bare(), "generate-policy"), true);
  const res = bare();
  assert.strictEqual(await rateLimit.enforceRateLimit(req, res, "generate-policy"), false);
  assert.strictEqual(res.statusCode, 429);
  assert.deepStrictEqual(res.payload, { error: "rate_limited", retryAfterSeconds: 3600 });
  assert.strictEqual(res.headers["Retry-After"], "3600");
});
