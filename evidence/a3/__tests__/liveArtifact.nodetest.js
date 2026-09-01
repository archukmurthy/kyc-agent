"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { sha256 } = require("../../a1/domain");
const { LiveArtifactInterpretationService } = require("../liveService");
const { DeterministicProfileDiscoveryProvider, PROFILE_DISCOVERY_SOURCE } = require("./profileDiscoveryFixture");

const bytes = Buffer.from("<html><h1>REAL COMPANY LIMITED</h1><p>Registered name: REAL COMPANY LIMITED</p><p>Formerly Real Trading Limited.</p></html>");
function artifact(overrides = {}) { return { id: "artifact-real", assetId: "asset-real", acquisitionId: "acq-real", collectionId: "collection-real", collectionProducer: "companies_house", representationType: "rendered_html", mediaType: "text/html", storageProvider: "filesystem", storageKey: "evidence/real.html", storageReference: "hidden", sizeBytes: bytes.length, fingerprintAlgorithm: "sha256", fingerprintValue: sha256(bytes), capturedAt: "2026-08-14T09:00:00.000Z", artifactMetadata: {}, assetTitle: "Real overview", evidenceType: "companies_house_overview_website", accessClass: "public", observedAt: "2026-08-14T09:00:00.000Z", sourceType: "public_website", sourceProvider: "Companies House", sourceLocator: "https://find-and-update.company-information.service.gov.uk/company/99999999", acquisitionMethod: "browser_capture", tenantId: "nium", contextId: "context-real", subjectReferenceId: "subject-real", subjectDisplayName: "REAL COMPANY LIMITED", subjectIdentifier: "99999999", collectionCoordinates: { jurisdiction: "GB", companyNumber: "99999999" }, authorized: true, ...overrides }; }

class TestRepository {
  constructor(item = artifact()) { this.item = item; this.appends = []; this.deterministic = []; }
  async findArtifactForInterpretation() { return this.item ? structuredClone(this.item) : null; }
  async findDeterministicValues() { return structuredClone(this.deterministic); }
  async appendInterpretation(value) { this.appends.push(structuredClone(value)); return { runId: value.run.id }; }
  async listInterpretations() { return { runs: this.appends.map((entry) => entry.run), facts: this.appends.flatMap((entry) => entry.facts) }; }
}
function provider(facts = [{ concept: "business_name", value: "REAL COMPANY LIMITED", raw: "Registered name: REAL COMPANY LIMITED", requested: true, schemaFieldId: "business_name" }, { concept: "previous_legal_name", value: "Real Trading Limited", raw: "Formerly Real Trading Limited", requested: false }], options = {}) { return { async extract(input) { assert.equal(input.artifact.id, "artifact-real"); assert.equal(input.decodedText.includes("REAL COMPANY LIMITED"), true); const normalized = facts.map((fact) => ({ valueFound: true, semanticRole: "business_fact", sampled: false, ...fact })); return { facts: normalized, requestedConceptOutcomes: options.requestedConceptOutcomes || input.requestedConcepts.map((item) => ({ concept: item.concept, status: normalized.some((fact) => fact.requested && fact.concept === item.concept && fact.valueFound) ? "found" : "not_found" })), completeness: options.completeness || { state: "complete", limitations: [] } }; } }; }
function service(options = {}) { let sequence = 0; return new LiveArtifactInterpretationService({ repository: options.repository || new TestRepository(), artifactReader: options.artifactReader || { async read() { return { bytes }; } }, provider: Object.prototype.hasOwnProperty.call(options, "provider") ? options.provider : provider(), providerLineage: { provider: "test-provider", model: "test-model", instructionReference: "test-instruction-v1" }, now: () => sequence++ ? "2026-08-18T10:00:01.000Z" : "2026-08-18T10:00:00.000Z", id: () => `new-${++sequence}` }); }

test("real A2 Artifact feeds A3 without recollection, mutation, or fixture leakage", async () => {
  const repository = new TestRepository(); const before = structuredClone(repository.item);
  const result = await service({ repository }).interpret({ artifactId: "artifact-real", tenantId: "nium" });
  assert.equal(result.inputMode, "LIVE PRESERVED ARTIFACT");
  assert.equal(result.integrity.verified, true); assert.equal(result.artifact.capturedAt, before.capturedAt);
  assert.equal(result.requestedFacts[0].factValue, "REAL COMPANY LIMITED"); assert.equal(result.discoveredFacts[0].factValue, "Real Trading Limited");
  assert.equal(JSON.stringify(result).includes("ABC Limited"), false); assert.equal(JSON.stringify(result).includes("King Street"), false);
  assert.deepEqual(repository.item, before); assert.equal(repository.appends.length, 1);
  assert.equal(repository.appends[0].runArtifacts[0].artifactId, before.id);
  assert.equal(repository.appends[0].run.startedAt > before.capturedAt, true);
});

