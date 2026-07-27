// Realistic demo doc-search results built from the actual Step 1 inputs.
// Used in demo mode / local dev so Section A renders without spending API
// tokens. Mirrors the response shape of /api/doc-search.
export function buildDemoDocSearchResults(
  companyName,
  ownershipType,
  entityType
) {
  const now = new Date().toISOString();
  const year = new Date().getFullYear();
  const prevYear = year - 1;

  const isFI = entityType === "FI" ||
    ["payment_institution",
     "correspondent_bank"].includes(ownershipType);

  const isListed =
    ownershipType === "public_listed";

  const slug = companyName
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9_.]/g, "");

  // Domain-friendly slug for realistic, company-specific demo source URLs
  // (no underscores, lowercased, alphanumeric only — e.g. "hsbcholdings").
  const domainSlug = companyName
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 20);

  const documents = [];

  // Wolfsberg for FI entities
  if (isFI) {
    documents.push({
      type: "wolfsberg_questionnaire",
      label: "Wolfsberg Questionnaire",
      filename: `${slug}_Wolfsberg_Questionnaire_${year}.pdf`,
      year,
      status: "downloaded",
      sourceUrl: `https://www.${domainSlug}.com/compliance/wolfsberg-questionnaire`,
      sourceLabel: `${companyName} compliance page`,
      confidence: "high",
      localPath: `./downloads/${slug}_demo/wolfsberg.pdf`,
      searchAttempts: [
        `"${companyName}" Wolfsberg questionnaire PDF ${year}`,
        `"${companyName}" AML questionnaire correspondent banking`,
      ],
      cost: {
        inputTokens: 2841,
        outputTokens: 187,
        totalCostUSD: 0.01133,
      },
    });
  }

  // Annual report for listed or corporate
  if (isListed || !isFI) {
    documents.push({
      type: "annual_report",
      label: "Annual Report",
      filename: `${slug}_Annual_Report_${prevYear}.pdf`,
      year: prevYear,
      status: "downloaded",
      sourceUrl: `https://www.${domainSlug}.com/investors/results-and-announcements/annual-results-${prevYear}`,
      sourceLabel: `${companyName} investor relations`,
      confidence: "high",
      localPath: `./downloads/${slug}_demo/annual_report.pdf`,
      searchAttempts: [
        `"${companyName}" annual report ${prevYear} PDF`,
        `"${companyName}" annual report filetype:pdf investor relations`,
      ],
      cost: {
        inputTokens: 3654,
        outputTokens: 203,
        totalCostUSD: 0.01397,
      },
    });
  }

  const found = documents.filter(
    d => d.status === "downloaded"
  ).length;

  return {
    documents,
    // Mirrors the customer-facing column shape of the agent's
    // buildSummaryTable — no token/cost columns (internal-only data).
    summaryTable: documents.map(d => ({
      "Company Name": companyName,
      "Document Type": d.label,
      "Year": d.year,
      "Source": d.sourceLabel,
      "Source URL": d.sourceUrl,
      "Status": d.status === "downloaded"
        ? "✅ Downloaded"
        : "🔗 URL found (not downloaded)",
      "File": d.filename,
      "Notes": "",
    })),
    summary: {
      found,
      notFound: documents.length - found,
      total: documents.length,
    },
    cost: {
      model: "claude-sonnet-4-6",
      totals: {
        inputTokens: 6495,
        outputTokens: 390,
        totalTokens: 6885,
        totalCostUSD: 0.0253,
      },
    },
    searchedAt: now,
    isDemo: true,
  };
}

