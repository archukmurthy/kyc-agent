import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { getTenantId, isPreviewMode } from "./utils/tenant";
import SearchableSelect from "./components/SearchableSelect";
import {
  OWNERSHIP_TYPE_LIBRARY,
  getResearchStrategy,
  ownershipTypeLabel,
} from "./utils/ownershipTypes";
import Step2DynamicForm from "./components/Step2DynamicForm";
import Step5Recompute from "./components/Step5Recompute";
import {
  SOURCE_TRUST,
  UK_SCHEMA,
  SG_SCHEMA,
  UK_FI_SCHEMA,
  SG_FI_SCHEMA,
  getOwnershipTypeOptions,
  computeResearchStrategy,
  getApplicableLicence,
  isStakeholderField,
  isUboLikeField,
  isRegistryExemptionNotice,
  makeStakeholder,
  formatDOBForDisplay,
  enrichStakeholders,
  detectPubliclyListed,
  needsStakeholderDetails,
  detectListingEvidence,
  pickLicence,
  getSchemaFromConfig,
  findFieldDef,
  normaliseDate,
  resolveDisplayValue,
  mapAIValuesToOptions,
  classifySourceFromConfig,
  getVerificationStatus,
  computeCoverage,
  hasPlausibleHigherTierSource,
  buildGapRecoveryPrompt,
  mergeResearchResults,
  RESEARCH_TOOLS,
  buildPrompt,
} from "./pipeline";

// ── API pricing (Anthropic, June 2026) ──
// Unit prices used to calculate ACTUAL cost from REAL token counts. Token
// counts come from response.usage on every Anthropic API call — these are
// not estimates. Mirrors lib/persist.js#estimateCostUsd ($3 / $15 per Mtok)
// so the live submit path and the benchmark path price tokens identically.
const API_PRICING = {
  model: "claude-sonnet-4-20250514",
  inputCostPerMillionTokens: 3.0, // USD
  outputCostPerMillionTokens: 15.0, // USD
};

// Calculate real dollar cost from real token counts returned by the API.
function calcCostUsd(inputTokens, outputTokens) {
  return (
    (inputTokens / 1_000_000) * API_PRICING.inputCostPerMillionTokens +
    (outputTokens / 1_000_000) * API_PRICING.outputCostPerMillionTokens
  );
}

// Aggregate the per-phase costTracker into a single summary object for
// persistence. Totals are recomputed from summed REAL token counts (not from
// summing pre-rounded per-phase dollar figures) to avoid float drift.
function buildCostSummary(tracker, company, entityType, ownershipType, coverage) {
  // Collect only phases that actually ran
  const phases = [
    tracker.docSearch,
    tracker.researchPass1,
    tracker.researchPass2,
    tracker.docExtraction,
  ].filter(Boolean);

  // Sum real token counts across all phases
  const totalInputTokens = phases.reduce(
    (sum, p) => sum + (p.inputTokens || 0),
    0
  );
  const totalOutputTokens = phases.reduce(
    (sum, p) => sum + (p.outputTokens || 0),
    0
  );
  // Recalculate total cost from tokens for accuracy (avoid float rounding
  // from summing pre-calculated per-phase costs)
  const totalCostUsd = calcCostUsd(totalInputTokens, totalOutputTokens);

  return {
    model: API_PRICING.model,
    pricingUsed: {
      inputCostPerMillionTokens: API_PRICING.inputCostPerMillionTokens,
      outputCostPerMillionTokens: API_PRICING.outputCostPerMillionTokens,
    },

    // Per-phase breakdown with real counts
    breakdown: {
      docSearch: tracker.docSearch,
      researchPass1: tracker.researchPass1,
      researchPass2: tracker.researchPass2,
      docExtraction: tracker.docExtraction,
    },

    // Totals across all phases
    totals: {
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      totalTokens: totalInputTokens + totalOutputTokens,
      totalCostUsd,
      apiCallCount: phases.reduce((sum, p) => sum + (p.apiCallCount || 1), 0),
      phasesRan: phases.length,
    },

    // Coverage context
    coverage: coverage
      ? {
          fillRate: coverage.fillRate,
          verifiedFillRate: coverage.verifiedFillRate,
          totalResearchFields: coverage.totalResearchFields,
          populatedFields: coverage.populatedFields,
          verifiedFields: coverage.verifiedFields,
          // Cost per field found
          costPerFieldUsd:
            coverage.populatedFields > 0
              ? totalCostUsd / coverage.populatedFields
              : null,
        }
      : null,

    computedAt: new Date().toISOString(),
  };
}

// Maps this app's ownership-type IDs to the key strings the DRS engine's
// normaliseEntityType() recognises (it keys off labels like "Public Listed
// Company" / "LLP", not our IDs). Unmapped IDs fall through to the engine's
// safe "Privately owned" default. entityType is passed separately as the
// entity LABEL (e.g. "Financial Institution") so the engine's FI/sector/
// Wolfsberg detection works.
const OWNERSHIP_ID_TO_DRS = {
  public_listed: "Public Listed Company",
  public_unlisted: "Private Limited",
  private_limited: "Private Limited",
  llp: "LLP",
  general_partnership: "Partnership",
  sole_trader: "Sole Trader",
  trust: "Trust",
  government: "State Owned",
  central_bank: "State Owned",
  charity: "Private Limited",
  foundation: "Private Limited",
  cooperative: "Private Limited",
  branch: "Private Limited",
  spv: "Private Limited",
  holding_company: "Private Limited",
  joint_venture: "Private Limited",
  correspondent_bank: "Public Listed Company",
  payment_institution: "Private Limited",
  investment_fund: "Private Limited",
  insurance_company: "Private Limited",
  other: "Private Limited",
};

/* ═══════════════════════════════════════════
   COLOUR PALETTE
   Named tokens used by the enhanced research-pipeline UI (coverage bar,
   three-tier badges, low-data banner). Maps the spec's semantic colour names
   onto this app's existing hex values so the Confirm-page UX reads
   consistently with the rest of the flow.
   ═══════════════════════════════════════════ */
const C = {
  niumBlue: "#1a3a4a",
  text: "#1a3a4a",
  textMuted: "#1a3a4a90",
  textSec: "#1a3a4aaa",
  border: "rgba(26,58,74,0.14)",
  surfaceAlt: "#fafcfb",
  surface: "#ffffff",
  background: "#f1f4f3",
  success: "#1a6b56",
  successBg: "#dff2ec",
  successBorder: "#9fd8c8",
  warning: "#8c5500",
  warningBg: "#fff1d6",
  warningBorder: "#e8c98a",
  error: "#d44",
  info: "#1a4a7a",
  infoBg: "#f0f3f8",
  infoBorder: "#bcd0e8",
};

/* ═══════════════════════════════════════════
   APP-LEVEL CONSTANTS
   Edit here when product config changes.
   ═══════════════════════════════════════════ */
// Testing-only affordances (Dummy Research, Demo mode, Fill with test data,
// Upload-all). Shown automatically in local dev (`npm start`), and on the
// deployed/production site ONLY when the URL carries ?test=1 — so normal
// customers never see them, but you can enable them on Vercel for QA by
// visiting e.g. https://kyc-agent-deploy.vercel.app/?test=1
const TEST_FLAG =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("test") === "1";
const SHOW_TEST_TOOLS = process.env.NODE_ENV !== "production" || TEST_FLAG;

const MANUAL_FORM_URL = "https://app.nium.com";
// TODO: replace with actual product form URL

// eslint-disable-next-line no-unused-vars
const CACHE_STALE_DAYS = 90;
// Number of days before cached research is considered stale (used by Session 2 cache layer)

/* ═══════════════════════════════════════════
   COUNTRY LIST
   ═══════════════════════════════════════════ */
const COUNTRIES = [
  { code: "GB", name: "United Kingdom" },{ code: "SG", name: "Singapore" },
  { code: "US", name: "United States" },{ code: "AU", name: "Australia" },
  { code: "CA", name: "Canada" },{ code: "NL", name: "Netherlands" },
  { code: "LT", name: "Lithuania" },{ code: "JP", name: "Japan" },
  { code: "HK", name: "Hong Kong" },{ code: "MY", name: "Malaysia" },
  { code: "ID", name: "Indonesia" },{ code: "DE", name: "Germany" },
  { code: "FR", name: "France" },{ code: "IE", name: "Ireland" },
  { code: "IN", name: "India" },{ code: "TH", name: "Thailand" },
  { code: "VN", name: "Vietnam" },{ code: "PH", name: "Philippines" },
  { code: "KR", name: "South Korea" },{ code: "CN", name: "China" },
  { code: "TW", name: "Taiwan" },{ code: "AE", name: "United Arab Emirates" },
  { code: "SA", name: "Saudi Arabia" },{ code: "ZA", name: "South Africa" },
  { code: "NG", name: "Nigeria" },{ code: "KE", name: "Kenya" },
  { code: "EG", name: "Egypt" },{ code: "BR", name: "Brazil" },
  { code: "MX", name: "Mexico" },{ code: "AR", name: "Argentina" },
  { code: "CL", name: "Chile" },{ code: "CO", name: "Colombia" },
  { code: "ES", name: "Spain" },{ code: "IT", name: "Italy" },
  { code: "CH", name: "Switzerland" },{ code: "SE", name: "Sweden" },
  { code: "NO", name: "Norway" },{ code: "DK", name: "Denmark" },
  { code: "PL", name: "Poland" },{ code: "TR", name: "Turkey" },
  { code: "IL", name: "Israel" },{ code: "NZ", name: "New Zealand" },
  { code: "PK", name: "Pakistan" },{ code: "BD", name: "Bangladesh" },
  { code: "LK", name: "Sri Lanka" },{ code: "AM", name: "Armenia" },
];


// Merge the configured per-entity-type document list with the hardcoded
// DOC_TYPES (which carry the extraction prompts and source-name strings).
// Config can hide / reorder / rename docs; the AI extraction logic stays
// hardcoded and is applied to docs whose ids match a DOC_TYPES entry.
const docTypesForEntity = (entityTypeId, tenantConfig) => {
  const configured = tenantConfig?.documents?.[entityTypeId];
  if (!configured) {
    return DOC_TYPES.filter(d => d.entities.includes(entityTypeId));
  }
  return configured
    .filter(d => d.active !== false)
    .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
    .map(cfg => {
      const base = DOC_TYPES.find(d => d.key === cfg.id);
      if (!base) return null;
      return {
        ...base,
        label: cfg.name || base.label,
        helper: cfg.helperText || base.helper,
        icon: cfg.icon || base.icon,
      };
    })
    .filter(Boolean);
};

// Built locally from the still-present hardcoded constants above. This is
// the offline fallback used only when /api/config is unreachable; the
// canonical source is the API endpoint, which seeds itself from the same
// data via lib/seedSchemas.js.
const buildLocalDefaultConfig = () => ({
  _tenantId: "local",
  _version: 0,
  _seededAt: new Date().toISOString(),
  company: {
    name: "Nium",
    logo: null,
    manualFormUrl: MANUAL_FORM_URL,
    privacyPolicyUrl: "",
    submissionWebhookUrl: "",
    submissionEmail: "",
    primaryContactName: "",
    primaryContactEmail: "",
  },
  licences: [
    { id: "GB", jurisdictionCode: "GB", jurisdictionName: "United Kingdom", licenceType: "Payment Institution", licenceNumber: "", regulatoryAuthority: "FCA", countriesCovered: ["GB"], isPrimary: false },
    { id: "SG", jurisdictionCode: "SG", jurisdictionName: "Singapore", licenceType: "Major Payment Institution", licenceNumber: "", regulatoryAuthority: "MAS", countriesCovered: [], isPrimary: true },
  ],
  routingPolicy: "regional",
  entityTypes: [
    { id: "FI", label: "Financial Institution", description: "Banks, payment institutions, EMIs", icon: "🏦", active: true, sortOrder: 1 },
    { id: "Platform", label: "Platform", description: "Technology platforms and marketplaces", icon: "💻", active: true, sortOrder: 2 },
    { id: "Direct", label: "Direct", description: "Direct business customers", icon: "🏢", active: true, sortOrder: 3 },
    { id: "Corporate", label: "Corporate", description: "Corporate and commercial entities", icon: "🏛", active: true, sortOrder: 4 },
  ],
  schemas: {
    "Corporate:GB": { researchFields: UK_SCHEMA.researchFields, gapFields: UK_SCHEMA.gapFields },
    "Corporate:SG": { researchFields: SG_SCHEMA.researchFields, gapFields: SG_SCHEMA.gapFields },
    "FI:GB": { researchFields: UK_FI_SCHEMA.researchFields, gapFields: UK_FI_SCHEMA.gapFields },
    "FI:SG": { researchFields: SG_FI_SCHEMA.researchFields, gapFields: SG_FI_SCHEMA.gapFields },
    "Platform:GB": { researchFields: UK_SCHEMA.researchFields, gapFields: UK_SCHEMA.gapFields },
    "Platform:SG": { researchFields: SG_SCHEMA.researchFields, gapFields: SG_SCHEMA.gapFields },
    "Direct:GB": { researchFields: UK_SCHEMA.researchFields, gapFields: UK_SCHEMA.gapFields },
    "Direct:SG": { researchFields: SG_SCHEMA.researchFields, gapFields: SG_SCHEMA.gapFields },
  },
  sourceTiers: {
    primary: [],
    secondary: [],
    documentsArePrimary: true,
  },
  documents: {},
});

const LOADER_MSGS = [
  "Searching company registries...",
  "Checking regulatory databases...",
  "Extracting director information...",
  "Analysing ownership structure...",
  "Compiling financial data...",
  "Identifying jurisdiction-specific gaps...",
  "Building onboarding form...",
  "Almost done, compiling results...",
];

// Two-phase loader messages for the AI + Documents journey.
// Phase 1 messages are generated dynamically in doResearch from the
// uploadedDocs map; this list is the fallback when nothing was uploaded.
const LOADER_MSGS_WOLFSBERG_PHASE1 = [
  "Reading your documents...",
];
const LOADER_MSGS_WOLFSBERG_PHASE2 = [
  "Searching official registries…",
  "Checking regulatory databases…",
  "Scanning secondary sources…",
  "Almost done, compiling results…",
];

// Build the Phase-1 status messages for the docs we actually have.
const buildPhase1Msgs = (docs) => {
  const msgs = [];
  DOC_TYPES.forEach(d => {
    if (docs[d.key]) msgs.push(`Reading ${d.label}…`);
  });
  if (msgs.length === 0) msgs.push("Reading your documents…");
  return msgs;
};

// Read a File object as base64 (data: prefix stripped) for sending in an
// Anthropic messages "document" content block.
const readFileAsBase64 = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result).split(",")[1]);
  reader.onerror = reject;
  reader.readAsDataURL(file);
});

const WOLFSBERG_EXTRACTION_PROMPT = `You are a KYC compliance data extractor. Extract all available field values from this Wolfsberg CBDDQ questionnaire and return them as a JSON object.

Return ONLY valid JSON with no markdown, no backticks.
Map the questionnaire answers to these field IDs where possible:

{
  "legal_name": "string or null",
  "registered_address": "string or null",
  "incorporation_date": "string or null",
  "lei_number": "string or null",
  "parent_company": "string or null",
  "parent_jurisdiction": "string or null",
  "publicly_listed": "Yes/No or null",
  "listed_where": "string or null",
  "business_type": "string or null",
  "ubo_names": "string or null",
  "ubo_share_percentage": "string or null",
  "bearer_shares": "Yes/No or null",
  "offshore_banking_licence": "Yes/No or null",
  "regulatory_authority": "string or null",
  "employee_count": "string or null",
  "total_assets": "string or null",
  "non_resident_customers": "Yes/No or null",
  "top_non_resident_countries": "string or null",
  "business_areas": "array of active business areas",
  "correspondent_banking": "Yes/No or null",
  "services_other_fis": "Yes/No or null",
  "trade_finance": "Yes/No or null",
  "cross_border_remittances": "Yes/No or null",
  "deals_virtual_currency": "Yes/No or null",
  "virtual_currency_types": "string or null",
  "aml_programme_in_place": "Yes/No or null",
  "aml_team_size": "string or null",
  "aml_policy_board_approved": "Yes/No or null",
  "board_aml_reporting_frequency": "string or null",
  "aml_outsourced": "Yes/No or null",
  "aml_outsourced_to": "string or null",
  "abc_programme": "Yes/No or null",
  "pep_screening": "Yes/No or null",
  "pep_screening_method": "string or null",
  "adverse_media_screening": "Yes/No or null",
  "ubo_threshold_pct": "string or null",
  "edd_shell_banks": "string or null",
  "edd_peps": "string or null",
  "edd_virtual_currency": "string or null",
  "transaction_monitoring_method": "string or null",
  "suspicious_activity_reporting": "Yes/No or null",
  "fatf_rec16_compliance": "Yes/No or null",
  "sanctions_policy_board_approved": "Yes/No or null",
  "sanctions_lists_used": "string or null",
  "sanctions_screening_update_days": "string or null",
  "presence_in_sanctioned_countries": "Yes/No or null",
  "record_retention_period": "string or null",
  "kyc_quality_assurance": "Yes/No or null",
  "internal_audit_covers_aml": "Yes/No or null",
  "policies_updated_annually": "Yes/No or null",
  "prohibits_shell_banks": "Yes/No or null",
  "prohibits_anonymous_accounts": "Yes/No or null",
  "licence_suspended": "Yes/No or null",
  "regulatory_action": "Yes/No or null"
}

For each field: extract the actual answer from the questionnaire. If the question was not answered or not present, return null. Do not guess or fabricate. For Yes/No questions return "Yes" or "No" as strings.`;

/* ═══════════════════════════════════════════
   PER-DOCUMENT EXTRACTION PROMPTS

   Each prompt instructs Claude to read a PDF (or
   image, for org chart) and return a JSON array of
   {fieldId, value} objects. The keys returned are
   "generic" — mapEXTRACTION_KEY_TO_SCHEMA() below
   maps them onto the active schema's field IDs.
   ═══════════════════════════════════════════ */
const CERT_EXTRACTION_PROMPT = `Extract the following from this Certificate of Incorporation or equivalent company registration document:
- legal_name: full registered legal name
- registration_number: company/registration number
- incorporation_date: date of incorporation (ISO format)
- registered_address: full registered address
- legal_form: company type (e.g. private limited, PLC)
- country_of_incorporation: country

Return as JSON array of {fieldId, value} objects. Only include fields actually present in the document. No markdown, no backticks.`;

const LICENCE_EXTRACTION_PROMPT = `Extract the following from this regulatory licence or authorisation document:
- licence_number: licence or registration number
- regulatory_authority: name of the issuing regulator
- has_licence: always 'Yes' if this document exists
- regulated_status: type of authorisation if stated
- licence_date: date of issue if present
- permitted_activities: description of permitted activities if present

Return as JSON array of {fieldId, value} objects. No markdown, no backticks.`;

const ANNUAL_REPORT_EXTRACTION_PROMPT = `Extract the following from this annual report or financial statements document:
- annual_turnover_band: revenue range (return as a descriptive string e.g. 'Over £250 million')
- employee_count_band: number of employees or band
- operating_countries: countries where the company operates
- business_description: what the company does
- publicly_listed: Yes or No based on whether shares are publicly traded
- listed_where: stock exchange name if listed
- total_assets: total assets value or band if stated
- payout_transaction_countries: countries they send payments to if mentioned
- directors: names of board directors if listed
- ubo_names: parent company or major shareholders if disclosed

Return as JSON array of {fieldId, value} objects. No markdown, no backticks.`;

const ORG_CHART_EXTRACTION_PROMPT = `Extract the following from this ownership structure or org chart document:
- ubo_names: names of ultimate beneficial owners
- ubo_share_percentage: ownership percentages
- group_structure: description of corporate structure
- parent_company: immediate parent company name if shown

Return as JSON array of {fieldId, value} objects. No markdown, no backticks.`;

const AML_POLICY_EXTRACTION_PROMPT = `Extract the following from this AML policy document:
- aml_programme_in_place: always 'Yes' if this exists
- policies_updated_annually: Yes/No if stated
- pep_screening: Yes/No if PEP screening is mentioned
- transaction_monitoring_method: automated/manual/combination if stated
- suspicious_activity_reporting: Yes/No if stated
- record_retention_period: retention period if stated
- aml_policy_board_approved: Yes/No if stated

Return as JSON array of {fieldId, value} objects. No markdown, no backticks.`;

/* DOC_TYPES — single source of truth for which
   document slots exist, their UI presentation, the
   accepted MIME types, the badge label, the human-
   readable source name shown on Confirm, and the
   prompt to use when extracting.
   The `entities` field gates which cards render in
   the Document Upload step. */
const DOC_TYPES = [
  {
    key: "wolfsberg",
    icon: "📋",
    label: "Wolfsberg Questionnaire (CBDDQ)",
    helper: "Completed and signed Correspondent Banking Due Diligence Questionnaire. Extracts ~40 AML and compliance fields automatically.",
    accept: "application/pdf",
    accepts: ".pdf",
    badge: { text: "Most valuable", color: "#e0a040" },
    entities: ["FI"],
    sourceName: "Wolfsberg CBDDQ (uploaded)",
    extractionPrompt: WOLFSBERG_EXTRACTION_PROMPT,
    returnsObject: true, // legacy shape: { key: value, ... }
  },
  {
    key: "certificate",
    icon: "🏛",
    label: "Certificate of Incorporation",
    helper: "Issued by Companies House (UK), ACRA (SG), or equivalent registry. Extracts entity name, registration number, address, and incorporation date.",
    accept: "application/pdf",
    accepts: ".pdf",
    entities: ["FI", "Corporate", "Platform", "Direct"],
    sourceName: "Certificate of Incorporation (uploaded)",
    extractionPrompt: CERT_EXTRACTION_PROMPT,
  },
  {
    key: "licence",
    icon: "✅",
    label: "Regulatory Licence / Authorisation",
    helper: "FCA authorisation letter, MAS licence, or equivalent. Extracts licence number, regulatory authority, and permitted activities.",
    accept: "application/pdf",
    accepts: ".pdf",
    entities: ["FI"],
    sourceName: "Regulatory Licence (uploaded)",
    extractionPrompt: LICENCE_EXTRACTION_PROMPT,
  },
  {
    key: "annualReport",
    icon: "📊",
    label: "Annual Report",
    helper: "Most recent published annual report. Best for publicly listed institutions. Extracts turnover, employee count, operating countries, and products offered.",
    accept: "application/pdf",
    accepts: ".pdf",
    entities: ["FI", "Corporate", "Platform", "Direct"],
    sourceName: "Annual Report (uploaded)",
    extractionPrompt: ANNUAL_REPORT_EXTRACTION_PROMPT,
  },
  {
    key: "financialStatements",
    icon: "💰",
    label: "Audited Financial Statements",
    helper: "Alternative to annual report for private institutions. Extracts turnover band, total assets, and employee count.",
    accept: "application/pdf",
    accepts: ".pdf",
    entities: ["FI", "Corporate", "Platform", "Direct"],
    sourceName: "Audited Financial Statements (uploaded)",
    extractionPrompt: ANNUAL_REPORT_EXTRACTION_PROMPT,
  },
  {
    key: "orgChart",
    icon: "🏢",
    label: "Ownership Structure / Org Chart",
    helper: "Corporate structure chart showing UBOs and shareholding percentages. Extracts beneficial owner names and share percentages.",
    accept: "application/pdf,image/png,image/jpeg",
    accepts: ".pdf,.png,.jpg,.jpeg",
    entities: ["FI", "Corporate", "Platform", "Direct"],
    sourceName: "Ownership / Org Chart (uploaded)",
    extractionPrompt: ORG_CHART_EXTRACTION_PROMPT,
  },
  {
    key: "amlPolicy",
    icon: "🛡",
    label: "AML Policy & Procedures",
    helper: "Your institution's AML/CTF policy document. Confirms AML programme components in place.",
    accept: "application/pdf",
    accepts: ".pdf",
    entities: ["FI"],
    sourceName: "AML Policy (uploaded)",
    extractionPrompt: AML_POLICY_EXTRACTION_PROMPT,
  },
];

const initialUploadedDocs = () => Object.fromEntries(DOC_TYPES.map(d => [d.key, null]));

/* Map a generic extraction-prompt key onto an
   actual schema research field id. flow is "fi" or
   "corporate". Returns null if the key has no slot
   in the active schema (we drop those values).
   The Wolfsberg prompt has its own AI-driven
   mapping inside the prompt text and is handled
   separately. */
const EXTRACTION_KEY_TO_SCHEMA = {
  fi: {
    legal_name: "business_name",
    registration_number: "registration_number",
    incorporation_date: "incorporation_date",
    registered_address: "registered_address_line1",
    legal_form: null,
    country_of_incorporation: "registered_address_country",
    licence_number: "licence_number",
    regulatory_authority: "regulatory_authority",
    has_licence: "has_licence",
    regulated_status: null,
    licence_date: null,
    permitted_activities: null,
    annual_turnover_band: "annual_turnover",
    employee_count_band: "employee_count",
    operating_countries: "operating_countries",
    business_description: "business_activity_description",
    publicly_listed: "publicly_listed",
    listed_where: "listed_where",
    total_assets: null,
    payout_transaction_countries: "payout_transaction_countries",
    directors: "director_names",
    ubo_names: "ubo_parent_company",
    ubo_share_percentage: "ubo_share_percentage",
    group_structure: null,
    parent_company: "ubo_parent_company",
    aml_programme_in_place: null,
    policies_updated_annually: null,
    pep_screening: null,
    transaction_monitoring_method: null,
    suspicious_activity_reporting: null,
    record_retention_period: null,
    aml_policy_board_approved: null,
  },
  corporate: {
    legal_name: "tradeName",
    registration_number: "businessRegistrationNumber",
    incorporation_date: "registeredDate",
    registered_address: "addressLine1",
    legal_form: "businessType",
    country_of_incorporation: "registeredCountry",
    annual_turnover_band: "annualRevenue",
    employee_count_band: "employees",
    operating_countries: "countriesOfOperation",
    business_description: "industryDescription",
    publicly_listed: "stockListing",
    listed_where: "listedExchange",
    directors: "directors",
    ubo_names: "uboAnalysis",
    parent_company: "uboAnalysis",
  },
};

const mapExtractedKey = (flow, key) => {
  const m = EXTRACTION_KEY_TO_SCHEMA[flow] || {};
  return key in m ? m[key] : null;
};

/* ═══════════════════════════════════════════
   DOC SEARCH AGENT (Step 2 — Document Intelligence)
   Browser-side helpers for the doc search sub-agent
   (agents/docSearchAgent.js, called via /api/doc-search).
   mapToDocAgentOwnershipType is copied inline from
   agents/docSearchAgentCall.js — that file is a Node.js module and cannot
   be imported into the browser bundle.
   ═══════════════════════════════════════════ */

// HARDCODED — see PRODUCTION_READINESS.md PR-001
function mapToDocAgentOwnershipType(
  ownershipTypeId,
  entityTypeId,
  effectivelyListed
) {
  const entityIsFI = entityTypeId === "FI";

  const fiOwnershipTypes = new Set([
    "payment_institution",
    "correspondent_bank",
    "investment_fund",
    "insurance_company",
    "central_bank",
  ]);

  const ownershipIsFI =
    fiOwnershipTypes.has(ownershipTypeId);

  const isFI = entityIsFI || ownershipIsFI;

  const isListed =
    effectivelyListed ||
    ownershipTypeId === "public_listed";

  if (isFI && isListed)  return "public_fi";
  if (isFI && !isListed) return "fi_only";
  if (!isFI && isListed) return "public_only";
  return "corporate";
}

// Realistic demo doc-search results built from the actual Step 1 inputs.
// Used in demo mode / local dev so Section A renders without spending API
// tokens. Mirrors the response shape of /api/doc-search.
function buildDemoDocSearchResults(
  companyName,
  ownershipType,
  entityType
) {
  const now = new Date().toISOString();
  const year = new Date().getFullYear();
  const prevYear = year - 1;

  const isFI = entityType === "FI" ||
    ["payment_institution",
     "correspondent_bank"].includes(ownershipType);

  const isListed =
    ownershipType === "public_listed";

  const slug = companyName
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9_.]/g, "");

  // Domain-friendly slug for realistic, company-specific demo source URLs
  // (no underscores, lowercased, alphanumeric only — e.g. "hsbcholdings").
  const domainSlug = companyName
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 20);

  const documents = [];

  // Wolfsberg for FI entities
  if (isFI) {
    documents.push({
      type: "wolfsberg_questionnaire",
      label: "Wolfsberg Questionnaire",
      filename: `${slug}_Wolfsberg_Questionnaire_${year}.pdf`,
      year,
      status: "downloaded",
      sourceUrl: `https://www.${domainSlug}.com/compliance/wolfsberg-questionnaire`,
      sourceLabel: `${companyName} compliance page`,
      confidence: "high",
      localPath: `./downloads/${slug}_demo/wolfsberg.pdf`,
      searchAttempts: [
        `"${companyName}" Wolfsberg questionnaire PDF ${year}`,
        `"${companyName}" AML questionnaire correspondent banking`,
      ],
      cost: {
        inputTokens: 2841,
        outputTokens: 187,
        totalCostUSD: 0.01133,
      },
    });
  }

  // Annual report for listed or corporate
  if (isListed || !isFI) {
    documents.push({
      type: "annual_report",
      label: "Annual Report",
      filename: `${slug}_Annual_Report_${prevYear}.pdf`,
      year: prevYear,
      status: "downloaded",
      sourceUrl: `https://www.${domainSlug}.com/investors/results-and-announcements/annual-results-${prevYear}`,
      sourceLabel: `${companyName} investor relations`,
      confidence: "high",
      localPath: `./downloads/${slug}_demo/annual_report.pdf`,
      searchAttempts: [
        `"${companyName}" annual report ${prevYear} PDF`,
        `"${companyName}" annual report filetype:pdf investor relations`,
      ],
      cost: {
        inputTokens: 3654,
        outputTokens: 203,
        totalCostUSD: 0.01397,
      },
    });
  }

  const found = documents.filter(
    d => d.status === "downloaded"
  ).length;

  return {
    documents,
    // Mirrors the customer-facing column shape of the agent's
    // buildSummaryTable — no token/cost columns (internal-only data).
    summaryTable: documents.map(d => ({
      "Company Name": companyName,
      "Document Type": d.label,
      "Year": d.year,
      "Source": d.sourceLabel,
      "Source URL": d.sourceUrl,
      "Status": d.status === "downloaded"
        ? "✅ Downloaded"
        : "🔗 URL found (not downloaded)",
      "File": d.filename,
      "Notes": "",
    })),
    summary: {
      found,
      notFound: documents.length - found,
      total: documents.length,
    },
    cost: {
      model: "claude-sonnet-4-6",
      totals: {
        inputTokens: 6495,
        outputTokens: 390,
        totalTokens: 6885,
        totalCostUSD: 0.0253,
      },
    },
    searchedAt: now,
    isDemo: true,
  };
}


