import React, { useCallback, useEffect, useRef, useState } from "react";
import { COUNTRIES } from "../constants/appConstants";
import {
  clearDemoSession, createDemoCase, emptyDemoDraft, OWNERSHIP_TYPES, ownershipLabelFor,
  readDemoSession, readLabReplays, saveLabReplay, validateDemoDraft, writeDemoSession,
} from "./demoSession";
import {
  allCandidateFacts, assertionSourceState, compactResearchResult, demoOpenQuestions, formatMeasurement,
  internalReviewCount, relationshipCategory, runDemoResearch,
} from "./demoResearch";
import { DEMO_RESEARCH_PATH, DEMO_START_PATH, isDemoResearchPath, navigateDemo } from "./demoRoute";
import "./uboDemo.css";

function DemoHeader({ onStartNew }) {
  return <header className="ubo-demo-header"><a className="ubo-demo-brand" href={DEMO_START_PATH}><span className="ubo-demo-mark">N</span><span>Ownership review</span></a><button className="ubo-demo-link-button" type="button" onClick={onStartNew}>Start new case</button></header>;
}

function DemoProgress({ research }) {
  return <ol className="ubo-demo-progress" aria-label="Demo journey progress"><li className={research ? "complete" : "current"}><span>1</span>Company</li><li className={research ? "current" : ""}><span>2</span>Research</li><li><span>3</span>Ownership</li><li><span>4</span>Review</li></ol>;
}

function FieldError({ id, children }) { return <p className="ubo-demo-error" id={id} role="alert">{children}</p>; }

