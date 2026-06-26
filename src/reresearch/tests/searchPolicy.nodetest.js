'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  SEARCH_CAP,
  evaluateSearchCap,
  disputeKindFromAnswer,
} = require('../searchPolicy');

test('cap is two', () => {
  assert.equal(SEARCH_CAP, 2);
});

test('first search (0 prior): allowed, no alert', () => {
  const c = evaluateSearchCap(0);
  assert.equal(c.locked, false);
  assert.equal(c.isSecondAttempt, false);
  assert.equal(c.attemptsRemaining, 2);
});

test('second search (1 prior): allowed, legal-name alert shown', () => {
  const c = evaluateSearchCap(1);
  assert.equal(c.locked, false);
  assert.equal(c.isSecondAttempt, true);
  assert.equal(c.attemptsRemaining, 1);
});

test('after two (2 prior): locked, manual only', () => {
  const c = evaluateSearchCap(2);
  assert.equal(c.locked, true);
  assert.equal(c.isSecondAttempt, false);
  assert.equal(c.attemptsRemaining, 0);
});

test('beyond cap stays locked', () => {
  assert.equal(evaluateSearchCap(5).locked, true);
});

test('null/unknown count fails open to first attempt', () => {
  const c = evaluateSearchCap(null);
  assert.equal(c.attempts, 0);
  assert.equal(c.locked, false);
  assert.equal(c.isSecondAttempt, false);
});

test('dispute answer maps to lifecycle dispute kind', () => {
  assert.equal(disputeKindFromAnswer('different_company'), 'identity');
  assert.equal(disputeKindFromAnswer('wrong_details'), 'interpretation');
  assert.equal(disputeKindFromAnswer('anything_else'), null);
  assert.equal(disputeKindFromAnswer(undefined), null);
});
