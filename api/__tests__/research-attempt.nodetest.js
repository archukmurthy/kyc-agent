const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const handler = require("../research-attempt");
const researchGrant = require("../../lib/researchGrant");

process.env.RESEARCH_GRANT_SECRET = "grant-secret";
const withoutGrant = ({ grant, ...rest }) => rest;

function fakeRes() {
  return { statusCode: null, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}

let store;
let ttls;

beforeEach(() => {
  store = {};
  ttls = {};
  handler.__setDeps({
    storage: {
      async get(k) { return k in store ? store[k] : null; },
      async set(k, v, opts) { store[k] = v; ttls[k] = opts && opts.ttlSeconds; },
    },
  });
});

const APP_ID = "3f2b8a4e-9c1d-4e6f-8a2b-7c9d0e1f2a3b";
const post = (body) => ({ method: "POST", body, headers: {}, query: {} });

test("a fresh application gets exactly two searches", async () => {
  const first = fakeRes();
  await handler(post({ applicationId: APP_ID }), first);
  assert.deepStrictEqual(withoutGrant(first.body), { allowed: true, attemptsUsed: 1, remaining: 1 });
  const second = fakeRes();
  await handler(post({ applicationId: APP_ID }), second);
  assert.deepStrictEqual(withoutGrant(second.body), { allowed: true, attemptsUsed: 2, remaining: 0 });
  const third = fakeRes();
  await handler(post({ applicationId: APP_ID }), third);
  assert.deepStrictEqual(third.body, { allowed: false, attemptsUsed: 2, remaining: 0 });
});

test("the count lives under research-attempts:<applicationId> with a 30-day TTL", async () => {
  await handler(post({ applicationId: APP_ID }), fakeRes());
  assert.strictEqual(store[`research-attempts:${APP_ID}`], 1);
  assert.strictEqual(ttls[`research-attempts:${APP_ID}`], 30 * 24 * 3600);
});

test("applications are counted independently", async () => {
  await handler(post({ applicationId: APP_ID }), fakeRes());
  await handler(post({ applicationId: APP_ID }), fakeRes());
  const other = fakeRes();
  await handler(post({ applicationId: "11111111-2222-4333-8444-555555555555" }), other);
  assert.strictEqual(other.body.allowed, true);
});

test("a missing or non-UUID application id is a 400 and nothing is stored", async () => {
  for (const body of [{}, { applicationId: "" }, { applicationId: "not-a-uuid" }, { applicationId: 42 }, { applicationId: "x".repeat(300) }]) {
    const res = fakeRes();
    await handler(post(body), res);
    assert.strictEqual(res.statusCode, 400);
    assert.deepStrictEqual(res.body, { error: "invalid_application_id" });
  }
  assert.deepStrictEqual(store, {});
});

test("a storage failure refuses the search (fail closed)", async () => {
  handler.__setDeps({ storage: { async get() { throw new Error("kv down"); }, async set() {} } });
  const res = fakeRes();
  await handler(post({ applicationId: APP_ID }), res);
  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(res.body, { allowed: false, attemptsUsed: null, remaining: null, warning: "attempt_store_unavailable" });
});

test("only POST is accepted", async () => {
  const res = fakeRes();
  await handler({ method: "GET", headers: {}, query: {} }, res);
  assert.strictEqual(res.statusCode, 405);
});

test("an allowed search returns a grant for this application; a refused one returns none", async () => {
  store[`research-attempts:${APP_ID}`] = 1;
  const allowed = fakeRes();
  await handler(post({ applicationId: APP_ID }), allowed);
  assert.strictEqual(allowed.body.allowed, true);
  assert.strictEqual(researchGrant.verify(allowed.body.grant, { subject: `application:${APP_ID}`, tenantId: "" }).valid, true);

  const refused = fakeRes();
  await handler(post({ applicationId: APP_ID }), refused);
  assert.strictEqual(refused.body.allowed, false);
  assert.strictEqual("grant" in refused.body, false);
});

test("no grant secret refuses the search without spending it", async () => {
  const saved = { r: process.env.RESEARCH_GRANT_SECRET, d: process.env.DOSSIER_TOKEN_SECRET };
  delete process.env.RESEARCH_GRANT_SECRET;
  delete process.env.DOSSIER_TOKEN_SECRET;
  try {
    store[`research-attempts:${APP_ID}`] = 1;
    const res = fakeRes();
    await handler(post({ applicationId: APP_ID }), res);
    assert.deepStrictEqual(res.body, { allowed: false, attemptsUsed: 1, remaining: 1, warning: "grant_unavailable" });
    assert.strictEqual(store[`research-attempts:${APP_ID}`], 1);
  } finally {
    process.env.RESEARCH_GRANT_SECRET = saved.r;
    if (saved.d !== undefined) process.env.DOSSIER_TOKEN_SECRET = saved.d;
  }
});
