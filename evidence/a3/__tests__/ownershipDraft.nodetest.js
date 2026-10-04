"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ownershipDraft } = require("../ownershipDraft");

const answer = JSON.stringify({
  ownership_data_status: "OWNERSHIP_RELATIONSHIPS_PRESENT",
  ownership_party_inventory: [
    { inventory_id: "p1", visible_label: "Alice Morgan", party_type: "natural_person", disposition: "UNRESOLVED" },
    { inventory_id: "p2", visible_label: "Holdco {UK} \"Ltd\"", party_type: "legal_entity", disposition: "UNRESOLVED" },
    { inventory_id: "p3", visible_label: "Zoom 100%", party_type: "unknown_or_other", disposition: "INTENTIONALLY_NON_OWNERSHIP" },
  ],
  ownership_connector_inventory: [
    { connector_id: "c1", subject_inventory_id: "p1", object_inventory_id: "p2", percentage_text: "60%" },
  ],
  facts: [],
});

test("a complete answer gives every party and connection, without non-ownership items", () => {
  assert.deepEqual(ownershipDraft(answer), {
    parties: [{ label: "Alice Morgan", type: "natural_person" }, { label: "Holdco {UK} \"Ltd\"", type: "legal_entity" }],
    connections: [{ from: "Alice Morgan", to: "Holdco {UK} \"Ltd\"", percentage: "60%" }],
  });
});

test("a half-written answer gives only what is complete so far", () => {
  const cut = answer.indexOf("Holdco") + 3;
  assert.deepEqual(ownershipDraft(answer.slice(0, cut)), { parties: [{ label: "Alice Morgan", type: "natural_person" }], connections: [] });
  assert.deepEqual(ownershipDraft(""), { parties: [], connections: [] });
  assert.deepEqual(ownershipDraft("{\"facts\": ["), { parties: [], connections: [] });
});
