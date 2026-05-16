// Build the default tenant config from the seed schemas. Used by api/config.js
// when a tenant has no stored config yet, and re-used by the React app
// (via the same shape returned from the API) for offline fallback.

const { UK_SCHEMA, SG_SCHEMA, UK_FI_SCHEMA, SG_FI_SCHEMA } = require("./seedSchemas");

const fiDocs = [
  { id: "wolfsberg", name: "Wolfsberg Questionnaire (CBDDQ/FCCQ)",
    helperText: "Completed and signed CBDDQ or FCCQ. Extracts ~40 AML and compliance fields automatically.",
    icon: "📋", acceptedTypes: ["pdf"], required: false, aiExtraction: true,
    isWolfsbergCBDDQ: false, isWolfsbergFCCQ: false, isWolfsberg: true, sortOrder: 1, active: true },
  { id: "certificate", name: "Certificate of Incorporation",
    helperText: "Issued by Companies House, ACRA, or equivalent registry.",
    icon: "🏛", acceptedTypes: ["pdf"], required: false, aiExtraction: true,
    isWolfsberg: false, sortOrder: 2, active: true },
  { id: "licence", name: "Regulatory Licence / Authorisation",
    helperText: "FCA authorisation, MAS licence, or equivalent.",
    icon: "✅", acceptedTypes: ["pdf"], required: false, aiExtraction: true,
    isWolfsberg: false, sortOrder: 3, active: true },
  { id: "annualReport", name: "Annual Report",
    helperText: "Most recent published annual report.",
    icon: "📊", acceptedTypes: ["pdf"], required: false, aiExtraction: true,
    isWolfsberg: false, sortOrder: 4, active: true },
  { id: "financialStatements", name: "Audited Financial Statements",
    helperText: "Alternative to annual report for private institutions.",
    icon: "💰", acceptedTypes: ["pdf"], required: false, aiExtraction: true,
    isWolfsberg: false, sortOrder: 5, active: true },
  { id: "orgChart", name: "Ownership Structure / Org Chart",
    helperText: "Corporate structure showing UBOs and shareholding.",
    icon: "🏢", acceptedTypes: ["pdf", "image"], required: false, aiExtraction: true,
    isWolfsberg: false, sortOrder: 6, active: true },
  { id: "amlPolicy", name: "AML Policy & Procedures",
    helperText: "Your institution's AML/CTF policy document.",
    icon: "🛡", acceptedTypes: ["pdf"], required: false, aiExtraction: true,
    isWolfsberg: false, sortOrder: 7, active: true },
];

const corporateDocs = [
  { id: "certificate", name: "Certificate of Incorporation",
    helperText: "Issued by Companies House, ACRA, or equivalent.",
    icon: "🏛", acceptedTypes: ["pdf"], required: false, aiExtraction: true,
    isWolfsberg: false, sortOrder: 1, active: true },
  { id: "annualReport", name: "Annual Report",
    helperText: "Most recent published annual report.",
    icon: "📊", acceptedTypes: ["pdf"], required: false, aiExtraction: true,
    isWolfsberg: false, sortOrder: 2, active: true },
  { id: "financialStatements", name: "Audited Financial Statements",
    helperText: "Alternative to annual report for private companies.",
    icon: "💰", acceptedTypes: ["pdf"], required: false, aiExtraction: true,
    isWolfsberg: false, sortOrder: 3, active: true },
  { id: "orgChart", name: "Ownership Structure / Org Chart",
    helperText: "Corporate structure showing UBOs.",
    icon: "🏢", acceptedTypes: ["pdf", "image"], required: false, aiExtraction: true,
    isWolfsberg: false, sortOrder: 4, active: true },
];

const platformDocs = [
  { id: "certificate", name: "Certificate of Incorporation",
    helperText: "Issued by Companies House, ACRA, or equivalent.",
    icon: "🏛", acceptedTypes: ["pdf"], required: false, aiExtraction: true,
    isWolfsberg: false, sortOrder: 1, active: true },
  { id: "annualReport", name: "Annual Report",
    helperText: "Most recent published annual report.",
    icon: "📊", acceptedTypes: ["pdf"], required: false, aiExtraction: true,
    isWolfsberg: false, sortOrder: 2, active: true },
  { id: "financialStatements", name: "Audited Financial Statements",
    icon: "💰", acceptedTypes: ["pdf"], required: false, aiExtraction: true,
    isWolfsberg: false, sortOrder: 3, active: true },
  { id: "orgChart", name: "Ownership Structure / Org Chart",
    icon: "🏢", acceptedTypes: ["pdf", "image"], required: false, aiExtraction: true,
    isWolfsberg: false, sortOrder: 4, active: true },
];

