"use strict";

const { NODE_TYPES, EDGE_TYPES } = require("./constants");

function stableKey(entity) {
  if (entity.id) return String(entity.id);
  const name = String(entity.name || "Unknown").trim().toLowerCase();
  return [entity.type || NODE_TYPES.UNKNOWN, name, entity.registrationNumber || "", entity.jurisdiction || ""].join(":");
}

function normaliseNode(entity = {}) {
  return {
    id: stableKey(entity),
    name: entity.name || "Unknown entity",
    type: Object.values(NODE_TYPES).includes(entity.type) ? entity.type : NODE_TYPES.UNKNOWN,
    registrationNumber: entity.registrationNumber || null,
    jurisdiction: entity.jurisdiction || null,
    metadata: entity.metadata || {},
  };
}

function normaliseEdge(statement, nodes) {
  const owner = normaliseNode(statement.owner || {});
  const ownedEntity = normaliseNode(statement.ownedEntity || {});
  nodes.set(owner.id, { ...nodes.get(owner.id), ...owner });
  nodes.set(ownedEntity.id, { ...nodes.get(ownedEntity.id), ...ownedEntity });
  const percentage = statement.ownershipPercentage === null || statement.ownershipPercentage === undefined
    ? null : Number(statement.ownershipPercentage);
  return {
    id: statement.id || `${owner.id}->${ownedEntity.id}:${statement.type || EDGE_TYPES.OWNERSHIP}`,
    from: owner.id,
    to: ownedEntity.id,
    type: Object.values(EDGE_TYPES).includes(statement.type) ? statement.type : EDGE_TYPES.OWNERSHIP,
    ownershipPercentage: Number.isFinite(percentage) ? percentage : null,
    ownershipIsMinimum: Boolean(statement.ownershipIsMinimum || statement.metadata?.ownershipIsMinimum),
    ownershipBand: statement.ownershipBand || statement.metadata?.ownershipBand || null,
    evidenceIds: [...new Set(statement.evidenceIds || [])],
    confidence: Number.isFinite(Number(statement.confidence)) ? Number(statement.confidence) : 0,
    resolved: statement.resolved !== false,
    metadata: statement.metadata || {},
  };
}

function buildOwnershipGraph({ rootEntity, statements = [] }) {
  const nodes = new Map();
  const root = normaliseNode(rootEntity);
  nodes.set(root.id, root);
  const edges = statements.map((statement) => normaliseEdge(statement, nodes));
  return { rootEntityId: root.id, nodes: [...nodes.values()], edges };
}

module.exports = { buildOwnershipGraph, normaliseNode, stableKey };
