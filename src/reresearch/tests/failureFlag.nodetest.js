'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  RERESEARCH_FALLBACK_RULE,
  buildReresearchFailureEvent,
  postReresearchFailureFlag,
} = require('../failureFlag');

test('builds a valid change_event recording the manual fall-through', () => {
  const e = buildReresearchFailureEvent({
    dossierId: 'dos-1',
    jurisdiction: 'GB',
    stage: 're_research',
    reason: 'registry_timeout',
  });
  assert.equal(e.submissionId, 'dos-1'); // falls back to dossierId
  assert.equal(e.dossierId, 'dos-1');
  assert.equal(e.fieldId, 'reresearch.fallback');
  assert.equal(e.fieldClass, 'structural');
  assert.equal(e.changeType, 'changed');
  assert.equal(e.workflow, 'ops_review'); // NOT an analyst escalation
  assert.equal(e.escalation, false);
  assert.equal(e.decided, true);
  assert.equal(e.matchedRule, RERESEARCH_FALLBACK_RULE);
  assert.deepEqual(e.afterValue, { fellBackTo: 'manual', stage: 're_research', reason: 'registry_timeout' });
});

test('explicit submissionId wins over dossierId fallback', () => {
  const e = buildReresearchFailureEvent({ submissionId: 'sub-9', dossierId: 'dos-1' });
  assert.equal(e.submissionId, 'sub-9');
});

test('uses safe defaults when stage/reason omitted', () => {
  const e = buildReresearchFailureEvent({ dossierId: 'd' });
  assert.equal(e.afterValue.stage, 're_research');
  assert.equal(e.afterValue.reason, 'unknown');
});

test('poster returns the event and never throws when fetch is absent', () => {
  const savedFetch = global.fetch;
  // eslint-disable-next-line no-global-assign
  global.fetch = undefined;
  try {
    const e = postReresearchFailureFlag({ dossierId: 'd', reason: 'x' });
    assert.equal(e.matchedRule, RERESEARCH_FALLBACK_RULE);
  } finally {
    global.fetch = savedFetch;
  }
});

test('poster posts to /api/change-events when fetch exists', () => {
  const savedFetch = global.fetch;
  let captured = null;
  global.fetch = (url, opts) => {
    captured = { url, body: JSON.parse(opts.body) };
    return Promise.resolve({ ok: true });
  };
  try {
    postReresearchFailureFlag({ dossierId: 'd', reason: 'boom' });
    assert.equal(captured.url, '/api/change-events');
    assert.equal(captured.body.matchedRule, RERESEARCH_FALLBACK_RULE);
    assert.equal(captured.body.afterValue.reason, 'boom');
  } finally {
    global.fetch = savedFetch;
  }
});
