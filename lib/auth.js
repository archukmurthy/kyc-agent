// Server-side auth utilities. Mirrors src/utils/auth.js - keep in sync.
// CommonJS so api/ files can `require` it without ESM gymnastics.

const crypto = require("node:crypto");

const SALT = "nium-kyc-2026";

function hashPassword(password) {
  const str = SALT + (password || "");
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36) + str.length.toString(36);
}

// Constant-time comparison of the computed hash against the stored one -
// same pattern as verifyEnvBearer below: length checked first (timingSafeEqual
// throws on a mismatch), then compared byte-for-byte regardless of where the
// difference falls.
function verifyPassword(input, storedHash) {
  if (!input || typeof storedHash !== "string" || !storedHash) return false;
  const a = Buffer.from(hashPassword(input));
  const b = Buffer.from(storedHash);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

const WORDS = [
  "amber", "brave", "cloud", "delta", "eagle",
  "frost", "grove", "haven", "iris", "jade",
  "kite", "lunar", "mist", "nova", "opal",
  "pine", "quest", "river", "storm", "tide",
  "ultra", "vale", "wave", "xenon", "yield",
  "zeal",
];

function generatePassword() {
  const w1 = WORDS[Math.floor(Math.random() * WORDS.length)];
  const w2 = WORDS[Math.floor(Math.random() * WORDS.length)];
  const n = Math.floor(Math.random() * 9000 + 1000);
  return `${w1}-${w2}-${n}`;
}

// Constant-time comparison of a bearer token against an env-var secret.
// Length is compared first because timingSafeEqual throws on length mismatch;
// leaking the length of a shared password is not a meaningful weakness here.
function verifyEnvBearer(token, envName) {
  const expected = process.env[envName];
  if (!expected || typeof token !== "string" || !token) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = { hashPassword, verifyPassword, generatePassword, verifyEnvBearer };
