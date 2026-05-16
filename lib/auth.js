// Server-side auth utilities. Mirrors src/utils/auth.js — keep in sync.
// CommonJS so api/ files can `require` it without ESM gymnastics.

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

function verifyPassword(input, storedHash) {
  if (!input || !storedHash) return false;
  return hashPassword(input) === storedHash;
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

module.exports = { hashPassword, verifyPassword, generatePassword };
