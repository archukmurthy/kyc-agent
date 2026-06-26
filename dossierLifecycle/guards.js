/**
 * guards.js — pure guard predicates for the dossier lifecycle.
 *
 * Each guard takes the transition `context` and returns { ok, reason }.
 * Guards read context only — they never mutate it, and never inspect the actor
 * (analyst vs customer) — authorization is the caller's concern, not this
 * machine's. Guards validate the TRANSITION, never the actor.
 */

const { DISPUTE_KIND, REQUIRED_CLASSIFIERS } = require('./states');

function isEmpty(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return false;
}

// draft → researching: all four classifiers present and non-empty.
function allClassifiersPresent(context = {}) {
  const classifiers = context.classifiers || {};
  const missing = REQUIRED_CLASSIFIERS.filter((key) => isEmpty(classifiers[key]));
  if (missing.length) {
    return { ok: false, reason: `START_RESEARCH blocked: missing/empty classifier(s): ${missing.join(', ')}.` };
  }
  return { ok: true, reason: null };
}

// ready → disputed: at least one disputed classifier AND a valid dispute kind.
function disputeHasKind(context = {}) {
  const disputed = context.disputedClassifiers;
  if (!Array.isArray(disputed) || disputed.length < 1) {
    return { ok: false, reason: 'CORE_CLASSIFIER_DISPUTED blocked: requires ≥1 disputed classifier.' };
  }
  if (!Object.values(DISPUTE_KIND).includes(context.disputeKind)) {
    return {
      ok: false,
      reason: `CORE_CLASSIFIER_DISPUTED blocked: dispute kind must be one of ${Object.values(DISPUTE_KIND).join('|')} (got ${JSON.stringify(context.disputeKind)}).`,
    };
  }
  return { ok: true, reason: null };
}

// disputed → re_researching: the identity-invalidating fork.
// Permitted when the dispute is marked `identity`, or a corrected company /
// country is supplied (which is itself an identity correction).
function disputeKindIsIdentity(context = {}) {
  if (context.disputeKind === DISPUTE_KIND.IDENTITY) return { ok: true, reason: null };
  if (!isEmpty(context.correctedCompany) || !isEmpty(context.correctedCountry)) {
    return { ok: true, reason: null };
  }
  return {
    ok: false,
    reason: `RESEED_FULL_RESEARCH blocked: requires dispute kind '${DISPUTE_KIND.IDENTITY}' or a corrected company/country (got ${JSON.stringify(context.disputeKind)}).`,
  };
}

// disputed → re_deriving: the interpretation-invalidating fork.
function disputeKindIsInterpretation(context = {}) {
  if (context.disputeKind === DISPUTE_KIND.INTERPRETATION) return { ok: true, reason: null };
  return {
    ok: false,
    reason: `RESEED_DERIVATIONS_ONLY blocked: requires dispute kind '${DISPUTE_KIND.INTERPRETATION}' (got ${JSON.stringify(context.disputeKind)}).`,
  };
}

const GUARDS = {
  allClassifiersPresent,
  disputeHasKind,
  disputeKindIsIdentity,
  disputeKindIsInterpretation,
};

module.exports = {
  GUARDS,
  isEmpty,
  allClassifiersPresent,
  disputeHasKind,
  disputeKindIsIdentity,
  disputeKindIsInterpretation,
};
