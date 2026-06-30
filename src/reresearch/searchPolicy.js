/**
 * searchPolicy.js — pure, UI-agnostic policy for the self-serve re-research
 * two-retry cap and the dispute-kind mapping.
 *
 * No I/O, no React. CommonJS-in-src (the engine / pipeline.js precedent) so it's
 * requireable by node --test AND importable by App.js via the CJS↔ESM interop,
 * while staying inside src/ for CRA's ModuleScopePlugin. The authoritative
 * attempt COUNT lives server-side on entity_dossiers.search_attempts
 * (api/search-attempt.js); this module only interprets a count into UI decisions,
 * and maps the one-question dialogue answer to the lifecycle dispute kind.
 *
 * Cap semantics (exactly as specified):
 *   attempts = number of searches ALREADY run for this dossier.
 *     0 → first search, allowed, no alert
 *     1 → second search, allowed, show the legal-name alert
 *    ≥2 → locked: all search options disabled, manual entry only
 */

const SEARCH_CAP = 2;

// Shown on the SECOND attempt — the usual cause of a second miss is the name.
const LEGAL_NAME_ALERT =
  "Use the legal entity name exactly as registered with the local authority — " +
  "not a trade name or common name.";

// Shown once the cap is hit and only manual entry remains.
const CONTACT_ADMIN_MSG =
  "You've used your available searches. You can continue by entering the " +
  "application manually. To use the other search options, contact your admin.";

/**
 * evaluateSearchCap(attempts) → cap decision for the Step 1 search options.
 * Treats a null/unknown count as 0 (fail-open to the first attempt; the server
 * counter is the real gate and a re-search always carries a dossierId).
 */
function evaluateSearchCap(attempts) {
  const n = Number.isFinite(attempts) ? attempts : 0;
  return {
    attempts: n,
    locked: n >= SEARCH_CAP, // disable API / document / AI search; manual only
    isSecondAttempt: n === SEARCH_CAP - 1, // show the legal-name alert
    attemptsRemaining: Math.max(0, SEARCH_CAP - n),
  };
}

// Map the one-question dialogue answer to the dossierLifecycle dispute kind.
// 'different_company' → identity (discard research, full re-research)
// 'wrong_details'     → interpretation (keep research, re-derive only)
function disputeKindFromAnswer(answer) {
  if (answer === "different_company") return "identity";
  if (answer === "wrong_details") return "interpretation";
  return null;
}

module.exports = {
  SEARCH_CAP,
  LEGAL_NAME_ALERT,
  CONTACT_ADMIN_MSG,
  evaluateSearchCap,
  disputeKindFromAnswer,
};
