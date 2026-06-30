'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { deriveChangeType } = require('../deriveChangeType');

test('add — aiValue empty/absent, finalValue present', () => {
  const cases = [
    ['', 'Acme Ltd'],
    [null, 'Acme Ltd'],
    [undefined, 'Acme Ltd'],
    ['   ', 'Acme Ltd'],
    [[], ['Jane Doe']],
    [{}, { name: 'Jane' }],
  ];
  for (const [aiValue, finalValue] of cases) {
    assert.equal(deriveChangeType({ aiValue, finalValue }), 'add');
  }
});

test('remove — aiValue present, finalValue empty/absent', () => {
  const cases = [
    ['Acme Ltd', ''],
    ['Acme Ltd', null],
    ['Acme Ltd', undefined],
    ['Acme Ltd', '   '],
    [['Jane Doe'], []],
    [{ name: 'Jane' }, {}],
  ];
  for (const [aiValue, finalValue] of cases) {
    assert.equal(deriveChangeType({ aiValue, finalValue }), 'remove');
  }
});

test('changed — both present (the value moved)', () => {
  assert.equal(deriveChangeType({ aiValue: 'Acme Ltd', finalValue: 'Acme Limited' }), 'changed');
  assert.equal(deriveChangeType({ aiValue: ['A'], finalValue: ['A', 'B'] }), 'changed');
  // equal values still → changed: deriveChangeType does NOT compare equality;
  // the caller only invokes it on flagged diffs.
  assert.equal(deriveChangeType({ aiValue: 'Acme Ltd', finalValue: 'Acme Ltd' }), 'changed');
});

test('both empty → changed (degenerate no-op; there is no nochange outcome)', () => {
  assert.equal(deriveChangeType({ aiValue: '', finalValue: '' }), 'changed');
  assert.equal(deriveChangeType({ aiValue: null, finalValue: undefined }), 'changed');
  assert.equal(deriveChangeType({ aiValue: [], finalValue: [] }), 'changed');
});

test('whitespace-only is treated as empty', () => {
  assert.equal(deriveChangeType({ aiValue: '   ', finalValue: 'X' }), 'add');
  assert.equal(deriveChangeType({ aiValue: 'X', finalValue: '\t\n ' }), 'remove');
});

test('fieldClass is ignored — never used to infer the change type', () => {
  const args = { aiValue: '', finalValue: 'X' };
  assert.equal(
    deriveChangeType({ ...args, fieldClass: 'director' }),
    deriveChangeType({ ...args, fieldClass: 'ubo' }),
  );
});

test('returns one of exactly add | remove | changed', () => {
  const allowed = ['add', 'remove', 'changed'];
  const samples = [
    { aiValue: '', finalValue: 'X' },
    { aiValue: 'X', finalValue: '' },
    { aiValue: 'A', finalValue: 'B' },
    { aiValue: '', finalValue: '' },
  ];
  for (const s of samples) assert.ok(allowed.includes(deriveChangeType(s)));
});
