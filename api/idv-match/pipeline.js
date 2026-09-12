"use strict";

// End-to-end discrepancy-bands pipeline (behind IDV_DISCREPANCY_BANDS_ENABLED).
// Ties the pure stages together: hygiene -> band assignment -> (Band B) one-round
// resolution -> record-only behaviours. This is the single server-side entry the
// applicant flow will call once the flag is on. When the flag is OFF it returns
// { enabled:false } and does nothing, so the live journey is unchanged.
const { bandsEnabled } = require("./config");
const { runHygiene } = require("./matching/hygiene");
const { parseOfficerName, buildDocName, buildMrzName } = require("./matching/normalize");
const { assignBand } = require("./bandAssignment");
const { resolveBandB } = require("./resolution");
const { recordBandOutcome } = require("./behaviors");

async function runBandPipeline(input = {}, deps = {}) {
  if (!bandsEnabled()) return { enabled: false };

  const {
    officerSnapshot, identity, attemptId, applicationId = null,
    screeningHit = false, escalationFlag = false, livenessPassed = false,
    companyDisplayName, documentDisplayName,
  } = input;

  const hygiene = runHygiene({ officerSnapshot, identity });
  const band = assignBand({ hygiene, screeningHit, escalationFlag });

  // Missing/unreadable required data -> retry, never a match, no decision row.
  if (band.needsRetry) return { enabled: true, band: null, needsRetry: true, reasons: band.reasons };

  if (band.band === "B") {
    const officerName = parseOfficerName(officerSnapshot.name);
    const docName = buildDocName({ firstName: identity.first_name, lastName: identity.last_name });
    const mrzName = identity.mrz != null ? buildMrzName(identity.mrz) : null;

    const res = resolveBandB({
      officerName, docName, mrzName, companyDisplayName, documentDisplayName,
      livenessPassed, screeningHit, escalationFlag,
    });

    // Dialogue is not a terminal outcome — no decision row until the applicant answers.
    if (res.dialogue) return { enabled: true, band: "B", dialogue: res };

    const recorded = await recordBandOutcome({
      attemptId, applicationId,
      decision: {
        band: "B", outcomeType: res.outcomeType, resolvedBy: res.resolvedBy,
        score: res.score, basis: res.basis, ruleIds: res.ruleIds,
        policyVersion: res.policyVersion, reasons: res.reasons, applicantView: res.applicantView,
        // Carry the hard-exclusion review flag through — resolveBandB's toReview()
        // sets requiresReview:true; without this it's dropped and behaviors records
        // requiresReview:false on a genuine review outcome (compliance contract).
        requiresReview: res.requiresReview,
      },
    }, deps);
    return { enabled: true, band: "B", outcomeType: res.outcomeType, resolved: !!res.resolved, ...recorded };
  }

  // Band A or Band C: record and apply side effects.
  const recorded = await recordBandOutcome({ attemptId, applicationId, decision: band }, deps);
  return { enabled: true, band: band.band, outcomeType: band.outcomeType, ...recorded };
}

module.exports = { runBandPipeline };
