/**
 * classifyChange.js — the Change Classification Engine.
 *
 * Pure, deterministic. No DB, no network, no LLM, no React. Same shape as the
 * Document Requirements Service: one change diff in, one workflow outcome out.
 *
 * Order of operations (the hard rules run BEFORE the policy table and
 * short-circuit it; see the spec):
 *   1. PEP override     — any pep-field change → silent escalation.
 *   2. Verifiability     — non-structural fields without a structured registry
 *      guard               source have no ground truth to compare against →
 *                          accept silently + analyst review.
 *   3. Policy table      — first matching rule wins (jurisdiction overrides
 *                          spliced ahead of base rows).
 *   4. No fallthrough    — unmatched → UNDECIDED, decided: false. Never guess.
 */

const { BASE_RULES, PERSON_RULES } = require('./policyTable');
const { JURISDICTION_OVERRIDES } = require('./policyTable.jurisdictions');

// The full result shape. Every path returns this superset of the contract.
// eddFlag defaults false and NO RULE sets it: EDD triggering conditions were
// never specified for the rule tables (open question O2), and it is deliberately
// not defaulted "true somewhere" — the UNDECIDED-ness of EDD is surfaced by the
// sweep. The one thing that raises it is the CD-03 high-risk-country post-step
// at the bottom of this file, driven by the caller's injectable list.
const DEFAULT_RESULT = {
  workflow: 'UNDECIDED',
  docType: null,
  eddFlag: false,
  escalation: false,
  escalationReason: null,
  decided: false,
  matchedRule: null,
  // Extensions to the contract, required by the design:
  silent: false,          // customer sees nothing (accept_silent / PEP / generic)
  docSetMayChange: false, // structural re_derive hint for the DRS
};

function ruleMatches(when, input) {
  return Object.keys(when).every((field) => when[field] === input[field]);
}

/**
 * PERSON-SCOPED classification (CD-03, ratified 26 Jul 2026).
 *
 * Runs the PERSON_RULES table, then applies CD-03's EDD post-step. Same matcher,
 * same result shape — an extension of this engine, not a second one.
 *
 * WHY THIS RUNS BEFORE THE TWO HARD RULES (deliberate, and the one judgement
 * call in commit 6 — flagged for compliance sign-off):
 *
 *  - The VERIFIABILITY GUARD exists because a company research field has
 *    registry ground truth to dispute against; without it there is no honest
 *    comparison, so the change is accepted silently for an analyst. A person's
 *    self-declared nationality, DOB or residential address has no registry
 *    ground truth BY DESIGN — that absence is precisely why CD-03 asks for
 *    POI/POA. Letting the guard run first would suppress every person document
 *    CD-03 requires, since these attributes are rarely registry-sourced.
 *
 *  - The PEP HARD RULE governs the COMPANY-level "PEP status of directors"
 *    research field: a silent escalation, never revealed. CD-03's PEP rule is a
 *    different event — the customer ADDING a person-scoped PEP declaration —
 *    and ratifies a Source of Wealth request plus an EDD flag. Scoping CD-03's
 *    rule to person changes leaves the company-level hard rule untouched.
 *
 * Company-level classification is byte-identical: `personScope` is absent for
 * every company field, so this branch is unreachable from those call sites.
 */
function classifyPersonChange(input) {
  const {
    personType = null,
    attribute = null,
    nameCase = null,
    pepValue = null,
    thresholdCrossing = null,
  } = input || {};

  const normalized = {
    personScope: true,
    personType,
    attribute,
    nameCase,
    pepValue,
    thresholdCrossing,
  };

  for (const rule of PERSON_RULES) {
    if (ruleMatches(rule.when, normalized)) {
      return { ...DEFAULT_RESULT, decided: true, matchedRule: rule.id, ...rule.then };
    }
  }

  // The CD-03 EDD post-step used to live here. It now runs once at the single
  // exit of classifyChange, so person and company country fields share ONE
  // mechanism — see the comment there.
  return { ...DEFAULT_RESULT };
}

function classifyChangeCore(input) {
  const {
    fieldClass,
    changeType,
    intent = null,
    registryStatus = 'unknown',
    verifiability,
    jurisdiction,
  } = input || {};

  // ── Person-scoped changes (CD-03) take their own rule table. See the header
  //    on classifyPersonChange for why this precedes the two hard rules. ──
  if (input && input.personScope === true) return classifyPersonChange(input);

  // ── Hard rule 2 (PEP override) — before everything, no doc, no dialogue. ──
  if (fieldClass === 'pep') {
    return {
      ...DEFAULT_RESULT,
      workflow: 'escalation',
      escalation: true,
      escalationReason:
        'PEP field changed — silent escalation regardless of direction, intent, registry status or verifiability.',
      silent: true,
      decided: true,
      matchedRule: 'PEP-SHORTCIRCUIT',
    };
  }

  // ── Hard rule 1 (verifiability guard) — before the policy table. ──
  // Only structural fields are exempt: their outcome is intent-driven, not a
  // registry snapshot compare. Every other field class whose source is not a
  // structured registry has no ground truth to dispute → accept silently and
  // hand to the analyst (honest degradation, not a false compare).
  if (fieldClass !== 'structural' && verifiability !== 'structured_registry') {
    return {
      ...DEFAULT_RESULT,
      workflow: 'analyst_review',
      silent: true, // accept_silent: the change is accepted, customer sees nothing
      decided: true,
      matchedRule: 'VERIFIABILITY-GUARD',
    };
  }

  // ── Hard rule 3 (policy table) — jurisdiction overrides win over base rows. ──
  const overrides = (jurisdiction && JURISDICTION_OVERRIDES[jurisdiction]) || [];
  const rules = [...overrides, ...BASE_RULES];
  const normalized = { fieldClass, changeType, intent, registryStatus, verifiability, jurisdiction };

  for (const rule of rules) {
    if (ruleMatches(rule.when, normalized)) {
      return {
        ...DEFAULT_RESULT,
        decided: true,
        matchedRule: rule.id,
        ...rule.then,
      };
    }
  }

  // ── Hard rule 4 (no default fallthrough) — surface the hole, do not guess. ──
  return { ...DEFAULT_RESULT };
}

/**
 * The engine's single entry point, and the single place the CD-03 high-risk
 * country EDD flag is applied.
 *
 * It runs AFTER classification, on every exit path — person rules (commit 6),
 * company policy table, the PEP short-circuit, the verifiability guard and the
 * UNDECIDED fallthrough alike. That placement is the point: a high-risk country
 * sets the flag EITHER WAY, independently of whether the change produced a
 * document, and person-level (commit 6) and company-level (commit 8) country
 * fields therefore go through ONE mechanism rather than two parallel ones.
 *
 * Flag only — no document, no EDD collection flow (CD-03). The caller decides
 * WHICH fields are country-typed and whether their value is on the list
 * (highRiskCountries.js); the engine only records the consequence. The list is
 * injectable and empty until the MLRO supplies it, so this never fires by
 * default.
 *
 * OPEN COMPLIANCE QUESTION raised by widening to company fields, deliberately
 * not decided in code: does a high-risk country of OPERATION carry the same
 * weight as a high-risk NATIONALITY? Today both set the same undifferentiated
 * flag. If they should differ, that is a CD-03-round decision, not a code one.
 */
function classifyChange(input) {
  const result = classifyChangeCore(input);
  if (input && input.highRiskCountry === true) return { ...result, eddFlag: true };
  return result;
}

module.exports = { classifyChange };
