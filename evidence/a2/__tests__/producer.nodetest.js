"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { CompaniesHouseEvidenceService } = require("../service");
const { MemoryA2Repository } = require("../repository");
const { MemoryArtifactStore } = require("../artifactStore");
const { buildCompaniesHouseFixtureClient, fixtureWebsiteCapture } = require("../fixtures");
const { validateCompaniesHouseRequest } = require("../identity");
const { ownershipBand } = require("../extractor");

const input = (key = "request-1") => ({ producer: "companies_house", producerRequestKey: key, collectionCoordinates: { jurisdiction: "GB", companyNumber: "12345678" }, mode: "fixture" });
function harness(options = {}) {
  const repository = options.repository || new MemoryA2Repository();
  const artifactStore = options.artifactStore || new MemoryArtifactStore();
  const client = options.client || buildCompaniesHouseFixtureClient(options);
  const websiteCapture = options.websiteCapture || fixtureWebsiteCapture;
  const service = new CompaniesHouseEvidenceService({ repository, artifactStore, client, websiteCapture, now: () => "2026-08-16T12:00:00.000Z" });
  return { repository, artifactStore, service };
}

test("Companies House coordinates remain producer-specific", () => {
  const request = validateCompaniesHouseRequest(input());
  assert.deepEqual(request.collectionCoordinates, { jurisdiction: "GB", companyNumber: "12345678" });
  assert.equal(Object.hasOwn(request, "companyNumber"), false);
  assert.throws(() => validateCompaniesHouseRequest({ ...input(), producer: "other" }), /producer must be companies_house/);
});

test("profile, paginated officers and PSC produce complete source lineage", async () => {
  const { service } = harness();
  const result = await service.collect(input());
  assert.equal(result.summary.status, "successful");
  assert.equal(result.graph.acquisitions.length, 6);
  assert.equal(result.summary.structuredEvidenceStatus, "complete");
  assert.equal(result.summary.humanViewableEvidenceStatus, "complete");
  assert.equal(result.graph.artifacts.filter((a) => a.representationType === "companies_house_api_response").length, 5);
  assert.equal(result.graph.acquisitions.find((a) => a.producerMetadata.sourceArea === "officers").producerMetadata.pageCount, 2);
  assert.equal(result.graph.acquisitions.find((a) => a.producerMetadata.sourceArea === "psc").producerMetadata.paginationComplete, true);
  assert.ok(result.graph.extractedValues.every((v) => result.graph.extractionRuns.some((r) => r.id === v.extractionRunId)));
  const needs = new Set(result.graph.informationNeeds.map((need) => need.schemaFieldId));
  assert.ok(result.graph.extractedValues.every((value) => needs.has(value.schemaFieldId)));
  assert.ok(result.graph.extractionRuns.every((run) => run.schemaReference === "evidence-lab:a2-standalone-current"));
  assert.ok(result.graph.extractionRuns.every((run) => run.runMetadata.extractionContext === "standalone_evidence_lab_default"));
  assert.equal(result.graph.extractedValues.some((value) => value.schemaFieldId === "company_status"), false);
  assert.equal(result.graph.informationNeeds.some((need) => need.schemaFieldId === "company_status"), false);
  const officerValues = result.graph.extractedValues.filter((v) => v.schemaFieldId === "director_names").map((v) => v.extractedValue);
  assert.deepEqual(officerValues.map((v) => v.status), ["current", "resigned"]);
});

test("artifact hashes match the exact bytes held by durable storage boundary", async () => {
  const { service, artifactStore } = harness();
  const result = await service.collect(input());
  for (const artifact of result.graph.artifacts) {
    const stored = artifactStore.get(artifact.storageKey);
    assert.equal(createHash("sha256").update(stored.bytes).digest("hex"), artifact.fingerprintValue);
    assert.equal(stored.bytes.length, artifact.sizeBytes);
  }
});

