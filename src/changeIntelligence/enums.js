/**
 * enums.js — shared string enums for the Change Classification Engine.
 *
 * These are the closed vocabularies the engine matches against. They are data,
 * not logic. Keep them in sync with the policy table and the upstream caller
 * (the Confirm-page intent dialogue — out of scope for this slice).
 *
 * CommonJS (the src/pipeline.js precedent): requireable by api/ Node functions
 * AND importable by webpack/babel-jest consumers (`import { FIELD_CLASS }`
 * resolves via CJS↔ESM interop), while staying inside src/ so CRA's
 * ModuleScopePlugin permits the React consumer (ChangeDialogue) to import it.
 */

// Field classes a change can belong to. Drives which branch of the engine runs.
const FIELD_CLASS = ['director', 'ubo', 'address', 'factualId', 'pep', 'structural', 'generic'];

// Change types AS PASSED TO classifyChange. Note: deriveChangeType produces
// 'add' | 'remove' | 'changed'; the caller splits 'changed' into 'correct'
// (intent ai_correction) or 'update' (intent genuine_update) before calling
// the engine. So the engine never sees the literal 'changed'.
const CHANGE_TYPE = ['add', 'remove', 'correct', 'update'];

// Customer's dialogue answer (or null when no dialogue / unanswered).
// 'different_entity' is added per spec and is STRUCTURAL-ONLY: it is the signal
// that splits a structural change into restart (different company) vs re_derive
// (same company, wrong classification → intent 'ai_correction').
const INTENT = ['ai_correction', 'genuine_update', 'different_entity', null];

// Customer's claim about whether the official registry already reflects the change.
const REGISTRY_STATUS = ['reflected', 'not_reflected', 'unknown'];

// Property of the field's SOURCE — whether there is structured ground truth to
// dispute against. Only 'structured_registry' may take a snapshot-compare path.
const VERIFIABILITY = ['structured_registry', 'document', 'unverified'];

// Possible workflow outcomes.
const WORKFLOW = [
  'accept_silent', 'ops_review', 'doc_required', 'escalation', 'edd',
  'analyst_review', 'restart', 're_derive', 'UNDECIDED',
];

// Marker for "no policy decision exists for this combination". The engine
// surfaces this as workflow: 'UNDECIDED' + decided: false rather than guessing
// a safe-looking default. Exported for consumers that prefer the symbol.
const UNDECIDED = Symbol('UNDECIDED');

module.exports = {
  FIELD_CLASS,
  CHANGE_TYPE,
  INTENT,
  REGISTRY_STATUS,
  VERIFIABILITY,
  WORKFLOW,
  UNDECIDED,
};
