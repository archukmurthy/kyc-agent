import React, { useEffect, useMemo, useRef, useState } from "react";
import { ownershipLabelFor } from "../demoSession";
import { allCandidateFacts } from "../demoResearch";
import AssertionDetails from "../AssertionDetails";
import {
  clearCustomerOwnershipChartSession,
  chartSourceCoverage,
  CURRENT_OWNERSHIP_EXTRACTION_PROFILE,
  customerOwnershipChartExtractionsForContext,
  customerOwnershipChartSessionForContext,
  clearCustomerOwnershipJob,
  readCustomerOwnershipJob,
  readCustomerDemoContext,
  saveCustomerOwnershipChartExtraction,
  writeCustomerOwnershipChartSession,
  writeCustomerOwnershipJob,
} from "./customerOwnershipChartSession";
import CustomerJourneyHeader from "./CustomerJourneyHeader";
import ChartAnalysisPanel from "./ChartAnalysisPanel";
import ChartResearchComparison from "./ChartResearchComparison";
import ResearchRequiredNotice, { hasResearch } from "./ResearchRequiredNotice";
import { CUSTOMER_QUESTIONS_PATH } from "./customerRoute";
import { clearCustomerOwnershipChartPreview, customerOwnershipChartPreviewFor, writeCustomerOwnershipChartPreview } from "./customerOwnershipChartPreview";
import "./customerOwnershipChart.css";
import { persistPocCase, smallStableHash } from "../pocCaseClient";
import { clerkAuthHeaders } from "../../auth/clerkFetch";
import { limitNotice } from "../../trials/limitNotice";

const CHART_CALCULATION_SEMANTICS_VERSION = "ubo-demo-chart-calculation-v3";

const ACCEPTED_TYPES = new Set(["application/pdf", "image/png", "image/jpeg"]);
const MAX_BYTES = 3 * 1024 * 1024;
export const RUNNING_POLL_MS = 4000;
export const PROGRESS_POLL_MS = 3000;
const TRANSIENT_LOOKS = 5;

function fileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || "").split(",").pop() || "");
    reader.onerror = () => reject(new Error("We could not read that file. Please choose it again."));
    reader.readAsDataURL(file);
  });
}

function validateFile(file) {
  if (!file) return "Choose an ownership chart to continue.";
  if (!ACCEPTED_TYPES.has(file.type)) return "Upload a PDF, PNG or JPEG ownership chart.";
  if (file.size > MAX_BYTES) return "The ownership chart must be 3 MB or smaller for this demo.";
  return "";
}

function analysisFailureMessage(payload, status) {
  // The rate limiter names itself in `error`, every other refusal in `code`.
  const code = String(payload?.code || payload?.error || "customer_ownership_chart_failed");
  const messages = {
    provider_timeout: "The document was received, but analysis reached its time limit. Please retry once.",
    provider_output_truncated: "The document was received, but the analysis result was too large to complete safely.",
    provider_malformed_output: "The document was received, but the analysis service returned an unusable result.",
    provider_unavailable: "The document was received, but the analysis service is temporarily unavailable.",
    provider_authentication_failed: "The document was received, but the analysis service is not configured correctly.",
    media_too_large: "The document was received, but its decoded image is too large for analysis.",
    media_limit_exceeded: "The document was received, but its image dimensions exceed the analysis limit.",
    invalid_media: "The selected file is labelled as an image, but its contents are not a valid supported image.",
    unsupported_model_media: "The document was received, but this file format is not supported by the configured analysis model.",
  };
  // A limit reached is the product working, not a failure to analyse. Showing
  // "We could not analyse this chart" to a prospect whose trial just ended
  // reads as broken software at the moment they are deciding whether to buy.
  const notice = limitNotice(code, payload?.message);
  if (notice) return `${notice.title}. ${notice.body}`;
  if (status >= 500 || code === "analysis_temporarily_unavailable" || code.startsWith("provider_")) {
    return "We couldn't complete the analysis right now. Your document has been saved safely. Please try again.";
  }
  const message = messages[code] || payload?.message || "We could not analyse this ownership chart.";
  return code ? `${message} Reference: ${code}${status ? ` (${status})` : ""}.` : message;
}

function relationshipValue(assertion) {
  const measurement = assertion.measurement;
  if (!measurement) return assertion.qualitativeValue || "Relationship stated";
  if (measurement.type === "EXACT") return `${measurement.value}%`;
  if (measurement.type === "RANGE") {
    const left = measurement.lowerInclusive ? "[" : "(";
    const right = measurement.upperInclusive ? "]" : ")";
    return `${left}${measurement.lowerBound ?? 0}%, ${measurement.upperBound ?? 100}%${right}`;
  }
  return "Percentage not stated";
}

function CompanyContext({ context }) {
  return <section className="ubo-customer-context" aria-label="Company being reviewed">
    <div><small>Ownership review for</small><strong>{context.company.legalName}</strong></div>
    <dl>
      <div><dt>Registration</dt><dd>{context.company.registrationNumber}</dd></div>
      <div><dt>Country</dt><dd>{context.company.countryName}</dd></div>
      <div><dt>Ownership type</dt><dd>{ownershipLabelFor(context.company.ownershipType)}</dd></div>
      {context.referenceCaseId && <div><dt>Case reference</dt><dd>{context.referenceCaseId}</dd></div>}
    </dl>
  </section>;
}

