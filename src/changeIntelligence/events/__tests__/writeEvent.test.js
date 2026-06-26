import { writeEvent } from '../writeEvent';
import { makeFakeDb, baseEvent } from '../fakeDb';

describe('writeEvent — happy path', () => {
  test('appends an event and returns the stored row with a server-assigned id', async () => {
    const db = makeFakeDb();
    const row = await writeEvent(db, baseEvent());
    expect(row.id).toBe(1);
    expect(row.submission_id).toBe('sub-1');
    expect(row.field_id).toBe('director.0.name');
    expect(row.workflow).toBe('ops_review');
    expect(db._rows).toHaveLength(1);
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
    expect(row.before_value).toEqual({ name: 'Jane Doe' });
    expect(row.after_value).toEqual({ name: 'Jane Smith' });
  });

  test('applies NOT NULL defaults when boolean flags are omitted (DB default would be bypassed by explicit NULL)', async () => {
    const db = makeFakeDb();
    const row = await writeEvent(db, baseEvent());
    expect(row.edd_flag).toBe(false);
    expect(row.escalation).toBe(false);
    expect(row.decided).toBe(true);
  });

  test('decided:false (UNDECIDED) is written normally, not thrown', async () => {
    const db = makeFakeDb();
    const row = await writeEvent(
      db,
      baseEvent({ workflow: 'UNDECIDED', decided: false }),
    );
    expect(row.workflow).toBe('UNDECIDED');
    expect(row.decided).toBe(false);
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
    expect(row.doc_type).toBe('Updated Director Registry');
    expect(row.escalation).toBe(true);
    expect(row.escalation_reason).toBe('pep override');
    expect(row.matched_rule).toBe('DIR-ADD-GENUINE-NOTREFLECTED');
    expect(row.source_provider).toBe('Companies House');
    expect(row.source_tier).toBe(1);
    expect(row.jurisdiction).toBe('GB');
  });
});

describe('writeEvent — validation', () => {
  test('rejects a caller-supplied id', async () => {
    const db = makeFakeDb();
    await expect(writeEvent(db, baseEvent({ id: 5 }))).rejects.toThrow(/id is server-assigned/);
  });

  test('requires submissionId and fieldId', async () => {
    const db = makeFakeDb();
    await expect(writeEvent(db, baseEvent({ submissionId: undefined }))).rejects.toThrow(
      /submissionId is required/,
    );
    await expect(writeEvent(db, baseEvent({ fieldId: '  ' }))).rejects.toThrow(
      /fieldId is required/,
    );
  });

  test('requires a db with a .query method', async () => {
    await expect(writeEvent(null, baseEvent())).rejects.toThrow(/db with a .query/);
    await expect(writeEvent({}, baseEvent())).rejects.toThrow(/db with a .query/);
  });

  test.each([
    ['fieldClass', { fieldClass: 'manager' }],
    ['workflow', { workflow: 'auto_approve' }],
    ['changeType', { changeType: 'correct' }], // engine vocab, not table vocab
    ['verifiability', { verifiability: 'gut_feel' }],
    ['customerIntent', { customerIntent: 'maybe' }],
    ['customerRegistryClaim', { customerRegistryClaim: 'sorta' }],
  ])('rejects out-of-enum %s', async (label, override) => {
    const db = makeFakeDb();
    await expect(writeEvent(db, baseEvent(override))).rejects.toThrow(
      new RegExp(`${label}.*not in the allowed enum`),
    );
  });

  test('accepts nullable enum fields left null/undefined', async () => {
    const db = makeFakeDb();
    const row = await writeEvent(
      db,
      baseEvent({ verifiability: null, customerIntent: null, customerRegistryClaim: undefined }),
    );
    expect(row.verifiability).toBeNull();
    expect(row.customer_intent).toBeNull();
  });

  test('accepts customerIntent null as a valid INTENT enum member', async () => {
    const db = makeFakeDb();
    const row = await writeEvent(db, baseEvent({ customerIntent: 'different_entity' }));
    expect(row.customer_intent).toBe('different_entity');
  });
});
