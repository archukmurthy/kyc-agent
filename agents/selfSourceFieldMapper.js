/**
 * selfSourceFieldMapper.js
 * PR-026 — Maps selfSourceAgent extracted fields → dossier schema field IDs
 *
 * Field IDs verified directly against lib/seedSchemas.js (June 15, 2026).
 * Two schemas in use — field IDs differ between them:
 *
 *   FI flow    (UK_FI_SCHEMA / SG_FI_SCHEMA) — uses fiResearchFields
 *              e.g. business_name, registration_number, incorporation_date,
 *                   registered_address_line1, registered_address_city, etc.
 *
 *   Corporate flow (UK_SCHEMA / SG_SCHEMA) — uses inline researchFields
 *              e.g. businessType, businessRegistrationNumber, registeredDate,
 *                   addressLine1, city, postcode, etc.
 *
 * The mapper detects which schema is active via the `flow` param
 * ("fi" or "corporate") and applies the correct field ID set.
 *
 * Integration in App.js (add after orchestrateDocuments completes):
 *
 *   import { mapSelfSourcedFields, getManualReviewItems } from "./selfSourceFieldMapper";
 *
 *   const selfSourcedFields = mapSelfSourcedFields(
 *     orchestratorResult.registry.results,
 *     flow   // "fi" | "corporate"  — read from tenantConfig or niumEntityType
 *   );
 *   const mergedResearch = mergeResearchResults(researchResults, selfSourcedFields);
 *   setResearchResults(mergedResearch);
 */

// ─── FI schema field mappings ──────────────────────────────────────────────────
// Source: fiResearchFields in lib/seedSchemas.js
const FI_REQUIREMENT_FIELD_MAP = {

  "Legal existence": [
    { extractedField: "registeredName",     fieldId: "business_name" },
    { extractedField: "registrationNumber", fieldId: "registration_number" },
    { extractedField: "status",             fieldId: null },           // no direct field — goes to notes only
    { extractedField: "incorporationDate",  fieldId: "incorporation_date" },
    // Address is split — the agent returns a single string; we parse it below
    // using parseAddress(). Each component maps to its own field.
    { extractedField: "_addressLine1",      fieldId: "registered_address_line1" },
    { extractedField: "_addressLine2",      fieldId: "registered_address_line2" },
    { extractedField: "_addressCity",       fieldId: "registered_address_city" },
    { extractedField: "_addressState",      fieldId: "registered_address_state" },
    { extractedField: "_addressPostcode",   fieldId: "registered_address_postcode" },
    { extractedField: "_addressCountry",    fieldId: "registered_address_country" },
  ],

  "Constitution": [
    // No scalar fields — evidence file only, no form pre-population
  ],

  "Regulatory status": [
    { extractedField: "registrationNumber", fieldId: "licence_number" },
    { extractedField: "keyDetails",         fieldId: "regulatory_authority" },
  ],

  "Ownership / control": [
    { extractedField: "keyDetails",         fieldId: "ubo_parent_company" },
  ],

  "UK signatory authority evidence": [
    // Evidence only — no direct dossier field to pre-fill
  ],

  "Indonesia entity address evidence": [
    { extractedField: "_addressLine1",      fieldId: "registered_address_line1" },
    { extractedField: "_addressCity",       fieldId: "registered_address_city" },
    { extractedField: "_addressPostcode",   fieldId: "registered_address_postcode" },
    { extractedField: "_addressCountry",    fieldId: "registered_address_country" },
  ],
};

// ─── Corporate schema field mappings ──────────────────────────────────────────
// Source: UK_SCHEMA.researchFields / SG_SCHEMA.researchFields in lib/seedSchemas.js
const CORPORATE_REQUIREMENT_FIELD_MAP = {

  "Legal existence": [
    { extractedField: "registeredName",     fieldId: "tradeName" },       // closest match — legal name shows as tradeName in corporate flow
    { extractedField: "registrationNumber", fieldId: "businessRegistrationNumber" },
    { extractedField: "incorporationDate",  fieldId: "registeredDate" },
    // Address split — same parse pattern, different field IDs
    { extractedField: "_addressLine1",      fieldId: "addressLine1" },
    { extractedField: "_addressLine2",      fieldId: "addressLine2" },
    { extractedField: "_addressCity",       fieldId: "city" },
    { extractedField: "_addressState",      fieldId: "state" },
    { extractedField: "_addressPostcode",   fieldId: "postcode" },
    { extractedField: "_addressCountry",    fieldId: "country" },
  ],

  "Constitution": [],

  "Regulatory status": [
    { extractedField: "keyDetails",         fieldId: "stockListing" },    // best available match in corporate schema
  ],

  "Ownership / control": [],

  "UK signatory authority evidence": [],
};

