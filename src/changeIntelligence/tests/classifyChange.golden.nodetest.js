'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { classifyChange } = require('../classifyChange');

/**
 * Golden tests — one assertion per DECIDED policy row, hand-written from the
 * design discussion. These lock the contract. They must always pass.
 *
 * Defaults: verifiability structured_registry (so the guard does not fire),
 * jurisdiction GB (no overrides exist).
 */
const base = { verifiability: 'structured_registry', jurisdiction: 'GB' };

// node:assert has no toMatchObject; assert each expected key deep-equals.
function matches(actual, expected) {
  for (const key of Object.keys(expected)) {
    assert.deepEqual(actual[key], expected[key], `key '${key}'`);
  }
}

test('director: add / genuine_update / not_reflected → doc_required (Updated Director Registry)', () => {
  matches(classifyChange({ ...base, fieldClass: 'director', changeType: 'add', intent: 'genuine_update', registryStatus: 'not_reflected' }),
    { workflow: 'doc_required', docType: 'Updated Director Registry', decided: true, eddFlag: false, matchedRule: 'DIR-ADD-GENUINE-NOTREFLECTED' });
});

test('director: add / genuine_update / reflected → ops_review (no doc)', () => {
  matches(classifyChange({ ...base, fieldClass: 'director', changeType: 'add', intent: 'genuine_update', registryStatus: 'reflected' }),
    { workflow: 'ops_review', docType: null, decided: true });
});

test('director: correct (name/dob) / ai_correction / any registry → ops_review', () => {
  for (const registryStatus of ['reflected', 'not_reflected', 'unknown']) {
    matches(classifyChange({ ...base, fieldClass: 'director', changeType: 'correct', intent: 'ai_correction', registryStatus }),
      { workflow: 'ops_review', docType: null, decided: true, matchedRule: 'DIR-CORRECT' });
  }
});

test('director: remove / genuine_update / not_reflected → doc_required (Updated Director Registry)', () => {
  matches(classifyChange({ ...base, fieldClass: 'director', changeType: 'remove', intent: 'genuine_update', registryStatus: 'not_reflected' }),
    { workflow: 'doc_required', docType: 'Updated Director Registry', decided: true });
});

test('director: remove / genuine_update / reflected → ops_review (no doc)', () => {
  matches(classifyChange({ ...base, fieldClass: 'director', changeType: 'remove', intent: 'genuine_update', registryStatus: 'reflected' }),
    { workflow: 'ops_review', docType: null, decided: true });
});

test('ubo: add / genuine_update / not_reflected → doc_required (Updated UBO Registry)', () => {
  matches(classifyChange({ ...base, fieldClass: 'ubo', changeType: 'add', intent: 'genuine_update', registryStatus: 'not_reflected' }),
    { workflow: 'doc_required', docType: 'Updated UBO Registry', decided: true });
});

test('ubo: add / genuine_update / reflected → ops_review', () => {
  matches(classifyChange({ ...base, fieldClass: 'ubo', changeType: 'add', intent: 'genuine_update', registryStatus: 'reflected' }),
    { workflow: 'ops_review', docType: null, decided: true });
});

test('ubo: correct / ai_correction / any registry → ops_review', () => {
  for (const registryStatus of ['reflected', 'not_reflected', 'unknown']) {
    matches(classifyChange({ ...base, fieldClass: 'ubo', changeType: 'correct', intent: 'ai_correction', registryStatus }),
      { workflow: 'ops_review', decided: true, matchedRule: 'UBO-CORRECT' });
  }
});

test('ubo: shareholding update / genuine_update / not_reflected → doc_required (Updated UBO Registry)', () => {
  matches(classifyChange({ ...base, fieldClass: 'ubo', changeType: 'update', intent: 'genuine_update', registryStatus: 'not_reflected' }),
    { workflow: 'doc_required', docType: 'Updated UBO Registry', decided: true });
});

test('address: changed / reflected → ops_review (no doc)', () => {
  matches(classifyChange({ ...base, fieldClass: 'address', changeType: 'update', intent: 'genuine_update', registryStatus: 'reflected' }),
    { workflow: 'ops_review', docType: null, decided: true, matchedRule: 'ADDR-REFLECTED' });
});

test('address: changed / not_reflected → doc_required (Notice of Change of Address)', () => {
  matches(classifyChange({ ...base, fieldClass: 'address', changeType: 'update', intent: 'genuine_update', registryStatus: 'not_reflected' }),
    { workflow: 'doc_required', docType: 'Notice of Change of Address', decided: true, matchedRule: 'ADDR-NOTREFLECTED' });
});