function CompanyStart({ draft, errors, replays, onChange, onSubmit }) {
  return <main className="ubo-demo-main">
    <div className="ubo-demo-intro"><span className="ubo-demo-eyebrow">Ownership review</span><h1>Let&rsquo;s research your company</h1><p>Tell us which company you&rsquo;re reviewing. We&rsquo;ll use these details to start its ownership journey.</p></div>
    <form className="ubo-demo-card" onSubmit={onSubmit} noValidate>
      <div className="ubo-demo-card-heading"><span>Company details</span><small>Fields marked * are required</small></div>
      <div className="ubo-demo-fields">
        <label className="ubo-demo-field ubo-demo-wide"><span>Company name *</span><input autoComplete="organization" aria-invalid={Boolean(errors.legalName)} value={draft.legalName} onChange={(e) => onChange("legalName", e.target.value)} placeholder="Enter the registered company name" />{errors.legalName && <FieldError id="legal-name-error">{errors.legalName}</FieldError>}</label>
        <label className="ubo-demo-field"><span>Registration number *</span><input autoComplete="off" inputMode="text" aria-invalid={Boolean(errors.registrationNumber)} value={draft.registrationNumber} onChange={(e) => onChange("registrationNumber", e.target.value)} placeholder="For example, 00445790" /><small>Letters and leading zeros are preserved.</small>{errors.registrationNumber && <FieldError id="registration-error">{errors.registrationNumber}</FieldError>}</label>
        <label className="ubo-demo-field"><span>Country of registration *</span><select value={draft.countryCode} onChange={(e) => onChange("countryCode", e.target.value)}>{COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select></label>
        <label className="ubo-demo-field"><span>Ownership type *</span><select value={draft.ownershipType} onChange={(e) => onChange("ownershipType", e.target.value)}>{OWNERSHIP_TYPES.map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}</select><small>Context only; it does not change policy.</small></label>
        <label className="ubo-demo-field"><span>Case ID / reference <em>Optional</em></span><input autoComplete="off" value={draft.referenceCaseId} onChange={(e) => onChange("referenceCaseId", e.target.value)} placeholder="Your internal reference" /></label>
        <fieldset className="ubo-demo-source ubo-demo-wide"><legend>Demo source</legend>
          <label><input type="radio" name="sourceMode" value="LIVE" checked={draft.sourceMode === "LIVE"} onChange={(e) => onChange("sourceMode", e.target.value)} /> Live Lab research</label>
          <label><input type="radio" name="sourceMode" value="FIXTURE" checked={draft.sourceMode === "FIXTURE"} onChange={(e) => onChange("sourceMode", e.target.value)} /> Reviewed ASDA fixture <small>no provider call</small></label>
          <label><input type="radio" name="sourceMode" value="REPLAY" disabled={!replays.length} checked={draft.sourceMode === "REPLAY"} onChange={(e) => onChange("sourceMode", e.target.value)} /> Saved live replay <small>no provider call</small></label>
          {draft.sourceMode === "REPLAY" && <select aria-label="Saved research result" value={draft.replayId} onChange={(e) => onChange("replayId", e.target.value)}><option value="">Choose saved research</option>{replays.map((r) => <option key={r.replayId} value={r.replayId}>{r.companyContext?.legalEntityName || r.replayId}</option>)}</select>}
        </fieldset>
      </div>
      <div className="ubo-demo-actions"><p>Saved in this browser for this demo only.</p><button className="ubo-demo-primary" type="submit">Start research <span>→</span></button></div>
    </form>
  </main>;
}

function ResearchProgress({ company }) {
  return <main className="ubo-demo-main"><section className="ubo-demo-research-card" aria-live="polite"><div className="ubo-demo-spinner" /><span className="ubo-demo-eyebrow">Research in progress</span><h1>Researching {company.legalName}</h1><ul className="ubo-demo-stage-list"><li>Researching company records</li><li>Following ownership and control relationships</li><li>Building ownership structure</li><li>Checking what is still unresolved</li></ul><p>These labels describe the operation in progress; they do not claim a stage has completed.</p></section></main>;
}

function GraphFrame({ projection, entityLabels, registryContexts }) {
  const frame = useRef(null);
  const send = useCallback(() => frame.current?.contentWindow?.postMessage({
    type: "ubo-demo-graph-projection-v1",
    projection,
    entityLabels,
    registryContexts,
    viewportHeight: Math.max(600, Math.min(820, Math.round(window.innerHeight * 0.68))),
  }, window.location.origin), [projection, entityLabels, registryContexts]);
  useEffect(() => {
    send();
    window.addEventListener("resize", send);
    return () => window.removeEventListener("resize", send);
  }, [send]);
  return <iframe ref={frame} onLoad={send} className="ubo-demo-graph-frame" title="Ownership structure" src="/ubo-demo-graph.html" />;
}

function Assertions({ result }) {
  const rows = allCandidateFacts(result);
  return <details className="ubo-demo-assertions"><summary><strong>Research assertions and source facts</strong><span>{rows.length} assertions · click to inspect</span></summary><div className="ubo-demo-assertion-list">{rows.map(({ fact, source }, index) => fact.type === "ENTITY_ATTRIBUTE" ? <article key={fact.factId || index}><span className="ubo-demo-kind">Registry context</span><p><strong>{fact.subject?.name || "Registry entity"}</strong></p><p>{Object.entries(fact.value || {}).filter(([, value]) => value).map(([key, value]) => `${key.replaceAll(/([A-Z])/g, " $1")}: ${value}`).join(" · ")}</p><small>{assertionSourceState(result, source)} · {fact.evidenceReferences?.[0]?.referenceId || source.requestId || "Reference retained"} · Candidate/source assertion</small></article> : <article key={fact.factId || index}><span className="ubo-demo-kind">{relationshipCategory(fact.relationship)}</span><p><strong>{fact.subject?.name || "Source party"}</strong> → <strong>{fact.object?.name || "Target party"}</strong></p><p>{String(fact.relationship || fact.type || "Source assertion").replaceAll("_", " ")} · {formatMeasurement(fact.measurement)}</p><small>{fact.qualifiers?.currentState || "Currentness not supplied"} · {assertionSourceState(result, source)} · {fact.evidenceReferences?.[0]?.referenceId || source.requestId || "Reference retained"} · Candidate/source assertion</small></article>)}</div></details>;
}

function OpenQuestions({ view }) {
  const questions = demoOpenQuestions(view);
  const reviewCount = internalReviewCount(view);
  return <aside className="ubo-demo-questions"><span className="ubo-demo-eyebrow">Your next step</span><h2>Open questions</h2>{questions.length ? questions.map((question) => <section key={`${question.kind}:${question.informationNeedIds.join(":")}`} data-information-need-ids={question.informationNeedIds.join(",")}><span className="ubo-demo-question-kind">{question.kind === "EVIDENCE_REQUEST" ? "Evidence request" : "Question"}</span><h3>{question.title}</h3><p>{question.body}</p>{question.state === "DEFERRED_SYSTEM_FIRST" && <small>Shown for transparency. Current system research runs first.</small>}{!question.contentApproved && <small>Demo wording only · production customer copy is not approved.</small>}</section>) : <div className="ubo-demo-no-questions"><strong>Nothing needed from you right now.</strong><p>We are still reviewing parts of the ownership structure.</p></div>}{reviewCount > 0 && <p className="ubo-demo-internal">Internal review is still in progress ({reviewCount}). This is not a customer question.</p>}</aside>;
}

function ResearchResult({ demoCase, result, onEdit, onRetry }) {
  const view = result.view;
  const pending = (result.decisionTargets?.candidateParties?.length || 0) + (result.decisionTargets?.candidateClaims?.length || 0);
  return <main className="ubo-demo-results">
    <header className="ubo-demo-result-heading"><div><span className="ubo-demo-eyebrow">Ownership research</span><h1>{demoCase.company.legalName}</h1><p>{demoCase.company.registrationNumber} · {demoCase.company.countryName} · {result.canonicalCompanyTypeLabel || ownershipLabelFor(demoCase.company.ownershipType)}</p></div><span className={`ubo-demo-source-badge ${result.sourceMode.toLowerCase()}`}>{result.sourceMode === "FIXTURE" ? "Reviewed fixture · not this company’s live result" : result.sourceMode === "REPLAY" ? "Saved live replay" : "LIVE RESEARCH — PROVISIONAL DEMO RESULT"}</span></header>
    {view ? <div className="ubo-demo-workspace"><section className="ubo-demo-graph-card"><div className="ubo-demo-section-heading"><div><span className="ubo-demo-eyebrow">Established structure</span><h2>Ownership structure</h2></div><span>Ownership · Voting · Control</span></div><GraphFrame projection={view.graph} entityLabels={result.entityLabels} registryContexts={result.registryContexts} /><Assertions result={result} /></section><OpenQuestions view={view} /></div> : <><section className="ubo-demo-review-wait"><span className="ubo-demo-eyebrow">Research complete</span><h2>Explicit review is required before an ownership graph can be established</h2><p>{pending} candidate identity or claim decision{pending === 1 ? "" : "s"} remain. Live source assertions are not automatically adjudicated, and no UBO conclusion has been inferred.</p></section><div className="ubo-demo-workspace"><section className="ubo-demo-graph-card"><div className="ubo-demo-graph-empty"><h2>Ownership structure pending review</h2><p>The canonical graph will appear only after the existing Decision Application review boundary produces a snapshot.</p></div><Assertions result={result} /></section><OpenQuestions view={null} /></div></>}
    <div className="ubo-demo-bottom-actions"><button className="ubo-demo-secondary" onClick={onEdit}>Edit company details</button><button className="ubo-demo-secondary" onClick={onRetry}>Run again</button></div>
  </main>;
}

function ResearchError({ error, replays, onRetry, onReplay, onEdit }) {
  return <main className="ubo-demo-main"><section className="ubo-demo-research-card ubo-demo-failure"><span className="ubo-demo-eyebrow">Research unavailable</span><h1>We could not complete this research</h1><p>{error}</p><div className="ubo-demo-error-actions"><button className="ubo-demo-primary" onClick={onRetry}>Try live research again</button>{replays.length > 0 && <button className="ubo-demo-secondary" onClick={onReplay}>Use the latest saved replay</button>}<button className="ubo-demo-secondary" onClick={onEdit}>Edit company details</button></div></section></main>;
}

export default function UboDemoRoot() {
  const restored = readDemoSession();
  const [draft, setDraft] = useState(() => restored?.draft || emptyDemoDraft());
  const [demoCase, setDemoCase] = useState(() => restored?.demoCase || null);
  const [researchResult, setResearchResult] = useState(() => restored?.researchResult || null);
  const [errors, setErrors] = useState({});
  const [pathname, setPathname] = useState(() => window.location.pathname);
  const [runToken, setRunToken] = useState(0);
  const [researchError, setResearchError] = useState("");
  const replays = readLabReplays();
  const skipNextSave = useRef(false);

  useEffect(() => { const onPop = () => setPathname(window.location.pathname); window.addEventListener("popstate", onPop); return () => window.removeEventListener("popstate", onPop); }, []);
  useEffect(() => { if (skipNextSave.current) { skipNextSave.current = false; return; } writeDemoSession({ draft, demoCase, researchResult }); }, [draft, demoCase, researchResult]);
  useEffect(() => {
    if (!isDemoResearchPath(pathname) || !demoCase || researchResult?.status !== "LOADING") return undefined;
    let active = true;
    const replayRecord = replays.find((record) => record.replayId === draft.replayId) || replays[0];
    runDemoResearch({ demoCase, sourceMode: draft.sourceMode, replayRecord }).then((session) => {
      if (!active) return;
      if (session.replayCapture) saveLabReplay(session.replayCapture);
      setResearchResult(compactResearchResult(session, draft.sourceMode));
    }).catch((cause) => { if (active) { setResearchError(`${cause.code ? `${cause.code}: ` : ""}${cause.message}`); setResearchResult(null); } });
    return () => { active = false; };
  }, [pathname, demoCase, researchResult?.status, runToken]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateDraft = (field, value) => { setDraft((d) => ({ ...d, [field]: value })); setErrors((e) => ({ ...e, [field]: undefined })); };
  const startResearch = (event) => { event.preventDefault(); const next = validateDemoDraft(draft); if (draft.sourceMode === "REPLAY" && !draft.replayId && !replays.length) next.replayId = "Choose a saved research result."; setErrors(next); if (Object.keys(next).length) return; const nextCase = createDemoCase(draft); setDemoCase(nextCase); setResearchError(""); setResearchResult({ status: "LOADING", sourceMode: draft.sourceMode }); navigateDemo(DEMO_RESEARCH_PATH); };
  const runAgain = (mode = draft.sourceMode) => { setDraft((d) => ({ ...d, sourceMode: mode, replayId: mode === "REPLAY" ? (d.replayId || readLabReplays()[0]?.replayId || "") : d.replayId })); setResearchError(""); setResearchResult({ status: "LOADING", sourceMode: mode }); setRunToken((n) => n + 1); };
  const startNewCase = () => { skipNextSave.current = true; clearDemoSession(); setDraft(emptyDemoDraft()); setDemoCase(null); setResearchResult(null); setErrors({}); navigateDemo(DEMO_START_PATH, { replace: true }); };
  const edit = () => navigateDemo(DEMO_START_PATH);
  const research = isDemoResearchPath(pathname);

  let content;
  if (!research) content = <CompanyStart draft={draft} errors={errors} replays={replays} onChange={updateDraft} onSubmit={startResearch} />;
  else if (!demoCase) content = <main className="ubo-demo-main ubo-demo-empty"><h1>Start with company details</h1><button className="ubo-demo-primary" onClick={edit}>Enter company details</button></main>;
  else if (researchResult?.status === "LOADING") content = <ResearchProgress company={demoCase.company} />;
  else if (researchError) content = <ResearchError error={researchError} replays={replays} onRetry={() => runAgain("LIVE")} onReplay={() => runAgain("REPLAY")} onEdit={edit} />;
  else if (researchResult) content = <ResearchResult demoCase={demoCase} result={researchResult} onEdit={edit} onRetry={() => runAgain()} />;
  else content = <ResearchProgress company={demoCase.company} />;
  return <div className="ubo-demo-page"><DemoHeader onStartNew={startNewCase} /><DemoProgress research={research} />{content}<footer className="ubo-demo-footer">Demo experience · Browser-local session · UK Corporate 1.6-RC review path</footer></div>;
}
