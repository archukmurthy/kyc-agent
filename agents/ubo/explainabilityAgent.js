"use strict";

function explainDetermination({ graph, determination, evidence = [] }) {
  const edges = new Map(graph.edges.map((edge) => [edge.id, edge]));
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  return determination.ubos.map((ubo) => ({
    ubo: ubo.name,
    ownership: ubo.ownership,
    basis: ubo.basis,
    reasoning: (ubo.chains || []).map((chain) => ({
      effectiveOwnership: chain.effectiveOwnership,
      statements: chain.edgeIds.map((id) => {
        const edge = edges.get(id);
        const ownership = edge?.ownershipBand || (edge?.ownershipIsMinimum ? `${edge?.ownershipPercentage}% or more` : `${edge?.ownershipPercentage}%`);
        return `${nodes.get(edge?.from)?.name || edge?.from} owns ${ownership} of ${nodes.get(edge?.to)?.name || edge?.to}`;
      }),
      evidence: chain.edgeIds.flatMap((id) => (edges.get(id)?.evidenceIds || []).map((evidenceId) => evidenceById.get(evidenceId) || { id: evidenceId })),
    })),
    controlEvidence: (ubo.control || []).map((item) => ({ controlType: item.controlType, evidenceIds: item.evidenceIds })),
  }));
}

module.exports = { explainDetermination };
