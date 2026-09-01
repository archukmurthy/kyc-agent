"use strict";

class SemanticExtractionProvider {
  capabilities() { return { contentKinds: ["text"], maxRequestBytes: null }; }
  async extract() { throw new Error("SemanticExtractionProvider.extract must be implemented"); }
}

const SEMANTIC_DISCOVERY_OBJECTIVE = Object.freeze([
  "Perform two simultaneous objectives.",
  "REQUESTED EXTRACTION: Extract every source-supported fact responsive to the supplied requested concepts.",
  "OPEN KYC/KYB DISCOVERY: Independently inspect the complete supplied evidence and return every additional source-supported fact you find that could reasonably matter to KYC/KYB, identification, verification, due diligence, or later risk investigation. A relevant fact must not be omitted merely because it was not requested.",
  "For open discovery, consider semantic categories including entity identity and names; historical or former names; registration and incorporation information; legal form and status; addresses; business activities; industry, activity, or classification codes; ownership and control; officers and roles; regulatory or licensing information; material corporate history; and other source-supported facts reasonably useful for identification, verification, due diligence, or risk investigation. These are semantic categories, not a source-field allow-list.",
  "Do not turn every source property into a business fact. Exclude technical or transport metadata such as etags, API navigation links, links.self, and retrieval metadata from semantic facts; those remain preserved in the source Artifact.",
  "Preserve direct versus derived meaning. If the source directly states a classification code, return the code as a direct fact. Do not invent or silently add an industry or activity description. Any later classification requires explicit derived-fact transformation lineage.",
  "Do not infer facts not stated or supported by the evidence. Do not return derived classifications unless explicitly requested.",
  "Keep the JSON compact. For repeated source records, use a meaningful fact whose value is an array of source-supported records instead of emitting a separate fact for every property of every record. Do not omit a record merely to shorten the response.",
  "Never sample, truncate, return only the first N records, or invent a *_sample concept unless sampling was explicitly requested. If complete extraction is impossible, report completeness.state=incomplete and explain the limitation.",
  "Provenance and navigation already supplied by Evidence are not business facts. Do not return source URLs, page URLs or numbers, source-page context, etags, API links, transport metadata, Artifact identity, capture metadata, or retrieval metadata as facts. Mark any non-business output semantic_role=provenance_metadata so it can be excluded.",
  "Absence is not a business value. Do not put placeholder language such as an unavailable or unstated value into a fact. A fact must have value_found=true and contain an actual source-supported proposition. Report a requested concept with no supported value through requested_concept_outcomes status=not_found instead.",
]);

const DEFAULT_MAX_OUTPUT_TOKENS = 16000;
const DEFAULT_PROVIDER_TIMEOUT_MS = 120000;

