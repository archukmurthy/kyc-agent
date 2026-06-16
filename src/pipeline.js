/* eslint-env node */
/*
 * Shared KYC research / scoring pipeline — SINGLE SOURCE OF TRUTH.
 *
 * Extracted verbatim from src/App.js. CommonJS so it can be require()'d by
 * Node (api/benchmark.js) and imported by webpack (src/App.js) via CJS
 * interop. Must stay framework-free (no React, no browser globals) so the
 * server can run it. Lives in src/ because CRA's ModuleScopePlugin forbids
 * src -> outside-src imports.
 */
const {
  OWNERSHIP_TYPE_LIBRARY,
  NIUM_DEFAULT_OWNERSHIP_TYPES,
  getResearchStrategy,
  ownershipTypeLabel,
} = require("./utils/ownershipTypes");

/* ═══════════════════════════════════════════
   SOURCE TRUST CLASSIFICATION

   Per-country lists of authoritative registries
   and regulators. Anything matching (case-insensitive
   substring) is treated as "authoritative" — those
   items go on the Confirm page as pre-checked.

   Anything else (Wikipedia, LinkedIn, Crunchbase,
   news outlets, unknowns) is classified "secondary"
   and routed to the Fill Gaps page as a pre-filled
   editable field that requires explicit confirmation.
   ═══════════════════════════════════════════ */
const SOURCE_TRUST = {
  GB: ["companies house", "fca", "financial conduct authority", "lse", "london stock exchange", "hmrc", "psc register"],
  SG: ["acra", "mas", "monetary authority of singapore", "sgx", "iras"],
  US: ["sec", "edgar", "secretary of state", "irs", "finra", "nyse", "nasdaq", "occ", "delaware division"],
  AU: ["asic", "asx", "austrac"],
  CA: ["corporations canada", "innovation, science and economic development", "osc", "tsx", "tmx group"],
  NL: ["kvk", "kamer van koophandel", "afm", "euronext"],
  LT: ["registru centras", "registrų centras", "centre of registers"],
  JP: ["national tax agency", "houjin bangou", "edinet", "jpx", "tse", "tokyo stock exchange"],
  HK: ["companies registry", "hkex", "sfc", "ird"],
  MY: ["ssm", "suruhanjaya syarikat", "bursa malaysia", "sc malaysia"],
  ID: ["ahu", "direktorat jenderal", "ojk", "idx"],
  DE: ["handelsregister", "bundesanzeiger", "bafin", "deutsche börse", "deutsche borse"],
  FR: ["insee", "sirene", "rcs", "infogreffe", "amf", "euronext paris"],
  IE: ["cro", "companies registration office", "central bank of ireland", "euronext dublin"],
  IN: ["mca", "ministry of corporate affairs", "sebi", "bse", "nse india", "rbi", "reserve bank of india"],
  TH: ["dbd", "department of business development", "sec thailand", "set thailand"],
  VN: ["national business registration", "ssc vietnam", "hose", "hnx"],
  PH: ["sec philippines", "pse"],
  KR: ["dart", "fss", "krx", "kosdaq"],
  CN: ["necips", "saic", "csrc", "sse", "szse", "shanghai stock exchange", "shenzhen stock exchange", "national enterprise credit"],
  TW: ["gcis", "ministry of economic affairs", "fsc taiwan", "twse"],
  AE: ["ded", "dfm", "adx", "sca", "uae securities", "department of economic development"],
  SA: ["mci", "ministry of commerce", "cma saudi", "tadawul", "saudi business center"],
  ZA: ["cipc", "jse", "fsca"],
  NG: ["cac", "corporate affairs commission", "sec nigeria", "ngx"],
  KE: ["brs", "business registration service", "cma kenya", "nse kenya"],
  EG: ["gafi", "fra", "egx"],
  BR: ["junta comercial", "rfb", "cnpj", "cvm", "b3 s.a"],
  MX: ["rfc", "sat", "cnbv", "bmv", "servicio de administración tributaria"],
  AR: ["igj", "cnv", "byma"],
  CL: ["cmf", "bolsa de comercio", "rut chile"],
  CO: ["rues", "cámaras de comercio", "sfc", "bvc"],
  ES: ["registro mercantil", "cnmv", "bme"],
  IT: ["registro imprese", "consob", "borsa italiana"],
  CH: ["handelsregister", "zefix", "finma", "six swiss"],
  SE: ["bolagsverket", "finansinspektionen", "nasdaq stockholm"],
  NO: ["brønnøysund", "bronnoysund", "finanstilsynet", "oslo børs", "oslo bors"],
  DK: ["erhvervsstyrelsen", "cvr", "nasdaq copenhagen", "finanstilsynet"],
  PL: ["krs", "krajowy rejestr sądowy", "knf", "gpw"],
  TR: ["mersis", "tobb", "cmb turkey", "spk", "bist"],
  IL: ["israeli companies registrar", "isa israel", "tase"],
  NZ: ["companies office", "fma", "nzx"],
  PK: ["secp", "psx"],
  BD: ["rjsc", "bsec", "dse bangladesh"],
  LK: ["roc sri lanka", "sec sri lanka", "cse colombo"],
  AM: ["state register of legal entities", "e-register.am", "ministry of justice of armenia", "central bank of armenia", "cba.am", "armenia securities exchange", "amx", "armenian stock exchange", "state revenue committee", "src armenia"],
};

// Always authoritative regardless of jurisdiction.
const UNIVERSAL_AUTHORITATIVE = [
  "lei ", "gleif", "global legal entity",
  "official filing", "official register", "regulatory filing",
  "annual report", "audited financial", "audited account",
  "10-k", "10-q", "form 10-k", "form 8-k", "20-f",
  "prospectus", "stock exchange filing",
];

const classifySource = (source, countryCode) => {
  if (!source || typeof source !== "string") return "secondary";
  const s = source.toLowerCase();
  const country = SOURCE_TRUST[countryCode] || [];
  for (const pattern of country) if (s.includes(pattern)) return "authoritative";
  for (const pattern of UNIVERSAL_AUTHORITATIVE) if (s.includes(pattern)) return "authoritative";
  return "secondary";
};

// Markets where Nium holds a licence. Country of registration matching one of these
// uses that market's schema. Otherwise the Singapore licence applies as default.
const LICENSED_MARKETS = ["GB"];

/* ═══════════════════════════════════════════
   SHARED GAP SECTIONS (account + bank are
   identical structure across jurisdictions —
   only the currency label differs)
   ═══════════════════════════════════════════ */
const VOLUME_OPTIONS = ["Under 10,000", "10,000 - 50,000", "50,000 - 250,000", "250,000 - 1,000,000", "1,000,000 - 5,000,000", "Over 5,000,000"];

const accountSection = (currencyLabel) => [
  { field: "creditMonthlyVolume", label: `Expected Monthly Credit Volume (${currencyLabel})`, inputType: "select", required: true, section: "account", options: VOLUME_OPTIONS },
  { field: "creditTopCountries", label: "Top Credit Transaction Countries", inputType: "text", required: true, section: "account" },
  { field: "debitMonthlyVolume", label: `Expected Monthly Debit Volume (${currencyLabel})`, inputType: "select", required: true, section: "account", options: VOLUME_OPTIONS },
  { field: "debitTopCountries", label: "Top Debit Transaction Countries", inputType: "text", required: true, section: "account" },
  { field: "intendedUses", label: "Intended Use of Account", inputType: "textarea", required: true, section: "account" },
  { field: "sourceOfFunds", label: "Source of Funds", inputType: "textarea", required: false, section: "account" },
];

/* ═══════════════════════════════════════════
   JURISDICTION SCHEMAS
   Each researchField has a `tier`:
     1 = basic identity / public registry
     2 = enrichment, ownership, risk screening
   ═══════════════════════════════════════════ */
const UK_SCHEMA = {
  label: "United Kingdom",
  region: "UK",
  flow: "corporate",
  researchFields: [
    { field: "businessType", label: "Business Type", tier: 1, section: "business_entity" },
    { field: "businessRegistrationNumber", label: "Companies House Number", tier: 1, section: "business_entity" },
    { field: "registeredDate", label: "Date of Incorporation", tier: 1, section: "business_entity" },
    { field: "registeredCountry", label: "Registered Country", tier: 1, section: "business_entity" },
    { field: "tradeName", label: "Trade Name", tier: 1, section: "business_entity" },
    { field: "website", label: "Website", tier: 1, section: "business_entity" },
    { field: "addressLine1", label: "Registered Address Line 1", tier: 1, section: "registered_address" },
    { field: "addressLine2", label: "Registered Address Line 2", tier: 1, section: "registered_address" },
    { field: "city", label: "City", tier: 1, section: "registered_address" },
    { field: "state", label: "County / State", tier: 1, section: "registered_address" },
    { field: "postcode", label: "Postcode", tier: 1, section: "registered_address" },
    { field: "country", label: "Address Country", tier: 1, section: "registered_address" },
    { field: "sicCode", label: "SIC Code", tier: 1, section: "business_activity" },
    { field: "annualRevenue", label: "Annual Revenue", tier: 2, section: "business_activity" },
    { field: "employees", label: "Number of Employees", tier: 2, section: "business_activity" },
    { field: "stockListing", label: "Stock Exchange Listing", tier: 2, section: "business_activity" },
    { field: "leiNumber", label: "LEI Number", tier: 2, section: "business_activity" },
    { field: "countriesOfOperation", label: "Countries of Operation", tier: 2, section: "business_activity" },
    { field: "isMultiLayered", label: "Multi-layered Corporate Structure", tier: 2, section: "ownership" },
    { field: "uboAnalysis", label: "UBO / Ownership Analysis", tier: 2, section: "ownership" },
    { field: "directors", label: "Key Directors (with nationality)", tier: 2, section: "ownership" },
    { field: "companySecretary", label: "Company Secretary", tier: 2, section: "ownership" },
    { field: "isPEP", label: "PEP Status of Directors", tier: 2, section: "ownership" },
  ],
  gapFields: [
    { field: "applicantFirstName", label: "Applicant First Name", inputType: "text", required: true, section: "applicant" },
    { field: "applicantLastName", label: "Applicant Last Name", inputType: "text", required: true, section: "applicant" },
    { field: "applicantEmail", label: "Applicant Email", inputType: "email", required: true, section: "applicant" },
    { field: "applicantMobile", label: "Applicant Mobile", inputType: "tel", required: true, section: "applicant" },
    { field: "applicantMobileCountryCode", label: "Mobile Country Code", inputType: "text", required: true, section: "applicant" },
    { field: "applicantDateOfBirth", label: "Applicant Date of Birth", inputType: "date", required: true, section: "applicant" },
    { field: "applicantNationality", label: "Applicant Nationality (2-letter code)", inputType: "text", required: true, section: "applicant" },
    { field: "applicantBirthCountry", label: "Applicant Birth Country", inputType: "text", required: true, section: "applicant" },
    { field: "applicantIsPEP", label: "Is Applicant a PEP?", inputType: "select", required: true, section: "applicant", options: ["Yes", "No"] },
    // Stakeholder collection for Corporate flow. Mirrors fiStakeholderFields'
    // stakeholder_note pattern. directors_full_details uses a distinct id
    // because the research field "directors" is already populated by the AI.
    { field: "directors_full_details", label: "Directors / Officers — full details", inputType: "textarea", required: true, section: "stakeholders",
      placeholder: "For each director or officer, include: Full Name, Position, Date of Birth, Nationality, Email, PEP status (Yes/No), and Residential Address." },
    { field: "stakeholder_note", label: "Other Stakeholder Details (UBOs, Signatories)", inputType: "textarea", required: true, section: "stakeholders",
      placeholder: "List all UBOs (>25% ownership) and authorised signatories. For each include: Full Name, Position, Date of Birth, Nationality, Email, Share Percentage (if applicable), PEP status (Yes/No), and Residential Address." },
    ...accountSection("GBP"),
  ],
};

