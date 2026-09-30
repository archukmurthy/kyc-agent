"use strict";

// The attacks from the adversarial review of UBO-13, each reproduced on the
// real database before it was fixed. The case store is driven end to end over
// an in-memory repository that projects exactly as the Postgres one does.

const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const { PocCaseService, projectCommand } = require("../pocCaseState");
const fx = require("./fixtures/caseAssessmentFixture");

const CHART_JOB = { jobId: "job-chart", demoCaseId: "case-1", artifactId: "chart-artifact", state: "COMPLETE", company: fx.company, result: null, evidenceHandoff: null };

function memoryRepository() {
  const state = new Map();
  const jobs = new Map([["job-chart", { ...CHART_JOB, result: fx.chartResult() }]]);
  const evidence = new Map();
  const persisted = [];
  return {
    state, jobs, evidence, persisted,
    get: async (caseId) => state.get(caseId) || null,
    history: async () => [],
    extraction: async (jobId) => jobs.get(jobId) || null,
    evidenceResult: async (caseId, artifactId) => evidence.get(artifactId) || null,
    apply: async (command) => {
      const previous = state.get(command.caseId);
      const projection = projectCommand(previous?.projection, command.operation, command.payload, command.release);
      state.set(command.caseId, { caseId: command.caseId, company: projection.demoCase?.company || previous?.company, projection });
      if (command.payload.assessment || command.payload.resolution) persisted.push(command.operation);
      return { duplicate: false, record: null };
    },
  };
}

async function openCase() {
  const repository = memoryRepository();
  const service = new PocCaseService(repository);
  const analyst = (operation, payload, key = operation) => service.apply({ caseId: "case-1", operation, idempotencyKey: key, actorType: "ANALYST", payload });
  const customer = (operation, payload, key = operation) => service.apply({ caseId: "case-1", operation, idempotencyKey: key, actorType: "CUSTOMER", payload });
  await analyst("UPSERT_CASE", { company: fx.company, demoCase: { demoCaseId: "case-1", referenceCaseId: "", company: fx.company }, draft: {} });
  await analyst("SAVE_RESEARCH", { researchResult: fx.researchResult() });
  await customer("ASSOCIATE_CHART", { chartReference: { jobId: "job-chart" } });
  await customer("SYNC_RESOLUTION", {});
  return { repository, service, analyst, customer, projection: () => repository.state.get("case-1").projection };
}

const questionsOf = (projection) => projection.resolution.questions;

let savedMode;
beforeEach(() => { savedMode = process.env.UBO_POC_IDV_MODE; process.env.UBO_POC_IDV_MODE = "DEMO"; });
afterEach(() => { if (savedMode === undefined) delete process.env.UBO_POC_IDV_MODE; else process.env.UBO_POC_IDV_MODE = savedMode; });

test("a chart can only be attached from a job - never from a chart the browser sends", async () => {
  const { customer, projection } = await openCase();
  const forged = fx.chartResult(25);
  await assert.rejects(customer("ASSOCIATE_CHART", { chartReference: {}, chartProjection: forged }, "forged"), (error) => error.code === "job_required");
  assert.strictEqual(projection().chartReference.jobId, "job-chart");
  assert.ok(questionsOf(projection()).some((q) => q.id.includes("EXPLAIN_OWNERSHIP_DIFFERENCE")), "the discrepancy question survives");
});

test("the chart reference is built from the job, not taken from the request", async () => {
  const { customer, projection } = await openCase();
  await customer("ASSOCIATE_CHART", { chartReference: { jobId: "job-chart", artifactId: "someone-elses-artifact" } }, "again");
  assert.strictEqual(projection().chartReference.artifactId, "chart-artifact");
});

