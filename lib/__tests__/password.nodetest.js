"use strict";

// Password storage. The old scheme was a 32-bit rolling hash with a fixed,
// public salt - a copy of the store yielded the passwords. These tests state
// what a real one has to do.

const { test } = require("node:test");
const assert = require("node:assert");
const password = require("../password");

test("a hash does not contain the password and is not reversible by shape", () => {
  const stored = password.hash("correct horse battery staple");
  assert.ok(!stored.includes("correct"), "the password must not appear in the stored value");
  assert.match(stored, /^scrypt\$/, "the format names the algorithm so it can be migrated later");
});

test("the same password hashed twice gives different values", () => {
  // Per-password salt. Identical passwords across two tenants must not produce
  // identical stored values, or one cracked hash cracks both.
  assert.notEqual(password.hash("same-password"), password.hash("same-password"));
});

test("the right password verifies and the wrong one does not", () => {
  const stored = password.hash("s3cret-value");
  assert.equal(password.verify("s3cret-value", stored).ok, true);
  assert.equal(password.verify("s3cret-valu", stored).ok, false);
  assert.equal(password.verify("", stored).ok, false);
});

test("a legacy hash still verifies, and asks to be upgraded", () => {
  // Nobody is locked out by the change: the old value keeps working for one
  // more login, and that login rewrites it.
  const legacy = require("../auth").hashPassword("old-password");
  const result = password.verify("old-password", legacy);
  assert.equal(result.ok, true);
  assert.equal(result.needsRehash, true, "a correct legacy login must trigger an upgrade");
});

test("a correct modern login does not ask for a rehash", () => {
  const stored = password.hash("modern");
  assert.equal(password.verify("modern", stored).needsRehash, false);
});

test("a wrong password against a legacy hash is still refused", () => {
  const legacy = require("../auth").hashPassword("old-password");
  assert.equal(password.verify("guess", legacy).ok, false);
});

test("garbage in the stored field is refused rather than throwing", () => {
  for (const junk of ["", null, undefined, "scrypt$nonsense", "scrypt$1$2$3$4$5$6"]) {
    assert.equal(password.verify("anything", junk).ok, false, `stored=${junk}`);
  }
});

test("verification cost is high enough to make guessing slow", () => {
  // A rolling hash verified in microseconds; a KDF must not. This is the whole
  // point of the change, so it is asserted rather than assumed.
  const stored = password.hash("timing");
  const started = process.hrtime.bigint();
  password.verify("timing", stored);
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  assert.ok(ms > 5, `verification took ${ms.toFixed(1)}ms, too fast to resist guessing`);
});
