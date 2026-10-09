import React, { useEffect, useState } from "react";
import { clerkAuthHeaders } from "../auth/clerkFetch";
import { loadPocCase, persistPocCase } from "./pocCaseClient";

// Owner decision 2026-10-08 (option b): a case started from saved research
// can take the ownership chart already read on the case it came from, instead
// of the customer uploading it again - a new reading each time, paid. The
// server copies the reading to this case; nothing is read again.

export default function ReuseEarlierChart({ demoCase, savedFrom, reload = () => window.location.reload() }) {
  const [source, setSource] = useState(null);
  const [state, setState] = useState({ phase: "IDLE", message: "" });
  const caseId = demoCase?.demoCaseId;
  const sourceCaseId = savedFrom?.caseId;

  useEffect(() => {
    if (!caseId || !sourceCaseId || sourceCaseId === caseId) return undefined;
    let live = true;
    (async () => {
      try {
        const [current, earlier] = await Promise.all([loadPocCase(caseId), loadPocCase(sourceCaseId)]);
        if (current?.projection?.chartReference?.jobId) return; // this case has its chart
        const reference = earlier?.projection?.chartReference;
        if (live && reference?.jobId) setSource(reference);
      } catch (_) { /* Nothing to offer; the customer uploads as usual. */ }
    })();
    return () => { live = false; };
  }, [caseId, sourceCaseId]);

  if (!source) return null;
  const reuse = async () => {
    setState({ phase: "SAVING", message: "" });
    try {
      const response = await fetch("/api/ubo-demo-customer-ownership-chart", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await clerkAuthHeaders()) },
        body: JSON.stringify({ operation: "REUSE_CHART_READING", sourceJobId: source.jobId, demoContext: { demoCaseId: caseId, company: demoCase.company } }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.success) throw new Error(payload.message || "The earlier chart could not be used for this case.");
      const job = payload.job;
      await persistPocCase("ASSOCIATE_CHART", {
        caseId,
        actorType: "ANALYST",
        idempotencyKey: `chart-reuse:${job.jobId}`,
        payload: { chartReference: { jobId: job.jobId, artifactId: job.artifactId, calculationMethod: source.calculationMethod } },
      });
      reload();
    } catch (caught) {
      setState({ phase: "IDLE", message: caught.message });
    }
  };
  return <section className="ubo-demo-card ubo-demo-reuse-chart" aria-label="Earlier ownership chart">
    <h2>Ownership chart already read</h2>
    <p>The case this research came from has an ownership chart that was read. Use it for this case, so the customer does not upload it again. Nothing is read again or charged.</p>
    <button type="button" className="ubo-demo-primary" onClick={reuse} disabled={state.phase === "SAVING"}>{state.phase === "SAVING" ? "Using the earlier chart…" : "Use the earlier chart"}</button>
    {state.message && <p role="alert">{state.message}</p>}
  </section>;
}