const SG_SCHEMA = {
  label: "Singapore / Default",
  region: "SG",
  flow: "corporate",
  researchFields: [
    { field: "businessType", label: "Business Type / Entity Form", tier: 1, section: "business_entity" },
    { field: "businessRegistrationNumber", label: "Company Registration Number / Tax ID", tier: 1, section: "business_entity" },
    { field: "registeredDate", label: "Date of Incorporation", tier: 1, section: "business_entity" },
    { field: "registeredCountry", label: "Registered Country", tier: 1, section: "business_entity" },
    { field: "tradeName", label: "Trade Name", tier: 1, section: "business_entity" },
    { field: "formerName", label: "Former Name (if any)", tier: 1, section: "business_entity" },
    { field: "website", label: "Website", tier: 1, section: "business_entity" },
    { field: "addressLine1", label: "Registered Address Line 1", tier: 1, section: "registered_address" },
    { field: "addressLine2", label: "Registered Address Line 2", tier: 1, section: "registered_address" },
    { field: "city", label: "City", tier: 1, section: "registered_address" },
    { field: "state", label: "State", tier: 1, section: "registered_address" },
    { field: "postcode", label: "Postcode", tier: 1, section: "registered_address" },
    { field: "country", label: "Address Country", tier: 1, section: "registered_address" },
    { field: "sicCode", label: "Industry Classification Code", tier: 1, section: "business_activity" },
    { field: "annualRevenue", label: "Annual Revenue / Turnover", tier: 2, section: "business_activity" },
    { field: "employees", label: "Number of Employees", tier: 2, section: "business_activity" },
    { field: "stockListing", label: "Stock Exchange Listing", tier: 2, section: "business_activity" },
    { field: "leiNumber", label: "LEI Number", tier: 2, section: "business_activity" },
    { field: "countriesOfOperation", label: "Operating Countries", tier: 2, section: "business_activity" },
    { field: "industryCodes", label: "Industry Sector Codes", tier: 2, section: "business_activity" },
    { field: "industryDescription", label: "Business Description", tier: 2, section: "business_activity" },
    { field: "isMultiLayered", label: "Multi-layered Corporate Structure", tier: 2, section: "ownership" },
    { field: "uboAnalysis", label: "UBO / Ownership Analysis", tier: 2, section: "ownership" },
    { field: "directors", label: "Key Directors / Officers", tier: 2, section: "ownership" },
    { field: "companySecretary", label: "Company Secretary", tier: 2, section: "ownership" },
    { field: "listedExchange", label: "Listed Exchange (if public)", tier: 2, section: "business_activity" },
  ],
  gapFields: [
    { field: "applicantFirstName", label: "Applicant First Name", inputType: "text", required: true, section: "applicant" },
    { field: "applicantLastName", label: "Applicant Last Name", inputType: "text", required: true, section: "applicant" },
    { field: "applicantEmail", label: "Applicant Email", inputType: "email", required: true, section: "applicant" },
    { field: "applicantMobile", label: "Applicant Mobile", inputType: "tel", required: true, section: "applicant" },
    { field: "applicantMobileCountryCode", label: "Mobile Country Code", inputType: "text", required: true, section: "applicant" },
    { field: "applicantDateOfBirth", label: "Applicant Date of Birth", inputType: "date", required: true, section: "applicant" },
    { field: "applicantNationality", label: "Applicant Nationality (2-letter code)", inputType: "text", required: true, section: "applicant" },
    { field: "applicantSharePercentage", label: "Applicant Share % (if UBO)", inputType: "text", required: false, section: "applicant" },
    { field: "applicantPosition", label: "Applicant Position Title", inputType: "select", required: true, section: "applicant", options: ["Director", "UBO", "Authorised Representative", "Partner", "Trustee", "Signatory", "Other"] },
    { field: "natureOperatingCountries", label: "Operating Countries (comma-separated ISO codes)", inputType: "text", required: true, section: "nature" },
    { field: "natureIndustryCodes", label: "Industry Sector Codes (e.g. IS131, IS145)", inputType: "text", required: true, section: "nature" },
    { field: "natureIndustryDescription", label: "Business Description (2-3 sentences)", inputType: "textarea", required: false, section: "nature" },
    { field: "sizeTotalEmployees", label: "Total Employees (range)", inputType: "select", required: true, section: "nature", options: ["1-10", "11-50", "51-200", "201-500", "501-1000", "1001-5000", "5000+"] },
    { field: "sizeAnnualTurnover", label: "Annual Turnover (range)", inputType: "select", required: true, section: "nature", options: ["Under 100K", "100K - 500K", "500K - 1M", "1M - 5M", "5M - 25M", "25M - 100M", "Over 100M"] },
    // Stakeholder collection for Corporate flow. Mirrors fiStakeholderFields'
    // stakeholder_note pattern. directors_full_details uses a distinct id
    // because the research field "directors" is already populated by the AI.
    { field: "directors_full_details", label: "Directors / Officers — full details", inputType: "textarea", required: true, section: "stakeholders",
      placeholder: "For each director or officer, include: Full Name, Position, Date of Birth, Nationality, Email, PEP status (Yes/No), and Residential Address." },
    { field: "stakeholder_note", label: "Other Stakeholder Details (UBOs, Signatories)", inputType: "textarea", required: true, section: "stakeholders",
      placeholder: "List all UBOs (>25% ownership) and authorised signatories. For each include: Full Name, Position, Date of Birth, Nationality, Email, Share Percentage (if applicable), PEP status (Yes/No), and Residential Address." },
    ...accountSection("SGD"),
  ],
};

/* ═══════════════════════════════════════════
   FI SCHEMAS — shared building blocks
   The two FI schemas (UK and SG) are structurally
   identical. Only Section 5 (Account Usage) differs
   in currency labelling, so it's parameterised by
   a fmt(amount) helper.
   ═══════════════════════════════════════════ */
const fiResearchFields = [
  // Identity & registry
  { field: "business_name", label: "Business Name", tier: 1, section: "business_entity", searchHint: "Full registered legal name from Companies House or equivalent official registry" },
  { field: "trading_name", label: "Doing Business As / Trade Name", tier: 1, section: "business_entity", searchHint: "Any trading or DBA name — check Companies House previous names" },
  { field: "registration_number", label: "Business Registration Number", tier: 1, section: "business_entity", searchHint: "Company registration number from Companies House or equivalent registry" },
  { field: "business_activity_description", label: "Business Activity Description", tier: 2, section: "business_entity", searchHint: "What does this company do? Check annual report, Companies House SIC code, company website" },
  { field: "website", label: "Website", tier: 1, section: "business_entity", searchHint: "Official company website" },
  { field: "registered_address_line1", label: "Address Line 1", tier: 1, section: "registered_address", searchHint: "Full registered address from Companies House or equivalent registry" },
  { field: "registered_address_line2", label: "Address Line 2", tier: 1, section: "registered_address", searchHint: "Full registered address from Companies House or equivalent registry" },
  { field: "registered_address_city", label: "City", tier: 1, section: "registered_address", searchHint: "Full registered address from Companies House or equivalent registry" },
  { field: "registered_address_state", label: "State", tier: 1, section: "registered_address", searchHint: "Full registered address from Companies House or equivalent registry" },
  { field: "registered_address_postcode", label: "Postcode", tier: 1, section: "registered_address", searchHint: "Full registered address from Companies House or equivalent registry" },
  { field: "registered_address_country", label: "Country", tier: 1, section: "registered_address", searchHint: "Full registered address from Companies House or equivalent registry" },
  { field: "incorporation_date", label: "Date of Incorporation", tier: 1, section: "business_entity", searchHint: "Date of incorporation from Companies House or equivalent registry" },
  // Operations & size
  { field: "employee_count", label: "Number of Employees", tier: 2, section: "business_activity", searchHint: "Number of employees — check annual report, LinkedIn, or Companies House accounts" },
  { field: "annual_turnover", label: "Annual Turnover", tier: 2, section: "business_activity", searchHint: "Annual revenue/turnover band — check annual report or Companies House accounts" },
  { field: "operating_countries", label: "Operating Countries", tier: 2, section: "business_activity", searchHint: "Countries where the company operates — check annual report geographic breakdown" },
  { field: "payout_transaction_countries", label: "Payout Transaction Countries", tier: 2, section: "business_activity", searchHint: "Countries the company sends payments to — check annual report" },
  { field: "industry_sector", label: "Industry Sector (multi)", tier: 1, section: "business_activity", searchHint: "Primary industry sector — check Companies House SIC code and annual report" },
  // Listing
  { field: "publicly_listed", label: "Publicly Listed", tier: 2, section: "business_activity", searchHint: "Is the company or its parent listed on a stock exchange? Check LSE, NYSE, SGX" },
  { field: "listed_where", label: "Listed Exchanges", tier: 2, section: "business_activity", searchHint: "Which stock exchange? Check LSE, annual report" },
  // Regulatory
  { field: "has_licence", label: "Do you hold a licence or permit to operate?", tier: 1, section: "regulatory", searchHint: "Does the company hold a financial services licence? Check FCA register (register.fca.org.uk), MAS directory, or equivalent regulatory database for the country" },
  { field: "regulatory_authority", label: "Regulatory Authority Name", tier: 1, section: "regulatory", searchHint: "Which regulatory authority? e.g. FCA, MAS, ASIC, SEC — check official regulatory register" },
  { field: "licence_number", label: "Licence Number", tier: 1, section: "regulatory", searchHint: "FCA FRN or equivalent licence number — check FCA register or MAS directory" },
  // Branches & services
  { field: "has_branches", label: "Do you have physical branches or office locations?", tier: 2, section: "operations", searchHint: "Does the company have physical branches or offices? Check annual report" },
  { field: "branch_count", label: "How many branches?", tier: 2, section: "operations", searchHint: "How many branches — check annual report" },
  { field: "branch_countries", label: "Where are your main offices located? (multi)", tier: 2, section: "operations", searchHint: "Countries with offices — check annual report" },
  { field: "services_other_fis", label: "Do you service other financial institutions?", tier: 2, section: "operations", searchHint: "Does the company provide services to other financial institutions? Check annual report" },
  { field: "cross_border_services", label: "Do you provide cross-border services?", tier: 2, section: "operations", searchHint: "Does the company provide cross-border payment services? Check annual report and website" },
  { field: "issues_prepaid_cards", label: "Do you issue prepaid cards?", tier: 2, section: "operations", searchHint: "Does the company issue prepaid cards? Check annual report and website" },
  { field: "non_resident_customers", label: "Do you have non-resident customers?", tier: 2, section: "operations", searchHint: "Does the company serve non-resident or international customers? Check annual report" },
  { field: "products_offered", label: "What products / services do you offer to your customers? (multi)", tier: 2, section: "operations", searchHint: "What products and services does the company offer? Check annual report and website" },
  // Ownership
  { field: "director_names", label: "Directors / Officers", tier: 2, section: "ownership", searchHint: "Names and roles of directors — check Companies House officers section or equivalent registry" },
  { field: "ubo_parent_company", label: "UBO / Parent Company", tier: 2, section: "ownership", searchHint: "Ultimate beneficial owner or parent company — check Companies House PSC register or equivalent" },
  { field: "ubo_share_percentage", label: "UBO Share Percentage", tier: 2, section: "ownership", searchHint: "Ownership percentage — check Companies House PSC register" },
  // Disclosures
  { field: "licence_suspended", label: "Has your business ever had a licence suspended or revoked?", tier: 2, section: "regulatory", searchHint: "Has the company ever had a licence suspended or been subject to regulatory enforcement? Check FCA enforcement actions page (fca.org.uk/news/enforcement-actions), regulatory notices, news" },
  { field: "administration_proceedings", label: "Has your business ever been entered into administration proceedings?", tier: 2, section: "regulatory", searchHint: "Has the company been in administration? Check Companies House and news" },

  // ───────────────────────────────────────────────────────────────────────────
  // FI field merge (CHANGE 1 — source of truth: benchmark/fi-schema-fields-patch.js).
  // Inlined here rather than required from benchmark/ because CRA's
  // ModuleScopePlugin forbids src/ importing from outside src/. Keep the two
  // copies in sync. Three groups:
  //   1. researchable  — tier 1/2 with a searchHint; counted in the researchable
  //                      denominator; the agent attempts to fill them.
  //   2. researchable-list — findable country LIST, but the % split is private;
  //                      splitIsCustomerSupplied:true. Agent fills the list only.
  //   3. customerSupplied — forward-looking / private / declaration fields. No
  //                      searchHint; customerSupplied:true keeps them OUT of the
  //                      researchable denominator (computeCoverage) and out of
  //                      the research prompt (buildResearchPrompt).
  // ───────────────────────────────────────────────────────────────────────────

  // GROUP 1 — researchable
  { field: "vat_number", label: "VAT Number", tier: 2, section: "business_entity", searchHint: "VAT / tax registration number. Check the company website footer, terms and invoicing pages. Validate format against HMRC VAT checker (GB) or EU VIES (vies.ec.europa.eu). This is distinct from the company registration number — do not reuse the Companies House / registry number here." },
  { field: "additional_urls", label: "Additional URLs / Linked Websites", tier: 2, section: "business_entity", searchHint: "Any additional domains beyond the primary website: regional/country sites, separate brand or product sites, subsidiary sites, and app-store listings operated by the entity or its group. Check the main website footer and any 'our brands' / 'our companies' / 'group' pages." },
  { field: "is_business_address_same_as_registered", label: "Is your business address the same as your registered address?", tier: 1, section: "registered_address", searchHint: "Compare the registered address (from the company registry) with the principal place of business / head-office / contact address shown on the company website's contact page. Set 'No' only where a clearly different principal operating address is stated; otherwise 'Yes'. For most large entities the head office and registered office are the same." },
  { field: "regulatory_enforcement_action", label: "Has your business been subject to regulatory enforcement action?", tier: 1, section: "regulatory", searchHint: "Check the relevant regulator's enforcement / final-notices pages (e.g. FCA fca.org.uk/news/enforcement-actions, MAS enforcement actions, ASIC, SEC) and reputable news for fines, monetary penalties, Voluntary Requirements (VREQs), business restrictions, censures or sanctions against the entity. Broader than licence suspension — capture monetary penalties and supervisory/enforcement actions even where the licence was not suspended. Yes/No, with detail where found." },
  { field: "individual_customer_pct", label: "Individual Customers %", tier: 2, section: "business_activity", searchHint: "Estimate the retail/individual vs corporate customer mix from segment reporting in the annual report (Retail/Personal Banking vs Commercial/Corporate & Institutional divisions). NOTE this is a revenue/asset split, not a customer-count split — flag the basis. Digital retail banks skew heavily individual; wholesale-tilted banks skew corporate. Mark indicative; pair with corporate_customer_pct so the two sum to ~100." },
  { field: "corporate_customer_pct", label: "Corporate Customers %", tier: 2, section: "business_activity", searchHint: "See individual_customer_pct — derive the complementary figure from the same annual-report segment reporting. Revenue/asset basis, not customer count; flag the basis. Mark indicative." },
  { field: "top_corporate_industries", label: "Top 5 industries your corporate customers operate in (multi)", tier: 2, section: "business_activity", searchHint: "For large disclosed banks, use the credit-risk / loan-exposure-by-industry-sector breakdown in the annual report risk-management notes or the Pillar 3 report (often NACE/SIC groupings) as a ranked proxy. Strategy decks naming 'focus sectors' are marketing, not exposure data — prefer the risk disclosures. Not findable for smaller or private FIs; leave blank if no disclosure. Mark indicative." },
  { field: "deals_virtual_currencies", label: "Do you deal with virtual currencies (crypto, points, rewards)?", tier: 2, section: "business_activity", searchHint: "Check annual report, strategy sections and press/news for digital-asset activity (custody, exchange, tokenisation, stablecoins). NOTE the field conflates crypto, loyalty points and rewards — answer the crypto sub-question from public sources and add a note on which sense is being affirmed; a card-rewards programme is 'rewards' but not 'crypto'. Consider splitting into crypto vs rewards (see schema note). Mark indicative." },
  { field: "accepts_cash", label: "Do you accept cash?", tier: 2, section: "operations", searchHint: "Infer from the business model: digital-only / branchless entities typically do not accept cash; branch-network banks and money-services businesses typically do. Check product pages and branch/ATM information. Mark indicative — this is a model-based inference, not a stated fact." },

  // GROUP 2 — researchable list (country list findable; % split is customer-supplied)
  { field: "top_countries_payin", label: "Top Transaction Countries — Payin (multi, with % split)", tier: 2, section: "business_activity", splitIsCustomerSupplied: true, searchHint: "Populate the COUNTRY LIST only, from operating_countries and any corridor disclosures in the annual report / corporate site. Leave the % split BLANK — transaction-volume percentages by country are not publicly disclosed and must come from the customer. Do not estimate percentages." },
  { field: "top_countries_payout", label: "Top Transaction Countries — Payout (multi, with % split)", tier: 2, section: "business_activity", splitIsCustomerSupplied: true, searchHint: "Populate the COUNTRY LIST only, from operating_countries / payout_transaction_countries and corridor disclosures. Leave the % split BLANK — not publicly disclosed; customer-supplied. Do not estimate percentages." },

  // GROUP 3 — customer-supplied (excluded from researchable denominator; not auto-researched)
  { field: "payout_c2c_pct", label: "Payout — C2C %", section: "usage", customerSupplied: true },
  { field: "payout_b2b_pct", label: "Payout — B2B %", section: "usage", customerSupplied: true },
  { field: "payout_b2c_pct", label: "Payout — B2C %", section: "usage", customerSupplied: true },
  { field: "payout_c2b_pct", label: "Payout — C2B %", section: "usage", customerSupplied: true },
  { field: "collections_c2c_pct", label: "Collections — C2C %", section: "usage", customerSupplied: true },
  { field: "collections_b2b_pct", label: "Collections — B2B %", section: "usage", customerSupplied: true },
  { field: "collections_b2c_pct", label: "Collections — B2C %", section: "usage", customerSupplied: true },
  { field: "collections_c2b_pct", label: "Collections — C2B %", section: "usage", customerSupplied: true },
  { field: "expected_monthly_credit_volume", label: "Expected Monthly Credit Volume", section: "usage", customerSupplied: true },
  { field: "expected_monthly_credit_count", label: "Expected Number of Monthly Credit Transactions", section: "usage", customerSupplied: true },
  { field: "expected_avg_credit_value", label: "Expected Average Credit Transaction Value", section: "usage", customerSupplied: true },
  { field: "expected_monthly_debit_volume", label: "Expected Monthly Debit Volume", section: "usage", customerSupplied: true },
  { field: "expected_monthly_debit_count", label: "Expected Number of Monthly Debit Transactions", section: "usage", customerSupplied: true },
  { field: "expected_avg_debit_value", label: "Expected Average Debit Transaction Value", section: "usage", customerSupplied: true },
  { field: "top_senders", label: "Top Senders", section: "usage", customerSupplied: true },
  { field: "top_beneficiaries", label: "Top Beneficiaries", section: "usage", customerSupplied: true },
  { field: "top_countries_payin_split", label: "Top Transaction Countries — Payin (% split)", section: "usage", customerSupplied: true },
  { field: "top_countries_payout_split", label: "Top Transaction Countries — Payout (% split)", section: "usage", customerSupplied: true },
  { field: "owner_director_criminal_conviction", label: "Have any owners or directors been convicted of any crime?", section: "disclosures", customerSupplied: true, doNotAutoResearch: true, note: "Self-declaration only. Do NOT auto-research criminal-conviction status of named individuals via news scraping — accuracy, fairness and data-protection risk; false positives on a named person are a serious harm. PEP / adverse-media screening is a SEPARATE governed process with its own controls and must not be wired into this auto-fill field." },
];

