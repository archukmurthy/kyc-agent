import { clerkAuthHeaders } from "../../auth/clerkFetch";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { DEMO_SESSION_CONTRACT, DEMO_SESSION_KEY } from "../demoSession";
import { caseInputs, evaluateCase, resolutionTrace } from "./caseResolution";
import {
  applyResultingFact,
  determinationFromChartAnalysis,
  EVIDENCE_STATUS,
  evidenceResultStatus,
  QUESTION_TYPE,
  RESOLUTION_STATUS,
} from "./ownershipResolutionEngine";
import { CUSTOMER_IDV_PATH } from "./customerRoute";
import { isReadyForIdentityVerification } from "./verificationAssessment";
import { persistPocCase, smallStableHash } from "../pocCaseClient";
import { uboStore } from "../browserStore";

export const OWNERSHIP_RESOLUTION_SESSION_VERSION = "ubo-ownership-resolution-session-v1";
const SESSION_PREFIX = "ubo-demo.ownership-resolution.v1";
const ACCEPTED_TYPES = new Set(["application/pdf", "image/png", "image/jpeg"]);
const MAX_BYTES = 3 * 1024 * 1024;
const MEDIA_MISMATCH_MESSAGE = "This file is labelled as a PDF, PNG or JPEG, but its contents do not match that format. Export it again as a PDF, PNG or JPEG, or choose another file.";

function sessionKey(context, result) { return `${SESSION_PREFIX}:${context?.demoCaseId || "case"}:${result?.artifact?.artifactId || "artifact"}`; }
function readSession(context, result) {
  try {
    const value = JSON.parse(uboStore.getItem(sessionKey(context, result)) || "null");
    return value?.contractVersion === OWNERSHIP_RESOLUTION_SESSION_VERSION ? value : null;
  } catch (_) { return null; }
}
function saveSession(context, result, state) {
  try { uboStore.setItem(sessionKey(context, result), JSON.stringify({ contractVersion: OWNERSHIP_RESOLUTION_SESSION_VERSION, savedAt: new Date().toISOString(), ...state })); }
  catch (_) { /* Resolution remains usable when browser-local persistence is unavailable. */ }
}
function clearSession(context, result) {
  try { uboStore.removeItem(sessionKey(context, result)); }
  catch (_) { /* In-memory reset still works when browser-local persistence is unavailable. */ }
}
function readCurrentTrace(context) {
  try {
    const session = JSON.parse(uboStore.getItem(DEMO_SESSION_KEY) || "null");
    if (session?.contractVersion !== DEMO_SESSION_CONTRACT || session?.demoCase?.demoCaseId !== context?.demoCaseId) return null;
    return session.researchResult?.ownershipResolutionTrace || null;
  } catch (_) { return null; }
}
function fileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || "").split(",").pop() || "");
    reader.onerror = () => reject(new Error("We could not read that file. Please choose it again."));
    reader.readAsDataURL(file);
  });
}
function answerValue(question, raw) {
  if (question.type !== QUESTION_TYPE.PERCENTAGE) return String(raw || "").trim();
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 100) throw new TypeError("Enter a percentage from 0 to 100.");
  return value;
}
function humanize(value) { return String(value || "").replaceAll("_", " ").toLowerCase(); }
function evidenceUploadFailure(payload, responseStatus) {
  const code = String(payload?.code || "evidence_validation_failed");
  if (code === "invalid_media" || /artifact bytes do not match the declared media type/i.test(payload?.message || "")) {
    return { status: EVIDENCE_STATUS.REJECTED, message: MEDIA_MISMATCH_MESSAGE };
  }
  const serviceMessages = {
    provider_timeout: "Your file was received, but document analysis timed out. The file itself was not rejected.",
    provider_unavailable: "Your file was received, but the document analysis service is unavailable. The file itself was not rejected.",
    provider_not_configured: "Your file was received, but the document analysis service is not configured. The file itself was not rejected.",
    provider_authentication_failed: "Your file was received, but the document analysis service could not authenticate. The file itself was not rejected.",
    provider_failure: "Your file was received, but the document analysis service could not complete the request. The file itself was not rejected.",
    provider_failed: "Your file was received, but the document analysis service could not complete the request. The file itself was not rejected.",
    malformed_provider_result: "Your file was received, but document analysis returned an unusable result. The file itself was not rejected.",
    provider_malformed_output: "Your file was received, but document analysis returned an unusable result. The file itself was not rejected.",
    incomplete_interpretation: "Your file was received, but document analysis did not complete. The file itself was not rejected.",
    provider_output_truncated: "Your file was received, but document analysis did not complete. The file itself was not rejected.",
  };
  if (serviceMessages[code] || Number(responseStatus) >= 500) return {
    status: EVIDENCE_STATUS.ANALYSIS_UNAVAILABLE,
    message: `${serviceMessages[code] || "Your file was received, but document analysis could not complete. The file itself was not rejected."} Please retry.`,
  };
  return { status: EVIDENCE_STATUS.REJECTED, message: payload?.message || "Evidence validation failed" };
}

