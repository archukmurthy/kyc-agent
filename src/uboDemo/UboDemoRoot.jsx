import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { COUNTRIES } from "../constants/appConstants";
import {
  availableLabReplays, bindDraftToReplay, CALCULATION_METHODS, clearDemoSession, createDemoCase, emptyDemoDraft, findReplayById,
  OWNERSHIP_TYPES, ownershipLabelFor, readDemoSession, readLabReplays, saveLabReplay,
  validateDemoDraft, writeDemoSession,
} from "./demoSession";
import {
  accountOpenItems, allCandidateFacts, compactResearchResult, DEMO_CALCULATION_FIXTURES, demoCalculationPeople, demoOpenQuestions, demoReviewPresentations,
  DEMO_GRAPH_DIMENSIONS, DEMO_GRAPH_SCOPES, executableCustomerBundles, formatMeasurement,
  abortActiveDemoResearchJobs, acquireDemoResearch, demoSourceRelevantEntityIds, projectDemoGraph,
} from "./demoResearch";
import { limitNotice } from "../trials/limitNotice";
import AssertionDetails from "./AssertionDetails";
import { DEMO_AUDIT_PATH, DEMO_RESEARCH_PATH, DEMO_REVIEW_PATH, DEMO_START_PATH, isDemoAuditPath, isDemoResearchPath, isDemoReviewPath, navigateDemo } from "./demoRoute";
import { buildCustomerHandoff, openCustomerViewHandoff } from "./customerHandoff";
import CustomerLinkPanel, { withdrawCustomerLinks } from "./CustomerLinkPanel";
import AnalystInvestigationTopics from "./AnalystInvestigationTopics";
import { createTopicActivation } from "./customer/investigationTopics";
import AnalystResolutionView from "./AnalystResolutionView";
import JobsNeedingAttention from "./JobsNeedingAttention";
import CaseLedger from "./CaseLedger";
import ReuseEarlierChart from "./ReuseEarlierChart";
import { clearActivePocCase, customerEngagement, listSavedResearch, loadPocCase, persistPocCase, smallStableHash } from "./pocCaseClient";
import { customerCompanyKey } from "./customer/customerOwnershipChartSession";
import { adoptRegistryName } from "./registryName";
import "./uboDemo.css";

// Temporarily hide the legacy analyst open-questions panel without removing its implementation.
const SHOW_ANALYST_OPEN_QUESTIONS = false;

function DemoHeader({ onStartNew }) {
  return <header className="ubo-demo-header"><a className="ubo-demo-brand" href={DEMO_START_PATH}><span className="ubo-demo-mark">N</span><span>Ownership review</span></a><button className="ubo-demo-link-button" type="button" onClick={onStartNew}>Start new case</button></header>;
}

function DemoProgress({ pathname }) {
  const current = isDemoAuditPath(pathname) ? null : isDemoReviewPath(pathname) ? 3 : isDemoResearchPath(pathname) ? 2 : 1;
  const steps = [{ label: "Company", href: DEMO_START_PATH }, { label: "Ownership Research", href: DEMO_RESEARCH_PATH }, { label: "Analyst Review", href: DEMO_REVIEW_PATH }];
  return <ol className="ubo-demo-progress" aria-label="Demo journey progress">{steps.map((step, index) => <li key={step.label} className={index + 1 < current ? "complete" : index + 1 === current ? "current" : ""}><a href={step.href}><span className="ubo-demo-progress-number">{index + 1}</span><span className="ubo-demo-progress-label">{step.label}</span></a></li>)}</ol>;
}

function DemoFooter({ pathname }) {
  const environment = process.env.REACT_APP_UBO_ENVIRONMENT || "local";
  const version = process.env.REACT_APP_UBO_PRODUCT_VERSION || "development";
  const commit = (process.env.REACT_APP_UBO_COMMIT_SHA || "unversioned").slice(0, 7);
  return <footer className="ubo-demo-footer"><nav aria-label="Supporting evidence"><span>Supporting evidence and traceability</span><a href={DEMO_AUDIT_PATH} aria-current={isDemoAuditPath(pathname) ? "page" : undefined}>Open Audit</a></nav><small>Demo experience · Server-saved POC case · UK Corporate 1.6-RC review path</small><small aria-label="Build metadata">{environment} · {version} · {commit}</small></footer>;
}

function FieldError({ id, children }) { return <p className="ubo-demo-error" id={id} role="alert">{children}</p>; }

function CalculationMethodSelector({ value, onChange, compact = false }) {
  return <fieldset className={`ubo-demo-method ${compact ? "compact" : "ubo-demo-wide"}`}><legend>Calculation method</legend><p>Choose which calculation or control assessment to inspect.</p><div>{CALCULATION_METHODS.map((method) => <label key={method.code}><input type="radio" name={compact ? "resultCalculationMethod" : "calculationMethod"} value={method.code} checked={value === method.code} onChange={() => onChange(method.code)} /><span><strong>{method.label}</strong><small>{method.explanation}</small></span></label>)}</div></fieldset>;
}

// Leaving a case a customer may be working on (UBO-57): the analyst decides
// what happens to the link - it never moves to another company's case.
function NewCaseNotice({ notice, onContinue, onCancel }) {
  const { fromCompany, toCompany, engagement, busy, error } = notice;
  const what = !engagement ? `We could not check whether a customer link was sent for ${fromCompany}.`
    : engagement.customerStarted ? `The customer has already started on the ${fromCompany} case.`
      : `A customer link was sent for ${fromCompany}.`;
  return <section className="ubo-demo-new-case-notice" role="alertdialog" aria-label="Starting a separate case">
    <h2>This starts a separate case for {toCompany}</h2>
    <p>{what} A link always stays on its own case - it is never moved to another company's case, because that would show one company's ownership details to another company's contact.</p>
    <p>If that link went to the wrong case, withdraw it and send the customer a new link for {toCompany} once the research is ready.</p>
    {error && <p role="alert" className="ubo-demo-error">{error}</p>}
    <div className="ubo-demo-new-case-actions">
      <button type="button" className="ubo-demo-primary" disabled={busy} onClick={() => onContinue({ withdraw: true })}>{busy ? "Withdrawing…" : `Withdraw the ${fromCompany} link and continue`}</button>
      <button type="button" className="ubo-demo-secondary" disabled={busy} onClick={() => onContinue({ withdraw: false })}>Keep that link and continue</button>
      <button type="button" className="ubo-demo-secondary" disabled={busy} onClick={onCancel}>Cancel</button>
    </div>
  </section>;
}

