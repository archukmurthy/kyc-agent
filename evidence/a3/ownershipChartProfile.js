"use strict";

const { createHash } = require("node:crypto");

const OWNERSHIP_CHART_PROFILE = Object.freeze({
  profileVersion: "ownership-chart-extraction-v2",
  schemaVersion: "ownership-chart-schema-v2",
  instructionVersion: "ownership-chart-instructions-v3",
  verificationStrategyVersion: "ownership-chart-targeted-verification-v2",
});

const EXTRACTION_QUALITY_STATE = Object.freeze({
  EXTRACTION_SUCCESS_COMPLETE: "EXTRACTION_SUCCESS_COMPLETE",
  EXTRACTION_SUCCESS_PARTIAL: "EXTRACTION_SUCCESS_PARTIAL",
  NO_OWNERSHIP_DATA_CONFIRMED: "NO_OWNERSHIP_DATA_CONFIRMED",
  EXTRACTION_INCOMPLETE: "EXTRACTION_INCOMPLETE",
  EXTRACTION_FAILED: "EXTRACTION_FAILED",
});

function normalized(value) {
  return String(value || "").trim().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ");
}

function safeJson(value, fallback = {}) {
  if (value && typeof value === "object" && !Array.isArray(value)) return structuredClone(value);
  if (typeof value !== "string") return fallback;
  try { const parsed = JSON.parse(value); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : fallback; }
  catch (_) { return fallback; }
}

function boundedText(value, max = 500) { return String(value || "").trim().slice(0, max); }

function sourceScopedId(artifactId, kind, suppliedId, index) {
  const seed = `${artifactId || "artifact"}|${kind}|${suppliedId || index}`;
  return `ownership-${kind}:${createHash("sha256").update(seed).digest("hex").slice(0, 24)}`;
}

function normalizePartyInventory(items = [], artifactId = null) {
  return mergeByCanonicalId(items, "inventoryId").slice(0, 250).map((item, index) => {
    const inventoryId = canonicalInventoryId(item?.inventoryId || item?.inventory_id || `party-${index + 1}`, "party");
    const partyType = String(item?.partyType || item?.party_type || "unknown_or_other").toLowerCase();
    return {
      inventoryId,
      sourcePartyId: sourceScopedId(artifactId, "party", inventoryId, index),
      visibleLabel: boundedText(item?.visibleLabel || item?.visible_label || item?.name || "Unlabelled visible party"),
      partyType: ["natural_person", "legal_entity", "trust_or_legal_arrangement", "unknown_or_other"].includes(partyType) ? partyType : "unknown_or_other",
      sourceLocator: safeJson(item?.sourceLocator || item?.source_locator_json),
      providerDisposition: String(item?.disposition || "UNRESOLVED").toUpperCase(),
    };
  });
}

function normalizeConnectorInventory(items = [], artifactId = null) {
  return mergeByCanonicalId(items, "connectorId").slice(0, 500).map((item, index) => {
    const connectorId = canonicalInventoryId(item?.connectorId || item?.connector_id || `connector-${index + 1}`, "connector");
    return {
      connectorId,
      sourceConnectorId: sourceScopedId(artifactId, "connector", connectorId, index),
      subjectInventoryId: canonicalInventoryId(item?.subjectInventoryId || item?.subject_inventory_id, "party") || null,
      objectInventoryId: canonicalInventoryId(item?.objectInventoryId || item?.object_inventory_id, "party") || null,
      visibleLabel: boundedText(item?.visibleLabel || item?.visible_label || item?.relationshipLabel || item?.relationship_label),
      percentageText: boundedText(item?.percentageText || item?.percentage_text, 120) || null,
      sourceLocator: safeJson(item?.sourceLocator || item?.source_locator_json),
      providerDisposition: String(item?.disposition || "UNRESOLVED").toUpperCase(),
    };
  });
}

function relationshipMetadata(fact) {
  return fact?.typedRelationship?.sourceSpecificMetadata
    || fact?.typedRelationshipCandidate?.sourceSpecificMetadata
    || {};
}

function relationshipParty(fact, role) {
  return fact?.typedRelationship?.[role]
    || fact?.typedRelationshipCandidate?.[role]
    || null;
}

