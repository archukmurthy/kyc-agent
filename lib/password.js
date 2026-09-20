// How passwords are stored.
//
// The old scheme (lib/auth.js#hashPassword) is a 32-bit rolling hash over a
// fixed, public salt. It is not a KDF: a copy of the store yields the passwords
// in seconds, and two tenants that pick the same password store the same value.
//
// This uses scrypt from node:crypto - a real password KDF, no new dependency.
// Stored as: scrypt$N$r$p$<salt base64>$<hash base64>, so the parameters travel
// with the value and can be raised later without breaking old rows.
//
// Legacy values still verify, once. verify() reports needsRehash so the login
// route can rewrite the stored value with the modern format - nobody is locked
// out and nobody has to be told to reset anything.
//
// CommonJS so api/ handlers and src/setupProxy.js can require it.

const crypto = require("node:crypto");
const legacy = require("./auth");

// ~100ms per verification on a typical serverless CPU. High enough that
// guessing is expensive, low enough that a login does not feel slow.
const N = 16384;
const R = 8;
const P = 1;
const KEY_LENGTH = 32;
const SALT_BYTES = 16;
const PREFIX = "scrypt";

function derive(plain, salt, n = N, r = R, p = P) {
  return crypto.scryptSync(String(plain), salt, KEY_LENGTH, { N: n, r, p, maxmem: 64 * 1024 * 1024 });
}

function hash(plain) {
  const salt = crypto.randomBytes(SALT_BYTES);
  const key = derive(plain, salt);
  return [PREFIX, N, R, P, salt.toString("base64"), key.toString("base64")].join("$");
}

function isModern(stored) {
  return typeof stored === "string" && stored.startsWith(PREFIX + "$");
}

/** @returns {{ ok: boolean, needsRehash: boolean }} */
function verify(plain, stored) {
  if (!plain || typeof stored !== "string" || !stored) return { ok: false, needsRehash: false };

  if (!isModern(stored)) {
    // One more login on the old format, then it is rewritten by the caller.
    const ok = legacy.verifyPassword(plain, stored);
    return { ok, needsRehash: ok };
  }

  const parts = stored.split("$");
  if (parts.length !== 6) return { ok: false, needsRehash: false };
  const [, n, r, p, saltB64, keyB64] = parts;

  let expected;
  let actual;
  try {
    expected = Buffer.from(keyB64, "base64");
    actual = derive(plain, Buffer.from(saltB64, "base64"), Number(n), Number(r), Number(p));
  } catch (_) {
    return { ok: false, needsRehash: false };
  }
  if (expected.length !== actual.length) return { ok: false, needsRehash: false };

  const ok = crypto.timingSafeEqual(expected, actual);
  // Parameters can be raised later; a login under the old cost upgrades itself.
  const stale = Number(n) < N || Number(r) < R || Number(p) < P;
  return { ok, needsRehash: ok && stale };
}

module.exports = { hash, verify, isModern, PARAMS: { N, R, P } };
