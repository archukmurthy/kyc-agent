const { test } = require("node:test");
const assert = require("node:assert");
const pipeline = require("../../src/pipeline");
const { buildDefaultConfig } = require("../seedConfig");
const { EXTRACTION_PROMPT_BY_DOC_KEY } = require("../../src/constants/extractionPrompts");
const {
  buildAnthropicRequest,
  ResearchInputError,
  CLIENT_OWNED_KEYS,
  RESEARCH_MODEL,
  RESEARCH_MAX_TOKENS,
  EXTRACTION_MAX_TOKENS,
} = require("../researchPrompts");

const cfg = buildDefaultConfig("acme");

// Verbatim copy of the browser composition that src/App.js doResearch used
// before Part 2 (buildPrompt + PRIMARY COMPANY IDENTIFIER + AUTOMATICALLY
// SOURCED DOCUMENTS). The server must reproduce it byte for byte.
function legacyBrowserPrompt({ companyName, countryName, countryCode, schema, wolfsbergFields, ownershipType, regNumber, acceptedDocs }) {
  let researchPrompt = pipeline.buildPrompt(companyName, countryName, countryCode, schema, wolfsbergFields, ownershipType);
  const trimmedRegNumber = regNumber.trim();
  if (trimmedRegNumber) {
    researchPrompt += `\n\nPRIMARY COMPANY IDENTIFIER:\n` +
      `The customer provided this official business registration / company number: ${trimmedRegNumber}.\n` +
      `Use it as the PRIMARY key to identify the exact company in ` +
      `${countryName} (Companies House and any ` +
      `other applicable company register), so you pull the precise entity ` +
      `rather than name-matching. If this number does not correspond to a ` +
      `real company, ignore it and fall back to researching by the company ` +
      `name "${companyName}".\n`;
  }
  if (acceptedDocs.length > 0) {
    researchPrompt += `\n\nAUTOMATICALLY SOURCED DOCUMENTS:\n`;
    researchPrompt += `The following documents have been ` +
      `sourced automatically and are available ` +
      `for field extraction:\n\n`;
    acceptedDocs.forEach((doc) => {
      researchPrompt += `- ${doc.label} (${doc.year})\n`;
      researchPrompt += `  URL: ${doc.sourceUrl}\n`;
      researchPrompt += `  Source: ${doc.sourceLabel}\n`;
      researchPrompt += `  Please extract all relevant ` +
        `compliance fields from this document.\n\n`;
    });
  }
  return researchPrompt;
}

const DOCS = [
  { label: "Annual Report", year: 2024, sourceUrl: "https://example.com/ar.pdf", sourceLabel: "Company website" },
  { label: "Confirmation Statement", year: 2023, sourceUrl: "https://find-and-update.company-information.service.gov.uk/x", sourceLabel: "Companies House" },
];

function researchBody(extra = {}) {
  return {
    mode: "research",
    companyName: "Britannia Group Limited",
    countryCode: "GB",
    countryName: "United Kingdom",
    entityType: "Corporate",
    ownershipType: "private_limited",
    registrationNumber: "01234567",
    wolfsbergFields: { legal_name: "Britannia Group Limited" },
    sourcedDocuments: DOCS,
    ...extra,
  };
}

function codeOf(fn) {
  try { fn(); } catch (err) { assert.ok(err instanceof ResearchInputError, `expected ResearchInputError, got ${err}`); return err.code; }
  assert.fail("expected a throw");
}

test("every client-owned key is refused", () => {
  assert.deepStrictEqual(CLIENT_OWNED_KEYS, ["prompt", "messages", "model", "tools", "max_tokens"]);
  for (const key of CLIENT_OWNED_KEYS) {
    assert.strictEqual(codeOf(() => buildAnthropicRequest(researchBody({ [key]: "x" }), cfg)), "client_prompt_not_allowed");
  }
});

test("an unknown mode is refused", () => {
  assert.strictEqual(codeOf(() => buildAnthropicRequest({ mode: "chat" }, cfg)), "invalid_mode");
  assert.strictEqual(codeOf(() => buildAnthropicRequest({}, cfg)), "invalid_mode");
});

test("research: the server prompt is byte-identical to the old browser prompt (golden)", () => {
  const schema = pipeline.getSchemaFromConfig("GB", "Corporate", cfg);
  const expected = legacyBrowserPrompt({
    companyName: "Britannia Group Limited",
    countryName: "United Kingdom",
    countryCode: "GB",
    schema,
    wolfsbergFields: { legal_name: "Britannia Group Limited" },
    ownershipType: "private_limited",
    regNumber: "01234567",
    acceptedDocs: DOCS,
  });
  const built = buildAnthropicRequest(researchBody(), cfg);
  assert.strictEqual(built.mode, "research");
  assert.strictEqual(built.requestBody.messages[0].content, expected);
  assert.strictEqual(built.requestBody.model, RESEARCH_MODEL);
  assert.strictEqual(built.requestBody.max_tokens, RESEARCH_MAX_TOKENS);
  assert.deepStrictEqual(built.requestBody.tools, pipeline.RESEARCH_TOOLS);
});

test("research: no reg number and no documents gives the plain buildPrompt output", () => {
  const schema = pipeline.getSchemaFromConfig("GB", "Corporate", cfg);
  const built = buildAnthropicRequest(researchBody({ registrationNumber: "", sourcedDocuments: [], wolfsbergFields: undefined }), cfg);
  assert.strictEqual(
    built.requestBody.messages[0].content,
    pipeline.buildPrompt("Britannia Group Limited", "United Kingdom", "GB", schema, {}, "private_limited"),
  );
});

