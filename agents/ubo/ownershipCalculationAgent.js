"use strict";

const { NODE_TYPES, EDGE_TYPES } = require("./constants");

function calculateEffectiveOwnership(graph) {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const byOwnedEntity = new Map();
  for (const edge of graph.edges) {
    if (edge.type !== EDGE_TYPES.OWNERSHIP || !Number.isFinite(edge.ownershipPercentage)) continue;
    if (!byOwnedEntity.has(edge.to)) byOwnedEntity.set(edge.to, []);
    byOwnedEntity.get(edge.to).push(edge);
  }
  const results = new Map();
  const unresolvedPaths = [];
  const walk = (entityId, percentage, chain, visited) => {
    if (visited.has(entityId)) { unresolvedPaths.push({ chain, reason: "Ownership cycle detected" }); return; }
    const owners = byOwnedEntity.get(entityId) || [];
    if (!owners.length) return;
    for (const edge of owners) {
      const effective = (percentage * edge.ownershipPercentage) / 100;
      const owner = nodes.get(edge.from);
      const nextChain = [...chain, edge.id];
      if (!owner) { unresolvedPaths.push({ chain: nextChain, reason: "Owner node missing" }); continue; }
      if (owner.type === NODE_TYPES.INDIVIDUAL) {
        const current = results.get(owner.id) || { individualId: owner.id, name: owner.name, effectiveOwnership: 0, chains: [] };
        current.effectiveOwnership += effective;
        current.chains.push({ effectiveOwnership: effective, edgeIds: nextChain });
        results.set(owner.id, current);
      } else if ([NODE_TYPES.TRUST, NODE_TYPES.FOUNDATION, NODE_TYPES.UNKNOWN].includes(owner.type)) {
        unresolvedPaths.push({ chain: nextChain, entityId: owner.id, reason: `${owner.type} requires a dedicated workflow or evidence` });
      } else {
        walk(owner.id, effective, nextChain, new Set([...visited, entityId]));
      }
    }
  };
  walk(graph.rootEntityId, 100, [], new Set());
  return { individuals: [...results.values()].map((item) => ({ ...item, effectiveOwnership: Number(item.effectiveOwnership.toFixed(6)) })), unresolvedPaths };
}

module.exports = { calculateEffectiveOwnership };
