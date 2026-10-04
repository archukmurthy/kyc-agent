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

test("inventories sent as facts with value_json strings are read too, as far as they have arrived", () => {
  const parties = [{ inventory_id: "P1", visible_label: "Vodafone Group Plc", party_type: "LEGAL_ENTITY" }, { inventory_id: "P2", visible_label: "Alice Morgan", party_type: "Natural person" }];
  const connectors = [{ connector_id: "C1", subject_inventory_id: "P2", object_inventory_id: "P1", percentage_text: "26%" }];
  const full = JSON.stringify({ facts: [
    { concept: "ownership_party_inventory", value_json: JSON.stringify(parties) },
    { concept: "ownership_connector_inventory", value_json: JSON.stringify(connectors) },
  ] });
  assert.deepEqual(ownershipDraft(full), {
    parties: [{ label: "Vodafone Group Plc", type: "legal_entity" }, { label: "Alice Morgan", type: "natural_person" }],
    connections: [{ from: "Alice Morgan", to: "Vodafone Group Plc", percentage: "26%" }],
  });
  // Cut part-way through the second party's escaped JSON.
  const cut = full.indexOf("Alice") + 2;
  assert.deepEqual(ownershipDraft(full.slice(0, cut)), { parties: [{ label: "Vodafone Group Plc", type: "legal_entity" }], connections: [] });
});

test("party types are read however the provider writes them", () => {
  const { canonicalPartyType } = require("../ownershipDraft");
  assert.deepEqual(["NATURAL_PERSON", "natural person", "Individual", "Person", "company", "Legal Entity", "CORPORATE", "Trust", "unknown"].map((value) => canonicalPartyType(value)),
    ["natural_person", "natural_person", "natural_person", "natural_person", "legal_entity", "legal_entity", "legal_entity", "trust_or_legal_arrangement", "unknown_or_other"]);
  assert.equal(canonicalPartyType("", undefined, "company"), "legal_entity");
  assert.equal(canonicalPartyType("spaceship"), null);
});
