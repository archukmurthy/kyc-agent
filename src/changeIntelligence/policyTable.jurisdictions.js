/**
 * policyTable.jurisdictions.js — sparse per-jurisdiction row overrides.
 *
 * A jurisdiction key maps to an array of rules (same { id, when, then } shape as
 * the base table). classifyChange splices these AHEAD of the base rows, so a
 * matching override row wins over the corresponding base row.
 *
 * Override a row ONLY where the OUTCOME genuinely differs by jurisdiction.
 * Deterministic-code concerns (e.g. UBO ownership thresholds) belong elsewhere,
 * not here. Do NOT invent divergences — leave empty (or omit the key) until a
 * real one is supplied by compliance.
 */

const JURISDICTION_OVERRIDES = {
  // GB: [],  // no outcome divergence identified yet
  // SG: [],  // no outcome divergence identified yet
};

module.exports = { JURISDICTION_OVERRIDES };
