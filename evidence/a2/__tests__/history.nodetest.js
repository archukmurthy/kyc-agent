"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { MemoryA2Repository, PostgresA2Repository } = require("../repository");
const { EvidenceCollectionHistoryService } = require("../historyService");
const { CompaniesHouseEvidenceService } = require("../service");
const { MemoryArtifactStore } = require("../artifactStore");
const { buildCompaniesHouseFixtureClient, fixtureWebsiteCapture } = require("../fixtures");

function collectingService(repository, calls, fixtureOptions = {}, artifactStore = new MemoryArtifactStore()) {
  const client = buildCompaniesHouseFixtureClient(fixtureOptions);
  const counted = Object.fromEntries(Object.entries(client).map(([name, fn]) => [name, async (...args) => { calls.push(name); return fn(...args); }]));
  let tick = 0;
  return new CompaniesHouseEvidenceService({ repository, artifactStore, client: counted, websiteCapture: async (...args) => { calls.push("websiteCapture"); return fixtureWebsiteCapture(...args); }, now: () => `2026-08-18T10:00:0${tick++}.000Z` });
}

test("historical lookup reopens latest usable public live collection without source calls or writes", async () => {
  const repository = new MemoryA2Repository(), calls = [], collector = collectingService(repository, calls);
  const first = await collector.collect({ producer: "companies_house", producerRequestKey: "first", collectionCoordinates: { jurisdiction: "GB", companyNumber: "12345678" }, mode: "live" });
  const second = await collector.collect({ producer: "companies_house", producerRequestKey: "second", collectionCoordinates: { jurisdiction: "GB", companyNumber: "12345678" }, mode: "live" });
  const callCount = calls.length, collectionsBefore = structuredClone([...repository.collections.values()]), graphsBefore = structuredClone([...repository.graphs.values()]);
  const reopened = await new EvidenceCollectionHistoryService(repository).findLatestCompaniesHouse({ jurisdiction: "GB", companyNumber: "12345678" });
  assert.equal(reopened.found, true); assert.equal(reopened.summary.collectionId, second.summary.collectionId); assert.notEqual(reopened.summary.collectionId, first.summary.collectionId);
  assert.equal(reopened.externalSourceCall, false); assert.equal(reopened.writesPerformed, false); assert.equal(calls.length, callCount);
  assert.deepEqual([...repository.collections.values()], collectionsBefore); assert.deepEqual([...repository.graphs.values()], graphsBefore);
  assert.equal(reopened.summary.assets.every((asset) => asset.accessClass === "public"), true);
  assert.equal(JSON.stringify(reopened).includes("storageReference"), false); assert.equal(JSON.stringify(reopened).includes("storageKey"), false);
});

test("a partial public live collection remains usable historical evidence", async () => {
  const repository = new MemoryA2Repository(), calls = [], collector = collectingService(repository, calls, { pscFailure: true });
  const created = await collector.collect({ producer: "companies_house", producerRequestKey: "partial", collectionCoordinates: { jurisdiction: "GB", companyNumber: "12345678" }, mode: "live" });
  assert.equal(created.summary.status, "partial");
  const reopened = await new EvidenceCollectionHistoryService(repository).findLatestCompaniesHouse({ jurisdiction: "GB", companyNumber: "12345678" });
  assert.equal(reopened.found, true); assert.equal(reopened.summary.status, "partial"); assert.ok(reopened.summary.artifacts.length > 0);
});

test("historical reopening safely hydrates JSON, HTML and screenshot previews from preserved storage", async () => {
  const repository = new MemoryA2Repository(), calls = [], artifactStore = new MemoryArtifactStore(), collector = collectingService(repository, calls, {}, artifactStore);
  await collector.collect({ producer: "companies_house", producerRequestKey: "preview", collectionCoordinates: { jurisdiction: "GB", companyNumber: "12345678" }, mode: "live" });
  const sourceCallsBefore = calls.length;
  const reopened = await new EvidenceCollectionHistoryService(repository, { artifactReader: { read: (artifact) => artifactStore.read(artifact.storageKey) } }).findLatestCompaniesHouse({ jurisdiction: "GB", companyNumber: "12345678" });
  const previews = Object.values(reopened.inspection.artifacts);
  assert.equal(previews.length, reopened.summary.artifacts.length); assert.ok(previews.some((preview) => preview.kind === "json" && preview.content.includes("ABC LIMITED"))); assert.ok(previews.some((preview) => preview.kind === "html" && preview.content.includes("<h1>ABC LIMITED</h1>"))); assert.ok(previews.some((preview) => preview.kind === "image" && preview.content.length > 0));
  assert.equal(calls.length, sourceCallsBefore); assert.equal(JSON.stringify(reopened).includes("storageKey"), false); assert.equal(JSON.stringify(reopened).includes("storageReference"), false);
});

test("unreadable or unverifiable historical Artifact is shown as unavailable without failing the collection", async () => {
  const repository = new MemoryA2Repository(), calls = [], collector = collectingService(repository, calls);
  await collector.collect({ producer: "companies_house", producerRequestKey: "unavailable-preview", collectionCoordinates: { jurisdiction: "GB", companyNumber: "12345678" }, mode: "live" });
  const reopened = await new EvidenceCollectionHistoryService(repository, { artifactReader: { async read() { throw new Error("private storage path"); } } }).findLatestCompaniesHouse({ jurisdiction: "GB", companyNumber: "12345678" });
  assert.equal(reopened.found, true); assert.ok(Object.values(reopened.inspection.artifacts).every((preview) => preview.kind === "unavailable")); assert.equal(JSON.stringify(reopened).includes("private storage path"), false);
});

test("fresh override creates another immutable collection and preserves the previous one", async () => {
  const repository = new MemoryA2Repository(), calls = [], collector = collectingService(repository, calls);
  const first = await collector.collect({ producer: "companies_house", producerRequestKey: "fresh-one", collectionCoordinates: { jurisdiction: "GB", companyNumber: "12345678" }, mode: "live" });
  const second = await collector.collect({ producer: "companies_house", producerRequestKey: "fresh-two", collectionCoordinates: { jurisdiction: "GB", companyNumber: "12345678" }, mode: "live" });
  assert.notEqual(first.summary.collectionId, second.summary.collectionId); assert.equal(repository.collections.size, 2); assert.equal(repository.graphs.size, 2);
  assert.ok([...repository.collections.values()].some((collection) => collection.id === first.summary.collectionId));
});

test("Postgres historical lookup is read-only and enforces live/public/success-or-partial", async () => {
  const calls = [];
  const repository = new PostgresA2Repository({ transaction() {}, async query(text, params) { calls.push({ text, params }); return { rows: [] }; } });
  await repository.findLatestReusableCollection({ producer: "companies_house", jurisdiction: "GB", companyNumber: "12345678" });
  assert.equal(calls.length, 1); assert.match(calls[0].text, /co\.mode='live'/); assert.match(calls[0].text, /successful','partial/); assert.match(calls[0].text, /a\.access_class='public'/);
  assert.doesNotMatch(calls[0].text, /\b(INSERT|UPDATE|DELETE)\b/i);
});