const directDocs = [
  { id: "certificate", name: "Certificate of Incorporation",
    icon: "🏛", acceptedTypes: ["pdf"], required: false, aiExtraction: true,
    isWolfsberg: false, sortOrder: 1, active: true },
  { id: "annualReport", name: "Annual Report",
    icon: "📊", acceptedTypes: ["pdf"], required: false, aiExtraction: true,
    isWolfsberg: false, sortOrder: 2, active: true },
  { id: "orgChart", name: "Ownership Structure / Org Chart",
    icon: "🏢", acceptedTypes: ["pdf", "image"], required: false, aiExtraction: true,
    isWolfsberg: false, sortOrder: 3, active: true },
];

function buildDefaultConfig(tenantId) {
  return {
    _tenantId: tenantId,
    _version: 1,
    _seededAt: new Date().toISOString(),

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
      {
        id: "GB",
        jurisdictionCode: "GB",
        jurisdictionName: "United Kingdom",
        licenceType: "Payment Institution",
        licenceNumber: "",
        regulatoryAuthority: "FCA",
        countriesCovered: ["GB"],
        isPrimary: false,
      },
      {
        id: "SG",
        jurisdictionCode: "SG",
        jurisdictionName: "Singapore",
        licenceType: "Major Payment Institution",
        licenceNumber: "",
        regulatoryAuthority: "MAS",
        countriesCovered: [],
        isPrimary: true,
      },
    ],

    routingPolicy: "regional",

    entityTypes: [
      { id: "FI", label: "Financial Institution", description: "Banks, payment institutions, EMIs and other regulated financial entities", icon: "🏦", active: true, sortOrder: 1, associatedLicenceIds: ["GB", "SG"] },
      { id: "Platform", label: "Platform", description: "Technology platforms and marketplaces", icon: "💻", active: true, sortOrder: 2, associatedLicenceIds: ["GB", "SG"] },
      { id: "Direct", label: "Direct", description: "Direct business customers", icon: "🏢", active: true, sortOrder: 3, associatedLicenceIds: ["GB", "SG"] },
      { id: "Corporate", label: "Corporate", description: "Corporate and commercial entities", icon: "🏛", active: true, sortOrder: 4, associatedLicenceIds: ["GB", "SG"] },
    ],

    schemas: {
      "Corporate:GB": { researchFields: [...UK_SCHEMA.researchFields], gapFields: [...UK_SCHEMA.gapFields] },
      "Corporate:SG": { researchFields: [...SG_SCHEMA.researchFields], gapFields: [...SG_SCHEMA.gapFields] },
      "FI:GB": { researchFields: [...UK_FI_SCHEMA.researchFields], gapFields: [...UK_FI_SCHEMA.gapFields] },
      "FI:SG": { researchFields: [...SG_FI_SCHEMA.researchFields], gapFields: [...SG_FI_SCHEMA.gapFields] },
      "Platform:GB": { researchFields: [...UK_SCHEMA.researchFields], gapFields: [...UK_SCHEMA.gapFields] },
      "Platform:SG": { researchFields: [...SG_SCHEMA.researchFields], gapFields: [...SG_SCHEMA.gapFields] },
      "Direct:GB": { researchFields: [...UK_SCHEMA.researchFields], gapFields: [...UK_SCHEMA.gapFields] },
      "Direct:SG": { researchFields: [...SG_SCHEMA.researchFields], gapFields: [...SG_SCHEMA.gapFields] },
    },

    sourceTiers: {
      primary: [
        { name: "Companies House", pattern: "companieshouse", jurisdiction: "GB" },
        { name: "FCA Register", pattern: "fca.org.uk", jurisdiction: "GB" },
        { name: "ACRA BizFile+", pattern: "acra.gov.sg", jurisdiction: "SG" },
        { name: "MAS Directory", pattern: "mas.gov.sg", jurisdiction: "SG" },
        { name: "SEC EDGAR", pattern: "sec.gov", jurisdiction: "US" },
        { name: "ASIC", pattern: "asic.gov.au", jurisdiction: "AU" },
        { name: "Government domains", pattern: ".gov", jurisdiction: null },
        { name: "LSE", pattern: "londonstockexchange", jurisdiction: "GB" },
        { name: "SGX", pattern: "sgx.com", jurisdiction: "SG" },
        { name: "NYSE", pattern: "nyse.com", jurisdiction: "US" },
        { name: "NASDAQ", pattern: "nasdaq.com", jurisdiction: "US" },
      ],
      secondary: [
        { name: "LinkedIn", pattern: "linkedin.com" },
        { name: "Wikipedia", pattern: "wikipedia.org" },
        { name: "Crunchbase", pattern: "crunchbase.com" },
        { name: "Bloomberg", pattern: "bloomberg.com" },
        { name: "Reuters", pattern: "reuters.com" },
        { name: "Company website", pattern: "own website" },
      ],
      documentsArePrimary: true,
    },

    documents: {
      FI: fiDocs,
      Corporate: corporateDocs,
      Platform: platformDocs,
      Direct: directDocs,
    },
  };
}

module.exports = { buildDefaultConfig };
