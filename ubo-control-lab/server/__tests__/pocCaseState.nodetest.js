"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  PocCaseService,
  RELEASE_STATE,
  evaluateResearchRelease,
} = require("../pocCaseState.js");

function partialResult(informationNeeds = []) {
  return {
    status: "PARTIAL",
    candidateSources: [{ candidateFacts: [{ factId: "fact-1", type: "RELATIONSHIP" }] }],
    providerOutcomes: [{ provider: "WEB_RESEARCH", outcome: "TIMED_OUT", reasonCode: "PROVIDER_TIMEOUT" }],
    view: { informationNeeds },
  };
}

class MemoryRepository {
  constructor(state = new Map()) {
    this.state = state;
    this.events = new Map();
  }

  async get(caseId) { return this.state.get(caseId) || null; }
  async extraction() { return null; }
  async history(caseId) { return this.events.get(caseId) || []; }

  async apply(command) {
    const eventKey = `${command.operation}:${command.idempotencyKey}`;
    const events = this.events.get(command.caseId) || [];
    if (events.some((event) => event.eventId === eventKey)) return { record: this.state.get(command.caseId), duplicate: true };
    const previous = this.state.get(command.caseId);
    const projection = {
      ...(previous?.projection || {}),
      ...(command.payload.demoCase ? { demoCase: command.payload.demoCase } : {}),
      ...(command.payload.draft ? { draft: command.payload.draft } : {}),
      ...(command.payload.researchResult ? { researchResult: command.payload.researchResult } : {}),
      ...(command.release ? { researchRelease: command.release } : {}),
      ...(command.payload.resolution ? { resolution: command.payload.resolution } : {}),
      ...(command.payload.assessment ? { assessment: command.payload.assessment } : {}),
    };
    const record = {
      caseId: command.caseId,
      company: command.payload.company || command.payload.demoCase?.company || previous?.company,
      projection,
      updatedAt: new Date().toISOString(),
    };
    this.state.set(command.caseId, record);
    this.events.set(command.caseId, [...events, { eventId: eventKey, eventType: command.operation }]);
    return { record, duplicate: false };
  }
}

test("a partial result with only explicit non-material limitations may proceed", () => {
  const release = evaluateResearchRelease(partialResult([{ needId: "corroboration", concept: "INDEPENDENT_CORROBORATION", blocking: false }]));
  assert.equal(release.state, RELEASE_STATE.PARTIAL_NON_MATERIAL);
  assert.equal(release.mayProceed, true);
  assert.equal(release.usableFactCount, 1);
  assert.deepEqual(release.materialFrontier, []);
});

test("a partial result with a frontier capable of changing the UBO population is blocked", () => {
  const need = { needId: "unknown-owner", concept: "OWNERSHIP_PERCENTAGE", couldChangeVerificationPopulation: true };
  const release = evaluateResearchRelease(partialResult([need]));
  assert.equal(release.state, RELEASE_STATE.PARTIAL_MATERIAL);
  assert.equal(release.mayProceed, false);
  assert.deepEqual(release.materialFrontier, [need]);
});

test("a resolved material need does not keep a partial result blocked", () => {
  const release = evaluateResearchRelease(partialResult([{ needId: "resolved-owner", concept: "OWNERSHIP_PERCENTAGE", status: "RESOLVED", blocking: true }]));
  assert.equal(release.state, RELEASE_STATE.PARTIAL_NON_MATERIAL);
  assert.equal(release.mayProceed, true);
});

test("case actions are idempotent and survive a service restart", async () => {
  const sharedState = new Map();
  const repository = new MemoryRepository(sharedState);
  const firstProcess = new PocCaseService(repository);
  const command = {
    operation: "UPSERT_CASE",
    caseId: "case-1",
    idempotencyKey: "create-1",
    actorType: "CUSTOMER",
    payload: { company: { name: "Example Limited", companyNumber: "01234567" }, demoCase: { demoCaseId: "case-1", company: { name: "Example Limited" } } },
  };
  const created = await firstProcess.apply(command);
  const duplicate = await firstProcess.apply(command);
  assert.equal(created.duplicate, false);
  assert.equal(duplicate.duplicate, true);
  assert.equal((await repository.history("case-1")).length, 1);

  const restartedProcess = new PocCaseService(new MemoryRepository(sharedState));
  const restored = await restartedProcess.load("case-1");
  assert.equal(restored.caseId, "case-1");
  assert.equal(restored.projection.demoCase.company.name, "Example Limited");
});

test("answer retries retain a single append-only action", async () => {
  const repository = new MemoryRepository();
  const service = new PocCaseService(repository);
  await service.apply({ operation: "UPSERT_CASE", caseId: "case-2", idempotencyKey: "create-2", payload: { company: { name: "Example Limited" } } });
  const answer = {
    operation: "SUBMIT_ANSWER",
    caseId: "case-2",
    idempotencyKey: "answer:q1:no",
    actorType: "CUSTOMER",
    payload: { resolution: { answers: { q1: { value: "NO" } } } },
  };
  await service.apply(answer);
  const retry = await service.apply(answer);
  assert.equal(retry.duplicate, true);
  assert.equal((await repository.history("case-2")).filter(({ eventType }) => eventType === "SUBMIT_ANSWER").length, 1);
});