test("a chart read for a different company cannot be attached", async () => {
  const { repository, customer } = await openCase();
  repository.jobs.set("job-other", { ...CHART_JOB, jobId: "job-other", company: { ...fx.company, legalName: "Other Co", registrationNumber: "999" }, result: fx.chartResult() });
  await assert.rejects(customer("ASSOCIATE_CHART", { chartReference: { jobId: "job-other" } }, "other"), (error) => error.code === "chart_company_mismatch");
});

test("a customer cannot rename the company the case is about", async () => {
  const { customer, projection } = await openCase();
  await customer("UPSERT_CASE", { demoCase: { demoCaseId: "case-1", company: { legalName: "Other Co", registrationNumber: "999" } }, company: {} }, "rename");
  assert.strictEqual(projection().demoCase.company.legalName, fx.company.legalName);
  await customer("SYNC_RESOLUTION", {}, "sync-after-rename");
  assert.ok(questionsOf(projection()).length >= 3, "renaming would have emptied the questions");
});

test("assessment rows cannot be slipped in through other steps", async () => {
  const { repository, customer } = await openCase();
  repository.persisted.length = 0;
  const forged = { assessmentId: "forged-final", trace: { verificationAssessment: { assessmentVersionId: "forged-final", finalized: true, verificationPopulation: [{ personId: "mallory" }] } } };
  await customer("UPSERT_CASE", { assessment: forged, resolution: { questions: [{ id: "forged-q" }] } }, "slip");
  assert.deepStrictEqual(repository.persisted, []);
});

test("identity verification waits for a finalised assessment", async () => {
  const { customer, projection } = await openCase();
  const person = projection().assessment.trace.verificationAssessment.verificationPopulation[0];
  await assert.rejects(customer("COMPLETE_IDV", { personId: person.personId }, "early"), (error) => error.code === "not_finalized");
});

async function answer(customer, question, value, key) {
  return customer("SUBMIT_ANSWER", { resolution: { answers: { [question.id]: { value, answeredAt: new Date().toISOString(), comparisonItemId: question.comparisonItemId, factRequirementId: question.factRequirementId } }, submittedAnswer: { question: { id: question.id } } } }, key);
}

test("the customer's own chart does not count as evidence for it, nor does a file not uploaded as evidence", async () => {
  const { repository, customer, projection } = await openCase();
  const difference = questionsOf(projection()).find((q) => q.id.includes("EXPLAIN_OWNERSHIP_DIFFERENCE"));
  await answer(customer, difference, "SHARE_TRANSFER", "a1");
  const requirement = projection().resolution.evidenceRequirements[0];
  assert.ok(requirement);
  repository.evidence.set("chart-artifact", { result: fx.chartResult(), evidenceHandoff: null });
  await customer("SYNC_RESOLUTION", { resolution: { evidence: { [requirement.id]: { artifactId: "chart-artifact", status: "SATISFIED" } } } }, "chart-as-evidence");
  assert.notStrictEqual(projection().resolution.evidence[requirement.id].status, "SATISFIED");
});

test("an answer from the future cannot pin itself over later answers", async () => {
  const { customer, projection } = await openCase();
  const q = questionsOf(projection())[0];
  const option = q.options[0].value;
  const other = q.options[1].value;
  await customer("SYNC_RESOLUTION", { resolution: { answers: { [q.id]: { value: option, answeredAt: "9999-12-31T00:00:00.000Z", comparisonItemId: q.comparisonItemId } } } }, "future");
  await answer(customer, q, other, "honest");
  assert.strictEqual(projection().resolution.answers[q.id].value, other);
});

test("an answer outside the question's choices is refused, not stored", async () => {
  const { customer, projection } = await openCase();
  const q = questionsOf(projection())[0];
  await assert.rejects(answer(customer, q, "SOMETHING_ELSE", "bad"), (error) => error.code === "invalid_answer" && error.statusCode === 400);
  assert.strictEqual(projection().resolution.answers[q.id], undefined);
});

