"use strict";

const { DEFAULT_RULES } = require("./constants");
const { expandOwnership } = require("./recursiveOwnershipExpansionAgent");
const { discoverOwnership } = require("./ownershipDiscoveryAgent");
const { buildOwnershipGraph } = require("./ownershipGraphBuilderAgent");
const { calculateEffectiveOwnership } = require("./ownershipCalculationAgent");
const { analyseControl } = require("./controlAnalysisAgent");
const { determineUbos } = require("./uboDeterminationAgent");
const { explainDetermination } = require("./explainabilityAgent");
const { resolveEvidence } = require("./evidenceResolutionAgent");

function createBudget(limits) {
  const used = { entitiesInvestigated: 0, documentsDownloaded: 0, searchIterations: 0 };
  const cap = {
    entitiesInvestigated: limits.maxEntitiesToInvestigate,
    documentsDownloaded: limits.maxDocumentsToDownload,
    searchIterations: limits.maxSearchIterations,
  };
  return {
    consume(metric) {
      if (used[metric] >= cap[metric]) return false;
      used[metric] += 1;
      return true;
    },
    exhausted() { return Object.keys(cap).some((key) => used[key] >= cap[key]); },
    summary() { return { used: { ...used }, limits: { ...cap }, exhausted: this.exhausted() }; },
  };
}

function outcome({ budget, missingInformation, unresolvedPaths }) {
  if (!budget.exhausted() && !missingInformation.some((item) => item.status !== "not_material") && !unresolvedPaths.length) return "resolved";
  if (!missingInformation.length && !unresolvedPaths.length) return "resolved";
  return "partial";
}

function findUnrelatedStatements(graph) {
  const nodesWithPathToRoot = new Set([graph.rootEntityId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of graph.edges) {
      if (nodesWithPathToRoot.has(edge.to) && !nodesWithPathToRoot.has(edge.from)) {
        nodesWithPathToRoot.add(edge.from);
        changed = true;
      }
    }
  }
  return graph.edges
    .filter((edge) => !nodesWithPathToRoot.has(edge.to) || !nodesWithPathToRoot.has(edge.from))
    .map((edge) => ({ edgeId: edge.id, reason: "Ownership link is not connected to the customer entity" }));
}

function resolveOwnershipStatements(statements, evidence) {
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  const groups = new Map();
  for (const statement of statements) {
    const key = [statement.owner?.name, statement.owner?.registrationNumber || "", statement.ownedEntity?.name, statement.type || "ownership"].join("|");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(statement);
  }
  const decisions = [];
  const resolved = [];
  for (const group of groups.values()) {
    if (group.length === 1) { resolved.push(group[0]); continue; }
    const candidates = group.map((statement) => {
      const source = evidenceById.get(statement.evidenceIds?.[0]) || {};
      return { id: statement.id, value: statement.ownershipPercentage, source: source.source, sourceReliability: source.sourceReliability, extractionConfidence: source.extractionConfidence, jurisdictionRelevant: source.jurisdictionRelevant, publishedAt: source.publishedAt };
    });
    const decision = resolveEvidence(candidates);
    const selected = group.find((statement) => statement.id === decision.evidenceIds[0]) || group.find((statement) => statement.id === candidates.find((candidate) => candidate.value === decision.resolvedValue)?.id) || group[0];
    resolved.push({ ...selected, ownershipPercentage: decision.resolvedValue, evidenceIds: [...new Set(group.flatMap((statement) => statement.evidenceIds || []))], confidence: decision.confidence });
    decisions.push({ relationship: { owner: selected.owner?.name, ownedEntity: selected.ownedEntity?.name }, ...decision });
  }
  return { statements: resolved, decisions };
}

/**
 * Standalone UBO framework entry point. `adapters` is a map of async functions
 * that return { statements, evidence, missingInformation, documentsDownloaded }.
 */
async function runUboFramework({ entityName, registrationNumber, jurisdiction, tenantConfig = {}, adapters = {} }) {
  if (!entityName || !jurisdiction) throw new Error("entityName and jurisdiction are required");
  const rules = {
    ...DEFAULT_RULES,
    ...(tenantConfig.uboRules || {}),
    budgets: { ...DEFAULT_RULES.budgets, ...(tenantConfig.uboRules?.budgets || {}) },
    tenantConfig,
  };
  const budget = createBudget(rules.budgets);
  const rootEntity = { name: entityName, registrationNumber, jurisdiction, type: "company" };
  const expanded = await expandOwnership({ rootEntity, discovery: discoverOwnership, adapters, rules, budget });
  const resolutions = resolveOwnershipStatements(expanded.statements, expanded.evidence);
  const graph = buildOwnershipGraph({ rootEntity, statements: resolutions.statements });
  const unrelatedStatements = findUnrelatedStatements(graph);
  const ownership = calculateEffectiveOwnership(graph);
  const control = analyseControl(graph);
  const determination = determineUbos({ ownership, control, rules });
  const status = outcome({ budget, missingInformation: expanded.missingInformation, unresolvedPaths: ownership.unresolvedPaths });
  return {
    status,
    ownershipGraph: graph,
    evidence: expanded.evidence,
    investigationLog: expanded.investigationLog,
    searchEvents: expanded.searchEvents,
    resolutions: resolutions.decisions,
    confidence: { ownership: determination.ubos.map((ubo) => ({ personId: ubo.personId, confidence: 100 })) },
    missingInformation: [...expanded.missingInformation, ...ownership.unresolvedPaths, ...unrelatedStatements],
    ownership,
    control,
    ubos: determination.ubos,
    explanations: explainDetermination({ graph, determination, evidence: expanded.evidence }),
    budget: budget.summary(),
  };
}

module.exports = { runUboFramework, createBudget, resolveOwnershipStatements };