// Dummy registry (self-source) results for demo/test mode. Mirrors the exact
// shape of the /api/self-source response so the Documents-step registry section,
// the Confirm prefill, and the Required-Documents "already satisfied" logic all
// behave the same as a live run — without spending API credits.
//
// PR-059 A: every value here is deliberately FAKE placeholder data. Earlier this
// stub hardcoded a real third party's Companies House identity (reg number,
// address, incorporation date), which then got persisted into test dossiers and
// surfaced as cross-company contamination. NEVER put a real company's details
// here — only obviously-synthetic sentinels (00000000 / 1 Test Street / etc.).
export function buildDemoSelfSourceResults(companyName) {
  const now = new Date().toISOString();
  const CH = "https://find-and-update.company-information.service.gov.uk";
  const chField = {
    tier: "tier-1", source: "registry-self-source",
    sourceLabel: "Companies House", sourceUrl: CH, confidence: "high",
  };
  return {
    success: true,
    selfSourceItems: 5,
    summary: { retrieved: 4, unverified: 0, failed: 0, manualRequired: 1, total: 5 },
    searchedAt: now,
    cost: { totals: { inputTokens: 5783, outputTokens: 1447, totalTokens: 7230, totalCostUSD: 0.0391 }, calls: [] },
    manualReviewItems: [
      { requirement: "Regulatory status", manualReviewReason: "FCA register requires manual search", sourceUrl: "https://register.fca.org.uk" },
    ],
    selfSourcedFields: {
      business_name:               { value: companyName, ...chField },
      registration_number:         { value: "00000000", ...chField },
      incorporation_date:          { value: "2000-01-01", ...chField },
      registered_address_line1:    { value: "1 Test Street", ...chField },
      registered_address_city:     { value: "Testville", ...chField },
      registered_address_postcode: { value: "TE5 7XX", ...chField },
    },
    results: [
      { requirement: "Legal existence", selfSourceTier: "Preferred self-source", status: "retrieved", extracted: { matchConfidence: "high", registeredName: companyName, registrationNumber: "00000000", incorporationDate: "2000-01-01", registeredAddress: "1 Test Street, Testville, TE5 7XX" }, sourceLabel: "Companies House", searchUrl: CH, sourceUrl: CH, files: [{ type: "screenshot_focused" }, { type: "html_snapshot" }], retrievedAt: now },
      { requirement: "Constitution", selfSourceTier: "Preferred self-source", status: "retrieved", extracted: { matchConfidence: "high" }, sourceLabel: "Companies House", searchUrl: `${CH}/filing-history`, sourceUrl: CH, files: [{ type: "screenshot_focused" }, { type: "html_snapshot" }], retrievedAt: now },
      { requirement: "Business activity", selfSourceTier: "Supplementary self-source", status: "retrieved", extracted: { matchConfidence: "medium" }, sourceLabel: "Companies House", searchUrl: CH, sourceUrl: CH, files: [{ type: "screenshot_focused" }], retrievedAt: now },
      { requirement: "Ownership / control", selfSourceTier: "Preferred self-source", status: "retrieved", extracted: { matchConfidence: "high" }, sourceLabel: "Companies House", searchUrl: `${CH}/persons-with-significant-control`, sourceUrl: CH, files: [{ type: "screenshot_focused" }], retrievedAt: now },
      { requirement: "Regulatory status", selfSourceTier: "Preferred self-source", status: "manual_retrieval_required", manualReviewFlag: true, manualReviewReason: "FCA register requires manual search — automated retrieval inconclusive", sourceLabel: "FCA Register", searchUrl: "https://register.fca.org.uk", sourceUrl: "https://register.fca.org.uk", files: [], retrievedAt: now },
    ],
  };
}


/* ═══════════════════════════════════════════
   TEST DATA — fills empty gap fields with
   plausible values for demos.
   ═══════════════════════════════════════════ */
export const TEST_DATA = {
  applicantFirstName: "Jane",
  applicantLastName: "Smith",
  applicantEmail: "jane.smith@example.com",
  applicantMobile: "7700900123",
  applicantMobileCountryCode: "+44",
  applicantDateOfBirth: "1985-06-15",
  applicantNationality: "GB",
  applicantBirthCountry: "United Kingdom",
  applicantIsPEP: "No",
  applicantSharePercentage: "25",
  applicantPosition: "Director",
  natureOperatingCountries: "GB,US,SG",
  natureIndustryCodes: "IS131",
  natureIndustryDescription: "Software development and SaaS distribution to enterprise customers.",
  sizeTotalEmployees: "51-200",
  sizeAnnualTurnover: "5M - 25M",
  creditMonthlyVolume: "250,000 - 1,000,000",
  creditTopCountries: "GB,US,DE",
  debitMonthlyVolume: "50,000 - 250,000",
  debitTopCountries: "GB,SG,IN",
  intendedUses: "Customer payments, supplier disbursements, payroll, FX hedging.",
  sourceOfFunds: "Trading revenue and operating cashflow.",
  bankAccountName: "Acme Holdings Ltd",
  bankAccountNumber: "12345678",
  bankName: "HSBC UK",
  bankSortCode: "40-12-34",
  bankCurrency: "GBP",
  bankCountry: "United Kingdom",
};

/* ═══════════════════════════════════════════
   DUMMY RESEARCH VALUES — used by the
   "Dummy Research" button on Step 0 to simulate
   an API response without spending credits.
   ═══════════════════════════════════════════ */
