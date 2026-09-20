"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { AnthropicSemanticProvider, DEFAULT_MAX_OUTPUT_TOKENS, DEFAULT_PROVIDER_TIMEOUT_MS, FixtureSemanticProvider, SemanticExtractionProvider, mapTypedRelationshipCandidate, normalizeRelationshipUnit } = require("../providers");
const { runIndependentVerification, runSemanticExtraction, supportState } = require("../extractor");
const { DeterministicProfileDiscoveryProvider, PROFILE_DISCOVERY_SOURCE } = require("./profileDiscoveryFixture");

test("semantic provider maps different source wording and discovers an unrequested fact", async () => {
  const result = await runSemanticExtraction(new FixtureSemanticProvider(), { content: "Registered name: ABC Limited\nFormerly ABC Technology Limited.", requestedConcepts: [{ concept: "business_name", schemaFieldId: "business_name", informationNeedId: "need-1" }], runId: "run-1", artifactId: "artifact-1", createdAt: "2026-08-03T10:00:00.000Z", idFor: (item) => item.requested ? "requested" : "discovered" });
  assert.equal(result.facts[0].factValue, "ABC Limited");
  assert.equal(result.facts[0].rawRepresentation.startsWith("Registered name"), true);
  assert.equal(result.facts[1].requestStatus, "discovered");
  assert.equal(result.facts[1].schemaFieldId, null);
});

test("provider boundary is substitutable and does not contain domain persistence", async () => {
  const provider = new SemanticExtractionProvider();
  await assert.rejects(() => provider.extract({}), /must be implemented/);
  assert.equal(Object.prototype.hasOwnProperty.call(provider, "model"), false);
});

test("explicit percentage-unit aliases normalize before Evidence validation and retain their original representation", () => {
  for (const alias of ["%", "percent", "percentage", "percentage points"]) {
    const normalized = normalizeRelationshipUnit("percentage", alias);
    assert.equal(normalized.unit, "percentage_points");
    assert.equal(normalized.normalization.originalUnit, alias);
  }
  const relationship = mapTypedRelationshipCandidate({
    fact_index: 0,
    direction_established: true,
    relationship_type: "ECONOMIC_OWNERSHIP",
    subject_party_type: "natural_person",
    subject_json: JSON.stringify({ name: "Alice Morgan" }),
    object_party_type: "legal_entity",
    object_json: JSON.stringify({ name: "Vodafone Limited" }),
    value_kind: "EXACT",
    measurement_type: "percentage",
    exact_value: 30,
    unit: "%",
    temporal_state: "current",
    temporal_json: "{}",
    source_specific_metadata_json: "{}",
    qualifications_json: "[]",
  });
  assert.equal(relationship.value.unit, "percentage_points");
  assert.deepEqual(relationship.sourceSpecificMetadata.valueUnitNormalization, {
    kind: "EXPLICIT_PERCENTAGE_UNIT_ALIAS",
    originalUnit: "%",
    canonicalUnit: "percentage_points",
  });
});

test("blank, ambiguous and non-percentage units are never guessed into percentage points", () => {
  assert.equal(normalizeRelationshipUnit("percentage", "").unit, undefined);
  assert.equal(normalizeRelationshipUnit("percentage", "shares").unit, "shares");
  assert.equal(normalizeRelationshipUnit("absolute_quantity", "%").unit, "%");
});

test("independent verification provider is not anchored on the proposed answer", async () => {
  let received;
  const provider = { async extract(input) { received = input; return { facts: [] }; } };
  await runIndependentVerification(provider, { content: "Address: 25 King Street", requestedConcepts: [{ concept: "registered_address" }], extractionContext: { purpose: "verification" }, proposedValue: "28 King Street", runId: "run", artifactId: "artifact", createdAt: "now", idFor: () => "fact" });
  assert.equal(received.content, "Address: 25 King Street");
  assert.equal(Object.prototype.hasOwnProperty.call(received, "proposedValue"), false);
});

