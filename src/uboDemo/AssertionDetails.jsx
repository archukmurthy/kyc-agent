import React from "react";
import { presentCandidateFacts } from "./assertionPresentation";

export default function AssertionDetails({ entries, eyebrow = "Source assertions", title = "Research assertions and source facts", open = false, sourceNotice }) {
  const rows = presentCandidateFacts(entries);
  return <details className="ubo-customer-card ubo-customer-assertions ubo-demo-assertions" open={open}>
    <summary><div><small>{eyebrow}</small><strong>{title}</strong></div><span>{rows.length} assertions · click to inspect</span></summary>
    {sourceNotice && <p className="ubo-customer-source-notice">{sourceNotice}</p>}
    <div className="ubo-demo-assertion-list">{rows.map((row, index) => <article key={row.factId || index}>
      <span>{row.category}</span><p><strong>{row.title}</strong></p><p>{row.valueText}</p>
      <small>{String(row.currentness).replaceAll("_", " ")} · {String(row.supportState).replaceAll("_", " ")} · Candidate/source assertion · not approved</small>
      <dl className="ubo-customer-assertion-detail">
        {(row.effectiveFrom || row.effectiveTo) && <><dt>Effective period</dt><dd>{row.effectiveFrom || "Not supplied"} to {row.effectiveTo || "open"}</dd></>}
        <dt>Source status</dt><dd>{row.sourceState}</dd>
        {row.evidence.map((evidence, evidenceIndex) => <React.Fragment key={`${evidence.referenceId || evidence.artifactId || evidenceIndex}`}>
          <dt>Support reference</dt><dd>{[evidence.system, evidence.referenceType, evidence.referenceId, evidence.artifactId, evidence.digest && `digest ${evidence.digest}`, evidence.runId && `run ${evidence.runId}`, evidence.locator, evidence.excerpt].filter(Boolean).join(" · ")}</dd>
        </React.Fragment>)}
        {row.issues.map((issue, issueIndex) => <React.Fragment key={issue.issueId || issueIndex}><dt>Limitation</dt><dd>{issue.code || issue.issueType || "Source limitation"}: {issue.message || issue.detail || "Review required"}</dd></React.Fragment>)}
      </dl>
    </article>)}</div>
  </details>;
}
