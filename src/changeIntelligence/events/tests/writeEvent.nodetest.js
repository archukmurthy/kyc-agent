'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { writeEvent } = require('../writeEvent');
const { makeFakeDb, baseEvent } = require('../fakeDb');

// ── writeEvent — happy path ──

test('appends an event and returns the stored row with a server-assigned id', async () => {
  const db = makeFakeDb();
  const row = await writeEvent(db, baseEvent());
  assert.equal(row.id, 1);
  assert.equal(row.submission_id, 'sub-1');
  assert.equal(row.field_id, 'director.0.name');
  assert.equal(row.workflow, 'ops_review');
  assert.equal(db._rows.length, 1);
});

test('JSONB before/after values round-trip as JS values', async () => {
  const db = makeFakeDb();
  const row = await writeEvent(
    db,
    baseEvent({
      beforeValue: { name: 'Jane Doe' },
      afterValue: { name: 'Jane Smith' },
    }),
  );
  assert.deepEqual(row.before_value, { name: 'Jane Doe' });
  assert.deepEqual(row.after_value, { name: 'Jane Smith' });
});

test('applies NOT NULL defaults when boolean flags are omitted (DB default would be bypassed by explicit NULL)', async () => {
  const db = makeFakeDb();
  const row = await writeEvent(db, baseEvent());
  assert.equal(row.edd_flag, false);
  assert.equal(row.escalation, false);
  assert.equal(row.decided, true);
});

test('decided:false (UNDECIDED) is written normally, not thrown', async () => {
  const db = makeFakeDb();
  const row = await writeEvent(db, baseEvent({ workflow: 'UNDECIDED', decided: false }));
  assert.equal(row.workflow, 'UNDECIDED');
  assert.equal(row.decided, false);
});

test('records engine output and provenance verbatim', async () => {
  const db = makeFakeDb();
  const row = await writeEvent(
    db,
    baseEvent({
      workflow: 'doc_required',
      docType: 'Updated Director Registry',
      escalation: true,
      escalationReason: 'pep override',
      matchedRule: 'DIR-ADD-GENUINE-NOTREFLECTED',
      sourceProvider: 'Companies House',
      sourceTier: 1,
      verifiability: 'structured_registry',
      jurisdiction: 'GB',
    }),
  );
  assert.equal(row.doc_type, 'Updated Director Registry');
  assert.equal(row.escalation, true);
  assert.equal(row.escalation_reason, 'pep override');
  assert.equal(row.matched_rule, 'DIR-ADD-GENUINE-NOTREFLECTED');
  assert.equal(row.source_provider, 'Companies House');
  assert.equal(row.source_tier, 1);
  assert.equal(row.jurisdiction, 'GB');
});

// ── writeEvent — validation ──

test('rejects a caller-supplied id', async () => {
  const db = makeFakeDb();
  await assert.rejects(() => writeEvent(db, baseEvent({ id: 5 })), /id is server-assigned/);
});

test('requires submissionId and fieldId', async () => {
  const db = makeFakeDb();
  await assert.rejects(
    () => writeEvent(db, baseEvent({ submissionId: undefined })),
    /submissionId is required/,
  );
  await assert.rejects(() => writeEvent(db, baseEvent({ fieldId: '  ' })), /fieldId is required/);
});

test('requires a db with a .query method', async () => {
  await assert.rejects(() => writeEvent(null, baseEvent()), /db with a .query/);
  await assert.rejects(() => writeEvent({}, baseEvent()), /db with a .query/);
});

test('rejects out-of-enum values', async () => {
  const cases = [
    ['fieldClass', { fieldClass: 'manager' }],
    ['workflow', { workflow: 'auto_approve' }],
    ['changeType', { changeType: 'correct' }], // engine vocab, not table vocab
    ['verifiability', { verifiability: 'gut_feel' }],
    ['customerIntent', { customerIntent: 'maybe' }],
    ['customerRegistryClaim', { customerRegistryClaim: 'sorta' }],
  ];
  for (const [label, override] of cases) {
    const db = makeFakeDb();
    await assert.rejects(
      () => writeEvent(db, baseEvent(override)),
      new RegExp(`${label}.*not in the allowed enum`),
      `expected ${label} to be rejected`,
    );
  }
});

test('accepts nullable enum fields left null/undefined', async () => {
  const db = makeFakeDb();
  const row = await writeEvent(
    db,
    baseEvent({ verifiability: null, customerIntent: null, customerRegistryClaim: undefined }),
  );
  assert.equal(row.verifiability, null);
  assert.equal(row.customer_intent, null);
});

test('accepts customerIntent different_entity as a valid INTENT enum member', async () => {
  const db = makeFakeDb();
  const row = await writeEvent(db, baseEvent({ customerIntent: 'different_entity' }));
  assert.equal(row.customer_intent, 'different_entity');
});
