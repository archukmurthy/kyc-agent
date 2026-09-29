"use strict";

// Name comparison with MRZ-first rule (Phase 4). Operates on already-structured,
// normalized names ({ surname, forenames[] }).
const { structuredNamesEqual, nameReadable } = require("./normalize");

// chName / docName / mrzName: { surname, forenames[] } or null.
// -> { exactMatch, extractionErrorCorrected, comparable, missing }.
//
// MRZ-first: when an MRZ name is present it is THE document name (checksummed,
// more reliable than visually-extracted text).
//   exactMatch                = CH equals the primary document name (MRZ if present, else visual)
//   extractionErrorCorrected  = MRZ present, MRZ matches CH, but the visual name does not
//   comparable                = the document name to feed the Phase 6 engine when not an exact match
//   missing                   = CH or the document name is unreadable/absent
function compareNames({ chName, docName, mrzName } = {}) {
  const primary = nameReadable(mrzName) ? mrzName : (nameReadable(docName) ? docName : null);
  if (!nameReadable(chName) || !primary) {
    return { exactMatch: false, extractionErrorCorrected: false, comparable: primary || null, missing: true };
  }
  const exactMatch = structuredNamesEqual(chName, primary);
  const extractionErrorCorrected =
    nameReadable(mrzName) && structuredNamesEqual(chName, mrzName) && !structuredNamesEqual(chName, docName);
  return { exactMatch, extractionErrorCorrected, comparable: primary, missing: false };
}

module.exports = { compareNames };
