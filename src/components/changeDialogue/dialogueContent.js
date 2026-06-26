/**
 * dialogueContent.js — the capture-mode dialogue, as DATA + small pure
 * derivations. No React here, no I/O, no routing decisions.
 *
 * The QUESTIONS do not depend on the (still-unratified) policy rows — they are
 * the same regardless of how the engine eventually routes. The engine owns the
 * OUTCOME; this file owns the wording and the per-field-class question plan.
 *
 * Field-class + verifiability derivation lives here too: the Confirm-page mount
 * passes a raw research row (fieldId/value/source/sourceTier), and the component
 * needs the engine-vocabulary metadata to drive the dialogue. We derive it from
 * the row rather than asking App.js to compute it — that keeps the App.js
 * footprint to a single mount line.
 */

// ── Field-class classifier: fieldId -> engine FIELD_CLASS enum. ──────────────
// Order matters (pep before director, factualId before generic, etc.). Pattern
// matching is intentionally broad; an unmatched field falls to 'generic', whose
// rule is a safe ops-review.
export function classifyFieldClass(fieldId = '') {
  const f = String(fieldId).toLowerCase();
  if (/pep|politically/.test(f)) return 'pep';
  if (/director/.test(f)) return 'director';
  if (/ubo|beneficial|sharehold|owner/.test(f)) return 'ubo';
  if (/address|registered_office|postcode|post_code|street|city|premises/.test(f)) return 'address';
  if (/registration_number|reg_number|\bbrn\b|\bvat\b|tax_id|tax_number|licen[cs]e|incorporation_number|company_number|\blei\b|duns/.test(f))
    return 'factualId';
  if (/entity_type|company_type|legal_form|legal_structure|structure|constitution/.test(f))
    return 'structural';
  return 'generic';
}

// "tier1" | 1 | "1" -> 1 (or null)
function normTier(raw) {
  if (raw == null) return null;
  const m = String(raw).match(/([123])/);
  return m ? Number(m[1]) : null;
}

// ── Verifiability: does this field have structured ground truth to dispute? ──
// An explicit field.verifiability always wins. Otherwise: a document-sourced
// value is 'document', a tier-1 (registry) value is 'structured_registry', and
// everything else is 'unverified'. The engine's verifiability guard then routes
// anything that is not 'structured_registry' to analyst review.
export function deriveVerifiability(field = {}) {
  if (field.verifiability) return field.verifiability;
  const src = String(field.source || '').toLowerCase();
  if (/document|upload|certificate|passport|statement/.test(src)) return 'document';
  if (normTier(field.sourceTier) === 1) return 'structured_registry';
  return 'unverified';
}

// ── Provenance of the presented value, in the event-schema vocabulary. ──
export function deriveSource(field = {}) {
  const tier = normTier(field.sourceTier);
  const src = field.source || null;
  let sourceType = field.sourceType || null;
  if (!sourceType) {
    if (/document|upload/.test(String(src || '').toLowerCase())) sourceType = 'document';
    else if (tier === 1) sourceType = 'registry';
    else if (tier === 2) sourceType = 'website';
    else if (tier === 3) sourceType = 'web';
  }
  return { sourceType, sourceProvider: field.sourceProvider || src || null, sourceTier: tier };
}

// ── The intent question, per field class. Absent classes ask no intent. ──────
// director/ubo: correcting what we found vs telling us about a change.
// structural: a different company vs a misclassification of this one.
// address/factualId/generic: no intent question (see planSteps).
const DIR_UBO_INTENT = {
  prompt: 'Are you correcting information we found, or telling us about a change?',
  options: [
    { label: 'Correcting what you found', value: 'ai_correction' },
    { label: 'Telling you about a change', value: 'genuine_update' },
  ],
};

export const INTENT_QUESTION = {
  director: DIR_UBO_INTENT,
  ubo: DIR_UBO_INTENT,
  structural: {
    prompt: 'Is this a different company, or did we classify this one incorrectly?',
    options: [
      { label: "It's a different company", value: 'different_entity' },
      { label: 'You classified it incorrectly', value: 'ai_correction' },
    ],
  },
};

// ── The registry question. Only asked where a structured registry exists to
// confirm against (director/ubo/address); see planSteps. ──
export const REGISTRY_QUESTION = {
  prompt: 'Has this change already been filed with the official register?',
  options: [
    { label: "Yes, it's filed with the register", value: 'reflected' },
    { label: 'Not yet', value: 'not_reflected' },
    { label: "I'm not sure", value: 'unknown' },
  ],
};

// Field classes for which the registry question is meaningful.
const REGISTRY_CLASSES = ['director', 'ubo', 'address'];

/**
 * planSteps — the ordered list of question keys this field will ask.
 *
 *  - intent:   only classes with an INTENT_QUESTION (director/ubo/structural).
 *  - registry: only director/ubo/address, AND only when the field is a
 *              structured registry source. Per the verifiability guard, a
 *              non-structured source routes to analyst review regardless of the
 *              answer — so there is nothing to confirm against and we skip it.
 *
 * An empty plan (factualId, generic, pep, or a non-structured address) means the
 * dialogue finalises immediately: capture the event, show the neutral notice.
 */
export function planSteps(fieldClass, verifiability) {
  const structuredRegistry = verifiability === 'structured_registry';
  const steps = [];
  if (INTENT_QUESTION[fieldClass]) steps.push('intent');
  if (REGISTRY_CLASSES.includes(fieldClass) && structuredRegistry) steps.push('registry');
  return steps;
}

/**
 * toEngineChangeType — map the captured intent to the engine's CHANGE_TYPE enum
 * (add|remove|correct|update). On the Confirm page a found field being unchecked
 * is a 'changed' value (the final form lands at Fill Gaps), which the caller must
 * split into 'correct' (ai_correction) or 'update' (genuine_update) before the
 * engine sees it — the engine never receives the literal 'changed'.
 *
 * Classes whose rules don't key on changeType (address/generic) get a harmless
 * concrete value; factualId rules accept correct|update identically.
 */
export function toEngineChangeType(fieldClass, intent) {
  if (fieldClass === 'factualId') return 'correct';
  if (fieldClass === 'address') return 'update'; // wildcard in the address rules
  if (fieldClass === 'generic') return 'correct'; // GENERIC matches on class only
  if (fieldClass === 'structural') return 'correct'; // structural rules key on intent
  if (intent === 'genuine_update') return 'update';
  return 'correct'; // ai_correction (or unanswered) -> correct
}

export function questionFor(stepKey, fieldClass) {
  if (stepKey === 'intent') return INTENT_QUESTION[fieldClass] || null;
  if (stepKey === 'registry') return REGISTRY_QUESTION;
  return null;
}
