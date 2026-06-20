"use strict";

const { NODE_TYPES, TERMINAL_NODE_TYPES, EDGE_TYPES } = require("./constants");
const { evaluateMateriality } = require("./materialityEvaluationAgent");

async function expandOwnership({ rootEntity, discovery, adapters, rules, budget }) {
  const statements = [];
  const evidence = [];
  const missingInformation = [];
  const queue = [{ entity: rootEntity, pathPercentage: 100, ancestry: new Set() }];
  while (queue.length && !budget.exhausted()) {
    const current = queue.shift();
    const entityId = current.entity.id || current.entity.registrationNumber || current.entity.name;
    if (current.ancestry.has(entityId)) { missingInformation.push({ entity: current.entity.name, reason: "Ownership cycle detected" }); continue; }
    if (TERMINAL_NODE_TYPES.has(current.entity.type)) {
      if ([NODE_TYPES.TRUST, NODE_TYPES.FOUNDATION].includes(current.entity.type)) missingInformation.push({ entity: current.entity.name, reason: `${current.entity.type} workflow required` });
      continue;
    }
    if (!budget.consume("entitiesInvestigated")) break;
    const found = await discovery({ entity: current.entity, tenantConfig: rules.tenantConfig, adapters, budget });
    statements.push(...found.statements); evidence.push(...found.evidence); missingInformation.push(...found.missingInformation);
    for (const statement of found.statements) {
      if (statement.type && statement.type !== EDGE_TYPES.OWNERSHIP) continue;
      const materiality = evaluateMateriality({ pathPercentage: current.pathPercentage, nextOwnershipPercentage: Number(statement.ownershipPercentage), discoveryThreshold: rules.discoveryThreshold });
      if (!materiality.material) { missingInformation.push({ entity: statement.owner?.name, reason: materiality.reason, status: "not_material" }); continue; }
      queue.push({ entity: statement.owner, pathPercentage: materiality.maximumPossibleOwnership, ancestry: new Set([...current.ancestry, entityId]) });
    }
  }
  if (budget.exhausted()) missingInformation.push({ reason: "search budget exhausted", status: "partial" });
  return { statements, evidence, missingInformation };
}

module.exports = { expandOwnership };
