import { buildChangeEvent } from '../buildChangeEvent';
import { deriveSource } from '../dialogueContent';
import { COLUMNS } from '../../../changeIntelligence/events/schema';

// Every key the event may legally carry (table columns + the lineage arg).
const ALLOWED_KEYS = new Set([...Object.keys(COLUMNS), 'supersedesId']);

const engineDocRequired = {
  workflow: 'doc_required',
  docType: 'Updated Director Registry',
  eddFlag: false,
  escalation: false,
  escalationReason: null,
  decided: true,
  matchedRule: 'DIR-ADD-GENUINE-NOTREFLECTED',
};

const engineUndecided = {
  workflow: 'UNDECIDED',
  docType: null,
  eddFlag: false,
  escalation: false,
  escalationReason: null,
  decided: false,
  matchedRule: null,
};

describe('buildChangeEvent', () => {
  test('produces only keys that exist in the change_events schema', () => {
    const event = buildChangeEvent({
      field: { fieldId: 'director.0', fieldClass: 'director', value: 'Jane' },
      jurisdiction: 'GB',
      submissionId: 'sub-1',
      dossierId: 'dos-1',
      intent: 'genuine_update',
      registryStatus: 'not_reflected',
      engineResult: engineDocRequired,
    });
    for (const key of Object.keys(event)) {
      expect(ALLOWED_KEYS.has(key)).toBe(true);
    }
  });

  test('maps answers + provenance + engine output into the event', () => {
    const event = buildChangeEvent({
      field: {
        fieldId: 'director.0',
        fieldClass: 'director',
        value: 'Jane Doe',
        sourceType: 'registry',
        sourceProvider: 'Companies House',
        sourceTier: 1,
        verifiability: 'structured_registry',
      },
      jurisdiction: 'GB',
      submissionId: 'sub-1',
      dossierId: 'dos-1',
      intent: 'genuine_update',
      registryStatus: 'not_reflected',
      engineResult: engineDocRequired,
    });

    expect(event.submissionId).toBe('sub-1');
    expect(event.dossierId).toBe('dos-1');
    expect(event.fieldId).toBe('director.0');
    expect(event.fieldClass).toBe('director');
    expect(event.beforeValue).toBe('Jane Doe');
    expect(event.afterValue).toBeNull(); // capture mode — final value is later
    expect(event.changeType).toBe('changed'); // stored vocab, not engine vocab
    expect(event.sourceProvider).toBe('Companies House');
    expect(event.sourceTier).toBe(1);
    expect(event.verifiability).toBe('structured_registry');
    expect(event.customerIntent).toBe('genuine_update');
    expect(event.customerRegistryClaim).toBe('not_reflected');
    expect(event.registryRecheckResult).toBeNull();
    expect(event.workflow).toBe('doc_required');
    expect(event.docType).toBe('Updated Director Registry');
    expect(event.escalation).toBe(false);
    expect(event.decided).toBe(true);
    expect(event.matchedRule).toBe('DIR-ADD-GENUINE-NOTREFLECTED');
    expect(event.jurisdiction).toBe('GB');
  });

  test('UNDECIDED engine output is recorded as decided:false, not dropped', () => {
    const event = buildChangeEvent({
      field: { fieldId: 'x', fieldClass: 'director', value: 'v' },
      engineResult: engineUndecided,
    });
    expect(event.workflow).toBe('UNDECIDED');
    expect(event.decided).toBe(false);
  });

  test('defaults are safe when called with almost nothing', () => {
    const event = buildChangeEvent({ field: { fieldId: 'x', fieldClass: 'generic' } });
    expect(event.changeType).toBe('changed');
    expect(event.afterValue).toBeNull();
    expect(event.eddFlag).toBe(false);
    expect(event.escalation).toBe(false);
    expect(event.decided).toBe(false); // no engineResult -> UNDECIDED-ish default
    expect(event.customerRegistryClaim).toBe('unknown');
  });

  test('never emits a server-assigned id or created_at', () => {
    const event = buildChangeEvent({
      field: { fieldId: 'x', fieldClass: 'generic' },
      engineResult: engineUndecided,
    });
    expect('id' in event).toBe(false);
    expect('createdAt' in event).toBe(false);
  });
});

/**
 * REGRESSION — change_events.source_tier is a SMALLINT in Postgres, but a
 * stakeholder object carries the string form ("tier1"). Passing the raw string
 * makes real Postgres reject the ENTIRE insert, and nothing local catches it:
 * the route always answers 200 and the fake DB does not type-check. Every
 * caller must send provenance through deriveSource, which normalises the tier.
 */
describe('source_tier is always the smallint the column expects', () => {
  it.each([
    ['tier1', 1],
    ['tier2', 2],
    ['tier3', 3],
    [1, 1],
    [null, null],
    ['document', null],
  ])('deriveSource(%s) -> %s', (raw, expected) => {
    expect(deriveSource({ sourceTier: raw }).sourceTier).toBe(expected);
  });

  it('a person-shaped stakeholder never puts a string tier on the event', () => {
    const stakeholder = { sourceTier: 'tier1', source: 'Companies House' };
    const src = deriveSource(stakeholder);
    const event = buildChangeEvent({
      field: {
        fieldId: 'ubo::sh_x::name',
        fieldClass: 'ubo',
        value: 'John Smith',
        sourceType: src.sourceType,
        sourceProvider: src.sourceProvider,
        sourceTier: src.sourceTier,
      },
      engineResult: engineDocRequired,
    });
    expect(typeof event.sourceTier).toBe('number');
    expect(event.sourceTier).toBe(1);
    expect(event.sourceProvider).toBe('Companies House');
  });
});
