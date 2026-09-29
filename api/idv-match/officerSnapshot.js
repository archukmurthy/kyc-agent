"use strict";

// Companies House exposes only MONTH and YEAR of birth for officers. Keep birth
// as "YYYY-MM" (or "YYYY" when the month is absent). NEVER carry or invent a day.
function monthYearOnly(value) {
  const m = String(value == null ? "" : value).match(/^(\d{4})(?:-(\d{2}))?/);
  if (!m) return "";
  return m[2] ? `${m[1]}-${m[2]}` : m[1];
}

// Freeze the selected officer's Companies House record at the moment of selection.
// This snapshot is stored on the attempt and is what we later compare against —
// it must never be re-fetched. Birth is month/year only.
function buildOfficerSnapshot(candidate, opts = {}) {
  if (!candidate) return null;
  const dob = candidate.dob || candidate.date_of_birth || candidate.birthMonthYear || "";
  return {
    name: candidate.name || candidate.full_name || "",
    birthMonthYear: monthYearOnly(dob),
    role: candidate.role || candidate.jobTitle || candidate.officer_role || "",
    officerId: candidate.officerId || candidate.officer_id || null,
    retrievedAt: opts.retrievedAt || new Date().toISOString(),
  };
}

// Auto-match: freeze the WHOLE candidate-officer list on the attempt, so resolve
// can pick the one the document belongs to without the applicant selecting from a
// dropdown. Same per-officer snapshot rules (month/year birth only, no re-fetch).
function buildAutoMatchSnapshot(candidates, opts = {}) {
  const list = (candidates || []).map((c) => buildOfficerSnapshot(c, opts)).filter(Boolean);
  return { mode: "auto_match", candidates: list };
}

module.exports = { buildOfficerSnapshot, buildAutoMatchSnapshot, monthYearOnly };
