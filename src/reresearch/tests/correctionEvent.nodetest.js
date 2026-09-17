'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { CUSTOMER_FACT_CORRECTION_RULE, buildCorrectionEvent, postCorrectionEvent } = require('../correctionEvent');

const before = { companyName: 'Acme Ltd', countryCode: 'GB', entityType: 'Corporate', ownershipType: 'private_limited', registrationNumber: '123' };
const plan = { action: 're_search', changed: ['companyName'], next: { ...before, companyName: 'Acme Holdings Ltd' } };

test('builds a change_event describing the correction', () => {
  const e = buildCorrectionEvent({ dossierId: 'd-1', before, plan });
  assert.deepEqual(e, {
    submissionId: 'd-1',
    dossierId: 'd-1',
    fieldId: 'foundational_facts.correction',
    fieldClass: 'structural',
    changeType: 'changed',
    beforeValue: before,
    afterValue: { next: plan.next, changed: ['companyName'], action: 're_search' },
    workflow: 'ops_review',
    escalation: false,
    decided: true,
    matchedRule: CUSTOMER_FACT_CORRECTION_RULE,
    jurisdiction: 'GB',
  });
});

test('an explicit submissionId wins', () => {
  assert.equal(buildCorrectionEvent({ submissionId: 'app-1', dossierId: null, plan }).submissionId, 'app-1');
});

test('the event passes the change_events write validation', async () => {
  const { writeEvent } = require('../../changeIntelligence/events/writeEvent');
  const db = { query: async () => [{ id: 1 }] };
  await writeEvent(db, buildCorrectionEvent({ dossierId: 'd-1', before, plan }));
});

test('posts once with the caller headers and never throws without fetch', () => {
  const saved = global.fetch;
  const sent = [];
  global.fetch = (url, opts) => { sent.push({ url, opts }); return Promise.resolve({}); };
  try {
    postCorrectionEvent({ dossierId: 'd-1', before, plan, headers: { Authorization: 'Bearer x' } });
  } finally { global.fetch = saved; }
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, '/api/change-events');
  assert.equal(sent[0].opts.headers.Authorization, 'Bearer x');
  assert.equal(JSON.parse(sent[0].opts.body).matchedRule, CUSTOMER_FACT_CORRECTION_RULE);
});
