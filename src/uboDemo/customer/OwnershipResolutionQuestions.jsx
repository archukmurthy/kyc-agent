import React, { useEffect, useMemo, useRef, useState } from "react";
import { allCandidateFacts } from "../demoResearch";
import { DEMO_SESSION_CONTRACT, DEMO_SESSION_KEY } from "../demoSession";
import { buildChartResearchComparison, filterComparisonEntriesRelevantToCustomer, partitionResearchEntriesForComparison } from "./chartComparison";
import {
  applyResultingFact,
  determinationFromChartAnalysis,
  EVIDENCE_STATUS,
  evaluateOwnershipResolution,
  evidenceResultStatus,
  QUESTION_TYPE,
  RESOLUTION_STATUS,
} from "./ownershipResolutionEngine";
import { CUSTOMER_IDV_PATH } from "./customerRoute";

export const OWNERSHIP_RESOLUTION_SESSION_VERSION = "ubo-ownership-resolution-session-v1";
const SESSION_PREFIX = "ubo-demo.ownership-resolution.v1";
const ACCEPTED_TYPES = new Set(["application/pdf", "image/png", "image/jpeg"]);
const MAX_BYTES = 3 * 1024 * 1024;
const MEDIA_MISMATCH_MESSAGE = "This file is labelled as a PDF, PNG or JPEG, but its contents do not match that format. Export it again as a PDF, PNG or JPEG, or choose another file.";

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
function clearSession(context, result) {
  try { window.localStorage.removeItem(sessionKey(context, result)); }
  catch (_) { /* In-memory reset still works when browser-local persistence is unavailable. */ }
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

function measurementLabel(measurement) {
  if (!measurement || measurement.type === "UNKNOWN") return "Not established";
  if (measurement.type === "EXACT") return `${measurement.value}%`;
  if (measurement.type === "RANGE") {
    const lower = measurement.lowerBound == null ? "0" : measurement.lowerBound;
    const upper = measurement.upperBound == null ? "100" : measurement.upperBound;
    return `${measurement.lowerInclusive === false ? "(" : "["}${lower}%, ${upper}%${measurement.upperInclusive === false ? ")" : "]"}`;
  }
  return humanize(measurement.type);
}

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

function AnalystTrace({ engine, rows }) {
  const rowById = new Map(rows.map((row) => [row.key, row]));
  return <details className="ubo-resolution-trace">
    <summary>Analyst reasoning and traceability</summary>
    {engine.topicActivations?.length > 0 && <div>{engine.topicActivations.map((topic) => <article key={topic.id}><h4>{humanize(topic.topicCode)}</h4><dl><dt>Origin</dt><dd>Analyst topic</dd><dt>Why activated</dt><dd>{topic.analystReason || topic.reason || "Selected by analyst"}</dd><dt>Status</dt><dd>{humanize(topic.displayStatus)}</dd></dl></article>)}</div>}
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
    {engine.controlResolution?.assessments?.length > 0 && <div>{engine.controlResolution.assessments.map((assessment) => <article key={`${assessment.personId}:${assessment.basis}`}><h4>{assessment.personName} · {humanize(assessment.basis)}</h4><dl><dt>Fact established</dt><dd>{assessment.percentage != null ? `${assessment.percentage}% voting rights` : assessment.controlRight || assessment.controlType}</dd><dt>Evidence</dt><dd>{humanize(assessment.evidenceStatus)}</dd><dt>UBO impact</dt><dd>{assessment.outcome} · IDV {assessment.outcome === "CONTROL_UBO" ? "required" : "not yet required"}</dd><dt>Policy</dt><dd>{assessment.policyId} · {assessment.policyVersion}</dd></dl></article>)}</div>}
    {engine.fallback?.outcome && <article><h4>Senior managing official fallback</h4><dl><dt>Resolution</dt><dd>{humanize(engine.fallback.outcome)}</dd><dt>Why fallback was used</dt><dd>{engine.fallback.reason}</dd><dt>Earlier routes</dt><dd>{[...(engine.auditTrail?.ownershipRoutesAssessed || []), ...(engine.auditTrail?.controlRoutesAssessed || [])].map(humanize).join(", ")}</dd></dl></article>}
  </details>;
}

function ResolutionOutcomes({ engine, rows }) {
  const [open, setOpen] = useState(false);
  const rowById = new Map(rows.map((row) => [row.key, row]));
  const resolutions = engine.resolutions.filter(({ comparisonItemId }) => comparisonItemId !== "ownership-comparison:nominee-declaration");
  if (!resolutions.length) return null;
  return <details className="ubo-resolution-outcomes">
    <summary onClick={() => setOpen((current) => !current)}><div><small>Assessment details</small><strong>How we reached the ownership results</strong></div><span>{resolutions.length} check{resolutions.length === 1 ? "" : "s"}</span></summary>
    {open && <><p>These are recorded assessment outcomes, not additional requirements for you. Expand a check to see which information was sufficient and how it affected the ownership result.</p>
    <div>{resolutions.map((resolution) => {
      const row = rowById.get(resolution.comparisonItemId);
      const sourceFact = resolution.resultingFact || row?.chartFact || row?.researchFact;
      const shareholder = sourceFact?.subject?.name || row?.chartFact?.subject?.name || row?.researchFact?.subject?.name || "Ownership relationship";
      const ownedEntity = sourceFact?.object?.name || row?.chartFact?.object?.name || row?.researchFact?.object?.name || "Company under review";
      const evidenceRecords = engine.evidenceRequirements.filter(({ comparisonItemId }) => comparisonItemId === resolution.comparisonItemId);
      const sufficientReason = resolution.reason || row?.detail || (resolution.resolutionStatus === RESOLUTION_STATUS.RESOLVED_EXISTING_INFORMATION_SUFFICIENT
        ? "The recorded ownership value was precise enough to determine whether this relationship crosses the configured ownership threshold, so no further customer question was required."
        : "The available facts produced this recorded assessment outcome.");
      return <details key={resolution.id} className={resolution.resolutionStatus.toLowerCase()}>
        <summary><div><span>{statusLabel(resolution.resolutionStatus)}</span><strong>{shareholder} → {ownedEntity}</strong></div><small>{resolution.uboImpact.determination === "INDETERMINATE" ? "Further assessment required" : resolution.uboImpact.idvRequired ? "Ownership threshold met · identity verification required" : "Ownership threshold not met · identity verification not required"}</small></summary>
        <dl>
          <div><dt>Why this result was recorded</dt><dd>{sufficientReason}</dd></div>
          {row?.chartFact && <div><dt>Customer ownership chart</dt><dd>{measurementLabel(row.chartFact.measurement)}</dd></div>}
          {row?.researchFact && <div><dt>Independent information</dt><dd>{measurementLabel(row.researchFact.measurement)}</dd></div>}
          {resolution.resultingFact?.measurement && <div><dt>Established current ownership</dt><dd>{measurementLabel(resolution.resultingFact.measurement)}</dd></div>}
          {row?.descriptor && <div><dt>Comparison result</dt><dd>{row.descriptor}</dd></div>}
          {evidenceRecords.length > 0 && <div><dt>Supporting evidence</dt><dd>{evidenceRecords.map(({ status }) => humanize(status)).join(", ")}</dd></div>}
          <div><dt>Threshold outcome</dt><dd>{humanize(resolution.uboImpact.determination)}</dd></div>
          <div><dt>Identity verification</dt><dd>{resolution.uboImpact.idvRequired ? "Required" : "Not required"}</dd></div>
        </dl>
      </details>;
    })}</div></>}
  </details>;
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
  const createdAt = useRef(restored?.createdAt || new Date().toISOString());
  const researchEntries = useMemo(() => partitionResearchEntriesForComparison(filterComparisonEntriesRelevantToCustomer(allCandidateFacts(researchResult), company)).primaryEntries, [researchResult, company]);
  const chartEntries = useMemo(() => filterComparisonEntriesRelevantToCustomer((result?.candidateFacts || []).map((fact) => ({ fact, source: { artifactId: fact.evidenceReferences?.[0]?.artifactId || fact.evidenceReferences?.[0]?.referenceId } })), company), [result, company]);
  const rows = useMemo(() => buildChartResearchComparison(researchEntries, chartEntries), [researchEntries, chartEntries]);
  const topicActivations = useMemo(() => researchResult?.investigationTopicActivations || [], [researchResult]);
  const analystCustomerRequests = useMemo(() => researchResult?.analystCustomerRequests || [], [researchResult]);
  const customerEntityId = company?.registrationNumber || company?.legalName || "CUSTOMER_ENTITY";
  const ownershipContext = useMemo(() => ({ customerDocumentEffectiveDate: result?.certification?.certificationDate || null }), [result]);
  const engine = useMemo(() => evaluateOwnershipResolution({ comparisonRows: rows, answers, evidence, recalculations, chartAnalysis: result?.chartAnalysis, topicActivations, analystCustomerRequests, ownershipContext, customerEntityId, now: createdAt.current }), [rows, answers, evidence, recalculations, result?.chartAnalysis, topicActivations, analystCustomerRequests, ownershipContext, customerEntityId]);

  useEffect(() => { saveSession(context, result, { createdAt: createdAt.current, answers, evidence, recalculations }); }, [answers, context, evidence, recalculations, result]);
  useEffect(() => {
    try {
      const session = JSON.parse(window.localStorage.getItem(DEMO_SESSION_KEY) || "null");
      if (session?.contractVersion !== DEMO_SESSION_CONTRACT || session?.demoCase?.demoCaseId !== context?.demoCaseId || !session.researchResult) return;
      const activationStatus = new Map((engine.topicActivations || []).map((item) => [item.id, item]));
      const nextResearch = {
        ...session.researchResult,
        investigationTopicActivations: (session.researchResult.investigationTopicActivations || []).map((item) => ({ ...item, ...(activationStatus.get(item.id) ? { displayStatus: activationStatus.get(item.id).displayStatus, statusReason: activationStatus.get(item.id).reason } : {}) })),
        ownershipResolutionTrace: {
          contractVersion: "ubo-investigation-trace-v1", updatedAt: new Date().toISOString(),
          ownershipResolution: engine.ownershipResolution, controlResolution: { ...engine.controlResolution, assessments: engine.controlResolution?.assessments || [] },
          fallback: engine.fallback, personOwnershipAssessments: engine.personOwnershipAssessments, uboAssessments: engine.uboAssessments, auditTrail: engine.auditTrail,
          ownershipFacts: engine.resolutions.map((resolution) => {
            const row = rows.find(({ key }) => key === resolution.comparisonItemId);
            return {
              ...resolution,
              originalComparison: row ? { status: row.status, detail: row.detail, descriptor: row.descriptor } : null,
              customerAssertion: row?.chartFact || null,
              independentAssertion: row?.researchFact || null,
              factRequirements: engine.requirements.filter(({ comparisonItemId }) => comparisonItemId === resolution.comparisonItemId),
              questions: engine.questions.filter(({ comparisonItemId }) => comparisonItemId === resolution.comparisonItemId).map((question) => ({ ...question, ...(answers[question.id] ? { answer: answers[question.id].value } : {}) })),
              evidence: engine.evidenceRequirements.filter(({ comparisonItemId }) => comparisonItemId === resolution.comparisonItemId),
            };
          }),
          questions: engine.questions.map((question) => ({ ...question, ...(answers[question.id] ? { answer: answers[question.id].value } : {}) })),
          evidence: engine.evidenceRequirements.map((item) => ({ ...item })),
        },
      };
      window.localStorage.setItem(DEMO_SESSION_KEY, JSON.stringify({ ...session, savedAt: new Date().toISOString(), researchResult: nextResearch }));
    } catch (_) { /* Customer questions remain usable when analyst trace persistence is unavailable. */ }
  }, [answers, context?.demoCaseId, engine, rows]);
  useEffect(() => {
    const material = engine.resolutions.filter((resolution) => resolution.resultingFact?.type === "RELATIONSHIP" && resolution.resultingFact.relationship === "ECONOMIC_OWNERSHIP");
    if (!material.length) return;
    const signature = JSON.stringify(material.map(({ comparisonItemId, resultingFact }) => [comparisonItemId, resultingFact]));
    if (requestedRecalculations.current.has(signature)) return;
    requestedRecalculations.current.add(signature);
    const savedResult = material.reduce((current, resolution) => applyResultingFact(current, resolution.resultingFact), result);
    let active = true;
    fetch("/api/ubo-demo-customer-ownership-chart", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operation: "REEVALUATE_SAVED_EXTRACTION", demoContext: { company: context.company, referenceCaseId: context.referenceCaseId, demoCaseId: context.demoCaseId }, savedResult }),
    }).then(async (response) => {
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.message || "UBO recalculation failed");
      if (!active) return;
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
      if (active) setRecalculations((current) => Object.fromEntries([
        ...Object.entries(current),
        ...material.map((resolution) => [resolution.comparisonItemId, { determination: resolution.uboImpact.determination, error: caught.message, recalculatedAt: new Date().toISOString() }]),
      ]));
    });
    return () => { active = false; };
  }, [context, engine.resolutions, result, rows]);

  const submit = (question) => {
    try {
      const value = answerValue(question, drafts[question.id]);
      const previousValue = answers[question.id]?.value;
      const changed = previousValue !== value;
      setAnswers((current) => {
        const next = { ...current, [question.id]: { value, answeredAt: new Date().toISOString(), factRequirementId: question.factRequirementId, comparisonItemId: question.comparisonItemId } };
        const nextEngine = evaluateOwnershipResolution({ comparisonRows: rows, answers: next, evidence, recalculations, chartAnalysis: result?.chartAnalysis, topicActivations, analystCustomerRequests, ownershipContext, customerEntityId, now: createdAt.current });
        const activeQuestionIds = new Set(nextEngine.questions.map(({ id: questionId }) => questionId));
        Object.entries(next).forEach(([questionId, stored]) => {
          if (questionId !== question.id && stored.comparisonItemId === question.comparisonItemId && !activeQuestionIds.has(questionId)) delete next[questionId];
        });
        return next;
      });
      if (changed) {
        setRecalculations((current) => {
          const next = { ...current };
          delete next[question.comparisonItemId];
          return next;
        });
        const relatedEvidenceIds = engine.evidenceRequirements.filter(({ comparisonItemId }) => comparisonItemId === question.comparisonItemId).map(({ id: evidenceId }) => evidenceId);
        if (relatedEvidenceIds.length) setEvidence((current) => {
          const next = { ...current };
          relatedEvidenceIds.forEach((evidenceId) => delete next[evidenceId]);
          return next;
        });
        requestedRecalculations.current.delete(question.comparisonItemId);
      }
      setEditingQuestionId(null);
      setErrors((current) => ({ ...current, [question.id]: "" }));
    } catch (caught) { setErrors((current) => ({ ...current, [question.id]: caught.message })); }
  };
  const resetAnswers = () => {
    clearSession(context, result);
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
      if (!response.ok || !payload.success) {
        const failure = evidenceUploadFailure(payload, response.status);
        throw Object.assign(new Error(failure.message), { evidenceStatus: failure.status });
      }
      const resolution = engine.resolutions.find((item) => item.comparisonItemId === record.comparisonItemId);
      const outcome = evidenceResultStatus(payload.result, resolution, record);
      setEvidence((current) => ({ ...current, [record.id]: { ...current[record.id], ...outcome, artifactId: payload.result.artifact?.artifactId, validatedAt: new Date().toISOString() } }));
      setEvidenceState((current) => ({ busyId: null, messages: { ...current.messages, [record.id]: outcome.reason } }));
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
  const questionsComplete = engine.openQuestions.length === 0
    && pendingEvidence.length === 0
    && engine.ownershipResolution?.status === "COMPLETE"
    && (engine.uboAssessments?.length > 0 || engine.fallback?.outcome === "FALLBACK_SENIOR_MANAGING_OFFICIAL_IDENTIFIED");
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
    {questionsComplete && <section className="ubo-customer-next-step"><div><small>Questions complete</small><h3>Continue to identity verification</h3><p>We have recalculated the final set of people who need identity verification.</p></div><a className="ubo-customer-primary" href={CUSTOMER_IDV_PATH}>Continue to IDV <span>→</span></a></section>}
  </section>;
}