function relationshipValid(fact) {
  if (fact?.typedRelationship) return true;
  if (fact?.supportSignals?.typedRelationship?.state) return fact.supportSignals.typedRelationship.state === "validated";
  return Boolean(fact?.typedRelationshipCandidate);
}

function inventoryIdsForRelationship(fact, inventory, role) {
  const metadata = relationshipMetadata(fact);
  const explicit = canonicalInventoryId(metadata[`${role}InventoryId`] || metadata[`${role}_inventory_id`], "party");
  if (explicit) return [explicit];
  const party = relationshipParty(fact, role);
  const label = normalized(party?.name || party?.description);
  const partyType = String(party?.partyType || "").toLowerCase();
  const matches = inventory.filter((item) => normalized(item.visibleLabel) === label && (!partyType || item.partyType === partyType));
  return matches.length === 1 ? [matches[0].inventoryId] : [];
}

function assessOwnershipChartCompleteness({
  artifactId = null,
  facts = [],
  partyInventory = [],
  connectorInventory = [],
  providerCompleteness = null,
  ownershipDataStatus = "UNRESOLVED",
  verificationPassUsed = false,
} = {}) {
  const parties = normalizePartyInventory(partyInventory, artifactId);
  const connectors = normalizeConnectorInventory(connectorInventory, artifactId);
  const validRelationships = facts.filter(relationshipValid);
  const representedPartyIds = new Set();
  const representedConnectorIds = new Set();
  validRelationships.forEach((fact) => {
    const subjectIds = inventoryIdsForRelationship(fact, parties, "subject");
    const objectIds = inventoryIdsForRelationship(fact, parties, "object");
    subjectIds.forEach((id) => representedPartyIds.add(id));
    objectIds.forEach((id) => representedPartyIds.add(id));
    const metadata = relationshipMetadata(fact);
    const connectorId = canonicalInventoryId(metadata.connectorInventoryId || metadata.connector_inventory_id, "connector");
    if (connectorId) representedConnectorIds.add(connectorId);
    else if (subjectIds.length === 1 && objectIds.length === 1) {
      const matches = connectors.filter((item) => item.subjectInventoryId === subjectIds[0] && item.objectInventoryId === objectIds[0]);
      if (matches.length === 1) representedConnectorIds.add(matches[0].connectorId);
      else if (connectors.length === 1 && !connectors[0].subjectInventoryId && !connectors[0].objectInventoryId) {
        const relationship = fact.typedRelationship || fact.typedRelationshipCandidate;
        const exact = relationship?.value?.exact ?? relationship?.value?.value;
        const percentage = connectors[0].percentageText?.match(/(?:^|\D)(\d+(?:\.\d+)?)\s*%/)?.[1];
        if (Number.isFinite(exact) && percentage != null && Number(percentage) === exact) representedConnectorIds.add(connectors[0].connectorId);
      }
    }
  });
  connectors.filter((item) => representedConnectorIds.has(item.connectorId)).forEach((item) => {
    if (item.subjectInventoryId) representedPartyIds.add(item.subjectInventoryId);
    if (item.objectInventoryId) representedPartyIds.add(item.objectInventoryId);
  });

  const unresolvedParties = parties.filter((item) => !representedPartyIds.has(item.inventoryId) && item.providerDisposition !== "INTENTIONALLY_NON_OWNERSHIP")
    .map((item) => ({ ...item, resolution: "UNRESOLVED_RELATIONSHIP" }));
  const unresolvedRelationships = connectors.filter((item) => !representedConnectorIds.has(item.connectorId) && item.providerDisposition !== "INTENTIONALLY_NON_OWNERSHIP")
    .map((item) => ({ ...item, resolution: "UNRESOLVED_RELATIONSHIP" }));
  const relationshipValidationFailures = facts.filter((fact) => fact?.supportSignals?.typedRelationship?.state === "rejected")
    .map((fact) => ({ evidenceFactId: fact.id || fact.factId || null, reasonCodes: ["TYPED_RELATIONSHIP_REJECTED"], limitations: (fact.supportSignals.typedRelationship.limitations || []).map((item) => boundedText(item)) }));
  const providerComplete = providerCompleteness?.state === "complete";
  const explicitNoOwnership = ownershipDataStatus === "NO_OWNERSHIP_RELATIONSHIPS_CONFIRMED";
  let state;
  if (!validRelationships.length && explicitNoOwnership && !unresolvedParties.length && !unresolvedRelationships.length && !relationshipValidationFailures.length && providerComplete) {
    state = EXTRACTION_QUALITY_STATE.NO_OWNERSHIP_DATA_CONFIRMED;
  } else if (validRelationships.length && parties.length && providerComplete && !unresolvedParties.length && !unresolvedRelationships.length && !relationshipValidationFailures.length) {
    state = EXTRACTION_QUALITY_STATE.EXTRACTION_SUCCESS_COMPLETE;
  } else if (validRelationships.length) {
    state = EXTRACTION_QUALITY_STATE.EXTRACTION_SUCCESS_PARTIAL;
  } else {
    state = EXTRACTION_QUALITY_STATE.EXTRACTION_INCOMPLETE;
  }
  const completenessState = state === EXTRACTION_QUALITY_STATE.EXTRACTION_SUCCESS_COMPLETE ? "COMPLETE"
    : state === EXTRACTION_QUALITY_STATE.EXTRACTION_SUCCESS_PARTIAL ? "PARTIAL"
      : "INCOMPLETE";
  return {
    contractVersion: "evidence-ownership-diagram-completeness-v1",
    ...OWNERSHIP_CHART_PROFILE,
    state,
    completenessState,
    ownershipDataStatus,
    inventory: { parties, connectors },
    unresolvedParties,
    unresolvedRelationships,
    unmatchedInventoryItems: [...unresolvedParties.map((item) => ({ type: "PARTY", id: item.inventoryId })), ...unresolvedRelationships.map((item) => ({ type: "CONNECTOR", id: item.connectorId }))],
    relationshipValidationFailures,
    metrics: {
      inventoryPartyCount: parties.length,
      inventoryNaturalPersonCount: parties.filter(({ partyType }) => partyType === "natural_person").length,
      inventoryLegalEntityCount: parties.filter(({ partyType }) => partyType === "legal_entity").length,
      extractedTypedRelationshipCount: validRelationships.length,
      rejectedRelationshipCount: relationshipValidationFailures.length,
      unresolvedPartyCount: unresolvedParties.length,
      unresolvedConnectorCount: unresolvedRelationships.length,
      verificationPassUsed: verificationPassUsed === true,
    },
  };
}