function CompanyStart({ draft, errors, savedResearch, newCaseNotice, onNewCaseContinue, onNewCaseCancel, onChange, onSavedSelect, onSubmit, onLoadExample }) {
  const replayMode = draft.sourceMode === "REPLAY";
  const savedMode = draft.sourceMode === "SAVED";
  return <main className="ubo-demo-main">
    <div className="ubo-demo-intro"><span className="ubo-demo-eyebrow">Ownership review</span><h1>Let&rsquo;s research your company</h1><p>Tell us which company you&rsquo;re reviewing. We&rsquo;ll use these details to start its ownership journey.</p></div>
    <form className="ubo-demo-card" onSubmit={onSubmit} noValidate>
      <div className="ubo-demo-card-heading"><span>Company details</span><small>Fields marked * are required</small></div>
      <div className="ubo-demo-fields">
        <label className="ubo-demo-field ubo-demo-wide"><span>Company name *</span><input autoComplete="organization" readOnly={replayMode || savedMode} aria-invalid={Boolean(errors.legalName)} value={draft.legalName} onChange={(e) => onChange("legalName", e.target.value)} placeholder="Enter the registered company name" />{errors.legalName && <FieldError id="legal-name-error">{errors.legalName}</FieldError>}</label>
        <label className="ubo-demo-field"><span>Registration number *</span><input autoComplete="off" inputMode="text" readOnly={replayMode || savedMode} aria-invalid={Boolean(errors.registrationNumber)} value={draft.registrationNumber} onChange={(e) => onChange("registrationNumber", e.target.value)} placeholder="For example, 00445790" /><small>Letters and leading zeros are preserved.</small>{errors.registrationNumber && <FieldError id="registration-error">{errors.registrationNumber}</FieldError>}</label>
        <label className="ubo-demo-field"><span>Country of registration *</span><select disabled={replayMode || savedMode} value={draft.countryCode} onChange={(e) => onChange("countryCode", e.target.value)}>{COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select></label>
        <label className="ubo-demo-field"><span>Ownership type *</span><select value={draft.ownershipType} onChange={(e) => onChange("ownershipType", e.target.value)}>{OWNERSHIP_TYPES.map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}</select><small>Context only; it does not change policy.</small></label>
        <CalculationMethodSelector value={draft.calculationMethod} onChange={(value) => onChange("calculationMethod", value)} />
        <label className="ubo-demo-field"><span>Case ID / reference <em>Optional</em></span><input autoComplete="off" value={draft.referenceCaseId} onChange={(e) => onChange("referenceCaseId", e.target.value)} placeholder="Your internal reference" /></label>
        <fieldset className="ubo-demo-source ubo-demo-wide"><legend>Demo source</legend>
          <label><input type="radio" name="sourceMode" value="LIVE" checked={draft.sourceMode === "LIVE"} onChange={(e) => onChange("sourceMode", e.target.value)} /> Live Lab research</label>
          <label><input type="radio" name="sourceMode" value="FIXTURE" checked={draft.sourceMode === "FIXTURE"} onChange={(e) => onChange("sourceMode", e.target.value)} /> Reviewed ASDA fixture <small>no provider call</small></label>
          <label><input type="radio" name="sourceMode" value="SAVED" disabled={!savedResearch.length} checked={draft.sourceMode === "SAVED"} onChange={(e) => onChange("sourceMode", e.target.value)} /> Saved research <small>no provider call</small></label>
          {savedMode && <><select aria-label="Saved research" aria-invalid={Boolean(errors.savedCaseId)} value={draft.savedCaseId || ""} onChange={(e) => onSavedSelect(e.target.value)}><option value="">Choose saved research</option>{savedResearch.map((item) => <option key={item.caseId} value={item.caseId}>{item.company.legalName} · {item.company.registrationNumber} · {new Date(item.researchedAt).toLocaleString()}</option>)}</select>{errors.savedCaseId && <FieldError id="saved-research-error">{errors.savedCaseId}</FieldError>}</>}
          <div className="ubo-demo-replay-library"><div><strong>{savedResearch.length ? `${savedResearch.length} saved research result${savedResearch.length === 1 ? "" : "s"} in this workspace` : "No saved research in this workspace yet"}</strong><small>Every completed research run is kept with its case on our server. Starting from one makes no provider call.</small></div></div>
        </fieldset>
      </div>
      <div className="ubo-demo-examples"><span>Instant engine examples</span><button type="button" onClick={() => onLoadExample(DEMO_CALCULATION_FIXTURES.ALICE_28)}>Load Alice example — no provider call</button><button type="button" onClick={() => onLoadExample(DEMO_CALCULATION_FIXTURES.METHOD_60_40)}>Load 60/40 method comparison — no provider call</button></div>
      {newCaseNotice && <NewCaseNotice notice={newCaseNotice} onContinue={onNewCaseContinue} onCancel={onNewCaseCancel} />}
      <div className="ubo-demo-actions"><p>Saved to this case on our server - nothing about it stays in your browser.</p><button className="ubo-demo-primary" type="submit">{replayMode || savedMode ? "Start from saved research — no provider call" : "Start research"} <span>→</span></button></div>
    </form>
  </main>;
}

function ResearchProgress({ company, progress }) {
  const events = progress?.events || [];
  const current = events[events.length - 1];
  return <main className="ubo-demo-main"><section className="ubo-demo-research-card" aria-live="polite"><div className="ubo-demo-spinner" /><span className="ubo-demo-eyebrow">Research in progress</span><h1>Researching {company.legalName}</h1><p role="status">{current?.message || "Starting a bounded live research job…"}</p><ul className="ubo-demo-stage-list">{events.map((event, index) => <li key={`${event.stage}:${index}`}>{event.message}</li>)}</ul>{progress?.jobId && <small>Research job {progress.jobId}</small>}</section></main>;
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
  return <iframe ref={frame} onLoad={send} className="ubo-demo-graph-frame" title="Ownership structure" src="/ubo-demo-graph.html?v=overview-1" />;
}

function Assertions({ result }) {
  const rows = allCandidateFacts(result);
  return <AssertionDetails entries={rows} title="Research assertions and source facts" sourceNotice="Candidate/source assertions are not approved conclusions." variant="analyst" collapseButton />;
}

function Identity({ entity }) {
  return <span><strong>{entity.legalName}</strong>{entity.registrationNumber ? <> · {entity.registrationNumber}</> : null}</span>;
}

function OpenQuestions({ view, result, customerRequests, onShowOnMap, onToggleCustomerRequest }) {
  const [expanded, setExpanded] = useState(false);
  const items = accountOpenItems(view, result);
  const currentBundles = executableCustomerBundles(view);
  const currentQuestions = demoOpenQuestions(view).filter(({ state }) => state === "CURRENT_EXECUTABLE");
  const currentCustomerCount = currentBundles.length;
  const selectTarget = (item, entityId) => onShowOnMap({ kind: "entity", id: entityId }, item.needId);
  return <aside className="ubo-demo-questions"><div className="ubo-demo-questions-heading"><div><span className="ubo-demo-eyebrow">Your next step</span><h2>Open questions</h2></div><button type="button" aria-expanded={expanded} aria-controls="demo-open-questions-content" onClick={() => setExpanded((value) => !value)}>{expanded ? "Collapse" : "Expand"}</button></div>
    {expanded && <div id="demo-open-questions-content">
    {currentCustomerCount === 0 ? <div className="ubo-demo-no-questions"><strong>Nothing needed from you right now.</strong><p>{items.length ? `${items.length} open cause${items.length === 1 ? " is" : "s are"} recorded below so you can see what happens next. None is an executable customer task in the current planner wave.` : "We are still reviewing parts of the ownership structure."}</p></div> : currentQuestions.map((question) => <section key={`${question.kind}:${question.informationNeedIds.join(":")}`}><span className="ubo-demo-question-kind">Needed from you now</span><h3>{question.title}</h3><p>{question.body}</p></section>)}
    <div className="ubo-demo-open-accounting" aria-label="Open cause accounting">
      {items.map((item) => { const selected = customerRequests.some(({ informationNeedId }) => informationNeedId === item.needId); return <section id={`demo-need-${item.needId}`} key={item.needId} className={`ubo-demo-question-card state-${item.disposition.code.toLowerCase()}`} data-information-need-id={item.needId}>
        <span className="ubo-demo-question-kind">{item.disposition.label}</span><h3>{item.title}</h3>
        <dl><dt>About</dt><dd>{item.about.map((entity) => <Identity key={entity.entityId || entity.legalName} entity={entity} />)}</dd><dt>Scope</dt><dd>{item.scope}</dd><dt>What is missing</dt><dd>{item.missing}</dd><dt>Why it matters</dt><dd>{item.disposition.summary} {item.why}</dd></dl>
        <details><summary>Addresses and possible routes</summary><p><strong>Requirements:</strong> {item.requirementIds.join(", ") || "No requirement ID supplied"}</p>{item.routes.length ? <ul>{item.routes.map((route, index) => <li key={`${route.actor}:${route.action}:${index}`}><strong>{route.state === "CURRENT" ? "Current" : route.state === "NOT_ENABLED" ? "Not enabled" : "Available later"}</strong> · {String(route.actor || "Unassigned").replaceAll("_", " ")} · {String(route.action || "No action").replaceAll("_", " ")}{route.requiredSignoffs?.length ? ` · sign-off ${route.requiredSignoffs.join(", ")}` : ""}</li>)}</ul> : <p>No resolution route is currently recorded.</p>}</details>
        <div className="ubo-demo-question-actions">{item.targetChoices.length > 1 ? <div className="ubo-demo-map-targets"><span>Show on map:</span>{item.targetChoices.map((target) => <button type="button" key={target.entityId} onClick={() => selectTarget(item, target.entityId)}>{target.label}</button>)}</div> : <button className="ubo-demo-map-link" type="button" onClick={() => onShowOnMap(item.selection, item.needId)}>Show on map</button>}<button className="ubo-demo-ask-customer" type="button" aria-pressed={selected} onClick={() => onToggleCustomerRequest(item)}>{selected ? "Added for customer" : "Ask customer"}</button></div>
      </section>; })}
    </div>
    {view?.journeyProjection?.internalReview && ((view.journeyProjection.internalReview.actions || []).length + (view.journeyProjection.internalReview.requirements || []).length) > 0 && <p className="ubo-demo-internal">Internal review is still in progress. This is not a customer question.</p>}
    {items.some(({ disposition }) => disposition.code === "INTERNAL_REVIEW") && <div className="ubo-demo-llp-explainer"><strong>Why LLP review is still open</strong><p>Companies House records the parties and source rights, but an LLP control conclusion can depend on how the partnership agreement operates. This is a prototype policy-assumption limitation and internal interpretation step, not a question for the customer right now.</p><details><summary>Review references</summary><p>Review-only working assumption A-06-WA-01 · required sign-off A-06.</p></details></div>}
    </div>}
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
  const [expanded, setExpanded] = useState(true);
  useEffect(() => { if (!people.some(({ personEntityId }) => personEntityId === personId)) setPersonId(people[0]?.personEntityId || ""); }, [people, personId]);
  const person = people.find(({ personEntityId }) => personEntityId === personId) || people[0];
  return <section className="ubo-demo-calculation" aria-labelledby="demo-calculation-title">
    <div className="ubo-demo-calculation-heading"><div><span className="ubo-demo-eyebrow">Recorded engine output</span><h2 id="demo-calculation-title">How this result was calculated</h2></div><div className="ubo-demo-heading-actions">{people.length > 1 && <label>Person<select value={person?.personEntityId || ""} onChange={(event) => setPersonId(event.target.value)}>{people.map((item) => <option key={item.personEntityId} value={item.personEntityId}>{item.personName}</option>)}</select></label>}<button type="button" aria-expanded={expanded} aria-controls="demo-calculation-content" onClick={() => setExpanded((value) => !value)}>{expanded ? "Collapse" : "Expand"}</button></div></div>
    {expanded && <div id="demo-calculation-content"><CalculationMethodSelector compact value={method} onChange={onMethodChange} />
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
    </div>}</div>}
  </section>;
}