// ─── Registry source labels ────────────────────────────────────────────────────
const SOURCE_LABELS = {
  "find-and-update.company-information.service.gov.uk": "Companies House",
  "bizfile.gov.sg":           "ACRA BizFile",
  "asic.gov.au":              "ASIC",
  "companies-register.companiesoffice.govt.nz": "NZ Companies Office",
  "kvk.nl":                   "KvK (Netherlands)",
  "handelsregister.de":       "Handelsregister (Germany)",
  "sec.gov":                  "SEC EDGAR",
  "ised-isde.canada.ca":      "Corporations Canada",
  "ssm-einfo.my":             "SSM (Malaysia)",
  "ahu.go.id":                "AHU (Indonesia)",
  "registrucentras.lt":       "Centre of Registers (Lithuania)",
  "gsxt.gov.cn":              "GSXT (China)",
  "touki.or.jp":              "Legal Affairs Bureau (Japan)",
  "e-services.cr.gov.hk":    "Companies Registry (Hong Kong)",
  "receita.fazenda":          "Receita Federal (Brazil)",
  "mc.gov.sa":                "Ministry of Commerce (Saudi Arabia)",
  "u.ae":                     "UAE Business Registry",
  "lbr.lu":                   "RCS Luxembourg",
  "ariregister.rik.ee":       "e-Business Register (Estonia)",
  "bolagsverket.se":          "Bolagsverket (Sweden)",
  "brreg.no":                 "Brønnøysund (Norway)",
  "virre.prh.fi":             "Trade Register (Finland)",
  "datacvr.virk.dk":          "CVR (Denmark)",
  "kbopub.economie.fgov.be":  "KBO/BCE (Belgium)",
  "ekrs.ms.gov.pl":           "KRS (Poland)",
  "portal.onrc.ro":           "ONRC (Romania)",
  "www.orsr.sk":              "Commercial Register (Slovakia)",
  "www.ajpes.si":             "AJPES (Slovenia)",
  "businessregistry.gr":      "GEMI (Greece)",
  "rmc.es":                   "Registro Mercantil (Spain)",
  "registroimprese.it":       "Registro delle Imprese (Italy)",
  "data.inpi.fr":             "INPI (France)",
  "e-cegjegyzek.hu":          "Company Registry (Hungary)",
  "core.cro.ie":              "CRO (Ireland)",
  "info.ur.gov.lv":           "Register of Enterprises (Latvia)",
  "oera.li":                  "Handelsregister (Liechtenstein)",
  "companies.gov.cy":         "Companies Registry (Cyprus)",
  "justizonline.gv.at":       "Firmenbuch (Austria)",
  "egov.kz":                  "eGov (Kazakhstan)",
  "e-register.am":            "State Register (Armenia)",
  "enreg.reestri.gov.ge":     "NAPR (Georgia)",
  "my.gov.uz":                "State Register (Uzbekistan)",
  "mca.gov.in":               "MCA21 (India)",
  "www.skatturinn.is":        "Companies Register (Iceland)",
  "registry.mbr.mt":          "Malta Business Registry",
  "or.justice.cz":            "Commercial Register (Czech Republic)",
  "portal.registryagency.bg": "Commercial Register (Bulgaria)",
  "sudreg.pravosudje.hr":     "Court Register (Croatia)",
};

function getSourceLabel(sourceUrl) {
  if (!sourceUrl) return "Registry";
  for (const [domain, label] of Object.entries(SOURCE_LABELS)) {
    if (sourceUrl.includes(domain)) return label;
  }
  return "Registry";
}

// ─── Address parser ────────────────────────────────────────────────────────────
// The AI extraction returns registeredAddress as a single string.
// We need to split it into components for the schema's individual address fields.
// This is a best-effort heuristic — works well for UK, SG, AU, NL, CA.
// For complex cases the analyst confirms on the Confirm page.
function parseAddress(addressString) {
  if (!addressString) return {};

  const parts = addressString
    .split(/,\s*/)
    .map(p => p.trim())
    .filter(Boolean);

  if (parts.length === 0) return {};

  // Heuristic:
  // Last part   = country (if looks like a country name or 2-letter code)
  // Second last = postcode (if looks like a postcode)
  // Third last  = city / state
  // Everything before = address lines

  const postcodePattern = /^[A-Z]{1,2}\d[\dA-Z]?\s*\d[A-Z]{2}$|^\d{4,6}$|^[A-Z]\d[A-Z]\s*\d[A-Z]\d$/i;

  let country   = null;
  let postcode  = null;
  let city      = null;
  let line2     = null;
  let line1     = null;

  const last = parts[parts.length - 1];
  const secondLast = parts.length > 1 ? parts[parts.length - 2] : null;

  // If last part looks like a country or is 2-3 chars (country code)
  if (last && (last.length <= 3 || /^[A-Z][a-z]/.test(last))) {
    country = last;
    parts.pop();
  }

  // Now check new last for postcode
  const newLast = parts[parts.length - 1];
  if (newLast && postcodePattern.test(newLast.replace(/\s/g, ''))) {
    postcode = newLast;
    parts.pop();
  }

  // Remaining: last = city, rest = address lines
  if (parts.length > 0) { city  = parts.pop(); }
  if (parts.length > 0) { line2 = parts.pop(); }
  if (parts.length > 0) { line1 = parts.join(", "); }
  else if (line2)       { line1 = line2; line2 = null; }

  return {
    _addressLine1:    line1    || null,
    _addressLine2:    line2    || null,
    _addressCity:     city     || null,
    _addressState:    null,     // not reliably parseable from a single string
    _addressPostcode: postcode || null,
    _addressCountry:  country  || null,
  };
}

