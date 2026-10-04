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

const labelOf = (item) => String(item?.visible_label || item?.name || item?.label || "").trim().slice(0, 120);
const isConnector = (item) => Boolean(item && (item.subject_inventory_id || item.object_inventory_id || item.connector_id));
const isParty = (item) => Boolean(item && !isConnector(item) && (item.inventory_id || item.party_id) && labelOf(item));

function ownershipDraft(text) {
  const source = String(text || "");
  const candidates = [
    ...completeObjectsAfter(source, "ownership_party_inventory"),
    ...completeObjectsAfter(source, "ownership_connector_inventory"),
    ...encodedValues(source).flatMap(objectsOfArrays),
  ];
  const labels = new Map();
  const parties = [];
  candidates.filter(isParty).forEach((item) => {
    if (item.disposition === "INTENTIONALLY_NON_OWNERSHIP") return;
    const label = labelOf(item);
    labels.set(String(item.inventory_id || item.party_id), label);
    if (parties.some((party) => party.label === label) || parties.length >= MAX_ITEMS) return;
    const type = canonicalPartyType(item.party_type, item.partyType, item.type, item.category, item.kind);
    parties.push({ label, type: PARTY_TYPES.has(type) ? type : "unknown_or_other" });
  });
  const connections = [];
  candidates.filter(isConnector).forEach((item) => {
    if (item.disposition === "INTENTIONALLY_NON_OWNERSHIP" || connections.length >= MAX_ITEMS) return;
    const from = labels.get(String(item.subject_inventory_id || "")) || null;
    const to = labels.get(String(item.object_inventory_id || "")) || null;
    if (!from || !to || connections.some((connection) => connection.from === from && connection.to === to)) return;
    connections.push({ from, to, percentage: String(item.percentage_text || "").trim().slice(0, 40) || null });
  });
  return { parties, connections };
}

module.exports = { canonicalPartyType, ownershipDraft, completeObjectsAfter };
