/**
 * CD-03 (ratified 26 Jul 2026) — person-scoped correction rules.
 *
 * The headline assertion this whole commit rests on: the SAME attribute
 * correction produces a document for a UBO and NO document for a director-only
 * person, because person type — not the attribute — keys the document rule.
 */
const { classifyChange } = require('../classifyChange');
const {
  setHighRiskCountries,
  isHighRiskCountry,
  personHasHighRiskCountry,
} = require('../highRiskCountries');

const person = (over = {}) => ({ personScope: true, personType: 'ubo', ...over });
const director = (over = {}) => person({ personType: 'director', ...over });

afterEach(() => setHighRiskCountries([])); // shipped default: matches nothing

describe('CD-03 headline — person type keys the document, not the attribute', () => {
  const attrs = [
    ['dob', 'Proof of Identity'],
    ['nationality', 'Proof of Identity'],
    ['residential_address', 'Proof of Address'],
  ];

  it.each(attrs)('UBO correcting %s → %s', (attribute, docType) => {
    const r = classifyChange(person({ attribute }));
    expect(r.workflow).toBe('doc_required');
    expect(r.docType).toBe(docType);
    expect(r.decided).toBe(true);
  });

  it.each(attrs)('director-only correcting %s → accepted, NO document', (attribute) => {
    const r = classifyChange(director({ attribute }));
    expect(r.workflow).toBe('accept_silent');
    expect(r.docType).toBeNull();
    expect(r.silent).toBe(true);
    expect(r.decided).toBe(true);
  });
});

describe('CD-03 — country of birth', () => {
  it('never asks for its own document (POI carries it), for either person type', () => {
    for (const p of [person(), director()]) {
      const r = classifyChange({ ...p, attribute: 'country_of_birth' });
      expect(r.docType).toBeNull();
      expect(r.workflow).toBe('accept_silent');
    }
  });

  it('is a separate signal from nationality — it does not fold into it', () => {
    const cob = classifyChange(person({ attribute: 'country_of_birth' }));
    const nat = classifyChange(person({ attribute: 'nationality' }));
    expect(cob.matchedRule).toBe('PERSON-COUNTRY-OF-BIRTH');
    expect(nat.matchedRule).toBe('PERSON-NATIONALITY-UBO');
  });
});

describe('CD-03 — the name three-way question', () => {
  it('typo (AI error, same person) → accept, no document', () => {
    const r = classifyChange(person({ attribute: 'name', nameCase: 'typo' }));
    expect(r.workflow).toBe('accept_silent');
    expect(r.docType).toBeNull();
  });

  it('legal change, UBO → POI (current name) plus the ownership chart', () => {
    expect(classifyChange(person({ attribute: 'name', nameCase: 'legal_change' })))
      .toMatchObject({ workflow: 'doc_required', docType: 'Proof of Identity' });
    // the companion list document, emitted as its own person-attribute event
    expect(classifyChange(person({ attribute: 'name_list' })))
      .toMatchObject({ workflow: 'doc_required', docType: 'Ownership Chart' });
  });

  it('legal change, director-only → list of directors only, no POI', () => {
    const r = classifyChange(director({ attribute: 'name', nameCase: 'legal_change' }));
    expect(r).toMatchObject({ workflow: 'doc_required', docType: 'List of Directors' });
    expect(r.docType).not.toBe('Proof of Identity');
  });

  it('never asks for a name-change certificate', () => {
    const all = ['typo', 'legal_change'].map((nameCase) =>
      classifyChange(person({ attribute: 'name', nameCase }))
    );
    expect(all.map((r) => r.docType)).not.toContain('Name Change Certificate');
  });

  it('wrong person resolves through the removal flow, not a name edit', () => {
    // "This isn't the right person" is a removal (+ list doc); the replacement
    // is commit 7. The caller routes it to attribute 'removal'.
    expect(classifyChange(person({ attribute: 'removal' })))
      .toMatchObject({ workflow: 'doc_required', docType: 'Ownership Chart' });
  });
});

describe('CD-03 — removal requests the list document, keyed by person type', () => {
  it('director → list of directors', () => {
    expect(classifyChange(director({ attribute: 'removal' })).docType).toBe('List of Directors');
  });

  it('UBO → ownership chart', () => {
    expect(classifyChange(person({ attribute: 'removal' })).docType).toBe('Ownership Chart');
  });

  it('the document request IS the analyst trigger — no separate flag', () => {
    const r = classifyChange(director({ attribute: 'removal' }));
    expect(r.workflow).toBe('doc_required');
    expect(r.escalation).toBe(false); // requesting the doc is the review trigger
  });
});

