"use strict";

// Auto-match (Section B one-click): given the frozen candidate officers and the
// applicant's extracted identity, pick the officer whose name is most plausibly
// the SAME PERSON as the document — so the applicant never has to select
// themselves from a dropdown. The backend decides from data it already has.
//
// PURE. Reuses the Phase 6 name-equivalence engine: a candidate is a plausible
// match when the document name is at/above the ask-threshold OR a known rule
// (transliteration, phonetic, patronymic…) explains the variance — the identical
// bar resolveBandB uses to decide "plausibly the same person". No plausible
// candidate -> matched:false, and the caller routes the applicant to the LOA path.
const { parseOfficerName, buildDocName, buildMrzName } = require("./matching/normalize");
const { scoreEquivalence } = require("./nameEquivalence");
const { getPolicy } = require("./policy");

// { candidates: [officerSnapshot], identity: canonical } -> { officer|null, score, matched }
function pickBestOfficer({ candidates = [], identity = {} } = {}) {
  const docName = identity.mrz != null
    ? buildMrzName(identity.mrz)
    : buildDocName({ firstName: identity.first_name, lastName: identity.last_name });
  const th = getPolicy().thresholds;

  let best = null;
  for (const candidate of candidates) {
    if (!candidate || !candidate.name) continue;
    const chName = parseOfficerName(candidate.name);
    let eq;
    try { eq = scoreEquivalence(chName, docName); }
    catch (_) { continue; } // unparseable name on either side — skip this candidate
    if (!best || eq.score > best.eq.score) best = { officer: candidate, eq };
  }

  const plausible = !!(best && (best.eq.ruleExplained || best.eq.score >= th.skipToReview));
  return {
    officer: plausible ? best.officer : null,
    score: best ? best.eq.score : 0,
    matched: plausible,
  };
}

module.exports = { pickBestOfficer };