test("support is signal-derived rather than source-tier-derived", () => {
  assert.equal(supportState({ readability: "clear", grounding: "direct" }), "supported");
  assert.equal(supportState({ readability: "degraded", grounding: "direct" }), "needs_verification");
  assert.equal(supportState({ readability: "clear", grounding: "derived" }), "supported_with_qualification");
  assert.equal(supportState({ readability: "unreadable" }), "not_supported");
});

test("provider facts preserve zero and false while normalizing only PostgreSQL-invalid Unicode", async () => {
  let sequence = 0;
  const provider = { async extract() { return { facts: [
    { concept: "active_psc_count", value: 0, raw: "0", requested: false, valueFound: true, semanticRole: "business_fact", sampled: false },
    { concept: `psc\u0000statement`, value: { active: false, note: `none\uD800` }, raw: `none\u0000`, requested: false, valueFound: true, semanticRole: "business_fact", sampled: false },
  ] }; } };
  const result = await runSemanticExtraction(provider, { content: "{}", requestedConcepts: [], runId: "run", artifactId: "artifact", createdAt: "now", idFor: () => `fact-${++sequence}` });
  assert.equal(result.facts[0].factValue, 0); assert.equal(result.facts[0].supportSignals.providerOutputUnicodeNormalized, false);
  assert.equal(result.facts[1].semanticConceptId, "psc\uFFFDstatement"); assert.deepEqual(result.facts[1].factValue, { active: false, note: "none\uFFFD" });
  assert.equal(result.facts[1].rawRepresentation, "none\uFFFD"); assert.equal(result.facts[1].supportSignals.providerOutputUnicodeNormalized, true);
});

test("provider items with null or absent values are not persisted as facts", async () => {
  let sequence = 0;
  const provider = { async extract() { return { facts: [
    { concept: "active_count", value: 0, raw: "0", requested: false, valueFound: true, semanticRole: "business_fact", sampled: false },
    { concept: "ceased_count", value: null, raw: "not supplied", requested: false, valueFound: false, semanticRole: "business_fact", sampled: false },
    { concept: "missing_count", raw: "not supplied", requested: false, valueFound: false, semanticRole: "business_fact", sampled: false },
    { concept: "has_active_officers", value: false, raw: "false", requested: false, valueFound: true, semanticRole: "business_fact", sampled: false },
  ] }; } };
  const result = await runSemanticExtraction(provider, { content: "{}", requestedConcepts: [], runId: "run", artifactId: "artifact", createdAt: "now", idFor: () => `fact-${++sequence}` });
  assert.equal(result.providerReturnedFactCount, 4); assert.equal(result.discardedNoValueFactCount, 2); assert.deepEqual(result.facts.map((fact) => fact.factValue), [0, false]);
});