test("Overview, Officers and PSC websites remain separate from API acquisitions", async () => {
  const result = await harness().service.collect(input());
  for (const area of ["overview_website", "officers_website", "psc_website"]) {
    const websiteAcquisition = result.graph.acquisitions.find((a) => a.producerMetadata.sourceArea === area);
    const websiteAsset = result.graph.assets.find((a) => a.acquisitionId === websiteAcquisition.id);
    assert.equal(websiteAcquisition.sourceType, "public_website");
    assert.equal(websiteAsset.evidenceType, `companies_house_${area}`);
    assert.ok(result.graph.artifacts.filter((a) => a.assetId === websiteAsset.id).every((a) => ["rendered_html", "screenshot"].includes(a.representationType)));
  }
  const officersApi = result.graph.acquisitions.find((a) => a.producerMetadata.sourceArea === "officers");
  const officersWebsite = result.graph.acquisitions.find((a) => a.producerMetadata.sourceArea === "officers_website");
  assert.notEqual(officersApi.id, officersWebsite.id);
  const pscApi = result.graph.acquisitions.find((a) => a.producerMetadata.sourceArea === "psc");
  const pscWebsite = result.graph.acquisitions.find((a) => a.producerMetadata.sourceArea === "psc_website");
  assert.notEqual(pscApi.id, pscWebsite.id);
});

test("PSC API and website failures preserve other successful API evidence as partial", async () => {
  const result = await harness({ pscFailure: true, websiteCapture: async () => { throw new Error("CAPTCHA"); } }).service.collect(input());
  assert.equal(result.summary.status, "partial");
  assert.equal(result.summary.structuredEvidenceStatus, "incomplete");
  assert.equal(result.summary.humanViewableEvidenceStatus, "unavailable");
  assert.equal(result.graph.assets.some((a) => a.evidenceType === "companies_house_profile"), true);
  assert.equal(result.graph.assets.some((a) => a.evidenceType === "companies_house_officers"), true);
  assert.equal(result.graph.assets.some((a) => a.evidenceType === "companies_house_psc"), false);
  assert.equal(result.graph.acquisitions.find((a) => a.producerMetadata.sourceArea === "overview_website").outcomeReason, "CAPTCHA");
});

test("website failures do not downgrade complete authoritative API evidence", async () => {
  const result = await harness({ websiteCapture: async () => { throw new Error("browser unavailable"); } }).service.collect(input());
  assert.equal(result.summary.status, "successful");
  assert.equal(result.summary.structuredEvidenceStatus, "complete");
  assert.equal(result.summary.humanViewableEvidenceStatus, "unavailable");
  assert.equal(result.graph.acquisitions.filter((a) => a.sourceType === "public_registry_api" && a.outcome === "successful").length, 3);
  assert.equal(result.graph.acquisitions.filter((a) => a.sourceType === "public_website" && a.outcome === "failed").length, 3);
});

test("Officers and PSC website pagination preserves HTML and screenshots for every page", async () => {
  const capture = async (number, area) => {
    const pageCount = area === "overview_website" ? 1 : 3;
    return { area, url: `fixture://${area}`, paginationComplete: true, pages: Array.from({ length: pageCount }, (_, index) => ({ pageNumber: index + 1, url: `fixture://${area}?page=${index + 1}`, status: 200, capturedAt: "2026-08-16T12:00:00.000Z", html: Buffer.from(`${area} html ${index + 1}`), screenshot: Buffer.from(`${area} png ${index + 1}`), screenshotError: null })) };
  };
  const result = await harness({ websiteCapture: capture }).service.collect(input());
  for (const area of ["officers_website", "psc_website"]) {
    const acquisition = result.graph.acquisitions.find((a) => a.producerMetadata.sourceArea === area);
    const asset = result.graph.assets.find((a) => a.acquisitionId === acquisition.id);
    const artifacts = result.graph.artifacts.filter((a) => a.assetId === asset.id);
    assert.equal(acquisition.producerMetadata.pageCount, 3);
    assert.equal(acquisition.producerMetadata.paginationComplete, true);
    assert.equal(artifacts.length, 6);
    assert.deepEqual([...new Set(artifacts.map((a) => a.artifactMetadata.pageNumber))], [1, 2, 3]);
  }
});

