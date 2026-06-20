"use strict";

const { DEFAULT_RULES } = require("./constants");
const { expandOwnership } = require("./recursiveOwnershipExpansionAgent");
const { discoverOwnership } = require("./ownershipDiscoveryAgent");
const { buildOwnershipGraph } = require("./ownershipGraphBuilderAgent");
const { calculateEffectiveOwnership } = require("./ownershipCalculationAgent");
const { analyseControl } = require("./controlAnalysisAgent");
const { determineUbos } = require("./uboDeterminationAgent");
const { explainDetermination } = require("./explainabilityAgent");

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
  const graph = buildOwnershipGraph({ rootEntity, statements: expanded.statements });
  const ownership = calculateEffectiveOwnership(graph);
  const control = analyseControl(graph);
  const determination = determineUbos({ ownership, control, rules });
  const status = outcome({ budget, missingInformation: expanded.missingInformation, unresolvedPaths: ownership.unresolvedPaths });
  return {
    status,
    ownershipGraph: graph,
    evidence: expanded.evidence,
    confidence: { ownership: determination.ubos.map((ubo) => ({ personId: ubo.personId, confidence: 100 })) },
    missingInformation: [...expanded.missingInformation, ...ownership.unresolvedPaths],
    ownership,
    control,
    ubos: determination.ubos,
    explanations: explainDetermination({ graph, determination, evidence: expanded.evidence }),
    budget: budget.summary(),
  };
}

module.exports = { runUboFramework, createBudget };
