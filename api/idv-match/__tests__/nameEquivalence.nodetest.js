const { test } = require("node:test");
const assert = require("node:assert");

const { soundex } = require("../nameRules");
const { scoreEquivalence, levRatio } = require("../nameEquivalence");

const n = (surname, ...forenames) => ({ surname, forenames });

test("transliteration variance auto-resolves and records the rule id", () => {
  const r = scoreEquivalence(n("khan", "mohammed"), n("khan", "muhammad"));
  assert.strictEqual(r.outcome, "auto_resolve");
  assert.ok(r.ruleIds.includes("translit-muhammad"));
  assert.ok(r.ruleExplained);
  assert.ok(r.policyVersion && r.ruleTableVersion);
});

test("phonetic variance auto-resolves via soundex rule", () => {
  assert.strictEqual(soundex("smith"), soundex("smyth"));
  const r = scoreEquivalence(n("smith", "john"), n("smyth", "john"));
  assert.strictEqual(r.outcome, "auto_resolve");
  assert.ok(r.ruleIds.includes("phonetic-soundex"));
});

test("patronymic surname suffix normalizes (Jón / Jónsson)", () => {
  const r = scoreEquivalence(n("jon", "ada"), n("jonsson", "ada"));
  assert.ok(r.ruleIds.includes("patronymic-normalize"));
  assert.strictEqual(r.outcome, "auto_resolve");
});

test("patronymic particle is dropped from forenames and recorded", () => {
  const r = scoreEquivalence(n("saud", "bin", "ahmad"), n("saud", "ahmad"));
  assert.ok(r.ruleIds.includes("patronymic-normalize"));
  assert.strictEqual(r.score, 1);
});

test("moderate fuzzy similarity with no rule -> dialogue (1-round)", () => {
  const r = scoreEquivalence(n("abc", "xyz"), n("abd", "xyz"));
  assert.strictEqual(r.outcome, "dialogue");
  assert.deepStrictEqual(r.ruleIds, []);
  assert.ok(r.score >= r.thresholds.skipToReview && r.score < r.thresholds.autoResolve);
});

test("substantive difference -> review", () => {
  const r = scoreEquivalence(n("abc", "abc"), n("xyz", "abd"));
  assert.strictEqual(r.outcome, "review");
  assert.ok(r.score < r.thresholds.skipToReview);
});

test("a rule explains variance at a lower bar than raw fuzzy (combinedExplanation)", () => {
  // Same surname (1.0), transliteration forename (0.95) -> 0.98 >= autoResolve;
  // but even a phonetic-only surname path stays rule-explained.
  const r = scoreEquivalence(n("smith", "sergei"), n("smyth", "sergey"));
  assert.ok(r.ruleExplained);
  assert.strictEqual(r.outcome, "auto_resolve");
  assert.ok(r.ruleIds.includes("phonetic-soundex") && r.ruleIds.includes("translit-sergei"));
});

test("levRatio is symmetric and bounded", () => {
  assert.strictEqual(levRatio("abc", "abc"), 1);
  assert.strictEqual(levRatio("abc", "xyz"), 0);
  assert.strictEqual(levRatio("abc", "abd"), levRatio("abd", "abc"));
});

test("throws without two names", () => {
  assert.throws(() => scoreEquivalence(null, n("x", "y")), /two structured names/);
});