// ─── Core mapper ──────────────────────────────────────────────────────────────
/**
 * mapSelfSourcedFields
 *
 * @param {Array}  registryResults  - selfSourceAgent.results[]
 * @param {string} flow             - "fi" | "corporate"  (from tenantConfig or niumEntityType)
 * @returns {Object}                - { [fieldId]: { value, tier, source, ... } }
 */
function mapSelfSourcedFields(registryResults = [], flow = "fi") {
  const FIELD_MAP = flow === "fi"
    ? FI_REQUIREMENT_FIELD_MAP
    : CORPORATE_REQUIREMENT_FIELD_MAP;

  const output = {};

  for (const result of registryResults) {
    if (!result.extracted) continue;
    if (result.status === "fetch_failed") continue;
    if (result.status === "manual_retrieval_required") continue;
    if (result.extracted.matchConfidence === "low") continue;

    const fieldMappings = FIELD_MAP[result.requirement];
    if (!fieldMappings || fieldMappings.length === 0) continue;

    const sourceLabel = getSourceLabel(result.sourceUrl);
    const tier = result.selfSourceTier === "Preferred self-source" ? "tier-1" : "tier-2";

    // Parse address into components and merge into extracted for lookup
    const addressComponents = parseAddress(result.extracted.registeredAddress);
    const enrichedExtracted = { ...result.extracted, ...addressComponents };

    for (const mapping of fieldMappings) {
      if (!mapping.fieldId) continue; // null = evidence only, skip

      const rawValue = enrichedExtracted[mapping.extractedField];
      if (!rawValue || rawValue === null) continue;

      const value = typeof rawValue === "string" ? rawValue.trim() : String(rawValue);
      if (!value || value === "null" || value === "undefined") continue;

      output[mapping.fieldId] = {
        value,
        tier,
        source:       "registry-self-source",
        sourceLabel,
        sourceUrl:    result.searchUrl || result.sourceUrl,
        // Point-in-time evidence — metadata JSON path
        // Before production: upload to Vercel Blob and replace with Blob URL
        evidenceRef:  result.metadataPath || null,
        retrievedAt:  result.retrievedAt,
        confidence:   result.extracted.matchConfidence,
        agentVersion: result.agentVersion,
        requirement:  result.requirement,
      };
    }
  }

  return output;
}

// ─── Manual review items ──────────────────────────────────────────────────────
/**
 * getManualReviewItems — items the analyst must retrieve manually.
 * Surface as a banner on the Confirm page.
 */
function getManualReviewItems(registryResults = []) {
  return registryResults
    .filter(r => r.manualReviewFlag || r.status === "manual_retrieval_required")
    .map(r => ({
      requirement:        r.requirement,
      manualReviewReason: r.manualReviewReason,
      sourceUrl:          r.sourceUrl,
      selfSourceTier:     r.selfSourceTier,
    }));
}

// ─── CONFIRM PAGE PATCH NOTES (for App.js developer) ─────────────────────────
//
// selfSourcedFields flows into researchResults via mergeResearchResults().
// No changes needed to the Confirm page field render loop — fields appear
// pre-filled exactly as AI-researched fields do.
//
// TWO additions needed in the Confirm page render:
//
// 1. SOURCE LABEL — where you currently show "tier-1 / tier-2 / tier-3":
//    if (field.source === "registry-self-source") {
//      show: field.sourceLabel   e.g. "Companies House"
//      link: field.evidenceRef   opens the metadata JSON (point-in-time proof)
//    }
//
// 2. MANUAL REVIEW BANNER — at top of Confirm page:
//    if (manualReviewItems.length > 0) {
//      show yellow banner:
//      "⚠ The following documents require manual sourcing before submission:"
//      [list of requirement names, each linking to registry sourceUrl]
//    }
//
// 3. EVIDENCE LINK — before production:
//    Upload metadata JSON + screenshot to Vercel Blob.
//    Replace result.metadataPath with the Blob URL in selfSourceAgent.
//    The evidenceRef in each mapped field then becomes the Blob URL.
//    This is critical — the live registry URL changes; the Blob is frozen.
//
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  mapSelfSourcedFields,
  getManualReviewItems,
  getSourceLabel,
  parseAddress,
  FI_REQUIREMENT_FIELD_MAP,
  CORPORATE_REQUIREMENT_FIELD_MAP,
  SOURCE_LABELS,
};
