/**
 * Commit 8 — high-risk-country EDD generalised to ALL country fields.
 *
 * Commit 6 flagged EDD for the person countries it edits (nationality, country
 * of birth, country of residence). This is the SAME ratified rule and the SAME
 * injectable list, asked of the company-level country fields too: registered
 * country, address country, countries of operation, and anything else the
 * schema calls a country.
 *
 * The load-bearing assertion is the last describe block: person and company
 * paths must run through ONE mechanism. If someone forks a second high-risk
 * check for company fields, `isHighRiskCountry` stops being the single gate and
 * these tests fail.
 *
 * Everything here is stubbed via setHighRiskCountries. The real MLRO list is
 * still pending, so in production this mechanism is correct and fires nothing.
 */
const { classifyChange } = require('../classifyChange');
const {
  setHighRiskCountries,
  isHighRiskCountry,
  isCountryField,
  countryValues,
  containsHighRiskCountry,
  fieldHasHighRiskCountry,
  personHasHighRiskCountry,
} = require('../highRiskCountries');

// A company row as ChangeDialogue classifies one: structural + registry-sourced
// so it reaches the policy table rather than short-circuiting on the guard.
const company = (over = {}) => ({
  fieldClass: 'structural',
  changeType: 'update',
  intent: 'genuine_update',
  registryStatus: 'reflected',
  verifiability: 'structured_registry',
  jurisdiction: 'GB',
  ...over,
});

afterEach(() => setHighRiskCountries([])); // shipped default: matches nothing

describe('country-field detection (no schema type marker — id/label heuristic)', () => {
  const countryFields = [
    { fieldId: 'registeredCountry', label: 'Registered Country' },
    { fieldId: 'country', label: 'Address Country' },
    { fieldId: 'countriesOfOperation', label: 'Countries of Operation' },
    { fieldId: 'registered_address_country', label: 'Country' },
    { fieldId: 'business_address_country', label: 'Business Address Country' },
    { fieldId: 'operating_countries', label: 'Operating Countries' },
  ];

  it.each(countryFields)('detects $fieldId', (field) => {
    expect(isCountryField(field)).toBe(true);
  });

  it('detects a field the schema has not added yet (that is the point of not hardcoding)', () => {
    expect(isCountryField({ fieldId: 'tradingAddressCountry', label: 'Trading Address Country' })).toBe(true);
  });

  it.each([
    ['businessType', 'Business Type'],
    ['city', 'City'],
    ['leiNumber', 'LEI Number'],
    ['annualRevenue', 'Annual Revenue'],
  ])('does not treat %s as a country field', (fieldId, label) => {
    expect(isCountryField({ fieldId, label })).toBe(false);
  });

  it('excludes dialling codes — "Mobile Country Code" is not a country', () => {
    // Without this, an MLRO list entry colliding with a dialling-code string
    // would flag EDD on every applicant who used it.
    expect(isCountryField({ fieldId: 'applicantMobileCountryCode', label: 'Mobile Country Code' })).toBe(false);
  });

  it('falls back to the field id when no label is supplied', () => {
    expect(isCountryField({ fieldId: 'registeredCountry' })).toBe(true);
    expect(isCountryField('countriesOfOperation')).toBe(true);
  });
});

describe('multi-value country fields', () => {
  it('splits delimited lists — one country in the list is enough', () => {
    setHighRiskCountries(['Ruritania']);
    expect(containsHighRiskCountry('UK, US, Ruritania')).toBe(true);
    expect(containsHighRiskCountry('UK, US, SG')).toBe(false);
  });

  it('handles arrays', () => {
    setHighRiskCountries(['Ruritania']);
    expect(containsHighRiskCountry(['UK', 'Ruritania'])).toBe(true);
    expect(containsHighRiskCountry(['UK', 'SG'])).toBe(false);
  });

  it('yields nothing for structured/object values rather than stringifying a guess', () => {
    expect(countryValues({ shareholders: [] })).toEqual([]);
    expect(countryValues(null)).toEqual([]);
  });

  it('matches case- and space-insensitively, like the person path', () => {
    setHighRiskCountries(['Ruritania']);
    expect(containsHighRiskCountry('  ruritania ')).toBe(true);
  });
});

