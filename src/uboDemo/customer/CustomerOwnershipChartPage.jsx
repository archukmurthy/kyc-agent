import React, { useMemo, useRef, useState } from "react";
import { ownershipLabelFor } from "../demoSession";
import { allCandidateFacts } from "../demoResearch";
import {
  clearCustomerOwnershipChartSession,
  readCustomerDemoContext,
  readCustomerOwnershipChartSession,
  writeCustomerOwnershipChartSession,
} from "./customerOwnershipChartSession";
import CustomerJourneyHeader from "./CustomerJourneyHeader";
import CustomerOwnershipGraph from "./CustomerOwnershipGraph";
import "./customerOwnershipChart.css";

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

function AssertionsCard({ assertions }) {
  return <details className="ubo-customer-card ubo-customer-assertions" open>
    <summary><div><small>Evidence → UBO handoff</small><strong>Assertions extracted from your ownership chart</strong></div><span>{assertions.length} assertion{assertions.length === 1 ? "" : "s"}</span></summary>
    <div>{assertions.map((assertion, index) => <article key={assertion.factId || index}><span>{assertion.category}</span><p>{assertion.statement}</p><small>{assertion.supportStateLabel} · Candidate assertion · no registry comparison performed</small></article>)}</div>
  </details>;
}

function ExistingResearchAssertions({ researchResult }) {
  const rows = allCandidateFacts(researchResult);
  if (!rows.length) return null;
  return <details className="ubo-customer-card ubo-customer-assertions">
    <summary><div><small>Existing case research</small><strong>Registry assertions already available</strong></div><span>{rows.length} assertion{rows.length === 1 ? "" : "s"}</span></summary>
    <div>{rows.map(({ fact, source }, index) => {
      const attribute = fact.type === "ENTITY_ATTRIBUTE";
      const relationship = String(fact.relationship || fact.type || "Source assertion").replaceAll("_", " ").toLowerCase();
      const statement = attribute
        ? `${fact.subject?.name || "Registry entity"} · ${Object.entries(fact.value || {}).filter(([, value]) => value).map(([key, value]) => `${key.replaceAll(/([A-Z])/g, " $1")}: ${value}`).join(" · ")}`
        : `${fact.subject?.name || "Source party"} → ${relationship}${fact.measurement ? ` (${relationshipValue(fact)})` : ""} → ${fact.object?.name || "Target party"}`;
      return <article key={fact.factId || index}><span>{attribute ? "Registry context" : relationship}</span><p>{statement}</p><small>{fact.evidenceReferences?.[0]?.referenceId || source.requestId || "Source reference retained"} · Candidate/source assertion</small></article>;
    })}</div>
  </details>;
}

function Results({ result, onReplace }) {
  return <div className="ubo-customer-results">
    <section className="ubo-customer-received"><span aria-hidden="true">✓</span><div><small>Ownership chart received</small><strong>{result.artifact.originalFilename}</strong><p>{Math.ceil(result.artifact.sizeBytes / 1024)} KB · integrity checked · Evidence analysis complete</p></div><button type="button" onClick={onReplace}>Replace chart</button></section>
    <CertificationCard certification={result.certification} />
    <CustomerOwnershipGraph projection={result.sourceGraph} />
    <OwnersCard owners={result.owners || []} />
    <AssertionsCard assertions={result.assertions || []} />
    <div className="ubo-customer-stop"><strong>This page stops after chart analysis.</strong><p>Registry comparison, open-question resolution and UBO determination are deliberately not performed in this increment.</p></div>
  </div>;
}

export default function CustomerOwnershipChartPage() {
  const context = useMemo(() => readCustomerDemoContext(), []);
  const restored = useMemo(() => readCustomerOwnershipChartSession(), []);
  const [file, setFile] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(restored && restored.context?.demoCaseId === context?.demoCaseId ? restored.result : null);

  if (!context) return <div className="ubo-customer-page"><CustomerJourneyHeader currentStep={2} /><main className="ubo-customer-empty"><span>Customer ownership step</span><h1>Start with a demo company</h1><p>This direct route needs seeded demo-session company and case context.</p><a href="/ubo-demo/">Enter company details</a></main></div>;

  const choose = (next) => { setFile(next); setError(validateFile(next)); };
  const remove = () => { setFile(null); setError(""); };
  const replace = () => { clearCustomerOwnershipChartSession(); setResult(null); remove(); };
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
      writeCustomerOwnershipChartSession({ context, result: payload.result });
      setResult(payload.result);
    } catch (caught) {
      setError(caught.message || "We could not analyse this ownership chart.");
    } finally { setBusy(false); }
  };

  return <div className="ubo-customer-page">
    <CustomerJourneyHeader currentStep={2} />
    <main className="ubo-customer-main">
      <CompanyContext context={context} />
      <ExistingResearchAssertions researchResult={context.researchResult} />
      <div className="ubo-customer-intro"><span>Step 2 · Ownership</span><h1>Help us understand your ownership structure</h1><p>Upload one ownership chart. We’ll read the relationships stated in it and check whether it contains certification details.</p></div>
      {result ? <Results result={result} onReplace={replace} /> : <UploadPanel file={file} error={error} busy={busy} onChoose={choose} onAnalyse={analyse} onRemove={remove} />}
    </main>
    <footer className="ubo-customer-footer">Demo experience · Browser-local result · No registry comparison</footer>
  </div>;
}

export { MAX_BYTES, analysisFailureMessage, validateFile };
