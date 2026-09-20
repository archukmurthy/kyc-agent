"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { runSemanticExtraction } = require("../../a3/extractor");
const { AnthropicSemanticProvider, mapTypedRelationshipCandidate } = require("../../a3/providers");
const { EvidenceInterpretationHistoryService } = require("../../a3/historyService");
const { publicFact } = require("../../r2/service");
const { RELATIONSHIP_SCHEMA_VERSION, validateTypedRelationshipCandidate, validateTypedRelationshipLineage } = require("../domain");
const { mapCompaniesHousePscNatureOfControl, mappingsForCode } = require("../pscMapper");

const subject = { partyType: "natural_person", name: "Alice Example", jurisdiction: "GB", identifiers: [{ scheme: "source-record", value: "person-1" }] };
const object = { partyType: "legal_entity", name: "HoldCo Ltd", jurisdiction: "GB", identifiers: [{ scheme: "companies_house", value: "12345678", jurisdiction: "GB" }] };
const at = "2026-09-01T12:00:00.000Z";
function candidate(overrides = {}) { return { directionEstablished: true, relationshipType: "ECONOMIC_OWNERSHIP", subject, object, value: { kind: "EXACT", measurementType: "percentage", value: 70 }, temporal: { state: "unknown" }, sourceSpecificMetadata: {}, qualifications: [], ...overrides }; }
function validate(input, factId = "fact-1", context = {}) { return validateTypedRelationshipCandidate(input, { factId, mappingMethod: "provider_structured", mapperId: "fixture-provider-validator", mapperVersion: "1", mapperReference: "r4-test", createdAt: at, ...context }); }
function supportFor(factId, artifactId = "artifact-1") { return { supports: [{ factId, artifactId, createdAt: at }], locators: [{ id: `locator-${factId}`, factId, artifactId, locatorOrdinal: 1, locatorKind: "image", supportDescription: "The ownership line is visible", createdAt: at }] }; }

test("natural person to legal entity exact 70 percent ownership is one validated Fact extension", () => {
  const checked = validate(candidate());
  assert.equal(checked.limitations.length, 0); assert.equal(checked.relationship.relationshipSchemaVersion, RELATIONSHIP_SCHEMA_VERSION);
  assert.equal(checked.relationship.relationshipType, "ECONOMIC_OWNERSHIP"); assert.equal(checked.relationship.exactValue, 70);
  assert.equal(checked.relationship.subjectSnapshot.name, "Alice Example"); assert.equal(checked.relationship.objectSnapshot.name, "HoldCo Ltd");
  const lineage = supportFor("fact-1");
  assert.doesNotThrow(() => validateTypedRelationshipLineage({ facts: [{ id: "fact-1" }], typedRelationships: [checked.relationship], factArtifactSupports: lineage.supports, factArtifactLocators: lineage.locators }));
  assert.throws(() => validateTypedRelationshipLineage({ facts: [{ id: "fact-1" }], typedRelationships: [checked.relationship, checked.relationship], factArtifactSupports: lineage.supports, factArtifactLocators: lineage.locators }), /more than one/);
});

test("party snapshots support company-to-company and trust relationships without canonical identity merging", () => {
  const legalOwner = validate(candidate({ subject: { partyType: "legal_entity", name: "Parent Ltd", identifiers: [{ scheme: "companies_house", value: "87654321" }] } }), "fact-legal").relationship;
  const trustOwner = validate(candidate({ subject: { partyType: "trust_or_legal_arrangement", name: "Example Family Trust" }, value: { kind: "UNKNOWN", measurementType: "percentage" } }), "fact-trust").relationship;
  assert.equal(legalOwner.subjectPartyType, "legal_entity"); assert.equal(trustOwner.subjectPartyType, "trust_or_legal_arrangement"); assert.equal(trustOwner.exactValue, null);
  assert.notEqual(legalOwner.subjectSnapshot, trustOwner.subjectSnapshot); assert.equal("canonicalEntityId" in legalOwner.subjectSnapshot, false);
});