test("an answer to a question that was never asked is ignored", async () => {
  const { customer, projection } = await openCase();
  await customer("SYNC_RESOLUTION", { resolution: { answers: { "question:not-asked": { value: 999, answeredAt: new Date().toISOString() } } } }, "unasked");
  assert.strictEqual(projection().resolution.answers["question:not-asked"], undefined);
});

test("starting the questions again clears the answers on the server too", async () => {
  const { customer, projection } = await openCase();
  const q = questionsOf(projection())[0];
  await answer(customer, q, q.options[0].value, "a1");
  await customer("RESET_ANSWERS", {}, "reset");
  assert.deepStrictEqual(projection().resolution.answers, {});
});

test("a trace written by a browser before UBO-13 is not trusted as history", async () => {
  const { repository, customer, projection } = await openCase();
  const record = repository.state.get("case-1");
  const legacy = { ...projection().assessment.trace, computedBy: undefined, idvCompletionHistory: [{ personId: "forged", verificationMode: "DEMO" }] };
  repository.state.set("case-1", { ...record, projection: { ...record.projection, assessment: { trace: legacy }, resolution: { ...record.projection.resolution, trace: legacy } } });
  await customer("SYNC_RESOLUTION", {}, "after-legacy");
  assert.deepStrictEqual(projection().assessment.trace.idvCompletionHistory || [], []);
});

test("once finalised, answers are locked", async () => {
  const { repository, customer, projection } = await openCase();
  const record = repository.state.get("case-1");
  const finalized = { ...projection().assessment.trace, computedBy: "server", verificationAssessment: { ...projection().assessment.trace.verificationAssessment, finalized: true } };
  repository.state.set("case-1", { ...record, projection: { ...record.projection, assessment: { trace: finalized } } });
  const q = questionsOf(projection())[0];
  await assert.rejects(answer(customer, q, q.options[0].value, "late"), (error) => error.code === "case_finalized");
  await assert.rejects(customer("SYNC_RESOLUTION", {}, "late-sync"), (error) => error.code === "case_finalized");
});

test("an upload made as evidence for this request counts; one made for another kind does not", async () => {
  // The job service stores only the concepts an evidence upload was for
  // (evidence/customerOwnershipJobs/service.js#validateRequest) - the first
  // version of this check compared whole requests and never matched.
  const { repository, customer, projection } = await openCase();
  // Answer everything asked, as a customer would: the transfer, its date and the 30%.
  const valueFor = (q) => (q.type === "PERCENTAGE" ? 30 : q.type === "DATE" ? "2026-09-01" : q.id.includes("EXPLAIN_OWNERSHIP_DIFFERENCE") ? "SHARE_TRANSFER" : (q.options.find((o) => o.value === "NO") || q.options[0]).value);
  for (let round = 0; round < 6; round += 1) {
    const open = questionsOf(projection()).find((q) => !projection().resolution.answers[q.id]);
    if (!open) break;
    await answer(customer, open, valueFor(open), `r${round}`);
  }
  const requirement = projection().resolution.evidenceRequirements[0];
  const reading = fx.chartResult(30);
  const verified = { ...reading, artifact: { ...reading.artifact, artifactId: "transfer-record", integrityVerified: true } };
  repository.evidence.set("transfer-record", { result: verified, evidenceHandoff: { requestedConcepts: requirement.handoff.requestedConcepts } });
  repository.evidence.set("other-kind", { result: verified, evidenceHandoff: { requestedConcepts: ["NOMINEE_ARRANGEMENT"] } });
  await customer("SYNC_RESOLUTION", { resolution: { evidence: { [requirement.id]: { artifactId: "other-kind" } } } }, "wrong-kind");
  assert.strictEqual(projection().resolution.evidence[requirement.id].status, "REJECTED");
  await customer("SYNC_RESOLUTION", { resolution: { evidence: { [requirement.id]: { artifactId: "transfer-record" } } } }, "right-kind");
  assert.strictEqual(projection().resolution.evidence[requirement.id].status, "SATISFIED");
});