test("structured JSON and rendered HTML are both eligible real representations", async () => {
  const jsonBytes = Buffer.from(JSON.stringify({ company_name: "REAL COMPANY LIMITED", previous_company_names: [{ name: "Real Trading Limited" }] }));
  const repository = new TestRepository(artifact({ representationType: "companies_house_api_response", mediaType: "application/json", sizeBytes: jsonBytes.length, fingerprintValue: sha256(jsonBytes) }));
  const result = await service({ repository, artifactReader: { async read() { return { bytes: jsonBytes }; } }, provider: { async extract(input) { assert.equal(input.artifact.mediaType, "application/json"); return { facts: [{ concept: "previous_legal_name", value: "Real Trading Limited", raw: '"name":"Real Trading Limited"', requested: false, valueFound: true, semanticRole: "business_fact", sampled: false }], requestedConceptOutcomes: input.requestedConcepts.map((item) => ({ concept: item.concept, status: "not_found" })), completeness: { state: "complete", limitations: [] } }; } } }).interpret({ artifactId: "artifact-real", tenantId: "nium" });
  assert.equal(result.discoveredFacts[0].factValue, "Real Trading Limited"); assert.equal(result.integrity.verified, true);
});

test("SHA-256 mismatch is detected before provider execution and creates no facts", async () => {
  const repository = new TestRepository(artifact({ fingerprintValue: "0".repeat(64) })); let providerCalled = false;
  await assert.rejects(() => service({ repository, provider: { async extract() { providerCalled = true; return { facts: [] }; } } }).interpret({ artifactId: "artifact-real", tenantId: "nium" }), (error) => error.code === "artifact_integrity_mismatch");
  assert.equal(providerCalled, false); assert.equal(repository.appends.length, 1); assert.equal(repository.appends[0].run.status, "failed"); assert.deepEqual(repository.appends[0].facts, []);
});

test("A2 deterministic values are not duplicated into A3 facts", async () => {
  const repository = new TestRepository(); repository.deterministic = [{ schemaFieldId: "business_name", extractedValue: "REAL COMPANY LIMITED" }];
  const result = await service({ repository }).interpret({ artifactId: "artifact-real", tenantId: "nium" });
  assert.equal(result.requestedFacts.length, 0); assert.equal(result.discoveredFacts.length, 1); assert.equal(result.a2DeterministicValuesDuplicated, false);
  assert.equal(repository.appends[0].facts.some((fact) => fact.semanticConceptId === "business_name"), false);
  assert.deepEqual(result.providerOutputEvaluation, { providerFactCount: 2, discardedNoValueFactCount: 0, discardedProvenanceFactCount: 0, discardedSampledFactCount: 0, discardedInvalidSupportFactCount: 0, persistedA3FactCount: 1, alreadyRepresentedByA2Count: 1, duplicateSuppressions: [{ semanticConceptId: "business_name", schemaFieldId: "business_name", factValue: "REAL COMPANY LIMITED", rawRepresentation: "Registered name: REAL COMPANY LIMITED", alreadyRepresentedBy: "a2_deterministic_extraction" }], requestedConceptOutcomes: [{ concept: "business_name", status: "found" }, { concept: "registered_address", status: "not_found" }], inputCompleteness: { state: "complete", limitations: [], expectedArtifactCount: 1, selectedArtifactCount: 1 }, extractionCompleteness: { state: "complete", limitations: [], sourceRecordCount: null, representedRecordCount: null } });
  assert.deepEqual(repository.appends[0].run.runMetadata.providerOutputEvaluation, result.providerOutputEvaluation);
});

test("provider recall remains observable when every returned fact is already represented by A2", async () => {
  const repository = new TestRepository(); repository.deterministic = [{ schemaFieldId: "business_name", extractedValue: "REAL COMPANY LIMITED" }];
  const result = await service({ repository, provider: provider([{ concept: "business_name", value: "REAL COMPANY LIMITED", raw: "Registered name: REAL COMPANY LIMITED", requested: true, schemaFieldId: "business_name" }]) }).interpret({ artifactId: "artifact-real", tenantId: "nium" });
  assert.equal(result.extractionRun.status, "completed"); assert.equal(result.providerOutputEvaluation.providerFactCount, 1); assert.equal(result.providerOutputEvaluation.persistedA3FactCount, 0); assert.equal(result.providerOutputEvaluation.alreadyRepresentedByA2Count, 1); assert.equal(repository.appends[0].facts.length, 0);
});

