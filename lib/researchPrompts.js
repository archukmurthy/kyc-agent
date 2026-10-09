// Builds the Anthropic /v1/messages request for POST /api/research from
// structured input. The browser never supplies a prompt, model, tool list or
// token budget: it names a mode and the company facts, and the prompt comes
// from the tenant's own schema via the shared src/pipeline.js builders.
//
// CommonJS so api/research.js and the node tests can require it.

const pipeline = require("../src/pipeline");
const { EXTRACTION_PROMPT_BY_DOC_KEY } = require("../src/constants/extractionPrompts");

const RESEARCH_MODEL = "claude-sonnet-4-5";
const RESEARCH_MAX_TOKENS = 16000;
const EXTRACTION_MAX_TOKENS = 4096;
const MODES = ["research", "gap_recovery", "extract_document"];
const CLIENT_OWNED_KEYS = ["prompt", "messages", "model", "tools", "max_tokens"];
const EXTRACTION_MEDIA_TYPES = ["application/pdf", "image/png", "image/jpeg"];
const MAX_BASE64_CHARS = 6000000;
const MAX_SOURCED_DOCUMENTS = 10;
const MAX_WOLFSBERG_JSON_CHARS = 20000;

class ResearchInputError extends Error {
  constructor(code) {
    super(code);
    this.name = "ResearchInputError";
    this.code = code;
  }
}

// Single-line prompt copy: control characters become spaces, then trim + cap.
function text(value, max) {
  if (typeof value !== "string") return "";
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\x00-\x1f\x7f]/g, " ").trim().slice(0, max);
}

function normaliseSourcedDocuments(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((d) => d && typeof d === "object" && /^https?:\/\//i.test(text(d.sourceUrl, 2000)))
    .slice(0, MAX_SOURCED_DOCUMENTS)
    .map((d) => ({
      label: text(d.label, 200),
      year: text(d.year == null ? "" : String(d.year), 16),
      sourceUrl: text(d.sourceUrl, 2000),
      sourceLabel: text(d.sourceLabel, 200),
    }));
}

function normaliseWolfsberg(fields) {
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) return {};
  let json;
  try {
    json = JSON.stringify(fields);
  } catch (_) {
    throw new ResearchInputError("invalid_wolfsberg_fields");
  }
  if (json.length > MAX_WOLFSBERG_JSON_CHARS) throw new ResearchInputError("invalid_wolfsberg_fields");
  return JSON.parse(json);
}

// Moved verbatim from src/App.js doResearch (Part 2).
function registrationBlock(registrationNumber, countryName, companyName) {
  return `\n\nPRIMARY COMPANY IDENTIFIER:\n` +
    `The customer provided this official business registration / company number: ${registrationNumber}.\n` +
    `Use it as the PRIMARY key to identify the exact company in ` +
    `${countryName} (Companies House and any ` +
    `other applicable company register), so you pull the precise entity ` +
    `rather than name-matching. If this number does not correspond to a ` +
    `real company, ignore it and fall back to researching by the company ` +
    `name "${companyName}".\n`;
}

// Moved verbatim from src/App.js doResearch (Part 2).
function sourcedDocumentsBlock(docs) {
  let block = `\n\nAUTOMATICALLY SOURCED DOCUMENTS:\n`;
  block += `The following documents have been ` +
    `sourced automatically and are available ` +
    `for field extraction:\n\n`;
  docs.forEach((doc) => {
    block += `- ${doc.label} (${doc.year})\n`;
    block += `  URL: ${doc.sourceUrl}\n`;
    block += `  Source: ${doc.sourceLabel}\n`;
    block += `  Please extract all relevant ` +
      `compliance fields from this document.\n\n`;
  });
  return block;
}

function companyFacts(input, tenantConfig) {
  const companyName = text(input.companyName, 200);
  const countryCode = text(input.countryCode, 8).toUpperCase();
  const entityType = text(input.entityType, 64);
  if (!companyName || !countryCode || !entityType) throw new ResearchInputError("missing_company_fields");
  const countryName = text(input.countryName, 100) || countryCode;
  const ownershipType = text(input.ownershipType, 64) || null;
  let schema;
  try {
    schema = pipeline.getSchemaFromConfig(countryCode, entityType, tenantConfig);
  } catch (_) {
    schema = null;
  }
  if (!schema || !Array.isArray(schema.researchFields)) throw new ResearchInputError("invalid_schema");
  return { companyName, countryCode, countryName, entityType, ownershipType, schema };
}

function buildExtractionRequest(input) {
  const docKey = input.docKey;
  if (typeof docKey !== "string" || !Object.prototype.hasOwnProperty.call(EXTRACTION_PROMPT_BY_DOC_KEY, docKey)) {
    throw new ResearchInputError("invalid_doc_key");
  }
  const file = input.file && typeof input.file === "object" ? input.file : {};
  if (!EXTRACTION_MEDIA_TYPES.includes(file.mediaType)) throw new ResearchInputError("invalid_media_type");
  if (typeof file.base64 !== "string" || !file.base64 || file.base64.length > MAX_BASE64_CHARS) {
    throw new ResearchInputError("invalid_file");
  }
  const blockType = file.mediaType.startsWith("image/") ? "image" : "document";
  return {
    mode: "extract_document",
    requestBody: {
      model: RESEARCH_MODEL,
      max_tokens: EXTRACTION_MAX_TOKENS,
      messages: [{
        role: "user",
        content: [
          { type: blockType, source: { type: "base64", media_type: file.mediaType, data: file.base64 } },
          { type: "text", text: EXTRACTION_PROMPT_BY_DOC_KEY[docKey] },
        ],
      }],
    },
    cacheKeyParts: null,
    officers: null,
  };
}

