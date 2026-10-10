"use strict";

const test = require("node:test");
const { expandSharedAnalyses } = require("../../../src/uboDemo/customer/recalculationStorage");
const assert = require("node:assert/strict");
const {
  PocCaseService,
  RELEASE_STATE,
  compactCaseRecordForTransport,
  evaluateResearchRelease,
  projectCommand,
  recordedKey,
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
    // Recorded as the Postgres repository records it: per round of the case.
    const key = recordedKey(this.state.get(command.caseId)?.projection, command.operation, command.idempotencyKey);
    if (key === null) return { record: this.state.get(command.caseId), duplicate: true };
    const eventKey = `${command.operation}:${key}`;
    const events = this.events.get(command.caseId) || [];
    const duplicate = events.some((event) => event.eventId === eventKey);
    if (duplicate && command.operation !== "SUBMIT_ANSWER") return { record: this.state.get(command.caseId), duplicate: true };
    const previous = this.state.get(command.caseId);
    const projection = projectCommand(previous?.projection, command.operation, command.payload, command.release);
    const record = {
      caseId: command.caseId,
      company: command.payload.company || command.payload.demoCase?.company || previous?.company,
      projection,
      updatedAt: new Date().toISOString(),
    };
    this.state.set(command.caseId, record);
    if (!duplicate) this.events.set(command.caseId, [...events, { eventId: eventKey, eventType: command.operation }]);
    return { record, duplicate };
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

test("a source-limited partial with usable facts can hand off unannotated question-stage topics", () => {
  const release = evaluateResearchRelease({
    status: "PARTIAL",
    candidateSources: [{
      sourceType: "LEGACY_DISCOVERY",
      candidateFacts: [{ factId: "fact-1", type: "RELATIONSHIP" }],
      issues: [{
        code: "LEGACY_KNOWN_COVERAGE_LIMITATION",
        message: "Legacy Discovery is lossy and cannot establish exhaustive current ownership and control",
      }],
    }],
    providerOutcomes: [{ provider: "COMPANIES_HOUSE", outcome: "COMPLETE", reasonCode: "FACTS_RETURNED" }],
    view: { informationNeeds: [
      { needId: "nominee", concept: "NOMINEE_BEARER_STATUS", status: "OPEN" },
      { needId: "voting", concept: "VOTING_CONTROL_STATUS", status: "OPEN" },
      { needId: "trust", concept: "TRUST_STATUS", status: "OPEN" },
    ] },
  });
  assert.equal(release.state, RELEASE_STATE.PARTIAL_NON_MATERIAL);
  assert.equal(release.mayProceed, true);
  assert.deepEqual(release.materialFrontier, []);
  assert.deepEqual(release.limitations.map(({ reasonCode }) => reasonCode), ["LEGACY_KNOWN_COVERAGE_LIMITATION"]);
});

test("a partial with usable facts but no stated limitation remains blocked", () => {
  const release = evaluateResearchRelease({
    status: "PARTIAL",
    candidateSources: [{ candidateFacts: [{ factId: "fact-1", type: "RELATIONSHIP" }] }],
    providerOutcomes: [{ provider: "COMPANIES_HOUSE", outcome: "COMPLETE", reasonCode: "FACTS_RETURNED" }],
    view: { informationNeeds: [] },
  });
  assert.equal(release.state, RELEASE_STATE.PARTIAL_MATERIAL);
  assert.equal(release.mayProceed, false);
  assert.match(release.reason, /does not state its remaining provider or source limitations/);
});

test("case actions are idempotent and survive a service restart", async () => {
  const sharedState = new Map();
  const repository = new MemoryRepository(sharedState);
  const firstProcess = new PocCaseService(repository);
  const command = {
    operation: "UPSERT_CASE",
    caseId: "case-1",
    idempotencyKey: "create-1",
    // The analyst creates a case: a customer can no longer set its company.
    actorType: "ANALYST",
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

// UBO-13: answers are computed on by the server from the case it holds, so
// these cases carry real research and a real chart (fixtures/caseAssessmentFixture).
const fixture = require("./fixtures/caseAssessmentFixture");
const { computeCaseAssessment } = require("../caseAssessment.js");

async function seededCase(repository, service, caseId) {
  await service.apply({ operation: "UPSERT_CASE", caseId, idempotencyKey: `create-${caseId}`, actorType: "ANALYST", payload: { company: fixture.company } });
  const record = await repository.get(caseId);
  repository.state.set(caseId, { ...record, projection: { ...record.projection, ...fixture.projection() } });
  const { resolution } = await computeCaseAssessment({ projection: fixture.projection(), caseId, operation: "SYNC_RESOLUTION", incoming: {}, findEvidenceResult: async () => null });
  return resolution.questions[0];
}

test("answer retries retain a single append-only action", async () => {
  const repository = new MemoryRepository();
  const service = new PocCaseService(repository);
  const question = await seededCase(repository, service, "case-2");
  const answer = {
    operation: "SUBMIT_ANSWER",
    caseId: "case-2",
    idempotencyKey: "answer:q1:no",
    actorType: "CUSTOMER",
    payload: { resolution: { answers: { [question.id]: { value: question.options[1].value, answeredAt: "2026-09-30T10:00:00.000Z", comparisonItemId: question.comparisonItemId } }, submittedAnswer: { question: { id: question.id } } } },
  };
  await service.apply(answer);
  const drifted = await repository.get("case-2");
  repository.state.set("case-2", { ...drifted, projection: { ...drifted.projection, resolution: { ...drifted.projection.resolution, answers: {} } } });
  const retry = await service.apply(answer);
  assert.equal(retry.duplicate, true);
  assert.equal((await repository.history("case-2")).filter(({ eventType }) => eventType === "SUBMIT_ANSWER").length, 1);
  assert.equal((await repository.get("case-2")).projection.resolution.answers[question.id].value, question.options[1].value);
});

test("durable projection preserves submitted answers when an older sync completes later", async () => {
  // Requests arrive out of order. The server merges answers and, per question,
  // keeps the most recent - an older sync cannot take a newer answer away.
  const repository = new MemoryRepository();
  const service = new PocCaseService(repository);
  const question = await seededCase(repository, service, "case-3");
  const newer = { value: question.options[0].value, answeredAt: "2026-09-28T10:00:02.000Z", comparisonItemId: question.comparisonItemId };
  const older = { value: question.options[1].value, answeredAt: "2026-09-28T10:00:01.000Z", comparisonItemId: question.comparisonItemId };
  await service.apply({ operation: "SUBMIT_ANSWER", caseId: "case-3", idempotencyKey: "answer:newer", payload: { resolution: { answers: { [question.id]: newer }, submittedAnswer: { question: { id: question.id } } } } });
  await service.apply({ operation: "SYNC_RESOLUTION", caseId: "case-3", idempotencyKey: "sync:older", payload: { resolution: { answers: { [question.id]: older } } } });
  assert.equal((await repository.get("case-3")).projection.resolution.answers[question.id].value, question.options[0].value);
});

test("case restore removes repeated immutable analysis internals without losing graph or assessment facts", () => {
  const repeated = "x".repeat(2_000_000);
  const chartAnalysis = {
    entityLabels: { person: "Alice Morgan" },
    view: {
      snapshot: { repeated },
      graph: {
        nodes: [{ entityId: "person", qualificationAssessment: { repeated } }],
        relationships: [{ relationshipId: "edge-1", subjectEntityId: "person", objectEntityId: "company" }],
        qualificationBasisRecords: [],
        personQualificationAssessments: [],
        companyAttributionAssessments: [{ repeated }],
      },
      qualificationBases: [],
      qualifications: [],
    },
  };
  const compact = compactCaseRecordForTransport({
    caseId: "oversize-case",
    projection: {
      researchResult: { status: "COMPLETE", candidateSources: [{ candidateFacts: [{ factId: "fact-1" }] }], ...chartAnalysis },
      chartProjection: { candidateFacts: [{ factId: "chart-fact" }], chartAnalysis },
      resolution: {
        answers: { q1: { value: 40 } },
        recalculations: { q1: { determination: "UBO", chartAnalysis }, q2: { determination: "NOT_UBO", chartAnalysis } },
      },
      assessment: { trace: { verificationPopulation: [{ personName: "Alice Morgan" }] } },
    },
    extraction: { jobId: "job-1", state: "COMPLETE", result: { chartAnalysis } },
  });

  assert.equal(compact.extraction.result, undefined);
  assert.equal(compact.projection.researchResult.view.snapshot, undefined);
  assert.equal(compact.projection.chartProjection.chartAnalysis.view.snapshot, undefined);
  assert.equal(compact.projection.resolution.recalculations.q1.chartAnalysis.view.graph.companyAttributionAssessments, undefined);
  // The same analysis on two rows is kept once; reading it back restores it.
  assert.equal(compact.projection.resolution.recalculations.q2.chartAnalysisSameAs, "q1");
  assert.equal(expandSharedAnalyses(compact.projection.resolution.recalculations).q2.chartAnalysis.view.graph.relationships.length, 1);
  assert.equal(compact.projection.assessment.trace.verificationPopulation[0].personName, "Alice Morgan");
  assert.ok(JSON.stringify(compact).length < 20_000);
});

test("case restore bounds dense route evidence while preserving the recorded result and graph", () => {
  const relationships = Array.from({ length: 12 }, (_, index) => ({
    relationshipId: `edge-${index}`,
    subjectEntityId: `entity-${index}`,
    objectEntityId: index === 11 ? "target" : `entity-${index + 1}`,
    relationshipType: "VOTING_RIGHTS",
    measurement: { type: "EXACT", value: 60 },
  }));
  const routes = Array.from({ length: 800 }, (_, index) => ({
    pathId: `route-${index}`,
    state: "VALID",
    relationshipIds: relationships.map(({ relationshipId }) => relationshipId),
    contribution: { type: "EXACT", value: 40 },
    majoritySteps: relationships.map((relationship) => ({ ...relationship, repeatedProviderTrace: "x".repeat(5000) })),
  }));
  const basis = {
    basisId: "dense-control-basis",
    personEntityId: "person",
    route: "PSC_CONDITION_ATTRIBUTION",
    assessmentState: "SATISFIED",
    recordedCalculation: { value: { type: "EXACT", value: 40 } },
    attributionChains: routes,
  };
  const compact = compactCaseRecordForTransport({
    caseId: "dense-case",
    projection: {
      researchResult: {
        status: "COMPLETE",
        candidateSources: [{ candidateFacts: [{ factId: "fact-1" }] }],
        view: {
          graph: {
            subjectEntityId: "target",
            nodes: [{ entityId: "person" }, { entityId: "target" }],
            relationships,
            qualificationBasisRecords: [basis],
            personQualificationAssessments: [{ personEntityId: "person", routeStatus: "ROUTE_SATISFIED" }],
          },
          qualificationBases: [basis],
          qualifications: [{ personEntityId: "person", routeStatus: "ROUTE_SATISFIED" }],
        },
      },
    },
  });

  const saved = compact.projection.researchResult.view.qualificationBases[0];
  assert.deepEqual(saved.recordedCalculation.value, { type: "EXACT", value: 40 });
  assert.deepEqual(compact.projection.researchResult.view.graph.relationships, relationships);
  assert.equal(saved.attributionChains.length, 256);
  assert.equal(saved.attributionChains[0].majoritySteps, undefined);
  assert.deepEqual(saved.attributionChains[0].majorityStepRelationshipIds, relationships.map(({ relationshipId }) => relationshipId));
  assert.deepEqual(saved.pathInventory, {
    orderedPathCount: 0,
    persistedOrderedPathCount: 0,
    attributionChainCount: 800,
    persistedAttributionChainCount: 256,
    truncated: true,
  });
  assert.ok(JSON.stringify(compact).length < 1_000_000);
});

// Review of the rounds fix (2026-10-09): a case reopened before rounds existed
// has no round, and its old finalisation was recorded under the bare key. The
// next finalisation, with the same inputs, must not be taken for that one.
test("a key recorded before rounds existed never matches a step made after them", () => {
  const legacy = { assessment: null }; // reopened before the change: no round
  const bareKeyFromBefore = "assessment:ubo-assessment:abc";
  assert.notStrictEqual(recordedKey(legacy, "FINALIZE_ASSESSMENT", bareKeyFromBefore), bareKeyFromBefore);
  assert.strictEqual(recordedKey(legacy, "FINALIZE_ASSESSMENT", bareKeyFromBefore), `${bareKeyFromBefore}#round-0`);
  // Within a round a retry still matches itself, and a reset stays one reset.
  assert.strictEqual(recordedKey({ round: 2 }, "SUBMIT_ANSWER", "a1"), recordedKey({ round: 2 }, "SUBMIT_ANSWER", "a1"));
  assert.strictEqual(recordedKey({ round: 2 }, "RESET_ANSWERS", "reset-1"), "reset-1");
});

// Review of the rounds fix (2026-10-09): a finalisation whose answer was lost,
// retried after the analyst reopened, must not undo the reopen.
test("a step that says it was made in an earlier round is refused; one that says nothing is taken", async () => {
  const { PostgresPocCaseRepository } = require("../pocCaseState");
  const repository = new PostgresPocCaseRepository({ transaction: async (work) => work({
    query: async (sql) => (/SELECT/i.test(sql) && /FOR UPDATE/i.test(sql)
      ? { rows: [{ case_id: "case-1", tenant_id: "acme", company: {}, current_projection: { round: 2 }, version: 7, updated_at: new Date() }] }
      : { rows: [] }),
  }) }, "acme");
  await assert.rejects(
    () => repository.apply({ caseId: "case-1", operation: "FINALIZE_ASSESSMENT", idempotencyKey: "assessment:x", actorType: "CUSTOMER", payload: {}, round: 1 }),
    { code: "case_round_changed", statusCode: 409 },
  );
});
