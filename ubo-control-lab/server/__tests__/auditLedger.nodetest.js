"use strict";

// UBO-33: which audit events each case step records. The database side - the
// table refusing changes, and the purge - is in
// db/__tests__/tenantPurge.integration.nodetest.js.

const { test } = require("node:test");
const assert = require("node:assert");
const { eventsForCommand, documentEvent, record, EVENT_TYPES } = require("../auditLedger");

const RECEIVED = "2026-09-30T10:00:05.000Z";
const base = { caseId: "case-1", operationId: "op-1", correlationId: "corr-1", receivedAt: RECEIVED, actor: { type: "CUSTOMER", id: "user_1" } };
const types = (events) => events.map(({ eventType }) => eventType);

test("creating a case, and renaming its company, are recorded", () => {
  const company = { legalName: "Target Limited", registrationNumber: "00112233" };
  assert.deepStrictEqual(types(eventsForCommand({ ...base, operation: "UPSERT_CASE", before: null, after: { demoCase: { company } } })), ["CASE_CREATED"]);
  const renamed = eventsForCommand({ ...base, operation: "UPSERT_CASE", before: { demoCase: { company } }, after: { demoCase: { company: { ...company, legalName: "Target Holdings Limited" } } } });
  assert.deepStrictEqual(types(renamed), ["CASE_COMPANY_CHANGED"]);
  assert.deepStrictEqual(renamed[0].detail, { from: "Target Limited", to: "Target Holdings Limited" });
  assert.deepStrictEqual(eventsForCommand({ ...base, operation: "UPSERT_CASE", before: { demoCase: { company } }, after: { demoCase: { company } } }), []);
});

test("an answer keeps when it was given, when it arrived, and when it takes effect", () => {
  const question = { id: "q-date", type: "DATE", prompt: "When were the shares transferred?" };
  const after = { resolution: { questions: [question], submittedAnswer: { question, answer: { value: "2026-09-12", answeredAt: "2026-09-30T09:59:00.000Z" } } } };
  const events = eventsForCommand({ ...base, operation: "SUBMIT_ANSWER", before: { resolution: { questions: [question] } }, after });
  assert.deepStrictEqual(types(events), ["CUSTOMER_ANSWER_RECEIVED"]);
  const [answer] = events;
  assert.strictEqual(answer.occurredAt, "2026-09-30T09:59:00.000Z");
  assert.strictEqual(answer.receivedAt, RECEIVED);
  assert.strictEqual(answer.effectiveAt, "2026-09-12T00:00:00.000Z");
  assert.strictEqual(answer.relatedQuestionId, "q-date");
  assert.strictEqual(answer.actorType, "CUSTOMER");
  assert.strictEqual(answer.actorId, "user_1");
  assert.strictEqual(answer.correlationId, "corr-1");
});

test("new questions, new evidence and a decision on evidence are each recorded once", () => {
  const before = { resolution: { questions: [{ id: "q1" }], evidence: { r1: { artifactId: "a1", status: "VALIDATING" } } } };
  const after = { resolution: { questions: [{ id: "q1" }, { id: "q2", type: "SINGLE_SELECT" }], evidence: { r1: { artifactId: "a1", status: "SATISFIED" }, r2: { artifactId: "a2", status: "VALIDATING" } } } };
  const events = eventsForCommand({ ...base, operation: "SYNC_RESOLUTION", before, after });
  assert.deepStrictEqual(types(events).sort(), ["EVIDENCE_DECIDED", "EVIDENCE_RECEIVED", "QUESTION_ASKED"]);
  assert.strictEqual(events.find((e) => e.eventType === "QUESTION_ASKED").relatedQuestionId, "q2");
  assert.strictEqual(events.find((e) => e.eventType === "EVIDENCE_DECIDED").reasonCode, "SATISFIED");
});

