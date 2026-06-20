// fi-schema-fields-patch.js
// -----------------------------------------------------------------------------
// Field definitions for the FI / corporate onboarding schema, matching the
// existing licence-field format (field key, label, tier, searchHint).
//
// THREE GROUPS:
//   1. researchable      -> tier 1/2, with a searchHint. Counted in the
//                           researchable denominator. Agent attempts to fill.
//   2. researchable-list -> findable list, but a sub-part (the % split) is NOT
//                           public. Agent fills the list, leaves % to customer.
//   3. customerSupplied  -> forward-looking / private / declaration fields.
//                           NO searchHint. EXCLUDED from the researchable
//                           denominator so they don't depress pre-fill rate.
//
// The `customerSupplied: true` flag is the important structural addition: it
// tells the benchmark which fields belong to the "human half" of the form so
// researchable-field coverage and form pre-fill rate are computed against the
// right denominators.
// -----------------------------------------------------------------------------

// ----------------------------------------------------------------------------
// GROUP 1 — RESEARCHABLE (tier 1/2, agent attempts fill)
// ----------------------------------------------------------------------------

const researchableFields = [
  {
    field: "vat_number",
    label: "VAT Number",
    tier: 2,
    searchHint:
      "VAT / tax registration number. Check the company website footer, terms and invoicing pages. Validate format against HMRC VAT checker (GB) or EU VIES (vies.ec.europa.eu). This is distinct from the company registration number — do not reuse the Companies House / registry number here.",
  },
  {
    field: "additional_urls",
    label: "Additional URLs / Linked Websites",
    tier: 2,
    searchHint:
      "Any additional domains beyond the primary website: regional/country sites, separate brand or product sites, subsidiary sites, and app-store listings operated by the entity or its group. Check the main website footer and any 'our brands' / 'our companies' / 'group' pages.",
  },
  {
    field: "is_business_address_same_as_registered",
    label: "Is your business address the same as your registered address?",
    tier: 1,
    searchHint:
      "Compare the registered address (from the company registry) with the principal place of business / head-office / contact address shown on the company website's contact page. Set 'No' only where a clearly different principal operating address is stated; otherwise 'Yes'. For most large entities the head office and registered office are the same.",
  },
  {
    field: "regulatory_enforcement_action",
    label: "Has your business been subject to regulatory enforcement action?",
    tier: 1,
    searchHint:
      "Check the relevant regulator's enforcement / final-notices pages (e.g. FCA fca.org.uk/news/enforcement-actions, MAS enforcement actions, ASIC, SEC) and reputable news for fines, monetary penalties, Voluntary Requirements (VREQs), business restrictions, censures or sanctions against the entity. Broader than licence suspension — capture monetary penalties and supervisory/enforcement actions even where the licence was not suspended. Yes/No, with detail where found.",
  },
  {
    field: "individual_customer_pct",
    label: "Individual Customers %",
    tier: 2,
    searchHint:
      "Estimate the retail/individual vs corporate customer mix from segment reporting in the annual report (Retail/Personal Banking vs Commercial/Corporate & Institutional divisions). NOTE this is a revenue/asset split, not a customer-count split — flag the basis. Digital retail banks skew heavily individual; wholesale-tilted banks skew corporate. Mark indicative; pair with corporate_customer_pct so the two sum to ~100.",
  },
  {
    field: "corporate_customer_pct",
    label: "Corporate Customers %",
    tier: 2,
    searchHint:
      "See individual_customer_pct — derive the complementary figure from the same annual-report segment reporting. Revenue/asset basis, not customer count; flag the basis. Mark indicative.",
  },
  {
    field: "top_corporate_industries",
    label: "Top 5 industries your corporate customers operate in (multi)",
    tier: 2,
    searchHint:
      "For large disclosed banks, use the credit-risk / loan-exposure-by-industry-sector breakdown in the annual report risk-management notes or the Pillar 3 report (often NACE/SIC groupings) as a ranked proxy. Strategy decks naming 'focus sectors' are marketing, not exposure data — prefer the risk disclosures. Not findable for smaller or private FIs; leave blank if no disclosure. Mark indicative.",
  },
  {
    field: "deals_virtual_currencies",
    label: "Do you deal with virtual currencies (crypto, points, rewards)?",
    tier: 2,
    searchHint:
      "Check annual report, strategy sections and press/news for digital-asset activity (custody, exchange, tokenisation, stablecoins). NOTE the field conflates crypto, loyalty points and rewards — answer the crypto sub-question from public sources and add a note on which sense is being affirmed; a card-rewards programme is 'rewards' but not 'crypto'. Consider splitting into crypto vs rewards (see schema note). Mark indicative.",
  },
  {
    field: "accepts_cash",
    label: "Do you accept cash?",
    tier: 2,
    searchHint:
      "Infer from the business model: digital-only / branchless entities typically do not accept cash; branch-network banks and money-services businesses typically do. Check product pages and branch/ATM information. Mark indicative — this is a model-based inference, not a stated fact.",
  },
];

