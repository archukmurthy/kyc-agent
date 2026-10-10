"use strict";

// What an ownership-chart reading has found so far, read from the provider's
// answer while it is still being written - shown to the customer as a draft
// ("not checked yet") so a one-to-three-minute reading is visibly working.
// It decides nothing: the finished, validated reading replaces it.
//
// The answer lists every party and connector first (the chart prompt asks for
// the inventories before the relationships), so they arrive early. Only
// objects that are already complete are read; a half-written one waits for
// the next look.

const MAX_ITEMS = 40;

/** Each complete {...} object in the array that follows `"key": [`. */
function completeObjectsAfter(text, key) {
  const start = key ? text.indexOf(`"${key}"`) : 0;
  if (start < 0) return [];
  const open = text.indexOf("[", start);
  if (open < 0) return [];
  const objects = [];
  let depth = 0, from = -1, inString = false, escaped = false;
  for (let index = open + 1; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "\"") inString = false;
      continue;
    }
    if (char === "\"") inString = true;
    else if (char === "{") { if (depth === 0) from = index; depth += 1; }
    else if (char === "}") {
      depth -= 1;
      if (depth === 0 && from >= 0) {
        try { objects.push(JSON.parse(text.slice(from, index + 1))); } catch (_) { /* Not an object we can read. */ }
        from = -1;
      }
    } else if (char === "]" && depth === 0) break;
  }
  return objects;
}

