"use strict";

// The server's own calculation of a UBO case's resolution and assessment
// (UBO-13, docs/ubo/SERVER-AUTHORITATIVE-PLAN.md step 3).
//
// It does what the questions screen does, with the same code
// (src/uboDemo/customer/caseResolution.js and the engines), from what the
// SERVER holds: the analyst's research, the chart the server extracted, and
// the extraction results of evidence the customer uploaded. From the browser it
// takes only the customer's own input - their answers, and which uploaded file
// was meant for which evidence request. Everything computed - questions,
// evidence outcomes, recalculations, who is a beneficial owner, who needs
// identity verification, whether it is finalised - is the server's.

const { caseInputs, evaluateCase, resolutionTrace } = require("../../src/uboDemo/customer/caseResolution");
const { applyResultingFact, determinationFromChartAnalysis, evidenceResultStatus, EVIDENCE_STATUS } = require("../../src/uboDemo/customer/ownershipResolutionEngine");
const { isReadyForIdentityVerification } = require("../../src/uboDemo/customer/verificationAssessment");
const { reevaluateSavedCustomerOwnershipChart } = require("./customerOwnershipChartDemo");

const MAX_ANSWERS = 200;
const MAX_TEXT = 2000;
// Outcomes a browser may report for an upload that never reached extraction.
// Anything that would count as accepted needs the server's own result.
const UNPROVEN_EVIDENCE = new Set([EVIDENCE_STATUS.RECEIVED, EVIDENCE_STATUS.VALIDATING, EVIDENCE_STATUS.REJECTED, EVIDENCE_STATUS.ANALYSIS_UNAVAILABLE]);

function fail(code, message, statusCode = 409) {
  return Object.assign(new Error(message), { code, statusCode });
}

const text = (value) => (value == null ? null : String(value).slice(0, MAX_TEXT));

/** The customer's answers, and nothing else that might travel with them. */
function cleanAnswers(raw) {
  const out = {};
  for (const [questionId, answer] of Object.entries(raw && typeof raw === "object" ? raw : {}).slice(0, MAX_ANSWERS)) {
    if (!answer || typeof answer !== "object") continue;
    const value = ["string", "number", "boolean"].includes(typeof answer.value) || answer.value === null ? answer.value : text(JSON.stringify(answer.value));
    out[String(questionId).slice(0, 200)] = {
      value: typeof value === "string" ? value.slice(0, MAX_TEXT) : value,
      answeredAt: text(answer.answeredAt),
      factRequirementId: text(answer.factRequirementId),
      comparisonItemId: text(answer.comparisonItemId),
    };
  }
  return out;
}

/** Each evidence outcome decided from the extraction the server itself ran. */
async function decideEvidence(engine, raw, findEvidenceResult, now) {
  const out = {};
  for (const [requirementId, submitted] of Object.entries(raw && typeof raw === "object" ? raw : {})) {
    const record = engine.evidenceRequirements.find(({ id }) => id === requirementId);
    if (!record || !submitted || typeof submitted !== "object") continue;
    const base = { filename: text(submitted.filename), artifactId: submitted.artifactId ? String(submitted.artifactId) : null };
    if (!base.artifactId) {
      out[requirementId] = { ...base, status: UNPROVEN_EVIDENCE.has(submitted.status) ? submitted.status : EVIDENCE_STATUS.REJECTED, reason: text(submitted.reason) };
      continue;
    }
    const result = await findEvidenceResult(base.artifactId);
    if (!result) {
      out[requirementId] = { ...base, status: EVIDENCE_STATUS.VALIDATING };
      continue;
    }
    const resolution = engine.resolutions.find(({ comparisonItemId }) => comparisonItemId === record.comparisonItemId);
    out[requirementId] = { ...base, ...evidenceResultStatus(result, resolution, record), validatedAt: text(submitted.validatedAt) || now };
  }
  return out;
}

/** The chart re-evaluated with what the customer's answers establish - the
 *  questions screen's recalculation, done here. */
function recalculate(engine, inputs, chartResult, demoContext, now) {
  const material = engine.resolutions.filter((resolution) => resolution.resultingFact?.type === "RELATIONSHIP" && resolution.resultingFact.relationship === "ECONOMIC_OWNERSHIP");
  if (!material.length) return {};
  const savedResult = material.reduce((current, resolution) => applyResultingFact(current, resolution.resultingFact), chartResult);
  let chartAnalysis;
  try {
    chartAnalysis = reevaluateSavedCustomerOwnershipChart({ demoContext, savedResult }).chartAnalysis;
  } catch (error) {
    return Object.fromEntries(material.map((resolution) => [resolution.comparisonItemId, {
      determination: resolution.uboImpact?.determination, error: error.message, recalculatedAt: now,
    }]));
  }
  const out = {};
  for (const row of inputs.rows) {
    const sourceFact = row.chartFact || row.researchFact;
    if (sourceFact) out[row.key] = { determination: determinationFromChartAnalysis(chartAnalysis, sourceFact), chartAnalysis, recalculatedAt: now };
  }
  return out;
}

/** The stored answers with the incoming ones: per question, the most recent
 *  answer wins. Requests can arrive out of order - an older sync completing
 *  after a newer answer must not take the newer answer away. */