function stableFactKey(fact) {
  const relationship = fact?.typedRelationship || fact?.typedRelationshipCandidate;
  if (relationship) {
    const metadata = relationship.sourceSpecificMetadata || {};
    const inventoryKey = [metadata.connectorInventoryId, metadata.subjectInventoryId, relationship.relationshipType, metadata.objectInventoryId].filter(Boolean).join("|");
    if (inventoryKey) return `relationship:${inventoryKey}`;
    return `relationship:${JSON.stringify([relationship.relationshipType, relationship.subject, relationship.object, relationship.value])}`;
  }
  return `fact:${fact?.semanticConceptId || fact?.concept || "unknown"}:${JSON.stringify(fact?.factValue === undefined ? fact?.value : fact.factValue)}`;
}

function canonicalInventoryId(value, prefix) {
  let id = boundedText(value, 120);
  while (id.toLowerCase().startsWith(`${prefix}:`) && id.length > prefix.length + 1) id = id.slice(prefix.length + 1);
  const numeric = id.match(prefix === "connector" ? /^(?:connector|conn)[_:\-]?0*(\d+)$/i : /^party[_:\-]?0*(\d+)$/i);
  if (numeric) return `${prefix}-${Number(numeric[1])}`;
  return id;
}

function mergeByCanonicalId(items, idKey) {
  const prefix = idKey === "inventoryId" ? "party" : "connector";
  const rows = new Map();
  (items || []).forEach((item, index) => {
    const snakeKey = idKey.replace(/[A-Z]/g, (value) => `_${value.toLowerCase()}`);
    const key = canonicalInventoryId(item?.[idKey] || item?.[snakeKey] || `${prefix}-${index + 1}`, prefix);
    const cleaned = { ...item, [idKey]: key };
    const current = rows.get(key);
    if (!current) { rows.set(key, cleaned); return; }
    const merged = { ...current, ...cleaned };
    Object.entries(cleaned).forEach(([field, value]) => {
      if (value == null || value === "") merged[field] = current[field];
    });
    rows.set(key, merged);
  });
  return [...rows.values()];
}