test("range, unknown, qualitative and count-of-total values preserve their distinct shapes", () => {
  const range = validate(candidate({ value: { kind: "RANGE", measurementType: "percentage", lower: 25, lowerInclusive: false, upper: 50, upperInclusive: true } }), "range").relationship;
  assert.deepEqual([range.rangeLower, range.lowerInclusive, range.rangeUpper, range.upperInclusive], [25, false, 50, true]); assert.equal(range.exactValue, null);
  const unknown = validate(candidate({ value: { kind: "UNKNOWN", measurementType: "percentage" } }), "unknown").relationship;
  assert.equal(unknown.exactValue, null); assert.equal(unknown.rangeLower, null);
  const qualitative = validate(candidate({ relationshipType: "VOTING_RIGHTS", value: { kind: "QUALITATIVE", measurementType: "qualitative", value: "majority voting rights" } }), "qualitative").relationship;
  assert.equal(qualitative.qualitativeValue, "majority voting rights"); assert.equal(qualitative.relationshipType, "VOTING_RIGHTS");
  const count = validate(candidate({ relationshipType: "APPOINTMENT_RIGHTS", value: { kind: "EXACT", measurementType: "count_of_total", numerator: 3, denominator: 5 } }), "count").relationship;
  assert.deepEqual([count.numerator, count.denominator], [3, 5]);
});

test("deterministic value validation rejects fake percentages, collapsed ranges and inconsistent counts", () => {
  assert.equal(validate(candidate({ value: { kind: "EXACT", measurementType: "percentage", value: 101 } })).relationship, null);
  assert.equal(validate(candidate({ value: { kind: "RANGE", measurementType: "percentage", lower: 50, lowerInclusive: false, upper: 25, upperInclusive: true } })).relationship, null);
  assert.equal(validate(candidate({ value: { kind: "EXACT", measurementType: "count_of_total", numerator: 6, denominator: 5 } })).relationship, null);
  assert.equal(validate(candidate({ value: { kind: "UNKNOWN", measurementType: "percentage", value: 0 } })).relationship, null);
});

test("initial controlled vocabulary covers rights, roles, control and trust assertions without a generic unknown relationship", () => {
  const types = ["VOTING_RIGHTS", "REMOVAL_RIGHTS", "SIGNIFICANT_INFLUENCE_OR_CONTROL", "NOMINEE_FOR", "ACTS_ON_BEHALF_OF", "DIRECTOR_OF", "OFFICER_OF", "AUTHORIZED_SIGNATORY_FOR", "CONTROL_OVER", "SETTLOR_OF", "TRUSTEE_OF", "PROTECTOR_OF", "BENEFICIARY_OF"];
  for (const [index, relationshipType] of types.entries()) {
    const checked = validate(candidate({ relationshipType, value: { kind: "UNKNOWN", measurementType: "none" } }), `vocabulary-${index}`);
    assert.ok(checked.relationship, relationshipType);
  }
  assert.equal(validate(candidate({ relationshipType: "UNKNOWN_RELATIONSHIP" })).relationship, null);
  assert.equal(validate(candidate({ relationshipType: "OTHER" })).relationship, null);
  assert.ok(validate(candidate({ relationshipType: "OTHER", sourceSpecificMetadata: { originalRelationshipLabel: "distribution controller" } })).relationship);
});