function mergeAnswers(stored, incoming) {
  const out = { ...stored };
  for (const [questionId, answer] of Object.entries(incoming)) {
    if (!out[questionId] || String(answer.answeredAt || "") >= String(out[questionId].answeredAt || "")) out[questionId] = answer;
  }
  return out;
}

/** What an evidence entry was submitted as, without the server's verdict. */
function submittedEvidence(evidence) {
  return Object.fromEntries(Object.entries(evidence || {}).map(([id, e]) => [id, { filename: e?.filename, artifactId: e?.artifactId, status: e?.status, reason: e?.reason, validatedAt: e?.validatedAt }]));
}

function traceFrom(projection) {
  return projection?.assessment?.trace || projection?.resolution?.trace || projection?.researchResult?.ownershipResolutionTrace || null;
}

/**
 * @param projection the case as stored
 * @param incoming   the browser's payload - only answers, evidence choices and
 *                   the id of a submitted question are read from it
 * @param findEvidenceResult async (artifactId) => the server's extraction
 *                   result for an evidence upload of this case, or null
 * @returns {{ resolution, assessment }} to be stored as the case's own
 */
async function computeCaseAssessment({ projection, caseId, operation, incoming, findEvidenceResult, now = new Date().toISOString() }) {
  const researchResult = projection?.researchResult;
  const chartResult = projection?.chartProjection;
  const company = projection?.demoCase?.company || projection?.company;
  if (!researchResult || !chartResult || !company) throw fail("case_not_ready", "The case needs its research and ownership chart before questions can be answered.");

  const inputs = caseInputs({ researchResult, chartResult, company });
  const createdAt = projection.resolution?.createdAt || now;
  const demoContext = { demoCaseId: caseId, referenceCaseId: projection.demoCase?.referenceCaseId || "", company };
  const stored = projection.resolution || {};
  const answers = mergeAnswers(cleanAnswers(stored.answers), cleanAnswers(incoming?.resolution?.answers));
  let evidenceSubmitted = { ...submittedEvidence(stored.evidence), ...submittedEvidence(incoming?.resolution?.evidence) };

  // A changed answer, as on the questions screen: evidence given for the old
  // answer no longer counts, and answers the new state no longer asks for go.
  const submittedId = operation === "SUBMIT_ANSWER" ? String(incoming?.resolution?.submittedAnswer?.question?.id || "") : "";
  const submitted = submittedId ? answers[submittedId] : null;
  if (submitted && stored.answers?.[submittedId] && stored.answers[submittedId].value !== submitted.value) {
    const before = evaluateCase(inputs, { answers: cleanAnswers(stored.answers), evidence: {}, recalculations: {}, now: createdAt });
    for (const { id } of before.evidenceRequirements.filter(({ comparisonItemId }) => comparisonItemId === submitted.comparisonItemId)) delete evidenceSubmitted[id];
  }
  if (submitted) {
    const active = new Set(evaluateCase(inputs, { answers, evidence: {}, recalculations: {}, now: createdAt }).questions.map(({ id }) => id));
    for (const [questionId, answer] of Object.entries(answers)) {
      if (questionId !== submittedId && answer.comparisonItemId === submitted.comparisonItemId && !active.has(questionId)) delete answers[questionId];
    }
  }

  const engineForEvidence = evaluateCase(inputs, { answers, evidence: {}, recalculations: {}, now: createdAt });
  const evidence = await decideEvidence(engineForEvidence, evidenceSubmitted, findEvidenceResult, now);
  const engineForRecalculation = evaluateCase(inputs, { answers, evidence, recalculations: {}, now: createdAt });
  const recalculations = recalculate(engineForRecalculation, inputs, chartResult, demoContext, now);

  const finalizing = operation === "FINALIZE_ASSESSMENT";
  const engine = evaluateCase(inputs, { answers, evidence, recalculations, now: finalizing ? now : createdAt });
  const previousTrace = traceFrom(projection);
  if (finalizing) {
    const current = resolutionTrace({ engine, rows: inputs.rows, answers, previousTrace, recalculations, now });
    if (!isReadyForIdentityVerification(current)) throw fail("not_ready_to_finalize", current.verificationAssessment?.blockingIssues?.[0]?.message || "Complete the remaining questions first.");
  }
  const trace = resolutionTrace({ engine, rows: inputs.rows, answers, previousTrace, recalculations, finalized: finalizing, now });

  let submittedAnswer;
  if (operation === "SUBMIT_ANSWER") {
    const question = [...engine.questions, ...engineForEvidence.questions].find(({ id }) => id === submittedId);
    if (!question || !answers[submittedId]) throw fail("unknown_question", "That question is not part of this case.", 400);
    submittedAnswer = { question, answer: answers[submittedId] };
  }

  const resolution = {
    createdAt,
    requirements: engine.requirements,
    questions: trace.questions || engine.questions,
    evidenceRequirements: engine.evidenceRequirements,
    answers,
    evidence,
    recalculations,
    trace,
    ...(submittedAnswer ? { submittedAnswer } : {}),
  };
  return { resolution, assessment: { assessmentId: trace.verificationAssessment?.assessmentVersionId, trace, evidence } };
}

module.exports = { computeCaseAssessment, cleanAnswers, mergeAnswers };
