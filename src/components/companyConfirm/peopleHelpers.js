/**
 * peopleHelpers.js — the PURE helpers behind the Confirm People section.
 *
 * Moved VERBATIM out of App.js in slice 2 of the Confirm extraction. Every
 * function here is a plain input→output function that closes over nothing:
 * that is exactly why they can live in one place and be imported by BOTH the
 * StakeholderConfirmSection component AND the App-side consumers that stay
 * behind (personConfirmItems, buildStakeholderAttributeTrail).
 *
 * The IMPURE helpers of the same family deliberately did NOT move —
 * personWithEdits reads stakeholdersRef, isPersonAttributeCorrected reads
 * research, isPersonAttributeSettled composes those with two state maps.
 * They stay in App.js and are handed to the component as props, so there is
 * still exactly one implementation of each rule rather than a copy per side.
 */

import { formatDOBForDisplay, formatShareholding } from "../../pipeline";
import { isLowConfidence } from "./confirmState";

/** Granular data points shown per stakeholder on Confirm. */
export const stkConfirmFields = (s, ubo) => {
  if (s && s.is_company) {
    // Corporate stakeholder field set.
    return [
      { key: "full_name", label: "Business name", required: true },
      { key: "business_type", label: "Business type", required: true },
      { key: "business_registration_number", label: "Registration number", required: true },
      { key: "registered_country", label: "Registered country", required: true },
      { key: "share_percentage", label: "Shareholding", required: false },
      { key: "positions", label: "Position(s)", required: false },
    ];
  }
  return [
    { key: "full_name", label: "Full legal name", required: true },
    { key: "role", label: "Role / position", required: false },
    ...(ubo ? [{ key: "share_percentage", label: "Shareholding", required: false }] : []),
    { key: "nationality", label: "Nationality", required: true },
    { key: "date_of_birth", label: "Date of birth", required: true },
    { key: "residential_country", label: "Country of residence", required: false },
    { key: "is_pep", label: "PEP status", required: true },
  ];
};
export const stkFieldFound = (s, key) => {
  if (key === "is_pep") return s.is_pep === true || s.is_pep === false;
  if (key === "share_percentage") return s.share_percentage != null && String(s.share_percentage).trim() !== "";
  if (key === "positions") return Array.isArray(s.positions) && s.positions.some((p) => p && p.title);
  return s[key] != null && String(s[key]).trim() !== "";
};
export const stkFieldDisplay = (s, key) => {
  if (key === "date_of_birth") return formatDOBForDisplay(s.date_of_birth) || s.date_of_birth || "";
  if (key === "share_percentage") return formatShareholding(s.share_percentage);
  if (key === "is_pep") return s.is_pep === true ? "Yes" : s.is_pep === false ? "No" : "";
  if (key === "positions") {
    return (s.positions || [])
      .filter((p) => p && p.title)
      .map((p) => (p.start_date ? `${p.title} (since ${p.start_date})` : p.title))
      .join(", ");
  }
  return s[key] != null ? String(s[key]) : "";
};

/** Tier of a person's data — their own if present, else the row that carried
 *  them, which is what the person card's source badge already displays. */
export const isPersonLowConfidence = (s, item) =>
  isLowConfidence({ sourceTier: (s && s.sourceTier) || (item && item.sourceTier) });
