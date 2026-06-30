'use strict';

/**
 * illegalTransitions.invariants.test.js — the important one.
 *
 * The analogue of the change engine's completeness sweep. It enumerates the
 * FULL product of (every state × every event) and proves that the result of
 * `transition` matches the transition table EXACTLY: legal edges with passing
 * guards succeed; everything else is rejected with a reason. No illegal edge
 * may silently succeed.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { transition } = require('../transition');
const { TRANSITIONS } = require('../transitions');
const {
  STATE_LIST, EVENT_LIST, STATES, EVENTS, DISPUTE_KIND, TERMINAL_STATES,
} = require('../states');

const FULL_CLASSIFIERS = {
  country: 'GB',
  ownershipType: 'Privately owned',
  corporateVsFi: 'Corporate',
  companyName: 'Acme Ltd',
};

// A context that satisfies EVERY guard at once is impossible (the two reseed
// guards demand opposite dispute kinds), so we build a guard-specific passing
// context per edge.
function passingContextFor(guard) {
  switch (guard) {
    case 'allClassifiersPresent': return { classifiers: { ...FULL_CLASSIFIERS } };
    case 'disputeHasKind': return { disputedClassifiers: ['country'], disputeKind: DISPUTE_KIND.IDENTITY };
    case 'disputeKindIsIdentity': return { disputeKind: DISPUTE_KIND.IDENTITY };
    case 'disputeKindIsInterpretation': return { disputeKind: DISPUTE_KIND.INTERPRETATION };
    case null: return {};
    default: throw new Error(`unknown guard ${guard}`);
  }
}

function failingContextFor(guard) {
  switch (guard) {
    case 'allClassifiersPresent': return { classifiers: {} };
    case 'disputeHasKind': return {}; // no disputed classifiers, no kind
    case 'disputeKindIsIdentity': return { disputeKind: DISPUTE_KIND.INTERPRETATION }; // wrong kind, no correction
    case 'disputeKindIsInterpretation': return { disputeKind: DISPUTE_KIND.IDENTITY };
    case null: return null; // unguarded edges cannot fail a guard
    default: throw new Error(`unknown guard ${guard}`);
  }
}

function edgeFor(state, event) {
  return TRANSITIONS.find((t) => t.from === state && t.event === event) || null;
}

// A maximally-populated context — used to prove illegal edges reject even when
// every possible guard input is present.
const RICH_CONTEXT = {
  classifiers: { ...FULL_CLASSIFIERS },
  disputedClassifiers: ['country', 'companyName'],
  disputeKind: DISPUTE_KIND.IDENTITY,
  correctedCompany: 'Real Corp',
  correctedCountry: 'SG',
};

test('full (state × event) sweep matches the transition table exactly', () => {
  let legalCount = 0;
  let rejectedCount = 0;
  const offenders = [];

  for (const state of STATE_LIST) {
    for (const event of EVENT_LIST) {
      const edge = edgeFor(state, event);
      const isTerminal = TERMINAL_STATES.includes(state);

      if (edge && !isTerminal) {
        // Legal edge with a passing guard → must succeed.
        const r = transition(state, event, passingContextFor(edge.guard));
        if (!(r.valid === true && r.nextState === edge.to && r.reason === null)) {
          offenders.push(`legal edge ${state}/${event} did not succeed: ${JSON.stringify(r)}`);
        } else {
          legalCount += 1;
        }
      } else {
        // Illegal edge (or terminal) → must reject even with a rich context.
        const r = transition(state, event, RICH_CONTEXT);
        if (!(r.valid === false && r.nextState === state && typeof r.reason === 'string' && r.reason.length > 0)) {
          offenders.push(`illegal pair ${state}/${event} was not cleanly rejected: ${JSON.stringify(r)}`);
        } else {
          rejectedCount += 1;
        }
      }
    }
  }

  assert.deepEqual(offenders, [], `offending pairs:\n${offenders.join('\n')}`);
  // 11 legal edges in the table; the rest of the 8×9 grid is rejected.
  assert.equal(legalCount, TRANSITIONS.length);
  assert.equal(legalCount, 11);
  assert.equal(rejectedCount, STATE_LIST.length * EVENT_LIST.length - 11);
});

test('every guarded legal edge is rejected when its guard FAILS (rejected by guard, not edge)', () => {
  for (const edge of TRANSITIONS) {
    if (!edge.guard) continue;
    const r = transition(edge.from, edge.event, failingContextFor(edge.guard));
    assert.equal(r.valid, false, `${edge.from}/${edge.event} should fail its guard`);
    assert.equal(r.nextState, edge.from);
    assert.ok(r.reason && r.reason.length > 0);
  }
});

test('locked is terminal — rejects EVERY event', () => {
  for (const event of EVENT_LIST) {
    const r = transition(STATES.LOCKED, event, RICH_CONTEXT);
    assert.equal(r.valid, false);
    assert.equal(r.nextState, STATES.LOCKED);
    assert.match(r.reason, /terminal/);
  }
});

test('no state-skipping: draft cannot reach ready directly on any event', () => {
  for (const event of EVENT_LIST) {
    const r = transition(STATES.DRAFT, event, RICH_CONTEXT);
    assert.notEqual(r.nextState, STATES.READY);
  }
});

test('identity/interpretation fork routes correctly and rejects the mismatch', () => {
  // identity → full research only
  assert.equal(
    transition(STATES.DISPUTED, EVENTS.RESEED_FULL_RESEARCH, { disputeKind: DISPUTE_KIND.IDENTITY }).nextState,
    STATES.RE_RESEARCHING,
  );
  assert.equal(
    transition(STATES.DISPUTED, EVENTS.RESEED_FULL_RESEARCH, { disputeKind: DISPUTE_KIND.INTERPRETATION }).valid,
    false,
  );
  // interpretation → derivations only
  assert.equal(
    transition(STATES.DISPUTED, EVENTS.RESEED_DERIVATIONS_ONLY, { disputeKind: DISPUTE_KIND.INTERPRETATION }).nextState,
    STATES.RE_DERIVING,
  );
  assert.equal(
    transition(STATES.DISPUTED, EVENTS.RESEED_DERIVATIONS_ONLY, { disputeKind: DISPUTE_KIND.IDENTITY }).valid,
    false,
  );
});

test('unknown state / unknown event are rejected as illegal edges, not crashes', () => {
  assert.equal(transition('bogus_state', EVENTS.START_RESEARCH).valid, false);
  assert.equal(transition(STATES.DRAFT, 'BOGUS_EVENT').valid, false);
});
