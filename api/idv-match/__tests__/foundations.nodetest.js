const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");

const { bandsEnabled } = require("../config");
const { getPolicy, POLICY_VERSION } = require("../policy");
const { buildOfficerSnapshot, monthYearOnly } = require("../officerSnapshot");

// --- feature flag ---
const realFlag = process.env.IDV_DISCREPANCY_BANDS_ENABLED;
afterEach(() => {
  if (realFlag === undefined) delete process.env.IDV_DISCREPANCY_BANDS_ENABLED;
  else process.env.IDV_DISCREPANCY_BANDS_ENABLED = realFlag;
});

test("bandsEnabled defaults OFF and only turns on for truthy flag values", () => {
  delete process.env.IDV_DISCREPANCY_BANDS_ENABLED;
  assert.strictEqual(bandsEnabled(), false);
  for (const on of ["1", "true", "TRUE", "yes", "on"]) {
    process.env.IDV_DISCREPANCY_BANDS_ENABLED = on;
    assert.strictEqual(bandsEnabled(), true, `expected ON for ${on}`);
  }
  for (const off of ["0", "false", "", "no", "off"]) {
    process.env.IDV_DISCREPANCY_BANDS_ENABLED = off;
    assert.strictEqual(bandsEnabled(), false, `expected OFF for '${off}'`);
  }
});

// --- policy ---
test("getPolicy returns a versioned policy with tunable thresholds", () => {
  const p = getPolicy();
  assert.strictEqual(p.policyVersion, POLICY_VERSION);
  assert.strictEqual(typeof p.thresholds.autoResolve, "number");
  assert.strictEqual(typeof p.thresholds.skipToReview, "number");
  assert.strictEqual(typeof p.thresholds.combinedExplanation, "number");
  assert.deepStrictEqual(p.ruleTables, {});
});

// --- officer snapshot ---
test("monthYearOnly keeps month+year and never a day", () => {
  assert.strictEqual(monthYearOnly("1985-05-24"), "1985-05"); // full date -> day dropped
  assert.strictEqual(monthYearOnly("1985-05"), "1985-05");
  assert.strictEqual(monthYearOnly("1985"), "1985");
  assert.strictEqual(monthYearOnly(null), "");
});

test("buildOfficerSnapshot freezes the officer with month/year birth + officer id", () => {
  const snap = buildOfficerSnapshot(
    { name: "Ada Lovelace", role: "Director", dob: "1985-05-24", officerId: "abc123" },
    { retrievedAt: "2026-09-08T00:00:00.000Z" }
  );
  assert.deepStrictEqual(snap, {
    name: "Ada Lovelace",
    birthMonthYear: "1985-05",
    role: "Director",
    officerId: "abc123",
    retrievedAt: "2026-09-08T00:00:00.000Z",
  });
});

test("buildOfficerSnapshot returns null for no candidate and tolerates missing officer id", () => {
  assert.strictEqual(buildOfficerSnapshot(null), null);
  const snap = buildOfficerSnapshot({ name: "No Id", role: "UBO", dob: "1990" }, { retrievedAt: "x" });
  assert.strictEqual(snap.officerId, null);
  assert.strictEqual(snap.birthMonthYear, "1990");
});
