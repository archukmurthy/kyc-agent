/**
 * foundTableHelpers.js — the pure helpers the pre-filled-fields table needs.
 *
 * Moved VERBATIM out of App.js as part of the FoundFieldsTable extraction.
 * Nothing here reads component state: `groupFoundBySection` used to close over
 * `activeSchema`, so the schema is now its second argument — that is the only
 * change to any of these bodies.
 *
 * `humaniseSection` and `safeRenderValue` are also used by App.js outside the
 * Confirm table (the dossier view and the section-label builder), so they live
 * here and are imported back rather than duplicated.
 */

import { findFieldDef, isStakeholderField } from "../../pipeline";

/** Badges sit in a fixed cell on each confirm row; text WRAPS inside the badge
 *  rather than pushing the cell wider — a nowrap badge with a long source
 *  string was collapsing the value column. */
export const badgeBaseStyle = {
  fontSize: 11,
  fontWeight: 600,
  padding: "3px 8px",
  borderRadius: 6,
  maxWidth: 175,
  width: "100%",
  boxSizing: "border-box",
  whiteSpace: "normal",
  wordWrap: "break-word",
  overflowWrap: "break-word",
  lineHeight: 1.3,
  textAlign: "right",
  cursor: "pointer",
  display: "inline-block",
};

export const humaniseSection = (s) => {
  if (!s) return "Other";
  return String(s)
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
};

/** Prevent "[object Object]" rendering when an object/array sneaks into a
 *  field value (e.g. structured UBO data) where a string is expected. */
export const safeRenderValue = (value) => {
  if (value === null || value === undefined) {
    return "—";
  }
  if (typeof value === "object") {
    return JSON.stringify(value, null, 2);
  }
  return String(value);
};

/** PR-041: an empty stakeholder array renders as human-readable text instead of
 *  a raw "[]". Returns item.value unchanged for every other field. */
export const getDisplayValue = (item) => {
  const fieldId = item.field || item.fieldId || "";
  const val = item.value;
  if (isStakeholderField(fieldId)) {
    const isEmptyArrayString = typeof val === "string" && val.trim() === "[]";
    const isEmptyArray = Array.isArray(val) && val.length === 0;
    const hasNoStakeholders = !item.stakeholders || item.stakeholders.length === 0;
    if ((isEmptyArrayString || isEmptyArray) && hasNoStakeholders) {
      const sourceLabel = item.source || "";
      const hasUsefulSource = sourceLabel.length > 10 && !sourceLabel.startsWith("http");
      return hasUsefulSource
        ? sourceLabel
        : "No persons with significant control recorded";
    }
  }
  return val;
};

/** Group rows by schema section, ordered by first appearance in the schema.
 *  `schema` was `activeSchema` from App scope; it is now a parameter. */
export const groupFoundBySection = (items, schema) => {
  const groups = new Map();
  items.forEach(({ item, idx }) => {
    const def = findFieldDef(schema, item.field);
    const section = def?.section || item.section || "Other";
    if (!groups.has(section)) groups.set(section, []);
    groups.get(section).push({ item, idx });
  });
  // Order sections by their first appearance in the schema.
  const sectionOrder = new Map();
  let pos = 0;
  if (schema) {
    [...(schema.researchFields || []), ...(schema.gapFields || [])].forEach((f) => {
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
