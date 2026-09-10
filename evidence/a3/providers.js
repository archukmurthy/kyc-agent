"use strict";

const { ANTHROPIC_EVIDENCE_OUTPUT_SCHEMA, ANTHROPIC_R4_INSTRUCTION_REFERENCE } = require("./anthropicOutputSchema");

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

function parsedJson(value, fallback) {
  if (typeof value !== "string") return fallback;
  try { return JSON.parse(value); } catch (_) { return value; }
}

function factValue(item) {
  if (item.value_json === undefined) return item.value;
  try { return JSON.parse(item.value_json); }
  catch (_) { throw Object.assign(new Error("Semantic provider returned an invalid encoded Fact value"), { code: "provider_malformed_output" }); }
}

function mapTypedRelationshipCandidate(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input || null;
  if (typeof input.subject_json === "string" && typeof input.object_json === "string") {
    const party = (prefix) => ({ partyType: input[`${prefix}_party_type`], ...parsedJson(input[`${prefix}_json`], {}) });
    const value = { kind: input.value_kind, measurementType: input.measurement_type, unit: input.unit || undefined };
    if (input.value_kind === "EXACT" && input.measurement_type === "count_of_total") { value.numerator = input.numerator; value.denominator = input.denominator; }
    else if (input.value_kind === "EXACT") value.value = input.exact_value;
    else if (input.value_kind === "RANGE") { value.lower = input.range_lower; value.upper = input.range_upper; value.lowerInclusive = input.lower_inclusive; value.upperInclusive = input.upper_inclusive; }
    else if (input.value_kind === "QUALITATIVE") value.value = input.qualitative_value;
    const temporalDetails = parsedJson(input.temporal_json, {});
    return {
      directionEstablished: input.direction_established, relationshipType: input.relationship_type,
      subject: party("subject"), object: party("object"), value,
      temporal: { state: input.temporal_state, effectiveFrom: temporalDetails.effective_from, effectiveTo: temporalDetails.effective_to, sourceEffectiveDate: temporalDetails.source_effective_date, precision: temporalDetails.precision || {} },
      sourceSpecificMetadata: parsedJson(input.source_specific_metadata_json, {}), qualifications: parsedJson(input.qualifications_json, []),
    };
  }
  if (input.present === false) return null;
  if (input.present === true) {
    const party = (prefix) => ({
      partyType: input[`${prefix}_party_type`], name: input[`${prefix}_name`], description: input[`${prefix}_description`],
      jurisdiction: input[`${prefix}_jurisdiction`], identifiers: parsedJson(input[`${prefix}_identifiers_json`], []),
      qualifiers: parsedJson(input[`${prefix}_qualifiers_json`], {}),
    });
    const value = { kind: input.value_kind, measurementType: input.measurement_type, unit: input.unit || undefined };
    if (input.value_kind === "EXACT" && input.measurement_type === "count_of_total") { value.numerator = input.numerator; value.denominator = input.denominator; }
    else if (input.value_kind === "EXACT") value.value = input.exact_value;
    else if (input.value_kind === "RANGE") { value.lower = input.range_lower; value.upper = input.range_upper; value.lowerInclusive = input.lower_inclusive; value.upperInclusive = input.upper_inclusive; }
    else if (input.value_kind === "QUALITATIVE") value.value = input.qualitative_value;
    return {
      directionEstablished: input.direction_established, relationshipType: input.relationship_type,
      subject: party("subject"), object: party("object"), value,
      temporal: { state: input.temporal_state, effectiveFrom: input.effective_from || undefined, effectiveTo: input.effective_to || undefined, sourceEffectiveDate: input.source_effective_date || undefined, precision: parsedJson(input.temporal_precision_json, {}) },
      sourceSpecificMetadata: parsedJson(input.source_specific_metadata_json, {}), qualifications: input.qualifications,
    };
  }
  const party = (source) => source && typeof source === "object" ? { partyType: source.party_type, name: source.name, description: source.description, jurisdiction: source.jurisdiction, identifiers: source.identifiers, qualifiers: source.qualifiers ?? parsedJson(source.qualifiers_json, {}) } : source;
  const sourceValue = input.value;
  let value = sourceValue;
  if (sourceValue && typeof sourceValue === "object") {
    value = { kind: sourceValue.kind, measurementType: sourceValue.measurement_type, unit: sourceValue.unit || undefined };
    if (sourceValue.kind === "EXACT" && sourceValue.measurement_type === "count_of_total") { value.numerator = sourceValue.numerator; value.denominator = sourceValue.denominator; }
    else if (sourceValue.kind === "EXACT") value.value = sourceValue.exact_value ?? sourceValue.value;
    else if (sourceValue.kind === "RANGE") { value.lower = sourceValue.range_lower ?? sourceValue.lower; value.upper = sourceValue.range_upper ?? sourceValue.upper; value.lowerInclusive = sourceValue.lower_inclusive; value.upperInclusive = sourceValue.upper_inclusive; }
    else if (sourceValue.kind === "QUALITATIVE") value.value = sourceValue.qualitative_value ?? sourceValue.value;
  }
  const temporalSource = input.temporal;
  const temporal = temporalSource && typeof temporalSource === "object" ? { state: temporalSource.state, effectiveFrom: temporalSource.effective_from || undefined, effectiveTo: temporalSource.effective_to || undefined, sourceEffectiveDate: temporalSource.source_effective_date || undefined, precision: temporalSource.precision ?? parsedJson(temporalSource.precision_json, {}) } : temporalSource;
  return { directionEstablished: input.direction_established, relationshipType: input.relationship_type, subject: party(input.subject), object: party(input.object), value, temporal, sourceSpecificMetadata: input.source_specific_metadata ?? parsedJson(input.source_specific_metadata_json, {}), qualifications: input.qualifications };
}