/* ═══════════════════════════════════════════
   TEST DATA — fills empty gap fields with
   plausible values for demos.
   ═══════════════════════════════════════════ */
const TEST_DATA = {
  applicantFirstName: "Jane",
  applicantLastName: "Smith",
  applicantEmail: "jane.smith@example.com",
  applicantMobile: "7700900123",
  applicantMobileCountryCode: "+44",
  applicantDateOfBirth: "1985-06-15",
  applicantNationality: "GB",
  applicantBirthCountry: "United Kingdom",
  applicantIsPEP: "No",
  applicantSharePercentage: "25",
  applicantPosition: "Director",
  natureOperatingCountries: "GB,US,SG",
  natureIndustryCodes: "IS131",
  natureIndustryDescription: "Software development and SaaS distribution to enterprise customers.",
  sizeTotalEmployees: "51-200",
  sizeAnnualTurnover: "5M - 25M",
  creditMonthlyVolume: "250,000 - 1,000,000",
  creditTopCountries: "GB,US,DE",
  debitMonthlyVolume: "50,000 - 250,000",
  debitTopCountries: "GB,SG,IN",
  intendedUses: "Customer payments, supplier disbursements, payroll, FX hedging.",
  sourceOfFunds: "Trading revenue and operating cashflow.",
  bankAccountName: "Acme Holdings Ltd",
  bankAccountNumber: "12345678",
  bankName: "HSBC UK",
  bankSortCode: "40-12-34",
  bankCurrency: "GBP",
  bankCountry: "United Kingdom",
};

/* ═══════════════════════════════════════════
   DUMMY RESEARCH VALUES — used by the
   "Dummy Research" button on Step 0 to simulate
   an API response without spending credits.
   ═══════════════════════════════════════════ */
const DUMMY_RESEARCH_VALUES = {
  // Corporate (UK + SG) research fields
  businessType: "Private Limited Company",
  businessRegistrationNumber: "12345678",
  registeredDate: "2015-03-12",
  registeredCountry: "United Kingdom",
  tradeName: "ACME Holdings",
  formerName: "ACME Inc.",
  website: "https://example.com",
  addressLine1: "123 Sample Street",
  addressLine2: "Suite 4B",
  city: "London",
  state: "Greater London",
  postcode: "EC1A 1AA",
  country: "United Kingdom",
  sicCode: "62012",
  annualRevenue: "£12,500,000",
  employees: "85",
  stockListing: "Not listed",
  leiNumber: "529900T8BM49AURSDO55",
  countriesOfOperation: "UK, US, SG",
  industryCodes: "62012, 70229",
  industryDescription: "Software development and SaaS distribution to enterprise customers.",
  isMultiLayered: "No",
  uboAnalysis: "John Smith (40%), Jane Doe (35%), Trustees (25%)",
  // directors / UBO research fields are parsed into structured stakeholder
  // records on Confirm — value is a JSON-encoded array of {full_name, role,
  // share_percentage} so the customer sees per-person cards instead of a
  // single text blob.
  directors: JSON.stringify([
    { full_name: "John Smith", role: "CEO" },
    { full_name: "Jane Doe", role: "CFO" },
    { full_name: "Mark Lee", role: "CTO" },
  ]),
  companySecretary: "Jane Doe",
  isPEP: "No",
  listedExchange: "Not listed",
  // FI research fields
  business_name: "ACME Financial Services Ltd",
  trading_name: "ACME Pay",
  business_activity_description: "Cross-border payment services for SMEs and individuals.",
  registration_number: "12345678",
  registered_address_line1: "123 Sample Street",
  registered_address_line2: "Suite 4B",
  registered_address_city: "London",
  registered_address_state: "Greater London",
  registered_address_postcode: "EC1A 1AA",
  registered_address_country: "United Kingdom",
  incorporation_date: "2015-03-12",
  annual_turnover: "$500,001–$1,500,000",
  employee_count: "51-250",
  operating_countries: "UK, US, SG",
  payout_transaction_countries: "GB, US, EU",
  industry_sector: "Financial Services / Payments",
  // Default demo company is private, so the full stakeholder gap forms show.
  // To test listed-company stakeholder suppression, change publicly_listed to
  // "Yes" (or add a listed_exchange / listedExchange result with a real
  // exchange name). Detection lives in detectPubliclyListed().
  publicly_listed: "No",
  listed_where: "—",
  has_licence: "Yes",
  regulatory_authority: "FCA",
  licence_number: "FRN 123456",
  has_branches: "Yes",
  branch_count: "12",
  branch_countries: "UK, DE, FR",
  services_other_fis: "Yes",
  cross_border_services: "Yes",
  issues_prepaid_cards: "No",
  non_resident_customers: "Yes",
  products_offered: "Cross-Border Payment Services",
  director_names: JSON.stringify([
    { full_name: "John Smith", role: "CEO" },
    { full_name: "Jane Doe", role: "CFO" },
    { full_name: "Mark Lee", role: "CTO" },
  ]),
  ubo_parent_company: JSON.stringify([
    { full_name: "ACME Group Holdings Ltd", role: "Parent Company", share_percentage: 100 },
  ]),
  ubo_share_percentage: "100% (wholly-owned subsidiary)",
  licence_suspended: "No",
  administration_proceedings: "No",
};

// Fixed-top banner shown to the customer flow whenever ?preview=true is set
// (or path is /preview). Two modes:
//   - normal blue: staged config loaded from sessionStorage; shows capture
//     timestamp and Close + Refresh controls
//   - amber: preview requested but no staged config in sessionStorage (e.g.
//     someone shared a /?preview=true link). Falls back to the published
//     config and offers a link into /admin to stage a real preview.
function PreviewBanner({ missing, timestamp }) {
  const bg = missing ? "#B45309" : "#0B3D91";
  const btnBase = {
    background: "rgba(255,255,255,0.2)",
    border: "1px solid rgba(255,255,255,0.4)",
    color: "#fff",
    borderRadius: 6,
    padding: "4px 12px",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
  };
  let capturedAt = "";
  if (timestamp) {
    try { capturedAt = ` — captured at ${new Date(timestamp).toLocaleTimeString()}`; }
    catch (_) { capturedAt = ""; }
  }
  return (
    <div style={{
      position: "fixed", top: 0, left: 0, right: 0, zIndex: 9999,
      background: bg, color: "#FFFFFF",
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "8px 20px",
      fontSize: 13, fontWeight: 600, fontFamily: "inherit",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{
          background: "#FFFFFF", color: bg,
          fontSize: 11, fontWeight: 800,
          padding: "2px 8px", borderRadius: 99, letterSpacing: "0.5px",
        }}>PREVIEW</span>
        <span>
          {missing
            ? "No preview config found — showing published version instead."
            : `Previewing unpublished changes${capturedAt}`}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ fontSize: 12, opacity: 0.85, fontWeight: 400 }}>
          {missing
            ? "Use the admin Preview button to stage your changes."
            : "This is not the live version. Submissions are disabled."}
        </span>
        {missing && (
          <button
            type="button"
            onClick={() => window.open("/admin", "_blank")}
            style={btnBase}
          >
            Go to admin →
          </button>
        )}
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={btnBase}
          title="Reload to pick up the latest staged config"
        >
          ↻ Refresh
        </button>
        <button
          type="button"
          onClick={() => window.close()}
          style={btnBase}
        >
          Close Preview ✕
        </button>
      </div>
    </div>
  );
}

// Fixed-top amber strip shown while demo mode is on. Stacks below the
// Preview banner via the offsetTop prop so both can coexist (admin running
// a preview of a demo flow).
function DemoBanner({ offsetTop = 0 }) {
  return (
    <div style={{
      position: "fixed",
      top: offsetTop,
      left: 0,
      right: 0,
      zIndex: 9998,
      background: "#FCD34D",
      color: "#92400E",
      textAlign: "center",
      padding: "6px",
      fontSize: 12,
      fontWeight: 700,
      letterSpacing: "0.3px",
      fontFamily: "inherit",
    }}>
      🧪 DEMO MODE — Sample data only. Not real company information.
    </div>
  );
}

// Small unobtrusive chip-shaped toggle used on the journey-selection screen.
// Only mounted when demoToggleVisible is true (localhost / ?demo / ?tenant).
function DemoToggle({ on, onChange }) {
  return (
    <label
      title="Skip API calls and pre-fill the flow with sample data — for demos and testing"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "5px 10px",
        border: `1.5px dashed ${on ? "#92400E" : "rgba(26,58,74,0.18)"}`,
        background: on ? "#FEF3C7" : "transparent",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 600,
        color: on ? "#92400E" : "#1a3a4a90",
        cursor: "pointer",
        userSelect: "none",
        fontFamily: "inherit",
      }}
    >
      <span>🧪 Demo mode</span>
      <span
        aria-hidden="true"
        style={{
          width: 26,
          height: 14,
          borderRadius: 999,
          background: on ? "#FCD34D" : "rgba(26,58,74,0.25)",
          position: "relative",
          transition: "background 0.15s",
        }}
      >
        <span
          style={{
            position: "absolute",
            top: 1,
            left: on ? 13 : 1,
            width: 12,
            height: 12,
            borderRadius: 999,
            background: "#fff",
            transition: "left 0.15s",
            boxShadow: "0 1px 2px rgba(0,0,0,0.2)",
          }}
        />
      </span>
      <input
        type="checkbox"
        checked={on}
        onChange={(e) => onChange(e.target.checked)}
        style={{ position: "absolute", opacity: 0, pointerEvents: "none" }}
      />
    </label>
  );
}

function StableInput({ id, label, type, value, onUpdate, required, options, placeholder }) {
  const ref = useRef(null);
  // Normalise the type so case/whitespace differences (e.g. "Date", " date ")
  // don't cause the wrong branch to render. Empty / unknown types fall back
  // to "text".
  const t = String(type || "text").toLowerCase().trim();
  // For date inputs, the browser requires YYYY-MM-DD; coerce here so an AI-
  // returned value like "12 January 2005" populates the picker correctly.
  const initial = t === "date" ? (normaliseDate(value) || "") : (value || "");
  const [local, setLocal] = useState(initial);
  useEffect(() => {
    setLocal(t === "date" ? (normaliseDate(value) || "") : (value || ""));
  }, [value, t]);
  const handleChange = useCallback((e) => { const v = e.target.value; setLocal(v); onUpdate(id, v); }, [id, onUpdate]);
  const sty = { width: "100%", padding: "10px 14px", borderRadius: 8, border: "1.5px solid rgba(26,58,74,0.14)", fontSize: 14, fontFamily: "inherit", color: "#1a3a4a", background: "#fff", outline: "none", boxSizing: "border-box" };

  const renderInput = () => {
    switch (t) {
      case "select":
        return (
          <select ref={ref} value={local} onChange={handleChange} style={{ ...sty, cursor: "pointer" }}>
            <option value="">Select...</option>
            {(options || []).map((o, i) => {
              // Support both shapes: legacy hardcoded gap fields use plain
              // strings (e.g. ["Yes","No"]); admin-saved fields use
              // { value, label } objects.
              const isObj = o && typeof o === "object";
              const optValue = isObj
                ? (o.value !== undefined && o.value !== null ? o.value : o.label)
                : o;
              const optLabel = isObj
                ? (o.label !== undefined && o.label !== null ? o.label : String(o.value))
                : o;
              return <option key={`${optValue}-${i}`} value={optValue}>{optLabel}</option>;
            })}
          </select>
        );
      case "textarea":
        return (
          <textarea ref={ref} value={local} onChange={handleChange} placeholder={placeholder} rows={3} style={{ ...sty, resize: "vertical" }} />
        );
      case "file":
        return (
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <input
              ref={ref}
              type="file"
              onChange={(e) => {
                const f = e.target.files && e.target.files[0];
                const name = f ? f.name : "";
                setLocal(name);
                onUpdate(id, name);
              }}
              style={{ ...sty, padding: "8px 10px", cursor: "pointer" }}
            />
            {local && <span style={{ fontSize: 11, color: "#4a9e8e", fontWeight: 600, whiteSpace: "nowrap" }}>✓ {local}</span>}
          </div>
        );
      case "date":
        return (
          <input ref={ref} type="date" value={local} onChange={handleChange} style={sty} />
        );
      case "number":
        return (
          <input ref={ref} type="number" value={local} onChange={handleChange} placeholder={placeholder} style={sty} />
        );
      case "email":
        return (
          <input ref={ref} type="email" value={local} onChange={handleChange} placeholder={placeholder} style={sty} />
        );
      case "tel":
        return (
          <input ref={ref} type="tel" value={local} onChange={handleChange} placeholder={placeholder} style={sty} />
        );
      case "text":
      default:
        return (
          <input ref={ref} type="text" value={local} onChange={handleChange} placeholder={placeholder} style={sty} />
        );
    }
  };

  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#1a3a4a", marginBottom: 5 }}>{label} {required && <span style={{ color: "#d44" }}>*</span>}</label>
      {renderInput()}
    </div>
  );
}

// A field that was pre-populated from the AI research (e.g. nationality / date
// of birth a director's registry record carried). Shown as a locked value with
// a source badge — but, unlike the fully-locked name, the customer can click
// "Edit" to override it. When the value is empty it falls straight through to
// the editable input so nothing is pre-filled. Module-scoped so its `editing`
// state survives parent re-renders (same reason StableInput lives out here).
function PrePopulatedField({ id, label, value, displayValue, type, onUpdate, sourceLabel, required, placeholder, options, startEditing }) {
  const [editing, setEditing] = useState(!!startEditing);
  const labelStyle = { display: "block", fontSize: 12, fontWeight: 600, color: C.text, marginBottom: 5 };

  if (editing || !value) {
    return (
      <div style={{ marginBottom: 14 }}>
        <StableInput
          id={id}
          label={label}
          type={type || "text"}
          value={value || ""}
          onUpdate={onUpdate}
          required={required}
          placeholder={placeholder}
          options={options}
        />
        {value && (
          <button
            type="button"
            onClick={() => setEditing(false)}
            style={{ fontSize: 11, color: C.textMuted, background: "none", border: "none", cursor: "pointer", padding: "2px 0", fontFamily: "inherit" }}
          >
            Cancel edit
          </button>
        )}
      </div>
    );
  }

  return (
    <div style={{ marginBottom: 14 }}>
      <label style={labelStyle}>{label} {required && <span style={{ color: "#d44" }}>*</span>}</label>
      <div style={{
        padding: "10px 14px", background: C.infoBg, borderRadius: 8,
        border: `1px solid ${C.infoBorder}`, fontSize: 14, color: C.text,
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
      }}>
        <span>{displayValue || value}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <span style={{ fontSize: 11, color: C.info, fontWeight: 600 }}>~ {sourceLabel || "Found"}</span>
          <button
            type="button"
            onClick={() => setEditing(true)}
            style={{ fontSize: 11, color: C.niumBlue, background: "none", border: `1px solid ${C.niumBlue}`, borderRadius: 4, padding: "2px 8px", cursor: "pointer", fontFamily: "inherit" }}
          >
            Edit
          </button>
        </div>
      </div>
    </div>
  );
}