async function postOwnershipExtraction(body) {
  const response = await fetch("/api/ubo-demo-customer-ownership-chart", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await clerkAuthHeaders()) },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok || !payload.success) {
    const failure = evidenceUploadFailure(payload, response.status);
    throw Object.assign(new Error(failure.message), { evidenceStatus: failure.status });
  }
  return payload;
}

async function awaitSupportingEvidenceResult(initialPayload) {
  if (initialPayload?.result) return initialPayload.result;
  let job = initialPayload?.job;
  if (!job?.jobId) throw new Error("Evidence analysis did not return a durable job.");
  if (job.state === "FAILED") {
    const retried = await postOwnershipExtraction({ operation: "RETRY_EXTRACTION_JOB", jobId: job.jobId });
    job = retried.job;
  }
  for (let transition = 0; transition < 12; transition += 1) {
    if (["COMPLETE", "PARTIAL"].includes(job.state) && job.result) return job.result;
    if (job.state === "FAILED") {
      throw Object.assign(new Error(job.failure?.message || "Your file was saved, but document analysis could not complete. Please retry."), { evidenceStatus: EVIDENCE_STATUS.ANALYSIS_UNAVAILABLE });
    }
    if (job.state === "RETRYING" && job.nextAttemptAt) {
      const delay = Math.max(0, Math.min(9000, new Date(job.nextAttemptAt).getTime() - Date.now()));
      if (delay) await new Promise((resolve) => window.setTimeout(resolve, delay));
    }
    const processed = await postOwnershipExtraction({ operation: "PROCESS_EXTRACTION_JOB", jobId: job.jobId });
    job = processed.job;
  }
  throw Object.assign(new Error("Your file was saved, but analysis is still running. Please retry shortly."), { evidenceStatus: EVIDENCE_STATUS.ANALYSIS_UNAVAILABLE });
}

function resolutionContext(comparisonItemId, requirements, rows, company) {
  const requirement = requirements.find((item) => item.comparisonItemId === comparisonItemId || item.semanticKey === comparisonItemId);
  const row = rows.find((item) => item.key === comparisonItemId);
  const companyName = requirement?.entity || row?.chartFact?.object?.name || row?.researchFact?.object?.name || company?.legalName || "the company under review";
  const holderName = requirement?.holder || row?.chartFact?.subject?.name || row?.researchFact?.subject?.name || null;
  const nominee = comparisonItemId === "ownership-comparison:nominee-declaration";
  const stage = requirement?.stage || "OWNERSHIP";
  const stageLabel = stage === "CONTROL" ? "Control information" : stage === "FALLBACK" ? "Senior management fallback" : stage === "ADDITIONAL" ? "Additional information" : "Ownership information";
  return {
    companyName,
    holderName,
    nominee,
    stage,
    stageLabel,
    label: nominee ? `Nominee arrangement for ${companyName}` : stage === "CONTROL" ? `Control of ${companyName}` : stage === "FALLBACK" ? `Senior management of ${companyName}` : stage === "ADDITIONAL" ? `Additional information for ${companyName}` : holderName ? `${holderName} → ${companyName}` : `Ownership of ${companyName}`,
  };
}

function answerLabel(question, answer) {
  const value = answer?.value;
  const option = question.options?.find((item) => item.value === value);
  if (option) return option.label;
  if (question.type === QUESTION_TYPE.PERCENTAGE) return `${value}%`;
  if (question.type === QUESTION_TYPE.DATE && value) {
    const parsed = new Date(`${value}T00:00:00`);
    return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleDateString();
  }
  return String(value ?? "");
}

