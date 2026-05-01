import { useState, useEffect, useCallback, useRef } from "react";

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

const CURRENCIES = [
  "GBP", "USD", "EUR", "SGD", "AUD", "CAD", "JPY", "HKD", "CHF", "NZD",
  "SEK", "NOK", "DKK", "INR", "CNY", "KRW", "MYR", "IDR", "THB", "PHP",
  "VND", "AED", "SAR", "ZAR", "BRL", "MXN", "TRY", "PLN", "ILS", "TWD",
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

const bankSection = () => [
  { field: "bankAccountName", label: "Bank Account Name", inputType: "text", required: true, section: "bank" },
  { field: "bankAccountNumber", label: "Bank Account Number", inputType: "text", required: true, section: "bank" },
  { field: "bankName", label: "Bank Name", inputType: "text", required: true, section: "bank" },
  { field: "bankSortCode", label: "Sort Code", inputType: "text", required: true, section: "bank" },
  { field: "bankCurrency", label: "Account Currency", inputType: "select", required: true, section: "bank", options: CURRENCIES },
  { field: "bankCountry", label: "Bank Country", inputType: "text", required: true, section: "bank" },
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
  researchFields: [
    { field: "businessType", label: "Business Type", tier: 1 },
    { field: "businessRegistrationNumber", label: "Companies House Number", tier: 1 },
    { field: "registeredDate", label: "Date of Incorporation", tier: 1 },
    { field: "registeredCountry", label: "Registered Country", tier: 1 },
    { field: "tradeName", label: "Trade Name", tier: 1 },
    { field: "website", label: "Website", tier: 1 },
    { field: "addressLine1", label: "Registered Address Line 1", tier: 1 },
    { field: "addressLine2", label: "Registered Address Line 2", tier: 1 },
    { field: "city", label: "City", tier: 1 },
    { field: "state", label: "County / State", tier: 1 },
    { field: "postcode", label: "Postcode", tier: 1 },
    { field: "country", label: "Address Country", tier: 1 },
    { field: "sicCode", label: "SIC Code", tier: 1 },
    { field: "annualRevenue", label: "Annual Revenue", tier: 2 },
    { field: "employees", label: "Number of Employees", tier: 2 },
    { field: "stockListing", label: "Stock Exchange Listing", tier: 2 },
    { field: "leiNumber", label: "LEI Number", tier: 2 },
    { field: "countriesOfOperation", label: "Countries of Operation", tier: 2 },
    { field: "isMultiLayered", label: "Multi-layered Corporate Structure", tier: 2 },
    { field: "uboAnalysis", label: "UBO / Ownership Analysis", tier: 2 },
    { field: "directors", label: "Key Directors (with nationality)", tier: 2 },
    { field: "companySecretary", label: "Company Secretary", tier: 2 },
    { field: "isPEP", label: "PEP Status of Directors", tier: 2 },
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
    ...accountSection("GBP"),
    ...bankSection(),
  ],
};

const SG_SCHEMA = {
  label: "Singapore / Default",
  region: "SG",
  researchFields: [
    { field: "businessType", label: "Business Type / Entity Form", tier: 1 },
    { field: "businessRegistrationNumber", label: "Company Registration Number / Tax ID", tier: 1 },
    { field: "registeredDate", label: "Date of Incorporation", tier: 1 },
    { field: "registeredCountry", label: "Registered Country", tier: 1 },
    { field: "tradeName", label: "Trade Name", tier: 1 },
    { field: "formerName", label: "Former Name (if any)", tier: 1 },
    { field: "website", label: "Website", tier: 1 },
    { field: "addressLine1", label: "Registered Address Line 1", tier: 1 },
    { field: "addressLine2", label: "Registered Address Line 2", tier: 1 },
    { field: "city", label: "City", tier: 1 },
    { field: "state", label: "State", tier: 1 },
    { field: "postcode", label: "Postcode", tier: 1 },
    { field: "country", label: "Address Country", tier: 1 },
    { field: "sicCode", label: "Industry Classification Code", tier: 1 },
    { field: "annualRevenue", label: "Annual Revenue / Turnover", tier: 2 },
    { field: "employees", label: "Number of Employees", tier: 2 },
    { field: "stockListing", label: "Stock Exchange Listing", tier: 2 },
    { field: "leiNumber", label: "LEI Number", tier: 2 },
    { field: "countriesOfOperation", label: "Operating Countries", tier: 2 },
    { field: "industryCodes", label: "Industry Sector Codes", tier: 2 },
    { field: "industryDescription", label: "Business Description", tier: 2 },
    { field: "isMultiLayered", label: "Multi-layered Corporate Structure", tier: 2 },
    { field: "uboAnalysis", label: "UBO / Ownership Analysis", tier: 2 },
    { field: "directors", label: "Key Directors / Officers", tier: 2 },
    { field: "companySecretary", label: "Company Secretary", tier: 2 },
    { field: "listedExchange", label: "Listed Exchange (if public)", tier: 2 },
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
    ...accountSection("SGD"),
    ...bankSection(),
  ],
};

/* ═══════════════════════════════════════════
   FI SCHEMAS — shared building blocks
   The two FI schemas (UK and SG) are structurally
   identical. Only Section 5 (Account Usage) differs
   in currency labelling, so it's parameterised by
   a fmt(amount) helper.
   ═══════════════════════════════════════════ */
const fiBusinessResearchFields = [
  { field: "business_name", label: "Business Name", tier: 1 },
  { field: "trading_name", label: "Doing Business As / Trade Name", tier: 1 },
  { field: "business_activity_description", label: "Business Activity Description", tier: 2 },
  { field: "website", label: "Website", tier: 1 },
  { field: "registration_number", label: "Business Registration Number", tier: 1 },
  { field: "registered_address_line1", label: "Address Line 1", tier: 1 },
  { field: "registered_address_line2", label: "Address Line 2", tier: 1 },
  { field: "registered_address_city", label: "City", tier: 1 },
  { field: "registered_address_state", label: "State", tier: 1 },
  { field: "registered_address_postcode", label: "Postcode", tier: 1 },
  { field: "registered_address_country", label: "Country", tier: 1 },
  { field: "incorporation_date", label: "Date of Incorporation", tier: 1 },
  { field: "annual_turnover", label: "Annual Turnover", tier: 2 },
  { field: "employee_count", label: "Number of Employees", tier: 2 },
  { field: "operating_countries", label: "Operating Countries", tier: 2 },
  { field: "publicly_listed", label: "Publicly Listed", tier: 2 },
  { field: "listed_where", label: "Listed Exchanges", tier: 2 },
];

const fiBusinessGapFields = [
  { field: "business_type", label: "Business Type", inputType: "select", required: true, section: "business",
    options: ["Sole Proprietorship", "Partnership", "Private Company", "Listed Company", "Public Sector / Government / State-Owned", "Club / Society / Trust / Charity / Not-for-Profit"] },
  { field: "requested_products", label: "Requested Products / Services (multi)", inputType: "select", required: true, section: "business",
    options: ["Verify", "Global Collections (Payin)", "Domestic Remittances (Payout)", "International Remittances (Payout)"] },
  { field: "industry_sector", label: "Industry Sector (multi)", inputType: "text", required: true, section: "business" },
  { field: "vat_number", label: "VAT Number", inputType: "text", required: false, section: "business" },
  { field: "additional_urls", label: "Additional URLs / Linked Websites", inputType: "text", required: false, section: "business" },
  { field: "business_address_same", label: "Is your business address the same as your registered address?", inputType: "select", required: true, section: "business", options: ["Yes", "No"] },
  { field: "business_address_line1", label: "Business Address Line 1", inputType: "text", required: true, section: "business", dependsOn: { business_address_same: "No" } },
  { field: "business_address_line2", label: "Business Address Line 2", inputType: "text", required: false, section: "business", dependsOn: { business_address_same: "No" } },
  { field: "business_address_city", label: "Business Address City", inputType: "text", required: true, section: "business", dependsOn: { business_address_same: "No" } },
  { field: "business_address_state", label: "Business Address State", inputType: "text", required: true, section: "business", dependsOn: { business_address_same: "No" } },
  { field: "business_address_postcode", label: "Business Address Postcode", inputType: "text", required: true, section: "business", dependsOn: { business_address_same: "No" } },
  { field: "business_address_country", label: "Business Address Country", inputType: "text", required: true, section: "business", dependsOn: { business_address_same: "No" } },
  { field: "org_structure_doc", label: "Organisation Structure Chart", inputType: "file", required: false, section: "business" },
  { field: "business_registration_doc", label: "Business Registration Document (Certificate of Incorporation or equivalent)", inputType: "file", required: false, section: "business" },
];

const fiSpecificFields = [
  { field: "has_licence", label: "Do you hold a licence or permit to operate?", inputType: "select", required: true, section: "fi", options: ["Yes", "No"] },
  { field: "regulatory_authority", label: "Regulatory Authority Name", inputType: "text", required: true, section: "fi", dependsOn: { has_licence: "Yes" } },
  { field: "licence_number", label: "Licence Number", inputType: "text", required: true, section: "fi", dependsOn: { has_licence: "Yes" } },
  { field: "no_licence_reason", label: "If no licence, please explain why one is not required", inputType: "textarea", required: true, section: "fi", dependsOn: { has_licence: "No" } },
  { field: "has_branches", label: "Do you have physical branches or office locations?", inputType: "select", required: true, section: "fi", options: ["Yes", "No"] },
  { field: "branch_count", label: "How many branches?", inputType: "text", required: true, section: "fi", dependsOn: { has_branches: "Yes" } },
  { field: "branch_countries", label: "Where are your main offices located? (multi)", inputType: "text", required: true, section: "fi", dependsOn: { has_branches: "Yes" } },
  { field: "services_other_fis", label: "Do you service other financial institutions?", inputType: "select", required: true, section: "fi", options: ["Yes", "No"] },
  { field: "cross_border_services", label: "Do you provide cross-border services?", inputType: "select", required: true, section: "fi", options: ["Yes", "No"] },
  { field: "accepts_cash", label: "Do you accept cash?", inputType: "select", required: true, section: "fi", options: ["Yes", "No"] },
  { field: "issues_prepaid_cards", label: "Do you issue prepaid cards?", inputType: "select", required: true, section: "fi", options: ["Yes", "No"] },
  { field: "non_resident_customers", label: "Do you have non-resident customers?", inputType: "select", required: true, section: "fi", options: ["Yes", "No"] },
  { field: "funds_from_outside", label: "Will you fund your Nium account from outside your incorporated country?", inputType: "select", required: true, section: "fi", options: ["Yes", "No"] },
  { field: "products_offered", label: "What products / services do you offer to your customers? (multi)", inputType: "select", required: true, section: "fi",
    options: ["Savings Accounts", "Checking Accounts", "Personal Banking", "Wallets", "Cross-Border Payment Services", "Prepaid Cards", "Other"] },
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

const fiDisclosureFields = [
  { field: "licence_suspended", label: "Has your business ever had a licence suspended or revoked?", inputType: "select", required: true, section: "disclosures", options: ["Yes", "No"] },
  { field: "licence_suspended_details", label: "Please provide details (status and resolution)", inputType: "textarea", required: true, section: "disclosures", dependsOn: { licence_suspended: "Yes" } },
  { field: "regulatory_action", label: "Has your business been subject to regulatory enforcement action?", inputType: "select", required: true, section: "disclosures", options: ["Yes", "No"] },
  { field: "regulatory_action_details", label: "Please provide details (status and resolution)", inputType: "textarea", required: true, section: "disclosures", dependsOn: { regulatory_action: "Yes" } },
  { field: "administration_proceedings", label: "Has your business ever been entered into administration proceedings?", inputType: "select", required: true, section: "disclosures", options: ["Yes", "No"] },
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

const fiBankFields = [
  { field: "account_currency", label: "Account Currency", inputType: "select", required: true, section: "bank",
    options: ["GBP", "USD", "EUR", "SGD", "AUD", "CAD", "HKD", "JPY", "NZD", "CHF", "SEK", "NOK", "DKK", "CNY", "INR", "MYR", "THB", "IDR", "PHP", "AED", "SAR", "BRL", "MXN", "ZAR", "TRY", "PLN"] },
  { field: "bank_account_name", label: "Bank Account Name", inputType: "text", required: true, section: "bank" },
  { field: "bank_name", label: "Bank Name", inputType: "text", required: true, section: "bank" },
  { field: "bank_account_number", label: "Bank Account Number", inputType: "text", required: true, section: "bank" },
  { field: "routing_type", label: "Routing Type", inputType: "select", required: true, section: "bank", options: ["Sort Code", "SWIFT/BIC", "IBAN", "ABA", "BSB", "IFSC"] },
  { field: "routing_value", label: "Routing Value", inputType: "text", required: true, section: "bank" },
  { field: "bank_country", label: "Bank Country", inputType: "text", required: true, section: "bank" },
];

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
  researchFields: fiBusinessResearchFields,
  gapFields: [
    ...fiBusinessGapFields,
    ...fiSpecificFields,
    ...fiStakeholderFields,
    ...fiDisclosureFields,
    ...fiUsageFields(n => "£" + n),
    ...fiBankFields,
    ...fiDocumentFields,
  ],
};

const SG_FI_SCHEMA = {
  label: "Singapore / Default (FI)",
  region: "SG",
  jurisdiction: "SG",
  researchFields: fiBusinessResearchFields,
  gapFields: [
    ...fiBusinessGapFields,
    ...fiSpecificFields,
    ...fiStakeholderFields,
    ...fiDisclosureFields,
    ...fiUsageFields(n => "SGD " + n),
    ...fiBankFields,
    ...fiDocumentFields,
  ],
};

const getSchema = (code, entityType) => {
  if (entityType === "FI") return code === "GB" ? UK_FI_SCHEMA : SG_FI_SCHEMA;
  if (entityType === "Platform") return SG_FI_SCHEMA;
  if (entityType === "Direct") return SG_SCHEMA;
  // Corporate (default)
  return LICENSED_MARKETS.includes(code) && code === "GB" ? UK_SCHEMA : SG_SCHEMA;
};
const getApplicableLicence = (code) => LICENSED_MARKETS.includes(code) ? code : "SG";

const buildPrompt = (name, country, countryCode, schema) => {
  const fieldList = schema.researchFields.map(f => `    {"field": "${f.field}", "label": "${f.label}", "value": "...", "source": "..."}`).join(",\n");
  const gapList = schema.gapFields.map(f => {
    let obj = `{"field": "${f.field}", "label": "${f.label}", "reason": "Not publicly available", "inputType": "${f.inputType}", "required": ${f.required}, "section": "${f.section}"`;
    if (f.options) obj += `, "options": ${JSON.stringify(f.options)}`;
    obj += "}";
    return "    " + obj;
  }).join(",\n");

  const countryAuthoritative = SOURCE_TRUST[countryCode] || [];
  const countryMatchesFramework = countryCode === "GB" || countryCode === "SG";
  const preferredLine = countryAuthoritative.length > 0
    ? `Preferred authoritative sources for ${country}: ${countryAuthoritative.slice(0, 8).join(", ")}.`
    : `No specific registry list provided for ${country} — use the country's national company registry, securities regulator, and tax authority.`;

  return `You are a KYC research agent for Nium.

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

Research "${name}" registered in ${country} using web search. Return ONLY valid JSON (no markdown, no backticks, no preamble).

{
  "companyName": "Official registered name",
  "jurisdiction": "${schema.region}",
  "countryOfRegistration": "${countryCode}",
  "found": [
${fieldList}
  ],
  "gaps": [
${gapList}
  ]
}

OUTPUT RULES:
- Only include a field in "found" if you have ACTUAL data with a real source. Omit fields you couldn't find rather than inventing values.
- The "source" field must be the actual ${country} authority/source you used (e.g. for India: "Ministry of Corporate Affairs (MCA)", "BSE", "RBI"; for Brazil: "Receita Federal", "CVM"). Never cite a foreign registry that wouldn't have data for ${country}.
- The "gaps" array must ALWAYS include ALL fields exactly as listed above.
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
  directors: "John Smith (UK), Jane Doe (UK), Mark Lee (SG)",
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
  publicly_listed: "No",
  listed_where: "—",
};

function StableInput({ id, label, type, value, onUpdate, required, options, placeholder }) {
  const ref = useRef(null);
  const [local, setLocal] = useState(value || "");
  useEffect(() => { setLocal(value || ""); }, [value]);
  const handleChange = useCallback((e) => { const v = e.target.value; setLocal(v); onUpdate(id, v); }, [id, onUpdate]);
  const sty = { width: "100%", padding: "10px 14px", borderRadius: 8, border: "1.5px solid rgba(26,58,74,0.14)", fontSize: 14, fontFamily: "inherit", color: "#1a3a4a", background: "#fff", outline: "none", boxSizing: "border-box" };
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#1a3a4a", marginBottom: 5 }}>{label} {required && <span style={{ color: "#d44" }}>*</span>}</label>
      {type === "select" ? (
        <select ref={ref} value={local} onChange={handleChange} style={{ ...sty, cursor: "pointer" }}>
          <option value="">Select...</option>
          {(options || []).map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : type === "textarea" ? (
        <textarea ref={ref} value={local} onChange={handleChange} placeholder={placeholder} rows={3} style={{ ...sty, resize: "vertical" }} />
      ) : type === "file" ? (
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
      ) : (
        <input ref={ref} type={type || "text"} value={local} onChange={handleChange} placeholder={placeholder} style={sty} />
      )}
    </div>
  );
}

export default function KYCAgent() {
  const [step, setStep] = useState(0);
  const [companyName, setCompanyName] = useState("");
  const [countryCode, setCountryCode] = useState("");
  const [entityType, setEntityType] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [research, setResearch] = useState(null);
  const [researchTimestamp, setResearchTimestamp] = useState("");
  const [checks, setChecks] = useState({});
  const [revealedTs, setRevealedTs] = useState({});
  const [secondaryConfirms, setSecondaryConfirms] = useState({});
  const gapRef = useRef({});
  // bumped whenever we mutate gapRef from outside the input (e.g. test-data fill)
  // so StableInput components re-sync from the new ref values.
  const [, setFormVersion] = useState(0);
  const [declared, setDeclared] = useState(false);
  const [done, setDone] = useState(false);
  const [device, setDevice] = useState({});
  const [loaderIdx, setLoaderIdx] = useState(0);
  const [submitTs, setSubmitTs] = useState("");
  const [activeSchema, setActiveSchema] = useState(null);

  useEffect(() => {
    if (!loading) return;
    const t = setInterval(() => setLoaderIdx(i => Math.min(i + 1, LOADER_MSGS.length - 1)), 2500);
    return () => clearInterval(t);
  }, [loading]);

  useEffect(() => {
    const fetchIP = async () => { try { const r = await fetch("https://api.ipify.org?format=json"); const d = await r.json(); return d.ip; } catch { return "Could not detect"; } };
    fetchIP().then(ip => setDevice({ ipAddress: ip, userAgent: navigator.userAgent, platform: navigator.platform, language: navigator.language, screenRes: window.screen.width + "x" + window.screen.height, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }));
  }, []);

  const countryObj = COUNTRIES.find(c => c.code === countryCode);

  // Fields referenced by any other field's dependsOn — when their value changes
  // we bump formVersion so conditional fields show/hide. Computed once per
  // schema change so text-field updates stay cheap.
  const parentFieldsRef = useRef(new Set());
  useEffect(() => {
    const s = new Set();
    if (activeSchema) {
      activeSchema.gapFields.forEach(f => {
        if (f.dependsOn) Object.keys(f.dependsOn).forEach(k => s.add(k));
      });
    }
    parentFieldsRef.current = s;
  }, [activeSchema]);

  const updateGap = useCallback((field, value) => {
    gapRef.current[field] = value;
    if (parentFieldsRef.current.has(field)) setFormVersion(v => v + 1);
  }, []);

  const dependsOnSatisfied = (g) => {
    if (!g.dependsOn) return true;
    return Object.entries(g.dependsOn).every(([k, v]) => gapRef.current[k] === v);
  };

  const resetAll = () => {
    setStep(0); setResearch(null); setActiveSchema(null);
    setChecks({}); setRevealedTs({}); setResearchTimestamp("");
    setSecondaryConfirms({});
    gapRef.current = {}; setFormVersion(v => v + 1);
    setError(""); setDeclared(false);
  };

  const fillTestData = () => {
    const newConfirms = { ...secondaryConfirms };
    getCombinedGaps().forEach(g => {
      if (g.section === "secondary") newConfirms[g.field] = true;
      const current = gapRef.current[g.field];
      if (current && String(current).trim().length > 0) return;
      let val = TEST_DATA[g.field];
      if (val === undefined && g.field.startsWith("corrected_")) {
        const original = g.field.replace(/^corrected_/, "");
        val = TEST_DATA[original] || "Corrected value";
      }
      if (val === undefined && g.field.startsWith("secondary_")) {
        val = g.originalValue || "Sample value";
      }
      if (val === undefined) {
        val = g.inputType === "select" && g.options && g.options.length > 0 ? g.options[0] : "Sample value";
      }
      gapRef.current[g.field] = val;
    });
    setSecondaryConfirms(newConfirms);
    setFormVersion(v => v + 1);
  };

  const getCombinedGaps = () => {
    if (!research || !activeSchema) return [];
    const apiGaps = research.gaps || activeSchema.gapFields;
    // Authoritative items the user unchecked → corrections.
    // Secondary items are NOT shown as checkboxes on Step 2, so they
    // never enter the corrections flow — they go straight to the
    // "secondary" section below.
    const unchecked = (research.found || [])
      .filter((item, i) => item.trust !== "secondary" && !checks[i])
      .map(item => ({
        field: "corrected_" + item.field, label: item.label + " (correction needed)",
        reason: "Original: " + item.value, inputType: "text", required: true, section: "corrections"
      }));
    const secondary = (research.found || [])
      .filter(item => item.trust === "secondary")
      .map(item => ({
        field: "secondary_" + item.field, label: item.label,
        inputType: "text", required: true, section: "secondary",
        source: item.source, originalValue: item.value,
      }));
    return [...unchecked, ...secondary, ...apiGaps];
  };

  const allGapsFilled = () => getCombinedGaps().filter(g => g.required).every(g => {
    if (!dependsOnSatisfied(g)) return true;
    const v = gapRef.current[g.field];
    if (!v || !String(v).trim()) return false;
    if (g.section === "secondary" && !secondaryConfirms[g.field]) return false;
    return true;
  });

  const doResearch = async () => {
    if (!companyName.trim()) { setError("Please enter a company name."); return; }
    if (!entityType) { setError("Please select an entity type."); return; }
    if (!countryCode) { setError("Please select a country."); return; }
    setError("");
    const schema = getSchema(countryCode, entityType);
    setActiveSchema(schema);
    setLoading(true); setStep(1); setLoaderIdx(0);
    try {
      // ═══ CALLING OUR BACKEND PROXY, NOT CLAUDE DIRECTLY ═══
      const resp = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: buildPrompt(companyName, countryObj ? countryObj.name : countryCode, countryCode, schema)
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
      const slice = text.slice(si, ei + 1);
      let parsed;
      try {
        parsed = JSON.parse(slice);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error("Raw research response (could not parse):", text);
        throw new Error(`Response was not valid JSON (${e.message}). Likely the model hit max_tokens — see browser console for the full response.`);
      }
      const found = (parsed.found || []).map(item => ({
        ...item,
        trust: classifySource(item.source, countryCode),
      }));
      const tagged = { ...parsed, found };
      setResearch(tagged);
      setResearchTimestamp(new Date().toISOString());
      // Pre-check authoritative items; leave secondary unchecked on Step 2.
      // (Secondary items render on Step 3 as pre-filled inputs to confirm.)
      const c = {};
      found.forEach((item, i) => { c[i] = item.trust === "authoritative"; });
      setChecks(c);
      setRevealedTs({});
      gapRef.current = {};
      // Pre-populate secondary items into the gap form so the user can edit.
      found.forEach(item => {
        if (item.trust === "secondary") {
          gapRef.current["secondary_" + item.field] = item.value;
        }
      });
      setSecondaryConfirms({});
      setFormVersion(v => v + 1);
      setStep(2);
    } catch (err) { setError("Research failed: " + err.message); setStep(0); }
    finally { setLoading(false); }
  };

  // Bypasses /api/research and synthesises a plausible result using
  // DUMMY_RESEARCH_VALUES + the selected country's authoritative source list.
  // Sprinkles a couple of secondary-source rows so Step 3's "Pre-filled —
  // Please Confirm" section is also exercised.
  const doDummyResearch = async () => {
    if (!companyName.trim()) { setError("Please enter a company name."); return; }
    if (!entityType) { setError("Please select an entity type."); return; }
    if (!countryCode) { setError("Please select a country."); return; }
    setError("");
    const schema = getSchema(countryCode, entityType);
    setActiveSchema(schema);
    setLoading(true); setStep(1); setLoaderIdx(0);

    // Hold the loader briefly so the animation is visible.
    await new Promise(r => setTimeout(r, 3000));

    const authPattern = (SOURCE_TRUST[countryCode] || ["public registry"])[0];
    const authSource = authPattern.replace(/\b\w/g, c => c.toUpperCase());
    const secondarySources = ["Wikipedia", "LinkedIn", "Company website"];

    const found = schema.researchFields.map((f, i) => {
      // Make ~1 in 4 tier-2 fields look like they came from a secondary source
      const isSecondary = f.tier === 2 && i % 4 === 0;
      const source = isSecondary ? secondarySources[i % secondarySources.length] : authSource;
      const value = DUMMY_RESEARCH_VALUES[f.field] || ("Sample " + f.label);
      return {
        field: f.field,
        label: f.label,
        value,
        source,
        trust: classifySource(source, countryCode),
      };
    });

    const tagged = {
      companyName,
      jurisdiction: schema.region,
      countryOfRegistration: countryCode,
      found,
      gaps: schema.gapFields.map(f => ({ ...f, reason: "Not publicly available" })),
    };
    setResearch(tagged);
    setResearchTimestamp(new Date().toISOString());

    const c = {};
    found.forEach((item, i) => { c[i] = item.trust === "authoritative"; });
    setChecks(c);
    setRevealedTs({});
    gapRef.current = {};
    found.forEach(item => {
      if (item.trust === "secondary") {
        gapRef.current["secondary_" + item.field] = item.value;
      }
    });
    setSecondaryConfirms({});
    setFormVersion(v => v + 1);
    setLoading(false);
    setStep(2);
  };

  const card = { background: "rgba(255,255,255,0.95)", borderRadius: 14, border: "1px solid rgba(26,58,74,0.06)", boxShadow: "0 4px 20px rgba(26,58,74,0.05)", padding: "24px 28px", marginBottom: 16 };
  const Btn = ({ children, onClick, variant, disabled }) => {
    const base = { padding: "12px 26px", borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: disabled ? "not-allowed" : "pointer", fontFamily: "inherit", opacity: disabled ? 0.4 : 1, border: "none" };
    const v = { primary: { ...base, background: "#1a3a4a", color: "#fff" }, secondary: { ...base, background: "transparent", color: "#1a3a4a", border: "2px solid #1a3a4a" }, green: { ...base, background: "#4a9e8e", color: "#fff" } };
    return <button style={v[variant] || v.primary} onClick={disabled ? undefined : onClick}>{children}</button>;
  };

  const stepNames = ["Input", "Research", "Confirm", "Fill Gaps", "Declare"];
  const sectionConfig = {
    corrections: { title: "Corrections Required", icon: "🔄", sub: "You unchecked these fields — please provide correct values", twoCol: true },
    secondary: { title: "Pre-filled — Please Confirm", icon: "🔍", sub: "Found on secondary sources (Wikipedia, LinkedIn, news, corporate website). Edit if wrong, then tick to confirm each one is correct.", twoCol: false },
    applicant: { title: "Applicant Details", icon: "👤", sub: "Person authorised to submit this application", twoCol: true },
    business: { title: "Business Details", icon: "🏢", sub: "Confirm and complete business information", twoCol: true },
    nature: { title: "Nature & Size of Business", icon: "🏢", sub: "Business activity and size details", twoCol: true },
    fi: { title: "FI Specific Questions", icon: "🏦", sub: "Licensing, services, and customer profile", twoCol: false },
    stakeholders: { title: "Stakeholders & Transaction Mix", icon: "👥", sub: "Directors, UBOs, signatories and payment-mix breakdown", twoCol: true },
    disclosures: { title: "Corporate Disclosures", icon: "📋", sub: "Past regulatory or legal events", twoCol: false },
    account: { title: "Expected Account Usage", icon: "💰", sub: "Transaction volumes, purpose, and source of funds", twoCol: false },
    usage: { title: "Account Usage & Volumes", icon: "💰", sub: "Expected transaction volumes and counterparties", twoCol: true },
    bank: { title: "Bank Account Details", icon: "🏦", sub: "Settlement account for transactions", twoCol: true },
    documents: { title: "Additional Documents", icon: "📄", sub: "Upload supporting documentation", twoCol: false },
  };

  const renderGapSection = (sectionKey) => {
    const items = getCombinedGaps()
      .filter(g => g.section === sectionKey)
      .filter(dependsOnSatisfied);
    if (items.length === 0) return null;
    const cfg = sectionConfig[sectionKey] || { title: sectionKey, icon: "📋", sub: "", twoCol: false };

    if (sectionKey === "secondary") {
      return (
        <div style={card} key={sectionKey}>
          <h3 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 4px" }}>{cfg.icon} {cfg.title}</h3>
          <p style={{ fontSize: 12, color: "#1a3a4a60", margin: "0 0 14px" }}>{cfg.sub}</p>
          {items.map(g => {
            const confirmed = !!secondaryConfirms[g.field];
            return (
              <div key={g.field} style={{ marginBottom: 14, padding: "12px 14px", borderRadius: 10, background: confirmed ? "#f0f9f6" : "#fff8ed", border: `1.5px solid ${confirmed ? "#4a9e8e" : "#e0a040"}` }}>
                <StableInput id={g.field} label={g.label} type={g.inputType} value={gapRef.current[g.field] || ""} onUpdate={updateGap} required={g.required} placeholder={"Enter " + g.label.toLowerCase()} />
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginTop: -4 }}>
                  <span style={{ fontSize: 11, color: "#1a3a4a90", fontStyle: "italic" }}>📌 Source: {g.source || "Unknown"} <span style={{ color: "#b07d10", fontWeight: 600, fontStyle: "normal" }}>· Unverified</span></span>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 12, fontWeight: 700, color: confirmed ? "#1a6b56" : "#b07d10" }}>
                    <input
                      type="checkbox"
                      checked={confirmed}
                      onChange={(e) => setSecondaryConfirms(p => ({ ...p, [g.field]: e.target.checked }))}
                      style={{ width: 15, height: 15, cursor: "pointer", accentColor: "#4a9e8e" }}
                    />
                    {confirmed ? "Confirmed" : "Tick to confirm correct"}
                  </label>
                </div>
              </div>
            );
          })}
        </div>
      );
    }

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

  const jurisdictionBadge = activeSchema ? (
    <span style={{ display: "inline-block", padding: "3px 10px", borderRadius: 20, fontSize: 10, fontWeight: 700, letterSpacing: "0.05em", background: activeSchema.region === "UK" ? "#1a3a4a" : "#4a9e8e", color: "#fff", marginLeft: 8 }}>
      {activeSchema.region === "UK" ? "🇬🇧 UK Licence" : "🇸🇬 SG Licence"}
    </span>
  ) : null;

  const entityBadge = entityType ? (
    <span style={{ display: "inline-block", padding: "3px 10px", borderRadius: 20, fontSize: 10, fontWeight: 700, letterSpacing: "0.05em", background: "#e0a040", color: "#fff", marginLeft: 8 }}>
      {entityType}
    </span>
  ) : null;

  const tierOf = (item) => {
    const def = activeSchema && activeSchema.researchFields.find(f => f.field === item.field);
    return def && def.tier === 2 ? 2 : 1;
  };

  const renderFoundTable = (items, title, subtitle) => (
    <div style={card}>
      <h3 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 4px" }}>{title}</h3>
      <p style={{ fontSize: 11, color: "#1a3a4a70", margin: "0 0 12px" }}>{subtitle}</p>
      <div style={{ display: "grid", gridTemplateColumns: "30px 1fr 1.5fr 1fr", gap: 8, padding: "8px 10px", background: "#1a3a4a", borderRadius: "8px 8px 0 0" }}>
        {["✓", "FIELD", "VALUE", "SOURCE"].map(h => <span key={h} style={{ fontSize: 10, fontWeight: 700, color: "#fff" }}>{h}</span>)}
      </div>
      {items.map(({ item, idx }) => (
        <div key={item.field + idx} style={{ display: "grid", gridTemplateColumns: "30px 1fr 1.5fr 1fr", gap: 8, padding: "9px 10px", background: idx % 2 === 0 ? "#fafcfb" : "#fff", borderBottom: "1px solid rgba(26,58,74,0.04)", opacity: checks[idx] ? 1 : 0.3 }}>
          <input type="checkbox" checked={!!checks[idx]} onChange={() => setChecks(p => ({ ...p, [idx]: !p[idx] }))} style={{ width: 15, height: 15, cursor: "pointer", accentColor: "#4a9e8e" }} />
          <span style={{ fontSize: 11, fontWeight: 600 }}>{item.label}</span>
          <span style={{ fontSize: 11, wordBreak: "break-word" }}>{item.value}</span>
          <span
            onClick={() => setRevealedTs(p => ({ ...p, [idx]: !p[idx] }))}
            title={revealedTs[idx] ? "Click to hide timestamp" : "Click to show fetch timestamp"}
            style={{ fontSize: 10, color: "#4a9e8e", fontStyle: "italic", cursor: "pointer", textDecoration: "underline dotted", textUnderlineOffset: 2 }}
          >
            {revealedTs[idx] ? `🕒 ${researchTimestamp}` : item.source}
          </span>
        </div>
      ))}
    </div>
  );

  const authFound = (research?.found || []).map((item, idx) => ({ item, idx })).filter(x => x.item.trust !== "secondary");
  const tier1Items = authFound.filter(x => tierOf(x.item) === 1);
  const tier2Items = authFound.filter(x => tierOf(x.item) === 2);
  const secondaryCount = (research?.found || []).filter(item => item.trust === "secondary").length;

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(170deg, #f4f8f7 0%, #eaeff4 50%, #f7f4f0 100%)", fontFamily: "'DM Sans','Segoe UI',system-ui,sans-serif", color: "#1a3a4a" }}>
      <div style={{ maxWidth: 780, margin: "0 auto", padding: "24px 16px 60px" }}>

        <div style={{ textAlign: "center", marginBottom: 8 }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase", color: "#4a9e8e", marginBottom: 4 }}>Nium Compliance</div>
          <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>KYC Onboarding Agent</h1>
          <p style={{ fontSize: 12, color: "#1a3a4a80", margin: "4px 0 0" }}>AI-powered multi-jurisdiction company research and data collection</p>
        </div>

        <div style={{ display: "flex", justifyContent: "center", gap: 6, marginBottom: 24, flexWrap: "wrap" }}>
          {stepNames.map((s, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 28, height: 28, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, background: i < step ? "#4a9e8e" : i === step ? "#1a3a4a" : "#e0e4e8", color: i <= step ? "#fff" : "#999", boxShadow: i === step ? "0 0 0 3px rgba(74,158,142,0.2)" : "none" }}>{i + 1}</div>
              <span style={{ fontSize: 11, fontWeight: i === step ? 700 : 400, color: i <= step ? "#1a3a4a" : "#aaa" }}>{s}</span>
              {i < 4 && <div style={{ width: 14, height: 2, background: i < step ? "#4a9e8e" : "#e0e4e8" }} />}
            </div>
          ))}
        </div>

        {step === 0 && (
          <div style={card}>
            <h2 style={{ fontSize: 17, fontWeight: 700, margin: "0 0 4px" }}>Company Lookup</h2>
            <p style={{ fontSize: 13, color: "#1a3a4a70", margin: "0 0 20px" }}>Enter the company name and country. The agent will use <strong>jurisdiction-specific requirements</strong> (UK or SG/default) to drive the research and gap collection.</p>
            <StableInput id="companyName" label="Company Legal Name" type="text" value={companyName} onUpdate={(_, v) => setCompanyName(v)} required placeholder="e.g. Tesco PLC, DBS Group Holdings" />
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#1a3a4a", marginBottom: 5 }}>Entity Type <span style={{ color: "#d44" }}>*</span></label>
              <select value={entityType} onChange={e => setEntityType(e.target.value)} style={{ width: "100%", padding: "10px 14px", borderRadius: 8, border: "1.5px solid rgba(26,58,74,0.14)", fontSize: 14, fontFamily: "inherit", color: "#1a3a4a", background: "#fff", cursor: "pointer", boxSizing: "border-box" }}>
                <option value="">Select entity type...</option>
                <option value="FI">FI</option>
                <option value="Platform">Platform</option>
                <option value="Direct">Direct</option>
                <option value="Corporate">Corporate</option>
              </select>
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#1a3a4a", marginBottom: 5 }}>Registered Country <span style={{ color: "#d44" }}>*</span></label>
              <select value={countryCode} onChange={e => setCountryCode(e.target.value)} style={{ width: "100%", padding: "10px 14px", borderRadius: 8, border: "1.5px solid rgba(26,58,74,0.14)", fontSize: 14, fontFamily: "inherit", color: "#1a3a4a", background: "#fff", cursor: "pointer", boxSizing: "border-box" }}>
                <option value="">Select country...</option>
                {COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.code} — {c.name}</option>)}
              </select>
            </div>
            {countryCode && (() => {
              const lic = getApplicableLicence(countryCode);
              const isLicensed = LICENSED_MARKETS.includes(countryCode);
              const isFiFlow = entityType === "FI" || entityType === "Platform";
              const routesNote = entityType === "Platform" || entityType === "Direct"
                ? ` (${entityType} routes to ${isFiFlow ? "FI" : "Corporate"} schema)`
                : "";
              return (
                <div style={{ padding: "10px 14px", borderRadius: 8, background: isLicensed ? "#f0f3f8" : "#fff8ed", fontSize: 12, marginBottom: 14, borderLeft: isLicensed ? "3px solid #1a3a4a" : "3px solid #e0a040" }}>
                  <div style={{ marginBottom: 4 }}><strong>🌍 Researching in:</strong> {countryObj?.name} ({countryCode})</div>
                  <div><strong>📋 Applicable licence:</strong> {lic === "GB" ? "🇬🇧 United Kingdom (FCA)" : "🇸🇬 Singapore (MAS) — default for non-licensed markets"}</div>
                  {entityType && (
                    <div style={{ marginTop: 4 }}><strong>📑 Form set:</strong> {isFiFlow ? "FI version" : "Corporate version"}{routesNote}</div>
                  )}
                  {!isLicensed && <div style={{ marginTop: 4, fontStyle: "italic", color: "#9d6500" }}>Nium has no licence in {countryObj?.name}, so this customer is onboarded under the Singapore licence. Public records will be searched in {countryObj?.name}, but SG requirements apply.</div>}
                </div>
              );
            })()}
            {error && <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#dc2626", marginBottom: 14 }}>{error}</div>}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
              <Btn onClick={doDummyResearch} variant="secondary">🧪 Dummy Research (skip API)</Btn>
              <Btn onClick={doResearch} variant="primary">🔍 Research Company</Btn>
            </div>
          </div>
        )}

        {step === 1 && (
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
            <div style={{ fontSize: 13, color: "#4a9e8e", fontStyle: "italic", marginBottom: 22, minHeight: 18 }}>
              {LOADER_MSGS[loaderIdx]}
            </div>

            <div style={{ width: "100%", maxWidth: 420, height: 6, background: "rgba(74,158,142,0.12)", borderRadius: 3, overflow: "hidden", margin: "0 auto 18px" }}>
              <div style={{
                width: `${((loaderIdx + 1) / LOADER_MSGS.length) * 100}%`,
                height: "100%",
                background: "linear-gradient(90deg,#4a9e8e,#1a3a4a)",
                transition: "width 0.6s ease",
              }} />
            </div>

            <div style={{ display: "flex", justifyContent: "center", gap: 7, flexWrap: "wrap" }}>
              {LOADER_MSGS.map((_, i) => (
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

        {step === 2 && research && (
          <div>
            <div style={card}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: "linear-gradient(135deg,#4a9e8e,#3a8e7e)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>✅</div>
                <div>
                  <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>{research.companyName || companyName} {jurisdictionBadge}{entityBadge}</h2>
                  <p style={{ fontSize: 12, color: "#1a3a4a70", margin: 0 }}>{(research.found || []).length} fields found · {(research.gaps || activeSchema.gapFields || []).length} gaps identified</p>
                </div>
              </div>
              <div style={{ background: "#f0f9f6", borderRadius: 8, padding: "12px 16px", fontSize: 13, color: "#1a6b56", borderLeft: "4px solid #4a9e8e" }}>
                Below: data found from <strong>authoritative sources</strong> (registries, regulators, exchanges). Uncheck anything wrong — it'll appear on the next page for correction. Click any source to reveal when it was fetched.
                {secondaryCount > 0 && (
                  <div style={{ marginTop: 8, padding: "8px 12px", background: "#fff8ed", borderRadius: 6, color: "#b07d10", borderLeft: "3px solid #e0a040" }}>
                    ⚠️ {secondaryCount} additional field{secondaryCount === 1 ? "" : "s"} found on <strong>secondary sources</strong> (Wikipedia, LinkedIn, news, corporate website) — you'll review and confirm those on the next page.
                  </div>
                )}
              </div>
            </div>

            {tier1Items.length > 0 && renderFoundTable(tier1Items, "Tier 1 — Identity & Registration", "Public-registry data: legal name, registration number, address, business type.")}
            {tier2Items.length > 0 && renderFoundTable(tier2Items, "Tier 2 — Enrichment & Risk", "Ownership, directors, financials, listings, PEP status.")}

            {(research.found || []).filter((item, i) => item.trust !== "secondary" && !checks[i]).length > 0 && (
              <div style={{ marginBottom: 16, padding: "10px 14px", background: "#fff8ed", borderRadius: 6, fontSize: 12, color: "#b07d10", borderLeft: "3px solid #e0a040" }}>
                ⚠️ {(research.found || []).filter((item, i) => item.trust !== "secondary" && !checks[i]).length} field(s) unchecked — will appear on next page for correction.
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <Btn variant="secondary" onClick={resetAll}>← Start Over</Btn>
              <Btn variant="green" onClick={() => { setStep(3); setError(""); }}>Confirm and Continue →</Btn>
            </div>
          </div>
        )}

        {step === 3 && research && activeSchema && (
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
            {["corrections", "secondary", "applicant", "business", "nature", "fi", "stakeholders", "disclosures", "account", "usage", "bank", "documents"].map(s => renderGapSection(s))}

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
              <Btn variant="secondary" onClick={() => setStep(2)}>← Back to Review</Btn>
              <Btn variant="primary" onClick={() => { if (allGapsFilled()) { setStep(4); setError(""); } else setError("Please fill all required fields."); }}>Continue to Declaration →</Btn>
            </div>
            {error && step === 3 && <div style={{ marginTop: 8, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#dc2626" }}>{error}</div>}
          </div>
        )}

        {step === 4 && !done && (
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
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <Btn variant="secondary" onClick={() => setStep(3)}>← Back</Btn>
              <Btn variant="green" onClick={() => { setSubmitTs(new Date().toISOString()); setDone(true); }} disabled={!declared}>✓ Submit Application</Btn>
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
              {[
                ["Company", research?.companyName || companyName],
                ["Jurisdiction", activeSchema?.region === "UK" ? "United Kingdom" : "Singapore / Default"],
                ["Pre-filled (authoritative)", (research?.found || []).filter((item, i) => item.trust !== "secondary" && checks[i]).length + " confirmed"],
                ["Corrected", (research?.found || []).filter((item, i) => item.trust !== "secondary" && !checks[i]).length + " manually fixed"],
                ["Secondary-source", (research?.found || []).filter(item => item.trust === "secondary").length + " reviewed & confirmed"],
                ["Manual fields", Object.keys(gapRef.current).length + " provided"],
                ["Applicant", (gapRef.current.applicantFirstName || "") + " " + (gapRef.current.applicantLastName || "")],
                ["Declared at", submitTs.replace("T", " ").slice(0, 19) + " UTC"],
                ["IP Address", device.ipAddress],
              ].map(([k, v]) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid rgba(26,58,74,0.04)", fontSize: 12 }}>
                  <span style={{ fontWeight: 600 }}>{k}</span><span style={{ color: "#1a3a4a90" }}>{v}</span>
                </div>
              ))}
            </div>
            <Btn variant="secondary" onClick={() => { setCompanyName(""); setCountryCode(""); setEntityType(""); setDone(false); setSubmitTs(""); resetAll(); }}>Start New Application</Btn>
          </div>
        )}

      </div>
    </div>
  );
}
