/**
 * correctionPlan.js — pure decision for a customer's correction of the five
 * foundational facts on the Applicant page.
 *
 * Rule: any change to a foundational fact — company name, country, registration
 * number, entity type, ownership type, or a mix — re-runs the research with the
 * corrected values and spends one of the customer's two server-counted
 * re-searches. (Owner decision 2026-09-17, RERES-1: an entity-type-only
 * correction used to re-derive the schema without searching; it now searches
 * too, because the entity type changes which fields research looks for.)
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

  return { action: "re_search", changed, next };
}

module.exports = { planCorrection, FACT_KEYS };
