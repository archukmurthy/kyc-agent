"use strict";

// The server's own calculation of a UBO case's resolution and assessment
// (UBO-13, docs/ubo/SERVER-AUTHORITATIVE-PLAN.md step 3).
//
// It does what the questions screen does, with the same code
// (src/uboDemo/customer/caseResolution.js and the engines), from what the
// SERVER holds: the analyst's research, the chart it extracted, and its own
// extraction of each evidence upload. From the browser it takes only the
// customer's input - answers to questions it is actually asking, in the form
// each question allows, and which upload was meant for which evidence request.
// Everything computed - questions, evidence outcomes, recalculations, who is a
// beneficial owner, who needs identity verification, whether it is finalised -
// is the server's, and the trace says so (computedBy: "server").

const { caseInputs, evaluateCase, resolutionTrace } = require("../../src/uboDemo/customer/caseResolution");
const { applyResultingFact, determinationFromChartAnalysis, evidenceResultStatus, EVIDENCE_STATUS, QUESTION_TYPE } = require("../../src/uboDemo/customer/ownershipResolutionEngine");
const { DISCOVERY_STATE, isReadyForIdentityVerification } = require("../../src/uboDemo/customer/verificationAssessment");
const { reevaluateSavedCustomerOwnershipChart } = require("./customerOwnershipChartDemo");

const MAX_ANSWERS = 200;
const MAX_TEXT = 2000;
// A browser clock a little ahead is normal; far ahead would pin an answer.
// Outcomes a browser may report for an upload that never reached extraction.
// Anything that would count as accepted needs the server's own reading.
const UNPROVEN_EVIDENCE = new Set([EVIDENCE_STATUS.RECEIVED, EVIDENCE_STATUS.VALIDATING, EVIDENCE_STATUS.REJECTED, EVIDENCE_STATUS.ANALYSIS_UNAVAILABLE]);

function fail(code, message, statusCode = 409) {
  return Object.assign(new Error(message), { code, statusCode });
}

const text = (value) => (value == null ? null : String(value).slice(0, MAX_TEXT));

/** The browser's timestamp, if it is a real one and not from the future. */
function answeredAt(value, now) {
  const at = Date.parse(value);
  // Never later than the server's own clock: a device running ahead would
  // otherwise keep its answer over the customer's later change (review).
  if (!Number.isFinite(at) || at > Date.parse(now)) return now;
  return new Date(at).toISOString();
}

/** Only the fields an answer has, with a timestamp the server accepts. */
function cleanAnswers(raw, now) {
  const out = {};
  for (const [questionId, answer] of Object.entries(raw && typeof raw === "object" ? raw : {}).slice(0, MAX_ANSWERS)) {
    if (!answer || typeof answer !== "object") continue;
    out[String(questionId).slice(0, 200)] = {
      value: answer.value,
      answeredAt: answeredAt(answer.answeredAt, now),
      factRequirementId: text(answer.factRequirementId),
      comparisonItemId: text(answer.comparisonItemId),
    };
  }
  return out;
}

/** Whether a value is one this question can take. */
function validFor(question, value) {
  const options = (question.options || []).map((option) => (option && typeof option === "object" ? option.value : option));
  switch (question.type) {
    case QUESTION_TYPE.PERCENTAGE:
      return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
    case QUESTION_TYPE.DATE:
      return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value));
    case QUESTION_TYPE.SINGLE_SELECT:
    case QUESTION_TYPE.BOOLEAN:
    case QUESTION_TYPE.ENTITY_SELECT:
      return options.length ? options.includes(value) : typeof value === "string" && value.length > 0 && value.length <= MAX_TEXT;
    case QUESTION_TYPE.FREE_TEXT:
    default:
      return typeof value === "string" && value.trim().length > 0 && value.length <= MAX_TEXT;
  }
}

/** Per question, the most recent answer wins. Requests arrive out of order -
 *  an older sync completing after a newer answer must not take it away. */
function mergeAnswers(stored, incoming) {
  const out = { ...stored };
  for (const [questionId, answer] of Object.entries(incoming)) {
    if (!out[questionId] || String(answer.answeredAt || "") >= String(out[questionId].answeredAt || "")) out[questionId] = answer;
  }
  return out;
}

/** The engine, with its own failure on impossible input turned into a refusal
 *  of the request rather than a stored, permanently broken case. */
function evaluate(inputs, state) {
  try {
    return evaluateCase(inputs, state);
  } catch (error) {
    if (error instanceof TypeError || error instanceof RangeError) throw fail("invalid_answer", "An answer could not be used.", 400);
    throw error;
  }
}

/** Keeps only answers to questions the case is asking, in a form each allows.
 *  Asking is progressive - one answer can raise the next question - so it is
 *  settled over a few rounds. */
function sameKeys(a, b) {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => key in b);
}

