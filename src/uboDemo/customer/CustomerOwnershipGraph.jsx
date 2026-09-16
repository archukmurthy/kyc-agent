import React, { useCallback, useEffect, useRef } from "react";

export default function CustomerOwnershipGraph({ projection }) {
  const frame = useRef(null);
  const send = useCallback(() => {
    if (!projection) return;
    frame.current?.contentWindow?.postMessage({
      type: "ubo-demo-graph-projection-v1",
      projection,
      entityLabels: {},
      viewportHeight: Math.max(560, Math.min(780, 420 + (Math.ceil((projection.nodes?.length || 1) / 3) * 80))),
    }, window.location.origin);
  }, [projection]);

  useEffect(() => {
    send();
    window.addEventListener("resize", send);
    return () => window.removeEventListener("resize", send);
  }, [send]);

  if (!projection) return null;
  return <section className="ubo-customer-card ubo-customer-graph-card">
    <header>
      <div><small>Source interpretation</small><h2>How we understood your chart</h2></div>
      <span>Ownership · Voting · Control</span>
    </header>
    <p className="ubo-customer-graph-intro">This visual restates the relationships extracted from your uploaded chart. Select an entity or relationship to inspect what the source stated.</p>
    <iframe ref={frame} onLoad={send} title="Visualised ownership structure" src="/ubo-demo-graph.html" />
    <p className="ubo-customer-graph-note">Same-name entries are grouped for this source visualization only. Identity, currentness and UBO status have not been independently verified.</p>
  </section>;
}
