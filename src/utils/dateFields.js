/**
 * dateFields.js — is this field a date, and what input should edit it?
 *
 * WHY A HEURISTIC. Most schema fields carry no `inputType` at all: research
 * fields are declared as `{ field, label, tier, section }`, so "Date of
 * Incorporation" had nothing marking it as a date and every editor fell back to
 * a free-text box — while the person's Date of birth, which IS declared, got a
 * real date picker. Same kind of value, two different controls on one page.
 *
 * Declaring inputType on every date field in the schema would fix the fields we
 * ship, but not the ones a tenant defines in the admin — those are authored
 * without inputType too. Detecting the field is what covers both.
 *
 * The same trade-off `isCountryField` makes in changeIntelligence: a documented
 * heuristic, not an enumeration. An EXPLICIT inputType always wins, so a schema
 * can always overrule it.
 *
 * Matching is on whole words after splitting camelCase and snake_case, so
 * `registeredDate` and `incorporation_date` match while `update`, `mandate`,
 * `candidate` and `validated` do not.
 */

/** "registeredDate" → "registered date"; "incorporation_date" → "incorporation date" */
const toWords = (s) =>
  String(s || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_\-.]+/g, " ")
    .toLowerCase();

const hasDateWord = (s) => /\b(date|dob|birthday)\b/.test(toWords(s));

/** An ISO calendar date, which is also what <input type="date"> expects. */
export const isIsoDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || "").trim());

/**
 * `fieldDef` may be a real schema def or a stand-in like { field, label }.
 * `value` is optional — a stored ISO date is corroborating evidence when the
 * name says nothing.
 */
export function isDateField(fieldDef = {}, value = undefined) {
  const def = fieldDef || {};
  // An explicit type is authoritative in BOTH directions: a declared date is a
  // date, and a declared select/textarea/number is never silently turned into
  // a date picker just because its label mentions one.
  if (def.inputType) return def.inputType === "date";
  if (hasDateWord(def.field) || hasDateWord(def.label) || hasDateWord(def.key)) return true;
  return isIsoDate(value);
}

/** The `type` attribute an <input> should carry for this field. */
export const resolveInputType = (fieldDef = {}, value = undefined) =>
  isDateField(fieldDef, value) ? "date" : (fieldDef && fieldDef.inputType) || "text";

export default isDateField;
