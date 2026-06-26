'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { writeEvent } = require('../writeEvent');
const {
  getEventsBySubmission,
  getEventsByField,
  getCurrentFieldState,
  getUndecidedEvents,
  getEscalations,
  getAmendmentDocs,
} = require('../readEvents');
const { makeFakeDb, baseEvent } = require('../fakeDb');

test('getEventsBySubmission returns the full history, oldest first', async () => {
  const db = makeFakeDb();
  await writeEvent(db, baseEvent({ fieldId: 'a' }));
  await writeEvent(db, baseEvent({ fieldId: 'b' }));
  await writeEvent(db, baseEvent({ submissionId: 'sub-2', fieldId: 'c' }));

  const rows = await getEventsBySubmission(db, 'sub-1');
  assert.deepEqual(rows.map((r) => r.field_id), ['a', 'b']);
  assert.deepEqual(rows.map((r) => r.id), [1, 2]);
});

test('getEventsByField returns only that field, oldest first', async () => {
  const db = makeFakeDb();
  await writeEvent(db, baseEvent({ fieldId: 'a' }));
  await writeEvent(db, baseEvent({ fieldId: 'b' }));
  await writeEvent(db, baseEvent({ fieldId: 'a' }));

  const rows = await getEventsByField(db, 'sub-1', 'a');
  assert.deepEqual(rows.map((r) => r.id), [1, 3]);
});

test('getCurrentFieldState returns the tail of a supersede chain', async () => {
  const db = makeFakeDb();
  const e1 = await writeEvent(db, baseEvent({ fieldId: 'a', afterValue: { v: 1 } }));
  const e2 = await writeEvent(
    db,
    baseEvent({ fieldId: 'a', afterValue: { v: 2 }, supersedesId: e1.id }),
  );
  await writeEvent(db, baseEvent({ fieldId: 'a', afterValue: { v: 3 }, supersedesId: e2.id }));

  const current = await getCurrentFieldState(db, 'sub-1', 'a');
  assert.deepEqual(current.after_value, { v: 3 });
});

test('getCurrentFieldState returns null for an unknown field', async () => {
  const db = makeFakeDb();
  assert.equal(await getCurrentFieldState(db, 'sub-1', 'nope'), null);
});

test('getUndecidedEvents returns only decided:false rows', async () => {
  const db = makeFakeDb();
  await writeEvent(db, baseEvent({ fieldId: 'a' }));
  await writeEvent(db, baseEvent({ fieldId: 'b', workflow: 'UNDECIDED', decided: false }));

  const rows = await getUndecidedEvents(db, 'sub-1');
  assert.deepEqual(rows.map((r) => r.field_id), ['b']);
});

test('getEscalations returns only escalation:true rows', async () => {
  const db = makeFakeDb();
  await writeEvent(db, baseEvent({ fieldId: 'a' }));
  await writeEvent(db, baseEvent({ fieldId: 'b', workflow: 'escalation', escalation: true }));

  const rows = await getEscalations(db, 'sub-1');
  assert.deepEqual(rows.map((r) => r.field_id), ['b']);
});

test('getAmendmentDocs returns only rows with a doc_type', async () => {
  const db = makeFakeDb();
  await writeEvent(db, baseEvent({ fieldId: 'a' }));
  await writeEvent(
    db,
    baseEvent({ fieldId: 'b', workflow: 'doc_required', docType: 'Updated Director Registry' }),
  );

  const rows = await getAmendmentDocs(db, 'sub-1');
  assert.deepEqual(rows.map((r) => r.doc_type), ['Updated Director Registry']);
});
