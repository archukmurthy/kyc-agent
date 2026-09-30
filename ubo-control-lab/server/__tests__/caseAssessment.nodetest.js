"use strict";

// UBO-13 step 3: the server computes a case's resolution and assessment from
// what it holds. Each test sends what a forged request would.

const { test } = require("node:test");
const assert = require("node:assert");
const { computeCaseAssessment } = require("../caseAssessment");
const { PocCaseService } = require("../pocCaseState");
const fx = require("./fixtures/caseAssessmentFixture");

const NOW = "2026-09-30T10:00:00.000Z";
const noEvidence = async () => null;

function compute(operation, incoming, extra = {}) {
  return computeCaseAssessment({ projection: fx.projection(), caseId: "case-1", operation, incoming, findEvidenceResult: noEvidence, now: NOW, ...extra });
}

const FORGED_TRACE = { verificationAssessment: { assessmentVersionId: "forged", verificationPopulation: [], finalized: true }, discoveryState: "IDV_COMPLETE" };

test("the server raises the questions and knows who needs verification, whatever the browser says", async () => {
  const { resolution, assessment } = await compute("SYNC_RESOLUTION", { resolution: { trace: FORGED_TRACE, questions: [] }, assessment: { trace: FORGED_TRACE } });
  assert.ok(resolution.questions.length > 0, "the discrepancy between 25% and 30% raises a question");
  const population = assessment.trace.verificationAssessment.verificationPopulation;
  assert.deepStrictEqual(population.map((p) => [p.personName, p.currentRequirementStatus]), [["Alice Morgan", "REQUIRED"]]);
  assert.notStrictEqual(assessment.trace.verificationAssessment.assessmentVersionId, "forged");
});

test("a case with open questions cannot be finalised, however the request is dressed", async () => {
  await assert.rejects(compute("FINALIZE_ASSESSMENT", { assessment: { trace: FORGED_TRACE } }), (error) => error.code === "not_ready_to_finalize" && error.statusCode === 409);
});

// Answering that the shares were transferred asks for evidence of the transfer.
async function withEvidenceRequest() {
  const { resolution: base } = await compute("SYNC_RESOLUTION", {});
  const question = base.questions.find((q) => q.id.includes("EXPLAIN_OWNERSHIP_DIFFERENCE"));
  const answers = { [question.id]: { value: "SHARE_TRANSFER", answeredAt: NOW, comparisonItemId: question.comparisonItemId, factRequirementId: question.factRequirementId } };
  const { resolution } = await compute("SYNC_RESOLUTION", { resolution: { answers } });
  assert.ok(resolution.evidenceRequirements.length > 0, "the fixture no longer asks for evidence - this test would prove nothing");
  return { answers, requirement: resolution.evidenceRequirements[0] };
}

test("evidence claimed as accepted without an upload the server read is not accepted", async () => {
  const { answers, requirement } = await withEvidenceRequest();
  const noUpload = await compute("SYNC_RESOLUTION", { resolution: { answers, evidence: { [requirement.id]: { status: "SATISFIED", filename: "forged.pdf" } } } });
  assert.strictEqual(noUpload.resolution.evidence[requirement.id].status, "REJECTED");
  const unread = await compute("SYNC_RESOLUTION", { resolution: { answers, evidence: { [requirement.id]: { status: "SATISFIED", artifactId: "artifact-9" } } } });
  assert.strictEqual(unread.resolution.evidence[requirement.id].status, "VALIDATING");
});

test("an upload's outcome is decided from the server's own reading of it", async () => {
  const { answers, requirement } = await withEvidenceRequest();
  const asked = [];
  await computeCaseAssessment({
    projection: fx.projection(), caseId: "case-1", operation: "SYNC_RESOLUTION", now: NOW,
    incoming: { resolution: { answers, evidence: { [requirement.id]: { status: "SATISFIED", artifactId: "artifact-9" } } } },
    findEvidenceResult: async (artifactId) => { asked.push(artifactId); return null; },
  });
  assert.deepStrictEqual(asked, ["artifact-9"]);
});

test("only the customer's answer itself is kept - nothing that travels with it", async () => {
  const { resolution: base } = await compute("SYNC_RESOLUTION", {});
  const question = base.questions[0];
  const { resolution } = await compute("SYNC_RESOLUTION", { resolution: { answers: { [question.id]: { value: "x", answeredAt: NOW, comparisonItemId: question.comparisonItemId, determination: "DEFINITE_NON_UBO", injected: { a: 1 } } } } });
  assert.deepStrictEqual(Object.keys(resolution.answers[question.id]).sort(), ["answeredAt", "comparisonItemId", "factRequirementId", "value"]);
});

test("a submitted answer names a question of this case, and the question is the server's", async () => {
  const { resolution: base } = await compute("SYNC_RESOLUTION", {});
  const question = base.questions[0];
  const answers = { [question.id]: { value: "x", answeredAt: NOW, comparisonItemId: question.comparisonItemId } };
  const { resolution } = await compute("SUBMIT_ANSWER", { resolution: { answers, submittedAnswer: { question: { id: question.id, label: "forged label" }, answer: answers[question.id] } } });
  assert.strictEqual(resolution.submittedAnswer.question.id, question.id);
  assert.notStrictEqual(resolution.submittedAnswer.question.label, "forged label");
  await assert.rejects(compute("SUBMIT_ANSWER", { resolution: { answers: { "invented-question": { value: "x" } }, submittedAnswer: { question: { id: "invented-question" } } } }), (error) => error.code === "unknown_question");
});

test("questions wait for the research and the chart", async () => {
  await assert.rejects(computeCaseAssessment({ projection: { demoCase: { company: fx.company } }, caseId: "case-1", operation: "SYNC_RESOLUTION", incoming: {}, findEvidenceResult: noEvidence, now: NOW }), (error) => error.code === "case_not_ready");
});

test("the case store keeps the server's assessment, not the one sent", async () => {
  const applied = [];
  const repository = {
    get: async (caseId) => ({ caseId, projection: fx.projection() }),
    history: async () => [],
    extraction: async () => null,
    evidenceResult: async () => null,
    apply: async (command) => { applied.push(command); return { duplicate: false, record: null }; },
  };
  await new PocCaseService(repository).apply({ caseId: "case-1", operation: "SYNC_RESOLUTION", idempotencyKey: "k", payload: { assessment: { trace: FORGED_TRACE }, resolution: { trace: FORGED_TRACE } } });
  const stored = applied[0].payload;
  assert.deepStrictEqual(stored.assessment.trace.verificationAssessment.verificationPopulation.map((p) => p.personName), ["Alice Morgan"]);
  assert.strictEqual(stored.resolution.trace.verificationAssessment.finalized, false);
});