// A provider's party type, however it was written ("NATURAL_PERSON",
// "natural person", "Individual", "company"...), as one of the four the
// Evidence contract accepts. Sonnet 5.5 wrote it in forms the contract
// refused, and 13 of 14 relationships of a chart were rejected (2026-10-04);
// Sonnet 4.5 lost a few the same way. Anything unrecognised stays unknown.
const PARTY_TYPE_WORDS = [
  ["natural_person", /^(natural_?person|person|individual|human|natural|private_?individual|beneficial_?owner)$/],
  ["legal_entity", /^(legal_?entity|legal_?person|entity|company|corporate|corporation|body_?corporate|organi[sz]ation|business|limited_?company|plc|ltd|llp|partnership|holding_?company)$/],
  ["trust_or_legal_arrangement", /^(trust_?or_?legal_?arrangement|trust|legal_?arrangement|arrangement|foundation|fund)$/],
  ["unknown_or_other", /^(unknown_?or_?other|unknown|other|unclear)$/],
];
function canonicalPartyType(...candidates) {
  for (const candidate of candidates) {
    const word = String(candidate ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
    if (!word) continue;
    const found = PARTY_TYPE_WORDS.find(([, pattern]) => pattern.test(word));
    if (found) return found[0];
  }
  return null;
}
const PARTY_TYPES = new Set(["natural_person", "legal_entity", "trust_or_legal_arrangement"]);

// The answer can carry the inventories as top-level arrays, or as facts whose
// value_json is the array written as a JSON string. Each string is decoded as
// far as it has arrived.
function encodedValues(text) {
  const values = [];
  for (const match of text.matchAll(/"value_json"\s*:\s*"/g)) {
    const from = match.index + match[0].length;
    let index = from;
    while (index < text.length) {
      if (text[index] === "\\") index += 2;
      else if (text[index] === "\"") break;
      else index += 1;
    }
    let literal = text.slice(from, Math.min(index, text.length));
    // Ended on a lone backslash (the escape's second half not here yet).
    if (index > text.length) literal = literal.slice(0, -1);
    try { values.push(JSON.parse(`"${literal}"`)); } catch (_) { /* Cut inside an escape; the next look reads it. */ }
  }
  return values;
}

function objectsOfArrays(text) {
  const objects = [];
  for (let open = text.indexOf("["); open >= 0; open = text.indexOf("[", open + 1)) {
    objects.push(...completeObjectsAfter(text.slice(open), ""));
  }
  return objects;
}

// One reading of an inventory entry, used by the provider's final parse and
// by the live draft alike: two readings drifted apart and the draft saw
// nothing while the parse saw seven parties (2026-10-04).
function inventoryParty(item) {
  return {
    inventoryId: String(item?.inventory_id || item?.party_id || item?.id || ""),
    visibleLabel: String(item?.visible_label || item?.name || item?.description || "").trim(),
    partyType: canonicalPartyType(item?.party_type, item?.partyType, item?.type, item?.entity_type, item?.category, item?.kind) || "unknown_or_other",
    disposition: String(item?.disposition || "UNRESOLVED"),
  };
}
function inventoryConnector(item) {
  const percentage = item?.percentage_points ?? item?.percentage ?? item?.percentage_value;
  return {
    connectorId: String(item?.connector_id || item?.inventory_id || item?.id || ""),
    subjectInventoryId: String(item?.subject_inventory_id || item?.subject_party_inventory_id || item?.source_party_inventory_id || item?.source_party_id || item?.from_party_id || item?.from_party_inventory_id || item?.subject_id || item?.from || item?.source || ""),
    objectInventoryId: String(item?.object_inventory_id || item?.object_party_inventory_id || item?.target_party_inventory_id || item?.target_party_id || item?.to_party_id || item?.to_party_inventory_id || item?.object_id || item?.to || item?.target || ""),
    visibleLabel: String(item?.relationship_label || item?.connector_label || item?.source_label || item?.label || ""),
    percentageText: String(item?.percentage_text || item?.connector_label || item?.relationship_label || item?.source_label || item?.label || (typeof percentage === "number" ? `${percentage}%` : "")),
    disposition: String(item?.disposition || "UNRESOLVED"),
  };
}

function ownershipInventoryDraft(text) {
  const source = String(text || "");
  const candidates = [
    ...completeObjectsAfter(source, "ownership_party_inventory"),
    ...completeObjectsAfter(source, "ownership_connector_inventory"),
    ...encodedValues(source).flatMap(objectsOfArrays),
  ].filter((item) => item && typeof item === "object" && !Array.isArray(item));
  const rawConnectors = candidates.map(inventoryConnector).filter((item) => item.subjectInventoryId && item.objectInventoryId);
  const rawParties = candidates.filter((item) => !inventoryConnector(item).subjectInventoryId).map(inventoryParty).filter((item) => item.inventoryId && item.visibleLabel);
  const partiesById = new Map();
  rawParties.forEach((item) => {
    const current = partiesById.get(item.inventoryId);
    if (!current) { partiesById.set(item.inventoryId, item); return; }
    partiesById.set(item.inventoryId, {
      ...current,
      ...item,
      visibleLabel: item.visibleLabel || current.visibleLabel,
      partyType: item.partyType === "unknown_or_other" ? current.partyType : item.partyType,
    });
  });
  const connectorsByStatement = new Map();
  rawConnectors.forEach((item) => {
    const statementKey = `${item.subjectInventoryId}|${item.objectInventoryId}`;
    if (connectorsByStatement.has(statementKey)) return;
    connectorsByStatement.set(statementKey, {
      ...item,
      connectorId: item.connectorId || `draft:${item.subjectInventoryId}->${item.objectInventoryId}`,
    });
  });
  return { partyInventory: [...partiesById.values()], connectorInventory: [...connectorsByStatement.values()] };
}

function ownershipDraft(text) {
  const { partyInventory: partyItems, connectorInventory: connectorItems } = ownershipInventoryDraft(text);
  const labels = new Map();
  const parties = [];
  partyItems.forEach((item) => {
    if (item.disposition === "INTENTIONALLY_NON_OWNERSHIP") return;
    const label = item.visibleLabel.slice(0, 120);
    labels.set(item.inventoryId, label);
    if (parties.some((party) => party.label === label) || parties.length >= MAX_ITEMS) return;
    parties.push({ label, type: PARTY_TYPES.has(item.partyType) ? item.partyType : "unknown_or_other" });
  });
  const connections = [];
  connectorItems.forEach((item) => {
    if (item.disposition === "INTENTIONALLY_NON_OWNERSHIP" || connections.length >= MAX_ITEMS) return;
    const from = labels.get(item.subjectInventoryId) || null;
    const to = labels.get(item.objectInventoryId) || null;
    if (!from || !to || connections.some((connection) => connection.from === from && connection.to === to)) return;
    connections.push({ from, to, percentage: item.percentageText.trim().slice(0, 40) || null });
  });
  return { parties, connections };
}

module.exports = { canonicalPartyType, inventoryConnector, inventoryParty, ownershipDraft, ownershipInventoryDraft, completeObjectsAfter };
