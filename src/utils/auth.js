// Client-side auth utilities. Mirrored by lib/auth.js (CommonJS) for API
// routes — keep the two in sync. Deliberately simple; if you outgrow this
// (real bcrypt, scrypt, argon2 etc.) replace BOTH files together.

const SALT = "kyb-platform-2026";

/**
 * Deterministic string hash with a fixed salt. Not cryptographically secure
 * — sufficient for protecting per-tenant admin URLs at this stage. Replace
 * with bcrypt / argon2 if you ever expose tenant passwords externally.
 */
export function hashPassword(password) {
  const str = SALT + (password || "");
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36) + str.length.toString(36);
}

/**
 * Constant-time-ish comparison of the hashes (string.equals is fine for
 * short fixed-length strings at this scale; not constant-time but the
 * security model here doesn't require it).
 */
export function verifyPassword(input, storedHash) {
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

/**
 * Memorable three-segment password: word-word-NNNN.
 * Easy to read aloud, easy to type, hard to guess at this length.
 */
export function generatePassword() {
  const w1 = WORDS[Math.floor(Math.random() * WORDS.length)];
  const w2 = WORDS[Math.floor(Math.random() * WORDS.length)];
  const n = Math.floor(Math.random() * 9000 + 1000);
  return `${w1}-${w2}-${n}`;
}
