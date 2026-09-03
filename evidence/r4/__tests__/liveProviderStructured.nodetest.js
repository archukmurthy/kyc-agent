"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { runSemanticExtraction } = require("../../a3/extractor");
const { ANTHROPIC_R4_INSTRUCTION_REFERENCE, AnthropicSemanticProvider } = require("../../a3/providers");

const at = "2026-09-01T12:00:00.000Z";
const artifactId = "ownership-chart";

function typed({ relationshipType, subjectName, objectName = "Better Holdco", kind, measurementType, exactValue = 0, qualitativeValue = "", subjectPartyType = "natural_person" }) {
  return {
    direction_established: true, relationship_type: relationshipType,
    subject_party_type: subjectPartyType, subject_json: JSON.stringify({ name: subjectName, jurisdiction: "GB", identifiers: [], qualifiers: {} }),
    object_party_type: "legal_entity", object_json: JSON.stringify({ name: objectName, jurisdiction: "GB", identifiers: [], qualifiers: {} }),
    value_kind: kind, measurement_type: measurementType, exact_value: exactValue, range_lower: 0, range_upper: 0,
    lower_inclusive: false, upper_inclusive: false, numerator: 0, denominator: 0, qualitative_value: qualitativeValue, unit: "",
    temporal_state: "unknown", temporal_json: "{}", source_specific_metadata_json: "{}", qualifications_json: "[]",
  };
}

function noRelationship() {
  return null;
}

function fact({ concept, factValue, raw = factValue, relationship = noRelationship(), locator = null }) {
  return {
    concept, value_json: JSON.stringify(factValue), raw, requested: false, value_found: true,
    semantic_role: "business_fact", sampled: false, supporting_artifact_ids: [artifactId],
    support_locators: [locator || { artifact_id: artifactId, locator_type: "image", json_path: "", dom_reference: "", page_start: 0, page_end: 0, excerpt: "", description: raw, region: null, locator_method: "provider_structured", qualified: false }],
    semanticAmbiguity: false, ambiguous: false, typed_relationship: relationship,
  };
}

function response(facts) {
  const factRows = facts.map(({ supporting_artifact_ids: supportIds, support_locators: _locators, typed_relationship: _relationship, ...item }) => ({ ...item, supporting_artifact_ids_json: JSON.stringify(supportIds) }));
  const supportLocators = facts.flatMap((item, factIndex) => item.support_locators.map(({ artifact_id, locator_type, ...details }) => ({ fact_index: factIndex, artifact_id, locator_type, locator_json: JSON.stringify(details) })));
  const typedRelationships = facts.flatMap((item, factIndex) => item.typed_relationship ? [{ fact_index: factIndex, ...item.typed_relationship }] : []);
  const output = { facts: factRows, support_locators: supportLocators, typed_relationships: typedRelationships, requested_concept_outcomes: [], completeness: { state: "complete", limitations: [], source_record_count: -1, represented_record_count: -1 }, support: { state: "supported", limitations: [] } };
  return { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(output) }] };
}

function providerFor(facts, requestCapture = null) {
  return new AnthropicSemanticProvider({ apiKey: "fixture-key", model: "claude-sonnet-4-5", fetchImpl: async (_url, options) => { if (requestCapture) requestCapture(JSON.parse(options.body)); return { ok: true, status: 200, json: async () => response(facts) }; } });
}

async function extract(facts, contentItem = { artifactId, kind: "image", mediaType: "image/png", media: { width: 841, height: 595 } }, requestCapture = null) {
  const provider = providerFor(facts, requestCapture); let sequence = 0;
  const providerInput = contentItem.kind === "text" ? { ...contentItem, text: contentItem.text || "fixture source" } : { ...contentItem, bytes: contentItem.bytes || Buffer.from("fixture source") };
  return runSemanticExtraction(provider, { artifactInputs: [{ artifact: { id: artifactId, mediaType: contentItem.mediaType } }], contentItems: [providerInput], requestedConcepts: [], runId: "run", artifactId, createdAt: at, instructionReference: provider.configuration().instructionReference, idFor: () => `fact-${++sequence}` });
}

