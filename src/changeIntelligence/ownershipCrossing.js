/**
 * ownershipCrossing.js — did a shareholding change cross the UBO threshold?
 *
 * WHY THIS EXISTS. `thresholdCrossing` was hardcoded to 'unknown' for every
 * ownership change, on the stated grounds that "the person-type stub cannot
 * supply reliable ownership data". That conflated two different gaps: the
 * person-TYPE stub (director vs UBO inference) really is unreliable, but the
 * shareholding PERCENTAGE is not — real research returns it, and an inline
 * correction gives us the customer's new value. When both sides parse to a
 * number the crossing is arithmetic, not a guess.
 *
 * 'unknown' remains the honest answer when either side does not parse — a
 * registry band ("25-50%", "Over 25%", "More than 25 but less than 50") is a
 * range, and deciding a threshold question from a range would be exactly the
 * guess the engine is built to refuse.
 *
 * The 25% threshold is the standard UBO test (UK PSC / EU AMLD). It is a policy
 * constant, exported so a jurisdiction that differs can pass its own.
 */

const UBO_THRESHOLD_PCT = 25;

/**
 * A single percentage, or null if the value is a range/qualifier/unparseable.
 * "35%" → 35 · "35" → 35 · "35.5%" → 35.5
 * "25-50%" → null · "Over 25%" → null · "" → null
 */
function parsePercentage(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  const s = String(raw).trim();
  if (!s) return null;
  // Approximation and comparison symbols. Checked without \b, which does not
  // work next to a non-word character — "~25%" slipped through as 25.
  if (/[~≈<>±]/.test(s)) return null;
  // A hyphen before a digit is either a range ("25-50%") or a negative ("-5"),
  // and neither is a point value. Both used to yield the bare number.
  if (/-\s*\d/.test(s)) return null;
  if (/\d\s*(?:–|—|to\b)\s*\d/i.test(s)) return null;
  if (/\b(over|under|more than|less than|at least|up to|above|below|approx|around|circa)\b/i.test(s)) return null;
  const matches = s.match(/\d+(?:\.\d+)?/g);
  // Two or more numbers means a band we have not recognised — refuse it.
  if (!matches || matches.length !== 1) return null;
  const n = Number(matches[0]);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return n;
}

/**
 * @returns 'crossed_below' — was at/above the threshold, now below (may cease to be a UBO)
 *          'crossed_above' — was below, now at/above (may BECOME a UBO)
 *          'none'          — both sides on the same side of the threshold
 *          'unknown'       — either side unparseable; recorded, never guessed
 */
function ownershipCrossing(before, after, threshold = UBO_THRESHOLD_PCT) {
  const b = parsePercentage(before);
  const a = parsePercentage(after);
  if (b === null || a === null) return "unknown";
  const wasUbo = b >= threshold;
  const isUbo = a >= threshold;
  if (wasUbo && !isUbo) return "crossed_below";
  if (!wasUbo && isUbo) return "crossed_above";
  return "none";
}

module.exports = { ownershipCrossing, parsePercentage, UBO_THRESHOLD_PCT };