const fiBusinessGapFields = [
  { field: "business_type", label: "Business Type", inputType: "select", required: true, section: "business",
    options: ["Sole Proprietorship", "Partnership", "Private Company", "Listed Company", "Public Sector / Government / State-Owned", "Club / Society / Trust / Charity / Not-for-Profit"] },
  { field: "requested_products", label: "Requested Products / Services (multi)", inputType: "select", required: true, section: "business",
    options: ["Verify", "Global Collections (Payin)", "Domestic Remittances (Payout)", "International Remittances (Payout)"] },
  { field: "vat_number", label: "VAT Number", inputType: "text", required: false, section: "business" },
  { field: "additional_urls", label: "Additional URLs / Linked Websites", inputType: "text", required: false, section: "business" },
  { field: "business_address_same", label: "Is your business address the same as your registered address?", inputType: "select", required: true, section: "business_address", options: ["Yes", "No"] },
  { field: "business_address_line1", label: "Business Address Line 1", inputType: "text", required: true, section: "business_address", dependsOn: { business_address_same: "No" } },
  { field: "business_address_line2", label: "Business Address Line 2", inputType: "text", required: false, section: "business_address", dependsOn: { business_address_same: "No" } },
  { field: "business_address_city", label: "Business Address City", inputType: "text", required: true, section: "business_address", dependsOn: { business_address_same: "No" } },
  { field: "business_address_state", label: "Business Address State", inputType: "text", required: true, section: "business_address", dependsOn: { business_address_same: "No" } },
  { field: "business_address_postcode", label: "Business Address Postcode", inputType: "text", required: true, section: "business_address", dependsOn: { business_address_same: "No" } },
  { field: "business_address_country", label: "Business Address Country", inputType: "text", required: true, section: "business_address", dependsOn: { business_address_same: "No" } },
  { field: "org_structure_doc", label: "Organisation Structure Chart", inputType: "file", required: false, section: "business" },
  { field: "business_registration_doc", label: "Business Registration Document (Certificate of Incorporation or equivalent)", inputType: "file", required: false, section: "business" },
];

// Several FI questions (has_licence, regulatory_authority, licence_number,
// has_branches, branch_count, branch_countries, services_other_fis,
// cross_border_services, issues_prepaid_cards, non_resident_customers,
// products_offered) moved to fiResearchFields so the AI tries to find them.
// The free-text/details children still live here and use dependsOn to read
// the parent's value — dependsOnSatisfied falls back to research.found when
// the parent isn't a gap field.
const fiSpecificFields = [
  { field: "no_licence_reason", label: "If no licence, please explain why one is not required", inputType: "textarea", required: true, section: "fi", dependsOn: { has_licence: "No" } },
  { field: "accepts_cash", label: "Do you accept cash?", inputType: "select", required: true, section: "fi", options: ["Yes", "No"] },
  { field: "funds_from_outside", label: "Will you fund your Nium account from outside your incorporated country?", inputType: "select", required: true, section: "fi", options: ["Yes", "No"] },
  { field: "products_offered_other", label: "Please describe your other products / services", inputType: "textarea", required: true, section: "fi", dependsOn: { products_offered: "Other" } },
  { field: "customer_individual_pct", label: "Individual Customers %", inputType: "text", required: true, section: "fi" },
  { field: "customer_corporate_pct", label: "Corporate Customers %", inputType: "text", required: true, section: "fi" },
  { field: "corporate_industries", label: "Top 5 industries your corporate customers operate in (multi)", inputType: "text", required: true, section: "fi" },
  { field: "deals_virtual_currency", label: "Do you deal with virtual currencies (crypto, points, rewards)?", inputType: "select", required: true, section: "fi", options: ["Yes", "No"] },
  { field: "virtual_currency_types", label: "Which virtual currencies? (multi)", inputType: "select", required: true, section: "fi",
    options: ["Cryptocurrency", "Points", "Rewards", "NFT", "Other"], dependsOn: { deals_virtual_currency: "Yes" } },
];

const fiStakeholderFields = [
  { field: "stakeholder_note", label: "Stakeholder Details", inputType: "textarea", required: true, section: "stakeholders",
    placeholder: "List all directors, UBOs (>25% ownership), and authorised signatories. For each include: Full Name, Position, Date of Birth, Nationality, Email, Share Percentage (if applicable), PEP status (Yes/No), and Residential Address." },
  { field: "payout_c2c_pct", label: "Payout — C2C %", inputType: "text", required: true, section: "stakeholders" },
  { field: "payout_b2b_pct", label: "Payout — B2B %", inputType: "text", required: true, section: "stakeholders" },
  { field: "payout_b2c_pct", label: "Payout — B2C %", inputType: "text", required: true, section: "stakeholders" },
  { field: "payout_c2b_pct", label: "Payout — C2B %", inputType: "text", required: true, section: "stakeholders" },
  { field: "collections_c2c_pct", label: "Collections — C2C %", inputType: "text", required: true, section: "stakeholders" },
  { field: "collections_b2b_pct", label: "Collections — B2B %", inputType: "text", required: true, section: "stakeholders" },
  { field: "collections_b2c_pct", label: "Collections — B2C %", inputType: "text", required: true, section: "stakeholders" },
  { field: "collections_c2b_pct", label: "Collections — C2B %", inputType: "text", required: true, section: "stakeholders" },
];

// licence_suspended and administration_proceedings moved to fiResearchFields;
// their detail fields stay here and read the parent value via dependsOn.
const fiDisclosureFields = [
  { field: "licence_suspended_details", label: "Please provide details (status and resolution)", inputType: "textarea", required: true, section: "disclosures", dependsOn: { licence_suspended: "Yes" } },
  { field: "regulatory_action", label: "Has your business been subject to regulatory enforcement action?", inputType: "select", required: true, section: "disclosures", options: ["Yes", "No"] },
  { field: "regulatory_action_details", label: "Please provide details (status and resolution)", inputType: "textarea", required: true, section: "disclosures", dependsOn: { regulatory_action: "Yes" } },
  { field: "administration_details", label: "Please provide details (status and resolution)", inputType: "textarea", required: true, section: "disclosures", dependsOn: { administration_proceedings: "Yes" } },
  { field: "directors_convicted", label: "Have any owners or directors been convicted of any crime?", inputType: "select", required: true, section: "disclosures", options: ["Yes", "No"] },
  { field: "directors_convicted_details", label: "Please provide details", inputType: "textarea", required: true, section: "disclosures", dependsOn: { directors_convicted: "Yes" } },
];

const fiUsageFields = (fmt) => {
  const volumeOpts = [`${fmt("1")}–${fmt("100,000")}`, `${fmt("100,001")}–${fmt("250,000")}`, `${fmt("250,001")}–${fmt("500,000")}`, `${fmt("500,001")}–${fmt("800,000")}`, `Over ${fmt("800,000")}`];
  const avgTxOpts = [`Under ${fmt("1,000")}`, `${fmt("1,001")}–${fmt("10,000")}`, `${fmt("10,001")}–${fmt("20,000")}`, `${fmt("20,001")}–${fmt("50,000")}`, `${fmt("50,001")}–${fmt("100,000")}`, `${fmt("100,001")}–${fmt("300,000")}`, `${fmt("300,001")}–${fmt("600,000")}`, `${fmt("600,001")}–${fmt("1,000,000")}`, `Over ${fmt("1,000,000")}`];
  return [
    { field: "intended_use", label: "Intended Use of Account", inputType: "select", required: true, section: "usage",
      options: ["Payroll", "Supplier Payments", "Cross-Border Trade", "FX Conversion", "Expense Management", "Collections", "Treasury", "Other"] },
    { field: "intended_use_description", label: "Please describe how Nium's products will be used", inputType: "textarea", required: true, section: "usage" },
    { field: "monthly_credit_volume", label: "Expected Monthly Credit Volume", inputType: "select", required: true, section: "usage", options: volumeOpts },
    { field: "monthly_tx_count_credit", label: "Expected Number of Monthly Credit Transactions", inputType: "text", required: true, section: "usage" },
    { field: "avg_tx_value_credit", label: "Expected Average Credit Transaction Value", inputType: "select", required: true, section: "usage", options: avgTxOpts },
    { field: "top_payin_countries", label: "Top Transaction Countries — Payin (multi, with % split)", inputType: "text", required: true, section: "usage" },
    { field: "top_payout_countries", label: "Top Transaction Countries — Payout (multi, with % split)", inputType: "text", required: true, section: "usage" },
    { field: "top_senders", label: "Top Senders", inputType: "textarea", required: true, section: "usage" },
    { field: "monthly_debit_volume", label: "Expected Monthly Debit Volume", inputType: "select", required: true, section: "usage", options: volumeOpts },
    { field: "monthly_tx_count_debit", label: "Expected Number of Monthly Debit Transactions", inputType: "text", required: true, section: "usage" },
    { field: "avg_tx_value_debit", label: "Expected Average Debit Transaction Value", inputType: "select", required: true, section: "usage", options: avgTxOpts },
    { field: "top_beneficiaries", label: "Top Beneficiaries", inputType: "textarea", required: true, section: "usage" },
  ];
};

