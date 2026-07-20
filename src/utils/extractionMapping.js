import { findFieldDef, getVerificationStatus } from "../pipeline";

/* Map a generic extraction-prompt key onto an
   actual schema research field id. flow is "fi" or
   "corporate". Returns null if the key has no slot
   in the active schema (we drop those values).
   The Wolfsberg prompt has its own AI-driven
   mapping inside the prompt text and is handled
   separately. */
export const EXTRACTION_KEY_TO_SCHEMA = {
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
    business_name: "tradeName",
    trading_name: "tradeName",
    registration_number: "businessRegistrationNumber",
    business_registration_number: "businessRegistrationNumber",
    incorporation_date: "registeredDate",
    registered_address: "addressLine1",
    registered_address_line1: "addressLine1",
    registered_address_line2: "addressLine2",
    registered_address_city: "city",
    registered_address_state: "state",
    registered_address_postcode: "postcode",
    registered_address_country: "country",
    legal_form: "businessType",
    business_type: "businessType",
    country_of_incorporation: "registeredCountry",
    registered_country: "registeredCountry",
    annual_turnover: "annualRevenue",
    annual_turnover_band: "annualRevenue",
    employee_count: "employees",
    employee_count_band: "employees",
    operating_countries: "countriesOfOperation",
    business_description: "industryDescription",
    business_activity_description: "industryDescription",
    publicly_listed: "stockListing",
    listed_where: "listedExchange",
    directors: "directors",
    director_names: "directors",
    ubo_names: "uboAnalysis",
    ubo_parent_company: "uboAnalysis",
    ubo_share_percentage: "uboAnalysis",
    parent_company: "uboAnalysis",
  },
};

export const mapExtractedKey = (flow, key) => {
  const m = EXTRACTION_KEY_TO_SCHEMA[flow] || {};
  return key in m ? m[key] : null;
};

export const FIELD_SECTION_BY_FLOW = {
  corporate: {
    businessType: "business_entity",
    businessRegistrationNumber: "business_entity",
    registeredDate: "business_entity",
    registeredCountry: "business_entity",
    tradeName: "business_entity",
    website: "business_entity",
    addressLine1: "registered_address",
    addressLine2: "registered_address",
    city: "registered_address",
    state: "registered_address",
    postcode: "registered_address",
    country: "registered_address",
    sicCode: "business_activity",
    annualRevenue: "business_activity",
    employees: "business_activity",
    stockListing: "business_activity",
    listedExchange: "business_activity",
    leiNumber: "business_activity",
    countriesOfOperation: "business_activity",
    industryCodes: "business_activity",
    industryDescription: "business_activity",
    isMultiLayered: "Ownership & Control",
    uboAnalysis: "Ownership & Control",
    directors: "Ownership & Control",
    companySecretary: "Ownership & Control",
    isPEP: "Ownership & Control",
  },
};

export const normalizeResearchFieldIds = (items, schema) => {
  if (!Array.isArray(items) || !schema) return items;
  const flow = schema.flow === "fi" ? "fi" : "corporate";
  const applyCanonicalMeta = (item, field, def) => {
    const section = def?.section || FIELD_SECTION_BY_FLOW[flow]?.[field] || item.section;
    return {
      ...item,
      field,
      label: def?.label || item.label,
      ...(section ? { section } : {}),
    };
  };
  return items.map((item) => {
    if (!item || !item.field) return item;
    const existingDef = findFieldDef(schema, item.field);
    if (existingDef) return applyCanonicalMeta(item, item.field, existingDef);
    const mapped = mapExtractedKey(flow, item.field);
    if (!mapped || !findFieldDef(schema, mapped)) return item;
    const def = findFieldDef(schema, mapped);
    return {
      ...applyCanonicalMeta(item, mapped, def),
      originalField: item.originalField || item.field,
    };
  });
};

// Convert the /api/self-source `selfSourcedFields` object map into the array of
// found-rows mergeResearchResults() expects: hoist the field id → `field`,
// normalise the hyphenated tier → sourceTier ("tier1"/"tier2"), and stamp the
// matching verificationStatus so registry fields render as verified tier-1 data
// on the Confirm page (exactly like AI-researched fields).
export function selfSourcedToRows(selfSourcedFields, schema) {
  const rows = Object.entries(selfSourcedFields || {}).map(([field, f]) => {
    const sourceTier = f.tier === "tier-1" ? "tier1" : "tier2";
    const label = (schema && (findFieldDef(schema, field) || {}).label) || f.label || field;
    return { field, label, ...f, sourceTier, verificationStatus: getVerificationStatus(sourceTier) };
  });
  return normalizeResearchFieldIds(rows, schema);
}
