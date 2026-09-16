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

function graphForChartPresentation(viewGraph, sourceProjection) {
  return sourceProjection || viewGraph || null;
}

function sourceOwnershipSteps(projection) {
  if (!projection) return [];
  const labels = new Map((projection.nodes || []).map((node) => [node.entityId, node.displayName || node.primaryName || node.name || node.entityId]));
  return (projection.relationships || [])
    .filter((edge) => dimensionOf(edge) === "OWNERSHIP")
    .map((edge) => ({
      relationshipId: edge.relationshipId,
      from: labels.get(edge.sourceEntityId || edge.subjectEntityId) || "Source party",
      to: labels.get(edge.targetEntityId || edge.objectEntityId) || "Owned entity",
      measurement: edge.measurement,
    }));
}

export default function ChartAnalysisPanel({ analysis, method, onMethodChange, legacyProjection = null, sourceProjection = null }) {
  const view = analysis?.view;
  const [scope, setScope] = useState("FULL");
  const [dimension, setDimension] = useState("ALL");
  const people = useMemo(() => calculationPeople(view, method), [view, method]);
  const ownershipSteps = useMemo(() => sourceOwnershipSteps(sourceProjection), [sourceProjection]);
  const graph = useMemo(() => projectGraph(graphForChartPresentation(view?.graph, sourceProjection), scope, dimension), [view?.graph, sourceProjection, scope, dimension]);
  if (!view) return <section className="ubo-customer-chart-analysis"><section className="ubo-customer-card ubo-customer-result-card"><header><div><small>Chart-only assessment</small><h2>Review is still required</h2></div></header><p className="ubo-customer-muted">The supported chart facts remain visible below, but the existing engine could not yet create an operative graph safely.</p></section>{legacyProjection && <><p className="ubo-customer-source-notice">This older browser cache contains only the previous source visualization; it does not contain a recorded engine assessment.</p><CustomerOwnershipGraph projection={legacyProjection} /></>}</section>;
  return <section className="ubo-customer-chart-analysis" aria-label="Uploaded chart analysis">
    <header className="ubo-customer-analysis-heading"><div><small>Separate chart-only assessment</small><h2>Based on your uploaded chart — not independently verified</h2></div><span>Provisional demo review</span></header>
    {sourceProjection && <p className="ubo-customer-source-map-note"><strong>Source assertion map.</strong> The graph starts with every relationship extracted from the chart. Filters change presentation only; the separate engine result below still excludes facts that are not safely operative.</p>}
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
      </article>)}</div> : <div className="ubo-customer-calculation-empty"><p className="ubo-customer-muted"><strong>No effective-ownership result has been recorded yet.</strong> The chart facts did not produce an operative natural-person qualification record. This is not a negative UBO conclusion.</p>{ownershipSteps.length > 0 && <><p>The following ownership steps remain available from the chart, but they have not been combined into an effective ownership result:</p><ul>{ownershipSteps.map((step) => <li key={step.relationshipId}><strong>{step.from}</strong> → {step.to}: {formatAssertionMeasurement(step.measurement)}</li>)}</ul></>}</div>}
    </section>
  </section>;
}

export { graphForChartPresentation, projectGraph, sourceOwnershipSteps };
