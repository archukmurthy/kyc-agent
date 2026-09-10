"use strict";

// Comparison hygiene (Phase 4). Combines the pure name/DOB rules into the clean
// comparison that band assignment (Phase 5) consumes, so false alarms never
// reach band logic.
//
// PURE: takes an already-retrieved canonical identity map, NOT the DB row. The
// caller reads the extracted identity from the Vault (by the attempt's
// secure_identity_reference) under authorization and passes the { concept: value }
// map in here. Concepts used: first_name, last_name, date_of_birth, mrz. Address,
// nationality and gender are deliberately NOT read for matching.
const { parseOfficerName, buildDocName, buildMrzName } = require("./normalize");
const { compareNames } = require("./compareName");
const { compareDob } = require("./compareDob");

const IGNORED_FIELDS = Object.freeze(["address", "nationality", "gender"]);

// officerSnapshot: { name: "SURNAME, Forename", birthMonthYear: "YYYY-MM", ... }
// identity: canonical { first_name, last_name, date_of_birth, mrz } from the Vault.
function runHygiene({ officerSnapshot = {}, identity = {} } = {}) {
  const chName = parseOfficerName(officerSnapshot.name);
  const docName = buildDocName({ firstName: identity.first_name, lastName: identity.last_name });
  const mrzName = identity.mrz != null ? buildMrzName(identity.mrz) : null;

  const name = compareNames({ chName, docName, mrzName });
  const dob = compareDob(officerSnapshot.birthMonthYear, identity.date_of_birth);

  // "Not matchable" means the APPLICANT'S OWN DOCUMENT is unreadable (their name
  // or DOB couldn't be read) — that's the retry case. A missing OFFICER DOB is a
  // Companies House data gap (CH doesn't always expose it), NOT an unreadable
  // document, so it must NOT force a retry — the comparison proceeds on the name.
  const documentNameReadable = !!(mrzName || (identity.first_name && identity.last_name));
  const documentDobReadable = !!(identity.date_of_birth && String(identity.date_of_birth).trim());

  return {
    name,
    dob,
    notMatchable: !documentNameReadable || !documentDobReadable,
    ignoredFields: [...IGNORED_FIELDS],
  };
}

module.exports = { runHygiene, IGNORED_FIELDS };
