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

test("limits match the spec, per person, in two windows", () => {
  // Pinned so an expensive route cannot quietly gain a generous number.
  assert.deepStrictEqual(rateLimit.LIMITS, {
    research: { hour: 15, day: 60 },
    "doc-search": { hour: 15, day: 60 },
    "self-source": { hour: 15, day: 60 },
    "ubo-discovery": { hour: 15, day: 60 },
    "ubo-demo-chart": { hour: 15, day: 60 },
    "ubo-demo-entity": { hour: 60, day: 300 },
    "generate-policy": { hour: 10, day: 40 },
    "kyc-lookup": { hour: 20, day: 100 },
    "idv-match": { hour: 20, day: 80 },
    "company-search": { hour: 100, day: 400 },
    "document-requirements": { hour: 300, day: 2000 },
    "research-attempt": { hour: 20, day: 60 },
    "ubo-invite": { hour: 10, day: 40 },
    "ubo-people": { hour: 30, day: 120 },
    "ubo-control-lab": { hour: 120, day: 600 },
    health: { hour: 600, day: 5000 },
    "sign-out": { hour: 120, day: 600 },
    "upload-document": { hour: 60, day: 300 },
    "get-document": { hour: 300, day: 2000 },
    "dossier-write": { hour: 120, day: 800 },
    "track-event": { hour: 600, day: 5000 },
  });
  assert.strictEqual(rateLimit.WINDOW_SECONDS, 3600);
  assert.strictEqual(rateLimit.DAY_SECONDS, 86400);
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
  assert.deepStrictEqual(await rateLimit.callerKey(reqWith()), { key: "analyst:acme", tenantId: "acme", userId: null });
  actor = { kind: "customer", tenantId: "acme", dossierId: "d-1" };
  assert.deepStrictEqual(await rateLimit.callerKey(reqWith()), { key: "dossier:d-1", tenantId: "acme", userId: null });
  actor = { kind: "none", reason: "invalid_credential" };
  assert.deepStrictEqual(
    await rateLimit.callerKey(reqWith({ "x-forwarded-for": "1.1.1.1, 10.0.0.1" })),
    { key: "ip:1.1.1.1", tenantId: null, userId: null },
  );
  assert.deepStrictEqual(await rateLimit.callerKey(reqWith({ "x-real-ip": "2.2.2.2" })), { key: "ip:2.2.2.2", tenantId: null, userId: null });
  assert.deepStrictEqual(await rateLimit.callerKey(reqWith()), { key: "ip:9.9.9.9", tenantId: null, userId: null });
});

test("callerKey treats a throwing credential check as no credential", async () => {
  rateLimit.__setDeps({ resolveDossierActor: async () => { throw new Error("registry down"); } });
  assert.deepStrictEqual(await rateLimit.callerKey(reqWith({ "x-forwarded-for": "3.3.3.3" })), { key: "ip:3.3.3.3", tenantId: null, userId: null });
});