describe('CD-03 — PEP is add-only', () => {
  it('PEP = yes → Source of Wealth + EDD flag', () => {
    const r = classifyChange(person({ attribute: 'pep', pepValue: 'yes' }));
    expect(r.workflow).toBe('doc_required');
    expect(r.docType).toBe('Source of Wealth');
    expect(r.eddFlag).toBe(true);
  });

  it('PEP = no → accepted, no document', () => {
    const r = classifyChange(person({ attribute: 'pep', pepValue: 'no' }));
    expect(r.workflow).toBe('accept_silent');
    expect(r.docType).toBeNull();
    expect(r.eddFlag).toBe(false);
  });

  it('applies to a director-only person too — PEP is not person-type gated', () => {
    expect(classifyChange(director({ attribute: 'pep', pepValue: 'yes' })).docType)
      .toBe('Source of Wealth');
  });
});

describe('CD-03 — EDD is a flag only, on an injectable list', () => {
  it('does not fire by default: the shipped list is empty', () => {
    expect(isHighRiskCountry('Neverland')).toBe(false);
    expect(classifyChange(person({ attribute: 'nationality', highRiskCountry: false })).eddFlag).toBe(false);
  });

  it('flags EDD for a high-risk nationality, country of birth or residence', () => {
    setHighRiskCountries(['Neverland']);
    expect(isHighRiskCountry('neverland')).toBe(true); // case/space-insensitive
    for (const attribute of ['nationality', 'country_of_birth', 'residential_address']) {
      expect(classifyChange(person({ attribute, highRiskCountry: true })).eddFlag).toBe(true);
    }
  });

  it('flags EDD either way — including where the attribute asks for no document', () => {
    const r = classifyChange(director({ attribute: 'nationality', highRiskCountry: true }));
    expect(r.docType).toBeNull();      // director-only: still no document
    expect(r.eddFlag).toBe(true);      // but the EDD flag still fires
  });

  it('never triggers an EDD collection flow — flag only', () => {
    const r = classifyChange(person({ attribute: 'nationality', highRiskCountry: true }));
    expect(r.workflow).not.toBe('edd');
  });

  it('reads all three person country fields', () => {
    setHighRiskCountries(['Neverland']);
    expect(personHasHighRiskCountry({ nationality: 'Neverland' })).toBe(true);
    expect(personHasHighRiskCountry({ country_of_birth: 'Neverland' })).toBe(true);
    expect(personHasHighRiskCountry({ residential_country: 'Neverland' })).toBe(true);
    expect(personHasHighRiskCountry({ nationality: 'British' })).toBe(false);
  });
});

describe('CD-03 — role changes', () => {
  it('a non-removal role change is accepted silently (director → secretary)', () => {
    const r = classifyChange(person({ attribute: 'role' }));
    expect(r.workflow).toBe('accept_silent');
    expect(r.silent).toBe(true);
    expect(r.docType).toBeNull();
  });
});

describe('CD-03 — adding a person (commit 7)', () => {
  it('adding a director requests the List of Directors', () => {
    const r = classifyChange(director({ attribute: 'added' }));
    expect(r).toMatchObject({ workflow: 'doc_required', docType: 'List of Directors' });
    expect(r.matchedRule).toBe('PERSON-ADDED-DIRECTOR');
  });

  it('adding a UBO requests the Ownership Chart', () => {
    const r = classifyChange(person({ attribute: 'added' }));
    expect(r).toMatchObject({ workflow: 'doc_required', docType: 'Ownership Chart' });
    expect(r.matchedRule).toBe('PERSON-ADDED-UBO');
  });

  it('an added UBO also needs POI and POA', () => {
    expect(classifyChange(person({ attribute: 'added_poi' })))
      .toMatchObject({ workflow: 'doc_required', docType: 'Proof of Identity' });
    expect(classifyChange(person({ attribute: 'added_poa' })))
      .toMatchObject({ workflow: 'doc_required', docType: 'Proof of Address' });
  });

  it('an added director-only person needs NO POI or POA — identification only', () => {
    for (const attribute of ['added_poi', 'added_poa']) {
      const r = classifyChange(director({ attribute }));
      expect(r.workflow).toBe('accept_silent');
      expect(r.docType).toBeNull();
    }
  });

  it('the list document IS the analyst trigger — no separate flag', () => {
    const r = classifyChange(director({ attribute: 'added' }));
    expect(r.workflow).toBe('doc_required');
    expect(r.escalation).toBe(false);
  });

  it('an added person declared PEP reuses the add-only PEP rule', () => {
    const r = classifyChange(person({ attribute: 'pep', pepValue: 'yes' }));
    expect(r).toMatchObject({ docType: 'Source of Wealth', eddFlag: true });
  });

  it('a high-risk country on an added person still only sets the EDD flag', () => {
    setHighRiskCountries(['Ruritania']);
    const r = classifyChange(person({ attribute: 'added', highRiskCountry: true }));
    expect(r.eddFlag).toBe(true);
    expect(r.docType).toBe('Ownership Chart'); // no extra EDD document
    expect(r.workflow).not.toBe('edd');
  });

  it('uses add-specific rule ids, so the audit trail is not misleading', () => {
    // A correction rule firing on an ADDED person would misinform an analyst.
    expect(classifyChange(person({ attribute: 'added_poi' })).matchedRule).toBe('PERSON-ADDED-POI-UBO');
    expect(classifyChange(person({ attribute: 'dob' })).matchedRule).toBe('PERSON-DOB-UBO');
  });
});

