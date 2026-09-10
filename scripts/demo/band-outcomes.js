"use strict";
/*
 * DEMO: Band A/B/C outcomes, driven by the REAL band logic (no DB, no network).
 * Shows exactly what the platform decides for controlled officer-vs-document
 * inputs — useful to demo the band variations that a live Didit sandbox can't
 * reliably force. Run:  node scripts/demo/band-outcomes.js
 */
const { runHygiene } = require("../../api/idv-match/matching/hygiene");
const { assignBand } = require("../../api/idv-match/bandAssignment");
const { resolveBandB } = require("../../api/idv-match/resolution");
const { parseOfficerName, buildDocName, buildMrzName } = require("../../api/idv-match/matching/normalize");

function demo(title, officer, identity, opts = {}) {
  console.log("\n=== " + title + " ===");
  console.log("  Officer (Companies House): " + officer.name + "  | month/year of birth: " + officer.birthMonthYear);
  console.log("  Verified document identity: " + [identity.first_name, identity.last_name].filter(Boolean).join(" ") + "  | DOB: " + (identity.date_of_birth || "(missing)"));
  if (opts.screeningHit) console.log("  Screening: PEP/sanctions HIT present");

  const hygiene = runHygiene({ officerSnapshot: officer, identity });
  const band = assignBand({ hygiene, screeningHit: !!opts.screeningHit, escalationFlag: false });

  if (band.needsRetry) {
    console.log("  RESULT: RETRY (missing/unreadable data is never a match) — applicant asked to verify again");
    return;
  }
  console.log("  RESULT: Band " + band.band + "  |  outcome: " + (band.outcomeType || "(decided in resolution)") + "  |  reasons: " + JSON.stringify(band.reasons));

  if (band.band === "B") {
    const res = resolveBandB({
      officerName: parseOfficerName(officer.name),
      docName: buildDocName({ firstName: identity.first_name, lastName: identity.last_name }),
      mrzName: identity.mrz ? buildMrzName(identity.mrz) : null,
      livenessPassed: true, screeningHit: !!opts.screeningHit,
    });
    if (res.resolved) console.log("  Band B auto-resolved at 5a: " + res.outcomeType + "  | basis: " + res.basis);
    else if (res.dialogue) console.log("  Band B -> shows the ONE-ROUND dialogue (applicant answers one question)");
    else console.log("  Band B -> " + res.outcomeType);
  }

  const sees = band.outcomeType === "unresolved_to_review" ? "neutral 'We're completing our checks' (routed to review)"
    : band.band === "A" ? "'Identity verified'"
    : band.band === "C" ? "'We couldn't confirm your details...' -> letter-of-authorization path"
    : "the one-round dialogue / then a result";
  console.log("  Applicant sees: " + sees + (band.escalate ? "  (+ internal escalation flag)" : ""));
}

console.log("################ BAND OUTCOME DEMO (real logic, no DB/network) ################");
demo("Band A — exact match", { name: "SMITH, John", birthMonthYear: "1985-05" }, { first_name: "John", last_name: "Smith", date_of_birth: "1985-05-24" });
demo("Band A — MRZ fixes a visual typo (extraction error)", { name: "LOVELACE, Ada", birthMonthYear: "1815-12" }, { first_name: "Ade", last_name: "Lovelace", date_of_birth: "1815-12-10", mrz: { surname: "LOVELACE", given_names: "ADA" } });
demo("Band B — transliteration variation (Murthy/Moorthy)", { name: "MURTHY, Ada", birthMonthYear: "1990-05" }, { first_name: "Ada", last_name: "Moorthy", date_of_birth: "1990-05-10" });
demo("Band C — different person (DOB conflict)", { name: "SMITH, John", birthMonthYear: "1985-05" }, { first_name: "Bob", last_name: "Jones", date_of_birth: "1970-01-01" });
demo("RETRY — missing DOB", { name: "SMITH, John", birthMonthYear: "1985-05" }, { first_name: "John", last_name: "Smith" });
demo("PEP/sanctions HIT — clean match blocked, routed to review", { name: "SMITH, John", birthMonthYear: "1985-05" }, { first_name: "John", last_name: "Smith", date_of_birth: "1985-05-24" }, { screeningHit: true });
console.log("\n(These are the exact decisions the live app makes; the app UI shows the applicant-facing copy for each.)");
