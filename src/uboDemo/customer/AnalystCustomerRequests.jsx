import React from "react";

export default function AnalystCustomerRequests({ requests = [] }) {
  if (!requests.length) return null;
  return <aside className="ubo-customer-analyst-requests" aria-label="Questions from your analyst">
    <div><small>Requested by your analyst</small><h2>Questions to help complete this review</h2><p>These questions were selected from the existing ownership review and arrived with the source assertions for this case.</p></div>
    <div>{requests.map((request) => <article key={request.requestId}>
      <span>Question</span><h3>{request.title}</h3><p>{request.question}</p>
      {request.about?.length > 0 && <small>About: {request.about.map(({ legalName }) => legalName).filter(Boolean).join(", ")}</small>}
    </article>)}</div>
  </aside>;
}
