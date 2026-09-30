import React, { useCallback, useEffect, useState } from "react";
import { clerkAuthHeaders } from "../auth/clerkFetch";

// UBO-35: the workspace's chart and evidence readings that failed or stopped
// moving, for support to see and retry. The server lists them for staff only.

const ROUTE = "/api/ubo-demo-customer-ownership-chart";
const TERMINAL = new Set(["COMPLETE", "PARTIAL", "FAILED"]);

async function call(body, fetchImpl) {
  const response = await fetchImpl(ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", ...(await clerkAuthHeaders()) },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) throw new Error(data.message || data.error || "The request was refused.");
  return data;
}

// A failed job is queued again, then read - the same steps the upload screen
// takes. A stuck one is simply picked up again.
async function rerun(item, fetchImpl) {
  if (!item.stuck) await call({ operation: "RETRY_EXTRACTION_JOB", jobId: item.jobId }, fetchImpl);
  let job;
  for (let round = 0; round < 4; round += 1) {
    ({ job } = await call({ operation: "PROCESS_EXTRACTION_JOB", jobId: item.jobId }, fetchImpl));
    if (TERMINAL.has(job?.state)) break;
  }
  return job;
}

export default function JobsNeedingAttention({ fetchImpl = window.fetch }) {
  const [jobs, setJobs] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [outcome, setOutcome] = useState({});

  const load = useCallback(async () => {
    try { setJobs((await call({ operation: "LIST_JOBS_NEEDING_ATTENTION" }, fetchImpl)).jobs || []); setError(""); }
    catch (caught) { setError(caught.message); }
  }, [fetchImpl]);
  useEffect(() => { load(); }, [load]);

  const retry = async (item) => {
    setBusy(item.jobId);
    try {
      const job = await rerun(item, fetchImpl);
      setOutcome((current) => ({ ...current, [item.jobId]: job?.state === "FAILED" ? "Failed again" : `Now ${String(job?.state || "queued").toLowerCase()}` }));
      await load();
    } catch (caught) {
      setOutcome((current) => ({ ...current, [item.jobId]: caught.message }));
    } finally { setBusy(""); }
  };

  if (error) return <section className="ubo-analyst-section"><h2>Document readings needing attention</h2><p role="alert">{error}</p></section>;
  if (!jobs) return null;
  return <section className="ubo-analyst-section"><h2>Document readings needing attention</h2>
    {jobs.length === 0 ? <p>None. Every chart and evidence reading in this workspace finished.</p> : jobs.map((item) => <article className="ubo-analyst-audit-card" key={item.jobId}>
      <h3>{item.company || "Unnamed company"} · {item.kind === "SUPPORTING_EVIDENCE" ? "supporting evidence" : "ownership chart"}</h3>
      <dl><dt>State</dt><dd>{item.stuck ? `Stuck (${item.state.toLowerCase()})` : "Failed"}</dd>
        <dt>Case</dt><dd>{item.caseId}</dd>
        <dt>Attempts</dt><dd>{item.attempts} of {item.maxAttempts}</dd>
        <dt>Reason</dt><dd>{item.reason || item.reasonCode || "Not recorded"}{item.upstreamStatus ? ` (provider ${item.upstreamStatus})` : ""}</dd>
        <dt>Reference</dt><dd>{item.correlationId}</dd>
        <dt>Last change</dt><dd>{item.updatedAt}</dd></dl>
      <p><small>Trying again reads the document again: it counts as one of the demo's chart uploads.</small></p>
      <button type="button" onClick={() => retry(item)} disabled={Boolean(busy)}>{busy === item.jobId ? "Trying again…" : "Try again"}</button>
      {outcome[item.jobId] && <p role="status">{outcome[item.jobId]}</p>}
    </article>)}
  </section>;
}