function QuestionInput({ question, value, onChange }) {
  if (question.options) return <fieldset className="ubo-resolution-options">
    <legend className="sr-only">{question.prompt}</legend>
    {question.options.map((option) => <label key={option.value}><input type="radio" name={question.id} value={option.value} checked={value === option.value} onChange={(event) => onChange(event.target.value)} />{option.label}</label>)}
  </fieldset>;
  if (question.type === QUESTION_TYPE.PERCENTAGE) { const label = question.stage === "CONTROL" ? "Voting rights percentage" : "Ownership percentage"; return <label className="ubo-resolution-field"><span>{label}</span><div><input aria-label={label} type="number" min="0" max="100" step="0.01" value={value} onChange={(event) => onChange(event.target.value)} /><span>%</span></div></label>; }
  if (question.type === QUESTION_TYPE.DATE) return <label className="ubo-resolution-field"><span>Effective date</span><input aria-label="Effective date" type="date" value={value} onChange={(event) => onChange(event.target.value)} /></label>;
  return <label className="ubo-resolution-field"><span>Your answer</span><input aria-label="Your answer" type="text" value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

function CustomerQuestion({ question, draft, error, onDraft, onSubmit }) {
  return <article className="ubo-resolution-question">
    <span className="ubo-resolution-question-kicker">{question.stage === "CONTROL" ? "Control question" : question.stage === "FALLBACK" ? "Senior management question" : question.stage === "ADDITIONAL" ? "Additional question" : "Ownership question"}</span>
    <h3>{question.prompt}</h3>
    {question.explanation && <p>{question.explanation}</p>}
    <QuestionInput question={question} value={draft || ""} onChange={onDraft} />
    {error && <p className="ubo-resolution-error" role="alert">{error}</p>}
    <button type="button" className="ubo-customer-primary" disabled={draft === undefined || draft === ""} onClick={onSubmit}>Save answer <span>→</span></button>
  </article>;
}

function QuestionGroup({ questions, allQuestions, evidenceRecords, context, drafts, errors, evidenceState, evidence, retainedFiles, onDraft, onSubmit, onUpload }) {
  const answered = allQuestions.filter(({ status }) => status !== "OPEN").length;
  const evidenceAccepted = evidenceRecords.length > 0 && evidenceRecords.every(({ status }) => status === EVIDENCE_STATUS.SATISFIED);
  return <section className="ubo-resolution-question-group">
    <header>
      <div><small>{context.stageLabel}</small><h3>{context.label}</h3></div>
      <span>{answered} of {allQuestions.length} questions answered</span>
    </header>
    <dl>
      <div><dt>Company / structure</dt><dd>{context.companyName}</dd></div>
      {context.holderName && <div><dt>Shareholder or owner</dt><dd>{context.holderName}</dd></div>}
    </dl>
    {questions.length > 0
      ? <p>Complete each open question in this group. Unanswered sibling questions stay here unless an answer makes them no longer applicable; new follow-ups may appear when your answer changes what is needed.</p>
      : evidenceAccepted
        ? <p><strong>All questions for this issue are answered.</strong> Supporting evidence has been accepted and remains visible below.</p>
        : <p><strong>All questions for this issue are answered.</strong> Supporting evidence is still required before the issue can be resolved.</p>}
    {questions.length > 0 && <div>{questions.map((question) => <CustomerQuestion key={question.id} question={question} draft={drafts[question.id]} error={errors[question.id]} onDraft={(value) => onDraft(question.id, value)} onSubmit={() => onSubmit(question)} />)}</div>}
    {evidenceRecords.length > 0 && <div className="ubo-resolution-group-evidence">
      <p>Supporting evidence for this ownership issue</p>
      {evidenceRecords.map((record) => <EvidenceRequest key={record.id} record={record} context={context} busy={evidenceState.busyId === record.id} message={evidenceState.messages[record.id] || evidence[record.id]?.reason} retainedFile={retainedFiles[record.id]} retryAvailable={Boolean(retainedFiles[record.id])} onUpload={onUpload} onRetry={() => onUpload(record, retainedFiles[record.id])} />)}
    </div>}
  </section>;
}

function AnsweredQuestion({ question, answer, context, editing, draft, error, onEdit, onDraft, onSave, onCancel }) {
  return <article className="ubo-resolution-answered-question">
    <div>
      <span>Answered {question.stage === "CONTROL" ? "control" : question.stage === "FALLBACK" ? "senior management" : question.stage === "ADDITIONAL" ? "additional" : "ownership"} question</span>
      <h3>{question.prompt}</h3>
      <p className="ubo-resolution-item-context">{context.label}</p>
    </div>
    {editing ? <>
      <QuestionInput question={question} value={draft ?? answer.value ?? ""} onChange={onDraft} />
      {error && <p className="ubo-resolution-error" role="alert">{error}</p>}
      <div className="ubo-resolution-edit-actions">
        <button type="button" className="ubo-customer-primary" disabled={draft === undefined || draft === ""} onClick={onSave}>Save change <span>→</span></button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </> : <div className="ubo-resolution-answer-summary">
      <p><small>Your answer</small><strong>{answerLabel(question, answer)}</strong></p>
      <button type="button" onClick={onEdit}>Edit answer</button>
    </div>}
  </article>;
}

function EvidencePreview({ file }) {
  const [previewUrl, setPreviewUrl] = useState(null);
  useEffect(() => {
    if (!file || typeof URL.createObjectURL !== "function") return undefined;
    const nextUrl = URL.createObjectURL(file);
    const revokeObjectURL = typeof URL.revokeObjectURL === "function" ? URL.revokeObjectURL.bind(URL) : null;
    setPreviewUrl(nextUrl);
    return () => { revokeObjectURL?.(nextUrl); };
  }, [file]);
  if (!previewUrl) return null;
  return <details className="ubo-resolution-evidence-preview">
    <summary>View uploaded document</summary>
    {file.type === "application/pdf"
      ? <iframe src={previewUrl} title={`Preview of ${file.name}`} />
      : <img src={previewUrl} alt={`Preview of ${file.name}`} />}
  </details>;
}

function EvidenceRequest({ record, context, busy, message, retainedFile, retryAvailable, onUpload, onRetry }) {
  const input = useRef(null);
  const canChooseFile = [EVIDENCE_STATUS.OPEN, EVIDENCE_STATUS.REJECTED, EVIDENCE_STATUS.ANALYSIS_UNAVAILABLE, EVIDENCE_STATUS.ANALYST_REVIEW].includes(record.status);
  const chooseFile = () => {
    if (!input.current) return;
    input.current.value = "";
    input.current.click();
  };
  return <article className={`ubo-resolution-evidence ${String(record.status).toLowerCase()}`}>
    <div><span>Supporting evidence</span><h3>{record.purpose}</h3></div>
    <dl className="ubo-resolution-evidence-context">
      <div><dt>For company / structure</dt><dd>{context.companyName}</dd></div>
      {context.holderName && <div><dt>Related shareholder or owner</dt><dd>{context.holderName}</dd></div>}
      {context.nominee && <div><dt>Related declaration</dt><dd>Nominee or bare-trust arrangement</dd></div>}
    </dl>
    <p>Preferred: {record.preferredEvidenceTypes.map(humanize).join(", ")}.</p>
    <details><summary>Other accepted evidence</summary><p>{record.alternativeEvidenceTypes.map(humanize).join(", ")}.</p></details>
    <p className="ubo-resolution-evidence-boundary">{record.status === EVIDENCE_STATUS.SATISFIED ? "This evidence passed the existing Evidence staging, extraction and validation path and is retained with this ownership issue." : "This issue remains unresolved until supporting evidence passes the existing Evidence staging, extraction and validation path. Uploading it does not itself resolve the issue."}</p>
    {record.status !== EVIDENCE_STATUS.SATISFIED && <p>Accepted file formats: PDF, PNG or JPEG, up to 3 MB.</p>}
    {record.filename && <div className="ubo-resolution-evidence-file"><span aria-hidden="true">▤</span><div><strong>{record.filename}</strong><small>{record.status === EVIDENCE_STATUS.SATISFIED ? "File received · evidence accepted" : record.status === EVIDENCE_STATUS.ANALYSIS_UNAVAILABLE ? "File received · analysis not completed" : record.status === EVIDENCE_STATUS.REJECTED ? "File received · evidence not accepted" : "File received"}</small></div></div>}
    {record.status === EVIDENCE_STATUS.SATISFIED && <EvidencePreview file={retainedFile} />}
    <input ref={input} type="file" className="ubo-customer-file-input" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" onChange={(event) => { const file = event.currentTarget.files?.[0] || null; event.currentTarget.value = ""; onUpload(record, file); }} />
    {record.status === EVIDENCE_STATUS.ANALYSIS_UNAVAILABLE && retryAvailable && <button type="button" onClick={onRetry} disabled={busy}>Retry analysis</button>}
    {canChooseFile && <button type="button" onClick={chooseFile} disabled={busy}>{busy ? "Validating evidence…" : record.status === EVIDENCE_STATUS.OPEN ? "Choose supporting evidence" : "Choose another file"}</button>}
    {record.status !== EVIDENCE_STATUS.OPEN && <strong className="ubo-resolution-evidence-status">{humanize(record.status)}</strong>}
    {message && <p role="status">{message}</p>}
  </article>;
}

export default function OwnershipResolutionQuestions({ researchResult, result, company, context }) {
  const restored = useMemo(() => readSession(context, result), [context, result]);
  const [answers, setAnswers] = useState(restored?.answers || {});
  const [evidence, setEvidence] = useState(restored?.evidence || {});
  const [recalculations, setRecalculations] = useState(restored?.recalculations || {});
  const [drafts, setDrafts] = useState({});
  const [errors, setErrors] = useState({});
  const [editingQuestionId, setEditingQuestionId] = useState(null);
  const [evidenceState, setEvidenceState] = useState({ busyId: null, messages: {} });
  const evidenceFiles = useRef({});
  const requestedRecalculations = useRef(new Set());
  const durableSyncs = useRef(new Set());
  const answerSubmissions = useRef(new Set());
  const recalculationGeneration = useRef(0);
  const createdAt = useRef(restored?.createdAt || new Date().toISOString());
  // The same calculation the server runs (caseResolution.js); the server's result is the record.
  const inputs = useMemo(() => caseInputs({ researchResult, chartResult: result, company }), [researchResult, result, company]);
  const { rows } = inputs;
  const engine = useMemo(() => evaluateCase(inputs, { answers, evidence, recalculations, now: createdAt.current }), [inputs, answers, evidence, recalculations]);
  const currentTrace = useMemo(() => resolutionTrace({ engine, rows, answers, previousTrace: readCurrentTrace(context), recalculations }), [answers, context, engine, recalculations, rows]);

  const durableResolution = (nextAnswers = answers, nextEvidence = evidence, nextRecalculations = recalculations, trace = currentTrace, submittedAnswer = null) => ({
    createdAt: createdAt.current,
    requirements: engine.requirements,
    questions: trace.questions || engine.questions,
    evidenceRequirements: engine.evidenceRequirements,
    answers: nextAnswers,
    evidence: nextEvidence,
    recalculations: nextRecalculations,
    trace,
    ...(submittedAnswer ? { submittedAnswer } : {}),
  });

  useEffect(() => { saveSession(context, result, { createdAt: createdAt.current, answers, evidence, recalculations }); }, [answers, context, evidence, recalculations, result]);
  useEffect(() => {
    const signature = smallStableHash([currentTrace.verificationAssessment?.inputStateVersion, answers, evidence, recalculations]);
    if (!context?.demoCaseId || durableSyncs.current.has(signature)) return;
    durableSyncs.current.add(signature);
    persistPocCase("SYNC_RESOLUTION", {
      caseId: context.demoCaseId,
      actorType: "SYSTEM",
      idempotencyKey: `resolution:${signature}`,
      payload: {
        resolution: durableResolution(),
        assessment: { assessmentId: currentTrace.verificationAssessment?.assessmentVersionId, trace: currentTrace, evidence },
        researchResult: { ...researchResult, ownershipResolutionTrace: currentTrace },
      },
    }).catch(() => durableSyncs.current.delete(signature));
    // The signature intentionally represents every submitted substantive projection change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answers, context?.demoCaseId, currentTrace, evidence, recalculations]);
  useEffect(() => {
    try {
      const session = JSON.parse(uboStore.getItem(DEMO_SESSION_KEY) || "null");
      if (session?.contractVersion !== DEMO_SESSION_CONTRACT || session?.demoCase?.demoCaseId !== context?.demoCaseId || !session.researchResult) return;
      const activationStatus = new Map((engine.topicActivations || []).map((item) => [item.id, item]));
      const nextResearch = {
        ...session.researchResult,
        investigationTopicActivations: (session.researchResult.investigationTopicActivations || []).map((item) => ({ ...item, ...(activationStatus.get(item.id) ? { displayStatus: activationStatus.get(item.id).displayStatus, statusReason: activationStatus.get(item.id).reason } : {}) })),
        ownershipResolutionTrace: currentTrace,
      };
      uboStore.setItem(DEMO_SESSION_KEY, JSON.stringify({ ...session, savedAt: new Date().toISOString(), researchResult: nextResearch }));
    } catch (_) { /* Customer questions remain usable when analyst trace persistence is unavailable. */ }
  }, [context?.demoCaseId, currentTrace, engine.topicActivations]);
  useEffect(() => {
    const material = engine.resolutions.filter((resolution) => resolution.resultingFact?.type === "RELATIONSHIP" && resolution.resultingFact.relationship === "ECONOMIC_OWNERSHIP");
    if (!material.length) {
      recalculationGeneration.current += 1;
      return;
    }
    const signature = JSON.stringify(material.map(({ comparisonItemId, resultingFact }) => [comparisonItemId, resultingFact]));
    if (requestedRecalculations.current.has(signature)) return;
    requestedRecalculations.current.add(signature);
    const generation = ++recalculationGeneration.current;
    const savedResult = material.reduce((current, resolution) => applyResultingFact(current, resolution.resultingFact), result);
    clerkAuthHeaders().then((auth) => fetch("/api/ubo-demo-customer-ownership-chart", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...auth },
      body: JSON.stringify({ operation: "REEVALUATE_SAVED_EXTRACTION", demoContext: { company: context.company, referenceCaseId: context.referenceCaseId, demoCaseId: context.demoCaseId }, savedResult }),
    })).then(async (response) => {
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.message || "UBO recalculation failed");
      if (generation !== recalculationGeneration.current) return;
      setRecalculations((current) => {
        const next = { ...current };
        rows.forEach((row) => {
          const sourceFact = row.chartFact || row.researchFact;
          if (!sourceFact) return;
          next[row.key] = {
            determination: determinationFromChartAnalysis(payload.result.chartAnalysis, sourceFact),
            chartAnalysis: payload.result.chartAnalysis,
            recalculatedAt: new Date().toISOString(),
          };
        });
        return next;
      });
    }).catch((caught) => {
      if (generation === recalculationGeneration.current) setRecalculations((current) => Object.fromEntries([
        ...Object.entries(current),
        ...material.map((resolution) => [resolution.comparisonItemId, { determination: resolution.uboImpact.determination, error: caught.message, recalculatedAt: new Date().toISOString() }]),
      ]));
    });
  }, [context, engine.resolutions, result, rows]);

  const submit = (question) => {
    let idempotencyKey;
    try {
      const value = answerValue(question, drafts[question.id]);
      const previousValue = answers[question.id]?.value;
      const changed = previousValue !== value;
      const answeredAt = new Date().toISOString();
      const answer = { value, answeredAt, factRequirementId: question.factRequirementId, comparisonItemId: question.comparisonItemId };
      const nextAnswers = { ...answers, [question.id]: answer };
      const nextRecalculations = { ...recalculations };
      const nextEvidence = { ...evidence };
      if (changed) {
        delete nextRecalculations[question.comparisonItemId];
        engine.evidenceRequirements.filter(({ comparisonItemId }) => comparisonItemId === question.comparisonItemId).forEach(({ id }) => delete nextEvidence[id]);
      }
      const nextEngine = evaluateCase(inputs, { answers: nextAnswers, evidence: nextEvidence, recalculations: nextRecalculations, now: createdAt.current });
      const activeQuestionIds = new Set(nextEngine.questions.map(({ id: questionId }) => questionId));
      Object.entries(nextAnswers).forEach(([questionId, stored]) => {
        if (questionId !== question.id && stored.comparisonItemId === question.comparisonItemId && !activeQuestionIds.has(questionId)) delete nextAnswers[questionId];
      });
      const nextTrace = resolutionTrace({ engine: nextEngine, rows, answers: nextAnswers, previousTrace: currentTrace, recalculations: nextRecalculations });
      idempotencyKey = `answer:${smallStableHash([question.id, answers[question.id]?.answeredAt || "initial", value])}`;
      if (answerSubmissions.current.has(idempotencyKey)) return;
      answerSubmissions.current.add(idempotencyKey);
      // Preserve the engine's original functional update semantics. Several
      // answers for one issue can be submitted before the asynchronous
      // recalculation settles; replacing state from a render-time snapshot can
      // otherwise discard the preceding answer.
      setAnswers((current) => {
        const next = { ...current, [question.id]: answer };
        const currentEngine = evaluateCase(inputs, { answers: next, evidence, recalculations, now: createdAt.current });
        const currentQuestionIds = new Set(currentEngine.questions.map(({ id: questionId }) => questionId));
        Object.entries(next).forEach(([questionId, stored]) => {
          if (questionId !== question.id && stored.comparisonItemId === question.comparisonItemId && !currentQuestionIds.has(questionId)) delete next[questionId];
        });
        return next;
      });
      if (changed) {
        setRecalculations((current) => {
          const next = { ...current };
          delete next[question.comparisonItemId];
          return next;
        });
        const relatedEvidenceIds = engine.evidenceRequirements.filter(({ comparisonItemId }) => comparisonItemId === question.comparisonItemId).map(({ id }) => id);
        if (relatedEvidenceIds.length) setEvidence((current) => {
          const next = { ...current };
          relatedEvidenceIds.forEach((id) => delete next[id]);
          return next;
        });
        requestedRecalculations.current.delete(question.comparisonItemId);
      }
      persistPocCase("SUBMIT_ANSWER", {
        caseId: context.demoCaseId,
        actorType: "CUSTOMER",
        idempotencyKey,
        payload: {
          resolution: { ...durableResolution(nextAnswers, nextEvidence, nextRecalculations, nextTrace), submittedAnswer: { question, answer } },
          assessment: { assessmentId: nextTrace.verificationAssessment?.assessmentVersionId, trace: nextTrace, evidence: nextEvidence },
          researchResult: { ...researchResult, ownershipResolutionTrace: nextTrace },
        },
      }).catch((caught) => {
        answerSubmissions.current.delete(idempotencyKey);
        setErrors((current) => ({ ...current, [question.id]: caught.message }));
      });
      setEditingQuestionId(null);
      setErrors((current) => ({ ...current, [question.id]: "" }));
    } catch (caught) { if (idempotencyKey) answerSubmissions.current.delete(idempotencyKey); setErrors((current) => ({ ...current, [question.id]: caught.message })); }
  };
  const resetAnswers = () => {
    clearSession(context, result);
    // The server keeps the answers it is given (merged, most recent wins), so
    // starting again has to be said to it, not only done in this browser.
    if (context?.demoCaseId) persistPocCase("RESET_ANSWERS", { caseId: context.demoCaseId, actorType: "CUSTOMER", idempotencyKey: `reset:${Date.now()}`, payload: {} }).catch(() => {});
    requestedRecalculations.current.clear();
    setAnswers({});
    setEvidence({});
    setRecalculations({});
    setDrafts({});
    setErrors({});
    setEditingQuestionId(null);
    setEvidenceState({ busyId: null, messages: {} });
    evidenceFiles.current = {};
  };
  const uploadEvidence = async (record, file) => {
    if (!file) return;
    if (!ACCEPTED_TYPES.has(file.type) || file.size > MAX_BYTES) {
      setEvidenceState((current) => ({ ...current, messages: { ...current.messages, [record.id]: "Upload a PDF, PNG or JPEG up to 3 MB." } }));
      return;
    }
    evidenceFiles.current[record.id] = file;
    setEvidence((current) => ({ ...current, [record.id]: { status: EVIDENCE_STATUS.RECEIVED, filename: file.name } }));
    setEvidenceState((current) => ({ ...current, busyId: record.id, messages: { ...current.messages, [record.id]: "Evidence received and sent to the existing validation pipeline." } }));
    try {
      setEvidence((current) => ({ ...current, [record.id]: { ...current[record.id], status: EVIDENCE_STATUS.VALIDATING } }));
      const started = await postOwnershipExtraction({
        demoContext: { company: context.company, referenceCaseId: context.referenceCaseId, demoCaseId: context.demoCaseId },
        file: { originalFilename: file.name, declaredMediaType: file.type, sizeBytes: file.size, contentBase64: await fileAsBase64(file) },
        evidenceHandoff: record.handoff,
      });
      const extractionResult = await awaitSupportingEvidenceResult(started);
      const resolution = engine.resolutions.find((item) => item.comparisonItemId === record.comparisonItemId);
      const outcome = evidenceResultStatus(extractionResult, resolution, record);
      const submittedEvidence = { ...(evidence[record.id] || {}), filename: file.name, ...outcome, artifactId: extractionResult.artifact?.artifactId, validatedAt: new Date().toISOString() };
      const nextEvidence = { ...evidence, [record.id]: submittedEvidence };
      setEvidence(nextEvidence);
      setEvidenceState((current) => ({ busyId: null, messages: { ...current.messages, [record.id]: outcome.reason } }));
      try {
        const nextEngine = evaluateCase(inputs, { answers, evidence: nextEvidence, recalculations, now: createdAt.current });
        const nextTrace = resolutionTrace({ engine: nextEngine, rows, answers, previousTrace: currentTrace, recalculations });
        await persistPocCase("SYNC_RESOLUTION", {
          caseId: context.demoCaseId,
          actorType: "CUSTOMER",
          idempotencyKey: `evidence:${record.id}:${extractionResult.artifact?.artifactId}`,
          payload: {
            resolution: durableResolution(answers, nextEvidence, recalculations, nextTrace),
            assessment: { assessmentId: nextTrace.verificationAssessment?.assessmentVersionId, trace: nextTrace, evidence: nextEvidence },
            researchResult: { ...researchResult, ownershipResolutionTrace: nextTrace },
          },
        });
      } catch (syncError) {
        setEvidenceState((current) => ({ busyId: null, messages: { ...current.messages, [record.id]: `${outcome.reason} The case link will retry automatically: ${syncError.message}` } }));
      }
    } catch (caught) {
      setEvidence((current) => ({ ...current, [record.id]: { ...current[record.id], status: caught.evidenceStatus || EVIDENCE_STATUS.REJECTED, reason: caught.message } }));
      setEvidenceState((current) => ({ busyId: null, messages: { ...current.messages, [record.id]: caught.message } }));
    }
  };

  const answeredQuestions = engine.questions.filter((question) => Boolean(answers[question.id]));
  const pendingEvidence = engine.evidenceRequirements.filter(({ status }) => status !== EVIDENCE_STATUS.SATISFIED);
  const activeIssueGroups = Object.values([...engine.openQuestions, ...engine.evidenceRequirements].reduce((groups, item) => {
    const key = item.comparisonItemId;
    if (!groups[key]) groups[key] = { comparisonItemId: key };
    return groups;
  }, {})).map((group) => ({
    ...group,
    questions: engine.openQuestions.filter(({ comparisonItemId }) => comparisonItemId === group.comparisonItemId),
    evidenceRecords: engine.evidenceRequirements.filter(({ comparisonItemId }) => comparisonItemId === group.comparisonItemId),
  }));
  const completed = engine.resolutions.filter(({ resolutionStatus }) => resolutionStatus !== RESOLUTION_STATUS.UNRESOLVED).length;
  const readyForIdv = isReadyForIdentityVerification(currentTrace);
  const readinessMessage = currentTrace.verificationAssessment?.blockingIssues?.[0]?.message || "Complete the remaining questions to continue.";
  const finalizeCurrentAssessment = async (event) => {
    event.preventDefault();
    const finalEngine = evaluateCase(inputs, { answers, evidence, recalculations, now: new Date().toISOString() });
    const finalTrace = resolutionTrace({ engine: finalEngine, rows, answers, previousTrace: readCurrentTrace(context), recalculations, finalized: true });
    try {
      const session = JSON.parse(uboStore.getItem(DEMO_SESSION_KEY) || "null");
      if (session?.contractVersion !== DEMO_SESSION_CONTRACT || session?.demoCase?.demoCaseId !== context?.demoCaseId || !session.researchResult) return;
      uboStore.setItem(DEMO_SESSION_KEY, JSON.stringify({ ...session, savedAt: new Date().toISOString(), researchResult: { ...session.researchResult, ownershipResolutionTrace: finalTrace } }));
      await persistPocCase("FINALIZE_ASSESSMENT", {
        caseId: context.demoCaseId,
        actorType: "CUSTOMER",
        idempotencyKey: `assessment:${finalTrace.verificationAssessment?.assessmentVersionId}`,
        payload: {
          resolution: durableResolution(answers, evidence, recalculations, finalTrace),
          assessment: { assessmentId: finalTrace.verificationAssessment?.assessmentVersionId, trace: finalTrace, evidence },
          researchResult: { ...researchResult, ownershipResolutionTrace: finalTrace },
        },
      });
      window.location.assign(CUSTOMER_IDV_PATH);
    } catch (cause) {
      try {
        const session = JSON.parse(uboStore.getItem(DEMO_SESSION_KEY) || "null");
        if (session?.researchResult) uboStore.setItem(DEMO_SESSION_KEY, JSON.stringify({ ...session, savedAt: new Date().toISOString(), researchResult: { ...session.researchResult, ownershipResolutionTrace: currentTrace } }));
      } catch (_) { /* Server submission failed; the page remains blocked from navigation. */ }
      setErrors((current) => ({ ...current, finalize: cause.message || "The assessment could not be saved." }));
    }
  };
  return <section className="ubo-customer-card ubo-resolution-engine">
    <header><div><small>Questions &amp; resolution</small><h2>{engine.openQuestions.length ? `${engine.openQuestions.length} question${engine.openQuestions.length === 1 ? "" : "s"} for you` : pendingEvidence.length ? `${pendingEvidence.length} supporting evidence request${pendingEvidence.length === 1 ? "" : "s"} remaining` : "No further questions right now"}</h2></div><div className="ubo-resolution-heading-actions"><span>{completed} resolved</span><button type="button" onClick={resetAnswers} disabled={!Object.keys(answers).length && !Object.keys(evidence).length && !Object.keys(recalculations).length}>Start questions again</button></div></header>
    <p className="ubo-resolution-intro">We ask only for facts that remain relevant after comparing the registry research with your ownership chart. Ownership is resolved first; control and fallback questions appear progressively under the active policy.</p>
    {activeIssueGroups.length > 0 && <div className="ubo-resolution-question-groups">{activeIssueGroups.map((group) => <QuestionGroup
      key={group.comparisonItemId}
      questions={group.questions}
      allQuestions={engine.questions.filter(({ comparisonItemId }) => comparisonItemId === group.comparisonItemId)}
      evidenceRecords={group.evidenceRecords}
      context={resolutionContext(group.comparisonItemId, engine.requirements, rows, company)}
      drafts={drafts}
      errors={errors}
      evidenceState={evidenceState}
      evidence={evidence}
      retainedFiles={evidenceFiles.current}
      onDraft={(questionId, value) => setDrafts((current) => ({ ...current, [questionId]: value }))}
      onSubmit={submit}
      onUpload={uploadEvidence}
    />)}</div>}
    {answeredQuestions.length > 0 && <section className="ubo-resolution-answered">
      <header><div><small>Answer history</small><h3>Answered questions</h3></div><span>{answeredQuestions.length}</span></header>
      <p>You can review or change an answer. If it changes the ownership position, the UBO assessment and any affected evidence validation will run again.</p>
      <div>{answeredQuestions.map((question) => <AnsweredQuestion
        key={question.id}
        question={question}
        answer={answers[question.id]}
        context={resolutionContext(question.comparisonItemId, engine.requirements, rows, company)}
        editing={editingQuestionId === question.id}
        draft={drafts[question.id]}
        error={errors[question.id]}
        onEdit={() => { setDrafts((current) => ({ ...current, [question.id]: answers[question.id].value })); setEditingQuestionId(question.id); }}
        onDraft={(value) => setDrafts((current) => ({ ...current, [question.id]: value }))}
        onSave={() => submit(question)}
        onCancel={() => { setEditingQuestionId(null); setErrors((current) => ({ ...current, [question.id]: "" })); }}
      />)}</div>
    </section>}
    <section className="ubo-customer-next-step"><div><small>{readyForIdv ? "Questions complete" : "Identity verification is not ready yet"}</small><h3>Continue to identity verification</h3><p>{readyForIdv ? "We have recalculated the current set of people who need identity verification." : readinessMessage}</p>{errors.finalize && <p className="ubo-resolution-error" role="alert">{errors.finalize}</p>}</div><form action={CUSTOMER_IDV_PATH} method="get" onSubmit={finalizeCurrentAssessment}><button className="ubo-customer-primary" type="submit" disabled={!readyForIdv}>Continue to identity verification <span>→</span></button></form></section>
  </section>;
}