test("partial screenshot failure preserves HTML and remains observable", async () => {
  const capture = async (number, area) => ({ area, url: `fixture://${area}`, paginationComplete: true, pages: [{ pageNumber: 1, url: `fixture://${area}`, status: 200, capturedAt: "2026-08-16T12:00:00.000Z", html: Buffer.from("preserved html"), screenshot: area === "officers_website" ? null : Buffer.from("png"), screenshotError: area === "officers_website" ? "screenshot failed" : null }] });
  const result = await harness({ websiteCapture: capture }).service.collect(input());
  const acquisition = result.graph.acquisitions.find((a) => a.producerMetadata.sourceArea === "officers_website");
  const asset = result.graph.assets.find((a) => a.acquisitionId === acquisition.id);
  const artifacts = result.graph.artifacts.filter((a) => a.assetId === asset.id);
  assert.equal(acquisition.outcome, "successful");
  assert.equal(acquisition.producerMetadata.captureStatus, "incomplete");
  assert.deepEqual(artifacts.map((a) => a.representationType), ["rendered_html"]);
  assert.equal(acquisition.producerMetadata.representationOutcomes.find((item) => item.representationType === "screenshot").outcome, "failed");
  assert.equal(result.summary.structuredEvidenceStatus, "complete");
  assert.equal(result.summary.humanViewableEvidenceStatus, "incomplete");
});

test("PSC statement and exemption pages are preserved as valid website evidence", async () => {
  const capture = async (number, area) => fixtureWebsiteCapture(number, area);
  const result = await harness({ websiteCapture: capture }).service.collect(input());
  const acquisition = result.graph.acquisitions.find((a) => a.producerMetadata.sourceArea === "psc_website");
  const asset = result.graph.assets.find((a) => a.acquisitionId === acquisition.id);
  const html = result.graph.artifacts.find((a) => a.assetId === asset.id && a.representationType === "rendered_html");
  assert.equal(acquisition.outcome, "successful");
  assert.equal(acquisition.producerMetadata.captureStatus, "complete");
  assert.match(result.inspection.artifacts[html.id].content, /No registrable person/);
});

test("partial pagination cannot masquerade as complete evidence", async () => {
  const result = await harness({ officerPageFailure: true }).service.collect(input());
  const acquisition = result.graph.acquisitions.find((a) => a.producerMetadata.sourceArea === "officers");
  assert.equal(acquisition.outcome, "failed");
  assert.equal(acquisition.producerMetadata.paginationComplete, false);
  assert.equal(acquisition.producerMetadata.partialPageCount, 1);
  assert.equal(result.graph.assets.some((a) => a.evidenceType === "companies_house_officers"), false);
});

test("authoritative company-number mismatch is inconclusive and not silently associated", async () => {
  const client = buildCompaniesHouseFixtureClient();
  client.profile = async () => ({ url: "fixture://profile", status: 200, contentType: "application/json", bytes: Buffer.from('{"company_number":"87654321"}'), data: { company_number: "87654321" } });
  const result = await harness({ client }).service.collect(input());
  assert.equal(result.summary.status, "inconclusive");
  assert.equal(result.graph.assets.length, 0);
  assert.match(result.graph.acquisitions[0].outcomeReason, /did not correspond/);
});

test("retry replays one logical collection while recollection creates new history", async () => {
  const h = harness();
  const first = await h.service.collect(input("same-key"));
  const retry = await h.service.collect(input("same-key"));
  const recollection = await h.service.collect(input("new-key"));
  assert.equal(retry.replayed, true);
  assert.equal(h.repository.collections.size, 2);
  assert.notEqual(first.collection.id, recollection.collection.id);
  assert.equal(first.graph.artifacts[0].fingerprintValue, recollection.graph.artifacts[0].fingerprintValue);
  assert.notEqual(first.graph.artifacts[0].id, recollection.graph.artifacts[0].id);
});

test("PSC source bands remain bounded rather than false exact percentages", () => {
  assert.deepEqual(ownershipBand(["ownership-of-shares-25-to-50-percent"]), { minimumExclusive: 25, maximumInclusive: 50, sourceCode: "ownership-of-shares-25-to-50-percent" });
});

test("Companies House producer has no inherent FI schema assumption", async () => {
  const result = await harness().service.collect(input());
  assert.equal(result.graph.extractionRuns.some((run) => /FI:uk-licence/i.test(run.schemaReference)), false);
  assert.equal(result.graph.informationNeeds.some((need) => /FI:uk-licence/i.test(need.schemaReference)), false);
});