test("real semantic adapter preserves neutral input and non-secret lineage configuration", async () => {
  let request;
  const adapter = new AnthropicSemanticProvider({ apiKey: "test-secret", model: "configured-model", fetchImpl: async (_url, options) => { request = JSON.parse(options.body); return { ok: true, status: 200, async json() { return { content: [{ type: "text", text: JSON.stringify({ facts: [{ concept: "business_name", value: "REAL LIMITED", raw: "Registered name: REAL LIMITED", requested: true, value_found: true, semantic_role: "business_fact", sampled: false, semanticAmbiguity: false, ambiguous: false }], requested_concept_outcomes: [{ concept: "business_name", status: "found" }], completeness: { state: "complete", limitations: [] }, support: { state: "supported" } }) }] }; } }; } });
  const result = await adapter.extract({ artifact: { id: "artifact", mediaType: "text/html", representationType: "rendered_html" }, decodedText: "Registered name: REAL LIMITED", requestedConcepts: [{ concept: "business_name", schemaFieldId: "business_name" }], context: { contextSource: "standalone_evidence_lab_default" }, sourceMetadata: { producer: "any-producer" } });
  assert.equal(result.facts[0].schemaFieldId, "business_name"); assert.equal(adapter.configuration().model, "configured-model");
  assert.equal(JSON.stringify(request).includes("test-secret"), false); assert.equal(JSON.stringify(request).includes("any-producer"), true);
  const instruction = request.messages[0].content;
  assert.equal(request.max_tokens, DEFAULT_MAX_OUTPUT_TOKENS); assert.equal(DEFAULT_PROVIDER_TIMEOUT_MS, 120000);
  assert.match(instruction, /REQUESTED EXTRACTION: Extract every source-supported fact/);
  assert.match(instruction, /OPEN KYC\/KYB DISCOVERY: Independently inspect the complete supplied evidence/);
  assert.match(instruction, /must not be omitted merely because it was not requested/);
  assert.match(instruction, /historical or former names/); assert.match(instruction, /classification codes/); assert.match(instruction, /ownership and control/); assert.match(instruction, /officers and roles/);
  assert.match(instruction, /Exclude technical or transport metadata/); assert.match(instruction, /Do not invent or silently add an industry or activity description/);
  assert.match(instruction, /For repeated source records, use a meaningful fact whose value is an array/);
  assert.match(instruction, /Absence is not a business value/); assert.match(instruction, /Never sample, truncate/); assert.match(instruction, /Provenance and navigation already supplied by Evidence are not business facts/);
});

test("semantic adapter preserves multi-Artifact boundaries and provider-declared support", async () => {
  let request; const adapter = new AnthropicSemanticProvider({ apiKey: "test-secret", model: "configured-model", fetchImpl: async (_url, options) => { request = JSON.parse(options.body); return { ok: true, status: 200, async json() { return { content: [{ type: "text", text: JSON.stringify({ facts: [{ concept: "officer_count", value: 2, raw: "two officers", requested: false, value_found: true, semantic_role: "business_fact", sampled: false, supporting_artifact_ids: ["page-1", "page-2"] }], requested_concept_outcomes: [], completeness: { state: "complete", limitations: [] } }) }] }; } }; } });
  const result = await adapter.extract({ artifactInputs: [{ artifact: { id: "page-1", mediaType: "text/html", representationType: "rendered_html" }, decodedText: "first page", order: 1 }, { artifact: { id: "page-2", mediaType: "text/html", representationType: "rendered_html" }, decodedText: "second page", order: 2 }], requestedConcepts: [] });
  assert.deepEqual(result.facts[0].supportingArtifactIds, ["page-1", "page-2"]); const prompt = request.messages[0].content; assert.match(prompt, /BEGIN VERIFIED ARTIFACT.*page-1/); assert.match(prompt, /END VERIFIED ARTIFACT page-1/); assert.match(prompt, /BEGIN VERIFIED ARTIFACT.*page-2/); assert.match(prompt, /Do not claim every run input supports every fact/);
});

test("generic fact boundary excludes absence, provenance, and samples without losing legitimate empty collections", async () => {
  let sequence = 0;
  const provider = { async extract() { return { facts: [
    { concept: "registered_address", value: "Not provided", raw: "not provided", requested: true, valueFound: true, semanticRole: "business_fact", sampled: false },
    { concept: "source_url", value: "https://example.test", raw: "url", requested: false, valueFound: true, semanticRole: "business_fact", sampled: false },
    { concept: "officers_sample", value: [{ name: "A" }], raw: "first only", requested: false, valueFound: true, semanticRole: "business_fact", sampled: false },
    { concept: "active_restrictions", value: [], raw: "[]", requested: false, valueFound: true, semanticRole: "business_fact", sampled: false },
    { concept: "previous_company_names", value: ["OLD LIMITED"], raw: "previous names", requested: false, valueFound: true, semanticRole: "business_fact", sampled: false },
  ], requestedConceptOutcomes: [{ concept: "registered_address", status: "not_found" }], completeness: { state: "complete", limitations: [] } }; } };
  const result = await runSemanticExtraction(provider, { content: "{}", requestedConcepts: [{ concept: "registered_address" }], runId: "run", artifactId: "artifact", createdAt: "now", idFor: () => `fact-${++sequence}` });
  assert.deepEqual(result.facts.map((fact) => [fact.semanticConceptId, fact.factValue]), [["active_restrictions", []], ["previous_company_names", ["OLD LIMITED"]]]);
  assert.equal(result.discardedNoValueFactCount, 1); assert.equal(result.discardedProvenanceFactCount, 1); assert.equal(result.discardedSampledFactCount, 1);
  assert.equal(result.completeness.state, "incomplete"); assert.match(result.completeness.limitations[0], /sampled or truncated/);
  assert.deepEqual(result.requestedConceptOutcomes, [{ concept: "registered_address", status: "not_found" }]);
});

