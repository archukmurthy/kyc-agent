/**
 * characterization.workflows.test.js — pins the Phase 3 workflow modules to
 * the pre-refactor behaviour captured from App.js.
 */
import {
  mapToDocAgentOwnershipType,
  preCheckDocForOwnershipType,
} from '../workflows/documentWorkflow';
import {
  genUUID,
  isCorporateStakeholder,
  APPLICANT_FALLBACK_FIELDS,
  getApplicantCandidates,
  buildApplicantProvenance,
} from '../workflows/applicantWorkflow';

test('mapToDocAgentOwnershipType covers all four quadrants', () => {
  expect(mapToDocAgentOwnershipType('public_listed', 'FI', false)).toBe('public_fi');
  expect(mapToDocAgentOwnershipType('private_limited', 'FI', false)).toBe('fi_only');
  expect(mapToDocAgentOwnershipType('public_listed', 'Corporate', false)).toBe('public_only');
  expect(mapToDocAgentOwnershipType('private_limited', 'Corporate', false)).toBe('corporate');
  // ownership-implied FI and effectivelyListed override
  expect(mapToDocAgentOwnershipType('payment_institution', 'Corporate', false)).toBe('fi_only');
  expect(mapToDocAgentOwnershipType('private_limited', 'Corporate', true)).toBe('public_only');
});

test('preCheckDocForOwnershipType keeps the ops-confirmed mapping', () => {
  expect(preCheckDocForOwnershipType('trust')).toBe('Trust deed');
  expect(preCheckDocForOwnershipType('llp')).toBe('Partnership agreement');
  expect(preCheckDocForOwnershipType('general_partnership')).toBe('Partnership agreement');
  expect(preCheckDocForOwnershipType('sole_trader')).toBe('Tax returns');
  expect(preCheckDocForOwnershipType('private_limited')).toBe('Business registration documents');
  expect(preCheckDocForOwnershipType('anything_else')).toBe('Constitutional / registration document');
});

test('genUUID returns RFC4122 v4 shaped ids', () => {
  expect(genUUID()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
});

test('isCorporateStakeholder keys off is_company only', () => {
  expect(isCorporateStakeholder({ is_company: true })).toBe(true);
  expect(isCorporateStakeholder({ full_name: 'Jane Doe' })).toBe(false);
  expect(isCorporateStakeholder(null)).toBe(false);
});

test('APPLICANT_FALLBACK_FIELDS keeps the 10 pre-refactor fields', () => {
  expect(APPLICANT_FALLBACK_FIELDS.map(f => f.field)).toEqual([
    'applicantFirstName', 'applicantLastName', 'applicantEmail',
    'applicantMobileCountryCode', 'applicantMobile', 'applicantDateOfBirth',
    'applicantNationality', 'applicantBirthCountry', 'applicantPosition',
    'applicantIsPEP',
  ]);
});

const research = {
  found: [
    {
      field: 'directors',
      stakeholders: [
        { id: 'd1', full_name: 'John Smith', role: 'CEO', nationality: 'British' },
        { id: 'd2', full_name: 'Companies House', role: 'Registry' }, // fails looksLikeRealName-style checks? kept: real-name heuristic decides
        { id: 'd3', full_name: 'ACME Group Holdings Ltd', role: 'Parent', is_company: true },
      ],
    },
    {
      field: 'ubo_names',
      stakeholders: [
        { id: 'u1', full_name: 'John Smith', share_percentage: 40 },
        { id: 'u2', full_name: 'Jane Doe', share_percentage: 35 },
      ],
    },
  ],
};

test('getApplicantCandidates merges directors + UBOs, dedupes by name, skips companies', () => {
  const c = getApplicantCandidates(research, null);
  const names = c.map(x => x.name);
  expect(names).toContain('John Smith');
  expect(names).toContain('Jane Doe');
  // corporate parent must never be an applicant candidate
  expect(names).not.toContain('ACME Group Holdings Ltd');
  // John Smith appears once (director wins over UBO duplicate)
  expect(names.filter(n => n === 'John Smith')).toHaveLength(1);
  expect(c.find(x => x.name === 'John Smith').type).toBe('director');
  expect(c.find(x => x.name === 'Jane Doe').type).toBe('ubo');
});

test('getApplicantCandidates falls back to dossier stakeholders when no research', () => {
  const c = getApplicantCandidates(null, [
    { id: 's1', full_name: 'Mark Lee', role: 'CTO' },
    { id: 's2', full_name: 'ACME Ltd', is_company: true },
  ]);
  expect(c.map(x => x.name)).toEqual(['Mark Lee']);
});

test('buildApplicantProvenance classifies accepted / overridden / provided', () => {
  const provenance = buildApplicantProvenance({
    applicantSelectedPerson: { id: 'd1', source: 'Companies House', sourceTier: 'tier1' },
    applicantAgentValues: {
      applicantFirstName: 'John',
      applicantLastName: 'Smith',
      applicantNationality: 'British',
    },
    gapValues: {
      applicantFirstName: 'John',      // matches agent → accepted
      applicantLastName: 'Smythe',     // changed → overridden
      applicantEmail: 'j@x.com',       // no agent value → provided
    },
  });
  const by = Object.fromEntries(provenance.map(p => [p.fieldId, p]));
  expect(by.applicantFirstName.customerAction).toBe('accepted');
  expect(by.applicantLastName.customerAction).toBe('overridden');
  expect(by.applicantLastName.overriddenAt).not.toBeNull();
  expect(by.applicantEmail.customerAction).toBe('provided');
  // agent value with no customer edit counts as accepted
  expect(by.applicantNationality.customerAction).toBe('accepted');
});

test('buildApplicantProvenance with no selected person marks everything provided', () => {
  const provenance = buildApplicantProvenance({
    applicantSelectedPerson: null,
    applicantAgentValues: {},
    gapValues: { applicantFirstName: 'Ada', applicantEmail: 'a@b.co' },
  });
  expect(provenance.every(p => p.customerAction === 'provided')).toBe(true);
  expect(provenance.map(p => p.fieldId).sort()).toEqual(['applicantEmail', 'applicantFirstName']);
});