const fiDocumentFields = [
  { field: "wolfsberg_questionnaire", label: "Wolfsberg Questionnaire", inputType: "file", required: false, section: "documents" },
  { field: "aml_policy", label: "AML Policy / Procedures", inputType: "file", required: false, section: "documents" },
  { field: "fsl_licence_doc", label: "Copy of Financial Services Licence (or URL where it can be verified)", inputType: "text", required: false, section: "documents" },
  { field: "loa_doc", label: "Letter of Authority / Board Resolution (if applicant is not a Director)", inputType: "file", required: false, section: "documents" },
];

const UK_FI_SCHEMA = {
  label: "United Kingdom (FI)",
  region: "UK",
  jurisdiction: "GB",
  flow: "fi",
  researchFields: fiResearchFields,
  gapFields: [
    ...fiBusinessGapFields,
    ...fiSpecificFields,
    ...fiStakeholderFields,
    ...fiDisclosureFields,
    ...fiUsageFields(n => "£" + n),
    ...fiDocumentFields,
  ],
};

const SG_FI_SCHEMA = {
  label: "Singapore / Default (FI)",
  region: "SG",
  jurisdiction: "SG",
  flow: "fi",
  researchFields: fiResearchFields,
  gapFields: [
    ...fiBusinessGapFields,
    ...fiSpecificFields,
    ...fiStakeholderFields,
    ...fiDisclosureFields,
    ...fiUsageFields(n => "SGD " + n),
    ...fiDocumentFields,
  ],
};

/* ═══════════════════════════════════════════
   OWNERSHIP TYPE + RESEARCH STRATEGY (Phase 0)
   The ownership-type library + strategy tables live in
   src/utils/ownershipTypes.js (shared with the admin). These helpers adapt
   them to the customer flow's config + prompt.
   ═══════════════════════════════════════════ */

// Options for the Step 1 ownership-type dropdown, scoped to the entity type's
// configured list (falls back to the Nium defaults when the live config has no
// explicit ownershipTypes for that entity type).
function getOwnershipTypeOptions(entityTypeId, tenantConfig) {
  const entityTypeDef = (tenantConfig?.entityTypes || []).find((e) => e.id === entityTypeId);
  const enabledIds = (entityTypeDef?.ownershipTypes && entityTypeDef.ownershipTypes.length)
    ? entityTypeDef.ownershipTypes
    : NIUM_DEFAULT_OWNERSHIP_TYPES;
  return enabledIds
    .map((id) => OWNERSHIP_TYPE_LIBRARY.find((o) => o.id === id))
    .filter(Boolean)
    .map((o) => ({ value: o.id, label: o.label }));
}

// Map a country code to its primary company registry name (for prompt copy).
function getRegistriesForCountry(countryCode) {
  const registries = {
    GB: "Companies House",
    SG: "ACRA BizFile+",
    US: "SEC EDGAR, Delaware Division of Corporations",
    AU: "ASIC",
    HK: "Companies Registry",
    DE: "Handelsregister",
    FR: "Registre du Commerce",
    NL: "KVK Handelsregister",
    JP: "Legal Affairs Bureau",
    MY: "SSM",
    ID: "AHU",
    IN: "MCA21",
  };
  return registries[countryCode] || "the official company registry";
}

// Phase 0: turn the ownership type into a strategy object + a natural-language
// strategy-notes block that gets injected at the top of the research prompt.
function computeResearchStrategy(ownershipTypeId, countryCode /*, entityTypeId */) {
  const base = getResearchStrategy(ownershipTypeId);
  const strategyNotes = [];

  if (base.useStockExchangeQueries) {
    strategyNotes.push(
      "This is a publicly listed company. Prioritise stock exchange filings, annual reports, and investor relations pages. Search for LSE, NYSE, NASDAQ, SGX or equivalent exchange listings."
    );
  } else {
    strategyNotes.push(
      "This is a private company. Do NOT search stock exchanges — focus on official company registries (" +
        getRegistriesForCountry(countryCode) +
        ") and the company's own website."
    );
  }

  if (base.useCorporateWebsite) {
    strategyNotes.push(
      "Search the company's own website for: business description, operating countries, management team, office locations, products and services. Treat corporate website as a secondary (tier 2) source."
    );
  }

  if (base.useCharityRegistry) {
    strategyNotes.push(
      "Search charity commission or non-profit registries for this organisation. In the UK: charitycommission.gov.uk. In Singapore: Commissioner of Charities registry."
    );
  }

  if (base.searchParentCompanyToo) {
    strategyNotes.push(
      "This is a branch of a foreign company. Search both the local registry for the branch AND the parent company's home country registry for group information."
    );
  }

  return {
    ...base,
    strategyNotes: strategyNotes.join(" "),
    ownershipTypeId,
    ownershipTypeLabel: ownershipTypeLabel(ownershipTypeId),
  };
}

const getSchema = (code, entityType) => {
  if (entityType === "FI") return code === "GB" ? UK_FI_SCHEMA : SG_FI_SCHEMA;
  if (entityType === "Platform") return SG_FI_SCHEMA;
  if (entityType === "Direct") return SG_SCHEMA;
  // Corporate (default)
  return LICENSED_MARKETS.includes(code) && code === "GB" ? UK_SCHEMA : SG_SCHEMA;
};
const getApplicableLicence = (code) => LICENSED_MARKETS.includes(code) ? code : "SG";

/* ═══════════════════════════════════════════
   STAKEHOLDER DATA — Phase 1 scaffolding

   Stakeholder research fields (directors, UBOs, shareholders, signatories)
   are special: they describe people, not single values. The AI is asked
   to return a JSON array per person; legacy values stored as plain
   strings are migrated at render-time via parseStakeholdersFromString.
   ═══════════════════════════════════════════ */

const STAKEHOLDER_FIELD_IDS = new Set([
  "directors",
  "director_names",
  "ubo_names",
  "ubo_parent_company",
  "shareholders",
  "beneficial_owners",
  "authorised_signatories",
  "key_controllers",
]);

const isStakeholderField = (fieldId) => {
  if (!fieldId) return false;
  if (STAKEHOLDER_FIELD_IDS.has(fieldId)) return true;
  const lower = String(fieldId).toLowerCase();
  return (
    lower.includes("director") ||
    lower.includes("officer") ||
    lower.includes("ubo") ||
    lower.includes("beneficial_owner") ||
    lower.includes("shareholder") ||
    lower.includes("controller") ||
    lower.includes("signator")
  );
};

const isUboLikeField = (fieldId) => {
  const lower = String(fieldId || "").toLowerCase();
  return lower.includes("ubo") || lower.includes("beneficial") || lower.includes("shareholder");
};

// Registry exemption-notice patterns. When a PSC / beneficial-owner register
// has no individual to declare (e.g. a publicly listed company exempt from the
// PSC regime), it returns descriptive notice text in place of a person's name.
// That text must never be treated as a real stakeholder.
const REGISTRY_EXEMPTION_PATTERNS = [
  // UK Companies House PSC patterns
  "no individual ubos",
  "no individual psc",
  "publicly listed company",
  "exempt from psc",
  "psc exempt",
  "traded on a regulated market",
  "listed on a regulated market",
  "shares are traded",
  "shares traded on",
  "uk regulated market",
  "london stock exchange",
  "majority stake held by",
  "registered with companies house",
  // Generic registry exemption patterns
  "no registrable person",
  "no registrable psc",
  "exemption notice",
  "no beneficial owner",
  "no individual beneficial",
  "not applicable",
  "exempt entity",
  "listed entity",
  "publicly traded",
  "no pscs to declare",
  "information not available",
  "no persons with significant control",
  // Singapore ACRA patterns
  "exempt private company",
  "no registrable controller",
  // Generic non-person indicators
  "n/a",
  "not found",
  "none identified",
  "no data",
];

// True when a parsed "stakeholder" is really a registry exemption notice rather
// than a real person or corporate owner. Matches on name OR role text, plus a
// structural heuristic (a long, punctuated "name" is a sentence, not a person).
// NOTE: a genuine corporate UBO like "Barclays PLC" is NOT a notice — none of
// the patterns match a plain company name, and it is short with no sentence
// punctuation, so it passes through.
const isRegistryExemptionNotice = (stakeholder) => {
  if (!stakeholder) return false;
  const rawName = stakeholder.full_name || "";
  const name = rawName.toLowerCase().trim();
  const role = (stakeholder.role || "").toLowerCase().trim();

  const nameIsExemption = REGISTRY_EXEMPTION_PATTERNS.some((p) => name.includes(p));
  const roleIsExemption = REGISTRY_EXEMPTION_PATTERNS.some((p) => role.includes(p));

  // Real names are typically 2-4 words. A "name" with more than 6 words is
  // almost certainly a descriptive notice, especially with sentence punctuation.
  const nameWordCount = rawName.trim() ? rawName.trim().split(/\s+/).length : 0;
  const nameTooLong = nameWordCount > 6;
  const hasNoticePunctuation = /[-–—/]/.test(rawName) && nameWordCount > 4;

  return nameIsExemption || roleIsExemption || (nameTooLong && hasNoticePunctuation);
};

let _stakeholderIdSeq = 0;
const makeStakeholder = (overrides = {}) => {
  _stakeholderIdSeq += 1;
  return {
    id: `sh_${Date.now().toString(36)}_${_stakeholderIdSeq}`,
    // AI-found fields
    full_name: "",
    role: "",
    share_percentage: null,
    source: "",
    sourceUrl: "",
    sourceTier: "tier1",
    fetchedAt: null,
    // Gap fields — customer fills (Phase 3). PERSON stakeholders.
    nationality: "",
    date_of_birth: "",
    residential_country: "",
    id_type: "",
    id_number: "",
    is_pep: null,
    pep_details: "",
    // CORPORATE stakeholders. When is_company is true the person fields above
    // are not collected; these are used instead. full_name doubles as the
    // business/legal name and share_percentage as the shareholding, so existing
    // name-detection / Confirm / validation keep working. `positions` is a
    // repeatable [{ title, start_date }] (e.g. "Parent Company" since a date).
    is_company: false,
    business_type: "",
    business_registration_number: "",
    registered_country: "",
    positions: [],
    // Metadata
    customer_confirmed: false,
    customer_rejected: false,
    customer_added: false,
    ...overrides,
  };
};

// Positive test: does this string look like a genuine person name or a corporate
// entity? Used as a safety override so the description filter below can be
// aggressive without ever dropping a legitimate director/UBO name.
//
// A real person name on a registry is always at least two words (surname +
// forename), 2-5 of them, each made only of letters / hyphens / apostrophes /
// dots (and an optional trailing comma for the "SURNAME, Firstname" format).
// Corporate owners (e.g. "VODAFONE UK TRADING HOLDINGS LIMITED") are also valid
// even though they contain non-name words, so a company-suffix check whitelists
// them too.
const looksLikeRealName = (fullName) => {
  if (!fullName) return false;

  const name = String(fullName).trim();

  // Must be a sensible length for a name.
  if (name.length < 2 || name.length > 60) return false;

  // Must contain at least one letter.
  if (!/[a-zA-Z]/.test(name)) return false;

  const words = name.split(/\s+/).filter((w) => w.length > 0);
  // A real person name is 2-5 words. A single bare word ("Director", "Active",
  // "Verified") is a label, not a name, so it is NOT treated as a real name and
  // is left for the description patterns below to filter.
  if (words.length < 2 || words.length > 6) {
    // Single-word entries can still be corporates in rare cases — fall through
    // to the corporate-suffix check rather than rejecting outright.
    if (words.length !== 1) return false;
  }

  // Each word should be mostly letters (allowing hyphenated names, apostrophes,
  // initials with dots, and the trailing comma of "SURNAME, Firstname").
  const wordsAreName =
    words.length >= 2 &&
    words.every(
      (w) => /^[a-zA-Z\-'.]+$/.test(w) || /^[a-zA-Z\-'.]+,$/.test(w)
    );

  if (wordsAreName) return true;

  // Corporate entities are valid even though they contain non-name words.
  const corporateSuffixes = [
    "LIMITED", "LTD", "PLC", "LLP", "HOLDINGS", "CORPORATION",
    "CORP", "INC", "LLC", "GMBH", "BV",
  ];
  const isCorporate = corporateSuffixes.some((s) => name.toUpperCase().includes(s));

  return isCorporate;
};

