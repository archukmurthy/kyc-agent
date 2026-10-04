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
  const start = text.indexOf(`"${key}"`);
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

const PARTY_TYPES = new Set(["natural_person", "legal_entity", "trust_or_legal_arrangement"]);

function ownershipDraft(text) {
  const source = String(text || "");
  const labels = new Map();
  const parties = completeObjectsAfter(source, "ownership_party_inventory")
    .filter((item) => item && item.disposition !== "INTENTIONALLY_NON_OWNERSHIP" && String(item.visible_label || "").trim())
    .slice(0, MAX_ITEMS)
    .map((item) => {
      const label = String(item.visible_label).trim().slice(0, 120);
      if (item.inventory_id) labels.set(String(item.inventory_id), label);
      return { label, type: PARTY_TYPES.has(item.party_type) ? item.party_type : "unknown_or_other" };
    });
  const connections = completeObjectsAfter(source, "ownership_connector_inventory")
    .filter((item) => item && item.disposition !== "INTENTIONALLY_NON_OWNERSHIP")
    .map((item) => ({
      from: labels.get(String(item.subject_inventory_id || "")) || null,
      to: labels.get(String(item.object_inventory_id || "")) || null,
      percentage: String(item.percentage_text || "").trim().slice(0, 40) || null,
    }))
    .filter(({ from, to }) => from && to)
    .slice(0, MAX_ITEMS);
  return { parties, connections };
}

module.exports = { ownershipDraft, completeObjectsAfter };
