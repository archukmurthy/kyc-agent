import {
  WOLFSBERG_EXTRACTION_PROMPT,
  CERT_EXTRACTION_PROMPT,
  LICENCE_EXTRACTION_PROMPT,
  ANNUAL_REPORT_EXTRACTION_PROMPT,
  ORG_CHART_EXTRACTION_PROMPT,
  AML_POLICY_EXTRACTION_PROMPT,
} from "./extractionPrompts";

/* DOC_TYPES — single source of truth for which
   document slots exist, their UI presentation, the
   accepted MIME types, the badge label, the human-
   readable source name shown on Confirm, and the
   prompt to use when extracting.
   The `entities` field gates which cards render in
   the Document Upload step. */
export const DOC_TYPES = [
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

export const initialUploadedDocs = () => Object.fromEntries(DOC_TYPES.map(d => [d.key, null]));

// Merge the configured per-entity-type document list with the hardcoded
// DOC_TYPES (which carry the extraction prompts and source-name strings).
// Config can hide / reorder / rename docs; the AI extraction logic stays
// hardcoded and is applied to docs whose ids match a DOC_TYPES entry.
export const docTypesForEntity = (entityTypeId, tenantConfig) => {
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

// Build the Phase-1 status messages for the docs we actually have.
export const buildPhase1Msgs = (docs) => {
  const msgs = [];
  DOC_TYPES.forEach(d => {
    if (docs[d.key]) msgs.push(`Reading ${d.label}…`);
  });
  if (msgs.length === 0) msgs.push("Reading your documents…");
  return msgs;
};
