"use strict";

// How long UBO records are kept.
//
// The product owner's instruction: seven years, hard-coded, nothing ever
// hard-deleted. These tests exist because a retention period is the kind of
// rule that gets quietly shortened by somebody who does not know what it is
// for - a test is the only version of that rule that argues back.

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const retention = require("../uboRetention");

test("the period is seven years, and not configurable by accident", () => {
  assert.equal(retention.RETENTION_YEARS, 7);

  // Not read from the environment. A retention period that an environment
  // variable can shorten can be shortened in production by somebody who does
  // not know what it is for - which is why UBO-RET-1 exists as a deliberate
  // decision rather than a switch.
  const source = fs.readFileSync(path.join(__dirname, "..", "uboRetention.js"), "utf8");
  assert.ok(!/process\.env/.test(source), "the retention period must not come from configuration");
});

test("a record made today is kept until seven years from today", () => {
  assert.equal(retention.retainUntil(new Date("2026-09-22T10:00:00.000Z")), "2033-09-22T10:00:00.000Z");
});

test("a leap day is kept for seven years, not for a drifted number of days", () => {
  // Counting milliseconds would land this on the 27th or 28th of February.
  assert.equal(retention.retainUntil(new Date("2028-02-29T00:00:00.000Z")), "2035-03-01T00:00:00.000Z");
});

test("a record carries the period it was made under", () => {
  // Stamped on write, not calculated on read: if the period ever changes, old
  // records keep the promise they were made under.
  const stamped = retention.withRetention({ id: "case-1" }, new Date("2026-09-22T10:00:00.000Z"));
  assert.equal(stamped.retainUntil, "2033-09-22T10:00:00.000Z");
  assert.equal(stamped.id, "case-1");

  const again = retention.withRetention(stamped, new Date("2027-01-01T00:00:00.000Z"));
  assert.equal(again.retainUntil, "2033-09-22T10:00:00.000Z", "re-stamping must never move the date");
});

test("a record inside its period may not be deleted", () => {
  const stamped = retention.withRetention({}, new Date("2026-09-22T00:00:00.000Z"));
  assert.equal(retention.isWithinRetention(stamped, new Date("2030-01-01T00:00:00.000Z")), true);
  assert.equal(retention.isWithinRetention(stamped, new Date("2033-09-21T00:00:00.000Z")), true);
  assert.equal(retention.isWithinRetention(stamped, new Date("2033-09-23T00:00:00.000Z")), false);
});

test("a record with no stamp is treated as still within its period", () => {
  // "We cannot prove the period has passed" must never resolve to "delete it".
  assert.equal(retention.isWithinRetention({}, new Date("2099-01-01T00:00:00.000Z")), true);
  assert.equal(retention.isWithinRetention(null), true);
});

test("nothing in the UBO record paths hard-deletes", () => {
  // Rule two, as a test rather than a habit: "delete" means marked and hidden,
  // never removed. This reads the source because the rule is about what the
  // code is allowed to contain, not about what one function returns.
  const lib = path.join(__dirname, "..");
  for (const file of ["uboTrials.js", "uboRetention.js"]) {
    const source = fs.readFileSync(path.join(lib, file), "utf8");
    assert.ok(
      !/storage\.del\(/.test(source),
      `${file} must not hard-delete a UBO record - see the retention rule in lib/uboRetention.js`
    );
  }
});

test("a trial record is kept for seven years, not for the length of the trial", async () => {
  // The two clocks that get confused: the trial ENDS in days, the record is
  // KEPT for years. A prospect's work must not vanish when their evaluation does.
  const trials = require("../uboTrials");
  const store = new Map();
  trials.__setDeps({
    storage: {
      get: async (k) => (store.has(k) ? store.get(k) : null),
      set: async (k, v) => { store.set(k, v); },
    },
    userAccess: { grantAccess: async () => {} },
    now: () => Date.parse("2026-09-22T10:00:00.000Z"),
  });

  const invite = await trials.createInvite({ company: "Acme", seats: 2, days: 7, budget: 10, createdBy: "user_owner" });
  const redeemed = await trials.redeem({ code: invite.code, userId: "user_1", email: "a@acme.test" });

  assert.equal(redeemed.ok, true);
  assert.equal(redeemed.access.trialEndsAt, "2026-09-29T10:00:00.000Z");
  assert.equal(redeemed.access.retainUntil, "2033-09-22T10:00:00.000Z");
});
