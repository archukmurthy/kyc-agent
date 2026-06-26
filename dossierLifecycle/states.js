/**
 * states.js — single source of truth for the dossier lifecycle vocabulary.
 *
 * Pure data: state names, event names, dispute kinds. No logic. CommonJS so
 * api/ (plain Node serverless functions) can require it, mirroring the DRS
 * (documentRequirements.js) precedent.
 *
 * This governs a STATUS FIELD on the dossier record only — never dossier
 * content (raw_research, stakeholders) and never journey_state.
 *
 * Design decisions (confirmed):
 *  C1. `re_researching` and `re_deriving` are kept as DISTINCT states — not
 *      collapsed into a single re-run — to preserve the audit distinction
 *      between "research discarded" (identity-invalidating) and "research kept"
 *      (interpretation-invalidating).
 *  C2. `locked` is reached via JOURNEY_SUBMITTED, which the CALLER passes in.
 *      The machine never reaches into journey_state to detect submission —
 *      dossier/journey separation is preserved.
 *  C3. The machine is RETRY-AGNOSTIC: it permits `failed → researching` on
 *      RETRY and says nothing about retry count or backoff (a caller concern).
 *  C4. `seeded_by` (analyst vs customer self-serve) is DATA ON THE DOSSIER
 *      RECORD, not a lifecycle state. The machine is agnostic to it; the same
 *      draft → researching edge serves both actors.
 */

const STATES = {
  DRAFT: 'draft',                   // four classifiers captured, no research yet
  RESEARCHING: 'researching',       // first-pass research running
  READY: 'ready',                   // dossier built; awaiting / in Confirm
  DISPUTED: 'disputed',             // a core classifier was bounced; awaiting re-seed
  RE_RESEARCHING: 're_researching', // identity-invalidating re-research (research discarded)
  RE_DERIVING: 're_deriving',       // interpretation-invalidating re-derive (research kept)
  FAILED: 'failed',                 // research pipeline errored
  LOCKED: 'locked',                 // journey submitted; frozen. TERMINAL.
};

const EVENTS = {
  START_RESEARCH: 'START_RESEARCH',
  RESEARCH_COMPLETE: 'RESEARCH_COMPLETE',
  RESEARCH_FAILED: 'RESEARCH_FAILED',
  RETRY: 'RETRY',
  CORE_CLASSIFIER_DISPUTED: 'CORE_CLASSIFIER_DISPUTED',
  RESEED_FULL_RESEARCH: 'RESEED_FULL_RESEARCH',
  RESEED_DERIVATIONS_ONLY: 'RESEED_DERIVATIONS_ONLY',
  DERIVE_COMPLETE: 'DERIVE_COMPLETE',
  JOURNEY_SUBMITTED: 'JOURNEY_SUBMITTED',
};

// Dispute kinds carried on a CORE_CLASSIFIER_DISPUTED event. Mirrors the change
// engine's restart vs re_derive split exactly:
//   identity       → different company/entity → discard research (re_researching)
//   interpretation → same company, wrong classifier → keep research (re_deriving)
const DISPUTE_KIND = {
  IDENTITY: 'identity',
  INTERPRETATION: 'interpretation',
};

// The four classifiers that must be present to leave `draft`.
const REQUIRED_CLASSIFIERS = ['country', 'ownershipType', 'corporateVsFi', 'companyName'];

// States with no transitions out.
const TERMINAL_STATES = [STATES.LOCKED];

const STATE_LIST = Object.values(STATES);
const EVENT_LIST = Object.values(EVENTS);
const DISPUTE_KIND_LIST = Object.values(DISPUTE_KIND);

module.exports = {
  STATES,
  EVENTS,
  DISPUTE_KIND,
  REQUIRED_CLASSIFIERS,
  TERMINAL_STATES,
  STATE_LIST,
  EVENT_LIST,
  DISPUTE_KIND_LIST,
};
