'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  allClassifiersPresent,
  disputeHasKind,
  disputeKindIsIdentity,
  disputeKindIsInterpretation,
} = require('../guards');
const { DISPUTE_KIND } = require('../states');

const FULL_CLASSIFIERS = {
  country: 'GB',
  ownershipType: 'Privately owned',
  corporateVsFi: 'Corporate',
  companyName: 'Acme Ltd',
};

test('allClassifiersPresent: passes when all four are present', () => {
  assert.deepEqual(allClassifiersPresent({ classifiers: FULL_CLASSIFIERS }), { ok: true, reason: null });
});

test('allClassifiersPresent: fails and names each missing/empty classifier', () => {
  for (const key of Object.keys(FULL_CLASSIFIERS)) {
    const classifiers = { ...FULL_CLASSIFIERS, [key]: '' };
    const r = allClassifiersPresent({ classifiers });
    assert.equal(r.ok, false);
    assert.match(r.reason, new RegExp(key));
  }
});

test('allClassifiersPresent: empty string, whitespace, null, undefined all count as missing', () => {
  for (const bad of ['', '   ', null, undefined]) {
    const r = allClassifiersPresent({ classifiers: { ...FULL_CLASSIFIERS, companyName: bad } });
    assert.equal(r.ok, false);
  }
});

test('allClassifiersPresent: missing classifiers object → fails', () => {
  assert.equal(allClassifiersPresent({}).ok, false);
});

test('disputeHasKind: passes with ≥1 disputed classifier and a valid kind', () => {
  assert.deepEqual(
    disputeHasKind({ disputedClassifiers: ['country'], disputeKind: DISPUTE_KIND.IDENTITY }),
    { ok: true, reason: null },
  );
});

test('disputeHasKind: fails with no disputed classifiers', () => {
  assert.equal(disputeHasKind({ disputedClassifiers: [], disputeKind: DISPUTE_KIND.IDENTITY }).ok, false);
  assert.equal(disputeHasKind({ disputeKind: DISPUTE_KIND.IDENTITY }).ok, false);
});

test('disputeHasKind: fails with a missing or invalid kind', () => {
  assert.equal(disputeHasKind({ disputedClassifiers: ['country'] }).ok, false);
  assert.equal(disputeHasKind({ disputedClassifiers: ['country'], disputeKind: 'bogus' }).ok, false);
});

test('disputeKindIsIdentity: passes on kind=identity', () => {
  assert.equal(disputeKindIsIdentity({ disputeKind: DISPUTE_KIND.IDENTITY }).ok, true);
});

test('disputeKindIsIdentity: passes when a corrected company/country is supplied', () => {
  assert.equal(disputeKindIsIdentity({ correctedCompany: 'Real Corp' }).ok, true);
  assert.equal(disputeKindIsIdentity({ correctedCountry: 'SG' }).ok, true);
});

test('disputeKindIsIdentity: fails on interpretation with no correction', () => {
  assert.equal(disputeKindIsIdentity({ disputeKind: DISPUTE_KIND.INTERPRETATION }).ok, false);
});

test('disputeKindIsInterpretation: passes only on kind=interpretation', () => {
  assert.equal(disputeKindIsInterpretation({ disputeKind: DISPUTE_KIND.INTERPRETATION }).ok, true);
  assert.equal(disputeKindIsInterpretation({ disputeKind: DISPUTE_KIND.IDENTITY }).ok, false);
});

test('guards do not mutate their context argument', () => {
  const ctx = { classifiers: { ...FULL_CLASSIFIERS }, disputedClassifiers: ['country'], disputeKind: DISPUTE_KIND.IDENTITY };
  const snapshot = JSON.stringify(ctx);
  allClassifiersPresent(ctx);
  disputeHasKind(ctx);
  disputeKindIsIdentity(ctx);
  disputeKindIsInterpretation(ctx);
  assert.equal(JSON.stringify(ctx), snapshot);
});
