"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  EXTRACTION_QUALITY_STATE,
  OWNERSHIP_CHART_PROFILE,
  assessOwnershipChartCompleteness,
  mergeOwnershipSemanticExtractions,
  normalizePartyInventory,
} = require("../ownershipChartProfile");

function party(inventoryId, visibleLabel, partyType = "natural_person") {
  return { inventoryId, visibleLabel, partyType, sourceLocator: { page: 1 }, disposition: "UNRESOLVED" };
}

function relationship(id, subjectInventoryId, objectInventoryId, relationshipType = "ECONOMIC_OWNERSHIP") {
  return {
    id,
    typedRelationship: {
      relationshipType,
      subject: { partyType: "natural_person", name: subjectInventoryId },
      object: { partyType: "legal_entity", name: objectInventoryId },
      value: { kind: "EXACT", measurementType: "percentage", exact: 25, unit: "percentage_points" },
      sourceSpecificMetadata: { connectorInventoryId: id, subjectInventoryId, objectInventoryId },
    },
  };
}

test("five inventoried parties with only four relationship endpoints triggers targeted incompleteness", () => {
  const inventory = [party("p1", "Alice"), party("p2", "Bob"), party("p3", "Carol"), party("p4", "Delta Ltd", "legal_entity"), party("p5", "Small label")];
  const facts = [relationship("c1", "p1", "p4"), relationship("c2", "p2", "p4"), relationship("c3", "p3", "p4")];
  const assessed = assessOwnershipChartCompleteness({ artifactId: "artifact-1", facts, partyInventory: inventory, connectorInventory: [{ connectorId: "c1" }, { connectorId: "c2" }, { connectorId: "c3" }], providerCompleteness: { state: "complete" }, ownershipDataStatus: "OWNERSHIP_RELATIONSHIPS_PRESENT" });
  assert.equal(assessed.state, EXTRACTION_QUALITY_STATE.EXTRACTION_SUCCESS_PARTIAL);
  assert.equal(assessed.metrics.inventoryPartyCount, 5);
  assert.deepEqual(assessed.unresolvedParties.map(({ inventoryId }) => inventoryId), ["p5"]);
  assert.equal(assessed.metrics.verificationPassUsed, false);
});

test("an ordinary Fact whose typed relationship was rejected remains explicit", () => {
  const assessed = assessOwnershipChartCompleteness({
    artifactId: "artifact-1",
    facts: [{ id: "fact-jane", supportSignals: { typedRelationship: { state: "rejected", limitations: ["direction was not established"] } } }],
    partyInventory: [party("jane", "Jane Smith")],
    connectorInventory: [{ connectorId: "jane-edge", subjectInventoryId: "jane", objectInventoryId: "target" }],
    providerCompleteness: { state: "complete" },
    ownershipDataStatus: "OWNERSHIP_RELATIONSHIPS_PRESENT",
  });
  assert.equal(assessed.state, EXTRACTION_QUALITY_STATE.EXTRACTION_INCOMPLETE);
  assert.equal(assessed.relationshipValidationFailures.length, 1);
  assert.equal(assessed.unresolvedParties[0].visibleLabel, "Jane Smith");
});

test("zero relationships is never ordinary success without explicit confirmed absence", () => {
  const incomplete = assessOwnershipChartCompleteness({ artifactId: "artifact-1", facts: [], partyInventory: [], connectorInventory: [], providerCompleteness: { state: "complete" }, ownershipDataStatus: "UNRESOLVED" });
  assert.equal(incomplete.state, EXTRACTION_QUALITY_STATE.EXTRACTION_INCOMPLETE);
  const confirmed = assessOwnershipChartCompleteness({ artifactId: "artifact-1", facts: [], partyInventory: [], connectorInventory: [], providerCompleteness: { state: "complete" }, ownershipDataStatus: "NO_OWNERSHIP_RELATIONSHIPS_CONFIRMED" });
  assert.equal(confirmed.state, EXTRACTION_QUALITY_STATE.NO_OWNERSHIP_DATA_CONFIRMED);
});

test("same-name people retain distinct source-scoped identities", () => {
  const inventory = normalizePartyInventory([party("jane-left", "Jane Smith"), party("jane-right", "Jane Smith")], "artifact-1");
  assert.equal(inventory.length, 2);
  assert.notEqual(inventory[0].sourcePartyId, inventory[1].sourcePartyId);
});

test("targeted verification merges a missing relationship without regenerating duplicates", () => {
  const primary = { facts: [relationship("c1", "p1", "target")], requestedConceptOutcomes: [{ concept: "economic_ownership", status: "found" }], completeness: { state: "incomplete", limitations: ["one item missing"] }, ownershipDataStatus: "OWNERSHIP_RELATIONSHIPS_PRESENT", ownershipPartyInventory: [party("p1", "Alice"), party("p2", "Bob")], ownershipConnectorInventory: [{ connectorId: "c1" }] };
  const verification = { facts: [relationship("c1", "p1", "target"), relationship("c2", "p2", "target")], requestedConceptOutcomes: [{ concept: "economic_ownership", status: "found" }], completeness: { state: "complete", limitations: [] }, ownershipDataStatus: "OWNERSHIP_RELATIONSHIPS_PRESENT", ownershipPartyInventory: [party("p1", "Alice"), party("p2", "Bob")], ownershipConnectorInventory: [{ connectorId: "c1" }, { connectorId: "c2" }] };
  const merged = mergeOwnershipSemanticExtractions(primary, verification);
  assert.equal(merged.facts.length, 2);
  assert.equal(merged.ownershipConnectorInventory.length, 2);
  assert.equal(merged.verificationPassUsed, true);
  assert.equal(OWNERSHIP_CHART_PROFILE.profileVersion, "ownership-chart-extraction-v2");
});