class FixtureSemanticProvider extends SemanticExtractionProvider {
  constructor(options = {}) { super(); this.variant = options.variant || "primary"; }
  capabilities() { return { contentKinds: ["text", "image", "document"], maxRequestBytes: 32 * 1024 * 1024 }; }
  async extract({ artifact, artifactInputs = [], contentItems = [], content, decodedText, requestedConcepts = [] }) {
    const text = String(decodedText === undefined ? content || "" : decodedText || "");
    if (/UNREADABLE/i.test(text)) return { facts: [], requestedConceptOutcomes: requestedConcepts.map((request) => ({ concept: request.concept, status: "not_evaluated" })), completeness: { state: "incomplete", limitations: ["Evidence was unreadable"] }, support: { state: "not_supported", signals: { readability: "unreadable", extractionMethod: "fixture_ai" } } };
    const facts = [];
    for (const request of requestedConcepts) {
      if (request.concept === "business_name") {
        const match = text.match(/Registered name\s*:\s*([^\n;]+)/i);
        if (match) facts.push({ concept: request.concept, value: match[1].trim(), raw: match[0], requested: true, schemaFieldId: request.schemaFieldId, informationNeedId: request.informationNeedId });
      }
      if (request.concept === "registered_address") {
        const candidates = [...text.matchAll(/(?:Registered address|Address)\s*:\s*([^\n;]+)/gi)].map((m) => ({ value: m[1].trim(), raw: m[0] }));
        if (candidates.length) {
          const selected = this.variant === "independent" && candidates[1] ? candidates[1] : candidates[0];
          facts.push({ concept: request.concept, ...selected, requested: true, schemaFieldId: request.schemaFieldId, informationNeedId: request.informationNeedId, ambiguous: candidates.length > 1 });
        }
      }
    }
    const former = text.match(/Formerly\s+([^\n;.]+)/i);
    if (former) facts.push({ concept: "previous_legal_name", value: former[1].trim(), raw: former[0], requested: false });
    const inputIds = artifactInputs.map((input) => input?.artifact?.id).filter(Boolean); if (!inputIds.length && artifact?.id) inputIds.push(artifact.id);
    return { facts: facts.map((fact) => ({ ...fact, valueFound: true, semanticRole: "business_fact", sampled: false, supportingArtifactIds: inputIds.slice(0, 1), supportLocators: contentItems.length ? [{ artifact_id: inputIds[0], excerpt: fact.raw, description: `Fixture support for ${fact.concept}`, page_start: contentItems[0].kind === "document" ? 1 : undefined, page_end: contentItems[0].kind === "document" ? 1 : undefined, locator_method: "fixture" }] : [] })), requestedConceptOutcomes: requestedConcepts.map((request) => ({ concept: request.concept, status: facts.some((fact) => fact.requested && fact.concept === request.concept) ? "found" : "not_found" })), completeness: { state: "complete", limitations: [] }, support: { state: facts.length ? "supported" : "not_supported", signals: { readability: "clear", extractionMethod: "fixture_ai", literalFieldMatchRequired: false } } };
  }
}

function parseProviderJson(text) {
  const cleaned = String(text || "").replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const start = cleaned.indexOf("{"); const end = cleaned.lastIndexOf("}");
  if (start < 0 || end < start) throw Object.assign(new Error("Semantic provider returned malformed JSON"), { code: "provider_malformed_output" });
  try { return JSON.parse(cleaned.slice(start, end + 1)); }
  catch (_) { throw Object.assign(new Error("Semantic provider returned malformed JSON"), { code: "provider_malformed_output" }); }
}

