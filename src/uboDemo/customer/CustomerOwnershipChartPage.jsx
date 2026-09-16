import React, { useEffect, useMemo, useRef, useState } from "react";
import { ownershipLabelFor } from "../demoSession";
import { allCandidateFacts } from "../demoResearch";
import AssertionDetails from "../AssertionDetails";
import {
  clearCustomerOwnershipChartSession,
  chartSourceCoverage,
  customerOwnershipChartExtractionsForContext,
  customerOwnershipChartSessionForContext,
  readCustomerDemoContext,
  saveCustomerOwnershipChartExtraction,
  writeCustomerOwnershipChartSession,
} from "./customerOwnershipChartSession";
import CustomerJourneyHeader from "./CustomerJourneyHeader";
import AnalystCustomerRequests from "./AnalystCustomerRequests";
import ChartAnalysisPanel from "./ChartAnalysisPanel";
import ChartResearchComparison from "./ChartResearchComparison";
import "./customerOwnershipChart.css";

const CHART_CALCULATION_SEMANTICS_VERSION = "ubo-demo-chart-calculation-v2";

const ACCEPTED_TYPES = new Set(["application/pdf", "image/png", "image/jpeg"]);
const MAX_BYTES = 3 * 1024 * 1024;

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
  const code = String(payload?.code || "customer_ownership_chart_failed");
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
  const message = messages[code] || payload?.message || "We could not analyse this ownership chart.";
  return `${message} Reference: ${code}${status ? ` (${status})` : ""}.`;
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

function UploadPanel({ file, error, busy, onChoose, onAnalyse, onRemove }) {
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
    <div className="ubo-customer-upload-actions"><small>Your file is used only for this demo analysis.</small><button type="button" className="ubo-customer-primary" onClick={onAnalyse} disabled={busy}>{busy ? "Analysing chart…" : "Upload and analyse"}<span>→</span></button></div>
  </section>;
}

function SavedExtractionsPanel({ records, onUse }) {
  if (!records.length) return null;
  return <section className="ubo-customer-card ubo-customer-saved-extractions">
    <div><small>Saved document extracts</small><h2>Reuse an earlier chart analysis</h2><p>These structured results are stored in this browser for the same company. The original document bytes are not retained.</p></div>
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
  return <section className="ubo-customer-card ubo-customer-result-card">
    <header><div><small>Certification assessment</small><h2>{found ? "Certification found" : "No certification found"}</h2></div><span className={found ? "ubo-customer-status found" : "ubo-customer-status neutral"}>{found ? "Found in chart" : "Regular chart"}</span></header>
    {found ? <>
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
    </> : <p className="ubo-customer-muted">That’s okay. We extracted the chart as provided. Additional evidence or questions may be needed in a later step.</p>}
  </section>;
}

function OwnersCard({ owners }) {
  return <section className="ubo-customer-card ubo-customer-result-card">
    <header><div><small>What we found in your chart</small><h2>{owners.length ? `${owners.length} owner${owners.length === 1 ? "" : "s"} identified` : "No owners confidently identified"}</h2></div><span className="ubo-customer-status found">Source-backed facts</span></header>
    {owners.length ? <div className="ubo-customer-owner-grid">{owners.map((owner, index) => <article key={`${owner.name}-${index}`}><span>{owner.partyType === "NATURAL_PERSON" ? "Person" : "Company"}</span><h3>{owner.name}</h3><p>{owner.relationshipLabel}</p><strong>{relationshipValue(owner)}</strong><small>Candidate fact · not a UBO conclusion</small></article>)}</div> : <p className="ubo-customer-muted">The document remains available as evidence, but no source-supported directed ownership relationship was extracted.</p>}
  </section>;
}

function ExistingResearchAssertions({ researchResult }) {
  const rows = allCandidateFacts(researchResult);
  if (!rows.length) return null;
  return <AssertionDetails entries={rows} eyebrow="Existing case research" title="Registry assertions already available" sourceNotice="These saved research assertions remain a separate source dataset." variant="analyst" />;
}

