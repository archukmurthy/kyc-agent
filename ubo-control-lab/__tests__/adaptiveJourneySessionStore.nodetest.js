"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { startAdaptiveJourney, applyAdaptiveFixtureReview } = require("../server/adaptiveJourneyLab");
const { STORAGE_KEY, createAdaptiveJourneyCache } = require("../browser/adaptiveJourneySessionStore");

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
    raw(key) { return values.get(key); },
  };
}

async function session() {
  const started = await startAdaptiveJourney({ scenarioId: "UAJ-01-HYBRID-ANSWER", company: { name: "Cache Test Ltd", country: "GB", registrationNumber: "UAJ00999" } });
  return applyAdaptiveFixtureReview({ session: started });
}

test("UAJ-01 browser cache resumes the sealed same-case session without bytes or credentials", async () => {
  const storage = memoryStorage();
  const cache = createAdaptiveJourneyCache(storage);
  const source = await session();
  await cache.save(source);
  const restored = await cache.restore();
  assert.equal(restored.error, null);
  assert.deepEqual(restored.record.session, source);
  assert.equal(restored.record.activeSnapshotId, source.snapshots.at(-1).snapshot.snapshotId);
  assert.doesNotMatch(storage.raw(STORAGE_KEY), /credential|accessToken|evidenceBytes|blob:|filePath/i);
});

test("UAJ-01 browser cache fails closed on tampering and can be cleared", async () => {
  const storage = memoryStorage();
  const cache = createAdaptiveJourneyCache(storage);
  await cache.save(await session());
  const parsed = JSON.parse(storage.raw(STORAGE_KEY));
  parsed.session.company.name = "Tampered Ltd";
  storage.setItem(STORAGE_KEY, JSON.stringify(parsed));
  const restored = await cache.restore();
  assert.equal(restored.record, null);
  assert.match(restored.error, /corrupted|unsafe/);
  cache.clear();
  assert.equal(storage.getItem(STORAGE_KEY), null);
});

test("UAJ-01 browser cache rejects forbidden byte/path-bearing values", async () => {
  const cache = createAdaptiveJourneyCache(memoryStorage());
  const unsafe = await session();
  unsafe.evidenceBytes = "abc";
  await assert.rejects(() => cache.save(unsafe), /Unsafe adaptive journey cache field/);
});
