/**
 * stakeholderHelpers.js — the PURE parts of the Fill Gaps stakeholder cluster.
 *
 * Split out during slice 1 of the Fill Gaps extraction for the same reason
 * companyConfirm/peopleHelpers.js exists: these close over nothing in App's
 * scope, and BOTH sides need them. StakeholderGapForms renders the completion
 * badge from stakeholderMissingFields and the corporate select from
 * BUSINESS_TYPE_OPTIONS; App.js still needs the same two for
 * validateStakeholders (the Continue-gate validator, which stays in App) and
 * fillTestData (which straddles both halves of the page and therefore moves
 * into neither).
 *
 * One implementation of each rule, imported twice — never copied.
 */

export const stakeholderRequiredKeys = (s) => {
  if (s && s.is_company) {
    // Corporate stakeholder: KYB fields, no person EDD.
    return ["full_name", "business_type", "business_registration_number", "registered_country"];
  }
  const keys = ["full_name", "nationality", "date_of_birth", "is_pep"];
  if (s && s.is_pep === true) keys.push("pep_details");
  return keys;
};

export const stakeholderMissingFields = (s) => {
  return stakeholderRequiredKeys(s).filter((k) => {
    if (k === "is_pep") return s.is_pep === null || s.is_pep === undefined;
    const v = s[k];
    return v == null || String(v).trim() === "";
  });
};

// Common legal/business types for a corporate stakeholder.
export const BUSINESS_TYPE_OPTIONS = [
  "Private Limited Company",
  "Public Limited Company (PLC)",
  "Limited Liability Partnership (LLP)",
  "Partnership",
  "Sole Proprietorship",
  "Trust",
  "Fund",
  "Foundation",
  "Government / State-owned",
  "Other",
];
