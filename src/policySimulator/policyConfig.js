// UK KYB Policy Simulator configuration shared by the browser form and
// api/generate-policy.js: the allowed option lists, the user-message builder
// and server-side validation. The browser sends its structured form; the server
// validates it against these lists and builds the message itself, so the
// endpoint cannot be used to send Claude an arbitrary prompt.
//
// CommonJS inside src/ (the src/pipeline.js precedent) so the API can require
// it and CRA can still import it.

const FIRM_TYPES = ["Authorised EMI", "Small EMI", "Authorised PI", "Small PI"];
const CUSTOMER_TYPES = [
  "UK Private Limited Companies",
  "UK Public Limited Companies",
  "UK Limited Liability Partnerships",
  "UK Partnerships",
  "Sole Traders",
  "Trusts",
  "Charities / Non-profit organisations",
  "Financial Institutions",
  "Payment Institutions / EMIs",
  "Marketplaces / Platforms",
  "Crypto-asset businesses",
];
const GEOGRAPHIES = ["UK incorporated entities only", "UK + EEA", "Global (all jurisdictions)"];
const PRODUCTS = [
  "E-money accounts",
  "Domestic payments (GBP)",
  "International payments / cross-border transfers",
  "Foreign exchange (FX)",
  "Debit / prepaid cards",
  "Acquiring / merchant services",
  "Virtual IBANs",
  "Open banking / account information services",
];
const VENDORS = [
  "Companies House API (UK registry)",
  "Didit (identity verification)",
  "ComplyCube (identity + document verification)",
  "Manual document review only",
  "Other",
];
const RISK_FIELDS = [
  {
    key: "highRiskIndustries",
    label: "High-risk industries (gambling, crypto, adult content)",
    options: ["Decline all", "EDD permitted", "Case by case"],
  },
  {
    key: "pepAppetite",
    label: "PEP appetite",
    options: ["Decline all PEPs", "Domestic PEPs with EDD", "All PEPs with EDD"],
  },
  {
    key: "complexOwnership",
    label: "Complex / multi-layered ownership structures",
    options: ["Decline", "EDD permitted"],
  },
  {
    key: "fatfCallForAction",
    label: "FATF Call-for-Action jurisdictions",
    options: ["Prohibited", "Prohibited with exceptions", "EDD required"],
  },
  {
    key: "fatfIncreasedMonitoring",
    label: "FATF Increased-Monitoring jurisdictions",
    options: ["EDD required", "Refer to MLRO", "Standard CDD"],
  },
];
const TEXT_LIMITS = Object.freeze({ policyName: 120, version: 20, otherVendor: 120 });

function buildUserMessage(form) {
  const lines = (items) => items.map((item) => `- ${item}`).join("\n");
  const vendors = form.vendors.map((vendor) =>
    vendor === "Other" ? `Other: ${form.otherVendor.trim()}` : vendor,
  );
  return `Generate a KYB Policy document for the following configuration:

FIRM DETAILS
- Firm type: ${form.firmType}
- Regulator: Financial Conduct Authority (FCA)
- Jurisdiction: United Kingdom

CUSTOMERS IN SCOPE
${lines(form.customerTypes)}

CUSTOMER GEOGRAPHY
- ${form.geography}

PRODUCTS AND SERVICES IN SCOPE
${lines(form.products)}

RISK APPETITE
- High-risk industries: ${form.highRiskIndustries}
- PEP appetite: ${form.pepAppetite}
- Complex ownership structures: ${form.complexOwnership}
- FATF Call-for-Action jurisdictions: ${form.fatfCallForAction}
- FATF Increased-Monitoring jurisdictions: ${form.fatfIncreasedMonitoring}

VERIFICATION VENDORS
${lines(vendors)}

DOCUMENT METADATA
- Policy name: ${form.policyName.trim()}
- Version: ${form.version.trim()}
- Effective date: ${form.effectiveDate}

Configuration fidelity requirements:
- Apply every selected customer type, product, geography, risk appetite, and vendor materially.
- Omit controls that relate only to unselected optional customer or product types unless legally mandatory.
- Treat configured decline or prohibited appetites as hard customer-acceptance stops.

Generate the complete KYB Policy document now, following all rules in your instructions.`;
}

// Single-line free text: any whitespace run (including newlines) becomes one space.
function singleLine(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function validatePolicyForm(input) {
  const f = input && typeof input === "object" ? input : {};
  const fail = (field) => ({ ok: false, error: "invalid_policy_configuration", field });
  const oneOf = (value, list) => typeof value === "string" && list.includes(value);
  const subset = (value, list) => Array.isArray(value)
    && value.length > 0
    && value.every((item) => list.includes(item))
    && new Set(value).size === value.length;
  const capped = (value, max) => {
    const s = singleLine(value);
    return s.length > 0 && s.length <= max;
  };

  if (!oneOf(f.firmType, FIRM_TYPES)) return fail("firmType");
  if (!subset(f.customerTypes, CUSTOMER_TYPES)) return fail("customerTypes");
  if (!oneOf(f.geography, GEOGRAPHIES)) return fail("geography");
  if (!subset(f.products, PRODUCTS)) return fail("products");
  for (const { key, options } of RISK_FIELDS) {
    if (!oneOf(f[key], options)) return fail(key);
  }
  if (!subset(f.vendors, VENDORS)) return fail("vendors");
  const hasOther = f.vendors.includes("Other");
  if (hasOther && !capped(f.otherVendor, TEXT_LIMITS.otherVendor)) return fail("otherVendor");
  if (!capped(f.policyName, TEXT_LIMITS.policyName)) return fail("policyName");
  if (!capped(f.version, TEXT_LIMITS.version)) return fail("version");
  if (typeof f.effectiveDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(f.effectiveDate)) return fail("effectiveDate");

  return {
    ok: true,
    form: {
      firmType: f.firmType,
      customerTypes: [...f.customerTypes],
      geography: f.geography,
      products: [...f.products],
      highRiskIndustries: f.highRiskIndustries,
      pepAppetite: f.pepAppetite,
      complexOwnership: f.complexOwnership,
      fatfCallForAction: f.fatfCallForAction,
      fatfIncreasedMonitoring: f.fatfIncreasedMonitoring,
      vendors: [...f.vendors],
      otherVendor: hasOther ? singleLine(f.otherVendor) : "",
      policyName: singleLine(f.policyName),
      version: singleLine(f.version),
      effectiveDate: f.effectiveDate,
    },
  };
}

module.exports = {
  FIRM_TYPES,
  CUSTOMER_TYPES,
  GEOGRAPHIES,
  PRODUCTS,
  VENDORS,
  RISK_FIELDS,
  TEXT_LIMITS,
  buildUserMessage,
  validatePolicyForm,
};