describe('the two deliberate UNDECIDED sub-rules (need real ownership data)', () => {
  it('ownership %: crossing is UNKNOWN on stub data → UNDECIDED, inert', () => {
    const r = classifyChange(person({ attribute: 'ownership_pct', thresholdCrossing: 'unknown' }));
    expect(r.workflow).toBe('UNDECIDED');
    expect(r.decided).toBe(false);
    expect(r.docType).toBeNull();
    expect(r.silent).toBe(true); // no customer-facing consequence
  });

  it('ownership %: the ratified rules exist for when real data lands', () => {
    expect(classifyChange(person({ attribute: 'ownership_pct', thresholdCrossing: 'crossed_below' })))
      .toMatchObject({ workflow: 'analyst_review', decided: true });
    expect(classifyChange(person({ attribute: 'ownership_pct', thresholdCrossing: 'none' })))
      .toMatchObject({ workflow: 'accept_silent', decided: true });
  });

  it('pseudo-UBO records UNDECIDED for every attribute', () => {
    for (const attribute of ['dob', 'nationality', 'residential_address', 'removal']) {
      const r = classifyChange({ personScope: true, personType: 'pseudo_ubo', attribute });
      expect(r.workflow).toBe('UNDECIDED');
      expect(r.decided).toBe(false);
      expect(r.docType).toBeNull();
    }
  });

  it('an attribute CD-03 does not cover falls through to UNDECIDED, never a guess', () => {
    const r = classifyChange(person({ attribute: 'favourite_colour' }));
    expect(r.workflow).toBe('UNDECIDED');
    expect(r.decided).toBe(false);
    expect(r.matchedRule).toBeNull();
  });
});

describe('company-level classification is untouched by the person path', () => {
  it('still applies the PEP hard rule to the company PEP field', () => {
    const r = classifyChange({ fieldClass: 'pep', changeType: 'correct', verifiability: 'structured_registry' });
    expect(r.matchedRule).toBe('PEP-SHORTCIRCUIT');
    expect(r.workflow).toBe('escalation');
    expect(r.docType).toBeNull();
  });

  it('still applies the verifiability guard to non-registry company fields', () => {
    const r = classifyChange({ fieldClass: 'address', changeType: 'update', verifiability: 'unverified' });
    expect(r.matchedRule).toBe('VERIFIABILITY-GUARD');
  });

  it('still routes a registry address change to its document rule', () => {
    const r = classifyChange({
      fieldClass: 'address', changeType: 'update', intent: 'genuine_update',
      registryStatus: 'not_reflected', verifiability: 'structured_registry',
    });
    expect(r).toMatchObject({ workflow: 'doc_required', docType: 'Notice of Change of Address' });
  });

  it('person rules are unreachable without the personScope marker', () => {
    // An attribute key alone must never activate CD-03 on a company field.
    const r = classifyChange({ fieldClass: 'generic', attribute: 'dob', personType: 'ubo', verifiability: 'structured_registry', changeType: 'correct', intent: 'ai_correction' });
    expect(r.docType).toBeNull();
    expect(String(r.matchedRule)).not.toMatch(/^PERSON-/);
  });
});
