/**
 * appendOnly.invariants.test.js — locks the constraint the whole slice exists
 * to protect: change_events is APPEND-ONLY. No update, no delete, no lost
 * history. If any of these fail, the audit trail can be silently corrupted.
 */

import * as writeMod from '../writeEvent';
import * as readMod from '../readEvents';
import { writeEvent } from '../writeEvent';
import { getEventsByField, getCurrentFieldState } from '../readEvents';
import { makeFakeDb, baseEvent } from '../fakeDb';

describe('append-only invariants', () => {
  test('the DAL module surface exposes exactly one write path and zero mutations', () => {
    expect(Object.keys(writeMod).sort()).toEqual(['writeEvent']);

    const readSurface = Object.keys(readMod);
    expect(readSurface).toEqual(
      expect.arrayContaining([
        'getEventsBySubmission',
        'getEventsByField',
        'getCurrentFieldState',
        'getUndecidedEvents',
        'getEscalations',
        'getAmendmentDocs',
      ]),
    );
    // No read helper is secretly a mutation.
    for (const name of readSurface) {
      expect(name).not.toMatch(/update|delete|remove|drop|insert|write|set|upsert/i);
    }
    // The only mutation in the entire DAL surface is writeEvent.
    const fullSurface = [...Object.keys(writeMod), ...readSurface];
    expect(fullSurface.filter((n) => /update|delete|insert|upsert|write/i.test(n))).toEqual([
      'writeEvent',
    ]);
  });

  test('an explicit id is rejected — no caller can overwrite a row by id', async () => {
    const db = makeFakeDb();
    await expect(writeEvent(db, baseEvent({ id: 99 }))).rejects.toThrow(/id is server-assigned/);
  });

  test('superseding an already-superseded event is rejected (concurrent edit)', async () => {
    const db = makeFakeDb();
    const e1 = await writeEvent(db, baseEvent({ fieldId: 'a' }));
    await writeEvent(db, baseEvent({ fieldId: 'a', supersedesId: e1.id })); // e1 now superseded
    // A second attempt to supersede e1 must fail rather than silently fork.
    await expect(
      writeEvent(db, baseEvent({ fieldId: 'a', supersedesId: e1.id })),
    ).rejects.toThrow(/already superseded/);
  });

  test('superseding a non-existent event is rejected', async () => {
    const db = makeFakeDb();
    await expect(
      writeEvent(db, baseEvent({ fieldId: 'a', supersedesId: 12345 })),
    ).rejects.toThrow(/does not exist/);
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
    expect(current.after_value).toEqual({ v: N - 1 }); // exactly the tail

    const history = await getEventsByField(db, 'sub-1', 'a');
    expect(history).toHaveLength(N); // nothing lost
    expect(history.map((r) => r.after_value.v)).toEqual([0, 1, 2, 3, 4]); // in order
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

    expect(afterRevert).toBe(afterEdit + 1); // history GREW
    const current = await getCurrentFieldState(db, 'sub-1', 'a');
    expect(current.after_value).toEqual({ name: 'AI Original' });
  });
});
