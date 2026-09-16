import React, { useEffect, useMemo, useRef, useState } from "react";
import { allCandidateFacts } from "../demoResearch";
import { buildChartResearchComparison, filterComparisonEntriesRelevantToCustomer } from "./chartComparison";
import {
  applyResultingFact,
  determinationFromChartAnalysis,
  EVIDENCE_STATUS,
  evaluateOwnershipResolution,
  evidenceResultStatus,
  QUESTION_TYPE,
  RESOLUTION_STATUS,
} from "./ownershipResolutionEngine";

export const OWNERSHIP_RESOLUTION_SESSION_VERSION = "ubo-ownership-resolution-session-v1";
const SESSION_PREFIX = "ubo-demo.ownership-resolution.v1";
const ACCEPTED_TYPES = new Set(["application/pdf", "image/png", "image/jpeg"]);
const MAX_BYTES = 3 * 1024 * 1024;

function sessionKey(context, result) { return `${SESSION_PREFIX}:${context?.demoCaseId || "case"}:${result?.artifact?.artifactId || "artifact"}`; }
function readSession(context, result) {
  try {
    const value = JSON.parse(window.localStorage.getItem(sessionKey(context, result)) || "null");
    return value?.contractVersion === OWNERSHIP_RESOLUTION_SESSION_VERSION ? value : null;
  } catch (_) { return null; }
}
function saveSession(context, result, state) {
  try { window.localStorage.setItem(sessionKey(context, result), JSON.stringify({ contractVersion: OWNERSHIP_RESOLUTION_SESSION_VERSION, savedAt: new Date().toISOString(), ...state })); }
  catch (_) { /* Resolution remains usable when browser-local persistence is unavailable. */ }
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
function statusLabel(status) {
  return {
    [RESOLUTION_STATUS.RESOLVED_CUSTOMER_CONFIRMED]: "Resolved by customer answer",
    [RESOLUTION_STATUS.RESOLVED_EVIDENCE_VERIFIED]: "Resolved with supporting evidence",
    [RESOLUTION_STATUS.RESOLVED_EXISTING_INFORMATION_SUFFICIENT]: "Existing information sufficient",
    [RESOLUTION_STATUS.REQUIRES_ANALYST_REVIEW]: "Analyst review required",
    [RESOLUTION_STATUS.UNRESOLVED]: "Still being resolved",
  }[status] || humanize(status);
}

function QuestionInput({ question, value, onChange }) {
  if (question.options) return <fieldset className="ubo-resolution-options">
    <legend className="sr-only">{question.prompt}</legend>
    {question.options.map((option) => <label key={option.value}><input type="radio" name={question.id} value={option.value} checked={value === option.value} onChange={(event) => onChange(event.target.value)} />{option.label}</label>)}
  </fieldset>;
  if (question.type === QUESTION_TYPE.PERCENTAGE) return <label className="ubo-resolution-field"><span>Ownership percentage</span><div><input aria-label="Ownership percentage" type="number" min="0" max="100" step="0.01" value={value} onChange={(event) => onChange(event.target.value)} /><span>%</span></div></label>;
  if (question.type === QUESTION_TYPE.DATE) return <label className="ubo-resolution-field"><span>Effective date</span><input aria-label="Effective date" type="date" value={value} onChange={(event) => onChange(event.target.value)} /></label>;
  return <label className="ubo-resolution-field"><span>Your answer</span><input aria-label="Your answer" type="text" value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

function CustomerQuestion({ question, draft, error, onDraft, onSubmit }) {
  return <article className="ubo-resolution-question">
    <span className="ubo-resolution-question-kicker">Ownership question</span>
    <h3>{question.prompt}</h3>
    {question.explanation && <p>{question.explanation}</p>}
    <QuestionInput question={question} value={draft || ""} onChange={onDraft} />
    {error && <p className="ubo-resolution-error" role="alert">{error}</p>}
    <button type="button" className="ubo-customer-primary" disabled={draft === undefined || draft === ""} onClick={onSubmit}>Save answer <span>→</span></button>
  </article>;
}

function EvidenceRequest({ record, busy, message, onUpload }) {
  const input = useRef(null);
  return <article className={`ubo-resolution-evidence ${String(record.status).toLowerCase()}`}>
    <div><span>Supporting evidence</span><h3>{record.purpose}</h3></div>
    <p>Preferred: {record.preferredEvidenceTypes.map(humanize).join(", ")}.</p>
    <details><summary>Other accepted evidence</summary><p>{record.alternativeEvidenceTypes.map(humanize).join(", ")}.</p></details>
    <p className="ubo-resolution-evidence-boundary">Your document is sent through the existing Evidence staging, extraction and validation path. Uploading it does not itself resolve the issue.</p>
    <input ref={input} type="file" className="ubo-customer-file-input" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" onChange={(event) => onUpload(record, event.target.files?.[0] || null)} />
    {record.status === EVIDENCE_STATUS.OPEN && <button type="button" onClick={() => input.current?.click()} disabled={busy}>{busy ? "Validating evidence…" : "Choose supporting evidence"}</button>}
    {record.status !== EVIDENCE_STATUS.OPEN && <strong className="ubo-resolution-evidence-status">{humanize(record.status)}</strong>}
    {message && <p role="status">{message}</p>}
  </article>;
}

function AnalystTrace({ engine, rows }) {
  const rowById = new Map(rows.map((row) => [row.key, row]));
  return <details className="ubo-resolution-trace">
    <summary>Analyst reasoning and traceability</summary>
    <div>{engine.resolutions.map((resolution) => {
      const row = rowById.get(resolution.comparisonItemId);
      const requirements = engine.requirements.filter((item) => item.comparisonItemId === resolution.comparisonItemId);
      const questions = engine.questions.filter((item) => item.comparisonItemId === resolution.comparisonItemId);
      const evidence = engine.evidenceRequirements.filter((item) => item.comparisonItemId === resolution.comparisonItemId);
      return <article key={resolution.id}>
        <h4>{row?.chartFact?.subject?.name || row?.researchFact?.subject?.name || "Nominee declaration"} → {row?.chartFact?.object?.name || row?.researchFact?.object?.name || "ownership structure"}</h4>
        <dl>
          <dt>Original comparison</dt><dd>{row?.status || "DECLARATION"} · {row?.detail || "Nominee arrangement check"}</dd>
          <dt>Fact requirements</dt><dd>{requirements.map(({ type }) => type).join(", ") || "None"}</dd>
          <dt>Question states</dt><dd>{questions.map(({ type, status }) => `${type}: ${status}`).join(", ") || "No question required"}</dd>
          <dt>Evidence</dt><dd>{evidence.map(({ status }) => status).join(", ") || "Not required"}</dd>
          <dt>Resulting fact</dt><dd>{resolution.resultingFact ? JSON.stringify(resolution.resultingFact) : "None"}</dd>
          <dt>Ownership establishment</dt><dd>{resolution.ownershipEstablishment}</dd>
          <dt>UBO impact</dt><dd>{resolution.uboImpact.determination} · IDV {resolution.uboImpact.idvRequired ? "required" : "not required"}</dd>
          <dt>Resolution</dt><dd>{resolution.resolutionStatus}</dd>
        </dl>
      </article>;
    })}</div>
  </details>;
}

export default function OwnershipResolutionQuestions({ researchResult, result, company, context }) {
  const restored = useMemo(() => readSession(context, result), [context, result]);
  const [answers, setAnswers] = useState(restored?.answers || {});
  const [evidence, setEvidence] = useState(restored?.evidence || {});
  const [recalculations, setRecalculations] = useState(restored?.recalculations || {});
  const [drafts, setDrafts] = useState({});
  const [errors, setErrors] = useState({});
  const [evidenceState, setEvidenceState] = useState({ busyId: null, messages: {} });
  const requestedRecalculations = useRef(new Set());
  const createdAt = useRef(restored?.createdAt || new Date().toISOString());
  const researchEntries = useMemo(() => filterComparisonEntriesRelevantToCustomer(allCandidateFacts(researchResult), company), [researchResult, company]);
  const chartEntries = useMemo(() => filterComparisonEntriesRelevantToCustomer((result?.candidateFacts || []).map((fact) => ({ fact, source: { artifactId: fact.evidenceReferences?.[0]?.artifactId || fact.evidenceReferences?.[0]?.referenceId } })), company), [result, company]);
  const rows = useMemo(() => buildChartResearchComparison(researchEntries, chartEntries), [researchEntries, chartEntries]);
  const engine = useMemo(() => evaluateOwnershipResolution({ comparisonRows: rows, answers, evidence, recalculations, now: createdAt.current }), [rows, answers, evidence, recalculations]);

  useEffect(() => { saveSession(context, result, { createdAt: createdAt.current, answers, evidence, recalculations }); }, [answers, context, evidence, recalculations, result]);
  useEffect(() => {
    const pending = engine.resolutions.find((resolution) => resolution.resultingFact && !recalculations[resolution.comparisonItemId] && !requestedRecalculations.current.has(resolution.comparisonItemId));
    if (!pending) return;
    requestedRecalculations.current.add(pending.comparisonItemId);
    let active = true;
    fetch("/api/ubo-demo-customer-ownership-chart", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operation: "REEVALUATE_SAVED_EXTRACTION", demoContext: { company: context.company, referenceCaseId: context.referenceCaseId, demoCaseId: context.demoCaseId }, savedResult: applyResultingFact(result, pending.resultingFact) }),
    }).then(async (response) => {
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.message || "UBO recalculation failed");
      if (!active) return;
      setRecalculations((current) => ({ ...current, [pending.comparisonItemId]: {
        determination: determinationFromChartAnalysis(payload.result.chartAnalysis, pending.resultingFact),
        chartAnalysis: payload.result.chartAnalysis,
        recalculatedAt: new Date().toISOString(),
      } }));
    }).catch((caught) => {
      if (active) setRecalculations((current) => ({ ...current, [pending.comparisonItemId]: { determination: pending.uboImpact.determination, error: caught.message, recalculatedAt: new Date().toISOString() } }));
    });
    return () => { active = false; };
  }, [context, engine.resolutions, recalculations, result]);

  const submit = (question) => {
    try {
      const value = answerValue(question, drafts[question.id]);
      setAnswers((current) => ({ ...current, [question.id]: { value, answeredAt: new Date().toISOString(), factRequirementId: question.factRequirementId, comparisonItemId: question.comparisonItemId } }));
      setErrors((current) => ({ ...current, [question.id]: "" }));
    } catch (caught) { setErrors((current) => ({ ...current, [question.id]: caught.message })); }
  };
  const uploadEvidence = async (record, file) => {
    if (!file) return;
    if (!ACCEPTED_TYPES.has(file.type) || file.size > MAX_BYTES) {
      setEvidenceState((current) => ({ ...current, messages: { ...current.messages, [record.id]: "Upload a PDF, PNG or JPEG up to 3 MB." } }));
      return;
    }
    setEvidence((current) => ({ ...current, [record.id]: { status: EVIDENCE_STATUS.RECEIVED, filename: file.name } }));
    setEvidenceState((current) => ({ ...current, busyId: record.id, messages: { ...current.messages, [record.id]: "Evidence received and sent to the existing validation pipeline." } }));
    try {
      setEvidence((current) => ({ ...current, [record.id]: { ...current[record.id], status: EVIDENCE_STATUS.VALIDATING } }));
      const response = await fetch("/api/ubo-demo-customer-ownership-chart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          demoContext: { company: context.company, referenceCaseId: context.referenceCaseId, demoCaseId: context.demoCaseId },
          file: { originalFilename: file.name, declaredMediaType: file.type, sizeBytes: file.size, contentBase64: await fileAsBase64(file) },
          evidenceHandoff: record.handoff,
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.message || "Evidence validation failed");
      const resolution = engine.resolutions.find((item) => item.comparisonItemId === record.comparisonItemId);
      const outcome = evidenceResultStatus(payload.result, resolution, record);
      setEvidence((current) => ({ ...current, [record.id]: { ...current[record.id], ...outcome, artifactId: payload.result.artifact?.artifactId, validatedAt: new Date().toISOString() } }));
      setEvidenceState((current) => ({ busyId: null, messages: { ...current.messages, [record.id]: outcome.reason } }));
    } catch (caught) {
      setEvidence((current) => ({ ...current, [record.id]: { ...current[record.id], status: EVIDENCE_STATUS.REJECTED, reason: caught.message } }));
      setEvidenceState((current) => ({ busyId: null, messages: { ...current.messages, [record.id]: caught.message } }));
    }
  };

  const completed = engine.resolutions.filter(({ resolutionStatus }) => resolutionStatus !== RESOLUTION_STATUS.UNRESOLVED).length;
  return <section className="ubo-customer-card ubo-resolution-engine">
    <header><div><small>Questions &amp; resolution</small><h2>{engine.openQuestions.length ? `${engine.openQuestions.length} ownership question${engine.openQuestions.length === 1 ? "" : "s"} for you` : "No further ownership questions right now"}</h2></div><span>{completed} resolved</span></header>
    <p className="ubo-resolution-intro">We only ask for facts that remain unresolved after comparing the registry research with your ownership chart. Answers can change the questions shown below.</p>
    {engine.openQuestions.length > 0 && <div className="ubo-resolution-question-list">{engine.openQuestions.map((question) => <CustomerQuestion key={question.id} question={question} draft={drafts[question.id]} error={errors[question.id]} onDraft={(value) => setDrafts((current) => ({ ...current, [question.id]: value }))} onSubmit={() => submit(question)} />)}</div>}
    {engine.evidenceRequirements.length > 0 && <div className="ubo-resolution-evidence-list">{engine.evidenceRequirements.map((record) => <EvidenceRequest key={record.id} record={record} busy={evidenceState.busyId === record.id} message={evidenceState.messages[record.id] || evidence[record.id]?.reason} onUpload={uploadEvidence} />)}</div>}
    <div className="ubo-resolution-outcomes">{engine.resolutions.filter(({ comparisonItemId }) => comparisonItemId !== "ownership-comparison:nominee-declaration").map((resolution) => <article key={resolution.id} className={resolution.resolutionStatus.toLowerCase()}><span>{statusLabel(resolution.resolutionStatus)}</span><strong>{resolution.reason}</strong><small>{resolution.uboImpact.determination} · Identity verification {resolution.uboImpact.idvRequired ? "required" : "not required"}</small></article>)}</div>
    <AnalystTrace engine={engine} rows={rows} />
  </section>;
}