function acceptedAnswers(inputs, candidate, now, createdAt) {
  let accepted = {};
  // Settled when a round accepts exactly what the last one did. A fixed
  // depth dropped honest answers six levels down (senior management); the
  // cap only bounds a pathological case (candidates are capped at 200).
  for (let round = 0; round <= Object.keys(candidate).length; round += 1) {
    const asked = new Map(evaluate(inputs, { answers: accepted, evidence: {}, recalculations: {}, now: createdAt }).questions.map((q) => [q.id, q]));
    const next = {};
    for (const [questionId, answer] of Object.entries(candidate)) {
      const question = asked.get(questionId);
      if (question && validFor(question, answer.value)) next[questionId] = answer;
    }
    if (sameKeys(next, accepted)) return next;
    accepted = next;
  }
  return accepted;
}

/** Whether an upload was made as evidence for a request of this kind. The job
 *  keeps only the concepts it was asked to establish (evidence/customerOwnershipJobs
 *  /service.js#validateRequest), so: some, and all of them this request's. */
function uploadedFor(stored, requested) {
  const concepts = stored?.requestedConcepts || [];
  const wanted = new Set(requested?.requestedConcepts || []);
  return concepts.length > 0 && concepts.every((concept) => wanted.has(concept));
}

/** Each evidence outcome decided from the extraction the server itself ran of
 *  an upload made AS EVIDENCE for a request of this kind - not the ownership
 *  chart, and not one file counted for two requests. */
async function decideEvidence(engine, raw, findEvidenceResult, chartArtifactId, now) {
  const out = {};
  for (const record of engine.evidenceRequirements) {
    const submitted = raw?.[record.id];
    if (!submitted || typeof submitted !== "object") continue;
    const base = { filename: text(submitted.filename), artifactId: submitted.artifactId ? String(submitted.artifactId) : null };
    if (!base.artifactId) {
      out[record.id] = { ...base, status: UNPROVEN_EVIDENCE.has(submitted.status) ? submitted.status : EVIDENCE_STATUS.REJECTED };
      continue;
    }
    // One register can genuinely evidence two transfers: its contents are
    // checked against each request (evidenceResultStatus), so a file is not
    // limited to one. The ownership chart itself never evidences itself.
    const found = base.artifactId === chartArtifactId ? null : await findEvidenceResult(base.artifactId);
    if (!found) {
      out[record.id] = { ...base, status: base.artifactId === chartArtifactId ? EVIDENCE_STATUS.REJECTED : EVIDENCE_STATUS.VALIDATING, ...(base.artifactId === chartArtifactId ? { reason: "The ownership chart cannot be its own evidence." } : {}) };
      continue;
    }
    if (!uploadedFor(found.evidenceHandoff, record.handoff)) {
      out[record.id] = { ...base, status: EVIDENCE_STATUS.REJECTED, reason: "This file was not uploaded as evidence for this request." };
      continue;
    }
    const resolution = engine.resolutions.find(({ comparisonItemId }) => comparisonItemId === record.comparisonItemId);
    out[record.id] = { ...base, ...evidenceResultStatus(found.result, resolution, record), validatedAt: now };
  }
  return out;
}

/** The chart re-evaluated with what the customer's answers establish - the
 *  questions screen's recalculation, done here. */
