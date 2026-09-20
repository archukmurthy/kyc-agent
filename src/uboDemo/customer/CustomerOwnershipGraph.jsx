import React, { useCallback, useEffect, useRef, useState } from "react";

export default function CustomerOwnershipGraph({ projection, entityLabels = {} }) {
  const frame = useRef(null);
  const [expanded, setExpanded] = useState(true);
  const send = useCallback(() => {
    if (!projection) return;
    frame.current?.contentWindow?.postMessage({
      type: "ubo-demo-graph-projection-v1",
      projection,
      entityLabels,
      viewportHeight: Math.max(560, Math.min(780, 420 + (Math.ceil((projection.nodes?.length || 1) / 3) * 80))),
    }, window.location.origin);
  }, [projection, entityLabels]);

  useEffect(() => {
    send();
    window.addEventListener("resize", send);
    return () => window.removeEventListener("resize", send);
  }, [send]);

  if (!projection) return null;
  return <section className="ubo-customer-card ubo-customer-graph-card">
    <header>
      <div><small>Source interpretation</small><h2>How we understood your chart</h2></div>
      <div className="ubo-customer-heading-actions"><span>Ownership · Voting · Control</span><button className="ubo-customer-collapse-button" type="button" aria-expanded={expanded} aria-controls="ubo-customer-graph-content" onClick={() => setExpanded((value) => !value)}>{expanded ? "Collapse" : "Expand"}</button></div>
    </header>
    {expanded && <div id="ubo-customer-graph-content"><p className="ubo-customer-graph-intro">This visual uses the existing ownership-graph projection for the supported chart facts. Select an entity or relationship to inspect the recorded context.</p>
      <iframe ref={frame} onLoad={send} title="Visualised ownership structure" src="/ubo-demo-graph.html" />
      <p className="ubo-customer-graph-note">Candidate identity, currentness and UBO status have not been independently verified by this chart analysis.</p></div>}
  </section>;
}
