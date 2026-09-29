const { test } = require("node:test");
const assert = require("node:assert");

const { assignBand } = require("../bandAssignment");

// Hygiene shape from Phase 4 runHygiene.
const hygiene = ({ exact = false, corrected = false, comparable = { surname: "x", forenames: ["y"] }, nameMissing = false,
  consistent = false, conflict = false, dobMissing = false } = {}) => ({
  name: { exactMatch: exact, extractionErrorCorrected: corrected, comparable, missing: nameMissing },
  dob: { consistent, conflict, missing: dobMissing },
  notMatchable: nameMissing || dobMissing,
  ignoredFields: ["address", "nationality", "gender"],
});

test("exact match + consistent DOB, clean -> Band A auto_match", () => {
  const r = assignBand({ hygiene: hygiene({ exact: true, consistent: true }) });
  assert.strictEqual(r.band, "A");
  assert.strictEqual(r.outcomeType, "auto_match");
  assert.strictEqual(r.resolvedBy, "system");
  assert.ok(r.policyVersion);
});

test("MRZ-corrected visual -> Band A extraction_error_corrected", () => {
  const r = assignBand({ hygiene: hygiene({ exact: true, corrected: true, consistent: true }) });
  assert.strictEqual(r.band, "A");
  assert.strictEqual(r.outcomeType, "extraction_error_corrected");
});

test("name score never beats a DOB conflict -> Band C (LOA + escalation)", () => {
  const r = assignBand({ hygiene: hygiene({ exact: true, conflict: true }) });
  assert.strictEqual(r.band, "C");
  assert.strictEqual(r.outcomeType, "demoted_to_loa_path");
  assert.strictEqual(r.escalate, true);
  assert.ok(r.reasons.includes("dob_conflict"));
});

test("missing/unreadable required data is never a match -> retry, no band", () => {
  const r = assignBand({ hygiene: hygiene({ exact: true, dobMissing: true }) });
  assert.strictEqual(r.needsRetry, true);
  assert.strictEqual(r.band, null);
  assert.strictEqual(r.outcomeType, null);
});

test("screening hit forces review even on a clean identity match", () => {
  const r = assignBand({ hygiene: hygiene({ exact: true, consistent: true }), screeningHit: true });
  assert.strictEqual(r.requiresReview, true);
  assert.strictEqual(r.outcomeType, "unresolved_to_review");
  assert.strictEqual(r.resolvedBy, "reviewer");
  assert.ok(r.reasons.includes("screening_hit"));
});

test("prior escalation flag forces review + escalate", () => {
  const r = assignBand({ hygiene: hygiene({ exact: true, consistent: true }), escalationFlag: true });
  assert.strictEqual(r.requiresReview, true);
  assert.strictEqual(r.escalate, true);
  assert.ok(r.reasons.includes("escalation_flag"));
});

test("name variance + consistent DOB -> Band B for resolution (no terminal outcome)", () => {
  const r = assignBand({ hygiene: hygiene({ exact: false, consistent: true }) });
  assert.strictEqual(r.band, "B");
  assert.strictEqual(r.requiresResolution, true);
  assert.strictEqual(r.outcomeType, null);
  assert.ok(r.reasons.includes("name_variance"));
});

test("a DOB conflict outranks a screening hit but still escalates", () => {
  const r = assignBand({ hygiene: hygiene({ exact: true, conflict: true }), screeningHit: true });
  assert.strictEqual(r.band, "C");
  assert.strictEqual(r.escalate, true);
  assert.ok(r.reasons.includes("screening_hit"));
  assert.ok(r.reasons.includes("dob_conflict"));
});

test("throws without hygiene", () => {
  assert.throws(() => assignBand({}), /requires Phase 4 hygiene/);
});