function ResearchResult({ demoCase, result, linkNotice, onEdit, onRetry, onSwitchCustomer, customerSwitchState, prepareCustomerLink, onDisplayChange, onCalculationMethodChange, onToggleCustomerRequest, onActivateTopic, onCancelTopic }) {
  const view = result.view;
  const pending = (result.decisionTargets?.candidateParties?.length || 0) + (result.decisionTargets?.candidateClaims?.length || 0);
  const scope = result.displayState?.scope || DEMO_GRAPH_SCOPES.RELEVANT;
  const dimension = result.displayState?.dimension || DEMO_GRAPH_DIMENSIONS.ALL;
  const [selectionCommand, setSelectionCommand] = useState(null);
  const [graphExpanded, setGraphExpanded] = useState(true);
  const customerRequests = result.analystCustomerRequests || [];
  const sourceRelevantIds = useMemo(() => demoSourceRelevantEntityIds(view?.graph, result), [view?.graph, result]);
  const filteredGraph = useMemo(() => projectDemoGraph(view?.graph, { scope, dimension, additionalRelevantEntityIds: sourceRelevantIds }), [view?.graph, scope, dimension, sourceRelevantIds]);
  const reviewPresentations = useMemo(() => demoReviewPresentations(view, result), [view, result]);
  const showOnMap = (selection, needId) => {
    if (!selection) return;
    setGraphExpanded(true);
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
    setGraphExpanded(true);
    onDisplayChange({ scope: DEMO_GRAPH_SCOPES.RELEVANT, dimension: DEMO_GRAPH_DIMENSIONS.ALL });
    setSelectionCommand({ commandId: `${pathId}:${Date.now()}`, selection: { kind: "path", id: pathId, relationshipIds } });
    window.setTimeout(() => document.querySelector(".ubo-demo-graph-card")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  };
  const calculationMethod = result.analysisContext?.calculationMethod || demoCase.analysisContext?.calculationMethod || "EFFECTIVE_INTEREST";
  return <main className="ubo-demo-results">
    <header className="ubo-demo-result-heading"><div><span className="ubo-demo-eyebrow">Ownership research</span><h1>{demoCase.company.legalName}</h1><p>{demoCase.company.registrationNumber} · {demoCase.company.countryName} · {result.canonicalCompanyTypeLabel || ownershipLabelFor(demoCase.company.ownershipType)}</p></div><span className={`ubo-demo-source-badge ${result.sourceMode.toLowerCase()}`}>{result.fallback ? "CACHED FALLBACK — LIVE REFRESH FAILED" : result.selectedFixtureId === DEMO_CALCULATION_FIXTURES.ALICE_28 || result.selectedFixtureId === DEMO_CALCULATION_FIXTURES.METHOD_60_40 ? "Synthetic calculation fixture · no provider call" : result.sourceMode === "FIXTURE" ? "Reviewed fixture · not this company’s live result" : result.sourceMode === "REPLAY" ? "Saved live replay — provisional demo result" : result.sourceMode === "SAVED" ? "Saved research · no provider call" : `${result.status} LIVE RESEARCH — PROVISIONAL DEMO RESULT`}</span></header>
    {result.sourceMode === "SAVED" && <ReuseEarlierChart demoCase={demoCase} savedFrom={result.savedFrom} />}
    <ProviderOutcomes outcomes={result.providerOutcomes} />
    {result.fallback && <section className="ubo-demo-review-wait" role="status"><strong>Showing the last usable result saved {new Date(result.fallback.savedAt).toLocaleString("en-GB")}.</strong><p>The live refresh failed: {result.fallback.reason}. This cached result may be stale and is reported as PARTIAL, not as a successful live refresh.</p></section>}
    {view ? <><CalculationPanel view={view} result={result} method={calculationMethod} onMethodChange={onCalculationMethodChange} onShowPath={showCalculationPath} /><div className="ubo-demo-workspace"><section className="ubo-demo-graph-card"><div className="ubo-demo-section-heading"><div><span className="ubo-demo-eyebrow">Established structure</span><h2>Ownership structure</h2></div><button type="button" aria-expanded={graphExpanded} aria-controls="demo-ownership-content" onClick={() => setGraphExpanded((value) => !value)}>{graphExpanded ? "Collapse" : "Expand"}</button></div>{graphExpanded && <div id="demo-ownership-content"><GraphControls scope={scope} dimension={dimension} onScope={(next) => onDisplayChange({ scope: next })} onDimension={(next) => onDisplayChange({ dimension: next })} visibleGraph={filteredGraph} totalGraph={view.graph} /><GraphFrame projection={filteredGraph} entityLabels={result.entityLabels} registryContexts={result.registryContexts} reviewPresentations={reviewPresentations} selectionCommand={selectionCommand} onSelectionChange={onGraphSelection} /><Assertions result={result} /></div>}</section><AnalystInvestigationTopics activations={result.investigationTopicActivations || []} trace={result.ownershipResolutionTrace} onActivate={onActivateTopic} onCancel={onCancelTopic} />{SHOW_ANALYST_OPEN_QUESTIONS && <OpenQuestions view={view} result={result} customerRequests={customerRequests} onShowOnMap={showOnMap} onToggleCustomerRequest={onToggleCustomerRequest} />}</div></> : <><section className="ubo-demo-review-wait"><span className="ubo-demo-eyebrow">Research complete</span><h2>Explicit review is required before an ownership graph can be established</h2><p>{pending} candidate identity or claim decision{pending === 1 ? "" : "s"} remain. Live source assertions are not automatically adjudicated, and no UBO conclusion has been inferred.</p></section><div className="ubo-demo-workspace"><section className="ubo-demo-graph-card"><div className="ubo-demo-graph-empty"><h2>Ownership structure pending review</h2><p>The canonical graph will appear only after the existing Decision Application review boundary produces a snapshot.</p></div><Assertions result={result} /></section><AnalystInvestigationTopics activations={result.investigationTopicActivations || []} trace={result.ownershipResolutionTrace} onActivate={onActivateTopic} onCancel={onCancelTopic} />{SHOW_ANALYST_OPEN_QUESTIONS && <OpenQuestions view={null} result={result} customerRequests={customerRequests} onShowOnMap={() => {}} onToggleCustomerRequest={onToggleCustomerRequest} />}</div></>}
    <div className="ubo-demo-bottom-actions"><button className="ubo-demo-secondary" onClick={onEdit}>Edit company details</button><button className="ubo-demo-secondary" onClick={onRetry}>Run again</button><button className="ubo-demo-primary" onClick={onSwitchCustomer}>Switch to customer view</button></div>
    {customerSwitchState && <p className={`ubo-demo-handoff-status ${customerSwitchState.kind}`} role="status">{customerSwitchState.message}</p>}
    {prepareCustomerLink && <CustomerLinkPanel caseId={demoCase.demoCaseId} prepare={prepareCustomerLink} notice={linkNotice} linkStatus={customerEngagement} />}
  </main>;
}

function ProviderOutcomes({ outcomes = [] }) {
  if (!outcomes.length) return null;
  return <section className="ubo-demo-provider-outcomes" aria-label="Research source status">{outcomes.map((item) => <div key={item.provider}><strong>{item.provider === "COMPANIES_HOUSE" ? "Companies House" : item.provider === "WEB_RESEARCH" ? "Web research" : item.provider}</strong><span className={item.outcome.toLowerCase()}>{item.outcome}</span><p>{item.reasonText}{item.httpStatus ? ` (HTTP ${item.httpStatus})` : ""}</p><small>Correlation ID: {item.correlationId || "not recorded"}</small></div>)}</section>;
}

// A limit reached and a failure are different things and used to look
// identical. See src/trials/limitNotice.js.
function ResearchError({ error, result, replays, onRetry, onReplay, onEdit }) {
  const message = typeof error === "string" ? error : (error && error.message) || "";
  const code = typeof error === "string" ? null : error && error.code;
  const notice = limitNotice(code, message);

  if (notice) {
    return <main className="ubo-demo-main"><section className="ubo-demo-research-card ubo-demo-limit"><span className="ubo-demo-eyebrow">{notice.action === "contact" ? "Trial" : "Please wait"}</span><h1>{notice.title}</h1><p>{notice.body}</p><div className="ubo-demo-error-actions">
      {/* "Try again" cannot succeed on an ended trial, and offering it turns a
          sales moment into a loop of refusals. */}
      {notice.action === "wait" && <button className="ubo-demo-primary" onClick={onRetry}>Try again</button>}
      {replays.length > 0 && <button className="ubo-demo-secondary" onClick={onReplay}>Use the latest saved replay</button>}
      <button className="ubo-demo-secondary" onClick={onEdit}>Edit company details</button>
    </div></section></main>;
  }

  return <main className="ubo-demo-main"><section className="ubo-demo-research-card ubo-demo-failure"><span className="ubo-demo-eyebrow">Research unavailable</span><h1>Live research could not be completed</h1><ProviderOutcomes outcomes={result?.providerOutcomes} /><p>{message}</p><p><strong>No conclusion about the ownership structure has been made from these provider failures.</strong></p><div className="ubo-demo-error-actions"><button className="ubo-demo-primary" onClick={onRetry}>Try live research again</button>{replays.length > 0 && <button className="ubo-demo-secondary" onClick={onReplay}>Use the latest saved replay</button>}<button className="ubo-demo-secondary" onClick={onEdit}>Edit company details</button></div></section></main>;
}

// ponytail: a fixed interval; a push channel if analysts need it sooner.
const CUSTOMER_PROGRESS_REFRESH_MS = 30 * 1000;

export default function UboDemoRoot() {
  const restored = readDemoSession();
  const [draft, setDraft] = useState(() => restored?.draft || emptyDemoDraft());
  const [demoCase, setDemoCase] = useState(() => restored?.demoCase || null);
  const [researchResult, setResearchResult] = useState(() => restored?.researchResult || null);
  const [errors, setErrors] = useState({});
  const [pathname, setPathname] = useState(() => window.location.pathname);
  const [runToken, setRunToken] = useState(0);
  const [researchError, setResearchError] = useState(() => restored?.researchResult?.status === "FAILED" ? restored.researchResult.error || "The previous research job failed." : "");
  const [researchProgress, setResearchProgress] = useState({ jobId: null, events: [] });
  const [customerSwitchState, setCustomerSwitchState] = useState(null);
  const [replays, setReplays] = useState(() => availableLabReplays(restored?.researchResult));
  const [replayLibraryStatus, setReplayLibraryStatus] = useState(null);
  const [savedResearch, setSavedResearch] = useState([]);
  // A new case was asked for while a customer may be working on this one: the
  // analyst chooses what happens to that case's link before it goes ahead.
  const [newCaseNotice, setNewCaseNotice] = useState(null);
  // Shown with the new case's link panel after the old case's link was withdrawn.
  const [linkNotice, setLinkNotice] = useState(null);
  const skipNextSave = useRef(false);
  const durableResearchSaves = useRef(new Map());

  useEffect(() => { const onPop = () => setPathname(window.location.pathname); window.addEventListener("popstate", onPop); return () => window.removeEventListener("popstate", onPop); }, []);
  useEffect(() => { window.scrollTo({ top: 0, left: 0, behavior: "auto" }); }, [pathname]);
  // Research saved with this workspace's cases on the server - what survives a
  // reload, another browser or another day, unlike anything kept in the page.
  useEffect(() => {
    if (pathname !== DEMO_START_PATH && pathname !== "/ubo-demo") return undefined;
    let active = true;
    listSavedResearch().then((items) => { if (active) setSavedResearch(items); }).catch(() => { if (active) setSavedResearch([]); });
    return () => { active = false; };
  }, [pathname]);
  useEffect(() => {
    const capture = restored?.researchResult?.replayCapture;
    if (!capture) return;
    try { setReplays(saveLabReplay(capture)); setReplayLibraryStatus({ kind: "success", message: "Recovered the last completed live result into the saved replay library." }); }
    catch (cause) { setReplayLibraryStatus({ kind: "error", message: cause.message || "The last live replay could not be restored." }); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (skipNextSave.current) { skipNextSave.current = false; return; }
    try { writeDemoSession({ draft, demoCase, researchResult }); }
    catch (cause) { setReplayLibraryStatus({ kind: "error", message: `${cause.message || "Local demo-session storage failed."} The current live result remains available until this page is closed.` }); }
  }, [draft, demoCase, researchResult]);
  const saveResearchDurably = () => {
    if (!demoCase?.demoCaseId || !researchResult || researchResult.status === "LOADING") return Promise.reject(new Error("Research is not ready to save."));
    // The case is part of it: two cases started from the same saved research
    // carry the same research, and the second was taken for an earlier save
    // and never sent (found clicking through, 2026-10-04).
    const signature = smallStableHash([demoCase.demoCaseId, researchResult.jobId, researchResult.status, researchResult.completedAt,
      researchResult.investigationTopicActivations, researchResult.analystCustomerRequests]);
    const existing = durableResearchSaves.current.get(signature);
    if (existing) return existing;
    const pending = persistPocCase("SAVE_RESEARCH", {
      caseId: demoCase.demoCaseId,
      idempotencyKey: `research:${signature}`,
      payload: { draft, demoCase, researchResult },
      actorType: "ANALYST",
    });
    durableResearchSaves.current.set(signature, pending);
    pending.catch(() => {
      if (durableResearchSaves.current.get(signature) === pending) durableResearchSaves.current.delete(signature);
    });
    return pending;
  };
  useEffect(() => {
    if (!demoCase?.demoCaseId || !researchResult || researchResult.status === "LOADING") return;
    saveResearchDurably().catch((cause) => {
      setReplayLibraryStatus({ kind: "error", message: `${cause.message} This research result is not yet durably attached to the case.` });
    });
  }, [demoCase, draft, researchResult]); // eslint-disable-line react-hooks/exhaustive-deps
  // The customer's progress, as the server holds it, while an analyst page is
  // open. (This used to wait for a browser-storage event, which nothing has
  // sent since the case moved to the server - UBO-22.) Only the customer's
  // trace is taken; the analyst's own state on the page is left alone.
  const casePathOpen = isDemoResearchPath(pathname) || isDemoReviewPath(pathname) || isDemoAuditPath(pathname);
  const researchReady = Boolean(researchResult) && researchResult.status !== "LOADING";
  useEffect(() => {
    const caseId = demoCase?.demoCaseId;
    if (!caseId || !casePathOpen || !researchReady) return undefined;
    let active = true;
    const refresh = async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const record = await loadPocCase(caseId);
        const trace = record?.projection?.assessment?.trace || record?.projection?.resolution?.trace || null;
        if (!active || !trace) return;
        setResearchResult((current) => (current && current.status !== "LOADING"
          && JSON.stringify(current.ownershipResolutionTrace || null) !== JSON.stringify(trace)
          ? { ...current, ownershipResolutionTrace: trace } : current));
      } catch (_) { /* The next refresh tries again; the page keeps what it has. */ }
    };
    const timer = setInterval(refresh, CUSTOMER_PROGRESS_REFRESH_MS);
    return () => { active = false; clearInterval(timer); };
  }, [demoCase?.demoCaseId, casePathOpen, researchReady]);
  useEffect(() => {
    if (!isDemoResearchPath(pathname) || !demoCase || researchResult?.status !== "LOADING") return undefined;
    let subscribed = true;
    const sourceMode = demoCase.analysisContext?.sourceMode || draft.sourceMode;
    // A usable result names the company as the registry records it: the case
    // takes that name (what was typed is kept), before any chart is read.
    const takeResearch = (result) => {
      const adopted = adoptRegistryName({ demoCase, draft, researchResult: result });
      if (adopted) {
        setDemoCase(adopted.demoCase);
        setDraft(adopted.draft);
        persistPocCase("UPSERT_CASE", { caseId: adopted.demoCase.demoCaseId, idempotencyKey: `case-registry-name:${adopted.demoCase.demoCaseId}:${smallStableHash(adopted.demoCase.company.legalName)}`, payload: { draft: adopted.draft, demoCase: adopted.demoCase }, actorType: "ANALYST" })
          .catch((cause) => setReplayLibraryStatus({ kind: "error", message: `${cause.message} The registry's company name could not be saved to the case.` }));
      }
      setResearchResult(result);
    };
    if (sourceMode === "SAVED") {
      // The research another case of this workspace already holds, read back
      // from the server: no provider call. Only the research comes across -
      // that case's customer answers and the analyst's choices on it do not.
      loadPocCase(draft.savedCaseId).then((record) => {
        if (!subscribed) return;
        const saved = record?.projection?.researchResult;
        if (!saved) throw new Error("That saved research is no longer available.");
        const { ownershipResolutionTrace: _trace, analystCustomerRequests: _requests, investigationTopicActivations: _topics, ...research } = saved;
        takeResearch({ ...research, sourceMode: "SAVED", savedFrom: { caseId: draft.savedCaseId, loadedAt: new Date().toISOString() } });
      }).catch((cause) => {
        if (!subscribed) return;
        setResearchError({ message: `${cause.message || "The saved research could not be loaded."} No live search was started.`, code: null });
        setResearchResult(null);
      });
      return () => { subscribed = false; };
    }
    const replayId = demoCase.analysisContext?.replayId || draft.replayId;
    const replayRecord = sourceMode === "REPLAY" ? findReplayById(replays, replayId) : null;
    if (sourceMode === "REPLAY" && !replayRecord) {
      setResearchError({ message: "The selected saved research record is not available on this browser origin. No live search was started.", code: null });
      setResearchResult(null);
      return undefined;
    }
    const lease = acquireDemoResearch(
      { demoCase, sourceMode, replayRecord, demoFixtureId: demoCase.analysisContext?.demoFixtureId },
      { onProgress: (event) => { if (subscribed) setResearchProgress((current) => ({ jobId: event.jobId || current.jobId || lease.jobId, events: [...current.events, event].slice(-8) })); } },
    );
    setResearchProgress({ jobId: lease.jobId, events: [] });
    lease.promise.then((session) => {
      if (!subscribed) return;
      if (sourceMode === "REPLAY") {
        const returned = session?.companyContext || {};
        if (String(returned.registrationNumber || "").trim().toUpperCase() !== demoCase.company.registrationNumber.trim().toUpperCase()
          || String(returned.legalEntityName || "").trim().toUpperCase() !== demoCase.company.legalName.trim().toUpperCase()) {
          throw new TypeError("The saved replay result does not match the selected researched company.");
        }
      }
      const compact = compactResearchResult(session, sourceMode, demoCase.analysisContext?.calculationMethod);
      if (session.replayCapture && compact.status !== "FAILED") {
        try { setReplays(saveLabReplay(session.replayCapture)); setReplayLibraryStatus({ kind: "success", message: "Live research saved locally. Future replay will make no provider call." }); }
        catch (cause) { setReplays((current) => availableLabReplays({ replayCapture: session.replayCapture })); setReplayLibraryStatus({ kind: "error", message: `${cause.message || "The in-page replay copy failed."} The research itself is saved with this case on the server.` }); }
      }
      if (sourceMode === "LIVE" && compact.status === "FAILED") {
        return savedResearchFallback(demoCase.company).then((fallback) => {
          if (!subscribed) return;
          if (!fallback) { setResearchResult(compact); return; }
          setResearchError("");
          takeResearch({ ...fallback.result, status: "PARTIAL", providerOutcomes: compact.providerOutcomes, fallback: { savedAt: fallback.savedAt, reason: "The live providers did not return a usable result." }, completedAt: new Date().toISOString() });
        });
      }
      takeResearch(compact);
      return undefined;
    }).catch((cause) => {
      if (!subscribed || cause.code === "RESEARCH_ABORTED") return;
      // A reached limit is shown as a limit - never papered over with a saved result.
      if (limitNotice(cause.code, cause.message)) {
        setResearchError({ message: cause.message, code: cause.code });
        setResearchResult(null);
        return;
      }
      const message = `${cause.code ? `${cause.code}: ` : ""}${cause.message}`;
      (sourceMode === "LIVE" ? savedResearchFallback(demoCase.company) : Promise.resolve(null)).then((fallback) => {
        if (!subscribed) return;
        if (fallback) {
          setResearchError("");
          takeResearch({ ...fallback.result, status: "PARTIAL", fallback: { savedAt: fallback.savedAt, reason: message }, completedAt: new Date().toISOString() });
        } else {
          setResearchError(message);
          setResearchResult({ status: "FAILED", sourceMode, jobId: lease.jobId, error: message, completedAt: new Date().toISOString() });
        }
      });
    });
    return () => { subscribed = false; lease.release(); };
  }, [pathname, demoCase, researchResult?.status, runToken]); // eslint-disable-line react-hooks/exhaustive-deps
  // A case started from saved research and left before that research reached
  // the server comes back with none. It is read again from the saved case - no
  // provider call - rather than shown as an interrupted live run whose retry
  // would start a paid one (found clicking through, 2026-10-04).
  useEffect(() => {
    if (!isDemoResearchPath(pathname) || !demoCase || researchResult || researchError) return;
    const sourceMode = demoCase.analysisContext?.sourceMode || draft.sourceMode;
    if (sourceMode === "SAVED" && draft.savedCaseId) setResearchResult({ status: "LOADING", sourceMode: "SAVED" });
  }, [pathname, demoCase, researchResult, researchError, draft.sourceMode, draft.savedCaseId]);

  const updateDraft = (field, value) => {
    if (field === "sourceMode" && value === "REPLAY") {
      const record = findReplayById(replays, draft.replayId);
      if (record) {
        try { setDraft(bindDraftToReplay(draft, record)); setErrors((current) => ({ ...current, sourceMode: undefined, replayId: undefined })); return; }
        catch (_) { /* Preserve the selected capture and show the precise error on replay. */ }
      }
    }
    setDraft((current) => ({ ...current, [field]: value })); setErrors((current) => ({ ...current, [field]: undefined }));
  };
  // When live research fails: this workspace's newest saved research for the
  // same company (registration number and country), read from the server -
  // it survives a reload, another browser and another day. Only the research
  // comes across, not that case's customer answers or analyst choices.
  const savedResearchFallback = async (company) => {
    try {
      const key = customerCompanyKey(company);
      const match = (await listSavedResearch()).find((item) => customerCompanyKey(item.company) === key);
      if (!match) return null;
      const saved = (await loadPocCase(match.caseId))?.projection?.researchResult;
      if (!saved) return null;
      const { ownershipResolutionTrace: _trace, analystCustomerRequests: _requests, investigationTopicActivations: _topics, ...research } = saved;
      return { result: research, savedAt: match.researchedAt };
    } catch (_) {
      return null;
    }
  };
  const continueNewCase = async ({ withdraw }) => {
    const notice = newCaseNotice;
    if (!notice) return;
    if (withdraw) {
      setNewCaseNotice({ ...notice, busy: true, error: null });
      try { await withdrawCustomerLinks(notice.fromCaseId); }
      catch (cause) { setNewCaseNotice({ ...notice, busy: false, error: `${cause.message || "The link could not be withdrawn."} Nothing was changed.` }); return; }
      setLinkNotice(`The customer link for ${notice.fromCompany} was withdrawn, and the customer's open session ended. Send them a new link for this case below.`);
    } else {
      setLinkNotice(null);
    }
    await startResearch(null, { confirmedCaseId: notice.fromCaseId });
  };
  const caseFinalized = () => Boolean(researchResult?.ownershipResolutionTrace?.verificationAssessment?.finalized);
  // The current case, re-run: its id stays (a link sent points at it), each
  // run gets its own research job id (they defaulted to the case id).
  const continuingCase = (candidate) => ({
    ...candidate,
    demoCaseId: demoCase.demoCaseId,
    analysisContext: { ...(candidate.analysisContext || {}), researchJobId: `${demoCase.demoCaseId}:run-${Date.now().toString(36)}` },
  });
  const startResearch = async (event, { confirmedCaseId = null } = {}) => {
    event?.preventDefault?.();
    let cleanDraft = { ...draft, demoFixtureId: "" };
    const next = {};
    if (cleanDraft.sourceMode === "SAVED") {
      const saved = savedResearch.find(({ caseId }) => caseId === cleanDraft.savedCaseId);
      if (!saved) next.savedCaseId = "Choose saved research. No live search will be used.";
      else cleanDraft = { ...cleanDraft, legalName: saved.company.legalName, registrationNumber: saved.company.registrationNumber, countryCode: saved.company.countryCode || cleanDraft.countryCode };
    }
    if (cleanDraft.sourceMode === "REPLAY") {
      const record = findReplayById(replays, cleanDraft.replayId);
      if (!record) next.replayId = "Choose an available saved research result. No live search will be used.";
      else {
        try { cleanDraft = bindDraftToReplay(cleanDraft, record); }
        catch (cause) { next.replayId = cause.message; }
      }
    }
    Object.assign(next, validateDemoDraft(cleanDraft));
    setErrors(next);
    if (Object.keys(next).length) return;
    const candidate = createDemoCase(cleanDraft);
    // Same registration number and country: the same company (a corrected
    // name, a different method) - its case continues, and a link already sent
    // keeps pointing at the case being worked on.
    const sameCompany = Boolean(demoCase?.demoCaseId) && customerCompanyKey(demoCase.company) === customerCompanyKey(candidate.company);
    if (sameCompany && caseFinalized()) {
      setReplayLibraryStatus({ kind: "error", message: "This review has been finalised, so its research and company cannot be changed. Reopen the review first (on the Review page)." });
      return;
    }
    // A different company is a new case. If a customer may already be working
    // on the current one, say so once before leaving it behind.
    if (!sameCompany && demoCase?.demoCaseId && confirmedCaseId !== demoCase.demoCaseId) {
      let engagement = null;
      try { engagement = await customerEngagement(demoCase.demoCaseId); } catch (_) { engagement = null; }
      if (!engagement || engagement.linkSent || engagement.customerStarted) {
        setNewCaseNotice({ fromCaseId: demoCase.demoCaseId, fromCompany: demoCase.company.legalName, toCompany: candidate.company.legalName, engagement });
        return;
      }
    }
    setNewCaseNotice(null);
    if (!confirmedCaseId) setLinkNotice(null);
    setReplayLibraryStatus(null);
    setDraft(cleanDraft);
    const nextCase = sameCompany ? continuingCase(candidate) : candidate;
    persistPocCase("UPSERT_CASE", { caseId: nextCase.demoCaseId, idempotencyKey: sameCompany ? `case-updated:${nextCase.demoCaseId}:${smallStableHash([nextCase.company, cleanDraft])}` : `case-created:${nextCase.demoCaseId}`, payload: { draft: cleanDraft, demoCase: nextCase }, actorType: "ANALYST" }).catch((cause) => {
      setReplayLibraryStatus({ kind: "error", message: `${cause.message} Research was not started because the case could not be saved.` });
    });
    abortActiveDemoResearchJobs();
    setDemoCase(nextCase); setResearchError(""); setResearchResult({ status: "LOADING", sourceMode: cleanDraft.sourceMode }); navigateDemo(DEMO_RESEARCH_PATH);
  };
  const loadCalculationExample = (fixtureId) => {
    const alice = fixtureId === DEMO_CALCULATION_FIXTURES.ALICE_28;
    const nextDraft = { ...draft, legalName: alice ? "Example Trading Ltd" : "V2 Review Customer Limited", registrationNumber: alice ? "DEMO0028" : "DEMO6040", countryCode: "GB", ownershipType: "PRIVATE_LIMITED", sourceMode: "FIXTURE", replayId: "", calculationMethod: "EFFECTIVE_INTEREST", demoFixtureId: fixtureId };
    abortActiveDemoResearchJobs();
    setDraft(nextDraft); setDemoCase(createDemoCase(nextDraft)); setErrors({}); setResearchError(""); setResearchResult({ status: "LOADING", sourceMode: "FIXTURE" }); navigateDemo(DEMO_RESEARCH_PATH);
  };
  const changeCalculationMethod = (calculationMethod) => {
    setDraft((current) => ({ ...current, calculationMethod }));
    setDemoCase((current) => current ? ({ ...current, analysisContext: { ...(current.analysisContext || {}), calculationMethod } }) : current);
    setResearchResult((current) => current ? ({ ...current, analysisContext: { ...(current.analysisContext || {}), calculationMethod } }) : current);
  };
  const toggleCustomerRequest = (item) => {
    setResearchResult((current) => {
      if (!current) return current;
      const requests = current.analystCustomerRequests || [];
      const existing = requests.some(({ informationNeedId }) => informationNeedId === item.needId);
      const next = existing ? requests.filter(({ informationNeedId }) => informationNeedId !== item.needId) : [...requests, {
        contractVersion: "ubo-demo-analyst-customer-request-v1",
        requestId: `analyst-customer-request:${item.needId}`,
        informationNeedId: item.needId,
        title: item.title,
        question: item.missing,
        scope: item.scope,
        about: item.about,
        requirementIds: item.requirementIds,
        selectedAt: new Date().toISOString(),
      }];
      return { ...current, analystCustomerRequests: next };
    });
  };
  const activateTopic = (topicCode, wordingOverride) => {
    setResearchResult((current) => {
      if (!current) return current;
      const existing = current.investigationTopicActivations || [];
      if (existing.some((item) => item.topicCode === topicCode && item.status === "ACTIVE")) return current;
      const activation = createTopicActivation({ topicCode, caseId: demoCase.demoCaseId, analystReason: "Selected by analyst for customer investigation" });
      return { ...current, investigationTopicActivations: [...existing, { ...activation, ...(wordingOverride ? { wordingOverride } : {}) }] };
    });
  };
  const cancelTopic = (activationId) => setResearchResult((current) => current ? ({
    ...current,
    investigationTopicActivations: (current.investigationTopicActivations || []).map((item) => item.id === activationId ? { ...item, status: "CANCELLED", cancelledAt: new Date().toISOString() } : item),
  }) : current);
  const runAgain = (mode = draft.sourceMode) => {
    let nextDraft = { ...draft, sourceMode: mode };
    if (mode === "REPLAY") {
      const available = replays.length ? replays : readLabReplays();
      const record = findReplayById(available, nextDraft.replayId) || available[0] || null;
      if (!record) { setResearchError({ message: "The selected saved research record is not available on this browser origin. No live search was started.", code: null }); setResearchResult(null); return; }
      try { nextDraft = bindDraftToReplay(nextDraft, record); }
      catch (cause) { setResearchError({ message: `${cause.message} No live search was started.`, code: null }); setResearchResult(null); return; }
    }
    // The same case: a customer link already sent points at it (UBO-57).
    if (demoCase && caseFinalized()) {
      setReplayLibraryStatus({ kind: "error", message: "This review has been finalised, so its research cannot be replaced. Reopen the review first (on the Review page), then run the research again." });
      return;
    }
    const nextCase = demoCase?.demoCaseId ? continuingCase(createDemoCase(nextDraft)) : createDemoCase(nextDraft);
    abortActiveDemoResearchJobs();
    setReplayLibraryStatus(null);
    setDraft(nextDraft); setDemoCase(nextCase); setResearchError(""); setResearchResult({ status: "LOADING", sourceMode: mode }); setRunToken((n) => n + 1);
  };
  const startNewCase = () => { abortActiveDemoResearchJobs(); skipNextSave.current = true; clearActivePocCase(); clearDemoSession(); setDraft(emptyDemoDraft()); setDemoCase(null); setResearchResult(null); setErrors({}); navigateDemo(DEMO_START_PATH, { replace: true }); };
  const edit = () => navigateDemo(DEMO_START_PATH);
  // The same readiness check as the hand-off: the case is saved first, and no
  // link while research could still change who needs identity verification.
  const prepareCustomerLink = async () => {
    const saved = await saveResearchDurably();
    if (!saved.researchRelease?.mayProceed) throw new Error(saved.researchRelease?.reason || "Discovery is still in progress because unresolved research could change who requires identity verification.");
  };
  const switchToCustomerView = async () => {
    // Opened now, while this is still the click: after the save below the
    // browser blocked it as an unrequested pop-up (found clicking through).
    let openedWindow = null;
    try { openedWindow = window.open("", "ubo-demo-customer-view"); } catch (_) { openedWindow = null; }
    try {
      setCustomerSwitchState({ kind: "pending", message: "Opening the customer view and transferring this case…" });
      const saved = await saveResearchDurably();
      if (!saved.researchRelease?.mayProceed) throw new Error(saved.researchRelease?.reason || "Discovery is still in progress because unresolved research could change who requires identity verification.");
      await openCustomerViewHandoff(buildCustomerHandoff({ draft, demoCase, researchResult }), { openedWindow });
      setCustomerSwitchState({ kind: "accepted", message: "Customer view opened with this case and all research assertions." });
    } catch (cause) {
      // Still blank (nothing was sent to it): close it rather than leave an empty window.
      try { if (openedWindow && !openedWindow.closed && openedWindow.location.href === "about:blank") openedWindow.close(); } catch (_) { /* Another origin now: leave it. */ }
      setCustomerSwitchState({ kind: "error", message: cause.message || "The customer view could not be opened." });
    }
  };
  const research = isDemoResearchPath(pathname);
  const review = isDemoReviewPath(pathname);
  const audit = isDemoAuditPath(pathname);
  const analystResultPath = research || review || audit;

  let content;
  if (!analystResultPath) content = <CompanyStart draft={draft} errors={errors} newCaseNotice={newCaseNotice} onNewCaseContinue={continueNewCase} onNewCaseCancel={() => setNewCaseNotice(null)} savedResearch={savedResearch} onChange={updateDraft} onSavedSelect={(caseId) => {
    const saved = savedResearch.find((item) => item.caseId === caseId);
    setDraft((current) => ({ ...current, savedCaseId: caseId, ...(saved ? { legalName: saved.company.legalName, registrationNumber: saved.company.registrationNumber, countryCode: saved.company.countryCode || current.countryCode } : {}) }));
    setErrors((current) => ({ ...current, savedCaseId: undefined }));
  }} onSubmit={startResearch} onLoadExample={loadCalculationExample} />;
  else if (!demoCase) content = <main className="ubo-demo-main ubo-demo-empty"><h1>Start with company details</h1><button className="ubo-demo-primary" onClick={edit}>Enter company details</button></main>;
  else if (review && researchResult?.status !== "LOADING") content = <AnalystResolutionView mode="REVIEW" demoCase={demoCase} result={researchResult} />;
  else if (audit && researchResult?.status !== "LOADING") content = <AnalystResolutionView mode="AUDIT" demoCase={demoCase} result={researchResult} />;
  else if (researchResult?.status === "LOADING") content = <ResearchProgress company={demoCase.company} progress={researchProgress} />;
  else if (researchResult?.status === "FAILED" || researchError) content = <ResearchError error={researchError || researchResult?.error || "Research failed."} result={researchResult} replays={replays} onRetry={() => runAgain("LIVE")} onReplay={() => runAgain("REPLAY")} onEdit={edit} />;
  else if (researchResult) content = <ResearchResult demoCase={demoCase} result={researchResult} linkNotice={linkNotice} onEdit={edit} onRetry={() => runAgain()} onSwitchCustomer={switchToCustomerView} customerSwitchState={customerSwitchState} prepareCustomerLink={prepareCustomerLink} onCalculationMethodChange={changeCalculationMethod} onToggleCustomerRequest={toggleCustomerRequest} onActivateTopic={activateTopic} onCancelTopic={cancelTopic} onDisplayChange={(change) => setResearchResult((current) => ({ ...current, displayState: { scope: current.displayState?.scope || DEMO_GRAPH_SCOPES.RELEVANT, dimension: current.displayState?.dimension || DEMO_GRAPH_DIMENSIONS.ALL, ...change } }))} />;
  // Research is saved to the case only when it finishes, so a reload during
  // a run lands here with nothing running: say so, rather than spin forever.
  else content = <ResearchError error="This research did not finish - the page was reloaded or closed while it was running. Running it again reuses the server's saved result if it completed; otherwise it is a new research run." result={null} replays={replays} onRetry={() => runAgain("LIVE")} onReplay={() => runAgain("REPLAY")} onEdit={edit} />;
  // A failure to save the case or its research must be seen where it happens,
  // not only on the start page.
  const caseAlert = replayLibraryStatus?.kind === "error" ? <p role="alert" className="ubo-demo-case-alert">{replayLibraryStatus.message}</p> : null;
  return <div className="ubo-demo-page"><DemoHeader onStartNew={startNewCase} /><DemoProgress pathname={pathname} />{caseAlert}{content}{audit && demoCase?.demoCaseId && <CaseLedger caseId={demoCase.demoCaseId} />}{audit && <JobsNeedingAttention />}<DemoFooter pathname={pathname} /></div>;
}
