"use strict";

/**
 * Layer 1 (deterministic) officers injection for /api/research.
 *
 * Shared by api/research.js (production serverless, ESM — imports the default
 * export) and src/setupProxy.js (local dev server, CJS — requires this file) so
 * both run identical logic. CommonJS so the CJS dev server can require it and
 * the CH officers module (also CJS) can be required here.
 *
 * Flow:
 *   1. fetchOfficersLayer(): for UK (GB) companies with a key configured, fetch
 *      ALL active officers from the Companies House Officers API BEFORE the
 *      Anthropic call. Returns an array (possibly empty) or null on failure.
 *   2. injectOfficers(): after the Anthropic call, parse the model's JSON out of
 *      the response, REPLACE the AI's director field with the deterministic CH
 *      data (preserving the field id the schema uses), and re-serialise so the
 *      frontend parses the injected result transparently.
 *
 * Every function is defensive: any failure leaves the AI result untouched so a
 * research run is never blocked by the officers layer.
 */

const { getActiveOfficers } = require("../agents/registries/companiesHouseOfficers");

/**
 * Decide + fetch deterministic officers for a research request.
 * @returns {Promise<Array|null>} stakeholder array, [] (none), or null (skip/fail)
 */
async function fetchOfficersLayer({ companyName, jurisdiction, countryCode, registrationNumber } = {}) {
  const jur = String(jurisdiction || countryCode || "").toUpperCase();
  if (jur !== "GB") return null; // UK only
  if (!companyName) return null;
  if (!process.env.COMPANIES_HOUSE_API_KEY) return null;

  try {
    const officers = await getActiveOfficers({
      companyName,
      companyNumber: registrationNumber || null,
    });
    if (officers && officers.length) {
      // eslint-disable-next-line no-console
      console.log(`[research] CH Officers Layer 1: ${officers.length} active officers fetched`);
    }
    return officers;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[research] CH Officers Layer 1 failed, falling back to AI:", err.message);
    return null;
  }
}

/**
 * Pull the model's JSON object out of a Claude /v1/messages response. Mirrors
 * the frontend parser (concatenate text blocks, strip ```json fences, slice the
 * first { to the last }). Returns null when no parseable JSON is present.
 */
function extractJson(data) {
  let text = "";
  for (const block of (data && data.content) || []) {
    if (block.type === "text" && block.text) text += block.text;
  }
  text = text.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();
  const si = text.indexOf("{");
  const ei = text.lastIndexOf("}");
  if (si === -1 || ei === -1) return null;
  try {
    return JSON.parse(text.slice(si, ei + 1));
  } catch (_) {
    return null;
  }
}

// A research row is a director field when its id mentions "director" but is not
// a disclosure/declaration field (directors_convicted, conviction details) and
// is not a UBO/beneficial-owner field.
function isDirectorField(row) {
  const id = String((row && (row.field || row.fieldId)) || "").toLowerCase();
  if (!id.includes("director")) return false;
  if (id.includes("convict") || id.includes("disclos") || id.includes("conviction")) return false;
  if (id.includes("ubo") || id.includes("beneficial")) return false;
  return true;
}

/**
 * Inject CH officers into the parsed research result, REPLACING any AI-sourced
 * director field. Mutates and returns `data` (the raw Claude response) with its
 * text content rewritten to the modified JSON. If anything is missing/unparseable
 * the original `data` is returned untouched.
 *
 * @param {Object} data       raw Claude /v1/messages response
 * @param {Array}  chOfficers platform-shaped stakeholder objects
 */
function injectOfficers(data, chOfficers) {
  if (!Array.isArray(chOfficers) || chOfficers.length === 0) return data;
  const parsed = extractJson(data);
  if (!parsed || !Array.isArray(parsed.found)) return data;

  const names = chOfficers.map((o) => o.full_name).filter(Boolean).join(", ");
  const sourceUrl =
    (chOfficers[0] && chOfficers[0].sourceUrl) ||
    "https://find-and-update.company-information.service.gov.uk";

  const apply = (row) => ({
    ...row,
    value: names,
    source: "Companies House Officers Register",
    sourceUrl,
    sourceTier: "tier1",
    verificationStatus: "verified",
    stakeholders: chOfficers,
    layer: "L1_deterministic",
    notes: "Active officers fetched directly from the Companies House Officers API (Layer 1 deterministic).",
  });

  let replaced = false;
  const newFound = parsed.found.map((row) => {
    if (!isDirectorField(row)) return row;
    replaced = true;
    return apply(row);
  });

  // No AI director field present (e.g. the UK prompt told the model to skip it):
  // add one. `directors` is the id used by the UK corporate / FI schemas.
  if (!replaced) {
    newFound.unshift(
      apply({ field: "directors", fieldId: "directors", label: "Key Directors / Officers" })
    );
  }

  parsed.found = newFound;

  // Rewrite content: keep non-text blocks (server_tool_use / web_search results
  // the frontend counts for cost tracking) and replace all text blocks with a
  // single text block carrying the modified JSON.
  const nonText = ((data && data.content) || []).filter((b) => b.type !== "text");
  data.content = [...nonText, { type: "text", text: JSON.stringify(parsed) }];

  // eslint-disable-next-line no-console
  console.log(`[research] Injected ${chOfficers.length} CH Officers into result (replaced AI directors: ${replaced})`);
  return data;
}

module.exports = { fetchOfficersLayer, injectOfficers };
