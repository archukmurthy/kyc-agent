"use strict";

// A ceiling on what one account can spend in a day.
//
// Per-person limits multiply: forty analysts at fifteen calls an hour is six
// hundred calls an hour, and per-person limits happily allow all of them. This
// is the number you can put in front of an investor when asked "what is the
// worst case on your bill".
//
// It is a circuit breaker, not a queue. Set far above real use, and it ALERTS
// long before it stops anything - a ceiling with no warning is a trap.

const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const spendCap = require("../spendCap");

let store;
let clock;
let alerts;

beforeEach(() => {
  store = new Map();
  clock = Date.parse("2026-09-22T10:00:00.000Z");
  alerts = [];
  delete process.env.SPEND_CAP_DAILY;
  spendCap.__setDeps({
    storage: {
      get: async (k) => (store.has(k) ? store.get(k) : null),
      set: async (k, v) => { store.set(k, v); },
    },
    now: () => clock,
    alert: (event) => alerts.push(event),
  });
});

test("normal use is nowhere near the ceiling", async () => {
  for (let i = 0; i < 50; i++) await spendCap.record("acme");
  const status = await spendCap.check("acme");
  assert.equal(status.blocked, false);
  assert.equal(alerts.length, 0, "a ceiling that cries wolf gets ignored");
});

test("it alerts at 60% and again at 85%, once each", async () => {
  const limit = spendCap.DEFAULT_DAILY_LIMIT;
  for (let i = 0; i < Math.ceil(limit * 0.6); i++) await spendCap.record("acme");
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].threshold, 60);

  for (let i = 0; i < Math.ceil(limit * 0.25); i++) await spendCap.record("acme");
  assert.equal(alerts.length, 2);
  assert.equal(alerts[1].threshold, 85);

  // Crossing the same line repeatedly must not spam.
  await spendCap.record("acme");
  assert.equal(alerts.length, 2);
});

test("at the ceiling it blocks, and says which account", async () => {
  const limit = spendCap.DEFAULT_DAILY_LIMIT;
  for (let i = 0; i < limit; i++) await spendCap.record("acme");
  const status = await spendCap.check("acme");
  assert.equal(status.blocked, true);
  assert.equal(status.tenantId, "acme");
  assert.ok(status.message.includes("today"));
});

test("one account hitting its ceiling does not affect another", async () => {
  for (let i = 0; i < spendCap.DEFAULT_DAILY_LIMIT; i++) await spendCap.record("acme");
  assert.equal((await spendCap.check("beta")).blocked, false);
});

test("the count resets the next day", async () => {
  for (let i = 0; i < spendCap.DEFAULT_DAILY_LIMIT; i++) await spendCap.record("acme");
  assert.equal((await spendCap.check("acme")).blocked, true);
  clock += 24 * 60 * 60 * 1000;
  assert.equal((await spendCap.check("acme")).blocked, false);
});

test("a customer's ceiling can be raised without a deploy", async () => {
  // A real customer hitting the ceiling on a busy day needs a number changed in
  // a minute, not a release.
  process.env.SPEND_CAP_DAILY = "10";
  for (let i = 0; i < 10; i++) await spendCap.record("acme");
  assert.equal((await spendCap.check("acme")).blocked, true);

  process.env.SPEND_CAP_DAILY = "50";
  assert.equal((await spendCap.check("acme")).blocked, false);
});

test("a storage failure allows the call rather than stopping work", async () => {
  // Same trade as the rate limiter: this is a safety net, and a safety net that
  // fails closed takes the product down when the store hiccups.
  spendCap.__setDeps({ storage: { get: async () => { throw new Error("kv down"); } } });
  assert.equal((await spendCap.check("acme")).blocked, false);
});

test("an unnamed account is not counted, and not blocked", async () => {
  // Trial users are metered by their trial budget, not this; anonymous callers
  // are bounded by the rate limiter.
  assert.equal((await spendCap.check(null)).blocked, false);
  assert.equal(await spendCap.record(null), null);
});

// ── the platform-wide ceiling ──────────────────────────────────────────────
//
// Per-account ceilings do not bound OUR bill: ten accounts at the account limit
// is ten times the spend. This is the one number that answers "what is the
// worst case", and it is the figure to put in front of an investor.

test("the account default is set for today, not for an imagined enterprise", () => {
  // Roughly 12-25 USD a day at current pricing. Raised per customer when one
  // signs, which is an environment variable rather than a release.
  assert.equal(spendCap.DEFAULT_DAILY_LIMIT, 100);
});

test("the platform ceiling stops everything once reached, whoever is asking", async () => {
  process.env.SPEND_CAP_PLATFORM_DAILY = "5";
  for (let i = 0; i < 5; i++) await spendCap.record("acme");
  const other = await spendCap.check("beta");
  assert.equal(other.blocked, true);
  assert.equal(other.scope, "platform", "a fresh account must not get a clean allowance once the platform ceiling is gone");
  delete process.env.SPEND_CAP_PLATFORM_DAILY;
});

test("the platform ceiling alerts before it bites, like the account one", async () => {
  process.env.SPEND_CAP_PLATFORM_DAILY = "10";
  for (let i = 0; i < 6; i++) await spendCap.record("acme");
  const platformAlerts = alerts.filter((a) => a.scope === "platform");
  assert.equal(platformAlerts.length, 1);
  assert.equal(platformAlerts[0].threshold, 60);
  delete process.env.SPEND_CAP_PLATFORM_DAILY;
});

test("the account ceiling still applies below the platform one", async () => {
  process.env.SPEND_CAP_DAILY = "3";
  process.env.SPEND_CAP_PLATFORM_DAILY = "100";
  for (let i = 0; i < 3; i++) await spendCap.record("acme");
  const acme = await spendCap.check("acme");
  assert.equal(acme.blocked, true);
  assert.equal(acme.scope, "account");
  assert.equal((await spendCap.check("beta")).blocked, false, "one account's ceiling is not another's");
  delete process.env.SPEND_CAP_DAILY;
  delete process.env.SPEND_CAP_PLATFORM_DAILY;
});
