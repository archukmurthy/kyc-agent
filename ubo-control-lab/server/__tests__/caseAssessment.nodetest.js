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
  const { resolution } = await compute("SUBMIT_ANSWER", { resolution: { answers, submittedAnswer: { question: { id: question.id } } } });
  assert.ok(resolution.evidenceRequirements.length > 0, "the fixture no longer asks for evidence - this test would prove nothing");
  return { answers, requirement: resolution.evidenceRequirements[0], projection: { ...fx.projection(), resolution } };
}

test("evidence claimed as accepted without an upload the server read is not accepted", async () => {
  const { answers, requirement, projection } = await withEvidenceRequest();
  const noUpload = await compute("SYNC_RESOLUTION", { resolution: { answers, evidence: { [requirement.id]: { status: "SATISFIED", filename: "forged.pdf" } } } }, { projection });
  assert.strictEqual(noUpload.resolution.evidence[requirement.id].status, "REJECTED");
  const unread = await compute("SYNC_RESOLUTION", { resolution: { answers, evidence: { [requirement.id]: { status: "SATISFIED", artifactId: "artifact-9" } } } }, { projection });
  assert.strictEqual(unread.resolution.evidence[requirement.id].status, "VALIDATING");
});

test("an upload's outcome is decided from the server's own reading of it", async () => {
  const { answers, requirement, projection } = await withEvidenceRequest();
  const asked = [];
  await computeCaseAssessment({
    projection, caseId: "case-1", operation: "SYNC_RESOLUTION", now: NOW,
    incoming: { resolution: { answers, evidence: { [requirement.id]: { status: "SATISFIED", artifactId: "artifact-9" } } } },
    findEvidenceResult: async (artifactId) => { asked.push(artifactId); return null; },
  });
  assert.deepStrictEqual(asked, ["artifact-9"]);
});

test("only the customer's answer itself is kept - nothing that travels with it", async () => {
  const { resolution: base } = await compute("SYNC_RESOLUTION", {});
  const question = base.questions[0];
  const { resolution } = await compute("SUBMIT_ANSWER", { resolution: { answers: { [question.id]: { value: question.options[0].value, answeredAt: NOW, comparisonItemId: question.comparisonItemId, determination: "DEFINITE_NON_UBO", injected: { a: 1 } } }, submittedAnswer: { question: { id: question.id } } } });
  assert.deepStrictEqual(Object.keys(resolution.answers[question.id]).sort(), ["answeredAt", "comparisonItemId", "factRequirementId", "value"]);
});