// ----------------------------------------------------------------------------
// GROUP 2 — RESEARCHABLE LIST, % SPLIT IS CUSTOMER-SUPPLIED
// Agent fills the country list; the percentage split is NOT public.
// ----------------------------------------------------------------------------

const researchableListFields = [
  {
    field: "top_countries_payin",
    label: "Top Transaction Countries — Payin (multi, with % split)",
    tier: 2,
    splitIsCustomerSupplied: true,
    searchHint:
      "Populate the COUNTRY LIST only, from operating_countries and any corridor disclosures in the annual report / corporate site. Leave the % split BLANK — transaction-volume percentages by country are not publicly disclosed and must come from the customer. Do not estimate percentages.",
  },
  {
    field: "top_countries_payout",
    label: "Top Transaction Countries — Payout (multi, with % split)",
    tier: 2,
    splitIsCustomerSupplied: true,
    searchHint:
      "Populate the COUNTRY LIST only, from operating_countries / payout_transaction_countries and corridor disclosures. Leave the % split BLANK — not publicly disclosed; customer-supplied. Do not estimate percentages.",
  },
];

// ----------------------------------------------------------------------------
// GROUP 3 — CUSTOMER-SUPPLIED (no searchHint; excluded from researchable denominator)
// Forward-looking projections, private counterparties, and declarations.
// No public document contains these. customerSupplied:true keeps them out of
// the researchable-field coverage denominator.
// ----------------------------------------------------------------------------

const customerSuppliedFields = [
  // --- intended flow mix (declarative) ---
  { field: "payout_c2c_pct",     label: "Payout — C2C %",     customerSupplied: true },
  { field: "payout_b2b_pct",     label: "Payout — B2B %",     customerSupplied: true },
  { field: "payout_b2c_pct",     label: "Payout — B2C %",     customerSupplied: true },
  { field: "payout_c2b_pct",     label: "Payout — C2B %",     customerSupplied: true },
  { field: "collections_c2c_pct", label: "Collections — C2C %", customerSupplied: true },
  { field: "collections_b2b_pct", label: "Collections — B2B %", customerSupplied: true },
  { field: "collections_b2c_pct", label: "Collections — B2C %", customerSupplied: true },
  { field: "collections_c2b_pct", label: "Collections — C2B %", customerSupplied: true },

  // --- expected activity projections (forward-looking) ---
  { field: "expected_monthly_credit_volume",  label: "Expected Monthly Credit Volume",            customerSupplied: true },
  { field: "expected_monthly_credit_count",   label: "Expected Number of Monthly Credit Transactions", customerSupplied: true },
  { field: "expected_avg_credit_value",       label: "Expected Average Credit Transaction Value", customerSupplied: true },
  { field: "expected_monthly_debit_volume",   label: "Expected Monthly Debit Volume",             customerSupplied: true },
  { field: "expected_monthly_debit_count",    label: "Expected Number of Monthly Debit Transactions",  customerSupplied: true },
  { field: "expected_avg_debit_value",        label: "Expected Average Debit Transaction Value",  customerSupplied: true },

  // --- private counterparties (forward-looking, relationship-specific) ---
  { field: "top_senders",       label: "Top Senders",       customerSupplied: true },
  { field: "top_beneficiaries", label: "Top Beneficiaries", customerSupplied: true },

  // --- the percentage portion of the payin/payout country fields ---
  { field: "top_countries_payin_split",  label: "Top Transaction Countries — Payin (% split)",  customerSupplied: true },
  { field: "top_countries_payout_split", label: "Top Transaction Countries — Payout (% split)", customerSupplied: true },

  // --- DECLARATION: explicitly do NOT auto-research ---
  {
    field: "owner_director_criminal_conviction",
    label: "Have any owners or directors been convicted of any crime?",
    customerSupplied: true,
    doNotAutoResearch: true,
    note:
      "Self-declaration only. Do NOT auto-research criminal-conviction status of named individuals via news scraping — accuracy, fairness and data-protection risk; false positives on a named person are a serious harm. PEP / adverse-media screening is a SEPARATE governed process with its own controls and must not be wired into this auto-fill field.",
  },
];

module.exports = {
  researchableFields,
  researchableListFields,
  customerSuppliedFields,
};
