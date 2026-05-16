// Client-side seed builder. Used by AdminRoot as a last-resort fallback when
// /api/config is unreachable. The canonical seed lives in lib/seedConfig.js
// (server) and is what gets persisted to KV / filesystem; this mirror exists
// so the admin UI renders something coherent even when the API is down.
//
// Research/gap schemas are intentionally left empty here — the customer flow
// (src/App.js) carries its own hardcoded schemas as fallback, and the admin
// Step 4 (schemas) is a Session-B placeholder in this build.

export function buildDefaultConfig(tenantId = "nium") {
  const now = new Date().toISOString();
  const blankSchema = () => ({ researchFields: [], gapFields: [] });

  return {
    _tenantId: tenantId,
    _version: 0,
    _seededAt: now,
    _isDefault: true,

    company: {
      name: "Nium",
      logo: null,
      manualFormUrl: "https://nium.com/apply",
      privacyPolicyUrl: "",
      submissionWebhookUrl: "",
      submissionEmail: "",
      primaryContactName: "",
      primaryContactEmail: "",
    },

    licences: [
      { id: "GB", jurisdictionCode: "GB", jurisdictionName: "United Kingdom",
        licenceType: "Payment Institution", licenceNumber: "",
        regulatoryAuthority: "FCA", countriesCovered: ["GB"], isPrimary: false },
      { id: "SG", jurisdictionCode: "SG", jurisdictionName: "Singapore",
        licenceType: "Major Payment Institution", licenceNumber: "",
        regulatoryAuthority: "MAS", countriesCovered: [], isPrimary: true },
    ],

    routingPolicy: "regional",

    entityTypes: [
      { id: "FI", label: "Financial Institution",
        description: "Banks, payment institutions, EMIs and other regulated financial entities",
        icon: "🏦", active: true, sortOrder: 1, associatedLicenceIds: ["GB", "SG"] },
      { id: "Platform", label: "Platform",
        description: "Technology platforms and marketplaces",
        icon: "💻", active: true, sortOrder: 2, associatedLicenceIds: ["GB", "SG"] },
      { id: "Direct", label: "Direct",
        description: "Direct business customers",
        icon: "🏢", active: true, sortOrder: 3, associatedLicenceIds: ["GB", "SG"] },
      { id: "Corporate", label: "Corporate",
        description: "Corporate and commercial entities",
        icon: "🏛", active: true, sortOrder: 4, associatedLicenceIds: ["GB", "SG"] },
    ],

    schemas: {
      "Corporate:GB": blankSchema(),
      "Corporate:SG": blankSchema(),
      "FI:GB":        blankSchema(),
      "FI:SG":        blankSchema(),
      "Platform:GB":  blankSchema(),
      "Platform:SG":  blankSchema(),
      "Direct:GB":    blankSchema(),
      "Direct:SG":    blankSchema(),
    },

    sourceTiers: {
      primary: [
        { name: "Companies House",   pattern: "companieshouse",      jurisdiction: "GB" },
        { name: "FCA Register",      pattern: "fca.org.uk",          jurisdiction: "GB" },
        { name: "ACRA BizFile+",     pattern: "acra.gov.sg",         jurisdiction: "SG" },
        { name: "MAS Directory",     pattern: "mas.gov.sg",          jurisdiction: "SG" },
        { name: "SEC EDGAR",         pattern: "sec.gov",             jurisdiction: "US" },
        { name: "ASIC",              pattern: "asic.gov.au",         jurisdiction: "AU" },
        { name: "Government domains",pattern: ".gov",                jurisdiction: null },
        { name: "LSE",               pattern: "londonstockexchange", jurisdiction: "GB" },
        { name: "SGX",               pattern: "sgx.com",             jurisdiction: "SG" },
        { name: "NYSE",              pattern: "nyse.com",            jurisdiction: "US" },
        { name: "NASDAQ",            pattern: "nasdaq.com",          jurisdiction: "US" },
      ],
      secondary: [
        { name: "LinkedIn",         pattern: "linkedin.com" },
        { name: "Wikipedia",        pattern: "wikipedia.org" },
        { name: "Crunchbase",       pattern: "crunchbase.com" },
        { name: "Bloomberg",        pattern: "bloomberg.com" },
        { name: "Reuters",          pattern: "reuters.com" },
        { name: "Company website",  pattern: "own website" },
      ],
      documentsArePrimary: true,
    },

    documents: {
      FI: [], Corporate: [], Platform: [], Direct: [],
    },
  };
}

export default buildDefaultConfig;