function ChartAssertions({ result }) {
  if (result.candidateFacts?.length) return <AssertionDetails entries={result.candidateFacts.map((fact) => ({ fact: { ...fact, issues: (result.assertions || []).find((item) => item.factId === fact.factId)?.issues || [] }, source: { sourceLabel: "Customer-uploaded Evidence Artifact", artifactId: result.artifact?.artifactId } }))} eyebrow="Evidence → UBO handoff" title="Assertions extracted from your ownership chart" sourceNotice="Candidate information is shown in full. It is not analyst-approved or independently verified." variant="customer" />;
  return <details className="ubo-customer-card ubo-customer-assertions"><summary><div><small>Legacy browser cache</small><strong>Assertions extracted from your ownership chart</strong></div><span>{result.assertions?.length || 0} reduced assertions</span></summary><p className="ubo-customer-source-notice">This earlier cached result retained only reduced display text. Full CandidateFact detail and engine inputs are unavailable in this cache and have not been invented.</p><div>{(result.assertions || []).map((assertion, index) => <article key={assertion.factId || index}><span>{assertion.category}</span><p>{assertion.statement}</p><small>{assertion.supportStateLabel} · Candidate assertion · legacy detail unavailable</small></article>)}</div></details>;
}

function Results({ result, researchResult, calculationMethod, onCalculationMethod, onReplace, persistenceNotice }) {
  const coverage = chartSourceCoverage(result);
  return <div className="ubo-customer-results">
    <section className="ubo-customer-received"><span aria-hidden="true">✓</span><div><small>Ownership chart received</small><strong>{result.artifact.originalFilename}</strong><p>{Math.ceil(result.artifact.sizeBytes / 1024)} KB · integrity checked · Evidence analysis complete</p></div><button type="button" onClick={onReplace}>Replace chart</button></section>
    {persistenceNotice && <p role="status" className={`ubo-customer-extraction-save ${persistenceNotice.kind}`}>{persistenceNotice.message}</p>}
    {coverage.state === "REVIEW_REQUIRED" && <p className="ubo-customer-extraction-save warning" role="alert"><strong>Incomplete ownership map.</strong> The extracted relationship chain does not reach {result.company?.legalName || "the customer under review"}. The visible source facts are retained, but this result must not be treated as the complete chart.</p>}
    <CertificationCard certification={result.certification} />
    <ChartAnalysisPanel analysis={result.chartAnalysis} sourceProjection={result.sourceGraph} legacyProjection={result.chartAnalysis ? null : result.sourceGraph} method={calculationMethod} onMethodChange={onCalculationMethod} />
    <OwnersCard owners={result.owners || []} />
    <ChartAssertions result={result} />
    <ChartResearchComparison researchResult={researchResult} chartFacts={result.candidateFacts || []} company={result.company} />
    <div className="ubo-customer-stop"><strong>Chart analysis remains provisional.</strong><p>The uploaded chart and saved research remain distinct sources. This comparison does not merge, overwrite or approve either dataset.</p></div>
  </div>;
}