test("direction ambiguity creates no typed relationship while the ordinary Fact survives", async () => {
  const provider = { extract: async () => ({ facts: [{ concept: "ownership_statement", value: "Alice and HoldCo are linked", raw: "Alice ↔ HoldCo", requested: false, valueFound: true, semanticRole: "business_fact", sampled: false, supportingArtifactIds: ["artifact-1"], supportLocators: [{ artifact_id: "artifact-1", description: "A line connects Alice and HoldCo" }], typedRelationshipCandidate: candidate({ directionEstablished: false }) }], requestedConceptOutcomes: [], completeness: { state: "complete", limitations: [] } }) };
  const result = await runSemanticExtraction(provider, { artifactInputs: [{ artifact: { id: "artifact-1" } }], contentItems: [{ artifactId: "artifact-1", kind: "image", media: {} }], requestedConcepts: [], runId: "run-1", artifactId: "artifact-1", createdAt: at, instructionReference: "r4-test", idFor: () => "ordinary-fact" });
  assert.equal(result.facts.length, 1); assert.equal(result.facts[0].factValue, "Alice and HoldCo are linked"); assert.equal(result.facts[0].typedRelationship, null);
  assert.equal(result.facts[0].supportSignals.typedRelationship.state, "rejected"); assert.match(result.typedRelationshipLimitations[0], /direction/);
});

test("one Artifact may produce multiple independent relationship Facts and contradictory assertions coexist without a winner", async () => {
  const facts = [
    { concept: "alice_ownership", value: "70%", raw: "Alice owns 70%", typed: candidate() },
    { concept: "bob_ownership", value: "40%", raw: "Bob owns 40%", typed: candidate({ subject: { partyType: "natural_person", name: "Bob Example" }, value: { kind: "EXACT", measurementType: "percentage", value: 40 } }) },
  ]; let id = 0;
  const provider = { extract: async () => ({ facts: facts.map((fact) => ({ ...fact, requested: false, valueFound: true, semanticRole: "business_fact", sampled: false, supportingArtifactIds: ["artifact-1"], supportLocators: [{ artifact_id: "artifact-1", json_path: "/owners", excerpt: fact.raw }], typedRelationshipCandidate: fact.typed })), requestedConceptOutcomes: [], completeness: { state: "complete", limitations: [] } }) };
  const result = await runSemanticExtraction(provider, { artifactInputs: [{ artifact: { id: "artifact-1" } }], contentItems: [{ artifactId: "artifact-1", kind: "text", mediaType: "application/json", media: {} }], requestedConcepts: [], runId: "run-1", artifactId: "artifact-1", createdAt: at, instructionReference: "r4-test", idFor: () => `fact-${++id}` });
  assert.equal(result.facts.length, 2); assert.equal(result.typedRelationshipValidatedCount, 2); assert.equal(result.facts.some((fact) => fact.semanticConceptId === "operative_owner" || fact.semanticConceptId === "is_ubo"), false);
});

test("explicit current, ceased, historical and unknown states are preserved without inference", () => {
  for (const state of ["current", "ceased", "historical", "unknown"]) assert.equal(validate(candidate({ temporal: { state } }), `temporal-${state}`).relationship.temporalState, state);
  const dated = validate(candidate({ temporal: { state: "ceased", effectiveFrom: "2020-01-01", effectiveTo: "2024-12-31", sourceEffectiveDate: "2025-01-05", precision: { effectiveFrom: "day" } } }), "dated").relationship;
  assert.equal(dated.effectiveTo, "2024-12-31"); assert.deepEqual(dated.temporalPrecision, { effectiveFrom: "day" });
  assert.equal(validate(candidate({ temporal: { state: "current", effectiveFrom: "2025-01-02", effectiveTo: "2025-01-01" } })).relationship, null);
});

