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

// ── Company-level country fields (commit 8) ─────────────────────────────────
// Same list, same membership test as the person path above — isHighRiskCountry
// is the one check both call. This section only widens WHICH fields are asked;
// it introduces no second mechanism and no new rule.

/**
 * Is this a country-typed field?
 *
 * LIMITATION, flagged rather than papered over: schema field defs are
 * `{ field, label, tier, section }` (+ `inputType` on gap fields) and carry NO
 * marker for "this value is a country". Detection is therefore by id/label
 * token. That buys the property commit 8 asked for — a schema that adds a new
 * country field is covered without touching this code — but it is a heuristic
 * over naming, not a declared type. The proper fix is a country type on the
 * field def; until then, a country field named without the word "country"
 * (e.g. "jurisdictionOfIncorporation") would be missed.
 */
const COUNTRY_TOKEN = /countr(y|ies)/i;
/**
 * "Mobile Country Code" / applicantMobileCountryCode is a DIALLING code, not a
 * country. Without this exclusion a dialling-code string that happened to
 * appear in the MLRO list would flag EDD on every applicant who used it.
 */
const NOT_A_COUNTRY = /countr(y|ies)\s*code|countrycode/i;

function isCountryField(field = {}) {
  const id = typeof field === "string" ? field : field.fieldId || field.field || "";
  const label = (field && typeof field === "object" && field.label) || "";
  const hay = `${id} ${label}`;
  if (NOT_A_COUNTRY.test(hay)) return false;
  return COUNTRY_TOKEN.test(hay);
}

/**
 * Split a field value into candidate country tokens. Country fields are not
 * all scalar — "Countries of Operation" arrives as "UK, US, SG" or an array —
 * so a single-value check would miss every country but the first.
 * Structured/object values (uboAnalysis and friends) are not country lists and
 * yield nothing rather than a stringified guess.
 */
function countryValues(value) {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.reduce((acc, v) => acc.concat(countryValues(v)), []);
  if (typeof value === "object") return [];
  return String(value)
    .split(/[,;/|]|\band\b/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** True when any country token in `value` is on the list. */
function containsHighRiskCountry(value) {
  return countryValues(value).some(isHighRiskCountry);
}

/**
 * Company-level entry point: a country-typed field carrying a high-risk value.
 * `value` defaults to the field's own value so a found row can be tested as-is;
 * pass it explicitly to test a corrected value before it lands on the field.
 *
 * Person attributes never reach here: they are classified through the
 * person-scoped path under composite fieldIds (`<type>::<sh_id>::<attribute>`),
 * which carry no "country" token, so there is no double-flagging by
 * construction — asserted in the tests.
 */
function fieldHasHighRiskCountry(field = {}, value) {
  if (!isCountryField(field)) return false;
  return containsHighRiskCountry(value === undefined ? field && field.value : value);
}

module.exports = {
  setHighRiskCountries,
  getHighRiskCountries,
  isHighRiskCountry,
  personHasHighRiskCountry,
  isCountryField,
  countryValues,
  containsHighRiskCountry,
  fieldHasHighRiskCountry,
};
