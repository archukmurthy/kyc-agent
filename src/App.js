import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { getTenantId, isPreviewMode } from "./utils/tenant";
import SearchableSelect from "./components/SearchableSelect";
import {
  OWNERSHIP_TYPE_LIBRARY,
  getResearchStrategy,
  NIUM_DEFAULT_OWNERSHIP_TYPES,
  ownershipTypeLabel,
} from "./utils/ownershipTypes";
import Step2DynamicForm from "./components/Step2DynamicForm";
import Step5Recompute from "./components/Step5Recompute";

// Maps this app's ownership-type IDs to the key strings the DRS engine's
// normaliseEntityType() recognises (it keys off labels like "Public Listed
// Company" / "LLP", not our IDs). Unmapped IDs fall through to the engine's
// safe "Privately owned" default. entityType is passed separately as the
// entity LABEL (e.g. "Financial Institution") so the engine's FI/sector/
// Wolfsberg detection works.
const OWNERSHIP_ID_TO_DRS = {
  public_listed: "Public Listed Company",
  public_unlisted: "Private Limited",
  private_limited: "Private Limited",
  llp: "LLP",
  general_partnership: "Partnership",
  sole_trader: "Sole Trader",
  trust: "Trust",
  government: "State Owned",
  central_bank: "State Owned",
  charity: "Private Limited",
  foundation: "Private Limited",
  cooperative: "Private Limited",
  branch: "Private Limited",
  spv: "Private Limited",
  holding_company: "Private Limited",
  joint_venture: "Private Limited",
  correspondent_bank: "Public Listed Company",
  payment_institution: "Private Limited",
  investment_fund: "Private Limited",
  insurance_company: "Private Limited",
  other: "Private Limited",
};

/* ═══════════════════════════════════════════
   COLOUR PALETTE
   Named tokens used by the enhanced research-pipeline UI (coverage bar,
   three-tier badges, low-data banner). Maps the spec's semantic colour names
   onto this app's existing hex values so the Confirm-page UX reads
   consistently with the rest of the flow.
   ═══════════════════════════════════════════ */
const C = {
  niumBlue: "#1a3a4a",
  text: "#1a3a4a",
  textMuted: "#1a3a4a90",
  border: "rgba(26,58,74,0.14)",
  surfaceAlt: "#fafcfb",
  success: "#1a6b56",
  successBg: "#dff2ec",
  successBorder: "#9fd8c8",
  warning: "#8c5500",
  warningBg: "#fff1d6",
  warningBorder: "#e8c98a",
  error: "#d44",
  info: "#1a4a7a",
  infoBg: "#f0f3f8",
  infoBorder: "#bcd0e8",
};

/* ═══════════════════════════════════════════
   APP-LEVEL CONSTANTS
   Edit here when product config changes.
   ═══════════════════════════════════════════ */
const MANUAL_FORM_URL = "https://nium.com/apply";
// TODO: replace with actual product form URL

// eslint-disable-next-line no-unused-vars
const CACHE_STALE_DAYS = 90;
// Number of days before cached research is considered stale (used by Session 2 cache layer)

/* ═══════════════════════════════════════════
   COUNTRY LIST
   ═══════════════════════════════════════════ */
const COUNTRIES = [
  { code: "GB", name: "United Kingdom" },{ code: "SG", name: "Singapore" },
  { code: "US", name: "United States" },{ code: "AU", name: "Australia" },
  { code: "CA", name: "Canada" },{ code: "NL", name: "Netherlands" },
  { code: "LT", name: "Lithuania" },{ code: "JP", name: "Japan" },
  { code: "HK", name: "Hong Kong" },{ code: "MY", name: "Malaysia" },
  { code: "ID", name: "Indonesia" },{ code: "DE", name: "Germany" },
  { code: "FR", name: "France" },{ code: "IE", name: "Ireland" },
  { code: "IN", name: "India" },{ code: "TH", name: "Thailand" },
  { code: "VN", name: "Vietnam" },{ code: "PH", name: "Philippines" },
  { code: "KR", name: "South Korea" },{ code: "CN", name: "China" },
  { code: "TW", name: "Taiwan" },{ code: "AE", name: "United Arab Emirates" },
  { code: "SA", name: "Saudi Arabia" },{ code: "ZA", name: "South Africa" },
  { code: "NG", name: "Nigeria" },{ code: "KE", name: "Kenya" },
  { code: "EG", name: "Egypt" },{ code: "BR", name: "Brazil" },
  { code: "MX", name: "Mexico" },{ code: "AR", name: "Argentina" },
  { code: "CL", name: "Chile" },{ code: "CO", name: "Colombia" },
  { code: "ES", name: "Spain" },{ code: "IT", name: "Italy" },
  { code: "CH", name: "Switzerland" },{ code: "SE", name: "Sweden" },
  { code: "NO", name: "Norway" },{ code: "DK", name: "Denmark" },
  { code: "PL", name: "Poland" },{ code: "TR", name: "Turkey" },
  { code: "IL", name: "Israel" },{ code: "NZ", name: "New Zealand" },
  { code: "PK", name: "Pakistan" },{ code: "BD", name: "Bangladesh" },
  { code: "LK", name: "Sri Lanka" },{ code: "AM", name: "Armenia" },
];

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
    // Gap fields — customer fills (Phase 3)
    nationality: "",
    date_of_birth: "",
    residential_country: "",
    id_type: "",
    id_number: "",
    is_pep: null,
    pep_details: "",
    // Metadata
    customer_confirmed: false,
    customer_rejected: false,
    customer_added: false,
    ...overrides,
  };
};

