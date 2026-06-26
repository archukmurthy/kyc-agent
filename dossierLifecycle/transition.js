/**
 * transition.js — the dossier lifecycle state machine (main export).
 *
 * transition(currentState, event, context) → { nextState, valid, reason }
 *
 * Pure and synchronous: same inputs → same output, no I/O, no side effects, no
 * mutation of any argument. It answers exactly one question: given where the
 * dossier is and what just happened, where is it allowed to go, and is the move
 * legal? It runs no research, makes no DB call, renders nothing.
 *
 * It NEVER inspects the actor. Whether an analyst or a customer triggered the
 * event is an authorization concern for the caller. This machine validates the
 * transition, never the actor.
 *
 * Rejection contract:
 *   - illegal edge (no such transition)      → valid:false, nextState unchanged
 *   - legal edge whose guard fails           → valid:false, nextState unchanged, reason names the guard
 *   - any event from a terminal state        → valid:false, nextState unchanged
 */

const { TERMINAL_STATES } = require('./states');
const { TRANSITIONS } = require('./transitions');
const { GUARDS } = require('./guards');

function reject(currentState, reason) {
  return { nextState: currentState, valid: false, reason };
}

function transition(currentState, event, context = {}) {
  // Terminal states reject everything (clearer reason than a missing edge).
  if (TERMINAL_STATES.includes(currentState)) {
    return reject(currentState, `'${currentState}' is terminal; no transitions out (event '${event}' rejected).`);
  }

  const edge = TRANSITIONS.find((t) => t.from === currentState && t.event === event);
  if (!edge) {
    return reject(currentState, `Illegal transition: no edge from '${currentState}' on event '${event}'.`);
  }

  if (edge.guard) {
    const guardFn = GUARDS[edge.guard];
    const result = guardFn(context);
    if (!result.ok) {
      return reject(currentState, result.reason);
    }
  }

  return { nextState: edge.to, valid: true, reason: null };
}

module.exports = { transition };
