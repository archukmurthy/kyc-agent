"use strict";

// Band assignment (Phase 5). Pure decision function over the Phase 4 hygiene
// output + the screening hit + any prior escalation flag. Produces the band and
// a route; terminal Band-B outcomes are decided later by the resolution flow
// (Phase 6 equivalence + Phase 7 dialogue), so Band B carries no terminal
// outcome here. No DB, no network.
const { getPolicy } = require("./policy");

const BANDS = Object.freeze({ A: "A", B: "B", C: "C" });
const OUTCOME = Object.freeze({
  AUTO_MATCH: "auto_match",
  EXTRACTION_ERROR_CORRECTED: "extraction_error_corrected",
  DEMOTED_TO_LOA_PATH: "demoted_to_loa_path",
  UNRESOLVED_TO_REVIEW: "unresolved_to_review",
});

function decision(fields) {
  return {
    band: null,
    outcomeType: null,
    resolvedBy: null,
    requiresReview: false,
    requiresResolution: false,
    needsRetry: false,
    escalate: false,
    reasons: [],
    policyVersion: getPolicy().policyVersion,
    ...fields,
  };
}

// { hygiene, screeningHit?, escalationFlag? } -> decision.
function assignBand({ hygiene, screeningHit = false, escalationFlag = false } = {}) {
  if (!hygiene || !hygiene.name || !hygiene.dob) throw new TypeError("assignBand requires Phase 4 hygiene output");
  const { name, dob } = hygiene;

  // 1. Missing/unreadable required data is NEVER a match -> retry, no band.
  if (hygiene.notMatchable) {
    return decision({ needsRetry: true, reasons: ["missing_required_data"] });
  }

  const reasons = [];
  if (screeningHit) reasons.push("screening_hit");
  if (escalationFlag) reasons.push("escalation_flag");
  const hardExcluded = !!(screeningHit || escalationFlag);

  // 2. A DOB month/year conflict overrides any name similarity - a name score can
  //    never beat a DOB conflict. A different DOB signals a different person ->
  //    Band C (existing LOA path + escalation).
  if (dob.conflict) {
    return decision({ band: BANDS.C, outcomeType: OUTCOME.DEMOTED_TO_LOA_PATH, resolvedBy: "system", escalate: true, reasons: [...reasons, "dob_conflict"] });
  }

  const identityMatches = name.exactMatch && dob.consistent;

  // 3. Hard exclusion: a sanctions/PEP/adverse-media hit or a prior escalation
  //    can never auto-pass, even on a clean identity match -> human review.
  if (hardExcluded) {
    return decision({
      band: identityMatches ? BANDS.A : BANDS.B,
      outcomeType: OUTCOME.UNRESOLVED_TO_REVIEW, resolvedBy: "reviewer",
      requiresReview: true, escalate: escalationFlag, reasons,
    });
  }

  // 4. Clean exact identity match (or MRZ-corrected visual) with consistent DOB.
  if (identityMatches) {
    return decision({
      band: BANDS.A,
      outcomeType: name.extractionErrorCorrected ? OUTCOME.EXTRACTION_ERROR_CORRECTED : OUTCOME.AUTO_MATCH,
      resolvedBy: "system", reasons,
    });
  }

  // 5. Name not exact but a comparable document name exists + DOB consistent ->
  //    variance -> Band B for the resolution flow. No terminal outcome yet.
  if (name.comparable) {
    return decision({ band: BANDS.B, requiresResolution: true, reasons: [...reasons, "name_variance"] });
  }

  // 6. Defensive: no comparable name and not an exact match -> review.
  return decision({ band: BANDS.B, outcomeType: OUTCOME.UNRESOLVED_TO_REVIEW, resolvedBy: "reviewer", requiresReview: true, reasons: [...reasons, "unresolved"] });
}

module.exports = { assignBand, BANDS, OUTCOME };