function recalculate(engine, inputs, chartResult, demoContext, now) {
  const material = engine.resolutions.filter((resolution) => resolution.resultingFact?.type === "RELATIONSHIP" && resolution.resultingFact.relationship === "ECONOMIC_OWNERSHIP");
  if (!material.length) return {};
  let chartAnalysis;
  try {
    const savedResult = material.reduce((current, resolution) => applyResultingFact(current, resolution.resultingFact), chartResult);
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

/** The stored trace, if the server wrote it. A trace a browser wrote before
 *  UBO-13 is not history to build on - its verification completions and
 *  audit events are the browser's claims. */
function serverTrace(projection) {
  // A reopened case has no current trace; the last one is its history, so
  // completed verifications and the audit trail carry into the next.
  const trace = projection?.assessment?.trace || projection?.resolution?.trace || projection?.resolution?.priorTrace || null;
  return trace?.computedBy === "server" ? trace : null;
}

function submittedEvidence(evidence) {
  return Object.fromEntries(Object.entries(evidence || {}).map(([id, e]) => [id, { filename: e?.filename, artifactId: e?.artifactId, status: e?.status }]));
}

/**
 * @param projection the case as stored
 * @param incoming   the browser's payload - only answers, evidence choices and
 *                   the id of a submitted question are read from it
 * @param findEvidenceResult async (artifactId) => { result, evidenceHandoff }
 *                   of the server's extraction of an upload for this case, or null
 * @returns {{ resolution, assessment }} to be stored as the case's own
 */
async function computeCaseAssessment({ projection, caseId, operation, incoming, findEvidenceResult, now = new Date().toISOString() }) {
  const researchResult = projection?.researchResult;
  const chartResult = projection?.chartProjection;
  const company = projection?.demoCase?.company || projection?.company;
  if (!researchResult || !chartResult || !company) throw fail("case_not_ready", "The case needs its research and ownership chart before questions can be answered.");

  const inputs = caseInputs({ researchResult, chartResult, company });
  const stored = operation === "RESET_ANSWERS" ? { createdAt: projection.resolution?.createdAt } : (projection.resolution || {});
  const createdAt = stored.createdAt || now;
  const demoContext = { demoCaseId: caseId, referenceCaseId: projection.demoCase?.referenceCaseId || "", company };

  // An answer is given by submitting it, one at a time. Whatever else a
  // request carries (a sync resends the browser's whole copy) is not an
  // answer: a stale copy brought old answers back (review).
  const submittedId = operation === "SUBMIT_ANSWER" ? String(incoming?.resolution?.submittedAnswer?.question?.id || "") : "";
  const submittedRaw = submittedId ? incoming?.resolution?.answers?.[submittedId] : undefined;
  const incomingAnswers = cleanAnswers(submittedRaw ? { [submittedId]: submittedRaw } : {}, now);
  const storedAnswers = acceptedAnswers(inputs, cleanAnswers(stored.answers, now), now, createdAt);
  // Most recent wins: a late retry of an older answer does not undo a newer
  // one. (ponytail: ordered by the device's clock, capped at the server's -
  // a second device running behind cannot change an answer for that long.)
  const merged = mergeAnswers(storedAnswers, incomingAnswers);
  if (submittedId) {
    // Checked as if it had won: an invalid answer is refused even when a newer
    // stored answer keeps it out (review).
    const alone = { ...merged, [submittedId]: incomingAnswers[submittedId] };
    if (!incomingAnswers[submittedId] || acceptedAnswers(inputs, alone, now, createdAt)[submittedId] !== incomingAnswers[submittedId]) {
      throw fail("invalid_answer", "That answer is not one this question accepts.", 400);
    }
  }
  const answers = acceptedAnswers(inputs, merged, now, createdAt);
  // A late retry of an older answer changes nothing and is not this request's answer.
  const submittedWon = Boolean(submittedId) && answers[submittedId] === incomingAnswers[submittedId];
  let evidenceSubmitted = operation === "RESET_ANSWERS" ? {} : { ...submittedEvidence(stored.evidence), ...submittedEvidence(incoming?.resolution?.evidence) };

  // A changed answer, as on the questions screen: evidence given for the old
  // answer no longer counts, and answers the new state no longer asks for go.
  const submitted = submittedWon ? answers[submittedId] : null;
  if (submitted && storedAnswers[submittedId] && storedAnswers[submittedId].value !== submitted.value) {
    const before = evaluate(inputs, { answers: storedAnswers, evidence: {}, recalculations: {}, now: createdAt });
    for (const { id } of before.evidenceRequirements.filter(({ comparisonItemId }) => comparisonItemId === submitted.comparisonItemId)) delete evidenceSubmitted[id];
  }
  if (submitted) {
    const active = new Set(evaluate(inputs, { answers, evidence: {}, recalculations: {}, now: createdAt }).questions.map(({ id }) => id));
    for (const [questionId, answer] of Object.entries(answers)) {
      if (questionId !== submittedId && answer.comparisonItemId === submitted.comparisonItemId && !active.has(questionId)) delete answers[questionId];
    }
  }

  const engineForEvidence = evaluate(inputs, { answers, evidence: {}, recalculations: {}, now: createdAt });
  const evidence = await decideEvidence(engineForEvidence, evidenceSubmitted, findEvidenceResult, projection.chartReference?.artifactId || null, now);
  const engineForRecalculation = evaluate(inputs, { answers, evidence, recalculations: {}, now: createdAt });
  const recalculations = recalculate(engineForRecalculation, inputs, chartResult, demoContext, now);

  const finalizing = operation === "FINALIZE_ASSESSMENT";
  const engine = evaluate(inputs, { answers, evidence, recalculations, now: finalizing ? now : createdAt });
  const previousTrace = serverTrace(projection);
  if (finalizing) {
    const current = resolutionTrace({ engine, rows: inputs.rows, answers, previousTrace, recalculations, now });
    if (!isReadyForIdentityVerification(current)) throw fail("not_ready_to_finalize", current.verificationAssessment?.blockingIssues?.[0]?.message || "Complete the remaining questions first.");
  }
  const trace = { ...resolutionTrace({ engine, rows: inputs.rows, answers, previousTrace, recalculations, finalized: finalizing, now }), computedBy: "server" };
  // Verification starts from a finalised assessment. A reopened case carries
  // its completed checks as history, but is not "in verification" (nor
  // complete) until it is finalised again (review).
  if (!finalizing && [DISCOVERY_STATE.IDV_IN_PROGRESS, DISCOVERY_STATE.IDV_COMPLETE].includes(trace.discoveryState)) {
    trace.discoveryState = DISCOVERY_STATE.READY_FOR_IDV;
    trace.verificationAssessment = { ...trace.verificationAssessment, discoveryState: DISCOVERY_STATE.READY_FOR_IDV };
  }

  let submittedAnswer;
  if (submittedWon) {
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

module.exports = { computeCaseAssessment, cleanAnswers, mergeAnswers, validFor, decideEvidenceForTest: decideEvidence };
