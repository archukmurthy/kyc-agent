// Seed schema definitions used by api/config.js when initialising a fresh
// tenant config. These mirror the hardcoded schemas in src/App.js — both
// must stay in sync. The App.js copy is the offline fallback when the
// config API is unreachable; this copy is the source of truth that gets
// written into KV / storage on first read.

const VOLUME_OPTIONS = [
  "Under 10,000",
  "10,000 - 50,000",
  "50,000 - 250,000",
  "250,000 - 1,000,000",
  "1,000,000 - 5,000,000",
  "Over 5,000,000",
];

const accountSection = (currencyLabel) => [
  { field: "creditMonthlyVolume", label: `Expected Monthly Credit Volume (${currencyLabel})`, inputType: "select", required: true, section: "account", options: VOLUME_OPTIONS },
  { field: "creditTopCountries", label: "Top Credit Transaction Countries", inputType: "text", required: true, section: "account" },
  { field: "debitMonthlyVolume", label: `Expected Monthly Debit Volume (${currencyLabel})`, inputType: "select", required: true, section: "account", options: VOLUME_OPTIONS },
  { field: "debitTopCountries", label: "Top Debit Transaction Countries", inputType: "text", required: true, section: "account" },
  { field: "intendedUses", label: "Intended Use of Account", inputType: "textarea", required: true, section: "account" },
  { field: "sourceOfFunds", label: "Source of Funds", inputType: "textarea", required: false, section: "account" },
];

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
    ...accountSection("SGD"),
  ],
};

const fiResearchFields = [
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
  { field: "employee_count", label: "Number of Employees", tier: 2, section: "business_activity", searchHint: "Number of employees — check annual report, LinkedIn, or Companies House accounts" },
  { field: "annual_turnover", label: "Annual Turnover", tier: 2, section: "business_activity", searchHint: "Annual revenue/turnover band — check annual report or Companies House accounts" },
  { field: "operating_countries", label: "Operating Countries", tier: 2, section: "business_activity", searchHint: "Countries where the company operates — check annual report geographic breakdown" },
  { field: "payout_transaction_countries", label: "Payout Transaction Countries", tier: 2, section: "business_activity", searchHint: "Countries the company sends payments to — check annual report" },
  { field: "industry_sector", label: "Industry Sector (multi)", tier: 1, section: "business_activity", searchHint: "Primary industry sector — check Companies House SIC code and annual report" },
  { field: "publicly_listed", label: "Publicly Listed", tier: 2, section: "business_activity", searchHint: "Is the company or its parent listed on a stock exchange? Check LSE, NYSE, SGX" },
  { field: "listed_where", label: "Listed Exchanges", tier: 2, section: "business_activity", searchHint: "Which stock exchange? Check LSE, annual report" },
  { field: "has_licence", label: "Do you hold a licence or permit to operate?", tier: 1, section: "regulatory", searchHint: "Does the company hold a financial services licence? Check FCA register (register.fca.org.uk), MAS directory, or equivalent regulatory database for the country" },
  { field: "regulatory_authority", label: "Regulatory Authority Name", tier: 1, section: "regulatory", searchHint: "Which regulatory authority? e.g. FCA, MAS, ASIC, SEC — check official regulatory register" },
  { field: "licence_number", label: "Licence Number", tier: 1, section: "regulatory", searchHint: "FCA FRN or equivalent licence number — check FCA register or MAS directory" },
  { field: "has_branches", label: "Do you have physical branches or office locations?", tier: 2, section: "operations", searchHint: "Does the company have physical branches or offices? Check annual report" },
  { field: "branch_count", label: "How many branches?", tier: 2, section: "operations", searchHint: "How many branches — check annual report" },
  { field: "branch_countries", label: "Where are your main offices located? (multi)", tier: 2, section: "operations", searchHint: "Countries with offices — check annual report" },
  { field: "services_other_fis", label: "Do you service other financial institutions?", tier: 2, section: "operations", searchHint: "Does the company provide services to other financial institutions? Check annual report" },
  { field: "cross_border_services", label: "Do you provide cross-border services?", tier: 2, section: "operations", searchHint: "Does the company provide cross-border payment services? Check annual report and website" },
  { field: "issues_prepaid_cards", label: "Do you issue prepaid cards?", tier: 2, section: "operations", searchHint: "Does the company issue prepaid cards? Check annual report and website" },
  { field: "non_resident_customers", label: "Do you have non-resident customers?", tier: 2, section: "operations", searchHint: "Does the company serve non-resident or international customers? Check annual report" },
  { field: "products_offered", label: "What products / services do you offer to your customers? (multi)", tier: 2, section: "operations", searchHint: "What products and services does the company offer? Check annual report and website" },
  { field: "director_names", label: "Directors / Officers", tier: 2, section: "ownership", searchHint: "Names and roles of directors — check Companies House officers section or equivalent registry" },
  { field: "ubo_parent_company", label: "UBO / Parent Company", tier: 2, section: "ownership", searchHint: "Ultimate beneficial owner or parent company — check Companies House PSC register or equivalent" },
  { field: "ubo_share_percentage", label: "UBO Share Percentage", tier: 2, section: "ownership", searchHint: "Ownership percentage — check Companies House PSC register" },
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

const fiDisclosureFields = [
  { field: "licence_suspended_details", label: "Please provide details (status and resolution)", inputType: "textarea", required: true, section: "disclosures", dependsOn: { licence_suspended: "Yes" } },
  { field: "regulatory_action", label: "Has your business been subject to regulatory enforcement action?", inputType: "select", required: true, section: "disclosures", options: ["Yes", "No"] },
  { field: "regulatory_action_details", label: "Please provide details (status and resolution)", inputType: "textarea", required: true, section: "disclosures", dependsOn: { regulatory_action: "Yes" } },
  { field: "administration_details", label: "Please provide details (status and resolution)", inputType: "textarea", required: true, section: "disclosures", dependsOn: { administration_proceedings: "Yes" } },
  { field: "directors_convicted", label: "Have any owners or directors been convicted of any crime?", inputType: "select", required: true, section: "disclosures", options: ["Yes", "No"] },
  { field: "directors_convicted_details", label: "Please provide details", inputType: "textarea", required: true, section: "disclosures", dependsOn: { directors_convicted: "Yes" } },
];

const fiUsageFields = (fmt) => {
  const volumeOpts = [
    `${fmt("1")}–${fmt("100,000")}`,
    `${fmt("100,001")}–${fmt("250,000")}`,
    `${fmt("250,001")}–${fmt("500,000")}`,
    `${fmt("500,001")}–${fmt("800,000")}`,
    `Over ${fmt("800,000")}`,
  ];
  const avgTxOpts = [
    `Under ${fmt("1,000")}`,
    `${fmt("1,001")}–${fmt("10,000")}`,
    `${fmt("10,001")}–${fmt("20,000")}`,
    `${fmt("20,001")}–${fmt("50,000")}`,
    `${fmt("50,001")}–${fmt("100,000")}`,
    `${fmt("100,001")}–${fmt("300,000")}`,
    `${fmt("300,001")}–${fmt("600,000")}`,
    `${fmt("600,001")}–${fmt("1,000,000")}`,
    `Over ${fmt("1,000,000")}`,
  ];
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
    ...fiUsageFields((n) => "£" + n),
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
    ...fiUsageFields((n) => "SGD " + n),
    ...fiDocumentFields,
  ],
};

module.exports = { UK_SCHEMA, SG_SCHEMA, UK_FI_SCHEMA, SG_FI_SCHEMA };
