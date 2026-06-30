'use strict';

/**
 * ──────────────────────────────────────────────────────────────────────────
 *  COMPLETENESS SWEEP — the most important file in this slice.
 *
 *  It enumerates the FULL cartesian product of the engine's input domain and
 *  buckets every result as decided or UNDECIDED. It is a living map of every
 *  compliance decision still owed. It is SUPPOSED to be uncomfortable to read.
 *
 *  Do NOT make this green by adding policy rules. Holes are surfaced and handed
 *  back to compliance — see the open questions in the PR.
 *
 *  Prints the full UNDECIDED map, then asserts:
 *    1. total combo count == the cartesian size (sanity).
 *    2. coverage (decided / total) does not regress below a recorded floor.
 *    3. EDD is never silently fired (open question O2).
 *    4. NO newly-discovered gaps: every coherent UNDECIDED combo is either a
 *       deliberately-unencoded design hole or an impossible input. Assertion 4
 *       is RED BY DESIGN on first run — the failure body IS the list of
 *       decisions owed. It does not gate the Vercel build (deploy runs
 *       `npm run build`, not these tests).
 * ──────────────────────────────────────────────────────────────────────────
 */

const { test, before } = require('node:test');
const assert = require('node:assert/strict');

const { classifyChange } = require('../classifyChange');
const {
  FIELD_CLASS, CHANGE_TYPE, INTENT, REGISTRY_STATUS, VERIFIABILITY,
} = require('../enums');

const JURISDICTIONS = ['GB', 'SG'];

// Coverage floor — recorded from the first run. Regressions that REDUCE the
// number of decided combinations (e.g. a deleted rule) fail assertion 2.
const COVERAGE_FLOOR_COUNT = 1626;

// ── Input coherence ────────────────────────────────────────────────────────
// Which (fieldClass, changeType, intent) tuples the upstream caller can
// actually emit. The caller derives changeType from values (add|remove|changed)
// then splits 'changed' into correct|update using the customer's intent answer:
//   correct  <=> ai_correction       update <=> genuine_update
//   different_entity is a structural-only signal
//   factualId carries no dialogue, so its intent is irrelevant
// Combos that violate this can never reach the engine in production. They are
// reported as "impossible input", NOT counted as decisions owed. (See O5.)
function isCoherent({ fieldClass, changeType, intent }) {
  if (intent === 'different_entity' && fieldClass !== 'structural') return false;
  if (fieldClass === 'factualId') return true;
  if (changeType === 'correct' && intent !== 'ai_correction') return false;
  if (changeType === 'update' && intent !== 'genuine_update') return false;
  return true;
}

// ── Expected-known-gaps (deliberately unencoded per the design discussion) ──
function expectedGapLabel(c) {
  if (c.registryStatus === 'unknown') {
    return 'O1 · registry status unknown (customer skipped Q2)';
  }
  if (c.fieldClass === 'director' && c.changeType === 'update'
      && c.intent === 'genuine_update' && c.registryStatus === 'not_reflected') {
    return 'KNOWN · director name legitimately changed (genuine_update, not_reflected) — doc or ops?';
  }
  return null;
}

function key(c) {
  return `${c.fieldClass} · ${c.changeType} · ${String(c.intent)} · ${c.registryStatus} · ${c.verifiability} · ${c.jurisdiction}`;
}

// ── Build the sweep once ────────────────────────────────────────────────────
const combos = [];
for (const fieldClass of FIELD_CLASS) {
  for (const changeType of CHANGE_TYPE) {
    for (const intent of INTENT) {
      for (const registryStatus of REGISTRY_STATUS) {
        for (const verifiability of VERIFIABILITY) {
          for (const jurisdiction of JURISDICTIONS) {
            combos.push({ fieldClass, changeType, intent, registryStatus, verifiability, jurisdiction });
          }
        }
      }
    }
  }
}

const decided = [];
const undecided = [];
let everFiredEdd = false;
for (const c of combos) {
  const r = classifyChange(c);
  if (r.eddFlag || r.workflow === 'edd') everFiredEdd = true;
  (r.decided ? decided : undecided).push(c);
}

const buckets = { incoherent: [], expected: [], owed: [] };
for (const c of undecided) {
  if (!isCoherent(c)) { buckets.incoherent.push(c); continue; }
  const label = expectedGapLabel(c);
  if (label) { buckets.expected.push({ ...c, label }); continue; }
  buckets.owed.push(c);
}

const total = combos.length;
const decidedCount = decided.length;
const coveragePct = ((decidedCount / total) * 100).toFixed(1);

function groupByField(list) {
  const m = {};
  for (const c of list) (m[c.fieldClass] = m[c.fieldClass] || []).push(c);
  return m;
}

function renderGroup(title, list) {
  const lines = [`\n  ── ${title} (${list.length}) ──`];
  const grouped = groupByField(list);
  for (const fc of Object.keys(grouped).sort()) {
    lines.push(`    [${fc}] (${grouped[fc].length})`);
    for (const c of grouped[fc]) lines.push(`        ${key(c)}${c.label ? `   ← ${c.label}` : ''}`);
  }
  return lines.join('\n');
}

before(() => {
  console.log([
    '\n══════════════════════════════════════════════════════════════════════',
    ' CHANGE CLASSIFICATION ENGINE — COMPLETENESS SWEEP',
    '══════════════════════════════════════════════════════════════════════',
    ` total combinations : ${total}`,
    ` decided            : ${decidedCount}  (${coveragePct}% coverage)`,
    ` UNDECIDED          : ${undecided.length}`,
    `   ├─ impossible input (caller cannot emit) : ${buckets.incoherent.length}`,
    `   ├─ expected design gaps (O1 / KNOWN)     : ${buckets.expected.length}`,
    `   └─ DECISIONS OWED (newly-discovered)     : ${buckets.owed.length}`,
    ` EDD ever fired     : ${everFiredEdd}  (open question O2 — should be false until decided)`,
    renderGroup('DECISIONS OWED — handed back to compliance', buckets.owed),
    renderGroup('EXPECTED DESIGN GAPS', buckets.expected),
    `\n  (impossible-input combos omitted from the detail list — ${buckets.incoherent.length} total)`,
    '══════════════════════════════════════════════════════════════════════\n',
  ].join('\n'));
});

test('enumerates the full cartesian product', () => {
  assert.equal(total, 7 * 4 * 4 * 3 * 3 * 2);
  assert.equal(total, 2016);
});

test('coverage does not regress below the recorded floor', () => {
  assert.ok(decidedCount >= COVERAGE_FLOOR_COUNT, `coverage ${decidedCount} fell below floor ${COVERAGE_FLOOR_COUNT}`);
});

test('EDD is never silently fired (open question O2)', () => {
  assert.equal(everFiredEdd, false);
});

// Assertion 4 — RED BY DESIGN on first run. The failure body lists every real
// compliance decision still owed (coherent, UNDECIDED, not a known gap).
test('no newly-discovered gaps beyond the expected-known list', () => {
  assert.deepEqual(buckets.owed.map(key), []);
});
