'use strict';

/**
 * amendmentDocuments.nodetest.js — the behaviour that protects the customer:
 * a document is shown only while the change that called for it is still the
 * field's CURRENT state. Revert the change and the document must drop off.
 *
 * Events are written through the real DAL (writeEvent) into the in-memory fakeDb
 * and read back via getEventsBySubmission, so the rows fed to the derivation are
 * the exact snake_case shape production returns.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { writeEvent } = require('../events/writeEvent');
const { getEventsBySubmission } = require('../events/readEvents');
const { makeFakeDb, baseEvent } = require('../events/fakeDb');
const { deriveAmendmentDocuments } = require('../amendmentDocuments');

const load = (db, sub = 'sub-1') => getEventsBySubmission(db, sub);

test('empty event log → no documents', async () => {
  assert.deepEqual(deriveAmendmentDocuments([]), []);
  assert.deepEqual(deriveAmendmentDocuments(undefined), []);
});

test('an active doc_required event with a real docType produces one line', async () => {
  const db = makeFakeDb();
  await writeEvent(
    db,
    baseEvent({
      fieldId: 'director.0.name',
      fieldClass: 'director',
      workflow: 'doc_required',
      docType: 'Updated Director Registry',
      matchedRule: 'DIR-ADD-GENUINE-NOTREFLECTED',
    }),
  );

  const docs = deriveAmendmentDocuments(await load(db));
  assert.equal(docs.length, 1);
  assert.deepEqual(docs[0], {
    fieldId: 'director.0.name',
    fieldClass: 'director',
    docType: 'Updated Director Registry',
    reason: 'Required by rule DIR-ADD-GENUINE-NOTREFLECTED',
  });
});

test('RETRACT ON REVERT — a doc_required superseded by a non-doc event drops off', async () => {
  const db = makeFakeDb();
  // Customer change calls for a document...
  const e1 = await writeEvent(
    db,
    baseEvent({
      fieldId: 'address.registered',
      fieldClass: 'address',
      workflow: 'doc_required',
      docType: 'Proof of Address',
    }),
  );
  // ...then the customer reverts; the new current event needs no document.
  await writeEvent(
    db,
    baseEvent({
      fieldId: 'address.registered',
      fieldClass: 'address',
      workflow: 'ops_review',
      supersedesId: e1.id,
    }),
  );

  const docs = deriveAmendmentDocuments(await load(db));
  assert.deepEqual(docs, [], 'reverted document must not be requested');
});

test('the document follows the CURRENT event when a later event also needs a doc', async () => {
  const db = makeFakeDb();
  const e1 = await writeEvent(
    db,
    baseEvent({
      fieldId: 'ubo.1.name',
      fieldClass: 'ubo',
      workflow: 'doc_required',
      docType: 'Old Doc',
    }),
  );
  await writeEvent(
    db,
    baseEvent({
      fieldId: 'ubo.1.name',
      fieldClass: 'ubo',
      workflow: 'doc_required',
      docType: 'New Doc',
      supersedesId: e1.id,
    }),
  );

  const docs = deriveAmendmentDocuments(await load(db));
  assert.equal(docs.length, 1, 'one line per field — only the current event');
  assert.equal(docs[0].docType, 'New Doc');
});

test('NULL docType is excluded — the slice never invents a document', async () => {
  const db = makeFakeDb();
  await writeEvent(
    db,
    baseEvent({
      fieldId: 'pep.status',
      fieldClass: 'pep',
      workflow: 'doc_required',
      docType: null, // un-ratified — bound for analyst review, not a doc line
      decided: false,
    }),
  );

  const docs = deriveAmendmentDocuments(await load(db));
  assert.deepEqual(docs, []);
});

test('dedupes to one line per (fieldId, docType) and keeps distinct fields', async () => {
  const db = makeFakeDb();
  // Same field, doc requested twice across a supersede chain → one line.
  const e1 = await writeEvent(
    db,
    baseEvent({
      fieldId: 'director.0.name',
      fieldClass: 'director',
      workflow: 'doc_required',
      docType: 'Director Registry',
    }),
  );
  await writeEvent(
    db,
    baseEvent({
      fieldId: 'director.0.name',
      fieldClass: 'director',
      workflow: 'doc_required',
      docType: 'Director Registry',
      supersedesId: e1.id,
    }),
  );
  // A different field needing the SAME docType is a separate, legitimate line.
  await writeEvent(
    db,
    baseEvent({
      fieldId: 'director.1.name',
      fieldClass: 'director',
      workflow: 'doc_required',
      docType: 'Director Registry',
    }),
  );

  const docs = deriveAmendmentDocuments(await load(db));
  assert.equal(docs.length, 2);
  assert.deepEqual(
    docs.map((d) => d.fieldId).sort(),
    ['director.0.name', 'director.1.name'],
  );
});

test('mixed log: active docs in, reverted + null-docType + non-doc out', async () => {
  const db = makeFakeDb();
  // active → in
  await writeEvent(
    db,
    baseEvent({ fieldId: 'a', workflow: 'doc_required', docType: 'Doc A' }),
  );
  // reverted → out
  const r = await writeEvent(
    db,
    baseEvent({ fieldId: 'b', workflow: 'doc_required', docType: 'Doc B' }),
  );
  await writeEvent(db, baseEvent({ fieldId: 'b', workflow: 'ops_review', supersedesId: r.id }));
  // null docType → out
  await writeEvent(db, baseEvent({ fieldId: 'c', workflow: 'doc_required', docType: null }));
  // plain non-doc change → out
  await writeEvent(db, baseEvent({ fieldId: 'd', workflow: 'ops_review' }));

  const docs = deriveAmendmentDocuments(await load(db));
  assert.deepEqual(docs.map((d) => d.fieldId), ['a']);
  assert.equal(docs[0].docType, 'Doc A');
});
