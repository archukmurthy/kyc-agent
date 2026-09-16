import React, { useMemo, useState } from "react";
import { allCandidateFacts } from "../demoResearch";
import { formatAssertionMeasurement } from "../assertionPresentation";
import { buildChartResearchComparison } from "./chartComparison";

function factSide(fact, empty) {
  if (!fact) return <span className="ubo-customer-comparison-missing">{empty}</span>;
  return <><strong>{fact.subject?.name || "Source party"} → {fact.object?.name || "Target party"}</strong><span>{formatAssertionMeasurement(fact.measurement)}</span><small>{fact.evidenceReferences?.[0]?.referenceId || "Source reference retained"}</small></>;
}

export default function ChartResearchComparison({ researchResult, chartFacts }) {
  const [visible, setVisible] = useState(false);
  const [needsAttention, setNeedsAttention] = useState(false);
  const researchEntries = useMemo(() => allCandidateFacts(researchResult), [researchResult]);
  const verifiedResearchReferenceIds = useMemo(() => new Set((researchResult?.view?.evidence?.percentageAssessments || [])
    .filter((assessment) => (assessment.evidenceStates || []).includes("EXACT_VALUE_VERIFIED"))
    .flatMap((assessment) => (assessment.exactSources || []).flatMap((source) => [source.evidenceReference?.referenceId, source.evidenceReference?.artifactId]).filter(Boolean))), [researchResult]);
  const rows = useMemo(() => buildChartResearchComparison(researchEntries, chartFacts || [], { verifiedResearchReferenceIds }), [researchEntries, chartFacts, verifiedResearchReferenceIds]);
  if (!researchEntries.length) return <section className="ubo-customer-card ubo-customer-comparison"><header><div><small>Read-only comparison</small><h2>No research result available to compare</h2></div></header><p>The uploaded chart remains a separate candidate source. No registry corroboration has been inferred.</p></section>;
  const displayed = needsAttention ? rows.filter((row) => !["VALUES_MATCH_UNVERIFIED", "RANGE_CONSISTENT", "RANGES_OVERLAP"].includes(row.status)) : rows;
  return <section className="ubo-customer-card ubo-customer-comparison">
    <header><div><small>Separate source datasets</small><h2>Uploaded chart compared with saved research</h2></div><button type="button" onClick={() => setVisible((value) => !value)}>{visible ? "Hide comparison" : "Compare with research"}</button></header>
    <p>This is a read-only consistency check. It does not merge facts, approve identities or replace independent verification.</p>
    {visible && <><label className="ubo-customer-attention-filter"><input type="checkbox" checked={needsAttention} onChange={(event) => setNeedsAttention(event.target.checked)} />Show needs attention only</label>
      <div className="ubo-customer-comparison-grid"><div className="head">Saved research</div><div className="head">Uploaded chart</div><div className="head">Assessment</div>
        {displayed.map((row) => <React.Fragment key={row.key}><div>{factSide(row.researchFact, "Not in saved research")}</div><div>{factSide(row.chartFact, "Not in chart")}</div><div><strong>{String(row.concept || "Fact").replaceAll("_", " ")}</strong><span className={`ubo-customer-comparison-status ${row.status.toLowerCase()}`}>{row.label}</span></div></React.Fragment>)}
      </div>
    </>}
  </section>;
}