// True when a "name" is actually a description / metadata field rather than a
// real person name — e.g. the model returns "Director (British national, born
// April 1967)" or "Appointed: 25 May 2022" instead of extracting "Nicholas
// Gliddon" from the same registry record. Such entries must be dropped: we never
// want a metadata blurb sitting in the name field, and keeping it would corrupt
// downstream KYC records.
const isDescriptionNotName = (fullName) => {
  if (!fullName) return true;

  const name = String(fullName).trim();

  // Safety first: if it looks like a genuine person name or corporate entity,
  // never filter it regardless of the patterns below.
  if (looksLikeRealName(name)) return false;

  // Role word followed by "(" introducing demographics, e.g. "Director
  // (British national...".
  const rolePrefix = /^(director|officer|secretary|manager|trustee)\s*\(/i;

  // Contains both "national" and "born" — a demographic description.
  const demographicPattern = /national.*born|born.*national/i;

  // Just a bare role word with no actual name.
  const justRole = /^(director|officer|secretary|manager)$/i;

  // Appointment date, e.g. "Appointed: 25 May 2022" / "Appointed on 25 May 2022".
  const appointmentPattern = /^appointed[\s:]/i;

  // Date-only strings, e.g. "25 May 2022" or "May 2022".
  const dateOnlyPattern = /^\d{1,2}\s+\w+\s+\d{4}$|^\w+\s+\d{4}$/;

  // Role followed by a date, e.g. "Director since May 2022".
  const roleSinceDate = /^(director|officer|secretary)\s+since/i;

  // Status labels, e.g. "Active", "Resigned", "Current", "Ceased".
  const statusLabel = /^(active|resigned|current|ceased)$/i;

  // Identity-verification strings the registry shows beside an officer.
  const verificationPattern = /^(verified|identity verification|verification requirements)/i;

  // NOTE: an address pattern is intentionally NOT included here — corporate
  // entities like "VODAFONE HOUSE HOLDINGS LIMITED" would be wrongly filtered.
  // Address strings (long, comma-laden) are already excluded because
  // looksLikeRealName returns false for them, and they match none of the
  // patterns below, so they get dropped without an explicit address rule.
  return (
    rolePrefix.test(name) ||
    demographicPattern.test(name) ||
    justRole.test(name) ||
    appointmentPattern.test(name) ||
    dateOnlyPattern.test(name) ||
    roleSinceDate.test(name) ||
    statusLabel.test(name) ||
    verificationPattern.test(name)
  );
};

// Normalise an AI-returned date of birth to "YYYY-MM" (year + month only — the
// public registry never exposes the day). Accepts the formats the model tends
// to emit: "YYYY-MM", "YYYY-MM-DD", or "April 1967".
const normaliseDateOfBirth = (value) => {
  if (!value) return "";
  const v = String(value).trim();

  // Already YYYY-MM.
  if (/^\d{4}-\d{2}$/.test(v)) return v;

  // YYYY-MM-DD — strip the day.
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v.slice(0, 7);

  // "April 1967" → "1967-04".
  const monthNames = {
    january: "01", february: "02", march: "03", april: "04",
    may: "05", june: "06", july: "07", august: "08",
    september: "09", october: "10", november: "11", december: "12",
  };
  const match = v.toLowerCase().match(/([a-z]+)\s+(\d{4})/);
  if (match) {
    const month = monthNames[match[1]];
    if (month) return `${match[2]}-${month}`;
  }

  return "";
};

// Format a stored "YYYY-MM" (or "YYYY-MM-DD") date of birth as a human-readable
// "April 1967" for display in the Fill Gaps locked field.
const formatDOBForDisplay = (dobString) => {
  if (!dobString) return "";
  const [year, month] = String(dobString).split("-");
  const months = [
    "", "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  const monthName = months[parseInt(month, 10)] || month;
  return year ? `${monthName} ${year}`.trim() : "";
};

// Parse a legacy free-text stakeholder string ("John Smith (CEO), Jane Doe (CFO)")
// into structured stakeholder records. Handles a JSON-encoded array as well, so
// the same parser covers both "string from old KV" and "JSON string the model
// returned despite the array instruction".
const parseStakeholdersFromString = (rawString, source, sourceUrl, sourceTier, fetchedAt) => {
  if (rawString == null) return [];
  if (Array.isArray(rawString)) {
    return rawString
      .map((p) => makeStakeholder({
        full_name: p.full_name || p.name || "",
        role: p.role || p.position || p.title || "",
        share_percentage: p.share_percentage != null ? p.share_percentage : (p.percentage != null ? p.percentage : null),
        // Pre-populate nationality / DOB / country of residence the AI returned
        // alongside the name so the customer doesn't have to re-enter what was
        // already found on the registry.
        nationality: p.nationality || "",
        date_of_birth: p.date_of_birth ? normaliseDateOfBirth(p.date_of_birth) : "",
        residential_country: p.country_of_residence || p.residential_country || p.residence || "",
        source: source || p.source || "",
        sourceUrl: sourceUrl || p.sourceUrl || "",
        sourceTier: sourceTier || p.sourceTier || "tier1",
        fetchedAt: fetchedAt || p.fetchedAt || null,
      }))
      .filter((s) => s.full_name)
      .filter((s) => !isRegistryExemptionNotice(s))
      // Drop entries where the "name" is a demographic description, e.g.
      // "Director (British national, born April 1967)".
      .filter((s) => !isDescriptionNotName(s.full_name));
  }
  if (typeof rawString !== "string") return [];
  const trimmed = rawString.trim();
  if (!trimmed) return [];

  // JSON-encoded array fallback (some models return the array as a string).
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parseStakeholdersFromString(parsed, source, sourceUrl, sourceTier, fetchedAt);
      }
    } catch (_) { /* fall through to plain-text parser */ }
  }

  // Split on newlines / semicolons first; if it's a single line, split on
  // ", " followed by an uppercase letter (a likely name boundary). This avoids
  // breaking "Smith, Jr." style fragments mid-name.
  const lines = trimmed.split(/\n|;/).map((l) => l.trim()).filter(Boolean);
  const entries = lines.length > 1 ? lines : trimmed.split(/,\s*(?=[A-Z])/).map((l) => l.trim()).filter(Boolean);

  return entries.map((entry) => {
    // Remove leading numbering: "1. " "1) " "- "
    const cleaned = entry.replace(/^[\d]+[.)]\s*/, "").replace(/^[-•]\s*/, "").trim();

    // "Name (45%)" — capture percentage
    const pctMatch = cleaned.match(/^(.+?)\s*\((\d+(?:\.\d+)?)\s*%\)\s*$/);
    if (pctMatch) {
      return makeStakeholder({
        full_name: pctMatch[1].trim(),
        role: "",
        share_percentage: parseFloat(pctMatch[2]),
        source: source || "",
        sourceUrl: sourceUrl || "",
        sourceTier: sourceTier || "tier1",
        fetchedAt: fetchedAt || null,
      });
    }

    // "Name (Role)" — capture role from brackets
    const bracketMatch = cleaned.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
    if (bracketMatch) {
      return makeStakeholder({
        full_name: bracketMatch[1].trim(),
        role: bracketMatch[2].trim(),
        source: source || "",
        sourceUrl: sourceUrl || "",
        sourceTier: sourceTier || "tier1",
        fetchedAt: fetchedAt || null,
      });
    }

    // "Name — Role" or "Name - Role"
    const dashMatch = cleaned.match(/^(.+?)\s*[—-]\s*(.+)$/);
    if (dashMatch) {
      return makeStakeholder({
        full_name: dashMatch[1].trim(),
        role: dashMatch[2].trim(),
        source: source || "",
        sourceUrl: sourceUrl || "",
        sourceTier: sourceTier || "tier1",
        fetchedAt: fetchedAt || null,
      });
    }

    return makeStakeholder({
      full_name: cleaned,
      source: source || "",
      sourceUrl: sourceUrl || "",
      sourceTier: sourceTier || "tier1",
      fetchedAt: fetchedAt || null,
    });
  })
    .filter((s) => s.full_name.length > 0)
    .filter((s) => !isRegistryExemptionNotice(s))
    .filter((s) => !isDescriptionNotName(s.full_name));
};

// Augment a research-result list with parsed .stakeholders arrays for any
// stakeholder field. Idempotent — items that already have a .stakeholders
// array pass through unchanged.
// Heuristic: is this stakeholder a company rather than a natural person?
// Matches a corporate suffix in the name OR a company-ish role word.
const looksLikeCompany = (name, role) => {
  const n = String(name || "").toUpperCase();
  const r = String(role || "").toLowerCase();
  const suffix = /\b(LIMITED|LTD|PLC|LLP|LLC|HOLDINGS?|CORPORATION|CORP|INC|GMBH|B\.?V\.?|S\.?A\.?|PTE|PTY|AG|NV|OY|GROUP|COMPANY|CO)\b/.test(n);
  const roleHit = /compan|holding|parent|corporat|entity|trust|fund|partnership|\bllp\b|subsidiary/.test(r);
  return suffix || roleHit;
};

// Normalise a stakeholder's type: set is_company (heuristic for AI-found,
// honoured verbatim for customer-added), and for companies seed `positions`
// from the legacy single `role` so the corporate form has something to show.
// Idempotent — safe to run on every re-enrichment.
const normalizeStakeholderType = (s) => {
  if (!s) return s;
  const isCompany =
    s.is_company === true ||
    (!s.customer_added && looksLikeCompany(s.full_name, s.role));
  if (!isCompany) return { ...s, is_company: false };
  const positions =
    Array.isArray(s.positions) && s.positions.length > 0
      ? s.positions
      : s.role
      ? [{ title: s.role, start_date: "" }]
      : [];
  return { ...s, is_company: true, positions };
};

const enrichStakeholders = (items) => {
  if (!Array.isArray(items)) return items;
  return items.map((item) => {
    if (!item || !isStakeholderField(item.field)) return item;
    const base =
      Array.isArray(item.stakeholders) && item.stakeholders.length > 0
        ? item.stakeholders
        : parseStakeholdersFromString(
            item.value,
            item.source,
            item.sourceUrl,
            item.sourceTier,
            item.fetchedAt,
          );
    const stakeholders = base.map(normalizeStakeholderType);
    return { ...item, stakeholders };
  });
};

// ── Publicly-listed detection ───────────────────────────────────────────
// Decide whether the company being onboarded is publicly listed, from the
// research.found rows. Strong signals (A, B) are each sufficient on their own;
// medium signals (C–F) need at least two together. Note: research rows here
// use `.field` (not `.fieldId`). The field-id lists below include both the
// canonical ids from the spec and the real schema ids in this codebase
// (e.g. corporate uses `stockListing` / `listedExchange`, `businessType`).
const detectPubliclyListed = (research) => {
  if (!research || !Array.isArray(research.found) || research.found.length === 0) return false;

  const found = research.found;

  // ── STRONG SIGNALS — either alone confirms ──
  // Signal A: publicly_listed field = "Yes" from a tier1 source
  const listedField = found.find((r) => r.field === "publicly_listed");
  if (listedField) {
    const val = (listedField.value || "").toLowerCase().trim();
    if ((val === "yes" || val === "true") && listedField.sourceTier === "tier1") {
      return true;
    }
    // Explicitly not listed — return false early so medium signals don't override.
    if (val === "no" || val === "false" || val === "not listed" || val === "n/a") {
      return false;
    }
  }

  // Signal B: an exchange / listing field carries a real value
  const exchangeField = found.find((r) =>
    r.field === "listed_exchange" ||
    r.field === "listed_where" ||
    r.field === "stock_exchange" ||
    r.field === "listedExchange" ||
    r.field === "stockListing"
  );
  if (exchangeField) {
    const val = (exchangeField.value || "").toLowerCase().trim();
    const notListed = ["", "n/a", "not listed", "none", "not applicable", "private", "no", "—", "-"];
    if (val && !notListed.includes(val)) {
      return true;
    }
  }

  // ── MEDIUM SIGNALS — need at least two together ──
  let mediumSignals = 0;

  // Signal C: a source URL / name matches a known exchange domain
  const exchangeDomains = [
    "londonstockexchange", "lseg.com", "nasdaq.com", "nyse.com", "sgx.com",
    "hkex.com", "asx.com.au", "euronext.com", "deutsche-boerse", "six-group.com",
    "jpx.co.jp", "krx.co.kr", "tse.com.tw", "bseindia.com", "nseindia.com",
    "bursamalaysia.com", "idx.co.id",
  ];
  const hasExchangeSource = found.some((r) => {
    const src = ((r.source || "") + " " + (r.sourceUrl || "")).toLowerCase();
    return exchangeDomains.some((d) => src.includes(d));
  });
  if (hasExchangeSource) mediumSignals++;

  // Signal D: legal_form / businessType indicates a public company
  const legalFormField = found.find((r) => r.field === "legal_form" || r.field === "businessType");
  if (legalFormField) {
    const val = (legalFormField.value || "").toLowerCase();
    const publicForms = ["plc", "public limited", "public limited company", "publicly traded", "listed company"];
    if (publicForms.some((f) => val.includes(f))) {
      mediumSignals++;
    }
  }

  // Signal E: company name ends with PLC
  const nameField = found.find((r) =>
    r.field === "legal_name" ||
    r.field === "company_name" ||
    r.field === "business_name" ||
    r.field === "tradeName"
  );
  const candidateName = (nameField && nameField.value) || research.companyName || "";
  const nm = String(candidateName).trim();
  if (nm.endsWith(" PLC") || nm.endsWith(" plc") || nm.endsWith(" Plc")) {
    mediumSignals++;
  }

  // Signal F: legal_form stored as the dropdown value "public_limited"
  if (legalFormField) {
    const val = (legalFormField.value || "").toLowerCase();
    if (val === "public_limited") {
      mediumSignals++;
    }
  }

  return mediumSignals >= 2;
};

// Determine whether a specific stakeholder needs the full gap form on Fill Gaps.
//   Private company                       → always needs details
//   Listed company + director/officer     → skip details
//   Listed company + UBO with  < 25%      → skip
//   Listed company + UBO with >= 25%      → needs details
//   Listed company + UBO with unknown %   → needs details (conservative)
const needsStakeholderDetails = (stakeholder, fieldId, isPubliclyListed) => {
  if (!isPubliclyListed) return true;

  // Listed company: only beneficial owners / shareholders can require details.
  if (!isUboLikeField(fieldId)) return false;

  const pct = stakeholder ? stakeholder.share_percentage : null;
  if (pct === null || pct === undefined) return true; // unknown — conservative

  return Number(pct) >= 25;
};

// Record which signals triggered the listed-company detection, for the
// submission payload's audit trail.
const detectListingEvidence = (research) => {
  const evidence = [];
  const found = (research && research.found) || [];

  const listedField = found.find((r) => r.field === "publicly_listed");
  if (listedField && (listedField.value || "").toLowerCase().trim() === "yes") {
    evidence.push({ signal: "publicly_listed_field", value: listedField.value, source: listedField.source });
  }

  const exchangeField = found.find((r) =>
    r.field === "listed_exchange" ||
    r.field === "listed_where" ||
    r.field === "stock_exchange" ||
    r.field === "listedExchange" ||
    r.field === "stockListing"
  );
  if (exchangeField && exchangeField.value) {
    evidence.push({ signal: "exchange_field", value: exchangeField.value, source: exchangeField.source });
  }

  return evidence;
};