export default function CustomerOwnershipChartPage() {
  const context = useMemo(() => readCustomerDemoContext(), []);
  const restored = useMemo(() => customerOwnershipChartSessionForContext(context), [context]);
  const availableExtractions = useMemo(() => customerOwnershipChartExtractionsForContext(context), [context]);
  const [file, setFile] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(restored && restored.context?.demoCaseId === context?.demoCaseId ? restored.result : null);
  const [calculationMethod, setCalculationMethod] = useState(restored?.calculationMethod || context?.researchResult?.analysisContext?.calculationMethod || "EFFECTIVE_INTEREST");
  const [savedExtractions, setSavedExtractions] = useState(availableExtractions);
  const [persistenceNotice, setPersistenceNotice] = useState(result ? { kind: "success", message: "This structured extraction is restored from browser-local demo storage. No provider call was made." } : null);
  const reevaluationAttempts = useRef(new Set());

  useEffect(() => {
    const artifactId = result?.artifact?.artifactId;
    const hasStructuredFacts = Array.isArray(result?.candidateFacts) && result.candidateFacts.length > 0;
    const hasCalculationRecords = (result?.chartAnalysis?.view?.qualificationBases || []).length > 0
      && (result?.chartAnalysis?.view?.qualifications || []).length > 0;
    const hasCurrentCalculationSemantics = result?.chartAnalysis?.calculationSemanticsVersion === CHART_CALCULATION_SEMANTICS_VERSION;
    if (!artifactId || !hasStructuredFacts || (hasCalculationRecords && hasCurrentCalculationSemantics) || reevaluationAttempts.current.has(artifactId)) return;
    reevaluationAttempts.current.add(artifactId);
    let active = true;
    (async () => {
      try {
        const response = await fetch("/api/ubo-demo-customer-ownership-chart", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            operation: "REEVALUATE_SAVED_EXTRACTION",
            demoContext: { company: context.company, referenceCaseId: context.referenceCaseId, demoCaseId: context.demoCaseId },
            savedResult: result,
          }),
        });
        const payload = await response.json();
        if (!response.ok || !payload.success) throw new Error(analysisFailureMessage(payload, response.status));
        if (!active) return;
        setResult(payload.result);
        writeCustomerOwnershipChartSession({ context, result: payload.result, calculationMethod });
        saveCustomerOwnershipChartExtraction({ context, result: payload.result, calculationMethod });
        setSavedExtractions(customerOwnershipChartExtractionsForContext(context));
        setPersistenceNotice({ kind: "success", message: "Saved chart facts were re-evaluated through the current UBO engine. No provider call was made." });
      } catch (caught) {
        if (active) setPersistenceNotice({ kind: "warning", message: `The saved chart remains available, but its calculation could not be refreshed: ${caught.message}` });
      }
    })();
    return () => { active = false; };
  }, [calculationMethod, context, result]);

  if (!context) return <div className="ubo-customer-page"><CustomerJourneyHeader currentStep={2} /><main className="ubo-customer-empty"><span>Customer ownership step</span><h1>Start with a demo company</h1><p>This direct route needs seeded demo-session company and case context.</p><a href="/ubo-demo/customer/">Enter company details</a></main></div>;

  const choose = (next) => { setFile(next); setError(validateFile(next)); };
  const remove = () => { setFile(null); setError(""); };
  const replace = () => { clearCustomerOwnershipChartSession(); setResult(null); setPersistenceNotice(null); remove(); };
  const useSaved = (record) => {
    setResult(record.result);
    setCalculationMethod(record.calculationMethod || "EFFECTIVE_INTEREST");
    setPersistenceNotice({ kind: "success", message: "Saved extraction loaded from this browser. No provider call was made." });
    try { writeCustomerOwnershipChartSession({ context, result: record.result, calculationMethod: record.calculationMethod }); }
    catch (_) { setPersistenceNotice({ kind: "warning", message: "Saved extraction loaded without a provider call, but the active browser session could not be updated." }); }
  };
  const analyse = async () => {
    const nextError = validateFile(file);
    if (nextError) { setError(nextError); return; }
    setBusy(true); setError("");
    try {
      const contentBase64 = await fileAsBase64(file);
      const response = await fetch("/api/ubo-demo-customer-ownership-chart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          demoContext: {
            company: context.company,
            referenceCaseId: context.referenceCaseId,
            demoCaseId: context.demoCaseId,
          },
          file: { originalFilename: file.name, declaredMediaType: file.type, sizeBytes: file.size, contentBase64 },
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(analysisFailureMessage(payload, response.status));
      setResult(payload.result);
      try {
        writeCustomerOwnershipChartSession({ context, result: payload.result });
        saveCustomerOwnershipChartExtraction({ context, result: payload.result });
        setSavedExtractions(customerOwnershipChartExtractionsForContext(context));
        setPersistenceNotice({ kind: "success", message: "Extraction saved in this browser for future no-cost replay. Document bytes were not retained." });
      } catch (saveError) {
        setPersistenceNotice({ kind: "warning", message: `Analysis completed, but the browser could not save this extraction: ${saveError.message || "local storage unavailable"}` });
      }
    } catch (caught) {
      setError(caught.message || "We could not analyse this ownership chart.");
    } finally { setBusy(false); }
  };
  const changeCalculationMethod = (next) => {
    setCalculationMethod(next);
    if (result) {
      try {
        writeCustomerOwnershipChartSession({ context, result, calculationMethod: next });
        saveCustomerOwnershipChartExtraction({ context, result, calculationMethod: next });
        setSavedExtractions(customerOwnershipChartExtractionsForContext(context));
      } catch (_) { /* Existing extraction remains usable. */ }
    }
  };

  return <div className="ubo-customer-page">
    <CustomerJourneyHeader currentStep={2} />
    <main className="ubo-customer-main">
      <CompanyContext context={context} />
      <AnalystCustomerRequests requests={context.researchResult?.analystCustomerRequests || []} />
      <ExistingResearchAssertions researchResult={context.researchResult} />
      <div className="ubo-customer-intro"><span>Step 2 · Ownership</span><h1>Help us understand your ownership structure</h1><p>Upload one ownership chart. We’ll read the relationships stated in it and check whether it contains certification details.</p></div>
      {result ? <Results result={result} researchResult={context.researchResult} calculationMethod={calculationMethod} onCalculationMethod={changeCalculationMethod} onReplace={replace} persistenceNotice={persistenceNotice} /> : <><SavedExtractionsPanel records={savedExtractions} onUse={useSaved} /><UploadPanel file={file} error={error} busy={busy} onChoose={choose} onAnalyse={analyse} onRemove={remove} /></>}
    </main>
    <footer className="ubo-customer-footer">Demo experience · Browser-local result · Read-only source comparison</footer>
  </div>;
}

export { MAX_BYTES, analysisFailureMessage, validateFile };
