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
// eddFlag is ALWAYS false: no rule fires EDD because EDD triggering conditions
// were never specified (open question O2). It is deliberately not defaulted
// "true somewhere" — the UNDECIDED-ness of EDD is surfaced by the sweep.
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
    highRiskCountry = false,
  } = input || {};

  const normalized = {
    personScope: true,
    personType,
    attribute,
    nameCase,
    pepValue,
    thresholdCrossing,
  };

  let result = { ...DEFAULT_RESULT };
  for (const rule of PERSON_RULES) {
    if (ruleMatches(rule.when, normalized)) {
      result = { ...DEFAULT_RESULT, decided: true, matchedRule: rule.id, ...rule.then };
      break;
    }
  }

  // CD-03 EDD post-step: a high-risk nationality / country of birth / country
  // of residence sets the flag EITHER WAY — independently of whether the
  // attribute produced a document. Flag only; there is no EDD collection flow.
  // The list is injectable and empty until the MLRO supplies it, so this never
  // fires by default (see highRiskCountries.js).
  if (highRiskCountry === true) result.eddFlag = true;

  return result;
}

function classifyChange(input) {
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

module.exports = { classifyChange };
