/**
 * characterization.pure.test.js — golden-value tests for the pure modules
 * extracted from App.js during the modular-architecture refactor. Values were
 * captured from the pre-refactor App.js source; these tests pin the extracted
 * modules to that behaviour.
 */
import { API_PRICING, calcCostUsd, buildCostSummary } from '../utils/costs';
import {
  COUNTRIES,
  OWNERSHIP_ID_TO_DRS,
  MANUAL_FORM_URL,
} from '../constants/appConstants';
import { C } from '../constants/theme';
import {
  DOC_TYPES,
  initialUploadedDocs,
  docTypesForEntity,
  buildPhase1Msgs,
} from '../constants/docTypes';
import { LOADER_MSGS, DOC_LOADER_MSGS } from '../constants/loaderMessages';
import { mapExtractedKey, normalizeResearchFieldIds } from '../utils/extractionMapping';
import { buildDemoSelfSourceResults, TEST_DATA, DUMMY_RESEARCH_VALUES } from '../demo/demoData';
import { buildLocalDefaultConfig } from '../config/localDefaultConfig';
import { formatFetchedAt } from '../utils/files';

test('calcCostUsd prices tokens at $3/$15 per Mtok', () => {
  expect(API_PRICING.model).toBe('claude-sonnet-4-20250514');
  expect(calcCostUsd(1_000_000, 1_000_000)).toBe(18);
  expect(calcCostUsd(0, 0)).toBe(0);
  expect(calcCostUsd(500_000, 200_000)).toBeCloseTo(1.5 + 3.0, 10);
});

test('buildCostSummary aggregates only phases that ran', () => {
  const tracker = {
    docSearch: { inputTokens: 100, outputTokens: 10, apiCallCount: 2 },
    researchPass1: { inputTokens: 200, outputTokens: 20 },
    researchPass2: null,
    docExtraction: null,
  };
  const s = buildCostSummary(tracker, 'Acme', 'Corporate', 'private_limited', null);
  expect(s.totals.inputTokens).toBe(300);
  expect(s.totals.outputTokens).toBe(30);
  expect(s.totals.totalTokens).toBe(330);
  expect(s.totals.apiCallCount).toBe(3);
  expect(s.totals.phasesRan).toBe(2);
  expect(s.coverage).toBeNull();
  expect(s.breakdown.researchPass2).toBeNull();
});

test('country list and DRS ownership mapping keep pre-refactor values', () => {
  expect(COUNTRIES).toHaveLength(46);
  expect(COUNTRIES[0]).toEqual({ code: 'GB', name: 'United Kingdom' });
  expect(OWNERSHIP_ID_TO_DRS.public_listed).toBe('Public Listed Company');
  expect(OWNERSHIP_ID_TO_DRS.sole_trader).toBe('Sole Trader');
  expect(OWNERSHIP_ID_TO_DRS.other).toBe('Private Limited');
  expect(MANUAL_FORM_URL).toBe('https://example.com/apply');
  expect(C.brandBlue).toBe('#1a3a4a');
});

test('DOC_TYPES catalogue is unchanged', () => {
  expect(DOC_TYPES.map(d => d.key)).toEqual([
    'wolfsberg', 'certificate', 'licence', 'annualReport',
    'financialStatements', 'orgChart', 'amlPolicy',
  ]);
  expect(DOC_TYPES[0].returnsObject).toBe(true);
  expect(initialUploadedDocs()).toEqual(Object.fromEntries(DOC_TYPES.map(d => [d.key, null])));
});

test('docTypesForEntity filters by entity without config and merges with config', () => {
  expect(docTypesForEntity('Corporate', null).map(d => d.key)).toEqual([
    'certificate', 'annualReport', 'financialStatements', 'orgChart',
  ]);
  expect(docTypesForEntity('FI', null)).toHaveLength(7);
  const cfg = { documents: { Corporate: [
    { id: 'orgChart', name: 'Structure Chart', sortOrder: 1 },
    { id: 'certificate', sortOrder: 2 },
    { id: 'unknown-doc', sortOrder: 3 },
    { id: 'annualReport', active: false, sortOrder: 4 },
  ] } };
  const merged = docTypesForEntity('Corporate', cfg);
  expect(merged.map(d => d.key)).toEqual(['orgChart', 'certificate']);
  expect(merged[0].label).toBe('Structure Chart');
});

test('buildPhase1Msgs lists only uploaded docs, with fallback', () => {
  expect(buildPhase1Msgs({})).toEqual(['Reading your documents…']);
  const docs = { certificate: {}, orgChart: {} };
  expect(buildPhase1Msgs(docs)).toEqual([
    'Reading Certificate of Incorporation…',
    'Reading Ownership Structure / Org Chart…',
  ]);
});

test('loader message lists keep pre-refactor lengths', () => {
  expect(LOADER_MSGS).toHaveLength(8);
  expect(DOC_LOADER_MSGS).toHaveLength(4);
});

test('mapExtractedKey routes generic extraction keys per flow', () => {
  expect(mapExtractedKey('fi', 'legal_name')).toBe('business_name');
  expect(mapExtractedKey('fi', 'legal_form')).toBeNull();
  expect(mapExtractedKey('corporate', 'legal_name')).toBe('tradeName');
  expect(mapExtractedKey('corporate', 'parent_company')).toBe('uboAnalysis');
  expect(mapExtractedKey('corporate', 'not_a_key')).toBeNull();
  expect(mapExtractedKey('nope', 'legal_name')).toBeNull();
});

test('normalizeResearchFieldIds passes through when schema missing', () => {
  const items = [{ field: 'x', value: 1 }];
  expect(normalizeResearchFieldIds(items, null)).toBe(items);
  expect(normalizeResearchFieldIds('not-array', {})).toBe('not-array');
});

test('demo self-source results keep the synthetic sentinel identity', () => {
  const r = buildDemoSelfSourceResults('Acme Holdings');
  expect(r.success).toBe(true);
  expect(r.selfSourcedFields.business_name.value).toBe('Acme Holdings');
  expect(r.selfSourcedFields.registration_number.value).toBe('00000000');
  expect(r.selfSourcedFields.registered_address_line1.value).toBe('1 Test Street');
  expect(r.summary).toEqual({ retrieved: 4, unverified: 0, failed: 0, manualRequired: 1, total: 5 });
  expect(r.results).toHaveLength(5);
});

test('demo fixtures keep their pre-refactor keys', () => {
  expect(TEST_DATA.applicantFirstName).toBe('Jane');
  expect(DUMMY_RESEARCH_VALUES.businessRegistrationNumber).toBe('12345678');
  expect(JSON.parse(DUMMY_RESEARCH_VALUES.directors)).toHaveLength(3);
});

test('local fallback config covers all entity:jurisdiction schemas', () => {
  const cfg = buildLocalDefaultConfig();
  expect(Object.keys(cfg.schemas).sort()).toEqual([
    'Corporate:GB', 'Corporate:SG', 'Direct:GB', 'Direct:SG',
    'FI:GB', 'FI:SG', 'Platform:GB', 'Platform:SG',
  ]);
  expect(cfg.company.name).toBe('Demo');
  expect(cfg.licences.map(l => l.id)).toEqual(['GB', 'SG']);
});

test('formatFetchedAt returns empty string for bad input', () => {
  expect(formatFetchedAt(null)).toBe('');
  expect(formatFetchedAt('not-a-date')).toBe('');
  expect(formatFetchedAt('2026-01-05T10:30:00Z')).not.toBe('');
});