test("structured live contract validates 75, 25 and 100 percentage-point ownership plus director/officer roles", async () => {
  const facts = [
    fact({ concept: "mitchell_ownership", factValue: "Mitchell Fortescue owns 75% of Better Holdco", relationship: typed({ relationshipType: "ECONOMIC_OWNERSHIP", subjectName: "Mitchell Fortescue", kind: "EXACT", measurementType: "percentage", exactValue: 75 }) }),
    fact({ concept: "lee_ownership", factValue: "Lee Taylor owns 25% of Better Holdco", relationship: typed({ relationshipType: "ECONOMIC_OWNERSHIP", subjectName: "Lee Taylor", kind: "EXACT", measurementType: "percentage", exactValue: 25 }) }),
    fact({ concept: "holdco_ownership", factValue: "Better Holdco owns 100% of Better Comms", relationship: typed({ relationshipType: "ECONOMIC_OWNERSHIP", subjectName: "Better Holdco", objectName: "Better Comms", kind: "EXACT", measurementType: "percentage", exactValue: 100, subjectPartyType: "legal_entity" }) }),
    fact({ concept: "mitchell_director", factValue: "Mitchell Fortescue is Managing Director of Better Holdco", relationship: typed({ relationshipType: "DIRECTOR_OF", subjectName: "Mitchell Fortescue", kind: "QUALITATIVE", measurementType: "qualitative", qualitativeValue: "Managing Director" }) }),
    fact({ concept: "lee_officer", factValue: "Lee Taylor is Commercial Director of Better Holdco", relationship: typed({ relationshipType: "OFFICER_OF", subjectName: "Lee Taylor", kind: "QUALITATIVE", measurementType: "qualitative", qualitativeValue: "Commercial Director" }) }),
  ];
  let requestBody; const result = await extract(facts, undefined, (body) => { requestBody = body; });
  assert.equal(result.typedRelationshipCandidateCount, 5); assert.equal(result.typedRelationshipValidatedCount, 5);
  assert.deepEqual(result.facts.slice(0, 3).map((item) => item.typedRelationship.exactValue), [75, 25, 100]);
  assert.deepEqual(result.facts.slice(3).map((item) => item.typedRelationship.qualitativeValue), ["Managing Director", "Commercial Director"]);
  assert.equal(result.facts[0].supportLocators[0].supportDescription.includes("75%"), true);
  assert.equal(requestBody.output_config.format.type, "json_schema"); assert.equal(requestBody.output_config.format.schema.additionalProperties, false);
  assert.equal(JSON.stringify(requestBody).includes('"citations"'), false); assert.equal(providerFor([]).configuration().instructionReference, ANTHROPIC_R4_INSTRUCTION_REFERENCE);
  assert.equal(ANTHROPIC_R4_INSTRUCTION_REFERENCE, "evidence-r4-live-v4-typed-relations-shallow");
  assert.match(requestBody.messages[0].content.at(-1).text, /75% is 75/); assert.match(requestBody.messages[0].content.at(-1).text, /QUALITATIVE uses qualitative_value/);
});

test("semantically invalid structured candidates are rejected while their ordinary Facts survive", async () => {
  const result = await extract([
    fact({ concept: "invalid_percentage", factValue: "Alice owns 101%", relationship: typed({ relationshipType: "ECONOMIC_OWNERSHIP", subjectName: "Alice", kind: "EXACT", measurementType: "percentage", exactValue: 101 }) }),
    fact({ concept: "missing_role", factValue: "Alice is a director of HoldCo", relationship: typed({ relationshipType: "DIRECTOR_OF", subjectName: "Alice", kind: "QUALITATIVE", measurementType: "qualitative", qualitativeValue: "" }) }),
  ]);
  assert.equal(result.facts.length, 2); assert.deepEqual(result.facts.map((item) => item.factValue), ["Alice owns 101%", "Alice is a director of HoldCo"]);
  assert.equal(result.typedRelationshipCandidateCount, 2); assert.equal(result.typedRelationshipValidatedCount, 0);
  assert.match(result.typedRelationshipLimitations[0], /percentage must be between 0 and 100/); assert.match(result.typedRelationshipLimitations[1], /value\.value is required/);
});

