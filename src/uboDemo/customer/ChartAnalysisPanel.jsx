import React, { useMemo, useState } from "react";
import CustomerOwnershipGraph from "./CustomerOwnershipGraph";
import { CALCULATION_METHODS, calculationPeople } from "../calculationPresentation";
import { formatAssertionMeasurement } from "../assertionPresentation";

function dimensionOf(edge) {
  if (edge.dimension === "ECONOMIC" || /ECONOMIC|OWNERSHIP|SURPLUS_ASSET/.test(edge.relationshipType || "")) return "OWNERSHIP";
  if (edge.dimension === "VOTING" || /VOT/.test(edge.relationshipType || "")) return "VOTING";
  return "CONTROL";
}

function projectGraph(graph, scope, dimension) {
  if (!graph) return graph;
  const relationships = graph.relationships || [];
  const subjectEntityId = graph.subjectEntityId || graph.subject?.entityId;
  const sourceId = (edge) => edge.sourceEntityId || edge.subjectEntityId;
  const targetId = (edge) => edge.targetEntityId || edge.objectEntityId;
  const relevant = new Set([subjectEntityId]);
  const pending = [subjectEntityId];
  while (pending.length) {
    const target = pending.shift();
    relationships.filter((edge) => targetId(edge) === target).forEach((edge) => { const source = sourceId(edge); if (!relevant.has(source)) { relevant.add(source); pending.push(source); } });
  }
  const scoped = relationships.filter((edge) => scope === "FULL" || (relevant.has(sourceId(edge)) && relevant.has(targetId(edge))));
  const visibleRelationships = scoped.filter((edge) => dimension === "ALL" || dimensionOf(edge) === dimension);
  const visibleNodes = new Set([subjectEntityId, ...visibleRelationships.flatMap((edge) => [sourceId(edge), targetId(edge)])]);
  return { ...graph, nodes: (graph.nodes || []).filter((node) => visibleNodes.has(node.entityId)), relationships: visibleRelationships };
}

export default function ChartAnalysisPanel({ analysis, method, onMethodChange, legacyProjection = null, sourceProjection = null }) {
  const view = analysis?.view;
  const [scope, setScope] = useState("RELEVANT");
  const [dimension, setDimension] = useState("ALL");
  const people = useMemo(() => calculationPeople(view, method), [view, method]);
  const operativeGraphEmpty = Boolean(view?.graph && !(view.graph.relationships || []).length && sourceProjection?.relationships?.length);
  const graph = useMemo(() => projectGraph(operativeGraphEmpty ? sourceProjection : view?.graph, scope, dimension), [view?.graph, sourceProjection, operativeGraphEmpty, scope, dimension]);
  if (!view) return <section className="ubo-customer-chart-analysis"><section className="ubo-customer-card ubo-customer-result-card"><header><div><small>Chart-only assessment</small><h2>Review is still required</h2></div></header><p className="ubo-customer-muted">The supported chart facts remain visible below, but the existing engine could not yet create an operative graph safely.</p></section>{legacyProjection && <><p className="ubo-customer-source-notice">This older browser cache contains only the previous source visualization; it does not contain a recorded engine assessment.</p><CustomerOwnershipGraph projection={legacyProjection} /></>}</section>;
  return <section className="ubo-customer-chart-analysis" aria-label="Uploaded chart analysis">
    <header className="ubo-customer-analysis-heading"><div><small>Separate chart-only assessment</small><h2>Based on your uploaded chart — not independently verified</h2></div><span>Provisional demo review</span></header>
    {operativeGraphEmpty && <p className="ubo-customer-source-map-note"><strong>Source assertion map.</strong> The chart relationships remain visible here, but the engine’s operative graph excludes them from calculation because identity, percentage or currentness remains unresolved.</p>}
    <div className="ubo-customer-graph-controls"><fieldset><legend>Graph scope</legend><label><input type="radio" name="chart-graph-scope" checked={scope === "RELEVANT"} onChange={() => setScope("RELEVANT")} />Relevant to customer</label><label><input type="radio" name="chart-graph-scope" checked={scope === "FULL"} onChange={() => setScope("FULL")} />Full source graph</label></fieldset><fieldset><legend>Relationships</legend>{["ALL", "OWNERSHIP", "VOTING", "CONTROL"].map((value) => <label key={value}><input type="radio" name="chart-graph-dimension" checked={dimension === value} onChange={() => setDimension(value)} />{value === "ALL" ? "All" : value[0] + value.slice(1).toLowerCase()}</label>)}</fieldset></div>
    <CustomerOwnershipGraph projection={graph} entityLabels={analysis.entityLabels} />
    <section className="ubo-customer-card ubo-customer-method-card">
      <fieldset><legend>Calculation view</legend>{CALCULATION_METHODS.map((option) => <label key={option.value}><input type="radio" name="chart-calculation-method" value={option.value} checked={method === option.value} onChange={() => onMethodChange(option.value)} />{option.label}</label>)}</fieldset>
      <p>Changing this view does not alter the chart facts, policy result, saved research or immutable assessment.</p>
      {people.length ? <div className="ubo-customer-calculations">{people.map((person) => <article key={person.personEntityId}>
        <header><div><small>{person.personName}</small><h3>{person.selectedResultLabel}</h3></div><span>{person.selectedState}</span></header>
        <p><strong>Overall engine result:</strong> {person.overallPolicyLabel}</p>
        {person.selectedBases.map((basis) => <div key={basis.basisId} className="ubo-customer-basis"><strong>{basis.route.replaceAll("_", " ")} · {basis.dimension?.toLowerCase()}</strong>
          {basis.aggregate && <p>Recorded aggregate: {formatAssertionMeasurement(basis.aggregate)}</p>}
          {basis.threshold && <p>Threshold: {basis.threshold.comparator}{basis.threshold.value}%</p>}
          {basis.paths.map((path) => <p key={path.pathId}>{path.route}<br /><small>{path.inputs.join(" × ")}{path.contribution ? ` = ${path.contribution}` : ""}</small></p>)}
        </div>)}
      </article>)}</div> : <p className="ubo-customer-muted">No natural-person qualification result is recorded for the chart-only assessment. This is not a negative UBO conclusion.</p>}
    </section>
  </section>;
}

export { projectGraph };
