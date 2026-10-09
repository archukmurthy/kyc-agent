"use strict";

// DOB comparison, month/year ONLY (Phase 4). Companies House gives an officer's
// month + year; a passport gives a full date. We compare month + year and NEVER
// read or compare the day - "May 1985" vs "24 May 1985" is consistent.

// Parse a year/month from either "YYYY-MM-DD", "YYYY-MM", or "YYYY". The day is
// never extracted. Returns { year, month|null } or null.
function parseYearMonth(value) {
  const m = String(value == null ? "" : value).match(/^(\d{4})(?:-(\d{2}))?/);
  if (!m) return null;
  return { year: Number(m[1]), month: m[2] != null ? Number(m[2]) : null };
}

// chMonthYear: CH "YYYY-MM" (or "YYYY"); documentDobIso: full ISO date.
// -> { consistent, conflict, missing }. Missing (not a match, not a conflict)
// when either side lacks a year, or the document DOB is absent.
function compareDob(chMonthYear, documentDobIso) {
  const ch = parseYearMonth(chMonthYear);
  const doc = parseYearMonth(documentDobIso);
  if (!ch || !doc || ch.year == null || doc.year == null) {
    return { consistent: false, conflict: false, missing: true };
  }
  if (ch.year !== doc.year) return { consistent: false, conflict: true, missing: false };
  // Years match. Compare months only when BOTH sides carry one.
  if (ch.month != null && doc.month != null && ch.month !== doc.month) {
    return { consistent: false, conflict: true, missing: false };
  }
  return { consistent: true, conflict: false, missing: false };
}

module.exports = { compareDob, parseYearMonth };