test("Companies House PSC mapping creates derived Facts with source-code and derivation lineage", () => {
  const inputFact = { id: "psc-code-fact", artifactId: "psc-json", supportingArtifactIds: ["psc-json"], rawRepresentation: "ownership-of-shares-25-to-50-percent", supportState: "supported", supportSignals: {}, supportLocators: [{ artifactId: "psc-json", locatorKind: "json", jsonPath: "/items/0/natures_of_control/0", supportExcerpt: "ownership-of-shares-25-to-50-percent" }] };
  const mapped = mapCompaniesHousePscNatureOfControl({ inputFact, natureOfControlCode: "ownership-of-shares-25-to-50-percent", subject, object, extractionRunId: "mapping-run", createdAt: at, idFor: () => "derived-fact" });
  assert.equal(mapped.facts.length, 1); assert.equal(mapped.facts[0].groundingType, "derived"); assert.equal(mapped.derivations[0].inputFactId, inputFact.id);
  assert.equal(mapped.typedRelationships[0].rangeLower, 25); assert.equal(mapped.typedRelationships[0].lowerInclusive, false); assert.equal(mapped.typedRelationships[0].rangeUpper, 50); assert.equal(mapped.typedRelationships[0].upperInclusive, true);
  assert.equal(mapped.typedRelationships[0].sourceSpecificMetadata.originalRelationshipLabel, "ownership-of-shares-25-to-50-percent"); assert.equal(inputFact.groundingType, undefined);
});

test("Companies House appointment/removal maps to separate Facts and no-PSC states never become zero ownership", () => {
  assert.deepEqual(mappingsForCode("right-to-appoint-and-remove-directors").map((item) => item.relationshipType), ["APPOINTMENT_RIGHTS", "REMOVAL_RIGHTS"]);
  assert.deepEqual(mappingsForCode("no-individual-or-entity-with-signficant-control"), []);
  assert.deepEqual(mappingsForCode("psc-exempt-as-shares-admitted-on-market"), []);
});

test("provider adapter preserves candidate syntax for Evidence validation and never emits persistence internals", () => {
  const mapped = mapTypedRelationshipCandidate({ direction_established: true, relationship_type: "ECONOMIC_OWNERSHIP", subject: { party_type: "natural_person", name: "Alice" }, object: { party_type: "legal_entity", name: "HoldCo" }, value: { kind: "RANGE", measurement_type: "percentage", lower: 25, lower_inclusive: false, upper: 50, upper_inclusive: true }, temporal: { state: "unknown" }, source_specific_metadata: { sourceCode: "code" }, qualifications: [] });
  assert.equal(mapped.subject.partyType, "natural_person"); assert.equal(mapped.value.lowerInclusive, false); assert.equal("factId" in mapped, false);
});

test("provider instruction requests open typed discovery but forbids downstream UBO conclusions", async () => {
  let requestBody;
  const provider = new AnthropicSemanticProvider({ apiKey: "fixture-key", model: "fixture-model", fetchImpl: async (_url, options) => { requestBody = JSON.parse(options.body); return { ok: true, json: async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ facts: [{ concept: "economic_ownership_relationship", value: "70%", raw: "Alice owns 70% of HoldCo", requested: false, value_found: true, semantic_role: "business_fact", sampled: false, supporting_artifact_ids: ["artifact-1"], support_locators: [{ artifact_id: "artifact-1", json_path: "/owners/0", excerpt: "Alice owns 70%" }], typed_relationship: { direction_established: true, relationship_type: "ECONOMIC_OWNERSHIP", subject: { party_type: "natural_person", name: "Alice" }, object: { party_type: "legal_entity", name: "HoldCo" }, value: { kind: "EXACT", measurement_type: "percentage", value: 70 }, temporal: { state: "unknown" }, source_specific_metadata: {}, qualifications: [] } }], requested_concept_outcomes: [], completeness: { state: "complete", limitations: [] } }) }] }) }; } });
  const result = await provider.extract({ artifactInputs: [{ artifact: { id: "artifact-1", mediaType: "application/json" }, decodedText: "{}" }], requestedConcepts: [] });
  assert.equal(result.facts[0].typedRelationshipCandidate.relationshipType, "ECONOMIC_OWNERSHIP");
  const prompt = requestBody.messages[0].content; assert.match(prompt, /one Fact per directed relationship/); assert.match(prompt, /Do not return UBO\/controller status/); assert.match(prompt, /There is no unknown relationship code/);
});