/* ═══════════════════════════════════════════
   CONFIG-DRIVEN HELPERS

   The customer flow now reads its definitions from a tenant config
   loaded via /api/config. These helpers compose the active schema,
   source classifier, and document list from that config object,
   falling back to the hardcoded constants above when the config has
   no entry for a given combination.
   ═══════════════════════════════════════════ */

// Apply the configured routing policy to pick the licence for a customer
// country. "regional" matches the country to a licence's countriesCovered;
// "global" always returns the primary licence.
const pickLicence = (countryCode, tenantConfig) => {
  const licences = tenantConfig?.licences || [];
  if (!licences.length) return null;
  const primary = licences.find(l => l.isPrimary) || licences[0];
  if (tenantConfig?.routingPolicy === "global") return primary;
  const match = licences.find(l => Array.isArray(l.countriesCovered) && l.countriesCovered.includes(countryCode));
  return match || primary;
};

// Infer a section for a field that doesn't have one. Used as a fallback for
// legacy configs in KV that were saved before research fields were grouped
// into sections — so the Confirm and Fill Gaps pages still render address
// fields in their own block instead of dumping everything into "Other".
const inferSection = (fieldId) => {
  if (!fieldId) return null;
  const id = String(fieldId);
  // Registered address — both snake_case (fi) and camelCase (corporate) shapes.
  if (/^registered_address_/.test(id)) return "registered_address";
  if (/^(addressLine\d|city|state|postcode|country)$/.test(id)) return "registered_address";
  // Business address gap fields.
  if (/^business_address_/.test(id)) return "business_address";
  return null;
};

// Normalise a single field definition coming out of admin/seed config so the
// customer flow can consume it uniformly. Three things change:
//   1. showIf/showWhen (admin SchemaFieldPanel's representation) is translated
//      to dependsOn:{ [key]: value } — what dependsOnSatisfied() expects.
//   2. options are coerced to { value, label } objects so the renderer can
//      treat string and object option shapes the same way downstream. Legacy
//      hardcoded gap fields use plain strings (e.g. ["Yes","No"]); admin-saved
//      fields use { value, label } objects.
//   3. Missing section is inferred from the field id (legacy configs in KV
//      pre-date the section grouping).
const normaliseField = (f) => {
  if (!f) return f;
  const out = { ...f };
  if (!out.dependsOn && out.showIf && out.showWhen) {
    out.dependsOn = { [out.showIf]: out.showWhen };
  }
  if (out.inputType === "select" && Array.isArray(out.options)) {
    out.options = out.options.map((o) => {
      if (typeof o === "string") return { value: o, label: o };
      if (o && typeof o === "object") {
        const value = o.value !== undefined && o.value !== null ? o.value : o.label;
        const label = o.label !== undefined && o.label !== null ? o.label : String(value);
        return { value, label };
      }
      return { value: String(o), label: String(o) };
    });
  }
  if (!out.section) {
    const inferred = inferSection(out.field);
    if (inferred) out.section = inferred;
  }
  return out;
};

// Look up the schema for an entity-type + customer-country combination.
// Returns a fully-formed schema object compatible with the rest of the app
// (label, region, flow, jurisdiction, researchFields, gapFields). Every
// field is run through normaliseField so the customer renderers can rely on
// a single shape regardless of which source (admin/seed/legacy) wrote it.
const getSchemaFromConfig = (countryCode, entityTypeId, tenantConfig) => {
  if (!tenantConfig) return getSchema(countryCode, entityTypeId);
  const licence = pickLicence(countryCode, tenantConfig);
  if (!licence) return getSchema(countryCode, entityTypeId);
  const key = `${entityTypeId}:${licence.id}`;
  const stored = tenantConfig.schemas?.[key];
  if (!stored) return getSchema(countryCode, entityTypeId);
  // flow heuristic: FI entity types use the FI flow; others are corporate.
  const flow = entityTypeId === "FI" ? "fi" : "corporate";
  return {
    label: `${licence.jurisdictionName || licence.id}${flow === "fi" ? " (FI)" : ""}`,
    region: licence.jurisdictionCode === "GB" ? "UK" : (licence.jurisdictionCode || "SG"),
    jurisdiction: licence.jurisdictionCode || licence.id,
    licenceId: licence.id,
    flow,
    researchFields: (stored.researchFields || []).map(normaliseField),
    gapFields: (stored.gapFields || []).map(normaliseField),
  };
};

// Find the active definition for a research/gap field id, used by Confirm and
// FillGaps so the renderer can resolve inputType, options, dependsOn etc.
const findFieldDef = (schema, fieldId) => {
  if (!schema || !fieldId) return null;
  return (
    (schema.researchFields || []).find((f) => f.field === fieldId) ||
    (schema.gapFields || []).find((f) => f.field === fieldId) ||
    null
  );
};