function mapSupportLocator(locator) {
  if (locator && typeof locator.locator_json === "string") {
    const details = parsedJson(locator.locator_json, {});
    return { artifact_id: locator.artifact_id, locator_type: locator.locator_type, ...details };
  }
  if (!locator || typeof locator !== "object" || !("region_present" in locator)) return locator;
  const region = locator.region_present === true && locator.coordinate_space === "original_artifact_pixels" ? {
    coordinate_space: locator.coordinate_space, source_width: locator.source_width, source_height: locator.source_height,
    x: locator.x, y: locator.y, width: locator.width, height: locator.height,
  } : null;
  return {
    artifact_id: locator.artifact_id, locator_type: locator.locator_type, json_path: locator.json_path,
    dom_reference: locator.dom_reference, page_start: locator.page_start, page_end: locator.page_end,
    excerpt: locator.excerpt, description: locator.description, region,
    locator_method: locator.locator_method, qualified: locator.qualified,
  };
}

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
  constructor({ apiKey, model, fetchImpl = global.fetch, timeoutMs = DEFAULT_PROVIDER_TIMEOUT_MS, maxOutputTokens = DEFAULT_MAX_OUTPUT_TOKENS, instructionReference = ANTHROPIC_R4_INSTRUCTION_REFERENCE } = {}) {
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
      "Return shallow indexed transport lists: facts, support_locators, and typed_relationships. value_json and supporting_artifact_ids_json are valid JSON encoded as strings. Each support or relationship row uses fact_index, the zero-based index of its Fact. Omit rows instead of inventing unsupported locators or relationships.",
      "Each facts item must contain concept, value_json, raw, requested, value_found, semantic_role, sampled, supporting_artifact_ids_json, semanticAmbiguity, and ambiguous. value_json preserves the Fact's natural scalar, array, or object shape. semantic_role must be business_fact for a persistable semantic fact.",
      "A typed_relationship is optional and must describe exactly the same single source assertion as its ordinary Fact. Never put several independent relationships in one typed relationship or relationship array; emit one Fact per directed relationship.",
      "Only return typed_relationship when the evidence explicitly supports both parties, the relationship meaning, and subject→relationship→object direction. If meaning or direction is ambiguous, omit typed_relationship while retaining the safe ordinary Fact.",
      "Each typed_relationships row must contain direction_established=true; source-supported subject_json and object_json party snapshots; value_kind and measurement_type; temporal_state and temporal_json; metadata; and qualifications_json. Parties require a source name or description and never become canonical identities.",
      "Allowed relationship_type values are ECONOMIC_OWNERSHIP, VOTING_RIGHTS, APPOINTMENT_RIGHTS, REMOVAL_RIGHTS, FORMAL_DECISION_RIGHTS, SIGNIFICANT_INFLUENCE_OR_CONTROL, DIRECTOR_OF, OFFICER_OF, AUTHORIZED_SIGNATORY_FOR, CONTROL_OVER, SETTLOR_OF, TRUSTEE_OF, PROTECTOR_OF, BENEFICIARY_OF, NOMINEE_FOR, ACTS_ON_BEHALF_OF, and OTHER. OTHER is only for an understood out-of-vocabulary relationship and must retain source_specific_metadata.originalRelationshipLabel. There is no unknown relationship code.",
      "typed_relationship.value uses kind EXACT, RANGE, QUALITATIVE, or UNKNOWN and measurement_type percentage, count_of_total, absolute_quantity, qualitative, or none. EXACT percentage uses exact_value in percentage points: 75% is 75, 25% is 25, and 100% is 100; never return 0.75, text, basis points, or 7500. RANGE uses range_lower/range_upper and inclusivity fields. QUALITATIVE uses qualitative_value containing the source-supported meaning, including a role title for DIRECTOR_OF or OFFICER_OF. Preserve exact bounds and inclusivity. Never convert a range to an exact value, qualitative wording to a number, or UNKNOWN to zero.",
      "typed_relationship.temporal.state must be current, ceased, historical, or unknown. Do not infer current solely because no cease date appears.",
      "Do not return UBO/controller status, threshold decisions, indirect ownership calculations, winner selection, KYC satisfaction, or other downstream conclusions as typed relationships.",
      "The verified inputs are separate preserved Artifacts belonging to one Evidence Asset. Interpret them together where appropriate while preserving every Artifact boundary.",
      "supporting_artifact_ids must contain only the input Artifact IDs that directly support that fact. Use more than one ID only when the fact is jointly supported. Do not claim every run input supports every fact.",
      "support_locators must contain one or more rows for every supporting Artifact. locator_json holds the media-specific JSON path, DOM reference, PDF page, excerpt/description and optional original-pixel image region. Never fabricate a region or coordinate transform.",
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
    const requestBody = JSON.stringify({ model: this.model, max_tokens: this.maxOutputTokens, messages: [{ role: "user", content: requestContent }], output_config: { format: { type: "json_schema", schema: ANTHROPIC_EVIDENCE_OUTPUT_SCHEMA } } });
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
    const shallowTransport = Array.isArray(parsed.support_locators) && Array.isArray(parsed.typed_relationships);
    const locatorsByFact = new Map(), relationshipsByFact = new Map();
    if (shallowTransport) {
      parsed.support_locators.forEach((locator) => { if (Number.isInteger(locator?.fact_index)) { const rows = locatorsByFact.get(locator.fact_index) || []; rows.push(mapSupportLocator(locator)); locatorsByFact.set(locator.fact_index, rows); } });
      parsed.typed_relationships.forEach((relationship) => { if (Number.isInteger(relationship?.fact_index) && !relationshipsByFact.has(relationship.fact_index)) relationshipsByFact.set(relationship.fact_index, mapTypedRelationshipCandidate(relationship)); });
    }
    const facts = parsed.facts.map((item, sourceIndex) => ({ item, sourceIndex })).filter(({ item }) => item && item.concept && (item.value_json !== undefined || item.value !== undefined)).map(({ item, sourceIndex }) => {
      const request = requestByConcept.get(item.concept); const isRequested = item.requested === true && !!request;
      const encodedSupportIds = item.supporting_artifact_ids_json === undefined ? item.supporting_artifact_ids : parsedJson(item.supporting_artifact_ids_json, []);
      return { concept: String(item.concept), value: factValue(item), raw: item.raw == null ? null : String(item.raw), requested: isRequested, schemaFieldId: isRequested ? request.schemaFieldId || null : null, informationNeedId: isRequested ? request.informationNeedId || null : null, valueFound: item.value_found === true, semanticRole: String(item.semantic_role || "unspecified"), sampled: item.sampled === true, supportingArtifactIds: Array.isArray(encodedSupportIds) ? encodedSupportIds.map(String) : Array.isArray(item.supporting_artifact_ids) ? item.supporting_artifact_ids.map(String) : [], supportLocators: shallowTransport ? locatorsByFact.get(sourceIndex) || [] : Array.isArray(item.support_locators) ? item.support_locators.map(mapSupportLocator) : [], semanticAmbiguity: !!item.semanticAmbiguity, ambiguous: !!item.ambiguous, typedRelationshipCandidate: shallowTransport ? relationshipsByFact.get(sourceIndex) || null : mapTypedRelationshipCandidate(item.typed_relationship) };
    });
    const reportedOutcomes = new Map((Array.isArray(parsed.requested_concept_outcomes) ? parsed.requested_concept_outcomes : []).filter((item) => item?.concept).map((item) => [String(item.concept), String(item.status)]));
    const completeness = parsed.completeness && ["complete", "incomplete"].includes(parsed.completeness.state) ? { state: parsed.completeness.state, limitations: Array.isArray(parsed.completeness.limitations) ? parsed.completeness.limitations.map(String) : [], sourceRecordCount: Number.isInteger(parsed.completeness.source_record_count) && parsed.completeness.source_record_count >= 0 ? parsed.completeness.source_record_count : null, representedRecordCount: Number.isInteger(parsed.completeness.represented_record_count) && parsed.completeness.represented_record_count >= 0 ? parsed.completeness.represented_record_count : null } : { state: "incomplete", limitations: ["Provider did not report extraction completeness"], sourceRecordCount: null, representedRecordCount: null };
    const requestedConceptOutcomes = requestedConcepts.map((request) => { const reported = reportedOutcomes.get(request.concept); const found = facts.some((fact) => fact.concept === request.concept && fact.valueFound && fact.semanticRole === "business_fact"); return { concept: request.concept, status: found ? "found" : reported === "not_found" ? "not_found" : completeness.state === "complete" ? "not_found" : "not_evaluated" }; });
    return { facts, requestedConceptOutcomes, completeness, support: parsed.support || null };
  }
}

module.exports = { ANTHROPIC_EVIDENCE_OUTPUT_SCHEMA, ANTHROPIC_R4_INSTRUCTION_REFERENCE, AnthropicSemanticProvider, DEFAULT_MAX_OUTPUT_TOKENS, DEFAULT_PROVIDER_TIMEOUT_MS, FixtureSemanticProvider, SEMANTIC_DISCOVERY_OBJECTIVE, SemanticExtractionProvider, mapTypedRelationshipCandidate, parseProviderJson };