// True when a "name" is actually a demographic description rather than a real
// person name — e.g. the model returns "Director (British national, born April
// 1967)" instead of extracting "Nicholas Gliddon" from the same registry record.
// Such entries must be dropped: we never want a demographic blurb sitting in the
// name field, and inventing/keeping it would corrupt downstream KYC records.
const isDescriptionNotName = (fullName) => {
  if (!fullName) return true;

  const name = String(fullName).trim();

  // Pattern: starts with a role word followed by "(" introducing demographics
  // e.g. "Director (British national...".
  const rolePrefix = /^(director|officer|secretary|manager|trustee)\s*\(/i;

  // Pattern: contains both "national" and "born" — a demographic description.
  const demographicPattern = /national.*born|born.*national/i;

  // Pattern: is just a bare role word with no actual name.
  const justRole = /^(director|officer|secretary|manager)$/i;

  return rolePrefix.test(name) || demographicPattern.test(name) || justRole.test(name);
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
        // Pre-populate nationality / DOB the AI returned alongside the name so
        // the customer doesn't have to re-enter what was already found.
        nationality: p.nationality || "",
        date_of_birth: p.date_of_birth ? normaliseDateOfBirth(p.date_of_birth) : "",
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
const enrichStakeholders = (items) => {
  if (!Array.isArray(items)) return items;
  return items.map((item) => {
    if (!item || !isStakeholderField(item.field)) return item;
    if (Array.isArray(item.stakeholders) && item.stakeholders.length > 0) return item;
    const stakeholders = parseStakeholdersFromString(
      item.value,
      item.source,
      item.sourceUrl,
      item.sourceTier,
      item.fetchedAt,
    );
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
  const researchFields = (schema && schema.researchFields) || [];
  const totalResearchFields = researchFields.length;
  const populatedFields = list.length;

  const verifiedFields = list.filter((r) => r.verificationStatus === "verified").length;
  const probableFields = list.filter((r) => r.verificationStatus === "probable").length;
  const indicativeFields = list.filter((r) => r.verificationStatus === "indicative").length;

  const foundIds = new Set(list.map((r) => r.field));
  const missingFields = researchFields.filter((f) => !foundIds.has(f.field));

  const fillRate = totalResearchFields > 0 ? populatedFields / totalResearchFields : 0;
  const verifiedFillRate = totalResearchFields > 0 ? verifiedFields / totalResearchFields : 0;

  return {
    totalResearchFields,
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

// Merge the configured per-entity-type document list with the hardcoded
// DOC_TYPES (which carry the extraction prompts and source-name strings).
// Config can hide / reorder / rename docs; the AI extraction logic stays
// hardcoded and is applied to docs whose ids match a DOC_TYPES entry.
const docTypesForEntity = (entityTypeId, tenantConfig) => {
  const configured = tenantConfig?.documents?.[entityTypeId];
  if (!configured) {
    return DOC_TYPES.filter(d => d.entities.includes(entityTypeId));
  }
  return configured
    .filter(d => d.active !== false)
    .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
    .map(cfg => {
      const base = DOC_TYPES.find(d => d.key === cfg.id);
      if (!base) return null;
      return {
        ...base,
        label: cfg.name || base.label,
        helper: cfg.helperText || base.helper,
        icon: cfg.icon || base.icon,
      };
    })
    .filter(Boolean);
};

// Built locally from the still-present hardcoded constants above. This is
// the offline fallback used only when /api/config is unreachable; the
// canonical source is the API endpoint, which seeds itself from the same
// data via lib/seedSchemas.js.
const buildLocalDefaultConfig = () => ({
  _tenantId: "local",
  _version: 0,
  _seededAt: new Date().toISOString(),
  company: {
    name: "Nium",
    logo: null,
    manualFormUrl: MANUAL_FORM_URL,
    privacyPolicyUrl: "",
    submissionWebhookUrl: "",
    submissionEmail: "",
    primaryContactName: "",
    primaryContactEmail: "",
  },
  licences: [
    { id: "GB", jurisdictionCode: "GB", jurisdictionName: "United Kingdom", licenceType: "Payment Institution", licenceNumber: "", regulatoryAuthority: "FCA", countriesCovered: ["GB"], isPrimary: false },
    { id: "SG", jurisdictionCode: "SG", jurisdictionName: "Singapore", licenceType: "Major Payment Institution", licenceNumber: "", regulatoryAuthority: "MAS", countriesCovered: [], isPrimary: true },
  ],
  routingPolicy: "regional",
  entityTypes: [
    { id: "FI", label: "Financial Institution", description: "Banks, payment institutions, EMIs", icon: "🏦", active: true, sortOrder: 1 },
    { id: "Platform", label: "Platform", description: "Technology platforms and marketplaces", icon: "💻", active: true, sortOrder: 2 },
    { id: "Direct", label: "Direct", description: "Direct business customers", icon: "🏢", active: true, sortOrder: 3 },
    { id: "Corporate", label: "Corporate", description: "Corporate and commercial entities", icon: "🏛", active: true, sortOrder: 4 },
  ],
  schemas: {
    "Corporate:GB": { researchFields: UK_SCHEMA.researchFields, gapFields: UK_SCHEMA.gapFields },
    "Corporate:SG": { researchFields: SG_SCHEMA.researchFields, gapFields: SG_SCHEMA.gapFields },
    "FI:GB": { researchFields: UK_FI_SCHEMA.researchFields, gapFields: UK_FI_SCHEMA.gapFields },
    "FI:SG": { researchFields: SG_FI_SCHEMA.researchFields, gapFields: SG_FI_SCHEMA.gapFields },
    "Platform:GB": { researchFields: UK_SCHEMA.researchFields, gapFields: UK_SCHEMA.gapFields },
    "Platform:SG": { researchFields: SG_SCHEMA.researchFields, gapFields: SG_SCHEMA.gapFields },
    "Direct:GB": { researchFields: UK_SCHEMA.researchFields, gapFields: UK_SCHEMA.gapFields },
    "Direct:SG": { researchFields: SG_SCHEMA.researchFields, gapFields: SG_SCHEMA.gapFields },
  },
  sourceTiers: {
    primary: [],
    secondary: [],
    documentsArePrimary: true,
  },
  documents: {},
});

const buildPrompt = (name, country, countryCode, schema, wolfsbergFields, ownershipType) => {
  // Stakeholder fields (directors / UBOs / shareholders / signatories) return
  // a JSON array per person, not a string. Other fields keep the legacy
  // "value": "..." string shape so the prompt and downstream parsing stay
  // unchanged for them.
  const fieldList = schema.researchFields.map((f) => {
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
  const stakeholderRules = schema.researchFields
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
      desc += `    "nationality": "British" or equivalent if available\n`;
      desc += `    "date_of_birth": "YYYY-MM" format if available (year and month only — do not guess the day)\n`;
      desc += `  }\n`;
      desc += `  SOURCE: ${country}'s official company officers register.`;
      if (countryCode === "GB") {
        desc += ` For the UK this is the Companies House officers page at:\n`;
        desc += `  https://find-and-update.company-information.service.gov.uk/company/{COMPANY_NUMBER}/officers\n`;
        desc += `  Look for the "People" or "Officers" section. Each officer entry shows: NAME (in large text), Role, Date of birth, Nationality, Country of residence.\n`;
      } else {
        desc += `\n`;
      }
      desc += `  CRITICAL: The NAME field is always the person's actual name (e.g. "GLIDDON, Nicholas Francis" or "TAYLOR, Max"). It is NEVER a demographic description.\n`;
      desc += `  If you find demographic details (nationality, birth month) without finding the name, do NOT invent a name. Instead omit that person from the array entirely.\n`;
      desc += `  ONLY include current/active officers — ignore resigned officers.\n`;
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

  const fieldGuide = schema.researchFields
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
  const dropdownGuide = schema.researchFields
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

const LOADER_MSGS = [
  "Searching company registries...",
  "Checking regulatory databases...",
  "Extracting director information...",
  "Analysing ownership structure...",
  "Compiling financial data...",
  "Identifying jurisdiction-specific gaps...",
  "Building onboarding form...",
  "Almost done, compiling results...",
];

// Two-phase loader messages for the AI + Documents journey.
// Phase 1 messages are generated dynamically in doResearch from the
// uploadedDocs map; this list is the fallback when nothing was uploaded.
const LOADER_MSGS_WOLFSBERG_PHASE1 = [
  "Reading your documents...",
];
const LOADER_MSGS_WOLFSBERG_PHASE2 = [
  "Searching official registries…",
  "Checking regulatory databases…",
  "Scanning secondary sources…",
  "Almost done, compiling results…",
];

// Build the Phase-1 status messages for the docs we actually have.
const buildPhase1Msgs = (docs) => {
  const msgs = [];
  DOC_TYPES.forEach(d => {
    if (docs[d.key]) msgs.push(`Reading ${d.label}…`);
  });
  if (msgs.length === 0) msgs.push("Reading your documents…");
  return msgs;
};

// Read a File object as base64 (data: prefix stripped) for sending in an
// Anthropic messages "document" content block.
const readFileAsBase64 = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result).split(",")[1]);
  reader.onerror = reject;
  reader.readAsDataURL(file);
});

const WOLFSBERG_EXTRACTION_PROMPT = `You are a KYC compliance data extractor. Extract all available field values from this Wolfsberg CBDDQ questionnaire and return them as a JSON object.

Return ONLY valid JSON with no markdown, no backticks.
Map the questionnaire answers to these field IDs where possible:

{
  "legal_name": "string or null",
  "registered_address": "string or null",
  "incorporation_date": "string or null",
  "lei_number": "string or null",
  "parent_company": "string or null",
  "parent_jurisdiction": "string or null",
  "publicly_listed": "Yes/No or null",
  "listed_where": "string or null",
  "business_type": "string or null",
  "ubo_names": "string or null",
  "ubo_share_percentage": "string or null",
  "bearer_shares": "Yes/No or null",
  "offshore_banking_licence": "Yes/No or null",
  "regulatory_authority": "string or null",
  "employee_count": "string or null",
  "total_assets": "string or null",
  "non_resident_customers": "Yes/No or null",
  "top_non_resident_countries": "string or null",
  "business_areas": "array of active business areas",
  "correspondent_banking": "Yes/No or null",
  "services_other_fis": "Yes/No or null",
  "trade_finance": "Yes/No or null",
  "cross_border_remittances": "Yes/No or null",
  "deals_virtual_currency": "Yes/No or null",
  "virtual_currency_types": "string or null",
  "aml_programme_in_place": "Yes/No or null",
  "aml_team_size": "string or null",
  "aml_policy_board_approved": "Yes/No or null",
  "board_aml_reporting_frequency": "string or null",
  "aml_outsourced": "Yes/No or null",
  "aml_outsourced_to": "string or null",
  "abc_programme": "Yes/No or null",
  "pep_screening": "Yes/No or null",
  "pep_screening_method": "string or null",
  "adverse_media_screening": "Yes/No or null",
  "ubo_threshold_pct": "string or null",
  "edd_shell_banks": "string or null",
  "edd_peps": "string or null",
  "edd_virtual_currency": "string or null",
  "transaction_monitoring_method": "string or null",
  "suspicious_activity_reporting": "Yes/No or null",
  "fatf_rec16_compliance": "Yes/No or null",
  "sanctions_policy_board_approved": "Yes/No or null",
  "sanctions_lists_used": "string or null",
  "sanctions_screening_update_days": "string or null",
  "presence_in_sanctioned_countries": "Yes/No or null",
  "record_retention_period": "string or null",
  "kyc_quality_assurance": "Yes/No or null",
  "internal_audit_covers_aml": "Yes/No or null",
  "policies_updated_annually": "Yes/No or null",
  "prohibits_shell_banks": "Yes/No or null",
  "prohibits_anonymous_accounts": "Yes/No or null",
  "licence_suspended": "Yes/No or null",
  "regulatory_action": "Yes/No or null"
}

For each field: extract the actual answer from the questionnaire. If the question was not answered or not present, return null. Do not guess or fabricate. For Yes/No questions return "Yes" or "No" as strings.`;

/* ═══════════════════════════════════════════
   PER-DOCUMENT EXTRACTION PROMPTS

   Each prompt instructs Claude to read a PDF (or
   image, for org chart) and return a JSON array of
   {fieldId, value} objects. The keys returned are
   "generic" — mapEXTRACTION_KEY_TO_SCHEMA() below
   maps them onto the active schema's field IDs.
   ═══════════════════════════════════════════ */
const CERT_EXTRACTION_PROMPT = `Extract the following from this Certificate of Incorporation or equivalent company registration document:
- legal_name: full registered legal name
- registration_number: company/registration number
- incorporation_date: date of incorporation (ISO format)
- registered_address: full registered address
- legal_form: company type (e.g. private limited, PLC)
- country_of_incorporation: country

Return as JSON array of {fieldId, value} objects. Only include fields actually present in the document. No markdown, no backticks.`;

const LICENCE_EXTRACTION_PROMPT = `Extract the following from this regulatory licence or authorisation document:
- licence_number: licence or registration number
- regulatory_authority: name of the issuing regulator
- has_licence: always 'Yes' if this document exists
- regulated_status: type of authorisation if stated
- licence_date: date of issue if present
- permitted_activities: description of permitted activities if present

Return as JSON array of {fieldId, value} objects. No markdown, no backticks.`;

const ANNUAL_REPORT_EXTRACTION_PROMPT = `Extract the following from this annual report or financial statements document:
- annual_turnover_band: revenue range (return as a descriptive string e.g. 'Over £250 million')
- employee_count_band: number of employees or band
- operating_countries: countries where the company operates
- business_description: what the company does
- publicly_listed: Yes or No based on whether shares are publicly traded
- listed_where: stock exchange name if listed
- total_assets: total assets value or band if stated
- payout_transaction_countries: countries they send payments to if mentioned
- directors: names of board directors if listed
- ubo_names: parent company or major shareholders if disclosed

Return as JSON array of {fieldId, value} objects. No markdown, no backticks.`;

const ORG_CHART_EXTRACTION_PROMPT = `Extract the following from this ownership structure or org chart document:
- ubo_names: names of ultimate beneficial owners
- ubo_share_percentage: ownership percentages
- group_structure: description of corporate structure
- parent_company: immediate parent company name if shown

Return as JSON array of {fieldId, value} objects. No markdown, no backticks.`;

const AML_POLICY_EXTRACTION_PROMPT = `Extract the following from this AML policy document:
- aml_programme_in_place: always 'Yes' if this exists
- policies_updated_annually: Yes/No if stated
- pep_screening: Yes/No if PEP screening is mentioned
- transaction_monitoring_method: automated/manual/combination if stated
- suspicious_activity_reporting: Yes/No if stated
- record_retention_period: retention period if stated
- aml_policy_board_approved: Yes/No if stated

Return as JSON array of {fieldId, value} objects. No markdown, no backticks.`;

/* DOC_TYPES — single source of truth for which
   document slots exist, their UI presentation, the
   accepted MIME types, the badge label, the human-
   readable source name shown on Confirm, and the
   prompt to use when extracting.
   The `entities` field gates which cards render in
   the Document Upload step. */
const DOC_TYPES = [
  {
    key: "wolfsberg",
    icon: "📋",
    label: "Wolfsberg Questionnaire (CBDDQ)",
    helper: "Completed and signed Correspondent Banking Due Diligence Questionnaire. Extracts ~40 AML and compliance fields automatically.",
    accept: "application/pdf",
    accepts: ".pdf",
    badge: { text: "Most valuable", color: "#e0a040" },
    entities: ["FI"],
    sourceName: "Wolfsberg CBDDQ (uploaded)",
    extractionPrompt: WOLFSBERG_EXTRACTION_PROMPT,
    returnsObject: true, // legacy shape: { key: value, ... }
  },
  {
    key: "certificate",
    icon: "🏛",
    label: "Certificate of Incorporation",
    helper: "Issued by Companies House (UK), ACRA (SG), or equivalent registry. Extracts entity name, registration number, address, and incorporation date.",
    accept: "application/pdf",
    accepts: ".pdf",
    entities: ["FI", "Corporate", "Platform", "Direct"],
    sourceName: "Certificate of Incorporation (uploaded)",
    extractionPrompt: CERT_EXTRACTION_PROMPT,
  },
  {
    key: "licence",
    icon: "✅",
    label: "Regulatory Licence / Authorisation",
    helper: "FCA authorisation letter, MAS licence, or equivalent. Extracts licence number, regulatory authority, and permitted activities.",
    accept: "application/pdf",
    accepts: ".pdf",
    entities: ["FI"],
    sourceName: "Regulatory Licence (uploaded)",
    extractionPrompt: LICENCE_EXTRACTION_PROMPT,
  },
  {
    key: "annualReport",
    icon: "📊",
    label: "Annual Report",
    helper: "Most recent published annual report. Best for publicly listed institutions. Extracts turnover, employee count, operating countries, and products offered.",
    accept: "application/pdf",
    accepts: ".pdf",
    entities: ["FI", "Corporate", "Platform", "Direct"],
    sourceName: "Annual Report (uploaded)",
    extractionPrompt: ANNUAL_REPORT_EXTRACTION_PROMPT,
  },
  {
    key: "financialStatements",
    icon: "💰",
    label: "Audited Financial Statements",
    helper: "Alternative to annual report for private institutions. Extracts turnover band, total assets, and employee count.",
    accept: "application/pdf",
    accepts: ".pdf",
    entities: ["FI", "Corporate", "Platform", "Direct"],
    sourceName: "Audited Financial Statements (uploaded)",
    extractionPrompt: ANNUAL_REPORT_EXTRACTION_PROMPT,
  },
  {
    key: "orgChart",
    icon: "🏢",
    label: "Ownership Structure / Org Chart",
    helper: "Corporate structure chart showing UBOs and shareholding percentages. Extracts beneficial owner names and share percentages.",
    accept: "application/pdf,image/png,image/jpeg",
    accepts: ".pdf,.png,.jpg,.jpeg",
    entities: ["FI", "Corporate", "Platform", "Direct"],
    sourceName: "Ownership / Org Chart (uploaded)",
    extractionPrompt: ORG_CHART_EXTRACTION_PROMPT,
  },
  {
    key: "amlPolicy",
    icon: "🛡",
    label: "AML Policy & Procedures",
    helper: "Your institution's AML/CTF policy document. Confirms AML programme components in place.",
    accept: "application/pdf",
    accepts: ".pdf",
    entities: ["FI"],
    sourceName: "AML Policy (uploaded)",
    extractionPrompt: AML_POLICY_EXTRACTION_PROMPT,
  },
];

const initialUploadedDocs = () => Object.fromEntries(DOC_TYPES.map(d => [d.key, null]));

/* Map a generic extraction-prompt key onto an
   actual schema research field id. flow is "fi" or
   "corporate". Returns null if the key has no slot
   in the active schema (we drop those values).
   The Wolfsberg prompt has its own AI-driven
   mapping inside the prompt text and is handled
   separately. */
const EXTRACTION_KEY_TO_SCHEMA = {
  fi: {
    legal_name: "business_name",
    registration_number: "registration_number",
    incorporation_date: "incorporation_date",
    registered_address: "registered_address_line1",
    legal_form: null,
    country_of_incorporation: "registered_address_country",
    licence_number: "licence_number",
    regulatory_authority: "regulatory_authority",
    has_licence: "has_licence",
    regulated_status: null,
    licence_date: null,
    permitted_activities: null,
    annual_turnover_band: "annual_turnover",
    employee_count_band: "employee_count",
    operating_countries: "operating_countries",
    business_description: "business_activity_description",
    publicly_listed: "publicly_listed",
    listed_where: "listed_where",
    total_assets: null,
    payout_transaction_countries: "payout_transaction_countries",
    directors: "director_names",
    ubo_names: "ubo_parent_company",
    ubo_share_percentage: "ubo_share_percentage",
    group_structure: null,
    parent_company: "ubo_parent_company",
    aml_programme_in_place: null,
    policies_updated_annually: null,
    pep_screening: null,
    transaction_monitoring_method: null,
    suspicious_activity_reporting: null,
    record_retention_period: null,
    aml_policy_board_approved: null,
  },
  corporate: {
    legal_name: "tradeName",
    registration_number: "businessRegistrationNumber",
    incorporation_date: "registeredDate",
    registered_address: "addressLine1",
    legal_form: "businessType",
    country_of_incorporation: "registeredCountry",
    annual_turnover_band: "annualRevenue",
    employee_count_band: "employees",
    operating_countries: "countriesOfOperation",
    business_description: "industryDescription",
    publicly_listed: "stockListing",
    listed_where: "listedExchange",
    directors: "directors",
    ubo_names: "uboAnalysis",
    parent_company: "uboAnalysis",
  },
};

const mapExtractedKey = (flow, key) => {
  const m = EXTRACTION_KEY_TO_SCHEMA[flow] || {};
  return key in m ? m[key] : null;
};

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

/* ═══════════════════════════════════════════
   TEST DATA — fills empty gap fields with
   plausible values for demos.
   ═══════════════════════════════════════════ */
const TEST_DATA = {
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
const DUMMY_RESEARCH_VALUES = {
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
  uboAnalysis: "John Smith (40%), Jane Doe (35%), Trustees (25%)",
  // directors / UBO research fields are parsed into structured stakeholder
  // records on Confirm — value is a JSON-encoded array of {full_name, role,
  // share_percentage} so the customer sees per-person cards instead of a
  // single text blob.
  directors: JSON.stringify([
    { full_name: "John Smith", role: "CEO" },
    { full_name: "Jane Doe", role: "CFO" },
    { full_name: "Mark Lee", role: "CTO" },
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
    { full_name: "John Smith", role: "CEO" },
    { full_name: "Jane Doe", role: "CFO" },
    { full_name: "Mark Lee", role: "CTO" },
  ]),
  ubo_parent_company: JSON.stringify([
    { full_name: "ACME Group Holdings Ltd", role: "Parent Company", share_percentage: 100 },
  ]),
  ubo_share_percentage: "100% (wholly-owned subsidiary)",
  licence_suspended: "No",
  administration_proceedings: "No",
};

// Fixed-top banner shown to the customer flow whenever ?preview=true is set
// (or path is /preview). Two modes:
//   - normal blue: staged config loaded from sessionStorage; shows capture
//     timestamp and Close + Refresh controls
//   - amber: preview requested but no staged config in sessionStorage (e.g.
//     someone shared a /?preview=true link). Falls back to the published
//     config and offers a link into /admin to stage a real preview.
function PreviewBanner({ missing, timestamp }) {
  const bg = missing ? "#B45309" : "#0B3D91";
  const btnBase = {
    background: "rgba(255,255,255,0.2)",
    border: "1px solid rgba(255,255,255,0.4)",
    color: "#fff",
    borderRadius: 6,
    padding: "4px 12px",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
  };
  let capturedAt = "";
  if (timestamp) {
    try { capturedAt = ` — captured at ${new Date(timestamp).toLocaleTimeString()}`; }
    catch (_) { capturedAt = ""; }
  }
  return (
    <div style={{
      position: "fixed", top: 0, left: 0, right: 0, zIndex: 9999,
      background: bg, color: "#FFFFFF",
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "8px 20px",
      fontSize: 13, fontWeight: 600, fontFamily: "inherit",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{
          background: "#FFFFFF", color: bg,
          fontSize: 11, fontWeight: 800,
          padding: "2px 8px", borderRadius: 99, letterSpacing: "0.5px",
        }}>PREVIEW</span>
        <span>
          {missing
            ? "No preview config found — showing published version instead."
            : `Previewing unpublished changes${capturedAt}`}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ fontSize: 12, opacity: 0.85, fontWeight: 400 }}>
          {missing
            ? "Use the admin Preview button to stage your changes."
            : "This is not the live version. Submissions are disabled."}
        </span>
        {missing && (
          <button
            type="button"
            onClick={() => window.open("/admin", "_blank")}
            style={btnBase}
          >
            Go to admin →
          </button>
        )}
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={btnBase}
          title="Reload to pick up the latest staged config"
        >
          ↻ Refresh
        </button>
        <button
          type="button"
          onClick={() => window.close()}
          style={btnBase}
        >
          Close Preview ✕
        </button>
      </div>
    </div>
  );
}

// Fixed-top amber strip shown while demo mode is on. Stacks below the
// Preview banner via the offsetTop prop so both can coexist (admin running
// a preview of a demo flow).
function DemoBanner({ offsetTop = 0 }) {
  return (
    <div style={{
      position: "fixed",
      top: offsetTop,
      left: 0,
      right: 0,
      zIndex: 9998,
      background: "#FCD34D",
      color: "#92400E",
      textAlign: "center",
      padding: "6px",
      fontSize: 12,
      fontWeight: 700,
      letterSpacing: "0.3px",
      fontFamily: "inherit",
    }}>
      🧪 DEMO MODE — Sample data only. Not real company information.
    </div>
  );
}

// Small unobtrusive chip-shaped toggle used on the journey-selection screen.
// Only mounted when demoToggleVisible is true (localhost / ?demo / ?tenant).
function DemoToggle({ on, onChange }) {
  return (
    <label
      title="Skip API calls and pre-fill the flow with sample data — for demos and testing"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "5px 10px",
        border: `1.5px dashed ${on ? "#92400E" : "rgba(26,58,74,0.18)"}`,
        background: on ? "#FEF3C7" : "transparent",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 600,
        color: on ? "#92400E" : "#1a3a4a90",
        cursor: "pointer",
        userSelect: "none",
        fontFamily: "inherit",
      }}
    >
      <span>🧪 Demo mode</span>
      <span
        aria-hidden="true"
        style={{
          width: 26,
          height: 14,
          borderRadius: 999,
          background: on ? "#FCD34D" : "rgba(26,58,74,0.25)",
          position: "relative",
          transition: "background 0.15s",
        }}
      >
        <span
          style={{
            position: "absolute",
            top: 1,
            left: on ? 13 : 1,
            width: 12,
            height: 12,
            borderRadius: 999,
            background: "#fff",
            transition: "left 0.15s",
            boxShadow: "0 1px 2px rgba(0,0,0,0.2)",
          }}
        />
      </span>
      <input
        type="checkbox"
        checked={on}
        onChange={(e) => onChange(e.target.checked)}
        style={{ position: "absolute", opacity: 0, pointerEvents: "none" }}
      />
    </label>
  );
}

function StableInput({ id, label, type, value, onUpdate, required, options, placeholder }) {
  const ref = useRef(null);
  // Normalise the type so case/whitespace differences (e.g. "Date", " date ")
  // don't cause the wrong branch to render. Empty / unknown types fall back
  // to "text".
  const t = String(type || "text").toLowerCase().trim();
  // For date inputs, the browser requires YYYY-MM-DD; coerce here so an AI-
  // returned value like "12 January 2005" populates the picker correctly.
  const initial = t === "date" ? (normaliseDate(value) || "") : (value || "");
  const [local, setLocal] = useState(initial);
  useEffect(() => {
    setLocal(t === "date" ? (normaliseDate(value) || "") : (value || ""));
  }, [value, t]);
  const handleChange = useCallback((e) => { const v = e.target.value; setLocal(v); onUpdate(id, v); }, [id, onUpdate]);
  const sty = { width: "100%", padding: "10px 14px", borderRadius: 8, border: "1.5px solid rgba(26,58,74,0.14)", fontSize: 14, fontFamily: "inherit", color: "#1a3a4a", background: "#fff", outline: "none", boxSizing: "border-box" };

  const renderInput = () => {
    switch (t) {
      case "select":
        return (
          <select ref={ref} value={local} onChange={handleChange} style={{ ...sty, cursor: "pointer" }}>
            <option value="">Select...</option>
            {(options || []).map((o, i) => {
              // Support both shapes: legacy hardcoded gap fields use plain
              // strings (e.g. ["Yes","No"]); admin-saved fields use
              // { value, label } objects.
              const isObj = o && typeof o === "object";
              const optValue = isObj
                ? (o.value !== undefined && o.value !== null ? o.value : o.label)
                : o;
              const optLabel = isObj
                ? (o.label !== undefined && o.label !== null ? o.label : String(o.value))
                : o;
              return <option key={`${optValue}-${i}`} value={optValue}>{optLabel}</option>;
            })}
          </select>
        );
      case "textarea":
        return (
          <textarea ref={ref} value={local} onChange={handleChange} placeholder={placeholder} rows={3} style={{ ...sty, resize: "vertical" }} />
        );
      case "file":
        return (
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <input
              ref={ref}
              type="file"
              onChange={(e) => {
                const f = e.target.files && e.target.files[0];
                const name = f ? f.name : "";
                setLocal(name);
                onUpdate(id, name);
              }}
              style={{ ...sty, padding: "8px 10px", cursor: "pointer" }}
            />
            {local && <span style={{ fontSize: 11, color: "#4a9e8e", fontWeight: 600, whiteSpace: "nowrap" }}>✓ {local}</span>}
          </div>
        );
      case "date":
        return (
          <input ref={ref} type="date" value={local} onChange={handleChange} style={sty} />
        );
      case "number":
        return (
          <input ref={ref} type="number" value={local} onChange={handleChange} placeholder={placeholder} style={sty} />
        );
      case "email":
        return (
          <input ref={ref} type="email" value={local} onChange={handleChange} placeholder={placeholder} style={sty} />
        );
      case "tel":
        return (
          <input ref={ref} type="tel" value={local} onChange={handleChange} placeholder={placeholder} style={sty} />
        );
      case "text":
      default:
        return (
          <input ref={ref} type="text" value={local} onChange={handleChange} placeholder={placeholder} style={sty} />
        );
    }
  };

  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#1a3a4a", marginBottom: 5 }}>{label} {required && <span style={{ color: "#d44" }}>*</span>}</label>
      {renderInput()}
    </div>
  );
}

// A field that was pre-populated from the AI research (e.g. nationality / date
// of birth a director's registry record carried). Shown as a locked value with
// a source badge — but, unlike the fully-locked name, the customer can click
// "Edit" to override it. When the value is empty it falls straight through to
// the editable input so nothing is pre-filled. Module-scoped so its `editing`
// state survives parent re-renders (same reason StableInput lives out here).
function PrePopulatedField({ id, label, value, displayValue, type, onUpdate, sourceLabel, required, placeholder }) {
  const [editing, setEditing] = useState(false);
  const labelStyle = { display: "block", fontSize: 12, fontWeight: 600, color: C.text, marginBottom: 5 };

  if (editing || !value) {
    return (
      <div style={{ marginBottom: 14 }}>
        <StableInput
          id={id}
          label={label}
          type={type || "text"}
          value={value || ""}
          onUpdate={onUpdate}
          required={required}
          placeholder={placeholder}
        />
        {value && (
          <button
            type="button"
            onClick={() => setEditing(false)}
            style={{ fontSize: 11, color: C.textMuted, background: "none", border: "none", cursor: "pointer", padding: "2px 0", fontFamily: "inherit" }}
          >
            Cancel edit
          </button>
        )}
      </div>
    );
  }

  return (
    <div style={{ marginBottom: 14 }}>
      <label style={labelStyle}>{label} {required && <span style={{ color: "#d44" }}>*</span>}</label>
      <div style={{
        padding: "10px 14px", background: C.infoBg, borderRadius: 8,
        border: `1px solid ${C.infoBorder}`, fontSize: 14, color: C.text,
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
      }}>
        <span>{displayValue || value}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <span style={{ fontSize: 11, color: C.info, fontWeight: 600 }}>~ {sourceLabel || "Found"}</span>
          <button
            type="button"
            onClick={() => setEditing(true)}
            style={{ fontSize: 11, color: C.niumBlue, background: "none", border: `1px solid ${C.niumBlue}`, borderRadius: 4, padding: "2px 8px", cursor: "pointer", fontFamily: "inherit" }}
          >
            Edit
          </button>
        </div>
      </div>
    </div>
  );
}

export default function KYCAgent({ previewMode = false } = {}) {
  // Tenant config — loaded from /api/config on mount, or from sessionStorage
  // when running in preview mode (the admin "Preview" button stages the
  // current unsaved config under the "preview_config" key).
  //
  // Tenant resolution comes from the URL (?tenant=X) so this component can
  // serve any tenant; "nium" is the default for plain /. Preview mode is
  // either triggered by the /preview route (index.js sets previewMode prop)
  // or by ?preview=true in the URL.
  const [tenantId] = useState(() => getTenantId());
  const [tenantConfig, setTenantConfig] = useState(null);
  const [configLoading, setConfigLoading] = useState(true);
  const inPreview = previewMode || isPreviewMode();
  // Timestamp the staged preview config was captured (admin click time). Shown
  // in the preview banner so the admin can tell whether the tab is stale.
  const [previewTimestamp, setPreviewTimestamp] = useState(null);
  // True when /?preview=true is set but no sessionStorage staged config was
  // found — banner switches to amber + "go to admin" link.
  const [previewMissing, setPreviewMissing] = useState(false);

  // Demo mode — when on, all journeys short-circuit to doDummyResearch so the
  // flow renders instantly with sample data. Initialised from ?demo=true or
  // a prior sessionStorage opt-in so it survives step navigation.
  const [demoMode, setDemoModeState] = useState(() => {
    try {
      const params = typeof window !== "undefined"
        ? new URLSearchParams(window.location.search)
        : null;
      if (params && params.get("demo") === "true") return true;
      if (typeof sessionStorage !== "undefined"
          && sessionStorage.getItem("demo_mode") === "true") return true;
    } catch (_) { /* ignore */ }
    return false;
  });
  const setDemoMode = useCallback((next) => {
    setDemoModeState(next);
    try {
      if (next) sessionStorage.setItem("demo_mode", "true");
      else sessionStorage.removeItem("demo_mode");
    } catch (_) { /* ignore */ }
  }, []);
  // Visibility gate — the toggle is hidden on production end-customer URLs.
  // Surfaces when ?demo=true is in the URL, on localhost, or when a ?tenant=
  // override is being used (admin/dev/testing contexts).
  const demoToggleVisible = (() => {
    if (typeof window === "undefined") return false;
    try {
      const p = new URLSearchParams(window.location.search);
      if (p.get("demo") === "true") return true;
      if (p.get("tenant")) return true;
      const host = window.location.hostname;
      if (host === "localhost" || host === "127.0.0.1") return true;
    } catch (_) { /* ignore */ }
    return false;
  })();

  useEffect(() => {
    let cancelled = false;
    // Preview can be triggered two ways: index.js route /preview (sets the
    // previewMode prop) OR admin Preview button which opens /?preview=true
    // (detected by isPreviewMode()). Both should load the staged config
    // from sessionStorage, not the live /api/config.
    const previewActive = previewMode || isPreviewMode();
    if (previewActive) {
      try {
        // sessionStorage is the canonical channel (written by the admin Preview
        // button). Fall back to legacy localStorage for tabs opened before the
        // sessionStorage migration.
        const raw = sessionStorage.getItem("preview_config")
          || localStorage.getItem("preview_config");
        const ts = sessionStorage.getItem("preview_timestamp")
          || localStorage.getItem("preview_config_ts");
        if (raw) {
          setTenantConfig(JSON.parse(raw));
          setPreviewTimestamp(ts || null);
          setPreviewMissing(false);
          setConfigLoading(false);
          return () => {};
        }
      } catch (_) { /* fall through */ }
      // No staged config — surface this in the banner and fall through to the
      // normal API fetch so the page still has SOMETHING to render.
      setPreviewMissing(true);
    }
    const url = `/api/config?tenant=${encodeURIComponent(tenantId)}`;
    fetch(url, { cache: "no-store" })
      .then((r) => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((cfg) => { if (!cancelled) { setTenantConfig(cfg); setConfigLoading(false); } })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.warn("Falling back to local default config:", err.message);
        if (!cancelled) {
          setTenantConfig(buildLocalDefaultConfig());
          setConfigLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [previewMode, tenantId]);

  const [step, setStep] = useState(0);
  // Scroll to top on every step transition. React keeps the previous scroll
  // position by default — undesirable for a stepped wizard where the new
  // page's heading should be visible immediately. The smooth scroll here
  // is the catch-all; for user-triggered Next clicks we also scroll
  // instantly before the new step renders (see scrollAndSetStep below) so
  // there is no flash of the previous page's bottom.
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [step]);
  const scrollAndSetStep = useCallback((next) => {
    if (typeof window !== "undefined") {
      try { window.scrollTo({ top: 0, behavior: "instant" }); }
      catch (_) { window.scrollTo(0, 0); }
    }
    setStep(next);
  }, []);
  const [companyName, setCompanyName] = useState("");
  const [countryCode, setCountryCode] = useState("");
  const [entityType, setEntityType] = useState("");
  // Ownership type (Step 1) — drives the Phase 0 research strategy. Reset to ""
  // whenever the entity type changes, since each entity type exposes a
  // different set of allowed ownership types.
  const [ownershipType, setOwnershipType] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [research, setResearch] = useState(null);
  // Coverage analysis (Phase 2) for the current research result. Null until the
  // first research pass completes.
  const [coverage, setCoverage] = useState(null);
  // Whether the Phase 3 gap-recovery second pass ran for the current result.
  const [gapRecoveryRan, setGapRecoveryRan] = useState(false);
  // Transient status line shown on the research loader between/within passes.
  const [researchStatus, setResearchStatus] = useState("");
  const [researchTimestamp, setResearchTimestamp] = useState("");
  // DRS (document requirements service) session state. Populated when the
  // customer completes the dynamic documents step; consumed by the
  // pre-declaration gap gate (Step5Recompute).
  const [drsSubmitted, setDrsSubmitted] = useState([]);   // submittedRequirements[]
  const [drsFlags, setDrsFlags] = useState({});           // feature flags from Step 2
  const [drsGapsCleared, setDrsGapsCleared] = useState(false); // declaration gate
  // Derived: is the company being onboarded publicly listed? Drives the
  // stakeholder-EDD suppression on Fill Gaps (listed-company directors and
  // sub-25% UBOs skip the detailed gap form).
  const isPubliclyListed = useMemo(() => detectPubliclyListed(research), [research]);
  const [checks, setChecks] = useState({});
  // Per-person rejection for stakeholder fields. Shape:
  //   { [fieldId]: Set<stakeholderId> }
  // A stakeholder id present in the set means the customer unchecked that
  // person on Confirm. Sets are recreated immutably on every toggle.
  const [rejectedStakeholders, setRejectedStakeholders] = useState({});
  // Which stakeholder cards are expanded on Confirm, keyed by stakeholder id.
  // Absent / false = collapsed. All cards start collapsed.
  const [expandedStakeholders, setExpandedStakeholders] = useState({});
  // Manual "this is a publicly listed company" toggle on Confirm. When on, it
  // suppresses stakeholder EDD forms on Fill Gaps the same way auto-detection
  // would (see effectivelyListed below).
  const [isPubliclyListedOverride, setIsPubliclyListedOverride] = useState(false);
  // Single source of truth for "treat as listed" — auto-detected OR manually
  // declared on Confirm. Used by the gap forms, validation, the Fill Gaps
  // caller, and the submission payload so the behaviour stays consistent.
  const effectivelyListed = isPubliclyListed || isPubliclyListedOverride;
  const [revealedTs, setRevealedTs] = useState({});
  const gapRef = useRef({});
  // Per-person stakeholder data on Fill Gaps. Parallel to gapRef, but each
  // field id maps to an array of stakeholder records (objects with full_name,
  // nationality, date_of_birth, is_pep, etc). Kept in a ref so text-field
  // edits don't churn the whole tree every keystroke. setStakeholderVersion
  // is the explicit re-render trigger for changes that need to surface to
  // the UI (add/remove/select/toggle/text).
  const stakeholdersRef = useRef({});
  const [, setStakeholderVersion] = useState(0);
  const [stakeholderErrors, setStakeholderErrors] = useState([]);
  // bumped whenever we mutate gapRef from outside the input (e.g. test-data fill)
  // so StableInput components re-sync from the new ref values.
  const [, setFormVersion] = useState(0);
  const [declared, setDeclared] = useState(false);
  const [done, setDone] = useState(false);
  const [device, setDevice] = useState({});
  const [loaderIdx, setLoaderIdx] = useState(0);
  const [loaderPhase, setLoaderPhase] = useState(0); // 0 = no Wolfsberg, 1 = extraction, 2 = web research
  const [submitTs, setSubmitTs] = useState("");
  const [activeSchema, setActiveSchema] = useState(null);
  const [uploadedDocs, setUploadedDocs] = useState(initialUploadedDocs());
  // Journey selection (Part 1) — lives between Step 1 input and the rest.
  const [journeyType, setJourneyType] = useState("");          // "ai_documents" | "ai_only" | "manual" | ""
  const [journeyOpen, setJourneyOpen] = useState(false);
  const [selectedJourneyCard, setSelectedJourneyCard] = useState(null); // "A" | "B" | "C"
  const [manualOpened, setManualOpened] = useState(false);
  // Part 5 — silent metadata trail of every pre-fill / customer action.
  const [fieldMetadata, setFieldMetadata] = useState([]);
  // Loader messages — replaced per-run in doResearch when documents are
  // being processed. Phase 0 = web only, Phase 1 = doc extraction, Phase 2 = web.
  const [phase1Msgs, setPhase1Msgs] = useState(LOADER_MSGS_WOLFSBERG_PHASE1);

  // Step routing: ai_documents flow inserts a Documents step between Input and Research.
  // stepsFor() takes a journey explicitly so async handlers can compute the
  // correct step index without relying on a stale state closure (e.g. during
  // back-and-forth navigation between Documents and Journey).
  const stepsFor = (j) => j === "ai_documents"
    ? { input: 0, documents: 1, research: 2, confirm: 3, fillGaps: 4, documentRequirements: 5, declare: 6 }
    : { input: 0, research: 1, confirm: 2, fillGaps: 3, documentRequirements: 4, declare: 5 };
  const isAiDocs = journeyType === "ai_documents";
  const STEPS = stepsFor(journeyType);
  const stepNames = isAiDocs
    ? ["Company", "Documents", "Research", "Confirm", "Fill Gaps", "Required Docs", "Declare"]
    : ["Company", "Research", "Confirm", "Fill Gaps", "Required Docs", "Declare"];

  // Loader messages — three modes: no docs (existing), doc-extraction phase, web phase.
  const loaderMsgs = loaderPhase === 1
    ? phase1Msgs
    : loaderPhase === 2
      ? LOADER_MSGS_WOLFSBERG_PHASE2
      : LOADER_MSGS;

  useEffect(() => {
    if (!loading) return;
    const t = setInterval(() => setLoaderIdx(i => Math.min(i + 1, loaderMsgs.length - 1)), 2500);
    return () => clearInterval(t);
  }, [loading, loaderMsgs]);

  useEffect(() => {
    const fetchIP = async () => { try { const r = await fetch("https://api.ipify.org?format=json"); const d = await r.json(); return d.ip; } catch { return "Could not detect"; } };
    fetchIP().then(ip => setDevice({ ipAddress: ip, userAgent: navigator.userAgent, platform: navigator.platform, language: navigator.language, screenRes: window.screen.width + "x" + window.screen.height, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }));
  }, []);

  const countryObj = COUNTRIES.find(c => c.code === countryCode);

  // Fields referenced by any other field's dependsOn — when their value changes
  // we bump formVersion so conditional fields show/hide. Computed once per
  // schema change so text-field updates stay cheap. Also tracks
  // `corrected_<researchField>` for deps whose parent now lives in researchFields.
  const parentFieldsRef = useRef(new Set());
  useEffect(() => {
    const s = new Set();
    if (activeSchema) {
      activeSchema.gapFields.forEach(f => {
        if (f.dependsOn) Object.keys(f.dependsOn).forEach(k => {
          s.add(k);
          if (activeSchema.researchFields.some(rf => rf.field === k)) {
            s.add("corrected_" + k);
          }
        });
      });
    }
    parentFieldsRef.current = s;
  }, [activeSchema]);

  const updateGap = useCallback((field, value) => {
    gapRef.current[field] = value;
    if (parentFieldsRef.current.has(field)) setFormVersion(v => v + 1);
  }, []);

  // Effective parent value for dependsOn evaluation:
  //   1. customer correction (if user unchecked the research item and entered a new value)
  //   2. direct gap-field value
  //   3. AI-researched value
  const dependsOnSatisfied = (g) => {
    if (!g.dependsOn) return true;
    return Object.entries(g.dependsOn).every(([k, v]) => {
      const corrected = gapRef.current["corrected_" + k];
      if (corrected !== undefined && corrected !== "") return corrected === v;
      const gap = gapRef.current[k];
      if (gap !== undefined && gap !== "") return gap === v;
      if (research && research.found) {
        const item = research.found.find(it => it.field === k);
        if (item) return item.value === v;
      }
      return false;
    });
  };

  const resetAll = () => {
    setStep(STEPS.input); setResearch(null); setActiveSchema(null);
    setChecks({}); setRejectedStakeholders({}); setExpandedStakeholders({}); setIsPubliclyListedOverride(false); setRevealedTs({}); setResearchTimestamp("");
    gapRef.current = {}; setFormVersion(v => v + 1);
    stakeholdersRef.current = {}; setStakeholderVersion(v => v + 1); setStakeholderErrors([]);
    setError(""); setDeclared(false);
    setUploadedDocs(initialUploadedDocs());
    setJourneyType(""); setJourneyOpen(false); setSelectedJourneyCard(null); setManualOpened(false);
    setFieldMetadata([]);
    setLoaderPhase(0);
    setCoverage(null); setGapRecoveryRan(false); setResearchStatus("");
    setDrsSubmitted([]); setDrsFlags({}); setDrsGapsCleared(false);
  };

  const isStakeholderRejected = (fieldId, stakeholderId) => {
    const set = rejectedStakeholders[fieldId];
    return set ? set.has(stakeholderId) : false;
  };

  const toggleStakeholderRejection = (fieldId, stakeholderId) => {
    setRejectedStakeholders((prev) => {
      const current = new Set(prev[fieldId] ? Array.from(prev[fieldId]) : []);
      if (current.has(stakeholderId)) current.delete(stakeholderId);
      else current.add(stakeholderId);
      return { ...prev, [fieldId]: current };
    });
  };

  const isStakeholderExpanded = (id) => expandedStakeholders[id] === true;
  const toggleStakeholderExpanded = (id) => {
    setExpandedStakeholders((prev) => ({ ...prev, [id]: !prev[id] }));
  };
  const setStakeholdersExpanded = (ids, expanded) => {
    setExpandedStakeholders((prev) => {
      const next = { ...prev };
      ids.forEach((id) => { next[id] = expanded; });
      return next;
    });
  };

  // Read + write helpers for per-person stakeholder data on Fill Gaps. The
  // ref is the source of truth; setStakeholderVersion bumps the explicit
  // re-render counter so completion badges, PEP-details visibility, and
  // validation messaging stay in sync with what's in the ref.
  const getStakeholders = (fieldId) => stakeholdersRef.current[fieldId] || [];
  const setStakeholders = (fieldId, arr) => {
    stakeholdersRef.current = { ...stakeholdersRef.current, [fieldId]: arr };
    setStakeholderErrors([]);
    setStakeholderVersion((v) => v + 1);
  };
  const updateStakeholderField = (fieldId, stakeholderId, key, value) => {
    const current = getStakeholders(fieldId);
    const next = current.map((s) => (s.id === stakeholderId ? { ...s, [key]: value } : s));
    setStakeholders(fieldId, next);
  };
  const addStakeholder = (fieldId) => {
    const current = getStakeholders(fieldId);
    setStakeholders(fieldId, [...current, makeStakeholder({ customer_added: true })]);
  };
  const removeStakeholder = (fieldId, stakeholderId) => {
    const current = getStakeholders(fieldId);
    setStakeholders(fieldId, current.filter((s) => s.id !== stakeholderId));
  };

  // Initialise / re-sync stakeholdersRef from research.found whenever we
  // enter Fill Gaps. Preserves user edits across navigation: any
  // stakeholder id that's already in the ref keeps its existing fields and
  // only has its customer_rejected flag re-applied from the current
  // rejectedStakeholders set. New ids from research get seeded; manually
  // added (customer_added=true) entries are preserved verbatim.
  const initStakeholdersForFillGaps = useCallback(() => {
    if (!research || !Array.isArray(research.found)) return;
    const nextMap = { ...stakeholdersRef.current };
    research.found.forEach((result) => {
      if (!isStakeholderField(result.field)) return;
      if (!Array.isArray(result.stakeholders) || result.stakeholders.length === 0) return;
      const fieldId = result.field;
      // Registry exemption notices are not people — keep them out of the ref so
      // they can never become a person card or EDD form.
      const aiStakeholders = result.stakeholders.filter((s) => !isRegistryExemptionNotice(s));
      const existing = nextMap[fieldId] || [];
      const existingById = new Map(existing.map((s) => [s.id, s]));
      const rejectedIds = rejectedStakeholders[fieldId] || new Set();
      const aiIds = new Set(aiStakeholders.map((s) => s.id));

      const seeded = aiStakeholders.map((ai) => {
        const prior = existingById.get(ai.id);
        const isRejected = rejectedIds.has(ai.id);
        if (prior) {
          // Preserve customer edits; only re-apply the rejection flag and the
          // name-clearing behaviour for newly-rejected entries.
          if (isRejected && !prior.customer_rejected) {
            return {
              ...prior,
              customer_rejected: true,
              full_name_original: prior.full_name_original || ai.full_name,
              full_name: "",
            };
          }
          if (!isRejected && prior.customer_rejected) {
            return {
              ...prior,
              customer_rejected: false,
              full_name: prior.full_name || prior.full_name_original || ai.full_name,
            };
          }
          return { ...prior, customer_rejected: isRejected };
        }
        // First seed for this person.
        if (isRejected) {
          return {
            ...ai,
            customer_rejected: true,
            full_name_original: ai.full_name,
            full_name: "",
          };
        }
        return { ...ai, customer_rejected: false };
      });

      // Keep customer-added persons that aren't part of the AI list.
      const customerAdded = existing.filter((s) => s.customer_added && !aiIds.has(s.id));
      nextMap[fieldId] = [...seeded, ...customerAdded];
    });
    stakeholdersRef.current = nextMap;
    setStakeholderVersion((v) => v + 1);
  }, [research, rejectedStakeholders]);

  useEffect(() => {
    if (step === STEPS.fillGaps) initStakeholdersForFillGaps();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, research, rejectedStakeholders]);

  const fillTestData = () => {
    getCombinedGaps().forEach(g => {
      const current = gapRef.current[g.field];
      if (current && String(current).trim().length > 0) return;
      let val = TEST_DATA[g.field];
      if (val === undefined && g.field.startsWith("corrected_")) {
        const original = g.field.replace(/^corrected_/, "");
        val = TEST_DATA[original] || "Corrected value";
      }
      if (val === undefined) {
        val = g.inputType === "select" && g.options && g.options.length > 0 ? g.options[0] : "Sample value";
      }
      gapRef.current[g.field] = val;
    });
    setFormVersion(v => v + 1);

    // Also fill stakeholder compliance fields for any per-person cards
    // currently in stakeholdersRef. Doesn't add new people, doesn't overwrite
    // already-filled fields — keeps existing edits intact and just paints
    // sensible demo values into the blanks.
    const demoCountry = countryObj ? countryObj.name : "United Kingdom";
    const demoIdType = "passport";
    const demoIdNum = "GB1234567";
    const demoDob = "1980-05-15";
    const demoNationality = countryCode === "GB" ? "British" : countryCode === "SG" ? "Singaporean" : "British";
    let touched = false;
    Object.keys(stakeholdersRef.current || {}).forEach((fieldId) => {
      const list = stakeholdersRef.current[fieldId] || [];
      const next = list.map((s) => {
        const out = { ...s };
        if (!out.full_name && out.customer_rejected && out.full_name_original) {
          out.full_name = out.full_name_original;
        }
        if (!out.full_name && out.customer_added) out.full_name = "Demo Person";
        if (!out.nationality) out.nationality = demoNationality;
        if (!out.date_of_birth) out.date_of_birth = demoDob;
        if (!out.residential_country) out.residential_country = demoCountry;
        if (!out.id_type) out.id_type = demoIdType;
        if (!out.id_number) out.id_number = demoIdNum;
        if (out.is_pep === null || out.is_pep === undefined) out.is_pep = false;
        return out;
      });
      stakeholdersRef.current[fieldId] = next;
      touched = true;
    });
    if (touched) {
      setStakeholderErrors([]);
      setStakeholderVersion(v => v + 1);
    }
  };

  // Unified post-Confirm gap list.
  //   1. corrections — fields the user unchecked on Confirm (any tier)
  //   2. missing_research — research fields the AI couldn't find from
  //      any source (rendered as plain text inputs, optional)
  //   3. schema.gapFields — always-manual fields
  const getCombinedGaps = () => {
    if (!research || !activeSchema) return [];
    const apiGaps = research.gaps || activeSchema.gapFields;

    // Corrections — fields the user unchecked on Confirm. We must preserve
    // the original field's inputType and (for selects) options so the
    // correction is collected with the same UI as the original; defaulting
    // to "text" would mean a dropdown loses its option list at this point.
    const unchecked = (research.found || [])
      .filter((item, i) => !checks[i])
      .map(item => {
        const def = findFieldDef(activeSchema, item.field) || {};
        return {
          field: "corrected_" + item.field,
          label: item.label + " (correction needed)",
          reason: "Original: " + resolveDisplayValue(def, item.value),
          inputType: def.inputType || "text",
          options: def.options || undefined,
          dependsOn: def.dependsOn || undefined,
          required: true,
          section: "corrections",
        };
      });

    // Missing research — fields the AI couldn't find. Same principle: keep
    // the configured inputType/options so a dropdown stays a dropdown.
    const foundIds = new Set((research.found || []).map(i => i.field));
    const missingResearch = (activeSchema.researchFields || [])
      .filter(rf => !foundIds.has(rf.field))
      .map(rf => ({
        field: rf.field,
        label: rf.label,
        inputType: rf.inputType || "text",
        options: rf.options || undefined,
        dependsOn: rf.dependsOn || undefined,
        required: false,
        section: "missing_research",
      }));

    return [...unchecked, ...missingResearch, ...apiGaps];
  };

  const allGapsFilled = () => getCombinedGaps().filter(g => g.required).every(g => {
    if (!dependsOnSatisfied(g)) return true;
    const v = gapRef.current[g.field];
    if (!v || !String(v).trim()) return false;
    return true;
  });

  // ─── Single-doc extraction helper. Returns { docFound, wolfsbergFields, raw }.
  // - docFound: array of result rows tagged sourceTier:"document"
  // - wolfsbergFields: only populated for the Wolfsberg slot (legacy object format),
  //     used to seed the web prompt so the AI doesn't re-search those fields.
  // - raw: parsed JSON for the by-doc audit map.
  const extractFromDoc = async (docType, file, schema, flow, fetchTs) => {
    const base64 = await readFileAsBase64(file);
    const mediaType = file.type === "image/png" || file.type === "image/jpeg" ? file.type : "application/pdf";
    const isImage = mediaType.startsWith("image/");
    const blockType = isImage ? "image" : "document";
    const resp = await fetch("/api/research", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 4096,
        tools: [],
        messages: [{
          role: "user",
          content: [
            { type: blockType, source: { type: "base64", media_type: mediaType, data: base64 } },
            { type: "text", text: docType.extractionPrompt },
          ],
        }],
      }),
    });
    if (!resp.ok) {
      // eslint-disable-next-line no-console
      console.warn(`Extraction call failed for ${docType.key}`, resp.status);
      return { docFound: [], wolfsbergFields: {}, raw: null };
    }
    const respData = await resp.json();
    const txt = (respData.content || []).filter(b => b.type === "text").map(b => b.text).join("");
    const cleaned = txt.replace(/^```json\s*/i, "").replace(/^```/i, "").replace(/```\s*$/i, "").trim();
    if (docType.returnsObject) {
      // Wolfsberg legacy shape — let the web prompt do the field-id mapping.
      try {
        const parsed = JSON.parse(cleaned);
        const filtered = Object.fromEntries(Object.entries(parsed).filter(([, v]) => v !== null && v !== ""));
        return { docFound: [], wolfsbergFields: filtered, raw: filtered };
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn(`Could not parse Wolfsberg extraction`, e, txt);
        return { docFound: [], wolfsbergFields: {}, raw: null };
      }
    }
    try {
      const arr = JSON.parse(cleaned);
      if (!Array.isArray(arr)) return { docFound: [], wolfsbergFields: {}, raw: arr };
      const docFound = [];
      for (const entry of arr) {
        if (!entry || !entry.fieldId || entry.value === null || entry.value === undefined || entry.value === "") continue;
        const mapped = mapExtractedKey(flow, entry.fieldId);
        if (!mapped) continue;
        const sf = schema.researchFields.find(r => r.field === mapped);
        if (!sf) continue;
        if (docFound.some(f => f.field === mapped)) continue;
        docFound.push({
          field: mapped, label: sf.label, value: String(entry.value),
          source: docType.sourceName, sourceUrl: null,
          sourceTier: "document", verificationStatus: "verified", documentType: docType.key,
          fetchedAt: fetchTs, method: "document_extract", confidence: "high",
          trust: "authoritative", wolfsberg: false,
        });
      }
      return { docFound, wolfsbergFields: {}, raw: arr };
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(`Could not parse extraction for ${docType.key}`, e, txt);
      return { docFound: [], wolfsbergFields: {}, raw: null };
    }
  };

  const doResearch = async (journeyOverride) => {
    if (!companyName.trim()) { setError("Please enter a company name."); return; }
    if (!entityType) { setError("Please select an entity type."); return; }
    if (!countryCode) { setError("Please select a country."); return; }
    setError("");
    const journey = journeyOverride || journeyType || "ai_only";
    const S = stepsFor(journey);
    const schema = getSchemaFromConfig(countryCode, entityType, tenantConfig);
    setActiveSchema(schema);
    setLoading(true); setStep(S.research); setLoaderIdx(0);
    try {
      // ─── Phase 1: extract from each uploaded document, in DOC_TYPES order ───
      const flow = schema.flow === "fi" ? "fi" : "corporate";
      const hasAnyDocs = DOC_TYPES.some(d => uploadedDocs[d.key]);
      const runDocPhase = journey === "ai_documents" && hasAnyDocs;

      let docFound = [];                  // sourceTier:"document" rows, ordered by DOC_TYPES priority
      let wolfsbergFields = {};           // legacy obj for prompt injection

      if (runDocPhase) {
        setPhase1Msgs(buildPhase1Msgs(uploadedDocs));
        setLoaderPhase(1); setLoaderIdx(0);
        for (let i = 0; i < DOC_TYPES.length; i++) {
          const dt = DOC_TYPES[i];
          const file = uploadedDocs[dt.key];
          if (!file) continue;
          const fetchTs = new Date().toISOString();
          const { docFound: dFound, wolfsbergFields: wFields } = await extractFromDoc(dt, file, schema, flow, fetchTs);
          if (dt.key === "wolfsberg") wolfsbergFields = wFields;
          // Dedup: keep first source (which respects DOC_TYPES priority order).
          for (const row of dFound) {
            if (!docFound.some(f => f.field === row.field)) docFound.push(row);
          }
        }
        setLoaderPhase(2); setLoaderIdx(0);
      }

      // ─── Phase 2: web research, optionally seeded with Wolfsberg fields ───
      const resp = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: buildPrompt(companyName, countryObj ? countryObj.name : countryCode, countryCode, schema, wolfsbergFields, ownershipType)
        })
      });
      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        const claudeErr = errData && errData.details && errData.details.error;
        if (claudeErr && claudeErr.type === "rate_limit_error") {
          throw new Error("Anthropic rate limit reached for this minute. Wait ~60 seconds and try again, or add credits to raise your limit.");
        }
        if (claudeErr && claudeErr.message) {
          throw new Error(`${errData.error || "Claude API error"}: ${claudeErr.message}`);
        }
        throw new Error(errData.error || `HTTP ${resp.status}`);
      }
      const data = await resp.json();
      let text = "";
      for (const block of (data.content || [])) { if (block.type === "text" && block.text) text += block.text; }
      text = text.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();
      const si = text.indexOf("{"); const ei = text.lastIndexOf("}");
      if (si === -1 || ei === -1) throw new Error("No JSON found in response");
      let parsed;
      try {
        parsed = JSON.parse(text.slice(si, ei + 1));
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error("Raw research response (could not parse):", text);
        throw new Error(`Response was not valid JSON (${e.message}). Likely the model hit max_tokens — see browser console for the full response.`);
      }
      const webFetchTs = new Date().toISOString();
      // Classify one raw research row into our tiered/verification shape.
      // Shared by the first pass and the Phase 3 gap-recovery pass.
      const classifyWebRow = (item, ts) => {
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
      const webFound = (parsed.found || []).map((item) => classifyWebRow(item, webFetchTs));

      // Doc-extracted rows take priority over anything web returned for the same field.
      const docFieldIds = new Set(docFound.map(f => f.field));
      const mergedRaw = [...docFound, ...webFound.filter(f => !docFieldIds.has(f.field))];
      // Coerce free-text values for dropdown fields onto one of the configured
      // option values (e.g. "Private Limited Company" → "private_limited") so
      // the gap form can pre-select correctly on correction.
      let merged = enrichStakeholders(mapAIValuesToOptions(mergedRaw, schema));

      // ─── Phase 2: coverage analysis ───
      let cov = computeCoverage(merged, schema);

      // ─── Phase 3: gap-recovery second pass ───
      const recoveryStrategy = ownershipType ? computeResearchStrategy(ownershipType, countryCode) : null;
      const upgradeable = merged.filter(
        (r) => r.verificationStatus === "indicative" && hasPlausibleHigherTierSource(r.field)
      );
      const shouldRunGapRecovery =
        (cov.fillRate < 0.60 || cov.verifiedFillRate < 0.40) && cov.missingFields.length > 0;
      let ranGapRecovery = false;
      if (shouldRunGapRecovery) {
        ranGapRecovery = true;
        setResearchStatus(`Found ${cov.populatedFields} fields — running targeted search for ${cov.missingFieldCount} more…`);
        try {
          const gapResp = await fetch("/api/research", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              prompt: buildGapRecoveryPrompt(
                { name: companyName, countryName: countryObj ? countryObj.name : countryCode },
                cov.missingFields,
                upgradeable,
                recoveryStrategy
              ),
            }),
          });
          if (gapResp.ok) {
            const gapData = await gapResp.json();
            let gapText = "";
            for (const block of (gapData.content || [])) { if (block.type === "text" && block.text) gapText += block.text; }
            gapText = gapText.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();
            const gsi = gapText.indexOf("{"); const gei = gapText.lastIndexOf("}");
            if (gsi !== -1 && gei !== -1) {
              const gapParsed = JSON.parse(gapText.slice(gsi, gei + 1));
              const gapTs = new Date().toISOString();
              const gapRows = (gapParsed.found || [])
                .map((item) => classifyWebRow(item, gapTs))
                // Never let gap recovery override a document-sourced row.
                .filter((r) => !docFieldIds.has(r.field));
              const remerged = mergeResearchResults(merged, gapRows);
              merged = enrichStakeholders(mapAIValuesToOptions(remerged, schema));
              cov = computeCoverage(merged, schema);
            }
          }
        } catch (gapErr) {
          // Gap recovery is best-effort — keep the first-pass results on failure.
          // eslint-disable-next-line no-console
          console.warn("Gap recovery pass failed:", gapErr.message);
        }
        setResearchStatus("");
      }

      setResearch({ ...parsed, found: merged });
      setResearchTimestamp(webFetchTs);
      setCoverage(cov);
      setGapRecoveryRan(ranGapRecovery);

      // Build silent metadata trail (Part 5).
      const meta = merged.map(item => ({
        fieldId: item.field, value: item.value,
        source: item.source || "Unknown", sourceUrl: item.sourceUrl || null,
        sourceTier: item.sourceTier, verificationStatus: item.verificationStatus,
        documentType: item.documentType || null,
        fetchedAt: item.fetchedAt, method: item.method, confidence: item.confidence,
        customerAction: null, customerActionAt: null,
      }));
      setFieldMetadata(meta);

      // Unified pre-fill engine: pre-check every found item. Customer unchecks
      // anything wrong, including tier-2/tier-3 items (which carry an inline
      // warning on the Confirm page).
      const c = {};
      merged.forEach((_, i) => { c[i] = true; });
      setChecks(c);
      setRejectedStakeholders({});
      setExpandedStakeholders({});
      setIsPubliclyListedOverride(false);
      stakeholdersRef.current = {};
      setStakeholderVersion(v => v + 1);
      setStakeholderErrors([]);
      setRevealedTs({});
      gapRef.current = {};
      setFormVersion(v => v + 1);
      setStep(S.confirm);
    } catch (err) { setError("Research failed: " + err.message); setStep(S.input); }
    finally { setLoading(false); setLoaderPhase(0); setResearchStatus(""); }
  };

  // Bypasses /api/research and synthesises a plausible result using
  // DUMMY_RESEARCH_VALUES + the selected country's authoritative source list.
  // Mirrors the production flow: doc-uploaded fields tagged sourceTier:"document",
  // plus a sprinkle of tier-2 web rows.
  const doDummyResearch = async (journeyOverride) => {
    if (!companyName.trim()) { setError("Please enter a company name."); return; }
    if (!entityType) { setError("Please select an entity type."); return; }
    if (!countryCode) { setError("Please select a country."); return; }
    setError("");
    // Demo: default the ownership type if the tester skipped it on Step 1.
    if (!ownershipType) setOwnershipType("public_listed");
    const journey = journeyOverride || journeyType || "ai_only";
    const S = stepsFor(journey);
    const schema = getSchemaFromConfig(countryCode, entityType, tenantConfig);
    setActiveSchema(schema);
    setLoading(true); setStep(S.research); setLoaderIdx(0);

    const hasAnyDocs = DOC_TYPES.some(d => uploadedDocs[d.key]);
    const runDocPhase = journey === "ai_documents" && hasAnyDocs;

    if (runDocPhase) {
      setPhase1Msgs(buildPhase1Msgs(uploadedDocs));
      setLoaderPhase(1);
      await new Promise(r => setTimeout(r, 1500));
      setLoaderPhase(2); setLoaderIdx(0);
      await new Promise(r => setTimeout(r, 1500));
    } else {
      await new Promise(r => setTimeout(r, 3000));
    }

    const authPattern = (SOURCE_TRUST[countryCode] || ["public registry"])[0];
    const authSource = authPattern.replace(/\b\w/g, c => c.toUpperCase());

    // Build a mock "doc-extracted" set: pick representative fields for each
    // uploaded doc so the navy badge gets exercised on Confirm.
    const docExtractedByField = {};   // field → { docKey, sourceName }
    if (runDocPhase) {
      const mockMap = {
        wolfsberg: ["regulatory_authority", "licence_number", "has_licence", "ubo_parent_company", "ubo_share_percentage", "non_resident_customers", "services_other_fis"],
        certificate: ["business_name", "registration_number", "incorporation_date", "registered_address_line1", "tradeName", "businessRegistrationNumber", "registeredDate", "addressLine1", "businessType", "registeredCountry"],
        licence: ["licence_number", "regulatory_authority", "has_licence"],
        annualReport: ["annual_turnover", "employee_count", "operating_countries", "publicly_listed", "annualRevenue", "employees", "countriesOfOperation", "stockListing"],
        financialStatements: ["annual_turnover", "employee_count", "annualRevenue", "employees"],
        orgChart: ["ubo_parent_company", "ubo_share_percentage", "uboAnalysis"],
        amlPolicy: [],
      };
      DOC_TYPES.forEach(dt => {
        if (!uploadedDocs[dt.key]) return;
        const fields = mockMap[dt.key] || [];
        fields.forEach(f => {
          if (!(f in docExtractedByField)) {
            docExtractedByField[f] = { docKey: dt.key, sourceName: dt.sourceName };
          }
        });
      });
    }

    const dummyTs = new Date().toISOString();
    const foundRaw = schema.researchFields.map((f, i) => {
      const docHit = docExtractedByField[f.field];
      // Exercise all three tiers in the demo: most rows tier1 (official), a
      // slice tier2 (company-owned), a slice tier3 (third-party/unverified).
      const isCompanyOwned = !docHit && f.tier === 2 && i % 4 === 0;
      const isThirdParty = !docHit && f.tier === 2 && i % 4 === 2;
      const tier2Sources = ["Company website", "Annual Report", "Investor Relations"];
      const tier3Sources = ["Wikipedia", "LinkedIn", "Crunchbase"];
      const source = docHit
        ? docHit.sourceName
        : (isThirdParty ? tier3Sources[i % tier3Sources.length]
          : isCompanyOwned ? tier2Sources[i % tier2Sources.length]
          : authSource);
      const sourceTier = docHit ? "document" : (isThirdParty ? "tier3" : isCompanyOwned ? "tier2" : "tier1");
      // For dropdown fields, pick the first configured option's label so the
      // mapping step downstream produces a real option.value. Falls back to
      // the test data table for free-text fields.
      let value = DUMMY_RESEARCH_VALUES[f.field];
      if (value === undefined) {
        if (f.inputType === "select" && Array.isArray(f.options) && f.options.length) {
          const first = f.options[0];
          value = (first && typeof first === "object")
            ? (first.label || first.value)
            : first;
        } else {
          value = "Sample " + f.label;
        }
      }
      return {
        field: f.field, label: f.label, value, source,
        sourceUrl: null,
        sourceTier,
        verificationStatus: getVerificationStatus(sourceTier),
        documentType: docHit ? docHit.docKey : null,
        fetchedAt: dummyTs,
        method: docHit ? "document_extract" : "web_search",
        confidence: sourceTier === "tier1" || sourceTier === "document" ? "high" : "low",
        trust: sourceTier === "tier1" || sourceTier === "document" ? "authoritative" : "secondary",
        wolfsberg: docHit && docHit.docKey === "wolfsberg",
      };
    });
    // Same dropdown-value coercion the live research path uses, so dummy and
    // live results render identically on Confirm and Fill Gaps.
    const found = enrichStakeholders(mapAIValuesToOptions(foundRaw, schema));

    const tagged = {
      companyName,
      jurisdiction: schema.region,
      countryOfRegistration: countryCode,
      found,
      gaps: schema.gapFields.map(f => ({ ...f, reason: "Not publicly available" })),
    };
    setResearch(tagged);
    setResearchTimestamp(dummyTs);

    // Demo coverage (Part 14). Gap recovery is skipped in demo mode.
    setCoverage({
      totalResearchFields: 35,
      populatedFields: 28,
      verifiedFields: 20,
      probableFields: 5,
      indicativeFields: 3,
      missingFieldCount: 7,
      missingFields: [],
      fillRate: 0.80,
      verifiedFillRate: 0.57,
    });
    setGapRecoveryRan(false);

    setFieldMetadata(found.map(item => ({
      fieldId: item.field, value: item.value,
      source: item.source, sourceUrl: null,
      sourceTier: item.sourceTier, verificationStatus: item.verificationStatus, documentType: item.documentType,
      fetchedAt: item.fetchedAt, method: item.method, confidence: item.confidence,
      customerAction: null, customerActionAt: null,
    })));

    const c = {};
    found.forEach((_, i) => { c[i] = true; });
    setChecks(c);
    setRejectedStakeholders({});
    setExpandedStakeholders({});
    // Demo mode: pre-check "publicly listed" so stakeholder EDD forms are hidden
    // on Fill Gaps automatically. The customer can uncheck it on Confirm.
    setIsPubliclyListedOverride(true);
    stakeholdersRef.current = {};
    setStakeholderVersion(v => v + 1);
    setStakeholderErrors([]);
    setRevealedTs({});
    gapRef.current = {};
    setFormVersion(v => v + 1);
    setLoading(false); setLoaderPhase(0);
    setStep(S.confirm);
  };

  // Continue handler from Documents step → triggers research with whatever
  // was uploaded (zero docs is fine; web search runs alone). In demo mode
  // we skip the API entirely and synthesise sample data.
  const proceedFromDocuments = () => {
    setError("");
    if (demoMode) { doDummyResearch("ai_documents"); return; }
    doResearch();
  };

  // Generic per-doc file handler. Clears the slot on null.
  const handleDocFile = (key) => (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const dt = DOC_TYPES.find(d => d.key === key);
    if (!dt) return;
    const accepted = dt.accept.split(",").map(s => s.trim());
    if (!accepted.includes(file.type)) {
      setError(`${dt.label}: file must be ${dt.accepts}.`);
      return;
    }
    if (file.size > 20 * 1024 * 1024) { setError(`${dt.label}: file must be 20MB or smaller.`); return; }
    setError("");
    setUploadedDocs(prev => ({ ...prev, [key]: file }));
  };
  const removeDocFile = (key) => () => setUploadedDocs(prev => ({ ...prev, [key]: null }));

  // Journey-screen Continue → routes per selected card.
  const proceedFromJourney = () => {
    if (!selectedJourneyCard) { setError("Please choose an option to continue."); return; }
    setError("");
    if (selectedJourneyCard === "A") {
      setJourneyType("ai_documents");
      setJourneyOpen(false);
      setManualOpened(false);
      // Demo: skip docs upload (no point uploading) and go straight to dummy.
      if (demoMode) { doDummyResearch("ai_documents"); return; }
      scrollAndSetStep(1); // documents step
    } else if (selectedJourneyCard === "B") {
      setJourneyType("ai_only");
      setJourneyOpen(false);
      setManualOpened(false);
      // STEPS in this branch is { input:0, research:1, ... }
      if (demoMode) { doDummyResearch("ai_only"); return; }
      doResearch("ai_only");
    } else if (selectedJourneyCard === "C") {
      setJourneyType("manual");
      window.open(manualFormUrl_, "_blank", "noopener,noreferrer");
      setManualOpened(true);
    }
  };

  // RFC4122 v4 UUID — uses crypto.randomUUID where available, falls back
  // to a Math.random()-based generator for older browsers.
  const genUUID = () => {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : ((r & 0x3) | 0x8);
      return v.toString(16);
    });
  };

  // Final submission: build the metadata + payload, log, advance to Done.
  const submitApplication = () => {
    const submittedAt = new Date().toISOString();
    setSubmitTs(submittedAt);

    // Append manual-input metadata for every gapRef entry that has a value.
    const manualEntries = [];
    Object.entries(gapRef.current).forEach(([fieldId, value]) => {
      if (value === undefined || value === null || String(value).trim() === "") return;
      const key = fieldId.startsWith("corrected_") ? fieldId.slice("corrected_".length) : fieldId;
      // Mark corrections distinctly so the trail shows the user's overwrite
      // alongside the original AI-found row.
      manualEntries.push({
        fieldId: key,
        value: String(value),
        source: "Customer input",
        sourceUrl: null,
        sourceTier: "manual",
        documentType: null,
        fetchedAt: submittedAt,
        method: "manual",
        confidence: "verified",
        customerAction: fieldId.startsWith("corrected_") ? "corrected" : "entered",
        customerActionAt: submittedAt,
      });
    });
    const finalMeta = [...fieldMetadata.filter(m => !manualEntries.some(e => e.fieldId === m.fieldId && e.customerAction === "corrected")), ...manualEntries];
    setFieldMetadata(finalMeta);

    // Build a flat fieldId → value map. For corrections, the manual value wins.
    const fieldValues = {};
    (research?.found || []).forEach((it, i) => {
      if (checks[i]) fieldValues[it.field] = it.value;
    });
    Object.entries(gapRef.current).forEach(([fieldId, value]) => {
      if (value === undefined || value === null || String(value).trim() === "") return;
      const key = fieldId.startsWith("corrected_") ? fieldId.slice("corrected_".length) : fieldId;
      fieldValues[key] = String(value);
    });

    // Build structured stakeholder payload from stakeholdersRef. Each
    // stakeholder field id maps to an array of person records with both
    // the AI-found provenance (source/sourceUrl/sourceTier/fetchedAt) and
    // the customer-completed compliance fields. Empty fields are kept so
    // the downstream consumer can see which gaps were left blank.
    const stakeholderPayload = {};
    (research?.found || []).forEach((result) => {
      if (!isStakeholderField(result.field)) return;
      const list = getStakeholders(result.field);
      if (!list || list.length === 0) return;
      stakeholderPayload[result.field] = list.map((s) => {
        const fullEddCollected = needsStakeholderDetails(s, result.field, effectivelyListed);
        return {
          id: s.id,
          full_name: s.full_name || "",
          role: s.role || "",
          share_percentage: s.share_percentage != null ? s.share_percentage : null,
          // Was the full enhanced-due-diligence form collected for this person?
          full_edd_collected: fullEddCollected,
          edd_skip_reason: fullEddCollected ? null : "publicly_listed_company",
          nationality: s.nationality || "",
          date_of_birth: s.date_of_birth || "",
          residential_country: s.residential_country || "",
          id_type: s.id_type || "",
          id_number: s.id_number || "",
          is_pep: s.is_pep,
          pep_details: s.pep_details || null,
          source: s.source || "",
          sourceUrl: s.sourceUrl || "",
          sourceTier: s.sourceTier || "",
          fetchedAt: s.fetchedAt || null,
          customer_confirmed: !s.customer_rejected,
          customer_added: !!s.customer_added,
          customer_rejected: !!s.customer_rejected,
          full_name_original: s.full_name_original || null,
        };
      });
    });

    const payload = {
      submissionId: genUUID(),
      submittedAt,
      company: {
        name: research?.companyName || companyName,
        countryCode,
        countryName: countryObj ? countryObj.name : countryCode,
        entityType,
        ownershipType,
        ownershipTypeLabel: ownershipTypeLabel(ownershipType),
        schemaJurisdiction: activeSchema?.region === "UK" ? "GB" : "SG",
      },
      journeyType,
      documentsUploaded: DOC_TYPES.filter(d => uploadedDocs[d.key]).map(d => d.key),
      researchTimestamp,
      fromCache: false,
      isPubliclyListed: effectivelyListed,
      listingDetectedFrom: effectivelyListed ? detectListingEvidence(research) : null,
      // Enhanced research pipeline: ownership-type strategy + coverage metrics.
      research: {
        ownershipType,
        ownershipTypeLabel: ownershipTypeLabel(ownershipType),
        researchStrategy: (OWNERSHIP_TYPE_LIBRARY.find(o => o.id === ownershipType) || {}).researchStrategy || null,
        gapRecoveryRan,
        coverage: coverage ? {
          totalResearchFields: coverage.totalResearchFields,
          populatedFields: coverage.populatedFields,
          verifiedFields: coverage.verifiedFields,
          probableFields: coverage.probableFields,
          indicativeFields: coverage.indicativeFields,
          missingFieldCount: coverage.missingFieldCount,
          fillRate: Math.round(coverage.fillRate * 100),
          verifiedFillRate: Math.round(coverage.verifiedFillRate * 100),
        } : null,
      },
      // DRS — document requirements collected at the dynamic documents step.
      documentRequirements: {
        submittedRequirements: drsSubmitted,
        flags: drsFlags,
      },
      fieldValues,
      fieldMetadata: finalMeta.map(m => ({
        ...m,
        verificationStatus: m.verificationStatus
          || (research?.found || []).find(r => r.field === m.fieldId)?.verificationStatus
          || "manual",
      })),
      stakeholders: stakeholderPayload,
      declaration: {
        ipAddress: device.ipAddress,
        userAgent: device.userAgent,
        platform: device.platform,
        timezone: device.timezone,
        timestamp: submittedAt,
        language: device.language,
        agreedAt: submittedAt,
        certifiedAt: submittedAt,
      },
    };
    // eslint-disable-next-line no-console
    console.log("APPLICATION_SUBMISSION", payload);
    setDone(true);
  };

  // Toggle a Confirm-page checkbox AND record the action in metadata.
  const toggleCheck = (idx) => {
    setChecks(prev => {
      const next = { ...prev, [idx]: !prev[idx] };
      const item = (research && research.found) ? research.found[idx] : null;
      if (item) {
        const action = next[idx] ? "accepted" : "rejected";
        const at = new Date().toISOString();
        setFieldMetadata(prevMeta => prevMeta.map(m =>
          m.fieldId === item.field ? { ...m, customerAction: action, customerActionAt: at } : m
        ));
      }
      return next;
    });
  };

  const card = { background: "rgba(255,255,255,0.95)", borderRadius: 14, border: "1px solid rgba(26,58,74,0.06)", boxShadow: "0 4px 20px rgba(26,58,74,0.05)", padding: "24px 28px", marginBottom: 16 };
  const Btn = ({ children, onClick, variant, disabled }) => {
    const base = { padding: "12px 26px", borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: disabled ? "not-allowed" : "pointer", fontFamily: "inherit", opacity: disabled ? 0.4 : 1, border: "none" };
    const v = { primary: { ...base, background: "#1a3a4a", color: "#fff" }, secondary: { ...base, background: "transparent", color: "#1a3a4a", border: "2px solid #1a3a4a" }, green: { ...base, background: "#4a9e8e", color: "#fff" } };
    return <button style={v[variant] || v.primary} onClick={disabled ? undefined : onClick}>{children}</button>;
  };

  // Friendly title for an admin-defined section key (e.g. "registered_address"
  // → "Registered Address", "uboAnalysis" → "UBO Analysis"). Used as a
  // fallback for sections that aren't in the hardcoded sectionConfig.
  const humaniseSection = (s) => {
    if (!s) return "Other";
    return String(s)
      .replace(/[_-]+/g, " ")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .trim();
  };

  const sectionConfig = {
    corrections: { title: "Corrections Required", icon: "🔄", sub: "You unchecked these fields — please provide correct values", twoCol: true },
    missing_research: { title: "Missing Research Fields", icon: "❓", sub: "We could not find these from any source — fill in if you have the data (all optional).", twoCol: true },
    applicant: { title: "Applicant Details", icon: "👤", sub: "Person authorised to submit this application", twoCol: true },
    business: { title: "Business Details", icon: "🏢", sub: "Confirm and complete business information", twoCol: true },
    business_entity: { title: "Business Entity", icon: "🏢", sub: "Registered identity and core business details", twoCol: true },
    registered_address: { title: "Registered Address", icon: "📍", sub: "Address from the official registry", twoCol: true },
    business_address: { title: "Business Address", icon: "📍", sub: "Operating address (if different from registered)", twoCol: true },
    business_activity: { title: "Business Activity", icon: "📊", sub: "Activity, size and operating profile", twoCol: true },
    operations: { title: "Operations", icon: "⚙", sub: "Branches, services and products", twoCol: true },
    ownership: { title: "Ownership & Control", icon: "👥", sub: "Directors, UBOs and corporate structure", twoCol: true },
    regulatory: { title: "Regulatory Details", icon: "🏛", sub: "Licensing and regulatory status", twoCol: true },
    nature: { title: "Nature & Size of Business", icon: "🏢", sub: "Business activity and size details", twoCol: true },
    fi: { title: "FI Specific Questions", icon: "🏦", sub: "Licensing, services, and customer profile", twoCol: false },
    stakeholders: { title: "Stakeholders & Transaction Mix", icon: "👥", sub: "Directors, UBOs, signatories and payment-mix breakdown", twoCol: true },
    disclosures: { title: "Corporate Disclosures", icon: "📋", sub: "Past regulatory or legal events", twoCol: false },
    account: { title: "Expected Account Usage", icon: "💰", sub: "Transaction volumes, purpose, and source of funds", twoCol: false },
    usage: { title: "Account Usage & Volumes", icon: "💰", sub: "Expected transaction volumes and counterparties", twoCol: true },
    bank: { title: "Bank Account Details", icon: "🏦", sub: "Settlement account for transactions", twoCol: true },
    documents: { title: "Additional Documents", icon: "📄", sub: "Upload supporting documentation", twoCol: false },
  };

  // Discover the section keys to render on Fill Gaps. Two-tier order:
  //   1. Pinned sections from sectionConfig (so well-known sections like
  //      Corrections / Missing Research / Applicant / Business / ... keep
  //      their canonical order at the top).
  //   2. Any *additional* sections present in the gap data (e.g. custom
  //      admin-defined sections like "Registered Address" / "Business
  //      Address" / anything else) appended in the order they first appear
  //      in the schema definitions, then by gap-item order.
  // This replaces the previous hardcoded list, which silently dropped any
  // section it didn't recognise.
  const gapSectionOrder = () => {
    const pinned = ["corrections", "missing_research", "applicant", "business", "business_address", "nature", "fi", "stakeholders", "disclosures", "account", "usage", "bank", "documents"];
    const seen = new Set();
    const out = [];
    const pinnedSet = new Set(pinned);
    pinned.forEach((s) => out.push(s));
    pinned.forEach((s) => seen.add(s));
    // Walk the schema in definition order so admin-defined sections show
    // up in the order the admin laid them out.
    if (activeSchema) {
      const walk = (arr) => (arr || []).forEach((f) => {
        const s = f.section;
        if (!s || pinnedSet.has(s) || seen.has(s)) return;
        seen.add(s);
        out.push(s);
      });
      walk(activeSchema.researchFields);
      walk(activeSchema.gapFields);
    }
    // Catch any leftover sections present in the live gap list but not in
    // the schema (e.g. fields the AI returned with an unfamiliar section).
    getCombinedGaps().forEach((g) => {
      const s = g.section;
      if (s && !seen.has(s)) { seen.add(s); out.push(s); }
    });
    return out;
  };

  const renderGapSection = (sectionKey) => {
    const items = getCombinedGaps()
      .filter(g => g.section === sectionKey)
      .filter(dependsOnSatisfied);
    if (items.length === 0) return null;
    const cfg = sectionConfig[sectionKey] || { title: humaniseSection(sectionKey), icon: "📋", sub: "", twoCol: true };

    return (
      <div style={card} key={sectionKey}>
        <h3 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 4px" }}>{cfg.icon} {cfg.title}</h3>
        <p style={{ fontSize: 12, color: "#1a3a4a60", margin: "0 0 14px" }}>{cfg.sub}</p>
        <div style={cfg.twoCol ? { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 14px" } : {}}>
          {items.map(g => <StableInput key={g.field} id={g.field} label={g.label} type={g.inputType} value={gapRef.current[g.field] || ""} onUpdate={updateGap} required={g.required} options={g.options} placeholder={g.placeholder || ("Enter " + g.label.toLowerCase())} />)}
        </div>
      </div>
    );
  };

  const jurisdictionBadge = activeSchema ? (() => {
    // Region drives only the colour; the label comes from the resolved
    // licence so tenants with non-UK/SG licences show the real jurisdiction.
    const flag = activeSchema.jurisdiction === "GB" ? "🇬🇧 "
      : activeSchema.jurisdiction === "SG" ? "🇸🇬 "
      : "";
    const text = activeSchema.label ? `${flag}${activeSchema.label}` : (activeSchema.region === "UK" ? "🇬🇧 UK Licence" : "🇸🇬 SG Licence");
    const bg = activeSchema.region === "UK" ? "#1a3a4a" : "#4a9e8e";
    return (
      <span style={{ display: "inline-block", padding: "3px 10px", borderRadius: 20, fontSize: 10, fontWeight: 700, letterSpacing: "0.05em", background: bg, color: "#fff", marginLeft: 8 }}>
        {text}
      </span>
    );
  })() : null;

  const entityBadge = entityType ? (
    <span style={{ display: "inline-block", padding: "3px 10px", borderRadius: 20, fontSize: 10, fontWeight: 700, letterSpacing: "0.05em", background: "#e0a040", color: "#fff", marginLeft: 8 }}>
      {entityType}
    </span>
  ) : null;

  // Lookup the metadata entry for a given fieldId — used by the "When?"
  // click-to-reveal badge so timestamps come from fieldMetadata, the
  // single source of truth.
  const metaFor = (fieldId) => fieldMetadata.find(m => m.fieldId === fieldId);

  // Source-tier visual treatment per row.
  // document → dark navy badge with the document type label
  // tier1    → green pill with the source name
  // tier2    → amber pill with "From an unverified source — please confirm"
  const renderSourceBadge = (item, idx) => {
    const m = metaFor(item.field);
    const ts = (m && m.fetchedAt) || researchTimestamp || "";
    const tsShort = ts ? ts.slice(11, 19) : "";
    if (item.sourceTier === "document") {
      const label = item.source || "Uploaded document";
      return (
        <span
          onClick={() => setRevealedTs(p => ({ ...p, [idx]: !p[idx] }))}
          title={revealedTs[idx] ? `🕒 ${ts}` : `From uploaded ${label}`}
          style={{ fontSize: 10, fontWeight: 700, color: "#fff", background: "#0B3D91", padding: "3px 8px", borderRadius: 4, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4, alignSelf: "start", whiteSpace: "nowrap" }}
        >
          {revealedTs[idx] ? `🕒 ${tsShort}` : `📄 ${label}`}
        </span>
      );
    }
    if (item.sourceTier === "tier1") {
      return (
        <span
          onClick={() => setRevealedTs(p => ({ ...p, [idx]: !p[idx] }))}
          title={revealedTs[idx] ? "Click to hide timestamp" : "Click to show fetch timestamp"}
          style={{ fontSize: 10, fontWeight: 700, color: "#1a6b56", background: "#dff2ec", padding: "3px 8px", borderRadius: 4, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4, alignSelf: "start", whiteSpace: "nowrap" }}
        >
          {revealedTs[idx] ? `🕒 ${ts}` : `✅ ${item.source}`}
        </span>
      );
    }
    // tier3 (indicative) — third-party / unverified source.
    if (item.sourceTier === "tier3") {
      return (
        <span
          onClick={() => setRevealedTs(p => ({ ...p, [idx]: !p[idx] }))}
          title={revealedTs[idx] ? "Click to hide timestamp" : "Low confidence — from unverified source"}
          style={{ fontSize: 10, fontWeight: 700, color: "#C2410C", background: "#FFF7ED", border: "1px solid #FED7AA", padding: "3px 8px", borderRadius: 4, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4, alignSelf: "start", whiteSpace: "nowrap" }}
        >
          {revealedTs[idx] ? `🕒 ${ts}` : `⚠ ${item.source}`}
        </span>
      );
    }
    // tier2 (probable) — company-owned source.
    return (
      <span
        onClick={() => setRevealedTs(p => ({ ...p, [idx]: !p[idx] }))}
        title={revealedTs[idx] ? "Click to hide timestamp" : "Probable — from company source, please confirm"}
        style={{ fontSize: 10, fontWeight: 700, color: "#8c5500", background: "#fff1d6", padding: "3px 8px", borderRadius: 4, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4, alignSelf: "start", whiteSpace: "nowrap" }}
      >
        {revealedTs[idx] ? `🕒 ${ts}` : `~ ${item.source}`}
      </span>
    );
  };

  // Render one row of the Confirm table — extracted so the section-grouped
  // and ungrouped paths share the same DOM.
  const renderFoundRow = ({ item, idx }, n) => {
    const fieldDef = findFieldDef(activeSchema, item.field);
    const displayValue = resolveDisplayValue(fieldDef, item.value);
    const isUnmappedDropdown =
      fieldDef && fieldDef.inputType === "select" && item.unmappedDropdown;
    return (
      <div key={item.field + idx} style={{ display: "grid", gridTemplateColumns: "30px 1fr 1.5fr 1fr", gap: 8, padding: "9px 10px", background: n % 2 === 0 ? "#fafcfb" : "#fff", borderBottom: "1px solid rgba(26,58,74,0.04)", opacity: checks[idx] ? 1 : 0.3 }}>
        <input type="checkbox" checked={!!checks[idx]} onChange={() => toggleCheck(idx)} style={{ width: 15, height: 15, cursor: "pointer", accentColor: "#4a9e8e" }} />
        <span style={{ fontSize: 11, fontWeight: 600 }}>{item.label}</span>
        <span style={{ fontSize: 11, wordBreak: "break-word" }}>
          {displayValue}
          {item.originalAIValue && item.originalAIValue !== displayValue && (
            <div style={{ marginTop: 4, fontSize: 10, color: "#1a3a4a90" }}>
              AI returned "{item.originalAIValue}" — mapped to dropdown option
            </div>
          )}
          {isUnmappedDropdown && (
            <div style={{ marginTop: 4, fontSize: 10, fontStyle: "italic", color: "#8c5500" }}>
              Doesn't match any dropdown option — please correct on the next page
            </div>
          )}
          {item.sourceTier === "tier2" && (
            <div style={{ marginTop: 4, fontSize: 10, fontStyle: "italic", color: "#8c5500" }}>
              From a company source — please confirm this is correct
            </div>
          )}
          {item.sourceTier === "tier3" && (
            <div style={{ marginTop: 4, fontSize: 10, fontStyle: "italic", color: "#C2410C" }}>
              ⚠ From unverified source — please verify this is correct
            </div>
          )}
        </span>
        {renderSourceBadge(item, idx)}
      </div>
    );
  };

  // Group rows by their schema-defined section so related fields (e.g.
  // Registered Address fields) appear together with a heading. Within each
  // section, rows preserve the caller's sort (typically: documents → tier1
  // → tier2, then schema field order). Returns an array of [section, rows]
  // pairs in the same order the sections appear in the schema, so the page
  // reads like the admin's schema layout.
  const groupFoundBySection = (items) => {
    const groups = new Map();
    items.forEach(({ item, idx }) => {
      const def = findFieldDef(activeSchema, item.field);
      const section = def?.section || item.section || "Other";
      if (!groups.has(section)) groups.set(section, []);
      groups.get(section).push({ item, idx });
    });
    // Order sections by their first appearance in the schema.
    const sectionOrder = new Map();
    let pos = 0;
    if (activeSchema) {
      [...(activeSchema.researchFields || []), ...(activeSchema.gapFields || [])].forEach((f) => {
        const s = f.section;
        if (s && !sectionOrder.has(s)) sectionOrder.set(s, pos++);
      });
    }
    return Array.from(groups.entries()).sort(([a], [b]) => {
      const oa = sectionOrder.has(a) ? sectionOrder.get(a) : 9999;
      const ob = sectionOrder.has(b) ? sectionOrder.get(b) : 9999;
      return oa - ob;
    });
  };

  // One unified table grouped by source tier, sorted within group by
  // schema research-field order — then wrapped into per-section blocks so
  // the customer sees a clear heading for each logical group (e.g.
  // Registered Address vs Business Address rather than interleaved rows).
  const renderUnifiedFoundTable = (items, title, subtitle) => {
    const groups = groupFoundBySection(items);
    return (
      <div style={card}>
        <h3 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 4px" }}>{title}</h3>
        <p style={{ fontSize: 11, color: "#1a3a4a70", margin: "0 0 12px" }}>{subtitle}</p>
        {groups.map(([section, rows], gi) => (
          <div key={section} style={{ marginBottom: gi < groups.length - 1 ? 14 : 0 }}>
            <div style={{
              fontSize: 11, fontWeight: 700, letterSpacing: "0.06em",
              textTransform: "uppercase", color: "#1a3a4a80",
              marginBottom: 6,
            }}>
              {humaniseSection(section)}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "30px 1fr 1.5fr 1fr", gap: 8, padding: "8px 10px", background: "#1a3a4a", borderRadius: "8px 8px 0 0" }}>
              {["✓", "FIELD", "VALUE", "SOURCE"].map(h => <span key={h} style={{ fontSize: 10, fontWeight: 700, color: "#fff" }}>{h}</span>)}
            </div>
            {rows.map((r, n) => renderFoundRow(r, n))}
          </div>
        ))}
      </div>
    );
  };

  // Stakeholder fields (directors / UBOs / shareholders / signatories) with
  // structured per-person data render as a card-per-person block instead of
  // a single grid row. Rendered as its own section above the unified table
  // so the row layout for everything else stays untouched. Items without a
  // populated stakeholders array fall through to the normal row renderer
  // for backward compatibility with legacy stored values.
  const renderStakeholderConfirmSection = (item, idx) => {
    if (!item || !Array.isArray(item.stakeholders) || item.stakeholders.length === 0) {
      return null;
    }
    // Exclude registry exemption notices — they are not people. If nothing real
    // remains, render nothing here so the field falls through to the normal
    // confirm row showing the raw registry value.
    const realStakeholders = item.stakeholders.filter((s) => !isRegistryExemptionNotice(s));
    if (realStakeholders.length === 0) return null;
    const ubo = isUboLikeField(item.field);
    const fieldDef = findFieldDef(activeSchema, item.field);
    const heading = fieldDef?.label
      || (ubo ? "Ultimate Beneficial Owners / Shareholders" : "Directors / Officers");
    const count = realStakeholders.length;
    const tier = item.sourceTier;
    const sourceBadge = tier === "tier1"
      ? { bg: "#dff2ec", color: "#1a6b56", glyph: "✅" }
      : tier === "document"
      ? { bg: "#0B3D91", color: "#fff", glyph: "📄" }
      : tier === "tier3"
      ? { bg: "#FFF7ED", color: "#C2410C", glyph: "⚠" }
      : { bg: "#fff1d6", color: "#8c5500", glyph: "~" };
    const allExpanded = realStakeholders.every((s) => isStakeholderExpanded(s.id));
    return (
      <div key={`stk-${item.field}-${idx}`} style={{ marginBottom: 14 }}>
        <div style={{
          fontSize: 11, fontWeight: 700, letterSpacing: "0.06em",
          textTransform: "uppercase", color: "#1a3a4a80",
          marginBottom: 8, paddingBottom: 6, borderBottom: "1px solid rgba(26,58,74,0.08)",
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap",
        }}>
          <span>{heading} · {count} found</span>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button
              type="button"
              onClick={() => setStakeholdersExpanded(realStakeholders.map((s) => s.id), !allExpanded)}
              style={{
                background: "none", border: "none", fontSize: 11, color: "#1a3a4a",
                fontWeight: 700, cursor: "pointer", fontFamily: "inherit", padding: 0,
                letterSpacing: "0.04em", textTransform: "uppercase",
              }}
            >
              {allExpanded ? "Collapse all ▴" : "Expand all ▾"}
            </button>
            <span style={{
              fontSize: 10, fontWeight: 700, color: sourceBadge.color,
              background: sourceBadge.bg, padding: "3px 8px", borderRadius: 4,
            }}>
              {sourceBadge.glyph} {item.source || (tier === "tier1" ? "Official source" : "Source")}
            </span>
          </div>
        </div>
        <p style={{ fontSize: 12, color: "#1a3a4a80", margin: "0 0 10px", lineHeight: 1.5 }}>
          Found {count} {count === 1 ? "person" : "people"} from {item.source || "research"}.
          Uncheck anyone whose name is wrong — you'll correct them on the next page. Nationality,
          date of birth and compliance details are collected on the next page for everyone kept here.
        </p>
        {realStakeholders.map((s) => {
          const rejected = isStakeholderRejected(item.field, s.id);
          const expanded = isStakeholderExpanded(s.id);
          return (
            <div
              key={s.id}
              style={{
                background: rejected ? "#fef2f2" : "#fafcfb",
                border: `1.5px solid ${rejected ? "#fecaca" : "rgba(26,58,74,0.08)"}`,
                borderRadius: 8, marginBottom: 8, overflow: "hidden",
                transition: "border-color .15s",
              }}
            >
              {/* Header row — click anywhere to expand/collapse */}
              <div
                onClick={() => toggleStakeholderExpanded(s.id)}
                style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "12px 16px", cursor: "pointer", userSelect: "none",
                }}
              >
                <input
                  type="checkbox"
                  checked={!rejected}
                  onChange={() => toggleStakeholderRejection(item.field, s.id)}
                  onClick={(e) => e.stopPropagation()}
                  style={{ width: 15, height: 15, flexShrink: 0, accentColor: "#4a9e8e", cursor: "pointer" }}
                  aria-label={`Confirm ${s.full_name}`}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{
                      fontSize: 14, fontWeight: 700,
                      color: rejected ? "#1a3a4a70" : "#1a3a4a",
                      textDecoration: rejected ? "line-through" : "none",
                    }}>
                      👤 {s.full_name}
                    </span>
                    {s.role && (
                      <span style={{
                        fontSize: 11, color: "#1a3a4a80", background: "#f2f1ed",
                        padding: "2px 8px", borderRadius: 99,
                        border: "1px solid rgba(26,58,74,0.08)",
                      }}>
                        {s.role}
                      </span>
                    )}
                    {s.share_percentage != null && (
                      <span style={{
                        fontSize: 11, color: "#1a6b56", background: "#dff2ec",
                        padding: "2px 8px", borderRadius: 99,
                        border: "1px solid rgba(74,158,142,0.3)",
                      }}>
                        {s.share_percentage}%
                      </span>
                    )}
                  </div>
                  {!expanded && (
                    <div style={{ fontSize: 11, color: "#1a3a4a70", marginTop: 3 }}>
                      {rejected ? "⚠ Marked as incorrect — tap to review" : "✓ Verified · tap to expand"}
                    </div>
                  )}
                </div>
                {rejected && (
                  <span style={{
                    fontSize: 10, fontWeight: 700, color: "#dc2626", background: "#fef2f2",
                    border: "1px solid #fecaca", borderRadius: 99,
                    padding: "2px 8px", flexShrink: 0,
                  }}>
                    ✗ Incorrect
                  </span>
                )}
                <span style={{
                  fontSize: 14, color: "#1a3a4a70", flexShrink: 0,
                  transition: "transform 0.2s", display: "inline-block",
                  transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
                }}>
                  ▾
                </span>
              </div>

              {/* Expandable body */}
              {expanded && (
                <div style={{
                  padding: "12px 16px 14px",
                  borderTop: "1px solid rgba(26,58,74,0.08)",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                    <span style={{
                      fontSize: 10, fontWeight: 700, color: sourceBadge.color,
                      background: sourceBadge.bg, padding: "3px 8px", borderRadius: 4,
                    }}>
                      {sourceBadge.glyph} {item.source || (tier === "tier1" ? "Official source" : "Source")}
                    </span>
                    {(s.fetchedAt || item.fetchedAt) && (
                      <span
                        style={{ fontSize: 11, color: "#1a3a4a70", cursor: "default" }}
                        title={`Fetched: ${s.fetchedAt || item.fetchedAt}`}
                      >
                        🕐 When?
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: "#1a3a4a70", fontStyle: "italic" }}>
                    Nationality, date of birth and compliance details to be completed on the next page
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  // ── Per-person stakeholder forms on Fill Gaps ────────────────────────
  // Each accepted/rejected/customer-added person renders as an accordion
  // card with name, role, nationality, DOB, residential country, ID type
  // & number, and PEP toggle + details. Reads/writes through the
  // stakeholdersRef helpers — explicit re-render on every change so
  // completion badges and the conditional PEP-details textarea stay
  // synced with the underlying data.

  const stakeholderLabelStyle = {
    display: "block", fontSize: 12, fontWeight: 600,
    color: "#1a3a4a", marginBottom: 5,
  };

  const stakeholderLockedStyle = {
    padding: "10px 14px", background: "#f2f1ed", borderRadius: 8,
    border: "1.5px solid rgba(26,58,74,0.14)", fontSize: 14,
    color: "#1a3a4a80", display: "flex", alignItems: "center",
    justifyContent: "space-between",
  };

  const stakeholderRequiredKeys = (s) => {
    const keys = ["full_name", "nationality", "date_of_birth", "is_pep"];
    if (s && s.is_pep === true) keys.push("pep_details");
    return keys;
  };

  const stakeholderMissingFields = (s) => {
    return stakeholderRequiredKeys(s).filter((k) => {
      if (k === "is_pep") return s.is_pep === null || s.is_pep === undefined;
      const v = s[k];
      return v == null || String(v).trim() === "";
    });
  };

  const renderStakeholderCard = (fieldId, stakeholder, index) => {
    const ubo = isUboLikeField(fieldId);
    const isRejected = !!stakeholder.customer_rejected;
    const isAdded = !!stakeholder.customer_added;
    const isAIFound = !isRejected && !isAdded;
    const missing = stakeholderMissingFields(stakeholder);
    const isComplete = missing.length === 0;

    const nameLocked = isAIFound;
    const roleLocked = isAIFound && stakeholder.role;

    return (
      <div
        key={stakeholder.id}
        style={{
          borderRadius: 10,
          border: `1.5px solid ${isComplete ? "#4a9e8e" : isRejected ? "#fecaca" : "rgba(26,58,74,0.14)"}`,
          background: isRejected ? "#fef9f9" : "#fff",
          marginBottom: 12, overflow: "hidden",
        }}
      >
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "12px 16px", background: "#fafcfb",
          borderBottom: "1px solid rgba(26,58,74,0.08)", gap: 8, flexWrap: "wrap",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <span style={{ fontSize: 18 }}>👤</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#1a3a4a" }}>
                {stakeholder.full_name || `Person ${index + 1}`}
              </div>
              {(stakeholder.role || stakeholder.share_percentage != null) && (
                <div style={{ fontSize: 11, color: "#1a3a4a80", marginTop: 2 }}>
                  {stakeholder.role || ""}
                  {stakeholder.role && stakeholder.share_percentage != null ? " · " : ""}
                  {stakeholder.share_percentage != null ? `${stakeholder.share_percentage}%` : ""}
                </div>
              )}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{
              fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 99,
              background: isComplete ? "#dff2ec" : "#fff8ed",
              color: isComplete ? "#1a6b56" : "#8c5500",
              border: `1px solid ${isComplete ? "#4a9e8e" : "#e0a040"}40`,
            }}>
              {isComplete
                ? "✅ Complete"
                : `⚠ ${missing.length} field${missing.length > 1 ? "s" : ""} needed`}
            </span>
            {isAIFound && stakeholder.source && (
              <span style={{
                fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 4,
                background: "#dff2ec", color: "#1a6b56",
              }}>
                ✓ {stakeholder.source}
              </span>
            )}
            {isRejected && (
              <span style={{
                fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 4,
                background: "#fef2f2", color: "#dc2626", border: "1px solid #fecaca",
              }}>
                Correction needed
              </span>
            )}
            {(isAdded || isRejected) && (
              <button
                type="button"
                onClick={() => removeStakeholder(fieldId, stakeholder.id)}
                style={{
                  background: "none", border: "none", color: "#1a3a4a70",
                  cursor: "pointer", fontSize: 22, lineHeight: 1, padding: "0 4px",
                  fontFamily: "inherit",
                }}
                title="Remove this person"
                aria-label="Remove"
              >
                ×
              </button>
            )}
          </div>
        </div>

        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 0 }}>
          {/* Name */}
          {nameLocked ? (
            <div style={{ marginBottom: 14 }}>
              <label style={stakeholderLabelStyle}>Full Legal Name <span style={{ color: "#d44" }}>*</span></label>
              <div style={stakeholderLockedStyle}>
                <span>{stakeholder.full_name}</span>
                <span style={{ fontSize: 10, fontWeight: 700, color: "#1a6b56" }}>✓ Verified</span>
              </div>
            </div>
          ) : (
            <>
              {isRejected && stakeholder.full_name_original && (
                <p style={{ fontSize: 11, color: "#1a3a4a80", fontStyle: "italic", margin: "0 0 4px" }}>
                  AI found: "{stakeholder.full_name_original}" — please enter the correct name
                </p>
              )}
              <StableInput
                id={`stk_${fieldId}_${stakeholder.id}_full_name`}
                label={`Full Legal Name`}
                type="text"
                value={stakeholder.full_name || ""}
                onUpdate={(_, v) => updateStakeholderField(fieldId, stakeholder.id, "full_name", v)}
                required
                placeholder="Full legal name"
              />
            </>
          )}

          {/* Role */}
          {roleLocked ? (
            <div style={{ marginBottom: 14 }}>
              <label style={stakeholderLabelStyle}>Role / Position</label>
              <div style={stakeholderLockedStyle}>
                <span>{stakeholder.role}</span>
                <span style={{ fontSize: 10, fontWeight: 700, color: "#1a6b56" }}>✓ Verified</span>
              </div>
            </div>
          ) : (
            <StableInput
              id={`stk_${fieldId}_${stakeholder.id}_role`}
              label="Role / Position"
              type="text"
              value={stakeholder.role || ""}
              onUpdate={(_, v) => updateStakeholderField(fieldId, stakeholder.id, "role", v)}
              placeholder={ubo ? "e.g. Shareholder, UBO" : "e.g. CEO, Director, CFO"}
            />
          )}

          {/* Nationality — pre-filled & locked (editable) when the AI found it */}
          <PrePopulatedField
            id={`stk_${fieldId}_${stakeholder.id}_nationality`}
            label="Nationality"
            type="text"
            value={stakeholder.nationality || ""}
            onUpdate={(_, v) => updateStakeholderField(fieldId, stakeholder.id, "nationality", v)}
            sourceLabel={stakeholder.source}
            required
            placeholder="e.g. British, American, Singaporean"
          />

          {/* Date of birth — pre-filled & locked (editable) when the AI found it */}
          <PrePopulatedField
            id={`stk_${fieldId}_${stakeholder.id}_dob`}
            label="Date of Birth"
            type="date"
            value={stakeholder.date_of_birth || ""}
            displayValue={formatDOBForDisplay(stakeholder.date_of_birth)}
            onUpdate={(_, v) => updateStakeholderField(fieldId, stakeholder.id, "date_of_birth", v)}
            sourceLabel={stakeholder.source}
            required
            placeholder="YYYY-MM-DD"
          />

          {/* Residential country */}
          <StableInput
            id={`stk_${fieldId}_${stakeholder.id}_country`}
            label="Country of Residence"
            type="select"
            value={stakeholder.residential_country || ""}
            onUpdate={(_, v) => updateStakeholderField(fieldId, stakeholder.id, "residential_country", v)}
            options={COUNTRIES.map((c) => ({ value: c.name, label: c.name }))}
          />

          {/* ID type */}
          <StableInput
            id={`stk_${fieldId}_${stakeholder.id}_id_type`}
            label="Identity Document Type"
            type="select"
            value={stakeholder.id_type || ""}
            onUpdate={(_, v) => updateStakeholderField(fieldId, stakeholder.id, "id_type", v)}
            options={[
              { value: "passport", label: "Passport" },
              { value: "national_id", label: "National ID Card" },
              { value: "driving_licence", label: "Driving Licence" },
              { value: "other", label: "Other" },
            ]}
          />

          {/* ID number */}
          <StableInput
            id={`stk_${fieldId}_${stakeholder.id}_id_number`}
            label="Identity Document Number"
            type="text"
            value={stakeholder.id_number || ""}
            onUpdate={(_, v) => updateStakeholderField(fieldId, stakeholder.id, "id_number", v)}
            placeholder="Passport or ID number"
          />

          {/* PEP three-button toggle */}
          <div style={{ marginBottom: 14 }}>
            <label style={stakeholderLabelStyle}>
              Politically Exposed Person (PEP)? <span style={{ color: "#d44" }}>*</span>
            </label>
            <p style={{ fontSize: 11, color: "#1a3a4a80", lineHeight: 1.4, margin: "0 0 8px" }}>
              A PEP holds or has held a prominent public function, or is closely associated with someone who does.
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              {[
                { val: false, label: "No", c: "#4a9e8e", bg: "#dff2ec" },
                { val: true, label: "Yes", c: "#dc2626", bg: "#fef2f2" },
                { val: null, label: "Not Sure", c: "#1a3a4a", bg: "#e0e8f4" },
              ].map((opt) => {
                const selected = stakeholder.is_pep === opt.val;
                return (
                  <button
                    key={String(opt.val)}
                    type="button"
                    onClick={() => updateStakeholderField(fieldId, stakeholder.id, "is_pep", opt.val)}
                    style={{
                      flex: 1, padding: "10px 0", borderRadius: 8,
                      border: `1.5px solid ${selected ? opt.c : "rgba(26,58,74,0.14)"}`,
                      background: selected ? opt.bg : "transparent",
                      color: selected ? opt.c : "#1a3a4a80",
                      fontWeight: selected ? 700 : 500, fontSize: 13,
                      fontFamily: "inherit", cursor: "pointer", transition: "all .15s",
                    }}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Conditional PEP details */}
          {stakeholder.is_pep === true && (
            <StableInput
              id={`stk_${fieldId}_${stakeholder.id}_pep_details`}
              label="PEP Details"
              type="textarea"
              value={stakeholder.pep_details || ""}
              onUpdate={(_, v) => updateStakeholderField(fieldId, stakeholder.id, "pep_details", v)}
              required
              placeholder="Please describe the political position, function, or connection"
            />
          )}
        </div>
      </div>
    );
  };

  // Read-only green summary shown for a listed company's stakeholders that
  // don't require enhanced due diligence (directors/officers, and UBOs < 25%).
  // `field` is the research row; `isPartial` renders it as a subsection above
  // the >= 25% UBO forms.
  const renderListedCompanyStakeholderSummary = (field, stakeholders, isPartial = false) => {
    const ubo = isUboLikeField(field.field);
    const fieldLabel = ubo ? "Beneficial Owners / Shareholders" : "Directors / Officers";
    const lower = fieldLabel.toLowerCase();
    return (
      <div style={{
        borderRadius: 10,
        border: "1px solid #4a9e8e",
        background: "#f3faf8",
        overflow: "hidden",
        marginBottom: isPartial ? 16 : 0,
      }}>
        <div style={{
          padding: "12px 16px",
          borderBottom: "1px solid #cfe9e1",
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <span style={{ fontSize: 16 }}>✅</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#1a6b56" }}>
                {isPartial ? `Other ${fieldLabel}` : fieldLabel}
              </div>
              <div style={{ fontSize: 12, color: "#1a6b56", opacity: 0.8, marginTop: 2 }}>
                Publicly listed company — verified from official sources. No additional details required.
              </div>
            </div>
          </div>
          <span style={{
            fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 99,
            background: "#4a9e8e", color: "#fff", whiteSpace: "nowrap",
          }}>
            🏛 Listed Company
          </span>
        </div>

        <div style={{ padding: "12px 16px" }}>
          {stakeholders.length === 0 ? (
            <p style={{ fontSize: 13, color: "#1a6b56", fontStyle: "italic", margin: 0 }}>
              No {lower} found in public records.
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {stakeholders.map((s) => (
                <div key={s.id} style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "8px 12px", background: "rgba(255,255,255,0.6)",
                  borderRadius: 8, border: "1px solid #cfe9e1",
                }}>
                  <span style={{ fontSize: 16 }}>👤</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "#1a3a4a" }}>{s.full_name}</div>
                    <div style={{ fontSize: 12, color: "#1a3a4a80", marginTop: 2 }}>
                      {[s.role, s.share_percentage != null ? `${s.share_percentage}% shareholding` : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 600, color: "#1a6b56", whiteSpace: "nowrap" }}>
                    ✓ Verified
                  </span>
                </div>
              ))}
            </div>
          )}

          <p style={{ fontSize: 12, color: "#1a6b56", marginTop: 12, marginBottom: 0, lineHeight: 1.5, fontStyle: "italic" }}>
            As a publicly listed company, {lower} information is publicly disclosed through regulatory
            filings. Enhanced due diligence details (nationality, date of birth, PEP status) are not
            required for listed company {lower}.
          </p>
        </div>
      </div>
    );
  };

  // ── Fill Gaps stakeholder rendering, split in two ───────────────────────
  // renderStakeholderForms  → only people who need customer input (rendered
  //   in the "additional details needed" section, near the other gap inputs).
  // renderStakeholderSummary → read-only confirmed info / "no action required"
  //   (rendered in the "verified — for reference" section at the bottom).
  // Both return null when they have nothing to show, so the caller can hide
  // the section divider when a field contributes no content.

  const renderStakeholderForms = (researchItem) => {
    const fieldId = researchItem.field;
    const ubo = isUboLikeField(fieldId);
    const personLabel = ubo ? "beneficial owner" : "director";
    const fieldDef = findFieldDef(activeSchema, fieldId);
    const heading = fieldDef?.label || (ubo ? "Beneficial Owners / Shareholders" : "Directors / Officers");
    const list = getStakeholders(fieldId);

    // Drop registry exemption notices — never real people / EDD forms.
    const validStakeholders = list.filter((s) => !isRegistryExemptionNotice(s));
    const needingDetails = validStakeholders.filter((s) => needsStakeholderDetails(s, fieldId, effectivelyListed));

    // Private company with no real people found yet: prompt to add one. This is
    // a customer action, so it belongs in the forms section.
    if (!effectivelyListed && validStakeholders.length === 0) {
      return (
        <div key={`stk-forms-${fieldId}`} style={card}>
          <h3 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 4px" }}>👥 {heading}</h3>
          <div style={{
            margin: "0 0 14px", padding: "10px 14px", borderRadius: 8,
            background: "#fff8ed", border: "1px solid #e0a040",
            fontSize: 12, color: "#8c5500",
          }}>
            No {personLabel}s were found automatically. Please add at least one {personLabel} below.
          </div>
          <button
            type="button"
            onClick={() => addStakeholder(fieldId)}
            style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
              padding: "10px 18px", background: "transparent", color: "#1a3a4a",
              border: "1.5px dashed #4a9e8e", borderRadius: 8,
              fontSize: 13, fontWeight: 600, fontFamily: "inherit",
              cursor: "pointer", width: "100%",
            }}
          >
            + Add {personLabel}
          </button>
        </div>
      );
    }

    // Nobody needs input → nothing in the forms section (summary handles the
    // read-only reference at the bottom of the page).
    if (needingDetails.length === 0) return null;

    return (
      <div key={`stk-forms-${fieldId}`} style={card}>
        <h3 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 4px" }}>👥 {heading}</h3>
        {effectivelyListed ? (
          <div style={{
            padding: "12px 16px", background: "#fff8ed", border: "1px solid #e0a040",
            borderRadius: 8, fontSize: 13, color: "#8c5500",
            marginBottom: 16, display: "flex", gap: 8,
          }}>
            <span>⚠</span>
            <span>
              Although this is a listed company, the following beneficial owner
              {needingDetails.length > 1 ? "s hold" : " holds"} 25% or more of shares and requires
              enhanced due diligence details.
            </span>
          </div>
        ) : (
          <p style={{ fontSize: 12, color: "#1a3a4a80", margin: "0 0 14px", lineHeight: 1.5 }}>
            Complete the required details for each {personLabel} below. Names and roles marked
            "Verified" came from the research on the previous page; everything else needs your input.
          </p>
        )}
        {needingDetails.map((s, i) => renderStakeholderCard(fieldId, s, i))}
        {!effectivelyListed && (
          <button
            type="button"
            onClick={() => addStakeholder(fieldId)}
            style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
              marginTop: 4, padding: "10px 18px",
              background: "transparent", color: "#1a3a4a",
              border: "1.5px dashed #4a9e8e", borderRadius: 8,
              fontSize: 13, fontWeight: 600, fontFamily: "inherit",
              cursor: "pointer", width: "100%",
            }}
          >
            + Add another {personLabel}
          </button>
        )}
      </div>
    );
  };

  const renderStakeholderSummary = (researchItem) => {
    const fieldId = researchItem.field;
    const ubo = isUboLikeField(fieldId);
    const fieldDef = findFieldDef(activeSchema, fieldId);
    const heading = fieldDef?.label || (ubo ? "Beneficial Owners / Shareholders" : "Directors / Officers");
    const list = getStakeholders(fieldId);
    const validStakeholders = list.filter((s) => !isRegistryExemptionNotice(s));
    const confirmedOnly = validStakeholders.filter((s) => !needsStakeholderDetails(s, fieldId, effectivelyListed));

    // Listed company with no real owners (e.g. PSC-exempt — only an exemption
    // notice): clean "No action required" reference card.
    if (validStakeholders.length === 0 && effectivelyListed) {
      return (
        <div key={`stk-summary-${fieldId}`} style={card}>
          <h3 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 12px" }}>👥 {heading}</h3>
          <div style={{
            padding: "14px 16px", background: "#f3faf8", border: "1px solid #4a9e8e",
            borderRadius: 10, display: "flex", alignItems: "center", gap: 10,
          }}>
            <span style={{ fontSize: 18 }}>✅</span>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#1a6b56" }}>
                {heading} — No action required
              </div>
              <div style={{ fontSize: 12, color: "#1a6b56", opacity: 0.8, marginTop: 2 }}>
                This is a publicly listed company. Ownership information is publicly disclosed through
                regulatory filings. No additional details required.
              </div>
            </div>
          </div>
        </div>
      );
    }

    // Nothing read-only to show (e.g. a private company — everyone is in the
    // forms section above, so no duplicate rendering here).
    if (confirmedOnly.length === 0) return null;

    return (
      <div key={`stk-summary-${fieldId}`} style={card}>
        <h3 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 12px" }}>👥 {heading}</h3>
        {renderListedCompanyStakeholderSummary(researchItem, confirmedOnly, false)}
      </div>
    );
  };

  const validateStakeholders = () => {
    const errors = [];
    (research?.found || []).forEach((result) => {
      if (!isStakeholderField(result.field)) return;
      if (!Array.isArray(result.stakeholders) || result.stakeholders.length === 0) return;
      const list = getStakeholders(result.field);
      // Registry exemption notices are not people — never validate them.
      const validStakeholders = list.filter((s) => !isRegistryExemptionNotice(s));
      const ubo = isUboLikeField(result.field);
      const personLabel = ubo ? "beneficial owner" : "director";

      // Only validate stakeholders that still need the full gap form. For a
      // listed company that's the >= 25% UBOs; for a private company it's
      // everyone (so behaviour is unchanged).
      const toValidate = validStakeholders.filter((s) => needsStakeholderDetails(s, result.field, effectivelyListed));

      // Listed company where no one needs details — nothing to validate.
      if (effectivelyListed && toValidate.length === 0) return;

      if (validStakeholders.length === 0) {
        errors.push(`Please add at least one ${personLabel}.`);
        return;
      }
      toValidate.forEach((s, idx) => {
        const display = (s.full_name && s.full_name.trim()) || `Person ${idx + 1}`;
        const missing = stakeholderMissingFields(s);
        missing.forEach((k) => {
          if (k === "full_name") errors.push(`Please enter the full name for person ${idx + 1}.`);
          else if (k === "nationality") errors.push(`Please enter nationality for ${display}.`);
          else if (k === "date_of_birth") errors.push(`Please enter date of birth for ${display}.`);
          else if (k === "is_pep") errors.push(`Please answer the PEP question for ${display}.`);
          else if (k === "pep_details") errors.push(`Please provide PEP details for ${display}.`);
        });
      });
    });
    return errors;
  };

  // Sort key per spec: documents first, tier1 next, tier2 last; within group
  // by the schema researchFields order.
  const sourceTierRank = { document: 0, tier1: 1, tier2: 2, tier3: 3 };
  const fieldOrderMap = activeSchema ? new Map(activeSchema.researchFields.map((f, i) => [f.field, i])) : new Map();
  const sortedFound = (research?.found || [])
    .map((item, idx) => ({ item, idx }))
    .sort((a, b) => {
      const ra = sourceTierRank[a.item.sourceTier] ?? 99;
      const rb = sourceTierRank[b.item.sourceTier] ?? 99;
      if (ra !== rb) return ra - rb;
      const fa = fieldOrderMap.has(a.item.field) ? fieldOrderMap.get(a.item.field) : 999;
      const fb = fieldOrderMap.has(b.item.field) ? fieldOrderMap.get(b.item.field) : 999;
      return fa - fb;
    });

  // Split out stakeholder items with real people so they render as cards above
  // the regular pre-filled table. A field whose only entries are registry
  // exemption notices has no real people, so it stays in the regular flow as a
  // normal row (showing the raw registry value).
  const hasRealStakeholders = (item) =>
    isStakeholderField(item.field) &&
    Array.isArray(item.stakeholders) &&
    item.stakeholders.some((s) => !isRegistryExemptionNotice(s));
  const stakeholderFound = sortedFound.filter(({ item }) => hasRealStakeholders(item));
  const regularFound = sortedFound.filter(({ item }) => !hasRealStakeholders(item));

  // Fill Gaps stakeholder rendering, split into two sections. Forms (input
  // needed) render with the other gap inputs; summaries (read-only) render at
  // the bottom for reference. Render functions return null when empty, so the
  // section dividers below only appear when there's actual content.
  const stakeholderGapRows = (research?.found || []).filter((r) => {
    if (!isStakeholderField(r.field) || !Array.isArray(r.stakeholders)) return false;
    if (r.stakeholders.some((s) => !isRegistryExemptionNotice(s))) return true;
    // Listed company whose only "owners" were exemption notices (filtered out
    // of .stakeholders): still surface the "no action required" summary.
    return effectivelyListed && typeof r.value === "string" && r.value.trim().length > 0;
  });
  const stakeholderFormNodes = stakeholderGapRows.map((r) => renderStakeholderForms(r)).filter(Boolean);
  const stakeholderSummaryNodes = stakeholderGapRows.map((r) => renderStakeholderSummary(r)).filter(Boolean);
  const hasStakeholderForms = stakeholderFormNodes.length > 0;
  const hasStakeholderSummary = stakeholderSummaryNodes.length > 0;

  const docCount = (research?.found || []).filter(i => i.sourceTier === "document").length;
  const tier1Count = (research?.found || []).filter(i => i.sourceTier === "tier1").length;
  const tier2Count = (research?.found || []).filter(i => i.sourceTier === "tier2").length;
  const tier3Count = (research?.found || []).filter(i => i.sourceTier === "tier3").length;

  // Resolved values from tenant config with safe fallbacks. Keep these on the
  // happy path (after configLoading guard) so any null deref is contained.
  const companyName_ = tenantConfig?.company?.name || "Nium";
  const companyLogo_ = tenantConfig?.company?.logo || null;
  const manualFormUrl_ = tenantConfig?.company?.manualFormUrl || MANUAL_FORM_URL;
  const activeEntityTypes = (tenantConfig?.entityTypes || [])
    .filter(e => e.active !== false)
    .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));

  if (configLoading) {
    return (
      <div style={{
        minHeight: "100vh",
        background: "linear-gradient(170deg, #f4f8f7 0%, #eaeff4 50%, #f7f4f0 100%)",
        fontFamily: "'DM Sans','Segoe UI',system-ui,sans-serif",
        color: "#1a3a4a",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <div style={{ textAlign: "center" }}>
          <div style={{
            width: 48, height: 48, border: "3px solid rgba(74,158,142,0.2)",
            borderTopColor: "#4a9e8e", borderRadius: "50%", margin: "0 auto 14px",
            animation: "kspin 0.9s linear infinite",
          }} />
          <div style={{ fontSize: 14, fontWeight: 600 }}>Loading configuration…</div>
          <style>{`@keyframes kspin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(170deg, #f4f8f7 0%, #eaeff4 50%, #f7f4f0 100%)", fontFamily: "'DM Sans','Segoe UI',system-ui,sans-serif", color: "#1a3a4a" }}>
      {inPreview && (
        <PreviewBanner
          missing={previewMissing}
          timestamp={previewTimestamp}
        />
      )}
      {demoMode && <DemoBanner offsetTop={inPreview ? 40 : 0} />}
      <div style={{ maxWidth: 780, margin: "0 auto", padding: `${(inPreview ? 40 : 0) + (demoMode ? 32 : 0) + 24}px 16px 60px` }}>

        <div style={{ textAlign: "center", marginBottom: 8 }}>
          {companyLogo_ ? (
            <img
              src={companyLogo_}
              alt={companyName_ || ""}
              style={{ height: 32, maxWidth: 140, objectFit: "contain", display: "block", margin: "0 auto 6px" }}
            />
          ) : (
            <div style={{
              width: 36, height: 36, borderRadius: 9, margin: "0 auto 6px",
              background: "linear-gradient(135deg,#1a3a4a,#4a9e8e)",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "#fff", fontSize: 18, fontWeight: 800,
            }}>
              {(companyName_ || "N").trim().charAt(0).toUpperCase()}
            </div>
          )}
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase", color: "#4a9e8e", marginBottom: 4 }}>{companyName_} Compliance</div>
          <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>KYC Onboarding Agent</h1>
          <p style={{ fontSize: 12, color: "#1a3a4a80", margin: "4px 0 0" }}>AI-powered multi-jurisdiction company research and data collection</p>
        </div>

        <div style={{ display: "flex", justifyContent: "center", gap: 6, marginBottom: 24, flexWrap: "wrap" }}>
          {stepNames.map((s, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 28, height: 28, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, background: i < step ? "#4a9e8e" : i === step ? "#1a3a4a" : "#e0e4e8", color: i <= step ? "#fff" : "#999", boxShadow: i === step ? "0 0 0 3px rgba(74,158,142,0.2)" : "none" }}>{i + 1}</div>
              <span style={{ fontSize: 11, fontWeight: i === step ? 700 : 400, color: i <= step ? "#1a3a4a" : "#aaa" }}>{s}</span>
              {i < stepNames.length - 1 && <div style={{ width: 14, height: 2, background: i < step ? "#4a9e8e" : "#e0e4e8" }} />}
            </div>
          ))}
        </div>

        {step === STEPS.input && !journeyOpen && (
          <div style={card}>
            <h2 style={{ fontSize: 17, fontWeight: 700, margin: "0 0 4px" }}>Company Lookup</h2>
            <p style={{ fontSize: 13, color: "#1a3a4a70", margin: "0 0 20px" }}>Enter the company name and country. The agent will use <strong>jurisdiction-specific requirements</strong> (UK or SG/default) to drive the research and gap collection.</p>
            <StableInput id="companyName" label="Company Legal Name" type="text" value={companyName} onUpdate={(_, v) => setCompanyName(v)} required placeholder="e.g. Tesco PLC, DBS Group Holdings" />
            <div style={{ marginBottom: 14 }}>
              <label htmlFor="entity-type" style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#1a3a4a", marginBottom: 5 }}>Entity Type <span style={{ color: "#d44" }}>*</span></label>
              <SearchableSelect
                id="entity-type"
                value={entityType}
                onChange={(v) => { setEntityType(v); setOwnershipType(""); }}
                placeholder="Select or type entity type…"
                options={activeEntityTypes.map(e => ({
                  value: e.id,
                  label: `${e.icon ? e.icon + " " : ""}${e.label || e.id}`,
                  description: e.description || undefined,
                }))}
              />
            </div>
            {entityType && (
              <div style={{ marginBottom: 14 }}>
                <label htmlFor="ownership-type" style={{ display: "block", fontSize: 12, fontWeight: 600, color: C.text, marginBottom: 5 }}>
                  Ownership Type <span style={{ color: C.error }}>*</span>
                </label>
                <p style={{ fontSize: 12, color: C.textMuted, marginBottom: 8, lineHeight: 1.4 }}>
                  How is this company owned and structured?
                </p>
                <SearchableSelect
                  id="ownership-type"
                  value={ownershipType}
                  onChange={setOwnershipType}
                  placeholder="Select ownership type…"
                  options={getOwnershipTypeOptions(entityType, tenantConfig)}
                />
              </div>
            )}
            <div style={{ marginBottom: 14 }}>
              <label htmlFor="country-reg" style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#1a3a4a", marginBottom: 5 }}>Registered Country <span style={{ color: "#d44" }}>*</span></label>
              <SearchableSelect
                id="country-reg"
                value={countryCode}
                onChange={setCountryCode}
                placeholder="Select or type country…"
                options={COUNTRIES.map(c => ({ value: c.code, label: `${c.code} — ${c.name}` }))}
              />
            </div>
            {countryCode && (() => {
              // Resolve the licence from the tenant's configured licences,
              // not the hardcoded UK/SG fallback. If tenantConfig is missing
              // (offline fallback) fall back to the old hardcoded helper.
              const resolved = tenantConfig ? pickLicence(countryCode, tenantConfig) : null;
              const primary = tenantConfig ? (tenantConfig.licences || []).find(l => l.isPrimary) || (tenantConfig.licences || [])[0] : null;
              const isLicensedHere = !!resolved && Array.isArray(resolved.countriesCovered) && resolved.countriesCovered.includes(countryCode);
              const licenceLabel = resolved
                ? `${resolved.jurisdictionCode === "GB" ? "🇬🇧 " : resolved.jurisdictionCode === "SG" ? "🇸🇬 " : ""}${resolved.jurisdictionName || resolved.id}${resolved.regulatoryAuthority ? ` (${resolved.regulatoryAuthority})` : ""}${!isLicensedHere ? " — default for non-licensed markets" : ""}`
                : (getApplicableLicence(countryCode) === "GB" ? "🇬🇧 United Kingdom (FCA)" : "🇸🇬 Singapore (MAS) — default for non-licensed markets");
              const isFiFlow = entityType === "FI" || entityType === "Platform";
              const routesNote = entityType === "Platform" || entityType === "Direct"
                ? ` (${entityType} routes to ${isFiFlow ? "FI" : "Corporate"} schema)`
                : "";
              const primaryName = primary?.jurisdictionName || "the default licence";
              return (
                <div style={{ padding: "10px 14px", borderRadius: 8, background: isLicensedHere ? "#f0f3f8" : "#fff8ed", fontSize: 12, marginBottom: 14, borderLeft: isLicensedHere ? "3px solid #1a3a4a" : "3px solid #e0a040" }}>
                  <div style={{ marginBottom: 4 }}><strong>🌍 Researching in:</strong> {countryObj?.name} ({countryCode})</div>
                  <div><strong>📋 Applicable licence:</strong> {licenceLabel}</div>
                  {entityType && (
                    <div style={{ marginTop: 4 }}><strong>📑 Form set:</strong> {isFiFlow ? "FI version" : "Corporate version"}{routesNote}</div>
                  )}
                  {!isLicensedHere && <div style={{ marginTop: 4, fontStyle: "italic", color: "#9d6500" }}>{companyName_} has no licence in {countryObj?.name}, so this customer is onboarded under {primaryName}. Public records will be searched in {countryObj?.name}, but {primaryName} requirements apply.</div>}
                </div>
              );
            })()}
            {error && <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#dc2626", marginBottom: 14 }}>{error}</div>}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
              <Btn onClick={doDummyResearch} variant="secondary">🧪 Dummy Research (skip API)</Btn>
              <Btn
                disabled={!companyName.trim() || !countryCode || !entityType || !ownershipType}
                onClick={() => {
                  if (!companyName.trim()) { setError("Please enter a company name."); return; }
                  if (!entityType) { setError("Please select an entity type."); return; }
                  if (!ownershipType) { setError("Please select an ownership type."); return; }
                  if (!countryCode) { setError("Please select a country."); return; }
                  setError("");
                  setSelectedJourneyCard(null);
                  setManualOpened(false);
                  setJourneyOpen(true);
                }} variant="primary">Continue →</Btn>
            </div>
          </div>
        )}

        {step === STEPS.input && journeyOpen && (
          <div style={card}>
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 4px" }}>How would you like to complete your application?</h2>
            <p style={{ fontSize: 13, color: "#1a3a4a80", margin: "0 0 18px" }}>Choose the option that works best for you. You can always go back and change this.</p>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, marginBottom: 14 }}>
              {/* Card A */}
              {(() => {
                const sel = selectedJourneyCard === "A";
                return (
                  <div
                    onClick={() => { setSelectedJourneyCard("A"); setError(""); }}
                    style={{
                      position: "relative", padding: "18px 16px", borderRadius: 12, cursor: "pointer",
                      background: sel ? "#f0f9f6" : "#fafcfb",
                      border: `2px solid ${sel ? "#1a3a4a" : "rgba(26,58,74,0.18)"}`,
                      boxShadow: sel ? "0 6px 18px rgba(26,58,74,0.12)" : "none",
                    }}
                  >
                    <span style={{ position: "absolute", top: 10, right: 10, background: "#4a9e8e", color: "#fff", fontSize: 9, fontWeight: 800, letterSpacing: "0.06em", padding: "3px 8px", borderRadius: 999, textTransform: "uppercase" }}>Recommended</span>
                    <div style={{ fontSize: 24, marginBottom: 6 }}>🔍📄</div>
                    <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Upload documents &amp; let AI fill the rest</div>
                    <div style={{ fontSize: 12, color: "#1a3a4a80", lineHeight: 1.5, marginBottom: 8 }}>Upload any documents you have — we extract data from them instantly. For anything we can't find in your documents, our AI searches public registries and web sources.</div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "#4a9e8e" }}>Fastest · Most accurate · Lowest effort</div>
                  </div>
                );
              })()}

              {/* Card B */}
              {(() => {
                const sel = selectedJourneyCard === "B";
                return (
                  <div
                    onClick={() => { setSelectedJourneyCard("B"); setError(""); }}
                    style={{
                      padding: "18px 16px", borderRadius: 12, cursor: "pointer",
                      background: sel ? "#f0f3f8" : "#fafcfb",
                      border: `2px solid ${sel ? "#1a3a4a" : "rgba(26,58,74,0.12)"}`,
                    }}
                  >
                    <div style={{ fontSize: 24, marginBottom: 6 }}>🔍</div>
                    <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Let AI research your company</div>
                    <div style={{ fontSize: 12, color: "#1a3a4a80", lineHeight: 1.5, marginBottom: 8 }}>No documents needed. Our AI searches Companies House, regulatory registers, annual reports and other public sources to pre-fill your application.</div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "#4a9e8e" }}>~30 seconds · No uploads needed</div>
                  </div>
                );
              })()}

              {/* Card C */}
              {(() => {
                const sel = selectedJourneyCard === "C";
                return (
                  <div
                    onClick={() => { setSelectedJourneyCard("C"); setError(""); }}
                    style={{
                      padding: "18px 16px", borderRadius: 12, cursor: "pointer",
                      background: sel ? "#f5f5f5" : "#f8f8f8",
                      border: `2px solid ${sel ? "#1a3a4a" : "rgba(26,58,74,0.1)"}`,
                      opacity: 0.92,
                    }}
                  >
                    <div style={{ fontSize: 24, marginBottom: 6 }}>✏️</div>
                    <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>I'll complete the form myself</div>
                    <div style={{ fontSize: 12, color: "#1a3a4a80", lineHeight: 1.5, marginBottom: 8 }}>Skip the AI research and fill everything manually using your own records. You'll be redirected to our standard application form.</div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "#1a3a4a90" }}>Full control · No AI · ~15 minutes</div>
                  </div>
                );
              })()}
            </div>

            {manualOpened && (
              <div style={{ marginTop: 4, marginBottom: 12, padding: "10px 14px", background: "#f0f3f8", borderRadius: 8, fontSize: 12, color: "#1a3a4a", borderLeft: "3px solid #1a3a4a" }}>
                Opening the manual form in a new tab… You can also continue with AI assistance above.
              </div>
            )}

            {demoMode && (
              <div style={{ marginBottom: 12, padding: "10px 14px", background: "#FEF3C7", borderRadius: 8, fontSize: 12, color: "#92400E", borderLeft: "3px solid #FCD34D" }}>
                Demo mode active — using sample data. Document extraction and web research are simulated.
              </div>
            )}

            {error && <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#dc2626", marginBottom: 14 }}>{error}</div>}

            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <Btn variant="secondary" onClick={() => { setJourneyOpen(false); setManualOpened(false); setError(""); }}>← Back</Btn>
              <Btn variant="primary" onClick={proceedFromJourney}>Continue →</Btn>
            </div>

            {demoToggleVisible && (
              <div style={{ marginTop: 18, display: "flex", justifyContent: "flex-end" }}>
                <DemoToggle on={demoMode} onChange={setDemoMode} />
              </div>
            )}
          </div>
        )}

        {isAiDocs && step === STEPS.documents && (() => {
          const docs = docTypesForEntity(entityType, tenantConfig);
          const uploadedCount = docs.reduce((n, d) => n + (uploadedDocs[d.key] ? 1 : 0), 0);
          return (
            <div>
              <div style={card}>
                <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 6px" }}>Upload your documents</h2>
                <p style={{ fontSize: 13, color: "#1a3a4a90", margin: "0 0 18px", lineHeight: 1.5 }}>
                  All documents are optional. Upload as many or as few as you have available. The more you provide, the less you'll need to fill in manually.
                </p>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14 }}>
                  {docs.map(d => {
                    const file = uploadedDocs[d.key];
                    const inputId = `upload-${d.key}`;
                    return (
                      <div key={d.key} style={{
                        padding: "14px 14px", borderRadius: 12,
                        background: file ? "#f0f9f6" : "#fafcfb",
                        border: file ? "2px solid #4a9e8e" : "2px dashed rgba(26,58,74,0.18)",
                      }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                          <div style={{ fontSize: 20 }}>{d.icon}</div>
                          <div style={{ fontSize: 13, fontWeight: 700, flex: 1 }}>{d.label}</div>
                          {d.badge && (
                            <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.05em", padding: "3px 8px", borderRadius: 999, background: d.badge.color, color: "#fff", textTransform: "uppercase" }}>{d.badge.text}</span>
                          )}
                        </div>
                        <div style={{ fontSize: 11, color: "#1a3a4a80", lineHeight: 1.5, marginBottom: 10 }}>{d.helper}</div>
                        {file ? (
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "8px 12px", background: "#fff", borderRadius: 8, border: "1px solid rgba(74,158,142,0.25)" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                              <span style={{ color: "#1a6b56", fontWeight: 700, fontSize: 14 }}>✓</span>
                              <div style={{ minWidth: 0 }}>
                                <div style={{ fontSize: 12, fontWeight: 600, color: "#1a3a4a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file.name}</div>
                                <div style={{ fontSize: 10, color: "#1a3a4a70" }}>{(file.size / 1024).toFixed(0)} KB</div>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={removeDocFile(d.key)}
                              title="Remove"
                              style={{ background: "transparent", border: "none", color: "#1a3a4a", fontSize: 18, cursor: "pointer", lineHeight: 1, padding: 4 }}
                            >×</button>
                          </div>
                        ) : (
                          <label htmlFor={inputId} style={{ display: "block", padding: "12px 10px", textAlign: "center", borderRadius: 8, background: "#fff", border: "1.5px dashed rgba(26,58,74,0.22)", cursor: "pointer", fontSize: 12, color: "#1a3a4a90" }}>
                            Click to upload or drag and drop
                            <div style={{ fontSize: 10, color: "#1a3a4a60", marginTop: 4 }}>{d.accepts}</div>
                          </label>
                        )}
                        <input
                          id={inputId}
                          type="file"
                          accept={d.accept}
                          onChange={handleDocFile(d.key)}
                          style={{ display: "none" }}
                        />
                      </div>
                    );
                  })}
                </div>

                {error && <div style={{ marginTop: 14, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#dc2626" }}>{error}</div>}

                <div style={{ marginTop: 14, padding: "10px 14px", borderRadius: 8, background: uploadedCount > 0 ? "#f0f9f6" : "#fafcfb", color: uploadedCount > 0 ? "#1a6b56" : "#1a3a4a70", fontSize: 12, fontWeight: 600 }}>
                  {uploadedCount > 0
                    ? `${uploadedCount} document${uploadedCount === 1 ? "" : "s"} ready to upload`
                    : "No documents selected — AI will use web search only"}
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <Btn variant="secondary" onClick={() => { setError(""); setJourneyOpen(true); scrollAndSetStep(STEPS.input); }}>← Back</Btn>
                <Btn variant="primary" onClick={proceedFromDocuments}>Continue →</Btn>
              </div>
            </div>
          );
        })()}

        {step === STEPS.research && (
          <div style={{ ...card, textAlign: "center", padding: "56px 28px" }}>
            <div style={{ position: "relative", width: 130, height: 130, margin: "0 auto 28px" }}>
              {[0, 1, 2].map(i => (
                <div key={i} style={{
                  position: "absolute", inset: 0, borderRadius: "50%",
                  border: "2px solid rgba(74,158,142,0.55)",
                  animation: `kpulse 2.4s ease-out ${i * 0.8}s infinite`,
                }} />
              ))}
              <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 56, animation: "kbob 2.6s ease-in-out infinite" }}>🔍</div>
            </div>

            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>
              Researching {companyName}... {jurisdictionBadge}{entityBadge}
            </div>
            {loaderPhase > 0 && (
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#0B3D91", marginBottom: 6 }}>
                {loaderPhase === 1 ? "Phase 1 of 2 — Documents" : "Phase 2 of 2 — Web research"}
              </div>
            )}
            <div style={{ fontSize: 13, color: "#4a9e8e", fontStyle: "italic", marginBottom: researchStatus ? 6 : 22, minHeight: 18 }}>
              {loaderMsgs[Math.min(loaderIdx, loaderMsgs.length - 1)]}
            </div>
            {researchStatus && (
              <div style={{ fontSize: 12, fontWeight: 600, color: "#0B3D91", marginBottom: 22 }}>
                🔎 {researchStatus}
              </div>
            )}

            <div style={{ width: "100%", maxWidth: 420, height: 6, background: "rgba(74,158,142,0.12)", borderRadius: 3, overflow: "hidden", margin: "0 auto 18px" }}>
              <div style={{
                width: `${((loaderIdx + 1) / loaderMsgs.length) * 100}%`,
                height: "100%",
                background: "linear-gradient(90deg,#4a9e8e,#1a3a4a)",
                transition: "width 0.6s ease",
              }} />
            </div>

            <div style={{ display: "flex", justifyContent: "center", gap: 7, flexWrap: "wrap" }}>
              {loaderMsgs.map((_, i) => (
                <div key={i} style={{
                  width: 9, height: 9, borderRadius: "50%",
                  background: i <= loaderIdx ? "#4a9e8e" : "rgba(26,58,74,0.15)",
                  transition: "background 0.3s",
                  boxShadow: i === loaderIdx ? "0 0 0 3px rgba(74,158,142,0.25)" : "none",
                }} />
              ))}
            </div>

            <style>{`
              @keyframes kpulse {
                0%   { transform: scale(0.55); opacity: 1;   border-color: rgba(74,158,142,0.7); }
                100% { transform: scale(1.45); opacity: 0;   border-color: rgba(74,158,142,0); }
              }
              @keyframes kbob {
                0%, 100% { transform: translateY(0); }
                50%      { transform: translateY(-6px); }
              }
            `}</style>
          </div>
        )}

        {step === STEPS.confirm && research && (
          <div>
            <div style={card}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: "linear-gradient(135deg,#4a9e8e,#3a8e7e)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>✅</div>
                <div>
                  <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>{research.companyName || companyName} {jurisdictionBadge}{entityBadge}</h2>
                  <p style={{ fontSize: 12, color: "#1a3a4a70", margin: 0 }}>
                    {sortedFound.length} fields pre-filled · {docCount} from documents · {tier1Count} from official sources · {tier2Count + tier3Count} need your attention
                  </p>
                </div>
              </div>
              <div style={{ background: "#f0f9f6", borderRadius: 8, padding: "12px 16px", fontSize: 13, color: "#1a6b56", borderLeft: "4px solid #4a9e8e" }}>
                Below: every field we pre-filled, sorted by source — documents first (most reliable), then official registries, then company-owned sources, then unverified web. Uncheck anything wrong — it'll move to the next page for correction. Click any source to reveal when it was fetched.
              </div>
            </div>

            {/* Part 11 — low-data banner. Threshold is calibrated per ownership
                type (private companies expect lower fill rates than listed). */}
            {(() => {
              if (!coverage) return null;
              const strat = getResearchStrategy(ownershipType);
              const showLowDataBanner = coverage.fillRate < strat.lowDataThreshold + 0.10;
              if (!showLowDataBanner) return null;
              const parentResult = (research.found || []).find(
                (r) => r.field === "ubo_parent_company" || r.field === "parent_company" || r.field === "group_structure"
              );
              const isPrivateish = ownershipType === "private_limited" || ownershipType === "branch";
              return (
                <div style={{ padding: 16, background: C.infoBg, border: `1px solid ${C.infoBorder}`, borderRadius: 10, marginBottom: 16 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: C.info, marginBottom: 6, display: "flex", alignItems: "center", gap: 8 }}>
                    <span>ℹ</span>
                    <span>Limited public information found for {research.companyName || companyName}</span>
                  </div>
                  <p style={{ fontSize: 13, color: C.info, marginBottom: 12, lineHeight: 1.5 }}>
                    {coverage.populatedFields} of {coverage.totalResearchFields} fields were found from public sources.
                    {isPrivateish
                      ? " Private companies have limited publicly available information — this is expected."
                      : " You can improve coverage by uploading documents."}
                  </p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {ownershipType === "branch" && (
                      <div style={{ padding: "10px 14px", background: "#fff", borderRadius: 8, border: `1px solid ${C.infoBorder}`, fontSize: 13, color: C.text }}>
                        <strong>Try searching for the parent company:</strong> If this is a branch, searching for the parent entity may return more complete information.
                        {parentResult && parentResult.value && (
                          <button
                            onClick={() => {
                              setCompanyName(String(parentResult.value));
                              setJourneyOpen(false);
                              setSelectedJourneyCard(null);
                              setError("");
                              setStep(STEPS.input);
                            }}
                            style={{ marginLeft: 8, padding: "4px 12px", background: C.info, color: "#fff", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
                          >
                            Search parent →
                          </button>
                        )}
                      </div>
                    )}
                    {journeyType === "ai_only" && (
                      <div style={{ padding: "10px 14px", background: "#fff", borderRadius: 8, border: `1px solid ${C.infoBorder}`, fontSize: 13, color: C.text, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                        <span>
                          <strong>Upload documents</strong> to pre-fill more fields — Certificate of Incorporation, Annual Report, or Wolfsberg questionnaire.
                        </span>
                        <button
                          onClick={() => { setJourneyType("ai_documents"); setJourneyOpen(false); setStep(stepsFor("ai_documents").documents); }}
                          style={{ padding: "6px 14px", background: C.niumBlue, color: "#fff", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap", flexShrink: 0 }}
                        >
                          📄 Upload docs
                        </button>
                      </div>
                    )}
                    <p style={{ fontSize: 12, color: C.textMuted, fontStyle: "italic", margin: 0 }}>
                      Or continue below — you can complete the remaining fields manually on the next page.
                    </p>
                  </div>
                </div>
              );
            })()}

            {/* Part 9 — coverage summary bar. */}
            {coverage && (
              <div style={{ display: "flex", alignItems: "center", gap: 0, marginBottom: 20, borderRadius: 10, border: `1px solid ${C.border}`, overflow: "hidden" }}>
                <div style={{ flex: 1, padding: "12px 16px", background: C.successBg, borderRight: `1px solid ${C.border}`, textAlign: "center" }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color: C.success, lineHeight: 1 }}>{coverage.verifiedFields}</div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: C.success, marginTop: 3, textTransform: "uppercase", letterSpacing: "0.5px" }}>Verified</div>
                </div>
                <div style={{ flex: 1, padding: "12px 16px", background: C.warningBg, borderRight: `1px solid ${C.border}`, textAlign: "center" }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color: C.warning, lineHeight: 1 }}>{coverage.probableFields}</div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: C.warning, marginTop: 3, textTransform: "uppercase", letterSpacing: "0.5px" }}>To Confirm</div>
                </div>
                {coverage.indicativeFields > 0 && (
                  <div style={{ flex: 1, padding: "12px 16px", background: "#FFF7ED", borderRight: `1px solid ${C.border}`, textAlign: "center" }}>
                    <div style={{ fontSize: 22, fontWeight: 800, color: "#C2410C", lineHeight: 1 }}>{coverage.indicativeFields}</div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "#C2410C", marginTop: 3, textTransform: "uppercase", letterSpacing: "0.5px" }}>Low Confidence</div>
                  </div>
                )}
                <div style={{ flex: 1, padding: "12px 16px", background: C.surfaceAlt, textAlign: "center" }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color: C.textMuted, lineHeight: 1 }}>{coverage.missingFieldCount}</div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: C.textMuted, marginTop: 3, textTransform: "uppercase", letterSpacing: "0.5px" }}>To Complete</div>
                </div>
              </div>
            )}

            {/* Manual "publicly listed company" toggle — hides stakeholder EDD
                forms on the next page. */}
            <div
              onClick={() => setIsPubliclyListedOverride(v => !v)}
              style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "12px 16px",
                background: isPubliclyListedOverride ? "#f3faf8" : "#f2f1ed",
                border: `1.5px solid ${isPubliclyListedOverride ? "#4a9e8e" : "rgba(26,58,74,0.14)"}`,
                borderRadius: 10, marginBottom: 16,
                cursor: "pointer", transition: "all 0.15s", userSelect: "none",
              }}
            >
              <input
                type="checkbox"
                checked={isPubliclyListedOverride}
                onChange={() => setIsPubliclyListedOverride(v => !v)}
                onClick={(e) => e.stopPropagation()}
                style={{ width: 16, height: 16, accentColor: "#4a9e8e", cursor: "pointer", flexShrink: 0 }}
                aria-label="This is a publicly listed company"
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 14, fontWeight: 600,
                  color: isPubliclyListedOverride ? "#1a6b56" : "#1a3a4a",
                }}>
                  🏛 This is a publicly listed company
                </div>
                <div style={{
                  fontSize: 12, marginTop: 2,
                  color: isPubliclyListedOverride ? "#1a6b56" : "#1a3a4a70",
                }}>
                  {isPubliclyListedOverride
                    ? "✓ Stakeholder compliance details will not be collected on the next page"
                    : "Check this box to skip detailed stakeholder forms on the next page"}
                </div>
              </div>
              {isPubliclyListedOverride && (
                <span style={{
                  fontSize: 12, fontWeight: 700, color: "#1a6b56",
                  background: "#f3faf8", border: "1px solid #4a9e8e",
                  borderRadius: 99, padding: "3px 10px",
                  whiteSpace: "nowrap", flexShrink: 0,
                }}>
                  Listed ✓
                </span>
              )}
            </div>

            {stakeholderFound.length > 0 && (
              <div style={card}>
                <h3 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 4px" }}>People Found</h3>
                <p style={{ fontSize: 11, color: "#1a3a4a70", margin: "0 0 12px" }}>
                  Directors and beneficial owners we identified from official sources. Verify each name; you'll provide additional compliance details on the next page.
                </p>
                {stakeholderFound.map(({ item, idx }) => renderStakeholderConfirmSection(item, idx))}
              </div>
            )}

            {regularFound.length > 0 && renderUnifiedFoundTable(regularFound, "Pre-filled Fields", "Documents → Official sources → Unverified web. Tier-2 rows carry an inline warning.")}

            {(research.found || []).filter((_, i) => !checks[i]).length > 0 && (
              <div style={{ marginBottom: 16, padding: "10px 14px", background: "#fff8ed", borderRadius: 6, fontSize: 12, color: "#b07d10", borderLeft: "3px solid #e0a040" }}>
                ⚠️ {(research.found || []).filter((_, i) => !checks[i]).length} field(s) unchecked — will appear on next page for correction.
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <Btn variant="secondary" onClick={resetAll}>← Start Over</Btn>
              <Btn variant="green" onClick={() => { scrollAndSetStep(STEPS.fillGaps); setError(""); }}>Confirm and Continue →</Btn>
            </div>
          </div>
        )}

        {step === STEPS.fillGaps && research && activeSchema && (
          <div>
            <div style={card}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: "linear-gradient(135deg,#e0a040,#d09030)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>📝</div>
                <div>
                  <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>Additional Information Required {jurisdictionBadge}{entityBadge}</h2>
                  <p style={{ fontSize: 12, color: "#1a3a4a70", margin: 0 }}>{getCombinedGaps().length} fields need your input</p>
                </div>
              </div>
            </div>

            {stakeholderErrors.length > 0 && (
              <div style={{
                background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10,
                padding: "14px 16px", marginBottom: 16,
              }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#dc2626", marginBottom: 8 }}>
                  Please fix the following before continuing:
                </div>
                <ul style={{ margin: 0, paddingLeft: 20 }}>
                  {stakeholderErrors.map((msg, i) => (
                    <li key={i} style={{ fontSize: 12, color: "#dc2626", marginBottom: 3 }}>{msg}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* 1. Corrections required + 2. Missing gap fields — corrections
                come first inside gapSectionOrder(), then missing fields. */}
            {gapSectionOrder().map(s => renderGapSection(s))}

            {/* 3. Stakeholder forms — only people who need customer input
                (private directors/UBOs, or listed-company >= 25% UBOs). */}
            {hasStakeholderForms && (
              <div style={{
                fontSize: 11, fontWeight: 700, color: "#1a3a4a80",
                textTransform: "uppercase", letterSpacing: "0.08em",
                marginTop: 8, marginBottom: 12, paddingTop: 16,
                borderTop: "1px solid rgba(26,58,74,0.08)",
                display: "flex", alignItems: "center", gap: 8,
              }}>
                <span>👥</span>
                <span>People — additional details needed</span>
              </div>
            )}
            {stakeholderFormNodes}

            {/* 4. Verified stakeholder summary — read-only reference, last. */}
            {hasStakeholderSummary && (
              <div style={{
                fontSize: 11, fontWeight: 700, color: "#1a3a4a80",
                textTransform: "uppercase", letterSpacing: "0.08em",
                marginTop: 8, marginBottom: 12, paddingTop: 16,
                borderTop: "1px solid rgba(26,58,74,0.08)",
                display: "flex", alignItems: "center", gap: 8,
              }}>
                <span>✅</span>
                <span>Verified information — for reference</span>
              </div>
            )}
            {stakeholderSummaryNodes}

            <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
              <button
                type="button"
                onClick={fillTestData}
                style={{
                  padding: "10px 20px", borderRadius: 8, fontSize: 12, fontWeight: 600,
                  cursor: "pointer", fontFamily: "inherit",
                  background: "transparent", color: "#4a9e8e",
                  border: "2px dashed #4a9e8e",
                }}
              >
                ✨ Fill with test data
              </button>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <Btn variant="secondary" onClick={() => scrollAndSetStep(STEPS.confirm)}>← Back to Review</Btn>
              <Btn variant="primary" onClick={() => {
                const stkErrors = validateStakeholders();
                if (stkErrors.length > 0) {
                  setStakeholderErrors(stkErrors);
                  setError("");
                  window.scrollTo({ top: 0, behavior: "smooth" });
                  return;
                }
                if (allGapsFilled()) {
                  setStakeholderErrors([]);
                  scrollAndSetStep(STEPS.documentRequirements);
                  setError("");
                } else {
                  setError("Please fill all required fields.");
                }
              }}>Continue to Documents →</Btn>
            </div>
            {error && step === STEPS.fillGaps && <div style={{ marginTop: 8, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#dc2626" }}>{error}</div>}
          </div>
        )}

        {/* DRS — dynamic document-requirements step (Step 2 of the CDD brief),
            placed after Fill Gaps so classifiers + research are settled. */}
        {step === STEPS.documentRequirements && (
          <div>
            <div style={card}>
              <h2 style={{ fontSize: 17, fontWeight: 700, margin: "0 0 4px" }}>📄 Required Documents</h2>
              <p style={{ fontSize: 13, color: "#1a3a4a70", margin: "0 0 4px" }}>
                Based on the company's country, entity and ownership type, here's exactly what we need.
              </p>
            </div>
            <div style={card}>
              {(() => {
                const entLabel = (activeEntityTypes.find(e => e.id === entityType)?.label) || entityType;
                const drsStep1Data = {
                  companyName: research?.companyName || companyName,
                  incorporationCountry: countryObj ? countryObj.name : countryCode,
                  entityType: entLabel,
                  ownershipType: OWNERSHIP_ID_TO_DRS[ownershipType] || ownershipType,
                };
                return (
                  <Step2DynamicForm
                    step1Data={drsStep1Data}
                    researchData={research}
                    onComplete={(data) => {
                      setDrsSubmitted(data.submittedRequirements || []);
                      setDrsFlags(data.flags || {});
                      setDrsGapsCleared(false);
                      scrollAndSetStep(STEPS.declare);
                    }}
                  />
                );
              })()}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-start" }}>
              <Btn variant="secondary" onClick={() => scrollAndSetStep(STEPS.fillGaps)}>← Back to Fill Gaps</Btn>
            </div>
          </div>
        )}

        {/* DRS pre-declaration gap gate (Step 5 of the CDD brief). Blocks the
            declaration until every mandatory document is on file. */}
        {step === STEPS.declare && !done && !drsGapsCleared && (
          <div>
            <div style={card}>
              <h2 style={{ fontSize: 17, fontWeight: 700, margin: "0 0 12px" }}>✅ Final document check</h2>
              {(() => {
                const entLabel = (activeEntityTypes.find(e => e.id === entityType)?.label) || entityType;
                const drsStep1Data = {
                  companyName: research?.companyName || companyName,
                  incorporationCountry: countryObj ? countryObj.name : countryCode,
                  entityType: entLabel,
                  ownershipType: OWNERSHIP_ID_TO_DRS[ownershipType] || ownershipType,
                };
                return (
                  <Step5Recompute
                    step1Data={drsStep1Data}
                    sector={null}
                    submittedRequirements={drsSubmitted}
                    extraFlags={{}}
                    onGapsClear={() => setDrsGapsCleared(true)}
                    onRequestDocument={() => scrollAndSetStep(STEPS.documentRequirements)}
                  />
                );
              })()}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-start" }}>
              <Btn variant="secondary" onClick={() => scrollAndSetStep(STEPS.documentRequirements)}>← Back to Documents</Btn>
            </div>
          </div>
        )}

        {step === STEPS.declare && !done && drsGapsCleared && (
          <div>
            <div style={card}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: "linear-gradient(135deg,#1a3a4a,#2d5a6e)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>📜</div>
                <div>
                  <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>Applicant Declaration {jurisdictionBadge}{entityBadge}</h2>
                  <p style={{ fontSize: 12, color: "#1a3a4a70", margin: 0 }}>Review and confirm</p>
                </div>
              </div>
              <div style={{ background: "#fafcfb", borderRadius: 10, padding: 18, border: "1px solid rgba(26,58,74,0.08)", marginBottom: 18 }}>
                <p style={{ fontSize: 13, lineHeight: 1.7, margin: 0 }}>
                  I, <strong>{gapRef.current.applicantFirstName || "___"} {gapRef.current.applicantLastName || "___"}</strong>, hereby declare that:
                </p>
                <ul style={{ fontSize: 13, lineHeight: 1.8, paddingLeft: 18, margin: "10px 0 0" }}>
                  <li>All information provided is true, complete, and accurate to the best of my knowledge.</li>
                  <li>I am authorised to submit this on behalf of <strong>{research?.companyName || companyName}</strong>.</li>
                  <li>Providing false information may result in rejection and legal consequences.</li>
                  <li>I consent to verification through third-party and regulatory databases.</li>
                  <li>I will notify of any material changes promptly.</li>
                </ul>
              </div>
              <div onClick={() => setDeclared(!declared)} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: 14, background: declared ? "#f0f9f6" : "#f8f8f8", borderRadius: 8, cursor: "pointer", marginBottom: 18, border: declared ? "1.5px solid #4a9e8e" : "1.5px solid #ddd" }}>
                <input type="checkbox" checked={declared} readOnly style={{ width: 18, height: 18, marginTop: 1, accentColor: "#4a9e8e", cursor: "pointer" }} />
                <span style={{ fontSize: 13, fontWeight: 600 }}>I confirm I have read, understood, and agree to the above declaration.</span>
              </div>
              <div style={{ background: "#f3f5f8", borderRadius: 8, padding: 14 }}>
                <h4 style={{ fontSize: 11, fontWeight: 700, margin: "0 0 8px", color: "#1a3a4a80", letterSpacing: "0.1em", textTransform: "uppercase" }}>Device Information (Auto-captured)</h4>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5 }}>
                  {[["IP Address", device.ipAddress], ["Platform", device.platform], ["Timezone", device.timezone], ["Screen", device.screenRes], ["Language", device.language], ["Capture Time", new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC"]].map(([k, v]) => (
                    <div key={k} style={{ fontSize: 11, color: "#1a3a4a90" }}><span style={{ fontWeight: 600 }}>{k}:</span> {v || "..."}</div>
                  ))}
                </div>
                <div style={{ fontSize: 10, color: "#1a3a4a50", marginTop: 6, borderTop: "1px solid rgba(26,58,74,0.06)", paddingTop: 5, wordBreak: "break-all" }}>
                  User Agent: {(device.userAgent || "").slice(0, 120)}
                </div>
              </div>
            </div>
            {inPreview && (
              <div style={{
                padding: "12px 16px",
                background: "#EFF6FF",
                border: "1px solid #BFDBFE",
                borderRadius: 8,
                fontSize: 13, color: "#1E40AF",
                marginBottom: 16,
                display: "flex", gap: 8, alignItems: "flex-start",
              }}>
                <span>ℹ</span>
                <span>Submission is disabled in preview mode. Publish your configuration to enable the live form.</span>
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <Btn variant="secondary" onClick={() => scrollAndSetStep(STEPS.fillGaps)}>← Back</Btn>
              <Btn
                variant="green"
                onClick={inPreview ? undefined : submitApplication}
                disabled={!declared || inPreview}
              >
                ✓ Submit Application
              </Btn>
            </div>
          </div>
        )}

        {done && (
          <div style={{ ...card, textAlign: "center", padding: "44px 28px" }}>
            <div style={{ width: 64, height: 64, borderRadius: "50%", background: "linear-gradient(135deg,#4a9e8e,#3a8e7e)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32, margin: "0 auto 18px", boxShadow: "0 6px 20px rgba(74,158,142,0.3)" }}>✓</div>
            <h2 style={{ fontSize: 20, fontWeight: 800, margin: "0 0 6px" }}>Application Submitted {jurisdictionBadge}{entityBadge}</h2>
            <p style={{ fontSize: 13, color: "#1a3a4a70", margin: "0 0 22px" }}>KYC onboarding for <strong>{research?.companyName || companyName}</strong> submitted successfully.</p>
            <div style={{ background: "#f5f7fa", borderRadius: 10, padding: 18, textAlign: "left", maxWidth: 480, margin: "0 auto 22px" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#1a3a4a80", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.08em" }}>Submission Summary</div>
              {(() => {
                const docKeys = docTypesForEntity(entityType, tenantConfig).filter(d => uploadedDocs[d.key]).map(d => d.label);
                const docExtractedCount = (research?.found || []).filter(i => i.sourceTier === "document").length;
                const tier1 = (research?.found || []).filter(i => i.sourceTier === "tier1").length;
                const tier2 = (research?.found || []).filter(i => i.sourceTier === "tier2").length;
                const accepted = (research?.found || []).filter((_, i) => checks[i]).length;
                const rejected = (research?.found || []).filter((_, i) => !checks[i]).length;
                const rows = [
                  ["Company", research?.companyName || companyName],
                  ["Journey", journeyType === "ai_documents" ? "AI + Documents" : "AI Research Only"],
                  ["Jurisdiction", activeSchema?.region === "UK" ? "United Kingdom" : "Singapore / Default"],
                  ["From documents", docExtractedCount + " fields"],
                  ["From official sources", tier1 + " fields"],
                  ["From unverified sources", tier2 + " fields"],
                  ["Accepted on Confirm", accepted + " · " + rejected + " corrected"],
                  ...(docKeys.length > 0 ? [["Documents uploaded", docKeys.join(", ")]] : []),
                  ["Manual fields", Object.keys(gapRef.current).length + " provided"],
                  ["Applicant", (gapRef.current.applicantFirstName || "") + " " + (gapRef.current.applicantLastName || "")],
                  ["Declared at", submitTs.replace("T", " ").slice(0, 19) + " UTC"],
                  ["IP Address", device.ipAddress],
                ];
                return rows.map(([k, v]) => (
                  <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid rgba(26,58,74,0.04)", fontSize: 12 }}>
                    <span style={{ fontWeight: 600 }}>{k}</span><span style={{ color: "#1a3a4a90" }}>{v}</span>
                  </div>
                ));
              })()}
            </div>
            <Btn variant="secondary" onClick={() => { setCompanyName(""); setCountryCode(""); setEntityType(""); setOwnershipType(""); setDone(false); setSubmitTs(""); resetAll(); }}>Start New Application</Btn>
          </div>
        )}

        <footer style={{
          textAlign: "center", marginTop: 40, paddingTop: 18,
          borderTop: "1px solid rgba(26,58,74,0.08)",
          fontSize: 11, color: "#1a3a4a70",
        }}>
          © {new Date().getFullYear()} {companyName_}
          {tenantConfig?.company?.privacyPolicyUrl && (
            <>
              {" · "}
              <a
                href={tenantConfig.company.privacyPolicyUrl}
                target="_blank" rel="noopener noreferrer"
                style={{ color: "#1a3a4a", textDecoration: "underline" }}
              >Privacy Policy</a>
            </>
          )}
          {tenantConfig?.company?.primaryContactEmail && (
            <>
              {" · "}
              <a
                href={`mailto:${tenantConfig.company.primaryContactEmail}`}
                style={{ color: "#1a3a4a", textDecoration: "underline" }}
              >Contact</a>
            </>
          )}
          {(() => {
            // Tiny config/version readout for dev or ?debug=true. Helps confirm
            // during testing which config version is live and which schema cell
            // was resolved. Production users never see it.
            const isDev = process.env.NODE_ENV === "development";
            let isDebug = false;
            try {
              isDebug = new URLSearchParams(window.location.search).get("debug") === "true";
            } catch (_) { /* noop */ }
            if (!isDev && !isDebug) return null;
            const cellKey = activeSchema && entityType && activeSchema.licenceId
              ? `${entityType}:${activeSchema.licenceId}`
              : "(no schema active)";
            return (
              <div style={{ marginTop: 8, fontSize: 10, color: "#1a3a4a55", fontFamily: "monospace" }}>
                Config v{tenantConfig?._version ?? "?"} · Tenant: {tenantId} · Schema: {cellKey}
              </div>
            );
          })()}
        </footer>

      </div>
    </div>
  );
}
