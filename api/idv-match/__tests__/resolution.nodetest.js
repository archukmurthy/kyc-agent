const { test } = require("node:test");
const assert = require("node:assert");

const { resolveBandB, handleExplanation } = require("../resolution");
const COPY = require("../copy");

const n = (surname, ...forenames) => ({ surname, forenames });

// --- verbatim copy guards (must match the build instruction exactly) ---
test("applicant-facing copy is verbatim", () => {
  assert.strictEqual(COPY.BAND_A_SUCCESS.title, "Identity verified");
  assert.strictEqual(COPY.BAND_A_SUCCESS.body, "Your identity has been matched to the selected company officer.");
  assert.strictEqual(COPY.IN_REVIEW.title, "We're completing our checks");
  assert.strictEqual(COPY.IN_REVIEW.body, "Your application has been saved. We'll be in touch if we need anything further.");
  assert.strictEqual(COPY.BAND_C.title, "We couldn't confirm your details against the company's registered officers");
  assert.strictEqual(COPY.BAND_C.body, "To continue, please provide a letter of authorization.");
  assert.strictEqual(COPY.DIALOGUE.submitLabel, "Submit explanation");
  assert.strictEqual(COPY.NAME_CHANGE_UPLOAD_PROMPT, "Please upload a document that shows both names, such as a marriage certificate or deed poll");
  assert.strictEqual(COPY.REGISTRY_NOTE, "You may wish to update the company's record at Companies House.");
  assert.deepStrictEqual(COPY.DIALOGUE_OPTIONS.map((o) => o.label), [
    "Same name, different spelling", "I changed my name",
    "The company record is out of date or incorrect", "I selected the wrong person", "I'm not sure",
  ]);
});

// --- 5a machine resolution ---
test("5a: known equivalence auto-resolves (system), doc spelling canonical, CH alias", () => {
  const r = resolveBandB({ officerName: n("khan", "mohammed"), docName: n("khan", "muhammad"), livenessPassed: true });
  assert.strictEqual(r.resolved, true);
  assert.strictEqual(r.outcomeType, "same_person_variation_accepted");
  assert.strictEqual(r.resolvedBy, "system");
  assert.deepStrictEqual(r.canonicalName, n("khan", "muhammad"));
  assert.deepStrictEqual(r.aliasName, n("khan", "mohammed"));
  assert.ok(r.ruleIds.includes("translit-muhammad"));
  assert.deepStrictEqual(r.applicantView, COPY.BAND_A_SUCCESS);
});

// --- 5b disclosure gate ---
test("5b: gate closed (no liveness) -> review, neutral in-review copy, no dialogue", () => {
  const r = resolveBandB({ officerName: n("abd", "xyz"), docName: n("abc", "xyz"), livenessPassed: false });
  assert.strictEqual(r.outcomeType, "unresolved_to_review");
  assert.deepStrictEqual(r.applicantView, COPY.IN_REVIEW);
  assert.ok(!r.dialogue);
});

test("hard exclusion (screening hit) never reaches the applicant", () => {
  const r = resolveBandB({ officerName: n("abd", "xyz"), docName: n("abc", "xyz"), livenessPassed: true, screeningHit: true });
  assert.strictEqual(r.outcomeType, "unresolved_to_review");
  assert.ok(r.reasons.includes("hard_exclusion"));
});

// --- 5c dialogue ---
test("5b passes -> 5c one-round dialogue with names only + Submit explanation", () => {
  const r = resolveBandB({
    officerName: n("abd", "xyz"), docName: n("abc", "xyz"), livenessPassed: true,
    companyDisplayName: "ABD Xyz", documentDisplayName: "ABC Xyz",
  });
  assert.strictEqual(r.dialogue, true);
  assert.strictEqual(r.prompt.title, "Help us confirm your details");
  assert.strictEqual(r.prompt.documentName, "ABC Xyz");
  assert.strictEqual(r.prompt.companyName, "ABD Xyz");
  assert.strictEqual(r.submitLabel, "Submit explanation");
  assert.strictEqual(r.options.length, 5);
});

// --- explanation handlers ---
test("same_spelling: corroborated near-threshold clears (applicant-dialogue); explanation alone never resolves below the bar", () => {
  const cleared = handleExplanation({ category: "same_spelling", officerName: n("abd", "xyz"), docName: n("abc", "xyz") });
  assert.strictEqual(cleared.outcomeType, "same_person_variation_accepted");
  assert.strictEqual(cleared.resolvedBy, "applicant-dialogue");

  const notCleared = handleExplanation({ category: "same_spelling", officerName: n("abcd", "xyz"), docName: n("wxyz", "xyz") });
  assert.strictEqual(notCleared.outcomeType, "unresolved_to_review");
});

test("changed_name: no evidence asks for upload with verbatim prompt", () => {
  const r = handleExplanation({ category: "changed_name", officerName: n("smith", "jane"), docName: n("jones", "jane") });
  assert.strictEqual(r.needsUpload, true);
  assert.strictEqual(r.uploadPrompt, COPY.NAME_CHANGE_UPLOAD_PROMPT);
});

test("changed_name: evidence with BOTH names -> name change evidenced; missing one -> review", () => {
  const both = handleExplanation({
    category: "changed_name", officerName: n("smith", "jane"), docName: n("jones", "jane"),
    evidence: { extractedTokens: ["smith", "jones", "jane"] },
  });
  assert.strictEqual(both.outcomeType, "same_person_name_change_evidenced");
  assert.strictEqual(both.resolvedBy, "applicant-dialogue");

  const missing = handleExplanation({
    category: "changed_name", officerName: n("smith", "jane"), docName: n("jones", "jane"),
    evidence: { extractedTokens: ["jones", "jane"] }, // no "smith"
  });
  assert.strictEqual(missing.outcomeType, "unresolved_to_review");
});

test("registry_incorrect: canonical=document, not blocked, reportability task, gentle note", () => {
  const r = handleExplanation({ category: "registry_incorrect", officerName: n("smith", "jane"), docName: n("smyth", "jane") });
  assert.strictEqual(r.outcomeType, "registry_error_asserted");
  assert.strictEqual(r.blocksApplicant, false);
  assert.strictEqual(r.reportabilityAssessmentTask, true);
  assert.strictEqual(r.applicantView, COPY.REGISTRY_NOTE);
});

test("wrong_person: returns to officer selection, closes attempt", () => {
  const r = handleExplanation({ category: "wrong_person", officerName: n("smith", "jane"), docName: n("jones", "jane") });
  assert.strictEqual(r.action, "reselect_officer");
  assert.strictEqual(r.closeAttempt, true);
});

test("not_sure -> review", () => {
  const r = handleExplanation({ category: "not_sure", officerName: n("smith", "jane"), docName: n("jones", "jane") });
  assert.strictEqual(r.outcomeType, "unresolved_to_review");
});

test("unknown category throws", () => {
  assert.throws(() => handleExplanation({ category: "bogus", officerName: n("a", "b"), docName: n("a", "b") }), /unknown explanation category/);
});
