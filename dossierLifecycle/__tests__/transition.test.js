'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { transition } = require('../transition');
const { STATES, EVENTS, DISPUTE_KIND } = require('../states');

const CLASSIFIERS = {
  country: 'GB',
  ownershipType: 'Privately owned',
  corporateVsFi: 'Corporate',
  companyName: 'Acme Ltd',
};

function ok(result, nextState) {
  assert.deepEqual(result, { nextState, valid: true, reason: null });
}

test('draft → researching on START_RESEARCH (guard passes)', () => {
  ok(transition(STATES.DRAFT, EVENTS.START_RESEARCH, { classifiers: CLASSIFIERS }), STATES.RESEARCHING);
});

test('researching → ready on RESEARCH_COMPLETE', () => {
  ok(transition(STATES.RESEARCHING, EVENTS.RESEARCH_COMPLETE), STATES.READY);
});

test('researching → failed on RESEARCH_FAILED', () => {
  ok(transition(STATES.RESEARCHING, EVENTS.RESEARCH_FAILED), STATES.FAILED);
});

test('failed → researching on RETRY', () => {
  ok(transition(STATES.FAILED, EVENTS.RETRY), STATES.RESEARCHING);
});

test('ready → disputed on CORE_CLASSIFIER_DISPUTED (guard passes)', () => {
  ok(
    transition(STATES.READY, EVENTS.CORE_CLASSIFIER_DISPUTED, {
      disputedClassifiers: ['country'],
      disputeKind: DISPUTE_KIND.IDENTITY,
    }),
    STATES.DISPUTED,
  );
});

test('disputed → re_researching on RESEED_FULL_RESEARCH (identity)', () => {
  ok(
    transition(STATES.DISPUTED, EVENTS.RESEED_FULL_RESEARCH, { disputeKind: DISPUTE_KIND.IDENTITY }),
    STATES.RE_RESEARCHING,
  );
});

test('disputed → re_deriving on RESEED_DERIVATIONS_ONLY (interpretation)', () => {
  ok(
    transition(STATES.DISPUTED, EVENTS.RESEED_DERIVATIONS_ONLY, { disputeKind: DISPUTE_KIND.INTERPRETATION }),
    STATES.RE_DERIVING,
  );
});

test('re_researching → ready on RESEARCH_COMPLETE', () => {
  ok(transition(STATES.RE_RESEARCHING, EVENTS.RESEARCH_COMPLETE), STATES.READY);
});

test('re_researching → failed on RESEARCH_FAILED', () => {
  ok(transition(STATES.RE_RESEARCHING, EVENTS.RESEARCH_FAILED), STATES.FAILED);
});

test('re_deriving → ready on DERIVE_COMPLETE', () => {
  ok(transition(STATES.RE_DERIVING, EVENTS.DERIVE_COMPLETE), STATES.READY);
});

test('ready → locked on JOURNEY_SUBMITTED', () => {
  ok(transition(STATES.READY, EVENTS.JOURNEY_SUBMITTED), STATES.LOCKED);
});

// ── rejection contract ──────────────────────────────────────────────────────

test('START_RESEARCH with a missing classifier is rejected by the guard (state unchanged)', () => {
  const r = transition(STATES.DRAFT, EVENTS.START_RESEARCH, { classifiers: { ...CLASSIFIERS, companyName: '' } });
  assert.equal(r.valid, false);
  assert.equal(r.nextState, STATES.DRAFT);
  assert.match(r.reason, /companyName/);
});

test('illegal edge (draft → ready via wrong event) is rejected with a reason', () => {
  const r = transition(STATES.DRAFT, EVENTS.RESEARCH_COMPLETE);
  assert.equal(r.valid, false);
  assert.equal(r.nextState, STATES.DRAFT);
  assert.match(r.reason, /Illegal transition/);
});

test('CORE_CLASSIFIER_DISPUTED without a dispute kind is rejected', () => {
  const r = transition(STATES.READY, EVENTS.CORE_CLASSIFIER_DISPUTED, { disputedClassifiers: ['country'] });
  assert.equal(r.valid, false);
  assert.equal(r.nextState, STATES.READY);
});

test('mismatched reseed: RESEED_FULL_RESEARCH on an interpretation dispute is rejected', () => {
  const r = transition(STATES.DISPUTED, EVENTS.RESEED_FULL_RESEARCH, { disputeKind: DISPUTE_KIND.INTERPRETATION });
  assert.equal(r.valid, false);
  assert.equal(r.nextState, STATES.DISPUTED);
});

test('mismatched reseed: RESEED_DERIVATIONS_ONLY on an identity dispute is rejected', () => {
  const r = transition(STATES.DISPUTED, EVENTS.RESEED_DERIVATIONS_ONLY, { disputeKind: DISPUTE_KIND.IDENTITY });
  assert.equal(r.valid, false);
  assert.equal(r.nextState, STATES.DISPUTED);
});

test('locked is terminal: JOURNEY_SUBMITTED (and anything) rejected', () => {
  const r = transition(STATES.LOCKED, EVENTS.JOURNEY_SUBMITTED);
  assert.equal(r.valid, false);
  assert.equal(r.nextState, STATES.LOCKED);
  assert.match(r.reason, /terminal/);
});

test('purity: identical inputs yield identical output and mutate nothing', () => {
  const context = { classifiers: { ...CLASSIFIERS }, disputedClassifiers: ['country'], disputeKind: DISPUTE_KIND.IDENTITY };
  const snapshot = JSON.stringify(context);
  const a = transition(STATES.DRAFT, EVENTS.START_RESEARCH, context);
  const b = transition(STATES.DRAFT, EVENTS.START_RESEARCH, context);
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(context), snapshot);
});
