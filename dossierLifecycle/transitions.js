/**
 * transitions.js — the transition table as DATA.
 *
 * An ordered array of legal edges: { from, event, to, guard }. `guard` is the
 * name of a predicate in guards.js, or null for an unguarded edge.
 *
 * EVERY edge not in this table is illegal — no implicit self-loops, no
 * state-skipping (draft → ready is absent, therefore illegal), and nothing out
 * of `locked` (it has no rows here and is also enforced as terminal).
 *
 * The re_researching vs re_deriving split is preserved deliberately: a
 * redomiciliation that DISCARDS research and a misread classifier that KEEPS it
 * are different operations with different cost and audit meaning. Do not
 * collapse them.
 */

const { STATES, EVENTS } = require('./states');

const TRANSITIONS = [
  { from: STATES.DRAFT, event: EVENTS.START_RESEARCH, to: STATES.RESEARCHING, guard: 'allClassifiersPresent' },

  { from: STATES.RESEARCHING, event: EVENTS.RESEARCH_COMPLETE, to: STATES.READY, guard: null },
  { from: STATES.RESEARCHING, event: EVENTS.RESEARCH_FAILED, to: STATES.FAILED, guard: null },

  { from: STATES.FAILED, event: EVENTS.RETRY, to: STATES.RESEARCHING, guard: null },

  { from: STATES.READY, event: EVENTS.CORE_CLASSIFIER_DISPUTED, to: STATES.DISPUTED, guard: 'disputeHasKind' },

  { from: STATES.DISPUTED, event: EVENTS.RESEED_FULL_RESEARCH, to: STATES.RE_RESEARCHING, guard: 'disputeKindIsIdentity' },
  { from: STATES.DISPUTED, event: EVENTS.RESEED_DERIVATIONS_ONLY, to: STATES.RE_DERIVING, guard: 'disputeKindIsInterpretation' },

  { from: STATES.RE_RESEARCHING, event: EVENTS.RESEARCH_COMPLETE, to: STATES.READY, guard: null },
  { from: STATES.RE_RESEARCHING, event: EVENTS.RESEARCH_FAILED, to: STATES.FAILED, guard: null },

  { from: STATES.RE_DERIVING, event: EVENTS.DERIVE_COMPLETE, to: STATES.READY, guard: null },

  { from: STATES.READY, event: EVENTS.JOURNEY_SUBMITTED, to: STATES.LOCKED, guard: null },
];

module.exports = { TRANSITIONS };
