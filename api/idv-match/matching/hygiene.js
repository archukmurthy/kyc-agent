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

  return {
    name,
    dob,
    // A required field (name or DOB) missing/unreadable is NOT a match — Phase 5
    // routes these to retry rather than a false Band A.
    notMatchable: name.missing || dob.missing,
    ignoredFields: [...IGNORED_FIELDS],
  };
}

module.exports = { runHygiene, IGNORED_FIELDS };
