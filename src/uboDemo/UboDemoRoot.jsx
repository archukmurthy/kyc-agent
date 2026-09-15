import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { COUNTRIES } from "../constants/appConstants";
import {
  CALCULATION_METHODS, clearDemoSession, createDemoCase, emptyDemoDraft, OWNERSHIP_TYPES, ownershipLabelFor,
  readDemoSession, readLabReplays, saveLabReplay, validateDemoDraft, writeDemoSession,
} from "./demoSession";
import {
  accountOpenItems, allCandidateFacts, assertionSourceState, compactResearchResult, DEMO_CALCULATION_FIXTURES, demoCalculationPeople, demoOpenQuestions, demoReviewPresentations,
  DEMO_GRAPH_DIMENSIONS, DEMO_GRAPH_SCOPES, executableCustomerBundles, formatMeasurement,
  demoSourceRelevantEntityIds, projectDemoGraph, relationshipAssertionPresentation, runDemoResearch,
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

function CalculationMethodSelector({ value, onChange, compact = false }) {
  return <fieldset className={`ubo-demo-method ${compact ? "compact" : "ubo-demo-wide"}`}><legend>Calculation method</legend><p>Choose which calculation or control assessment to inspect.</p><div>{CALCULATION_METHODS.map((method) => <label key={method.code}><input type="radio" name={compact ? "resultCalculationMethod" : "calculationMethod"} value={method.code} checked={value === method.code} onChange={() => onChange(method.code)} /><span><strong>{method.label}</strong><small>{method.explanation}</small></span></label>)}</div></fieldset>;
}

function CompanyStart({ draft, errors, replays, onChange, onSubmit, onLoadExample }) {
  return <main className="ubo-demo-main">
    <div className="ubo-demo-intro"><span className="ubo-demo-eyebrow">Ownership review</span><h1>Let&rsquo;s research your company</h1><p>Tell us which company you&rsquo;re reviewing. We&rsquo;ll use these details to start its ownership journey.</p></div>
    <form className="ubo-demo-card" onSubmit={onSubmit} noValidate>
      <div className="ubo-demo-card-heading"><span>Company details</span><small>Fields marked * are required</small></div>
      <div className="ubo-demo-fields">
        <label className="ubo-demo-field ubo-demo-wide"><span>Company name *</span><input autoComplete="organization" aria-invalid={Boolean(errors.legalName)} value={draft.legalName} onChange={(e) => onChange("legalName", e.target.value)} placeholder="Enter the registered company name" />{errors.legalName && <FieldError id="legal-name-error">{errors.legalName}</FieldError>}</label>
        <label className="ubo-demo-field"><span>Registration number *</span><input autoComplete="off" inputMode="text" aria-invalid={Boolean(errors.registrationNumber)} value={draft.registrationNumber} onChange={(e) => onChange("registrationNumber", e.target.value)} placeholder="For example, 00445790" /><small>Letters and leading zeros are preserved.</small>{errors.registrationNumber && <FieldError id="registration-error">{errors.registrationNumber}</FieldError>}</label>
        <label className="ubo-demo-field"><span>Country of registration *</span><select value={draft.countryCode} onChange={(e) => onChange("countryCode", e.target.value)}>{COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select></label>
        <label className="ubo-demo-field"><span>Ownership type *</span><select value={draft.ownershipType} onChange={(e) => onChange("ownershipType", e.target.value)}>{OWNERSHIP_TYPES.map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}</select><small>Context only; it does not change policy.</small></label>
        <CalculationMethodSelector value={draft.calculationMethod} onChange={(value) => onChange("calculationMethod", value)} />
        <label className="ubo-demo-field"><span>Case ID / reference <em>Optional</em></span><input autoComplete="off" value={draft.referenceCaseId} onChange={(e) => onChange("referenceCaseId", e.target.value)} placeholder="Your internal reference" /></label>
        <fieldset className="ubo-demo-source ubo-demo-wide"><legend>Demo source</legend>
          <label><input type="radio" name="sourceMode" value="LIVE" checked={draft.sourceMode === "LIVE"} onChange={(e) => onChange("sourceMode", e.target.value)} /> Live Lab research</label>
          <label><input type="radio" name="sourceMode" value="FIXTURE" checked={draft.sourceMode === "FIXTURE"} onChange={(e) => onChange("sourceMode", e.target.value)} /> Reviewed ASDA fixture <small>no provider call</small></label>
          <label><input type="radio" name="sourceMode" value="REPLAY" disabled={!replays.length} checked={draft.sourceMode === "REPLAY"} onChange={(e) => onChange("sourceMode", e.target.value)} /> Saved live replay <small>no provider call</small></label>
          {draft.sourceMode === "REPLAY" && <select aria-label="Saved research result" value={draft.replayId} onChange={(e) => onChange("replayId", e.target.value)}><option value="">Choose saved research</option>{replays.map((r) => <option key={r.replayId} value={r.replayId}>{r.companyContext?.legalEntityName || r.replayId}</option>)}</select>}
        </fieldset>
      </div>
      <div className="ubo-demo-examples"><span>Instant engine examples</span><button type="button" onClick={() => onLoadExample(DEMO_CALCULATION_FIXTURES.ALICE_28)}>Load Alice example — no provider call</button><button type="button" onClick={() => onLoadExample(DEMO_CALCULATION_FIXTURES.METHOD_60_40)}>Load 60/40 method comparison — no provider call</button></div>
      <div className="ubo-demo-actions"><p>Saved in this browser for this demo only.</p><button className="ubo-demo-primary" type="submit">Start research <span>→</span></button></div>
    </form>
  </main>;
}

function ResearchProgress({ company }) {
  return <main className="ubo-demo-main"><section className="ubo-demo-research-card" aria-live="polite"><div className="ubo-demo-spinner" /><span className="ubo-demo-eyebrow">Research in progress</span><h1>Researching {company.legalName}</h1><ul className="ubo-demo-stage-list"><li>Researching company records</li><li>Following ownership and control relationships</li><li>Building ownership structure</li><li>Checking what is still unresolved</li></ul><p>These labels describe the operation in progress; they do not claim a stage has completed.</p></section></main>;
}

function GraphFrame({ projection, entityLabels, registryContexts, reviewPresentations, selectionCommand, onSelectionChange }) {
  const frame = useRef(null);
  const send = useCallback(() => frame.current?.contentWindow?.postMessage({
    type: "ubo-demo-graph-projection-v1",
    projection,
    entityLabels,
    registryContexts,
    reviewPresentations,
    selectionCommand,
    viewportHeight: Math.max(600, Math.min(820, Math.round(window.innerHeight * 0.68))),
  }, window.location.origin), [projection, entityLabels, registryContexts, reviewPresentations, selectionCommand]);
  useEffect(() => {
    send();
    window.addEventListener("resize", send);
    return () => window.removeEventListener("resize", send);
  }, [send]);
  useEffect(() => {
    const receive = (event) => {
      if (event.origin !== window.location.origin || event.source !== frame.current?.contentWindow || event.data?.type !== "ubo-demo-graph-selection-v1") return;
      onSelectionChange?.(event.data.selection || null);
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [onSelectionChange]);
  return <iframe ref={frame} onLoad={send} className="ubo-demo-graph-frame" title="Ownership structure" src="/ubo-demo-graph.html" />;
}

function Assertions({ result }) {
  const rows = allCandidateFacts(result);
  return <details className="ubo-demo-assertions"><summary><strong>Research assertions and source facts</strong><span>{rows.length} assertions · click to inspect</span></summary><div className="ubo-demo-assertion-list">{rows.map(({ fact, source }, index) => {
    if (fact.type === "ENTITY_ATTRIBUTE") return <article key={fact.factId || index}><span className="ubo-demo-kind">Registry context</span><p><strong>{fact.subject?.name || "Registry entity"}</strong></p><p>{Object.entries(fact.value || {}).filter(([, value]) => value).map(([key, value]) => `${key.replaceAll(/([A-Z])/g, " $1")}: ${value}`).join(" · ")}</p><small>{assertionSourceState(result, source)} · {fact.evidenceReferences?.[0]?.referenceId || source.requestId || "Reference retained"} · Candidate/source assertion</small></article>;
    const presentation = relationshipAssertionPresentation(fact);
    return <article key={fact.factId || index}><span className="ubo-demo-kind">{presentation.category}</span><p><strong>{fact.subject?.name || "Source party"}</strong> → <strong>{fact.object?.name || "Target party"}</strong></p><p>{presentation.description}{presentation.measurement ? ` · ${presentation.measurement}` : ""}</p>{presentation.sourceDescription && <p>{presentation.sourceDescription}</p>}<small>{fact.qualifiers?.currentState || "Currentness not supplied"} · {assertionSourceState(result, source)} · {fact.evidenceReferences?.[0]?.referenceId || source.requestId || "Reference retained"} · Candidate/source assertion</small></article>;
  })}</div></details>;
}

function Identity({ entity }) {
  return <span><strong>{entity.legalName}</strong>{entity.registrationNumber ? <> · {entity.registrationNumber}</> : null}</span>;
}

function OpenQuestions({ view, result, onShowOnMap }) {
  const items = accountOpenItems(view, result);
  const currentBundles = executableCustomerBundles(view);
  const currentQuestions = demoOpenQuestions(view).filter(({ state }) => state === "CURRENT_EXECUTABLE");
  const currentCustomerCount = currentBundles.length;
  const selectTarget = (item, entityId) => onShowOnMap({ kind: "entity", id: entityId }, item.needId);
  return <aside className="ubo-demo-questions"><span className="ubo-demo-eyebrow">Your next step</span><h2>Open questions</h2>
    {currentCustomerCount === 0 ? <div className="ubo-demo-no-questions"><strong>Nothing needed from you right now.</strong><p>{items.length ? `${items.length} open cause${items.length === 1 ? " is" : "s are"} recorded below so you can see what happens next. None is an executable customer task in the current planner wave.` : "We are still reviewing parts of the ownership structure."}</p></div> : currentQuestions.map((question) => <section key={`${question.kind}:${question.informationNeedIds.join(":")}`}><span className="ubo-demo-question-kind">Needed from you now</span><h3>{question.title}</h3><p>{question.body}</p></section>)}
    <div className="ubo-demo-open-accounting" aria-label="Open cause accounting">
      {items.map((item) => <section id={`demo-need-${item.needId}`} key={item.needId} className={`ubo-demo-question-card state-${item.disposition.code.toLowerCase()}`} data-information-need-id={item.needId}>
        <span className="ubo-demo-question-kind">{item.disposition.label}</span><h3>{item.title}</h3>
        <dl><dt>About</dt><dd>{item.about.map((entity) => <Identity key={entity.entityId || entity.legalName} entity={entity} />)}</dd><dt>Scope</dt><dd>{item.scope}</dd><dt>What is missing</dt><dd>{item.missing}</dd><dt>Why it matters</dt><dd>{item.disposition.summary} {item.why}</dd></dl>
        <details><summary>Addresses and possible routes</summary><p><strong>Requirements:</strong> {item.requirementIds.join(", ") || "No requirement ID supplied"}</p>{item.routes.length ? <ul>{item.routes.map((route, index) => <li key={`${route.actor}:${route.action}:${index}`}><strong>{route.state === "CURRENT" ? "Current" : route.state === "NOT_ENABLED" ? "Not enabled" : "Available later"}</strong> · {String(route.actor || "Unassigned").replaceAll("_", " ")} · {String(route.action || "No action").replaceAll("_", " ")}{route.requiredSignoffs?.length ? ` · sign-off ${route.requiredSignoffs.join(", ")}` : ""}</li>)}</ul> : <p>No resolution route is currently recorded.</p>}</details>
        {item.targetChoices.length > 1 ? <div className="ubo-demo-map-targets"><span>Show on map:</span>{item.targetChoices.map((target) => <button type="button" key={target.entityId} onClick={() => selectTarget(item, target.entityId)}>{target.label}</button>)}</div> : <button className="ubo-demo-map-link" type="button" onClick={() => onShowOnMap(item.selection, item.needId)}>Show on map</button>}
      </section>)}
    </div>
    {view?.journeyProjection?.internalReview && ((view.journeyProjection.internalReview.actions || []).length + (view.journeyProjection.internalReview.requirements || []).length) > 0 && <p className="ubo-demo-internal">Internal review is still in progress. This is not a customer question.</p>}
    {items.some(({ disposition }) => disposition.code === "INTERNAL_REVIEW") && <div className="ubo-demo-llp-explainer"><strong>Why LLP review is still open</strong><p>Companies House records the parties and source rights, but an LLP control conclusion can depend on how the partnership agreement operates. This is a prototype policy-assumption limitation and internal interpretation step, not a question for the customer right now.</p><details><summary>Review references</summary><p>Review-only working assumption A-06-WA-01 · required sign-off A-06.</p></details></div>}
  </aside>;
}

function GraphControls({ scope, dimension, onScope, onDimension, visibleGraph, totalGraph }) {
  return <div className="ubo-demo-graph-controls">
    <fieldset><legend>Map scope</legend><button type="button" aria-pressed={scope === DEMO_GRAPH_SCOPES.RELEVANT} onClick={() => onScope(DEMO_GRAPH_SCOPES.RELEVANT)}>Relevant to this company</button><button type="button" aria-pressed={scope === DEMO_GRAPH_SCOPES.FULL} onClick={() => onScope(DEMO_GRAPH_SCOPES.FULL)}>Full research map</button></fieldset>
    <fieldset><legend>Relationships</legend>{Object.values(DEMO_GRAPH_DIMENSIONS).map((value) => <button key={value} type="button" aria-pressed={dimension === value} onClick={() => onDimension(value)}>{value === "ALL" ? "All" : value[0] + value.slice(1).toLowerCase()}</button>)}</fieldset>
    <span className="ubo-demo-visible-counts">Showing {visibleGraph?.nodes?.length || 0} of {totalGraph?.nodes?.length || 0} entities · {visibleGraph?.relationships?.length || 0} of {totalGraph?.relationships?.length || 0} relationships</span>
  </div>;
}

function CalculationPanel({ view, result, method, onMethodChange, onShowPath }) {
  const people = useMemo(() => demoCalculationPeople(view, method, result.entityLabels), [view, method, result.entityLabels]);
  const [personId, setPersonId] = useState(() => people[0]?.personEntityId || "");
  useEffect(() => { if (!people.some(({ personEntityId }) => personEntityId === personId)) setPersonId(people[0]?.personEntityId || ""); }, [people, personId]);
  const person = people.find(({ personEntityId }) => personEntityId === personId) || people[0];
  return <section className="ubo-demo-calculation" aria-labelledby="demo-calculation-title">
    <div className="ubo-demo-calculation-heading"><div><span className="ubo-demo-eyebrow">Recorded engine output</span><h2 id="demo-calculation-title">How this result was calculated</h2></div>{people.length > 1 && <label>Person<select value={person?.personEntityId || ""} onChange={(event) => setPersonId(event.target.value)}>{people.map((item) => <option key={item.personEntityId} value={item.personEntityId}>{item.personName}</option>)}</select></label>}</div>
    <CalculationMethodSelector compact value={method} onChange={onMethodChange} />
    {!person ? <p className="ubo-demo-calculation-empty">No person-level calculation is recorded for the current result.</p> : <div className="ubo-demo-calculation-body">
      <div className="ubo-demo-result-pair"><div><span>Selected-method result — demo</span><strong>{person.selectedResultLabel}</strong></div><div><span>Overall policy result</span><strong>{person.overallPolicyLabel}</strong></div></div>
      {person.selectedBases.length === 0 ? <p className="ubo-demo-calculation-empty">This assessment route is not supported by the available recorded facts. No alternative fact or percentage has been inferred.</p> : person.selectedBases.map((basis) => <article className="ubo-demo-basis" key={basis.basisId}>
        <header><div><span>{basis.route === "EFFECTIVE_INTEREST" ? "Effective ownership" : "Control attribution"}{basis.dimension ? ` · ${basis.dimension.toLowerCase()}` : ""}</span><strong>{basis.resultLabel}</strong></div>{basis.aggregate && <button type="button" onClick={() => onShowPath(basis.relationshipIds, `${basis.basisId}:total`)}><small>Recorded result</small>{formatMeasurement(basis.aggregate)}</button>}</header>
        {basis.threshold && <p className="ubo-demo-threshold">Policy threshold: <strong>{basis.threshold.comparator}{basis.threshold.value}%</strong> · {basis.threshold.classification.toLowerCase()} · {basis.threshold.dimension.toLowerCase()}</p>}
        {basis.effectivePaths.length > 0 && <div className="ubo-demo-paths">{basis.effectivePaths.map((path) => <button type="button" key={path.pathId} onClick={() => onShowPath(path.relationshipIds, path.pathId)}><span>{path.directness}</span><strong>{path.route}</strong><small>{path.inputs.join(" × ")} = {path.contribution}</small><em>Highlight contributing path</em></button>)}</div>}
        {basis.attributionChains.length > 0 && <div className="ubo-demo-paths">{basis.attributionChains.map((chain) => <button type="button" key={chain.pathId} onClick={() => onShowPath(chain.relationshipIds, chain.pathId)}><span>Attributed control chain</span><strong>{chain.route}</strong><small>{chain.majoritySteps.map((step) => `${step.from} → ${step.to}: ${step.measurement} ${step.relationshipType.replaceAll("_", " ").toLowerCase()}`).join(" · ")}</small><em>Highlight controlling chain</em></button>)}</div>}
        {basis.limitations.length > 0 && <p className="ubo-demo-limitations">Review limitation: {basis.limitations.join(", ")}</p>}
        <details><summary>Trace references</summary><p>Basis {basis.basisId} · Method {basis.method} · Relationship references retained in the immutable snapshot.</p></details>
      </article>)}
      <p className="ubo-demo-calculation-note">Changing this inspection focus does not alter the overall policy assessment, immutable snapshot, open questions or source facts.</p>
    </div>}
  </section>;
}

function ResearchResult({ demoCase, result, onEdit, onRetry, onDisplayChange, onCalculationMethodChange }) {
  const view = result.view;
  const pending = (result.decisionTargets?.candidateParties?.length || 0) + (result.decisionTargets?.candidateClaims?.length || 0);
  const scope = result.displayState?.scope || DEMO_GRAPH_SCOPES.RELEVANT;
  const dimension = result.displayState?.dimension || DEMO_GRAPH_DIMENSIONS.ALL;
  const [selectionCommand, setSelectionCommand] = useState(null);
  const sourceRelevantIds = useMemo(() => demoSourceRelevantEntityIds(view?.graph, result), [view?.graph, result]);
  const filteredGraph = useMemo(() => projectDemoGraph(view?.graph, { scope, dimension, additionalRelevantEntityIds: sourceRelevantIds }), [view?.graph, scope, dimension, sourceRelevantIds]);
  const reviewPresentations = useMemo(() => demoReviewPresentations(view, result), [view, result]);
  const showOnMap = (selection, needId) => {
    if (!selection) return;
    onDisplayChange({ scope: DEMO_GRAPH_SCOPES.RELEVANT, dimension: DEMO_GRAPH_DIMENSIONS.ALL });
    setSelectionCommand({ commandId: `${needId}:${Date.now()}`, selection });
    window.setTimeout(() => document.querySelector(".ubo-demo-graph-card")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  };
  const onGraphSelection = useCallback((selection) => {
    if (selection?.kind !== "unresolved") return;
    document.getElementById(`demo-need-${selection.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);
  const showCalculationPath = (relationshipIds, pathId) => {
    if (!relationshipIds?.length) return;
    onDisplayChange({ scope: DEMO_GRAPH_SCOPES.RELEVANT, dimension: DEMO_GRAPH_DIMENSIONS.ALL });
    setSelectionCommand({ commandId: `${pathId}:${Date.now()}`, selection: { kind: "path", id: pathId, relationshipIds } });
    window.setTimeout(() => document.querySelector(".ubo-demo-graph-card")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  };
  const calculationMethod = result.analysisContext?.calculationMethod || demoCase.analysisContext?.calculationMethod || "POLICY_ALL_ROUTES";
  return <main className="ubo-demo-results">
    <header className="ubo-demo-result-heading"><div><span className="ubo-demo-eyebrow">Ownership research</span><h1>{demoCase.company.legalName}</h1><p>{demoCase.company.registrationNumber} · {demoCase.company.countryName} · {result.canonicalCompanyTypeLabel || ownershipLabelFor(demoCase.company.ownershipType)}</p></div><span className={`ubo-demo-source-badge ${result.sourceMode.toLowerCase()}`}>{result.selectedFixtureId === DEMO_CALCULATION_FIXTURES.ALICE_28 || result.selectedFixtureId === DEMO_CALCULATION_FIXTURES.METHOD_60_40 ? "Synthetic calculation fixture · no provider call" : result.sourceMode === "FIXTURE" ? "Reviewed fixture · not this company’s live result" : result.sourceMode === "REPLAY" ? "Saved live replay" : "LIVE RESEARCH — PROVISIONAL DEMO RESULT"}</span></header>
    {view ? <><CalculationPanel view={view} result={result} method={calculationMethod} onMethodChange={onCalculationMethodChange} onShowPath={showCalculationPath} /><div className="ubo-demo-workspace"><section className="ubo-demo-graph-card"><div className="ubo-demo-section-heading"><div><span className="ubo-demo-eyebrow">Established structure</span><h2>Ownership structure</h2></div></div><GraphControls scope={scope} dimension={dimension} onScope={(next) => onDisplayChange({ scope: next })} onDimension={(next) => onDisplayChange({ dimension: next })} visibleGraph={filteredGraph} totalGraph={view.graph} /><GraphFrame projection={filteredGraph} entityLabels={result.entityLabels} registryContexts={result.registryContexts} reviewPresentations={reviewPresentations} selectionCommand={selectionCommand} onSelectionChange={onGraphSelection} /><Assertions result={result} /></section><OpenQuestions view={view} result={result} onShowOnMap={showOnMap} /></div></> : <><section className="ubo-demo-review-wait"><span className="ubo-demo-eyebrow">Research complete</span><h2>Explicit review is required before an ownership graph can be established</h2><p>{pending} candidate identity or claim decision{pending === 1 ? "" : "s"} remain. Live source assertions are not automatically adjudicated, and no UBO conclusion has been inferred.</p></section><div className="ubo-demo-workspace"><section className="ubo-demo-graph-card"><div className="ubo-demo-graph-empty"><h2>Ownership structure pending review</h2><p>The canonical graph will appear only after the existing Decision Application review boundary produces a snapshot.</p></div><Assertions result={result} /></section><OpenQuestions view={null} result={result} onShowOnMap={() => {}} /></div></>}
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
    runDemoResearch({ demoCase, sourceMode: draft.sourceMode, replayRecord, demoFixtureId: demoCase.analysisContext?.demoFixtureId }).then((session) => {
      if (!active) return;
      if (session.replayCapture) saveLabReplay(session.replayCapture);
      setResearchResult(compactResearchResult(session, draft.sourceMode, demoCase.analysisContext?.calculationMethod));
    }).catch((cause) => { if (active) { setResearchError(`${cause.code ? `${cause.code}: ` : ""}${cause.message}`); setResearchResult(null); } });
    return () => { active = false; };
  }, [pathname, demoCase, researchResult?.status, runToken]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateDraft = (field, value) => { setDraft((d) => ({ ...d, [field]: value })); setErrors((e) => ({ ...e, [field]: undefined })); };
  const startResearch = (event) => { event.preventDefault(); const cleanDraft = { ...draft, demoFixtureId: "" }; const next = validateDemoDraft(cleanDraft); if (cleanDraft.sourceMode === "REPLAY" && !cleanDraft.replayId && !replays.length) next.replayId = "Choose a saved research result."; setErrors(next); if (Object.keys(next).length) return; setDraft(cleanDraft); const nextCase = createDemoCase(cleanDraft); setDemoCase(nextCase); setResearchError(""); setResearchResult({ status: "LOADING", sourceMode: cleanDraft.sourceMode }); navigateDemo(DEMO_RESEARCH_PATH); };
  const loadCalculationExample = (fixtureId) => {
    const alice = fixtureId === DEMO_CALCULATION_FIXTURES.ALICE_28;
    const nextDraft = { ...draft, legalName: alice ? "Example Trading Ltd" : "V2 Review Customer Limited", registrationNumber: alice ? "DEMO0028" : "DEMO6040", countryCode: "GB", ownershipType: "PRIVATE_LIMITED", sourceMode: "FIXTURE", replayId: "", calculationMethod: alice ? "EFFECTIVE_INTEREST" : "POLICY_ALL_ROUTES", demoFixtureId: fixtureId };
    setDraft(nextDraft); setDemoCase(createDemoCase(nextDraft)); setErrors({}); setResearchError(""); setResearchResult({ status: "LOADING", sourceMode: "FIXTURE" }); navigateDemo(DEMO_RESEARCH_PATH);
  };
  const changeCalculationMethod = (calculationMethod) => {
    setDraft((current) => ({ ...current, calculationMethod }));
    setDemoCase((current) => current ? ({ ...current, analysisContext: { ...(current.analysisContext || {}), calculationMethod } }) : current);
    setResearchResult((current) => current ? ({ ...current, analysisContext: { ...(current.analysisContext || {}), calculationMethod } }) : current);
  };
  const runAgain = (mode = draft.sourceMode) => { setDraft((d) => ({ ...d, sourceMode: mode, replayId: mode === "REPLAY" ? (d.replayId || readLabReplays()[0]?.replayId || "") : d.replayId })); setResearchError(""); setResearchResult({ status: "LOADING", sourceMode: mode }); setRunToken((n) => n + 1); };
  const startNewCase = () => { skipNextSave.current = true; clearDemoSession(); setDraft(emptyDemoDraft()); setDemoCase(null); setResearchResult(null); setErrors({}); navigateDemo(DEMO_START_PATH, { replace: true }); };
  const edit = () => navigateDemo(DEMO_START_PATH);
  const research = isDemoResearchPath(pathname);

  let content;
  if (!research) content = <CompanyStart draft={draft} errors={errors} replays={replays} onChange={updateDraft} onSubmit={startResearch} onLoadExample={loadCalculationExample} />;
  else if (!demoCase) content = <main className="ubo-demo-main ubo-demo-empty"><h1>Start with company details</h1><button className="ubo-demo-primary" onClick={edit}>Enter company details</button></main>;
  else if (researchResult?.status === "LOADING") content = <ResearchProgress company={demoCase.company} />;
  else if (researchError) content = <ResearchError error={researchError} replays={replays} onRetry={() => runAgain("LIVE")} onReplay={() => runAgain("REPLAY")} onEdit={edit} />;
  else if (researchResult) content = <ResearchResult demoCase={demoCase} result={researchResult} onEdit={edit} onRetry={() => runAgain()} onCalculationMethodChange={changeCalculationMethod} onDisplayChange={(change) => setResearchResult((current) => ({ ...current, displayState: { scope: current.displayState?.scope || DEMO_GRAPH_SCOPES.RELEVANT, dimension: current.displayState?.dimension || DEMO_GRAPH_DIMENSIONS.ALL, ...change } }))} />;
  else content = <ResearchProgress company={demoCase.company} />;
  return <div className="ubo-demo-page"><DemoHeader onStartNew={startNewCase} /><DemoProgress research={research} />{content}<footer className="ubo-demo-footer">Demo experience · Browser-local session · UK Corporate 1.6-RC review path</footer></div>;
}
