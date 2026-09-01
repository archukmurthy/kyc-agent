"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { CONTRACT_VERSION, STORAGE_KEY, createReplayLibrary, validReplayRecord } = require("../browser/replayStore");

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

function record(index = 1) {
  const registrationNumber = `0900000${index}`;
  return {
    contractVersion: CONTRACT_VERSION,
    replayId: `replay-${index}`,
    contentHash: `sha256:test-${index}`,
    savedAt: `2026-09-01T10:0${index}:00.000Z`,
    companyContext: { legalEntityName: `Captured Company ${index} Ltd`, registrationNumber, jurisdiction: "GB", entityProfile: "COMPANY", riskLevel: "LOW" },
    subject: { entityId: `captured-subject-${index}`, name: `Captured Company ${index} Ltd`, entityType: "COMPANY", jurisdiction: "GB", externalIdentifiers: [{ namespace: "COMPANIES_HOUSE_COMPANY_NUMBER", value: registrationNumber }] },
    discoveryResult: { contractVersion: "1.0.0", requestId: `captured-request-${index}`, outcome: { state: "PARTIAL" }, candidateFacts: [], operationEvidenceReferences: [], issues: [] },
  };
}

test("saved Discovery library survives reload, remains bounded and deletes by replay ID", () => {
  const storage = memoryStorage();
  const firstPage = createReplayLibrary(storage, { limit: 2 });
  firstPage.save(record(1));
  firstPage.save(record(2));
  firstPage.save(record(3));
  const reloadedPage = createReplayLibrary(storage, { limit: 2 });
  assert.deepEqual(reloadedPage.read().records.map(({ replayId }) => replayId), ["replay-3", "replay-2"]);
  assert.deepEqual(reloadedPage.remove("replay-3").map(({ replayId }) => replayId), ["replay-2"]);
  assert.deepEqual(createReplayLibrary(storage).read(), { records: [record(2)], error: null });
});

test("corrupted local replay data fails closed and can be cleared", () => {
  const storage = memoryStorage({ [STORAGE_KEY]: "{not-json" });
  const library = createReplayLibrary(storage);
  const result = library.read();
  assert.deepEqual(result.records, []);
  assert.match(result.error, /corrupted or unavailable/);
  assert.deepEqual(library.clear(), []);
  assert.deepEqual(library.read(), { records: [], error: null });
});

test("storage accepts only the normalized DiscoveryService result allowlist", () => {
  const safe = record(1);
  assert.equal(validReplayRecord(safe), true);
  const withLegacyConclusion = structuredClone(safe);
  withLegacyConclusion.discoveryResult.ubos = [{ name: "Legacy conclusion" }];
  assert.equal(validReplayRecord(withLegacyConclusion), false);
  assert.throws(() => createReplayLibrary(memoryStorage()).save(withLegacyConclusion), /invalid/);
});
