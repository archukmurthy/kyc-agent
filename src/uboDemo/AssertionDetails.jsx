import React, { useState } from "react";
import { groupAssertionRows, presentCandidateFacts } from "./assertionPresentation";

function AssertionCard({ row, index }) {
  return <article>
    <span>{row.category}</span><p><strong>{row.title}</strong></p><p>{row.valueText}</p>
    <small>{String(row.currentness).replaceAll("_", " ")} · {String(row.supportState).replaceAll("_", " ")} · Candidate/source assertion · not approved</small>
    <dl className="ubo-customer-assertion-detail">
      {row.relationship && <><dt>Owner / source party</dt><dd>{row.subject?.name || "Not supplied"}</dd><dt>Relationship</dt><dd>{String(row.relationship).replaceAll("_", " ")}</dd><dt>Owned entity / target</dt><dd>{row.object?.name || "Not supplied"}</dd><dt>Measurement type</dt><dd>{String(row.measurementType).replaceAll("_", " ")}</dd></>}
      {(row.effectiveFrom || row.effectiveTo) && <><dt>Effective period</dt><dd>{row.effectiveFrom || "Not supplied"} to {row.effectiveTo || "open"}</dd></>}
      <dt>Source status</dt><dd>{row.sourceState}</dd>
      {row.evidence.map((evidence, evidenceIndex) => <React.Fragment key={`${evidence.referenceId || evidence.artifactId || evidenceIndex}`}>
        <dt>Support reference</dt><dd>{[evidence.system, evidence.referenceType, evidence.referenceId, evidence.artifactId, evidence.digest && `digest ${evidence.digest}`, evidence.runId && `run ${evidence.runId}`, evidence.locator, evidence.excerpt].filter(Boolean).join(" · ")}</dd>
      </React.Fragment>)}
      {row.issues.map((issue, issueIndex) => <React.Fragment key={issue.issueId || issueIndex}><dt>Limitation</dt><dd>{issue.code || issue.issueType || "Source limitation"}: {issue.message || issue.detail || "Review required"}</dd></React.Fragment>)}
    </dl>
    {row.observations?.length > 1 && <details className="ubo-demo-source-observations"><summary>Source observations ({row.observations.length})</summary>
      <ul>{row.observations.map((observation, observationIndex) => <li key={`${observation.factId || index}:${observationIndex}`}>{observation.valueText} · {observation.evidence.map((item) => item.referenceId || item.artifactId || item.system).filter(Boolean).join(" · ") || observation.sourceState}</li>)}</ul>
    </details>}
  </article>;
}

export default function AssertionDetails({ entries, eyebrow = "Source assertions", title = "Research assertions and source facts", open = false, sourceNotice, variant = "analyst", collapseButton = false }) {
  const rows = presentCandidateFacts(entries);
  const groups = groupAssertionRows(entries, { variant });
  const [expanded, setExpanded] = useState(open);
  const content = <>
    {sourceNotice && <p className="ubo-customer-source-notice">{sourceNotice}</p>}
    <div className="ubo-demo-assertion-groups">{groups.map((group) => <section key={group.label} className="ubo-demo-assertion-group">
      <header><h3>{group.label}</h3><span>{group.rows.length}</span></header>
      <div className="ubo-demo-assertion-list">{group.rows.map((row, index) => <AssertionCard key={row.factId || index} row={row} index={index} />)}</div>
    </section>)}</div>
  </>;
  if (collapseButton) return <section className="ubo-customer-card ubo-customer-assertions ubo-demo-assertions">
    <div className="ubo-demo-assertion-heading"><div><small>{eyebrow}</small><strong>{title}</strong><span>{rows.length} assertions</span></div><button type="button" aria-expanded={expanded} aria-controls="demo-assertions-content" onClick={() => setExpanded((value) => !value)}>{expanded ? "Collapse" : "Expand"}</button></div>
    {expanded && <div id="demo-assertions-content">{content}</div>}
  </section>;
  return <details className="ubo-customer-card ubo-customer-assertions ubo-demo-assertions" open={open}>
    <summary><div><small>{eyebrow}</small><strong>{title}</strong></div><span>{rows.length} assertions · click to inspect</span></summary>
    {content}
  </details>;
}