test("deterministic Profile evaluation covers requested extraction and open discovery without technical metadata or fabricated derivation", async () => {
  const provider = new DeterministicProfileDiscoveryProvider(); let sequence = 0;
  const result = await runSemanticExtraction(provider, { decodedText: JSON.stringify(PROFILE_DISCOVERY_SOURCE), requestedConcepts: [{ concept: "business_name", schemaFieldId: "business_name" }, { concept: "registered_address", schemaFieldId: "registered_address_line1" }], runId: "profile-run", artifactId: "profile-artifact", createdAt: "2026-08-19T12:00:00.000Z", idFor: () => `fact-${++sequence}` });
  assert.equal(provider.calls, 1); assert.equal(result.facts.filter((fact) => fact.requestStatus === "requested").length, 2);
  const discovered = result.facts.filter((fact) => fact.requestStatus === "discovered"); const concepts = discovered.map((fact) => fact.semanticConceptId);
  assert.ok(concepts.includes("previous_company_names")); assert.ok(concepts.includes("sic_codes")); assert.ok(concepts.includes("registration_number")); assert.ok(concepts.includes("company_status"));
  assert.equal(concepts.includes("etag"), false); assert.equal(concepts.includes("links"), false); assert.equal(concepts.includes("industry_description"), false);
  const sic = discovered.find((fact) => fact.semanticConceptId === "sic_codes"); assert.deepEqual(sic.factValue, ["47110"]); assert.equal(sic.groundingType, "direct");
});

test("real semantic adapter reports authentication and malformed output truthfully", async (t) => {
  await t.test("authentication", async () => { const adapter = new AnthropicSemanticProvider({ apiKey: "x", model: "m", fetchImpl: async () => ({ ok: false, status: 401, async json() { return {}; } }) }); await assert.rejects(() => adapter.extract({ decodedText: "x" }), (e) => e.code === "provider_authentication_failed"); });
  await t.test("malformed", async () => { const adapter = new AnthropicSemanticProvider({ apiKey: "x", model: "m", fetchImpl: async () => ({ ok: true, status: 200, async json() { return { content: [{ type: "text", text: "not json" }] }; } }) }); await assert.rejects(() => adapter.extract({ decodedText: "x" }), (e) => e.code === "provider_malformed_output"); });
  await t.test("output truncation", async () => { const adapter = new AnthropicSemanticProvider({ apiKey: "x", model: "m", maxOutputTokens: 4000, fetchImpl: async () => ({ ok: true, status: 200, async json() { return { stop_reason: "max_tokens", content: [{ type: "text", text: '{"facts":[' }] }; } }) }); await assert.rejects(() => adapter.extract({ decodedText: "x" }), (e) => e.code === "provider_output_truncated" && /4000-token/.test(e.message)); });
  await t.test("timeout", async () => { const adapter = new AnthropicSemanticProvider({ apiKey: "x", model: "m", timeoutMs: 5, fetchImpl: async (_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })))) }); await assert.rejects(() => adapter.extract({ decodedText: "x" }), (e) => e.code === "provider_timeout"); });
});