function buildGapRecoveryRequest(input, tenantConfig) {
  const facts = companyFacts(input, tenantConfig);
  // Only researchable fields can be gap-recovered; exclude customer-supplied and
  // non-auto-researchable fields (same filter as buildPrompt).
  const researchable = facts.schema.researchFields.filter(
    (f) => !f.customerSupplied && !f.doNotAutoResearch
  );
  const byId = new Map(researchable.map((f) => [f.field, f]));
  const pick = (ids) => {
    if (!Array.isArray(ids)) return [];
    // De-duplicate ids using Set, then map to field objects.
    const unique = [...new Set(ids)];
    return unique
      .filter((id) => typeof id === "string" && byId.has(id))
      .map((id) => byId.get(id));
  };
  const missing = pick(input.missingFields);
  const upgradeable = pick(input.upgradeableFields);
  // Remove any ids from upgradeable that are already in missing.
  const missingIds = new Set(missing.map((f) => f.field));
  const upgradeableFiltered = upgradeable.filter((f) => !missingIds.has(f.field));
  if (missing.length + upgradeableFiltered.length === 0) throw new ResearchInputError("no_gap_fields");
  const strategy = facts.ownershipType ? pipeline.computeResearchStrategy(facts.ownershipType, facts.countryCode) : null;
  const prompt = pipeline.buildGapRecoveryPrompt(
    { name: facts.companyName, countryName: facts.countryName },
    missing,
    upgradeableFiltered,
    strategy,
  );
  return {
    mode: "gap_recovery",
    requestBody: {
      model: RESEARCH_MODEL,
      max_tokens: RESEARCH_MAX_TOKENS,
      messages: [{ role: "user", content: prompt }],
      tools: pipeline.RESEARCH_TOOLS,
    },
    cacheKeyParts: null,
    officers: null,
  };
}

function buildResearchRequest(input, tenantConfig) {
  const facts = companyFacts(input, tenantConfig);
  const registrationNumber = text(input.registrationNumber, 64);
  const sourcedDocuments = normaliseSourcedDocuments(input.sourcedDocuments);
  const wolfsbergFields = normaliseWolfsberg(input.wolfsbergFields);

  let prompt = pipeline.buildPrompt(
    facts.companyName,
    facts.countryName,
    facts.countryCode,
    facts.schema,
    wolfsbergFields,
    facts.ownershipType,
  );
  if (registrationNumber) prompt += registrationBlock(registrationNumber, facts.countryName, facts.companyName);
  if (sourcedDocuments.length > 0) prompt += sourcedDocumentsBlock(sourcedDocuments);

  // A steerable free-text field (wolfsbergFields) or per-applicant documents
  // (sourcedDocuments) make the result specific to this caller/applicant - it
  // must never be cached and served back to a different customer of the
  // tenant under the plain company/jurisdiction key.
  const cacheable = Object.keys(wolfsbergFields).length === 0 && sourcedDocuments.length === 0;

  return {
    mode: "research",
    requestBody: {
      model: RESEARCH_MODEL,
      max_tokens: RESEARCH_MAX_TOKENS,
      messages: [{ role: "user", content: prompt }],
      tools: pipeline.RESEARCH_TOOLS,
    },
    cacheKeyParts: cacheable ? {
      companyName: facts.companyName,
      jurisdiction: facts.countryCode,
      countryName: facts.countryName,
      entityType: facts.entityType,
      ownershipType: facts.ownershipType || "",
      registrationNumber,
    } : null,
    officers: {
      companyName: facts.companyName,
      jurisdiction: facts.countryCode,
      registrationNumber: registrationNumber || undefined,
    },
  };
}

function buildAnthropicRequest(body, tenantConfig) {
  const input = body && typeof body === "object" ? body : {};
  if (CLIENT_OWNED_KEYS.some((key) => input[key] !== undefined)) {
    throw new ResearchInputError("client_prompt_not_allowed");
  }
  if (!MODES.includes(input.mode)) throw new ResearchInputError("invalid_mode");
  if (input.mode === "extract_document") return buildExtractionRequest(input);
  if (input.mode === "gap_recovery") return buildGapRecoveryRequest(input, tenantConfig);
  return buildResearchRequest(input, tenantConfig);
}

module.exports = {
  buildAnthropicRequest,
  ResearchInputError,
  CLIENT_OWNED_KEYS,
  RESEARCH_MODEL,
  RESEARCH_MAX_TOKENS,
  EXTRACTION_MAX_TOKENS,
};
