"use strict";

const { EDGE_TYPES } = require("./constants");

function analyseControl(graph) {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  return graph.edges
    .filter((edge) => edge.type !== EDGE_TYPES.OWNERSHIP && edge.type !== EDGE_TYPES.DIRECTOR)
    .map((edge) => ({
      person: nodes.get(edge.from)?.name || edge.from,
      personId: edge.from,
      controlledEntity: nodes.get(edge.to)?.name || edge.to,
      controlType: edge.type,
      confidence: edge.confidence || 0,
      evidenceIds: edge.evidenceIds || [],
    }));
}

module.exports = { analyseControl };
