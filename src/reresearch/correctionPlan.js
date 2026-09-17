/**
 * correctionPlan.js — pure decision for a customer's correction of the five
 * foundational facts on the Applicant page.
 *
 * Rule (spec §6.1): correcting the entity type ALONE re-derives the schema from
 * the existing research (no search, no retry spent). Any other change — company
 * name, country, registration number, ownership type, or a mix — re-runs the
 * research with the corrected values and spends one of the customer's two
 * server-counted re-searches.
 *
 * No I/O, no React. CommonJS-in-src (the searchPolicy.js precedent) so node
 * --test and App.js can both use it.
 */

const FACT_KEYS = ["companyName", "registrationNumber", "countryCode", "entityType", "ownershipType"];
const REQUIRED_KEYS = ["companyName", "countryCode", "entityType"];

function normalise(key, value) {
  const s = value == null ? "" : String(value).trim();
  return key === "countryCode" ? s.toUpperCase() : s;
}

function planCorrection(current = {}, corrections = {}) {
  const source = current || {};
  const input = corrections || {};
  const next = {};
  const changed = [];
  for (const key of FACT_KEYS) {
    const before = normalise(key, source[key]);
    const provided = Object.prototype.hasOwnProperty.call(input, key);
    const after = provided ? normalise(key, input[key]) : before;
    next[key] = after;
    if (provided && after !== before) changed.push(key);
  }

  if (changed.length === 0) return { action: "none", changed, next };

  const invalid = changed.filter((key) => REQUIRED_KEYS.includes(key) && !next[key]);
  if (invalid.length > 0) return { action: "invalid", changed, next, invalid };

  const action = changed.length === 1 && changed[0] === "entityType" ? "re_derive" : "re_search";
  return { action, changed, next };
}

module.exports = { planCorrection, FACT_KEYS };
