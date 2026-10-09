"use strict";

// The attacks from the adversarial review of UBO-13, each reproduced on the
// real database before it was fixed. The case store is driven end to end over
// an in-memory repository that projects exactly as the Postgres one does.

const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const { PocCaseService, projectCommand, recordedKey } = require("../pocCaseState");
const fx = require("./fixtures/caseAssessmentFixture");

const CHART_JOB = { jobId: "job-chart", demoCaseId: "case-1", artifactId: "chart-artifact", state: "COMPLETE", company: fx.company, result: null, evidenceHandoff: null };

// Faithful to the Postgres repository where it matters: a step recorded under
// a key it has seen before changes nothing (ON CONFLICT DO NOTHING - except an
// answer, which is recomputed), and a step worked out from an older version of
// the case is refused (case_changed). A stand-in that applied every step hid
// the reopen defect: on the real database the re-finalisation was skipped.
function memoryRepository(chartPercentage = 30) {
  const state = new Map();
  const jobs = new Map([["job-chart", { ...CHART_JOB, result: fx.chartResult(chartPercentage) }]]);
  const evidence = new Map();
  const persisted = [];
  const events = new Set();
  let version = 0;
  return {
    state, jobs, evidence, persisted, events,
    get: async (caseId) => {
      const record = state.get(caseId);
      return record ? { ...record, version: record.version || String(version) } : null;
    },
    history: async () => [],
    extraction: async (jobId) => jobs.get(jobId) || null,
    evidenceResult: async (caseId, artifactId) => evidence.get(artifactId) || null,
    apply: async (command) => {
      const previous = state.get(command.caseId);
      if (command.expectedVersion && previous && (previous.version || String(version)) !== command.expectedVersion) {
        throw Object.assign(new Error("The case changed while this step was being worked out."), { statusCode: 409, code: "case_changed", retryable: true });
      }
      const key = recordedKey(previous?.projection, command.operation, command.idempotencyKey);
      if (key === null) return { duplicate: true, record: previous };
      const seen = events.has(`${command.operation}:${key}`);
      if (seen && command.operation !== "SUBMIT_ANSWER") return { duplicate: true, record: previous };
      events.add(`${command.operation}:${key}`);
      const projection = projectCommand(previous?.projection, command.operation, command.payload, command.release);
      version += 1;
      state.set(command.caseId, { caseId: command.caseId, company: projection.demoCase?.company || previous?.company, projection, version: String(version) });
      if (command.payload.assessment || command.payload.resolution) persisted.push(command.operation);
      return { duplicate: seen, record: state.get(command.caseId) };
    },
  };
}

