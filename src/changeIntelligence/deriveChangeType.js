/**
 * deriveChangeType.js — pure diff → 'add' | 'remove' | 'changed'.
 *
 * No engine dependency. No heuristics. This function is deliberately honest
 * about what values alone can and cannot tell you:
 *
 *   add:     aiValue empty/absent, finalValue present
 *   remove:  aiValue present, finalValue empty/absent
 *   changed: both present (the value moved)
 *
 * It CANNOT distinguish "correct" (the AI read an existing value wrong) from
 * "update" (the real-world value genuinely changed). That distinction is the
 * customer's intent answer, resolved by the caller — NOT inferred here from
 * string similarity or any other heuristic. The caller maps:
 *   ai_correction  => 'correct'      genuine_update => 'update'
 *
 * Degenerate input (both empty) is reported as 'changed' — it is a no-op the
 * caller should never have flagged as a diff, and there is no 'nochange'
 * outcome in the contract.
 */

function isEmpty(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return false;
}

// fieldClass is accepted for signature stability (and possible future
// field-class-specific emptiness rules) but is intentionally unused: presence
// vs absence is class-agnostic, and using it for anything else would be the
// kind of heuristic this function exists to avoid.
function deriveChangeType({ aiValue, finalValue, fieldClass } = {}) {
  void fieldClass;
  const aiEmpty = isEmpty(aiValue);
  const finalEmpty = isEmpty(finalValue);

  if (aiEmpty && !finalEmpty) return 'add';
  if (!aiEmpty && finalEmpty) return 'remove';
  // both present, or the degenerate both-empty case
  return 'changed';
}

module.exports = { deriveChangeType };
