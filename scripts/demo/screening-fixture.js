"use strict";
/*
 * DEMO: screening interpretation (PEP / sanctions / adverse-media), OFFLINE.
 * Feeds sample ComplyCube "attention" results through the REAL interpreter to
 * show the exact signal the band logic consumes. No network, no live calls.
 * Run:  node scripts/demo/screening-fixture.js
 *
 * NOTE: screening IS NOW wired into the live applicant flow (both the
 * auto_match and verify_only paths). This script demonstrates each category's
 * interpretation in isolation/offline, using fixture data instead of a real
 * ComplyCube call.
 */
const { interpretCheck } = require("../../api/idv-match/screening/interpret");

function fixture(section, value = "attention") {
  return { status: "complete", result: { outcome: value === "attention" ? "attention" : "clear", breakdown: { summary: section ? { [section]: { level1: "attention" } } : {}, matches: value === "attention" ? [{ id: "match-1" }] : [] } } };
}

function show(title, check) {
  const r = interpretCheck(check);
  console.log("\n=== " + title + " ===");
  console.log("  outcome: " + r.outcome + "  | HIT: " + r.hit + "  | matches: " + r.matchCount);
  console.log("  categories: pep=" + r.categories.pep + "  sanctions(watchlist)=" + r.categories.watchlist + "  adverse-media(criminal)=" + r.categories.adverseMedia);
  console.log("  band effect: " + (r.hit ? "HARD EXCLUSION -> applicant routed to review (never auto-passes)" : "no hit -> no effect on the band"));
}

console.log("################ SCREENING SIGNAL DEMO (offline, real interpreter) ################");
show("PEP hit", fixture("pep"));
show("Sanctions hit (watchlist)", fixture("watchlist"));
show("Adverse-media / criminal hit", fixture("adverseMedia"));
show("Clear (no hit)", fixture(null, "clear"));
console.log("\nIn the LIVE flow, any HIT above forces the band decision to 'unresolved_to_review'");
console.log("regardless of how well the name matched (screening is wired into both the");
console.log("auto_match and verify_only paths).");
