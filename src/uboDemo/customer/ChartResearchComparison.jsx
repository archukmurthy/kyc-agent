import React, { useEffect, useMemo, useRef, useState } from "react";
import { allCandidateFacts } from "../demoResearch";
import { formatAssertionMeasurement } from "../assertionPresentation";
import { buildChartResearchComparison, buildChartResearchIdentityCandidates, filterComparisonEntriesRelevantToCustomer, summarizeOwnershipComparison } from "./chartComparison";

const IDENTITY_CACHE_KEY = "ubo-control-demo.cross-source-party-resolution.v1";

function readIdentityCache() {
  try {
    const stored = JSON.parse(window.localStorage.getItem(IDENTITY_CACHE_KEY) || "[]");
    return Array.isArray(stored) ? stored : [];
  } catch (_) { return []; }
}

function writeIdentityCache(matches) {
  try { window.localStorage.setItem(IDENTITY_CACHE_KEY, JSON.stringify(matches.slice(-100))); } catch (_) { /* Comparison remains usable without cache. */ }
}

function factReference(fact, source) {
  const reference = fact?.evidenceReferences?.[0];
  return reference?.artifactId || reference?.referenceId || source?.sourceRecordId || source?.requestId || "Source reference retained";
}

function factSide(fact, source, empty) {
  if (!fact) return <span className="ubo-customer-comparison-missing">{empty}</span>;
  return <><span>{formatAssertionMeasurement(fact.measurement)}</span><small>{factReference(fact, source)}</small></>;
}

function resultDetail(row) {
  return <div className="ubo-customer-comparison-result">
    <span className={`ubo-customer-comparison-status ${row.status.toLowerCase()}`}>{row.label}</span>
    {row.descriptor && <strong>{row.descriptor}</strong>}
    {row.detail && <p>{row.detail}</p>}
    {row.verificationBasis === "INDEPENDENT_RANGE_SUPPORT" && <dl>
      <dt>Customer exact value</dt><dd>{formatAssertionMeasurement(row.chartFact?.measurement)}</dd>
      <dt>Independent registry range</dt><dd>{formatAssertionMeasurement(row.researchFact?.measurement)}</dd>
      <dt>Exact point independently stated by registry</dt><dd>No</dd>
    </dl>}
    {row.verificationBasis && <small>Verification basis: {row.verificationBasis}</small>}
    {row.identityResolutions?.length > 0 && <details className="ubo-customer-identity-resolution">
      <summary>How the parties were matched</summary>
      {row.identityResolutions.map((resolution) => <dl key={resolution.role}>
        <dt>Party role</dt><dd>{resolution.role === "OWNER" ? "Owner" : "Owned entity"}</dd>
        <dt>Method</dt><dd>{resolution.identityResolutionMethod}</dd>
        <dt>Confidence</dt><dd>{Math.round((resolution.confidence || 0) * 100)}%</dd>
        <dt>Analyst / registry name</dt><dd>{resolution.sourcePartyA?.name || "Not stated"}</dd>
        <dt>Customer-chart name</dt><dd>{resolution.sourcePartyB?.name || "Not stated"}</dd>
        <dt>Reasons</dt><dd>{(resolution.reasons || []).join("; ") || "No reason recorded"}</dd>
      </dl>)}
    </details>}
  </div>;
}

