"use strict";

// Versioned policy for identity discrepancy matching. Thresholds are
// configuration (compliance will tune them); every match decision records the
// policyVersion that judged it. Read everything through getPolicy() so a later
// move to a DB-backed config is a single change. Rule tables (transliteration /
// phonetic / patronymic) are added in Phase 6.
const POLICY_VERSION = "idv-match-1.0.0";

function getPolicy() {
  return {
    policyVersion: POLICY_VERSION,
    thresholds: {
      // Name-similarity score at/above which a variance auto-resolves (Band B 5a).
      autoResolve: 0.9,
      // Score below which we skip the applicant dialogue and go straight to review.
      skipToReview: 0.6,
      // Combined threshold: a near-threshold score plus a corroborating explanation
      // may clear together (Band B 5c option 1).
      combinedExplanation: 0.8,
    },
    // Filled in Phase 6 (name-equivalence engine). Each rule carries its own id.
    ruleTables: {},
  };
}

module.exports = { getPolicy, POLICY_VERSION };
