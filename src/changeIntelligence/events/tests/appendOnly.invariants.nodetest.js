'use strict';

/**
 * appendOnly.invariants.nodetest.js — locks the constraint the whole slice
 * exists to protect: change_events is APPEND-ONLY. No update, no delete, no lost
 * history. If any of these fail, the audit trail can be silently corrupted.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const writeMod = require('../writeEvent');
const readMod = require('../readEvents');
const { writeEvent } = require('../writeEvent');
const { getEventsByField, getCurrentFieldState } = require('../readEvents');
const { makeFakeDb, baseEvent } = require('../fakeDb');

test('the DAL module surface exposes exactly one write path and zero mutations', () => {
  assert.deepEqual(Object.keys(writeMod).sort(), ['writeEvent']);

  const readSurface = Object.keys(readMod);
  for (const expected of [
    'getEventsBySubmission',
    'getEventsByField',
    'getCurrentFieldState',
    'getUndecidedEvents',
    'getEscalations',
    'getAmendmentDocs',
  ]) {
    assert.ok(readSurface.includes(expected), `read surface missing ${expected}`);
  }
  // No read helper is secretly a mutation.
  for (const name of readSurface) {
    assert.doesNotMatch(name, /update|delete|remove|drop|insert|write|set|upsert/i);
  }
  // The only mutation in the entire DAL surface is writeEvent.
  const fullSurface = [...Object.keys(writeMod), ...readSurface];
  assert.deepEqual(
    fullSurface.filter((n) => /update|delete|insert|upsert|write/i.test(n)),
    ['writeEvent'],
  );
});

test('an explicit id is rejected — no caller can overwrite a row by id', async () => {
  const db = makeFakeDb();
  await assert.rejects(() => writeEvent(db, baseEvent({ id: 99 })), /id is server-assigned/);
});

test('superseding an already-superseded event is rejected (concurrent edit)', async () => {
  const db = makeFakeDb();
  const e1 = await writeEvent(db, baseEvent({ fieldId: 'a' }));
  await writeEvent(db, baseEvent({ fieldId: 'a', supersedesId: e1.id })); // e1 now superseded
  // A second attempt to supersede e1 must fail rather than silently fork.
  await assert.rejects(
    () => writeEvent(db, baseEvent({ fieldId: 'a', supersedesId: e1.id })),
    /already superseded/,
  );
});

test('superseding a non-existent event is rejected', async () => {
  const db = makeFakeDb();
  await assert.rejects(
    () => writeEvent(db, baseEvent({ fieldId: 'a', supersedesId: 12345 })),
    /does not exist/,
  );
});

test('after a chain of N supersedes: current = tail, history = all N in order', async () => {
  const db = makeFakeDb();
  const N = 5;
  let prevId = null;
  for (let i = 0; i < N; i++) {
    const row = await writeEvent(
      db,
      baseEvent({ fieldId: 'a', afterValue: { v: i }, supersedesId: prevId }),
    );
    prevId = row.id;
  }

  const current = await getCurrentFieldState(db, 'sub-1', 'a');
  assert.deepEqual(current.after_value, { v: N - 1 }); // exactly the tail

  const history = await getEventsByField(db, 'sub-1', 'a');
  assert.equal(history.length, N); // nothing lost
  assert.deepEqual(history.map((r) => r.after_value.v), [0, 1, 2, 3, 4]); // in order
});

test('a revert to the AI value grows history — it never shrinks', async () => {
  const db = makeFakeDb();
  // Customer edits the AI value...
  const e1 = await writeEvent(
    db,
    baseEvent({ fieldId: 'a', changeType: 'changed', afterValue: { name: 'Edited' } }),
  );
  const afterEdit = (await getEventsByField(db, 'sub-1', 'a')).length;

  // ...then reverts back to the AI value. This is a NEW row, not a delete.
  await writeEvent(
    db,
    baseEvent({
      fieldId: 'a',
      changeType: 'changed',
      afterValue: { name: 'AI Original' },
      supersedesId: e1.id,
    }),
  );
  const afterRevert = (await getEventsByField(db, 'sub-1', 'a')).length;

  assert.equal(afterRevert, afterEdit + 1); // history GREW
  const current = await getCurrentFieldState(db, 'sub-1', 'a');
  assert.deepEqual(current.after_value, { name: 'AI Original' });
});
