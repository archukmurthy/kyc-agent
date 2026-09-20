"use strict";

// AUTH-1: nothing throttles password guessing on the login routes today. A
// wrong password returns a fast 401, as many times as anyone likes.
//
// Counted on FAILURES, never attempts, so somebody mistyping their own password
// is not punished like an attacker.

const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const throttle = require("../loginThrottle");

let store;
let clock;
beforeEach(() => {
  store = new Map();
  clock = 1_700_000_000_000;
  throttle.__setDeps({
    storage: {
      get: async (k) => (store.has(k) ? store.get(k) : null),
      set: async (k, v) => { store.set(k, v); },
      del: async (k) => { store.delete(k); },
    },
    now: () => clock,
  });
});

const who = { account: "acme", ip: "1.2.3.4" };

test("a first attempt is never blocked", async () => {
  assert.equal((await throttle.check(who)).blocked, false);
});

test("five failures lock that account, and say for how long", async () => {
  for (let i = 0; i < 5; i++) await throttle.recordFailure(who);
  const result = await throttle.check(who);
  assert.equal(result.blocked, true);
  assert.equal(result.scope, "account");
  assert.ok(result.retryAfterSeconds > 0 && result.retryAfterSeconds <= 15 * 60);
});

test("a success clears the count - a typo is not an attack", async () => {
  for (let i = 0; i < 4; i++) await throttle.recordFailure(who);
  await throttle.recordSuccess(who);
  assert.equal((await throttle.check(who)).blocked, false);
  for (let i = 0; i < 4; i++) await throttle.recordFailure(who);
  assert.equal((await throttle.check(who)).blocked, false, "the counter restarted from zero");
});

test("the lock lifts once the window passes", async () => {
  for (let i = 0; i < 5; i++) await throttle.recordFailure(who);
  assert.equal((await throttle.check(who)).blocked, true);
  clock += 15 * 60 * 1000;
  assert.equal((await throttle.check(who)).blocked, false);
});

test("guessing across many accounts from one address is still caught", async () => {
  // The lock that matters: an attacker who knows one password is weak will try
  // it against every tenant rather than one account many times.
  for (let i = 0; i < 20; i++) {
    await throttle.recordFailure({ account: `tenant-${i}`, ip: "9.9.9.9" });
  }
  const result = await throttle.check({ account: "tenant-fresh", ip: "9.9.9.9" });
  assert.equal(result.blocked, true);
  assert.equal(result.scope, "address");
});

test("one attacker does not lock out an innocent account", async () => {
  for (let i = 0; i < 5; i++) await throttle.recordFailure({ account: "acme", ip: "6.6.6.6" });
  const other = await throttle.check({ account: "beta", ip: "7.7.7.7" });
  assert.equal(other.blocked, false);
});

test("a storage failure allows the attempt, loudly", async () => {
  // Failing closed here would lock every admin out of every tenant during a
  // storage blip. The trade is deliberate: availability over a guessing guard,
  // with the failure logged.
  throttle.__setDeps({ storage: { get: async () => { throw new Error("kv down"); } } });
  assert.equal((await throttle.check(who)).blocked, false);
});