function relationshipConnectorId(fact) {
  const metadata = relationshipMetadata(fact);
  return canonicalInventoryId(metadata.connectorInventoryId || metadata.connector_inventory_id, "connector");
}

function semanticRelationshipKey(fact) {
  const relationship = fact?.typedRelationship || fact?.typedRelationshipCandidate;
  if (!relationship) return null;
  const partyKey = (party) => `${String(party?.partyType || "").toLowerCase()}|${normalized(party?.name || party?.description)}`;
  const value = relationship.value || {};
  const valueKey = [value.kind, value.measurementType, value.unit, value.exact ?? value.value, value.lower, value.upper, value.lowerInclusive, value.upperInclusive, value.qualitative]
    .map((item) => item == null ? "" : String(item)).join("|");
  return [relationship.relationshipType, partyKey(relationship.subject), partyKey(relationship.object), valueKey].join("|");
}

function requiresTargetedOwnershipVerification(assessment) {
  if (!assessment) return false;
  const relationshipsPresent = assessment.ownershipDataStatus === "OWNERSHIP_RELATIONSHIPS_PRESENT";
  return (relationshipsPresent && Number(assessment.metrics?.extractedTypedRelationshipCount || 0) === 0)
    || (assessment.unresolvedParties || []).length > 0
    || (assessment.unresolvedRelationships || []).length > 0
    || (assessment.relationshipValidationFailures || []).length > 0;
}

function mergeById(left, right, idKey) {
  const rows = new Map();
  [...(left || []), ...(right || [])].forEach((item, index) => {
    const prefix = idKey === "inventoryId" ? "party" : "connector";
    const supplied = item?.[idKey] || item?.[idKey.replace(/[A-Z]/g, (value) => `_${value.toLowerCase()}`)] || `${idKey}-${index}`;
    let key = canonicalInventoryId(supplied, prefix);
    if (idKey === "inventoryId") {
      const sameParty = [...rows.entries()].filter(([, existing]) => normalized(existing.visibleLabel || existing.name) === normalized(item?.visibleLabel || item?.name)
        && String(existing.partyType || existing.party_type || "unknown_or_other").toLowerCase() === String(item?.partyType || item?.party_type || "unknown_or_other").toLowerCase());
      if (sameParty.length === 1) key = sameParty[0][0];
    } else {
      const connectorLabel = normalized(item?.visibleLabel || item?.relationshipLabel || item?.label);
      const sameConnector = connectorLabel ? [...rows.entries()].filter(([, existing]) => normalized(existing.visibleLabel || existing.relationshipLabel || existing.label) === connectorLabel) : [];
      if (sameConnector.length === 1) key = sameConnector[0][0];
    }
    const cleaned = { ...item, [idKey]: key };
    if (idKey === "connectorId") {
      cleaned.subjectInventoryId = canonicalInventoryId(item?.subjectInventoryId || item?.subject_inventory_id, "party") || null;
      cleaned.objectInventoryId = canonicalInventoryId(item?.objectInventoryId || item?.object_inventory_id, "party") || null;
    }
    const current = rows.get(key);
    if (!current) { rows.set(key, cleaned); return; }
    const merged = { ...current, ...cleaned };
    Object.entries(cleaned).forEach(([field, value]) => {
      if (value == null || value === "") merged[field] = current[field];
    });
    if (idKey === "connectorId") {
      merged.subjectInventoryId = current.subjectInventoryId || cleaned.subjectInventoryId;
      merged.objectInventoryId = current.objectInventoryId || cleaned.objectInventoryId;
    }
    rows.set(key, merged);
  });
  return [...rows.values()];
}

