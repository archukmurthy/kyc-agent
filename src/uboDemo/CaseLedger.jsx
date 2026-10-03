import React, { useEffect, useState } from "react";
import { clerkAuthHeaders } from "../auth/clerkFetch";

// UBO-33: the case's audit ledger, oldest first - what happened, who did it,
// and when it happened, arrived and was recorded. Staff only; the server
// answers a customer with not-found.

function humanize(value) { return String(value || "").replaceAll("_", " ").toLowerCase(); }

export default function CaseLedger({ caseId, fetchImpl = window.fetch }) {
  const [events, setEvents] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!caseId) return undefined;
    let live = true;
    (async () => {
      try {
        const response = await fetchImpl(`/api/ubo-poc-case?caseId=${encodeURIComponent(caseId)}&ledger=1`, { headers: { Accept: "application/json", ...(await clerkAuthHeaders()) } });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.success === false) throw new Error(data.message || "The case history could not be loaded.");
        if (live) setEvents(data.events || []);
      } catch (caught) { if (live) setError(caught.message); }
    })();
    return () => { live = false; };
  }, [caseId, fetchImpl]);

  const when = (iso) => {
    if (!iso) return "-";
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? iso : <time dateTime={iso} title={iso}>{date.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "medium" })}</time>;
  };
  return <section className="ubo-analyst-section"><h2>Case ledger</h2>
    <p>Every step on this case, as recorded. Nothing here can be changed or removed.</p>
    {error && <p role="alert">{error}</p>}
    {events && events.length === 0 && <p>Nothing has been recorded on this case yet.</p>}
    {events && events.map((event) => <article className="ubo-analyst-audit-card" key={event.eventId}>
      <h3>{humanize(event.eventType)}</h3>
      <dl>
        <dt>By</dt><dd>{humanize(event.actorType)}</dd>
        <dt>Happened</dt><dd>{when(event.occurredAt)}</dd>
        <dt>Received</dt><dd>{when(event.receivedAt)}</dd>
        <dt>Recorded</dt><dd>{when(event.recordedAt)}</dd>
        {event.effectiveAt && <><dt>Takes effect</dt><dd>{when(event.effectiveAt)}</dd></>}
        {event.reasonCode && <><dt>Reason</dt><dd>{humanize(event.reasonCode)}</dd></>}
        {event.relatedQuestionId && <><dt>Question</dt><dd>{event.relatedQuestionId}</dd></>}
        {event.relatedArtifactId && <><dt>Document</dt><dd>{event.relatedArtifactId}</dd></>}
        {event.relatedAssessmentId && <><dt>Assessment</dt><dd>{event.relatedAssessmentId}</dd></>}
        <dt>Reference</dt><dd>{event.correlationId}</dd>
      </dl>
    </article>)}
  </section>;
}
