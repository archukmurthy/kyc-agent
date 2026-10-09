// Client-side auth utilities. Mirrored by lib/auth.js (CommonJS) for API
// routes - keep the two in sync. Deliberately simple; if you outgrow this
// (real bcrypt, scrypt, argon2 etc.) replace BOTH files together.

// Password hashing lives server-side only (lib/auth.js). It used to be
// mirrored here too, salt and all, which put a hashing secret into the browser
// bundle - and nothing in the app ever called it. Only generatePassword below
// is used, and it needs no secret.

const WORDS = [
  "amber", "brave", "cloud", "delta", "eagle",
  "frost", "grove", "haven", "iris", "jade",
  "kite", "lunar", "mist", "nova", "opal",
  "pine", "quest", "river", "storm", "tide",
  "ultra", "vale", "wave", "xenon", "yield",
  "zeal",
];

export function generatePassword() {
  const w1 = WORDS[Math.floor(Math.random() * WORDS.length)];
  const w2 = WORDS[Math.floor(Math.random() * WORDS.length)];
  const n = Math.floor(Math.random() * 9000 + 1000);
  return `${w1}-${w2}-${n}`;
}
