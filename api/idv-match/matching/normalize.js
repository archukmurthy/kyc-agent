"use strict";

// Presentation normalization for name comparison (Phase 4). Pure, deterministic.
// Case, diacritics, punctuation, whitespace, and name order are presentation
// differences and are normalized away; different spellings / missing surname
// components / different surnames are substantive and survive normalization.

function normalizeToken(str) {
  return String(str == null ? "" : str)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip combining diacritical marks
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")    // punctuation -> space
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(str) {
  const n = normalizeToken(str);
  return n ? n.split(" ") : [];
}

// CH officer names are "SURNAME, Forename Middle". Split on the first comma:
// before = surname, after = forenames. No comma -> treat all as forenames
// (surname unknown / unreadable).
function parseOfficerName(chName) {
  const raw = String(chName == null ? "" : chName);
  const comma = raw.indexOf(",");
  if (comma === -1) return { surname: "", forenames: tokens(raw) };
  return { surname: normalizeToken(raw.slice(0, comma)), forenames: tokens(raw.slice(comma + 1)) };
}

function buildDocName({ firstName, lastName } = {}) {
  return { surname: normalizeToken(lastName), forenames: tokens(firstName) };
}

// Build a name from a passport MRZ object. MRZ field names vary by provider, so
// accept the common surname / given-name keys.
function buildMrzName(mrz) {
  if (!mrz) return null;
  if (typeof mrz === "string") {
    // "SURNAME<<GIVEN<NAMES" TD3 style, or plain text.
    const parts = mrz.split(/<+|\s+/).filter(Boolean);
    if (!parts.length) return null;
    return { surname: normalizeToken(parts[0]), forenames: parts.slice(1).map(normalizeToken).filter(Boolean) };
  }
  const surname = mrz.surname != null ? mrz.surname : (mrz.last_name != null ? mrz.last_name : mrz.primary_identifier);
  const given = mrz.given_names != null ? mrz.given_names
    : (mrz.first_name != null ? mrz.first_name : mrz.secondary_identifier);
  return { surname: normalizeToken(surname), forenames: tokens(given) };
}

// Two structured names match when the surname and first forename are equal after
// normalization. A middle name present in only one source is NOT substantive
// (extra forenames beyond the first are ignored); a missing/empty surname or
// first forename on either side means the pair is not comparable.
function structuredNamesEqual(a, b) {
  if (!a || !b) return false;
  if (!a.surname || !b.surname) return false;
  if (!a.forenames.length || !b.forenames.length) return false;
  return a.surname === b.surname && a.forenames[0] === b.forenames[0];
}

function nameReadable(name) {
  return !!(name && name.surname && name.forenames && name.forenames.length);
}

module.exports = { normalizeToken, parseOfficerName, buildDocName, buildMrzName, structuredNamesEqual, nameReadable };