export const DUMMY_RESEARCH_VALUES = {
  // Corporate (UK + SG) research fields
  businessType: "Private Limited Company",
  businessRegistrationNumber: "12345678",
  registeredDate: "2015-03-12",
  registeredCountry: "United Kingdom",
  tradeName: "ACME Holdings",
  formerName: "ACME Inc.",
  website: "https://example.com",
  addressLine1: "123 Sample Street",
  addressLine2: "Suite 4B",
  city: "London",
  state: "Greater London",
  postcode: "EC1A 1AA",
  country: "United Kingdom",
  sicCode: "62012",
  annualRevenue: "£12,500,000",
  employees: "85",
  stockListing: "Not listed",
  leiNumber: "529900T8BM49AURSDO55",
  countriesOfOperation: "UK, US, SG",
  industryCodes: "62012, 70229",
  industryDescription: "Software development and SaaS distribution to enterprise customers.",
  isMultiLayered: "No",
  // JSON-encoded (same shape as `directors` below) so the UBO people carry the
  // identity attributes CD-03's person rules act on — nationality, DOB,
  // residence. As a bare string they parsed into name+shareholding only, which
  // made the UBO half of the person-type matrix (UBO DOB/nationality → POI)
  // impossible to exercise live.
  uboAnalysis: JSON.stringify([
    { full_name: "John Smith", share_percentage: 40, nationality: "British", date_of_birth: "1965-08", country_of_residence: "United Kingdom" },
    { full_name: "Jane Doe", share_percentage: 35, nationality: "British", date_of_birth: "1972-03", country_of_residence: "United Kingdom" },
    { full_name: "Trustees", share_percentage: 25 },
  ]),
  // directors / UBO research fields are parsed into structured stakeholder
  // records on Confirm — value is a JSON-encoded array of {full_name, role,
  // share_percentage} so the customer sees per-person cards instead of a
  // single text blob.
  directors: JSON.stringify([
    { full_name: "John Smith", role: "CEO", nationality: "British", date_of_birth: "1965-08", country_of_residence: "United Kingdom" },
    { full_name: "Jane Doe", role: "CFO", nationality: "British", date_of_birth: "1972-03", country_of_residence: "United Kingdom" },
    { full_name: "Mark Lee", role: "CTO", nationality: "Singaporean", date_of_birth: "1980-11", country_of_residence: "Singapore" },
  ]),
  companySecretary: "Jane Doe",
  isPEP: "No",
  listedExchange: "Not listed",
  // FI research fields
  business_name: "ACME Financial Services Ltd",
  trading_name: "ACME Pay",
  business_activity_description: "Cross-border payment services for SMEs and individuals.",
  registration_number: "12345678",
  registered_address_line1: "123 Sample Street",
  registered_address_line2: "Suite 4B",
  registered_address_city: "London",
  registered_address_state: "Greater London",
  registered_address_postcode: "EC1A 1AA",
  registered_address_country: "United Kingdom",
  incorporation_date: "2015-03-12",
  annual_turnover: "$500,001–$1,500,000",
  employee_count: "51-250",
  operating_countries: "UK, US, SG",
  payout_transaction_countries: "GB, US, EU",
  industry_sector: "Financial Services / Payments",
  // Default demo company is private, so the full stakeholder gap forms show.
  // To test listed-company stakeholder suppression, change publicly_listed to
  // "Yes" (or add a listed_exchange / listedExchange result with a real
  // exchange name). Detection lives in detectPubliclyListed().
  publicly_listed: "No",
  listed_where: "—",
  has_licence: "Yes",
  regulatory_authority: "FCA",
  licence_number: "FRN 123456",
  has_branches: "Yes",
  branch_count: "12",
  branch_countries: "UK, DE, FR",
  services_other_fis: "Yes",
  cross_border_services: "Yes",
  issues_prepaid_cards: "No",
  non_resident_customers: "Yes",
  products_offered: "Cross-Border Payment Services",
  director_names: JSON.stringify([
    { full_name: "John Smith", role: "CEO", nationality: "British", date_of_birth: "1965-08", country_of_residence: "United Kingdom" },
    { full_name: "Jane Doe", role: "CFO", nationality: "British", date_of_birth: "1972-03", country_of_residence: "United Kingdom" },
    { full_name: "Mark Lee", role: "CTO", nationality: "Singaporean", date_of_birth: "1980-11", country_of_residence: "Singapore" },
  ]),
  ubo_parent_company: JSON.stringify([
    { full_name: "ACME Group Holdings Ltd", role: "Parent Company", share_percentage: 100 },
  ]),
  ubo_share_percentage: "100% (wholly-owned subsidiary)",
  licence_suspended: "No",
  administration_proceedings: "No",
};
