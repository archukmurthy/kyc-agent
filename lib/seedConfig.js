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
      manualFormUrl: "https://app.nium.com",
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
      { id: "FI", label: "Financial Institution", description: "Banks, payment institutions, EMIs and other regulated financial entities", icon: "🏦", active: true, sortOrder: 1, associatedLicenceIds: ["GB", "SG"],
        ownershipTypes: ["private_limited", "public_listed", "public_unlisted", "branch", "correspondent_bank", "payment_institution", "investment_fund", "insurance_company", "central_bank", "other"] },
      { id: "Platform", label: "Platform", description: "Technology platforms and marketplaces", icon: "💻", active: true, sortOrder: 2, associatedLicenceIds: ["GB", "SG"],
        ownershipTypes: ["private_limited", "public_listed", "public_unlisted", "llp", "other"] },
      { id: "Direct", label: "Direct", description: "Direct business customers", icon: "🏢", active: true, sortOrder: 3, associatedLicenceIds: ["GB", "SG"],
        ownershipTypes: ["private_limited", "public_listed", "sole_trader", "llp", "general_partnership", "trust", "charity", "other"] },
      { id: "Corporate", label: "Corporate", description: "Corporate and commercial entities", icon: "🏛", active: true, sortOrder: 4, associatedLicenceIds: ["GB", "SG"],
        ownershipTypes: ["private_limited", "public_listed", "public_unlisted", "holding_company", "spv", "joint_venture", "branch", "other"] },
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
      // Tier 1 — official registries, regulators, and stock exchanges.
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
        { name: "Charity Commission", pattern: "charitycommission.gov.uk", jurisdiction: "GB" },
      ],
      // Tier 2 — company-owned sources (more reliable than third-party).
      secondary: [
        { name: "Corporate Website", pattern: "corporate website" },
        { name: "Investor Relations", pattern: "investor relations" },
        { name: "Annual Report", pattern: "annual report" },
        { name: "About Us Page", pattern: "about us" },
        { name: "Legal / Regulatory Page", pattern: "legal" },
        { name: "Careers Page", pattern: "careers" },
        { name: "Press Release", pattern: "press release" },
        { name: "Company website", pattern: "own website" },
      ],
      // Tier 3 — third-party, unverified sources.
      tertiary: [
        { name: "LinkedIn", pattern: "linkedin.com" },
        { name: "Wikipedia", pattern: "wikipedia.org" },
        { name: "Crunchbase", pattern: "crunchbase.com" },
        { name: "Bloomberg", pattern: "bloomberg.com" },
        { name: "Reuters", pattern: "reuters.com" },
        { name: "News Article", pattern: "news" },
        { name: "Business Directory", pattern: "directory" },
      ],
      documentsArePrimary: true,
    },

    documents: {
      FI: fiDocs,
      Corporate: corporateDocs,
      Platform: platformDocs,
      Direct: directDocs,
    },

    // Global catalog of every document the admin can pick from. Kept in sync
    // with `documents` per entity type — adding a custom doc via the admin
    // pushes it into both this library and the active entity type's list.
    // `defaultForEntityTypes` lets the admin filter the library to "suggested
    // for this entity type" when configuring per-entity collection.
    documentLibrary: buildDocumentLibrary({ FI: fiDocs, Corporate: corporateDocs, Platform: platformDocs, Direct: directDocs }),
  };
}

// Build the global document library by uniquing docs across all entity-type
// lists and inferring `defaultForEntityTypes` from which lists they appear in.
function buildDocumentLibrary(perEntity) {
  const byId = new Map();
  for (const [entityId, docs] of Object.entries(perEntity)) {
    for (const d of docs) {
      const existing = byId.get(d.id);
      if (existing) {
        if (!existing.defaultForEntityTypes.includes(entityId)) {
          existing.defaultForEntityTypes.push(entityId);
        }
      } else {
        byId.set(d.id, {
          id: d.id,
          name: d.name,
          helperText: d.helperText,
          icon: d.icon,
          acceptedTypes: d.acceptedTypes,
          required: d.required || false,
          aiExtraction: d.aiExtraction !== false,
          extractionPrompt: d.extractionPrompt || "",
          isWolfsberg: d.isWolfsberg || false,
          isWolfsbergCBDDQ: d.isWolfsbergCBDDQ || false,
          isWolfsbergFCCQ: d.isWolfsbergFCCQ || false,
          defaultForEntityTypes: [entityId],
        });
      }
    }
  }
  return Array.from(byId.values());
}

// Empty/baseline config for a brand-new non-Nium tenant. Has the canonical
// shape but no licences/entityTypes/schemas/documents — the admin will fill
// these in from scratch. Carries `_isBlank: true` so callers can detect it.
function buildBlankConfig(tenantId) {
  const now = new Date().toISOString();
  return {
    _tenantId: tenantId,
    _version: 1,
    _seededAt: now,
    _isDefault: false,
    _isBlank: true,

    company: {
      name: "",
      logo: null,
      manualFormUrl: "",
      privacyPolicyUrl: "",
      submissionWebhookUrl: "",
      submissionEmail: "",
      primaryContactName: "",
      primaryContactEmail: "",
    },

    licences: [],
    routingPolicy: "regional",
    entityTypes: [],
    schemas: {},

    sourceTiers: {
      primary: [
        { name: "Government Domains", pattern: ".gov", jurisdiction: null },
      ],
      secondary: [
        { name: "LinkedIn", pattern: "linkedin.com" },
        { name: "Wikipedia", pattern: "wikipedia.org" },
      ],
      documentsArePrimary: true,
    },

    documentLibrary: [],
    documents: {},
  };
}

module.exports = { buildDefaultConfig, buildBlankConfig };
