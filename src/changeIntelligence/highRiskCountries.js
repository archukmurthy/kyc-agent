/**
 * highRiskCountries.js — the injectable high-risk country check (CD-03 EDD).
 *
 * The real list is PENDING from the MLRO. This module is the socket it drops
 * into: the membership check is wired and tested, and it matches NOTHING until
 * a list is injected. No country is hardcoded here, deliberately.
 *
 * DO NOT wire this to documentRequirements.js's RESTRICTED_COUNTRIES. That list
 * ("China, India, Japan, Malaysia, South Africa") is an ONBOARDING-restriction
 * list — where Nium can onboard from — not an AML high-risk list. Treating Japan
 * as AML high-risk would be a compliance error.
 *
 * KNOWN GAP (flagged, not papered over): the values this is asked about come in
 * three different vocabularies —
 *   nationality          is a DEMONYM      ("British")
 *   residential_country  is a country NAME ("United Kingdom")
 *   countryCode          is ISO            ("GB")
 * No demonym→country mapping exists in this codebase. So the MLRO list must
 * either be supplied in all three vocabularies, or a normalisation layer must
 * land before the nationality trigger fires correctly. Matching is done on a
 * case/space-insensitive basis over whatever strings the list contains.
 */

let HIGH_RISK = [];

/** Inject the MLRO list (or a stub in tests). Replaces any previous list. */
function setHighRiskCountries(list = []) {
  HIGH_RISK = (Array.isArray(list) ? list : [])
    .filter((v) => typeof v === "string" && v.trim() !== "")
    .map((v) => v.trim().toLowerCase());
}

function getHighRiskCountries() {
  return [...HIGH_RISK];
}

/** Membership check. Empty list → always false, which is the shipped default. */
function isHighRiskCountry(value) {
  if (!value || typeof value !== "string") return false;
  if (HIGH_RISK.length === 0) return false;
  return HIGH_RISK.includes(value.trim().toLowerCase());
}

/** True when ANY of the CD-03 country-ish person attributes is high risk. */
function personHasHighRiskCountry(person = {}) {
  return (
    isHighRiskCountry(person.nationality) ||
    isHighRiskCountry(person.country_of_birth) ||
    isHighRiskCountry(person.residential_country)
  );
}

module.exports = {
  setHighRiskCountries,
  getHighRiskCountries,
  isHighRiskCountry,
  personHasHighRiskCountry,
};