describe('EDD flag on company country fields', () => {
  it('company country field corrected to a high-risk country → EDD flag set', () => {
    setHighRiskCountries(['Ruritania']);
    const field = { fieldId: 'countriesOfOperation', label: 'Countries of Operation' };
    const highRiskCountry = fieldHasHighRiskCountry(field, 'UK, Ruritania');
    expect(highRiskCountry).toBe(true);
    expect(classifyChange(company({ highRiskCountry })).eddFlag).toBe(true);
  });

  it('company country field NOT on the list → no flag', () => {
    setHighRiskCountries(['Ruritania']);
    const field = { fieldId: 'registeredCountry', label: 'Registered Country' };
    const highRiskCountry = fieldHasHighRiskCountry(field, 'United Kingdom');
    expect(highRiskCountry).toBe(false);
    expect(classifyChange(company({ highRiskCountry })).eddFlag).toBe(false);
  });

  it('a NON-country field holding a high-risk-looking string is never flagged', () => {
    setHighRiskCountries(['Ruritania']);
    expect(fieldHasHighRiskCountry({ fieldId: 'tradeName', label: 'Trade Name' }, 'Ruritania')).toBe(false);
  });

  it('reads the field own value when none is passed (the found-value case)', () => {
    setHighRiskCountries(['Ruritania']);
    expect(fieldHasHighRiskCountry({ fieldId: 'registeredCountry', value: 'Ruritania' })).toBe(true);
  });

  it('flags EITHER WAY — it does not depend on the change producing a document', () => {
    setHighRiskCountries(['Ruritania']);
    // The verifiability guard short-circuits before the policy table; the flag
    // must still land, which is why the post-step sits at the engine's exit.
    const guarded = classifyChange(company({
      fieldClass: 'generic',
      verifiability: 'unverified_web',
      highRiskCountry: true,
    }));
    expect(guarded.matchedRule).toBe('VERIFIABILITY-GUARD');
    expect(guarded.eddFlag).toBe(true);

    // Same for the PEP short-circuit and the UNDECIDED fallthrough.
    expect(classifyChange(company({ fieldClass: 'pep', highRiskCountry: true })).eddFlag).toBe(true);
    const undecided = classifyChange(company({ changeType: 'nonsense', highRiskCountry: true }));
    expect(undecided.decided).toBe(false);
    expect(undecided.eddFlag).toBe(true);
  });

  it('flag only — never a document, never an escalation of its own (CD-03)', () => {
    setHighRiskCountries(['Ruritania']);
    const base = classifyChange(company());
    const flagged = classifyChange(company({ highRiskCountry: true }));
    expect(flagged.eddFlag).toBe(true);
    // Identical in every other respect: EDD adds a flag, not a workflow.
    expect({ ...flagged, eddFlag: false }).toEqual({ ...base, eddFlag: false });
  });
});

describe('empty list — the shipped, pre-MLRO state', () => {
  it('flags nothing anywhere: company, person, or raw check', () => {
    setHighRiskCountries([]);
    expect(isHighRiskCountry('Ruritania')).toBe(false);
    expect(containsHighRiskCountry('UK, Ruritania, US')).toBe(false);
    expect(fieldHasHighRiskCountry({ fieldId: 'registeredCountry' }, 'Ruritania')).toBe(false);
    expect(personHasHighRiskCountry({ nationality: 'Ruritania' })).toBe(false);
    expect(classifyChange(company({ highRiskCountry: false })).eddFlag).toBe(false);
    expect(classifyChange({ personScope: true, personType: 'ubo', attribute: 'nationality' }).eddFlag).toBe(false);
  });
});

describe('ONE mechanism — person (commit 6) and company (commit 8) share it', () => {
  it('both paths resolve through the same injectable list', () => {
    setHighRiskCountries(['Ruritania']);
    expect(personHasHighRiskCountry({ nationality: 'Ruritania' })).toBe(true);
    expect(fieldHasHighRiskCountry({ fieldId: 'registeredCountry' }, 'Ruritania')).toBe(true);

    // Swap the list and BOTH must change together. Two parallel mechanisms
    // could not both follow one injection.
    setHighRiskCountries(['Elbonia']);
    expect(personHasHighRiskCountry({ nationality: 'Ruritania' })).toBe(false);
    expect(fieldHasHighRiskCountry({ fieldId: 'registeredCountry' }, 'Ruritania')).toBe(false);
    expect(personHasHighRiskCountry({ nationality: 'Elbonia' })).toBe(true);
    expect(fieldHasHighRiskCountry({ fieldId: 'registeredCountry' }, 'Elbonia')).toBe(true);
  });

  it('the engine applies the flag identically for person and company input', () => {
    const asPerson = classifyChange({
      personScope: true, personType: 'ubo', attribute: 'nationality', highRiskCountry: true,
    });
    const asCompany = classifyChange(company({ highRiskCountry: true }));
    expect(asPerson.eddFlag).toBe(true);
    expect(asCompany.eddFlag).toBe(true);
  });

  it('person commit-6 flags still fire and are not double-counted by commit 8', () => {
    setHighRiskCountries(['Ruritania']);
    // Commit 6 behaviour, unchanged: the person path still flags and still
    // produces its CD-03 document.
    const r = classifyChange({
      personScope: true, personType: 'ubo', attribute: 'nationality', highRiskCountry: true,
    });
    expect(r.eddFlag).toBe(true);
    expect(r.docType).toBe('Proof of Identity');
    expect(r.matchedRule).toBe('PERSON-NATIONALITY-UBO');

    // And the company detector cannot claim a person attribute: composite
    // person fieldIds carry no country token, so commit 8 never sees them.
    expect(isCountryField({ fieldId: 'ubo::sh_1::nationality' })).toBe(false);
    expect(isCountryField({ fieldId: 'ubo::sh_1::residential_address' })).toBe(false);
    expect(fieldHasHighRiskCountry({ fieldId: 'ubo::sh_1::nationality' }, 'Ruritania')).toBe(false);
  });
});
