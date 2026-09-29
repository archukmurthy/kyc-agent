"use strict";

// Pure interpretation of a ComplyCube screening check into the signal the band
// logic needs. ComplyCube grades outcomes as "clear" | "attention" |
// "not_processed"; "attention" is a potential match (a HIT). "not_processed"
// means a category/list was NOT screened — it is never treated as clear.
// Categories come from result.breakdown.summary.

function anyAttention(summarySection) {
  return !!summarySection && Object.values(summarySection).some((v) => v === "attention");
}

function interpretCheck(check) {
  const status = (check && check.status) || "unknown";
  const result = (check && check.result) || {};
  const breakdown = result.breakdown || {};
  const summary = breakdown.summary || {};
  const matches = Array.isArray(breakdown.matches) ? breakdown.matches : [];

  const outcome = result.outcome || null;

  return {
    status,
    outcome,
    hit: outcome === "attention",
    notProcessed: outcome === "not_processed",
    categories: {
      watchlist: anyAttention(summary.watchlist), // sanctions / terror / war-crimes / etc.
      pep: anyAttention(summary.pep),
      adverseMedia: anyAttention(summary.adverseMedia),
      other: anyAttention(summary.otherLists),
    },
    matchCount: matches.length,
  };
}

module.exports = { interpretCheck };
