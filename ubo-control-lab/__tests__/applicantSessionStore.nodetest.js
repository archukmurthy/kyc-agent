"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  CONTRACT_VERSION,
  STORAGE_KEY,
  createApplicantSessionCache,
} = require("../browser/applicantSessionStore");

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    values,
  };
}
function session(overrides = {}) {
  const snapshotId = "sha256:fixture-snapshot";
  return {
    sessionId: "applicant-session-1",
    sourceMode: "FIXTURE",
    sourceIdentity: { fixtureId: "AJV2-01" },
    fixtureId: "AJV2-01",
    profileIdentity: { profileId: "ASDA-WAVE-9" },
    snapshots: [{ snapshot: {
      snapshotId,
      decisionContentHash: snapshotId,
      decisionContent: { policy: { identity: { policyPackId: "TEST", policyVersion: "1" } } },
    } }],
    customerActivityHistory: [{ activityId: "activity-1" }],
    completedCustomerAttempts: [{ attemptId: "attempt-1" }],
    ...overrides,
  };
}

test("cache has the governed Lab-only contract and key", () => {
  assert.equal(CONTRACT_VERSION, "ubo-control-lab-applicant-session-cache-v1");
  assert.equal(STORAGE_KEY, "ubo-control-lab.applicant-sessions.v2");
});

test("fixture and replay sessions preserve active snapshot, profile and customer history", async () => {
  const storage = memoryStorage();
  const cache = createApplicantSessionCache(storage);
  for (const sourceMode of ["FIXTURE", "REPLAY"]) {
    const value = session({ sessionId: `session-${sourceMode}`, sourceMode });
    await cache.save(value, { savedAt: `2026-09-10T10:00:0${sourceMode === "FIXTURE" ? 1 : 2}.000Z` });
  }
  const { records, error } = await cache.read();
  assert.equal(error, null);
  assert.equal(records.length, 2);
  assert.equal(records[0].activeSnapshotId, "sha256:fixture-snapshot");
  assert.equal(records[0].session.profileIdentity.profileId, "ASDA-WAVE-9");
  assert.equal(records[0].session.customerActivityHistory.length, 1);
  assert.equal(records[0].session.completedCustomerAttempts.length, 1);
  assert.match(records[0].integrityHash, /^sha256:[a-f0-9]{64}$/);
});

test("live sessions fail closed without explicit opt-in and carry no production-persistence claim", async () => {
  const storage = memoryStorage();
  const cache = createApplicantSessionCache(storage);
  const live = session({ sourceMode: "LIVE", sessionId: "live-session" });
  await assert.rejects(() => cache.save(live), /explicit local-save opt-in/);
  const saved = await cache.save(live, { liveOptIn: true });
  assert.equal(saved.sourceMode, "LIVE");
  assert.equal("productionPersistence" in saved, false);
});

test("corrupted, unsupported and authority-tampered records are rejected", async () => {
  const storage = memoryStorage();
  const cache = createApplicantSessionCache(storage);
  await cache.save(session());
  const corrupted = JSON.parse(storage.getItem(STORAGE_KEY));
  corrupted[0].session.snapshots[0].snapshot.snapshotId = "sha256:tampered";
  storage.setItem(STORAGE_KEY, JSON.stringify(corrupted));
  assert.match((await cache.read()).error, /corrupted|unsupported|unsafe/i);
  corrupted[0].contractVersion = "future-session-cache-v9";
  storage.setItem(STORAGE_KEY, JSON.stringify(corrupted));
  assert.match((await cache.read()).error, /corrupted|unsupported|unsafe/i);
});

test("unsafe Evidence bytes, provider secrets, Blob URLs and filesystem paths are never stored", async () => {
  const cache = createApplicantSessionCache(memoryStorage());
  await assert.rejects(() => cache.save(session({ evidenceBytes: "AAEC" })), /Unsafe Lab cache field/);
  await assert.rejects(() => cache.save(session({ providerSecret: "secret" })), /Unsafe Lab cache field/);
  await assert.rejects(() => cache.save(session({ unsafeValue: "blob:https://example.test/1" })), /Unsafe Lab cache value/);
  await assert.rejects(() => cache.save(session({ unsafeValue: "C:\\Users\\person\\document.pdf" })), /Unsafe Lab cache value/);
});

test("in-flight marker restores only the last stable session and never resubmits it", async () => {
  const cache = createApplicantSessionCache(memoryStorage());
  await cache.markInFlight(session(), "operation-1");
  const { record, error } = await cache.restoreLast();
  assert.equal(error, null);
  assert.equal(record.inFlightOperation.operationId, "operation-1");
  assert.equal(record.inFlightOperation.state, "SUBMISSION_STATUS_UNCERTAIN");
  assert.equal(record.session.acceptedOperations, undefined);
});

test("reset removes only the selected applicant session and does not touch Discovery replay storage", async () => {
  const storage = memoryStorage();
  storage.setItem("ubo-control-lab.discovery-replays.v1", "preserve-me");
  const cache = createApplicantSessionCache(storage);
  await cache.save(session({ sessionId: "first" }), { savedAt: "2026-09-10T10:00:01.000Z" });
  await cache.save(session({ sessionId: "second" }), { savedAt: "2026-09-10T10:00:02.000Z" });
  await cache.remove("second");
  assert.deepEqual((await cache.read()).records.map(({ sessionId }) => sessionId), ["first"]);
  assert.equal(storage.getItem("ubo-control-lab.discovery-replays.v1"), "preserve-me");
});