class AnthropicSemanticProvider extends SemanticExtractionProvider {
  constructor({ apiKey, model, fetchImpl = global.fetch, timeoutMs = DEFAULT_PROVIDER_TIMEOUT_MS, maxOutputTokens = DEFAULT_MAX_OUTPUT_TOKENS, instructionReference = "evidence-r3-live-v1-multimodal-locators" } = {}) {
    super(); this.apiKey = apiKey; this.model = model; this.fetchImpl = fetchImpl; this.timeoutMs = timeoutMs; this.maxOutputTokens = maxOutputTokens; this.instructionReference = instructionReference;
  }
  configuration() { return { provider: "anthropic", model: this.model || null, instructionReference: this.instructionReference, ready: !!(this.apiKey && this.model) }; }
  capabilities() { return { contentKinds: ["text", "image", "document"], maxRequestBytes: 32 * 1024 * 1024, mediaTypes: ["application/json", "text/html", "application/pdf", "image/png", "image/jpeg"] }; }
  async extract({ artifact, artifactInputs = [], contentItems = [], decodedText, requestedConcepts = [], context = {}, sourceMetadata = {} }) {
    if (!this.apiKey || !this.model) throw Object.assign(new Error("Live semantic interpretation requires ANTHROPIC_API_KEY and EVIDENCE_A3_ANTHROPIC_MODEL"), { code: "provider_not_configured" });
    if (typeof this.fetchImpl !== "function") throw Object.assign(new Error("Semantic provider transport is unavailable"), { code: "provider_unavailable" });
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const requested = requestedConcepts.map((item) => ({ concept: item.concept, description: item.description || item.concept }));
    const inputs = artifactInputs.length ? artifactInputs : [{ artifact, decodedText, sourceMetadata, order: 1 }];
    const items = contentItems.length ? contentItems : inputs.map((input) => ({ artifactId: input.artifact?.id, kind: "text", mediaType: input.artifact?.mediaType || "text/html", text: String(input.decodedText || ""), artifact: input.artifact, order: input.order, sourceMetadata: input.sourceMetadata || {} }));
    const instruction = [
      "Interpret only the verified preserved evidence supplied below.",
      "Return one JSON object with facts, requested_concept_outcomes, completeness, and support.",
      "Each facts item must contain concept, value, raw, requested, value_found, semantic_role, sampled, supporting_artifact_ids, support_locators, semanticAmbiguity, and ambiguous. semantic_role must be business_fact for a persistable semantic fact.",
      "The verified inputs are separate preserved Artifacts belonging to one Evidence Asset. Interpret them together where appropriate while preserving every Artifact boundary.",
      "supporting_artifact_ids must contain only the input Artifact IDs that directly support that fact. Use more than one ID only when the fact is jointly supported. Do not claim every run input supports every fact.",
      "support_locators must contain one or more entries for every supporting_artifact_id. Each entry must include artifact_id and a bounded excerpt or truthful visual description.",
      "For JSON include json_path when reliably known. For HTML include dom_reference when reliably known. For PDF include 1-indexed page_start and page_end plus excerpt or visual description. For an image include a support description or visible-text excerpt.",
      "Only include an image region when it is expressed in original_artifact_pixels and source_width/source_height exactly match the original dimensions in the input manifest. Never report coordinates from a resized provider view.",
      "Do not fabricate missing pages or source order. Do not represent unsupported cross-Artifact inference as a directly stated source fact.",
      "requested_concept_outcomes must contain one item per requested concept with concept and status of found, not_found, or not_evaluated.",
      "completeness must contain state=complete or incomplete, limitations as an array, and record counts where the evidence represents a collection.",
      "Use requested=true only when responding to one of the requested concepts. Use requested=false for additional facts found through open discovery.",
      ...SEMANTIC_DISCOVERY_OBJECTIVE,
      `Evidence input manifest: ${JSON.stringify(items.map((item) => ({ id: item.artifactId, order: item.order ?? null, mediaType: item.mediaType, representationType: item.artifact?.representationType, pageCount: item.media?.pageCount ?? null, width: item.media?.width ?? null, height: item.media?.height ?? null })))}`,
      `Requested concepts: ${JSON.stringify(requested)}`,
      `Lab extraction context: ${JSON.stringify(context)}`,
      `Source metadata: ${JSON.stringify(inputs.map((input) => input.sourceMetadata || {}))}`,
    ].join("\n\n");
    const content = [];
    for (const item of items) {
      content.push({ type: "text", text: `BEGIN VERIFIED ARTIFACT ${JSON.stringify({ id: item.artifactId, order: item.order ?? null, mediaType: item.mediaType })}` });
      if (item.kind === "image") content.push({ type: "image", source: { type: "base64", media_type: item.mediaType, data: Buffer.from(item.bytes).toString("base64") } });
      else if (item.kind === "document") content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: Buffer.from(item.bytes).toString("base64") } });
      else content.push({ type: "text", text: String(item.text || "") });
      content.push({ type: "text", text: `END VERIFIED ARTIFACT ${item.artifactId}` });
    }
    content.push({ type: "text", text: instruction });
    const requestContent = items.every((item) => item.kind === "text") ? content.map((item) => item.text).join("\n\n") : content;
    const requestBody = JSON.stringify({ model: this.model, max_tokens: this.maxOutputTokens, messages: [{ role: "user", content: requestContent }] });
    let response;
    try {
      response = await this.fetchImpl("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "content-type": "application/json", "x-api-key": this.apiKey, "anthropic-version": "2023-06-01" }, body: requestBody, signal: controller.signal });
    } catch (error) {
      if (error?.name === "AbortError") throw Object.assign(new Error("Semantic provider timed out"), { code: "provider_timeout" });
      throw Object.assign(new Error("Semantic provider request failed"), { code: "provider_unavailable" });
    } finally { clearTimeout(timer); }
    let payload;
    try { payload = await response.json(); } catch (_) { throw Object.assign(new Error("Semantic provider returned malformed output"), { code: "provider_malformed_output" }); }
    if (!response.ok) {
      const code = response.status === 401 || response.status === 403 ? "provider_authentication_failed" : "provider_failed";
      throw Object.assign(new Error(`Semantic provider failed with HTTP ${response.status}`), { code });
    }
    if (payload.stop_reason === "max_tokens") throw Object.assign(new Error(`Semantic provider output exceeded the ${this.maxOutputTokens}-token response allowance; no partial interpretation was persisted`), { code: "provider_output_truncated" });
    const text = (payload.content || []).filter((item) => item.type === "text").map((item) => item.text).join("\n");
    const parsed = parseProviderJson(text);
    if (!Array.isArray(parsed.facts)) throw Object.assign(new Error("Semantic provider response does not contain a facts array"), { code: "provider_malformed_output" });
    const requestByConcept = new Map(requestedConcepts.map((item) => [item.concept, item]));
    const facts = parsed.facts.filter((item) => item && item.concept && item.value !== undefined).map((item) => {
      const request = requestByConcept.get(item.concept); const isRequested = item.requested === true && !!request;
      return { concept: String(item.concept), value: item.value, raw: item.raw == null ? null : String(item.raw), requested: isRequested, schemaFieldId: isRequested ? request.schemaFieldId || null : null, informationNeedId: isRequested ? request.informationNeedId || null : null, valueFound: item.value_found === true, semanticRole: String(item.semantic_role || "unspecified"), sampled: item.sampled === true, supportingArtifactIds: Array.isArray(item.supporting_artifact_ids) ? item.supporting_artifact_ids.map(String) : [], supportLocators: Array.isArray(item.support_locators) ? item.support_locators : [], semanticAmbiguity: !!item.semanticAmbiguity, ambiguous: !!item.ambiguous };
    });
    const reportedOutcomes = new Map((Array.isArray(parsed.requested_concept_outcomes) ? parsed.requested_concept_outcomes : []).filter((item) => item?.concept).map((item) => [String(item.concept), String(item.status)]));
    const completeness = parsed.completeness && ["complete", "incomplete"].includes(parsed.completeness.state) ? { state: parsed.completeness.state, limitations: Array.isArray(parsed.completeness.limitations) ? parsed.completeness.limitations.map(String) : [], sourceRecordCount: Number.isInteger(parsed.completeness.source_record_count) ? parsed.completeness.source_record_count : null, representedRecordCount: Number.isInteger(parsed.completeness.represented_record_count) ? parsed.completeness.represented_record_count : null } : { state: "incomplete", limitations: ["Provider did not report extraction completeness"], sourceRecordCount: null, representedRecordCount: null };
    const requestedConceptOutcomes = requestedConcepts.map((request) => { const reported = reportedOutcomes.get(request.concept); const found = facts.some((fact) => fact.concept === request.concept && fact.valueFound && fact.semanticRole === "business_fact"); return { concept: request.concept, status: found ? "found" : reported === "not_found" ? "not_found" : completeness.state === "complete" ? "not_found" : "not_evaluated" }; });
    return { facts, requestedConceptOutcomes, completeness, support: parsed.support || null };
  }
}

module.exports = { AnthropicSemanticProvider, DEFAULT_MAX_OUTPUT_TOKENS, DEFAULT_PROVIDER_TIMEOUT_MS, FixtureSemanticProvider, SEMANTIC_DISCOVERY_OBJECTIVE, SemanticExtractionProvider, parseProviderJson };