test("enforceRateLimit sends 429 with Retry-After once the bucket limit is spent", async () => {
  process.env.RATE_LIMIT_RESEARCH = "2";
  const req = reqWith({ "x-forwarded-for": "5.5.5.5" });
  assert.strictEqual(await rateLimit.enforceRateLimit(req, fakeRes(), "research"), true);
  assert.strictEqual(await rateLimit.enforceRateLimit(req, fakeRes(), "research"), true);
  const res = fakeRes();
  assert.strictEqual(await rateLimit.enforceRateLimit(req, res, "research"), false);
  assert.strictEqual(res.statusCode, 429);
  assert.strictEqual(res.body.error, "rate_limited");
  assert.strictEqual(res.body.scope, "hour");
  assert.strictEqual(res.body.limit, 2);
  assert.strictEqual(res.body.retryAfterSeconds, 3600);
  assert.match(res.body.message, /60 minutes/);
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

test("an analyst no longer shares one allowance with their whole company", async () => {
  // Removed deliberately. The shared bucket refused one analyst because a
  // colleague had been busy, and neither could tell why. Clerk gives each
  // person their own count; the pre-boarding password still cannot, so it
  // keeps a per-tenant key - but no inflated limit to go with it.
  assert.strictEqual(rateLimit.DEFAULT_ANALYST_LIMIT, undefined);
  actor = { kind: "analyst", tenantId: "acme", dossierId: null };
  const caller = await rateLimit.callerKey(reqWith());
  assert.strictEqual(caller.key, "analyst:acme");
  assert.strictEqual(caller.analyst, undefined, "no analyst flag means no special allowance");
});

test("an invalid env value falls back to the default limit", async () => {
  process.env.RATE_LIMIT_UBO_DISCOVERY = "not-a-number";
  const req = reqWith({ "x-forwarded-for": "8.8.8.8" });
  for (let i = 0; i < rateLimit.LIMITS["ubo-discovery"].hour; i++) {
    assert.strictEqual(await rateLimit.enforceRateLimit(req, fakeRes(), "ubo-discovery"), true);
  }
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
  assert.strictEqual(res.payload.error, "rate_limited");
  assert.strictEqual(res.payload.scope, "hour");
  assert.ok(res.payload.message, "a bare response still carries the readable message");
  assert.strictEqual(res.headers["Retry-After"], "3600");
});

// ── v2: per person, per day, and a workspace ceiling ───────────────────────
//
// The old keying gave every analyst at one company a single shared allowance,
// so Priya was refused because Sam had been busy - and neither could tell why.
// Clerk gives us a real user id, so the count follows the person.

const clerkAuth = require("../clerkAuth");

function withUser(session, fn) {
  const saved = process.env.CLERK_SECRET_KEY;
  process.env.CLERK_SECRET_KEY = "sk_test_x";
  clerkAuth.__setDeps({ verifyToken: async () => session });
  const done = () => {
    clerkAuth.__resetDeps();
    if (saved === undefined) delete process.env.CLERK_SECRET_KEY;
    else process.env.CLERK_SECRET_KEY = saved;
  };
  return Promise.resolve(fn()).finally(done);
}

const authed = { headers: { authorization: "Bearer t" }, query: {} };

test("two people at one company no longer share an allowance", async () => {
  const storage = fakeStorage();
  rateLimit.__setDeps({ storage, now: () => 0 });

  await withUser({ sub: "user_priya" }, async () => {
    const k = await rateLimit.callerKey(authed);
    assert.equal(k.key, "user:user_priya", "the count follows the person, not the company");
  });
  await withUser({ sub: "user_sam" }, async () => {
    const k = await rateLimit.callerKey(authed);
    assert.equal(k.key, "user:user_sam");
  });
});

test("an unidentified caller is still counted by address", async () => {
  rateLimit.__setDeps({ storage: fakeStorage(), now: () => 0 });
  const k = await rateLimit.callerKey({ headers: { "x-forwarded-for": "9.9.9.9" }, query: {} });
  assert.equal(k.key, "ip:9.9.9.9");
});

test("a daily ceiling holds after the hourly one has reset", async () => {
  // The gap the old limiter left: an hourly limit resets 24 times a day, so it
  // bounds a runaway loop and bounds nothing about the bill.
  const storage = fakeStorage();
  let clock = 0;
  rateLimit.__setDeps({ storage, now: () => clock });

  const spend = async () => {
    const res = fakeRes();
    const ok = await rateLimit.enforceRateLimit({ headers: { "x-forwarded-for": "1.1.1.1" }, query: {} }, res, "research");
    return { ok, res };
  };

  let allowed = 0;
  for (let hour = 0; hour < 24; hour++) {
    clock = hour * H;
    for (let i = 0; i < 20; i++) {
      const { ok } = await spend();
      if (ok) allowed += 1;
    }
  }
  const limits = rateLimit.LIMITS.research;
  assert.ok(allowed <= limits.day, `a day of trying allowed ${allowed}, over the daily ceiling of ${limits.day}`);
  assert.ok(allowed > limits.hour, "the daily ceiling must be higher than one hour's worth, or the hourly one is pointless");
});

test("a refusal says which limit was hit and when it lifts", async () => {
  const storage = fakeStorage();
  rateLimit.__setDeps({ storage, now: () => 0 });
  const req = { headers: { "x-forwarded-for": "2.2.2.2" }, query: {} };
  for (let i = 0; i < rateLimit.LIMITS["generate-policy"].hour; i++) {
    await rateLimit.enforceRateLimit(req, fakeRes(), "generate-policy");
  }
  const res = fakeRes();
  const ok = await rateLimit.enforceRateLimit(req, res, "generate-policy");
  assert.equal(ok, false);
  assert.equal(res.statusCode, 429);
  assert.equal(res.body.error, "rate_limited");
  assert.equal(res.body.scope, "hour", "a caller cannot act on 'too many requests' without knowing which window");
  assert.ok(res.body.retryAfterSeconds > 0);
  assert.ok(res.body.message && /hour/i.test(res.body.message), "the message must be readable by a person");
});

test("the paid buckets are tighter than the free ones", () => {
  // Guards against someone copying a generous number onto an expensive route.
  for (const bucket of ["research", "ubo-discovery", "doc-search", "self-source", "ubo-demo-chart"]) {
    assert.ok(rateLimit.LIMITS[bucket].hour <= 15, `${bucket} is too generous for a route that spends money`);
  }
  assert.ok(rateLimit.LIMITS["get-document"].hour >= 100, "reads should not be throttled like spends");
});

test("a paid call counts against the account's daily ceiling", async () => {
  // Per-person limits multiply with headcount; this is the number that bounds
  // the bill regardless of how many people an account has.
  const storage = fakeStorage();
  let recorded = 0;
  rateLimit.__setDeps({
    storage,
    now: () => 0,
    spendCap: {
      check: async () => ({ blocked: false }),
      record: async () => { recorded += 1; },
    },
  });
  actor = { kind: "analyst", tenantId: "acme", dossierId: null };
  await rateLimit.enforceRateLimit(reqWith(), fakeRes(), "research");
  assert.strictEqual(recorded, 1);
});

test("a read does not count against the spend ceiling", async () => {
  let recorded = 0;
  rateLimit.__setDeps({
    storage: fakeStorage(),
    now: () => 0,
    spendCap: { check: async () => ({ blocked: false }), record: async () => { recorded += 1; } },
  });
  actor = { kind: "analyst", tenantId: "acme", dossierId: null };
  await rateLimit.enforceRateLimit(reqWith(), fakeRes(), "get-document");
  assert.strictEqual(recorded, 0, "only provider calls cost money");
});

test("an account over its ceiling is refused, and told why", async () => {
  rateLimit.__setDeps({
    storage: fakeStorage(),
    now: () => 0,
    spendCap: {
      check: async () => ({ blocked: true, limit: 300, message: "This account has used all 300 provider calls allowed today." }),
      record: async () => {},
    },
  });
  actor = { kind: "analyst", tenantId: "acme", dossierId: null };
  const res = fakeRes();
  const allowed = await rateLimit.enforceRateLimit(reqWith(), res, "research");
  assert.strictEqual(allowed, false);
  assert.strictEqual(res.statusCode, 429);
  assert.strictEqual(res.body.error, "spend_cap_reached");
  assert.match(res.body.message, /300 provider calls/);
});
