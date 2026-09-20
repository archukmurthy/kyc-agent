"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { EvidenceInterpretationHistoryService } = require("../historyService");

function artifact(id = "artifact-1", overrides = {}) { return { id, assetId: `asset-${id}`, collectionId: "collection-1", representationType: "rendered_html", mediaType: "text/html", sizeBytes: 100, fingerprintAlgorithm: "sha256", fingerprintValue: "a".repeat(64), capturedAt: "2026-08-18T09:00:00.000Z", assetTitle: `Overview ${id}`, sourceLocator: "https://example.test", subjectDisplayName: "ABC Limited", subjectIdentifier: "12345678", authorized: true, ...overrides }; }

test("existing A3 runs reopen without an AI provider, Artifact read, source call, or write", async () => {
  const calls = [];
  const repository = {
    async findArtifactForInterpretation(input) { calls.push(["find", input]); return artifact(); },
    async listInterpretations(id) { calls.push(["list", id]); return { runs: [{ id: "run-1", artifact_id: id, execution_mode: "ai", provider: "anthropic", model_identifier: "model", status: "completed", started_at: "2026-08-18T10:00:00.000Z", completed_at: "2026-08-18T10:00:01.000Z", run_metadata: { providerOutputEvaluation: { providerFactCount: 2, persistedA3FactCount: 1, alreadyRepresentedByA2Count: 1 } }, support_assessment: { state: "supported" } }], facts: [{ id: "fact-1", extraction_run_id: "run-1", artifact_id: id, semantic_concept_id: "business_name", request_status: "requested", grounding_type: "direct", fact_value: "ABC Limited", support_state: "supported" }] }; },
  };
  const result = await new EvidenceInterpretationHistoryService(repository).forArtifact({ artifactId: "artifact-1", tenantId: "nium" });
  assert.equal(result.found, true); assert.equal(result.externalSourceCall, false); assert.equal(result.aiCall, false); assert.equal(result.runs.length, 1); assert.equal(result.runs[0].facts[0].factValue, "ABC Limited");
  assert.deepEqual(result.runs[0].lineage.path, ["artifact-1", "run-1", "fact-1"]); assert.deepEqual(calls.map((call) => call[0]), ["find", "list"]);
  assert.equal(result.runs[0].runMetadata.providerOutputEvaluation.alreadyRepresentedByA2Count, 1);
  assert.equal(JSON.stringify(result).includes("storageReference"), false);
});

test("history is scoped to the selected Artifact and denied access is rejected", async () => {
  const repository = { async findArtifactForInterpretation({ artifactId }) { return artifact(artifactId); }, async listInterpretations(artifactId) { return { runs: [{ id: `run-${artifactId}`, artifact_id: artifactId, execution_mode: "ai", status: "completed" }], facts: [] }; } };
  const service = new EvidenceInterpretationHistoryService(repository), first = await service.forArtifact({ artifactId: "one", tenantId: "nium" }), second = await service.forArtifact({ artifactId: "two", tenantId: "nium" });
  assert.equal(first.runs[0].artifactId, "one"); assert.equal(second.runs[0].artifactId, "two");
  const denied = new EvidenceInterpretationHistoryService({ async findArtifactForInterpretation() { return artifact("private", { authorized: false }); }, async listInterpretations() { throw new Error("must not run"); } });
  await assert.rejects(() => denied.forArtifact({ artifactId: "private", tenantId: "other" }), /not accessible/);
});

test("multi-Artifact history reconstructs ordered inputs and precise Fact support without reading bytes", async () => {
  const repository = { async findArtifactForInterpretation() { return artifact("page-2", { assetId: "officers" }); }, async listInterpretations() { return { runs: [{ id: "run-multi", artifact_id: "page-1", execution_mode: "ai", status: "completed" }], facts: [{ id: "fact-joint", extraction_run_id: "run-multi", artifact_id: "page-1", semantic_concept_id: "officer_count", request_status: "discovered", grounding_type: "direct", fact_value: 3, support_state: "supported" }], runArtifacts: [{ extraction_run_id: "run-multi", artifact_id: "page-1", input_role: "primary" }, { extraction_run_id: "run-multi", artifact_id: "page-2", input_role: "supplementary:0001" }], factArtifactSupports: [{ fact_id: "fact-joint", artifact_id: "page-1" }, { fact_id: "fact-joint", artifact_id: "page-2" }], inputArtifacts: [{ id: "page-1", representation_type: "rendered_html", artifact_metadata: { pageNumber: 1 } }, { id: "page-2", representation_type: "rendered_html", artifact_metadata: { pageNumber: 2 } }] }; } };
  const result = await new EvidenceInterpretationHistoryService(repository).forArtifact({ artifactId: "page-2", tenantId: "nium" });
  assert.deepEqual(result.runs[0].inputArtifacts.map((item) => item.id), ["page-1", "page-2"]); assert.deepEqual(result.runs[0].facts[0].supportingArtifactIds, ["page-1", "page-2"]); assert.deepEqual(result.runs[0].lineage.inputArtifactIds, ["page-1", "page-2"]);
});
