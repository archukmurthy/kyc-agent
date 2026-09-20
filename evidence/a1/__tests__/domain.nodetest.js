"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildA1FixtureGraph, ids, summarizeA1Fixture } = require("../fixtures");
const { validateEvidenceGraph } = require("../domain");
const { EvidenceA1Service } = require("../service");
const { MemoryEvidenceRepository } = require("../repository");

test("one business requirement contains multiple authoritative schema information needs", () => {
  const graph = buildA1FixtureGraph();
  const needs = graph.informationNeeds.filter((need) => need.requirementId === ids.requirementAugust);
  assert.deepEqual(needs.map((need) => need.schemaFieldId), [
    "business_name", "registration_number", "company_status", "incorporation_date", "registered_address_line1",
  ]);
  assert.ok(needs.every((need) => need.schemaVersionReference === null));
});

test("failed and inconclusive acquisition history exists without assets", () => {
  const graph = buildA1FixtureGraph();
  for (const acquisitionId of [ids.acquisitionFailed, ids.acquisitionInconclusive]) {
    assert.equal(graph.assets.some((asset) => asset.acquisitionId === acquisitionId), false);
  }
});

test("one successful acquisition produces multiple logical assets", () => {
  const graph = buildA1FixtureGraph();
  assert.deepEqual(
    graph.assets.filter((asset) => asset.acquisitionId === ids.acquisitionAugust).map((asset) => asset.evidenceType),
    ["company_profile", "officers", "incorporation_document"],
  );
});

test("one logical Evidence Asset has independently fingerprinted artifacts", () => {
  const graph = buildA1FixtureGraph();
  const artifacts = graph.artifacts.filter((item) => item.assetId === ids.assetAugustProfile);
  assert.deepEqual(artifacts.map((item) => item.representationType), ["structured_json", "screenshot"]);
  assert.ok(artifacts.every((item) => /^[0-9a-f]{64}$/.test(item.fingerprintValue)));
  assert.notEqual(artifacts[0].fingerprintValue, artifacts[1].fingerprintValue);
});

test("recollection appends August evidence without overwriting May evidence", () => {
  const graph = buildA1FixtureGraph();
  const values = graph.extractedValues.map((value) => value.extractedValue);
  assert.ok(values.includes("10 High Street"));
  assert.ok(values.includes("25 King Street"));
  assert.notEqual(ids.assetMayProfile, ids.assetAugustProfile);
  assert.notEqual(ids.acquisitionMay, ids.acquisitionAugust);
});

test("identical artifact bytes retain separate public and private provenance", () => {
  const graph = buildA1FixtureGraph();
  const publicArtifact = graph.artifacts.find((item) => item.id === ids.artifactPublicDocument);
  const privateArtifact = graph.artifacts.find((item) => item.id === ids.artifactCustomerDocument);
  assert.equal(publicArtifact.fingerprintValue, privateArtifact.fingerprintValue);
  assert.notEqual(publicArtifact.id, privateArtifact.id);
  assert.notEqual(publicArtifact.assetId, privateArtifact.assetId);
  assert.notEqual(
    graph.assets.find((asset) => asset.id === publicArtifact.assetId).acquisitionId,
    graph.assets.find((asset) => asset.id === privateArtifact.assetId).acquisitionId,
  );
});

test("public evidence can associate with multiple tenant contexts without copying the asset", () => {
  const graph = buildA1FixtureGraph();
  const links = graph.requirementAssets.filter((link) => link.assetId === ids.assetAugustProfile);
  assert.equal(links.length, 2);
  assert.deepEqual(new Set(links.map((link) => graph.contexts.find((c) => c.id === link.associatedContextId).tenantId)), new Set(["nium", "acme"]));
  assert.equal(graph.assets.filter((asset) => asset.id === ids.assetAugustProfile).length, 1);
});

test("private customer evidence is restricted to its tenant and context", () => {
  const graph = buildA1FixtureGraph();
  const asset = graph.assets.find((item) => item.id === ids.assetCustomerDocument);
  assert.equal(asset.accessClass, "context_restricted");
  assert.deepEqual(graph.accessScopes.filter((scope) => scope.assetId === asset.id), [{
    assetId: asset.id, tenantId: "nium", contextId: ids.contextUpload, createdAt: "2026-08-01T10:00:00.000Z",
  }]);

  const invalid = structuredClone(graph);
  invalid.requirementAssets.push({
    requirementId: ids.requirementReuse,
    assetId: ids.assetCustomerDocument,
    associatedContextId: ids.contextReuse,
    associatedAt: "2026-08-01T10:00:00.000Z",
  });
  assert.throws(() => validateEvidenceGraph(invalid), /not visible in context/);
});

test("multiple extraction runs preserve lineage to distinct representations of one asset", () => {
  const graph = buildA1FixtureGraph();
  const runs = graph.extractionRuns.filter((run) => run.assetId === ids.assetAugustProfile);
  assert.equal(runs.length, 2);
  assert.deepEqual(new Set(runs.map((run) => run.artifactId)), new Set([ids.artifactAugustJson, ids.artifactAugustScreenshot]));
  assert.deepEqual(
    graph.extractedValues.filter((value) => runs.some((run) => run.id === value.extractionRunId)).map((value) => value.extractedValue),
    ["25 King Street", "17 Queen Street"],
  );
});

test("registered and operating address remain distinct schema concepts", () => {
  const graph = buildA1FixtureGraph();
  const concepts = new Set(graph.informationNeeds.map((need) => need.schemaFieldId));
  assert.ok(concepts.has("registered_address_line1"));
  assert.ok(concepts.has("operating_address"));
});

test("stable subject identity is shared across contexts without global entity resolution", () => {
  const graph = buildA1FixtureGraph();
  assert.equal(graph.subjects.length, 1);
  assert.deepEqual(graph.subjects[0], {
    id: ids.subject, subjectType: "company", identifierScheme: "company_registration_number",
    jurisdiction: "GB", identifierValue: "12345678", displayName: "ABC Limited",
    externalSystem: "companies_house", externalReference: "12345678", createdAt: "2026-05-01T10:00:00.000Z",
  });
  assert.ok(graph.contexts.every((context) => context.subjectReferenceId === ids.subject));
});

test("fixture graph persists through the service boundary", async () => {
  const repository = new MemoryEvidenceRepository();
  const result = await new EvidenceA1Service(repository).persistFixtureDemonstration();
  assert.equal(result.stage, "A1");
  assert.equal(result.persistence.persisted.assets, 5);
  assert.equal(repository.latest().assets.length, 5);
  assert.deepEqual(summarizeA1Fixture(repository.latest()).recollection, ["10 High Street", "25 King Street"]);
});