test("null provider items are counted but do not roll back valid zero and false facts", async () => {
  const repository = new TestRepository();
  const result = await service({ repository, provider: provider([{ concept: "active_count", value: 0, raw: "0", requested: false }, { concept: "unknown_value", value: null, raw: "not supplied", requested: false }, { concept: "has_active_psc", value: false, raw: "false", requested: false }]) }).interpret({ artifactId: "artifact-real", tenantId: "nium" });
  assert.equal(result.providerOutputEvaluation.providerFactCount, 3); assert.equal(result.providerOutputEvaluation.discardedNoValueFactCount, 1); assert.deepEqual(repository.appends[0].facts.map((fact) => fact.factValue), [0, false]);
});

test("requested absence is recorded as an outcome and never persisted as a placeholder fact", async () => {
  const repository = new TestRepository();
  const result = await service({ repository, provider: provider([{ concept: "registered_address", value: "Not stated on this page", raw: "Not stated", requested: true, schemaFieldId: "registered_address_line1", valueFound: true }], { requestedConceptOutcomes: [{ concept: "business_name", status: "not_found" }, { concept: "registered_address", status: "found" }] }) }).interpret({ artifactId: "artifact-real", tenantId: "nium" });
  assert.equal(result.extractionRun.status, "completed"); assert.equal(result.support.state, "not_supported"); assert.equal(result.providerOutputEvaluation.discardedNoValueFactCount, 1); assert.equal(repository.appends[0].facts.length, 0);
  assert.deepEqual(result.providerOutputEvaluation.requestedConceptOutcomes, [{ concept: "business_name", status: "not_found" }, { concept: "registered_address", status: "not_found" }]);
});

test("provenance and sampled outputs are excluded while incompleteness remains observable", async () => {
  const repository = new TestRepository();
  const result = await service({ repository, provider: provider([
    { concept: "officers", value: [{ name: "A" }, { name: "B" }], raw: "two complete records", requested: false },
    { concept: "source_url", value: "https://example.test/page/1", raw: "source URL", requested: false },
    { concept: "resigned_officers_sample", value: [{ name: "C" }], raw: "first record", requested: false, sampled: true },
  ]) }).interpret({ artifactId: "artifact-real", tenantId: "nium" });
  assert.deepEqual(repository.appends[0].facts.map((fact) => fact.semanticConceptId), ["officers"]);
  assert.equal(result.providerOutputEvaluation.discardedProvenanceFactCount, 1); assert.equal(result.providerOutputEvaluation.discardedSampledFactCount, 1);
  assert.equal(result.providerOutputEvaluation.extractionCompleteness.state, "incomplete"); assert.equal(result.support.state, "needs_verification");
});

test("Profile open-discovery evaluation persists previous names and direct SIC codes while suppressing an exact A2 name duplicate", async () => {
  const profileBytes = Buffer.from(JSON.stringify(PROFILE_DISCOVERY_SOURCE)); const repository = new TestRepository(artifact({ representationType: "companies_house_api_response", mediaType: "application/json", sizeBytes: profileBytes.length, fingerprintValue: sha256(profileBytes) }));
  repository.deterministic = [{ schemaFieldId: "business_name", extractedValue: "TESCO PLC" }]; const semanticProvider = new DeterministicProfileDiscoveryProvider();
  const result = await service({ repository, artifactReader: { async read() { return { bytes: profileBytes }; } }, provider: semanticProvider }).interpret({ artifactId: "artifact-real", tenantId: "nium" });
  assert.equal(semanticProvider.calls, 1); assert.equal(result.providerOutputEvaluation.providerFactCount, 9); assert.equal(result.providerOutputEvaluation.persistedA3FactCount, 8); assert.equal(result.providerOutputEvaluation.alreadyRepresentedByA2Count, 1);
  assert.equal(result.requestedFacts.some((fact) => fact.semanticConceptId === "business_name"), false); assert.ok(result.discoveredFacts.some((fact) => fact.semanticConceptId === "previous_company_names"));
  const sic = result.discoveredFacts.find((fact) => fact.semanticConceptId === "sic_codes"); assert.deepEqual(sic.factValue, ["47110"]); assert.equal(sic.groundingType, "direct");
  assert.equal(result.discoveredFacts.some((fact) => ["etag", "links", "industry_description"].includes(fact.semanticConceptId)), false); assert.equal(result.derivedFacts.length, 0);
});

test("later reinterpretation appends a new run and retains prior run", async () => {
  const repository = new TestRepository(); const interpreter = service({ repository }); const first = await interpreter.interpret({ artifactId: "artifact-real", tenantId: "nium" }); const second = await interpreter.interpret({ artifactId: "artifact-real", tenantId: "nium" });
  assert.notEqual(first.extractionRun.id, second.extractionRun.id); assert.equal(repository.appends.length, 2); assert.equal(second.lineage.previousRunCount, 1);
});