test("R2 stable results and no-provider history expose typed relationships with Fact, Artifact and locator lineage", async () => {
  const relationship = validate(candidate(), "fact-history").relationship;
  const exposed = publicFact({ id: "fact-history", semanticConceptId: "economic_ownership_relationship", factValue: "70%", requestStatus: "discovered", groundingType: "direct", supportState: "supported", supportingArtifactIds: ["artifact-1"], supportLocators: [{ kind: "image", description: "Ownership line" }], typedRelationship: relationship, createdAt: at }, []);
  assert.equal(exposed.typedRelationship.subject.name, "Alice Example"); assert.equal(exposed.typedRelationship.value.exact, 70);
  const history = new EvidenceInterpretationHistoryService({
    findArtifactForInterpretation: async () => ({ id: "artifact-1", assetId: "asset-1", authorized: true, representationType: "original_image", mediaType: "image/png", sizeBytes: 100, fingerprintAlgorithm: "sha256", fingerprintValue: "00".repeat(32), capturedAt: at, assetTitle: "Ownership chart" }),
    listInterpretations: async () => ({ runs: [{ id: "run-1", artifact_id: "artifact-1", status: "completed", execution_mode: "ai", created_at: at }], facts: [{ id: "fact-history", extraction_run_id: "run-1", artifact_id: "artifact-1", semantic_concept_id: "economic_ownership_relationship", request_status: "discovered", grounding_type: "direct", fact_value: "70%", support_state: "supported", support_signals: {}, created_at: at }], runArtifacts: [{ extraction_run_id: "run-1", artifact_id: "artifact-1", input_role: "primary", created_at: at }], inputArtifacts: [{ id: "artifact-1", asset_id: "asset-1", media_type: "image/png", representation_type: "original_image", captured_at: at }], factArtifactSupports: [{ fact_id: "fact-history", artifact_id: "artifact-1" }], factArtifactLocators: [{ id: "locator-1", fact_id: "fact-history", artifact_id: "artifact-1", locator_ordinal: 1, locator_kind: "image", support_description: "Ownership line" }], typedRelationships: [relationship] }),
  });
  const reopened = await history.forArtifact({ artifactId: "artifact-1", tenantId: "nium" });
  assert.equal(reopened.aiCall, false); assert.equal(reopened.externalSourceCall, false); assert.equal(reopened.runs[0].facts[0].typedRelationship.relationshipType, "ECONOMIC_OWNERSHIP"); assert.equal(reopened.runs[0].facts[0].supportLocators[0].description, "Ownership line");
});

test("migration 017 is additive, one-to-one and keeps core grammar queryable", () => {
  const sql = fs.readFileSync(path.resolve("db/migrations/017_evidence_typed_relationships.sql"), "utf8");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS evidence_fact_typed_relationships/); assert.match(sql, /fact_id UUID PRIMARY KEY REFERENCES evidence_facts\(id\)/);
  for (const column of ["relationship_type TEXT", "subject_party_type TEXT", "object_party_type TEXT", "value_kind TEXT", "measurement_type TEXT", "temporal_state TEXT"]) assert.match(sql, new RegExp(column));
  assert.doesNotMatch(sql, /ALTER TABLE/); assert.doesNotMatch(sql, /ubo|kyc_satisfaction|winner|operative_value/i);
});

test("R4 remains generic Evidence infrastructure with no UBO, indirect-ownership, winner or A4b engine", () => {
  const source = ["domain.js", "pscMapper.js"].map((file) => fs.readFileSync(path.resolve("evidence/r4", file), "utf8")).join("\n");
  assert.doesNotMatch(source, /require\([^)]*(?:ubo|a4b)/i); assert.doesNotMatch(source, /(?:calculate|compute)(?:\w|\s)*(?:indirect|effective)(?:\w|\s)*ownership/i);
  assert.doesNotMatch(source, /isUbo|uboConclusion|winnerSelected|kycSatisfaction/); assert.match(source, /sourceCodePreserved: true/);
});