export default function KYCAgent({ previewMode = false } = {}) {
  // Tenant config — loaded from /api/config on mount, or from sessionStorage
  // when running in preview mode (the admin "Preview" button stages the
  // current unsaved config under the "preview_config" key).
  //
  // Tenant resolution comes from the URL (?tenant=X) so this component can
  // serve any tenant; "nium" is the default for plain /. Preview mode is
  // either triggered by the /preview route (index.js sets previewMode prop)
  // or by ?preview=true in the URL.
  const [tenantId] = useState(() => getTenantId());
  const [tenantConfig, setTenantConfig] = useState(null);
  const [configLoading, setConfigLoading] = useState(true);
  const inPreview = previewMode || isPreviewMode();
  // Timestamp the staged preview config was captured (admin click time). Shown
  // in the preview banner so the admin can tell whether the tab is stale.
  const [previewTimestamp, setPreviewTimestamp] = useState(null);
  // True when /?preview=true is set but no sessionStorage staged config was
  // found — banner switches to amber + "go to admin" link.
  const [previewMissing, setPreviewMissing] = useState(false);

  // Demo mode — when on, all journeys short-circuit to doDummyResearch so the
  // flow renders instantly with sample data. Initialised from ?demo=true or
  // a prior sessionStorage opt-in so it survives step navigation.
  const [demoMode, setDemoModeState] = useState(() => {
    try {
      const params = typeof window !== "undefined"
        ? new URLSearchParams(window.location.search)
        : null;
      if (params && params.get("demo") === "true") return true;
      if (typeof sessionStorage !== "undefined"
          && sessionStorage.getItem("demo_mode") === "true") return true;
    } catch (_) { /* ignore */ }
    return false;
  });
  const setDemoMode = useCallback((next) => {
    setDemoModeState(next);
    try {
      if (next) sessionStorage.setItem("demo_mode", "true");
      else sessionStorage.removeItem("demo_mode");
    } catch (_) { /* ignore */ }
  }, []);
  // Visibility gate — the toggle is hidden on production end-customer URLs.
  // Surfaces when ?demo=true is in the URL, on localhost, or when a ?tenant=
  // override is being used (admin/dev/testing contexts).
  const demoToggleVisible = (() => {
    if (typeof window === "undefined") return false;
    try {
      const p = new URLSearchParams(window.location.search);
      if (p.get("demo") === "true") return true;
      if (p.get("tenant")) return true;
      const host = window.location.hostname;
      if (host === "localhost" || host === "127.0.0.1") return true;
    } catch (_) { /* ignore */ }
    return false;
  })();

  useEffect(() => {
    let cancelled = false;
    // Preview can be triggered two ways: index.js route /preview (sets the
    // previewMode prop) OR admin Preview button which opens /?preview=true
    // (detected by isPreviewMode()). Both should load the staged config
    // from sessionStorage, not the live /api/config.
    const previewActive = previewMode || isPreviewMode();
    if (previewActive) {
      try {
        // sessionStorage is the canonical channel (written by the admin Preview
        // button). Fall back to legacy localStorage for tabs opened before the
        // sessionStorage migration.
        const raw = sessionStorage.getItem("preview_config")
          || localStorage.getItem("preview_config");
        const ts = sessionStorage.getItem("preview_timestamp")
          || localStorage.getItem("preview_config_ts");
        if (raw) {
          setTenantConfig(JSON.parse(raw));
          setPreviewTimestamp(ts || null);
          setPreviewMissing(false);
          setConfigLoading(false);
          return () => {};
        }
      } catch (_) { /* fall through */ }
      // No staged config — surface this in the banner and fall through to the
      // normal API fetch so the page still has SOMETHING to render.
      setPreviewMissing(true);
    }
    const url = `/api/config?tenant=${encodeURIComponent(tenantId)}`;
    fetch(url, { cache: "no-store" })
      .then((r) => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((cfg) => { if (!cancelled) { setTenantConfig(cfg); setConfigLoading(false); } })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.warn("Falling back to local default config:", err.message);
        if (!cancelled) {
          setTenantConfig(buildLocalDefaultConfig());
          setConfigLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [previewMode, tenantId]);

  const [step, setStep] = useState(0);

  // ─── Landing page / agent selection ───
  // The correct pre-boarding access code (kept as a constant, not inlined).
  const PREBOARDING_PASSWORD = "ARCH";
  // Which agent the user selected.
  //   null = on landing page · "onboarding" = existing flow · "preboarding" = pre-boarding agent
  const [agentType, setAgentType] = useState(null);
  // Pre-boarding password gate state.
  const [preboardingUnlocked, setPreboardingUnlocked] = useState(false);
  const [preboardingPassword, setPreboardingPassword] = useState("");
  const [preboardingPasswordError, setPreboardingPasswordError] = useState(false);
  // Scroll to top on every step transition. React keeps the previous scroll
  // position by default — undesirable for a stepped wizard where the new
  // page's heading should be visible immediately. The smooth scroll here
  // is the catch-all; for user-triggered Next clicks we also scroll
  // instantly before the new step renders (see scrollAndSetStep below) so
  // there is no flash of the previous page's bottom.
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [step]);
  const scrollAndSetStep = useCallback((next) => {
    if (typeof window !== "undefined") {
      try { window.scrollTo({ top: 0, behavior: "instant" }); }
      catch (_) { window.scrollTo(0, 0); }
    }
    setStep(next);
  }, []);
  const [companyName, setCompanyName] = useState("");
  const [countryCode, setCountryCode] = useState("");
  const [entityType, setEntityType] = useState("");
  // Ownership type (Step 1) — drives the Phase 0 research strategy. Reset to ""
  // whenever the entity type changes, since each entity type exposes a
  // different set of allowed ownership types.
  const [ownershipType, setOwnershipType] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [research, setResearch] = useState(null);
  // Coverage analysis (Phase 2) for the current research result. Null until the
  // first research pass completes.
  const [coverage, setCoverage] = useState(null);
  // Whether the Phase 3 gap-recovery second pass ran for the current result.
  const [gapRecoveryRan, setGapRecoveryRan] = useState(false);
  // Transient status line shown on the research loader between/within passes.
  const [researchStatus, setResearchStatus] = useState("");
  const [researchTimestamp, setResearchTimestamp] = useState("");
  // DRS (document requirements service) session state. Populated when the
  // customer completes the dynamic documents step; consumed by the
  // pre-declaration gap gate (Step5Recompute).
  const [drsSubmitted, setDrsSubmitted] = useState([]);   // submittedRequirements[]
  const [drsFlags, setDrsFlags] = useState({});           // feature flags from Step 2
  const [drsGapsCleared, setDrsGapsCleared] = useState(false); // declaration gate
  // Derived: is the company being onboarded publicly listed? Drives the
  // stakeholder-EDD suppression on Fill Gaps (listed-company directors and
  // sub-25% UBOs skip the detailed gap form).
  const isPubliclyListed = useMemo(() => detectPubliclyListed(research), [research]);
  const [checks, setChecks] = useState({});
  // Per-person rejection for stakeholder fields. Shape:
  //   { [fieldId]: Set<stakeholderId> }
  // A stakeholder id present in the set means the customer unchecked that
  // person on Confirm. Sets are recreated immutably on every toggle.
  const [rejectedStakeholders, setRejectedStakeholders] = useState({});
  // Which stakeholder cards are expanded on Confirm, keyed by stakeholder id.
  // Absent / false = collapsed. All cards start collapsed.
  const [expandedStakeholders, setExpandedStakeholders] = useState({});
  // Manual "this is a publicly listed company" toggle on Confirm. When on, it
  // suppresses stakeholder EDD forms on Fill Gaps the same way auto-detection
  // would (see effectivelyListed below).
  const [isPubliclyListedOverride, setIsPubliclyListedOverride] = useState(false);
  // Single source of truth for "treat as listed" — auto-detected OR manually
  // declared on Confirm. Used by the gap forms, validation, the Fill Gaps
  // caller, and the submission payload so the behaviour stays consistent.
  const effectivelyListed = isPubliclyListed || isPubliclyListedOverride;
  const [revealedTs, setRevealedTs] = useState({});
  const gapRef = useRef({});
  // Per-person stakeholder data on Fill Gaps. Parallel to gapRef, but each
  // field id maps to an array of stakeholder records (objects with full_name,
  // nationality, date_of_birth, is_pep, etc). Kept in a ref so text-field
  // edits don't churn the whole tree every keystroke. setStakeholderVersion
  // is the explicit re-render trigger for changes that need to surface to
  // the UI (add/remove/select/toggle/text).
  const stakeholdersRef = useRef({});
  const [, setStakeholderVersion] = useState(0);
  const [stakeholderErrors, setStakeholderErrors] = useState([]);
  // Per-granular-field green ticks for stakeholders on Confirm, mirroring the
  // per-field `checks` design for regular rows. Shape: { [stakeholderId]:
  // { [fieldKey]: boolean } }. A found field defaults to confirmed (ticked);
  // unticking routes that field to the next page for editing.
  const [stakeholderFieldChecks, setStakeholderFieldChecks] = useState({});
  // bumped whenever we mutate gapRef from outside the input (e.g. test-data fill)
  // so StableInput components re-sync from the new ref values.
  const [, setFormVersion] = useState(0);
  const [declared, setDeclared] = useState(false);
  const [done, setDone] = useState(false);
  const [device, setDevice] = useState({});
  const [loaderIdx, setLoaderIdx] = useState(0);
  const [loaderPhase, setLoaderPhase] = useState(0); // 0 = no Wolfsberg, 1 = extraction, 2 = web research
  const [submitTs, setSubmitTs] = useState("");
  const [activeSchema, setActiveSchema] = useState(null);
  const [uploadedDocs, setUploadedDocs] = useState(initialUploadedDocs());
  // Journey selection (Part 1) — lives between Step 1 input and the rest.
  const [journeyType, setJourneyType] = useState("");          // "ai_documents" | "ai_only" | "manual" | ""
  const [journeyOpen, setJourneyOpen] = useState(false);
  const [selectedJourneyCard, setSelectedJourneyCard] = useState(null); // "A" | "B" | "C"
  const [manualOpened, setManualOpened] = useState(false);
  // Part 5 — silent metadata trail of every pre-fill / customer action.
  const [fieldMetadata, setFieldMetadata] = useState([]);
  // Loader messages — replaced per-run in doResearch when documents are
  // being processed. Phase 0 = web only, Phase 1 = doc extraction, Phase 2 = web.
  const [phase1Msgs, setPhase1Msgs] = useState(LOADER_MSGS_WOLFSBERG_PHASE1);

  // Doc search agent state (Step 2 — Document Intelligence, Section A).
  // null = not yet run; otherwise the /api/doc-search response shape
  // { documents, summaryTable, summary, cost, searchedAt, isDemo? }.
  const [docSearchResults, setDocSearchResults] = useState(null);
  const [docSearchLoading, setDocSearchLoading] = useState(false);
  const [docSearchError, setDocSearchError] = useState(null);

  // Tracks real token counts and costs from every API call in this journey.
  // Null for a phase means that phase did not run yet. Captured from the
  // Anthropic `usage` object (research/extraction) and the doc-search agent's
  // own CostTracker (doc search).
  const [costTracker, setCostTracker] = useState({
    docSearch: null,
    researchPass1: null,
    researchPass2: null,
    docExtraction: null,
  });
  // Which auto-found documents the customer has accepted for use in research.
  // Shape: Set of document types, e.g. Set(["wolfsberg_questionnaire"]).
  const [acceptedDocTypes, setAcceptedDocTypes] = useState(new Set());

  // Step routing: ai_documents flow inserts a Documents step between Input and Research.
  // stepsFor() takes a journey explicitly so async handlers can compute the
  // correct step index without relying on a stale state closure (e.g. during
  // back-and-forth navigation between Documents and Journey).
  const stepsFor = (j) => j === "ai_documents"
    ? { input: 0, documents: 1, research: 2, confirm: 3, fillGaps: 4, documentRequirements: 5, declare: 6 }
    : { input: 0, research: 1, confirm: 2, fillGaps: 3, documentRequirements: 4, declare: 5 };
  const isAiDocs = journeyType === "ai_documents";
  const STEPS = stepsFor(journeyType);
  const stepNames = isAiDocs
    ? ["Company", "Documents", "Research", "Confirm", "Fill Gaps", "Required Docs", "Declare"]
    : ["Company", "Research", "Confirm", "Fill Gaps", "Required Docs", "Declare"];

  // Loader messages — three modes: no docs (existing), doc-extraction phase, web phase.
  const loaderMsgs = loaderPhase === 1
    ? phase1Msgs
    : loaderPhase === 2
      ? LOADER_MSGS_WOLFSBERG_PHASE2
      : LOADER_MSGS;

  useEffect(() => {
    if (!loading) return;
    const t = setInterval(() => setLoaderIdx(i => Math.min(i + 1, loaderMsgs.length - 1)), 2500);
    return () => clearInterval(t);
  }, [loading, loaderMsgs]);

  useEffect(() => {
    const fetchIP = async () => { try { const r = await fetch("https://api.ipify.org?format=json"); const d = await r.json(); return d.ip; } catch { return "Could not detect"; } };
    fetchIP().then(ip => setDevice({ ipAddress: ip, userAgent: navigator.userAgent, platform: navigator.platform, language: navigator.language, screenRes: window.screen.width + "x" + window.screen.height, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }));
  }, []);

  const countryObj = COUNTRIES.find(c => c.code === countryCode);

  // Fields referenced by any other field's dependsOn — when their value changes
  // we bump formVersion so conditional fields show/hide. Computed once per
  // schema change so text-field updates stay cheap. Also tracks
  // `corrected_<researchField>` for deps whose parent now lives in researchFields.
  const parentFieldsRef = useRef(new Set());
  useEffect(() => {
    const s = new Set();
    if (activeSchema) {
      activeSchema.gapFields.forEach(f => {
        if (f.dependsOn) Object.keys(f.dependsOn).forEach(k => {
          s.add(k);
          if (activeSchema.researchFields.some(rf => rf.field === k)) {
            s.add("corrected_" + k);
          }
        });
      });
    }
    parentFieldsRef.current = s;
  }, [activeSchema]);

  const updateGap = useCallback((field, value) => {
    gapRef.current[field] = value;
    if (parentFieldsRef.current.has(field)) setFormVersion(v => v + 1);
  }, []);

  // Effective parent value for dependsOn evaluation:
  //   1. customer correction (if user unchecked the research item and entered a new value)
  //   2. direct gap-field value
  //   3. AI-researched value
  const dependsOnSatisfied = (g) => {
    if (!g.dependsOn) return true;
    return Object.entries(g.dependsOn).every(([k, v]) => {
      const corrected = gapRef.current["corrected_" + k];
      if (corrected !== undefined && corrected !== "") return corrected === v;
      const gap = gapRef.current[k];
      if (gap !== undefined && gap !== "") return gap === v;
      if (research && research.found) {
        const item = research.found.find(it => it.field === k);
        if (item) return item.value === v;
      }
      return false;
    });
  };

  const resetAll = () => {
    setStep(STEPS.input); setResearch(null); setActiveSchema(null);
    setChecks({}); setRejectedStakeholders({}); setExpandedStakeholders({}); setIsPubliclyListedOverride(false); setRevealedTs({}); setResearchTimestamp("");
    gapRef.current = {}; setFormVersion(v => v + 1);
    stakeholdersRef.current = {}; setStakeholderVersion(v => v + 1); setStakeholderErrors([]);
    setStakeholderFieldChecks({});
    setError(""); setDeclared(false);
    setUploadedDocs(initialUploadedDocs());
    setJourneyType(""); setJourneyOpen(false); setSelectedJourneyCard(null); setManualOpened(false);
    setFieldMetadata([]);
    setLoaderPhase(0);
    setCoverage(null); setGapRecoveryRan(false); setResearchStatus("");
    setDrsSubmitted([]); setDrsFlags({}); setDrsGapsCleared(false);
    setDocSearchResults(null); setDocSearchLoading(false); setDocSearchError(null); setAcceptedDocTypes(new Set());
    setCostTracker({ docSearch: null, researchPass1: null, researchPass2: null, docExtraction: null });
    // Return to the landing page (agent selection) on a full reset.
    setAgentType(null);
    setPreboardingUnlocked(false);
    setPreboardingPassword("");
    setPreboardingPasswordError(false);
  };

  // Fire-and-forget event tracking → /api/track-event. Never awaited, never
  // blocks the UI. Failures are swallowed (tracking must never break the flow).
  function trackEvent(eventType, eventData = {}) {
    fetch("/api/track-event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantId,
        eventType,
        eventData,
        sessionId: null, // no session yet at the landing page
        timestamp: new Date().toISOString(),
      }),
    }).catch((err) => console.warn("[trackEvent] Failed:", err));
  }

  // Landing page viewed — fires on mount and whenever the user returns to the
  // agent-selection screen (agentType back to null).
  useEffect(() => {
    if (agentType === null) {
      trackEvent("landing_page_viewed", {
        url: window.location.href,
        referrer: document.referrer || null,
        isDemo: demoMode || false,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentType]);

  // Pre-boarding coming-soon screen viewed (after a correct password).
  useEffect(() => {
    if (agentType === "preboarding" && preboardingUnlocked) {
      trackEvent("preboarding_coming_soon_viewed", {
        viewedAt: new Date().toISOString(),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentType, preboardingUnlocked]);

  const isStakeholderRejected = (fieldId, stakeholderId) => {
    const set = rejectedStakeholders[fieldId];
    return set ? set.has(stakeholderId) : false;
  };

  const toggleStakeholderRejection = (fieldId, stakeholderId) => {
    setRejectedStakeholders((prev) => {
      const current = new Set(prev[fieldId] ? Array.from(prev[fieldId]) : []);
      if (current.has(stakeholderId)) current.delete(stakeholderId);
      else current.add(stakeholderId);
      return { ...prev, [fieldId]: current };
    });
  };

  // Per-granular-field green-tick state for a stakeholder. Found fields default
  // to confirmed (true); unticking routes the field to the next page for edit.
  const isStkFieldConfirmed = (stakeholderId, key) => {
    const m = stakeholderFieldChecks[stakeholderId];
    return m && key in m ? m[key] : true;
  };
  const toggleStkFieldConfirm = (stakeholderId, key) => {
    setStakeholderFieldChecks((prev) => {
      const cur = prev[stakeholderId] || {};
      const curVal = key in cur ? cur[key] : true;
      return { ...prev, [stakeholderId]: { ...cur, [key]: !curVal } };
    });
  };

  const isStakeholderExpanded = (id) => expandedStakeholders[id] === true;
  const toggleStakeholderExpanded = (id) => {
    setExpandedStakeholders((prev) => ({ ...prev, [id]: !prev[id] }));
  };
  const setStakeholdersExpanded = (ids, expanded) => {
    setExpandedStakeholders((prev) => {
      const next = { ...prev };
      ids.forEach((id) => { next[id] = expanded; });
      return next;
    });
  };

  // Read + write helpers for per-person stakeholder data on Fill Gaps. The
  // ref is the source of truth; setStakeholderVersion bumps the explicit
  // re-render counter so completion badges, PEP-details visibility, and
  // validation messaging stay in sync with what's in the ref.
  const getStakeholders = (fieldId) => stakeholdersRef.current[fieldId] || [];
  const setStakeholders = (fieldId, arr) => {
    stakeholdersRef.current = { ...stakeholdersRef.current, [fieldId]: arr };
    setStakeholderErrors([]);
    setStakeholderVersion((v) => v + 1);
  };
  const updateStakeholderField = (fieldId, stakeholderId, key, value) => {
    const current = getStakeholders(fieldId);
    const next = current.map((s) => (s.id === stakeholderId ? { ...s, [key]: value } : s));
    setStakeholders(fieldId, next);
  };
  const addStakeholder = (fieldId, overrides = {}) => {
    const current = getStakeholders(fieldId);
    setStakeholders(fieldId, [...current, makeStakeholder({ customer_added: true, ...overrides })]);
  };
  const removeStakeholder = (fieldId, stakeholderId) => {
    const current = getStakeholders(fieldId);
    setStakeholders(fieldId, current.filter((s) => s.id !== stakeholderId));
  };

  // True when a stakeholder is a company rather than a natural person. Set by
  // enrichStakeholders (heuristic for AI-found) or explicitly when the customer
  // adds a company. Drives the corporate vs person field shape everywhere.
  const isCorporateStakeholder = (s) => !!(s && s.is_company);

  // Repeatable positions ([{ title, start_date }]) for corporate stakeholders.
  const addStkPosition = (fieldId, sid) => {
    const s = getStakeholders(fieldId).find((x) => x.id === sid);
    const positions = [...((s && s.positions) || []), { title: "", start_date: "" }];
    updateStakeholderField(fieldId, sid, "positions", positions);
  };
  const updateStkPosition = (fieldId, sid, idx, key, value) => {
    const s = getStakeholders(fieldId).find((x) => x.id === sid);
    const positions = ((s && s.positions) || []).map((p, i) => (i === idx ? { ...p, [key]: value } : p));
    updateStakeholderField(fieldId, sid, "positions", positions);
  };
  const removeStkPosition = (fieldId, sid, idx) => {
    const s = getStakeholders(fieldId).find((x) => x.id === sid);
    const positions = ((s && s.positions) || []).filter((_, i) => i !== idx);
    updateStakeholderField(fieldId, sid, "positions", positions);
  };

  // Initialise / re-sync stakeholdersRef from research.found whenever we
  // enter Fill Gaps. Preserves user edits across navigation: any
  // stakeholder id that's already in the ref keeps its existing fields and
  // only has its customer_rejected flag re-applied from the current
  // rejectedStakeholders set. New ids from research get seeded; manually
  // added (customer_added=true) entries are preserved verbatim.
  const initStakeholdersForFillGaps = useCallback(() => {
    if (!research || !Array.isArray(research.found)) return;
    const nextMap = { ...stakeholdersRef.current };
    research.found.forEach((result) => {
      if (!isStakeholderField(result.field)) return;
      if (!Array.isArray(result.stakeholders) || result.stakeholders.length === 0) return;
      const fieldId = result.field;
      // Registry exemption notices are not people — keep them out of the ref so
      // they can never become a person card or EDD form.
      const aiStakeholders = result.stakeholders.filter((s) => !isRegistryExemptionNotice(s));
      const existing = nextMap[fieldId] || [];
      const existingById = new Map(existing.map((s) => [s.id, s]));
      const rejectedIds = rejectedStakeholders[fieldId] || new Set();
      const aiIds = new Set(aiStakeholders.map((s) => s.id));

      const seeded = aiStakeholders.map((ai) => {
        const prior = existingById.get(ai.id);
        const isRejected = rejectedIds.has(ai.id);
        if (prior) {
          // Preserve customer edits; only re-apply the rejection flag and the
          // name-clearing behaviour for newly-rejected entries.
          if (isRejected && !prior.customer_rejected) {
            return {
              ...prior,
              customer_rejected: true,
              full_name_original: prior.full_name_original || ai.full_name,
              full_name: "",
            };
          }
          if (!isRejected && prior.customer_rejected) {
            return {
              ...prior,
              customer_rejected: false,
              full_name: prior.full_name || prior.full_name_original || ai.full_name,
            };
          }
          return { ...prior, customer_rejected: isRejected };
        }
        // First seed for this person.
        if (isRejected) {
          return {
            ...ai,
            customer_rejected: true,
            full_name_original: ai.full_name,
            full_name: "",
          };
        }
        return { ...ai, customer_rejected: false };
      });

      // Keep customer-added persons that aren't part of the AI list.
      const customerAdded = existing.filter((s) => s.customer_added && !aiIds.has(s.id));
      nextMap[fieldId] = [...seeded, ...customerAdded];
    });
    stakeholdersRef.current = nextMap;
    setStakeholderVersion((v) => v + 1);
  }, [research, rejectedStakeholders]);

  useEffect(() => {
    if (step === STEPS.fillGaps) initStakeholdersForFillGaps();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, research, rejectedStakeholders]);

  const fillTestData = () => {
    getCombinedGaps().forEach(g => {
      const current = gapRef.current[g.field];
      if (current && String(current).trim().length > 0) return;
      let val = TEST_DATA[g.field];
      if (val === undefined && g.field.startsWith("corrected_")) {
        const original = g.field.replace(/^corrected_/, "");
        val = TEST_DATA[original] || "Corrected value";
      }
      if (val === undefined) {
        val = g.inputType === "select" && g.options && g.options.length > 0 ? g.options[0] : "Sample value";
      }
      gapRef.current[g.field] = val;
    });
    setFormVersion(v => v + 1);

    // Also fill stakeholder compliance fields for any per-person cards
    // currently in stakeholdersRef. Doesn't add new people, doesn't overwrite
    // already-filled fields — keeps existing edits intact and just paints
    // sensible demo values into the blanks.
    const demoCountry = countryObj ? countryObj.name : "United Kingdom";
    const demoIdType = "passport";
    const demoIdNum = "GB1234567";
    const demoDob = "1980-05-15";
    const demoNationality = countryCode === "GB" ? "British" : countryCode === "SG" ? "Singaporean" : "British";
    let touched = false;
    Object.keys(stakeholdersRef.current || {}).forEach((fieldId) => {
      const list = stakeholdersRef.current[fieldId] || [];
      const next = list.map((s) => {
        const out = { ...s };
        if (!out.full_name && out.customer_rejected && out.full_name_original) {
          out.full_name = out.full_name_original;
        }
        if (!out.full_name && out.customer_added) out.full_name = "Demo Person";
        if (!out.nationality) out.nationality = demoNationality;
        if (!out.date_of_birth) out.date_of_birth = demoDob;
        if (!out.residential_country) out.residential_country = demoCountry;
        if (!out.id_type) out.id_type = demoIdType;
        if (!out.id_number) out.id_number = demoIdNum;
        if (out.is_pep === null || out.is_pep === undefined) out.is_pep = false;
        return out;
      });
      stakeholdersRef.current[fieldId] = next;
      touched = true;
    });
    if (touched) {
      setStakeholderErrors([]);
      setStakeholderVersion(v => v + 1);
    }
  };

  // Unified post-Confirm gap list.
  //   1. corrections — fields the user unchecked on Confirm (any tier)
  //   2. missing_research — research fields the AI couldn't find from
  //      any source (rendered as plain text inputs, optional)
  //   3. schema.gapFields — always-manual fields
  const getCombinedGaps = () => {
    if (!research || !activeSchema) return [];
    const apiGaps = research.gaps || activeSchema.gapFields;

    // Corrections — fields the user unchecked on Confirm. We must preserve
    // the original field's inputType and (for selects) options so the
    // correction is collected with the same UI as the original; defaulting
    // to "text" would mean a dropdown loses its option list at this point.
    const unchecked = (research.found || [])
      .filter((item, i) => !checks[i])
      .map(item => {
        const def = findFieldDef(activeSchema, item.field) || {};
        return {
          field: "corrected_" + item.field,
          label: item.label + " (correction needed)",
          reason: "Original: " + resolveDisplayValue(def, item.value),
          inputType: def.inputType || "text",
          options: def.options || undefined,
          dependsOn: def.dependsOn || undefined,
          required: true,
          section: "corrections",
        };
      });

    // Missing research — fields the AI couldn't find. Same principle: keep
    // the configured inputType/options so a dropdown stays a dropdown.
    const foundIds = new Set((research.found || []).map(i => i.field));
    const missingResearch = (activeSchema.researchFields || [])
      .filter(rf => !foundIds.has(rf.field))
      .map(rf => ({
        field: rf.field,
        label: rf.label,
        inputType: rf.inputType || "text",
        options: rf.options || undefined,
        dependsOn: rf.dependsOn || undefined,
        required: false,
        section: "missing_research",
      }));

    return [...unchecked, ...missingResearch, ...apiGaps];
  };

  const allGapsFilled = () => getCombinedGaps().filter(g => g.required).every(g => {
    if (!dependsOnSatisfied(g)) return true;
    const v = gapRef.current[g.field];
    if (!v || !String(v).trim()) return false;
    return true;
  });

  // ─── Single-doc extraction helper. Returns { docFound, wolfsbergFields, raw }.
  // - docFound: array of result rows tagged sourceTier:"document"
  // - wolfsbergFields: only populated for the Wolfsberg slot (legacy object format),
  //     used to seed the web prompt so the AI doesn't re-search those fields.
  // - raw: parsed JSON for the by-doc audit map.
  const extractFromDoc = async (docType, file, schema, flow, fetchTs) => {
    const base64 = await readFileAsBase64(file);
    const mediaType = file.type === "image/png" || file.type === "image/jpeg" ? file.type : "application/pdf";
    const isImage = mediaType.startsWith("image/");
    const blockType = isImage ? "image" : "document";
    const resp = await fetch("/api/research", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 4096,
        tools: [],
        messages: [{
          role: "user",
          content: [
            { type: blockType, source: { type: "base64", media_type: mediaType, data: base64 } },
            { type: "text", text: docType.extractionPrompt },
          ],
        }],
      }),
    });
    if (!resp.ok) {
      // eslint-disable-next-line no-console
      console.warn(`Extraction call failed for ${docType.key}`, resp.status);
      return { docFound: [], wolfsbergFields: {}, raw: null, usage: null };
    }
    const respData = await resp.json();
    const usage = respData.usage || null;
    const txt = (respData.content || []).filter(b => b.type === "text").map(b => b.text).join("");
    const cleaned = txt.replace(/^```json\s*/i, "").replace(/^```/i, "").replace(/```\s*$/i, "").trim();
    if (docType.returnsObject) {
      // Wolfsberg legacy shape — let the web prompt do the field-id mapping.
      try {
        const parsed = JSON.parse(cleaned);
        const filtered = Object.fromEntries(Object.entries(parsed).filter(([, v]) => v !== null && v !== ""));
        return { docFound: [], wolfsbergFields: filtered, raw: filtered, usage };
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn(`Could not parse Wolfsberg extraction`, e, txt);
        return { docFound: [], wolfsbergFields: {}, raw: null, usage };
      }
    }
    try {
      const arr = JSON.parse(cleaned);
      if (!Array.isArray(arr)) return { docFound: [], wolfsbergFields: {}, raw: arr, usage };
      const docFound = [];
      for (const entry of arr) {
        if (!entry || !entry.fieldId || entry.value === null || entry.value === undefined || entry.value === "") continue;
        const mapped = mapExtractedKey(flow, entry.fieldId);
        if (!mapped) continue;
        const sf = schema.researchFields.find(r => r.field === mapped);
        if (!sf) continue;
        if (docFound.some(f => f.field === mapped)) continue;
        docFound.push({
          field: mapped, label: sf.label, value: String(entry.value),
          source: docType.sourceName, sourceUrl: null,
          sourceTier: "document", verificationStatus: "verified", documentType: docType.key,
          fetchedAt: fetchTs, method: "document_extract", confidence: "high",
          trust: "authoritative", wolfsberg: false,
        });
      }
      return { docFound, wolfsbergFields: {}, raw: arr, usage };
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(`Could not parse extraction for ${docType.key}`, e, txt);
      return { docFound: [], wolfsbergFields: {}, raw: null, usage };
    }
  };

  const doResearch = async (journeyOverride) => {
    if (!companyName.trim()) { setError("Please enter a company name."); return; }
    if (!entityType) { setError("Please select an entity type."); return; }
    if (!countryCode) { setError("Please select a country."); return; }
    setError("");
    // Fresh research run: clear prior research/extraction costs but keep the
    // doc-search cost captured earlier on Step 2.
    setCostTracker(prev => ({ ...prev, researchPass1: null, researchPass2: null, docExtraction: null }));
    const journey = journeyOverride || journeyType || "ai_only";
    const researchStartTime = Date.now();
    trackEvent("research_started", {
      companyName,
      countryCode,
      entityType,
      ownershipType,
      journeyType: journey,
      agentType: agentType || "onboarding",
      startedAt: new Date().toISOString(),
    });
    const S = stepsFor(journey);
    const schema = getSchemaFromConfig(countryCode, entityType, tenantConfig);
    setActiveSchema(schema);
    setLoading(true); setStep(S.research); setLoaderIdx(0);
    try {
      // ─── Phase 1: extract from each uploaded document, in DOC_TYPES order ───
      const flow = schema.flow === "fi" ? "fi" : "corporate";
      const hasAnyDocs = DOC_TYPES.some(d => uploadedDocs[d.key]);
      const runDocPhase = journey === "ai_documents" && hasAnyDocs;

      let docFound = [];                  // sourceTier:"document" rows, ordered by DOC_TYPES priority
      let wolfsbergFields = {};           // legacy obj for prompt injection

      if (runDocPhase) {
        setPhase1Msgs(buildPhase1Msgs(uploadedDocs));
        setLoaderPhase(1); setLoaderIdx(0);
        // Accumulate real token counts across every per-document extraction call.
        let docExtractIn = 0, docExtractOut = 0, docExtractCalls = 0;
        for (let i = 0; i < DOC_TYPES.length; i++) {
          const dt = DOC_TYPES[i];
          const file = uploadedDocs[dt.key];
          if (!file) continue;
          const fetchTs = new Date().toISOString();
          const { docFound: dFound, wolfsbergFields: wFields, usage: dUsage } = await extractFromDoc(dt, file, schema, flow, fetchTs);
          if (dUsage) {
            docExtractIn += dUsage.input_tokens || 0;
            docExtractOut += dUsage.output_tokens || 0;
            docExtractCalls += 1;
          }
          if (dt.key === "wolfsberg") wolfsbergFields = wFields;
          // Dedup: keep first source (which respects DOC_TYPES priority order).
          for (const row of dFound) {
            if (!docFound.some(f => f.field === row.field)) docFound.push(row);
          }
        }
        if (docExtractCalls > 0) {
          setCostTracker(prev => ({
            ...prev,
            docExtraction: {
              inputTokens: docExtractIn,
              outputTokens: docExtractOut,
              totalTokens: docExtractIn + docExtractOut,
              costUsd: calcCostUsd(docExtractIn, docExtractOut),
              apiCallCount: docExtractCalls,
            },
          }));
        }
        setLoaderPhase(2); setLoaderIdx(0);
      }

      // ─── Phase 2: web research, optionally seeded with Wolfsberg fields ───
      // Accepted auto-sourced documents (Step 2 Section A) are appended to the
      // prompt so the research engine fetches and extracts fields from their
      // URLs — same as customer uploads, but via sourceUrl. Appended here
      // rather than inside buildPrompt so the shared src/pipeline.js (also
      // used by api/benchmark.js) stays unchanged.
      let researchPrompt = buildPrompt(companyName, countryObj ? countryObj.name : countryCode, countryCode, schema, wolfsbergFields, ownershipType);
      const acceptedDocs = (docSearchResults?.documents || [])
        .filter(d => acceptedDocTypes.has(d.type));
      if (acceptedDocs.length > 0) {
        researchPrompt += `\n\nAUTOMATICALLY SOURCED DOCUMENTS:\n`;
        researchPrompt += `The following documents have been ` +
          `sourced automatically and are available ` +
          `for field extraction:\n\n`;
        acceptedDocs.forEach(doc => {
          researchPrompt += `- ${doc.label} (${doc.year})\n`;
          researchPrompt += `  URL: ${doc.sourceUrl}\n`;
          researchPrompt += `  Source: ${doc.sourceLabel}\n`;
          researchPrompt += `  Please extract all relevant ` +
            `compliance fields from this document.\n\n`;
        });
      }
      const resp = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: researchPrompt,
          tools: RESEARCH_TOOLS,
        })
      });
      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        const claudeErr = errData && errData.details && errData.details.error;
        if (claudeErr && claudeErr.type === "rate_limit_error") {
          throw new Error("Anthropic rate limit reached for this minute. Wait ~60 seconds and try again, or add credits to raise your limit.");
        }
        if (claudeErr && claudeErr.message) {
          throw new Error(`${errData.error || "Claude API error"}: ${claudeErr.message}`);
        }
        throw new Error(errData.error || `HTTP ${resp.status}`);
      }
      const data = await resp.json();
      let text = "";
      for (const block of (data.content || [])) { if (block.type === "text" && block.text) text += block.text; }
      text = text.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();
      const si = text.indexOf("{"); const ei = text.lastIndexOf("}");
      if (si === -1 || ei === -1) throw new Error("No JSON found in response");
      let parsed;
      try {
        parsed = JSON.parse(text.slice(si, ei + 1));
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error("Raw research response (could not parse):", text);
        throw new Error(`Response was not valid JSON (${e.message}). Likely the model hit max_tokens — see browser console for the full response.`);
      }
      const webFetchTs = new Date().toISOString();
      // Classify one raw research row into our tiered/verification shape.
      // Shared by the first pass and the Phase 3 gap-recovery pass.
      const classifyWebRow = (item, ts) => {
        const isWolfsbergSrc = !!(item.source && /wolfsberg/i.test(item.source));
        const tier = isWolfsbergSrc
          ? "document"
          : classifySourceFromConfig([item.source, item.sourceUrl].filter(Boolean).join(" "), countryCode, tenantConfig);
        return {
          ...item,
          sourceUrl: item.sourceUrl || null,
          sourceTier: tier,
          verificationStatus: getVerificationStatus(tier),
          documentType: isWolfsbergSrc ? "wolfsberg" : null,
          fetchedAt: ts,
          method: isWolfsbergSrc ? "document_extract" : "web_search",
          confidence: tier === "tier1" || tier === "document" ? "high" : "low",
          trust: tier === "tier1" || tier === "document" ? "authoritative" : "secondary",
          wolfsberg: isWolfsbergSrc,
        };
      };
      const webFound = (parsed.found || []).map((item) => classifyWebRow(item, webFetchTs));

      // ─── Capture research pass-1 cost from the Anthropic usage object ───
      // api/research.js passes the response through verbatim, so data.usage
      // holds the real token counts for this call.
      if (data?.usage) {
        const inputTokens = data.usage.input_tokens || 0;
        const outputTokens = data.usage.output_tokens || 0;
        setCostTracker(prev => ({
          ...prev,
          researchPass1: {
            inputTokens,
            outputTokens,
            totalTokens: inputTokens + outputTokens,
            costUsd: calcCostUsd(inputTokens, outputTokens),
            fieldsFound: (parsed.found || []).length,
            // web search calls used in this response
            webSearchCalls: (data.content || []).filter(
              b => b.type === "server_tool_use" && b.name === "web_search"
            ).length,
          },
        }));
      }

      // Doc-extracted rows take priority over anything web returned for the same field.
      const docFieldIds = new Set(docFound.map(f => f.field));
      const mergedRaw = [...docFound, ...webFound.filter(f => !docFieldIds.has(f.field))];
      // Coerce free-text values for dropdown fields onto one of the configured
      // option values (e.g. "Private Limited Company" → "private_limited") so
      // the gap form can pre-select correctly on correction.
      let merged = enrichStakeholders(mapAIValuesToOptions(mergedRaw, schema));

      // ─── Phase 2: coverage analysis ───
      let cov = computeCoverage(merged, schema);

      // ─── Phase 3: gap-recovery second pass ───
      const recoveryStrategy = ownershipType ? computeResearchStrategy(ownershipType, countryCode) : null;
      const upgradeable = merged.filter(
        (r) => r.verificationStatus === "indicative" && hasPlausibleHigherTierSource(r.field)
      );
      const shouldRunGapRecovery =
        (cov.fillRate < 0.60 || cov.verifiedFillRate < 0.40) && cov.missingFields.length > 0;
      let ranGapRecovery = false;
      if (shouldRunGapRecovery) {
        ranGapRecovery = true;
        setResearchStatus(`Found ${cov.populatedFields} fields — running targeted search for ${cov.missingFieldCount} more…`);
        try {
          const gapResp = await fetch("/api/research", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              prompt: buildGapRecoveryPrompt(
                { name: companyName, countryName: countryObj ? countryObj.name : countryCode },
                cov.missingFields,
                upgradeable,
                recoveryStrategy
              ),
              tools: RESEARCH_TOOLS,
            }),
          });
          if (gapResp.ok) {
            const gapData = await gapResp.json();
            let gapText = "";
            for (const block of (gapData.content || [])) { if (block.type === "text" && block.text) gapText += block.text; }
            gapText = gapText.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();
            const gsi = gapText.indexOf("{"); const gei = gapText.lastIndexOf("}");
            if (gsi !== -1 && gei !== -1) {
              const gapParsed = JSON.parse(gapText.slice(gsi, gei + 1));
              const gapTs = new Date().toISOString();
              // ─── Capture research pass-2 cost from the Anthropic usage object ───
              if (gapData?.usage) {
                const inputTokens = gapData.usage.input_tokens || 0;
                const outputTokens = gapData.usage.output_tokens || 0;
                setCostTracker(prev => ({
                  ...prev,
                  researchPass2: {
                    inputTokens,
                    outputTokens,
                    totalTokens: inputTokens + outputTokens,
                    costUsd: calcCostUsd(inputTokens, outputTokens),
                    fieldsFound: (gapParsed.found || []).length,
                    webSearchCalls: (gapData.content || []).filter(
                      b => b.type === "server_tool_use" && b.name === "web_search"
                    ).length,
                    ran: true,
                  },
                }));
              }
              const gapRows = (gapParsed.found || [])
                .map((item) => classifyWebRow(item, gapTs))
                // Never let gap recovery override a document-sourced row.
                .filter((r) => !docFieldIds.has(r.field));
              const remerged = mergeResearchResults(merged, gapRows);
              merged = enrichStakeholders(mapAIValuesToOptions(remerged, schema));
              cov = computeCoverage(merged, schema);
            }
          }
        } catch (gapErr) {
          // Gap recovery is best-effort — keep the first-pass results on failure.
          // eslint-disable-next-line no-console
          console.warn("Gap recovery pass failed:", gapErr.message);
        }
        setResearchStatus("");
      }

      setResearch({ ...parsed, found: merged });
      setResearchTimestamp(webFetchTs);
      setCoverage(cov);
      setGapRecoveryRan(ranGapRecovery);

      trackEvent("research_completed", {
        companyName,
        fieldsFound: merged?.length || 0,
        fillRate: cov?.fillRate ?? null,
        verifiedFields: cov?.verifiedFields ?? null,
        totalCostUsd: costTracker?.researchPass1?.costUsd || null,
        durationMs: Date.now() - researchStartTime,
        agentType: agentType || "onboarding",
      });

      // Build silent metadata trail (Part 5).
      const meta = merged.map(item => ({
        fieldId: item.field, value: item.value,
        source: item.source || "Unknown", sourceUrl: item.sourceUrl || null,
        sourceTier: item.sourceTier, verificationStatus: item.verificationStatus,
        documentType: item.documentType || null,
        fetchedAt: item.fetchedAt, method: item.method, confidence: item.confidence,
        customerAction: null, customerActionAt: null,
      }));
      setFieldMetadata(meta);

      // Unified pre-fill engine: pre-check every found item. Customer unchecks
      // anything wrong, including tier-2/tier-3 items (which carry an inline
      // warning on the Confirm page).
      const c = {};
      merged.forEach((_, i) => { c[i] = true; });
      setChecks(c);
      setRejectedStakeholders({});
      setStakeholderFieldChecks({});
      setExpandedStakeholders({});
      setIsPubliclyListedOverride(false);
      stakeholdersRef.current = {};
      setStakeholderVersion(v => v + 1);
      setStakeholderErrors([]);
      setRevealedTs({});
      gapRef.current = {};
      setFormVersion(v => v + 1);
      setStep(S.confirm);
    } catch (err) { setError("Research failed: " + err.message); setStep(S.input); }
    finally { setLoading(false); setLoaderPhase(0); setResearchStatus(""); }
  };

  // Bypasses /api/research and synthesises a plausible result using
  // DUMMY_RESEARCH_VALUES + the selected country's authoritative source list.
  // Mirrors the production flow: doc-uploaded fields tagged sourceTier:"document",
  // plus a sprinkle of tier-2 web rows.
  const doDummyResearch = async (journeyOverride) => {
    if (!companyName.trim()) { setError("Please enter a company name."); return; }
    if (!entityType) { setError("Please select an entity type."); return; }
    if (!countryCode) { setError("Please select a country."); return; }
    setError("");
    // Demo: default the ownership type if the tester skipped it on Step 1.
    if (!ownershipType) setOwnershipType("public_listed");
    const journey = journeyOverride || journeyType || "ai_only";
    const S = stepsFor(journey);
    const schema = getSchemaFromConfig(countryCode, entityType, tenantConfig);
    setActiveSchema(schema);
    setLoading(true); setStep(S.research); setLoaderIdx(0);

    const hasAnyDocs = DOC_TYPES.some(d => uploadedDocs[d.key]);
    const runDocPhase = journey === "ai_documents" && hasAnyDocs;

    if (runDocPhase) {
      setPhase1Msgs(buildPhase1Msgs(uploadedDocs));
      setLoaderPhase(1);
      await new Promise(r => setTimeout(r, 1500));
      setLoaderPhase(2); setLoaderIdx(0);
      await new Promise(r => setTimeout(r, 1500));
    } else {
      await new Promise(r => setTimeout(r, 3000));
    }

    const authPattern = (SOURCE_TRUST[countryCode] || ["public registry"])[0];
    const authSource = authPattern.replace(/\b\w/g, c => c.toUpperCase());

    // Build a mock "doc-extracted" set: pick representative fields for each
    // uploaded doc so the navy badge gets exercised on Confirm.
    const docExtractedByField = {};   // field → { docKey, sourceName }
    if (runDocPhase) {
      const mockMap = {
        wolfsberg: ["regulatory_authority", "licence_number", "has_licence", "ubo_parent_company", "ubo_share_percentage", "non_resident_customers", "services_other_fis"],
        certificate: ["business_name", "registration_number", "incorporation_date", "registered_address_line1", "tradeName", "businessRegistrationNumber", "registeredDate", "addressLine1", "businessType", "registeredCountry"],
        licence: ["licence_number", "regulatory_authority", "has_licence"],
        annualReport: ["annual_turnover", "employee_count", "operating_countries", "publicly_listed", "annualRevenue", "employees", "countriesOfOperation", "stockListing"],
        financialStatements: ["annual_turnover", "employee_count", "annualRevenue", "employees"],
        orgChart: ["ubo_parent_company", "ubo_share_percentage", "uboAnalysis"],
        amlPolicy: [],
      };
      DOC_TYPES.forEach(dt => {
        if (!uploadedDocs[dt.key]) return;
        const fields = mockMap[dt.key] || [];
        fields.forEach(f => {
          if (!(f in docExtractedByField)) {
            docExtractedByField[f] = { docKey: dt.key, sourceName: dt.sourceName };
          }
        });
      });
    }

    const dummyTs = new Date().toISOString();
    const foundRaw = schema.researchFields.map((f, i) => {
      const docHit = docExtractedByField[f.field];
      // Exercise all three tiers in the demo: most rows tier1 (official), a
      // slice tier2 (company-owned), a slice tier3 (third-party/unverified).
      const isCompanyOwned = !docHit && f.tier === 2 && i % 4 === 0;
      const isThirdParty = !docHit && f.tier === 2 && i % 4 === 2;
      const tier2Sources = ["Company website", "Annual Report", "Investor Relations"];
      const tier3Sources = ["Wikipedia", "LinkedIn", "Crunchbase"];
      const source = docHit
        ? docHit.sourceName
        : (isThirdParty ? tier3Sources[i % tier3Sources.length]
          : isCompanyOwned ? tier2Sources[i % tier2Sources.length]
          : authSource);
      const sourceTier = docHit ? "document" : (isThirdParty ? "tier3" : isCompanyOwned ? "tier2" : "tier1");
      // For dropdown fields, pick the first configured option's label so the
      // mapping step downstream produces a real option.value. Falls back to
      // the test data table for free-text fields.
      let value = DUMMY_RESEARCH_VALUES[f.field];
      if (value === undefined) {
        if (f.inputType === "select" && Array.isArray(f.options) && f.options.length) {
          const first = f.options[0];
          value = (first && typeof first === "object")
            ? (first.label || first.value)
            : first;
        } else {
          value = "Sample " + f.label;
        }
      }
      return {
        field: f.field, label: f.label, value, source,
        sourceUrl: null,
        sourceTier,
        verificationStatus: getVerificationStatus(sourceTier),
        documentType: docHit ? docHit.docKey : null,
        fetchedAt: dummyTs,
        method: docHit ? "document_extract" : "web_search",
        confidence: sourceTier === "tier1" || sourceTier === "document" ? "high" : "low",
        trust: sourceTier === "tier1" || sourceTier === "document" ? "authoritative" : "secondary",
        wolfsberg: docHit && docHit.docKey === "wolfsberg",
      };
    });
    // Same dropdown-value coercion the live research path uses, so dummy and
    // live results render identically on Confirm and Fill Gaps.
    const found = enrichStakeholders(mapAIValuesToOptions(foundRaw, schema));

    const tagged = {
      companyName,
      jurisdiction: schema.region,
      countryOfRegistration: countryCode,
      found,
      gaps: schema.gapFields.map(f => ({ ...f, reason: "Not publicly available" })),
    };
    setResearch(tagged);
    setResearchTimestamp(dummyTs);

    // Demo coverage (Part 14). Gap recovery is skipped in demo mode.
    setCoverage({
      totalResearchFields: 35,
      populatedFields: 28,
      verifiedFields: 20,
      probableFields: 5,
      indicativeFields: 3,
      missingFieldCount: 7,
      missingFields: [],
      fillRate: 0.80,
      verifiedFillRate: 0.57,
    });
    setGapRecoveryRan(false);

    setFieldMetadata(found.map(item => ({
      fieldId: item.field, value: item.value,
      source: item.source, sourceUrl: null,
      sourceTier: item.sourceTier, verificationStatus: item.verificationStatus, documentType: item.documentType,
      fetchedAt: item.fetchedAt, method: item.method, confidence: item.confidence,
      customerAction: null, customerActionAt: null,
    })));

    const c = {};
    found.forEach((_, i) => { c[i] = true; });
    setChecks(c);
    setRejectedStakeholders({});
    setStakeholderFieldChecks({});
    setExpandedStakeholders({});
    // Leave the manual "publicly listed" override OFF by default — the user
    // ticks it on Confirm only if they want to override and skip stakeholder
    // EDD forms. (Previously demo mode pre-checked this; now it starts unticked.)
    setIsPubliclyListedOverride(false);
    stakeholdersRef.current = {};
    setStakeholderVersion(v => v + 1);
    setStakeholderErrors([]);
    setRevealedTs({});
    gapRef.current = {};
    setFormVersion(v => v + 1);
    setLoading(false); setLoaderPhase(0);
    setStep(S.confirm);
  };

  // Continue handler from Documents step → triggers research with whatever
  // was uploaded (zero docs is fine; web search runs alone). In demo mode
  // we skip the API entirely and synthesise sample data.
  const proceedFromDocuments = () => {
    setError("");
    if (demoMode) { doDummyResearch("ai_documents"); return; }
    doResearch();
  };

  // ─── Doc search agent (Step 2 — Document Intelligence, Section A) ───
  // Calls the real sub-agent via /api/doc-search. Demo mode and local dev /
  // ?test=1 default to buildDemoDocSearchResults instead (no API spend);
  // the testing-mode toggle on Step 2 can trigger this explicitly.
  // Capture doc-search cost from the agent's CostTracker totals. Works for
  // both the real /api/doc-search response and the demo builder (both expose
  // data.cost.totals with real-shaped token counts).
  const captureDocSearchCost = (data) => {
    if (!data?.cost?.totals) return;
    const t = data.cost.totals;
    setCostTracker(prev => ({
      ...prev,
      docSearch: {
        inputTokens: t.inputTokens,
        outputTokens: t.outputTokens,
        totalTokens: t.totalTokens,
        costUsd: calcCostUsd(t.inputTokens, t.outputTokens),
        apiCallCount: data.cost.calls?.length || 1,
        documentsSearched: data.summary?.total || 0,
        documentsFound: data.summary?.found || 0,
        // Per-call detail for JSONB storage
        callDetail: data.cost.calls || [],
      },
    }));
  };

  const runRealDocSearch = () => {
    setDocSearchResults(null);
    setDocSearchLoading(true);
    setDocSearchError(null);

    const docOwnershipType = mapToDocAgentOwnershipType(
      ownershipType,
      entityType,
      false // effectivelyListed not known yet — research hasn't run
    );

    fetch("/api/doc-search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyName,
        country: countryObj ? countryObj.name : countryCode,
        ownershipType: docOwnershipType,
        niumEntityType: (entityType || "").toLowerCase(),
        tenantId,
      }),
    })
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          setDocSearchResults(data);
          captureDocSearchCost(data);
        } else {
          setDocSearchError(data.error || "Doc search failed");
        }
        setDocSearchLoading(false);
      })
      .catch(err => {
        setDocSearchError(err.message);
        setDocSearchLoading(false);
      });
  };

  // Kick off the doc search once when the Documents step is entered.
  useEffect(() => {
    if (!isAiDocs || step !== STEPS.documents) return;
    if (docSearchResults !== null || docSearchLoading) return;
    if (!companyName.trim()) return;
    if (demoMode || SHOW_TEST_TOOLS) {
      const demo = buildDemoDocSearchResults(companyName, ownershipType, entityType);
      setDocSearchResults(demo);
      captureDocSearchCost(demo);
      setDocSearchLoading(false);
    } else {
      runRealDocSearch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, isAiDocs]);

  // Stale-result guard: clear doc search state whenever the customer is back
  // on Step 1 (Back navigation or Start Over), so a changed company name
  // triggers a fresh search on the next visit to the Documents step.
  useEffect(() => {
    if (step !== STEPS.input) return;
    setDocSearchResults(null);
    setDocSearchLoading(false);
    setDocSearchError(null);
    setAcceptedDocTypes(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // Generic per-doc file handler. Clears the slot on null.
  const handleDocFile = (key) => (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const dt = DOC_TYPES.find(d => d.key === key);
    if (!dt) return;
    const accepted = dt.accept.split(",").map(s => s.trim());
    if (!accepted.includes(file.type)) {
      setError(`${dt.label}: file must be ${dt.accepts}.`);
      return;
    }
    if (file.size > 20 * 1024 * 1024) { setError(`${dt.label}: file must be 20MB or smaller.`); return; }
    setError("");
    setUploadedDocs(prev => ({ ...prev, [key]: file }));
  };
  const removeDocFile = (key) => () => setUploadedDocs(prev => ({ ...prev, [key]: null }));

  // Journey-screen Continue → routes per selected card.
  const proceedFromJourney = () => {
    if (!selectedJourneyCard) { setError("Please choose an option to continue."); return; }
    setError("");
    if (selectedJourneyCard === "A") {
      setJourneyType("ai_documents");
      setJourneyOpen(false);
      setManualOpened(false);
      // Demo: skip docs upload (no point uploading) and go straight to dummy.
      if (demoMode) { doDummyResearch("ai_documents"); return; }
      scrollAndSetStep(1); // documents step
    } else if (selectedJourneyCard === "B") {
      setJourneyType("ai_only");
      setJourneyOpen(false);
      setManualOpened(false);
      // STEPS in this branch is { input:0, research:1, ... }
      if (demoMode) { doDummyResearch("ai_only"); return; }
      doResearch("ai_only");
    } else if (selectedJourneyCard === "C") {
      setJourneyType("manual");
      window.open(manualFormUrl_, "_blank", "noopener,noreferrer");
      setManualOpened(true);
    }
  };

  // RFC4122 v4 UUID — uses crypto.randomUUID where available, falls back
  // to a Math.random()-based generator for older browsers.
  const genUUID = () => {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : ((r & 0x3) | 0x8);
      return v.toString(16);
    });
  };

  // Final submission: build the metadata + payload, log, persist to Neon via
  // /api/submit, advance to Done. The DB write is best-effort — a failure
  // never blocks the customer from reaching the success screen.
  const submitApplication = async () => {
    const submittedAt = new Date().toISOString();
    setSubmitTs(submittedAt);

    // Append manual-input metadata for every gapRef entry that has a value.
    const manualEntries = [];
    Object.entries(gapRef.current).forEach(([fieldId, value]) => {
      if (value === undefined || value === null || String(value).trim() === "") return;
      const key = fieldId.startsWith("corrected_") ? fieldId.slice("corrected_".length) : fieldId;
      // Mark corrections distinctly so the trail shows the user's overwrite
      // alongside the original AI-found row.
      manualEntries.push({
        fieldId: key,
        value: String(value),
        source: "Customer input",
        sourceUrl: null,
        sourceTier: "manual",
        documentType: null,
        fetchedAt: submittedAt,
        method: "manual",
        confidence: "verified",
        customerAction: fieldId.startsWith("corrected_") ? "corrected" : "entered",
        customerActionAt: submittedAt,
      });
    });
    const finalMeta = [...fieldMetadata.filter(m => !manualEntries.some(e => e.fieldId === m.fieldId && e.customerAction === "corrected")), ...manualEntries];
    setFieldMetadata(finalMeta);

    // Build a flat fieldId → value map. For corrections, the manual value wins.
    const fieldValues = {};
    (research?.found || []).forEach((it, i) => {
      if (checks[i]) fieldValues[it.field] = it.value;
    });
    Object.entries(gapRef.current).forEach(([fieldId, value]) => {
      if (value === undefined || value === null || String(value).trim() === "") return;
      const key = fieldId.startsWith("corrected_") ? fieldId.slice("corrected_".length) : fieldId;
      fieldValues[key] = String(value);
    });

    // Build structured stakeholder payload from stakeholdersRef. Each
    // stakeholder field id maps to an array of person records with both
    // the AI-found provenance (source/sourceUrl/sourceTier/fetchedAt) and
    // the customer-completed compliance fields. Empty fields are kept so
    // the downstream consumer can see which gaps were left blank.
    const stakeholderPayload = {};
    (research?.found || []).forEach((result) => {
      if (!isStakeholderField(result.field)) return;
      const list = getStakeholders(result.field);
      if (!list || list.length === 0) return;
      stakeholderPayload[result.field] = list.map((s) => {
        const fullEddCollected = needsStakeholderDetails(s, result.field, effectivelyListed);
        // Corporate stakeholder — emit the KYB shape (businessName, businessType,
        // businessRegistrationNumber, registeredCountry, sharePercentage,
        // positions[]) rather than the person EDD fields.
        if (s.is_company) {
          return {
            id: s.id,
            is_company: true,
            businessName: s.full_name || "",
            businessType: s.business_type || "",
            businessRegistrationNumber: s.business_registration_number || "",
            registeredCountry: s.registered_country || "",
            sharePercentage: s.share_percentage != null ? s.share_percentage : null,
            positions: (s.positions || [])
              .filter((p) => p && (p.title || p.start_date))
              .map((p) => ({ title: p.title || "", startDate: p.start_date || "" })),
            source: s.source || "",
            sourceUrl: s.sourceUrl || "",
            sourceTier: s.sourceTier || "",
            fetchedAt: s.fetchedAt || null,
            customer_confirmed: !s.customer_rejected,
            customer_added: !!s.customer_added,
            customer_rejected: !!s.customer_rejected,
            full_name_original: s.full_name_original || null,
          };
        }
        return {
          id: s.id,
          full_name: s.full_name || "",
          role: s.role || "",
          share_percentage: s.share_percentage != null ? s.share_percentage : null,
          // Was the full enhanced-due-diligence form collected for this person?
          full_edd_collected: fullEddCollected,
          edd_skip_reason: fullEddCollected ? null : "publicly_listed_company",
          nationality: s.nationality || "",
          date_of_birth: s.date_of_birth || "",
          residential_country: s.residential_country || "",
          id_type: s.id_type || "",
          id_number: s.id_number || "",
          is_pep: s.is_pep,
          pep_details: s.pep_details || null,
          source: s.source || "",
          sourceUrl: s.sourceUrl || "",
          sourceTier: s.sourceTier || "",
          fetchedAt: s.fetchedAt || null,
          customer_confirmed: !s.customer_rejected,
          customer_added: !!s.customer_added,
          customer_rejected: !!s.customer_rejected,
          full_name_original: s.full_name_original || null,
        };
      });
    });

    const payload = {
      submissionId: genUUID(),
      submittedAt,
      company: {
        name: research?.companyName || companyName,
        countryCode,
        countryName: countryObj ? countryObj.name : countryCode,
        entityType,
        ownershipType,
        ownershipTypeLabel: ownershipTypeLabel(ownershipType),
        schemaJurisdiction: activeSchema?.region === "UK" ? "GB" : "SG",
      },
      journeyType,
      documentsUploaded: DOC_TYPES.filter(d => uploadedDocs[d.key]).map(d => d.key),
      researchTimestamp,
      fromCache: false,
      isPubliclyListed: effectivelyListed,
      listingDetectedFrom: effectivelyListed ? detectListingEvidence(research) : null,
      // Enhanced research pipeline: ownership-type strategy + coverage metrics.
      research: {
        ownershipType,
        ownershipTypeLabel: ownershipTypeLabel(ownershipType),
        researchStrategy: (OWNERSHIP_TYPE_LIBRARY.find(o => o.id === ownershipType) || {}).researchStrategy || null,
        gapRecoveryRan,
        coverage: coverage ? {
          totalResearchFields: coverage.totalResearchFields,
          populatedFields: coverage.populatedFields,
          verifiedFields: coverage.verifiedFields,
          probableFields: coverage.probableFields,
          indicativeFields: coverage.indicativeFields,
          missingFieldCount: coverage.missingFieldCount,
          fillRate: Math.round(coverage.fillRate * 100),
          verifiedFillRate: Math.round(coverage.verifiedFillRate * 100),
        } : null,
      },
      // DRS — document requirements collected at the dynamic documents step.
      documentRequirements: {
        submittedRequirements: drsSubmitted,
        flags: drsFlags,
      },
      fieldValues,
      fieldMetadata: finalMeta.map(m => ({
        ...m,
        verificationStatus: m.verificationStatus
          || (research?.found || []).find(r => r.field === m.fieldId)?.verificationStatus
          || "manual",
      })),
      stakeholders: stakeholderPayload,
      declaration: {
        ipAddress: device.ipAddress,
        userAgent: device.userAgent,
        platform: device.platform,
        timezone: device.timezone,
        timestamp: submittedAt,
        language: device.language,
        agreedAt: submittedAt,
        certifiedAt: submittedAt,
      },
    };

    // Per-phase real-token cost summary for this journey (doc search, research
    // pass 1 & 2, doc extraction). Totals are recomputed from summed real
    // token counts inside buildCostSummary.
    const submitCompany = { name: payload.company.name, code: countryCode };
    const costSummary = buildCostSummary(
      costTracker,
      submitCompany,
      entityType,
      ownershipType,
      coverage || null
    );
    payload.costSummary = costSummary;

    // eslint-disable-next-line no-console
    console.log("APPLICATION_SUBMISSION", payload);

    // Persist to Neon via /api/submit. Best-effort: a DB failure must never
    // block the customer from reaching the success screen.
    try {
      const resp = await fetch("/api/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId,
          company: submitCompany,
          entityType,
          ownershipType,
          journeyType,
          fieldValues,
          stakeholders: stakeholderPayload,
          documents: docSearchResults?.documents || [],
          costSummary,
          coverage: coverage || null,
          declaration: payload.declaration,
          submittedAt,
        }),
      });
      const result = await resp.json();
      if (result.sessionId) {
        // eslint-disable-next-line no-console
        console.log(`[Submit] ✅ Saved — session: ${result.sessionId}`);
        trackEvent("application_submitted", {
          companyName: submitCompany.name,
          sessionId: result.sessionId,
          totalCostUsd: costSummary?.totals?.totalCostUsd ?? null,
          totalTokens: costSummary?.totals?.totalTokens ?? null,
          fillRate: coverage?.fillRate ?? null,
          agentType: agentType || "onboarding",
          submittedAt: new Date().toISOString(),
        });
      }
      if (result.warning) {
        // eslint-disable-next-line no-console
        console.warn(`[Submit] ⚠ ${result.warning}`);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[Submit] ❌ Failed:", err);
    }

    setDone(true);
  };

  // Toggle a Confirm-page checkbox AND record the action in metadata.
  const toggleCheck = (idx) => {
    setChecks(prev => {
      const next = { ...prev, [idx]: !prev[idx] };
      const item = (research && research.found) ? research.found[idx] : null;
      if (item) {
        const action = next[idx] ? "accepted" : "rejected";
        const at = new Date().toISOString();
        setFieldMetadata(prevMeta => prevMeta.map(m =>
          m.fieldId === item.field ? { ...m, customerAction: action, customerActionAt: at } : m
        ));
      }
      return next;
    });
  };

  const card = { background: "rgba(255,255,255,0.95)", borderRadius: 14, border: "1px solid rgba(26,58,74,0.06)", boxShadow: "0 4px 20px rgba(26,58,74,0.05)", padding: "24px 28px", marginBottom: 16 };
  const Btn = ({ children, onClick, variant, disabled }) => {
    const base = { padding: "12px 26px", borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: disabled ? "not-allowed" : "pointer", fontFamily: "inherit", opacity: disabled ? 0.4 : 1, border: "none" };
    const v = { primary: { ...base, background: "#1a3a4a", color: "#fff" }, secondary: { ...base, background: "transparent", color: "#1a3a4a", border: "2px solid #1a3a4a" }, green: { ...base, background: "#4a9e8e", color: "#fff" } };
    return <button style={v[variant] || v.primary} onClick={disabled ? undefined : onClick}>{children}</button>;
  };

  // Friendly title for an admin-defined section key (e.g. "registered_address"
  // → "Registered Address", "uboAnalysis" → "UBO Analysis"). Used as a
  // fallback for sections that aren't in the hardcoded sectionConfig.
  const humaniseSection = (s) => {
    if (!s) return "Other";
    return String(s)
      .replace(/[_-]+/g, " ")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .trim();
  };

  const sectionConfig = {
    corrections: { title: "Corrections Required", icon: "🔄", sub: "You unchecked these fields — please provide correct values", twoCol: true },
    missing_research: { title: "Missing Research Fields", icon: "❓", sub: "We could not find these from any source — fill in if you have the data (all optional).", twoCol: true },
    applicant: { title: "Applicant Details", icon: "👤", sub: "Person authorised to submit this application", twoCol: true },
    business: { title: "Business Details", icon: "🏢", sub: "Confirm and complete business information", twoCol: true },
    business_entity: { title: "Business Entity", icon: "🏢", sub: "Registered identity and core business details", twoCol: true },
    registered_address: { title: "Registered Address", icon: "📍", sub: "Address from the official registry", twoCol: true },
    business_address: { title: "Business Address", icon: "📍", sub: "Operating address (if different from registered)", twoCol: true },
    business_activity: { title: "Business Activity", icon: "📊", sub: "Activity, size and operating profile", twoCol: true },
    operations: { title: "Operations", icon: "⚙", sub: "Branches, services and products", twoCol: true },
    ownership: { title: "Ownership & Control", icon: "👥", sub: "Directors, UBOs and corporate structure", twoCol: true },
    regulatory: { title: "Regulatory Details", icon: "🏛", sub: "Licensing and regulatory status", twoCol: true },
    nature: { title: "Nature & Size of Business", icon: "🏢", sub: "Business activity and size details", twoCol: true },
    fi: { title: "FI Specific Questions", icon: "🏦", sub: "Licensing, services, and customer profile", twoCol: false },
    stakeholders: { title: "Stakeholders & Transaction Mix", icon: "👥", sub: "Directors, UBOs, signatories and payment-mix breakdown", twoCol: true },
    disclosures: { title: "Corporate Disclosures", icon: "📋", sub: "Past regulatory or legal events", twoCol: false },
    account: { title: "Expected Account Usage", icon: "💰", sub: "Transaction volumes, purpose, and source of funds", twoCol: false },
    usage: { title: "Account Usage & Volumes", icon: "💰", sub: "Expected transaction volumes and counterparties", twoCol: true },
    bank: { title: "Bank Account Details", icon: "🏦", sub: "Settlement account for transactions", twoCol: true },
    documents: { title: "Additional Documents", icon: "📄", sub: "Upload supporting documentation", twoCol: false },
  };

  // Discover the section keys to render on Fill Gaps. Two-tier order:
  //   1. Pinned sections from sectionConfig (so well-known sections like
  //      Corrections / Missing Research / Applicant / Business / ... keep
  //      their canonical order at the top).
  //   2. Any *additional* sections present in the gap data (e.g. custom
  //      admin-defined sections like "Registered Address" / "Business
  //      Address" / anything else) appended in the order they first appear
  //      in the schema definitions, then by gap-item order.
  // This replaces the previous hardcoded list, which silently dropped any
  // section it didn't recognise.
  const gapSectionOrder = () => {
    const pinned = ["corrections", "missing_research", "applicant", "business", "business_address", "nature", "fi", "stakeholders", "disclosures", "account", "usage", "bank", "documents"];
    const seen = new Set();
    const out = [];
    const pinnedSet = new Set(pinned);
    pinned.forEach((s) => out.push(s));
    pinned.forEach((s) => seen.add(s));
    // Walk the schema in definition order so admin-defined sections show
    // up in the order the admin laid them out.
    if (activeSchema) {
      const walk = (arr) => (arr || []).forEach((f) => {
        const s = f.section;
        if (!s || pinnedSet.has(s) || seen.has(s)) return;
        seen.add(s);
        out.push(s);
      });
      walk(activeSchema.researchFields);
      walk(activeSchema.gapFields);
    }
    // Catch any leftover sections present in the live gap list but not in
    // the schema (e.g. fields the AI returned with an unfamiliar section).
    getCombinedGaps().forEach((g) => {
      const s = g.section;
      if (s && !seen.has(s)) { seen.add(s); out.push(s); }
    });
    return out;
  };

  const renderGapSection = (sectionKey) => {
    // "Additional Documents" (documents) section hidden on the Fill Gaps page
    // for all flows (FI / Corporate, AI-only / document+AI) per request. Kept
    // restorable: remove this guard to bring the section back.
    if (sectionKey === "documents") return null;
    const items = getCombinedGaps()
      .filter(g => g.section === sectionKey)
      .filter(dependsOnSatisfied);
    if (items.length === 0) return null;
    const cfg = sectionConfig[sectionKey] || { title: humaniseSection(sectionKey), icon: "📋", sub: "", twoCol: true };

    return (
      <div style={card} key={sectionKey}>
        <h3 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 4px" }}>{cfg.icon} {cfg.title}</h3>
        <p style={{ fontSize: 12, color: "#1a3a4a60", margin: "0 0 14px" }}>{cfg.sub}</p>
        <div style={cfg.twoCol ? { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 14px" } : {}}>
          {items.map(g => <StableInput key={g.field} id={g.field} label={g.label} type={g.inputType} value={gapRef.current[g.field] || ""} onUpdate={updateGap} required={g.required} options={g.options} placeholder={g.placeholder || ("Enter " + g.label.toLowerCase())} />)}
        </div>
      </div>
    );
  };

  const jurisdictionBadge = activeSchema ? (() => {
    // Region drives only the colour; the label comes from the resolved
    // licence so tenants with non-UK/SG licences show the real jurisdiction.
    const flag = activeSchema.jurisdiction === "GB" ? "🇬🇧 "
      : activeSchema.jurisdiction === "SG" ? "🇸🇬 "
      : "";
    const text = activeSchema.label ? `${flag}${activeSchema.label}` : (activeSchema.region === "UK" ? "🇬🇧 UK Licence" : "🇸🇬 SG Licence");
    const bg = activeSchema.region === "UK" ? "#1a3a4a" : "#4a9e8e";
    return (
      <span style={{ display: "inline-block", padding: "3px 10px", borderRadius: 20, fontSize: 10, fontWeight: 700, letterSpacing: "0.05em", background: bg, color: "#fff", marginLeft: 8 }}>
        {text}
      </span>
    );
  })() : null;

  const entityBadge = entityType ? (
    <span style={{ display: "inline-block", padding: "3px 10px", borderRadius: 20, fontSize: 10, fontWeight: 700, letterSpacing: "0.05em", background: "#e0a040", color: "#fff", marginLeft: 8 }}>
      {entityType}
    </span>
  ) : null;

  // Lookup the metadata entry for a given fieldId — used by the "When?"
  // click-to-reveal badge so timestamps come from fieldMetadata, the
  // single source of truth.
  const metaFor = (fieldId) => fieldMetadata.find(m => m.fieldId === fieldId);

  // Source-tier visual treatment per row.
  // document → dark navy badge with the document type label
  // tier1    → green pill with the source name
  // tier2    → amber pill with "From an unverified source — please confirm"
  //
  // Badges live in a fixed 180px cell on each confirm row; text WRAPS inside
  // the badge (whiteSpace: normal) rather than pushing the cell wider — a
  // nowrap badge with a long source string was collapsing the value column.
  const badgeBaseStyle = {
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
  const renderSourceBadge = (item, idx) => {
    const m = metaFor(item.field);
    const ts = (m && m.fetchedAt) || researchTimestamp || "";
    const tsShort = ts ? ts.slice(11, 19) : "";
    if (item.sourceTier === "document") {
      const label = item.source || "Uploaded document";
      return (
        <span
          onClick={() => setRevealedTs(p => ({ ...p, [idx]: !p[idx] }))}
          title={revealedTs[idx] ? `🕒 ${ts}` : `From uploaded ${label}`}
          style={{ ...badgeBaseStyle, color: "#fff", background: "#0B3D91" }}
        >
          {revealedTs[idx] ? `🕒 ${tsShort}` : `📄 ${label}`}
        </span>
      );
    }
    if (item.sourceTier === "tier1") {
      return (
        <span
          onClick={() => setRevealedTs(p => ({ ...p, [idx]: !p[idx] }))}
          title={revealedTs[idx] ? "Click to hide timestamp" : "Click to show fetch timestamp"}
          style={{ ...badgeBaseStyle, color: "#1a6b56", background: "#dff2ec" }}
        >
          {revealedTs[idx] ? `🕒 ${ts}` : `✅ ${item.source}`}
        </span>
      );
    }
    // tier3 (indicative) — third-party / unverified source.
    if (item.sourceTier === "tier3") {
      return (
        <span
          onClick={() => setRevealedTs(p => ({ ...p, [idx]: !p[idx] }))}
          title={revealedTs[idx] ? "Click to hide timestamp" : "Low confidence — from unverified source"}
          style={{ ...badgeBaseStyle, color: "#C2410C", background: "#FFF7ED", border: "1px solid #FED7AA" }}
        >
          {revealedTs[idx] ? `🕒 ${ts}` : `⚠ ${item.source}`}
        </span>
      );
    }
    // tier2 (probable) — company-owned source.
    return (
      <span
        onClick={() => setRevealedTs(p => ({ ...p, [idx]: !p[idx] }))}
        title={revealedTs[idx] ? "Click to hide timestamp" : "Probable — from company source, please confirm"}
        style={{ ...badgeBaseStyle, color: "#8c5500", background: "#fff1d6" }}
      >
        {revealedTs[idx] ? `🕒 ${ts}` : `~ ${item.source}`}
      </span>
    );
  };

  // Prevent "[object Object]" rendering when an object/array sneaks into a
  // field value (e.g. structured UBO data) where a string is expected.
  const safeRenderValue = (value) => {
    if (value === null || value === undefined) {
      return "—";
    }
    if (typeof value === "object") {
      return JSON.stringify(value, null, 2);
    }
    return String(value);
  };

  // Render one row of the Confirm table — extracted so the section-grouped
  // and ungrouped paths share the same DOM.
  //
  // Layout: flex row with FIXED-width label (180px) and source-badge (180px)
  // cells and a flex:1 value cell with minWidth:0. The previous grid used
  // fr-unit columns with whiteSpace:nowrap badges — a long source string
  // forced the source column to its content width and squeezed the value
  // column to near-zero, rendering values vertically.
  const renderFoundRow = ({ item, idx }, n) => {
    const fieldDef = findFieldDef(activeSchema, item.field);
    const displayValue =
      item.value !== null && typeof item.value === "object"
        ? safeRenderValue(item.value)
        : safeRenderValue(resolveDisplayValue(fieldDef, item.value));
    const isUnmappedDropdown =
      fieldDef && fieldDef.inputType === "select" && item.unmappedDropdown;
    return (
      <div key={item.field + idx} style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 12,
        width: "100%",
        padding: "12px 10px",
        boxSizing: "border-box",
        background: n % 2 === 0 ? "#fafcfb" : "#fff",
        borderBottom: "1px solid rgba(26,58,74,0.04)",
        opacity: checks[idx] ? 1 : 0.3,
      }}>
        {/* Checkbox */}
        <div style={{ flexShrink: 0, width: 20, paddingTop: 2 }}>
          <input type="checkbox" checked={!!checks[idx]} onChange={() => toggleCheck(idx)} style={{ width: 15, height: 15, cursor: "pointer", accentColor: "#4a9e8e" }} />
        </div>
        {/* Label cell — fixed width */}
        <span style={{
          flexShrink: 0,
          width: 180,
          minWidth: 180,
          maxWidth: 180,
          fontSize: 13,
          color: C.textMuted,
          fontWeight: 500,
          lineHeight: 1.4,
          wordWrap: "break-word",
          overflowWrap: "break-word",
        }}>{item.label}</span>
        {/* Value cell — takes remaining space; minWidth:0 prevents collapse */}
        <div style={{
          flex: 1,
          minWidth: 0,
          fontSize: 14,
          color: C.text,
          lineHeight: 1.5,
          wordWrap: "break-word",
          overflowWrap: "break-word",
          whiteSpace: "normal",
        }}>
          {displayValue.length > 150 ? (
            <div style={{
              fontSize: 12,
              color: C.text,
              lineHeight: 1.6,
              padding: "8px 10px",
              background: C.surfaceAlt,
              borderRadius: 6,
              border: `1px solid ${C.border}`,
              wordWrap: "break-word",
              overflowWrap: "break-word",
              whiteSpace: "pre-wrap",
              marginTop: 2,
            }}>
              {displayValue}
            </div>
          ) : (
            <span style={{
              fontSize: 14,
              color: C.text,
              wordWrap: "break-word",
              overflowWrap: "break-word",
              whiteSpace: "normal",
              lineHeight: 1.5,
              display: "block",
            }}>
              {displayValue}
            </span>
          )}
          {item.originalAIValue && item.originalAIValue !== displayValue && (
            <div style={{ marginTop: 4, fontSize: 10, color: "#1a3a4a90" }}>
              AI returned "{item.originalAIValue}" — mapped to dropdown option
            </div>
          )}
          {isUnmappedDropdown && (
            <div style={{ marginTop: 4, fontSize: 10, fontStyle: "italic", color: "#8c5500" }}>
              Doesn't match any dropdown option — please correct on the next page
            </div>
          )}
          {item.sourceTier === "tier2" && (
            <div style={{ marginTop: 4, fontSize: 10, fontStyle: "italic", color: "#8c5500" }}>
              From a company source — please confirm this is correct
            </div>
          )}
          {item.sourceTier === "tier3" && (
            <div style={{ marginTop: 4, fontSize: 10, fontStyle: "italic", color: "#C2410C" }}>
              ⚠ From unverified source — please verify this is correct
            </div>
          )}
        </div>
        {/* Source badge cell — FIXED width so long source text can never
            squeeze the value column. Badge text wraps inside. */}
        <div style={{
          flexShrink: 0,
          width: 180,
          minWidth: 180,
          maxWidth: 180,
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          gap: 4,
        }}>
          {renderSourceBadge(item, idx)}
        </div>
      </div>
    );
  };

  // Group rows by their schema-defined section so related fields (e.g.
  // Registered Address fields) appear together with a heading. Within each
  // section, rows preserve the caller's sort (typically: documents → tier1
  // → tier2, then schema field order). Returns an array of [section, rows]
  // pairs in the same order the sections appear in the schema, so the page
  // reads like the admin's schema layout.
  const groupFoundBySection = (items) => {
    const groups = new Map();
    items.forEach(({ item, idx }) => {
      const def = findFieldDef(activeSchema, item.field);
      const section = def?.section || item.section || "Other";
      if (!groups.has(section)) groups.set(section, []);
      groups.get(section).push({ item, idx });
    });
    // Order sections by their first appearance in the schema.
    const sectionOrder = new Map();
    let pos = 0;
    if (activeSchema) {
      [...(activeSchema.researchFields || []), ...(activeSchema.gapFields || [])].forEach((f) => {
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

  // One unified table grouped by source tier, sorted within group by
  // schema research-field order — then wrapped into per-section blocks so
  // the customer sees a clear heading for each logical group (e.g.
  // Registered Address vs Business Address rather than interleaved rows).
  const renderUnifiedFoundTable = (items, title, subtitle) => {
    const groups = groupFoundBySection(items);
    return (
      <div style={card}>
        <h3 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 4px" }}>{title}</h3>
        <p style={{ fontSize: 11, color: "#1a3a4a70", margin: "0 0 12px" }}>{subtitle}</p>
        {groups.map(([section, rows], gi) => (
          <div key={section} style={{ marginBottom: gi < groups.length - 1 ? 14 : 0 }}>
            <div style={{
              fontSize: 11, fontWeight: 700, letterSpacing: "0.06em",
              textTransform: "uppercase", color: "#1a3a4a80",
              marginBottom: 6,
            }}>
              {humaniseSection(section)}
            </div>
            {/* Header — column geometry mirrors renderFoundRow: 20px checkbox,
                180px label, flex:1 value, 180px source (gap 12). */}
            <div style={{ display: "flex", flexDirection: "row", gap: 12, padding: "8px 10px", background: "#1a3a4a", borderRadius: "8px 8px 0 0" }}>
              <span style={{ flexShrink: 0, width: 20, fontSize: 10, fontWeight: 700, color: "#fff" }}>✓</span>
              <span style={{ flexShrink: 0, width: 180, fontSize: 10, fontWeight: 700, color: "#fff" }}>FIELD</span>
              <span style={{ flex: 1, minWidth: 0, fontSize: 10, fontWeight: 700, color: "#fff" }}>VALUE</span>
              <span style={{ flexShrink: 0, width: 180, fontSize: 10, fontWeight: 700, color: "#fff", textAlign: "right" }}>SOURCE</span>
            </div>
            {rows.map((r, n) => renderFoundRow(r, n))}
          </div>
        ))}
      </div>
    );
  };

  // Stakeholder fields (directors / UBOs / shareholders / signatories) with
  // structured per-person data render as a card-per-person block instead of
  // a single grid row. Rendered as its own section above the unified table
  // so the row layout for everything else stays untouched. Items without a
  // populated stakeholders array fall through to the normal row renderer
  // for backward compatibility with legacy stored values.
  // Granular data points shown per stakeholder on Confirm. Each found point
  // gets a green tick (untick → routes to next page for edit); each missing
  // required point shows a "next page" tag. Mirrors the per-row green-tick
  // design used for regular confirm rows.
  const stkConfirmFields = (s, ubo) => {
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
  const stkFieldFound = (s, key) => {
    if (key === "is_pep") return s.is_pep === true || s.is_pep === false;
    if (key === "share_percentage") return s.share_percentage != null && String(s.share_percentage).trim() !== "";
    if (key === "positions") return Array.isArray(s.positions) && s.positions.some((p) => p && p.title);
    return s[key] != null && String(s[key]).trim() !== "";
  };
  const stkFieldDisplay = (s, key) => {
    if (key === "date_of_birth") return formatDOBForDisplay(s.date_of_birth) || s.date_of_birth || "";
    if (key === "share_percentage") return s.share_percentage != null ? `${s.share_percentage}%` : "";
    if (key === "is_pep") return s.is_pep === true ? "Yes" : s.is_pep === false ? "No" : "";
    if (key === "positions") {
      return (s.positions || [])
        .filter((p) => p && p.title)
        .map((p) => (p.start_date ? `${p.title} (since ${p.start_date})` : p.title))
        .join(", ");
    }
    return s[key] != null ? String(s[key]) : "";
  };
  // Field labels that will land on the next page for this person/company: any
  // found field the customer unticked, plus any missing required field.
  const stkNextPageFields = (s, ubo) =>
    stkConfirmFields(s, ubo)
      .filter((f) => {
        const found = stkFieldFound(s, f.key);
        if (found) return !isStkFieldConfirmed(s.id, f.key);
        return f.required;
      })
      .map((f) => f.label);

  // Render a customer-added (pending) stakeholder card on Confirm. The blank
  // person already lives in stakeholdersRef and will surface on the next page
  // for the customer to complete; here we just show it + allow removal.
  const renderPendingAddedStakeholder = (fieldId, s, ubo) => (
    <div
      key={s.id}
      style={{
        background: "#f3faf8", border: "1.5px dashed #4a9e8e",
        borderRadius: 8, marginBottom: 8, padding: "12px 16px",
        display: "flex", alignItems: "center", gap: 12,
      }}
    >
      <span style={{ fontSize: 16, flexShrink: 0 }}>{isCorporateStakeholder(s) ? "🏢" : "➕"}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#1a6b56" }}>
          New {isCorporateStakeholder(s) ? "company" : ubo ? "beneficial owner" : "director"} added
        </div>
        <div style={{ fontSize: 12, color: "#1a6b56", opacity: 0.85, marginTop: 2 }}>
          You'll complete their details on the next page.
        </div>
      </div>
      <button
        type="button"
        onClick={() => removeStakeholder(fieldId, s.id)}
        title="Remove"
        aria-label="Remove"
        style={{
          background: "none", border: "none", color: "#1a3a4a70",
          cursor: "pointer", fontSize: 22, lineHeight: 1, padding: "0 4px", fontFamily: "inherit",
        }}
      >
        ×
      </button>
    </div>
  );

  const renderStakeholderConfirmSection = (item, idx) => {
    if (!item || !Array.isArray(item.stakeholders) || item.stakeholders.length === 0) {
      return null;
    }
    // Exclude registry exemption notices — they are not people. If nothing real
    // remains, render nothing here so the field falls through to the normal
    // confirm row showing the raw registry value.
    const realStakeholders = item.stakeholders.filter((s) => !isRegistryExemptionNotice(s));
    if (realStakeholders.length === 0) return null;
    const ubo = isUboLikeField(item.field);
    const fieldDef = findFieldDef(activeSchema, item.field);
    const heading = fieldDef?.label
      || (ubo ? "Ultimate Beneficial Owners / Shareholders" : "Directors / Officers");
    const count = realStakeholders.length;
    const tier = item.sourceTier;
    const sourceBadge = tier === "tier1"
      ? { bg: "#dff2ec", color: "#1a6b56", glyph: "✅" }
      : tier === "document"
      ? { bg: "#0B3D91", color: "#fff", glyph: "📄" }
      : tier === "tier3"
      ? { bg: "#FFF7ED", color: "#C2410C", glyph: "⚠" }
      : { bg: "#fff1d6", color: "#8c5500", glyph: "~" };
    const allExpanded = realStakeholders.every((s) => isStakeholderExpanded(s.id));
    return (
      <div key={`stk-${item.field}-${idx}`} style={{ marginBottom: 14 }}>
        <div style={{
          fontSize: 11, fontWeight: 700, letterSpacing: "0.06em",
          textTransform: "uppercase", color: "#1a3a4a80",
          marginBottom: 8, paddingBottom: 6, borderBottom: "1px solid rgba(26,58,74,0.08)",
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap",
        }}>
          <span>{heading} · {count} found</span>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button
              type="button"
              onClick={() => setStakeholdersExpanded(realStakeholders.map((s) => s.id), !allExpanded)}
              style={{
                background: "none", border: "none", fontSize: 11, color: "#1a3a4a",
                fontWeight: 700, cursor: "pointer", fontFamily: "inherit", padding: 0,
                letterSpacing: "0.04em", textTransform: "uppercase",
              }}
            >
              {allExpanded ? "Collapse all ▴" : "Expand all ▾"}
            </button>
            <span style={{
              fontSize: 10, fontWeight: 700, color: sourceBadge.color,
              background: sourceBadge.bg, padding: "3px 8px", borderRadius: 4,
            }}>
              {sourceBadge.glyph} {item.source || (tier === "tier1" ? "Official source" : "Source")}
            </span>
          </div>
        </div>
        <p style={{ fontSize: 12, color: "#1a3a4a80", margin: "0 0 10px", lineHeight: 1.5 }}>
          Found {count} {count === 1 ? "person" : "people"} from {item.source || "research"}. Expand each
          person to review the details we found — keep the green tick on anything correct, or untick a
          field to edit it on the next page. Anything we couldn't find is collected on the next page too.
        </p>
        {realStakeholders.map((s) => {
          const rejected = isStakeholderRejected(item.field, s.id);
          const expanded = isStakeholderExpanded(s.id);
          // Listed-company shortcut: people who don't need EDD stay a simple
          // verified card (no granular routing ticks).
          const needsEDD = needsStakeholderDetails(s, item.field, effectivelyListed);
          const nextPageFields = needsEDD && !rejected ? stkNextPageFields(s, ubo) : [];
          return (
            <div
              key={s.id}
              style={{
                background: rejected ? "#fef2f2" : "#fafcfb",
                border: `1.5px solid ${rejected ? "#fecaca" : "rgba(26,58,74,0.08)"}`,
                borderRadius: 8, marginBottom: 8, overflow: "hidden",
                transition: "border-color .15s",
              }}
            >
              {/* Header row — click anywhere to expand/collapse */}
              <div
                onClick={() => toggleStakeholderExpanded(s.id)}
                style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "12px 16px", cursor: "pointer", userSelect: "none",
                }}
              >
                <input
                  type="checkbox"
                  checked={!rejected}
                  onChange={() => toggleStakeholderRejection(item.field, s.id)}
                  onClick={(e) => e.stopPropagation()}
                  style={{ width: 15, height: 15, flexShrink: 0, accentColor: "#4a9e8e", cursor: "pointer" }}
                  aria-label={`Confirm ${s.full_name}`}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{
                      fontSize: 14, fontWeight: 700,
                      color: rejected ? "#1a3a4a70" : "#1a3a4a",
                      textDecoration: rejected ? "line-through" : "none",
                    }}>
                      {isCorporateStakeholder(s) ? "🏢" : "👤"} {s.full_name}
                    </span>
                    {s.role && (
                      <span style={{
                        fontSize: 11, color: "#1a3a4a80", background: "#f2f1ed",
                        padding: "2px 8px", borderRadius: 99,
                        border: "1px solid rgba(26,58,74,0.08)",
                      }}>
                        {s.role}
                      </span>
                    )}
                    {s.share_percentage != null && (
                      <span style={{
                        fontSize: 11, color: "#1a6b56", background: "#dff2ec",
                        padding: "2px 8px", borderRadius: 99,
                        border: "1px solid rgba(74,158,142,0.3)",
                      }}>
                        {s.share_percentage}%
                      </span>
                    )}
                  </div>
                  {!expanded && (
                    <div style={{ fontSize: 11, color: "#1a3a4a70", marginTop: 3 }}>
                      {rejected
                        ? "⚠ Marked as incorrect — tap to review"
                        : nextPageFields.length > 0
                        ? `${nextPageFields.length} field${nextPageFields.length > 1 ? "s" : ""} to complete on next page · tap to expand`
                        : "✓ All details confirmed · tap to expand"}
                    </div>
                  )}
                </div>
                {rejected && (
                  <span style={{
                    fontSize: 10, fontWeight: 700, color: "#dc2626", background: "#fef2f2",
                    border: "1px solid #fecaca", borderRadius: 99,
                    padding: "2px 8px", flexShrink: 0,
                  }}>
                    ✗ Incorrect
                  </span>
                )}
                <span style={{
                  fontSize: 14, color: "#1a3a4a70", flexShrink: 0,
                  transition: "transform 0.2s", display: "inline-block",
                  transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
                }}>
                  ▾
                </span>
              </div>

              {/* Expandable body */}
              {expanded && (
                <div style={{
                  padding: "12px 16px 14px",
                  borderTop: "1px solid rgba(26,58,74,0.08)",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
                    <span style={{
                      fontSize: 10, fontWeight: 700, color: sourceBadge.color,
                      background: sourceBadge.bg, padding: "3px 8px", borderRadius: 4,
                    }}>
                      {sourceBadge.glyph} {item.source || (tier === "tier1" ? "Official source" : "Source")}
                    </span>
                    {(s.fetchedAt || item.fetchedAt) && (
                      <span
                        style={{ fontSize: 11, color: "#1a3a4a70", cursor: "default" }}
                        title={`Fetched: ${s.fetchedAt || item.fetchedAt}`}
                      >
                        🕐 When?
                      </span>
                    )}
                  </div>

                  {rejected ? (
                    <div style={{ fontSize: 12, color: "#1a3a4a70", fontStyle: "italic" }}>
                      This person is marked incorrect — you'll enter the correct details on the next page.
                    </div>
                  ) : !needsEDD ? (
                    <div style={{ fontSize: 12, color: "#1a6b56", fontStyle: "italic" }}>
                      ✓ Verified from official sources. No additional details required for a listed company.
                    </div>
                  ) : (
                    <>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {stkConfirmFields(s, ubo).map((f) => {
                          const amberTag = {
                            fontSize: 10, fontWeight: 700, color: "#8c5500",
                            background: "#fff8ed", border: "1px solid #e0a040",
                            borderRadius: 99, padding: "2px 8px", whiteSpace: "nowrap", flexShrink: 0,
                          };
                          if (stkFieldFound(s, f.key)) {
                            const confirmed = isStkFieldConfirmed(s.id, f.key);
                            return (
                              <label key={f.key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, cursor: "pointer" }}>
                                <input
                                  type="checkbox"
                                  checked={confirmed}
                                  onChange={() => toggleStkFieldConfirm(s.id, f.key)}
                                  style={{ width: 14, height: 14, accentColor: "#4a9e8e", flexShrink: 0, cursor: "pointer" }}
                                  aria-label={`Confirm ${f.label}`}
                                />
                                <span style={{ color: "#1a3a4a80", width: 130, flexShrink: 0 }}>{f.label}</span>
                                <span style={{ fontWeight: 600, color: "#1a3a4a", flex: 1, minWidth: 0 }}>{stkFieldDisplay(s, f.key)}</span>
                                {!confirmed && <span style={amberTag}>✎ edit on next page</span>}
                              </label>
                            );
                          }
                          if (!f.required) return null;
                          return (
                            <div key={f.key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                              <span style={{ width: 14, textAlign: "center", color: "#e0a040", flexShrink: 0 }}>＋</span>
                              <span style={{ color: "#1a3a4a80", width: 130, flexShrink: 0 }}>{f.label}</span>
                              <span style={{ color: "#1a3a4a70", flex: 1, fontStyle: "italic" }}>Not found</span>
                              <span style={amberTag}>added on next page</span>
                            </div>
                          );
                        })}
                      </div>
                      <div style={{ fontSize: 11, color: "#1a3a4a70", marginTop: 10, fontStyle: "italic" }}>
                        {nextPageFields.length > 0
                          ? `On the next page you'll complete: ${nextPageFields.join(", ")}.`
                          : "All details confirmed — nothing further needed on the next page."}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* Customer-added people (pending) — created here, completed next page */}
        {getStakeholders(item.field)
          .filter((s) => s.customer_added && !isRegistryExemptionNotice(s))
          .map((s) => renderPendingAddedStakeholder(item.field, s, ubo))}

      </div>
    );
  };

  // ── Per-person stakeholder forms on Fill Gaps ────────────────────────
  // Each accepted/rejected/customer-added person renders as an accordion
  // card with name, role, nationality, DOB, residential country, ID type
  // & number, and PEP toggle + details. Reads/writes through the
  // stakeholdersRef helpers — explicit re-render on every change so
  // completion badges and the conditional PEP-details textarea stay
  // synced with the underlying data.

  const stakeholderLabelStyle = {
    display: "block", fontSize: 12, fontWeight: 600,
    color: "#1a3a4a", marginBottom: 5,
  };

  const stakeholderLockedStyle = {
    padding: "10px 14px", background: "#f2f1ed", borderRadius: 8,
    border: "1.5px solid rgba(26,58,74,0.14)", fontSize: 14,
    color: "#1a3a4a80", display: "flex", alignItems: "center",
    justifyContent: "space-between",
  };

  const stakeholderRequiredKeys = (s) => {
    if (s && s.is_company) {
      // Corporate stakeholder: KYB fields, no person EDD.
      return ["full_name", "business_type", "business_registration_number", "registered_country"];
    }
    const keys = ["full_name", "nationality", "date_of_birth", "is_pep"];
    if (s && s.is_pep === true) keys.push("pep_details");
    return keys;
  };

  const stakeholderMissingFields = (s) => {
    return stakeholderRequiredKeys(s).filter((k) => {
      if (k === "is_pep") return s.is_pep === null || s.is_pep === undefined;
      const v = s[k];
      return v == null || String(v).trim() === "";
    });
  };

  // Common legal/business types for a corporate stakeholder.
  const BUSINESS_TYPE_OPTIONS = [
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

  // Next-page (Fill Gaps) body for a CORPORATE stakeholder — KYB fields plus a
  // repeatable positions list. A found field stays verified while its Confirm
  // green tick is on; unticking opens it for edit (same as the person form).
  const renderStakeholderCardCorporateBody = (fieldId, s) => {
    const aiFound = !s.customer_rejected && !s.customer_added;
    const nameLocked = aiFound && isStkFieldConfirmed(s.id, "full_name");
    const positions = s.positions || [];
    return (
      <>
        {/* Business name */}
        {nameLocked ? (
          <div style={{ marginBottom: 14 }}>
            <label style={stakeholderLabelStyle}>Business Name <span style={{ color: "#d44" }}>*</span></label>
            <div style={stakeholderLockedStyle}>
              <span>{s.full_name}</span>
              <span style={{ fontSize: 10, fontWeight: 700, color: "#1a6b56" }}>✓ Verified</span>
            </div>
          </div>
        ) : (
          <StableInput
            id={`stk_${fieldId}_${s.id}_business_name`}
            label="Business Name"
            type="text"
            value={s.full_name || ""}
            onUpdate={(_, v) => updateStakeholderField(fieldId, s.id, "full_name", v)}
            required
            placeholder="Registered / legal name"
          />
        )}

        {/* Business type */}
        <StableInput
          id={`stk_${fieldId}_${s.id}_business_type`}
          label="Business Type"
          type="select"
          value={s.business_type || ""}
          onUpdate={(_, v) => updateStakeholderField(fieldId, s.id, "business_type", v)}
          required
          options={BUSINESS_TYPE_OPTIONS}
        />

        {/* Business registration number */}
        <StableInput
          id={`stk_${fieldId}_${s.id}_brn`}
          label="Business Registration Number"
          type="text"
          value={s.business_registration_number || ""}
          onUpdate={(_, v) => updateStakeholderField(fieldId, s.id, "business_registration_number", v)}
          required
          placeholder="e.g. Companies House / ACRA number"
        />

        {/* Registered country — pre-filled & verified when the AI found it */}
        <PrePopulatedField
          id={`stk_${fieldId}_${s.id}_reg_country`}
          label="Registered Country"
          type="select"
          value={s.registered_country || ""}
          onUpdate={(_, v) => updateStakeholderField(fieldId, s.id, "registered_country", v)}
          options={COUNTRIES.map((c) => ({ value: c.name, label: c.name }))}
          sourceLabel={s.source}
          startEditing={!isStkFieldConfirmed(s.id, "registered_country")}
          required
        />

        {/* Shareholding (optional) */}
        <StableInput
          id={`stk_${fieldId}_${s.id}_share`}
          label="Shareholding %"
          type="text"
          value={s.share_percentage != null ? String(s.share_percentage) : ""}
          onUpdate={(_, v) => updateStakeholderField(fieldId, s.id, "share_percentage", v === "" ? null : v)}
          placeholder="e.g. 100"
        />

        {/* Positions — repeatable { title, start_date } */}
        <div style={{ marginBottom: 4 }}>
          <label style={stakeholderLabelStyle}>Position(s)</label>
          {positions.length === 0 && (
            <p style={{ fontSize: 11, color: "#1a3a4a70", margin: "0 0 8px", fontStyle: "italic" }}>
              No positions added yet.
            </p>
          )}
          {positions.map((p, i) => (
            <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-end", marginBottom: 8 }}>
              <div style={{ flex: 2, minWidth: 0 }}>
                <StableInput
                  id={`stk_${fieldId}_${s.id}_pos_${i}_title`}
                  label="Title"
                  type="text"
                  value={p.title || ""}
                  onUpdate={(_, v) => updateStkPosition(fieldId, s.id, i, "title", v)}
                  placeholder="e.g. Parent Company, Corporate Director"
                />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <StableInput
                  id={`stk_${fieldId}_${s.id}_pos_${i}_start`}
                  label="Start date"
                  type="date"
                  value={p.start_date || ""}
                  onUpdate={(_, v) => updateStkPosition(fieldId, s.id, i, "start_date", v)}
                />
              </div>
              <button
                type="button"
                onClick={() => removeStkPosition(fieldId, s.id, i)}
                title="Remove position"
                aria-label="Remove position"
                style={{
                  background: "none", border: "none", color: "#1a3a4a70",
                  cursor: "pointer", fontSize: 20, lineHeight: 1, padding: "0 4px 10px",
                  fontFamily: "inherit",
                }}
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => addStkPosition(fieldId, s.id)}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6, marginBottom: 14,
              padding: "8px 14px", background: "transparent", color: "#1a3a4a",
              border: "1.5px dashed #4a9e8e", borderRadius: 8,
              fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
            }}
          >
            + Add position
          </button>
        </div>
      </>
    );
  };

  const renderStakeholderCard = (fieldId, stakeholder, index) => {
    const ubo = isUboLikeField(fieldId);
    const isRejected = !!stakeholder.customer_rejected;
    const isAdded = !!stakeholder.customer_added;
    const isAIFound = !isRejected && !isAdded;
    const missing = stakeholderMissingFields(stakeholder);
    const isComplete = missing.length === 0;

    // A found field stays locked/verified only while its Confirm-page green tick
    // is still on; unticking it on Confirm opens it for editing here.
    const nameLocked = isAIFound && isStkFieldConfirmed(stakeholder.id, "full_name");
    const roleLocked = isAIFound && stakeholder.role && isStkFieldConfirmed(stakeholder.id, "role");

    return (
      <div
        key={stakeholder.id}
        style={{
          borderRadius: 10,
          border: `1.5px solid ${isComplete ? "#4a9e8e" : isRejected ? "#fecaca" : "rgba(26,58,74,0.14)"}`,
          background: isRejected ? "#fef9f9" : "#fff",
          marginBottom: 12, overflow: "hidden",
        }}
      >
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "12px 16px", background: "#fafcfb",
          borderBottom: "1px solid rgba(26,58,74,0.08)", gap: 8, flexWrap: "wrap",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <span style={{ fontSize: 18 }}>{isCorporateStakeholder(stakeholder) ? "🏢" : "👤"}</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#1a3a4a" }}>
                {stakeholder.full_name || `${isCorporateStakeholder(stakeholder) ? "Company" : "Person"} ${index + 1}`}
              </div>
              {(stakeholder.role || stakeholder.share_percentage != null) && (
                <div style={{ fontSize: 11, color: "#1a3a4a80", marginTop: 2 }}>
                  {stakeholder.role || ""}
                  {stakeholder.role && stakeholder.share_percentage != null ? " · " : ""}
                  {stakeholder.share_percentage != null ? `${stakeholder.share_percentage}%` : ""}
                </div>
              )}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{
              fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 99,
              background: isComplete ? "#dff2ec" : "#fff8ed",
              color: isComplete ? "#1a6b56" : "#8c5500",
              border: `1px solid ${isComplete ? "#4a9e8e" : "#e0a040"}40`,
            }}>
              {isComplete
                ? "✅ Complete"
                : `⚠ ${missing.length} field${missing.length > 1 ? "s" : ""} needed`}
            </span>
            {isAIFound && stakeholder.source && (
              <span style={{
                fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 4,
                background: "#dff2ec", color: "#1a6b56",
              }}>
                ✓ {stakeholder.source}
              </span>
            )}
            {isRejected && (
              <span style={{
                fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 4,
                background: "#fef2f2", color: "#dc2626", border: "1px solid #fecaca",
              }}>
                Correction needed
              </span>
            )}
            {(isAdded || isRejected) && (
              <button
                type="button"
                onClick={() => removeStakeholder(fieldId, stakeholder.id)}
                style={{
                  background: "none", border: "none", color: "#1a3a4a70",
                  cursor: "pointer", fontSize: 22, lineHeight: 1, padding: "0 4px",
                  fontFamily: "inherit",
                }}
                title="Remove this person"
                aria-label="Remove"
              >
                ×
              </button>
            )}
          </div>
        </div>

        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 0 }}>
          {isCorporateStakeholder(stakeholder) ? renderStakeholderCardCorporateBody(fieldId, stakeholder) : (
          <>
          {/* Name */}
          {nameLocked ? (
            <div style={{ marginBottom: 14 }}>
              <label style={stakeholderLabelStyle}>Full Legal Name <span style={{ color: "#d44" }}>*</span></label>
              <div style={stakeholderLockedStyle}>
                <span>{stakeholder.full_name}</span>
                <span style={{ fontSize: 10, fontWeight: 700, color: "#1a6b56" }}>✓ Verified</span>
              </div>
            </div>
          ) : (
            <>
              {isRejected && stakeholder.full_name_original && (
                <p style={{ fontSize: 11, color: "#1a3a4a80", fontStyle: "italic", margin: "0 0 4px" }}>
                  AI found: "{stakeholder.full_name_original}" — please enter the correct name
                </p>
              )}
              <StableInput
                id={`stk_${fieldId}_${stakeholder.id}_full_name`}
                label={`Full Legal Name`}
                type="text"
                value={stakeholder.full_name || ""}
                onUpdate={(_, v) => updateStakeholderField(fieldId, stakeholder.id, "full_name", v)}
                required
                placeholder="Full legal name"
              />
            </>
          )}

          {/* Role */}
          {roleLocked ? (
            <div style={{ marginBottom: 14 }}>
              <label style={stakeholderLabelStyle}>Role / Position</label>
              <div style={stakeholderLockedStyle}>
                <span>{stakeholder.role}</span>
                <span style={{ fontSize: 10, fontWeight: 700, color: "#1a6b56" }}>✓ Verified</span>
              </div>
            </div>
          ) : (
            <StableInput
              id={`stk_${fieldId}_${stakeholder.id}_role`}
              label="Role / Position"
              type="text"
              value={stakeholder.role || ""}
              onUpdate={(_, v) => updateStakeholderField(fieldId, stakeholder.id, "role", v)}
              placeholder={ubo ? "e.g. Shareholder, UBO" : "e.g. CEO, Director, CFO"}
            />
          )}

          {/* Nationality — pre-filled & locked (editable) when the AI found it */}
          <PrePopulatedField
            id={`stk_${fieldId}_${stakeholder.id}_nationality`}
            label="Nationality"
            type="text"
            value={stakeholder.nationality || ""}
            onUpdate={(_, v) => updateStakeholderField(fieldId, stakeholder.id, "nationality", v)}
            sourceLabel={stakeholder.source}
            startEditing={!isStkFieldConfirmed(stakeholder.id, "nationality")}
            required
            placeholder="e.g. British, American, Singaporean"
          />

          {/* Date of birth — pre-filled & locked (editable) when the AI found it */}
          <PrePopulatedField
            id={`stk_${fieldId}_${stakeholder.id}_dob`}
            label="Date of Birth"
            type="date"
            value={stakeholder.date_of_birth || ""}
            displayValue={formatDOBForDisplay(stakeholder.date_of_birth)}
            onUpdate={(_, v) => updateStakeholderField(fieldId, stakeholder.id, "date_of_birth", v)}
            sourceLabel={stakeholder.source}
            startEditing={!isStkFieldConfirmed(stakeholder.id, "date_of_birth")}
            required
            placeholder="YYYY-MM-DD"
          />

          {/* Country of residence — pre-filled & locked (editable) when the AI
              found it on the registry; falls through to a country picker when empty */}
          <PrePopulatedField
            id={`stk_${fieldId}_${stakeholder.id}_country`}
            label="Country of Residence"
            type="select"
            value={stakeholder.residential_country || ""}
            onUpdate={(_, v) => updateStakeholderField(fieldId, stakeholder.id, "residential_country", v)}
            options={COUNTRIES.map((c) => ({ value: c.name, label: c.name }))}
            sourceLabel={stakeholder.source}
            startEditing={!isStkFieldConfirmed(stakeholder.id, "residential_country")}
          />

          {/* Identity Document Type and Identity Document Number are intentionally
              hidden at Fill Gaps — these are collected later in the verification
              flow, not from the registry. Uncomment to restore.
          <StableInput
            id={`stk_${fieldId}_${stakeholder.id}_id_type`}
            label="Identity Document Type"
            type="select"
            value={stakeholder.id_type || ""}
            onUpdate={(_, v) => updateStakeholderField(fieldId, stakeholder.id, "id_type", v)}
            options={[
              { value: "passport", label: "Passport" },
              { value: "national_id", label: "National ID Card" },
              { value: "driving_licence", label: "Driving Licence" },
              { value: "other", label: "Other" },
            ]}
          />
          <StableInput
            id={`stk_${fieldId}_${stakeholder.id}_id_number`}
            label="Identity Document Number"
            type="text"
            value={stakeholder.id_number || ""}
            onUpdate={(_, v) => updateStakeholderField(fieldId, stakeholder.id, "id_number", v)}
            placeholder="Passport or ID number"
          />
          */}

          {/* PEP three-button toggle */}
          <div style={{ marginBottom: 14 }}>
            <label style={stakeholderLabelStyle}>
              Politically Exposed Person (PEP)? <span style={{ color: "#d44" }}>*</span>
            </label>
            <p style={{ fontSize: 11, color: "#1a3a4a80", lineHeight: 1.4, margin: "0 0 8px" }}>
              A PEP holds or has held a prominent public function, or is closely associated with someone who does.
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              {[
                { val: false, label: "No", c: "#4a9e8e", bg: "#dff2ec" },
                { val: true, label: "Yes", c: "#dc2626", bg: "#fef2f2" },
                { val: null, label: "Not Sure", c: "#1a3a4a", bg: "#e0e8f4" },
              ].map((opt) => {
                const selected = stakeholder.is_pep === opt.val;
                return (
                  <button
                    key={String(opt.val)}
                    type="button"
                    onClick={() => updateStakeholderField(fieldId, stakeholder.id, "is_pep", opt.val)}
                    style={{
                      flex: 1, padding: "10px 0", borderRadius: 8,
                      border: `1.5px solid ${selected ? opt.c : "rgba(26,58,74,0.14)"}`,
                      background: selected ? opt.bg : "transparent",
                      color: selected ? opt.c : "#1a3a4a80",
                      fontWeight: selected ? 700 : 500, fontSize: 13,
                      fontFamily: "inherit", cursor: "pointer", transition: "all .15s",
                    }}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Conditional PEP details */}
          {stakeholder.is_pep === true && (
            <StableInput
              id={`stk_${fieldId}_${stakeholder.id}_pep_details`}
              label="PEP Details"
              type="textarea"
              value={stakeholder.pep_details || ""}
              onUpdate={(_, v) => updateStakeholderField(fieldId, stakeholder.id, "pep_details", v)}
              required
              placeholder="Please describe the political position, function, or connection"
            />
          )}
          </>
          )}
        </div>
      </div>
    );
  };

  // Read-only green summary shown for a listed company's stakeholders that
  // don't require enhanced due diligence (directors/officers, and UBOs < 25%).
  // `field` is the research row; `isPartial` renders it as a subsection above
  // the >= 25% UBO forms.
  const renderListedCompanyStakeholderSummary = (field, stakeholders, isPartial = false) => {
    const ubo = isUboLikeField(field.field);
    const fieldLabel = ubo ? "Beneficial Owners / Shareholders" : "Directors / Officers";
    const lower = fieldLabel.toLowerCase();
    return (
      <div style={{
        borderRadius: 10,
        border: "1px solid #4a9e8e",
        background: "#f3faf8",
        overflow: "hidden",
        marginBottom: isPartial ? 16 : 0,
      }}>
        <div style={{
          padding: "12px 16px",
          borderBottom: "1px solid #cfe9e1",
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <span style={{ fontSize: 16 }}>✅</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#1a6b56" }}>
                {isPartial ? `Other ${fieldLabel}` : fieldLabel}
              </div>
              <div style={{ fontSize: 12, color: "#1a6b56", opacity: 0.8, marginTop: 2 }}>
                Publicly listed company — verified from official sources. No additional details required.
              </div>
            </div>
          </div>
          <span style={{
            fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 99,
            background: "#4a9e8e", color: "#fff", whiteSpace: "nowrap",
          }}>
            🏛 Listed Company
          </span>
        </div>

        <div style={{ padding: "12px 16px" }}>
          {stakeholders.length === 0 ? (
            <p style={{ fontSize: 13, color: "#1a6b56", fontStyle: "italic", margin: 0 }}>
              No {lower} found in public records.
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {stakeholders.map((s) => (
                <div key={s.id} style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "8px 12px", background: "rgba(255,255,255,0.6)",
                  borderRadius: 8, border: "1px solid #cfe9e1",
                }}>
                  <span style={{ fontSize: 16 }}>👤</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "#1a3a4a" }}>{s.full_name}</div>
                    <div style={{ fontSize: 12, color: "#1a3a4a80", marginTop: 2 }}>
                      {[s.role, s.share_percentage != null ? `${s.share_percentage}% shareholding` : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 600, color: "#1a6b56", whiteSpace: "nowrap" }}>
                    ✓ Verified
                  </span>
                </div>
              ))}
            </div>
          )}

          <p style={{ fontSize: 12, color: "#1a6b56", marginTop: 12, marginBottom: 0, lineHeight: 1.5, fontStyle: "italic" }}>
            As a publicly listed company, {lower} information is publicly disclosed through regulatory
            filings. Enhanced due diligence details (nationality, date of birth, PEP status) are not
            required for listed company {lower}.
          </p>
        </div>
      </div>
    );
  };

  // ── Fill Gaps stakeholder rendering, split in two ───────────────────────
  // renderStakeholderForms  → only people who need customer input (rendered
  //   in the "additional details needed" section, near the other gap inputs).
  // renderStakeholderSummary → read-only confirmed info / "no action required"
  //   (rendered in the "verified — for reference" section at the bottom).
  // Both return null when they have nothing to show, so the caller can hide
  // the section divider when a field contributes no content.

  // Split "add a stakeholder" buttons (individual vs company) for the Fill Gaps
  // people sections. The blank record is created in the ref and renders its
  // person/company form immediately below.
  const renderAddStakeholderButtons = (fieldId, ubo) => (
    <div style={{ display: "flex", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
      {[
        { label: `+ Add ${ubo ? "individual owner" : "individual"}`, overrides: {} },
        { label: "+ Add company", overrides: { is_company: true } },
      ].map((b) => (
        <button
          key={b.label}
          type="button"
          onClick={() => addStakeholder(fieldId, b.overrides)}
          style={{
            flex: "1 1 0", minWidth: 150,
            display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
            padding: "10px 18px", background: "transparent", color: "#1a3a4a",
            border: "1.5px dashed #4a9e8e", borderRadius: 8,
            fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
          }}
        >
          {b.label}
        </button>
      ))}
    </div>
  );

  const renderStakeholderForms = (researchItem) => {
    const fieldId = researchItem.field;
    const ubo = isUboLikeField(fieldId);
    const personLabel = ubo ? "beneficial owner" : "director";
    const fieldDef = findFieldDef(activeSchema, fieldId);
    const heading = fieldDef?.label || (ubo ? "Beneficial Owners / Shareholders" : "Directors / Officers");
    const list = getStakeholders(fieldId);

    // Drop registry exemption notices — never real people / EDD forms.
    const validStakeholders = list.filter((s) => !isRegistryExemptionNotice(s));
    const needingDetails = validStakeholders.filter((s) => needsStakeholderDetails(s, fieldId, effectivelyListed));

    // Private company with no real people found yet: prompt to add one. This is
    // a customer action, so it belongs in the forms section.
    if (!effectivelyListed && validStakeholders.length === 0) {
      return (
        <div key={`stk-forms-${fieldId}`} style={card}>
          <h3 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 4px" }}>👥 {heading}</h3>
          <div style={{
            margin: "0 0 14px", padding: "10px 14px", borderRadius: 8,
            background: "#fff8ed", border: "1px solid #e0a040",
            fontSize: 12, color: "#8c5500",
          }}>
            No {personLabel}s were found automatically. Please add at least one {personLabel} below.
          </div>
          {renderAddStakeholderButtons(fieldId, ubo)}
        </div>
      );
    }

    // Nobody needs input → nothing in the forms section (summary handles the
    // read-only reference at the bottom of the page).
    if (needingDetails.length === 0) return null;

    return (
      <div key={`stk-forms-${fieldId}`} style={card}>
        <h3 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 4px" }}>👥 {heading}</h3>
        {effectivelyListed ? (
          <div style={{
            padding: "12px 16px", background: "#fff8ed", border: "1px solid #e0a040",
            borderRadius: 8, fontSize: 13, color: "#8c5500",
            marginBottom: 16, display: "flex", gap: 8,
          }}>
            <span>⚠</span>
            <span>
              Although this is a listed company, the following beneficial owner
              {needingDetails.length > 1 ? "s hold" : " holds"} 25% or more of shares and requires
              enhanced due diligence details.
            </span>
          </div>
        ) : (
          <p style={{ fontSize: 12, color: "#1a3a4a80", margin: "0 0 14px", lineHeight: 1.5 }}>
            Complete the required details for each {personLabel} below. Names and roles marked
            "Verified" came from the research on the previous page; everything else needs your input.
          </p>
        )}
        {needingDetails.map((s, i) => renderStakeholderCard(fieldId, s, i))}
        {!effectivelyListed && renderAddStakeholderButtons(fieldId, ubo)}
      </div>
    );
  };

  const renderStakeholderSummary = (researchItem) => {
    const fieldId = researchItem.field;
    const ubo = isUboLikeField(fieldId);
    const fieldDef = findFieldDef(activeSchema, fieldId);
    const heading = fieldDef?.label || (ubo ? "Beneficial Owners / Shareholders" : "Directors / Officers");
    const list = getStakeholders(fieldId);
    const validStakeholders = list.filter((s) => !isRegistryExemptionNotice(s));
    const confirmedOnly = validStakeholders.filter((s) => !needsStakeholderDetails(s, fieldId, effectivelyListed));

    // Listed company with no real owners (e.g. PSC-exempt — only an exemption
    // notice): clean "No action required" reference card.
    if (validStakeholders.length === 0 && effectivelyListed) {
      return (
        <div key={`stk-summary-${fieldId}`} style={card}>
          <h3 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 12px" }}>👥 {heading}</h3>
          <div style={{
            padding: "14px 16px", background: "#f3faf8", border: "1px solid #4a9e8e",
            borderRadius: 10, display: "flex", alignItems: "center", gap: 10,
          }}>
            <span style={{ fontSize: 18 }}>✅</span>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#1a6b56" }}>
                {heading} — No action required
              </div>
              <div style={{ fontSize: 12, color: "#1a6b56", opacity: 0.8, marginTop: 2 }}>
                This is a publicly listed company. Ownership information is publicly disclosed through
                regulatory filings. No additional details required.
              </div>
            </div>
          </div>
        </div>
      );
    }

    // Nothing read-only to show (e.g. a private company — everyone is in the
    // forms section above, so no duplicate rendering here).
    if (confirmedOnly.length === 0) return null;

    return (
      <div key={`stk-summary-${fieldId}`} style={card}>
        <h3 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 12px" }}>👥 {heading}</h3>
        {renderListedCompanyStakeholderSummary(researchItem, confirmedOnly, false)}
      </div>
    );
  };

  const validateStakeholders = () => {
    const errors = [];
    (research?.found || []).forEach((result) => {
      if (!isStakeholderField(result.field)) return;
      if (!Array.isArray(result.stakeholders) || result.stakeholders.length === 0) return;
      const list = getStakeholders(result.field);
      // Registry exemption notices are not people — never validate them.
      const validStakeholders = list.filter((s) => !isRegistryExemptionNotice(s));
      const ubo = isUboLikeField(result.field);
      const personLabel = ubo ? "beneficial owner" : "director";

      // Only validate stakeholders that still need the full gap form. For a
      // listed company that's the >= 25% UBOs; for a private company it's
      // everyone (so behaviour is unchanged).
      const toValidate = validStakeholders.filter((s) => needsStakeholderDetails(s, result.field, effectivelyListed));

      // Listed company where no one needs details — nothing to validate.
      if (effectivelyListed && toValidate.length === 0) return;

      if (validStakeholders.length === 0) {
        errors.push(`Please add at least one ${personLabel}.`);
        return;
      }
      toValidate.forEach((s, idx) => {
        const isCo = !!s.is_company;
        const display = (s.full_name && s.full_name.trim()) || (isCo ? `Company ${idx + 1}` : `Person ${idx + 1}`);
        const missing = stakeholderMissingFields(s);
        missing.forEach((k) => {
          if (k === "full_name") errors.push(isCo ? `Please enter the business name for company ${idx + 1}.` : `Please enter the full name for person ${idx + 1}.`);
          else if (k === "business_type") errors.push(`Please select the business type for ${display}.`);
          else if (k === "business_registration_number") errors.push(`Please enter the registration number for ${display}.`);
          else if (k === "registered_country") errors.push(`Please select the registered country for ${display}.`);
          else if (k === "nationality") errors.push(`Please enter nationality for ${display}.`);
          else if (k === "date_of_birth") errors.push(`Please enter date of birth for ${display}.`);
          else if (k === "is_pep") errors.push(`Please answer the PEP question for ${display}.`);
          else if (k === "pep_details") errors.push(`Please provide PEP details for ${display}.`);
        });
      });
    });
    return errors;
  };

  // Sort key per spec: documents first, tier1 next, tier2 last; within group
  // by the schema researchFields order.
  const sourceTierRank = { document: 0, tier1: 1, tier2: 2, tier3: 3 };
  const fieldOrderMap = activeSchema ? new Map(activeSchema.researchFields.map((f, i) => [f.field, i])) : new Map();
  const sortedFound = (research?.found || [])
    .map((item, idx) => ({ item, idx }))
    .sort((a, b) => {
      const ra = sourceTierRank[a.item.sourceTier] ?? 99;
      const rb = sourceTierRank[b.item.sourceTier] ?? 99;
      if (ra !== rb) return ra - rb;
      const fa = fieldOrderMap.has(a.item.field) ? fieldOrderMap.get(a.item.field) : 999;
      const fb = fieldOrderMap.has(b.item.field) ? fieldOrderMap.get(b.item.field) : 999;
      return fa - fb;
    });

  // Split out stakeholder items with real people so they render as cards above
  // the regular pre-filled table. A field whose only entries are registry
  // exemption notices has no real people, so it stays in the regular flow as a
  // normal row (showing the raw registry value).
  const hasRealStakeholders = (item) =>
    isStakeholderField(item.field) &&
    Array.isArray(item.stakeholders) &&
    item.stakeholders.some((s) => !isRegistryExemptionNotice(s));
  const stakeholderFound = sortedFound.filter(({ item }) => hasRealStakeholders(item));
  const regularFound = sortedFound.filter(({ item }) => !hasRealStakeholders(item));

  // Fill Gaps stakeholder rendering, split into two sections. Forms (input
  // needed) render with the other gap inputs; summaries (read-only) render at
  // the bottom for reference. Render functions return null when empty, so the
  // section dividers below only appear when there's actual content.
  const stakeholderGapRows = (research?.found || []).filter((r) => {
    if (!isStakeholderField(r.field) || !Array.isArray(r.stakeholders)) return false;
    if (r.stakeholders.some((s) => !isRegistryExemptionNotice(s))) return true;
    // Listed company whose only "owners" were exemption notices (filtered out
    // of .stakeholders): still surface the "no action required" summary.
    return effectivelyListed && typeof r.value === "string" && r.value.trim().length > 0;
  });
  const stakeholderFormNodes = stakeholderGapRows.map((r) => renderStakeholderForms(r)).filter(Boolean);
  const stakeholderSummaryNodes = stakeholderGapRows.map((r) => renderStakeholderSummary(r)).filter(Boolean);
  const hasStakeholderForms = stakeholderFormNodes.length > 0;
  const hasStakeholderSummary = stakeholderSummaryNodes.length > 0;

  const docCount = (research?.found || []).filter(i => i.sourceTier === "document").length;
  const tier1Count = (research?.found || []).filter(i => i.sourceTier === "tier1").length;
  const tier2Count = (research?.found || []).filter(i => i.sourceTier === "tier2").length;
  const tier3Count = (research?.found || []).filter(i => i.sourceTier === "tier3").length;

  // Resolved values from tenant config with safe fallbacks. Keep these on the
  // happy path (after configLoading guard) so any null deref is contained.
  const companyName_ = tenantConfig?.company?.name || "Nium";
  const companyLogo_ = tenantConfig?.company?.logo || null;
  const manualFormUrl_ = tenantConfig?.company?.manualFormUrl || MANUAL_FORM_URL;
  const activeEntityTypes = (tenantConfig?.entityTypes || [])
    .filter(e => e.active !== false)
    .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));

  if (configLoading) {
    return (
      <div style={{
        minHeight: "100vh",
        background: "linear-gradient(170deg, #f4f8f7 0%, #eaeff4 50%, #f7f4f0 100%)",
        fontFamily: "'DM Sans','Segoe UI',system-ui,sans-serif",
        color: "#1a3a4a",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <div style={{ textAlign: "center" }}>
          <div style={{
            width: 48, height: 48, border: "3px solid rgba(74,158,142,0.2)",
            borderTopColor: "#4a9e8e", borderRadius: "50%", margin: "0 auto 14px",
            animation: "kspin 0.9s linear infinite",
          }} />
          <div style={{ fontSize: 14, fontWeight: 600 }}>Loading configuration…</div>
          <style>{`@keyframes kspin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    );
  }

  // ───────────────────────────────────────────────────────────────────────
  // LANDING PAGE — agent selection. Renders before Step 1. Onboarding Agent
  // routes into the existing flow; Pre-boarding Agent is password-gated (ARCH)
  // and shows a coming-soon screen after a correct code.
  // ───────────────────────────────────────────────────────────────────────
  function renderLandingPage() {
    return (
      <div style={{
        minHeight: "100vh",
        background: C.background,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "40px 20px",
        fontFamily: "'DM Sans','Segoe UI',system-ui,sans-serif",
        color: C.text,
      }}>
        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: 48 }}>
          <div style={{ marginBottom: 16, display: "flex", justifyContent: "center" }}>
            {tenantConfig?.company?.logo ? (
              <img
                src={tenantConfig.company.logo}
                alt={tenantConfig.company.name}
                style={{ height: 40, objectFit: "contain" }}
              />
            ) : (
              <div style={{
                width: 48, height: 48, borderRadius: 12, background: C.niumBlue,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 22, fontWeight: 800, color: "#fff",
              }}>
                N
              </div>
            )}
          </div>
          <h1 style={{ fontSize: 28, fontWeight: 800, color: C.text, margin: "0 0 8px 0", letterSpacing: "-0.5px" }}>
            {tenantConfig?.company?.name || "Nium"} Intelligence Platform
          </h1>
          <p style={{ fontSize: 16, color: C.textSec, margin: 0, maxWidth: 480, lineHeight: 1.5 }}>
            Select the agent you would like to work with today.
          </p>
        </div>

        {/* Agent cards */}
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap", justifyContent: "center", maxWidth: 720, width: "100%" }}>
          {/* Onboarding Agent */}
          <div
            onClick={() => {
              trackEvent("agent_selected", {
                agentType: "onboarding",
                selectedAt: new Date().toISOString(),
              });
              setAgentType("onboarding");
            }}
            style={{
              flex: "1 1 280px", maxWidth: 320, padding: "32px 28px",
              background: C.surface, border: `2px solid ${C.border}`, borderRadius: 16,
              cursor: "pointer", transition: "all 0.15s", textAlign: "left",
            }}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = C.niumBlue;
              e.currentTarget.style.transform = "translateY(-2px)";
              e.currentTarget.style.boxShadow = "0 8px 24px rgba(0,0,0,0.08)";
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = C.border;
              e.currentTarget.style.transform = "translateY(0)";
              e.currentTarget.style.boxShadow = "none";
            }}
          >
            <div style={{ fontSize: 36, marginBottom: 16 }}>✅</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.text, marginBottom: 8 }}>
              Onboarding Agent
            </div>
            <div style={{ fontSize: 14, color: C.textSec, lineHeight: 1.6, marginBottom: 20 }}>
              AI-powered KYC/KYB onboarding. Research, confirm, fill gaps and submit a complete application.
            </div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, color: C.niumBlue }}>
              Start onboarding →
            </div>
          </div>

          {/* Pre-boarding Agent */}
          <div
            onClick={() => {
              trackEvent("agent_selected", {
                agentType: "preboarding",
                selectedAt: new Date().toISOString(),
                note: "password gate shown",
              });
              setAgentType("preboarding");
            }}
            style={{
              flex: "1 1 280px", maxWidth: 320, padding: "32px 28px",
              background: C.surface, border: `2px solid ${C.border}`, borderRadius: 16,
              cursor: "pointer", transition: "all 0.15s", textAlign: "left", position: "relative",
            }}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = "#7C3AED";
              e.currentTarget.style.transform = "translateY(-2px)";
              e.currentTarget.style.boxShadow = "0 8px 24px rgba(0,0,0,0.08)";
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = C.border;
              e.currentTarget.style.transform = "translateY(0)";
              e.currentTarget.style.boxShadow = "none";
            }}
          >
            <div style={{
              position: "absolute", top: 16, right: 16, fontSize: 10, fontWeight: 700,
              color: "#7C3AED", background: "#F3F0FF", border: "1px solid #DDD6FE",
              borderRadius: 99, padding: "3px 8px", textTransform: "uppercase", letterSpacing: "0.5px",
            }}>
              Coming Soon
            </div>
            <div style={{ fontSize: 36, marginBottom: 16 }}>🔍</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.text, marginBottom: 8 }}>
              Pre-boarding Agent
            </div>
            <div style={{ fontSize: 14, color: C.textSec, lineHeight: 1.6, marginBottom: 20 }}>
              Intelligence-led due diligence before customer contact. Build a complete entity dossier and generate a targeted customer request.
            </div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, color: "#7C3AED" }}>
              Access pre-boarding →
            </div>
          </div>
        </div>

        {/* Footer note */}
        <p style={{ marginTop: 40, fontSize: 12, color: C.textMuted, textAlign: "center" }}>
          Powered by Nium Intelligence Platform
        </p>
      </div>
    );
  }

  function renderPreboardingGate() {
    const handlePasswordSubmit = () => {
      if (preboardingPassword === PREBOARDING_PASSWORD) {
        trackEvent("preboarding_password_correct", {
          unlockedAt: new Date().toISOString(),
        });
        setPreboardingUnlocked(true);
        setPreboardingPasswordError(false);
      } else {
        trackEvent("preboarding_password_failed", {
          attemptedAt: new Date().toISOString(),
          // Never log the actual password attempt.
        });
        setPreboardingPasswordError(true);
        setPreboardingPassword("");
      }
    };

    return (
      <div style={{
        minHeight: "100vh",
        background: C.background,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "40px 20px",
        fontFamily: "'DM Sans','Segoe UI',system-ui,sans-serif",
        color: C.text,
      }}>
        <div style={{
          width: "100%", maxWidth: 400, background: C.surface, borderRadius: 16,
          padding: "40px 36px", border: `1px solid ${C.border}`,
          boxShadow: "0 8px 32px rgba(0,0,0,0.06)", textAlign: "center",
        }}>
          <div style={{ fontSize: 40, marginBottom: 20 }}>🔒</div>
          <h2 style={{ fontSize: 22, fontWeight: 800, color: C.text, margin: "0 0 8px 0" }}>
            Pre-boarding Agent
          </h2>
          <p style={{ fontSize: 14, color: C.textSec, marginBottom: 28, lineHeight: 1.5 }}>
            This feature is currently under development and restricted to authorised access only.
          </p>

          <div style={{ marginBottom: 16 }}>
            <input
              type="password"
              value={preboardingPassword}
              onChange={e => {
                setPreboardingPassword(e.target.value);
                setPreboardingPasswordError(false);
              }}
              onKeyDown={e => { if (e.key === "Enter") handlePasswordSubmit(); }}
              placeholder="Enter access code"
              autoFocus
              style={{
                width: "100%", padding: "12px 16px", fontSize: 15,
                border: `1.5px solid ${preboardingPasswordError ? C.error : C.border}`,
                borderRadius: 8, outline: "none", fontFamily: "inherit",
                background: C.surface, color: C.text, boxSizing: "border-box",
                textAlign: "center", letterSpacing: "0.2em",
              }}
            />
            {preboardingPasswordError && (
              <p style={{ fontSize: 12, color: C.error, marginTop: 6, textAlign: "center" }}>
                Incorrect access code. Please try again.
              </p>
            )}
          </div>

          <button
            onClick={handlePasswordSubmit}
            style={{
              width: "100%", padding: "12px 0", background: "#7C3AED", color: "#fff",
              border: "none", borderRadius: 8, fontSize: 15, fontWeight: 700,
              fontFamily: "inherit", cursor: "pointer", marginBottom: 16,
            }}
          >
            Access Pre-boarding Agent
          </button>

          <button
            onClick={() => {
              trackEvent("returned_to_landing", {
                fromAgent: agentType,
                returnedAt: new Date().toISOString(),
              });
              setAgentType(null);
              setPreboardingPassword("");
              setPreboardingPasswordError(false);
            }}
            style={{
              background: "none", border: "none", fontSize: 13,
              color: C.textMuted, cursor: "pointer", fontFamily: "inherit",
            }}
          >
            ← Back to agent selection
          </button>
        </div>
      </div>
    );
  }

  function renderPreboardingComingSoon() {
    return (
      <div style={{
        minHeight: "100vh",
        background: C.background,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "40px 20px",
        fontFamily: "'DM Sans','Segoe UI',system-ui,sans-serif",
        color: C.text,
      }}>
        <div style={{ width: "100%", maxWidth: 560, textAlign: "center" }}>
          <div style={{ fontSize: 48, marginBottom: 24 }}>🔍</div>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: C.text, margin: "0 0 12px 0" }}>
            Pre-boarding Agent
          </h1>
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700,
            color: "#7C3AED", background: "#F3F0FF", border: "1px solid #DDD6FE", borderRadius: 99,
            padding: "4px 12px", marginBottom: 20, textTransform: "uppercase", letterSpacing: "0.5px",
          }}>
            Under Development
          </div>
          <p style={{ fontSize: 15, color: C.textSec, lineHeight: 1.7, maxWidth: 460, margin: "0 auto 32px" }}>
            The pre-boarding agent will enable intelligence-led due diligence before customer contact — building a complete entity dossier, identifying gaps, and generating a targeted customer request automatically.
          </p>

          <div style={{
            background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12,
            padding: "24px 28px", textAlign: "left", marginBottom: 32,
          }}>
            <div style={{
              fontSize: 13, fontWeight: 700, color: C.textMuted,
              textTransform: "uppercase", letterSpacing: "0.8px", marginBottom: 16,
            }}>
              Coming in this agent
            </div>
            {[
              "Entity dossier generation from public and API sources",
              "Verification-aware field classification",
              "Gap analysis with targeted customer request generation",
              "Custom question and document request builder",
              "AI-reviewed dossier with analyst oversight option",
              "Dossier saved to database for downstream onboarding handoff",
            ].map((item, i) => (
              <div key={i} style={{
                display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 10,
                fontSize: 14, color: C.textSec, lineHeight: 1.4,
              }}>
                <span style={{ color: "#7C3AED", fontWeight: 700, flexShrink: 0, marginTop: 1 }}>○</span>
                {item}
              </div>
            ))}
          </div>

          <button
            onClick={() => {
              trackEvent("returned_to_landing", {
                fromAgent: agentType,
                returnedAt: new Date().toISOString(),
              });
              setAgentType(null);
              setPreboardingUnlocked(false);
              setPreboardingPassword("");
            }}
            style={{
              padding: "12px 28px", background: "transparent", color: C.niumBlue,
              border: `1.5px solid ${C.niumBlue}`, borderRadius: 8, fontSize: 14,
              fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
            }}
          >
            ← Back to agent selection
          </button>
        </div>
      </div>
    );
  }

  // Agent routing — order matters. The existing onboarding flow (the main
  // return below) is reached only when agentType === "onboarding".
  if (agentType === null) {
    return renderLandingPage();
  }
  if (agentType === "preboarding" && !preboardingUnlocked) {
    return renderPreboardingGate();
  }
  if (agentType === "preboarding" && preboardingUnlocked) {
    return renderPreboardingComingSoon();
  }

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(170deg, #f4f8f7 0%, #eaeff4 50%, #f7f4f0 100%)", fontFamily: "'DM Sans','Segoe UI',system-ui,sans-serif", color: "#1a3a4a" }}>
      {inPreview && (
        <PreviewBanner
          missing={previewMissing}
          timestamp={previewTimestamp}
        />
      )}
      {demoMode && <DemoBanner offsetTop={inPreview ? 40 : 0} />}
      <div style={{ maxWidth: 780, margin: "0 auto", padding: `${(inPreview ? 40 : 0) + (demoMode ? 32 : 0) + 24}px 16px 60px` }}>

        <div style={{ textAlign: "center", marginBottom: 8 }}>
          {companyLogo_ ? (
            <img
              src={companyLogo_}
              alt={companyName_ || ""}
              style={{ height: 32, maxWidth: 140, objectFit: "contain", display: "block", margin: "0 auto 6px" }}
            />
          ) : (
            <div style={{
              width: 36, height: 36, borderRadius: 9, margin: "0 auto 6px",
              background: "linear-gradient(135deg,#1a3a4a,#4a9e8e)",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "#fff", fontSize: 18, fontWeight: 800,
            }}>
              {(companyName_ || "N").trim().charAt(0).toUpperCase()}
            </div>
          )}
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase", color: "#4a9e8e", marginBottom: 4 }}>{companyName_} Compliance</div>
          <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>KYC Onboarding Agent</h1>
          <p style={{ fontSize: 12, color: "#1a3a4a80", margin: "4px 0 0" }}>AI-powered multi-jurisdiction company research and data collection</p>
        </div>

        <div style={{ display: "flex", justifyContent: "center", gap: 6, marginBottom: 24, flexWrap: "wrap" }}>
          {stepNames.map((s, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 28, height: 28, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, background: i < step ? "#4a9e8e" : i === step ? "#1a3a4a" : "#e0e4e8", color: i <= step ? "#fff" : "#999", boxShadow: i === step ? "0 0 0 3px rgba(74,158,142,0.2)" : "none" }}>{i + 1}</div>
              <span style={{ fontSize: 11, fontWeight: i === step ? 700 : 400, color: i <= step ? "#1a3a4a" : "#aaa" }}>{s}</span>
              {i < stepNames.length - 1 && <div style={{ width: 14, height: 2, background: i < step ? "#4a9e8e" : "#e0e4e8" }} />}
            </div>
          ))}
        </div>

        {step === STEPS.input && !journeyOpen && (
          <div style={card}>
            <h2 style={{ fontSize: 17, fontWeight: 700, margin: "0 0 4px" }}>Company Lookup</h2>
            <p style={{ fontSize: 13, color: "#1a3a4a70", margin: "0 0 20px" }}>Enter the company name and country. The agent will use <strong>jurisdiction-specific requirements</strong> (UK or SG/default) to drive the research and gap collection.</p>
            <StableInput id="companyName" label="Company Legal Name" type="text" value={companyName} onUpdate={(_, v) => setCompanyName(v)} required placeholder="e.g. Tesco PLC, DBS Group Holdings" />
            <div style={{ marginBottom: 14 }}>
              <label htmlFor="entity-type" style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#1a3a4a", marginBottom: 5 }}>Entity Type <span style={{ color: "#d44" }}>*</span></label>
              <SearchableSelect
                id="entity-type"
                value={entityType}
                onChange={(v) => { setEntityType(v); setOwnershipType(""); }}
                placeholder="Select or type entity type…"
                options={activeEntityTypes.map(e => ({
                  value: e.id,
                  label: `${e.icon ? e.icon + " " : ""}${e.label || e.id}`,
                  description: e.description || undefined,
                }))}
              />
            </div>
            {/* Ownership Type is always visible; its options are populated from
                the selected entity type. Until an entity type is chosen it shows
                disabled with a guiding placeholder. */}
            <div style={{ marginBottom: 14 }}>
              <label htmlFor="ownership-type" style={{ display: "block", fontSize: 12, fontWeight: 600, color: C.text, marginBottom: 5 }}>
                Ownership Type <span style={{ color: C.error }}>*</span>
              </label>
              <p style={{ fontSize: 12, color: C.textMuted, marginBottom: 8, lineHeight: 1.4 }}>
                How is this company owned and structured?
              </p>
              <SearchableSelect
                id="ownership-type"
                value={ownershipType}
                onChange={setOwnershipType}
                disabled={!entityType}
                placeholder={entityType ? "Select ownership type…" : "Select an entity type first…"}
                options={entityType ? getOwnershipTypeOptions(entityType, tenantConfig) : []}
              />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label htmlFor="country-reg" style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#1a3a4a", marginBottom: 5 }}>Registered Country <span style={{ color: "#d44" }}>*</span></label>
              <SearchableSelect
                id="country-reg"
                value={countryCode}
                onChange={setCountryCode}
                placeholder="Select or type country…"
                options={COUNTRIES.map(c => ({ value: c.code, label: `${c.code} — ${c.name}` }))}
              />
            </div>
            {countryCode && (() => {
              // Resolve the licence from the tenant's configured licences,
              // not the hardcoded UK/SG fallback. If tenantConfig is missing
              // (offline fallback) fall back to the old hardcoded helper.
              const resolved = tenantConfig ? pickLicence(countryCode, tenantConfig) : null;
              const primary = tenantConfig ? (tenantConfig.licences || []).find(l => l.isPrimary) || (tenantConfig.licences || [])[0] : null;
              const isLicensedHere = !!resolved && Array.isArray(resolved.countriesCovered) && resolved.countriesCovered.includes(countryCode);
              const licenceLabel = resolved
                ? `${resolved.jurisdictionCode === "GB" ? "🇬🇧 " : resolved.jurisdictionCode === "SG" ? "🇸🇬 " : ""}${resolved.jurisdictionName || resolved.id}${resolved.regulatoryAuthority ? ` (${resolved.regulatoryAuthority})` : ""}${!isLicensedHere ? " — default for non-licensed markets" : ""}`
                : (getApplicableLicence(countryCode) === "GB" ? "🇬🇧 United Kingdom (FCA)" : "🇸🇬 Singapore (MAS) — default for non-licensed markets");
              const isFiFlow = entityType === "FI" || entityType === "Platform";
              const routesNote = entityType === "Platform" || entityType === "Direct"
                ? ` (${entityType} routes to ${isFiFlow ? "FI" : "Corporate"} schema)`
                : "";
              const primaryName = primary?.jurisdictionName || "the default licence";
              return (
                <div style={{ padding: "10px 14px", borderRadius: 8, background: isLicensedHere ? "#f0f3f8" : "#fff8ed", fontSize: 12, marginBottom: 14, borderLeft: isLicensedHere ? "3px solid #1a3a4a" : "3px solid #e0a040" }}>
                  <div style={{ marginBottom: 4 }}><strong>🌍 Researching in:</strong> {countryObj?.name} ({countryCode})</div>
                  <div><strong>📋 Applicable licence:</strong> {licenceLabel}</div>
                  {entityType && (
                    <div style={{ marginTop: 4 }}><strong>📑 Form set:</strong> {isFiFlow ? "FI version" : "Corporate version"}{routesNote}</div>
                  )}
                  {!isLicensedHere && <div style={{ marginTop: 4, fontStyle: "italic", color: "#9d6500" }}>{companyName_} has no licence in {countryObj?.name}, so this customer is onboarded under {primaryName}. Public records will be searched in {countryObj?.name}, but {primaryName} requirements apply.</div>}
                </div>
              );
            })()}
            {error && <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#dc2626", marginBottom: 14 }}>{error}</div>}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
              {SHOW_TEST_TOOLS && <Btn onClick={doDummyResearch} variant="secondary">🧪 Dummy Research (skip API)</Btn>}
              <Btn
                disabled={!companyName.trim() || !countryCode || !entityType || !ownershipType}
                onClick={() => {
                  if (!companyName.trim()) { setError("Please enter a company name."); return; }
                  if (!entityType) { setError("Please select an entity type."); return; }
                  if (!ownershipType) { setError("Please select an ownership type."); return; }
                  if (!countryCode) { setError("Please select a country."); return; }
                  setError("");
                  setSelectedJourneyCard(null);
                  setManualOpened(false);
                  setJourneyOpen(true);
                }} variant="primary">Continue →</Btn>
            </div>
          </div>
        )}

        {step === STEPS.input && journeyOpen && (
          <div style={card}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
              <div>
                <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 4px" }}>How would you like to complete your application?</h2>
                <p style={{ fontSize: 13, color: "#1a3a4a80", margin: "0 0 18px" }}>Choose the option that works best for you. You can always go back and change this.</p>
              </div>
              {SHOW_TEST_TOOLS && (demoToggleVisible || TEST_FLAG) && (
                <div style={{ flexShrink: 0 }}>
                  <DemoToggle on={demoMode} onChange={setDemoMode} />
                </div>
              )}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, marginBottom: 14 }}>
              {/* Card A */}
              {(() => {
                const sel = selectedJourneyCard === "A";
                return (
                  <div
                    onClick={() => { setSelectedJourneyCard("A"); setError(""); }}
                    style={{
                      position: "relative", padding: "18px 16px", borderRadius: 12, cursor: "pointer",
                      background: sel ? "#f0f9f6" : "#fafcfb",
                      border: `2px solid ${sel ? "#1a3a4a" : "rgba(26,58,74,0.18)"}`,
                      boxShadow: sel ? "0 6px 18px rgba(26,58,74,0.12)" : "none",
                    }}
                  >
                    <span style={{ position: "absolute", top: 10, right: 10, background: "#4a9e8e", color: "#fff", fontSize: 9, fontWeight: 800, letterSpacing: "0.06em", padding: "3px 8px", borderRadius: 999, textTransform: "uppercase" }}>Recommended</span>
                    <div style={{ fontSize: 24, marginBottom: 6 }}>🔍📄</div>
                    <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Upload documents &amp; let AI fill the rest</div>
                    <div style={{ fontSize: 12, color: "#1a3a4a80", lineHeight: 1.5, marginBottom: 8 }}>Upload any documents you have — we extract data from them instantly. For anything we can't find in your documents, our AI searches public registries and web sources.</div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "#4a9e8e" }}>Fastest · Most accurate · Lowest effort</div>
                  </div>
                );
              })()}

              {/* Card B */}
              {(() => {
                const sel = selectedJourneyCard === "B";
                return (
                  <div
                    onClick={() => { setSelectedJourneyCard("B"); setError(""); }}
                    style={{
                      padding: "18px 16px", borderRadius: 12, cursor: "pointer",
                      background: sel ? "#f0f3f8" : "#fafcfb",
                      border: `2px solid ${sel ? "#1a3a4a" : "rgba(26,58,74,0.12)"}`,
                    }}
                  >
                    <div style={{ fontSize: 24, marginBottom: 6 }}>🔍</div>
                    <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Let AI research your company</div>
                    <div style={{ fontSize: 12, color: "#1a3a4a80", lineHeight: 1.5, marginBottom: 8 }}>No documents needed. Our AI searches Companies House, regulatory registers, annual reports and other public sources to pre-fill your application.</div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "#4a9e8e" }}>~30 seconds · No uploads needed</div>
                  </div>
                );
              })()}

              {/* Card C */}
              {(() => {
                const sel = selectedJourneyCard === "C";
                return (
                  <div
                    onClick={() => { setSelectedJourneyCard("C"); setError(""); }}
                    style={{
                      padding: "18px 16px", borderRadius: 12, cursor: "pointer",
                      background: sel ? "#f5f5f5" : "#f8f8f8",
                      border: `2px solid ${sel ? "#1a3a4a" : "rgba(26,58,74,0.1)"}`,
                      opacity: 0.92,
                    }}
                  >
                    <div style={{ fontSize: 24, marginBottom: 6 }}>✏️</div>
                    <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>I'll complete the form myself</div>
                    <div style={{ fontSize: 12, color: "#1a3a4a80", lineHeight: 1.5, marginBottom: 8 }}>Skip the AI research and fill everything manually using your own records. You'll be redirected to our standard application form.</div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "#1a3a4a90" }}>Full control · No AI · ~15 minutes</div>
                  </div>
                );
              })()}
            </div>

            {manualOpened && (
              <div style={{ marginTop: 4, marginBottom: 12, padding: "10px 14px", background: "#f0f3f8", borderRadius: 8, fontSize: 12, color: "#1a3a4a", borderLeft: "3px solid #1a3a4a" }}>
                Opening the manual form in a new tab… You can also continue with AI assistance above.
              </div>
            )}

            {demoMode && (
              <div style={{ marginBottom: 12, padding: "10px 14px", background: "#FEF3C7", borderRadius: 8, fontSize: 12, color: "#92400E", borderLeft: "3px solid #FCD34D" }}>
                Demo mode active — using sample data. Document extraction and web research are simulated.
              </div>
            )}

            {error && <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#dc2626", marginBottom: 14 }}>{error}</div>}

            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <Btn variant="secondary" onClick={() => { setJourneyOpen(false); setManualOpened(false); setError(""); }}>← Back</Btn>
              <Btn variant="primary" onClick={proceedFromJourney}>Continue →</Btn>
            </div>
          </div>
        )}

        {isAiDocs && step === STEPS.documents && (() => {
          const docs = docTypesForEntity(entityType, tenantConfig);
          const uploadedCount = docs.reduce((n, d) => n + (uploadedDocs[d.key] ? 1 : 0), 0);
          // Section A (Document Intelligence) — auto-sourced documents from
          // the doc search agent. Only usable docs render as cards.
          const foundDocs = (docSearchResults?.documents || [])
            .filter(d => d.status === "downloaded" || d.status === "url_found");
          const sectionAVisible = docSearchLoading || !!docSearchError ||
            (docSearchResults !== null && docSearchResults.documents.length > 0);

          // ── Section B: flag (but do not hide) documents already auto-sourced
          // in Section A. Only count docs the agent actually has (downloaded or
          // url_found); a failed search still asks the customer to provide it.
          const autoSourcedDocTypes = new Set(
            (docSearchResults?.documents || [])
              .filter(d => d.status === "downloaded" || d.status === "url_found")
              .map(d => d.type)
          );
          // Map doc-search agent type IDs → the DOC_TYPES `key` values used by
          // Section B (Wolfsberg = "wolfsberg", Annual Report = "annualReport"),
          // plus a range of aliases so the match is robust to either source.
          const docTypeMapping = {
            wolfsberg_questionnaire: [
              "doc_wolfsberg", "wolfsberg", "wolfsberg_questionnaire", "cbddq", "fccq",
            ],
            annual_report: [
              "doc_annual", "annual_report", "annual_report_accounts",
              "audited_financial_statements", "audited_accounts", "annualReport",
            ],
          };
          function isAutoSourced(docId, docType) {
            for (const [agentType, mappedIds] of Object.entries(docTypeMapping)) {
              if (autoSourcedDocTypes.has(agentType)) {
                if (mappedIds.includes(docId) || mappedIds.includes(docType)) {
                  return true;
                }
              }
            }
            return false;
          }

          return (
            <div>
              <div style={card}>
                <style>{`@keyframes kspin { to { transform: rotate(360deg); } }`}</style>

                {/* Testing-mode toggle — demo data vs real agent call */}
                {(demoMode || SHOW_TEST_TOOLS) && (
                  <div style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    marginBottom: 16,
                    padding: "8px 12px",
                    background: C.surfaceAlt,
                    borderRadius: 8,
                    border: `1px dashed ${C.border}`,
                  }}>
                    <span style={{ fontSize: 12, color: C.textMuted }}>
                      🧪 Testing mode:
                    </span>
                    <button
                      onClick={() => {
                        setDocSearchResults(
                          buildDemoDocSearchResults(companyName, ownershipType, entityType)
                        );
                        setDocSearchError(null);
                        setDocSearchLoading(false);
                      }}
                      style={{
                        fontSize: 11,
                        padding: "3px 10px",
                        background: "transparent",
                        border: `1px solid ${C.border}`,
                        borderRadius: 6,
                        cursor: "pointer",
                        fontFamily: "inherit",
                        color: C.text,
                      }}
                    >
                      Use demo data
                    </button>
                    <button
                      onClick={runRealDocSearch}
                      style={{
                        fontSize: 11,
                        padding: "3px 10px",
                        background: C.niumBlue,
                        border: "none",
                        borderRadius: 6,
                        cursor: "pointer",
                        fontFamily: "inherit",
                        color: "#fff",
                        fontWeight: 600,
                      }}
                    >
                      Run real agent
                    </button>
                  </div>
                )}

                {/* Section A loading state */}
                {docSearchLoading && (
                  <div style={{
                    padding: "20px 16px",
                    background: C.infoBg,
                    border: `1px solid ${C.infoBorder}`,
                    borderRadius: 10,
                    marginBottom: 20,
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                  }}>
                    <div style={{
                      width: 18, height: 18,
                      border: `2px solid ${C.info}`,
                      borderTopColor: "transparent",
                      borderRadius: "50%",
                      animation: "kspin 0.8s linear infinite",
                      flexShrink: 0,
                    }}/>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: C.info }}>
                        Searching for compliance documents...
                      </div>
                      <div style={{ fontSize: 12, color: C.info, opacity: 0.8, marginTop: 2 }}>
                        Looking for Wolfsberg questionnaire and annual reports for {companyName}
                      </div>
                    </div>
                  </div>
                )}

                {/* Section A error — subtle, never blocks progress */}
                {!docSearchLoading && docSearchError && (
                  <div style={{
                    padding: "12px 16px",
                    background: C.warningBg,
                    border: `1px solid ${C.warningBorder}`,
                    borderRadius: 10,
                    marginBottom: 20,
                    fontSize: 13,
                    color: C.warning,
                  }}>
                    ⚠ Could not automatically source documents for {companyName}. Please upload documents below.
                  </div>
                )}

                {/* Section A — documents we found */}
                {!docSearchLoading && docSearchResults !== null && docSearchResults.documents.length > 0 && (
                  <div style={{ marginBottom: 24 }}>

                    {/* Section header */}
                    <div style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: C.textMuted,
                      textTransform: "uppercase",
                      letterSpacing: "0.8px",
                      marginBottom: 12,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}>
                      <span>📄 Documents sourced automatically</span>
                      {docSearchResults.isDemo && (
                        <span style={{
                          fontSize: 10,
                          fontWeight: 600,
                          color: C.textMuted,
                          background: C.surfaceAlt,
                          border: `1px solid ${C.border}`,
                          borderRadius: 99,
                          padding: "2px 8px",
                        }}>
                          DEMO DATA
                        </span>
                      )}
                    </div>

                    {/* Intro text */}
                    <p style={{
                      fontSize: 13,
                      color: C.textMuted,
                      marginBottom: 12,
                      lineHeight: 1.5,
                    }}>
                      We found {foundDocs.length}{" "}document
                      {foundDocs.length !== 1 ? "s" : ""} for{" "}
                      <strong>{companyName}</strong> from public sources. Accept
                      any you would like to use — we will extract compliance
                      fields from them automatically.
                    </p>

                    {/* Document cards */}
                    {foundDocs.map(doc => {
                      const isAccepted = acceptedDocTypes.has(doc.type);
                      return (
                        <div
                          key={doc.type}
                          style={{
                            display: "flex",
                            alignItems: "flex-start",
                            gap: 12,
                            padding: "14px 16px",
                            background: isAccepted ? C.successBg : "#fff",
                            border: `1.5px solid ${isAccepted ? C.successBorder : C.border}`,
                            borderRadius: 10,
                            marginBottom: 8,
                            transition: "all 0.15s",
                          }}
                        >
                          {/* Doc icon */}
                          <span style={{ fontSize: 24, flexShrink: 0, marginTop: 2 }}>
                            {doc.type === "wolfsberg_questionnaire" ? "📋" : "📊"}
                          </span>

                          {/* Doc details */}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{
                              fontSize: 15,
                              fontWeight: 600,
                              color: C.text,
                              marginBottom: 4,
                            }}>
                              {doc.label}
                              <span style={{
                                fontSize: 12,
                                fontWeight: 400,
                                color: C.textMuted,
                                marginLeft: 8,
                              }}>
                                {doc.year}
                              </span>
                            </div>

                            <div style={{
                              fontSize: 12,
                              color: C.textMuted,
                              marginBottom: 6,
                            }}>
                              {doc.sourceLabel}
                            </div>

                            {/* Confidence + source badges */}
                            <div style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 6,
                              flexWrap: "wrap",
                            }}>
                              <span style={{
                                fontSize: 11,
                                fontWeight: 600,
                                padding: "2px 8px",
                                borderRadius: 99,
                                background: doc.confidence === "high" ? C.successBg : C.warningBg,
                                color: doc.confidence === "high" ? C.success : C.warning,
                                border: `1px solid ${doc.confidence === "high" ? C.successBorder : C.warningBorder}`,
                              }}>
                                {doc.confidence === "high" ? "✓ High confidence" : "~ Medium confidence"}
                              </span>

                              {doc.status === "downloaded" && (
                                <span style={{
                                  fontSize: 11,
                                  color: C.success,
                                  fontWeight: 600,
                                }}>
                                  ✅ Downloaded
                                </span>
                              )}

                              {doc.status === "url_found" && (
                                <span style={{
                                  fontSize: 11,
                                  color: C.warning,
                                  fontWeight: 600,
                                }}>
                                  🔗 URL found
                                </span>
                              )}
                            </div>

                            {/* View document link */}
                            {doc.sourceUrl ? (
                              <a
                                href={doc.sourceUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 4,
                                  fontSize: 12,
                                  color: C.niumBlue,
                                  fontWeight: 600,
                                  textDecoration: "none",
                                  marginTop: 6,
                                  padding: "4px 0",
                                }}
                                onMouseEnter={e => {
                                  e.currentTarget.style.textDecoration = "underline";
                                }}
                                onMouseLeave={e => {
                                  e.currentTarget.style.textDecoration = "none";
                                }}
                              >
                                <span style={{ fontSize: 14 }}>📄</span>
                                View document →
                              </a>
                            ) : (
                              <span style={{
                                display: "block",
                                fontSize: 11,
                                color: C.textMuted,
                                fontStyle: "italic",
                                marginTop: 6,
                              }}>
                                Direct link not available
                              </span>
                            )}
                          </div>

                          {/* Accept / Remove button */}
                          <div style={{ flexShrink: 0 }}>
                            {isAccepted ? (
                              <button
                                onClick={() => {
                                  setAcceptedDocTypes(prev => {
                                    const next = new Set(prev);
                                    next.delete(doc.type);
                                    return next;
                                  });
                                }}
                                style={{
                                  padding: "7px 14px",
                                  background: C.success,
                                  color: "#fff",
                                  border: "none",
                                  borderRadius: 8,
                                  fontSize: 12,
                                  fontWeight: 600,
                                  fontFamily: "inherit",
                                  cursor: "pointer",
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 4,
                                }}
                              >
                                ✓ Using this
                              </button>
                            ) : (
                              <button
                                onClick={() => {
                                  setAcceptedDocTypes(prev =>
                                    new Set([...prev, doc.type])
                                  );
                                }}
                                style={{
                                  padding: "7px 14px",
                                  background: "transparent",
                                  color: C.niumBlue,
                                  border: `1.5px solid ${C.niumBlue}`,
                                  borderRadius: 8,
                                  fontSize: 12,
                                  fontWeight: 600,
                                  fontFamily: "inherit",
                                  cursor: "pointer",
                                }}
                              >
                                Use this document
                              </button>
                            )}
                            <p style={{
                              fontSize: 11,
                              color: C.textMuted,
                              marginTop: 4,
                              textAlign: "center",
                              fontStyle: "italic",
                              whiteSpace: "pre-line",
                            }}>
                              {isAccepted
                                ? "Fields will be extracted automatically"
                                : "We will extract compliance fields\nfrom this document"
                              }
                            </p>
                          </div>
                        </div>
                      );
                    })}

                    {/* Summary table — collapsible */}
                    <details style={{ marginTop: 12 }}>
                      <summary style={{
                        fontSize: 12,
                        color: C.textMuted,
                        cursor: "pointer",
                        userSelect: "none",
                        listStyle: "none",
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                      }}>
                        <span>▾</span>
                        <span>View search details</span>
                      </summary>

                      <div style={{ marginTop: 10, overflowX: "auto" }}>
                        <table style={{
                          width: "100%",
                          borderCollapse: "collapse",
                          fontSize: 11,
                        }}>
                          <thead>
                            <tr>
                              {Object.keys(docSearchResults.summaryTable[0] || {}).map(col => (
                                <th key={col} style={{
                                  padding: "6px 10px",
                                  background: C.surfaceAlt,
                                  border: `1px solid ${C.border}`,
                                  textAlign: "left",
                                  fontWeight: 700,
                                  color: C.textMuted,
                                  whiteSpace: "nowrap",
                                }}>
                                  {col}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {docSearchResults.summaryTable.map((row, i) => (
                              <tr key={i}>
                                {/* entries (not values) so the Notes column can be
                                    detected and allowed to wrap to its full text */}
                                {Object.entries(row).map(([col, val], j) => (
                                  <td key={j} style={{
                                    padding: "6px 10px",
                                    border: `1px solid ${C.border}`,
                                    color: C.text,
                                    maxWidth: col === "Notes" ? 300 : 200,
                                    whiteSpace: col === "Notes" ? "normal" : "nowrap",
                                    overflow: col === "Notes" ? "visible" : "hidden",
                                    textOverflow: col === "Notes" ? "unset" : "ellipsis",
                                    wordBreak: col === "Notes" ? "break-word" : "normal",
                                    fontSize: 11,
                                    verticalAlign: "top",
                                  }}>
                                    {String(val)}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </details>
                  </div>
                )}

                {/* Section divider between A (found) and B (uploads) */}
                {sectionAVisible && (
                  <div style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: C.textMuted,
                    textTransform: "uppercase",
                    letterSpacing: "0.8px",
                    marginBottom: 12,
                    marginTop: 4,
                    paddingTop: 20,
                    borderTop: `1px solid ${C.border}`,
                  }}>
                    📤 Documents we need from you
                  </div>
                )}

                <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 6px" }}>Upload your documents</h2>
                <p style={{ fontSize: 13, color: "#1a3a4a90", margin: "0 0 18px", lineHeight: 1.5 }}>
                  All documents are optional. Upload as many or as few as you have available. The more you provide, the less you'll need to fill in manually.
                </p>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14 }}>
                  {docs.map(d => {
                    const file = uploadedDocs[d.key];
                    const inputId = `upload-${d.key}`;
                    return (
                      <div key={d.key} style={{
                        padding: "14px 14px", borderRadius: 12,
                        background: file ? "#f0f9f6" : "#fafcfb",
                        border: file ? "2px solid #4a9e8e" : "2px dashed rgba(26,58,74,0.18)",
                      }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                          <div style={{ fontSize: 20 }}>{d.icon}</div>
                          <div style={{ fontSize: 13, fontWeight: 700, flex: 1 }}>{d.label}</div>
                          {d.badge && (
                            <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.05em", padding: "3px 8px", borderRadius: 999, background: d.badge.color, color: "#fff", textTransform: "uppercase" }}>{d.badge.text}</span>
                          )}
                        </div>
                        <div style={{ fontSize: 11, color: "#1a3a4a80", lineHeight: 1.5, marginBottom: 10 }}>{d.helper}</div>
                        {isAutoSourced(d.key, d.key) && (
                          <div style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            marginBottom: 6,
                            padding: "6px 10px",
                            background: C.successBg,
                            border: `1px solid ${C.successBorder}`,
                            borderRadius: 6,
                            fontSize: 12,
                            color: C.success,
                          }}>
                            <span>✓</span>
                            <span>
                              We sourced this automatically — upload here only if you prefer to provide your own version.
                            </span>
                          </div>
                        )}
                        {file ? (
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "8px 12px", background: "#fff", borderRadius: 8, border: "1px solid rgba(74,158,142,0.25)" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                              <span style={{ color: "#1a6b56", fontWeight: 700, fontSize: 14 }}>✓</span>
                              <div style={{ minWidth: 0 }}>
                                <div style={{ fontSize: 12, fontWeight: 600, color: "#1a3a4a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file.name}</div>
                                <div style={{ fontSize: 10, color: "#1a3a4a70" }}>{(file.size / 1024).toFixed(0)} KB</div>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={removeDocFile(d.key)}
                              title="Remove"
                              style={{ background: "transparent", border: "none", color: "#1a3a4a", fontSize: 18, cursor: "pointer", lineHeight: 1, padding: 4 }}
                            >×</button>
                          </div>
                        ) : (
                          <label htmlFor={inputId} style={{ display: "block", padding: "12px 10px", textAlign: "center", borderRadius: 8, background: "#fff", border: "1.5px dashed rgba(26,58,74,0.22)", cursor: "pointer", fontSize: 12, color: "#1a3a4a90" }}>
                            Click to upload or drag and drop
                            <div style={{ fontSize: 10, color: "#1a3a4a60", marginTop: 4 }}>{d.accepts}</div>
                          </label>
                        )}
                        <input
                          id={inputId}
                          type="file"
                          accept={d.accept}
                          onChange={handleDocFile(d.key)}
                          style={{ display: "none" }}
                        />
                      </div>
                    );
                  })}
                </div>

                {error && <div style={{ marginTop: 14, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#dc2626" }}>{error}</div>}

                <div style={{ marginTop: 14, padding: "10px 14px", borderRadius: 8, background: uploadedCount > 0 ? "#f0f9f6" : "#fafcfb", color: uploadedCount > 0 ? "#1a6b56" : "#1a3a4a70", fontSize: 12, fontWeight: 600 }}>
                  {uploadedCount > 0
                    ? `${uploadedCount} document${uploadedCount === 1 ? "" : "s"} ready to upload`
                    : "No documents selected — AI will use web search only"}
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <Btn variant="secondary" onClick={() => { setError(""); setJourneyOpen(true); scrollAndSetStep(STEPS.input); }}>← Back</Btn>
                <Btn variant="primary" onClick={proceedFromDocuments}>Continue →</Btn>
              </div>
            </div>
          );
        })()}

        {step === STEPS.research && (
          <div style={{ ...card, textAlign: "center", padding: "56px 28px" }}>
            <div style={{ position: "relative", width: 130, height: 130, margin: "0 auto 28px" }}>
              {[0, 1, 2].map(i => (
                <div key={i} style={{
                  position: "absolute", inset: 0, borderRadius: "50%",
                  border: "2px solid rgba(74,158,142,0.55)",
                  animation: `kpulse 2.4s ease-out ${i * 0.8}s infinite`,
                }} />
              ))}
              <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 56, animation: "kbob 2.6s ease-in-out infinite" }}>🔍</div>
            </div>

            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>
              Researching {companyName}... {jurisdictionBadge}{entityBadge}
            </div>
            {loaderPhase > 0 && (
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#0B3D91", marginBottom: 6 }}>
                {loaderPhase === 1 ? "Phase 1 of 2 — Documents" : "Phase 2 of 2 — Web research"}
              </div>
            )}
            <div style={{ fontSize: 13, color: "#4a9e8e", fontStyle: "italic", marginBottom: researchStatus ? 6 : 22, minHeight: 18 }}>
              {loaderMsgs[Math.min(loaderIdx, loaderMsgs.length - 1)]}
            </div>
            {researchStatus && (
              <div style={{ fontSize: 12, fontWeight: 600, color: "#0B3D91", marginBottom: 22 }}>
                🔎 {researchStatus}
              </div>
            )}

            <div style={{ width: "100%", maxWidth: 420, height: 6, background: "rgba(74,158,142,0.12)", borderRadius: 3, overflow: "hidden", margin: "0 auto 18px" }}>
              <div style={{
                width: `${((loaderIdx + 1) / loaderMsgs.length) * 100}%`,
                height: "100%",
                background: "linear-gradient(90deg,#4a9e8e,#1a3a4a)",
                transition: "width 0.6s ease",
              }} />
            </div>

            <div style={{ display: "flex", justifyContent: "center", gap: 7, flexWrap: "wrap" }}>
              {loaderMsgs.map((_, i) => (
                <div key={i} style={{
                  width: 9, height: 9, borderRadius: "50%",
                  background: i <= loaderIdx ? "#4a9e8e" : "rgba(26,58,74,0.15)",
                  transition: "background 0.3s",
                  boxShadow: i === loaderIdx ? "0 0 0 3px rgba(74,158,142,0.25)" : "none",
                }} />
              ))}
            </div>

            <style>{`
              @keyframes kpulse {
                0%   { transform: scale(0.55); opacity: 1;   border-color: rgba(74,158,142,0.7); }
                100% { transform: scale(1.45); opacity: 0;   border-color: rgba(74,158,142,0); }
              }
              @keyframes kbob {
                0%, 100% { transform: translateY(0); }
                50%      { transform: translateY(-6px); }
              }
            `}</style>
          </div>
        )}

        {step === STEPS.confirm && research && (
          <div>
            <div style={card}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: "linear-gradient(135deg,#4a9e8e,#3a8e7e)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>✅</div>
                <div>
                  <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>{research.companyName || companyName} {jurisdictionBadge}{entityBadge}</h2>
                  <p style={{ fontSize: 12, color: "#1a3a4a70", margin: 0 }}>
                    {sortedFound.length} fields pre-filled · {docCount} from documents · {tier1Count} from official sources · {tier2Count + tier3Count} need your attention
                  </p>
                </div>
              </div>
              <div style={{ background: "#f0f9f6", borderRadius: 8, padding: "12px 16px", fontSize: 13, color: "#1a6b56", borderLeft: "4px solid #4a9e8e" }}>
                Below: every field we pre-filled, sorted by source — documents first (most reliable), then official registries, then company-owned sources, then unverified web. Uncheck anything wrong — it'll move to the next page for correction. Click any source to reveal when it was fetched.
              </div>
            </div>

            {/* Part 11 — low-data banner. Threshold is calibrated per ownership
                type (private companies expect lower fill rates than listed). */}
            {(() => {
              if (!coverage) return null;
              const strat = getResearchStrategy(ownershipType);
              const showLowDataBanner = coverage.fillRate < strat.lowDataThreshold + 0.10;
              if (!showLowDataBanner) return null;
              const parentResult = (research.found || []).find(
                (r) => r.field === "ubo_parent_company" || r.field === "parent_company" || r.field === "group_structure"
              );
              const isPrivateish = ownershipType === "private_limited" || ownershipType === "branch";
              return (
                <div style={{ padding: 16, background: C.infoBg, border: `1px solid ${C.infoBorder}`, borderRadius: 10, marginBottom: 16 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: C.info, marginBottom: 6, display: "flex", alignItems: "center", gap: 8 }}>
                    <span>ℹ</span>
                    <span>Limited public information found for {research.companyName || companyName}</span>
                  </div>
                  <p style={{ fontSize: 13, color: C.info, marginBottom: 12, lineHeight: 1.5 }}>
                    {coverage.populatedFields} of {coverage.totalResearchFields} fields were found from public sources.
                    {isPrivateish
                      ? " Private companies have limited publicly available information — this is expected."
                      : " You can improve coverage by uploading documents."}
                  </p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {ownershipType === "branch" && (
                      <div style={{ padding: "10px 14px", background: "#fff", borderRadius: 8, border: `1px solid ${C.infoBorder}`, fontSize: 13, color: C.text }}>
                        <strong>Try searching for the parent company:</strong> If this is a branch, searching for the parent entity may return more complete information.
                        {parentResult && parentResult.value && (
                          <button
                            onClick={() => {
                              setCompanyName(String(parentResult.value));
                              setJourneyOpen(false);
                              setSelectedJourneyCard(null);
                              setError("");
                              setStep(STEPS.input);
                            }}
                            style={{ marginLeft: 8, padding: "4px 12px", background: C.info, color: "#fff", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
                          >
                            Search parent →
                          </button>
                        )}
                      </div>
                    )}
                    {journeyType === "ai_only" && (
                      <div style={{ padding: "10px 14px", background: "#fff", borderRadius: 8, border: `1px solid ${C.infoBorder}`, fontSize: 13, color: C.text, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                        <span>
                          <strong>Upload documents</strong> to pre-fill more fields — Certificate of Incorporation, Annual Report, or Wolfsberg questionnaire.
                        </span>
                        <button
                          onClick={() => { setJourneyType("ai_documents"); setJourneyOpen(false); setStep(stepsFor("ai_documents").documents); }}
                          style={{ padding: "6px 14px", background: C.niumBlue, color: "#fff", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap", flexShrink: 0 }}
                        >
                          📄 Upload docs
                        </button>
                      </div>
                    )}
                    <p style={{ fontSize: 12, color: C.textMuted, fontStyle: "italic", margin: 0 }}>
                      Or continue below — you can complete the remaining fields manually on the next page.
                    </p>
                  </div>
                </div>
              );
            })()}

            {/* Part 9 — coverage summary bar. */}
            {coverage && (
              <div style={{ display: "flex", alignItems: "center", gap: 0, marginBottom: 20, borderRadius: 10, border: `1px solid ${C.border}`, overflow: "hidden" }}>
                <div style={{ flex: 1, padding: "12px 16px", background: C.successBg, borderRight: `1px solid ${C.border}`, textAlign: "center" }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color: C.success, lineHeight: 1 }}>{coverage.verifiedFields}</div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: C.success, marginTop: 3, textTransform: "uppercase", letterSpacing: "0.5px" }}>Verified</div>
                </div>
                <div style={{ flex: 1, padding: "12px 16px", background: C.warningBg, borderRight: `1px solid ${C.border}`, textAlign: "center" }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color: C.warning, lineHeight: 1 }}>{coverage.probableFields}</div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: C.warning, marginTop: 3, textTransform: "uppercase", letterSpacing: "0.5px" }}>To Confirm</div>
                </div>
                {coverage.indicativeFields > 0 && (
                  <div style={{ flex: 1, padding: "12px 16px", background: "#FFF7ED", borderRight: `1px solid ${C.border}`, textAlign: "center" }}>
                    <div style={{ fontSize: 22, fontWeight: 800, color: "#C2410C", lineHeight: 1 }}>{coverage.indicativeFields}</div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "#C2410C", marginTop: 3, textTransform: "uppercase", letterSpacing: "0.5px" }}>Low Confidence</div>
                  </div>
                )}
                <div style={{ flex: 1, padding: "12px 16px", background: C.surfaceAlt, textAlign: "center" }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color: C.textMuted, lineHeight: 1 }}>{coverage.missingFieldCount}</div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: C.textMuted, marginTop: 3, textTransform: "uppercase", letterSpacing: "0.5px" }}>To Complete</div>
                </div>
              </div>
            )}

            {/* Manual "publicly listed company" toggle — hides stakeholder EDD
                forms on the next page. Test-mode only (gated by SHOW_TEST_TOOLS):
                hidden for real customers, shown in local dev / ?test=1. */}
            {SHOW_TEST_TOOLS && (
            <div
              onClick={() => setIsPubliclyListedOverride(v => !v)}
              style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "12px 16px",
                background: isPubliclyListedOverride ? "#f3faf8" : "#f2f1ed",
                border: `1.5px solid ${isPubliclyListedOverride ? "#4a9e8e" : "rgba(26,58,74,0.14)"}`,
                borderRadius: 10, marginBottom: 16,
                cursor: "pointer", transition: "all 0.15s", userSelect: "none",
              }}
            >
              <input
                type="checkbox"
                checked={isPubliclyListedOverride}
                onChange={() => setIsPubliclyListedOverride(v => !v)}
                onClick={(e) => e.stopPropagation()}
                style={{ width: 16, height: 16, accentColor: "#4a9e8e", cursor: "pointer", flexShrink: 0 }}
                aria-label="This is a publicly listed company"
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 14, fontWeight: 600,
                  color: isPubliclyListedOverride ? "#1a6b56" : "#1a3a4a",
                }}>
                  🏛 This is a publicly listed company
                </div>
                <div style={{
                  fontSize: 12, marginTop: 2,
                  color: isPubliclyListedOverride ? "#1a6b56" : "#1a3a4a70",
                }}>
                  {isPubliclyListedOverride
                    ? "✓ Stakeholder compliance details will not be collected on the next page"
                    : "Check this box to skip detailed stakeholder forms on the next page"}
                </div>
              </div>
              {isPubliclyListedOverride && (
                <span style={{
                  fontSize: 12, fontWeight: 700, color: "#1a6b56",
                  background: "#f3faf8", border: "1px solid #4a9e8e",
                  borderRadius: 99, padding: "3px 10px",
                  whiteSpace: "nowrap", flexShrink: 0,
                }}>
                  Listed ✓
                </span>
              )}
            </div>
            )}

            {stakeholderFound.length > 0 && (
              <div style={card}>
                <h3 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 4px" }}>People Found</h3>
                <p style={{ fontSize: 11, color: "#1a3a4a70", margin: "0 0 12px" }}>
                  Directors and beneficial owners we identified from official sources. Verify each name; you'll provide additional compliance details on the next page.
                </p>
                {stakeholderFound.map(({ item, idx }) => renderStakeholderConfirmSection(item, idx))}
              </div>
            )}

            {regularFound.length > 0 && renderUnifiedFoundTable(regularFound, "Pre-filled Fields", "Documents → Official sources → Unverified web. Tier-2 rows carry an inline warning.")}

            {(research.found || []).filter((_, i) => !checks[i]).length > 0 && (
              <div style={{ marginBottom: 16, padding: "10px 14px", background: "#fff8ed", borderRadius: 6, fontSize: 12, color: "#b07d10", borderLeft: "3px solid #e0a040" }}>
                ⚠️ {(research.found || []).filter((_, i) => !checks[i]).length} field(s) unchecked — will appear on next page for correction.
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <Btn variant="secondary" onClick={resetAll}>← Start Over</Btn>
              <Btn variant="green" onClick={() => { scrollAndSetStep(STEPS.fillGaps); setError(""); }}>Confirm and Continue →</Btn>
            </div>
          </div>
        )}

        {step === STEPS.fillGaps && research && activeSchema && (
          <div>
            <div style={card}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: "linear-gradient(135deg,#e0a040,#d09030)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>📝</div>
                <div>
                  <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>Additional Information Required {jurisdictionBadge}{entityBadge}</h2>
                  <p style={{ fontSize: 12, color: "#1a3a4a70", margin: 0 }}>{getCombinedGaps().filter(g => g.section !== "documents").length} fields need your input</p>
                </div>
                {SHOW_TEST_TOOLS && (
                  <button
                    type="button"
                    onClick={fillTestData}
                    title="Testing only — fills all visible fields with sample data"
                    style={{
                      marginLeft: "auto", flexShrink: 0,
                      padding: "8px 16px", borderRadius: 8, fontSize: 12, fontWeight: 600,
                      cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
                      background: "transparent", color: "#4a9e8e",
                      border: "2px dashed #4a9e8e",
                    }}
                  >
                    ✨ Fill with test data
                  </button>
                )}
              </div>
            </div>

            {stakeholderErrors.length > 0 && (
              <div style={{
                background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10,
                padding: "14px 16px", marginBottom: 16,
              }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#dc2626", marginBottom: 8 }}>
                  Please fix the following before continuing:
                </div>
                <ul style={{ margin: 0, paddingLeft: 20 }}>
                  {stakeholderErrors.map((msg, i) => (
                    <li key={i} style={{ fontSize: 12, color: "#dc2626", marginBottom: 3 }}>{msg}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* 1. Corrections required + 2. Missing gap fields — corrections
                come first inside gapSectionOrder(), then missing fields. */}
            {gapSectionOrder().map(s => renderGapSection(s))}

            {/* 3. Stakeholder forms — only people who need customer input
                (private directors/UBOs, or listed-company >= 25% UBOs). */}
            {hasStakeholderForms && (
              <div style={{
                fontSize: 11, fontWeight: 700, color: "#1a3a4a80",
                textTransform: "uppercase", letterSpacing: "0.08em",
                marginTop: 8, marginBottom: 12, paddingTop: 16,
                borderTop: "1px solid rgba(26,58,74,0.08)",
                display: "flex", alignItems: "center", gap: 8,
              }}>
                <span>👥</span>
                <span>People — additional details needed</span>
              </div>
            )}
            {stakeholderFormNodes}

            {/* 4. Verified stakeholder summary — read-only reference, last. */}
            {hasStakeholderSummary && (
              <div style={{
                fontSize: 11, fontWeight: 700, color: "#1a3a4a80",
                textTransform: "uppercase", letterSpacing: "0.08em",
                marginTop: 8, marginBottom: 12, paddingTop: 16,
                borderTop: "1px solid rgba(26,58,74,0.08)",
                display: "flex", alignItems: "center", gap: 8,
              }}>
                <span>✅</span>
                <span>Verified information — for reference</span>
              </div>
            )}
            {stakeholderSummaryNodes}

            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <Btn variant="secondary" onClick={() => scrollAndSetStep(STEPS.confirm)}>← Back to Review</Btn>
              <Btn variant="primary" onClick={() => {
                const stkErrors = validateStakeholders();
                if (stkErrors.length > 0) {
                  setStakeholderErrors(stkErrors);
                  setError("");
                  window.scrollTo({ top: 0, behavior: "smooth" });
                  return;
                }
                if (allGapsFilled()) {
                  setStakeholderErrors([]);
                  scrollAndSetStep(STEPS.documentRequirements);
                  setError("");
                } else {
                  setError("Please fill all required fields.");
                }
              }}>Continue to Documents →</Btn>
            </div>
            {error && step === STEPS.fillGaps && <div style={{ marginTop: 8, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#dc2626" }}>{error}</div>}
          </div>
        )}

        {/* DRS — dynamic document-requirements step (Step 2 of the CDD brief),
            placed after Fill Gaps so classifiers + research are settled. */}
        {step === STEPS.documentRequirements && (
          <div>
            <div style={card}>
              <h2 style={{ fontSize: 17, fontWeight: 700, margin: "0 0 4px" }}>📄 Required Documents</h2>
              <p style={{ fontSize: 13, color: "#1a3a4a70", margin: "0 0 4px" }}>
                Based on the company's country, entity and ownership type, here's exactly what we need.
              </p>
            </div>
            <div style={card}>
              {(() => {
                const entLabel = (activeEntityTypes.find(e => e.id === entityType)?.label) || entityType;
                const drsStep1Data = {
                  companyName: research?.companyName || companyName,
                  incorporationCountry: countryObj ? countryObj.name : countryCode,
                  entityType: entLabel,
                  ownershipType: OWNERSHIP_ID_TO_DRS[ownershipType] || ownershipType,
                };
                return (
                  <Step2DynamicForm
                    step1Data={drsStep1Data}
                    researchData={research}
                    docSearchResults={docSearchResults}
                    onComplete={(data) => {
                      setDrsSubmitted(data.submittedRequirements || []);
                      setDrsFlags(data.flags || {});
                      setDrsGapsCleared(false);
                      scrollAndSetStep(STEPS.declare);
                    }}
                  />
                );
              })()}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-start" }}>
              <Btn variant="secondary" onClick={() => scrollAndSetStep(STEPS.fillGaps)}>← Back to Fill Gaps</Btn>
            </div>
          </div>
        )}

        {/* DRS pre-declaration gap gate (Step 5 of the CDD brief). Blocks the
            declaration until every mandatory document is on file. */}
        {step === STEPS.declare && !done && !drsGapsCleared && (
          <div>
            <div style={card}>
              <h2 style={{ fontSize: 17, fontWeight: 700, margin: "0 0 12px" }}>✅ Final document check</h2>
              {(() => {
                const entLabel = (activeEntityTypes.find(e => e.id === entityType)?.label) || entityType;
                const drsStep1Data = {
                  companyName: research?.companyName || companyName,
                  incorporationCountry: countryObj ? countryObj.name : countryCode,
                  entityType: entLabel,
                  ownershipType: OWNERSHIP_ID_TO_DRS[ownershipType] || ownershipType,
                };
                return (
                  <Step5Recompute
                    step1Data={drsStep1Data}
                    sector={null}
                    submittedRequirements={drsSubmitted}
                    extraFlags={{}}
                    onGapsClear={() => setDrsGapsCleared(true)}
                    onRequestDocument={() => scrollAndSetStep(STEPS.documentRequirements)}
                  />
                );
              })()}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-start" }}>
              <Btn variant="secondary" onClick={() => scrollAndSetStep(STEPS.documentRequirements)}>← Back to Documents</Btn>
            </div>
          </div>
        )}

        {step === STEPS.declare && !done && drsGapsCleared && (
          <div>
            <div style={card}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: "linear-gradient(135deg,#1a3a4a,#2d5a6e)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>📜</div>
                <div>
                  <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>Applicant Declaration {jurisdictionBadge}{entityBadge}</h2>
                  <p style={{ fontSize: 12, color: "#1a3a4a70", margin: 0 }}>Review and confirm</p>
                </div>
              </div>
              <div style={{ background: "#fafcfb", borderRadius: 10, padding: 18, border: "1px solid rgba(26,58,74,0.08)", marginBottom: 18 }}>
                <p style={{ fontSize: 13, lineHeight: 1.7, margin: 0 }}>
                  I, <strong>{gapRef.current.applicantFirstName || "___"} {gapRef.current.applicantLastName || "___"}</strong>, hereby declare that:
                </p>
                <ul style={{ fontSize: 13, lineHeight: 1.8, paddingLeft: 18, margin: "10px 0 0" }}>
                  <li>All information provided is true, complete, and accurate to the best of my knowledge.</li>
                  <li>I am authorised to submit this on behalf of <strong>{research?.companyName || companyName}</strong>.</li>
                  <li>Providing false information may result in rejection and legal consequences.</li>
                  <li>I consent to verification through third-party and regulatory databases.</li>
                  <li>I will notify of any material changes promptly.</li>
                </ul>
              </div>
              <div onClick={() => setDeclared(!declared)} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: 14, background: declared ? "#f0f9f6" : "#f8f8f8", borderRadius: 8, cursor: "pointer", marginBottom: 18, border: declared ? "1.5px solid #4a9e8e" : "1.5px solid #ddd" }}>
                <input type="checkbox" checked={declared} readOnly style={{ width: 18, height: 18, marginTop: 1, accentColor: "#4a9e8e", cursor: "pointer" }} />
                <span style={{ fontSize: 13, fontWeight: 600 }}>I confirm I have read, understood, and agree to the above declaration.</span>
              </div>
              <div style={{ background: "#f3f5f8", borderRadius: 8, padding: 14 }}>
                <h4 style={{ fontSize: 11, fontWeight: 700, margin: "0 0 8px", color: "#1a3a4a80", letterSpacing: "0.1em", textTransform: "uppercase" }}>Device Information (Auto-captured)</h4>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5 }}>
                  {[["IP Address", device.ipAddress], ["Platform", device.platform], ["Timezone", device.timezone], ["Screen", device.screenRes], ["Language", device.language], ["Capture Time", new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC"]].map(([k, v]) => (
                    <div key={k} style={{ fontSize: 11, color: "#1a3a4a90" }}><span style={{ fontWeight: 600 }}>{k}:</span> {v || "..."}</div>
                  ))}
                </div>
                <div style={{ fontSize: 10, color: "#1a3a4a50", marginTop: 6, borderTop: "1px solid rgba(26,58,74,0.06)", paddingTop: 5, wordBreak: "break-all" }}>
                  User Agent: {(device.userAgent || "").slice(0, 120)}
                </div>
              </div>
            </div>
            {inPreview && (
              <div style={{
                padding: "12px 16px",
                background: "#EFF6FF",
                border: "1px solid #BFDBFE",
                borderRadius: 8,
                fontSize: 13, color: "#1E40AF",
                marginBottom: 16,
                display: "flex", gap: 8, alignItems: "flex-start",
              }}>
                <span>ℹ</span>
                <span>Submission is disabled in preview mode. Publish your configuration to enable the live form.</span>
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <Btn variant="secondary" onClick={() => scrollAndSetStep(STEPS.fillGaps)}>← Back</Btn>
              <Btn
                variant="green"
                onClick={inPreview ? undefined : submitApplication}
                disabled={!declared || inPreview}
              >
                ✓ Submit Application
              </Btn>
            </div>
          </div>
        )}

        {done && (
          <div style={{ ...card, textAlign: "center", padding: "44px 28px" }}>
            <div style={{ width: 64, height: 64, borderRadius: "50%", background: "linear-gradient(135deg,#4a9e8e,#3a8e7e)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32, margin: "0 auto 18px", boxShadow: "0 6px 20px rgba(74,158,142,0.3)" }}>✓</div>
            <h2 style={{ fontSize: 20, fontWeight: 800, margin: "0 0 6px" }}>Application Submitted {jurisdictionBadge}{entityBadge}</h2>
            <p style={{ fontSize: 13, color: "#1a3a4a70", margin: "0 0 22px" }}>KYC onboarding for <strong>{research?.companyName || companyName}</strong> submitted successfully.</p>
            <div style={{ background: "#f5f7fa", borderRadius: 10, padding: 18, textAlign: "left", maxWidth: 480, margin: "0 auto 22px" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#1a3a4a80", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.08em" }}>Submission Summary</div>
              {(() => {
                const docKeys = docTypesForEntity(entityType, tenantConfig).filter(d => uploadedDocs[d.key]).map(d => d.label);
                const docExtractedCount = (research?.found || []).filter(i => i.sourceTier === "document").length;
                const tier1 = (research?.found || []).filter(i => i.sourceTier === "tier1").length;
                const tier2 = (research?.found || []).filter(i => i.sourceTier === "tier2").length;
                const accepted = (research?.found || []).filter((_, i) => checks[i]).length;
                const rejected = (research?.found || []).filter((_, i) => !checks[i]).length;
                const rows = [
                  ["Company", research?.companyName || companyName],
                  ["Journey", journeyType === "ai_documents" ? "AI + Documents" : "AI Research Only"],
                  ["Jurisdiction", activeSchema?.region === "UK" ? "United Kingdom" : "Singapore / Default"],
                  ["From documents", docExtractedCount + " fields"],
                  ["From official sources", tier1 + " fields"],
                  ["From unverified sources", tier2 + " fields"],
                  ["Accepted on Confirm", accepted + " · " + rejected + " corrected"],
                  ...(docKeys.length > 0 ? [["Documents uploaded", docKeys.join(", ")]] : []),
                  ["Manual fields", Object.keys(gapRef.current).length + " provided"],
                  ["Applicant", (gapRef.current.applicantFirstName || "") + " " + (gapRef.current.applicantLastName || "")],
                  ["Declared at", submitTs.replace("T", " ").slice(0, 19) + " UTC"],
                  ["IP Address", device.ipAddress],
                ];
                return rows.map(([k, v]) => (
                  <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid rgba(26,58,74,0.04)", fontSize: 12 }}>
                    <span style={{ fontWeight: 600 }}>{k}</span><span style={{ color: "#1a3a4a90" }}>{v}</span>
                  </div>
                ));
              })()}
            </div>
            <Btn variant="secondary" onClick={() => { setCompanyName(""); setCountryCode(""); setEntityType(""); setOwnershipType(""); setDone(false); setSubmitTs(""); resetAll(); }}>Start New Application</Btn>
          </div>
        )}

        <footer style={{
          textAlign: "center", marginTop: 40, paddingTop: 18,
          borderTop: "1px solid rgba(26,58,74,0.08)",
          fontSize: 11, color: "#1a3a4a70",
        }}>
          © {new Date().getFullYear()} {companyName_}
          {tenantConfig?.company?.privacyPolicyUrl && (
            <>
              {" · "}
              <a
                href={tenantConfig.company.privacyPolicyUrl}
                target="_blank" rel="noopener noreferrer"
                style={{ color: "#1a3a4a", textDecoration: "underline" }}
              >Privacy Policy</a>
            </>
          )}
          {tenantConfig?.company?.primaryContactEmail && (
            <>
              {" · "}
              <a
                href={`mailto:${tenantConfig.company.primaryContactEmail}`}
                style={{ color: "#1a3a4a", textDecoration: "underline" }}
              >Contact</a>
            </>
          )}
          {(() => {
            // Tiny config/version readout for dev or ?debug=true. Helps confirm
            // during testing which config version is live and which schema cell
            // was resolved. Production users never see it.
            const isDev = process.env.NODE_ENV === "development";
            let isDebug = false;
            try {
              isDebug = new URLSearchParams(window.location.search).get("debug") === "true";
            } catch (_) { /* noop */ }
            if (!isDev && !isDebug) return null;
            const cellKey = activeSchema && entityType && activeSchema.licenceId
              ? `${entityType}:${activeSchema.licenceId}`
              : "(no schema active)";
            return (
              <div style={{ marginTop: 8, fontSize: 10, color: "#1a3a4a55", fontFamily: "monospace" }}>
                Config v{tenantConfig?._version ?? "?"} · Tenant: {tenantId} · Schema: {cellKey}
              </div>
            );
          })()}
        </footer>

      </div>
    </div>
  );
}