test("access, storage, unsupported media, provider and empty-result failures preserve A2", async (t) => {
  await t.test("not found", async () => { const repository = new TestRepository(null); await assert.rejects(() => service({ repository }).interpret({ artifactId: "missing", tenantId: "nium" }), (e) => e.code === "artifact_not_found"); assert.equal(repository.appends.length, 0); });
  await t.test("access denied", async () => { const repository = new TestRepository(artifact({ authorized: false, accessClass: "context_restricted" })); await assert.rejects(() => service({ repository }).interpret({ artifactId: "artifact-real", tenantId: "other" }), (e) => e.code === "artifact_access_denied"); assert.equal(repository.appends.length, 0); });
  await t.test("storage failure", async () => { const repository = new TestRepository(); await assert.rejects(() => service({ repository, artifactReader: { async read() { throw Object.assign(new Error("down"), { code: "artifact_storage_unavailable" }); } } }).interpret({ artifactId: "artifact-real", tenantId: "nium" }), (e) => e.code === "artifact_storage_unavailable"); assert.equal(repository.appends[0].facts.length, 0); });
  await t.test("invalid image is rejected before provider", async () => { const repository = new TestRepository(artifact({ mediaType: "image/png" })); await assert.rejects(() => service({ repository }).interpret({ artifactId: "artifact-real", tenantId: "nium" }), (e) => e.code === "invalid_media"); assert.equal(repository.appends[0].facts.length, 0); });
  await t.test("provider not configured", async () => { const repository = new TestRepository(); await assert.rejects(() => service({ repository, provider: null }).interpret({ artifactId: "artifact-real", tenantId: "nium" }), (e) => e.code === "provider_not_configured"); assert.equal(repository.appends[0].run.errorCode, "provider_not_configured"); });
  await t.test("provider failure", async () => { const repository = new TestRepository(); await assert.rejects(() => service({ repository, provider: { async extract() { throw Object.assign(new Error("bad auth"), { code: "provider_authentication_failed" }); } } }).interpret({ artifactId: "artifact-real", tenantId: "nium" }), (e) => e.code === "provider_authentication_failed"); assert.equal(repository.appends[0].facts.length, 0); });
  await t.test("no supported facts and no truthful absence outcome", async () => { const repository = new TestRepository(); const incomplete = provider([], { requestedConceptOutcomes: [{ concept: "business_name", status: "not_evaluated" }, { concept: "registered_address", status: "not_evaluated" }], completeness: { state: "incomplete", limitations: ["Provider could not evaluate the evidence"] } }); await assert.rejects(() => service({ repository, provider: incomplete }).interpret({ artifactId: "artifact-real", tenantId: "nium" }), (e) => e.code === "no_supported_facts"); assert.equal(repository.appends[0].run.status, "failed"); });
});

test("database persistence failure does not claim success", async () => {
  const repository = new TestRepository(); repository.appendInterpretation = async () => { throw new Error("db down"); };
  await assert.rejects(() => service({ repository }).interpret({ artifactId: "artifact-real", tenantId: "nium" }), (e) => e.code === "database_persistence_failed");
});

test("transient persistence failure retries the same interpretation without another AI call", async () => {
  const repository = new TestRepository(); let persistenceCalls = 0, providerCalls = 0;
  repository.appendInterpretation = async (value) => { persistenceCalls += 1; if (persistenceCalls === 1) throw Object.assign(new Error("connection terminated"), { code: "08006" }); repository.appends.push(structuredClone(value)); return { runId: value.run.id }; };
  const result = await service({ repository, provider: { async extract(input) { providerCalls += 1; return provider().extract(input); } } }).interpret({ artifactId: "artifact-real", tenantId: "nium" });
  assert.equal(result.extractionRun.status, "completed"); assert.equal(persistenceCalls, 2); assert.equal(providerCalls, 1); assert.equal(repository.appends.length, 1);
});

test("constraint failures are not retried and expose a non-secret diagnostic reference", async () => {
  const repository = new TestRepository(); let calls = 0; repository.appendInterpretation = async () => { calls += 1; throw Object.assign(new Error("constraint failed"), { code: "23514", constraint: "evidence_facts_request_status_check", persistenceStage: "facts" }); };
  await assert.rejects(() => service({ repository }).interpret({ artifactId: "artifact-real", tenantId: "nium" }), (error) => error.code === "database_persistence_failed" && error.details.persistenceCode === "23514" && error.details.persistenceConstraint === "evidence_facts_request_status_check" && error.details.persistenceStage === "facts" && error.details.retryAttempted === false && !!error.details.runId);
  assert.equal(calls, 1);
});