test("the calculation's own history is mirrored as it appears, and only its assessment events", () => {
  const item = (eventId, type) => ({ eventId, type, assessmentVersionId: "ubo-assessment:1", occurredAt: RECEIVED, personId: "alice" });
  const before = { assessment: { trace: { auditEvents: [item("e1", "IDV_REQUIREMENT_CREATED")] } } };
  const after = { assessment: { trace: { auditEvents: [item("e1", "IDV_REQUIREMENT_CREATED"), item("e2", "UBO_DETERMINATION_CHANGED"), item("e3", "CUSTOMER_ANSWER_RECORDED")] } } };
  const events = eventsForCommand({ ...base, operation: "SYNC_RESOLUTION", before, after });
  assert.deepStrictEqual(types(events), ["UBO_DETERMINATION_CHANGED"]);
  assert.strictEqual(events[0].relatedAssessmentId, "ubo-assessment:1");
});

test("finalising, verification, application submission, a reset and a reopen are recorded", () => {
  const assessment = { assessmentId: "ubo-assessment:9", trace: { verificationAssessment: { assessmentVersionId: "ubo-assessment:9" } } };
  assert.deepStrictEqual(types(eventsForCommand({ ...base, operation: "FINALIZE_ASSESSMENT", before: {}, after: { assessment } })), ["UBO_ASSESSMENT_COMPLETED"]);
  const idv = eventsForCommand({ ...base, operation: "COMPLETE_IDV", before: { assessment }, after: { assessment }, payload: { personId: "alice", mode: "DEMO" } });
  assert.deepStrictEqual(types(idv), ["IDV_COMPLETED"]);
  assert.strictEqual(idv[0].reasonCode, "DEMO");
  const submitted = eventsForCommand({ ...base, operation: "SUBMIT_APPLICATION", before: { assessment }, after: { assessment }, payload: { assessmentVersionId: "ubo-assessment:9", submittedAt: RECEIVED } });
  assert.deepStrictEqual(types(submitted), ["APPLICATION_SUBMITTED"]);
  assert.strictEqual(submitted[0].relatedAssessmentId, "ubo-assessment:9");
  assert.deepStrictEqual(types(eventsForCommand({ ...base, operation: "RESET_ANSWERS", before: {}, after: {} })), ["CUSTOMER_ANSWERS_RESET"]);
  const reopen = eventsForCommand({ ...base, actor: { type: "ANALYST", id: "user_a" }, operation: "REOPEN_CASE", before: { assessment }, after: {} });
  assert.deepStrictEqual(types(reopen), ["ANALYST_OVERRIDE"]);
  assert.strictEqual(reopen[0].reasonCode, "CASE_REOPENED");
});

test("an actor the ledger does not know is recorded as the system, never as whatever was claimed", () => {
  const [event] = eventsForCommand({ ...base, actor: { type: "SUPERUSER" }, operation: "RESET_ANSWERS", before: {}, after: {} });
  assert.strictEqual(event.actorType, "SYSTEM");
});

test("a replayed step writes nothing twice, and an unknown event type is refused", async () => {
  const written = [];
  const executor = { query: async (sql, params) => { written.push(params); return { rows: [] }; } };
  const events = eventsForCommand({ ...base, operation: "RESET_ANSWERS", before: {}, after: {} });
  await record(executor, "acme", events);
  await record(executor, "acme", events);
  assert.strictEqual(written[0][17], written[1][17], "the same dedupe key, so ON CONFLICT drops the replay");
  await assert.rejects(record(executor, "acme", [{ ...events[0], eventType: "FORGED" }]), /Unknown audit event type/);
  assert.ok(EVENT_TYPES.includes("DOCUMENT_UPLOADED"));
});

test("a document's events are keyed to its job and its attempt", () => {
  const job = { jobId: "job-1", demoCaseId: "case-1", artifactId: "art-1", correlationId: "customer-chart:x", state: "FAILED" };
  const event = documentEvent({ tenantJob: job, eventType: "DOCUMENT_EXTRACTION_FAILED", actor: { type: "CUSTOMER", id: "user_1" }, receivedAt: RECEIVED });
  assert.strictEqual(event.relatedArtifactId, "art-1");
  assert.strictEqual(event.reasonCode, "EXTRACTION_FAILED");
  assert.strictEqual(event.subject, "job-1:customer-chart:x");
});