export default function ChartResearchComparison({ researchResult, chartFacts, company = null }) {
  const [visible, setVisible] = useState(false);
  const [needsAttention, setNeedsAttention] = useState(false);
  const [aiResolutions, setAiResolutions] = useState(readIdentityCache);
  const [identityCheck, setIdentityCheck] = useState({ state: "IDLE", requestKey: null });
  const attemptedIdentityChecks = useRef(new Set());
  const researchEntries = useMemo(() => filterComparisonEntriesRelevantToCustomer(allCandidateFacts(researchResult), company), [researchResult, company]);
  const chartEntries = useMemo(() => filterComparisonEntriesRelevantToCustomer((chartFacts || []).map((fact) => ({ fact, source: { artifactId: fact.evidenceReferences?.[0]?.artifactId || fact.evidenceReferences?.[0]?.referenceId } })), company), [chartFacts, company]);
  const identityCandidates = useMemo(() => buildChartResearchIdentityCandidates(researchEntries, chartEntries), [researchEntries, chartEntries]);
  const rows = useMemo(() => buildChartResearchComparison(researchEntries, chartEntries, { aiResolutions }), [researchEntries, chartEntries, aiResolutions]);
  const summary = useMemo(() => summarizeOwnershipComparison(rows), [rows]);
  useEffect(() => {
    if (!visible || !identityCandidates.length) return;
    const resolved = new Set(aiResolutions.map(({ candidateId }) => candidateId));
    const pending = identityCandidates.filter(({ candidateId }) => !resolved.has(candidateId));
    const requestKey = pending.map(({ candidateId }) => candidateId).sort().join("|");
    if (!pending.length || attemptedIdentityChecks.current.has(requestKey)) return;
    attemptedIdentityChecks.current.add(requestKey);
    let active = true;
    setIdentityCheck({ state: "CHECKING", requestKey });
    fetch("/api/ubo-demo-entity-resolution", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidates: pending.slice(0, 20) }),
    }).then(async (response) => {
      const payload = await response.json();
      if (!response.ok || !payload.success || payload.result?.decisionScope !== "PARTY_IDENTITY_ONLY") throw new Error(payload.message || "Identity matching is unavailable");
      if (!active) return;
      setAiResolutions((current) => {
        const byId = new Map(current.map((item) => [item.candidateId, item]));
        payload.result.matches.forEach((item) => byId.set(item.candidateId, item));
        const next = [...byId.values()];
        writeIdentityCache(next);
        return next;
      });
      setIdentityCheck({ state: "COMPLETE", requestKey });
    }).catch(() => {
      if (active) setIdentityCheck({ state: "UNAVAILABLE", requestKey });
    });
    return () => { active = false; };
  }, [visible, identityCandidates, aiResolutions]);
  if (!researchEntries.length) return <section className="ubo-customer-card ubo-customer-comparison"><header><div><small>Read-only comparison</small><h2>No research result available to compare</h2></div></header><p>The uploaded chart remains a separate candidate source. No registry corroboration has been inferred.</p></section>;
  const displayed = needsAttention ? rows.filter((row) => row.status !== "INDEPENDENTLY_VERIFIED") : rows;
  return <section className="ubo-customer-card ubo-customer-comparison">
    <header><div><small>Separate source datasets</small><h2>Ownership assertions compared with saved research</h2></div><button type="button" onClick={() => setVisible((value) => !value)}>{visible ? "Hide comparison" : "Compare with research"}</button></header>
    <p>This read-only check compares economic ownership on directed paths to the customer only. Sibling and other off-path facts remain inspectable in the full source graph and source assertions. The comparison does not merge facts, approve identities, treat certification as ownership evidence or replace independent review.</p>
    {visible && <>
      {identityCheck.state === "CHECKING" && <p className="ubo-customer-identity-status" role="status">Checking unresolved party identities using the bounded identity-only matcher…</p>}
      {identityCheck.state === "UNAVAILABLE" && <p className="ubo-customer-identity-status warning" role="status">AI-assisted identity matching is unavailable. Deterministic matches remain applied; unresolved identities still need confirmation.</p>}
      <div className="ubo-customer-comparison-summary">
        <div><strong>{summary.independentlyVerified}</strong><span>Independently verified</span></div>
        <div><strong>{summary.discrepancies}</strong><span>Discrepancies</span></div>
        <div><strong>{summary.needsConfirmation}</strong><span>Needs confirmation</span></div>
      </div>
      <details className="ubo-customer-comparison-breakdown"><summary>How the verified total is composed</summary><p>Exact matches: {summary.exactMatches} · Independent-range support: {summary.independentRangeSupport} · Overlapping independent ranges: {summary.independentRangeOverlap}</p></details>
      <label className="ubo-customer-attention-filter"><input type="checkbox" checked={needsAttention} onChange={(event) => setNeedsAttention(event.target.checked)} />Show needs attention only</label>
      <div className="ubo-customer-comparison-grid">
        <div className="head">Owner</div><div className="head">Owned entity</div><div className="head">Analyst / registry ownership</div><div className="head">Customer chart ownership</div><div className="head">Result</div>
        {displayed.map((row) => <React.Fragment key={row.key}>
          <div><strong>{row.chartFact?.subject?.name || row.researchFact?.subject?.name || "Owner not resolved"}</strong></div>
          <div><strong>{row.chartFact?.object?.name || row.researchFact?.object?.name || "Owned entity not resolved"}</strong></div>
          <div>{factSide(row.researchFact, row.researchSource, "Not in saved research")}</div>
          <div>{factSide(row.chartFact, row.chartSource, "Not in customer chart")}</div>
          <div>{resultDetail(row)}</div>
        </React.Fragment>)}
      </div>
    </>}
  </section>;
}