// A reading takes one to three minutes (one AI pass, two when the first is
// incomplete). Said plainly, with the time so far, so a long wait reads as work
// in progress rather than a stuck page.
const PARTY_GLYPH = { natural_person: "●", legal_entity: "▣", trust_or_legal_arrangement: "◆" };

// What the reading has found so far, as it is found. A draft: the checked
// reading replaces it, and nothing is decided from it.
function FoundSoFar({ progress }) {
  const parties = progress?.parties || [];
  const connections = progress?.connections || [];
  if (!parties.length) return null;
  return <div className="ubo-customer-found-so-far" aria-live="polite">
    <strong>Found so far <span>Not checked yet</span></strong>
    <ul className="ubo-customer-found-parties">{parties.map((party, index) => <li key={`${party.label}:${index}`}><span aria-hidden="true">{PARTY_GLYPH[party.type] || "○"}</span>{party.label}<small>{party.type === "natural_person" ? "Person" : party.type === "legal_entity" ? "Company" : party.type === "trust_or_legal_arrangement" ? "Trust or arrangement" : "Unclear"}</small></li>)}</ul>
    {connections.length > 0 && <ul className="ubo-customer-found-connections">{connections.map((connection, index) => <li key={`${connection.from}:${connection.to}:${index}`}>{connection.from} <span aria-hidden="true">→</span><span className="ubo-customer-visually-hidden"> owns part of </span> {connection.to}{connection.percentage ? <b> · {connection.percentage}</b> : null}</li>)}</ul>}
  </div>;
}