test('factualId: correct / any intent / any registry → doc_required (Supporting Registration Document)', () => {
  matches(classifyChange({ ...base, fieldClass: 'factualId', changeType: 'correct', intent: null, registryStatus: 'reflected' }),
    { workflow: 'doc_required', docType: 'Supporting Registration Document', decided: true, matchedRule: 'FACTUALID-CORRECT' });
});

test('factualId: update / any intent / any registry → doc_required (Supporting Registration Document)', () => {
  matches(classifyChange({ ...base, fieldClass: 'factualId', changeType: 'update', intent: null, registryStatus: 'not_reflected' }),
    { workflow: 'doc_required', docType: 'Supporting Registration Document', decided: true, matchedRule: 'FACTUALID-UPDATE' });
});

test('generic: any change / any intent → ops_review, silent, no doc', () => {
  matches(classifyChange({ ...base, fieldClass: 'generic', changeType: 'update', intent: 'genuine_update', registryStatus: 'reflected' }),
    { workflow: 'ops_review', docType: null, silent: true, decided: true, matchedRule: 'GENERIC' });
});

test('structural: different_entity → restart (identity-invalidating)', () => {
  matches(classifyChange({ ...base, fieldClass: 'structural', changeType: 'update', intent: 'different_entity', registryStatus: 'unknown' }),
    { workflow: 'restart', decided: true, matchedRule: 'STRUCT-DIFFERENT-ENTITY' });
});

test('structural: ai_correction → re_derive + docSetMayChange hint (interpretation-invalidating)', () => {
  matches(classifyChange({ ...base, fieldClass: 'structural', changeType: 'correct', intent: 'ai_correction', registryStatus: 'unknown' }),
    { workflow: 're_derive', docSetMayChange: true, decided: true, matchedRule: 'STRUCT-REDERIVE' });
});

test('structural is exempt from the verifiability guard (decided even on a document source)', () => {
  matches(classifyChange({ fieldClass: 'structural', changeType: 'update', intent: 'different_entity', registryStatus: 'unknown', verifiability: 'document', jurisdiction: 'GB' }),
    { workflow: 'restart', decided: true });
});

test('SAFEGUARD — verifiability guard: director add on a document source → analyst_review + accept_silent, NOT doc_required', () => {
  const r = classifyChange({ fieldClass: 'director', changeType: 'add', intent: 'genuine_update', registryStatus: 'not_reflected', verifiability: 'document', jurisdiction: 'GB' });
  matches(r, { workflow: 'analyst_review', silent: true, decided: true, matchedRule: 'VERIFIABILITY-GUARD' });
  assert.notEqual(r.workflow, 'doc_required');
});

test('SAFEGUARD — verifiability guard also fires for an unverified source', () => {
  matches(classifyChange({ fieldClass: 'ubo', changeType: 'add', intent: 'genuine_update', registryStatus: 'not_reflected', verifiability: 'unverified', jurisdiction: 'SG' }),
    { workflow: 'analyst_review', silent: true, decided: true });
});

test('SAFEGUARD — PEP short-circuit: pep / correct / ai_correction / reflected → escalation, silent', () => {
  matches(classifyChange({ fieldClass: 'pep', changeType: 'correct', intent: 'ai_correction', registryStatus: 'reflected', verifiability: 'structured_registry', jurisdiction: 'GB' }),
    { workflow: 'escalation', escalation: true, silent: true, decided: true, matchedRule: 'PEP-SHORTCIRCUIT' });
});

test('SAFEGUARD — PEP short-circuit fires regardless of verifiability (even a document source)', () => {
  matches(classifyChange({ fieldClass: 'pep', changeType: 'remove', intent: 'genuine_update', registryStatus: 'unknown', verifiability: 'document', jurisdiction: 'SG' }),
    { workflow: 'escalation', escalation: true, silent: true, decided: true });
});

test('no default fallthrough: an unmatched combo returns UNDECIDED + decided:false', () => {
  matches(classifyChange({ ...base, fieldClass: 'director', changeType: 'add', intent: 'ai_correction', registryStatus: 'reflected' }),
    { workflow: 'UNDECIDED', decided: false, matchedRule: null, eddFlag: false });
});

test('eddFlag is never silently set true (open question O2)', () => {
  const r = classifyChange({ ...base, fieldClass: 'generic', changeType: 'update', intent: 'genuine_update', registryStatus: 'reflected' });
  assert.equal(r.eddFlag, false);
});