test("a submitted answer names a question of this case, and the question is the server's", async () => {
  const { resolution: base } = await compute("SYNC_RESOLUTION", {});
  const question = base.questions[0];
  const answers = { [question.id]: { value: question.options[0].value, answeredAt: NOW, comparisonItemId: question.comparisonItemId } };
  const { resolution } = await compute("SUBMIT_ANSWER", { resolution: { answers, submittedAnswer: { question: { id: question.id, label: "forged label" }, answer: answers[question.id] } } });
  assert.strictEqual(resolution.submittedAnswer.question.id, question.id);
  assert.notStrictEqual(resolution.submittedAnswer.question.label, "forged label");
  await assert.rejects(compute("SUBMIT_ANSWER", { resolution: { answers: { "invented-question": { value: "x" } }, submittedAnswer: { question: { id: "invented-question" } } } }), (error) => error.code === "invalid_answer" && error.statusCode === 400, "an invented question is refused: nothing the case is not asking is accepted");
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

test("a date answer is a date a person could mean", () => {
  const { validFor } = require("../caseAssessment");
  const question = { type: "DATE" };
  assert.strictEqual(validFor(question, "2026-09-12"), true);
  for (const value of ["0000-01-01", "0999-12-31", "2026-9-12", "not a date"]) assert.strictEqual(validFor(question, value), false, value);
});

// A shareholder the registry shows and the chart does not: "no longer a
// shareholder" asks for a document, and the server's own reading of it decides.
test("a removed registry shareholder is cleared by the server's reading of a current register, not by the customer's word", async () => {
  const parent = { name: "Parent Holdings Limited", entityType: "LEGAL_ENTITY", jurisdiction: "GB" };
  const research = fx.researchResult(30);
  research.candidateSources[0].candidateFacts.push({ ...fx.ownershipFact("research-fact:parent", 70, { system: "companies_house", referenceType: "PSC", referenceId: "psc-parent" }), subject: parent });
  const projection = fx.projection({ research });
  const run = (operation, incoming, findEvidenceResult = noEvidence, stored = projection) => computeCaseAssessment({ projection: stored, caseId: "case-1", operation, incoming, findEvidenceResult, now: NOW });
  const { resolution: base } = await run("SYNC_RESOLUTION", {});
  const question = base.questions.find((q) => q.id.includes("CONFIRM_CURRENT_SHAREHOLDING"));
  assert.ok(question, "the fixture no longer raises the registry-only shareholder - this test would prove nothing");
  const answers = { [question.id]: { value: "NO", answeredAt: NOW, comparisonItemId: question.comparisonItemId, factRequirementId: question.factRequirementId } };
  const { resolution: asked } = await run("SUBMIT_ANSWER", { resolution: { answers, submittedAnswer: { question: { id: question.id } } } });
  const request = asked.evidenceRequirements.find((record) => record.ruleKey === "SHAREHOLDER_REMOVED");
  assert.ok(request, "the customer is asked for a document");
  const fact = (resolution) => resolution.trace.ownershipFacts.find((item) => item.comparisonItemId === question.comparisonItemId);
  assert.strictEqual(fact(asked).resolutionStatus, "UNRESOLVED");
  const { assessment: waiting } = await run("SYNC_RESOLUTION", {}, noEvidence, { ...projection, resolution: asked });
  assert.strictEqual(waiting.trace.verificationAssessment.blockingIssues[0].message, "Upload the requested supporting document to continue.");

  const answered = { ...projection, resolution: asked };
  const upload = { [request.id]: { status: "SATISFIED", artifactId: "register-artifact", filename: "register.pdf" } };
  const reading = (holders) => async () => ({
    evidenceHandoff: { requestedConcepts: request.handoff.requestedConcepts },
    result: { artifact: { integrityVerified: true }, candidateFacts: holders.map(([subject, value], index) => ({ ...fx.ownershipFact(`register:${index}`, value, { referenceId: "register" }), subject })) },
  });
  const alice = { name: "Alice Morgan", entityType: "NATURAL_PERSON", jurisdiction: "GB" };
  const stillListed = await run("SYNC_RESOLUTION", { resolution: { answers, evidence: upload } }, reading([[alice, 30], [parent, 70]]), answered);
  assert.strictEqual(stillListed.resolution.evidence[request.id].status, "REJECTED");
  assert.strictEqual(fact(stillListed.resolution).resolutionStatus, "UNRESOLVED");

  const cleared = await run("SYNC_RESOLUTION", { resolution: { answers, evidence: upload } }, reading([[alice, 30], [{ name: "Bob Stone", entityType: "NATURAL_PERSON", jurisdiction: "GB" }, 70]]), answered);
  assert.strictEqual(cleared.resolution.evidence[request.id].status, "SATISFIED");
  assert.strictEqual(fact(cleared.resolution).resolutionStatus, "RESOLVED_EVIDENCE_VERIFIED");
  assert.strictEqual(cleared.resolution.trace.ownershipResolution.pendingCorporateTraversalCount, 0);
  assert.ok(!cleared.assessment.trace.verificationAssessment.blockingIssues.some(({ code }) => code === "MATERIAL_OWNERSHIP_UNRESOLVED"));
});

// Found in the review of UBO-51: the server worked out which questions were
// asked with no evidence at all, so a question that only appears once evidence
// is accepted (control, after ownership completes) had its answer refused.
test("a question raised by accepted evidence can be answered", async () => {
  const parent = { name: "Parent Holdings Limited", entityType: "LEGAL_ENTITY", jurisdiction: "GB" };
  const research = fx.researchResult(20);
  research.candidateSources[0].candidateFacts.push({ ...fx.ownershipFact("research-fact:parent", 80, { system: "companies_house", referenceType: "PSC", referenceId: "psc-parent" }), subject: parent });
  const projection = fx.projection({ research, chart: fx.chartResult(20) });
  const run = (operation, incoming, find, stored) => computeCaseAssessment({ projection: stored, caseId: "case-1", operation, incoming, findEvidenceResult: find, now: NOW });
  const answerFor = (q, value) => ({ value, answeredAt: NOW, comparisonItemId: q.comparisonItemId, factRequirementId: q.factRequirementId });
  let stored = projection;
  const { resolution: base } = await run("SYNC_RESOLUTION", {}, noEvidence, stored);
  for (const q of base.questions.filter((item) => item.status === "OPEN")) {
    const value = q.id.includes("CONFIRM_CURRENT_SHAREHOLDING") ? "NO" : q.options ? q.options[0].value : 20;
    const { resolution } = await run("SUBMIT_ANSWER", { resolution: { answers: { [q.id]: answerFor(q, value) }, submittedAnswer: { question: { id: q.id } } } }, noEvidence, stored);
    stored = { ...projection, resolution };
  }
  const request = stored.resolution.evidenceRequirements.find((record) => record.ruleKey === "SHAREHOLDER_REMOVED");
  assert.ok(request, "the fixture no longer asks for a removal document - this test would prove nothing");
  const people = ["Alice Morgan", "Bob One", "Carol Two", "Dan Three", "Erin Four"].map((name) => ({ name, entityType: "NATURAL_PERSON", jurisdiction: "GB" }));
  const reading = async () => ({ evidenceHandoff: { requestedConcepts: request.handoff.requestedConcepts }, result: { artifact: { integrityVerified: true }, candidateFacts: people.map((subject, index) => ({ ...fx.ownershipFact(`register:${index}`, 20, { referenceId: "register" }), subject })) } });
  const cleared = await run("SYNC_RESOLUTION", { resolution: { evidence: { [request.id]: { status: "SATISFIED", artifactId: "register-artifact", filename: "register.pdf" } } } }, reading, stored);
  stored = { ...projection, resolution: cleared.resolution };
  const control = cleared.resolution.questions.find((q) => q.status === "OPEN" && q.stage !== "OWNERSHIP");
  assert.ok(control, "accepted evidence no longer raises a control question - this test would prove nothing");
  const value = control.options ? control.options[0].value : "x";
  const { resolution } = await run("SUBMIT_ANSWER", { resolution: { answers: { [control.id]: answerFor(control, value) }, submittedAnswer: { question: { id: control.id } } } }, reading, stored);
  assert.ok(resolution.answers[control.id], "the answer to the question the evidence raised is kept");
});