test("research: cache key parts and officers inputs come from the validated input", () => {
  const built = buildAnthropicRequest(researchBody(), cfg);
  assert.deepStrictEqual(built.cacheKeyParts, {
    companyName: "Britannia Group Limited",
    jurisdiction: "GB",
    entityType: "Corporate",
    ownershipType: "private_limited",
    registrationNumber: "01234567",
  });
  assert.deepStrictEqual(built.officers, {
    companyName: "Britannia Group Limited",
    jurisdiction: "GB",
    registrationNumber: "01234567",
  });
  const noReg = buildAnthropicRequest(researchBody({ registrationNumber: "  " }), cfg);
  assert.strictEqual(noReg.officers.registrationNumber, undefined);
});

test("research: missing company facts are refused", () => {
  assert.strictEqual(codeOf(() => buildAnthropicRequest(researchBody({ companyName: "  " }), cfg)), "missing_company_fields");
  assert.strictEqual(codeOf(() => buildAnthropicRequest(researchBody({ countryCode: undefined }), cfg)), "missing_company_fields");
  assert.strictEqual(codeOf(() => buildAnthropicRequest(researchBody({ entityType: 42 }), cfg)), "missing_company_fields");
});

test("research: non-http document URLs are dropped and the list is capped at 10", () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ label: `Doc ${i}`, year: 2020, sourceUrl: `https://e.com/${i}`, sourceLabel: "Web" }));
  const withBad = [{ label: "Evil", year: 2020, sourceUrl: "javascript:alert(1)", sourceLabel: "x" }, ...many];
  const content = buildAnthropicRequest(researchBody({ sourcedDocuments: withBad }), cfg).requestBody.messages[0].content;
  assert.ok(!content.includes("javascript:"));
  assert.ok(content.includes("https://e.com/9"));
  assert.ok(!content.includes("https://e.com/10"));
});

test("research: an oversized wolfsberg payload is refused", () => {
  const huge = { notes: "x".repeat(20001) };
  assert.strictEqual(codeOf(() => buildAnthropicRequest(researchBody({ wolfsbergFields: huge }), cfg)), "invalid_wolfsberg_fields");
});

test("gap_recovery: field ids map onto the tenant schema; unknown ids are dropped", () => {
  const schema = pipeline.getSchemaFromConfig("GB", "Corporate", cfg);
  const [first, second] = schema.researchFields;
  const body = {
    mode: "gap_recovery",
    companyName: "Britannia Group Limited",
    countryCode: "GB",
    countryName: "United Kingdom",
    entityType: "Corporate",
    ownershipType: "private_limited",
    missingFields: [first.field, "not_a_field"],
    upgradeableFields: [second.field],
  };
  const built = buildAnthropicRequest(body, cfg);
  const expected = pipeline.buildGapRecoveryPrompt(
    { name: "Britannia Group Limited", countryName: "United Kingdom" },
    [first],
    [second],
    pipeline.computeResearchStrategy("private_limited", "GB"),
  );
  assert.strictEqual(built.requestBody.messages[0].content, expected);
  assert.ok(!built.requestBody.messages[0].content.includes("not_a_field"));
  assert.deepStrictEqual(built.requestBody.tools, pipeline.RESEARCH_TOOLS);
  assert.strictEqual(built.cacheKeyParts, null);
  assert.strictEqual(built.officers, null);
});

test("gap_recovery: no recognised field is refused", () => {
  const body = { mode: "gap_recovery", companyName: "B", countryCode: "GB", entityType: "Corporate", missingFields: ["nope"], upgradeableFields: "x" };
  assert.strictEqual(codeOf(() => buildAnthropicRequest(body, cfg)), "no_gap_fields");
});

test("extract_document: the server picks the prompt from the doc key and sends no tools", () => {
  const body = { mode: "extract_document", docKey: "certificate", file: { mediaType: "application/pdf", base64: "JVBERi0=" } };
  const built = buildAnthropicRequest(body, cfg);
  assert.deepStrictEqual(built.requestBody, {
    model: RESEARCH_MODEL,
    max_tokens: EXTRACTION_MAX_TOKENS,
    messages: [{
      role: "user",
      content: [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: "JVBERi0=" } },
        { type: "text", text: EXTRACTION_PROMPT_BY_DOC_KEY.certificate },
      ],
    }],
  });
  assert.strictEqual(built.cacheKeyParts, null);
  assert.strictEqual(built.officers, null);
  const image = buildAnthropicRequest({ ...body, docKey: "orgChart", file: { mediaType: "image/png", base64: "iVBOR" } }, cfg);
  assert.strictEqual(image.requestBody.messages[0].content[0].type, "image");
});

test("extract_document: bad doc key, media type or file are refused", () => {
  const ok = { mode: "extract_document", docKey: "certificate", file: { mediaType: "application/pdf", base64: "JVBERi0=" } };
  assert.strictEqual(codeOf(() => buildAnthropicRequest({ ...ok, docKey: "toString" }, cfg)), "invalid_doc_key");
  assert.strictEqual(codeOf(() => buildAnthropicRequest({ ...ok, file: { mediaType: "text/html", base64: "x" } }, cfg)), "invalid_media_type");
  assert.strictEqual(codeOf(() => buildAnthropicRequest({ ...ok, file: { mediaType: "application/pdf", base64: "" } }, cfg)), "invalid_file");
  assert.strictEqual(codeOf(() => buildAnthropicRequest({ ...ok, file: { mediaType: "application/pdf", base64: "a".repeat(6000001) } }, cfg)), "invalid_file");
});
