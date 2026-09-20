"use strict";

const { NODE_TYPES, TERMINAL_NODE_TYPES, EDGE_TYPES } = require("./constants");
const { evaluateMateriality } = require("./materialityEvaluationAgent");

function normalizeUkRegistrationNumber(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return /^\d+$/.test(normalized) ? normalized.padStart(8, "0") : normalized;
}

function registryIdentity(entity = {}) {
  const jurisdiction = String(entity.jurisdiction || "").trim().toUpperCase();
  const registrationNumber = jurisdiction === "GB" ? normalizeUkRegistrationNumber(entity.registrationNumber) : String(entity.registrationNumber || "").trim();
  if (registrationNumber) return `${jurisdiction || "UNKNOWN"}:REGISTRY:${registrationNumber}`;
  if (entity.id) return `ID:${entity.id}`;
  return `NAME:${String(entity.type || NODE_TYPES.UNKNOWN).toLowerCase()}:${String(entity.name || "").trim().toLowerCase()}:${jurisdiction}`;
}

function supportedUkLegalEntity(entity = {}) {
  return String(entity.jurisdiction || "").trim().toUpperCase() === "GB"
    && entity.type === NODE_TYPES.COMPANY
    && /^(?:[A-Z]{2}\d{6}|\d{8})$/.test(normalizeUkRegistrationNumber(entity.registrationNumber));
}

function canonicalEntity(entity, directory) {
  const normalized = {
    ...entity,
    jurisdiction: String(entity?.jurisdiction || "").trim().toUpperCase() || entity?.jurisdiction,
    ...(entity?.registrationNumber ? { registrationNumber: normalizeUkRegistrationNumber(entity.registrationNumber) } : {}),
  };
  const identity = registryIdentity(normalized);
  const existing = directory.get(identity);
  const merged = existing ? { ...existing, ...normalized, metadata: { ...(existing.metadata || {}), ...(normalized.metadata || {}) } } : normalized;
  directory.set(identity, merged);
  return merged;
}

async function expandOwnership({ rootEntity, discovery, adapters, rules, budget, onProgress }) {
  const statements = [];
  const evidence = [];
  const missingInformation = [];
  const investigationLog = [];
  const searchEvents = [];
  const entityDirectory = new Map();
  const normalizedRoot = canonicalEntity(rootEntity, entityDirectory);
  const rootIdentity = registryIdentity(normalizedRoot);
  const discovered = new Set([rootIdentity]);
  const expanded = new Set();
  const currentlyExpanding = new Set();
  const queue = [{ entity: normalizedRoot, pathPercentage: 100, ancestry: new Set() }];
  while (queue.length && !budget.exhausted()) {
    const current = queue.shift();
    const entityId = registryIdentity(current.entity);
    if (current.ancestry.has(entityId)) { missingInformation.push({ entity: current.entity.name, reason: "Ownership cycle detected" }); continue; }
    if (expanded.has(entityId) || currentlyExpanding.has(entityId)) continue;
    if (TERMINAL_NODE_TYPES.has(current.entity.type)) {
      onProgress?.({ stage: "terminal", entity: current.entity.name, message: `${current.entity.name}: terminal ${current.entity.type}` });
      investigationLog.push({ entity: current.entity.name, jurisdiction: current.entity.jurisdiction, outcome: `Terminal ${current.entity.type}` });
      if ([NODE_TYPES.TRUST, NODE_TYPES.FOUNDATION].includes(current.entity.type)) missingInformation.push({ entity: current.entity.name, reason: `${current.entity.type} workflow required` });
      continue;
    }
    if (!budget.consume("entitiesInvestigated")) break;
    currentlyExpanding.add(entityId);
    onProgress?.({ stage: "research_start", entity: current.entity.name, message: `Researching ${current.entity.name}` });
    const found = await discovery({ entity: current.entity, tenantConfig: rules.tenantConfig, adapters, budget });
    currentlyExpanding.delete(entityId);
    expanded.add(entityId);
    const canonicalStatements = found.statements.map((statement) => ({
      ...statement,
      owner: canonicalEntity(statement.owner || {}, entityDirectory),
      ownedEntity: canonicalEntity(statement.ownedEntity || current.entity, entityDirectory),
    }));
    onProgress?.({ stage: "research_complete", entity: current.entity.name, message: canonicalStatements.length ? `${current.entity.name}: found ${canonicalStatements.length} ownership/control relationship${canonicalStatements.length === 1 ? "" : "s"}` : `${current.entity.name}: no usable ownership/control relationship found` });
    investigationLog.push({ entity: current.entity.name, registrationNumber: current.entity.registrationNumber || null, jurisdiction: current.entity.jurisdiction, outcome: canonicalStatements.length ? `Found ${canonicalStatements.length} direct ownership/control relationship${canonicalStatements.length === 1 ? "" : "s"}` : "No usable direct ownership/control relationships found" });
    statements.push(...canonicalStatements); evidence.push(...found.evidence); missingInformation.push(...found.missingInformation);
    searchEvents.push(...(found.searchEvents || []));
    for (const statement of canonicalStatements) {
      if (!supportedUkLegalEntity(statement.owner)) continue;
      let nextPathPercentage = 100;
      if (!statement.type || statement.type === EDGE_TYPES.OWNERSHIP) {
        const materiality = evaluateMateriality({ pathPercentage: current.pathPercentage, nextOwnershipPercentage: Number(statement.ownershipPercentage), discoveryThreshold: rules.discoveryThreshold });
        if (!materiality.material) { missingInformation.push({ entity: statement.owner?.name, reason: materiality.reason, status: "not_material" }); continue; }
        nextPathPercentage = materiality.maximumPossibleOwnership;
      }
      const ownerIdentity = registryIdentity(statement.owner);
      discovered.add(ownerIdentity);
      if (!expanded.has(ownerIdentity) && !currentlyExpanding.has(ownerIdentity)) {
        queue.push({ entity: statement.owner, pathPercentage: nextPathPercentage, ancestry: new Set([...current.ancestry, entityId]) });
      }
    }
  }
  if (budget.exhausted()) {
    const pending = queue.filter(({ entity }) => !expanded.has(registryIdentity(entity)));
    if (pending.length) pending.forEach(({ entity }) => missingInformation.push({ entity: entity.name, registrationNumber: entity.registrationNumber || null, reason: "Search budget exhausted before this discovered registry entity could be expanded", status: "partial" }));
    else missingInformation.push({ reason: "search budget exhausted", status: "partial" });
  }
  return {
    statements, evidence, missingInformation, investigationLog, searchEvents,
    expansion: {
      discoveredRegistryIds: [...discovered].sort(),
      expandedRegistryIds: [...expanded].sort(),
      currentlyExpandingRegistryIds: [...currentlyExpanding].sort(),
    },
  };
}

module.exports = { expandOwnership, normalizeUkRegistrationNumber, registryIdentity, supportedUkLegalEntity };
