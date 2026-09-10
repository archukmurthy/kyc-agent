"use strict";
/*
 * DEMO: screening interpretation (PEP / sanctions / adverse-media), OFFLINE.
 * Feeds sample ComplyCube "attention" results through the REAL interpreter to
 * show the exact signal the band logic consumes. No network, no wiring into the
 * live flow. Run:  node scripts/demo/screening-fixture.js
 *
 * NOTE: screening is intentionally NOT wired into the live applicant flow yet
 * (BACKLOG SCR-2). This proves the screening decision logic in isolation.
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
console.log("\nIn the LIVE flow (once SCR-2 wires startScreening in), any HIT above forces the");
console.log("band decision to 'unresolved_to_review' regardless of how well the name matched.");