test("structured provider path preserves valid JSON, HTML, PDF and image R3 locators", async () => {
  const cases = [
    { kind: "text", mediaType: "application/json", media: {}, locator: { locator_type: "json", json_path: "/owners/0", dom_reference: "", page_start: 0, page_end: 0, excerpt: "Alice owns 75%", description: "", region: null }, expected: "json" },
    { kind: "text", mediaType: "text/html", media: {}, locator: { locator_type: "html", json_path: "", dom_reference: "#owner", page_start: 0, page_end: 0, excerpt: "Alice owns 75%", description: "", region: null }, expected: "html" },
    { kind: "document", mediaType: "application/pdf", media: { pageCount: 2 }, locator: { locator_type: "pdf", json_path: "", dom_reference: "", page_start: 2, page_end: 2, excerpt: "Alice owns 75%", description: "", region: null }, expected: "pdf" },
    { kind: "image", mediaType: "image/png", media: { width: 841, height: 595 }, locator: { locator_type: "image", json_path: "", dom_reference: "", page_start: 0, page_end: 0, excerpt: "", description: "Ownership line", region: { coordinate_space: "original_artifact_pixels", source_width: 841, source_height: 595, x: 10, y: 10, width: 100, height: 50 } }, expected: "image" },
  ];
  for (const item of cases) {
    const locator = { artifact_id: artifactId, locator_method: "provider_structured", qualified: false, ...item.locator };
    const result = await extract([fact({ concept: `${item.expected}_fact`, factValue: "Alice owns 75%", locator })], { artifactId, kind: item.kind, mediaType: item.mediaType, media: item.media });
    assert.equal(result.facts[0].supportLocators[0].locatorKind, item.expected);
    assert.equal(result.typedRelationshipCandidateCount, 0);
  }
});

test("every object in the Anthropic output schema is closed and the typed value shape is explicit", () => {
  let requestBody; const provider = providerFor([], (body) => { requestBody = body; });
  return provider.extract({ decodedText: "{}", requestedConcepts: [] }).then(() => {
    const schema = requestBody.output_config.format.schema; const stack = [schema];
    while (stack.length) { const node = stack.pop(); if (!node || typeof node !== "object") continue; if (node.type === "object") assert.equal(node.additionalProperties, false); for (const child of Object.values(node)) if (child && typeof child === "object") stack.push(child); }
    const factSchema = schema.properties.facts.items; assert.ok(factSchema.required.includes("value_json")); assert.ok(factSchema.required.includes("supporting_artifact_ids_json"));
    const relationshipSchema = schema.properties.typed_relationships.items;
    assert.ok(relationshipSchema.required.includes("exact_value")); assert.ok(relationshipSchema.required.includes("qualitative_value"));
    let unions = 0, maxDepth = 0, propertyCount = 0; const nodes = [[schema, 0]];
    while (nodes.length) { const [node, depth] = nodes.pop(); if (!node || typeof node !== "object") continue; maxDepth = Math.max(maxDepth, depth); if (node.type === "object") propertyCount += Object.keys(node.properties || {}).length; if (node.anyOf || Array.isArray(node.type)) unions += 1; for (const child of Object.values(node)) if (child && typeof child === "object") nodes.push([child, depth + 1]); }
    assert.equal(unions, 0); assert.ok(maxDepth <= 6, `schema nesting ${maxDepth} exceeds bounded adapter budget`); assert.ok(propertyCount <= 50, `schema property count ${propertyCount} exceeds bounded adapter budget`);
  });
});
