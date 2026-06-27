'use strict';

/**
 * dashboardMetrics.nodetest.js — the dashboard's correctness guarantees:
 * field-level metrics count CURRENT state only (reverted changes excluded), every
 * metric carries a sample size, and the empty case is all-zeros (no crash).
 *
 * Events are written through the real DAL into the in-memory fakeDb and read back
 * via getAllEvents, so the rows fed to the aggregator are the exact snake_case
 * shape production returns.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { writeEvent } = require('../events/writeEvent');
const { getAllEvents } = require('../events/readEvents');
const { makeFakeDb, baseEvent } = require('../events/fakeDb');
const { computeDashboardMetrics } = require('../dashboardMetrics');

test('empty event log → all-zero headline, early-data on, no crash', () => {
  const m = computeDashboardMetrics([]);
  assert.equal(m.meta.totalEvents, 0);
  assert.equal(m.meta.onboardings, 0);
  assert.equal(m.meta.earlyData, true);
  assert.equal(m.headline.correctionsCaptured.value, 0);
  assert.equal(m.headline.correctionsCaptured.sampleSize, 0);
  assert.deepEqual(m.detail.byField, []);
  assert.deepEqual(m.detail.failureFallbacks, []);
  assert.equal(m.detail.undecided.count, 0);
  // null input is tolerated too
  assert.equal(computeDashboardMetrics(undefined).meta.totalEvents, 0);
});

test('full scenario: current-state metrics, revert excluded, sample sizes present', async () => {
  const db = makeFakeDb();

  // sub-1
  await writeEvent(db, baseEvent({ submissionId: 'sub-1', fieldId: 'director.0.name', fieldClass: 'director', workflow: 'doc_required', customerIntent: 'ai_correction', sourceProvider: 'Companies House', docType: 'Updated Director Registry' }));
  await writeEvent(db, baseEvent({ submissionId: 'sub-1', fieldId: 'address.reg', fieldClass: 'address', workflow: 'ops_review', customerIntent: 'genuine_update' }));
  await writeEvent(db, baseEvent({ submissionId: 'sub-1', fieldId: 'pep.status', fieldClass: 'pep', workflow: 'escalation', escalation: true, escalationReason: 'pep hit' }));
  await writeEvent(db, baseEvent({ submissionId: 'sub-1', fieldId: 'ubo.0.name', fieldClass: 'ubo', workflow: 'UNDECIDED', decided: false, customerIntent: 'ai_correction' }));

  // sub-2: a correction that is then REVERTED (superseded by an ops_review event)
  const e5 = await writeEvent(db, baseEvent({ submissionId: 'sub-2', fieldId: 'director.0.name', fieldClass: 'director', workflow: 'doc_required', customerIntent: 'ai_correction' }));
  await writeEvent(db, baseEvent({ submissionId: 'sub-2', fieldId: 'director.0.name', fieldClass: 'director', workflow: 'ops_review', customerIntent: 'genuine_update', supersedesId: e5.id }));

  // sub-2: a re-research failure fallback flag (standalone audit event)
  await writeEvent(db, baseEvent({ submissionId: 'sub-2', fieldId: 'reresearch.fallback', fieldClass: 'structural', workflow: 'ops_review', matchedRule: 'RERESEARCH-FALLBACK-MANUAL', afterValue: { fellBackTo: 'manual', stage: 're_research', reason: 'registry_timeout' } }));

  const m = computeDashboardMetrics(await getAllEvents(db));

  // meta
  assert.equal(m.meta.onboardings, 2);
  assert.equal(m.meta.earlyData, true); // 2 < 20
  assert.equal(m.meta.currentChanges, 6); // e1..e4 + e6 + fallback; e5 superseded

  // headline — the reverted ai_correction (e5) is NOT counted
  assert.equal(m.headline.correctionsCaptured.value, 6);
  assert.equal(m.headline.aiErrorCorrections.value, 2); // e1, e4 only (e5 superseded)
  assert.equal(m.headline.rfiPreempted.value, 3); // e2, e6 (revert), fallback — all ops_review
  assert.equal(m.headline.escalationsFlagged.value, 1); // e3
  // every headline carries a sample size
  for (const k of Object.keys(m.headline)) {
    assert.equal(m.headline[k].sampleSize, 2, `${k} sample size`);
  }

  // detail
  assert.equal(m.detail.undecided.count, 1); // e4
  assert.equal(m.detail.failureFallbacks.length, 1);
  assert.equal(m.detail.failureFallbacks[0].reason, 'registry_timeout');
  assert.equal(m.detail.failureFallbacks[0].stage, 're_research');

  // intent split totals the current set
  const io = m.detail.intentSplit.overall;
  assert.equal(io.ai_correction, 2);
  assert.equal(io.genuine_update, 2); // e2, e6
  assert.equal(io.ai_correction + io.genuine_update + io.other, 6);

  // byField: director.0.name is current in BOTH submissions → count 2, ranked top
  const dir = m.detail.byField.find((f) => f.fieldId === 'director.0.name');
  assert.equal(dir.count, 2);
  assert.equal(m.detail.byField[0].count >= dir.count ? true : false, true);

  // source coverage flags sparsity (only 1 of 6 has a provider)
  assert.equal(m.detail.sourceCoverage.populated, 1);
  assert.equal(m.detail.sourceCoverage.sparse, true);
});

test('escalations list carries field, reason, workflow, timestamp', async () => {
  const db = makeFakeDb();
  await writeEvent(db, baseEvent({ submissionId: 's', fieldId: 'pep.status', fieldClass: 'pep', workflow: 'escalation', escalation: true, escalationReason: 'sanctions match' }));
  const m = computeDashboardMetrics(await getAllEvents(db));
  assert.equal(m.detail.escalations.length, 1);
  assert.equal(m.detail.escalations[0].reason, 'sanctions match');
  assert.equal(m.detail.escalations[0].fieldId, 'pep.status');
  assert.ok(m.detail.escalations[0].createdAt); // fakeDb stamps created_at
});