function ReadingProgress({ progress, startedAt }) {
  // Counted from when the reading began (the job's creation), not from when
  // this panel appeared: reopening the page mid-reading showed 0:00 again.
  const since = useMemo(() => {
    const at = startedAt ? new Date(startedAt).getTime() : NaN;
    return Number.isFinite(at) && at <= Date.now() ? at : Date.now();
  }, [startedAt]);
  const [seconds, setSeconds] = useState(() => Math.floor((Date.now() - since) / 1000));
  useEffect(() => {
    const tick = () => setSeconds(Math.floor((Date.now() - since) / 1000));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [since]);
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  return <div className="ubo-customer-reading-progress" role="status">
    <strong>{progress?.stage === "CHECKING" ? "Checking the reading against your chart" : "Reading your chart"} · {clock}</strong>
    <p>{progress?.stage === "CHECKING" ? "A second look so nothing is missed. Almost there." : seconds < 90 ? "We are finding each person and company on it and the percentages between them. This usually takes one to two minutes." : "Still reading - a detailed chart takes a little longer."}</p>
    <FoundSoFar progress={progress} />
    <small>You can leave this page. The reading carries on, and it will be here when you come back.</small>
  </div>;
}

function UploadPanel({ file, error, busy, progress, startedAt, retryAvailable, onChoose, onAnalyse, onRemove }) {
  const input = useRef(null);
  return <section className="ubo-customer-card ubo-customer-upload-card">
    <div className="ubo-customer-card-title"><span className="ubo-customer-icon" aria-hidden="true">↥</span><div><small>One document</small><h2>Upload your ownership chart</h2></div></div>
    <p>Provide the chart that shows the people and companies in your ownership structure, including percentages where available.</p>
    <aside className="ubo-customer-certified-note"><span aria-hidden="true">✓</span><div><strong>A certified chart can make verification quicker</strong><p>If you have one signed or certified by an accountant, lawyer or another qualified professional, upload that version. A regular ownership chart is also fine—we may ask follow-up questions later.</p></div></aside>
    <input ref={input} className="ubo-customer-file-input" type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" onChange={(event) => onChoose(event.target.files?.[0] || null)} />
    {!file ? <button type="button" className="ubo-customer-dropzone" onClick={() => input.current?.click()}>
      <span className="ubo-customer-file-glyph" aria-hidden="true">▤</span>
      <strong>Choose an ownership chart</strong>
      <small>PDF, PNG or JPEG · up to 3 MB</small>
    </button> : <div className="ubo-customer-file-row">
      <span className="ubo-customer-file-glyph" aria-hidden="true">▤</span>
      <div><strong>{file.name}</strong><small>{(file.size / 1024).toFixed(0)} KB · ready to analyse</small></div>
      <button type="button" onClick={onRemove} disabled={busy}>Remove</button>
    </div>}
    {error && <p className="ubo-customer-error" role="alert">{error}</p>}
    {busy && <ReadingProgress progress={progress} startedAt={startedAt} />}
    <div className="ubo-customer-upload-actions"><small>{retryAvailable ? "Your document is saved safely. Retry will reuse it." : "Your file is saved before analysis begins."}</small><button type="button" className="ubo-customer-primary" onClick={onAnalyse} disabled={busy}>{busy ? "Analysing your ownership structure…" : retryAvailable ? "Try analysis again" : "Upload and analyse"}<span>→</span></button></div>
  </section>;
}

function SavedExtractionsPanel({ records, onUse }) {
  if (!records.length) return null;
  return <section className="ubo-customer-card ubo-customer-saved-extractions">
    <div><small>Saved document extracts</small><h2>Reuse an earlier chart analysis</h2><p>Charts read earlier in this visit for the same company. They are kept only until you close or reload this page; the original document is not kept here.</p></div>
    <div>{records.map((record) => { const coverage = chartSourceCoverage(record.result); return <button type="button" key={record.recordId} onClick={() => onUse(record)}>
      <strong>{record.result.artifact.originalFilename || "Ownership chart"}</strong>
      <span>{record.result.candidateFacts?.length || 0} assertions · {record.result.sourceGraph?.relationships?.length || 0} relationships · saved {new Date(record.savedAt).toLocaleString()}</span>
      {coverage.state === "REVIEW_REQUIRED" && <span>Incomplete map · relationship chain does not reach the customer</span>}
      <small>Use saved extraction — no provider call</small>
    </button>; })}</div>
  </section>;
}

function CertificationCard({ certification }) {
  const found = certification?.status === "FOUND";
  const [expanded, setExpanded] = useState(true);
  return <section className="ubo-customer-card ubo-customer-result-card">
    <header><div><small>Certification assessment</small><h2>{found ? "Certification found" : "No certification found"}</h2></div><div className="ubo-customer-heading-actions"><span className={found ? "ubo-customer-status found" : "ubo-customer-status neutral"}>{found ? "Found in chart" : "Regular chart"}</span><button className="ubo-customer-collapse-button" type="button" aria-expanded={expanded} aria-controls="ubo-customer-certification-content" onClick={() => setExpanded((value) => !value)}>{expanded ? "Collapse" : "Expand"}</button></div></header>
    {expanded && <div id="ubo-customer-certification-content">{found ? <>
      <div className="ubo-customer-cert-grid">
        <div><small>Signer</small><strong>{certification.signerName || "Name not stated"}</strong></div>
        <div><small>Qualification</small><strong>{certification.signerPostnominal || "Not stated"}</strong></div>
        <div><small>Capacity</small><strong>{certification.signerCapacity || "Not stated"}</strong></div>
        <div><small>Certification date</small><strong>{certification.certificationDate || "Not stated"}</strong></div>
        {certification.professionalReference && <div><small>Professional reference</small><strong>{certification.professionalReference}</strong></div>}
        <div><small>Signature</small><strong>{certification.signaturePresence || "Not stated"}</strong></div>
      </div>
      {certification.declaration && <blockquote>“{certification.declaration}”</blockquote>}
      <div className="ubo-customer-verification-note"><span aria-hidden="true">!</span><p><strong>Verification of this certification is still required.</strong> We found source certification details, but have not independently verified the signer’s identity, credentials or authority.</p></div>
    </> : <p className="ubo-customer-muted">That’s okay. We extracted the chart as provided. Additional evidence or questions may be needed in a later step.</p>}</div>}
  </section>;
}

// eslint-disable-next-line no-unused-vars -- Temporarily retained while its render call remains commented out.
function OwnersCard({ owners }) {
  const [expanded, setExpanded] = useState(true);
  return <section className="ubo-customer-card ubo-customer-result-card">
    <header><div><small>What we found in your chart</small><h2>{owners.length ? `${owners.length} owner${owners.length === 1 ? "" : "s"} identified` : "No owners confidently identified"}</h2></div><div className="ubo-customer-heading-actions"><span className="ubo-customer-status found">Source-backed facts</span><button className="ubo-customer-collapse-button" type="button" aria-expanded={expanded} aria-controls="ubo-customer-owners-content" onClick={() => setExpanded((value) => !value)}>{expanded ? "Collapse" : "Expand"}</button></div></header>
    {expanded && <div id="ubo-customer-owners-content">{owners.length ? <div className="ubo-customer-owner-grid">{owners.map((owner, index) => <article key={`${owner.name}-${index}`}><span>{owner.partyType === "NATURAL_PERSON" ? "Person" : "Company"}</span><h3>{owner.name}</h3><p>{owner.relationshipLabel}</p><strong>{relationshipValue(owner)}</strong><small>Candidate fact · not a UBO conclusion</small></article>)}</div> : <p className="ubo-customer-muted">The document remains available as evidence, but no source-supported directed ownership relationship was extracted.</p>}</div>}
  </section>;
}

function ExistingResearchAssertions({ researchResult }) {
  const rows = allCandidateFacts(researchResult);
  if (!rows.length) return null;
  return <AssertionDetails entries={rows} eyebrow="From public registers" title="What the registers already show about your company" sourceNotice="This is what public registers say about your company. You do not need to do anything with it; your chart is compared with it." variant="customer" collapseButton />;
}

function ChartAssertions({ result }) {
  const [expanded, setExpanded] = useState(false);
  if (result.candidateFacts?.length) return <AssertionDetails entries={result.candidateFacts.map((fact) => ({ fact: { ...fact, issues: (result.assertions || []).find((item) => item.factId === fact.factId)?.issues || [] }, source: { sourceLabel: "Customer-uploaded Evidence Artifact", artifactId: result.artifact?.artifactId } }))} eyebrow="Evidence → UBO handoff" title="Assertions extracted from your ownership chart" sourceNotice="Candidate information is shown in full. It is not analyst-approved or independently verified." variant="customer" collapseButton />;
  return <section className="ubo-customer-card ubo-customer-assertions"><div className="ubo-demo-assertion-heading"><div><small>Legacy browser cache</small><strong>Assertions extracted from your ownership chart</strong><span>{result.assertions?.length || 0} reduced assertions</span></div><button className="ubo-customer-collapse-button" type="button" aria-expanded={expanded} aria-controls="ubo-customer-legacy-assertions" onClick={() => setExpanded((value) => !value)}>{expanded ? "Collapse" : "Expand"}</button></div>{expanded && <div id="ubo-customer-legacy-assertions"><p className="ubo-customer-source-notice">This earlier cached result retained only reduced display text. Full CandidateFact detail and engine inputs are unavailable in this cache and have not been invented.</p><div>{(result.assertions || []).map((assertion, index) => <article key={assertion.factId || index}><span>{assertion.category}</span><p>{assertion.statement}</p><small>{assertion.supportStateLabel} · Candidate assertion · legacy detail unavailable</small></article>)}</div></div>}</section>;
}

// After a reload the page has no copy of the file; it is read back from where
// the upload was stored (free - the AI does not read it again).
function useStoredChartFile(jobId, wanted) {
  const [stored, setStored] = useState({ state: "IDLE" });
  const requested = useRef(null);
  useEffect(() => {
    if (!wanted || !jobId || requested.current === jobId) return undefined;
    requested.current = jobId;
    let active = true;
    let finished = false;
    let objectUrl = null;
    setStored({ state: "LOADING" });
    clerkAuthHeaders().then((auth) => fetch("/api/ubo-demo-customer-ownership-chart", {
      method: "POST", headers: { "Content-Type": "application/json", ...auth }, body: JSON.stringify({ operation: "GET_CHART_FILE", jobId }),
    })).then(async (response) => {
      if (!response.ok) throw new Error("unavailable");
      const blob = await response.blob();
      objectUrl = URL.createObjectURL(blob);
      finished = true;
      if (active) setStored({ state: "READY", url: objectUrl, mediaType: blob.type });
    }).catch(() => { finished = true; if (active) setStored({ state: "UNAVAILABLE" }); });
    // Closed before it arrived: ask again next time it is opened.
    return () => { active = false; if (!finished) requested.current = null; };
  }, [jobId, wanted]);
  useEffect(() => () => { if (stored.url) URL.revokeObjectURL(stored.url); }, [stored.url]);
  return stored;
}

function UploadedChartReceipt({ result, preview, onReplace }) {
  const [showPreview, setShowPreview] = useState(false);
  const stored = useStoredChartFile(result.durableExtraction?.jobId?.startsWith("legacy-") ? null : result.durableExtraction?.jobId, showPreview && !preview);
  const previewSource = preview ? `data:${preview.mediaType};base64,${preview.contentBase64}` : stored.state === "READY" ? stored.url : null;
  const previewMediaType = preview ? preview.mediaType : stored.mediaType;
  const quality = result.extractionQuality;
  const qualityState = quality?.state || ((result.sourceGraph?.relationships || []).length ? "EXTRACTION_SUCCESS_COMPLETE" : "EXTRACTION_INCOMPLETE");
  const qualityMessage = qualityState === "EXTRACTION_SUCCESS_COMPLETE" ? "Ownership chart analysed successfully"
    : qualityState === "EXTRACTION_SUCCESS_PARTIAL" ? "Most ownership structure reconstructed; review required"
      : qualityState === "NO_OWNERSHIP_DATA_CONFIRMED" ? "No ownership relationships were confirmed in the uploaded document"
        : "Could not confidently reconstruct the complete ownership structure";
  const qualityCounts = quality?.metrics
    ? `${quality.metrics.ownershipEdgeCount || 0} ownership relationship${quality.metrics.ownershipEdgeCount === 1 ? "" : "s"} · ${quality.metrics.unresolvedPartyCount || 0} unresolved ${quality.metrics.unresolvedPartyCount === 1 ? "party" : "parties"}`
    : null;
  return <>
    <section className="ubo-customer-received"><span aria-hidden="true">{qualityState === "EXTRACTION_SUCCESS_COMPLETE" ? "✓" : "!"}</span><div><small>Ownership chart received</small><strong>{result.artifact.originalFilename}</strong><p>{Math.ceil(result.artifact.sizeBytes / 1024)} KB · integrity checked · {qualityMessage}</p>{qualityCounts && <p>{qualityCounts}</p>}</div><div className="ubo-customer-received-actions"><button type="button" onClick={() => setShowPreview((value) => !value)}>{showPreview ? "Hide chart" : "View chart"}</button><button type="button" onClick={onReplace}>Replace chart</button></div></section>
    {showPreview && <section className="ubo-customer-card ubo-customer-chart-preview" aria-label="Uploaded ownership chart preview">
      <header><div><small>Uploaded ownership chart</small><h2>{result.artifact.originalFilename}</h2></div><button type="button" onClick={() => setShowPreview(false)}>Close preview</button></header>
      {previewSource ? (previewMediaType === "application/pdf"
        ? <iframe src={previewSource} title={`Preview of ${result.artifact.originalFilename}`} />
        : <img src={previewSource} alt={`Preview of ${result.artifact.originalFilename}`} />)
        : stored.state === "LOADING" ? <div className="ubo-customer-chart-preview-unavailable"><strong>Loading the uploaded chart…</strong></div>
          : <div className="ubo-customer-chart-preview-unavailable"><strong>The uploaded file could not be loaded right now.</strong><p>The ownership results above are unaffected. Try again later, or choose “Replace chart” to upload it again.</p></div>}
    </section>}
  </>;
}

function Results({ result, researchResult, calculationMethod, onCalculationMethod, onReplace, persistenceNotice, preview, analysisVisible }) {
  const coverage = chartSourceCoverage(result);
  const canContinue = result.extractionQuality?.canContinueToQuestions ?? ((result.sourceGraph?.relationships || []).length > 0);
  const continuePanel = (eyebrow, description) => <section className="ubo-customer-next-step" aria-labelledby="ubo-customer-next-step-title"><div><small>{canContinue ? eyebrow : "Ownership extraction needs attention"}</small><h2 id="ubo-customer-next-step-title">{canContinue ? "Continue to questions" : "Review or replace the ownership chart"}</h2><p>{canContinue ? description : "We have kept every supported fact and unresolved item, but cannot safely continue from an empty or incomplete ownership reconstruction."}</p></div>{canContinue ? <a className="ubo-customer-primary" href={CUSTOMER_QUESTIONS_PATH}>Continue to questions <span>→</span></a> : <button className="ubo-customer-primary" type="button" onClick={onReplace}>Replace chart</button>}</section>;
  return <div className="ubo-customer-results">
    <UploadedChartReceipt result={result} preview={preview} onReplace={onReplace} />
    {persistenceNotice && <p role="status" className={`ubo-customer-extraction-save ${persistenceNotice.kind}`}>{persistenceNotice.message}</p>}
    {!analysisVisible ? continuePanel("Ownership chart processed", "The ownership comparison and deterministic calculations have completed in the background. We’ll ask only for information that still matters.") : <>
      <CertificationCard certification={result.certification} />
      <ChartAnalysisPanel analysis={result.chartAnalysis} sourceProjection={result.sourceGraph} legacyProjection={result.chartAnalysis ? null : result.sourceGraph} method={calculationMethod} onMethodChange={onCalculationMethod} coverage={coverage} extractionQuality={result.extractionQuality} companyName={result.company?.legalName || "the customer under review"} afterGraph={<ChartAssertions result={result} />} />
      {/* Temporarily hidden: the owner-summary cards repeat information already available in the chart interpretation and assertions. */}
      {/* <OwnersCard owners={result.owners || []} /> */}
      <ChartResearchComparison researchResult={researchResult} chartFacts={result.candidateFacts || []} company={result.company} />
      {continuePanel("Optional ownership analysis", "This detailed analysis is informational and is not an approval gate.")}
      <div className="ubo-customer-stop"><strong>Chart analysis remains provisional.</strong><p>The uploaded chart and saved research remain distinct sources. This comparison does not merge, overwrite or approve either dataset.</p></div>
    </>}
  </div>;
}

export default function CustomerOwnershipChartPage() {
  const context = useMemo(() => readCustomerDemoContext(), []);
  const restored = useMemo(() => customerOwnershipChartSessionForContext(context), [context]);
  const availableExtractions = useMemo(() => customerOwnershipChartExtractionsForContext(context), [context]);
  const [file, setFile] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // The running reading's draft (GET_EXTRACTION_JOB answers with it while the
  // job runs). Cleared when the reading ends.
  const [readingProgress, setReadingProgress] = useState(null);
  const [readingStartedAt, setReadingStartedAt] = useState(null);
  useEffect(() => { if (!busy) { setReadingProgress(null); setReadingStartedAt(null); } }, [busy]);
  const [result, setResult] = useState(restored && restored.context?.demoCaseId === context?.demoCaseId ? restored.result : null);
  const [preview, setPreview] = useState(() => customerOwnershipChartPreviewFor({ context, result: restored?.result }));
  const [calculationMethod, setCalculationMethod] = useState(restored?.calculationMethod || "EFFECTIVE_INTEREST");
  const [savedExtractions, setSavedExtractions] = useState(availableExtractions);
  const [persistenceNotice, setPersistenceNotice] = useState(result ? { kind: "success", message: result.durableExtraction?.jobId ? "This accepted Evidence extraction was restored from the server-saved case." : "This structured extraction is restored from browser-local demo storage. No provider call was made." } : null);
  const [analysisVisible, setAnalysisVisible] = useState(() => Boolean(restored) && new URLSearchParams(window.location.search).get("view") === "analysis");
  const [failedJob, setFailedJob] = useState(null);
  const reevaluationAttempts = useRef(new Set());
  const uploadInFlight = useRef(false);

  const saveUsableResult = async (nextResult, nextPreview = null, job = null) => {
    const durableJob = job || nextResult?.durableExtraction;
    if (!durableJob?.jobId) throw new Error("Evidence completed the extraction, but its durable job reference was not returned.");
    const durableResult = { ...nextResult, durableExtraction: { jobId: durableJob.jobId, artifactId: durableJob.artifactId || nextResult.artifact?.artifactId, state: durableJob.state || "COMPLETE" } };
    await persistPocCase("ASSOCIATE_CHART", {
      caseId: context.demoCaseId,
      actorType: "CUSTOMER",
      idempotencyKey: `chart:${durableJob.jobId}:${smallStableHash([durableResult.artifact?.artifactId, calculationMethod, durableResult.chartAnalysis?.calculationSemanticsVersion])}`,
      payload: {
        company: context.company,
        chartReference: { jobId: durableJob.jobId, artifactId: durableJob.artifactId || durableResult.artifact?.artifactId, calculationMethod },
        chartProjection: durableResult,
      },
    });
    setResult(durableResult);
    setAnalysisVisible(false);
    if (nextPreview) setPreview(nextPreview);
    clearCustomerOwnershipJob();
    setFailedJob(null);
    try {
      writeCustomerOwnershipChartSession({ context, result: durableResult });
      saveCustomerOwnershipChartExtraction({ context, result: durableResult });
      setSavedExtractions(customerOwnershipChartExtractionsForContext(context));
      setPersistenceNotice({ kind: "success", message: "Your chart is saved to this case on our server and has been read." });
    } catch (saveError) {
      setPersistenceNotice({ kind: "warning", message: "Your chart is saved to this case on our server. This page could not show it - reload the page to continue." });
    }
  };

  const postJob = async (body) => {
    let response;
    try {
      response = await fetch("/api/ubo-demo-customer-ownership-chart", {
        method: "POST", headers: { "Content-Type": "application/json", ...(await clerkAuthHeaders()) }, body: JSON.stringify(body),
      });
    } catch (_) {
      // The connection dropped (a long reading, a network blip): the server
      // may well have carried on. Transient, so the job is looked at again.
      throw Object.assign(new Error(analysisFailureMessage({ code: "connection_lost" }, 0)), { transient: true });
    }
    // A platform error page (a timeout, an overload) is not JSON.
    const payload = await response.json().catch(() => ({ code: `server_${response.status}` }));
    if (!response.ok || !payload.success) {
      throw Object.assign(new Error(analysisFailureMessage(payload, response.status)), { status: response.status, transient: response.status >= 500 || response.status === 429 });
    }
    return payload.job || (payload.result ? {
      jobId: `legacy-response:${payload.result.artifact?.artifactId || "result"}`,
      artifactId: payload.result.artifact?.artifactId,
      correlationId: "legacy-response",
      state: "COMPLETE",
      result: payload.result,
    } : null);
  };

  const watchProgress = (jobId) => {
    let stopped = false;
    let timer = null;
    const look = async () => {
      if (stopped) return;
      try {
        const current = await postJob({ operation: "GET_EXTRACTION_JOB", jobId });
        if (!stopped && current?.progress) setReadingProgress(current.progress);
      } catch (_) { /* The draft is a courtesy; the reading carries on. */ }
      if (!stopped) timer = window.setTimeout(look, PROGRESS_POLL_MS);
    };
    timer = window.setTimeout(look, PROGRESS_POLL_MS);
    return () => { stopped = true; window.clearTimeout(timer); };
  };
  // What the job is after a call to it failed in transit. A few looks, spaced
  // out; the error is shown only if the job cannot be seen at all.
  const jobAfterTransientError = async (job, caught) => {
    for (let look = 0; look < TRANSIENT_LOOKS; look += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, RUNNING_POLL_MS));
      try { return await postJob({ operation: "GET_EXTRACTION_JOB", jobId: job.jobId }); }
      catch (again) { if (!again.transient) throw again; }
    }
    throw caught;
  };

  const continueJob = async (initialJob, nextPreview = null) => {
    let job = initialJob;
    // A reading running elsewhere (this page was left and opened again) is
    // waited for, not re-asked twelve times in a row and given up on. Bounded
    // past the job's lease, after which processing takes it over again.
    const deadline = Date.now() + 10 * 60 * 1000;
    while (Date.now() < deadline) {
      writeCustomerOwnershipJob({ jobId: job.jobId, demoCaseId: context.demoCaseId, artifactId: job.artifactId, correlationId: job.correlationId });
      if (job.state === "COMPLETE" || job.state === "PARTIAL") { await saveUsableResult(job.result, nextPreview, job); return; }
      if (job.state === "FAILED") {
        setFailedJob(job);
        setError("We couldn't complete the analysis right now. Your document has been saved safely. Please try again.");
        return;
      }
      if (job.state === "RETRYING" && job.nextAttemptAt) {
        const delay = Math.max(0, Math.min(9000, new Date(job.nextAttemptAt).getTime() - Date.now()));
        if (delay) await new Promise((resolve) => window.setTimeout(resolve, delay));
      }
      if (job.progress) setReadingProgress(job.progress);
      const { createdAt } = job;
      if (createdAt) setReadingStartedAt((current) => current || createdAt);
      if (job.state === "RUNNING") await new Promise((resolve) => window.setTimeout(resolve, RUNNING_POLL_MS));
      // Processing answers only when the reading ends; meanwhile its draft is
      // asked for separately (a free status check).
      const stopWatching = watchProgress(job.jobId);
      try { job = await postJob({ operation: "PROCESS_EXTRACTION_JOB", jobId: job.jobId }); }
      catch (caught) {
        // A server error on this call is not the reading failing: the reading
        // runs on, and finishes, on the server (live end-to-end check,
        // 2026-10-08: an error was shown for a reading that had completed).
        // Ask what the job really is; only a real failure is shown.
        if (!caught.transient) throw caught;
        job = await jobAfterTransientError(job, caught);
      }
      finally { stopWatching(); }
    }
    throw new Error("Analysis is still safely queued. Refresh this page to continue checking it.");
  };

  useEffect(() => {
    if (!context || result || busy) return undefined;
    const savedJob = readCustomerOwnershipJob();
    if (!savedJob || savedJob.demoCaseId !== context.demoCaseId) return undefined;
    let active = true;
    setBusy(true);
    (async () => {
      try {
        const job = await postJob({ operation: "GET_EXTRACTION_JOB", jobId: savedJob.jobId });
        if (active) await continueJob(job);
      } catch (caught) {
        if (active) setError(caught.message || "We could not resume the saved analysis.");
      } finally { if (active) setBusy(false); }
    })();
    return () => { active = false; };
    // Resume exactly once for the page/context. Job transitions are driven by continueJob.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context?.demoCaseId]);

  useEffect(() => {
    const artifactId = result?.artifact?.artifactId;
    const hasStructuredFacts = Array.isArray(result?.candidateFacts) && result.candidateFacts.length > 0;
    // Calculated is not the same as "found someone": a chart where nobody
    // qualifies has empty lists. Treating that as never calculated re-ran it on
    // every visit, and each run re-attached the chart and dropped the case's
    // assessment (refused outright once finalised).
    const hasCalculationRecords = Array.isArray(result?.chartAnalysis?.view?.qualificationBases)
      && Array.isArray(result?.chartAnalysis?.view?.qualifications);
    const hasCurrentCalculationSemantics = result?.chartAnalysis?.calculationSemanticsVersion === CHART_CALCULATION_SEMANTICS_VERSION;
    const hasCurrentExtractionSemantics = result?.evidence?.ownershipDiagramCompleteness?.verificationStrategyVersion
      === CURRENT_OWNERSHIP_EXTRACTION_PROFILE.verificationStrategyVersion;
    if (!artifactId || !hasStructuredFacts || (hasCalculationRecords && hasCurrentCalculationSemantics && hasCurrentExtractionSemantics) || reevaluationAttempts.current.has(artifactId)) return;
    reevaluationAttempts.current.add(artifactId);
    let active = true;
    (async () => {
      try {
        const response = await fetch("/api/ubo-demo-customer-ownership-chart", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(await clerkAuthHeaders()) },
          body: JSON.stringify({
            operation: "REEVALUATE_SAVED_EXTRACTION",
            demoContext: { company: context.company, referenceCaseId: context.referenceCaseId, demoCaseId: context.demoCaseId },
            savedResult: result,
          }),
        });
        const payload = await response.json();
        if (!response.ok || !payload.success) throw new Error(analysisFailureMessage(payload, response.status));
        if (!active) return;
        const durableResult = { ...payload.result, durableExtraction: result.durableExtraction };
        if (result.durableExtraction?.jobId) await persistPocCase("ASSOCIATE_CHART", {
          caseId: context.demoCaseId,
          actorType: "SYSTEM",
          idempotencyKey: `chart-reevaluated:${result.durableExtraction.jobId}:${smallStableHash(durableResult.chartAnalysis)}`,
          payload: { company: context.company, chartReference: { ...result.durableExtraction, calculationMethod }, chartProjection: durableResult },
        });
        setResult(durableResult);
        writeCustomerOwnershipChartSession({ context, result: durableResult, calculationMethod });
        saveCustomerOwnershipChartExtraction({ context, result: durableResult, calculationMethod });
        setSavedExtractions(customerOwnershipChartExtractionsForContext(context));
        setPersistenceNotice({ kind: "success", message: "Saved chart facts were re-evaluated through the current UBO engine. No provider call was made." });
      } catch (caught) {
        if (active) setPersistenceNotice({ kind: "warning", message: `The saved chart remains available, but its calculation could not be refreshed: ${caught.message}` });
      }
    })();
    return () => { active = false; };
  }, [calculationMethod, context, result]);

  if (!context) return <div className="ubo-customer-page"><CustomerJourneyHeader currentStep={2} /><main className="ubo-customer-empty"><span>Customer ownership step</span><h1>Start with a demo company</h1><p>This direct route needs seeded demo-session company and case context.</p><a href="/ubo-demo/customer/">Enter company details</a></main></div>;
  if (!hasResearch(context.researchResult)) return <ResearchRequiredNotice currentStep={2} stepLabel="Customer ownership step" />;

  const choose = (next) => { setFile(next); setError(validateFile(next)); };
  const remove = () => { setFile(null); setError(""); };
  const replace = () => { clearCustomerOwnershipChartSession(); clearCustomerOwnershipJob(); clearCustomerOwnershipChartPreview(); setResult(null); setPreview(null); setPersistenceNotice(null); setAnalysisVisible(false); setFailedJob(null); remove(); };
  const useSaved = async (record) => {
    setResult(record.result);
    setAnalysisVisible(false);
    setPreview(customerOwnershipChartPreviewFor({ context, result: record.result }));
    setCalculationMethod(record.calculationMethod || "EFFECTIVE_INTEREST");
    setPersistenceNotice({ kind: "success", message: "Saved extraction loaded from this browser. No provider call was made." });
    try {
      if (record.result.durableExtraction?.jobId) await persistPocCase("ASSOCIATE_CHART", {
        caseId: context.demoCaseId,
        actorType: "CUSTOMER",
        idempotencyKey: `chart-reused:${record.result.durableExtraction.jobId}`,
        payload: { company: context.company, chartReference: { ...record.result.durableExtraction, calculationMethod: record.calculationMethod }, chartProjection: record.result },
      });
      writeCustomerOwnershipChartSession({ context, result: record.result, calculationMethod: record.calculationMethod });
    }
    catch (_) { setPersistenceNotice({ kind: "warning", message: "Saved extraction loaded without a provider call, but the active browser session could not be updated." }); }
  };
  const analyse = async () => {
    if (uploadInFlight.current) return;
    const nextError = failedJob ? "" : validateFile(file);
    if (nextError) { setError(nextError); return; }
    uploadInFlight.current = true;
    setBusy(true); setError("");
    try {
      if (failedJob) {
        const retried = await postJob({ operation: "RETRY_EXTRACTION_JOB", jobId: failedJob.jobId });
        setFailedJob(null);
        await continueJob(retried);
        return;
      }
      const contentBase64 = await fileAsBase64(file);
      const job = await postJob({
          demoContext: {
            company: context.company,
            referenceCaseId: context.referenceCaseId,
            demoCaseId: context.demoCaseId,
          },
          file: { originalFilename: file.name, declaredMediaType: file.type, sizeBytes: file.size, contentBase64 },
      });
      let nextPreview = null;
      try { nextPreview = writeCustomerOwnershipChartPreview({ context, result: { artifact: { artifactId: job.artifactId } }, file, contentBase64 }); }
      catch (_) { /* Durable Artifact remains available even if tab preview storage is full. */ }
      await continueJob(job, nextPreview);
    } catch (caught) {
      setError(caught.message || "We could not analyse this ownership chart.");
    } finally { setBusy(false); uploadInFlight.current = false; }
  };
  const changeCalculationMethod = (next) => {
    setCalculationMethod(next);
    if (result) {
      if (result.durableExtraction?.jobId) persistPocCase("ASSOCIATE_CHART", {
        caseId: context.demoCaseId,
        actorType: "ANALYST",
        idempotencyKey: `chart-method:${result.durableExtraction.jobId}:${next}`,
        payload: { company: context.company, chartReference: { ...result.durableExtraction, calculationMethod: next }, chartProjection: result },
      }).catch(() => {});
      try {
        writeCustomerOwnershipChartSession({ context, result, calculationMethod: next });
        saveCustomerOwnershipChartExtraction({ context, result, calculationMethod: next });
        setSavedExtractions(customerOwnershipChartExtractionsForContext(context));
      } catch (_) { /* Existing extraction remains usable. */ }
    }
  };

  return <div className="ubo-customer-page">
    <CustomerJourneyHeader currentStep={2} ownershipAnalysisVisible={analysisVisible} onViewOwnershipAnalysis={result ? () => setAnalysisVisible(true) : undefined} />
    <main className="ubo-customer-main">
      <CompanyContext context={context} />
      <ExistingResearchAssertions researchResult={context.researchResult} />
      <div className="ubo-customer-intro"><span>Step 2 · Ownership</span><h1>Help us understand your ownership structure</h1><p>Upload one ownership chart. We’ll read the relationships stated in it and check whether it contains certification details.</p></div>
      {result ? <Results result={result} researchResult={context.researchResult} calculationMethod={calculationMethod} onCalculationMethod={changeCalculationMethod} onReplace={replace} persistenceNotice={persistenceNotice} preview={preview} analysisVisible={analysisVisible} /> : <><SavedExtractionsPanel records={savedExtractions} onUse={useSaved} /><UploadPanel file={file} error={error} busy={busy} progress={readingProgress} startedAt={readingStartedAt} retryAvailable={Boolean(failedJob)} onChoose={choose} onAnalyse={analyse} onRemove={remove} /></>}
    </main>
    <footer className="ubo-customer-footer">Demo experience · Evidence Artifact and extraction saved durably · Read-only source comparison</footer>
  </div>;
}

export { MAX_BYTES, analysisFailureMessage, validateFile };
