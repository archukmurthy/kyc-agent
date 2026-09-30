"use strict";

// Identity verification in the demo is a button: nobody's document is checked.
// That is only honest while the server - not the browser - decides three
// things: that this deployment is in demo mode at all, that the person really
// is someone the stored assessment says must be verified, and what gets
// recorded. A browser-sent trace saying "everyone is verified" is ignored.

const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const { PocCaseService } = require("../pocCaseState");

const STORED_TRACE = {
  contractVersion: "ubo-investigation-trace-v2",
  updatedAt: "2026-09-30T10:00:00.000Z",
  verificationAssessment: {
    assessmentVersionId: "assessment-1",
    inputStateVersion: "input-1",
    verificationPopulation: [
      { personId: "alice", personName: "Alice Example", partyType: "NATURAL_PERSON", currentRequirementStatus: "REQUIRED", assessmentVersionId: "assessment-1" },
      { personId: "bob", personName: "Bob Example", partyType: "NATURAL_PERSON", currentRequirementStatus: "REQUIRED", assessmentVersionId: "assessment-1" },
    ],
  },
  idvCompletionHistory: [],
  auditEvents: [],
};

function repositoryWith(trace = STORED_TRACE) {
  const applied = [];
  return {
    applied,
    get: async (caseId) => ({ caseId, projection: { assessment: { assessmentId: "assessment-1", trace } } }),
    extraction: async () => null,
    history: async () => [],
    apply: async (command) => { applied.push(command); return { duplicate: false, record: null }; },
  };
}

const FORGED = {
  ...STORED_TRACE,
  verificationAssessment: {
    ...STORED_TRACE.verificationAssessment,
    verificationPopulation: STORED_TRACE.verificationAssessment.verificationPopulation.map((p) => ({ ...p, verificationStatus: "COMPLETED" })),
  },
};

function completeIdv(service, personId) {
  return service.apply({
    caseId: "case-1",
    operation: "COMPLETE_IDV",
    idempotencyKey: `idv:${personId}`,
    actorType: "CUSTOMER",
    payload: { personId, trace: FORGED, assessment: { trace: FORGED }, researchResult: { ownershipResolutionTrace: FORGED } },
  });
}

let savedMode;
beforeEach(() => { savedMode = process.env.UBO_POC_IDV_MODE; delete process.env.UBO_POC_IDV_MODE; });
afterEach(() => {
  if (savedMode === undefined) delete process.env.UBO_POC_IDV_MODE;
  else process.env.UBO_POC_IDV_MODE = savedMode;
});

test("without demo mode switched on, nobody can be marked verified", async () => {
  const repository = repositoryWith();
  await assert.rejects(completeIdv(new PocCaseService(repository), "alice"), (error) => error.statusCode === 403 && error.code === "idv_demo_mode_off");
  assert.strictEqual(repository.applied.length, 0);
});

test("a live mode with no provider connected refuses too", async () => {
  process.env.UBO_POC_IDV_MODE = "LIVE";
  const repository = repositoryWith();
  await assert.rejects(completeIdv(new PocCaseService(repository), "alice"), (error) => error.code === "idv_demo_mode_off");
  assert.strictEqual(repository.applied.length, 0);
});

test("in demo mode the server records only the one person, from its own stored assessment", async () => {
  process.env.UBO_POC_IDV_MODE = "DEMO";
  const repository = repositoryWith();
  await completeIdv(new PocCaseService(repository), "alice");
  assert.strictEqual(repository.applied.length, 1);
  const { payload } = repository.applied[0];
  const population = payload.trace.verificationAssessment.verificationPopulation;
  assert.strictEqual(population.find((p) => p.personId === "alice").verificationStatus, "COMPLETED");
  assert.strictEqual(population.find((p) => p.personId === "bob").verificationStatus, undefined, "the forged trace marked Bob verified too");
  assert.strictEqual(payload.trace.idvCompletionHistory.length, 1);
  assert.strictEqual(payload.trace.idvCompletionHistory[0].verificationMode, "DEMO");
  assert.strictEqual(payload.trace.idvCompletionHistory[0].verificationLabel, "DEMO - not verified");
  assert.deepStrictEqual(payload.assessment.trace, payload.trace);
  assert.deepStrictEqual(payload.researchResult, undefined, "the browser's research result is not stored from this operation");
});

test("a person the stored assessment does not require cannot be marked verified", async () => {
  process.env.UBO_POC_IDV_MODE = "DEMO";
  const repository = repositoryWith();
  await assert.rejects(completeIdv(new PocCaseService(repository), "mallory"), (error) => error.statusCode === 400 && error.code === "idv_person_not_required");
  assert.strictEqual(repository.applied.length, 0);
});

test("a case with no stored assessment cannot have anyone verified", async () => {
  process.env.UBO_POC_IDV_MODE = "DEMO";
  const repository = repositoryWith(null);
  await assert.rejects(completeIdv(new PocCaseService(repository), "alice"), (error) => error.code === "idv_person_not_required");
  assert.strictEqual(repository.applied.length, 0);
});

test("repeating a completion records the same person, not whoever was verified last", async () => {
  process.env.UBO_POC_IDV_MODE = "DEMO";
  const alreadyDone = {
    ...STORED_TRACE,
    idvCompletionHistory: [
      { personId: "alice", personName: "Alice Example", completedAt: "2026-09-30T10:01:00.000Z", verificationMode: "DEMO", verificationLabel: "DEMO - not verified" },
      { personId: "bob", personName: "Bob Example", completedAt: "2026-09-30T10:02:00.000Z", verificationMode: "DEMO", verificationLabel: "DEMO - not verified" },
    ],
  };
  const repository = repositoryWith(alreadyDone);
  await completeIdv(new PocCaseService(repository), "alice");
  const { payload } = repository.applied[0];
  assert.strictEqual(payload.personId, "alice");
  assert.strictEqual(payload.trace.idvCompletionHistory.length, 2);
});

test("a person id is matched the way the engine matches it", async () => {
  process.env.UBO_POC_IDV_MODE = "demo";
  const repository = repositoryWith();
  await completeIdv(new PocCaseService(repository), "  ALICE ");
  assert.strictEqual(repository.applied[0].payload.personId, "alice");
});
