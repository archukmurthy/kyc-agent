"use strict";

// Name-equivalence engine (Phase 6). Scores two normalized structured names
// (from Phase 4's `comparable` output) using the versioned rule tables, applies
// the configurable policy thresholds, and records which rule ids + score + policy
// version resolved the case. Pure + deterministic.
const { getPolicy } = require("./policy");
const { RULE_TABLE_VERSION, transliterationRule, phoneticRule, surnameBase, dropParticles, PATRONYMIC } = require("./nameRules");

function round(n) { return Math.round(n * 1000) / 1000; }

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    let cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] : 1 + Math.min(prev[j - 1], prev[j], cur[j - 1]);
    }
    prev = cur;
  }
  return prev[n];
}

function levRatio(a, b) {
  if (!a && !b) return 1;
  const max = Math.max(a.length, b.length);
  return max ? round(1 - levenshtein(a, b) / max) : 0;
}

// Exact / transliteration / phonetic equivalence -> {score, ruleIds}, else null.
function ruleScore(a, b) {
  if (!a || !b) return { score: 0, ruleIds: [] };
  if (a === b) return { score: 1, ruleIds: [] };
  const t = transliterationRule(a, b); if (t) return { score: 0.95, ruleIds: [t] };
  const p = phoneticRule(a, b); if (p) return { score: 0.85, ruleIds: [p] };
  return null;
}

function scoreToken(a, b) {
  return ruleScore(a, b) || { score: levRatio(a, b), ruleIds: [] };
}

// Surname additionally tries patronymic-suffix normalization before fuzzy.
function scoreSurname(a, b) {
  const r = ruleScore(a, b);
  if (r) return r;
  if (a && b && surnameBase(a) === surnameBase(b)) return { score: 0.9, ruleIds: [PATRONYMIC.id] };
  return { score: levRatio(a, b), ruleIds: [] };
}

// chName / docName: { surname, forenames[] } normalized (Phase 4).
function scoreEquivalence(chName, docName) {
  if (!chName || !docName) throw new TypeError("scoreEquivalence requires two structured names");
  const policy = getPolicy();
  const th = policy.thresholds;

  const surname = scoreSurname(chName.surname, docName.surname);

  const chF = dropParticles(chName.forenames);
  const docF = dropParticles(docName.forenames);
  const forename = scoreToken(chF.tokens[0], docF.tokens[0]);
  // A dropped patronymic particle that enabled the forename match is itself the
  // explanation - record the rule.
  if ((chF.dropped || docF.dropped) && forename.score >= 0.85 && !forename.ruleIds.includes(PATRONYMIC.id)) {
    forename.ruleIds = [...forename.ruleIds, PATRONYMIC.id];
  }

  // Surname weighted higher than the first forename.
  const score = round(0.6 * surname.score + 0.4 * forename.score);
  const ruleIds = [...new Set([...surname.ruleIds, ...forename.ruleIds])];
  const ruleExplained = ruleIds.length > 0;

  // A known rule explains the variance at a lower bar than raw fuzzy similarity.
  let outcome;
  if (score >= th.autoResolve || (ruleExplained && score >= th.combinedExplanation)) outcome = "auto_resolve";
  else if (score >= th.skipToReview) outcome = "dialogue";
  else outcome = "review";

  return {
    score, surname, forename, ruleIds, ruleExplained, outcome,
    policyVersion: policy.policyVersion, ruleTableVersion: RULE_TABLE_VERSION, thresholds: th,
  };
}

module.exports = { scoreEquivalence, levRatio };