async function openCase({ research = 25, chart = 30 } = {}) {
  const repository = memoryRepository(chart);
  const service = new PocCaseService(repository);
  const analyst = (operation, payload, key = operation) => service.apply({ caseId: "case-1", operation, idempotencyKey: key, actorType: "ANALYST", payload });
  const customer = (operation, payload, key = operation) => service.apply({ caseId: "case-1", operation, idempotencyKey: key, actorType: "CUSTOMER", payload });
  await analyst("UPSERT_CASE", { company: fx.company, demoCase: { demoCaseId: "case-1", referenceCaseId: "", company: fx.company }, draft: {} });
  await analyst("SAVE_RESEARCH", { researchResult: fx.researchResult(research) });
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

// Second review of the fixes (every finding reproduced first).

// How the questions screen would answer each question on an honest journey.
function honestValue(q) {
  const options = (q.options || []).map((o) => o.value);
  if (q.id.includes("EXPLAIN")) return "SHARE_TRANSFER";
  if (q.type === "PERCENTAGE") return 30;
  if (q.type === "DATE") return "2026-06-01";
  if (q.id.includes("CONFIRM_CURRENT")) return "YES";
  if (options.includes("NO")) return "NO";
  if (options.includes("DAY_TO_DAY_MANAGEMENT")) return "DAY_TO_DAY_MANAGEMENT";
  if (options.length) return options[0];
  return q.id.includes("ROLE") ? "Managing Director" : "Bob Smith";
}

test("an honest customer can answer the no-owner journey all the way down to senior management", async () => {
  // Review: answers were accepted one question level per round, five rounds
  // at most - the senior-manager questions, six deep, were refused and the
  // case could never be finalised.
  const { customer, projection } = await openCase({ research: 5, chart: 5 });
  let answered = 0;
  for (let round = 0; round < 20; round += 1) {
    const open = questionsOf(projection()).find((q) => !projection().resolution.answers[q.id]);
    if (!open) break;
    await answer(customer, open, honestValue(open), `deep-${round}`);
    answered += 1;
  }
  assert.ok(answered >= 6, `only ${answered} questions were asked - the journey did not go deep`);
  assert.strictEqual(Object.keys(projection().resolution.answers).length, answered, "an honest answer was dropped");
});

test("a finalised trace copied into the analyst's research is not taken for the case's own", async () => {
  // Review: a finalised trace travelled back inside SAVE_RESEARCH, froze the
  // case and let identity verification complete against it.
  const { analyst, customer, projection } = await openCase();
  const stale = { ...projection().assessment.trace, computedBy: "server", discoveryState: "READY_FOR_IDV", verificationAssessment: { ...projection().assessment.trace.verificationAssessment, finalized: true, blockingIssues: [] } };
  await analyst("SAVE_RESEARCH", { researchResult: { ...fx.researchResult(), ownershipResolutionTrace: stale } }, "resave");
  assert.strictEqual(projection().researchResult.ownershipResolutionTrace, undefined, "research does not carry a trace");
  await customer("SYNC_RESOLUTION", {}, "after-resave");
  const person = stale.verificationAssessment.verificationPopulation[0];
  await assert.rejects(customer("COMPLETE_IDV", { personId: person.personId }, "stale-idv"), (error) => error.code === "not_finalized");
});

async function finalisedCase() {
  const opened = await openCase();
  const { repository, projection } = opened;
  const record = repository.state.get("case-1");
  const finalised = { ...projection().assessment.trace, computedBy: "server", verificationAssessment: { ...projection().assessment.trace.verificationAssessment, finalized: true } };
  repository.state.set("case-1", { ...record, projection: { ...record.projection, assessment: { trace: finalised }, resolution: { ...record.projection.resolution, trace: finalised } } });
  return opened;
}

test("a finalised case's chart cannot be re-attached to get round the lock", async () => {
  const { customer, projection } = await finalisedCase();
  await assert.rejects(customer("ASSOCIATE_CHART", { chartReference: { jobId: "job-chart", calculationMethod: "POLICY_ALL_ROUTES" } }, "reattach"), (error) => error.code === "case_finalized");
  assert.ok(projection().assessment, "the finalised assessment is still there");
});

test("an analyst can reopen a finalised case; a customer cannot", async () => {
  const { analyst, customer, projection } = await finalisedCase();
  await assert.rejects(customer("REOPEN_CASE", {}, "c-reopen"), (error) => error.code === "not_a_customer_operation" || error.statusCode === 403);
  await analyst("REOPEN_CASE", {}, "reopen");
  assert.strictEqual(projection().assessment, null);
  await customer("SYNC_RESOLUTION", {}, "after-reopen");
  assert.ok(projection().assessment.trace.computedBy === "server");
});

test("one document can evidence two requests when its contents support both", async () => {
  const { customer } = await openCase();
  const { decideEvidenceForTest } = require("../caseAssessment");
  const verified = { artifact: { integrityVerified: true }, candidateFacts: [] };
  const records = [{ id: "r1", comparisonItemId: "c1", handoff: { requestedConcepts: ["ECONOMIC_OWNERSHIP"] } }, { id: "r2", comparisonItemId: "c2", handoff: { requestedConcepts: ["ECONOMIC_OWNERSHIP"] } }];
  const out = await decideEvidenceForTest({ evidenceRequirements: records, resolutions: [] }, { r1: { artifactId: "register" }, r2: { artifactId: "register" } }, async () => ({ result: verified, evidenceHandoff: { requestedConcepts: ["ECONOMIC_OWNERSHIP"] } }), "chart-artifact", new Date().toISOString());
  assert.strictEqual(out.r1.status, out.r2.status, "the same document was judged differently for two requests it equally supports");
  void customer;
});

test("a changed answer wins, whatever another device's clock said", async () => {
  // Review: an answer stamped a few minutes ahead by one device beat a later
  // change from another; the server kept the old answer and said 200.
  const { customer, projection } = await openCase();
  const q = questionsOf(projection())[0];
  const ahead = new Date(Date.now() + 4 * 60 * 1000).toISOString();
  await customer("SUBMIT_ANSWER", { resolution: { answers: { [q.id]: { value: q.options[0].value, answeredAt: ahead, comparisonItemId: q.comparisonItemId } }, submittedAnswer: { question: { id: q.id } } } }, "fast-clock");
  await answer(customer, q, q.options[1].value, "changed");
  assert.strictEqual(projection().resolution.answers[q.id].value, q.options[1].value);
});

test("a file uploaded as evidence cannot be attached as the ownership chart", async () => {
  const { repository, customer } = await openCase();
  repository.jobs.set("job-evidence", { ...CHART_JOB, jobId: "job-evidence", artifactId: "evidence-artifact", result: fx.chartResult(), evidenceHandoff: { requestedConcepts: ["ECONOMIC_OWNERSHIP"] } });
  await assert.rejects(customer("ASSOCIATE_CHART", { chartReference: { jobId: "job-evidence" } }, "evidence-as-chart"), (error) => error.code === "job_not_found" || error.code === "not_a_chart");
});

test("an analyst renaming the company drops the assessment computed for the old name", async () => {
  const { analyst, projection } = await openCase();
  assert.ok(projection().assessment);
  await analyst("UPSERT_CASE", { company: { ...fx.company, legalName: "Target Holdings Limited" }, demoCase: { demoCaseId: "case-1", company: { ...fx.company, legalName: "Target Holdings Limited" } } }, "rename");
  assert.strictEqual(projection().assessment, null);
});

// Third review: the second round's fixes, attacked.

test("a late retry of an older answer does not undo the newer one", async () => {
  // Review: stamping every submission with the server's time let a retried
  // older request win over the answer the customer gave after it.
  const { customer, projection } = await openCase();
  const q = questionsOf(projection())[0];
  const older = { value: q.options[0].value, answeredAt: new Date(Date.now() - 60 * 1000).toISOString(), comparisonItemId: q.comparisonItemId };
  const submitOlder = () => customer("SUBMIT_ANSWER", { resolution: { answers: { [q.id]: older }, submittedAnswer: { question: { id: q.id } } } }, "older");
  await submitOlder();
  await answer(customer, q, q.options[1].value, "newer");
  await submitOlder();
  assert.strictEqual(projection().resolution.answers[q.id].value, q.options[1].value);
});

test("a sync cannot bring an old answer back, however far ahead its clock", async () => {
  const { customer, projection } = await openCase();
  const q = questionsOf(projection())[0];
  const ahead = new Date(Date.now() + 4 * 60 * 1000).toISOString();
  await customer("SUBMIT_ANSWER", { resolution: { answers: { [q.id]: { value: q.options[0].value, answeredAt: ahead, comparisonItemId: q.comparisonItemId } }, submittedAnswer: { question: { id: q.id } } } }, "fast");
  await answer(customer, q, q.options[1].value, "changed");
  await customer("SYNC_RESOLUTION", { resolution: { answers: { [q.id]: { value: q.options[0].value, answeredAt: ahead, comparisonItemId: q.comparisonItemId } } } }, "fast-sync");
  assert.strictEqual(projection().resolution.answers[q.id].value, q.options[1].value);
});

test("research on a finalised case cannot be changed without reopening it", async () => {
  const { analyst, projection } = await finalisedCase();
  const current = projection().researchResult;
  await analyst("SAVE_RESEARCH", { researchResult: current }, "same-research");
  assert.ok(projection().assessment, "re-saving the same research is harmless");
  await assert.rejects(analyst("SAVE_RESEARCH", { researchResult: { ...fx.researchResult(60), jobId: "another-job" } }, "new-research"), (error) => error.code === "case_finalized");
});

test("new research drops the assessment computed from the old", async () => {
  const { analyst, projection } = await openCase();
  assert.ok(projection().assessment);
  await analyst("SAVE_RESEARCH", { researchResult: { ...fx.researchResult(60), jobId: "another-job" } }, "new-research");
  assert.strictEqual(projection().assessment, null);
});

test("renaming the company drops the chart read for the old one, and is refused once finalised", async () => {
  const renamed = { ...fx.company, legalName: "Target Holdings Limited" };
  const open = await openCase();
  await open.analyst("UPSERT_CASE", { company: renamed, demoCase: { demoCaseId: "case-1", company: renamed } }, "rename");
  assert.strictEqual(open.projection().chartProjection, undefined);
  assert.strictEqual(open.projection().chartReference, undefined);
  const final = await finalisedCase();
  await assert.rejects(final.analyst("UPSERT_CASE", { company: renamed, demoCase: { demoCaseId: "case-1", company: renamed } }, "rename-final"), (error) => error.code === "case_finalized");
});

test("reopening keeps the case's history for the next assessment", async () => {
  // Review: the reopened case lost its identity-verification completions and
  // audit trail - and the recomputed, identical assessment reset completed
  // people to REQUIRED.
  const { analyst, customer, projection, repository } = await finalisedCase();
  const record = repository.state.get("case-1");
  const ready = { ...projection().assessment.trace, discoveryState: "READY_FOR_IDV", verificationAssessment: { ...projection().assessment.trace.verificationAssessment, blockingIssues: [] } };
  repository.state.set("case-1", { ...record, projection: { ...record.projection, assessment: { trace: ready }, resolution: { ...record.projection.resolution, trace: ready } } });
  const person = ready.verificationAssessment.verificationPopulation[0];
  await customer("COMPLETE_IDV", { personId: person.personId }, "idv");
  const completed = projection().assessment.trace.idvCompletionHistory.map(({ personId }) => personId);
  assert.ok(completed.includes(person.personId));
  await analyst("REOPEN_CASE", {}, "reopen");
  await customer("SYNC_RESOLUTION", {}, "after-reopen");
  const trace = projection().assessment.trace;
  assert.strictEqual(trace.verificationAssessment.finalized, false);
  assert.ok((trace.idvCompletionHistory || []).some(({ personId }) => personId === person.personId), "the completed verification was lost on reopening");
});

// Fourth review: a case finalised the honest way, verified, then reopened.

async function verifiedCase() {
  process.env.UBO_POC_IDV_MODE = "DEMO";
  const opened = await openCase({ research: 30, chart: 30 });
  const { customer, projection } = opened;
  for (let round = 0; round < 20; round += 1) {
    const open = questionsOf(projection()).find((q) => !projection().resolution.answers[q.id]);
    if (!open) break;
    await answer(customer, open, honestValue(open), `v-${round}`);
  }
  await customer("FINALIZE_ASSESSMENT", {}, "finalise");
  const person = projection().assessment.trace.verificationAssessment.verificationPopulation[0];
  await customer("COMPLETE_IDV", { personId: person.personId }, "idv");
  return { ...opened, person };
}

test("an identity check done for one company does not carry over to a renamed one", async () => {
  const { analyst, projection } = await verifiedCase();
  await analyst("REOPEN_CASE", {}, "reopen");
  const renamed = { ...fx.company, legalName: "Other Holdings Limited", registrationNumber: "99887766" };
  await analyst("UPSERT_CASE", { company: renamed, demoCase: { demoCaseId: "case-1", company: renamed } }, "rename");
  assert.strictEqual(projection().resolution?.priorTrace, undefined, "the old company's history went with the rename");
});

test("a reopened case is not shown as in verification, or complete, until finalised again", async () => {
  const { analyst, customer, projection } = await verifiedCase();
  await analyst("REOPEN_CASE", {}, "reopen");
  await customer("SYNC_RESOLUTION", {}, "after-reopen");
  const trace = projection().assessment.trace;
  assert.ok(!["IDV_IN_PROGRESS", "IDV_COMPLETE"].includes(trace.discoveryState), trace.discoveryState);
  assert.ok(!["IDENTITY_VERIFICATION", "COMPLETE"].includes(projection().currentStage), projection().currentStage);
});

test("research with the same job but different facts is new research", async () => {
  const { analyst, projection } = await verifiedCase();
  const stage = projection().currentStage;
  await analyst("SAVE_RESEARCH", { researchResult: projection().researchResult }, "identical");
  assert.strictEqual(projection().currentStage, stage, "an identical re-save moved the case's stage");
  await assert.rejects(analyst("SAVE_RESEARCH", { researchResult: { ...projection().researchResult, candidateSources: fx.researchResult(5).candidateSources } }, "changed-facts"), (error) => error.code === "case_finalized");
});

test("an invalid answer is refused even when a newer answer is already stored", async () => {
  const { customer, projection } = await openCase();
  const q = questionsOf(projection())[0];
  await answer(customer, q, q.options[1].value, "current");
  await assert.rejects(customer("SUBMIT_ANSWER", { resolution: { answers: { [q.id]: { value: "GARBAGE", answeredAt: "2000-01-01T00:00:00.000Z", comparisonItemId: q.comparisonItemId } }, submittedAnswer: { question: { id: q.id } } } }, "garbage"), (error) => error.code === "invalid_answer");
});

test("a late, older answer is kept out without being recorded as this request's answer", async () => {
  const { customer, projection } = await openCase();
  const q = questionsOf(projection())[0];
  await answer(customer, q, q.options[1].value, "current");
  await customer("SUBMIT_ANSWER", { resolution: { answers: { [q.id]: { value: q.options[0].value, answeredAt: "2000-01-01T00:00:00.000Z", comparisonItemId: q.comparisonItemId } }, submittedAnswer: { question: { id: q.id } } } }, "late");
  assert.strictEqual(projection().resolution.answers[q.id].value, q.options[1].value);
  assert.strictEqual(projection().resolution.submittedAnswer, undefined, "the stored answer was recorded under the late request");
});

// Found in the browser test: the questions screen sends a sync alongside each
// answer. The sync read the case before the answer was written, computed from
// that old state, and wrote it back - erasing the answer. The server must not
// write a computation made from a case that has changed since it was read.
test("a sync computed from a case that changed meanwhile does not erase the answer saved in between", async () => {
  const { repository, customer, projection } = await openCase();
  const q = questionsOf(projection())[0];
  // The stand-in versions the case as the database does. The sync reads now,
  // but the answer lands before it writes.
  let releaseSync;
  const syncRead = new Promise((resolve) => { releaseSync = resolve; });
  const firstGet = repository.get;
  let syncHeld = false;
  repository.get = async (caseId) => {
    const record = await firstGet(caseId);
    if (!syncHeld) { syncHeld = true; await syncRead; }
    return record;
  };
  const sync = customer("SYNC_RESOLUTION", {}, "racing-sync");
  await new Promise((resolve) => setImmediate(resolve));
  repository.get = firstGet;
  await answer(customer, q, q.options[1].value, "answer-in-between");
  releaseSync();
  await sync;
  assert.strictEqual(projection().resolution.answers[q.id]?.value, q.options[1].value, "the sync erased the answer saved in between");
});

// Steps keyed by what they carry come round again once the computed state is
// dropped: a reopen, a reset. On the real database the repeat was taken for a
// retry and skipped (review, 2026-10-09).

test("after a reopen, finalising again with unchanged answers is applied", async () => {
  const { analyst, customer, projection, person } = await verifiedCase();
  await analyst("REOPEN_CASE", {}, "reopen");
  await customer("SYNC_RESOLUTION", {}, "after-reopen");
  // The browser's key is the hash of the inputs - unchanged, so the same key.
  const refinalised = await customer("FINALIZE_ASSESSMENT", {}, "finalise");
  assert.strictEqual(refinalised.duplicate, false, "the re-finalisation was taken for a retry");
  assert.strictEqual(projection().assessment.trace.verificationAssessment.finalized, true);
  await customer("COMPLETE_IDV", { personId: person.personId }, "idv");
  // A second reopen of the re-finalised case, from the same screen, works too.
  await analyst("REOPEN_CASE", {}, "reopen");
  assert.strictEqual(projection().assessment, null, "the second reopen was skipped");
});

test("the page-open sync after a reopen computes the assessment, whatever its key", async () => {
  const { analyst, customer, projection } = await verifiedCase();
  await analyst("REOPEN_CASE", {}, "reopen");
  // openCase synced under this key before the case was finalised.
  await customer("SYNC_RESOLUTION", {});
  assert.ok(projection().assessment, "the sync after the reopen was skipped - no assessment");
});

test("a retried step in the same round is still applied once", async () => {
  const { analyst, customer } = await verifiedCase();
  await analyst("REOPEN_CASE", {}, "reopen");
  const retriedReopen = await analyst("REOPEN_CASE", {}, "reopen");
  assert.strictEqual(retriedReopen.duplicate, true, "a reopen of a case already reopened changes nothing");
  await customer("SYNC_RESOLUTION", {}, "after-reopen");
  assert.strictEqual((await customer("FINALIZE_ASSESSMENT", {}, "again")).duplicate, false);
  assert.strictEqual((await customer("FINALIZE_ASSESSMENT", {}, "again")).duplicate, true);
});

test("after a reset, the same evidence upload counts again", async () => {
  const { repository, customer, projection } = await openCase();
  const difference = questionsOf(projection()).find((q) => q.id.includes("EXPLAIN_OWNERSHIP_DIFFERENCE"));
  const answerAll = async (prefix) => {
    for (let round = 0; round < 6; round += 1) {
      const open = questionsOf(projection()).find((q) => !projection().resolution.answers[q.id]);
      if (!open) break;
      await answer(customer, open, honestValue(open), `${prefix}-${round}`);
    }
  };
  assert.ok(difference);
  await answerAll("first");
  const requirement = projection().resolution.evidenceRequirements[0];
  const reading = fx.chartResult(30);
  repository.evidence.set("transfer-record", { result: { ...reading, artifact: { ...reading.artifact, artifactId: "transfer-record", integrityVerified: true } }, evidenceHandoff: { requestedConcepts: requirement.handoff.requestedConcepts } });
  const upload = { resolution: { evidence: { [requirement.id]: { artifactId: "transfer-record" } } } };
  await customer("SYNC_RESOLUTION", upload, `evidence:${requirement.id}:transfer-record`);
  assert.strictEqual(projection().resolution.evidence[requirement.id].status, "SATISFIED");
  await customer("RESET_ANSWERS", {}, "reset-1");
  assert.deepStrictEqual(projection().resolution.evidence, {});
  // The same answers and the same file: the same keys as the first time.
  await answerAll("first");
  await customer("SYNC_RESOLUTION", upload, `evidence:${requirement.id}:transfer-record`);
  assert.strictEqual(projection().resolution.evidence[requirement.id]?.status, "SATISFIED", "the re-upload after the reset was ignored");
});
