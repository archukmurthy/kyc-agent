const { test } = require("node:test");
const assert = require("node:assert");
const { verifyEnvBearer, hashPassword, verifyPassword } = require("../auth");

test("verifyPassword matches only the correct password, via constant-time hash comparison", () => {
  const hash = hashPassword("correct-horse");
  assert.strictEqual(verifyPassword("correct-horse", hash), true);
  assert.strictEqual(verifyPassword("wrong", hash), false);
  assert.strictEqual(verifyPassword("", hash), false);
  assert.strictEqual(verifyPassword(null, hash), false);
  assert.strictEqual(verifyPassword("correct-horse", null), false);
  assert.strictEqual(verifyPassword("correct-horse", "not-the-hash-and-different-length"), false);
  // Corrupt stored data (a non-string hash) is a plain mismatch, never a throw.
  assert.strictEqual(verifyPassword("correct-horse", 12345), false);
  assert.strictEqual(verifyPassword("correct-horse", { passwordHash: hash }), false);
});

test("verifyEnvBearer is false when the env var is unset", (t) => {
  const prev = process.env.TEST_SECRET_ENV;
  delete process.env.TEST_SECRET_ENV;
  t.after(() => { if (prev !== undefined) process.env.TEST_SECRET_ENV = prev; });
  assert.strictEqual(verifyEnvBearer("anything", "TEST_SECRET_ENV"), false);
});

test("verifyEnvBearer matches only the exact value", (t) => {
  const prev = process.env.TEST_SECRET_ENV;
  process.env.TEST_SECRET_ENV = "s3cret-value";
  t.after(() => {
    if (prev === undefined) delete process.env.TEST_SECRET_ENV;
    else process.env.TEST_SECRET_ENV = prev;
  });
  assert.strictEqual(verifyEnvBearer("s3cret-value", "TEST_SECRET_ENV"), true);
  assert.strictEqual(verifyEnvBearer("s3cret-valu", "TEST_SECRET_ENV"), false);
  assert.strictEqual(verifyEnvBearer("", "TEST_SECRET_ENV"), false);
  assert.strictEqual(verifyEnvBearer(null, "TEST_SECRET_ENV"), false);
});
