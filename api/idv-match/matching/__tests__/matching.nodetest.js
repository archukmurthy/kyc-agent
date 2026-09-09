const { test } = require("node:test");
const assert = require("node:assert");

const { normalizeToken, parseOfficerName, buildMrzName } = require("../normalize");
const { compareDob, parseYearMonth } = require("../compareDob");
const { compareNames } = require("../compareName");
const { runHygiene } = require("../hygiene");

const officer = (name, birthMonthYear) => ({ name, birthMonthYear });

// --- normalize ---
test("normalizeToken folds case, diacritics, punctuation, whitespace", () => {
  assert.strictEqual(normalizeToken("  Ámélie   O'CONNOR-Smith "), "amelie o connor smith");
});

test("parseOfficerName splits CH 'SURNAME, Forenames'", () => {
  assert.deepStrictEqual(parseOfficerName("LOVELACE, Ada Augusta"), { surname: "lovelace", forenames: ["ada", "augusta"] });
});

// --- compareDob (month/year only, never the day) ---
test("month/year consistent; the day is never read", () => {
  assert.deepStrictEqual(compareDob("1985-05", "1985-05-24"), { consistent: true, conflict: false, missing: false });
  assert.strictEqual("day" in parseYearMonth("1985-05-24"), false);
  // Different days, same month/year -> still consistent (day never compared).
  assert.strictEqual(compareDob("1985-05", "1985-05-01").consistent, true);
});

test("year or month difference is a conflict", () => {
  assert.strictEqual(compareDob("1985-05", "1986-05").conflict, true);
  assert.strictEqual(compareDob("1985-05", "1985-06").conflict, true);
});

test("CH year-only vs document compares year only", () => {
  assert.strictEqual(compareDob("1985", "1985-06-10").consistent, true);
});

test("missing DOB is neither match nor conflict", () => {
  assert.deepStrictEqual(compareDob("1985-05", null), { consistent: false, conflict: false, missing: true });
  assert.strictEqual(compareDob(null, "1985-05-10").missing, true);
});

// --- compareNames (MRZ-first) ---
test("MRZ agrees with CH but visual differs -> extraction error corrected", () => {
  const r = compareNames({
    chName: parseOfficerName("LOVELACE, Ada"),
    docName: { surname: "lovelace", forenames: ["ade"] },       // visual typo
    mrzName: buildMrzName({ surname: "LOVELACE", given_names: "ADA" }),
  });
  assert.strictEqual(r.exactMatch, true);
  assert.strictEqual(r.extractionErrorCorrected, true);
});

// --- runHygiene scenarios ---
test("exact match", () => {
  const r = runHygiene({ officerSnapshot: officer("LOVELACE, Ada", "1815-12"), identity: { first_name: "Ada", last_name: "Lovelace", date_of_birth: "1815-12-10" } });
  assert.strictEqual(r.name.exactMatch, true);
  assert.strictEqual(r.dob.consistent, true);
  assert.strictEqual(r.notMatchable, false);
});

test("presentation-only differences (diacritics + middle name in one source) still match", () => {
  const r = runHygiene({
    officerSnapshot: officer("MÜLLER, Jörg", "1970-03"),
    identity: { first_name: "Jorg Michael", last_name: "Muller", date_of_birth: "1970-03-22" },
  });
  assert.strictEqual(r.name.exactMatch, true);
  assert.strictEqual(r.dob.consistent, true);
});

test("different surname is substantive (not a match)", () => {
  const r = runHygiene({ officerSnapshot: officer("LOVELACE, Ada", "1815-12"), identity: { first_name: "Ada", last_name: "Byron", date_of_birth: "1815-12-10" } });
  assert.strictEqual(r.name.exactMatch, false);
  assert.strictEqual(r.name.missing, false);
});

test("different spelling of the surname is substantive", () => {
  const r = runHygiene({ officerSnapshot: officer("LOVELACE, Ada", "1815-12"), identity: { first_name: "Ada", last_name: "Lovelaces", date_of_birth: "1815-12-10" } });
  assert.strictEqual(r.name.exactMatch, false);
});

test("month/year conflict surfaces on the dob", () => {
  const r = runHygiene({ officerSnapshot: officer("LOVELACE, Ada", "1815-11"), identity: { first_name: "Ada", last_name: "Lovelace", date_of_birth: "1815-12-10" } });
  assert.strictEqual(r.dob.conflict, true);
  assert.strictEqual(r.dob.consistent, false);
});

test("missing name or DOB makes it not matchable", () => {
  const noName = runHygiene({ officerSnapshot: officer("LOVELACE, Ada", "1815-12"), identity: { first_name: "Ada", date_of_birth: "1815-12-10" } });
  assert.strictEqual(noName.name.missing, true);
  assert.strictEqual(noName.notMatchable, true);

  const noDob = runHygiene({ officerSnapshot: officer("LOVELACE, Ada", "1815-12"), identity: { first_name: "Ada", last_name: "Lovelace" } });
  assert.strictEqual(noDob.dob.missing, true);
  assert.strictEqual(noDob.notMatchable, true);
});

test("address / nationality / gender never affect the comparison", () => {
  const r = runHygiene({
    officerSnapshot: officer("LOVELACE, Ada", "1815-12"),
    identity: { first_name: "Ada", last_name: "Lovelace", date_of_birth: "1815-12-10",
      address: "somewhere else", nationality: "FR", gender: "F" },
  });
  assert.strictEqual(r.name.exactMatch, true);
  assert.strictEqual(r.dob.consistent, true);
  assert.strictEqual(r.notMatchable, false);
  assert.deepStrictEqual(r.ignoredFields, ["address", "nationality", "gender"]);
});
