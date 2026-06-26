"use strict";

const { buildOwnershipGraph } = require("./ownershipGraphBuilderAgent");
const { calculateEffectiveOwnership } = require("./ownershipCalculationAgent");
const { analyseControl } = require("./controlAnalysisAgent");
const { determineUbos } = require("./uboDeterminationAgent");
const { explainDetermination } = require("./explainabilityAgent");
const { ownershipGaps } = require("./ownershipGapEngine");
const { projectStakeholders } = require("./stakeholderProjectionAgent");

function graphStatements(graph = {}) {
  const nodes = new Map((graph.nodes || []).map((node) => [node.id, node]));
  return (graph.edges || []).map((edge) => ({ owner: nodes.get(edge.from), ownedEntity: nodes.get(edge.to), type: edge.type, ownershipPercentage: edge.ownershipPercentage, evidenceIds: edge.evidenceIds, confidence: edge.confidence, metadata: edge.metadata }));
}

// Called when new evidence arrives. It performs no external search and is
// deterministic: graph -> calculations -> UBOs -> stakeholders -> gaps.
function recalculateOwnership({ rootEntity, currentGraph, evidence = [], rules = {} }) {
  const newStatements = evidence.flatMap((item) => item.relationships || []);
  const graph = buildOwnershipGraph({ rootEntity, statements: [...graphStatements(currentGraph), ...newStatements] });
  const ownership = calculateEffectiveOwnership(graph);
  const control = analyseControl(graph);
  const determination = determineUbos({ ownership, control, rules });
  const base = { status: ownership.unresolvedPaths.length ? "partial" : "resolved", ownershipGraph: graph, evidence, ownership, control, ubos: determination.ubos, explanations: explainDetermination({ graph, determination, evidence: evidence.flatMap((item) => item.evidence || []) }), missingInformation: ownership.unresolvedPaths };
  const gaps = ownershipGaps({ result: base });
  return { ...base, status: gaps.status === "needs_customer_evidence" ? "needs_customer_evidence" : base.status, stakeholders: projectStakeholders({ determination, control }), ownershipGaps: gaps, eventSummary: { evidenceItemsApplied: evidence.length, relationshipsApplied: newStatements.length, recomputedAt: new Date().toISOString() } };
}

module.exports = { recalculateOwnership, graphStatements };
