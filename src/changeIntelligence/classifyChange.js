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

const { BASE_RULES } = require('./policyTable');
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

function classifyChange(input) {
  const {
    fieldClass,
    changeType,
    intent = null,
    registryStatus = 'unknown',
    verifiability,
    jurisdiction,
  } = input || {};

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