function mergeOwnershipSemanticExtractions(primary, verification) {
  if (!verification) return primary;
  const facts = new Map();
  const semanticRelationships = new Map();
  [...(primary?.facts || []), ...(verification?.facts || [])].forEach((fact) => {
    const key = stableFactKey(fact);
    const current = facts.get(key);
    if (current) {
      if (!relationshipValid(current) && relationshipValid(fact)) facts.set(key, fact);
      return;
    }
    const semanticKey = semanticRelationshipKey(fact);
    const existingKey = semanticKey ? semanticRelationships.get(semanticKey) : null;
    if (existingKey) {
      const existing = facts.get(existingKey);
      const existingConnector = relationshipConnectorId(existing);
      const nextConnector = relationshipConnectorId(fact);
      if (!existingConnector || !nextConnector) {
        if ((!relationshipValid(existing) && relationshipValid(fact)) || (!existingConnector && nextConnector)) facts.set(existingKey, fact);
        return;
      }
    }
    facts.set(key, fact);
    if (semanticKey && !semanticRelationships.has(semanticKey)) semanticRelationships.set(semanticKey, key);
  });
  const outcomes = new Map();
  [...(primary?.requestedConceptOutcomes || []), ...(verification?.requestedConceptOutcomes || [])].forEach((item) => {
    const current = outcomes.get(item.concept);
    if (!current || item.status === "found" || (current.status === "not_evaluated" && item.status === "not_found")) outcomes.set(item.concept, item);
  });
  return {
    ...primary,
    facts: [...facts.values()],
    requestedConceptOutcomes: [...outcomes.values()],
    completeness: {
      state: verification.completeness?.state === "complete" ? "complete" : primary.completeness?.state || "incomplete",
      limitations: [...new Set([...(primary.completeness?.limitations || []), ...(verification.completeness?.limitations || [])])],
      sourceRecordCount: verification.completeness?.sourceRecordCount ?? primary.completeness?.sourceRecordCount ?? null,
      representedRecordCount: verification.completeness?.representedRecordCount ?? primary.completeness?.representedRecordCount ?? null,
    },
    ownershipDataStatus: verification.ownershipDataStatus && verification.ownershipDataStatus !== "UNRESOLVED" ? verification.ownershipDataStatus : primary.ownershipDataStatus,
    ownershipPartyInventory: mergeById(primary.ownershipPartyInventory, verification.ownershipPartyInventory, "inventoryId"),
    ownershipConnectorInventory: mergeById(primary.ownershipConnectorInventory, verification.ownershipConnectorInventory, "connectorId"),
    providerReturnedFactCount: (primary.providerReturnedFactCount || 0) + (verification.providerReturnedFactCount || 0),
    discardedNoValueFactCount: (primary.discardedNoValueFactCount || 0) + (verification.discardedNoValueFactCount || 0),
    discardedProvenanceFactCount: (primary.discardedProvenanceFactCount || 0) + (verification.discardedProvenanceFactCount || 0),
    discardedSampledFactCount: (primary.discardedSampledFactCount || 0) + (verification.discardedSampledFactCount || 0),
    discardedInvalidSupportFactCount: (primary.discardedInvalidSupportFactCount || 0) + (verification.discardedInvalidSupportFactCount || 0),
    typedRelationshipCandidateCount: (primary.typedRelationshipCandidateCount || 0) + (verification.typedRelationshipCandidateCount || 0),
    typedRelationshipLimitations: [...new Set([...(primary.typedRelationshipLimitations || []), ...(verification.typedRelationshipLimitations || [])])],
    verificationPassUsed: true,
  };
}

function isOwnershipChartProfile(context = {}) {
  return context.schemaReference === OWNERSHIP_CHART_PROFILE.profileVersion;
}

module.exports = {
  EXTRACTION_QUALITY_STATE,
  OWNERSHIP_CHART_PROFILE,
  assessOwnershipChartCompleteness,
  isOwnershipChartProfile,
  mergeOwnershipSemanticExtractions,
  normalizeConnectorInventory,
  normalizePartyInventory,
  requiresTargetedOwnershipVerification,
};
