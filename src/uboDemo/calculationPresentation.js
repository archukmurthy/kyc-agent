import { formatAssertionMeasurement } from "./assertionPresentation";

export const CALCULATION_METHODS = Object.freeze([
  { value: "POLICY_ALL_ROUTES", label: "All policy routes" },
  { value: "EFFECTIVE_INTEREST", label: "Effective ownership — multiply + add" },
  { value: "PSC_CONDITION_ATTRIBUTION", label: "Control attribution" },
]);

function unique(values) { return [...new Set((values || []).filter(Boolean))]; }

function stateLabel(state, method) {
  if (state === "SATISFIED" || state === "QUALIFIES") return method === "EFFECTIVE_INTEREST" ? "Threshold satisfied under effective ownership" : method === "PSC_CONDITION_ATTRIBUTION" ? "Control-attribution route satisfied" : "At least one policy route is satisfied";
  if (state === "NOT_SATISFIED" || state === "DOES_NOT_QUALIFY") return "This route does not meet the threshold";
  if (state === "INDETERMINATE") return "Cannot determine from the available facts";
  return "Not supported / review required";
}

function routePresentation(path, relationships, entityName) {
  const edges = (path.relationshipIds || []).map((id) => relationships.get(id)).filter(Boolean);
  return {
    pathId: path.pathId,
    route: edges.length ? [entityName(edges[0].subjectEntityId), ...edges.map((edge) => entityName(edge.objectEntityId))].join(" → ") : "Recorded route",
    inputs: edges.map((edge) => formatAssertionMeasurement(edge.measurement)),
    contribution: path.contribution ? formatAssertionMeasurement(path.contribution) : null,
    relationshipIds: path.relationshipIds || [],
  };
}

export function calculationPeople(view, method = "POLICY_ALL_ROUTES", labels = {}) {
  if (!view?.graph) return [];
  const nodes = new Map((view.graph.nodes || []).map((node) => [node.entityId, node.primaryName || node.name || node.entityId]));
  const entityName = (id) => labels[id] || nodes.get(id) || id;
  const relationships = new Map((view.graph.relationships || []).map((edge) => [edge.relationshipId, edge]));
  const bases = view.qualificationBases || view.graph.qualificationBasisRecords || [];
  return (view.qualifications || view.graph.personQualificationAssessments || []).map((assessment) => {
    const personBases = bases.filter((basis) => basis.personEntityId === assessment.personEntityId);
    const selected = (method === "POLICY_ALL_ROUTES" ? personBases : personBases.filter((basis) => basis.route === method)).map((basis) => ({
      basisId: basis.basisId,
      route: basis.route,
      dimension: basis.dimension,
      state: basis.assessmentState,
      resultLabel: stateLabel(basis.assessmentState, basis.route),
      aggregate: basis.recordedCalculation?.value || basis.aggregatedTargetRightValue || null,
      threshold: basis.threshold || null,
      paths: (basis.orderedPathReferences || []).map((path) => routePresentation(path, relationships, entityName)),
      relationshipIds: unique((basis.orderedPathReferences || []).flatMap((path) => path.relationshipIds || [])),
    }));
    const selectedState = method === "POLICY_ALL_ROUTES" ? assessment.routeStatus
      : selected.some((basis) => basis.state === "SATISFIED") ? "SATISFIED"
        : selected.some((basis) => basis.state === "INDETERMINATE") ? "INDETERMINATE"
          : selected.length && selected.every((basis) => basis.state === "NOT_SATISFIED") ? "NOT_SATISFIED" : "REVIEW_REQUIRED";
    return {
      personEntityId: assessment.personEntityId,
      personName: entityName(assessment.personEntityId),
      overallPolicyState: assessment.routeStatus,
      overallPolicyLabel: stateLabel(assessment.routeStatus, "POLICY_ALL_ROUTES"),
      selectedState,
      selectedResultLabel: stateLabel(selectedState, method),
      selectedBases: selected,
    };
  });
}