// Coerce a date value (any common AI/free-text format) into the strict
// YYYY-MM-DD shape that <input type="date"> requires. Returns "" when the
// value is unparseable, so an invalid date doesn't show as a stale string
// in the date picker.
const normaliseDate = (value) => {
  if (value == null) return "";
  const s = String(value).trim();
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const parsed = new Date(s);
  if (isNaN(parsed.getTime())) return "";
  const y = parsed.getFullYear();
  const m = String(parsed.getMonth() + 1).padStart(2, "0");
  const d = String(parsed.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

// Normalise a stored inputType to a canonical lowercase token. The admin
// SchemaFieldPanel writes lowercase already, but this acts as a safety net
// against hand-edited config / legacy data using "Date" / "  date " etc.
const fieldTypeOf = (field) => {
  const raw = (field && (field.inputType || field.type)) || "text";
  return String(raw).toLowerCase().trim();
};

// Display value resolver for the Confirm page. For dropdown fields, the AI
// (or document extraction) may return either the option value, the option
// label, or a free-text variant — collapse all three to the option label so
// the customer sees a sensible string. Date fields are reformatted to a
// human-readable string (e.g. "12 January 2005") rather than leaving the
// YYYY-MM-DD wire format on display.
const resolveDisplayValue = (fieldDef, rawValue) => {
  const v = rawValue == null ? "" : String(rawValue);
  const t = fieldTypeOf(fieldDef);
  if (t === "date") {
    if (!v) return "—";
    const iso = normaliseDate(v);
    if (iso) {
      try {
        return new Date(iso + "T00:00:00").toLocaleDateString("en-GB", {
          day: "numeric", month: "long", year: "numeric",
        });
      } catch (_) { /* fall through to raw value */ }
    }
    return v;
  }
  if (t !== "select") return v || "—";
  const opts = Array.isArray(fieldDef.options) ? fieldDef.options : [];
  if (!opts.length) return v || "—";
  const lc = v.toLowerCase();
  const exact = opts.find((o) => String(o.value).toLowerCase() === lc);
  if (exact) return exact.label;
  const byLabel = opts.find((o) => String(o.label).toLowerCase() === lc);
  if (byLabel) return byLabel.label;
  const partial = opts.find((o) => {
    const ol = String(o.label).toLowerCase();
    return ol && (ol.includes(lc) || lc.includes(ol));
  });
  if (partial) return partial.label;
  return v || "—";
};

// Coerce free-text AI values into one of the configured option values for any
// research field that is a dropdown. Mirrors resolveDisplayValue's matching
// strategy but rewrites item.value to the canonical option.value so the gap
// form's select can pre-select correctly when the customer unchecks. Keeps a
// breadcrumb (originalAIValue / unmappedDropdown) for audit/debug.
const mapAIValuesToOptions = (foundItems, schema) => {
  if (!Array.isArray(foundItems)) return foundItems;
  return foundItems.map((item) => {
    const def = findFieldDef(schema, item && item.field);
    const defType = fieldTypeOf(def);
    if (defType === "date") {
      const raw = item.value == null ? "" : String(item.value);
      const iso = normaliseDate(raw);
      if (iso && iso !== raw) return { ...item, value: iso, originalAIValue: raw };
      return iso ? { ...item, value: iso } : item;
    }
    if (!def || defType !== "select") return item;
    const opts = Array.isArray(def.options) ? def.options : [];
    if (!opts.length) return item;
    const raw = item.value == null ? "" : String(item.value);
    const lc = raw.toLowerCase();
    const exact = opts.find((o) => String(o.value).toLowerCase() === lc);
    if (exact) return { ...item, value: exact.value };
    const byLabel = opts.find((o) => String(o.label).toLowerCase() === lc);
    if (byLabel) return { ...item, value: byLabel.value, originalAIValue: raw };
    const partial = opts.find((o) => {
      const ol = String(o.label).toLowerCase();
      return ol && (ol.includes(lc) || lc.includes(ol));
    });
    if (partial) return { ...item, value: partial.value, originalAIValue: raw };
    return { ...item, unmappedDropdown: true };
  });
};

// Classify a source string (e.g. "Companies House" or a URL) using the
// tenant's primary/secondary patterns. Falls back to the hardcoded
// SOURCE_TRUST tables when the config has no matching pattern, which keeps
// jurisdiction-specific authoritative recognition working.
// Known third-party domains/keywords — always tier 3 regardless of where they
// sit in a (possibly stale) config, so e.g. LinkedIn never ranks as tier 2.
const THIRD_PARTY_PATTERNS = [
  "linkedin", "wikipedia", "crunchbase", "bloomberg", "reuters",
  "news article", "business directory", "directory", "facebook", "twitter",
];
// Company-owned hints — tier 2 fallback when the config doesn't list them.
const COMPANY_OWNED_PATTERNS = [
  "corporate website", "investor relations", "annual report", "about us",
  "own website", "company website", "press release", "careers",
];

// Three-tier source classification (tier1 official → tier2 company-owned →
// tier3 third-party/unverified). Signature is kept as (source, countryCode,
// tenantConfig) so existing call sites keep working; the countryCode feeds the
// hardcoded authoritative fallback. Defaults to tier3 (indicative).
const classifySourceFromConfig = (source, countryCode, tenantConfig) => {
  if (!source || typeof source !== "string") return "tier3";
  const s = source.toLowerCase().trim();

  // Documents always count as tier 1 (verified).
  if (s.includes("uploaded") || s.includes("wolfsberg") || s.includes("certificate") || s.includes("(document)")) {
    return "tier1";
  }

  const tiers = tenantConfig?.sourceTiers;

  // Tier 1 — official registries/regulators/exchanges (config primary).
  if (tiers) {
    for (const entry of (tiers.primary || [])) {
      if (entry.active !== false && entry.pattern && s.includes(String(entry.pattern).toLowerCase())) return "tier1";
    }
  }
  // Hardcoded authoritative fallback so a stale config still flags tier 1.
  if (classifySource(source, countryCode) === "authoritative") return "tier1";

  // Tier 3 — known third-party domains, checked BEFORE config secondary so a
  // stale config that still lists these as "secondary" can't mis-rank them.
  if (THIRD_PARTY_PATTERNS.some((p) => s.includes(p))) return "tier3";
  if (tiers) {
    for (const entry of (tiers.tertiary || [])) {
      if (entry.active !== false && entry.pattern && s.includes(String(entry.pattern).toLowerCase())) return "tier3";
    }
  }

  // Tier 2 — company-owned (config secondary, skipping any stale third-party).
  if (tiers) {
    for (const entry of (tiers.secondary || [])) {
      const p = entry.pattern ? String(entry.pattern).toLowerCase() : "";
      if (!p || entry.active === false) continue;
      if (THIRD_PARTY_PATTERNS.some((tp) => p.includes(tp))) continue;
      if (s.includes(p)) return "tier2";
    }
  }
  if (COMPANY_OWNED_PATTERNS.some((p) => s.includes(p))) return "tier2";

  // Default: tier 3 (indicative).
  return "tier3";
};

// Map a source tier to the customer-facing verification status.
const getVerificationStatus = (sourceTier) => {
  switch (sourceTier) {
    case "document":
    case "tier1": return "verified";
    case "tier2": return "probable";
    case "tier3": return "indicative";
    default: return "indicative";
  }
};

/* ═══════════════════════════════════════════
   PHASE 2 — COVERAGE ANALYSIS
   Research rows carry `.field` (not `.fieldId`) in this codebase, and schema
   research fields key off `.field` too — the helpers below use those.
   ═══════════════════════════════════════════ */
function computeCoverage(found, schema) {
  const list = Array.isArray(found) ? found : [];
  const allResearchFields = (schema && schema.researchFields) || [];
  // Customer-supplied fields (forward-looking projections, private
  // counterparties, declarations — flagged customerSupplied:true, see
  // benchmark/fi-schema-fields-patch.js) belong to the "human half" of the
  // form. They are excluded from the researchable denominator so they don't
  // depress fill rates, excluded from missingFields so the gap-recovery pass
  // never auto-researches them, and any row that somehow lands on one is
  // excluded from the numerator so fillRate can't exceed 1.
  const researchFields = allResearchFields.filter((f) => !f.customerSupplied);
  const customerSuppliedIds = new Set(
    allResearchFields.filter((f) => f.customerSupplied).map((f) => f.field)
  );
  const totalResearchFields = researchFields.length;
  const customerSuppliedFieldCount = allResearchFields.length - totalResearchFields;

  const relevant = list.filter((r) => !customerSuppliedIds.has(r.field));
  const populatedFields = relevant.length;

  const verifiedFields = relevant.filter((r) => r.verificationStatus === "verified").length;
  const probableFields = relevant.filter((r) => r.verificationStatus === "probable").length;
  const indicativeFields = relevant.filter((r) => r.verificationStatus === "indicative").length;

  const foundIds = new Set(relevant.map((r) => r.field));
  const missingFields = researchFields.filter((f) => !foundIds.has(f.field));

  const fillRate = totalResearchFields > 0 ? populatedFields / totalResearchFields : 0;
  const verifiedFillRate = totalResearchFields > 0 ? verifiedFields / totalResearchFields : 0;

  return {
    totalResearchFields,
    customerSuppliedFieldCount,
    populatedFields,
    verifiedFields,
    probableFields,
    indicativeFields,
    missingFieldCount: missingFields.length,
    missingFields,
    fillRate,
    verifiedFillRate,
  };
}

// Fields likely findable at tier1/tier2 if searched more specifically — used to
// pick tier3 rows worth re-attempting in the gap-recovery pass. Covers both the
// FI and corporate schema field ids in this codebase.
const UPGRADEABLE_FIELDS = new Set([
  "business_name", "legal_name", "company_name", "tradeName", "trading_name",
  "registration_number", "businessRegistrationNumber",
  "incorporation_date", "registeredDate",
  "registered_address_line1", "addressLine1", "registered_address_country",
  "legal_form", "businessType",
  "regulatory_authority", "has_licence", "licence_number",
  "annual_turnover", "annualRevenue", "employee_count", "employees",
  "director_names", "directors_full_details", "ubo_parent_company", "ubo_names", "shareholders",
  "business_activity_description", "industry_sector", "operating_countries",
]);
function hasPlausibleHigherTierSource(fieldId) {
  return UPGRADEABLE_FIELDS.has(fieldId);
}

// Targeted Phase 3 prompt — only the gap-recovery fields.
function buildGapRecoveryPrompt(company, missingFields, upgradeableFields, strategy) {
  const allTargets = [...missingFields, ...upgradeableFields];
  return (
    `GAP RECOVERY RESEARCH\n` +
    `Company: ${company.name} (${company.countryName})\n` +
    `Ownership: ${strategy ? strategy.ownershipTypeLabel : "Unknown"}\n` +
    `\n` +
    `The initial research pass found limited data. Please make targeted searches for the following specific fields only.\n` +
    `\n` +
    `For private companies: prioritise the company website, about page, legal page, and careers page.\n` +
    `\n` +
    `Fields to find:\n` +
    allTargets
      .map((f) => {
        let desc = `- "${f.label}" (id: ${f.field})`;
        if (f.searchHint) desc += `\n  Hint: ${f.searchHint}`;
        return desc;
      })
      .join("\n") +
    `\n\nReturn ONLY valid JSON of the form {"found":[{"field":"<id>","label":"...","value":"...","source":"...","sourceUrl":"..."}]}. ` +
    `Return ONLY fields you can find with reasonable confidence. Do not guess or fabricate values. No markdown, no backticks.`
  );
}

// Merge gap-recovery results into the existing set: brand-new fields are added;
// a field already present is replaced ONLY when the new row has a strictly
// higher source tier (records the upgrade for the audit trail).
function mergeResearchResults(existing, newResults) {
  const merged = [...existing];
  const tierRank = { document: 4, tier1: 3, tier2: 2, tier3: 1 };
  (newResults || []).forEach((newResult) => {
    const existingIdx = merged.findIndex((r) => r.field === newResult.field);
    if (existingIdx === -1) {
      merged.push(newResult);
    } else {
      const prev = merged[existingIdx];
      if ((tierRank[newResult.sourceTier] || 0) > (tierRank[prev.sourceTier] || 0)) {
        merged[existingIdx] = {
          ...newResult,
          upgradedFrom: prev.sourceTier,
          previousSource: prev.source,
        };
      }
    }
  });
  return merged;
}

// Web-search tool config for the research calls. max_uses is deliberately
// higher than the proxy/server default (5) so the model has budget to run a
// dedicated search for the company's FULL officer/PSC list on top of the
// per-field searches. Without this, large companies (many officers across
// paginated registry pages) come back with only the handful of directors that
// happened to appear in a single search snippet.
const RESEARCH_TOOLS = [{ type: "web_search_20250305", name: "web_search", max_uses: 8 }];

const buildPrompt = (name, country, countryCode, schema, wolfsbergFields, ownershipType) => {
  // Customer-supplied fields (customerSupplied / doNotAutoResearch — see
  // benchmark/fi-schema-fields-patch.js) are never auto-researched. They are
  // omitted from the JSON template and every guide block below, so the agent
  // is never even asked for them. This matters most for declaration fields
  // like criminal-conviction status, which must stay self-declared.
  const researchableFields = schema.researchFields.filter(
    (f) => !f.customerSupplied && !f.doNotAutoResearch
  );
  // Stakeholder fields (directors / UBOs / shareholders / signatories) return
  // a JSON array per person, not a string. Other fields keep the legacy
  // "value": "..." string shape so the prompt and downstream parsing stay
  // unchanged for them.
  const fieldList = researchableFields.map((f) => {
    if (isStakeholderField(f.field)) {
      const example = isUboLikeField(f.field)
        ? '[{"full_name": "Jane Smith", "role": "Shareholder", "share_percentage": 45}]'
        : '[{"full_name": "Jane Smith", "role": "CEO"}]';
      return `    {"field": "${f.field}", "label": "${f.label}", "value": ${example}, "source": "..."}`;
    }
    return `    {"field": "${f.field}", "label": "${f.label}", "value": "...", "source": "..."}`;
  }).join(",\n");

  // Per-field rules for stakeholder fields, appended after the schema guide so
  // the model sees them next to the JSON template.
  const stakeholderRules = researchableFields
    .filter((f) => isStakeholderField(f.field))
    .map((f) => {
      // UBO / beneficial-owner / shareholder fields: each entry may be a
      // person OR a corporate entity. Pulled from the PSC register.
      if (isUboLikeField(f.field)) {
        let desc = `- "${f.label}" (id: ${f.field})\n`;
        desc += `  IMPORTANT: Return as a JSON array.\n`;
        desc += `  Each entry is either a PERSON or a CORPORATE ENTITY.\n`;
        desc += `  Each object must have:\n`;
        desc += `  {\n`;
        desc += `    "full_name": the actual name — either a person's legal name OR a company name (e.g. "VODAFONE UK TRADING HOLDINGS LIMITED"). NEVER use a demographic description.\n`;
        desc += `    "role": "Person with Significant Control" or "Corporate Entity" or equivalent\n`;
        desc += `    "share_percentage": number if available (e.g. 75 for 75%)\n`;
        desc += `    "nationality": if person and available\n`;
        desc += `    "date_of_birth": "YYYY-MM" if person and available\n`;
        desc += `    "country_of_residence": if person and shown on the register (e.g. "United Kingdom")\n`;
        desc += `  }\n`;
        desc += `  SOURCE: ${country}'s official register of persons with significant control / beneficial ownership.`;
        if (countryCode === "GB") {
          desc += ` For the UK this is the Companies House PSC register at:\n`;
          desc += `  https://find-and-update.company-information.service.gov.uk/company/{COMPANY_NUMBER}/persons-with-significant-control\n`;
        } else {
          desc += `\n`;
        }
        desc += `  For corporate entities, the "full_name" is the company name.\n`;
        desc += `  ONLY include current/active PSCs — ignore ceased ones.\n`;
        desc += `  COMPLETENESS: return EVERY current PSC / beneficial owner you can find, not just the first. Read the full register before answering and do not truncate the array.\n`;
        if (f.searchHint) {
          desc += `  Additional hint: ${f.searchHint}\n`;
        }
        return desc;
      }

      // Director / officer fields: actual person name extraction. The model
      // must return the NAME, never the demographic description shown beside it.
      let desc = `- "${f.label}" (id: ${f.field})\n`;
      desc += `  IMPORTANT: Return as a JSON array.\n`;
      desc += `  Each object must have:\n`;
      desc += `  {\n`;
      desc += `    "full_name": "SURNAME, Firstname" or "Firstname Surname" — the ACTUAL person's legal name as it appears on the registry. NEVER use a description like "Director (British national)" as the name.\n`;
      desc += `    "role": "Director" or "Secretary" etc.\n`;
      desc += `    "nationality": "British" or equivalent — OPTIONAL, include only if shown\n`;
      desc += `    "date_of_birth": "YYYY-MM" — OPTIONAL. Include it when the registry shows a date of birth (Companies House shows "Month YYYY" for person directors; year and month only — do not guess the day)\n`;
      desc += `    "country_of_residence": the officer's country of residence (e.g. "United Kingdom", "England") — OPTIONAL, include only if shown\n`;
      desc += `  }\n`;
      desc += `  REQUIRED vs OPTIONAL: only "full_name" (and ideally "role") is required per officer. "nationality", "date_of_birth" and "country_of_residence" are OPTIONAL — include them when the registry shows them, otherwise simply omit that one key. NEVER drop an officer from the array just because their nationality, date of birth, or country of residence is missing. Always list the officer with whatever fields you do have.\n`;
      desc += `  SOURCE: ${country}'s official company officers register.`;
      if (countryCode === "GB") {
        desc += ` For the UK this is the Companies House officers page at:\n`;
        desc += `  https://find-and-update.company-information.service.gov.uk/company/{COMPANY_NUMBER}/officers\n`;
        desc += `  Look for the "People" or "Officers" section. Each officer entry shows: NAME (in large text), Role, Date of birth, Nationality, Country of residence.\n`;
        desc += `\n  COMPANIES HOUSE PAGE STRUCTURE:\n`;
        desc += `  Each officer entry on the page looks like this:\n`;
        desc += `  ---\n`;
        desc += `  [SURNAME, Firstname Middlename]  ← THIS is the full_name\n`;
        desc += `  Correspondence address: [address]\n`;
        desc += `  Role: Director / Secretary\n`;
        desc += `  Date of birth: [Month YYYY]\n`;
        desc += `  Appointed on: [date]          ← NOT the name\n`;
        desc += `  Nationality: [nationality]    ← goes in nationality field\n`;
        desc += `  Country of residence: [country]\n`;
        desc += `  ---\n`;
        desc += `  EXAMPLE correct output:\n`;
        desc += `  [\n`;
        desc += `    {\n`;
        desc += `      "full_name": "GLIDDON, Nicholas Francis",\n`;
        desc += `      "role": "Director",\n`;
        desc += `      "nationality": "British",\n`;
        desc += `      "date_of_birth": "1967-04",\n`;
        desc += `      "country_of_residence": "United Kingdom"\n`;
        desc += `    },\n`;
        desc += `    {\n`;
        desc += `      "full_name": "TAYLOR, Max",\n`;
        desc += `      "role": "Director",\n`;
        desc += `      "nationality": "British",\n`;
        desc += `      "date_of_birth": "1974-05",\n`;
        desc += `      "country_of_residence": "England"\n`;
        desc += `    }\n`;
        desc += `  ]\n`;
      } else {
        desc += `\n`;
      }
      desc += `  CRITICAL: The NAME field is always the person's actual name (e.g. "GLIDDON, Nicholas Francis" or "TAYLOR, Max"). It is NEVER a demographic description.\n`;
      desc += `  NEVER put appointment dates, addresses, status labels ("Active"/"Resigned"), or "Appointed on XX" in the full_name field.\n`;
      desc += `  NAME ONLY: if an officer entry shows demographic details (nationality, birth month) but you genuinely cannot determine the person's NAME, do NOT invent a name — omit just that one nameless entry. This rule is about a MISSING NAME only: never omit an officer who HAS a name but is missing other details.\n`;
      desc += `  ONLY include current/active officers — ignore resigned officers.\n`;
      desc += `  COMPLETENESS — this matters most: a company normally has SEVERAL current/active officers. Return EVERY active officer, not just the first one or two you see, and INCLUDE an officer even if all you have is their name and role. Run a dedicated search for this company's officers (e.g. "${name} officers${countryCode === "GB" ? " Companies House" : ""}") and read the FULL active-officers list — registry officer lists are often long and paginated, with resigned officers mixed in. Keep going until you have listed all currently-appointed officers. Do not truncate the array, and do not trade list completeness for per-officer detail.\n`;
      if (f.searchHint) {
        desc += `  Additional hint: ${f.searchHint}\n`;
      }
      return desc;
    })
    .join("\n");
  const stakeholderRulesBlock = stakeholderRules
    ? `\nSTAKEHOLDER FIELDS — return structured per-person data:\n${stakeholderRules}\n`
    : "";

  const countryAuthoritative = SOURCE_TRUST[countryCode] || [];
  const countryMatchesFramework = countryCode === "GB" || countryCode === "SG";
  const preferredLine = countryAuthoritative.length > 0
    ? `Preferred authoritative sources for ${country}: ${countryAuthoritative.slice(0, 8).join(", ")}.`
    : `No specific registry list provided for ${country} — use the country's national company registry, securities regulator, and tax authority.`;

  const fieldGuide = researchableFields
    .filter(f => f.searchHint)
    .map(f => `- ${f.field}: ${f.searchHint}`)
    .join("\n");
  const fieldGuideBlock = fieldGuide
    ? `\nFIELD SEARCH GUIDE — for each field, here is where/what to look for:\n${fieldGuide}\n`
    : "";

  // Dropdown fields are stricter than free-text: the AI must return one of
  // the configured option values verbatim so the customer-side select can
  // pre-select. List every dropdown's options explicitly so the model
  // doesn't have to guess at the wire format.
  const dropdownGuide = researchableFields
    .filter(f => f.inputType === "select" && Array.isArray(f.options) && f.options.length)
    .map(f => {
      const opts = f.options
        .map(o => {
          const isObj = o && typeof o === "object";
          const val = isObj ? (o.value !== undefined ? o.value : o.label) : o;
          const lbl = isObj ? (o.label !== undefined ? o.label : o.value) : o;
          return `"${lbl}" → "${val}"`;
        })
        .join(", ");
      return `- ${f.field}: dropdown. Match the closest option and return the VALUE string exactly (left side is the customer-facing label, right side is the value to put in "value"). Options: ${opts}`;
    })
    .join("\n");
  const dropdownGuideBlock = dropdownGuide
    ? `\nDROPDOWN FIELDS — these fields have a fixed list of allowed values:\n${dropdownGuide}\n`
    : "";

  const hasWolfsberg = wolfsbergFields && Object.keys(wolfsbergFields).length > 0;
  const wolfsbergBlock = hasWolfsberg
    ? `\nWOLFSBERG CBDDQ DATA ALREADY EXTRACTED:
The following fields have been extracted from the institution's Wolfsberg questionnaire. Treat these as confirmed values with source = 'Wolfsberg CBDDQ' and sourceTier = 'tier1'. Do not re-search for these fields — focus your web research on finding the remaining fields not covered below.

${JSON.stringify(wolfsbergFields, null, 2)}

When building your results array, include these Wolfsberg fields as results with:
  source: 'Wolfsberg CBDDQ (uploaded)'
  sourceUrl: null
  sourceTier: 'tier1'
  confidence: 'high'

Map Wolfsberg keys onto our schema field ids by name similarity (e.g. legal_name → business_name, parent_company → ubo_parent_company, cross_border_remittances → cross_border_services). Then use web search to find the remaining fields not already answered above.\n`
    : "";

  const fiPrioritySources = schema.flow === "fi"
    ? `\nPRIORITY SOURCES FOR FI RESEARCH — search these in order:
1. Companies House (find-and-update.company-information.service.gov.uk) for UK — gets you: registration number, registered address, incorporation date, directors, PSC/UBO, SIC code
2. FCA Register (register.fca.org.uk) for UK — gets you: FRN, regulatory permissions, any enforcement history
3. MAS Financial Institutions Directory (mas.gov.sg/financial-institutions) for Singapore — gets you: licence type, licence number
4. Annual Report — gets you: employees, turnover, operating countries, products, branch info, cross-border services, customer types, listed status
5. LSE / SGX / stock exchange website — gets you: listing confirmation, exchange name
6. FCA enforcement actions page — gets you: any licence suspensions or regulatory actions

Do NOT leave any of these fields blank without having checked all 5 sources above.\n`
    : "";

  // Phase 0: ownership-type-driven research strategy, injected at the very top
  // so the model tailors its searches (listed vs private vs charity vs branch)
  // before it reads the field list.
  const strategy = ownershipType
    ? computeResearchStrategy(ownershipType, countryCode)
    : null;
  const strategyBlock = strategy
    ? `\nRESEARCH STRATEGY FOR THIS COMPANY:
Company: ${name}
Country: ${country}
Ownership Type: ${strategy.ownershipTypeLabel}

${strategy.strategyNotes}
\n`
    : "";

  return `You are a KYC research agent for Nium.
${strategyBlock}${wolfsbergBlock}
JURISDICTION CONTEXT (read carefully, this is two separate things):
1. Regulatory framework applied: ${schema.label}. This determines what data fields we need to collect.
2. Country of registration: ${country} (${countryCode}). This is where the company actually exists, and therefore WHERE YOU MUST SEARCH FOR DATA.${countryMatchesFramework ? " The framework country and registration country are the same here." : ` Nium has no licence in ${country}, so the ${schema.label} framework defines our requirements, but the company itself is registered in ${country} — its records live in ${country}'s registries, not ${schema.label}'s.`}

WHERE TO SEARCH:
- Search ${country}'s public records, registries, and regulators for "${name}".
- ${preferredLine}
- ALSO acceptable: LEI/GLEIF, company's official website, audited annual reports, official stock exchange filings.
- DO NOT cite registries from countries other than ${country}. For example: do not say "ACRA" or "Companies House" or "SEC EDGAR" unless ${country} actually is Singapore, the UK, or the US respectively. Use the actual ${country} registry name.

LABEL MAPPING:
- The schema labels below are generic. Map each one to the ${country}-specific equivalent in your search and citation. Examples: "Company Registration Number" → CIN (India), CNPJ (Brazil), KvK number (Netherlands), HRB number (Germany), CNPC (China), Sirene (France), etc. "Industry Classification Code" → NIC (India), CNAE (Brazil), NAICS (US/CA), SIC (UK), JSIC (Japan), etc.
${fieldGuideBlock}${dropdownGuideBlock}${stakeholderRulesBlock}${fiPrioritySources}
Research "${name}" registered in ${country} using web search. Return ONLY valid JSON (no markdown, no backticks, no preamble).

{
  "companyName": "Official registered name",
  "jurisdiction": "${schema.region}",
  "countryOfRegistration": "${countryCode}",
  "found": [
${fieldList}
  ]
}

OUTPUT RULES:
- Only include a field in "found" if you have ACTUAL data with a real source. Omit fields you couldn't find rather than inventing values.
- The "source" field must be the actual ${country} authority/source you used (e.g. for India: "Ministry of Corporate Affairs (MCA)", "BSE", "RBI"; for Brazil: "Receita Federal", "CVM"). Never cite a foreign registry that wouldn't have data for ${country}.
- For stakeholder fields (directors / UBOs / shareholders / signatories) "value" MUST be a JSON array of person objects as specified above — NOT a string. For all other fields "value" stays a string.
- Do NOT include a "gaps" array — the client already knows the gap fields from the schema.
- Return ONLY the raw JSON object.`;
};


/* ═══════════════════════════════════════════
   HEADLESS ORCHESTRATOR (for api/benchmark.js)

   A framework-free version of App.js's doResearch(): no document uploads, no
   UI/state — just the research → coverage → gap-recovery → classification
   sequence. The HTTP call is INJECTED via `fetchResearch` so the same logic
   runs from the browser proxy or a server-side Anthropic call. Token usage
   from each Claude response is captured and totalled (the browser flow never
   reads it).
   ═══════════════════════════════════════════ */

// Classify one raw research row into the tiered/verification shape. Identical
// to doResearch's inner classifyWebRow, but countryCode + tenantConfig are
// passed explicitly instead of closed over.
const classifyWebRow = (item, ts, countryCode, tenantConfig) => {
  const isWolfsbergSrc = !!(item.source && /wolfsberg/i.test(item.source));
  const tier = isWolfsbergSrc
    ? "document"
    : classifySourceFromConfig([item.source, item.sourceUrl].filter(Boolean).join(" "), countryCode, tenantConfig);
  return {
    ...item,
    sourceUrl: item.sourceUrl || null,
    sourceTier: tier,
    verificationStatus: getVerificationStatus(tier),
    documentType: isWolfsbergSrc ? "wolfsberg" : null,
    fetchedAt: ts,
    method: isWolfsbergSrc ? "document_extract" : "web_search",
    confidence: tier === "tier1" || tier === "document" ? "high" : "low",
    trust: tier === "tier1" || tier === "document" ? "authoritative" : "secondary",
    wolfsberg: isWolfsbergSrc,
  };
};

// Pull the JSON object out of a Claude /v1/messages response (text blocks,
// fence-stripped, sliced first { .. last }). Mirrors doResearch's parser.
const parseResearchJson = (data) => {
  let text = "";
  for (const block of (data && data.content) || []) {
    if (block.type === "text" && block.text) text += block.text;
  }
  text = text.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();
  const si = text.indexOf("{");
  const ei = text.lastIndexOf("}");
  if (si === -1 || ei === -1) throw new Error("No JSON found in research response");
  return JSON.parse(text.slice(si, ei + 1));
};

const blankUsage = () => ({
  input_tokens: 0,
  output_tokens: 0,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
});

const addUsage = (total, usage) => {
  if (!usage) return;
  total.input_tokens += usage.input_tokens || 0;
  total.output_tokens += usage.output_tokens || 0;
  total.cache_creation_input_tokens += usage.cache_creation_input_tokens || 0;
  total.cache_read_input_tokens += usage.cache_read_input_tokens || 0;
};

// Run the full research pipeline once for a single company and return a
// structured, scoreable result. `fetchResearch({ prompt, tools })` must resolve
// to a raw Claude /v1/messages response object ({ content: [...], usage: {...} }).
async function runResearchPipeline(opts) {
  const {
    companyName,
    country, // human-readable country name (for prompt copy); falls back to code
    countryCode,
    entityType,
    ownershipType,
    tenantConfig,
    fetchResearch,
    timestamp,
  } = opts || {};

  if (typeof fetchResearch !== "function") {
    throw new Error("runResearchPipeline: fetchResearch function is required");
  }

  const schema = getSchemaFromConfig(countryCode, entityType, tenantConfig);
  const ts = timestamp || new Date().toISOString();
  const countryName = country || countryCode;
  const usage = blankUsage();
  const calls = [];

  // ─── Phase 2: web research ───
  const prompt = buildPrompt(companyName, countryName, countryCode, schema, [], ownershipType);
  const webResp = await fetchResearch({ prompt, tools: RESEARCH_TOOLS });
  addUsage(usage, webResp && webResp.usage);
  calls.push({ phase: "research", usage: webResp && webResp.usage ? { ...webResp.usage } : null });

  const parsed = parseResearchJson(webResp);
  let merged = enrichStakeholders(
    mapAIValuesToOptions(
      (parsed.found || []).map((item) => classifyWebRow(item, ts, countryCode, tenantConfig)),
      schema,
    ),
  );
  const coverageBefore = computeCoverage(merged, schema);
  let coverage = coverageBefore;

  // ─── Phase 3: gap-recovery second pass ───
  const recoveryStrategy = ownershipType ? computeResearchStrategy(ownershipType, countryCode) : null;
  const upgradeable = merged.filter(
    (r) => r.verificationStatus === "indicative" && hasPlausibleHigherTierSource(r.field),
  );
  const shouldRunGapRecovery =
    (coverage.fillRate < 0.6 || coverage.verifiedFillRate < 0.4) && coverage.missingFields.length > 0;
  let ranGapRecovery = false;
  if (shouldRunGapRecovery) {
    ranGapRecovery = true;
    try {
      const gapPrompt = buildGapRecoveryPrompt(
        { name: companyName, countryName },
        coverage.missingFields,
        upgradeable,
        recoveryStrategy,
      );
      const gapResp = await fetchResearch({ prompt: gapPrompt, tools: RESEARCH_TOOLS });
      addUsage(usage, gapResp && gapResp.usage);
      calls.push({ phase: "gap_recovery", usage: gapResp && gapResp.usage ? { ...gapResp.usage } : null });
      const gapParsed = parseResearchJson(gapResp);
      const gapRows = (gapParsed.found || []).map((item) => classifyWebRow(item, ts, countryCode, tenantConfig));
      merged = enrichStakeholders(mapAIValuesToOptions(mergeResearchResults(merged, gapRows), schema));
      coverage = computeCoverage(merged, schema);
    } catch (gapErr) {
      // Gap recovery is best-effort — keep the first-pass results on failure.
      calls.push({ phase: "gap_recovery", error: gapErr.message, usage: null });
    }
  }

  const research = { ...parsed, found: merged, companyName };
  const isPubliclyListed = detectPubliclyListed(research);

  return {
    schema: {
      label: schema.label,
      region: schema.region,
      jurisdiction: schema.jurisdiction || null,
      licenceId: schema.licenceId || null,
      flow: schema.flow,
      researchFieldCount: schema.researchFields.length,
      gapFieldCount: schema.gapFields.length,
      requiredGapFieldCount: schema.gapFields.filter((f) => f.required).length,
      totalFieldCount: schema.researchFields.length + schema.gapFields.length,
    },
    found: merged,
    coverageBefore,
    coverage,
    ranGapRecovery,
    isPubliclyListed,
    listingEvidence: isPubliclyListed ? detectListingEvidence(research) : null,
    usage,
    totalTokens: usage.input_tokens + usage.output_tokens,
    calls,
    raw: parsed,
  };
}


module.exports = {
  runResearchPipeline,
  classifyWebRow,
  parseResearchJson,
  SOURCE_TRUST,
  UNIVERSAL_AUTHORITATIVE,
  classifySource,
  LICENSED_MARKETS,
  VOLUME_OPTIONS,
  accountSection,
  UK_SCHEMA,
  SG_SCHEMA,
  fiResearchFields,
  fiBusinessGapFields,
  fiSpecificFields,
  fiStakeholderFields,
  fiDisclosureFields,
  fiUsageFields,
  fiDocumentFields,
  UK_FI_SCHEMA,
  SG_FI_SCHEMA,
  getOwnershipTypeOptions,
  getRegistriesForCountry,
  computeResearchStrategy,
  getSchema,
  getApplicableLicence,
  STAKEHOLDER_FIELD_IDS,
  isStakeholderField,
  isUboLikeField,
  REGISTRY_EXEMPTION_PATTERNS,
  isRegistryExemptionNotice,
  makeStakeholder,
  looksLikeRealName,
  isDescriptionNotName,
  normaliseDateOfBirth,
  formatDOBForDisplay,
  parseStakeholdersFromString,
  enrichStakeholders,
  detectPubliclyListed,
  needsStakeholderDetails,
  detectListingEvidence,
  pickLicence,
  inferSection,
  normaliseField,
  getSchemaFromConfig,
  findFieldDef,
  normaliseDate,
  fieldTypeOf,
  resolveDisplayValue,
  mapAIValuesToOptions,
  THIRD_PARTY_PATTERNS,
  COMPANY_OWNED_PATTERNS,
  classifySourceFromConfig,
  getVerificationStatus,
  computeCoverage,
  UPGRADEABLE_FIELDS,
  hasPlausibleHigherTierSource,
  buildGapRecoveryPrompt,
  mergeResearchResults,
  RESEARCH_TOOLS,
  buildPrompt,
};
